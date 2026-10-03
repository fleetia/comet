use crate::{
    app::{conversation, lock, AppState},
    characters, inference, memory_commands, store, story,
    types::{LocalModel, Message, Settings},
};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

const PRIVATE_SENTINEL: &str = "보랏빛우산-합성-QA";

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

fn remember(db: &Connection, message: &Message, supersedes: &str) -> Result<(), String> {
    store::insert_message(db, message)?;
    store::analyze_apply_batch(
        db,
        &json!({
            "revision":store::revision(db)?,
            "memories":[{"kind":"user_fact","certain":true,
                "sourceMessageId":message.id,"evidence":message.content,"supersedesId":supersedes}],
            "events":[]
        }),
        std::slice::from_ref(&message.id),
    )
}

struct Sample<'a> {
    name: &'a str,
    question: &'a str,
    targets: &'a [String],
    former_user_memory: Option<bool>,
    secret_in_prompt: Option<bool>,
    disclosure_level: u8,
}

async fn sample(
    state: &AppState,
    case: Sample<'_>,
    reports: &mut Vec<Value>,
) -> Result<(), String> {
    if std::env::var("COMET_QA_CASE")
        .is_ok_and(|names| !names.split(',').any(|name| name == case.name))
    {
        return Ok(());
    }
    {
        let db = lock(&state.db)?;
        let target = if case.targets.len() == 2 {
            "both"
        } else {
            &case.targets[0]
        };
        store::insert_message(&db, &user_message(case.name, target, case.question))?;
    }
    let hits = memory_commands::search_for_turn(state, case.name).await?;
    let (prompt, user, level, contains_secret, boundaries) = {
        let db = lock(&state.db)?;
        let memories = store::revalidate_search_hits(&db, &hits)?;
        let prompt =
            conversation::turn_prompt_with_memories(&db, case.targets, case.name, &memories)?;
        let current = store::require_user(&db)?;
        let nadir = characters::active_character(&db, "a")?;
        let score = store::relationships(&db)?
            .into_iter()
            .find(|relationship| relationship.persona == nadir.id)
            .ok_or("Synthetic Nadir relationship is missing")?
            .score;
        let level = story::disclosure_level(&db, &nadir.id, score)?;
        let contains_secret = prompt
            .iter()
            .any(|message| message.content.contains(PRIVATE_SENTINEL));
        let current_user_is_identified = prompt
            .iter()
            .any(|message| message.role == "system" && message.content.contains(&current.id));
        let corrected_sources_only = memories
            .iter()
            .all(|memory| !memory.source_message_id.starts_with("coffee-"));
        let owners_match = case.former_user_memory.is_none_or(|former| {
            memories
                .iter()
                .filter(|memory| memory.source_message_id.starts_with("correction-"))
                .all(|memory| {
                    if former {
                        memory.user_id != current.id && memory.retired_at.is_some()
                    } else {
                        memory.user_id == current.id && memory.retired_at.is_none()
                    }
                })
        });
        let has_preference_memory = memories
            .iter()
            .any(|memory| memory.source_message_id.starts_with("correction-"));
        let private_memory_recalled = memories
            .iter()
            .any(|memory| memory.source_message_id == "synthetic-private-experience");
        let mut histories_filtered = true;
        for target in case.targets {
            let history =
                story::prompt_history(&db, target, store::context_messages_for(&db, 24, target)?)?;
            histories_filtered &=
                level == 2 || history.iter().all(|message| message.role != "assistant");
        }
        let boundaries = json!({
            "currentUserIdentified":current_user_is_identified,
            "supersededMemoriesExcluded":corrected_sources_only,
            "memoryOwnersMatchScenario":owners_match,
            "preferenceMemoryRetrieved":case.former_user_memory.is_none() || has_preference_memory,
            "privateSentinelMatchesDisclosure":case.secret_in_prompt.is_none_or(|expected| contains_secret == expected),
            "privateMemoryMatchesDisclosure":private_memory_recalled == (level == 2),
            "expectedDisclosureLevel":level == case.disclosure_level,
            "privateAssistantHistoryExcluded":histories_filtered
        });
        (prompt, current, level, contains_secret, boundaries)
    };
    let boundary_passed = boundaries
        .as_object()
        .is_some_and(|items| items.values().all(|value| value == &json!(true)));
    if !boundary_passed {
        reports.push(json!({"name":case.name,"prompt":prompt,"user":user,
            "retrievedMemories":hits,"disclosureLevel":level,"boundaries":boundaries,
            "privateSentinelInPrompt":contains_secret}));
        return Err(format!("{}: synthetic prompt boundary failed", case.name));
    }

    let started = Instant::now();
    let cancel = Arc::new(AtomicBool::new(false));
    // No DB mutation occurs between this prompt capture and the production request.
    let result = tokio::time::timeout(
        Duration::from_secs(90),
        conversation::generate_turn(state, case.targets, case.name, cancel.clone()),
    )
    .await;
    let result = match result {
        Ok(result) => result,
        Err(_) => {
            cancel.store(true, Ordering::SeqCst);
            inference::stop_local(&state.inference).await;
            Err("90 second sample timeout".into())
        }
    };
    reports.push(json!({"name":case.name,"prompt":prompt,"user":user,
        "retrievedMemories":hits,"disclosureLevel":level,"boundaries":boundaries,
        "privateSentinelInPrompt":contains_secret,
        "elapsedSeconds":started.elapsed().as_secs_f64(),"result":result,
        "meaningReview":"required; response text is not graded by substring"}));
    let (lines, _) = result.map_err(|error| format!("{}: {error}", case.name))?;
    if lines.len() != case.targets.len()
        || lines
            .iter()
            .zip(case.targets)
            .any(|(line, target)| &line.persona != target)
    {
        return Err(format!("{}: response speaker/order mismatch", case.name));
    }
    Ok(())
}

