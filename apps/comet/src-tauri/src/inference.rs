use crate::{
    models,
    types::{ApiKeyInput, ApiProvider, ChatMessage, LocalModel, LocalModelTest, Settings},
};
use futures_util::StreamExt;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    path::PathBuf,
    process::Stdio,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, OnceLock,
    },
    time::{Duration, Instant},
};
use tokio::{
    process::{Child, Command},
    sync::Mutex,
};

mod providers;

type RequestBegin = Arc<dyn Fn() -> Option<u64> + Send + Sync>;
type RequestCompleted = Arc<dyn Fn(RequestReport, u64) + Send + Sync>;

struct RequestObserver {
    begin: RequestBegin,
    completed: RequestCompleted,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RequestOutcome {
    Success,
    Error,
    Cancelled,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct RequestReport {
    pub provider: &'static str,
    pub model_family: &'static str,
    pub model_source: &'static str,
    pub outcome: RequestOutcome,
    pub duration_ms: u64,
}

#[derive(Clone, Copy)]
struct RequestSelection {
    provider: &'static str,
    family: &'static str,
    source: &'static str,
}

fn model_family(model: &str) -> &'static str {
    let model = model.trim().to_ascii_lowercase();
    if model.is_empty() {
        return "unspecified";
    }
    if model == "custom" {
        return "custom";
    }
    if ["o1", "o3", "o4"].iter().any(|prefix| {
        model == *prefix
            || model
                .strip_prefix(*prefix)
                .is_some_and(|suffix| suffix.starts_with('-'))
    }) {
        return "o_series";
    }
    [
        "qwen",
        "gemma",
        "ministral",
        "kanana",
        "gpt",
        "claude",
        "gemini",
        "glm",
    ]
    .into_iter()
    .find(|family| model.starts_with(*family))
    .unwrap_or("other")
}

fn request_selection(settings: &Settings) -> Option<RequestSelection> {
    let (provider, family, source) = match settings.mode.as_str() {
        "local" => {
            let family = match settings.local_model {
                LocalModel::Qwen35_4B
                | LocalModel::Qwen35_9B
                | LocalModel::Qwen35_27B
                | LocalModel::Qwen38_2B
                | LocalModel::Qwen38_4B
                | LocalModel::Qwen38_9B => "qwen",
                LocalModel::Gemma4E4B | LocalModel::Gemma4_12B => "gemma",
                LocalModel::Ministral3_8B
                | LocalModel::Ministral3_14B
                | LocalModel::Ministral3_14BQ5 => "ministral",
                LocalModel::Kanana15_2_1B | LocalModel::Kanana15_8B => "kanana",
                LocalModel::Custom => "custom",
            };
            (
                "local",
                family,
                if settings.local_model == LocalModel::Custom {
                    "custom_file"
                } else {
                    "catalog"
                },
            )
        }
        "chatgpt" => ("chatgpt", model_family(&settings.chatgpt_model), "service"),
        "apple" => ("apple", "system_language_model", "os"),
        "api" => {
            let provider = match settings.api_provider {
                ApiProvider::Custom => "custom",
                ApiProvider::Claude => "claude",
                ApiProvider::Gemini => "gemini",
                ApiProvider::Glm => "glm",
            };
            (provider, model_family(&settings.api_model), "service")
        }
        _ => return None,
    };
    Some(RequestSelection {
        provider,
        family,
        source,
    })
}

pub(crate) struct RequestTelemetry {
    observer: Option<Arc<RequestObserver>>,
    selection: Option<RequestSelection>,
    started: OnceLock<Option<(Instant, u64)>>,
    completed: bool,
    cancel: Arc<AtomicBool>,
}

impl RequestTelemetry {
    fn new(inference: &Inference, settings: &Settings, cancel: Arc<AtomicBool>) -> Self {
        Self {
            observer: inference.request_observer.get().cloned(),
            selection: request_selection(settings),
            started: OnceLock::new(),
            completed: false,
            cancel,
        }
    }

    pub(crate) fn dispatched(&self) {
        self.started.get_or_init(|| {
            let observer = self.observer.as_ref()?;
            let lease =
                std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| (observer.begin)()))
                    .ok()??;
            Some((Instant::now(), lease))
        });
    }

    fn finish<T>(&mut self, result: &Result<T, String>) {
        self.completed = true;
        let outcome = match result {
            Ok(_) => RequestOutcome::Success,
            Err(error) if self.cancel.load(Ordering::Acquire) || error == "취소됨" => {
                RequestOutcome::Cancelled
            }
            Err(_) => RequestOutcome::Error,
        };
        self.report(outcome);
    }

    fn report(&self, outcome: RequestOutcome) {
        let (Some(observer), Some(selection), Some(Some((started, lease)))) =
            (&self.observer, self.selection, self.started.get())
        else {
            return;
        };
        let report = RequestReport {
            provider: selection.provider,
            model_family: selection.family,
            model_source: selection.source,
            outcome,
            duration_ms: started.elapsed().as_millis().min(u64::MAX as u128) as u64,
        };
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            (observer.completed)(report, *lease);
        }));
    }
}

impl Drop for RequestTelemetry {
    fn drop(&mut self) {
        if !self.completed {
            self.report(
                if !std::thread::panicking() && self.cancel.load(Ordering::Acquire) {
                    RequestOutcome::Cancelled
                } else {
                    RequestOutcome::Error
                },
            );
        }
    }
}

struct LocalServer {
    path: PathBuf,
    context_tokens: u32,
    child: Child,
    url: String,
    key: String,
}

pub(crate) const LOCAL_WIDGET_CONTEXT_TOKENS: u32 = 16384;
pub(crate) const LOCAL_WIDGET_REASONING_TOKENS: u32 = 4096;
pub(crate) const LOCAL_WIDGET_OUTPUT_TOKENS: u32 = 4096;

#[derive(Clone, Copy)]
struct GenerationBudget {
    context_tokens: u32,
    output_tokens: u32,
    reasoning_tokens: u32,
    timeout: Duration,
}

impl GenerationBudget {
    fn conversation(settings: &Settings, output_tokens: u32) -> Self {
        let reasoning = settings.mode == "local" && settings.local_reasoning_enabled;
        Self {
            context_tokens: if reasoning { 8192 } else { 4096 },
            output_tokens: output_tokens.min(2048),
            reasoning_tokens: if reasoning { 2048 } else { 0 },
            timeout: Duration::from_secs(if reasoning { 300 } else { 180 }),
        }
    }

    fn widget(settings: &Settings, output_tokens: u32) -> Self {
        if settings.mode != "local" {
            return Self::conversation(settings, output_tokens);
        }
        Self {
            context_tokens: LOCAL_WIDGET_CONTEXT_TOKENS,
            output_tokens: output_tokens.min(LOCAL_WIDGET_OUTPUT_TOKENS),
            reasoning_tokens: LOCAL_WIDGET_REASONING_TOKENS,
            timeout: Duration::from_secs(600),
        }
    }

    fn organizer(settings: &Settings, output_tokens: u32) -> Self {
        if settings.mode != "local" {
            return Self::conversation(settings, output_tokens);
        }
        Self {
            context_tokens: LOCAL_WIDGET_CONTEXT_TOKENS,
            output_tokens: output_tokens.min(2048),
            reasoning_tokens: 0,
            timeout: Duration::from_secs(180),
        }
    }
}

pub struct Inference {
    pub app_data: PathBuf,
    pub(crate) chatgpt: crate::chatgpt::Service,
    sidecar_path: PathBuf,
    runtime_dir: PathBuf,
    local: Mutex<Option<LocalServer>>,
    request_observer: OnceLock<Arc<RequestObserver>>,
}
impl Inference {
    pub fn new(app_data: PathBuf, sidecar_path: PathBuf, runtime_dir: PathBuf) -> Self {
        Self {
            chatgpt: crate::chatgpt::Service::new(&app_data),
            app_data,
            sidecar_path,
            runtime_dir,
            local: Mutex::new(None),
            request_observer: OnceLock::new(),
        }
    }

    pub(crate) fn configure_chatgpt(&self, identifier: &str) -> Result<(), String> {
        self.chatgpt.configure(identifier)
    }

    pub(crate) fn observe_requests(&self, begin: RequestBegin, completed: RequestCompleted) {
        let _ = self
            .request_observer
            .set(Arc::new(RequestObserver { begin, completed }));
    }
}

fn is_loopback_api_url(url: &reqwest::Url) -> bool {
    matches!(
        url.host_str(),
        Some("localhost" | "127.0.0.1" | "[::1]" | "::1")
    )
}

fn validated_api_url(settings: &Settings) -> Result<reqwest::Url, String> {
    let base_url = settings
        .api_provider
        .base_url()
        .unwrap_or(settings.base_url.trim());
    let url = reqwest::Url::parse(base_url).map_err(|_| "API 주소가 올바르지 않습니다.")?;
    if (url.scheme() != "https" && !(url.scheme() == "http" && is_loopback_api_url(&url)))
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
    Ok(url)
}

pub(crate) fn endpoint(settings: &Settings) -> Result<String, String> {
    let url = validated_api_url(settings)?;
    Ok(url.as_str().trim_end_matches('/').to_string())
}

fn allows_keyless_api(settings: &Settings) -> bool {
    validated_api_url(settings).is_ok_and(|url| is_loopback_api_url(&url))
}

const API_SERVICE: &str = "space.starlight.comet.api";

fn account(settings: &Settings) -> Result<String, String> {
    let url = endpoint(settings)?;
    let identity = match settings.api_provider {
        ApiProvider::Custom => url,
        ApiProvider::Claude => format!("claude:{url}"),
        ApiProvider::Gemini => format!("gemini:{url}"),
        ApiProvider::Glm => format!("glm:{url}"),
    };
    Ok(hex::encode(Sha256::digest(identity.as_bytes())))
}

