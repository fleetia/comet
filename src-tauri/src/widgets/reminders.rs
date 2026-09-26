use super::{storage, EventDraft, WidgetEffect};
use chrono::{Local, NaiveDate, NaiveTime, TimeZone, Timelike};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{cmp::Ordering, collections::BTreeMap};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub struct ReminderSettings {
    pub enabled: bool,
    pub character_enabled: bool,
    pub os_enabled: bool,
    pub lead_minutes: u32,
    pub include_all_day: bool,
    pub quiet_start: String,
    pub quiet_end: String,
    pub mood_day_start: bool,
    pub mood_focus_start: bool,
    pub mood_break: bool,
    pub mood_day_end: bool,
    pub day_start: String,
    pub day_end: String,
}

impl Default for ReminderSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            character_enabled: true,
            os_enabled: false,
            lead_minutes: 10,
            include_all_day: false,
            quiet_start: "22:00".into(),
            quiet_end: "08:00".into(),
            mood_day_start: false,
            mood_focus_start: false,
            mood_break: false,
            mood_day_end: false,
            day_start: "09:00".into(),
            day_end: "21:00".into(),
        }
    }
}

pub fn initial() -> Value {
    serde_json::to_value(ReminderSettings::default()).expect("reminder defaults serialize")
}

fn settings(data: &Value) -> Result<ReminderSettings, String> {
    serde_json::from_value(
        data.get("reminders")
            .filter(|value| !value.is_null())
            .cloned()
            .unwrap_or_else(initial),
    )
    .map_err(|_| "생활 알림 설정을 읽지 못했어요.".into())
}

pub fn configure(data: &Value, input: &Value) -> Result<Value, String> {
    let settings: ReminderSettings =
        serde_json::from_value(input.clone()).map_err(|_| "알림 설정 형식이 올바르지 않아요.")?;
    if settings.lead_minutes > 120 {
        return Err("생활 알림은 0~120분 전으로 설정해 주세요.".into());
    }
    for time in [
        &settings.quiet_start,
        &settings.quiet_end,
        &settings.day_start,
        &settings.day_end,
    ] {
        minute(time)?;
    }
    let mut data = data.clone();
    data["reminders"] = serde_json::to_value(settings).map_err(|error| error.to_string())?;
    Ok(data)
}

pub fn act(data: &Value, action: &str, input: &Value, now: i64) -> Result<WidgetEffect, String> {
    let mut data = data.clone();
    match action {
        "preview-alert" => {
            return Ok(WidgetEffect {
                data,
                events: vec![EventDraft {
                kind: "planner-mood".into(),
                text:
                    "오늘 고른 일부터 천천히 해 봐요. 필요할 때 일정과 할 일을 꺼내 볼 수 있어요."
                        .into(),
                payload: json!({"preview":true}),
            }],
            })
        }
        "configure-alerts" => data = configure(&data, input)?,
        "mute-alerts" => {
            data["alertState"]["mutedUntil"] = json!(now + 3_600_000);
            data["alertState"]["snoozeAt"] = Value::Null;
        }
        "unmute-alerts" => data["alertState"]["mutedUntil"] = Value::Null,
        "snooze-alert" => {
            let last = &data["alertState"]["lastNotification"];
            if !last["observedAt"]
                .as_i64()
                .is_some_and(|at| now >= at && now - at <= 3_600_000)
                || last["targets"].as_array().is_none_or(Vec::is_empty)
            {
                return Err("다시 알릴 최근 일정이나 할 일이 없어요.".into());
            }
            data["alertState"]["snoozeAt"] = json!(now + 600_000);
        }
        _ => return Err("지원하지 않는 생활 알림 동작이에요.".into()),
    }
    Ok(WidgetEffect {
        data,
        events: vec![],
    })
}

fn minute(value: &str) -> Result<u32, String> {
    let time = NaiveTime::parse_from_str(value, "%H:%M")
        .map_err(|_| "알림 시각은 시:분으로 입력해 주세요.")?;
    Ok(time.hour() * 60 + time.minute())
}

