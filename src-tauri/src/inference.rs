use crate::{
    models,
    types::{ChatMessage, LocalModel, LocalModelTest, Settings},
};
use futures_util::StreamExt;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    path::PathBuf,
    process::Stdio,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use tokio::{
    process::{Child, Command},
    sync::Mutex,
};

struct LocalServer {
    path: PathBuf,
    child: Child,
    url: String,
    key: String,
}
pub struct Inference {
    pub app_data: PathBuf,
    sidecar_path: PathBuf,
    runtime_dir: PathBuf,
    local: Mutex<Option<LocalServer>>,
}
impl Inference {
    pub fn new(app_data: PathBuf, sidecar_path: PathBuf, runtime_dir: PathBuf) -> Self {
        Self {
            app_data,
            sidecar_path,
            runtime_dir,
            local: Mutex::new(None),
        }
    }
}

fn endpoint(settings: &Settings) -> Result<String, String> {
    let url = reqwest::Url::parse(settings.base_url.trim())
        .map_err(|_| "API 주소가 올바르지 않습니다.")?;
    let local = matches!(
        url.host_str(),
        Some("localhost" | "127.0.0.1" | "[::1]" | "::1")
    );
    if (url.scheme() != "https" && !(url.scheme() == "http" && local))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(
            "API는 HTTPS 주소 또는 로컬 HTTP 주소여야 하며 인증정보·query를 포함할 수 없습니다."
                .into(),
        );
    }
    Ok(url.as_str().trim_end_matches('/').to_string())
}
fn credential(settings: &Settings) -> Result<keyring::Entry, String> {
    let url = endpoint(settings)?;
    let account = hex::encode(Sha256::digest(url.as_bytes()));
    keyring::Entry::new("space.nanika-box.api", &account)
        .map_err(|_| "시스템 자격 증명 저장소에 접근할 수 없습니다.".into())
}
pub fn has_api_key(settings: &Settings) -> bool {
    credential(settings)
        .and_then(|entry| entry.get_password().map_err(|_| String::new()))
        .is_ok()
}
pub fn set_api_key(settings: &Settings, key: &str) -> Result<(), String> {
    if key.trim().is_empty() || key.len() > 8192 || key.contains(['\r', '\n']) {
        return Err("API 키가 올바르지 않습니다.".into());
    }
    credential(settings)?
        .set_password(key.trim())
        .map_err(|_| "API 키를 시스템 자격 증명 저장소에 저장할 수 없습니다.".into())
}
pub fn clear_api_key(settings: &Settings) -> Result<(), String> {
    match credential(settings)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("API 키 삭제에 실패했습니다.".into()),
    }
}
fn saved_key(settings: &Settings) -> Result<Option<String>, String> {
    match credential(settings)?.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("시스템 자격 증명 저장소에서 API 키를 읽을 수 없습니다.".into()),
    }
}
fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|_| "HTTP 초기화 실패".into())
}

pub fn not_ready_message(settings: &Settings) -> String {
    if settings.local_model == LocalModel::Custom {
        "GGUF 모델 파일을 찾을 수 없어요. 설정에서 절대 경로를 확인해 주세요.".into()
    } else {
        "설정에서 로컬 모델을 먼저 다운로드해 주세요.".into()
    }
}

