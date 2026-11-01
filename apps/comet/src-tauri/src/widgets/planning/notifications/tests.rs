use super::*;
use crate::widgets::{storage, EventDraft, WidgetEvent};
use serde_json::json;

#[tokio::test]
async fn travel_timeout_waits_for_the_actual_delivery_result() {
    for final_result in [Ok(()), Err("전달 실패".to_string())] {
        let (send, receive) = tokio::sync::oneshot::channel();
        let (timed_out, timeout_observed) = tokio::sync::oneshot::channel();
        let delivery =
            wait_for_travel_delivery(Ok(receive), std::time::Duration::from_millis(1), || {
                let _ = timed_out.send(());
            });
        tokio::pin!(delivery);
        tokio::select! {
            _ = timeout_observed => {},
            _ = &mut delivery => panic!("delivery completed before its callback"),
        }
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(1), &mut delivery)
                .await
                .is_err()
        );
        send.send(final_result.clone()).unwrap();
        assert_eq!(delivery.await, final_result);
    }
}

#[test]
fn external_notifications_do_not_route_to_planner_actions() {
    assert!(is_external_notification("planner:external-123:0"));
    assert!(!is_external_notification("planner:calendar-id:123"));
    assert!(!is_external_notification("widget:timer-id:123:key"));
}

#[test]
fn notification_destinations_preserve_ids_and_list_fallbacks() {
    for destination in [
        (
            "calendar".to_string(),
            Some("event".to_string()),
            Some("source:일정/1".to_string()),
        ),
        ("todos".to_string(), None, None),
        (
            "envelopes".to_string(),
            Some("envelope".to_string()),
            Some("봉투".to_string()),
        ),
        ("travel".to_string(), None, Some("travel-id".to_string())),
    ] {
        assert_eq!(
            decode_destination(&encode_destination(Some(&destination))),
            Some(destination)
        );
    }
    assert!(decode_destination("not-hex").is_none());
    assert!(decode_destination("").is_none());
}

fn silent_finish(state: &crate::AppState) -> WidgetEvent {
    let db = crate::lock(&state.db).unwrap();
    let directory = tempfile::tempdir().unwrap();
    storage::verify_packages(&db, directory.path()).unwrap();
    let timer = storage::instances(&db)
        .unwrap()
        .into_iter()
        .find(|instance| instance.kind == "focus-timer")
        .unwrap();
    let now = chrono::Utc::now().timestamp_millis();
    storage::commit_data(
        &db,
        &timer.id,
        timer.revision,
        timer.data,
        vec![EventDraft {
            kind: "timer-finished".into(),
            text: "집중이 끝났어요.".into(),
            payload: json!({"bubbleEnabled":false,"finishedAt":now,"mode":"focus"}),
        }],
        now,
    )
    .unwrap();
    assert!(storage::take_reaction(&db, now).unwrap().is_none());
    let mut settings = crate::store::settings(&db).unwrap();
    settings.autonomous_enabled = true;
    settings.quiet_hours.enabled = false;
    crate::store::save_settings(&db, &settings).unwrap();
    storage::journal(&db, None, now, now + 1)
        .unwrap()
        .remove(0)
        .1
}

#[test]
fn automatic_os_delivery_validates_revision_even_when_reactions_are_off() {
    let state = crate::app::tests::state();
    let db = crate::lock(&state.db).unwrap();
    let mut device = storage::instances(&db).unwrap().into_iter()
        .find(|instance| instance.kind == "device").unwrap();
    device.data["config"]["criticalNotification"] = json!(true);
    storage::commit_data(&db, &device.id, device.revision, device.data.clone(), vec![],
        chrono::Utc::now().timestamp_millis()).unwrap();
    let device = storage::get(&db, &device.id).unwrap();
    storage::set_reaction(&db, &device.id, false).unwrap();
    crate::lock(&state.runtime).unwrap().hidden = true;
    let now = chrono::Utc::now().timestamp_millis();
    let mut event = WidgetEvent {
        id: "critical".into(), instance_id: device.id.clone(), widget_kind: device.kind,
        revision: device.revision, created_at: now, expires_at: now + 30_000,
        event: EventDraft { kind: "device.critical".into(), text: "배터리가 위험 수준이에요.".into(), payload: json!({}) },
    };
    assert!(automatic_delivery_current(&db, &event).unwrap());
    assert!(!crate::widgets::commands::event_current(&db, &event).unwrap());
    event.revision += 1;
    assert!(!automatic_delivery_current(&db, &event).unwrap());
}

