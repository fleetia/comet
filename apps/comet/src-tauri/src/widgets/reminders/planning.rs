use super::{crossed, local_date_time, settings, targets, Advance, Delivery, ReminderSettings};
use crate::widgets::{storage, EventDraft, WidgetEvent, WidgetInstance};
use chrono::{Days, Local, TimeZone};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::collections::BTreeMap;

#[cfg(test)]
mod tests;

fn event_target(calendar: &WidgetInstance, id: &Value, now: i64) -> Option<Value> {
    targets(
        &calendar.data,
        None,
        &ReminderSettings {
            include_all_day: true,
            ..ReminderSettings::default()
        },
        now,
    )
    .into_iter()
    .find(|target| target["id"] == *id)
}

fn focus_target(timer: &WidgetInstance, calendar: &WidgetInstance, now: i64) -> Option<Value> {
    let lead = timer.data["settings"]["linkedEventLeadMinutes"]
        .as_i64()
        .filter(|minutes| (0..=120).contains(minutes))?;
    let reference = &timer.data["eventRef"];
    if reference["calendarWidgetId"] != calendar.id {
        return None;
    }
    let target = event_target(calendar, &reference["id"], now)?;
    let event = calendar.data["events"]
        .as_array()?
        .iter()
        .find(|event| event["id"] == reference["id"])?;
    for field in [
        "startAt",
        "endAt",
        "connectionId",
        "sourceId",
        "occurrenceId",
    ] {
        if !reference[field].is_null()
            && reference[field].as_str() != Some("")
            && reference[field] != event[field]
        {
            return None;
        }
    }
    Some(json!({
        "kind":"focus-event", "id":timer.id, "calendarWidgetId":calendar.id,
        "eventId":reference["id"], "title":target["title"], "at":target["at"], "timerRevision":timer.revision,
        "leadMinutes":lead
    }))
}

fn focus_channels(timer: &WidgetInstance) -> (bool, bool, bool) {
    let settings = &timer.data["settings"];
    let channel = settings["finishNotification"].as_str().unwrap_or("bubble");
    (
        channel != "os",
        matches!(channel, "os" | "both"),
        settings["finishSoundEnabled"] == true,
    )
}

pub(super) fn focus_completions(
    db: &Connection,
    clocks: &mut BTreeMap<String, i64>,
    now: i64,
) -> Result<Vec<Delivery>, String> {
    let Some(previous) = clocks.insert("focus-completions".into(), now) else {
        return Ok(vec![]);
    };
    if now < previous || now - previous > 120_000 {
        return Ok(vec![]);
    }
    let instances = storage::instances(db)?;
    let mut result = vec![];
    for (_, event) in storage::journal(db, None, previous, now.saturating_add(1))? {
        if event.event.kind != "timer-finished"
            || !event.event.payload["finishedAt"]
                .as_i64()
                .is_some_and(|at| crossed(previous, now, at))
        {
            continue;
        }
        let Some(timer) = instances.iter().find(|timer| {
            timer.kind == "focus-timer"
                && timer.id == event.instance_id
                && timer.revision == event.revision
        }) else {
            continue;
        };
        let (_, os, sound) = focus_channels(timer);
        if os {
            result.push(Delivery {
                instance_id: timer.id.clone(),
                text: event.event.text.clone(),
                sound_enabled: sound,
                widget: true,
                notification_key: event.id.clone(),
                fallback: (event.event.payload["bubbleEnabled"] == false).then_some(event),
            });
        }
    }
    Ok(result)
}

