use crate::{
    app::{lock, now, AppState},
    story,
};
use std::{
    sync::{atomic::Ordering, Arc},
    time::{Duration, Instant},
};

pub fn advance(state: &AppState, at: Instant) -> Result<bool, String> {
    let _action = lock(&state.action)?;
    let due = story::tick(&mut *lock(&state.story_clock)?, at);
    if !due {
        return Ok(false);
    }
    if lock(&state.story)?.is_some() {
        lock(&state.story_clock)?.elapsed = Duration::ZERO;
        return Ok(false);
    }
    let status = lock(&state.runtime)?.clone();
    if crate::app::unavailable(state)
        || status.hidden
        || status.paused
        || !matches!(status.phase.as_str(), "idle" | "error")
        || lock(&state.panel)?.is_some()
        || now() - state.last_input.load(Ordering::SeqCst) < 15
    {
        return Ok(false);
    }
    let db = lock(&state.db)?;
    if !crate::store::settings(&db)?.autonomous_enabled {
        return Ok(false);
    }
    if let Ok(catalog) = story::load(&state.app_data) {
        *lock(&state.story_catalog)? = catalog;
    }
    let seed = uuid::Uuid::new_v4().as_u128() as u64;
    let mut personas = crate::characters::active_ids(&db)?;
    if !personas.is_empty() {
        let offset = seed as usize % personas.len();
        personas.rotate_left(offset);
    }
    for persona in personas {
        if let Some(mut request) =
            story::prepare_from_catalog(&db, &persona, 0, seed, &lock(&state.story_catalog)?)?
        {
            let (epoch, _) = crate::app::interrupt(state, true)?;
            request.epoch = epoch;
            *lock(&state.story)? = Some(request);
            lock(&state.story_clock)?.elapsed = Duration::ZERO;
            let mut runtime = lock(&state.runtime)?;
            runtime.phase = crate::types::RuntimePhase::Story;
            runtime.persona = Some(persona);
            runtime.error = None;
            return Ok(true);
        }
    }
    lock(&state.story_clock)?.elapsed = Duration::ZERO;
    Ok(false)
}

#[tauri::command]
pub fn choose_story(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    request_id: String,
    choice_id: String,
) -> Result<(), String> {
    let (line, token) = {
        let _action = lock(&state.action)?;
        let request = lock(&state.story)?
            .as_ref()
            .filter(|r| r.id == request_id)
            .cloned()
            .ok_or("이미 지나간 이야기예요.")?;
        let status = lock(&state.runtime)?.clone();
        let db = lock(&state.db)?;
        if status.hidden
            || status.paused
            || crate::app::unavailable(&state)
            || !crate::store::settings(&db)?.autonomous_enabled
        {
            return Err("지금은 이야기가 쉬고 있어요.".into());
        }
        let text = story::answer(
            &db,
            &request,
            &choice_id,
            state.epoch.load(Ordering::SeqCst),
        )?;
        let token = crate::app::interrupt(&state, false)?;
        state.last_input.store(now(), Ordering::SeqCst);
        crate::app::schedule_idle(&state, crate::store::settings(&db)?.idle_minutes);
        (
            crate::types::SceneLine {
                motion: Default::default(),
                persona: request.persona,
                expression: "평온".into(),
                text,
            },
            token,
        )
    };
    crate::app::scene::start_scene(app, state.inner().clone(), vec![line], "story", token, None);
    Ok(())
}

#[tauri::command]
pub fn defer_story(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    request_id: String,
) -> Result<(), String> {
    let epoch = {
        let _action = lock(&state.action)?;
        if lock(&state.story)?
            .as_ref()
            .is_none_or(|r| r.id != request_id)
        {
            return Ok(());
        }
        let (epoch, _) = crate::app::interrupt(&state, false)?;
        state.last_input.store(now(), Ordering::SeqCst);
        crate::app::schedule_idle(
            &state,
            crate::store::settings(&*lock(&state.db)?)?.idle_minutes,
        );
        epoch
    };
    crate::app::phase(
        &app,
        &state,
        epoch,
        crate::types::RuntimePhase::Idle,
        None,
        None,
    );
    Ok(())
}

pub async fn run_clock(app: tauri::AppHandle, state: Arc<AppState>) {
    let mut interval = tokio::time::interval(Duration::from_millis(500));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        interval.tick().await;
        if state.stopping.load(Ordering::SeqCst) {
            break;
        }
        if advance(&state, Instant::now()).unwrap_or(false) {
            crate::app::publish(&app, &state);
        }
    }
}
