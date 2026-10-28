pub(crate) mod commands;

use crate::characters::reactions::MotionOverride;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;

pub(crate) mod actions;
pub(crate) mod execution;
pub(crate) mod rule_editor;

type Result<T> = std::result::Result<T, String>;

pub const MAX_STATE_BYTES: usize = 64 * 1024;
pub const MAX_SOURCE_BYTES: usize = 48 * 1024;
pub const MAX_DEFINITION_BYTES: usize = 96 * 1024;
const MAX_RULES: usize = 64;
const MAX_SAFE_NUMBER: f64 = 9_007_199_254_740_991.0;
const REACTION_LIFETIME_MS: i64 = 30_000;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Definition {
    pub name: String,
    pub description: String,
    pub source: String,
    pub initial_state: Value,
    #[serde(default)]
    pub actions: Vec<actions::ActionDefinition>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum InstallationOrigin {
    Manual,
    Automatic,
    Import,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Installation {
    pub origin: InstallationOrigin,
    pub model: Option<String>,
    pub installed_at: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GeneratedWidget {
    pub id: String,
    pub definition: Definition,
    pub state: Value,
    pub revision: i64,
    pub reaction: bool,
    pub installed: bool,
    pub status: String,
    pub error: Option<String>,
    #[serde(default)]
    pub installation: Option<Installation>,
    #[serde(default)]
    pub updated_at: Option<i64>,
    /// The definition replaced by the latest AI fix, kept so the user can go back to it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub previous_definition: Option<Definition>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StateRule {
    pub id: String,
    pub widget_id: String,
    pub character_id: String,
    pub field: String,
    pub operator: String,
    pub value: Value,
    pub text: String,
    pub expression: Option<String>,
    pub motion: Option<MotionOverride>,
    pub cooldown_ms: i64,
    pub enabled: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PendingReaction {
    pub id: String,
    pub rule_id: String,
    pub rule_revision: i64,
    pub widget_id: String,
    pub revision: i64,
    pub character_id: String,
    pub text: String,
    pub expression: Option<String>,
    pub motion: Option<MotionOverride>,
    pub created_at: i64,
    pub expires_at: i64,
}

fn err(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn valid_id(id: &str) -> Result<()> {
    uuid::Uuid::parse_str(id)
        .map(|_| ())
        .map_err(|_| "위젯 또는 대사 식별자가 올바르지 않아요.".into())
}

fn safe_key(key: &str) -> bool {
    !matches!(key, "__proto__" | "prototype" | "constructor")
}

fn validate_json(value: &Value, depth: usize, nodes: &mut usize) -> Result<()> {
    *nodes += 1;
    if depth > 16 || *nodes > 4096 {
        return Err("위젯 데이터가 너무 복잡해요.".into());
    }
    match value {
        Value::Number(number) => {
            if number
                .as_f64()
                .is_none_or(|number| !number.is_finite() || number.abs() > MAX_SAFE_NUMBER)
            {
                return Err("위젯 숫자가 안전하게 저장할 수 있는 범위를 넘었어요.".into());
            }
        }
        Value::Array(values) => {
            for item in values {
                validate_json(item, depth + 1, nodes)?;
            }
        }
        Value::Object(values) => {
            for (key, item) in values {
                if !safe_key(key) {
                    return Err("위젯 데이터에 사용할 수 없는 필드 이름이 있어요.".into());
                }
                validate_json(item, depth + 1, nodes)?;
            }
        }
        _ => {}
    }
    Ok(())
}

pub fn validate_state(state: &Value) -> Result<()> {
    if !state.is_object() || serde_json::to_vec(state).map_err(err)?.len() > MAX_STATE_BYTES {
        return Err("위젯 상태는 64KiB 이하의 JSON 객체여야 해요.".into());
    }
    validate_json(state, 0, &mut 0)
}

pub fn validate_definition(definition: &Definition) -> Result<()> {
    if definition.name.trim().is_empty()
        || definition.name.chars().count() > 80
        || definition.description.chars().count() > 500
        || definition.source.trim().is_empty()
        || definition.source.len() > MAX_SOURCE_BYTES
        || serde_json::to_vec(definition).map_err(err)?.len() > MAX_DEFINITION_BYTES
    {
        return Err("위젯 이름·설명·코드의 형식이나 크기를 확인해 주세요.".into());
    }
    let source = definition.source.trim().trim_matches(['\'', '"', '`']);
    let path = source.split(['?', '#']).next().unwrap_or(source);
    if [".js", ".mjs", ".cjs", ".ts", ".jsx", ".tsx"]
        .iter()
        .any(|extension| path.ends_with(extension))
        && source.chars().all(|character| {
            character.is_alphanumeric()
                || character.is_whitespace()
                || "/\\._-:@%?&=#".contains(character)
        })
    {
        return Err("source must contain complete JavaScript code: function render(s,now){...} function reduce(s,a,now){...}. A filename or URL is not code.".into());
    }
    validate_state(&definition.initial_state)?;
    actions::validate_actions(&definition.actions)
}

pub fn validate_generated_definition(definition: &Definition) -> Result<()> {
    validate_definition(definition)?;
    if definition.actions.is_empty() {
        return Err("새로 만들거나 AI로 수정한 위젯에는 대화 동작이 하나 이상 필요해요. 조회 전용 위젯은 상태를 바꾸지 않는 read 동작을 추가해 주세요.".into());
    }
    Ok(())
}

// Model output uses JSON strings for dynamic objects; installed/shared definitions stay objects.
pub fn parse_generated_definition(value: Value) -> Result<Definition> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct GeneratedAction {
        id: String,
        description: String,
        operation: String,
        input_schema_json: String,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct GeneratedDefinition {
        name: String,
        description: String,
        source: String,
        initial_state_json: String,
        actions: Vec<GeneratedAction>,
    }
    let generated: GeneratedDefinition = serde_json::from_value(value).map_err(err)?;
    if generated.initial_state_json.len() > MAX_STATE_BYTES {
        return Err("위젯 상태는 64KiB 이하의 JSON 객체여야 해요.".into());
    }
    let actions = generated
        .actions
        .into_iter()
        .map(|action| {
            Ok(actions::ActionDefinition {
                id: action.id,
                description: action.description,
                operation: action.operation,
                input_schema: serde_json::from_str(&action.input_schema_json).map_err(err)?,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    let definition = Definition {
        name: generated.name,
        description: generated.description,
        source: generated.source,
        initial_state: serde_json::from_str(&generated.initial_state_json).map_err(err)?,
        actions,
    };
    validate_generated_definition(&definition)?;
    Ok(definition)
}

pub fn definition_schema() -> Value {
    json!({
        "type": "object", "additionalProperties": false,
        "required": ["name", "description", "source", "initialStateJson", "actions"],
        "properties": {
            "name": {"type": "string", "minLength": 1, "maxLength": 80},
            "description": {"type": "string", "maxLength": 500},
            "source": {"type": "string", "minLength": 1, "maxLength": MAX_SOURCE_BYTES, "description":"Complete inline JavaScript with function render(s,now) and function reduce(s,a,now). Never a filename or URL."},
            "initialStateJson": {"type": "string", "maxLength":MAX_STATE_BYTES,"description":"A JSON object encoded as a string, e.g. {\"count\":0}."},
            "actions": {"type":"array","minItems":1,"maxItems":16,"items":{
                "type":"object","additionalProperties":false,
                "required":["id","description","operation","inputSchemaJson"],
                "properties":{
                    "id":{"type":"string","minLength":1,"maxLength":64},
                    "description":{"type":"string","minLength":1,"maxLength":300},
                    "operation":{"type":"string","enum":["read","create","update","delete","control"]},
                    "inputSchemaJson":{"type":"string","maxLength":8192,"description":"The action input JSON Schema encoded as a string. Root type object, properties, required, additionalProperties false."}
                }
            }}
        }
    })
}

pub fn initialize(db: &Connection) -> Result<()> {
    let tx = db.unchecked_transaction().map_err(err)?;
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS generated_widgets(
id TEXT PRIMARY KEY,definition TEXT NOT NULL,state TEXT NOT NULL,revision INTEGER NOT NULL,
enabled INTEGER NOT NULL,installed INTEGER NOT NULL,status TEXT NOT NULL,error TEXT);
CREATE TABLE IF NOT EXISTS widget_preferences(key TEXT PRIMARY KEY,value TEXT NOT NULL);
INSERT OR IGNORE INTO widget_preferences(key,value)
SELECT 'reaction:' || id, '0' FROM generated_widgets WHERE enabled=0;
UPDATE generated_widgets SET enabled=1 WHERE enabled!=1;
CREATE TABLE IF NOT EXISTS widget_state_rules(
id TEXT PRIMARY KEY,widget_id TEXT NOT NULL,definition TEXT NOT NULL,revision INTEGER NOT NULL,
last_match INTEGER,last_triggered_at INTEGER);
CREATE INDEX IF NOT EXISTS widget_state_rules_widget ON widget_state_rules(widget_id);
CREATE TABLE IF NOT EXISTS widget_rule_definitions(widget_id TEXT PRIMARY KEY,revision INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS widget_state_pending(
id TEXT PRIMARY KEY,rule_id TEXT UNIQUE NOT NULL,widget_id TEXT NOT NULL,expires_at INTEGER NOT NULL,data TEXT NOT NULL);
DELETE FROM widget_state_pending;
UPDATE widget_state_rules SET last_match=NULL;",
    )
    .map_err(err)?;
    for (column, definition) in [
        ("installation", "TEXT"),
        ("updated_at", "INTEGER"),
        ("previous_definition", "TEXT"),
    ] {
        let exists: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM pragma_table_info('generated_widgets') WHERE name=?1)",
                [column],
                |row| row.get(0),
            )
            .map_err(err)?;
        if !exists {
            tx.execute_batch(&format!(
                "ALTER TABLE generated_widgets ADD COLUMN {column} {definition}"
            ))
            .map_err(err)?;
        }
    }
    actions::initialize(&tx)?;
    tx.commit().map_err(err)
}

fn read_widget(row: &rusqlite::Row<'_>) -> rusqlite::Result<GeneratedWidget> {
    fn parse<T: serde::de::DeserializeOwned>(
        row: &rusqlite::Row<'_>,
        index: usize,
    ) -> rusqlite::Result<T> {
        let text: String = row.get(index)?;
        serde_json::from_str(&text).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                index,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })
    }
    Ok(GeneratedWidget {
        id: row.get(0)?,
        definition: parse(row, 1)?,
        state: parse(row, 2)?,
        revision: row.get(3)?,
        reaction: row.get(4)?,
        installed: row.get(5)?,
        status: row.get(6)?,
        error: row.get(7)?,
        installation: row
            .get::<_, Option<String>>(8)?
            .map(|_| parse(row, 8))
            .transpose()?,
        updated_at: row.get(9)?,
        previous_definition: row
            .get::<_, Option<String>>(10)?
            .map(|_| parse(row, 10))
            .transpose()?,
    })
}

pub fn list(db: &Connection) -> Result<Vec<GeneratedWidget>> {
    let mut statement = db
        .prepare("SELECT id,definition,state,revision,COALESCE((SELECT value FROM widget_preferences WHERE key='reaction:' || generated_widgets.id),'1') != '0',installed,status,error,installation,updated_at,previous_definition FROM generated_widgets ORDER BY rowid")
        .map_err(err)?;
    let rows = statement.query_map([], read_widget).map_err(err)?;
    rows.map(|row| row.map_err(err)).collect()
}

pub fn get(db: &Connection, id: &str) -> Result<GeneratedWidget> {
    valid_id(id)?;
    db.query_row(
        "SELECT id,definition,state,revision,COALESCE((SELECT value FROM widget_preferences WHERE key='reaction:' || generated_widgets.id),'1') != '0',installed,status,error,installation,updated_at,previous_definition FROM generated_widgets WHERE id=?1",
        [id],
        read_widget,
    )
    .optional()
    .map_err(err)?
    .ok_or_else(|| "만든 위젯을 찾지 못했어요.".into())
}

pub fn create(
    db: &Connection,
    definition: Definition,
    origin: InstallationOrigin,
    model: Option<String>,
) -> Result<GeneratedWidget> {
    validate_definition(&definition)?;
    let installed_at = chrono::Utc::now().timestamp_millis();
    let widget = GeneratedWidget {
        id: uuid::Uuid::new_v4().to_string(),
        state: definition.initial_state.clone(),
        definition,
        revision: 1,
        reaction: true,
        installed: true,
        status: "draft".into(),
        error: None,
        installation: Some(Installation {
            origin,
            model,
            installed_at,
        }),
        updated_at: Some(installed_at),
        previous_definition: None,
    };
    db.execute(
        "INSERT INTO generated_widgets(id,definition,state,revision,enabled,installed,status,error,installation,updated_at) VALUES(?1,?2,?3,1,1,1,'draft',NULL,?4,?5)",
        params![widget.id, serde_json::to_string(&widget.definition).map_err(err)?, serde_json::to_string(&widget.state).map_err(err)?, serde_json::to_string(&widget.installation).map_err(err)?, widget.updated_at],
    ).map_err(err)?;
    Ok(widget)
}

fn change(
    db: &Connection,
    id: &str,
    expected_revision: i64,
    update: impl FnOnce(&mut GeneratedWidget) -> Result<()>,
) -> Result<GeneratedWidget> {
    let tx = db.unchecked_transaction().map_err(err)?;
    let mut widget = get(&tx, id)?;
    if !widget.installed || widget.revision != expected_revision {
        return Err("위젯이 변경되거나 제거됐어요. 최신 상태를 확인해 주세요.".into());
    }
    let before = widget.clone();
    update(&mut widget)?;
    if widget != before {
        widget.revision = widget
            .revision
            .checked_add(1)
            .ok_or("위젯 수정 횟수가 한도를 넘었어요.")?;
        if widget.definition != before.definition {
            widget.updated_at = Some(chrono::Utc::now().timestamp_millis());
        }
        let updated = tx.execute(
            "UPDATE generated_widgets SET definition=?1,state=?2,revision=?3,enabled=1,installed=?4,status=?5,error=?6,updated_at=?9,previous_definition=?10 WHERE id=?7 AND revision=?8",
            params![serde_json::to_string(&widget.definition).map_err(err)?, serde_json::to_string(&widget.state).map_err(err)?, widget.revision,widget.installed,widget.status,widget.error,widget.id,expected_revision,widget.updated_at,widget.previous_definition.as_ref().map(serde_json::to_string).transpose().map_err(err)?],
        ).map_err(err)?;
        if updated != 1 {
            return Err("위젯이 변경됐어요. 최신 상태를 확인해 주세요.".into());
        }
        if widget.definition != before.definition
            || widget.installed != before.installed
            || widget.status != before.status
        {
            invalidate_rule_source(&tx, id)?;
        }
    }
    tx.commit().map_err(err)?;
    Ok(widget)
}

pub fn invalidate_rule_source(db: &Connection, widget_id: &str) -> Result<()> {
    let overflow: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM widget_state_rules WHERE widget_id=?1 AND last_match IS NOT NULL AND revision=9223372036854775807)",
        [widget_id], |row| row.get(0),
    ).map_err(err)?;
    if overflow {
        return Err("대사 수정 횟수가 한도를 넘었어요.".into());
    }
    // Rule revisions also identify the source lifecycle; repeated inactive observations are inert.
    db.execute(
        "UPDATE widget_state_rules SET revision=revision+1,last_match=NULL WHERE widget_id=?1 AND last_match IS NOT NULL",
        [widget_id],
    ).map_err(err)?;
    db.execute(
        "DELETE FROM widget_state_pending WHERE widget_id=?1",
        [widget_id],
    )
    .map_err(err)?;
    Ok(())
}

pub fn replace(
    db: &Connection,
    id: &str,
    expected_revision: i64,
    definition: Definition,
) -> Result<GeneratedWidget> {
    validate_definition(&definition)?;
    change(db, id, expected_revision, |widget| {
        if widget.definition != definition {
            widget.previous_definition =
                Some(std::mem::replace(&mut widget.definition, definition));
        }
        widget.status = "draft".into();
        widget.error = None;
        Ok(())
    })
}

/// Swaps the current definition with the one kept before the latest fix, so it can be undone again.
pub fn restore_previous(
    db: &Connection,
    id: &str,
    expected_revision: i64,
) -> Result<GeneratedWidget> {
    change(db, id, expected_revision, |widget| {
        let previous = widget
            .previous_definition
            .take()
            .ok_or("되돌릴 이전 모습이 없어요.")?;
        validate_definition(&previous)?;
        widget.previous_definition = Some(std::mem::replace(&mut widget.definition, previous));
        widget.status = "draft".into();
        widget.error = None;
        Ok(())
    })
}

pub fn save_state(
    db: &Connection,
    id: &str,
    expected_revision: i64,
    state: Value,
) -> Result<GeneratedWidget> {
    validate_state(&state)?;
    change(db, id, expected_revision, |widget| {
        if widget.status == "error" {
            return Err("오류가 난 위젯의 결과는 저장하지 않았어요.".into());
        }
        widget.state = state;
        Ok(())
    })
}

pub fn retire(db: &Connection, id: &str, expected_revision: i64) -> Result<GeneratedWidget> {
    change(db, id, expected_revision, |widget| {
        widget.installed = false;
        Ok(())
    })
}

pub fn mark_ready(db: &Connection, id: &str, expected_revision: i64) -> Result<GeneratedWidget> {
    change(db, id, expected_revision, |widget| {
        widget.status = "ready".into();
        widget.error = None;
        Ok(())
    })
}

pub fn mark_error(
    db: &Connection,
    id: &str,
    expected_revision: i64,
    error: &str,
) -> Result<GeneratedWidget> {
    if error.trim().is_empty() || error.chars().count() > 500 {
        return Err("위젯 오류 설명의 크기를 확인해 주세요.".into());
    }
    change(db, id, expected_revision, |widget| {
        widget.status = "error".into();
        widget.error = Some(error.to_owned());
        Ok(())
    })
}

fn valid_field(field: &str) -> bool {
    !field.is_empty()
        && field.len() <= 128
        && field.split('.').count() <= 8
        && field.split('.').all(|part| {
            !part.is_empty()
                && safe_key(part)
                && part.chars().all(|character| {
                    character.is_ascii_alphanumeric() || matches!(character, '_' | '-')
                })
        })
}

fn validate_rule(widget_id: &str, rule: &StateRule) -> Result<()> {
    valid_id(&rule.id)?;
    valid_id(&rule.widget_id)?;
    if rule.widget_id != widget_id
        || rule.character_id.is_empty()
        || rule.character_id.chars().count() > 128
        || !valid_field(&rule.field)
        || !matches!(
            rule.operator.as_str(),
            "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "contains"
        )
        || rule.text.trim().is_empty()
        || rule.text.chars().count() > 500
        || !(0..=86_400_000).contains(&rule.cooldown_ms)
        || rule
            .expression
            .as_ref()
            .is_some_and(|value| !crate::domain::EXPRESSIONS.contains(&value.as_str()))
        || serde_json::to_vec(&rule.value).map_err(err)?.len() > 4096
    {
        return Err("상태 대사의 대상·조건·본문·대기 시간을 확인해 주세요.".into());
    }
    if matches!(rule.operator.as_str(), "gt" | "gte" | "lt" | "lte") && !rule.value.is_number() {
        return Err("크기 비교 조건에는 숫자를 넣어 주세요.".into());
    }
    if let Some(MotionOverride::Clip {
        clip_id,
        interval_ms,
        ..
    }) = &rule.motion
    {
        if clip_id.trim().is_empty() || clip_id.chars().count() > 64 || *interval_ms > 60_000 {
            return Err("대사 모션의 이름과 반복 간격을 확인해 주세요.".into());
        }
    }
    validate_json(&rule.value, 0, &mut 0)
}

pub fn list_rules(db: &Connection, widget_id: &str) -> Result<Vec<StateRule>> {
    valid_id(widget_id)?;
    let mut statement = db
        .prepare("SELECT definition FROM widget_state_rules WHERE widget_id=?1 ORDER BY rowid")
        .map_err(err)?;
    let rows = statement
        .query_map([widget_id], |row| row.get::<_, String>(0))
        .map_err(err)?;
    rows.map(|row| serde_json::from_str(&row.map_err(err)?).map_err(err))
        .collect()
}

fn validate_rule_state(db: &Connection, widget_id: &str, state: &Value) -> Result<()> {
    let generated: bool = db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM generated_widgets WHERE id=?1)",
            [widget_id],
            |row| row.get(0),
        )
        .map_err(err)?;
    if generated {
        return validate_state(state);
    }
    // Official widgets own their data limits; rule evaluation reads only its selected field.
    if !state.is_object() {
        return Err("위젯 상태에서 대사 조건을 읽을 수 없어요.".into());
    }
    Ok(())
}

#[cfg(test)]
pub fn save_rules(
    db: &Connection,
    widget_id: &str,
    rules: Vec<StateRule>,
    current_state: &Value,
) -> Result<Vec<StateRule>> {
    save_rules_expected(db, widget_id, rules, current_state, None)
}

pub(crate) fn rule_baseline(db: &Connection, widget_id: &str) -> Result<String> {
    valid_id(widget_id)?;
    db.query_row(
        "SELECT revision FROM widget_rule_definitions WHERE widget_id=?1",
        [widget_id],
        |row| row.get::<_, i64>(0),
    )
    .optional()
    .map_err(err)
    .map(|revision| revision.unwrap_or(0).to_string())
}

pub(crate) fn save_rules_expected(
    db: &Connection,
    widget_id: &str,
    rules: Vec<StateRule>,
    current_state: &Value,
    expected_baseline: Option<&str>,
) -> Result<Vec<StateRule>> {
    valid_id(widget_id)?;
    if rules.len() > MAX_RULES {
        return Err("위젯 하나에는 상태 대사를 64개까지 저장할 수 있어요.".into());
    }
    let mut ids = HashSet::new();
    for rule in &rules {
        validate_rule(widget_id, rule)?;
        if !ids.insert(rule.id.as_str()) {
            return Err("같은 상태 대사가 두 번 포함됐어요.".into());
        }
    }
    if !rules.is_empty() {
        validate_rule_state(db, widget_id, current_state)?;
    }
    let tx = db.unchecked_transaction().map_err(err)?;
    let baseline = rule_baseline(&tx, widget_id)?;
    if expected_baseline.is_some_and(|expected| expected != baseline) {
        return Err(
            "다른 창에서 조건을 변경했어요. 초안은 남아 있어요. 최신 내용을 확인해 주세요.".into(),
        );
    }
    let revision = baseline
        .parse::<i64>()
        .map_err(err)?
        .checked_add(1)
        .ok_or("조건 수정 횟수가 한도를 넘었어요.")?;
    let old = list_rules(&tx, widget_id)?;
    for rule in &rules {
        let previous: Option<(String, i64)> = tx
            .query_row(
                "SELECT widget_id,revision FROM widget_state_rules WHERE id=?1",
                [&rule.id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(err)?;
        if previous
            .as_ref()
            .is_some_and(|(owner, _)| owner != widget_id)
        {
            return Err("다른 위젯에 저장된 대사 식별자는 사용할 수 없어요.".into());
        }
        let revision = previous.map_or(Ok(1), |(_, revision)| {
            revision
                .checked_add(1)
                .ok_or("대사 수정 횟수가 한도를 넘었어요.")
        })?;
        tx.execute(
            "INSERT INTO widget_state_rules(id,widget_id,definition,revision,last_match,last_triggered_at) VALUES(?1,?2,?3,?4,?5,NULL) ON CONFLICT(id) DO UPDATE SET definition=excluded.definition,revision=excluded.revision,last_match=excluded.last_match",
            params![rule.id,widget_id,serde_json::to_string(rule).map_err(err)?,revision,matches_rule(rule,current_state)],
        ).map_err(err)?;
    }
    for rule in old {
        if !ids.contains(rule.id.as_str()) {
            tx.execute("DELETE FROM widget_state_rules WHERE id=?1", [rule.id])
                .map_err(err)?;
        }
    }
    tx.execute(
        "DELETE FROM widget_state_pending WHERE widget_id=?1",
        [widget_id],
    )
    .map_err(err)?;
    tx.execute(
        "INSERT INTO widget_rule_definitions(widget_id,revision) VALUES(?1,?2) ON CONFLICT(widget_id) DO UPDATE SET revision=excluded.revision",
        params![widget_id, revision],
    ).map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(rules)
}

fn field_value<'a>(state: &'a Value, field: &str) -> Option<&'a Value> {
    if !valid_field(field) {
        return None;
    }
    field
        .split('.')
        .try_fold(state, |value, segment| match value {
            Value::Object(fields) => fields.get(segment),
            Value::Array(items) => segment
                .parse::<usize>()
                .ok()
                .and_then(|index| items.get(index)),
            _ => None,
        })
}

fn matches_rule(rule: &StateRule, state: &Value) -> bool {
    if !rule.enabled {
        return false;
    }
    let Some(value) = field_value(state, &rule.field) else {
        return false;
    };
    match rule.operator.as_str() {
        "eq" => value == &rule.value,
        "ne" => value != &rule.value,
        "contains" => match value {
            Value::String(text) => rule.value.as_str().is_some_and(|part| text.contains(part)),
            Value::Array(items) => items.contains(&rule.value),
            _ => false,
        },
        operator => value
            .as_f64()
            .zip(rule.value.as_f64())
            .is_some_and(|(left, right)| match operator {
                "gt" => left > right,
                "gte" => left >= right,
                "lt" => left < right,
                "lte" => left <= right,
                _ => false,
            }),
    }
}

fn generated_target_active(db: &Connection, widget_id: &str, revision: i64) -> Result<bool> {
    let target: Option<(i64, bool, String)> = db
        .query_row(
            "SELECT revision,installed,status FROM generated_widgets WHERE id=?1",
            [widget_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(err)?;
    Ok(target.is_none_or(|(current, installed, status)| {
        current == revision && installed && status == "ready"
    }))
}

pub fn evaluate_rules(
    db: &Connection,
    widget_id: &str,
    state: &Value,
    revision: i64,
    now_ms: i64,
) -> Result<()> {
    valid_id(widget_id)?;
    let tx = db.unchecked_transaction().map_err(err)?;
    let rules = list_rules(&tx, widget_id)?;
    if rules.is_empty() {
        return tx.commit().map_err(err);
    }
    validate_rule_state(&tx, widget_id, state)?;
    if now_ms < 0 || revision < 0 {
        return Err("위젯 상태의 시각 또는 버전이 올바르지 않아요.".into());
    }
    if !generated_target_active(&tx, widget_id, revision)? {
        invalidate_rule_source(&tx, widget_id)?;
        return tx.commit().map_err(err);
    }
    for rule in rules {
        let (rule_revision, previous, last): (i64, Option<bool>, Option<i64>) = tx
            .query_row(
                "SELECT revision,last_match,last_triggered_at FROM widget_state_rules WHERE id=?1",
                [&rule.id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .map_err(err)?;
        let matched = matches_rule(&rule, state);
        let next_revision = if !matched && previous == Some(true) {
            rule_revision
                .checked_add(1)
                .ok_or("대사 수정 횟수가 한도를 넘었어요.")?
        } else {
            rule_revision
        };
        let trigger = matched
            && previous == Some(false)
            && last.is_none_or(|last| {
                now_ms >= last && now_ms.saturating_sub(last) >= rule.cooldown_ms
            });
        tx.execute(
            "UPDATE widget_state_rules SET last_match=?1,revision=?2 WHERE id=?3",
            params![matched, next_revision, rule.id],
        )
        .map_err(err)?;
        if !matched {
            tx.execute(
                "DELETE FROM widget_state_pending WHERE rule_id=?1",
                [&rule.id],
            )
            .map_err(err)?;
        }
        if !trigger {
            continue;
        }
        let pending = PendingReaction {
            id: uuid::Uuid::new_v4().to_string(),
            rule_id: rule.id.clone(),
            rule_revision,
            widget_id: widget_id.into(),
            revision,
            character_id: rule.character_id,
            text: rule.text,
            expression: rule.expression,
            motion: rule.motion,
            created_at: now_ms,
            expires_at: now_ms.saturating_add(REACTION_LIFETIME_MS),
        };
        tx.execute(
            "INSERT INTO widget_state_pending(id,rule_id,widget_id,expires_at,data) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(rule_id) DO UPDATE SET id=excluded.id,widget_id=excluded.widget_id,expires_at=excluded.expires_at,data=excluded.data",
            params![pending.id,pending.rule_id,pending.widget_id,pending.expires_at,serde_json::to_string(&pending).map_err(err)?],
        ).map_err(err)?;
        tx.execute(
            "UPDATE widget_state_rules SET last_triggered_at=?1 WHERE id=?2",
            params![now_ms, rule.id],
        )
        .map_err(err)?;
    }
    tx.execute("DELETE FROM widget_state_pending WHERE expires_at<=?1 OR rowid NOT IN (SELECT rowid FROM widget_state_pending ORDER BY rowid DESC LIMIT 128)", [now_ms]).map_err(err)?;
    tx.commit().map_err(err)
}

pub fn take_pending(db: &Connection, now_ms: i64) -> Result<Option<PendingReaction>> {
    let tx = db.unchecked_transaction().map_err(err)?;
    tx.execute(
        "DELETE FROM widget_state_pending WHERE expires_at<=?1",
        [now_ms],
    )
    .map_err(err)?;
    let text: Option<String> = tx
        .query_row(
            "SELECT data FROM widget_state_pending ORDER BY rowid LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(err)?;
    let pending = text
        .map(|text| serde_json::from_str::<PendingReaction>(&text).map_err(err))
        .transpose()?;
    if let Some(pending) = &pending {
        tx.execute(
            "DELETE FROM widget_state_pending WHERE id=?1",
            [&pending.id],
        )
        .map_err(err)?;
    }
    tx.commit().map_err(err)?;
    Ok(pending)
}

pub fn discard_pending(db: &Connection) -> Result<()> {
    db.execute("DELETE FROM widget_state_pending", [])
        .map_err(err)?;
    Ok(())
}

pub fn reaction_current(
    db: &Connection,
    pending: &PendingReaction,
    state: &Value,
    revision: i64,
    now_ms: i64,
) -> Result<bool> {
    if revision < pending.revision
        || now_ms < pending.created_at
        || now_ms >= pending.expires_at
        || !generated_target_active(db, &pending.widget_id, revision)?
    {
        return Ok(false);
    }
    let row: Option<(String, i64)> = db
        .query_row(
            "SELECT definition,revision FROM widget_state_rules WHERE id=?1 AND widget_id=?2",
            params![pending.rule_id, pending.widget_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(err)?;
    let Some((text, rule_revision)) = row else {
        return Ok(false);
    };
    if rule_revision != pending.rule_revision {
        return Ok(false);
    }
    validate_rule_state(db, &pending.widget_id, state)?;
    let rule: StateRule = serde_json::from_str(&text).map_err(err)?;
    Ok(rule.character_id == pending.character_id && matches_rule(&rule, state))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database() -> Connection {
        let db = Connection::open_in_memory().unwrap();
        initialize(&db).unwrap();
        db
    }

    #[test]
    fn disabled_generated_widget_migrates_reaction_preference_once() {
        let db = database();
        db.execute(
            "INSERT INTO generated_widgets(id,definition,state,revision,enabled,installed,status,error) VALUES('legacy','{}','{}',0,0,1,'ready',NULL)",
            [],
        )
        .unwrap();
        initialize(&db).unwrap();
        assert!(!super::super::storage::reaction_enabled(&db, "legacy").unwrap());
        let enabled: i64 = db.query_row(
            "SELECT enabled FROM generated_widgets WHERE id='legacy'", [], |row| row.get(0),
        ).unwrap();
        assert_eq!(enabled, 1);
        db.execute("DELETE FROM widget_preferences WHERE key='reaction:legacy'", []).unwrap();
        initialize(&db).unwrap();
        assert!(super::super::storage::reaction_enabled(&db, "legacy").unwrap());
    }

    #[test]
    fn rule_definition_baseline_is_atomic_and_independent_of_state() {
        let db = database();
        let id = uuid::Uuid::new_v4().to_string();
        let original = rule(&id);
        let initial = rule_baseline(&db, &id).unwrap();
        save_rules_expected(
            &db,
            &id,
            vec![original.clone()],
            &json!({"count":0}),
            Some(&initial),
        )
        .unwrap();
        let baseline = rule_baseline(&db, &id).unwrap();
        evaluate_rules(&db, &id, &json!({"count":5}), 1, 1000).unwrap();
        assert_eq!(rule_baseline(&db, &id).unwrap(), baseline);
        let before = db.total_changes();
        assert!(
            save_rules_expected(&db, &id, vec![], &json!({"count":0}), Some(&initial))
                .unwrap_err()
                .contains("다른 창")
        );
        assert_eq!(db.total_changes(), before);
        assert_eq!(list_rules(&db, &id).unwrap(), vec![original]);
        save_rules_expected(&db, &id, vec![], &json!({}), Some(&baseline)).unwrap();
        let empty = rule_baseline(&db, &id).unwrap();
        save_rules_expected(&db, &id, vec![], &json!({}), Some(&empty)).unwrap();
        assert_ne!(rule_baseline(&db, &id).unwrap(), empty);
        assert!(save_rules_expected(&db, &id, vec![rule(&id)], &json!({}), Some(&empty)).is_err());
    }

    #[test]
    fn raw_rule_trial_uses_runtime_predicate_without_writes() {
        use rule_editor::{trial, Draft};
        let db = database();
        let id = uuid::Uuid::new_v4().to_string();
        let original = rule(&id);
        save_rules(&db, &id, vec![original.clone()], &json!({"count":0})).unwrap();
        evaluate_rules(&db, &id, &json!({"count":5}), 1, 1000).unwrap();
        let before = db.total_changes();
        let pending = db
            .query_row("SELECT count(*) FROM widget_state_pending", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap();
        for (field, operator, value, state, present, matched) in [
            ("count", "eq", "1", r#"{"count":1.0}"#, true, false),
            ("count", "eq", "1.0", r#"{"count":1.0}"#, true, true),
            ("count", "ne", "null", "{}", false, false),
            ("count", "eq", "null", r#"{"count":null}"#, true, true),
            (
                "items.0.count",
                "gte",
                "3",
                r#"{"items":[{"count":3}]}"#,
                true,
                true,
            ),
            ("count", "gt", "3", r#"{"count":3}"#, true, false),
            ("count", "lte", "3", r#"{"count":3}"#, true, true),
            ("count", "lt", "3", r#"{"count":2}"#, true, true),
            (
                "count",
                "contains",
                r#"{"a":1}"#,
                r#"{"count":[{"a":1}]}"#,
                true,
                true,
            ),
            (
                "count",
                "contains",
                r#""a""#,
                r#"{"count":{"a":1}}"#,
                true,
                false,
            ),
            (
                "count",
                "contains",
                r#""별""#,
                r#"{"count":"별꼬리"}"#,
                true,
                true,
            ),
        ] {
            let mut draft = Draft::from_rule(original.clone()).unwrap();
            draft.field = field.into();
            draft.operator = operator.into();
            draft.value_json = value.into();
            let condition = draft.parse().unwrap();
            let result = trial(&db, &id, &condition, state);
            assert!(result.valid, "{:?}", result.error);
            assert_eq!(result.field_present, Some(present));
            assert_eq!(result.matched, Some(matched));
            assert_eq!(
                result.matched,
                Some(matches_rule(
                    &condition,
                    &serde_json::from_str(state).unwrap()
                ))
            );
        }
        let mut draft = Draft::from_rule(original).unwrap();
        draft.value_json = "9007199254740993".into();
        let condition = draft.parse().unwrap();
        assert_eq!(condition.value.as_u64(), Some(9_007_199_254_740_993));
        assert_eq!(
            Draft::from_rule(condition.clone()).unwrap().value_json,
            "9007199254740993"
        );
        assert!(!trial(&db, &id, &condition, r#"{"count":9007199254740993}"#).valid);
        assert_eq!(db.total_changes(), before);
        assert_eq!(
            db.query_row("SELECT count(*) FROM widget_state_pending", [], |row| row
                .get::<_, i64>(
                0
            ))
            .unwrap(),
            pending
        );
    }

    #[test]
    fn trial_validates_the_same_field_body_value_and_json_limits_as_save() {
        let db = database();
        let id = uuid::Uuid::new_v4().to_string();
        for changes in ["field", "text", "number", "value-size"] {
            let mut draft = rule_editor::Draft::from_rule(rule(&id)).unwrap();
            match changes {
                "field" => draft.field = "count..invalid".into(),
                "text" => draft.text = "줄".repeat(501),
                "number" => draft.value_json = r#""3""#.into(),
                _ => draft.value_json = format!("\"{}\"", "x".repeat(4096)),
            }
            match draft.parse() {
                Ok(condition) => {
                    assert!(!rule_editor::trial(&db, &id, &condition, r#"{"count":3}"#).valid);
                    assert!(save_rules(&db, &id, vec![condition], &json!({"count":3})).is_err());
                }
                Err(_) => assert_eq!(changes, "value-size"),
            }
        }
        let condition = rule(&id);
        assert!(!rule_editor::trial(&db, &id, &condition, "{").valid);
        assert!(!rule_editor::trial(&db, &id, &condition, "[]").valid);
    }

    fn definition() -> Definition {
        Definition {
            name: "물 마시기".into(),
            description: "오늘 마신 물을 셉니다.".into(),
            source: "({ render: state => ({ text: String(state.count) }) })".into(),
            initial_state: json!({"count":0,"note":"처음"}),
            actions: vec![],
        }
    }

    fn ready(db: &Connection) -> GeneratedWidget {
        let widget = create(db, definition(), InstallationOrigin::Import, None).unwrap();
        mark_ready(db, &widget.id, widget.revision).unwrap()
    }

    fn rule(widget_id: &str) -> StateRule {
        StateRule {
            id: uuid::Uuid::new_v4().to_string(),
            widget_id: widget_id.into(),
            character_id: "character-a".into(),
            field: "count".into(),
            operator: "gte".into(),
            value: json!(1),
            text: "  한 잔 마셨네!\n잘했어.  ".into(),
            expression: Some("기쁨".into()),
            motion: Some(MotionOverride::Static),
            cooldown_ms: 0,
            enabled: true,
        }
    }

    #[test]
    fn installation_records_keep_the_original_source_and_model_through_edits_and_removal() {
        let db = database();
        for (origin, model) in [
            (InstallationOrigin::Manual, Some("local-model-12b.gguf")),
            (InstallationOrigin::Automatic, Some("api-model")),
            (InstallationOrigin::Import, None),
        ] {
            let widget =
                create(&db, definition(), origin.clone(), model.map(str::to_owned)).unwrap();
            let installation = widget.installation.clone().unwrap();
            assert_eq!(installation.origin, origin);
            assert_eq!(installation.model.as_deref(), model);
            assert!(installation.installed_at > 0);
            assert_eq!(widget.updated_at, Some(installation.installed_at));
            assert_eq!(get(&db, &widget.id).unwrap(), widget);

            let saved = save_state(&db, &widget.id, widget.revision, json!({"count":4})).unwrap();
            assert_eq!(saved.installation, widget.installation);
            assert_eq!(saved.updated_at, widget.updated_at);
            db.execute(
                "UPDATE generated_widgets SET updated_at=1 WHERE id=?1",
                [&widget.id],
            )
            .unwrap();
            let replaced = replace(
                &db,
                &saved.id,
                saved.revision,
                Definition {
                    name: "고친 이름".into(),
                    ..definition()
                },
            )
            .unwrap();
            assert_eq!(replaced.installation, widget.installation);
            assert_eq!(replaced.state, saved.state);
            assert!(replaced.updated_at.unwrap() > 1);
            let ready = mark_ready(&db, &replaced.id, replaced.revision).unwrap();
            assert_eq!(ready.updated_at, replaced.updated_at);
            let retired = retire(&db, &ready.id, ready.revision).unwrap();
            assert_eq!(retired.installation, widget.installation);
            assert_eq!(retired.updated_at, replaced.updated_at);
            assert_eq!(get(&db, &retired.id).unwrap(), retired);
        }
    }

    #[test]
    fn legacy_rows_and_payloads_leave_unknown_installation_information_empty() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(
            "CREATE TABLE generated_widgets(id TEXT PRIMARY KEY,definition TEXT NOT NULL,state TEXT NOT NULL,revision INTEGER NOT NULL,enabled INTEGER NOT NULL,installed INTEGER NOT NULL,status TEXT NOT NULL,error TEXT);",
        )
        .unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        db.execute(
            "INSERT INTO generated_widgets VALUES(?1,?2,?3,1,1,1,'ready',NULL)",
            params![
                id,
                serde_json::to_string(&definition()).unwrap(),
                "{\"count\":7}"
            ],
        )
        .unwrap();
        initialize(&db).unwrap();
        initialize(&db).unwrap();
        let widget = get(&db, &id).unwrap();
        assert_eq!(widget.installation, None);
        assert_eq!(widget.updated_at, None);
        assert_eq!(widget.state, json!({"count":7}));
        let mut legacy_payload = serde_json::to_value(&widget).unwrap();
        legacy_payload
            .as_object_mut()
            .unwrap()
            .remove("installation");
        legacy_payload.as_object_mut().unwrap().remove("updatedAt");
        assert_eq!(
            serde_json::from_value::<GeneratedWidget>(legacy_payload).unwrap(),
            widget
        );

        let saved = save_state(&db, &id, widget.revision, json!({"count":8})).unwrap();
        assert_eq!(saved.installation, None);
        assert_eq!(saved.updated_at, None);
        let edited = replace(
            &db,
            &id,
            saved.revision,
            Definition {
                name: "새 이름".into(),
                ..definition()
            },
        )
        .unwrap();
        assert_eq!(edited.installation, None);
        assert!(edited.updated_at.unwrap() > 0);
        assert_eq!(list(&db).unwrap(), vec![edited]);
    }

    #[test]
    fn definition_replacement_preserves_state_and_rejects_stale_writes() {
        let db = database();
        let widget = ready(&db);
        let saved = save_state(
            &db,
            &widget.id,
            widget.revision,
            json!({"count":4,"note":"내 기록"}),
        )
        .unwrap();
        assert!(save_state(&db, &widget.id, widget.revision, json!({"count":99})).is_err());
        let mut replacement = definition();
        replacement.name = "새 이름".into();
        replacement.initial_state = json!({"count":0,"newField":true});
        let replaced = replace(&db, &widget.id, saved.revision, replacement).unwrap();
        assert_eq!(replaced.state, saved.state);
        assert_eq!(replaced.status, "draft");
        assert_eq!(replaced.definition.name, "새 이름");
        assert_eq!(replaced.revision, saved.revision + 1);
        assert!(mark_error(&db, &widget.id, saved.revision, "이전 실행 결과").is_err());
        assert_eq!(list(&db).unwrap(), vec![replaced]);
    }

    #[test]
    fn disabling_and_retiring_preserve_records_and_block_running_results() {
        let db = database();
        let widget = ready(&db);
        let saved = save_state(&db, &widget.id, widget.revision, json!({"count":2})).unwrap();
        let disabled = set_enabled(&db, &widget.id, saved.revision, false).unwrap();
        assert!(!disabled.enabled);
        assert_eq!(disabled.state, saved.state);
        assert!(save_state(&db, &widget.id, disabled.revision, json!({"count":3})).is_err());
        assert!(mark_ready(&db, &widget.id, disabled.revision).is_err());
        let enabled = set_enabled(&db, &widget.id, disabled.revision, true).unwrap();
        let retired = retire(&db, &widget.id, enabled.revision).unwrap();
        assert!(!retired.installed);
        assert_eq!(retired.state, saved.state);
        assert!(set_enabled(&db, &widget.id, retired.revision, true).is_err());
        assert!(replace(&db, &widget.id, retired.revision, definition()).is_err());
    }

    #[test]
    fn runtime_error_is_preserved_until_an_explicit_repair() {
        let db = database();
        let widget = ready(&db);
        let broken =
            mark_error(&db, &widget.id, widget.revision, "실행 시간이 초과됐어요.").unwrap();
        assert_eq!(broken.status, "error");
        assert!(save_state(&db, &widget.id, broken.revision, json!({"count":3})).is_err());
        let repaired = replace(&db, &widget.id, broken.revision, definition()).unwrap();
        assert_eq!(repaired.error, None);
        assert_eq!(repaired.state, widget.state);
        assert_eq!(repaired.status, "draft");
    }

    #[test]
    fn file_references_are_not_widget_code_but_filenames_inside_code_are_allowed() {
        for source in [
            "source.js",
            "./widget.mjs",
            "'source.js'",
            "https://example.test/source.js?x=1",
            "내 위젯.ts",
        ] {
            let candidate = Definition {
                source: source.into(),
                ..definition()
            };
            assert!(
                validate_definition(&candidate)
                    .unwrap_err()
                    .contains("complete JavaScript"),
                "{source}"
            );
        }
        let candidate = Definition {
            source: "function render(s){return [{type:'text',value:'source.js'}]} function reduce(s){return s}".into(),
            ..definition()
        };
        assert!(validate_definition(&candidate).is_ok());
        assert!(definition_schema()["properties"]["source"]["description"]
            .as_str()
            .unwrap()
            .contains("Complete inline JavaScript"));
    }

    fn generated_wire_value() -> Value {
        json!({
            "name":"독서 기록","description":"읽은 책을 기록해요",
            "source":"function render(s){return []} function reduce(s){return s}",
            "initialStateJson":json!({"books":[],"note":"  원문\n그대로  "}).to_string(),
            "actions":[{"id":"read","description":"기록 조회","operation":"read",
                "inputSchemaJson":json!({"type":"object","properties":{},"required":[],"additionalProperties":false}).to_string()}]
        })
    }

    #[test]
    fn model_json_strings_preserve_shared_definition_objects_and_user_text() {
        let parsed = parse_generated_definition(generated_wire_value()).unwrap();
        assert_eq!(
            parsed.initial_state,
            json!({"books":[],"note":"  원문\n그대로  "})
        );
        assert_eq!(
            parsed.actions[0].input_schema,
            json!({"type":"object","properties":{},"required":[],"additionalProperties":false})
        );
        let shared = serde_json::to_value(&parsed).unwrap();
        assert!(shared["initialState"].is_object());
        assert!(shared["actions"][0]["inputSchema"].is_object());
        assert!(shared.get("initialStateJson").is_none());
        assert!(shared["actions"][0].get("inputSchemaJson").is_none());
        let imported: Definition = serde_json::from_value(shared).unwrap();
        validate_definition(&imported).unwrap();
        assert_eq!(imported, parsed);
    }

    #[test]
    fn model_wire_rejects_empty_null_and_invalid_dynamic_objects() {
        for state in [
            Value::Null,
            json!({}),
            json!(""),
            json!("null"),
            json!("[]"),
            json!("{bad}"),
            json!("{\"constructor\":0}"),
        ] {
            let mut value = generated_wire_value();
            value["initialStateJson"] = state;
            assert!(parse_generated_definition(value).is_err());
        }
        for actions in [Value::Null, json!([]), json!({})] {
            let mut value = generated_wire_value();
            value["actions"] = actions;
            assert!(parse_generated_definition(value).is_err());
        }
        for schema in [Value::Null, json!({}), json!(""), json!("null"), json!("[]"), json!("{}"), json!("{bad}"), json!("{\"type\":\"object\",\"properties\":{},\"required\":[],\"additionalProperties\":true}")] {
            let mut value = generated_wire_value();
            value["actions"][0]["inputSchemaJson"] = schema;
            assert!(parse_generated_definition(value).is_err());
        }
        let mut value = generated_wire_value();
        value["actions"][0]
            .as_object_mut()
            .unwrap()
            .remove("inputSchemaJson");
        assert!(parse_generated_definition(value).is_err());
        for schema in [
            json!({"type":"object","properties":{},"required":null,"additionalProperties":false}),
            json!({"type":"object","properties":null,"required":[],"additionalProperties":false}),
            json!({"type":"object","properties":{"choice":{"type":"string","enum":[]}},"required":[],"additionalProperties":false}),
            json!({"type":"object","properties":{"choice":{"type":"string","enum":null}},"required":[],"additionalProperties":false}),
        ] {
            let mut value = generated_wire_value();
            value["actions"][0]["inputSchemaJson"] = json!(schema.to_string());
            assert!(parse_generated_definition(value).is_err());
        }
    }

    #[test]
    fn model_output_schema_uses_only_closed_objects_with_all_properties_required() {
        fn check(schema: &Value) {
            if schema["type"] == "object" {
                assert_eq!(schema["additionalProperties"], false);
                let properties = schema["properties"].as_object().unwrap();
                let required = schema["required"].as_array().unwrap();
                assert_eq!(required.len(), properties.len());
                for (key, property) in properties {
                    assert!(required.contains(&json!(key)));
                    check(property);
                }
            } else if schema["type"] == "array" {
                check(&schema["items"]);
            }
        }
        let schema = definition_schema();
        check(&schema);
        assert_eq!(schema["properties"]["initialStateJson"]["type"], "string");
        assert_eq!(
            schema["properties"]["actions"]["items"]["properties"]["inputSchemaJson"]["type"],
            "string"
        );
    }

    #[test]
    fn input_bounds_reject_unsafe_data_without_truncating_user_text() {
        let mut candidate = definition();
        candidate.source = "x".repeat(MAX_SOURCE_BYTES + 1);
        assert!(validate_definition(&candidate).is_err());
        candidate = definition();
        candidate.name = " ".into();
        assert!(validate_definition(&candidate).is_err());
        for invalid in [
            json!([]),
            json!({"nested":{"__proto__":{"polluted":true}}}),
            json!({"constructor":0}),
            json!({"count":9_007_199_254_740_992_u64}),
            json!({"text":"가".repeat(MAX_STATE_BYTES)}),
        ] {
            assert!(validate_state(&invalid).is_err());
        }
        let mut deep = json!({});
        for _ in 0..18 {
            deep = json!({"a":deep});
        }
        assert!(validate_state(&deep).is_err());
        assert!(
            validate_state(&json!({"count":MAX_SAFE_NUMBER,"text":"  메모\n그대로  "})).is_ok()
        );
        assert!(serde_json::from_value::<Definition>(
            json!({"name":"x","description":"","source":"x","initialState":{},"runtime":"shell"})
        )
        .is_err());
    }

    #[test]
    fn saved_rules_baseline_state_and_emit_only_false_to_true() {
        let db = database();
        let id = uuid::Uuid::new_v4().to_string();
        let rule = rule(&id);
        save_rules(&db, &id, vec![rule.clone()], &json!({"count":2})).unwrap();
        evaluate_rules(&db, &id, &json!({"count":2}), 1, 100).unwrap();
        assert!(take_pending(&db, 100).unwrap().is_none());
        evaluate_rules(&db, &id, &json!({"count":0}), 2, 200).unwrap();
        evaluate_rules(&db, &id, &json!({"count":1}), 3, 300).unwrap();
        let pending = take_pending(&db, 300).unwrap().unwrap();
        assert_eq!(pending.text, rule.text);
        assert_eq!(pending.motion, rule.motion);
        assert!(reaction_current(&db, &pending, &json!({"count":1}), 3, 300).unwrap());
        evaluate_rules(&db, &id, &json!({"count":2}), 4, 400).unwrap();
        assert!(take_pending(&db, 400).unwrap().is_none());
    }

    #[test]
    fn cooldown_requires_a_new_crossing_after_the_wait() {
        let db = database();
        let id = uuid::Uuid::new_v4().to_string();
        let mut rule = rule(&id);
        rule.cooldown_ms = 1000;
        save_rules(&db, &id, vec![rule], &json!({"count":0})).unwrap();
        evaluate_rules(&db, &id, &json!({"count":1}), 1, 1000).unwrap();
        assert!(take_pending(&db, 1000).unwrap().is_some());
        evaluate_rules(&db, &id, &json!({"count":0}), 2, 1100).unwrap();
        evaluate_rules(&db, &id, &json!({"count":1}), 3, 1200).unwrap();
        assert!(take_pending(&db, 1200).unwrap().is_none());
        evaluate_rules(&db, &id, &json!({"count":1}), 3, 2100).unwrap();
        assert!(take_pending(&db, 2100).unwrap().is_none());
        evaluate_rules(&db, &id, &json!({"count":0}), 4, 2150).unwrap();
        evaluate_rules(&db, &id, &json!({"count":1}), 5, 2200).unwrap();
        assert!(take_pending(&db, 2200).unwrap().is_some());
    }

    #[test]
    fn queued_reactions_expire_and_revalidate_target_rule_and_condition() {
        let db = database();
        let widget = ready(&db);
        let mut rule = rule(&widget.id);
        save_rules(&db, &widget.id, vec![rule.clone()], &widget.state).unwrap();
        let saved = save_state(&db, &widget.id, widget.revision, json!({"count":1})).unwrap();
        evaluate_rules(&db, &widget.id, &saved.state, saved.revision, 1000).unwrap();
        let pending = take_pending(&db, 1000).unwrap().unwrap();
        assert!(reaction_current(&db, &pending, &saved.state, saved.revision, 1000).unwrap());
        assert!(!reaction_current(&db, &pending, &saved.state, saved.revision + 1, 1000).unwrap());
        assert!(
            !reaction_current(&db, &pending, &json!({"count":0}), saved.revision, 1000).unwrap()
        );
        assert!(!reaction_current(&db, &pending, &saved.state, saved.revision, 31_000).unwrap());
        rule.text = "수정한 대사".into();
        save_rules(&db, &widget.id, vec![rule], &saved.state).unwrap();
        assert!(!reaction_current(&db, &pending, &saved.state, saved.revision, 1000).unwrap());
    }

    #[test]
    fn code_and_lifecycle_changes_invalidate_reactions_even_when_the_condition_stays_true() {
        for mutation in ["definition", "disabled", "error", "rule", "retired"] {
            let db = database();
            let widget = ready(&db);
            let mut condition = rule(&widget.id);
            save_rules(&db, &widget.id, vec![condition.clone()], &widget.state).unwrap();
            let widget = save_state(&db, &widget.id, widget.revision, json!({"count":1})).unwrap();
            evaluate_rules(&db, &widget.id, &widget.state, widget.revision, 1000).unwrap();
            let pending = take_pending(&db, 1000).unwrap().unwrap();
            let changed = match mutation {
                "definition" => {
                    let updated = replace(
                        &db,
                        &widget.id,
                        widget.revision,
                        Definition {
                            name: "다른 코드".into(),
                            ..definition()
                        },
                    )
                    .unwrap();
                    mark_ready(&db, &updated.id, updated.revision).unwrap()
                }
                "disabled" => {
                    let updated = set_enabled(&db, &widget.id, widget.revision, false).unwrap();
                    set_enabled(&db, &updated.id, updated.revision, true).unwrap()
                }
                "error" => {
                    let updated = mark_error(&db, &widget.id, widget.revision, "failed").unwrap();
                    mark_ready(&db, &updated.id, updated.revision).unwrap()
                }
                "rule" => {
                    condition.text = "새 대사".into();
                    save_rules(&db, &widget.id, vec![condition], &widget.state).unwrap();
                    widget.clone()
                }
                "retired" => retire(&db, &widget.id, widget.revision).unwrap(),
                _ => unreachable!(),
            };
            assert!(
                !reaction_current(&db, &pending, &changed.state, changed.revision, 1100).unwrap(),
                "{mutation}"
            );
        }
    }

    #[test]
    fn disabled_and_restarted_widgets_do_not_replay_pending_speech() {
        let db = database();
        let widget = ready(&db);
        save_rules(&db, &widget.id, vec![rule(&widget.id)], &widget.state).unwrap();
        let saved = save_state(&db, &widget.id, widget.revision, json!({"count":1})).unwrap();
        evaluate_rules(&db, &widget.id, &saved.state, saved.revision, 1000).unwrap();
        let disabled = set_enabled(&db, &widget.id, saved.revision, false).unwrap();
        assert!(take_pending(&db, 1000).unwrap().is_none());
        evaluate_rules(&db, &widget.id, &saved.state, saved.revision, 1000).unwrap();
        assert!(take_pending(&db, 1000).unwrap().is_none());
        let enabled = set_enabled(&db, &widget.id, disabled.revision, true).unwrap();
        evaluate_rules(&db, &widget.id, &enabled.state, enabled.revision, 1000).unwrap();
        assert!(take_pending(&db, 1000).unwrap().is_none());
        let zero = save_state(&db, &widget.id, enabled.revision, json!({"count":0})).unwrap();
        evaluate_rules(&db, &widget.id, &zero.state, zero.revision, 1100).unwrap();
        let one = save_state(&db, &widget.id, zero.revision, json!({"count":1})).unwrap();
        evaluate_rules(&db, &widget.id, &one.state, one.revision, 1200).unwrap();
        initialize(&db).unwrap();
        assert!(take_pending(&db, 1200).unwrap().is_none());
        evaluate_rules(&db, &widget.id, &one.state, one.revision, 1300).unwrap();
        assert!(take_pending(&db, 1300).unwrap().is_none());
    }

    #[test]
    fn rule_validation_and_ownership_fail_atomically() {
        let db = database();
        let first = uuid::Uuid::new_v4().to_string();
        let second = uuid::Uuid::new_v4().to_string();
        let original = rule(&first);
        save_rules(&db, &first, vec![original.clone()], &json!({"count":0})).unwrap();
        let mut stolen = original.clone();
        stolen.widget_id = second.clone();
        assert!(save_rules(&db, &second, vec![stolen], &json!({"count":0})).is_err());
        for path in ["", "a..b", "__proto__.a", "a.constructor", "a.prototype.b"] {
            let mut invalid = original.clone();
            invalid.field = path.into();
            assert!(save_rules(&db, &first, vec![invalid], &json!({"count":0})).is_err());
        }
        let mut invalid = original.clone();
        invalid.value = json!("one");
        assert!(save_rules(&db, &first, vec![invalid], &json!({"count":0})).is_err());
        assert_eq!(list_rules(&db, &first).unwrap(), vec![original]);
        assert!(list_rules(&db, &second).unwrap().is_empty());
    }

    #[test]
    fn dot_fields_comparisons_and_contains_preserve_type_boundaries() {
        let id = uuid::Uuid::new_v4().to_string();
        let mut rule = rule(&id);
        rule.field = "items.0.label".into();
        rule.operator = "contains".into();
        rule.value = json!("물");
        assert!(matches_rule(
            &rule,
            &json!({"items":[{"label":"물 마시기"}]})
        ));
        rule.field = "tags".into();
        assert!(matches_rule(&rule, &json!({"tags":["물","오늘"]})));
        rule.operator = "ne".into();
        assert!(!matches_rule(&rule, &json!({})));
        rule.operator = "lt".into();
        rule.value = json!(2);
        assert!(!matches_rule(&rule, &json!({"tags":"1"})));
        assert!(matches_rule(&rule, &json!({"tags":1})));
    }

    #[test]
    fn official_rules_only_read_the_selected_field_in_large_official_state() {
        let db = database();
        let id = uuid::Uuid::new_v4().to_string();
        let mut state = json!({
            "count": 0,
            "items": [{"memo": "할 일의 긴 메모".repeat(12_000)}],
            "unrelated": {"constructor": true, "large": 1e100}
        });
        assert!(validate_state(&state).is_err());
        save_rules(&db, &id, vec![rule(&id)], &state).unwrap();
        state["count"] = json!(1);
        evaluate_rules(&db, &id, &state, 1, 1000).unwrap();
        let pending = take_pending(&db, 1000).unwrap().unwrap();
        assert!(reaction_current(&db, &pending, &state, 1, 1000).unwrap());
        state["count"] = json!(0);
        assert!(!reaction_current(&db, &pending, &state, 1, 1000).unwrap());
    }

    #[test]
    fn generated_rule_states_still_enforce_limits_and_empty_rule_sets_do_not_read_state() {
        let db = database();
        let widget = ready(&db);
        let large = json!({"count":1,"memo":"x".repeat(MAX_STATE_BYTES)});
        assert!(save_rules(&db, &widget.id, vec![rule(&widget.id)], &large).is_err());
        save_rules(&db, &widget.id, vec![rule(&widget.id)], &widget.state).unwrap();
        assert!(evaluate_rules(&db, &widget.id, &large, widget.revision, 1000).is_err());
        let saved = save_state(&db, &widget.id, widget.revision, json!({"count":1})).unwrap();
        evaluate_rules(&db, &widget.id, &saved.state, saved.revision, 1000).unwrap();
        let pending = take_pending(&db, 1000).unwrap().unwrap();
        assert!(reaction_current(&db, &pending, &large, saved.revision, 1000).is_err());
        save_rules(&db, &widget.id, vec![], &large).unwrap();
        evaluate_rules(&db, &widget.id, &large, saved.revision, 1000).unwrap();
        assert!(!reaction_current(&db, &pending, &large, saved.revision, 1000).unwrap());
        assert!(take_pending(&db, 1000).unwrap().is_none());
    }

    #[test]
    fn ai_fixes_keep_the_previous_definition_and_restoring_swaps_back() {
        let db = database();
        let widget = create(&db, definition(), InstallationOrigin::Manual, None).unwrap();
        assert!(widget.previous_definition.is_none());
        let mut fixed = definition();
        fixed.description = "고친 설명".into();
        let replaced = replace(&db, &widget.id, widget.revision, fixed.clone()).unwrap();
        assert_eq!(
            replaced.previous_definition.as_ref(),
            Some(&widget.definition)
        );
        assert_eq!(
            get(&db, &widget.id).unwrap().previous_definition,
            Some(widget.definition.clone())
        );
        assert!(restore_previous(&db, &widget.id, widget.revision).is_err());
        let restored = restore_previous(&db, &widget.id, replaced.revision).unwrap();
        assert_eq!(restored.definition, widget.definition);
        assert_eq!(restored.previous_definition, Some(fixed));
        assert_eq!(restored.status, "draft");
    }
}
