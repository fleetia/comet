use crate::{
    app::{self, lock, scene, AppState},
    character_gestures::{self, GestureEvent, Phase},
    character_reactions::{
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
}

#[derive(Default)]
pub(crate) struct Runtime {
    pub runs: BTreeMap<String, Run>,
    dragging: BTreeMap<String, Drag>,
    histories: BTreeMap<(String, String), ReactionHistory>,
    speech: Option<Speech>,
}

impl Runtime {
    pub(crate) fn views(&self) -> BTreeMap<String, character_reactions::ReactionRun> {
        self.runs
            .iter()
            .map(|(id, run)| {
                (
                    id.clone(),
                    character_reactions::ReactionRun {
                        id: run.id.clone(),
                        event: run.event.clone(),
                        expression: run.expression.clone(),
                        motion: run.motion.clone(),
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
    app.manage(character_gestures::Runtime::new(|app, event| {
        if let Some(queue) = app.try_state::<GestureQueue>() {
            let _ = queue.0.send(event.clone());
        }
    }));
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = receiver.recv().await {
            // Native window getters must run before taking action or DB locks.
            if !character_gestures::event_current(&app, &event) {
                continue;
            }
            let label = format!("body-{}", event.character_id);
            let Some(window) = app.get_webview_window(&label) else {
                continue;
            };
            let identity = window_identity(&window);
            if let Err(error) = handle_gesture(&app, state.clone(), event, identity) {
                eprintln!("캐릭터 행동 반응: {error}");
            }
        }
    });
}

fn window_identity(window: &WebviewWindow) -> usize {
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

// Called before publishing. Cancelled runs never survive a hidden/paused or definition transition.
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
        character_gestures::cancel_window(app, &format!("body-{id}"));
    }
    let blocked = {
        let status = lock(&state.runtime)?;
        status.hidden || status.paused
    };
    if blocked || app::unavailable(state) {
        character_gestures::cancel_all(app);
    }
    Ok(())
}

fn reconcile_state(state: &AppState, stale_windows: &[String]) -> Result<Vec<String>> {
    let _action = lock(&state.action)?;
    let db = lock(&state.db)?;
    let members = characters::active_members(&db)?;
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
    let blocked = status.hidden || status.paused || app::unavailable(state);
    let at = chrono::Utc::now().timestamp_millis();
    let cancelled: Vec<_> = reactions
        .runs
        .iter()
        .filter(|(id, run)| {
            blocked
                || run.widget.as_ref().is_some_and(|event| {
                    !crate::widget_commands::event_current(&db, event).unwrap_or(false)
                })
                || stale_windows.contains(&run.id)
                || run.roster
                    != members
                        .iter()
                        .map(|member| member.id.clone())
                        .collect::<Vec<_>>()
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
    let roster_key =
        serde_json::to_string(&members.iter().map(|member| &member.id).collect::<Vec<_>>())
            .map_err(|error| error.to_string())?;
    let stale_drags: Vec<_> = reactions
        .dragging
        .iter()
        .filter(|(id, drag)| {
            blocked
                || drag.roster != roster_key
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

// The balloon is shared. Only ambient automatic speech yields to a physical reaction.
fn speech_reason(state: &AppState) -> Result<Option<&'static str>> {
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
        && lock(&state.playback)?.as_ref().is_some_and(|line| {
            matches!(line.source.as_str(), "script" | "wordbook" | "llm" | "talk")
        });
    Ok((!ambient).then_some("진행 중인 대화를 읽고 있어요."))
}

fn choose(
    definition: &CharacterDefinition,
    event: &str,
    at: i64,
    history: Option<&ReactionHistory>,
    entropy: u64,
) -> Option<ReactionSelection> {
    character_reactions::select(&definition.reactions, event, at, history, entropy).or_else(|| {
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
        if !character_gestures::event_registered(app, &event) {
            return Ok(());
        }
        let status = lock(&state.runtime)?;
        if status.hidden || status.paused || app::unavailable(&state) {
            return Ok(());
        }
        drop(status);
        let db = lock(&state.db)?;
        let active = characters::active_ids(&db)?;
        if serde_json::to_string(&active).map_err(|error| error.to_string())? != event.roster_key
            || !active.contains(&event.character_id)
            || fingerprint(&characters::get(&db, &event.character_id)?.definition)
                != event.definition_key
        {
            return Ok(());
        }
        drop(db);
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
                    reactions.dragging.remove(&event.character_id);
                    reactions.runs.remove(&event.character_id);
                }
                matches
            }
        }
    };
    if !accepted {
        return Ok(());
    }
    if event.phase != Phase::Started {
        let _action = lock(&state.action)?;
        cancel_grab_speech(&state, &event.character_id)?;
    }
    match event.phase {
        Phase::Started => trigger(
            app,
            state,
            &event.character_id,
            "grab-start",
            window,
            Some((app, &event)),
        )
        .map(|_| ()),
        Phase::Ended => trigger(
            app,
            state,
            &event.character_id,
            "release",
            window,
            Some((app, &event)),
        )
        .map(|_| ()),
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
    let Some(prepared) = prepare_reaction(&state, character_id, event, window, None, gesture)?
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
    let speech = {
        let _action = lock(&state.action)?;
        let status = lock(&state.runtime)?.clone();
        if status.hidden || status.paused || app::unavailable(state) {
            return Ok(None);
        }
        let (definition, roster) = {
            let db = lock(&state.db)?;
            let roster = characters::active_ids(&db)?;
            if !roster.iter().any(|id| id == character_id) {
                return Ok(None);
            }
            if let Some((widget, epoch)) = widget {
                if state.epoch.load(Ordering::SeqCst) != epoch
                    || !crate::widget_commands::event_current(&db, widget)?
                    || !crate::store::settings(&db)?.autonomous_enabled
                {
                    return Ok(None);
                }
            }
            let definition = characters::get(&db, character_id)?.definition;
            if let Some((app, gesture)) = gesture {
                if !character_gestures::event_registered(app, gesture)
                    || fingerprint(&definition) != gesture.definition_key
                    || serde_json::to_string(&roster).map_err(|error| error.to_string())?
                        != gesture.roster_key
                {
                    return Ok(None);
                }
            }
            (definition, roster)
        };
        let at = chrono::Utc::now().timestamp_millis();
        let selection = {
            let reactions = lock(&state.reactions)?;
            if event != "grab-start" && reactions.dragging.contains_key(character_id) {
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
            definition: fingerprint(&definition),
            window,
            roster,
            widget: widget.map(|(event, _)| event.clone()),
            created_at: at,
            ready: false,
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
            let token = app::interrupt(state, false)?;
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
                characters::slot_index(touched)
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
) -> Result<()> {
    let id = window
        .label()
        .strip_prefix("body-")
        .ok_or("캐릭터 본체의 재생만 완료할 수 있어요.")?;
    let identity = window_identity(&window);
    let changed = acknowledge(&state, id, identity, &run_id, &phase)?;
    if changed {
        app::publish(window.app_handle(), &state);
    }
    Ok(())
}

fn acknowledge(
    state: &AppState,
    id: &str,
    identity: usize,
    run_id: &str,
    phase: &str,
) -> Result<bool> {
    let _action = lock(&state.action)?;
    let mut reactions = lock(&state.reactions)?;
    let Some(run) = reactions
        .runs
        .get_mut(id)
        .filter(|run| run.id == run_id && run.window == identity)
    else {
        return Ok(false);
    };
    let changed = match phase {
        "ready" => {
            run.ready = true;
            false
        }
        "finished" | "failed" => {
            if run.event == "grab-start" {
                run.ready = true;
                run.motion = MotionOverride::Static;
            } else {
                reactions.runs.remove(id);
            }
            true
        }
        _ => return Err("알 수 없는 반응 재생 상태예요.".into()),
    };
    Ok(changed)
}

#[derive(Serialize)]
pub(crate) struct EventDescriptor {
    event: &'static str,
    label: &'static str,
}
#[tauri::command]
pub(crate) fn get_character_reaction_events() -> Vec<EventDescriptor> {
    character_reactions::EVENTS
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
    if !character_reactions::valid_event(&event) {
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
