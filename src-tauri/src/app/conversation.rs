use super::scene::{present_line, start_scene, wait_for_line};
use super::unavailable;
use super::{is_current, lock, now, phase, publish, schedule_idle, AppState};
use crate::{characters, domain, inference, models, store, story, types::*, wordbook};
use rusqlite::Connection;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

#[cfg(test)]
pub(crate) fn validate_target(target: &str) -> Result<Vec<&str>, String> {
    match target {
        "a" => Ok(vec!["a"]),
        "b" => Ok(vec!["b"]),
        "both" => Ok(vec!["a", "b"]),
        _ => Err("대화 상대를 선택해 주세요.".into()),
    }
}

pub(crate) fn route_message(
    state: &AppState,
    db: &Connection,
    content: &str,
) -> Result<Option<Vec<SceneLine>>, String> {
    let entries = wordbook::entries(db)?;
    if let Some(entry) = wordbook::match_entry(&entries, content) {
        let lines = characters::resolve_lines(db, &entry.lines).map_err(|error| {
            format!(
                "일치한 단어장 ‘{}’의 화자를 확인해 주세요. {error}",
                entry.title
            )
        })?;
        return Ok(Some(lines));
    }
    if let Some(lines) = characters::keyword_scene(db, content)? {
        return Ok(Some(characters::resolve_lines(db, &lines)?));
    }
    let settings = store::settings(db)?;
    if settings.mode == "local" && !models::selected_ready(&state.app_data, &settings) {
        return Err(inference::not_ready_message(&settings));
    }
    if settings.mode == "api"
        && (settings.api_model.trim().is_empty() || !inference::has_api_key(&settings))
    {
        return Err("설정에서 API 연결을 먼저 완료해 주세요.".into());
    }
    Ok(None)
}

pub(crate) fn record_input_and_route(
    state: &AppState,
    db: &Connection,
    content: &str,
    target: &str,
    message_id: &str,
) -> Result<Option<Vec<SceneLine>>, String> {
    store::insert_message(
        db,
        &Message {
            id: message_id.into(),
            role: "user".into(),
            persona: Some(target.into()),
            content: content.into(),
            expression: None,
            created_at: now() * 1000,
            status: "complete".into(),
        },
    )?;
    route_message(state, db, content)
}

#[tauri::command]
pub(crate) async fn send_message(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    content: String,
    target: String,
    client_message_id: String,
) -> Result<(), String> {
    let content = content.trim();
    if content.is_empty() || content.chars().count() > 2000 {
        return Err("대화는 1~2,000자로 입력해 주세요.".into());
    }
    uuid::Uuid::parse_str(&client_message_id)
        .map_err(|_| "메시지 식별자가 올바르지 않아요.".to_string())?;
    let (token, registered, targets) = {
        let _action = lock(&state.action)?;
        if unavailable(&state) {
            return Err("앱을 종료하고 있어요.".into());
        }
        let db = lock(&state.db)?;
        let settings = store::settings(&db)?;
        let targets = resolve_targets(&db, &target)?;
        let exists: bool = db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM messages WHERE id=?1)",
                [&client_message_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        if exists {
            return Ok(());
        }
        let registered = record_input_and_route(&state, &db, content, &target, &client_message_id);
        let token = super::tasks::reserve(&state, super::tasks::Kind::Conversation, false)?;
        if registered.is_err() {
            lock(&state.tasks)?.active = None;
        }
        *lock(&state.panel)? = None;
        state.last_input.store(now(), Ordering::SeqCst);
        schedule_idle(&state, settings.idle_minutes);
        (token, registered, targets)
    };
    let registered = match registered {
        Ok(registered) => registered,
        Err(error) => {
            phase(
                &app,
                &state,
                token.0,
                RuntimePhase::Error,
                targets.first().cloned(),
                Some(error.clone()),
            );
            return Err(error);
        }
    };
    if let Some(lines) = registered {
        start_scene(
            app,
            state.inner().clone(),
            lines,
            "wordbook",
            token,
            Some(client_message_id),
        );
        return Ok(());
    }
    start_turn(
        app,
        state.inner().clone(),
        targets,
        client_message_id,
        token,
    );
    Ok(())
}

