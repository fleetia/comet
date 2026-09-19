use super::lifecycle::flush_positions;
use super::scene::{next_scene, run_scene};
use super::unavailable;
use super::{interrupt, is_current, lock, now, phase, schedule_idle, AppState};
use crate::behavior;
use crate::{
    characters, domain, inference, models, resources, store, story,
    types::*,
    widget_commands::{advance_widgets, play_widget_reaction},
    widget_connections::start_due_widget_refreshes,
};
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
        let _ = behavior::tick(&app, &state);
        let _ = flush_positions(&state, false);
        let _ = advance_widgets(&app, &state);
        start_due_widget_refreshes(&app, &state);
        let Ok(status) = lock(&state.runtime).map(|runtime| runtime.clone()) else {
            continue;
        };
        if !["idle", "error"].contains(&status.phase.as_str()) {
            continue;
        }
        if lock(&state.behavior)
            .map(|machine| {
                matches!(
                    machine.phase,
                    behavior::Phase::Playing | behavior::Phase::Suspended
                )
            })
            .unwrap_or(true)
        {
            continue;
        }
        if play_widget_reaction(&app, &state).unwrap_or(false) {
            continue;
        }
        let Ok(_guard) = state.gate.try_lock() else {
            continue;
        };
        let _ = expire_idle_recall(&state, chrono::Utc::now().timestamp_millis());
        if now() - state.last_foreground.load(Ordering::SeqCst) >= 120 {
            inference::stop_local(&state.inference).await;
        }
        if let Ok(Some((epoch, cancel))) = begin_background(&state) {
            let result = run_background(&app, &state, epoch, cancel.clone()).await;
            if is_current(&state, epoch, &cancel) {
                if let Err(error) = result {
                    eprintln!("Automatic preparation deferred: {error}");
                }
                phase(&app, &state, epoch, "idle", None, None);
            }
        }
    }
}

pub(crate) fn expire_idle_recall(state: &AppState, at: i64) -> Result<bool, String> {
    let _action = lock(&state.action)?;
    if unavailable(state) || !["idle", "error"].contains(&lock(&state.runtime)?.phase.as_str()) {
        return Ok(false);
    }
    store::expire_generated_recall(&*lock(&state.db)?, at)
}

pub(crate) fn begin_background(state: &AppState) -> Result<Option<(u64, Arc<AtomicBool>)>, String> {
    let _action = lock(&state.action)?;
    let status = lock(&state.runtime)?.clone();
    if unavailable(state) || status.hidden || status.paused || lock(&state.panel)?.is_some() {
        return Ok(None);
    }
    let settings = store::settings(&*lock(&state.db)?)?;
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
    Ok(Some(interrupt(state, true)?))
}

pub(crate) async fn run_background(
    app: &tauri::AppHandle,
    state: &AppState,
    epoch: u64,
    cancel: Arc<AtomicBool>,
) -> Result<(), String> {
    let (settings, pending, memories, relationships, revision, scenes, characters) = {
        let db = lock(&state.db)?;
        (
            store::settings(&db)?,
            store::pending_user_messages(&db)?
                .into_iter()
                .take(8)
                .collect::<Vec<_>>(),
            store::memories(&db)?,
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
        )
    };
    if settings.autonomous_enabled && now() >= state.next_idle.load(Ordering::SeqCst) {
        let (lines, source) = {
            let _action = lock(&state.action)?;
            if !is_current(state, epoch, &cancel) {
                return Ok(());
            }
            schedule_idle(state, settings.idle_minutes);
            state.last_scene.store(now(), Ordering::SeqCst);
            next_scene(state)?
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
        } else {
            inference::has_api_key(&settings) && !settings.api_model.is_empty()
        };
        if ready && now() - state.last_preparation.load(Ordering::SeqCst) >= 15 {
            state.last_preparation.store(now(), Ordering::SeqCst);
            phase(app, state, epoch, "analyzing", None, None);
            let mut prompt = domain::analysis_prompt(&pending, &memories, revision);
            let targets = {
                let db = lock(&state.db)?;
                pending.iter().map(|message| Ok(serde_json::json!({"messageId":message.id,"targets":store::message_targets(&db,&message.id)?}))).collect::<Result<Vec<_>,String>>()?
            };
            prompt.push(ChatMessage {
                role: "user".into(),
                content: serde_json::json!({"recordedTargets":targets}).to_string(),
            });
            let result = background_generate(
                state,
                &settings,
                &prompt,
                domain::analysis_schema(),
                768,
                cancel.clone(),
            )
            .await?;
            let _action = lock(&state.action)?;
            let db = lock(&state.db)?;
            if !is_current(state, epoch, &cancel) || store::revision(&db)? != revision {
                return Ok(());
            }
            store::analyze_apply(&db, &result)?;
            if let Some(last) = pending.last() {
                store::set_last_analysis_id(&db, &last.id)?;
            }
            return Ok(());
        }
    }
    let generate_enabled = if settings.mode == "api" {
        settings.api_idle_enabled
    } else {
        settings.local_idle_enabled
    };
    if !settings.autonomous_enabled
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
    } else {
        !settings.api_model.is_empty() && inference::has_api_key(&settings)
    };
    if !ready {
        return Ok(());
    }
    let targets: Vec<String> = characters.iter().map(|member| member.id.clone()).collect();
    if targets.is_empty() {
        return Ok(());
    }
    let question = targets.len() == 1 && state.idle_sequence.load(Ordering::SeqCst) % 2 == 1;
    state.last_preparation.store(now(), Ordering::SeqCst);
    if settings.mode == "local" && !resources::background_allowed() {
        return Ok(());
    }
    if settings.mode == "api" {
        let _action = lock(&state.action)?;
        if !is_current(state, epoch, &cancel) || !reserve_api_idle(&*lock(&state.db)?, now())? {
            return Ok(());
        }
    }
    phase(app, state, epoch, "preparing", None, None);
    let result = background_generate(
        state,
        &settings,
        &domain::roster_scene_prompt(&characters, &memories, &relationships, question),
        domain::scene_schema_for(
            &targets,
            if targets.len() == 1 { 1 } else { 2 },
            if targets.len() == 1 { 1 } else { 4 },
        ),
        512,
        cancel.clone(),
    )
    .await?;
    let lines = domain::parse_lines_for(
        result,
        &targets,
        if targets.len() == 1 { 1 } else { 2 },
        if targets.len() == 1 { 1 } else { 4 },
        false,
    )?;
    let _action = lock(&state.action)?;
    let db = lock(&state.db)?;
    if !is_current(state, epoch, &cancel) || store::revision(&db)? != revision {
        return Ok(());
    }
    store::add_scene(
        &db,
        &PreparedScene {
            id: format!(
                "{}{}",
                if question { "question:" } else { "" },
                uuid::Uuid::new_v4()
            ),
            revision,
            lines,
        },
    )?;
    Ok(())
}

pub(crate) async fn background_generate(
    state: &AppState,
    settings: &Settings,
    prompt: &[ChatMessage],
    schema: serde_json::Value,
    max_tokens: u32,
    cancel: Arc<AtomicBool>,
) -> Result<serde_json::Value, String> {
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
