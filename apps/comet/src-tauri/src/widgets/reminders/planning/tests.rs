use super::*;

fn setup(kinds: &[&str]) -> Connection {
    let db = Connection::open_in_memory().unwrap();
    storage::initialize(&db).unwrap();
    let directory = tempfile::tempdir().unwrap();
    storage::install(
        &db,
        directory.path(),
        &kinds.iter().map(|kind| (*kind).into()).collect::<Vec<_>>(),
    )
    .unwrap();
    db
}

fn widget(db: &Connection, kind: &str) -> WidgetInstance {
    storage::instances(db)
        .unwrap()
        .into_iter()
        .find(|instance| instance.kind == kind)
        .unwrap()
}

fn save(db: &Connection, instance: &WidgetInstance, data: Value, now: i64) {
    storage::commit_data(db, &instance.id, instance.revision, data, vec![], now).unwrap();
}

fn tick(db: &Connection, clocks: &mut BTreeMap<String, i64>, now: i64) -> Advance {
    storage::advance(db, now).unwrap();
    crate::widgets::reminders::advance(db, clocks, now, false).unwrap()
}

fn running_timer(db: &Connection, start: i64, channel: &str) -> WidgetInstance {
    let timer = widget(db, "focus-timer");
    let mut data = timer.data.clone();
    data["settings"]["autoStartRest"] = json!(true);
    data["settings"]["finishNotification"] = json!(channel);
    data["settings"]["finishSoundEnabled"] = json!(true);
    let effect = crate::widgets::planning::act(
        "focus-timer",
        &data,
        "start",
        &json!({"durationMs":60_000}),
        &BTreeMap::new(),
        start,
        0,
    )
    .unwrap();
    save(db, &timer, effect.data, start);
    widget(db, "focus-timer")
}

#[test]
fn live_finish_delivers_selected_channels_once_even_after_auto_rest_begins() {
    for channel in ["bubble", "os", "both"] {
        let db = setup(&["focus-timer"]);
        let start = 1_000_000;
        let timer = running_timer(&db, start, channel);
        let mut clocks = BTreeMap::new();
        assert!(tick(&db, &mut clocks, start + 59_000).os.is_empty());
        let result = tick(&db, &mut clocks, start + 60_000);
        assert_eq!(result.os.len(), usize::from(channel != "bubble"));
        if let Some(delivery) = result.os.first() {
            assert_eq!(delivery.instance_id, timer.id);
            assert!(delivery.sound_enabled);
            assert!(delivery.widget);
            assert!(delivery.text.contains("집중 시간이 끝났어요"));
        }
        let timer = storage::get(&db, &timer.id).unwrap();
        assert_eq!(timer.data["mode"], "rest");
        assert_eq!(timer.data["status"], "running");
        assert_eq!(
            storage::take_reaction(&db, start + 60_001)
                .unwrap()
                .is_some(),
            channel != "os"
        );
        assert!(tick(&db, &mut clocks, start + 60_500).os.is_empty());
        assert_eq!(
            storage::journal(&db, None, start, start + 61_000)
                .unwrap()
                .len(),
            1
        );
    }
}

#[test]
fn restart_suspend_and_cancel_do_not_deliver_old_focus_completions() {
    for gap in [None, Some(121_000)] {
        let db = setup(&["focus-timer"]);
        let start = 1_000_000;
        running_timer(&db, start, "both");
        let mut clocks = BTreeMap::new();
        if let Some(gap) = gap {
            tick(&db, &mut clocks, start + 60_000 - gap);
        }
        assert!(tick(&db, &mut clocks, start + 60_000).os.is_empty());
        assert!(tick(&db, &mut clocks, start + 60_500).os.is_empty());
    }
    let db = setup(&["focus-timer"]);
    let timer = running_timer(&db, 1_000_000, "both");
    let mut clocks = BTreeMap::new();
    tick(&db, &mut clocks, 1_059_000);
    let effect = crate::widgets::planning::act(
        "focus-timer",
        &timer.data,
        "cancel",
        &json!({}),
        &BTreeMap::new(),
        1_059_500,
        0,
    )
    .unwrap();
    save(&db, &timer, effect.data, 1_059_500);
    assert!(tick(&db, &mut clocks, 1_060_000).os.is_empty());
}