#[tauri::command]
pub(crate) fn retry_turn(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    message_id: String,
    target: String,
) -> Result<(), String> {
    let (targets, token, registered) = {
        let _action = lock(&state.action)?;
        if unavailable(&state) {
            return Err("앱을 종료하고 있어요.".into());
        }
        let db = lock(&state.db)?;
        let history = store::messages(&db, 100)?;
        let latest = history
            .iter()
            .rev()
            .find(|m| m.role == "user")
            .ok_or("다시 요청할 대화가 없어요.")?;
        if latest.id != message_id {
            return Err("가장 최근 대화만 다시 요청할 수 있어요.".into());
        }
        ensure_retry_characters(&db, &message_id, &target)?;
        let registered = route_message(&state, &db, &latest.content)?;
        let original = store::message_targets(&db, &message_id)?;
        let requested = if target == "all" {
            original.clone()
        } else {
            resolve_targets(&db, &target)?
        };
        let targets = requested
            .into_iter()
            .filter(|id| {
                !history
                    .iter()
                    .any(|m| m.id == reply_id(&message_id, id) && m.status == "complete")
            })
            .collect::<Vec<_>>();
        if targets.iter().any(|id| !original.contains(id)) {
            return Err("원래 대화 상대에게만 다시 요청할 수 있어요.".into());
        }
        if targets.is_empty() && registered.is_none() {
            return Ok(());
        }
        store::resume_conversation(&db, chrono::Utc::now().timestamp_millis())?;
        let token = super::tasks::reserve(&state, super::tasks::Kind::Conversation, false)?;
        *lock(&state.panel)? = None;
        state.last_input.store(now(), Ordering::SeqCst);
        schedule_idle(&state, store::settings(&db)?.idle_minutes);
        (targets, token, registered)
    };
    if let Some(lines) = registered {
        start_scene(
            app,
            state.inner().clone(),
            lines,
            "wordbook",
            token,
            Some(message_id),
        );
        return Ok(());
    }
    start_turn(app, state.inner().clone(), targets, message_id, token);
    Ok(())
}

pub(crate) fn reply_id(message_id: &str, persona: &str) -> String {
    format!("reply:{message_id}:{persona}")
}
pub(crate) fn ensure_retry_characters(
    db: &Connection,
    message_id: &str,
    target: &str,
) -> Result<(), String> {
    let identities = store::message_identities(db, 100)?;
    let targets = if target == "all" {
        store::message_targets(db, message_id)?
    } else {
        resolve_targets(db, target)?
    };
    let active = characters::active_ids(db)?;
    for id in targets {
        if !active.contains(&id) {
            return Err("대화 상대가 바뀌었어요. 새 메시지로 말해 주세요.".into());
        }
        if !identities
            .iter()
            .any(|identity| identity.message_id == message_id && identity.character_id == id)
        {
            return Err("대화 상대가 바뀌었어요. 현재 캐릭터에게 새 메시지로 말해 주세요.".into());
        }
    }
    Ok(())
}
#[cfg(test)]
pub(crate) fn remaining_retry(
    original: &str,
    requested: &str,
    completed: &[String],
) -> Result<Vec<String>, String> {
    let original_targets = validate_target(original)?;
    let requested_targets = validate_target(requested)?;
    if requested_targets
        .iter()
        .any(|p| !original_targets.contains(p))
    {
        return Err("원래 대화 상대에게만 다시 요청할 수 있어요.".into());
    }
    Ok(requested_targets
        .into_iter()
        .filter(|p| !completed.iter().any(|done| done == p))
        .map(str::to_string)
        .collect())
}

