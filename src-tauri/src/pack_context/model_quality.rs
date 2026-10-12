use crate::{
    app::{conversation, lock, AppState},
    character_guests, characters, inference, pack_stories, store,
    types::{LocalModel, Message, SceneLine, Settings},
};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

const PRIVATE_HISTORY: &str = "비공개기록-보랏빛우산";
const PRIVATE_KNOWLEDGE: &str = "NPC전용-초록서랍";
const SHARED_FACT: &str = "관측소의 별 이름은 은빛여울이다.";

fn fixture(
    state: &AppState,
    settings: &Settings,
    guest: bool,
    unlocked: bool,
) -> Result<Vec<String>, String> {
    let mut db = lock(&state.db)?;
    *db = store::open(Path::new(":memory:"))?;
    store::save_settings(&db, settings)?;
    store::set_user_name(&db, "합성 검증자", chrono::Utc::now().timestamp_millis())?;
    let mut pack = characters::factory_pack();
    let template = pack.characters[0].clone();
    pack.format_version = 8;
    pack.name = "합성 대화 품질 검증".into();
    pack.characters = ["다온", "하린", "누리"]
        .into_iter()
        .enumerate()
        .map(|(index, name)| {
            let mut actor = template.clone();
            actor.source_id = format!("quality-{index}");
            actor.name = name.into();
            actor.description = format!("이름: {name}. 별을 관측하는 친구다.");
            actor.personality = "한국어 반말로 짧고 자연스럽게 말한다.".into();
            actor.instructions = if index == 0 {
                "말의 첫머리는 반짝!으로 시작한다.".into()
            } else {
                String::new()
            };
            actor.relationships.clear();
            actor.presence_role = if guest && index == 1 {
                pack_stories::PresenceRole::Npc
            } else {
                pack_stories::PresenceRole::Resident
            };
            actor.npc = None;
            actor
        })
        .collect();
    pack.characters[0].relationships = vec![characters::CharacterRelationship {
        target_id: "quality-1".into(),
        description: "하린은 별 관측법을 가르쳐 준 스승이라 존중한다.".into(),
        reply_lines: vec![],
    }];
    pack.pair_scenes.clear();
    pack.wordbook.clear();
    pack.sprites.clear();
    pack.animation_assets.clear();
    pack.archive = None;
    pack.world_rules =
        "관측소에서 함께 별을 보는 세계다. 조건부 지식에 없는 별 이름과 암호는 모른다.".into();
    pack.story_flags = vec![pack_stories::StoryFlag {
        id: "observed".into(),
        public: true,
    }];
    pack.knowledge = vec![
        pack_stories::ConditionalKnowledge {
            id: "shared-observation".into(),
            keywords: vec!["별 이름".into()],
            text: SHARED_FACT.into(),
            known_by: vec!["quality-0".into(), "quality-1".into(), "quality-2".into()],
            required_flags: vec!["observed".into()],
        },
        pack_stories::ConditionalKnowledge {
            id: "npc-private".into(),
            keywords: vec!["암호".into()],
            text: PRIVATE_KNOWLEDGE.into(),
            known_by: vec!["quality-1".into()],
            required_flags: vec![],
        },
    ];
    pack.scenarios.clear();
    let installed = characters::import_pack(&db, &pack)?;
    let ids = installed
        .iter()
        .map(|actor| actor.id.clone())
        .collect::<Vec<_>>();
    characters::apply_roster(
        &db,
        if guest {
            vec![ids[0].clone(), ids[2].clone()]
        } else {
            ids.clone()
        },
    )?;
    let old = Message {
        id: uuid::Uuid::new_v4().to_string(),
        role: "assistant".into(),
        persona: Some(ids[0].clone()),
        content: PRIVATE_HISTORY.into(),
        expression: Some("평온".into()),
        created_at: chrono::Utc::now().timestamp_millis() - 60_000,
        status: "complete".into(),
    };
    store::insert_message_with_source(&db, &old, "llm", None, true)?;
    store::mark_message_displayed(&db, &old.id, old.created_at)?;
    if unlocked {
        let scope = pack_stories::Scope {
            user_id: store::active_user_id(&db)?,
            pack_id: installed[0]
                .pack_id
                .clone()
                .ok_or("Missing synthetic pack")?,
            center_id: ids[0].clone(),
        };
        db.execute(
            "INSERT INTO pack_story_progress(scope,wait_turn,flags) VALUES(?1,0,?2)",
            rusqlite::params![
                serde_json::to_string(&scope).map_err(|error| error.to_string())?,
                "[\"observed\"]"
            ],
        )
        .map_err(|error| error.to_string())?;
    }
    Ok(ids)
}

