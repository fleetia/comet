use crate::{
    diary, store,
    widgets::{storage, WidgetRequest},
};
use chrono::{Datelike, Timelike};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

mod catalog;
mod registry;
pub(crate) use catalog::catalog;
pub(crate) use registry::{
    authorize_evidence, authorize_registry, context_targets, entities_for, execute_registry,
    has_explicit_request, query_registry,
};
#[cfg(test)]
mod registry_tests;

type Result<T> = std::result::Result<T, String>;
const ENTITY_TEXT_LIMIT: usize = 300;
fn err(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Receipt {
    pub id: String,
    pub input_id: String,
    pub title: String,
    pub kind: String,
    pub target_id: String,
    pub created_at: i64,
    pub undone: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub undo_supported: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub undo_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Action {
    pub kind: String,
    pub target_id: String,
    pub expected_revision: i64,
    pub input: Value,
}

pub(crate) fn initialize(db: &Connection) -> Result<()> {
    registry::initialize(db)?;
    db.execute_batch("CREATE TABLE IF NOT EXISTS organizer_action_receipts(
        id TEXT PRIMARY KEY,user_id TEXT NOT NULL,input_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL,receipt TEXT NOT NULL,container TEXT NOT NULL,
        collection TEXT NOT NULL,before_items TEXT NOT NULL,after_items TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS organizer_turns(user_id TEXT NOT NULL,input_id TEXT NOT NULL,
        context TEXT NOT NULL,PRIMARY KEY(user_id,input_id));
        CREATE TABLE IF NOT EXISTS organizer_turn_records(user_id TEXT NOT NULL,input_id TEXT NOT NULL,record_id TEXT NOT NULL,PRIMARY KEY(user_id,input_id,record_id));") .map_err(err)
}

pub(crate) fn receipts(db: &Connection, user: &str, input: Option<&str>) -> Result<Vec<Receipt>> {
    let mut query = db.prepare("SELECT receipt FROM organizer_action_receipts WHERE user_id=?1 AND (?2 IS NULL OR input_id=?2) ORDER BY rowid DESC LIMIT 100").map_err(err)?;
    let mut result: Vec<Receipt> = query
        .query_map(params![user, input], |row| row.get::<_, String>(0))
        .map_err(err)?
        .map(|row| serde_json::from_str(&row.map_err(err)?).map_err(err))
        .collect::<Result<_>>()?;
    let mut query=db.prepare("SELECT t.input_id,r.data,r.state FROM organizer_turn_records t JOIN organizer_records r ON r.id=t.record_id AND r.user_id=t.user_id WHERE t.user_id=?1 AND (?2 IS NULL OR t.input_id=?2) ORDER BY r.created_at DESC LIMIT 100").map_err(err)?;
    let summaries = query
        .query_map(params![user, input], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(err)?;
    for row in summaries {
        let (input_id, raw, state) = row.map_err(err)?;
        let record: crate::organizer::OrganizerRecord = serde_json::from_str(&raw).map_err(err)?;
        result.push(Receipt {
            id: record.id,
            input_id,
            title: record.title,
            kind: "summary".into(),
            target_id: record.source.id.clone(),
            created_at: record.created_at,
            undone: state == "undone",
            source_id: Some(record.source.id),
            undo_supported: None,
            undo_reason: None,
            result: None,
        });
    }
    for receipt in crate::widgets::generated::actions::receipts(db, user, input)? {
        result.push(Receipt {
            id: receipt.id,
            input_id: receipt.input_id,
            title: receipt.title,
            kind: receipt.action_id,
            target_id: receipt.widget_id,
            created_at: receipt.created_at,
            undone: receipt.undone,
            source_id: None,
            undo_supported: Some(receipt.undo_supported),
            undo_reason: None,
            result: Some(receipt.result),
        });
    }
    result.sort_by_key(|r| std::cmp::Reverse(r.created_at));
    Ok(result)
}

/// A receipt-based reply for `input` when the character's `reply` does not name every change the
/// input saved or claims it failed. Small models describe other results than the stored one;
/// the receipt states what was kept. `None` keeps the reply, also for kinds without a sentence.
pub(crate) fn receipt_reply(
    db: &Connection,
    user: &str,
    input: &str,
    reply: &str,
) -> Result<Option<String>> {
    let saved: Vec<Receipt> = receipts(db, user, Some(input))?
        .into_iter()
        .filter(|receipt| !receipt.undone)
        .collect();
    let sentences: Option<Vec<String>> = saved.iter().map(receipt_sentence).collect();
    let Some(sentences) = sentences.filter(|sentences| !sentences.is_empty()) else {
        return Ok(None);
    };
    let lower = reply.to_lowercase();
    let names_all = saved.iter().all(|receipt| {
        let title = receipt.title.split(" · ").next().unwrap_or_default().trim();
        !title.is_empty() && lower.contains(&title.to_lowercase())
    });
    let claims_failure = [
        "비어 있",
        "못 했",
        "못했",
        "실패했",
        "저장하지 못",
        "안 됐",
        "안됐",
    ]
    .iter()
    .any(|phrase| reply.contains(phrase));
    Ok((!names_all || claims_failure).then(|| sentences.join(" ")))
}

fn receipt_sentence(receipt: &Receipt) -> Option<String> {
    let (feature, action) = receipt.kind.split_once('_')?;
    let object = match feature {
        "task" => "할 일을",
        "note" => "메모를",
        "memo" => "바탕화면 메모를",
        "event" => "일정을",
        "ledger" => "가계부 기록을",
        _ => return None,
    };
    let done = match action {
        "add" | "create" => "추가했어요",
        "update" => "고쳤어요",
        "delete" => "지웠어요",
        "complete" => "완료로 표시했어요",
        "undo" => "다시 열었어요",
        _ => return None,
    };
    Some(format!("'{}' {object} {done}.", receipt.title))
}

/// The app's own reply to an input whose organizer turn ran app actions: what each operation
/// saved or found, or the question the plan waits on. Small models describe other results than the
/// stored ones, so their replies to such turns come from here. `None` when the turn ran nothing or
/// an operation has no sentence; the model then replies.
pub(crate) fn result_reply(db: &Connection, user: &str, input: &str) -> Result<Option<String>> {
    let Some(raw) = turn_context(db, user, input)? else {
        return Ok(None);
    };
    let turn: Value = serde_json::from_str(&raw).unwrap_or(Value::Null);
    if turn["state"] == "awaiting_input" {
        return Ok(turn["question"]
            .as_str()
            .map(str::trim)
            .filter(|question| !question.is_empty())
            .map(str::to_owned));
    }
    let Some(operations) = turn["operations"]
        .as_array()
        .filter(|operations| !operations.is_empty())
    else {
        return Ok(None);
    };
    let mut sentences = vec![];
    for operation in operations {
        let kind = operation["proposal"]["kind"].as_str().unwrap_or_default();
        let read = operation["effect"] == "read";
        let sentence = if read {
            let input = operation["proposal"]["inputJson"]
                .as_str()
                .and_then(|input| serde_json::from_str(input).ok())
                .unwrap_or(Value::Null);
            lookup_sentence(kind, &operation["result"], &input)
        } else {
            serde_json::from_value::<Receipt>(operation["result"].clone())
                .ok()
                .filter(|receipt| !receipt.undone)
                .and_then(|receipt| {
                    let input = operation["proposal"]["inputJson"].as_str()?;
                    change_sentence(&receipt, &serde_json::from_str(input).ok()?)
                })
        };
        let Some(sentence) = sentence else {
            return Ok(None);
        };
        let empty = read && operation["result"]["totalCount"].as_u64() == Some(0);
        sentences.push((sentence, read, empty));
    }
    // Looking in several places, a place that had nothing goes unmentioned.
    if sentences.iter().any(|(_, read, empty)| *read && !*empty) {
        sentences.retain(|(_, read, empty)| !(*read && *empty));
    }
    let sentences: Vec<String> = sentences
        .into_iter()
        .map(|(sentence, _, _)| sentence)
        .collect();
    Ok(Some(sentences.join(" ")))
}

/// [`receipt_sentence`], naming the new date of a rescheduled task.
fn change_sentence(receipt: &Receipt, input: &Value) -> Option<String> {
    let sentence = receipt_sentence(receipt)?;
    if receipt.kind != "task_update" {
        return Some(sentence);
    }
    let (label, value) = if let Some(at) = input["dueAt"].as_i64() {
        ("마감", spoken_time(at)?)
    } else if let Some(date) = input["dueDate"].as_str() {
        ("마감", spoken_date(date)?)
    } else if let Some(date) = input["plannedDate"].as_str() {
        ("계획 날짜", spoken_date(date)?)
    } else {
        return Some(sentence);
    };
    Some(format!(
        "'{}' 할 일의 {label}{} {value}{} 바꿨어요.",
        receipt.title,
        particle(label, "을", "를"),
        particle(&value, "으로", "로"),
    ))
}

/// What a lookup found, from the app's own query result for `input`.
fn lookup_sentence(kind: &str, result: &Value, input: &Value) -> Option<String> {
    if kind == "ledger_query" {
        let count = result["totalCount"].as_u64()?;
        let expense = grouped(result["expenseTotal"].as_u64()?);
        let income = grouped(result["incomeTotal"].as_u64()?);
        return Some(match input["kind"].as_str() {
            Some("expense") => format!("지출 {count}건, 모두 {expense}원이에요."),
            Some("income") => format!("수입 {count}건, 모두 {income}원이에요."),
            _ => format!("가계부 기록 {count}건, 지출 {expense}원, 수입 {income}원이에요."),
        });
    }
    let (field, noun) = match kind {
        "task_query" => ("items", "할 일"),
        "note_query" => ("notes", "메모"),
        "memo_query" => ("notes", "바탕화면 메모"),
        "event_query" => ("events", "일정"),
        _ => return None,
    };
    let rows = result[field].as_array()?;
    let count = result["totalCount"].as_u64().unwrap_or(rows.len() as u64);
    let detail = |row: &Value| -> Option<String> {
        if kind == "task_query" {
            if row["completedAt"].is_i64() {
                return Some("완료".into());
            }
            if let Some(at) = row["dueAt"].as_i64() {
                return Some(format!("{} 마감", spoken_time(at)?));
            }
            if let Some(date) = row["dueDate"].as_str() {
                return Some(format!("{} 마감", spoken_date(date)?));
            }
            return row["plannedDate"].as_str().and_then(spoken_date);
        }
        if kind == "event_query" {
            if let Some(at) = row["startAt"].as_i64() {
                return spoken_time(at);
            }
            return row["startDate"].as_str().and_then(spoken_date);
        }
        let body: String = row["body"]
            .as_str()?
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        let preview: String = body.chars().take(40).collect();
        (!preview.is_empty()).then(|| {
            if preview.chars().count() < body.chars().count() {
                format!("{preview}…")
            } else {
                preview
            }
        })
    };
    let title = |row: &Value| row["title"].as_str().unwrap_or_default().trim().to_owned();
    Some(match rows.as_slice() {
        [] => format!("찾는 {noun}{} 없어요.", particle(noun, "이", "가")),
        [row] if count == 1 => match detail(row) {
            Some(detail) if field == "notes" => format!("'{}' {noun}: {detail}", title(row)),
            Some(detail) => format!("'{}' {noun}: {detail}.", title(row)),
            None => format!(
                "'{}' {noun}{} 있어요.",
                title(row),
                particle(noun, "이", "가")
            ),
        },
        rows => {
            let shown: Vec<String> = rows
                .iter()
                .take(3)
                .map(|row| match detail(row).filter(|_| field != "notes") {
                    Some(detail) => format!("'{}'({detail})", title(row)),
                    None => format!("'{}'", title(row)),
                })
                .collect();
            let rest = count.saturating_sub(shown.len() as u64);
            let rest = if rest > 0 {
                format!(" 외 {rest}개")
            } else {
                String::new()
            };
            format!("{noun} {count}개를 찾았어요: {}{rest}.", shown.join(", "))
        }
    })
}

fn spoken_date(date: &str) -> Option<String> {
    let date = chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").ok()?;
    let year = if date.year() == chrono::Local::now().year() {
        String::new()
    } else {
        format!("{}년 ", date.year())
    };
    Some(format!("{year}{}월 {}일", date.month(), date.day()))
}

fn spoken_time(at: i64) -> Option<String> {
    let at = chrono::DateTime::from_timestamp_millis(at)?.with_timezone(&chrono::Local);
    let date = spoken_date(&at.format("%Y-%m-%d").to_string())?;
    let (half, hour) = match at.hour() {
        0 => ("오전", 12),
        hour @ 1..=11 => ("오전", hour),
        12 => ("오후", 12),
        hour => ("오후", hour - 12),
    };
    let minute = match at.minute() {
        0 => String::new(),
        minute => format!(" {minute}분"),
    };
    Some(format!("{date} {half} {hour}시{minute}"))
}

fn grouped(amount: u64) -> String {
    let digits = amount.to_string();
    let mut grouped = String::new();
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index) % 3 == 0 {
            grouped.push(',');
        }
        grouped.push(digit);
    }
    grouped
}

/// The particle form for `word`: `with_final` after a final consonant. 로 also follows ㄹ.
fn particle(word: &str, with_final: &'static str, without_final: &'static str) -> &'static str {
    let last = word.chars().rev().find(|c| !c.is_whitespace());
    let final_consonant = last
        .filter(|c| ('가'..='힣').contains(c))
        .map(|c| (c as u32 - '가' as u32) % 28);
    match final_consonant {
        Some(0) | None => without_final,
        Some(8) if without_final == "로" => without_final,
        Some(_) => with_final,
    }
}

pub(crate) fn link_summary(
    db: &Connection,
    user: &str,
    input: &str,
    record_id: &str,
) -> Result<()> {
    db.execute(
        "INSERT OR IGNORE INTO organizer_turn_records VALUES(?1,?2,?3)",
        params![user, input, record_id],
    )
    .map_err(err)?;
    Ok(())
}

pub(crate) fn open_result(
    db: &Connection,
    user: &str,
    id: &str,
) -> Result<crate::organizer::SourceDocument> {
    if store::active_user_id(db)? != user {
        return Err("사용자가 변경되어 결과를 열지 않았어요.".into());
    }
    let row:Option<(String,String,String,String)>=db.query_row("SELECT receipt,container,collection,after_items FROM organizer_action_receipts WHERE id=?1 AND user_id=?2",params![id,user],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional().map_err(err)?;
    let Some((raw, container, collection, after)) = row else {
        let record = crate::organizer::list_records(db, user, 500)?
            .into_iter()
            .find(|record| record.id == id)
            .ok_or("작업 결과를 찾지 못했어요.")?;
        crate::organizer::read_sources(db, user, std::slice::from_ref(&record.source.id))?;
        return Ok(crate::organizer::SourceDocument {
            source: record.source,
            content: record.markdown,
        });
    };
    let receipt: Receipt = serde_json::from_str(&raw).map_err(err)?;
    if let Some(result) = registry::open_result(db, user, &receipt)? {
        return Ok(result);
    }
    let current = if container == "diary" {
        serde_json::to_value(diary::read(db)?).map_err(err)?
    } else {
        storage::get(db, &container)?.data
    };
    let item = current[&collection]
        .as_array()
        .and_then(|items| items.iter().find(|v| v["id"] == receipt.target_id))
        .cloned();
    let saved: Vec<Value> = serde_json::from_str(&after).map_err(err)?;
    let saved = saved.iter().find(|value| value["id"] == receipt.target_id);
    let mut content = if receipt.undone {
        "이 작업은 되돌렸어요.\n\n".to_string()
    } else {
        String::new()
    };
    if let Some(saved) = saved {
        content.push_str(&format!("저장 당시\n{}", display_item(saved)));
    }
    if let Some(current) = item {
        if saved != Some(&current) {
            content.push_str(&format!("\n\n현재 기록\n{}", display_item(&current)));
        }
    } else {
        content.push_str("\n\n현재 원본 항목이 없어요.");
    }
    Ok(crate::organizer::SourceDocument {
        source: crate::organizer::SourceRef {
            id: receipt.id,
            user_id: user.into(),
            workspace_id: "comet".into(),
            project_id: String::new(),
            kind: receipt.kind,
            locator: receipt.target_id,
            title: receipt.title,
            content_hash: crate::organizer::hash(&content),
            active: true,
        },
        content,
    })
}

fn display_item(item: &Value) -> String {
    let mut lines = vec![];
    for (key, label) in [
        ("title", "제목"),
        ("body", "본문"),
        ("memo", "메모"),
        ("description", "설명"),
        ("location", "장소"),
        ("plannedDate", "계획일"),
        ("dueDate", "기한"),
        ("startDate", "시작일"),
        ("endDate", "종료일"),
    ] {
        if let Some(value) = item[key].as_str().filter(|value| !value.is_empty()) {
            lines.push(format!("{label}: {value}"));
        }
    }
    for (key, label) in [
        ("dueAt", "기한"),
        ("startAt", "시작"),
        ("endAt", "종료"),
        ("completedAt", "완료 시각"),
    ] {
        if let Some(value) = item[key]
            .as_i64()
            .and_then(chrono::DateTime::from_timestamp_millis)
        {
            lines.push(format!(
                "{label}: {}",
                value
                    .with_timezone(&chrono::Local)
                    .format("%Y-%m-%d %H:%M %:z")
            ));
        }
    }
    if item.get("completedAt").is_some_and(Value::is_null) {
        lines.push("상태: 미완료".into());
    }
    lines.join("\n")
}

pub(crate) fn turn_context(db: &Connection, user: &str, input: &str) -> Result<Option<String>> {
    db.query_row(
        "SELECT context FROM organizer_turns WHERE user_id=?1 AND input_id=?2",
        params![user, input],
        |r| r.get(0),
    )
    .optional()
    .map_err(err)
}

pub(crate) fn save_turn(db: &Connection, user: &str, input: &str, context: &str) -> Result<()> {
    db.execute("INSERT INTO organizer_turns VALUES(?1,?2,?3) ON CONFLICT(user_id,input_id) DO UPDATE SET context=excluded.context",params![user,input,context]).map_err(err)?;
    Ok(())
}

pub(crate) fn replay_context(db: &Connection, user: &str, input: &str) -> Result<Option<Value>> {
    if store::active_user_id(db)? != user {
        return Err("사용자가 변경되어 이전 실행 결과를 사용하지 않았어요.".into());
    }
    let Some(raw) = turn_context(db, user, input)? else {
        return Ok(None);
    };
    let context: Value = serde_json::from_str(&raw).map_err(err)?;
    let mut receipts = receipts(db, user, Some(input))?;
    if context["requiresEffect"] == true && receipts.is_empty() {
        return Err(context["error"]
            .as_str()
            .unwrap_or("요청한 변경을 저장하지 못했어요. 입력을 수정하거나 다시 시도해 주세요.")
            .to_string());
    }
    if context["toolVersion"] == 1 {
        let context =
            crate::organizer::runtime::replay_widget_turn(db, user, context, &mut receipts)?;
        return Ok(Some(json!({"context":context,"receipts":receipts})));
    }
    // Old contexts without provenance cannot establish permission to resend source-derived text.
    let sources =
        serde_json::from_value::<Vec<crate::organizer::SourceRef>>(context["sourceRefs"].clone())
            .ok();
    if sources
        .as_ref()
        .is_some_and(|sources| sources.iter().any(|source| source.kind != "vault"))
    {
        crate::organizer::runtime::collect_comet(db, user)?;
    }
    let permitted = sources.is_some_and(|sources| {
        sources.iter().all(|source| {
            source.user_id == user
                && crate::organizer::read_sources(db, user, std::slice::from_ref(&source.id))
                    .is_ok_and(|current| current.first().is_some_and(|item| item.source == *source))
        })
    });
    let context = if permitted {
        context
    } else {
        for receipt in &mut receipts {
            receipt.title = "저장된 작업".into();
        }
        json!({"state":context["state"],"notice":"이전 답변의 출처를 현재 권한과 원문으로 확인할 수 없어 내용을 사용하지 않는다. 저장된 작업과 되돌림 여부는 receipts만 안내한다. 자료 확인이 필요하면 현재 연결 범위에서 새로 요청하도록 안내한다."})
    };
    Ok(Some(json!({"context":context,"receipts":receipts})))
}

pub(crate) fn operation_id(user: &str, input: &str, step: usize) -> String {
    let hash = Sha256::digest(format!("organizer:{user}:{input}:{step}"));
    let mut bytes = [0; 16];
    bytes.copy_from_slice(&hash[..16]);
    uuid::Uuid::from_bytes(bytes).to_string()
}

pub(crate) fn permissions(query: &str) -> Vec<&'static str> {
    let query = query.to_lowercase();
    if [
        "하지 마",
        "하지마",
        "하지 말",
        "하지말",
        "don't",
        "do not",
        "말고",
        "하지 않았",
        "하지 않",
        "하지않",
    ]
    .iter()
    .any(|s| query.contains(s))
    {
        return vec![];
    }
    // Quoted text and a pasted body after a colon are content, not authority.
    let query = instruction_text(&query);
    let mut allowed = vec![];
    for clause in query.split(['.', '!', '?', '\n', '。', '！', '？']) {
        let clause = clause.trim();
        let first = |terms: &[&str]| terms.iter().filter_map(|term| clause.find(term)).min();
        let domains: Vec<_> = [
            (
                first(&[
                    "메모", "기록", "정리", "저장", "기억", "note", "record", "remember",
                ]),
                "note",
            ),
            (first(&["할 일", "할일", "업무", "todo", "task"]), "task"),
            (
                first(&["일정", "캘린더", "calendar", "event", "schedule"]),
                "event",
            ),
        ]
        .into_iter()
        .filter_map(|(at, kind)| at.map(|at| (at, kind)))
        .collect();
        let destinations: Vec<_> = [
            (first(&["메모로", "메모에", "기록으로", "기록에"]), "note"),
            (first(&["할 일로", "할 일에", "할일로", "할일에"]), "task"),
            (first(&["일정으로", "일정에", "캘린더에"]), "event"),
        ]
        .into_iter()
        .filter_map(|(at, kind)| at.map(|_| kind))
        .collect();
        let domain = if destinations.len() == 1 {
            destinations.first().copied()
        } else if destinations.len() > 1
            || (domains.len() > 1 && clause.chars().any(|c| ('가'..='힣').contains(&c)))
        {
            None
        } else {
            domains
                .into_iter()
                .min_by_key(|(at, _)| *at)
                .map(|(_, kind)| kind)
        };
        let asks = |korean: &[&str], english: &[&str]| asks_action(clause, korean, english);
        match domain {
            Some("note") => {
                if asks(
                    &[
                        "저장해",
                        "기록해",
                        "정리해",
                        "메모해",
                        "적어",
                        "기억해",
                        "기억해 둬",
                        "추가해",
                        "만들어",
                    ],
                    &["add", "create", "save", "record", "remember", "summarize"],
                ) {
                    allowed.push("note_create");
                }
                if asks(&["수정해", "바꿔", "변경해"], &["update", "edit", "change"]) {
                    allowed.push("note_update");
                }
            }
            Some("task") => {
                if asks(&["추가해", "등록해", "넣어", "만들어"], &["add", "create"]) {
                    allowed.push("task_add");
                }
                if asks(
                    &[
                        "완료 취소해",
                        "완료를 취소해",
                        "미완료로 바꿔",
                        "미완료로 표시해",
                    ],
                    &["undo", "reopen"],
                ) {
                    allowed.push("task_undo");
                } else if asks(
                    &[
                        "완료해",
                        "완료 처리해",
                        "완료로 표시해",
                        "완료로 바꿔",
                        "완료로 변경해",
                        "완료 체크해",
                        "끝낸 것으로 표시해",
                    ],
                    &["complete"],
                ) || (asks(&[], &["mark"])
                    && (clause.ends_with(" done") || clause.ends_with(" complete")))
                {
                    allowed.push("task_complete");
                } else if asks(
                    &["수정해", "바꿔", "옮겨", "변경해"],
                    &["update", "edit", "reschedule"],
                ) {
                    allowed.push("task_update");
                }
            }
            Some("event") => {
                if asks(
                    &["추가해", "등록해", "넣어", "만들어"],
                    &["add", "create", "schedule"],
                ) {
                    allowed.push("event_add");
                }
                if asks(
                    &["수정해", "바꿔", "옮겨", "변경해"],
                    &["update", "edit", "reschedule"],
                ) {
                    allowed.push("event_update");
                }
            }
            _ => {}
        }
    }
    allowed.sort_unstable();
    allowed.dedup();
    allowed
}

pub(crate) fn instruction_text(query: &str) -> String {
    instruction_ranges(query)
        .into_iter()
        .map(|range| &query[range])
        .collect::<Vec<_>>()
        .join(" ")
}

/// Byte ranges of the user's own words. Quoted text and a pasted body after a colon are content,
/// not authority; every closed quote starts a new range.
pub(crate) fn instruction_ranges(query: &str) -> Vec<std::ops::Range<usize>> {
    let chars: Vec<_> = query.char_indices().collect();
    let mut quote = None;
    let mut ranges = vec![0..0];
    for (index, (offset, c)) in chars.iter().copied().enumerate() {
        if let Some(end) = quote {
            if c == end {
                quote = None;
                let next = offset + c.len_utf8();
                ranges.push(next..next);
            }
            continue;
        }
        let numeric_colon = index > 0
            && chars[index - 1].1.is_ascii_digit()
            && chars
                .get(index + 1)
                .is_some_and(|(_, c)| c.is_ascii_digit());
        if matches!(c, ':' | '：') && !numeric_colon {
            break;
        }
        let contraction = c == '\''
            && index > 0
            && chars[index - 1].1.is_ascii_alphabetic()
            && chars
                .get(index + 1)
                .is_some_and(|(_, c)| c.is_ascii_alphabetic());
        quote = match c {
            '"' | '`' => Some(c),
            '\'' if !contraction => Some(c),
            '“' => Some('”'),
            '‘' => Some('’'),
            '「' => Some('」'),
            '『' => Some('』'),
            _ => None,
        };
        if quote.is_none() {
            if let Some(range) = ranges.last_mut() {
                range.end = offset + c.len_utf8();
            }
        }
    }
    ranges
}

fn asks_action(clause: &str, korean: &[&str], english: &[&str]) -> bool {
    let endings = [
        "",
        "줘",
        " 줘",
        "줘요",
        " 줘요",
        "주세요",
        " 주세요",
        "줄래",
        " 줄래",
        "줄래요",
        " 줄래요",
        "줄 수 있어",
        " 줄 수 있어",
        "줄 수 있니",
        " 줄 수 있니",
    ];
    if korean.iter().any(|verb| {
        endings
            .iter()
            .any(|ending| clause.ends_with(&format!("{verb}{ending}")))
    }) {
        return true;
    }
    let mut instruction = clause;
    for prefix in ["please ", "can you ", "could you ", "would you "] {
        if let Some(value) = instruction.strip_prefix(prefix) {
            instruction = value;
        }
    }
    english
        .iter()
        .any(|verb| instruction.starts_with(&format!("{verb} ")))
}

pub(crate) fn can_organize(query: &str) -> bool {
    let lower = query.to_lowercase();
    if [
        "하지 마",
        "하지마",
        "하지 말",
        "하지말",
        "don't",
        "do not",
        "말고",
        "하지 않았",
        "하지 않",
        "하지않",
    ]
    .iter()
    .any(|s| lower.contains(s))
    {
        return false;
    }
    instruction_text(&lower)
        .split(['.', '!', '?', '\n', '。', '！', '？'])
        .any(|clause| {
            asks_action(
                clause.trim(),
                &["정리해", "요약해", "저장해"],
                &["summarize", "organize", "save"],
            )
        })
}

pub(crate) fn requested(query: &str) -> bool {
    let text = query.to_lowercase();
    [
        "메모",
        "기록",
        "정리",
        "저장",
        "기억",
        "할 일",
        "할일",
        "일정",
        "프로젝트",
        "업무",
        "어디까지",
        "찾아",
        "vault",
        "ex-brain",
        "note",
        "summari",
        "record",
        "todo",
        "task",
        "calendar",
        "project",
        "remember",
        "search",
    ]
    .iter()
    .any(|term| text.contains(term))
}

fn items(value: &Value, collection: &str) -> Result<Vec<Value>> {
    value[collection]
        .as_array()
        .cloned()
        .ok_or_else(|| "원본 항목을 읽지 못했어요.".into())
}

fn changed_items(before: &[Value], after: &[Value]) -> (Vec<Value>, Vec<Value>) {
    let prior = before
        .iter()
        .filter(|v| !after.iter().any(|x| x == *v))
        .cloned()
        .collect();
    let next = after
        .iter()
        .filter(|v| !before.iter().any(|x| x == *v))
        .cloned()
        .collect();
    (prior, next)
}

fn validate_input(action: &Action) -> Result<()> {
    let fields = action
        .input
        .as_object()
        .ok_or("정리 작업 입력은 객체여야 해요.")?;
    if serde_json::to_vec(&action.input).map_err(err)?.len() > 24_000 {
        return Err("정리 작업 입력이 너무 길어요.".into());
    }
    let allowed: &[&str] = match action.kind.as_str() {
        "note_create" | "note_update" => &["title", "body"],
        "task_add" | "task_update" => &[
            "title",
            "memo",
            "listId",
            "dueDate",
            "dueAt",
            "plannedDate",
            "planPeriod",
            "planAnchor",
        ],
        "task_complete" | "task_undo" => &[],
        "event_add" | "event_update" => &[
            "title",
            "allDay",
            "startAt",
            "endAt",
            "startDate",
            "endDate",
            "timeZone",
            "location",
            "description",
        ],
        _ => return Err("지원하지 않는 정리 작업이에요.".into()),
    };
    if fields.keys().any(|key| !allowed.contains(&key.as_str())) {
        return Err("이 작업에서 허용하지 않은 변경 항목이 들어왔어요.".into());
    }
    let creates = action.kind == "note_create" || action.kind.ends_with("_add");
    if creates && !action.target_id.is_empty() {
        return Err("새 항목을 만드는 작업의 targetId는 빈 문자열이어야 해요. 할 일 목록 ID는 input.listId에만 넣어 주세요.".into());
    }
    if (!creates && action.target_id.trim().is_empty())
        || action.target_id.len() > 200
        || action.target_id.chars().any(char::is_control)
    {
        return Err("변경할 원본 항목을 정확히 선택해 주세요.".into());
    }
    if action.kind.ends_with("_update") && fields.is_empty() {
        return Err("변경할 내용을 입력해 주세요.".into());
    }
    Ok(())
}

fn validate_text_replacement(original: &Value, input: &Value) -> Result<()> {
    for key in ["body", "memo", "description"] {
        if input.get(key).is_some()
            && original[key]
                .as_str()
                .is_some_and(|text| text.chars().count() > ENTITY_TEXT_LIMIT)
        {
            return Err("긴 본문은 일부만 AI에 제공되어 자동으로 덮어쓰지 않았어요. 원본 편집 화면에서 직접 수정해 주세요.".into());
        }
    }
    Ok(())
}

pub(crate) fn execute(
    db: &Connection,
    user: &str,
    input_id: &str,
    step: usize,
    query: &str,
    action: &Action,
) -> Result<Receipt> {
    if !permissions(query).contains(&action.kind.as_str()) {
        return Err("이 변경은 직접 요청한 경우에만 실행할 수 있어요.".into());
    }
    validate_input(action)?;
    let id = operation_id(user, input_id, step);
    let fingerprint = hex::encode(Sha256::digest(serde_json::to_vec(action).map_err(err)?));
    let tx = db.unchecked_transaction().map_err(err)?;
    if store::active_user_id(&tx)? != user {
        return Err("사용자가 변경되어 작업을 멈췄어요.".into());
    }
    let existing: Option<(String, String)> = tx
        .query_row(
            "SELECT fingerprint,receipt FROM organizer_action_receipts WHERE id=?1 AND user_id=?2",
            params![id, user],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(err)?;
    if let Some((previous, receipt)) = existing {
        if previous != fingerprint {
            return Err("이미 처리한 요청의 내용이 달라졌어요. 새 메시지로 요청해 주세요.".into());
        }
        return serde_json::from_str(&receipt).map_err(err);
    }
    let timestamp = chrono::Utc::now().timestamp_millis();
    let (container, collection, before, after) = if action.kind.starts_with("note_") {
        let before = serde_json::to_value(diary::read(&tx)?).map_err(err)?;
        if before["revision"].as_i64() != Some(action.expected_revision) {
            return Err(format!("메모의 최신 revision은 {}예요. 이번 context.entities.diary.revision을 expectedRevision에 넣어 다시 제안해 주세요.", before["revision"]));
        }
        let mut payload = action.input.clone();
        if action.kind == "note_update" {
            let original = before["notes"]
                .as_array()
                .and_then(|notes| notes.iter().find(|note| note["id"] == action.target_id))
                .ok_or("수정할 메모를 찾지 못했어요.")?;
            validate_text_replacement(original, &payload)?;
            payload["id"] = json!(action.target_id);
        }
        let expected = u64::try_from(action.expected_revision)
            .map_err(|_| "메모 수정 번호가 올바르지 않아요.")?;
        let saved = diary::update_in_transaction(
            &tx,
            expected,
            if action.kind == "note_create" {
                "note-create"
            } else {
                "note-update"
            },
            &payload,
        )?;
        (
            "diary".to_string(),
            "notes".to_string(),
            before,
            serde_json::to_value(saved).map_err(err)?,
        )
    } else {
        let (kind, verb, collection) = match action.kind.as_str() {
            "task_add" => ("todo", "add", "items"),
            "task_update" => ("todo", "update", "items"),
            "task_complete" => ("todo", "complete", "items"),
            "task_undo" => ("todo", "undo", "items"),
            "event_add" => ("calendar", "create-event", "events"),
            "event_update" => ("calendar", "update-event", "events"),
            _ => return Err("지원하지 않는 정리 작업이에요.".into()),
        };
        let instance = storage::instances(&tx)?
            .into_iter()
            .find(|v| v.kind == kind && v.enabled && v.installed)
            .ok_or_else(|| format!("{kind} 위젯을 설치하고 켜 주세요."))?;
        if instance.revision != action.expected_revision {
            return Err(format!("{kind} 위젯의 최신 revision은 {}예요. 이번 context.entities.widgets에서 kind={kind}인 항목의 revision을 expectedRevision에 넣어 다시 제안해 주세요.", instance.revision));
        }
        let mut payload = action.input.clone();
        if action.kind.ends_with("_update") {
            let original = instance.data[collection]
                .as_array()
                .and_then(|items| items.iter().find(|item| item["id"] == action.target_id))
                .ok_or("수정할 항목을 찾지 못했어요.")?;
            validate_text_replacement(original, &payload)?;
        }
        if action.kind == "event_update" {
            let original = instance.data["events"]
                .as_array()
                .and_then(|events| {
                    events
                        .iter()
                        .find(|event| event["id"].as_str() == Some(&action.target_id))
                })
                .ok_or("수정할 일정을 찾지 못했어요.")?;
            if original["connectionId"] != "local" {
                return Err("외부 캘린더 일정은 원본에서 수정해 주세요.".into());
            }
            for key in [
                "title",
                "allDay",
                "startAt",
                "endAt",
                "startDate",
                "endDate",
                "timeZone",
                "location",
                "description",
            ] {
                if payload.get(key).is_none() {
                    if let Some(value) = original.get(key) {
                        payload[key] = value.clone();
                    }
                }
            }
            if payload["allDay"].as_bool() != original["allDay"].as_bool() {
                let removed: &[&str] = if payload["allDay"] == true {
                    &["startAt", "endAt", "timeZone"]
                } else {
                    &["startDate", "endDate"]
                };
                if let Some(fields) = payload.as_object_mut() {
                    for key in removed {
                        fields.remove(*key);
                    }
                }
            }
        }
        if !action.kind.ends_with("_add") {
            payload["id"] = json!(action.target_id);
        }
        let request = WidgetRequest {
            instance_id: instance.id.clone(),
            expected_revision: action.expected_revision,
            request_id: id.clone(),
            action: verb.into(),
            input: payload,
        };
        storage::execute_in_transaction(
            &tx,
            &request,
            timestamp,
            uuid::Uuid::new_v4().as_u128() as u64,
        )?;
        let after = storage::get(&tx, &instance.id)?.data;
        (instance.id, collection.to_string(), instance.data, after)
    };
    let (before_items, after_items) =
        changed_items(&items(&before, &collection)?, &items(&after, &collection)?);
    // Native completion undo may delete a generated recurrence; preserve later links to it.
    ensure_unreferenced(
        &tx,
        &container,
        &collection,
        &after_items,
        &before_items,
        &before,
    )?;
    let target = if action.target_id.is_empty() {
        after_items
            .first()
            .and_then(|v| v["id"].as_str())
            .unwrap_or_default()
            .to_string()
    } else {
        action.target_id.clone()
    };
    let title = after_items
        .iter()
        .find(|v| v["id"].as_str() == Some(&target))
        .or_else(|| before_items.first())
        .and_then(|v| v["title"].as_str())
        .unwrap_or("기록 변경")
        .to_string();
    let receipt = Receipt {
        id: id.clone(),
        input_id: input_id.into(),
        title,
        kind: action.kind.clone(),
        target_id: target,
        created_at: timestamp,
        undone: false,
        source_id: None,
        undo_supported: None,
        undo_reason: None,
        result: None,
    };
    tx.execute(
        "INSERT INTO organizer_action_receipts VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        params![
            id,
            user,
            input_id,
            fingerprint,
            serde_json::to_string(&receipt).map_err(err)?,
            container,
            collection,
            serde_json::to_string(&before_items).map_err(err)?,
            serde_json::to_string(&after_items).map_err(err)?
        ],
    )
    .map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(receipt)
}

fn reverse_items(current: &mut Vec<Value>, before: &[Value], after: &[Value]) -> Result<()> {
    for value in after {
        if !current.iter().any(|item| item == value) {
            return Err("이 항목이 이후에 수정되어 자동으로 되돌리지 않았어요.".into());
        }
    }
    for value in before {
        if current.iter().any(|item| item["id"] == value["id"])
            && !after.iter().any(|item| item["id"] == value["id"])
        {
            return Err("되돌릴 항목과 같은 식별자가 이미 있어요.".into());
        }
    }
    current.retain_mut(|item| {
        if !after.iter().any(|value| value["id"] == item["id"]) {
            return true;
        }
        if let Some(prior) = before.iter().find(|value| value["id"] == item["id"]) {
            *item = prior.clone();
            true
        } else {
            false
        }
    });
    for prior in before {
        if !current.iter().any(|item| item["id"] == prior["id"]) {
            current.push(prior.clone());
        }
    }
    Ok(())
}

fn references(value: &Value, id: &str) -> bool {
    match value {
        Value::String(text) => text == id,
        Value::Array(values) => values.iter().any(|value| references(value, id)),
        Value::Object(values) => values.values().any(|value| references(value, id)),
        _ => false,
    }
}

fn ensure_unreferenced(
    db: &Connection,
    container: &str,
    collection: &str,
    before: &[Value],
    after: &[Value],
    current: &Value,
) -> Result<()> {
    let created: Vec<_> = after
        .iter()
        .filter(|item| !before.iter().any(|prior| prior["id"] == item["id"]))
        .collect();
    if created.is_empty() {
        return Ok(());
    }
    let mut owner = current.clone();
    owner[collection] = json!(items(current, collection)?
        .into_iter()
        .filter(|item| !after.contains(item))
        .collect::<Vec<_>>());
    let diary = if container == "diary" {
        owner.clone()
    } else {
        serde_json::to_value(diary::read(db)?).map_err(err)?
    };
    let widgets = storage::instances(db)?;
    for item in created {
        let key = item["id"]
            .as_str()
            .filter(|key| !key.is_empty())
            .ok_or("항목 식별자가 없어요.")?;
        if references(&diary, key)
            || widgets.iter().any(|widget| {
                references(
                    if widget.id == container {
                        &owner
                    } else {
                        &widget.data
                    },
                    key,
                )
            })
        {
            return Err("다른 기록이 이 항목을 참조하고 있어 자동으로 제거하지 않았어요.".into());
        }
    }
    Ok(())
}

pub(crate) fn undo(db: &Connection, user: &str, id: &str) -> Result<Receipt> {
    let tx = db.unchecked_transaction().map_err(err)?;
    if store::active_user_id(&tx)? != user {
        return Err("사용자가 변경되어 작업을 멈췄어요.".into());
    }
    let (raw,container,collection,before,after):(String,String,String,String,String)=tx.query_row("SELECT receipt,container,collection,before_items,after_items FROM organizer_action_receipts WHERE id=?1 AND user_id=?2",params![id,user],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).map_err(|_|"되돌릴 작업을 찾지 못했어요.")?;
    let mut receipt: Receipt = serde_json::from_str(&raw).map_err(err)?;
    if receipt.undone {
        return Ok(receipt);
    }
    if registry::undo_in_transaction(&tx, &mut receipt)? {
        tx.commit().map_err(err)?;
        return Ok(receipt);
    }
    let before: Vec<Value> = serde_json::from_str(&before).map_err(err)?;
    let after: Vec<Value> = serde_json::from_str(&after).map_err(err)?;
    let mut value = if container == "diary" {
        serde_json::to_value(diary::read(&tx)?).map_err(err)?
    } else {
        storage::get(&tx, &container)?.data
    };
    ensure_unreferenced(&tx, &container, &collection, &before, &after, &value)?;
    reverse_items(
        value[&collection]
            .as_array_mut()
            .ok_or("원본 항목 형식이 달라졌어요.")?,
        &before,
        &after,
    )?;
    if container == "diary" {
        value["revision"] = json!(value["revision"].as_u64().unwrap_or(0) + 1);
        tx.execute(
            "UPDATE diary_state SET data=?1 WHERE id=1",
            [value.to_string()],
        )
        .map_err(err)?;
    } else {
        tx.execute(
            "UPDATE widget_instances SET data=?1,revision=revision+1 WHERE id=?2",
            params![value.to_string(), container],
        )
        .map_err(err)?;
    }
    receipt.undone = true;
    tx.execute(
        "UPDATE organizer_action_receipts SET receipt=?1 WHERE id=?2",
        params![serde_json::to_string(&receipt).map_err(err)?, id],
    )
    .map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(receipt)
}

pub(crate) fn entities(db: &Connection, query: &str) -> Result<Value> {
    let allowed = permissions(query);
    if allowed.is_empty() {
        return Ok(json!({}));
    }
    let words: Vec<_> = query.split_whitespace().map(str::to_lowercase).collect();
    let select = |items: Vec<Value>| {
        let mut sorted = items;
        sorted.sort_by_key(|v| {
            let text = v.to_string().to_lowercase();
            std::cmp::Reverse(words.iter().filter(|q| text.contains(q.as_str())).count())
        });
        sorted
            .into_iter()
            .take(8)
            .map(|mut v| {
                let mut truncated = Vec::new();
                for key in ["body", "memo", "description"] {
                    if let Some(text) = v[key].as_str() {
                        if text.chars().count() > ENTITY_TEXT_LIMIT {
                            truncated.push(key);
                        }
                        v[key] = json!(text.chars().take(ENTITY_TEXT_LIMIT).collect::<String>());
                    }
                }
                if !truncated.is_empty() {
                    v["truncatedFields"] = json!(truncated);
                }
                v
            })
            .collect::<Vec<_>>()
    };
    let mut context = json!({});
    if allowed.iter().any(|kind| kind.starts_with("note_")) {
        let diary = serde_json::to_value(diary::read(db)?).map_err(err)?;
        context["diary"] = json!({"revision":diary["revision"]});
        if allowed.contains(&"note_update") {
            context["diary"]["notes"] = json!(select(
                diary["notes"].as_array().cloned().unwrap_or_default()
            ));
        }
    }
    let mut widgets = vec![];
    for widget in storage::instances(db)?
        .into_iter()
        .filter(|widget| widget.installed && widget.enabled)
    {
        let domain = match widget.kind.as_str() {
            "todo" => "task_",
            "calendar" => "event_",
            _ => continue,
        };
        if !allowed.iter().any(|kind| kind.starts_with(domain)) {
            continue;
        }
        let mut value = json!({"id":widget.id,"kind":widget.kind,"revision":widget.revision});
        if allowed
            .iter()
            .any(|kind| kind.starts_with(domain) && !kind.ends_with("_add"))
        {
            let collection = if widget.kind == "todo" {
                "items"
            } else {
                "events"
            };
            let rows = widget.data[collection]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .filter(|item| widget.kind != "calendar" || item["connectionId"] == "local")
                .collect();
            value["items"] = json!(select(rows));
        }
        if widget.kind == "todo"
            && (allowed.contains(&"task_add") || allowed.contains(&"task_update"))
        {
            value["lists"] = widget.data["lists"].clone();
        }
        widgets.push(value);
    }
    if !widgets.is_empty() {
        context["widgets"] = json!(widgets);
    }
    Ok(context)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_reply_that_misses_or_denies_the_saved_change_is_replaced_by_the_receipt() {
        let db = store::open(std::path::Path::new(":memory:")).unwrap();
        let user = store::active_user_id(&db).unwrap();
        let directory = tempfile::tempdir().unwrap();
        crate::widgets::storage::install(&db, directory.path(), &["todo".into()]).unwrap();
        assert_eq!(receipt_reply(&db, &user, "task", "안녕!").unwrap(), None);
        let revision = entities_for(&db, "task_add", "").unwrap()["revision"]
            .as_i64()
            .unwrap();
        execute_registry(
            &db,
            &user,
            "task",
            0,
            "QA-T1 할 일 추가해줘",
            &Action {
                kind: "task_add".into(),
                target_id: String::new(),
                expected_revision: revision,
                input: json!({"title":"QA-T1","dueDate":"2026-11-06"}),
            },
        )
        .unwrap();
        let receipt = Some("'QA-T1' 할 일을 추가했어요.".to_owned());
        for reply in [
            "호기심이 많고 다정하며 먼저 말을 건넨다.",
            "QA-T1을 저장하지 못했어.",
        ] {
            assert_eq!(receipt_reply(&db, &user, "task", reply).unwrap(), receipt);
        }
        assert_eq!(
            receipt_reply(&db, &user, "task", "꼬리 흔들며 qa-t1 할 일 넣어 뒀어!").unwrap(),
            None
        );
    }
    #[test]
    fn replay_rechecks_vault_permission_and_disk_hash_after_restart() {
        let directory = tempfile::tempdir().unwrap();
        let vault_root = directory.path().join("vault");
        std::fs::create_dir(&vault_root).unwrap();
        let original = vault_root.join("meeting.md");
        std::fs::write(&original, "Meeting confidential value").unwrap();
        let database = directory.path().join("app.sqlite");
        let db = store::open(&database).unwrap();
        store::set_user_name(&db, "원래 사용자", 1).unwrap();
        let user = store::active_user_id(&db).unwrap();
        let vault =
            crate::organizer::connect_vault(&db, &user, &vault_root, &[], &[], "Comet", false)
                .unwrap();
        crate::organizer::scan_vault(
            &db,
            &user,
            &vault.id,
            &std::sync::atomic::AtomicBool::new(false),
        )
        .unwrap();
        let source = crate::organizer::search(&db, &user, "Meeting", 1).unwrap()[0]
            .source
            .clone();
        let saved = json!({"state":"done","sourceRefs":[source],"results":[{"answer":"confidential answer"}]});
        save_turn(&db, &user, "retry", &saved.to_string()).unwrap();
        drop(db);
        let db = store::open(&database).unwrap();
        assert_eq!(
            replay_context(&db, &user, "retry").unwrap().unwrap()["context"],
            saved
        );

        std::fs::write(&original, "Changed without an index scan").unwrap();
        assert!(!replay_context(&db, &user, "retry")
            .unwrap()
            .unwrap()
            .to_string()
            .contains("confidential"));
        std::fs::write(&original, "Meeting confidential value").unwrap();
        crate::organizer::disconnect_vault(&db, &user, &vault.id).unwrap();
        assert!(!replay_context(&db, &user, "retry")
            .unwrap()
            .unwrap()
            .to_string()
            .contains("confidential"));
        assert_eq!(
            turn_context(&db, &user, "retry").unwrap().unwrap(),
            saved.to_string()
        );
        store::set_user_name(&db, "다른 사용자", 2).unwrap();
        assert!(replay_context(&db, &user, "retry").is_err());
    }

    #[test]
    fn replay_refreshes_comet_sources_without_reverting_saved_effects() {
        let db = store::open(std::path::Path::new(":memory:")).unwrap();
        let user = store::active_user_id(&db).unwrap();
        crate::organizer::save_settings(
            &db,
            &user,
            &crate::organizer::OrganizerSettings {
                comet_enabled: true,
                ..Default::default()
            },
        )
        .unwrap();
        let receipt = execute(
            &db,
            &user,
            "note",
            0,
            "메모로 저장해줘",
            &Action {
                kind: "note_create".into(),
                target_id: String::new(),
                expected_revision: 0,
                input: json!({"title":"confidential note","body":"original body"}),
            },
        )
        .unwrap();
        crate::organizer::runtime::collect_comet(&db, &user).unwrap();
        let source = crate::organizer::search(&db, &user, "confidential", 1).unwrap()[0]
            .source
            .clone();
        save_turn(&db, &user, "note", &json!({"state":"done","sourceRefs":[source],"results":[{"answer":"confidential answer"}]}).to_string()).unwrap();
        assert!(replay_context(&db, &user, "note")
            .unwrap()
            .unwrap()
            .to_string()
            .contains("confidential answer"));
        diary::update_in_transaction(
            &db,
            1,
            "note-update",
            &json!({"id":receipt.target_id,"body":"edited later"}),
        )
        .unwrap();
        let replay = replay_context(&db, &user, "note").unwrap().unwrap();
        assert!(!replay.to_string().contains("confidential"));
        assert_eq!(replay["receipts"][0]["undone"], false);
        assert_eq!(
            receipts(&db, &user, Some("note")).unwrap()[0].title,
            "confidential note"
        );
        assert_eq!(
            serde_json::to_value(diary::read(&db).unwrap()).unwrap()["notes"][0]["body"],
            "edited later"
        );
        assert!(undo(&db, &user, &receipt.id).is_err());
    }

    #[test]
    fn replay_redacts_legacy_context_but_preserves_receipt_undo_state() {
        let db = store::open(std::path::Path::new(":memory:")).unwrap();
        let user = store::active_user_id(&db).unwrap();
        let receipt = execute(
            &db,
            &user,
            "legacy",
            0,
            "메모로 저장해줘",
            &Action {
                kind: "note_create".into(),
                target_id: String::new(),
                expected_revision: 0,
                input: json!({"title":"confidential title","body":"saved original"}),
            },
        )
        .unwrap();
        save_turn(
            &db,
            &user,
            "legacy",
            r#"{"state":"done","results":[{"answer":"confidential answer"}]}"#,
        )
        .unwrap();
        let replay = replay_context(&db, &user, "legacy").unwrap().unwrap();
        assert!(!replay.to_string().contains("confidential"));
        assert_eq!(replay["receipts"][0]["undone"], false);
        undo(&db, &user, &receipt.id).unwrap();
        assert_eq!(
            replay_context(&db, &user, "legacy").unwrap().unwrap()["receipts"][0]["undone"],
            true
        );
    }

    #[test]
    fn declarative_and_negated_text_cannot_mutate_tasks() {
        assert!(permissions("보고서를 끝냈어. 할 일이 많네").is_empty());
        assert!(permissions("할 일 추가하지 말고 정리만 해줘").is_empty());
        assert!(permissions("할 일에 보고서 작성 추가해줘").contains(&"task_add"));
        assert!(permissions("이 할 일을 완료 처리해줘").contains(&"task_complete"));
        assert_eq!(
            permissions("할 일은 완료했어. 메모로 정리해줘"),
            vec!["note_create"]
        );
        assert_eq!(
            permissions("메모로 저장해줘: 할 일 완료 처리해줘"),
            vec!["note_create"]
        );
        assert!(permissions("\"할 일 완료 처리해줘\"라는 문장을 설명해줘").is_empty());
        assert!(permissions("할 일 추가해도 돼?").is_empty());
        assert_eq!(
            permissions("please add a note about completing a task"),
            vec!["note_create"]
        );
        assert_eq!(permissions("이 할 일을 미완료로 바꿔줘"), vec!["task_undo"]);
        assert_eq!(permissions("메모를 할 일로 추가해줘"), vec!["task_add"]);
        assert_eq!(
            permissions("할 일에 \"보고서 추가\"를 추가해줘"),
            vec!["task_add"]
        );
        assert_eq!(
            permissions("이 일정을 다음 주로 옮겨줘"),
            vec!["event_update"]
        );
        assert!(can_organize("이 자료 요약해줘"));
        assert!(can_organize("이 자료 정리해줘: 원문"));
        assert!(!can_organize("자료를 정리해줘라고 쓰여 있어"));
        assert!(!can_organize("\"자료 정리해줘\"라는 문장의 의미는?"));
        assert!(!can_organize("자료를 정리해도 돼?"));
    }
    #[test]
    fn undo_preserves_unrelated_changes_and_rejects_edited_target() {
        let a = json!({"id":"a","title":"old"});
        let b = json!({"id":"a","title":"new"});
        let other = json!({"id":"b","title":"unrelated"});
        let mut current = vec![b.clone(), other.clone()];
        reverse_items(
            &mut current,
            std::slice::from_ref(&a),
            std::slice::from_ref(&b),
        )
        .unwrap();
        assert_eq!(current, vec![a.clone(), other]);
        assert!(reverse_items(&mut current, &[a], &[b]).is_err());
    }
    #[test]
    fn saved_note_and_receipt_share_transaction_and_retry_result() {
        let db = store::open(std::path::Path::new(":memory:")).unwrap();
        initialize(&db).unwrap();
        let user = store::active_user_id(&db).unwrap();
        let revision = serde_json::to_value(diary::read(&db).unwrap()).unwrap()["revision"]
            .as_i64()
            .unwrap();
        let action = Action {
            kind: "note_create".into(),
            target_id: String::new(),
            expected_revision: revision,
            input: json!({"title":"회의 결정","body":"원문을 보존한다"}),
        };
        let first = execute(&db, &user, "m1", 0, "회의를 메모로 저장해줘", &action).unwrap();
        let again = execute(&db, &user, "m1", 0, "회의를 메모로 저장해줘", &action).unwrap();
        assert_eq!(first.target_id, again.target_id);
        assert_eq!(receipts(&db, &user, Some("m1")).unwrap().len(), 1);
        assert!(undo(&db, &user, &first.id).unwrap().undone);
        assert!(
            execute(&db, &user, "m1", 0, "회의를 메모로 저장해줘", &action)
                .unwrap()
                .undone
        );
        let changed = Action {
            input: json!({"title":"바뀐 요청","body":"새 내용"}),
            ..action
        };
        assert!(execute(&db, &user, "m1", 0, "회의를 메모로 저장해줘", &changed).is_err());
        assert!(
            serde_json::to_value(diary::read(&db).unwrap()).unwrap()["notes"]
                .as_array()
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn rejects_unrequested_fields_without_mutating_the_original_or_receipt() {
        let db = store::open(std::path::Path::new(":memory:")).unwrap();
        let user = store::active_user_id(&db).unwrap();
        let before = serde_json::to_value(diary::read(&db).unwrap()).unwrap();
        let action = Action {
            kind: "note_create".into(),
            target_id: String::new(),
            expected_revision: before["revision"].as_i64().unwrap(),
            input: json!({"title":"회의","body":"내용","pinned":true}),
        };
        assert!(execute(&db, &user, "unsafe", 0, "메모로 저장해줘", &action)
            .unwrap_err()
            .contains("허용하지 않은"));
        assert_eq!(
            serde_json::to_value(diary::read(&db).unwrap()).unwrap(),
            before
        );
        assert!(receipts(&db, &user, Some("unsafe")).unwrap().is_empty());
        for (kind, query, input) in [
            ("task_update", "할 일을 수정해줘", json!({"completedAt":1})),
            (
                "task_update",
                "할 일을 수정해줘",
                json!({"scope":"following","title":"제목"}),
            ),
            (
                "task_complete",
                "할 일을 완료 처리해줘",
                json!({"title":"다른 제목"}),
            ),
        ] {
            let action = Action {
                kind: kind.into(),
                target_id: "target".into(),
                expected_revision: 0,
                input,
            };
            assert!(execute(&db, &user, "unsafe-task", 0, query, &action)
                .unwrap_err()
                .contains("허용하지 않은"));
        }
        let widgets = serde_json::to_value(storage::instances(&db).unwrap()).unwrap();
        let action = Action {
            kind: "task_add".into(),
            target_id: "list-id".into(),
            expected_revision: 0,
            input: json!({"title":"안내문 작성","listId":"list-id"}),
        };
        assert!(
            execute(&db, &user, "bad-create", 0, "할 일을 추가해줘", &action)
                .unwrap_err()
                .contains("targetId는 빈 문자열")
        );
        assert_eq!(
            serde_json::to_value(storage::instances(&db).unwrap()).unwrap(),
            widgets
        );
        assert!(receipts(&db, &user, Some("bad-create")).unwrap().is_empty());
    }

    #[test]
    fn only_explicit_action_domains_receive_existing_entities() {
        let db = store::open(std::path::Path::new(":memory:")).unwrap();
        let user = store::active_user_id(&db).unwrap();
        let diary = serde_json::to_value(diary::read(&db).unwrap()).unwrap();
        execute(
            &db,
            &user,
            "private-note",
            0,
            "메모로 저장해줘",
            &Action {
                kind: "note_create".into(),
                target_id: String::new(),
                expected_revision: diary["revision"].as_i64().unwrap(),
                input: json!({"title":"기존 기록","body":"선택되지 않은 본문"}),
            },
        )
        .unwrap();
        assert_eq!(
            entities(&db, "Vault 프로젝트 어디까지 했지?").unwrap(),
            json!({})
        );
        let creating = entities(&db, "메모로 저장해줘").unwrap();
        assert!(creating["diary"]["revision"].is_number());
        assert!(creating["diary"].get("notes").is_none());
        let editing = entities(&db, "메모를 수정해줘").unwrap();
        assert_eq!(editing["diary"]["notes"][0]["body"], "선택되지 않은 본문");
        assert!(editing.get("widgets").is_none());
    }

    #[test]
    fn truncated_fields_cannot_replace_originals_but_other_fields_remain_editable() {
        for (kind, collection, field, create_kind, create_query, update_kind, update_query) in [
            (
                "diary",
                "notes",
                "body",
                "note_create",
                "메모로 저장해줘",
                "note_update",
                "메모를 수정해줘",
            ),
            (
                "todo",
                "items",
                "memo",
                "task_add",
                "할 일을 추가해줘",
                "task_update",
                "할 일을 수정해줘",
            ),
            (
                "calendar",
                "events",
                "description",
                "event_add",
                "일정을 추가해줘",
                "event_update",
                "일정을 수정해줘",
            ),
        ] {
            let db = store::open(std::path::Path::new(":memory:")).unwrap();
            let user = store::active_user_id(&db).unwrap();
            let directory = tempfile::tempdir().unwrap();
            let widget = if kind == "diary" {
                None
            } else {
                storage::install(&db, directory.path(), &[kind.into()]).unwrap();
                storage::instances(&db)
                    .unwrap()
                    .into_iter()
                    .find(|widget| widget.kind == kind)
            };
            let original = format!("{}끝부분도 보존", "가".repeat(300));
            let mut input = json!({"title":"긴 원문"});
            input[field] = json!(original);
            if kind == "calendar" {
                input["allDay"] = json!(true);
                input["startDate"] = json!("2026-10-12");
                input["endDate"] = json!("2026-10-13");
            }
            let created = execute(
                &db,
                &user,
                "create",
                0,
                create_query,
                &Action {
                    kind: create_kind.into(),
                    target_id: String::new(),
                    expected_revision: widget.as_ref().map_or(0, |widget| widget.revision),
                    input,
                },
            )
            .unwrap();
            let current = || match &widget {
                Some(widget) => {
                    let current = storage::get(&db, &widget.id).unwrap();
                    (current.revision, current.data)
                }
                None => {
                    let current = serde_json::to_value(diary::read(&db).unwrap()).unwrap();
                    (current["revision"].as_i64().unwrap(), current)
                }
            };
            let (revision, before) = current();
            let context = entities(&db, update_query).unwrap();
            let preview = if kind == "diary" {
                &context["diary"]["notes"][0]
            } else {
                &context["widgets"][0]["items"][0]
            };
            assert_eq!(preview[field].as_str().unwrap().chars().count(), 300);
            assert_eq!(preview["truncatedFields"], json!([field]));
            let mut replacement = json!({});
            replacement[field] = json!(format!("{}추가", preview[field].as_str().unwrap()));
            let action = Action {
                kind: update_kind.into(),
                target_id: created.target_id,
                expected_revision: revision,
                input: replacement,
            };
            assert!(execute(&db, &user, "unsafe", 0, update_query, &action)
                .unwrap_err()
                .contains("일부만 AI에 제공"));
            assert_eq!(current(), (revision, before));
            assert!(receipts(&db, &user, Some("unsafe")).unwrap().is_empty());

            execute(
                &db,
                &user,
                "rename",
                0,
                update_query,
                &Action {
                    input: json!({"title":"제목만 변경"}),
                    ..action
                },
            )
            .unwrap();
            let (_, after) = current();
            assert_eq!(after[collection][0][field], original);
            assert_eq!(after[collection][0]["title"], "제목만 변경");
            assert_eq!(receipts(&db, &user, Some("rename")).unwrap().len(), 1);
        }
    }

    #[test]
    fn undo_rejects_same_diary_references_and_open_preserves_saved_text() {
        let db = store::open(std::path::Path::new(":memory:")).unwrap();
        let user = store::active_user_id(&db).unwrap();
        let before = serde_json::to_value(diary::read(&db).unwrap()).unwrap();
        let action = Action {
            kind: "note_create".into(),
            target_id: String::new(),
            expected_revision: before["revision"].as_i64().unwrap(),
            input: json!({"title":"회의 결정","body":"  원문\n그대로  "}),
        };
        let receipt = execute(&db, &user, "source", 0, "메모로 저장해줘", &action).unwrap();
        let result = open_result(&db, &user, &receipt.id).unwrap();
        assert!(result.content.contains("  원문\n그대로  "));
        assert!(!result.content.contains("savedResult"));
        let state = serde_json::to_value(diary::read(&db).unwrap()).unwrap();
        let state = serde_json::to_value(
            diary::update_in_transaction(
                &db,
                state["revision"].as_u64().unwrap(),
                "page-create",
                &json!({"title":"관련 페이지","date":null}),
            )
            .unwrap(),
        )
        .unwrap();
        diary::update_in_transaction(&db,state["revision"].as_u64().unwrap(),"entry-add",&json!({"pageId":state["pages"][0]["id"],"kind":"note","text":"메모 연결","refId":receipt.target_id})).unwrap();
        assert!(undo(&db, &user, &receipt.id).unwrap_err().contains("참조"));
        assert!(!receipts(&db, &user, Some("source")).unwrap()[0].undone);
        assert_eq!(
            serde_json::to_value(diary::read(&db).unwrap()).unwrap()["notes"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn undo_cannot_remove_a_linked_generated_task_and_stale_revisions_are_atomic() {
        let db = store::open(std::path::Path::new(":memory:")).unwrap();
        let user = store::active_user_id(&db).unwrap();
        let directory = tempfile::tempdir().unwrap();
        storage::install(&db, directory.path(), &["todo".into()]).unwrap();
        let widget = storage::instances(&db)
            .unwrap()
            .into_iter()
            .find(|widget| widget.kind == "todo")
            .unwrap();
        let request = WidgetRequest {
            instance_id: widget.id.clone(),
            expected_revision: widget.revision,
            request_id: uuid::Uuid::new_v4().to_string(),
            action: "add".into(),
            input: json!({"title":"매일 할 일","repeat":"daily","dueDate":"2026-10-12"}),
        };
        storage::execute(&db, &request, 1_790_000_000_000, 5).unwrap();
        let before = storage::get(&db, &widget.id).unwrap();
        let target = before.data["items"][0]["id"].as_str().unwrap().to_string();
        let mut action = Action {
            kind: "task_complete".into(),
            target_id: target.clone(),
            expected_revision: widget.revision,
            input: json!({}),
        };
        let error = execute(
            &db,
            &user,
            "complete-stale",
            0,
            "할 일을 완료 처리해줘",
            &action,
        )
        .unwrap_err();
        assert!(error.contains(&format!("최신 revision은 {}", before.revision)));
        assert!(error.contains("expectedRevision"));
        assert_eq!(storage::get(&db, &widget.id).unwrap().data, before.data);
        assert!(receipts(&db, &user, Some("complete-stale"))
            .unwrap()
            .is_empty());
        action.expected_revision = before.revision;
        let receipt = execute(&db, &user, "complete", 0, "할 일을 완료 처리해줘", &action).unwrap();
        let completed = storage::get(&db, &widget.id).unwrap();
        let child = completed.data["items"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["id"] != target)
            .unwrap()["id"]
            .clone();
        let diary = serde_json::to_value(diary::read(&db).unwrap()).unwrap();
        let diary = serde_json::to_value(
            diary::update_in_transaction(
                &db,
                diary["revision"].as_u64().unwrap(),
                "page-create",
                &json!({"title":"다음 회차 준비","date":null}),
            )
            .unwrap(),
        )
        .unwrap();
        diary::update_in_transaction(&db,diary["revision"].as_u64().unwrap(),"entry-add",&json!({"pageId":diary["pages"][0]["id"],"kind":"todo","text":"다음 회차","refId":child})).unwrap();
        assert!(undo(&db, &user, &receipt.id).unwrap_err().contains("참조"));
        let undo_action = Action {
            kind: "task_undo".into(),
            target_id: target,
            expected_revision: completed.revision,
            input: json!({}),
        };
        assert!(execute(
            &db,
            &user,
            "undo-complete",
            0,
            "할 일을 미완료로 바꿔줘",
            &undo_action
        )
        .unwrap_err()
        .contains("참조"));
        assert_eq!(storage::get(&db, &widget.id).unwrap().data, completed.data);
    }

    #[test]
    fn changing_a_local_event_preserves_unrequested_fields_and_external_events() {
        let db = store::open(std::path::Path::new(":memory:")).unwrap();
        let user = store::active_user_id(&db).unwrap();
        let directory = tempfile::tempdir().unwrap();
        storage::install(&db, directory.path(), &["calendar".into()]).unwrap();
        let widget = storage::instances(&db)
            .unwrap()
            .into_iter()
            .find(|widget| widget.kind == "calendar")
            .unwrap();
        let add = Action {
            kind: "event_add".into(),
            target_id: String::new(),
            expected_revision: widget.revision,
            input: json!({"title":"회의","allDay":true,"startDate":"2026-10-12","endDate":"2026-10-13","location":"서울","description":"  기존 메모\n보존  "}),
        };
        let receipt = execute(&db, &user, "calendar-add", 0, "일정을 추가해줘", &add).unwrap();
        let before = storage::get(&db, &widget.id).unwrap();
        let update = Action {
            kind: "event_update".into(),
            target_id: receipt.target_id,
            expected_revision: before.revision,
            input: json!({"startDate":"2026-10-14","endDate":"2026-10-15"}),
        };
        let edited = execute(&db, &user, "calendar-update", 0, "일정을 옮겨줘", &update).unwrap();
        let after = storage::get(&db, &widget.id).unwrap();
        assert_eq!(after.data["events"][0]["location"], "서울");
        assert_eq!(
            after.data["events"][0]["description"],
            "  기존 메모\n보존  "
        );
        assert_eq!(after.data["events"][0]["startDate"], "2026-10-14");
        undo(&db, &user, &edited.id).unwrap();
        assert_eq!(storage::get(&db, &widget.id).unwrap().data, before.data);
        let mut external = before.data.clone();
        external["events"][0]["connectionId"] = json!("remote");
        db.execute(
            "UPDATE widget_instances SET data=?1 WHERE id=?2",
            params![external.to_string(), widget.id],
        )
        .unwrap();
        let denied = Action {
            expected_revision: storage::get(&db, &widget.id).unwrap().revision,
            ..update
        };
        assert!(
            execute(&db, &user, "external-update", 0, "일정을 옮겨줘", &denied)
                .unwrap_err()
                .contains("외부 캘린더")
        );
        assert_eq!(storage::get(&db, &widget.id).unwrap().data, external);
    }
}
