pub(crate) mod crash;

use crate::{store, AppState};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    path::Path,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

const MEASUREMENT_ID: &str = "G-4Z0X58WFVB";
const CLIENT_ID_FILE: &str = "analytics-client-id.json";
const INVALID_EVENT: &str = "Invalid analytics event parameters.";

#[derive(Default)]
pub(crate) struct Runtime {
    started: AtomicBool,
    client_id: Mutex<Option<String>>,
    session_id: OnceLock<u64>,
    http: OnceLock<Result<reqwest::Client, ()>>,
    transmission: tokio::sync::RwLock<()>,
    consent_revision: AtomicU64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Context {
    app_version: String,
    os: &'static str,
    environment: &'static str,
    app_started: bool,
    analytics_consent: bool,
    consent_revision: u64,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
enum EventName {
    #[serde(rename = "comet_app_started")]
    AppStarted,
    #[serde(rename = "comet_ai_configured")]
    AiConfigured,
    #[serde(rename = "comet_ui_action")]
    UiAction,
    #[serde(rename = "comet_settings_view")]
    SettingsView,
    #[serde(rename = "comet_error")]
    Error,
    #[serde(rename = "comet_ai_request_completed")]
    AiRequestCompleted,
    #[serde(rename = "comet_abnormal_exit")]
    AbnormalExit,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum ErrorSource {
    FrontendRuntime,
    FrontendPromise,
    FrontendCommand,
}

#[derive(Clone, Copy, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum ErrorCode {
    UnexpectedError,
    CommandFailed,
    AiRequestFailed,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum Operation {
    RegisterUserName,
    SetAnalyticsConsent,
    SaveSettings,
    GetSnapshot,
    ExecuteWidget,
    OpenLauncher,
    OpenWidget,
    OpenWidgets,
    OpenPlannerView,
    SendMessage,
    RetryTurn,
    Other,
}

#[derive(Clone, Copy, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum RequestOutcome {
    Success,
    Error,
    Cancelled,
}

#[derive(Clone, Copy, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum AiProvider {
    Local,
    Apple,
    Chatgpt,
    Claude,
    Gemini,
    Glm,
    Custom,
}

#[derive(Clone, Copy, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum ModelFamily {
    SystemLanguageModel,
    Unspecified,
    Custom,
    OSeries,
    Qwen,
    Gemma,
    Ministral,
    Kanana,
    Gpt,
    Claude,
    Gemini,
    Glm,
    Other,
}

