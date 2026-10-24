//! Retain at most one GTK webview per planning surface. Editor state belongs to
//! the frontend generation, not the retained native window.
use super::{Navigation, PlannerViewTarget};
use serde::Serialize;
use tauri::{Emitter, Manager};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
pub(crate) struct ViewState {
    generation: u64,
    active: bool,
}

#[derive(Clone, Serialize)]
struct WindowMessage {
    label: String,
    #[serde(flatten)]
    state: ViewState,
}

fn emit_state(window: &tauri::WebviewWindow, state: ViewState) -> tauri::Result<()> {
    window.emit_to(
        window.label(),
        "planning-window-state",
        WindowMessage {
            label: window.label().into(),
            state,
        },
    )
}

#[derive(Clone)]
pub(super) enum OpenRequest {
    Planner {
        tab: String,
        target: Option<PlannerViewTarget>,
        note: Option<String>,
    },
    Travel {
        id: Option<String>,
    },
}

impl OpenRequest {
    fn label(&self) -> &'static str {
        match self {
            Self::Planner { .. } => "planner",
            Self::Travel { .. } => "travel",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ReleasePolicy {
    Hide,
    Destroy,
}
impl ReleasePolicy {
    fn for_backend(gtk: bool) -> Self {
        if gtk {
            Self::Hide
        } else {
            Self::Destroy
        }
    }
    fn current() -> Self {
        Self::for_backend(cfg!(any(
            target_os = "linux",
            target_os = "dragonfly",
            target_os = "freebsd",
            target_os = "netbsd",
            target_os = "openbsd"
        )))
    }
}

#[derive(Clone)]
struct OpenTicket {
    generation: u64,
    request: OpenRequest,
}

#[derive(Default)]
pub(super) struct WindowRuntime {
    state: ViewState,
    requested_generation: u64,
    destroying: bool,
    pending_open: Option<OpenTicket>,
}
impl WindowRuntime {
    fn open(&mut self, request: OpenRequest) -> Option<OpenTicket> {
        self.requested_generation += 1;
        let ticket = OpenTicket {
            generation: self.requested_generation,
            request,
        };
        if self.destroying {
            self.pending_open = Some(ticket);
            return None;
        }
        Some(ticket)
    }
    fn activate(&mut self, generation: u64) -> bool {
        if self.destroying || self.requested_generation != generation {
            return false;
        }
        self.state = ViewState {
            generation,
            active: true,
        };
        true
    }
    fn release(&mut self, generation: u64, policy: ReleasePolicy) -> bool {
        if self.destroying
            || !self.state.active
            || self.state.generation != generation
            || self.requested_generation != generation
        {
            return false;
        }
        self.state.active = false;
        self.destroying = policy == ReleasePolicy::Destroy;
        true
    }
    fn destroyed(&mut self) -> Option<OpenTicket> {
        self.state.active = false;
        self.destroying = false;
        self.pending_open.take()
    }
}

fn runtime<'a>(
    navigation: &'a Navigation,
    label: &str,
) -> Result<&'a std::sync::Mutex<WindowRuntime>, String> {
    match label {
        "planner" => Ok(&navigation.planner),
        "travel" => Ok(&navigation.travel),
        _ => Err("다이어리 또는 여행 창에서만 사용할 수 있어요.".into()),
    }
}

#[tauri::command]
pub(crate) fn get_planning_window_state(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Navigation>,
) -> Result<ViewState, String> {
    Ok(crate::lock(runtime(&state, window.label())?)?.state)
}

#[tauri::command]
pub(crate) fn get_travel_target(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Navigation>,
) -> Result<Option<String>, String> {
    if window.label() != "travel" {
        return Err("여행 창에서만 사용할 수 있어요.".into());
    }
    Ok(crate::lock(&state.travel_target)?.clone())
}

pub(super) fn schedule_open(app: &tauri::AppHandle, request: OpenRequest) -> Result<(), String> {
    let ticket = {
        let navigation = app.state::<Navigation>();
        let mut runtime = crate::lock(runtime(&navigation, request.label())?)?;
        runtime.open(request)
    };
    if let Some(ticket) = ticket {
        schedule_ticket(app, ticket)?;
    }
    Ok(())
}

fn schedule_ticket(app: &tauri::AppHandle, ticket: OpenTicket) -> Result<(), String> {
    let handle = app.clone();
    app.run_on_main_thread(move || {
        if let Err(error) = show(&handle, ticket) {
            eprintln!("Planning window open failed: {error}");
        }
    })
    .map_err(|error| error.to_string())
}

fn travel_navigation_requested(was_active: bool, id: Option<&str>) -> bool {
    id.is_some() || !was_active
}

