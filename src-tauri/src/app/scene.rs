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
    if !is_current(state, epoch, cancel) || store::revision(&db)? != revision {
        return Ok(false);
    }
    let resolved = characters::resolve_lines(&db, std::slice::from_ref(line))?;
    let line = &resolved[0];
    if source == "widget" && !widget_commands::widget_event_current(state, &db)? {
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
    store::insert_message_with_source(
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
    )?;
    *lock(&state.playback)? = Some(Playback {
        id: id.into(),
        persona: line.persona.clone(),
        expression: line.expression.clone(),
        text: line.text.clone(),
        source: source.into(),
        ends_at: chrono::Utc::now().timestamp_millis() + playback::reading_millis(&line.text),
        line_index,
        line_count,
    });
    let mut runtime = lock(&state.runtime)?;
    runtime.phase = "playing".into();
    runtime.persona = Some(line.persona.clone());
    runtime.error = None;
    Ok(true)
}

pub(crate) async fn wait_for_line(
    app: &tauri::AppHandle,
    state: &AppState,
    epoch: u64,
    cancel: Arc<AtomicBool>,
    text: &str,
) -> Result<(), String> {
    tokio::select! {
        _ = models::cancelled(cancel.clone()) => return Ok(()),
        _ = tokio::time::sleep(Duration::from_millis(playback::reading_millis(text) as u64)) => {}
    }
    let question = lock(&state.playback)?
        .as_ref()
        .is_some_and(|line| line.source == "question");
    if question {
        {
            let _action = lock(&state.action)?;
            if !is_current(state, epoch, &cancel) {
                return Ok(());
            }
            if let Some(line) = lock(&state.playback)?.as_mut() {
                line.ends_at = chrono::Utc::now().timestamp_millis() + 30_000;
            }
            lock(&state.runtime)?.phase = "waiting".into();
        }
        publish(app, state);
        tokio::select! {
            _ = models::cancelled(cancel.clone()) => return Ok(()),
            _ = tokio::time::sleep(Duration::from_secs(30)) => {}
        }
    }
    if clear_line_if_current(state, epoch, &cancel)? {
        publish(app, state);
    }
    Ok(())
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
    let revision = store::revision(&*lock(&state.db)?)?;
    for (index, line) in lines.iter().enumerate() {
        if !present_line(
            state,
            line,
            source,
            &format!("scene:{prefix}:{index}"),
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
        wait_for_line(app, state, epoch, cancel.clone(), &line.text).await?;
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
    phase(&app, &state, epoch, "playing", None, None);
    tauri::async_runtime::spawn(async move {
        let _guard = state.gate.lock().await;
        if !is_current(&state, epoch, &cancel) {
            return;
        }
        let direct_reply = message_id.is_some();
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
        phase(&app, &state, epoch, "idle", None, result.err());
    });
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
        return Ok((character_script(&db, 0)?, "script"));
    }
    let registered: Vec<_> = wordbook::entries(&db)?
        .into_iter()
        .filter(|entry| {
            entry.enabled
                && entry.use_for_idle
                && characters::resolve_lines(&db, &entry.lines).is_ok()
        })
        .collect();
    let scenes = store::prepared_scenes(&db)?;
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
        _ => Ok((character_script(&db, sequence)?, "script")),
    }
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
