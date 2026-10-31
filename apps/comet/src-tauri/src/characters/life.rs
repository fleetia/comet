use crate::{
    app::{self, lock, AppState},
    characters, store,
    types::RuntimePhase,
};
use std::{
    collections::BTreeMap,
    sync::{atomic::Ordering, Arc},
};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

pub(crate) mod wandering;
type Result<T> = std::result::Result<T, String>;

#[derive(Default)]
pub(crate) struct Runtime {
    sleeping: BTreeMap<String, String>,
    idle: BTreeMap<String, IdlePeriod>,
    pub(crate) wandering: wandering::Runtime,
    mood: BTreeMap<String, Mood>,
    mood_changes: std::collections::VecDeque<MoodChange>,
    mood_idle: BTreeMap<String, MoodIdle>,
    sleep_started: BTreeMap<String, i64>,
    mood_input: u64,
    mood_tick_at: i64,
    pub(crate) activity: crate::app_usage::activity::Runtime,
}

const MOOD_DECAY_MS: i64 = 30 * 60 * 1000;
const MOOD_COOLDOWN_MS: i64 = 5 * 60 * 1000;
const MOOD_IDLE_MS: i64 = 2 * 60 * 60 * 1000;

#[derive(Default)]
struct Mood {
    value: i8,
    updated_at: i64,
    last_source: BTreeMap<String, i64>,
}

#[derive(Clone, serde::Serialize)]
pub(crate) struct MoodChange {
    pub character: String,
    pub from: i8,
    pub to: i8,
    pub source: String,
    #[serde(skip)]
    pub at: i64,
    #[serde(skip)]
    pub epoch: u64,
    #[serde(skip)]
    interaction_id: Option<String>,
}

struct MoodIdle {
    last_tick: i64,
    last_input: u64,
    last_touch: i64,
    was_allowed: bool,
    elapsed: i64,
    day: chrono::NaiveDate,
    count: u8,
}

impl Runtime {
    fn record_mood(
        &mut self,
        id: &str,
        from: i8,
        to: i8,
        source: &str,
        now: i64,
        epoch: u64,
    ) -> MoodChange {
        let change = MoodChange {
            character: id.into(),
            from,
            to,
            source: source.into(),
            at: now,
            epoch,
            interaction_id: None,
        };
        if self.mood_changes.len() == 32 {
            self.mood_changes.pop_front();
        }
        self.mood_changes.push_back(change.clone());
        change
    }

    fn decay_mood(&mut self, id: &str, now: i64, epoch: u64) -> Option<MoodChange> {
        if self.is_sleeping(id) {
            return None;
        }
        let mood = self.mood.get_mut(id)?;
        if mood.value == 0 {
            return None;
        }
        let steps = now.saturating_sub(mood.updated_at) / MOOD_DECAY_MS;
        if steps == 0 {
            return None;
        }
        let from = mood.value;
        let amount = steps.min(i64::from(from.unsigned_abs())) as i8;
        mood.value -= from.signum() * amount;
        mood.updated_at += i64::from(amount) * MOOD_DECAY_MS;
        let to = mood.value;
        Some(self.record_mood(id, from, to, "decay", now, epoch))
    }

    pub(crate) fn apply_interaction(
        &mut self,
        id: &str,
        action: &str,
        accepted: bool,
        request_id: &str,
        now: i64,
        epoch: u64,
    ) -> Vec<MoodChange> {
        if !accepted || !matches!(action, "stroke" | "snack") {
            return Vec::new();
        }
        let mut changes = self.apply_mood(id, action, 1, now, epoch);
        for (queued, change) in self
            .mood_changes
            .iter_mut()
            .rev()
            .zip(changes.iter_mut().rev())
        {
            queued.interaction_id = Some(request_id.into());
            change.interaction_id = queued.interaction_id.clone();
        }
        changes
    }

