use crate::{
    app::{self, lock, scene, AppState},
    characters::gestures::{self, GestureEvent, Phase},
    characters::reactions::{
        self, MotionOverride, ReactionHistory, ReactionSelection, ReactionVariant,
    },
    characters::{self, CharacterDefinition},
    types::{RuntimePhase, SceneLine},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    sync::{atomic::Ordering, Arc},
};
use tauri::{AppHandle, Manager, WebviewWindow};

type Result<T> = std::result::Result<T, String>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Run {
    pub id: String,
    pub event: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expression: Option<String>,
    pub motion: MotionOverride,
    pub phase: String,
    pub phase_generation: u64,
    pub definition_revision: String,
    #[serde(skip)]
    gesture: Option<reactions::GestureMotion>,
    #[serde(skip)]
    moving: bool,
    #[serde(skip)]
    definition: String,
    #[serde(skip)]
    window: usize,
    #[serde(skip)]
    roster: Vec<String>,
    #[serde(skip)]
    widget: Option<crate::widgets::WidgetEvent>,
    #[serde(skip)]
    created_at: i64,
    #[serde(skip)]
    ready: bool,
    #[serde(skip)]
    actor: Option<crate::characters::guests::ActorTicket>,
}

struct Speech {
    character_id: String,
    rule_id: String,
    variant_id: String,
    run_id: String,
    event: String,
    epoch: u64,
    shown: bool,
}

struct Drag {
    session_id: String,
    generation: u64,
    definition: String,
    roster: String,
    actor: crate::characters::guests::ActorTicket,
}

#[derive(Default)]
pub(crate) struct Runtime {
    pub runs: BTreeMap<String, Run>,
    dragging: BTreeMap<String, Drag>,
    histories: BTreeMap<(String, String), ReactionHistory>,
    speech: Option<Speech>,
}

impl Runtime {
    pub(crate) fn blocks_character(&self, id: &str) -> bool {
        self.runs.contains_key(id) || self.dragging.contains_key(id)
    }

    pub(crate) fn blocks_ambient(&self, id: &str) -> bool {
        self.dragging.contains_key(id)
            || self.runs.get(id).is_some_and(|run| {
                !(reactions::ambient_gesture(&run.event)
                    && reactions::sustained_gesture(&run.event))
            })
    }

    pub(crate) fn clear_ambient(&mut self, id: &str) {
        if self
            .runs
            .get(id)
            .is_some_and(|run| reactions::ambient_gesture(&run.event))
        {
            self.runs.remove(id);
        }
    }

    pub(crate) fn clear_character(&mut self, id: &str) {
        self.runs.remove(id);
        self.dragging.remove(id);
    }
    pub(crate) fn blocks_presence(&self) -> bool {
        !self.runs.is_empty() || !self.dragging.is_empty()
    }

    pub(crate) fn views(&self) -> BTreeMap<String, reactions::ReactionRun> {
        self.runs
            .iter()
            .map(|(id, run)| {
                (
                    id.clone(),
                    reactions::ReactionRun {
                        id: run.id.clone(),
                        event: run.event.clone(),
                        expression: run.expression.clone(),
                        motion: run.motion.clone(),
                        phase: run.phase.clone(),
                        phase_generation: run.phase_generation,
                        definition_revision: run.definition_revision.clone(),
                    },
                )
            })
            .collect()
    }
}

struct GestureQueue(tokio::sync::mpsc::UnboundedSender<GestureEvent>);

pub(crate) fn install(app: &AppHandle, state: Arc<AppState>) {
    let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel();
    app.manage(GestureQueue(sender));
    app.manage(gestures::Runtime::new(|app, event| {
        if let Some(queue) = app.try_state::<GestureQueue>() {
            let _ = queue.0.send(event.clone());
        }
    }));
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = receiver.recv().await {
            // Native window getters must run before taking action or DB locks.
            if !gestures::event_current(&app, &event) {
                continue;
            }
            let label = format!("body-{}", event.character_id);
            let Some(window) = app.get_webview_window(&label) else {
                continue;
            };
            let identity = window_identity(&window);
            if let Err(error) = handle_gesture(&app, state.clone(), event, identity) {
                crate::report_error!("character_reaction", "캐릭터 행동 반응: {error}");
            }
        }
    });
}

pub(crate) fn window_identity(window: &WebviewWindow) -> usize {
    #[cfg(target_os = "macos")]
    {
        window.ns_window().map(|value| value as usize).unwrap_or(0)
    }
    #[cfg(target_os = "windows")]
    {
        window.hwnd().map(|value| value.0 as usize).unwrap_or(0)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = window;
        0
    }
}

pub(crate) fn native_window_identity(window: &tauri::Window) -> usize {
    #[cfg(target_os = "macos")]
    {
        window.ns_window().map(|value| value as usize).unwrap_or(0)
    }
    #[cfg(target_os = "windows")]
    {
        window.hwnd().map(|value| value.0 as usize).unwrap_or(0)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = window;
        0
    }
}

fn fingerprint(definition: &CharacterDefinition) -> String {
    serde_json::to_string(definition).unwrap_or_default()
}

pub(crate) fn definition_revision(definition: &CharacterDefinition) -> String {
    use sha2::{Digest, Sha256};
    format!("{:x}", Sha256::digest(fingerprint(definition).as_bytes()))
}

