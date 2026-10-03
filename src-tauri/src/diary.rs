use crate::app::{lock, AppState};
use chrono::{Datelike, NaiveDate};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use tauri::Emitter;

type Result<T> = std::result::Result<T, String>;

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiaryState {
    revision: u64,
    pages: Vec<Page>,
    notes: Vec<Note>,
    moves: Vec<Move>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct Page {
    id: String,
    title: String,
    date: Option<String>,
    entries: Vec<Entry>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct Entry {
    id: String,
    kind: EntryKind,
    text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    ref_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    item_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    time: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum EntryKind {
    Note,
    Todo,
    Event,
    Envelope,
    Widget,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct Note {
    id: String,
    title: String,
    body: String,
    pinned: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    envelope_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct Move {
    id: String,
    todo_id: String,
    from_date: String,
    to_date: String,
    title: String,
}

fn err(error: impl std::fmt::Display) -> String {
    error.to_string()
}

pub(crate) fn initialize(db: &Connection) -> Result<()> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS diary_state(id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);",
    )
    .map_err(err)?;
    db.execute(
        "INSERT OR IGNORE INTO diary_state(id,data) VALUES(1,?1)",
        [serde_json::to_string(&DiaryState::default()).map_err(err)?],
    )
    .map_err(err)?;
    Ok(())
}

fn read(db: &Connection) -> Result<DiaryState> {
    let raw: String = db
        .query_row("SELECT data FROM diary_state WHERE id=1", [], |row| {
            row.get(0)
        })
        .map_err(err)?;
    serde_json::from_str(&raw).map_err(err)
}

fn string(input: &Value, key: &str, limit: usize, required: bool) -> Result<String> {
    let value = input
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("{key} 문자열이 필요합니다."))?;
    if value.chars().count() > limit || (required && value.trim().is_empty()) {
        return Err(format!("{key} 길이가 올바르지 않습니다."));
    }
    Ok(value.into())
}

fn optional_string(input: &Value, key: &str, limit: usize) -> Result<Option<String>> {
    match input.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(_) => string(input, key, limit, true).map(Some),
    }
}

fn boolean(input: &Value, key: &str, fallback: bool) -> Result<bool> {
    match input.get(key) {
        None => Ok(fallback),
        Some(value) => value
            .as_bool()
            .ok_or_else(|| format!("{key} 값이 올바르지 않습니다.")),
    }
}

fn date(value: String) -> Result<String> {
    let parsed =
        NaiveDate::parse_from_str(&value, "%Y-%m-%d").map_err(|_| "날짜가 올바르지 않습니다.")?;
    if value.len() != 10 || parsed.year() < 1 || parsed.format("%Y-%m-%d").to_string() != value {
        return Err("날짜는 YYYY-MM-DD 형식이어야 합니다.".into());
    }
    Ok(value)
}

fn time(input: &Value, key: &str) -> Result<Option<String>> {
    if input.get(key).and_then(Value::as_str) == Some("") {
        return Ok(None);
    }
    let value = optional_string(input, key, 5)?;
    if let Some(value) = &value {
        let parsed = chrono::NaiveTime::parse_from_str(value, "%H:%M")
            .map_err(|_| "시각은 HH:MM 형식이어야 합니다.")?;
        if parsed.format("%H:%M").to_string() != *value {
            return Err("시각은 HH:MM 형식이어야 합니다.".into());
        }
    }
    Ok(value)
}

fn capacity(length: usize, limit: usize) -> Result<()> {
    if length >= limit {
        return Err(format!("항목은 {limit}개까지 저장할 수 있습니다."));
    }
    Ok(())
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn missing() -> String {
    "항목을 찾을 수 없습니다. 최신 다이어리를 다시 불러와 주세요.".into()
}

fn mutate(state: &mut DiaryState, action: &str, input: &Value) -> Result<()> {
    if !input.is_object() {
        return Err("다이어리 입력 형식이 올바르지 않습니다.".into());
    }
    match action {
        "page-create" => {
            let selected = optional_string(input, "date", 10)?.map(date).transpose()?;
            let title = string(input, "title", 500, selected.is_none())?;
            if selected.is_some() && state.pages.iter().any(|page| page.date == selected) {
                return Ok(());
            }
            capacity(state.pages.len(), 2000)?;
            state.pages.push(Page {
                id: new_id(),
                title,
                date: selected,
                entries: vec![],
            });
        }
        "page-update" | "page-delete" => {
            let id = string(input, "id", 200, true)?;
            let at = state
                .pages
                .iter()
                .position(|page| page.id == id)
                .ok_or_else(missing)?;
            if action == "page-delete" {
                state.pages.remove(at);
            } else {
                state.pages[at].title =
                    string(input, "title", 500, state.pages[at].date.is_none())?;
            }
        }
        "entry-add" | "entry-update" | "entry-delete" => {
            let page_id = string(input, "pageId", 200, true)?;
            let page = state
                .pages
                .iter_mut()
                .find(|page| page.id == page_id)
                .ok_or_else(missing)?;
            if action == "entry-add" {
                capacity(page.entries.len(), 2000)?;
                let kind: EntryKind = serde_json::from_value(input["kind"].clone())
                    .map_err(|_| "기록 종류가 올바르지 않습니다.")?;
                let ref_id = optional_string(input, "refId", 1000)?;
                let item_id = optional_string(input, "itemId", 1000)?;
                if item_id.is_some() && kind != EntryKind::Widget {
                    return Err("위젯 기록에만 항목을 연결할 수 있습니다.".into());
                }
                if matches!(
                    kind,
                    EntryKind::Todo | EntryKind::Envelope | EntryKind::Widget
                ) && ref_id.is_none()
                {
                    return Err("연결할 항목을 선택해 주세요.".into());
                }
                if ref_id.is_some()
                    && page.entries.iter().any(|entry| {
                        entry.kind == kind && entry.ref_id == ref_id && entry.item_id == item_id
                    })
                {
                    return Ok(());
                }
                page.entries.push(Entry {
                    id: new_id(),
                    kind,
                    ref_id,
                    item_id,
                    text: string(input, "text", 20000, true)?,
                    time: time(input, "time")?,
                });
            } else {
                let id = string(input, "id", 200, true)?;
                let at = page
                    .entries
                    .iter()
                    .position(|entry| entry.id == id)
                    .ok_or_else(missing)?;
                if action == "entry-delete" {
                    page.entries.remove(at);
                } else {
                    let entry = &mut page.entries[at];
                    if input.get("expectedText").is_some()
                        && string(input, "expectedText", 20000, false)? != entry.text
                        || input.get("expectedTime").is_some()
                            && time(input, "expectedTime")? != entry.time
                        || input.get("expectedRefId").is_some()
                            && optional_string(input, "expectedRefId", 1000)? != entry.ref_id
                    {
                        return Err("이 기록이 다른 화면에서 바뀌었어요. 입력을 보존했으니 최신 내용을 확인해 주세요.".into());
                    }
                    entry.text = string(input, "text", 20000, true)?;
                    if input.get("time").is_some() {
                        entry.time = time(input, "time")?;
                    }
                }
            }
        }
        "note-create" => {
            capacity(state.notes.len(), 2000)?;
            state.notes.push(Note {
                id: new_id(),
                title: string(input, "title", 500, false)?,
                body: string(input, "body", 20000, false)?,
                pinned: boolean(input, "pinned", false)?,
                envelope_id: optional_string(input, "envelopeId", 200)?,
            });
        }
        "note-update" | "note-delete" => {
            let id = string(input, "id", 200, true)?;
            let at = state
                .notes
                .iter()
                .position(|note| note.id == id)
                .ok_or_else(missing)?;
            if action == "note-delete" {
                state.notes.remove(at);
            } else {
                let note = &mut state.notes[at];
                if input.get("expectedTitle").is_some()
                    && string(input, "expectedTitle", 500, false)? != note.title
                    || input.get("expectedBody").is_some()
                        && string(input, "expectedBody", 20000, false)? != note.body
                {
                    return Err("이 메모가 다른 화면에서 바뀌었어요. 입력을 보존했으니 최신 내용을 확인해 주세요.".into());
                }
                if input.get("title").is_some() {
                    note.title = string(input, "title", 500, false)?;
                }
                if input.get("body").is_some() {
                    note.body = string(input, "body", 20000, false)?;
                }
                note.pinned = boolean(input, "pinned", note.pinned)?;
                if input.get("envelopeId").is_some() {
                    note.envelope_id = optional_string(input, "envelopeId", 200)?;
                }
            }
        }
        "move-record" => {
            capacity(state.moves.len(), 20000)?;
            let from_date = date(string(input, "fromDate", 10, true)?)?;
            let to_date = date(string(input, "toDate", 10, true)?)?;
            if from_date == to_date {
                return Err("다른 날짜를 선택해 주세요.".into());
            }
            state.moves.push(Move {
                id: new_id(),
                todo_id: string(input, "todoId", 200, true)?,
                from_date,
                to_date,
                title: string(input, "title", 500, true)?,
            });
        }
        _ => return Err("지원하지 않는 다이어리 동작입니다.".into()),
    }
    Ok(())
}

fn update(
    db: &Connection,
    expected_revision: u64,
    action: &str,
    input: &Value,
) -> Result<DiaryState> {
    let tx = db.unchecked_transaction().map_err(err)?;
    let mut state = read(&tx)?;
    if state.revision != expected_revision {
        return Err(
            "다른 화면에서 다이어리가 변경됐어요. 최신 내용을 불러와 다시 시도해 주세요.".into(),
        );
    }
    let before = state.clone();
    if action == "entry-add" && input["kind"] == "widget" {
        let id = string(input, "refId", 1000, true)?;
        let widget = crate::widgets::storage::get(&tx, &id)?;
        if !widget.installed {
            return Err("설치된 위젯만 연결할 수 있습니다.".into());
        }
        if let Some(item_id) = optional_string(input, "itemId", 1000)? {
            let exists = widget.kind == "memo"
                && widget.data["notes"].as_array().is_some_and(|notes| {
                    notes
                        .iter()
                        .any(|note| note["id"].as_str() == Some(&item_id))
                });
            if !exists {
                return Err("연결할 메모를 찾을 수 없습니다.".into());
            }
        }
    }
    mutate(&mut state, action, input)?;
    if action == "move-record" {
        let moved = state.moves.last().ok_or_else(missing)?;
        crate::widgets::storage::move_diary_todo(
            &tx,
            &moved.todo_id,
            &moved.from_date,
            &moved.to_date,
            &moved.title,
        )?;
    }
    if state != before {
        state.revision = state
            .revision
            .checked_add(1)
            .ok_or("다이어리 버전 범위를 벗어났습니다.")?;
        tx.execute(
            "UPDATE diary_state SET data=?1 WHERE id=1",
            params![serde_json::to_string(&state).map_err(err)?],
        )
        .map_err(err)?;
    }
    tx.commit().map_err(err)?;
    Ok(state)
}

#[tauri::command]
pub(crate) fn get_diary(state: tauri::State<'_, Arc<AppState>>) -> Result<DiaryState> {
    read(&*lock(&state.db)?)
}

#[tauri::command]
pub(crate) fn update_diary(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    expected_revision: u64,
    action: String,
    input: Value,
) -> Result<DiaryState> {
    let saved = {
        let _action = lock(&state.action)?;
        if crate::unavailable(&state) {
            return Err("앱을 종료하고 있어요.".into());
        }
        update(&*lock(&state.db)?, expected_revision, &action, &input)?
    };
    let _ = app.emit("diary-updated", &saved);
    if action == "move-record" {
        crate::widget_commands::publish_widgets(&app, &state);
    }
    Ok(saved)
}

#[cfg(test)]
mod tests;
