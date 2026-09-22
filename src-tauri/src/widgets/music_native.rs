use super::connections::ConnectionError;
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

const ACTIONS: [&str; 10] = [
    "play", "pause", "next", "previous", "seek", "volume", "shuffle", "repeat", "playUri", "like",
];

fn failure(status: &str, message: &str) -> ConnectionError {
    ConnectionError {
        status: status.into(),
        message: message.into(),
    }
}

fn ensure_active(cancel: &AtomicBool) -> Result<(), ConnectionError> {
    if cancel.load(Ordering::Acquire) {
        return Err(failure(
            "stale",
            "이미 변경되거나 중지된 음악 조작은 실행하지 않았어요.",
        ));
    }
    Ok(())
}

fn dispatch_if_active<T>(
    cancel: &AtomicBool,
    dispatch: impl FnOnce() -> Result<T, ConnectionError>,
) -> Result<T, ConnectionError> {
    ensure_active(cancel)?;
    // Cancellation prevents a new dispatch; an event already accepted by the OS cannot be undone.
    dispatch()
}

fn validate_provider(provider: &str, source_id: Option<&str>) -> Result<(), ConnectionError> {
    if !["music", "spotify", "system"].contains(&provider)
        || source_id
            .is_some_and(|id| id.is_empty() || id.len() > 512 || id.chars().any(char::is_control))
    {
        return Err(failure("unsupported", "음악 정보 제공 앱을 확인해 주세요."));
    }
    Ok(())
}

fn validate_action(action: &str, value: &Value) -> Result<(), ConnectionError> {
    let valid = match action {
        "play" | "pause" | "next" | "previous" => value.is_null(),
        "seek" => value
            .as_f64()
            .is_some_and(|number| number.is_finite() && (0.0..=604_800_000.0).contains(&number)),
        "volume" => value
            .as_f64()
            .is_some_and(|number| number.is_finite() && (0.0..=100.0).contains(&number)),
        "shuffle" => value.is_boolean(),
        "repeat" => value
            .as_str()
            .is_some_and(|mode| ["off", "all", "one"].contains(&mode)),
        "playUri" => value.as_str().is_some_and(valid_spotify_uri),
        _ => false,
    };
    if !valid {
        return Err(failure(
            "unsupported",
            "지원하지 않는 음악 조작이거나 값이 올바르지 않아요.",
        ));
    }
    Ok(())
}

fn valid_spotify_uri(uri: &str) -> bool {
    let mut parts = uri.split(':');
    parts.next() == Some("spotify")
        && parts
            .next()
            .is_some_and(|kind| ["track", "episode", "album", "playlist"].contains(&kind))
        && parts
            .next()
            .is_some_and(|id| id.len() == 22 && id.bytes().all(|byte| byte.is_ascii_alphanumeric()))
        && parts.next().is_none()
}

fn empty_observation(provider: &str, source_id: Option<&str>, now: i64) -> Value {
    let source = match provider {
        "music" => "Apple Music",
        "spotify" => "Spotify",
        _ => "Windows 미디어 세션",
    };
    let mut capabilities = serde_json::Map::new();
    for action in ACTIONS {
        capabilities.insert(action.into(), json!(false));
    }
    json!({
        "running":false,"playing":false,"playbackState":"stopped",
        "title":null,"artist":null,"album":null,"durationMs":null,"positionMs":null,
        "artworkUrl":null,"lyrics":null,"volume":null,"shuffle":null,"repeat":null,
        "trackId":null,"metadata":{},"capabilities":capabilities,
        "provider":provider,"source":source,"sourceId":source_id,"observedAt":now
    })
}

fn clean_text(value: &Value, limit: usize) -> Value {
    value
        .as_str()
        .filter(|text| !text.trim().is_empty())
        .map(|text| json!(text.chars().take(limit).collect::<String>()))
        .unwrap_or(Value::Null)
}