fn quiet(settings: &ReminderSettings, local_minute: u32) -> Result<bool, String> {
    let start = minute(&settings.quiet_start)?;
    let end = minute(&settings.quiet_end)?;
    Ok(match start.cmp(&end) {
        Ordering::Less => local_minute >= start && local_minute < end,
        Ordering::Greater => local_minute >= start || local_minute < end,
        Ordering::Equal => false,
    })
}

fn local_date_time(date: &str, at: &str) -> Option<i64> {
    NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .ok()
        .zip(NaiveTime::parse_from_str(at, "%H:%M").ok())
        .and_then(|(date, at)| Local.from_local_datetime(&date.and_time(at)).single())
        .map(|at| at.timestamp_millis())
}

fn targets(
    data: &Value,
    todo: Option<&Value>,
    settings: &ReminderSettings,
    now: i64,
) -> Vec<Value> {
    let mut targets = vec![];
    for event in data["events"].as_array().into_iter().flatten() {
        if event["cancelled"] == true {
            continue;
        }
        let fresh = data["connections"]
            .as_array()
            .into_iter()
            .flatten()
            .any(|connection| {
                connection["id"] == event["connectionId"]
                    && matches!(connection["status"].as_str(), Some("ready" | "syncing"))
                    && connection["lastSuccessAt"]
                        .as_i64()
                        .is_some_and(|time| now >= time && now - time <= 30 * 60 * 1000)
            });
        if !fresh {
            continue;
        }
        let starts = if event["allDay"] == true {
            if !settings.include_all_day {
                continue;
            }
            event["startDate"]
                .as_str()
                .and_then(|date| local_date_time(date, "09:00"))
        } else {
            event["startAt"].as_i64()
        };
        if let Some(starts) = starts {
            targets.push(
                json!({"kind":"calendar","id":event["id"],"title":event["title"],"at":starts}),
            );
        }
    }
    for item in todo
        .into_iter()
        .flat_map(|data| data["items"].as_array())
        .flatten()
    {
        if !item["completedAt"].is_null() || item["reminderEnabled"] == false {
            continue;
        }
        let starts = item["dueAt"].as_i64().or_else(|| {
            if !settings.include_all_day {
                return None;
            }
            item["dueDate"]
                .as_str()
                .and_then(|date| local_date_time(date, "09:00"))
        });
        if let Some(starts) = starts {
            targets.push(json!({"kind":"todo","id":item["id"],"title":item["title"],"at":starts}));
        }
    }
    targets
}

fn crossed(after: i64, now: i64, threshold: i64) -> bool {
    now >= after && now - after <= 120_000 && threshold > after && threshold <= now
}

