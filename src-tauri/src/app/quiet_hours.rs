//! Recurring automatic-chatter silence, independent from pauses and planner notifications.
use super::{interrupt, lock, schedule_idle, AppState};
use crate::{
    store,
    types::{QuietHours, RuntimePhase, Settings},
    widgets,
};
use chrono::{Datelike, NaiveDateTime, Timelike};
use std::sync::atomic::Ordering;

#[derive(Default)]
pub(crate) struct Runtime {
    last_checked: Option<NaiveDateTime>,
    active: bool,
}

fn minute(value: &str) -> Option<u32> {
    let bytes = value.as_bytes();
    if bytes.len() != 5
        || bytes[2] != b':'
        || ![bytes[0], bytes[1], bytes[3], bytes[4]]
            .iter()
            .all(u8::is_ascii_digit)
    {
        return None;
    }
    let hour = value[..2].parse::<u32>().ok()?;
    let minute = value[3..].parse::<u32>().ok()?;
    (hour < 24 && minute < 60).then_some(hour * 60 + minute)
}

pub(crate) fn validate(settings: &QuietHours) -> Result<(), String> {
    if !settings.enabled {
        return Ok(());
    }
    if minute(&settings.start).is_none()
        || minute(&settings.end).is_none()
        || settings.start == settings.end
        || settings.weekdays.is_empty()
        || settings.weekdays.iter().any(|day| *day > 6)
    {
        return Err(
            "조용한 시간의 시작·종료 시각을 다르게 정하고 요일을 하나 이상 골라 주세요.".into(),
        );
    }
    Ok(())
}

pub(crate) fn active_at(settings: &QuietHours, at: NaiveDateTime) -> bool {
    if !settings.enabled {
        return false;
    }
    let (Some(start), Some(end)) = (minute(&settings.start), minute(&settings.end)) else {
        return false;
    };
    let current = at.hour() * 60 + at.minute();
    let weekday = at.weekday().num_days_from_monday();
    if start < end {
        settings.weekdays.contains(&weekday) && start <= current && current < end
    } else if start > end {
        (current >= start && settings.weekdays.contains(&weekday))
            || (current < end && settings.weekdays.contains(&((weekday + 6) % 7)))
    } else {
        false
    }
}

pub(crate) fn active(settings: &Settings) -> bool {
    active_at(&settings.quiet_hours, chrono::Local::now().naive_local())
}

// A sleeping computer can miss both boundaries. Detect that interval too, without catch-up.
fn crossed(settings: &QuietHours, from: NaiveDateTime, to: NaiveDateTime) -> bool {
    if !settings.enabled || validate(settings).is_err() || to <= from {
        return false;
    }
    if to.signed_duration_since(from) >= chrono::Duration::days(8) {
        return true;
    }
    let start = minute(&settings.start).unwrap();
    let end = minute(&settings.end).unwrap();
    let mut date = from.date().pred_opt().unwrap_or(from.date());
    while date <= to.date() {
        if settings
            .weekdays
            .contains(&date.weekday().num_days_from_monday())
        {
            let begins = date.and_hms_opt(start / 60, start % 60, 0).unwrap();
            let end_date = if start > end {
                date.succ_opt().unwrap_or(date)
            } else {
                date
            };
            let ends = end_date.and_hms_opt(end / 60, end % 60, 0).unwrap();
            if from < ends && to >= begins {
                return true;
            }
        }
        let Some(next) = date.succ_opt() else {
            break;
        };
        date = next;
    }
    false
}

/// Also fence a missed interval before the background loop observes a wake-up.
/// Async generation completions and delayed native reveals can run before that loop.
pub(crate) fn automatic_blocked(state: &AppState, settings: &Settings) -> Result<bool, String> {
    let at = chrono::Local::now().naive_local();
    Ok(active_at(&settings.quiet_hours, at)
        || lock(&state.quiet_hours)?
            .last_checked
            .is_some_and(|last| crossed(&settings.quiet_hours, last, at)))
}

pub(crate) fn event_allowed(kind: &str) -> bool {
    matches!(
        kind,
        "timer-finished" | "calendar-reminder" | "planner-reminder" | "planner-mood"
    )
}

