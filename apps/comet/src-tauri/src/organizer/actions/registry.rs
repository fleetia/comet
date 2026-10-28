use super::{
    catalog::{self, Definition},
    *,
};
use std::collections::BTreeMap;

pub(super) fn initialize(db: &Connection) -> Result<()> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS organizer_registry_receipts(id TEXT PRIMARY KEY,effects TEXT NOT NULL,result TEXT NOT NULL);").map_err(err)
}

#[derive(Clone, Serialize, Deserialize)]
struct Change {
    owner: String,
    field: String,
    before_exists: bool,
    after_exists: bool,
    before: Value,
    after: Value,
}

fn owner(db: &Connection, definition: &Definition) -> Result<(String, i64, Value)> {
    if definition.owner == "diary" {
        let data = serde_json::to_value(diary::read(db)?).map_err(err)?;
        return Ok((
            "diary".into(),
            data["revision"]
                .as_i64()
                .ok_or("다이어리 버전을 읽지 못했어요.")?,
            data,
        ));
    }
    let widget = storage::instances(db)?
        .into_iter()
        .find(|widget| widget.kind == definition.owner)
        .ok_or("사용할 위젯을 찾을 수 없습니다.")?;
    Ok((widget.id, widget.revision, widget.data))
}

fn visible_rows(rows: &[Value], query: &str, limit: usize) -> Vec<Value> {
    let words: Vec<_> = query.split_whitespace().map(str::to_lowercase).collect();
    let mut rows: Vec<_> = rows.iter().collect();
    rows.sort_by_cached_key(|item| {
        let text = item.to_string().to_lowercase();
        std::cmp::Reverse(
            words
                .iter()
                .filter(|word| text.contains(word.as_str()))
                .count(),
        )
    });
    rows.into_iter()
        .take(limit)
        .map(|value| {
            let mut value = value.clone();
            let mut truncated = vec![];
            if let Some(fields) = value.as_object_mut() {
                for (key, value) in fields {
                    let bounded = bounded_value(value, 2);
                    if *value != bounded {
                        truncated.push(key.clone());
                        *value = bounded;
                    }
                }
            }
            if !truncated.is_empty() {
                value["truncatedFields"] = json!(truncated);
            }
            value
        })
        .collect()
}

fn bounded_value(value: &Value, depth: usize) -> Value {
    match value {
        Value::String(text) => json!(text.chars().take(ENTITY_TEXT_LIMIT).collect::<String>()),
        Value::Array(values) => {
            if depth == 0 {
                json!([])
            } else {
                json!(values
                    .iter()
                    .take(12)
                    .map(|value| bounded_value(value, depth - 1))
                    .collect::<Vec<_>>())
            }
        }
        Value::Object(fields) => {
            if depth == 0 {
                json!({})
            } else {
                Value::Object(
                    fields
                        .iter()
                        .map(|(key, value)| (key.clone(), bounded_value(value, depth - 1)))
                        .collect(),
                )
            }
        }
        _ => value.clone(),
    }
}

/// Same limits as other widgets; `totalCounts` keeps the full size of each list.
fn bound_travel_rows(value: &mut Value, query: &str) {
    for field in ["travels"]
        .into_iter()
        .chain(diary::travel_conversation::COLLECTIONS)
    {
        if let Some(rows) = value[field].as_array() {
            let (total, rows) = (rows.len(), visible_rows(rows, query, 30));
            value["totalCounts"][field] = json!(total);
            value[field] = json!(rows);
        }
    }
}

