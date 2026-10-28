use super::lifecycle::flush_positions;
use super::presence;
use super::scene::{next_scene, run_scene};
use super::unavailable;
use super::{is_current, lock, now, phase, schedule_idle, tasks, AppState};
use crate::behavior;
use crate::{
    characters, domain, inference, models, resources, store, story,
    types::*,
    widgets::commands::{advance_widgets, play_widget_reaction},
    widgets::connection_host::start_due_widget_refreshes,
    widgets::storage,
};
use chrono::Datelike;
use rusqlite::{Connection, OptionalExtension};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

pub(crate) async fn background_loop(app: tauri::AppHandle, state: Arc<AppState>) {
    let mut interval = tokio::time::interval(Duration::from_millis(500));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        interval.tick().await;
        if state.stopping.load(Ordering::SeqCst) {
            break;
        }
        if state.update_installing.load(Ordering::SeqCst) {
            continue;
        }
        let _ = skip_blocked_recall_opportunity(&state);
        if super::windows::expire_pause(&state, chrono::Utc::now().timestamp_millis())
            .unwrap_or(false)
        {
            super::publish(&app, &state);
            crate::desktop::menu::refresh(&app);
        }
        let quiet_changed = super::quiet_hours::reconcile(&state).unwrap_or(false);
        let animation_changed =
            crate::characters::animation_states::refresh(&app, &state).unwrap_or(false);
        let _ = crate::characters::life::tick(&app, &state);
        if quiet_changed || animation_changed {
            super::publish(&app, &state);
        }
        tasks::reap(&state).await;
        if crate::updater::tick(&app, &state).unwrap_or(false) {
            continue;
        }
        let maintenance_app = app.clone();
        let maintenance_state = state.clone();
        let _ = tasks::spawn_maintenance(&state, async move {
            maintenance_state.nlp.maintain();
            crate::memory_commands::install_required_models(&maintenance_state);
            let _ = behavior::tick(&maintenance_app, &maintenance_state).await;
            if let Ok(_gate) = maintenance_state.gate.try_lock() {
                let idle = lock(&maintenance_state.runtime)
                    .map(|runtime| {
                        matches!(runtime.phase, RuntimePhase::Idle | RuntimePhase::Error)
                    })
                    .unwrap_or(false);
                if idle && now() - maintenance_state.last_foreground.load(Ordering::SeqCst) >= 120 {
                    inference::stop_local(&maintenance_state.inference).await;
                }
            }
            let _ = crate::memory_commands::index_next(&maintenance_state).await;
        });
        let _ = flush_positions(&state, false);
        let _ = advance_widgets(&app, &state);
        if crate::talk::host::play_activity_reaction(&app, &state).unwrap_or(false) {
            continue;
        }
        let _ = crate::diary::runtime::tick(&app, &state);
        if crate::widgets::generated::commands::advance_reactions(&app, &state).unwrap_or(false) {
            continue;
        }
        start_due_widget_refreshes(&app, &state);
        let Ok(status) = lock(&state.runtime).map(|runtime| runtime.clone()) else {
            continue;
        };
        if !["idle", "error"].contains(&status.phase.as_str()) {
            continue;
        }
        if behavior::reactions_blocked(&state).unwrap_or(true) {
            // An empty desktop suspends toy behavior, but a due return must still run.
            // Playing toys and other suspended states keep their usual gate.
            if lock(&state.behavior)
                .map(|machine| machine.phase == behavior::Phase::Suspended)
                .unwrap_or(false)
                && presence::all_absent_return_due(&state).unwrap_or(false)
                && crate::desktop::toys::current_geometry(&app)
                    .await
                    .is_ok_and(|geometry| !geometry.fullscreen)
                && lock(&state.behavior)
                    .map(|machine| machine.phase == behavior::Phase::Suspended)
                    .unwrap_or(false)
            {
                let _ = presence::tick(&app, &state);
            }
            continue;
        }
        if play_widget_reaction(&app, &state).unwrap_or(false) {
            continue;
        }
        if expire_idle_recall(&state, chrono::Utc::now().timestamp_millis()).unwrap_or(false) {
            super::publish(&app, &state);
        }
        if presence::tick(&app, &state).unwrap_or(false) {
            continue;
        }
        if let Ok(Some((epoch, cancel))) = begin_background(&state) {
            let worker_app = app.clone();
            let worker_state = state.clone();
            let _ = tasks::spawn(
                app.clone(),
                state.clone(),
                tasks::Kind::Background,
                epoch,
                async move {
                    let Some(_guard) =
                        tasks::acquire_gate(&worker_state, epoch, cancel.clone()).await
                    else {
                        return;
                    };
                    let result =
                        run_background(&worker_app, &worker_state, epoch, cancel.clone()).await;
                    if is_current(&worker_state, epoch, &cancel) {
                        if result.is_err() {
                            // User content and model responses are deliberately omitted.
                            crate::report_error!(
                                "automatic_preparation",
                                "Automatic preparation deferred"
                            );
                        }
                        phase(
                            &worker_app,
                            &worker_state,
                            epoch,
                            RuntimePhase::Idle,
                            None,
                            None,
                        );
                    }
                },
            );
        }
    }
}

