use super::{capacity, date, missing, new_id, optional_string, string, DiaryState, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct TimeCategory {
    id: String,
    name: String,
    color: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct TimeRecord {
    id: String,
    date: String,
    start_minute: u16,
    end_minute: u16,
    category_id: String,
    title: String,
}

fn categories(state: &DiaryState) -> Vec<TimeCategory> {
    if !state.time_categories.is_empty() {
        return state.time_categories.clone();
    }
    [
        ("work", "일"),
        ("record", "기록"),
        ("life", "생활"),
        ("exercise", "운동"),
        ("rest", "쉼"),
    ]
    .into_iter()
    .map(|(id, name)| TimeCategory {
        id: id.into(),
        name: name.into(),
        color: id.into(),
    })
    .collect()
}

fn minute(input: &Value, key: &str, max: u64) -> Result<u16> {
    let value = input
        .get(key)
        .and_then(Value::as_u64)
        .filter(|value| *value <= max && value % 10 == 0)
        .ok_or("시각은 00:00부터 24:00 사이의 10분 단위여야 합니다.")?;
    Ok(value as u16)
}

fn expected(input: &Value, key: &str, actual: &impl Serialize) -> Result<()> {
    if let Some(value) = input.get(key) {
        if *value != serde_json::to_value(actual).map_err(super::err)? {
            return Err(
                "이 기록이 다른 화면에서 바뀌었어요. 입력을 보존했으니 최신 내용을 확인해 주세요."
                    .into(),
            );
        }
    }
    Ok(())
}

pub(super) fn mutate(state: &mut DiaryState, action: &str, input: &Value) -> Result<()> {
    let mut categories = categories(state);
    let mut records = state.time_records.clone();
    match action {
        "time-record-save" => {
            let id = optional_string(input, "id", 200)?;
            if id
                .as_ref()
                .is_some_and(|id| !records.iter().any(|record| &record.id == id))
            {
                return Err(missing());
            }
            if let Some(record) = records
                .iter()
                .find(|record| Some(&record.id) == id.as_ref())
            {
                expected(input, "expectedRecord", record)?;
            }
            let date = date(string(input, "date", 10, true)?)?;
            if let Some(snapshot) = input.get("expectedRecords") {
                let mut expected: Vec<TimeRecord> = serde_json::from_value(snapshot.clone())
                    .map_err(|_| "시간 기록의 저장 기준을 읽을 수 없어요.")?;
                let mut current: Vec<_> = records
                    .iter()
                    .filter(|record| record.date == date)
                    .cloned()
                    .collect();
                expected.sort_by(|a, b| a.id.cmp(&b.id));
                current.sort_by(|a, b| a.id.cmp(&b.id));
                if expected != current {
                    return Err("이날의 시간 기록이 다른 화면에서 바뀌었어요. 입력을 보존했으니 최신 내용을 확인해 주세요.".into());
                }
            }
            let start = minute(input, "startMinute", 1430)?;
            let end = minute(input, "endMinute", 1440)?;
            if end <= start {
                return Err("종료 시각은 시작 뒤로 정해 주세요. 자정을 넘는 기록은 날짜별로 나누어 칠해 주세요.".into());
            }
            let category_id = string(input, "categoryId", 200, true)?;
            if !categories.iter().any(|category| category.id == category_id) {
                return Err("분류를 찾을 수 없습니다. 다른 분류를 선택해 주세요.".into());
            }
            let title = string(input, "title", 500, false)?;
            let mut next = Vec::with_capacity(records.len() + 2);
            for record in records {
                if id.as_ref() == Some(&record.id) {
                    continue;
                }
                if record.date != date || record.end_minute <= start || record.start_minute >= end {
                    next.push(record);
                    continue;
                }
                let has_left = record.start_minute < start;
                if has_left {
                    let mut left = record.clone();
                    left.end_minute = start;
                    next.push(left);
                }
                if record.end_minute > end {
                    let mut right = record;
                    if has_left {
                        right.id = new_id();
                    }
                    right.start_minute = end;
                    next.push(right);
                }
            }
            capacity(next.len(), 20000)?;
            next.push(TimeRecord {
                id: id.unwrap_or_else(new_id),
                date,
                start_minute: start,
                end_minute: end,
                category_id,
                title,
            });
            records = next;
        }
        "time-record-delete" => {
            let id = string(input, "id", 200, true)?;
            let index = records
                .iter()
                .position(|record| record.id == id)
                .ok_or_else(missing)?;
            expected(input, "expectedRecord", &records[index])?;
            records.remove(index);
        }
        "time-category-save" => {
            let id = optional_string(input, "id", 200)?;
            let name = string(input, "name", 40, true)?;
            let color = string(input, "color", 20, true)?;
            if !["work", "record", "life", "exercise", "rest", "focus"].contains(&color.as_str()) {
                return Err("분류 색상이 올바르지 않습니다.".into());
            }
            if categories.iter().any(|category| {
                category.name.trim() == name.trim() && Some(&category.id) != id.as_ref()
            }) {
                return Err("같은 이름의 분류가 이미 있습니다.".into());
            }
            if let Some(id) = id {
                let category = categories
                    .iter_mut()
                    .find(|category| category.id == id)
                    .ok_or_else(missing)?;
                expected(input, "expectedCategory", category)?;
                category.name = name;
                category.color = color;
            } else {
                capacity(categories.len(), 30)?;
                categories.push(TimeCategory {
                    id: new_id(),
                    name,
                    color,
                });
            }
        }
        "time-category-delete" => {
            let id = string(input, "id", 200, true)?;
            let index = categories
                .iter()
                .position(|category| category.id == id)
                .ok_or_else(missing)?;
            expected(input, "expectedCategory", &categories[index])?;
            if categories.len() == 1 {
                return Err("시간 기록에는 한 개 이상의 분류가 필요합니다.".into());
            }
            if records.iter().any(|record| record.category_id == id) {
                let target = string(input, "reassignTo", 200, true)?;
                if target == id || !categories.iter().any(|category| category.id == target) {
                    return Err("기존 기록을 옮길 다른 분류를 선택해 주세요.".into());
                }
                for record in &mut records {
                    if record.category_id == id {
                        record.category_id = target.clone();
                    }
                }
            }
            categories.remove(index);
        }
        _ => return Err("알 수 없는 시간 기록 작업입니다.".into()),
    }
    state.time_categories = categories;
    state.time_records = records;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn paint(start: u16, end: u16, category: &str) -> Value {
        json!({"date":"2026-10-15","startMinute":start,"endMinute":end,"categoryId":category,"title":"  메모\n원문  "})
    }

    #[test]
    fn painting_splits_only_the_overlapping_manual_time_and_can_edit_delete() {
        let mut state = DiaryState::default();
        mutate(&mut state, "time-record-save", &paint(540, 720, "work")).unwrap();
        mutate(&mut state, "time-record-save", &paint(600, 660, "life")).unwrap();
        let spans: Vec<_> = state
            .time_records
            .iter()
            .map(|record| (record.start_minute, record.end_minute))
            .collect();
        assert_eq!(spans, vec![(540, 600), (660, 720), (600, 660)]);
        assert_eq!(state.time_records[0].title, "  메모\n원문  ");
        let id = state.time_records[2].id.clone();
        let mut update = paint(600, 680, "exercise");
        update["id"] = json!(id);
        mutate(&mut state, "time-record-save", &update).unwrap();
        assert_eq!(state.time_records.len(), 3);
        assert_eq!(state.time_records[1].start_minute, 680);
        mutate(&mut state, "time-record-delete", &json!({"id":id})).unwrap();
        assert_eq!(state.time_records.len(), 2);
    }

    #[test]
    fn midnight_is_an_end_boundary_and_invalid_changes_are_atomic() {
        let mut state = DiaryState::default();
        mutate(&mut state, "time-record-save", &paint(1430, 1440, "rest")).unwrap();
        let before = state.clone();
        for input in [
            paint(1430, 10, "rest"),
            paint(5, 20, "work"),
            paint(0, 1450, "work"),
            paint(0, 10, "missing"),
            json!({"date":"2026-02-30","startMinute":0,"endMinute":10,"categoryId":"work","title":""}),
        ] {
            assert!(mutate(&mut state, "time-record-save", &input).is_err());
            assert_eq!(state, before);
        }
    }

    #[test]
    fn category_changes_preserve_records_and_do_not_restore_deleted_defaults() {
        let mut state = DiaryState::default();
        mutate(&mut state, "time-record-save", &paint(540, 600, "work")).unwrap();
        assert!(mutate(&mut state, "time-category-delete", &json!({"id":"work"})).is_err());
        mutate(
            &mut state,
            "time-category-save",
            &json!({"id":"work","name":"공부","color":"rest"}),
        )
        .unwrap();
        assert_eq!(state.time_categories[0].name, "공부");
        mutate(
            &mut state,
            "time-category-delete",
            &json!({"id":"work","reassignTo":"record"}),
        )
        .unwrap();
        assert_eq!(state.time_records[0].category_id, "record");
        mutate(
            &mut state,
            "time-category-save",
            &json!({"name":"산책","color":"exercise"}),
        )
        .unwrap();
        assert!(!state
            .time_categories
            .iter()
            .any(|category| category.id == "work"));
    }

    #[test]
    fn legacy_documents_persist_time_without_resetting_notes_and_reject_stale_edits() {
        let db = rusqlite::Connection::open_in_memory().unwrap();
        super::super::initialize(&db).unwrap();
        let state = super::super::update(
            &db,
            0,
            "note-create",
            &json!({"title":"보존","body":"  원문\n  "}),
        )
        .unwrap();
        let state = super::super::update(
            &db,
            state.revision,
            "time-record-save",
            &paint(540, 600, "work"),
        )
        .unwrap();
        assert_eq!(super::super::read(&db).unwrap(), state);
        assert_eq!(state.notes[0].body, "  원문\n  ");
        let record = &state.time_records[0];
        let mut input = paint(540, 620, "life");
        input["id"] = json!(record.id);
        input["expectedRecord"] = serde_json::to_value(record).unwrap();
        input["expectedRecord"]["title"] = json!("오래된 제목");
        assert!(super::super::update(&db, state.revision, "time-record-save", &input).is_err());
        assert_eq!(super::super::read(&db).unwrap(), state);
    }

    #[test]
    fn painting_rejects_a_changed_day_snapshot_without_splitting_new_records() {
        let db = rusqlite::Connection::open_in_memory().unwrap();
        super::super::initialize(&db).unwrap();
        let state =
            super::super::update(&db, 0, "time-record-save", &paint(540, 720, "work")).unwrap();
        let snapshot = serde_json::to_value(&state.time_records).unwrap();
        let current = super::super::update(
            &db,
            state.revision,
            "time-record-save",
            &paint(600, 660, "exercise"),
        )
        .unwrap();
        let mut input = paint(580, 680, "life");
        input["expectedRecords"] = snapshot;
        assert!(super::super::update(&db, current.revision, "time-record-save", &input).is_err());
        assert_eq!(super::super::read(&db).unwrap(), current);

        let mut records = current.time_records.clone();
        records.reverse();
        input["expectedRecords"] = serde_json::to_value(records).unwrap();
        let saved =
            super::super::update(&db, current.revision, "time-record-save", &input).unwrap();
        assert!(saved.time_records.iter().any(|record| {
            record.start_minute == 580 && record.end_minute == 680 && record.category_id == "life"
        }));
    }
}