fn context(definition: &Definition, id: &str, revision: i64, data: &Value, query: &str) -> Value {
    if definition.id.starts_with("travel_") {
        if let Ok(state) = serde_json::from_value::<diary::DiaryState>(data.clone()) {
            let mut value = diary::travel_conversation::context(&state, query);
            bound_travel_rows(&mut value, query);
            value["ownerId"] = json!(id);
            value["revision"] = json!(revision);
            value["kind"] = json!(definition.id);
            return value;
        }
    }
    let mut value = json!({"ownerId":id,"revision":revision,"kind":definition.id});
    if let Some(rows) = data[definition.collection].as_array() {
        value[definition.collection] = json!(visible_rows(rows, query, 30));
        value["totalCount"] = json!(rows.len());
    }
    match definition.owner {
        "diary" => match definition.collection {
            "ledgerEntries" => value["categories"] = data["ledgerSettings"]["categories"].clone(),
            "habits" | "habitChecks" => {
                value["habits"] = json!(visible_rows(
                    data["habits"].as_array().map(Vec::as_slice).unwrap_or(&[]),
                    query,
                    30
                ));
                value["habitChecks"] = json!(visible_rows(
                    data["habitChecks"]
                        .as_array()
                        .map(Vec::as_slice)
                        .unwrap_or(&[]),
                    query,
                    60
                ));
            }
            "timeRecords" => {
                value["categories"] = if data["timeCategories"]
                    .as_array()
                    .is_some_and(|items| !items.is_empty())
                {
                    data["timeCategories"].clone()
                } else {
                    json!([{"id":"work","name":"일"},{"id":"record","name":"기록"},{"id":"life","name":"생활"},{"id":"exercise","name":"운동"},{"id":"rest","name":"쉼"}])
                };
            }
            _ => {}
        },
        "todo" => value["lists"] = data["lists"].clone(),
        "focus-timer" => {
            for key in [
                "status",
                "mode",
                "title",
                "durationMs",
                "remainingMs",
                "deadline",
                "todoId",
            ] {
                value[key] = data[key].clone();
            }
            if let Some(rows) = data["sessions"].as_array() {
                value["sessions"] = json!(visible_rows(rows, query, 10));
            }
        }
        "weather" | "music" => {
            // Connection configuration may contain credentials and is never model context.
            for key in [
                "observation",
                "status",
                "lastSuccessAt",
                "lastAttemptAt",
                "error",
            ] {
                value[key] = data[key].clone();
            }
        }
        "interaction" => {
            for key in ["snacks", "touches", "lastReactionAt"] {
                value[key] = data[key].clone();
            }
        }
        "small-match" => {
            for key in ["game", "a", "b", "result"] {
                value[key] = data[key].clone();
            }
        }
        "fortune" => {
            value["text"] = data["text"].clone();
            value["fictional"] = json!(true);
        }
        "bubbles" => {
            value["count"] = json!(data["bubbles"].as_array().map_or(0, Vec::len));
        }
        "ball" | "paper-plane" => {
            value["available"] = json!(true);
        }
        _ => {}
    }
    value
}

pub(crate) fn entities_for(db: &Connection, kind: &str, query: &str) -> Result<Value> {
    let definition = catalog::definition(kind)?;
    let (id, revision, data) = owner(db, definition)?;
    Ok(context(definition, &id, revision, &data, query))
}

/// IDs that a `kind` proposal may target among the rows its planner `context` shows, with each
/// row's title. `None` when the kind's targets are not plain rows of one collection.
pub(crate) fn context_targets(kind: &str, context: &Value) -> Option<Vec<(String, String)>> {
    let definition = catalog::definition(kind).ok()?;
    if !definition.target || definition.id.starts_with("travel_") {
        return None;
    }
    let collection = if definition.id == "habit_record" {
        "habits"
    } else {
        definition.collection
    };
    Some(
        context[collection]
            .as_array()?
            .iter()
            .filter_map(|row| {
                Some((
                    row["id"].as_str()?.to_owned(),
                    row["title"].as_str().unwrap_or_default().to_owned(),
                ))
            })
            .collect(),
    )
}

fn query_day(value: &str) -> Result<String> {
    if chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .is_ok_and(|date| date.format("%Y-%m-%d").to_string() == value)
    {
        return Ok(value.to_owned());
    }
    // Preserve the date in the supplied offset when replaying timestamp-based plans.
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|at| at.date_naive().to_string())
        .map_err(|_| "조회할 날짜 범위를 확인해 주세요.".into())
}

fn matches_dates(item: &Value, from: Option<&str>, through: Option<&str>) -> bool {
    if from.is_none() && through.is_none() {
        return true;
    }
    let timestamp_day = |key: &str| {
        item[key]
            .as_i64()
            .and_then(chrono::DateTime::from_timestamp_millis)
            .map(|at| {
                if let Some(zone) = item["timeZone"]
                    .as_str()
                    .and_then(|zone| zone.parse::<chrono_tz::Tz>().ok())
                {
                    at.with_timezone(&zone).format("%Y-%m-%d").to_string()
                } else {
                    at.with_timezone(&chrono::Local)
                        .format("%Y-%m-%d")
                        .to_string()
                }
            })
    };
    let start = item["date"]
        .as_str()
        .or(item["plannedDate"].as_str())
        .or(item["dueDate"].as_str())
        .or(item["startDate"].as_str())
        .map(str::to_owned)
        .or_else(|| timestamp_day("startAt"))
        .or_else(|| timestamp_day("dueAt"));
    let end = item["endDate"]
        .as_str()
        .and_then(|day| chrono::NaiveDate::parse_from_str(day, "%Y-%m-%d").ok())
        .and_then(|day| day.pred_opt())
        .map(|day| day.to_string())
        .or_else(|| timestamp_day("endAt"))
        .or_else(|| start.clone());
    start.zip(end).is_some_and(|(start, end)| {
        from.is_none_or(|from| end.as_str() >= from)
            && through.is_none_or(|through| start.as_str() <= through)
    })
}

