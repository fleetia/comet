use super::*;

fn message(id: &str, content: &str) -> Message {
    Message {
        id: id.into(),
        role: "user".into(),
        persona: Some("all".into()),
        content: content.into(),
        expression: None,
        created_at: 1_792_284_000_000,
        status: "complete".into(),
    }
}

fn ledger_plan(revision: i64) -> Plan {
    Plan { question:String::new(), operations:vec![Proposal {
        kind:"ledger_create".into(),target_id:String::new(),expected_revision:revision,
        input_json:json!({"date":"2026-10-18","kind":"expense","amount":3000,"category":"food","title":"컵라면"}).to_string(),
        mode:"statement".into(),evidence:"오늘 3000원 컵라면 사먹음".into(),
    }] }
}

#[test]
fn plan_requires_discovered_action_bound_revision_and_user_evidence() {
    let db = store::open(std::path::Path::new(":memory:")).unwrap();
    let catalog = actions::catalog(&db).unwrap();
    let contexts = json!({"ledger_create":actions::entities_for(&db,"ledger_create","").unwrap()});
    let mut turn = new_turn(&message("expense", "오늘 3000원 컵라면 사먹음")).unwrap();
    turn.selected = vec!["ledger_create".into()];
    assert!(prepare_plan(ledger_plan(9), &mut turn, &catalog, &contexts).is_err());
    assert!(turn.operations.is_empty());
    let mut fabricated = ledger_plan(0);
    fabricated.operations[0].evidence = "점심 식사 5000원".into();
    assert!(prepare_plan(fabricated, &mut turn, &catalog, &contexts).is_err());
    prepare_plan(ledger_plan(0), &mut turn, &catalog, &contexts).unwrap();
    assert_eq!(turn.state, "planned");
    assert_eq!(turn.operations[0].owner_id, "diary");
    assert!(turn.requires_effect);
    assert!(select(
        &Selection {
            route: "tools".into(),
            action_ids: vec!["not-installed".into()],
            continue_previous: false
        },
        &catalog
    )
    .is_err());
}

#[test]
fn selection_catalog_distinguishes_named_widgets_with_the_same_action_description() {
    let available = vec![
        json!({"id":"generated:reading:add","title":"독서 기록","description":"기록 추가","effect":"write","automatic":true}),
        json!({"id":"generated:walking:add","title":"걷기 기록","description":"기록 추가","effect":"write","automatic":true}),
    ];
    let selected = selection_catalog(&available);
    assert_eq!(selected[0]["title"], "독서 기록");
    assert_eq!(selected[1]["title"], "걷기 기록");
}

#[test]
fn a_completed_expense_and_future_task_can_share_one_plan() {
    let db = store::open(std::path::Path::new(":memory:")).unwrap();
    let directory = tempfile::tempdir().unwrap();
    crate::widgets::storage::install(&db, directory.path(), &["todo".into()]).unwrap();
    let request = "오늘 3000원 컵라면 사먹음. 내일 발표 준비 할 일 추가해줘";
    let mut turn = new_turn(&message("compound", request)).unwrap();
    turn.selected = vec!["ledger_create".into(), "task_add".into()];
    let contexts = json!({
        "ledger_create":actions::entities_for(&db,"ledger_create",request).unwrap(),
        "task_add":actions::entities_for(&db,"task_add",request).unwrap(),
    });
    let mut plan = ledger_plan(contexts["ledger_create"]["revision"].as_i64().unwrap());
    plan.operations.push(Proposal {
        kind: "task_add".into(),
        target_id: String::new(),
        expected_revision: contexts["task_add"]["revision"].as_i64().unwrap(),
        input_json: json!({"title":"발표 준비","plannedDate":"2026-10-19"}).to_string(),
        mode: "explicit".into(),
        evidence: "내일 발표 준비 할 일 추가해줘".into(),
    });
    prepare_plan(plan, &mut turn, &catalog(&db).unwrap(), &contexts).unwrap();
    assert_eq!(turn.state, "planned");
    assert_eq!(turn.operations.len(), 2);
}

