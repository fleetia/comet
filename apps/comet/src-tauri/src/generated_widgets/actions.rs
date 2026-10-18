use super::{err, get, list, safe_key, validate_state, Definition, GeneratedWidget, Result};
use crate::store;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashSet;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActionDefinition {
    pub id: String,
    pub description: String,
    pub operation: String,
    pub input_schema: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActionRequest {
    pub request_id: String,
    pub user_id: String,
    pub input_id: String,
    pub widget_id: String,
    pub expected_revision: i64,
    pub action_id: String,
    pub input: Value,
    pub automatic: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedReceipt {
    pub id: String,
    pub input_id: String,
    pub action_id: String,
    pub widget_id: String,
    pub revision: i64,
    pub title: String,
    pub created_at: i64,
    pub undone: bool,
    pub undo_supported: bool,
    pub result: Value,
}

pub fn initialize(db: &Connection) -> Result<()> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS generated_action_receipts(
        id TEXT PRIMARY KEY,user_id TEXT NOT NULL,input_id TEXT NOT NULL,widget_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL,definition TEXT NOT NULL,before_state TEXT NOT NULL,
        after_state TEXT NOT NULL,receipt TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS generated_action_receipts_input ON generated_action_receipts(user_id,input_id);")
        .map_err(err)
}

pub fn validate_actions(actions: &[ActionDefinition]) -> Result<()> {
    if actions.len() > 16 {
        return Err("대화 동작은 위젯마다 16개까지 등록할 수 있어요.".into());
    }
    let mut ids = HashSet::new();
    for action in actions {
        if action.id.is_empty()
            || action.id.len() > 64
            || !action
                .id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"_-".contains(&c))
            || action.id == "tick"
            || !ids.insert(&action.id)
            || action.description.trim().is_empty()
            || action.description.chars().count() > 300
            || !["read", "create", "update", "delete", "control"]
                .contains(&action.operation.as_str())
            || action.input_schema["type"] != "object"
            || action.input_schema["properties"].get("type").is_some()
        {
            return Err("위젯 대화 동작의 이름·설명·종류를 확인해 주세요.".into());
        }
        if serde_json::to_vec(&action.input_schema).map_err(err)?.len() > 8192 {
            return Err("위젯 동작 입력 정의가 너무 커요.".into());
        }
        validate_schema(&action.input_schema, 0)?;
    }
    Ok(())
}

fn validate_schema(schema: &Value, depth: usize) -> Result<()> {
    let object = schema
        .as_object()
        .ok_or("동작 입력 정의는 객체여야 해요.")?;
    if depth > 4
        || object.keys().any(|key| {
            ![
                "type",
                "description",
                "properties",
                "required",
                "additionalProperties",
                "items",
                "enum",
                "minimum",
                "maximum",
                "minLength",
                "maxLength",
                "minItems",
                "maxItems",
            ]
            .contains(&key.as_str())
        })
    {
        return Err("지원하지 않는 동작 입력 정의예요.".into());
    }
    if schema
        .get("description")
        .is_some_and(|v| v.as_str().is_none_or(|s| s.chars().count() > 300))
    {
        return Err("동작 입력 설명이 올바르지 않아요.".into());
    }
    let kind = schema["type"]
        .as_str()
        .ok_or("동작 입력 자료형이 필요해요.")?;
    let allowed: &[&str] = match kind {
        "object" => &[
            "type",
            "description",
            "properties",
            "required",
            "additionalProperties",
        ],
        "array" => &["type", "description", "items", "minItems", "maxItems"],
        "string" => &["type", "description", "enum", "minLength", "maxLength"],
        "number" | "integer" => &["type", "description", "enum", "minimum", "maximum"],
        "boolean" => &["type", "description", "enum"],
        _ => return Err("지원하지 않는 동작 입력 자료형이에요.".into()),
    };
    if object.keys().any(|key| !allowed.contains(&key.as_str())) {
        return Err("자료형에 맞지 않는 동작 입력 조건이에요.".into());
    }
    if kind == "object" {
        if schema["additionalProperties"] != false {
            return Err("동작 입력은 선언한 필드만 허용해야 해요.".into());
        }
        let properties = schema["properties"]
            .as_object()
            .ok_or("동작 입력 필드가 필요해요.")?;
        if properties.len() > 32
            || properties
                .keys()
                .any(|key| !safe_key(key) || key.len() > 80)
        {
            return Err("동작 입력 필드가 너무 많거나 이름이 올바르지 않아요.".into());
        }
        for value in properties.values() {
            validate_schema(value, depth + 1)?;
        }
        let required = schema["required"]
            .as_array()
            .ok_or("동작의 필수 입력 목록이 필요해요.")?;
        let mut names = HashSet::new();
        for value in required {
            let name = value.as_str().ok_or("필수 입력 이름이 올바르지 않아요.")?;
            if !properties.contains_key(name) || !names.insert(name) {
                return Err("필수 입력 필드를 확인해 주세요.".into());
            }
        }
    }
    if kind == "array" {
        validate_schema(&schema["items"], depth + 1)?;
    }
    for (minimum, maximum, limit) in [
        ("minLength", "maxLength", 4096),
        ("minItems", "maxItems", 128),
    ] {
        for key in [minimum, maximum] {
            if schema
                .get(key)
                .is_some_and(|v| v.as_u64().is_none_or(|n| n > limit))
            {
                return Err("동작 입력 길이 제한이 올바르지 않아요.".into());
            }
        }
        if schema[minimum]
            .as_u64()
            .zip(schema[maximum].as_u64())
            .is_some_and(|(a, b)| a > b)
        {
            return Err("동작 입력 길이 범위가 거꾸로예요.".into());
        }
    }
    for key in ["minimum", "maximum"] {
        if schema.get(key).is_some_and(|v| {
            v.as_f64()
                .is_none_or(|n| !n.is_finite() || n.abs() > super::MAX_SAFE_NUMBER)
        }) {
            return Err("동작 입력 숫자 범위를 확인해 주세요.".into());
        }
    }
    if schema["minimum"]
        .as_f64()
        .zip(schema["maximum"].as_f64())
        .is_some_and(|(a, b)| a > b)
    {
        return Err("동작 입력 숫자 범위가 거꾸로예요.".into());
    }
    if let Some(values) = schema.get("enum") {
        let values = values
            .as_array()
            .filter(|v| !v.is_empty() && v.len() <= 32)
            .ok_or("동작 선택 목록을 확인해 주세요.")?;
        let mut without_enum = schema.clone();
        without_enum.as_object_mut().unwrap().remove("enum");
        for value in values {
            validate_value(&without_enum, value)?;
        }
    }
    Ok(())
}

fn validate_value(schema: &Value, value: &Value) -> Result<()> {
    if schema["enum"]
        .as_array()
        .is_some_and(|values| !values.contains(value))
    {
        return Err("동작 입력이 허용된 선택지에 없어요.".into());
    }
    match schema["type"].as_str().unwrap_or("") {
        "object" => {
            let object = value.as_object().ok_or("동작 입력은 객체여야 해요.")?;
            let fields = schema["properties"]
                .as_object()
                .ok_or("동작 입력 정의가 잘못됐어요.")?;
            if object.keys().any(|key| !fields.contains_key(key))
                || schema["required"].as_array().is_none_or(|keys| {
                    keys.iter()
                        .any(|key| key.as_str().is_none_or(|key| !object.contains_key(key)))
                })
            {
                return Err("필수 입력이 없거나 선언하지 않은 입력이 있어요.".into());
            }
            for (key, value) in object {
                validate_value(&fields[key], value)?;
            }
        }
        "array" => {
            let values = value.as_array().ok_or("목록 입력이 필요해요.")?;
            let min = schema["minItems"].as_u64().unwrap_or(0) as usize;
            let max = schema["maxItems"].as_u64().unwrap_or(128) as usize;
            if values.len() < min || values.len() > max {
                return Err("입력 목록 크기를 확인해 주세요.".into());
            }
            for value in values {
                validate_value(&schema["items"], value)?;
            }
        }
        "string" => {
            let text = value.as_str().ok_or("문자 입력이 필요해요.")?;
            let min = schema["minLength"].as_u64().unwrap_or(0) as usize;
            let max = schema["maxLength"].as_u64().unwrap_or(4096) as usize;
            if text.chars().count() < min || text.chars().count() > max {
                return Err("입력 글자 수를 확인해 주세요.".into());
            }
        }
        "integer" | "number" => {
            let n = value
                .as_f64()
                .filter(|n| n.is_finite() && n.abs() <= super::MAX_SAFE_NUMBER)
                .ok_or("안전한 숫자 입력이 필요해요.")?;
            if (schema["type"] == "integer" && n.fract() != 0.)
                || schema["minimum"].as_f64().is_some_and(|min| n < min)
                || schema["maximum"].as_f64().is_some_and(|max| n > max)
            {
                return Err("입력 숫자 범위를 확인해 주세요.".into());
            }
        }
        "boolean" if value.is_boolean() => {}
        _ => return Err("동작 입력 자료형이 일치하지 않아요.".into()),
    }
    Ok(())
}

pub fn definition<'a>(
    widget: &'a GeneratedWidget,
    action_id: &str,
) -> Result<&'a ActionDefinition> {
    if !widget.installed || !widget.enabled || widget.status != "ready" {
        return Err("실행 준비가 끝나고 켜진 위젯만 사용할 수 있어요.".into());
    }
    widget
        .definition
        .actions
        .iter()
        .find(|action| action.id == action_id)
        .ok_or_else(|| "이 위젯에 등록되지 않은 대화 동작이에요.".into())
}

