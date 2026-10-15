use super::{dispatch_if_active, empty_observation, ensure_active, failure, ConnectionError};
use ::windows::{
    Media::{
        Control::{
            GlobalSystemMediaTransportControlsSession as Session,
            GlobalSystemMediaTransportControlsSessionManager as SessionManager,
            GlobalSystemMediaTransportControlsSessionPlaybackControls as Controls,
            GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlaybackStatus,
        },
        MediaPlaybackAutoRepeatMode,
    },
    Storage::Streams::DataReader,
};
use base64::Engine;
use serde_json::{json, Value};
use std::sync::{atomic::AtomicBool, Arc};
use std::time::Duration;

fn os_error(error: ::windows::core::Error) -> ConnectionError {
    if error.code().0 as u32 == 0x80070005 {
        return failure(
            "permission-needed",
            "Windows가 미디어 세션 접근을 허용하지 않았어요.",
        );
    }
    failure("offline", "Windows 미디어 세션 요청을 완료하지 못했어요.")
}

async fn session(
    provider: &str,
    source_id: Option<&str>,
) -> Result<Option<Session>, ConnectionError> {
    if provider == "music" {
        return Err(failure(
            "unsupported",
            "Windows에서는 Spotify 또는 시스템 미디어 세션을 선택해 주세요.",
        ));
    }
    let manager = SessionManager::RequestAsync()
        .map_err(os_error)?
        .await
        .map_err(os_error)?;
    if provider == "system" && source_id.is_none() {
        return Ok(manager.GetCurrentSession().ok());
    }
    let sessions = manager.GetSessions().map_err(os_error)?;
    let mut matching = Vec::new();
    for index in 0..sessions.Size().map_err(os_error)?.min(128) {
        let candidate = sessions.GetAt(index).map_err(os_error)?;
        let id = candidate
            .SourceAppUserModelId()
            .map_err(os_error)?
            .to_string();
        if source_id.is_some_and(|expected| id != expected) {
            continue;
        }
        if provider == "spotify" && !is_spotify_source(&id) {
            continue;
        }
        matching.push((id, candidate));
    }
    matching.sort_by(|left, right| left.0.cmp(&right.0));
    Ok(matching.into_iter().next().map(|(_, session)| session))
}

fn is_spotify_source(source: &str) -> bool {
    let source = source.to_ascii_lowercase();
    source == "spotify.exe" || source.starts_with("spotifyab.spotifymusic_")
}

pub(super) async fn launch_spotify(cancel: &AtomicBool) -> Result<(), ConnectionError> {
    // A Spotify process can exist without a media session. Only open the URI when it is absent.
    let mut child = dispatch_if_active(cancel, || {
        tokio::process::Command::new("powershell.exe")
            .args([
                "-NoProfile", "-NonInteractive", "-Command",
                "if (-not (Get-Process -Name Spotify -ErrorAction SilentlyContinue)) { Start-Process 'spotify:' -ErrorAction Stop }",
            ])
            .creation_flags(0x08000000)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(|_| failure("offline", "Spotify를 실행하지 못했어요. 앱 설치 상태를 확인해 주세요."))
    })?;
    let status = tokio::time::timeout(Duration::from_secs(8), child.wait())
        .await
        .map_err(|_| failure("offline", "Spotify 실행 대기 시간이 초과됐어요."))?
        .map_err(|_| failure("offline", "Spotify 실행을 확인하지 못했어요."))?;
    if !status.success() {
        return Err(failure(
            "offline",
            "Spotify를 실행하지 못했어요. 앱 설치 상태를 확인해 주세요.",
        ));
    }
    Ok(())
}

fn capabilities(controls: &Controls) -> Value {
    json!({
        "play":controls.IsPlayEnabled().unwrap_or(false),
        "pause":controls.IsPauseEnabled().unwrap_or(false),
        "next":controls.IsNextEnabled().unwrap_or(false),
        "previous":controls.IsPreviousEnabled().unwrap_or(false),
        "seek":controls.IsPlaybackPositionEnabled().unwrap_or(false),
        "shuffle":controls.IsShuffleEnabled().unwrap_or(false),
        "repeat":controls.IsRepeatEnabled().unwrap_or(false),
        "volume":false,"playUri":false,"like":false
    })
}

