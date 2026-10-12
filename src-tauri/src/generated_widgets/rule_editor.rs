use super::{err, field_value, matches_rule, validate_rule, validate_rule_state, StateRule};
use crate::character_reactions::MotionOverride;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Draft {
    pub id: String,
    pub widget_id: String,
    pub character_id: String,
    pub field: String,
    pub operator: String,
    pub value_json: String,
    pub text: String,
    pub expression: Option<String>,
    pub motion: Option<MotionOverride>,
    pub cooldown_ms: i64,
    pub enabled: bool,
}

impl Draft {
    pub(crate) fn from_rule(rule: StateRule) -> super::Result<Self> {
        Ok(Self {
            value_json: serde_json::to_string(&rule.value).map_err(err)?,
            id: rule.id,
            widget_id: rule.widget_id,
            character_id: rule.character_id,
            field: rule.field,
            operator: rule.operator,
            text: rule.text,
            expression: rule.expression,
            motion: rule.motion,
            cooldown_ms: rule.cooldown_ms,
            enabled: rule.enabled,
        })
    }

    pub(crate) fn parse(self) -> super::Result<StateRule> {
        if self.value_json.len() > 4096 {
            return Err("비교값 JSON은 4096바이트까지 입력할 수 있어요.".into());
        }
        let value = serde_json::from_str(&self.value_json)
            .map_err(|error| format!("비교값 JSON을 확인해 주세요: {error}"))?;
        Ok(StateRule {
            value,
            id: self.id,
            widget_id: self.widget_id,
            character_id: self.character_id,
            field: self.field,
            operator: self.operator,
            text: self.text,
            expression: self.expression,
            motion: self.motion,
            cooldown_ms: self.cooldown_ms,
            enabled: self.enabled,
        })
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Trial {
    pub valid: bool,
    pub field_present: Option<bool>,
    pub matched: Option<bool>,
    pub error: Option<String>,
}

impl Trial {
    pub(crate) fn invalid(error: String) -> Self {
        Self {
            valid: false,
            field_present: None,
            matched: None,
            error: Some(error),
        }
    }
}

pub(crate) fn trial(db: &Connection, widget_id: &str, rule: &StateRule, state_json: &str) -> Trial {
    let result = (|| {
        if state_json.len() > super::MAX_STATE_BYTES {
            return Err("시험할 상태는 64KiB 이하의 JSON 객체로 입력해 주세요.".into());
        }
        let state = serde_json::from_str(state_json)
            .map_err(|error| format!("상태 JSON을 확인해 주세요: {error}"))?;
        validate_rule(widget_id, rule)?;
        validate_rule_state(db, widget_id, &state)?;
        Ok(Trial {
            valid: true,
            field_present: Some(field_value(&state, &rule.field).is_some()),
            matched: Some(matches_rule(rule, &state)),
            error: None,
        })
    })();
    result.unwrap_or_else(Trial::invalid)
}