fn due_targets(
    data: &Value,
    todo: Option<&Value>,
    after: i64,
    now: i64,
    local_minute: u32,
) -> Result<Vec<Value>, String> {
    let settings = settings(data)?;
    if !settings.enabled
        || (!settings.character_enabled && !settings.os_enabled)
        || quiet(&settings, local_minute)?
        || data["alertState"]["mutedUntil"]
            .as_i64()
            .is_some_and(|at| at > now)
    {
        return Ok(vec![]);
    }
    let targets = targets(data, todo, &settings, now);
    let snooze = data["alertState"]["snoozeAt"]
        .as_i64()
        .is_some_and(|at| crossed(after, now, at));
    Ok(targets
        .into_iter()
        .filter(|target| {
            let starts = target["at"].as_i64().unwrap_or_default();
            let original = starts >= now
                && crossed(
                    after,
                    now,
                    starts.saturating_sub(i64::from(settings.lead_minutes) * 60_000),
                );
            let requested = snooze
                && data["alertState"]["lastNotification"]["targets"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .any(|old| {
                        old["kind"] == target["kind"]
                            && old["id"] == target["id"]
                            && old["at"] == target["at"]
                    });
            original || requested
        })
        .collect())
}

pub struct Delivery {
    pub instance_id: String,
    pub text: String,
}

pub struct Advance {
    pub changed: bool,
    pub os: Vec<Delivery>,
}

pub fn event_current(db: &Connection, event: &super::WidgetEvent) -> Result<bool, String> {
    if event.event.kind == "planner-mood" {
        let instances = storage::instances(db)?;
        return Ok(event.event.payload["timerStates"]
            .as_array()
            .is_none_or(|timers| {
                timers.iter().all(|timer| {
                    instances.iter().any(|item| {
                        item.installed
                            && item.enabled
                            && item.id == timer["id"]
                            && Some(item.revision) == timer["revision"].as_i64()
                    })
                })
            }));
    }
    if event.event.kind != "planner-reminder" {
        return Ok(true);
    }
    let instances = storage::instances(db)?;
    let Some(calendar) = instances.iter().find(|item| item.id == event.instance_id) else {
        return Ok(false);
    };
    let todo = instances
        .iter()
        .find(|item| item.kind == "todo" && item.installed && item.enabled)
        .map(|item| &item.data);
    let current = targets(
        &calendar.data,
        todo,
        &settings(&calendar.data)?,
        chrono::Utc::now().timestamp_millis(),
    );
    Ok(event.event.payload["targets"]
        .as_array()
        .is_some_and(|old| !old.is_empty() && old.iter().all(|target| current.contains(target))))
}

fn timer_moods(
    clocks: &mut BTreeMap<String, i64>,
    id: &str,
    timers: &[super::WidgetInstance],
    now: i64,
    allowed: bool,
    settings: &ReminderSettings,
) -> Vec<&'static str> {
    let mut lines = vec![];
    for timer in timers {
        let key = format!("{id}:timer:{}", timer.id);
        let mode = timer.data["mode"].as_str().unwrap_or_default();
        let status = timer.data["status"].as_str().unwrap_or_default();
        let marker = match (status, mode) {
            ("running", "focus") => timer.data["deadline"].as_i64().unwrap_or(1),
            ("finished", "focus") => -1,
            _ => 0,
        };
        let previous = clocks.insert(key, marker);
        if !allowed || previous.is_none() || previous == Some(marker) {
            continue;
        }
        let cooldown = format!("{id}:mood-cooldown");
        if clocks.get(&cooldown).is_some_and(|at| now - at < 600_000) {
            continue;
        }
        let line = if marker > 0 && settings.mood_focus_start {
            Some("집중 시간을 시작했어요. 지금 고른 일부터 천천히 해 봐요.")
        } else if marker == -1 && previous.is_some_and(|at| at > 0) && settings.mood_break {
            Some("집중 시간이 끝났어요. 잠깐 쉬어도 좋아요. 할 일 완료는 직접 골라 주세요.")
        } else {
            None
        };
        if let Some(line) = line {
            clocks.insert(cooldown, now);
            lines.push(line);
        }
    }
    lines
}