pub(crate) fn start_turn(
    app: tauri::AppHandle,
    state: Arc<AppState>,
    targets: Vec<String>,
    message_id: String,
    token: (u64, Arc<AtomicBool>),
) {
    let (epoch, cancel) = token;
    phase(
        &app,
        &state,
        epoch,
        crate::types::RuntimePhase::Loading,
        targets.first().cloned(),
        None,
    );
    let owner = state.clone();
    let owner_app = app.clone();
    let _ = super::tasks::spawn(
        owner_app,
        owner,
        super::tasks::Kind::Conversation,
        epoch,
        async move {
            let memories = tokio::select! {
                _ = models::cancelled(cancel.clone()) => return,
                result = crate::memory_commands::search_for_turn(&state, &message_id) => match result {
                    Ok(memories) => memories,
                    Err(error) => {
                        phase(&app, &state, epoch, RuntimePhase::Error, targets.first().cloned(), Some(error));
                        return;
                    }
                },
            };
            let Some(_guard) = super::tasks::acquire_gate(&state, epoch, cancel.clone()).await
            else {
                return;
            };
            if !is_current(&state, epoch, &cancel) {
                return;
            }
            let result = run_turn(
                &app,
                &state,
                &targets,
                &message_id,
                epoch,
                cancel.clone(),
                &memories,
            )
            .await;
            if !is_current(&state, epoch, &cancel) {
                return;
            }
            state.last_foreground.store(now(), Ordering::SeqCst);
            match result {
                Ok(()) => phase(
                    &app,
                    &state,
                    epoch,
                    crate::types::RuntimePhase::Idle,
                    None,
                    None,
                ),
                Err(error) => phase(
                    &app,
                    &state,
                    epoch,
                    crate::types::RuntimePhase::Error,
                    targets.first().cloned(),
                    Some(error),
                ),
            }
        },
    );
}

#[cfg(test)]
pub(crate) fn turn_prompt(
    db: &Connection,
    targets: &[String],
    message_id: &str,
) -> Result<Vec<ChatMessage>, String> {
    let query = store::messages(db, 100)?
        .into_iter()
        .find(|message| message.id == message_id && message.role == "user")
        .ok_or("대화의 근거가 변경되었어요. 새 메시지로 말해 주세요.")?
        .content;
    let memories: Vec<Memory> = store::search_memories(db, &query, &[], None)?
        .into_iter()
        .map(|hit| hit.memory)
        .collect();
    turn_prompt_with_memories(db, targets, message_id, &memories)
}

pub(crate) fn turn_prompt_with_memories(
    db: &Connection,
    targets: &[String],
    message_id: &str,
    memories: &[Memory],
) -> Result<Vec<ChatMessage>, String> {
    let relationships = store::relationships(db)?;
    match targets {
        [a, b] => {
            let histories = [
                story::prompt_history(db, a, store::context_messages_for(db, 24, a)?)?,
                story::prompt_history(db, b, store::context_messages_for(db, 24, b)?)?,
            ];
            let latest = histories[0]
                .iter()
                .find(|m| {
                    m.id == message_id
                        && m.role == "user"
                        && histories[1].iter().any(|other| other.id == m.id)
                })
                .ok_or("대화의 근거가 변경되었어요. 새 메시지로 말해 주세요.")?;
            let mut members = [
                characters::active_character(db, a)?,
                characters::active_character(db, b)?,
            ];
            for member in &mut members {
                member.definition = story::profile(db, member.clone())?;
            }
            if a == "a" && b == "b" {
                Ok(domain::pair_prompt_messages(
                    &[members[0].definition.clone(), members[1].definition.clone()],
                    &histories,
                    memories,
                    &relationships,
                    latest,
                ))
            } else {
                Ok(domain::roster_pair_prompt(
                    &members,
                    &histories,
                    memories,
                    &relationships,
                    latest,
                ))
            }
        }
        [persona] => {
            let member = characters::active_character(db, persona)?;
            let mut messages = store::context_messages_for(db, 24, persona)?;
            // Earlier replies in this same turn are reference data, never the user's words.
            for reply in store::context_messages(db, 100)?.into_iter().filter(|m| {
                m.role == "assistant"
                    && m.id.starts_with(&format!("reply:{message_id}:"))
                    && m.status == "complete"
            }) {
                if !messages.iter().any(|m| m.id == reply.id) {
                    messages.push(reply);
                }
            }
            let messages = story::prompt_history(db, persona, messages)?;
            let score = relationships
                .iter()
                .find(|r| r.persona == member.id)
                .map_or(20, |r| r.score);
            Ok(domain::prompt_messages(
                persona,
                &story::profile(db, member.clone())?,
                &messages,
                memories,
                &Relationship {
                    persona: persona.clone(),
                    score,
                },
            ))
        }
        _ => Err("대화 상대를 선택해 주세요.".into()),
    }
}

