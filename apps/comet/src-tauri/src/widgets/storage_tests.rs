use super::{storage, WidgetInstance, WidgetRequest};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::path::Path;

fn database() -> Connection {
    let db = Connection::open_in_memory().unwrap();
    storage::initialize(&db).unwrap();
    super::generated::initialize(&db).unwrap();
    db
}

#[test]
fn quiet_preserves_urgent_notice_and_focus_break_but_discards_ordinary_notice() {
    let db = database();
    for (id, kind, urgent) in [
        ("urgent", "external-notice", true),
        ("ordinary", "external-notice", false),
        ("long-rest", "focus-long-rest-started", false),
    ] {
        let event = super::WidgetEvent {
            id: id.into(), instance_id: id.into(), widget_kind: id.into(), revision: 1,
            created_at: 1, expires_at: 1000,
            event: super::EventDraft { kind: kind.into(), text: id.into(), payload: json!({"urgent":urgent}) },
        };
        db.execute("INSERT INTO widget_events(id,instance_id,data,pending) VALUES(?1,?1,?2,1)",
            rusqlite::params![id, serde_json::to_string(&event).unwrap()]).unwrap();
        db.execute("INSERT INTO widget_journal VALUES(?1)", [id]).unwrap();
    }
    storage::discard_pending_during_quiet(&db).unwrap();
    for (id, pending) in [("urgent", true), ("ordinary", false), ("long-rest", true)] {
        let actual: bool = db.query_row("SELECT pending FROM widget_events WHERE id=?1", [id], |row| row.get(0)).unwrap();
        assert_eq!(actual, pending, "{id}");
    }
    storage::discard_pending_external_notice(&db).unwrap();
    let pending: bool = db.query_row("SELECT pending FROM widget_events WHERE id='urgent'", [], |row| row.get(0)).unwrap();
    assert!(!pending);
    let retained: i64 = db.query_row("SELECT COUNT(*) FROM widget_journal", [], |row| row.get(0)).unwrap();
    assert_eq!(retained, 3);
}

#[test]
fn weather_daily_dedup_preserves_external_notice_queue_and_history() {
    let db = database();
    let weather = instance(&db, "weather");
    let external = instance(&db, "external-notice");
    let notice = || super::EventDraft {
        kind: "external-notice".into(), text: "알림".into(), payload: json!({}),
    };
    let forecast = || super::EventDraft {
        kind: "weather.rain-tomorrow".into(), text: "비".into(), payload: json!({"day":"2026-10-29"}),
    };
    storage::record_external_notice(&db, &external, notice(), 100).unwrap();
    assert!(storage::record_daily_weather_event(&db, &weather, forecast(), "2026-10-29", 101).unwrap());
    assert!(!storage::record_daily_weather_event(&db, &weather, forecast(), "2026-10-29", 102).unwrap());
    storage::record_external_notice(&db, &external, notice(), 103).unwrap();
    let queued: i64 = db.query_row("SELECT COUNT(*) FROM widget_events WHERE pending=1 AND json_extract(data,'$.kind')='external-notice'", [], |row| row.get(0)).unwrap();
    let history: i64 = db.query_row("SELECT COUNT(*) FROM widget_journal", [], |row| row.get(0)).unwrap();
    assert_eq!(queued, 2);
    assert_eq!(history, 3);
    assert_eq!(storage::get(&db, &external.id).unwrap().revision, external.revision);
    assert_eq!(storage::get(&db, &weather.id).unwrap().revision, weather.revision);
}

#[test]
fn external_notice_burst_keeps_each_pending_event_without_changing_revision() {
    let db = database();
    let instance = instance(&db, "external-notice");
    for n in 0..6 {
        storage::record_external_notice(&db, &instance, super::EventDraft {
            kind: "external-notice".into(), text: n.to_string(), payload: json!({}),
        }, n).unwrap();
    }
    assert_eq!(storage::get(&db, &instance.id).unwrap().revision, instance.revision);
    for n in 0..6 {
        assert_eq!(storage::take_reaction(&db, 10).unwrap().unwrap().event.text, n.to_string());
    }
    assert!(storage::take_reaction(&db, 10).unwrap().is_none());
    let count: i64 = db.query_row("SELECT count(*) FROM widget_journal", [], |row| row.get(0)).unwrap();
    assert_eq!(count, 6);
}

#[test]
fn disabling_external_notice_reactions_discards_queued_speech() {
    let db = database();
    let instance = instance(&db, "external-notice");
    storage::record_external_notice(&db, &instance, super::EventDraft {
        kind: "external-notice".into(), text: "notice".into(), payload: json!({}),
    }, 0).unwrap();
    storage::set_reaction(&db, &instance.id, false).unwrap();
    assert!(storage::take_reaction(&db, 1).unwrap().is_none());
    let count: i64 = db.query_row("SELECT count(*) FROM widget_journal", [], |row| row.get(0)).unwrap();
    assert_eq!(count, 1);
}

#[test]
fn queued_external_notices_are_discarded_on_cancellation() {
    let db = database();
    let instance = instance(&db, "external-notice");
    storage::record_external_notice(&db, &instance, super::EventDraft {
        kind: "external-notice".into(), text: "notice".into(), payload: json!({}),
    }, 0).unwrap();
    storage::discard_pending(&db).unwrap();
    assert!(storage::take_reaction(&db, 1).unwrap().is_none());
}

#[test]
fn changing_external_notice_settings_invalidates_queued_notices() {
    let db = database();
    let instance = instance(&db, "external-notice");
    storage::record_external_notice(&db, &instance, super::EventDraft {
        kind: "external-notice".into(), text: "notice".into(), payload: json!({}),
    }, 0).unwrap();
    let mut data = instance.data.clone();
    data["enabled"] = json!(false);
    storage::commit_data(&db, &instance.id, instance.revision, data, vec![], 1).unwrap();
    assert!(storage::take_reaction(&db, 2).unwrap().is_none());
}

#[test]
fn package_migration_repairs_existing_invalid_manifests_without_resetting_data() {
    let db = database();
    let directory = tempfile::tempdir().unwrap();
    storage::verify_packages(&db, directory.path()).unwrap();
    let before = instance(&db, "small-match");
    let path = directory.path().join("widgets/small-match/manifest.json");
    std::fs::write(&path, "unsupported manifest").unwrap();
    db.execute("DELETE FROM widget_preferences WHERE key='package-init-migration-v1'", []).unwrap();

    storage::initialize(&db).unwrap();
    storage::verify_packages(&db, directory.path()).unwrap();
    let after = instance(&db, "small-match");
    assert_eq!(after.id, before.id);
    assert_eq!(after.data, before.data);
    assert_eq!(after.revision, before.revision);
    assert!(after.error.is_none());
    assert_eq!(std::fs::read(&path).unwrap(), serde_json::to_vec(&super::manifest("small-match").unwrap()).unwrap());

    std::fs::write(&path, "later corruption").unwrap();
    storage::initialize(&db).unwrap();
    storage::verify_packages(&db, directory.path()).unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), b"later corruption");
    assert!(instance(&db, "small-match").error.is_some());
}

#[test]
fn failed_package_migration_is_retried_after_the_obstruction_is_removed() {
    let db = database();
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("widgets/small-match");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, "not a directory").unwrap();
    let id = instance(&db, "small-match").id;
    storage::verify_packages(&db, directory.path()).unwrap();
    let pending_key = format!("package-init:{id}");
    let pending = || db.query_row("SELECT count(*) FROM widget_preferences WHERE key=?1", [&pending_key], |row| row.get::<_, i64>(0)).unwrap();
    assert_eq!(pending(), 1);
    std::fs::remove_file(path).unwrap();
    storage::verify_packages(&db, directory.path()).unwrap();
    assert_eq!(pending(), 0);
    assert!(instance(&db, "small-match").error.is_none());
}

fn prepare_widgets(db: &Connection, path: &Path, kinds: &[&str]) {
    storage::verify_packages(db, path).unwrap();
    for kind in kinds {
        assert!(storage::instances(db).unwrap().iter().any(|entry| entry.kind == *kind));
    }
}

fn instance(db: &Connection, kind: &str) -> WidgetInstance {
    storage::instances(db)
        .unwrap()
        .into_iter()
        .find(|entry| entry.kind == kind)
        .unwrap()
}