fn phase_motion(gesture: &reactions::GestureMotion, phase: &str, moving: bool) -> MotionOverride {
    let selected = match phase {
        "start" => gesture.start.as_ref(),
        "hold" => {
            if moving {
                gesture.moving_hold.as_ref().or(gesture.hold.as_ref())
            } else {
                gesture.hold.as_ref()
            }
        }
        "end" => gesture.end.as_ref(),
        _ => None,
    };
    let mut motion = selected.cloned().unwrap_or(MotionOverride::Inherit);
    if let MotionOverride::Clip {
        repeat,
        interval_ms,
        ..
    } = &mut motion
    {
        *repeat = phase == "hold";
        *interval_ms = 0;
    }
    motion
}

fn advance_phase(run: &mut Run, phase: &str) {
    run.phase = phase.into();
    run.phase_generation += 1;
    run.ready = false;
    run.created_at = chrono::Utc::now().timestamp_millis();
    if let Some(gesture) = &run.gesture {
        run.motion = phase_motion(gesture, phase, run.moving);
    }
}

pub(crate) fn direct_start(
    app: &AppHandle,
    state: Arc<AppState>,
    character_id: &str,
    gesture: &str,
    region_id: Option<&str>,
    window: usize,
) -> Result<Option<String>> {
    direct_start_impl(app, state, character_id, gesture, region_id, window, None)
}

pub(crate) fn direct_start_interaction(
    app: &AppHandle,
    state: Arc<AppState>,
    character_id: &str,
    gesture: &str,
    region_id: Option<&str>,
    window: usize,
    request_id: &str,
) -> Result<Option<String>> {
    direct_start_impl(app, state, character_id, gesture, region_id, window, Some(request_id))
}

fn direct_start_impl(
    app: &AppHandle,
    state: Arc<AppState>,
    character_id: &str,
    gesture: &str,
    region_id: Option<&str>,
    window: usize,
    interaction_id: Option<&str>,
) -> Result<Option<String>> {
    let mut id = prepare_direct(&state, character_id, gesture, region_id, window)?;
    if id.is_none()
        && gesture == "poke"
        && trigger_inner(app, state.clone(), character_id, "click", window, None, interaction_id)?
    {
        id = lock(&state.reactions)?
            .runs
            .get(character_id)
            .map(|run| run.id.clone());
    }
    if id.is_none()
        && ["poke", "stroke", "snack"].contains(&gesture)
        && trigger_inner(
            app,
            state.clone(),
            character_id,
            "interaction.touch",
            window,
            None,
            interaction_id,
        )?
    {
        id = lock(&state.reactions)?
            .runs
            .get(character_id)
            .map(|run| run.id.clone());
    }
    if id.is_some() {
        app::publish(app, &state);
    }
    Ok(id)
}

pub(crate) fn ambient_start(
    app: &AppHandle,
    state: Arc<AppState>,
    character_id: &str,
    gesture: &str,
    window: usize,
    token: &str,
) -> Result<Option<String>> {
    if !reactions::ambient_gesture(gesture) {
        return Ok(None);
    }
    let execution =
        prepare_direct_checked(&state, character_id, gesture, None, window, Some(token))?;
    if execution.is_some() {
        app::publish(app, &state);
    }
    Ok(execution)
}

pub(crate) fn direct_common(
    app: &AppHandle,
    state: Arc<AppState>,
    character_id: &str,
    event: &crate::widgets::WidgetEvent,
    window: usize,
) -> Result<bool> {
    let Some(body) = app.get_webview_window(&format!("body-{character_id}")) else {
        return Ok(false);
    };
    if window_identity(&body) != window || !body.is_visible().map_err(|error| error.to_string())? {
        return Ok(false);
    }
    let prepared = {
        let _action = lock(&state.action)?;
        if !crate::characters::guests::window_current(&state, body.label(), window)?
            || lock(&state.runtime)?.hidden
            || app::unavailable(&state)
            || speech_reason(&state)?.is_some()
        {
            return Ok(false);
        }
        let db = lock(&state.db)?;
        if crate::characters::guests::actor(&state, &db, character_id).is_err()
            || !matches!(event.event.kind.as_str(), "interaction.touch" | "interaction.milestone")
            || event.event.payload["owner"].as_str() != Some(character_id)
        {
            return Ok(false);
        }
        let milestone = event.event.kind == "interaction.milestone";
        let (lines, token) = if milestone {
            let Some((lines, token)) = prepare_milestone(&state, &db, event)? else {
                return Ok(false);
            };
            (Some(lines), token)
        } else {
            let previous = state.epoch.load(Ordering::SeqCst);
            let token = app::interrupt_with_db(&state, false, &db)?;
            crate::characters::life::advance_interaction_mood_epoch(&state, &event.id, previous, token.0)?;
            (crate::talk::host::prepare(&state, &db, Some(event))?, token)
        };
        if let Some(lines) = lines {
            lock(&state.runtime)?.phase = RuntimePhase::Playing;
            state.last_input.store(app::now(), Ordering::SeqCst);
            Some((lines, token))
        } else {
            let mut status = lock(&state.runtime)?;
            status.phase = RuntimePhase::Idle;
            status.persona = None;
            None
        }
    };
    let Some((lines, token)) = prepared else {
        app::publish(app, &state);
        return Ok(false);
    };
    scene::start_scene(app.clone(), state.clone(), lines, "talk", token, None);
    app::publish(app, &state);
    Ok(true)
}

