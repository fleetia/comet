use super::{
    boolean, capacity, date, ledger::LedgerEntry, new_id, optional_string, string, time,
    DiaryState, Result,
};
use chrono::{NaiveDate, NaiveDateTime, NaiveTime, TimeZone};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeSet;

const MAX_BUDGET: u64 = 100_000_000_000;
const MAX_MINOR: u64 = 10_000_000_000_000;
const MAX_RATE: u64 = 1_000_000_000;
const MAX_DAYS: i64 = 366;
pub(crate) const ME: &str = "me";
const BOOKING_KINDS: [&str; 8] = [
    "flight", "train", "bus", "stay", "car", "ticket", "food", "other",
];
/// The design system's list colours, in their order.
const PERSON_COLORS: [&str; 7] = ["blue", "coral", "green", "violet", "yellow", "pink", "gray"];
/// Currencies paid without a minor unit. Everything else is stored in hundredths.
const ZERO_DECIMAL: [&str; 7] = ["KRW", "JPY", "VND", "CLP", "ISK", "PYG", "UGX"];

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Travel {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) destination: String,
    pub(crate) start_date: String,
    pub(crate) end_date: String,
    pub(crate) time_zone: String,
    pub(crate) currency: String,
    pub(crate) budget: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) envelope_id: Option<String>,
    #[serde(default)]
    pub(crate) finished: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TravelPlan {
    pub(crate) id: String,
    pub(crate) travel_id: String,
    pub(crate) kind: String,
    pub(crate) date: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) time: Option<String>,
    pub(crate) title: String,
    pub(crate) place: String,
    pub(crate) memo: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) arrive_date: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) arrive_time: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) depart_zone: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) arrive_zone: Option<String>,
    /// Microdegrees keep the diary state comparable with `Eq`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) lat: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) lng: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) booking_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Voucher {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) file: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Booking {
    pub(crate) id: String,
    pub(crate) travel_id: String,
    pub(crate) kind: String,
    pub(crate) title: String,
    pub(crate) vendor: String,
    /// Stored as written; screens and exports only show the last four characters.
    pub(crate) confirmation: String,
    pub(crate) status: String,
    pub(crate) amount: u64,
    pub(crate) currency: String,
    pub(crate) rate: u64,
    pub(crate) category: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) paid_date: Option<String>,
    pub(crate) start_date: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) start_time: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) start_zone: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) end_date: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) end_time: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) end_zone: Option<String>,
    pub(crate) place: String,
    pub(crate) destination: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) cancel_date: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) cancel_time: Option<String>,
    pub(crate) link: String,
    pub(crate) memo: String,
    #[serde(default)]
    pub(crate) vouchers: Vec<Voucher>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Share {
    pub(crate) person: String,
    pub(crate) weight: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Expense {
    pub(crate) id: String,
    pub(crate) travel_id: String,
    pub(crate) title: String,
    pub(crate) date: String,
    pub(crate) amount: u64,
    pub(crate) currency: String,
    pub(crate) rate: u64,
    pub(crate) category: String,
    pub(crate) paid: bool,
    pub(crate) payer: String,
    pub(crate) shares: Vec<Share>,
    pub(crate) memo: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) booking_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) ledger_entry_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Person {
    pub(crate) id: String,
    pub(crate) travel_id: String,
    pub(crate) name: String,
    pub(crate) color: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Transfer {
    pub(crate) id: String,
    pub(crate) travel_id: String,
    pub(crate) from: String,
    pub(crate) to: String,
    pub(crate) amount: u64,
    pub(crate) date: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Photo {
    pub(crate) id: String,
    pub(crate) travel_id: String,
    /// The original stays where it is; only its path is kept.
    pub(crate) path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) thumb: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) taken_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) date: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) lat: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) lng: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) plan_id: Option<String>,
    #[serde(default)]
    pub(crate) cover: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TravelSettings {
    /// Real map tiles and address search send requests to OpenStreetMap; both start off.
    #[serde(default)]
    pub(crate) map_tiles: bool,
    #[serde(default)]
    pub(crate) address_search: bool,
}

/// The trip's stage by its own local date: planning until a week before, then before,
/// traveling through the last day, wrapping until the user finishes it.
pub(crate) fn stage(travel: &Travel, now: chrono::DateTime<chrono::Utc>) -> (&'static str, i64) {
    let today = travel
        .time_zone
        .parse::<Tz>()
        .map(|tz| now.with_timezone(&tz).date_naive())
        .unwrap_or_else(|_| now.date_naive());
    let start = NaiveDate::parse_from_str(&travel.start_date, "%Y-%m-%d").unwrap_or(today);
    let end = NaiveDate::parse_from_str(&travel.end_date, "%Y-%m-%d").unwrap_or(start);
    let days = (start - today).num_days();
    let stage = if travel.finished {
        "done"
    } else if today > end {
        "wrapping"
    } else if today >= start {
        "traveling"
    } else if days > 7 {
        "planning"
    } else {
        "before"
    };
    (stage, days)
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
    match input.get(key).and_then(Value::as_str) {
        Some("") => Ok(None),
        _ => optional_string(input, key, 64)?.map(zone).transpose(),
    }
}

fn optional_date(input: &Value, key: &str) -> Result<Option<String>> {
    match input.get(key).and_then(Value::as_str) {
        Some("") => Ok(None),
        _ => optional_string(input, key, 10)?.map(date).transpose(),
    }
}

pub(crate) fn instant(day: &str, at: &str, zone: &str) -> Result<i64> {
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

fn currency(input: &Value) -> Result<String> {
    let value = string(input, "currency", 3, true)?;
    if value.len() != 3 || !value.chars().all(|c| c.is_ascii_uppercase()) {
        return Err("통화는 KRW처럼 영문 대문자 3자로 적어 주세요.".into());
    }
    Ok(value)
}

fn money(input: &Value, key: &str, limit: u64) -> Result<u64> {
    input
        .get(key)
        .and_then(Value::as_u64)
        .filter(|value| *value <= limit)
        .ok_or_else(|| format!("{key} 금액은 0 이상의 정수여야 합니다."))
}

/// KRW per one unit of `currency`, scaled by 10,000. Won is always 1:1.
fn rate(input: &Value, currency: &str) -> Result<u64> {
    if currency == "KRW" {
        return Ok(10_000);
    }
    input
        .get("rate")
        .and_then(Value::as_u64)
        .filter(|value| (1..=MAX_RATE).contains(value))
        .ok_or_else(|| "환율을 적어 주세요. 1단위가 몇 원인지 입력해요.".into())
}

pub(crate) fn exponent(currency: &str) -> u32 {
    if ZERO_DECIMAL.contains(&currency) {
        0
    } else {
        2
    }
}

/// Won value of an amount in minor units, rounded to the nearest won.
pub(crate) fn won(amount: u64, currency: &str, rate: u64) -> u64 {
    let scale = 10u128.pow(exponent(currency)) * 10_000;
    ((u128::from(amount) * u128::from(rate) + scale / 2) / scale) as u64
}

fn coordinate(input: &Value, key: &str, limit: i64) -> Result<Option<i64>> {
    match input.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => value
            .as_i64()
            .filter(|value| value.abs() <= limit)
            .map(Some)
            .ok_or_else(|| "위치가 올바르지 않습니다.".into()),
    }
}

