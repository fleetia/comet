mod ics;
mod oauth;

use chrono::{DateTime, Utc};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::{Arc, OnceLock};
use std::time::Duration;

pub use ics::parse_ics;
pub use oauth::{begin_google, finish_google, GoogleConnectInput, GooglePending};

const MAX_BYTES: usize = 4 * 1024 * 1024;
pub const REFRESH_INTERVAL_MS: i64 = 15 * 60 * 1000;
pub const MAX_EVENTS: usize = 5000;
const DAY_MS: i64 = 86400000;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub status: String,
    pub last_success_at: Option<i64>,
    pub error: Option<String>,
    #[serde(default)]
    pub failure_count: u32,
    #[serde(default)]
    pub next_refresh_at: i64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEvent {
    pub id: String,
    pub connection_id: String,
    pub source_id: String,
    pub occurrence_id: String,
    pub title: String,
    pub start_at: Option<i64>,
    pub end_at: Option<i64>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub time_zone: Option<String>,
    pub all_day: bool,
    pub cancelled: bool,
    pub url: Option<String>,
    pub meeting_url: Option<String>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarError {
    pub status: String,
    pub message: String,
}
fn error(status: &str, message: &str) -> CalendarError {
    CalendarError {
        status: status.into(),
        message: message.into(),
    }
}
fn invalid(message: &str) -> CalendarError {
    error("stale", message)
}
#[derive(Serialize, Deserialize)]
struct Credential {
    connection_id: String,
    provider: String,
    url: Option<String>,
    client_id: Option<String>,
    client_secret: Option<String>,
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_at: Option<i64>,
    calendar_ids: Vec<String>,
}
pub struct Connected {
    pub connection: Connection,
    credential: Credential,
}
pub struct Refreshed {
    pub events: Vec<CalendarEvent>,
    credential: Option<Credential>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IcsConnectInput {
    pub name: String,
    pub url: String,
}
fn connection(name: String, provider: &str) -> Connection {
    Connection {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        provider: provider.into(),
        status: "stale".into(),
        last_success_at: None,
        error: None,
        failure_count: 0,
        next_refresh_at: 0,
    }
}
fn validate_name(name: &str) -> Result<(), CalendarError> {
    if name.trim().is_empty() || name.chars().count() > 200 {
        return Err(invalid("연결 이름은 1~200자로 입력하세요."));
    }
    Ok(())
}
const CALENDAR_SERVICE: &str = "space.starlight.comet.calendar";

fn validate_id(id: &str) -> Result<(), CalendarError> {
    uuid::Uuid::parse_str(id).map_err(|_| invalid("연결 ID가 올바르지 않습니다."))?;
    Ok(())
}

fn key(id: &str) -> Result<keyring::Entry, CalendarError> {
    validate_id(id)?;
    keyring::Entry::new(CALENDAR_SERVICE, id)
        .map_err(|_| error("auth-error", "OS 자격 증명 저장소를 열 수 없습니다."))
}
fn legacy_key(id: &str) -> Result<keyring::Entry, CalendarError> {
    validate_id(id)?;
    let service = crate::legacy_names::calendar_service();
    keyring::Entry::new(&service, id)
        .map_err(|_| error("auth-error", "OS 자격 증명 저장소를 열 수 없습니다."))
}
fn save(credential: &Credential) -> Result<(), CalendarError> {
    let value = serde_json::to_string(credential)
        .map_err(|_| invalid("연결 정보를 저장할 수 없습니다."))?;
    key(&credential.connection_id)?
        .set_password(&value)
        .map_err(|_| error("auth-error", "OS 자격 증명 저장소에 저장하지 못했습니다."))?;
    if let Ok(entry) = legacy_key(&credential.connection_id) {
        let _ = entry.delete_credential();
    }
    Ok(())
}
fn load(connection: &Connection) -> Result<Credential, CalendarError> {
    let (value, migrate) = match key(&connection.id)?.get_password() {
        Ok(value) => (value, false),
        Err(keyring::Error::NoEntry) => (
            legacy_key(&connection.id)?.get_password().map_err(|_| {
                error(
                    "auth-error",
                    "연결 정보를 찾을 수 없습니다. 다시 연결해 주세요.",
                )
            })?,
            true,
        ),
        Err(_) => {
            return Err(error(
                "auth-error",
                "연결 정보를 찾을 수 없습니다. 다시 연결해 주세요.",
            ));
        }
    };
    let credential: Credential = serde_json::from_str(&value)
        .map_err(|_| error("auth-error", "저장된 연결 정보를 읽을 수 없습니다."))?;
    if credential.connection_id != connection.id || credential.provider != connection.provider {
        return Err(error("auth-error", "연결 정보의 소유 범위가 다릅니다."));
    }
    if migrate {
        save(&credential)?;
    }
    Ok(credential)
}
pub fn commit_connected(value: &Connected) -> Result<(), CalendarError> {
    save(&value.credential)
}
pub fn commit_refresh(value: &Refreshed) -> Result<(), CalendarError> {
    if let Some(credential) = &value.credential {
        save(credential)?;
    }
    Ok(())
}
pub fn disconnect(connection: &Connection) -> Result<(), CalendarError> {
    match key(&connection.id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => {}
        Err(_) => {
            return Err(error(
                "auth-error",
                "OS 자격 증명 저장소에서 연결을 삭제하지 못했습니다.",
            ))
        }
    }
    match legacy_key(&connection.id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err(error(
            "auth-error",
            "OS 자격 증명 저장소에서 연결을 삭제하지 못했습니다.",
        )),
    }
}
fn subscription_url(value: &str) -> Result<reqwest::Url, CalendarError> {
    if value.len() > 4000 {
        return Err(invalid("구독 주소가 너무 깁니다."));
    }
    let normalized = if let Some(tail) = value.strip_prefix("webcal://") {
        format!("https://{tail}")
    } else {
        value.into()
    };
    let url =
        reqwest::Url::parse(&normalized).map_err(|_| invalid("구독 주소가 올바르지 않습니다."))?;
    if !["http", "https"].contains(&url.scheme())
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err(invalid(
            "HTTP/HTTPS/webcal 구독 주소를 입력하세요. 사용자 정보와 fragment는 지원하지 않습니다.",
        ));
    }
    Ok(url)
}
pub fn connect_ics(input: IcsConnectInput) -> Result<Connected, CalendarError> {
    validate_name(&input.name)?;
    let url = subscription_url(&input.url)?;
    let connection = connection(input.name, "ics");
    let credential = Credential {
        connection_id: connection.id.clone(),
        provider: "ics".into(),
        url: Some(url.into()),
        client_id: None,
        client_secret: None,
        access_token: None,
        refresh_token: None,
        expires_at: None,
        calendar_ids: vec![],
    };
    Ok(Connected {
        connection,
        credential,
    })
}
fn client() -> Result<reqwest::Client, CalendarError> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .connect_timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| error("offline", "연결 준비에 실패했습니다."))
}
async fn body(response: reqwest::Response) -> Result<Vec<u8>, CalendarError> {
    if response.status() == reqwest::StatusCode::UNAUTHORIZED
        || response.status() == reqwest::StatusCode::FORBIDDEN
    {
        return Err(error("auth-error", "인증 또는 읽기 권한을 확인해 주세요."));
    }
    if !response.status().is_success() {
        return Err(error(
            "offline",
            "원본 서비스가 요청을 처리하지 못했습니다.",
        ));
    }
    if response
        .content_length()
        .is_some_and(|n| n > MAX_BYTES as u64)
    {
        return Err(invalid("캘린더 응답이 4 MiB 한도를 넘었습니다."));
    }
    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| error("offline", "캘린더 응답을 읽지 못했습니다."))?;
        if bytes.len() + chunk.len() > MAX_BYTES {
            return Err(invalid("캘린더 응답이 4 MiB 한도를 넘었습니다."));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
async fn json_response(response: reqwest::Response) -> Result<Value, CalendarError> {
    serde_json::from_slice(&body(response).await?)
        .map_err(|_| invalid("원본 서비스의 응답 형식이 올바르지 않습니다."))
}
pub fn success(connection: &Connection, now: i64) -> Connection {
    let mut next = connection.clone();
    next.status = "ready".into();
    next.last_success_at = Some(now);
    next.error = None;
    next.failure_count = 0;
    next.next_refresh_at = now.saturating_add(REFRESH_INTERVAL_MS);
    next
}
pub fn failed(connection: &Connection, failure: &CalendarError, now: i64) -> Connection {
    let mut next = connection.clone();
    next.status = failure.status.clone();
    next.error = Some(failure.message.clone());
    next.failure_count = next.failure_count.saturating_add(1);
    next.next_refresh_at = if next.status == "auth-error" || next.failure_count >= 5 {
        i64::MAX
    } else {
        now.saturating_add(REFRESH_INTERVAL_MS.saturating_mul(1i64 << next.failure_count.min(6)))
    };
    next
}
pub fn refresh_due(connection: &Connection, now: i64) -> bool {
    connection.status != "syncing"
        && connection.next_refresh_at <= now
        && connection.status != "auth-error"
        && connection.failure_count < 5
}
pub async fn refresh(connection: &Connection, now: i64) -> Result<Refreshed, CalendarError> {
    static READERS: OnceLock<Arc<tokio::sync::Semaphore>> = OnceLock::new();
    let owned = connection.clone();
    let credential = bounded_credential_read(
        READERS
            .get_or_init(|| Arc::new(tokio::sync::Semaphore::new(2)))
            .clone(),
        Duration::from_secs(5),
        move || load(&owned),
    )
    .await?;
    bounded_refresh(connection, credential, now).await
}
// Detached OS reads cannot be aborted; permits stay with them to bound stalled threads.
// Unlike spawn_blocking, they do not make Tokio shutdown wait for an OS permission dialog.
async fn bounded_credential_read<T: Send + 'static>(
    readers: Arc<tokio::sync::Semaphore>,
    timeout: Duration,
    read: impl FnOnce() -> Result<T, CalendarError> + Send + 'static,
) -> Result<T, CalendarError> {
    let unavailable = || {
        error(
            "auth-error",
            "OS 자격 증명 읽기 권한을 확인한 뒤 다시 갱신해 주세요.",
        )
    };
    tokio::time::timeout(timeout, async move {
        let permit = readers.acquire_owned().await.map_err(|_| unavailable())?;
        let (sender, receiver) = tokio::sync::oneshot::channel();
        std::thread::Builder::new()
            .name("calendar-credential-read".into())
            .spawn(move || {
                let _permit = permit;
                let result = read();
                let _ = sender.send(result);
            })
            .map_err(|_| unavailable())?;
        receiver.await.map_err(|_| unavailable())?
    })
    .await
    .map_err(|_| unavailable())?
}

