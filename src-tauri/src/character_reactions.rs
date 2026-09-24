use crate::characters::CharacterDefinition;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

type Result<T> = std::result::Result<T, String>;

// These events are emitted by character gestures, widgets, device wake, and desktop toys.
pub const EVENTS: &[(&str, &str)] = &[
    ("click", "클릭"),
    ("grab-start", "잡기 시작"),
    ("release", "놓기"),
    ("todo-completed", "할 일 완료"),
    ("todo-undone", "할 일 완료 취소"),
    ("timer-finished", "타이머 종료"),
    ("calendar-reminder", "캘린더 알림"),
    ("planner-reminder", "일정 알림"),
    ("planner-mood", "일정 분위기 변화"),
    ("device-woke", "기기 잠자기 해제"),
    ("interaction.touch", "교감 위젯"),
    ("ball.stopped", "위젯 공 멈춤"),
    ("paper-plane.landed", "위젯 종이비행기 착지"),
    ("bubbles.streak", "비눗방울 연속 기록"),
    ("small-match.result", "작은 승부 결과"),
    ("guessing.attempt", "맞히기 결과"),
    ("fishing.bite", "낚시 입질"),
    ("fishing.missed", "낚시 놓침"),
    ("item-acquired", "아이템 획득"),
    ("fortune.draw", "운세 뽑기"),
    ("plant.growth", "화분 성장"),
    ("pet.arrived", "위젯 펫 도착"),
    ("desktop.ball.stopped", "바탕화면 공 멈춤"),
    ("desktop.paper-plane.landed", "바탕화면 종이비행기 착지"),
    ("desktop.bubbles.popped", "바탕화면 비눗방울 터짐"),
    ("desktop.pet.rested", "바탕화면 펫 휴식"),
];

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "mode",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields,
    from = "MotionWire"
)]
pub enum MotionOverride {
    #[default]
    Inherit,
    Static,
    Clip {
        clip_id: String,
        repeat: bool,
        interval_ms: u32,
    },
}

// Serde accepts extra fields on internally tagged unit variants. Empty struct variants
// keep the public enum ergonomic while making every wire variant equally strict.
#[derive(Deserialize)]
#[serde(
    tag = "mode",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum MotionWire {
    Inherit {},
    Static {},
    Clip {
        clip_id: String,
        repeat: bool,
        interval_ms: u32,
    },
}

impl From<MotionWire> for MotionOverride {
    fn from(value: MotionWire) -> Self {
        match value {
            MotionWire::Inherit {} => Self::Inherit,
            MotionWire::Static {} => Self::Static,
            MotionWire::Clip {
                clip_id,
                repeat,
                interval_ms,
            } => Self::Clip {
                clip_id,
                repeat,
                interval_ms,
            },
        }
    }
}

impl MotionOverride {
    pub fn is_inherit(&self) -> bool {
        matches!(self, Self::Inherit)
    }

