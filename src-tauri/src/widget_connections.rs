use crate::{
    lock, models,
    widget_commands::publish_widgets,
    widgets::{calendar, connections, storage, WidgetInstance},
    AppState,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, OnceLock,
};
use tauri::AppHandle;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CalendarState {
    connections: Vec<calendar::Connection>,
    events: Vec<calendar::CalendarEvent>,
    last_success_at: Option<i64>,
    #[serde(default)]
    attempts: std::collections::BTreeMap<String, i64>,
    #[serde(flatten)]
    extra: std::collections::BTreeMap<String, Value>,
}
struct Job {
    instance: WidgetInstance,
    cancel: Arc<AtomicBool>,
}
fn timestamp() -> i64 {
    chrono::Utc::now().timestamp_millis()
}
fn semaphore() -> Arc<tokio::sync::Semaphore> {
    static LIMIT: OnceLock<Arc<tokio::sync::Semaphore>> = OnceLock::new();
    LIMIT
        .get_or_init(|| Arc::new(tokio::sync::Semaphore::new(2)))
        .clone()
}
fn decode_calendar(value: &Value) -> Result<CalendarState, String> {
    serde_json::from_value(value.clone())
        .map_err(|_| "저장된 캘린더 상태를 읽지 못했습니다.".into())
}
fn active(instance: &WidgetInstance, kind: Option<&str>) -> Result<(), String> {
    if !instance.installed || !instance.enabled {
        return Err("위젯을 설치하고 켜 주세요.".into());
    }
    if kind.is_some_and(|kind| kind != instance.kind) {
        return Err("위젯 종류가 일치하지 않습니다.".into());
    }
    Ok(())
}
fn begin(
    state: &AppState,
    id: &str,
    kind: Option<&str>,
    prepare: impl FnOnce(&WidgetInstance) -> Result<Option<Value>, String>,
) -> Result<Job, String> {
    let _action = lock(&state.action)?;
    if state.stopping.load(Ordering::SeqCst) {
        return Err("앱을 종료하고 있습니다.".into());
    }
    let db = lock(&state.db)?;
    let mut instance = storage::get(&db, id)?;
    active(&instance, kind)?;
    let data = prepare(&instance)?;
    if let Some(data) = data {
        storage::commit_data(&db, id, instance.revision, data, vec![], timestamp())?;
        instance = storage::get(&db, id)?;
    }
    let cancel = Arc::new(AtomicBool::new(false));
    if let Some(previous) = lock(&state.widget_jobs)?.insert(id.into(), cancel.clone()) {
        previous.store(true, Ordering::SeqCst);
    }
    Ok(Job { instance, cancel })
}
fn is_current(state: &AppState, job: &Job, instance: &WidgetInstance) -> Result<bool, String> {
    Ok(!state.stopping.load(Ordering::SeqCst)
        && !job.cancel.load(Ordering::SeqCst)
        && instance.installed
        && instance.enabled
        && instance.revision == job.instance.revision
        && lock(&state.widget_jobs)?
            .get(&instance.id)
            .is_some_and(|token| Arc::ptr_eq(token, &job.cancel)))
}
fn finish(
    state: &AppState,
    job: &Job,
    commit: impl FnOnce(&rusqlite::Connection, &WidgetInstance) -> Result<(), String>,
) -> Result<(), String> {
    let _action = lock(&state.action)?;
    let db = lock(&state.db)?;
    let current = storage::get(&db, &job.instance.id)?;
    let valid = is_current(state, job, &current)?;
    let result = if valid {
        commit(&db, &current)
    } else {
        Err("설정이 바뀌어 이전 조회 결과를 적용하지 않았습니다.".into())
    };
    let mut jobs = lock(&state.widget_jobs)?;
    if jobs
        .get(&job.instance.id)
        .is_some_and(|token| Arc::ptr_eq(token, &job.cancel))
    {
        jobs.remove(&job.instance.id);
    }
    result
}
fn abandon(state: &AppState, job: &Job) {
    if let Ok(mut jobs) = lock(&state.widget_jobs) {
        if jobs
            .get(&job.instance.id)
            .is_some_and(|token| Arc::ptr_eq(token, &job.cancel))
        {
            jobs.remove(&job.instance.id);
        }
    }
}
async fn execute<T>(
    job: &Job,
    work: impl std::future::Future<Output = Result<T, String>>,
) -> Result<T, String> {
    tokio::select! {_ = models::cancelled(job.cancel.clone())=>Err("위젯 조회를 취소했습니다.".into()),result=async{let _permit=semaphore().acquire_owned().await.map_err(|_|"조회 대기열을 열 수 없습니다.")?;work.await}=>result}
}
fn store_calendar(
    db: &rusqlite::Connection,
    instance: &WidgetInstance,
    data: CalendarState,
) -> Result<(), String> {
    storage::commit_data(
        db,
        &instance.id,
        instance.revision,
        serde_json::to_value(data).map_err(|_| "캘린더 저장 형식 오류")?,
        vec![],
        timestamp(),
    )
}
fn merge_calendar(
    data: &mut CalendarState,
    connection: calendar::Connection,
    events: Option<Vec<calendar::CalendarEvent>>,
) {
    let id = connection.id.clone();
    if let Some(existing) = data.connections.iter_mut().find(|x| x.id == id) {
        *existing = connection;
    } else {
        data.connections.push(connection);
    }
    if let Some(events) = events {
        data.events.retain(|event| event.connection_id != id);
        data.events.extend(events);
    }
    data.last_success_at = data
        .connections
        .iter()
        .filter_map(|x| x.last_success_at)
        .max();
}
fn open_browser(url: &str) -> Result<(), String> {
    let parsed = reqwest::Url::parse(url).map_err(|_| "링크 주소가 올바르지 않습니다.")?;
    if !["http", "https"].contains(&parsed.scheme())
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("HTTP/HTTPS 링크만 열 수 있습니다.".into());
    }
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = std::process::Command::new("/usr/bin/open");
        command.arg(url);
        command
    };
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = std::process::Command::new("rundll32.exe");
        command.arg("url.dll,FileProtocolHandler").arg(url);
        command
    };
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let mut command = {
        let mut command = std::process::Command::new("xdg-open");
        command.arg(url);
        command
    };
    let mut child = command
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|_| "기본 브라우저를 열지 못했습니다.")?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}
async fn connect_result(
    app: &AppHandle,
    state: &Arc<AppState>,
    job: Job,
    connected: calendar::Connected,
) -> Result<(), String> {
    let result = execute(&job, async {
        Ok(calendar::refresh_connected(&connected, timestamp()).await)
    })
    .await;
    let outcome = match result {
        Ok(result) => finish(state, &job, |db, current| {
            let mut data = decode_calendar(&current.data)?;
            let (connection, events) = match &result {
                Ok(refreshed) => (
                    calendar::success(&connected.connection, timestamp()),
                    Some(refreshed.events.clone()),
                ),
                Err(failure) => (
                    calendar::failed(&connected.connection, failure, timestamp()),
                    None,
                ),
            };
            if data.connections.len() >= 20 {
                return Err("캘린더 연결은 20개까지 추가할 수 있습니다.".into());
            }
            merge_calendar(&mut data, connection, events);
            calendar::commit_connected(&connected).map_err(|x| x.message)?;
            if let Ok(refreshed) = &result {
                if let Err(error) = calendar::commit_refresh(refreshed) {
                    let _ = calendar::disconnect(&connected.connection);
                    return Err(error.message);
                }
            }
            if let Err(error) = store_calendar(db, current, data) {
                let _ = calendar::disconnect(&connected.connection);
                return Err(error);
            }
            match result {
                Ok(_) => Ok(()),
                Err(failure) => Err(failure.message),
            }
        }),
        Err(error) => {
            abandon(state, &job);
            Err(error)
        }
    };
    publish_widgets(app, state);
    outcome
}
#[tauri::command]
pub(crate) async fn connect_calendar_ics(
    app: AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
    input: calendar::IcsConnectInput,
) -> Result<(), String> {
    let connected = calendar::connect_ics(input).map_err(|x| x.message)?;
    let state = state.inner().clone();
    let job = begin(&state, &id, Some("calendar"), |_| Ok(None))?;
    connect_result(&app, &state, job, connected).await
}
#[tauri::command]
pub(crate) async fn connect_calendar_google(
    app: AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
    input: calendar::GoogleConnectInput,
) -> Result<(), String> {
    let state = state.inner().clone();
    let job = begin(&state, &id, Some("calendar"), |_| Ok(None))?;
    let pending: calendar::GooglePending = match calendar::begin_google(input).await {
        Ok(value) => value,
        Err(error) => {
            abandon(&state, &job);
            return Err(error.message);
        }
    };
    if job.cancel.load(Ordering::SeqCst) {
        abandon(&state, &job);
        return Err("로그인을 취소했습니다.".into());
    }
    if let Err(error) = open_browser(&pending.authorization_url) {
        abandon(&state, &job);
        return Err(error);
    }
    let result = tokio::select! {_ = models::cancelled(job.cancel.clone())=>Err("로그인을 취소했습니다.".into()),result=calendar::finish_google(pending)=>result.map_err(|x|x.message)};
    match result {
        Ok(connected) => connect_result(&app, &state, job, connected).await,
        Err(error) => {
            abandon(&state, &job);
            Err(error)
        }
    }
}
async fn refresh_calendar_inner(
    app: &AppHandle,
    state: &Arc<AppState>,
    id: &str,
    connection_id: &str,
    manual: bool,
) -> Result<(), String> {
    let time = timestamp();
    let job = begin(state, id, Some("calendar"), |instance| {
        if !manual && lock(&state.widget_jobs)?.contains_key(id) {
            return Err("이미 조회 중입니다.".into());
        }
        let mut data = decode_calendar(&instance.data)?;
        let connection = data
            .connections
            .iter_mut()
            .find(|x| x.id == connection_id)
            .ok_or("캘린더 연결을 찾을 수 없습니다.")?;
        if manual {
            if data
                .attempts
                .get(connection_id)
                .is_some_and(|last| time.saturating_sub(*last) < 30000)
            {
                return Err("캘린더를 다시 조회하려면 30초를 기다려 주세요.".into());
            }
            connection.failure_count = 0;
        } else if !calendar_due(connection, time) {
            return Err("아직 조회할 시간이 아닙니다.".into());
        }
        connection.status = "syncing".into();
        data.attempts.insert(connection_id.into(), time);
        Ok(Some(
            serde_json::to_value(data).map_err(|_| "캘린더 상태 오류")?,
        ))
    })?;
    publish_widgets(app, state);
    let data = decode_calendar(&job.instance.data)?;
    let connection = data
        .connections
        .iter()
        .find(|x| x.id == connection_id)
        .ok_or("캘린더 연결을 찾을 수 없습니다.")?
        .clone();
    let result = execute(&job, async {
        Ok(calendar::refresh(&connection, time).await)
    })
    .await;
    let outcome = match result {
        Ok(result) => finish(state, &job, |db, current| {
            let mut data = decode_calendar(&current.data)?;
            match &result {
                Ok(refreshed) => {
                    merge_calendar(
                        &mut data,
                        calendar::success(&connection, timestamp()),
                        Some(refreshed.events.clone()),
                    );
                    calendar::commit_refresh(refreshed).map_err(|x| x.message)?;
                }
                Err(failure) => merge_calendar(
                    &mut data,
                    calendar::failed(&connection, failure, timestamp()),
                    None,
                ),
            }
            store_calendar(db, current, data)?;
            result.map(|_| ()).map_err(|x| x.message)
        }),
        Err(error) => {
            abandon(state, &job);
            Err(error)
        }
    };
    publish_widgets(app, state);
    outcome
}
#[tauri::command]
pub(crate) async fn refresh_calendar(
    app: AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
    connection_id: String,
) -> Result<(), String> {
    refresh_calendar_inner(&app, &state.inner().clone(), &id, &connection_id, true).await
}
#[tauri::command]
pub(crate) fn disconnect_calendar(
    app: AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
    connection_id: String,
) -> Result<(), String> {
    {
        let _action = lock(&state.action)?;
        let db = lock(&state.db)?;
        let instance = storage::get(&db, &id)?;
        active(&instance, Some("calendar"))?;
        let mut data = decode_calendar(&instance.data)?;
        let connection = data
            .connections
            .iter()
            .find(|x| x.id == connection_id)
            .ok_or("캘린더 연결을 찾을 수 없습니다.")?
            .clone();
        if let Some(job) = lock(&state.widget_jobs)?.remove(&id) {
            job.store(true, Ordering::SeqCst);
        }
        calendar::disconnect(&connection).map_err(|x| x.message)?;
        data.connections.retain(|x| x.id != connection_id);
        data.events.retain(|x| x.connection_id != connection_id);
        data.attempts.remove(&connection_id);
        data.last_success_at = data
            .connections
            .iter()
            .filter_map(|x| x.last_success_at)
            .max();
        store_calendar(&db, &instance, data)?;
    }
    publish_widgets(&app, &state);
    Ok(())
}
#[tauri::command]
pub(crate) fn configure_connection_widget(
    app: AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
    input: Value,
) -> Result<(), String> {
    {
        let _action = lock(&state.action)?;
        let db = lock(&state.db)?;
        let instance = storage::get(&db, &id)?;
        active(&instance, None)?;
        let mut data = connections::configure(&instance.kind, &instance.data, &input)?;
        data["failureCount"] = json!(0);
        data["nextRefreshAt"] = json!(0);
        if let Some(job) = lock(&state.widget_jobs)?.remove(&id) {
            job.store(true, Ordering::SeqCst);
        }
        storage::commit_data(&db, &id, instance.revision, data, vec![], timestamp())?;
    }
    publish_widgets(&app, &state);
    Ok(())
}
fn information_failure(
    data: &Value,
    failure: &connections::ConnectionError,
    now: i64,
    interval: i64,
) -> Value {
    let mut next = data.clone();
    let count = next["failureCount"].as_u64().unwrap_or(0).saturating_add(1);
    next["status"] = json!(failure.status);
    next["error"] = json!(failure.message);
    next["failureCount"] = json!(count);
    next["nextRefreshAt"] = json!(if count >= 5
        || ["auth-error", "permission-needed", "unsupported"].contains(&failure.status.as_str())
    {
        i64::MAX
    } else {
        now.saturating_add(interval.saturating_mul(1 << count.min(6)))
    });
    next
}
fn information_due(instance: &WidgetInstance, now: i64) -> bool {
    instance.data["configured"] == true
        && instance.data["failureCount"].as_u64().unwrap_or(0) < 5
        && (instance.data["status"] == "syncing"
            || instance.data["nextRefreshAt"].as_i64().unwrap_or(0) <= now)
        && !matches!(
            instance.data["status"].as_str(),
            Some("permission-needed" | "unsupported" | "auth-error")
        )
}
fn calendar_due(connection: &calendar::Connection, now: i64) -> bool {
    let mut connection = connection.clone();
    if connection.status == "syncing" {
        connection.status = "stale".into();
        connection.next_refresh_at = 0;
    }
    calendar::refresh_due(&connection, now)
}
async fn refresh_information(
    app: &AppHandle,
    state: &Arc<AppState>,
    id: &str,
    manual: bool,
) -> Result<(), String> {
    let time = timestamp();
    let job = begin(state, id, None, |instance| {
        if !manual && lock(&state.widget_jobs)?.contains_key(id) {
            return Err("이미 조회 중입니다.".into());
        }
        if !["weather", "music", "device"].contains(&instance.kind.as_str()) {
            return Err("정보 연결 위젯이 아닙니다.".into());
        }
        if instance.data["configured"] != true {
            return Err("조회할 정보 연결을 먼저 설정해 주세요.".into());
        }
        if manual {
            let minimum = connections::min_interval(&instance.kind).min(30000);
            if instance.data["lastAttemptAt"]
                .as_i64()
                .is_some_and(|last| time.saturating_sub(last) < minimum)
            {
                return Err("잠시 기다린 뒤 다시 조회해 주세요.".into());
            }
        } else if !information_due(instance, time) {
            return Err("아직 조회할 시간이 아닙니다.".into());
        }
        let mut data = instance.data.clone();
        if manual {
            data["failureCount"] = json!(0);
        }
        data["status"] = json!("syncing");
        data["lastAttemptAt"] = json!(time);
        Ok(Some(data))
    })?;
    publish_widgets(app, state);
    let result = execute(&job, async {
        Ok(connections::refresh(&job.instance.kind, &job.instance.data, time).await)
    })
    .await;
    let outcome = match result {
        Ok(result) => finish(state, &job, |db, current| {
            let data = match &result {
                Ok(value) => {
                    let mut value = value.clone();
                    value["lastAttemptAt"] = json!(time);
                    value["failureCount"] = json!(0);
                    value["nextRefreshAt"] =
                        json!(timestamp().saturating_add(connections::min_interval(&current.kind)));
                    value
                }
                Err(failure) => information_failure(
                    &current.data,
                    failure,
                    timestamp(),
                    connections::min_interval(&current.kind),
                ),
            };
            storage::commit_data(db, &current.id, current.revision, data, vec![], timestamp())?;
            result.map(|_| ()).map_err(|x| x.message)
        }),
        Err(error) => {
            abandon(state, &job);
            Err(error)
        }
    };
    publish_widgets(app, state);
    outcome
}
#[tauri::command]
pub(crate) async fn refresh_connection_widget(
    app: AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), String> {
    refresh_information(&app, &state.inner().clone(), &id, true).await
}
#[tauri::command]
pub(crate) async fn search_weather_regions(query: String) -> Result<Value, String> {
    let _permit = semaphore()
        .acquire_owned()
        .await
        .map_err(|_| "조회 대기열을 열 수 없습니다.")?;
    connections::search_regions(&query)
        .await
        .map_err(|x| x.message)
}
fn allowed_link(data: &Value, kind: &str, url: &str) -> bool {
    match kind {
        "calendar" => data["events"].as_array().is_some_and(|events| {
            events.iter().any(|event| {
                event["cancelled"] != true
                    && (event["url"].as_str() == Some(url)
                        || event["meetingUrl"].as_str() == Some(url))
            })
        }),
        "preparation" => data["envelopes"].as_array().is_some_and(|items| {
            items.iter().any(|item| {
                item["links"]
                    .as_array()
                    .is_some_and(|links| links.iter().any(|link| link["url"].as_str() == Some(url)))
            })
        }),
        _ => false,
    }
}
#[tauri::command]
pub(crate) fn open_widget_link(
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
    url: String,
) -> Result<(), String> {
    let _action = lock(&state.action)?;
    let db = lock(&state.db)?;
    let instance = storage::get(&db, &id)?;
    active(&instance, None)?;
    if !allowed_link(&instance.data, &instance.kind, &url) {
        return Err("현재 위젯에 등록된 링크만 열 수 있습니다.".into());
    }
    open_browser(&url)
}
pub(crate) fn start_due_widget_refreshes(app: &AppHandle, state: &Arc<AppState>) {
    if state.stopping.load(Ordering::SeqCst) {
        return;
    }
    let instances = match lock(&state.db).and_then(|db| storage::instances(&db)) {
        Ok(value) => value,
        Err(_) => return,
    };
    let now = timestamp();
    let occupied = match lock(&state.widget_jobs) {
        Ok(jobs) => jobs
            .keys()
            .cloned()
            .collect::<std::collections::HashSet<_>>(),
        Err(_) => return,
    };
    let mut available = 2usize.saturating_sub(occupied.len());
    for instance in instances {
        if available == 0 {
            break;
        }
        if !instance.installed || !instance.enabled || occupied.contains(&instance.id) {
            continue;
        }
        let calendar_id = if instance.kind == "calendar" {
            decode_calendar(&instance.data).ok().and_then(|data| {
                data.connections
                    .into_iter()
                    .find(|connection| calendar_due(connection, now))
                    .map(|connection| connection.id)
            })
        } else {
            None
        };
        let info = ["weather", "music", "device"].contains(&instance.kind.as_str())
            && information_due(&instance, now);
        if calendar_id.is_none() && !info {
            continue;
        }
        available -= 1;
        let app = app.clone();
        let state = state.clone();
        tauri::async_runtime::spawn(async move {
            if let Some(connection) = calendar_id {
                let _ =
                    refresh_calendar_inner(&app, &state, &instance.id, &connection, false).await;
            } else {
                let _ = refresh_information(&app, &state, &instance.id, false).await;
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn restart_retries_orphaned_sync_and_merge_preserves_calendar_preferences() {
        let mut connection = calendar::connect_ics(calendar::IcsConnectInput {
            name: "구독".into(),
            url: "https://example.com/feed".into(),
        })
        .unwrap()
        .connection;
        connection.status = "syncing".into();
        connection.next_refresh_at = 999999;
        assert!(calendar_due(&connection, 1));
        connection.status = "auth-error".into();
        assert!(!calendar_due(&connection, i64::MAX));
        let source =
            json!({"connections":[],"events":[],"lastSuccessAt":null,"reminders":{"enabled":true}});
        let decoded = decode_calendar(&source).unwrap();
        assert_eq!(
            serde_json::to_value(decoded).unwrap()["reminders"],
            source["reminders"]
        );
    }
    #[test]
    fn merge_preserves_unrelated_connection_events_and_failure_cache() {
        let first = calendar::connect_ics(calendar::IcsConnectInput {
            name: "first".into(),
            url: "https://example.com/a".into(),
        })
        .unwrap();
        let second = calendar::connect_ics(calendar::IcsConnectInput {
            name: "second".into(),
            url: "https://example.com/b".into(),
        })
        .unwrap();
        let mut data = CalendarState {
            connections: vec![first.connection.clone(), second.connection.clone()],
            events: vec![],
            last_success_at: None,
            attempts: Default::default(),
            extra: Default::default(),
        };
        let source="BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:a\r\nDTSTART;VALUE=DATE:20260915\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        let now = chrono::DateTime::parse_from_rfc3339("2026-09-15T00:00:00Z")
            .unwrap()
            .timestamp_millis();
        let events = calendar::parse_ics(source, &second.connection.id, now).unwrap();
        merge_calendar(
            &mut data,
            calendar::success(&second.connection, now),
            Some(events.clone()),
        );
        merge_calendar(&mut data, first.connection.clone(), Some(vec![]));
        assert_eq!(data.events.len(), 1);
        assert_eq!(data.events[0].connection_id, second.connection.id);
        merge_calendar(&mut data, second.connection, None);
        assert_eq!(data.events.len(), 1);
    }
    #[test]
    fn failure_keeps_observation_and_last_success_and_event_urls_are_allowlisted() {
        let data = json!({"configured":true,"status":"ready","observation":{"temperature":21},"lastSuccessAt":123,"failureCount":0});
        let failure = connections::ConnectionError {
            status: "offline".into(),
            message: "연결 실패".into(),
        };
        let result = information_failure(&data, &failure, 1000, 60000);
        assert_eq!(result["observation"], data["observation"]);
        assert_eq!(result["lastSuccessAt"], 123);
        assert_eq!(result["nextRefreshAt"], 121000);
        let links = json!({"events":[{"url":"https://example.com","cancelled":false},{"url":"https://cancelled.example.com","cancelled":true}]});
        assert!(allowed_link(&links, "calendar", "https://example.com"));
        assert!(!allowed_link(
            &links,
            "calendar",
            "https://cancelled.example.com"
        ));
        assert!(!allowed_link(
            &links,
            "calendar",
            "https://other.example.com"
        ));
    }
}
