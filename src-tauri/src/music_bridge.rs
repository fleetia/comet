//! Explicit pairing and remembered local connections to the optional Spotify extension.
mod credentials;

use aes_gcm::aead::{rand_core::RngCore, OsRng};
use futures_util::{SinkExt, StreamExt};
use hmac::{Hmac, Mac};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::Sha256;
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
const DISCONNECTED: &str =
    "Spotify 연결을 기다리고 있어요. 처음 연결하거나 연결을 해제했다면 설정에서 페어링해 주세요.";

struct Pending {
    action: String,
    reply: oneshot::Sender<Result<Value, String>>,
}
#[derive(Default)]
struct Connection {
    generation: u64,
    stop: Option<watch::Sender<bool>>,
    sender: Option<mpsc::Sender<Value>>,
    pending: HashMap<String, Pending>,
}
struct Authentication {
    code: Option<String>,
    secret: Option<String>,
}
struct Session {
    owner: String,
    pairing_id: String,
    expires_at: i64,
    authentication: Mutex<Authentication>,
    revoked: AtomicBool,
    forgotten: AtomicBool,
    cancel: Arc<AtomicBool>,
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
        .filter(|s| s.owner == owner && !s.stopped())
        .cloned()
}
impl Session {
    fn stopped(&self) -> bool {
        self.revoked.load(Ordering::SeqCst) || self.cancel.load(Ordering::SeqCst)
    }
    fn disconnect_transport(&self, generation: u64) {
        let mut connection = self.connection.lock().unwrap();
        if connection.generation != generation {
            return;
        }
        if let Some(stop) = connection.stop.take() {
            stop.send_replace(true);
        }
        connection.sender = None;
        for (_, pending) in connection.pending.drain() {
            let _ = pending.reply.send(Err(DISCONNECTED.into()));
        }
    }
    fn revoke(&self) {
        self.revoked.store(true, Ordering::SeqCst);
        self.shutdown.send_replace(true);
        let generation = self.connection.lock().unwrap().generation;
        self.disconnect_transport(generation);
    }
}
/// Runtime suspension preserves the remembered identity for the next app launch.
pub fn revoke(owner: &str) {
    if let Some(session) = session(owner) {
        session.revoke();
    }
}
pub fn revoke_pairing(owner: &str, pairing_id: &str) {
    if let Some(session) = session(owner).filter(|s| s.pairing_id == pairing_id) {
        session.revoke();
    }
}
pub fn revoke_all() {
    if let Some(session) = sessions().lock().unwrap().as_ref() {
        session.revoke();
    }
}
/// Call after removing the authoritative widget marker; deletion failure cannot restore it.
pub fn forget(owner: &str, pairing_id: &str) -> Result<(), String> {
    if let Some(session) = sessions()
        .lock()
        .unwrap()
        .as_ref()
        .filter(|s| s.owner == owner && s.pairing_id == pairing_id)
        .cloned()
    {
        session.forgotten.store(true, Ordering::SeqCst);
        session.revoke();
    }
    credentials::delete(owner, pairing_id)
}

