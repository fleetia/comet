pub(crate) mod actions;
pub(crate) mod commands;
pub(crate) mod runtime;
mod store;
#[cfg(test)]
mod tests;
mod vault;

use serde::{Deserialize, Serialize};
pub use store::*;

pub type Result<T> = std::result::Result<T, String>;
pub(crate) const CHUNK_CHARS: usize = 6_000;
pub(crate) const MAX_SOURCE_BYTES: u64 = 4 * 1024 * 1024;
pub const ORGANIZER_VERSION: u32 = 1;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct OrganizerSettings {
    pub enabled: bool,
    pub comet_enabled: bool,
    pub idle_seconds: u32,
    pub daily_request_limit: u32,
}

impl Default for OrganizerSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            comet_enabled: false,
            idle_seconds: 300,
            daily_request_limit: 20,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultConnection {
    pub id: String,
    pub user_id: String,
    pub root: String,
    pub include: Vec<String>,
    pub exclude: Vec<String>,
    pub output_dir: String,
    pub enabled: bool,
    pub automatic: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SourceRef {
    pub id: String,
    pub user_id: String,
    pub workspace_id: String,
    pub project_id: String,
    pub kind: String,
    pub locator: String,
    pub title: String,
    pub content_hash: String,
    pub active: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceDocument {
    pub source: SourceRef,
    pub content: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizerJob {
    pub id: String,
    pub source: SourceRef,
    pub source_hash: String,
    pub chunk_index: usize,
    pub chunk_count: usize,
    pub content: String,
    pub state: String,
    pub attempts: u32,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SummaryInput {
    pub title: String,
    pub summary: String,
    #[serde(default)]
    pub decisions: Vec<String>,
    #[serde(default)]
    pub open_questions: Vec<String>,
    #[serde(default)]
    pub next_actions: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizerRecord {
    pub id: String,
    pub operation_id: String,
    pub source: SourceRef,
    pub title: String,
    pub markdown: String,
    pub output_path: Option<String>,
    pub created_at: i64,
    pub state: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub source: SourceRef,
    pub record_id: Option<String>,
    pub title: String,
    pub excerpt: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizerStatus {
    pub pending: usize,
    pub running: usize,
    pub deferred: usize,
    pub completed: usize,
    pub records: usize,
    pub requests_today: u32,
    pub latest_error: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanReport {
    pub scanned: usize,
    pub changed: usize,
    pub skipped: usize,
    pub cancelled: bool,
}

pub(crate) fn hash(value: &str) -> String {
    use sha2::{Digest, Sha256};
    hex::encode(Sha256::digest(value.as_bytes()))
}

pub(crate) fn now() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

pub(crate) fn err(error: impl std::fmt::Display) -> String {
    error.to_string()
}

pub(crate) fn owner(user_id: &str) -> Result<()> {
    if user_id.is_empty() || user_id.len() > 200 || user_id.chars().any(char::is_control) {
        return Err("정리 기록의 사용자를 확인할 수 없어요.".into());
    }
    Ok(())
}
