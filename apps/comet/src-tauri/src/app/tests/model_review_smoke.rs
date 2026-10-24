use crate::{
    app::conversation_review,
    inference,
    types::{ChatMessage, LocalModel, SceneLine, Settings},
};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

const BUNDLED_FIXTURE: &[u8] = include_bytes!("fixtures/model_review_cases.json");

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReviewCase {
    name: String,
    prompt: Vec<ChatMessage>,
    candidate: Vec<SceneLine>,
    expected_valid: bool,
}

impl ReviewCase {
    fn reviewer_prompt(&self) -> Vec<ChatMessage> {
        conversation_review::prompt(&self.prompt, &self.candidate)
    }
}

#[derive(Deserialize)]
struct Fixture {
    cases: Vec<ReviewCase>,
}

#[test]
fn bundled_review_fixture_preserves_balanced_bounded_inputs() {
    assert_eq!(
        hex::encode(Sha256::digest(BUNDLED_FIXTURE)),
        "467009b66ecf58db4c8ee333a7ead90af8fd80fc7fbcadff457c199196769a6e"
    );
    let fixture: Fixture = serde_json::from_slice(BUNDLED_FIXTURE).unwrap();
    assert_eq!(fixture.cases.len(), 18);
    assert_eq!(
        fixture
            .cases
            .iter()
            .filter(|case| case.expected_valid)
            .count(),
        9
    );
    let mut names = HashSet::new();
    for case in fixture.cases {
        assert!(!case.name.trim().is_empty());
        assert!(names.insert(case.name));
        assert!(!case.prompt.is_empty() && case.prompt.len() <= 16);
        assert!(case
            .prompt
            .iter()
            .all(|message| !message.content.trim().is_empty()));
        assert!(
            case.prompt
                .iter()
                .map(|message| message.content.chars().count())
                .sum::<usize>()
                <= 8_000
        );
        assert!(!case.candidate.is_empty() && case.candidate.len() <= 8);
        assert!(case
            .candidate
            .iter()
            .all(|line| !line.text.trim().is_empty()));
        assert!(
            case.candidate
                .iter()
                .map(|line| line.text.chars().count())
                .sum::<usize>()
                <= 2_000
        );
    }
}

#[test]
fn review_fixture_labels_names_and_rationales_do_not_enter_model_prompt() {
    let raw: Value = serde_json::from_slice(BUNDLED_FIXTURE).unwrap();
    for mut value in raw["cases"].as_array().unwrap().iter().cloned() {
        let case: ReviewCase = serde_json::from_value(value.clone()).unwrap();
        let messages = case.reviewer_prompt();
        assert_eq!(messages.len(), 2);
        assert_eq!(
            serde_json::from_str::<Value>(&messages[1].content).unwrap(),
            json!({"contextMessages":case.prompt,"draft":case.candidate})
        );
        value["name"] = json!("LABEL_METADATA_SENTINEL");
        value["expectedValid"] = json!(!case.expected_valid);
        value["rationale"] = json!("RATIONALE_METADATA_SENTINEL");
        value["source"] = json!("SOURCE_METADATA_SENTINEL");
        let changed: ReviewCase = serde_json::from_value(value).unwrap();
        assert_eq!(
            serde_json::to_value(messages).unwrap(),
            serde_json::to_value(changed.reviewer_prompt()).unwrap()
        );
    }
}