#[derive(Clone, Copy, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum ModelSource {
    Os,
    Catalog,
    CustomFile,
    Service,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum ConfigurationSource {
    Startup,
    Saved,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum Feature {
    Widget,
    Launcher,
    Diary,
    Conversation,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
enum Action {
    Open,
    Add,
    Complete,
    Undo,
    Delete,
    Start,
    Pause,
    Resume,
    Cancel,
    Rest,
    Continue,
    Configure,
    ConfigureSettings,
    Send,
    Retry,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum Section {
    Characters,
    Widgets,
    Automatic,
    Dialogue,
    Desktop,
    Organizer,
    User,
    Model,
    General,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Event {
    event: EventName,
    ai_provider: Option<AiProvider>,
    ai_model_family: Option<ModelFamily>,
    ai_model_source: Option<ModelSource>,
    configuration_source: Option<ConfigurationSource>,
    feature: Option<Feature>,
    action: Option<Action>,
    section: Option<Section>,
    error_source: Option<ErrorSource>,
    error_code: Option<ErrorCode>,
    operation: Option<Operation>,
    request_outcome: Option<RequestOutcome>,
    duration_ms: Option<u64>,
    termination_kind: Option<crash::TerminationKind>,
    crash_app_version: Option<String>,
    #[serde(rename = "app_version")]
    _app_version: Option<serde::de::IgnoredAny>,
    #[serde(rename = "os")]
    _os: Option<serde::de::IgnoredAny>,
    #[serde(rename = "environment")]
    _environment: Option<serde::de::IgnoredAny>,
    #[serde(rename = "debug_mode")]
    _debug_mode: Option<serde::de::IgnoredAny>,
}

impl Event {
    fn parameters(&self) -> Result<Map<String, Value>, String> {
        let has_ai = self.ai_provider.is_some()
            || self.ai_model_family.is_some()
            || self.ai_model_source.is_some()
            || self.configuration_source.is_some();
        let has_action = self.feature.is_some() || self.action.is_some();
        let has_error =
            self.error_source.is_some() || self.error_code.is_some() || self.operation.is_some();
        let has_request = self.request_outcome.is_some() || self.duration_ms.is_some();
        let has_termination = self.termination_kind.is_some() || self.crash_app_version.is_some();
        let legacy_fields_only = !has_error && !has_request && !has_termination;
        let value = match self.event {
            EventName::AppStarted
                if !has_ai && !has_action && self.section.is_none() && legacy_fields_only =>
            {
                json!({})
            }
            EventName::AiConfigured
                if !has_action && self.section.is_none() && legacy_fields_only =>
            {
                let provider = self.ai_provider.ok_or(INVALID_EVENT)?;
                let family = self.ai_model_family.ok_or(INVALID_EVENT)?;
                let source = self.ai_model_source.ok_or(INVALID_EVENT)?;
                let configuration = self.configuration_source.ok_or(INVALID_EVENT)?;
                let valid_source = match (provider, source) {
                    (AiProvider::Apple, ModelSource::Os) => {
                        family == ModelFamily::SystemLanguageModel
                    }
                    (AiProvider::Apple, _) => false,
                    (AiProvider::Local, ModelSource::Catalog) => family != ModelFamily::Custom,
                    (AiProvider::Local, ModelSource::CustomFile) => family == ModelFamily::Custom,
                    (AiProvider::Local, ModelSource::Service) => false,
                    (_, ModelSource::Service) => true,
                    _ => false,
                };
                if !valid_source {
                    return Err(INVALID_EVENT.into());
                }
                json!({
                    "ai_provider": provider,
                    "ai_model_family": family,
                    "ai_model_source": source,
                    "configuration_source": configuration,
                })
            }
            EventName::UiAction if !has_ai && self.section.is_none() && legacy_fields_only => {
                let feature = self.feature.ok_or(INVALID_EVENT)?;
                let action = self.action.ok_or(INVALID_EVENT)?;
                let valid_action = match (feature, action) {
                    (Feature::Widget, Action::Send | Action::Retry) => false,
                    (Feature::Widget, _) => true,
                    (Feature::Launcher | Feature::Diary, Action::Open) => true,
                    (Feature::Conversation, Action::Send | Action::Retry) => true,
                    _ => false,
                };
                if !valid_action {
                    return Err(INVALID_EVENT.into());
                }
                json!({ "feature": feature, "action": action })
            }
            EventName::SettingsView if !has_ai && !has_action && legacy_fields_only => {
                json!({ "section": self.section.ok_or(INVALID_EVENT)? })
            }
            EventName::Error
                if !has_ai
                    && !has_action
                    && self.section.is_none()
                    && !has_request
                    && !has_termination =>
            {
                let source = self.error_source.ok_or(INVALID_EVENT)?;
                let code = self.error_code.ok_or(INVALID_EVENT)?;
                match source {
                    ErrorSource::FrontendCommand
                        if code == ErrorCode::CommandFailed && self.operation.is_some() =>
                    {
                        json!({ "error_source": source, "error_code": code, "operation": self.operation })
                    }
                    ErrorSource::FrontendRuntime | ErrorSource::FrontendPromise
                        if code == ErrorCode::UnexpectedError && self.operation.is_none() =>
                    {
                        json!({ "error_source": source, "error_code": code })
                    }
                    _ => return Err(INVALID_EVENT.into()),
                }
            }
            EventName::AiRequestCompleted
                if !has_action
                    && self.section.is_none()
                    && !has_termination
                    && self.configuration_source.is_none()
                    && self.error_source.is_none()
                    && self.operation.is_none() =>
            {
                let provider = self.ai_provider.ok_or(INVALID_EVENT)?;
                let family = self.ai_model_family.ok_or(INVALID_EVENT)?;
                let source = self.ai_model_source.ok_or(INVALID_EVENT)?;
                let outcome = self.request_outcome.ok_or(INVALID_EVENT)?;
                let duration = self
                    .duration_ms
                    .filter(|value| *value <= 86_400_000)
                    .ok_or(INVALID_EVENT)?;
                let valid_source = match (provider, source) {
                    (AiProvider::Apple, ModelSource::Os) => {
                        family == ModelFamily::SystemLanguageModel
                    }
                    (AiProvider::Apple, _) => false,
                    (AiProvider::Local, ModelSource::Catalog) => family != ModelFamily::Custom,
                    (AiProvider::Local, ModelSource::CustomFile) => family == ModelFamily::Custom,
                    (AiProvider::Local, ModelSource::Service) => false,
                    (_, ModelSource::Service) => true,
                    _ => false,
                };
                if !valid_source
                    || (outcome == RequestOutcome::Error)
                        != (self.error_code == Some(ErrorCode::AiRequestFailed))
                    || (outcome != RequestOutcome::Error && self.error_code.is_some())
                {
                    return Err(INVALID_EVENT.into());
                }
                let mut params = json!({ "ai_provider": provider, "ai_model_family": family, "ai_model_source": source,
                    "request_outcome": outcome, "duration_ms": duration,
                    "ai_request_count": 1, "ai_success_count": u64::from(outcome == RequestOutcome::Success),
                    "ai_measured_duration_ms": duration });
                if let Some(code) = self.error_code {
                    params["error_code"] = json!(code);
                }
                params
            }
            EventName::AbnormalExit
                if !has_ai
                    && !has_action
                    && self.section.is_none()
                    && !has_error
                    && !has_request =>
            {
                let version = self
                    .crash_app_version
                    .as_deref()
                    .filter(|value| valid_app_version(value))
                    .ok_or(INVALID_EVENT)?;
                json!({ "termination_kind": self.termination_kind.ok_or(INVALID_EVENT)?, "crash_app_version": version })
            }
            _ => return Err(INVALID_EVENT.into()),
        };
        value
            .as_object()
            .cloned()
            .ok_or_else(|| INVALID_EVENT.into())
    }

    fn body(&self, context: &Context, client_id: &str, session_id: u64) -> Result<Value, String> {
        let mut params = self.parameters()?;
        params.insert("app_version".into(), json!(context.app_version));
        params.insert("os".into(), json!(context.os));
        params.insert("environment".into(), json!(context.environment));
        params.insert("session_id".into(), json!(session_id));
        params.insert("engagement_time_msec".into(), json!(1));
        if context.environment != "production" {
            params.insert("debug_mode".into(), json!(true));
        }
        Ok(json!({
            "client_id": client_id,
            "events": [{ "name": self.event, "params": params }],
        }))
    }
}

fn valid_app_version(value: &str) -> bool {
    if value.len() > 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'+'))
    {
        return false;
    }
    let release = value.split(['-', '+']).next().unwrap_or_default();
    let numbers: Vec<_> = release.split('.').collect();
    numbers.len() == 3
        && numbers
            .iter()
            .all(|number| !number.is_empty() && number.parse::<u64>().is_ok())
}

#[derive(Deserialize, Serialize)]
struct ClientIdentity {
    client_id: String,
}

fn read_client_id(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|_| "Analytics identity is unavailable.")?;
    let identity: ClientIdentity =
        serde_json::from_slice(&bytes).map_err(|_| "Analytics identity is invalid.")?;
    uuid::Uuid::parse_str(&identity.client_id).map_err(|_| "Analytics identity is invalid.")?;
    Ok(identity.client_id)
}

impl Runtime {
    async fn commit_consent_change<T>(
        &self,
        change: impl FnOnce() -> Result<T, String>,
        committed: impl FnOnce(),
    ) -> Result<T, String> {
        let _transmission = self.transmission.write().await;
        let result = change()?;
        self.consent_revision.fetch_add(1, Ordering::AcqRel);
        committed();
        Ok(result)
    }

    fn claim_start(&self, analytics_consent: bool) -> bool {
        analytics_consent && !self.started.swap(true, Ordering::Relaxed)
    }

    fn prepare_event(
        &self,
        context: &Context,
        event: &Event,
        directory: &Path,
        consent_revision: Option<u64>,
    ) -> Result<Option<Value>, String> {
        if !context.analytics_consent
            || consent_revision
                .is_some_and(|revision| revision != self.consent_revision.load(Ordering::Acquire))
        {
            return Ok(None);
        }
        event.parameters()?;
        let stored_id = self.client_id(directory)?;
        let (high, low) = uuid::Uuid::parse_str(&stored_id)
            .map_err(|_| "Analytics identity is invalid.")?
            .as_u64_pair();
        let client_id = format!("{}.{}", high.max(1), low.max(1));
        let session_id = *self.session_id.get_or_init(|| {
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_or(1, |elapsed| elapsed.as_secs().max(1))
        });
        event.body(context, &client_id, session_id).map(Some)
    }

    fn client_id(&self, directory: &Path) -> Result<String, String> {
        let mut cached = self
            .client_id
            .lock()
            .map_err(|_| "Analytics identity is unavailable.")?;
        if let Some(id) = cached.as_ref() {
            return Ok(id.clone());
        }
        fs::create_dir_all(directory).map_err(|_| "Analytics identity is unavailable.")?;
        let path = directory.join(CLIENT_ID_FILE);
        let id = match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut file) => {
                let identity = ClientIdentity {
                    client_id: uuid::Uuid::new_v4().to_string(),
                };
                let bytes = serde_json::to_vec(&identity)
                    .map_err(|_| "Analytics identity is unavailable.")?;
                file.write_all(&bytes)
                    .and_then(|_| file.sync_all())
                    .map_err(|_| "Analytics identity is unavailable.")?;
                identity.client_id
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => read_client_id(&path)?,
            Err(_) => return Err("Analytics identity is unavailable.".into()),
        };
        *cached = Some(id.clone());
        Ok(id)
    }
}

