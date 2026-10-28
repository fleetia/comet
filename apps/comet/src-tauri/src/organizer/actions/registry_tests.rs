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

/// String-rule authorization, as when a turn has no stored request analysis.
fn authorize(query: &str, kind: &str, mode: &str, evidence: &str) -> Result<()> {
    authorize_registry(query, kind, mode, evidence, has_explicit_request(query))
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
    authorize(
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
fn registry_exposes_official_actions_and_keeps_connection_secrets_out() {
    let db = database();
    assert!(catalog(&db)
        .unwrap()
        .iter()
        .any(|item| item["id"] == "music_query"));
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
            authorize(query, "ledger_create", "statement", query).is_err(),
            "{query}"
        );
    }
    assert!(authorize("집중 시작했어", "focus_start", "statement", "집중 시작했어").is_err());
    assert!(authorize(
        "오늘 컵라면 먹음",
        "ledger_create",
        "statement",
        "없는 문장"
    )
    .is_err());
    authorize(
        "컵라면 3000원 지출을 등록해줘",
        "ledger_create",
        "explicit",
        "등록해줘",
    )
    .unwrap();
    assert!(authorize(
        "오늘 컵라면 샀어",
        "ledger_delete",
        "explicit",
        "오늘 컵라면 샀어"
    )
    .is_err());
    assert!(authorize("컵라면을 메모해줘", "ledger_delete", "explicit", "메모해줘").is_err());
    assert!(authorize(
        "그는 ‘삭제해줘’라고 했어",
        "ledger_delete",
        "explicit",
        "삭제해줘"
    )
    .is_err());
    assert!(authorize(
        "메모해: 가계부를 삭제해줘",
        "ledger_delete",
        "explicit",
        "삭제해줘"
    )
    .is_err());
    authorize(
        "메모해: 다음에는 컵라면을 사먹지 마",
        "note_create",
        "explicit",
        "메모해",
    )
    .unwrap();
}