pub(super) fn focus_due(
    calendar: &WidgetInstance,
    timers: &[WidgetInstance],
    after: i64,
    now: i64,
    drafts: &mut Vec<EventDraft>,
    os: &mut Vec<Delivery>,
) {
    for timer in timers {
        let Some(target) = focus_target(timer, calendar, now) else {
            continue;
        };
        let starts = target["at"].as_i64().unwrap_or_default();
        let lead = target["leadMinutes"].as_i64().unwrap_or_default();
        if (lead != 0 && starts < now) || !crossed(after, now, starts.saturating_sub(lead * 60_000))
        {
            continue;
        }
        let title = target["title"].as_str().unwrap_or("연결 일정");
        let text = if lead == 0 {
            format!("집중에 연결한 일정이 시작돼요. {title}")
        } else {
            format!("집중에 연결한 일정이 {lead}분 뒤 시작돼요. {title}")
        };
        let (bubble, system, sound) = focus_channels(timer);
        drafts.push(EventDraft {
            kind: "planner-reminder".into(),
            text: text.clone(),
            payload: json!({"planningReminder":true,"bubbleEnabled":bubble,"targets":[target]}),
        });
        if system {
            os.push(Delivery {
                instance_id: timer.id.clone(),
                text,
                sound_enabled: sound,
                widget: true,
                notification_key: "linked-event".into(),
                fallback: None,
            });
        }
    }
}

fn envelope_target(
    preparation: &WidgetInstance,
    envelope: &Value,
    instances: &[WidgetInstance],
    now: i64,
) -> Option<Value> {
    if envelope["archived"] == true {
        return None;
    }
    let days = envelope["reminderDays"]
        .as_u64()
        .or_else(|| preparation.data["reminderDays"].as_u64())
        .filter(|days| [1, 3, 7].contains(days))?;
    let event_id = envelope["eventId"].as_str().unwrap_or_default();
    let (at, calendar_id) = if event_id.is_empty() {
        (
            local_date_time(envelope["date"].as_str()?, "09:00")?,
            Value::Null,
        )
    } else {
        let (calendar, target) = instances
            .iter()
            .filter(|instance| instance.kind == "calendar")
            .find_map(|calendar| {
                event_target(calendar, &envelope["eventId"], now).map(|target| (calendar, target))
            })?;
        (target["at"].as_i64()?, json!(calendar.id))
    };
    let reminder_at = Local
        .timestamp_millis_opt(at)
        .single()?
        .checked_sub_days(Days::new(days))?
        .timestamp_millis();
    Some(json!({
        "kind":"preparation", "id":envelope["id"], "preparationWidgetId":preparation.id,
        "calendarWidgetId":calendar_id, "eventId":envelope["eventId"],
        "title":envelope["title"].as_str().filter(|title| !title.is_empty())
            .or_else(|| envelope["eventLabel"].as_str()).unwrap_or("준비 봉투"),
        "at":at, "reminderAt":reminder_at, "leadDays":days
    }))
}

fn envelope_channels(
    target: &Value,
    instances: &[WidgetInstance],
) -> Result<ReminderSettings, String> {
    let calendar = instances.iter().find(|instance| {
        instance.kind == "calendar"
            && (target["calendarWidgetId"].is_null() || target["calendarWidgetId"] == instance.id)
    });
    calendar.map_or_else(
        || Ok(ReminderSettings::default()),
        |calendar| settings(&calendar.data),
    )
}