async fn run_samples(state: &AppState, reports: &mut Vec<Value>) -> Result<(), String> {
    let pair = {
        let db = lock(&state.db)?;
        store::set_user_name(&db, "민수", chrono::Utc::now().timestamp_millis())?;
        let imported = characters::import_pack(&db, &characters::nadir_pack())?;
        let pair = [imported[0].id.clone(), imported[1].id.clone()];
        characters::apply_pair(&db, pair.clone())?;
        for (index, target) in pair.iter().enumerate() {
            let coffee = user_message(&format!("coffee-{index}"), target, "내 음료 취향은 커피야.");
            remember(&db, &coffee, "")?;
            let old = store::memories(&db)?
                .into_iter()
                .find(|memory| memory.source_message_id == coffee.id)
                .ok_or("Synthetic coffee memory is missing")?;
            remember(
                &db,
                &user_message(
                    &format!("correction-{index}"),
                    target,
                    "정정할게. 내 음료 취향은 커피 말고 차야.",
                ),
                &old.id,
            )?;
            if store::context_messages_for(&db, 24, target)?
                .iter()
                .any(|message| message.id == coffee.id)
            {
                return Err("Superseded source remained in current history".into());
            }
        }
        pair
    };
    for (name, question, targets) in [
        ("corrected-preference", "내 음료 취향?", &pair[..1]),
        ("pair-corrected-preference", "내 음료 취향?", &pair[..]),
    ] {
        sample(
            state,
            Sample {
                name,
                question,
                targets,
                former_user_memory: Some(false),
                secret_in_prompt: Some(false),
                disclosure_level: 0,
            },
            reports,
        )
        .await?;
    }
    sample(
        state,
        Sample {
            name: "speaker-and-user-identity",
            question: "내 이름과 네 이름을 각각 말해 줘.",
            targets: &pair[..1],
            former_user_memory: None,
            secret_in_prompt: Some(false),
            disclosure_level: 0,
        },
        reports,
    )
    .await?;

    {
        let db = lock(&state.db)?;
        let before = store::require_user(&db)?;
        let at = chrono::Utc::now().timestamp_millis();
        store::set_user_name(&db, "지연", at)?;
        store::set_user_name(&db, "민수", at)?;
        if store::require_user(&db)?.id == before.id {
            return Err("Same-name new user unexpectedly reused the former identity".into());
        }
    }
    sample(
        state,
        Sample {
            name: "same-name-new-person",
            question: "내 음료 취향?",
            targets: &pair[..1],
            former_user_memory: Some(true),
            secret_in_prompt: Some(false),
            disclosure_level: 0,
        },
        reports,
    )
    .await?;

    {
        let db = lock(&state.db)?;
        let current = store::require_user(&db)?;
        store::insert_experience(
            &db,
            &pair[0],
            &current.id,
            "synthetic-private-experience",
            &format!("비밀 암호는 {PRIVATE_SENTINEL}"),
            "Synthetic private chapter fixture",
            chrono::Utc::now().timestamp_millis(),
            Some(2),
        )?;
        let mut history = user_message("synthetic-private-history", &pair[0], PRIVATE_SENTINEL);
        history.role = "assistant".into();
        history.expression = Some("평온".into());
        store::insert_message_with_source(&db, &history, "llm", None, true)?;
    }
    for level in 0..=2 {
        {
            let db = lock(&state.db)?;
            if level > 0 {
                // Synthetic chapter progress; this does not simulate one hour of desktop uptime.
                for seed in 0..5 {
                    let request = story::prepare(&db, &pair[0], 0, seed)?
                        .ok_or("Synthetic story request is missing")?;
                    let choice = request
                        .scene
                        .choices
                        .iter()
                        .max_by_key(|choice| choice.delta)
                        .ok_or("Synthetic story choice is missing")?;
                    story::answer(&db, &request, &choice.id, 0)?;
                }
            }
        }
        let name = format!("story-disclosure-{level}");
        sample(
            state,
            Sample {
                name: &name,
                question: "비밀 암호?",
                targets: &pair,
                former_user_memory: None,
                secret_in_prompt: (level < 2).then_some(false),
                disclosure_level: level,
            },
            reports,
        )
        .await?;
    }
    Ok(())
}

