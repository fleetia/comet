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
    authorize_selection(&mut turn, &catalog).unwrap();
    assert_eq!(turn.selected, ["ledger_create"]);
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
fn selector_schema_tracks_current_catalog_ids_without_weakening_unknown_id_validation() {
    let db = store::open(std::path::Path::new(":memory:")).unwrap();
    let task = Selection {
        route: "tools".into(),
        action_ids: vec!["task_add".into()],
        continue_previous: false,
    };
    let available = catalog(&db).unwrap();
    let schema = selection_schema(&available, false);
    let ids = schema["properties"]["actionIds"]["items"]["enum"]
        .as_array()
        .unwrap();
    assert!(ids.contains(&json!("ledger_create")));
    assert!(ids.contains(&json!("task_add")));
    select(&task, &available).unwrap();
    assert_eq!(
        schema["properties"]["continuePrevious"]["enum"],
        json!([false])
    );

    assert_eq!(ids.len(), available.len());
    assert!(available.iter().all(|spec| ids.contains(&spec["id"])));
    let unknown = Selection {
        action_ids: vec!["not-installed".into()],
        ..task
    };
    assert!(!ids.contains(&json!("not-installed")));
    assert!(select(&unknown, &available).is_err());
    assert_eq!(schema["properties"]["actionIds"]["maxItems"], 4);
}

