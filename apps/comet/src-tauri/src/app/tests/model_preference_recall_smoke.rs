use crate::{
    app::{conversation, lock},
    characters, inference, memory_commands, store,
    types::{LocalModel, Message, Settings},
};
use serde_json::json;
use std::{
    path::{Path, PathBuf},
    sync::{atomic::AtomicBool, Arc},
    time::{Duration, Instant},
};

const FACT: &str =
    "I chose jasmine tea because I like light floral flavors, not very sweet drinks.";
const QUESTION: &str = "What drink do you think I'd enjoy on the train?";

fn user_message(id: &str, target: &str, text: &str) -> Message {
    Message {
        id: id.into(),
        role: "user".into(),
        persona: Some(target.into()),
        content: text.into(),
        expression: None,
        created_at: chrono::Utc::now().timestamp_millis(),
        status: "complete".into(),
    }
}

/// Issue #168: the stored drink preference and a paraphrased recommendation
/// question in a fresh session. Records recall and the original reply text.
#[tokio::test]
#[ignore = "Actual app-path GGUF sample; set COMET_QA_MODEL; optional COMET_QA_OUTPUT_DIR, COMET_QA_BINARIES; no downloads"]
async fn actual_model_preference_recall_smoke() {
    let model = std::env::var("COMET_QA_MODEL").expect("COMET_QA_MODEL is required");
    let model = std::fs::canonicalize(model).expect("Use an existing GGUF file");
    let directory = tempfile::tempdir().unwrap();
    let output_root = std::env::var_os("COMET_QA_OUTPUT_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::temp_dir().join("comet-model-quality-qa"));
    let output_directory = output_root.join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&output_directory).unwrap();
    let output = output_directory.join("preference-recall.json");
    let binaries = std::env::var_os("COMET_QA_BINARIES")
        .map(PathBuf::from)
        .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries"));
    let executable = binaries.join(
        crate::sidecar::development_executable("llama-server")
            .file_name()
            .expect("development sidecar has a file name"),
    );
    let mut state = super::state();
    state.app_data = directory.path().into();
    state.inference = inference::Inference::new(
        directory.path().into(),
        executable,
        binaries.join("runtime"),
    );
    state.nlp =
        crate::nlp::NlpService::new(directory.path().into(), PathBuf::new(), PathBuf::new())
            .unwrap();
    let settings = Settings {
        local_model: LocalModel::Custom,
        local_model_path: model.to_string_lossy().into_owned(),
        ..Settings::default()
    };
    let target = {
        let db = lock(&state.db).unwrap();
        store::save_settings(&db, &settings).unwrap();
        store::set_user_name(&db, "민수", chrono::Utc::now().timestamp_millis()).unwrap();
        let imported = characters::import_pack(&db, &characters::nadir_pack()).unwrap();
        let pair = [imported[0].id.clone(), imported[1].id.clone()];
        characters::apply_pair(&db, pair.clone()).unwrap();
        let source = user_message(
            "fact-source",
            &pair[0],
            &format!("{FACT} What would you choose?"),
        );
        store::insert_message(&db, &source).unwrap();
        store::analyze_apply_batch(
            &db,
            &json!({"revision":store::revision(&db).unwrap(),
                "memories":[{"kind":"user_fact","certain":true,
                    "sourceMessageId":source.id,"evidence":FACT}],
                "events":[]}),
            std::slice::from_ref(&source.id),
        )
        .unwrap();
        store::insert_message(&db, &user_message("question", &pair[0], QUESTION)).unwrap();
        let at = chrono::Utc::now().timestamp_millis();
        let session = store::create_conversation(&db, &pair[..1], None, None, at).unwrap();
        store::attach_conversation_message(&db, &session.id, "question").unwrap();
        pair[0].clone()
    };
    let targets = [target];
    let hits = memory_commands::search_for_turn(&state, "question")
        .await
        .unwrap();
    let prompt = {
        let db = lock(&state.db).unwrap();
        let memories =
            store::recall_for_turn(&db, &hits, &targets, chrono::Utc::now().timestamp_millis())
                .unwrap();
        conversation::turn_prompt_with_memories(&db, &targets, "question", &memories).unwrap()
    };
    let fact_in_prompt = prompt.iter().any(|message| message.content.contains(FACT));
    let started = Instant::now();
    let result = tokio::time::timeout(
        Duration::from_secs(120),
        conversation::generate_turn(
            &state,
            &targets,
            "question",
            Arc::new(AtomicBool::new(false)),
        ),
    )
    .await
    .unwrap_or_else(|_| Err("120 second sample timeout".into()));
    inference::stop_local(&state.inference).await;
    let running = inference::is_local_running(&state.inference, &settings).await;
    std::fs::write(
        &output,
        serde_json::to_vec_pretty(&json!({
            "model":model,"syntheticOnly":true,"runtimeStopped":!running,
            "question":QUESTION,"retrievedMemories":hits,"factInPrompt":fact_in_prompt,
            "prompt":prompt,"elapsedSeconds":started.elapsed().as_secs_f64(),"result":result,
            "meaningReview":"required; response text is not graded by substring"
        }))
        .unwrap(),
    )
    .unwrap();
    println!("Preference recall sample: {}", output.display());
    assert!(!running, "Owned runtime must stop");
    assert!(result.is_ok(), "Generation failed: {result:?}");
}