fn normalize_observation(raw: Value, provider: &str, now: i64) -> Result<Value, ConnectionError> {
    let running = raw["running"]
        .as_bool()
        .ok_or_else(|| failure("offline", "음악 앱 상태를 읽지 못했어요."))?;
    let state = raw["playbackState"]
        .as_str()
        .filter(|state| ["playing", "paused", "stopped"].contains(state))
        .ok_or_else(|| failure("offline", "음악 재생 상태를 읽지 못했어요."))?;
    if !running && state != "stopped" {
        return Err(failure("offline", "음악 앱 상태가 일치하지 않아요."));
    }
    let mut result = empty_observation(provider, raw["sourceId"].as_str(), now);
    result["running"] = json!(running);
    result["playing"] = json!(state == "playing");
    result["playbackState"] = json!(state);
    if let Some(source) = raw["source"].as_str() {
        result["source"] = json!(source.chars().take(512).collect::<String>());
    }
    if running {
        for action in ACTIONS {
            result["capabilities"][action] =
                json!(raw["capabilities"][action].as_bool().unwrap_or(false));
        }
        result["volume"] = valid_number(&raw["volume"], 100.0);
        result["shuffle"] = raw["shuffle"]
            .as_bool()
            .map_or(Value::Null, |value| json!(value));
        result["repeat"] = raw["repeat"]
            .as_str()
            .filter(|mode| ["off", "all", "one"].contains(mode))
            .map_or(Value::Null, |mode| json!(mode));
    }
    if state == "stopped" {
        result["capabilities"]["seek"] = json!(false);
        return Ok(result);
    }
    for field in ["title", "artist", "album", "trackId"] {
        result[field] = clean_text(&raw[field], 1000);
    }
    if result["title"].is_null() && state == "playing" {
        return Err(failure(
            "offline",
            "재생 중인 곡의 제목을 확인하지 못했어요.",
        ));
    }
    result["durationMs"] = valid_number(&raw["durationMs"], 604_800_000.0);
    result["positionMs"] = valid_number(&raw["positionMs"], 604_800_000.0);
    if let (Some(position), Some(duration)) =
        (result["positionMs"].as_f64(), result["durationMs"].as_f64())
    {
        result["positionMs"] = json!(position.min(duration));
    }
    result["lyrics"] = clean_text(&raw["lyrics"], 65_536);
    result["artworkUrl"] = normalize_artwork(&raw["artworkUrl"]);
    if let Some(metadata) = raw["metadata"].as_object() {
        let fields = [
            "albumArtist",
            "genre",
            "releaseDate",
            "year",
            "composer",
            "bpm",
            "trackNumber",
            "trackCount",
            "discNumber",
            "discCount",
            "work",
            "movement",
            "movementNumber",
            "movementCount",
            "kind",
            "bitRate",
            "sampleRate",
            "description",
            "favorited",
            "rating",
            "playedCount",
            "playedDate",
            "popularity",
            "spotifyUrl",
            "mute",
            "playbackRate",
            "contentType",
            "shuffleMode",
            "starred",
        ];
        for field in fields {
            if let Some(value) = metadata.get(field) {
                let clean = match value {
                    Value::String(_) => {
                        clean_text(value, if field == "description" { 8192 } else { 1000 })
                    }
                    Value::Number(_) | Value::Bool(_) => value.clone(),
                    _ => Value::Null,
                };
                result["metadata"][field] = clean;
            }
        }
    }
    Ok(result)
}

fn valid_number(value: &Value, maximum: f64) -> Value {
    value
        .as_f64()
        .filter(|number| number.is_finite() && (0.0..=maximum).contains(number))
        .map_or(Value::Null, |number| json!(number))
}

fn normalize_artwork(value: &Value) -> Value {
    let Some(url) = value.as_str() else {
        return Value::Null;
    };
    if url.len() > 750_000 {
        return Value::Null;
    }
    if url.starts_with("https://") {
        if url.len() > 2048 {
            return Value::Null;
        }
        return reqwest::Url::parse(url)
            .ok()
            .filter(|url| {
                url.username().is_empty()
                    && url.password().is_none()
                    && url.host_str().is_some_and(|host| {
                        ["scdn.co", "spotifycdn.com", "mzstatic.com"]
                            .iter()
                            .any(|domain| host == *domain || host.ends_with(&format!(".{domain}")))
                    })
            })
            .map_or(Value::Null, |url| json!(url.as_str()));
    }
    use base64::Engine;
    for (prefix, magic) in [
        ("data:image/png;base64,", b"\x89PNG\r\n\x1a\n".as_slice()),
        ("data:image/jpeg;base64,", b"\xff\xd8\xff".as_slice()),
        ("data:image/webp;base64,", b"RIFF".as_slice()),
    ] {
        if let Some(encoded) = url.strip_prefix(prefix) {
            return base64::engine::general_purpose::STANDARD
                .decode(encoded)
                .ok()
                .filter(|bytes| {
                    bytes.starts_with(magic)
                        && (prefix != "data:image/webp;base64,"
                            || bytes.get(8..12) == Some(b"WEBP"))
                })
                .map_or(Value::Null, |_| json!(url));
        }
    }
    Value::Null
}

pub async fn observe_source(
    provider: &str,
    source_id: Option<&str>,
    now: i64,
) -> Result<Value, ConnectionError> {
    validate_provider(provider, source_id)?;
    #[cfg(target_os = "macos")]
    {
        normalize_observation(macos::observe(provider, source_id).await?, provider, now)
    }
    #[cfg(target_os = "windows")]
    {
        normalize_observation(windows::observe(provider, source_id).await?, provider, now)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = now;
        Err(failure(
            "unsupported",
            "이 운영체제의 로컬 음악 연결은 지원하지 않아요.",
        ))
    }
}

