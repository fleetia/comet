use super::presence;
use super::{is_current, lock, phase, publish, AppState};
use crate::{characters, models, playback, store, talk, types::*, widgets, wordbook};
use rusqlite::Connection;
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

fn playback_link(
    db: &Connection,
    state: &AppState,
    source: &str,
    id: &str,
    line: &SceneLine,
) -> Result<Option<PlaybackLink>, String> {
    if source == "diary" {
        let mut statement = db
            .prepare("SELECT key FROM diary_deliveries WHERE message_id=?1")
            .map_err(|error| error.to_string())?;
        let keys = statement
            .query_map([id], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        let [key] = keys.as_slice() else {
            return Ok(None);
        };
        let mut parts = key.split(':');
        let (Some(kind), Some(target)) = (parts.next(), parts.next()) else {
            return Ok(None);
        };
        if kind == "habit-reminder" {
            return Ok(Some(PlaybackLink {
                instance_id: "diary".into(),
                kind: "habit".into(),
                label: "습관".into(),
                item: Some(PlaybackLinkItem {
                    entity: "habit".into(),
                    id: target.into(),
                }),
            }));
        }
        if kind.starts_with("travel-") {
            let diary =
                serde_json::to_value(crate::diary::read(db)?).map_err(|error| error.to_string())?;
            let travel_id = if kind == "travel-photos" {
                Some(target.to_string())
            } else {
                ["travelBookings", "travelPlans"]
                    .iter()
                    .flat_map(|field| diary[*field].as_array().into_iter().flatten())
                    .find(|entry| entry["id"] == target)
                    .and_then(|entry| entry["travelId"].as_str())
                    .map(str::to_owned)
            };
            if let Some(id) = travel_id {
                return Ok(Some(PlaybackLink {
                    instance_id: "diary".into(),
                    kind: "travel".into(),
                    label: "여행".into(),
                    item: Some(PlaybackLinkItem {
                        entity: "travel".into(),
                        id,
                    }),
                }));
            }
        }
        return Ok(None);
    }
    let event = if matches!(source, "widget" | "reaction" | "talk") {
        let event = lock(&state.widget_playback)?.clone();
        if source == "talk" {
            let talk_event = lock(&state.talk_playback)?.as_ref().and_then(|talk| talk.event.clone());
            event.filter(|event| talk_event.as_ref().is_some_and(|talk| talk.id == event.id))
        } else {
            event
        }
    } else {
        None
    };
    let kind = if let Some(event) = &event {
        Some(event.widget_kind.clone())
    } else if source == "talk" {
        lock(&state.talk_playback)?.as_ref().and_then(|talk| {
            (talk.selection.dependencies.len() == 1)
                .then(|| talk.selection.dependencies.iter().next().cloned())
                .flatten()
        })
    } else if matches!(source, "llm" | "question") {
        line.widget.clone()
    } else {
        None
    };
    let Some(kind) = kind else { return Ok(None) };
    let instances = widgets::storage::instances(db)?;
    let instance = instances.iter().find(|instance| {
        event.as_ref().map_or(instance.kind == kind, |event| {
            instance.id == event.instance_id
        })
    });
    let (instance_id, kind, label) = if let Some(instance) = instance {
        if widgets::is_retired(&instance.kind) {
            return Ok(None);
        }
        (
            instance.id.clone(),
            instance.kind.clone(),
            widgets::manifest(&instance.kind)?.name,
        )
    } else {
        let id = event
            .as_ref()
            .map_or(kind.as_str(), |event| event.instance_id.as_str());
        let Some(widget) = widgets::generated::list(db)?
            .into_iter()
            .find(|widget| widget.id == id && widget.installed)
        else {
            return Ok(None);
        };
        (widget.id.clone(), widget.id, widget.definition.name)
    };
    let item = event.as_ref().and_then(|event| {
        let payload = &event.event.payload;
        let (entity, id) = match event.event.kind.as_str() {
            "calendar-reminder" => ("event", payload["eventId"].as_str()?),
            "todo-completed" => ("todo", payload["itemId"].as_str()?),
            "planner-mood" => ("today", ""),
            "planner-reminder" => {
                let targets = payload["targets"].as_array()?;
                if targets.len() != 1 {
                    ("today", "")
                } else {
                    let target = &targets[0];
                    match target["kind"].as_str()? {
                        "calendar" => ("event", target["id"].as_str()?),
                        "focus-event" => ("event", target["eventId"].as_str()?),
                        "todo" => ("todo", target["id"].as_str()?),
                        "preparation" => ("envelope", target["id"].as_str()?),
                        _ => return None,
                    }
                }
            }
            _ => return None,
        };
        Some(PlaybackLinkItem {
            entity: entity.into(),
            id: id.into(),
        })
    });
    Ok(Some(PlaybackLink {
        instance_id,
        kind,
        label,
        item,
    }))
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn present_line(
    state: &AppState,
    line: &SceneLine,
    source: &str,
    id: &str,
    line_index: usize,
    line_count: usize,
    revision: i64,
    epoch: u64,
    cancel: &AtomicBool,
    direct_reply: bool,
) -> Result<bool, String> {
    let _action = lock(&state.action)?;
    let db = lock(&state.db)?;
    if !is_current(state, epoch, cancel)
        || (source == "diary" && !crate::diary::runtime::playback_current(state, &db, id)?)
        || (crate::widgets::storage::focus_active(&db, chrono::Utc::now().timestamp_millis())?
            && !(source == "widget"
                && lock(&state.widget_playback)?
                    .as_ref()
                    .is_some_and(widgets::commands::focus_transition)))
        || super::quiet_hours::playback_blocked(
            state,
            &store::settings(&db)?,
            lock(&state.runtime)?.paused,
        )?
        || (!matches!(source, "scenario" | "npc") && store::revision(&db)? != revision)
    {
        return Ok(false);
    }
    let saved = if direct_reply {
        if if matches!(source, "scenario" | "npc") {
            store::message_finished(&db, id)?
        } else {
            store::message_displayed(&db, id)?
        } {
            return Ok(false);
        }
        let allowed = crate::characters::guests::display_ids(state, &db)?;
        store::saved_reply_for_participants(&db, id, Some(&allowed))?
    } else {
        None
    };
    let (line, source) = saved
        .as_ref()
        .map_or((line, source), |(line, source)| (line, source.as_str()));
    if matches!(source, "llm" | "question")
        && !store::recall_valid(&db, id, chrono::Utc::now().timestamp_millis())?
    {
        return Ok(false);
    }
    let ticket = lock(&state.tasks)?.participants.clone();
    let resolved = if let Some(ticket) = &ticket {
        crate::characters::guests::resolve_lines(state, &db, ticket, std::slice::from_ref(line))?
    } else {
        characters::resolve_lines(&db, std::slice::from_ref(line))?
    };
    let line = &resolved[0];
    lock(&state.reactions)?.clear_ambient(&line.persona);
    if crate::characters::life::sleeping(state, &line.persona)? {
        if state.automatic.load(Ordering::SeqCst) {
            return Ok(false);
        }
        crate::characters::life::wake(state, &line.persona)?;
    }
    let actor = if let Some(ticket) = &ticket {
        crate::characters::guests::resolve_actor(state, &db, ticket, &line.persona)?
    } else {
        characters::active_character(&db, &line.persona)?
    };
    let resident = actor.definition.presence_role == crate::pack_stories::PresenceRole::Resident;
    if source != "presence" && !crate::characters::guests::is_present(state, &db, &line.persona)? {
        if state.automatic.load(Ordering::SeqCst) {
            return Ok(false);
        }
        if !resident {
            return Err("등록 대사의 NPC가 지금 참가하지 않고 있어요.".into());
        }
        presence::summon_locked(state, &line.persona)?;
    }
    let text_speed = actor.definition.balloon_style.text_speed;
    if (source == "widget" || (source == "reaction" && lock(&state.widget_playback)?.is_some()))
        && !widgets::commands::widget_event_current(state, &db)?
    {
        return Ok(false);
    }
    if source == "talk" && !talk::host::current(state, &db)? {
        return Ok(false);
    }
    if matches!(source, "scenario" | "npc") {
        let replay = lock(&state.tasks)?
            .pack_replay
            .as_ref()
            .is_some_and(|input| id.starts_with(&format!("scene:{input}:")));
        if !replay {
            let run = lock(&state.pack_stories)?
                .run
                .clone()
                .ok_or("이야기 실행이 끝났어요.")?;
            if run.epoch != epoch || !crate::pack_stories::current(&db, &run)? {
                return Ok(false);
            }
        }
    }
    let scene_key = if source == "talk" && line_index == 0 {
        lock(&state.talk_playback)?
            .as_ref()
            .map(|prepared| prepared.selection.key.clone())
    } else {
        None
    };
    let link = playback_link(&db, state, source, id, line)?;
    let message = Message {
        id: id.into(),
        role: "assistant".into(),
        persona: Some(line.persona.clone()),
        content: line.text.clone(),
        expression: Some(line.expression.clone()),
        created_at: chrono::Utc::now().timestamp_millis(),
        status: "complete".into(),
    };
    if ticket.is_some() {
        store::insert_message_with_actor(&db, &message, source, direct_reply, line, &actor)?;
    } else {
        store::insert_message_with_playback(
            &db,
            &message,
            source,
            scene_key.as_deref(),
            direct_reply,
            Some(line),
        )?;
    }
    if let Some(link) = &link {
        let value = serde_json::to_string(link).map_err(|error| error.to_string())?;
        db.execute(
            "UPDATE messages SET data=json_set(data,'$.link',json(?2)) WHERE id=?1",
            rusqlite::params![id, value],
        )
        .map_err(|error| error.to_string())?;
    }
    *lock(&state.playback)? = Some(Playback {
        id: id.into(),
        persona: line.persona.clone(),
        expression: line.expression.clone(),
        text: line.text.clone(),
        motion: line.motion.clone(),
        source: source.into(),
        link,
        text_speed,
        display_started_at: None,
        ends_at: 0,
        line_index,
        line_count,
    });
    if direct_reply {
        if let Some(panel) = lock(&state.panel)?
            .as_mut()
            .filter(|panel| matches!(panel.mode.as_str(), "input" | "history-input"))
        {
            panel.persona.clone_from(&line.persona);
        }
    }
    let mut runtime = lock(&state.runtime)?;
    runtime.phase = crate::types::RuntimePhase::Playing;
    runtime.persona = Some(line.persona.clone());
    runtime.error = None;
    Ok(true)
}

pub(crate) fn mark_line_displayed(line: &mut Playback, now: i64) -> bool {
    if line.display_started_at.is_some() {
        return false;
    }
    line.display_started_at = Some(now);
    line.ends_at = now + playback::line_duration_millis(&line.text, line.text_speed);
    true
}

#[derive(Debug, Clone)]
pub(crate) struct LineCompletion {
    pub playback: Playback,
    pub finished_at: i64,
}

pub(crate) fn line_completion_locked(
    state: &AppState,
    expected: &Playback,
    epoch: u64,
    cancel: &AtomicBool,
    now: i64,
) -> Result<Option<LineCompletion>, String> {
    if !is_current(state, epoch, cancel) {
        return Ok(None);
    }
    let db = lock(&state.db)?;
    let status = lock(&state.runtime)?.clone();
    if status.hidden
        || super::unavailable(state)
        || crate::widgets::storage::focus_active(&db, now)?
    {
        return Ok(None);
    }
    if let Some(ticket) = lock(&state.tasks)?.participants.clone() {
        if ticket.epoch != epoch
            || crate::characters::guests::validate(state, &db, &ticket).is_err()
        {
            return Ok(None);
        }
    }
    if matches!(expected.source.as_str(), "scenario" | "npc") {
        let Some(run) = lock(&state.pack_stories)?.run.clone() else {
            return Ok(None);
        };
        if run.epoch != epoch
            || !crate::pack_stories::current(&db, &run)?
            || lock(&state.tasks)?.participants.is_none()
        {
            return Ok(None);
        }
    }
    let current = lock(&state.playback)?;
    let Some(line) = current.as_ref().filter(|line| {
        line.id == expected.id
            && line.line_index == expected.line_index
            && line.line_count == expected.line_count
            && line.source == expected.source
            && line.display_started_at == expected.display_started_at
            && line.ends_at == expected.ends_at
    }) else {
        return Ok(None);
    };
    if line.display_started_at.is_none() || now < line.ends_at {
        return Ok(None);
    }
    Ok(Some(LineCompletion {
        playback: line.clone(),
        finished_at: now,
    }))
}

pub(crate) async fn wait_for_completed_line(
    state: &AppState,
    epoch: u64,
    cancel: Arc<AtomicBool>,
) -> Result<Option<LineCompletion>, String> {
    let Some(line) = wait_for_displayed_line(state, epoch, cancel.clone()).await? else {
        return Ok(None);
    };
    if !wait_for_valid_line(state, &line, line.ends_at, epoch, cancel.clone()).await? {
        return Ok(None);
    }
    let _action = lock(&state.action)?;
    line_completion_locked(
        state,
        &line,
        epoch,
        &cancel,
        chrono::Utc::now().timestamp_millis(),
    )
}

pub(crate) async fn wait_for_displayed_line(
    state: &AppState,
    epoch: u64,
    cancel: Arc<AtomicBool>,
) -> Result<Option<Playback>, String> {
    wait_for_displayed_line_until(
        state,
        epoch,
        cancel,
        tokio::time::Instant::now() + Duration::from_secs(30),
    )
    .await
}

fn missing_display_line(state: &AppState) -> Result<Option<Playback>, String> {
    let runtime = lock(&state.runtime)?;
    if matches!(runtime.phase, crate::types::RuntimePhase::Error) {
        if let Some(error) = &runtime.error {
            return Err(error.clone());
        }
    }
    Ok(None)
}

async fn wait_for_displayed_line_until(
    state: &AppState,
    epoch: u64,
    cancel: Arc<AtomicBool>,
    deadline: tokio::time::Instant,
) -> Result<Option<Playback>, String> {
    let line_id = {
        let _action = lock(&state.action)?;
        if !is_current(state, epoch, &cancel) {
            return Ok(None);
        }
        let playback = lock(&state.playback)?;
        let Some(line) = playback.as_ref() else {
            drop(playback);
            return missing_display_line(state);
        };
        line.id.clone()
    };
    loop {
        let displayed = {
            let _action = lock(&state.action)?;
            if !is_current(state, epoch, &cancel) {
                return Ok(None);
            }
            let mut playback = lock(&state.playback)?;
            let Some(line) = playback.as_ref().filter(|line| line.id == line_id) else {
                drop(playback);
                return missing_display_line(state);
            };
            if line.display_started_at.is_some() {
                Some(line.clone())
            } else if tokio::time::Instant::now() >= deadline {
                *playback = None;
                return Err(
                    "말풍선 표시 준비가 30초 안에 끝나지 않았어요. 다시 시도해 주세요.".into(),
                );
            } else {
                None
            }
        };
        if let Some(displayed) = displayed {
            return Ok(Some(displayed));
        }
        tokio::select! {
            _ = models::cancelled(cancel.clone()) => return Ok(None),
            _ = tokio::time::sleep(Duration::from_millis(20)) => {}
            _ = tokio::time::sleep_until(deadline) => {}
        }
    }
}

pub(crate) async fn wait_for_line(
    app: &tauri::AppHandle,
    state: &AppState,
    epoch: u64,
    cancel: Arc<AtomicBool>,
) -> Result<(), String> {
    let Some(line) = wait_for_displayed_line(state, epoch, cancel.clone()).await? else {
        return Ok(());
    };
    if !wait_for_valid_line(state, &line, line.ends_at, epoch, cancel.clone()).await? {
        if clear_line_if_current(state, epoch, &cancel)? {
            publish(app, state);
        }
        return Ok(());
    }
    if line.source == "question" {
        {
            let _action = lock(&state.action)?;
            if !is_current(state, epoch, &cancel) {
                return Ok(());
            }
            if let Some(line) = lock(&state.playback)?.as_mut() {
                line.ends_at = chrono::Utc::now().timestamp_millis() + 30_000;
            }
            lock(&state.runtime)?.phase = crate::types::RuntimePhase::Waiting;
        }
        publish(app, state);
        let until = chrono::Utc::now().timestamp_millis() + 30_000;
        let _ = wait_for_valid_line(state, &line, until, epoch, cancel.clone()).await?;
    }
    if is_current(state, epoch, &cancel) {
        show_link_hint(app, state, &line, epoch, cancel.clone()).await?;
    }
    if clear_line_if_current(state, epoch, &cancel)? {
        publish(app, state);
    }
    Ok(())
}

const LINK_HINT_SOURCE: &str = "balloon-link-hint";

pub(crate) fn record_link_hint_displayed(db: &Connection, line: &Playback) -> Result<(), String> {
    if line.source != LINK_HINT_SOURCE {
        return Ok(());
    }
    let user = store::active_user_id(db)?;
    db.execute(
        "INSERT OR IGNORE INTO pack_story_outcomes(run_id,kind,scope,scenario_id,input_id,evidence) VALUES(?1,'hint:balloon-link',?2,'','','[]')",
        rusqlite::params![format!("balloon-link-hint:{user}"), user],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

async fn show_link_hint(
    app: &tauri::AppHandle,
    state: &AppState,
    original: &Playback,
    epoch: u64,
    cancel: Arc<AtomicBool>,
) -> Result<(), String> {
    if original.link.is_none() {
        return Ok(());
    }
    {
        let _action = lock(&state.action)?;
        if !is_current(state, epoch, &cancel) {
            return Ok(());
        }
        let db = lock(&state.db)?;
        let runtime = lock(&state.runtime)?.clone();
        let widget_reaction = original.source == "reaction" && {
            let event = lock(&state.widget_playback)?;
            event.is_some()
        };
        if runtime.hidden
            || super::unavailable(state)
            || widgets::storage::focus_active(&db, chrono::Utc::now().timestamp_millis())?
            || super::quiet_hours::playback_blocked(state, &store::settings(&db)?, runtime.paused)?
            || (original.source == "diary"
                && !crate::diary::runtime::playback_current(state, &db, &original.id)?)
            || ((original.source == "widget" || widget_reaction)
                && !widgets::commands::widget_event_current(state, &db)?)
            || (original.source == "talk" && !talk::host::current(state, &db)?)
        {
            return Ok(());
        }
        let user = store::active_user_id(&db)?;
        let shown: bool = db.query_row(
            "SELECT EXISTS(SELECT 1 FROM pack_story_outcomes WHERE scope=?1 AND kind='hint:balloon-link')",
            [&user],
            |row| row.get(0),
        ).map_err(|error| error.to_string())?;
        if shown {
            return Ok(());
        }
        let mut playback = lock(&state.playback)?;
        if !playback.as_ref().is_some_and(|line| {
            line.id == original.id && line.display_started_at == original.display_started_at
        }) {
            return Ok(());
        }
        let mut hint = original.clone();
        hint.id = format!("balloon-link-hint:{}", uuid::Uuid::new_v4());
        hint.text = "이 말을 누르면 바로 열려.".into();
        hint.source = LINK_HINT_SOURCE.into();
        hint.display_started_at = None;
        hint.ends_at = 0;
        hint.line_index = 0;
        hint.line_count = 1;
        let message = Message {
            id: hint.id.clone(),
            role: "assistant".into(),
            persona: Some(hint.persona.clone()),
            content: hint.text.clone(),
            expression: Some(hint.expression.clone()),
            created_at: chrono::Utc::now().timestamp_millis(),
            status: "complete".into(),
        };
        let line = SceneLine {
            persona: hint.persona.clone(),
            expression: hint.expression.clone(),
            text: hint.text.clone(),
            widget: None,
            motion: hint.motion.clone(),
        };
        if let Some(ticket) = lock(&state.tasks)?.participants.clone() {
            let actor = characters::guests::resolve_actor(state, &db, &ticket, &hint.persona)?;
            store::insert_message_with_actor(
                &db,
                &message,
                LINK_HINT_SOURCE,
                false,
                &line,
                &actor,
            )?;
        } else {
            store::insert_message_with_playback(&db, &message, LINK_HINT_SOURCE, None, false, None)?;
        }
        db.execute(
            "INSERT INTO message_playback(message_id,revision,line) VALUES(?1,?2,?3)",
            rusqlite::params![
                hint.id,
                store::revision(&db)?,
                serde_json::to_string(&line).map_err(|error| error.to_string())?
            ],
        )
        .map_err(|error| error.to_string())?;
        let link = serde_json::to_string(&hint.link).map_err(|error| error.to_string())?;
        db.execute(
            "UPDATE messages SET data=json_set(data,'$.link',json(?2)) WHERE id=?1",
            rusqlite::params![hint.id, link],
        )
        .map_err(|error| error.to_string())?;
        *playback = Some(hint);
    }
    publish(app, state);
    if let Some(hint) = wait_for_displayed_line(state, epoch, cancel.clone()).await? {
        let _ = wait_for_valid_line(state, &hint, hint.ends_at, epoch, cancel).await?;
    }
    Ok(())
}

async fn wait_for_valid_line(
    state: &AppState,
    line: &Playback,
    until: i64,
    epoch: u64,
    cancel: Arc<AtomicBool>,
) -> Result<bool, String> {
    loop {
        if !is_current(state, epoch, &cancel) {
            return Ok(false);
        }
        let at = chrono::Utc::now().timestamp_millis();
        if matches!(line.source.as_str(), "llm" | "question") {
            let db = lock(&state.db)?;
            if !store::recall_valid(&db, &line.id, at)? {
                return Ok(false);
            }
        }
        if at >= until {
            return Ok(true);
        }
        let remaining = until.saturating_sub(at).min(250) as u64;
        tokio::select! {
            _ = models::cancelled(cancel.clone()) => return Ok(false),
            _ = tokio::time::sleep(Duration::from_millis(remaining)) => {}
        }
    }
}

pub(crate) fn clear_line_if_current(
    state: &AppState,
    epoch: u64,
    cancel: &AtomicBool,
) -> Result<bool, String> {
    let _action = lock(&state.action)?;
    if !is_current(state, epoch, cancel) {
        return Ok(false);
    }
    *lock(&state.playback)? = None;
    Ok(true)
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn run_scene(
    app: &tauri::AppHandle,
    state: &AppState,
    lines: &[SceneLine],
    source: &str,
    prefix: &str,
    direct_reply: bool,
    epoch: u64,
    cancel: Arc<AtomicBool>,
) -> Result<(), String> {
    run_scene_completed(
        app,
        state,
        lines,
        source,
        prefix,
        direct_reply,
        epoch,
        cancel,
    )
    .await
    .map(|_| ())
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn run_scene_completed(
    app: &tauri::AppHandle,
    state: &AppState,
    lines: &[SceneLine],
    source: &str,
    prefix: &str,
    direct_reply: bool,
    epoch: u64,
    cancel: Arc<AtomicBool>,
) -> Result<Option<LineCompletion>, String> {
    let generic = matches!(source, "scenario" | "npc");
    let effectful = generic && lock(&state.tasks)?.pack_replay.as_deref() != Some(prefix);
    let (revision, saved) = {
        let _action = lock(&state.action)?;
        if !is_current(state, epoch, &cancel) {
            return Ok(None);
        }
        let db = lock(&state.db)?;
        let saved = if direct_reply && matches!(source, "wordbook" | "story" | "scenario" | "npc") {
            super::conversation::ensure_current_user_message(&db, prefix)?;
            store::save_reply_scene_with_source(&db, prefix, lines, source)?;
            if generic {
                Some(lines.to_vec())
            } else {
                store::saved_reply_scene(&db, prefix)?
            }
        } else {
            None
        };
        (store::revision(&db)?, saved)
    };
    let lines = saved.as_deref().unwrap_or(lines);
    let mut completed = None;
    for (index, line) in lines.iter().enumerate() {
        let message_id = format!("scene:{prefix}:{index}");
        if direct_reply
            && (if generic {
                store::message_finished(&*lock(&state.db)?, &message_id)?
            } else {
                store::message_displayed(&*lock(&state.db)?, &message_id)?
            })
        {
            continue;
        }
        if matches!(source, "llm" | "question") {
            store::copy_recall(&*lock(&state.db)?, "active-scene", &message_id)?;
        }
        if !present_line(
            state,
            line,
            source,
            &message_id,
            index,
            lines.len(),
            revision,
            epoch,
            &cancel,
            direct_reply,
        )? {
            return Ok(None);
        }
        publish(app, state);
        if effectful {
            let Some(proof) = wait_for_completed_line(state, epoch, cancel.clone()).await? else {
                return Ok(None);
            };
            {
                let _action = lock(&state.action)?;
                let Some(proof) = line_completion_locked(
                    state,
                    &proof.playback,
                    epoch,
                    &cancel,
                    proof.finished_at,
                )?
                else {
                    return Ok(None);
                };
                let db = lock(&state.db)?;
                if index + 1 == lines.len() {
                    if !super::conversation::complete_pack_stage_locked(
                        state, &db, prefix, &proof, epoch,
                    )? {
                        return Ok(None);
                    }
                } else {
                    store::mark_message_finished(
                        &db,
                        &proof.playback.id,
                        proof
                            .playback
                            .display_started_at
                            .ok_or("대사의 표시 시작을 확인할 수 없어요.")?,
                        proof.playback.ends_at,
                        proof.finished_at,
                    )?;
                }
                *lock(&state.playback)? = None;
                completed = Some(proof);
            }
            publish(app, state);
        } else {
            wait_for_line(app, state, epoch, cancel.clone()).await?;
        }
        if !is_current(state, epoch, &cancel) {
            return Ok(None);
        }
        tokio::select! {
            _ = models::cancelled(cancel.clone()) => return Ok(None),
            _ = tokio::time::sleep(Duration::from_millis(220)) => {}
        }
    }
    Ok(completed)
}

pub(crate) fn start_scene(
    app: tauri::AppHandle,
    state: Arc<AppState>,
    lines: Vec<SceneLine>,
    source: &'static str,
    token: (u64, Arc<AtomicBool>),
    message_id: Option<String>,
) {
    let (epoch, cancel) = token;
    phase(
        &app,
        &state,
        epoch,
        crate::types::RuntimePhase::Playing,
        None,
        None,
    );
    let owner = state.clone();
    let owner_app = app.clone();
    let _ = super::tasks::spawn(
        owner_app,
        owner,
        super::tasks::Kind::Scene,
        epoch,
        async move {
            let Some(_guard) = super::tasks::acquire_gate(&state, epoch, cancel.clone()).await
            else {
                return;
            };
            if !is_current(&state, epoch, &cancel) {
                return;
            }
            let direct_reply = message_id.is_some() && source != "reaction";
            let prefix = message_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
            let result = run_scene(
                &app,
                &state,
                &lines,
                source,
                &prefix,
                direct_reply,
                epoch,
                cancel.clone(),
            )
            .await;
            if !is_current(&state, epoch, &cancel) {
                return;
            }
            phase(
                &app,
                &state,
                epoch,
                if direct_reply && result.is_err() {
                    crate::types::RuntimePhase::Error
                } else {
                    crate::types::RuntimePhase::Idle
                },
                None,
                result.err(),
            );
        },
    );
}

pub(crate) fn next_scene(state: &AppState) -> Result<(Vec<SceneLine>, &'static str), String> {
    let db = lock(&state.db)?;
    *lock(&state.talk_playback)? = None;
    if state.idle_sequence.load(Ordering::SeqCst) > 0
        && state.talk_turn.fetch_xor(true, Ordering::SeqCst)
    {
        if let Some(lines) = talk::host::prepare(state, &db, None)? {
            return Ok((lines, "talk"));
        }
    }
    let sequence = state.idle_sequence.fetch_add(1, Ordering::SeqCst);
    if sequence == 0 {
        return Ok((visible_script(state, &db, 0)?, "script"));
    }
    let registered: Vec<_> = wordbook::entries(&db)?
        .into_iter()
        .filter(|entry| {
            entry.enabled
                && entry.use_for_idle
                && presence::lines_visible(state, &db, &entry.lines).unwrap_or(false)
        })
        .collect();
    let mut scenes = Vec::new();
    for scene in store::prepared_scenes(&db)? {
        if !store::recall_valid(&db, &scene.id, chrono::Utc::now().timestamp_millis())? {
            store::delete_scene(&db, &scene.id)?;
        } else if presence::lines_visible(state, &db, &scene.lines)? {
            scenes.push(scene);
        }
    }
    let source = playback::idle_source(sequence, !registered.is_empty(), !scenes.is_empty());
    match source {
        "wordbook" => Ok((
            registered[(sequence as usize / 2) % registered.len()]
                .lines
                .clone(),
            source,
        )),
        "llm" => {
            let scene = &scenes[0];
            store::copy_recall(&db, &scene.id, "active-scene")?;
            store::delete_scene(&db, &scene.id)?;
            Ok((
                scene.lines.clone(),
                if scene.id.starts_with("question:") {
                    "question"
                } else {
                    source
                },
            ))
        }
        _ => Ok((visible_script(state, &db, sequence)?, "script")),
    }
}

fn visible_script(
    state: &AppState,
    db: &Connection,
    sequence: u64,
) -> Result<Vec<SceneLine>, String> {
    let script = character_script(db, sequence)?;
    if presence::lines_visible(state, db, &script)? {
        return Ok(script);
    }
    let active = characters::active_members(db)?;
    let present = presence::present_ids(
        state,
        &active
            .iter()
            .map(|member| member.id.clone())
            .collect::<Vec<_>>(),
    )?;
    let mut lines = Vec::new();
    for (slot, member) in characters::SLOTS.iter().zip(active.iter()) {
        if !present.contains(&member.id) {
            continue;
        }
        if sequence == 0 {
            lines.extend(characters::greeting(db, slot)?);
        } else {
            let index = sequence as usize % member.definition.idle_lines.len();
            let line = &member.definition.idle_lines[index];
            lines.push(SceneLine {
                persona: member.id.clone(),
                expression: line.expression.clone(),
                text: line.text.clone(),
                widget: None,
                motion: line.motion.clone(),
            });
        }
    }
    Ok(lines)
}

pub(crate) fn character_script(db: &Connection, sequence: u64) -> Result<Vec<SceneLine>, String> {
    let members = characters::active_members(db)?;
    if sequence == 0 {
        let mut greeting = Vec::new();
        for slot in characters::SLOTS.iter().take(members.len()) {
            greeting.extend(characters::greeting(db, slot)?);
        }
        return Ok(greeting);
    }
    characters::idle_scene(db, sequence as usize)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_triggered_talk_links_to_its_originating_widget() {
        let state = super::super::tests::state();
        let db = lock(&state.db).unwrap();
        let todo = widgets::storage::instances(&db).unwrap().into_iter()
            .find(|widget| widget.kind == "todo").unwrap();
        let now = chrono::Utc::now().timestamp_millis();
        let event = widgets::WidgetEvent {
            id: "event".into(), instance_id: todo.id.clone(), widget_kind: todo.kind,
            revision: todo.revision, created_at: now, expires_at: now + 30_000,
            event: widgets::EventDraft { kind: "todo-completed".into(), text: String::new(), payload: serde_json::json!({}) },
        };
        let source = "format: 1\nscene: complete\non: todo-completed\n---\nA: 다 했구나!\n===\n";
        lock(&state.talk).unwrap().apply(Ok(talk::validate_source(std::path::Path::new("event.talk"), source, &talk::context::registry()).unwrap()));
        let lines = talk::host::prepare(&state, &db, Some(&event)).unwrap().unwrap();
        *lock(&state.widget_playback).unwrap() = Some(event.clone());
        let link = playback_link(&db, &state, "talk", "line", &lines[0]).unwrap().unwrap();
        assert_eq!(link.instance_id, todo.id);
        lock(&state.widget_playback).unwrap().as_mut().unwrap().id = "different".into();
        assert!(playback_link(&db, &state, "talk", "line", &lines[0]).unwrap().is_none());
    }

    #[test]
    fn official_widget_links_are_available_even_when_reactions_are_disabled() {
        let state = super::super::tests::state();
        let db = lock(&state.db).unwrap();
        db.execute("DELETE FROM widget_instances WHERE kind='device'", [])
            .unwrap();
        db.execute("INSERT INTO widget_instances(id,kind,version,installed,enabled,revision,data) VALUES('test-device','device',1,1,1,1,'{}')", []).unwrap();
        let line = SceneLine {
            persona: "builtin-a".into(),
            expression: "평온".into(),
            text: "배터리".into(),
            widget: Some("device".into()),
            motion: Default::default(),
        };
        for reaction_enabled in [true, false] {
            if !reaction_enabled {
                db.execute("INSERT INTO widget_preferences(key,value) VALUES('reaction:test-device','0')", []).unwrap();
            }
            let mut prompt = Vec::new();
            let mut schema = crate::domain::reply_schema_for(&["builtin-a".into()], &["평온"]);
            let kinds = crate::domain::configure_widget_replies(&db, &mut prompt, &mut schema, false)
                .unwrap();
            assert!(kinds.iter().any(|kind| kind == "device"));
            assert_eq!(
                playback_link(&db, &state, "llm", "message", &line).unwrap().is_some(),
                true
            );
        }
    }

    #[test]
    fn generated_expression_choices_reach_single_expression_character_presentation() {
        let state = super::super::tests::state();
        let member = {
            let db = lock(&state.db).unwrap();
            let definition = serde_json::from_value(serde_json::json!({
                "sourceId":"single-expression", "name":"QA 단일 표정", "description":"", "personality":"",
                "expressions":{"평온":"기본"},
                "greeting":[{"expression":"평온","text":"안녕"}],
                "idleLines":[{"expression":"평온","text":"쉬는 중"}]
            })).unwrap();
            let member = characters::create(&db, &definition).unwrap();
            characters::apply_roster(&db, vec![member.id.clone()]).unwrap();
            member
        };
        let targets = vec![member.id.clone()];
        let token = super::super::interrupt(&state, false).unwrap();
        let revision = {
            let db = lock(&state.db).unwrap();
            presence::summon_locked(&state, &member.id).unwrap();
            let ticket = characters::guests::capture(&state, &db, &targets, token.0).unwrap();
            lock(&state.tasks).unwrap().participants = Some(ticket);
            store::revision(&db).unwrap()
        };
        let expressions = crate::domain::generated_expressions([&member.definition]);
        let schema = crate::domain::scene_schema_for(&targets, 1, 1, &expressions);
        assert_eq!(expressions, ["평온"]);
        for expression in schema["properties"]["lines"]["items"]["properties"]["expression"]["enum"]
            .as_array()
            .unwrap()
        {
            let lines = crate::domain::parse_lines_for(
                serde_json::json!({"lines":[{"persona":member.id,"expression":expression,"text":"  생성 원문\n그대로  "}]}),
                &targets,
                1,
                1,
                true,
            )
            .unwrap();
            crate::domain::validate_generated_expressions(&lines, &expressions).unwrap();
            let id = format!("generated-expression:{}", expression.as_str().unwrap());
            store::record_recall(&lock(&state.db).unwrap(), &id, &[], 1).unwrap();
            assert!(present_line(
                &state, &lines[0], "llm", &id, 0, 1, revision, token.0, &token.1, true,
            )
            .unwrap());
            assert_eq!(
                lock(&state.playback).unwrap().as_ref().unwrap().text,
                "  생성 원문\n그대로  "
            );
        }
        let invalid_authored = SceneLine {
            persona: member.id,
            expression: "호기심".into(),
            text: "  등록 원문\n그대로  ".into(),
            widget: None,
            motion: Default::default(),
        };
        let db = lock(&state.db).unwrap();
        assert!(characters::guests::resolve_lines(
            &state,
            &db,
            lock(&state.tasks).unwrap().participants.as_ref().unwrap(),
            &[invalid_authored],
        )
        .is_err());
    }

    #[tokio::test]
    async fn retry_display_timeout_replays_exact_saved_line_and_skips_visible_duplicates() {
        let state = super::super::tests::state();
        let revision = store::revision(&lock(&state.db).unwrap()).unwrap();
        let old = super::super::interrupt(&state, false).unwrap();
        let line = SceneLine {
            persona: "builtin-a".into(),
            expression: "평온".into(),
            text: "  재시도 원문\n그대로  ".into(),
            widget: None,
            motion: crate::characters::reactions::MotionOverride::Static,
        };
        assert!(present_line(
            &state,
            &line,
            "wordbook",
            "retry-display",
            0,
            1,
            revision,
            old.0,
            &old.1,
            true
        )
        .unwrap());
        assert!(wait_for_displayed_line_until(
            &state,
            old.0,
            old.1.clone(),
            tokio::time::Instant::now()
        )
        .await
        .unwrap_err()
        .contains("30초"));
        let retry = super::super::interrupt(&state, false).unwrap();
        let changed = SceneLine {
            text: "다른 새 생성은 사용하지 않음".into(),
            widget: None,
            motion: Default::default(),
            ..line.clone()
        };
        assert!(!present_line(
            &state,
            &changed,
            "llm",
            "retry-display",
            0,
            1,
            revision,
            old.0,
            &old.1,
            true
        )
        .unwrap());
        assert!(present_line(
            &state,
            &changed,
            "llm",
            "retry-display",
            0,
            1,
            revision,
            retry.0,
            &retry.1,
            true
        )
        .unwrap());
        let playback = lock(&state.playback).unwrap().clone().unwrap();
        assert_eq!(playback.text, line.text);
        assert_eq!(playback.motion, line.motion);
        assert_eq!(playback.source, "wordbook");
        let db = lock(&state.db).unwrap();
        let history = store::messages(&db, 10).unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].content, playback.text);
        store::mark_message_displayed(&db, &playback.id, 1).unwrap();
        store::mark_message_displayed(&db, &playback.id, 2).unwrap();
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM message_presentations", [], |row| row
                .get::<_, i64>(
                0
            ))
            .unwrap(),
            1
        );
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM character_affinity", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
        drop(db);
        assert!(!present_line(
            &state,
            &changed,
            "llm",
            "retry-display",
            0,
            1,
            revision,
            retry.0,
            &retry.1,
            true
        )
        .unwrap());
    }

    #[tokio::test]
    async fn display_preparation_timeout_clears_only_unshown_playback_and_keeps_raw_history() {
        for displayed in [false, true] {
            let state = super::super::tests::state();
            let revision = store::revision(&lock(&state.db).unwrap()).unwrap();
            let token = super::super::interrupt(&state, false).unwrap();
            let line = SceneLine {
                persona: "a".into(),
                widget: None,
                motion: Default::default(),
                expression: "평온".into(),
                text: "  표시할 원문\n그대로  ".into(),
            };
            assert!(present_line(
                &state, &line, "script", "waiting", 0, 1, revision, token.0, &token.1, false,
            )
            .unwrap());
            if displayed {
                mark_line_displayed(lock(&state.playback).unwrap().as_mut().unwrap(), 60_000);
            }
            let result = wait_for_displayed_line_until(
                &state,
                token.0,
                token.1,
                tokio::time::Instant::now(),
            )
            .await;
            if displayed {
                let playback = result.unwrap().unwrap();
                assert_eq!(
                    playback.ends_at,
                    60_000 + playback::reading_millis(&line.text)
                );
                assert_eq!(
                    lock(&state.playback).unwrap().as_ref().unwrap().id,
                    "waiting"
                );
            } else {
                assert!(result.unwrap_err().contains("30초"));
                assert!(lock(&state.playback).unwrap().is_none());
            }
            assert_eq!(
                store::messages(&lock(&state.db).unwrap(), 10).unwrap()[0].content,
                line.text
            );
        }
    }
}