fn prepare_milestone(
    state: &AppState,
    db: &rusqlite::Connection,
    event: &crate::widgets::WidgetEvent,
) -> Result<Option<(Vec<SceneLine>, (u64, Arc<std::sync::atomic::AtomicBool>))>> {
    let settings = crate::store::settings(db)?;
    if !settings.autonomous_enabled
        || lock(&state.runtime)?.paused
        || app::quiet_hours::automatic_blocked(state, &settings)?
        || state.launcher_open.load(Ordering::SeqCst)
    {
        return Ok(None);
    }
    let Some(lines) = crate::talk::host::prepare(state, db, Some(event))? else {
        return Ok(None);
    };
    let prepared = lock(&state.talk_playback)?.take();
    let previous = state.epoch.load(Ordering::SeqCst);
    let token = app::interrupt_with_db(state, true, db)?;
    crate::characters::life::advance_interaction_mood_epoch(state, &event.id, previous, token.0)?;
    *lock(&state.talk_playback)? = prepared;
    Ok(Some((lines, token)))
}

pub(crate) fn direct_milestone(
    app: &AppHandle,
    state: Arc<AppState>,
    character_id: &str,
    event: &crate::widgets::WidgetEvent,
    window: usize,
) -> Result<bool> {
    if event.event.payload["milestone"].is_null() {
        return Ok(false);
    }
    let mut milestone = event.clone();
    milestone.event.kind = "interaction.milestone".into();
    direct_common(app, state, character_id, &milestone, window)
}

pub(crate) fn direct_motion(
    app: &AppHandle,
    state: Arc<AppState>,
    character_id: &str,
    gesture: &str,
    region_id: Option<&str>,
    window: usize,
) -> Result<()> {
    if prepare_direct(&state, character_id, gesture, region_id, window)?.is_some() {
        app::publish(app, &state);
    }
    Ok(())
}

fn prepare_direct(
    state: &AppState,
    character_id: &str,
    gesture: &str,
    region_id: Option<&str>,
    window: usize,
) -> Result<Option<String>> {
    prepare_direct_checked(state, character_id, gesture, region_id, window, None)
}

fn prepare_direct_checked(
    state: &AppState,
    character_id: &str,
    gesture: &str,
    region_id: Option<&str>,
    window: usize,
    ambient_token: Option<&str>,
) -> Result<Option<String>> {
    let _action = lock(&state.action)?;
    if lock(&state.runtime)?.hidden || app::unavailable(state) {
        return Ok(None);
    }
    if matches!(gesture, "idle-yawn" | "idle-stretch") {
        let states = &lock(&state.animation_states)?.states;
        if states.focus || states.rest || states.calendar_open || states.music_playing {
            return Ok(None);
        }
    }
    if reactions::ambient_gesture(gesture)
        && (!crate::characters::life::ambient_allowed(state, character_id)?
            || lock(&state.reactions)?.blocks_character(character_id)
            || ambient_token.is_some_and(|token| {
                !crate::characters::life::wandering::accepts_start(
                    state,
                    character_id,
                    token,
                    window,
                )
                .unwrap_or(false)
            }))
    {
        return Ok(None);
    }
    let db = lock(&state.db)?;
    let roster = characters::active_ids(&db)?;
    let Ok(owner) = crate::characters::guests::actor(state, &db, character_id) else {
        return Ok(None);
    };
    let actor = crate::characters::guests::actor_ticket(state, &db, character_id)?;
    let authority = crate::characters::guests::window_authority(
        state,
        &format!("body-{character_id}"),
        window,
    )?;
    if actor.guest_generation.is_some() && authority.is_none()
        || authority.is_some_and(|generation| generation != actor.guest_generation)
    {
        return Ok(None);
    }
    let definition = owner.definition;
    if !reactions::ambient_gesture(gesture) {
        crate::characters::life::wake(state, character_id)?;
    }
    if gesture != "pickup" && lock(&state.reactions)?.dragging.contains_key(character_id) {
        return Ok(None);
    }
    let entropy = uuid::Uuid::new_v4().as_u128() as u64;
    let selected = reactions::select_gesture(&definition, gesture, region_id, entropy).cloned();
    let Some(selected) = selected else {
        return Ok(None);
    };
    let phase = if selected.start.is_some() {
        "start"
    } else if reactions::sustained_gesture(gesture) {
        "hold"
    } else {
        "end"
    };
    let id = uuid::Uuid::new_v4().to_string();
    let run = Run {
        id: id.clone(),
        event: gesture.into(),
        expression: selected.expression.clone(),
        motion: phase_motion(&selected, phase, false),
        phase: phase.into(),
        phase_generation: 1,
        definition_revision: definition_revision(&definition),
        gesture: Some(selected),
        moving: false,
        definition: fingerprint(&definition),
        window,
        roster,
        widget: None,
        created_at: chrono::Utc::now().timestamp_millis(),
        ready: false,
        actor: Some(actor),
    };
    lock(&state.reactions)?
        .runs
        .insert(character_id.into(), run);
    Ok(Some(id))
}

pub(crate) fn direct_end(
    app: &AppHandle,
    state: Arc<AppState>,
    character_id: &str,
    execution_id: &str,
    cancelled: bool,
) -> Result<()> {
    let changed = end_direct(&state, character_id, execution_id, cancelled)?;
    if changed {
        app::publish(app, &state);
    }
    Ok(())
}

