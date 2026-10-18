use super::{boolean, capacity, date, new_id, optional_string, string, time, DiaryState, Result};
use chrono::{NaiveDate, NaiveDateTime, NaiveTime, TimeZone};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use serde_json::Value;

const MAX_BUDGET: u64 = 100_000_000_000;
const MAX_DAYS: i64 = 366;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct Travel {
    id: String,
    title: String,
    destination: String,
    start_date: String,
    end_date: String,
    time_zone: String,
    currency: String,
    budget: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    envelope_id: Option<String>,
    #[serde(default)]
    finished: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct TravelPlan {
    id: String,
    travel_id: String,
    kind: String,
    date: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    time: Option<String>,
    title: String,
    place: String,
    memo: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    arrive_date: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    arrive_time: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    depart_zone: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    arrive_zone: Option<String>,
}

fn check_expected<T: for<'de> Deserialize<'de> + PartialEq>(
    input: &Value,
    current: &T,
) -> Result<()> {
    let expected: T = serde_json::from_value(
        input
            .get("expected")
            .cloned()
            .ok_or("편집 전 내용이 필요합니다.")?,
    )
    .map_err(super::err)?;
    if &expected != current {
        return Err(
            "다른 화면에서 여행이 바뀌었어요. 입력은 그대로 두었으니 최신 내용을 확인해 주세요."
                .into(),
        );
    }
    Ok(())
}

fn zone(value: String) -> Result<String> {
    value
        .parse::<Tz>()
        .map_err(|_| "시간대를 찾을 수 없습니다.")?;
    Ok(value)
}

fn optional_zone(input: &Value, key: &str) -> Result<Option<String>> {
    optional_string(input, key, 64)?.map(zone).transpose()
}

fn instant(day: &str, at: &str, zone: &str) -> Result<i64> {
    let local = NaiveDateTime::new(
        NaiveDate::parse_from_str(day, "%Y-%m-%d").map_err(super::err)?,
        NaiveTime::parse_from_str(at, "%H:%M").map_err(super::err)?,
    );
    let tz: Tz = zone.parse().map_err(|_| "시간대를 찾을 수 없습니다.")?;
    tz.from_local_datetime(&local)
        .earliest()
        .map(|value| value.timestamp())
        .ok_or_else(|| "그 시간대에 없는 시각이에요.".into())
}

fn travel(input: &Value, id: String, finished: bool) -> Result<Travel> {
    let start_date = date(string(input, "startDate", 10, true)?)?;
    let end_date = date(string(input, "endDate", 10, true)?)?;
    let start = NaiveDate::parse_from_str(&start_date, "%Y-%m-%d").map_err(super::err)?;
    let end = NaiveDate::parse_from_str(&end_date, "%Y-%m-%d").map_err(super::err)?;
    if end < start || (end - start).num_days() >= MAX_DAYS {
        return Err("여행 기간은 첫날부터 1년 안이어야 합니다.".into());
    }
    let currency = string(input, "currency", 3, true)?;
    if currency.len() != 3 || !currency.chars().all(|value| value.is_ascii_uppercase()) {
        return Err("통화는 KRW처럼 영문 대문자 3자로 적어 주세요.".into());
    }
    let budget = input
        .get("budget")
        .and_then(Value::as_u64)
        .filter(|value| *value <= MAX_BUDGET)
        .ok_or("예산은 원 단위 정수여야 합니다.")?;
    Ok(Travel {
        id,
        title: string(input, "title", 100, true)?,
        destination: string(input, "destination", 100, false)?,
        start_date,
        end_date,
        time_zone: zone(string(input, "timeZone", 64, true)?)?,
        currency,
        budget,
        envelope_id: optional_string(input, "envelopeId", 200)?,
        finished: boolean(input, "finished", finished)?,
    })
}

fn plan(state: &DiaryState, input: &Value, id: String) -> Result<TravelPlan> {
    let travel_id = string(input, "travelId", 200, true)?;
    let owner = state
        .travels
        .iter()
        .find(|value| value.id == travel_id)
        .ok_or("여행을 찾을 수 없습니다.")?;
    let kind = string(input, "kind", 10, true)?;
    let mut value = TravelPlan {
        id,
        travel_id,
        date: date(string(input, "date", 10, true)?)?,
        time: time(input, "time")?,
        title: string(input, "title", 200, true)?,
        place: string(input, "place", 200, false)?,
        memo: string(input, "memo", 2000, false)?,
        arrive_date: None,
        arrive_time: None,
        depart_zone: None,
        arrive_zone: None,
        kind,
    };
    match value.kind.as_str() {
        "plan" => {}
        "move" => {
            let depart_time = value.time.clone().ok_or("출발 시각을 적어 주세요.")?;
            let arrive_date = date(string(input, "arriveDate", 10, true)?)?;
            let arrive_time = time(input, "arriveTime")?.ok_or("도착 시각을 적어 주세요.")?;
            let depart_zone = optional_zone(input, "departZone")?;
            let arrive_zone = optional_zone(input, "arriveZone")?;
            let departs = instant(
                &value.date,
                &depart_time,
                depart_zone.as_deref().unwrap_or(&owner.time_zone),
            )?;
            let arrives = instant(
                &arrive_date,
                &arrive_time,
                arrive_zone.as_deref().unwrap_or(&owner.time_zone),
            )?;
            if arrives < departs || arrives - departs > 7 * 24 * 3600 {
                return Err(
                    "도착 시각이 출발보다 빠르거나 너무 멀어요. 시간대를 확인해 주세요.".into(),
                );
            }
            value.arrive_date = Some(arrive_date);
            value.arrive_time = Some(arrive_time);
            value.depart_zone = depart_zone;
            value.arrive_zone = arrive_zone;
        }
        _ => return Err("일정 종류가 올바르지 않습니다.".into()),
    }
    Ok(value)
}

pub(super) fn mutate(state: &mut DiaryState, action: &str, input: &Value) -> Result<()> {
    match action {
        "travel-create" => {
            capacity(state.travels.len(), 500)?;
            let value = travel(input, new_id(), false)?;
            state.travels.push(value);
        }
        "travel-update" | "travel-delete" => {
            let id = string(input, "id", 200, true)?;
            let at = state
                .travels
                .iter()
                .position(|value| value.id == id)
                .ok_or("여행을 찾을 수 없습니다.")?;
            check_expected(input, &state.travels[at])?;
            if action == "travel-delete" {
                state.travels.remove(at);
                state.travel_plans.retain(|value| value.travel_id != id);
            } else {
                let finished = state.travels[at].finished;
                state.travels[at] = travel(input, id, finished)?;
            }
        }
        "travel-plan-create" => {
            capacity(state.travel_plans.len(), 20_000)?;
            let value = plan(state, input, new_id())?;
            state.travel_plans.push(value);
        }
        "travel-plan-update" | "travel-plan-delete" => {
            let id = string(input, "id", 200, true)?;
            let at = state
                .travel_plans
                .iter()
                .position(|value| value.id == id)
                .ok_or("일정을 찾을 수 없습니다.")?;
            check_expected(input, &state.travel_plans[at])?;
            if action == "travel-plan-delete" {
                state.travel_plans.remove(at);
            } else {
                let value = plan(state, input, id)?;
                if value.travel_id != state.travel_plans[at].travel_id {
                    return Err("일정을 다른 여행으로 옮길 수 없습니다.".into());
                }
                state.travel_plans[at] = value;
            }
        }
        _ => return Err("지원하지 않는 여행 동작입니다.".into()),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn jeju() -> Value {
        json!({
            "title": "제주 가족 여행",
            "destination": "제주",
            "startDate": "2026-10-24",
            "endDate": "2026-10-25",
            "timeZone": "Asia/Seoul",
            "currency": "KRW",
            "budget": 2_000_000,
            "envelopeId": "envelope-1"
        })
    }

    fn created() -> DiaryState {
        let mut state = DiaryState::default();
        mutate(&mut state, "travel-create", &jeju()).unwrap();
        state
    }

    #[test]
    fn creates_travel_and_rejects_invalid_period_zone_and_currency() {
        let state = created();
        assert_eq!(state.travels[0].title, "제주 가족 여행");
        assert!(!state.travels[0].finished);
        for (key, bad) in [
            ("endDate", json!("2026-10-23")),
            ("endDate", json!("2027-10-25")),
            ("timeZone", json!("Mars/Base")),
            ("currency", json!("krw")),
            ("budget", json!(-1)),
            ("title", json!("  ")),
        ] {
            let mut input = jeju();
            input[key] = bad;
            let mut copy = state.clone();
            assert!(mutate(&mut copy, "travel-create", &input).is_err(), "{key}");
            assert_eq!(copy, state);
        }
    }

    #[test]
    fn updates_need_the_unchanged_original_and_keep_finished_unless_given() {
        let mut state = created();
        let current = serde_json::to_value(&state.travels[0]).unwrap();
        let mut input = jeju();
        input["id"] = current["id"].clone();
        input["expected"] = current.clone();
        input["finished"] = json!(true);
        mutate(&mut state, "travel-update", &input).unwrap();
        assert!(state.travels[0].finished);
        let mut stale = input.clone();
        stale["title"] = json!("덮어쓰기");
        assert!(mutate(&mut state, "travel-update", &stale).is_err());
        let mut fresh = jeju();
        fresh["id"] = current["id"].clone();
        fresh["expected"] = serde_json::to_value(&state.travels[0]).unwrap();
        mutate(&mut state, "travel-update", &fresh).unwrap();
        assert!(state.travels[0].finished);
    }

    #[test]
    fn moves_compute_across_zones_and_deleting_travel_removes_its_plans() {
        let mut state = created();
        let travel_id = state.travels[0].id.clone();
        let flight = json!({
            "travelId": travel_id, "kind": "move", "date": "2026-10-24", "time": "09:10",
            "title": "김포 → 제주", "place": "", "memo": "",
            "arriveDate": "2026-10-24", "arriveTime": "10:20"
        });
        mutate(&mut state, "travel-plan-create", &flight).unwrap();
        // 도쿄 12:00 출발 → 서울 14:20 도착: 같은 시차라 2시간 20분, 거꾸로면 거절한다.
        let mut abroad = flight.clone();
        abroad["time"] = json!("12:00");
        abroad["departZone"] = json!("Asia/Tokyo");
        abroad["arriveTime"] = json!("14:20");
        mutate(&mut state, "travel-plan-create", &abroad).unwrap();
        abroad["time"] = json!("15:00");
        assert!(mutate(&mut state, "travel-plan-create", &abroad).is_err());
        let mut plain = flight.clone();
        plain["kind"] = json!("plan");
        plain["time"] = json!("");
        mutate(&mut state, "travel-plan-create", &plain).unwrap();
        assert_eq!(state.travel_plans[2].arrive_date, None);
        assert_eq!(state.travel_plans[2].time, None);
        let mut orphan = plain.clone();
        orphan["travelId"] = json!("missing");
        assert!(mutate(&mut state, "travel-plan-create", &orphan).is_err());
        let expected = serde_json::to_value(&state.travels[0]).unwrap();
        mutate(
            &mut state,
            "travel-delete",
            &json!({"id": travel_id, "expected": expected}),
        )
        .unwrap();
        assert!(state.travels.is_empty() && state.travel_plans.is_empty());
    }
}
