//! Private, bounded JSONL protocol. stdout is reserved for this protocol.
use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u32 = 1;
pub const MAX_TEXT_BYTES: usize = 64 * 1024;
pub const MAX_LINE_BYTES: usize = 4 * 1024 * 1024;
pub const EMBEDDING_DIMENSIONS: usize = 384;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Operation {
    Query,
    Index,
    Analyze,
    EmbedQuery,
    EmbedPassage,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub version: u32,
    pub id: u64,
    pub operation: Operation,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Token {
    pub form: String,
    pub tag: String,
    pub start: usize,
    pub end: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Embedding {
    /// UTF-8 byte range in the original text (prefix and special tokens excluded).
    pub start: usize,
    pub end: usize,
    pub vector: Vec<f32>,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct Analysis {
    #[serde(default)]
    pub kiwi_error: Option<String>,
    #[serde(default)]
    pub semantic_error: Option<String>,
    #[serde(default)]
    pub kiwi_profile: Option<String>,
    #[serde(default)]
    pub semantic_profile: Option<String>,
    pub tokens: Vec<Token>,
    pub embeddings: Vec<Embedding>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Response {
    pub version: u32,
    pub id: u64,
    pub result: Option<Analysis>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Ready {
    pub version: u32,
    pub ready: bool,
    pub kiwi: bool,
    pub semantic: bool,
    pub errors: Vec<String>,
}