fn end_direct(
    state: &AppState,
    character_id: &str,
    execution_id: &str,
    cancelled: bool,
) -> Result<bool> {
    let _action = lock(&state.action)?;
    let db = lock(&state.db)?;
    let definition = characters::get(&db, character_id)?.definition;
    let mut reactions = lock(&state.reactions)?;
    let Some(run) = reactions.runs.get_mut(character_id).filter(|run| {
        run.id == execution_id
            && run.definition == fingerprint(&definition)
            && run.gesture.is_some()
            && (cancelled
                || run.actor.as_ref().is_none_or(|actor| {
                    crate::characters::guests::validate_actor(state, &db, actor).is_ok()
                }))
    }) else {
        return Ok(false);
    };
    if cancelled
        || run
            .gesture
            .as_ref()
            .is_none_or(|motion| motion.end.is_none())
    {
        reactions.runs.remove(character_id);
    } else if run.phase != "end" {
        advance_phase(run, "end");
    } else {
        return Ok(false);
    }
    Ok(true)
}

pub(crate) fn direct_moving(
    app: &AppHandle,
    state: Arc<AppState>,
    character_id: &str,
    execution_id: &str,
    moving: bool,
) -> Result<()> {
    let changed = update_direct_moving(&state, character_id, execution_id, moving)?;
    if changed {
        app::publish(app, &state);
    }
    Ok(())
}

fn update_direct_moving(
    state: &AppState,
    character_id: &str,
    execution_id: &str,
    moving: bool,
) -> Result<bool> {
    let _action = lock(&state.action)?;
    let db = lock(&state.db)?;
    let definition = characters::get(&db, character_id)?.definition;
    let roster = characters::active_ids(&db)?;
    let mut reactions = lock(&state.reactions)?;
    let Some(run) = reactions.runs.get_mut(character_id).filter(|run| {
        (execution_id.is_empty() || run.id == execution_id)
            && run.event == "pickup"
            && run.phase != "end"
            && run.definition == fingerprint(&definition)
            && run.roster == roster
            && run.actor.as_ref().is_none_or(|actor| {
                crate::characters::guests::validate_actor(state, &db, actor).is_ok()
            })
    }) else {
        return Ok(false);
    };
    if run.moving == moving {
        return Ok(false);
    }
    run.moving = moving;
    if run.phase == "hold" {
        advance_phase(run, "hold");
    }
    Ok(true)
}

fn record_displayed(
    reactions: &mut Runtime,
    playback: Option<&crate::types::Playback>,
    epoch: u64,
) {
    let Some(speech) = reactions
        .speech
        .as_mut()
        .filter(|speech| speech.epoch == epoch && !speech.shown)
    else {
        return;
    };
    let Some(at) = playback
        .filter(|line| line.id == format!("scene:reaction:{}:0", speech.run_id))
        .and_then(|line| line.display_started_at)
    else {
        return;
    };
    speech.shown = true;
    let history = reactions
        .histories
        .entry((speech.character_id.clone(), speech.rule_id.clone()))
        .or_default();
    history.last_played_at = Some(at);
    if history.variant_id.is_none() {
        history.variant_id = Some(speech.variant_id.clone());
    }
}

pub(crate) fn forget_speech(state: &AppState) -> Result<()> {
    let playback = lock(&state.playback)?.clone();
    let epoch = state.epoch.load(Ordering::SeqCst);
    let mut reactions = lock(&state.reactions)?;
    record_displayed(&mut reactions, playback.as_ref(), epoch);
    reactions.speech = None;
    Ok(())
}

// Called before publishing. Hidden and stale runs are cancelled; silence preserves direct reactions.
pub(crate) fn reconcile(app: &AppHandle, state: &AppState) -> Result<()> {
    let native_runs: Vec<_> = lock(&state.reactions)?
        .runs
        .iter()
        .map(|(id, run)| (id.clone(), run.id.clone(), run.window))
        .collect();
    let stale_windows: Vec<_> = native_runs
        .into_iter()
        .filter(|(id, _, identity)| {
            app.get_webview_window(&format!("body-{id}"))
                .is_none_or(|window| window_identity(&window) != *identity)
        })
        .map(|(_, run_id, _)| run_id)
        .collect();
    let cancelled = reconcile_state(state, &stale_windows)?;
    for id in cancelled {
        gestures::cancel_window(app, &format!("body-{id}"));
    }
    let blocked = {
        let status = lock(&state.runtime)?;
        status.hidden
    };
    if blocked || app::unavailable(state) {
        gestures::cancel_all(app);
    }
    Ok(())
}

fn reconcile_state(state: &AppState, stale_windows: &[String]) -> Result<Vec<String>> {
    let _action = lock(&state.action)?;
    let db = lock(&state.db)?;
    let members = crate::characters::guests::members(state, &db)?;
    let residents = characters::active_ids(&db)?;
    let present = crate::characters::guests::participant_ids(state, &db)?;
    let status = lock(&state.runtime)?.clone();
    let playback = lock(&state.playback)?.clone();
    let epoch = state.epoch.load(Ordering::SeqCst);
    let mut reactions = lock(&state.reactions)?;
    record_displayed(&mut reactions, playback.as_ref(), epoch);
    if reactions
        .speech
        .as_ref()
        .is_some_and(|speech| speech.epoch != epoch)
        || matches!(status.phase, RuntimePhase::Idle | RuntimePhase::Error)
    {
        reactions.speech = None;
    }
    let blocked = status.hidden || app::unavailable(state);
    let at = chrono::Utc::now().timestamp_millis();
    let cancelled: Vec<_> = reactions
        .runs
        .iter()
        .filter(|(id, run)| {
            blocked
                || !present.contains(id)
                || run.widget.as_ref().is_some_and(|event| {
                    (status.paused && !app::quiet_hours::event_allowed(&event.event))
                        || !crate::widgets::commands::event_current(&db, event).unwrap_or(false)
                })
                || stale_windows.contains(&run.id)
                || run.roster != residents
                || run.actor.as_ref().is_some_and(|actor| {
                    crate::characters::guests::validate_actor(state, &db, actor).is_err()
                })
                || !members.iter().any(|member| {
                    member.id == **id && fingerprint(&member.definition) == run.definition
                })
                || (!run.ready && at.saturating_sub(run.created_at) > 30_000)
        })
        .map(|(id, _)| id.clone())
        .collect();
    for id in &cancelled {
        reactions.runs.remove(id);
        reactions.dragging.remove(id);
    }
    // A drag without a configured visual still needs invalidation on visibility/roster changes.
    let roster_key = serde_json::to_string(&residents).map_err(|error| error.to_string())?;
    let stale_drags: Vec<_> = reactions
        .dragging
        .iter()
        .filter(|(id, drag)| {
            blocked
                || drag.roster != roster_key
                || crate::characters::guests::validate_actor(state, &db, &drag.actor).is_err()
                || !members.iter().any(|member| {
                    member.id == **id && fingerprint(&member.definition) == drag.definition
                })
        })
        .map(|(id, _)| id.clone())
        .collect();
    for id in &stale_drags {
        reactions.dragging.remove(id);
    }
    Ok(cancelled.into_iter().chain(stale_drags).collect::<Vec<_>>())
}

