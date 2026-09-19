use super::scene::{present_line, start_scene, wait_for_line};
use super::{interrupt, is_current, lock, now, phase, publish, schedule_idle, AppState};
use crate::{characters, domain, inference, models, store, story, types::*, wordbook};
use rusqlite::Connection;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

pub(super) fn validate_target(target: &str) -> Result<Vec<&str>, String> {
    match target {
        "a" => Ok(vec!["a"]),
        "b" => Ok(vec!["b"]),
        "both" => Ok(vec!["a", "b"]),
        _ => Err("대화 상대를 선택해 주세요.".into()),
    }
}

pub(super) fn route_message(
    state: &AppState,
    db: &Connection,
    content: &str,
) -> Result<Option<Vec<SceneLine>>, String> {
    let entries = wordbook::entries(db)?;
    if let Some(entry) = wordbook::match_entry(&entries, content) {
        return Ok(Some(entry.lines.clone()));
    }
    if let Some(lines) = characters::keyword_scene(db, content)? {
        return Ok(Some(lines));
    }
    let settings = store::settings(db)?;
    if settings.mode == "local" && !models::model_ready(&state.app_data, settings.local_model) {
        return Err("설정에서 모델을 먼저 다운로드해 주세요.".into());
    }
    if settings.mode == "api"
        && (settings.api_model.trim().is_empty() || !inference::has_api_key(&settings))
    {
        return Err("설정에서 API 연결을 먼저 완료해 주세요.".into());
    }
    Ok(None)
}

#[tauri::command]
pub(super) async fn send_message(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    content: String,
    target: String,
    client_message_id: String,
) -> Result<(), String> {
    validate_target(&target)?;
    let content = content.trim();
    if content.is_empty() || content.chars().count() > 2000 {
        return Err("대화는 1~2,000자로 입력해 주세요.".into());
    }
    uuid::Uuid::parse_str(&client_message_id)
        .map_err(|_| "메시지 식별자가 올바르지 않아요.".to_string())?;
    let (token, registered) = {
        let _action = lock(&state.action)?;
        if state.stopping.load(Ordering::SeqCst) {
            return Err("앱을 종료하고 있어요.".into());
        }
        let db = lock(&state.db)?;
        let settings = store::settings(&db)?;
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
        let registered = route_message(&state, &db, content)?;
        store::insert_message(
            &db,
            &Message {
                id: client_message_id.clone(),
                role: "user".into(),
                persona: Some(target.clone()),
                content: content.into(),
                expression: None,
                created_at: now() * 1000,
                status: "complete".into(),
            },
        )?;
        let token = interrupt(&state, false)?;
        *lock(&state.panel)? = None;
        state.last_input.store(now(), Ordering::SeqCst);
        schedule_idle(&state, settings.idle_minutes);
        (token, registered)
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
        validate_target(&target)?
            .into_iter()
            .map(str::to_string)
            .collect(),
        client_message_id,
        token,
    );
    Ok(())
}

