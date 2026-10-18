use super::*;

fn database() -> Connection {
    store::open(std::path::Path::new(":memory:")).unwrap()
}

fn run(db: &Connection, kind: &str, target: &str, input: Value) -> Receipt {
    let user = store::active_user_id(db).unwrap();
    let revision = entities_for(db, kind, "").unwrap()["revision"]
        .as_i64()
        .unwrap();
    execute_registry(
        db,
        &user,
        &uuid::Uuid::new_v4().to_string(),
        0,
        "사용자가 요청한 작업",
        &Action {
            kind: kind.into(),
            target_id: target.into(),
            expected_revision: revision,
            input,
        },
    )
    .unwrap()
}

fn expense(title: &str, amount: u64) -> Value {
    json!({"date":"2026-10-18","kind":"expense","amount":amount,"category":"food","title":title})
}

#[test]
fn ledger_statement_is_saved_once_and_undo_preserves_independent_entries() {
    let db = database();
    let user = store::active_user_id(&db).unwrap();
    let action = Action {
        kind: "ledger_create".into(),
        target_id: String::new(),
        expected_revision: 0,
        input: expense("컵라면", 3000),
    };
    authorize_registry(
        "오늘 3000원 컵라면 사먹음",
        "ledger_create",
        "statement",
        "3000원 컵라면 사먹음",
    )
    .unwrap();
    let saved = execute_registry(
        &db,
        &user,
        "purchase",
        0,
        "오늘 3000원 컵라면 사먹음",
        &action,
    )
    .unwrap();
    let retry = execute_registry(
        &db,
        &user,
        "purchase",
        0,
        "오늘 3000원 컵라면 사먹음",
        &action,
    )
    .unwrap();
    assert_eq!(saved.id, retry.id);
    assert_eq!(saved.result.as_ref().unwrap()["item"]["amount"], 3000);
    run(&db, "ledger_create", "", expense("저녁", 7000));
    let result = query_registry(
        &db,
        "ledger_query",
        &json!({"from":"2026-10-18","through":"2026-10-18"}),
    )
    .unwrap();
    assert_eq!(result["totalCount"], 2);
    assert_eq!(result["expenseTotal"], 10000);
    undo(&db, &user, &saved.id).unwrap();
    let result = query_registry(&db, "ledger_query", &json!({})).unwrap();
    assert_eq!(result["totalCount"], 1);
    assert_eq!(result["ledgerEntries"][0]["title"], "저녁");
    assert!(undo(&db, &user, &saved.id).unwrap().undone);
}

#[test]
fn ledger_rejects_bad_money_stale_revision_and_conflicting_undo() {
    let db = database();
    let user = store::active_user_id(&db).unwrap();
    for (key, value) in [
        ("amount", json!(-3000)),
        ("amount", json!(3.5)),
        ("amount", json!("3000")),
        ("category", json!("invented")),
        ("date", json!("2026-02-30")),
        ("connectionId", json!("remote")),
    ] {
        let mut input = expense("컵라면", 3000);
        input[key] = value;
        assert!(execute_registry(
            &db,
            &user,
            &uuid::Uuid::new_v4().to_string(),
            0,
            "가계부에 추가해",
            &Action {
                kind: "ledger_create".into(),
                target_id: String::new(),
                expected_revision: 0,
                input
            }
        )
        .is_err());
    }
    let created = run(&db, "ledger_create", "", expense("컵라면", 3000));
    let edited = run(
        &db,
        "ledger_update",
        &created.target_id,
        json!({"amount":3500}),
    );
    assert_eq!(edited.result.as_ref().unwrap()["item"]["title"], "컵라면");
    assert!(undo(&db, &user, &created.id).is_err());
    assert!(execute_registry(
        &db,
        &user,
        "stale",
        0,
        "추가해",
        &Action {
            kind: "ledger_create".into(),
            target_id: String::new(),
            expected_revision: 0,
            input: expense("잘못된 중복", 3000)
        }
    )
    .is_err());
    assert_eq!(
        query_registry(&db, "ledger_query", &json!({})).unwrap()["expenseTotal"],
        3500
    );
}