pub fn pairing_status(owner: &str) -> Value {
    let Some(session) = session(owner) else {
        return json!({"port":PORT,"code":null,"connected":false,"expiresAt":null,"pairing":false,"enabled":false,"remembered":false});
    };
    let connected = session.connection.lock().unwrap().sender.is_some();
    let authentication = session.authentication.lock().unwrap();
    let pairing = authentication.code.is_some() && now() < session.expires_at;
    let remembered = authentication.secret.is_some();
    json!({"port":PORT,"code":if pairing {authentication.code.as_ref()}else{None},"connected":connected,"expiresAt":if pairing{Some(session.expires_at)}else{None},"pairing":pairing,"enabled":connected||pairing||remembered,"remembered":remembered})
}
fn is_hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}
fn random_hex(bytes: usize) -> Result<String, String> {
    let mut value = vec![0; bytes];
    OsRng
        .try_fill_bytes(&mut value)
        .map_err(|_| "음악 연결용 난수를 만들지 못했어요.")?;
    Ok(hex::encode(value))
}
fn validate_identity(owner: &str, pairing_id: &str) -> Result<(), String> {
    uuid::Uuid::parse_str(owner).map_err(|_| "음악 위젯 식별자가 올바르지 않아요.")?;
    uuid::Uuid::parse_str(pairing_id).map_err(|_| "음악 연결 식별자가 올바르지 않아요.")?;
    Ok(())
}
async fn bind_session(
    owner: &str,
    pairing_id: &str,
    authentication: Authentication,
    cancel: Arc<AtomicBool>,
) -> Result<Value, String> {
    validate_identity(owner, pairing_id)?;
    if cancel.load(Ordering::SeqCst) {
        return Err("음악 연결 준비를 취소했어요.".into());
    }
    revoke_all();
    let deadline = Instant::now() + Duration::from_secs(1);
    let listener = loop {
        if cancel.load(Ordering::SeqCst) {
            return Err("음악 연결 준비를 취소했어요.".into());
        }
        match TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, PORT)).await {
            Ok(listener) => break listener,
            Err(_) if Instant::now() < deadline => {
                tokio::time::sleep(Duration::from_millis(20)).await
            }
            Err(_) => return Err("로컬 음악 연결 포트 18743을 사용할 수 없어요.".into()),
        }
    };
    if cancel.load(Ordering::SeqCst) {
        return Err("음악 연결 준비를 취소했어요.".into());
    }
    let (shutdown, _) = watch::channel(false);
    let session = Arc::new(Session {
        owner: owner.into(),
        pairing_id: pairing_id.into(),
        expires_at: now() + PAIRING_MS,
        authentication: Mutex::new(authentication),
        revoked: AtomicBool::new(false),
        forgotten: AtomicBool::new(false),
        cancel,
        shutdown,
        connection: Mutex::new(Connection::default()),
    });
    *sessions().lock().unwrap() = Some(session.clone());
    tokio::spawn(listen(listener, session));
    Ok(pairing_status(owner))
}
/// The caller reserves a fresh pairing ID inside the widget action boundary.
pub async fn start(
    owner: &str,
    pairing_id: &str,
    cancel: Arc<AtomicBool>,
) -> Result<Value, String> {
    let _start = START.lock().await;
    bind_session(
        owner,
        pairing_id,
        Authentication {
            code: Some(random_hex(16)?),
            secret: None,
        },
        cancel,
    )
    .await
}
/// Restore only an ID still referenced by an installed, enabled Spotify widget.
pub async fn resume(
    owner: &str,
    pairing_id: &str,
    cancel: Arc<AtomicBool>,
) -> Result<Value, String> {
    let _start = START.lock().await;
    validate_identity(owner, pairing_id)?;
    if let Some(current) = session(owner).filter(|s| s.pairing_id == pairing_id) {
        return Ok(pairing_status(&current.owner));
    }
    if sessions()
        .lock()
        .unwrap()
        .as_ref()
        .is_some_and(|s| !s.stopped())
    {
        return Err("다른 음악 위젯이 Spotify 연결을 사용하고 있어요.".into());
    }
    let owner_for_store = owner.to_string();
    let id_for_store = pairing_id.to_string();
    let credential = timeout(
        Duration::from_secs(5),
        tokio::task::spawn_blocking(move || credentials::load(&owner_for_store, &id_for_store)),
    )
    .await
    .map_err(|_| "저장된 음악 연결을 읽는 시간이 초과됐어요.")?
    .map_err(|_| "저장된 음악 연결을 읽지 못했어요.")??
    .ok_or("저장된 음악 연결이 없어요. 설정에서 한 번 페어링해 주세요.")?;
    bind_session(
        owner,
        pairing_id,
        Authentication {
            code: None,
            secret: Some(credential.secret),
        },
        cancel,
    )
    .await
}