// Focus suppresses speech. Otherwise, only ambient speech yields to a physical reaction.
fn speech_reason(state: &AppState) -> Result<Option<&'static str>> {
    {
        let db = lock(&state.db)?;
        if crate::widgets::storage::focus_active(&db, chrono::Utc::now().timestamp_millis())? {
            return Ok(Some("집중 시간 동안에는 대화를 사용할 수 없어요."));
        }
        let run = lock(&state.pack_stories)?.run.clone();
        if run
            .as_ref()
            .is_some_and(|run| crate::pack_stories::current(&db, run).unwrap_or(false))
        {
            return Ok(Some("등록 이야기를 읽고 있어요."));
        }
    }
    if lock(&state.panel)?.is_some() {
        return Ok(Some("메뉴나 입력 화면을 사용하고 있어요."));
    }
    if lock(&state.story)?.is_some() {
        return Ok(Some("선택지를 읽고 있어요."));
    }
    let phase = lock(&state.runtime)?.phase;
    if matches!(phase, RuntimePhase::Idle | RuntimePhase::Error) {
        return Ok(None);
    }
    if lock(&state.widget_playback)?.is_some() {
        return Ok(Some("위젯 알림을 읽고 있어요."));
    }
    let ambient = state.automatic.load(Ordering::SeqCst)
        && lock(&state.playback)?.as_ref().map_or(
            phase == RuntimePhase::Playing,
            |line| matches!(line.source.as_str(), "script" | "wordbook" | "llm" | "talk"),
        );
    Ok((!ambient).then_some("진행 중인 대화를 읽고 있어요."))
}

fn choose(
    definition: &CharacterDefinition,
    event: &str,
    at: i64,
    history: Option<&ReactionHistory>,
    entropy: u64,
) -> Option<ReactionSelection> {
    reactions::select(&definition.reactions, event, at, history, entropy).or_else(|| {
        // Old packs retain their click animation until a new click rule takes its place.
        if event != "click" || definition.reactions.iter().any(|rule| rule.event == event) {
            return None;
        }
        let binding = definition.animation.as_ref()?.bindings.click.as_ref()?;
        Some(ReactionSelection {
            rule_id: "legacy-click".into(),
            variant: ReactionVariant {
                id: "legacy-click".into(),
                text: None,
                expression: None,
                motion: MotionOverride::Clip {
                    clip_id: binding.clip_id.clone(),
                    repeat: false,
                    interval_ms: 0,
                },
            },
            speech_allowed: false,
        })
    })
}

fn cancel_grab_speech(state: &AppState, character_id: &str) -> Result<()> {
    let owned = lock(&state.reactions)?
        .speech
        .as_ref()
        .is_some_and(|speech| {
            speech.character_id == character_id
                && speech.event == "grab-start"
                && speech.epoch == state.epoch.load(Ordering::SeqCst)
        });
    if owned {
        app::interrupt(state, false)?;
        let mut status = lock(&state.runtime)?;
        status.phase = RuntimePhase::Idle;
        status.persona = None;
        status.error = None;
    }
    Ok(())
}

