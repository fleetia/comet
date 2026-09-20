use super::{appearance, EventDraft, WidgetEffect};
use chrono::{DateTime, Days, Months, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
mod recurrence;
#[cfg(test)]
mod recurrence_tests;
use recurrence::{FrequencyRecord, RepeatRule};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TodoState {
    lists: Vec<List>,
    items: Vec<Todo>,
}
#[derive(Clone, Serialize, Deserialize)]
struct List {
    id: String,
    name: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Todo {
    id: String,
    title: String,
    memo: String,
    list_id: String,
    due_date: Option<String>,
    due_at: Option<i64>,
    repeat: String,
    completed_at: Option<i64>,
    generated_from: Option<String>,
    generation: Option<Generation>,
    revision: u64,
    #[serde(default = "no_period")]
    plan_period: String,
    #[serde(default)]
    plan_anchor: Option<String>,
    #[serde(default)]
    planned_date: Option<String>,
    #[serde(default)]
    repeat_rule: Option<RepeatRule>,
    #[serde(default)]
    frequency_records: Vec<FrequencyRecord>,
    #[serde(default)]
    continuation: Option<Box<Todo>>,
}
fn no_period() -> String {
    "none".into()
}
#[derive(Clone, Serialize, Deserialize)]
struct Generation {
    id: String,
    snapshot: Value,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Timer {
    status: String,
    mode: String,
    duration_ms: i64,
    #[serde(default)]
    focus_duration_ms: Option<i64>,
    remaining_ms: i64,
    deadline: Option<i64>,
    todo_id: Option<String>,
}
#[derive(Serialize, Deserialize)]
struct MemoState {
    notes: Vec<Note>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Note {
    id: String,
    title: String,
    body: String,
    updated_at: i64,
    #[serde(default)]
    is_open: bool,
    #[serde(default = "memo_font_size")]
    font_size: u8,
}
fn memo_font_size() -> u8 {
    16
}
fn note_font_size(input: &Value) -> Result<u8, String> {
    match input.get("fontSize") {
        None => Ok(memo_font_size()),
        Some(value) => value
            .as_u64()
            .filter(|size| (12..=24).contains(size) && size % 2 == 0)
            .map(|size| size as u8)
            .ok_or_else(|| "글자 크기는 12부터 24까지 짝수여야 합니다.".into()),
    }
}
#[derive(Serialize, Deserialize)]
struct Clock {
    format: String,
    anniversaries: Vec<Anniversary>,
    #[serde(default)]
    appearance: appearance::Appearance,
}
#[derive(Serialize, Deserialize)]
struct Anniversary {
    id: String,
    title: String,
    date: String,
}
#[derive(Serialize, Deserialize)]
struct Preparation {
    envelopes: Vec<Envelope>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Envelope {
    id: String,
    event_id: String,
    event_label: String,
    checks: Vec<Check>,
    links: Vec<Link>,
    todo_ids: Vec<String>,
}
#[derive(Serialize, Deserialize)]
struct Check {
    id: String,
    text: String,
    done: bool,
}
#[derive(Serialize, Deserialize)]
struct Link {
    id: String,
    title: String,
    url: String,
}

fn decode<T: serde::de::DeserializeOwned>(data: &Value) -> Result<T, String> {
    serde_json::from_value(data.clone())
        .map_err(|_| "저장된 위젯 데이터가 올바르지 않습니다.".into())
}
fn encode<T: Serialize>(data: T, events: Vec<EventDraft>) -> Result<WidgetEffect, String> {
    Ok(WidgetEffect {
        data: serde_json::to_value(data).map_err(|e| e.to_string())?,
        events,
    })
}
fn text(input: &Value, key: &str, max: usize) -> Result<String, String> {
    let value = input
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("{key} 문자열이 필요합니다."))?;
    if value.trim().is_empty() || value.chars().count() > max {
        return Err(format!("{key} 길이가 올바르지 않습니다."));
    }
    Ok(value.to_owned())
}
fn optional_text(input: &Value, key: &str, max: usize) -> Result<String, String> {
    match input.get(key) {
        None => Ok(String::new()),
        Some(Value::String(s)) if s.chars().count() <= max => Ok(s.clone()),
        _ => Err(format!("{key} 문자열이 올바르지 않습니다.")),
    }
}
fn date(value: &str) -> Result<NaiveDate, String> {
    let result =
        NaiveDate::parse_from_str(value, "%Y-%m-%d").map_err(|_| "날짜가 올바르지 않습니다.")?;
    if result.format("%Y-%m-%d").to_string() != value {
        return Err("날짜는 YYYY-MM-DD 형식이어야 합니다.".into());
    }
    Ok(result)
}
fn id(now: i64, entropy: u64) -> String {
    format!("{now:x}-{entropy:x}")
}
fn missing() -> String {
    "항목을 찾을 수 없습니다.".into()
}
fn capacity(len: usize) -> Result<(), String> {
    if len >= 2000 {
        Err("항목은 2000개까지 저장할 수 있습니다.".into())
    } else {
        Ok(())
    }
}
fn event(kind: &str, item: &Todo) -> EventDraft {
    EventDraft {
        kind: kind.into(),
        text: if kind == "todo-completed" {
            format!("{} 완료", item.title)
        } else {
            format!("{} 완료 취소", item.title)
        },
        payload: json!({"itemId":item.id,"occurrenceId":item.id}),
    }
}

pub fn initial(kind: &str) -> Value {
    match kind {
        "todo" => json!({"lists":[{"id":"default","name":"할 일"}],"items":[]}),
        "focus-timer" => {
            json!({"status":"idle","mode":"focus","durationMs":1500000,"remainingMs":1500000,"deadline":null,"todoId":null})
        }
        "preparation" => json!({"envelopes":[]}),
        "clock" => json!({"format":"24h","anniversaries":[],"appearance":appearance::initial()}),
        "memo" => json!({"notes":[]}),
        _ => Value::Null,
    }
}

fn apply_due(item: &mut Todo, input: &Value) -> Result<(), String> {
    if let Some(value) = input.get("dueDate") {
        item.due_date = if value.is_null() {
            None
        } else {
            let s = value.as_str().ok_or("날짜가 올바르지 않습니다.")?;
            date(s)?;
            Some(s.into())
        };
    }
    if let Some(value) = input.get("dueAt") {
        item.due_at = if value.is_null() {
            None
        } else {
            let n = value.as_i64().ok_or("시각이 올바르지 않습니다.")?;
            DateTime::from_timestamp_millis(n).ok_or("시각 범위를 벗어났습니다.")?;
            Some(n)
        };
    }
    if item.due_date.is_some() && item.due_at.is_some() {
        return Err("날짜 기한과 시각 기한 중 하나만 선택하세요.".into());
    }
    if let Some(value) = input.get("repeat") {
        let s = value.as_str().ok_or("반복 설정이 올바르지 않습니다.")?;
        if !["none", "daily", "weekly", "monthly", "yearly"].contains(&s) {
            return Err("지원하지 않는 반복 설정입니다.".into());
        }
        item.repeat = s.into();
        if input.get("repeatRule").is_none() {
            item.repeat_rule = None;
        }
    }
    recurrence::apply(item, input)?;
    Ok(())
}
fn next_date(day: NaiveDate, repeat: &str) -> Result<NaiveDate, String> {
    match repeat {
        "daily" => day.checked_add_days(Days::new(1)),
        "weekly" => day.checked_add_days(Days::new(7)),
        "monthly" => day.checked_add_months(Months::new(1)),
        "yearly" => day.checked_add_months(Months::new(12)),
        _ => None,
    }
    .ok_or_else(|| "다음 반복 날짜를 계산할 수 없습니다.".into())
}

fn new_todo(input: &Value, lists: &[List], new_id: String) -> Result<Todo, String> {
    let list_id = match input.get("listId") {
        Some(_) => text(input, "listId", 200)?,
        None => "default".into(),
    };
    if !lists.iter().any(|list| list.id == list_id) {
        return Err(missing());
    }
    let mut item = Todo {
        id: new_id,
        title: text(input, "title", 500)?,
        memo: optional_text(input, "memo", 20000)?,
        list_id,
        due_date: None,
        due_at: None,
        repeat: "none".into(),
        completed_at: None,
        generated_from: None,
        generation: None,
        revision: 0,
        plan_period: no_period(),
        plan_anchor: None,
        planned_date: None,
        repeat_rule: None,
        frequency_records: vec![],
        continuation: None,
    };
    apply_due(&mut item, input)?;
    Ok(item)
}

fn update_todo(item: &mut Todo, input: &Value, lists: &[List]) -> Result<(), String> {
    if input.get("title").is_some() {
        item.title = text(input, "title", 500)?;
    }
    if input.get("memo").is_some() {
        item.memo = optional_text(input, "memo", 20000)?;
    }
    if input.get("listId").is_some() {
        let list_id = text(input, "listId", 200)?;
        if !lists.iter().any(|list| list.id == list_id) {
            return Err(missing());
        }
        item.list_id = list_id;
    }
    apply_due(item, input)?;
    item.revision += 1;
    Ok(())
}

fn normalize_legacy_todo(mut value: Value) -> Result<Value, String> {
    if value.get("plannedDate").is_none() {
        value["plannedDate"] = match value["dueDate"].as_str() {
            Some(day) => json!(day),
            None => match value["dueAt"].as_i64() {
                Some(at) => json!(recurrence::local_datetime(at, "local")?.date().to_string()),
                None => Value::Null,
            },
        };
    }
    Ok(value)
}

pub fn recurrence_preview(data: &Value, input: &Value, now: i64) -> Result<Vec<String>, String> {
    if !input.is_object()
        || serde_json::to_vec(input)
            .map_err(|error| error.to_string())?
            .len()
            > 64 * 1024
    {
        return Err("반복 미리보기 입력 형식이나 크기가 올바르지 않습니다.".into());
    }
    let state: TodoState = decode(data)?;
    let mut item = if let Some(key) = input["id"].as_str() {
        let mut item = state
            .items
            .iter()
            .find(|item| item.id == key)
            .cloned()
            .ok_or_else(missing)?;
        apply_due(&mut item, input)?;
        item
    } else {
        let mut draft = input.clone();
        draft["title"] = json!("반복 미리보기");
        new_todo(&draft, &state.lists, "preview".into())?
    };
    if !recurrence::repeats(&item) || recurrence::is_frequency(&item) {
        return Ok(vec![]);
    }
    let count = if item
        .repeat_rule
        .as_ref()
        .is_some_and(|rule| rule.mode == "completion")
    {
        1
    } else {
        3
    };
    let mut preview = vec![];
    for _ in 0..count {
        item = recurrence::advance(&item, now)?;
        preview.push(match item.due_date.as_ref() {
            Some(day) => day.clone(),
            None => DateTime::<Utc>::from_timestamp_millis(item.due_at.ok_or("반복 날짜 오류")?)
                .ok_or("반복 날짜 범위 오류")?
                .to_rfc3339(),
        });
    }
    Ok(preview)
}
fn todo(
    data: &Value,
    action: &str,
    input: &Value,
    now: i64,
    entropy: u64,
) -> Result<WidgetEffect, String> {
    let mut normalized = data.clone();
    if let Some(items) = normalized["items"].as_array_mut() {
        for item in items {
            *item = normalize_legacy_todo(item.clone())?;
        }
    }
    let mut state: TodoState = decode(&normalized)?;
    let mut events = vec![];
    let new_id = id(now, entropy);
    match action {
        "list-add" => {
            capacity(state.lists.len())?;
            if state.lists.iter().any(|x| x.id == new_id) {
                return Err("ID 충돌입니다. 다시 시도하세요.".into());
            }
            state.lists.push(List {
                id: new_id,
                name: text(input, "name", 100)?,
            });
        }
        "list-rename" => {
            let key = text(input, "id", 200)?;
            state
                .lists
                .iter_mut()
                .find(|x| x.id == key)
                .ok_or_else(missing)?
                .name = text(input, "name", 100)?;
        }
        "list-delete" => {
            let key = text(input, "id", 200)?;
            if key == "default" || state.items.iter().any(|x| x.list_id == key) {
                return Err("기본 목록이나 항목이 있는 목록은 삭제할 수 없습니다.".into());
            }
            let at = state
                .lists
                .iter()
                .position(|x| x.id == key)
                .ok_or_else(missing)?;
            state.lists.remove(at);
        }
        "add" => {
            capacity(state.items.len())?;
            if state.items.iter().any(|x| x.id == new_id) {
                return Err("ID 충돌입니다. 다시 시도하세요.".into());
            }
            state.items.push(new_todo(input, &state.lists, new_id)?);
        }
        "batch-add" => {
            let entries = input["items"]
                .as_array()
                .ok_or("추가할 항목을 선택해 주세요.")?;
            if entries.is_empty() || entries.len() > 30 || state.items.len() + entries.len() > 2000
            {
                return Err("한 번에 1~30개, 전체 2000개까지 추가할 수 있습니다.".into());
            }
            if input.get("listName").is_some() && input.get("listId").is_some() {
                return Err("목록 이름과 ID 중 하나만 지정해 주세요.".into());
            }
            let list = if input.get("listName").is_some() {
                let name = text(input, "listName", 100)?;
                if let Some(list) = state.lists.iter().find(|list| list.name == name) {
                    Some(list.id.clone())
                } else {
                    capacity(state.lists.len())?;
                    let list_id = format!("{new_id}-list");
                    if state.lists.iter().any(|list| list.id == list_id) {
                        return Err("목록 ID 충돌입니다.".into());
                    }
                    state.lists.push(List {
                        id: list_id.clone(),
                        name,
                    });
                    Some(list_id)
                }
            } else {
                input
                    .get("listId")
                    .map(|_| text(input, "listId", 200))
                    .transpose()?
            };
            for (index, entry) in entries.iter().enumerate() {
                let mut entry = entry.clone();
                if !entry.is_object() {
                    return Err("할 일 형식이 올바르지 않습니다.".into());
                }
                if let Some(list) = &list {
                    entry["listId"] = json!(list);
                }
                let item_id = format!("{new_id}-{index}");
                if state.items.iter().any(|item| item.id == item_id) {
                    return Err("항목 ID 충돌입니다.".into());
                }
                state.items.push(new_todo(&entry, &state.lists, item_id)?);
            }
        }
        "plan" => {
            let ids: Vec<String> = decode(input.get("ids").ok_or("항목을 선택해 주세요.")?)?;
            if ids.is_empty() || ids.len() > 2000 {
                return Err("항목을 선택해 주세요.".into());
            }
            let selected = input.get("date").ok_or("선택 날짜가 필요합니다.")?;
            let mut planning_input = json!({"plannedDate":selected});
            for field in ["planPeriod", "planAnchor"] {
                if let Some(value) = input.get(field) {
                    planning_input[field] = value.clone();
                }
            }
            for key in ids {
                let item = state
                    .items
                    .iter_mut()
                    .find(|item| item.id == key)
                    .ok_or_else(missing)?;
                if item.completed_at.is_some() {
                    return Err("완료한 항목의 계획은 변경할 수 없습니다.".into());
                }
                recurrence::apply(item, &planning_input)?;
                item.revision += 1;
            }
        }
        "record-frequency" | "undo-frequency" => {
            let key = text(input, "id", 200)?;
            let item = state
                .items
                .iter_mut()
                .find(|item| item.id == key)
                .ok_or_else(missing)?;
            if !recurrence::is_frequency(item) {
                return Err("주간 횟수 목표를 선택해 주세요.".into());
            }
            if item.completed_at.is_some() {
                return Err("완료한 항목은 완료를 취소한 뒤 기록해 주세요.".into());
            }
            let record_id = if action == "record-frequency" {
                capacity(item.frequency_records.len())?;
                let day = date(&text(input, "date", 10)?)?;
                let rule = item.repeat_rule.as_ref().ok_or("주간 목표 오류")?;
                if day > recurrence::local_datetime(now, &rule.time_zone)?.date() {
                    return Err("미래의 완료를 기록할 수 없습니다.".into());
                }
                let week = recurrence::anchor(day, "week")?;
                if item
                    .frequency_records
                    .iter()
                    .any(|record| record.date == day.to_string())
                {
                    return Err("같은 날에는 한 번만 기록할 수 있습니다.".into());
                }
                let count = item
                    .frequency_records
                    .iter()
                    .filter(|record| {
                        date(&record.date)
                            .ok()
                            .and_then(|date| recurrence::anchor(date, "week").ok())
                            .flatten()
                            == week
                    })
                    .count();
                if count >= rule.times_per_week.unwrap_or(1) {
                    return Err("이번 주 목표를 이미 채웠습니다.".into());
                }
                if item
                    .frequency_records
                    .iter()
                    .any(|record| record.id == new_id)
                {
                    return Err("기록 ID 충돌입니다.".into());
                }
                item.frequency_records.push(FrequencyRecord {
                    id: new_id.clone(),
                    date: day.to_string(),
                    created_at: now,
                });
                new_id
            } else {
                let record_id = text(input, "recordId", 200)?;
                let index = item
                    .frequency_records
                    .iter()
                    .position(|record| record.id == record_id)
                    .ok_or_else(missing)?;
                item.frequency_records.remove(index);
                record_id
            };
            item.revision += 1;
            events.push(EventDraft {
                kind: if action == "record-frequency" {
                    "todo-completed"
                } else {
                    "todo-undone"
                }
                .into(),
                text: format!(
                    "{} {}",
                    item.title,
                    if action == "record-frequency" {
                        "1회 완료"
                    } else {
                        "완료 기록 취소"
                    }
                ),
                payload: json!({"itemId":item.id,"occurrenceId":record_id,"frequency":true}),
            });
        }
        "skip" => {
            let key = text(input, "id", 200)?;
            let item = state
                .items
                .iter_mut()
                .find(|item| item.id == key)
                .ok_or_else(missing)?;
            if item.completed_at.is_some()
                || !recurrence::repeats(item)
                || item
                    .repeat_rule
                    .as_ref()
                    .is_some_and(|rule| rule.mode != "calendar")
            {
                return Err("날짜 기준 반복의 미완료 회차만 건너뛸 수 있습니다.".into());
            }
            let mut next = recurrence::advance(item, now)?;
            if let Some(template) = item.continuation.as_deref() {
                next.continuation = Some(Box::new(recurrence::advance(template, now)?));
            }
            next.revision += 1;
            *item = next;
        }
        "rollover" => {
            let day = text(input, "date", 10)?;
            date(&day)?;
            let ids: Vec<String> = decode(input.get("ids").ok_or("이월할 항목을 선택하세요.")?)?;
            if ids.is_empty() || ids.len() > 2000 {
                return Err("이월할 항목을 선택하세요.".into());
            }
            let due_at_by_id: BTreeMap<String, i64> = match input.get("dueAtById") {
                Some(value) => decode(value)?,
                None => BTreeMap::new(),
            };
            if due_at_by_id.keys().any(|key| !ids.contains(key)) {
                return Err("선택하지 않은 항목의 이월 시각이 포함되어 있습니다.".into());
            }
            for key in ids {
                let item = state
                    .items
                    .iter_mut()
                    .find(|x| x.id == key)
                    .ok_or_else(missing)?;
                if item.completed_at.is_some() {
                    return Err("완료한 항목은 이월할 수 없습니다.".into());
                }
                if item.due_at.is_some() {
                    let at = *due_at_by_id
                        .get(&key)
                        .ok_or("시각이 있는 항목은 지역 날짜에 맞는 이월 시각이 필요합니다.")?;
                    DateTime::<Utc>::from_timestamp_millis(at)
                        .ok_or("이월 시각 범위를 벗어났습니다.")?;
                    let midnight = date(&day)?
                        .and_hms_opt(0, 0, 0)
                        .ok_or("이월 날짜 오류")?
                        .and_utc()
                        .timestamp_millis();
                    if at < midnight.saturating_sub(14 * 3_600_000)
                        || at >= midnight.saturating_add(38 * 3_600_000)
                    {
                        return Err("선택한 날짜와 이월 시각이 일치하지 않습니다.".into());
                    }
                    item.due_at = Some(at);
                } else {
                    if due_at_by_id.contains_key(&key) {
                        return Err("날짜만 있는 항목에 시각을 추가할 수 없습니다.".into());
                    }
                    item.due_date = Some(day.clone());
                }
                item.revision += 1;
            }
        }
        "update" | "complete" | "undo" | "delete" => {
            let key = text(input, "id", 200)?;
            let at = state
                .items
                .iter()
                .position(|x| x.id == key)
                .ok_or_else(missing)?;
            match action {
                "delete" => {
                    state.items.remove(at);
                }
                "update" => {
                    let scope = input
                        .get("scope")
                        .map(|value| value.as_str().ok_or("편집 범위 오류"))
                        .transpose()?
                        .unwrap_or("occurrence");
                    if !["occurrence", "following"].contains(&scope) {
                        return Err("편집 범위를 확인해 주세요.".into());
                    }
                    if scope == "occurrence"
                        && recurrence::repeats(&state.items[at])
                        && !recurrence::is_frequency(&state.items[at])
                        && state.items[at].continuation.is_none()
                    {
                        let mut template = state.items[at].clone();
                        template.generation = None;
                        state.items[at].continuation = Some(Box::new(template));
                    } else if scope == "following" {
                        state.items[at].continuation = None;
                    }
                    update_todo(&mut state.items[at], input, &state.lists)?;
                    if scope == "following" {
                        let mut parent = state.items[at].clone();
                        let mut visited = std::collections::BTreeSet::from([parent.id.clone()]);
                        while let Some(index) = state
                            .items
                            .iter()
                            .position(|item| item.generated_from.as_ref() == Some(&parent.id))
                        {
                            if !visited.insert(state.items[index].id.clone()) {
                                return Err("반복 연결이 올바르지 않습니다.".into());
                            }
                            if state.items[index].completed_at.is_none() {
                                let mut descendant_input = input.clone();
                                let scheduling_changed =
                                    ["dueDate", "dueAt", "repeat", "repeatRule"]
                                        .iter()
                                        .any(|field| input.get(field).is_some());
                                if let Some(fields) = descendant_input.as_object_mut() {
                                    fields.remove("dueDate");
                                    fields.remove("dueAt");
                                }
                                if scheduling_changed
                                    && recurrence::repeats(&parent)
                                    && !recurrence::is_frequency(&parent)
                                {
                                    let next = recurrence::advance(&parent, now)?;
                                    state.items[index].due_at = next.due_at;
                                    state.items[index].due_date = next.due_date;
                                }
                                state.items[index].continuation = None;
                                update_todo(
                                    &mut state.items[index],
                                    &descendant_input,
                                    &state.lists,
                                )?;
                            }
                            parent = state.items[index].clone();
                        }
                    }
                }
                "complete" => {
                    if recurrence::is_frequency(&state.items[at]) {
                        return Err("주간 목표는 횟수 기록을 사용해 주세요.".into());
                    }
                    if state.items[at].completed_at.is_none() {
                        let mut item = state.items[at].clone();
                        item.completed_at = Some(now);
                        if (recurrence::repeats(&item) || item.continuation.is_some())
                            && item.generation.is_none()
                        {
                            capacity(state.items.len())?;
                            let mut next = recurrence::advance(
                                item.continuation.as_deref().unwrap_or(&item),
                                now,
                            )?;
                            next.id = format!("{}-next", id(now, entropy));
                            if state.items.iter().any(|x| x.id == next.id) {
                                return Err("다음 회차 ID가 이미 있습니다.".into());
                            }
                            next.completed_at = None;
                            next.generation = None;
                            next.generated_from = Some(item.id.clone());
                            next.revision = 0;
                            next.continuation = None;
                            next.frequency_records.clear();
                            item.generation = Some(Generation {
                                id: next.id.clone(),
                                snapshot: serde_json::to_value(&next).map_err(|e| e.to_string())?,
                            });
                            state.items.push(next);
                        }
                        events.push(event("todo-completed", &item));
                        state.items[at] = item;
                    }
                }
                "undo" => {
                    if state.items[at].completed_at.is_some() {
                        let generation = state.items[at].generation.clone();
                        if let Some(generation) = generation {
                            if let Some(child) =
                                state.items.iter().position(|x| x.id == generation.id)
                            {
                                let snapshot: Todo =
                                    decode(&normalize_legacy_todo(generation.snapshot)?)?;
                                if serde_json::to_value(&state.items[child])
                                    .map_err(|e| e.to_string())?
                                    == serde_json::to_value(snapshot).map_err(|e| e.to_string())?
                                {
                                    state.items.remove(child);
                                    let parent = state
                                        .items
                                        .iter_mut()
                                        .find(|x| x.id == key)
                                        .ok_or_else(missing)?;
                                    parent.generation = None;
                                }
                            }
                        }
                        let item = state
                            .items
                            .iter_mut()
                            .find(|x| x.id == key)
                            .ok_or_else(missing)?;
                        item.completed_at = None;
                        events.push(event("todo-undone", item));
                    }
                }
                _ => unreachable!(),
            }
        }
        _ => return Err("지원하지 않는 할 일 동작입니다.".into()),
    }
    encode(state, events)
}

fn timer(
    data: &Value,
    action: &str,
    input: &Value,
    related: &BTreeMap<String, Value>,
    now: i64,
) -> Result<WidgetEffect, String> {
    let mut state: Timer = decode(data)?;
    match action {
        "start" | "rest" | "continue" => {
            if action != "start" && state.status != "finished" {
                return Err("타이머 종료 후 선택할 수 있습니다.".into());
            }
            let duration =
                input
                    .get("durationMs")
                    .and_then(Value::as_i64)
                    .unwrap_or(if action == "rest" {
                        300000
                    } else {
                        state.focus_duration_ms.unwrap_or(state.duration_ms)
                    });
            if !(1000..=86400000).contains(&duration) {
                return Err("타이머는 1초부터 24시간까지 설정할 수 있습니다.".into());
            }
            if input
                .get("durationMs")
                .is_some_and(|v| v.as_i64().is_none())
            {
                return Err("타이머 길이가 올바르지 않습니다.".into());
            }
            if input.get("todoId").is_some() {
                state.todo_id = if input["todoId"].is_null() {
                    None
                } else {
                    let key = text(input, "todoId", 200)?;
                    let todo: TodoState =
                        decode(related.get("todo").ok_or("할 일 위젯을 켜 주세요.")?)?;
                    if !todo
                        .items
                        .iter()
                        .any(|x| x.id == key && x.completed_at.is_none())
                    {
                        return Err(missing());
                    }
                    Some(key)
                };
            }
            state.status = "running".into();
            state.mode = if action == "rest" { "rest" } else { "focus" }.into();
            if action != "rest" {
                state.focus_duration_ms = Some(duration);
            }
            state.duration_ms = duration;
            state.remaining_ms = duration;
            state.deadline = Some(
                now.checked_add(duration)
                    .ok_or("시각 범위를 벗어났습니다.")?,
            );
        }
        "pause" => {
            if state.status != "running" {
                return Err("실행 중인 타이머가 없습니다.".into());
            }
            let remaining = state
                .deadline
                .ok_or("종료 시각 오류")?
                .saturating_sub(now)
                .max(0);
            if remaining == 0 {
                return timer_finish(state);
            }
            state.remaining_ms = remaining;
            state.deadline = None;
            state.status = "paused".into();
        }
        "resume" => {
            if state.status != "paused" {
                return Err("일시정지된 타이머가 없습니다.".into());
            }
            state.deadline = Some(
                now.checked_add(state.remaining_ms)
                    .ok_or("시각 범위 오류")?,
            );
            state.status = "running".into();
        }
        "cancel" => {
            state.status = "idle".into();
            state.deadline = None;
            state.remaining_ms = state.duration_ms;
            state.todo_id = None;
        }
        _ => return Err("지원하지 않는 타이머 동작입니다.".into()),
    }
    encode(state, vec![])
}
fn timer_finish(mut state: Timer) -> Result<WidgetEffect, String> {
    state.status = "finished".into();
    state.deadline = None;
    state.remaining_ms = 0;
    let event = EventDraft {
        kind: "timer-finished".into(),
        text: if state.mode == "rest" {
            "쉬는 시간이 끝났어요."
        } else {
            "집중 시간이 끝났어요. 계속할지 쉴지 골라 주세요."
        }
        .into(),
        payload: json!({"todoId":state.todo_id,"mode":state.mode}),
    };
    encode(state, vec![event])
}

pub fn act(
    kind: &str,
    data: &Value,
    action: &str,
    input: &Value,
    related: &BTreeMap<String, Value>,
    now: i64,
    entropy: u64,
) -> Result<WidgetEffect, String> {
    if !input.is_object() {
        return Err("동작 입력은 객체여야 합니다.".into());
    }
    match kind {
        "todo" => todo(data, action, input, now, entropy),
        "focus-timer" => timer(data, action, input, related, now),
        "memo" => {
            let mut state: MemoState = decode(data)?;
            match action {
                "add" => {
                    capacity(state.notes.len())?;
                    let key = id(now, entropy);
                    if state.notes.iter().any(|x| x.id == key) {
                        return Err("ID 충돌입니다.".into());
                    }
                    state.notes.push(Note {
                        id: key,
                        title: optional_text(input, "title", 500)?,
                        body: optional_text(input, "body", 50000)?,
                        updated_at: now,
                        is_open: input
                            .get("isOpen")
                            .and_then(Value::as_bool)
                            .unwrap_or(false),
                        font_size: note_font_size(input)?,
                    });
                }
                "update" | "delete" => {
                    let key = text(input, "id", 200)?;
                    let at = state
                        .notes
                        .iter()
                        .position(|x| x.id == key)
                        .ok_or_else(missing)?;
                    if action == "delete" {
                        state.notes.remove(at);
                    } else {
                        let item = &mut state.notes[at];
                        if let Some(expected) = input.get("expectedBody") {
                            if expected.as_str() != Some(item.body.as_str()) {
                                return Err("다른 화면에서 이 메모가 변경됐어요. 내용을 확인한 뒤 다시 저장해 주세요.".into());
                            }
                        }
                        if let Some(open) = input.get("isOpen") {
                            item.is_open =
                                open.as_bool().ok_or("메모 열림 값이 올바르지 않습니다.")?;
                        }
                        if input.get("fontSize").is_some() {
                            item.font_size = note_font_size(input)?;
                        }
                        if input.get("title").is_some() {
                            item.title = text(input, "title", 500)?;
                        }
                        if input.get("body").is_some() {
                            item.body = optional_text(input, "body", 50000)?;
                        }
                        item.updated_at = now;
                    }
                }
                _ => return Err("지원하지 않는 메모 동작입니다.".into()),
            }
            encode(state, vec![])
        }
        "clock" => {
            let mut state: Clock = decode(data)?;
            match action {
                "configure" => {
                    let format = text(input, "format", 3)?;
                    if !["12h", "24h"].contains(&format.as_str()) {
                        return Err("시간 형식 오류".into());
                    }
                    state.format = format;
                }
                "add" => {
                    capacity(state.anniversaries.len())?;
                    let key = id(now, entropy);
                    if state.anniversaries.iter().any(|x| x.id == key) {
                        return Err("ID 충돌입니다.".into());
                    }
                    let day = text(input, "date", 10)?;
                    date(&day)?;
                    state.anniversaries.push(Anniversary {
                        id: key,
                        title: text(input, "title", 500)?,
                        date: day,
                    });
                }
                "update" | "delete" => {
                    let key = text(input, "id", 200)?;
                    let at = state
                        .anniversaries
                        .iter()
                        .position(|x| x.id == key)
                        .ok_or_else(missing)?;
                    if action == "delete" {
                        state.anniversaries.remove(at);
                    } else {
                        let item = &mut state.anniversaries[at];
                        if input.get("title").is_some() {
                            item.title = text(input, "title", 500)?;
                        }
                        if input.get("date").is_some() {
                            let day = text(input, "date", 10)?;
                            date(&day)?;
                            item.date = day;
                        }
                    }
                }
                _ => return Err("지원하지 않는 시계 동작입니다.".into()),
            }
            encode(state, vec![])
        }
        "preparation" => preparation(data, action, input, related, now, entropy),
        _ => Err("지원하지 않는 위젯입니다.".into()),
    }
}

fn preparation(
    data: &Value,
    action: &str,
    input: &Value,
    related: &BTreeMap<String, Value>,
    now: i64,
    entropy: u64,
) -> Result<WidgetEffect, String> {
    let mut state: Preparation = decode(data)?;
    let new_id = id(now, entropy);
    if action == "create" {
        capacity(state.envelopes.len())?;
        if state.envelopes.iter().any(|x| x.id == new_id) {
            return Err("ID 충돌입니다.".into());
        }
        state.envelopes.push(Envelope {
            id: new_id,
            event_id: text(input, "eventId", 1000)?,
            event_label: text(input, "eventLabel", 1000)?,
            checks: vec![],
            links: vec![],
            todo_ids: vec![],
        });
        return encode(state, vec![]);
    }
    let key = text(input, "id", 200)?;
    let at = state
        .envelopes
        .iter()
        .position(|x| x.id == key)
        .ok_or_else(missing)?;
    if action == "delete" {
        state.envelopes.remove(at);
        return encode(state, vec![]);
    }
    let envelope = &mut state.envelopes[at];
    match action {
        "check-add" => {
            capacity(envelope.checks.len())?;
            if envelope.checks.iter().any(|x| x.id == new_id) {
                return Err("ID 충돌입니다.".into());
            }
            envelope.checks.push(Check {
                id: new_id,
                text: text(input, "text", 1000)?,
                done: false,
            });
        }
        "check-toggle" | "check-delete" => {
            let key = text(input, "checkId", 200)?;
            let at = envelope
                .checks
                .iter()
                .position(|x| x.id == key)
                .ok_or_else(missing)?;
            if action == "check-delete" {
                envelope.checks.remove(at);
            } else {
                envelope.checks[at].done = !envelope.checks[at].done;
            }
        }
        "link-add" => {
            capacity(envelope.links.len())?;
            if envelope.links.iter().any(|x| x.id == new_id) {
                return Err("ID 충돌입니다.".into());
            }
            let url = text(input, "url", 4000)?;
            let parsed = reqwest::Url::parse(&url).map_err(|_| "링크 주소 오류")?;
            if !["http", "https"].contains(&parsed.scheme())
                || parsed.host_str().is_none()
                || !parsed.username().is_empty()
                || parsed.password().is_some()
            {
                return Err("HTTP/HTTPS 링크만 사용할 수 있습니다.".into());
            }
            envelope.links.push(Link {
                id: new_id,
                title: text(input, "title", 500)?,
                url,
            });
        }
        "link-delete" => {
            let key = text(input, "linkId", 200)?;
            let at = envelope
                .links
                .iter()
                .position(|x| x.id == key)
                .ok_or_else(missing)?;
            envelope.links.remove(at);
        }
        "todo-link" => {
            let key = text(input, "todoId", 200)?;
            let todos: TodoState = decode(related.get("todo").ok_or("할 일 위젯을 켜 주세요.")?)?;
            if !todos.items.iter().any(|x| x.id == key) {
                return Err(missing());
            }
            if !envelope.todo_ids.contains(&key) {
                capacity(envelope.todo_ids.len())?;
                envelope.todo_ids.push(key);
            }
        }
        "todo-unlink" => {
            let key = text(input, "todoId", 200)?;
            let at = envelope
                .todo_ids
                .iter()
                .position(|x| x == &key)
                .ok_or_else(missing)?;
            envelope.todo_ids.remove(at);
        }
        _ => return Err("지원하지 않는 준비 봉투 동작입니다.".into()),
    }
    encode(state, vec![])
}

pub fn tick(kind: &str, data: &Value, now: i64) -> Result<Option<WidgetEffect>, String> {
    if kind != "focus-timer" {
        return Ok(None);
    }
    let state: Timer = decode(data)?;
    if state.status == "running" && state.deadline.is_some_and(|deadline| deadline <= now) {
        return timer_finish(state).map(Some);
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn run(kind: &str, data: &Value, action: &str, input: Value, now: i64) -> WidgetEffect {
        act(kind, data, action, &input, &BTreeMap::new(), now, 7).unwrap()
    }
    #[test]
    fn repeat_completion_roundtrip_and_undo_preserve_edited_next_occurrence() {
        let added = run(
            "todo",
            &initial("todo"),
            "add",
            json!({"title":"월말 정리","dueDate":"2026-01-31","repeat":"monthly"}),
            1,
        );
        let key = added.data["items"][0]["id"].clone();
        let completed = run("todo", &added.data, "complete", json!({"id":key}), 2);
        assert_eq!(completed.events[0].kind, "todo-completed");
        assert_eq!(completed.events[0].payload["occurrenceId"], key);
        let wire = serde_json::to_value(super::super::WidgetEvent {
            id: "event".into(),
            instance_id: "todo".into(),
            widget_kind: "todo".into(),
            revision: 1,
            created_at: 2,
            expires_at: 30_002,
            event: completed.events[0].clone(),
        })
        .unwrap();
        assert_eq!(wire["text"], completed.events[0].text);
        assert!(wire.get("event").is_none());
        assert_eq!(completed.data["items"][1]["dueDate"], "2026-02-28");
        let restored: Value = serde_json::from_str(&completed.data.to_string()).unwrap();
        let repeated = run("todo", &restored, "complete", json!({"id":key}), 3);
        assert!(repeated.events.is_empty());
        assert_eq!(repeated.data, restored);
        let next = restored["items"][1]["id"].clone();
        let edited = run(
            "todo",
            &restored,
            "update",
            json!({"id":next,"memo":"보존할 준비 내용"}),
            4,
        );
        let undone = run("todo", &edited.data, "undo", json!({"id":key}), 5);
        assert_eq!(undone.events[0].kind, "todo-undone");
        assert_eq!(undone.data["items"].as_array().unwrap().len(), 2);
        let again = run("todo", &undone.data, "complete", json!({"id":key}), 6);
        assert_eq!(again.data["items"].as_array().unwrap().len(), 2);
        assert_eq!(again.data["items"][1]["memo"], "보존할 준비 내용");
    }
    #[test]
    fn undo_removes_only_unedited_generated_occurrence() {
        let added = run(
            "todo",
            &initial("todo"),
            "add",
            json!({"title":"물 마시기","dueDate":"2026-09-15","repeat":"daily"}),
            1,
        );
        let key = added.data["items"][0]["id"].clone();
        let completed = run("todo", &added.data, "complete", json!({"id":key}), 2);
        let undone = run("todo", &completed.data, "undo", json!({"id":key}), 3);
        assert_eq!(undone.data["items"].as_array().unwrap().len(), 1);
        let again = run("todo", &undone.data, "complete", json!({"id":key}), 4);
        assert_eq!(again.data["items"].as_array().unwrap().len(), 2);
    }
    #[test]
    fn rollover_and_weekly_repeat_preserve_timestamp_clock_and_other_items() {
        let stamp = DateTime::parse_from_rfc3339("2026-09-15T08:25:00Z")
            .unwrap()
            .timestamp_millis();
        let first = run(
            "todo",
            &initial("todo"),
            "add",
            json!({"title":"운동","dueAt":stamp,"repeat":"weekly"}),
            1,
        );
        let key = first.data["items"][0]["id"].clone();
        let second = run(
            "todo",
            &first.data,
            "add",
            json!({"title":"장보기","dueDate":"2026-09-15"}),
            2,
        );
        let rolled = run(
            "todo",
            &second.data,
            "rollover",
            json!({"ids":[key],"date":"2026-09-16","dueAtById":{(key.as_str().unwrap()):stamp+86400000}}),
            3,
        );
        assert_eq!(rolled.data["items"][0]["dueAt"], stamp + 86400000);
        assert_eq!(rolled.data["items"][1], second.data["items"][1]);
        let done = run("todo", &rolled.data, "complete", json!({"id":key}), 4);
        assert_eq!(done.data["items"][2]["dueAt"], stamp + 8 * 86400000);
        assert!(act(
            "todo",
            &done.data,
            "rollover",
            &json!({"ids":[key],"date":"2026-09-17"}),
            &BTreeMap::new(),
            5,
            7
        )
        .is_err());
    }
    #[test]
    fn rollover_uses_explicit_local_timestamp_and_rejects_missing_or_unrelated_targets() {
        let original = DateTime::parse_from_rfc3339("2026-09-15T01:00:00+09:00")
            .unwrap()
            .timestamp_millis();
        let target = DateTime::parse_from_rfc3339("2026-09-16T01:00:00+09:00")
            .unwrap()
            .timestamp_millis();
        let added = run(
            "todo",
            &initial("todo"),
            "add",
            json!({"title":"새벽 일정","dueAt":original}),
            1,
        );
        let key = added.data["items"][0]["id"].as_str().unwrap();
        let rolled = run(
            "todo",
            &added.data,
            "rollover",
            json!({"ids":[key],"date":"2026-09-16","dueAtById":{(key):target}}),
            2,
        );
        assert_eq!(rolled.data["items"][0]["dueAt"], target);
        assert!(rolled.data["items"][0]["dueDate"].is_null());
        for input in [
            json!({"ids":[key],"date":"2026-09-16"}),
            json!({"ids":[key],"date":"2026-09-16","dueAtById":{"other":target}}),
            json!({"ids":[key],"date":"2026-09-16","dueAtById":{(key):target+86400000*3}}),
        ] {
            assert!(act(
                "todo",
                &added.data,
                "rollover",
                &input,
                &BTreeMap::new(),
                2,
                7
            )
            .is_err());
        }
    }
    #[test]
    fn timer_pause_restart_finish_is_once_and_never_completes_todo() {
        let todos = run(
            "todo",
            &initial("todo"),
            "add",
            json!({"title":"집중할 일"}),
            1,
        )
        .data;
        let key = todos["items"][0]["id"].clone();
        let related = BTreeMap::from([("todo".into(), todos.clone())]);
        let started = act(
            "focus-timer",
            &initial("focus-timer"),
            "start",
            &json!({"durationMs":10000,"todoId":key}),
            &related,
            1000,
            7,
        )
        .unwrap();
        let paused = run("focus-timer", &started.data, "pause", json!({}), 4000);
        assert_eq!(paused.data["remainingMs"], 7000);
        assert!(tick("focus-timer", &paused.data, 50000).unwrap().is_none());
        let restored: Value = serde_json::from_str(&paused.data.to_string()).unwrap();
        let resumed = run("focus-timer", &restored, "resume", json!({}), 50000);
        assert_eq!(resumed.data["deadline"], 57000);
        let finished = tick("focus-timer", &resumed.data, 57000).unwrap().unwrap();
        assert_eq!(finished.events[0].kind, "timer-finished");
        assert_eq!(finished.data["status"], "finished");
        assert!(tick("focus-timer", &finished.data, 58000)
            .unwrap()
            .is_none());
        assert_eq!(related["todo"], todos);
        let rest = run(
            "focus-timer",
            &finished.data,
            "rest",
            json!({"durationMs":1000}),
            58000,
        );
        assert_eq!(rest.data["mode"], "rest");
        let rested = tick("focus-timer", &rest.data, 59000).unwrap().unwrap();
        let continued = run("focus-timer", &rested.data, "continue", json!({}), 60000);
        assert_eq!(continued.data["durationMs"], 10000);
        assert_eq!(continued.data["deadline"], 70000);
    }
    #[test]
    fn lists_and_invalid_due_inputs_do_not_mutate_original() {
        let list = run(
            "todo",
            &initial("todo"),
            "list-add",
            json!({"name":"장보기"}),
            1,
        );
        let list_id = list.data["lists"][1]["id"].clone();
        let added = run(
            "todo",
            &list.data,
            "add",
            json!({"title":"우유","listId":list_id}),
            2,
        );
        assert!(act(
            "todo",
            &added.data,
            "list-delete",
            &json!({"id":list_id}),
            &BTreeMap::new(),
            3,
            7
        )
        .is_err());
        for input in [
            json!({"title":"x","dueDate":"2026-02-30"}),
            json!({"title":"x","dueDate":"2026-09-15","dueAt":0}),
            json!({"title":"x","repeat":"hourly"}),
            json!({"title":"x","dueAt":"tomorrow"}),
        ] {
            assert!(act("todo", &added.data, "add", &input, &BTreeMap::new(), 3, 7).is_err());
        }
        assert_eq!(added.data["items"].as_array().unwrap().len(), 1);
    }
    #[test]
    fn preparation_keeps_local_content_disconnected_and_rejects_unsafe_links() {
        let created = run(
            "preparation",
            &initial("preparation"),
            "create",
            json!({"eventId":"calendar:meeting:2026-09-15","eventLabel":"회의"}),
            1,
        );
        let key = created.data["envelopes"][0]["id"].clone();
        let check = run(
            "preparation",
            &created.data,
            "check-add",
            json!({"id":key,"text":"발표 자료"}),
            2,
        );
        let linked = run(
            "preparation",
            &check.data,
            "link-add",
            json!({"id":key,"title":"자료","url":"https://example.com/slides"}),
            3,
        );
        let toggled = run(
            "preparation",
            &linked.data,
            "check-toggle",
            json!({"id":key,"checkId":linked.data["envelopes"][0]["checks"][0]["id"]}),
            4,
        );
        assert_eq!(toggled.data["envelopes"][0]["checks"][0]["done"], true);
        assert_eq!(
            toggled.data["envelopes"][0]["links"],
            linked.data["envelopes"][0]["links"]
        );
        for url in [
            "javascript:alert(1)",
            "file:///etc/passwd",
            "https://user:secret@example.com",
        ] {
            assert!(act(
                "preparation",
                &linked.data,
                "link-add",
                &json!({"id":key,"title":"bad","url":url}),
                &BTreeMap::new(),
                5,
                7
            )
            .is_err());
        }
    }
    #[test]
    fn memo_and_anniversary_edits_preserve_user_text() {
        let note = run(
            "memo",
            &initial("memo"),
            "add",
            json!({"title":"메모","body":"  원문\n둘째 줄  "}),
            1,
        );
        let updated = run(
            "memo",
            &note.data,
            "update",
            json!({"id":note.data["notes"][0]["id"],"title":"수정"}),
            2,
        );
        assert_eq!(updated.data["notes"][0]["body"], "  원문\n둘째 줄  ");
        let clock = run(
            "clock",
            &initial("clock"),
            "add",
            json!({"title":"여행","date":"2026-12-31"}),
            1,
        );
        let formatted = run(
            "clock",
            &clock.data,
            "configure",
            json!({"format":"12h"}),
            2,
        );
        assert_eq!(formatted.data["anniversaries"], clock.data["anniversaries"]);
    }
}
