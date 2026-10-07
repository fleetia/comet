use super::*;
use crate::widgets::{storage, WidgetRequest};

fn run(data: &Value, action: &str, input: Value, now: i64) -> WidgetEffect {
    act(data, action, &input, &BTreeMap::new(), now).unwrap()
}

fn reject(data: &Value, action: &str, input: Value, now: i64) {
    assert!(act(data, action, &input, &BTreeMap::new(), now).is_err());
}

#[test]
fn session_memo_conflicts_preserve_the_latest_saved_value() {
    let started = run(&initial(), "start", json!({"durationMs":1000}), 1000);
    let edited = run(
        &started.data,
        "update-memo",
        json!({"memo":"원본", "expectedMemo":""}),
        1100,
    );
    reject(
        &edited.data,
        "update-memo",
        json!({"memo":"이전 초안", "expectedMemo":""}),
        1200,
    );
    let finished = tick(&edited.data, 2000).unwrap().unwrap();
    assert_eq!(finished.data["sessions"][0]["memo"], "원본");
    let id = finished.data["sessions"][0]["id"].clone();
    let changed = run(
        &finished.data,
        "update-session-memo",
        json!({"id":id, "memo":"다른 창", "expectedMemo":"원본"}),
        2100,
    );
    reject(
        &changed.data,
        "update-session-memo",
        json!({"id":id, "memo":"미저장 초안", "expectedMemo":"원본"}),
        2200,
    );
    assert_eq!(changed.data["sessions"][0]["memo"], "다른 창");
}

#[test]
fn elapsed_focus_excludes_pause_survives_reload_and_caps_late_completion_at_deadline() {
    let started = run(
        &initial(),
        "start",
        json!({"durationMs":25000,"title":"초안 작성"}),
        1000,
    );
    let id = started.data["activeSession"]["id"].clone();
    let paused = run(&started.data, "pause", json!({}), 6000);
    assert_eq!(paused.data["remainingMs"], 20000);
    assert_eq!(paused.data["activeSession"]["elapsedMs"], 5000);
    assert_eq!(
        paused.data["activeSession"]["segments"],
        json!([{"startAt":1000,"endAt":6000}])
    );
    assert!(tick(&paused.data, 50000).unwrap().is_none());
    let restored = serde_json::from_str(&paused.data.to_string()).unwrap();
    let resumed = run(&restored, "resume", json!({}), 100000);
    assert_eq!(resumed.data["activeSession"]["id"], id);
    assert_eq!(resumed.data["deadline"], 120000);
    let finished = tick(&resumed.data, 150000).unwrap().unwrap();
    let session = &finished.data["sessions"][0];
    assert_eq!(session["id"], id);
    assert_eq!(session["title"], "초안 작성");
    assert_eq!(session["elapsedMs"], 25000);
    assert_eq!(session["startedAt"], 1000);
    assert_eq!(session["endedAt"], 120000);
    assert_eq!(session["outcome"], "completed");
    assert_eq!(
        session["segments"],
        json!([
            {"startAt":1000,"endAt":6000}, {"startAt":100000,"endAt":120000}
        ])
    );
    assert!(finished.data["activeSession"].is_null());
    assert_eq!(finished.events.len(), 1);
    assert!(tick(&finished.data, 150001).unwrap().is_none());
}

#[test]
fn custom_break_settings_apply_to_the_next_break_and_never_add_focus_statistics() {
    let settings = run(
        &initial(),
        "configure-settings",
        json!({"restDurationMs":6000}),
        0,
    );
    let started = run(&settings.data, "start", json!({"durationMs":1000}), 1000);
    let finished = tick(&started.data, 2000).unwrap().unwrap();
    let rest = run(&finished.data, "rest", json!({}), 3000);
    assert_eq!(rest.data["durationMs"], 6000);
    assert!(rest.data["activeSession"].is_null());
    let changed = run(
        &rest.data,
        "configure-settings",
        json!({"restDurationMs":9000}),
        4000,
    );
    assert_eq!(changed.data["durationMs"], 6000);
    assert_eq!(changed.data["deadline"], 9000);
    let paused = run(&changed.data, "pause", json!({}), 5000);
    let resumed = run(&paused.data, "resume", json!({}), 10000);
    let rested = tick(&resumed.data, 14000).unwrap().unwrap();
    assert_eq!(rested.data["sessions"], finished.data["sessions"]);
    let again = run(&rested.data, "rest", json!({}), 15000);
    assert_eq!(again.data["durationMs"], 9000);
    let rested = tick(&again.data, 24000).unwrap().unwrap();
    let continued = run(&rested.data, "continue", json!({}), 25000);
    assert_eq!(continued.data["durationMs"], 1000);
    assert_ne!(
        continued.data["activeSession"]["id"],
        finished.data["sessions"][0]["id"]
    );
    reject(
        &continued.data,
        "configure-settings",
        json!({"restDurationMs":0}),
        26000,
    );
}

