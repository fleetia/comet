use super::{lock, AppState};
use crate::store;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{Emitter, Manager};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Anchor {
    message_id: String,
    offset: f64,
}

// Only navigation metadata survives the webview. Messages and drafts are re-read from SQLite.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Restoration {
    user_id: String,
    selected_id: Option<String>,
    filter: String,
    query: String,
    anchor: Option<Anchor>,
    following_tail: bool,
}

#[derive(Clone, Serialize)]
pub(crate) struct ViewState {
    generation: u64,
    restoration: Option<Restoration>,
}

#[derive(Clone, Serialize)]
struct OpenRequest {
    generation: u64,
    persona: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ReleasePolicy {
    Hide,
    Destroy,
}

impl ReleasePolicy {
    fn for_backend(uses_gtk: bool) -> Self {
        if uses_gtk {
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

#[derive(Default)]
pub(crate) struct Runtime {
    generation: u64,
    restoration: Option<Restoration>,
    destroying: bool,
    pending_open: Option<OpenRequest>,
}

impl Runtime {
    fn open(&mut self, persona: &str) -> OpenRequest {
        self.generation += 1;
        let request = OpenRequest {
            generation: self.generation,
            persona: persona.into(),
        };
        if self.destroying {
            self.pending_open = Some(request.clone());
        }
        request
    }

    fn can_release(&self, generation: u64) -> bool {
        !self.destroying && generation == self.generation
    }

    fn begin_release(&mut self, policy: ReleasePolicy) {
        // GTK reuses the existing view while awaiting the upstream ownership fix.
        // Only actual destruction needs to defer subsequent opens until Destroyed.
        self.destroying = policy == ReleasePolicy::Destroy;
    }

    fn destroyed(&mut self) -> Option<OpenRequest> {
        self.destroying = false;
        self.pending_open.take()
    }
}

fn valid_restoration(state: &AppState, value: &Restoration) -> Result<bool, String> {
    let db = lock(&state.db)?;
    Ok(store::current_user(&db)?
        .map(|user| user.id)
        .unwrap_or_default()
        == value.user_id
        && value
            .selected_id
            .as_ref()
            .is_none_or(|id| store::conversation(&db, id).is_ok())
        && value.filter.len() <= 512
        && value.query.len() <= 16_384
        && value.anchor.as_ref().is_none_or(|anchor| {
            anchor.message_id.len() <= 512 && anchor.offset.is_finite()
        }))
}

#[tauri::command]
pub(crate) fn get_conversation_history_state(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<ViewState, String> {
    let mut runtime = lock(&state.history_window)?;
    if let Some(value) = runtime.restoration.as_mut() {
        {
            let db = lock(&state.db)?;
            if value
                .selected_id
                .as_ref()
                .is_some_and(|id| store::conversation(&db, id).is_err())
            {
                value.selected_id = None;
                value.anchor = None;
                value.following_tail = true;
            }
        }
        if !valid_restoration(&state, value)? {
            runtime.restoration = None;
        }
    }
    Ok(ViewState {
        generation: runtime.generation,
        restoration: runtime.restoration.clone(),
    })
}

pub(crate) fn open(app: &tauri::AppHandle, persona: &str) -> Result<(), String> {
    let state = app.state::<Arc<AppState>>();
    let request = {
        let mut runtime = lock(&state.history_window)?;
        let request = runtime.open(persona);
        if runtime.destroying {
            return Ok(());
        }
        request
    };
    schedule_open(app, request)
}

fn schedule_open(app: &tauri::AppHandle, request: OpenRequest) -> Result<(), String> {
    let handle = app.clone();
    app.run_on_main_thread(move || {
        if let Err(error) = show(&handle, request) {
            eprintln!("History window open failed: {error}");
        }
    })
    .map_err(|error| error.to_string())
}

fn show(app: &tauri::AppHandle, request: OpenRequest) -> Result<(), String> {
    let state = app.state::<Arc<AppState>>();
    let runtime = lock(&state.history_window)?;
    if runtime.destroying || runtime.generation != request.generation || super::unavailable(&state) {
        return Ok(());
    }
    if let Some(window) = app.get_webview_window("conversation-history") {
        window
            .emit("conversation-history-open", &request)
            .map_err(|error| error.to_string())?;
        window.unminimize().map_err(|error| error.to_string())?;
        window.show().map_err(|error| error.to_string())?;
        return window.set_focus().map_err(|error| error.to_string());
    }
    let mut url =
        tauri::Url::parse("https://comet.local/index.html").map_err(|error| error.to_string())?;
    url.query_pairs_mut()
        .append_pair("view", "conversation-history")
        .append_pair("persona", &request.persona);
    tauri::WebviewWindowBuilder::new(
        app,
        "conversation-history",
        tauri::WebviewUrl::App(format!("index.html?{}", url.query().unwrap_or_default()).into()),
    )
        .title("comet · 지난 대화")
        .inner_size(1200.0, 788.0)
        .min_inner_size(800.0, 560.0)
        .decorations(false)
        .transparent(true)
        .disable_drag_drop_handler()
        .build()
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub(crate) async fn release(
    app: tauri::AppHandle,
    state: Arc<AppState>,
    session_id: Option<String>,
    generation: u64,
    restoration: Option<Restoration>,
) -> Result<bool, String> {
    let (send, receive) = tokio::sync::oneshot::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let result = (|| {
            let mut runtime = lock(&state.history_window)?;
            if !runtime.can_release(generation) {
                return Ok(false);
            }
            let action = lock(&state.action)?;
            let user_id = store::current_user(&*lock(&state.db)?)?.map(|user| user.id);
            let mut restoration = match restoration {
                Some(value) => {
                    if Some(&value.user_id) != user_id.as_ref() {
                        return Ok(false);
                    }
                    Some(value)
                }
                None => {
                    // The loading/error shell has no editor or fresh navigation state.
                    // Never use this route to hand off an active editor without its state.
                    if session_id.is_some() {
                        return Err("작성 중인 대화를 저장한 뒤 닫아 주세요.".into());
                    }
                    match runtime.restoration.as_ref() {
                        Some(value) if valid_restoration(&state, value)? => Some(value.clone()),
                        _ => None,
                    }
                }
            };
            if let Some(value) = restoration.as_mut() {
                if value.query.len() > 16_384
                    || value.filter.len() > 512
                    || value.anchor.as_ref().is_some_and(|anchor| {
                        anchor.message_id.len() > 512 || !anchor.offset.is_finite()
                    })
                {
                    return Err("검색어나 스크롤 위치가 너무 길거나 올바르지 않아요. 검색어를 줄인 뒤 닫아 주세요.".into());
                }
                let db = lock(&state.db)?;
                if value
                    .selected_id
                    .as_ref()
                    .is_some_and(|id| store::conversation(&db, id).is_err())
                {
                    value.selected_id = None;
                    value.anchor = None;
                    value.following_tail = true;
                }
            }
            let Some(window) = handle.get_webview_window("conversation-history") else {
                return Ok(false);
            };
            let released =
                super::chat::release_history_editor_locked(&state, session_id.as_deref())?;
            let policy = ReleasePolicy::current();
            runtime.begin_release(policy);
            // GTK hides and reuses its view until the upstream ownership fix lands.
            // Other backends destroy after saving; queued destruction defers reopens.
            let closed = match policy {
                ReleasePolicy::Hide => window.hide(),
                ReleasePolicy::Destroy => window.destroy(),
            };
            if let Err(error) = closed {
                runtime.destroying = false;
                if released {
                    if let Some(panel) = lock(&state.panel)?.as_mut() {
                        panel.mode = "history-input".into();
                    }
                }
                return Err(error.to_string());
            }
            runtime.restoration = restoration;
            drop(action);
            drop(runtime);
            if released {
                super::publish(&handle, &state);
                // Close succeeded; a focus failure must not look like an unsaved close.
                if let Err(error) = crate::desktop::request_balloon_focus(&handle) {
                    eprintln!("History released but input focus failed: {error}");
                }
            }
            Ok(true)
        })();
        let _ = send.send(result);
    })
    .map_err(|error| error.to_string())?;
    receive.await.map_err(|error| error.to_string())?
}

// Called from RunEvent, after Tauri removes the destroyed window from its manager.
pub(crate) fn destroyed(app: &tauri::AppHandle) {
    let state = app.state::<Arc<AppState>>();
    let request = lock(&state.history_window)
        .ok()
        .and_then(|mut runtime| runtime.destroyed());
    if let Some(request) = request {
        let app = app.clone();
        // Leave the Destroyed callback before constructing the replacement webview.
        tauri::async_runtime::spawn(async move {
            if let Err(error) = schedule_open(&app, request) {
                eprintln!("History window reopen failed: {error}");
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_policy_hides_gtk_and_destroys_other_backends() {
        assert_eq!(ReleasePolicy::for_backend(true), ReleasePolicy::Hide);
        assert_eq!(ReleasePolicy::for_backend(false), ReleasePolicy::Destroy);
    }

    #[test]
    fn release_policy_matches_the_compiled_backend() {
        #[cfg(any(
            target_os = "linux",
            target_os = "dragonfly",
            target_os = "freebsd",
            target_os = "netbsd",
            target_os = "openbsd"
        ))]
        assert_eq!(ReleasePolicy::current(), ReleasePolicy::Hide);
        #[cfg(not(any(
            target_os = "linux",
            target_os = "dragonfly",
            target_os = "freebsd",
            target_os = "netbsd",
            target_os = "openbsd"
        )))]
        assert_eq!(ReleasePolicy::current(), ReleasePolicy::Destroy);
    }