fn credential(settings: &Settings) -> Result<keyring::Entry, String> {
    let account = account(settings)?;
    keyring::Entry::new(API_SERVICE, &account)
        .map_err(|_| "시스템 자격 증명 저장소에 접근할 수 없습니다.".into())
}
fn legacy_credential(settings: &Settings) -> Result<keyring::Entry, String> {
    let account = account(settings)?;
    let service = crate::legacy_names::api_service();
    keyring::Entry::new(&service, &account)
        .map_err(|_| "시스템 자격 증명 저장소에 접근할 수 없습니다.".into())
}
pub fn has_api_key(settings: &Settings) -> bool {
    saved_key(settings).ok().flatten().is_some()
}
pub fn api_key_providers(settings: &Settings) -> Vec<ApiProvider> {
    settings
        .api_profiles
        .iter()
        .filter_map(|(provider, profile)| {
            has_api_key(&settings.with_api_profile(*provider, profile)).then_some(*provider)
        })
        .collect()
}

pub(crate) fn validated_api_keys(
    settings: &Settings,
    keys: Option<&std::collections::BTreeMap<ApiProvider, ApiKeyInput>>,
) -> Result<Vec<(Settings, String)>, String> {
    let Some(keys) = keys else {
        return Ok(Vec::new());
    };
    keys.iter()
        .map(|(provider, input)| {
            let profile = settings
                .api_profiles
                .get(provider)
                .ok_or("API 키에 연결할 설정을 찾을 수 없습니다.")?;
            let configured = settings.with_api_profile(*provider, profile);
            // Compare independently as custom so a fixed provider cannot hide a mismatched key destination.
            let supplied = Settings {
                base_url: input.base_url.clone(),
                api_provider: ApiProvider::Custom,
                ..configured.clone()
            };
            let profile_url = Settings {
                api_provider: ApiProvider::Custom,
                ..configured.clone()
            };
            if endpoint(&configured)? != endpoint(&supplied)?
                || endpoint(&configured)? != endpoint(&profile_url)?
            {
                return Err(
                    "API 키를 입력한 서비스 주소가 바뀌었습니다. 키를 다시 입력해 주세요.".into(),
                );
            }
            validate_api_key(&input.key)?;
            Ok((configured, input.key.trim().to_owned()))
        })
        .collect()
}
pub fn api_credentials_ready(settings: &Settings) -> bool {
    allows_keyless_api(settings) || has_api_key(settings)
}
fn api_key_for_request(
    settings: &Settings,
    supplied: Option<String>,
) -> Result<Option<String>, String> {
    let local = allows_keyless_api(settings);
    let key = match supplied
        .map(|key| key.trim().to_string())
        .filter(|key| !key.is_empty())
    {
        Some(key) => Some(key),
        None if local => saved_key(settings).ok().flatten(),
        None => saved_key(settings)?,
    }
    .filter(|key| !key.trim().is_empty());
    if key.is_none() && !local {
        return Err("설정에서 API 키를 입력해 주세요.".into());
    }
    Ok(key)
}
fn validate_api_key(key: &str) -> Result<(), String> {
    if key.trim().is_empty() || key.len() > 8192 || key.contains(['\r', '\n']) {
        return Err("API 키가 올바르지 않습니다.".into());
    }
    Ok(())
}
pub fn set_api_key(settings: &Settings, key: &str) -> Result<(), String> {
    validate_api_key(key)?;
    credential(settings)?
        .set_password(key.trim())
        .map_err(|_| String::from("API 키를 시스템 자격 증명 저장소에 저장할 수 없습니다."))?;
    if let Ok(entry) = legacy_credential(settings) {
        let _ = entry.delete_credential();
    }
    Ok(())
}
pub fn clear_api_key(settings: &Settings) -> Result<(), String> {
    match credential(settings)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => {}
        Err(_) => return Err("API 키 삭제에 실패했습니다.".into()),
    }
    match legacy_credential(settings)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("API 키 삭제에 실패했습니다.".into()),
    }
}
fn saved_key(settings: &Settings) -> Result<Option<String>, String> {
    let current = credential(settings)?;
    match current.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => migrate_legacy_key(&current, &legacy_credential(settings)?),
        Err(_) => Err("시스템 자격 증명 저장소에서 API 키를 읽을 수 없습니다.".into()),
    }
}
fn migrate_legacy_key(
    current: &keyring::Entry,
    legacy: &keyring::Entry,
) -> Result<Option<String>, String> {
    match legacy.get_password() {
        Ok(key) => {
            if current.set_password(&key).is_ok() {
                let _ = legacy.delete_credential();
            }
            Ok(Some(key))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("시스템 자격 증명 저장소에서 API 키를 읽을 수 없습니다.".into()),
    }
}
fn client(url: &str) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(180));
    if reqwest::Url::parse(url).is_ok_and(|url| is_loopback_api_url(&url)) {
        builder = builder.no_proxy();
    }
    builder.build().map_err(|_| "HTTP 초기화 실패".into())
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
    context_tokens: u32,
    cancel: Arc<AtomicBool>,
) -> Result<(String, String), String> {
    let mut state = inference.local.lock().await;
    let path = models::selected_path(&inference.app_data, settings)
        .filter(|_| models::selected_ready(&inference.app_data, settings));
    if let Some(server) = state.as_mut() {
        if path.as_ref() == Some(&server.path)
            && context_tokens == server.context_tokens
            && matches!(server.child.try_wait(), Ok(None))
        {
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
            &context_tokens.to_string(),
            "--parallel",
            "1",
            "--sleep-idle-seconds",
            "120",
            "--jinja",
            "--reasoning-format",
            "deepseek",
            "--reasoning-budget",
            "-1",
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
    crate::sidecar::configure_runtime(command.as_std_mut(), &inference.runtime_dir)?;
    if cfg!(target_os = "macos") {
        command.args(["--n-gpu-layers", "auto"]);
    }
    #[cfg(target_os = "windows")]
    command
        .current_dir(&inference.runtime_dir)
        .creation_flags(0x08000000);
    let mut child = command.spawn().map_err(|_| {
        "로컬 실행기를 시작하지 못했습니다. 실행 파일과 라이브러리를 확인해 주세요."
    })?;
    let http = client(&url)?;
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
                context_tokens,
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
    let Ok(http) = client(&server.url) else {
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
#[cfg(test)]
async fn completion(
    url: &str,
    key: Option<&str>,
    settings: &Settings,
    messages: &[ChatMessage],
    schema: Value,
    budget: GenerationBudget,
    cancel: Arc<AtomicBool>,
) -> Result<Value, String> {
    completion_observed(url, key, settings, messages, schema, budget, cancel, None).await
}

async fn completion_observed(
    url: &str,
    key: Option<&str>,
    settings: &Settings,
    messages: &[ChatMessage],
    schema: Value,
    budget: GenerationBudget,
    cancel: Arc<AtomicBool>,
    telemetry: Option<&RequestTelemetry>,
) -> Result<Value, String> {
    if cancel.load(Ordering::Acquire) {
        return Err("취소됨".into());
    }
    tokio::select! {
        _ = models::cancelled(cancel.clone()) => Err("취소됨".into()),
        result = completion_request(url, key, settings, messages, schema, budget, cancel.clone(), telemetry) => result,
    }
}

fn local_messages(messages: &[ChatMessage]) -> Vec<ChatMessage> {
    let mut result: Vec<ChatMessage> = Vec::new();
    let mut has_user = false;
    for message in messages {
        // Character-led conversations still need a user role before their first reply.
        if message.role == "assistant" && !has_user {
            result.push(ChatMessage {
                role: "user".into(),
                content: String::new(),
            });
            has_user = true;
        }
        has_user |= message.role == "user";
        if let Some(previous) = result.last_mut().filter(|last| last.role == message.role) {
            previous.content.push_str("\n\n");
            previous.content.push_str(&message.content);
        } else {
            result.push(message.clone());
        }
    }
    result
}

fn parse_generated_json(content: &str) -> Result<Value, String> {
    serde_json::from_str(content).map_err(|_| {
        "모델이 요청한 JSON 형식으로 답하지 않았습니다. 모델 설정을 확인해 주세요.".into()
    })
}

async fn local_completion_without_reasoning(
    http: &reqwest::Client,
    url: &str,
    key: Option<&str>,
    mut payload: Value,
    budget: GenerationBudget,
    cancel: Arc<AtomicBool>,
    telemetry: Option<&RequestTelemetry>,
) -> Result<Value, String> {
    let base = url.trim_end_matches('/');
    let base = base.strip_suffix("/v1").unwrap_or(base);
    for path in ["apply-template", "completion"] {
        if cancel.load(Ordering::Acquire) {
            return Err("취소됨".into());
        }
        let mut request = http
            .post(format!("{base}/{path}"))
            .timeout(budget.timeout)
            .json(&payload);
        if let Some(value) = key.filter(|s| !s.is_empty()) {
            request = request.bearer_auth(value);
        }
        if path == "completion" {
            if let Some(telemetry) = telemetry {
                telemetry.dispatched();
            }
        }
        let response = request.send().await.map_err(|error| {
            if error.is_timeout() {
                "API 응답 시간이 초과되었습니다."
            } else {
                "API에 연결할 수 없습니다. 주소·네트워크를 확인해 주세요."
            }
        })?;
        if !response.status().is_success() {
            return Err(match response.status().as_u16() {
                401 | 403 => "API 인증에 실패했습니다. 이 주소에 저장한 키를 확인해 주세요.".into(),
                429 => "API 요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.".into(),
                status => format!("API 요청 실패 (HTTP {status})."),
            });
        }
        let body = response_body(response).await?;
        if cancel.load(Ordering::Acquire) {
            return Err("취소됨".into());
        }
        if path == "apply-template" {
            let prompt = body
                .get("prompt")
                .and_then(Value::as_str)
                .filter(|prompt| !prompt.trim().is_empty())
                .ok_or("로컬 모델이 대화 입력을 만들지 못했습니다.")?;
            payload = json!({
                "prompt":prompt,
                "json_schema":payload["response_format"]["json_schema"]["schema"],
                "n_predict":budget.output_tokens,
                "temperature":payload["temperature"],
                "stream":false,
                "reasoning_budget_tokens":0,
            });
            continue;
        }
        if body.get("stop_type").and_then(Value::as_str) == Some("limit")
            || body.get("stopped_limit").and_then(Value::as_bool) == Some(true)
        {
            return Err("모델 응답이 토큰 한도에 도달했습니다. 요청을 더 작게 나눠 주세요.".into());
        }
        if body.get("truncated").and_then(Value::as_bool) == Some(true) {
            return Err(
                "모델 입력이 컨텍스트 한도에 도달했습니다. 요청을 더 작게 나눠 주세요.".into(),
            );
        }
        if body.get("stop").and_then(Value::as_bool) != Some(true)
            || !matches!(
                body.get("stop_type").and_then(Value::as_str),
                Some("eos" | "word")
            )
        {
            return Err("로컬 모델의 응답이 정상적으로 끝나지 않았습니다.".into());
        }
        let content = body
            .get("content")
            .and_then(Value::as_str)
            .ok_or("API 응답에 대화 내용이 없습니다.")?;
        return parse_generated_json(content);
    }
    Err("API 요청 실패".into())
}

async fn completion_request(
    url: &str,
    key: Option<&str>,
    settings: &Settings,
    messages: &[ChatMessage],
    schema: Value,
    budget: GenerationBudget,
    cancel: Arc<AtomicBool>,
    telemetry: Option<&RequestTelemetry>,
) -> Result<Value, String> {
    let http = client(url)?;
    if settings.mode == "api" && settings.api_provider == ApiProvider::Claude {
        return providers::claude_completion(
            &http, url, key, settings, messages, schema, budget, cancel, telemetry,
        )
        .await;
    }
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
    payload[token_parameter] = json!(budget.output_tokens + budget.reasoning_tokens);
    if settings.mode == "api" {
        providers::configure_compatible_payload(&mut payload, settings, messages, &schema, budget);
    }
    attach_to_last_user(&mut payload["messages"], "compatible");
    if settings.mode == "local" {
        // Some GGUF templates require alternating roles even when filtered history omits a reply.
        payload["messages"] = json!(local_messages(messages));
        payload["chat_template_kwargs"] = json!({"enable_thinking":budget.reasoning_tokens > 0});
        payload["reasoning_format"] = json!("deepseek");
        payload["reasoning_budget_tokens"] = json!(budget.reasoning_tokens);
        if budget.reasoning_tokens == 0 {
            // Native completion keeps JSON grammar separate from the chat reasoning parser.
            return tokio::time::timeout(
                budget.timeout,
                local_completion_without_reasoning(
                    &http, url, key, payload, budget, cancel, telemetry,
                ),
            )
            .await
            .map_err(|_| "API 응답 시간이 초과되었습니다.".to_string())?;
        }
    }
    for attempt in 0..2 {
        let mut request = http
            .post(format!("{url}/chat/completions"))
            .timeout(budget.timeout)
            .json(&payload);
        if let Some(value) = key.filter(|s| !s.is_empty()) {
            request = request.bearer_auth(value);
        }
        if let Some(telemetry) = telemetry {
            telemetry.dispatched();
        }
        let response = request.send().await.map_err(|error| {
            if error.is_timeout() {
                "API 응답 시간이 초과되었습니다."
            } else {
                "API에 연결할 수 없습니다. 주소·네트워크를 확인해 주세요."
            }
        })?;
        let status = response.status();
        if attempt == 0
            && settings.mode == "api"
            && settings.api_provider == ApiProvider::Custom
            && matches!(status.as_u16(), 400 | 422)
        {
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
        if settings.mode == "api" && settings.api_provider != ApiProvider::Custom {
            providers::validate_compatible_response(&body)?;
        }
        if settings.mode == "local"
            && body
                .pointer("/choices/0/finish_reason")
                .and_then(Value::as_str)
                == Some("length")
        {
            return Err("모델 응답이 토큰 한도에 도달했습니다. 요청을 더 작게 나눠 주세요.".into());
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
        let result = parse_generated_json(json_text)?;
        if settings.mode == "api"
            && settings.api_provider != ApiProvider::Custom
            && !result.is_object()
        {
            return Err("모델이 요청한 JSON 객체로 답하지 않았습니다.".into());
        }
        return Ok(result);
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
    generate_with_budget(
        inference,
        settings,
        messages,
        schema,
        GenerationBudget::conversation(settings, max_tokens),
        cancel,
    )
    .await
}

pub async fn generate_widget(
    inference: &Inference,
    settings: &Settings,
    messages: &[ChatMessage],
    schema: Value,
    max_tokens: u32,
    cancel: Arc<AtomicBool>,
) -> Result<Value, String> {
    if settings.mode == "apple" {
        return Err(crate::apple_models::WIDGET_UNSUPPORTED.into());
    }
    generate_with_budget(
        inference,
        settings,
        messages,
        schema,
        GenerationBudget::widget(settings, max_tokens),
        cancel,
    )
    .await
}

/// A confirmation PDF or image sent with the last user message. It travels in a
/// task-local so the provider paths keep their signatures; only drafts set it.
#[derive(Clone)]
pub(crate) struct Attachment {
    pub(crate) name: String,
    pub(crate) mime: String,
    pub(crate) data: String,
}

tokio::task_local! {
    static ATTACHMENT: Attachment;
}

pub(crate) fn current_attachment() -> Option<Attachment> {
    ATTACHMENT.try_with(Clone::clone).ok()
}

/// Rewrites the last user turn as text plus the attached file in the given wire format.
pub(crate) fn attach_to_last_user(messages: &mut Value, format: &str) {
    let Some(file) = current_attachment() else {
        return;
    };
    let Some(turn) = messages
        .as_array_mut()
        .and_then(|turns| turns.iter_mut().rev().find(|turn| turn["role"] == "user"))
    else {
        return;
    };
    let text = turn["content"].as_str().unwrap_or_default().to_string();
    let data_url = format!("data:{};base64,{}", file.mime, file.data);
    let pdf = file.mime == "application/pdf";
    turn["content"] = match format {
        "claude" => json!([
            {"type": if pdf {"document"} else {"image"}, "source": {"type":"base64","media_type":file.mime,"data":file.data}},
            {"type":"text","text":text}
        ]),
        "responses" => json!([
            if pdf {
                json!({"type":"input_file","filename":file.name,"file_data":data_url})
            } else {
                json!({"type":"input_image","image_url":data_url})
            },
            {"type":"input_text","text":text}
        ]),
        _ => json!([
            {"type":"text","text":text},
            if pdf {
                json!({"type":"file","file":{"filename":file.name,"file_data":data_url}})
            } else {
                json!({"type":"image_url","image_url":{"url":data_url}})
            }
        ]),
    };
}

pub(crate) async fn generate_with_attachment(
    inference: &Inference,
    settings: &Settings,
    messages: &[ChatMessage],
    schema: Value,
    max_tokens: u32,
    attachment: Attachment,
    cancel: Arc<AtomicBool>,
) -> Result<Value, String> {
    if settings.mode == "apple" {
        return Err("Apple 온디바이스 AI는 PDF·이미지 첨부를 지원하지 않아요. 직접 입력하거나 다른 AI를 직접 선택해 주세요.".into());
    }
    if settings.mode == "local" {
        return Err("이 기기의 모델은 PDF·이미지를 읽지 못해요. 직접 입력하거나 API·ChatGPT 연결을 사용해 주세요.".into());
    }
    ATTACHMENT
        .scope(
            attachment,
            generate_with_budget(
                inference,
                settings,
                messages,
                schema,
                GenerationBudget::organizer(settings, max_tokens),
                cancel,
            ),
        )
        .await
}

pub(crate) async fn generate_organizer(
    inference: &Inference,
    settings: &Settings,
    messages: &[ChatMessage],
    schema: Value,
    max_tokens: u32,
    cancel: Arc<AtomicBool>,
) -> Result<Value, String> {
    generate_with_budget(
        inference,
        settings,
        messages,
        schema,
        GenerationBudget::organizer(settings, max_tokens),
        cancel,
    )
    .await
}

async fn generate_with_budget(
    inference: &Inference,
    settings: &Settings,
    messages: &[ChatMessage],
    schema: Value,
    budget: GenerationBudget,
    cancel: Arc<AtomicBool>,
) -> Result<Value, String> {
    let mut telemetry = RequestTelemetry::new(inference, settings, cancel.clone());
    let result = generate_observed(
        inference, settings, messages, schema, budget, cancel, &telemetry,
    )
    .await;
    telemetry.finish(&result);
    result
}

async fn generate_observed(
    inference: &Inference,
    settings: &Settings,
    messages: &[ChatMessage],
    schema: Value,
    budget: GenerationBudget,
    cancel: Arc<AtomicBool>,
    telemetry: &RequestTelemetry,
) -> Result<Value, String> {
    if cancel.load(Ordering::Acquire) {
        return Err("취소됨".into());
    }
    if settings.mode == "apple" {
        return crate::apple_models::generate(
            messages,
            schema,
            budget.output_tokens,
            budget.timeout,
            cancel,
            telemetry,
        )
        .await;
    }
    if settings.mode == "chatgpt" {
        return crate::chatgpt::generate(
            &inference.chatgpt,
            settings,
            messages,
            schema,
            budget.timeout,
            cancel,
            Some(telemetry),
        )
        .await;
    }
    if !matches!(settings.mode.as_str(), "local" | "api") {
        return Err("지원하지 않는 AI 선택이에요. 설정에서 사용할 AI를 직접 선택해 주세요.".into());
    }
    let local = settings.mode == "local";
    let (url, key, configured) = if local {
        let (url, key) =
            local_endpoint(inference, settings, budget.context_tokens, cancel.clone()).await?;
        let mut configured = settings.clone();
        configured.api_model = "local".into();
        configured.api_token_parameter = "max_tokens".into();
        (format!("{url}/v1"), Some(key), configured)
    } else {
        (
            endpoint(settings)?,
            api_key_for_request(settings, None)?,
            settings.clone(),
        )
    };
    let result = tokio::select! {
        _ = models::cancelled(cancel.clone()) => Err("취소됨".into()),
        result = completion_observed(&url, key.as_deref(), &configured, messages, schema, budget, cancel.clone(), Some(telemetry)) => result,
    };
    if local && cancel.load(Ordering::Acquire) {
        stop_local(inference).await;
    }
    result
}

pub async fn test_connection(
    inference: &Inference,
    settings: &Settings,
    key: Option<String>,
    cancel: Arc<AtomicBool>,
) -> Result<String, String> {
    if cancel.load(Ordering::Acquire) {
        return Err("취소됨".into());
    }
    if settings.mode != "api" {
        return Err("API 연결 테스트는 API를 직접 선택했을 때만 사용할 수 있어요.".into());
    }
    let url = endpoint(settings)?;
    if settings.api_model.trim().is_empty() {
        return Err("API 모델 이름을 입력해 주세요.".into());
    }
    let selected_key = api_key_for_request(settings, key)?;
    let messages = vec![ChatMessage {
        role: "user".into(),
        content: "Return only this JSON object: {\"ok\":true}".into(),
    }];
    let mut telemetry = RequestTelemetry::new(inference, settings, cancel.clone());
    let result = async {
        let value = completion_observed(&url, selected_key.as_deref(), settings, &messages, json!({"type":"object","properties":{"ok":{"type":"boolean"}},"required":["ok"],"additionalProperties":false}), GenerationBudget::conversation(settings, 32), cancel, Some(&telemetry)).await?;
        if value.get("ok").and_then(Value::as_bool) != Some(true) {
            return Err("API 연결은 되었지만 JSON 응답 검증에 실패했습니다.".into());
        }
        Ok("API 연결과 JSON 응답을 확인했습니다.".into())
    }.await;
    telemetry.finish(&result);
    result
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
    #[tokio::test]
    async fn apple_and_unknown_modes_never_fall_through_to_saved_api_credentials() {
        let directory = tempfile::tempdir().unwrap();
        let inference = Inference::new(directory.path().into(), PathBuf::new(), PathBuf::new());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let messages = [ChatMessage {
            role: "user".into(),
            content: "x".repeat(13_000),
        }];
        let schema = json!({"type":"object","properties":{"text":{"type":"string"}},"required":["text"],"additionalProperties":false});
        for mode in ["apple", "unknown"] {
            let settings = Settings {
                mode: mode.into(),
                base_url: format!("http://{}/v1", listener.local_addr().unwrap()),
                api_model: "saved-api".into(),
                ..Settings::default()
            };
            assert!(generate(
                &inference,
                &settings,
                &messages,
                schema.clone(),
                128,
                Arc::new(AtomicBool::new(false))
            )
            .await
            .is_err());
            assert!(test_connection(
                &inference,
                &settings,
                None,
                Arc::new(AtomicBool::new(false))
            )
            .await
            .is_err());
        }
        assert!(
            tokio::time::timeout(Duration::from_millis(50), listener.accept())
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn apple_unsupported_capabilities_and_cancelled_requests_do_not_dispatch() {
        let directory = tempfile::tempdir().unwrap();
        let inference = Inference::new(directory.path().into(), PathBuf::new(), PathBuf::new());
        let settings = Settings {
            mode: "apple".into(),
            ..Settings::default()
        };
        let messages = [ChatMessage {
            role: "user".into(),
            content: "hello".into(),
        }];
        let cancel = Arc::new(AtomicBool::new(false));
        assert!(generate_widget(
            &inference,
            &settings,
            &messages,
            json!({}),
            128,
            cancel.clone()
        )
        .await
        .unwrap_err()
        .contains("위젯"));
        let file = Attachment {
            name: "example.png".into(),
            mime: "image/png".into(),
            data: String::new(),
        };
        assert!(generate_with_attachment(
            &inference,
            &settings,
            &messages,
            json!({}),
            128,
            file,
            cancel.clone()
        )
        .await
        .unwrap_err()
        .contains("첨부"));
        cancel.store(true, Ordering::Release);
        assert_eq!(
            generate(&inference, &settings, &messages, json!({}), 128, cancel)
                .await
                .unwrap_err(),
            "취소됨"
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_credentials_use_secret_service_instead_of_the_mock_backend() {
        // Inspect the builder only: no connection, credential read or write.
        let builder = keyring::default::default_credential_builder();
        assert!(builder
            .as_any()
            .is::<keyring::secret_service::SsCredentialBuilder>());
    }

    use super::*;

    async fn read_completion_request(socket: &mut tokio::net::TcpStream) -> (String, Value) {
        use tokio::io::AsyncReadExt;
        let mut request = Vec::new();
        let (header_end, content_length) = loop {
            let mut chunk = [0; 4096];
            let count = socket.read(&mut chunk).await.unwrap();
            assert!(count > 0 && request.len() + count <= 65536);
            request.extend_from_slice(&chunk[..count]);
            if let Some(index) = request.windows(4).position(|part| part == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&request[..index]).to_ascii_lowercase();
                let length = headers
                    .lines()
                    .find_map(|line| line.strip_prefix("content-length: "))
                    .unwrap()
                    .parse::<usize>()
                    .unwrap();
                if request.len() >= index + 4 + length {
                    break (index + 4, length);
                }
            }
        };
        (
            String::from_utf8_lossy(&request[..header_end]).into_owned(),
            serde_json::from_slice(&request[header_end..header_end + content_length]).unwrap(),
        )
    }

    async fn completion_server(
        responses: Vec<(u16, String)>,
    ) -> (String, tokio::task::JoinHandle<Vec<(String, Value)>>) {
        use tokio::{io::AsyncWriteExt, net::TcpListener};
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let mut requests = Vec::new();
            for (status, body) in responses {
                let (mut socket, _) =
                    tokio::time::timeout(Duration::from_secs(2), listener.accept())
                        .await
                        .expect("expected completion request")
                        .unwrap();
                requests.push(read_completion_request(&mut socket).await);
                // A client may reject an oversized body before the complete write.
                let _ = socket
                    .write_all(
                        format!(
                            "HTTP/1.1 {status} Mock\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                            body.len()
                        )
                        .as_bytes(),
                    )
                    .await;
            }
            assert!(
                tokio::time::timeout(Duration::from_millis(50), listener.accept())
                    .await
                    .is_err()
            );
            requests
        });
        (format!("http://{address}"), server)
    }

    async fn captured_completion(
        settings: &Settings,
        budget: GenerationBudget,
        body: Value,
        messages: &[ChatMessage],
    ) -> (Result<Value, String>, Value) {
        let native = settings.mode == "local" && budget.reasoning_tokens == 0;
        let responses = if native {
            vec![
                (200, json!({"prompt":"formatted chat"}).to_string()),
                (200, json!({"content":body.pointer("/choices/0/message/content"),"stop":true,"stop_type":"eos"}).to_string()),
            ]
        } else {
            vec![(200, body.to_string())]
        };
        let (url, server) = completion_server(responses).await;
        let result = completion(
            &url,
            None,
            settings,
            messages,
            json!({"type":"object","properties":{"ok":{"type":"boolean"}}}),
            budget,
            Arc::new(AtomicBool::new(false)),
        )
        .await;
        let requests = server.await.unwrap();
        if native {
            assert!(requests[0].0.starts_with("POST /apply-template "));
            assert!(requests[1].0.starts_with("POST /completion "));
        } else {
            assert!(requests[0].0.starts_with("POST /chat/completions "));
        }
        (result, requests[0].1.clone())
    }

    fn observed_runtime(
        directory: &std::path::Path,
        begin: RequestBegin,
    ) -> (Inference, Arc<std::sync::Mutex<Vec<(RequestReport, u64)>>>) {
        let inference = Inference::new(directory.into(), PathBuf::new(), PathBuf::new());
        let reports = Arc::new(std::sync::Mutex::new(Vec::new()));
        let received = reports.clone();
        inference.observe_requests(
            begin,
            Arc::new(move |report, lease| {
                received.lock().unwrap().push((report, lease));
            }),
        );
        (inference, reports)
    }

    #[tokio::test]
    async fn analytics_request_reports_real_generation_paths_without_request_content() {
        for (operation, status, body, outcome) in [
            (
                "general",
                200,
                json!({"choices":[{"message":{"content":"{\"ok\":true}"}}]}),
                RequestOutcome::Success,
            ),
            (
                "widget",
                200,
                json!({"choices":[{"message":{"content":"{\"ok\":true}"}}]}),
                RequestOutcome::Success,
            ),
            (
                "organizer",
                200,
                json!({"choices":[{"message":{"content":"{\"ok\":true}"}}]}),
                RequestOutcome::Success,
            ),
            (
                "connection",
                200,
                json!({"choices":[{"message":{"content":"{\"ok\":true}"}}]}),
                RequestOutcome::Success,
            ),
            (
                "general",
                500,
                json!({"error":"private-server-error"}),
                RequestOutcome::Error,
            ),
            (
                "general",
                200,
                json!({"choices":[{"message":{"content":"private-invalid-json"}}]}),
                RequestOutcome::Error,
            ),
        ] {
            let directory = tempfile::tempdir().unwrap();
            let (inference, reports) = observed_runtime(directory.path(), Arc::new(|| Some(17)));
            let (url, server) = completion_server(vec![(status, body.to_string())]).await;
            let settings = Settings {
                mode: "api".into(),
                base_url: url,
                api_model: "private-company-model".into(),
                ..Settings::default()
            };
            let messages = vec![ChatMessage {
                role: "user".into(),
                content: "private-user-prompt".into(),
            }];
            let cancel = Arc::new(AtomicBool::new(false));
            let result = match operation {
                "widget" => {
                    generate_widget(
                        &inference,
                        &settings,
                        &messages,
                        json!({"type":"object"}),
                        128,
                        cancel,
                    )
                    .await
                }
                "organizer" => {
                    generate_organizer(
                        &inference,
                        &settings,
                        &messages,
                        json!({"type":"object"}),
                        128,
                        cancel,
                    )
                    .await
                }
                "connection" => test_connection(&inference, &settings, None, cancel)
                    .await
                    .map(|_| json!({})),
                _ => {
                    generate(
                        &inference,
                        &settings,
                        &messages,
                        json!({"type":"object"}),
                        128,
                        cancel,
                    )
                    .await
                }
            };
            assert_eq!(result.is_ok(), outcome == RequestOutcome::Success);
            server.await.unwrap();
            let reports = reports.lock().unwrap();
            assert_eq!(reports.len(), 1);
            assert_eq!(reports[0].1, 17);
            assert_eq!(reports[0].0.provider, "custom");
            assert_eq!(reports[0].0.model_family, "other");
            assert_eq!(reports[0].0.model_source, "service");
            assert_eq!(reports[0].0.outcome, outcome);
            assert!(!format!("{reports:?}").contains("private"));
        }
    }

    #[tokio::test]
    async fn analytics_request_excludes_preparation_and_pre_cancelled_work() {
        let directory = tempfile::tempdir().unwrap();
        let starts = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let counted = starts.clone();
        let (inference, reports) = observed_runtime(
            directory.path(),
            Arc::new(move || {
                counted.fetch_add(1, Ordering::SeqCst);
                Some(17)
            }),
        );
        for (settings, cancelled) in [
            (Settings::default(), true),
            (Settings::default(), false),
            (
                Settings {
                    mode: "api".into(),
                    base_url: "http://private.invalid".into(),
                    ..Settings::default()
                },
                false,
            ),
        ] {
            assert!(generate(
                &inference,
                &settings,
                &[],
                json!({"type":"object"}),
                16,
                Arc::new(AtomicBool::new(cancelled))
            )
            .await
            .is_err());
        }
        assert!(test_connection(
            &inference,
            &Settings::default(),
            None,
            Arc::new(AtomicBool::new(false))
        )
        .await
        .is_err());
        assert_eq!(
            test_connection(
                &inference,
                &Settings::default(),
                None,
                Arc::new(AtomicBool::new(true))
            )
            .await
            .unwrap_err(),
            "취소됨"
        );
        assert_eq!(starts.load(Ordering::SeqCst), 0);
        assert!(reports.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn analytics_request_freezes_start_consent_once_across_compatible_retry() {
        for consented_at_start in [false, true] {
            let directory = tempfile::tempdir().unwrap();
            let starts = Arc::new(std::sync::atomic::AtomicUsize::new(0));
            let counted = starts.clone();
            let (inference, reports) = observed_runtime(
                directory.path(),
                Arc::new(move || {
                    let previous = counted.fetch_add(1, Ordering::SeqCst);
                    (consented_at_start || previous > 0).then_some(17)
                }),
            );
            let (url, server) = completion_server(vec![
                (400, json!({"error":"unsupported schema"}).to_string()),
                (
                    200,
                    json!({"choices":[{"message":{"content":"{\"ok\":true}"}}]}).to_string(),
                ),
            ])
            .await;
            let settings = Settings {
                mode: "api".into(),
                base_url: url,
                api_model: "gpt-test".into(),
                ..Settings::default()
            };
            generate(
                &inference,
                &settings,
                &[],
                json!({"type":"object"}),
                16,
                Arc::new(AtomicBool::new(false)),
            )
            .await
            .unwrap();
            assert_eq!(server.await.unwrap().len(), 2);
            assert_eq!(starts.load(Ordering::SeqCst), 1);
            let reports = reports.lock().unwrap();
            assert_eq!(reports.len(), usize::from(consented_at_start));
            if let Some((report, lease)) = reports.first() {
                assert_eq!(report.outcome, RequestOutcome::Success);
                assert_eq!(report.model_family, "gpt");
                assert_eq!(*lease, 17);
            }
        }
    }

    #[tokio::test]
    async fn analytics_request_distinguishes_cancellation_from_outer_timeout_with_monotonic_duration(
    ) {
        use tokio::net::TcpListener;
        for request_kind in ["generation", "connection"] {
            for termination in ["cancel", "drop_after_cancel", "outer_timeout"] {
                let directory = tempfile::tempdir().unwrap();
                let (inference, reports) =
                    observed_runtime(directory.path(), Arc::new(|| Some(17)));
                let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
                let address = listener.local_addr().unwrap();
                let (sent, received) = tokio::sync::oneshot::channel();
                let (release, released) = tokio::sync::oneshot::channel();
                let server = tokio::spawn(async move {
                    let (mut socket, _) = listener.accept().await.unwrap();
                    read_completion_request(&mut socket).await;
                    sent.send(()).unwrap();
                    let _ = released.await;
                });
                let settings = Settings {
                    mode: "api".into(),
                    base_url: format!("http://{address}"),
                    api_model: "model".into(),
                    ..Settings::default()
                };
                let cancel = Arc::new(AtomicBool::new(false));
                let mut operation = Box::pin(async {
                    if request_kind == "connection" {
                        test_connection(&inference, &settings, None, cancel.clone())
                            .await
                            .map(|_| json!({}))
                    } else {
                        generate(
                            &inference,
                            &settings,
                            &[],
                            json!({"type":"object"}),
                            16,
                            cancel.clone(),
                        )
                        .await
                    }
                });
                tokio::select! {
                    result = &mut operation => panic!("request ended before cancellation: {result:?}"),
                    result = received => result.unwrap(),
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
                match termination {
                    "outer_timeout" => {
                        assert!(tokio::time::timeout(Duration::from_millis(20), operation)
                            .await
                            .is_err());
                    }
                    "drop_after_cancel" => {
                        cancel.store(true, Ordering::Release);
                        drop(operation);
                    }
                    _ => {
                        cancel.store(true, Ordering::Release);
                        assert!(operation.await.is_err());
                    }
                }
                release.send(()).unwrap();
                server.await.unwrap();
                let reports = reports.lock().unwrap();
                assert_eq!(reports.len(), 1);
                assert_eq!(
                    reports[0].0.outcome,
                    if termination == "outer_timeout" {
                        RequestOutcome::Error
                    } else {
                        RequestOutcome::Cancelled
                    }
                );
                assert!(reports[0].0.duration_ms >= 10);
            }
        }
    }

    #[tokio::test]
    async fn analytics_request_marks_named_provider_and_local_native_dispatches() {
        for (settings, responses, provider, family, source) in [
            (Settings { mode: "api".into(), api_provider: ApiProvider::Claude, api_model: "claude-test".into(), ..Settings::default() }, vec![(200, json!({"stop_reason":"end_turn","content":[{"type":"text","text":"{\"ok\":true}"}]}).to_string())], "claude", "claude", "service"),
            (Settings { mode: "api".into(), api_provider: ApiProvider::Gemini, api_model: "gemini-test".into(), ..Settings::default() }, vec![(200, json!({"choices":[{"finish_reason":"stop","message":{"content":"{\"ok\":true}"}}]}).to_string())], "gemini", "gemini", "service"),
            (Settings { mode: "api".into(), api_provider: ApiProvider::Glm, api_model: "glm-test".into(), ..Settings::default() }, vec![(200, json!({"choices":[{"finish_reason":"stop","message":{"content":"{\"ok\":true}"}}]}).to_string())], "glm", "glm", "service"),
            (Settings { local_model: LocalModel::Custom, local_model_path: "/private/model.gguf".into(), ..Settings::default() }, vec![(200, json!({"prompt":"private template"}).to_string()), (200, json!({"content":"{\"ok\":true}","stop":true,"stop_type":"eos"}).to_string())], "local", "custom", "custom_file"),
        ] {
            let directory = tempfile::tempdir().unwrap();
            let (inference, reports) = observed_runtime(directory.path(), Arc::new(|| Some(17)));
            let (url, server) = completion_server(responses).await;
            let cancel = Arc::new(AtomicBool::new(false));
            let mut telemetry = RequestTelemetry::new(&inference, &settings, cancel.clone());
            let result = completion_observed(&url, Some("private-test-key"), &settings, &[], json!({"type":"object"}), GenerationBudget::conversation(&settings, 16), cancel, Some(&telemetry)).await;
            telemetry.finish(&result);
            result.unwrap();
            server.await.unwrap();
            let reports = reports.lock().unwrap();
            assert_eq!(reports.len(), 1);
            assert_eq!((reports[0].0.provider, reports[0].0.model_family, reports[0].0.model_source), (provider, family, source));
            assert!(!format!("{reports:?}").contains("private"));
        }
    }

    #[tokio::test]
    async fn named_provider_protocols_preserve_history_and_use_their_own_json_contract() {
        let messages = vec![
            ChatMessage {
                role: "system".into(),
                content: "Preserve the character.".into(),
            },
            ChatMessage {
                role: "user".into(),
                content: "Remember my tea.".into(),
            },
            ChatMessage {
                role: "assistant".into(),
                content: "I remember.".into(),
            },
            ChatMessage {
                role: "user".into(),
                content: "Hello".into(),
            },
        ];
        let schema = json!({"type":"object","required":["ok"],"properties":{"ok":{"type":"boolean"}},"additionalProperties":false});
        for provider in [ApiProvider::Claude, ApiProvider::Gemini, ApiProvider::Glm] {
            let body = if provider == ApiProvider::Claude {
                json!({"stop_reason":"tool_use","content":[{"type":"tool_use","name":"comet_response","input":{"ok":true}}]})
            } else {
                json!({"choices":[{"message":{"content":"{\"ok\":true}"},"finish_reason":"stop"}]})
            };
            let settings = Settings {
                mode: "api".into(),
                api_provider: provider,
                api_model: "selected-model".into(),
                ..Settings::default()
            };
            let (url, server) = completion_server(vec![(200, body.to_string())]).await;
            let result = completion(
                &url,
                Some("synthetic-key"),
                &settings,
                &messages,
                schema.clone(),
                GenerationBudget::conversation(&settings, 128),
                Arc::new(AtomicBool::new(false)),
            )
            .await
            .unwrap();
            assert_eq!(result, json!({"ok":true}));
            let requests = server.await.unwrap();
            let (headers, payload) = &requests[0];
            assert_eq!(payload["model"], "selected-model");
            let headers = headers.to_ascii_lowercase();
            match provider {
                ApiProvider::Claude => {
                    assert!(headers.starts_with("post /messages "));
                    assert!(headers.contains("x-api-key: synthetic-key"));
                    assert!(headers.contains("anthropic-version: 2023-06-01"));
                    assert!(!headers.contains("authorization:"));
                    assert!(payload["system"]
                        .as_str()
                        .unwrap()
                        .contains("Preserve the character."));
                    assert_eq!(payload["messages"], json!(&messages[1..]));
                    assert_eq!(payload["tools"][0]["input_schema"], schema);
                    assert_eq!(payload["tool_choice"]["type"], "auto");
                    assert!(payload.get("response_format").is_none());
                }
                ApiProvider::Gemini => {
                    assert!(headers.starts_with("post /chat/completions "));
                    assert!(headers.contains("authorization: bearer synthetic-key"));
                    assert_eq!(payload["messages"], json!(messages));
                    assert_eq!(payload["response_format"]["json_schema"]["schema"], schema);
                    assert_eq!(payload["reasoning_effort"], "low");
                    assert!(payload.get("max_completion_tokens").is_none());
                }
                ApiProvider::Glm => {
                    assert!(headers.contains("authorization: bearer synthetic-key"));
                    assert_eq!(payload["response_format"], json!({"type":"json_object"}));
                    assert!(payload["messages"][0]["content"]
                        .as_str()
                        .unwrap()
                        .contains(&schema.to_string()));
                    assert_eq!(
                        payload["messages"].as_array().unwrap()[1..],
                        json!(messages).as_array().unwrap()[..]
                    );
                    assert!(payload.get("max_completion_tokens").is_none());
                }
                _ => unreachable!(),
            }
        }
    }

    #[tokio::test]
    async fn claude_accepts_complete_json_text_and_rejects_incomplete_or_unrelated_tools() {
        let settings = Settings {
            mode: "api".into(),
            api_provider: ApiProvider::Claude,
            ..Settings::default()
        };
        for (body, expected) in [
            (
                json!({"stop_reason":"end_turn","content":[{"type":"text","text":"{\"ok\":true}"}]}),
                true,
            ),
            (
                json!({"stop_reason":"max_tokens","content":[{"type":"text","text":"{\"ok\":true}"}]}),
                false,
            ),
            (
                json!({"stop_reason":"refusal","content":[{"type":"text","text":"{\"ok\":true}"}]}),
                false,
            ),
            (json!({"stop_reason":"pause_turn","content":[]}), false),
            (
                json!({"stop_reason":"tool_use","content":[{"type":"tool_use","name":"other","input":{"ok":true}}]}),
                false,
            ),
            (
                json!({"stop_reason":"tool_use","content":[{"type":"tool_use","name":"comet_response","input":{}},{"type":"tool_use","name":"comet_response","input":{}}]}),
                false,
            ),
            (
                json!({"stop_reason":"end_turn","content":[{"type":"text","text":"not JSON"}]}),
                false,
            ),
        ] {
            let (url, server) = completion_server(vec![(200, body.to_string())]).await;
            let result = completion(
                &url,
                Some("synthetic"),
                &settings,
                &[],
                json!({"type":"object"}),
                GenerationBudget::conversation(&settings, 128),
                Arc::new(AtomicBool::new(false)),
            )
            .await;
            assert_eq!(result.is_ok(), expected, "{body}");
            server.await.unwrap();
        }
    }

    #[tokio::test]
    async fn named_providers_do_not_retry_rejected_requests_and_reject_truncated_json() {
        for provider in [ApiProvider::Claude, ApiProvider::Gemini, ApiProvider::Glm] {
            let settings = Settings {
                mode: "api".into(),
                api_provider: provider,
                ..Settings::default()
            };
            for (status, body) in [
                (400, json!({"error":"synthetic"})),
                (401, json!({"error":"synthetic"})),
                (429, json!({"error":"synthetic"})),
                (
                    200,
                    json!({"choices":[{"finish_reason":"length","message":{"content":"{\"ok\":true}"}}]}),
                ),
                (
                    200,
                    json!({"choices":[{"finish_reason":"stop","message":{"content":"invalid"}}]}),
                ),
            ] {
                let (url, server) = completion_server(vec![(status, body.to_string())]).await;
                let result = completion(
                    &url,
                    Some("synthetic"),
                    &settings,
                    &[],
                    json!({"type":"object"}),
                    GenerationBudget::conversation(&settings, 128),
                    Arc::new(AtomicBool::new(false)),
                )
                .await;
                assert!(result.is_err());
                assert_eq!(server.await.unwrap().len(), 1);
            }
        }
    }

    #[test]
    fn named_endpoints_are_pinned_and_profile_keys_cannot_cross_destinations() {
        let mut accounts = std::collections::BTreeSet::new();
        for provider in [ApiProvider::Claude, ApiProvider::Gemini, ApiProvider::Glm] {
            let mut settings = Settings {
                mode: "api".into(),
                api_provider: provider,
                base_url: "https://untrusted.example/v1".into(),
                ..Settings::default()
            };
            assert_eq!(endpoint(&settings).unwrap(), provider.base_url().unwrap());
            settings.remember_api_profile();
            assert!(accounts.insert(account(&settings).unwrap()));
            let mut keys = std::collections::BTreeMap::from([(
                provider,
                ApiKeyInput {
                    base_url: settings.base_url.clone(),
                    key: "synthetic".into(),
                },
            )]);
            assert_eq!(validated_api_keys(&settings, Some(&keys)).unwrap().len(), 1);
            keys.get_mut(&provider).unwrap().base_url = "https://untrusted.example/v1".into();
            assert!(validated_api_keys(&settings, Some(&keys)).is_err());
        }
        let settings = Settings {
            base_url: "https://legacy.example/v1/".into(),
            ..Settings::default()
        };
        assert_eq!(
            account(&settings).unwrap(),
            hex::encode(Sha256::digest(b"https://legacy.example/v1"))
        );
    }

    #[test]
    fn custom_and_named_keys_at_the_same_endpoint_are_saved_and_deleted_independently() {
        let named = Settings {
            api_provider: ApiProvider::Glm,
            ..Settings::default()
        };
        let custom = Settings {
            base_url: ApiProvider::Glm.base_url().unwrap().into(),
            ..Settings::default()
        };
        let named_account = account(&named).unwrap();
        let custom_account = account(&custom).unwrap();
        let mut credentials = std::collections::BTreeMap::new();
        for (identity, key) in [(&custom_account, "custom-key"), (&named_account, "glm-key")] {
            credentials
                .entry(identity.clone())
                .or_insert_with(|| {
                    keyring::Entry::new_with_credential(Box::new(
                        keyring::mock::MockCredential::default(),
                    ))
                })
                .set_password(key)
                .unwrap();
        }
        assert_eq!(
            credentials[&custom_account].get_password().unwrap(),
            "custom-key"
        );
        assert_eq!(
            credentials[&named_account].get_password().unwrap(),
            "glm-key"
        );
        credentials[&named_account].delete_credential().unwrap();
        assert_eq!(
            credentials[&custom_account].get_password().unwrap(),
            "custom-key"
        );
        assert!(matches!(
            credentials[&named_account].get_password(),
            Err(keyring::Error::NoEntry)
        ));
        credentials[&named_account]
            .set_password("glm-reconnected")
            .unwrap();
        credentials[&custom_account].delete_credential().unwrap();
        assert_eq!(
            credentials[&named_account].get_password().unwrap(),
            "glm-reconnected"
        );
    }

    #[tokio::test]
    async fn local_generation_paths_reserve_independent_reasoning_and_output_budgets() {
        for (enabled, kind, output, expected_reasoning, expected_context) in [
            (false, "conversation", 128, 0, 4096),
            (true, "conversation", 128, 2048, 8192),
            (false, "widget", 4096, 4096, 16384),
            (true, "widget", 4096, 4096, 16384),
            (false, "organizer", 1200, 0, 16384),
            (true, "organizer", 1400, 0, 16384),
        ] {
            let settings = Settings {
                local_reasoning_enabled: enabled,
                api_token_parameter: "max_tokens".into(),
                ..Settings::default()
            };
            let budget = match kind {
                "widget" => GenerationBudget::widget(&settings, output),
                "organizer" => GenerationBudget::organizer(&settings, output),
                _ => GenerationBudget::conversation(&settings, output),
            };
            let (result, payload) = captured_completion(
                &settings,
                budget,
                json!({"choices":[{"message":{"content":"{\"ok\":true}","reasoning_content":"{\"ok\":false}"},"finish_reason":"stop"}]}),
                &[],
            )
            .await;
            assert_eq!(result.unwrap(), json!({"ok":true}));
            assert_eq!(
                payload["chat_template_kwargs"]["enable_thinking"],
                expected_reasoning > 0
            );
            assert_eq!(payload["reasoning_budget_tokens"], expected_reasoning);
            assert_eq!(payload["reasoning_format"], "deepseek");
            assert_eq!(payload["max_tokens"], expected_reasoning + output);
            assert_eq!(payload["response_format"]["type"], "json_schema");
            assert_eq!(budget.context_tokens, expected_context);
            assert_eq!(settings.local_reasoning_enabled, enabled);
        }
    }

    #[tokio::test]
    async fn api_widget_and_organizer_requests_keep_provider_parameters_and_token_caps() {
        let settings = Settings {
            mode: "api".into(),
            local_reasoning_enabled: true,
            api_token_parameter: "max_completion_tokens".into(),
            ..Settings::default()
        };
        for (budget, output) in [
            (GenerationBudget::widget(&settings, 4096), 2048),
            (GenerationBudget::organizer(&settings, 1400), 1400),
        ] {
            let (result, payload) = captured_completion(
                &settings,
                budget,
                json!({"choices":[{"message":{"content":"{\"ok\":true}"}}]}),
                &[],
            )
            .await;
            assert_eq!(result.unwrap(), json!({"ok":true}));
            assert_eq!(payload["max_completion_tokens"], output);
            for key in [
                "chat_template_kwargs",
                "reasoning_budget_tokens",
                "reasoning_format",
                "max_tokens",
            ] {
                assert!(payload.get(key).is_none(), "unexpected API field: {key}");
            }
        }
    }

    #[tokio::test]
    async fn reasoning_is_never_used_as_final_json_and_truncated_local_output_is_rejected() {
        let settings = Settings {
            local_reasoning_enabled: true,
            ..Settings::default()
        };
        for message in [
            json!({"reasoning_content":"{\"ok\":true}","content":""}),
            json!({"reasoning_content":"{\"ok\":true}","content":null}),
            json!({"content":"<think>{\"ok\":true}</think>"}),
        ] {
            let (result, _) = captured_completion(
                &settings,
                GenerationBudget::conversation(&settings, 128),
                json!({"choices":[{"message":message,"finish_reason":"stop"}]}),
                &[],
            )
            .await;
            assert!(result.is_err());
        }
        let (result, _) = captured_completion(
            &settings,
            GenerationBudget::widget(&settings, 4096),
            json!({"choices":[{"message":{"content":"{\"ok\":true}"},"finish_reason":"length"}]}),
            &[],
        )
        .await;
        assert!(result.unwrap_err().contains("토큰 한도"));
    }

    #[tokio::test]
    async fn local_transport_normalizes_role_boundaries_without_editing_history_or_api_requests() {
        let messages: Vec<ChatMessage> = [
            ("system", "현재 사용자: 민수"),
            ("assistant", "[a] 오늘 뭐 마시고 싶어?"),
            ("assistant", "[b] 난 커피를 마시려는데 너는?"),
            ("user", "  정정할게.\n커피 말고 차야.  "),
            ("user", "내 음료 취향을 알려 줘."),
            ("assistant", "첫 화자의 답"),
            ("assistant", "둘째 화자의 답\n "),
            ("user", "이어서 말해 줘."),
        ]
        .into_iter()
        .map(|(role, content)| ChatMessage {
            role: role.into(),
            content: content.into(),
        })
        .collect();
        let original = serde_json::to_value(&messages).unwrap();
        for mode in ["local", "api"] {
            let settings = Settings {
                mode: mode.into(),
                ..Settings::default()
            };
            let (result, payload) = captured_completion(
                &settings,
                GenerationBudget::conversation(&settings, 128),
                json!({"choices":[{"message":{"content":"{\"ok\":true}"}}]}),
                &messages,
            )
            .await;
            assert_eq!(result.unwrap(), json!({"ok":true}));
            if mode == "local" {
                assert_eq!(
                    payload["messages"],
                    json!([
                        {"role":"system","content":"현재 사용자: 민수"},
                        {"role":"user","content":""},
                        {"role":"assistant","content":"[a] 오늘 뭐 마시고 싶어?\n\n[b] 난 커피를 마시려는데 너는?"},
                        {"role":"user","content":"  정정할게.\n커피 말고 차야.  \n\n내 음료 취향을 알려 줘."},
                        {"role":"assistant","content":"첫 화자의 답\n\n둘째 화자의 답\n "},
                        {"role":"user","content":"이어서 말해 줘."}
                    ])
                );
            } else {
                assert_eq!(payload["messages"], original);
            }
            assert_eq!(serde_json::to_value(&messages).unwrap(), original);
        }
    }

    #[tokio::test]
    async fn local_reasoning_off_preserves_template_prompt_schema_key_and_output_budget() {
        let settings = Settings::default();
        let budget = GenerationBudget::conversation(&settings, 256);
        let prompt = "  <model>\noriginal template output\n ";
        for (schema, temperature) in [
            (
                json!({"type":"object","properties":{"ok":{"type":"boolean"}}}),
                0.7,
            ),
            (
                json!({"type":"object","properties":{"memories":{"type":"array"}}}),
                0.1,
            ),
        ] {
            let (url, server) = completion_server(vec![
                (200, json!({"prompt":prompt}).to_string()),
                (
                    200,
                    json!({"content":"{\"ok\":true}","stop":true,"stop_type":"eos"}).to_string(),
                ),
            ])
            .await;
            let result = completion(
                &format!("{url}/v1"),
                Some("synthetic-local-key"),
                &settings,
                &[],
                schema.clone(),
                budget,
                Arc::new(AtomicBool::new(false)),
            )
            .await
            .unwrap();
            assert_eq!(result, json!({"ok":true}));
            let requests = server.await.unwrap();
            for request in &requests {
                assert!(request
                    .0
                    .to_ascii_lowercase()
                    .contains("authorization: bearer synthetic-local-key"));
            }
            assert!(requests[0].0.starts_with("POST /apply-template "));
            assert_eq!(
                requests[0].1["chat_template_kwargs"]["enable_thinking"],
                false
            );
            assert_eq!(
                requests[0].1["response_format"]["json_schema"]["schema"],
                schema
            );
            assert!(requests[1].0.starts_with("POST /completion "));
            assert_eq!(
                requests[1].1,
                json!({
                    "prompt":prompt,"json_schema":schema,"n_predict":256,
                    "temperature":temperature,"stream":false,"reasoning_budget_tokens":0,
                })
            );
        }
    }

    #[tokio::test]
    async fn local_reasoning_off_rejects_invalid_or_incomplete_responses_without_retry() {
        let settings = Settings::default();
        let successful_template = json!({"prompt":"chat"}).to_string();
        let final_json = "{\"ok\":true}";
        let mut cases = vec![
            (true, 200, json!({}).to_string(), "대화 입력"),
            (true, 200, json!({"prompt":" \n"}).to_string(), "대화 입력"),
            (true, 200, "not-json".into(), "올바른 JSON"),
            (true, 400, "secret-api-key".into(), "400"),
            (false, 422, "secret-api-key".into(), "422"),
            (false, 200, "not-json".into(), "올바른 JSON"),
            (
                false,
                200,
                json!({"content":final_json,"stop":false,"stop_type":"eos"}).to_string(),
                "정상적으로",
            ),
            (
                false,
                200,
                json!({"content":final_json,"stop":true,"stop_type":"none"}).to_string(),
                "정상적으로",
            ),
            (
                false,
                200,
                json!({"content":final_json,"stop":true,"stop_type":"limit"}).to_string(),
                "토큰 한도",
            ),
            (
                false,
                200,
                json!({"content":final_json,"stop":true,"stop_type":"eos","stopped_limit":true})
                    .to_string(),
                "토큰 한도",
            ),
            (
                false,
                200,
                json!({"content":final_json,"stop":true,"stop_type":"eos","truncated":true})
                    .to_string(),
                "컨텍스트 한도",
            ),
            (
                false,
                200,
                json!({"content":null,"stop":true,"stop_type":"eos"}).to_string(),
                "대화 내용",
            ),
            (
                false,
                200,
                json!({"content":"```json\n{}\n```","stop":true,"stop_type":"eos"}).to_string(),
                "요청한 JSON",
            ),
        ];
        for template in [true, false] {
            cases.push((
                template,
                200,
                json!({"prompt":"x".repeat(256*1024),"content":"x".repeat(256*1024)}).to_string(),
                "허용 크기",
            ));
        }
        for (template, status, body, expected) in cases {
            let mut responses = Vec::new();
            if !template {
                responses.push((200, successful_template.clone()));
            }
            responses.push((status, body));
            let (url, server) = completion_server(responses).await;
            let error = completion(
                &url,
                None,
                &settings,
                &[],
                json!({}),
                GenerationBudget::conversation(&settings, 32),
                Arc::new(AtomicBool::new(false)),
            )
            .await
            .unwrap_err();
            assert!(error.contains(expected), "{error}; expected {expected}");
            assert!(!error.contains("secret-api-key"));
            assert_eq!(server.await.unwrap().len(), if template { 1 } else { 2 });
        }
    }

    #[tokio::test]
    async fn local_reasoning_off_cancels_in_both_request_headers_and_bodies() {
        use tokio::{io::AsyncWriteExt, net::TcpListener};
        for (phase, body_started) in [(0, false), (0, true), (1, false), (1, true), (2, false)] {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let cancel = Arc::new(AtomicBool::new(false));
            let server_cancel = cancel.clone();
            let (started, ready) = tokio::sync::oneshot::channel();
            let (finished, finish) = tokio::sync::oneshot::channel();
            let server = tokio::spawn(async move {
                let (mut socket, _) = listener.accept().await.unwrap();
                let (headers, _) = read_completion_request(&mut socket).await;
                assert!(headers.starts_with("POST /apply-template "));
                if phase == 1 {
                    let body = json!({"prompt":"chat"}).to_string();
                    socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
                    drop(socket);
                    socket = listener.accept().await.unwrap().0;
                    let (headers, _) = read_completion_request(&mut socket).await;
                    assert!(headers.starts_with("POST /completion "));
                }
                if phase == 2 {
                    server_cancel.store(true, Ordering::Release);
                    let body = json!({"prompt":"chat"}).to_string();
                    socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
                } else if body_started {
                    socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 10000\r\nConnection: close\r\n\r\n{\"secret").await.unwrap();
                }
                started.send(()).unwrap();
                let _ = finish.await;
                drop(socket);
                assert!(
                    tokio::time::timeout(Duration::from_millis(50), listener.accept())
                        .await
                        .is_err()
                );
            });
            let settings = Settings::default();
            let url = format!("http://{address}");
            let request = completion(
                &url,
                None,
                &settings,
                &[],
                json!({}),
                GenerationBudget::conversation(&settings, 32),
                cancel.clone(),
            );
            let interrupt = async {
                ready.await.unwrap();
                cancel.store(true, Ordering::Release);
            };
            let (result, ()) = tokio::time::timeout(Duration::from_secs(2), async {
                tokio::join!(request, interrupt)
            })
            .await
            .unwrap();
            assert_eq!(result.unwrap_err(), "취소됨");
            finished.send(()).unwrap();
            server.await.unwrap();
        }
    }

    #[tokio::test]
    async fn local_reasoning_off_shares_one_timeout_across_both_responses() {
        use tokio::{io::AsyncWriteExt, net::TcpListener};
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            for body in [
                json!({"prompt":"chat"}),
                json!({"content":"{}","stop":true,"stop_type":"eos"}),
            ] {
                let (mut socket, _) = listener.accept().await.unwrap();
                read_completion_request(&mut socket).await;
                tokio::time::sleep(Duration::from_millis(100)).await;
                let body = body.to_string();
                let _ = socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await;
            }
        });
        let settings = Settings::default();
        let mut budget = GenerationBudget::conversation(&settings, 32);
        budget.timeout = Duration::from_millis(170);
        let result = completion(
            &format!("http://{address}"),
            None,
            &settings,
            &[],
            json!({}),
            budget,
            Arc::new(AtomicBool::new(false)),
        )
        .await;
        assert!(result.unwrap_err().contains("시간이 초과"));
        server.await.unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn context_profile_change_stops_only_the_owned_local_server() {
        let directory = tempfile::tempdir().unwrap();
        let custom_file = directory.path().join("mine.gguf");
        std::fs::write(&custom_file, b"stub").unwrap();
        let settings = Settings {
            local_model: LocalModel::Custom,
            local_model_path: custom_file.display().to_string(),
            ..Settings::default()
        };
        let runtime = Inference::new(directory.path().into(), PathBuf::new(), PathBuf::new());
        let child = Command::new("/bin/sleep")
            .arg("30")
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        *runtime.local.lock().await = Some(LocalServer {
            path: custom_file,
            context_tokens: 4096,
            child,
            url: "http://127.0.0.1:2".into(),
            key: "test".into(),
        });
        let result = local_endpoint(&runtime, &settings, 4096, Arc::new(AtomicBool::new(false)))
            .await
            .unwrap();
        assert_eq!(result.0, "http://127.0.0.1:2");
        let result =
            local_endpoint(&runtime, &settings, 8192, Arc::new(AtomicBool::new(false))).await;
        assert!(result.unwrap_err().contains("실행기가 없습니다"));
        assert!(runtime.local.lock().await.is_none());
    }
    #[test]
    fn legacy_api_key_moves_only_after_the_current_store_saves_it() {
        let current =
            keyring::Entry::new_with_credential(Box::new(keyring::mock::MockCredential::default()));
        let legacy =
            keyring::Entry::new_with_credential(Box::new(keyring::mock::MockCredential::default()));
        legacy.set_password("synthetic-api-key").unwrap();

        assert_eq!(
            migrate_legacy_key(&current, &legacy).unwrap().as_deref(),
            Some("synthetic-api-key")
        );
        assert_eq!(current.get_password().unwrap(), "synthetic-api-key");
        assert!(matches!(
            legacy.get_password(),
            Err(keyring::Error::NoEntry)
        ));
    }
    #[test]
    fn legacy_api_key_survives_a_failed_save_and_migrates_on_retry() {
        let current =
            keyring::Entry::new_with_credential(Box::new(keyring::mock::MockCredential::default()));
        let legacy =
            keyring::Entry::new_with_credential(Box::new(keyring::mock::MockCredential::default()));
        legacy.set_password("synthetic-api-key").unwrap();
        current
            .get_credential()
            .downcast_ref::<keyring::mock::MockCredential>()
            .unwrap()
            .set_error(keyring::Error::PlatformFailure(Box::new(
                std::io::Error::from(std::io::ErrorKind::PermissionDenied),
            )));

        assert_eq!(
            migrate_legacy_key(&current, &legacy).unwrap().as_deref(),
            Some("synthetic-api-key")
        );
        assert!(matches!(
            current.get_password(),
            Err(keyring::Error::NoEntry)
        ));
        assert_eq!(legacy.get_password().unwrap(), "synthetic-api-key");

        assert_eq!(
            migrate_legacy_key(&current, &legacy).unwrap().as_deref(),
            Some("synthetic-api-key")
        );
        assert_eq!(current.get_password().unwrap(), "synthetic-api-key");
        assert!(matches!(
            legacy.get_password(),
            Err(keyring::Error::NoEntry)
        ));
    }
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
            context_tokens: 4096,
            child,
            url: "http://127.0.0.1:1".into(),
            key: "test".into(),
        });
        assert!(!is_local_running(&runtime, &nine).await);
        // The stub file is not a verified download, so the running server is replaced instead of reused.
        let result = tokio::time::timeout(
            Duration::from_secs(2),
            local_endpoint(&runtime, &four, 4096, Arc::new(AtomicBool::new(false))),
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
            context_tokens: 4096,
            child,
            url: "http://127.0.0.1:2".into(),
            key: "test".into(),
        });
        let result = local_endpoint(&runtime, &custom, 4096, Arc::new(AtomicBool::new(false)))
            .await
            .unwrap();
        assert_eq!(result.0, "http://127.0.0.1:2");
        let missing = Settings {
            local_model_path: directory.path().join("gone.gguf").display().to_string(),
            ..custom
        };
        let result = tokio::time::timeout(
            Duration::from_secs(2),
            local_endpoint(&runtime, &missing, 4096, Arc::new(AtomicBool::new(false))),
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
    #[test]
    fn keyless_api_only_accepts_valid_loopback_urls() {
        for base_url in [
            "http://localhost:11434/v1",
            "http://127.0.0.1:1234/v1",
            "http://[::1]:1234/v1",
            "https://localhost/v1",
        ] {
            let settings = Settings {
                base_url: base_url.into(),
                ..Settings::default()
            };
            assert!(allows_keyless_api(&settings), "{base_url}");
        }
        for base_url in [
            "https://example.com/v1",
            "https://192.168.1.2/v1",
            "https://localhost.example.com/v1",
            "http://127.0.0.2:1234/v1",
            "http://localhost@evil.example/v1",
            "http://evil.example@localhost/v1",
            "http://localhost/v1?key=secret",
            "http://localhost/v1?",
            "http://localhost/v1#secret",
            "http://localhost/v1#",
        ] {
            let settings = Settings {
                base_url: base_url.into(),
                ..Settings::default()
            };
            assert!(!allows_keyless_api(&settings), "{base_url}");
        }
    }
    #[test]
    fn remote_api_requires_a_key_before_request() {
        let settings = Settings {
            base_url: format!("https://{}.invalid/v1", uuid::Uuid::new_v4()),
            ..Settings::default()
        };
        assert!(api_key_for_request(&settings, None).is_err());
        assert_eq!(
            api_key_for_request(&settings, Some(" draft-key ".into())).unwrap(),
            Some("draft-key".into())
        );
    }
    #[tokio::test]
    async fn keyless_loopback_connection_sends_no_authorization() {
        use tokio::{
            io::{AsyncReadExt, AsyncWriteExt},
            net::TcpListener,
        };
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            while !request.windows(4).any(|part| part == b"\r\n\r\n") {
                let mut chunk = [0; 1024];
                let count = socket.read(&mut chunk).await.unwrap();
                assert!(count > 0 && request.len() + count <= 8192);
                request.extend_from_slice(&chunk[..count]);
            }
            let headers = String::from_utf8_lossy(&request).to_ascii_lowercase();
            assert!(!headers.contains("authorization:"));
            let body = r#"{"choices":[{"message":{"content":"{\"ok\":true}"}}]}"#;
            socket
                .write_all(
                    format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
        });
        let settings = Settings {
            mode: "api".into(),
            base_url: format!("http://{address}/{}/v1", uuid::Uuid::new_v4()),
            api_model: "local-model".into(),
            ..Settings::default()
        };
        let directory = tempfile::tempdir().unwrap();
        let inference = Inference::new(directory.path().into(), PathBuf::new(), PathBuf::new());
        assert_eq!(
            test_connection(
                &inference,
                &settings,
                None,
                Arc::new(AtomicBool::new(false))
            )
            .await
            .unwrap(),
            "API 연결과 JSON 응답을 확인했습니다."
        );
        server.await.unwrap();
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
            GenerationBudget::conversation(&settings, 32),
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
            GenerationBudget::conversation(&settings, 32),
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
        let settings = Settings {
            local_reasoning_enabled: true,
            ..Settings::default()
        };
        let result = completion(
            &format!("http://{address}"),
            None,
            &settings,
            &[],
            json!({}),
            GenerationBudget::conversation(&settings, 32),
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
        for (provider, pending) in [
            None,
            Some(ApiProvider::Claude),
            Some(ApiProvider::Gemini),
            Some(ApiProvider::Glm),
        ]
        .into_iter()
        .flat_map(|provider| [true, false].map(|pending| (provider, pending)))
        {
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
            let settings = Settings {
                mode: if provider.is_some() { "api" } else { "local" }.into(),
                api_provider: provider.unwrap_or_default(),
                ..Settings::default()
            };
            let response = completion(
                &url,
                Some("secret-api-key"),
                &settings,
                &[],
                json!({}),
                GenerationBudget::conversation(&settings, 32),
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

    #[test]
    fn attachments_only_change_the_last_user_turn_in_each_wire_format() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap();
        let file = Attachment {
            name: "confirm.pdf".into(),
            mime: "application/pdf".into(),
            data: "AAAA".into(),
        };
        let mut plain = json!([{"role":"user","content":"hi"}]);
        attach_to_last_user(&mut plain, "compatible");
        assert_eq!(plain[0]["content"], "hi");
        let turns = json!([
            {"role":"system","content":"rules"},
            {"role":"user","content":"first"},
            {"role":"assistant","content":"ok"},
            {"role":"user","content":"read this"}
        ]);
        let (compatible, claude, responses) = runtime.block_on(ATTACHMENT.scope(file, async {
            let mut compatible = turns.clone();
            attach_to_last_user(&mut compatible, "compatible");
            let mut claude = turns.clone();
            attach_to_last_user(&mut claude, "claude");
            let mut responses = turns.clone();
            attach_to_last_user(&mut responses, "responses");
            (compatible, claude, responses)
        }));
        assert_eq!(compatible[1]["content"], "first");
        assert_eq!(compatible[3]["content"][0]["text"], "read this");
        assert_eq!(
            compatible[3]["content"][1]["file"]["file_data"],
            "data:application/pdf;base64,AAAA"
        );
        assert_eq!(claude[3]["content"][0]["type"], "document");
        assert_eq!(claude[3]["content"][0]["source"]["data"], "AAAA");
        assert_eq!(responses[3]["content"][0]["type"], "input_file");
        assert_eq!(responses[3]["content"][1]["text"], "read this");
    }
}
