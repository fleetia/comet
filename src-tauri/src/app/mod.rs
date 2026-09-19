mod background;
mod conversation;
pub(crate) mod lifecycle;
pub(crate) mod scene;
mod settings;
#[cfg(test)]
pub(crate) mod tests;
pub(crate) mod windows;

use crate::{
    characters, desktop, inference, models, playback, store, story, talk, talk_host, types::*,
    widgets, wordbook,
};
use rusqlite::Connection;
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Instant,
};
use tauri::Emitter;

pub(crate) struct AppState {
    pub(crate) db: Mutex<Connection>,
    pub(crate) inference: inference::Inference,
    pub(crate) app_data: PathBuf,
    pub(crate) runtime: Mutex<RuntimeStatus>,
    pub(crate) playback: Mutex<Option<Playback>>,
    pub(crate) panel: Mutex<Option<PanelState>>,
    pub(crate) cancellation: Mutex<Option<Arc<AtomicBool>>>,
    pub(crate) download_cancel: Mutex<Option<Arc<AtomicBool>>>,
    pub(crate) gate: tokio::sync::Mutex<()>,
    pub(crate) epoch: AtomicU64,
    pub(crate) widget_epoch: AtomicU64,
    pub(crate) widget_playback: Mutex<Option<widgets::WidgetEvent>>,
    pub(crate) talk: Mutex<talk::runtime::ActiveProgram>,
    pub(crate) talk_playback: Mutex<Option<talk_host::PreparedTalk>>,
    pub(crate) talk_turn: AtomicBool,
    pub(crate) story: Mutex<Option<story::Request>>,
    pub(crate) story_clock: Mutex<story::Clock>,
    pub(crate) story_catalog: Mutex<Vec<story::Scene>>,
    pub(crate) widget_jobs: Mutex<HashMap<String, Arc<AtomicBool>>>,
    pub(crate) widget_clocks: Mutex<std::collections::BTreeMap<String, i64>>,
    pub(crate) last_input: AtomicI64,
    pub(crate) last_foreground: AtomicI64,
    pub(crate) last_scene: AtomicI64,
    pub(crate) next_idle: AtomicI64,
    pub(crate) last_preparation: AtomicI64,
    pub(crate) last_background_check: AtomicI64,
    pub(crate) idle_sequence: AtomicU64,
    pub(crate) action: Mutex<()>,
    pub(crate) automatic: AtomicBool,
    pub(crate) stopping: AtomicBool,
    pub(crate) positions: Mutex<HashMap<String, (WindowPosition, Instant)>>,
}

pub(crate) fn now() -> i64 {
    chrono::Utc::now().timestamp()
}
pub(crate) fn schedule_idle(state: &AppState, minutes: u32) {
    state.next_idle.store(
        playback::next_idle_at(now(), minutes, uuid::Uuid::new_v4().as_u128() as u64),
        Ordering::SeqCst,
    );
}
pub(crate) fn lock<T>(value: &Mutex<T>) -> Result<std::sync::MutexGuard<'_, T>, String> {
    value
        .lock()
        .map_err(|_| "앱 상태를 읽지 못했어요. 앱을 다시 시작해 주세요.".into())
}

pub(super) fn open_session(path: &std::path::Path) -> Result<Connection, String> {
    let db = store::open(path)?;
    story::initialize(&db)?;
    if let Some(directory) = path.parent() {
        widgets::storage::verify_packages(&db, directory)?;
    }
    store::expire_generated_recall(&db, chrono::Utc::now().timestamp_millis())?;
    db.execute("DELETE FROM scenes", [])
        .map_err(|error| error.to_string())?;
    Ok(db)
}

pub(crate) fn snapshot(state: &AppState) -> Result<Snapshot, String> {
    let db = lock(&state.db)?;
    let settings = store::settings(&db)?;
    Ok(Snapshot {
        has_api_key: inference::has_api_key(&settings),
        model_ready: models::model_ready(&state.app_data, settings.local_model),
        local_models: models::model_statuses(&state.app_data),
        settings,
        messages: store::messages(&db, 100)?,
        memories: store::memories(&db)?,
        relationships: store::relationships(&db)?,
        prepared_count: store::prepared_scenes(&db)?.len(),
        runtime: lock(&state.runtime)?.clone(),
        playback: lock(&state.playback)?.clone(),
        panel: lock(&state.panel)?.clone(),
        story: lock(&state.story)?.clone(),
        wordbook: wordbook::entries(&db)?,
        characters: characters::collection(&db)?,
        message_identities: store::message_identities(&db, 100)?,
    })
}

pub(crate) fn publish(app: &tauri::AppHandle, state: &AppState) {
    if let Ok(data) = snapshot(state) {
        desktop::sync_balloon(app, &data);
        let _ = app.emit("app-state", data);
    }
}
pub(crate) fn phase(
    app: &tauri::AppHandle,
    state: &AppState,
    epoch: u64,
    value: &str,
    persona: Option<String>,
    error: Option<String>,
) {
    if set_phase_if_current(state, epoch, value, persona, error).unwrap_or(false) {
        publish(app, state);
    }
}
pub(super) fn set_phase_if_current(
    state: &AppState,
    epoch: u64,
    value: &str,
    persona: Option<String>,
    error: Option<String>,
) -> Result<bool, String> {
    let _action = lock(&state.action)?;
    if state.epoch.load(Ordering::SeqCst) != epoch {
        return Ok(false);
    }
    if matches!(value, "idle" | "error") {
        *lock(&state.talk_playback)? = None;
    }
    let mut status = lock(&state.runtime)?;
    status.phase = value.into();
    status.persona = persona;
    status.error = error;
    Ok(true)
}

// Call under action; lock order is action, then db/cancellation/runtime. Never hold across await.
pub(crate) fn interrupt(
    state: &AppState,
    automatic: bool,
) -> Result<(u64, Arc<AtomicBool>), String> {
    state.automatic.store(automatic, Ordering::SeqCst);
    let mut active = lock(&state.cancellation)?;
    if let Some(cancel) = active.take() {
        cancel.store(true, Ordering::SeqCst);
    }
    let cancel = Arc::new(AtomicBool::new(false));
    *active = Some(cancel.clone());
    let epoch = state.epoch.fetch_add(1, Ordering::SeqCst) + 1;
    *lock(&state.playback)? = None;
    *lock(&state.widget_playback)? = None;
    *lock(&state.talk_playback)? = None;
    *lock(&state.story)? = None;
    Ok((epoch, cancel))
}

pub(super) fn is_current(state: &AppState, epoch: u64, cancel: &AtomicBool) -> bool {
    state.epoch.load(Ordering::SeqCst) == epoch && !cancel.load(Ordering::SeqCst)
}

#[tauri::command]
pub(super) fn get_snapshot(state: tauri::State<'_, Arc<AppState>>) -> Result<Snapshot, String> {
    snapshot(&state)
}