#[test]
fn manual_end_records_only_worked_time_and_cancel_never_duplicates_a_finished_session() {
    let started = run(&initial(), "start", json!({"durationMs":10000}), 1000);
    let paused = run(&started.data, "pause", json!({}), 4000);
    let cancelled = run(&paused.data, "cancel", json!({}), 30000);
    assert_eq!(cancelled.data["sessions"][0]["elapsedMs"], 3000);
    assert_eq!(cancelled.data["sessions"][0]["endedAt"], 30000);
    assert_eq!(cancelled.data["sessions"][0]["outcome"], "ended");
    assert_eq!(cancelled.data["status"], "idle");
    assert_eq!(cancelled.data["remainingMs"], 10000);
    assert!(cancelled.events.is_empty());
    let repeated = run(&cancelled.data, "cancel", json!({}), 30001);
    assert_eq!(repeated.data["sessions"], cancelled.data["sessions"]);
    let zero = run(&cancelled.data, "start", json!({}), 40000);
    let zero = run(&zero.data, "cancel", json!({}), 40000);
    assert_eq!(zero.data["sessions"], cancelled.data["sessions"]);
    let late = run(&zero.data, "start", json!({}), 50000);
    let late = run(&late.data, "cancel", json!({}), 80000);
    assert_eq!(late.data["sessions"][1]["elapsedMs"], 10000);
    assert_eq!(late.data["sessions"][1]["endedAt"], 60000);
    assert_eq!(late.data["sessions"][1]["outcome"], "completed");
}

#[test]
fn running_configuration_only_changes_presentation_without_overwriting_work() {
    let configured = run(
        &initial(),
        "configure",
        json!({"durationMs":60000,"title":"계획","memo":"초기 메모"}),
        0,
    );
    let started = run(&configured.data, "start", json!({}), 1000);
    let digits = run(
        &started.data,
        "configure",
        json!({"presentation":"digits"}),
        2000,
    );
    assert_eq!(digits.data["presentation"], "digits");
    assert_eq!(digits.data["activeSession"], started.data["activeSession"]);
    assert_eq!(digits.data["deadline"], started.data["deadline"]);
    reject(&digits.data, "start", json!({"durationMs":1000}), 3000);
    reject(&digits.data, "configure", json!({"title":"다른 일"}), 3000);
    reject(&digits.data, "configure", json!({"durationMs":1000}), 3000);
    reject(
        &digits.data,
        "configure",
        json!({"presentation":"invalid"}),
        3000,
    );
    let paused = run(&digits.data, "pause", json!({}), 4000);
    reject(&paused.data, "start", json!({}), 5000);
    reject(&paused.data, "configure", json!({"todoId":null}), 5000);
}

#[test]
fn references_are_snapshots_and_source_deletion_never_removes_focus_history() {
    let related = BTreeMap::from([
        (
            "calendar".into(),
            json!({"events":[{
                "id":"event-1","title":"디자인 작업","startAt":1000,"endAt":61000,
                "connectionId":"google-1","sourceId":"work","occurrenceId":"occurrence-1","cancelled":false
            }]}),
        ),
        (
            "memo".into(),
            json!({"notes":[{"id":"note-1","title":"기존 메모","body":"원문"}]}),
        ),
    ]);
    let input = json!({"durationMs":10000,"eventRef":{
        "calendarWidgetId":"calendar-widget","id":"event-1","title":"가짜 제목"
    },"noteRef":{"kind":"memo","widgetId":"memo-widget","id":"note-1","title":"가짜 메모"}});
    let started = act(&initial(), "start", &input, &related, 1000).unwrap();
    assert_eq!(started.data["eventRef"]["title"], "디자인 작업");
    assert_eq!(started.data["eventRef"]["occurrenceId"], "occurrence-1");
    assert_eq!(started.data["noteRef"]["title"], "기존 메모");
    let finished = tick(&started.data, 11000).unwrap().unwrap();
    let continued = run(&finished.data, "continue", json!({}), 12000);
    assert_eq!(
        continued.data["activeSession"]["eventRef"],
        started.data["eventRef"]
    );
    let cancelled = run(&continued.data, "cancel", json!({}), 13000);
    let cleared = run(
        &cancelled.data,
        "configure",
        json!({"eventRef":null,"noteRef":null}),
        14000,
    );
    assert_eq!(
        cleared.data["sessions"][0]["eventRef"],
        started.data["eventRef"]
    );
    assert_eq!(
        cleared.data["sessions"][0]["noteRef"],
        started.data["noteRef"]
    );
    assert!(cleared.data["eventRef"].is_null());
    assert!(cleared.data["noteRef"].is_null());
    reject(
        &initial(),
        "configure",
        json!({"eventRef":{"calendarWidgetId":"c","id":"missing"}}),
        1,
    );
    reject(
        &initial(),
        "configure",
        json!({"noteRef":{"kind":"memo","id":"missing"}}),
        1,
    );
    reject(
        &initial(),
        "configure",
        json!({"noteRef":{"kind":"other","id":"x"}}),
        1,
    );
}