pub async fn refresh_connected(
    connected: &Connected,
    now: i64,
) -> Result<Refreshed, CalendarError> {
    let serialized =
        serde_json::to_value(&connected.credential).map_err(|_| invalid("연결 정보 오류"))?;
    let credential = serde_json::from_value(serialized).map_err(|_| invalid("연결 정보 오류"))?;
    bounded_refresh(&connected.connection, credential, now).await
}
async fn bounded_refresh(
    connection: &Connection,
    credential: Credential,
    now: i64,
) -> Result<Refreshed, CalendarError> {
    tokio::time::timeout(
        Duration::from_secs(90),
        refresh_credential(connection, credential, now),
    )
    .await
    .map_err(|_| error("offline", "캘린더 전체 갱신 시간이 90초를 넘었습니다."))?
}
async fn refresh_credential(
    connection: &Connection,
    mut credential: Credential,
    now: i64,
) -> Result<Refreshed, CalendarError> {
    let events = if connection.provider == "ics" {
        let mut url = subscription_url(
            credential
                .url
                .as_deref()
                .ok_or_else(|| error("auth-error", "구독 정보를 찾을 수 없습니다."))?,
        )?;
        let client = client()?;
        let mut result = None;
        for redirect in 0..=3 {
            let response = client
                .get(url.clone())
                .send()
                .await
                .map_err(|_| error("offline", "캘린더 구독에 연결할 수 없습니다."))?;
            if response.status().is_redirection() {
                if redirect == 3 {
                    return Err(invalid("구독 주소의 이동 횟수가 너무 많습니다."));
                }
                let location = response
                    .headers()
                    .get(reqwest::header::LOCATION)
                    .and_then(|x| x.to_str().ok())
                    .ok_or_else(|| invalid("구독 주소 이동 응답 오류"))?;
                let next = url
                    .join(location)
                    .map_err(|_| invalid("구독 주소 이동 응답 오류"))?;
                let next = subscription_url(next.as_str())?;
                if url.scheme() == "https" && next.scheme() != "https" {
                    return Err(invalid("HTTPS 구독을 HTTP로 이동할 수 없습니다."));
                }
                url = next;
                continue;
            }
            result = Some(body(response).await?);
            break;
        }
        let bytes = result.ok_or_else(|| invalid("구독 응답이 없습니다."))?;
        let text = String::from_utf8(bytes).map_err(|_| invalid("UTF-8 캘린더만 지원합니다."))?;
        parse_ics(&text, &connection.id, now)?
    } else if connection.provider == "google" {
        oauth::refresh_token(&mut credential, now).await?;
        google_events(&credential, now).await?
    } else {
        return Err(invalid("지원하지 않는 캘린더 연결입니다."));
    };
    Ok(Refreshed {
        events,
        credential: if connection.provider == "google" {
            Some(credential)
        } else {
            None
        },
    })
}
fn safe_url(value: Option<&str>) -> Option<String> {
    let value = value?;
    let url = reqwest::Url::parse(value).ok()?;
    if ["http", "https"].contains(&url.scheme())
        && url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none()
    {
        Some(value.into())
    } else {
        None
    }
}
fn string(value: &Value, key: &str) -> Result<String, CalendarError> {
    value[key]
        .as_str()
        .filter(|v| !v.is_empty() && v.len() < 10000)
        .map(str::to_owned)
        .ok_or_else(|| invalid("캘린더 항목의 필수 정보가 없습니다."))
}
fn google_event(
    item: &Value,
    connection_id: &str,
    source_id: &str,
) -> Result<CalendarEvent, CalendarError> {
    let source_event = string(item, "id")?;
    let cancelled = item["status"] == "cancelled";
    let occurrence = if let Some(original) = item.get("originalStartTime") {
        original["dateTime"]
            .as_str()
            .or(original["date"].as_str())
            .map(str::to_owned)
            .ok_or_else(|| invalid("반복 회차 식별 정보 오류"))?
    } else {
        source_event.clone()
    };
    let mut event = CalendarEvent {
        id: format!("{connection_id}:{source_id}:{source_event}"),
        connection_id: connection_id.into(),
        source_id: source_id.into(),
        occurrence_id: occurrence,
        title: item["summary"]
            .as_str()
            .unwrap_or("제목 없음")
            .chars()
            .take(1000)
            .collect(),
        start_at: None,
        end_at: None,
        start_date: None,
        end_date: None,
        time_zone: item["start"]["timeZone"].as_str().map(str::to_owned),
        all_day: false,
        cancelled,
        url: safe_url(item["htmlLink"].as_str()),
        meeting_url: safe_url(item["hangoutLink"].as_str()),
    };
    if cancelled && item.get("start").is_none() {
        return Ok(event);
    }
    if let Some(start) = item["start"]["date"].as_str() {
        let end = string(&item["end"], "date")?;
        let start_day = chrono::NaiveDate::parse_from_str(start, "%Y-%m-%d")
            .map_err(|_| invalid("종일 일정 날짜 오류"))?;
        let end_day = chrono::NaiveDate::parse_from_str(&end, "%Y-%m-%d")
            .map_err(|_| invalid("종일 일정 날짜 오류"))?;
        if end_day <= start_day {
            return Err(invalid("종일 일정 종료 날짜 오류"));
        }
        event.all_day = true;
        event.start_date = Some(start.into());
        event.end_date = Some(end);
    } else {
        let start = DateTime::parse_from_rfc3339(&string(&item["start"], "dateTime")?)
            .map_err(|_| invalid("일정 시작 시각 오류"))?
            .timestamp_millis();
        let end = DateTime::parse_from_rfc3339(&string(&item["end"], "dateTime")?)
            .map_err(|_| invalid("일정 종료 시각 오류"))?
            .timestamp_millis();
        if end < start {
            return Err(invalid("일정 종료 시각 오류"));
        }
        event.start_at = Some(start);
        event.end_at = Some(end);
    }
    Ok(event)
}
async fn google_events(
    credential: &Credential,
    now: i64,
) -> Result<Vec<CalendarEvent>, CalendarError> {
    let client = client()?;
    let start = DateTime::<Utc>::from_timestamp_millis(now.saturating_sub(30 * DAY_MS))
        .ok_or_else(|| invalid("조회 시각 오류"))?
        .to_rfc3339();
    let end = DateTime::<Utc>::from_timestamp_millis(now.saturating_add(365 * DAY_MS))
        .ok_or_else(|| invalid("조회 시각 오류"))?
        .to_rfc3339();
    let token = credential
        .access_token
        .as_deref()
        .ok_or_else(|| error("auth-error", "다시 연결해 주세요."))?;
    let mut events = vec![];
    for calendar in &credential.calendar_ids {
        let mut url = reqwest::Url::parse("https://www.googleapis.com/calendar/v3/calendars/")
            .map_err(|_| invalid("API 주소 오류"))?;
        url.path_segments_mut()
            .map_err(|_| invalid("API 주소 오류"))?
            .pop_if_empty()
            .push(calendar)
            .push("events");
        let mut page = None;
        for index in 0..=20 {
            let mut request = client.get(url.clone()).bearer_auth(token).query(&[
                ("singleEvents", "true"),
                ("showDeleted", "true"),
                ("maxResults", "2500"),
                ("timeMin", start.as_str()),
                ("timeMax", end.as_str()),
            ]);
            if let Some(page) = &page {
                request = request.query(&[("pageToken", page)]);
            }
            let result = json_response(
                request
                    .send()
                    .await
                    .map_err(|_| error("offline", "Google Calendar에 연결할 수 없습니다."))?,
            )
            .await?;
            let items = result["items"]
                .as_array()
                .ok_or_else(|| invalid("Google 일정 응답 오류"))?;
            for item in items {
                events.push(google_event(item, &credential.connection_id, calendar)?);
                if events.len() > MAX_EVENTS {
                    return Err(invalid(
                        "조회 일정이 5000개를 넘었습니다. 연결할 캘린더를 줄여 주세요.",
                    ));
                }
            }
            page = result["nextPageToken"].as_str().map(str::to_owned);
            if page.is_none() {
                break;
            }
            if index == 20 {
                return Err(invalid("캘린더 페이지 한도를 넘었습니다."));
            }
        }
    }
    Ok(events)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };
    #[test]
    fn secrets_never_enter_public_connection_or_errors() {
        let connected = connect_ics(IcsConnectInput {
            name: "개인 구독".into(),
            url: "https://example.com/private?secret=token".into(),
        })
        .unwrap();
        let serialized = serde_json::to_string(&connected.connection).unwrap();
        assert!(!serialized.contains("example.com"));
        assert!(!serialized.contains("token"));
        assert!(!serialized.contains("secret"));
        for url in [
            "file:///etc/passwd",
            "https://user:password@example.com/feed",
            "https://example.com/#fragment",
        ] {
            let failure = connect_ics(IcsConnectInput {
                name: "개인".into(),
                url: url.into(),
            })
            .err()
            .unwrap();
            assert!(!failure.message.contains(url));
        }
        assert_eq!(
            subscription_url("webcal://example.com/feed")
                .unwrap()
                .scheme(),
            "https"
        );
    }
    #[test]
    fn refresh_failure_keeps_success_marker_and_stops_after_five_failures() {
        let original = success(&connection("일정".into(), "ics"), 1000);
        let mut current = original.clone();
        for n in 1..=5 {
            current = failed(&current, &error("offline", "연결 실패"), 2000 + n);
            assert_eq!(current.last_success_at, Some(1000));
            assert_eq!(current.failure_count, n as u32);
        }
        assert!(!refresh_due(&current, i64::MAX - 1));
        let recovered = success(&current, 5000);
        assert_eq!(recovered.failure_count, 0);
        assert_eq!(recovered.error, None);
        assert!(refresh_due(&recovered, 5000 + REFRESH_INTERVAL_MS));
    }
    #[test]
    fn google_all_day_cancelled_and_offset_times_are_distinct() {
        let day=google_event(&serde_json::json!({"id":"day","start":{"date":"2026-09-15"},"end":{"date":"2026-09-16"}}),"c","primary").unwrap();
        assert!(day.all_day);
        assert_eq!(day.start_at, None);
        let timed=google_event(&serde_json::json!({"id":"time","start":{"dateTime":"2026-09-15T09:00:00+09:00","timeZone":"Asia/Seoul"},"end":{"dateTime":"2026-09-15T10:00:00+09:00"},"originalStartTime":{"dateTime":"2026-09-15T08:00:00+09:00"},"hangoutLink":"javascript:alert(1)"}),"c","primary").unwrap();
        assert_eq!(
            timed.start_at,
            Some(
                DateTime::parse_from_rfc3339("2026-09-15T00:00:00Z")
                    .unwrap()
                    .timestamp_millis()
            )
        );
        assert!(timed.meeting_url.is_none());
        assert_eq!(timed.occurrence_id, "2026-09-15T08:00:00+09:00");
        let cancelled = google_event(
            &serde_json::json!({"id":"gone","status":"cancelled"}),
            "c",
            "primary",
        )
        .unwrap();
        assert!(cancelled.cancelled);
    }
    #[tokio::test]
    async fn actual_http_subscription_reads_bounded_ics_response() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0u8; 2048];
            assert!(socket.read(&mut request).await.unwrap() > 0);
            let text="BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:hello\r\nDTSTART;VALUE=DATE:20260915\r\nSUMMARY:실제 HTTP\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
            socket
                .write_all(
                    format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{text}",
                        text.len()
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
        });
        let connected = connect_ics(IcsConnectInput {
            name: "구독".into(),
            url: format!("http://{address}/private?secret=hidden"),
        })
        .unwrap();
        let result = refresh_connected(
            &connected,
            DateTime::parse_from_rfc3339("2026-09-15T00:00:00Z")
                .unwrap()
                .timestamp_millis(),
        )
        .await
        .unwrap();
        assert_eq!(result.events[0].title, "실제 HTTP");
        assert!(!serde_json::to_string(&result.events)
            .unwrap()
            .contains("hidden"));
        server.await.unwrap();
    }
    #[tokio::test]
    async fn oversized_http_body_is_rejected_without_secret_url() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0u8; 2048];
            assert!(socket.read(&mut request).await.unwrap() > 0);
            socket
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 99999999\r\nConnection: close\r\n\r\n",
                )
                .await
                .unwrap();
        });
        let connected = connect_ics(IcsConnectInput {
            name: "구독".into(),
            url: format!("http://{address}/private?secret=hidden"),
        })
        .unwrap();
        let failure = refresh_connected(&connected, 0).await.err().unwrap();
        assert!(failure.message.contains("4 MiB"));
        assert!(!failure.message.contains("hidden"));
        server.await.unwrap();
    }
    #[tokio::test]
    async fn stalled_credential_read_times_out_without_blocking_runtime_or_spawning_more() {
        let readers = Arc::new(tokio::sync::Semaphore::new(1));
        let (release, stalled) = std::sync::mpsc::channel();
        let result =
            bounded_credential_read(readers.clone(), Duration::from_millis(30), move || {
                stalled.recv().unwrap();
                Ok("secret late result")
            })
            .await;
        let failure = result.err().unwrap();
        assert_eq!(failure.status, "auth-error");
        assert!(!failure.message.contains("secret"));
        assert_eq!(readers.available_permits(), 0);
        let called = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let second_called = called.clone();
        let result =
            bounded_credential_read(readers.clone(), Duration::from_millis(10), move || {
                second_called.store(true, std::sync::atomic::Ordering::SeqCst);
                Ok(())
            })
            .await;
        assert!(result.is_err());
        assert!(!called.load(std::sync::atomic::Ordering::SeqCst));
        release.send(()).unwrap();
        let result = bounded_credential_read(readers, Duration::from_secs(1), || Ok(42)).await;
        assert_eq!(result.unwrap(), 42);
    }
}