async fn sample(
    state: &AppState,
    settings: &Settings,
    name: &str,
    guest: bool,
    unlocked: bool,
    question: &str,
    reports: &mut Vec<Value>,
) -> Result<(), String> {
    let ids = fixture(state, settings, guest, unlocked)?;
    let targets = if guest {
        ids[..2].to_vec()
    } else {
        ids.clone()
    };
    let input = Message {
        id: uuid::Uuid::new_v4().to_string(),
        role: "user".into(),
        persona: Some("all".into()),
        content: question.into(),
        expression: None,
        created_at: chrono::Utc::now().timestamp_millis(),
        status: "complete".into(),
    };
    let (prompt, selected, boundary) = {
        let db = lock(&state.db)?;
        store::insert_user_input(&db, &input, false)?;
        store::select_single_bundle_targets(&db, &input.id, &targets)?;
        if guest {
            let actor = characters::get(&db, &ids[0])?;
            let pack_id = actor.pack_id.ok_or("Missing synthetic pack")?;
            character_guests::admit_locked(
                state,
                &db,
                &character_guests::Admission {
                    run_id: uuid::Uuid::new_v4().to_string(),
                    request_id: input.id.clone(),
                    epoch: state.epoch.load(Ordering::SeqCst),
                    center_id: ids[0].clone(),
                    guest_ids: vec![ids[1].clone()],
                    pack_baseline: characters::pack_definition_baseline(&db, &pack_id)?,
                    pack_id,
                },
            )?;
            let ticket = character_guests::capture(
                state,
                &db,
                &targets,
                state.epoch.load(Ordering::SeqCst),
            )?;
            character_guests::hear_locked(state, &db, &ticket, &input.id)?;
        }
        let context = super::for_turn(state, &db, &targets, &input.id, 1600)?;
        let prompt = conversation::turn_prompt_for_state(state, &db, &targets, &input.id, &[])?;
        let text = serde_json::to_string(&prompt).map_err(|error| error.to_string())?;
        let expects_fact = unlocked && question.contains("별 이름");
        let boundary = json!({
            "sharedFactMatchesGate": text.contains(SHARED_FACT) == expects_fact,
            "privateKnowledgeExcluded": !text.contains(PRIVATE_KNOWLEDGE),
            "oldHistoryExcludedForGuest": !guest || !text.contains(PRIVATE_HISTORY),
            "guestMemoryDisabled": !guest || !context.allow_memories,
            "oneFrozenBundle": store::single_bundle_targets(&db, &input.id)?.as_ref() == Some(&targets),
        });
        (prompt, context.selected_knowledge_ids, boundary)
    };
    if !boundary
        .as_object()
        .is_some_and(|values| values.values().all(|value| value == &json!(true)))
    {
        reports.push(
            json!({"name":name,"prompt":prompt,"boundaries":boundary,"selectedKnowledge":selected}),
        );
        return Err(format!("{name}: prompt boundary failed"));
    }
    let start = Instant::now();
    let cancel = Arc::new(AtomicBool::new(false));
    let generated: Result<(Vec<SceneLine>, i64), String> = match tokio::time::timeout(
        Duration::from_secs(90),
        conversation::generate_turn(state, &targets, &input.id, cancel.clone()),
    )
    .await
    {
        Ok(result) => result,
        Err(_) => {
            cancel.store(true, Ordering::SeqCst);
            inference::stop_local(&state.inference).await;
            Err("90 second sample timeout".into())
        }
    };
    let ordered = generated.as_ref().is_ok_and(|(lines, _)| {
        lines.len() == targets.len()
            && lines
                .iter()
                .zip(&targets)
                .all(|(line, target)| &line.persona == target)
    });
    reports.push(json!({"name":name,"question":question,"targets":targets,"prompt":prompt,"selectedKnowledge":selected,"boundaries":boundary,"result":generated,"orderedBundle":ordered,"elapsedSeconds":start.elapsed().as_secs_f64(),"meaningReview":"Review the original Korean text manually; structural checks do not grade meaning."}));
    if !ordered {
        return Err(format!("{name}: generation or cast boundary failed"));
    }
    Ok(())
}