#[test]
fn statement_evidence_keeps_its_sentence_context_and_global_prohibitions() {
    authorize(
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
            authorize(query, "ledger_create", "statement", evidence).is_err(),
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
        authorize(query, "event_add", "explicit", "등록해줘").unwrap();
    }
    assert!(authorize(
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
fn task_focus_start_clears_previous_context_and_preserves_source_records() {
    let db = database();
    let task = run(
        &db,
        "task_add",
        "",
        json!({"title":"자료 검토","memo":"할 일 원문"}),
    );
    let note = run(
        &db,
        "note_create",
        "",
        json!({"title":"이전 노트","body":"노트 원문"}),
    );
    let todos = storage::instances(&db)
        .unwrap()
        .into_iter()
        .find(|widget| widget.kind == "todo")
        .unwrap();
    let notes = diary::read(&db).unwrap();
    let timer = storage::instances(&db)
        .unwrap()
        .into_iter()
        .find(|widget| widget.kind == "focus-timer")
        .unwrap();
    let mut data = timer.data;
    data["title"] = json!("이전 작업");
    data["memo"] = json!("이전 집중 메모");
    data["eventRef"] =
        json!({"calendarWidgetId":"calendar","id":"previous-event","title":"이전 일정"});
    data["noteRef"] = json!({"kind":"diary","id":note.target_id,"title":"이전 노트"});
    db.execute(
        "UPDATE widget_instances SET data=?1 WHERE id=?2",
        params![data.to_string(), timer.id],
    )
    .unwrap();
    for (action, input, now) in [
        ("start", json!({"durationMs":10000}), 1000),
        ("cancel", json!({}), 2000),
    ] {
        let current = storage::get(&db, &timer.id).unwrap();
        storage::execute(
            &db,
            &WidgetRequest {
                request_id: uuid::Uuid::new_v4().to_string(),
                instance_id: timer.id.clone(),
                expected_revision: current.revision,
                action: action.into(),
                input,
            },
            now,
            0,
        )
        .unwrap();
    }
    let history = storage::get(&db, &timer.id).unwrap().data["sessions"].clone();
    for title in [None, Some("직접 정한 집중 제목")] {
        let mut input = json!({"durationMs":1500000,"todoId":task.target_id});
        if let Some(title) = title {
            input["title"] = json!(title);
        }
        run(&db, "focus_start", "", input);
        let current = storage::get(&db, &timer.id).unwrap().data;
        for context in [&current, &current["activeSession"]] {
            assert_eq!(context["title"], title.unwrap_or("자료 검토"));
            assert_eq!(context["todoId"], task.target_id);
            assert_eq!(context["memo"], "");
            assert!(context["eventRef"].is_null());
            assert!(context["noteRef"].is_null());
        }
        assert_eq!(
            current["sessions"].as_array().unwrap().first(),
            history.as_array().unwrap().first()
        );
        assert_eq!(storage::get(&db, &todos.id).unwrap().data, todos.data);
        assert_eq!(diary::read(&db).unwrap(), notes);
        run(&db, "focus_cancel", "", json!({}));
    }
}

#[test]
fn task_partial_edit_preserves_recurrence_and_undo_respects_diary_references() {
    let db = database();
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
fn calendar_query_accepts_rfc3339_bounds_as_inclusive_calendar_dates() {
    let db = database();
    for (title, start, end) in [
        ("어제 일정", "2026-10-20", "2026-10-21"),
        ("오늘 종일 일정", "2026-10-21", "2026-10-22"),
        ("내일 일정", "2026-10-22", "2026-10-23"),
    ] {
        run(
            &db,
            "event_add",
            "",
            json!({"title":title,"allDay":true,"startDate":start,"endDate":end}),
        );
    }
    let start = chrono::DateTime::parse_from_rfc3339("2026-10-21T00:30:00+09:00")
        .unwrap()
        .timestamp_millis();
    run(
        &db,
        "event_add",
        "",
        json!({"title":"오늘 시간 일정","allDay":false,"startAt":start,"endAt":start+3600000,"timeZone":"Asia/Seoul"}),
    );
    let canonical = query_registry(
        &db,
        "event_query",
        &json!({"from":"2026-10-21","through":"2026-10-21"}),
    )
    .unwrap();
    let timestamp_bounds = query_registry(
        &db,
        "event_query",
        &json!({"from":"2026-10-21T00:00:00+09:00","through":"2026-10-21T23:59:59.999+09:00"}),
    )
    .unwrap();
    assert_eq!(timestamp_bounds, canonical);
    assert_eq!(timestamp_bounds["totalCount"], 2);
    let events = timestamp_bounds["events"].as_array().unwrap();
    assert!(events
        .iter()
        .any(|event| event["title"] == "오늘 종일 일정"));
    assert!(events
        .iter()
        .any(|event| event["title"] == "오늘 시간 일정"));
    for bounds in [
        json!({"from":"2026-10-21T00:00:00+09:00"}),
        json!({"through":"2026-10-21T23:59:59.999+09:00"}),
    ] {
        assert_eq!(
            query_registry(&db, "event_query", &bounds).unwrap()["totalCount"],
            3,
            "{bounds}"
        );
    }
}

#[test]
fn calendar_query_rejects_invalid_ambiguous_and_reversed_date_bounds() {
    let db = database();
    for bounds in [
        json!({"from":"2026-02-30"}),
        json!({"through":"2026-02-30T23:59:59+09:00"}),
        json!({"from":"2026-10-21T00:00:00"}),
        json!({"through":"2026-10-21T23:59:59+09:00 trailing"}),
        json!({"from":"2026-10-22","through":"2026-10-21"}),
        json!({"from":"2026-10-22T00:00:00+09:00","through":"2026-10-21T23:59:59.999+09:00"}),
    ] {
        assert_eq!(
            query_registry(&db, "event_query", &bounds).unwrap_err(),
            "조회할 날짜 범위를 확인해 주세요.",
            "{bounds}"
        );
    }
}

#[test]
fn calendar_query_includes_timed_events_and_remote_events_remain_read_only() {
    let db = database();
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

fn ask(db: &Connection, kind: &str, target: &str, input: Value, query: &str) -> Result<Receipt> {
    let user = store::active_user_id(db).unwrap();
    let revision = entities_for(db, kind, "").unwrap()["revision"]
        .as_i64()
        .unwrap();
    execute_registry(
        db,
        &user,
        &uuid::Uuid::new_v4().to_string(),
        0,
        query,
        &Action {
            kind: kind.into(),
            target_id: target.into(),
            expected_revision: revision,
            input,
        },
    )
}

fn saved_diary(db: &Connection) -> Value {
    serde_json::to_value(diary::read(db).unwrap()).unwrap()
}

#[test]
fn travel_booking_from_conversation_follows_the_ledger_and_undoes_together() {
    let db = database();
    let user = store::active_user_id(&db).unwrap();
    let travel = ask(
        &db,
        "travel_create",
        "",
        json!({"title":"오사카","destination":"오사카","startDate":"2026-11-01",
               "endDate":"2026-11-03","timeZone":"Asia/Tokyo","currency":"JPY"}),
        "오사카 여행 만들어줘",
    )
    .unwrap()
    .target_id;
    let hotel = json!({"travelId":travel,"kind":"stay","title":"난바 호텔","status":"paid",
                       "amount":"24000","startDate":"2026-11-01"});
    let missing = ask(
        &db,
        "travel_booking_add",
        "",
        hotel.clone(),
        "난바 호텔 24000엔 예약 추가해줘",
    );
    assert!(missing.unwrap_err().contains("JPY 환율"));
    let mut rated = hotel;
    rated["rate"] = json!("9.12");
    rated["confirmation"] = json!("HX-99812");
    let booking = ask(
        &db,
        "travel_booking_add",
        "",
        rated,
        "난바 호텔 24000엔, 예약번호 HX-99812, 환율 9.12로 예약 추가해줘",
    )
    .unwrap();
    assert_eq!(booking.title, "오사카 · 난바 호텔");
    assert_eq!(
        booking.result.as_ref().unwrap()["item"]["confirmation"],
        "•••• 9812"
    );
    let lunch = ask(
        &db,
        "travel_expense_add",
        "",
        json!({"travelId":travel,"title":"라멘","date":"2026-11-01","amount":"1200","paid":true}),
        "라멘 1200엔 비용 추가해줘",
    )
    .unwrap();
    assert_eq!(lunch.result.as_ref().unwrap()["item"]["rate"], 91_200);
    let trip = query_registry(&db, "travel_query", &json!({"travelId":travel})).unwrap();
    assert_eq!(trip["travelBookings"][0]["confirmation"], "•••• 9812");
    assert!(!trip.to_string().contains("HX-99812"));
    assert_eq!(trip["summary"]["paid"], 218_880 + 10_944);
    assert_eq!(
        query_registry(&db, "ledger_query", &json!({})).unwrap()["expenseTotal"],
        218_880 + 10_944
    );
    undo(&db, &user, &booking.id).unwrap();
    let trip = query_registry(&db, "travel_query", &json!({"travelId":travel})).unwrap();
    assert_eq!(trip["travelBookings"], json!([]));
    assert_eq!(trip["travelExpenses"].as_array().unwrap().len(), 1);
    assert_eq!(
        query_registry(&db, "ledger_query", &json!({})).unwrap()["expenseTotal"],
        10_944
    );
    // Yen amount and rate must not carry over into dollars.
    for (input, error) in [
        (json!({"currency":"USD"}), "금액"),
        (json!({"currency":"USD","amount":"8.50"}), "USD 환율"),
    ] {
        let failed = ask(
            &db,
            "travel_expense_update",
            &lunch.target_id,
            input,
            "라멘 달러로 바꿔줘",
        );
        assert!(failed.unwrap_err().contains(error));
    }
    ask(
        &db,
        "travel_expense_update",
        &lunch.target_id,
        json!({"currency":"USD","amount":"8.50","rate":"1380"}),
        "라멘 8.50달러, 환율 1380으로 바꿔줘",
    )
    .unwrap();
    let saved = saved_diary(&db);
    assert_eq!(saved["travelExpenses"][0]["amount"], 850);
    assert_eq!(saved["travelExpenses"][0]["rate"], 13_800_000);
    assert_eq!(
        query_registry(&db, "ledger_query", &json!({})).unwrap()["expenseTotal"],
        11_730
    );
}

#[test]
fn travel_defaults_skip_unpriced_rates_and_deleted_categories() {
    let db = database();
    let travel = ask(
        &db,
        "travel_create",
        "",
        json!({"title":"오사카","startDate":"2026-11-01","endDate":"2026-11-03",
               "timeZone":"Asia/Tokyo","currency":"JPY"}),
        "오사카 여행 만들어줘",
    )
    .unwrap()
    .target_id;
    ask(
        &db,
        "travel_booking_add",
        "",
        json!({"travelId":travel,"kind":"stay","title":"료칸","status":"unpaid",
               "startDate":"2026-11-01"}),
        "료칸 예약 추가해줘",
    )
    .unwrap();
    assert_eq!(saved_diary(&db)["travelBookings"][0]["rate"], 10_000);
    // The unpriced booking's placeholder is not a JPY rate the user gave.
    let snack =
        json!({"travelId":travel,"title":"간식","date":"2026-11-01","amount":"500","paid":true});
    assert!(ask(
        &db,
        "travel_expense_add",
        "",
        snack.clone(),
        "간식 500엔 추가해줘"
    )
    .unwrap_err()
    .contains("JPY 환율"));
    let mut saved = saved_diary(&db);
    let categories = saved["ledgerSettings"]["categories"]
        .as_array_mut()
        .unwrap();
    categories.retain(|category| category["id"] != "other");
    let first = categories[0]["id"].clone();
    let state: diary::DiaryState = serde_json::from_value(saved).unwrap();
    let mut model = snack;
    model["rate"] = json!("9.12");
    let mut payload = model.clone();
    diary::travel_conversation::prepare(
        &state,
        "travel_expense_add",
        &model,
        &mut payload,
        None,
        "",
    )
    .unwrap();
    assert_eq!(payload["category"], first);
}

#[test]
fn travel_context_is_bounded_and_finish_phrasings_are_explicit() {
    let db = database();
    let travel = ask(
        &db,
        "travel_create",
        "",
        json!({"title":"제주","startDate":"2026-11-01","endDate":"2026-11-02",
               "timeZone":"Asia/Seoul","currency":"KRW"}),
        "제주 여행 만들어줘",
    )
    .unwrap()
    .target_id;
    for day in 0..35 {
        ask(
            &db,
            "travel_plan_add",
            "",
            json!({"travelId":travel,"kind":"plan","date":"2026-11-01",
                   "title":format!("일정 {day}"),"memo":"메".repeat(2000)}),
            "일정 추가해줘",
        )
        .unwrap();
    }
    let context = entities_for(&db, "travel_plan_update", "").unwrap();
    assert_eq!(context["travelPlans"].as_array().unwrap().len(), 30);
    assert_eq!(context["travels"][0]["linked"]["plans"], 35);
    assert!(context["travelPlans"][0]["truncatedFields"]
        .to_string()
        .contains("memo"));
    let trip = query_registry(&db, "travel_query", &json!({"travelId":travel})).unwrap();
    assert_eq!(trip["travelPlans"].as_array().unwrap().len(), 30);
    assert_eq!(trip["totalCounts"]["travelPlans"], 35);
    for request in ["제주 여행 끝내줘", "여행 다시 정리해줘", "finish my trip"] {
        assert!(has_explicit_request(request), "{request}");
    }
}

#[test]
fn travel_edits_keep_unmentioned_fields_and_never_take_masked_or_invented_numbers() {
    let db = database();
    let travel = ask(
        &db,
        "travel_create",
        "",
        json!({"title":"제주","startDate":"2026-11-01","endDate":"2026-11-02",
               "timeZone":"Asia/Seoul","currency":"KRW","budget":500_000}),
        "제주 여행 만들어줘",
    )
    .unwrap()
    .target_id;
    let booking = ask(
        &db,
        "travel_booking_add",
        "",
        json!({"travelId":travel,"kind":"stay","title":"애월 숙소","status":"paid",
               "amount":"400000","startDate":"2026-11-01","confirmation":"AB12-4821"}),
        "애월 숙소 40만원, 예약번호 AB12-4821 예약 추가해줘",
    )
    .unwrap()
    .target_id;
    ask(
        &db,
        "travel_booking_update",
        &booking,
        json!({"title":"애월 숙소 B"}),
        "숙소 이름 바꿔줘",
    )
    .unwrap();
    let saved = saved_diary(&db);
    assert_eq!(saved["travelBookings"][0]["confirmation"], "AB12-4821");
    assert_eq!(saved["travelBookings"][0]["title"], "애월 숙소 B");
    assert_eq!(saved["travelBookings"][0]["category"], "housing");
    assert_eq!(saved["travels"][0]["budget"], 500_000);
    for (value, query) in [
        ("•••• 4821", "예약번호 •••• 4821로 바꿔줘"),
        ("ZZ-0001", "예약번호 바꿔줘"),
    ] {
        assert!(ask(
            &db,
            "travel_booking_update",
            &booking,
            json!({"confirmation":value}),
            query
        )
        .unwrap_err()
        .contains("예약번호"));
    }
    let context = entities_for(&db, "travel_booking_update", "").unwrap();
    assert_eq!(context["travelBookings"][0]["confirmation"], "•••• 4821");
    assert!(!context.to_string().contains("AB12-4821"));
    assert!(ask(
        &db,
        "travel_expense_add",
        "",
        json!({"travelId":travel,"title":"귤","date":"2026-11-01","amount":"12.5","paid":true}),
        "귤 12.5원 비용 추가해줘",
    )
    .unwrap_err()
    .contains("KRW"));
    let plan = ask(
        &db,
        "travel_plan_add",
        "",
        json!({"travelId":travel,"kind":"plan","date":"2026-11-01","title":"오름"}),
        "오름 일정 추가해줘",
    )
    .unwrap()
    .target_id;
    assert!(ask(
        &db,
        "travel_plan_update",
        &plan,
        json!({"travelId":"other"}),
        "일정 옮겨줘"
    )
    .is_err());
    let finished = ask(
        &db,
        "travel_finish",
        &travel,
        json!({"finished":true}),
        "제주 여행 정리 마쳐줘",
    )
    .unwrap();
    assert_eq!(finished.result.as_ref().unwrap()["item"]["finished"], true);
    assert_eq!(saved_diary(&db)["travels"][0]["budget"], 500_000);
    let user = store::active_user_id(&db).unwrap();
    let removed = ask(&db, "travel_delete", &travel, json!({}), "제주 여행 지워줘").unwrap();
    assert_eq!(removed.title, "제주");
    let saved = saved_diary(&db);
    assert_eq!(saved["travels"], json!([]));
    assert_eq!(saved["travelBookings"], json!([]));
    assert_eq!(saved["ledgerEntries"].as_array().unwrap().len(), 1);
    undo(&db, &user, &removed.id).unwrap();
    assert_eq!(
        saved_diary(&db)["travelBookings"][0]["confirmation"],
        "AB12-4821"
    );
}
