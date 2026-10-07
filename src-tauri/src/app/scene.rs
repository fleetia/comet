use super::presence;
use super::{is_current, lock, phase, publish, AppState};
use crate::{characters, models, playback, store, talk_host, types::*, widget_commands, wordbook};
use rusqlite::Connection;
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

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
        || crate::widgets::storage::focus_active(&db, chrono::Utc::now().timestamp_millis())?
        || super::quiet_hours::playback_blocked(
            state,
            &store::settings(&db)?,
            lock(&state.runtime)?.paused,
        )?
        || store::revision(&db)? != revision
    {
        return Ok(false);
    }
    let saved = if direct_reply {
        if store::message_displayed(&db, id)? {
            return Ok(false);
        }
        store::saved_reply(&db, id)?
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
    let resolved = characters::resolve_lines(&db, std::slice::from_ref(line))?;
    let line = &resolved[0];
    if source != "presence" && !presence::is_present(state, &line.persona)? {
        if state.automatic.load(Ordering::SeqCst) {
            return Ok(false);
        }
        presence::summon_locked(state, &line.persona)?;
    }
    let text_speed = characters::active_character(&db, &line.persona)?
        .definition
        .balloon_style
        .text_speed;
    if (source == "widget" || (source == "reaction" && lock(&state.widget_playback)?.is_some()))
        && !widget_commands::widget_event_current(state, &db)?
    {
        return Ok(false);
    }
    if source == "talk" && !talk_host::current(state, &db)? {
        return Ok(false);
    }
    let scene_key = if source == "talk" && line_index == 0 {
        lock(&state.talk_playback)?
            .as_ref()
            .map(|prepared| prepared.selection.key.clone())
    } else {
        None
    };
    store::insert_message_with_playback(
        &db,
        &Message {
            id: id.into(),
            role: "assistant".into(),
            persona: Some(line.persona.clone()),
            content: line.text.clone(),
            expression: Some(line.expression.clone()),
            created_at: chrono::Utc::now().timestamp_millis(),
            status: "complete".into(),
        },
        source,
        scene_key.as_deref(),
        direct_reply,
        Some(line),
    )?;
    *lock(&state.playback)? = Some(Playback {
        id: id.into(),
        persona: line.persona.clone(),
        expression: line.expression.clone(),
        text: line.text.clone(),
        motion: line.motion.clone(),
        source: source.into(),
        text_speed,
        display_started_at: None,
        ends_at: 0,
        line_index,
        line_count,
    });
    if direct_reply {
        if let Some(panel) = lock(&state.panel)?
            .as_mut()
            .filter(|panel| panel.mode == "input")
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
            return Ok(None);
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
                return Ok(None);
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
    if clear_line_if_current(state, epoch, &cancel)? {
        publish(app, state);
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
        if matches!(line.source.as_str(), "llm" | "question")
            && !store::recall_valid(&*lock(&state.db)?, &line.id, at)?
        {
            return Ok(false);
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
    let (revision, saved) = {
        let _action = lock(&state.action)?;
        if !is_current(state, epoch, &cancel) {
            return Ok(());
        }
        let db = lock(&state.db)?;
        let saved = if direct_reply && source == "wordbook" {
            super::conversation::ensure_current_user_message(&db, prefix)?;
            store::save_reply_scene(&db, prefix, lines)?;
            store::saved_reply_scene(&db, prefix)?
        } else {
            None
        };
        (store::revision(&db)?, saved)
    };
    let lines = saved.as_deref().unwrap_or(lines);
    for (index, line) in lines.iter().enumerate() {
        let message_id = format!("scene:{prefix}:{index}");
        if direct_reply && store::message_displayed(&*lock(&state.db)?, &message_id)? {
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
            return Ok(());
        }
        publish(app, state);
        wait_for_line(app, state, epoch, cancel.clone()).await?;
        if !is_current(state, epoch, &cancel) {
            return Ok(());
        }
        tokio::select! {
            _ = models::cancelled(cancel.clone()) => return Ok(()),
            _ = tokio::time::sleep(Duration::from_millis(220)) => {}
        }
    }
    Ok(())
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
        if let Some(lines) = talk_host::prepare(state, &db, None)? {
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

    #[tokio::test]
    async fn retry_display_timeout_replays_exact_saved_line_and_skips_visible_duplicates() {
        let state = super::super::tests::state();
        let revision = store::revision(&lock(&state.db).unwrap()).unwrap();
        let old = super::super::interrupt(&state, false).unwrap();
        let line = SceneLine {
            persona: "builtin-a".into(),
            expression: "평온".into(),
            text: "  재시도 원문\n그대로  ".into(),
            motion: crate::character_reactions::MotionOverride::Static,
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