/// Caller holds action and db. Automatic widget reactions use their event even when their
/// character reaction speech has a foreground token. Genuine direct replies are untouched.
pub(crate) fn playback_blocked(state: &AppState, settings: &Settings) -> Result<bool, String> {
    if !automatic_blocked(state, settings)? {
        return Ok(false);
    }
    if let Some(event) = lock(&state.widget_playback)?.as_ref() {
        return Ok(!event_allowed(&event.event.kind));
    }
    Ok(state.automatic.load(Ordering::SeqCst))
}

pub(crate) fn reconcile(state: &AppState) -> Result<bool, String> {
    reconcile_at(state, chrono::Local::now().naive_local())
}

pub(crate) fn reconcile_at(state: &AppState, at: NaiveDateTime) -> Result<bool, String> {
    let _action = lock(&state.action)?;
    let db = lock(&state.db)?;
    let settings = store::settings(&db)?;
    let active = active_at(&settings.quiet_hours, at);
    let mut clock = lock(&state.quiet_hours)?;
    let missed = clock
        .last_checked
        .is_some_and(|last| crossed(&settings.quiet_hours, last, at));
    let boundary = active != clock.active || (!clock.active && missed);
    clock.last_checked = Some(at);
    clock.active = active;
    drop(clock);
    if !active && !boundary {
        return Ok(false);
    }
    // Refresh throughout silence and once on exit: a fresh randomized 80–120% interval,
    // never immediately replay the interval that elapsed while the app was quiet/asleep.
    schedule_idle(state, settings.idle_minutes);
    if boundary {
        db.execute("DELETE FROM scenes", [])
            .map_err(|error| error.to_string())?;
        lock(&state.story_clock)?.elapsed = std::time::Duration::ZERO;
    }
    widgets::storage::discard_pending_during_focus(&db)?;
    crate::generated_widgets::discard_pending(&db)?;
    crate::generated_widget_commands::skip_automatic_message(&db)?;
    let cancel_automatic = lock(&state.widget_playback)?.as_ref().map_or_else(
        || state.automatic.load(Ordering::SeqCst),
        |event| !event_allowed(&event.event.kind),
    );
    if cancel_automatic {
        let (epoch, _) = interrupt(state, false)?;
        // Preserve time-critical events already queued at this boundary.
        state.widget_epoch.store(epoch, Ordering::SeqCst);
        let mut runtime = lock(&state.runtime)?;
        runtime.phase = RuntimePhase::Idle;
        runtime.persona = None;
        runtime.error = None;
        state.nlp.pause_indexing(false);
    }
    Ok(boundary || cancel_automatic)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::{
        background::begin_background,
        settings::{apply_settings, SettingsScope},
    };
    use crate::types::{PreparedScene, SceneLine};

    fn at(value: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S").unwrap()
    }
    fn schedule() -> QuietHours {
        QuietHours {
            enabled: true,
            weekdays: vec![0],
            ..QuietHours::default()
        }
    }
    fn save(state: &AppState, quiet_hours: QuietHours) {
        store::save_settings(
            &lock(&state.db).unwrap(),
            &Settings {
                quiet_hours,
                ..Settings::default()
            },
        )
        .unwrap();
    }
    fn active_now() -> QuietHours {
        let current = chrono::Local::now();
        QuietHours {
            enabled: true,
            start: (current - chrono::Duration::hours(1))
                .format("%H:%M")
                .to_string(),
            end: (current + chrono::Duration::hours(1))
                .format("%H:%M")
                .to_string(),
            ..QuietHours::default()
        }
    }
    fn line() -> SceneLine {
        SceneLine {
            persona: "a".into(),
            expression: "평온".into(),
            text: "조용히 기다려요.".into(),
            motion: Default::default(),
        }
    }
    fn event(kind: &str) -> widgets::WidgetEvent {
        widgets::WidgetEvent {
            id: "event".into(),
            instance_id: "timer".into(),
            widget_kind: "focus-timer".into(),
            revision: 1,
            created_at: 0,
            expires_at: i64::MAX,
            event: widgets::EventDraft {
                kind: kind.into(),
                text: "알림".into(),
                payload: serde_json::json!({}),
            },
        }
    }

    #[test]
    fn legacy_settings_and_partial_schedules_remain_opt_in() {
        let mut old = serde_json::to_value(Settings::default()).unwrap();
        old.as_object_mut().unwrap().remove("quietHours");
        let restored: Settings = serde_json::from_value(old).unwrap();
        assert_eq!(restored.quiet_hours, QuietHours::default());
        assert!(!active_at(&restored.quiet_hours, at("2026-09-28 23:00:00")));
        let partial: QuietHours =
            serde_json::from_value(serde_json::json!({"start":"23:00"})).unwrap();
        assert!(!partial.enabled);
        assert_eq!(partial.end, "08:00");
        assert_eq!(
            serde_json::from_str::<Settings>(&serde_json::to_string(&restored).unwrap())
                .unwrap()
                .quiet_hours,
            QuietHours::default()
        );
    }

    #[test]
    fn overnight_uses_starting_weekday_and_exact_half_open_boundaries() {
        let quiet = schedule();
        for (time, expected) in [
            ("2026-09-28 21:59:59", false),
            ("2026-09-28 22:00:00", true),
            ("2026-09-29 00:00:00", true),
            ("2026-09-29 07:59:59", true),
            ("2026-09-29 08:00:00", false),
            ("2026-09-29 22:00:00", false),
            ("2026-09-28 07:59:59", false),
        ] {
            assert_eq!(active_at(&quiet, at(time)), expected, "{time}");
        }
        let sunday = QuietHours {
            weekdays: vec![6],
            ..quiet
        };
        assert!(active_at(&sunday, at("2026-09-28 07:59:59")));
    }

    #[test]
    fn daytime_and_invalid_or_disabled_ranges() {
        let quiet = QuietHours {
            start: "09:30".into(),
            end: "17:00".into(),
            ..schedule()
        };
        assert!(!active_at(&quiet, at("2026-09-28 09:29:59")));
        assert!(active_at(&quiet, at("2026-09-28 09:30:00")));
        assert!(!active_at(&quiet, at("2026-09-28 17:00:00")));
        for (start, end, days) in [
            ("25:00", "08:00", vec![0]),
            ("9:30", "17:00", vec![0]),
            ("22:60", "08:00", vec![0]),
            ("22:00", "22:00", vec![0]),
            ("22:00", "08:00", vec![]),
            ("22:00", "08:00", vec![7]),
        ] {
            assert!(validate(&QuietHours {
                start: start.into(),
                end: end.into(),
                weekdays: days,
                ..schedule()
            })
            .is_err());
        }
        assert!(validate(&QuietHours::default()).is_ok());
    }

    #[test]
    fn missed_windows_are_detected_without_replaying_or_looping_over_long_absence() {
        let quiet = schedule();
        assert!(crossed(
            &quiet,
            at("2026-09-28 21:00:00"),
            at("2026-09-29 09:00:00")
        ));
        assert!(!crossed(
            &quiet,
            at("2026-09-29 08:00:00"),
            at("2026-09-29 09:00:00")
        ));
        assert!(crossed(
            &quiet,
            at("2026-09-28 21:00:00"),
            at("2027-09-28 21:00:00")
        ));
        assert!(!crossed(
            &quiet,
            at("2026-09-28 23:00:00"),
            at("2026-09-28 21:00:00")
        ));
    }

    #[test]
    fn automatic_scope_saves_schedule_and_model_scope_preserves_it() {
        let state = crate::app::tests::state();
        let mut changed = Settings {
            quiet_hours: schedule(),
            ..Settings::default()
        };
        apply_settings(&state, &changed, Some(SettingsScope::Automatic), None).unwrap();
        assert_eq!(
            store::settings(&lock(&state.db).unwrap())
                .unwrap()
                .quiet_hours,
            schedule()
        );
        changed.quiet_hours = QuietHours {
            enabled: true,
            start: "bad".into(),
            ..QuietHours::default()
        };
        changed.local_reasoning_enabled = true;
        apply_settings(&state, &changed, Some(SettingsScope::Model), None).unwrap();
        let saved = store::settings(&lock(&state.db).unwrap()).unwrap();
        assert!(saved.local_reasoning_enabled);
        assert_eq!(saved.quiet_hours, schedule());
        assert!(apply_settings(&state, &changed, Some(SettingsScope::Automatic), None).is_err());
        assert_eq!(
            store::settings(&lock(&state.db).unwrap())
                .unwrap()
                .quiet_hours,
            schedule()
        );
    }

    #[test]
    fn quiet_entry_cancels_automatic_work_and_clears_prepared_scenes_without_revision_change() {
        let state = crate::app::tests::state();
        save(&state, schedule());
        let (epoch, cancel) = interrupt(&state, true).unwrap();
        let revision = store::revision(&lock(&state.db).unwrap()).unwrap();
        store::add_scene(
            &lock(&state.db).unwrap(),
            &PreparedScene {
                id: "stale".into(),
                revision,
                lines: vec![line()],
            },
        )
        .unwrap();
        assert!(reconcile_at(&state, at("2026-09-28 22:00:00")).unwrap());
        assert!(cancel.load(Ordering::SeqCst));
        assert!(state.epoch.load(Ordering::SeqCst) > epoch);
        assert_eq!(
            state.widget_epoch.load(Ordering::SeqCst),
            state.epoch.load(Ordering::SeqCst)
        );
        assert!(store::prepared_scenes(&lock(&state.db).unwrap())
            .unwrap()
            .is_empty());
        assert_eq!(
            store::revision(&lock(&state.db).unwrap()).unwrap(),
            revision
        );
        assert!(!reconcile_at(&state, at("2026-09-28 22:00:01")).unwrap());
    }

    #[test]
    fn direct_work_critical_events_and_manual_pause_survive_schedule_entry_and_exit() {
        for kind in [
            None,
            Some("timer-finished"),
            Some("calendar-reminder"),
            Some("planner-reminder"),
            Some("planner-mood"),
        ] {
            let state = crate::app::tests::state();
            save(&state, schedule());
            let (epoch, cancel) = interrupt(&state, kind.is_some()).unwrap();
            *lock(&state.widget_playback).unwrap() = kind.map(event);
            lock(&state.runtime).unwrap().paused = true;
            lock(&state.runtime).unwrap().paused_until = Some(i64::MAX);
            reconcile_at(&state, at("2026-09-28 22:00:00")).unwrap();
            reconcile_at(&state, at("2026-09-29 08:00:00")).unwrap();
            assert!(!cancel.load(Ordering::SeqCst));
            assert_eq!(state.epoch.load(Ordering::SeqCst), epoch);
            assert!(lock(&state.runtime).unwrap().paused);
            assert_eq!(lock(&state.runtime).unwrap().paused_until, Some(i64::MAX));
        }
    }

    #[test]
    fn quiet_hours_clear_ordinary_pending_events_but_keep_critical_queue() {
        let state = crate::app::tests::state();
        save(&state, schedule());
        let directory = tempfile::tempdir().unwrap();
        {
            let db = lock(&state.db).unwrap();
            widgets::storage::install(&db, directory.path(), &["focus-timer".into()]).unwrap();
            let timer = widgets::storage::instances(&db).unwrap().remove(0);
            widgets::storage::commit_data(
                &db,
                &timer.id,
                timer.revision,
                timer.data,
                [
                    "timer-finished",
                    "calendar-reminder",
                    "planner-reminder",
                    "planner-mood",
                    "ball.stopped",
                ]
                .into_iter()
                .map(|kind| event(kind).event)
                .collect(),
                chrono::Utc::now().timestamp_millis(),
            )
            .unwrap();
        }
        reconcile_at(&state, at("2026-09-28 22:00:00")).unwrap();
        let db = lock(&state.db).unwrap();
        let mut query = db
            .prepare("SELECT json_extract(data,'$.kind') FROM widget_events WHERE pending=1")
            .unwrap();
        let pending = query
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(pending.len(), 4);
        assert!(pending.iter().all(|kind| event_allowed(kind)));
    }

    #[test]
    fn character_widget_reactions_with_foreground_tokens_are_still_cancelled() {
        let state = crate::app::tests::state();
        save(&state, schedule());
        let (_, cancel) = interrupt(&state, false).unwrap();
        *lock(&state.widget_playback).unwrap() = Some(event("desktop.ball.stopped"));
        reconcile_at(&state, at("2026-09-28 22:00:00")).unwrap();
        assert!(cancel.load(Ordering::SeqCst));
    }

    #[test]
    fn exit_and_sleep_skip_use_fresh_interval_and_discard_stale_work() {
        for (first, next) in [
            ("2026-09-28 23:00:00", "2026-09-29 08:00:00"),
            ("2026-09-28 21:00:00", "2026-09-29 09:00:00"),
        ] {
            let state = crate::app::tests::state();
            save(&state, schedule());
            reconcile_at(&state, at(first)).unwrap();
            state.next_idle.store(0, Ordering::SeqCst);
            let (_, cancel) = interrupt(&state, true).unwrap();
            let before = super::super::now();
            assert!(reconcile_at(&state, at(next)).unwrap());
            assert!(cancel.load(Ordering::SeqCst));
            let delay = state.next_idle.load(Ordering::SeqCst) - before;
            assert!(
                (96..=145).contains(&delay),
                "fresh 2-minute interval: {delay}"
            );
            let next_idle = state.next_idle.load(Ordering::SeqCst);
            assert!(!reconcile_at(&state, at("2026-09-29 09:00:01")).unwrap());
            assert_eq!(state.next_idle.load(Ordering::SeqCst), next_idle);
        }
    }

    #[test]
    fn delayed_reveal_and_generation_are_fenced_before_first_post_sleep_tick() {
        let state = crate::app::tests::state();
        let local = chrono::Local::now().naive_local();
        let quiet_hours = QuietHours {
            enabled: true,
            start: (local - chrono::Duration::hours(3))
                .format("%H:%M")
                .to_string(),
            end: (local - chrono::Duration::hours(2))
                .format("%H:%M")
                .to_string(),
            ..QuietHours::default()
        };
        save(&state, quiet_hours);
        lock(&state.quiet_hours).unwrap().last_checked = Some(local - chrono::Duration::hours(4));
        let settings = store::settings(&lock(&state.db).unwrap()).unwrap();
        assert!(!active(&settings));
        assert!(automatic_blocked(&state, &settings).unwrap());
        interrupt(&state, true).unwrap();
        assert!(playback_blocked(&state, &settings).unwrap());
        assert!(begin_background(&state).unwrap().is_none());
        reconcile_at(&state, local).unwrap();
        assert!(!automatic_blocked(&state, &settings).unwrap());
    }

    #[test]
    fn background_and_playback_recheck_current_clock_while_direct_replies_remain_allowed() {
        let state = crate::app::tests::state();
        save(&state, active_now());
        assert!(begin_background(&state).unwrap().is_none());
        let settings = store::settings(&lock(&state.db).unwrap()).unwrap();
        let (epoch, cancel) = interrupt(&state, true).unwrap();
        assert!(playback_blocked(&state, &settings).unwrap());
        let revision = store::revision(&lock(&state.db).unwrap()).unwrap();
        assert!(!crate::app::scene::present_line(
            &state,
            &line(),
            "builtin",
            "stale",
            0,
            1,
            revision,
            epoch,
            &cancel,
            false
        )
        .unwrap());
        let (epoch, cancel) = interrupt(&state, false).unwrap();
        assert!(!playback_blocked(&state, &settings).unwrap());
        assert!(crate::app::scene::present_line(
            &state,
            &line(),
            "llm-reply",
            "direct",
            0,
            1,
            revision,
            epoch,
            &cancel,
            true
        )
        .unwrap());
        for kind in [
            "timer-finished",
            "calendar-reminder",
            "planner-reminder",
            "planner-mood",
        ] {
            state.automatic.store(true, Ordering::SeqCst);
            *lock(&state.widget_playback).unwrap() = Some(event(kind));
            assert!(!playback_blocked(&state, &settings).unwrap());
        }
    }
}