pub(crate) fn query_registry(db: &Connection, kind: &str, input: &Value) -> Result<Value> {
    let definition = catalog::definition(kind)?;
    if definition.effect != "read" {
        return Err("조회 작업만 실행할 수 있어요.".into());
    }
    catalog::validate(definition, input)?;
    let (id, revision, mut data) = owner(db, definition)?;
    let query = input["query"].as_str().unwrap_or_default();
    let from = input["from"].as_str().map(query_day).transpose()?;
    let through = input["through"].as_str().map(query_day).transpose()?;
    let (from, through) = (from.as_deref(), through.as_deref());
    if from.zip(through).is_some_and(|(a, b)| a > b) {
        return Err("조회할 날짜 범위를 확인해 주세요.".into());
    }
    if definition.id == "travel_query" {
        let state: diary::DiaryState = serde_json::from_value(data).map_err(err)?;
        let mut result = diary::travel_conversation::query(&state, input, from, through)?;
        bound_travel_rows(&mut result, query);
        result["ownerId"] = json!(id);
        result["revision"] = json!(revision);
        result["kind"] = json!(definition.id);
        return Ok(result);
    }
    let field = definition.collection;
    if let Some(rows) = data[field].as_array_mut() {
        rows.retain(|item| {
            let matches_date = field == "habits" || matches_dates(item, from, through);
            matches_date
                && input["kind"]
                    .as_str()
                    .is_none_or(|kind| item["kind"] == kind)
                && input["category"]
                    .as_str()
                    .is_none_or(|category| item["category"] == category)
                && (query.is_empty()
                    || item
                        .to_string()
                        .to_lowercase()
                        .contains(&query.to_lowercase()))
        });
    }
    if definition.id == "habit_query" {
        let ids: Vec<_> = data["habits"]
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or(&[])
            .iter()
            .filter_map(|habit| habit["id"].as_str().map(str::to_owned))
            .collect();
        if let Some(checks) = data["habitChecks"].as_array_mut() {
            checks.retain(|check| {
                matches_dates(check, from, through)
                    && check["habitId"]
                        .as_str()
                        .is_some_and(|id| ids.iter().any(|known| known == id))
            });
        }
    }
    let mut result = context(definition, &id, revision, &data, query);
    if definition.collection == "ledgerEntries" {
        let rows = data["ledgerEntries"]
            .as_array()
            .ok_or("가계부를 읽지 못했어요.")?;
        for kind in ["income", "expense"] {
            let total = rows.iter().filter(|item| item["kind"] == kind).try_fold(
                0_u64,
                |total, item| {
                    total
                        .checked_add(item["amount"].as_u64().unwrap_or(0))
                        .ok_or("합계 범위를 벗어났어요.")
                },
            )?;
            result[format!("{kind}Total")] = json!(total);
        }
    }
    Ok(result)
}

/// `explicit` says whether the request contains an explicit app request; callers derive it from
/// [`has_explicit_request`] or the stored request analysis.
pub(crate) fn authorize_registry(
    query: &str,
    kind: &str,
    mode: &str,
    evidence: &str,
    explicit: bool,
) -> Result<()> {
    let definition = catalog::definition(kind)?;
    if definition.effect == "read" {
        return Ok(());
    }
    authorize_evidence(query, mode, evidence, definition.automatic, explicit)?;
    if mode == "statement" {
        return Ok(());
    }
    let verbs: &[&str] = if kind.ends_with("_delete") {
        &["삭제", "지워", "지우", "없애", "제거", "delete", "remove"]
    } else if kind.ends_with("_open") {
        &["열어", "띄워", "꺼내", "보여", "open", "show"]
    } else if kind.ends_with("_update") {
        &[
            "수정",
            "바꿔",
            "바꾸",
            "변경",
            "옮겨",
            "edit",
            "update",
            "change",
            "reschedule",
        ]
    } else {
        match kind {
            "habit_archive" => &["보관", "꺼내", "archive", "unarchive"],
            "task_undo" => &["완료 취소", "완료를 취소", "미완료", "undo", "reopen"],
            "task_complete" => &["완료", "끝", "complete", "done"],
            "preparation_check_toggle" => &["체크", "완료", "미완료", "check", "complete"],
            "focus_start" => &["시작", "start"],
            "focus_pause" => &["멈춰", "일시정지", "pause"],
            "focus_resume" => &["재개", "다시 시작", "계속", "resume"],
            "focus_cancel" => &["종료", "취소", "멈춰", "중지", "cancel", "stop"],
            "focus_rest" => &["휴식", "쉬어", "rest"],
            "match_dice" => &["굴려", "굴리", "roll"],
            "match_coin" => &["던져", "던지", "flip"],
            "fortune_draw" => &["뽑아", "뽑아줘", "draw"],
            "bubbles_make" => &["만들", "make", "create"],
            "travel_finish" => &[
                "마치",
                "마쳐",
                "끝내",
                "끝냈",
                "다시 정리",
                "finish",
                "reopen",
            ],
            _ => &[
                "추가", "등록", "저장", "기록", "메모", "적어", "만들", "기억", "넣어", "잡아",
                "예약", "add", "create", "save", "record",
            ],
        }
    };
    let instruction = instruction_text(&query.to_lowercase());
    if !verbs.iter().any(|verb| instruction.contains(verb)) {
        return Err("요청한 동작과 실행하려는 작업이 달라요. 할 작업을 직접 알려 주세요.".into());
    }
    Ok(())
}