fn context(
    app: &tauri::AppHandle,
    app_started: bool,
    analytics_consent: bool,
    consent_revision: u64,
) -> Context {
    let environment = if app.config().identifier != "space.starlight.comet" {
        "qa"
    } else if cfg!(debug_assertions) {
        "development"
    } else {
        "production"
    };
    Context {
        app_version: app.package_info().version.to_string(),
        os: match std::env::consts::OS {
            "macos" => "macos",
            "windows" => "windows",
            "linux" => "linux",
            _ => "unknown",
        },
        environment,
        app_started,
        analytics_consent,
        consent_revision,
    }
}

#[tauri::command]
pub(crate) async fn get_analytics_context(
    app: tauri::AppHandle,
    runtime: tauri::State<'_, Runtime>,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Context, String> {
    let _transmission = runtime.transmission.read().await;
    let consent = analytics_consent(&state)?;
    Ok(context(
        &app,
        runtime.claim_start(consent),
        consent,
        runtime.consent_revision.load(Ordering::Acquire),
    ))
}

fn analytics_consent(state: &AppState) -> Result<bool, String> {
    let db = crate::lock(&state.db)?;
    Ok(store::settings(&db)?.analytics_consent)
}

fn save_consent(state: &AppState, enabled: bool) -> Result<(), String> {
    let _action = crate::lock(&state.action)?;
    let db = crate::lock(&state.db)?;
    let tx = db
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    let mut settings = store::settings(&tx)?;
    if settings.analytics_consent == enabled {
        return Ok(());
    }
    settings.analytics_consent = enabled;
    store::save_settings(&tx, &settings)?;
    store::bump_revision(&tx)?;
    tx.commit().map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn set_analytics_consent(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    enabled: bool,
) -> Result<(), String> {
    commit_consent_change(&app, &state, || save_consent(&state, enabled)).await?;
    crate::app::publish(&app, &state);
    Ok(())
}

pub(crate) async fn commit_consent_change<T>(
    app: &tauri::AppHandle,
    state: &AppState,
    change: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    app.state::<Runtime>()
        .commit_consent_change(change, || crash::sync_consent(app, state))
        .await
}

#[tauri::command]
pub(crate) async fn send_analytics_event(
    app: tauri::AppHandle,
    runtime: tauri::State<'_, Runtime>,
    state: tauri::State<'_, Arc<AppState>>,
    event: Event,
    consent_revision: u64,
) -> Result<(), String> {
    transmit(&app, &runtime, &state, &event, Some(consent_revision)).await
}

async fn transmit(
    app: &tauri::AppHandle,
    runtime: &Runtime,
    state: &AppState,
    event: &Event,
    consent_revision: Option<u64>,
) -> Result<(), String> {
    let _transmission = runtime.transmission.read().await;
    let context = context(
        app,
        false,
        analytics_consent(state)?,
        runtime.consent_revision.load(Ordering::Acquire),
    );
    if !context.analytics_consent || state.stopping.load(Ordering::Acquire) {
        return Ok(());
    }
    let Some(secret) = option_env!("COMET_GA4_API_SECRET").filter(|value| !value.trim().is_empty())
    else {
        return Ok(());
    };
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|_| "Analytics identity is unavailable.")?;
    let Some(body) = runtime.prepare_event(&context, event, &directory, consent_revision)? else {
        return Ok(());
    };
    let http = runtime
        .http
        .get_or_init(|| {
            reqwest::Client::builder()
                .timeout(Duration::from_secs(5))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .map_err(|_| ())
        })
        .as_ref()
        .map_err(|_| "Analytics transport is unavailable.")?;
    http.post("https://www.google-analytics.com/mp/collect")
        .query(&[("measurement_id", MEASUREMENT_ID), ("api_secret", secret)])
        .json(&body)
        .send()
        .await
        .map_err(|_| "Analytics request failed.")?
        .error_for_status()
        .map_err(|_| "Analytics request failed.")?;
    Ok(())
}

