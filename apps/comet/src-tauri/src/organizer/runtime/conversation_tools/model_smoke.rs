//! Actual GGUF samples of the #192 chat requests through the production path: Kiwi reading,
//! selection, planning, registry execution and the character reply. There is no app window, so
//! window refreshes are skipped and widget-opening or generated actions are reported instead of
//! run. These are harness samples, not native E2E results.

use super::*;
use crate::{
    app::conversation,
    characters, inference,
    nlp::{ModelKind, NlpService},
    types::{LocalModel, Settings},
};
use std::{
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

enum Expect {
    Note(&'static str, &'static str),
    Task(&'static str, &'static str),
    NoWrite,
    /// The task exists and is marked complete.
    Completed(&'static str),
    /// No task has this title.
    Removed(&'static str),
    /// An expense of this amount was recorded.
    Expense(u64),
    /// Values that depend on the run date or wording; judged by reading the sample.
    Review,
}

/// #192 inputs kept verbatim. The issue never sent the Korean N2 follow-up, so that line is this
/// harness's translation of the English one.
const CHAINS: &[(&str, &[(&str, Expect)])] = &[
    (
        "ko-n1-note",
        &[
            (
                "제목이 QA-N1이고 본문이 정확히 First line.인 다이어리 메모를 만들어줘.",
                Expect::Note("QA-N1", "First line."),
            ),
            ("다이어리 메모 중에 QA-N1 보여줘.", Expect::NoWrite),
        ],
    ),
    (
        "ko-n2-no-record",
        &[
            (
                "내일 점심에 12000원을 쓸 수도 있어. 지출로 기록하지 마.",
                Expect::NoWrite,
            ),
            (
                "친구가 \"점심에 12000원 썼어\"라고 했어. 누가 쓴 건지 말해 줘. 아무것도 기록하지 마.",
                Expect::NoWrite,
            ),
        ],
    ),
    (
        "ko-n3-task",
        &[
            (
                "마감일 2026-11-06인 QA-T1 할 일을 추가해줘.",
                Expect::Task("QA-T1", "2026-11-06"),
            ),
            ("QA-T1 할 일을 보여줘.", Expect::NoWrite),
            (
                "QA-T1 할 일의 마감일만 2026-11-07로 바꿔줘.",
                Expect::Task("QA-T1", "2026-11-07"),
            ),
        ],
    ),
    (
        "en-n1-note",
        &[
            (
                "Create a diary note titled QA-N1 with exactly this body: First line.",
                Expect::Note("QA-N1", "First line."),
            ),
            ("Read the diary note titled QA-N1.", Expect::NoWrite),
        ],
    ),
    (
        "en-n2-no-record",
        &[
            (
                "I might spend 12000 KRW on lunch tomorrow. Do not record an expense.",
                Expect::NoWrite,
            ),
            (
                "My friend said, \"I spent 12000 KRW on lunch.\" Tell me who spent it, without recording anything.",
                Expect::NoWrite,
            ),
        ],
    ),
    (
        "en-n3-task",
        &[
            (
                "Add a task titled QA-T1, due on 2026-11-06.",
                Expect::Task("QA-T1", "2026-11-06"),
            ),
            ("Show the task QA-T1.", Expect::NoWrite),
            (
                "Change only the due date of task QA-T1 to 2026-11-07.",
                Expect::Task("QA-T1", "2026-11-07"),
            ),
        ],
    ),
    // The rules leave these to the model planner: a clock time, a completed expense statement and
    // a typo that only Kiwi's correction reads as a request.
    (
        "ko-planner-time",
        &[("내일 오후 3시에 치과 가기 할 일 추가해줘.", Expect::Review)],
    ),
    (
        "ko-planner-expense",
        &[("어제 점심에 김밥 사 먹고 4500원 썼어.", Expect::Review)],
    ),
    (
        "ko-planner-typo",
        &[("우유 사기 할일 추가헤줘.", Expect::Review)],
    ),
    // Holdout v1: written before the first run; its failures were fixed on 2026-10-25, so these
    // chains are calibration now.
    (
        "ko-holdout-task-lifecycle",
        &[
            (
                "마감일 2026-11-20인 QA-T2 할 일을 추가해줘.",
                Expect::Task("QA-T2", "2026-11-20"),
            ),
            ("QA-T2 할 일 완료로 표시해 줘", Expect::Completed("QA-T2")),
            ("QA-T2 할 일 지워 줘", Expect::Removed("QA-T2")),
        ],
    ),
    (
        "ko-holdout-relative-dates",
        &[
            ("다음 주 금요일까지 보고서 제출 할 일 추가해 줘", Expect::Review),
            (
                "오늘 저녁 7시 반에 엄마한테 전화하기 할 일로 넣어 둬",
                Expect::Review,
            ),
        ],
    ),
    (
        "ko-holdout-ledger",
        &[
            ("커피 4천 원 썼어", Expect::Expense(4000)),
            ("이번 달 지출 얼마야?", Expect::NoWrite),
        ],
    ),
    (
        "ko-holdout-quoted-note",
        &[("다이어리에 '오늘 산책 30분 했다' 메모 남겨 줘", Expect::Review)],
    ),
    // Holdout v2: written after those fixes and before any run; its two failures were fixed on
    // 2026-10-25 too, so these chains are calibration now.
    (
        "ko-holdout2-labeled-note",
        &[
            (
                "제목은 장보기, 내용은 우유와 계란으로 다이어리 메모 만들어 줘",
                Expect::Note("장보기", "우유와 계란"),
            ),
            ("장보기 메모 보여 줘", Expect::NoWrite),
        ],
    ),
    (
        "ko-holdout2-polite-plan",
        &[(
            "다음 주 월요일에 분리수거하기 할 일 등록 부탁해",
            Expect::Review,
        )],
    ),
    (
        "ko-holdout2-expense",
        &[("어제 택시비로 12,000원 냈어", Expect::Expense(12000))],
    ),
    (
        "ko-holdout2-chat",
        &[("요즘 너무 피곤해. 힘내라고 한마디 해 줘", Expect::NoWrite)],
    ),
    (
        "ko-holdout2-negated",
        &[("방금 말한 건 할 일로 추가하지 마", Expect::NoWrite)],
    ),
    (
        "ko-holdout2-week",
        &[
            (
                "이번 주 금요일까지 발표 자료 만들기 할 일 추가해 줘",
                Expect::Review,
            ),
            ("이번 주 할 일 뭐 있어?", Expect::NoWrite),
        ],
    ),
];

/// [`direct`] without a window: the same planning, then registry operations only.
async fn direct_without_window(
    state: &AppState,
    input: &str,
    cancel: Arc<AtomicBool>,
) -> Result<bool, String> {
    let epoch = state.epoch.load(Ordering::SeqCst);
    let (user, mut turn) = match plan(state, input, epoch, cancel.clone()).await? {
        Planned::Done(handled) => return Ok(handled),
        Planned::Execute { user, turn } => (user, turn),
    };
    for index in 0..turn.operations.len() {
        if turn.operations[index].result.is_some() {
            continue;
        }
        let proposal = turn.operations[index].proposal.clone();
        let result = (|| {
            let spec = capability(&catalog(&*lock(&state.db)?)?, &proposal.kind)?.clone();
            authorize(&turn.request, &spec, &proposal, turn.explicit())?;
            if proposal.kind.starts_with("generated:")
                || matches!(
                    proposal.kind.as_str(),
                    "ball_open" | "paper_plane_open" | "interaction_open"
                )
            {
                return Err(format!("{} needs an app window", proposal.kind));
            }
            let value = serde_json::from_str(&proposal.input_json).map_err(|e| e.to_string())?;
            registry_operation(
                state,
                &user,
                input,
                index,
                &turn.request,
                &proposal,
                &spec,
                value,
                epoch,
                &cancel,
            )
        })();
        let _action = lock(&state.action)?;
        let db = lock(&state.db)?;
        match result {
            Ok(result) => {
                accept_result(&mut turn, index, result);
                save_turn(&db, &user, input, &turn)?;
            }
            Err(error) => {
                turn.state = "failed".into();
                turn.error = Some(error.clone());
                save_turn(&db, &user, input, &turn)?;
                return Err(error);
            }
        }
    }
    Ok(true)
}

fn records(db: &Connection) -> Result<Value, String> {
    let rows = |kind: &str, field: &str| -> Result<Value, String> {
        Ok(actions::query_registry(db, kind, &json!({}))?[field].clone())
    };
    Ok(json!({
        "notes": rows("note_query", "notes")?,
        "tasks": rows("task_query", "items")?,
        "ledger": rows("ledger_query", "ledgerEntries")?,
    }))
}

fn check(expect: &Expect, before: &Value, after: &Value, receipts: usize) -> Value {
    let named = |field: &str, title: &str| -> Vec<Value> {
        after[field]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|row| row["title"] == title)
            .cloned()
            .collect()
    };
    let (pass, detail) = match expect {
        Expect::Note(title, body) => {
            let notes = named("notes", title);
            (
                receipts > 0 && notes.len() == 1 && notes[0]["body"] == *body,
                format!("note {title} with body {body:?}"),
            )
        }
        Expect::Task(title, due) => {
            let tasks = named("tasks", title);
            (
                receipts > 0 && tasks.len() == 1 && tasks[0]["dueDate"] == *due,
                format!("one task {title} due {due}"),
            )
        }
        Expect::NoWrite => (receipts == 0 && before == after, "no write".to_owned()),
        Expect::Completed(title) => {
            let tasks = named("tasks", title);
            (
                receipts > 0 && tasks.len() == 1 && tasks[0]["completedAt"].is_i64(),
                format!("task {title} completed"),
            )
        }
        Expect::Removed(title) => (
            receipts > 0 && named("tasks", title).is_empty(),
            format!("task {title} removed"),
        ),
        Expect::Expense(amount) => {
            let rows = after["ledger"].as_array().cloned().unwrap_or_default();
            (
                receipts > 0
                    && rows
                        .iter()
                        .any(|row| row["amount"] == *amount && row["kind"] == "expense"),
                format!("expense of {amount} won"),
            )
        }
        Expect::Review => return json!({"pass": null, "expected": "manual review"}),
    };
    json!({"pass": pass, "expected": detail})
}

async fn chain(
    state: &AppState,
    settings: &Settings,
    widgets: &Path,
    name: &str,
    steps: &[(&str, Expect)],
) -> Result<Value, String> {
    let target = {
        let mut db = lock(&state.db)?;
        *db = store::open(Path::new(":memory:"))?;
        store::save_settings(&db, settings)?;
        store::set_user_name(&db, "QA", chrono::Utc::now().timestamp_millis())?;
        let installed = characters::import_pack(&db, &characters::byulkkori_pack())?;
        let target = installed[0].id.clone();
        characters::apply_roster(&db, vec![target.clone()])?;
        crate::widgets::storage::install(
            &db,
            widgets,
            &["todo".into(), "memo".into(), "calendar".into()],
        )?;
        target
    };
    let mut turns = vec![];
    for (index, (input, expect)) in steps.iter().enumerate() {
        let id = format!("{name}-{index}");
        let before = {
            let db = lock(&state.db)?;
            store::insert_message(
                &db,
                &Message {
                    id: id.clone(),
                    role: "user".into(),
                    persona: Some(target.clone()),
                    content: (*input).into(),
                    expression: None,
                    created_at: chrono::Utc::now().timestamp_millis(),
                    status: "complete".into(),
                },
            )?;
            records(&db)?
        };
        let cancel = Arc::new(AtomicBool::new(false));
        let started = Instant::now();
        let organized = tokio::time::timeout(
            Duration::from_secs(300),
            direct_without_window(state, &id, cancel.clone()),
        )
        .await
        .unwrap_or_else(|_| Err("300 second organizer timeout".into()));
        let organizer_seconds = started.elapsed().as_secs_f64();
        // The app shows the error and skips the reply when the organizer fails.
        let reply = match &organized {
            Ok(true) => Some(
                tokio::time::timeout(
                    Duration::from_secs(180),
                    conversation::generate_turn(state, std::slice::from_ref(&target), &id, cancel),
                )
                .await
                .unwrap_or_else(|_| Err("180 second reply timeout".into()))
                .map(|(lines, _)| lines.into_iter().map(|line| line.text).collect::<Vec<_>>()),
            ),
            _ => None,
        };
        let db = lock(&state.db)?;
        let user = store::active_user_id(&db)?;
        let receipts = actions::receipts(&db, &user, Some(&id))?;
        let after = records(&db)?;
        turns.push(json!({
            "input": input,
            "organizer": organized.map(|handled| if handled { "handled" } else { "legacy path (not run here)" }),
            "organizerSeconds": organizer_seconds,
            "turn": load_turn(&db, &user, &id)?,
            "receipts": receipts.len(),
            "reply": reply,
            "totalSeconds": started.elapsed().as_secs_f64(),
            "records": after,
            "check": check(expect, &before, &after, receipts.len()),
        }));
    }
    Ok(json!({"name": name, "turns": turns}))
}

#[tokio::test]
#[ignore = "Actual GGUF #192 chat samples; set COMET_QA_MODEL; optional COMET_QA_NLP_DATA (Kiwi is downloaded there once when missing), COMET_QA_NLP_HELPER, COMET_QA_KIWI=off, COMET_QA_CASES, COMET_QA_OUTPUT_DIR"]
async fn actual_model_chat_requests_from_issue_192() {
    let model = std::fs::canonicalize(std::env::var("COMET_QA_MODEL").expect("COMET_QA_MODEL"))
        .expect("Use an existing GGUF file");
    let directory = tempfile::tempdir().unwrap();
    let binaries = Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries");
    let file_name = |name: &str| {
        binaries.join(
            crate::sidecar::development_executable(name)
                .file_name()
                .unwrap(),
        )
    };
    let kiwi = std::env::var("COMET_QA_KIWI").map_or(true, |value| value != "off");
    let nlp_data = std::env::var_os("COMET_QA_NLP_DATA")
        .map(PathBuf::from)
        .filter(|_| kiwi)
        .unwrap_or_else(|| directory.path().join("no-kiwi"));
    let helper = std::env::var_os("COMET_QA_NLP_HELPER")
        .map(PathBuf::from)
        .unwrap_or_else(|| file_name("comet-nlp"));
    let mut state = crate::app::tests::state();
    state.app_data = directory.path().into();
    state.inference = inference::Inference::new(
        directory.path().into(),
        file_name("llama-server"),
        binaries.join("runtime"),
    );
    state.nlp = NlpService::new(nlp_data, helper, binaries.join("nlp-runtime")).unwrap();
    if kiwi && !state.nlp.status().kiwi.installed {
        state.nlp.download(ModelKind::Kiwi).await.unwrap();
    }
    assert_eq!(state.nlp.status().kiwi.installed, kiwi);
    let settings = Settings {
        local_model: LocalModel::Custom,
        local_model_path: model.to_string_lossy().into_owned(),
        ..Settings::default()
    };
    let only = std::env::var("COMET_QA_CASES").ok();
    let mut chains = vec![];
    for (name, steps) in CHAINS {
        if only
            .as_deref()
            .is_some_and(|only| !only.split(',').any(|case| case == *name))
        {
            continue;
        }
        let result = chain(&state, &settings, directory.path(), name, steps).await;
        chains.push(result.unwrap_or_else(|error| json!({"name": name, "error": error})));
    }
    inference::stop_local(&state.inference).await;
    state.nlp.shutdown().await;
    let checks: Vec<&Value> = chains
        .iter()
        .flat_map(|chain| chain["turns"].as_array().into_iter().flatten())
        .map(|turn| &turn["check"]["pass"])
        .filter(|pass| pass.is_boolean())
        .collect();
    let passed = checks.iter().filter(|pass| ***pass == true).count();
    let output = std::env::var_os("COMET_QA_OUTPUT_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join(format!("chat-requests-{}.json", uuid::Uuid::new_v4()));
    std::fs::write(
        &output,
        serde_json::to_vec_pretty(&json!({
            "model": model,
            "kiwi": kiwi,
            "syntheticOnly": true,
            "scope": "production reading, selection, planning, registry execution and reply generation; no app window or native UI",
            "storageChecks": {"passed": passed, "total": checks.len()},
            "chains": chains,
        }))
        .unwrap(),
    )
    .unwrap();
    println!(
        "#192 chat samples: {passed}/{} storage checks, {}",
        checks.len(),
        output.display()
    );
}
