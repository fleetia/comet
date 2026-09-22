//! Explicitly paired, memory-only connection to the optional Spotify extension.
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::Duration,
};
use tokio::{
    net::{TcpListener, TcpStream},
    sync::{mpsc, oneshot, watch, Semaphore},
    time::{timeout, Instant},
};
use tokio_tungstenite::{
    accept_hdr_async_with_config,
    tungstenite::{
        handshake::server::{ErrorResponse, Request, Response},
        http::StatusCode,
        protocol::WebSocketConfig,
        Message,
    },
};

const PORT: u16 = 18743;
const MAX_MESSAGE: usize = 128 * 1024;
const MAX_PENDING: usize = 8;
const PAIRING_MS: i64 = 180_000;
const REQUEST_MS: i64 = 20_000;
const DISCONNECTED: &str = "Spotify 확장 연결이 끊겼어요. 새 연결 코드로 다시 연결해 주세요.";

struct Pending {
    action: String,
    reply: oneshot::Sender<Result<Value, String>>,
}
#[derive(Default)]
struct Connection {
    sender: Option<mpsc::Sender<Value>>,
    pending: HashMap<String, Pending>,
}
struct Session {
    owner: String,
    code: String,
    expires_at: i64,
    revoked: AtomicBool,
    shutdown: watch::Sender<bool>,
    connection: Mutex<Connection>,
}
static SESSION: OnceLock<Mutex<Option<Arc<Session>>>> = OnceLock::new();
static START: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
fn sessions() -> &'static Mutex<Option<Arc<Session>>> {
    SESSION.get_or_init(|| Mutex::new(None))
}
fn now() -> i64 {
    chrono::Utc::now().timestamp_millis()
}
fn session(owner: &str) -> Option<Arc<Session>> {
    sessions()
        .lock()
        .unwrap()
        .as_ref()
        .filter(|s| s.owner == owner && !s.revoked.load(Ordering::SeqCst))
        .cloned()
}
impl Session {
    fn revoke(&self) {
        self.revoked.store(true, Ordering::SeqCst);
        self.shutdown.send_replace(true);
        let mut connection = self.connection.lock().unwrap();
        connection.sender = None;
        for (_, pending) in connection.pending.drain() {
            let _ = pending.reply.send(Err(DISCONNECTED.into()));
        }
    }
}
/// Call synchronously inside the widget action boundary on disable/remove/configuration changes.
pub fn revoke(owner: &str) {
    if let Some(session) = session(owner) {
        session.revoke();
    }
}
pub fn revoke_all() {
    if let Some(session) = sessions().lock().unwrap().as_ref() {
        session.revoke();
    }
}

pub fn pairing_status(owner: &str) -> Value {
    let Some(session) = session(owner) else {
        return json!({"port":PORT,"code":null,"connected":false,"expiresAt":null,"pairing":false,"enabled":false});
    };
    let connected = session.connection.lock().unwrap().sender.is_some();
    let pairing = !connected && now() < session.expires_at;
    json!({"port":PORT,"code":if pairing {Some(&session.code)}else{None},"connected":connected,"expiresAt":if pairing{Some(session.expires_at)}else{None},"pairing":pairing,"enabled":connected||pairing})
}

/// Starting is an explicit user action. Only one widget can own the bridge.
pub async fn start(owner: &str) -> Result<Value, String> {
    let _start = START.lock().await;
    revoke_all();
    // An old listener observes shutdown before a replacement binds the same port.
    let deadline = Instant::now() + Duration::from_secs(1);
    let listener = loop {
        match TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, PORT)).await {
            Ok(listener) => break listener,
            Err(_) if Instant::now() < deadline => {
                tokio::time::sleep(Duration::from_millis(20)).await
            }
            Err(_) => return Err("로컬 음악 연결 포트 18743을 사용할 수 없어요.".into()),
        }
    };
    let (shutdown, _) = watch::channel(false);
    let session = Arc::new(Session {
        owner: owner.into(),
        code: uuid::Uuid::new_v4().simple().to_string(),
        expires_at: now() + PAIRING_MS,
        revoked: AtomicBool::new(false),
        shutdown,
        connection: Mutex::new(Connection::default()),
    });
    *sessions().lock().unwrap() = Some(session.clone());
    tokio::spawn(listen(listener, session));
    Ok(pairing_status(owner))
}