fn handle_gesture(
    app: &AppHandle,
    state: Arc<AppState>,
    event: GestureEvent,
    window: usize,
) -> Result<()> {
    let accepted = {
        let _action = lock(&state.action)?;
        if !gestures::event_registered(app, &event) {
            return Ok(());
        }
        let status = lock(&state.runtime)?;
        if status.hidden || app::unavailable(&state) {
            return Ok(());
        }
        drop(status);
        let db = lock(&state.db)?;
        let active = characters::active_ids(&db)?;
        if serde_json::to_string(&active).map_err(|error| error.to_string())? != event.roster_key
            || crate::characters::guests::validate_actor(&state, &db, &event.actor).is_err()
            || fingerprint(&characters::get(&db, &event.character_id)?.definition)
                != event.definition_key
        {
            return Ok(());
        }
        let mut reactions = lock(&state.reactions)?;
        match event.phase {
            Phase::Started => {
                reactions.dragging.insert(
                    event.character_id.clone(),
                    Drag {
                        session_id: event.session_id.clone(),
                        generation: event.generation,
                        definition: event.definition_key.clone(),
                        roster: event.roster_key.clone(),
                        actor: event.actor.clone(),
                    },
                );
                true
            }
            Phase::Ended | Phase::Cancelled => {
                let matches = reactions
                    .dragging
                    .get(&event.character_id)
                    .is_some_and(|drag| {
                        drag.session_id == event.session_id && drag.generation == event.generation
                    });
                if matches {
                    if event.phase == Phase::Ended {
                        if let Some(generation) = event.actor.guest_generation {
                            if let Some(position) = event.position.clone() {
                                crate::characters::guests::set_position_locked(
                                    &state,
                                    &event.character_id,
                                    generation,
                                    position,
                                )?;
                            }
                        } else {
                            gestures::commit_placement(&db, &event)?;
                        }
                    }
                    reactions.dragging.remove(&event.character_id);
                    if event.phase == Phase::Cancelled {
                        reactions.runs.remove(&event.character_id);
                    }
                }
                matches
            }
            Phase::Moving | Phase::Stopped => reactions
                .dragging
                .get(&event.character_id)
                .is_some_and(|drag| {
                    drag.session_id == event.session_id && drag.generation == event.generation
                }),
        }
    };
    if !accepted {
        return Ok(());
    }
    if matches!(event.phase, Phase::Ended | Phase::Cancelled) {
        let _action = lock(&state.action)?;
        cancel_grab_speech(&state, &event.character_id)?;
    }
    match event.phase {
        Phase::Started => {
            if direct_start(
                app,
                state.clone(),
                &event.character_id,
                "pickup",
                event.body_part.as_deref(),
                window,
            )?
            .is_some()
            {
                return Ok(());
            }
            trigger(
                app,
                state,
                &event.character_id,
                "grab-start",
                window,
                Some((app, &event)),
            )
            .map(|_| ())
        }
        Phase::Ended => {
            let authored = lock(&state.reactions)?
                .runs
                .get(&event.character_id)
                .filter(|run| run.event == "pickup" && run.gesture.is_some())
                .map(|run| run.id.clone());
            if let Some(id) = authored {
                return direct_end(app, state, &event.character_id, &id, false);
            }
            trigger(
                app,
                state,
                &event.character_id,
                "release",
                window,
                Some((app, &event)),
            )
            .map(|_| ())
        }
        Phase::Moving | Phase::Stopped => direct_moving(
            app,
            state,
            &event.character_id,
            "",
            event.phase == Phase::Moving,
        ),
        Phase::Cancelled => {
            app::publish(app, &state);
            Ok(())
        }
    }
}

pub(crate) fn trigger(
    app: &AppHandle,
    state: Arc<AppState>,
    character_id: &str,
    event: &str,
    window: usize,
    gesture: Option<(&AppHandle, &GestureEvent)>,
) -> Result<bool> {
    trigger_inner(app, state, character_id, event, window, gesture, None)
}

fn trigger_inner(
    app: &AppHandle,
    state: Arc<AppState>,
    character_id: &str,
    event: &str,
    window: usize,
    gesture: Option<(&AppHandle, &GestureEvent)>,
    interaction_id: Option<&str>,
) -> Result<bool> {
    let Some(prepared) = prepare_reaction_inner(&state, character_id, event, window, None, gesture, interaction_id)?
    else {
        return Ok(false);
    };
    finish_reaction(app, state, prepared);
    Ok(true)
}

type SpeechPreparation = (SceneLine, (u64, Arc<std::sync::atomic::AtomicBool>), String);
struct Prepared {
    speech: Option<SpeechPreparation>,
}

fn prepare_reaction(
    state: &AppState,
    character_id: &str,
    event: &str,
    window: usize,
    widget: Option<(&crate::widgets::WidgetEvent, u64)>,
    gesture: Option<(&AppHandle, &GestureEvent)>,
) -> Result<Option<Prepared>> {
    prepare_reaction_inner(state, character_id, event, window, widget, gesture, None)
}

