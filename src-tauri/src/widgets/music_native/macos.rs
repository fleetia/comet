use super::{dispatch_if_active, empty_observation, failure, ConnectionError};
use serde_json::{json, Value};
use std::sync::{atomic::AtomicBool, Arc};
use std::{process::Stdio, time::Duration};
use tokio::io::{AsyncRead, AsyncReadExt};

const SCRIPT: &str = include_str!("macos.js");
const MAX_OUTPUT_BYTES: usize = 1024 * 1024;

fn app_id(provider: &str, source_id: Option<&str>) -> Result<&'static str, ConnectionError> {
    let id = match provider {
        "music" => "com.apple.Music",
        "spotify" => "com.spotify.client",
        _ => {
            return Err(failure(
                "unsupported",
                "macOS에서는 Apple Music 또는 Spotify를 선택해 주세요.",
            ))
        }
    };
    if source_id.is_some_and(|source| source != id) {
        return Err(failure(
            "stale",
            "선택한 음악 앱이 바뀌었어요. 현재 곡을 다시 확인해 주세요.",
        ));
    }
    Ok(id)
}

async fn read_bounded(
    stream: impl AsyncRead + Unpin,
    limit: usize,
) -> Result<Vec<u8>, ConnectionError> {
    let mut bytes = vec![];
    stream
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .await
        .map_err(|_| failure("offline", "음악 앱 응답을 끝까지 읽지 못했어요."))?;
    if bytes.len() > limit {
        return Err(failure("offline", "음악 앱 응답이 허용된 크기를 넘었어요."));
    }
    Ok(bytes)
}

async fn run(input: Value, cancel: Option<&AtomicBool>) -> Result<Value, ConnectionError> {
    let argument = serde_json::to_string(&input)
        .map_err(|_| failure("offline", "음악 명령을 준비하지 못했어요."))?;
    let operation = async {
        let spawn = || {
            tokio::process::Command::new("/usr/bin/osascript")
                .args(["-l", "JavaScript", "-e", SCRIPT, &argument])
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .kill_on_drop(true)
                .spawn()
                .map_err(|_| failure("offline", "음악 앱 연결을 실행하지 못했어요."))
        };
        let mut child = match cancel {
            Some(cancel) => dispatch_if_active(cancel, spawn)?,
            None => spawn()?,
        };
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| failure("offline", "음악 응답을 읽지 못했어요."))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| failure("offline", "음악 응답을 읽지 못했어요."))?;
        let (output, errors, status) = tokio::try_join!(
            read_bounded(stdout, MAX_OUTPUT_BYTES),
            read_bounded(stderr, 16 * 1024),
            async {
                child
                    .wait()
                    .await
                    .map_err(|_| failure("offline", "음악 앱 연결이 중단됐어요."))
            }
        )?;
        if !status.success() {
            let message = String::from_utf8_lossy(&errors);
            return Err(
                if message.contains("-1743") || message.contains("not authorized") {
                    failure("permission-needed", "시스템 설정의 개인정보 보호 및 보안 → 자동화에서 comet의 음악 앱 접근을 허용해 주세요.")
                } else if message.contains("APP_CLOSED") {
                    failure("offline", "선택한 음악 앱을 먼저 실행해 주세요.")
                } else if message.contains("UNSUPPORTED_CONTROL") {
                    failure(
                        "unsupported",
                        "현재 앱이나 재생 항목이 이 조작을 지원하지 않아요.",
                    )
                } else if message.contains("TRACK_CHANGED") {
                    failure("stale", "조회 중 곡이 바뀌었어요. 다시 확인해 주세요.")
                } else {
                    failure("offline", "음악 앱이 요청을 완료하지 못했어요.")
                },
            );
        }
        serde_json::from_slice(&output)
            .map_err(|_| failure("offline", "음악 앱 응답 형식이 올바르지 않아요."))
    };
    tokio::time::timeout(Duration::from_secs(8), operation)
        .await
        .map_err(|_| failure("offline", "음악 앱 응답 시간이 초과됐어요."))?
}

pub(super) async fn observe(
    provider: &str,
    source_id: Option<&str>,
) -> Result<Value, ConnectionError> {
    let id = app_id(provider, source_id)?;
    let mut observation = run(
        json!({"appId":id,"provider":provider,"action":"observe"}),
        None,
    )
    .await?;
    if observation["running"] == false {
        return Ok(empty_observation(provider, Some(id), 0));
    }
    observation["sourceId"] = json!(id);
    Ok(observation)
}

pub(super) async fn control(
    provider: &str,
    source_id: Option<&str>,
    action: &str,
    value: Value,
    cancel: Arc<AtomicBool>,
) -> Result<(), ConnectionError> {
    let id = app_id(provider, source_id)?;
    if (action == "playUri" && provider != "spotify")
        || (action == "repeat" && provider == "spotify" && value == "one")
    {
        return Err(failure(
            "unsupported",
            "이 앱의 로컬 연결은 해당 조작을 지원하지 않아요.",
        ));
    }
    run(
        json!({"appId":id,"provider":provider,"action":action,"value":value}),
        Some(&cancel),
    )
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mismatched_source_never_resolves_to_another_app() {
        assert_eq!(
            app_id("spotify", Some("com.spotify.client")).unwrap(),
            "com.spotify.client"
        );
        assert!(app_id("spotify", Some("com.apple.Music")).is_err());
        assert!(app_id("system", None).is_err());
    }

    #[tokio::test]
    async fn oversized_process_output_is_rejected() {
        let bytes = vec![b'a'; 1025];
        assert!(read_bounded(bytes.as_slice(), 1024).await.is_err());
        assert_eq!(
            read_bounded(&bytes[..1024], 1024).await.unwrap().len(),
            1024
        );
    }
}