async fn listen(listener: TcpListener, session: Arc<Session>) {
    let mut shutdown = session.shutdown.subscribe();
    let attempts = Arc::new(Semaphore::new(4));
    loop {
        if session.stopped() || *shutdown.borrow() {
            session.revoke();
            break;
        }
        tokio::select! {
            _ = shutdown.changed() => break,
            _ = tokio::time::sleep(Duration::from_secs(1)) => {
                if now() >= session.expires_at && session.authentication.lock().unwrap().secret.is_none() {session.revoke();break;}
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

#[allow(clippy::result_large_err)]
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
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Hello {
    #[serde(rename = "type")]
    kind: String,
    version: u32,
    mode: String,
    client_nonce: String,
    pairing_id: Option<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Proof {
    #[serde(rename = "type")]
    kind: String,
    proof: String,
}
fn proof_mac(
    key: &str,
    role: &str,
    mode: &str,
    pairing_id: &str,
    client_nonce: &str,
    server_nonce: &str,
) -> Option<Hmac<Sha256>> {
    let key = hex::decode(key).ok()?;
    let mut mac = Hmac::<Sha256>::new_from_slice(&key).ok()?;
    mac.update(
        format!("comet:music:v2:{role}:{mode}:{pairing_id}:{client_nonce}:{server_nonce}")
            .as_bytes(),
    );
    Some(mac)
}
fn proof_hex(
    key: &str,
    role: &str,
    mode: &str,
    pairing_id: &str,
    client_nonce: &str,
    server_nonce: &str,
) -> Option<String> {
    Some(hex::encode(
        proof_mac(key, role, mode, pairing_id, client_nonce, server_nonce)?
            .finalize()
            .into_bytes(),
    ))
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
    let Ok(hello) = serde_json::from_str::<Hello>(&hello) else {
        return;
    };
    if hello.kind != "hello"
        || hello.version != 2
        || !is_hex(&hello.client_nonce, 64)
        || session.stopped()
    {
        return;
    }
    let key = {
        let authentication = session.authentication.lock().unwrap();
        match hello.mode.as_str() {
            "pair" if hello.pairing_id.is_none() && now() < session.expires_at => {
                authentication.code.clone()
            }
            "resume" if hello.pairing_id.as_deref() == Some(&session.pairing_id) => {
                authentication.secret.clone()
            }
            _ => None,
        }
    };
    let Some(key) = key else {
        return;
    };
    let Ok(server_nonce) = random_hex(32) else {
        return;
    };
    let Some(proof) = proof_hex(
        &key,
        "server",
        &hello.mode,
        &session.pairing_id,
        &hello.client_nonce,
        &server_nonce,
    ) else {
        return;
    };
    if socket.send(Message::Text(json!({"type":"challenge","version":2,"pairingId":session.pairing_id,"serverNonce":server_nonce,"proof":proof}).to_string().into())).await.is_err() {return;}
    let response = tokio::select! {_ = shutdown.changed() => return, value = timeout(Duration::from_secs(3),socket.next())=>value};
    let Ok(Some(Ok(Message::Text(response)))) = response else {
        return;
    };
    let Ok(response) = serde_json::from_str::<Proof>(&response) else {
        return;
    };
    if response.kind != "authenticate" || !is_hex(&response.proof, 64) || session.stopped() {
        return;
    }
    let Some(mac) = proof_mac(
        &key,
        "client",
        &hello.mode,
        &session.pairing_id,
        &hello.client_nonce,
        &server_nonce,
    ) else {
        return;
    };
    if mac
        .verify_slice(&hex::decode(&response.proof).unwrap_or_default())
        .is_err()
    {
        return;
    }
    let credential = if hello.mode == "pair" {
        let session_for_store = session.clone();
        let stored = tokio::task::spawn_blocking(move || {
            {
                let mut authentication = session_for_store.authentication.lock().unwrap();
                if session_for_store.stopped()
                    || authentication.code.is_none()
                    || now() >= session_for_store.expires_at
                {
                    return Err("페어링이 만료됐어요.".to_string());
                }
                // Consume once, without blocking status reads on a possible OS credential dialog.
                authentication.code = None;
            }
            let secret = random_hex(32)?;
            credentials::save(
                &session_for_store.owner,
                &session_for_store.pairing_id,
                &secret,
                || !session_for_store.stopped(),
            )?;
            if session_for_store.stopped() {
                return Err(DISCONNECTED.into());
            }
            let mut authentication = session_for_store.authentication.lock().unwrap();
            authentication.secret = Some(secret.clone());
            Ok(json!({"id":session_for_store.pairing_id,"secret":secret}))
        })
        .await;
        let Ok(Ok(credential)) = stored else {
            return;
        };
        Some(credential)
    } else {
        None
    };
    let (sender, mut receiver) = mpsc::channel(MAX_PENDING * 2);
    let (stop, mut disconnected) = watch::channel(false);
    let generation = {
        let mut connection = session.connection.lock().unwrap();
        if session.stopped() || connection.sender.is_some() {
            return;
        }
        connection.generation = connection.generation.wrapping_add(1);
        connection.sender = Some(sender);
        connection.stop = Some(stop);
        connection.generation
    };
    let ready = if let Some(credential) = credential {
        json!({"type":"ready","version":2,"credential":credential})
    } else {
        json!({"type":"ready","version":2})
    };
    if socket
        .send(Message::Text(ready.to_string().into()))
        .await
        .is_err()
    {
        session.disconnect_transport(generation);
        return;
    }
    let mut heartbeat = tokio::time::interval(Duration::from_secs(5));
    let mut last_seen = Instant::now();
    loop {
        if session.stopped() {
            break;
        }
        tokio::select! {
            biased;
            _ = shutdown.changed() => break,
            _ = disconnected.changed() => break,
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
                        if text == "{\"type\":\"disconnect\"}" || serde_json::from_str::<Value>(&text).is_ok_and(|value| value == json!({"type":"disconnect"})) {
                            // The extension retains a pending revoke until this persistent deletion succeeds.
                            let owner = session.owner.clone(); let pairing_id = session.pairing_id.clone();
                            let deleted = tokio::task::spawn_blocking(move || credentials::delete(&owner, &pairing_id)).await;
                            if matches!(deleted, Ok(Ok(()))) {
                                session.forgotten.store(true, Ordering::SeqCst);
                                session.revoke();
                                let _ = socket.send(Message::Text(json!({"type":"disconnected","version":2}).to_string().into())).await;
                            }
                            break;
                        }
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
    session.disconnect_transport(generation);
    if session.forgotten.load(Ordering::SeqCst) {
        let _ = timeout(
            Duration::from_millis(200),
            socket.send(Message::Text(
                json!({"type":"revoked","version":2}).to_string().into(),
            )),
        )
        .await;
    }
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
    generation: u64,
}
impl Drop for RequestGuard {
    fn drop(&mut self) {
        let must_disconnect = {
            let mut connection = self.session.connection.lock().unwrap();
            if connection.generation == self.generation
                && connection.pending.remove(&self.id).is_some()
            {
                connection.sender.as_ref().is_some_and(|sender| {
                    sender
                        .try_send(json!({"type":"cancel","id":self.id}))
                        .is_err()
                })
            } else {
                false
            }
        };
        if must_disconnect {
            self.session.disconnect_transport(self.generation);
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
    let generation = {
        let mut connection = session.connection.lock().unwrap();
        if session.stopped() {
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
        connection.generation
    };
    let _guard = RequestGuard {
        session: session.clone(),
        id,
        generation,
    };
    let reply = timeout(Duration::from_millis(timeout_ms as u64), receiver)
        .await
        .map_err(|_| "음악 요청이 만료됐어요.".to_string())?
        .map_err(|_| DISCONNECTED.to_string())??;
    if session.stopped() || session.connection.lock().unwrap().generation != generation {
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
    type Client = WebSocketStream<TcpStream>;
    async fn socket() -> Client {
        let stream = TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, PORT))
            .await
            .unwrap();
        let mut request = "ws://127.0.0.1:18743/comet/v1"
            .into_client_request()
            .unwrap();
        request
            .headers_mut()
            .insert("Origin", "https://xpui.app.spotify.com".parse().unwrap());
        client_async(request, stream).await.unwrap().0
    }
    async fn text_frame(client: &mut Client) -> Value {
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
    async fn begin_handshake(mode: &str, pairing_id: &str, client_nonce: &str) -> (Client, Value) {
        let mut client = socket().await;
        let mut hello = json!({"type":"hello","version":2,"mode":mode,"clientNonce":client_nonce});
        if mode == "resume" {
            hello["pairingId"] = json!(pairing_id);
        }
        client
            .send(Message::Text(hello.to_string().into()))
            .await
            .unwrap();
        let challenge = text_frame(&mut client).await;
        assert_eq!(challenge["type"], "challenge");
        assert_eq!(challenge["pairingId"], pairing_id);
        (client, challenge)
    }
    async fn client(mode: &str, pairing_id: &str, key: &str) -> (Client, Value) {
        let client_nonce = random_hex(32).unwrap();
        let (mut client, challenge) = begin_handshake(mode, pairing_id, &client_nonce).await;
        let server_nonce = challenge["serverNonce"].as_str().unwrap();
        assert_eq!(
            challenge["proof"],
            proof_hex(key, "server", mode, pairing_id, &client_nonce, server_nonce).unwrap()
        );
        let proof =
            proof_hex(key, "client", mode, pairing_id, &client_nonce, server_nonce).unwrap();
        client
            .send(Message::Text(
                json!({"type":"authenticate","proof":proof})
                    .to_string()
                    .into(),
            ))
            .await
            .unwrap();
        let ready = text_frame(&mut client).await;
        assert_eq!(ready["type"], "ready");
        (client, ready)
    }
    async fn disconnected(owner: &str) {
        timeout(Duration::from_secs(2), async {
            while pairing_status(owner)["connected"] == true {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
    }
    async fn rejected(client: &mut Client) {
        assert!(timeout(Duration::from_secs(2), client.next())
            .await
            .unwrap()
            .is_none_or(|frame| frame.is_err() || matches!(frame, Ok(Message::Close(_)))));
    }
    fn cancel_token() -> Arc<AtomicBool> {
        Arc::new(AtomicBool::new(false))
    }

    #[test]
    fn mutual_proofs_bind_roles_mode_identity_and_both_nonces() {
        let key = "11".repeat(32);
        let proof = proof_hex(&key, "server", "resume", "id", "client", "server").unwrap();
        for (role, mode, id, client, server) in [
            ("client", "resume", "id", "client", "server"),
            ("server", "pair", "id", "client", "server"),
            ("server", "resume", "other", "client", "server"),
            ("server", "resume", "id", "other", "server"),
            ("server", "resume", "id", "client", "other"),
        ] {
            assert!(proof_mac(&key, role, mode, id, client, server)
                .unwrap()
                .verify_slice(&hex::decode(&proof).unwrap())
                .is_err());
        }
    }

    #[tokio::test]
    async fn remembered_pairing_restarts_without_replaying_requests_and_explicit_unlink_revokes_it()
    {
        let owner = "11111111-1111-4111-8111-111111111111";
        let pairing_id = "22222222-2222-4222-8222-222222222222";
        let status = start(owner, pairing_id, cancel_token()).await.unwrap();
        let code = status["code"].as_str().unwrap();
        assert_eq!(pairing_status(owner)["remembered"], false);
        assert!(pairing_status("another-widget")["code"].is_null());

        // A reflected server proof must not authenticate a client.
        let nonce = random_hex(32).unwrap();
        let (mut wrong, challenge) = begin_handshake("pair", pairing_id, &nonce).await;
        wrong
            .send(Message::Text(
                json!({"type":"authenticate","proof":challenge["proof"]})
                    .to_string()
                    .into(),
            ))
            .await
            .unwrap();
        rejected(&mut wrong).await;
        assert!(!pairing_status(owner).to_string().contains("secret"));

        let (mut connection, ready) = client("pair", pairing_id, code).await;
        let secret = ready["credential"]["secret"].as_str().unwrap().to_string();
        assert!(is_hex(&secret, 64));
        assert_eq!(pairing_status(owner)["connected"], true);
        assert_eq!(pairing_status(owner)["remembered"], true);
        assert!(pairing_status(owner)["code"].is_null());
        assert!(session(owner)
            .unwrap()
            .authentication
            .lock()
            .unwrap()
            .code
            .is_none());
        let work = tokio::spawn(request(owner, "observe", Value::Null));
        let message = text_frame(&mut connection).await;
        connection.send(Message::Text(json!({"type":"response","id":message["id"],"ok":true,"value":{"playing":true,"title":"Song","token":"not forwarded"}}).to_string().into())).await.unwrap();
        let observation = work.await.unwrap().unwrap();
        assert_eq!(observation["title"], "Song");
        assert!(observation.get("token").is_none());
        let work = tokio::spawn(request_with_timeout(owner, "next", Value::Null, 50));
        let message = text_frame(&mut connection).await;
        assert!(work.await.unwrap().unwrap_err().contains("만료"));
        assert_eq!(
            text_frame(&mut connection).await,
            json!({"type":"cancel","id":message["id"]})
        );
        let work = tokio::spawn(request(
            owner,
            "playRandom",
            json!({"uri":"spotify:playlist:0000000000000000000000"}),
        ));
        let message = text_frame(&mut connection).await;
        work.abort();
        let _ = work.await;
        assert_eq!(
            text_frame(&mut connection).await,
            json!({"type":"cancel","id":message["id"]})
        );

        let mut pending = Vec::new();
        for _ in 0..MAX_PENDING {
            pending.push(tokio::spawn(request(owner, "observe", Value::Null)));
            text_frame(&mut connection).await;
        }
        assert!(request(owner, "observe", Value::Null)
            .await
            .unwrap_err()
            .contains("이전 음악 요청"));
        let old_session = session(owner).unwrap();
        let old_generation = old_session.connection.lock().unwrap().generation;
        connection.close(None).await.unwrap();
        disconnected(owner).await;
        for work in pending {
            assert!(work.await.unwrap().is_err());
        }
        assert_eq!(pairing_status(owner)["remembered"], true);
        assert!(request(owner, "play", Value::Null).await.is_err());
        let (mut connection, ready) = client("resume", pairing_id, &secret).await;
        assert!(ready.get("credential").is_none());
        old_session.disconnect_transport(old_generation);
        assert_eq!(pairing_status(owner)["connected"], true);
        // No prior request is replayed into the new socket.
        assert!(timeout(Duration::from_millis(100), async {
            loop {
                match connection.next().await {
                    Some(Ok(Message::Ping(bytes))) => {
                        connection.send(Message::Pong(bytes)).await.unwrap()
                    }
                    Some(Ok(Message::Text(_))) => return,
                    _ => panic!("resume transport closed"),
                }
            }
        })
        .await
        .is_err());
        connection.close(None).await.unwrap();
        disconnected(owner).await;

        // Reusing the nonce does not make an old proof valid for a fresh server challenge.
        let nonce = random_hex(32).unwrap();
        let (mut first, first_challenge) = begin_handshake("resume", pairing_id, &nonce).await;
        let old_proof = proof_hex(
            &secret,
            "client",
            "resume",
            pairing_id,
            &nonce,
            first_challenge["serverNonce"].as_str().unwrap(),
        )
        .unwrap();
        first.close(None).await.unwrap();
        let (mut replay, second_challenge) = begin_handshake("resume", pairing_id, &nonce).await;
        assert_ne!(
            first_challenge["serverNonce"],
            second_challenge["serverNonce"]
        );
        replay
            .send(Message::Text(
                json!({"type":"authenticate","proof":old_proof})
                    .to_string()
                    .into(),
            ))
            .await
            .unwrap();
        rejected(&mut replay).await;

        // App exit drops transport only; a new listener loads the OS-store identity.
        revoke_all();
        assert!(credentials::load(owner, pairing_id).unwrap().is_some());
        let restored = resume(owner, pairing_id, cancel_token()).await.unwrap();
        assert_eq!(restored["remembered"], true);
        assert!(restored["code"].is_null());
        let (mut connection, _) = client("resume", pairing_id, &secret).await;
        connection
            .send(Message::Text(
                json!({"type":"disconnect"}).to_string().into(),
            ))
            .await
            .unwrap();
        assert_eq!(text_frame(&mut connection).await["type"], "disconnected");
        assert!(credentials::load(owner, pairing_id).unwrap().is_none());
        assert!(resume(owner, pairing_id, cancel_token()).await.is_err());

        // A replacement identity cannot be revoked by delayed cleanup of the old one.
        let replacement = "33333333-3333-4333-8333-333333333333";
        let status = start(owner, replacement, cancel_token()).await.unwrap();
        let (_connection, _) = client("pair", replacement, status["code"].as_str().unwrap()).await;
        forget(owner, pairing_id).unwrap();
        assert_eq!(pairing_status(owner)["remembered"], true);
        forget(owner, replacement).unwrap();
        assert!(resume(owner, replacement, cancel_token()).await.is_err());

        // Cancellation cannot create a remembered key or revive the listener.
        let canceled = cancel_token();
        canceled.store(true, Ordering::SeqCst);
        assert!(start(owner, replacement, canceled).await.is_err());
        assert!(credentials::save(owner, replacement, &secret, || false).is_err());
        assert!(credentials::load(owner, replacement).unwrap().is_none());
        revoke_all();
    }
}