fn request_lease(app: &tauri::AppHandle) -> Option<u64> {
    let runtime = app.try_state::<Runtime>()?;
    let state = app.try_state::<Arc<AppState>>()?;
    let revision = runtime.consent_revision.load(Ordering::Acquire);
    if state.stopping.load(Ordering::Acquire)
        || !analytics_consent(&state).ok()?
        || revision != runtime.consent_revision.load(Ordering::Acquire)
    {
        return None;
    }
    Some(revision)
}

fn enqueue(app: &tauri::AppHandle, value: Value, revision: u64) {
    let Ok(event) = serde_json::from_value::<Event>(value) else {
        return;
    };
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let Some(runtime) = app.try_state::<Runtime>() else {
            return;
        };
        let Some(state) = app.try_state::<Arc<AppState>>() else {
            return;
        };
        let _ = transmit(&app, &runtime, &state, &event, Some(revision)).await;
    });
}

pub(crate) fn attach_request_observer(
    app: &tauri::AppHandle,
    inference: &crate::inference::Inference,
) {
    let begin_app = app.clone();
    let completed_app = app.clone();
    inference.observe_requests(
        Arc::new(move || request_lease(&begin_app)),
        Arc::new(move |report, revision| {
            let outcome = match report.outcome {
                crate::inference::RequestOutcome::Success => "success",
                crate::inference::RequestOutcome::Error => "error",
                crate::inference::RequestOutcome::Cancelled => "cancelled",
            };
            enqueue(
                &completed_app,
                json!({
                    "event": "comet_ai_request_completed",
                    "ai_provider": report.provider,
                    "ai_model_family": report.model_family,
                    "ai_model_source": report.model_source,
                    "request_outcome": outcome,
                    "duration_ms": report.duration_ms,
                    "error_code": if outcome == "error" { Some("ai_request_failed") } else { None },
                }),
                revision,
            );
        }),
    );
}