fn link(input: &Value) -> Result<String> {
    let value = string(input, "link", 2000, false)?;
    if !value.is_empty() && !(value.starts_with("https://") || value.starts_with("http://")) {
        return Err("링크는 http:// 또는 https://로 시작해야 합니다.".into());
    }
    Ok(value)
}

fn owner<'a>(state: &'a DiaryState, input: &Value) -> Result<&'a Travel> {
    let id = string(input, "travelId", 200, true)?;
    state
        .travels
        .iter()
        .find(|value| value.id == id)
        .ok_or_else(|| "여행을 찾을 수 없습니다.".into())
}

fn ledger_category(state: &DiaryState, input: &Value) -> Result<String> {
    let id = string(input, "category", 100, true)?;
    if !state.ledger_settings.has_category(&id) {
        return Err("가계부 분류를 찾을 수 없습니다.".into());
    }
    Ok(id)
}

fn travel(input: &Value, id: String, finished: bool) -> Result<Travel> {
    let start_date = date(string(input, "startDate", 10, true)?)?;
    let end_date = date(string(input, "endDate", 10, true)?)?;
    let start = NaiveDate::parse_from_str(&start_date, "%Y-%m-%d").map_err(super::err)?;
    let end = NaiveDate::parse_from_str(&end_date, "%Y-%m-%d").map_err(super::err)?;
    if end < start || (end - start).num_days() >= MAX_DAYS {
        return Err("여행 기간은 첫날부터 1년 안이어야 합니다.".into());
    }
    Ok(Travel {
        id,
        title: string(input, "title", 100, true)?,
        destination: string(input, "destination", 100, false)?,
        start_date,
        end_date,
        time_zone: zone(string(input, "timeZone", 64, true)?)?,
        currency: currency(input)?,
        budget: money(input, "budget", MAX_BUDGET)?,
        envelope_id: optional_string(input, "envelopeId", 200)?,
        finished: boolean(input, "finished", finished)?,
    })
}