#[tokio::test]
#[ignore = "Actual stage6 GGUF quality samples; COMET_QA_MODEL and optional COMET_QA_OUTPUT_DIR; existing local files only"]
async fn actual_registered_cast_and_knowledge_quality() {
    let model =
        std::fs::canonicalize(std::env::var("COMET_QA_MODEL").expect("COMET_QA_MODEL is required"))
            .expect("Use an existing local GGUF");
    let temporary = tempfile::tempdir().unwrap();
    let mut state = crate::app::tests::state();
    state.app_data = temporary.path().into();
    let binaries = Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries");
    state.inference = inference::Inference::new(
        temporary.path().into(),
        binaries.join(
            crate::sidecar::development_executable("llama-server")
                .file_name()
                .unwrap(),
        ),
        binaries.join("runtime"),
    );
    state.nlp =
        crate::nlp::NlpService::new(temporary.path().into(), PathBuf::new(), PathBuf::new())
            .unwrap();
    let settings = Settings {
        local_model: LocalModel::Custom,
        local_model_path: model.to_string_lossy().into_owned(),
        ..Default::default()
    };
    let mut reports = Vec::new();
    let cases = [
        (
            "resident-three",
            false,
            true,
            "각자 자기 이름과 하린과의 관계를 자기 관점에서 한 문장으로 말해 줘.",
        ),
        (
            "guest-private",
            true,
            false,
            "너희가 아는 비밀 암호가 있어? 모르면 모른다고 각자 짧게 말해 줘.",
        ),
        (
            "locked-knowledge",
            true,
            false,
            "관측소의 별 이름이 뭐야? 모르면 모른다고 각자 한 문장으로 말해 줘.",
        ),
        (
            "unlocked-knowledge",
            true,
            true,
            "관측소의 별 이름이 뭐야? 각자 자기 말투로 한 문장씩 말해 줘.",
        ),
    ];
    let mut outcome = Ok(());
    for (name, guest, unlocked, question) in cases {
        if let Err(error) = sample(
            &state,
            &settings,
            name,
            guest,
            unlocked,
            question,
            &mut reports,
        )
        .await
        {
            outcome = Err(error);
        }
    }
    inference::stop_local(&state.inference).await;
    let running = inference::is_local_running(&state.inference, &settings).await;
    let output = std::env::var_os("COMET_QA_OUTPUT_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::temp_dir().join("comet-model-quality-qa"))
        .join("stage6-cast-knowledge.json");
    std::fs::create_dir_all(output.parent().unwrap()).unwrap();
    std::fs::write(&output, serde_json::to_vec_pretty(&json!({"model":model,"syntheticOnly":true,"runtimeStopped":!running,"outcome":outcome,"scope":"Current production bundle prompt and generate_turn; synthetic flags and roster; native presentation is separate.","samples":reports})).unwrap()).unwrap();
    println!("Stage6 actual model samples: {}", output.display());
    assert!(!running, "Owned inference process must stop");
    assert!(outcome.is_ok(), "Inspect {}: {outcome:?}", output.display());
    assert_eq!(reports.len(), 4);
}