#[test]
fn a_completed_expense_and_future_task_can_share_one_plan() {
    let db = store::open(std::path::Path::new(":memory:")).unwrap();
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
    let available = catalog(&db).unwrap();
    for (state, allowed) in [
        ("awaiting_input", json!([false, true])),
        ("done", json!([false])),
        ("failed", json!([false])),
    ] {
        pending.state = state.into();
        save_turn(&db, &user, "original", &pending).unwrap();
        let previous = previous_turn(&db, &user, "answer").unwrap();
        let schema = selection_schema(
            &available,
            previous.is_some_and(|turn| turn.state == "awaiting_input"),
        );
        assert_eq!(schema["properties"]["continuePrevious"]["enum"], allowed);
    }
    store::insert_message_with_source(&db, &message("unrelated", "안녕"), "user", None, false)
        .unwrap();
    store::attach_conversation_message(&db, &first.id, "unrelated").unwrap();
    let previous = previous_turn(&db, &user, "unrelated").unwrap();
    assert!(previous.is_none());
    let schema = selection_schema(
        &available,
        previous.is_some_and(|turn| turn.state == "awaiting_input"),
    );
    assert_eq!(
        schema["properties"]["continuePrevious"]["enum"],
        json!([false])
    );
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
fn replay_refreshes_queries_even_when_reactions_are_disabled() {
    let db = store::open(std::path::Path::new(":memory:")).unwrap();
    let user = store::active_user_id(&db).unwrap();
    let revision = actions::entities_for(&db, "task_add", "").unwrap()["revision"].as_i64().unwrap();
    actions::execute_registry(&db, &user, "create", 0, "할 일을 추가해줘", &actions::Action {
        kind: "task_add".into(), target_id: String::new(), expected_revision: revision,
        input: json!({"title":"보존할 할 일"}),
    }).unwrap();
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
    crate::widgets::storage::set_reaction(&db, context["ownerId"].as_str().unwrap(), false).unwrap();
    let replayed = actions::replay_context(&db, &user, "query")
        .unwrap()
        .unwrap();
    assert!(replayed["context"]["operations"][0]["result"].is_object());
    assert!(replayed.to_string().contains("보존할 할 일"));
    assert!(!replayed.to_string().contains("old query data"));
}

#[test]
fn control_reply_keeps_the_actual_roll_but_hides_it_after_source_changes() {
    let db = store::open(std::path::Path::new(":memory:")).unwrap();
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
    let owner = context["ownerId"].as_str().unwrap();
    crate::widgets::storage::set_reaction(&db, owner, false).unwrap();
    let replayed = actions::replay_context(&db, &user, "roll").unwrap().unwrap();
    assert_eq!(replayed["context"]["operations"][0]["result"]["outcome"], outcome);
    let widget = crate::widgets::storage::get(&db, owner).unwrap();
    crate::widgets::storage::execute(&db, &crate::widgets::WidgetRequest {
        request_id: uuid::Uuid::new_v4().to_string(),
        instance_id: owner.into(), expected_revision: widget.revision,
        action: "choose".into(), input: json!({"game":"coin"}),
    }, 0, 0).unwrap();
    let hidden = actions::replay_context(&db, &user, "roll")
        .unwrap()
        .unwrap();
    assert!(hidden["context"]["operations"][0]["result"]["outcome"].is_null());
    assert_eq!(hidden["receipts"][0]["title"], visible["receipts"][0]["title"]);
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

fn task_proposal(target_id: &str, input: Value, revision: i64) -> Proposal {
    Proposal {
        kind: "task_add".into(),
        target_id: target_id.into(),
        expected_revision: revision,
        input_json: input.to_string(),
        mode: "explicit".into(),
        evidence: "추가해줘".into(),
    }
}

#[test]
fn new_task_named_by_its_list_is_saved_to_that_list_but_unknown_targets_stay_rejected() {
    let db = store::open(std::path::Path::new(":memory:")).unwrap();
    let user = store::active_user_id(&db).unwrap();
    let request = "QA 조약돌 할 일 추가해줘";
    let context = actions::entities_for(&db, "task_add", request).unwrap();
    let revision = context["revision"].as_i64().unwrap();
    let list = context["lists"][0]["id"].as_str().unwrap().to_string();
    let contexts = json!({ "task_add": context });
    let catalog = catalog(&db).unwrap();
    let plan = |proposal| Plan {
        question: String::new(),
        operations: vec![proposal],
    };
    let mut turn = new_turn(&message("task", request)).unwrap();
    turn.selected = vec!["task_add".into()];
    for target in ["missing-item", "read"] {
        let proposal = task_proposal(target, json!({"title":"QA 조약돌"}), revision);
        assert!(prepare_plan(plan(proposal), &mut turn, &catalog, &contexts).is_err());
    }
    let conflicting = task_proposal(
        &list,
        json!({"title":"QA 조약돌","listId":"other"}),
        revision,
    );
    assert!(prepare_plan(plan(conflicting), &mut turn, &catalog, &contexts).is_err());
    let stale = task_proposal(&list, json!({"title":"QA 조약돌"}), revision + 1);
    assert!(prepare_plan(plan(stale), &mut turn, &catalog, &contexts).is_err());
    assert!(turn.operations.is_empty());

    let proposal = task_proposal(&list, json!({"title":"QA 조약돌"}), revision);
    prepare_plan(plan(proposal), &mut turn, &catalog, &contexts).unwrap();
    let planned = &turn.operations[0].proposal;
    assert!(planned.target_id.is_empty());
    let input: Value = serde_json::from_str(&planned.input_json).unwrap();
    assert_eq!(input, json!({"title":"QA 조약돌","listId":list}));
    actions::execute_registry(
        &db,
        &user,
        "task",
        0,
        request,
        &actions::Action {
            kind: planned.kind.clone(),
            target_id: planned.target_id.clone(),
            expected_revision: planned.expected_revision,
            input,
        },
    )
    .unwrap();
    let saved = actions::entities_for(&db, "task_add", request).unwrap();
    assert_eq!(saved["revision"], revision + 1);
    assert_eq!(saved["items"].as_array().unwrap().len(), 1);
    assert_eq!(saved["items"][0]["title"], "QA 조약돌");
}

#[test]
fn a_repeated_identical_creation_is_planned_once_but_other_requested_records_remain() {
    let db = store::open(std::path::Path::new(":memory:")).unwrap();
    let request = "QA 짐 목록 메모 저장해줘: 충전기 챙기기";
    let contexts = json!({"note_create":actions::entities_for(&db,"note_create",request).unwrap()});
    let note = Proposal {
        kind: "note_create".into(),
        target_id: String::new(),
        expected_revision: contexts["note_create"]["revision"].as_i64().unwrap(),
        input_json: json!({"title":"QA 짐 목록","body":"충전기 챙기기"}).to_string(),
        mode: "explicit".into(),
        evidence: "저장해줘".into(),
    };
    let mut other = note.clone();
    other.input_json = json!({"title":"QA 짐 목록 2","body":"충전기 챙기기"}).to_string();
    let mut turn = new_turn(&message("note", request)).unwrap();
    turn.selected = vec!["note_create".into()];
    let plan = Plan {
        question: String::new(),
        operations: vec![note.clone(), note, other],
    };
    prepare_plan(plan, &mut turn, &catalog(&db).unwrap(), &contexts).unwrap();
    assert_eq!(turn.operations.len(), 2);
    assert_ne!(
        turn.operations[0].proposal.input_json,
        turn.operations[1].proposal.input_json
    );
}

#[test]
fn planner_instruction_keeps_the_revision_copy_and_new_item_target_contracts() {
    assert!(PLAN_INSTRUCTION
        .contains("expectedRevision은 context[kind].revision 숫자를 그대로 복사한다"));
    assert!(PLAN_INSTRUCTION.contains("목록·위젯 ID(ownerId)를 넣지 않는다"));
    assert!(
        plan_schema()["properties"]["operations"]["items"]["required"]
            .as_array()
            .unwrap()
            .contains(&json!("expectedRevision"))
    );
}

#[test]
fn ordinary_preference_retry_drops_manual_writes_but_preserves_read_only_queries() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("comet.sqlite");
    for (id, request) in [
        (
            "preference",
            "나는 커피를 좋아해. 대답은 두 문장으로 해 줘.",
        ),
        ("lookup", "메모 목록 알려줘"),
    ] {
        let db = store::open(&path).unwrap();
        let user = store::active_user_id(&db).unwrap();
        let before = crate::diary::read(&db).unwrap();
        let mut rejected = new_turn(&message(id, request)).unwrap();
        rejected.state = "failed".into();
        rejected.error = Some("실행을 요청한 문장을 확인하지 못했어요.".into());
        rejected.selected = ["note_create", "page_create", "habit_create", "note_query"]
            .map(String::from)
            .to_vec();
        save_turn(&db, &user, id, &rejected).unwrap();
        drop(db);

        let db = store::open(&path).unwrap();
        let available = catalog(&db).unwrap();
        let mut turn = load_turn(&db, &user, id).unwrap().unwrap();
        authorize_selection(&mut turn, &available).unwrap();
        assert_eq!(turn.selected, ["note_query"]);
        assert!(turn.error.is_none());
        let context = entities(&db, "note_query", request).unwrap();
        let revision = context["revision"].as_i64().unwrap();
        let outcome = prepare_plan(
            Plan {
                question: String::new(),
                operations: vec![Proposal {
                    kind: "note_query".into(),
                    target_id: String::new(),
                    expected_revision: revision,
                    input_json: "{}".into(),
                    mode: "explicit".into(),
                    evidence: request.into(),
                }],
            },
            &mut turn,
            &available,
            &json!({"note_query":context}),
        );
        save_planning_outcome(&db, &user, id, &mut turn, outcome).unwrap();
        let restored = load_turn(&db, &user, id).unwrap().unwrap();
        assert_eq!(restored.state, "planned");
        assert!(!restored.requires_effect);
        assert!(restored
            .operations
            .iter()
            .all(|operation| operation.effect == "read"));
        assert!(restored.error.is_none());
        assert_eq!(crate::diary::read(&db).unwrap(), before);
        assert!(actions::receipts(&db, &user, Some(id)).unwrap().is_empty());
    }
}

#[test]
fn preference_with_only_unauthorized_writes_becomes_ordinary_conversation() {
    let db = store::open(std::path::Path::new(":memory:")).unwrap();
    let mut turn = new_turn(&message("preference", "나는 커피를 좋아해")).unwrap();
    turn.state = "failed".into();
    turn.error = Some("실행할 작업을 확인하지 못했어요.".into());
    turn.selected = vec!["note_create".into(), "habit_create".into()];
    authorize_selection(&mut turn, &catalog(&db).unwrap()).unwrap();
    assert_eq!(turn.state, "none");
    assert!(turn.selected.is_empty());
    assert!(turn.operations.is_empty());
    assert!(turn.error.is_none());
    assert!(!turn.requires_effect);
}

#[test]
fn explicit_write_and_clarification_intents_keep_failed_plan_guards() {
    let db = store::open(std::path::Path::new(":memory:")).unwrap();
    let user = store::active_user_id(&db).unwrap();
    for request in [
        "할 일 추가해줘",
        "할 일 추가해줘\n커피 마시기",
        "이 취향을 기억해줘",
    ] {
        let mut turn = new_turn(&message("explicit", request)).unwrap();
        let kind = if request.contains("기억") {
            "note_create"
        } else {
            "task_add"
        };
        turn.selected = vec![kind.into()];
        let available = catalog(&db).unwrap();
        authorize_selection(&mut turn, &available).unwrap();
        assert_eq!(turn.selected, [kind]);
        let context = entities(&db, kind, request).unwrap();
        let outcome = prepare_plan(
            Plan {
                question: String::new(),
                operations: vec![Proposal {
                    kind: kind.into(),
                    target_id: String::new(),
                    expected_revision: context["revision"].as_i64().unwrap() + 1,
                    input_json: "{}".into(),
                    mode: "explicit".into(),
                    evidence: request.into(),
                }],
            },
            &mut turn,
            &available,
            &json!({(kind):context}),
        );
        assert!(save_planning_outcome(&db, &user, "explicit", &mut turn, outcome).is_err());
        assert_eq!(turn.state, "failed");
        assert!(turn.error.is_some());
        assert!(actions::receipts(&db, &user, Some("explicit"))
            .unwrap()
            .is_empty());
    }
}

#[test]
fn an_unreadable_query_input_keeps_its_raw_value_locally_but_not_in_replay() {
    let db = store::open(std::path::Path::new(":memory:")).unwrap();
    let user = store::active_user_id(&db).unwrap();
    let request = "Show my diary note QA travel pouch.";
    let contexts = json!({"note_query":actions::entities_for(&db,"note_query",request).unwrap()});
    let query = |input_json: &str| Plan {
        question: String::new(),
        operations: vec![Proposal {
            kind: "note_query".into(),
            target_id: String::new(),
            expected_revision: contexts["note_query"]["revision"].as_i64().unwrap(),
            input_json: input_json.into(),
            mode: "explicit".into(),
            evidence: "Show my diary note".into(),
        }],
    };
    let catalog = catalog(&db).unwrap();
    let mut turn = new_turn(&message("query", request)).unwrap();
    turn.selected = vec!["note_query".into()];
    let outcome = prepare_plan(query("{"), &mut turn, &catalog, &contexts);
    save_planning_outcome(&db, &user, "query", &mut turn, outcome).unwrap_err();

    let saved = load_turn(&db, &user, "query").unwrap().unwrap();
    assert_eq!(saved.state, "failed");
    assert_eq!(
        saved.error.as_deref(),
        Some("작업의 입력 형식을 읽지 못했어요.")
    );
    let rejected = saved.rejected_input.as_ref().unwrap();
    assert_eq!(rejected["kind"], "note_query");
    assert_eq!(rejected["inputJson"], "{");
    assert!(rejected["parseError"].as_str().unwrap().contains("EOF"));
    let raw = actions::turn_context(&db, &user, "query").unwrap().unwrap();
    let replayed = replay(&db, &user, serde_json::from_str(&raw).unwrap(), &mut []).unwrap();
    assert!(!replayed.to_string().contains("parseError"));

    prepare_plan(
        query(r#"{"query":"QA travel pouch"}"#),
        &mut turn,
        &catalog,
        &contexts,
    )
    .unwrap();
    assert!(turn.rejected_input.is_none());
    assert_eq!(turn.operations.len(), 1);
}

#[test]
fn a_failed_retry_does_not_keep_the_previous_rejected_input() {
    let db = store::open(std::path::Path::new(":memory:")).unwrap();
    let user = store::active_user_id(&db).unwrap();
    let request = "Show my diary note QA travel pouch.";
    let contexts = json!({"note_query":actions::entities_for(&db,"note_query",request).unwrap()});
    let catalog = catalog(&db).unwrap();
    let mut turn = new_turn(&message("retry", request)).unwrap();
    turn.selected = vec!["note_query".into()];
    let unreadable = Plan {
        question: String::new(),
        operations: vec![Proposal {
            kind: "note_query".into(),
            target_id: String::new(),
            expected_revision: contexts["note_query"]["revision"].as_i64().unwrap(),
            input_json: "{".into(),
            mode: "explicit".into(),
            evidence: "Show my diary note".into(),
        }],
    };
    let outcome = planned(Ok(unreadable), &mut turn, &catalog, &contexts);
    save_planning_outcome(&db, &user, "retry", &mut turn, outcome).unwrap_err();
    assert!(load_turn(&db, &user, "retry")
        .unwrap()
        .unwrap()
        .rejected_input
        .is_some());

    let outcome = planned(
        Err("AI 응답을 받지 못했어요.".into()),
        &mut turn,
        &catalog,
        &contexts,
    );
    save_planning_outcome(&db, &user, "retry", &mut turn, outcome).unwrap_err();

    let saved = load_turn(&db, &user, "retry").unwrap().unwrap();
    assert_eq!(saved.state, "failed");
    assert_eq!(saved.error.as_deref(), Some("AI 응답을 받지 못했어요."));
    assert!(saved.rejected_input.is_none());
}

#[test]
fn deleting_a_trip_waits_for_a_plain_yes_to_the_apps_own_question() {
    let db = store::open(std::path::Path::new(":memory:")).unwrap();
    let user = store::active_user_id(&db).unwrap();
    let travel = actions::execute_registry(
        &db,
        &user,
        "trip",
        0,
        "제주 여행 만들어줘",
        &actions::Action {
            kind: "travel_create".into(),
            target_id: String::new(),
            expected_revision: 0,
            input: json!({"title":"제주","startDate":"2026-11-01","endDate":"2026-11-02",
                          "timeZone":"Asia/Seoul","currency":"KRW"}),
        },
    )
    .unwrap()
    .target_id;
    let catalog = catalog(&db).unwrap();
    let contexts = json!({"travel_delete":actions::entities_for(&db,"travel_delete","").unwrap()});
    let plan = || Plan {
        question: String::new(),
        operations: vec![Proposal {
            kind: "travel_delete".into(),
            target_id: travel.clone(),
            expected_revision: 1,
            input_json: "{}".into(),
            mode: "explicit".into(),
            evidence: "지워줘".into(),
        }],
    };
    let mut turn = new_turn(&message("delete", "제주 여행 지워줘")).unwrap();
    turn.selected = vec!["travel_delete".into()];
    prepare_plan(plan(), &mut turn, &catalog, &contexts).unwrap();
    assert_eq!(turn.state, "awaiting_input");
    assert!(turn.operations.is_empty());
    assert!(turn.question.starts_with("‘제주’을 지우면 일정 0·예약 0"));
    assert_eq!(turn.confirm_delete.as_deref(), Some(travel.as_str()));
    assert!(!confirms_delete("아니 지우지 마"));
    for refusal in [
        "잠깐만",
        "그래도 지우지마",
        "그래도 지우지 마",
        "네 삭제하지 말아줘",
        "응 안 돼",
        "응?",
        "yes, do not delete",
    ] {
        assert!(!confirms_delete(refusal), "{refusal}");
    }
    assert!(confirms_delete("응 지워줘"));
    assert!(confirms_delete("그래 정말 지워"));
    let mut answer = new_turn(&message("yes", "제주 여행 지워줘\n응")).unwrap();
    answer.selected = vec!["travel_delete".into()];
    answer.confirmed_delete = turn
        .confirm_delete
        .clone()
        .filter(|_| confirms_delete("응"));
    prepare_plan(plan(), &mut answer, &catalog, &contexts).unwrap();
    assert_eq!(answer.state, "planned");
    assert_eq!(answer.operations.len(), 1);
}

/// A turn read by the rules with the Kiwi analysis recorded for `request`.
fn read_turn(db: &Connection, id: &str, request: &str) -> Turn {
    let recorded: Value = serde_json::from_str(include_str!("utterance/kiwi_tokens.json")).unwrap();
    let analysis = crate::nlp::protocol::Analysis {
        tokens: serde_json::from_value(recorded[request]["tokens"].clone()).unwrap(),
        typo_corrected: serde_json::from_value(recorded[request]["typo_corrected"].clone())
            .unwrap(),
        ..Default::default()
    };
    let mut turn = new_turn(&message(id, request)).unwrap();
    let judgment = utterance::judge(
        request,
        Some(&analysis),
        anchor_date(&turn.anchor_time).unwrap(),
        &catalog(db).unwrap(),
    );
    turn.selected = judgment
        .intents
        .iter()
        .map(|intent| intent.kind.clone())
        .collect();
    turn.analysis = Some(judgment);
    turn
}

fn save(db: &Connection, turn: &Turn, input_id: &str) {
    let user = store::active_user_id(db).unwrap();
    let planned = &turn.operations[0].proposal;
    actions::execute_registry(
        db,
        &user,
        input_id,
        0,
        &turn.request,
        &actions::Action {
            kind: planned.kind.clone(),
            target_id: planned.target_id.clone(),
            expected_revision: planned.expected_revision,
            input: serde_json::from_str(&planned.input_json).unwrap(),
        },
    )
    .unwrap();
}

#[test]
fn a_task_is_created_and_rescheduled_from_the_users_words_without_a_planner_call() {
    let db = store::open(std::path::Path::new(":memory:")).unwrap();
    let catalog = catalog(&db).unwrap();
    for (id, request, due) in [
        (
            "create",
            "마감일 2026-11-06인 QA-T1 할 일을 추가해줘.",
            "2026-11-06",
        ),
        (
            "update",
            "QA-T1 할 일의 마감일만 2026-11-07로 바꿔줘.",
            "2026-11-07",
        ),
    ] {
        let mut turn = read_turn(&db, id, request);
        let selected: Vec<Value> = turn
            .selected
            .iter()
            .map(|kind| capability(&catalog, kind).unwrap().clone())
            .collect();
        let contexts = json!({ turn.selected[0].clone(): actions::entities_for(&db, &turn.selected[0], request).unwrap() });
        let plan = host_plan(&turn, &selected, &contexts).expect(request);
        prepare_plan(plan, &mut turn, &catalog, &contexts).unwrap();
        save(&db, &turn, id);
        let tasks = actions::entities_for(&db, "task_add", "").unwrap();
        assert_eq!(tasks["items"].as_array().unwrap().len(), 1, "{request}");
        assert_eq!(tasks["items"][0]["title"], "QA-T1");
        assert_eq!(tasks["items"][0]["dueDate"], due);
    }
}

#[test]
fn a_local_planner_grammar_only_admits_the_values_the_host_knows() {
    let db = store::open(std::path::Path::new(":memory:")).unwrap();
    let request = "마감일 2026-11-06인 QA-T1 할 일을 추가해줘.";
    let turn = read_turn(&db, "local", request);
    let catalog = catalog(&db).unwrap();
    let selected = vec![capability(&catalog, "task_add").unwrap().clone()];
    let contexts = json!({"task_add": actions::entities_for(&db, "task_add", request).unwrap()});
    let schema = local_plan_schema(&turn, &selected, &contexts);
    // The request gives the title, so there is nothing to ask.
    assert!(schema.get("anyOf").is_none());
    let act = &schema["properties"];
    assert_eq!(act["question"]["enum"], json!([""]));
    // One request was read, so one operation; a repeat of it cannot be saved twice.
    assert_eq!(act["operations"]["maxItems"], 1);
    let variants = act["operations"]["items"]["anyOf"].as_array().unwrap();
    assert_eq!(variants.len(), 1, "a new task is never a statement");
    let variant = &variants[0]["properties"];
    assert_eq!(variant["kind"]["enum"], json!(["task_add"]));
    assert_eq!(variant["targetId"]["enum"], json!([""]));
    assert_eq!(
        variant["expectedRevision"]["enum"],
        json!([contexts["task_add"]["revision"]])
    );
    assert_eq!(variant["mode"]["enum"], json!(["explicit"]));
    assert!(variant["evidence"]["enum"]
        .as_array()
        .unwrap()
        .iter()
        .all(|evidence| request.contains(evidence.as_str().unwrap())));
    let input = &variant["input"]["properties"];
    assert_eq!(input["title"]["enum"], json!(["QA-T1"]));
    assert_eq!(input["dueDate"]["enum"], json!(["2026-11-06"]));
    for absent in ["plannedDate", "dueAt"] {
        assert!(input.get(absent).is_none(), "{absent}");
    }
    assert!(variant["input"]["required"]
        .as_array()
        .unwrap()
        .contains(&json!("dueDate")));
    // Without a selectable action only a question remains.
    let ask = local_plan_schema(&turn, &[], &json!({}));
    assert_eq!(ask["properties"]["question"]["minLength"], 1);
}

#[test]
fn a_local_plan_takes_the_input_object_and_drops_nulls_only_for_new_items() {
    let db = store::open(std::path::Path::new(":memory:")).unwrap();
    let plan: LocalPlan = serde_json::from_value(json!({"question":"","operations":[
        {"kind":"task_add","targetId":"","expectedRevision":1,"input":{"title":"QA-T1","dueAt":null},"mode":"explicit","evidence":"추가해줘"},
        {"kind":"task_update","targetId":"t","expectedRevision":1,"input":{"dueDate":null},"mode":"explicit","evidence":"바꿔줘"}]}))
    .unwrap();
    let plan = plan.into_plan(&catalog(&db).unwrap());
    assert_eq!(
        plan.operations[0].input_json,
        json!({"title":"QA-T1"}).to_string()
    );
    assert_eq!(
        plan.operations[1].input_json,
        json!({"dueDate":null}).to_string()
    );
}

#[test]
fn planned_values_that_drop_or_rewrite_the_users_words_are_not_saved() {
    let db = store::open(std::path::Path::new(":memory:")).unwrap();
    let catalog = catalog(&db).unwrap();
    for (request, kind, input, field) in [
        (
            "마감일 2026-11-06인 QA-T1 할 일을 추가해줘.",
            "task_add",
            json!({"title":"QA-T1"}),
            "날짜",
        ),
        (
            "제목이 QA-N1이고 본문이 정확히 First line.인 다이어리 메모를 만들어줘.",
            "note_create",
            json!({"title":"QA-N1","body":"First line.인 다이어리 메모"}),
            "본문",
        ),
    ] {
        let mut turn = read_turn(&db, kind, request);
        let contexts = json!({ kind: actions::entities_for(&db, kind, request).unwrap() });
        let plan = Plan {
            question: String::new(),
            operations: vec![Proposal {
                kind: kind.into(),
                target_id: String::new(),
                expected_revision: contexts[kind]["revision"].as_i64().unwrap(),
                input_json: input.to_string(),
                mode: "explicit".into(),
                evidence: turn.analysis.as_ref().unwrap().intents[0].evidence.clone(),
            }],
        };
        let error = prepare_plan(plan, &mut turn, &catalog, &contexts).unwrap_err();
        assert!(error.contains(field), "{error}");
        assert!(turn.operations.is_empty());
    }
}

#[test]
fn a_kiwi_request_form_passes_the_explicit_gate_that_string_endings_miss() {
    let db = store::open(std::path::Path::new(":memory:")).unwrap();
    let request = "할 일에 우유 사기 넣어 둬.";
    assert!(!actions::has_explicit_request(request));
    let catalog = catalog(&db).unwrap();
    let mut plain = new_turn(&message("plain", request)).unwrap();
    plain.selected = vec!["task_add".into()];
    authorize_selection(&mut plain, &catalog).unwrap();
    assert_eq!(plain.state, "none");
    let mut turn = read_turn(&db, "kiwi", request);
    authorize_selection(&mut turn, &catalog).unwrap();
    assert_eq!(turn.selected, ["task_add"]);
    let contexts = json!({"task_add": actions::entities_for(&db, "task_add", request).unwrap()});
    let selected = vec![capability(&catalog, "task_add").unwrap().clone()];
    let plan = host_plan(&turn, &selected, &contexts).unwrap();
    prepare_plan(plan, &mut turn, &catalog, &contexts).unwrap();
    let input: Value = serde_json::from_str(&turn.operations[0].proposal.input_json).unwrap();
    assert_eq!(input, json!({"title":"우유 사기"}));
}

#[test]
fn planner_instruction_carries_only_the_selected_features_rules() {
    let db = store::open(std::path::Path::new(":memory:")).unwrap();
    let catalog = catalog(&db).unwrap();
    let task = vec![capability(&catalog, "task_add").unwrap().clone()];
    let travel = vec![capability(&catalog, "travel_expense_add").unwrap().clone()];
    let only_task = plan_instruction(&task, false);
    assert!(!only_task.contains("여행 금액"));
    assert!(!only_task.contains("습관 count"));
    assert!(only_task.contains("작업을 확정했으면 question은 빈 문자열이다."));
    assert!(plan_instruction(&travel, false).contains("여행 금액"));
    let local = plan_instruction(&task, true);
    assert!(local.contains("input은 해당 inputSchema에 맞는 객체다"));
    assert!(!local.contains("inputJson"));
}

/// Plans `request` from the rules alone, runs it and stores the results like `direct` does.
fn run_host_turn(db: &Connection, id: &str, request: &str) -> Turn {
    let user = store::active_user_id(db).unwrap();
    let catalog = catalog(db).unwrap();
    let mut turn = read_turn(db, id, request);
    let selected: Vec<Value> = turn
        .selected
        .iter()
        .map(|kind| capability(&catalog, kind).unwrap().clone())
        .collect();
    let kind = turn.selected[0].clone();
    let contexts = json!({ kind.clone(): actions::entities_for(db, &kind, request).unwrap() });
    let plan = host_plan(&turn, &selected, &contexts).expect(request);
    prepare_plan(plan, &mut turn, &catalog, &contexts).unwrap();
    let planned = turn.operations[0].proposal.clone();
    let input: Value = serde_json::from_str(&planned.input_json).unwrap();
    let result = if turn.operations[0].effect == "read" {
        actions::query_registry(db, &planned.kind, &input).unwrap()
    } else {
        let action = actions::Action {
            kind: planned.kind.clone(),
            target_id: planned.target_id.clone(),
            expected_revision: planned.expected_revision,
            input,
        };
        let receipt = actions::execute_registry(db, &user, id, 0, request, &action).unwrap();
        serde_json::to_value(receipt).unwrap()
    };
    accept_result(&mut turn, 0, result);
    save_turn(db, &user, id, &turn).unwrap();
    turn
}

#[test]
fn a_named_clock_time_becomes_that_deadline_and_a_guessed_one_is_not_saved() {
    let db = store::open(std::path::Path::new(":memory:")).unwrap();
    let user = store::active_user_id(&db).unwrap();
    let catalog = catalog(&db).unwrap();
    let request = "내일 오후 3시에 치과 가기 할 일 추가해줘.";
    let turn = read_turn(&db, "clock", request);
    let intent = &turn.analysis.as_ref().unwrap().intents[0];
    let at = requested_due_at(&intent.slots).unwrap();
    assert_eq!(local_day(at), intent.slots.date);
    let selected = vec![capability(&catalog, "task_add").unwrap().clone()];
    let contexts = json!({"task_add": actions::entities_for(&db, "task_add", request).unwrap()});
    // The local grammar fixes the deadline and leaves out fields the request never mentions.
    let schema = local_plan_schema(&turn, &selected, &contexts);
    let input = &schema["properties"]["operations"]["items"]["anyOf"][0]["properties"]["input"]
        ["properties"];
    assert_eq!(input["dueAt"]["enum"], json!([at]));
    for absent in [
        "dueDate",
        "plannedDate",
        "planPeriod",
        "planAnchor",
        "repeat",
        "memo",
    ] {
        assert!(input.get(absent).is_none(), "{absent}");
    }
    // 할 일 is also the default list's name, so only that list can be chosen.
    assert_eq!(input["listId"]["enum"], json!(["default"]));
    let guessed = Plan {
        question: String::new(),
        operations: vec![Proposal {
            kind: "task_add".into(),
            target_id: String::new(),
            expected_revision: contexts["task_add"]["revision"].as_i64().unwrap(),
            input_json: json!({"title":"치과 가기","dueAt":0}).to_string(),
            mode: "explicit".into(),
            evidence: intent.evidence.clone(),
        }],
    };
    assert_eq!(
        prepare_plan(guessed, &mut turn.clone(), &catalog, &contexts).unwrap_err(),
        "요청한 시각과 저장할 값이 달라서 저장하지 않았어요. 한 번 더 말해 주세요."
    );
    run_host_turn(&db, "clock", request);
    let tasks = actions::entities_for(&db, "task_add", "").unwrap();
    assert_eq!(tasks["items"][0]["title"], "치과 가기");
    assert_eq!(tasks["items"][0]["dueAt"], at);
    assert_eq!(
        actions::result_reply(&db, &user, "clock")
            .unwrap()
            .as_deref(),
        Some("'치과 가기' 할 일을 추가했어요.")
    );
    // A repetition needs a rule value, so the model plans it within the known values.
    let request = "매주 월요일 분리수거 할 일 추가해 줘";
    let turn = read_turn(&db, "repeat", request);
    let contexts = json!({"task_add": actions::entities_for(&db, "task_add", request).unwrap()});
    assert!(host_plan(&turn, &selected, &contexts).is_none());
    let schema = local_plan_schema(&turn, &selected, &contexts);
    let input = &schema["properties"]["operations"]["items"]["anyOf"][0]["properties"]["input"]
        ["properties"];
    assert_eq!(
        input["repeat"]["enum"],
        json!(["none", "daily", "weekly", "monthly", "yearly"])
    );
}

#[test]
fn the_apps_own_reply_names_the_saved_change_the_found_items_or_the_question() {
    let db = store::open(std::path::Path::new(":memory:")).unwrap();
    let user = store::active_user_id(&db).unwrap();
    run_host_turn(&db, "add", "마감일 2026-11-06인 QA-T1 할 일을 추가해줘.");
    assert_eq!(
        actions::result_reply(&db, &user, "add").unwrap().as_deref(),
        Some("'QA-T1' 할 일을 추가했어요.")
    );
    run_host_turn(&db, "move", "QA-T1 할 일의 마감일만 2026-11-07로 바꿔줘.");
    let moved = actions::result_reply(&db, &user, "move").unwrap().unwrap();
    assert!(moved.starts_with("'QA-T1' 할 일의 마감을 "), "{moved}");
    assert!(moved.ends_with("11월 7일로 바꿨어요."), "{moved}");
    run_host_turn(&db, "show", "QA-T1 할 일을 보여줘.");
    let found = actions::result_reply(&db, &user, "show").unwrap().unwrap();
    assert!(found.starts_with("'QA-T1' 할 일: "), "{found}");
    assert!(found.ends_with("11월 7일 마감."), "{found}");
    // A removed item keeps its own name in the receipt.
    run_host_turn(&db, "drop", "QA-T1 할 일 지워");
    assert_eq!(
        actions::result_reply(&db, &user, "drop")
            .unwrap()
            .as_deref(),
        Some("'QA-T1' 할 일을 지웠어요.")
    );
    // A month's expenses come from the app's own totals for the period the request names.
    let revision = actions::entities_for(&db, "ledger_create", "").unwrap()["revision"]
        .as_i64()
        .unwrap();
    actions::execute_registry(
        &db,
        &user,
        "coffee",
        0,
        "커피 4천 원 썼어",
        &actions::Action {
            kind: "ledger_create".into(),
            target_id: String::new(),
            expected_revision: revision,
            input: json!({"date":"2026-10-18","kind":"expense","amount":4000,"category":"food","title":"커피"}),
        },
    )
    .unwrap();
    let turn = run_host_turn(&db, "month", "이번 달 지출 얼마야?");
    let input: Value = serde_json::from_str(&turn.operations[0].proposal.input_json).unwrap();
    assert_eq!(input["kind"], "expense");
    assert!(input["from"].as_str().unwrap().ends_with("-01"));
    assert_eq!(
        actions::result_reply(&db, &user, "month")
            .unwrap()
            .as_deref(),
        Some("지출 1건, 모두 4,000원이에요.")
    );
    // A plan that waits on an answer replies with its question, and plain chat keeps the model.
    let mut waiting = new_turn(&message("ask", "할 일 추가해줘")).unwrap();
    waiting.state = "awaiting_input".into();
    waiting.question = "어떤 할 일을 추가할까요?".into();
    save_turn(&db, &user, "ask", &waiting).unwrap();
    assert_eq!(
        actions::result_reply(&db, &user, "ask").unwrap().as_deref(),
        Some("어떤 할 일을 추가할까요?")
    );
    let mut chat = new_turn(&message("chat", "안녕")).unwrap();
    chat.state = "none".into();
    save_turn(&db, &user, "chat", &chat).unwrap();
    assert_eq!(actions::result_reply(&db, &user, "chat").unwrap(), None);
}

#[test]
fn a_planner_question_that_only_repeats_the_request_is_not_asked() {
    let mut turn = new_turn(&message("echo", "커피 4천 원 썼어")).unwrap();
    let echo = Plan {
        question: "커피 4천 원 썼어.".into(),
        operations: vec![],
    };
    assert_eq!(
        prepare_plan(echo, &mut turn, &[], &json!({})).unwrap_err(),
        "요청을 작업으로 정리하지 못했어요. 한 번 더 말해 주세요."
    );
    // A short question that happens to reuse a word of the request is still asked.
    let mut short = new_turn(&message("short", "회의 날짜 정해서 일정 추가해줘")).unwrap();
    let date = Plan {
        question: "날짜?".into(),
        operations: vec![],
    };
    prepare_plan(date, &mut short, &[], &json!({})).unwrap();
    assert_eq!(short.state, "awaiting_input");
    let asked = Plan {
        question: "어느 날 쓴 돈인가요?".into(),
        operations: vec![],
    };
    prepare_plan(asked, &mut turn, &[], &json!({})).unwrap();
    assert_eq!(turn.state, "awaiting_input");
}