#[tokio::test]
#[ignore = "Actual app-path GGUF samples; set COMET_QA_MODEL; optional COMET_QA_OUTPUT_DIR, COMET_QA_CASE, COMET_QA_BINARIES; no downloads"]
async fn actual_model_app_path_semantics_smoke() {
    let model = std::env::var("COMET_QA_MODEL").expect("COMET_QA_MODEL is required");
    let model = std::fs::canonicalize(model).expect("Use an existing GGUF file");
    assert!(model.is_file());
    let directory = tempfile::tempdir().unwrap();
    let output_root = std::env::var_os("COMET_QA_OUTPUT_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::temp_dir().join("comet-model-quality-qa"));
    let output_directory = output_root.join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&output_directory).unwrap();
    let output = output_directory.join("app-path-samples.json");
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
    store::save_settings(&lock(&state.db).unwrap(), &settings).unwrap();
    let mut reports = Vec::new();
    let outcome = run_samples(&state, &mut reports).await;
    inference::stop_local(&state.inference).await;
    let running = inference::is_local_running(&state.inference, &settings).await;
    let expected_samples =
        std::env::var("COMET_QA_CASE").map_or(7, |names| names.split(',').count());
    let all_responses_parsed = reports.len() == expected_samples
        && reports
            .iter()
            .all(|report| report["result"].get("Ok").is_some());
    std::fs::write(&output, serde_json::to_vec_pretty(&json!({
        "model":model,"syntheticOnly":true,"runtimeStopped":!running,
        "outcome":outcome,"allResponsesParsed":all_responses_parsed,
        "meaningQuality":"ungraded; review each original response text manually",
        "scope":"production search and generate_turn; synthetic memory extraction and story progress; no desktop presentation",
        "samples":reports
    })).unwrap()).unwrap();
    println!("Actual app-path model samples: {}", output.display());
    assert!(!running, "Owned runtime must stop");
    assert!(
        outcome.is_ok(),
        "Inspect boundary failure in {}: {outcome:?}",
        output.display()
    );
    assert!(
        all_responses_parsed,
        "Inspect generation errors in {}",
        output.display()
    );
}