pub(crate) fn report_abnormal_exit(
    app: &tauri::AppHandle,
    kind: crash::TerminationKind,
    previous_version: &str,
) {
    let Some(revision) = request_lease(app) else {
        return;
    };
    enqueue(
        app,
        json!({
            "event": "comet_abnormal_exit", "termination_kind": kind, "crash_app_version": previous_version,
        }),
        revision,
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diagnostic_events_keep_only_fixed_codes_and_numeric_request_duration() {
        for payload in [
            json!({"event":"comet_ai_request_completed","ai_provider":"apple","ai_model_family":"system_language_model","ai_model_source":"os","request_outcome":"success","duration_ms":100}),
            json!({"event":"comet_error","error_source":"frontend_runtime","error_code":"unexpected_error"}),
            json!({"event":"comet_error","error_source":"frontend_command","error_code":"command_failed","operation":"save_settings"}),
            json!({"event":"comet_ai_request_completed","ai_provider":"local","ai_model_family":"qwen","ai_model_source":"catalog","request_outcome":"success","duration_ms":250}),
            json!({"event":"comet_ai_request_completed","ai_provider":"claude","ai_model_family":"claude","ai_model_source":"service","request_outcome":"error","duration_ms":12,"error_code":"ai_request_failed"}),
            json!({"event":"comet_ai_request_completed","ai_provider":"custom","ai_model_family":"other","ai_model_source":"service","request_outcome":"cancelled","duration_ms":0}),
            json!({"event":"comet_abnormal_exit","termination_kind":"unclean_exit","crash_app_version":"0.13.1"}),
            json!({"event":"comet_abnormal_exit","termination_kind":"rust_panic_observed","crash_app_version":"0.13.2-beta.1"}),
        ] {
            let event: Event = serde_json::from_value(payload.clone()).unwrap();
            let body = event.body(&test_context("qa"), "123.456", 10).unwrap();
            let params = &body["events"][0]["params"];
            for (key, value) in payload.as_object().unwrap() {
                if key != "event" {
                    assert_eq!(&params[key], value);
                }
            }
            assert_eq!(params["app_version"], "0.13.2");
            if payload["event"] == "comet_ai_request_completed" {
                assert!(params["duration_ms"].is_u64());
                assert_eq!(params["ai_request_count"].as_u64(), Some(1));
                assert_eq!(
                    params["ai_measured_duration_ms"].as_u64(),
                    payload["duration_ms"].as_u64()
                );
                assert_eq!(
                    params["ai_success_count"].as_u64(),
                    Some(u64::from(payload["request_outcome"] == "success"))
                );
            } else {
                assert!(params.get("ai_request_count").is_none());
                assert!(params.get("ai_success_count").is_none());
                assert!(params.get("ai_measured_duration_ms").is_none());
            }
        }
    }

    #[test]
    fn rejects_diagnostic_content_and_cross_event_parameters() {
        for payload in [
            json!({"event":"comet_ai_request_completed","ai_provider":"apple","ai_model_family":"system_language_model","ai_model_source":"service","request_outcome":"success","duration_ms":100}),
            json!({"event":"comet_error","error_source":"frontend_runtime","error_code":"unexpected_error","message":"private content"}),
            json!({"event":"comet_error","error_source":"frontend_command","error_code":"command_failed","operation":"private-name"}),
            json!({"event":"comet_error","error_source":"frontend_command","error_code":"unexpected_error","operation":"other"}),
            json!({"event":"comet_error","error_source":"frontend_promise","error_code":"unexpected_error","operation":"other"}),
            json!({"event":"comet_app_started","duration_ms":1}),
            json!({"event":"comet_ai_request_completed","ai_provider":"local","ai_model_family":"qwen","ai_model_source":"catalog","request_outcome":"success","duration_ms":"12"}),
            json!({"event":"comet_ai_request_completed","ai_provider":"local","ai_model_family":"qwen","ai_model_source":"catalog","request_outcome":"success","duration_ms":12,"error_code":"ai_request_failed"}),
            json!({"event":"comet_ai_request_completed","ai_provider":"local","ai_model_family":"qwen","ai_model_source":"catalog","request_outcome":"error","duration_ms":12}),
            json!({"event":"comet_ai_request_completed","ai_provider":"local","ai_model_family":"qwen","ai_model_source":"service","request_outcome":"success","duration_ms":12}),
            json!({"event":"comet_ai_request_completed","ai_provider":"local","ai_model_family":"qwen","ai_model_source":"catalog","request_outcome":"success","duration_ms":86_400_001}),
            json!({"event":"comet_ai_request_completed","ai_provider":"local","ai_model_family":"qwen","ai_model_source":"catalog","request_outcome":"success","duration_ms":12,"ai_request_count":100}),
            json!({"event":"comet_ai_request_completed","ai_provider":"local","ai_model_family":"qwen","ai_model_source":"catalog","request_outcome":"error","duration_ms":12,"error_code":"ai_request_failed","ai_success_count":1}),
            json!({"event":"comet_ai_request_completed","ai_provider":"local","ai_model_family":"qwen","ai_model_source":"catalog","request_outcome":"success","duration_ms":12,"ai_measured_duration_ms":1}),
            json!({"event":"comet_abnormal_exit","termination_kind":"unclean_exit","crash_app_version":"/Users/private/crash.log"}),
            json!({"event":"comet_abnormal_exit","termination_kind":"segfault","crash_app_version":"0.13.2"}),
        ] {
            if let Ok(event) = serde_json::from_value::<Event>(payload.clone()) {
                assert!(
                    event.body(&test_context("qa"), "123.456", 10).is_err(),
                    "{payload}"
                );
            }
        }
    }

    #[test]
    fn events_from_before_withdrawal_cannot_reuse_later_consent_or_create_identity() {
        let runtime = Runtime::default();
        let directory = tempfile::tempdir().unwrap();
        let old_revision = runtime.consent_revision.load(Ordering::Acquire);
        runtime.consent_revision.fetch_add(1, Ordering::AcqRel);
        runtime.consent_revision.fetch_add(1, Ordering::AcqRel);
        for payload in [
            json!({"event":"comet_ai_request_completed","ai_provider":"local","ai_model_family":"qwen","ai_model_source":"catalog","request_outcome":"success","duration_ms":250}),
            json!({"event":"comet_settings_view","section":"model"}),
            json!({"event":"comet_error","error_source":"frontend_runtime","error_code":"unexpected_error"}),
        ] {
            let event: Event = serde_json::from_value(payload).unwrap();
            assert!(runtime
                .prepare_event(
                    &test_context("qa"),
                    &event,
                    directory.path(),
                    Some(old_revision)
                )
                .unwrap()
                .is_none());
        }
        assert!(!directory.path().join(CLIENT_ID_FILE).exists());
        let event: Event =
            serde_json::from_value(json!({"event":"comet_settings_view","section":"model"}))
                .unwrap();
        let revision = runtime.consent_revision.load(Ordering::Acquire);
        assert!(runtime
            .prepare_event(
                &test_context("qa"),
                &event,
                directory.path(),
                Some(revision)
            )
            .unwrap()
            .is_some());
    }

    #[tokio::test]
    async fn consent_changes_wait_for_active_delivery_and_invalidate_the_previous_revision() {
        let state = crate::app::tests::state();
        let runtime = Runtime::default();
        save_consent(&state, true).unwrap();
        let delivery = runtime.transmission.read().await;
        let mut change =
            Box::pin(runtime.commit_consent_change(|| save_consent(&state, false), || {}));
        assert!(futures_util::poll!(change.as_mut()).is_pending());
        assert!(analytics_consent(&state).unwrap());
        assert_eq!(runtime.consent_revision.load(Ordering::Acquire), 0);

        drop(delivery);
        change.await.unwrap();
        assert!(!analytics_consent(&state).unwrap());
        assert_eq!(runtime.consent_revision.load(Ordering::Acquire), 1);

        let failed: Result<(), String> = runtime
            .commit_consent_change(
                || Err("save failed".into()),
                || panic!("failed persistence must not change marker state"),
            )
            .await;
        assert!(failed.is_err());
        assert_eq!(runtime.consent_revision.load(Ordering::Acquire), 1);
    }

    #[test]
    fn concurrent_webviews_claim_only_one_start_per_process_runtime() {
        let runtime = Arc::new(Runtime::default());
        let claims: Vec<_> = (0..8)
            .map(|_| {
                let runtime = runtime.clone();
                std::thread::spawn(move || runtime.claim_start(true))
            })
            .collect();
        assert_eq!(
            claims
                .into_iter()
                .map(|claim| claim.join().unwrap())
                .filter(|claimed| *claimed)
                .count(),
            1
        );
        assert!(!runtime.claim_start(true));
        assert!(Runtime::default().claim_start(true));
    }

    fn test_context(environment: &'static str) -> Context {
        Context {
            app_version: "0.13.2".into(),
            os: "macos",
            environment,
            app_started: false,
            analytics_consent: true,
            consent_revision: 0,
        }
    }

    #[test]
    fn builds_only_validated_event_fields_and_native_context() {
        for payload in [
            json!({"event": "comet_app_started"}),
            json!({
                "event": "comet_ai_configured",
                "ai_provider": "local",
                "ai_model_family": "custom",
                "ai_model_source": "custom_file",
                "configuration_source": "saved",
            }),
            json!({"event": "comet_ui_action", "feature": "widget", "action": "configure-settings"}),
            json!({"event": "comet_settings_view", "section": "organizer"}),
        ] {
            let event: Event = serde_json::from_value(payload.clone()).unwrap();
            let body = event.body(&test_context("qa"), "123.456", 123).unwrap();
            assert_eq!(body["client_id"], "123.456");
            assert_eq!(body["events"][0]["name"], payload["event"]);
            let params = &body["events"][0]["params"];
            assert_eq!(params["app_version"], "0.13.2");
            assert_eq!(params["os"], "macos");
            assert_eq!(params["environment"], "qa");
            assert_eq!(params["debug_mode"], true);
            assert_eq!(params["session_id"], 123);
            assert_eq!(params["engagement_time_msec"], 1);
            assert!(params.get("ai_request_count").is_none());
            assert!(params.get("ai_success_count").is_none());
            assert!(params.get("ai_measured_duration_ms").is_none());
            assert!(params
                .as_object()
                .unwrap()
                .values()
                .all(|value| !value.is_null()));
        }

        let event: Event = serde_json::from_value(json!({
            "event": "comet_app_started",
            "app_version": "untrusted-version",
            "os": "untrusted-os",
            "environment": "qa",
            "debug_mode": true,
            "ai_provider": null,
            "ai_model_family": null,
            "ai_model_source": null,
            "configuration_source": null,
            "feature": null,
            "action": null,
            "section": null,
        }))
        .unwrap();
        let body = event
            .body(&test_context("production"), "123.456", 123)
            .unwrap();
        let params = &body["events"][0]["params"];
        assert_eq!(params["environment"], "production");
        assert!(params.get("debug_mode").is_none());
        assert!(!body.to_string().contains("untrusted"));
    }

    #[test]
    fn rejects_unknown_names_values_keys_and_event_parameter_combinations() {
        for payload in [
            json!({"event": "private-event"}),
            json!({"event": "comet_app_started", "api_key": "private-key"}),
            json!({"event": "comet_settings_view", "section": "private-section"}),
            json!({
                "event": "comet_ai_configured",
                "ai_provider": "local",
                "ai_model_family": "/Users/private/model.gguf",
                "ai_model_source": "custom_file",
                "configuration_source": "saved",
            }),
        ] {
            assert!(serde_json::from_value::<Event>(payload).is_err());
        }
        for payload in [
            json!({"event": "comet_app_started", "section": "model"}),
            json!({"event": "comet_settings_view"}),
            json!({"event": "comet_ui_action", "feature": "launcher", "action": "delete"}),
            json!({"event": "comet_ui_action", "feature": "widget", "action": "send"}),
            json!({"event": "comet_ui_action", "feature": "conversation", "action": "open"}),
            json!({
                "event": "comet_ai_configured",
                "ai_provider": "local",
                "ai_model_family": "custom",
                "ai_model_source": "service",
                "configuration_source": "saved",
            }),
        ] {
            let event: Event = serde_json::from_value(payload).unwrap();
            assert!(event.body(&test_context("qa"), "123.456", 123).is_err());
        }
    }

    #[test]
    fn keeps_one_anonymous_client_id_across_webviews_and_process_runtimes() {
        let directory = tempfile::tempdir().unwrap();
        let runtime = Arc::new(Runtime::default());
        let workers: Vec<_> = (0..8)
            .map(|_| {
                let runtime = runtime.clone();
                let path = directory.path().to_path_buf();
                std::thread::spawn(move || runtime.client_id(&path).unwrap())
            })
            .collect();
        let ids: Vec<_> = workers
            .into_iter()
            .map(|worker| worker.join().unwrap())
            .collect();
        let id = &ids[0];
        assert!(uuid::Uuid::parse_str(id).is_ok());
        assert!(ids.iter().all(|other| other == id));
        assert_eq!(Runtime::default().client_id(directory.path()).unwrap(), *id);

        let other_directory = tempfile::tempdir().unwrap();
        assert_ne!(
            Runtime::default()
                .client_id(other_directory.path())
                .unwrap(),
            *id
        );
    }

    #[test]
    fn never_replaces_an_existing_invalid_identity_file() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join(CLIENT_ID_FILE);
        fs::write(&path, "existing-user-data").unwrap();
        assert!(Runtime::default().client_id(directory.path()).is_err());
        assert_eq!(fs::read_to_string(path).unwrap(), "existing-user-data");
    }

    #[test]
    fn formats_persisted_uuid_as_stable_positive_client_id_without_rewriting_storage() {
        for (identity, expected) in [
            (uuid::Uuid::from_u64_pair(123, 456), "123.456"),
            (uuid::Uuid::nil(), "1.1"),
        ] {
            let directory = tempfile::tempdir().unwrap();
            let path = directory.path().join(CLIENT_ID_FILE);
            let original = format!("{{\n  \"client_id\": \"{identity}\"\n}}\n");
            fs::write(&path, &original).unwrap();
            let event: Event =
                serde_json::from_value(json!({"event": "comet_app_started"})).unwrap();
            for _ in 0..2 {
                let body = Runtime::default()
                    .prepare_event(&test_context("qa"), &event, directory.path(), None)
                    .unwrap()
                    .unwrap();
                assert_eq!(body["client_id"], expected);
                let parts: Vec<_> = body["client_id"].as_str().unwrap().split('.').collect();
                assert_eq!(parts.len(), 2);
                assert!(parts.iter().all(|part| part.parse::<u64>().unwrap() > 0));
                assert_eq!(fs::read_to_string(&path).unwrap(), original);
            }
        }
    }

    #[test]
    fn analytics_consent_blocks_start_claim_identity_and_event_until_opt_in_and_after_withdrawal() {
        let state = crate::app::tests::state();
        let runtime = Runtime::default();
        let directory = tempfile::tempdir().unwrap();
        let event: Event = serde_json::from_value(json!({"event": "comet_app_started"})).unwrap();
        let mut context = test_context("qa");
        context.analytics_consent = analytics_consent(&state).unwrap();
        assert!(!context.analytics_consent);
        assert!(!runtime.claim_start(context.analytics_consent));
        assert!(runtime
            .prepare_event(&context, &event, directory.path(), None)
            .unwrap()
            .is_none());
        assert!(fs::read_dir(directory.path()).unwrap().next().is_none());
        assert!(runtime.http.get().is_none());

        save_consent(&state, true).unwrap();
        context.analytics_consent = analytics_consent(&state).unwrap();
        assert!(runtime.claim_start(context.analytics_consent));
        assert!(!runtime.claim_start(context.analytics_consent));
        assert!(runtime
            .prepare_event(&context, &event, directory.path(), None)
            .unwrap()
            .is_some());
        let identity = fs::read(directory.path().join(CLIENT_ID_FILE)).unwrap();
        save_consent(&state, false).unwrap();
        context.analytics_consent = analytics_consent(&state).unwrap();
        assert!(!runtime.claim_start(context.analytics_consent));
        assert!(runtime
            .prepare_event(&context, &event, directory.path(), None)
            .unwrap()
            .is_none());
        assert_eq!(
            fs::read(directory.path().join(CLIENT_ID_FILE)).unwrap(),
            identity
        );
        assert!(runtime.http.get().is_none());
    }
}
