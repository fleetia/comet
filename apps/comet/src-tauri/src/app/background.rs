use super::lifecycle::flush_positions;
use super::presence;
use super::scene::{next_scene, run_scene};
use super::unavailable;
use super::{is_current, lock, now, phase, schedule_idle, tasks, AppState};
use crate::behavior;
use crate::{
    characters, domain, inference, models, resources, store, story,
    types::*,
    widgets::{
        self,
        commands::{advance_widgets, play_widget_reaction},
        connection_host::start_due_widget_refreshes,
        storage,
    },
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

pub(crate) async fn background_loop(
    app: tauri::AppHandle,
    state: Arc<AppState>,
    mut mood_event_cursor: i64,
) {
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
        let _ = crate::widgets::mood::advance(&app, &state, &mut mood_event_cursor);
        if crate::talk::host::play_activity_reaction(&app, &state).unwrap_or(false) {
            continue;
        }
        let _ = crate::diary::runtime::tick(&app, &state);
        if play_mood_reaction(&app, &state).unwrap_or(false) {
            continue;
        }
        if play_moment_reaction(&app, &state).unwrap_or(false) {
            continue;
        }
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
                        if !lock(&worker_state.story).is_ok_and(|story| {
                            story.as_ref().is_some_and(|request| request.epoch == epoch)
                        }) {
                            phase(
                                &worker_app,
                                &worker_state,
                                epoch,
                                RuntimePhase::Idle,
                                None,
                                None,
                            );
                        }
                    }
                },
            );
        }
    }
}

fn play_mood_reaction(app: &tauri::AppHandle, state: &Arc<AppState>) -> Result<bool, String> {
    let pending = {
        let _action = lock(&state.action)?;
        let status = lock(&state.runtime)?.clone();
        let db = lock(&state.db)?;
        let settings = store::settings(&db)?;
        if unavailable(state)
            || status.hidden
            || status.paused
            || !settings.autonomous_enabled
            || storage::focus_active(&db, chrono::Utc::now().timestamp_millis())?
            || super::quiet_hours::automatic_blocked(state, &settings)?
        {
            crate::characters::life::discard_mood_changes(state)?;
            return Ok(false);
        }
        if status.phase != "idle"
            || state.launcher_open.load(Ordering::SeqCst)
            || lock(&state.panel)?.is_some()
            || lock(&state.pack_stories)?.run.is_some()
            || behavior::reactions_blocked(state)?
        {
            return Ok(false);
        }
        let Some(change) = crate::characters::life::pop_mood_change(state)? else {
            return Ok(false);
        };
        if change.epoch != state.epoch.load(Ordering::SeqCst)
            || !characters::active_ids(&db)?.contains(&change.character)
        {
            return Ok(false);
        }
        let previous_epoch = change.epoch;
        let event = crate::widgets::WidgetEvent {
            id: uuid::Uuid::new_v4().to_string(),
            instance_id: String::new(),
            widget_kind: "mood".into(),
            revision: 0,
            created_at: change.at,
            expires_at: change.at.saturating_add(60_000),
            event: crate::widgets::EventDraft {
                kind: "mood.changed".into(),
                text: String::new(),
                payload: serde_json::json!({"character": change.character, "from": change.from, "to": change.to, "source": change.source}),
            },
        };
        match crate::talk::host::prepare(state, &db, Some(&event))? {
            Some(lines) => {
                let prepared = lock(&state.talk_playback)?.take();
                let token = super::interrupt_with_db(state, true, &db)?;
                crate::characters::life::advance_mood_changes_epoch(
                    state,
                    previous_epoch,
                    token.0,
                )?;
                *lock(&state.talk_playback)? = prepared;
                Some((token, lines))
            }
            None => None,
        }
    };
    if let Some((token, lines)) = pending {
        super::scene::start_scene(app.clone(), state.clone(), lines, "talk", token, None);
        return Ok(true);
    }
    Ok(false)
}