#[tauri::command]
pub(super) fn retry_turn(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    message_id: String,
    target: String,
) -> Result<(), String> {
    let (targets, token, registered) = {
        let _action = lock(&state.action)?;
        if state.stopping.load(Ordering::SeqCst) {
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
        let completed = validate_target(latest.persona.as_deref().unwrap_or(""))?
            .into_iter()
            .filter(|persona| {
                history
                    .iter()
                    .any(|m| m.id == reply_id(&message_id, persona) && m.status == "complete")
            })
            .map(str::to_string)
            .collect::<Vec<_>>();
        let targets =
            remaining_retry(latest.persona.as_deref().unwrap_or(""), &target, &completed)?;
        if targets.is_empty() && registered.is_none() {
            return Ok(());
        }
        store::resume_conversation(&db, chrono::Utc::now().timestamp_millis())?;
        let token = interrupt(&state, false)?;
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

pub(super) fn reply_id(message_id: &str, persona: &str) -> String {
    format!("reply:{message_id}:{persona}")
}
pub(super) fn ensure_retry_characters(
    db: &Connection,
    message_id: &str,
    target: &str,
) -> Result<(), String> {
    let identities = store::message_identities(db, 100)?;
    for persona in validate_target(target)? {
        let current = characters::active_character(db, persona)?;
        if !identities.iter().any(|identity| {
            identity.message_id == message_id
                && identity.persona == persona
                && identity.character_id == current.id
        }) {
            return Err("대화 상대가 바뀌었어요. 현재 캐릭터에게 새 메시지로 말해 주세요.".into());
        }
    }
    Ok(())
}
pub(super) fn remaining_retry(
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

pub(super) fn start_turn(
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
        "loading",
        targets.first().cloned(),
        None,
    );
    tauri::async_runtime::spawn(async move {
        let _guard = state.gate.lock().await;
        if !is_current(&state, epoch, &cancel) {
            return;
        }
        let result = run_turn(&app, &state, &targets, &message_id, epoch, cancel.clone()).await;
        if !is_current(&state, epoch, &cancel) {
            return;
        }
        state.last_foreground.store(now(), Ordering::SeqCst);
        match result {
            Ok(()) => phase(&app, &state, epoch, "idle", None, None),
            Err(error) => phase(
                &app,
                &state,
                epoch,
                "error",
                targets.first().cloned(),
                Some(error),
            ),
        }
    });
}

pub(super) fn turn_prompt(
    db: &Connection,
    targets: &[String],
    message_id: &str,
) -> Result<Vec<ChatMessage>, String> {
    let memories = store::memories(db)?;
    let relationships = store::relationships(db)?;
    match targets {
        [a, b] if a == "a" && b == "b" => {
            let histories = [
                story::prompt_history(db, "a", store::context_messages_for(db, 24, "a")?)?,
                story::prompt_history(db, "b", store::context_messages_for(db, 24, "b")?)?,
            ];
            let latest_user = histories[0]
                .iter()
                .find(|message| {
                    message.id == message_id
                        && message.role == "user"
                        && message.status == "complete"
                        && message.persona.as_deref() == Some("both")
                        && histories[1].iter().any(|other| other.id == message.id)
                })
                .ok_or("대화의 근거가 변경되었어요. 새 메시지로 말해 주세요.")?;
            Ok(domain::pair_prompt_messages(
                &[
                    story::profile(db, characters::active_character(db, "a")?)?,
                    story::profile(db, characters::active_character(db, "b")?)?,
                ],
                &histories,
                &memories,
                &relationships,
                latest_user,
            ))
        }
        [persona] if persona == "a" || persona == "b" => {
            let mut messages = store::context_messages_for(db, 24, persona)?;
            let is_pair_reply = messages.iter().any(|message| {
                message.id == message_id
                    && message.role == "user"
                    && message.status == "complete"
                    && message.persona.as_deref() == Some("both")
            });
            if is_pair_reply {
                let other = if persona == "a" { "b" } else { "a" };
                let previous = store::context_messages_for(db, 100, other)?;
                if let Some(reply) = previous.into_iter().find(|message| {
                    message.id == reply_id(message_id, other)
                        && message.role == "assistant"
                        && message.status == "complete"
                }) {
                    if !messages.iter().any(|message| message.id == reply.id) {
                        messages.push(reply);
                    }
                }
            }
            let messages = story::prompt_history(db, persona, messages)?;
            let score = relationships
                .iter()
                .find(|relationship| relationship.persona == *persona)
                .map_or(20, |relationship| relationship.score);
            Ok(domain::prompt_messages(
                persona,
                &story::profile(db, characters::active_character(db, persona)?)?,
                &messages,
                &memories,
                &Relationship {
                    persona: persona.clone(),
                    score,
                },
            ))
        }
        _ => Err("대화 상대를 선택해 주세요.".into()),
    }
}

pub(super) async fn generate_turn(
    state: &AppState,
    targets: &[String],
    message_id: &str,
    cancel: Arc<AtomicBool>,
) -> Result<(Vec<SceneLine>, i64), String> {
    let (settings, prompt, revision) = {
        let db = lock(&state.db)?;
        (
            store::settings(&db)?,
            turn_prompt(&db, targets, message_id)?,
            store::revision(&db)?,
        )
    };
    let paired = targets.len() == 2;
    let value = inference::generate(
        &state.inference,
        &settings,
        &prompt,
        if paired {
            domain::pair_reply_schema()
        } else {
            domain::reply_schema()
        },
        if paired { 512 } else { 256 },
        cancel,
    )
    .await?;
    let lines = if paired {
        domain::parse_pair_reply(value)?
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

pub(super) async fn run_turn(
    app: &tauri::AppHandle,
    state: &AppState,
    targets: &[String],
    message_id: &str,
    epoch: u64,
    cancel: Arc<AtomicBool>,
) -> Result<(), String> {
    if !is_current(state, epoch, &cancel) {
        return Ok(());
    }
    phase(
        app,
        state,
        epoch,
        "generating",
        targets.first().cloned(),
        None,
    );
    let (lines, revision) = generate_turn(state, targets, message_id, cancel.clone()).await?;
    for (index, line) in lines.iter().enumerate() {
        if !present_line(
            state,
            line,
            "llm",
            &reply_id(message_id, &line.persona),
            index,
            lines.len(),
            revision,
            epoch,
            &cancel,
            true,
        )? {
            return Ok(());
        }
        publish(app, state);
        wait_for_line(app, state, epoch, cancel.clone(), &line.text).await?;
    }
    Ok(())
}
