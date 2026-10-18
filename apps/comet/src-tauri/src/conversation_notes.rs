use crate::{app, diary, store, widgets::calendar::NoteReference};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::BTreeSet, sync::Arc};
use tauri::Emitter;

type Result<T> = std::result::Result<T, String>;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteOption {
    pub note_ref: NoteReference,
    pub body: String,
}

fn err(error: impl std::fmt::Display) -> String {
    error.to_string()
}

pub(crate) fn initialize(db: &Connection) -> Result<()> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS conversation_note_saves(
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

const NOTE_MEMORY_LIMIT: usize = 2;
const NOTE_MEMORY_CHARS: usize = 600;

fn terms(text: &str) -> BTreeSet<String> {
    let mut terms = BTreeSet::new();
    for word in text.split(|c: char| !c.is_alphanumeric()) {
        let chars: Vec<char> = word.to_lowercase().chars().collect();
        // Korean words carry trailing particles; also try the stem without one or two syllables.
        let cuts = if chars.iter().any(|c| ('가'..='힣').contains(c)) {
            2
        } else {
            0
        };
        for cut in 0..=cuts {
            if chars.len() >= cut + 2 {
                terms.insert(chars[..chars.len() - cut].iter().collect());
            }
        }
    }
    terms
}

fn clip(text: &str) -> String {
    let text = text.trim();
    let mut clipped: String = text.chars().take(NOTE_MEMORY_CHARS).collect();
    if clipped.len() < text.len() {
        clipped.push('…');
    }
    clipped
}

/// Memos are always part of the memory context: the notes that share words with the
/// current input are offered next to memories, never as a separately selected source.
pub(crate) fn note_memories(
    db: &Connection,
    message_id: &str,
) -> Result<Vec<crate::types::Memory>> {
    let input: Option<String> = db
        .query_row(
            "SELECT json_extract(data,'$.content') FROM messages WHERE id=?1 AND role='user'",
            [message_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(err)?;
    let wanted = terms(&input.unwrap_or_default());
    if wanted.is_empty() {
        return Ok(Vec::new());
    }
    let user = store::current_user(db)?;
    let mut scored = list_notes(db)?
        .into_iter()
        .rev()
        .filter_map(|note| {
            let title = terms(&note.note_ref.title);
            let body = terms(&note.body);
            let score =
                wanted.intersection(&title).count() * 2 + wanted.intersection(&body).count();
            (score > 0).then_some((score, note))
        })
        .collect::<Vec<_>>();
    scored.sort_by_key(|(score, _)| std::cmp::Reverse(*score));
    Ok(scored
        .into_iter()
        .take(NOTE_MEMORY_LIMIT)
        .map(|(_, note)| {
            let title = note.note_ref.title.trim();
            let body = clip(&note.body);
            crate::types::Memory {
                id: format!("note:{}:{}", note.note_ref.kind, note.note_ref.id),
                kind: "note".into(),
                content: if title.is_empty() {
                    body
                } else {
                    format!("{title}\n{body}")
                },
                user_id: user
                    .as_ref()
                    .map(|user| user.id.clone())
                    .unwrap_or_default(),
                user_name: user
                    .as_ref()
                    .map(|user| user.name.clone())
                    .unwrap_or_default(),
                ..Default::default()
            }
        })
        .collect())
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
pub(crate) async fn open_conversation_note(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<app::AppState>>,
    note_ref: NoteReference,
) -> Result<()> {
    read_note(&*app::lock(&state.db)?, &note_ref)?;
    if note_ref.kind == "memo" {
        crate::widgets::memo_notes::open_memo_note(
            app,
            state,
            note_ref.widget_id.ok_or("메모 도구를 찾을 수 없어요.")?,
            note_ref.id,
        )
        .await?;
        return Ok(());
    }
    crate::widgets::planning::windows::open_note(&app, &note_ref.id)
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