fn linked_focus(db: &Connection, now: i64, lead: i64) {
    let calendar = widget(db, "calendar");
    let starts = now + lead * 60_000;
    let event = json!({"id":"selected", "title":"선택한 일정", "connectionId":"local", "startAt":starts,"endAt":starts+60_000,"allDay":false,"cancelled":false});
    let other = json!({"id":"other", "title":"다른 일정", "connectionId":"local", "startAt":starts,"allDay":false,"cancelled":false});
    let mut data = calendar.data.clone();
    data["events"] = json!([event, other]);
    save(db, &calendar, data, now - 1000);
    let timer = widget(db, "focus-timer");
    let mut data = timer.data.clone();
    data["eventRef"] = json!({"calendarWidgetId":calendar.id,"id":"selected","title":"선택한 일정","startAt":starts,"endAt":starts+60_000,"connectionId":"local","sourceId":"","occurrenceId":""});
    data["settings"]["linkedEventLeadMinutes"] = json!(lead);
    data["settings"]["finishNotification"] = json!("both");
    save(db, &timer, data, now - 1000);
}

#[test]
fn selected_event_notice_uses_its_lead_and_revalidates_the_current_event() {
    for lead in [0, 5] {
        let db = setup(&["calendar", "focus-timer"]);
        let now = chrono::Utc::now().timestamp_millis();
        linked_focus(&db, now, lead);
        let mut clocks = BTreeMap::new();
        assert!(tick(&db, &mut clocks, now - 500).os.is_empty());
        let result = tick(&db, &mut clocks, now + 500);
        assert_eq!(result.os.len(), 1);
        assert!(result.os[0].text.contains("선택한 일정"));
        assert!(!result.os[0].text.contains("다른 일정"));
        let pending = storage::take_reaction(&db, now + 501).unwrap().unwrap();
        assert!(crate::widgets::reminders::event_current(&db, &pending).unwrap());
        let calendar = widget(&db, "calendar");
        let mut data = calendar.data.clone();
        data["events"][0]["cancelled"] = json!(true);
        save(&db, &calendar, data, now + 502);
        assert!(!crate::widgets::reminders::event_current(&db, &pending).unwrap());
        assert!(tick(&db, &mut clocks, now + 1000).os.is_empty());
    }
}

#[test]
fn focus_notice_ignores_stale_rescheduled_disabled_or_unlinked_events() {
    for branch in ["stale", "rescheduled", "disabled", "unlinked", "off"] {
        let db = setup(&["calendar", "focus-timer"]);
        let now = 1_000_000;
        linked_focus(&db, now, 5);
        let mut clocks = BTreeMap::new();
        tick(&db, &mut clocks, now - 500);
        let calendar = widget(&db, "calendar");
        let mut data = calendar.data.clone();
        match branch {
            "stale" => {
                data["events"][0]["connectionId"] = json!("external");
                data["connections"] =
                    json!([{"id":"external","status":"offline","lastSuccessAt":now}]);
                save(&db, &calendar, data, now - 1);
            }
            "rescheduled" => {
                data["events"][0]["startAt"] = json!(now + 300_001);
                save(&db, &calendar, data, now - 1);
            }
            "disabled" => {
                db.execute(
                    "UPDATE widget_instances SET enabled=0 WHERE id=?1",
                    [&calendar.id],
                )
                .unwrap();
            }
            _ => {
                let timer = widget(&db, "focus-timer");
                let mut data = timer.data.clone();
                if branch == "unlinked" {
                    data["eventRef"] = Value::Null;
                } else {
                    data["settings"]["linkedEventLeadMinutes"] = Value::Null;
                }
                save(&db, &timer, data, now - 1);
            }
        }
        assert!(tick(&db, &mut clocks, now).os.is_empty(), "{branch}");
        assert!(
            storage::take_reaction(&db, now).unwrap().is_none(),
            "{branch}"
        );
    }
}