#[test]
fn habit_record_undo_uses_habit_and_date_and_preserves_other_days() {
    let db = database();
    let user = store::active_user_id(&db).unwrap();
    let habit = run(
        &db,
        "habit_create",
        "",
        json!({"title":"물 마시기","weekdays":[0,1,2,3,4,5,6],"weeklyGoal":7,"mode":"count","target":8,"startDate":"2020-01-01"}),
    );
    let first = run(
        &db,
        "habit_record",
        &habit.target_id,
        json!({"date":"2020-01-02","status":"done","count":2}),
    );
    run(
        &db,
        "habit_record",
        &habit.target_id,
        json!({"date":"2020-01-03","status":"done","count":3}),
    );
    undo(&db, &user, &first.id).unwrap();
    let result = query_registry(&db, "habit_query", &json!({})).unwrap();
    assert_eq!(result["habitChecks"].as_array().unwrap().len(), 1);
    assert_eq!(result["habitChecks"][0]["date"], "2020-01-03");
    assert_eq!(result["habitChecks"][0]["count"], 3);
}

#[test]
fn time_record_undo_restores_split_intervals_without_losing_later_records() {
    let db = database();
    let user = store::active_user_id(&db).unwrap();
    let original = run(
        &db,
        "time_record",
        "",
        json!({"date":"2026-10-18","startMinute":540,"endMinute":720,"categoryId":"work","title":"업무"}),
    );
    let overwrite = run(
        &db,
        "time_record",
        "",
        json!({"date":"2026-10-18","startMinute":600,"endMinute":660,"categoryId":"rest","title":"휴식"}),
    );
    run(
        &db,
        "time_record",
        "",
        json!({"date":"2026-10-19","startMinute":600,"endMinute":660,"categoryId":"work","title":"다음 날"}),
    );
    assert_eq!(
        query_registry(&db, "time_query", &json!({})).unwrap()["totalCount"],
        4
    );
    undo(&db, &user, &overwrite.id).unwrap();
    let result = query_registry(&db, "time_query", &json!({})).unwrap();
    let rows = result["timeRecords"].as_array().unwrap();
    assert_eq!(rows.len(), 2);
    assert!(rows.iter().any(|item| item["id"] == original.target_id
        && item["startMinute"] == 540
        && item["endMinute"] == 720));
    assert!(rows.iter().any(|item| item["title"] == "다음 날"));
}

#[test]
fn registry_only_exposes_installed_actions_and_keeps_connection_secrets_out() {
    let db = database();
    let directory = tempfile::tempdir().unwrap();
    assert!(!catalog(&db)
        .unwrap()
        .iter()
        .any(|item| item["id"] == "music_query"));
    storage::install(&db, directory.path(), &["music".into(), "weather".into()]).unwrap();
    let widget = storage::instances(&db)
        .unwrap()
        .into_iter()
        .find(|widget| widget.kind == "music")
        .unwrap();
    let mut data = widget.data;
    data["config"] = json!({"accessToken":"secret-token","pairing":"private-pairing"});
    data["observation"] = json!({"title":"노래","observedAt":1});
    db.execute(
        "UPDATE widget_instances SET data=?1 WHERE id=?2",
        params![data.to_string(), widget.id],
    )
    .unwrap();
    let value = query_registry(&db, "music_query", &json!({}))
        .unwrap()
        .to_string();
    assert!(value.contains("노래"));
    assert!(!value.contains("secret-token"));
    assert!(!value.contains("private-pairing"));
    assert!(catalog(&db)
        .unwrap()
        .iter()
        .filter(|item| item["owner"] == "music")
        .all(|item| item["effect"] == "read"));
}

#[test]
fn statement_authorization_rejects_negation_hypotheticals_quotes_and_controls() {
    for query in [
        "오늘 컵라면 3000원 안 샀어",
        "내일 컵라면 3000원 살 거야",
        "만약 3000원 컵라면 샀다면",
        "친구가 3000원 컵라면 사먹음",
        "예시: 오늘 3000원 컵라면 사먹음",
        "오늘 3000원 썼다고 말했어",
    ] {
        assert!(
            authorize_registry(query, "ledger_create", "statement", query).is_err(),
            "{query}"
        );
    }
    assert!(
        authorize_registry("집중 시작했어", "focus_start", "statement", "집중 시작했어").is_err()
    );
    assert!(authorize_registry(
        "오늘 컵라면 먹음",
        "ledger_create",
        "statement",
        "없는 문장"
    )
    .is_err());
    authorize_registry(
        "컵라면 3000원 지출을 등록해줘",
        "ledger_create",
        "explicit",
        "등록해줘",
    )
    .unwrap();
    assert!(authorize_registry(
        "오늘 컵라면 샀어",
        "ledger_delete",
        "explicit",
        "오늘 컵라면 샀어"
    )
    .is_err());
    assert!(
        authorize_registry("컵라면을 메모해줘", "ledger_delete", "explicit", "메모해줘").is_err()
    );
    assert!(authorize_registry(
        "그는 ‘삭제해줘’라고 했어",
        "ledger_delete",
        "explicit",
        "삭제해줘"
    )
    .is_err());
    assert!(authorize_registry(
        "메모해: 가계부를 삭제해줘",
        "ledger_delete",
        "explicit",
        "삭제해줘"
    )
    .is_err());
    authorize_registry(
        "메모해: 다음에는 컵라면을 사먹지 마",
        "note_create",
        "explicit",
        "메모해",
    )
    .unwrap();
}

