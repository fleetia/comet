use super::{date, no_period, Todo};
use chrono::{DateTime, Datelike, Days, Local, Months, NaiveDate, NaiveDateTime, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct RepeatRule {
    pub mode: String,
    pub unit: String,
    pub interval: u32,
    #[serde(default)]
    pub weekdays: Vec<u32>,
    #[serde(default)]
    pub times_per_week: Option<usize>,
    #[serde(default)]
    pub monthly_mode: Option<String>,
    #[serde(default)]
    pub nth: Option<i32>,
    #[serde(default)]
    pub weekday: Option<u32>,
    #[serde(default)]
    pub day_of_month: Option<u32>,
    #[serde(default = "local_zone")]
    pub time_zone: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct FrequencyRecord {
    pub id: String,
    pub date: String,
    pub created_at: i64,
}

fn local_zone() -> String {
    "local".into()
}

fn validate(rule: &RepeatRule) -> Result<(), String> {
    if !["calendar", "completion", "frequency"].contains(&rule.mode.as_str())
        || !["day", "week", "month", "year"].contains(&rule.unit.as_str())
        || !(1..=365).contains(&rule.interval)
    {
        return Err("반복 종류와 간격을 확인해 주세요.".into());
    }
    let unique: std::collections::BTreeSet<_> = rule.weekdays.iter().collect();
    if unique.len() != rule.weekdays.len()
        || rule.weekdays.iter().any(|day| *day > 6)
        || (!rule.weekdays.is_empty() && (rule.unit != "week" || rule.mode != "calendar"))
    {
        return Err("요일 반복은 월요일 0부터 일요일 6까지 중복 없이 선택해 주세요.".into());
    }
    if rule.mode == "frequency"
        && (rule.unit != "week"
            || rule.interval != 1
            || !rule
                .times_per_week
                .is_some_and(|count| (1..=7).contains(&count)))
    {
        return Err("주간 목표는 매주 1~7회로 설정해 주세요.".into());
    }
    if rule
        .day_of_month
        .is_some_and(|day| !(1..=31).contains(&day))
    {
        return Err("반복 날짜는 1일부터 31일 사이여야 합니다.".into());
    }
    if let Some(mode) = rule.monthly_mode.as_deref() {
        if !["day-of-month", "last-day", "nth-weekday"].contains(&mode)
            || !["month", "year"].contains(&rule.unit.as_str())
        {
            return Err("월 반복 설정이 올바르지 않습니다.".into());
        }
        if mode == "nth-weekday"
            && (!rule.nth.is_some_and(|n| n == -1 || (1..=5).contains(&n))
                || !rule.weekday.is_some_and(|day| day <= 6))
        {
            return Err("반복할 주차와 요일을 선택해 주세요.".into());
        }
    }
    if rule.time_zone != "local" && rule.time_zone.parse::<chrono_tz::Tz>().is_err() {
        return Err("지원하지 않는 시간대입니다.".into());
    }
    Ok(())
}

pub(super) fn anchor(day: NaiveDate, period: &str) -> Result<Option<String>, String> {
    let anchor = match period {
        "none" | "someday" => return Ok(None),
        "week" => day.checked_sub_days(Days::new(u64::from(day.weekday().num_days_from_monday()))),
        "month" => day.with_day(1),
        "year" => NaiveDate::from_ymd_opt(day.year(), 1, 1),
        _ => return Err("계획 기간을 확인해 주세요.".into()),
    };
    Ok(Some(
        anchor.ok_or("계획 날짜 범위를 벗어났습니다.")?.to_string(),
    ))
}

pub(super) fn apply(item: &mut Todo, input: &Value) -> Result<(), String> {
    if let Some(value) = input.get("planPeriod") {
        item.plan_period = if value.is_null() {
            no_period()
        } else {
            value.as_str().ok_or("계획 기간 오류")?.into()
        };
    }
    if !["none", "week", "month", "year", "someday"].contains(&item.plan_period.as_str()) {
        return Err("계획 기간을 확인해 주세요.".into());
    }
    if let Some(value) = input.get("planAnchor") {
        item.plan_anchor = if value.is_null() {
            None
        } else {
            Some(date(value.as_str().ok_or("계획 날짜 오류")?)?.to_string())
        };
    }
    if let Some(value) = input.get("plannedDate") {
        item.planned_date = if value.is_null() {
            None
        } else {
            Some(date(value.as_str().ok_or("선택 날짜 오류")?)?.to_string())
        };
    }
    if ["none", "someday"].contains(&item.plan_period.as_str()) {
        item.plan_anchor = None;
    } else {
        let selected = item
            .plan_anchor
            .as_deref()
            .ok_or("계획 기간의 기준 날짜가 필요합니다.")?;
        item.plan_anchor = anchor(date(selected)?, &item.plan_period)?;
    }
    if let Some(value) = input.get("repeatRule") {
        item.repeat_rule = if value.is_null() {
            None
        } else {
            let mut rule: RepeatRule = serde_json::from_value(value.clone())
                .map_err(|_| "반복 설정 형식이 올바르지 않습니다.")?;
            validate(&rule)?;
            if rule.mode == "calendar"
                && ["month", "year"].contains(&rule.unit.as_str())
                && rule.day_of_month.is_none()
            {
                rule.day_of_month = item
                    .due_date
                    .as_deref()
                    .map(date)
                    .transpose()?
                    .map(|d| d.day())
                    .or(item
                        .due_at
                        .map(|at| local_datetime(at, &rule.time_zone))
                        .transpose()?
                        .map(|d| d.day()));
            }
            Some(rule)
        };
        item.repeat = "none".into();
    }
    Ok(())
}

pub(super) fn local_datetime(timestamp: i64, zone: &str) -> Result<NaiveDateTime, String> {
    let utc =
        DateTime::<Utc>::from_timestamp_millis(timestamp).ok_or("시각 범위를 벗어났습니다.")?;
    if zone == "local" {
        return Ok(utc.with_timezone(&Local).naive_local());
    }
    let tz = zone
        .parse::<chrono_tz::Tz>()
        .map_err(|_| "지원하지 않는 시간대입니다.")?;
    Ok(utc.with_timezone(&tz).naive_local())
}

fn timestamp(local: NaiveDateTime, zone: &str) -> Result<i64, String> {
    let resolved = if zone == "local" {
        Local
            .from_local_datetime(&local)
            .single()
            .map(|dt| dt.timestamp_millis())
    } else {
        zone.parse::<chrono_tz::Tz>()
            .map_err(|_| "지원하지 않는 시간대입니다.")?
            .from_local_datetime(&local)
            .single()
            .map(|dt| dt.timestamp_millis())
    };
    resolved.ok_or_else(|| "다음 반복 시각이 서머타임 때문에 없거나 두 번 있습니다. 날짜와 시각을 직접 지정해 주세요.".into())
}

fn month_day(
    month: NaiveDate,
    source: NaiveDate,
    rule: &RepeatRule,
) -> Result<Option<NaiveDate>, String> {
    let next = month
        .checked_add_months(Months::new(1))
        .ok_or("반복 날짜 범위 오류")?;
    let last = next.pred_opt().ok_or("반복 날짜 범위 오류")?;
    match rule.monthly_mode.as_deref().unwrap_or("day-of-month") {
        "last-day" => Ok(Some(last)),
        "nth-weekday" => {
            let weekday = rule.weekday.ok_or("반복 요일 오류")?;
            if rule.nth == Some(-1) {
                let back = (last.weekday().num_days_from_monday() + 7 - weekday) % 7;
                return Ok(last.checked_sub_days(Days::new(u64::from(back))));
            }
            let offset = (weekday + 7 - month.weekday().num_days_from_monday()) % 7;
            let day = 1 + offset + 7 * (rule.nth.ok_or("반복 주차 오류")? as u32 - 1);
            Ok(month.with_day(day))
        }
        _ => Ok(month.with_day(rule.day_of_month.unwrap_or(source.day()).min(last.day()))),
    }
}

fn next_day(day: NaiveDate, rule: &RepeatRule) -> Result<NaiveDate, String> {
    if rule.unit == "week" && !rule.weekdays.is_empty() {
        let start = day
            .checked_sub_days(Days::new(u64::from(day.weekday().num_days_from_monday())))
            .ok_or("반복 날짜 범위 오류")?;
        for offset in 1..=(u64::from(rule.interval) * 7 + 7) {
            let next = day
                .checked_add_days(Days::new(offset))
                .ok_or("반복 날짜 범위 오류")?;
            let week = (next - start).num_days() / 7;
            if week % i64::from(rule.interval) == 0
                && rule
                    .weekdays
                    .contains(&next.weekday().num_days_from_monday())
            {
                return Ok(next);
            }
        }
        return Err("다음 반복 요일을 계산하지 못했습니다.".into());
    }
    if ["month", "year"].contains(&rule.unit.as_str()) {
        let months = rule.interval * if rule.unit == "year" { 12 } else { 1 };
        let start = day.with_day(1).ok_or("반복 날짜 범위 오류")?;
        for occurrence in 1..=400 {
            let month = start
                .checked_add_months(Months::new(months * occurrence))
                .ok_or("반복 날짜 범위 오류")?;
            if let Some(next) = month_day(month, day, rule)? {
                return Ok(next);
            }
        }
        return Err("다음 반복 날짜를 계산하지 못했습니다.".into());
    }
    day.checked_add_days(Days::new(
        u64::from(rule.interval) * if rule.unit == "week" { 7 } else { 1 },
    ))
    .ok_or_else(|| "반복 날짜 범위를 벗어났습니다.".into())
}

pub(super) fn advance(item: &Todo, now: i64) -> Result<Todo, String> {
    let mut next = item.clone();
    if let Some(rule) = &item.repeat_rule {
        validate(rule)?;
        if rule.mode == "frequency" {
            return Err("주간 목표는 횟수 기록을 사용해 주세요.".into());
        }
        let due = item
            .due_at
            .map(|at| local_datetime(at, &rule.time_zone))
            .transpose()?;
        let basis = if rule.mode == "completion" {
            local_datetime(now, &rule.time_zone)?.date()
        } else {
            item.due_date
                .as_deref()
                .map(date)
                .transpose()?
                .or(due.map(|dt| dt.date()))
                .unwrap_or(local_datetime(now, &rule.time_zone)?.date())
        };
        let mut effective_rule = rule.clone();
        if rule.mode == "completion" {
            effective_rule.day_of_month = Some(basis.day());
            effective_rule.monthly_mode = None;
        }
        let next_date = next_day(basis, &effective_rule)?;
        if let Some(original) = due {
            next.due_at = Some(timestamp(
                next_date.and_time(original.time()),
                &rule.time_zone,
            )?);
            next.due_date = None;
        } else {
            next.due_date = Some(next_date.to_string());
            next.due_at = None;
        }
        if let Some(next_rule) = next.repeat_rule.as_mut() {
            if next_rule.mode == "calendar"
                && ["month", "year"].contains(&next_rule.unit.as_str())
                && next_rule.day_of_month.is_none()
            {
                next_rule.day_of_month = Some(basis.day());
            }
        }
        next.plan_anchor = anchor(next_date, &next.plan_period)?;
    } else if let Some(at) = item.due_at {
        let dt = DateTime::<Utc>::from_timestamp_millis(at).ok_or("시각 오류")?;
        next.due_at = Some(
            super::next_date(dt.date_naive(), &item.repeat)?
                .and_time(dt.time())
                .and_utc()
                .timestamp_millis(),
        );
        next.plan_anchor = anchor(
            super::next_date(dt.date_naive(), &item.repeat)?,
            &next.plan_period,
        )?;
    } else {
        let day = item.due_date.as_deref().map(date).transpose()?.unwrap_or(
            DateTime::<Utc>::from_timestamp_millis(now)
                .ok_or("현재 시각 오류")?
                .date_naive(),
        );
        let next_date = super::next_date(day, &item.repeat)?;
        next.due_date = Some(next_date.to_string());
        next.plan_anchor = anchor(next_date, &next.plan_period)?;
    }
    next.planned_date = match next.due_date.as_ref() {
        Some(day) => Some(day.clone()),
        None => next
            .due_at
            .map(|at| {
                local_datetime(
                    at,
                    item.repeat_rule
                        .as_ref()
                        .map(|rule| rule.time_zone.as_str())
                        .unwrap_or("local"),
                )
            })
            .transpose()?
            .map(|dt| dt.date().to_string()),
    };
    Ok(next)
}

pub(super) fn is_frequency(item: &Todo) -> bool {
    item.repeat_rule
        .as_ref()
        .is_some_and(|rule| rule.mode == "frequency")
}

pub(super) fn repeats(item: &Todo) -> bool {
    item.repeat_rule.is_some() || item.repeat != "none"
}
