use crate::{
    app::{self, lock, AppState},
    characters, store,
    types::RuntimePhase,
};
use std::{
    collections::BTreeMap,
    sync::{atomic::Ordering, Arc},
};
use tauri::{AppHandle, Manager, WebviewWindow};

pub(crate) mod wandering;
type Result<T> = std::result::Result<T, String>;

#[derive(Default)]
pub(crate) struct Runtime {
    sleeping: BTreeMap<String, String>,
    idle: BTreeMap<String, IdlePeriod>,
    pub(crate) wandering: wandering::Runtime,
}

struct IdlePeriod {
    next_at: i64,
    stretch: bool,
}

impl Runtime {
    pub(crate) fn is_sleeping(&self, character_id: &str) -> bool {
        self.sleeping.contains_key(character_id)
    }

    pub(crate) fn sleeping_ids(&self) -> Vec<String> {
        self.sleeping.keys().cloned().collect()
    }

    fn idle_due(&mut self, id: &str, allowed: bool, now: i64, delay: i64) -> Option<&'static str> {
        let period = self.idle.entry(id.into()).or_insert(IdlePeriod {
            next_at: now + delay,
            stretch: false,
        });
        if !allowed {
            period.next_at = now + delay;
            return None;
        }
        if now < period.next_at {
            return None;
        }
        period.next_at = now + delay;
        let gesture = if period.stretch {
            "idle-stretch"
        } else {
            "idle-yawn"
        };
        period.stretch = !period.stretch;
        Some(gesture)
    }
}

// The caller owns action. Wake does not grant permission to speak or spend items.
pub(crate) fn wake(state: &AppState, character_id: &str) -> Result<bool> {
    Ok(lock(&state.life)?.sleeping.remove(character_id).is_some())
}

pub(crate) fn sleeping(state: &AppState, character_id: &str) -> Result<bool> {
    Ok(lock(&state.life)?.is_sleeping(character_id))
}

pub(crate) fn reconcile(state: &AppState) -> Result<bool> {
    let _action = lock(&state.action)?;
    let definitions = crate::characters::guests::members(state, &*lock(&state.db)?)?
        .into_iter()
        .map(|member| {
            (
                member.id,
                characters::reaction_host::definition_revision(&member.definition),
            )
        })
        .collect::<BTreeMap<_, _>>();
    let mut life = lock(&state.life)?;
    let before = life.sleeping.len();
    life.sleeping
        .retain(|id, revision| definitions.get(id) == Some(revision));
    life.idle.retain(|id, _| definitions.contains_key(id));
    Ok(before != life.sleeping.len())
}

// Call before taking life or DB mutexes; an action guard may already be held.
pub(crate) fn ambient_allowed(state: &AppState, character_id: &str) -> Result<bool> {
    let status = lock(&state.runtime)?.clone();
    if app::unavailable(state)
        || status.hidden
        || status.paused
        || !matches!(status.phase, RuntimePhase::Idle | RuntimePhase::Error)
        || state.launcher_open.load(Ordering::SeqCst)
        || sleeping(state, character_id)?
        || lock(&state.panel)?.is_some()
        || lock(&state.story)?.is_some()
        || lock(&state.playback)?.is_some()
        || lock(&state.reactions)?.blocks_ambient(character_id)
        || crate::behavior::reactions_blocked(state)?
        || app::now().saturating_sub(state.last_input.load(Ordering::SeqCst)) < 2
    {
        return Ok(false);
    }
    let db = lock(&state.db)?;
    let settings = store::settings(&db)?;
    Ok(settings.autonomous_enabled
        && !app::quiet_hours::automatic_blocked(state, &settings)?
        && !crate::widgets::storage::focus_active(&db, chrono::Utc::now().timestamp_millis())?
        && characters::active_ids(&db)?
            .iter()
            .any(|id| id == character_id)
        && app::presence::is_present(state, character_id)?)
}

pub(crate) fn tick(app: &AppHandle, state: &Arc<AppState>) -> Result<()> {
    wandering::tick(app, state)?;
    let ids = characters::active_ids(&*lock(&state.db)?)?;
    for id in ids {
        let Some(window) = app.get_webview_window(&format!("body-{id}")) else {
            continue;
        };
        let identity = characters::reaction_host::window_identity(&window);
        let gesture = {
            let _action = lock(&state.action)?;
            let allowed =
                ambient_allowed(state, &id)? && !lock(&state.reactions)?.blocks_character(&id) && {
                    let states = &lock(&state.animation_states)?.states;
                    !states.focus && !states.rest && !states.calendar_open && !states.music_playing
                };
            let mut life = lock(&state.life)?;
            let allowed = allowed && life.wandering.motion_allowed(&id);
            let delay = 60_000 + (uuid::Uuid::new_v4().as_u128() % 60_001) as i64;
            life.idle_due(&id, allowed, chrono::Utc::now().timestamp_millis(), delay)
        };
        if let Some(gesture) = gesture {
            characters::reaction_host::direct_start(
                app,
                state.clone(),
                &id,
                gesture,
                None,
                identity,
            )?;
        }
    }
    Ok(())
}

