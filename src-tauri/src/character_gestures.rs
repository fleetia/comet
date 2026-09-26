use crate::{characters, lock, AppState};
use serde::Serialize;
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

#[cfg(target_os = "macos")]
#[path = "character_gestures/macos.rs"]
mod native;
#[cfg(target_os = "windows")]
#[path = "character_gestures/windows.rs"]
mod native;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod native {
    pub(super) fn double_click_ms() -> u64 {
        500
    }
    pub(super) fn begin(_: &tauri::WebviewWindow, _: super::Session) -> Result<(), String> {
        Err("이 운영체제에서는 캐릭터 잡기 반응을 지원하지 않아요.".into())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Phase {
    Started,
    Ended,
    Cancelled,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GestureEvent {
    pub character_id: String,
    pub session_id: String,
    pub generation: u64,
    pub phase: Phase,
    #[serde(skip)]
    pub definition_key: String,
    #[serde(skip)]
    pub roster_key: String,
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
}

struct Entry {
    session: Session,
    phase: Option<Phase>,
    first_generation: u64,
}
#[derive(Default)]
struct Registry {
    generation: u64,
    entries: BTreeMap<String, Entry>,
}
impl Registry {
    fn begin(&mut self, mut session: Session) -> Result<Session, String> {
        if self
            .entries
            .values()
            .any(|entry| entry.phase.is_none() || entry.phase == Some(Phase::Started))
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
            | (Some(Phase::Started), Phase::Ended | Phase::Cancelled) => {}
            _ => return None,
        }
        entry.phase = Some(phase);
        Some(GestureEvent {
            character_id: session.character_id.clone(),
            session_id: session.session_id.clone(),
            generation: session.generation,
            phase,
            definition_key: session.definition_key.clone(),
            roster_key: session.roster_key.clone(),
        })
    }

    fn cancel(&mut self, label: &str) -> Option<GestureEvent> {
        self.generation = self.generation.wrapping_add(1);
        let entry = self.entries.remove(label)?;
        if matches!(entry.phase, Some(Phase::Ended | Phase::Cancelled)) {
            return None;
        }
        Some(GestureEvent {
            character_id: entry.session.character_id,
            session_id: entry.session.session_id,
            generation: entry.session.generation,
            phase: Phase::Cancelled,
            definition_key: entry.session.definition_key,
            roster_key: entry.session.roster_key,
        })
    }
}

pub(crate) struct Runtime {
    registry: Mutex<Registry>,
    callback: fn(&AppHandle, &GestureEvent),
}
impl Runtime {
    pub(crate) fn new(callback: fn(&AppHandle, &GestureEvent)) -> Self {
        Self {
            registry: Mutex::new(Registry::default()),
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
    let Some(runtime) = window.try_state::<Runtime>() else {
        return;
    };
    let event = runtime
        .registry
        .lock()
        .ok()
        .and_then(|mut registry| registry.advance(session, phase));
    if let Some(event) = event {
        let _ = window.emit_to(window.label(), "character-gesture", &event);
        (runtime.callback)(window.app_handle(), &event);
    }
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
    let event = runtime
        .registry
        .lock()
        .ok()
        .and_then(|mut registry| registry.cancel(label));
    if let Some(event) = event {
        if let Some(window) = app.get_webview_window(label) {
            let _ = window.emit_to(window.label(), "character-gesture", &event);
        }
        (runtime.callback)(app, &event);
    }
}

pub(crate) fn cancel_all(app: &AppHandle) {
    let Some(runtime) = app.try_state::<Runtime>() else {
        return;
    };
    let labels = runtime
        .registry
        .lock()
        .map(|registry| registry.entries.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    for label in labels {
        cancel_window(app, &label);
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GestureSettings {
    double_click_ms: u64,
}

#[tauri::command]
pub(crate) fn get_character_gesture_settings() -> GestureSettings {
    GestureSettings {
        double_click_ms: native::double_click_ms(),
    }
}

#[tauri::command]
pub(crate) fn begin_character_drag(
    window: WebviewWindow,
    session_id: String,
) -> Result<(), String> {
    if uuid::Uuid::parse_str(&session_id).is_err() {
        return Err("끌기 요청이 올바르지 않아요.".into());
    }
    let character_id = window
        .label()
        .strip_prefix("body-")
        .ok_or("캐릭터 본체에서만 옮길 수 있어요.")?
        .to_string();
    let native_handle = native_handle(&window).ok_or("캐릭터 창을 확인하지 못했어요.")?;
    if !window.is_visible().map_err(|error| error.to_string())? {
        return Err("숨긴 캐릭터는 옮길 수 없어요.".into());
    }
    let state = window.state::<Arc<AppState>>();
    let session = {
        let _action = lock(&state.action)?;
        if crate::unavailable(&state) || lock(&state.runtime)?.hidden {
            return Err("지금은 캐릭터를 옮길 수 없어요.".into());
        }
        let members = characters::active_members(&*lock(&state.db)?)?;
        let character = members
            .iter()
            .find(|member| member.id == character_id)
            .ok_or("활성 캐릭터가 아니에요.")?;
        let definition_key =
            serde_json::to_string(&character.definition).map_err(|error| error.to_string())?;
        let roster_key =
            serde_json::to_string(&members.iter().map(|member| &member.id).collect::<Vec<_>>())
                .map_err(|error| error.to_string())?;
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
        })?
    };
    if let Err(error) = native::begin(&window, session.clone()) {
        notify(&window, &session, Phase::Cancelled);
        return Err(error);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn session(id: &str, native_handle: usize) -> Session {
        Session {
            character_id: "friend".into(),
            session_id: id.into(),
            generation: 0,
            window_label: "body-friend".into(),
            native_handle,
            definition_key: "definition1".into(),
            roster_key: "[\"friend\"]".into(),
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
