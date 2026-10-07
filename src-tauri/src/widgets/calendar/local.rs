use super::{CalendarEvent, NoteReference, MAX_EVENTS};
use crate::widgets::WidgetEffect;
use chrono::{DateTime, Datelike, NaiveDate};
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EventInput {
    id: Option<String>,
    title: String,
    all_day: bool,
    start_at: Option<i64>,
    end_at: Option<i64>,
    start_date: Option<String>,
    end_date: Option<String>,
    time_zone: Option<String>,
    location: Option<String>,
    description: Option<String>,
    note_ref: Option<NoteReference>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DeleteInput {
    id: String,
}

fn date(value: Option<&str>) -> Result<NaiveDate, String> {
    let value = value.ok_or("종일 일정의 시작일과 종료일을 입력해 주세요.")?;
    let date = NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| "일정 날짜가 올바르지 않습니다.")?;
    if !(1..=9999).contains(&date.year()) || date.format("%Y-%m-%d").to_string() != value {
        return Err("일정 날짜는 YYYY-MM-DD 형식으로 입력해 주세요.".into());
    }
    Ok(date)
}

fn event(input: EventInput, id: String) -> Result<CalendarEvent, String> {
    let title = input.title.trim();
    if title.is_empty() || title.chars().count() > 500 {
        return Err("일정 제목은 1~500자로 입력해 주세요.".into());
    }
    if input
        .location
        .as_ref()
        .is_some_and(|value| value.chars().count() > 2000)
        || input
            .description
            .as_ref()
            .is_some_and(|value| value.chars().count() > 20000)
    {
        return Err("장소는 2000자, 메모는 20000자까지 입력할 수 있습니다.".into());
    }
    let time_zone = input.time_zone.as_deref().unwrap_or("local");
    if input.note_ref.as_ref().is_some_and(|reference| {
        !matches!(reference.kind.as_str(), "diary" | "memo")
            || reference.id.trim().is_empty()
            || reference.id.chars().count() > 200
            || reference.title.chars().count() > 500
            || (reference.kind == "memo" && reference.widget_id.is_none())
            || reference
                .widget_id
                .as_ref()
                .is_some_and(|id| id.trim().is_empty() || id.chars().count() > 200)
    }) {
        return Err("연결할 메모 정보가 올바르지 않습니다.".into());
    }
    if time_zone != "local" && time_zone.parse::<chrono_tz::Tz>().is_err() {
        return Err("일정 시간대가 올바르지 않습니다.".into());
    }
    if input.all_day {
        if input.start_at.is_some() || input.end_at.is_some() {
            return Err("종일 일정에는 날짜만 지정해 주세요.".into());
        }
        let start = date(input.start_date.as_deref())?;
        let end = date(input.end_date.as_deref())?;
        if end <= start {
            return Err("종일 일정의 종료일은 시작일 다음 날부터 지정해 주세요.".into());
        }
    } else {
        if input.start_date.is_some() || input.end_date.is_some() {
            return Err("시간 일정에는 시작·종료 시각을 지정해 주세요.".into());
        }
        let (Some(start), Some(end)) = (input.start_at, input.end_at) else {
            return Err("일정 시작·종료 시각을 입력해 주세요.".into());
        };
        if end <= start
            || [start, end].iter().any(|timestamp| {
                DateTime::from_timestamp_millis(*timestamp)
                    .is_none_or(|date| !(1..=9999).contains(&date.year()))
            })
        {
            return Err("일정 종료 시각은 시작 시각 이후로 지정해 주세요.".into());
        }
    }
    Ok(CalendarEvent {
        id: id.clone(),
        connection_id: "local".into(),
        source_id: "local".into(),
        occurrence_id: id,
        title: title.into(),
        start_at: input.start_at,
        end_at: input.end_at,
        start_date: input.start_date,
        end_date: input.end_date,
        time_zone: (!input.all_day).then(|| time_zone.to_owned()),
        all_day: input.all_day,
        cancelled: false,
        url: None,
        meeting_url: None,
        location: input.location.filter(|value| !value.is_empty()),
        description: input.description.filter(|value| !value.is_empty()),
        note_ref: input.note_ref,
    })
}

fn editable_index(events: &[Value], id: &str) -> Result<usize, String> {
    let index = events
        .iter()
        .position(|event| event["id"].as_str() == Some(id))
        .ok_or("일정을 찾을 수 없습니다. 다시 불러와 주세요.")?;
    if events[index]["connectionId"] != "local" {
        return Err("외부 캘린더 일정은 원본 캘린더에서 수정해 주세요.".into());
    }
    Ok(index)
}