async fn local_endpoint(
    inference: &Inference,
    settings: &Settings,
    cancel: Arc<AtomicBool>,
) -> Result<(String, String), String> {
    let mut state = inference.local.lock().await;
    let path = models::selected_path(&inference.app_data, settings)
        .filter(|_| models::selected_ready(&inference.app_data, settings));
    if let Some(server) = state.as_mut() {
        if path.as_ref() == Some(&server.path) && matches!(server.child.try_wait(), Ok(None)) {
            return Ok((server.url.clone(), server.key.clone()));
        }
        let _ = server.child.kill().await;
        let _ = server.child.wait().await;
        *state = None;
    }
    let Some(path) = path else {
        return Err(not_ready_message(settings));
    };
    if !inference.sidecar_path.is_file() {
        return Err("로컬 실행기가 없습니다. prepare-sidecar 후 앱을 다시 빌드해 주세요.".into());
    }
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0))
        .map_err(|_| "로컬 포트를 할당할 수 없습니다.")?;
    let port = listener
        .local_addr()
        .map_err(|_| "로컬 포트 확인 실패")?
        .port();
    drop(listener);
    let key = uuid::Uuid::new_v4().to_string();
    let url = format!("http://127.0.0.1:{port}");
    let mut command = Command::new(&inference.sidecar_path);
    command
        .args(["--model"])
        .arg(&path)
        .args([
            "--host",
            "127.0.0.1",
            "--port",
            &port.to_string(),
            "--ctx-size",
            "4096",
            "--parallel",
            "1",
            "--sleep-idle-seconds",
            "120",
            "--jinja",
            "--reasoning-budget",
            "0",
            "--cache-ram",
            "0",
            "--no-webui",
            "--log-disable",
        ])
        .env("LLAMA_API_KEY", &key)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    if cfg!(target_os = "macos") {
        command
            .env("DYLD_LIBRARY_PATH", &inference.runtime_dir)
            .args(["--n-gpu-layers", "auto"]);
    } else {
        let mut paths = vec![inference.runtime_dir.clone()];
        paths.extend(std::env::split_paths(
            &std::env::var_os("PATH").unwrap_or_default(),
        ));
        command.env(
            "PATH",
            std::env::join_paths(paths).map_err(|_| "실행기 경로 설정 실패")?,
        );
    }
    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000);
    let mut child = command.spawn().map_err(|_| {
        "로컬 실행기를 시작하지 못했습니다. 실행 파일과 라이브러리를 확인해 주세요."
    })?;
    let http = client()?;
    for _ in 0..240 {
        if cancel.load(Ordering::Acquire) {
            let _ = child.kill().await;
            return Err("취소됨".into());
        }
        if child
            .try_wait()
            .map_err(|_| "실행기 상태 확인 실패")?
            .is_some()
        {
            return Err(
                "로컬 실행기가 종료되었습니다. 모델·GPU·메모리와 실행기 버전을 확인해 주세요."
                    .into(),
            );
        }
        let ready = tokio::select! {
            _ = models::cancelled(cancel.clone()) => { let _ = child.kill().await; return Err("취소됨".into()); },
            response = http.get(format!("{url}/health")).bearer_auth(&key).timeout(Duration::from_secs(1)).send() => response.map(|r| r.status().is_success()).unwrap_or(false),
        };
        if ready {
            *state = Some(LocalServer {
                path,
                child,
                url: url.clone(),
                key: key.clone(),
            });
            return Ok((url, key));
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    let _ = child.kill().await;
    Err("로컬 모델 준비 시간이 초과되었습니다.".into())
}

pub async fn is_local_running(inference: &Inference, settings: &Settings) -> bool {
    let mut state = inference.local.lock().await;
    let Some(server) = state.as_mut() else {
        return false;
    };
    if models::selected_path(&inference.app_data, settings).as_ref() != Some(&server.path)
        || !matches!(server.child.try_wait(), Ok(None))
    {
        return false;
    }
    let Ok(http) = client() else {
        return false;
    };
    let Ok(response) = http
        .get(format!("{}/props", server.url))
        .bearer_auth(&server.key)
        .timeout(Duration::from_secs(1))
        .send()
        .await
    else {
        return false;
    };
    if !response.status().is_success() {
        return false;
    }
    response_body(response)
        .await
        .ok()
        .and_then(|body| body.get("is_sleeping").and_then(Value::as_bool))
        .is_some_and(|sleeping| !sleeping)
}

pub async fn stop_local(inference: &Inference) {
    if let Some(mut server) = inference.local.lock().await.take() {
        let _ = server.child.kill().await;
        let _ = server.child.wait().await;
    }
}

async fn response_body(response: reqwest::Response) -> Result<Value, String> {
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| "API 응답 수신이 중단되었습니다.")?;
        if bytes.len() + chunk.len() > 256 * 1024 {
            return Err("API 응답이 허용 크기를 초과했습니다.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| "API 응답이 올바른 JSON이 아닙니다.".into())
}
async fn completion(
    url: &str,
    key: Option<&str>,
    settings: &Settings,
    messages: &[ChatMessage],
    schema: Value,
    max_tokens: u32,
    cancel: Arc<AtomicBool>,
) -> Result<Value, String> {
    if cancel.load(Ordering::Acquire) {
        return Err("취소됨".into());
    }
    tokio::select! {
        _ = models::cancelled(cancel.clone()) => Err("취소됨".into()),
        result = completion_request(url, key, settings, messages, schema, max_tokens, cancel.clone()) => result,
    }
}

async fn completion_request(
    url: &str,
    key: Option<&str>,
    settings: &Settings,
    messages: &[ChatMessage],
    schema: Value,
    max_tokens: u32,
    cancel: Arc<AtomicBool>,
) -> Result<Value, String> {
    let http = client()?;
    let token_parameter = match settings.api_token_parameter.as_str() {
        "max_tokens" => "max_tokens",
        "max_completion_tokens" => "max_completion_tokens",
        _ => return Err("지원하지 않는 토큰 한도 매개변수입니다.".into()),
    };
    let temperature = if schema.pointer("/properties/memories").is_some() {
        0.1
    } else {
        0.7
    };
    let mut payload = json!({"model":settings.api_model,"messages":messages,"stream":false,"temperature":temperature,"response_format":{"type":"json_schema","json_schema":{"name":"response","strict":true,"schema":schema}}});
    payload[token_parameter] = json!(max_tokens);
    if settings.mode == "local" {
        payload["chat_template_kwargs"] = json!({"enable_thinking":false});
    }
    for attempt in 0..2 {
        let mut request = http.post(format!("{url}/chat/completions")).json(&payload);
        if let Some(value) = key.filter(|s| !s.is_empty()) {
            request = request.bearer_auth(value);
        }
        let response = request.send().await.map_err(|error| {
            if error.is_timeout() {
                "API 응답 시간이 초과되었습니다."
            } else {
                "API에 연결할 수 없습니다. 주소·네트워크를 확인해 주세요."
            }
        })?;
        let status = response.status();
        if attempt == 0 && settings.mode == "api" && matches!(status.as_u16(), 400 | 422) {
            let object = payload.as_object_mut().ok_or("요청 생성 실패")?;
            object.remove("response_format");
            object.remove("temperature");
            continue;
        }
        if !status.is_success() {
            return Err(match status.as_u16() {
                401 | 403 => "API 인증에 실패했습니다. 이 주소에 저장한 키를 확인해 주세요.".into(),
                429 => "API 요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.".into(),
                _ => format!("API 요청 실패 (HTTP {}).", status.as_u16()),
            });
        }
        let body = response_body(response).await?;
        if cancel.load(Ordering::Acquire) {
            return Err("취소됨".into());
        }
        let content = body
            .pointer("/choices/0/message/content")
            .and_then(Value::as_str)
            .ok_or("API 응답에 대화 내용이 없습니다.")?;
        let trimmed = content.trim();
        let json_text = trimmed
            .strip_prefix("```json")
            .or_else(|| trimmed.strip_prefix("```"))
            .and_then(|s| s.strip_suffix("```"))
            .unwrap_or(trimmed)
            .trim();
        return serde_json::from_str(json_text).map_err(|_| {
            "모델이 요청한 JSON 형식으로 답하지 않았습니다. 모델 설정을 확인해 주세요.".into()
        });
    }
    Err("API 요청 실패".into())
}

pub async fn generate(
    inference: &Inference,
    settings: &Settings,
    messages: &[ChatMessage],
    schema: Value,
    max_tokens: u32,
    cancel: Arc<AtomicBool>,
) -> Result<Value, String> {
    if cancel.load(Ordering::Acquire) {
        return Err("취소됨".into());
    }
    let local = settings.mode == "local";
    let (url, key, configured) = if local {
        let (url, key) = local_endpoint(inference, settings, cancel.clone()).await?;
        let mut configured = settings.clone();
        configured.api_model = "local".into();
        configured.api_token_parameter = "max_tokens".into();
        (format!("{url}/v1"), Some(key), configured)
    } else {
        (endpoint(settings)?, saved_key(settings)?, settings.clone())
    };
    let result = tokio::select! {
        _ = models::cancelled(cancel.clone()) => Err("취소됨".into()),
        result = completion(&url, key.as_deref(), &configured, messages, schema, max_tokens.min(2048), cancel.clone()) => result,
    };
    if local && cancel.load(Ordering::Acquire) {
        stop_local(inference).await;
    }
    result
}

pub async fn test_connection(settings: &Settings, key: Option<String>) -> Result<String, String> {
    let url = endpoint(settings)?;
    if settings.api_model.trim().is_empty() {
        return Err("API 모델 이름을 입력해 주세요.".into());
    }
    let selected_key = match key {
        Some(value) => Some(value),
        None => saved_key(settings)?,
    };
    let messages = vec![ChatMessage {
        role: "user".into(),
        content: "Return only this JSON object: {\"ok\":true}".into(),
    }];
    let value = completion(&url, selected_key.as_deref(), settings, &messages, json!({"type":"object","properties":{"ok":{"type":"boolean"}},"required":["ok"],"additionalProperties":false}), 32, Arc::new(AtomicBool::new(false))).await?;
    if value.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err("API 연결은 되었지만 JSON 응답 검증에 실패했습니다.".into());
    }
    Ok("API 연결과 JSON 응답을 확인했습니다.".into())
}

pub async fn test_local(
    inference: &Inference,
    settings: &Settings,
    cancel: Arc<AtomicBool>,
) -> Result<LocalModelTest, String> {
    if settings.mode != "local" {
        return Err("로컬 모델 테스트는 '이 기기에서' 방식에서만 사용할 수 있어요.".into());
    }
    let started = Instant::now();
    let messages = vec![
        ChatMessage {
            role: "system".into(),
            content: "너는 바탕화면에 사는 작은 캐릭터야. 반말로, 한국어 한두 문장으로만 대답해. 결과는 {\"text\": string} JSON 객체 하나로만 출력해.".into(),
        },
        ChatMessage {
            role: "user".into(),
            content: "안녕! 오늘 기분 어때? 짧게 자기소개도 해 줘.".into(),
        },
    ];
    let value = generate(
        inference,
        settings,
        &messages,
        json!({"type":"object","properties":{"text":{"type":"string"}},"required":["text"],"additionalProperties":false}),
        128,
        cancel,
    )
    .await?;
    let reply = value
        .get("text")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .ok_or("모델이 빈 응답을 보냈어요.")?;
    Ok(LocalModelTest {
        reply: reply.chars().take(300).collect(),
        elapsed_ms: started.elapsed().as_millis() as u64,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    #[tokio::test]
    async fn reuses_only_the_requested_model_and_stops_old_process() {
        let directory = tempfile::tempdir().unwrap();
        let runtime = Inference::new(directory.path().into(), PathBuf::new(), PathBuf::new());
        let four = Settings::default();
        let nine = Settings {
            local_model: LocalModel::Qwen35_9B,
            ..Settings::default()
        };
        let four_path = models::model_path(directory.path(), LocalModel::Qwen35_4B).unwrap();
        std::fs::create_dir_all(four_path.parent().unwrap()).unwrap();
        std::fs::write(&four_path, b"stub").unwrap();
        let child = Command::new("/bin/sleep")
            .arg("30")
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        *runtime.local.lock().await = Some(LocalServer {
            path: four_path.clone(),
            child,
            url: "http://127.0.0.1:1".into(),
            key: "test".into(),
        });
        assert!(!is_local_running(&runtime, &nine).await);
        // The stub file is not a verified download, so the running server is replaced instead of reused.
        let result = tokio::time::timeout(
            Duration::from_secs(2),
            local_endpoint(&runtime, &four, Arc::new(AtomicBool::new(false))),
        )
        .await
        .unwrap();
        assert!(result.unwrap_err().contains("다운로드"));
        assert!(runtime.local.lock().await.is_none());
        let custom_file = directory.path().join("mine.gguf");
        std::fs::write(&custom_file, b"stub").unwrap();
        let custom = Settings {
            local_model: LocalModel::Custom,
            local_model_path: custom_file.display().to_string(),
            ..Settings::default()
        };
        let child = Command::new("/bin/sleep")
            .arg("30")
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        *runtime.local.lock().await = Some(LocalServer {
            path: custom_file.clone(),
            child,
            url: "http://127.0.0.1:2".into(),
            key: "test".into(),
        });
        let result = local_endpoint(&runtime, &custom, Arc::new(AtomicBool::new(false)))
            .await
            .unwrap();
        assert_eq!(result.0, "http://127.0.0.1:2");
        let missing = Settings {
            local_model_path: directory.path().join("gone.gguf").display().to_string(),
            ..custom
        };
        let result = tokio::time::timeout(
            Duration::from_secs(2),
            local_endpoint(&runtime, &missing, Arc::new(AtomicBool::new(false))),
        )
        .await
        .unwrap();
        assert!(result.unwrap_err().contains("GGUF"));
        assert!(runtime.local.lock().await.is_none());
        let result = test_local(
            &runtime,
            &Settings {
                mode: "api".into(),
                ..Settings::default()
            },
            Arc::new(AtomicBool::new(false)),
        )
        .await;
        assert!(result.unwrap_err().contains("이 기기에서"));
    }
    #[test]
    fn endpoint_rejects_secret_urls_and_insecure_remote() {
        for base_url in [
            "http://remote.example/v1",
            "https://user:secret@example.com/v1",
            "https://example.com/v1?key=secret",
        ] {
            let settings = Settings {
                base_url: base_url.into(),
                ..Settings::default()
            };
            assert!(endpoint(&settings).is_err());
        }
        let settings = Settings {
            base_url: "http://127.0.0.1:1234/v1/".into(),
            ..Settings::default()
        };
        assert_eq!(endpoint(&settings).unwrap(), "http://127.0.0.1:1234/v1");
    }
    #[tokio::test]
    async fn http_errors_are_redacted_and_pre_cancelled_requests_stop() {
        use tokio::{
            io::{AsyncReadExt, AsyncWriteExt},
            net::TcpListener,
        };
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0; 8192];
            assert!(socket.read(&mut request).await.unwrap() > 0);
            socket.write_all(b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 13\r\nConnection: close\r\n\r\nsecret-api-key").await.unwrap();
        });
        let settings = Settings::default();
        let result = completion(
            &format!("http://{address}"),
            Some("secret-api-key"),
            &settings,
            &[],
            json!({}),
            32,
            Arc::new(AtomicBool::new(false)),
        )
        .await;
        server.await.unwrap();
        assert!(result.unwrap_err().contains("인증"));
        let directory = tempfile::tempdir().unwrap();
        let inference = Inference::new(directory.path().into(), PathBuf::new(), PathBuf::new());
        let result = generate(
            &inference,
            &settings,
            &[],
            json!({}),
            32,
            Arc::new(AtomicBool::new(true)),
        )
        .await;
        assert_eq!(result.unwrap_err(), "취소됨");
    }

    #[tokio::test]
    async fn retries_without_schema_when_provider_rejects_it() {
        use tokio::{
            io::{AsyncReadExt, AsyncWriteExt},
            net::TcpListener,
        };
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            for attempt in 0..2 {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut request = vec![0; 16384];
                let count = socket.read(&mut request).await.unwrap();
                let request = String::from_utf8_lossy(&request[..count]);
                assert_eq!(request.contains("response_format"), attempt == 0);
                assert_eq!(request.contains("temperature"), attempt == 0);
                let (status, body) = if attempt == 0 {
                    ("400 Bad Request", "{}")
                } else {
                    (
                        "200 OK",
                        r#"{"choices":[{"message":{"content":"{\"ok\":true}"}}]}"#,
                    )
                };
                socket.write_all(format!("HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
            }
        });
        let settings = Settings {
            mode: "api".into(),
            ..Settings::default()
        };
        let result = completion(
            &format!("http://{address}"),
            None,
            &settings,
            &[],
            json!({}),
            32,
            Arc::new(AtomicBool::new(false)),
        )
        .await
        .unwrap();
        server.await.unwrap();
        assert_eq!(result, json!({"ok":true}));
    }

    #[tokio::test]
    async fn local_schema_error_is_not_retried_without_constraints() {
        use tokio::{
            io::{AsyncReadExt, AsyncWriteExt},
            net::TcpListener,
        };
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0; 8192];
            assert!(socket.read(&mut request).await.unwrap() > 0);
            socket
                .write_all(
                    b"HTTP/1.1 400 Bad Request\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}",
                )
                .await
                .unwrap();
            drop(socket);
            assert!(
                tokio::time::timeout(Duration::from_millis(300), listener.accept())
                    .await
                    .is_err()
            );
        });
        let result = completion(
            &format!("http://{address}"),
            None,
            &Settings::default(),
            &[],
            json!({}),
            32,
            Arc::new(AtomicBool::new(false)),
        )
        .await;
        assert!(result.unwrap_err().contains("400"));
        server.await.unwrap();
    }

    #[tokio::test]
    async fn cancels_during_body_read_and_never_retries_accepted_broken_response() {
        use tokio::{
            io::{AsyncReadExt, AsyncWriteExt},
            net::TcpListener,
        };
        for pending in [true, false] {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let (started, ready) = tokio::sync::oneshot::channel();
            let server = tokio::spawn(async move {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut request = [0; 8192];
                assert!(socket.read(&mut request).await.unwrap() > 0);
                socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 10000\r\nConnection: close\r\n\r\nsecret-api-key").await.unwrap();
                started.send(()).unwrap();
                if pending {
                    tokio::time::sleep(Duration::from_secs(5)).await;
                }
                drop(socket);
                assert!(
                    tokio::time::timeout(Duration::from_millis(200), listener.accept())
                        .await
                        .is_err()
                );
            });
            let cancel = Arc::new(AtomicBool::new(false));
            let url = format!("http://{address}");
            let settings = Settings::default();
            let response = completion(
                &url,
                Some("secret-api-key"),
                &settings,
                &[],
                json!({}),
                32,
                cancel.clone(),
            );
            let cancel_after_headers = async {
                ready.await.unwrap();
                if pending {
                    cancel.store(true, Ordering::Release);
                }
            };
            let (result, ()) = tokio::time::timeout(Duration::from_secs(2), async {
                tokio::join!(response, cancel_after_headers)
            })
            .await
            .expect("response cancellation must not wait for the body timeout");
            let error = result.unwrap_err();
            assert!(!error.contains("secret-api-key"));
            if pending {
                assert_eq!(error, "취소됨");
                server.abort();
            } else {
                server.await.unwrap();
            }
        }
    }
}
