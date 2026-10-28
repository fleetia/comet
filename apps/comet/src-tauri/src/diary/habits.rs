use super::{boolean, capacity, date, missing, new_id, string, time, DiaryState, Result};
use chrono::{Datelike, Local, NaiveDate};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct Habit {
    pub(super) id: String,
    pub(super) title: String,
    pub(super) description: String,
    pub(super) color: String,
    pub(super) weekdays: Vec<u32>,
    pub(super) weekly_goal: u32,
    pub(super) mode: String,
    pub(super) target: u32,
    pub(super) start_date: String,
    pub(super) reminder_time: Option<String>,
    pub(super) archived: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct HabitCheck {
    pub(super) habit_id: String,
    pub(super) date: String,
    pub(super) status: String,
    pub(super) count: u32,
}

pub(super) fn record_moment(
    db: &Connection,
    before: &DiaryState,
    after: &DiaryState,
    input: &Value,
    present: &[String],
    at: i64,
) -> Result<()> {
    let Some(today) = chrono::DateTime::from_timestamp_millis(at)
        .map(|time| time.with_timezone(&Local).date_naive())
    else {
        return Ok(());
    };
    let Some(id) = input["habitId"].as_str() else {
        return Ok(());
    };
    let today_string = today.format("%Y-%m-%d").to_string();
    if input["date"].as_str() != Some(today_string.as_str()) {
        return Ok(());
    }
    let Some(habit) = after.habits.iter().find(|habit| habit.id == id) else {
        return Ok(());
    };
    if !habit.weekdays.contains(&today.weekday().num_days_from_sunday()) {
        return Ok(());
    }
    let complete = |check: &HabitCheck| {
        check.habit_id == id && check.status == "done"
            && (habit.mode == "check" || check.count >= habit.target)
    };
    if before.habit_checks.iter().any(|check| check.date == today_string && complete(check)) {
        return Ok(());
    }
    let completed_dates: std::collections::HashSet<&str> = after.habit_checks.iter()
        .filter(|check| complete(check))
        .map(|check| check.date.as_str())
        .collect();
    if !completed_dates.contains(today_string.as_str()) {
        return Ok(());
    }
    let mut day = today;
    let mut streak = 0;
    loop {
        let date = day.format("%Y-%m-%d").to_string();
        if date < habit.start_date {
            break;
        }
        if habit
            .weekdays
            .contains(&day.weekday().num_days_from_sunday())
        {
            if !completed_dates.contains(date.as_str()) {
                break;
            }
            streak += 1;
            if streak > 100 {
                break;
            }
        }
        let Some(previous) = day.pred_opt() else {
            break;
        };
        day = previous;
    }
    if ![7, 30, 100].contains(&streak) {
        return Ok(());
    }
    let Some(user) = crate::store::current_user(db)? else {
        return Ok(());
    };
    let key = format!("moment-seen:habit-streak:{}:{id}:{today_string}", user.id);
    if db.execute("INSERT OR IGNORE INTO kv(key,value) VALUES(?1,'true')", [&key]).map_err(super::err)? == 0 {
        return Ok(());
    }
    let summary = format!("‘{}’ {streak}일 연속", habit.title);
    for character in present {
        crate::store::insert_moment(
            db,
            character,
            &user.id,
            "habit-streak",
            &summary,
            at,
            Some(id),
            serde_json::json!({"habitId":id,"streak":streak}),
            None,
            None,
        )?;
    }
    Ok(())
}

fn number(input: &Value, key: &str, min: u32, max: u32) -> Result<u32> {
    input[key]
        .as_u64()
        .filter(|value| *value >= u64::from(min) && *value <= u64::from(max))
        .map(|value| value as u32)
        .ok_or_else(|| format!("{key} 값은 {min}–{max} 사이의 정수여야 합니다."))
}

fn fields(input: &Value, id: String, archived: bool) -> Result<Habit> {
    let mut weekdays = input["weekdays"]
        .as_array()
        .filter(|values| !values.is_empty() && values.len() <= 7)
        .ok_or("반복 요일을 하나 이상 선택해 주세요.")?
        .iter()
        .map(|value| {
            value
                .as_u64()
                .filter(|day| *day <= 6)
                .map(|day| day as u32)
                .ok_or("반복 요일이 올바르지 않습니다.")
        })
        .collect::<std::result::Result<Vec<_>, _>>()?;
    weekdays.sort_unstable();
    weekdays.dedup();
    let weekly_goal = number(input, "weeklyGoal", 1, weekdays.len() as u32)?;
    let color = string(input, "color", 20, true)?;
    if ![
        "work", "record", "life", "exercise", "rest", "focus", "comet", "google",
    ]
    .contains(&color.as_str())
    {
        return Err("습관 색상이 올바르지 않습니다.".into());
    }
    let mode = string(input, "mode", 20, true)?;
    if !["check", "count"].contains(&mode.as_str()) {
        return Err("기록 방식이 올바르지 않습니다.".into());
    }
    let target = number(input, "target", 1, 10000)?;
    if mode == "check" && target != 1 {
        return Err("완료 기록의 하루 목표는 1이어야 합니다.".into());
    }
    Ok(Habit {
        id,
        title: string(input, "title", 200, true)?,
        description: string(input, "description", 1000, false)?,
        color,
        weekdays,
        weekly_goal,
        mode,
        target,
        start_date: date(string(input, "startDate", 10, true)?)?,
        reminder_time: time(input, "reminderTime")?,
        archived,
    })
}

pub(super) fn mutate(state: &mut DiaryState, action: &str, input: &Value) -> Result<()> {
    match action {
        "habit-create" => {
            capacity(state.habits.len(), 500)?;
            let habit = fields(input, new_id(), false)?;
            state.habits.push(habit);
        }
        "habit-update" | "habit-delete" | "habit-archive" => {
            let id = string(input, "id", 200, true)?;
            let at = state
                .habits
                .iter()
                .position(|habit| habit.id == id)
                .ok_or_else(missing)?;
            if let Some(expected) = input.get("expectedHabit") {
                let actual = serde_json::to_value(&state.habits[at]).map_err(super::err)?;
                if expected != &actual {
                    return Err(
                        "이 습관이 다른 곳에서 바뀌었어요. 최신 내용을 확인해 주세요.".into(),
                    );
                }
            }
            match action {
                "habit-delete" => {
                    state.habits.remove(at);
                    state.habit_checks.retain(|check| check.habit_id != id);
                }
                "habit-archive" => state.habits[at].archived = boolean(input, "archived", true)?,
                _ => state.habits[at] = fields(input, id, state.habits[at].archived)?,
            }
        }
        "habit-check" => {
            let id = string(input, "habitId", 200, true)?;
            let selected_date = date(string(input, "date", 10, true)?)?;
            let habit = state
                .habits
                .iter()
                .find(|habit| habit.id == id)
                .ok_or_else(missing)?;
            if habit.archived {
                return Err("보관한 습관은 꺼낸 뒤 기록해 주세요.".into());
            }
            if selected_date > Local::now().format("%Y-%m-%d").to_string() {
                return Err("미래 날짜에는 습관을 기록할 수 없어요.".into());
            }
            let at = state
                .habit_checks
                .iter()
                .position(|check| check.habit_id == id && check.date == selected_date);
            if let Some(expected) = input.get("expectedCheck") {
                let actual = at
                    .map(|at| serde_json::to_value(&state.habit_checks[at]))
                    .transpose()
                    .map_err(super::err)?
                    .unwrap_or(Value::Null);
                if expected != &actual {
                    return Err(
                        "이 날짜의 기록이 다른 곳에서 바뀌었어요. 다시 확인해 주세요.".into(),
                    );
                }
            }
            let status = string(input, "status", 20, true)?;
            if status == "clear" {
                if let Some(at) = at {
                    state.habit_checks.remove(at);
                }
                return Ok(());
            }
            if !["done", "missed"].contains(&status.as_str()) {
                return Err("습관 완료 상태가 올바르지 않습니다.".into());
            }
            if selected_date < habit.start_date && at.is_none() {
                return Err("습관 시작일 이전에는 새 기록을 남길 수 없어요.".into());
            }
            if at.is_none()
                && !habit.weekdays.contains(
                    &NaiveDate::parse_from_str(&selected_date, "%Y-%m-%d")
                        .map_err(super::err)?
                        .weekday()
                        .num_days_from_sunday(),
                )
            {
                return Err("반복 요일에만 새 기록을 남길 수 있어요.".into());
            }
            let count = if status == "missed" {
                0
            } else if habit.mode == "check" {
                1
            } else {
                number(input, "count", 1, 10000)?
            };
            let entry = HabitCheck {
                habit_id: id,
                date: selected_date,
                status,
                count,
            };
            if let Some(at) = at {
                state.habit_checks[at] = entry;
            } else {
                capacity(state.habit_checks.len(), 200000)?;
                state.habit_checks.push(entry);
            }
        }
        "habit-settings" => {
            state.habit_feedback_enabled = boolean(input, "feedbackEnabled", false)?
        }
        _ => return Err("지원하지 않는 습관 작업입니다.".into()),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn definition() -> Value {
        json!({"title":"독서 30분","description":"  원문\n메모  ","color":"comet","weekdays":[1,3,5],"weeklyGoal":3,"mode":"check","target":1,"startDate":"2026-01-01","reminderTime":"21:00"})
    }

    #[test]
    fn habit_storage_keeps_history_through_edits_archive_and_reload() {
        let db = rusqlite::Connection::open_in_memory().unwrap();
        super::super::initialize(&db).unwrap();
        let created = super::super::update(&db, 0, "habit-create", &definition()).unwrap();
        let habit = &created.habits[0];
        let checked = super::super::update(
            &db,
            created.revision,
            "habit-check",
            &json!({"habitId":habit.id,"date":"2026-01-02","status":"done","expectedCheck":null}),
        )
        .unwrap();
        let mut edit = definition();
        edit["id"] = json!(habit.id);
        edit["expectedHabit"] = json!(habit);
        edit["title"] = json!("독서 20분");
        let edited = super::super::update(&db, checked.revision, "habit-update", &edit).unwrap();
        assert_eq!(edited.habit_checks, checked.habit_checks);
        assert_eq!(edited.habits[0].description, "  원문\n메모  ");
        let archived = super::super::update(
            &db,
            edited.revision,
            "habit-archive",
            &json!({"id":habit.id,"archived":true}),
        )
        .unwrap();
        assert_eq!(super::super::read(&db).unwrap(), archived);
        assert_eq!(archived.habit_checks, checked.habit_checks);
        assert!(super::super::update(
            &db,
            archived.revision,
            "habit-check",
            &json!({"habitId":habit.id,"date":"2026-01-02","status":"clear"})
        )
        .is_err());
        let deleted = super::super::update(
            &db,
            archived.revision,
            "habit-delete",
            &json!({"id":habit.id}),
        )
        .unwrap();
        assert!(deleted.habits.is_empty());
        assert!(deleted.habit_checks.is_empty());
    }

    #[test]
    fn stale_counts_and_invalid_definitions_never_overwrite_saved_data() {
        let db = rusqlite::Connection::open_in_memory().unwrap();
        super::super::initialize(&db).unwrap();
        let mut input = definition();
        input["mode"] = json!("count");
        input["target"] = json!(8);
        let created = super::super::update(&db, 0, "habit-create", &input).unwrap();
        let habit = &created.habits[0];
        let check = json!({"habitId":habit.id,"date":"2026-01-02","status":"done","count":3,"expectedCheck":null});
        let saved = super::super::update(&db, created.revision, "habit-check", &check).unwrap();
        assert!(super::super::update(&db, saved.revision, "habit-check", &check).is_err());
        for invalid in [
            json!({"weekdays":[]}),
            json!({"target":0}),
            json!({"weeklyGoal":8}),
            json!({"reminderTime":"25:90"}),
            json!({"mode":"other"}),
            json!({"startDate":"2026-02-30"}),
        ] {
            let mut definition = input.clone();
            for (key, value) in invalid.as_object().unwrap() {
                definition[key] = value.clone();
            }
            assert!(
                super::super::update(&db, saved.revision, "habit-create", &definition).is_err()
            );
            assert_eq!(super::super::read(&db).unwrap(), saved);
        }
        assert!(super::super::update(
            &db,
            saved.revision,
            "habit-check",
            &json!({"habitId":habit.id,"date":"9999-01-01","status":"done","count":1})
        )
        .is_err());
        let cleared = super::super::update(&db, saved.revision, "habit-check", &json!({"habitId":habit.id,"date":"2026-01-02","status":"clear","expectedCheck":saved.habit_checks[0]})).unwrap();
        assert!(cleared.habit_checks.is_empty());
    }
}
