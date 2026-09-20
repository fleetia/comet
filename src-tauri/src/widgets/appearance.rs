use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const SUPPORTED_KINDS: [&str; 3] = ["clock", "weather", "device"];

const PLACEMENTS: [&str; 9] = [
    "top-left",
    "top-center",
    "top-right",
    "center-left",
    "center-center",
    "center-right",
    "bottom-left",
    "bottom-center",
    "bottom-right",
];

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Appearance {
    pub background_color: String,
    pub background_position: String,
    pub text_color: String,
    pub text_position: String,
}

impl Default for Appearance {
    fn default() -> Self {
        Self {
            background_color: "#24202d".into(),
            background_position: "center-center".into(),
            text_color: "#fffaf2".into(),
            text_position: "center-center".into(),
        }
    }
}

pub fn supports(kind: &str) -> bool {
    SUPPORTED_KINDS.contains(&kind)
}

pub fn initial() -> Value {
    serde_json::to_value(Appearance::default())
        .expect("widget appearance defaults are serializable")
}

fn valid_color(value: &str) -> bool {
    (value.len() == 7 || value.len() == 9)
        && value.starts_with('#')
        && value[1..]
            .chars()
            .all(|character| character.is_ascii_hexdigit())
}

fn valid_placement(value: &str) -> bool {
    PLACEMENTS.contains(&value)
}

fn validate(appearance: Appearance) -> Result<Appearance, String> {
    if !valid_color(&appearance.background_color) || !valid_color(&appearance.text_color) {
        return Err("배경과 글자 색상은 #RRGGBB 또는 #RRGGBBAA 형식이어야 해요.".into());
    }
    if !valid_placement(&appearance.background_position)
        || !valid_placement(&appearance.text_position)
    {
        return Err("배경과 글자 위치를 확인해 주세요.".into());
    }
    Ok(appearance)
}

pub fn configure(kind: &str, data: &Value, input: &Value) -> Result<Value, String> {
    if !supports(kind) {
        return Err("이 위젯은 바탕화면 표시를 지원하지 않아요.".into());
    }
    let appearance: Appearance = serde_json::from_value(input.clone())
        .map_err(|_| "바탕화면 표시 설정 형식이 올바르지 않아요.".to_string())
        .and_then(validate)?;
    let mut next = data.clone();
    next["appearance"] = serde_json::to_value(appearance).map_err(|error| error.to_string())?;
    Ok(next)
}

#[cfg(test)]
pub fn read(data: &Value) -> Appearance {
    data.get("appearance")
        .cloned()
        .and_then(|value| serde_json::from_value(value).ok())
        .and_then(|value| validate(value).ok())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn defaults_are_stable_and_can_be_saved_without_losing_widget_data() {
        let data = json!({"anniversaries":[{"id":"a"}]});
        let next = configure("clock", &data, &initial()).unwrap();
        assert_eq!(next["anniversaries"], data["anniversaries"]);
        assert_eq!(read(&next), Appearance::default());
    }

    #[test]
    fn rejects_unknown_kind_and_invalid_position() {
        assert!(configure("music", &json!({}), &initial()).is_err());
        let mut input = initial();
        input["textPosition"] = json!("middle");
        assert!(configure("clock", &json!({}), &input).is_err());
    }

    #[test]
    fn reads_legacy_data_with_no_appearance() {
        assert_eq!(read(&json!({"format":"24h"})), Appearance::default());
    }
}