#[test]
fn memo_edits_update_the_selected_session_without_rewriting_other_records_or_note_bodies() {
    let started = run(
        &initial(),
        "start",
        json!({"durationMs":1000,"noteRef":{"kind":"diary","id":"page-1","title":"초안"}}),
        1000,
    );
    let memo = run(
        &started.data,
        "update-memo",
        json!({"memo":"집중하면서 작성\n둘째 줄"}),
        1500,
    );
    let finished = tick(&memo.data, 2000).unwrap().unwrap();
    assert_eq!(
        finished.data["sessions"][0]["memo"],
        "집중하면서 작성\n둘째 줄"
    );
    let first_id = finished.data["sessions"][0]["id"].clone();
    let corrected = run(
        &finished.data,
        "update-memo",
        json!({"memo":"마무리"}),
        2500,
    );
    assert_eq!(corrected.data["sessions"][0]["memo"], "마무리");
    let continued = run(&corrected.data, "continue", json!({}), 3000);
    let second = tick(&continued.data, 4000).unwrap().unwrap();
    let edited = run(
        &second.data,
        "update-session-memo",
        json!({"id":first_id,"memo":"첫 세션 수정"}),
        5000,
    );
    assert_eq!(edited.data["sessions"][0]["memo"], "첫 세션 수정");
    assert_eq!(edited.data["sessions"][1], second.data["sessions"][1]);
    assert_eq!(edited.data["memo"], "마무리");
    reject(
        &edited.data,
        "update-session-memo",
        json!({"id":"missing","memo":"오류"}),
        6000,
    );
    reject(&edited.data, "update-memo", json!({}), 6000);
}

#[test]
fn dated_segments_preserve_work_on_each_side_of_midnight_and_exclude_the_gap() {
    let midnight = chrono::DateTime::parse_from_rfc3339("2026-10-08T00:00:00+09:00")
        .unwrap()
        .timestamp_millis();
    let started = run(
        &initial(),
        "start",
        json!({"durationMs":20*60000}),
        midnight - 10 * 60000,
    );
    let paused = run(&started.data, "pause", json!({}), midnight - 2 * 60000);
    let resumed = run(&paused.data, "resume", json!({}), midnight + 3 * 60000);
    let finished = tick(&resumed.data, midnight + 30 * 60000).unwrap().unwrap();
    let segments = &finished.data["sessions"][0]["segments"];
    assert_eq!(
        segments,
        &json!([
            {"startAt":midnight-10*60000,"endAt":midnight-2*60000},
            {"startAt":midnight+3*60000,"endAt":midnight+15*60000}
        ])
    );
    assert_eq!(finished.data["sessions"][0]["elapsedMs"], 20 * 60000);
}

#[test]
fn legacy_timers_migrate_without_claiming_unrecorded_historical_focus_time() {
    let legacy = json!({"status":"running","mode":"focus","durationMs":10000,
        "remainingMs":10000,"deadline":11000,"todoId":null});
    let migrated = tick(&legacy, 4000).unwrap().unwrap();
    assert_eq!(migrated.data["presentation"], "dial");
    assert_eq!(migrated.data["settings"]["restDurationMs"], 300000);
    assert_eq!(migrated.data["activeSession"]["startedAt"], 4000);
    let finished = tick(&migrated.data, 12000).unwrap().unwrap();
    assert_eq!(finished.data["sessions"][0]["elapsedMs"], 7000);
    assert_eq!(finished.data["sessions"][0]["endedAt"], 11000);
    assert!(tick(&finished.data, 13000).unwrap().is_none());
    let legacy_finished = tick(&legacy, 12000).unwrap().unwrap();
    assert!(legacy_finished.data["sessions"]
        .as_array()
        .unwrap()
        .is_empty());
    assert_eq!(legacy_finished.data["status"], "finished");
    let legacy_paused = json!({"status":"paused","mode":"focus","durationMs":10000,
        "remainingMs":3000,"deadline":null,"todoId":null});
    let resumed = run(&legacy_paused, "resume", json!({}), 20000);
    let finished = tick(&resumed.data, 23000).unwrap().unwrap();
    assert_eq!(finished.data["sessions"][0]["elapsedMs"], 3000);
}