    pub fn without_images(&self) -> Self {
        match self {
            Self::Clip { .. } => Self::Inherit,
            other => other.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReactionVariant {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expression: Option<String>,
    #[serde(default, skip_serializing_if = "MotionOverride::is_inherit")]
    pub motion: MotionOverride,
}

impl ReactionVariant {
    pub fn has_effect(&self) -> bool {
        self.text.is_some() || self.expression.is_some() || !self.motion.is_inherit()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReactionRule {
    pub id: String,
    pub event: String,
    pub variants: Vec<ReactionVariant>,
    pub cooldown_ms: u32,
}

#[derive(Debug, Clone, Default)]
pub struct ReactionHistory {
    // Only successful balloon display advances the speech cooldown.
    pub last_played_at: Option<i64>,
    pub variant_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReactionSelection {
    pub rule_id: String,
    pub variant: ReactionVariant,
    pub speech_allowed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReactionRun {
    pub id: String,
    pub event: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expression: Option<String>,
    pub motion: MotionOverride,
}

pub fn select(
    rules: &[ReactionRule],
    event: &str,
    now_ms: i64,
    previous: Option<&ReactionHistory>,
    entropy: u64,
) -> Option<ReactionSelection> {
    let rule = rules.iter().find(|rule| rule.event == event)?;
    let previous_id = previous.and_then(|history| history.variant_id.as_deref());
    let candidates: Vec<_> = rule
        .variants
        .iter()
        .filter(|variant| rule.variants.len() == 1 || Some(variant.id.as_str()) != previous_id)
        .collect();
    if candidates.is_empty() {
        return None;
    }
    let variant = candidates[(entropy % candidates.len() as u64) as usize];
    let speech_allowed = variant.text.is_some()
        && previous
            .and_then(|history| history.last_played_at)
            .is_none_or(|at| now_ms.saturating_sub(at) >= i64::from(rule.cooldown_ms));
    Some(ReactionSelection {
        rule_id: rule.id.clone(),
        variant: variant.clone(),
        speech_allowed,
    })
}

pub fn valid_event(event: &str) -> bool {
    EVENTS.iter().any(|(key, _)| *key == event)
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.trim() == value
        && value.chars().count() <= 64
        && !value.chars().any(char::is_control)
}

pub fn validate_motion(
    motion: &MotionOverride,
    definition: &CharacterDefinition,
    one_shot: bool,
) -> Result<()> {
    if let MotionOverride::Clip {
        clip_id,
        repeat,
        interval_ms,
    } = motion
    {
        if !definition
            .animation
            .as_ref()
            .is_some_and(|animation| animation.clips.iter().any(|clip| clip.id == *clip_id))
            || *interval_ms > 60_000
        {
            return Err("이 캐릭터의 모션과 반복 간격(0~60000ms)을 확인해 주세요.".into());
        }
        if one_shot && (*repeat || *interval_ms != 0) {
            return Err("잡기 시작 이외의 반응은 반복 간격 없이 한 번만 재생할 수 있어요.".into());
        }
    }
    Ok(())
}

pub fn validate(definition: &CharacterDefinition) -> Result<()> {
    if definition.reactions.len() > 32 {
        return Err("상황별 반응은 캐릭터마다 32개까지 등록할 수 있어요.".into());
    }
    let mut rule_ids = HashSet::new();
    let mut events = HashSet::new();
    for rule in &definition.reactions {
        if !valid_id(&rule.id)
            || !rule_ids.insert(&rule.id)
            || !valid_event(&rule.event)
            || !events.insert(&rule.event)
            || !(1..=16).contains(&rule.variants.len())
            || rule.cooldown_ms > 60_000
        {
            return Err("상황별 반응의 ID·상황·후보 수(1~16)·대사 간격(0~60000ms)을 확인해 주세요. 같은 상황은 한 번만 등록할 수 있어요.".into());
        }
        let mut variant_ids = HashSet::new();
        for variant in &rule.variants {
            if !valid_id(&variant.id)
                || !variant_ids.insert(&variant.id)
                || !variant.has_effect()
                || variant
                    .text
                    .as_ref()
                    .is_some_and(|text| text.trim().is_empty() || text.chars().count() > 500)
                || variant
                    .expression
                    .as_ref()
                    .is_some_and(|expression| !definition.expressions.contains_key(expression))
            {
                return Err("반응 후보는 서로 다른 ID와 대사·표정·모션 중 하나가 필요해요. 대사는 1~500자, 표정은 이 캐릭터에 등록된 표정을 사용해 주세요.".into());
            }
            validate_motion(&variant.motion, definition, rule.event != "grab-start")?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn rule() -> ReactionRule {
        serde_json::from_value(json!({
            "id":"touch", "event":"click", "cooldownMs":1000,
            "variants":[
                {"id":"hello","text":"  안녕\n반가워  ","expression":"평온"},
                {"id":"wave","motion":{"mode":"static"}}
            ]
        }))
        .unwrap()
    }

    #[test]
    fn cooldown_suppresses_only_speech_and_selection_avoids_the_previous_variant() {
        let rules = vec![rule()];
        let history = ReactionHistory {
            last_played_at: Some(5000),
            variant_id: Some("wave".into()),
        };
        let early = select(&rules, "click", 5999, Some(&history), 0).unwrap();
        assert_eq!(early.variant.id, "hello");
        assert_eq!(early.variant.text.as_deref(), Some("  안녕\n반가워  "));
        assert_eq!(early.variant.expression.as_deref(), Some("평온"));
        assert!(!early.speech_allowed);
        assert!(
            select(&rules, "click", 6000, Some(&history), 0)
                .unwrap()
                .speech_allowed
        );
        assert!(
            !select(&rules, "click", 4000, Some(&history), 0)
                .unwrap()
                .speech_allowed
        );
        assert!(select(&rules, "release", 6000, None, 0).is_none());
        let mut single = rule();
        single.variants.truncate(1);
        let previous = ReactionHistory {
            last_played_at: None,
            variant_id: Some("hello".into()),
        };
        assert!(
            select(&[single], "click", 6000, Some(&previous), u64::MAX)
                .unwrap()
                .speech_allowed
        );
    }

    #[test]
    fn default_motion_is_omitted_and_unknown_motion_fields_are_rejected() {
        let parsed = rule();
        assert!(parsed.variants[0].motion.is_inherit());
        assert!(serde_json::to_value(parsed).unwrap()["variants"][0]
            .get("motion")
            .is_none());
        for invalid in [
            json!({"mode":"static","clipId":"ignored"}),
            json!({"mode":"clip","clipId":"hello","repeat":false,"intervalMs":0,"extra":true}),
            json!({"mode":"unknown"}),
        ] {
            assert!(serde_json::from_value::<MotionOverride>(invalid).is_err());
        }
    }

    #[test]
    fn definitions_reject_ambiguous_rules_invalid_candidates_and_out_of_range_limits() {
        let mut definition = crate::characters::factory_pack().characters.remove(0);
        definition.reactions = vec![rule()];
        validate(&definition).unwrap();
        for kind in 0..9 {
            let mut invalid = definition.clone();
            match kind {
                0 => invalid.reactions.push(invalid.reactions[0].clone()),
                1 => invalid.reactions[0].event = "idle".into(),
                2 => invalid.reactions[0].cooldown_ms = 60_001,
                3 => {
                    invalid.reactions[0].variants =
                        vec![invalid.reactions[0].variants[0].clone(); 17]
                }
                4 => invalid.reactions[0].variants[0].text = Some(" ".into()),
                5 => invalid.reactions[0].variants[0].text = Some("가".repeat(501)),
                6 => invalid.reactions[0].variants[0].expression = Some("없는 표정".into()),
                7 => invalid.reactions[0].variants[1].motion = MotionOverride::Inherit,
                _ => invalid.reactions[0].variants[1].id = "hello".into(),
            }
            assert!(validate(&invalid).is_err(), "case {kind}");
        }
        let mut events = HashSet::new();
        for (event, label) in EVENTS {
            assert!(events.insert(event));
            assert!(!label.is_empty());
            assert!(valid_event(event));
        }
    }
}