fn show(app: &tauri::AppHandle, ticket: OpenTicket) -> Result<(), String> {
    let state = app.state::<std::sync::Arc<crate::AppState>>();
    if crate::unavailable(&state) {
        return Ok(());
    }
    let navigation = app.state::<Navigation>();
    let request = ticket.request;
    let label = request.label();
    let mut runtime = crate::lock(runtime(&navigation, label)?)?;
    let was_active = runtime.state.active;
    if !runtime.activate(ticket.generation) {
        return Ok(());
    }
    // Store navigation before notifying/remounting the frontend. A listener
    // registered after the event can recover the same request from getters.
    match &request {
        OpenRequest::Planner { tab, target, note } => {
            *crate::lock(&navigation.tab)? = tab.clone();
            *crate::lock(&navigation.view_target)? = target.clone();
            *crate::lock(&navigation.note_target)? = note.clone();
        }
        OpenRequest::Travel { id } => *crate::lock(&navigation.travel_target)? = id.clone(),
    }
    let result = (|| {
        if let Some(window) = app.get_webview_window(label) {
            emit_state(&window, runtime.state).map_err(|e| e.to_string())?;
            match &request {
                OpenRequest::Planner { tab, target, note } => {
                    if let Some(target) = target {
                        window
                            .emit("planner-view-target", target)
                            .map_err(|e| e.to_string())?;
                    } else {
                        window.emit("planner-tab", tab).map_err(|e| e.to_string())?;
                    }
                    if let Some(note) = note {
                        window
                            .emit("planner-note", note)
                            .map_err(|e| e.to_string())?;
                    }
                }
                OpenRequest::Travel { id } => {
                    // Focusing an already-open trip without a target must not
                    // reset its selection or tab. Fresh editors still reset.
                    if travel_navigation_requested(was_active, id.as_deref()) {
                        window.emit("travel-open", id).map_err(|e| e.to_string())?;
                    }
                }
            }
            window.unminimize().map_err(|e| e.to_string())?;
            window.show().map_err(|e| e.to_string())?;
            window.set_focus().map_err(|e| e.to_string())?;
        } else {
            let (url, title, width, height) = match &request {
                OpenRequest::Planner { tab, .. } => (
                    format!("index.html?view=planner&tab={tab}"),
                    "comet · 내 다이어리",
                    1328.0,
                    820.0,
                ),
                OpenRequest::Travel { id } => (
                    format!(
                        "index.html?view=travel{}",
                        id.as_ref()
                            .map(|id| format!("&id={id}"))
                            .unwrap_or_default()
                    ),
                    "comet · 여행",
                    1120.0,
                    840.0,
                ),
            };
            tauri::WebviewWindowBuilder::new(app, label, tauri::WebviewUrl::App(url.into()))
                .title(title)
                .inner_size(width, height)
                .min_inner_size(720.0, 520.0)
                .decorations(false)
                .transparent(true)
                .disable_drag_drop_handler()
                .build()
                .map_err(|e| e.to_string())?;
        }
        Ok::<(), String>(())
    })();
    if result.is_err() && app.get_webview_window(label).is_none() {
        runtime.state.active = false;
    }
    drop(runtime);
    if label == "planner" {
        crate::widgets::runtime::refresh(app);
    }
    result
}

#[tauri::command]
pub(crate) async fn release_planning_window(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    generation: u64,
) -> Result<ViewState, String> {
    let label = window.label().to_owned();
    // Validate the invoking window before scheduling an operation.
    runtime(&app.state::<Navigation>(), &label)?;
    let (send, receive) = tokio::sync::oneshot::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let result = (|| {
            let navigation = handle.state::<Navigation>();
            let mut runtime = crate::lock(runtime(&navigation, &label)?)?;
            let previous = runtime.state;
            let policy = ReleasePolicy::current();
            if !runtime.release(generation, policy) {
                return Ok(runtime.state);
            }
            if let Some(window) = handle.get_webview_window(&label) {
                let closed = match policy {
                    ReleasePolicy::Hide => window.hide(),
                    ReleasePolicy::Destroy => window.destroy(),
                };
                if let Err(error) = closed {
                    runtime.state = previous;
                    runtime.destroying = false;
                    return Err(error.to_string());
                }
                // Destroy may already remove the receiver; the command response
                // remains authoritative. Event failure must not undo a close.
                let _ = emit_state(&window, runtime.state);
            } else {
                runtime.destroying = false;
            }
            let state = runtime.state;
            drop(runtime);
            if label == "planner" {
                crate::widgets::runtime::refresh(&handle);
            }
            Ok(state)
        })();
        let _ = send.send(result);
    })
    .map_err(|error| error.to_string())?;
    receive.await.map_err(|error| error.to_string())?
}