fn prepare_reaction_inner(
    state: &AppState,
    character_id: &str,
    event: &str,
    window: usize,
    widget: Option<(&crate::widgets::WidgetEvent, u64)>,
    gesture: Option<(&AppHandle, &GestureEvent)>,
    interaction_id: Option<&str>,
) -> Result<Option<Prepared>> {
    let speech = {
        let _action = lock(&state.action)?;
        let status = lock(&state.runtime)?.clone();
        if status.hidden || app::unavailable(state) {
            return Ok(None);
        }
        let (definition, roster, actor) = {
            let db = lock(&state.db)?;
            let roster = characters::active_ids(&db)?;
            let Ok(owner) = crate::characters::guests::actor(state, &db, character_id) else {
                return Ok(None);
            };
            let actor = crate::characters::guests::actor_ticket(state, &db, character_id)?;
            let authority = crate::characters::guests::window_authority(
                state,
                &format!("body-{character_id}"),
                window,
            )?;
            if actor.guest_generation.is_some() && authority.is_none()
                || authority.is_some_and(|generation| generation != actor.guest_generation)
            {
                return Ok(None);
            }
            if let Some((widget, epoch)) = widget {
                if state.epoch.load(Ordering::SeqCst) != epoch
                    || (status.paused && !app::quiet_hours::event_allowed(&widget.event))
                    || !crate::widgets::commands::event_current(&db, widget)?
                    || !crate::store::settings(&db)?.autonomous_enabled
                {
                    return Ok(None);
                }
            }
            let definition = owner.definition;
            if let Some((app, gesture)) = gesture {
                if !gestures::event_registered(app, gesture)
                    || fingerprint(&definition) != gesture.definition_key
                    || serde_json::to_string(&roster).map_err(|error| error.to_string())?
                        != gesture.roster_key
                {
                    return Ok(None);
                }
            }
            (definition, roster, actor)
        };
        let at = chrono::Utc::now().timestamp_millis();
        let selection = {
            let reactions = lock(&state.reactions)?;
            if event != "grab-start" && reactions.dragging.contains_key(character_id) {
                return Ok(None);
            }
            if reactions.runs.get(character_id).is_some_and(|run| {
                run.phase != "end"
                    && run
                        .gesture
                        .as_ref()
                        .is_some_and(|motion| reactions::sustained_gesture(&motion.gesture))
            }) {
                return Ok(None);
            }
            let rule_id = definition
                .reactions
                .iter()
                .find(|rule| rule.event == event)
                .map(|rule| rule.id.as_str())
                .unwrap_or("legacy-click");
            choose(
                &definition,
                event,
                at,
                reactions
                    .histories
                    .get(&(character_id.into(), rule_id.into())),
                uuid::Uuid::new_v4().as_u128() as u64,
            )
        };
        let Some(selection) = selection else {
            return Ok(None);
        };
        let id = uuid::Uuid::new_v4().to_string();
        let run = Run {
            id: id.clone(),
            event: event.into(),
            expression: selection.variant.expression.clone(),
            motion: selection.variant.motion.clone(),
            phase: "start".into(),
            phase_generation: 1,
            definition_revision: definition_revision(&definition),
            gesture: None,
            moving: false,
            definition: fingerprint(&definition),
            window,
            roster,
            widget: widget.map(|(event, _)| event.clone()),
            created_at: at,
            ready: false,
            actor: Some(actor),
        };
        {
            let mut reactions = lock(&state.reactions)?;
            reactions.runs.insert(character_id.into(), run);
            reactions
                .histories
                .entry((character_id.into(), selection.rule_id.clone()))
                .or_default()
                .variant_id = Some(selection.variant.id.clone());
        }
        if selection.speech_allowed && speech_reason(state)?.is_none() {
            let current = lock(&state.playback)?
                .as_ref()
                .filter(|line| line.persona == character_id)
                .map(|line| line.expression.clone());
            let expression = selection
                .variant
                .expression
                .clone()
                .or(current)
                .unwrap_or_else(|| "평온".into());
            let previous = state.epoch.load(Ordering::SeqCst);
            let token = app::interrupt(state, false)?;
            if let Some(request_id) = interaction_id {
                crate::characters::life::advance_interaction_mood_epoch(state, request_id, previous, token.0)?;
            }
            if let Some((widget, _)) = widget {
                state.widget_epoch.store(token.0, Ordering::SeqCst);
                *lock(&state.widget_playback)? = Some(widget.clone());
            }
            lock(&state.reactions)?.speech = Some(Speech {
                character_id: character_id.into(),
                rule_id: selection.rule_id,
                variant_id: selection.variant.id,
                run_id: id.clone(),
                event: event.into(),
                epoch: token.0,
                shown: false,
            });
            lock(&state.runtime)?.phase = RuntimePhase::Playing;
            state.last_input.store(app::now(), Ordering::SeqCst);
            Some((
                SceneLine {
                    persona: character_id.into(),
                    expression,
                    text: selection.variant.text.unwrap_or_default(),
                    motion: MotionOverride::Inherit,
                },
                token,
                id,
            ))
        } else {
            None
        }
    };
    Ok(Some(Prepared { speech }))
}

fn finish_reaction(app: &AppHandle, state: Arc<AppState>, prepared: Prepared) {
    if let Some((line, token, id)) = prepared.speech {
        scene::start_scene(
            app.clone(),
            state.clone(),
            vec![line],
            "reaction",
            token,
            Some(format!("reaction:{id}")),
        );
    }
    app::publish(app, &state);
}

pub(crate) fn widget_character(
    db: &rusqlite::Connection,
    event: &crate::widgets::WidgetEvent,
) -> Result<Option<String>> {
    let members = characters::active_members(db)?;
    let owner = event
        .event
        .payload
        .get("owner")
        .and_then(serde_json::Value::as_str);
    let touched = (event.event.kind == "interaction.touch")
        .then(|| {
            event
                .event
                .payload
                .get("character")
                .and_then(serde_json::Value::as_str)
        })
        .flatten();
    let target = if let Some(owner) = owner {
        members.iter().find(|member| member.id == owner)
    } else if let Some(touched) = touched {
        // Legacy interaction widgets store a slot in their committed event.
        members
            .iter()
            .find(|member| member.id == touched)
            .or_else(|| {
                characters::slot_index(&touched.to_ascii_lowercase())
                    .ok()
                    .and_then(|index| members.get(index))
            })
    } else {
        members.iter().find(|member| {
            member
                .definition
                .reactions
                .iter()
                .any(|rule| rule.event == event.event.kind)
        })
    };
    Ok(target
        .filter(|member| {
            member
                .definition
                .reactions
                .iter()
                .any(|rule| rule.event == event.event.kind)
        })
        .map(|member| member.id.clone()))
}