fn claim_recall_opportunity(db: &Connection) -> Result<bool, String> {
    let today = chrono::Local::now().date_naive().to_string();
    let previous: Option<String> = db
        .query_row(
            "SELECT value FROM widget_preferences WHERE key='recall:opportunity'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    if previous.as_deref() == Some(today.as_str()) {
        return Ok(false);
    }
    db.execute(
        "INSERT INTO widget_preferences(key,value) VALUES('recall:opportunity',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [&today],
    ).map_err(|error| error.to_string())?;
    Ok(true)
}

fn skip_blocked_recall_opportunity(state: &AppState) -> Result<(), String> {
    if now() < state.next_idle.load(Ordering::SeqCst) {
        return Ok(());
    }
    let _action = lock(&state.action)?;
    let status = lock(&state.runtime)?.clone();
    let db = lock(&state.db)?;
    let settings = store::settings(&db)?;
    if settings.autonomous_enabled
        && settings.diary_recall_enabled
        && (status.hidden
            || status.paused
            || super::quiet_hours::automatic_blocked(state, &settings)?
            || storage::focus_active(&db, chrono::Utc::now().timestamp_millis())?
            || behavior::reactions_blocked(state)?)
    {
        claim_recall_opportunity(&db)?;
    }
    Ok(())
}

fn defer_recent_recall(state: &AppState, enabled: bool, at: i64) -> bool {
    let ready_at = state.last_input.load(Ordering::SeqCst).saturating_add(15);
    if !enabled || at >= ready_at {
        return false;
    }
    state.next_idle.store(ready_at, Ordering::SeqCst);
    true
}

pub(crate) fn expire_idle_recall(state: &AppState, at: i64) -> Result<bool, String> {
    let _action = lock(&state.action)?;
    if unavailable(state) || !["idle", "error"].contains(&lock(&state.runtime)?.phase.as_str()) {
        return Ok(false);
    }
    let db = lock(&state.db)?;
    let expired = store::expire_memories(&db, at)?;
    Ok(store::expire_generated_recall(&db, at)? || expired)
}