fn owner(state: &AppState, character_id: &str) -> Result<()> {
    if app::unavailable(state) || lock(&state.runtime)?.hidden {
        return Err("지금은 캐릭터를 조작할 수 없어요.".into());
    }
    crate::characters::guests::actor(state, &*lock(&state.db)?, character_id)?;
    Ok(())
}

pub(crate) fn set_sleep(state: &AppState, character_id: &str, sleeping: bool) -> Result<bool> {
    owner(state, character_id)?;
    if !sleeping {
        return wake(state, character_id);
    }
    let definition = characters::get(&*lock(&state.db)?, character_id)?.definition;
    let revision = characters::reaction_host::definition_revision(&definition);
    Ok(lock(&state.life)?
        .sleeping
        .insert(character_id.into(), revision)
        .is_none())
}

fn apply_sleep(state: &AppState, character_id: &str, sleeping: bool) -> Result<()> {
    set_sleep(state, character_id, sleeping)?;
    if sleeping {
        app::interrupt(state, false)?;
        lock(&state.reactions)?.clear_character(character_id);
        let mut status = lock(&state.runtime)?;
        status.phase = RuntimePhase::Idle;
        status.persona = None;
        status.error = None;
    }
    *lock(&state.panel)? = None;
    state.last_input.store(app::now(), Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub(crate) fn begin_character_contact(
    app: AppHandle,
    window: WebviewWindow,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<()> {
    let id = window
        .label()
        .strip_prefix("body-")
        .ok_or("캐릭터 본체에서 조작해 주세요.")?;
    if !window.is_visible().map_err(|error| error.to_string())? {
        return Ok(());
    }
    let identity = characters::reaction_host::window_identity(&window);
    let changed = {
        let _action = lock(&state.action)?;
        if !crate::characters::guests::window_current(&state, window.label(), identity)? {
            return Ok(());
        }
        owner(&state, id)?;
        state.last_input.store(app::now(), Ordering::SeqCst);
        lock(&state.reactions)?.clear_ambient(id);
        wake(&state, id)?
    };
    wandering::cancel(&app, state.inner(), id)?;
    if changed {
        characters::reaction_host::direct_start(
            &app,
            state.inner().clone(),
            id,
            "wake",
            None,
            characters::reaction_host::window_identity(&window),
        )?;
        app::publish(&app, &state);
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn set_character_sleep(
    app: AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    character_id: String,
    sleeping: bool,
) -> Result<()> {
    {
        let _action = lock(&state.action)?;
        apply_sleep(&state, &character_id, sleeping)?;
    }
    wandering::cancel(&app, state.inner(), &character_id)?;
    if sleeping {
        crate::characters::gestures::cancel_window(&app, &format!("body-{character_id}"));
    }
    if !sleeping {
        if let Some(window) = app.get_webview_window(&format!("body-{character_id}")) {
            characters::reaction_host::direct_start(
                &app,
                state.inner().clone(),
                &character_id,
                "wake",
                None,
                characters::reaction_host::window_identity(&window),
            )?;
        }
    }
    app::publish(&app, &state);
    Ok(())
}

#[tauri::command]
pub(crate) fn give_character_item(
    app: AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    character_id: String,
    action: String,
    session_id: String,
) -> Result<()> {
    if !matches!(action.as_str(), "drink" | "gift") {
        return Err("건넬 물건을 확인해 주세요.".into());
    }
    let window = app
        .get_webview_window(&format!("body-{character_id}"))
        .ok_or("캐릭터 본체를 찾을 수 없어요.")?;
    if !window.is_visible().map_err(|error| error.to_string())? {
        return Err("캐릭터를 표시한 뒤 건네 주세요.".into());
    }
    let event = {
        let _action = lock(&state.action)?;
        owner(&state, &character_id)?;
        wake(&state, &character_id)?;
        state.last_input.store(app::now(), Ordering::SeqCst);
        let event = crate::characters::guests::interact_locked(
            &state,
            &*lock(&state.db)?,
            &character_id,
            &action,
            &session_id,
            chrono::Utc::now().timestamp_millis(),
        )?;
        *lock(&state.panel)? = None;
        event
    };
    wandering::cancel(&app, state.inner(), &character_id)?;
    if event.is_some() {
        characters::reaction_host::direct_start(
            &app,
            state.inner().clone(),
            &character_id,
            &action,
            None,
            characters::reaction_host::window_identity(&window),
        )?;
    }
    crate::widgets::commands::publish_widgets(&app, &state);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn idle_variations_do_not_queue_while_a_higher_priority_state_is_active() {
        let mut runtime = Runtime::default();
        assert_eq!(runtime.idle_due("local", true, 0, 100), None);
        assert_eq!(runtime.idle_due("local", false, 1000, 100), None);
        assert_eq!(runtime.idle_due("local", true, 1001, 100), None);
        assert_eq!(
            runtime.idle_due("local", true, 1100, 100),
            Some("idle-yawn")
        );
        assert_eq!(runtime.idle_due("local", true, 1101, 100), None);
        assert_eq!(
            runtime.idle_due("local", true, 1200, 100),
            Some("idle-stretch")
        );
        assert_eq!(runtime.idle_due("other", true, 5000, 100), None);
    }

    #[test]
    fn sleep_is_local_ephemeral_and_definition_changes_invalidate_it() {
        let state = app::tests::state();
        let ids = characters::active_ids(&lock(&state.db).unwrap()).unwrap();
        let revision = store::revision(&lock(&state.db).unwrap()).unwrap();
        set_sleep(&state, &ids[0], true).unwrap();
        assert!(sleeping(&state, &ids[0]).unwrap());
        assert!(!sleeping(&state, &ids[1]).unwrap());
        assert!(!Runtime::default().is_sleeping(&ids[0]));
        assert_eq!(
            store::revision(&lock(&state.db).unwrap()).unwrap(),
            revision
        );
        assert!(wake(&state, &ids[0]).unwrap());
        assert!(!wake(&state, &ids[0]).unwrap());
        set_sleep(&state, &ids[0], true).unwrap();
        {
            let db = lock(&state.db).unwrap();
            let mut character = characters::get(&db, &ids[0]).unwrap();
            character.definition.name.push_str(" 변경");
            characters::save(&db, &ids[0], &character.definition).unwrap();
        }
        assert!(reconcile(&state).unwrap());
        assert!(!sleeping(&state, &ids[0]).unwrap());
        set_sleep(&state, &ids[0], true).unwrap();
        characters::apply_roster(&lock(&state.db).unwrap(), vec![ids[1].clone()]).unwrap();
        assert!(reconcile(&state).unwrap());
        assert!(lock(&state.life).unwrap().sleeping_ids().is_empty());
    }

    #[test]
    fn sleeping_cancels_a_pending_scene_without_committing_any_effect() {
        let state = app::tests::state();
        let id = characters::active_ids(&lock(&state.db).unwrap()).unwrap()[0].clone();
        let token = app::interrupt(&state, false).unwrap();
        *lock(&state.story).unwrap() = Some(crate::story::Request {
            id: "pending-scene".into(),
            display_started_at: Some(1),
            persona: id.clone(),
            title: "진행 중".into(),
            prompt: "선택".into(),
            choices: vec![],
            character_id: id.clone(),
            user_id: "user".into(),
            epoch: token.0,
            scene: crate::story::Scene {
                id: "scene".into(),
                chapter: 1,
                title: "장면".into(),
                prompt: "선택".into(),
                choices: vec![],
            },
        });
        let revision = store::revision(&lock(&state.db).unwrap()).unwrap();
        apply_sleep(&state, &id, true).unwrap();
        assert!(token.1.load(Ordering::SeqCst));
        assert!(lock(&state.story).unwrap().is_none());
        assert!(sleeping(&state, &id).unwrap());
        assert_eq!(
            store::revision(&lock(&state.db).unwrap()).unwrap(),
            revision
        );
        assert!(store::messages(&lock(&state.db).unwrap(), 100)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn ambient_movement_gates_include_sleep_focus_menu_and_recent_input() {
        let state = app::tests::state();
        let id = characters::active_ids(&lock(&state.db).unwrap()).unwrap()[0].clone();
        state.last_input.store(app::now() - 3, Ordering::SeqCst);
        assert!(ambient_allowed(&state, &id).unwrap());
        set_sleep(&state, &id, true).unwrap();
        assert!(!ambient_allowed(&state, &id).unwrap());
        wake(&state, &id).unwrap();
        state.last_input.store(app::now(), Ordering::SeqCst);
        assert!(!ambient_allowed(&state, &id).unwrap());
        state.last_input.store(app::now() - 3, Ordering::SeqCst);
        *lock(&state.panel).unwrap() = Some(crate::types::PanelState {
            persona: id.clone(),
            mode: "menu".into(),
        });
        assert!(!ambient_allowed(&state, &id).unwrap());
        *lock(&state.panel).unwrap() = None;
        lock(&state.runtime).unwrap().paused = true;
        assert!(!ambient_allowed(&state, &id).unwrap());
        lock(&state.runtime).unwrap().paused = false;
        lock(&state.behavior).unwrap().phase = crate::behavior::Phase::Playing;
        assert!(!ambient_allowed(&state, &id).unwrap());
        lock(&state.behavior).unwrap().phase = crate::behavior::Phase::Suspended;
        assert!(!ambient_allowed(&state, &id).unwrap());
        lock(&state.behavior).unwrap().phase = crate::behavior::Phase::Idle;
        let now = chrono::Utc::now().timestamp_millis();
        lock(&state.db)
            .unwrap()
            .execute(
                "INSERT INTO widget_instances VALUES('timer','focus-timer',1,1,1,0,?1,NULL)",
                [
                    serde_json::json!({"status":"running","mode":"focus","deadline":now + 60000})
                        .to_string(),
                ],
            )
            .unwrap();
        assert!(!ambient_allowed(&state, &id).unwrap());
        assert!(crate::app::conversation::ensure_available(&lock(&state.db).unwrap()).is_err());
        set_sleep(&state, &id, true).unwrap();
        wake(&state, &id).unwrap();
        assert!(crate::app::conversation::ensure_available(&lock(&state.db).unwrap()).is_err());
    }

    #[test]
    fn direct_input_wakes_before_focus_denies_speech_without_creating_a_reply() {
        let state = app::tests::state();
        let id = characters::active_ids(&lock(&state.db).unwrap()).unwrap()[0].clone();
        let now = chrono::Utc::now().timestamp_millis();
        lock(&state.db)
            .unwrap()
            .execute(
                "INSERT INTO widget_instances VALUES('timer','focus-timer',1,1,1,0,?1,NULL)",
                [
                    serde_json::json!({"status":"running","mode":"focus","deadline":now + 60000})
                        .to_string(),
                ],
            )
            .unwrap();
        set_sleep(&state, &id, true).unwrap();
        crate::app::windows::begin_panel(&state, &id, "input".into()).unwrap();
        assert!(!sleeping(&state, &id).unwrap());
        assert_eq!(lock(&state.panel).unwrap().as_ref().unwrap().mode, "focus");
        assert!(crate::app::conversation::ensure_available(&lock(&state.db).unwrap()).is_err());
        assert!(store::messages(&lock(&state.db).unwrap(), 100)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn a_sleeping_nadir_skips_the_hourly_story_without_queuing_it_on_wake() {
        let state = app::tests::state();
        let id = {
            let db = lock(&state.db).unwrap();
            let imported = characters::import_pack(&db, &characters::nadir_pack()).unwrap();
            characters::apply_roster(
                &db,
                imported.iter().map(|member| member.id.clone()).collect(),
            )
            .unwrap();
            imported[0].id.clone()
        };
        set_sleep(&state, &id, true).unwrap();
        lock(&state.story_clock).unwrap().elapsed = std::time::Duration::from_secs(3600);
        assert!(!crate::story::host::advance(&state, std::time::Instant::now()).unwrap());
        assert!(lock(&state.story).unwrap().is_none());
        assert_eq!(
            lock(&state.story_clock).unwrap().elapsed,
            std::time::Duration::ZERO
        );
        wake(&state, &id).unwrap();
        assert!(!crate::story::host::advance(&state, std::time::Instant::now()).unwrap());
        lock(&state.story_clock).unwrap().elapsed = std::time::Duration::from_secs(3600);
        assert!(crate::story::host::advance(&state, std::time::Instant::now()).unwrap());
        assert_eq!(lock(&state.story).unwrap().as_ref().unwrap().persona, id);
        assert!(store::messages(&lock(&state.db).unwrap(), 100)
            .unwrap()
            .is_empty());
        assert_eq!(
            lock(&state.db)
                .unwrap()
                .query_row("SELECT COUNT(*) FROM story_answers", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
}