fn evidence_sentences<'a>(instruction: &'a str, evidence: &str) -> Vec<&'a str> {
    let chars: Vec<_> = instruction.char_indices().collect();
    let mut boundaries = vec![0];
    for (index, (offset, character)) in chars.iter().copied().enumerate() {
        let decimal_point = character == '.'
            && index > 0
            && chars[index - 1].1.is_ascii_digit()
            && chars
                .get(index + 1)
                .is_some_and(|(_, c)| c.is_ascii_digit());
        // A line break or decimal point can still be part of the same statement.
        if matches!(character, '.' | '!' | '?' | '。' | '！' | '？') && !decimal_point {
            boundaries.push(offset + character.len_utf8());
        }
    }
    boundaries.push(instruction.len());
    instruction
        .match_indices(evidence)
        .map(|(start, matched)| {
            let end = start + matched.len();
            let first = boundaries.iter().rfind(|&&offset| offset <= start).unwrap();
            let last = boundaries.iter().find(|&&offset| offset >= end).unwrap();
            &instruction[*first..*last]
        })
        .collect()
}

pub(crate) fn authorize_evidence(
    query: &str,
    mode: &str,
    evidence: &str,
    automatic: bool,
    explicit: bool,
) -> Result<()> {
    let instruction = instruction_text(&query.to_lowercase());
    if evidence.trim().is_empty()
        || !query.contains(evidence)
        || !instruction.contains(&evidence.to_lowercase())
        || !matches!(mode, "explicit" | "statement")
    {
        return Err("사용자 원문에서 실행 요청을 확인하지 못했어요.".into());
    }
    let lower = instruction.clone();
    if [
        "하지 마",
        "하지마",
        "하지 말",
        "하지말",
        "말고",
        "하지 않",
        "하지않",
        "안 샀",
        "안샀",
        "사먹지 않",
        "안 먹",
        "안먹",
        "안 했",
        "안했",
        "않았",
        "아니라면",
        "만약",
        "가정",
        "예를 들",
        "예를들",
        "예시",
        "would have",
        "don't",
        "do not",
        "didn't",
        "if i",
        "he said",
        "she said",
        "라고 했",
        "라고했",
        "라고 말",
        "라고말",
        "다고 말",
        "다고말",
    ]
    .iter()
    .any(|term| lower.contains(term))
    {
        return Err(
            "부정·가정·인용 문장은 자동 실행하지 않아요. 실제로 할 작업을 알려 주세요.".into(),
        );
    }
    if mode == "statement" {
        if !automatic {
            return Err("이 작업은 명시적으로 요청할 때만 실행할 수 있어요.".into());
        }
        let sentences = evidence_sentences(&instruction, &evidence.to_lowercase());
        if [
            "내일",
            "모레",
            "예정",
            "하려고",
            "할까",
            "할 거",
            "할거",
            "살까",
            "살 거",
            "살거",
            "먹을",
            "사고 싶",
            "사고싶",
            "친구가",
            "친구는",
            "엄마가",
            "엄마는",
            "아빠가",
            "아빠는",
            "그가",
            "그녀가",
            "동료가",
            "누나가",
            "형이",
            "would",
            "will ",
            "might ",
        ]
        .iter()
        .any(|term| sentences.iter().any(|sentence| sentence.contains(term)))
        {
            return Err("예정이나 다른 사람의 기록은 자동으로 저장하지 않아요.".into());
        }
    } else if !explicit {
        return Err("실행을 요청한 문장을 확인하지 못했어요. 할 작업을 직접 요청해 주세요.".into());
    }
    Ok(())
}

pub(crate) fn has_explicit_request(query: &str) -> bool {
    let instruction = instruction_text(&query.to_lowercase());
    instruction
        .split(['.', '!', '?', '\n', '。', '！', '？'])
        .any(|clause| {
            asks_action(
                clause.trim(),
                &[
                    "추가해",
                    "등록해",
                    "저장해",
                    "기록해",
                    "메모해",
                    "적어",
                    "넣어",
                    "잡아",
                    "예약해",
                    "마쳐",
                    "끝내",
                    "다시 정리해",
                    "만들어",
                    "수정해",
                    "바꿔",
                    "변경해",
                    "옮겨",
                    "삭제해",
                    "지워",
                    "완료해",
                    "완료 처리해",
                    "완료로 표시해",
                    "완료 취소해",
                    "다시 열어",
                    "체크해",
                    "시작해",
                    "멈춰",
                    "정지해",
                    "중지해",
                    "일시정지해",
                    "재개해",
                    "계속해",
                    "종료해",
                    "취소해",
                    "굴려",
                    "던져",
                    "뽑아",
                    "열어",
                    "띄워",
                    "보여",
                    "꺼내",
                    "보관해",
                    "접어",
                    "실행해",
                ],
                &[
                    "add", "create", "save", "record", "update", "edit", "change", "delete",
                    "remove", "complete", "mark", "undo", "start", "stop", "pause", "resume",
                    "cancel", "roll", "flip", "draw", "open", "show", "archive", "finish",
                    "reopen",
                ],
            )
        })
}