#[cfg(test)]
pub(crate) async fn generate_turn(
    state: &AppState,
    targets: &[String],
    message_id: &str,
    cancel: Arc<AtomicBool>,
) -> Result<(Vec<SceneLine>, i64), String> {
    let memories = crate::memory_commands::search_for_turn(state, message_id).await?;
    generate_turn_with_memories(state, targets, message_id, cancel, &memories).await
}

pub(crate) async fn generate_turn_with_memories(
    state: &AppState,
    targets: &[String],
    message_id: &str,
    cancel: Arc<AtomicBool>,
    memories: &[store::MemorySearchHit],
) -> Result<(Vec<SceneLine>, i64), String> {
    let (settings, prompt, revision) = {
        let db = lock(&state.db)?;
        (
            store::settings(&db)?,
            turn_prompt_with_memories(
                &db,
                targets,
                message_id,
                &store::revalidate_search_hits(&db, memories)?,
            )?,
            store::revision(&db)?,
        )
    };
    let paired = targets.len() == 2;
    let value = inference::generate(
        &state.inference,
        &settings,
        &prompt,
        if paired {
            domain::scene_schema_for(targets, 2, 2)
        } else {
            domain::reply_schema_for(targets)
        },
        if paired { 512 } else { 256 },
        cancel,
    )
    .await?;
    let lines = if paired {
        domain::parse_lines_for(value, targets, 2, 2, true)?
    } else {
        let line = domain::parse_reply(value)?;
        if targets
            .first()
            .is_none_or(|persona| line.persona != *persona)
        {
            return Err("대화의 화자를 확인하지 못했어요. 다시 시도해 주세요.".into());
        }
        vec![line]
    };
    Ok((lines, revision))
}

pub(crate) async fn run_turn(
    app: &tauri::AppHandle,
    state: &AppState,
    targets: &[String],
    message_id: &str,
    epoch: u64,
    cancel: Arc<AtomicBool>,
    memories: &[store::MemorySearchHit],
) -> Result<(), String> {
    if !is_current(state, epoch, &cancel) {
        return Ok(());
    }
    phase(
        app,
        state,
        epoch,
        crate::types::RuntimePhase::Generating,
        targets.first().cloned(),
        None,
    );
    let groups: Vec<Vec<String>> = if targets.len() <= 2 {
        vec![targets.to_vec()]
    } else {
        targets.iter().map(|id| vec![id.clone()]).collect()
    };
    let mut shown = 0;
    for group in groups {
        if !is_current(state, epoch, &cancel) {
            return Ok(());
        }
        let (lines, revision) =
            generate_turn_with_memories(state, &group, message_id, cancel.clone(), memories)
                .await?;
        for line in &lines {
            if !present_line(
                state,
                line,
                "llm",
                &reply_id(message_id, &line.persona),
                shown,
                targets.len(),
                revision,
                epoch,
                &cancel,
                true,
            )? {
                return Ok(());
            }
            shown += 1;
            publish(app, state);
            wait_for_line(app, state, epoch, cancel.clone(), &line.text).await?;
        }
    }

    Ok(())
}

pub(crate) fn resolve_targets(db: &Connection, target: &str) -> Result<Vec<String>, String> {
    if target == "all" {
        return characters::active_ids(db);
    }
    if target == "both" {
        return ["a", "b"]
            .iter()
            .map(|slot| characters::active_character(db, slot).map(|c| c.id))
            .collect();
    }
    Ok(vec![characters::active_character(db, target)?.id])
}