async fn artwork(
    properties: &::windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties,
) -> Option<String> {
    let (size, mime, reader) = {
        let open = {
            let thumbnail = properties.Thumbnail().ok()?;
            thumbnail.OpenReadAsync().ok()?
        };
        let stream = open.await.ok()?;
        let size = stream.Size().ok()?;
        if size == 0 || size > 524_288 {
            return None;
        }
        let mime = stream.ContentType().ok()?.to_string();
        if !["image/png", "image/jpeg", "image/webp"].contains(&mime.as_str()) {
            return None;
        }
        let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0).ok()?).ok()?;
        (size, mime, reader)
    };
    if reader.LoadAsync(size as u32).ok()?.await.ok()? != size as u32 {
        return None;
    }
    let mut bytes = vec![0; size as usize];
    reader.ReadBytes(&mut bytes).ok()?;
    Some(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

pub(super) async fn observe(
    provider: &str,
    source_id: Option<&str>,
) -> Result<Value, ConnectionError> {
    let operation = async {
        let Some(session) = session(provider, source_id).await? else {
            return Ok(empty_observation(provider, source_id, 0));
        };
        let id = session
            .SourceAppUserModelId()
            .map_err(os_error)?
            .to_string();
        let playback = session.GetPlaybackInfo().map_err(os_error)?;
        let status = playback.PlaybackStatus().map_err(os_error)?;
        let state = match status {
            PlaybackStatus::Playing => "playing",
            PlaybackStatus::Paused => "paused",
            PlaybackStatus::Changing => {
                return Err(failure(
                    "stale",
                    "Windows 미디어 세션이 곡을 전환하고 있어요.",
                ))
            }
            _ => "stopped",
        };
        let mut result = empty_observation(provider, Some(&id), 0);
        result["running"] = json!(status != PlaybackStatus::Closed);
        result["playbackState"] = json!(state);
        result["source"] = json!(if is_spotify_source(&id) {
            "Spotify"
        } else {
            &id
        });
        result["capabilities"] = playback
            .Controls()
            .map(|controls| capabilities(&controls))
            .unwrap_or(json!({}));
        result["shuffle"] = json!(playback
            .IsShuffleActive()
            .ok()
            .and_then(|value| value.Value().ok()));
        result["repeat"] = json!(playback
            .AutoRepeatMode()
            .ok()
            .and_then(|value| value.Value().ok())
            .and_then(|mode| match mode {
                MediaPlaybackAutoRepeatMode::None => Some("off"),
                MediaPlaybackAutoRepeatMode::List => Some("all"),
                MediaPlaybackAutoRepeatMode::Track => Some("one"),
                _ => None,
            }));
        if state == "stopped" {
            return Ok(result);
        }
        let properties = session
            .TryGetMediaPropertiesAsync()
            .map_err(os_error)?
            .await
            .map_err(os_error)?;
        result["title"] = json!(properties.Title().ok().map(|value| value.to_string()));
        result["artist"] = json!(properties.Artist().ok().map(|value| value.to_string()));
        result["album"] = json!(properties.AlbumTitle().ok().map(|value| value.to_string()));
        let timeline = session.GetTimelineProperties().ok();
        if let Some(timeline) = timeline {
            if let (Ok(start), Ok(end), Ok(position)) = (
                timeline.StartTime(),
                timeline.EndTime(),
                timeline.Position(),
            ) {
                if end.Duration > start.Duration {
                    let duration = (end.Duration - start.Duration) / 10_000;
                    let mut current_position = (position.Duration - start.Duration).max(0) / 10_000;
                    if state == "playing" {
                        if let Ok(updated) = timeline.LastUpdatedTime() {
                            let updated_ms = updated.UniversalTime / 10_000 - 11_644_473_600_000;
                            let elapsed = chrono::Utc::now()
                                .timestamp_millis()
                                .saturating_sub(updated_ms)
                                .max(0);
                            let rate = playback
                                .PlaybackRate()
                                .ok()
                                .and_then(|value| value.Value().ok())
                                .unwrap_or(1.0);
                            if rate.is_finite() && rate >= 0.0 {
                                current_position =
                                    current_position.saturating_add((elapsed as f64 * rate) as i64);
                            }
                        }
                    }
                    result["durationMs"] = json!(duration);
                    result["positionMs"] = json!(current_position.min(duration));
                }
            }
        }
        result["artworkUrl"] = json!(artwork(&properties).await);
        let genre = properties.Genres().ok().map(|genres| {
            (0..genres.Size().unwrap_or(0).min(32))
                .filter_map(|index| genres.GetAt(index).ok().map(|value| value.to_string()))
                .collect::<Vec<_>>()
                .join(", ")
        });
        result["metadata"] = json!({
            "albumArtist":properties.AlbumArtist().ok().map(|value| value.to_string()),
            "trackNumber":properties.TrackNumber().ok(),
            "trackCount":properties.AlbumTrackCount().ok(),
            "genre":genre,
            "description":properties.Subtitle().ok().map(|value| value.to_string()),
            "playbackRate":playback.PlaybackRate().ok().and_then(|value| value.Value().ok())
        });
        Ok(result)
    };
    tokio::time::timeout(Duration::from_secs(8), operation)
        .await
        .map_err(|_| failure("offline", "Windows 미디어 세션 응답 시간이 초과됐어요."))?
}

pub(super) async fn control(
    provider: &str,
    source_id: Option<&str>,
    action: &str,
    value: Value,
    cancel: Arc<AtomicBool>,
) -> Result<(), ConnectionError> {
    let Some(source_id) = source_id else {
        return Err(failure("stale", "조작할 음악 앱을 먼저 확인해 주세요."));
    };
    let operation = async {
        let session = session(provider, Some(source_id))
            .await?
            .ok_or_else(|| failure("offline", "선택한 음악 앱의 미디어 세션이 닫혔어요."))?;
        ensure_active(&cancel)?;
        let controls = session
            .GetPlaybackInfo()
            .map_err(os_error)?
            .Controls()
            .map_err(os_error)?;
        if capabilities(&controls)[action] != true {
            return Err(failure(
                "unsupported",
                "선택한 음악 앱은 이 조작을 지원하지 않아요.",
            ));
        }
        let seek_target = if action == "seek" {
            let timeline = session.GetTimelineProperties().map_err(os_error)?;
            let start = timeline.StartTime().map_err(os_error)?.Duration;
            let target = start.saturating_add((value.as_f64().unwrap_or(0.0) * 10_000.0) as i64);
            let minimum = timeline.MinSeekTime().map_err(os_error)?.Duration;
            let maximum = timeline.MaxSeekTime().map_err(os_error)?.Duration;
            if target < minimum || target > maximum {
                return Err(failure(
                    "unsupported",
                    "이 곡에서 이동할 수 없는 재생 위치예요.",
                ));
            }
            target
        } else {
            0
        };
        let operation = dispatch_if_active(&cancel, || {
            match action {
                "play" => session.TryPlayAsync(),
                "pause" => session.TryPauseAsync(),
                "next" => session.TrySkipNextAsync(),
                "previous" => session.TrySkipPreviousAsync(),
                "shuffle" => session.TryChangeShuffleActiveAsync(value.as_bool().unwrap_or(false)),
                "repeat" => session.TryChangeAutoRepeatModeAsync(match value.as_str() {
                    Some("all") => MediaPlaybackAutoRepeatMode::List,
                    Some("one") => MediaPlaybackAutoRepeatMode::Track,
                    _ => MediaPlaybackAutoRepeatMode::None,
                }),
                "seek" => session.TryChangePlaybackPositionAsync(seek_target),
                _ => {
                    return Err(failure(
                        "unsupported",
                        "Windows 미디어 세션은 이 조작을 지원하지 않아요.",
                    ))
                }
            }
            .map_err(os_error)
        })?;
        if !operation.await.map_err(os_error)? {
            return Err(failure(
                "unsupported",
                "음악 앱이 조작 요청을 받아들이지 않았어요.",
            ));
        }
        Ok(())
    };
    tokio::time::timeout(Duration::from_secs(8), operation)
        .await
        .map_err(|_| failure("offline", "Windows 음악 조작 응답 시간이 초과됐어요."))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spotify_matching_does_not_select_other_app_mentions() {
        assert!(is_spotify_source("Spotify.exe"));
        assert!(is_spotify_source(
            "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify"
        ));
        assert!(!is_spotify_source("chrome.exe"));
        assert!(!is_spotify_source("MySpotifyRemote.exe"));
    }
}