pub fn validate_input(action: &ActionDefinition, input: &Value) -> Result<()> {
    validate_actions(std::slice::from_ref(action))?;
    validate_state(input)?;
    if serde_json::to_vec(input).map_err(err)?.len() > 4000 {
        return Err("위젯 동작 입력은 4KiB 이하여야 해요.".into());
    }
    validate_value(&action.input_schema, input)
}

pub fn catalog(db: &Connection) -> Result<Vec<Value>> {
    Ok(list(db)?.into_iter().filter(|w| w.installed && w.enabled && w.status == "ready")
        .flat_map(|w| w.definition.actions.iter().map(|a| json!({
            "id":format!("generated:{}:{}",w.id,a.id),"title":w.definition.name,
            "description":a.description,"inputSchema":a.input_schema,
            "effect":if a.operation=="read" {"read"} else if a.operation=="control" {"control"} else {"write"},
            "automatic":a.operation=="create","undoSupported":a.operation!="read",
            "widgetId":w.id,"revision":w.revision
        })).collect::<Vec<_>>()).collect())
}

pub fn context(db: &Connection, id: &str) -> Result<Value> {
    let widget = get(db, id)?;
    if !widget.installed || !widget.enabled || widget.status != "ready" {
        return Err("위젯을 먼저 켜 주세요.".into());
    }
    Ok(
        json!({"id":widget.id,"name":widget.definition.name,"revision":widget.revision,"state":widget.state}),
    )
}

