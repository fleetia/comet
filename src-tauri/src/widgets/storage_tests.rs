use super::{storage, WidgetInstance, WidgetRequest};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::path::Path;

fn database() -> Connection {
    let db = Connection::open_in_memory().unwrap();
    storage::initialize(&db).unwrap();
    db
}

fn install(db: &Connection, path: &Path, kinds: &[&str]) {
    storage::install(
        db,
        path,
        &kinds.iter().map(|kind| (*kind).into()).collect::<Vec<_>>(),
    )
    .unwrap();
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
fn calendar_colors_are_scoped_atomic_and_preserved_by_reminder_changes() {
    let db = database();
    let directory = tempfile::tempdir().unwrap();
    install(&db, directory.path(), &["calendar"]);
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
fn planner_batch_is_atomic_and_frequency_records_drive_completion_jar() {
    let db = database();
    let directory = tempfile::tempdir().unwrap();
    install(&db, directory.path(), &["todo", "completion-jar"]);
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
    let jar = instance(&db, "completion-jar").data;
    assert_eq!(jar["completed"].as_array().unwrap().len(), 1);
    let record_id = jar["completed"][0]["id"].clone();
    act(
        &db,
        "todo",
        "undo-frequency",
        json!({"id":item_id,"recordId":record_id}),
        now + 2,
        4,
    );
    assert!(instance(&db, "completion-jar").data["completed"]
        .as_array()
        .unwrap()
        .is_empty());
}

#[test]
fn first_run_can_skip_without_installing_packages() {
    let db = database();
    let before = storage::snapshot(&db).unwrap();
    assert_eq!(before.catalog.len(), 22);
    assert!(before.widgets.is_empty());
    assert!(!before.onboarding_done);
    storage::finish_onboarding(&db).unwrap();
    assert!(storage::snapshot(&db).unwrap().onboarding_done);
    assert!(storage::instances(&db).unwrap().is_empty());
}

#[test]
fn desktop_outcomes_preserve_legacy_data_and_reject_removed_revisions() {
    let db = database();
    let directory = tempfile::tempdir().unwrap();
    install(&db, directory.path(), &["ball", "journal"]);
    let original = instance(&db, "ball");
    let draft = || super::EventDraft {
        kind: "desktop.ball.stopped".into(),
        text: "공이 멈췄어요.".into(),
        payload: json!({"distanceUnit":"desktop-logical-points","distance":250.0}),
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
    assert_eq!(
        storage::journal(&db, None).unwrap()[0].1.event.payload["distance"],
        250.0
    );
    storage::set_enabled(&db, &original.id, false).unwrap();
    assert!(!storage::record_desktop_result(
        &db,
        &original.id,
        original.revision,
        draft(),
        2000,
        true
    )
    .unwrap());
    storage::remove(&db, directory.path(), &original.id, true).unwrap();
    let count: i64 = db
        .query_row("SELECT COUNT(*) FROM desktop_toy_results", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(count, 0);
    assert!(storage::journal(&db, None).unwrap().is_empty());
}

#[test]
fn clearing_automatic_desktop_reactions_preserves_manual_timer_and_journal() {
    let db = database();
    let directory = tempfile::tempdir().unwrap();
    install(&db, directory.path(), &["ball", "journal", "focus-timer"]);
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
    let before = storage::journal(&db, None).unwrap();
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
        serde_json::to_value(storage::journal(&db, None).unwrap()).unwrap(),
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
fn preserve_reinstall_and_delete_leave_companion_data_untouched() {
    let directory = tempfile::tempdir().unwrap();
    let db_path = directory.path().join("app.sqlite");
    let db = crate::store::open(&db_path).unwrap();
    db.execute("INSERT INTO memories(id,content,source,updated) VALUES('memory','사용자가 남긴 기억','manual',1)", []).unwrap();
    crate::store::insert_message(
        &db,
        &crate::types::Message {
            id: "message".into(),
            role: "user".into(),
            persona: Some("both".into()),
            content: "원문 대화 보존".into(),
            expression: None,
            created_at: 1,
            status: "complete".into(),
        },
    )
    .unwrap();
    install(&db, directory.path(), &["interaction"]);
    act(
        &db,
        "interaction",
        "snack",
        json!({"character":"A"}),
        100,
        0,
    );
    let original = instance(&db, "interaction");
    storage::remove(&db, directory.path(), &original.id, false).unwrap();
    assert!(!directory.path().join("widgets/interaction").exists());
    assert_eq!(instance(&db, "interaction").data, original.data);
    drop(db);

    let db = crate::store::open(&db_path).unwrap();
    storage::verify_packages(&db, directory.path()).unwrap();
    assert!(!instance(&db, "interaction").installed);
    install(&db, directory.path(), &["interaction"]);
    let restored = instance(&db, "interaction");
    assert_eq!(restored.id, original.id);
    assert_eq!(restored.data, original.data);
    assert!(storage::take_reaction(&db, 101).unwrap().is_none());
    storage::remove(&db, directory.path(), &restored.id, true).unwrap();
    install(&db, directory.path(), &["interaction"]);
    assert_eq!(instance(&db, "interaction").data["snacks"], 6);
    let memory: String = db
        .query_row(
            "SELECT content FROM memories WHERE id='memory'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let message: String = db
        .query_row("SELECT data FROM messages WHERE id='message'", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(memory, "사용자가 남긴 기억");
    assert_eq!(
        serde_json::from_str::<Value>(&message).unwrap()["content"],
        "원문 대화 보존"
    );
}

#[test]
fn duplicate_request_is_noop_but_changed_replay_and_stale_revision_fail() {
    let db = database();
    let directory = tempfile::tempdir().unwrap();
    install(&db, directory.path(), &["small-match"]);
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
fn guessing_snapshot_hides_answer_until_the_actual_win() {
    let db = database();
    let directory = tempfile::tempdir().unwrap();
    install(&db, directory.path(), &["guessing"]);
    act(&db, "guessing", "start", json!({"mode":"number"}), 100, 49);
    assert_eq!(instance(&db, "guessing").data["answer"], 50);
    assert!(storage::snapshot(&db).unwrap().widgets[0]
        .instance
        .data
        .get("answer")
        .is_none());
    act(&db, "guessing", "guess", json!({"value":20}), 200, 99);
    assert!(storage::snapshot(&db).unwrap().widgets[0]
        .instance
        .data
        .get("answer")
        .is_none());
    act(&db, "guessing", "guess", json!({"value":50}), 300, 0);
    let finished = storage::snapshot(&db).unwrap();
    assert_eq!(finished.widgets[0].instance.data["playing"], false);
    assert_eq!(finished.widgets[0].instance.data["answer"], 50);
}

#[test]
fn only_successful_fishing_awards_reach_enabled_collection_once() {
    let db = database();
    let directory = tempfile::tempdir().unwrap();
    install(&db, directory.path(), &["fishing", "collection", "journal"]);
    act(&db, "fishing", "cast", json!({}), 100, 0);
    act(&db, "fishing", "reel", json!({}), 101, 2);
    assert!(instance(&db, "collection").data["items"]
        .as_array()
        .unwrap()
        .is_empty());
    act(&db, "fishing", "cast", json!({}), 1000, 0);
    let reel = request(&db, "fishing", "reel", json!({}));
    storage::execute(&db, &reel, 3000, 2).unwrap();
    storage::execute(&db, &reel, 3100, 2).unwrap();
    assert_eq!(
        instance(&db, "collection").data["items"],
        json!([{"itemId":"sock","name":"양말","quantity":1}])
    );
    assert_eq!(
        storage::journal(&db, None)
            .unwrap()
            .iter()
            .filter(|(_, event)| event.event.kind == "item-acquired")
            .count(),
        1
    );

    storage::set_enabled(&db, &instance(&db, "collection").id, false).unwrap();
    act(&db, "fishing", "cast", json!({}), 10_000, 0);
    act(&db, "fishing", "reel", json!({}), 12_000, 2);
    storage::set_enabled(&db, &instance(&db, "collection").id, true).unwrap();
    assert_eq!(instance(&db, "collection").data["items"][0]["quantity"], 1);
    assert_eq!(
        storage::journal(&db, None)
            .unwrap()
            .iter()
            .filter(|(_, event)| event.event.kind == "item-acquired")
            .count(),
        2
    );
}

#[test]
fn missing_dependency_is_explicit_and_never_silently_installed() {
    let db = database();
    let directory = tempfile::tempdir().unwrap();
    assert!(storage::install(&db, directory.path(), &["preparation".into()]).is_err());
    assert!(storage::instances(&db).unwrap().is_empty());
    install(&db, directory.path(), &["calendar", "preparation"]);
    let preparation = instance(&db, "preparation");
    storage::remove(&db, directory.path(), &instance(&db, "calendar").id, false).unwrap();
    let snapshot = storage::snapshot(&db).unwrap();
    let view = snapshot
        .widgets
        .iter()
        .find(|view| view.instance.kind == "preparation")
        .unwrap();
    assert_eq!(view.status, "setup");
    assert_eq!(view.missing, vec!["calendar"]);
    assert_eq!(view.instance.data, preparation.data);
    assert!(view.instance.installed);
}

#[test]
fn incompatible_preserved_data_does_not_replace_existing_package() {
    let db = database();
    let directory = tempfile::tempdir().unwrap();
    install(&db, directory.path(), &["interaction"]);
    let manifest = directory.path().join("widgets/interaction/manifest.json");
    let previous = br#"{"version":2,"previous":"verified package"}"#;
    std::fs::write(&manifest, previous).unwrap();
    db.execute(
        "UPDATE widget_instances SET version=2 WHERE kind='interaction'",
        [],
    )
    .unwrap();
    let data = instance(&db, "interaction").data;
    assert!(storage::install(&db, directory.path(), &["interaction".into()]).is_err());
    assert_eq!(std::fs::read(&manifest).unwrap(), previous);
    assert_eq!(instance(&db, "interaction").data, data);
}

#[test]
fn failed_batch_leaves_no_partially_installed_package() {
    let db = database();
    let directory = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(directory.path().join("widgets")).unwrap();
    std::fs::write(
        directory.path().join("widgets/fortune"),
        "installation obstacle",
    )
    .unwrap();
    assert!(storage::install(&db, directory.path(), &["ball".into(), "fortune".into()]).is_err());
    assert!(!directory.path().join("widgets/ball").exists());
    assert!(storage::instances(&db)
        .unwrap()
        .iter()
        .all(|entry| !entry.installed));
}

#[cfg(unix)]
#[test]
fn package_root_symlink_cannot_write_outside_install_directory() {
    let db = database();
    let directory = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    std::os::unix::fs::symlink(outside.path(), directory.path().join("widgets")).unwrap();
    assert!(storage::install(&db, directory.path(), &["ball".into()]).is_err());
    assert!(!outside.path().join("ball").exists());
}

#[test]
fn disabled_and_restarted_widgets_do_not_replay_pending_reactions() {
    let db = database();
    let directory = tempfile::tempdir().unwrap();
    install(&db, directory.path(), &["small-match"]);
    act(&db, "small-match", "dice", json!({}), 100, 1);
    storage::set_enabled(&db, &instance(&db, "small-match").id, false).unwrap();
    storage::set_enabled(&db, &instance(&db, "small-match").id, true).unwrap();
    assert!(storage::take_reaction(&db, 101).unwrap().is_none());
    act(&db, "small-match", "dice", json!({}), 200, 2);
    storage::verify_packages(&db, directory.path()).unwrap();
    assert!(storage::take_reaction(&db, 201).unwrap().is_none());
    assert_eq!(instance(&db, "small-match").data["rounds"], 2);
}

#[test]
fn event_cleanup_preserves_opted_in_journal_and_request_deduplication() {
    let db = database();
    let directory = tempfile::tempdir().unwrap();
    install(&db, directory.path(), &["small-match"]);
    let old = request(&db, "small-match", "dice", json!({}));
    storage::execute(&db, &old, 100, 1).unwrap();
    storage::take_reaction(&db, 101).unwrap();
    install(&db, directory.path(), &["journal"]);
    act(&db, "small-match", "dice", json!({}), 200, 2);
    storage::take_reaction(&db, 201).unwrap();
    storage::advance(&db, 600_000).unwrap();
    storage::take_reaction(&db, 600_000).unwrap();
    let retained: i64 = db
        .query_row("SELECT COUNT(*) FROM widget_events", [], |row| row.get(0))
        .unwrap();
    assert_eq!(
        retained, 1,
        "Only the opted-in journal event should remain after retention expires"
    );
    assert_eq!(storage::journal(&db, None).unwrap().len(), 1);
    storage::execute(&db, &old, 600_001, 99).unwrap();
    assert_eq!(instance(&db, "small-match").data["rounds"], 2);
}

#[test]
fn damaged_package_is_disabled_without_blocking_other_widgets_or_losing_data() {
    let db = database();
    let directory = tempfile::tempdir().unwrap();
    install(&db, directory.path(), &["interaction", "fortune"]);
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
    assert!(!after.enabled);
    assert!(after.error.is_some());
    assert_eq!(after.data, before.data);
    assert!(instance(&db, "fortune").enabled);
    assert!(storage::snapshot(&db).is_ok());
    assert!(storage::take_reaction(&db, 101).unwrap().is_none());
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
            "guessing",
            "fishing",
            "fortune",
            "plant",
        ];
        let mut kinds = ordinary.to_vec();
        kinds.push(kind);
        install(&db, directory.path(), &kinds);
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
    install(&db, directory.path(), &["guessing"]);
    act(&db, "guessing", "start", json!({"mode":"number"}), 100, 49);
    act(&db, "guessing", "guess", json!({"value":20}), 200, 0);
    act(&db, "guessing", "start", json!({"mode":"cups"}), 201, 2);
    assert!(storage::take_reaction(&db, 202).unwrap().is_none());
}

#[test]
fn reenabled_plant_does_not_grow_for_the_time_it_was_disabled() {
    let db = database();
    let directory = tempfile::tempdir().unwrap();
    install(&db, directory.path(), &["plant"]);
    let plant = instance(&db, "plant");
    storage::set_enabled(&db, &plant.id, false).unwrap();
    db.execute(
        "UPDATE widget_instances SET data=? WHERE id=?",
        rusqlite::params![
            json!({"stage":1,"water":2,"updatedAt":100}).to_string(),
            plant.id,
        ],
    )
    .unwrap();
    storage::set_enabled(&db, &plant.id, true).unwrap();
    storage::advance(&db, chrono::Utc::now().timestamp_millis()).unwrap();
    let resumed = instance(&db, "plant");
    assert_eq!(resumed.data["stage"], 1);
    assert_eq!(resumed.data["water"], 2);
    assert!(
        storage::take_reaction(&db, chrono::Utc::now().timestamp_millis())
            .unwrap()
            .is_none()
    );
}
