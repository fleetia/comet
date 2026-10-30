use crate::{characters, lock, types::WindowPosition, AppState};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

pub(crate) fn trace_enabled() -> bool {
    std::env::var_os("COMET_GESTURE_TRACE").is_some()
}

pub(crate) fn trace_record(record: serde_json::Value) {
    if !trace_enabled() {
        return;
    }
    let record = serde_json::json!({
        "nativeAtMs": chrono::Utc::now().timestamp_millis(),
        "event": record,
    });
    if let Ok(line) = serde_json::to_string(&record) {
        if line.len() <= 2048 {
            eprintln!("character-observe {line}");
        }
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum TracePhase {
    Ready,
    ListenerReady,
    MoveArmed,
    DownIgnored,
    Down,
    CaptureOk,
    CaptureFailed,
    ContactStart,
    ContactResolved,
    ContactRejected,
    Move,
    Threshold,
    ListenerUnavailable,
    BeginSkipped,
    BeginDispatch,
    BeginResolved,
    BeginRejected,
    Up,
    Cancel,
    Blur,
    Reset,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum TraceMode {
    Touch,
    Move,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PointerTrace {
    phase: TracePhase,
    sequence: u32,
    at_ms: f64,
    session_id: Option<String>,
    pointer_id: Option<i32>,
    mode: Option<TraceMode>,
    buttons: Option<u16>,
    x: Option<f64>,
    y: Option<f64>,
    displacement: Option<f64>,
    total: Option<f64>,
    listener_ready: bool,
    pointer_current: bool,
    native_requested: bool,
    armed: bool,
    meta_key: bool,
    ctrl_key: bool,
}

#[tauri::command]
pub(crate) fn trace_character_gesture(window: WebviewWindow, event: PointerTrace) {
    if !trace_enabled() || !window.label().starts_with("body-") {
        return;
    }
    if !event.at_ms.is_finite()
        || !(0.0..=1e12).contains(&event.at_ms)
        || [event.x, event.y, event.displacement, event.total]
            .into_iter()
            .flatten()
            .any(|value| !value.is_finite() || value.abs() > 1e7)
        || event
            .session_id
            .as_ref()
            .is_some_and(|id| id.len() > 36 || uuid::Uuid::parse_str(id).is_err())
    {
        return;
    }
    trace_record(serde_json::json!({
        "kind": "pointer",
        "window": window.label(),
        "pointer": event,
    }));
}

pub(crate) fn trace_window_moved(window: &tauri::Window, position: &tauri::PhysicalPosition<i32>) {
    if trace_enabled() && window.label().starts_with("body-") {
        trace_record(serde_json::json!({
            "kind": "body-moved",
            "window": window.label(),
            "identity": crate::characters::reaction_host::native_window_identity(window),
            "physical": { "x": position.x, "y": position.y },
        }));
    }
}

#[cfg(target_os = "macos")]
#[path = "gestures/macos.rs"]
mod native;
#[cfg(target_os = "windows")]
#[path = "gestures/windows.rs"]
mod native;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod native {
    pub(super) fn double_click_ms() -> u64 {
        500
    }
    pub(super) fn cancel(_: &tauri::WebviewWindow, _: &str) {}
    pub(super) fn begin(_: &tauri::WebviewWindow, _: super::Session) -> Result<(), String> {
        Err("이 운영체제에서는 캐릭터 잡기 반응을 지원하지 않아요.".into())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Phase {
    Started,
    Moving,
    Stopped,
    Ended,
    Cancelled,
}

impl Phase {
    fn is_terminal(self) -> bool {
        self == Self::Ended || self == Self::Cancelled
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GestureEvent {
    pub character_id: String,
    pub session_id: String,
    pub generation: u64,
    pub phase: Phase,
    pub position: Option<WindowPosition>,
    pub body_part: Option<String>,
    #[serde(skip)]
    pub definition_key: String,
    #[serde(skip)]
    pub roster_key: String,
    #[serde(skip)]
    pub actor: crate::characters::guests::ActorTicket,
}

#[derive(Clone)]
struct Session {
    character_id: String,
    session_id: String,
    generation: u64,
    window_label: String,
    native_handle: usize,
    definition_key: String,
    roster_key: String,
    actor: crate::characters::guests::ActorTicket,
    start_position: WindowPosition,
    body_part: Option<String>,
}

struct Entry {
    session: Session,
    phase: Option<Phase>,
    first_generation: u64,
    last_moved: Option<Instant>,
}
#[derive(Default)]
struct Registry {
    generation: u64,
    entries: BTreeMap<String, Entry>,
    cancelled: BTreeMap<String, Session>,
}
impl Registry {
    fn begin(&mut self, mut session: Session) -> Result<Session, String> {
        if self
            .entries
            .values()
            .any(|entry| entry.phase.is_none_or(|phase| !phase.is_terminal()))
        {
            return Err("이미 캐릭터를 옮기고 있어요.".into());
        }
        if self
            .entries
            .get(&session.window_label)
            .is_some_and(|entry| entry.session.session_id == session.session_id)
        {
            return Err("이미 끝난 끌기 요청이에요.".into());
        }
        self.cancelled.remove(&session.window_label);
        self.generation = self.generation.wrapping_add(1);
        session.generation = self.generation;
        let first_generation = self
            .entries
            .get(&session.window_label)
            .filter(|entry| entry.session.native_handle == session.native_handle)
            .map_or(session.generation, |entry| entry.first_generation);
        self.entries.insert(
            session.window_label.clone(),
            Entry {
                session: session.clone(),
                phase: None,
                first_generation,
                last_moved: None,
            },
        );
        Ok(session)
    }

    fn current(&self, session: &Session) -> bool {
        self.entries
            .get(&session.window_label)
            .is_some_and(|entry| {
                entry.session.generation == session.generation
                    && entry.session.session_id == session.session_id
                    && entry.session.native_handle == session.native_handle
            })
    }

    fn queued(&self, event: &GestureEvent) -> Option<&Session> {
        if event.phase == Phase::Cancelled {
            if let Some(session) = self
                .cancelled
                .get(&format!("body-{}", event.character_id))
                .filter(|session| {
                    session.generation == event.generation && session.session_id == event.session_id
                })
            {
                return Some(session);
            }
        }
        self.entries
            .get(&format!("body-{}", event.character_id))
            .filter(|entry| {
                // Confirmed FIFO events remain valid through sequential drags. Removing
                // the entry on invalidation resets this accepted generation range.
                event.generation >= entry.first_generation
                    && event.generation <= entry.session.generation
            })
            .map(|entry| &entry.session)
    }

    fn advance(&mut self, session: &Session, phase: Phase) -> Option<GestureEvent> {
        if !self.current(session) {
            return None;
        }
        let entry = self.entries.get_mut(&session.window_label)?;
        match (entry.phase, phase) {
            (None, Phase::Started | Phase::Cancelled)
            | (
                Some(Phase::Started | Phase::Moving | Phase::Stopped),
                Phase::Ended | Phase::Cancelled,
            )
            | (Some(Phase::Started | Phase::Stopped), Phase::Moving)
            | (Some(Phase::Moving), Phase::Stopped) => {}
            _ => return None,
        }
        entry.phase = Some(phase);
        Some(GestureEvent {
            character_id: session.character_id.clone(),
            session_id: session.session_id.clone(),
            generation: session.generation,
            phase,
            position: None,
            body_part: session.body_part.clone(),
            definition_key: session.definition_key.clone(),
            roster_key: session.roster_key.clone(),
            actor: session.actor.clone(),
        })
    }

    fn cancel(&mut self, label: &str) -> Option<GestureEvent> {
        self.generation = self.generation.wrapping_add(1);
        let entry = self.entries.remove(label)?;
        if entry.phase.is_some_and(Phase::is_terminal) {
            return None;
        }
        self.cancelled.insert(label.into(), entry.session.clone());
        Some(GestureEvent {
            character_id: entry.session.character_id,
            session_id: entry.session.session_id,
            generation: entry.session.generation,
            phase: Phase::Cancelled,
            position: Some(entry.session.start_position),
            body_part: entry.session.body_part,
            definition_key: entry.session.definition_key,
            roster_key: entry.session.roster_key,
            actor: entry.session.actor,
        })
    }
}

#[derive(Clone)]
struct TouchSession {
    session_id: String,
    execution_id: Option<String>,
    definition: String,
    roster: String,
    person: Option<String>,
    epoch: u64,
    region: Option<String>,
    actor: crate::characters::guests::ActorTicket,
}

pub(crate) struct Runtime {
    touches: Mutex<BTreeMap<String, TouchSession>>,
    registry: Mutex<Registry>,
    callback: fn(&AppHandle, &GestureEvent),
}
impl Runtime {
    pub(crate) fn new(callback: fn(&AppHandle, &GestureEvent)) -> Self {
        Self {
            registry: Mutex::new(Registry::default()),
            touches: Mutex::new(BTreeMap::new()),
            callback,
        }
    }
}

fn native_handle(window: &WebviewWindow) -> Option<usize> {
    #[cfg(target_os = "macos")]
    {
        window.ns_window().ok().map(|handle| handle as usize)
    }
    #[cfg(target_os = "windows")]
    {
        window.hwnd().ok().map(|handle| handle.0 as usize)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = window;
        None
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn is_current(window: &WebviewWindow, session: &Session) -> bool {
    if native_handle(window) != Some(session.native_handle)
        || window.is_visible().ok() != Some(true)
    {
        return false;
    }
    window.try_state::<Runtime>().is_some_and(|runtime| {
        runtime
            .registry
            .lock()
            .is_ok_and(|registry| registry.current(session))
    })
}

// Native callbacks may run inside an OS modal loop. The callback must only enqueue work;
// it must not acquire the application's action/DB locks or wait for the UI thread.
fn notify(window: &WebviewWindow, session: &Session, phase: Phase) {
    // Invalidation removes the registry before the OS move loop exits. The native
    // terminal callback still restores its own window after that loop ends.
    let restore_current = window.try_state::<Runtime>().is_some_and(|runtime| {
        runtime.registry.lock().is_ok_and(|registry| {
            registry
                .entries
                .get(&session.window_label)
                .is_none_or(|entry| entry.session.generation == session.generation)
        })
    });
    if phase == Phase::Cancelled
        && restore_current
        && native_handle(window) == Some(session.native_handle)
    {
        restore(window, &session.start_position);
    }
    let position = if phase == Phase::Ended {
        window.outer_position().ok().map(|position| WindowPosition {
            x: position.x as f64,
            y: position.y as f64,
        })
    } else {
        None
    };
    let Some(runtime) = window.try_state::<Runtime>() else {
        return;
    };
    let event = runtime
        .registry
        .lock()
        .ok()
        .and_then(|mut registry| registry.advance(session, phase));
    if let Some(mut event) = event {
        event.position = position;
        let _ = window.emit_to(window.label(), "character-gesture", &event);
        (runtime.callback)(window.app_handle(), &event);
    }
}

fn restore(window: &WebviewWindow, position: &WindowPosition) {
    let _ = window.set_position(tauri::PhysicalPosition::new(
        position.x.round() as i32,
        position.y.round() as i32,
    ));
}

// Moved coordinates are transient. Only the accepted native drop can update the anchor.
pub(crate) fn commit_placement(
    db: &rusqlite::Connection,
    event: &GestureEvent,
) -> Result<(), String> {
    if event.phase != Phase::Ended {
        return Ok(());
    }
    if let Some(position) = &event.position {
        if position.x.is_finite() && position.y.is_finite() {
            crate::store::set_window_position(
                db,
                &format!("body-{}", event.character_id),
                position,
            )?;
        }
    }
    Ok(())
}

pub(crate) fn moved(app: &AppHandle, label: &str) {
    let Some(window) = app.get_webview_window(label) else {
        return;
    };
    let Some(runtime) = app.try_state::<Runtime>() else {
        return;
    };
    let activity = runtime.registry.lock().ok().and_then(|mut registry| {
        let entry = registry.entries.get_mut(label)?;
        if !matches!(
            entry.phase,
            Some(Phase::Started | Phase::Moving | Phase::Stopped)
        ) {
            return None;
        }
        entry.last_moved = Some(Instant::now());
        (entry.phase != Some(Phase::Moving)).then(|| entry.session.clone())
    });
    let Some(session) = activity else {
        return;
    };
    notify(&window, &session, Phase::Moving);
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_millis(120)).await;
            let status = window
                .state::<Runtime>()
                .registry
                .lock()
                .ok()
                .and_then(|registry| {
                    let entry = registry.entries.get(&session.window_label)?;
                    if !registry.current(&session) || entry.phase != Some(Phase::Moving) {
                        return None;
                    }
                    Some(
                        entry
                            .last_moved
                            .is_some_and(|at| at.elapsed() >= Duration::from_millis(120)),
                    )
                });
            match status {
                Some(true) => {
                    notify(&window, &session, Phase::Stopped);
                    break;
                }
                Some(false) => {}
                None => break,
            }
        }
    });
}

#[tauri::command]
pub(crate) fn cancel_character_drag(
    window: WebviewWindow,
    session_id: String,
) -> Result<(), String> {
    let runtime = window.state::<Runtime>();
    let matches = lock(&runtime.registry)?
        .entries
        .get(window.label())
        .is_some_and(|entry| entry.session.session_id == session_id);
    if matches {
        cancel_window(window.app_handle(), window.label());
    }
    Ok(())
}

pub(crate) fn event_current(app: &AppHandle, event: &GestureEvent) -> bool {
    let label = format!("body-{}", event.character_id);
    let Some(runtime) = app.try_state::<Runtime>() else {
        return false;
    };
    let session = runtime
        .registry
        .lock()
        .ok()
        .and_then(|registry| registry.queued(event).cloned());
    let Some(session) = session else {
        return false;
    };
    app.get_webview_window(&label).is_some_and(|window| {
        native_handle(&window) == Some(session.native_handle)
            && window.is_visible().ok() == Some(true)
            && event_registered(app, event)
    })
}

// This check never calls native window APIs, so the host can repeat it under action
// after waiting for that lock. A hide/recreate/edit invalidation must win that race.
pub(crate) fn event_registered(app: &AppHandle, event: &GestureEvent) -> bool {
    app.try_state::<Runtime>().is_some_and(|runtime| {
        runtime
            .registry
            .lock()
            .is_ok_and(|registry| registry.queued(event).is_some())
    })
}

pub(crate) fn cancel_window(app: &AppHandle, label: &str) {
    let Some(runtime) = app.try_state::<Runtime>() else {
        return;
    };
    if let Ok(mut touches) = runtime.touches.lock() {
        touches.remove(label);
    }
    let event = runtime
        .registry
        .lock()
        .ok()
        .and_then(|mut registry| registry.cancel(label));
    if let Some(event) = event {
        if let Some(window) = app.get_webview_window(label) {
            native::cancel(&window, &event.session_id);
            if let Some(position) = &event.position {
                restore(&window, position);
            }
            let _ = window.emit_to(window.label(), "character-gesture", &event);
        }
        (runtime.callback)(app, &event);
    }
}

pub(crate) fn cancel_all(app: &AppHandle) {
    let Some(runtime) = app.try_state::<Runtime>() else {
        return;
    };
    let mut labels = runtime
        .registry
        .lock()
        .map(|registry| registry.entries.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    if let Ok(touches) = runtime.touches.lock() {
        labels.extend(touches.keys().cloned());
    }
    labels.sort();
    labels.dedup();
    for label in labels {
        cancel_window(app, &label);
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GestureSettings {
    double_click_ms: u64,
    trace_enabled: bool,
}

#[tauri::command]
pub(crate) fn get_character_gesture_settings(window: WebviewWindow) -> GestureSettings {
    #[cfg(target_os = "macos")]
    native::trace_properties(&window);
    #[cfg(not(target_os = "macos"))]
    let _ = window;
    GestureSettings {
        double_click_ms: native::double_click_ms(),
        trace_enabled: trace_enabled(),
    }
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
enum BeginStage {
    Session,
    BodyWindow,
    NativeHandle,
    Visible,
    Position,
    ActionLock,
    WindowAuthority,
    Available,
    DbLock,
    Actor,
    ActorTicket,
    Definition,
    Roster,
    Registry,
    NativeRequest,
}

#[tauri::command]
pub(crate) fn begin_character_drag(
    window: WebviewWindow,
    session_id: String,
    body_part: Option<String>,
) -> Result<(), String> {
    let tracing = trace_enabled();
    let trace_session = if tracing {
        uuid::Uuid::parse_str(&session_id)
            .ok()
            .map(|id| id.to_string())
    } else {
        None
    };
    let mut stage = BeginStage::Session;
    if tracing {
        trace_record(serde_json::json!({
            "kind": "begin-received", "window": window.label(), "sessionId": trace_session,
        }));
    }
    let result: Result<(), String> = (|| {
        if uuid::Uuid::parse_str(&session_id).is_err() {
            return Err("끌기 요청이 올바르지 않아요.".into());
        }
        stage = BeginStage::BodyWindow;
        let character_id = window
            .label()
            .strip_prefix("body-")
            .ok_or("본체에서만 옮길 수 있어요.")?
            .to_string();
        stage = BeginStage::NativeHandle;
        let native_handle = native_handle(&window).ok_or(
            if cfg!(any(target_os = "macos", target_os = "windows")) {
                "본체를 확인하지 못했어요."
            } else {
                "이 운영체제에서는 캐릭터 잡기 반응을 지원하지 않아요."
            },
        )?;
        stage = BeginStage::Visible;
        if !window.is_visible().map_err(|error| error.to_string())? {
            return Err("숨긴 캐릭터는 옮길 수 없어요.".into());
        }
        stage = BeginStage::Position;
        let start = window.outer_position().map_err(|error| error.to_string())?;
        let state = window.state::<Arc<AppState>>();
        let session = {
            stage = BeginStage::ActionLock;
            let _action = lock(&state.action)?;
            stage = BeginStage::WindowAuthority;
            if !crate::characters::guests::window_current(&state, window.label(), native_handle)? {
                return Err("이전 본체에서는 옮길 수 없어요.".into());
            }
            stage = BeginStage::Available;
            if crate::unavailable(&state) || lock(&state.runtime)?.hidden {
                return Err("지금은 캐릭터를 옮길 수 없어요.".into());
            }
            stage = BeginStage::DbLock;
            let db = lock(&state.db)?;
            stage = BeginStage::Actor;
            let character = crate::characters::guests::actor(&state, &db, &character_id)?;
            stage = BeginStage::ActorTicket;
            let actor = crate::characters::guests::actor_ticket(&state, &db, &character_id)?;
            stage = BeginStage::Definition;
            let definition_key =
                serde_json::to_string(&character.definition).map_err(|error| error.to_string())?;
            stage = BeginStage::Roster;
            let roster_key = serde_json::to_string(&characters::active_ids(&db)?)
                .map_err(|error| error.to_string())?;
            stage = BeginStage::Registry;
            let runtime = window.state::<Runtime>();
            let mut registry = lock(&runtime.registry)?;
            registry.begin(Session {
                character_id,
                session_id,
                generation: 0,
                window_label: window.label().into(),
                native_handle,
                definition_key,
                roster_key,
                actor,
                start_position: WindowPosition {
                    x: start.x as f64,
                    y: start.y as f64,
                },
                body_part,
            })?
        };
        stage = BeginStage::NativeRequest;
        if let Err(error) = native::begin(&window, session.clone()) {
            notify(&window, &session, Phase::Cancelled);
            return Err(error);
        }
        Ok(())
    })();
    if tracing {
        trace_record(serde_json::json!({
            "kind": if result.is_ok() { "begin-accepted" } else { "begin-rejected" },
            "window": window.label(), "sessionId": trace_session, "stage": stage,
        }));
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_end_and_cancellation_are_terminal() {
        assert!(!Phase::Started.is_terminal());
        assert!(!Phase::Moving.is_terminal());
        assert!(!Phase::Stopped.is_terminal());
        assert!(Phase::Ended.is_terminal());
        assert!(Phase::Cancelled.is_terminal());
    }

    fn session(id: &str, native_handle: usize) -> Session {
        Session {
            character_id: "friend".into(),
            session_id: id.into(),
            generation: 0,
            window_label: "body-friend".into(),
            native_handle,
            definition_key: "definition1".into(),
            roster_key: "[\"friend\"]".into(),
            actor: crate::characters::guests::ActorTicket {
                id: "friend".into(),
                definition_baseline: "definition1".into(),
                guest_generation: None,
            },
            start_position: WindowPosition { x: 10.0, y: 20.0 },
            body_part: None,
        }
    }
    #[test]
    fn native_lifecycle_is_once_and_completed_session_remains_current_for_ordered_delivery() {
        let mut registry = Registry::default();
        let first = registry.begin(session("first", 1)).unwrap();
        assert!(registry.advance(&first, Phase::Ended).is_none());
        assert!(registry.advance(&first, Phase::Started).is_some());
        assert!(registry.advance(&first, Phase::Started).is_none());
        assert!(registry.begin(session("second", 1)).is_err());
        assert!(registry.advance(&first, Phase::Ended).is_some());
        assert!(registry.current(&first));
        assert!(registry.advance(&first, Phase::Cancelled).is_none());
        assert!(registry.begin(session("first", 1)).is_err());
        let next = registry.begin(session("second", 1)).unwrap();
        assert!(!registry.current(&first));
        assert!(registry.current(&next));
    }
    #[test]
    fn invalidation_and_window_recreation_reject_old_start_and_end() {
        let mut registry = Registry::default();
        let old = registry.begin(session("old", 1)).unwrap();
        let cancelled = registry.cancel("body-friend").unwrap();
        assert_eq!(cancelled.phase, Phase::Cancelled);
        let new = registry.begin(session("new", 2)).unwrap();
        assert!(new.generation > old.generation);
        assert!(registry.advance(&old, Phase::Started).is_none());
        assert!(registry.advance(&old, Phase::Ended).is_none());
        assert!(registry.advance(&new, Phase::Cancelled).is_some());
        assert!(registry.advance(&new, Phase::Ended).is_none());
    }

    #[test]
    fn moving_and_stopped_are_activity_not_completion_and_cancel_only_delivers_cleanup() {
        let mut registry = Registry::default();
        let active = registry.begin(session("active", 1)).unwrap();
        let started = registry.advance(&active, Phase::Started).unwrap();
        assert!(registry.advance(&active, Phase::Moving).is_some());
        assert!(registry.advance(&active, Phase::Moving).is_none());
        assert!(registry.advance(&active, Phase::Stopped).is_some());
        assert!(registry.advance(&active, Phase::Moving).is_some());
        assert!(registry.begin(session("other", 1)).is_err());
        let cancelled = registry.cancel("body-friend").unwrap();
        assert!(registry.queued(&started).is_none());
        assert!(registry.queued(&cancelled).is_some());
        assert!(registry.advance(&active, Phase::Ended).is_none());
        assert_eq!(
            cancelled
                .position
                .as_ref()
                .map(|position| (position.x, position.y)),
            Some((10.0, 20.0))
        );
        registry.begin(session("replacement", 1)).unwrap();
        assert!(registry.queued(&cancelled).is_none());
    }

    #[test]
    fn only_normal_native_drop_commits_final_physical_coordinates_for_local_id() {
        let db = crate::store::open(std::path::Path::new(":memory:")).unwrap();
        crate::store::set_window_position(&db, "body-friend", &WindowPosition { x: 10.0, y: 20.0 })
            .unwrap();
        let mut registry = Registry::default();
        let active = registry.begin(session("active", 1)).unwrap();
        registry.advance(&active, Phase::Started).unwrap();
        let mut ended = registry.advance(&active, Phase::Ended).unwrap();
        ended.position = Some(WindowPosition {
            x: 1440.0,
            y: 860.0,
        });
        commit_placement(&db, &ended).unwrap();
        assert!(registry.advance(&active, Phase::Ended).is_none());
        let next = registry.begin(session("next", 1)).unwrap();
        registry.advance(&next, Phase::Started).unwrap();
        let cancelled = registry.cancel("body-friend").unwrap();
        commit_placement(&db, &cancelled).unwrap();
        let saved = crate::store::window_position(&db, "body-friend")
            .unwrap()
            .unwrap();
        assert_eq!((saved.x, saved.y), (1440.0, 860.0));
        assert!(crate::store::window_position(&db, "a").unwrap().is_none());
    }

    #[test]
    fn queued_terminal_event_survives_next_drag_but_not_window_invalidation() {
        let mut registry = Registry::default();
        let first = registry.begin(session("first", 1)).unwrap();
        let started = registry.advance(&first, Phase::Started).unwrap();
        let ended = registry.advance(&first, Phase::Ended).unwrap();
        let next = registry.begin(session("next", 1)).unwrap();
        assert!(registry.queued(&started).is_some());
        assert!(registry.queued(&ended).is_some());
        assert_eq!(ended.definition_key, "definition1");
        assert_eq!(ended.roster_key, "[\"friend\"]");
        assert!(registry.advance(&first, Phase::Started).is_none());
        registry.cancel("body-friend");
        registry.begin(session("replacement", 1)).unwrap();
        assert!(registry.queued(&ended).is_none());
        assert!(registry.advance(&next, Phase::Started).is_none());
    }
}

fn touch_session(
    state: &AppState,
    character_id: &str,
    session_id: &str,
    region: Option<String>,
) -> Result<TouchSession, String> {
    if crate::unavailable(state) || lock(&state.runtime)?.hidden {
        return Err("숨긴 캐릭터와는 교감할 수 없어요.".into());
    }
    let db = lock(&state.db)?;
    let active = characters::active_ids(&db)?;
    let definition = crate::characters::guests::actor(state, &db, character_id)?.definition;
    let actor = crate::characters::guests::actor_ticket(state, &db, character_id)?;
    if region.as_ref().is_some_and(|id| {
        !definition
            .body_regions
            .iter()
            .any(|region| &region.id == id)
    }) {
        return Err("캐릭터의 부위가 바뀌었어요. 다시 만져 주세요.".into());
    }
    Ok(TouchSession {
        session_id: session_id.into(),
        execution_id: None,
        definition: serde_json::to_string(&definition).map_err(|error| error.to_string())?,
        roster: serde_json::to_string(&active).map_err(|error| error.to_string())?,
        person: crate::store::current_user(&db)?.map(|person| person.id),
        epoch: state.epoch.load(std::sync::atomic::Ordering::SeqCst),
        region,
        actor,
    })
}

fn same_touch(a: &TouchSession, b: &TouchSession) -> bool {
    a.session_id == b.session_id
        && a.definition == b.definition
        && a.roster == b.roster
        && a.person == b.person
        && a.epoch == b.epoch
        && a.region == b.region
        && a.actor == b.actor
}

#[tauri::command]
pub(crate) fn trigger_character_interaction(
    window: WebviewWindow,
    state: tauri::State<'_, Arc<AppState>>,
    action: String,
    body_part: Option<String>,
    session_id: String,
    phase: String,
) -> Result<(), String> {
    uuid::Uuid::parse_str(&session_id)
        .map_err(|_| "교감 요청 식별자가 올바르지 않아요.".to_string())?;
    if !matches!(action.as_str(), "poke" | "stroke" | "cheek-grab" | "snack")
        || !matches!(phase.as_str(), "started" | "ended" | "cancelled")
        || (phase != "ended" && action != "cheek-grab")
    {
        return Err("교감 동작이 올바르지 않아요.".into());
    }
    let character_id = window
        .label()
        .strip_prefix("body-")
        .ok_or("본체에서 교감해 주세요.")?;
    let app = window.app_handle();
    let runtime = window.state::<Runtime>();
    let identity = crate::characters::reaction_host::window_identity(&window);
    if phase == "cancelled" {
        let old = {
            let mut touches = lock(&runtime.touches)?;
            if touches
                .get(window.label())
                .is_none_or(|entry| entry.session_id != session_id)
            {
                return Ok(());
            }
            touches.remove(window.label())
        };
        if let Some(execution_id) = old.and_then(|entry| entry.execution_id) {
            crate::characters::reaction_host::direct_end(
                app,
                state.inner().clone(),
                character_id,
                &execution_id,
                true,
            )?;
        }
        return Ok(());
    }
    if !window.is_visible().map_err(|error| error.to_string())? {
        return Ok(());
    }
    {
        let _action = lock(&state.action)?;
        if !crate::characters::guests::window_current(&state, window.label(), identity)? {
            return Ok(());
        }
        touch_session(&state, character_id, &session_id, body_part.clone())?;
        crate::characters::life::wake(&state, character_id)?;
    }
    crate::characters::life::wandering::cancel(app, state.inner(), character_id)?;
    if phase == "started" {
        let session = {
            let _action = lock(&state.action)?;
            if !crate::characters::guests::window_current(&state, window.label(), identity)? {
                return Ok(());
            }
            let session = touch_session(&state, character_id, &session_id, body_part.clone())?;
            let mut touches = lock(&runtime.touches)?;
            if touches
                .get(window.label())
                .is_some_and(|old| same_touch(old, &session))
            {
                return Ok(());
            }
            touches.insert(window.label().into(), session.clone());
            session
        };
        let execution_id = crate::characters::reaction_host::direct_start(
            app,
            state.inner().clone(),
            character_id,
            &action,
            body_part.as_deref(),
            identity,
        )?;
        let retained = {
            let mut touches = lock(&runtime.touches)?;
            if let Some(current) = touches
                .get_mut(window.label())
                .filter(|current| same_touch(current, &session))
            {
                current.execution_id = execution_id.clone();
                true
            } else {
                false
            }
        };
        if !retained {
            if let Some(execution_id) = execution_id {
                crate::characters::reaction_host::direct_end(
                    app,
                    state.inner().clone(),
                    character_id,
                    &execution_id,
                    true,
                )?;
            }
        }
        return Ok(());
    }
    let (eligible, held, stale) = {
        let _action = lock(&state.action)?;
        if !crate::characters::guests::window_current(&state, window.label(), identity)? {
            return Ok(());
        }
        let current = touch_session(&state, character_id, &session_id, body_part.clone())?;
        let mut stale = false;
        let held = if action == "cheek-grab" {
            let mut touches = lock(&runtime.touches)?;
            let Some(old) = touches.get(window.label()) else {
                return Ok(());
            };
            stale = !same_touch(old, &current);
            touches
                .remove(window.label())
                .and_then(|entry| entry.execution_id)
        } else {
            None
        };
        let db = lock(&state.db)?;
        let eligible = if stale {
            None
        } else {
            let result = crate::characters::guests::interact_locked(
                &state,
                &db,
                character_id,
                &action,
                &session_id,
                chrono::Utc::now().timestamp_millis(),
            )?;
            crate::characters::life::change_interaction_mood(
                app, &state, character_id, &action, result.accepted, &session_id,
            )?;
            result.event
        };
        (eligible, held, stale)
    };
    if let Some(ref execution_id) = held {
        crate::characters::reaction_host::direct_end(
            app,
            state.inner().clone(),
            character_id,
            execution_id,
            stale,
        )?;
    }
    if let Some(event) = eligible {
        let gesture = if action == "cheek-grab" { "stroke" } else { &action };
        if crate::characters::reaction_host::direct_milestone(
            app,
            state.inner().clone(),
            character_id,
            &event,
            identity,
        )? {
            if held.is_none() {
                crate::characters::reaction_host::direct_motion(
                    app, state.inner().clone(), character_id, gesture, body_part.as_deref(), identity,
                )?;
            }
            crate::widgets::commands::publish_widgets(app, &state);
            return Ok(());
        }
        if event.event.kind == "interaction.milestone" || held.is_some() {
            crate::widgets::commands::publish_widgets(app, &state);
            return Ok(());
        }
        let _started = crate::characters::reaction_host::direct_start_interaction(
            app,
            state.inner().clone(),
            character_id,
            gesture,
            body_part.as_deref(),
            identity,
            &event.id,
        )?.is_some() || crate::characters::reaction_host::direct_common(
            app,
            state.inner().clone(),
            character_id,
            &event,
            identity,
        )?;
    }
    crate::widgets::commands::publish_widgets(app, &state);
    Ok(())
}

#[tauri::command]
pub(crate) fn arm_character_move(
    app: AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    persona: String,
) -> Result<(), String> {
    let id = {
        let _action = lock(&state.action)?;
        if crate::unavailable(&state) || lock(&state.runtime)?.hidden {
            return Err("숨긴 캐릭터는 옮길 수 없어요.".into());
        }
        let db = lock(&state.db)?;
        let character = crate::characters::guests::actor(&state, &db, &persona)?;
        *lock(&state.panel)? = None;
        character.id
    };
    let window = app
        .get_webview_window(&format!("body-{id}"))
        .ok_or("본체를 찾지 못했어요.")?;
    if !window.is_visible().map_err(|error| error.to_string())? {
        return Err("숨긴 캐릭터는 옮길 수 없어요.".into());
    }
    window
        .emit_to(window.label(), "character-move-armed", ())
        .map_err(|error| error.to_string())?;
    crate::app::publish(&app, &state);
    Ok(())
}

#[tauri::command]
pub(crate) fn give_character_snack(
    app: AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    persona: String,
) -> Result<(), String> {
    menu_interaction(&app, &state, &persona, "snack")
}

/// Strokes or pokes a friend from the character menu with the same affinity rules as touching
/// its body.
#[tauri::command]
pub(crate) fn touch_character_from_menu(
    app: AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    persona: String,
    action: String,
) -> Result<(), String> {
    if !matches!(action.as_str(), "stroke" | "poke") {
        return Err("교감 동작이 올바르지 않아요.".into());
    }
    menu_interaction(&app, &state, &persona, &action)
}

fn menu_interaction(
    app: &AppHandle,
    state: &Arc<AppState>,
    persona: &str,
    action: &str,
) -> Result<(), String> {
    let hidden = if action == "snack" {
        "숨긴 캐릭터에게는 간식을 줄 수 없어요."
    } else {
        "숨긴 캐릭터와는 교감할 수 없어요."
    };
    let character_id = {
        let _action = lock(&state.action)?;
        if crate::unavailable(state) || lock(&state.runtime)?.hidden {
            return Err(hidden.into());
        }
        let id = crate::characters::guests::actor(state, &*lock(&state.db)?, persona)?.id;
        crate::characters::life::wake(state, &id)?;
        id
    };
    crate::characters::life::wandering::cancel(app, state, &character_id)?;
    let window = app
        .get_webview_window(&format!("body-{character_id}"))
        .ok_or("본체를 찾지 못했어요.")?;
    if !window.is_visible().map_err(|error| error.to_string())? {
        return Err(hidden.into());
    }
    let eligible = {
        let _action = lock(&state.action)?;
        let session_id = uuid::Uuid::new_v4().to_string();
        touch_session(state, &character_id, &session_id, None)?;
        let db = lock(&state.db)?;
        let result = crate::characters::guests::interact_locked(
            state,
            &db,
            &character_id,
            action,
            &session_id,
            chrono::Utc::now().timestamp_millis(),
        )?;
        crate::characters::life::change_interaction_mood(
            app, state, &character_id, action, result.accepted, &session_id,
        )?;
        result.event
    };
    if let Some(event) = eligible {
        if crate::characters::reaction_host::direct_milestone(
            app,
            state.clone(),
            &character_id,
            &event,
            crate::characters::reaction_host::window_identity(&window),
        )? {
            crate::characters::reaction_host::direct_motion(
                app, state.clone(), &character_id, action, None,
                crate::characters::reaction_host::window_identity(&window),
            )?;
            crate::widgets::commands::publish_widgets(app, state);
            return Ok(());
        }
        if event.event.kind == "interaction.milestone" {
            crate::widgets::commands::publish_widgets(app, state);
            return Ok(());
        }
        let _started = crate::characters::reaction_host::direct_start_interaction(
            app,
            state.clone(),
            &character_id,
            action,
            None,
            crate::characters::reaction_host::window_identity(&window),
            &event.id,
        )?.is_some() || crate::characters::reaction_host::direct_common(
            app,
            state.clone(),
            &character_id,
            &event,
            crate::characters::reaction_host::window_identity(&window),
        )?;
    }
    crate::widgets::commands::publish_widgets(app, state);
    Ok(())
}