#[test]
fn denied_permission_restores_the_same_event_once_without_changing_widget_revision() {
    let state = crate::app::tests::state();
    let event = silent_finish(&state);
    let db = crate::lock(&state.db).unwrap();
    assert!(restore_fallback(&state, &db, &event, 0).unwrap());
    assert!(!restore_fallback(&state, &db, &event, 0).unwrap());
    let pending = storage::take_reaction(&db, chrono::Utc::now().timestamp_millis())
        .unwrap()
        .unwrap();
    assert_eq!(pending.id, event.id);
    assert_eq!(pending.event.payload["bubbleEnabled"], true);
    assert_eq!(pending.event.payload["osFallback"], true);
    assert_eq!(
        storage::get(&db, &event.instance_id).unwrap().revision,
        event.revision
    );
}

#[test]
fn epoch_change_prevents_delivery_and_fallback() {
    let state = crate::app::tests::state();
    let event = silent_finish(&state);
    let db = crate::lock(&state.db).unwrap();
    let epoch = state.epoch.load(Ordering::SeqCst);
    assert!(delivery_event_current(&db, &event).unwrap());
    assert!(delivery_current(epoch, epoch, true));
    assert!(!delivery_current(epoch, epoch, false));

    state.epoch.store(epoch + 1, Ordering::SeqCst);
    assert!(!delivery_current(
        epoch,
        state.epoch.load(Ordering::SeqCst),
        delivery_event_current(&db, &event).unwrap(),
    ));
    assert!(!restore_fallback(&state, &db, &event, epoch).unwrap());
    assert!(storage::take_reaction(&db, chrono::Utc::now().timestamp_millis())
        .unwrap()
        .is_none());
}

#[tokio::test]
async fn failed_registration_restores_only_current_fallbacks() {
    for branch in ["current", "epoch", "revision"] {
        let state = crate::app::tests::state();
        let event = silent_finish(&state);
        let delivery = crate::widgets::reminders::Delivery {
            instance_id: event.instance_id.clone(),
            text: event.event.text.clone(),
            sound_enabled: false,
            widget: true,
            notification_key: "test".into(),
            fallback: Some(event.clone()),
            additional_fallbacks: vec![],
            fallback_timers: vec![],
            grouped: false,
            destination: None,
        };
        restore_failed_delivery(&state, &delivery, 0, &Ok(()));
        {
            let db = crate::lock(&state.db).unwrap();
            assert!(storage::take_reaction(&db, chrono::Utc::now().timestamp_millis())
                .unwrap()
                .is_none());
        }
        if branch == "epoch" {
            state.epoch.store(1, Ordering::SeqCst);
        } else if branch == "revision" {
            let db = crate::lock(&state.db).unwrap();
            let mut timer = storage::get(&db, &event.instance_id).unwrap();
            assert_eq!(timer.revision, event.revision);
            timer.data["settings"]["finishNotification"] = json!("bubble");
            storage::commit_data(
                &db,
                &timer.id,
                timer.revision,
                timer.data,
                vec![],
                chrono::Utc::now().timestamp_millis(),
            )
            .unwrap();
            assert_eq!(
                storage::get(&db, &event.instance_id).unwrap().revision,
                event.revision + 1
            );
        }
        let (send, receive) = tokio::sync::oneshot::channel();
        send.send(Err("등록 실패".to_string())).unwrap();
        let result = wait_for_delivery(Ok(receive)).await;
        assert_eq!(result.as_ref().unwrap_err(), "등록 실패");
        restore_failed_delivery(&state, &delivery, 0, &result);
        let db = crate::lock(&state.db).unwrap();
        let pending = storage::take_reaction(&db, chrono::Utc::now().timestamp_millis()).unwrap();
        if branch == "current" {
            let pending = pending.unwrap();
            assert_eq!(pending.id, event.id);
            assert_eq!(pending.event.payload["osFallback"], true);
        } else {
            assert!(pending.is_none(), "{branch}");
        }
    }
}