pub(crate) fn begin_background(state: &AppState) -> Result<Option<(u64, Arc<AtomicBool>)>, String> {
    let _action = lock(&state.action)?;
    let status = lock(&state.runtime)?.clone();
    if unavailable(state)
        || state.launcher_open.load(Ordering::SeqCst)
        || status.hidden
        || status.paused
        || lock(&state.panel)?.is_some()
        || lock(&state.pack_stories)?.run.is_some()
    {
        return Ok(None);
    }
    let settings = {
        let db = lock(&state.db)?;
        if storage::focus_active(&db, chrono::Utc::now().timestamp_millis())? {
            return Ok(None);
        }
        if presence::present_ids(state, &characters::active_ids(&db)?)?
            .iter()
            .all(|id| crate::characters::life::sleeping(state, id).unwrap_or(true))
        {
            return Ok(None);
        }
        store::settings(&db)?
    };
    if super::quiet_hours::automatic_blocked(state, &settings)? {
        return Ok(None);
    }
    let due = settings.autonomous_enabled && now() >= state.next_idle.load(Ordering::SeqCst);
    if status.phase != "idle" && !(status.phase == "error" && due) {
        return Ok(None);
    }
    if !due
        && (now() - state.last_input.load(Ordering::SeqCst) < 15
            || now() - state.last_background_check.load(Ordering::SeqCst) < 15)
    {
        return Ok(None);
    }
    state.last_background_check.store(now(), Ordering::SeqCst);
    Ok(Some(tasks::reserve(state, tasks::Kind::Background, true)?))
}

