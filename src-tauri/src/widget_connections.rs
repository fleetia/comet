use crate::{
    app::{lock, AppState},
    models,
    widget_commands::publish_widgets,
    widgets::{calendar, connections, storage, WidgetInstance},
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
    #[serde(default)]
    calendar_colors: std::collections::BTreeMap<String, std::collections::BTreeMap<String, String>>,
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
    if crate::unavailable(state) {
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
    Ok(!crate::unavailable(state)
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
fn remove_calendar(data: &mut CalendarState, connection_id: &str) {
    data.connections
        .retain(|connection| connection.id != connection_id);
    data.events
        .retain(|event| event.connection_id != connection_id);
    data.attempts.remove(connection_id);
    data.calendar_colors.remove(connection_id);
    data.last_success_at = data
        .connections
        .iter()
        .filter_map(|connection| connection.last_success_at)
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
            let previous = data
                .connections
                .iter()
                .find(|connection| connection.id == connected.connection.id)
                .cloned();
            let (connection, events) = match &result {
                Ok(refreshed) => (
                    calendar::refreshed_connection(&connected.connection, refreshed, timestamp()),
                    Some(refreshed.events.clone()),
                ),
                Err(failure) => (
                    calendar::failed(
                        previous.as_ref().unwrap_or(&connected.connection),
                        failure,
                        timestamp(),
                    ),
                    None,
                ),
            };
            if previous.is_none() && data.connections.len() >= 20 {
                return Err("캘린더 연결은 20개까지 추가할 수 있습니다.".into());
            }
            merge_calendar(&mut data, connection, events);
            // A failed reconnect keeps the old selection, key and cached events intact.
            if previous.is_some() && result.is_err() {
                store_calendar(db, current, data)?;
                return result.map(|_| ()).map_err(|failure| failure.message);
            }
            let rollback = calendar::commit_connected(&connected).map_err(|x| x.message)?;
            if let Ok(refreshed) = &result {
                if let Err(error) = calendar::commit_refresh(refreshed) {
                    let _ = calendar::rollback_connected(&rollback);
                    return Err(error.message);
                }
            }
            if let Err(error) = store_calendar(db, current, data) {
                let _ = calendar::rollback_connected(&rollback);
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
fn reuse_connection(
    job: &Job,
    connected: &mut calendar::Connected,
    connection_id: Option<&str>,
) -> Result<(), String> {
    if let Some(id) = connection_id {
        let data = decode_calendar(&job.instance.data)?;
        let previous = data
            .connections
            .iter()
            .find(|connection| connection.id == id)
            .ok_or("다시 연결할 캘린더를 찾을 수 없습니다.")?;
        calendar::reconnect(connected, previous).map_err(|error| error.message)?;
    }
    Ok(())
}
#[tauri::command]
pub(crate) async fn connect_calendar_ics(
    app: AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
    input: calendar::IcsConnectInput,
    connection_id: Option<String>,
) -> Result<(), String> {
    let mut connected = calendar::connect_ics(input).map_err(|x| x.message)?;
    let state = state.inner().clone();
    let job = begin(&state, &id, Some("calendar"), |_| Ok(None))?;
    if let Err(error) = reuse_connection(&job, &mut connected, connection_id.as_deref()) {
        abandon(&state, &job);
        return Err(error);
    }
    connect_result(&app, &state, job, connected).await
}
#[tauri::command]
pub(crate) async fn connect_calendar_google(
    app: AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
    input: calendar::GoogleConnectInput,
    connection_id: Option<String>,
) -> Result<(), String> {
    let state = state.inner().clone();
    let job = begin(&state, &id, Some("calendar"), |_| Ok(None))?;
    if let Some(connection_id) = connection_id.as_deref() {
        let valid = decode_calendar(&job.instance.data)?
            .connections
            .iter()
            .any(|connection| connection.id == connection_id && connection.provider == "google");
        if !valid {
            abandon(&state, &job);
            return Err("다시 연결할 Google 캘린더를 찾을 수 없습니다.".into());
        }
    }
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
        Ok(mut connected) => {
            if let Err(error) = reuse_connection(&job, &mut connected, connection_id.as_deref()) {
                abandon(&state, &job);
                return Err(error);
            }
            connect_result(&app, &state, job, connected).await
        }
        Err(error) => {
            abandon(&state, &job);
            Err(error)
        }
    }
}
#[tauri::command]
pub(crate) async fn list_apple_calendars(
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
    request_access: bool,
) -> Result<calendar::apple::AppleCalendars, String> {
    let state = state.inner().clone();
    let job = begin(&state, &id, Some("calendar"), |_| Ok(None))?;
    let result = execute(&job, async {
        calendar::apple::list(request_access)
            .await
            .map_err(|error| error.message)
    })
    .await;
    match result {
        Ok(value) => {
            finish(&state, &job, |_, _| Ok(()))?;
            Ok(value)
        }
        Err(error) => {
            abandon(&state, &job);
            Err(error)
        }
    }
}
#[tauri::command]
pub(crate) async fn connect_calendar_apple(
    app: AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
    input: calendar::apple::AppleConnectInput,
    connection_id: Option<String>,
) -> Result<(), String> {
    let mut connected = calendar::apple::connect(input).map_err(|error| error.message)?;
    let state = state.inner().clone();
    let job = begin(&state, &id, Some("calendar"), |_| Ok(None))?;
    if let Err(error) = reuse_connection(&job, &mut connected, connection_id.as_deref()) {
        abandon(&state, &job);
        return Err(error);
    }
    connect_result(&app, &state, job, connected).await
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
                        calendar::refreshed_connection(&connection, refreshed, timestamp()),
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
        remove_calendar(&mut data, &connection_id);
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
        let old_pairing = if instance.kind == "music"
            && data["config"]["provider"] != instance.data["config"]["provider"]
        {
            pairing_id(&instance.data).map(str::to_owned)
        } else {
            None
        };
        data["failureCount"] = json!(0);
        data["nextRefreshAt"] = json!(0);
        if let Some(job) = lock(&state.widget_jobs)?.remove(&id) {
            job.store(true, Ordering::SeqCst);
        }
        storage::commit_data(&db, &id, instance.revision, data, vec![], timestamp())?;
        if let Some(pairing) = old_pairing {
            crate::music_bridge::revoke_pairing(&id, &pairing);
            forget_music_credential(id.clone(), pairing);
        }
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
    let reconnected = spotify_widget(instance)
        && instance.data["config"]["provider"] == "spicetify"
        && instance.data["status"] == "offline"
        && crate::music_bridge::pairing_status(&instance.id)["connected"] == true;
    information_due_with_connection(instance, now, reconnected)
}
fn information_due_with_connection(instance: &WidgetInstance, now: i64, reconnected: bool) -> bool {
    if reconnected {
        return instance.data["lastAttemptAt"]
            .as_i64()
            .is_none_or(|last| now.saturating_sub(last) >= connections::min_interval("music"));
    }
    instance.data["configured"] == true
        && instance.data["failureCount"].as_u64().unwrap_or(0) < 5
        && (instance.data["status"] == "syncing"
            || instance.data["nextRefreshAt"].as_i64().unwrap_or(0) <= now)
        && !matches!(
            instance.data["status"].as_str(),
            Some("permission-needed" | "unsupported" | "auth-error")
        )
}

fn pairing_id(data: &Value) -> Option<&str> {
    data["spicetifyPairingId"]
        .as_str()
        .filter(|value| value.len() == 36 && uuid::Uuid::parse_str(value).is_ok())
}

pub(crate) fn spotify_widget(instance: &WidgetInstance) -> bool {
    instance.kind == "music"
        && instance.installed
        && instance.enabled
        && instance.data["configured"] == true
        && matches!(
            instance.data["config"]["provider"].as_str(),
            Some("spotify" | "spicetify")
        )
}

fn forget_music_credential(owner: String, pairing: String) {
    // OS credential dialogs must not hold the action/DB locks or delay application shutdown.
    std::thread::spawn(move || {
        if crate::music_bridge::forget(&owner, &pairing).is_err() {
            eprintln!("해제한 음악 연결의 저장된 인증 정보를 삭제하지 못했습니다.");
        }
    });
}

pub(crate) fn clear_music_pairing(db: &rusqlite::Connection, id: &str) -> Result<(), String> {
    clear_music_pairing_with(db, id, forget_music_credential)
}

fn clear_music_pairing_with(
    db: &rusqlite::Connection,
    id: &str,
    forget: impl FnOnce(String, String),
) -> Result<(), String> {
    let instance = storage::get(db, id)?;
    if instance.kind != "music"
        || (instance.data["config"]["provider"] != "spicetify"
            && instance.data["spicetifyPairingId"].is_null())
    {
        return Ok(());
    }
    let old_pairing = pairing_id(&instance.data).map(str::to_owned);
    let mut data = instance.data.clone();
    if let Some(object) = data.as_object_mut() {
        object.remove("spicetifyPairingId");
    }
    data["status"] = json!("offline");
    data["error"] = json!("Spotify 확장 연결을 해제했어요.");
    data["observation"] = Value::Null;
    data["nextRefreshAt"] = json!(i64::MAX);
    storage::commit_data(db, id, instance.revision, data, vec![], timestamp())?;
    crate::music_bridge::revoke(id);
    if let Some(pairing) = old_pairing {
        forget(id.into(), pairing);
    }
    Ok(())
}

pub(crate) async fn prepare_music_widget(
    app: &AppHandle,
    state: &Arc<AppState>,
    id: &str,
    launch: bool,
) -> Result<(), String> {
    let original = storage::get(&*lock(&state.db)?, id)?;
    let restored = if original.data["config"]["provider"] == "spicetify"
        && pairing_id(&original.data).is_some()
    {
        resume_music_widget(app, state, id).await
    } else {
        Ok(())
    };
    if !launch {
        return restored;
    }
    // The resume job is finished before launch gets its own cancellation token. A subsequent
    // playback command may cancel launching, but must not cancel the established listener.
    let job = begin(state, id, Some("music"), |current| {
        if !spotify_widget(current)
            || current.data["config"]["provider"] != original.data["config"]["provider"]
            || pairing_id(&current.data) != pairing_id(&original.data)
        {
            return Err("설정이 바뀌어 Spotify 실행을 취소했어요.".into());
        }
        Ok(None)
    })?;
    let result = execute(&job, async {
        music_job_current(state, &job)?;
        crate::widgets::music_native::launch_spotify(job.cancel.clone())
            .await
            .map_err(|error| error.message)?;
        restored
    })
    .await;
    let outcome = finish_music_preparation(state, &job, &result);
    publish_widgets(app, state);
    outcome.and(result)
}

fn finish_music_preparation(
    state: &AppState,
    job: &Job,
    result: &Result<(), String>,
) -> Result<(), String> {
    finish(state, job, |db, current| {
        let mut data = current.data.clone();
        match result {
            Ok(()) => {
                data["status"] = json!("stale");
                data["error"] = Value::Null;
                data["failureCount"] = json!(0);
                data["nextRefreshAt"] = json!(0);
            }
            Err(message) => {
                data["status"] = json!("offline");
                data["error"] = json!(message);
                data["nextRefreshAt"] = json!(i64::MAX);
            }
        }
        storage::commit_data(db, &current.id, current.revision, data, vec![], timestamp())
    })
}

async fn resume_music_widget(
    app: &AppHandle,
    state: &Arc<AppState>,
    id: &str,
) -> Result<(), String> {
    let job = begin(state, id, Some("music"), |instance| {
        if !spotify_widget(instance) {
            return Err("Spotify를 사용하는 음악 위젯이 아닙니다.".into());
        }
        Ok(None)
    })?;
    let pairing = pairing_id(&job.instance.data).map(str::to_owned);
    let result = execute(&job, async {
        music_job_current(state, &job)?;
        let restored = if job.instance.data["config"]["provider"] == "spicetify" {
            if let Some(pairing) = pairing.as_deref() {
                crate::music_bridge::resume(id, pairing, job.cancel.clone())
                    .await
                    .map(|_| ())
            } else {
                Ok(())
            }
        } else {
            Ok(())
        };
        music_job_current(state, &job)?;
        restored
    })
    .await;
    let outcome = finish_music_preparation(state, &job, &result);
    if outcome.is_err() {
        job.cancel.store(true, Ordering::SeqCst);
        if let Some(pairing) = pairing {
            let allowed = lock(&state.db)
                .and_then(|db| storage::get(&db, id))
                .is_ok_and(|current| {
                    spotify_widget(&current) && pairing_id(&current.data) == Some(pairing.as_str())
                });
            if !allowed {
                crate::music_bridge::revoke_pairing(id, &pairing);
            }
        }
    }
    publish_widgets(app, state);
    outcome.and(result)
}

pub(crate) async fn restore_music_bridges(app: AppHandle, state: Arc<AppState>) {
    let instances = match lock(&state.db).and_then(|db| storage::instances(&db)) {
        Ok(instances) => instances,
        Err(_) => return,
    };
    for instance in instances {
        if spotify_widget(&instance)
            && instance.data["config"]["provider"] == "spicetify"
            && pairing_id(&instance.data).is_some()
        {
            let _ = prepare_music_widget(&app, &state, &instance.id, false).await;
        }
    }
}
fn calendar_due(connection: &calendar::Connection, now: i64) -> bool {
    let mut connection = connection.clone();
    if connection.status == "syncing" {
        connection.status = "stale".into();
        connection.next_refresh_at = 0;
    }
    calendar::refresh_due(&connection, now)
}
async fn refresh_observation(
    instance: &WidgetInstance,
    now: i64,
) -> Result<Value, connections::ConnectionError> {
    if instance.kind != "music" || instance.data["config"]["provider"] != "spicetify" {
        return connections::refresh(&instance.kind, &instance.data, now).await;
    }
    let mut observation = crate::music_bridge::request(&instance.id, "observe", Value::Null)
        .await
        .map_err(|message| connections::ConnectionError {
            status: "offline".into(),
            message,
        })?;
    observation["observedAt"] = json!(timestamp());
    observation["provider"] = json!("spicetify");
    observation["source"] = json!("Spotify · Spicetify");
    let mut data = instance.data.clone();
    data["observation"] = observation;
    data["lastSuccessAt"] = json!(timestamp());
    data["status"] = json!("ready");
    data["error"] = Value::Null;
    Ok(data)
}

fn music_gate() -> &'static tokio::sync::Mutex<()> {
    static GATE: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    GATE.get_or_init(|| tokio::sync::Mutex::new(()))
}

fn check_music_request(
    instance: &WidgetInstance,
    revision: i64,
    action: &str,
    now: i64,
) -> Result<(), String> {
    active(instance, Some("music"))?;
    if instance.revision != revision {
        return Err("음악 상태가 바뀌었어요. 최신 상태에서 다시 눌러 주세요.".into());
    }
    if instance.data["configured"] != true {
        return Err("음악 연결을 먼저 설정해 주세요.".into());
    }
    if ![
        "observe",
        "play",
        "pause",
        "next",
        "previous",
        "seek",
        "volume",
        "shuffle",
        "repeat",
        "playUri",
        "playlists",
        "playlistTracks",
        "playRandom",
        "queue",
        "enqueue",
        "like",
    ]
    .contains(&action)
    {
        return Err("지원하지 않는 음악 명령입니다.".into());
    }
    let query = ["observe", "playlists", "playlistTracks", "queue"].contains(&action);
    if !query {
        let observation = &instance.data["observation"];
        if !matches!(instance.data["status"].as_str(), Some("ready" | "syncing"))
            || !observation["observedAt"]
                .as_i64()
                .is_some_and(|at| now >= at && now - at <= 30_000)
        {
            return Err("현재 재생 상태를 다시 조회한 뒤 조작해 주세요.".into());
        }
        let capability = action;
        if observation["capabilities"][capability] != true {
            return Err("선택한 앱에서 지원하지 않는 재생 기능입니다.".into());
        }
    }
    Ok(())
}

fn music_job_current(state: &AppState, job: &Job) -> Result<(), String> {
    let _action = lock(&state.action)?;
    let current = storage::get(&*lock(&state.db)?, &job.instance.id)?;
    if !is_current(state, job, &current)? {
        return Err("설정이 바뀌어 음악 명령을 취소했습니다.".into());
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn music_request(
    app: AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
    expected_revision: i64,
    action: String,
    value: Value,
) -> Result<Value, String> {
    let _gate = music_gate()
        .try_lock()
        .map_err(|_| "다른 음악 명령을 처리하고 있어요. 잠시 후 다시 눌러 주세요.")?;
    let job = begin(&state, &id, Some("music"), |instance| {
        check_music_request(instance, expected_revision, &action, timestamp())?;
        Ok(None)
    })?;
    let query = ["playlists", "playlistTracks", "queue"].contains(&action.as_str());
    let result = execute(&job, async {
        music_job_current(&state, &job)?;
        let provider = job.instance.data["config"]["provider"]
            .as_str()
            .unwrap_or("");
        let result = if action == "observe" {
            Value::Null
        } else if provider == "spicetify" {
            crate::music_bridge::request(&id, &action, value).await?
        } else {
            if query {
                return Err("플레이리스트와 대기열은 Spotify 확장 연결이 필요해요.".into());
            }
            let observation = &job.instance.data["observation"];
            let provider = if provider == "auto" {
                observation["provider"].as_str().unwrap_or("")
            } else {
                provider
            };
            let input = if action == "playUri" {
                value["uri"].clone()
            } else {
                value
            };
            crate::widgets::music_native::control_source(
                provider,
                observation["sourceId"].as_str(),
                &action,
                input,
                job.cancel.clone(),
            )
            .await
            .map_err(|failure| failure.message)?;
            Value::Null
        };
        music_job_current(&state, &job)?;
        let refreshed = if query {
            None
        } else {
            Some(refresh_observation(&job.instance, timestamp()).await)
        };
        Ok((result, refreshed))
    })
    .await;
    let outcome = match result {
        Ok((value, refreshed)) => finish(&state, &job, |db, current| {
            if let Some(refreshed) = refreshed {
                let mut data = match &refreshed {
                    Ok(data) => data.clone(),
                    Err(error) => information_failure(
                        &current.data,
                        error,
                        timestamp(),
                        connections::min_interval("music"),
                    ),
                };
                if refreshed.is_ok() {
                    data["failureCount"] = json!(0);
                    data["nextRefreshAt"] = json!(timestamp() + connections::min_interval("music"));
                }
                storage::commit_data(db, &id, current.revision, data, vec![], timestamp())?;
                refreshed.map_err(|error| error.message)?;
            }
            Ok(())
        })
        .map(|_| value),
        Err(error) => {
            abandon(&state, &job);
            Err(error)
        }
    };
    publish_widgets(&app, &state);
    outcome
}

#[tauri::command]
pub(crate) fn music_bridge_status(
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
) -> Result<Value, String> {
    let _action = lock(&state.action)?;
    let instance = storage::get(&*lock(&state.db)?, &id)?;
    active(&instance, Some("music"))?;
    Ok(crate::music_bridge::pairing_status(&id))
}

#[tauri::command]
pub(crate) async fn export_music_extension(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (send, receive) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Comet Spicetify 확장 파일 저장")
        .set_file_name("comet.js")
        .add_filter("Spicetify 확장", &["js"])
        .save_file(move |path| {
            let _ = send.send(path);
        });
    let Some(path) = receive.await.map_err(|_| "파일 저장을 취소했어요.")? else {
        return Ok(None);
    };
    let path = path.into_path().map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        std::fs::write(&path, include_str!("../../integrations/spicetify/comet.js"))
            .map_err(|error| format!("확장 파일을 저장하지 못했어요: {error}"))?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) fn music_bridge_disconnect(
    app: AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
    expected_revision: i64,
) -> Result<(), String> {
    {
        let _action = lock(&state.action)?;
        let db = lock(&state.db)?;
        let instance = storage::get(&db, &id)?;
        active(&instance, Some("music"))?;
        if instance.revision != expected_revision {
            return Err("음악 설정이 바뀌었어요. 다시 확인해 주세요.".into());
        }
        if let Some(job) = lock(&state.widget_jobs)?.remove(&id) {
            job.store(true, Ordering::SeqCst);
        }
        clear_music_pairing(&db, &id)?;
    }
    publish_widgets(&app, &state);
    Ok(())
}

#[tauri::command]
pub(crate) async fn music_bridge_pair(
    app: AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
    expected_revision: i64,
) -> Result<Value, String> {
    let _gate = music_gate()
        .try_lock()
        .map_err(|_| "다른 음악 명령을 처리하고 있어요.")?;
    let pairing = uuid::Uuid::new_v4().to_string();
    let mut previous_pairing = None;
    let job = begin(&state, &id, Some("music"), |instance| {
        if instance.revision != expected_revision
            || instance.data["config"]["provider"] != "spicetify"
        {
            return Err("Spotify 확장 연결 설정을 저장한 뒤 연결해 주세요.".into());
        }
        previous_pairing = pairing_id(&instance.data).map(str::to_owned);
        let mut data = instance.data.clone();
        data["spicetifyPairingId"] = json!(pairing);
        Ok(Some(data))
    })?;
    if let Some(previous) = previous_pairing {
        crate::music_bridge::revoke_pairing(&id, &previous);
        forget_music_credential(id.clone(), previous);
    }
    let result = execute(&job, async {
        music_job_current(&state, &job)?;
        crate::music_bridge::start(&id, &pairing, job.cancel.clone()).await
    })
    .await;
    let outcome = match result {
        Ok(value) => finish(&state, &job, |db, current| {
            let mut data = current.data.clone();
            data["status"] = json!("stale");
            data["error"] = Value::Null;
            data["failureCount"] = json!(0);
            data["nextRefreshAt"] = json!(0);
            storage::commit_data(db, &id, current.revision, data, vec![], timestamp())
        })
        .map(|_| value),
        Err(error) => {
            abandon(&state, &job);
            Err(error)
        }
    };
    if outcome.is_err() {
        job.cancel.store(true, Ordering::SeqCst);
        crate::music_bridge::revoke_pairing(&id, &pairing);
        // Never let an old failed pairing remove a newer reservation.
        let _action = lock(&state.action)?;
        let db = lock(&state.db)?;
        if storage::get(&db, &id)
            .is_ok_and(|current| pairing_id(&current.data) == Some(pairing.as_str()))
        {
            clear_music_pairing(&db, &id)?;
        }
    }
    publish_widgets(&app, &state);
    outcome
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
        Ok(refresh_observation(&job.instance, time).await)
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
    if crate::unavailable(state) {
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
    fn music_instance(now: i64) -> WidgetInstance {
        WidgetInstance {
            id: "music-test".into(),
            kind: "music".into(),
            version: 1,
            installed: true,
            enabled: true,
            revision: 7,
            error: None,
            data: json!({"configured":true,"status":"ready","config":{"provider":"spotify"},
                "observation":{"observedAt":now,"capabilities":{"play":true,"seek":false}}}),
        }
    }
    #[test]
    fn only_configured_enabled_spotify_widgets_can_launch_and_restore() {
        let mut instance = music_instance(1);
        assert!(spotify_widget(&instance));
        instance.data["config"]["provider"] = json!("spicetify");
        assert!(spotify_widget(&instance));
        for provider in ["auto", "music", "system"] {
            instance.data["config"]["provider"] = json!(provider);
            assert!(!spotify_widget(&instance));
        }
        instance.data["config"]["provider"] = json!("spicetify");
        instance.data["configured"] = json!(false);
        assert!(!spotify_widget(&instance));
        instance.data["configured"] = json!(true);
        instance.enabled = false;
        assert!(!spotify_widget(&instance));
        instance.enabled = true;
        instance.installed = false;
        assert!(!spotify_widget(&instance));
    }
    #[test]
    fn reconnected_bridge_resumes_stopped_polling_without_busy_retries() {
        let mut instance = music_instance(1);
        instance.data["config"]["provider"] = json!("spicetify");
        instance.data["status"] = json!("offline");
        instance.data["failureCount"] = json!(5);
        instance.data["nextRefreshAt"] = json!(i64::MAX);
        instance.data["lastAttemptAt"] = json!(100);
        assert!(!information_due_with_connection(&instance, 15_100, false));
        assert!(!information_due_with_connection(&instance, 15_099, true));
        assert!(information_due_with_connection(&instance, 15_100, true));
    }
    #[test]
    fn completed_resume_token_is_not_cancelled_by_launch_or_playback_jobs() {
        let state = crate::lifecycle_tests::state();
        let directory = tempfile::tempdir().unwrap();
        let id = {
            let db = lock(&state.db).unwrap();
            storage::install(&db, directory.path(), &["music".into()]).unwrap();
            storage::instances(&db)
                .unwrap()
                .into_iter()
                .find(|item| item.kind == "music")
                .unwrap()
                .id
        };
        let resume = begin(&state, &id, Some("music"), |_| Ok(None)).unwrap();
        finish_music_preparation(&state, &resume, &Ok(())).unwrap();
        let launch = begin(&state, &id, Some("music"), |_| Ok(None)).unwrap();
        let _playback = begin(&state, &id, Some("music"), |_| Ok(None)).unwrap();
        assert!(launch.cancel.load(Ordering::SeqCst));
        assert!(!resume.cancel.load(Ordering::SeqCst));
        assert!(finish_music_preparation(&state, &launch, &Ok(())).is_err());
    }
    #[test]
    fn unlink_removes_restore_authority_before_credential_cleanup_and_disable_preserves_it() {
        let state = crate::lifecycle_tests::state();
        let directory = tempfile::tempdir().unwrap();
        let db = lock(&state.db).unwrap();
        storage::install(&db, directory.path(), &["music".into()]).unwrap();
        let instance = storage::instances(&db)
            .unwrap()
            .into_iter()
            .find(|item| item.kind == "music")
            .unwrap();
        let pair = uuid::Uuid::new_v4().to_string();
        let mut data =
            connections::configure("music", &instance.data, &json!({"provider":"spicetify"}))
                .unwrap();
        data["spicetifyPairingId"] = json!(pair);
        storage::commit_data(&db, &instance.id, instance.revision, data, vec![], 1).unwrap();
        clear_music_pairing_with(&db, &instance.id, |owner, removed| {
            assert_eq!(owner, instance.id);
            assert_eq!(removed, pair);
            assert!(pairing_id(&storage::get(&db, &owner).unwrap().data).is_none());
            // Even a failed OS deletion leaves no DB permission to restore the orphan.
        })
        .unwrap();
        storage::set_enabled(&db, &instance.id, false).unwrap();
        storage::set_enabled(&db, &instance.id, true).unwrap();
        assert!(pairing_id(&storage::get(&db, &instance.id).unwrap().data).is_none());
        storage::remove(&db, directory.path(), &instance.id, false).unwrap();
        assert!(pairing_id(&storage::get(&db, &instance.id).unwrap().data).is_none());
    }
    #[test]
    fn music_commands_require_current_revision_freshness_and_provider_capability() {
        let now = 1_000_000;
        let mut instance = music_instance(now);
        assert!(check_music_request(&instance, 7, "play", now).is_ok());
        assert!(check_music_request(&instance, 6, "play", now).is_err());
        assert!(check_music_request(&instance, 7, "seek", now).is_err());
        assert!(check_music_request(&instance, 7, "play", now + 30_001).is_err());
        assert!(check_music_request(&instance, 7, "play", now - 1).is_err());
        assert!(check_music_request(&instance, 7, "executeScript", now).is_err());
        instance.data["status"] = json!("offline");
        assert!(check_music_request(&instance, 7, "play", now).is_err());
        assert!(check_music_request(&instance, 7, "observe", now).is_ok());
        instance.enabled = false;
        assert!(check_music_request(&instance, 7, "observe", now).is_err());
    }
    #[test]
    fn music_job_is_invalid_after_provider_change_or_disable_and_cannot_commit() {
        let state = crate::lifecycle_tests::state();
        let directory = tempfile::tempdir().unwrap();
        let id = {
            let db = lock(&state.db).unwrap();
            storage::install(&db, directory.path(), &["music".into()]).unwrap();
            storage::instances(&db)
                .unwrap()
                .into_iter()
                .find(|widget| widget.kind == "music")
                .unwrap()
                .id
        };
        let job = begin(&state, &id, Some("music"), |_| Ok(None)).unwrap();
        assert!(music_job_current(&state, &job).is_ok());
        {
            let db = lock(&state.db).unwrap();
            let instance = storage::get(&db, &id).unwrap();
            let data =
                connections::configure("music", &instance.data, &json!({"provider":"spotify"}))
                    .unwrap();
            storage::commit_data(&db, &id, instance.revision, data, vec![], 10).unwrap();
        }
        assert!(music_job_current(&state, &job).is_err());
        assert!(finish(&state, &job, |_, _| panic!("stale commit executed")).is_err());
        let job = begin(&state, &id, Some("music"), |_| Ok(None)).unwrap();
        crate::widget_commands::cancel_widget_jobs(&state, Some(&id)).unwrap();
        assert!(music_job_current(&state, &job).is_err());
    }
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
        assert!(decoded.calendar_colors.is_empty());
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
            calendar_colors: Default::default(),
            extra: Default::default(),
        };
        data.calendar_colors.insert(
            first.connection.id.clone(),
            [(String::new(), "#112233".into())].into(),
        );
        data.calendar_colors.insert(
            second.connection.id.clone(),
            [(String::new(), "#445566".into())].into(),
        );
        let colors = data.calendar_colors.clone();
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
        merge_calendar(&mut data, second.connection.clone(), None);
        assert_eq!(data.events.len(), 1);
        assert_eq!(data.calendar_colors, colors);
        let mut replacement = calendar::connect_ics(calendar::IcsConnectInput {
            name: "renamed".into(),
            url: "https://example.com/reconnected".into(),
        })
        .unwrap();
        calendar::reconnect(&mut replacement, &second.connection).unwrap();
        merge_calendar(&mut data, replacement.connection, Some(events));
        assert_eq!(data.calendar_colors, colors);
        remove_calendar(&mut data, &second.connection.id);
        assert_eq!(data.connections.len(), 1);
        assert!(data.events.is_empty());
        assert_eq!(data.calendar_colors.len(), 1);
        assert_eq!(
            data.calendar_colors[&first.connection.id],
            colors[&first.connection.id]
        );
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
