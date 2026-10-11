use crate::{app, diary, store, widgets::calendar::NoteReference};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::{atomic::Ordering, Arc};
use tauri::Emitter;

type Result<T> = std::result::Result<T, String>;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Checkpoint {
    pub text: String,
    pub saved_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NoteContext {
    pub note_ref: NoteReference,
    pub linked_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checkpoint: Option<Checkpoint>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteContextView {
    #[serde(flatten)]
    pub context: NoteContext,
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteOption {
    pub note_ref: NoteReference,
    pub body: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InputNote {
    context: NoteContext,
    // A missing/deleted source must not make keyword playback unavailable.
    source: Option<NoteOption>,
}

fn err(error: impl std::fmt::Display) -> String {
    error.to_string()
}

pub(crate) fn initialize(db: &Connection) -> Result<()> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS conversation_note_inputs(
            message_id TEXT PRIMARY KEY REFERENCES messages(id), data TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS conversation_note_saves(
            request_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, session_id TEXT NOT NULL,
            message_id TEXT NOT NULL, request TEXT NOT NULL, note_ref TEXT NOT NULL
        );",
    )
    .map_err(err)
}

fn diary_value(db: &Connection) -> Result<Value> {
    serde_json::to_value(diary::read(db)?).map_err(err)
}

pub(crate) fn read_note(db: &Connection, reference: &NoteReference) -> Result<NoteOption> {
    if reference.id.is_empty() || reference.id.len() > 200 {
        return Err("메모 식별자가 올바르지 않아요.".into());
    }
    let note = match reference.kind.as_str() {
        "diary" if reference.widget_id.is_none() => diary_value(db)?["notes"]
            .as_array()
            .and_then(|notes| notes.iter().find(|note| note["id"] == reference.id))
            .cloned(),
        "memo" => {
            let id = reference
                .widget_id
                .as_deref()
                .ok_or("메모 도구를 찾을 수 없어요.")?;
            let widget = crate::widgets::storage::get(db, id)?;
            if !widget.installed || widget.kind != "memo" {
                return Err("연결한 메모 도구를 찾을 수 없어요.".into());
            }
            widget.data["notes"]
                .as_array()
                .and_then(|notes| notes.iter().find(|note| note["id"] == reference.id))
                .cloned()
        }
        _ => return Err("지원하지 않는 메모 종류예요.".into()),
    }
    .ok_or("연결한 메모를 찾을 수 없어요. 다른 메모를 선택해 주세요.")?;
    Ok(NoteOption {
        note_ref: NoteReference {
            title: note["title"].as_str().unwrap_or_default().into(),
            ..reference.clone()
        },
        body: note["body"].as_str().unwrap_or_default().into(),
    })
}

pub(crate) fn resolve(db: &Connection, context: &NoteContext) -> NoteContextView {
    let source = read_note(db, &context.note_ref).ok();
    let mut context = context.clone();
    if let Some(source) = &source {
        context.note_ref = source.note_ref.clone();
    }
    NoteContextView {
        context,
        available: source.is_some(),
        body: source.map(|source| source.body),
    }
}

pub(crate) fn capture_input(
    db: &Connection,
    session: &store::ConversationSession,
    message_id: &str,
) -> Result<()> {
    if let Some(context) = &session.note_context {
        let input = InputNote {
            context: context.clone(),
            source: read_note(db, &context.note_ref).ok(),
        };
        db.execute(
            "INSERT INTO conversation_note_inputs(message_id,data) VALUES(?1,?2)",
            params![message_id, serde_json::to_string(&input).map_err(err)?],
        )
        .map_err(err)?;
    }
    Ok(())
}

fn input_note(db: &Connection, message_id: &str) -> Result<Option<InputNote>> {
    let raw: Option<String> = db
        .query_row(
            "SELECT data FROM conversation_note_inputs WHERE message_id=?1",
            [message_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(err)?;
    raw.map(|raw| serde_json::from_str(&raw).map_err(err))
        .transpose()
}

pub(crate) fn has_input(db: &Connection, message_id: &str) -> Result<bool> {
    Ok(input_note(db, message_id)?.is_some())
}

const CHANGED: &str =
    "참고 메모가 바뀌었거나 연결이 해제됐어요. 현재 메모를 확인하고 새 메시지로 말해 주세요.";

fn validate_input(db: &Connection, message_id: &str, input: &InputNote) -> Result<()> {
    if store::message_user_id(db, message_id)? != store::active_user_id(db)? {
        return Err("이 사용자의 참고 메모를 찾을 수 없어요.".into());
    }
    let session = store::conversation_for_message(db, message_id)?.ok_or(CHANGED)?;
    let current = session.note_context.as_ref().ok_or(CHANGED)?;
    if current.note_ref.kind != input.context.note_ref.kind
        || current.note_ref.id != input.context.note_ref.id
        || current.note_ref.widget_id != input.context.note_ref.widget_id
        || current.linked_at != input.context.linked_at
    {
        return Err(CHANGED.into());
    }
    let source = input.source.as_ref().ok_or(CHANGED)?;
    let current = read_note(db, &source.note_ref).map_err(|_| CHANGED.to_string())?;
    if current.note_ref != source.note_ref || current.body != source.body {
        return Err(CHANGED.into());
    }
    Ok(())
}

pub(crate) fn prompt_context(db: &Connection, message_id: &str) -> Result<Option<Value>> {
    let Some(input) = input_note(db, message_id)? else {
        return Ok(None);
    };
    validate_input(db, message_id, &input)?;
    Ok(Some(
        json!({"source":input.source,"linkedAt":input.context.linked_at,"checkpoint":input.context.checkpoint,"ownership":"shared_app_record_not_a_user_fact"}),
    ))
}

pub(crate) fn validate_reply(db: &Connection, reply_id: &str) -> Result<()> {
    let Some(input_id) = reply_input_id(reply_id) else {
        return Ok(());
    };
    if let Some(input) = input_note(db, input_id)? {
        validate_input(db, input_id, &input)?;
    }
    Ok(())
}

fn reply_input_id(id: &str) -> Option<&str> {
    id.strip_prefix("reply:")
        .and_then(|rest| rest.split_once(':').map(|(id, _)| id))
}

pub(crate) fn history_allowed(
    db: &Connection,
    current_input: &str,
    message: &crate::types::Message,
) -> Result<bool> {
    let Some(previous_input) = reply_input_id(&message.id) else {
        return Ok(true);
    };
    let Some(previous) = input_note(db, previous_input)? else {
        return Ok(true);
    };
    let Some(current) = input_note(db, current_input)? else {
        return Ok(false);
    };
    Ok(validate_input(db, previous_input, &previous).is_ok()
        && previous
            .source
            .as_ref()
            .zip(current.source.as_ref())
            .is_some_and(|(a, b)| a.note_ref == b.note_ref && a.body == b.body))
}

fn save_context(db: &Connection, session_id: &str, context: Option<&NoteContext>) -> Result<()> {
    db.execute(
        "UPDATE conversation_sessions SET note_context=?2,updated_at=MAX(updated_at,?3) WHERE id=?1",
        params![
            session_id,
            context
                .map(serde_json::to_string)
                .transpose()
                .map_err(err)?,
            chrono::Utc::now().timestamp_millis()
        ],
    )
    .map_err(err)?;
    Ok(())
}

#[tauri::command]
pub(crate) fn get_conversation_notes(
    state: tauri::State<'_, Arc<app::AppState>>,
) -> Result<Vec<NoteOption>> {
    list_notes(&*app::lock(&state.db)?)
}

fn list_notes(db: &Connection) -> Result<Vec<NoteOption>> {
    let mut result = Vec::new();
    for note in diary_value(db)?["notes"].as_array().into_iter().flatten() {
        let Some(id) = note["id"].as_str() else {
            continue;
        };
        result.push(NoteOption {
            note_ref: NoteReference {
                kind: "diary".into(),
                id: id.into(),
                widget_id: None,
                title: note["title"].as_str().unwrap_or_default().into(),
            },
            body: note["body"].as_str().unwrap_or_default().into(),
        });
    }
    for widget in crate::widgets::storage::instances(db)?
        .into_iter()
        .filter(|widget| widget.installed && widget.kind == "memo")
    {
        for note in widget.data["notes"].as_array().into_iter().flatten() {
            let Some(id) = note["id"].as_str() else {
                continue;
            };
            result.push(NoteOption {
                note_ref: NoteReference {
                    kind: "memo".into(),
                    id: id.into(),
                    widget_id: Some(widget.id.clone()),
                    title: note["title"].as_str().unwrap_or_default().into(),
                },
                body: note["body"].as_str().unwrap_or_default().into(),
            });
        }
    }
    Ok(result)
}

#[tauri::command]
pub(crate) fn set_conversation_note_context(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<app::AppState>>,
    session_id: Option<String>,
    note_ref: Option<NoteReference>,
    persona: Option<String>,
) -> Result<()> {
    let epoch = {
        let _action = app::lock(&state.action)?;
        if app::unavailable(&state) {
            return Err("앱을 종료하고 있어요.".into());
        }
        let db = app::lock(&state.db)?;
        app::conversation::ensure_available(&db)?;
        if store::current_user(&db)?.is_none() {
            return Err("말풍선에서 이름을 먼저 알려 주세요.".into());
        }
        let source = note_ref
            .as_ref()
            .map(|reference| read_note(&db, reference))
            .transpose()?;
        let active = store::active_conversation(&db)?;
        if active.is_none() && source.is_none() {
            return Err("연결을 바꿀 대화를 먼저 열어 주세요.".into());
        }
        if session_id
            .as_ref()
            .is_some_and(|id| active.as_ref().is_none_or(|session| session.id != *id))
        {
            return Err("현재 대화가 바뀌었어요. 입력한 내용을 확인해 주세요.".into());
        }
        let requested = persona
            .as_ref()
            .map(|persona| {
                crate::characters::active_character(&db, persona).map(|character| character.id)
            })
            .transpose()?;
        let active = active.filter(|session| {
            session_id.is_some()
                || requested
                    .as_ref()
                    .is_none_or(|id| session.participants == [id.clone()])
        });
        let session = match active {
            Some(session) => session,
            None => {
                let id = requested
                    .or_else(|| crate::characters::active_ids(&db).ok()?.into_iter().next())
                    .ok_or("대화할 친구를 선택해 주세요.")?;
                store::create_conversation(
                    &db,
                    &[id],
                    None,
                    None,
                    chrono::Utc::now().timestamp_millis(),
                )?
            }
        };
        let context = source.map(|source| NoteContext {
            note_ref: source.note_ref,
            linked_at: chrono::Utc::now().timestamp_millis().max(
                session
                    .note_context
                    .as_ref()
                    .map_or(0, |context| context.linked_at.saturating_add(1)),
            ),
            checkpoint: None,
        });
        save_context(&db, &session.id, context.as_ref())?;
        app::presence::summon_locked(&state, &session.participants[0])?;
        let epoch = app::interrupt(&state, false)?.0;
        *app::lock(&state.panel)? = Some(crate::types::PanelState {
            persona: session.participants[0].clone(),
            mode: "input".into(),
        });
        state.last_input.store(app::now(), Ordering::SeqCst);
        epoch
    };
    crate::desktop::request_balloon_focus(&app)?;
    app::phase(
        &app,
        &state,
        epoch,
        crate::types::RuntimePhase::Idle,
        None,
        None,
    );
    Ok(())
}

#[tauri::command]
pub(crate) async fn open_conversation_note(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<app::AppState>>,
    note_ref: NoteReference,
) -> Result<()> {
    read_note(&*app::lock(&state.db)?, &note_ref)?;
    if note_ref.kind == "memo" {
        crate::memo_notes::open_memo_note(
            app,
            state,
            note_ref.widget_id.ok_or("메모 도구를 찾을 수 없어요.")?,
            note_ref.id,
        )
        .await?;
        return Ok(());
    }
    crate::planner_windows::open_note(&app, &note_ref.id)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveRequest<'a> {
    session_id: &'a str,
    message_id: &'a str,
    text: &'a str,
    note_id: Option<&'a str>,
    title: Option<&'a str>,
    #[serde(skip_serializing)]
    expected_body: Option<&'a str>,
    checkpoint: bool,
}

fn save_note(
    db: &Connection,
    request_id: &str,
    request: &SaveRequest<'_>,
) -> Result<NoteReference> {
    uuid::Uuid::parse_str(request_id)
        .map_err(|_| "저장 요청 식별자가 올바르지 않아요.".to_string())?;
    if request.text.trim().is_empty() || request.text.chars().count() > 20_000 {
        return Err("남길 내용을 1~20,000자로 적어 주세요.".into());
    }
    let tx = db.unchecked_transaction().map_err(err)?;
    let user = store::active_user_id(&tx)?;
    let session = store::conversation(&tx, request.session_id)?;
    let fingerprint = serde_json::to_string(request).map_err(err)?;
    let saved: Option<(String, String, String)> = tx
        .query_row(
            "SELECT user_id,request,note_ref FROM conversation_note_saves WHERE request_id=?1",
            [request_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(err)?;
    if let Some((owner, previous, reference)) = saved {
        if owner != user || previous != fingerprint {
            return Err("다른 내용에 사용된 저장 요청이에요. 내용을 확인해 주세요.".into());
        }
        return serde_json::from_str(&reference).map_err(err);
    }
    let raw: Option<String> = tx.query_row(
        "SELECT m.data FROM messages m JOIN conversation_messages cm ON cm.message_id=m.id JOIN message_users u ON u.message_id=m.id WHERE cm.conversation_id=?1 AND m.id=?2 AND u.user_id=?3",
        params![request.session_id,request.message_id,user], |row| row.get(0),
    ).optional().map_err(err)?;
    let message: crate::types::Message =
        serde_json::from_str(&raw.ok_or("남길 대화 원문을 찾을 수 없어요.")?).map_err(err)?;
    if message.status != "complete"
        || (message.role != "user"
            && (message.role != "assistant" || !store::message_displayed(&tx, &message.id)?))
    {
        return Err("화면에서 확인한 대화만 메모로 남길 수 있어요.".into());
    }
    let diary = diary_value(&tx)?;
    let revision = diary["revision"]
        .as_u64()
        .ok_or("다이어리 버전을 확인할 수 없어요.")?;
    let id = if let Some(id) = request.note_id {
        let reference = NoteReference {
            kind: "diary".into(),
            id: id.into(),
            widget_id: None,
            title: String::new(),
        };
        let current = read_note(&tx, &reference)?;
        let expected = request
            .expected_body
            .ok_or("기존 메모 본문을 확인한 뒤 다시 저장해 주세요.")?;
        if current.body != expected {
            return Err(
                "메모가 다른 화면에서 바뀌었어요. 입력을 보존했으니 최신 내용을 확인해 주세요."
                    .into(),
            );
        }
        let body = if current.body.is_empty() {
            request.text.to_string()
        } else {
            format!("{}\n\n{}", current.body, request.text)
        };
        diary::update_in_transaction(
            &tx,
            revision,
            "note-update",
            &json!({"id":id,"body":body,"expectedBody":expected}),
        )?;
        id.to_string()
    } else {
        let saved = diary::update_in_transaction(
            &tx,
            revision,
            "note-create",
            &json!({"title":request.title.unwrap_or("대화에서 남긴 메모"),"body":request.text,"pinned":false}),
        )?;
        let value = serde_json::to_value(&saved).map_err(err)?;
        let id = value["notes"]
            .as_array()
            .and_then(|notes| notes.last())
            .and_then(|note| note["id"].as_str())
            .ok_or("저장한 메모를 확인할 수 없어요.")?
            .to_string();
        id
    };
    let reference = read_note(
        &tx,
        &NoteReference {
            kind: "diary".into(),
            id,
            widget_id: None,
            title: String::new(),
        },
    )?
    .note_ref;
    if request.checkpoint {
        let at = chrono::Utc::now().timestamp_millis();
        let context = NoteContext {
            note_ref: reference.clone(),
            linked_at: at.max(
                session
                    .note_context
                    .as_ref()
                    .map_or(0, |context| context.linked_at.saturating_add(1)),
            ),
            checkpoint: Some(Checkpoint {
                text: request.text.into(),
                saved_at: at,
            }),
        };
        save_context(&tx, &session.id, Some(&context))?;
    }
    tx.execute(
        "INSERT INTO conversation_note_saves VALUES(?1,?2,?3,?4,?5,?6)",
        params![
            request_id,
            user,
            session.id,
            request.message_id,
            fingerprint,
            serde_json::to_string(&reference).map_err(err)?
        ],
    )
    .map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(reference)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub(crate) fn save_conversation_note(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<app::AppState>>,
    session_id: String,
    message_id: String,
    text: String,
    request_id: String,
    note_id: Option<String>,
    title: Option<String>,
    expected_body: Option<String>,
    checkpoint: Option<bool>,
) -> Result<NoteReference> {
    let reference = {
        let _action = app::lock(&state.action)?;
        if app::unavailable(&state) {
            return Err("앱을 종료하고 있어요.".into());
        }
        save_note(
            &*app::lock(&state.db)?,
            &request_id,
            &SaveRequest {
                session_id: &session_id,
                message_id: &message_id,
                text: &text,
                note_id: note_id.as_deref(),
                title: title.as_deref(),
                expected_body: expected_body.as_deref(),
                checkpoint: checkpoint.unwrap_or(false),
            },
        )?
    };
    let diary = diary::read(&*app::lock(&state.db)?)?;
    let _ = app.emit("diary-updated", diary);
    app::publish(&app, &state);
    Ok(reference)
}

#[cfg(test)]
mod tests;
