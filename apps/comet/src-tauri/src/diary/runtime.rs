use super::{err, habits::Habit, ledger, read, DiaryState, Result};
use crate::{
    app::{self, lock, tasks, AppState},
    characters, store,
    types::{RuntimePhase, SceneLine},
};
use chrono::{Datelike, Duration, Local, NaiveDate, NaiveDateTime};
use rusqlite::{params, Connection, OptionalExtension};
use std::sync::{atomic::Ordering, Arc};
use tauri::Emitter;

pub(crate) fn initialize(db: &Connection) -> Result<()> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS diary_deliveries(
            key TEXT PRIMARY KEY, day TEXT NOT NULL, message_id TEXT,
            revision INTEGER NOT NULL, expires_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS diary_runtime(key TEXT PRIMARY KEY, value TEXT NOT NULL);",
    )
    .map_err(err)
}

#[derive(Debug)]
struct Reminder {
    key: String,
    text: String,
}

fn scheduled(habit: &Habit, day: NaiveDate) -> bool {
    !habit.archived
        && habit.start_date.as_str() <= day.format("%Y-%m-%d").to_string().as_str()
        && habit
            .weekdays
            .contains(&day.weekday().num_days_from_sunday())
}

fn completed(state: &DiaryState, habit: &Habit, day: &str) -> bool {
    state.habit_checks.iter().any(|check| {
        check.habit_id == habit.id
            && check.date == day
            && check.status == "done"
            && (habit.mode == "check" || check.count >= habit.target)
    })
}

fn due(state: &DiaryState, at: NaiveDateTime) -> Result<Vec<Reminder>> {
    let day = at.date().format("%Y-%m-%d").to_string();
    let clock = at.format("%H:%M").to_string();
    let habits: Vec<_> = state
        .habits
        .iter()
        .filter(|habit| scheduled(habit, at.date()))
        .collect();
    let mut reminders = Vec::new();
    if state.habit_feedback_enabled
        && !habits.is_empty()
        && habits.iter().all(|habit| completed(state, habit, &day))
    {
        reminders.push(Reminder {
            key: format!("habit-praise:{day}"),
            text: "오늘의 습관을 모두 채웠네요. 차곡차곡 잘 해내고 있어요!".into(),
        });
    }
    for habit in habits {
        if habit.reminder_time.as_deref() == Some(clock.as_str()) && !completed(state, habit, &day)
        {
            reminders.push(Reminder {
                key: format!("habit-reminder:{}:{day}", habit.id),
                text: format!(
                    "‘{}’ 할 시간이에요. 오늘의 습관을 가볍게 시작해 볼까요?",
                    habit.title
                ),
            });
        }
    }
    if state.ledger_settings.reminder_enabled {
        let target = at
            .date()
            .checked_add_signed(Duration::days(i64::from(
                state.ledger_settings.reminder_offset_days,
            )))
            .ok_or("알림 날짜 범위를 벗어났어요.")?
            .format("%Y-%m-%d")
            .to_string();
        for expense in ledger::occurrences(state, &target, &target)? {
            reminders.push(Reminder {
                key: format!(
                    "ledger-reminder:{}:{}",
                    expense.recurring_id, expense.occurrence_date
                ),
                text: format!(
                    "{}에 ‘{}’ 고정 지출 {}원이 예정되어 있어요.",
                    expense.date, expense.title, expense.amount
                ),
            });
        }
    }
    Ok(reminders)
}

// Caller holds action and db. The same gates are used again at actual balloon presentation.
fn speaker(state: &AppState, db: &Connection, require_idle: bool) -> Result<Option<String>> {
    let status = lock(&state.runtime)?.clone();
    let settings = store::settings(db)?;
    if app::unavailable(state)
        || !settings.autonomous_enabled
        || status.hidden
        || status.paused
        || (require_idle && !matches!(status.phase, RuntimePhase::Idle | RuntimePhase::Error))
        || state.launcher_open.load(Ordering::SeqCst)
        || lock(&state.panel)?.is_some()
        || lock(&state.pack_stories)?.run.is_some()
        || app::now() - state.last_input.load(Ordering::SeqCst) < 15
        || crate::behavior::reactions_blocked(state)?
        || crate::widgets::storage::focus_active(db, chrono::Utc::now().timestamp_millis())?
        || app::quiet_hours::automatic_blocked(state, &settings)?
    {
        return Ok(None);
    }
    for id in app::presence::present_ids(state, &characters::active_ids(db)?)? {
        if !crate::characters::life::sleeping(state, &id)? {
            return Ok(Some(id));
        }
    }
    Ok(None)
}

