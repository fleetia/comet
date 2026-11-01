use super::*;

fn stamp(value: &str) -> i64 {
    DateTime::parse_from_rfc3339(value)
        .unwrap()
        .timestamp_millis()
}
fn run(data: &Value, action: &str, input: Value, now: i64) -> WidgetEffect {
    act("todo", data, action, &input, &BTreeMap::new(), now, 17).unwrap()
}
fn reject(data: &Value, action: &str, input: Value, now: i64) {
    assert!(act("todo", data, action, &input, &BTreeMap::new(), now, 17).is_err());
}
fn rule(mode: &str, unit: &str) -> Value {
    json!({"mode":mode,"unit":unit,"interval":1,"timeZone":"UTC"})
}

#[test]
fn plan_selection_and_batch_creation_preserve_due_and_normalize_period_anchor() {
    let batch = run(
        &initial("todo"),
        "batch-add",
        json!({"listName":"집안일","items":[
            {"title":"침구 세탁","dueDate":"2026-09-24","planPeriod":"week","planAnchor":"2026-09-23"},
            {"title":"서랍 정리","planPeriod":"someday"}
        ]}),
        1,
    );
    let key = batch.data["items"][0]["id"].clone();
    assert_eq!(batch.data["items"][0]["planAnchor"], "2026-09-21");
    assert_eq!(
        batch.data["items"][0]["listId"],
        batch.data["lists"][1]["id"]
    );
    let planned = run(
        &batch.data,
        "plan",
        json!({"ids":[key],"date":"2026-09-21"}),
        2,
    );
    assert_eq!(planned.data["items"][0]["plannedDate"], "2026-09-21");
    assert_eq!(planned.data["items"][0]["dueDate"], "2026-09-24");
    assert_eq!(planned.data["items"][1], batch.data["items"][1]);
    let removed = run(&planned.data, "plan", json!({"ids":[key],"date":null}), 3);
    assert!(removed.data["items"][0]["plannedDate"].is_null());
    reject(
        &batch.data,
        "batch-add",
        json!({"listName":"실패하는 목록","items":[{"title":"valid"},{"title":""}]}),
        4,
    );
    assert_eq!(batch.data["items"].as_array().unwrap().len(), 2);
    assert_eq!(batch.data["lists"].as_array().unwrap().len(), 2);
    reject(
        &batch.data,
        "plan",
        json!({"ids":[key,"missing"],"date":"2026-09-22"}),
        5,
    );
}

#[test]
fn legacy_dates_and_generation_snapshot_migrate_without_losing_today_or_undo() {
    let added = run(
        &initial("todo"),
        "add",
        json!({"title":"원래 할 일","dueDate":"2026-09-21","repeat":"daily"}),
        1,
    );
    let key = added.data["items"][0]["id"].clone();
    let completed = run(&added.data, "complete", json!({"id":key}), 2);
    let mut legacy = completed.data;
    for item in legacy["items"].as_array_mut().unwrap() {
        for field in [
            "planPeriod",
            "planAnchor",
            "plannedDate",
            "repeatRule",
            "frequencyRecords",
            "continuation",
        ] {
            item.as_object_mut().unwrap().remove(field);
            if let Some(snapshot) = item
                .get_mut("generation")
                .and_then(Value::as_object_mut)
                .and_then(|generation| generation.get_mut("snapshot"))
                .and_then(Value::as_object_mut)
            {
                snapshot.remove(field);
            }
        }
    }
    let undone = run(&legacy, "undo", json!({"id":key}), 3);
    assert_eq!(undone.data["items"].as_array().unwrap().len(), 1);
    assert_eq!(undone.data["items"][0]["plannedDate"], "2026-09-21");
    let removed = run(&undone.data, "plan", json!({"ids":[key],"date":null}), 4);
    let unrelated = run(&removed.data, "add", json!({"title":"다른 항목"}), 5);
    assert!(unrelated.data["items"][0]["plannedDate"].is_null());
}

