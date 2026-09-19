use super::{storage, EventDraft};
use chrono::{Local, NaiveDate, NaiveTime, TimeZone, Timelike};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReminderSettings {
    pub enabled: bool,
    pub lead_minutes: u32,
    pub include_all_day: bool,
    pub quiet_start: String,
    pub quiet_end: String,
}

pub fn initial() -> Value {
    json!({"enabled":false,"leadMinutes":10,"includeAllDay":false,"quietStart":"22:00","quietEnd":"08:00"})
}

pub fn configure(data: &Value, input: &Value) -> Result<Value, String> {
    let settings: ReminderSettings =
        serde_json::from_value(input.clone()).map_err(|_| "알림 설정 형식이 올바르지 않아요.")?;
    if settings.lead_minutes > 120 {
        return Err("일정 알림은 0~120분 전으로 설정해 주세요.".into());
    }
    for time in [&settings.quiet_start, &settings.quiet_end] {
        NaiveTime::parse_from_str(time, "%H:%M")
            .map_err(|_| "조용한 시간은 시:분으로 입력해 주세요.")?;
    }
    let mut data = data.clone();
    data["reminders"] = serde_json::to_value(settings).map_err(|error| error.to_string())?;
    Ok(data)
}

fn due_events(data: &Value, after: i64, now: i64, local_minute: u32) -> Result<Vec<Value>, String> {
    let raw = data
        .get("reminders")
        .filter(|value| !value.is_null())
        .cloned()
        .unwrap_or_else(initial);
    let settings: ReminderSettings =
        serde_json::from_value(raw).map_err(|_| "일정 알림 설정을 읽지 못했어요.")?;
    if !settings.enabled || now < after || now - after > 120_000 {
        return Ok(vec![]);
    }
    let quiet = |value: &str| -> Result<u32, String> {
        let time = NaiveTime::parse_from_str(value, "%H:%M")
            .map_err(|_| "조용한 시간을 읽지 못했어요.")?;
        Ok(time.hour() * 60 + time.minute())
    };
    let start = quiet(&settings.quiet_start)?;
    let end = quiet(&settings.quiet_end)?;
    let quiet_now = if start < end {
        local_minute >= start && local_minute < end
    } else if start > end {
        local_minute >= start || local_minute < end
    } else {
        false
    };
    if quiet_now {
        return Ok(vec![]);
    }
    let connections = data["connections"].as_array().cloned().unwrap_or_default();
    let mut due = vec![];
    for event in data["events"].as_array().into_iter().flatten() {
        if event["cancelled"] == true {
            continue;
        }
        let fresh = connections.iter().any(|connection| {
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
                .and_then(|date| NaiveDate::parse_from_str(date, "%Y-%m-%d").ok())
                .and_then(|date| date.and_hms_opt(9, 0, 0))
                .and_then(|time| Local.from_local_datetime(&time).single())
                .map(|time| time.timestamp_millis())
        } else {
            event["startAt"].as_i64()
        };
        let Some(starts) = starts else {
            continue;
        };
        let threshold = starts.saturating_sub(i64::from(settings.lead_minutes) * 60_000);
        if threshold > after && threshold <= now && starts >= now {
            due.push(event.clone());
        }
    }
    Ok(due)
}

pub fn advance(
    db: &Connection,
    clocks: &mut BTreeMap<String, i64>,
    now: i64,
) -> Result<bool, String> {
    let local = Local
        .timestamp_millis_opt(now)
        .single()
        .ok_or("알림 시각이 올바르지 않아요.")?;
    let mut changed = false;
    for instance in storage::instances(db)?
        .into_iter()
        .filter(|instance| instance.kind == "calendar")
    {
        let previous = clocks.insert(instance.id.clone(), now);
        if !instance.installed || !instance.enabled {
            continue;
        }
        let Some(previous) = previous else {
            continue;
        };
        let events = due_events(
            &instance.data,
            previous,
            now,
            local.hour() * 60 + local.minute(),
        )?;
        if events.is_empty() {
            continue;
        }
        let titles = events
            .iter()
            .take(3)
            .filter_map(|event| event["title"].as_str())
            .collect::<Vec<_>>()
            .join(" · ");
        let suffix = if events.len() > 3 {
            format!(" 외 {}개", events.len() - 3)
        } else {
            String::new()
        };
        let draft = EventDraft {
            kind: "calendar-reminder".into(),
            text: format!("등록한 일정 시간이 가까워졌어요. {titles}{suffix}"),
            payload: json!({"eventIds":events.iter().map(|event|event["id"].clone()).collect::<Vec<_>>()}),
        };
        storage::commit_data(
            db,
            &instance.id,
            instance.revision,
            instance.data,
            vec![draft],
            now,
        )?;
        changed = true;
    }
    Ok(changed)
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
    fn alerts_cross_the_selected_time_once_and_skip_catchup_quiet_and_stale_data() {
        let value = data();
        assert_eq!(
            due_events(&value, 999_500, 1_000_000, 600).unwrap().len(),
            1
        );
        assert!(due_events(&value, 1_000_000, 1_000_500, 600)
            .unwrap()
            .is_empty());
        assert!(due_events(&value, 800_000, 1_000_000, 600)
            .unwrap()
            .is_empty());
        assert!(due_events(&value, 999_500, 1_000_000, 23 * 60)
            .unwrap()
            .is_empty());
        let mut offline = value.clone();
        offline["connections"][0]["status"] = json!("offline");
        assert!(due_events(&offline, 999_500, 1_000_000, 600)
            .unwrap()
            .is_empty());
        let mut cancelled = value;
        cancelled["events"][0]["cancelled"] = json!(true);
        assert!(due_events(&cancelled, 999_500, 1_000_000, 600)
            .unwrap()
            .is_empty());
    }
    #[test]
    fn configuration_preserves_calendar_data_and_validates_time_bounds() {
        let value = data();
        let updated = configure(&value, &initial()).unwrap();
        assert_eq!(updated["events"], value["events"]);
        assert_eq!(updated["reminders"]["enabled"], false);
        let mut settings = initial();
        settings["leadMinutes"] = json!(121);
        assert!(configure(&value, &settings).is_err());
    }
}