#[tokio::test]
#[ignore = "Independent reviewer GGUF benchmark; COMET_QA_MODEL required; optional COMET_QA_REVIEW_FIXTURE override/COMET_QA_REPEAT/COMET_QA_OUTPUT_DIR/COMET_QA_BINARIES; no downloads"]
async fn actual_model_review_fixture_samples() {
    let model = std::fs::canonicalize(std::env::var("COMET_QA_MODEL").expect("COMET_QA_MODEL"))
        .expect("Use an existing GGUF file");
    assert!(model.is_file());
    let (fixture_path, fixture_bytes) = match std::env::var_os("COMET_QA_REVIEW_FIXTURE") {
        Some(path) => {
            let path =
                std::fs::canonicalize(path).expect("Use an existing external review fixture JSON");
            let bytes = std::fs::read(&path).unwrap();
            (path, bytes)
        }
        None => (
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("src/app/tests/fixtures/model_review_cases.json"),
            BUNDLED_FIXTURE.to_vec(),
        ),
    };
    let raw_fixture: Value = serde_json::from_slice(&fixture_bytes).unwrap();
    let fixture: Fixture = serde_json::from_value(raw_fixture.clone()).unwrap();
    assert!(
        fixture.cases.iter().any(|case| case.expected_valid)
            && fixture.cases.iter().any(|case| !case.expected_valid),
        "Include independently labeled normal and erroneous candidates"
    );
    let repeat: usize = std::env::var("COMET_QA_REPEAT")
        .map_or(Ok(1), |value| value.parse())
        .expect("COMET_QA_REPEAT must be a positive integer");
    assert!(repeat > 0);
    let directory = tempfile::tempdir().unwrap();
    let binaries = std::env::var_os("COMET_QA_BINARIES")
        .map(PathBuf::from)
        .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries"));
    let runtime = inference::Inference::new(
        directory.path().into(),
        binaries.join(
            crate::sidecar::development_executable("llama-server")
                .file_name()
                .unwrap(),
        ),
        binaries.join("runtime"),
    );
    let settings = Settings {
        local_model: LocalModel::Custom,
        local_model_path: model.to_string_lossy().into_owned(),
        local_reasoning_enabled: false,
        ..Settings::default()
    };
    let mut samples = Vec::new();
    let mut true_accept = 0;
    let mut true_reject = 0;
    let mut false_accept = 0;
    let mut false_reject = 0;
    let mut invalid_result = 0;
    for case in fixture.cases {
        for index in 0..repeat {
            let messages = case.reviewer_prompt();
            let cancel = Arc::new(AtomicBool::new(false));
            let start = Instant::now();
            let completed = tokio::time::timeout(
                Duration::from_secs(240),
                inference::generate_review(
                    &runtime,
                    &settings,
                    &messages,
                    conversation_review::schema(),
                    512,
                    cancel.clone(),
                ),
            )
            .await;
            let raw = match completed {
                Ok(result) => result,
                Err(_) => {
                    cancel.store(true, Ordering::SeqCst);
                    inference::stop_local(&runtime).await;
                    Err("Independent review timed out after 240 seconds".into())
                }
            };
            let verdict = raw.clone().and_then(conversation_review::parse);
            let agrees = verdict
                .as_ref()
                .ok()
                .map(|value| value.valid == case.expected_valid);
            match verdict.as_ref().map(|value| value.valid) {
                Ok(true) if case.expected_valid => true_accept += 1,
                Ok(false) if !case.expected_valid => true_reject += 1,
                Ok(true) => false_accept += 1,
                Ok(false) => false_reject += 1,
                Err(_) => invalid_result += 1,
            }
            samples.push(
                json!({"name":case.name,"index":index,"expectedValid":case.expected_valid,
                "reviewPrompt":messages,"rawResult":raw,"verdict":verdict,
                "agreesWithExternalLabel":agrees,"elapsedSeconds":start.elapsed().as_secs_f64()}),
            );
        }
    }
    inference::stop_local(&runtime).await;
    let running = inference::is_local_running(&runtime, &settings).await;
    let output_directory = std::env::var_os("COMET_QA_OUTPUT_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    std::fs::create_dir_all(&output_directory).unwrap();
    let output = output_directory.join(format!("model-review-{}.json", uuid::Uuid::new_v4()));
    std::fs::write(&output, serde_json::to_vec_pretty(&json!({
        "model":model,"fixturePath":fixture_path,"fixtureSha256":hex::encode(Sha256::digest(&fixture_bytes)),
        "fixture":raw_fixture,"repeat":repeat,"ownedRuntimeStopped":!running,
        "scope":"Independent critic experiment only; no production conversation integration, reply repair, native UI or profile mutations",
        "assessment":"JSON parsing is structural. Agreement uses independent fixture labels; manually inspect reasons, false accepts and false rejects before trusting this reviewer. No semantic acceptance pass is asserted.",
        "comparison":{"trueAccept":true_accept,"trueReject":true_reject,
            "falseAccept":false_accept,"falseReject":false_reject,"invalidResult":invalid_result},
        "samples":samples})).unwrap()).unwrap();
    println!("Independent review samples: {}", output.display());
    assert!(!running, "The harness-owned local runtime did not stop");
    assert_eq!(
        invalid_result,
        0,
        "Review structural/inference errors in {}",
        output.display()
    );
    assert_eq!(
        false_accept + false_reject,
        0,
        "Review disagreements with independent labels in {}",
        output.display()
    );
}
