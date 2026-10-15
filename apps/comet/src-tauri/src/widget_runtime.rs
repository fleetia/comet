use crate::{
    app::AppState,
    widgets::{self, storage},
};
use serde::Serialize;
use std::{
    collections::BTreeMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
};
use tauri::{Emitter, Manager};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum WindowState {
    Closed,
    Hidden,
    Minimized,
    Visible,
    Unknown,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ToolWindow {
    state: WindowState,
    shared: Option<String>,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub(crate) struct NoteWindows {
    open: usize,
    visible: usize,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub(crate) struct Toys {
    pub starting: usize,
    pub visible: usize,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ActionError {
    attempt_id: String,
    message: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WidgetRuntime {
    id: String,
    tool_window: Option<ToolWindow>,
    display_window: Option<WindowState>,
    note_windows: Option<NoteWindows>,
    toys: Option<Toys>,
    query_error: Option<String>,
    action_error: Option<ActionError>,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub(crate) struct Snapshot {
    sequence: u64,
    widgets: Vec<WidgetRuntime>,
}
#[derive(Default)]
struct Attempts {
    current: BTreeMap<String, String>,
    errors: BTreeMap<String, ActionError>,
}
#[derive(Default)]
pub(crate) struct Runtime {
    // Collection is serialized independently of callbacks that record action results.
    collect: Mutex<()>,
    snapshot: Mutex<Snapshot>,
    attempts: Mutex<Attempts>,
    generation: AtomicU64,
}

fn window_state(
    visible: Result<bool, String>,
    minimized: Result<bool, String>,
) -> Result<WindowState, String> {
    let minimized = minimized?;
    let visible = visible?;
    if minimized {
        return Ok(WindowState::Minimized);
    }
    Ok(if visible {
        WindowState::Visible
    } else {
        WindowState::Hidden
    })
}
fn query_window(app: &tauri::AppHandle, label: &str) -> Result<WindowState, String> {
    let Some(window) = app.get_webview_window(label) else {
        return Ok(WindowState::Closed);
    };
    window_state(
        window.is_visible().map_err(|error| error.to_string()),
        window.is_minimized().map_err(|error| error.to_string()),
    )
}
fn collect(app: &tauri::AppHandle) -> Result<Snapshot, String> {
    let runtime = app.state::<Runtime>();
    let _collection = crate::lock(&runtime.collect)?;
    let generation = runtime.generation.load(Ordering::SeqCst);
    let instances = {
        let state = app.state::<Arc<AppState>>();
        let db = crate::lock(&state.db)?;
        storage::instances(&db)?
    };
    let windows = app.webview_windows();
    let mut entries = Vec::with_capacity(instances.len());
    for instance in instances
        .into_iter()
        .filter(|instance| !widgets::is_retired(&instance.kind))
    {
        let mut errors = Vec::new();
        let is_toy = crate::behavior::TOYS.contains(&instance.kind.as_str());
        let planner = matches!(instance.kind.as_str(), "todo" | "calendar");
        let mut read = |label: &str| match query_window(app, label) {
            Ok(state) => state,
            Err(error) => {
                errors.push(error);
                WindowState::Unknown
            }
        };
        let tool_window = (!is_toy && instance.kind != "memo").then(|| ToolWindow {
            state: read(&if planner {
                "planner".into()
            } else {
                format!("widget-{}", instance.id)
            }),
            shared: planner.then(|| "planner".into()),
        });
        let display_window = widgets::appearance::supports(&instance.kind)
            .then(|| read(&format!("widget-display-{}", instance.id)));
        let note_windows = if instance.kind == "memo" {
            let prefix = format!("widget-{}-note-", instance.id);
            let mut count = NoteWindows::default();
            for label in windows.keys().filter(|label| label.starts_with(&prefix)) {
                count.open += 1;
                if read(label) == WindowState::Visible {
                    count.visible += 1;
                }
            }
            Some(count)
        } else {
            None
        };
        let toys = if is_toy {
            match crate::desktop_toys::runtime_counts(app, &instance.id) {
                Ok(count) => Some(count),
                Err(error) => {
                    errors.push(error);
                    Some(Toys::default())
                }
            }
        } else {
            None
        };
        entries.push(WidgetRuntime {
            id: instance.id,
            tool_window,
            display_window,
            note_windows,
            toys,
            query_error: (!errors.is_empty()).then(|| errors.join(" · ")),
            action_error: None,
        });
    }
    let attempts = crate::lock(&runtime.attempts)?;
    for entry in &mut entries {
        entry.action_error = attempts.errors.get(&entry.id).cloned();
    }
    drop(attempts);
    accept_collection(&runtime, generation, entries)
}

fn accept_collection(
    runtime: &Runtime,
    generation: u64,
    entries: Vec<WidgetRuntime>,
) -> Result<Snapshot, String> {
    let mut previous = crate::lock(&runtime.snapshot)?;
    if generation != runtime.generation.load(Ordering::SeqCst) {
        return Err("위젯 창 상태가 바뀌었어요. 다시 확인하고 있어요.".into());
    }
    if previous.widgets != entries {
        previous.sequence += 1;
        previous.widgets = entries;
    }
    Ok(previous.clone())
}

pub(crate) fn refresh(app: &tauri::AppHandle) {
    let Some(runtime) = app.try_state::<Runtime>() else {
        return;
    };
    if let Ok(_commit) = runtime.snapshot.lock() {
        runtime.generation.fetch_add(1, Ordering::SeqCst);
    }
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Ok(snapshot) = collect(&app) {
            let _ = app.emit_to("settings", "widgets-runtime", snapshot);
        }
    });
}
#[tauri::command]
pub(crate) async fn get_widget_runtime(app: tauri::AppHandle) -> Result<Snapshot, String> {
    tauri::async_runtime::spawn_blocking(move || collect(&app))
        .await
        .map_err(|error| error.to_string())?
}

pub(crate) fn begin_attempt(app: &tauri::AppHandle, id: &str) -> String {
    let attempt = uuid::Uuid::new_v4().to_string();
    if let Some(runtime) = app.try_state::<Runtime>() {
        if let Ok(mut attempts) = runtime.attempts.lock() {
            attempts.current.insert(id.into(), attempt.clone());
            attempts.errors.remove(id);
        }
    }
    attempt
}
fn finish_attempt(attempts: &mut Attempts, id: &str, attempt: &str, result: Result<(), String>) {
    if attempts
        .current
        .get(id)
        .is_none_or(|current| current != attempt)
    {
        return;
    }
    match result {
        Ok(()) => {
            attempts.errors.remove(id);
        }
        Err(message) => {
            attempts.errors.insert(
                id.into(),
                ActionError {
                    attempt_id: attempt.into(),
                    message,
                },
            );
        }
    }
}
pub(crate) fn attempt_result(
    app: &tauri::AppHandle,
    id: &str,
    attempt: &str,
    result: Result<(), String>,
) {
    if let Some(runtime) = app.try_state::<Runtime>() {
        if let Ok(mut attempts) = runtime.attempts.lock() {
            finish_attempt(&mut attempts, id, attempt, result);
        }
    }
    refresh(app);
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn minimized_is_distinct_from_hidden_and_query_failure_is_never_closed() {
        assert_eq!(
            window_state(Ok(true), Ok(true)).unwrap(),
            WindowState::Minimized
        );
        assert_eq!(
            window_state(Ok(false), Ok(false)).unwrap(),
            WindowState::Hidden
        );
        assert_eq!(
            window_state(Ok(true), Ok(false)).unwrap(),
            WindowState::Visible
        );
        assert!(window_state(Err("query".into()), Ok(false)).is_err());
    }
    #[test]
    fn stale_native_creation_cannot_replace_a_new_attempt_or_clear_its_error() {
        let mut attempts = Attempts::default();
        attempts.current.insert("widget".into(), "new".into());
        finish_attempt(&mut attempts, "widget", "new", Err("new failed".into()));
        finish_attempt(&mut attempts, "widget", "old", Ok(()));
        assert_eq!(attempts.errors["widget"].message, "new failed");
        finish_attempt(&mut attempts, "widget", "new", Ok(()));
        assert!(!attempts.errors.contains_key("widget"));
    }
    #[test]
    fn collection_crossing_a_native_change_cannot_receive_a_newer_sequence() {
        let runtime = Runtime::default();
        let entry = WidgetRuntime {
            id: "widget".into(),
            tool_window: None,
            display_window: None,
            note_windows: None,
            toys: None,
            query_error: None,
            action_error: None,
        };
        assert_eq!(
            accept_collection(&runtime, 0, vec![entry.clone()])
                .unwrap()
                .sequence,
            1
        );
        assert_eq!(
            accept_collection(&runtime, 0, vec![entry.clone()])
                .unwrap()
                .sequence,
            1
        );
        runtime.generation.store(1, Ordering::SeqCst);
        assert!(accept_collection(&runtime, 0, vec![]).is_err());
        assert_eq!(runtime.snapshot.lock().unwrap().sequence, 1);
        assert_eq!(accept_collection(&runtime, 1, vec![]).unwrap().sequence, 2);
    }
}
