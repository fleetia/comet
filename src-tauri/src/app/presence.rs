use super::{
    is_current, lock, now, phase, publish, scene, schedule_idle, tasks, unavailable, AppState,
};
use crate::{
    characters, store,
    types::{RuntimePhase, SceneLine},
    widgets,
};
use rusqlite::Connection;
use std::{
    collections::BTreeSet,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

const MIN_INTERVAL_SECONDS: i64 = 4 * 60;
const INTERVAL_VARIATION_SECONDS: u64 = 6 * 60 + 1;
const QA_MIN_INTERVAL_SECONDS: i64 = 15;
const QA_INTERVAL_VARIATION_SECONDS: u64 = 16;
type Ticket = (u64, Arc<AtomicBool>);

#[derive(Default)]
pub(crate) struct Presence {
    absent: BTreeSet<String>,
    next_at: i64,
    generation: u64,
    fast_qa: bool,
}

#[derive(Clone)]
struct Transition {
    id: String,
    arriving: bool,
    generation: u64,
    revision: i64,
}

impl Presence {
    pub(crate) fn contains(&self, id: &str) -> bool {
        !self.absent.contains(id)
    }

    pub(crate) fn for_app(app: &tauri::AppHandle) -> Self {
        Self {
            fast_qa: cfg!(debug_assertions) && app.config().identifier.ends_with(".presence-qa"),
            ..Self::default()
        }
    }

    fn schedule(&mut self, at: i64, entropy: u64) {
        let (minimum, variation) = if self.fast_qa {
            (QA_MIN_INTERVAL_SECONDS, QA_INTERVAL_VARIATION_SECONDS)
        } else {
            (MIN_INTERVAL_SECONDS, INTERVAL_VARIATION_SECONDS)
        };
        self.next_at = at + minimum + (entropy % variation) as i64;
    }

    pub(crate) fn reset(&mut self, at: i64) {
        self.absent.clear();
        self.generation = self.generation.wrapping_add(1);
        self.schedule(at, entropy());
    }

    fn choose(
        &mut self,
        active: &[String],
        at: i64,
        seed: u64,
        revision: i64,
    ) -> Option<Transition> {
        self.absent.retain(|id| active.contains(id));
        if self.next_at == 0 {
            self.schedule(at, seed);
        }
        if active.is_empty() || at < self.next_at {
            return None;
        }
        let present: Vec<_> = active
            .iter()
            .filter(|id| !self.absent.contains(*id))
            .collect();
        let absent: Vec<_> = active
            .iter()
            .filter(|id| self.absent.contains(*id))
            .collect();
        let arriving = present.is_empty() || (!absent.is_empty() && seed & 1 == 0);
        let choices = if arriving { &absent } else { &present };
        let id = (*choices.get((seed as usize / 2) % choices.len())?).clone();
        self.schedule(at, seed.rotate_left(17));
        Some(Transition {
            id,
            arriving,
            generation: self.generation,
            revision,
        })
    }
}

fn entropy() -> u64 {
    uuid::Uuid::new_v4().as_u128() as u64
}

pub(crate) fn present_ids(state: &AppState, active: &[String]) -> Result<Vec<String>, String> {
    let presence = lock(&state.presence)?;
    Ok(active
        .iter()
        .filter(|id| !presence.absent.contains(*id))
        .cloned()
        .collect())
}

pub(crate) fn is_present(state: &AppState, id: &str) -> Result<bool, String> {
    Ok(!lock(&state.presence)?.absent.contains(id))
}

// Toy behavior is suspended when everyone has left. Only a due return may bypass that gate.
pub(crate) fn all_absent_return_due(state: &AppState) -> Result<bool, String> {
    let db = lock(&state.db)?;
    let active = characters::active_ids(&db)?;
    let presence = lock(&state.presence)?;
    Ok(!active.is_empty()
        && active.iter().all(|id| presence.absent.contains(id))
        && presence.next_at != 0
        && now() >= presence.next_at)
}

pub(crate) fn lines_visible(
    state: &AppState,
    db: &Connection,
    lines: &[SceneLine],
) -> Result<bool, String> {
    let resolved = characters::resolve_lines(db, lines)?;
    let presence = lock(&state.presence)?;
    Ok(resolved
        .iter()
        .all(|line| !presence.absent.contains(&line.persona)))
}

// Call under action when a person deliberately addresses an absent character.
pub(crate) fn summon_locked(state: &AppState, id: &str) -> Result<bool, String> {
    let mut presence = lock(&state.presence)?;
    if !presence.absent.remove(id) {
        return Ok(false);
    }
    presence.generation = presence.generation.wrapping_add(1);
    presence.schedule(now(), entropy());
    Ok(true)
}

fn begin(state: &AppState) -> Result<Option<(Ticket, Transition)>, String> {
    let _action = lock(&state.action)?;
    let runtime = lock(&state.runtime)?.clone();
    if unavailable(state)
        || state.launcher_open.load(Ordering::SeqCst)
        || runtime.hidden
        || runtime.paused
        || runtime.phase != RuntimePhase::Idle
        || lock(&state.panel)?.is_some()
        || lock(&state.playback)?.is_some()
        || lock(&state.story)?.is_some()
        || lock(&state.reactions)?.blocks_presence()
        || now() - state.last_input.load(Ordering::SeqCst) < 30
    {
        return Ok(None);
    }
    let db = lock(&state.db)?;
    let settings = store::settings(&db)?;
    if !settings.autonomous_enabled
        || !settings.random_presence_enabled
        || super::quiet_hours::automatic_blocked(state, &settings)?
        || widgets::storage::focus_active(&db, chrono::Utc::now().timestamp_millis())?
    {
        return Ok(None);
    }
    let active = characters::active_ids(&db)?;
    let revision = store::revision(&db)?;
    let transition = lock(&state.presence)?.choose(&active, now(), entropy(), revision);
    drop(db);
    let Some(transition) = transition else {
        return Ok(None);
    };
    let token = tasks::reserve(state, tasks::Kind::Scene, true)?;
    Ok(Some((token, transition)))
}

pub(crate) fn tick(app: &tauri::AppHandle, state: &Arc<AppState>) -> Result<bool, String> {
    let Some(((epoch, cancel), transition)) = begin(state)? else {
        return Ok(false);
    };
    let worker_app = app.clone();
    let worker_state = state.clone();
    tasks::spawn(
        app.clone(),
        state.clone(),
        tasks::Kind::Scene,
        epoch,
        async move {
            let Some(_guard) = tasks::acquire_gate(&worker_state, epoch, cancel.clone()).await
            else {
                return;
            };
            let result = run(
                &worker_app,
                &worker_state,
                &transition,
                epoch,
                cancel.clone(),
            )
            .await;
            if is_current(&worker_state, epoch, &cancel) {
                phase(
                    &worker_app,
                    &worker_state,
                    epoch,
                    RuntimePhase::Idle,
                    None,
                    result.err(),
                );
            }
        },
    )?;
    Ok(true)
}

async fn run(
    app: &tauri::AppHandle,
    state: &AppState,
    transition: &Transition,
    epoch: u64,
    cancel: Arc<AtomicBool>,
) -> Result<(), String> {
    {
        let _action = lock(&state.action)?;
        let db = lock(&state.db)?;
        if !is_current(state, epoch, &cancel)
            || store::revision(&db)? != transition.revision
            || !characters::active_ids(&db)?.contains(&transition.id)
            || lock(&state.presence)?.generation != transition.generation
        {
            return Ok(());
        }
    }
    if transition.arriving {
        let changed = {
            let _action = lock(&state.action)?;
            let db = lock(&state.db)?;
            if !is_current(state, epoch, &cancel)
                || store::revision(&db)? != transition.revision
                || !characters::active_ids(&db)?.contains(&transition.id)
                || lock(&state.presence)?.generation != transition.generation
            {
                return Ok(());
            }
            summon_locked(state, &transition.id)?
        };
        if changed {
            publish(app, state);
        }
    }
    let line = {
        let db = lock(&state.db)?;
        let character = characters::active_character(&db, &transition.id)?;
        let variants = if transition.arriving {
            &character.definition.return_lines
        } else {
            &character.definition.departure_lines
        };
        let selected = variants
            .get((entropy() as usize) % variants.len().max(1))
            .ok_or("캐릭터 출입 대사가 없습니다.")?;
        SceneLine {
            persona: transition.id.clone(),
            expression: selected.expression.clone(),
            motion: selected.motion.clone(),
            text: selected.text.clone(),
        }
    };
    scene::run_scene(
        app,
        state,
        &[line],
        "presence",
        &uuid::Uuid::new_v4().to_string(),
        false,
        epoch,
        cancel.clone(),
    )
    .await?;
    if transition.arriving {
        let _action = lock(&state.action)?;
        let db = lock(&state.db)?;
        if is_current(state, epoch, &cancel) && store::revision(&db)? == transition.revision {
            schedule_idle(state, store::settings(&db)?.idle_minutes);
        }
        return Ok(());
    }
    if !transition.arriving {
        let changed = {
            let _action = lock(&state.action)?;
            let db = lock(&state.db)?;
            if !is_current(state, epoch, &cancel)
                || store::revision(&db)? != transition.revision
                || lock(&state.presence)?.generation != transition.generation
            {
                return Ok(());
            }
            let active = characters::active_ids(&db)?;
            let mut presence = lock(&state.presence)?;
            if !active.contains(&transition.id) {
                false
            } else {
                presence.absent.insert(transition.id.clone());
                presence.generation = presence.generation.wrapping_add(1);
                true
            }
        };
        if changed {
            publish(app, state);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{PreparedScene, QuietHours, Settings};
    use std::time::{Duration, Instant};

    #[test]
    fn chooses_only_active_people_and_returns_after_everyone_leaves() {
        let active = vec!["one".into(), "two".into(), "three".into()];
        let mut presence = Presence {
            next_at: 100,
            ..Default::default()
        };
        let first = presence.choose(&active, 100, 3, 1).unwrap();
        assert!(!first.arriving);
        presence.absent.insert(first.id.clone());
        presence.next_at = 101;
        let second = presence.choose(&active, 101, 5, 1).unwrap();
        assert!(!second.arriving);
        presence.absent.insert(second.id.clone());
        presence.next_at = 102;
        let third = presence.choose(&active, 102, 7, 1).unwrap();
        assert!(!third.arriving);
        presence.absent.insert(third.id);
        presence.next_at = 103;
        let fourth = presence.choose(&active, 103, 9, 1).unwrap();
        assert!(fourth.arriving);
        assert!(presence.absent.contains(&fourth.id));
        let mut solo = Presence {
            next_at: 100,
            ..Default::default()
        };
        assert!(!solo.choose(&["one".into()], 100, 1, 1).unwrap().arriving);
    }

    #[test]
    fn reset_clears_absence_and_invalidates_an_old_departure() {
        let mut presence = Presence::default();
        presence.absent.insert("one".into());
        let old = presence.generation;
        presence.reset(100);
        assert!(presence.absent.is_empty());
        assert_ne!(presence.generation, old);
        assert!((340..=700).contains(&presence.next_at));
    }

    #[test]
    fn automatic_lines_skip_absent_speakers_and_direct_lines_summon_them() {
        let state = super::super::tests::state();
        let (id, revision) = {
            let db = lock(&state.db).unwrap();
            (
                characters::active_ids(&db).unwrap()[0].clone(),
                store::revision(&db).unwrap(),
            )
        };
        lock(&state.presence).unwrap().absent.insert(id.clone());
        let line = SceneLine {
            persona: id.clone(),
            expression: characters::DEFAULT_EXPRESSION.into(),
            motion: Default::default(),
            text: "기존 대사".into(),
        };
        let automatic = {
            let _action = lock(&state.action).unwrap();
            super::super::interrupt(&state, true).unwrap()
        };
        assert!(!scene::present_line(
            &state,
            &line,
            "script",
            "automatic",
            0,
            1,
            revision,
            automatic.0,
            &automatic.1,
            false,
        )
        .unwrap());
        assert!(lock(&state.playback).unwrap().is_none());
        assert!(!present_ids(&state, std::slice::from_ref(&id))
            .unwrap()
            .contains(&id));

        let direct = {
            let _action = lock(&state.action).unwrap();
            super::super::interrupt(&state, false).unwrap()
        };
        assert!(scene::present_line(
            &state, &line, "script", "direct", 0, 1, revision, direct.0, &direct.1, true,
        )
        .unwrap());
        assert!(present_ids(&state, std::slice::from_ref(&id))
            .unwrap()
            .contains(&id));
        assert!(super::super::snapshot(&state)
            .unwrap()
            .runtime
            .present_character_ids
            .contains(&id));
    }

    #[test]
    fn temporarily_absent_speaker_keeps_a_prepared_scene_for_later() {
        let state = super::super::tests::state();
        let id = {
            let db = lock(&state.db).unwrap();
            let id = characters::active_ids(&db).unwrap()[0].clone();
            store::add_scene(
                &db,
                &PreparedScene {
                    id: "wait-for-return".into(),
                    revision: store::revision(&db).unwrap(),
                    lines: vec![SceneLine {
                        persona: id.clone(),
                        expression: characters::DEFAULT_EXPRESSION.into(),
                        motion: Default::default(),
                        text: "돌아온 뒤에 할 이야기".into(),
                    }],
                },
            )
            .unwrap();
            id
        };
        lock(&state.presence).unwrap().absent.insert(id);
        state.idle_sequence.store(1, Ordering::SeqCst);
        let _ = scene::next_scene(&state).unwrap();
        assert_eq!(
            store::prepared_scenes(&lock(&state.db).unwrap())
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn stopping_automatic_behavior_restores_all_absent_characters() {
        let state = super::super::tests::state();
        let active = characters::active_ids(&lock(&state.db).unwrap()).unwrap();
        {
            let db = lock(&state.db).unwrap();
            store::save_settings(
                &db,
                &Settings {
                    random_presence_enabled: true,
                    ..store::settings(&db).unwrap()
                },
            )
            .unwrap();
        }
        lock(&state.presence)
            .unwrap()
            .absent
            .extend(active.iter().cloned());
        let settings = Settings {
            autonomous_enabled: false,
            random_presence_enabled: true,
            ..store::settings(&lock(&state.db).unwrap()).unwrap()
        };
        super::super::settings::apply_settings(
            &state,
            &settings,
            Some(super::super::settings::SettingsScope::Automatic),
            None,
        )
        .unwrap();
        assert_eq!(present_ids(&state, &active).unwrap(), active);
    }

    #[test]
    fn hourly_story_waits_until_its_owner_returns() {
        let state = super::super::tests::state();
        let [nadir, companion] = {
            let db = lock(&state.db).unwrap();
            let imported = characters::import_pack(&db, &characters::nadir_pack()).unwrap();
            characters::apply_pair(&db, [imported[0].id.clone(), imported[1].id.clone()]).unwrap();
            [imported[0].id.clone(), imported[1].id.clone()]
        };
        lock(&state.presence).unwrap().absent.insert(nadir.clone());
        lock(&state.story_clock).unwrap().elapsed = Duration::from_secs(3600);
        assert!(!crate::story_host::advance(&state, Instant::now()).unwrap());
        assert!(lock(&state.story).unwrap().is_none());
        assert_eq!(lock(&state.runtime).unwrap().phase, RuntimePhase::Idle);

        lock(&state.presence).unwrap().absent.insert(companion);
        lock(&state.story_clock).unwrap().elapsed = Duration::from_secs(3600);
        assert!(!crate::story_host::advance(&state, Instant::now()).unwrap());
        assert!(lock(&state.story).unwrap().is_none());

        lock(&state.presence).unwrap().absent.remove(&nadir);
        lock(&state.story_clock).unwrap().elapsed = Duration::from_secs(3600);
        assert!(crate::story_host::advance(&state, Instant::now()).unwrap());
        assert_eq!(lock(&state.story).unwrap().as_ref().unwrap().persona, nadir);
    }

    #[test]
    fn all_absent_return_remains_due_while_toy_behavior_is_suspended() {
        let state = super::super::tests::state();
        let active = {
            let db = lock(&state.db).unwrap();
            let settings = Settings {
                random_presence_enabled: true,
                ..store::settings(&db).unwrap()
            };
            store::save_settings(&db, &settings).unwrap();
            characters::active_ids(&db).unwrap()
        };
        {
            let mut presence = lock(&state.presence).unwrap();
            presence.absent.extend(active.iter().cloned());
            presence.next_at = now() + 60;
        }
        assert!(!all_absent_return_due(&state).unwrap());
        lock(&state.presence).unwrap().next_at = now() - 1;
        assert!(all_absent_return_due(&state).unwrap());
        lock(&state.behavior).unwrap().phase = crate::behavior::Phase::Suspended;

        lock(&state.runtime).unwrap().paused = true;
        assert!(begin(&state).unwrap().is_none());
        lock(&state.runtime).unwrap().paused = false;
        let (_, transition) = begin(&state).unwrap().unwrap();
        assert!(transition.arriving);
        assert!(active.contains(&transition.id));
    }

    #[test]
    fn quiet_hours_defer_a_due_return_until_silence_ends() {
        let state = super::super::tests::state();
        let local = chrono::Local::now();
        let quiet_hours = QuietHours {
            enabled: true,
            start: (local - chrono::Duration::hours(1))
                .format("%H:%M")
                .to_string(),
            end: (local + chrono::Duration::hours(1))
                .format("%H:%M")
                .to_string(),
            weekdays: (0..7).collect(),
        };
        let active = {
            let db = lock(&state.db).unwrap();
            store::save_settings(
                &db,
                &Settings {
                    random_presence_enabled: true,
                    quiet_hours: quiet_hours.clone(),
                    ..store::settings(&db).unwrap()
                },
            )
            .unwrap();
            characters::active_ids(&db).unwrap()
        };
        {
            let mut presence = lock(&state.presence).unwrap();
            presence.absent.extend(active.iter().cloned());
            presence.next_at = now() - 1;
        }
        assert!(all_absent_return_due(&state).unwrap());
        assert!(begin(&state).unwrap().is_none());

        let db = lock(&state.db).unwrap();
        store::save_settings(
            &db,
            &Settings {
                quiet_hours: QuietHours {
                    enabled: false,
                    ..quiet_hours
                },
                ..store::settings(&db).unwrap()
            },
        )
        .unwrap();
        drop(db);
        assert!(begin(&state).unwrap().unwrap().1.arriving);
    }
}