async fn listen(listener: TcpListener, session: Arc<Session>) {
    let mut shutdown = session.shutdown.subscribe();
    let attempts = Arc::new(Semaphore::new(4));
    loop {
        if *shutdown.borrow() {
            break;
        }
        tokio::select! {
            _ = shutdown.changed() => break,
            _ = tokio::time::sleep(Duration::from_secs(1)) => {
                if now() >= session.expires_at && session.connection.lock().unwrap().sender.is_none() {session.revoke();break;}
            },
            accepted = listener.accept() => {
                let Ok((stream, address)) = accepted else { break; };
                if !address.ip().is_loopback() {continue;}
                let Ok(permit) = attempts.clone().try_acquire_owned() else {continue;};
                let session = session.clone();
                tokio::spawn(async move {let _permit = permit; serve(stream, session).await;});
            }
        }
    }
}

#[allow(clippy::result_large_err)] // Tungstenite requires an HTTP response as the callback error.
fn check_upgrade(request: &Request, response: Response) -> Result<Response, ErrorResponse> {
    let header = |name: &str| request.headers().get(name).and_then(|v| v.to_str().ok());
    if request.uri().path() != "/comet/v1"
        || request.uri().query().is_some()
        || header("host") != Some("127.0.0.1:18743")
        || header("origin") != Some("https://xpui.app.spotify.com")
    {
        let mut error = ErrorResponse::new(Some("Unsupported music bridge client".into()));
        *error.status_mut() = StatusCode::FORBIDDEN;
        return Err(error);
    }
    Ok(response)
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Hello {
    #[serde(rename = "type")]
    kind: String,
    version: u32,
    code: String,
}
fn authenticates(text: &str, session: &Session) -> bool {
    let Ok(hello) = serde_json::from_str::<Hello>(text) else {
        return false;
    };
    if hello.kind != "hello"
        || hello.version != 1
        || hello.code.len() != session.code.len()
        || now() >= session.expires_at
        || session.revoked.load(Ordering::SeqCst)
    {
        return false;
    }
    hello
        .code
        .bytes()
        .zip(session.code.bytes())
        .fold(0u8, |difference, (a, b)| difference | (a ^ b))
        == 0
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Reply {
    #[serde(rename = "type")]
    kind: String,
    id: String,
    ok: bool,
    #[serde(default)]
    value: Value,
    #[serde(default)]
    error: Option<String>,
}

async fn serve(stream: TcpStream, session: Arc<Session>) {
    let config = WebSocketConfig::default()
        .max_message_size(Some(MAX_MESSAGE))
        .max_frame_size(Some(MAX_MESSAGE))
        .max_write_buffer_size(MAX_MESSAGE * 2);
    let mut shutdown = session.shutdown.subscribe();
    let accepted = tokio::select! {
        _ = shutdown.changed() => return,
        result = timeout(Duration::from_secs(3), accept_hdr_async_with_config(stream, check_upgrade, Some(config))) => result,
    };
    let Ok(Ok(mut socket)) = accepted else {
        return;
    };
    let hello = tokio::select! {_ = shutdown.changed() => return, value = timeout(Duration::from_secs(3),socket.next())=>value};
    let Ok(Some(Ok(Message::Text(hello)))) = hello else {
        return;
    };
    if !authenticates(&hello, &session) {
        return;
    }
    let (sender, mut receiver) = mpsc::channel(MAX_PENDING * 2);
    {
        let mut connection = session.connection.lock().unwrap();
        if session.revoked.load(Ordering::SeqCst) || connection.sender.is_some() {
            return;
        }
        connection.sender = Some(sender);
    }
    if socket
        .send(Message::Text(
            json!({"type":"ready","version":1}).to_string().into(),
        ))
        .await
        .is_err()
    {
        session.revoke();
        return;
    }
    let mut heartbeat = tokio::time::interval(Duration::from_secs(5));
    let mut last_seen = Instant::now();
    loop {
        if session.revoked.load(Ordering::SeqCst) {
            break;
        }
        tokio::select! {
            biased;
            _ = shutdown.changed() => break,
            _ = heartbeat.tick() => {
                if last_seen.elapsed()>Duration::from_secs(15) {break;}
                if socket.send(Message::Ping(Vec::new().into())).await.is_err() {break;}
            },
            outgoing = receiver.recv() => {
                let Some(outgoing) = outgoing else {break;};
                if outgoing["type"] == "request" {
                    let Some(id) = outgoing["id"].as_str() else {continue;};
                    if outgoing["expiresAt"].as_i64().unwrap_or(0) <= now() || !session.connection.lock().unwrap().pending.contains_key(id) {continue;}
                }
                if socket.send(Message::Text(outgoing.to_string().into())).await.is_err() {break;}
            },
            incoming = socket.next() => {
                last_seen=Instant::now();
                match incoming {
                    Some(Ok(Message::Text(text))) => {
                        let Ok(reply) = serde_json::from_str::<Reply>(&text) else {break;};
                        if reply.kind!="response" || reply.id.len()>64 {break;}
                        let pending = session.connection.lock().unwrap().pending.remove(&reply.id);
                        if let Some(pending)=pending {
                            let result=if reply.ok {sanitize_reply(&pending.action,reply.value)} else {Err(match reply.error.as_deref(){Some("expired")=>"음악 요청이 만료됐어요.",Some("unsupported")=>"이 Spotify 버전에서 지원하지 않는 기능이에요.",Some("empty")=>"재생할 수 있는 곡이 없어요.",_=>"Spotify가 음악 요청을 완료하지 못했어요."}.into())};
                            let _=pending.reply.send(result);
                        }
                    },
                    Some(Ok(Message::Ping(bytes)))=>{if socket.send(Message::Pong(bytes)).await.is_err(){break;}},
                    Some(Ok(Message::Pong(_)))=>{},
                    _=>break,
                }
            }
        }
    }
    session.revoke();
    let _ = timeout(Duration::from_millis(200), socket.close(None)).await;
}

fn spotify_uri(value: &Value, kind: &str) -> bool {
    let Some(uri) = value.as_str() else {
        return false;
    };
    let Some(id) = uri.strip_prefix(&format!("spotify:{kind}:")) else {
        return false;
    };
    id.len() == 22 && id.bytes().all(|c| c.is_ascii_alphanumeric())
}
fn object_keys(value: &Value, allowed: &[&str]) -> bool {
    value
        .as_object()
        .is_some_and(|v| v.keys().all(|key| allowed.contains(&key.as_str())))
}
fn valid_action(action: &str, value: &Value) -> bool {
    match action {
        "observe" | "play" | "pause" | "next" | "previous" | "queue" => value.is_null(),
        "playlists" => {
            value.is_null()
                || (object_keys(value, &["offset"])
                    && value["offset"].as_u64().is_some_and(|v| v <= 10_000))
        }
        "seek" => value
            .as_f64()
            .is_some_and(|v| v.is_finite() && (0.0..=86_400_000.0).contains(&v)),
        "volume" => value
            .as_f64()
            .is_some_and(|v| v.is_finite() && (0.0..=100.0).contains(&v)),
        "shuffle" => value.is_boolean(),
        "repeat" => matches!(value.as_str(), Some("off" | "all" | "one")),
        "playlistTracks" => {
            object_keys(value, &["uri", "offset"])
                && spotify_uri(&value["uri"], "playlist")
                && (value["offset"].is_null()
                    || value["offset"].as_u64().is_some_and(|v| v <= 10_000))
        }
        "playRandom" => object_keys(value, &["uri"]) && spotify_uri(&value["uri"], "playlist"),
        "playUri" | "enqueue" => {
            object_keys(value, &["uri"])
                && (spotify_uri(&value["uri"], "track") || spotify_uri(&value["uri"], "episode"))
        }
        "like" => {
            object_keys(value, &["uri", "liked"])
                && spotify_uri(&value["uri"], "track")
                && value["liked"].is_boolean()
        }
        _ => false,
    }
}

struct RequestGuard {
    session: Arc<Session>,
    id: String,
}
impl Drop for RequestGuard {
    fn drop(&mut self) {
        let must_revoke = {
            let mut connection = self.session.connection.lock().unwrap();
            if connection.pending.remove(&self.id).is_some() {
                connection.sender.as_ref().is_some_and(|sender| {
                    sender
                        .try_send(json!({"type":"cancel","id":self.id}))
                        .is_err()
                })
            } else {
                false
            }
        };
        if must_revoke {
            self.session.revoke();
        }
    }
}
pub async fn request(owner: &str, action: &str, value: Value) -> Result<Value, String> {
    request_with_timeout(owner, action, value, REQUEST_MS).await
}
async fn request_with_timeout(
    owner: &str,
    action: &str,
    value: Value,
    timeout_ms: i64,
) -> Result<Value, String> {
    if !valid_action(action, &value) {
        return Err("지원하지 않거나 올바르지 않은 음악 요청이에요.".into());
    }
    let session = session(owner).ok_or(DISCONNECTED)?;
    let id = uuid::Uuid::new_v4().simple().to_string();
    let (reply, receiver) = oneshot::channel();
    {
        let mut connection = session.connection.lock().unwrap();
        if session.revoked.load(Ordering::SeqCst) {
            return Err(DISCONNECTED.into());
        }
        if connection.pending.len() >= MAX_PENDING {
            return Err("이전 음악 요청이 끝난 뒤 다시 시도해 주세요.".into());
        }
        let sender = connection.sender.clone().ok_or(DISCONNECTED)?;
        connection.pending.insert(
            id.clone(),
            Pending {
                action: action.into(),
                reply,
            },
        );
        if sender.try_send(json!({"type":"request","id":id,"action":action,"value":value,"expiresAt":now()+timeout_ms})).is_err(){connection.pending.remove(&id);return Err(DISCONNECTED.into());}
    }
    let _guard = RequestGuard {
        session: session.clone(),
        id,
    };
    let reply = timeout(Duration::from_millis(timeout_ms as u64), receiver)
        .await
        .map_err(|_| "음악 요청이 만료됐어요.".to_string())?
        .map_err(|_| DISCONNECTED.to_string())??;
    if session.revoked.load(Ordering::SeqCst) {
        return Err(DISCONNECTED.into());
    }
    Ok(reply)
}

fn short_text(value: &Value, max: usize) -> Value {
    value
        .as_str()
        .filter(|s| {
            s.chars().count() <= max && !s.chars().any(|c| c.is_control() && c != '\n' && c != '\t')
        })
        .map_or(Value::Null, |s| json!(s))
}
fn safe_art(value: &Value) -> Value {
    let Some(value) = value.as_str() else {
        return Value::Null;
    };
    if value.len() <= 2048
        && value.starts_with("https://i.scdn.co/image/")
        && value[24..].bytes().all(|c| c.is_ascii_hexdigit())
    {
        json!(value)
    } else {
        Value::Null
    }
}
fn sanitize_reply(action: &str, value: Value) -> Result<Value, String> {
    if !value.is_object() {
        return Err("Spotify 응답을 읽지 못했어요.".into());
    }
    if action == "observe" {
        let playing = value["playing"]
            .as_bool()
            .ok_or("Spotify 재생 상태를 읽지 못했어요.")?;
        let mut output = json!({"provider":"spicetify","source":"Spotify · Spicetify","sourceId":"com.spotify.client","running":true,"playing":playing,"playbackState":if playing{"playing"}else if value["title"].is_string(){"paused"}else{"stopped"},"observedAt":now(),"capabilities":{}});
        for name in [
            "title",
            "artist",
            "album",
            "albumArtist",
            "trackId",
            "genre",
            "contentType",
            "contextUri",
        ] {
            output[name] = short_text(&value[name], 1000);
        }
        output["artworkUrl"] = safe_art(&value["artworkUrl"]);
        output["lyrics"] = short_text(&value["lyrics"], 32_000);
        output["description"] = short_text(&value["description"], 8_000);
        for name in ["durationMs", "positionMs", "trackNumber", "discNumber"] {
            output[name] = value[name]
                .as_f64()
                .filter(|n| n.is_finite() && (0.0..=86_400_000.0).contains(n))
                .map_or(Value::Null, |n| json!(n));
        }
        output["volume"] = value["volume"]
            .as_f64()
            .filter(|n| n.is_finite() && (0.0..=100.0).contains(n))
            .map_or(Value::Null, |n| json!(n));
        for name in ["shuffle", "liked", "explicit"] {
            output[name] = value[name].as_bool().map_or(Value::Null, |v| json!(v));
        }
        output["repeat"] = if matches!(value["repeat"].as_str(), Some("off" | "all" | "one")) {
            value["repeat"].clone()
        } else {
            Value::Null
        };
        for name in [
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
        ] {
            output["capabilities"][name] =
                json!(value["capabilities"][name].as_bool().unwrap_or(false));
        }
        output["metadata"] = json!({});
        for name in [
            "albumArtist",
            "genre",
            "contentType",
            "description",
            "trackNumber",
            "discNumber",
            "explicit",
        ] {
            output["metadata"][name] = output[name].clone();
        }
        return Ok(output);
    }
    if matches!(action, "playlists" | "playlistTracks" | "queue") {
        let items = value["items"]
            .as_array()
            .filter(|items| items.len() <= 100)
            .ok_or("Spotify 목록을 읽지 못했어요.")?;
        let mut result = Vec::new();
        for item in items {
            if !(spotify_uri(&item["uri"], "playlist")
                || spotify_uri(&item["uri"], "track")
                || spotify_uri(&item["uri"], "episode"))
            {
                continue;
            }
            result.push(json!({"uri":item["uri"],"title":short_text(&item["title"],1000),"artist":short_text(&item["artist"],1000),"album":short_text(&item["album"],1000)}));
        }
        return Ok(
            json!({"items":result,"total":value["total"].as_u64().filter(|n|*n<=100_000),"nextOffset":value["nextOffset"].as_u64().filter(|n|*n<=10_000)}),
        );
    }
    Ok(json!({"ok":true}))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio_tungstenite::{
        client_async, tungstenite::client::IntoClientRequest, WebSocketStream,
    };

    fn upgrade(origin: &str, host: &str) -> Request {
        Request::builder()
            .uri("/comet/v1")
            .header("Origin", origin)
            .header("Host", host)
            .body(())
            .unwrap()
    }
    #[test]
    fn rejects_cross_origin_or_rebound_host_and_arbitrary_commands() {
        assert!(check_upgrade(
            &upgrade("https://evil.example", "127.0.0.1:18743"),
            Response::new(())
        )
        .is_err());
        assert!(check_upgrade(
            &upgrade("https://xpui.app.spotify.com", "evil.example:18743"),
            Response::new(())
        )
        .is_err());
        assert!(check_upgrade(&upgrade("null", "127.0.0.1:18743"), Response::new(())).is_err());
        assert!(check_upgrade(
            &upgrade("https://xpui.app.spotify.com", "127.0.0.1:18743"),
            Response::new(())
        )
        .is_ok());
        assert!(!valid_action("eval", &json!("alert(1)")));
        assert!(!valid_action("seek", &json!(-1)));
        assert!(!valid_action(
            "playUri",
            &json!({"uri":"https://example.com"})
        ));
        assert!(!valid_action(
            "like",
            &json!({"uri":"spotify:track:0000000000000000000000","liked":true,"token":"secret"})
        ));
    }
    #[test]
    fn response_does_not_expose_unlisted_fields_or_unsafe_artwork() {
        let result=sanitize_reply("observe",json!({"playing":false,"title":"Paused song","volume":0,"liked":false,"artworkUrl":"http://127.0.0.1/private","token":"secret","capabilities":{"play":true,"eval":true}})).unwrap();
        assert_eq!(result["playbackState"], "paused");
        assert_eq!(result["volume"], 0.0);
        assert_eq!(result["liked"], false);
        assert!(result.get("token").is_none());
        assert!(result["artworkUrl"].is_null());
        assert!(result["capabilities"].get("eval").is_none());
        let capable = sanitize_reply("observe", json!({"playing":false,"capabilities":{"playlistTracks":true,"enqueue":true,"queue":false}})).unwrap();
        assert_eq!(capable["capabilities"]["playlistTracks"], true);
        assert_eq!(capable["capabilities"]["enqueue"], true);
        assert_eq!(capable["capabilities"]["queue"], false);
        assert_eq!(
            safe_art(&json!("https://i.scdn.co/image/012abc")),
            json!("https://i.scdn.co/image/012abc")
        );
        assert!(sanitize_reply("queue", json!({"items":vec![json!({});101]})).is_err());
    }
    async fn client(code: &str) -> WebSocketStream<TcpStream> {
        let stream = TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, PORT))
            .await
            .unwrap();
        let mut request = "ws://127.0.0.1:18743/comet/v1"
            .into_client_request()
            .unwrap();
        request
            .headers_mut()
            .insert("Origin", "https://xpui.app.spotify.com".parse().unwrap());
        let (mut client, _) = client_async(request, stream).await.unwrap();
        client
            .send(Message::Text(
                json!({"type":"hello","version":1,"code":code})
                    .to_string()
                    .into(),
            ))
            .await
            .unwrap();
        client
    }
    async fn text_frame(client: &mut WebSocketStream<TcpStream>) -> Value {
        loop {
            match timeout(Duration::from_secs(2), client.next())
                .await
                .unwrap()
                .unwrap()
                .unwrap()
            {
                Message::Text(text) => return serde_json::from_str(&text).unwrap(),
                Message::Ping(bytes) => client.send(Message::Pong(bytes)).await.unwrap(),
                other => panic!("Unexpected frame: {other:?}"),
            }
        }
    }
    #[tokio::test]
    async fn pairing_requests_timeout_cancellation_and_revocation_are_session_scoped() {
        let owner = "music-bridge-test";
        let status = start(owner).await.unwrap();
        let code = status["code"].as_str().unwrap();
        assert!(pairing_status("another-widget")["code"].is_null());
        let mut rejected = client("00000000000000000000000000000000").await;
        assert!(timeout(Duration::from_secs(2), rejected.next())
            .await
            .unwrap()
            .is_none_or(|v| v.is_err()));
        let mut client = client(code).await;
        assert_eq!(text_frame(&mut client).await["type"], "ready");
        assert_eq!(pairing_status(owner)["connected"], true);
        assert!(pairing_status(owner)["code"].is_null());
        let work = tokio::spawn(request(owner, "observe", Value::Null));
        let message = text_frame(&mut client).await;
        client.send(Message::Text(json!({"type":"response","id":message["id"],"ok":true,"value":{"playing":true,"title":"Song","token":"not forwarded"}}).to_string().into())).await.unwrap();
        let observation = work.await.unwrap().unwrap();
        assert_eq!(observation["title"], "Song");
        assert!(observation.get("token").is_none());
        let work = tokio::spawn(request_with_timeout(owner, "next", Value::Null, 50));
        let message = text_frame(&mut client).await;
        assert!(work.await.unwrap().unwrap_err().contains("만료"));
        let canceled = text_frame(&mut client).await;
        assert_eq!(canceled, json!({"type":"cancel","id":message["id"]}));
        let work = tokio::spawn(request(
            owner,
            "playRandom",
            json!({"uri":"spotify:playlist:0000000000000000000000"}),
        ));
        let message = text_frame(&mut client).await;
        work.abort();
        let _ = work.await;
        assert_eq!(
            text_frame(&mut client).await,
            json!({"type":"cancel","id":message["id"]})
        );
        let mut pending = Vec::new();
        for _ in 0..MAX_PENDING {
            pending.push(tokio::spawn(request(owner, "observe", Value::Null)));
            text_frame(&mut client).await;
        }
        assert!(request(owner, "observe", Value::Null)
            .await
            .unwrap_err()
            .contains("이전 음악 요청"));
        revoke(owner);
        for work in pending {
            assert!(work.await.unwrap().is_err());
        }
        assert_eq!(pairing_status(owner)["enabled"], false);
        assert!(request(owner, "play", Value::Null).await.is_err());
        let new_status = start(owner).await.unwrap();
        assert_ne!(new_status["code"], status["code"]);
        assert!(!authenticates(
            &json!({"type":"hello","version":1,"code":code}).to_string(),
            &session(owner).unwrap()
        ));
        revoke(owner);
    }
}