#[test]
fn delivery_error_tracks_latest_result_and_permission_recovery() {
    let state = crate::app::tests::state();
    let db = crate::lock(&state.db).unwrap();
    let sequence = AtomicU64::new(1);
    let alert_state = || {
        storage::instances(&db)
            .unwrap()
            .into_iter()
            .find(|instance| instance.kind == "calendar")
            .unwrap()
            .data["alertState"]
            .clone()
    };
    assert!(save_delivery_result_in_db(&db, &sequence, 1, Some("전달 실패")).unwrap());
    assert_eq!(alert_state()["lastDeliveryError"], "전달 실패");
    sequence.store(2, Ordering::SeqCst);
    assert!(!save_delivery_result_in_db(&db, &sequence, 1, None).unwrap());
    assert_eq!(alert_state()["lastDeliveryError"], "전달 실패");
    assert!(save_delivery_result_in_db(&db, &sequence, 2, None).unwrap());
    assert!(alert_state()["lastDeliveryError"].is_null());

    save_permission_in_db(&db, "denied", &sequence).unwrap();
    save_delivery_result_in_db(&db, &sequence, 2, Some("권한 없음")).unwrap();
    assert!(save_permission_in_db(&db, "granted", &sequence).unwrap());
    assert!(alert_state()["lastDeliveryError"].is_null());
    assert!(!save_delivery_result_in_db(&db, &sequence, 2, Some("오래된 실패")).unwrap());
    assert!(alert_state()["lastDeliveryError"].is_null());
}

#[test]
fn permission_fallback_cannot_revive_events_after_input_settings_changes_or_hiding() {
    for branch in [
        "epoch",
        "revision",
        "reaction-off",
        "hidden",
        "launcher",
        "automatic",
        "expired-ordinary",
        "focus",
    ] {
        let state = crate::app::tests::state();
        let mut event = silent_finish(&state);
        let db = crate::lock(&state.db).unwrap();
        match branch {
            "epoch" => {
                state.epoch.store(1, Ordering::SeqCst);
            }
            "revision" => {
                let mut timer = storage::get(&db, &event.instance_id).unwrap();
                timer.data["settings"]["finishNotification"] = json!("bubble");
                storage::commit_data(
                    &db,
                    &timer.id,
                    timer.revision,
                    timer.data,
                    vec![],
                    chrono::Utc::now().timestamp_millis(),
                )
                .unwrap();
            }
            "reaction-off" => {
                storage::set_reaction(&db, &event.instance_id, false).unwrap();
            }
            "hidden" => {
                crate::lock(&state.runtime).unwrap().hidden = true;
            }
            "launcher" => {
                state.launcher_open.store(true, Ordering::SeqCst);
            }
            "automatic" => {
                let mut settings = crate::store::settings(&db).unwrap();
                settings.autonomous_enabled = false;
                crate::store::save_settings(&db, &settings).unwrap();
            }
            "expired-ordinary" => {
                event.event.kind = "calendar-reminder".into();
                db.execute(
                    "UPDATE widget_events SET data=?1 WHERE id=?2",
                    rusqlite::params![serde_json::to_string(&event).unwrap(), event.id],
                )
                .unwrap();
                assert!(restore_fallback(&state, &db, &event, 0).unwrap());
                assert_eq!(
                    storage::take_reaction(&db, chrono::Utc::now().timestamp_millis())
                        .unwrap()
                        .unwrap()
                        .id,
                    event.id
                );
                event.expires_at = chrono::Utc::now().timestamp_millis() - 1;
                db.execute(
                    "UPDATE widget_events SET data=?1,pending=0 WHERE id=?2",
                    rusqlite::params![serde_json::to_string(&event).unwrap(), event.id],
                )
                .unwrap();
            }
            "focus" => {
                db.execute("UPDATE widget_instances SET data=json_set(data,'$.status','running','$.mode','focus','$.deadline',?2) WHERE id=?1", rusqlite::params![event.instance_id,chrono::Utc::now().timestamp_millis()+60_000]).unwrap();
            }
            _ => unreachable!(),
        }
        assert!(
            !restore_fallback(&state, &db, &event, 0).unwrap(),
            "{branch}"
        );
        assert!(
            storage::take_reaction(&db, chrono::Utc::now().timestamp_millis())
                .unwrap()
                .is_none(),
            "{branch}"
        );
    }
}

#[test]
fn permission_fallback_preserves_expired_temporal_events() {
    let state = crate::app::tests::state();
    let mut event = silent_finish(&state);
    event.expires_at = 0;
    let db = crate::lock(&state.db).unwrap();
    db.execute(
        "UPDATE widget_events SET data=?1 WHERE id=?2",
        rusqlite::params![serde_json::to_string(&event).unwrap(), event.id],
    )
    .unwrap();
    assert!(restore_fallback(&state, &db, &event, 0).unwrap());
    let pending = storage::take_reaction(&db, chrono::Utc::now().timestamp_millis())
        .unwrap()
        .unwrap();
    assert_eq!(pending.id, event.id);
    assert_eq!(pending.event.payload["osFallback"], true);
}