fn request(db: &Connection, kind: &str, action: &str, input: Value) -> WidgetRequest {
    let current = instance(db, kind);
    WidgetRequest {
        request_id: uuid::Uuid::new_v4().to_string(),
        instance_id: current.id,
        expected_revision: current.revision,
        action: action.into(),
        input,
    }
}

fn act(db: &Connection, kind: &str, action: &str, input: Value, now: i64, entropy: u64) {
    storage::execute(db, &request(db, kind, action, input), now, entropy).unwrap();
}

#[test]
fn guessing_commits_survive_process_exit_without_cleanup() {
    const CHILD_DB: &str = "COMET_TEST_GUESSING_EXIT_DB";
    const CHILD_MODE: &str = "COMET_TEST_GUESSING_EXIT_MODE";
    if let Some(path) = std::env::var_os(CHILD_DB) {
        let mode = std::env::var(CHILD_MODE).unwrap();
        let db = Connection::open(&path).unwrap();
        storage::initialize(&db).unwrap();
        let assets = Path::new(&path).parent().unwrap().join("assets");
        prepare_widgets(&db, &assets, &["guessing"]);
        act(&db, "guessing", "start", json!({"mode":mode}), 1000, 49);
        let mut wrong = request(
            &db,
            "guessing",
            "guess",
            json!({"value": if mode == "cups" { 1 } else { 20 }}),
        );
        wrong.request_id = "5624cdfd-f090-49e0-8569-739e22544fbf".into();
        storage::execute(&db, &wrong, 1001, 99).unwrap();
        std::process::exit(86);
    }

    for mode in ["cups", "number"] {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("guessing.sqlite");
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "widgets::storage_tests::guessing_commits_survive_process_exit_without_cleanup",
                "--nocapture",
            ])
            .env(CHILD_DB, &path)
            .env(CHILD_MODE, mode)
            .status()
            .unwrap();
        assert_eq!(status.code(), Some(86));
        let db = Connection::open(&path).unwrap();
        storage::initialize(&db).unwrap();
        let resumed = instance(&db, "guessing");
        assert_eq!(resumed.data["mode"], mode);
        assert_eq!(resumed.data["playing"], true);
        assert_eq!(resumed.data["attempts"], 1);
        assert_eq!(
            resumed.data["hint"],
            if mode == "cups" {
                "1번 컵은 비어 있어요."
            } else {
                "20보다 더 커요"
            }
        );
        let events_before: i64 = db
            .query_row("SELECT COUNT(*) FROM widget_events", [], |row| row.get(0))
            .unwrap();
        let retry = WidgetRequest {
            request_id: "5624cdfd-f090-49e0-8569-739e22544fbf".into(),
            instance_id: resumed.id.clone(),
            expected_revision: resumed.revision - 1,
            action: "guess".into(),
            input: json!({"value": if mode == "cups" { 1 } else { 20 }}),
        };
        storage::execute(&db, &retry, 2000, 0).unwrap();
        assert_eq!(instance(&db, "guessing").data, resumed.data);
        assert_eq!(instance(&db, "guessing").revision, resumed.revision);
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM widget_events", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            events_before
        );
        act(
            &db,
            "guessing",
            "guess",
            json!({"value": if mode == "cups" { 2 } else { 50 }}),
            2001,
            0,
        );
        let won = instance(&db, "guessing");
        assert_eq!(won.data["playing"], false);
        assert_eq!(won.data["attempts"], 2);
        assert!(storage::execute(
            &db,
            &request(
                &db,
                "guessing",
                "guess",
                json!({"value": if mode == "cups" { 2 } else { 50 }})
            ),
            2002,
            0
        )
        .is_err());
        assert_eq!(instance(&db, "guessing").data, won.data);
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM widget_events", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            2
        );
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM desktop_toy_results", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
}

#[test]
fn calendar_colors_are_scoped_atomic_and_preserved_by_reminder_changes() {
    let db = database();
    let directory = tempfile::tempdir().unwrap();
    prepare_widgets(&db, directory.path(), &["calendar"]);
    let calendar = instance(&db, "calendar");
    let connected = super::calendar::connect_ics(super::calendar::IcsConnectInput {
        name: "구독".into(),
        url: "https://example.com/feed.ics".into(),
    })
    .unwrap();
    let ics = connected.connection;
    let mut google = ics.clone();
    google.id = uuid::Uuid::new_v4().to_string();
    google.provider = "google".into();
    google.selected_calendar_ids = vec!["primary".into(), "work".into()];
    let mut apple = google.clone();
    apple.id = uuid::Uuid::new_v4().to_string();
    apple.provider = "apple".into();
    apple.selected_calendar_ids = vec!["local".into()];
    let mut data = calendar.data.clone();
    data["connections"] = json!([ics, google, apple]);
    // Existing installations have no color preferences yet.
    data.as_object_mut().unwrap().remove("calendarColors");
    storage::commit_data(&db, &calendar.id, calendar.revision, data, vec![], 1).unwrap();
    let chosen = request(
        &db,
        "calendar",
        "set-calendar-color",
        json!({
            "connectionId": google.id, "calendarId": "work", "color": "#A1B2C3"
        }),
    );
    storage::execute(&db, &chosen, 2, 1).unwrap();
    let saved = instance(&db, "calendar");
    assert_eq!(saved.data["calendarColors"][&google.id]["work"], "#a1b2c3");
    storage::execute(&db, &chosen, 3, 2).unwrap();
    assert_eq!(instance(&db, "calendar").revision, saved.revision);
    let mut stale = chosen.clone();
    stale.request_id = uuid::Uuid::new_v4().to_string();
    stale.input["color"] = json!("#ffffff");
    assert!(storage::execute(&db, &stale, 4, 3).is_err());
    for (connection_id, calendar_id) in [(&ics.id, ""), (&apple.id, "local")] {
        act(
            &db,
            "calendar",
            "set-calendar-color",
            json!({
                "connectionId": connection_id, "calendarId": calendar_id, "color": "#123456"
            }),
            5,
            4,
        );
    }
    let before_invalid = instance(&db, "calendar");
    for (connection_id, calendar_id, color) in [
        (&ics.id, "event-uid", "#123456"),
        (&google.id, "unselected", "#123456"),
        (&apple.id, "", "#123456"),
        (&google.id, "work", "red"),
        (&google.id, "work", "#12345g"),
        (&google.id, "work", "#12345678"),
        (&String::from("missing"), "", "#123456"),
    ] {
        let invalid = request(
            &db,
            "calendar",
            "set-calendar-color",
            json!({
                "connectionId": connection_id, "calendarId": calendar_id, "color": color
            }),
        );
        assert!(storage::execute(&db, &invalid, 6, 5).is_err());
        assert_eq!(instance(&db, "calendar").data, before_invalid.data);
        assert_eq!(instance(&db, "calendar").revision, before_invalid.revision);
    }
    act(
        &db,
        "calendar",
        "configure-alerts",
        json!({"enabled":true}),
        7,
        6,
    );
    let updated = instance(&db, "calendar");
    assert_eq!(
        updated.data["calendarColors"],
        before_invalid.data["calendarColors"]
    );
    assert_eq!(
        updated.data["connections"],
        before_invalid.data["connections"]
    );
    assert_eq!(updated.data["events"], before_invalid.data["events"]);
    assert_eq!(updated.data["reminders"]["enabled"], true);
}

#[test]
fn planner_batch_is_atomic_and_frequency_records_are_idempotent() {
    let db = database();
    let directory = tempfile::tempdir().unwrap();
    prepare_widgets(&db, directory.path(), &["todo"]);
    let before = instance(&db, "todo");
    let invalid = request(
        &db,
        "todo",
        "batch-add",
        json!({"listName":"임시 목록","items":[{"title":"valid"},{"title":""}]}),
    );
    assert!(storage::execute(&db, &invalid, 1, 1).is_err());
    assert_eq!(instance(&db, "todo").data, before.data);
    assert_eq!(instance(&db, "todo").revision, before.revision);
    act(
        &db,
        "todo",
        "add",
        json!({"title":"산책","repeatRule":{"mode":"frequency","unit":"week","interval":1,"timesPerWeek":3,"timeZone":"UTC"}}),
        1,
        1,
    );
    let item_id = instance(&db, "todo").data["items"][0]["id"].clone();
    let record = request(
        &db,
        "todo",
        "record-frequency",
        json!({"id":item_id,"date":"2026-09-21"}),
    );
    let now = chrono::DateTime::parse_from_rfc3339("2026-09-21T12:00:00Z")
        .unwrap()
        .timestamp_millis();
    storage::execute(&db, &record, now, 2).unwrap();
    storage::execute(&db, &record, now + 1, 3).unwrap();
    let records = instance(&db, "todo").data["items"][0]["frequencyRecords"].clone();
    assert_eq!(records.as_array().unwrap().len(), 1);
    let record_id = records[0]["id"].clone();
    act(
        &db,
        "todo",
        "undo-frequency",
        json!({"id":item_id,"recordId":record_id}),
        now + 2,
        4,
    );
    assert!(instance(&db, "todo").data["items"][0]["frequencyRecords"]
        .as_array()
        .unwrap()
        .is_empty());
}

