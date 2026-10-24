use crate::{
    app::{conversation, lock, AppState},
    characters, inference, memory_commands, store,
    types::{LocalModel, Message, Settings},
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

const USER_NAME: &str = "QA 사용자 1023";
// Original synthetic native-QA inputs from qa-model-memory-cases.json.
const CASES: [(&str, &str); 3] = [
    (
        "preference-instruction",
        "나는 커피를 좋아해. 대답은 두 문장으로 해 줘.",
    ),
    (
        "correction-quote-hypothetical",
        "정정할게. 나는 지금 커피를 좋아하지 않고 차를 좋아해. QA B가 “나는 커피를 좋아해”라고 한 것은 QA B의 말이야. 내가 배우라면 좋겠다는 것은 가정이고 내 실제 직업은 밝히지 않았어.",
    ),
    (
        "followup-use",
        "내가 지금 좋아하는 음료와 QA B가 말한 음료를 구별해 알려 줘.",
    ),
];
const TEA_FACT: &str = "나는 지금 커피를 좋아하지 않고 차를 좋아해.";
const RECORDED_COFFEE_SPEECH: &str = "나는 커피를 좋아해.";

fn qa_b() -> Result<characters::CharacterDefinition, String> {
    // Verbatim minimal profile from qa-archive-run7.comet-character.json, character-2.
    // Pack assets and the relationship to absent QA A are outside this single-character sample.
    serde_json::from_value(json!({
        "sourceId":"character-2",
        "name":"QA B",
        "description":"개인정보나 기존 캐릭터를 포함하지 않는 완전 합성 QA B.",
        "personality":"QA B는 배 주스를 좋아한다. 다른 인물의 취향과 구분한다.",
        "instructions":"등록 대사와 합성 설정의 화자·관계·공백·줄바꿈을 보존한다. 실제 사용자 사실로 주장하지 않는다.",
        "expressions":{"평온":"QA B 평온"},
        "greeting":[{"expression":"평온","text":"QA B 합성 인사입니다."}],
        "idleLines":[{"expression":"평온","text":"QA B 합성 쉬는 대사입니다."}]
    }))
    .map_err(|error| error.to_string())
}

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

async fn sample(
    state: &AppState,
    settings: &Settings,
    name: &str,
    question: &str,
    seed_fact: bool,
    seed_recorded_speech: bool,
) -> Result<Value, String> {
    let (target, session, seed, recorded_speech) = {
        let mut db = lock(&state.db)?;
        *db = store::open(Path::new(":memory:"))?;
        store::save_settings(&db, settings)?;
        let at = chrono::Utc::now().timestamp_millis();
        store::set_user_name(&db, USER_NAME, at)?;
        let target = characters::create(&db, &qa_b()?)?.id;
        let targets = std::slice::from_ref(&target);
        characters::apply_roster(&db, targets.to_vec())?;
        let seed = if seed_fact {
            let session = store::create_conversation(&db, targets, None, None, at)?;
            let source = user_message(&format!("{name}-synthetic-fact-source"), &target, TEA_FACT);
            store::insert_user_input(&db, &source, true)?;
            store::analyze_apply_batch(
                &db,
                &json!({
                    "revision":store::revision(&db)?,
                    "memories":[{"kind":"user_fact","certain":true,
                        "sourceMessageId":source.id,"evidence":TEA_FACT,"supersedesId":""}],
                    "events":[]
                }),
                std::slice::from_ref(&source.id),
            )?;
            Some(json!({"session":session,"message":source,
                "scope":"Synthetic extraction-result fixture, not an actual extraction sample"}))
        } else {
            None
        };
        // No continued_from: the follow-up cannot receive its seeded source as history.
        let session = store::create_conversation(&db, targets, None, None, at)?;
        let recorded_speech = if seed_recorded_speech {
            let speech = Message {
                id: format!("{name}-synthetic-stored-utterance"),
                role: "assistant".into(),
                persona: Some(target.clone()),
                content: RECORDED_COFFEE_SPEECH.into(),
                expression: Some("평온".into()),
                created_at: at,
                status: "complete".into(),
            };
            store::insert_message_with_source(&db, &speech, "llm", None, false)?;
            store::attach_conversation_message(&db, &session.id, &speech.id)?;
            store::mark_message_displayed_with_provenance(&db, &speech.id, at, Some(false))?;
            Some(speech)
        } else {
            None
        };
        store::insert_user_input(&db, &user_message(name, &target, question), true)?;
        store::select_single_bundle_targets(&db, name, targets)?;
        (target, session, seed, recorded_speech)
    };
    let targets = std::slice::from_ref(&target);
    let searched = memory_commands::search_for_turn(state, name).await?;
    let (prompt, prompt_context, user, character, history, raw_hits, facts, checks) = {
        let db = lock(&state.db)?;
        let at = chrono::Utc::now().timestamp_millis();
        let raw_hits = store::search_memories_for(&db, question, &[], None, targets, at)?;
        let facts = store::current_user_facts_for(&db, targets, at)?;
        let revalidated = store::revalidate_search_hits(&db, &searched)?;
        let prompt = conversation::turn_prompt_for_state(state, &db, targets, name, &revalidated)?;
        let user = store::require_user(&db)?;
        let character = characters::get(&db, &target)?;
        let history = store::conversation_context(&db, &session.id, &target)?;
        let context_message = prompt
            .get(1)
            .filter(|message| message.role == "user")
            .ok_or("The separated prompt has no user-role context message")?;
        let prompt_context: Value = serde_json::from_str(&context_message.content)
            .map_err(|error| format!("The separated prompt context is not JSON: {error}"))?;
        let character_settings = prompt_context["characterSettings"]
            .as_array()
            .ok_or("The prompt context has no characterSettings array")?;
        let prompt_facts = prompt_context["userFacts"]
            .as_array()
            .ok_or("The prompt context has no userFacts array")?;
        let references = prompt_context["memoryReferences"]
            .as_array()
            .ok_or("The prompt context has no memoryReferences array")?;
        let utterances = prompt_context["utteranceRecords"]
            .as_array()
            .ok_or("The prompt context has no utteranceRecords array")?;
        let mut checks = json!({
            "pastSpeechStatusMatchesSuppliedSpeakerRecords":prompt_context["pastSpeechStatus"]
                == if seed_recorded_speech { "records_only" } else { "unknown" },
            "currentUserIdInSystem":prompt.iter().any(|message| message.role=="system" && message.content.contains(&user.id)),
            "singleBundleSelected":store::single_bundle_selected(&db, name)?,
            "querySessionHasNoParent":session.continued_from.is_none(),
            "queryIsOnlyHistoryMessage":history.len()==1 && history[0].id==name,
            "latestUserPreserved":prompt.get(2).is_some_and(|message| message.role=="user" && message.content==question),
            "noEarlierHistoryInPrompt":prompt.len()==3 && prompt[0].role=="system"
                && prompt[1].role=="user" && prompt[2].role=="user" && utterances.is_empty(),
            "requestedActorInCharacterSettings":character_settings.len()==1
                && character_settings[0]["persona"]==target
                && character_settings[0]["name"]==character.definition.name
                && character_settings[0]["personality"]==character.definition.personality,
            "factsBelongToCurrentUserAndCharacter":facts.iter().all(|fact|
                fact.user_id==user.id && fact.character_id==target && fact.retired_at.is_none()),
            "allBoundedFactsInUserFacts":prompt_facts.len()==facts.len() && facts.iter().all(|fact|
                prompt_facts.iter().any(|data| data["id"]==fact.id
                    && data["sourceMessageId"]==fact.source_message_id
                    && data["keeperCharacterId"]==fact.character_id
                    && data["subjectUserId"]==fact.user_id
                    && data["text"]==fact.content && data["sourceText"]==fact.source_text)),
            "promptFactsHaveCurrentUserMetadata":prompt_facts.iter().all(|data|
                data["subjectUserId"]==user.id && data["keeperCharacterId"]==target
                    && data["userName"]==user.name && data["kind"]=="user_fact"
                    && data["personContext"]=="current_user" && data["usableAsCurrentUserFact"]==true),
            "noReferenceMemoriesInIsolatedSample":references.is_empty(),
            "noActualUtteranceRecordsInIsolatedSample":utterances.is_empty(),
            "seededSourceIdsMatch":!seed_fact || (facts.len()==1 && facts[0].source_message_id==format!("{name}-synthetic-fact-source")),
        });
        if let Some(speech) = &recorded_speech {
            let checks = checks.as_object_mut().unwrap();
            checks.remove("queryIsOnlyHistoryMessage");
            checks.remove("noEarlierHistoryInPrompt");
            checks.remove("noActualUtteranceRecordsInIsolatedSample");
            checks.extend(
                json!({
                    "queryHistoryHasOnlySyntheticSpeechThenLatest":history.len()==2
                        && history[0].id==speech.id && history[0].role=="assistant"
                        && history[0].persona.as_deref()==Some(target.as_str())
                        && history[0].content==RECORDED_COFFEE_SPEECH
                        && history[1].id==name && history[1].role=="user"
                        && history[1].content==question,
                    "separatedPromptShape":prompt.len()==3 && prompt[0].role=="system"
                        && prompt[1].role=="user" && prompt[2].role=="user",
                    "syntheticStoredSpeechIsOnlyUtteranceRecord":utterances.len()==1
                        && utterances[0]==json!({"id":speech.id,
                            "speaker":{"role":"assistant","characterId":target},
                            "text":RECORDED_COFFEE_SPEECH,"partial":false}),
                })
                .as_object()
                .unwrap()
                .clone(),
            );
        }
        (
            prompt,
            prompt_context,
            user,
            character,
            history,
            raw_hits,
            facts,
            checks,
        )
    };
    let started = Instant::now();
    let cancel = Arc::new(AtomicBool::new(false));
    // No fixture mutation between this same-gate prompt capture and production generation.
    let result = tokio::time::timeout(
        Duration::from_secs(120),
        conversation::generate_turn(state, targets, name, cancel.clone()),
    )
    .await;
    let result = match result {
        Ok(result) => result,
        Err(_) => {
            cancel.store(true, Ordering::SeqCst);
            inference::stop_local(&state.inference).await;
            Err("120 second sample timeout".into())
        }
    };
    let identifiers_match = result.as_ref().is_ok_and(|(lines, _)| {
        lines.len() == targets.len()
            && lines
                .iter()
                .zip(targets)
                .all(|(line, target)| &line.persona == target)
    });
    let recall_dependencies: Vec<(String, i64)> = {
        let db = lock(&state.db)?;
        let mut query = db
            .prepare("SELECT memory_id,content_version FROM recall_dependencies WHERE key=?1 ORDER BY memory_id")
            .map_err(|error| error.to_string())?;
        let rows = query
            .query_map([conversation::reply_id(name, &target)], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .map_err(|error| error.to_string())?;
        rows.collect::<rusqlite::Result<_>>()
            .map_err(|error| error.to_string())?
    };
    Ok(json!({
        "name":name,"question":question,"user":user,"character":character,"session":session,
        "seed":seed,"historyBeforeGeneration":history,
        "syntheticStoredUtteranceFixture":recorded_speech.as_ref().map(|speech| json!({
            "message":speech,"scope":"Synthetic stored utterance control; not observed or model-generated speech"})),
        "rawLexicalHits":raw_hits,"rawLexicalHitCount":raw_hits.len(),
        "searchForTurnHits":searched,"searchForTurnHitCount":searched.len(),
        "currentUserFacts":facts,"promptContext":prompt_context,
        "promptFormat":"single-character system rules, user context JSON, raw latest user input","prompt":prompt,
        "promptCaptureScope":"Same gated separated-context builder before generate_turn; not a network delivery receipt",
        "recallDependencies":recall_dependencies,
        "recallDependencyScope":"Conservative selected-context dependencies; not final prompt delivery proof",
        "nlpStatus":state.nlp.status(),"elapsedSeconds":started.elapsed().as_secs_f64(),
        "checks":checks,"responseJsonAndIdentifiersValid":identifiers_match,"result":result,
        "meaningReview":if seed_recorded_speech {
            "Required manual review: distinguish the user's Tea fact, QA B's synthetic stored Coffee utterance, and QA B's Pear profile. The utterance fixture is not an actual observation or model-generated speech. No semantic pass is asserted."
        } else {
            "Required manual review of response text: user/QA B speaker attribution; latest correction; no invented occupation or user speech. For the isolated follow-up, the old QA B coffee quote is unavailable: unknown is allowed, profile preference alone does not prove what QA B said. No semantic pass is asserted."
        }
    }))
}

#[tokio::test]
#[ignore = "Actual GGUF attribution samples; set COMET_QA_MODEL; optional COMET_QA_REPEAT, COMET_QA_OUTPUT_DIR, COMET_QA_BINARIES; no downloads"]
async fn actual_model_attribution_samples() {
    run_attribution_samples(false).await;
}

#[tokio::test]
#[ignore = "Actual GGUF synthetic stored utterance control; set COMET_QA_MODEL; optional COMET_QA_REPEAT, COMET_QA_OUTPUT_DIR, COMET_QA_BINARIES; no downloads"]
async fn actual_model_recorded_utterance_samples() {
    run_attribution_samples(true).await;
}

async fn run_attribution_samples(recorded_control: bool) {
    let model = std::fs::canonicalize(std::env::var("COMET_QA_MODEL").expect("COMET_QA_MODEL"))
        .expect("Use an existing GGUF file");
    assert!(model.is_file());
    let repeat: usize = std::env::var("COMET_QA_REPEAT")
        .map_or(Ok(2), |value| value.parse())
        .expect("COMET_QA_REPEAT must be a positive integer");
    assert!(repeat > 0);
    let directory = tempfile::tempdir().unwrap();
    let binaries = std::env::var_os("COMET_QA_BINARIES")
        .map(PathBuf::from)
        .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries"));
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
    // Cold lexical-only fixture: native Kiwi/semantic configuration is a separate QA scope.
    state.nlp =
        crate::nlp::NlpService::new(directory.path().into(), PathBuf::new(), PathBuf::new())
            .unwrap();
    let settings = Settings {
        local_model: LocalModel::Custom,
        local_model_path: model.to_string_lossy().into_owned(),
        local_reasoning_enabled: false,
        ..Settings::default()
    };
    let mut samples = Vec::new();
    let cases = if recorded_control {
        &CASES[2..]
    } else {
        &CASES
    };
    for &(case, question) in cases {
        for index in 0..repeat {
            let name = if recorded_control {
                format!("recorded-utterance-{case}-{index}")
            } else {
                format!("{case}-{index}")
            };
            samples.push(
                sample(
                    &state,
                    &settings,
                    &name,
                    question,
                    case == "followup-use",
                    recorded_control,
                )
                .await
                .unwrap_or_else(|error| json!({"name":name,"error":error})),
            );
        }
    }
    inference::stop_local(&state.inference).await;
    let running = inference::is_local_running(&state.inference, &settings).await;
    let output_directory = std::env::var_os("COMET_QA_OUTPUT_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    std::fs::create_dir_all(&output_directory).unwrap();
    let prefix = if recorded_control {
        "model-recorded-utterance"
    } else {
        "model-attribution"
    };
    let output = output_directory.join(format!("{prefix}-{}.json", uuid::Uuid::new_v4()));
    std::fs::write(
        &output,
        serde_json::to_vec_pretty(&json!({
            "model":model,"settings":settings,"repeat":repeat,"syntheticOnly":true,
            "scope":if recorded_control {
                "Actual production generate_turn/inference with isolated in-memory storage; the follow-up uses a synthetic Tea extraction-result fixture and a synthetic stored Coffee utterance, not observed/model-generated speech. No native UI, extraction, Kiwi/semantic QA or semantic quality pass is claimed."
            } else {
                "Actual production generate_turn/inference with isolated in-memory storage; case3 memory is a synthetic extraction-result fixture. No native UI, extraction, Kiwi/semantic QA or semantic quality pass is claimed."
            },
            "characterSource":"qa-archive-run7.comet-character.json#characters[sourceId=character-2] minimal profile; omitted assets and relationships",
            "inputSource":"qa-model-memory-cases.json#turns verbatim",
            "generationBranch":"single-bundle, matching the current normal input route",
            "ownedRuntimeStopped":!running,"samples":samples
        }))
        .unwrap(),
    )
    .unwrap();
    println!("Attribution samples: {}", output.display());
    assert!(!running, "The harness-owned local runtime did not stop");
    assert!(
        samples.iter().all(|sample| {
            sample["responseJsonAndIdentifiersValid"] == true
                && sample["checks"]
                    .as_object()
                    .is_some_and(|checks| checks.values().all(|check| check == true))
        }),
        "Inspect attribution sample JSON: structural boundary or generation failure"
    );
}