pub(crate) async fn run_background(
    app: &tauri::AppHandle,
    state: &AppState,
    epoch: u64,
    cancel: Arc<AtomicBool>,
) -> Result<(), String> {
    let (settings, pending, memories, relationships, revision, scenes, characters, installed) = {
        let db = lock(&state.db)?;
        // Focus may start while this task waits for the gate.
        if storage::focus_active(&db, chrono::Utc::now().timestamp_millis())? {
            return Ok(());
        }
        (
            store::settings(&db)?,
            store::pending_user_messages(&db)?,
            store::idle_memories(&db, chrono::Utc::now().timestamp_millis())?,
            store::relationships(&db)?,
            store::revision(&db)?,
            store::prepared_scenes(&db)?,
            characters::active_members(&db)?
                .into_iter()
                .map(|mut member| {
                    member.definition = story::profile(&db, member.clone())?;
                    Ok(member)
                })
                .collect::<Result<Vec<_>, String>>()?,
            characters::collection(&db)?.installed,
        )
    };
    if super::quiet_hours::automatic_blocked(state, &settings)? {
        return Ok(());
    }
    if settings.autonomous_enabled && now() >= state.next_idle.load(Ordering::SeqCst) {
        if super::users::begin_name_prompt(state, epoch, &cancel)? {
            super::publish(app, state);
            return Ok(());
        }
        let (lines, source) = {
            let _action = lock(&state.action)?;
            if !is_current(state, epoch, &cancel) {
                return Ok(());
            }
            if defer_recent_recall(state, settings.diary_recall_enabled, now()) {
                return Ok(());
            }
            schedule_idle(state, settings.idle_minutes);
            state.last_scene.store(now(), Ordering::SeqCst);
            let selected = {
                let db = lock(&state.db)?;
                let mut selected = None;
                for birthday in due_birthdays(state, &db)? {
                    if let Some(lines) = crate::talk::host::prepare_birthday(state, &db, birthday)? {
                        selected = Some(lines);
                        break;
                    }
                }
                if selected.is_none()
                    && settings.diary_recall_enabled
                    && claim_recall_opportunity(&db)?
                {
                    selected = crate::talk::host::prepare_recall(state, &db)?;
                }
                selected
            };
            if let Some(lines) = selected {
                (lines, "talk")
            } else {
                next_scene(state)?
            }
        };
        return run_scene(
            app,
            state,
            &lines,
            source,
            &uuid::Uuid::new_v4().to_string(),
            false,
            epoch,
            cancel,
        )
        .await;
    }
    if now() - state.last_input.load(Ordering::SeqCst) < 15 {
        return Ok(());
    }
    if !pending.is_empty() {
        let ready = if settings.mode == "local" {
            inference::is_local_running(&state.inference, &settings).await
        } else if settings.mode == "apple" {
            crate::apple_models::status().available
        } else if settings.mode == "chatgpt" {
            state.inference.chatgpt.ready() && !settings.chatgpt_model.is_empty()
        } else {
            settings.mode == "api"
                && inference::api_credentials_ready(&settings)
                && !settings.api_model.is_empty()
        };
        if ready && now() - state.last_preparation.load(Ordering::SeqCst) >= 15 {
            state.last_preparation.store(now(), Ordering::SeqCst);
            phase(
                app,
                state,
                epoch,
                crate::types::RuntimePhase::Analyzing,
                None,
                None,
            );
            let batch = {
                let db = lock(&state.db)?;
                domain::analysis_batch_for_conversations(
                    &pending,
                    &store::analysis_memories(&db, &pending)?,
                    revision,
                    &store::completed_conversation_sources(&db, &pending)?,
                )
            };
            {
                let _action = lock(&state.action)?;
                let db = lock(&state.db)?;
                if !is_current(state, epoch, &cancel)
                    || super::quiet_hours::automatic_blocked(state, &store::settings(&db)?)?
                    || store::revision(&db)? != batch.revision
                {
                    return Ok(());
                }
                store::defer_analysis(&db, &batch.deferred_ids, "source_budget")?;
            }
            if batch.submitted_ids.is_empty() {
                return Ok(());
            }
            let prompt = batch.messages;
            let result = background_generate(
                state,
                &settings,
                &prompt,
                domain::analysis_schema(),
                768,
                cancel.clone(),
            )
            .await;
            let _action = lock(&state.action)?;
            let db = lock(&state.db)?;
            if !is_current(state, epoch, &cancel)
                || super::quiet_hours::automatic_blocked(state, &store::settings(&db)?)?
                || store::revision(&db)? != batch.revision
            {
                return Ok(());
            }
            match result {
                Ok(value) => {
                    if let Err(error) =
                        store::analyze_apply_batch(&db, &value, &batch.submitted_ids)
                    {
                        store::analysis_failure(
                            &db,
                            &batch.submitted_ids,
                            chrono::Utc::now().timestamp_millis(),
                        )?;
                        return Err(error);
                    }
                }
                Err(error) => {
                    store::analysis_failure(
                        &db,
                        &batch.submitted_ids,
                        chrono::Utc::now().timestamp_millis(),
                    )?;
                    return Err(error);
                }
            }
            return Ok(());
        }
    }
    if crate::organizer::runtime::run_next(app, state, epoch, cancel.clone(), false).await? {
        return Ok(());
    }
    if crate::widgets::generated::commands::maybe_create(
        app,
        state,
        &settings,
        epoch,
        cancel.clone(),
    )
    .await?
    {
        return Ok(());
    }
    let generate_enabled = match settings.mode.as_str() {
        "api" => settings.api_idle_enabled,
        "chatgpt" => settings.chatgpt_idle_enabled,
        "local" => settings.local_idle_enabled,
        "apple" => settings.apple_idle_enabled,
        _ => false,
    };
    if store::current_user(&*lock(&state.db)?)?.is_none()
        || !settings.autonomous_enabled
        || !generate_enabled
        || scenes.len() >= 3
        || now() - state.last_preparation.load(Ordering::SeqCst)
            < (i64::from(settings.idle_minutes) * 60).max(60)
        || lock(&state.download_cancel)?.is_some()
    {
        return Ok(());
    }
    let ready = if settings.mode == "local" {
        models::selected_ready(&state.app_data, &settings)
    } else if settings.mode == "apple" {
        crate::apple_models::status().available
    } else if settings.mode == "chatgpt" {
        !settings.chatgpt_model.is_empty() && state.inference.chatgpt.ready()
    } else {
        settings.mode == "api"
            && !settings.api_model.is_empty()
            && inference::api_credentials_ready(&settings)
    };
    if !ready {
        return Ok(());
    }
    let present = presence::present_ids(
        state,
        &characters
            .iter()
            .map(|member| member.id.clone())
            .collect::<Vec<_>>(),
    )?;
    let characters: Vec<_> = characters
        .into_iter()
        .filter(|member| present.contains(&member.id))
        .collect();
    let targets: Vec<String> = characters.iter().map(|member| member.id.clone()).collect();
    if targets.is_empty() {
        return Ok(());
    }
    let question = targets.len() == 1 && state.idle_sequence.load(Ordering::SeqCst) % 2 == 1;
    state.last_preparation.store(now(), Ordering::SeqCst);
    if matches!(settings.mode.as_str(), "local" | "apple") && !resources::background_allowed() {
        return Ok(());
    }
    if matches!(settings.mode.as_str(), "api" | "chatgpt") {
        let _action = lock(&state.action)?;
        if !is_current(state, epoch, &cancel) || !reserve_api_idle(&*lock(&state.db)?, now())? {
            return Ok(());
        }
    }
    phase(
        app,
        state,
        epoch,
        crate::types::RuntimePhase::Preparing,
        None,
        None,
    );
    let scene_id = format!(
        "{}{}",
        if question { "question:" } else { "" },
        uuid::Uuid::new_v4()
    );
    let mut prompt = {
        let db = lock(&state.db)?;
        if !is_current(state, epoch, &cancel) || store::revision(&db)? != revision {
            return Ok(());
        }
        store::record_recall(
            &db,
            &scene_id,
            &memories,
            chrono::Utc::now().timestamp_millis(),
        )?;
        domain::with_user_context(
            domain::roster_scene_prompt(
                &characters,
                &memories,
                &relationships,
                question,
                &installed,
            ),
            store::current_user(&db)?.as_ref(),
        )
    };
    let expressions =
        domain::generated_expressions(characters.iter().map(|member| &member.definition));
    let mut schema = domain::scene_schema_for(
        &targets,
        if targets.len() == 1 { 1 } else { 2 },
        if targets.len() == 1 { 1 } else { 4 },
        &expressions,
    );
    let widget_kinds = domain::configure_widget_replies(
        &*lock(&state.db)?,
        &mut prompt,
        &mut schema,
        settings.mode == "apple",
    )?;
    let result = background_generate(
        state,
        &settings,
        &prompt,
        schema,
        512,
        cancel.clone(),
    )
    .await?;
    let mut lines = domain::parse_lines_for(
        result,
        &targets,
        if targets.len() == 1 { 1 } else { 2 },
        if targets.len() == 1 { 1 } else { 4 },
        false,
    )?;
    domain::validate_generated_expressions(&lines, &expressions)?;
    domain::validate_generated_widgets(&mut lines, &widget_kinds);
    let _action = lock(&state.action)?;
    let db = lock(&state.db)?;
    if !is_current(state, epoch, &cancel)
        || super::quiet_hours::automatic_blocked(state, &store::settings(&db)?)?
        || store::revision(&db)? != revision
        || !store::recall_valid(&db, &scene_id, chrono::Utc::now().timestamp_millis())?
    {
        return Ok(());
    }
    store::add_scene(
        &db,
        &PreparedScene {
            id: scene_id,
            revision,
            lines,
        },
    )?;
    Ok(())
}