#[test]
fn completion_jar_counts_direct_completions_and_follows_undo() {
    let db = database();
    let directory = tempfile::tempdir().unwrap();
    prepare_widgets(&db, directory.path(), &["todo"]);
    act(&db, "todo", "add", json!({"title":"메일 정리하기"}), 1, 1);
    let item_id = instance(&db, "todo").data["items"][0]["id"].clone();
    act(&db, "todo", "complete", json!({"id":item_id}), 2, 2);
    // Installing later still counts what was already completed.
    prepare_widgets(&db, directory.path(), &["completion-jar"]);
    let completed = instance(&db, "completion-jar").data["completed"].clone();
    assert_eq!(completed.as_array().unwrap().len(), 1);
    assert_eq!(completed[0]["title"], "메일 정리하기");
    act(&db, "todo", "undo", json!({"id":item_id}), 3, 3);
    assert!(instance(&db, "completion-jar").data["completed"]
        .as_array()
        .unwrap()
        .is_empty());
}

#[test]
fn previously_retired_play_widgets_install_again_with_their_data() {
    let db = database();
    let directory = tempfile::tempdir().unwrap();
    db.execute(
        "UPDATE widget_instances SET id='old-plant',installed=0,enabled=0,revision=3,data=?1 WHERE kind='plant'",
        [json!({"stage":2,"water":0,"updatedAt":0}).to_string()],
    )
    .unwrap();
    storage::initialize(&db).unwrap();
    prepare_widgets(&db, directory.path(), &["plant", "device", "guessing", "fishing", "pet"]);
    let snapshot = storage::snapshot(&db).unwrap();
    let plant = snapshot
        .widgets
        .iter()
        .find(|view| view.instance.kind == "plant")
        .unwrap();
    assert_eq!(plant.instance.id, "old-plant");
    assert_eq!(plant.instance.data["stage"], 2);
    for kind in ["device", "guessing", "fishing", "pet"] {
        assert!(snapshot
            .widgets
            .iter()
            .any(|view| view.instance.kind == kind));
    }
}

#[test]
fn widget_onboarding_is_read_compatible_and_installation_never_writes_it() {
    let db = database();
    let directory = tempfile::tempdir().unwrap();
    let before = storage::snapshot(&db).unwrap();
    assert_eq!(before.catalog.len(), 23);
    assert!(before.catalog.iter().any(|item| item.id == "image"));
    assert!(before.catalog.iter().any(|item| item.id == "external-notice"));
    assert_eq!(before.widgets.len(), before.catalog.len());
    assert!(!before.onboarding_done);
    prepare_widgets(&db, directory.path(), &["memo"]);
    let count: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM widget_preferences WHERE key='onboarding'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 0);
    db.execute(
        "INSERT INTO widget_preferences VALUES('onboarding','done')",
        [],
    )
    .unwrap();
    assert!(storage::snapshot(&db).unwrap().onboarding_done);
    prepare_widgets(&db, directory.path(), &["todo"]);
    assert!(storage::snapshot(&db).unwrap().onboarding_done);
}