pub(crate) fn playback_current(state: &AppState, db: &Connection, id: &str) -> Result<bool> {
    let proof: Option<(u64, i64)> = db
        .query_row(
            "SELECT revision,expires_at FROM diary_deliveries WHERE message_id=?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(err)?;
    let Some((revision, expires)) = proof else {
        return Ok(false);
    };
    Ok(expires >= chrono::Utc::now().timestamp_millis()
        && read(db)?.revision == revision
        && speaker(state, db, false)?.is_some())
}

fn generate(db: &Connection, state: &DiaryState, today: NaiveDate) -> Result<DiaryState> {
    if !state
        .ledger_recurring
        .iter()
        .any(|rule| rule.enabled && rule.auto_record)
    {
        return Ok(state.clone());
    }
    let previous: Option<String> = db
        .query_row(
            "SELECT value FROM diary_runtime WHERE key='ledger-through'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(err)?;
    let start = previous
        .as_deref()
        .and_then(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").ok())
        .unwrap_or_else(|| today.with_day(1).unwrap())
        .checked_sub_signed(Duration::days(2))
        .unwrap_or(today);
    let through = start
        .checked_add_signed(Duration::days(365))
        .unwrap_or(today)
        .min(today);
    let from = start.min(through).format("%Y-%m-%d").to_string();
    let through_text = through.format("%Y-%m-%d").to_string();
    let tx = db.unchecked_transaction().map_err(err)?;
    let saved = super::update_in_transaction(
        &tx,
        state.revision,
        "ledger-generate",
        &serde_json::json!({"fromDate":from,"throughDate":through_text,"includeManual":false}),
    )?;
    if previous.as_deref() != Some(through_text.as_str()) {
        tx.execute("INSERT INTO diary_runtime(key,value) VALUES('ledger-through',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [&through_text]).map_err(err)?;
    }
    tx.commit().map_err(err)?;
    Ok(saved)
}

fn claim(
    db: &Connection,
    reminders: &[Reminder],
    day: &str,
    revision: u64,
    expires: i64,
    message_id: Option<&str>,
) -> Result<Vec<String>> {
    if reminders.is_empty() {
        return Ok(Vec::new());
    }
    let tx = db.unchecked_transaction().map_err(err)?;
    let mut texts = Vec::new();
    for reminder in reminders {
        if tx.execute("INSERT OR IGNORE INTO diary_deliveries(key,day,message_id,revision,expires_at) VALUES(?1,?2,?3,?4,?5)", params![reminder.key, day, message_id, revision, expires]).map_err(err)? == 1 {
            texts.push(reminder.text.clone());
        }
    }
    if !texts.is_empty() {
        tx.execute(
            "DELETE FROM diary_deliveries WHERE day < date(?1,'-400 days')",
            [day],
        )
        .map_err(err)?;
    }
    tx.commit().map_err(err)?;
    Ok(texts)
}

pub(crate) fn tick(app: &tauri::AppHandle, state: &Arc<AppState>) -> Result<()> {
    let now = chrono::Utc::now().timestamp_millis();
    let prepared = {
        let _action = lock(&state.action)?;
        if app::unavailable(state) {
            return Ok(());
        }
        {
            let mut clocks = lock(&state.widget_clocks)?;
            if clocks
                .get("diary-runtime")
                .is_some_and(|last| now >= *last && now - last < 15_000)
            {
                return Ok(());
            }
            clocks.insert("diary-runtime".into(), now);
        }
        let db = lock(&state.db)?;
        let at = Local::now().naive_local();
        let current = read(&db)?;
        let saved = generate(&db, &current, at.date())?;
        if saved.revision != current.revision {
            let _ = app.emit("diary-updated", &saved);
        }
        let mut reminders = due(&saved, at)?;
        let persona = speaker(state, &db, true)?;
        let (urgent, travel): (Vec<_>, Vec<_>) =
            super::travel_alerts::due(&saved, chrono::Utc::now())
                .into_iter()
                .partition(|alert| alert.os);
        // Trip reminders wait for a speaker, so quiet hours delay them instead of consuming them.
        if persona.is_some() {
            reminders.extend(travel.into_iter().map(|alert| Reminder {
                key: alert.key,
                text: alert.text,
            }));
        }
        let urgent: Vec<Reminder> = urgent
            .into_iter()
            .map(|alert| Reminder {
                key: alert.key,
                text: alert.text,
            })
            .collect();
        for text in claim(
            &db,
            &urgent,
            &at.date().format("%Y-%m-%d").to_string(),
            saved.revision,
            now + 60_000,
            None,
        )? {
            if let Err(error) = crate::widgets::planning::notifications::show_plain(app, &text) {
                let _ = app.emit("planner-notification-error", error);
            }
        }
        let prefix = format!("diary:{}", uuid::Uuid::new_v4());
        let message_id = format!("scene:{prefix}:0");
        // Suppressed due events are consumed too: leaving focus, pause or hidden mode never replays them.
        let texts = claim(
            &db,
            &reminders,
            &at.date().format("%Y-%m-%d").to_string(),
            saved.revision,
            now + 60_000,
            persona.as_ref().map(|_| message_id.as_str()),
        )?;
        match persona.filter(|_| !texts.is_empty()) {
            Some(persona) => {
                let text = if texts.len() > 3 {
                    format!(
                        "{}\n그 외 {}개의 알림도 다이어리에서 확인해 주세요.",
                        texts[..3].join("\n"),
                        texts.len() - 3
                    )
                } else {
                    texts.join("\n")
                };
                let line = SceneLine {
                    persona,
                    expression: "평온".into(),
                    text,
                    motion: Default::default(),
                };
                drop(db);
                Some((
                    line,
                    prefix,
                    tasks::reserve(state, tasks::Kind::Scene, true)?,
                ))
            }
            None => None,
        }
    };
    let Some((line, prefix, (epoch, cancel))) = prepared else {
        return Ok(());
    };
    let worker_app = app.clone();
    let worker_state = state.clone();
    tasks::spawn(
        app.clone(),
        state.clone(),
        tasks::Kind::Scene,
        epoch,
        async move {
            let Some(_gate) = tasks::acquire_gate(&worker_state, epoch, cancel.clone()).await
            else {
                return;
            };
            let result = app::scene::run_scene(
                &worker_app,
                &worker_state,
                &[line],
                "diary",
                &prefix,
                false,
                epoch,
                cancel.clone(),
            )
            .await;
            if app::is_current(&worker_state, epoch, &cancel) {
                app::phase(
                    &worker_app,
                    &worker_state,
                    epoch,
                    RuntimePhase::Idle,
                    None,
                    result.err(),
                );
            }
        },
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::update;
    use super::*;
    use serde_json::json;

    fn add_habit(db: &Connection, reminder: Option<&str>) -> DiaryState {
        let state = read(db).unwrap();
        update(db, state.revision, "habit-create", &json!({"title":"물 마시기","description":"","color":"record","weekdays":[0,1,2,3,4,5,6],"weeklyGoal":7,"mode":"count","target":2,"startDate":"2026-01-01","reminderTime":reminder})).unwrap()
    }

    #[test]
    fn reminder_schedule_counts_completion_and_consumes_suppressed_events() {
        let db = Connection::open_in_memory().unwrap();
        super::super::initialize(&db).unwrap();
        initialize(&db).unwrap();
        let mut state = add_habit(&db, Some("09:00"));
        let at = NaiveDate::from_ymd_opt(2026, 10, 15)
            .unwrap()
            .and_hms_opt(9, 0, 0)
            .unwrap();
        let reminders = due(&state, at).unwrap();
        assert_eq!(reminders.len(), 1);
        assert!(due(&state, at + Duration::minutes(1)).unwrap().is_empty());
        assert_eq!(
            claim(&db, &reminders, "2026-10-15", state.revision, 0, None)
                .unwrap()
                .len(),
            1
        );
        assert!(claim(
            &db,
            &reminders,
            "2026-10-15",
            state.revision,
            0,
            Some("late")
        )
        .unwrap()
        .is_empty());
        state.habit_feedback_enabled = true;
        state.habit_checks.push(super::super::habits::HabitCheck {
            habit_id: state.habits[0].id.clone(),
            date: "2026-10-15".into(),
            status: "done".into(),
            count: 1,
        });
        assert!(due(&state, at).unwrap()[0]
            .key
            .starts_with("habit-reminder"));
        state.habit_checks[0].count = 2;
        assert!(due(&state, at).unwrap()[0].key.starts_with("habit-praise"));
        state.habits[0].archived = true;
        assert!(due(&state, at).unwrap().is_empty());
    }

    #[test]
    fn stale_or_expired_diary_playback_never_displays() {
        let state = app::tests::state();
        let db = lock(&state.db).unwrap();
        initialize(&db).unwrap();
        let saved = add_habit(&db, None);
        let reminders = vec![Reminder {
            key: "one".into(),
            text: "test".into(),
        }];
        claim(
            &db,
            &reminders,
            "2026-10-15",
            saved.revision,
            0,
            Some("expired"),
        )
        .unwrap();
        assert!(!playback_current(&state, &db, "expired").unwrap());
        assert!(!playback_current(&state, &db, "unknown").unwrap());
        claim(
            &db,
            &[Reminder {
                key: "two".into(),
                text: "test".into(),
            }],
            "2026-10-15",
            saved.revision,
            chrono::Utc::now().timestamp_millis() + 60_000,
            Some("changed"),
        )
        .unwrap();
        update(
            &db,
            saved.revision,
            "habit-settings",
            &json!({"feedbackEnabled":true}),
        )
        .unwrap();
        assert!(!playback_current(&state, &db, "changed").unwrap());
    }

    #[test]
    fn ledger_background_catches_month_boundary_and_new_rules_without_idle_writes() {
        let db = Connection::open_in_memory().unwrap();
        super::super::initialize(&db).unwrap();
        let rule = json!({"title":"월세","amount":550000,"category":"housing","estimated":false,"frequency":"monthly","interval":1,"day":31,"weekday":0,"months":[],"startDate":"2026-01-01","endDate":null,"weekend":"keep","autoRecord":true,"enabled":true});
        let state = update(&db, 0, "ledger-recurring-create", &rule).unwrap();
        let jan30 = generate(&db, &state, NaiveDate::from_ymd_opt(2026, 1, 30).unwrap()).unwrap();
        assert!(jan30.ledger_entries.is_empty());
        let feb = generate(&db, &jan30, NaiveDate::from_ymd_opt(2026, 2, 2).unwrap()).unwrap();
        assert_eq!(feb.ledger_entries.len(), 1);
        assert_eq!(feb.ledger_entries[0].date, "2026-01-31");
        let writes = db.total_changes();
        let unchanged = generate(&db, &feb, NaiveDate::from_ymd_opt(2026, 2, 2).unwrap()).unwrap();
        assert_eq!(unchanged, feb);
        assert_eq!(db.total_changes(), writes);
        let mut added = rule.clone();
        added["title"] = json!("구독");
        added["day"] = json!(2);
        added["startDate"] = json!("2026-02-02");
        let next = update(&db, feb.revision, "ledger-recurring-create", &added).unwrap();
        let generated = generate(&db, &next, NaiveDate::from_ymd_opt(2026, 2, 2).unwrap()).unwrap();
        assert_eq!(generated.ledger_entries.len(), 2);
        assert_eq!(generated.ledger_entries[1].date, "2026-02-02");
        let again = generate(
            &db,
            &read(&db).unwrap(),
            NaiveDate::from_ymd_opt(2026, 2, 2).unwrap(),
        )
        .unwrap();
        assert_eq!(again, generated);
    }

    #[test]
    fn diary_speech_obeys_automatic_visibility_pause_and_recent_input_gates() {
        let state = app::tests::state();
        let db = lock(&state.db).unwrap();
        let mut settings = store::settings(&db).unwrap();
        settings.autonomous_enabled = true;
        store::save_settings(&db, &settings).unwrap();
        assert!(speaker(&state, &db, true).unwrap().is_some());
        lock(&state.runtime).unwrap().hidden = true;
        assert!(speaker(&state, &db, true).unwrap().is_none());
        lock(&state.runtime).unwrap().hidden = false;
        lock(&state.runtime).unwrap().paused = true;
        assert!(speaker(&state, &db, true).unwrap().is_none());
        lock(&state.runtime).unwrap().paused = false;
        settings.autonomous_enabled = false;
        store::save_settings(&db, &settings).unwrap();
        assert!(speaker(&state, &db, true).unwrap().is_none());
        settings.autonomous_enabled = true;
        store::save_settings(&db, &settings).unwrap();
        state.last_input.store(app::now(), Ordering::SeqCst);
        assert!(speaker(&state, &db, true).unwrap().is_none());
    }
}