pub fn advance(
    db: &Connection,
    clocks: &mut BTreeMap<String, i64>,
    now: i64,
) -> Result<Advance, String> {
    let local = Local
        .timestamp_millis_opt(now)
        .single()
        .ok_or("알림 시각이 올바르지 않아요.")?;
    let instances = storage::instances(db)?;
    let todo = instances
        .iter()
        .find(|item| item.kind == "todo" && item.installed && item.enabled)
        .map(|item| &item.data);
    let timers: Vec<_> = instances
        .iter()
        .filter(|item| item.kind == "focus-timer" && item.installed && item.enabled)
        .cloned()
        .collect();
    let mut result = Advance {
        changed: false,
        os: vec![],
    };
    for instance in instances
        .iter()
        .filter(|instance| instance.kind == "calendar")
    {
        let previous = clocks.insert(instance.id.clone(), now);
        let settings = settings(&instance.data)?;
        let continuous = previous.is_some_and(|after| now >= after && now - after <= 120_000);
        let allowed = instance.installed
            && instance.enabled
            && continuous
            && !quiet(&settings, local.hour() * 60 + local.minute())?
            && instance.data["alertState"]["mutedUntil"]
                .as_i64()
                .is_none_or(|at| at <= now);
        let mut mood = timer_moods(clocks, &instance.id, &timers, now, allowed, &settings);
        if !allowed {
            continue;
        }
        let previous = previous.unwrap_or(now);
        let date = local.date_naive().to_string();
        for (enabled, time, kind, line) in [
            (
                settings.mood_day_start,
                &settings.day_start,
                "day-start",
                "하루를 시작해 볼까요? 오늘 일정과 할 일을 꺼내 볼 수 있어요.",
            ),
            (
                settings.mood_day_end,
                &settings.day_end,
                "day-end",
                "오늘 마친 일부터 볼까요? 남은 일은 옮길 것만 직접 골라 주세요.",
            ),
        ] {
            if enabled && local_date_time(&date, time).is_some_and(|at| crossed(previous, now, at))
            {
                let key = format!("{}:{kind}", instance.id);
                let day = local_date_time(&date, "12:00").unwrap_or(now);
                if clocks.get(&key) != Some(&day) {
                    clocks.insert(key, day);
                    mood.push(line);
                }
            }
        }
        let due = due_targets(
            &instance.data,
            todo,
            previous,
            now,
            local.hour() * 60 + local.minute(),
        )?;
        let mut data = instance.data.clone();
        let mut drafts = vec![];
        if !due.is_empty() {
            let titles = due
                .iter()
                .take(3)
                .filter_map(|item| item["title"].as_str())
                .map(|title| title.chars().take(120).collect::<String>())
                .collect::<Vec<_>>()
                .join(" · ");
            let suffix = if due.len() > 3 {
                format!(" 외 {}개", due.len() - 3)
            } else {
                String::new()
            };
            let text = format!("등록한 일정이나 할 일의 시간이 가까워졌어요. {titles}{suffix}");
            data["alertState"]["lastNotification"] =
                json!({"text":text,"targets":due,"observedAt":now});
            data["alertState"]["snoozeAt"] = Value::Null;
            if settings.character_enabled {
                drafts.push(EventDraft {
                    kind: "planner-reminder".into(),
                    text: text.clone(),
                    payload: json!({"targets":due}),
                });
            }
            if settings.os_enabled {
                result.os.push(Delivery {
                    instance_id: instance.id.clone(),
                    text,
                });
            }
        }
        if settings.character_enabled && !mood.is_empty() && due.is_empty() {
            drafts.push(EventDraft {
                kind: "planner-mood".into(),
                text: mood.remove(0).into(),
                payload: json!({"timerStates": timers.iter().map(|timer| json!({"id":timer.id,"revision":timer.revision})).collect::<Vec<_>>()}),
            });
        }
        if data != instance.data || !drafts.is_empty() {
            storage::commit_data(db, &instance.id, instance.revision, data, drafts, now)?;
            result.changed = true;
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn data() -> Value {
        json!({"reminders":{"enabled":true,"leadMinutes":10,"includeAllDay":false,"quietStart":"22:00","quietEnd":"08:00"},
        "connections":[{"id":"c","status":"ready","lastSuccessAt":1_000_000}],
        "events":[{"id":"one","connectionId":"c","title":"회의","startAt":1_600_000,"allDay":false,"cancelled":false}]})
    }
    #[test]
    fn alerts_cross_once_and_skip_catchup_quiet_stale_and_cancelled() {
        let value = data();
        assert_eq!(
            due_targets(&value, None, 999_500, 1_000_000, 600)
                .unwrap()
                .len(),
            1
        );
        for (after, now, minute) in [
            (1_000_000, 1_000_500, 600),
            (800_000, 1_000_000, 600),
            (999_500, 1_000_000, 1380),
        ] {
            assert!(due_targets(&value, None, after, now, minute)
                .unwrap()
                .is_empty());
        }
        let mut offline = value.clone();
        offline["connections"][0]["status"] = json!("offline");
        assert!(due_targets(&offline, None, 999_500, 1_000_000, 600)
            .unwrap()
            .is_empty());
        let mut cancelled = value;
        cancelled["events"][0]["cancelled"] = json!(true);
        assert!(due_targets(&cancelled, None, 999_500, 1_000_000, 600)
            .unwrap()
            .is_empty());
    }
    #[test]
    fn local_tasks_work_offline_and_snooze_never_changes_due_or_completed_tasks() {
        let mut value = data();
        value["connections"] = json!([]);
        let todo =
            json!({"items":[{"id":"task","title":"책 반납","dueAt":1_600_000,"completedAt":null}]});
        let due = due_targets(&value, Some(&todo), 999_500, 1_000_000, 600).unwrap();
        assert_eq!(due.len(), 1);
        value["alertState"] = json!({"lastNotification":{"targets":due,"observedAt":1_000_000}});
        let snoozed = act(&value, "snooze-alert", &json!({}), 1_001_000)
            .unwrap()
            .data;
        assert_eq!(snoozed["alertState"]["snoozeAt"], 1_601_000);
        assert_eq!(
            due_targets(&snoozed, Some(&todo), 1_600_000, 1_601_000, 600)
                .unwrap()
                .len(),
            1
        );
        let mut changed = todo.clone();
        changed["items"][0]["dueAt"] = json!(2_600_000);
        assert!(
            due_targets(&snoozed, Some(&changed), 1_600_000, 1_601_000, 600)
                .unwrap()
                .is_empty()
        );
        changed = todo.clone();
        changed["items"][0]["completedAt"] = json!(1_100_000);
        assert!(
            due_targets(&snoozed, Some(&changed), 1_600_000, 1_601_000, 600)
                .unwrap()
                .is_empty()
        );
        assert_eq!(todo["items"][0]["dueAt"], 1_600_000);
        let muted = act(&value, "mute-alerts", &json!({}), 999_000)
            .unwrap()
            .data;
        assert!(due_targets(&muted, Some(&todo), 999_500, 1_000_000, 600)
            .unwrap()
            .is_empty());
    }
    #[test]
    fn all_day_tasks_use_local_nine_and_remain_opt_in() {
        let mut value = data();
        value["connections"] = json!([]);
        let todo = json!({"items":[{"id":"day","title":"정리","dueDate":"2026-09-21","completedAt":null}]});
        let threshold = local_date_time("2026-09-21", "08:50").unwrap();
        assert!(
            due_targets(&value, Some(&todo), threshold - 1000, threshold, 530)
                .unwrap()
                .is_empty()
        );
        value["reminders"]["includeAllDay"] = json!(true);
        assert_eq!(
            due_targets(&value, Some(&todo), threshold - 1000, threshold, 530)
                .unwrap()
                .len(),
            1
        );
        value["reminders"]["characterEnabled"] = json!(false);
        assert!(
            due_targets(&value, Some(&todo), threshold - 1000, threshold, 530)
                .unwrap()
                .is_empty()
        );
    }
    #[test]
    fn mood_observes_transitions_and_cooldown_without_replaying_a_restored_timer() {
        let db = Connection::open_in_memory().unwrap();
        storage::initialize(&db).unwrap();
        let temp = tempfile::tempdir().unwrap();
        storage::install(&db, temp.path(), &["todo".into(), "focus-timer".into()]).unwrap();
        let mut timer = storage::instances(&db)
            .unwrap()
            .into_iter()
            .find(|item| item.kind == "focus-timer")
            .unwrap();
        let settings = ReminderSettings {
            mood_focus_start: true,
            mood_break: true,
            ..ReminderSettings::default()
        };
        let mut clocks = BTreeMap::new();
        timer.data = json!({"status":"running","mode":"focus","deadline":1_500_000});
        assert!(timer_moods(
            &mut clocks,
            "calendar",
            &[timer.clone()],
            1000,
            true,
            &settings
        )
        .is_empty());
        timer.data["status"] = json!("finished");
        assert_eq!(
            timer_moods(
                &mut clocks,
                "calendar",
                &[timer.clone()],
                1_500_000,
                true,
                &settings
            )
            .len(),
            1
        );
        assert!(timer_moods(
            &mut clocks,
            "calendar",
            &[timer.clone()],
            1_500_001,
            true,
            &settings
        )
        .is_empty());
        timer.data = json!({"status":"running","mode":"focus","deadline":3_000_000});
        assert!(timer_moods(
            &mut clocks,
            "calendar",
            &[timer.clone()],
            1_500_002,
            true,
            &settings
        )
        .is_empty());
        timer.data["deadline"] = json!(4_000_000);
        assert_eq!(
            timer_moods(
                &mut clocks,
                "calendar",
                &[timer.clone()],
                2_100_001,
                true,
                &settings
            )
            .len(),
            1
        );
        timer.data["status"] = json!("finished");
        assert!(timer_moods(
            &mut clocks,
            "calendar",
            &[timer.clone()],
            4_000_000,
            false,
            &settings
        )
        .is_empty());
        assert!(timer_moods(
            &mut clocks,
            "calendar",
            &[timer],
            4_000_001,
            true,
            &settings
        )
        .is_empty());
    }
    #[test]
    fn configuration_preserves_calendar_and_old_opt_in_and_validates_bounds() {
        assert!(settings(&data()).unwrap().character_enabled);
        assert!(!settings(&data()).unwrap().os_enabled);
        let updated = configure(&data(), &initial()).unwrap();
        assert_eq!(updated["events"], data()["events"]);
        let mut invalid = initial();
        invalid["leadMinutes"] = json!(121);
        assert!(configure(&data(), &invalid).is_err());
        invalid = initial();
        invalid["dayStart"] = json!("25:90");
        assert!(configure(&data(), &invalid).is_err());
    }
    #[test]
    fn completing_or_editing_a_task_invalidates_its_pending_character_reminder() {
        let db = Connection::open_in_memory().unwrap();
        storage::initialize(&db).unwrap();
        let temp = tempfile::tempdir().unwrap();
        storage::install(&db, temp.path(), &["calendar".into(), "todo".into()]).unwrap();
        let instances = storage::instances(&db).unwrap();
        let calendar = instances
            .iter()
            .find(|item| item.kind == "calendar")
            .unwrap();
        let todo = instances.iter().find(|item| item.kind == "todo").unwrap();
        let now = chrono::Utc::now().timestamp_millis();
        let target = json!({"kind":"todo","id":"task","title":"책 반납","at":now+600_000});
        let event = super::super::WidgetEvent {
            id: "pending".into(),
            instance_id: calendar.id.clone(),
            widget_kind: "calendar".into(),
            revision: calendar.revision,
            created_at: now,
            expires_at: now + 30_000,
            event: EventDraft {
                kind: "planner-reminder".into(),
                text: "책 반납".into(),
                payload: json!({"targets":[target]}),
            },
        };
        let mut data = todo.data.clone();
        data["items"] =
            json!([{"id":"task","title":"책 반납","dueAt":now+600_000,"completedAt":null}]);
        storage::commit_data(&db, &todo.id, todo.revision, data.clone(), vec![], now).unwrap();
        assert!(event_current(&db, &event).unwrap());
        data["items"][0]["completedAt"] = json!(now + 1);
        let revision = storage::get(&db, &todo.id).unwrap().revision;
        storage::commit_data(&db, &todo.id, revision, data.clone(), vec![], now + 1).unwrap();
        assert!(!event_current(&db, &event).unwrap());
        data["items"][0]["completedAt"] = Value::Null;
        data["items"][0]["title"] = json!("다른 일");
        let revision = storage::get(&db, &todo.id).unwrap().revision;
        storage::commit_data(&db, &todo.id, revision, data, vec![], now + 2).unwrap();
        assert!(!event_current(&db, &event).unwrap());
    }
    #[test]
    fn first_tick_and_restart_do_not_replay_and_channels_are_independent() {
        let db = Connection::open_in_memory().unwrap();
        storage::initialize(&db).unwrap();
        let temp = tempfile::tempdir().unwrap();
        storage::install(&db, temp.path(), &["calendar".into(), "todo".into()]).unwrap();
        let calendar = storage::instances(&db)
            .unwrap()
            .into_iter()
            .find(|i| i.kind == "calendar")
            .unwrap();
        let mut value = data();
        value["reminders"]["quietStart"] = json!("00:00");
        value["reminders"]["quietEnd"] = json!("00:00");
        value["reminders"]["characterEnabled"] = json!(false);
        value["reminders"]["osEnabled"] = json!(true);
        storage::commit_data(&db, &calendar.id, calendar.revision, value, vec![], 999_000).unwrap();
        let mut clocks = BTreeMap::new();
        assert!(!advance(&db, &mut clocks, 999_500).unwrap().changed);
        let result = advance(&db, &mut clocks, 1_000_000).unwrap();
        assert_eq!(result.os.len(), 1);
        assert!(storage::take_reaction(&db, 1_000_001).unwrap().is_none());
        assert!(advance(&db, &mut BTreeMap::new(), 1_000_000)
            .unwrap()
            .os
            .is_empty());
        assert!(advance(&db, &mut clocks, 1_000_001).unwrap().os.is_empty());
    }
}