fn fill_missing(payload: &mut Value, original: &Value, fields: &str) {
    for key in fields.split(',').filter(|key| !key.is_empty()) {
        if payload.get(key).is_none() {
            if let Some(value) = original.get(key) {
                payload[key] = value.clone();
            }
        }
    }
}

fn payload(
    db: &Connection,
    definition: &Definition,
    action: &Action,
    data: &Value,
    query: &str,
) -> Result<Value> {
    let mut payload = action.input.clone();
    if definition.target != !action.target_id.is_empty()
        || action.target_id.len() > 200
        || action.target_id.chars().any(char::is_control)
    {
        return Err("변경할 항목의 ID를 정확히 선택해 주세요.".into());
    }
    let target_collection = if definition.id == "habit_record" {
        "habits"
    } else {
        definition.collection
    };
    let original = if definition.target {
        Some(
            data[target_collection]
                .as_array()
                .and_then(|items| {
                    items
                        .iter()
                        .find(|item| item["id"].as_str() == Some(&action.target_id))
                })
                .ok_or("변경할 원본 항목을 찾지 못했어요.")?,
        )
    } else {
        None
    };
    if let Some(original) = original {
        if matches!(definition.id, "memo_update" | "memo_delete") && original["isOpen"] == true {
            return Err("열린 메모에는 아직 저장 중인 글이 있을 수 있어요. 메모를 접은 뒤 다시 요청해 주세요.".into());
        }
        validate_text_replacement(original, &payload)?;
        if matches!(
            definition.id,
            "ledger_update" | "habit_update" | "event_update"
        ) {
            fill_missing(&mut payload, original, definition.fields);
        }
        payload["id"] = json!(action.target_id);
        match definition.id {
            "ledger_update" | "ledger_delete" => payload["expected"] = original.clone(),
            "habit_update" | "habit_archive" => payload["expectedHabit"] = original.clone(),
            "time_delete" => payload["expectedRecord"] = original.clone(),
            "memo_update" | "note_update" => {
                payload["expectedTitle"] = original["title"].clone();
                payload["expectedBody"] = original["body"].clone();
            }
            "page_record" => {
                payload["pageId"] = json!(action.target_id);
                payload["kind"] = json!("note");
                payload.as_object_mut().map(|fields| fields.remove("id"));
            }
            "habit_record" => {
                payload["habitId"] = json!(action.target_id);
                payload["expectedCheck"] = data["habitChecks"]
                    .as_array()
                    .and_then(|checks| {
                        checks.iter().find(|check| {
                            check["habitId"] == action.target_id && check["date"] == payload["date"]
                        })
                    })
                    .cloned()
                    .unwrap_or(Value::Null);
                payload.as_object_mut().map(|fields| fields.remove("id"));
            }
            _ => {}
        }
        if definition.id == "event_update" {
            let fields = if payload["allDay"] == true {
                ["startAt", "endAt", "timeZone"]
            } else {
                ["startDate", "endDate", ""]
            };
            for key in fields {
                payload.as_object_mut().map(|values| values.remove(key));
            }
        }
    }
    if definition.id == "habit_create" {
        if payload.get("description").is_none() {
            payload["description"] = json!("");
        }
        if payload.get("color").is_none() {
            payload["color"] = json!("record");
        }
    }
    if definition.id == "focus_start" && payload.get("todoId").is_some() {
        let (_, _, todos) = owner(db, catalog::definition("task_query")?)?;
        let task = todos["items"]
            .as_array()
            .and_then(|items| items.iter().find(|item| item["id"] == payload["todoId"]))
            .ok_or("항목을 찾을 수 없습니다.")?;
        if payload.get("title").is_none() {
            payload["title"] = task["title"].clone();
        }
        payload["memo"] = json!("");
        payload["eventRef"] = Value::Null;
        payload["noteRef"] = Value::Null;
    }
    if definition.id == "time_record" {
        if payload.get("title").is_none() {
            payload["title"] = json!("");
        }
        payload["expectedRecords"] = json!(data["timeRecords"]
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or(&[])
            .iter()
            .filter(|item| item["date"] == payload["date"])
            .collect::<Vec<_>>());
    }
    if definition.id.starts_with("travel_") {
        let state: diary::DiaryState = serde_json::from_value(data.clone()).map_err(err)?;
        diary::travel_conversation::prepare(
            &state,
            definition.id,
            &action.input,
            &mut payload,
            original,
            query,
        )?;
    }
    Ok(payload)
}

