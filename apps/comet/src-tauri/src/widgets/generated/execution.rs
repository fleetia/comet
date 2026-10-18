use super::{err, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, LazyLock, Mutex,
    },
    time::Duration,
};
use tauri::Manager;
use tokio::sync::{oneshot, Semaphore};

struct UiWindowLifetime(Arc<AtomicBool>);

impl UiWindowLifetime {
    fn observe(&self, event: &tauri::WindowEvent) {
        if matches!(
            event,
            tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed
        ) {
            self.0.store(true, Ordering::SeqCst);
        }
    }
}

impl tauri::Resource for UiWindowLifetime {
    fn close(self: Arc<Self>) {
        self.0.store(true, Ordering::SeqCst);
    }
}

fn ui_lifetime(resources: &tauri::ResourceTable) -> Result<Arc<UiWindowLifetime>> {
    resources
        .names()
        .find_map(|(id, _)| resources.get::<UiWindowLifetime>(id).ok())
        .ok_or_else(|| "위젯 창의 실행 정보를 확인하지 못했어요. 창을 다시 열어 주세요.".into())
}

// Stored on this native window, so reopening the same label cannot revive its old requests.
pub fn bind_ui_window(window: &tauri::WebviewWindow) {
    let lifetime = Arc::new(UiWindowLifetime(Arc::new(AtomicBool::new(false))));
    window.resources_table().add_arc(lifetime.clone());
    window.on_window_event(move |event| lifetime.observe(event));
}