    #[test]
    fn hidden_view_reopens_without_waiting_for_a_destroyed_event() {
        let mut runtime = Runtime::default();
        let first = runtime.open("all");
        runtime.begin_release(ReleasePolicy::Hide);
        assert!(!runtime.destroying);
        let reopened = runtime.open("all");
        assert!(runtime.pending_open.is_none());
        assert!(!runtime.can_release(first.generation));
        assert!(runtime.can_release(reopened.generation));
        // Repeated hide/open cycles must never strand an open in the destroy queue.
        runtime.begin_release(ReleasePolicy::Hide);
        let latest = runtime.open("new");
        assert!(!runtime.destroying);
        assert!(runtime.pending_open.is_none());
        assert!(!runtime.can_release(reopened.generation));
        assert!(runtime.can_release(latest.generation));
    }

    #[test]
    fn reopened_window_rejects_obsolete_close() {
        let mut runtime = Runtime::default();
        let first = runtime.open("all");
        assert!(runtime.can_release(first.generation));
        let second = runtime.open("all");
        assert!(!runtime.can_release(first.generation));
        assert!(runtime.can_release(second.generation));
    }

    #[test]
    fn reopen_during_queued_destroy_waits_and_keeps_latest_intent() {
        let mut runtime = Runtime::default();
        let first = runtime.open("all");
        runtime.begin_release(ReleasePolicy::Destroy);
        runtime.open("old");
        let latest = runtime.open("new");
        assert!(!runtime.can_release(first.generation));
        assert!(!runtime.can_release(latest.generation));
        let pending = runtime.destroyed().unwrap();
        assert_eq!(pending.generation, latest.generation);
        assert_eq!(pending.persona, "new");
        assert!(runtime.can_release(latest.generation));
        assert!(runtime.destroyed().is_none());
    }