    fn apply_mood(
        &mut self,
        id: &str,
        source: &str,
        delta: i8,
        now: i64,
        epoch: u64,
    ) -> Vec<MoodChange> {
        let mut changes = Vec::new();
        if let Some(change) = self.decay_mood(id, now, epoch) {
            changes.push(change);
        }
        let mood = self.mood.entry(id.into()).or_default();
        if !mood
            .last_source
            .get(source)
            .is_some_and(|at| now.saturating_sub(*at) < MOOD_COOLDOWN_MS)
        {
            mood.last_source.insert(source.into(), now);
            let from = mood.value;
            let to = (i16::from(from) + i16::from(delta)).clamp(-2, 2) as i8;
            if from != to {
                mood.value = to;
                mood.updated_at = now;
                changes.push(self.record_mood(id, from, to, source, now, epoch));
            }
        }
        changes
    }
}

fn emit_mood(app: &AppHandle, change: &MoodChange) {
    let _ = app.emit("character-mood-changed", change);
}

pub(crate) fn mood(state: &AppState, character_id: &str) -> Result<i8> {
    Ok(lock(&state.life)?
        .mood
        .get(character_id)
        .map_or(0, |mood| mood.value))
}

// Caller may hold action or DB locks; publishing the full snapshot happens on the maintenance clock.
pub(crate) fn change_mood(
    app: &AppHandle,
    state: &AppState,
    character_id: &str,
    source: &str,
    delta: i8,
) -> Result<()> {
    let now = chrono::Utc::now().timestamp_millis();
    let changes = lock(&state.life)?.apply_mood(
        character_id,
        source,
        delta,
        now,
        state.epoch.load(Ordering::SeqCst),
    );
    for change in &changes {
        emit_mood(app, change);
    }
    Ok(())
}

pub(crate) fn change_interaction_mood(
    app: &AppHandle,
    state: &AppState,
    character_id: &str,
    action: &str,
    accepted: bool,
    request_id: &str,
) -> Result<()> {
    let changes = lock(&state.life)?.apply_interaction(
        character_id,
        action,
        accepted,
        request_id,
        chrono::Utc::now().timestamp_millis(),
        state.epoch.load(Ordering::SeqCst),
    );
    for change in &changes {
        emit_mood(app, change);
    }
    Ok(())
}

pub(crate) fn pop_mood_change(state: &AppState) -> Result<Option<MoodChange>> {
    let now = chrono::Utc::now().timestamp_millis();
    let mut life = lock(&state.life)?;
    while let Some(change) = life.mood_changes.pop_front() {
        if now.saturating_sub(change.at) <= 60_000 {
            return Ok(Some(change));
        }
    }
    Ok(None)
}

pub(crate) fn discard_mood_changes(state: &AppState) -> Result<()> {
    lock(&state.life)?.mood_changes.clear();
    Ok(())
}

pub(crate) fn advance_mood_changes_epoch(state: &AppState, previous: u64, next: u64) -> Result<()> {
    for change in &mut lock(&state.life)?.mood_changes {
        if change.epoch == previous {
            change.epoch = next;
        }
    }
    Ok(())
}

pub(crate) fn advance_interaction_mood_epoch(
    state: &AppState,
    request_id: &str,
    previous: u64,
    next: u64,
) -> Result<()> {
    for change in &mut lock(&state.life)?.mood_changes {
        if change.epoch == previous && change.interaction_id.as_deref() == Some(request_id) {
            change.epoch = next;
        }
    }
    Ok(())
}

pub(crate) fn note_mood_input(state: &AppState) -> Result<()> {
    let mut life = lock(&state.life)?;
    life.mood_input = life.mood_input.wrapping_add(1);
    Ok(())
}

#[tauri::command]
pub(crate) fn get_character_mood(
    state: tauri::State<'_, Arc<AppState>>,
    character_id: String,
) -> Result<i8> {
    characters::get(&*lock(&state.db)?, &character_id)?;
    mood(&state, &character_id)
}

struct IdlePeriod {
    next_at: i64,
    stretch: bool,
}