#[test]
fn compound_creation_uses_instruction_evidence_and_preserves_the_memo_body() {
    let db = store::open(std::path::Path::new(":memory:")).unwrap();
    let user = store::active_user_id(&db).unwrap();
    let directory = tempfile::tempdir().unwrap();
    crate::widgets::storage::install(
        &db,
        directory.path(),
        &["preparation".into(), "clock".into(), "memo".into()],
    )
    .unwrap();
    let request = "QA 물 마시기 습관을 오늘부터 매일 하루 3회 목표인 횟수형으로 추가해줘. 준비 봉투에 제목 QA 소풍, 날짜 내일, 체크 항목 도시락과 물로 만들어줘. 시계·기념일에 2026년 11월 1일 QA 기념일을 등록해줘. 바탕화면 메모에 QA 메모라는 제목으로 저장해줘: 원문 첫 줄\n둘째 줄";
    let scope = actions::instruction_text(request);
    assert!(scope.ends_with("저장해줘"));
    assert!(!scope.contains("원문 첫 줄"));
    let mut turn = new_turn(&message("compound", request)).unwrap();
    turn.state = "planning".into();
    let catalog = catalog(&db).unwrap();
    let mut contexts = serde_json::Map::new();
    let mut operations = vec![];
    for (kind, evidence, input) in [
        (
            "habit_create",
            "추가해줘",
            json!({"title":"QA 물 마시기","weekdays":[0,1,2,3,4,5,6],"weeklyGoal":7,"mode":"count","target":3,"startDate":"2026-10-18"}),
        ),
        (
            "preparation_create",
            "만들어줘",
            json!({"title":"QA 소풍","date":"2026-10-19","checks":["도시락","물"]}),
        ),
        (
            "anniversary_add",
            "등록해줘",
            json!({"title":"QA 기념일","date":"2026-11-01"}),
        ),
        (
            "memo_create",
            "저장해줘",
            json!({"title":"QA 메모","body":"원문 첫 줄\n둘째 줄"}),
        ),
    ] {
        let context = actions::entities_for(&db, kind, request).unwrap();
        operations.push(Proposal {
            kind: kind.into(),
            target_id: String::new(),
            expected_revision: context["revision"].as_i64().unwrap(),
            input_json: input.to_string(),
            mode: "explicit".into(),
            evidence: evidence.into(),
        });
        turn.selected.push(kind.into());
        contexts.insert(kind.into(), context);
    }
    let contexts = Value::Object(contexts);
    let mut invalid = operations.clone();
    invalid[3].evidence = "저장해줘: 원문 첫 줄\n둘째 줄".into();
    let outcome = prepare_plan(
        Plan {
            question: String::new(),
            operations: invalid,
        },
        &mut turn,
        &catalog,
        &contexts,
    );
    assert!(save_planning_outcome(&db, &user, "compound", &mut turn, outcome).is_err());
    let restored = load_turn(&db, &user, "compound").unwrap().unwrap();
    assert_eq!(restored.state, "failed");
    assert!(restored.error.unwrap().contains("사용자 원문"));
    assert!(restored.operations.is_empty());
    assert!(actions::receipts(&db, &user, Some("compound"))
        .unwrap()
        .is_empty());

    let outcome = prepare_plan(
        Plan {
            question: String::new(),
            operations,
        },
        &mut turn,
        &catalog,
        &contexts,
    );
    save_planning_outcome(&db, &user, "compound", &mut turn, outcome).unwrap();
    let restored = load_turn(&db, &user, "compound").unwrap().unwrap();
    assert_eq!(restored.state, "planned");
    assert!(restored.error.is_none());
    assert_eq!(restored.operations.len(), 4);
    let memo: Value = serde_json::from_str(&restored.operations[3].proposal.input_json).unwrap();
    assert_eq!(memo["body"], "원문 첫 줄\n둘째 줄");
}