fn fingerprint(request: &ActionRequest) -> Result<String> {
    Ok(hex::encode(Sha256::digest(
        serde_json::to_vec(request).map_err(err)?,
    )))
}

pub fn receipt(db: &Connection, user: &str, id: &str) -> Result<Option<GeneratedReceipt>> {
    if store::active_user_id(db)? != user {
        return Err("사용자가 변경됐어요.".into());
    }
    db.query_row(
        "SELECT receipt FROM generated_action_receipts WHERE id=?1 AND user_id=?2",
        params![id, user],
        |r| r.get::<_, String>(0),
    )
    .optional()
    .map_err(err)?
    .map(|s| serde_json::from_str(&s).map_err(err))
    .transpose()
}

pub fn receipts(db: &Connection, user: &str, input: Option<&str>) -> Result<Vec<GeneratedReceipt>> {
    if store::active_user_id(db)? != user {
        return Err("사용자가 변경됐어요.".into());
    }
    let mut query=db.prepare("SELECT receipt FROM generated_action_receipts WHERE user_id=?1 AND (?2 IS NULL OR input_id=?2) ORDER BY rowid DESC LIMIT 100").map_err(err)?;
    let rows = query
        .query_map(params![user, input], |row| row.get::<_, String>(0))
        .map_err(err)?;
    rows.map(|row| serde_json::from_str(&row.map_err(err)?).map_err(err))
        .collect()
}