#[test]
fn desktop_outcomes_preserve_legacy_data_and_reject_removed_revisions() {
    let db = database();
    let directory = tempfile::tempdir().unwrap();
    prepare_widgets(&db, directory.path(), &["ball"]);
    let original = instance(&db, "ball");
    let draft = || super::EventDraft {
        kind: "desktop.ball.stopped".into(),
        text: "바탕화면 공이 8번 튕긴 뒤 멈췄어요.".into(),
        payload: json!({"distanceUnit":"desktop-logical-points","distance":250.0,"bounces":8,"actorId":"ball-actor","automatic":false}),
    };
    assert!(storage::record_desktop_result(
        &db,
        &original.id,
        original.revision,
        draft(),
        1000,
        true
    )
    .unwrap());
    assert_eq!(instance(&db, "ball").data, original.data);
    assert_eq!(instance(&db, "ball").revision, original.revision);
    let journal = storage::journal(&db, None, i64::MIN, i64::MAX).unwrap();
    assert_eq!(journal[0].1.event.text, "공이 멈췄어요.");
    assert_eq!(
        journal[0].1.event.payload,
        json!({"actorId":"ball-actor","automatic":false})
    );
    let reaction = storage::take_reaction(&db, 1001).unwrap().unwrap();
    assert_eq!(reaction.event.text, journal[0].1.event.text);
    assert_eq!(reaction.event.payload, journal[0].1.event.payload);
    let stored: String = db
        .query_row("SELECT data FROM desktop_toy_results", [], |row| row.get(0))
        .unwrap();
    let stored: super::WidgetEvent = serde_json::from_str(&stored).unwrap();
    assert_eq!(stored.event.text, draft().text);
    assert_eq!(stored.event.payload, draft().payload);
    storage::bump_revision(&db, &original.id, original.revision).unwrap();
    assert!(!storage::record_desktop_result(
        &db,
        &original.id,
        original.revision,
        draft(),
        2000,
        true
    )
    .unwrap());
    let count: i64 = db
        .query_row("SELECT COUNT(*) FROM desktop_toy_results", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(count, 1);
    assert_eq!(storage::journal(&db, None, i64::MIN, i64::MAX).unwrap().len(), 1);
}

#[test]
fn clearing_automatic_desktop_reactions_preserves_manual_timer_and_journal() {
    let db = database();
    let directory = tempfile::tempdir().unwrap();
    prepare_widgets(&db, directory.path(), &["ball", "focus-timer"]);
    let ball = instance(&db, "ball");
    for automatic in [true, false] {
        storage::record_desktop_result(
            &db,
            &ball.id,
            ball.revision,
            super::EventDraft {
                kind: "desktop.ball.stopped".into(),
                text: "공이 멈췄어요.".into(),
                payload: json!({"automatic":automatic}),
            },
            1000,
            true,
        )
        .unwrap();
    }
    let timer = instance(&db, "focus-timer");
    storage::commit_data(
        &db,
        &timer.id,
        timer.revision,
        timer.data,
        vec![super::EventDraft {
            kind: "timer-finished".into(),
            text: "시간이 됐어요.".into(),
            payload: json!({}),
        }],
        1001,
    )
    .unwrap();
    let before = storage::journal(&db, None, i64::MIN, i64::MAX).unwrap();
    storage::discard_automatic_desktop_pending(&db).unwrap();
    let pending: Vec<String> = db
        .prepare("SELECT data FROM widget_events WHERE pending=1")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(pending.len(), 2);
    let pending: Vec<super::WidgetEvent> = pending
        .iter()
        .map(|value| serde_json::from_str(value).unwrap())
        .collect();
    assert!(pending
        .iter()
        .any(|event| event.event.kind == "timer-finished"));
    assert!(pending
        .iter()
        .any(|event| event.event.kind == "desktop.ball.stopped"
            && event.event.payload["automatic"] == false));
    assert_eq!(
        serde_json::to_value(storage::journal(&db, None, i64::MIN, i64::MAX).unwrap()).unwrap(),
        serde_json::to_value(before).unwrap()
    );
    let count: i64 = db
        .query_row("SELECT COUNT(*) FROM desktop_toy_results", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(count, 2);
}

#[test]
fn restarting_widgets_preserves_companion_data() {
    let directory = tempfile::tempdir().unwrap();
    let db_path = directory.path().join("app.sqlite");
    let db = crate::store::open(&db_path).unwrap();
    db.execute("INSERT INTO memories(id,content,source,updated) VALUES('memory','사용자가 남긴 기억','manual',1)", []).unwrap();
    prepare_widgets(&db, directory.path(), &["interaction"]);
    act(&db, "interaction", "snack", json!({"character":"A"}), 100, 0);
    let original = instance(&db, "interaction");
    drop(db);
    let db = crate::store::open(&db_path).unwrap();
    storage::verify_packages(&db, directory.path()).unwrap();
    let restored = instance(&db, "interaction");
    assert_eq!(restored.id, original.id);
    assert_eq!(restored.data, original.data);
    let memory: String = db.query_row("SELECT content FROM memories WHERE id='memory'", [], |row| row.get(0)).unwrap();
    assert_eq!(memory, "사용자가 남긴 기억");
}

#[test]
fn duplicate_request_is_noop_but_changed_replay_and_stale_revision_fail() {
    let db = database();
    let directory = tempfile::tempdir().unwrap();
    prepare_widgets(&db, directory.path(), &["small-match"]);
    let first = request(&db, "small-match", "dice", json!({}));
    let stale = request(&db, "small-match", "dice", json!({}));
    storage::execute(&db, &first, 100, 19).unwrap();
    let result = instance(&db, "small-match");
    storage::execute(&db, &first, 200, 999).unwrap();
    assert_eq!(instance(&db, "small-match").data, result.data);
    assert_eq!(instance(&db, "small-match").revision, result.revision);
    assert!(storage::execute(&db, &stale, 200, 0).is_err());
    let mut changed = first.clone();
    changed.action = "coin".into();
    changed.input = json!({"choice":"heads"});
    assert!(storage::execute(&db, &changed, 200, 0).is_err());
    assert_eq!(instance(&db, "small-match").data["rounds"], 1);
}

#[test]
fn preparation_is_available_alongside_the_official_calendar() {
    let db = database();
    let directory = tempfile::tempdir().unwrap();
    prepare_widgets(&db, directory.path(), &["preparation", "calendar"]);
    act(&db, "preparation", "create", json!({"title":"여행 준비","date":"2026-10-03"}), 100, 1);
    let preparation = instance(&db, "preparation");
    let snapshot = storage::snapshot(&db).unwrap();
    let view = snapshot.widgets.iter().find(|view| view.instance.kind == "preparation").unwrap();
    assert_eq!(view.status, "enabled");
    assert!(view.missing.is_empty());
    assert_eq!(view.instance.data, preparation.data);
    assert!(snapshot.widgets.iter().any(|widget| widget.instance.kind == "calendar"));
}

#[test]
fn preparation_create_with_template_tasks_is_atomic_and_replay_safe() {
    let db = database();
    let directory = tempfile::tempdir().unwrap();
    prepare_widgets(&db, directory.path(), &["preparation", "todo"]);
    let before = instance(&db, "todo");
    let invalid = request(
        &db,
        "preparation",
        "create",
        json!({
            "title":"여행", "checks":[""], "tasks":[{"title":"예약 확인하기"}]
        }),
    );
    assert!(storage::execute(&db, &invalid, 100, 1).is_err());
    assert_eq!(instance(&db, "todo").data, before.data);
    assert_eq!(instance(&db, "todo").revision, before.revision);
    assert_eq!(instance(&db, "preparation").data["envelopes"], json!([]));
    let create = request(
        &db,
        "preparation",
        "create",
        json!({
            "title":"여행", "date":"2026-10-31", "checks":["카메라","충전기"],
            "tasks":[{"title":"예약 확인하기"},{"title":"티켓 받기"}], "reminderDays":3
        }),
    );
    storage::execute(&db, &create, 100, 1).unwrap();
    let prepared = instance(&db, "preparation").data;
    let todos = instance(&db, "todo").data;
    assert_eq!(
        prepared["envelopes"][0]["checks"].as_array().unwrap().len(),
        2
    );
    assert_eq!(prepared["envelopes"][0]["reminderDays"], 3);
    assert_eq!(
        prepared["envelopes"][0]["todoIds"],
        json!([todos["items"][0]["id"], todos["items"][1]["id"]])
    );
    storage::execute(&db, &create, 200, 2).unwrap();
    assert_eq!(instance(&db, "preparation").data, prepared);
    assert_eq!(instance(&db, "todo").data, todos);
}

#[test]
fn preparation_attachment_validation_and_check_promotion_are_atomic() {
    let db = database();
    let directory = tempfile::tempdir().unwrap();
    prepare_widgets(&db, directory.path(), &["preparation", "todo"]);
    act(
        &db,
        "preparation",
        "create",
        json!({"title":"여행"}),
        100,
        1,
    );
    let envelope = instance(&db, "preparation").data["envelopes"][0]["id"].clone();
    let before = instance(&db, "preparation");
    for action in ["create", "update"] {
        let invalid = request(
            &db,
            "preparation",
            action,
            json!({"id":envelope,"title":"bad","eventId":"missing","eventLabel":"missing"}),
        );
        assert!(storage::execute(&db, &invalid, 101, 1).is_err());
        assert_eq!(instance(&db, "preparation").data, before.data);
        let invalid_date = request(
            &db,
            "preparation",
            action,
            json!({"id":envelope,"title":"bad","date":"2026-02-30"}),
        );
        assert!(storage::execute(&db, &invalid_date, 101, 1).is_err());
        assert_eq!(instance(&db, "preparation").data, before.data);
    }
    act(
        &db,
        "preparation",
        "check-add",
        json!({"id":envelope,"text":"  숙소 예약\n확인  "}),
        102,
        1,
    );
    let check = instance(&db, "preparation").data["envelopes"][0]["checks"][0]["id"].clone();
    let before = instance(&db, "preparation");
    let bad = request(
        &db,
        "preparation",
        "check-promote",
        json!({"id":envelope,"checkId":check,"plannedDate":"2026-02-30"}),
    );
    assert!(storage::execute(&db, &bad, 103, 1).is_err());
    assert_eq!(instance(&db, "preparation").data, before.data);
    assert_eq!(instance(&db, "todo").data["items"], json!([]));
    let promote = request(
        &db,
        "preparation",
        "check-promote",
        json!({"id":envelope,"checkId":check,"plannedDate":"2026-10-03"}),
    );
    db.execute_batch("CREATE TRIGGER fail_preparation_update BEFORE UPDATE ON widget_instances WHEN NEW.kind='preparation' BEGIN SELECT RAISE(ABORT, 'test failure'); END;").unwrap();
    assert!(storage::execute(&db, &promote, 104, 1).is_err());
    assert_eq!(instance(&db, "preparation").data, before.data);
    assert_eq!(instance(&db, "todo").data["items"], json!([]));
    db.execute_batch("DROP TRIGGER fail_preparation_update;")
        .unwrap();
    storage::execute(&db, &promote, 104, 1).unwrap();
    storage::execute(&db, &promote, 105, 1).unwrap();
    let todo = instance(&db, "todo");
    assert_eq!(todo.data["items"].as_array().unwrap().len(), 1);
    assert_eq!(todo.data["items"][0]["title"], "  숙소 예약\n확인  ");
    assert_eq!(todo.data["items"][0]["plannedDate"], "2026-10-03");
    let prepared = instance(&db, "preparation");
    assert_eq!(prepared.data["envelopes"][0]["checks"], json!([]));
    assert_eq!(
        prepared.data["envelopes"][0]["todoIds"][0],
        todo.data["items"][0]["id"]
    );
    act(&db, "preparation", "delete", json!({"id":envelope}), 106, 1);
    assert_eq!(instance(&db, "todo").data, todo.data);
}

#[test]
fn preparation_schedule_update_only_accepts_live_calendar_events_and_keeps_other_fields() {
    let db = database();
    let directory = tempfile::tempdir().unwrap();
    prepare_widgets(&db, directory.path(), &["preparation", "calendar"]);
    act(
        &db,
        "preparation",
        "create",
        json!({"title":"여행 준비"}),
        100,
        1,
    );
    let id = instance(&db, "preparation").data["envelopes"][0]["id"].clone();
    act(
        &db,
        "preparation",
        "check-add",
        json!({"id":id,"text":"지켜 둘 체크"}),
        101,
        2,
    );
    let calendar = instance(&db, "calendar");
    let mut data = calendar.data;
    data["connections"] = json!([{"id":"live"},{},{"id":""},{"id":1}]);
    data["events"] = json!([
        {"id":"local","title":"내 일정","connectionId":"local"},
        {"id":"connected","title":"연결 일정","connectionId":"live"},
        {"id":"disconnected","title":"끊긴 일정","connectionId":"missing"},
        {"id":"missing-connection","title":"식별자 없는 일정"},
        {"id":"empty-connection","title":"빈 식별자 일정","connectionId":""},
        {"id":"numeric-connection","title":"숫자 식별자 일정","connectionId":1},
        {"id":"cancelled","title":"취소 일정","connectionId":"local","cancelled":true}
    ]);
    storage::commit_data(&db, &calendar.id, calendar.revision, data, vec![], 102).unwrap();
    let before = instance(&db, "preparation").data["envelopes"][0].clone();
    for event in [
        "disconnected",
        "cancelled",
        "absent",
        "missing-connection",
        "empty-connection",
        "numeric-connection",
    ] {
        assert!(storage::execute(
            &db,
            &request(
                &db,
                "preparation",
                "update",
                json!({"id":id,"eventId":event,"eventLabel":"불가"})
            ),
            103,
            1
        )
        .is_err());
        assert_eq!(instance(&db, "preparation").data["envelopes"][0], before);
    }
    for event in ["local", "connected", ""] {
        act(
            &db,
            "preparation",
            "update",
            json!({"id":id,"eventId":event,"eventLabel":"연결 제목"}),
            104,
            3,
        );
        let current = instance(&db, "preparation").data["envelopes"][0].clone();
        assert_eq!(current["checks"], before["checks"]);
        assert_eq!(current["links"], before["links"]);
        assert_eq!(current["todoIds"], before["todoIds"]);
        assert_eq!(current["title"], before["title"]);
        assert_eq!(current["eventId"], event);
        if event.is_empty() {
            assert_eq!(current["eventLabel"], "");
        }
    }
}

#[test]
fn old_preparation_package_is_upgraded_without_disabling_or_losing_content() {
    let db = database();
    let directory = tempfile::tempdir().unwrap();
    prepare_widgets(&db, directory.path(), &["preparation"]);
    act(
        &db,
        "preparation",
        "create",
        json!({"title":"남길 봉투"}),
        100,
        1,
    );
    let before = instance(&db, "preparation");
    let mut old = super::manifest("preparation").unwrap();
    old.description = "일정별 체크리스트와 자료 링크".into();
    old.required = vec!["calendar".into()];
    let path = directory.path().join("widgets/preparation/manifest.json");
    std::fs::write(&path, serde_json::to_vec(&old).unwrap()).unwrap();
    storage::verify_packages(&db, directory.path()).unwrap();
    let after = instance(&db, "preparation");
    assert!(after.error.is_none());
    assert_eq!(after.data, before.data);
    assert_eq!(
        std::fs::read(&path).unwrap(),
        serde_json::to_vec(&super::manifest("preparation").unwrap()).unwrap()
    );
}

#[test]
fn failed_manifest_verification_preserves_widget_data() {
    let db = database();
    let directory = tempfile::tempdir().unwrap();
    prepare_widgets(&db, directory.path(), &["interaction"]);
    let manifest = directory.path().join("widgets/interaction/manifest.json");
    let previous = b"invalid manifest";
    std::fs::write(&manifest, previous).unwrap();
    let data = instance(&db, "interaction").data;
    storage::verify_packages(&db, directory.path()).unwrap();
    assert_eq!(std::fs::read(&manifest).unwrap().as_slice(), previous);
    assert_eq!(instance(&db, "interaction").data, data);
    assert!(instance(&db, "interaction").error.is_some());
}

#[test]
fn package_failure_does_not_prevent_other_official_widgets() {
    let db = database();
    let directory = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(directory.path().join("widgets")).unwrap();
    std::fs::write(directory.path().join("widgets/fortune"), "installation obstacle").unwrap();
    storage::verify_packages(&db, directory.path()).unwrap();
    assert!(instance(&db, "fortune").error.is_some());
    assert!(instance(&db, "ball").error.is_none());
    assert!(directory.path().join("widgets/ball/manifest.json").is_file());
}

#[cfg(unix)]
#[test]
fn package_root_symlink_cannot_write_outside_install_directory() {
    let db = database();
    let directory = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    std::os::unix::fs::symlink(outside.path(), directory.path().join("widgets")).unwrap();
    storage::verify_packages(&db, directory.path()).unwrap();
    assert!(instance(&db, "ball").error.is_some());
    assert!(!outside.path().join("ball").exists());
}

#[test]
fn reaction_off_discards_pending_without_disabling_the_widget() {
    let db = database();
    let directory = tempfile::tempdir().unwrap();
    prepare_widgets(&db, directory.path(), &["small-match"]);
    act(&db, "small-match", "dice", json!({}), 100, 1);
    let before_toggle = instance(&db, "small-match");
    let id = before_toggle.id.clone();
    storage::set_reaction(&db, &id, false).unwrap();
    let after_toggle = instance(&db, "small-match");
    assert_eq!(after_toggle.revision, before_toggle.revision);
    assert_eq!(after_toggle.data, before_toggle.data);
    assert!(storage::take_reaction(&db, 101).unwrap().is_none());
    storage::initialize(&db).unwrap();
    assert!(!storage::reaction_enabled(&db, &id).unwrap());
    act(&db, "small-match", "dice", json!({}), 200, 2);
    assert!(storage::take_reaction(&db, 201).unwrap().is_none());
    assert_eq!(instance(&db, "small-match").data["rounds"], 2);
    storage::set_reaction(&db, &id, true).unwrap();
    act(&db, "small-match", "dice", json!({}), 300, 3);
    assert!(storage::take_reaction(&db, 301).unwrap().is_some());
}

#[test]
fn focus_statistics_survive_explicit_pause_and_resume() {
    let db = database();
    let directory = tempfile::tempdir().unwrap();
    prepare_widgets(&db, directory.path(), &["focus-timer"]);
    let now = chrono::Utc::now().timestamp_millis();
    act(&db, "focus-timer", "start", json!({"durationMs":20*60000}), now - 5 * 60000, 1);
    act(&db, "focus-timer", "pause", json!({}), now, 2);
    let paused = instance(&db, "focus-timer");
    assert_eq!(paused.data["status"], "paused");
    let elapsed = paused.data["activeSession"]["elapsedMs"].as_i64().unwrap();
    assert_eq!(elapsed, 5 * 60000);
    act(&db, "focus-timer", "resume", json!({}), now + 10 * 60000, 3);
    act(&db, "focus-timer", "cancel", json!({}), now + 25 * 60000, 4);
    let finished = instance(&db, "focus-timer");
    assert_eq!(finished.data["sessions"][0]["elapsedMs"], 20 * 60000);
    assert_eq!(finished.data["sessions"][0]["segments"].as_array().unwrap().len(), 2);
}

#[test]
fn focus_statistics_survive_restart_and_expired_sessions_are_not_replayed() {
    let db = database();
    let directory = tempfile::tempdir().unwrap();
    prepare_widgets(&db, directory.path(), &["focus-timer"]);
    let now = chrono::Utc::now().timestamp_millis();
    act(
        &db,
        "focus-timer",
        "start",
        json!({"durationMs":20*60000}),
        now - 5 * 60000,
        1,
    );
    let original = instance(&db, "focus-timer");
    storage::verify_packages(&db, directory.path()).unwrap();
    let restarted = instance(&db, "focus-timer");
    assert_eq!(restarted.data["status"], "running");
    assert_eq!(
        restarted.data["activeSession"]["id"],
        original.data["activeSession"]["id"]
    );
    assert_eq!(
        restarted.data["activeSession"]["runningSince"],
        now - 5 * 60000
    );
    act(&db, "focus-timer", "cancel", json!({}), now + 15 * 60000, 2);
    let recorded = instance(&db, "focus-timer");
    assert_eq!(recorded.data["sessions"][0]["elapsedMs"], 20 * 60000);
    act(
        &db,
        "focus-timer",
        "start",
        json!({"durationMs":1000}),
        now - 5000,
        3,
    );
    storage::verify_packages(&db, directory.path()).unwrap();
    let expired = instance(&db, "focus-timer");
    assert_eq!(expired.data["status"], "finished");
    assert_eq!(expired.data["sessions"].as_array().unwrap().len(), 2);
    assert_eq!(expired.data["sessions"][1]["elapsedMs"], 1000);
    assert_eq!(expired.data["sessions"][1]["endedAt"], now - 4000);
    assert!(
        storage::take_reaction(&db, chrono::Utc::now().timestamp_millis())
            .unwrap()
            .is_none()
    );
    storage::verify_packages(&db, directory.path()).unwrap();
    assert_eq!(instance(&db, "focus-timer").data, expired.data);
}

#[test]
fn invalid_focus_package_preserves_the_running_session_and_its_history() {
    let db = database();
    let directory = tempfile::tempdir().unwrap();
    prepare_widgets(&db, directory.path(), &["focus-timer"]);
    let now = chrono::Utc::now().timestamp_millis();
    act(
        &db,
        "focus-timer",
        "start",
        json!({"durationMs":20*60000}),
        now - 5 * 60000,
        1,
    );
    std::fs::write(
        directory.path().join("widgets/focus-timer/manifest.json"),
        "invalid",
    )
    .unwrap();
    storage::verify_packages(&db, directory.path()).unwrap();
    let current = instance(&db, "focus-timer");
    assert!(current.error.is_some());
    assert_eq!(current.data["status"], "running");
    assert_eq!(current.data["activeSession"]["runningSince"], now - 5 * 60000);
    prepare_widgets(&db, directory.path(), &["focus-timer"]);
    act(&db, "focus-timer", "cancel", json!({}), now + 15 * 60000, 2);
    assert_eq!(
        instance(&db, "focus-timer").data["sessions"][0]["elapsedMs"],
        20 * 60000
    );
}

#[test]
fn event_cleanup_preserves_diary_history_without_a_journal_widget_and_request_deduplication() {
    let db = database();
    let directory = tempfile::tempdir().unwrap();
    prepare_widgets(&db, directory.path(), &["small-match"]);
    let old = request(&db, "small-match", "dice", json!({}));
    storage::execute(&db, &old, 100, 1).unwrap();
    storage::take_reaction(&db, 101).unwrap();
    act(&db, "small-match", "dice", json!({}), 200, 2);
    storage::take_reaction(&db, 201).unwrap();
    storage::advance(&db, 600_000).unwrap();
    storage::take_reaction(&db, 600_000).unwrap();
    let retained: i64 = db
        .query_row("SELECT COUNT(*) FROM widget_events", [], |row| row.get(0))
        .unwrap();
    assert_eq!(
        retained, 2,
        "Diary events remain after reaction retention expires without installing a journal"
    );
    assert_eq!(
        storage::journal(&db, None, i64::MIN, i64::MAX)
            .unwrap()
            .len(),
        2
    );
    storage::execute(&db, &old, 600_001, 99).unwrap();
    assert_eq!(instance(&db, "small-match").data["rounds"], 2);
}

#[test]
fn retired_plane_description_upgrades_only_the_known_manifest_and_preserves_enabled_state() {
    for (enabled, tampered) in [(true, false), (false, false), (true, true)] {
        let db = database();
        let directory = tempfile::tempdir().unwrap();
        prepare_widgets(&db, directory.path(), &["paper-plane"]);
        let before = instance(&db, "paper-plane");
        if !enabled { db.execute("INSERT INTO widget_preferences(key,value) VALUES(?1,'0')", [format!("reaction:{}", before.id)]).unwrap(); }
        let mut old = super::manifest("paper-plane").unwrap();
        old.description = "드래그로 날리고 비행 기록을 남겨요".into();
        if tampered {
            old.required.push("music".into());
        }
        let path = directory.path().join("widgets/paper-plane/manifest.json");
        std::fs::write(&path, serde_json::to_vec(&old).unwrap()).unwrap();
        storage::verify_packages(&db, directory.path()).unwrap();
        let after = instance(&db, "paper-plane");
        assert_eq!(storage::reaction_enabled(&db, &before.id).unwrap(), enabled);
        assert_eq!(after.error.is_some(), tampered);
        assert_eq!(after.id, before.id);
        for field in ["x", "y", "vx", "vy", "startX", "startY"] {
            assert_eq!(after.data[field], before.data[field]);
        }
        let expected = if tampered {
            old
        } else {
            super::manifest("paper-plane").unwrap()
        };
        assert_eq!(
            std::fs::read(&path).unwrap(),
            serde_json::to_vec(&expected).unwrap()
        );
    }
}

#[test]
fn damaged_package_is_disabled_without_blocking_other_widgets_or_losing_data() {
    let db = crate::store::open(Path::new(":memory:")).unwrap();
    let directory = tempfile::tempdir().unwrap();
    prepare_widgets(&db, directory.path(), &["interaction", "fortune"]);
    act(
        &db,
        "interaction",
        "snack",
        json!({"character":"A"}),
        100,
        0,
    );
    let before = instance(&db, "interaction");
    let damaged = directory.path().join("widgets/interaction");
    std::fs::remove_dir_all(&damaged).unwrap();
    std::fs::write(&damaged, "not a package directory").unwrap();
    storage::verify_packages(&db, directory.path()).unwrap();
    let after = instance(&db, "interaction");
    assert!(after.error.is_some());
    assert_eq!(after.data, before.data);
    assert!(instance(&db, "fortune").error.is_none());
    assert!(storage::snapshot(&db).is_ok());
    assert!(storage::take_reaction(&db, 101).unwrap().is_none());
}

#[test]
fn interaction_rejects_a_removed_slot_before_spending_snacks_or_recording_events() {
    let db = crate::store::open(Path::new(":memory:")).unwrap();
    let directory = tempfile::tempdir().unwrap();
    prepare_widgets(&db, directory.path(), &["interaction"]);
    let requested = request(&db, "interaction", "snack", json!({"character":"B"}));
    let before = instance(&db, "interaction");
    let first = crate::characters::active_ids(&db).unwrap()[0].clone();
    crate::characters::apply_roster(&db, vec![first]).unwrap();
    assert!(storage::execute(&db, &requested, 100, 0).is_err());
    let after = instance(&db, "interaction");
    assert_eq!(after.data, before.data);
    assert_eq!(after.revision, before.revision);
    assert!(storage::journal(&db, None, i64::MIN, i64::MAX)
        .unwrap()
        .is_empty());
    assert!(storage::take_reaction(&db, 101).unwrap().is_none());
    act(
        &db,
        "interaction",
        "snack",
        json!({"character":"A"}),
        200,
        0,
    );
    let accepted = instance(&db, "interaction");
    assert_eq!(accepted.data["snacks"], 5);
    assert_eq!(accepted.data["touches"], 1);
    assert_eq!(
        storage::journal(&db, None, i64::MIN, i64::MAX).unwrap()[0]
            .1
            .event
            .payload["character"],
        "A"
    );
}

#[test]
fn interaction_accepts_all_eight_slots_and_rejects_a_changed_owner_without_side_effects() {
    let db = crate::store::open(Path::new(":memory:")).unwrap();
    let directory = tempfile::tempdir().unwrap();
    prepare_widgets(&db, directory.path(), &["interaction"]);
    let mut ids = crate::characters::active_ids(&db).unwrap();
    while ids.len() < 8 {
        ids.push(crate::characters::clone_character(&db, &ids[0]).unwrap().id);
    }
    crate::characters::apply_roster(&db, ids.clone()).unwrap();
    for (index, id) in ids.iter().enumerate() {
        let slot = ((b'A' + index as u8) as char).to_string();
        act(
            &db,
            "interaction",
            "stroke",
            json!({"character":slot,"owner":id}),
            100 + index as i64 * 5000,
            0,
        );
        let events = storage::journal(&db, None, i64::MIN, i64::MAX).unwrap();
        assert_eq!(events[0].1.event.payload["character"], slot);
        assert_eq!(events[0].1.event.payload["owner"], *id);
    }
    let before = instance(&db, "interaction");
    let requested = request(
        &db,
        "interaction",
        "snack",
        json!({"character":"H","owner":ids[7]}),
    );
    ids.swap(0, 7);
    crate::characters::apply_roster(&db, ids).unwrap();
    assert!(storage::execute(&db, &requested, 50_000, 0).is_err());
    let after = instance(&db, "interaction");
    assert_eq!(after.data, before.data);
    assert_eq!(after.revision, before.revision);
    assert_eq!(
        storage::journal(&db, None, i64::MIN, i64::MAX)
            .unwrap()
            .len(),
        8
    );
}

#[test]
fn timely_calendar_and_timer_alerts_survive_a_burst_of_ordinary_events() {
    for (kind, event_kind) in [
        ("calendar", "calendar-reminder"),
        ("calendar", "planner-reminder"),
        ("focus-timer", "timer-finished"),
    ] {
        let db = database();
        let directory = tempfile::tempdir().unwrap();
        let ordinary = [
            "interaction",
            "ball",
            "paper-plane",
            "bubbles",
            "small-match",
            "memo",
            "clock",
            "fortune",
            "preparation",
        ];
        let mut kinds = ordinary.to_vec();
        kinds.push(kind);
        prepare_widgets(&db, directory.path(), &kinds);
        for (index, source) in std::iter::once(kind).chain(ordinary).enumerate() {
            let current = instance(&db, source);
            storage::commit_data(
                &db,
                &current.id,
                current.revision,
                current.data,
                vec![super::EventDraft {
                    kind: if index == 0 {
                        event_kind
                    } else {
                        "play.result"
                    }
                    .into(),
                    text: "실제 사건".into(),
                    payload: json!({}),
                }],
                100 + index as i64,
            )
            .unwrap();
        }
        let selected = storage::take_reaction(&db, 200).unwrap().unwrap();
        assert_eq!(selected.event.kind, event_kind);
        assert!(storage::take_reaction(&db, 201).unwrap().is_none());
    }
}

#[test]
fn changing_a_source_discards_its_prepared_reaction() {
    let db = database();
    let directory = tempfile::tempdir().unwrap();
    prepare_widgets(&db, directory.path(), &["small-match"]);
    act(&db, "small-match", "dice", json!({}), 100, 49);
    let current = instance(&db, "small-match");
    storage::commit_data(
        &db,
        &current.id,
        current.revision,
        json!({"rounds":0}),
        vec![],
        201,
    )
    .unwrap();
    assert!(storage::take_reaction(&db, 202).unwrap().is_none());
}

#[test]
fn retired_widgets_keep_saved_data_but_cannot_resume_or_reinstall() {
    let db = database();
    let directory = tempfile::tempdir().unwrap();
    let data = json!({"userData":"보존", "completed":[{"title":"기존 기록"}], "phase":"bite", "food":{"x":4}, "configured":true});
    for kind in super::RETIRED_KINDS {
        db.execute(
            "INSERT INTO widget_instances VALUES(?1,?1,1,1,1,7,?2,NULL)",
            rusqlite::params![kind, data.to_string()],
        )
        .unwrap();
        let event = super::WidgetEvent {
            id: format!("event-{kind}"),
            instance_id: (*kind).into(),
            widget_kind: (*kind).into(),
            revision: 7,
            created_at: 0,
            expires_at: 30_000,
            event: super::EventDraft {
                kind: "legacy-event".into(),
                text: "기록".into(),
                payload: json!({}),
            },
        };
        db.execute(
            "INSERT INTO widget_events(id,instance_id,data,pending) VALUES(?1,?2,?3,1)",
            rusqlite::params![event.id, kind, serde_json::to_string(&event).unwrap()],
        )
        .unwrap();
        db.execute("INSERT INTO widget_journal VALUES(?1)", [event.id])
            .unwrap();
        assert!(storage::commit_data(&db, kind, 7, json!({}), vec![], 1).is_err());
        let request = super::WidgetRequest {
            request_id: uuid::Uuid::new_v4().to_string(),
            instance_id: (*kind).into(),
            expected_revision: 7,
            action: "start".into(),
            input: json!({}),
        };
        assert!(storage::execute(&db, &request, 1, 0).is_err());
    }
    assert!(storage::snapshot(&db).unwrap().widgets.iter().all(|view| !super::is_retired(&view.instance.kind)));
    assert!(!storage::advance(&db, 1).unwrap());
    assert!(storage::take_reaction(&db, 1).unwrap().is_none());
    storage::initialize(&db).unwrap();
    storage::verify_packages(&db, directory.path()).unwrap();
    for kind in super::RETIRED_KINDS {
        let (installed, enabled, revision, saved): (bool, bool, i64, String) = db.query_row(
            "SELECT installed,enabled,revision,data FROM widget_instances WHERE id=?1", [kind],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        ).unwrap();
        assert!(!installed && !enabled);
        assert_eq!(revision, 8);
        assert_eq!(serde_json::from_str::<Value>(&saved).unwrap(), data);
    }
    assert_eq!(
        storage::journal(&db, None, i64::MIN, i64::MAX)
            .unwrap()
            .len(),
        super::RETIRED_KINDS.len()
    );
    assert!(storage::snapshot(&db).unwrap().widgets.iter().all(|view| !super::is_retired(&view.instance.kind)));
    storage::initialize(&db).unwrap();
    for kind in super::RETIRED_KINDS {
        let revision: i64 = db.query_row("SELECT revision FROM widget_instances WHERE kind=?1", [kind], |row| row.get(0)).unwrap();
        assert_eq!(revision, 8);
    }
}

#[test]
fn diary_journal_filters_dates_before_pagination_and_preserves_history_after_retirement() {
    let db = database();
    // The old journal's saved events remain readable even after both source widgets retire.
    for index in 0..105 {
        let event = super::WidgetEvent {
            id: format!("historic-{index}"),
            instance_id: "collection".into(),
            widget_kind: "collection".into(),
            revision: 1,
            created_at: 1000 + index,
            expires_at: 0,
            event: super::EventDraft {
                kind: "legacy-event".into(),
                text: format!("  사건 {index}\n원문  "),
                payload: json!({}),
            },
        };
        db.execute(
            "INSERT INTO widget_events(id,instance_id,data,pending) VALUES(?1,?2,?3,0)",
            rusqlite::params![
                event.id,
                event.instance_id,
                serde_json::to_string(&event).unwrap()
            ],
        )
        .unwrap();
        db.execute("INSERT INTO widget_journal VALUES(?1)", [event.id])
            .unwrap();
    }
    // Later sequences from another day must not fill the first page of the requested day.
    for (index, at) in std::iter::repeat_n(2000, 110)
        .chain([999, 1105])
        .enumerate()
    {
        let event = super::WidgetEvent {
            id: format!("outside-{index}"),
            instance_id: "journal".into(),
            widget_kind: "journal".into(),
            revision: 1,
            created_at: at,
            expires_at: 0,
            event: super::EventDraft {
                kind: "legacy-event".into(),
                text: "다른 날".into(),
                payload: json!({}),
            },
        };
        db.execute(
            "INSERT INTO widget_events(id,instance_id,data,pending) VALUES(?1,?2,?3,0)",
            rusqlite::params![
                event.id,
                event.instance_id,
                serde_json::to_string(&event).unwrap()
            ],
        )
        .unwrap();
        db.execute("INSERT INTO widget_journal VALUES(?1)", [event.id])
            .unwrap();
    }
    storage::initialize(&db).unwrap();
    let first = storage::journal(&db, None, 1000, 1105).unwrap();
    assert_eq!(first.len(), 100);
    assert_eq!(first[0].1.event.text, "  사건 104\n원문  ");
    let second = storage::journal(&db, Some(first.last().unwrap().0), 1000, 1105).unwrap();
    assert_eq!(second.len(), 5);
    assert_eq!(second.last().unwrap().1.created_at, 1000);
    assert!(second
        .iter()
        .all(|row| !first.iter().any(|seen| seen.0 == row.0)));
    assert!(
        storage::journal(&db, Some(second.last().unwrap().0), 1000, 1105)
            .unwrap()
            .is_empty()
    );
    assert_eq!(storage::journal(&db, None, 1105, 1106).unwrap().len(), 1);
    assert!(storage::journal(&db, None, 1000, 1000).is_err());
}

#[test]
fn body_and_widget_share_inventory_and_cooldown_without_installing_the_widget() {
    let db = crate::store::open(Path::new(":memory:")).unwrap();
    let character = crate::characters::active_ids(&db).unwrap()[0].clone();
    let first = uuid::Uuid::new_v4().to_string();
    assert!(
        storage::body_interaction(&db, &character, "poke", &first, 1000)
            .unwrap()
            .is_some()
    );
    let body = instance(&db, "interaction");
    assert!(body.error.is_none());
    assert_eq!(body.data["snacks"], 6);
    assert_eq!(body.data["touches"], 1);
    assert!(
        !storage::body_interaction(&db, &character, "poke", &first, 1001)
            .unwrap()
            .is_some()
    );
    assert_eq!(instance(&db, "interaction").data["touches"], 1);
    assert!(storage::body_interaction(&db, &character, "snack", &first, 1002).is_err());
    assert!(storage::take_reaction(&db, 1003).unwrap().is_none());

    let directory = tempfile::tempdir().unwrap();
    prepare_widgets(&db, directory.path(), &["interaction"]);
    let installed = instance(&db, "interaction");
    assert_eq!(installed.id, body.id);
    assert_eq!(installed.data, body.data);
    act(
        &db,
        "interaction",
        "stroke",
        json!({"character":"A","owner":character}),
        2000,
        0,
    );
    assert_eq!(instance(&db, "interaction").data["touches"], 2);
    assert!(storage::take_reaction(&db, 2001).unwrap().is_none());
    let snack = uuid::Uuid::new_v4().to_string();
    assert!(
        storage::body_interaction(&db, &character, "snack", &snack, 6000)
            .unwrap()
            .is_some()
    );
    assert_eq!(instance(&db, "interaction").data["snacks"], 5);
    let cheek = uuid::Uuid::new_v4().to_string();
    let milestone = storage::body_interaction(&db, &character, "cheek-grab", &cheek, 6001)
        .unwrap()
        .unwrap();
    assert_eq!(milestone.event.kind, "interaction.milestone");
    assert_eq!(milestone.event.payload["milestone"], 1);
    assert_eq!(instance(&db, "interaction").data["snacks"], 5);
    assert_eq!(instance(&db, "interaction").data["touches"], 4);
}

#[test]
fn body_interaction_rejects_a_departed_owner_before_creating_data() {
    let db = crate::store::open(Path::new(":memory:")).unwrap();
    let active = crate::characters::active_ids(&db).unwrap();
    crate::characters::apply_roster(&db, vec![active[0].clone()]).unwrap();
    let before = instance(&db, "interaction");
    let rejected = uuid::Uuid::new_v4().to_string();
    assert!(storage::body_interaction(&db, "not-present", "snack", &rejected, 1000).is_err());
    let after = instance(&db, "interaction");
    assert_eq!(after.id, before.id);
    assert_eq!(after.data, before.data);
    assert_eq!(after.revision, before.revision);
}

#[test]
fn drink_and_gift_share_body_cooldown_without_spending_items_or_creating_rewards() {
    let db = crate::store::open(Path::new(":memory:")).unwrap();
    let owner = crate::characters::active_ids(&db).unwrap()[0].clone();
    let drink = uuid::Uuid::new_v4().to_string();
    assert!(
        storage::body_interaction(&db, &owner, "drink", &drink, 1000)
            .unwrap()
            .is_some()
    );
    assert!(
        storage::body_interaction(&db, &owner, "drink", &drink, 1001)
            .unwrap()
            .is_none()
    );
    assert!(storage::body_interaction(
        &db,
        &owner,
        "gift",
        &uuid::Uuid::new_v4().to_string(),
        1002
    )
    .unwrap()
    .is_none());
    let shared = instance(&db, "interaction");
    assert_eq!(shared.data["snacks"], 6);
    assert_eq!(shared.data["touches"], 0);
    assert!(shared.error.is_none());
    assert!(storage::body_interaction(
        &db,
        &owner,
        "gift",
        &uuid::Uuid::new_v4().to_string(),
        6000
    )
    .unwrap()
    .is_some());
    let milestone = storage::body_interaction(
        &db,
        &owner,
        "poke",
        &uuid::Uuid::new_v4().to_string(),
        6001
    )
    .unwrap()
    .unwrap();
    assert_eq!(milestone.event.kind, "interaction.milestone");
    assert_eq!(milestone.event.payload["milestone"], 1);
    assert_eq!(instance(&db, "interaction").data["touches"], 1);
    assert!(storage::take_reaction(&db, 6002).unwrap().is_none());
    assert_eq!(
        db.query_row("SELECT COUNT(*) FROM widget_journal", [], |row| row
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert!(crate::store::messages(&db, 100).unwrap().is_empty());
}

#[test]
fn selected_play_owner_is_revalidated_inside_the_widget_transaction() {
    let db = crate::store::open(Path::new(":memory:")).unwrap();
    let directory = tempfile::tempdir().unwrap();
    prepare_widgets(&db, directory.path(), &["small-match", "fortune"]);
    let ids = crate::characters::active_ids(&db).unwrap();
    for (kind, action) in [("small-match", "dice"), ("fortune", "draw")] {
        let selected = request(&db, kind, action, json!({"character":"A","owner":ids[0]}));
        crate::characters::apply_roster(&db, vec![ids[1].clone(), ids[0].clone()]).unwrap();
        let before = instance(&db, kind);
        assert!(storage::execute(&db, &selected, 1000, 19).is_err());
        assert_eq!(instance(&db, kind).revision, before.revision);
        let current = request(&db, kind, action, json!({"character":"B","owner":ids[0]}));
        storage::execute(&db, &current, 1001, 19).unwrap();
        crate::characters::apply_roster(&db, ids.clone()).unwrap();
    }
}

#[test]
fn discarded_weather_reaction_can_be_queued_again_until_started() {
    let db = database();
    let directory = tempfile::tempdir().unwrap();
    prepare_widgets(&db, directory.path(), &["weather"]);
    let weather = instance(&db, "weather");
    let draft = || super::EventDraft {
        kind: "weather.last-year".into(),
        text: "작년 날씨".into(),
        payload: json!({"day":"1970-01-01"}),
    };
    storage::set_reaction(&db, &weather.id, false).unwrap();
    for now in [0, 60_000, 120_000] {
        assert!(!storage::record_daily_weather_event(&db, &weather, draft(), "1970-01-01", now).unwrap());
    }
    let counts: (i64, i64) = db.query_row(
        "SELECT (SELECT COUNT(*) FROM widget_events), (SELECT COUNT(*) FROM widget_journal)",
        [], |row| Ok((row.get(0)?, row.get(1)?)),
    ).unwrap();
    assert_eq!(counts, (0, 0));
    storage::set_reaction(&db, &weather.id, true).unwrap();
    assert!(storage::record_daily_weather_event(&db, &weather, draft(), "1970-01-01", 0).unwrap());
    assert!(!storage::record_daily_weather_event(&db, &weather, draft(), "1970-01-01", 1).unwrap());
    storage::discard_pending(&db).unwrap();
    assert!(storage::record_daily_weather_event(&db, &weather, draft(), "1970-01-01", 2).unwrap());
    let event = storage::take_reaction(&db, 3).unwrap().unwrap();
    storage::mark_weather_reaction_started(&db, &event).unwrap();
    assert!(!storage::record_daily_weather_event(&db, &weather, draft(), "1970-01-01", 4).unwrap());
}

#[test]
fn weather_history_updates_later_live_forecasts() {
    let db = database();
    let mut data = json!({"config":{"latitude":37.5,"longitude":127.0},"forecast":{"timezone":"UTC","today":{"date":"1970-01-01","code":1,"tMax":10.0,"tMin":2.0}},"observation":{"temperature":5.0}});
    super::connections::save_weather_history(&db, &mut data, 0, None).unwrap();
    data["forecast"]["today"]["code"] = json!(3);
    data["forecast"]["today"]["tMax"] = json!(15.0);
    data["forecast"]["today"]["tMin"] = json!(1.0);
    super::connections::save_weather_history(&db, &mut data, 1, None).unwrap();
    let summary: (i64, f64, f64) = db.query_row(
        "SELECT code,tMax,tMin FROM weather_history WHERE day='1970-01-01'",
        [], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    ).unwrap();
    assert_eq!(summary, (3, 15.0, 1.0));
}

#[test]
fn disabled_official_widget_migrates_reaction_preference_once() {
    let db = database();
    let id = instance(&db, "plant").id;
    db.execute("UPDATE widget_instances SET enabled=0 WHERE id=?1", [&id]).unwrap();
    storage::initialize(&db).unwrap();
    assert!(!storage::reaction_enabled(&db, &id).unwrap());
    let enabled: i64 = db.query_row(
        "SELECT enabled FROM widget_instances WHERE id=?1", [&id], |row| row.get(0),
    ).unwrap();
    assert_eq!(enabled, 1);
    db.execute("DELETE FROM widget_preferences WHERE key=?1", [format!("reaction:{id}")]).unwrap();
    storage::initialize(&db).unwrap();
    assert!(storage::reaction_enabled(&db, &id).unwrap());

}