#[test]
fn calendar_completion_weekdays_and_skip_use_distinct_bases() {
    let now = stamp("2026-09-25T12:00:00Z");
    for (mode, expected) in [("calendar", "2026-09-22"), ("completion", "2026-09-26")] {
        let added = run(
            &initial("todo"),
            "add",
            json!({"title":"물 주기","dueDate":"2026-09-21","repeatRule":rule(mode,"day")}),
            1,
        );
        let key = added.data["items"][0]["id"].clone();
        let completed = run(&added.data, "complete", json!({"id":key}), now);
        assert_eq!(completed.data["items"][1]["dueDate"], expected);
        if mode == "completion" {
            reject(&added.data, "skip", json!({"id":key}), now);
        }
    }
    let added = run(
        &initial("todo"),
        "add",
        json!({"title":"산책","dueDate":"2026-09-21","repeatRule":{
            "mode":"calendar","unit":"week","interval":2,"weekdays":[0,2,4]
        }}),
        1,
    );
    let key = added.data["items"][0]["id"].clone();
    let skipped = run(&added.data, "skip", json!({"id":key}), 2);
    assert_eq!(skipped.data["items"][0]["dueDate"], "2026-09-23");
    assert!(skipped.data["items"][0]["completedAt"].is_null());
    assert!(skipped.events.is_empty());
    let skipped = run(&skipped.data, "skip", json!({"id":key}), 3);
    let skipped = run(&skipped.data, "skip", json!({"id":key}), 4);
    assert_eq!(skipped.data["items"][0]["dueDate"], "2026-10-05");
    assert_eq!(skipped.data["items"][0]["plannedDate"], "2026-10-05");
}

#[test]
fn deleting_an_occurrence_keeps_the_next_calendar_completion_and_frequency_occurrence() {
    let now = stamp("2026-09-25T12:00:00Z");
    let calendar = run(
        &initial("todo"),
        "add",
        json!({"title":"날짜 반복","dueDate":"2026-09-21","repeatRule":rule("calendar","day")}),
        1,
    );
    let calendar_id = calendar.data["items"][0]["id"].clone();
    let skipped = run(&calendar.data, "skip", json!({"id":calendar_id}), now);
    assert_eq!(skipped.data["items"][0]["dueDate"], "2026-09-22");
    assert_eq!(skipped.data["items"][0]["id"], calendar_id);
    let edited_calendar = run(
        &calendar.data,
        "update",
        json!({"id":calendar_id,"repeatRule":null,"scope":"occurrence"}),
        now,
    );
    let skipped_edited = run(
        &edited_calendar.data,
        "skip",
        json!({"id":calendar_id}),
        now,
    );
    assert_eq!(skipped_edited.data["items"][0]["dueDate"], "2026-09-22");
    assert_eq!(
        skipped_edited.data["items"][0]["repeatRule"]["mode"],
        "calendar"
    );

    let completion = run(
        &initial("todo"),
        "add",
        json!({"title":"완료 기준","dueDate":"2026-09-21","repeatRule":rule("completion","day")}),
        1,
    );
    let completion_id = completion.data["items"][0]["id"].clone();
    let next = run(
        &completion.data,
        "delete-occurrence",
        json!({"id":completion_id}),
        now,
    );
    assert_eq!(next.data["items"].as_array().unwrap().len(), 1);
    assert_ne!(next.data["items"][0]["id"], completion_id);
    assert_eq!(next.data["items"][0]["dueDate"], "2026-09-26");
    assert_eq!(next.data["items"][0]["repeatRule"]["mode"], "completion");
    let edited_completion = run(
        &completion.data,
        "update",
        json!({"id":completion_id,"repeatRule":null,"scope":"occurrence"}),
        now,
    );
    let next_edited = run(
        &edited_completion.data,
        "delete-occurrence",
        json!({"id":completion_id}),
        now,
    );
    assert_eq!(next_edited.data["items"][0]["dueDate"], "2026-09-26");
    assert_eq!(
        next_edited.data["items"][0]["repeatRule"]["mode"],
        "completion"
    );

    let frequency = run(
        &initial("todo"),
        "add",
        json!({"title":"주간 목표","repeatRule":{"mode":"frequency","unit":"week","interval":1,"timesPerWeek":2,"timeZone":"UTC"}}),
        1,
    );
    let frequency_id = frequency.data["items"][0]["id"].clone();
    let recorded = run(
        &frequency.data,
        "record-frequency",
        json!({"id":frequency_id,"date":"2026-09-21"}),
        now,
    );
    let next = run(
        &recorded.data,
        "delete-occurrence",
        json!({"id":frequency_id}),
        now,
    );
    assert_eq!(next.data["items"].as_array().unwrap().len(), 1);
    assert_ne!(next.data["items"][0]["id"], frequency_id);
    assert_eq!(next.data["items"][0]["planAnchor"], "2026-09-28");
    assert_eq!(next.data["items"][0]["repeatRule"]["mode"], "frequency");
    assert_eq!(
        next.data["items"][0]["frequencyRecords"],
        recorded.data["items"][0]["frequencyRecords"]
    );
    let future = run(
        &frequency.data,
        "update",
        json!({"id":frequency_id,"planPeriod":"week","planAnchor":"2026-10-12"}),
        now,
    );
    let future_next = run(
        &future.data,
        "delete-occurrence",
        json!({"id":frequency_id}),
        now,
    );
    assert_eq!(future_next.data["items"][0]["planAnchor"], "2026-10-19");
    reject(
        &calendar.data,
        "delete-occurrence",
        json!({"id":calendar_id}),
        now,
    );
}