#[test]
fn clarification_is_durable_without_becoming_a_failed_write() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("comet.sqlite");
    let (user, anchor) = {
        let db = store::open(&path).unwrap();
        let user = store::active_user_id(&db).unwrap();
        let mut turn = new_turn(&message("expense", "컵라면 사먹음")).unwrap();
        turn.selected = vec!["ledger_create".into()];
        prepare_plan(
            Plan {
                question: "얼마였어?".into(),
                operations: vec![],
            },
            &mut turn,
            &[],
            &json!({}),
        )
        .unwrap();
        save_turn(&db, &user, "expense", &turn).unwrap();
        (user, turn.anchor_time)
    };
    let db = store::open(&path).unwrap();
    let restored = load_turn(&db, &user, "expense").unwrap().unwrap();
    assert_eq!(restored.state, "awaiting_input");
    assert_eq!(restored.anchor_time, anchor);
    assert!(!restored.requires_effect);
    assert!(restored.operations.is_empty());
    let replay = actions::replay_context(&db, &user, "expense")
        .unwrap()
        .unwrap();
    assert_eq!(replay["context"]["question"], "얼마였어?");
    assert_eq!(replay["receipts"], json!([]));
}

#[test]
fn only_immediate_previous_input_in_same_conversation_can_continue_question() {
    let state = app::tests::state();
    let db = lock(&state.db).unwrap();
    let user = store::active_user_id(&db).unwrap();
    crate::characters::initialize_for_tests(&db).unwrap();
    let characters = crate::characters::active_ids(&db).unwrap();
    let first = store::create_conversation(&db, &characters, None, None, 1).unwrap();
    for (id, text) in [("original", "컵라면 사먹음"), ("answer", "3천원")] {
        store::insert_message_with_source(&db, &message(id, text), "user", None, false).unwrap();
        store::attach_conversation_message(&db, &first.id, id).unwrap();
    }
    let mut pending = new_turn(&message("original", "컵라면 사먹음")).unwrap();
    pending.state = "awaiting_input".into();
    pending.question = "얼마였어?".into();
    save_turn(&db, &user, "original", &pending).unwrap();
    assert_eq!(
        previous_turn(&db, &user, "answer")
            .unwrap()
            .unwrap()
            .question,
        "얼마였어?"
    );
    store::insert_message_with_source(&db, &message("unrelated", "안녕"), "user", None, false)
        .unwrap();
    store::attach_conversation_message(&db, &first.id, "unrelated").unwrap();
    assert!(previous_turn(&db, &user, "unrelated").unwrap().is_none());
    let second = store::create_conversation(&db, &characters, None, None, 2).unwrap();
    store::insert_message_with_source(&db, &message("elsewhere", "3천원"), "user", None, false)
        .unwrap();
    store::attach_conversation_message(&db, &second.id, "elsewhere").unwrap();
    assert!(previous_turn(&db, &user, "elsewhere").unwrap().is_none());
}

#[test]
fn committed_expense_recovers_same_plan_after_interrupted_result_save() {
    let db = store::open(std::path::Path::new(":memory:")).unwrap();
    let user = store::active_user_id(&db).unwrap();
    let mut turn = new_turn(&message("expense", "오늘 3000원 컵라면 사먹음")).unwrap();
    turn.selected = vec!["ledger_create".into()];
    let catalog = actions::catalog(&db).unwrap();
    let contexts = json!({"ledger_create":actions::entities_for(&db,"ledger_create","").unwrap()});
    prepare_plan(ledger_plan(0), &mut turn, &catalog, &contexts).unwrap();
    save_turn(&db, &user, "expense", &turn).unwrap();
    let proposal = &turn.operations[0].proposal;
    let action = actions::Action {
        kind: proposal.kind.clone(),
        target_id: proposal.target_id.clone(),
        expected_revision: proposal.expected_revision,
        input: serde_json::from_str(&proposal.input_json).unwrap(),
    };
    let first =
        actions::execute_registry(&db, &user, "expense", 0, &turn.request, &action).unwrap();
    let restored = load_turn(&db, &user, "expense").unwrap().unwrap();
    assert!(restored.operations[0].result.is_none());
    assert_eq!(restored.anchor_time, turn.anchor_time);
    let second =
        actions::execute_registry(&db, &user, "expense", 0, &restored.request, &action).unwrap();
    assert_eq!(first.id, second.id);
    let result = actions::query_registry(
        &db,
        "ledger_query",
        &json!({"from":"2026-10-18","through":"2026-10-18"}),
    )
    .unwrap();
    assert_eq!(result["expenseTotal"], 3000);
    assert_eq!(result["totalCount"], 1);
}