pub async fn control_source(
    provider: &str,
    source_id: Option<&str>,
    action: &str,
    value: Value,
    cancel: Arc<AtomicBool>,
) -> Result<(), ConnectionError> {
    ensure_active(&cancel)?;
    validate_provider(provider, source_id)?;
    validate_action(action, &value)?;
    #[cfg(target_os = "macos")]
    {
        macos::control(provider, source_id, action, value, cancel).await
    }
    #[cfg(target_os = "windows")]
    {
        windows::control(provider, source_id, action, value, cancel).await
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Err(failure(
            "unsupported",
            "이 운영체제의 로컬 음악 조작은 지원하지 않아요.",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn cancellation_during_preparation_prevents_dispatch() {
        let cancel = Arc::new(AtomicBool::new(false));
        let dispatched = Arc::new(AtomicBool::new(false));
        let (started, preparation_started) = tokio::sync::oneshot::channel();
        let (prepared, preparation_finished) = tokio::sync::oneshot::channel();
        let task_cancel = cancel.clone();
        let task_dispatched = dispatched.clone();
        let work = tokio::spawn(async move {
            ensure_active(&task_cancel)?;
            started.send(()).unwrap();
            preparation_finished.await.unwrap();
            dispatch_if_active(&task_cancel, || {
                task_dispatched.store(true, Ordering::Release);
                Ok(())
            })
        });
        preparation_started.await.unwrap();
        cancel.store(true, Ordering::Release);
        prepared.send(()).unwrap();
        assert_eq!(work.await.unwrap().unwrap_err().status, "stale");
        assert!(!dispatched.load(Ordering::Acquire));
        assert!(dispatch_if_active(&AtomicBool::new(false), || Ok(())).is_ok());
    }

    #[test]
    fn pause_keeps_track_but_stop_clears_it_and_seeking() {
        let raw = json!({"running":true,"playbackState":"paused","title":"밤의 산책","artist":"별빛정원","album":"조용한 궤도","positionMs":126000,"durationMs":252000,"lyrics":"첫 줄\n둘째 줄","capabilities":{"seek":true},"metadata":{"rating":0,"favorited":false}});
        let paused = normalize_observation(raw.clone(), "music", 123).unwrap();
        assert_eq!(paused["title"], "밤의 산책");
        assert_eq!(paused["playing"], false);
        assert_eq!(paused["lyrics"], "첫 줄\n둘째 줄");
        assert_eq!(paused["metadata"]["rating"], 0);
        assert_eq!(paused["metadata"]["favorited"], false);
        let mut stopped_raw = raw;
        stopped_raw["playbackState"] = json!("stopped");
        let stopped = normalize_observation(stopped_raw, "music", 124).unwrap();
        for key in ["title", "artist", "album", "lyrics", "positionMs"] {
            assert!(stopped[key].is_null());
        }
        assert_eq!(stopped["capabilities"]["seek"], false);
    }

    #[test]
    fn malformed_optional_fields_do_not_destroy_valid_song() {
        let raw = json!({"running":true,"playbackState":"playing","title":"A","durationMs":-1,"positionMs":50,"volume":101,"artworkUrl":"javascript:alert(1)","metadata":{"purchaserAccount":"private","bitRate":256}});
        let song = normalize_observation(raw, "spotify", 1).unwrap();
        assert_eq!(song["title"], "A");
        assert!(song["durationMs"].is_null());
        assert!(song["volume"].is_null());
        assert!(song["artworkUrl"].is_null());
        assert!(song["metadata"].get("purchaserAccount").is_none());
        assert_eq!(song["metadata"]["bitRate"], 256);
    }

    #[test]
    fn control_validation_rejects_arbitrary_commands_and_uri_injection() {
        for (action, value) in [
            ("seek", json!(-1)),
            ("volume", json!(101)),
            ("shuffle", json!("true")),
            ("repeat", json!("context")),
            ("play", json!("extra")),
            ("quit", Value::Null),
            ("playUri", json!("spotify:track:abc\"; app.quit()")),
        ] {
            assert!(validate_action(action, &value).is_err(), "{action}");
        }
        assert!(validate_action("playUri", &json!("spotify:track:6rqhFgbbKwnb9MLmUQDhG6")).is_ok());
        assert!(validate_action("volume", &json!(0)).is_ok());
        assert!(validate_action("shuffle", &json!(false)).is_ok());
    }

    #[test]
    fn artwork_accepts_only_bounded_image_data_or_https() {
        assert!(normalize_artwork(&json!("data:image/svg+xml;base64,PHN2Zz4=")).is_null());
        assert!(normalize_artwork(&json!("data:image/png;base64,bm90IHB uZw==")).is_null());
        assert!(normalize_artwork(&json!("https://user:password@example.com/art.jpg")).is_null());
        assert!(normalize_artwork(&json!("https://scdn.co.attacker.example/art.jpg")).is_null());
        assert!(normalize_artwork(&json!("https://notspotifycdn.com/art.jpg")).is_null());
        assert_eq!(
            normalize_artwork(&json!("https://i.scdn.co/image/abc")),
            "https://i.scdn.co/image/abc"
        );
    }
}