    #[test]
    fn restoration_rejects_another_user_or_deleted_session_without_storing_drafts() {
        let state = super::super::tests::state();
        let session = {
            let db = lock(&state.db).unwrap();
            store::set_user_name(&db, "first", 1).unwrap();
            let session =
                store::create_conversation(&db, &["builtin-a".into()], None, None, 1).unwrap();
            store::save_conversation_draft(&db, &session.id, "private draft").unwrap();
            session
        };
        let mut value = Restoration {
            user_id: session.user_id.clone(),
            selected_id: Some(session.id.clone()),
            filter: "all".into(),
            query: "search".into(),
            anchor: Some(Anchor {
                message_id: "old-message".into(),
                offset: -12.5,
            }),
            following_tail: false,
        };
        assert!(valid_restoration(&state, &value).unwrap());
        let serialized = serde_json::to_string(&value).unwrap();
        assert!(!serialized.contains("private draft"));
        value.selected_id = Some("deleted-session".into());
        assert!(!valid_restoration(&state, &value).unwrap());
        value.selected_id = Some(session.id.clone());
        {
            let db = lock(&state.db).unwrap();
            store::set_user_name(&db, "second", 2).unwrap();
        }
        assert!(!valid_restoration(&state, &value).unwrap());
        // Even a forged current user cannot restore another user's selected session.
        value.user_id = store::current_user(&*lock(&state.db).unwrap())
            .unwrap()
            .unwrap()
            .id;
        assert!(!valid_restoration(&state, &value).unwrap());
    }

    #[test]
    fn restoration_metadata_is_bounded_and_requires_finite_scroll_offsets() {
        let state = super::super::tests::state();
        let mut value = Restoration {
            user_id: String::new(),
            selected_id: None,
            filter: "all".into(),
            query: String::new(),
            anchor: None,
            following_tail: true,
        };
        assert!(valid_restoration(&state, &value).unwrap());
        value.query = "x".repeat(16_385);
        assert!(!valid_restoration(&state, &value).unwrap());
        value.query.clear();
        value.anchor = Some(Anchor {
            message_id: "message".into(),
            offset: f64::NAN,
        });
        assert!(!valid_restoration(&state, &value).unwrap());
    }
}