fn due_birthdays(
    state: &AppState,
    db: &Connection,
) -> Result<Vec<crate::talk::host::BirthdayTrigger>, String> {
    let mut birthdays = Vec::new();
    let today = chrono::Local::now().date_naive();
    let pending = |key: &str| -> Result<bool, String> {
        db.query_row(
            "SELECT EXISTS(SELECT 1 FROM kv WHERE key=?1)",
            [key],
            |row| row.get::<_, bool>(0),
        )
        .map(|exists| !exists)
        .map_err(|error| error.to_string())
    };
    if let Some(birthday) = store::current_user_birthday(db)? {
        let key = format!("birthday:celebrated:{}", today.year());
        if crate::talk::context::birthday_today(today, birthday.month, birthday.day)
            && pending(&key)?
        {
            birthdays.push(crate::talk::host::BirthdayTrigger {
                kind: "user.birthday",
                key,
                date: today,
                character: None,
                character_id: None,
            });
        }
    }
    let members = characters::active_members(db)?;
    let present = presence::present_ids(
        state,
        &members
            .iter()
            .map(|member| member.id.clone())
            .collect::<Vec<_>>(),
    )?;
    for (slot, member) in characters::SLOTS.into_iter().zip(members) {
        let Some((month, day)) = member
            .definition
            .birthday
            .as_deref()
            .and_then(characters::birthday_parts)
        else {
            continue;
        };
        if !present.contains(&member.id)
            || crate::characters::life::sleeping(state, &member.id)?
            || chrono::NaiveDate::from_ymd_opt(2000, month, day).is_none()
            || !crate::talk::context::birthday_today(today, month, day)
        {
            continue;
        }
        let key = format!("birthday:character:{}:{}", member.id, today.year());
        if pending(&key)? {
            birthdays.push(crate::talk::host::BirthdayTrigger {
                kind: "character.birthday",
                key,
                date: today,
                character: Some(slot.to_ascii_uppercase()),
                character_id: Some(member.id),
            });
        }
    }
    Ok(birthdays)
}

