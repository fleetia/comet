use super::ModelKind;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelFile {
    pub name: String,
    pub url: Option<String>,
    pub size: u64,
    pub sha256: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelManifest {
    pub schema: u32,
    pub model: String,
    pub revision: String,
    pub license: String,
    pub profile: String,
    pub threshold: Option<f32>,
    pub files: Vec<ModelFile>,
    #[serde(default)]
    pub installed_files: Vec<ModelFile>,
}
pub fn manifest(kind: ModelKind) -> ModelManifest {
    match kind {
        ModelKind::Kiwi => serde_json::from_str(include_str!("../../../nlp/models/kiwi.json"))
            .expect("bundled Kiwi manifest must be valid"),
        ModelKind::Semantic => {
            let data = if cfg!(target_os = "windows") {
                include_str!("../../../nlp/models/e5-windows-x64.json")
            } else {
                include_str!("../../../nlp/models/e5-macos-arm64.json")
            };
            serde_json::from_str(data).expect("bundled E5 manifest must be valid")
        }
    }
}
pub fn fingerprint(manifest: &ModelManifest) -> String {
    let mut hash = Sha256::new();
    hash.update(manifest.profile.as_bytes());
    hash.update(manifest.revision.as_bytes());
    for file in &manifest.files {
        hash.update(file.name.as_bytes());
        hash.update(file.sha256.as_bytes());
    }
    hash.update(
        manifest
            .threshold
            .map(f32::to_bits)
            .unwrap_or_default()
            .to_le_bytes(),
    );
    hex::encode(hash.finalize())
}

/// Installation identity deliberately excludes retrieval policy and thresholds.
pub fn artifact_fingerprint(manifest: &ModelManifest) -> String {
    let mut hash = Sha256::new();
    hash.update(manifest.model.as_bytes());
    hash.update(manifest.revision.as_bytes());
    for file in &manifest.files {
        hash.update(file.name.as_bytes());
        hash.update(file.size.to_le_bytes());
        hash.update(file.sha256.as_bytes());
    }
    hex::encode(hash.finalize())
}