pub(super) fn advance_preparation(
    db: &Connection,
    instances: &[WidgetInstance],
    clocks: &mut BTreeMap<String, i64>,
    now: i64,
) -> Result<Advance, String> {
    let mut result = Advance {
        changed: false,
        os: vec![],
    };
    for preparation in instances
        .iter()
        .filter(|instance| instance.kind == "preparation")
    {
        let key = format!("preparation:{}", preparation.id);
        let previous = clocks.insert(key, now);
        let Some(previous) = previous else {
            continue;
        };
        let mut bubble_targets = vec![];
        let mut bubble_lines = vec![];
        for envelope in preparation.data["envelopes"]
            .as_array()
            .into_iter()
            .flatten()
        {
            let Some(target) = envelope_target(preparation, envelope, instances, now) else {
                continue;
            };
            if !target["reminderAt"]
                .as_i64()
                .is_some_and(|at| crossed(previous, now, at))
            {
                continue;
            }
            let channels = envelope_channels(&target, instances)?;
            let title = target["title"]
                .as_str()
                .unwrap_or("준비 봉투")
                .chars()
                .take(120)
                .collect::<String>();
            let days = target["leadDays"].as_u64().unwrap_or_default();
            let text = format!("{title}까지 {days}일 남았어요. 준비 봉투를 확인해 볼까요?");
            if channels.character_enabled {
                bubble_targets.push(target);
                bubble_lines.push(text.clone());
            }
            if channels.os_enabled {
                result.os.push(Delivery {
                    instance_id: preparation.id.clone(),
                    text,
                    sound_enabled: channels.sound_enabled,
                    widget: true,
                    notification_key: envelope["id"].as_str().unwrap_or_default().into(),
                    fallback: None,
                });
            }
        }
        if !bubble_targets.is_empty() {
            let mut text = bubble_lines
                .iter()
                .take(3)
                .cloned()
                .collect::<Vec<_>>()
                .join("\n");
            if bubble_lines.len() > 3 {
                text.push_str(&format!(
                    "\n그 밖에 준비 봉투 {}개도 확인해 주세요.",
                    bubble_lines.len() - 3
                ));
            }
            let drafts = vec![EventDraft {
                kind: "planner-reminder".into(),
                text,
                payload: json!({"planningReminder":true,"targets":bubble_targets}),
            }];
            storage::commit_data(
                db,
                &preparation.id,
                preparation.revision,
                preparation.data.clone(),
                drafts,
                now,
            )?;
            result.changed = true;
        }
    }
    Ok(result)
}

pub(super) fn event_current(db: &Connection, event: &WidgetEvent) -> Result<bool, String> {
    let instances = storage::instances(db)?;
    let now = chrono::Utc::now().timestamp_millis();
    let current = event.event.payload["targets"]
        .as_array()
        .is_some_and(|targets| {
            !targets.is_empty()
                && targets.iter().all(|target| {
                    let value = match target["kind"].as_str() {
                        Some("focus-event") => instances
                            .iter()
                            .find(|instance| {
                                instance.kind == "focus-timer"
                                    && target["id"] == instance.id
                                    && (focus_channels(instance).0
                                        || event.event.payload["osFallback"] == true)
                            })
                            .and_then(|timer| {
                                instances
                                    .iter()
                                    .find(|instance| {
                                        instance.kind == "calendar"
                                            && target["calendarWidgetId"] == instance.id
                                    })
                                    .and_then(|calendar| focus_target(timer, calendar, now))
                            }),
                        Some("preparation") => instances
                            .iter()
                            .find(|instance| {
                                instance.kind == "preparation"
                                    && target["preparationWidgetId"] == instance.id
                            })
                            .and_then(|preparation| {
                                preparation.data["envelopes"]
                                    .as_array()
                                    .and_then(|envelopes| {
                                        envelopes
                                            .iter()
                                            .find(|envelope| envelope["id"] == target["id"])
                                    })
                                    .and_then(|envelope| {
                                        envelope_target(preparation, envelope, &instances, now)
                                    })
                            }),
                        _ => None,
                    };
                    value.as_ref() == Some(target)
                        && (target["kind"] != "preparation"
                            || envelope_channels(target, &instances)
                                .is_ok_and(|channels| channels.character_enabled))
                })
        });
    Ok(current)
}

pub(super) fn attach_focus_fallbacks(
    db: &Connection,
    deliveries: &mut [Delivery],
    now: i64,
) -> Result<(), String> {
    if !deliveries
        .iter()
        .any(|delivery| delivery.notification_key == "linked-event")
    {
        return Ok(());
    }
    let events = storage::journal(db, None, now, now.saturating_add(1))?;
    for delivery in deliveries
        .iter_mut()
        .filter(|delivery| delivery.notification_key == "linked-event")
    {
        delivery.fallback = events
            .iter()
            .map(|(_, event)| event)
            .find(|event| {
                event.event.payload["bubbleEnabled"] == false
                    && event.event.payload["targets"]
                        .as_array()
                        .is_some_and(|targets| {
                            targets.iter().any(|target| {
                                target["kind"] == "focus-event"
                                    && target["id"] == delivery.instance_id
                            })
                        })
            })
            .cloned();
    }
    Ok(())
}
