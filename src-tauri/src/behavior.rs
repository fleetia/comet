use crate::{desktop_toys, lock, store, widgets, AppState};
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::sync::{atomic::Ordering, Arc};
use tauri::{Emitter, Manager};

pub(crate) const TOYS: [&str; 4] = ["ball", "paper-plane", "bubbles", "pet"];

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub(crate) struct Preferences {
    pub characters_visible: bool,
    pub pranks_enabled: bool,
    pub allowed_toys: Vec<String>,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            characters_visible: true,
            pranks_enabled: false,
            allowed_toys: TOYS.iter().map(|kind| (*kind).into()).collect(),
        }
    }
}

pub(crate) fn preferences(db: &Connection) -> Result<Preferences, String> {
    let value: Option<String> = db
        .query_row(
            "SELECT value FROM kv WHERE key='desktop_preferences'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    value
        .map(|value| serde_json::from_str(&value).map_err(|error| error.to_string()))
        .transpose()
        .map(Option::unwrap_or_default)
}

pub(crate) fn save(db: &Connection, preferences: &Preferences) -> Result<(), String> {
    if preferences.allowed_toys.len() > TOYS.len()
        || preferences
            .allowed_toys
            .iter()
            .any(|kind| !TOYS.contains(&kind.as_str()))
    {
        return Err("허용할 장난감을 확인해 주세요.".into());
    }
    db.execute("INSERT INTO kv VALUES('desktop_preferences',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [serde_json::to_string(preferences).map_err(|error| error.to_string())?])
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Phase {
    Idle,
    Conversing,
    Playing,
    WaitingForReply,
    Cooldown,
    Suspended,
}

pub(crate) struct Machine {
    pub phase: Phase,
    next_prank: i64,
    playing_until: i64,
    pub actor: Option<(String, u64)>,
    cooldown_until: i64,
}

impl Default for Machine {
    fn default() -> Self {
        Self {
            phase: Phase::Idle,
            next_prank: 0,
            playing_until: 0,
            actor: None,
            cooldown_until: 0,
        }
    }
}

struct Transition {
    end_play: bool,
    discard_reactions: bool,
}

impl Machine {
    fn schedule(&mut self, now: i64, entropy: u64) {
        self.next_prank = now + 600 + (entropy % 601) as i64;
    }

    fn observe(
        &mut self,
        now: i64,
        blocked: bool,
        conversation: bool,
        waiting: bool,
        epoch: u64,
        entropy: u64,
    ) -> Transition {
        let stale = self
            .actor
            .as_ref()
            .is_some_and(|(_, started)| *started != epoch);
        let interrupted = blocked || conversation || waiting || stale;
        let discard_reactions =
            (self.actor.is_some() && interrupted) || (blocked && self.phase != Phase::Suspended);
        let end_play = self.actor.is_some() && (interrupted || now >= self.playing_until);
        if end_play {
            self.actor = None;
            self.cooldown_until = now + 30;
            self.schedule(now, entropy);
        }
        self.phase = if blocked {
            Phase::Suspended
        } else if waiting {
            Phase::WaitingForReply
        } else if conversation {
            Phase::Conversing
        } else if self.actor.is_some() {
            Phase::Playing
        } else if now < self.cooldown_until {
            Phase::Cooldown
        } else {
            Phase::Idle
        };
        if self.next_prank == 0 || blocked || conversation || waiting {
            self.schedule(now, entropy);
        }
        Transition {
            end_play,
            discard_reactions,
        }
    }

    fn begin(&mut self, actor: String, epoch: u64, now: i64) {
        self.actor = Some((actor, epoch));
        self.playing_until = now + 30;
        self.phase = Phase::Playing;
    }
}

#[tauri::command]
pub(crate) fn get_desktop_preferences(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Preferences, String> {
    preferences(&*lock(&state.db)?)
}

#[tauri::command]
pub(crate) async fn set_desktop_preferences(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    preferences: Preferences,
) -> Result<(), String> {
    let visible = preferences.characters_visible;
    {
        let _action = lock(&state.action)?;
        if crate::unavailable(&state) {
            return Err("앱을 정리하고 있어요.".into());
        }
        let db = lock(&state.db)?;
        save(&db, &preferences)?;
        widgets::storage::discard_automatic_desktop_pending(&db)?;
        cancel_automatic_reaction(&state)?;
        desktop_toys::clear_automatic(&app);
        lock(&state.behavior)?.actor = None;
    }
    let hidden = lock(&state.runtime)?.hidden;
    if visible && hidden {
        crate::show_boxes(&app, &state);
    } else if !visible && !hidden {
        crate::hide_boxes(app.clone(), app.state::<Arc<AppState>>()).await?;
    }
    crate::publish(&app, &state);
    let _ = app.emit("desktop-preferences", &preferences);
    crate::desktop_menu::refresh(&app);
    Ok(())
}

#[tauri::command]
pub(crate) fn clear_desktop_toys(app: tauri::AppHandle) {
    if let Some(state) = app.try_state::<Arc<AppState>>() {
        let Ok(_action) = lock(&state.action) else {
            return;
        };
        let Ok(db) = lock(&state.db) else {
            return;
        };
        if widgets::storage::discard_automatic_desktop_pending(&db).is_err()
            || cancel_automatic_reaction(&state).is_err()
        {
            return;
        }
        desktop_toys::clear(&app);
        if let Ok(mut machine) = lock(&state.behavior) {
            machine.actor = None;
            machine.phase = Phase::Cooldown;
            machine.cooldown_until = crate::now() + 30;
            machine.schedule(crate::now(), uuid::Uuid::new_v4().as_u128() as u64);
        }
        drop(db);
        drop(_action);
        crate::publish(&app, &state);
    }
}

// The caller holds the action gate; unrelated conversations and pending events survive.
fn cancel_automatic_reaction(state: &AppState) -> Result<(), String> {
    let automatic = lock(&state.widget_playback)?.as_ref().is_some_and(|event| {
        event.event.kind.starts_with("desktop.")
            && event.event.payload["automatic"].as_bool() == Some(true)
    });
    if automatic {
        let (epoch, _) = crate::interrupt(state, false)?;
        state.widget_epoch.store(epoch, Ordering::SeqCst);
        let mut runtime = lock(&state.runtime)?;
        runtime.phase = crate::types::RuntimePhase::Idle;
        runtime.persona = None;
    }
    Ok(())
}

pub(crate) async fn tick(app: &tauri::AppHandle, state: &AppState) -> Result<(), String> {
    let geometry = desktop_toys::current_geometry(app).await;
    let timestamp = crate::now();
    let fullscreen = geometry
        .as_ref()
        .map_or(true, |geometry| geometry.fullscreen);
    let entropy = uuid::Uuid::new_v4().as_u128() as u64;
    let _action = lock(&state.action)?;
    if crate::unavailable(state) {
        return Ok(());
    }
    let db = lock(&state.db)?;
    let preferences = preferences(&db)?;
    let runtime = lock(&state.runtime)?.clone();
    let epoch = state.epoch.load(Ordering::SeqCst);
    let blocked = crate::unavailable(state)
        || runtime.hidden
        || runtime.paused
        || fullscreen
        || !store::settings(&db)?.autonomous_enabled;
    let conversation = !matches!(runtime.phase.as_str(), "idle" | "error" | "waiting")
        || lock(&state.panel)?.is_some()
        || timestamp - state.last_input.load(Ordering::SeqCst) < 3;
    let mut machine = lock(&state.behavior)?;
    if !preferences.pranks_enabled && machine.actor.take().is_some() {
        desktop_toys::clear_automatic(app);
    }
    let transition = machine.observe(
        timestamp,
        blocked,
        conversation,
        runtime.phase == "waiting",
        epoch,
        entropy,
    );
    if transition.end_play {
        desktop_toys::clear_automatic(app);
    }
    if transition.discard_reactions {
        widgets::storage::discard_automatic_desktop_pending(&db)?;
        cancel_automatic_reaction(state)?;
    }
    let outcomes = desktop_toys::drain_outcomes(app);
    let mut changed = false;
    for outcome in outcomes {
        if outcome.automatic
            && (blocked || machine.actor.as_ref() != Some(&(outcome.actor_id.clone(), epoch)))
        {
            continue;
        }
        let Ok(instance) = widgets::storage::get(&db, &outcome.widget_id) else {
            continue;
        };
        if !instance.installed || !instance.enabled || instance.revision != outcome.revision {
            continue;
        }
        let payload = serde_json::json!({"actorId":outcome.actor_id,"distanceUnit":"desktop-logical-points","distance":outcome.distance,"bounces":outcome.bounces,"popped":outcome.popped,"automatic":outcome.automatic,"owner":outcome.owner});
        let (kind, text) = match outcome.kind {
            desktop_toys::Kind::Ball => (
                "desktop.ball.stopped",
                format!("바탕화면 공이 {}번 튕긴 뒤 멈췄어요.", outcome.bounces),
            ),
            desktop_toys::Kind::PaperPlane => (
                "desktop.paper-plane.landed",
                format!(
                    "종이비행기가 {:.0} 화면 포인트를 날아 착지했어요.",
                    outcome.distance
                ),
            ),
            desktop_toys::Kind::Bubbles => (
                "desktop.bubbles.popped",
                if outcome.popped {
                    "비눗방울을 터뜨렸어요.".into()
                } else {
                    "비눗방울 놀이가 끝났어요.".into()
                },
            ),
            desktop_toys::Kind::Pet => ("desktop.pet.rested", "바탕화면 펫이 쉬고 있어요.".into()),
        };
        changed |= widgets::storage::record_desktop_result(
            &db,
            &instance.id,
            instance.revision,
            widgets::EventDraft {
                kind: kind.into(),
                text,
                payload,
            },
            chrono::Utc::now().timestamp_millis(),
            !blocked && !conversation,
        )?;
    }
    if changed {
        let _ = app.emit("desktop-toy-results", ());
    }
    if preferences.pranks_enabled && machine.phase == Phase::Idle && timestamp >= machine.next_prank
    {
        let eligible: Vec<_> = widgets::storage::instances(&db)?
            .into_iter()
            .filter(|instance| {
                instance.installed
                    && instance.enabled
                    && preferences.allowed_toys.contains(&instance.kind)
            })
            .collect();
        machine.schedule(timestamp, entropy);
        if let (Some(instance), Ok(geometry)) = (
            eligible.get((entropy as usize) % eligible.len().max(1)),
            geometry.as_ref(),
        ) {
            let owner = crate::characters::collection(&db)?.active.first().cloned();
            let actor = desktop_toys::open(
                app,
                &instance.id,
                &instance.kind,
                owner,
                instance.revision,
                true,
                geometry,
            )?;
            machine.begin(actor, epoch, timestamp);
        }
    }
    drop(machine);
    drop(db);
    drop(_action);
    if transition.discard_reactions {
        crate::publish(app, state);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clearing_claimed_automatic_reaction_cancels_its_epoch_only() {
        for kind in [
            None,
            Some(("desktop.ball.stopped", false)),
            Some(("timer-finished", true)),
            Some(("desktop.ball.stopped", true)),
        ] {
            let state = crate::lifecycle_tests::state();
            let _action = lock(&state.action).unwrap();
            let (epoch, cancel) = crate::interrupt(&state, true).unwrap();
            let current = kind.map(|(kind, automatic)| widgets::WidgetEvent {
                id: "event".into(),
                instance_id: "ball".into(),
                widget_kind: "ball".into(),
                revision: 1,
                created_at: 0,
                expires_at: 30000,
                event: widgets::EventDraft {
                    kind: kind.into(),
                    text: "반응".into(),
                    payload: serde_json::json!({"automatic":automatic}),
                },
            });
            *lock(&state.widget_playback).unwrap() = current;
            *lock(&state.playback).unwrap() = Some(crate::types::Playback {
                id: "line".into(),
                persona: "a".into(),
                expression: "평온".into(),
                text: "재생중".into(),
                source: "widget".into(),
                text_speed: 0,
                display_started_at: None,
                ends_at: 30000,
                line_index: 0,
                line_count: 2,
            });
            lock(&state.runtime).unwrap().phase = crate::types::RuntimePhase::Playing;
            cancel_automatic_reaction(&state).unwrap();
            let should_cancel = kind == Some(("desktop.ball.stopped", true));
            assert_eq!(cancel.load(Ordering::SeqCst), should_cancel);
            assert_eq!(lock(&state.playback).unwrap().is_none(), should_cancel);
            if should_cancel {
                assert!(lock(&state.widget_playback).unwrap().is_none());
                assert_eq!(lock(&state.runtime).unwrap().phase, "idle");
                assert_eq!(state.widget_epoch.load(Ordering::SeqCst), epoch + 1);
            } else {
                assert_eq!(state.epoch.load(Ordering::SeqCst), epoch);
                assert_eq!(lock(&state.runtime).unwrap().phase, "playing");
            }
        }
    }

    #[test]
    fn hidden_typing_stale_and_timeout_cancel_automatic_play() {
        for (blocked, conversation, waiting, epoch, time, expected) in [
            (true, false, false, 1, 10, Phase::Suspended),
            (false, true, false, 1, 10, Phase::Conversing),
            (false, false, true, 1, 10, Phase::WaitingForReply),
            (false, false, false, 2, 10, Phase::Cooldown),
            (false, false, false, 1, 40, Phase::Cooldown),
        ] {
            let mut machine = Machine::default();
            machine.begin("actor".into(), 1, 5);
            let transition = machine.observe(time, blocked, conversation, waiting, epoch, 123);
            assert!(transition.end_play);
            assert_eq!(transition.discard_reactions, time < 40);
            assert_eq!(machine.phase, expected);
            assert!(machine.actor.is_none());
            let repeated = machine.observe(time, blocked, conversation, waiting, epoch, 123);
            assert!(!repeated.end_play && !repeated.discard_reactions);
        }
    }

    #[test]
    fn suspension_without_an_actor_cancels_claimed_reactions_once_per_entry() {
        let mut machine = Machine::default();
        let first = machine.observe(10, true, true, false, 1, 123);
        assert!(!first.end_play && first.discard_reactions);
        assert!(
            !machine
                .observe(11, true, false, false, 1, 123)
                .discard_reactions
        );
        assert!(
            !machine
                .observe(12, false, false, false, 1, 123)
                .discard_reactions
        );
        assert!(
            machine
                .observe(13, true, false, false, 1, 123)
                .discard_reactions
        );
    }

    #[test]
    fn preferences_default_off_and_persist_without_changing_conversation_settings() {
        let db = store::open(std::path::Path::new(":memory:")).unwrap();
        let before = store::settings(&db).unwrap();
        let mut config = preferences(&db).unwrap();
        assert!(!config.pranks_enabled);
        config.characters_visible = false;
        save(&db, &config).unwrap();
        assert!(!preferences(&db).unwrap().characters_visible);
        assert_eq!(
            serde_json::to_value(before).unwrap(),
            serde_json::to_value(store::settings(&db).unwrap()).unwrap()
        );
        config.allowed_toys.push("music".into());
        assert!(save(&db, &config).is_err());
    }
}