#[test]
fn statement_evidence_keeps_its_sentence_context_and_global_prohibitions() {
    authorize_registry(
        "오늘 3000원 컵라면 사먹음. 친구가 내일 발표 준비한대",
        "ledger_create",
        "statement",
        "컵라면 사먹음",
    )
    .unwrap();
    for (query, evidence) in [
        ("내일 컵라면 3000원 사먹음", "사먹음"),
        ("내일\n컵라면 3000원 사먹음", "사먹음"),
        ("내일 3.5천원 컵라면 사먹음", "사먹음"),
        ("오늘 컵라면 사먹음. 친구가 컵라면 사먹음", "컵라면 사먹음"),
        ("오늘 컵라면 사먹음. 기록하지 마", "컵라면 사먹음"),
        ("오늘 컵라면 사먹음. 만약 내일도 먹는다면", "컵라면 사먹음"),
    ] {
        assert!(
            authorize_registry(query, "ledger_create", "statement", evidence).is_err(),
            "{query}"
        );
    }
}

#[test]
fn time_colons_preserve_requests_without_opening_quoted_instructions() {
    for query in [
        "내일 14:00부터 15:00까지 회의 등록해줘",
        "내일 14：00부터 15：00까지 회의 등록해줘",
    ] {
        authorize_registry(query, "event_add", "explicit", "등록해줘").unwrap();
    }
    assert!(authorize_registry(
        "메모해: 내일 14:00부터 15:00까지 회의 등록해줘",
        "event_add",
        "explicit",
        "등록해줘",
    )
    .is_err());
}

#[test]
fn widget_controls_have_receipts_and_explicitly_cannot_be_undone() {
    let db = database();
    let directory = tempfile::tempdir().unwrap();
    storage::install(
        &db,
        directory.path(),
        &["small-match".into(), "focus-timer".into()],
    )
    .unwrap();
    let dice = run(&db, "match_dice", "", json!({}));
    assert_eq!(dice.undo_supported, Some(false));
    assert!(!dice.result.as_ref().unwrap()["a"]
        .as_str()
        .unwrap()
        .is_empty());
    let user = store::active_user_id(&db).unwrap();
    assert!(undo(&db, &user, &dice.id).is_err());
    let timer = run(
        &db,
        "focus_start",
        "",
        json!({"durationMs":1_500_000,"title":"책 읽기"}),
    );
    assert_eq!(timer.result.as_ref().unwrap()["status"], "running");
    assert_eq!(
        run(&db, "focus_pause", "", json!({}))
            .result
            .as_ref()
            .unwrap()["status"],
        "paused"
    );
}