// RunEvent occurs after Tauri has removed the old label from its manager.
pub(crate) fn destroyed(app: &tauri::AppHandle, label: &str) {
    let navigation = app.state::<Navigation>();
    let pending = runtime(&navigation, label)
        .ok()
        .and_then(|runtime| crate::lock(runtime).ok()?.destroyed());
    if let Some(ticket) = pending {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = schedule_ticket(&app, ticket) {
                eprintln!("Planning window reopen failed: {error}");
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request() -> OpenRequest {
        OpenRequest::Travel { id: None }
    }

    #[test]
    fn state_events_identify_their_own_planning_window() {
        let state = ViewState {
            generation: 1,
            active: false,
        };
        for label in ["planner", "travel"] {
            let value = serde_json::to_value(WindowMessage {
                label: label.into(),
                state,
            })
            .unwrap();
            assert_eq!(
                value,
                serde_json::json!({"label": label, "generation": 1, "active": false})
            );
        }
    }

    #[test]
    fn gtk_policy_reuses_and_other_backends_destroy() {
        assert_eq!(ReleasePolicy::for_backend(true), ReleasePolicy::Hide);
        assert_eq!(ReleasePolicy::for_backend(false), ReleasePolicy::Destroy);
    }

    #[test]
    fn travel_focus_preserves_active_selection_but_fresh_open_resets() {
        assert!(!travel_navigation_requested(true, None));
        assert!(travel_navigation_requested(true, Some("trip")));
        assert!(travel_navigation_requested(false, None));
        assert!(travel_navigation_requested(false, Some("trip")));
    }

    #[test]
    fn queued_open_does_not_publish_an_inactive_new_generation() {
        let mut runtime = WindowRuntime::default();
        let first = runtime.open(request()).unwrap();
        assert_eq!(runtime.state, ViewState::default());
        assert!(runtime.activate(first.generation));
        assert!(runtime.release(first.generation, ReleasePolicy::Hide));
        let closed = runtime.state;
        let next = runtime.open(request()).unwrap();
        assert_eq!(runtime.state, closed);
        assert!(!runtime.release(first.generation, ReleasePolicy::Hide));
        assert_eq!(runtime.state, closed);
        assert!(runtime.activate(next.generation));
        assert_eq!(
            runtime.state,
            ViewState {
                generation: next.generation,
                active: true
            }
        );
    }

    #[test]
    fn pending_active_open_protects_against_old_close_without_publishing_early() {
        let mut runtime = WindowRuntime::default();
        let first = runtime.open(request()).unwrap();
        assert!(runtime.activate(first.generation));
        let published = runtime.state;
        let next = runtime.open(request()).unwrap();
        assert_eq!(runtime.state, published);
        assert!(!runtime.release(first.generation, ReleasePolicy::Hide));
        assert_eq!(runtime.state, published);
        assert!(runtime.activate(next.generation));
        assert_eq!(
            runtime.state,
            ViewState {
                generation: next.generation,
                active: true
            }
        );
    }

    #[test]
    fn active_open_advances_token_and_stale_release_cannot_hide_newer_open() {
        let mut runtime = WindowRuntime::default();
        let first = runtime.open(request()).unwrap();
        assert!(runtime.activate(first.generation));
        let next = runtime.open(request()).unwrap();
        assert!(runtime.state.active);
        assert!(!runtime.release(first.generation, ReleasePolicy::Hide));
        assert!(runtime.activate(next.generation));
        assert!(runtime.release(next.generation, ReleasePolicy::Hide));
        assert!(!runtime.release(next.generation, ReleasePolicy::Hide));
        let reopened = runtime.open(request()).unwrap();
        assert!(runtime.activate(reopened.generation));
        assert!(!runtime.release(next.generation, ReleasePolicy::Hide));
        assert!(runtime.state.active);
    }

    #[test]
    fn repeated_gtk_cycles_never_require_destroy_or_pending_recreation() {
        let mut runtime = WindowRuntime::default();
        for generation in 1..=100 {
            let ticket = runtime.open(request()).unwrap();
            assert!(runtime.activate(ticket.generation));
            assert_eq!(
                runtime.state,
                ViewState {
                    generation,
                    active: true
                }
            );
            assert!(runtime.release(generation, ReleasePolicy::Hide));
            assert!(!runtime.destroying);
            assert!(runtime.pending_open.is_none());
        }
    }

    #[test]
    fn destruction_defers_reopen_and_keeps_latest_request() {
        let mut runtime = WindowRuntime::default();
        let first = runtime.open(request()).unwrap();
        assert!(runtime.activate(first.generation));
        assert!(runtime.release(first.generation, ReleasePolicy::Destroy));
        assert!(runtime.open(request()).is_none());
        assert!(runtime
            .open(OpenRequest::Travel {
                id: Some("latest".into())
            })
            .is_none());
        assert!(!runtime.release(first.generation, ReleasePolicy::Destroy));
        let pending = runtime.destroyed().unwrap();
        assert!(matches!(&pending.request, OpenRequest::Travel { id: Some(id) } if id == "latest"));
        assert!(runtime.activate(pending.generation));
        assert_eq!(runtime.state.generation, first.generation + 2);
        assert!(runtime.state.active);
    }

    #[test]
    fn newer_open_supersedes_a_deferred_recreation_before_it_runs() {
        let mut runtime = WindowRuntime::default();
        let first = runtime.open(request()).unwrap();
        assert!(runtime.activate(first.generation));
        assert!(runtime.release(first.generation, ReleasePolicy::Destroy));
        assert!(runtime.open(request()).is_none());
        let deferred = runtime.destroyed().unwrap();
        let latest = runtime.open(request()).unwrap();
        assert!(!runtime.activate(deferred.generation));
        assert!(runtime.activate(latest.generation));
    }
}
