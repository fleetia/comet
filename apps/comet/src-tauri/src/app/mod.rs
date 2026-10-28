pub(crate) mod appearance;
mod autostart;
mod background;
mod chat;
pub(crate) mod conversation;
#[cfg(test)]
pub(crate) mod conversation_review;
mod history;
mod history_window;
pub(crate) mod launcher;
pub(crate) mod lifecycle;
pub(crate) mod presence;
pub(crate) mod quiet_hours;
mod reset;
pub(crate) mod scene;
mod settings;
pub(crate) mod tasks;
#[cfg(test)]
pub(crate) mod tests;
mod users;
pub(crate) mod windows;

use crate::{
    behavior, characters, desktop, inference, models, playback, store, story, talk, types::*,
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
    pub(crate) organizer: crate::organizer::runtime::Runtime,
    pub(crate) app_usage_tracker: Mutex<crate::app_usage::tracking::Tracker>,
    pub(crate) db: Mutex<Connection>,
    pub(crate) inference: inference::Inference,
    pub(crate) nlp: crate::nlp::NlpService,
    pub(crate) app_data: PathBuf,
    pub(crate) runtime: Mutex<RuntimeStatus>,
    pub(crate) playback: Mutex<Option<Playback>>,
    pub(crate) panel: Mutex<Option<PanelState>>,
    pub(crate) launcher: Mutex<launcher::Runtime>,
    pub(crate) history_window: Mutex<history_window::Runtime>,
    pub(crate) launcher_open: AtomicBool,
    pub(crate) widget_editing: AtomicBool,
    pub(crate) launcher_session: AtomicU64,
    pub(crate) launcher_gate: tokio::sync::Mutex<()>,
    pub(crate) settings_section: Mutex<windows::SettingsSection>,
    pub(crate) settings_character:
        Mutex<Option<crate::characters::commands::SettingsCharacterRequest>>,
    pub(crate) settings_dirty: AtomicBool,
    pub(crate) settings_exit_confirmed: AtomicBool,
    pub(crate) tasks: Mutex<tasks::Registry>,
    pub(crate) cancellation: Mutex<Option<Arc<AtomicBool>>>,
    pub(crate) download_cancel: Mutex<Option<Arc<AtomicBool>>>,
    pub(crate) gate: tokio::sync::Mutex<()>,
    pub(crate) epoch: AtomicU64,
    pub(crate) widget_epoch: AtomicU64,
    pub(crate) playback_link_gate: tokio::sync::Mutex<()>,
    pub(crate) widget_playback: Mutex<Option<widgets::WidgetEvent>>,
    pub(crate) talk: Mutex<talk::runtime::ActiveProgram>,
    pub(crate) talk_playback: Mutex<Option<talk::host::PreparedTalk>>,
    pub(crate) talk_turn: AtomicBool,
    pub(crate) story: Mutex<Option<story::Request>>,
    pub(crate) follow_ups: Mutex<Option<FollowUpRequest>>,
    pub(crate) follow_up_dismissed_epoch: AtomicU64,
    pub(crate) pack_stories: Mutex<crate::pack_stories::Runtime>,
    pub(crate) story_clock: Mutex<story::Clock>,
    pub(crate) story_catalog: Mutex<Vec<story::Scene>>,
    pub(crate) widget_jobs: Mutex<HashMap<String, Arc<AtomicBool>>>,
    pub(crate) widget_open_intents: Mutex<HashMap<String, Arc<AtomicBool>>>,
    pub(crate) widget_clocks: Mutex<std::collections::BTreeMap<String, i64>>,
    pub(crate) last_input: AtomicI64,
    pub(crate) last_foreground: AtomicI64,
    pub(crate) last_scene: AtomicI64,
    pub(crate) next_idle: AtomicI64,
    pub(crate) quiet_hours: Mutex<quiet_hours::Runtime>,
    pub(crate) last_preparation: AtomicI64,
    pub(crate) last_background_check: AtomicI64,
    pub(crate) idle_sequence: AtomicU64,
    pub(crate) presence: Mutex<presence::Presence>,
    pub(crate) action: Mutex<()>,
    pub(crate) automatic: AtomicBool,
    pub(crate) stopping: AtomicBool,
    pub(crate) update_installing: AtomicBool,
    pub(crate) behavior: Mutex<behavior::Machine>,
    pub(crate) reactions: Mutex<crate::characters::reaction_host::Runtime>,
    pub(crate) animation_states: Mutex<crate::characters::animation_states::Runtime>,
    pub(crate) life: Mutex<crate::characters::life::Runtime>,
    pub(crate) guests: Mutex<crate::characters::guests::Runtime>,
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

pub(crate) fn open_session(path: &std::path::Path) -> Result<Connection, String> {
    let db = store::open(path)?;
    story::initialize(&db)?;
    if let Some(directory) = path.parent() {
        widgets::storage::verify_packages(&db, directory)?;
    }
    store::expire_generated_recall(&db, chrono::Utc::now().timestamp_millis())?;
    db.execute("DELETE FROM scenes", [])
        .map_err(|error| error.to_string())?;
    let user = store::active_user_id(&db)?;
    if crate::organizer::has_incomplete_operations(&db, &user)? {
        // Finish already-authorized writes before this connection enters AppState's mutex.
        // Refresh app-owned originals first; recovery never starts a new model request.
        let recovered = crate::organizer::runtime::collect_comet(&db, &user)
            .and_then(|()| crate::organizer::recover_operations(&db, &user));
        if recovered.is_err() {
            crate::report_error!("organizer_recovery", "Organizer operation recovery deferred");
        }
    }
    Ok(db)
}

pub(crate) fn snapshot(state: &AppState) -> Result<Snapshot, String> {
    let db = lock(&state.db)?;
    let settings = store::settings(&db)?;
    let characters = characters::collection(&db)?;
    let present_character_ids = crate::characters::guests::participant_ids(state, &db)?;
    let mut runtime = lock(&state.runtime)?.clone();
    runtime.present_character_ids = present_character_ids;
    runtime.guest_character_ids = crate::characters::guests::guest_ids(state, &db)?;
    let playback = lock(&state.playback)?.clone();
    let api_key_providers = inference::api_key_providers(&settings);
    Ok(Snapshot {
        has_api_key: api_key_providers.contains(&settings.api_provider),
        api_key_providers,
        chatgpt_ready: state.inference.chatgpt.ready(),
        apple_model: crate::apple_models::status(),
        model_ready: models::selected_ready(&state.app_data, &settings),
        local_models: models::model_statuses(&state.app_data),
        device: crate::device::info(),
        settings,
        reactions: lock(&state.reactions)?.views(),
        animation_states: lock(&state.animation_states)?.states.clone(),
        user: store::current_user(&db)?,
        user_birthday: store::current_user_birthday(&db)?,
        legacy_memory_count: store::legacy_memory_count(&db)?,
        messages: store::messages(&db, 100)?,
        memory_count: store::memory_count(&db)?,
        memory_revision: store::memory_revision(&db)?,
        relationships: store::relationships(&db)?,
        prepared_count: store::prepared_scenes(&db)?.len(),
        runtime,
        active_request: tasks::active_request(state)?,
        playback,
        panel: lock(&state.panel)?.clone(),
        conversation: store::active_conversation(&db)?
            .map(|session| store::conversation_view(&db, &session.id))
            .transpose()?,
        story: lock(&state.story)?.clone(),
        follow_ups: lock(&state.follow_ups)?.clone(),
        wordbook: wordbook::entries(&db)?,
        characters,
        message_identities: store::message_identities(&db, 100)?,
        message_user_names: store::message_user_names(&db, 100)?,
    })
}

pub(crate) fn publish(app: &tauri::AppHandle, state: &AppState) {
    let _ = crate::characters::guests::reconcile(state);
    let _ = crate::characters::life::reconcile(state);
    let _ = crate::characters::animation_states::refresh(app, state);
    let _ = crate::characters::reaction_host::reconcile(app, state);
    if let Ok(data) = snapshot(state) {
        if let Ok(_action) = lock(&state.action) {
            if let Ok(runtime) = lock(&state.runtime) {
                state.nlp.pause_indexing(
                    unavailable(state)
                        || !matches!(runtime.phase, RuntimePhase::Idle | RuntimePhase::Error),
                );
            }
        }
        desktop::sync_boxes(app, state, &data);
        desktop::sync_balloon(app, &data);
        // Standalone windows need consent updates, not the full application snapshot.
        let _ = app.emit("analytics-consent", data.settings.analytics_consent);
        let _ = app.emit("app-state", data);
    }
}
pub(crate) fn phase(
    app: &tauri::AppHandle,
    state: &AppState,
    epoch: u64,
    value: RuntimePhase,
    persona: Option<String>,
    error: Option<String>,
) {
    if set_phase_if_current(state, epoch, value, persona, error).unwrap_or(false) {
        publish(app, state);
    }
}
pub(crate) fn set_phase_if_current(
    state: &AppState,
    epoch: u64,
    value: RuntimePhase,
    persona: Option<String>,
    error: Option<String>,
) -> Result<bool, String> {
    let _action = lock(&state.action)?;
    if state.epoch.load(Ordering::SeqCst) != epoch {
        return Ok(false);
    }
    if matches!(value, RuntimePhase::Idle | RuntimePhase::Error) {
        *lock(&state.talk_playback)? = None;
    }
    state.nlp.pause_indexing(
        unavailable(state) || !matches!(value, RuntimePhase::Idle | RuntimePhase::Error),
    );
    let mut status = lock(&state.runtime)?;
    status.phase = value;
    status.persona = persona;
    status.error = error;
    Ok(true)
}

// Call under action; lock order is action, then db/cancellation/runtime. Never hold across await.
pub(crate) fn interrupt(
    state: &AppState,
    automatic: bool,
) -> Result<(u64, Arc<AtomicBool>), String> {
    let run_id = lock(&state.pack_stories)?
        .run
        .as_ref()
        .map(|run| run.run_id.clone());
    crate::pack_stories::cancel_deferred(&mut *lock(&state.pack_stories)?);
    if let Some(run_id) = run_id {
        crate::characters::guests::leave_run_locked(state, &run_id)?;
    }
    interrupt_for_conversation(state, automatic)
}

pub(crate) fn interrupt_with_db(
    state: &AppState,
    automatic: bool,
    db: &rusqlite::Connection,
) -> Result<(u64, Arc<AtomicBool>), String> {
    if !automatic {
        discard_moment_events(db)?;
    }
    let run_id = lock(&state.pack_stories)?
        .run
        .as_ref()
        .map(|run| run.run_id.clone());
    crate::pack_stories::flush_cancellations(db, &mut *lock(&state.pack_stories)?)?;
    crate::pack_stories::cancel_with_progress(db, &mut *lock(&state.pack_stories)?)?;
    if let Some(run_id) = run_id {
        crate::characters::guests::leave_run_locked(state, &run_id)?;
    }
    interrupt_for_conversation(state, automatic)
}

pub(crate) fn discard_moment_events(db: &rusqlite::Connection) -> Result<(), String> {
    db.execute("DELETE FROM moment_events", []).map_err(|error| error.to_string())?;
    Ok(())
}

pub(crate) fn interrupt_for_conversation(
    state: &AppState,
    automatic: bool,
) -> Result<(u64, Arc<AtomicBool>), String> {
    if let Some(cancel) = &*lock(&state.organizer.scan_cancel)? {
        cancel.store(true, Ordering::SeqCst);
    }
    crate::characters::reaction_host::forget_speech(state)?;
    {
        let mut tasks = lock(&state.tasks)?;
        tasks.active = None;
        tasks.conversation = None;
        tasks.participants = None;
        tasks.pack_replay = None;
    }
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
    *lock(&state.follow_ups)? = None;
    let mut panel = lock(&state.panel)?;
    if panel
        .as_ref()
        .is_some_and(|panel| matches!(panel.mode.as_str(), "name" | "update"))
    {
        *panel = None;
    }
    Ok((epoch, cancel))
}

pub(crate) fn cancel_model_test(state: &AppState) -> Result<Option<u64>, String> {
    let _action = lock(&state.action)?;
    if !lock(&state.tasks)?
        .active
        .is_some_and(|(kind, _)| kind == tasks::Kind::ModelTest)
    {
        return Ok(None);
    }
    let (epoch, _) = interrupt(state, false)?;
    let mut runtime = lock(&state.runtime)?;
    runtime.phase = RuntimePhase::Idle;
    runtime.persona = None;
    runtime.error = None;
    Ok(Some(epoch))
}

pub(crate) fn is_current(state: &AppState, epoch: u64, cancel: &AtomicBool) -> bool {
    state.epoch.load(Ordering::SeqCst) == epoch && !cancel.load(Ordering::SeqCst)
}

#[tauri::command]
pub(crate) fn get_snapshot(state: tauri::State<'_, Arc<AppState>>) -> Result<Snapshot, String> {
    snapshot(&state)
}

pub(crate) fn unavailable(state: &AppState) -> bool {
    state.stopping.load(Ordering::SeqCst) || state.update_installing.load(Ordering::SeqCst)
}