fn take_moment_reaction(
    state: &AppState,
    db: &Connection,
    at: i64,
) -> Result<Option<widgets::WidgetEvent>, String> {
    let status = lock(&state.runtime)?.clone();
    let settings = store::settings(db)?;
    if unavailable(state)
        || status.hidden
        || status.paused
        || !settings.autonomous_enabled
        || storage::focus_active(db, at)?
        || super::quiet_hours::automatic_blocked(state, &settings)?
    {
        db.execute("DELETE FROM moment_events", [])
            .map_err(|error| error.to_string())?;
        return Ok(None);
    }
    db.execute(
        "DELETE FROM moment_events WHERE created_at <= ?1 OR created_at < ?2",
        rusqlite::params![
            at.saturating_sub(60_000),
            state.last_input.load(Ordering::SeqCst).saturating_mul(1000)
        ],
    )
    .map_err(|error| error.to_string())?;
    if status.phase != "idle"
        || state.launcher_open.load(Ordering::SeqCst)
        || lock(&state.panel)?.is_some()
        || lock(&state.pack_stories)?.run.is_some()
        || behavior::reactions_blocked(state)?
        || now() - state.last_input.load(Ordering::SeqCst) < 3
    {
        return Ok(None);
    }
    type MomentRow = (
        String,
        String,
        String,
        String,
        i64,
        Option<String>,
        Option<String>,
    );
    let row: Option<MomentRow> = db.query_row(
        "SELECT user_id,source,event,summary,created_at,widget_kind,widget_id FROM moment_events ORDER BY created_at,source LIMIT 1",
        [], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?)),
    ).optional().map_err(|error| error.to_string())?;
    let Some((user_id, source, kind, summary, created_at, widget_kind, widget_id)) = row else {
        return Ok(None);
    };
    let mut query = db.prepare("SELECT memory_id,content_version FROM moment_event_keepers WHERE user_id=?1 AND source=?2")
        .map_err(|error| error.to_string())?;
    let keepers = query
        .query_map(rusqlite::params![user_id, source], |row| {
            Ok(serde_json::json!({"id":row.get::<_, String>(0)?,"version":row.get::<_, i64>(1)?}))
        })
        .map_err(|error| error.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| error.to_string())?;
    drop(query);
    db.execute(
        "DELETE FROM moment_events WHERE user_id=?1 AND source=?2",
        rusqlite::params![user_id, source],
    )
    .map_err(|error| error.to_string())?;
    if store::current_user(db)?
        .as_ref()
        .map(|user| user.id.as_str())
        != Some(user_id.as_str())
    {
        return Ok(None);
    }
    let instance_id = match (&widget_kind, widget_id) {
        (Some(kind), Some(id)) => {
            let Some(widget) = storage::instances(db)?
                .into_iter()
                .find(|widget| widget.kind == *kind && widget.id == id)
            else {
                return Ok(None);
            };
            if !storage::reaction_enabled(db, &widget.id)? {
                return Ok(None);
            }
            widget.id
        }
        (None, None) => String::new(),
        _ => return Ok(None),
    };
    Ok(Some(widgets::WidgetEvent {
        id: uuid::Uuid::new_v4().to_string(),
        instance_id,
        widget_kind: "moment".into(),
        revision: 0,
        created_at,
        expires_at: created_at.saturating_add(60_000),
        event: widgets::EventDraft {
            kind: "moment.added".into(),
            text: String::new(),
            payload: serde_json::json!({"userId":user_id,"momentSource":source,"event":kind,"summary":summary,"memoryRefs":keepers,"widgetKind":widget_kind}),
        },
    }))
}

