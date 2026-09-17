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
            local_idle_enabled: true,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Memory {
    pub id: String,
    pub content: String,
    pub source_message_id: String,
    pub updated_at: i64,
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
    pub source: String,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub phase: String,
    pub persona: Option<String>,
    pub error: Option<String>,
    pub download: Option<DownloadProgress>,
    pub hidden: bool,
    pub paused: bool,
}

impl Default for RuntimeStatus {
    fn default() -> Self {
        Self {
            phase: "idle".into(),
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
    pub characters: crate::characters::CharacterCollection,
    pub message_identities: Vec<crate::store::MessageIdentity>,
    pub settings: Settings,
    pub messages: Vec<Message>,
    pub memories: Vec<Memory>,
    pub relationships: Vec<Relationship>,
    pub prepared_count: usize,
    pub runtime: RuntimeStatus,
    pub has_api_key: bool,
    pub model_ready: bool,
    pub local_models: Vec<LocalModelStatus>,
    pub playback: Option<Playback>,
    pub panel: Option<PanelState>,
    pub wordbook: Vec<WordbookEntry>,
}

#[cfg(test)]
mod tests {
    use super::*;

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