pub fn ui_window_cancel(window: &tauri::WebviewWindow) -> Result<Arc<AtomicBool>> {
    Ok(ui_lifetime(&window.resources_table())?.0.clone())
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionInput {
    pub source: String,
    pub state: Value,
    pub action: Value,
    pub now: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ExecutionOutput {
    pub state: Value,
    pub view: Value,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(
    tag = "kind",
    content = "message",
    rename_all = "camelCase",
    deny_unknown_fields
)]
pub enum ExecutionFailure {
    HostFailure(String),
    InterpreterFailure(String),
}

impl From<String> for ExecutionFailure {
    fn from(message: String) -> Self {
        Self::HostFailure(message)
    }
}

impl From<&str> for ExecutionFailure {
    fn from(message: &str) -> Self {
        Self::HostFailure(message.into())
    }
}

impl ExecutionFailure {
    fn message(&self) -> &str {
        match self {
            Self::HostFailure(message) | Self::InterpreterFailure(message) => message,
        }
    }
}

type ExecutionResult = std::result::Result<ExecutionOutput, ExecutionFailure>;

struct Pending {
    input: Option<ExecutionInput>,
    sender: oneshot::Sender<ExecutionResult>,
}

static PENDING: LazyLock<Mutex<BTreeMap<String, Pending>>> =
    LazyLock::new(|| Mutex::new(BTreeMap::new()));
static SLOTS: LazyLock<Semaphore> = LazyLock::new(|| Semaphore::new(2));

fn label(token: &str) -> String {
    format!("generated-widget-executor-{token}")
}

pub fn claim(window: &tauri::WebviewWindow, token: &str) -> Result<ExecutionInput> {
    if window.label() != label(token) {
        return Err("이 위젯 실행 창의 요청이 아니에요.".into());
    }
    PENDING
        .lock()
        .map_err(err)?
        .get_mut(token)
        .and_then(|job| job.input.take())
        .ok_or_else(|| "이미 처리했거나 만료된 위젯 실행 요청이에요.".into())
}

pub fn complete(
    window: &tauri::WebviewWindow,
    token: &str,
    result: Option<ExecutionOutput>,
    error: Option<ExecutionFailure>,
) -> Result<()> {
    if window.label() != label(token) {
        return Err("이 위젯 실행 창의 결과가 아니에요.".into());
    }
    let mut pending = PENDING.lock().map_err(err)?;
    let job = pending.get(token).ok_or("만료된 위젯 실행 결과예요.")?;
    if job.input.is_some() {
        return Err("아직 시작하지 않은 위젯 실행 결과예요.".into());
    }
    let output = match (result, error) {
        (Some(result), None) => {
            super::validate_state(&result.state)?;
            if !result.view.is_array()
                || serde_json::to_vec(&result).map_err(err)?.len() > super::MAX_STATE_BYTES
            {
                return Err("위젯 실행 결과가 크기 제한을 넘었어요.".into());
            }
            Ok(result)
        }
        (None, Some(error))
            if !error.message().is_empty() && error.message().chars().count() <= 300 =>
        {
            Err(error)
        }
        _ => return Err("위젯 실행 응답 형식이 올바르지 않아요.".into()),
    };
    let job = pending.remove(token).ok_or("만료된 위젯 실행 결과예요.")?;
    job.sender
        .send(output)
        .map_err(|_| "위젯 실행 요청이 취소됐어요.".to_string())
}

struct ExecutionCleanup {
    app: tauri::AppHandle,
    token: String,
}
impl Drop for ExecutionCleanup {
    fn drop(&mut self) {
        if let Ok(mut pending) = PENDING.lock() {
            pending.remove(&self.token);
        }
        if let Some(window) = self.app.get_webview_window(&label(&self.token)) {
            let _ = window.destroy();
        }
    }
}

pub async fn run(
    app: &tauri::AppHandle,
    input: ExecutionInput,
    cancel: Arc<AtomicBool>,
) -> ExecutionResult {
    let _permit = tokio::select! {
        _=crate::models::cancelled(cancel.clone())=>return Err("위젯 실행을 취소했어요.".into()),
        result=tokio::time::timeout(Duration::from_secs(5),SLOTS.acquire())=>result.map_err(|_|"다른 위젯 실행이 끝나지 않았어요.".to_string())?.map_err(err)?,
    };
    let token = uuid::Uuid::new_v4().to_string();
    let (sender, receiver) = oneshot::channel();
    PENDING.lock().map_err(err)?.insert(
        token.clone(),
        Pending {
            input: Some(input),
            sender,
        },
    );
    let _cleanup = ExecutionCleanup {
        app: app.clone(),
        token: token.clone(),
    };
    tauri::WebviewWindowBuilder::new(
        app,
        label(&token),
        tauri::WebviewUrl::App(
            format!("index.html?view=generated-widget-executor&token={token}").into(),
        ),
    )
    .title("comet widget executor")
    .inner_size(1., 1.)
    .decorations(false)
    .resizable(false)
    .visible(false)
    .focused(false)
    .skip_taskbar(true)
    .build()
    .map_err(err)?;
    tokio::select! {
        _=crate::models::cancelled(cancel)=>Err("위젯 실행을 취소했어요.".into()),
        result=tokio::time::timeout(Duration::from_secs(8),receiver)=>result.map_err(|_|"위젯 실행 응답이 제한 시간을 넘었어요.".to_string())?.map_err(err)?,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interpreter_failure_requires_a_distinct_tag_and_host_errors_keep_their_kind() {
        let failed: ExecutionFailure = serde_json::from_value(
            serde_json::json!({"kind":"interpreterFailure","message":"reducer failed"}),
        )
        .unwrap();
        assert!(matches!(failed, ExecutionFailure::InterpreterFailure(_)));
        let host: ExecutionFailure = "expired request".into();
        assert_eq!(
            serde_json::to_value(host).unwrap(),
            serde_json::json!({"kind":"hostFailure","message":"expired request"})
        );
        for payload in [
            serde_json::json!("reducer failed"),
            serde_json::json!({"message":"reducer failed"}),
            serde_json::json!({"kind":"other","message":"reducer failed"}),
        ] {
            assert!(serde_json::from_value::<ExecutionFailure>(payload).is_err());
        }
    }

    #[test]
    fn closing_a_window_cancels_its_requests_without_cancelling_a_reopened_window() {
        let old = Arc::new(UiWindowLifetime(Arc::new(AtomicBool::new(false))));
        let reopened = Arc::new(UiWindowLifetime(Arc::new(AtomicBool::new(false))));
        let mut old_resources = tauri::ResourceTable::default();
        let mut new_resources = tauri::ResourceTable::default();
        let old_id = old_resources.add_arc(old.clone());
        new_resources.add_arc(reopened.clone());
        let pending = ui_lifetime(&old_resources).unwrap().0.clone();
        old.observe(&tauri::WindowEvent::Destroyed);
        assert!(pending.load(Ordering::SeqCst));
        assert!(!ui_lifetime(&new_resources)
            .unwrap()
            .0
            .load(Ordering::SeqCst));
        old_resources.close(old_id).unwrap();
        assert!(ui_lifetime(&old_resources).is_err());
        assert!(pending.load(Ordering::SeqCst));
        assert!(!reopened.0.load(Ordering::SeqCst));
    }
}
