use crate::{
    app::{conversation, lock, AppState},
    characters, inference, store,
    types::{LocalModel, Message, Settings},
};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::{atomic::AtomicBool, Arc},
    time::{Duration, Instant},
};

// Issue #151 inputs, kept verbatim so later prompt changes are compared on the same requests.
const USER_NAME: &str = "QA Travel Memo";
const CASES: [(&str, &str); 2] = [
    (
        "travel-change-summary",
        "My Busan plans changed. The trip was November 6 to 8, but now I plan to go November 7 to 9. I cancelled the old train ticket and have not booked a new one. The hotel is still undecided, and I decided to skip the beach walk. Can you summarize what is planned, cancelled, and undecided in Korean?",
    ),
    (
        "travel-preparation",
        "I plan to visit Busan from November 6 to 8. I have already booked the train, but I have not chosen a hotel. I want to walk by the beach, but the schedule is undecided. What should I prepare next? Please reply in Korean.",
    ),
];

async fn sample(
    state: &AppState,
    settings: &Settings,
    name: &str,
    question: &str,
) -> Result<Value, String> {
    let (target, prompt) = {
        let mut db = lock(&state.db)?;
        *db = store::open(Path::new(":memory:"))?;
        store::save_settings(&db, settings)?;
        store::set_user_name(&db, USER_NAME, chrono::Utc::now().timestamp_millis())?;
        let installed = characters::import_pack(&db, &characters::byulkkori_pack())?;
        let target = installed[0].id.clone();
        characters::apply_roster(&db, vec![target.clone()])?;
        store::insert_message(
            &db,
            &Message {
                id: name.into(),
                role: "user".into(),
                persona: Some(target.clone()),
                content: question.into(),
                expression: None,
                created_at: chrono::Utc::now().timestamp_millis(),
                status: "complete".into(),
            },
        )?;
        let prompt =
            conversation::turn_prompt_with_memories(&db, std::slice::from_ref(&target), name, &[])?;
        (target, prompt)
    };
    let started = Instant::now();
    let result = tokio::time::timeout(
        Duration::from_secs(120),
        conversation::generate_turn(
            state,
            std::slice::from_ref(&target),
            name,
            Arc::new(AtomicBool::new(false)),
        ),
    )
    .await
    .map_err(|_| "120 second sample timeout".to_string())
    .and_then(|result| result);
    let character = characters::get(&*lock(&state.db)?, &target)?
        .definition
        .name;
    Ok(
        json!({"name":name,"question":question,"userName":USER_NAME,"characterName":character,
        "prompt":prompt,"elapsedSeconds":started.elapsed().as_secs_f64(),
        "result":result.map(|(lines, _)| lines.into_iter().map(|line| line.text).collect::<Vec<_>>()),
        "meaningReview":"required: planned/cancelled/undecided coverage, user/character attribution, no invented phrases"}),
    )
}

#[tokio::test]
#[ignore = "Actual GGUF samples for #151; set COMET_QA_MODEL; optional COMET_QA_REPEAT, COMET_QA_OUTPUT_DIR; no downloads"]
async fn actual_model_travel_summary_samples() {
    let model = std::fs::canonicalize(std::env::var("COMET_QA_MODEL").expect("COMET_QA_MODEL"))
        .expect("Use an existing GGUF file");
    let repeat = std::env::var("COMET_QA_REPEAT").map_or(5, |value| value.parse().unwrap());
    let directory = tempfile::tempdir().unwrap();
    let binaries = Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries");
    let mut state = super::state();
    state.app_data = directory.path().into();
    state.inference = inference::Inference::new(
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
        ..Settings::default()
    };
    let mut samples = vec![];
    for (name, question) in CASES {
        for index in 0..repeat {
            samples.push(
                sample(&state, &settings, &format!("{name}-{index}"), question)
                    .await
                    .unwrap(),
            );
        }
    }
    inference::stop_local(&state.inference).await;
    let output = std::env::var_os("COMET_QA_OUTPUT_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join(format!("travel-summary-{}.json", uuid::Uuid::new_v4()));
    std::fs::write(
        &output,
        serde_json::to_vec_pretty(&json!({"model":model,"syntheticOnly":true,"samples":samples}))
            .unwrap(),
    )
    .unwrap();
    println!("Travel summary samples: {}", output.display());
}