fn plan(state: &DiaryState, input: &Value, id: String) -> Result<TravelPlan> {
    let owner = owner(state, input)?;
    let booking_id = optional_string(input, "bookingId", 200)?;
    if booking_id.as_ref().is_some_and(|booking| {
        !state
            .travel_bookings
            .iter()
            .any(|value| &value.id == booking && value.travel_id == owner.id)
    }) {
        return Err("연결할 예약을 찾을 수 없습니다.".into());
    }
    let lat = coordinate(input, "lat", 90_000_000)?;
    let lng = coordinate(input, "lng", 180_000_000)?;
    if lat.is_some() != lng.is_some() {
        return Err("위치는 위도와 경도를 함께 적어야 합니다.".into());
    }
    let mut value = TravelPlan {
        id,
        travel_id: owner.id.clone(),
        date: date(string(input, "date", 10, true)?)?,
        time: time(input, "time")?,
        title: string(input, "title", 200, true)?,
        place: string(input, "place", 200, false)?,
        memo: string(input, "memo", 2000, false)?,
        arrive_date: None,
        arrive_time: None,
        depart_zone: None,
        arrive_zone: None,
        lat,
        lng,
        booking_id,
        kind: string(input, "kind", 10, true)?,
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

fn voucher_file(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 200
        && !value.starts_with('.')
        && value
            .chars()
            .all(|c| c.is_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

fn booking(state: &DiaryState, input: &Value, id: String) -> Result<Booking> {
    let owner = owner(state, input)?;
    let kind = string(input, "kind", 10, true)?;
    if !BOOKING_KINDS.contains(&kind.as_str()) {
        return Err("예약 종류가 올바르지 않습니다.".into());
    }
    let status = string(input, "status", 10, true)?;
    if !matches!(status.as_str(), "paid" | "onsite" | "unpaid") {
        return Err("결제 상태가 올바르지 않습니다.".into());
    }
    let currency = currency(input)?;
    let vouchers: Vec<Voucher> = serde_json::from_value(
        input
            .get("vouchers")
            .cloned()
            .unwrap_or(Value::Array(vec![])),
    )
    .map_err(|_| "바우처 목록이 올바르지 않습니다.")?;
    if vouchers.len() > 20
        || vouchers.iter().any(|value| {
            !voucher_file(&value.file) || value.name.trim().is_empty() || value.name.len() > 300
        })
    {
        return Err("바우처는 20개까지, 올바른 파일만 붙일 수 있습니다.".into());
    }
    let start_date = date(string(input, "startDate", 10, true)?)?;
    let start_time = time(input, "startTime")?;
    let start_zone = optional_zone(input, "startZone")?;
    let end_date = optional_date(input, "endDate")?;
    let end_time = time(input, "endTime")?;
    let end_zone = optional_zone(input, "endZone")?;
    if end_time.is_some() && end_date.is_none() {
        return Err("끝나는 시각에는 날짜가 필요합니다.".into());
    }
    if let (Some(start), Some(end_day), Some(end)) = (&start_time, &end_date, &end_time) {
        let begins = instant(
            &start_date,
            start,
            start_zone.as_deref().unwrap_or(&owner.time_zone),
        )?;
        let ends = instant(
            end_day,
            end,
            end_zone.as_deref().unwrap_or(&owner.time_zone),
        )?;
        if ends < begins {
            return Err("끝나는 때가 시작보다 빨라요. 날짜와 시간대를 확인해 주세요.".into());
        }
    } else if end_date.as_ref().is_some_and(|end| end < &start_date) {
        return Err("끝나는 날이 시작보다 빨라요.".into());
    }
    let cancel_date = optional_date(input, "cancelDate")?;
    let cancel_time = time(input, "cancelTime")?;
    if cancel_time.is_some() && cancel_date.is_none() {
        return Err("무료 취소 마감 시각에는 날짜가 필요합니다.".into());
    }
    Ok(Booking {
        id,
        travel_id: owner.id.clone(),
        kind,
        title: string(input, "title", 200, true)?,
        vendor: string(input, "vendor", 200, false)?,
        confirmation: string(input, "confirmation", 100, false)?,
        paid_date: if status == "paid" {
            optional_date(input, "paidDate")?
        } else {
            None
        },
        status,
        amount: money(input, "amount", MAX_MINOR)?,
        rate: rate(input, &currency)?,
        currency,
        category: ledger_category(state, input)?,
        start_date,
        start_time,
        start_zone,
        end_date,
        end_time,
        end_zone,
        place: string(input, "place", 300, false)?,
        destination: string(input, "destination", 300, false)?,
        cancel_date,
        cancel_time,
        link: link(input)?,
        memo: string(input, "memo", 2000, false)?,
        vouchers,
    })
}

fn person_ids(state: &DiaryState, travel_id: &str) -> BTreeSet<String> {
    let mut ids: BTreeSet<String> = state
        .travel_people
        .iter()
        .filter(|value| value.travel_id == travel_id)
        .map(|value| value.id.clone())
        .collect();
    ids.insert(ME.into());
    ids
}

fn everyone(state: &DiaryState, travel_id: &str) -> Vec<Share> {
    person_ids(state, travel_id)
        .into_iter()
        .map(|person| Share { person, weight: 1 })
        .collect()
}

fn shares(state: &DiaryState, travel_id: &str, input: &Value) -> Result<Vec<Share>> {
    let value: Vec<Share> =
        serde_json::from_value(input.get("shares").cloned().unwrap_or_default())
            .map_err(|_| "나눌 사람 목록이 올바르지 않습니다.")?;
    let known = person_ids(state, travel_id);
    let mut seen = BTreeSet::new();
    if value.is_empty()
        || value.iter().any(|share| {
            !known.contains(&share.person)
                || !(1..=100).contains(&share.weight)
                || !seen.insert(share.person.clone())
        })
    {
        return Err("나눌 사람과 몫을 다시 골라 주세요.".into());
    }
    Ok(value)
}

fn expense(state: &DiaryState, input: &Value, id: String) -> Result<Expense> {
    let owner = owner(state, input)?;
    let currency = currency(input)?;
    let payer = string(input, "payer", 200, true)?;
    if !person_ids(state, &owner.id).contains(&payer) {
        return Err("낸 사람을 찾을 수 없습니다.".into());
    }
    let amount = money(input, "amount", MAX_MINOR)?;
    if amount == 0 {
        return Err("금액을 적어 주세요.".into());
    }
    Ok(Expense {
        id,
        travel_id: owner.id.clone(),
        title: string(input, "title", 200, true)?,
        date: date(string(input, "date", 10, true)?)?,
        amount,
        rate: rate(input, &currency)?,
        currency,
        category: ledger_category(state, input)?,
        paid: boolean(input, "paid", true)?,
        payer,
        shares: shares(state, &owner.id, input)?,
        memo: string(input, "memo", 2000, false)?,
        booking_id: None,
        ledger_entry_id: None,
    })
}

/// Largest remainder in whole won. Stable person IDs break ties, never payer or array order.
/// Keep this identical to travelMoney.ts; results retain the input share order.
fn split_shares(expense: &Expense) -> Vec<u64> {
    let total: u128 = expense
        .shares
        .iter()
        .map(|share| u128::from(share.weight))
        .sum();
    let mut amounts = vec![0; expense.shares.len()];
    if total == 0 {
        return amounts;
    }
    let value = u128::from(won(expense.amount, &expense.currency, expense.rate));
    let mut remainders: Vec<_> = expense
        .shares
        .iter()
        .enumerate()
        .map(|(index, share)| {
            let weighted = value * u128::from(share.weight);
            amounts[index] = (weighted / total) as u64;
            (index, weighted % total)
        })
        .collect();
    let remaining = value
        - amounts
            .iter()
            .map(|amount| u128::from(*amount))
            .sum::<u128>();
    remainders.sort_by(|(a, left), (b, right)| {
        right
            .cmp(left)
            .then_with(|| expense.shares[*a].person.cmp(&expense.shares[*b].person))
    });
    for (index, _) in remainders.into_iter().take(remaining as usize) {
        amounts[index] += 1;
    }
    amounts
}

/// My part of an expense in won. The ledger keeps only this, never the whole bill.
pub(crate) fn my_share(expense: &Expense) -> u64 {
    expense
        .shares
        .iter()
        .zip(split_shares(expense))
        .find(|(share, _)| share.person == ME)
        .map_or(0, |(_, amount)| amount)
}

/// Upgrade only amounts that still match the old derived rounding. Do not recreate deleted links,
/// overwrite manual amounts or metadata, or delete a historical entry whose new share is zero.
pub(super) fn reconcile_split_rounding(state: &mut DiaryState) -> bool {
    let mut changed = false;
    for expense in state.travel_expenses.iter().filter(|expense| expense.paid) {
        let Some(entry) = expense.ledger_entry_id.as_ref().and_then(|id| {
            state
                .ledger_entries
                .iter_mut()
                .find(|entry| &entry.id == id)
        }) else {
            continue;
        };
        let total: u128 = expense
            .shares
            .iter()
            .map(|share| u128::from(share.weight))
            .sum();
        if total == 0 || entry.kind != "expense" {
            continue;
        }
        let mine = expense
            .shares
            .iter()
            .find(|share| share.person == ME)
            .map_or(0, |share| u128::from(share.weight));
        let value = u128::from(won(expense.amount, &expense.currency, expense.rate));
        let previous = ((value * mine + total / 2) / total) as u64;
        let current = my_share(expense);
        if entry.amount == previous && entry.amount != current {
            entry.amount = current;
            changed = true;
        }
    }
    changed
}

/// Keeps the linked ledger entry equal to my paid share. A link whose entry was
/// deleted in the ledger stays deleted until the expense is marked unpaid and paid again.
fn sync_ledger(state: &mut DiaryState, expense_id: &str) -> Result<()> {
    let Some(at) = state
        .travel_expenses
        .iter()
        .position(|value| value.id == expense_id)
    else {
        return Ok(());
    };
    let expense = state.travel_expenses[at].clone();
    let title = state
        .travels
        .iter()
        .find(|value| value.id == expense.travel_id)
        .map(|value| value.title.clone())
        .unwrap_or_default();
    let amount = my_share(&expense);
    let entry_at = expense.ledger_entry_id.as_ref().and_then(|id| {
        state
            .ledger_entries
            .iter()
            .position(|entry| &entry.id == id)
    });
    if !expense.paid || amount == 0 {
        if let Some(entry_at) = entry_at {
            state.ledger_entries.remove(entry_at);
        }
        state.travel_expenses[at].ledger_entry_id = None;
        return Ok(());
    }
    let category = if state.ledger_settings.has_category(&expense.category) {
        expense.category.clone()
    } else {
        state
            .ledger_settings
            .first_category()
            .ok_or("가계부 분류가 없습니다.")?
            .to_string()
    };
    let entry = LedgerEntry {
        id: expense.ledger_entry_id.clone().unwrap_or_else(new_id),
        date: expense.date.clone(),
        kind: "expense".into(),
        amount,
        category,
        title: expense.title.clone(),
        memo: format!("여행 · {title}"),
        recurring_id: None,
        occurrence_date: None,
    };
    match (entry_at, &expense.ledger_entry_id) {
        (Some(entry_at), _) => state.ledger_entries[entry_at] = entry,
        (None, None) => {
            capacity(state.ledger_entries.len(), 20_000)?;
            state.travel_expenses[at].ledger_entry_id = Some(entry.id.clone());
            state.ledger_entries.push(entry);
        }
        (None, Some(_)) => {}
    }
    Ok(())
}

fn remove_expense(state: &mut DiaryState, at: usize) {
    let removed = state.travel_expenses.remove(at);
    if let Some(id) = removed.ledger_entry_id {
        state.ledger_entries.retain(|entry| entry.id != id);
    }
}

/// A booking with a price is one expense: paid ones reach the ledger, on-site ones wait.
fn sync_booking_expense(state: &mut DiaryState, booking_id: &str) -> Result<()> {
    let booking = state
        .travel_bookings
        .iter()
        .find(|value| value.id == booking_id)
        .cloned();
    let at = state
        .travel_expenses
        .iter()
        .position(|value| value.booking_id.as_deref() == Some(booking_id));
    let Some(booking) = booking.filter(|value| value.amount > 0) else {
        if let Some(at) = at {
            remove_expense(state, at);
        }
        return Ok(());
    };
    let paid = booking.status == "paid";
    let date = booking
        .paid_date
        .clone()
        .unwrap_or_else(|| booking.start_date.clone());
    let id = match at {
        Some(at) => {
            let expense = &mut state.travel_expenses[at];
            let was_paid = expense.paid;
            expense.title = booking.title.clone();
            expense.date = date;
            expense.amount = booking.amount;
            expense.currency = booking.currency.clone();
            expense.rate = booking.rate;
            expense.category = booking.category.clone();
            expense.paid = paid;
            if paid && !was_paid {
                // Paying again after an unpaid state creates the ledger record anew.
                expense.ledger_entry_id = None;
            }
            expense.id.clone()
        }
        None => {
            capacity(state.travel_expenses.len(), 20_000)?;
            let id = new_id();
            let shares = everyone(state, &booking.travel_id);
            state.travel_expenses.push(Expense {
                id: id.clone(),
                travel_id: booking.travel_id.clone(),
                title: booking.title.clone(),
                date,
                amount: booking.amount,
                currency: booking.currency.clone(),
                rate: booking.rate,
                category: booking.category.clone(),
                paid,
                payer: ME.into(),
                shares,
                memo: String::new(),
                booking_id: Some(booking.id.clone()),
                ledger_entry_id: None,
            });
            id
        }
    };
    sync_ledger(state, &id)
}

fn sync_travel_ledger(state: &mut DiaryState, travel_id: &str) -> Result<()> {
    let ids: Vec<String> = state
        .travel_expenses
        .iter()
        .filter(|value| value.travel_id == travel_id)
        .map(|value| value.id.clone())
        .collect();
    for id in ids {
        sync_ledger(state, &id)?;
    }
    Ok(())
}

fn person_ref(state: &DiaryState, travel_id: &str, input: &Value, key: &str) -> Result<String> {
    let value = string(input, key, 200, true)?;
    if !person_ids(state, travel_id).contains(&value) {
        return Err("사람을 찾을 수 없습니다.".into());
    }
    Ok(value)
}

fn photo(state: &DiaryState, travel_id: &str, value: &Value, id: String) -> Result<Photo> {
    let path = string(value, "path", 4096, true)?;
    let thumb = optional_string(value, "thumb", 200)?;
    if thumb.as_deref().is_some_and(|file| !voucher_file(file)) {
        return Err("미리보기 파일 이름이 올바르지 않습니다.".into());
    }
    let taken_at = optional_string(value, "takenAt", 16)?;
    if let Some(at) = &taken_at {
        NaiveDateTime::parse_from_str(at, "%Y-%m-%dT%H:%M")
            .map_err(|_| "찍은 시각이 올바르지 않습니다.")?;
    }
    let plan_id = optional_string(value, "planId", 200)?;
    if plan_id.as_ref().is_some_and(|plan| {
        !state
            .travel_plans
            .iter()
            .any(|value| &value.id == plan && value.travel_id == travel_id)
    }) {
        return Err("붙일 장소를 찾을 수 없습니다.".into());
    }
    let lat = coordinate(value, "lat", 90_000_000)?;
    let lng = coordinate(value, "lng", 180_000_000)?;
    if lat.is_some() != lng.is_some() {
        return Err("사진 위치가 올바르지 않습니다.".into());
    }
    Ok(Photo {
        id,
        travel_id: travel_id.into(),
        path,
        thumb,
        taken_at,
        date: optional_date(value, "date")?,
        lat,
        lng,
        plan_id,
        cover: boolean(value, "cover", false)?,
    })
}

fn position<T>(
    items: &[T],
    input: &Value,
    id_of: impl Fn(&T) -> &str,
    missing: &str,
) -> Result<usize> {
    let id = string(input, "id", 200, true)?;
    items
        .iter()
        .position(|value| id_of(value) == id)
        .ok_or_else(|| missing.into())
}

pub(super) fn mutate(state: &mut DiaryState, action: &str, input: &Value) -> Result<()> {
    match action {
        "travel-create" => {
            capacity(state.travels.len(), 500)?;
            let value = travel(input, new_id(), false)?;
            state.travels.push(value);
        }
        "travel-update" | "travel-delete" => {
            let at = position(
                &state.travels,
                input,
                |v| v.id.as_str(),
                "여행을 찾을 수 없습니다.",
            )?;
            check_expected(input, &state.travels[at])?;
            let id = state.travels[at].id.clone();
            if action == "travel-delete" {
                state.travels.remove(at);
                state.travel_plans.retain(|value| value.travel_id != id);
                state.travel_bookings.retain(|value| value.travel_id != id);
                // Money already spent stays in the ledger; only the link to the trip goes away.
                state.travel_expenses.retain(|value| value.travel_id != id);
                state.travel_people.retain(|value| value.travel_id != id);
                state.travel_transfers.retain(|value| value.travel_id != id);
                state.travel_photos.retain(|value| value.travel_id != id);
            } else {
                let finished = state.travels[at].finished;
                let title_changed = input.get("title").and_then(Value::as_str)
                    != Some(state.travels[at].title.as_str());
                state.travels[at] = travel(input, id.clone(), finished)?;
                if title_changed {
                    sync_travel_ledger(state, &id)?;
                }
            }
        }
        "travel-plan-create" => {
            capacity(state.travel_plans.len(), 20_000)?;
            let value = plan(state, input, new_id())?;
            state.travel_plans.push(value);
        }
        "travel-plan-update" | "travel-plan-delete" => {
            let at = position(
                &state.travel_plans,
                input,
                |v| v.id.as_str(),
                "일정을 찾을 수 없습니다.",
            )?;
            check_expected(input, &state.travel_plans[at])?;
            if action == "travel-plan-delete" {
                let removed = state.travel_plans.remove(at);
                for photo in &mut state.travel_photos {
                    if photo.plan_id.as_deref() == Some(removed.id.as_str()) {
                        photo.plan_id = None;
                    }
                }
            } else {
                let value = plan(state, input, state.travel_plans[at].id.clone())?;
                if value.travel_id != state.travel_plans[at].travel_id {
                    return Err("일정을 다른 여행으로 옮길 수 없습니다.".into());
                }
                state.travel_plans[at] = value;
            }
        }
        "travel-booking-create" => {
            capacity(state.travel_bookings.len(), 5_000)?;
            let value = booking(state, input, new_id())?;
            let id = value.id.clone();
            state.travel_bookings.push(value);
            sync_booking_expense(state, &id)?;
        }
        "travel-booking-update" | "travel-booking-delete" => {
            let at = position(
                &state.travel_bookings,
                input,
                |v| v.id.as_str(),
                "예약을 찾을 수 없습니다.",
            )?;
            check_expected(input, &state.travel_bookings[at])?;
            let id = state.travel_bookings[at].id.clone();
            if action == "travel-booking-delete" {
                state.travel_bookings.remove(at);
                for plan in &mut state.travel_plans {
                    if plan.booking_id.as_deref() == Some(id.as_str()) {
                        plan.booking_id = None;
                    }
                }
            } else {
                let value = booking(state, input, id.clone())?;
                if value.travel_id != state.travel_bookings[at].travel_id {
                    return Err("예약을 다른 여행으로 옮길 수 없습니다.".into());
                }
                state.travel_bookings[at] = value;
            }
            sync_booking_expense(state, &id)?;
        }
        "travel-expense-create" => {
            capacity(state.travel_expenses.len(), 20_000)?;
            let value = expense(state, input, new_id())?;
            let id = value.id.clone();
            state.travel_expenses.push(value);
            sync_ledger(state, &id)?;
        }
        "travel-expense-update" | "travel-expense-delete" => {
            let at = position(
                &state.travel_expenses,
                input,
                |v| v.id.as_str(),
                "비용을 찾을 수 없습니다.",
            )?;
            check_expected(input, &state.travel_expenses[at])?;
            let current = state.travel_expenses[at].clone();
            if action == "travel-expense-delete" {
                if current.booking_id.is_some() {
                    return Err(
                        "예약에서 생긴 비용은 예약에서 금액을 지우거나 예약을 지워 주세요.".into(),
                    );
                }
                remove_expense(state, at);
                return Ok(());
            }
            let mut value = expense(state, input, current.id.clone())?;
            if value.travel_id != current.travel_id {
                return Err("비용을 다른 여행으로 옮길 수 없습니다.".into());
            }
            if current.booking_id.is_some() {
                // The booking owns the price, date and payment state; here only who pays and shares change.
                value.title = current.title.clone();
                value.date = current.date.clone();
                value.amount = current.amount;
                value.currency = current.currency.clone();
                value.rate = current.rate;
                value.category = current.category.clone();
                value.paid = current.paid;
                value.booking_id = current.booking_id.clone();
            }
            value.ledger_entry_id = if value.paid && !current.paid {
                None
            } else {
                current.ledger_entry_id.clone()
            };
            if !value.paid {
                if let Some(id) = &current.ledger_entry_id {
                    state.ledger_entries.retain(|entry| &entry.id != id);
                }
                value.ledger_entry_id = None;
            }
            state.travel_expenses[at] = value;
            sync_ledger(state, &current.id)?;
        }
        "travel-person-create" => {
            capacity(state.travel_people.len(), 2_000)?;
            let owner = owner(state, input)?.id.clone();
            if state
                .travel_people
                .iter()
                .filter(|v| v.travel_id == owner)
                .count()
                >= 30
            {
                return Err("함께 가는 사람은 30명까지 적을 수 있어요.".into());
            }
            let color = string(input, "color", 20, true)?;
            if !PERSON_COLORS.contains(&color.as_str()) {
                return Err("색을 다시 골라 주세요.".into());
            }
            let person = Person {
                id: new_id(),
                travel_id: owner.clone(),
                name: string(input, "name", 30, true)?,
                color,
            };
            let id = person.id.clone();
            state.travel_people.push(person);
            if boolean(input, "joinShares", true)? {
                // A new companion shares every bill split evenly so far; custom splits stay as they are.
                for expense in state
                    .travel_expenses
                    .iter_mut()
                    .filter(|v| v.travel_id == owner)
                {
                    if expense.shares.iter().all(|share| share.weight == 1) {
                        expense.shares.push(Share {
                            person: id.clone(),
                            weight: 1,
                        });
                    }
                }
                sync_travel_ledger(state, &owner)?;
            }
        }
        "travel-person-update" | "travel-person-delete" => {
            let at = position(
                &state.travel_people,
                input,
                |v| v.id.as_str(),
                "사람을 찾을 수 없습니다.",
            )?;
            check_expected(input, &state.travel_people[at])?;
            let current = state.travel_people[at].clone();
            if action == "travel-person-delete" {
                if state.travel_expenses.iter().any(|v| v.payer == current.id)
                    || state
                        .travel_transfers
                        .iter()
                        .any(|v| v.from == current.id || v.to == current.id)
                {
                    return Err(
                        "이 사람이 낸 비용이나 보낸 기록이 있어요. 먼저 그 기록을 바꿔 주세요."
                            .into(),
                    );
                }
                state.travel_people.remove(at);
                for expense in &mut state.travel_expenses {
                    expense.shares.retain(|share| share.person != current.id);
                    if expense.shares.is_empty() {
                        expense.shares.push(Share {
                            person: ME.into(),
                            weight: 1,
                        });
                    }
                }
                sync_travel_ledger(state, &current.travel_id)?;
            } else {
                let color = string(input, "color", 20, true)?;
                if !PERSON_COLORS.contains(&color.as_str()) {
                    return Err("색을 다시 골라 주세요.".into());
                }
                state.travel_people[at].name = string(input, "name", 30, true)?;
                state.travel_people[at].color = color;
            }
        }
        "travel-transfer-create" => {
            capacity(state.travel_transfers.len(), 20_000)?;
            let owner = owner(state, input)?.id.clone();
            let from = person_ref(state, &owner, input, "from")?;
            let to = person_ref(state, &owner, input, "to")?;
            if from == to {
                return Err("보내는 사람과 받는 사람이 같아요.".into());
            }
            let amount = money(input, "amount", MAX_BUDGET)?;
            if amount == 0 {
                return Err("보낸 금액을 적어 주세요.".into());
            }
            state.travel_transfers.push(Transfer {
                id: new_id(),
                travel_id: owner,
                from,
                to,
                amount,
                date: date(string(input, "date", 10, true)?)?,
            });
        }
        "travel-transfer-delete" => {
            let at = position(
                &state.travel_transfers,
                input,
                |v| v.id.as_str(),
                "보낸 기록을 찾을 수 없습니다.",
            )?;
            check_expected(input, &state.travel_transfers[at])?;
            state.travel_transfers.remove(at);
        }
        "travel-photo-add" => {
            let owner = owner(state, input)?.id.clone();
            let photos = input
                .get("photos")
                .and_then(Value::as_array)
                .filter(|value| !value.is_empty() && value.len() <= 500)
                .ok_or("넣을 사진을 골라 주세요.")?;
            capacity(state.travel_photos.len() + photos.len() - 1, 50_000)?;
            let mut known: BTreeSet<String> = state
                .travel_photos
                .iter()
                .filter(|v| v.travel_id == owner)
                .map(|v| v.path.clone())
                .collect();
            for value in photos {
                let photo = photo(state, &owner, value, new_id())?;
                // The same original added twice stays one photo.
                if known.insert(photo.path.clone()) {
                    state.travel_photos.push(photo);
                }
            }
        }
        "travel-photo-update" | "travel-photo-delete" => {
            let at = position(
                &state.travel_photos,
                input,
                |v| v.id.as_str(),
                "사진을 찾을 수 없습니다.",
            )?;
            check_expected(input, &state.travel_photos[at])?;
            if action == "travel-photo-delete" {
                state.travel_photos.remove(at);
                return Ok(());
            }
            let current = state.travel_photos[at].clone();
            let mut next = photo(state, &current.travel_id, input, current.id.clone())?;
            next.path = current.path;
            next.thumb = current.thumb;
            if next.cover {
                for other in &mut state.travel_photos {
                    if other.travel_id == current.travel_id {
                        other.cover = false;
                    }
                }
            }
            state.travel_photos[at] = next;
        }
        "travel-photo-shift" => {
            let owner = owner(state, input)?.id.clone();
            let minutes = input
                .get("minutes")
                .and_then(Value::as_i64)
                .filter(|value| *value != 0 && value.abs() <= 48 * 60)
                .ok_or("옮길 시간은 48시간 안이어야 합니다.")?;
            for photo in state
                .travel_photos
                .iter_mut()
                .filter(|v| v.travel_id == owner)
            {
                let Some(at) = &photo.taken_at else { continue };
                let shifted = NaiveDateTime::parse_from_str(at, "%Y-%m-%dT%H:%M")
                    .map_err(super::err)?
                    + chrono::Duration::minutes(minutes);
                photo.taken_at = Some(shifted.format("%Y-%m-%dT%H:%M").to_string());
                photo.date = Some(shifted.format("%Y-%m-%d").to_string());
            }
        }
        "travel-settings-update" => {
            check_expected(input, &state.travel_settings)?;
            state.travel_settings = TravelSettings {
                map_tiles: boolean(input, "mapTiles", false)?,
                address_search: boolean(input, "addressSearch", false)?,
            };
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

    fn act(state: &mut DiaryState, action: &str, input: Value) {
        mutate(state, action, &input).unwrap_or_else(|error| panic!("{action}: {error}"));
    }

    fn with_expected<T: Serialize>(mut input: Value, id: &str, current: &T) -> Value {
        input["id"] = json!(id);
        input["expected"] = serde_json::to_value(current).unwrap();
        input
    }

    fn stay(travel: &str) -> Value {
        json!({
            "travelId": travel, "kind": "stay", "title": "애월 숙소", "vendor": "",
            "confirmation": "AB12-4821", "status": "paid", "amount": 400_000,
            "currency": "KRW", "category": "living", "paidDate": "2026-10-01",
            "startDate": "2026-10-24", "startTime": "15:00", "endDate": "2026-10-25",
            "endTime": "11:00", "place": "애월", "destination": "", "link": "", "memo": "",
            "cancelDate": "2026-10-21", "cancelTime": "23:59"
        })
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
        let current = state.travels[0].clone();
        let mut input = with_expected(jeju(), &current.id, &current);
        input["finished"] = json!(true);
        act(&mut state, "travel-update", input.clone());
        assert!(state.travels[0].finished);
        let mut stale = input.clone();
        stale["title"] = json!("덮어쓰기");
        assert!(mutate(&mut state, "travel-update", &stale).is_err());
        let fresh = with_expected(jeju(), &current.id, &state.travels[0].clone());
        act(&mut state, "travel-update", fresh);
        assert!(state.travels[0].finished);
    }

    #[test]
    fn moves_compute_across_zones_and_deleting_travel_removes_its_records_but_not_ledger() {
        let mut state = created();
        let travel_id = state.travels[0].id.clone();
        let flight = json!({
            "travelId": travel_id, "kind": "move", "date": "2026-10-24", "time": "09:10",
            "title": "김포 → 제주", "place": "", "memo": "",
            "arriveDate": "2026-10-24", "arriveTime": "10:20"
        });
        act(&mut state, "travel-plan-create", flight.clone());
        // 도쿄 12:00 출발 → 서울 14:20 도착은 2시간 20분, 15:00 출발이면 도착이 더 빨라 거절한다.
        let mut abroad = flight.clone();
        abroad["time"] = json!("12:00");
        abroad["departZone"] = json!("Asia/Tokyo");
        abroad["arriveTime"] = json!("14:20");
        act(&mut state, "travel-plan-create", abroad.clone());
        abroad["time"] = json!("15:00");
        assert!(mutate(&mut state, "travel-plan-create", &abroad).is_err());
        let mut plain = flight.clone();
        plain["kind"] = json!("plan");
        plain["time"] = json!("");
        plain["lat"] = json!(33_394_000);
        plain["lng"] = json!(126_239_000);
        act(&mut state, "travel-plan-create", plain.clone());
        assert_eq!(state.travel_plans[2].arrive_date, None);
        assert_eq!(state.travel_plans[2].lat, Some(33_394_000));
        plain["lng"] = Value::Null;
        assert!(mutate(&mut state, "travel-plan-create", &plain).is_err());
        act(&mut state, "travel-booking-create", stay(&travel_id));
        assert_eq!(state.ledger_entries.len(), 1);
        let current = state.travels[0].clone();
        act(
            &mut state,
            "travel-delete",
            json!({"id": travel_id, "expected": current}),
        );
        assert!(state.travels.is_empty() && state.travel_plans.is_empty());
        assert!(state.travel_bookings.is_empty() && state.travel_expenses.is_empty());
        assert_eq!(state.ledger_entries.len(), 1);
    }

    #[test]
    fn paid_bookings_put_only_my_share_in_the_ledger_and_follow_every_change() {
        let mut state = created();
        let travel_id = state.travels[0].id.clone();
        act(&mut state, "travel-booking-create", stay(&travel_id));
        assert_eq!(state.travel_expenses.len(), 1);
        assert_eq!(state.ledger_entries[0].amount, 400_000);
        assert_eq!(state.ledger_entries[0].date, "2026-10-01");
        assert_eq!(state.ledger_entries[0].memo, "여행 · 제주 가족 여행");
        // 동행 셋이 생기면 균등하게 나눈 비용에 함께 들어가고 내 몫만 가계부에 남는다.
        for name in ["엄마", "아빠", "동생"] {
            act(
                &mut state,
                "travel-person-create",
                json!({"travelId": travel_id, "name": name, "color": "coral"}),
            );
        }
        assert_eq!(state.ledger_entries[0].amount, 100_000);
        let booking = state.travel_bookings[0].clone();
        let mut onsite = with_expected(stay(&travel_id), &booking.id, &booking);
        onsite["status"] = json!("onsite");
        act(&mut state, "travel-booking-update", onsite);
        assert!(state.ledger_entries.is_empty());
        assert!(!state.travel_expenses[0].paid);
        let booking = state.travel_bookings[0].clone();
        let mut yen = with_expected(stay(&travel_id), &booking.id, &booking);
        yen["currency"] = json!("JPY");
        yen["amount"] = json!(10_000);
        yen["rate"] = json!(91_200);
        act(&mut state, "travel-booking-update", yen);
        assert_eq!(state.ledger_entries[0].amount, 22_800);
        let booking = state.travel_bookings[0].clone();
        act(
            &mut state,
            "travel-booking-delete",
            json!({"id": booking.id, "expected": booking}),
        );
        assert!(state.travel_expenses.is_empty() && state.ledger_entries.is_empty());
    }

    #[test]
    fn expenses_keep_rates_and_shares_and_a_ledger_deletion_is_not_undone_by_edits() {
        let mut state = created();
        let travel_id = state.travels[0].id.clone();
        act(
            &mut state,
            "travel-person-create",
            json!({"travelId": travel_id, "name": "동생", "color": "green", "joinShares": false}),
        );
        let sister = state.travel_people[0].id.clone();
        let dinner = json!({
            "travelId": travel_id, "title": "저녁", "date": "2026-10-24", "amount": 12_345,
            "currency": "USD", "rate": 13_800_000, "category": "food", "paid": true,
            "payer": "me", "shares": [{"person": "me", "weight": 1}, {"person": sister, "weight": 2}],
            "memo": ""
        });
        act(&mut state, "travel-expense-create", dinner.clone());
        // 123.45달러 × 1,380원 = 170,361원, 내 몫 1/3 = 56,787원
        assert_eq!(won(12_345, "USD", 13_800_000), 170_361);
        assert_eq!(state.ledger_entries[0].amount, 56_787);
        let expense = state.travel_expenses[0].clone();
        state.ledger_entries.clear();
        let mut renamed = with_expected(dinner.clone(), &expense.id, &expense);
        renamed["title"] = json!("흑돼지 저녁");
        act(&mut state, "travel-expense-update", renamed);
        assert!(state.ledger_entries.is_empty());
        let expense = state.travel_expenses[0].clone();
        let mut unpaid = with_expected(dinner.clone(), &expense.id, &expense);
        unpaid["paid"] = json!(false);
        act(&mut state, "travel-expense-update", unpaid);
        let expense = state.travel_expenses[0].clone();
        act(
            &mut state,
            "travel-expense-update",
            with_expected(dinner.clone(), &expense.id, &expense),
        );
        assert_eq!(state.ledger_entries.len(), 1);
        let person = state.travel_people[0].clone();
        assert!(mutate(
            &mut state,
            "travel-person-delete",
            &json!({"id": person.id, "expected": person})
        )
        .is_ok());
        assert_eq!(state.ledger_entries[0].amount, 170_361);
        let mut bad = dinner.clone();
        bad["shares"] = json!([{"person": "ghost", "weight": 1}]);
        assert!(mutate(&mut state, "travel-expense-create", &bad).is_err());
        let mut no_rate = dinner;
        no_rate["rate"] = json!(0);
        assert!(mutate(&mut state, "travel-expense-create", &no_rate).is_err());
    }

    #[test]
    fn saved_personal_shares_match_the_frontend_allocation_fixtures() {
        let fixtures: Vec<Value> = serde_json::from_str(include_str!(
            "../../../src/widgets/Travel/travelMoney.fixtures.json"
        ))
        .unwrap();
        for fixture in fixtures {
            let mut state = created();
            let mut bill = json!({
                "id": "split", "travelId": state.travels[0].id,
                "title": "비용", "date": "2026-10-24", "category": "food",
                "paid": true, "payer": "me", "memo": ""
            });
            for key in ["amount", "currency", "rate", "shares"] {
                bill[key] = fixture[key].clone();
            }
            let mut expense: Expense = serde_json::from_value(bill).unwrap();
            let expected = fixture["expected"][ME].as_u64().unwrap_or(0);
            for payer in ["me", "a", "z"] {
                expense.payer = payer.into();
                let amounts = split_shares(&expense);
                assert_eq!(
                    amounts.iter().sum::<u64>(),
                    fixture["won"].as_u64().unwrap()
                );
                for (share, amount) in expense.shares.iter().zip(amounts) {
                    assert_eq!(
                        amount,
                        fixture["expected"][&share.person].as_u64().unwrap(),
                        "{} / {}",
                        fixture["name"],
                        share.person
                    );
                }
                assert_eq!(my_share(&expense), expected, "{}", fixture["name"]);
                expense.shares.reverse();
                assert_eq!(my_share(&expense), expected, "{} reversed", fixture["name"]);
            }
            state.travel_expenses.push(expense);
            sync_ledger(&mut state, "split").unwrap();
            assert_eq!(
                state
                    .ledger_entries
                    .iter()
                    .map(|entry| entry.amount)
                    .sum::<u64>(),
                expected
            );
        }
    }

    #[test]
    fn split_upgrade_preserves_manual_history_metadata_and_deleted_links() {
        let mut state = created();
        for (id, amount, paid, ledger_amount, kind) in [
            ("derived", 101, true, 51, "expense"),
            ("manual", 101, true, 777, "expense"),
            ("income", 101, true, 51, "income"),
            ("unpaid", 101, false, 51, "expense"),
            ("zero", 1, true, 1, "expense"),
            ("divisible", 100, true, 50, "expense"),
        ] {
            state.travel_expenses.push(
                serde_json::from_value(json!({
                    "id": id, "travelId": state.travels[0].id,
                    "title": "비용", "date": "2026-10-24", "category": "food",
                    "paid": paid, "payer": "me", "memo": "", "amount": amount,
                    "currency": "KRW", "rate": 10000,
                    "shares": [{"person": "me", "weight": 1}, {"person": "a", "weight": 1}],
                    "ledgerEntryId": id
                }))
                .unwrap(),
            );
            state.ledger_entries.push(LedgerEntry {
                id: id.into(),
                date: "2026-10-24".into(),
                kind: kind.into(),
                amount: ledger_amount,
                category: "food".into(),
                title: "남길 제목".into(),
                memo: "남길 메모".into(),
                recurring_id: None,
                occurrence_date: None,
            });
        }
        let mut deleted = state.travel_expenses[0].clone();
        deleted.id = "deleted".into();
        deleted.ledger_entry_id = Some("missing".into());
        state.travel_expenses.push(deleted.clone());
        deleted.id = "unlinked".into();
        deleted.ledger_entry_id = None;
        state.travel_expenses.push(deleted);
        let mut unrelated = state.ledger_entries[0].clone();
        unrelated.id = "unrelated".into();
        state.ledger_entries.push(unrelated);
        let expenses = state.travel_expenses.clone();
        let mut expected = state.ledger_entries.clone();
        expected[0].amount = 50;
        expected[4].amount = 0;
        assert!(reconcile_split_rounding(&mut state));
        assert_eq!(state.ledger_entries, expected);
        assert_eq!(state.travel_expenses, expenses);
        assert!(!reconcile_split_rounding(&mut state));
    }

    #[test]
    fn payers_cannot_disappear_and_photos_dedupe_shift_and_keep_one_cover() {
        let mut state = created();
        let travel_id = state.travels[0].id.clone();
        act(
            &mut state,
            "travel-person-create",
            json!({"travelId": travel_id, "name": "아빠", "color": "blue"}),
        );
        let dad = state.travel_people[0].clone();
        act(
            &mut state,
            "travel-transfer-create",
            json!({"travelId": travel_id, "from": dad.id, "to": "me", "amount": 18_500, "date": "2026-10-26"}),
        );
        assert!(mutate(
            &mut state,
            "travel-person-delete",
            &json!({"id": dad.id, "expected": dad})
        )
        .is_err());
        let photos = json!({"travelId": travel_id, "photos": [
            {"path": "/p/a.jpg", "thumb": "a.jpg", "takenAt": "2026-10-24T23:30", "date": "2026-10-24"},
            {"path": "/p/a.jpg"},
            {"path": "/p/b.heic"}
        ]});
        act(&mut state, "travel-photo-add", photos);
        assert_eq!(state.travel_photos.len(), 2);
        act(
            &mut state,
            "travel-photo-shift",
            json!({"travelId": travel_id, "minutes": 60}),
        );
        assert_eq!(state.travel_photos[0].date.as_deref(), Some("2026-10-25"));
        assert_eq!(state.travel_photos[1].taken_at, None);
        for at in 0..2 {
            let photo = state.travel_photos[at].clone();
            act(
                &mut state,
                "travel-photo-update",
                json!({"id": photo.id, "expected": photo, "path": "x", "cover": true}),
            );
        }
        assert_eq!(state.travel_photos.iter().filter(|v| v.cover).count(), 1);
        assert_eq!(state.travel_photos[0].path, "/p/a.jpg");
        let bad = json!({"travelId": travel_id, "photos": [{"path": "/p/c.jpg", "thumb": "../x"}]});
        assert!(mutate(&mut state, "travel-photo-add", &bad).is_err());
    }
}