#[test]
fn ending_a_repeat_refuses_to_erase_frequency_history_without_changing_delete() {
    let now = stamp("2026-09-25T12:00:00Z");
    let added = run(
        &initial("todo"),
        "add",
        json!({"title":"산책","repeatRule":{"mode":"frequency","unit":"week","interval":1,"timesPerWeek":2,"timeZone":"UTC"}}),
        1,
    );
    let key = added.data["items"][0]["id"].clone();
    let recorded = run(
        &added.data,
        "record-frequency",
        json!({"id":key,"date":"2026-09-21"}),
        now,
    );
    let result = act(
        "todo",
        &recorded.data,
        "end-repeat",
        &json!({"id":key}),
        &BTreeMap::new(),
        now,
        17,
    );
    assert_eq!(
        result.err().as_deref(),
        Some("주간 횟수 기록을 보존하려면 반복을 끝낼 수 없습니다.")
    );
    assert_eq!(
        recorded.data["items"][0]["frequencyRecords"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let deleted = run(&recorded.data, "delete", json!({"id":key}), now);
    assert!(deleted.data["items"].as_array().unwrap().is_empty());
    let ended = run(&added.data, "end-repeat", json!({"id":key}), now);
    assert!(ended.data["items"].as_array().unwrap().is_empty());
}

#[test]
fn completed_occurrence_deletion_keeps_existing_next_and_cannot_claim_to_end_it() {
    let added = run(
        &initial("todo"),
        "add",
        json!({"title":"반복","dueDate":"2026-09-21","repeatRule":rule("calendar","day")}),
        1,
    );
    let key = added.data["items"][0]["id"].clone();
    let completed = run(&added.data, "complete", json!({"id":key}), 2);
    let next = completed.data["items"][1].clone();
    let result = act(
        "todo",
        &completed.data,
        "end-repeat",
        &json!({"id":key}),
        &BTreeMap::new(),
        3,
        17,
    );
    assert_eq!(
        result.err().as_deref(),
        Some("이미 만들어진 다음 회차에서 반복을 끝내 주세요.")
    );
    let deleted = run(&completed.data, "delete", json!({"id":key}), 3);
    assert_eq!(
        deleted.data["items"].as_array().unwrap().as_slice(),
        &[next]
    );
    let mut legacy = completed.data.clone();
    legacy["items"][0]["generation"] = Value::Null;
    reject(&legacy, "end-repeat", json!({"id":key}), 4);
}

#[test]
fn deleting_an_edited_occurrence_keeps_frequency_records_newer_than_its_template() {
    let now = stamp("2026-09-25T12:00:00Z");
    for (mode, action) in [("calendar", "skip"), ("completion", "delete-occurrence")] {
        let added = run(
            &initial("todo"),
            "add",
            json!({"title":"반복","dueDate":"2026-09-21","repeatRule":rule(mode,"day")}),
            1,
        );
        let key = added.data["items"][0]["id"].clone();
        let edited = run(
            &added.data,
            "update",
            json!({"id":key,"scope":"occurrence","repeatRule":{"mode":"frequency","unit":"week","interval":1,"timesPerWeek":2,"timeZone":"UTC"}}),
            2,
        );
        let recorded = run(
            &edited.data,
            "record-frequency",
            json!({"id":key,"date":"2026-09-21"}),
            now,
        );
        let next = run(&recorded.data, action, json!({"id":key}), now);
        assert_eq!(next.data["items"][0]["repeatRule"]["mode"], mode);
        assert_eq!(
            next.data["items"][0]["frequencyRecords"],
            recorded.data["items"][0]["frequencyRecords"]
        );
        assert_eq!(
            next.data["items"][0]["frequencyRecords"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
    }
}

#[test]
fn preview_is_read_only_and_completion_months_use_completion_day() {
    let data = initial("todo");
    let input = json!({"dueDate":"2026-01-31","repeatRule":rule("calendar","month")});
    assert_eq!(
        recurrence_preview(&data, &input, 1).unwrap(),
        ["2026-02-28", "2026-03-31", "2026-04-30"]
    );
    let after = json!({"dueDate":"2026-01-31","repeatRule":rule("completion","month")});
    assert_eq!(
        recurrence_preview(&data, &after, stamp("2026-02-05T12:00:00Z")).unwrap(),
        ["2026-03-05"]
    );
    assert_eq!(data, initial("todo"));
    assert!(recurrence_preview(&data, &json!(null), 1).is_err());
    for invalid in [
        json!({"mode":"calendar","unit":"week","interval":1,"weekdays":[0,0]}),
        json!({"mode":"frequency","unit":"week","interval":1,"timesPerWeek":8}),
        json!({"mode":"calendar","unit":"day","interval":0}),
        json!({"mode":"calendar","unit":"month","interval":1,"monthlyMode":"nth-weekday","nth":0,"weekday":1}),
        json!({"mode":"calendar","unit":"day","interval":1,"timeZone":"not/a-zone"}),
    ] {
        reject(
            &data,
            "add",
            json!({"title":"올바르지 않은 반복","repeatRule":invalid}),
            1,
        );
    }
}

#[test]
fn month_end_nth_weekday_and_leap_year_keep_the_rule_anchor() {
    for (source, custom, expected) in [
        (
            "2026-01-31",
            json!({"monthlyMode":"day-of-month"}),
            "2026-02-28",
        ),
        (
            "2026-01-12",
            json!({"monthlyMode":"last-day"}),
            "2026-02-28",
        ),
        (
            "2026-01-25",
            json!({"monthlyMode":"nth-weekday","nth":-1,"weekday":6}),
            "2026-02-22",
        ),
        (
            "2026-01-29",
            json!({"monthlyMode":"nth-weekday","nth":5,"weekday":3}),
            "2026-04-30",
        ),
    ] {
        let mut repeat = rule("calendar", "month");
        repeat
            .as_object_mut()
            .unwrap()
            .extend(custom.as_object().unwrap().clone());
        let added = run(
            &initial("todo"),
            "add",
            json!({"title":"월간 정리","dueDate":source,"repeatRule":repeat}),
            1,
        );
        let key = added.data["items"][0]["id"].clone();
        let complete = run(&added.data, "complete", json!({"id":key}), 2);
        assert_eq!(complete.data["items"][1]["dueDate"], expected);
        if source == "2026-01-31" {
            let key = complete.data["items"][1]["id"].clone();
            let next = run(&complete.data, "complete", json!({"id":key}), 3);
            assert_eq!(next.data["items"][2]["dueDate"], "2026-03-31");
        }
    }
    let added = run(
        &initial("todo"),
        "add",
        json!({"title":"윤일","dueDate":"2024-02-29","repeatRule":rule("calendar","year")}),
        1,
    );
    let mut state = added.data;
    for year in 2025..=2028 {
        let key = state["items"].as_array().unwrap().last().unwrap()["id"].clone();
        state = run(&state, "complete", json!({"id":key}), i64::from(year)).data;
    }
    assert_eq!(state["items"][4]["dueDate"], "2028-02-29");
}

#[test]
fn iana_repeat_preserves_wall_time_and_rejects_dst_gap_or_overlap() {
    let mut repeat = rule("calendar", "day");
    repeat["timeZone"] = json!("America/New_York");
    let added = run(
        &initial("todo"),
        "add",
        json!({"title":"오전 루틴","dueAt":stamp("2026-03-07T09:00:00-05:00"),"repeatRule":repeat}),
        1,
    );
    let key = added.data["items"][0]["id"].clone();
    let completed = run(&added.data, "complete", json!({"id":key}), 2);
    assert_eq!(
        completed.data["items"][1]["dueAt"],
        stamp("2026-03-08T09:00:00-04:00")
    );
    for source in ["2026-03-07T02:30:00-05:00", "2026-10-31T01:30:00-04:00"] {
        let added = run(
            &initial("todo"),
            "add",
            json!({"title":"직접 정할 시각","dueAt":stamp(source),"repeatRule":repeat}),
            1,
        );
        let key = added.data["items"][0]["id"].clone();
        reject(&added.data, "complete", json!({"id":key}), 2);
        assert!(added.data["items"][0]["completedAt"].is_null());
    }
}

#[test]
fn frequency_records_limit_each_day_and_week_and_undo_only_the_chosen_record() {
    let repeat =
        json!({"mode":"frequency","unit":"week","interval":1,"timesPerWeek":2,"timeZone":"UTC"});
    let added = run(
        &initial("todo"),
        "add",
        json!({"title":"산책","repeatRule":repeat}),
        1,
    );
    let key = added.data["items"][0]["id"].clone();
    let one = run(
        &added.data,
        "record-frequency",
        json!({"id":key,"date":"2026-09-21"}),
        stamp("2026-09-21T12:00:00Z"),
    );
    let first_record = one.data["items"][0]["frequencyRecords"][0]["id"].clone();
    reject(
        &one.data,
        "record-frequency",
        json!({"id":key,"date":"2026-09-21"}),
        stamp("2026-09-21T13:00:00Z"),
    );
    let two = run(
        &one.data,
        "record-frequency",
        json!({"id":key,"date":"2026-09-22"}),
        stamp("2026-09-22T12:00:00Z"),
    );
    assert!(two.data["items"][0]["completedAt"].is_null());
    assert_eq!(two.data["items"].as_array().unwrap().len(), 1);
    reject(
        &two.data,
        "record-frequency",
        json!({"id":key,"date":"2026-09-23"}),
        stamp("2026-09-23T12:00:00Z"),
    );
    let three = run(
        &two.data,
        "record-frequency",
        json!({"id":key,"date":"2026-09-28"}),
        stamp("2026-09-28T12:00:00Z"),
    );
    let edited = run(
        &three.data,
        "update",
        json!({"id":key,"memo":"기록을 유지"}),
        10,
    );
    let undone = run(
        &edited.data,
        "undo-frequency",
        json!({"id":key,"recordId":first_record}),
        11,
    );
    assert_eq!(
        undone.data["items"][0]["frequencyRecords"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(undone.data["items"][0]["memo"], "기록을 유지");
    assert_eq!(undone.events[0].payload["occurrenceId"], first_record);
    reject(&undone.data, "complete", json!({"id":key}), 12);
}

#[test]
fn occurrence_edits_keep_following_template_and_following_edits_preserve_completed_history() {
    let added = run(
        &initial("todo"),
        "add",
        json!({"title":"정기 루틴","dueDate":"2026-09-21","repeatRule":rule("calendar","day")}),
        1,
    );
    let key = added.data["items"][0]["id"].clone();
    let edited = run(
        &added.data,
        "update",
        json!({"id":key,"title":"이번 회차만","dueDate":"2026-09-23","scope":"occurrence"}),
        2,
    );
    let completed = run(&edited.data, "complete", json!({"id":key}), 3);
    assert_eq!(completed.data["items"][0]["title"], "이번 회차만");
    assert_eq!(completed.data["items"][1]["title"], "정기 루틴");
    assert_eq!(completed.data["items"][1]["dueDate"], "2026-09-22");
    let next = completed.data["items"][1]["id"].clone();
    let next_done = run(&completed.data, "complete", json!({"id":next}), 4);
    let following = run(
        &next_done.data,
        "update",
        json!({"id":key,"title":"새 루틴","scope":"following"}),
        5,
    );
    assert_eq!(following.data["items"][1]["title"], "정기 루틴");
    assert_eq!(following.data["items"][2]["title"], "새 루틴");
    let undone = run(&following.data, "undo", json!({"id":next}), 6);
    assert_eq!(undone.data["items"].as_array().unwrap().len(), 3);
    assert_eq!(undone.data["items"][2]["title"], "새 루틴");
}