#[test]
fn asking_and_mutating_in_one_proposal_cannot_commit_partial_work() {
    let mut turn = new_turn(&message("expense", "오늘 3000원 컵라면 사먹음")).unwrap();
    let mut plan = ledger_plan(0);
    plan.question = "날짜가 언제야?".into();
    assert!(prepare_plan(plan, &mut turn, &[], &json!({})).is_err());
    assert!(turn.operations.is_empty());
}

#[test]
fn compound_records_use_their_own_committed_revision_but_reject_intervening_edits() {
    let db = store::open(std::path::Path::new(":memory:")).unwrap();
    let user = store::active_user_id(&db).unwrap();
    let request = "오늘 3000원 컵라면 사먹음. 우유 2000원도 샀음";
    let mut turn = new_turn(&message("compound", request)).unwrap();
    turn.selected = vec!["ledger_create".into()];
    let mut plan = ledger_plan(0);
    let mut milk = plan.operations[0].clone();
    milk.evidence = "우유 2000원도 샀음".into();
    milk.input_json = json!({"date":"2026-10-18","kind":"expense","amount":2000,"category":"food","title":"우유"}).to_string();
    plan.operations.push(milk);
    let contexts = json!({"ledger_create":actions::entities_for(&db,"ledger_create","").unwrap()});
    prepare_plan(plan, &mut turn, &catalog(&db).unwrap(), &contexts).unwrap();
    let execute = |turn: &Turn, index: usize| {
        let p = &turn.operations[index].proposal;
        actions::execute_registry(
            &db,
            &user,
            "compound",
            index,
            request,
            &actions::Action {
                kind: p.kind.clone(),
                target_id: p.target_id.clone(),
                expected_revision: p.expected_revision,
                input: serde_json::from_str(&p.input_json).unwrap(),
            },
        )
    };
    let receipt = execute(&turn, 0).unwrap();
    accept_result(&mut turn, 0, serde_json::to_value(receipt).unwrap());
    assert_eq!(turn.operations[1].proposal.expected_revision, 1);
    let receipt = execute(&turn, 1).unwrap();
    accept_result(&mut turn, 1, serde_json::to_value(receipt).unwrap());
    assert_eq!(turn.state, "done");
    assert_eq!(
        actions::query_registry(&db, "ledger_query", &json!({})).unwrap()["expenseTotal"],
        5000
    );
    let stale = actions::Action {
        kind: "ledger_create".into(),
        target_id: String::new(),
        expected_revision: 1,
        input: json!({"date":"2026-10-18","kind":"expense","amount":1,"category":"food","title":"stale"}),
    };
    assert!(actions::execute_registry(&db, &user, "different-input", 0, request, &stale).is_err());
}

#[test]
fn replay_refreshes_queries_and_does_not_reuse_disabled_widget_results() {
    let db = store::open(std::path::Path::new(":memory:")).unwrap();
    let directory = tempfile::tempdir().unwrap();
    crate::widgets::storage::install(&db, directory.path(), &["todo".into()]).unwrap();
    let user = store::active_user_id(&db).unwrap();
    let mut turn = new_turn(&message("query", "할 일 알려줘")).unwrap();
    turn.selected = vec!["task_query".into()];
    let context = actions::entities_for(&db, "task_query", "").unwrap();
    let proposal = Proposal {
        kind: "task_query".into(),
        target_id: String::new(),
        expected_revision: context["revision"].as_i64().unwrap(),
        input_json: "{}".into(),
        mode: "explicit".into(),
        evidence: "할 일 알려줘".into(),
    };
    prepare_plan(
        Plan {
            question: String::new(),
            operations: vec![proposal],
        },
        &mut turn,
        &catalog(&db).unwrap(),
        &json!({"task_query":context}),
    )
    .unwrap();
    accept_result(&mut turn, 0, json!({"staleSecret":"old query data"}));
    save_turn(&db, &user, "query", &turn).unwrap();
    let fresh = actions::replay_context(&db, &user, "query")
        .unwrap()
        .unwrap();
    assert!(!fresh.to_string().contains("staleSecret"));
    assert!(fresh["context"]["operations"][0]["result"].is_object());
    crate::widgets::storage::set_enabled(&db, context["ownerId"].as_str().unwrap(), false).unwrap();
    let disabled = actions::replay_context(&db, &user, "query")
        .unwrap()
        .unwrap();
    assert!(disabled["context"]["operations"][0]["result"].is_null());
    assert!(!disabled.to_string().contains("old query data"));
}