#[test]
fn suspend_closes_focus_before_disabled_time_and_restart_expiry_finishes_without_reactions() {
    let started = run(&initial(), "start", json!({"durationMs":20*60000}), 1000);
    let disabled = suspend(&started.data, 1000 + 5 * 60000, false).unwrap();
    assert_eq!(disabled["activeSession"]["elapsedMs"], 5 * 60000);
    assert!(disabled["activeSession"]["runningSince"].is_null());
    let cancelled = run(&disabled, "cancel", json!({}), 1000 + 15 * 60000);
    assert_eq!(cancelled.data["sessions"][0]["elapsedMs"], 5 * 60000);
    let resumed = run(&disabled, "resume", json!({}), 1000 + 15 * 60000);
    let finished = tick(&resumed.data, 1000 + 35 * 60000).unwrap().unwrap();
    assert_eq!(finished.data["sessions"][0]["elapsedMs"], 20 * 60000);
    assert_eq!(
        finished.data["sessions"][0]["segments"],
        json!([
            {"startAt":1000,"endAt":1000+5*60000},
            {"startAt":1000+15*60000,"endAt":1000+30*60000}
        ])
    );
    let restarted = suspend(&started.data, 1000 + 8 * 60000, true).unwrap();
    assert_eq!(restarted["status"], "running");
    assert_eq!(restarted["activeSession"]["runningSince"], 1000);
    let expired = suspend(&restarted, 1000 + 25 * 60000, true).unwrap();
    assert_eq!(expired["status"], "finished");
    assert_eq!(expired["sessions"][0]["elapsedMs"], 20 * 60000);
    assert_eq!(expired["sessions"][0]["endedAt"], 1000 + 20 * 60000);
    assert!(tick(&expired, 1000 + 26 * 60000).unwrap().is_none());
}

#[test]
fn storage_request_replay_and_revision_checks_keep_session_appends_atomic_and_once() {
    let db = rusqlite::Connection::open_in_memory().unwrap();
    storage::initialize(&db).unwrap();
    let directory = tempfile::tempdir().unwrap();
    storage::install(&db, directory.path(), &["focus-timer".into()]).unwrap();
    let instance = storage::instances(&db)
        .unwrap()
        .into_iter()
        .find(|widget| widget.kind == "focus-timer")
        .unwrap();
    let start = WidgetRequest {
        request_id: uuid::Uuid::new_v4().to_string(),
        instance_id: instance.id.clone(),
        expected_revision: instance.revision,
        action: "start".into(),
        input: json!({"durationMs":10000}),
    };
    storage::execute(&db, &start, 1000, 1).unwrap();
    storage::execute(&db, &start, 2000, 2).unwrap();
    let started = storage::get(&db, &instance.id).unwrap();
    assert_eq!(started.data["activeSession"]["startedAt"], 1000);
    let cancel = WidgetRequest {
        request_id: uuid::Uuid::new_v4().to_string(),
        instance_id: instance.id.clone(),
        expected_revision: started.revision,
        action: "cancel".into(),
        input: json!({}),
    };
    storage::execute(&db, &cancel, 4000, 3).unwrap();
    let saved = storage::get(&db, &instance.id).unwrap();
    assert_eq!(saved.data["sessions"][0]["elapsedMs"], 3000);
    storage::execute(&db, &cancel, 5000, 4).unwrap();
    assert_eq!(
        storage::get(&db, &instance.id).unwrap().revision,
        saved.revision
    );
    let mut stale = cancel.clone();
    stale.request_id = uuid::Uuid::new_v4().to_string();
    assert!(storage::execute(&db, &stale, 6000, 5).is_err());
    assert_eq!(storage::get(&db, &instance.id).unwrap().data, saved.data);
    let restart = WidgetRequest {
        request_id: uuid::Uuid::new_v4().to_string(),
        instance_id: instance.id.clone(),
        expected_revision: saved.revision,
        action: "start".into(),
        input: json!({"durationMs":1000}),
    };
    storage::execute(&db, &restart, 7000, 6).unwrap();
    storage::advance(&db, 8000).unwrap();
    let finished = storage::get(&db, &instance.id).unwrap();
    assert_eq!(finished.data["sessions"].as_array().unwrap().len(), 2);
    storage::advance(&db, 9000).unwrap();
    assert_eq!(storage::get(&db, &instance.id).unwrap().data, finished.data);
}