pub fn visible_result(db: &Connection, user: &str, id: &str) -> Result<Option<Value>> {
    let Some(receipt) = receipt(db, user, id)? else {
        return Ok(None);
    };
    if receipt.undone {
        return Ok(None);
    }
    let Ok(current) = get(db, &receipt.widget_id) else {
        return Ok(None);
    };
    if !current.installed
        || !current.enabled
        || current.status != "ready"
        || current.revision != receipt.revision
    {
        return Ok(None);
    }
    let (definition, after): (String, String) = db.query_row(
        "SELECT definition,after_state FROM generated_action_receipts WHERE id=?1 AND user_id=?2",
        params![id, user],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).map_err(err)?;
    if current.definition != serde_json::from_str::<Definition>(&definition).map_err(err)?
        || current.state != serde_json::from_str::<Value>(&after).map_err(err)?
    {
        return Ok(None);
    }
    Ok(Some(receipt.result))
}

pub fn replay(db: &Connection, request: &ActionRequest) -> Result<Option<GeneratedReceipt>> {
    if store::active_user_id(db)? != request.user_id {
        return Err("사용자가 변경되어 위젯 동작을 멈췄어요.".into());
    }
    let previous: Option<(String, String)> = db
        .query_row(
            "SELECT fingerprint,receipt FROM generated_action_receipts WHERE id=?1 AND user_id=?2",
            params![request.request_id, request.user_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(err)?;
    previous
        .map(|(previous, receipt)| {
            if previous != fingerprint(request)? {
                return Err("이미 사용한 위젯 요청의 내용이 달라졌어요.".into());
            }
            serde_json::from_str(&receipt).map_err(err)
        })
        .transpose()
}

fn preserves_existing(before: &Value, after: &Value) -> bool {
    match (before, after) {
        (Value::Object(old), Value::Object(new)) => old.iter().all(|(key, value)| {
            new.get(key)
                .is_some_and(|next| preserves_existing(value, next))
        }),
        (Value::Array(old), Value::Array(new)) => new.starts_with(old),
        _ => before == after,
    }
}

pub fn commit(
    db: &Connection,
    request: &ActionRequest,
    before: &GeneratedWidget,
    state: Value,
    view: Value,
) -> Result<GeneratedReceipt> {
    uuid::Uuid::parse_str(&request.request_id).map_err(err)?;
    validate_state(&state)?;
    if !view.is_array() || serde_json::to_vec(&view).map_err(err)?.len() > super::MAX_STATE_BYTES {
        return Err("위젯 실행 결과가 올바르지 않아요.".into());
    }
    let tx = db.unchecked_transaction().map_err(err)?;
    if let Some(receipt) = replay(&tx, request)? {
        return Ok(receipt);
    }
    let current = get(&tx, &request.widget_id)?;
    let action = definition(&current, &request.action_id)?;
    validate_input(action, &request.input)?;
    if current.revision != request.expected_revision || current != *before {
        return Err("실행 중 위젯이 변경되어 결과를 저장하지 않았어요.".into());
    }
    if action.operation == "read" && state != current.state {
        return Err("조회 동작이 위젯 상태를 바꾸려고 해서 중단했어요.".into());
    }
    if request.automatic
        && (action.operation != "create" || !preserves_existing(&current.state, &state))
    {
        return Err("자동 추가 동작이 기존 값을 변경하려고 해서 중단했어요.".into());
    }
    let changed = state != current.state;
    if action.operation == "create" && !changed {
        return Err("위젯을 실행했지만 새 내용이 추가되지 않았어요.".into());
    }
    let revision = if changed {
        current
            .revision
            .checked_add(1)
            .ok_or("위젯 변경 횟수가 한도를 넘었어요.")?
    } else {
        current.revision
    };
    let receipt = GeneratedReceipt {
        id: request.request_id.clone(),
        input_id: request.input_id.clone(),
        action_id: format!("generated:{}:{}", current.id, action.id),
        widget_id: current.id.clone(),
        revision,
        title: format!(
            "{} · {}",
            current.definition.name,
            match action.operation.as_str() {
                "read" => "조회",
                "create" => "추가",
                "update" => "수정",
                "delete" => "삭제",
                _ => "실행",
            }
        ),
        created_at: chrono::Utc::now().timestamp_millis(),
        undone: false,
        undo_supported: changed,
        result: json!({"view":view,"changed":changed}),
    };
    if changed {
        tx.execute(
            "UPDATE generated_widgets SET state=?1,revision=?2 WHERE id=?3 AND revision=?4",
            params![
                serde_json::to_string(&state).map_err(err)?,
                revision,
                current.id,
                current.revision
            ],
        )
        .map_err(err)?;
    }
    tx.execute(
        "INSERT INTO generated_action_receipts VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        params![
            request.request_id,
            request.user_id,
            request.input_id,
            current.id,
            fingerprint(request)?,
            serde_json::to_string(&current.definition).map_err(err)?,
            serde_json::to_string(&current.state).map_err(err)?,
            serde_json::to_string(&state).map_err(err)?,
            serde_json::to_string(&receipt).map_err(err)?
        ],
    )
    .map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(receipt)
}

pub fn undo(db: &Connection, user: &str, id: &str) -> Result<GeneratedReceipt> {
    let tx = db.unchecked_transaction().map_err(err)?;
    let mut receipt = receipt(&tx, user, id)?.ok_or("위젯 작업 결과를 찾지 못했어요.")?;
    if receipt.undone {
        return Ok(receipt);
    }
    if !receipt.undo_supported {
        return Err("상태를 변경하지 않은 동작이에요.".into());
    }
    let current = get(&tx, &receipt.widget_id)?;
    let (definition,before,after):(String,String,String)=tx.query_row("SELECT definition,before_state,after_state FROM generated_action_receipts WHERE id=?1 AND user_id=?2",params![id,user],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(err)?;
    if !current.installed
        || !current.enabled
        || current.status != "ready"
        || current.revision != receipt.revision
        || current.definition != serde_json::from_str::<Definition>(&definition).map_err(err)?
        || current.state != serde_json::from_str::<Value>(&after).map_err(err)?
    {
        return Err("이후 위젯이 변경되어 자동으로 되돌릴 수 없어요.".into());
    }
    let revision = current
        .revision
        .checked_add(1)
        .ok_or("위젯 변경 횟수가 한도를 넘었어요.")?;
    let before: Value = serde_json::from_str(&before).map_err(err)?;
    validate_state(&before)?;
    tx.execute(
        "UPDATE generated_widgets SET state=?1,revision=?2 WHERE id=?3 AND revision=?4",
        params![
            serde_json::to_string(&before).map_err(err)?,
            revision,
            current.id,
            current.revision
        ],
    )
    .map_err(err)?;
    receipt.undone = true;
    tx.execute(
        "UPDATE generated_action_receipts SET receipt=?1 WHERE id=?2 AND user_id=?3",
        params![serde_json::to_string(&receipt).map_err(err)?, id, user],
    )
    .map_err(err)?;
    super::invalidate_rule_source(&tx, &current.id)?;
    tx.commit().map_err(err)?;
    Ok(receipt)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database() -> Connection {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE kv(key TEXT PRIMARY KEY,value TEXT NOT NULL)")
            .unwrap();
        super::super::initialize(&db).unwrap();
        db
    }

    fn action(operation: &str) -> ActionDefinition {
        ActionDefinition {
            id: "add".into(),
            description: "지출을 추가한다".into(),
            operation: operation.into(),
            input_schema: json!({"type":"object","properties":{"amount":{"type":"integer","minimum":1},"title":{"type":"string","minLength":1,"maxLength":100}},"required":["amount","title"],"additionalProperties":false}),
        }
    }

    fn ready(db: &Connection, operation: &str) -> GeneratedWidget {
        let definition = Definition {
            name: "가계부".into(),
            description: "작은 지출 기록".into(),
            source: "function render(s){return []} function reduce(s,a){return s}".into(),
            initial_state: json!({"entries":[{"title":"기존","amount":1000}]}),
            actions: vec![action(operation)],
        };
        let widget = super::super::create(
            db,
            definition,
            super::super::InstallationOrigin::Import,
            None,
        )
        .unwrap();
        super::super::mark_ready(db, &widget.id, widget.revision).unwrap()
    }

    fn request(widget: &GeneratedWidget) -> ActionRequest {
        ActionRequest {
            request_id: uuid::Uuid::new_v4().to_string(),
            user_id: "legacy-user".into(),
            input_id: "message-1".into(),
            widget_id: widget.id.clone(),
            expected_revision: widget.revision,
            action_id: "add".into(),
            input: json!({"amount":3000,"title":"컵라면"}),
            automatic: false,
        }
    }

    fn added() -> Value {
        json!({"entries":[{"title":"기존","amount":1000},{"title":"컵라면","amount":3000}]})
    }

    #[test]
    fn legacy_definitions_remain_usable_and_ready_actions_are_discovered_without_a_router_edit() {
        let legacy:Definition=serde_json::from_value(json!({"name":"이전 위젯","description":"","source":"function render(s){return []} function reduce(s){return s}","initialState":{}})).unwrap();
        assert!(legacy.actions.is_empty());
        super::super::validate_definition(&legacy).unwrap();
        assert!(super::super::validate_generated_definition(&legacy).is_err());
        assert_eq!(
            super::super::definition_schema()["properties"]["actions"]["minItems"],
            1
        );
        let db = database();
        let widget = ready(&db, "create");
        super::super::validate_generated_definition(&widget.definition).unwrap();
        let tools = catalog(&db).unwrap();
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0]["id"], format!("generated:{}:add", widget.id));
        assert_eq!(tools[0]["automatic"], true);
        assert!(context(&db, &widget.id).unwrap().get("source").is_none());
        super::super::set_enabled(&db, &widget.id, widget.revision, false).unwrap();
        assert!(catalog(&db).unwrap().is_empty());
    }

    #[test]
    fn imported_metadata_cannot_add_permissions_or_unsupported_schema_keywords() {
        let mut value = serde_json::to_value(action("create")).unwrap();
        value["automatic"] = json!(true);
        assert!(serde_json::from_value::<ActionDefinition>(value).is_err());
        for schema in [
            json!({"type":"object","properties":{},"required":[],"additionalProperties":true}),
            json!({"type":"object","properties":{"type":{"type":"string"}},"required":[],"additionalProperties":false}),
            json!({"type":"object","properties":{},"required":[],"additionalProperties":false,"$ref":"http://example.test"}),
        ] {
            let mut definition = action("create");
            definition.input_schema = schema;
            assert!(validate_actions(&[definition]).is_err());
        }
        assert!(validate_input(&action("create"), &json!({"amount":-1,"title":"컵라면"})).is_err());
        assert!(validate_input(
            &action("create"),
            &json!({"amount":3000,"title":"컵라면","admin":true})
        )
        .is_err());
        assert!(validate_input(
            &action("create"),
            &json!({"amount":3000.5,"title":"컵라면"})
        )
        .is_err());
    }

    #[test]
    fn receipt_titles_use_user_facing_operations_without_exposing_planner_instructions() {
        let description = "title/date를 전달하고 날짜는 YYYY-MM-DD로 쓰세요. UI 인자가 없으면 입력 필드의 값을 사용하세요. ".repeat(3);
        for (operation, label) in [
            ("read", "조회"),
            ("create", "추가"),
            ("update", "수정"),
            ("delete", "삭제"),
            ("control", "실행"),
        ] {
            let db = database();
            let widget = ready(&db, operation);
            let mut definition = widget.definition.clone();
            definition.actions[0].description = description.clone();
            let widget =
                super::super::replace(&db, &widget.id, widget.revision, definition).unwrap();
            let widget = super::super::mark_ready(&db, &widget.id, widget.revision).unwrap();
            assert_eq!(catalog(&db).unwrap()[0]["description"], description);
            let request = request(&widget);
            let state = match operation {
                "create" => added(),
                "update" => json!({"entries":[{"title":"수정","amount":2000}]}),
                "delete" => json!({"entries":[]}),
                _ => widget.state.clone(),
            };
            let saved = commit(&db, &request, &widget, state, json!([])).unwrap();
            assert_eq!(saved.title, format!("가계부 · {label}"));
            assert_eq!(
                receipt(&db, &request.user_id, &saved.id)
                    .unwrap()
                    .unwrap()
                    .title,
                saved.title
            );
            assert_eq!(
                get(&db, &widget.id).unwrap().definition.actions[0].description,
                description
            );
        }
    }

    #[test]
    fn committed_actions_replay_once_and_undo_only_the_same_unchanged_state() {
        let db = database();
        let widget = ready(&db, "create");
        let request = request(&widget);
        let receipt = commit(
            &db,
            &request,
            &widget,
            added(),
            json!([{ "type":"text","value":"컵라면 3000원"}]),
        )
        .unwrap();
        assert!(receipt.undo_supported);
        assert_eq!(get(&db, &widget.id).unwrap().state, added());
        assert_eq!(
            commit(&db, &request, &widget, added(), json!([]))
                .unwrap()
                .id,
            receipt.id
        );
        assert_eq!(get(&db, &widget.id).unwrap().revision, receipt.revision);
        assert_eq!(
            receipts(&db, "legacy-user", Some("message-1"))
                .unwrap()
                .len(),
            1
        );
        let mut changed = request.clone();
        changed.input["amount"] = json!(4000);
        assert!(replay(&db, &changed).is_err());
        assert!(undo(&db, "legacy-user", &receipt.id).unwrap().undone);
        assert_eq!(get(&db, &widget.id).unwrap().state, widget.state);
        assert!(undo(&db, "legacy-user", &receipt.id).unwrap().undone);
    }

    #[test]
    fn reads_and_automatic_create_cannot_silently_replace_or_delete_existing_values() {
        for operation in ["read", "create", "update"] {
            let db = database();
            let widget = ready(&db, operation);
            let mut request = request(&widget);
            request.automatic = operation != "read";
            assert!(commit(&db, &request, &widget, json!({"entries":[]}), json!([])).is_err());
            assert_eq!(get(&db, &widget.id).unwrap().state, widget.state);
            assert!(receipt(&db, "legacy-user", &request.request_id)
                .unwrap()
                .is_none());
            if operation == "create" {
                assert!(commit(&db, &request, &widget, widget.state.clone(), json!([])).is_err());
                assert!(commit(&db, &request, &widget, added(), json!([])).is_ok());
            }
        }
    }

    #[test]
    fn concurrent_edits_definition_changes_and_user_switches_block_stale_results_and_undo() {
        let db = database();
        let widget = ready(&db, "create");
        let request = request(&widget);
        let receipt = commit(&db, &request, &widget, added(), json!([])).unwrap();
        let latest = get(&db, &widget.id).unwrap();
        super::super::save_state(
            &db,
            &widget.id,
            latest.revision,
            json!({"entries":[{"title":"사용자 수정","amount":5000}]}),
        )
        .unwrap();
        assert!(undo(&db, "legacy-user", &receipt.id).is_err());
        let mut stale = request.clone();
        stale.request_id = uuid::Uuid::new_v4().to_string();
        assert!(commit(&db, &stale, &widget, added(), json!([])).is_err());
        db.execute("INSERT INTO kv VALUES('active_user_id','someone-else')", [])
            .unwrap();
        assert!(replay(&db, &request).is_err());
        assert!(undo(&db, "legacy-user", &receipt.id).is_err());
    }

    #[test]
    fn saved_results_are_visible_only_while_their_source_and_user_remain_current() {
        for change in [
            "disabled",
            "retired",
            "edited",
            "definition",
            "undone",
            "user",
        ] {
            let db = database();
            let widget = ready(&db, "create");
            let request = request(&widget);
            let saved = commit(
                &db,
                &request,
                &widget,
                added(),
                json!([{"type":"text","value":"private result"}]),
            )
            .unwrap();
            assert_eq!(
                visible_result(&db, "legacy-user", &saved.id).unwrap(),
                Some(saved.result)
            );
            assert!(visible_result(&db, "legacy-user", "missing")
                .unwrap()
                .is_none());
            let current = get(&db, &widget.id).unwrap();
            match change {
                "disabled" => {
                    super::super::set_enabled(&db, &widget.id, current.revision, false).unwrap();
                }
                "retired" => {
                    super::super::retire(&db, &widget.id, current.revision).unwrap();
                }
                "edited" => {
                    super::super::save_state(
                        &db,
                        &widget.id,
                        current.revision,
                        json!({"entries":[]}),
                    )
                    .unwrap();
                }
                "definition" => {
                    let mut definition = current.definition;
                    definition.description = "수정된 설명".into();
                    super::super::replace(&db, &widget.id, current.revision, definition).unwrap();
                }
                "undone" => {
                    undo(&db, "legacy-user", &saved.id).unwrap();
                }
                "user" => {
                    db.execute("INSERT INTO kv VALUES('active_user_id','someone-else')", [])
                        .unwrap();
                }
                _ => unreachable!(),
            }
            let visible = visible_result(&db, "legacy-user", &saved.id);
            if change == "user" {
                assert!(visible.is_err());
            } else {
                assert!(visible.unwrap().is_none(), "{change}");
            }
        }
    }
}