pub(crate) async fn background_generate(
    state: &AppState,
    settings: &Settings,
    prompt: &[ChatMessage],
    schema: serde_json::Value,
    max_tokens: u32,
    cancel: Arc<AtomicBool>,
) -> Result<serde_json::Value, String> {
    if super::quiet_hours::automatic_blocked(state, settings)? {
        return Err("조용한 시간에는 자동 준비를 쉬어요.".into());
    }
    let seconds = if settings.autonomous_enabled {
        (state.next_idle.load(Ordering::SeqCst) - now()).clamp(1, 45)
    } else {
        45
    };
    match tokio::time::timeout(
        Duration::from_secs(seconds as u64),
        inference::generate(
            &state.inference,
            settings,
            prompt,
            schema,
            max_tokens,
            cancel,
        ),
    )
    .await
    {
        Ok(result) => result,
        Err(_) => {
            if settings.mode == "local" {
                inference::stop_local(&state.inference).await;
            }
            Err("정해진 잡담 시간을 위해 새 대사 준비를 다음으로 미뤘어요.".into())
        }
    }
}

pub(crate) fn reserve_api_idle(db: &Connection, at: i64) -> Result<bool, String> {
    let tx = db.unchecked_transaction().map_err(|e| e.to_string())?;
    let raw: Option<String> = tx
        .query_row("SELECT value FROM kv WHERE key='api_idle_times'", [], |r| {
            r.get(0)
        })
        .optional()
        .map_err(|e| e.to_string())?;
    let mut times: Vec<i64> = raw
        .map(|v| serde_json::from_str(&v))
        .transpose()
        .map_err(|e| e.to_string())?
        .unwrap_or_default();
    times.retain(|t| at.saturating_sub(*t) < 3600);
    if times.len() >= 2 {
        return Ok(false);
    }
    times.push(at);
    tx.execute("INSERT INTO kv(key,value) VALUES('api_idle_times',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[serde_json::to_string(&times).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(true)
}

#[cfg(test)]
mod recall_opportunity_tests {
    use super::*;

    #[test]
    fn recent_input_defers_recall_without_claiming_the_daily_opportunity() {
        let state = super::super::tests::state();
        state.last_input.store(100, Ordering::SeqCst);
        state.next_idle.store(105, Ordering::SeqCst);
        assert!(defer_recent_recall(&state, true, 105));
        assert_eq!(state.next_idle.load(Ordering::SeqCst), 115);
        let db = lock(&state.db).unwrap();
        assert!(claim_recall_opportunity(&db).unwrap());
        assert!(!claim_recall_opportunity(&db).unwrap());
        drop(db);
        assert!(!defer_recent_recall(&state, true, 115));
        assert!(!defer_recent_recall(&state, false, 105));
    }
}