fn preparation(db: &Connection, date: &str) {
    let preparation = widget(db, "preparation");
    let mut data = preparation.data.clone();
    data["reminderDays"] = json!(3);
    data["envelopes"] = json!([
        {"id":"trip","title":"여행","date":date,"eventId":"","checks":[],"links":[],"todoIds":[]},
        {"id":"archived","title":"보관됨","date":date,"eventId":"","archived":true,"checks":[],"links":[],"todoIds":[]},
        {"id":"off","title":"알림 끔","date":date,"eventId":"","reminderDays":0,"checks":[],"links":[],"todoIds":[]}
    ]);
    save(db, &preparation, data, 1);
}

#[test]
fn standalone_preparation_reminds_once_and_archive_invalidates_pending_bubble() {
    let db = setup(&["preparation"]);
    let now = local_date_time("2026-10-15", "09:00").unwrap();
    preparation(&db, "2026-10-18");
    let mut clocks = BTreeMap::new();
    assert!(!tick(&db, &mut clocks, now - 500).changed);
    let result = tick(&db, &mut clocks, now);
    assert!(result.changed);
    assert!(result.os.is_empty());
    let pending = storage::take_reaction(&db, now + 1).unwrap().unwrap();
    assert!(pending.event.text.contains("여행까지 3일"));
    assert_eq!(pending.event.payload["targets"][0]["id"], "trip");
    assert!(crate::widgets::reminders::event_current(&db, &pending).unwrap());
    assert!(!tick(&db, &mut clocks, now + 500).changed);
    assert!(!tick(&db, &mut BTreeMap::new(), now).changed);
    let current = widget(&db, "preparation");
    let mut data = current.data.clone();
    data["envelopes"][0]["archived"] = json!(true);
    save(&db, &current, data, now + 2);
    assert!(!crate::widgets::reminders::event_current(&db, &pending).unwrap());
}

#[test]
fn preparation_inherits_calendar_channels_and_envelope_override_without_snooze_identity_collision()
{
    let db = setup(&["preparation", "calendar"]);
    let now = local_date_time("2026-10-15", "09:00").unwrap();
    preparation(&db, "2026-10-18");
    let preparation = widget(&db, "preparation");
    let mut data = preparation.data.clone();
    data["envelopes"].as_array_mut().unwrap().push(json!({"id":"one-day","title":"발표","date":"2026-10-16","eventId":"","reminderDays":1,"checks":[],"links":[],"todoIds":[]}));
    save(&db, &preparation, data, now - 1000);
    let calendar = widget(&db, "calendar");
    let mut data = calendar.data.clone();
    data["reminders"]["characterEnabled"] = json!(false);
    data["reminders"]["osEnabled"] = json!(true);
    data["reminders"]["soundEnabled"] = json!(true);
    save(&db, &calendar, data, now - 1000);
    let mut clocks = BTreeMap::new();
    tick(&db, &mut clocks, now - 500);
    let result = tick(&db, &mut clocks, now);
    assert_eq!(result.os.len(), 2);
    assert!(result
        .os
        .iter()
        .all(|delivery| delivery.widget && delivery.sound_enabled));
    assert_ne!(result.os[0].notification_key, result.os[1].notification_key);
    assert!(storage::take_reaction(&db, now).unwrap().is_none());
    assert!(tick(&db, &mut clocks, now + 500).os.is_empty());
}