fn changes(owner: &str, before: &Value, after: &Value) -> Vec<Change> {
    let fields: std::collections::BTreeSet<_> = before
        .as_object()
        .into_iter()
        .flat_map(|fields| fields.keys())
        .chain(
            after
                .as_object()
                .into_iter()
                .flat_map(|fields| fields.keys()),
        )
        .collect();
    fields
        .into_iter()
        .filter(|field| field.as_str() != "revision" && before.get(*field) != after.get(*field))
        .map(|field| {
            let (prior, next) = if let (Some(before), Some(after)) =
                (before[field].as_array(), after[field].as_array())
            {
                let (before, after) = changed_items(before, after);
                (json!(before), json!(after))
            } else {
                (before[field].clone(), after[field].clone())
            };
            Change {
                owner: owner.into(),
                field: field.clone(),
                before_exists: before.get(field).is_some(),
                after_exists: after.get(field).is_some(),
                before: prior,
                after: next,
            }
        })
        .collect()
}

fn ensure_removed_unreferenced(db: &Connection, changes: &[Change]) -> Result<()> {
    let diary = serde_json::to_value(diary::read(db)?).map_err(err)?;
    let widgets = storage::instances(db)?;
    for change in changes {
        if let (Some(before), Some(after)) = (change.before.as_array(), change.after.as_array()) {
            for item in before.iter().filter(|item| {
                !after.iter().any(|next| {
                    item_key(next, &change.field).ok() == item_key(item, &change.field).ok()
                })
            }) {
                let Some(id) = item["id"].as_str() else {
                    continue;
                };
                if references(&diary, id)
                    || widgets.iter().any(|widget| references(&widget.data, id))
                {
                    return Err("다른 기록에서 참조 중인 항목은 자동으로 제거하지 않았어요.".into());
                }
            }
        }
    }
    Ok(())
}

pub(crate) fn execute_registry(
    db: &Connection,
    user: &str,
    input_id: &str,
    step: usize,
    query: &str,
    action: &Action,
) -> Result<Receipt> {
    let definition = catalog::definition(&action.kind)?;
    if definition.action == "desktop-open" {
        return Err("바탕화면 열기는 네이티브 실행 경로에서만 처리할 수 있어요.".into());
    }
    if definition.effect == "read" {
        return Err("조회는 query_registry를 사용해 주세요.".into());
    }
    if query.trim().is_empty() {
        return Err("사용자의 실행 요청이 필요해요.".into());
    }
    catalog::validate(definition, &action.input)?;
    let id = operation_id(user, input_id, step);
    let fingerprint = hex::encode(Sha256::digest(serde_json::to_vec(action).map_err(err)?));
    let tx = db.unchecked_transaction().map_err(err)?;
    if store::active_user_id(&tx)? != user {
        return Err("사용자가 변경되어 작업을 멈췄어요.".into());
    }
    let saved: Option<(String, String)> = tx
        .query_row(
            "SELECT fingerprint,receipt FROM organizer_action_receipts WHERE id=?1 AND user_id=?2",
            params![id, user],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(err)?;
    if let Some((previous, receipt)) = saved {
        if previous != fingerprint {
            return Err("이미 처리한 요청의 내용이 달라졌어요. 새 메시지로 요청해 주세요.".into());
        }
        return serde_json::from_str(&receipt).map_err(err);
    }
    let (owner_id, revision, before) = owner(&tx, definition)?;
    if revision != action.expected_revision {
        return Err(format!(
            "원본이 바뀌었어요. 최신 revision {revision}의 내용을 확인하고 다시 요청해 주세요."
        ));
    }
    let payload = payload(&tx, definition, action, &before, query)?;
    let timestamp = chrono::Utc::now().timestamp_millis();
    let after = if definition.owner == "diary" {
        serde_json::to_value(diary::update_in_transaction(
            &tx,
            u64::try_from(revision).map_err(err)?,
            definition.action,
            &payload,
        )?)
        .map_err(err)?
    } else {
        storage::execute_in_transaction(
            &tx,
            &WidgetRequest {
                request_id: id.clone(),
                instance_id: owner_id.clone(),
                expected_revision: revision,
                action: definition.action.into(),
                input: payload,
            },
            timestamp,
            uuid::Uuid::new_v4().as_u128() as u64,
        )?;
        storage::get(&tx, &owner_id)?.data
    };
    let effects = changes(&owner_id, &before, &after);
    ensure_removed_unreferenced(&tx, &effects)?;
    if effects.is_empty() {
        return Err("변경할 내용이 없어서 새 작업을 저장하지 않았어요.".into());
    }
    let target = if action.target_id.is_empty() {
        effects
            .iter()
            .find(|effect| effect.field == definition.collection)
            .and_then(|effect| effect.after.as_array())
            .and_then(|items| {
                // Creating an item may also normalize existing entries in the same collection.
                items
                    .iter()
                    .find(|item| {
                        !before[definition.collection]
                            .as_array()
                            .is_some_and(|prior| {
                                prior.iter().any(|previous| previous["id"] == item["id"])
                            })
                    })
                    .or_else(|| items.first())
            })
            .and_then(|item| item["id"].as_str())
            .unwrap_or(&owner_id)
            .to_string()
    } else {
        action.target_id.clone()
    };
    let mut result = if definition.effect == "control" {
        context(definition, &owner_id, revision + 1, &after, "")
    } else {
        let collection = after[definition.collection]
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        let item = collection.iter().find(|item| {
            item["id"].as_str() == Some(&target)
                || (definition.id == "habit_record"
                    && item["habitId"] == target
                    && item["date"] == action.input["date"])
        });
        json!({"ownerId":owner_id,"targetId":target,"revision":revision+1,"item":item,"deleted":definition.id.ends_with("_delete")})
    };
    // A removed item is only in the state before the change.
    let removed = before[definition.collection]
        .as_array()
        .and_then(|items| {
            items
                .iter()
                .find(|item| item["id"].as_str() == Some(&target))
        })
        .and_then(|item| item["title"].as_str());
    let mut title: String = action.input["title"]
        .as_str()
        .or(result["item"]["title"].as_str())
        .or(removed)
        .unwrap_or(definition.description)
        .chars()
        .take(200)
        .collect();
    if definition.collection == "ledgerEntries" {
        if let Some(amount) = result["item"]["amount"].as_u64() {
            title = format!("{title} · {amount}원");
        }
    }
    if definition.id.starts_with("travel_") {
        let state: diary::DiaryState = serde_json::from_value(before.clone()).map_err(err)?;
        let item = if result["item"].is_null() {
            before[definition.collection]
                .as_array()
                .and_then(|items| items.iter().find(|item| item["id"] == json!(target)))
                .cloned()
                .unwrap_or(Value::Null)
        } else {
            result["item"].clone()
        };
        title = diary::travel_conversation::receipt_title(&state, &item, &title)
            .chars()
            .take(200)
            .collect();
        if !result["item"].is_null() {
            result["item"] = diary::travel_conversation::mask(definition.collection, item);
        }
    }
    let receipt = Receipt {id:id.clone(),input_id:input_id.into(),title,kind:action.kind.clone(),target_id:target,created_at:timestamp,undone:false,source_id:None,undo_supported:Some(definition.undo),undo_reason:(!definition.undo).then(||"시간의 흐름이나 놀이 실행은 되돌릴 수 없어요. 해당 기능에서 다음 동작을 선택해 주세요.".into()),result:Some(result.clone())};
    tx.execute(
        "INSERT INTO organizer_action_receipts VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        params![
            id,
            user,
            input_id,
            fingerprint,
            serde_json::to_string(&receipt).map_err(err)?,
            "registry",
            "",
            "[]",
            "[]"
        ],
    )
    .map_err(err)?;
    tx.execute(
        "INSERT INTO organizer_registry_receipts VALUES(?1,?2,?3)",
        params![
            id,
            serde_json::to_string(&effects).map_err(err)?,
            result.to_string()
        ],
    )
    .map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(receipt)
}