fn play_moment_reaction(app: &tauri::AppHandle, state: &Arc<AppState>) -> Result<bool, String> {
    let pending = {
        let _action = lock(&state.action)?;
        let db = lock(&state.db)?;
        let Some(event) = take_moment_reaction(state, &db, chrono::Utc::now().timestamp_millis())?
        else {
            return Ok(false);
        };
        match crate::talk::host::prepare(state, &db, Some(&event))? {
            Some(lines) => {
                let prepared = lock(&state.talk_playback)?.take();
                let token = super::interrupt_with_db(state, true, &db)?;
                *lock(&state.talk_playback)? = prepared;
                Some((token, lines))
            }
            None => None,
        }
    };
    if let Some((token, lines)) = pending {
        super::scene::start_scene(app.clone(), state.clone(), lines, "talk", token, None);
        return Ok(true);
    }
    Ok(false)
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
    state: &Arc<AppState>,
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
        return run_idle_scene(app, state, &settings, epoch, cancel).await;
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
            return analyze_pending(app, state, &settings, &pending, revision, epoch, &cancel)
                .await;
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
        let mut prompt = domain::with_user_context(
            domain::roster_scene_prompt(
                &characters,
                &memories,
                &relationships,
                question,
                &installed,
            ),
            store::current_user(&db)?.as_ref(),
        );
        let moods = characters
            .iter()
            .map(|character| {
                Ok((
                    character.id.clone(),
                    crate::characters::life::mood(state, &character.id)?,
                ))
            })
            .collect::<Result<std::collections::BTreeMap<_, _>, String>>()?;
        let small = settings.mode == "apple"
            || (settings.mode == "local" && models::selected_small(&settings));
        domain::with_moods(&mut prompt, &moods, !small, 7200);
        prompt
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
    let result =
        background_generate(state, &settings, &prompt, schema, 512, cancel.clone()).await?;
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

/// The idle line when its time has come: a birthday, anniversary or recall first, then the next
/// prepared scene.
async fn run_idle_scene(
    app: &tauri::AppHandle,
    state: &Arc<AppState>,
    settings: &Settings,
    epoch: u64,
    cancel: Arc<AtomicBool>,
) -> Result<(), String> {
    match begin_first_tutorial(state, epoch, &cancel)? {
        FirstTutorial::Started(run, admitted) => {
            if !admitted.is_empty() {
                if let Err(error) = characters::guests::create_admitted(app, state, &admitted) {
                    let _action = lock(&state.action)?;
                    let db = lock(&state.db)?;
                    super::scene_resume::clear_failed_start(state, &db, &run.run_id, epoch, &error);
                    return Err(error);
                }
            }
            return super::conversation::scene_story::run_automatic(app, state, *run, cancel).await;
        }
        FirstTutorial::Deferred => return Ok(()),
        FirstTutorial::Unavailable => {}
    }
    if super::users::begin_name_prompt(state, epoch, &cancel)? {
        super::publish(app, state);
        return Ok(());
    }
    if offer_scene_resume(state, epoch, &cancel)? {
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
            if selected.is_none() {
                if let Some(anniversary) = due_relationship_anniversary(&db)? {
                    selected = crate::talk::host::prepare_anniversary(state, &db, anniversary)?;
                }
            }
            if selected.is_none() && settings.diary_recall_enabled && claim_recall_opportunity(&db)?
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
    run_scene(
        app,
        state,
        &lines,
        source,
        &uuid::Uuid::new_v4().to_string(),
        false,
        epoch,
        cancel,
    )
    .await
}

enum FirstTutorial {
    Started(Box<crate::pack_stories::RunTicket>, Vec<String>),
    Deferred,
    Unavailable,
}

fn begin_first_tutorial(
    state: &AppState,
    epoch: u64,
    cancel: &AtomicBool,
) -> Result<FirstTutorial, String> {
    let _action = lock(&state.action)?;
    if unavailable(state) || !is_current(state, epoch, cancel) {
        return Ok(FirstTutorial::Unavailable);
    }
    let db = lock(&state.db)?;
    let settings = store::settings(&db)?;
    let status = lock(&state.runtime)?.clone();
    if store::current_user(&db)?.is_some()
        || status.hidden
        || status.paused
        || state.launcher_open.load(Ordering::SeqCst)
        || lock(&state.panel)?.is_some()
        || lock(&state.pack_stories)?.run.is_some()
        || !settings.autonomous_enabled
        || now() < state.next_idle.load(Ordering::SeqCst)
        || super::quiet_hours::automatic_blocked(state, &settings)?
        || storage::focus_active(&db, chrono::Utc::now().timestamp_millis())?
    {
        return Ok(FirstTutorial::Unavailable);
    }
    let user_id = store::active_user_id(&db)?;
    let mut deferred = false;
    for center in presence::present_ids(state, &characters::active_ids(&db)?)? {
        let Some(pack_id) = characters::get(&db, &center)?.pack_id else {
            continue;
        };
        let snapshot = characters::get_pack_story_definition(&db, &pack_id)?;
        let Some(definition) = snapshot.definition.scenarios.iter().find(|definition| {
            definition.purpose == crate::pack_stories::ScenarioPurpose::Tutorial
                && definition.chapters.is_some()
                && snapshot.source_to_local.get(&definition.center_id) == Some(&center)
        }) else {
            continue;
        };
        if characters::life::sleeping(state, &center)? {
            deferred = true;
            continue;
        }
        let scope = crate::pack_stories::Scope {
            user_id: user_id.clone(),
            pack_id,
            center_id: center.clone(),
        };
        let context = crate::pack_stories::InputContext {
            input_id: uuid::Uuid::new_v4().to_string(),
            user_id,
            targets: vec![center],
            epoch,
        };
        let plan = crate::pack_stories::scene_plan(&db, &context, scope, definition.clone(), None)?;
        let admitted = super::conversation::bind_pack_plan_locked(state, &db, &plan, epoch)?;
        let run = lock(&state.pack_stories)?
            .run
            .clone()
            .ok_or("이야기 실행을 시작하지 못했어요.")?;
        schedule_idle(state, settings.idle_minutes);
        state.last_scene.store(now(), Ordering::SeqCst);
        return Ok(FirstTutorial::Started(Box::new(run), admitted));
    }
    if deferred {
        schedule_idle(state, settings.idle_minutes);
        Ok(FirstTutorial::Deferred)
    } else {
        Ok(FirstTutorial::Unavailable)
    }
}

fn offer_scene_resume(state: &AppState, epoch: u64, cancel: &AtomicBool) -> Result<bool, String> {
    let _action = lock(&state.action)?;
    if !is_current(state, epoch, cancel) || lock(&state.pack_stories)?.resume_offered {
        return Ok(false);
    }
    let db = lock(&state.db)?;
    let Some(user) = store::current_user(&db)? else {
        return Ok(false);
    };
    let residents = characters::active_ids(&db)?;
    let present = presence::present_ids(state, &residents)?;
    for center_id in present {
        if characters::life::sleeping(state, &center_id)? {
            continue;
        }
        let Some(pack_id) = characters::get(&db, &center_id)?.pack_id else {
            continue;
        };
        let scope = crate::pack_stories::Scope {
            user_id: user.id.clone(),
            pack_id,
            center_id: center_id.clone(),
        };
        for point in crate::pack_stories::resume::load_for_scope(&db, &scope)? {
            if crate::pack_stories::resume::resolve(&db, &scope, &point)?.is_none() {
                continue;
            }
            let request_id = format!("scene-resume:{}", uuid::Uuid::new_v4());
            let title = "이어서 하기".to_string();
            let prompt = "아까 둘러보던 거, 이어서 할래?".to_string();
            let choices = vec![
                story::Choice {
                    id: "resume".into(),
                    label: "이어서 하기".into(),
                },
                story::Choice {
                    id: "decline".into(),
                    label: "그만할래".into(),
                },
            ];
            let request = story::Request {
                id: request_id.clone(),
                display_started_at: None,
                persona: center_id.clone(),
                title: title.clone(),
                prompt: prompt.clone(),
                choices,
                expression: Some("호기심".into()),
                motion: None,
                character_id: center_id.clone(),
                user_id: user.id,
                scene: story::Scene {
                    id: request_id.clone(),
                    chapter: 0,
                    title,
                    prompt,
                    choices: vec![],
                },
                epoch,
            };
            let mut runtime = lock(&state.pack_stories)?;
            runtime.resume_offered = true;
            runtime.pending_resume = Some((request_id, scope, point));
            drop(runtime);
            *lock(&state.story)? = Some(request);
            schedule_idle(state, store::settings(&db)?.idle_minutes);
            state.last_scene.store(now(), Ordering::SeqCst);
            let mut status = lock(&state.runtime)?;
            status.phase = RuntimePhase::Story;
            status.persona = Some(center_id);
            status.error = None;
            return Ok(true);
        }
    }
    Ok(false)
}

/// Sends pending user messages for memory analysis and applies the result if nothing changed meanwhile.
async fn analyze_pending(
    app: &tauri::AppHandle,
    state: &AppState,
    settings: &Settings,
    pending: &[Message],
    revision: i64,
    epoch: u64,
    cancel: &Arc<AtomicBool>,
) -> Result<(), String> {
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
            pending,
            &store::analysis_memories(&db, pending)?,
            revision,
            &store::completed_conversation_sources(&db, pending)?,
        )
    };
    {
        let _action = lock(&state.action)?;
        let db = lock(&state.db)?;
        if !is_current(state, epoch, cancel)
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
        settings,
        &prompt,
        domain::analysis_schema(),
        768,
        cancel.clone(),
    )
    .await;
    let _action = lock(&state.action)?;
    let db = lock(&state.db)?;
    if !is_current(state, epoch, cancel)
        || super::quiet_hours::automatic_blocked(state, &store::settings(&db)?)?
        || store::revision(&db)? != batch.revision
    {
        return Ok(());
    }
    match result {
        Ok(value) => {
            if let Err(error) = store::analyze_apply_batch(&db, &value, &batch.submitted_ids) {
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
    Ok(())
}

fn due_relationship_anniversary(
    db: &Connection,
) -> Result<Option<crate::talk::host::AnniversaryTrigger>, String> {
    let Some(user) = store::current_user(db)? else {
        return Ok(None);
    };
    let Some(start) = chrono::DateTime::from_timestamp_millis(user.started_at) else {
        return Ok(None);
    };
    let start = start.with_timezone(&chrono::Local).date_naive();
    let today = chrono::Local::now().date_naive();
    if today.year() <= start.year()
        || !crate::talk::context::birthday_today(today, start.month(), start.day())
    {
        return Ok(None);
    }
    let key = format!("relationship:anniversary:{}:{}", user.id, today.year());
    let displayed: bool = db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM kv WHERE key=?1)",
            [&key],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if displayed {
        return Ok(None);
    }
    Ok(Some(crate::talk::host::AnniversaryTrigger {
        user_id: user.id,
        date: today,
        key,
    }))
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

    fn install_first_tutorial(state: &AppState) {
        let db = lock(&state.db).unwrap();
        let mut pack = characters::factory_pack();
        let center = pack.characters[0].source_id.clone();
        pack.format_version = 14;
        pack.scenarios = vec![serde_json::from_value(serde_json::json!({
            "id":"tutorial", "title":"안내", "purpose":"tutorial", "centerId":center,
            "participants":[center], "chapters":[{"id":"first", "title":"첫 장", "steps":[
                {"kind":"line", "persona":center, "expression":"평온", "text":"안녕"}
            ]}]
        }))
        .unwrap()];
        let installed = characters::import_pack(&db, &pack).unwrap();
        characters::apply_roster(&db, vec![installed[0].id.clone()]).unwrap();
    }

    #[test]
    fn first_tutorial_starts_once_and_restarts_from_first_chapter_after_interrupt() {
        let state = super::super::tests::state();
        install_first_tutorial(&state);
        let cancel = AtomicBool::new(false);
        let FirstTutorial::Started(first, _) = begin_first_tutorial(&state, 0, &cancel).unwrap()
        else {
            panic!("튜토리얼이 시작되어야 해요");
        };
        assert_eq!(first.chapter_id.as_deref(), Some("first"));
        assert!(matches!(
            begin_first_tutorial(&state, 0, &cancel).unwrap(),
            FirstTutorial::Unavailable
        ));
        {
            let db = lock(&state.db).unwrap();
            crate::pack_stories::cancel_with_progress(&db, &mut lock(&state.pack_stories).unwrap())
                .unwrap();
            assert_eq!(
                db.query_row("SELECT COUNT(*) FROM pack_story_outcomes", [], |row| row
                    .get::<_, i64>(0))
                    .unwrap(),
                0
            );
            assert_eq!(
                db.query_row("SELECT COUNT(*) FROM pack_story_resume", [], |row| row
                    .get::<_, i64>(0))
                    .unwrap(),
                0
            );
        }
        state.next_idle.store(0, Ordering::SeqCst);
        let FirstTutorial::Started(second, _) = begin_first_tutorial(&state, 0, &cancel).unwrap()
        else {
            panic!("튜토리얼이 다시 시작되어야 해요");
        };
        assert_ne!(first.run_id, second.run_id);
        assert_eq!(second.chapter_id.as_deref(), Some("first"));
        assert_eq!(second.step, 0);
    }

    #[test]
    fn pack_without_tutorial_keeps_legacy_name_prompt() {
        let state = super::super::tests::state();
        {
            let db = lock(&state.db).unwrap();
            let mut pack = characters::factory_pack();
            pack.scenarios.clear();
            let installed = characters::import_pack(&db, &pack).unwrap();
            characters::apply_roster(&db, vec![installed[0].id.clone()]).unwrap();
        }
        let cancel = AtomicBool::new(false);
        assert!(matches!(
            begin_first_tutorial(&state, 0, &cancel).unwrap(),
            FirstTutorial::Unavailable
        ));
        assert!(super::super::users::begin_name_prompt(&state, 0, &cancel).unwrap());
        assert_eq!(lock(&state.panel).unwrap().as_ref().unwrap().mode, "name");
    }

    #[test]
    fn first_tutorial_waits_for_sleeping_character_instead_of_falling_back_to_name_prompt() {
        let state = super::super::tests::state();
        install_first_tutorial(&state);
        let center = characters::active_ids(&lock(&state.db).unwrap())
            .unwrap()
            .remove(0);
        characters::life::set_sleep(&state, &center, true).unwrap();
        let cancel = AtomicBool::new(false);
        assert!(matches!(
            begin_first_tutorial(&state, 0, &cancel).unwrap(),
            FirstTutorial::Deferred
        ));
        assert!(lock(&state.panel).unwrap().is_none());
        characters::life::set_sleep(&state, &center, false).unwrap();
        state.next_idle.store(0, Ordering::SeqCst);
        assert!(matches!(
            begin_first_tutorial(&state, 0, &cancel).unwrap(),
            FirstTutorial::Started(_, _)
        ));
    }

    #[test]
    fn scene_resume_is_offered_only_once_per_runtime() {
        let state = super::super::tests::state();
        {
            let db = lock(&state.db).unwrap();
            store::set_user_name(&db, "친구", 1000).unwrap();
            let mut pack = characters::factory_pack();
            let center = pack.characters[0].source_id.clone();
            pack.format_version = 14;
            pack.scenarios = vec![serde_json::from_value(serde_json::json!({
                "id":"tutorial", "title":"안내", "purpose":"tutorial", "centerId":center,
                "participants":[center], "chapters":[{"id":"first", "title":"첫 장", "steps":[
                    {"kind":"line", "persona":center, "expression":"평온", "text":"안녕"}
                ]}]
            }))
            .unwrap()];
            let installed = characters::import_pack(&db, &pack).unwrap();
            characters::apply_roster(&db, vec![installed[0].id.clone()]).unwrap();
            let pack_id = installed[0].pack_id.as_ref().unwrap();
            let scope = crate::pack_stories::Scope {
                user_id: store::active_user_id(&db).unwrap(),
                pack_id: pack_id.clone(),
                center_id: installed[0].id.clone(),
            };
            let key = serde_json::to_string(&scope).unwrap();
            let baseline = characters::pack_definition_baseline(&db, pack_id).unwrap();
            db.execute(
                "INSERT INTO pack_story_outcomes VALUES('run','accepted',?1,'tutorial','input',?2)",
                rusqlite::params![key, "\"tutorial\""],
            )
            .unwrap();
            db.execute(
                "INSERT INTO pack_story_resume VALUES(?1,'tutorial','first','run',?2,1000)",
                rusqlite::params![key, baseline],
            )
            .unwrap();
        }
        let cancel = AtomicBool::new(false);
        assert!(offer_scene_resume(&state, 0, &cancel).unwrap());
        assert_eq!(
            lock(&state.story).unwrap().as_ref().unwrap().prompt,
            "아까 둘러보던 거, 이어서 할래?"
        );
        *lock(&state.story).unwrap() = None;
        assert!(!offer_scene_resume(&state, 0, &cancel).unwrap());
        assert_eq!(
            lock(&state.db)
                .unwrap()
                .query_row("SELECT COUNT(*) FROM pack_story_resume", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }

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

#[cfg(test)]
mod moment_event_tests {
    use super::*;

    #[test]
    fn pending_moment_keeps_its_keepers_and_obeys_widget_and_automatic_gates() {
        let state = super::super::tests::state();
        let db = lock(&state.db).unwrap();
        let at = chrono::Utc::now().timestamp_millis();
        store::set_user_name(&db, "친구", at).unwrap();
        let user = store::current_user(&db).unwrap().unwrap();
        let actors = characters::active_ids(&db).unwrap();
        let plant = storage::instances(&db)
            .unwrap()
            .into_iter()
            .find(|widget| widget.kind == "plant")
            .unwrap();
        for actor in &actors {
            store::insert_moment(
                &db,
                actor,
                &user.id,
                "bloom",
                "꽃이 핀 날",
                at,
                None,
                serde_json::json!({}),
                Some("plant"),
                Some(&plant.id),
            )
            .unwrap();
        }
        let event = take_moment_reaction(&state, &db, at).unwrap().unwrap();
        assert_eq!(event.event.kind, "moment.added");
        assert_eq!(event.event.payload["event"], "bloom");
        assert_eq!(event.event.payload["summary"], "꽃이 핀 날");
        assert_eq!(
            event.event.payload["memoryRefs"].as_array().unwrap().len(),
            actors.len()
        );
        assert!(take_moment_reaction(&state, &db, at).unwrap().is_none());
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM moment_event_keepers", [], |row| row
                .get::<_, i64>(
                0
            ))
            .unwrap(),
            0
        );

        storage::set_reaction(&db, &plant.id, false).unwrap();
        store::insert_moment(
            &db,
            &actors[0],
            &user.id,
            "first-catch",
            "처음 잡은 물고기",
            at,
            None,
            serde_json::json!({}),
            Some("plant"),
            Some(&plant.id),
        )
        .unwrap();
        assert!(take_moment_reaction(&state, &db, at).unwrap().is_none());
        assert_eq!(
            db.query_row(
                "SELECT COUNT(*) FROM memories WHERE source LIKE 'moment:first-catch:%'",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
            1
        );

        store::insert_moment(
            &db,
            &actors[0],
            &user.id,
            "focus-day",
            "집중한 날",
            at,
            None,
            serde_json::json!({}),
            None,
            None,
        )
        .unwrap();
        lock(&state.runtime).unwrap().hidden = true;
        assert!(take_moment_reaction(&state, &db, at).unwrap().is_none());
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM moment_events", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn manual_interruption_discards_pending_reaction_without_deleting_the_memory() {
        let state = super::super::tests::state();
        let db = lock(&state.db).unwrap();
        let at = chrono::Utc::now().timestamp_millis();
        store::set_user_name(&db, "친구", at).unwrap();
        let user = store::current_user(&db).unwrap().unwrap();
        let actor = characters::active_ids(&db).unwrap().remove(0);
        store::insert_moment(
            &db,
            &actor,
            &user.id,
            "bloom",
            "꽃이 핀 날",
            at,
            None,
            serde_json::json!({}),
            None,
            None,
        )
        .unwrap();
        super::super::interrupt_with_db(&state, false, &db).unwrap();
        assert!(take_moment_reaction(&state, &db, at).unwrap().is_none());
        assert_eq!(
            db.query_row(
                "SELECT COUNT(*) FROM memories WHERE source LIKE 'moment:bloom:%'",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
            1
        );
    }
}