#[test]
fn task_partial_edit_preserves_recurrence_and_undo_respects_diary_references() {
    let db = database();
    let directory = tempfile::tempdir().unwrap();
    storage::install(&db, directory.path(), &["todo".into()]).unwrap();
    let task = run(
        &db,
        "task_add",
        "",
        json!({"title":"독서","dueDate":"2026-10-18","repeat":"daily","memo":"원문\n유지"}),
    );
    run(
        &db,
        "task_update",
        &task.target_id,
        json!({"title":"저녁 독서"}),
    );
    let result = query_registry(&db, "task_query", &json!({})).unwrap();
    assert_eq!(result["items"][0]["memo"], "원문\n유지");
    assert_eq!(result["items"][0]["repeat"], "daily");
    let complete = run(&db, "task_complete", &task.target_id, json!({}));
    let user = store::active_user_id(&db).unwrap();
    undo(&db, &user, &complete.id).unwrap();
    assert_eq!(
        query_registry(&db, "task_query", &json!({})).unwrap()["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn preparation_create_receipt_selects_the_new_envelope_and_undo_preserves_existing_records() {
    let db = database();
    let user = store::active_user_id(&db).unwrap();
    let directory = tempfile::tempdir().unwrap();
    storage::install(
        &db,
        directory.path(),
        &["preparation".into(), "calendar".into()],
    )
    .unwrap();
    let event = run(
        &db,
        "event_add",
        "",
        json!({"title":"QA 등록 일정","allDay":true,"startDate":"2026-10-18","endDate":"2026-10-19"}),
    );
    let preparation = storage::instances(&db)
        .unwrap()
        .into_iter()
        .find(|widget| widget.kind == "preparation")
        .unwrap();
    let linked = json!({
        "id":"existing-linked-envelope","eventId":event.target_id,
        "eventLabel":"QA 등록 일정 연결",
        "checks":[{"id":"existing-check","text":"기존 준비물","done":true}],
        "links":[],"todoIds":[]
    });
    let mut data = preparation.data;
    data["envelopes"] = json!([linked]);
    storage::commit_data(&db, &preparation.id, preparation.revision, data, vec![], 1).unwrap();
    let created = run(
        &db,
        "preparation_create",
        "",
        json!({"title":"QA 소풍","date":"2026-10-19","checks":["도시락","물"]}),
    );
    let after = storage::get(&db, &preparation.id).unwrap().data;
    assert_ne!(after["envelopes"][0], linked);
    let new = after["envelopes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["title"] == "QA 소풍")
        .unwrap();
    assert_eq!(created.target_id, new["id"].as_str().unwrap());
    assert_eq!(created.result.as_ref().unwrap()["item"], *new);
    let independent = run(
        &db,
        "preparation_create",
        "",
        json!({"title":"나중에 만든 봉투"}),
    );
    undo(&db, &user, &created.id).unwrap();
    let remaining = storage::get(&db, &preparation.id).unwrap().data;
    let envelopes = remaining["envelopes"].as_array().unwrap();
    assert_eq!(envelopes.len(), 2);
    assert!(envelopes.contains(&linked));
    assert!(envelopes
        .iter()
        .any(|item| item["id"] == independent.target_id));
    assert!(!envelopes.iter().any(|item| item["id"] == created.target_id));
    assert_eq!(
        query_registry(&db, "event_query", &json!({})).unwrap()["events"][0]["id"],
        event.target_id
    );
}

#[test]
fn calendar_query_includes_timed_events_and_remote_events_remain_read_only() {
    let db = database();
    let directory = tempfile::tempdir().unwrap();
    storage::install(&db, directory.path(), &["calendar".into()]).unwrap();
    let start = chrono::DateTime::parse_from_rfc3339("2026-10-18T10:00:00+09:00")
        .unwrap()
        .timestamp_millis();
    let event = run(
        &db,
        "event_add",
        "",
        json!({"title":"회의","allDay":false,"startAt":start,"endAt":start+3600000,"timeZone":"Asia/Seoul"}),
    );
    assert_eq!(
        query_registry(
            &db,
            "event_query",
            &json!({"from":"2026-10-18","through":"2026-10-18"})
        )
        .unwrap()["totalCount"],
        1
    );
    let widget = storage::instances(&db)
        .unwrap()
        .into_iter()
        .find(|widget| widget.kind == "calendar")
        .unwrap();
    let mut data = widget.data;
    data["events"][0]["connectionId"] = json!("remote");
    db.execute(
        "UPDATE widget_instances SET data=?1 WHERE id=?2",
        params![data.to_string(), widget.id],
    )
    .unwrap();
    let user = store::active_user_id(&db).unwrap();
    let revision = entities_for(&db, "event_delete", "").unwrap()["revision"]
        .as_i64()
        .unwrap();
    assert!(execute_registry(
        &db,
        &user,
        "external-delete",
        0,
        "일정을 삭제해",
        &Action {
            kind: "event_delete".into(),
            target_id: event.target_id,
            expected_revision: revision,
            input: json!({})
        }
    )
    .unwrap_err()
    .contains("외부 캘린더"));
}

#[test]
fn memo_owners_are_distinct_and_open_drafts_are_protected() {
    let db = database();
    let directory = tempfile::tempdir().unwrap();
    storage::install(&db, directory.path(), &["memo".into()]).unwrap();
    run(
        &db,
        "note_create",
        "",
        json!({"title":"다이어리","body":"다이어리 원문"}),
    );
    let memo = run(
        &db,
        "memo_create",
        "",
        json!({"title":"바탕화면","body":"바탕화면 원문"}),
    );
    assert_eq!(
        query_registry(&db, "note_query", &json!({})).unwrap()["notes"][0]["body"],
        "다이어리 원문"
    );
    let widget = storage::instances(&db)
        .unwrap()
        .into_iter()
        .find(|widget| widget.kind == "memo")
        .unwrap();
    storage::execute(
        &db,
        &WidgetRequest {
            request_id: uuid::Uuid::new_v4().to_string(),
            instance_id: widget.id,
            expected_revision: widget.revision,
            action: "update".into(),
            input: json!({"id":memo.target_id,"isOpen":true}),
        },
        1,
        1,
    )
    .unwrap();
    let user = store::active_user_id(&db).unwrap();
    let revision = entities_for(&db, "memo_update", "").unwrap()["revision"]
        .as_i64()
        .unwrap();
    assert!(execute_registry(
        &db,
        &user,
        "draft",
        0,
        "메모를 수정해",
        &Action {
            kind: "memo_update".into(),
            target_id: memo.target_id,
            expected_revision: revision,
            input: json!({"body":"대체 본문"})
        }
    )
    .unwrap_err()
    .contains("열린 메모"));
    assert_eq!(
        query_registry(&db, "memo_query", &json!({})).unwrap()["notes"][0]["body"],
        "바탕화면 원문"
    );
}

#[test]
fn undo_removes_new_default_fields_instead_of_storing_invalid_nulls() {
    let db = database();
    let directory = tempfile::tempdir().unwrap();
    storage::install(&db, directory.path(), &["clock".into()]).unwrap();
    let before = storage::instances(&db)
        .unwrap()
        .into_iter()
        .find(|widget| widget.kind == "clock")
        .unwrap()
        .data;
    let anniversary = run(
        &db,
        "anniversary_add",
        "",
        json!({"title":"생일","date":"2026-10-18"}),
    );
    let user = store::active_user_id(&db).unwrap();
    undo(&db, &user, &anniversary.id).unwrap();
    let after = storage::instances(&db)
        .unwrap()
        .into_iter()
        .find(|widget| widget.kind == "clock")
        .unwrap()
        .data;
    assert_eq!(before, after);
    run(
        &db,
        "anniversary_add",
        "",
        json!({"title":"다른 기념일","date":"2026-10-19"}),
    );
}

#[test]
fn deleting_or_undoing_a_referenced_task_is_atomic_and_rejected() {
    let db = database();
    let directory = tempfile::tempdir().unwrap();
    storage::install(&db, directory.path(), &["todo".into()]).unwrap();
    let task = run(&db, "task_add", "", json!({"title":"원고 쓰기"}));
    let page = run(&db, "page_create", "", json!({"title":"오늘"}));
    let revision = entities_for(&db, "page_record", "").unwrap()["revision"]
        .as_u64()
        .unwrap();
    let tx = db.unchecked_transaction().unwrap();
    diary::update_in_transaction(&tx,revision,"entry-add",&json!({"pageId":page.target_id,"kind":"todo","text":"연결된 할 일","refId":task.target_id})).unwrap();
    tx.commit().unwrap();
    let user = store::active_user_id(&db).unwrap();
    assert!(undo(&db, &user, &task.id).unwrap_err().contains("참조"));
    let revision = entities_for(&db, "task_delete", "").unwrap()["revision"]
        .as_i64()
        .unwrap();
    assert!(execute_registry(
        &db,
        &user,
        "remove-reference",
        0,
        "할 일을 삭제해",
        &Action {
            kind: "task_delete".into(),
            target_id: task.target_id,
            expected_revision: revision,
            input: json!({})
        }
    )
    .unwrap_err()
    .contains("참조"));
    assert_eq!(
        query_registry(&db, "task_query", &json!({})).unwrap()["totalCount"],
        1
    );
    assert!(receipts(&db, &user, Some("remove-reference"))
        .unwrap()
        .is_empty());
}
