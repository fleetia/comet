use crate::{
    app::{background, conversation, interrupt, lock, scene, AppState},
    characters, domain, inference, memory_commands, store, story,
    types::{LocalModel, Message, SceneLine, Settings},
};
use serde_json::{json, Value};
use std::{
    fs::File,
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

fn counts_from_environment() -> Result<Vec<usize>, String> {
    let raw = std::env::var("COMET_QA_COUNTS").unwrap_or_else(|_| "1,2,3,8".into());
    if raw == "1..8" {
        return Ok((1..=8).collect());
    }
    let mut counts = Vec::new();
    for value in raw.split(',') {
        let count = value
            .trim()
            .parse::<usize>()
            .map_err(|_| "COMET_QA_COUNTS must contain counts from 1 to 8")?;
        if !(1..=8).contains(&count) || counts.contains(&count) {
            return Err("COMET_QA_COUNTS must contain unique counts from 1 to 8".into());
        }
        counts.push(count);
    }
    Ok(counts)
}

fn write_sample(output: &mut File, report: &Value) -> Result<(), String> {
    serde_json::to_writer(&mut *output, report).map_err(|error| error.to_string())?;
    output.write_all(b"\n").map_err(|error| error.to_string())?;
    output.sync_data().map_err(|error| error.to_string())
}

fn prepare_roster(
    state: &AppState,
    settings: &Settings,
    count: usize,
) -> Result<Vec<String>, String> {
    let mut db = lock(&state.db)?;
    *db = store::open(Path::new(":memory:"))?;
    store::save_settings(&db, settings)?;
    store::set_user_name(&db, "공통검증자", chrono::Utc::now().timestamp_millis())?;
    let template = characters::factory_pack().characters.remove(0);
    let names = [
        "다온", "하린", "누리", "소담", "한울", "유담", "라온", "서하",
    ];
    let mut ids = Vec::new();
    for (index, name) in names.iter().take(count).enumerate() {
        let mut definition = template.clone();
        definition.source_id = format!("synthetic-roster-{index}");
        definition.name = (*name).into();
        definition.description = format!("이름이 {name}인 합성 검증 캐릭터다.");
        definition.personality = "한국어 반말로 짧고 자연스럽게 대화한다.".into();
        definition.instructions = if index == 0 {
            "모든 대사의 첫머리를 반짝!으로 시작한다.".into()
        } else {
            String::new()
        };
        definition.relationships.clear();
        ids.push(characters::create(&db, &definition)?.id);
    }
    if let [first, second, ..] = ids.as_slice() {
        let mut definition = characters::get(&db, first)?.definition;
        definition.relationships = vec![characters::CharacterRelationship {
            target_id: second.clone(),
            description: format!("{}은 내가 별 보는 법을 배우는 스승이라 존중한다.", names[1]),
        }];
        characters::save(&db, first, &definition)?;
    }
    characters::apply_roster(&db, ids.clone())?;
    Ok(ids)
}

async fn direct_sample(
    state: &AppState,
    settings: &Settings,
    count: usize,
    output: &mut File,
) -> Result<(), String> {
    let targets = prepare_roster(state, settings, count)?;
    let name = format!("direct-{count}");
    let question = if count == 2 {
        "너희 이름과 상대를 어떤 사이로 생각하는지 각자 자기 관점에서 한 문장으로 말해 줘."
    } else {
        "각자 자기 이름과 오늘 하고 싶은 일을 한 문장으로 말해 줘."
    };
    {
        let db = lock(&state.db)?;
        store::insert_message(
            &db,
            &Message {
                id: name.clone(),
                role: "user".into(),
                persona: Some("all".into()),
                content: question.into(),
                expression: None,
                created_at: chrono::Utc::now().timestamp_millis(),
                status: "complete".into(),
            },
        )?;
    }
    let (epoch, cancel) = {
        let _action = lock(&state.action)?;
        interrupt(state, false)?
    };
    // Matches run_turn's grouping; native presentation and its timing are outside this harness.
    let groups = if count <= 2 {
        vec![targets.clone()]
    } else {
        targets.iter().map(|id| vec![id.clone()]).collect()
    };
    let mut shown = 0;
    let mut previous_line: Option<SceneLine> = None;
    for (index, group) in groups.iter().enumerate() {
        let hits = memory_commands::search_for_turn(state, &name).await?;
        let (prompt, roster, prior_reply, boundaries) = {
            let db = lock(&state.db)?;
            let memories = store::revalidate_search_hits(&db, &hits)?;
            let prompt = conversation::turn_prompt_with_memories(&db, group, &name, &memories)?;
            let mut stored_with_identity = true;
            let mut included_in_prompt = true;
            let prior_reply = if let Some(previous) = &previous_line {
                let id = conversation::reply_id(&name, &previous.persona);
                stored_with_identity = store::messages(&db, 20)?.iter().any(|message| {
                    message.id == id
                        && message.role == "assistant"
                        && message.status == "complete"
                        && message.persona.as_ref() == Some(&previous.persona)
                        && message.content == previous.text
                });
                let prefix = format!("[{}] ", previous.persona);
                let included = prompt.iter().find(|message| {
                    message.role == "assistant"
                        && message
                            .content
                            .strip_prefix(&prefix)
                            .is_some_and(|text| !text.is_empty() && previous.text.starts_with(text))
                });
                included_in_prompt = included.is_some();
                Some(json!({"id":id,"original":previous,"includedMessage":included}))
            } else {
                None
            };
            (
                prompt,
                characters::active_members(&db)?,
                prior_reply,
                json!({
                    "syntheticMemoriesEmpty":hits.is_empty(),
                    "priorReplyStoredWithIdentity":stored_with_identity,
                    "priorReplyIncludedAsAssistant":included_in_prompt
                }),
            )
        };
        if !boundaries
            .as_object()
            .is_some_and(|checks| checks.values().all(|value| value == &json!(true)))
        {
            write_sample(
                output,
                &json!({
                    "name":name,"groupIndex":index,"rosterCount":count,"prompt":prompt,
                    "priorReply":prior_reply,"boundaries":boundaries,
                    "error":"Synthetic history boundary failed before generation"
                }),
            )?;
            return Err("Synthetic history boundary failed before generation".into());
        }
        let started = Instant::now();
        let result = match tokio::time::timeout(
            Duration::from_secs(90),
            conversation::generate_turn(state, group, &name, cancel.clone()),
        )
        .await
        {
            Ok(result) => result,
            Err(_) => {
                cancel.store(true, Ordering::SeqCst);
                inference::stop_local(&state.inference).await;
                Err("90 second direct sample timeout".into())
            }
        };
        write_sample(
            output,
            &json!({
                "name":name,"groupIndex":index,"rosterCount":count,"targets":group,
                "roster":roster,"prompt":prompt,"result":result,
                "priorReply":prior_reply,"boundaries":boundaries,
                "elapsedSeconds":started.elapsed().as_secs_f64(),
                "meaningReview":"manual: speaker identity, Korean, length, repetition, first speaker guidance; pair relationship is directional",
                "rawResponseLimit":"generate_turn exposes parsed lines or an error, not invalid wire response text"
            }),
        )?;
        let (lines, revision) = result?;
        for line in &lines {
            if !scene::present_line(
                state,
                line,
                "llm",
                &conversation::reply_id(&name, &line.persona),
                shown,
                targets.len(),
                revision,
                epoch,
                &cancel,
                true,
            )? {
                return Err("Synthetic direct reply was rejected before history insertion".into());
            }
            shown += 1;
            previous_line = Some(line.clone());
        }
    }
    if shown != count {
        return Err(format!("Expected {count} replies, recorded {shown}"));
    }
    Ok(())
}

async fn automatic_sample(
    state: &AppState,
    settings: &Settings,
    count: usize,
    question: bool,
    output: &mut File,
) -> Result<(), String> {
    let targets = prepare_roster(state, settings, count)?;
    let name = format!(
        "automatic-{count}-{}",
        if question { "question" } else { "chatter" }
    );
    let (prompt, roster) = {
        let db = lock(&state.db)?;
        let members = characters::active_members(&db)?
            .into_iter()
            .map(|mut member| {
                member.definition = story::profile(&db, member.clone())?;
                Ok(member)
            })
            .collect::<Result<Vec<_>, String>>()?;
        let memories = store::idle_memories(&db, chrono::Utc::now().timestamp_millis())?;
        let relationships = store::relationships(&db)?;
        let installed = characters::collection(&db)?.installed;
        (
            domain::with_user_context(
                domain::roster_scene_prompt(
                    &members,
                    &memories,
                    &relationships,
                    question,
                    &installed,
                ),
                store::current_user(&db)?.as_ref(),
            ),
            members,
        )
    };
    let (minimum, maximum) = if count == 1 { (1, 1) } else { (2, 4) };
    let cancel = Arc::new(AtomicBool::new(false));
    state
        .next_idle
        .store(crate::app::now() + 45, Ordering::SeqCst);
    let started = Instant::now();
    let generated = background::background_generate(
        state,
        settings,
        &prompt,
        domain::scene_schema_for(&targets, minimum, maximum),
        512,
        cancel,
    )
    .await;
    let parsed = generated
        .clone()
        .and_then(|value| domain::parse_lines_for(value, &targets, minimum, maximum, false));
    write_sample(
        output,
        &json!({
            "name":name,"rosterCount":count,"question":question,"roster":roster,
            "prompt":prompt,"generated":generated,"result":parsed,
            "elapsedSeconds":started.elapsed().as_secs_f64(),
            "meaningReview":"manual: one sentence per line, Korean, no invented user reply, guidance and directional relationship",
            "scope":"production automatic prompt, generation deadline and parser; scheduling, permission gates, native presentation and saving prepared scenes are not exercised",
            "rawResponseLimit":"inference exposes JSON values or an error, not invalid wire response text"
        }),
    )?;
    parsed.map(|_| ())
}

async fn run_samples(
    state: &AppState,
    settings: &Settings,
    counts: &[usize],
    output: &mut File,
) -> Vec<Value> {
    let mut outcomes = Vec::new();
    for count in counts {
        let outcome = direct_sample(state, settings, *count, output).await;
        outcomes.push(json!({"name":format!("direct-{count}"),"result":outcome}));
    }
    for (count, question) in [(1, false), (1, true), (2, false)] {
        let outcome = automatic_sample(state, settings, count, question, output).await;
        outcomes.push(json!({"name":format!("automatic-{count}-{question}"),"result":outcome}));
    }
    outcomes
}

#[tokio::test]
#[ignore = "requires an existing real GGUF; records samples for manual meaning review"]
async fn actual_model_roster_and_guidance_smoke() {
    let model = PathBuf::from(std::env::var_os("COMET_QA_MODEL").expect("Set COMET_QA_MODEL"));
    assert!(
        model.is_absolute() && model.is_file(),
        "Use an existing absolute GGUF path"
    );
    let counts = counts_from_environment().expect("Invalid roster counts");
    let temporary = tempfile::tempdir().unwrap();
    let output_root = std::env::var_os("COMET_QA_OUTPUT_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::temp_dir().join("comet-model-roster-qa"));
    let output_directory = output_root.join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&output_directory).unwrap();
    let sample_path = output_directory.join("roster-samples.ndjson");
    let mut output = File::create(&sample_path).unwrap();
    let binaries = Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries");
    let executable = if cfg!(windows) {
        "llama-server-x86_64-pc-windows-msvc.exe"
    } else {
        "llama-server-aarch64-apple-darwin"
    };
    let mut state = super::state();
    state.app_data = temporary.path().into();
    state.inference = inference::Inference::new(
        temporary.path().into(),
        binaries.join(executable),
        binaries.join("runtime"),
    );
    state.nlp =
        crate::nlp::NlpService::new(temporary.path().into(), PathBuf::new(), PathBuf::new())
            .unwrap();
    let settings = Settings {
        local_model: LocalModel::Custom,
        local_model_path: model.to_string_lossy().into_owned(),
        local_idle_enabled: true,
        ..Settings::default()
    };
    let outcomes = run_samples(&state, &settings, &counts, &mut output).await;
    inference::stop_local(&state.inference).await;
    let running = inference::is_local_running(&state.inference, &settings).await;
    let complete = outcomes
        .iter()
        .all(|outcome| outcome["result"].get("Ok").is_some());
    let summary_path = output_directory.join("roster-summary.json");
    std::fs::write(
        &summary_path,
        serde_json::to_vec_pretty(&json!({
            "model":model,"counts":counts,"syntheticOnly":true,"runtimeStopped":!running,
            "allScenariosGenerated":complete,"outcomes":outcomes,
            "meaningQuality":"ungraded; review original response text manually",
            "scope":"production direct generation and synthetic present_line history without display receipts; production automatic prompt/generation/parser; no native UI verification",
            "directSearchScope":"Each group invokes generate_turn's search again instead of run_turn's one captured search; the fixture asserts empty memories for equivalence",
            "samples":sample_path
        })).unwrap(),
    ).unwrap();
    println!("Actual roster model samples: {}", summary_path.display());
    assert!(!running, "Owned runtime must stop");
    assert!(
        complete,
        "Inspect generation errors in {}",
        summary_path.display()
    );
}