pub(crate) fn trigger_widget(
    app: &AppHandle,
    state: Arc<AppState>,
    character_id: &str,
    event: &crate::widgets::WidgetEvent,
    epoch: u64,
) -> Result<()> {
    let Some(window) = app.get_webview_window(&format!("body-{character_id}")) else {
        return Ok(());
    };
    if let Some(prepared) = prepare_reaction(
        &state,
        character_id,
        &event.event.kind,
        window_identity(&window),
        Some((event, epoch)),
        None,
    )? {
        finish_reaction(app, state, prepared);
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn trigger_character_reaction(
    window: WebviewWindow,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<bool> {
    let id = window
        .label()
        .strip_prefix("body-")
        .ok_or("캐릭터 본체에서 반응을 실행해 주세요.")?;
    if !window.is_visible().map_err(|error| error.to_string())? {
        return Ok(false);
    }
    trigger(
        window.app_handle(),
        state.inner().clone(),
        id,
        "click",
        window_identity(&window),
        None,
    )
}

#[tauri::command]
pub(crate) fn acknowledge_character_reaction(
    window: WebviewWindow,
    state: tauri::State<'_, Arc<AppState>>,
    run_id: String,
    phase: String,
    phase_generation: Option<u64>,
    definition_revision: Option<String>,
) -> Result<()> {
    let id = window
        .label()
        .strip_prefix("body-")
        .ok_or("캐릭터 본체의 재생만 완료할 수 있어요.")?;
    let identity = window_identity(&window);
    let changed = acknowledge_current(
        &state,
        id,
        identity,
        &run_id,
        &phase,
        phase_generation,
        definition_revision.as_deref(),
    )?;
    if changed {
        app::publish(window.app_handle(), &state);
    }
    Ok(())
}

#[cfg(test)]
fn acknowledge(
    state: &AppState,
    id: &str,
    identity: usize,
    run_id: &str,
    phase: &str,
) -> Result<bool> {
    let (generation, revision) = lock(&state.reactions)?
        .runs
        .get(id)
        .map(|run| (run.phase_generation, run.definition_revision.clone()))
        .unwrap_or_default();
    acknowledge_current(
        state,
        id,
        identity,
        run_id,
        phase,
        Some(generation),
        Some(&revision),
    )
}

fn acknowledge_current(
    state: &AppState,
    id: &str,
    identity: usize,
    run_id: &str,
    phase: &str,
    generation: Option<u64>,
    revision: Option<&str>,
) -> Result<bool> {
    let _action = lock(&state.action)?;
    if lock(&state.runtime)?.hidden || app::unavailable(state) {
        return Ok(false);
    }
    let db = lock(&state.db)?;
    let current = characters::get(&db, id)?.definition;
    let roster = characters::active_ids(&db)?;
    let mut reactions = lock(&state.reactions)?;
    let Some(run) = reactions.runs.get_mut(id).filter(|run| {
        run.id == run_id
            && run.window == identity
            && run.definition == fingerprint(&current)
            && run.roster == roster
            && run.actor.as_ref().is_none_or(|actor| {
                crate::characters::guests::validate_actor(state, &db, actor).is_ok()
            })
            && (generation == Some(run.phase_generation)
                || generation.is_none() && run.gesture.is_none())
            && (revision == Some(run.definition_revision.as_str())
                || revision.is_none() && run.gesture.is_none())
    }) else {
        return Ok(false);
    };
    match phase {
        "ready" => {
            run.ready = true;
            Ok(false)
        }
        "failed" => {
            reactions.runs.remove(id);
            Ok(true)
        }
        "finished" => {
            if let Some(gesture) = &run.gesture {
                match run.phase.as_str() {
                    "start" if reactions::sustained_gesture(&gesture.gesture) => {
                        advance_phase(run, "hold");
                    }
                    "start" if gesture.end.is_some() => {
                        advance_phase(run, "end");
                    }
                    "hold" => {
                        run.ready = true;
                        return Ok(false);
                    }
                    _ => {
                        reactions.runs.remove(id);
                    }
                }
            } else if run.event == "grab-start" {
                run.ready = true;
                run.motion = MotionOverride::Static;
            } else {
                reactions.runs.remove(id);
            }
            Ok(true)
        }
        _ => Err("알 수 없는 반응 재생 상태예요.".into()),
    }
}

#[derive(Serialize)]
pub(crate) struct EventDescriptor {
    event: &'static str,
    label: &'static str,
}
#[tauri::command]
pub(crate) fn get_character_reaction_events() -> Vec<EventDescriptor> {
    reactions::EVENTS
        .iter()
        .map(|&(event, label)| EventDescriptor { event, label })
        .collect()
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Preview {
    selection: Option<ReactionSelection>,
    speech_reason: Option<String>,
}
#[tauri::command]
pub(crate) fn preview_character_reaction(
    definition: CharacterDefinition,
    event: String,
    busy: bool,
    variant_index: Option<usize>,
) -> Result<Preview> {
    characters::validate_definition(&definition)?;
    if !reactions::valid_event(&event) {
        return Err("알 수 없는 행동이에요.".into());
    }
    let mut selection = choose(
        &definition,
        &event,
        0,
        None,
        variant_index.unwrap_or(0) as u64,
    );
    if busy {
        if let Some(selection) = selection.as_mut() {
            selection.speech_allowed = false;
        }
    }
    let speech_reason = if selection.is_none() {
        Some("이 상황에 연결한 반응이 없어요.".into())
    } else if busy {
        Some("진행 중인 대화를 읽고 있어 대사를 생략해요.".into())
    } else if selection
        .as_ref()
        .is_some_and(|selection| selection.variant.text.is_none())
    {
        Some("대사 없이 모습만 바꿔요.".into())
    } else {
        None
    };
    Ok(Preview {
        selection,
        speech_reason,
    })
}

#[cfg(test)]
mod tests;
