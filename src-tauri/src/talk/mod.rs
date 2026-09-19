pub mod context;
pub mod defaults;
mod evaluator;
mod expr;
mod parser;
pub mod runtime;
#[cfg(test)]
mod tests;

pub use evaluator::{render_scene, render_scene_with_text_values, simulate};
pub use expr::{Expr, Operator};
pub use parser::{load, validate_source};
use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ValueType {
    Boolean,
    Number,
    String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Variable {
    pub name: String,
    pub kind: ValueType,
    pub nullable: bool,
    pub widget: Option<String>,
    pub description: String,
}
#[derive(Clone, Debug, Default, Serialize)]
pub struct Registry {
    pub variables: BTreeMap<String, Variable>,
    pub events: BTreeSet<String>,
}
#[derive(Clone, Debug)]
pub struct EvalContext {
    pub values: BTreeMap<String, Value>,
    pub active: Vec<String>,
    pub available: BTreeSet<String>,
    pub now_ms: i64,
    pub seed: u64,
    pub trigger: String,
}
pub type History = BTreeMap<String, i64>;
#[derive(Clone, Debug, Serialize)]
pub struct Diagnostic {
    pub path: String,
    pub line: usize,
    pub column: usize,
    pub code: String,
    pub message: String,
}
#[derive(Clone, Debug, Serialize)]
pub struct Span {
    pub path: String,
    pub line: usize,
    pub column: usize,
    pub end_line: usize,
    pub end_column: usize,
}
impl Span {
    pub(crate) fn error(&self, code: &str, message: impl Into<String>) -> Diagnostic {
        Diagnostic {
            path: self.path.clone(),
            line: self.line,
            column: self.column,
            code: code.into(),
            message: message.into(),
        }
    }
}
#[derive(Clone, Debug)]
pub struct Program {
    pub files: BTreeSet<PathBuf>,
    pub sources: BTreeMap<PathBuf, String>,
    pub scenes: Vec<Scene>,
}
impl Program {
    pub fn load(entry: &Path, registry: &Registry) -> Result<Self, Vec<Diagnostic>> {
        load(entry, registry)
    }
}
#[derive(Clone, Debug)]
pub struct Scene {
    pub key: String,
    pub id: String,
    pub pair: Option<Vec<String>>,
    pub trigger: String,
    pub condition: Option<Expr>,
    pub cooldown_ms: i64,
    pub body: Vec<Statement>,
    pub dependencies: BTreeSet<String>,
    pub references: BTreeSet<String>,
    pub span: Span,
}
#[derive(Clone, Debug)]
pub enum Statement {
    Line {
        speaker: usize,
        expression: String,
        parts: Vec<TextPart>,
        span: Span,
    },
    If {
        condition: Expr,
        yes: Vec<Statement>,
        no: Vec<Statement>,
        span: Span,
    },
}
#[derive(Clone, Debug)]
pub enum TextPart {
    Text(String),
    Variable(String),
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Selection {
    pub key: String,
    pub scene_id: String,
    pub lines: Vec<crate::types::SceneLine>,
    pub dependencies: BTreeSet<String>,
    pub references: BTreeSet<String>,
    pub cooldown_ms: i64,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub key: String,
    pub scene_id: String,
    pub eligible: bool,
    pub reason: String,
}
#[derive(Clone, Debug, Serialize)]
pub struct Simulation {
    pub candidates: Vec<Candidate>,
    pub selected: Option<Selection>,
}
