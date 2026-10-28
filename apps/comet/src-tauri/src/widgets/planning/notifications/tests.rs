use super::*;
use crate::widgets::{storage, EventDraft, WidgetEvent};
use serde_json::json;

#[test]
fn external_notifications_do_not_route_to_planner_actions() {
    assert!(is_external_notification("planner:external-123:0"));
    assert!(!is_external_notification("planner:calendar-id:123"));
    assert!(!is_external_notification("widget:timer-id:123:key"));
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
fn permission_fallback_cannot_revive_events_after_input_settings_changes_or_hiding() {
    for branch in [
        "epoch",
        "revision",
        "reaction-off",
        "hidden",
        "launcher",
        "automatic",
        "expired",
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
            "expired" => {
                event.expires_at = chrono::Utc::now().timestamp_millis() - 1;
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
