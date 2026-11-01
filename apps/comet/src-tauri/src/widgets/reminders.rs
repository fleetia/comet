use super::{storage, EventDraft, WidgetEffect};
use chrono::{Datelike, Local, NaiveDate, NaiveTime, TimeZone, Timelike};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;

mod planning;

const ANNIVERSARY_RETRY_MILLIS: i64 = 5 * 60_000;

pub(crate) fn anniversary_speaker_available(active: &[String], present: &[String], sleeping: &[String]) -> bool {
    active.first().is_some_and(|id| present.contains(id) && !sleeping.contains(id))
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub struct ReminderSettings {
    pub enabled: bool,
    pub character_enabled: bool,
    pub os_enabled: bool,
    pub sound_enabled: bool,
    pub lead_minutes: u32,
    pub include_all_day: bool,
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
            sound_enabled: false,
            lead_minutes: 10,
            include_all_day: false,
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
    for time in [&settings.day_start, &settings.day_end] {
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
        "clear-notification-error" => data["alertState"]["lastDeliveryError"] = Value::Null,
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
        let fresh = event["connectionId"] == "local"
            || data["connections"]
                .as_array()
                .into_iter()
                .flatten()
                .any(|connection| {
                    let freshness = match connection["status"].as_str() {
                        Some("ready" | "syncing") => 30 * 60 * 1000,
                        Some("offline") => 24 * 60 * 60 * 1000,
                        _ => return false,
                    };
                    connection["id"] == event["connectionId"]
                        && connection["lastSuccessAt"]
                            .as_i64()
                            .is_some_and(|time| now >= time && now - time <= freshness)
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

#[cfg(test)]
fn due_targets(data: &Value, todo: Option<&Value>, after: i64, now: i64) -> Result<Vec<Value>, String> {
    due_targets_at(data, todo, after, now, false)
}

fn due_targets_at(
    data: &Value,
    todo: Option<&Value>,
    after: i64,
    now: i64,
    catch_up: bool,
) -> Result<Vec<Value>, String> {
    let settings = settings(data)?;
    if !settings.enabled {
        return Ok(vec![]);
    }
    let targets = targets(data, todo, &settings, now);
    let snooze = data["alertState"]["snoozeAt"]
        .as_i64()
        .is_some_and(|at| {
            if catch_up {
                at > after && at <= now
            } else {
                crossed(after, now, at)
            }
        });
    Ok(targets
        .into_iter()
        .filter(|target| {
            let starts = target["at"].as_i64().unwrap_or_default();
            let threshold = starts.saturating_sub(i64::from(settings.lead_minutes) * 60_000);
            let original = if catch_up {
                target["kind"] == "calendar" && starts > now && threshold > after && threshold <= now
            } else {
                (settings.lead_minutes == 0 || starts >= now) && crossed(after, now, threshold)
            };
            let requested = snooze
                && (!catch_up || (target["kind"] == "calendar" && starts > now))
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
    pub sound_enabled: bool,
    pub widget: bool,
    pub notification_key: String,
    pub fallback: Option<super::WidgetEvent>,
    pub additional_fallbacks: Vec<super::WidgetEvent>,
    pub fallback_timers: Vec<String>,
    pub grouped: bool,
    pub destination: Option<(String, Option<String>, Option<String>)>,
}

pub struct Advance {
    pub changed: bool,
    pub os: Vec<Delivery>,
}

pub(crate) fn record_overflow(db: &Connection, events: &[super::WidgetEvent], now: i64) -> Result<(), String> {
    if events.is_empty() {
        return Ok(());
    }
    let Some(calendar) = storage::instances(db)?.into_iter().find(|item| item.kind == "calendar") else {
        return Ok(());
    };
    let mut data = calendar.data;
    let recent = data["alertState"]["lastNotification"]["observedAt"].as_i64()
        .is_some_and(|at| now >= at && now - at <= 3_600_000);
    let mut text = if recent { data["alertState"]["lastNotification"]["text"].as_str().unwrap_or_default().to_string() } else { String::new() };
    let mut targets = if recent { data["alertState"]["lastNotification"]["targets"].as_array().cloned().unwrap_or_default() } else { vec![] };
    for event in events {
        if !text.lines().any(|line| line == event.event.text) {
            if !text.is_empty() { text.push('\n'); }
            text.push_str(&event.event.text);
        }
        for target in event.event.payload["targets"].as_array().into_iter().flatten() {
            if !targets.contains(target) { targets.push(target.clone()); }
        }
    }
    data["alertState"]["lastNotification"] = json!({"text":text,"targets":targets,"observedAt":now});
    db.execute("UPDATE widget_instances SET data=?1 WHERE id=?2 AND revision=?3", rusqlite::params![data.to_string(), calendar.id, calendar.revision]).map_err(|error| error.to_string())?;
    Ok(())
}

pub fn event_current(db: &Connection, event: &super::WidgetEvent) -> Result<bool, String> {
    if event.event.payload["bubbleEnabled"] == false {
        return Ok(false);
    }
    if event.event.payload["planningReminder"] == true {
        return planning::event_current(db, event);
    }
    if event.event.kind == "planner-mood" {
        let instances = storage::instances(db)?;
        return Ok(event.event.payload["timerStates"]
            .as_array()
            .is_none_or(|timers| {
                timers.iter().all(|timer| {
                    instances.iter().any(|item| {
                        item.id == timer["id"]
                            && Some(item.revision) == timer["revision"].as_i64()
                    })
                })
            }));
    }
    if event.event.kind == "planner-anniversary" {
        let clock = storage::get(db, &event.instance_id)?;
        return Ok(clock.kind == "clock"
            && anniversary_current(&clock.data, &event.event.payload, Local::now().date_naive()));
    }
    if event.event.kind != "planner-reminder" {
        return Ok(true);
    }
    let instances = storage::instances(db)?;
    let Some(calendar) = instances.iter().find(|item| item.id == event.instance_id) else {
        return Ok(false);
    };
    if !settings(&calendar.data)?.character_enabled {
        return Ok(false);
    }
    let todo = instances
        .iter()
        .find(|item| item.kind == "todo")
        .map(|item| &item.data);
    let current = targets(
        &calendar.data,
        todo,
        &settings(&calendar.data)?,
        chrono::Utc::now().timestamp_millis(),
    );
    if event.event.payload["mixedPlanningReminder"] == true {
        let mut focus_event = event.clone();
        let focus_targets = event.event.payload["targets"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|target| target["kind"] == "focus-event")
            .cloned()
            .collect::<Vec<_>>();
        focus_event.event.payload["targets"] = json!(focus_targets);
        if !planning::event_current(db, &focus_event)? {
            return Ok(false);
        }
    }
    Ok(event.event.payload["targets"]
        .as_array()
        .is_some_and(|old| !old.is_empty() && old.iter().all(|target| {
            (event.event.payload["mixedPlanningReminder"] == true && target["kind"] == "focus-event")
                || current.contains(target)
        })))
}

pub(crate) fn focus_start_greeting(calendar: &super::WidgetInstance, timer: &super::WidgetInstance) -> Result<Option<EventDraft>, String> {
    let settings = settings(&calendar.data)?;
    if !settings.character_enabled || !settings.mood_focus_start
        || timer.kind != "focus-timer" || timer.data["status"] != "running" || timer.data["mode"] != "focus" {
        return Ok(None);
    }
    Ok(Some(EventDraft {
        kind: "planner-mood".into(),
        text: "집중 시간을 시작했어요. 지금 고른 일부터 천천히 해 봐요.".into(),
        payload: json!({"focusStart":true,"timerStates":[{"id":timer.id,"revision":timer.revision}]}),
    }))
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
        let line = if marker == -1 && previous.is_some_and(|at| at > 0) && settings.mood_break
            && timer.data["settings"]["finishNotification"] != "os" {
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

#[cfg(test)]
pub fn advance(
    db: &Connection,
    clocks: &mut BTreeMap<String, i64>,
    now: i64,
    quiet: bool,
) -> Result<Advance, String> {
    let mut calendar_clocks = clocks.clone();
    advance_with_presence(db, clocks, &mut calendar_clocks, now, quiet, &[], true)
}

pub fn advance_with_presence(
    db: &Connection,
    clocks: &mut BTreeMap<String, i64>,
    calendar_clocks: &mut BTreeMap<String, i64>,
    now: i64,
    quiet: bool,
    present: &[String],
    anniversary_allowed: bool,
) -> Result<Advance, String> {
    let local = Local
        .timestamp_millis_opt(now)
        .single()
        .ok_or("알림 시각이 올바르지 않아요.")?;
    let instances = storage::instances(db)?;
    let todo = instances
        .iter()
        .find(|item| item.kind == "todo")
        .map(|item| &item.data);
    let timers: Vec<_> = instances
        .iter()
        .filter(|item| item.kind == "focus-timer")
        .cloned()
        .collect();
    let mut result = Advance {
        changed: false,
        os: planning::focus_completions(db, clocks, now)?,
    };
    for instance in instances
        .iter()
        .filter(|instance| instance.kind == "calendar")
    {
        let previous = clocks.insert(instance.id.clone(), now);
        let calendar_previous = calendar_clocks.insert(instance.id.clone(), now);
        let settings = settings(&instance.data)?;
        let continuous = previous.is_some_and(|after| now >= after && now - after <= 120_000);
        let allowed = continuous;
        let mut mood = timer_moods(
            clocks,
            &instance.id,
            &timers,
            now,
            allowed && !quiet,
            &settings,
        );
        if calendar_previous.is_none_or(|after| now < after) {
            continue;
        }
        let calendar_previous = calendar_previous.unwrap_or(now);
        let previous = previous.unwrap_or(now);
        let calendar_continuous = now - calendar_previous <= 120_000;
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
            if !quiet
                && enabled
                && local_date_time(&date, time).is_some_and(|at| crossed(previous, now, at))
            {
                let key = format!("{}:{kind}", instance.id);
                let day = local_date_time(&date, "12:00").unwrap_or(now);
                if clocks.get(&key) != Some(&day) {
                    clocks.insert(key, day);
                    mood.push(line);
                }
            }
        }
        let due = due_targets_at(&instance.data, todo, calendar_previous, now, !calendar_continuous)?;
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
                    payload: json!({"targets":due,"calendarCatchUp":!calendar_continuous}),
                });
            }
            if settings.os_enabled {
                let todo_only = due.iter().all(|target| target["kind"] == "todo");
                let single = (due.len() == 1).then(|| &due[0]);
                let entity = single.and_then(|target| match target["kind"].as_str() {
                    Some("calendar") => Some("event".to_string()),
                    Some("todo") => Some("todo".to_string()),
                    _ => None,
                });
                let id = single.and_then(|target| target["id"].as_str().map(str::to_string));
                result.os.push(Delivery {
                    instance_id: instance.id.clone(),
                    text,
                    sound_enabled: settings.sound_enabled,
                    widget: false,
                    notification_key: "calendar".into(),
                    fallback: None,
                    additional_fallbacks: vec![],
                    fallback_timers: vec![],
                    grouped: false,
                    destination: Some((if todo_only { "todos" } else { "calendar" }.into(), entity, id)),
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
        let focus_notices = planning::focus_due(
            instance,
            &timers,
            (calendar_previous, now, !calendar_continuous),
            &due,
            &mut drafts,
            &mut result.os,
        );
        if !focus_notices.is_empty() {
            let mut notice_targets = due.clone();
            let mut notice_text = data["alertState"]["lastNotification"]["text"]
                .as_str().filter(|_| !due.is_empty()).unwrap_or_default().to_string();
            for (target, text) in focus_notices {
                if !notice_text.is_empty() {
                    notice_text.push('\n');
                }
                notice_text.push_str(&text);
                notice_targets.push(target);
            }
            data["alertState"]["lastNotification"] =
                json!({"text":notice_text,"targets":notice_targets,"observedAt":now});
            data["alertState"]["snoozeAt"] = Value::Null;
        }
        if data != instance.data || !drafts.is_empty() {
            storage::commit_data(db, &instance.id, instance.revision, data, drafts, now)?;
            result.changed = true;
        }
    }
    if anniversary_allowed && !quiet && (8..12).contains(&local.hour()) {
        let pending: bool = db.query_row(
            "SELECT EXISTS(SELECT 1 FROM widget_events WHERE pending=1 AND json_extract(data,'$.kind')='planner-anniversary')",
            [], |row| row.get(0),
        ).map_err(|error| error.to_string())?;
        for instance in instances
            .iter()
            .filter(|item| item.kind == "clock")
        {
            if pending || !storage::reaction_enabled(db, &instance.id)? {
                continue;
            }
            let (data, drafts) = anniversary_greetings(&instance.data, local.date_naive());
            if let Some(draft) = drafts.into_iter().next() {
                let attempt_key = format!("anniversary:{}:{}", instance.id, draft.payload["anniversaryId"]);
                if clocks.get(&attempt_key).is_some_and(|at| now >= *at && now - *at < ANNIVERSARY_RETRY_MILLIS) {
                    continue;
                }
                storage::commit_data_with_presence(
                    db,
                    &instance.id,
                    instance.revision,
                    data,
                    vec![draft],
                    now,
                    present,
                )?;
                clocks.insert(attempt_key, now);
                result.changed = true;
                break;
            }
        }
    }
    let preparation = planning::advance_preparation(db, &instances, clocks, now)?;
    result.changed |= preparation.changed;
    result.os.extend(preparation.os);
    planning::attach_focus_fallbacks(db, &mut result.os, now)?;
    Ok(result)
}

fn anniversary_greetings(data: &Value, today: NaiveDate) -> (Value, Vec<EventDraft>) {
    let mut next = data.clone();
    let mut drafts = vec![];
    let Some(items) = next["anniversaries"].as_array_mut() else {
        return (next, drafts);
    };
    for item in items {
        if item["celebrate"] != true
            || item["lastCelebrated"].as_str() == Some(today.to_string().as_str())
        {
            continue;
        }
        let Some(date) = item["date"]
            .as_str()
            .and_then(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").ok())
        else {
            continue;
        };
        let recurring = item["repeat"] == "yearly" || item["countMode"] == "anniversary";
        let target = if recurring {
            NaiveDate::from_ymd_opt(today.year(), date.month(), date.day())
                .or_else(|| NaiveDate::from_ymd_opt(today.year(), date.month(), 28))
        } else {
            Some(date)
        };
        if target != Some(today) || today < date {
            continue;
        }
        let title = item["title"].as_str().unwrap_or("기념일").to_string();
        drafts.push(EventDraft { kind: "planner-anniversary".into(), text: format!("오늘은 {title}이에요. 함께 축하해요!"), payload: json!({"anniversaryId":item["id"],"date":today.to_string(),"title":title,"originalDate":item["date"],"repeat":item["repeat"].as_str().unwrap_or("none"),"countMode":item["countMode"].as_str().unwrap_or("remaining")}) });
        break;
    }
    (next, drafts)
}

fn anniversary_current(data: &Value, payload: &Value, today: NaiveDate) -> bool {
    let day = today.to_string();
    payload["date"].as_str() == Some(day.as_str())
        && data["anniversaries"].as_array().is_some_and(|items| {
            items.iter().any(|item| {
                item["id"] == payload["anniversaryId"]
                    && item["celebrate"] == true
                    && item["title"] == payload["title"]
                    && item["date"] == payload["originalDate"]
                    && item["repeat"].as_str().unwrap_or("none")
                        == payload["repeat"].as_str().unwrap_or("")
                    && item["countMode"].as_str().unwrap_or("remaining")
                        == payload["countMode"].as_str().unwrap_or("")
            })
        })
}

pub(crate) fn mark_anniversary_displayed(db: &Connection, event: &super::WidgetEvent) -> Result<(), String> {
    if event.event.kind != "planner-anniversary" {
        return Ok(());
    }
    let clock = storage::get(db, &event.instance_id)?;
    let today = Local::now().date_naive();
    if clock.kind != "clock" || !anniversary_current(&clock.data, &event.event.payload, today) {
        return Ok(());
    }
    if clock.data["anniversaries"].as_array().is_some_and(|items| items.iter().any(|item| item["id"] == event.event.payload["anniversaryId"] && item["lastCelebrated"].as_str() == Some(today.to_string().as_str()))) {
        return Ok(());
    }
    let mut data = clock.data;
    if let Some(item) = data["anniversaries"].as_array_mut().and_then(|items| items.iter_mut().find(|item| item["id"] == event.event.payload["anniversaryId"])) {
        item["lastCelebrated"] = json!(today.to_string());
        db.execute("UPDATE widget_instances SET data=?1 WHERE id=?2 AND revision=?3", rusqlite::params![data.to_string(), clock.id, clock.revision]).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod anniversary_tests {
    use super::*;
    #[test]
    fn anniversary_is_recorded_only_after_the_greeting_is_displayed() {
        let db = Connection::open_in_memory().unwrap();
        storage::initialize(&db).unwrap();
        let temp = tempfile::tempdir().unwrap();
        storage::verify_packages(&db, temp.path()).unwrap();
        let clock = storage::instances(&db).unwrap().into_iter().find(|item| item.kind == "clock").unwrap();
        let today = Local::now().date_naive();
        let data = json!({"anniversaries":[{"id":"a","title":"기념일","date":today.to_string(),"celebrate":true}]});
        let (_, drafts) = anniversary_greetings(&data, today);
        storage::commit_data(&db, &clock.id, clock.revision, data, drafts, chrono::Utc::now().timestamp_millis()).unwrap();
        let event = storage::take_reaction(&db, chrono::Utc::now().timestamp_millis()).unwrap().unwrap();
        assert!(storage::get(&db, &clock.id).unwrap().data["anniversaries"][0]["lastCelebrated"].is_null());
        mark_anniversary_displayed(&db, &event).unwrap();
        let saved = storage::get(&db, &clock.id).unwrap();
        assert_eq!(saved.data["anniversaries"][0]["lastCelebrated"], today.to_string());
        assert!(anniversary_greetings(&saved.data, today).1.is_empty());
        assert!(anniversary_current(&saved.data, &event.event.payload, today));
    }
    #[test]
    fn anniversary_waits_until_its_creation_is_allowed() {
        let db = Connection::open_in_memory().unwrap();
        storage::initialize(&db).unwrap();
        let temp = tempfile::tempdir().unwrap();
        storage::verify_packages(&db, temp.path()).unwrap();
        let clock = storage::instances(&db).unwrap().into_iter().find(|item| item.kind == "clock").unwrap();
        let today = Local::now().date_naive();
        let now = local_date_time(&today.to_string(), "09:00").unwrap();
        let mut data = clock.data.clone();
        data["anniversaries"] = json!([{"id":"a","title":"기념일","date":today.to_string(),"celebrate":true}]);
        storage::commit_data(&db, &clock.id, clock.revision, data, vec![], now - 1000).unwrap();
        let mut clocks = BTreeMap::new();
        let mut calendar_clocks = BTreeMap::new();
        advance_with_presence(&db, &mut clocks, &mut calendar_clocks, now, false, &[], false).unwrap();
        assert!(storage::take_reaction(&db, now).unwrap().is_none());
        advance_with_presence(&db, &mut clocks, &mut calendar_clocks, now + 1000, false, &[], true).unwrap();
        assert_eq!(storage::take_reaction(&db, now + 1000).unwrap().unwrap().event.kind, "planner-anniversary");
        assert!(storage::get(&db, &clock.id).unwrap().data["anniversaries"][0]["lastCelebrated"].is_null());
    }
    #[test]
    fn absent_or_sleeping_fallback_speaker_does_not_create_anniversary_events() {
        let db = Connection::open_in_memory().unwrap();
        storage::initialize(&db).unwrap();
        let temp = tempfile::tempdir().unwrap();
        storage::verify_packages(&db, temp.path()).unwrap();
        let clock = storage::instances(&db).unwrap().into_iter().find(|item| item.kind == "clock").unwrap();
        let today = Local::now().date_naive();
        let now = local_date_time(&today.to_string(), "09:00").unwrap();
        let mut data = clock.data.clone();
        data["anniversaries"] = json!([{"id":"a","title":"기념일","date":today.to_string(),"celebrate":true}]);
        storage::commit_data(&db, &clock.id, clock.revision, data, vec![], now - 1000).unwrap();
        let revision = storage::get(&db, &clock.id).unwrap().revision;
        let active = vec!["first".to_string(), "second".to_string()];
        let mut clocks = BTreeMap::new();
        let mut calendar_clocks = BTreeMap::new();
        for (index, (present, sleeping)) in [
            (vec!["second".to_string()], vec![]),
            (active.clone(), vec!["first".to_string()]),
            (vec![], vec![]),
        ].into_iter().enumerate() {
            let allowed = anniversary_speaker_available(&active, &present, &sleeping);
            assert!(!allowed);
            advance_with_presence(&db, &mut clocks, &mut calendar_clocks, now + index as i64 * 3000, false, &present, allowed).unwrap();
        }
        assert_eq!(storage::get(&db, &clock.id).unwrap().revision, revision);
        let count: i64 = db.query_row("SELECT COUNT(*) FROM widget_events WHERE instance_id=?1", [&clock.id], |row| row.get(0)).unwrap();
        assert_eq!(count, 0);
    }
    #[test]
    fn failed_anniversary_retry_is_throttled_and_not_journaled_twice() {
        let db = Connection::open_in_memory().unwrap();
        storage::initialize(&db).unwrap();
        let temp = tempfile::tempdir().unwrap();
        storage::verify_packages(&db, temp.path()).unwrap();
        let clock = storage::instances(&db).unwrap().into_iter().find(|item| item.kind == "clock").unwrap();
        let today = Local::now().date_naive();
        let now = local_date_time(&today.to_string(), "09:00").unwrap();
        let mut data = clock.data.clone();
        data["anniversaries"] = json!([{"id":"a","title":"기념일","date":today.to_string(),"celebrate":true}]);
        storage::commit_data(&db, &clock.id, clock.revision, data, vec![], now - 1000).unwrap();
        let mut clocks = BTreeMap::new();
        let mut calendar_clocks = BTreeMap::new();
        advance_with_presence(&db, &mut clocks, &mut calendar_clocks, now, false, &[], true).unwrap();
        storage::take_reaction(&db, now).unwrap().unwrap();
        let revision = storage::get(&db, &clock.id).unwrap().revision;
        advance_with_presence(&db, &mut clocks, &mut calendar_clocks, now + 3000, false, &[], true).unwrap();
        assert_eq!(storage::get(&db, &clock.id).unwrap().revision, revision);
        assert!(storage::take_reaction(&db, now + 3000).unwrap().is_none());
        advance_with_presence(&db, &mut clocks, &mut calendar_clocks, now + ANNIVERSARY_RETRY_MILLIS, false, &[], true).unwrap();
        assert!(storage::take_reaction(&db, now + ANNIVERSARY_RETRY_MILLIS).unwrap().is_some());
        let count: i64 = db.query_row("SELECT COUNT(*) FROM widget_journal j JOIN widget_events e ON e.id=j.event_id WHERE e.instance_id=?1", [&clock.id], |row| row.get(0)).unwrap();
        assert_eq!(count, 1);
    }
    #[test]
    fn multiple_anniversaries_are_journaled_once_and_next_is_not_throttled() {
        let db = Connection::open_in_memory().unwrap();
        storage::initialize(&db).unwrap();
        let temp = tempfile::tempdir().unwrap();
        storage::verify_packages(&db, temp.path()).unwrap();
        let clock = storage::instances(&db).unwrap().into_iter().find(|item| item.kind == "clock").unwrap();
        let today = Local::now().date_naive();
        let now = local_date_time(&today.to_string(), "09:00").unwrap();
        let mut data = clock.data.clone();
        data["anniversaries"] = json!([
            {"id":"a","title":"첫 번째","date":today.to_string(),"celebrate":true},
            {"id":"b","title":"두 번째","date":today.to_string(),"celebrate":true}
        ]);
        storage::commit_data(&db, &clock.id, clock.revision, data, vec![], now - 1000).unwrap();
        let mut clocks = BTreeMap::new();
        let mut calendar_clocks = BTreeMap::new();
        for (index, id) in ["a", "b"].into_iter().enumerate() {
            let at = now + index as i64 * 3000;
            advance_with_presence(&db, &mut clocks, &mut calendar_clocks, at, false, &[], true).unwrap();
            let event = storage::take_reaction(&db, at).unwrap().unwrap();
            assert_eq!(event.event.payload["anniversaryId"], id);
            mark_anniversary_displayed(&db, &event).unwrap();
        }
        advance_with_presence(&db, &mut clocks, &mut calendar_clocks, now + 6000, false, &[], true).unwrap();
        assert!(storage::take_reaction(&db, now + 6000).unwrap().is_none());
        let count: i64 = db.query_row("SELECT COUNT(*) FROM widget_journal j JOIN widget_events e ON e.id=j.event_id WHERE e.instance_id=?1", [&clock.id], |row| row.get(0)).unwrap();
        assert_eq!(count, 2);
    }
    #[test]
    fn queued_greeting_revalidates_original_date_repeat_mode_and_delivery_day() {
        let today = NaiveDate::from_ymd_opt(2026, 10, 15).unwrap();
        let data = json!({"anniversaries":[{"id":"a","title":"기념일","date":"2024-10-15","repeat":"yearly","celebrate":true}]});
        let (next, events) = anniversary_greetings(&data, today);
        let payload = &events[0].payload;
        assert!(anniversary_current(&next, payload, today));
        for (key, value) in [
            ("date", json!("2025-10-15")),
            ("repeat", json!("none")),
            ("countMode", json!("anniversary")),
            ("title", json!("수정한 제목")),
            ("celebrate", json!(false)),
        ] {
            let mut edited = next.clone();
            edited["anniversaries"][0][key] = value;
            assert!(!anniversary_current(&edited, payload, today), "{key}");
        }
        assert!(!anniversary_current(
            &next,
            payload,
            today.succ_opt().unwrap()
        ));
        let mut old_payload = payload.clone();
        old_payload.as_object_mut().unwrap().remove("originalDate");
        assert!(!anniversary_current(&next, &old_payload, today));
        let mut unrelated = next;
        unrelated["showSeconds"] = json!(true);
        assert!(anniversary_current(&unrelated, payload, today));
    }
    #[test]
    fn anniversary_mode_repeats_but_one_off_and_future_dates_do_not() {
        let today = NaiveDate::from_ymd_opt(2026, 10, 15).unwrap();
        let data = json!({"anniversaries":[
            {"id":"anniversary","title":"매년","date":"2024-10-15","countMode":"anniversary","celebrate":true},
            {"id":"one-off","title":"한 번","date":"2024-10-15","countMode":"remaining","celebrate":true},
            {"id":"future","title":"미래","date":"2027-10-15","repeat":"yearly","celebrate":true}
        ]});
        let (next, events) = anniversary_greetings(&data, today);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].payload["anniversaryId"], "anniversary");
        assert!(anniversary_current(&next, &events[0].payload, today));
        assert_eq!(anniversary_greetings(&next, today).1.len(), 1);
    }
    #[test]
    fn greetings_preserve_text_and_repeat_once_each_anniversary() {
        let data = json!({"anniversaries":[{"id":"a","title":" 엄마 생신 ","date":"2024-02-29","repeat":"yearly","celebrate":true},{"id":"b","title":"꺼진 축하","date":"2025-02-28","celebrate":false}],"format":"12h"});
        let today = NaiveDate::from_ymd_opt(2025, 2, 28).unwrap();
        let (next, events) = anniversary_greetings(&data, today);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].payload["title"], " 엄마 생신 ");
        assert_eq!(next["format"], data["format"]);
        assert_eq!(anniversary_greetings(&next, today).1.len(), 1);
        assert_eq!(
            anniversary_greetings(&next, NaiveDate::from_ymd_opt(2026, 2, 28).unwrap())
                .1
                .len(),
            1
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn overflow_keeps_timer_and_preparation_notices_in_the_banner() {
        let db = Connection::open_in_memory().unwrap();
        storage::initialize(&db).unwrap();
        let temp = tempfile::tempdir().unwrap();
        storage::verify_packages(&db, temp.path()).unwrap();
        let calendar = storage::instances(&db).unwrap().into_iter().find(|item| item.kind == "calendar").unwrap();
        let make = |kind: &str, text: &str, targets: Value| super::super::WidgetEvent {
            id: text.into(), instance_id: calendar.id.clone(), widget_kind: "calendar".into(),
            revision: calendar.revision, created_at: 1_000, expires_at: 31_000,
            event: EventDraft { kind: kind.into(), text: text.into(), payload: json!({"targets":targets}) },
        };
        let target = json!({"kind":"preparation","id":"bag","title":"준비"});
        record_overflow(&db, &[make("timer-finished", "집중 종료", json!([])), make("planner-reminder", "준비 알림", json!([target.clone()]))], 2_000).unwrap();
        let saved = storage::get(&db, &calendar.id).unwrap();
        assert_eq!(saved.revision, calendar.revision);
        assert!(saved.data["alertState"]["lastNotification"]["text"].as_str().unwrap().contains("집중 종료"));
        assert!(saved.data["alertState"]["lastNotification"]["text"].as_str().unwrap().contains("준비 알림"));
        assert_eq!(saved.data["alertState"]["lastNotification"]["targets"][0], target);
    }
    fn data() -> Value {
        json!({"reminders":{"enabled":true,"leadMinutes":10,"includeAllDay":false},
        "connections":[{"id":"c","status":"ready","lastSuccessAt":1_000_000}],
        "events":[{"id":"one","connectionId":"c","title":"회의","startAt":1_600_000,"allDay":false,"cancelled":false}]})
    }
    #[test]
    fn alerts_cross_once_and_skip_catchup_stale_and_cancelled() {
        let value = data();
        assert_eq!(
            due_targets(&value, None, 999_500, 1_000_000).unwrap().len(),
            1
        );
        for (after, now) in [(1_000_000, 1_000_500), (800_000, 1_000_000)] {
            assert!(due_targets(&value, None, after, now).unwrap().is_empty());
        }
        let mut cancelled = value;
        cancelled["events"][0]["cancelled"] = json!(true);
        assert!(due_targets(&cancelled, None, 999_500, 1_000_000)
            .unwrap()
            .is_empty());
    }
    #[test]
    fn offline_calendar_uses_a_24_hour_freshness_limit() {
        let now = 100_000_000;
        let mut value = data();
        value["events"][0]["startAt"] = json!(now + 600_000);
        value["connections"][0]["status"] = json!("offline");
        for (age, expected) in [(24 * 60 * 60 * 1000, 1), (24 * 60 * 60 * 1000 + 1, 0)] {
            value["connections"][0]["lastSuccessAt"] = json!(now - age);
            assert_eq!(due_targets(&value, None, now - 1, now).unwrap().len(), expected);
        }
        for status in ["auth-error", "permission-needed", "unsupported"] {
            value["connections"][0]["status"] = json!(status);
            value["connections"][0]["lastSuccessAt"] = json!(now);
            assert!(due_targets(&value, None, now - 1, now).unwrap().is_empty());
        }
    }

    #[test]
    fn clear_notification_error_preserves_other_alert_state() {
        let mut value = data();
        value["alertState"] = json!({"lastDeliveryError":"오류", "permission":"denied"});
        let updated = act(&value, "clear-notification-error", &json!({}), 1_000_000)
            .unwrap()
            .data;
        assert!(updated["alertState"]["lastDeliveryError"].is_null());
        assert_eq!(updated["alertState"]["permission"], "denied");
        assert_eq!(updated["events"], value["events"]);
    }

    #[test]
    fn resumed_external_calendar_uses_status_freshness_limits() {
        let now = 100_000_000;
        for (status, age, expected) in [
            ("ready", 30 * 60 * 1000, 1),
            ("ready", 30 * 60 * 1000 + 1, 0),
            ("syncing", 30 * 60 * 1000 + 1, 0),
            ("offline", 24 * 60 * 60 * 1000, 1),
            ("offline", 24 * 60 * 60 * 1000 + 1, 0),
        ] {
            let mut value = data();
            value["connections"][0]["status"] = json!(status);
            value["connections"][0]["lastSuccessAt"] = json!(now - age);
            value["events"][0]["startAt"] = json!(now + 300_000);
            assert_eq!(
                due_targets_at(&value, None, now - 2_400_000, now, true).unwrap().len(),
                expected,
                "{status}, age {age}"
            );
        }
    }

    #[test]
    fn resume_groups_only_events_that_have_not_started_and_does_not_repeat() {
        let db = Connection::open_in_memory().unwrap();
        storage::initialize(&db).unwrap();
        let directory = tempfile::tempdir().unwrap();
        storage::verify_packages(&db, directory.path()).unwrap();
        let calendar = storage::instances(&db).unwrap().into_iter().find(|item| item.kind == "calendar").unwrap();
        let now = 2_000_000;
        let mut value = data();
        value["reminders"]["osEnabled"] = json!(true);
        value["events"] = json!([
            {"id":"first","title":"첫 일정","connectionId":"local","startAt":now + 200_000},
            {"id":"second","title":"다음 일정","connectionId":"local","startAt":now + 300_000},
            {"id":"snoozed","title":"다시 알릴 일정","connectionId":"local","startAt":now + 50_000},
            {"id":"started","title":"지난 일정","connectionId":"local","startAt":now - 1},
            {"id":"future","title":"나중 일정","connectionId":"local","startAt":now + 900_000}
        ]);
        value["alertState"] = json!({
            "snoozeAt": now - 100_000,
            "lastNotification": {"targets": [
                {"kind":"calendar", "id":"snoozed", "title":"다시 알릴 일정", "at":now + 50_000},
                {"kind":"calendar", "id":"started", "title":"지난 일정", "at":now - 1}
            ]}
        });
        storage::commit_data(&db, &calendar.id, calendar.revision, value, vec![], now - 500_000).unwrap();
        let mut clocks = BTreeMap::new();
        let mut calendar_clocks = BTreeMap::new();
        assert!(advance_with_presence(&db, &mut clocks, &mut calendar_clocks, now - 500_000, false, &[], true).unwrap().os.is_empty());
        clocks.clear();
        let resumed = advance_with_presence(&db, &mut clocks, &mut calendar_clocks, now, false, &[], true).unwrap();
        assert_eq!(resumed.os.len(), 1);
        assert!(resumed.os[0].text.contains("첫 일정"));
        assert!(resumed.os[0].text.contains("다음 일정"));
        assert!(resumed.os[0].text.contains("다시 알릴 일정"));
        assert!(!resumed.os[0].text.contains("지난 일정"));
        assert!(!resumed.os[0].text.contains("나중 일정"));
        assert_eq!(storage::get(&db, &calendar.id).unwrap().data["alertState"]["lastNotification"]["targets"].as_array().unwrap().len(), 3);
        assert!(advance_with_presence(&db, &mut clocks, &mut calendar_clocks, now + 1_000, false, &[], true).unwrap().os.is_empty());
        assert!(advance_with_presence(&db, &mut BTreeMap::new(), &mut BTreeMap::new(), now, false, &[], true).unwrap().os.is_empty());
    }

    #[test]
    fn resumed_external_calendar_reminder_remains_current_for_bubble() {
        let db = Connection::open_in_memory().unwrap();
        storage::initialize(&db).unwrap();
        let directory = tempfile::tempdir().unwrap();
        storage::verify_packages(&db, directory.path()).unwrap();
        let calendar = storage::instances(&db).unwrap().into_iter().find(|item| item.kind == "calendar").unwrap();
        let now = chrono::Utc::now().timestamp_millis();
        let mut value = data();
        value["connections"][0]["status"] = json!("offline");
        value["connections"][0]["lastSuccessAt"] = json!(now - 2 * 60 * 60 * 1000);
        value["events"][0]["startAt"] = json!(now + 300_000);
        storage::commit_data(&db, &calendar.id, calendar.revision, value, vec![], now - 2_400_000).unwrap();
        let mut clocks = BTreeMap::new();
        let mut calendar_clocks = BTreeMap::new();
        advance_with_presence(&db, &mut clocks, &mut calendar_clocks, now - 2_400_000, false, &[], true).unwrap();
        clocks.clear();
        advance_with_presence(&db, &mut clocks, &mut calendar_clocks, now, false, &[], true).unwrap();
        let event = storage::take_reaction(&db, now).unwrap().unwrap();
        assert_eq!(event.event.kind, "planner-reminder");
        assert!(event_current(&db, &event).unwrap());
    }
    #[test]
    fn zero_and_advance_leads_fire_only_when_their_own_alert_time_is_crossed() {
        let start = 1_600_000;
        for lead in [0, 10] {
            let mut value = data();
            value["reminders"]["leadMinutes"] = json!(lead);
            let at = start - lead * 60_000;
            assert!(due_targets(&value, None, at - 2_000, at - 1)
                .unwrap()
                .is_empty());
            let due = due_targets(&value, None, at - 1, at).unwrap();
            assert_eq!(due.len(), 1, "lead {lead}");
            assert_eq!(due[0]["title"], "회의");
            assert!(due_targets(&value, None, at, at + 1_000)
                .unwrap()
                .is_empty());
        }
    }
    #[test]
    fn local_calendar_alerts_work_offline_and_honor_existing_preferences() {
        let mut value = data();
        value["connections"] = json!([]);
        value["events"][0]["connectionId"] = json!("local");
        assert_eq!(
            due_targets(&value, None, 999_500, 1_000_000).unwrap().len(),
            1
        );
        assert!(due_targets(&value, None, 800_000, 1_000_000)
            .unwrap()
            .is_empty());
        value["reminders"]["enabled"] = json!(false);
        assert!(due_targets(&value, None, 999_500, 1_000_000)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn local_tasks_work_offline_and_snooze_never_changes_due_or_completed_tasks() {
        let mut value = data();
        value["connections"] = json!([]);
        let todo =
            json!({"items":[{"id":"task","title":"책 반납","dueAt":1_600_000,"completedAt":null}]});
        let due = due_targets(&value, Some(&todo), 999_500, 1_000_000).unwrap();
        assert_eq!(due.len(), 1);
        value["alertState"] = json!({"lastNotification":{"targets":due,"observedAt":1_000_000}});
        let snoozed = act(&value, "snooze-alert", &json!({}), 1_001_000)
            .unwrap()
            .data;
        assert_eq!(snoozed["alertState"]["snoozeAt"], 1_601_000);
        assert_eq!(
            due_targets(&snoozed, Some(&todo), 1_600_000, 1_601_000)
                .unwrap()
                .len(),
            1
        );
        let mut changed = todo.clone();
        changed["items"][0]["dueAt"] = json!(2_600_000);
        assert!(due_targets(&snoozed, Some(&changed), 1_600_000, 1_601_000)
            .unwrap()
            .is_empty());
        changed = todo.clone();
        changed["items"][0]["completedAt"] = json!(1_100_000);
        assert!(due_targets(&snoozed, Some(&changed), 1_600_000, 1_601_000)
            .unwrap()
            .is_empty());
        assert_eq!(todo["items"][0]["dueAt"], 1_600_000);
    }
    #[test]
    fn all_day_tasks_use_local_nine_and_remain_opt_in() {
        let mut value = data();
        value["connections"] = json!([]);
        let todo = json!({"items":[{"id":"day","title":"정리","dueDate":"2026-09-21","completedAt":null}]});
        let threshold = local_date_time("2026-09-21", "08:50").unwrap();
        assert!(
            due_targets(&value, Some(&todo), threshold - 1000, threshold)
                .unwrap()
                .is_empty()
        );
        value["reminders"]["includeAllDay"] = json!(true);
        assert_eq!(
            due_targets(&value, Some(&todo), threshold - 1000, threshold)
                .unwrap()
                .len(),
            1
        );
        value["reminders"]["characterEnabled"] = json!(false);
        assert_eq!(
            due_targets(&value, Some(&todo), threshold - 1000, threshold)
                .unwrap()
                .len(),
            1
        );
    }
    #[test]
    fn mood_observes_transitions_and_cooldown_without_replaying_a_restored_timer() {
        let db = Connection::open_in_memory().unwrap();
        storage::initialize(&db).unwrap();
        let temp = tempfile::tempdir().unwrap();
        storage::verify_packages(&db, temp.path()).unwrap();
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
        assert!(
            timer_moods(
                &mut clocks,
                "calendar",
                &[timer.clone()],
                2_100_001,
                true,
                &settings
            )
            .is_empty()
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
    fn focus_start_greeting_follows_calendar_setting_and_break_respects_channel() {
        let db = Connection::open_in_memory().unwrap();
        storage::initialize(&db).unwrap();
        let temp = tempfile::tempdir().unwrap();
        storage::verify_packages(&db, temp.path()).unwrap();
        let instances = storage::instances(&db).unwrap();
        let mut calendar = instances.iter().find(|item| item.kind == "calendar").unwrap().clone();
        let mut timer = instances.iter().find(|item| item.kind == "focus-timer").unwrap().clone();
        calendar.data["reminders"]["moodFocusStart"] = json!(true);
        timer.data["status"] = json!("running");
        timer.data["mode"] = json!("focus");
        assert!(focus_start_greeting(&calendar, &timer).unwrap().is_some());
        calendar.data["reminders"]["moodFocusStart"] = json!(false);
        assert!(focus_start_greeting(&calendar, &timer).unwrap().is_none());
        let settings = ReminderSettings { mood_break: true, ..ReminderSettings::default() };
        for channel in ["bubble", "both", "os"] {
            let mut clocks = BTreeMap::new();
            timer.data["settings"]["finishNotification"] = json!(channel);
            timer.data["status"] = json!("running");
            timer.data["deadline"] = json!(60_000);
            timer_moods(&mut clocks, "calendar", &[timer.clone()], 1_000, true, &settings);
            timer.data["status"] = json!("finished");
            assert_eq!(!timer_moods(&mut clocks, "calendar", &[timer.clone()], 60_000, true, &settings).is_empty(), channel != "os");
        }
    }
    #[test]
    fn configuration_preserves_calendar_and_old_opt_in_and_validates_bounds() {
        assert!(settings(&data()).unwrap().character_enabled);
        assert!(!settings(&data()).unwrap().os_enabled);
        assert!(!settings(&data()).unwrap().sound_enabled);
        let updated = configure(&data(), &initial()).unwrap();
        assert_eq!(updated["events"], data()["events"]);
        assert_eq!(updated["reminders"]["soundEnabled"], false);
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
        storage::verify_packages(&db, temp.path()).unwrap();
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
        storage::verify_packages(&db, temp.path()).unwrap();
        let calendar = storage::instances(&db)
            .unwrap()
            .into_iter()
            .find(|i| i.kind == "calendar")
            .unwrap();
        let mut value = data();
        value["reminders"]["characterEnabled"] = json!(false);
        value["reminders"]["osEnabled"] = json!(true);
        storage::commit_data(&db, &calendar.id, calendar.revision, value, vec![], 999_000).unwrap();
        let mut clocks = BTreeMap::new();
        assert!(!advance(&db, &mut clocks, 999_500, false).unwrap().changed);
        let result = advance(&db, &mut clocks, 1_000_000, false).unwrap();
        assert_eq!(result.os.len(), 1);
        assert!(!result.os[0].sound_enabled);
        assert!(storage::take_reaction(&db, 1_000_001).unwrap().is_none());
        assert!(advance(&db, &mut BTreeMap::new(), 1_000_000, false)
            .unwrap()
            .os
            .is_empty());
        assert!(advance(&db, &mut clocks, 1_000_001, false)
            .unwrap()
            .os
            .is_empty());
    }

    #[test]
    fn zero_lead_delivers_after_start_once_without_restart_replay() {
        let db = Connection::open_in_memory().unwrap();
        storage::initialize(&db).unwrap();
        let directory = tempfile::tempdir().unwrap();
        storage::verify_packages(&db, directory.path()).unwrap();
        let calendar = storage::instances(&db).unwrap().into_iter().find(|item| item.kind == "calendar").unwrap();
        let starts = 1_600_000;
        let mut value = data();
        value["events"][0]["connectionId"] = json!("local");
        value["reminders"]["leadMinutes"] = json!(0);
        value["reminders"]["characterEnabled"] = json!(false);
        value["reminders"]["osEnabled"] = json!(true);
        value["reminders"]["soundEnabled"] = json!(true);
        storage::commit_data(
            &db,
            &calendar.id,
            calendar.revision,
            value,
            vec![],
            starts - 1000,
        )
        .unwrap();
        let mut clocks = BTreeMap::new();
        assert!(advance(&db, &mut clocks, starts - 500, false)
            .unwrap()
            .os
            .is_empty());
        let result = advance(&db, &mut clocks, starts + 500, false).unwrap();
        assert_eq!(result.os.len(), 1);
        assert!(result.os[0].sound_enabled);
        let saved = storage::get(&db, &calendar.id).unwrap();
        assert_eq!(
            saved.data["alertState"]["lastNotification"]["observedAt"],
            starts + 500
        );
        assert_eq!(saved.data["events"][0]["startAt"], starts);
        assert!(storage::take_reaction(&db, starts + 500).unwrap().is_none());
        assert!(advance(&db, &mut clocks, starts + 1000, false)
            .unwrap()
            .os
            .is_empty());
        let mut restarted = BTreeMap::new();
        for now in [starts + 500, starts + 1000] {
            assert!(advance(&db, &mut restarted, now, false)
                .unwrap()
                .os
                .is_empty());
        }
    }

    #[test]
    fn zero_lead_does_not_deliver_when_reminders_are_disabled() {
        for reminders_enabled in [false] {
            let db = Connection::open_in_memory().unwrap();
            storage::initialize(&db).unwrap();
            let directory = tempfile::tempdir().unwrap();
            storage::verify_packages(&db, directory.path()).unwrap();
            let calendar = storage::instances(&db).unwrap().into_iter().find(|item| item.kind == "calendar").unwrap();
            let mut value = data();
            value["events"][0]["connectionId"] = json!("local");
            value["reminders"]["leadMinutes"] = json!(0);
            value["reminders"]["enabled"] = json!(reminders_enabled);
            value["reminders"]["osEnabled"] = json!(true);
            storage::commit_data(
                &db,
                &calendar.id,
                calendar.revision,
                value,
                vec![],
                1_599_000,
            )
            .unwrap();
            let mut clocks = BTreeMap::new();
            for now in [1_599_500, 1_600_500] {
                let result = advance(&db, &mut clocks, now, false).unwrap();
                assert!(result.os.is_empty());
                assert!(!result.changed);
            }
        }
    }

    #[test]
    fn positive_lead_still_skips_already_started_targets() {
        let mut value = data();
        value["events"][0]["connectionId"] = json!("local");
        value["reminders"]["leadMinutes"] = json!(1);
        assert!(crossed(1_539_500, 1_600_500, 1_540_000));
        assert!(due_targets(&value, None, 1_539_500, 1_600_500)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn shared_silence_skips_moods_without_catchup_but_delivers_important_alerts() {
        for quiet in [false, true] {
            let db = Connection::open_in_memory().unwrap();
            storage::initialize(&db).unwrap();
            let directory = tempfile::tempdir().unwrap();
            storage::verify_packages(&db, directory.path()).unwrap();
            let calendar = storage::instances(&db).unwrap().into_iter().find(|item| item.kind == "calendar").unwrap();
            let now = local_date_time("2026-09-28", "09:00").unwrap();
            let mut value = calendar.data.clone();
            value["reminders"]["moodDayStart"] = json!(true);
            storage::commit_data(
                &db,
                &calendar.id,
                calendar.revision,
                value,
                vec![],
                now - 1000,
            )
            .unwrap();
            let mut clocks = BTreeMap::new();
            advance(&db, &mut clocks, now - 500, quiet).unwrap();
            advance(&db, &mut clocks, now, quiet).unwrap();
            let mood = storage::take_reaction(&db, now).unwrap();
            assert_eq!(mood.is_some(), !quiet);
            advance(&db, &mut clocks, now + 500, false).unwrap();
            assert!(storage::take_reaction(&db, now + 500).unwrap().is_none());

            let calendar = storage::get(&db, &calendar.id).unwrap();
            let mut value = calendar.data;
            value["reminders"]["enabled"] = json!(true);
            value["reminders"]["osEnabled"] = json!(true);
            value["events"] = json!([{"id":"local","connectionId":"local","title":"회의","startAt":now + 601_000,"allDay":false}]);
            storage::commit_data(
                &db,
                &calendar.id,
                calendar.revision,
                value,
                vec![],
                now + 500,
            )
            .unwrap();
            let delivered = advance(&db, &mut clocks, now + 1000, quiet).unwrap();
            assert_eq!(delivered.os.len(), 1);
            assert_eq!(
                storage::take_reaction(&db, now + 1000)
                    .unwrap()
                    .unwrap()
                    .event
                    .kind,
                "planner-reminder"
            );
            assert!(advance(&db, &mut clocks, now + 1500, false)
                .unwrap()
                .os
                .is_empty());
        }
    }

    #[test]
    fn banner_only_alerts_are_recorded_and_os_sound_remains_explicit() {
        for (os_enabled, sound_enabled) in [(false, false), (true, false), (true, true)] {
            let db = Connection::open_in_memory().unwrap();
            storage::initialize(&db).unwrap();
            let directory = tempfile::tempdir().unwrap();
            storage::verify_packages(&db, directory.path()).unwrap();
            let calendar = storage::instances(&db).unwrap().into_iter().find(|item| item.kind == "calendar").unwrap();
            let mut value = data();
            value["reminders"]["characterEnabled"] = json!(false);
            value["reminders"]["osEnabled"] = json!(os_enabled);
            value["reminders"]["soundEnabled"] = json!(sound_enabled);
            value["events"][0]["connectionId"] = json!("local");
            storage::commit_data(&db, &calendar.id, calendar.revision, value, vec![], 999_000)
                .unwrap();
            let mut clocks = BTreeMap::new();
            advance(&db, &mut clocks, 999_500, true).unwrap();
            let result = advance(&db, &mut clocks, 1_000_000, true).unwrap();
            assert!(result.changed);
            assert_eq!(result.os.len(), usize::from(os_enabled));
            if os_enabled {
                assert_eq!(result.os[0].sound_enabled, sound_enabled);
            }
            let saved = storage::get(&db, &calendar.id).unwrap();
            let last = &saved.data["alertState"]["lastNotification"];
            assert_eq!(last["observedAt"], 1_000_000);
            assert!(last["text"].as_str().unwrap().contains("회의"));
            assert_eq!(last["targets"].as_array().unwrap().len(), 1);
            assert!(storage::take_reaction(&db, 1_000_000).unwrap().is_none());
            assert!(advance(&db, &mut clocks, 1_000_500, false)
                .unwrap()
                .os
                .is_empty());
        }
    }
}