fn item_key(item: &Value, field: &str) -> Result<String> {
    if field == "habitChecks" {
        return Ok(format!(
            "{}:{}",
            item["habitId"].as_str().ok_or("습관 ID가 없어요.")?,
            item["date"].as_str().ok_or("습관 날짜가 없어요.")?
        ));
    }
    item.get("id")
        .filter(|id| id.is_string() || id.is_number())
        .map(Value::to_string)
        .ok_or_else(|| "항목 ID가 없어 되돌릴 수 없어요.".into())
}

fn reverse_collection(current: &mut Vec<Value>, change: &Change) -> Result<()> {
    let before = change
        .before
        .as_array()
        .ok_or("이전 항목을 읽지 못했어요.")?;
    let after = change
        .after
        .as_array()
        .ok_or("저장한 항목을 읽지 못했어요.")?;
    let before: BTreeMap<_, _> = before
        .iter()
        .map(|item| Ok((item_key(item, &change.field)?, item)))
        .collect::<Result<_>>()?;
    let after: BTreeMap<_, _> = after
        .iter()
        .map(|item| Ok((item_key(item, &change.field)?, item)))
        .collect::<Result<_>>()?;
    for (key, item) in &after {
        if !current
            .iter()
            .any(|current| current == *item && item_key(current, &change.field).as_ref() == Ok(key))
        {
            return Err("이 항목이 이후에 수정되어 자동으로 되돌리지 않았어요.".into());
        }
    }
    for key in before.keys().filter(|key| !after.contains_key(*key)) {
        if current
            .iter()
            .any(|item| item_key(item, &change.field).as_ref() == Ok(key))
        {
            return Err("되돌릴 항목의 ID가 이미 사용 중이에요.".into());
        }
    }
    current.retain_mut(|item| {
        let Ok(key) = item_key(item, &change.field) else {
            return true;
        };
        if !after.contains_key(&key) {
            return true;
        }
        if let Some(prior) = before.get(&key) {
            *item = (*prior).clone();
            return true;
        }
        false
    });
    for (key, item) in before {
        if !current
            .iter()
            .any(|current| item_key(current, &change.field).as_ref() == Ok(&key))
        {
            current.push(item.clone());
        }
    }
    Ok(())
}