#[test]
fn simultaneous_preparation_reminders_share_one_bubble_without_losing_targets() {
    let db = setup(&["preparation"]);
    let now = local_date_time("2026-10-15", "09:00").unwrap();
    preparation(&db, "2026-10-18");
    let current = widget(&db, "preparation");
    let mut data = current.data.clone();
    let mut second = data["envelopes"][0].clone();
    second["id"] = json!("second");
    second["title"] = json!("긴 제목".repeat(250));
    data["envelopes"].as_array_mut().unwrap().push(second);
    save(&db, &current, data, now - 1000);
    let mut clocks = BTreeMap::new();
    tick(&db, &mut clocks, now - 500);
    tick(&db, &mut clocks, now);
    let event = storage::take_reaction(&db, now).unwrap().unwrap();
    assert_eq!(event.event.payload["targets"].as_array().unwrap().len(), 2);
    assert!(event.event.text.contains("여행까지 3일"));
    assert!(event.event.text.chars().count() < 2000);
    assert_eq!(storage::journal(&db, None, now, now + 1).unwrap().len(), 1);
}

#[test]
fn preparation_skips_suspended_ticks_disabled_widgets_and_broken_event_links() {
    for branch in [
        "suspend",
        "disabled",
        "uninstalled",
        "missing",
        "cancelled",
        "stale",
    ] {
        let db = setup(&["preparation", "calendar"]);
        let now = local_date_time("2026-10-15", "09:00").unwrap();
        preparation(&db, "2026-10-18");
        let mut clocks = BTreeMap::new();
        tick(
            &db,
            &mut clocks,
            now - if branch == "suspend" { 121_000 } else { 500 },
        );
        let preparation = widget(&db, "preparation");
        if branch == "disabled" || branch == "uninstalled" {
            db.execute(
                if branch == "disabled" {
                    "UPDATE widget_instances SET enabled=0 WHERE id=?1"
                } else {
                    "UPDATE widget_instances SET installed=0 WHERE id=?1"
                },
                [&preparation.id],
            )
            .unwrap();
        } else if ["missing", "cancelled", "stale"].contains(&branch) {
            let mut data = preparation.data.clone();
            data["envelopes"][0]["eventId"] = json!("linked");
            save(&db, &preparation, data, now - 1);
            if branch != "missing" {
                let calendar = widget(&db, "calendar");
                let mut data = calendar.data.clone();
                data["events"] = json!([{"id":"linked","title":"여행","startDate":"2026-10-18","allDay":true,"connectionId":if branch == "stale" {"old"} else {"local"},"cancelled":branch=="cancelled"}]);
                save(&db, &calendar, data, now - 1);
            }
        }
        let result = tick(&db, &mut clocks, now);
        assert!(result.os.is_empty(), "{branch}");
        assert!(
            storage::take_reaction(&db, now).unwrap().is_none(),
            "{branch}"
        );
    }
}

#[test]
fn silent_finish_does_not_consume_an_unrelated_pending_reminder() {
    let db = setup(&["calendar", "focus-timer"]);
    let now = 1_000_000;
    let calendar = widget(&db, "calendar");
    storage::commit_data(
        &db,
        &calendar.id,
        calendar.revision,
        calendar.data,
        vec![EventDraft {
            kind: "planner-reminder".into(),
            text: "회의".into(),
            payload: json!({}),
        }],
        now,
    )
    .unwrap();
    let timer = widget(&db, "focus-timer");
    storage::commit_data(
        &db,
        &timer.id,
        timer.revision,
        timer.data,
        vec![EventDraft {
            kind: "timer-finished".into(),
            text: "끝".into(),
            payload: json!({"bubbleEnabled":false,"finishedAt":now}),
        }],
        now,
    )
    .unwrap();
    let event = storage::take_reaction(&db, now).unwrap().unwrap();
    assert_eq!(event.instance_id, calendar.id);
    assert_eq!(storage::journal(&db, None, now, now + 1).unwrap().len(), 2);
}