pub fn act(data: &Value, action: &str, input: &Value) -> Result<WidgetEffect, String> {
    let mut next = data.clone();
    let events = next["events"]
        .as_array_mut()
        .ok_or("저장된 일정을 읽지 못했습니다.")?;
    match action {
        "delete-event" => {
            let input: DeleteInput = serde_json::from_value(input.clone())
                .map_err(|_| "삭제할 일정 입력이 올바르지 않습니다.")?;
            let index = editable_index(events, &input.id)?;
            events.remove(index);
        }
        "create-event" | "update-event" => {
            let preserve_note_ref = input.get("noteRef").is_none();
            let input: EventInput = serde_json::from_value(input.clone())
                .map_err(|_| "일정 입력 형식이 올바르지 않습니다.")?;
            let index = match action {
                "update-event" => Some(editable_index(
                    events,
                    input.id.as_deref().ok_or("수정할 일정을 선택해 주세요.")?,
                )?),
                _ => {
                    if input.id.is_some() {
                        return Err("새 일정의 ID는 자동으로 만듭니다.".into());
                    }
                    if events
                        .iter()
                        .filter(|event| event["connectionId"] == "local")
                        .count()
                        >= MAX_EVENTS
                    {
                        return Err("Comet 일정은 5000개까지 추가할 수 있습니다.".into());
                    }
                    None
                }
            };
            let id = input
                .id
                .clone()
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
            let mut value =
                serde_json::to_value(event(input, id)?).map_err(|error| error.to_string())?;
            if let Some(index) = index {
                if preserve_note_ref {
                    if let Some(reference) = events[index].get("noteRef") {
                        value["noteRef"] = reference.clone();
                    }
                }
                events[index] = value;
            } else {
                events.push(value);
            }
        }
        _ => return Err("지원하지 않는 일정 작업입니다.".into()),
    }
    Ok(WidgetEffect {
        data: next,
        events: vec![],
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::widgets::{self, storage, WidgetRequest};
    use serde_json::json;

    fn all_day() -> Value {
        json!({"title":"가을 여행", "allDay":true, "startDate":"2026-10-03", "endDate":"2026-10-05"})
    }

    #[test]
    fn local_calendar_events_create_update_and_delete_without_touching_remote_data() {
        let original = json!({"connections":[{"id":"remote"}],"events":[{"id":"external", "connectionId":"remote", "custom":"preserve"}],"reminders":{"enabled":true}});
        let mut input = all_day();
        input["location"] = json!("서울");
        input["description"] = json!("  첫날\n둘째 날  ");
        let created = act(&original, "create-event", &input).unwrap().data;
        let id = created["events"][1]["id"].as_str().unwrap();
        assert_eq!(created["connections"], original["connections"]);
        assert_eq!(created["reminders"], original["reminders"]);
        assert_eq!(created["events"][0], original["events"][0]);
        assert_eq!(created["events"][1]["connectionId"], "local");
        assert_eq!(created["events"][1]["endDate"], "2026-10-05");
        assert_eq!(created["events"][1]["startAt"], Value::Null);
        assert_eq!(created["events"][1]["description"], input["description"]);
        let updated = act(&created, "update-event", &json!({"id":id,"title":"회의", "allDay":false, "startAt":1790985600000_i64, "endAt":1790989200000_i64,"timeZone":"Asia/Seoul"})).unwrap().data;
        assert_eq!(updated["events"][1]["id"], id);
        assert_eq!(updated["events"][1]["startDate"], Value::Null);
        assert_eq!(updated["events"][1]["timeZone"], "Asia/Seoul");
        assert_eq!(updated["events"][1]["description"], Value::Null);
        let deleted = act(&updated, "delete-event", &json!({"id":id}))
            .unwrap()
            .data;
        assert_eq!(deleted, original);
        for action in ["update-event", "delete-event"] {
            let mut edit = if action == "delete-event" {
                json!({})
            } else {
                all_day()
            };
            edit["id"] = json!("external");
            assert!(act(&original, action, &edit)
                .unwrap_err()
                .contains("외부 캘린더"));
        }
    }

    #[test]
    fn local_calendar_event_input_rejects_invalid_and_mixed_ranges() {
        let data = json!({"connections":[],"events":[]});
        for (field, value) in [
            ("title", json!(" ")),
            ("title", json!("일".repeat(501))),
            ("startDate", json!("2026-02-30")),
            ("startDate", json!("2026-1-03")),
            ("endDate", json!("2026-10-03")),
            ("startAt", json!(1)),
            ("timeZone", json!("invalid-zone")),
            ("location", json!("a".repeat(2001))),
            ("description", json!("a".repeat(20001))),
            ("connectionId", json!("remote")),
            ("id", json!("supplied")),
        ] {
            let mut input = all_day();
            input[field] = value;
            assert!(act(&data, "create-event", &input).is_err(), "{field}");
        }
        for (start, end) in [(1, 1), (2, 1), (0, i64::MAX)] {
            assert!(act(
                &data,
                "create-event",
                &json!({"title":"회의","allDay":false,"startAt":start,"endAt":end})
            )
            .is_err());
        }
        assert!(act(
            &data,
            "create-event",
            &json!({"title":"회의","allDay":false,"startAt":1})
        )
        .is_err());
        assert!(act(&data, "delete-event", &json!({"id":"missing"})).is_err());
        assert!(act(&data, "update-event", &all_day()).is_err());
    }

    #[test]
    fn local_events_copy_only_note_reference_and_keep_it_when_older_editors_omit_it() {
        let data = json!({"connections":[],"events":[]});
        let reference =
            json!({"kind":"memo","id":"note-one","widgetId":"memo-widget","title":"준비할 내용"});
        let mut input = json!({"title":"발표 준비","allDay":false,"startAt":1_000_000,"endAt":2_500_000,"noteRef":reference});
        let created = act(&data, "create-event", &input).unwrap().data;
        let saved = &created["events"][0];
        assert_eq!(saved["noteRef"], reference);
        assert_eq!(
            saved["endAt"].as_i64().unwrap() - saved["startAt"].as_i64().unwrap(),
            1_500_000
        );
        assert!(saved["description"].is_null());
        input["id"] = saved["id"].clone();
        input.as_object_mut().unwrap().remove("noteRef");
        let edited = act(&created, "update-event", &input).unwrap().data;
        assert_eq!(edited["events"][0]["noteRef"], reference);
        input["noteRef"] = Value::Null;
        let unlinked = act(&edited, "update-event", &input).unwrap().data;
        assert!(unlinked["events"][0].get("noteRef").is_none());
        input.as_object_mut().unwrap().remove("id");
        for invalid in [
            json!({"kind":"diary","id":"diary-note","title":"일기","body":"본문은 복제하지 않음"}),
            json!({"kind":"external","id":"note","title":"메모"}),
            json!({"kind":"memo","id":" ","title":"메모"}),
            json!({"kind":"memo","id":"note","title":"메모"}),
            json!({"kind":"memo","id":"note","widgetId":"","title":"메모"}),
        ] {
            input["noteRef"] = invalid;
            assert!(act(&data, "create-event", &input).is_err());
        }
    }

    #[test]
    fn local_calendar_actions_keep_revision_and_request_id_guards() {
        let db = rusqlite::Connection::open_in_memory().unwrap();
        storage::initialize(&db).unwrap();
        let directory = tempfile::tempdir().unwrap();
        storage::install(&db, directory.path(), &["calendar".into()]).unwrap();
        let calendar = storage::instances(&db)
            .unwrap()
            .into_iter()
            .find(|entry| entry.kind == "calendar")
            .unwrap();
        let request = WidgetRequest {
            request_id: uuid::Uuid::new_v4().to_string(),
            instance_id: calendar.id.clone(),
            expected_revision: calendar.revision,
            action: "create-event".into(),
            input: all_day(),
        };
        storage::execute(&db, &request, 1, 1).unwrap();
        let saved = storage::get(&db, &calendar.id).unwrap();
        storage::execute(&db, &request, 2, 2).unwrap();
        assert_eq!(
            storage::get(&db, &calendar.id).unwrap().revision,
            saved.revision
        );
        let mut stale = request.clone();
        stale.request_id = uuid::Uuid::new_v4().to_string();
        assert!(storage::execute(&db, &stale, 3, 3).is_err());
        assert_eq!(storage::get(&db, &calendar.id).unwrap().data, saved.data);
        let projected = widgets::project(saved.clone(), std::slice::from_ref(&saved)).unwrap();
        assert_eq!(projected.status, "enabled");
        storage::set_enabled(&db, &calendar.id, false).unwrap();
        assert_eq!(
            storage::get(&db, &calendar.id).unwrap().data["events"],
            saved.data["events"]
        );
        storage::remove(&db, directory.path(), &calendar.id, false).unwrap();
        storage::install(&db, directory.path(), &["calendar".into()]).unwrap();
        assert_eq!(
            storage::get(&db, &calendar.id).unwrap().data["events"],
            saved.data["events"]
        );
    }
}
