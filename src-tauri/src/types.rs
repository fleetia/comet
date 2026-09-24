use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum LocalModel {
    #[default]
    #[serde(rename = "qwen3.5-4b")]
    Qwen35_4B,
    #[serde(rename = "qwen3.5-9b")]
    Qwen35_9B,
    #[serde(rename = "qwen3.8-2b-distill")]
    Qwen38_2B,
    #[serde(rename = "qwen3.8-4b-distill")]
    Qwen38_4B,
    #[serde(rename = "qwen3.8-9b-distill")]
    Qwen38_9B,
    #[serde(rename = "gemma-4-e4b")]
    Gemma4E4B,
    #[serde(rename = "gemma-4-12b")]
    Gemma4_12B,
    #[serde(rename = "ministral-3-8b")]
    Ministral3_8B,
    #[serde(rename = "custom")]
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalModelStatus {
    pub id: LocalModel,
    pub name: String,
    pub description: String,
    pub size: u64,
    pub ready: bool,
    pub downloaded_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalModelTest {
    pub reply: String,
    pub elapsed_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub mode: String,
    #[serde(default)]
    pub local_model: LocalModel,
    #[serde(default)]
    pub local_model_path: String,
    pub base_url: String,
    pub api_model: String,
    pub api_token_parameter: String,
    #[serde(default = "default_autonomous_enabled")]
    pub autonomous_enabled: bool,
    pub local_idle_enabled: bool,
    pub api_idle_enabled: bool,
    pub idle_minutes: u32,
}

fn default_autonomous_enabled() -> bool {
    true
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            mode: "local".into(),
            local_model: LocalModel::default(),
            local_model_path: String::new(),
            base_url: "https://api.openai.com/v1".into(),
            api_model: String::new(),
            api_token_parameter: "max_completion_tokens".into(),
            autonomous_enabled: true,
            local_idle_enabled: false,
            api_idle_enabled: false,
            idle_minutes: 2,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub role: String,
    pub persona: Option<String>,
    pub content: String,
    pub expression: Option<String>,
    pub created_at: i64,
    pub status: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Memory {
    #[serde(default)]
    pub character_id: String,
    #[serde(default)]
    pub user_id: String,
    #[serde(default)]
    pub user_name: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub source_text: String,
    #[serde(default)]
    pub source_created_at: i64,
    #[serde(default)]
    pub retired_at: Option<i64>,
    #[serde(default)]
    pub recall_weight: f64,
    pub id: String,
    pub content: String,
    pub source_message_id: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UserIdentity {
    pub id: String,
    pub name: String,
    pub started_at: i64,
    pub ended_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Relationship {
    pub persona: String,
    pub score: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneLine {
    pub persona: String,
    pub expression: String,
    pub text: String,
    #[serde(
        default,
        skip_serializing_if = "crate::character_reactions::MotionOverride::is_inherit"
    )]
    pub motion: crate::character_reactions::MotionOverride,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WordbookEntry {
    pub id: String,
    pub title: String,
    pub keywords: Vec<String>,
    pub lines: Vec<SceneLine>,
    pub enabled: bool,
    pub use_for_idle: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Playback {
    pub id: String,
    pub persona: String,
    pub expression: String,
    pub text: String,
    #[serde(
        default,
        skip_serializing_if = "crate::character_reactions::MotionOverride::is_inherit"
    )]
    pub motion: crate::character_reactions::MotionOverride,
    pub source: String,
    #[serde(default)]
    pub text_speed: u32,
    #[serde(default)]
    pub display_started_at: Option<i64>,
    pub ends_at: i64,
    pub line_index: usize,
    pub line_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelState {
    pub persona: String,
    pub mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedScene {
    pub id: String,
    pub revision: i64,
    pub lines: Vec<SceneLine>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowPosition {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub model: LocalModel,
    pub error: Option<String>,
    pub received: u64,
    pub total: u64,
    pub status: String,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RuntimePhase {
    #[default]
    Idle,
    Loading,
    Generating,
    Playing,
    Waiting,
    Analyzing,
    Preparing,
    Story,
    Error,
}

impl RuntimePhase {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Loading => "loading",
            Self::Generating => "generating",
            Self::Playing => "playing",
            Self::Waiting => "waiting",
            Self::Analyzing => "analyzing",
            Self::Preparing => "preparing",
            Self::Story => "story",
            Self::Error => "error",
        }
    }
}

impl PartialEq<&str> for RuntimePhase {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub phase: RuntimePhase,
    pub persona: Option<String>,
    pub error: Option<String>,
    pub download: Option<DownloadProgress>,
    pub hidden: bool,
    pub paused: bool,
}

impl Default for RuntimeStatus {
    fn default() -> Self {
        Self {
            phase: RuntimePhase::Idle,
            persona: None,
            error: None,
            download: None,
            hidden: false,
            paused: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    #[serde(default)]
    pub(crate) reactions:
        std::collections::BTreeMap<String, crate::character_reactions::ReactionRun>,
    #[serde(default)]
    pub user: Option<UserIdentity>,
    #[serde(default)]
    pub legacy_memory_count: usize,
    #[serde(default)]
    pub message_user_names: std::collections::BTreeMap<String, String>,
    pub characters: crate::characters::CharacterCollection,
    pub message_identities: Vec<crate::store::MessageIdentity>,
    pub settings: Settings,
    pub messages: Vec<Message>,
    pub memory_count: usize,
    pub memory_revision: i64,
    pub relationships: Vec<Relationship>,
    pub prepared_count: usize,
    pub runtime: RuntimeStatus,
    pub has_api_key: bool,
    pub model_ready: bool,
    pub local_models: Vec<LocalModelStatus>,
    pub playback: Option<Playback>,
    pub panel: Option<PanelState>,
    pub wordbook: Vec<WordbookEntry>,
    #[serde(default, skip_deserializing)]
    pub story: Option<crate::story::Request>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_playback_defaults_to_instant_text_without_changing_content_or_deadline() {
        let value = serde_json::json!({
            "id": "line",
            "persona": "builtin-a",
            "expression": "평온",
            "text": "  원문\n그대로  ",
            "source": "wordbook",
            "endsAt": 12345,
            "lineIndex": 0,
            "lineCount": 1
        });
        let playback: Playback = serde_json::from_value(value).unwrap();
        assert_eq!(playback.text_speed, 0);
        assert_eq!(playback.display_started_at, None);
        assert_eq!(playback.text, "  원문\n그대로  ");
        assert_eq!(playback.ends_at, 12345);
    }

    #[test]
    fn runtime_phase_wire_values_and_existing_autogeneration_choices_are_preserved() {
        for phase in [
            RuntimePhase::Idle,
            RuntimePhase::Loading,
            RuntimePhase::Generating,
            RuntimePhase::Playing,
            RuntimePhase::Waiting,
            RuntimePhase::Analyzing,
            RuntimePhase::Preparing,
            RuntimePhase::Story,
            RuntimePhase::Error,
        ] {
            assert_eq!(serde_json::to_value(phase).unwrap(), phase.as_str());
            assert_eq!(
                serde_json::from_value::<RuntimePhase>(serde_json::json!(phase.as_str())).unwrap(),
                phase
            );
        }
        assert!(serde_json::from_value::<RuntimePhase>(serde_json::json!("unknown")).is_err());
        assert!(!Settings::default().local_idle_enabled);
        assert!(Settings::default().autonomous_enabled);
        let mut saved = serde_json::to_value(Settings::default()).unwrap();
        saved["localIdleEnabled"] = serde_json::json!(true);
        assert!(
            serde_json::from_value::<Settings>(saved)
                .unwrap()
                .local_idle_enabled
        );
    }

    #[test]
    fn legacy_settings_default_to_four_b_and_selection_survives_reopen() {
        let mut legacy = serde_json::to_value(Settings::default()).unwrap();
        legacy.as_object_mut().unwrap().remove("localModel");
        legacy.as_object_mut().unwrap().remove("localModelPath");
        legacy.as_object_mut().unwrap().remove("autonomousEnabled");
        legacy["idleMinutes"] = serde_json::json!(5);
        let settings: Settings = serde_json::from_value(legacy).unwrap();
        assert_eq!(settings.local_model, LocalModel::Qwen35_4B);
        assert_eq!(settings.local_model_path, "");
        assert!(settings.autonomous_enabled);
        assert_eq!(settings.idle_minutes, 5);
        assert_eq!(Settings::default().idle_minutes, 2);
        let selected = Settings {
            local_model: LocalModel::Qwen35_9B,
            ..settings
        };
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("settings.json");
        std::fs::write(&path, serde_json::to_vec(&selected).unwrap()).unwrap();
        let reopened: Settings = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        assert_eq!(reopened.local_model, LocalModel::Qwen35_9B);
        assert_eq!(
            serde_json::to_value(reopened).unwrap()["localModel"],
            "qwen3.5-9b"
        );
    }
}