#[test]
fn control_reply_keeps_the_actual_roll_but_hides_it_after_source_changes() {
    let db = store::open(std::path::Path::new(":memory:")).unwrap();
    let directory = tempfile::tempdir().unwrap();
    crate::widgets::storage::install(&db, directory.path(), &["small-match".into()]).unwrap();
    let user = store::active_user_id(&db).unwrap();
    let mut turn = new_turn(&message("roll", "주사위 굴려줘")).unwrap();
    turn.selected = vec!["match_dice".into()];
    let context = actions::entities_for(&db, "match_dice", "").unwrap();
    let revision = context["revision"].as_i64().unwrap();
    let proposal = Proposal {
        kind: "match_dice".into(),
        target_id: String::new(),
        expected_revision: revision,
        input_json: "{}".into(),
        mode: "explicit".into(),
        evidence: "주사위 굴려줘".into(),
    };
    prepare_plan(
        Plan {
            question: String::new(),
            operations: vec![proposal],
        },
        &mut turn,
        &catalog(&db).unwrap(),
        &json!({"match_dice":context}),
    )
    .unwrap();
    let receipt = actions::execute_registry(
        &db,
        &user,
        "roll",
        0,
        &turn.request,
        &actions::Action {
            kind: "match_dice".into(),
            target_id: String::new(),
            expected_revision: revision,
            input: json!({}),
        },
    )
    .unwrap();
    let outcome = receipt.result.clone().unwrap();
    accept_result(&mut turn, 0, serde_json::to_value(receipt).unwrap());
    save_turn(&db, &user, "roll", &turn).unwrap();
    let visible = actions::replay_context(&db, &user, "roll")
        .unwrap()
        .unwrap();
    assert_eq!(
        visible["context"]["operations"][0]["result"]["outcome"],
        outcome
    );
    assert!(visible["receipts"][0].get("result").is_none());
    crate::widgets::storage::set_enabled(&db, context["ownerId"].as_str().unwrap(), false).unwrap();
    let hidden = actions::replay_context(&db, &user, "roll")
        .unwrap()
        .unwrap();
    assert!(hidden["context"]["operations"][0]["result"]["outcome"].is_null());
    assert_eq!(hidden["receipts"][0]["title"], "저장된 작업");
}

#[test]
fn automatic_habit_statements_cannot_decrease_existing_progress() {
    let db = store::open(std::path::Path::new(":memory:")).unwrap();
    let user = store::active_user_id(&db).unwrap();
    let created = actions::execute_registry(&db,&user,"new-habit",0,"습관 등록해",&actions::Action{
        kind:"habit_create".into(),target_id:String::new(),expected_revision:0,
        input:json!({"title":"물","weekdays":[0,1,2,3,4,5,6],"weeklyGoal":7,"mode":"count","target":8,"startDate":"2020-01-01"})
    }).unwrap();
    let id = created.target_id.as_str();
    actions::execute_registry(
        &db,
        &user,
        "habit-progress",
        0,
        "습관 기록해",
        &actions::Action {
            kind: "habit_record".into(),
            target_id: id.into(),
            expected_revision: 1,
            input: json!({"date":"2020-01-02","status":"done","count":3}),
        },
    )
    .unwrap();
    let mut action = actions::Action {
        kind: "habit_record".into(),
        target_id: id.into(),
        expected_revision: 2,
        input: json!({"date":"2020-01-02","status":"done","count":1}),
    };
    assert!(validate_habit_statement(&db, &action).is_err());
    action.input["count"] = json!(4);
    assert!(validate_habit_statement(&db, &action).is_ok());
    action.input["status"] = json!("clear");
    assert!(validate_habit_statement(&db, &action).is_err());
}