pub(super) fn undo_in_transaction(tx: &Connection, receipt: &mut Receipt) -> Result<bool> {
    let raw: Option<String> = tx
        .query_row(
            "SELECT effects FROM organizer_registry_receipts WHERE id=?1",
            [&receipt.id],
            |row| row.get(0),
        )
        .optional()
        .map_err(err)?;
    let Some(raw) = raw else {
        return Ok(false);
    };
    if receipt.undo_supported == Some(false) {
        return Err(receipt
            .undo_reason
            .clone()
            .unwrap_or_else(|| "이 동작은 되돌릴 수 없어요.".into()));
    }
    let changes: Vec<Change> = serde_json::from_str(&raw).map_err(err)?;
    let mut owners = BTreeMap::new();
    for change in &changes {
        if !owners.contains_key(&change.owner) {
            let value = if change.owner == "diary" {
                serde_json::to_value(diary::read(tx)?).map_err(err)?
            } else {
                storage::get(tx, &change.owner)?.data
            };
            owners.insert(change.owner.clone(), value);
        }
    }
    // First remove all items created by this operation in the prospective state, so
    // references between its own changes do not prevent an atomic undo.
    let mut prospective = owners.clone();
    for change in &changes {
        let value = prospective
            .get_mut(&change.owner)
            .ok_or("원본을 읽지 못했어요.")?;
        if change.before.is_array() && change.after.is_array() {
            reverse_collection(
                value[&change.field]
                    .as_array_mut()
                    .ok_or("원본 항목 형식이 달라졌어요.")?,
                change,
            )?;
        } else {
            if value[&change.field] != change.after
                || value.get(&change.field).is_some() != change.after_exists
            {
                return Err("이후에 바뀐 상태는 되돌리지 않았어요.".into());
            }
            if change.before_exists {
                value[&change.field] = change.before.clone();
            } else if let Some(fields) = value.as_object_mut() {
                fields.remove(&change.field);
            }
        }
    }
    let diary_now = serde_json::to_value(diary::read(tx)?).map_err(err)?;
    let widgets = storage::instances(tx)?;
    for change in &changes {
        if let (Some(before), Some(after)) = (change.before.as_array(), change.after.as_array()) {
            for item in after.iter().filter(|item| {
                !before.iter().any(|prior| {
                    item_key(prior, &change.field).ok() == item_key(item, &change.field).ok()
                })
            }) {
                let Some(id) = item["id"].as_str() else {
                    continue;
                };
                if references(prospective.get("diary").unwrap_or(&diary_now), id)
                    || widgets.iter().any(|widget| {
                        references(prospective.get(&widget.id).unwrap_or(&widget.data), id)
                    })
                {
                    return Err("다른 기록이 이 항목을 참조하고 있어 되돌리지 않았어요.".into());
                }
            }
        }
    }
    for (owner, mut value) in prospective {
        if owner == "diary" {
            value["revision"] = json!(value["revision"]
                .as_u64()
                .ok_or("버전을 읽지 못했어요.")?
                .checked_add(1)
                .ok_or("버전 범위 오류")?);
            tx.execute(
                "UPDATE diary_state SET data=?1 WHERE id=1",
                [value.to_string()],
            )
            .map_err(err)?;
        } else {
            tx.execute(
                "UPDATE widget_instances SET data=?1,revision=revision+1 WHERE id=?2",
                params![value.to_string(), owner],
            )
            .map_err(err)?;
        }
    }
    receipt.undone = true;
    tx.execute(
        "UPDATE organizer_action_receipts SET receipt=?1 WHERE id=?2",
        params![serde_json::to_string(receipt).map_err(err)?, receipt.id],
    )
    .map_err(err)?;
    Ok(true)
}

pub(super) fn open_result(
    db: &Connection,
    user: &str,
    receipt: &Receipt,
) -> Result<Option<crate::organizer::SourceDocument>> {
    let result: Option<String> = db
        .query_row(
            "SELECT result FROM organizer_registry_receipts WHERE id=?1",
            [&receipt.id],
            |row| row.get(0),
        )
        .optional()
        .map_err(err)?;
    let Some(result) = result else {
        return Ok(None);
    };
    let content = format!(
        "{}\n{}",
        if receipt.undone {
            "되돌린 작업"
        } else {
            "저장한 작업"
        },
        result
    );
    Ok(Some(crate::organizer::SourceDocument {
        source: crate::organizer::SourceRef {
            id: receipt.id.clone(),
            user_id: user.into(),
            workspace_id: "comet".into(),
            project_id: String::new(),
            kind: receipt.kind.clone(),
            locator: receipt.target_id.clone(),
            title: receipt.title.clone(),
            content_hash: crate::organizer::hash(&content),
            active: true,
        },
        content,
    }))
}