impl Runtime {
    pub(crate) fn is_sleeping(&self, character_id: &str) -> bool {
        self.sleeping.contains_key(character_id)
    }

    pub(crate) fn mood_ids(&self) -> (Vec<String>, Vec<String>) {
        let high = self
            .mood
            .iter()
            .filter(|(_, mood)| mood.value > 0)
            .map(|(id, _)| id.clone())
            .collect();
        let low = self
            .mood
            .iter()
            .filter(|(_, mood)| mood.value < 0)
            .map(|(id, _)| id.clone())
            .collect();
        (high, low)
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
    let now = chrono::Utc::now().timestamp_millis();
    let mut life = lock(&state.life)?;
    let woke = life.sleeping.remove(character_id).is_some();
    if let Some(started) = life.sleep_started.remove(character_id) {
        if let Some(mood) = life.mood.get_mut(character_id) {
            mood.updated_at += now.saturating_sub(started.max(mood.updated_at));
        }
    }
    Ok(woke)
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
    let sleeping = life
        .sleeping
        .keys()
        .cloned()
        .collect::<std::collections::BTreeSet<_>>();
    let now = chrono::Utc::now().timestamp_millis();
    let ended = life
        .sleep_started
        .keys()
        .filter(|id| !sleeping.contains(*id))
        .cloned()
        .collect::<Vec<_>>();
    for id in ended {
        if let Some(started) = life.sleep_started.remove(&id) {
            if let Some(mood) = life.mood.get_mut(&id) {
                mood.updated_at += now.saturating_sub(started.max(mood.updated_at));
            }
        }
    }
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
    tick_mood(app, state)?;
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

fn tick_mood(app: &AppHandle, state: &AppState) -> Result<()> {
    let now = chrono::Utc::now().timestamp_millis();
    {
        let mut life = lock(&state.life)?;
        if now.saturating_sub(life.mood_tick_at) < 5_000 {
            return Ok(());
        }
        life.mood_tick_at = now;
    }
    let action = lock(&state.action)?;
    let status = lock(&state.runtime)?.clone();
    let (ids, blocked, touches) = {
        let db = lock(&state.db)?;
        let ids = characters::active_ids(&db)?;
        let settings = store::settings(&db)?;
        let blocked = status.hidden
            || status.paused
            || app::unavailable(state)
            || app::quiet_hours::automatic_blocked(state, &settings)?
            || crate::widgets::storage::focus_active(&db, now)?;
        let mut touches = BTreeMap::new();
        for id in &ids {
            let count = crate::widgets::storage::character_touches(&db, id, now)?.total;
            touches.insert(id.clone(), count);
        }
        (ids, blocked, touches)
    };
    let today = chrono::Local::now().date_naive();
    let changes = {
        let mut life = lock(&state.life)?;
        let mut changes = Vec::new();
        let mut idle_ids = Vec::new();
        let last_input = life.mood_input;
        let mood_ids = life.mood.keys().cloned().collect::<Vec<_>>();
        for id in mood_ids {
            if let Some(change) = life.decay_mood(&id, now, state.epoch.load(Ordering::SeqCst)) {
                changes.push(change);
            }
        }
        for id in ids {
            let asleep = life.is_sleeping(&id);
            let touch = touches.get(&id).copied().unwrap_or(0);
            let idle = life.mood_idle.entry(id.clone()).or_insert(MoodIdle {
                last_tick: now,
                last_input,
                last_touch: touch,
                was_allowed: false,
                elapsed: 0,
                day: today,
                count: 0,
            });
            if idle.day != today {
                idle.day = today;
                idle.count = 0;
            }
            if idle.last_input != last_input || idle.last_touch != touch {
                idle.elapsed = 0;
                idle.last_input = last_input;
                idle.last_touch = touch;
            } else if idle.was_allowed && !blocked && !asleep {
                idle.elapsed += now.saturating_sub(idle.last_tick).min(30_000);
            }
            idle.last_tick = now;
            idle.was_allowed = !blocked && !asleep;
            if idle.was_allowed && idle.elapsed >= MOOD_IDLE_MS && idle.count < 2 {
                idle.elapsed = 0;
                idle.count += 1;
                idle_ids.push(id);
            }
        }
        for id in idle_ids {
            changes.extend(life.apply_mood(
                &id,
                "idle",
                -1,
                now,
                state.epoch.load(Ordering::SeqCst),
            ));
        }
        changes
    };
    drop(action);
    for change in &changes {
        emit_mood(app, change);
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
    let now = chrono::Utc::now().timestamp_millis();
    let mut life = lock(&state.life)?;
    let _ = life.decay_mood(character_id, now, state.epoch.load(Ordering::SeqCst));
    let was_awake = life
        .sleeping
        .insert(character_id.into(), revision)
        .is_none();
    if was_awake {
        life.sleep_started.insert(character_id.into(), now);
    }
    Ok(was_awake)
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
        note_mood_input(&state)?;
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
    let change = {
        let _action = lock(&state.action)?;
        let from = mood(&state, &character_id)?;
        apply_sleep(&state, &character_id, sleeping)?;
        let to = mood(&state, &character_id)?;
        (from != to).then(|| MoodChange {
            character: character_id.clone(),
            from,
            to,
            source: "decay".into(),
            at: chrono::Utc::now().timestamp_millis(),
            epoch: state.epoch.load(Ordering::SeqCst),
            interaction_id: None,
        })
    };
    if let Some(change) = change {
        emit_mood(&app, &change);
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
    let reaction_started = event.event.is_some()
        && characters::reaction_host::direct_start(
            &app,
            state.inner().clone(),
            &character_id,
            &action,
            None,
            characters::reaction_host::window_identity(&window),
        )?
        .is_some();
    if !reaction_started {
        app::publish(&app, &state);
    }
    crate::widgets::commands::publish_widgets(&app, &state);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepted_interactions_change_mood_without_a_reaction_and_ignore_retries() {
        let state = app::tests::state();
        let db = lock(&state.db).unwrap();
        let id = characters::active_ids(&db).unwrap()[0].clone();
        let actor = characters::get(&db, &id).unwrap();
        crate::widgets::storage::body_interaction_with_actor(
            &db,
            &actor,
            0,
            "stroke",
            &uuid::Uuid::new_v4().to_string(),
            500,
        )
        .unwrap();
        let first = uuid::Uuid::new_v4().to_string();
        let accepted = crate::widgets::storage::body_interaction_with_actor(
            &db, &actor, 0, "stroke", &first, 1_000,
        )
        .unwrap();
        assert!(accepted.accepted && accepted.event.is_none());
        let mut life = Runtime::default();
        life.apply_interaction(&id, "stroke", accepted.accepted, &first, 1_000, 0);
        assert_eq!(life.mood[&id].value, 1);
        let retry = crate::widgets::storage::body_interaction_with_actor(
            &db, &actor, 0, "stroke", &first, 400_000,
        )
        .unwrap();
        assert!(!retry.accepted);
        life.apply_interaction(&id, "stroke", retry.accepted, &first, 400_000, 0);
        assert_eq!(life.mood[&id].value, 1);
        let second = crate::widgets::storage::body_interaction_with_actor(
            &db,
            &actor,
            0,
            "snack",
            &uuid::Uuid::new_v4().to_string(),
            1_001,
        )
        .unwrap();
        assert!(second.accepted);
        life.apply_interaction(&id, "snack", second.accepted, "snack", 1_001, 0);
        assert_eq!(life.mood[&id].value, 2);
        life.apply_interaction(&id, "poke", true, "poke", 1_002, 0);
        assert_eq!(life.mood[&id].value, 2);
    }

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
            expression: None,
            motion: None,
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
                "UPDATE widget_instances SET data=?1 WHERE kind='focus-timer'",
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
                "UPDATE widget_instances SET data=?1 WHERE kind='focus-timer'",
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
