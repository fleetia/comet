use super::{boolean, capacity, date, new_id, string, DiaryState, Result};
use chrono::{Datelike, Duration, NaiveDate, Weekday};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const MAX_AMOUNT: u64 = 100_000_000_000;
const ENTRY_LIMIT: usize = 20_000;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct LedgerEntry {
    pub(super) id: String,
    pub(super) date: String,
    pub(super) kind: String,
    pub(super) amount: u64,
    pub(super) category: String,
    pub(super) title: String,
    pub(super) memo: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) recurring_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) occurrence_date: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct RecurringExpense {
    pub(super) id: String,
    pub(super) title: String,
    pub(super) amount: u64,
    pub(super) category: String,
    pub(super) estimated: bool,
    pub(super) frequency: String,
    pub(super) interval: u32,
    pub(super) day: u32,
    pub(super) weekday: u32,
    pub(super) months: Vec<u32>,
    pub(super) start_date: String,
    pub(super) end_date: Option<String>,
    pub(super) weekend: String,
    pub(super) auto_record: bool,
    pub(super) enabled: bool,
    #[serde(default)]
    pub(super) recorded_dates: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct LedgerCategory {
    id: String,
    name: String,
    color: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct LedgerSettings {
    pub(super) monthly_budget: u64,
    pub(super) include_recurring: bool,
    pub(super) reminder_enabled: bool,
    pub(super) reminder_offset_days: u32,
    categories: Vec<LedgerCategory>,
}
impl Default for LedgerSettings {
    fn default() -> Self {
        Self {
            monthly_budget: 0,
            include_recurring: false,
            reminder_enabled: false,
            reminder_offset_days: 1,
            categories: [
                ("food", "식비", "food"),
                ("delivery", "배달", "delivery"),
                ("cafe", "카페", "cafe"),
                ("transport", "교통", "transport"),
                ("living", "생활", "living"),
                ("culture", "문화", "culture"),
                ("housing", "주거", "housing"),
                ("telecom", "통신", "telecom"),
                ("subscription", "구독", "subscription"),
                ("other", "기타", "living"),
            ]
            .into_iter()
            .map(|(id, name, color)| LedgerCategory {
                id: id.into(),
                name: name.into(),
                color: color.into(),
            })
            .collect(),
        }
    }
}

fn amount(input: &Value, key: &str, zero: bool) -> Result<u64> {
    let value = input
        .get(key)
        .and_then(Value::as_u64)
        .ok_or("금액은 원 단위 정수여야 합니다.")?;
    if value > MAX_AMOUNT || (!zero && value == 0) {
        return Err("금액 범위가 올바르지 않습니다.".into());
    }
    Ok(value)
}
impl LedgerSettings {
    pub(super) fn has_category(&self, id: &str) -> bool {
        self.categories.iter().any(|value| value.id == id)
    }
    pub(super) fn first_category(&self) -> Option<&str> {
        self.categories.first().map(|value| value.id.as_str())
    }
}
fn category(state: &DiaryState, input: &Value) -> Result<String> {
    let id = string(input, "category", 100, true)?;
    if !state
        .ledger_settings
        .categories
        .iter()
        .any(|value| value.id == id)
    {
        return Err("분류를 찾을 수 없습니다.".into());
    }
    Ok(id)
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
        return Err("다른 화면에서 내용이 바뀌었어요. 최신 내용을 확인해 주세요.".into());
    }
    Ok(())
}
fn check_recurring_expected(input: &Value, current: &RecurringExpense) -> Result<()> {
    let mut expected: RecurringExpense = serde_json::from_value(
        input
            .get("expected")
            .cloned()
            .ok_or("편집 전 내용이 필요합니다.")?,
    )
    .map_err(super::err)?;
    expected.recorded_dates.clone_from(&current.recorded_dates);
    if &expected != current {
        return Err("다른 화면에서 내용이 바뀌었어요. 최신 내용을 확인해 주세요.".into());
    }
    Ok(())
}
fn entry(state: &DiaryState, input: &Value, id: String) -> Result<LedgerEntry> {
    let kind = string(input, "kind", 10, true)?;
    if !matches!(kind.as_str(), "income" | "expense") {
        return Err("수입 또는 지출을 골라 주세요.".into());
    }
    Ok(LedgerEntry {
        id,
        date: date(string(input, "date", 10, true)?)?,
        kind,
        amount: amount(input, "amount", false)?,
        category: category(state, input)?,
        title: string(input, "title", 500, true)?,
        memo: input
            .get("memo")
            .map(|_| string(input, "memo", 20_000, false))
            .transpose()?
            .unwrap_or_default(),
        recurring_id: None,
        occurrence_date: None,
    })
}
fn bounded(input: &Value, key: &str, min: u32, max: u32) -> Result<u32> {
    let value = input
        .get(key)
        .and_then(Value::as_u64)
        .ok_or_else(|| format!("{key} 값이 올바르지 않습니다."))?;
    if value < u64::from(min) || value > u64::from(max) {
        return Err(format!("{key} 범위를 확인해 주세요."));
    }
    Ok(value as u32)
}
fn recurring(state: &DiaryState, input: &Value, id: String) -> Result<RecurringExpense> {
    let frequency = string(input, "frequency", 10, true)?;
    if !matches!(
        frequency.as_str(),
        "weekly" | "monthly" | "yearly" | "interval" | "months"
    ) {
        return Err("반복 주기가 올바르지 않습니다.".into());
    }
    let weekend = string(input, "weekend", 10, true)?;
    if !matches!(weekend.as_str(), "keep" | "before" | "after") {
        return Err("주말 처리 방식이 올바르지 않습니다.".into());
    }
    let start_date = date(string(input, "startDate", 10, true)?)?;
    let end_date = match input.get("endDate") {
        None | Some(Value::Null) => None,
        Some(_) => Some(date(string(input, "endDate", 10, true)?)?),
    };
    if end_date.as_ref().is_some_and(|end| end < &start_date) {
        return Err("종료 날짜가 시작보다 빠릅니다.".into());
    }
    let mut months: Vec<u32> = serde_json::from_value(
        input
            .get("months")
            .cloned()
            .unwrap_or_else(|| serde_json::json!([])),
    )
    .map_err(super::err)?;
    months.sort_unstable();
    months.dedup();
    if months.iter().any(|month| !(1..=12).contains(month))
        || (frequency == "months" && months.is_empty())
    {
        return Err("반복할 달을 골라 주세요.".into());
    }
    Ok(RecurringExpense {
        id,
        title: string(input, "title", 500, true)?,
        amount: amount(input, "amount", false)?,
        category: category(state, input)?,
        estimated: boolean(input, "estimated", false)?,
        frequency,
        interval: bounded(input, "interval", 1, 120)?,
        day: bounded(input, "day", 1, 31)?,
        weekday: bounded(input, "weekday", 0, 6)?,
        months,
        start_date,
        end_date,
        weekend,
        auto_record: boolean(input, "autoRecord", true)?,
        enabled: boolean(input, "enabled", true)?,
        recorded_dates: vec![],
    })
}
fn due_on(rule: &RecurringExpense, day: NaiveDate) -> bool {
    let Ok(start) = NaiveDate::parse_from_str(&rule.start_date, "%Y-%m-%d") else {
        return false;
    };
    if !rule.enabled
        || day < start
        || rule
            .end_date
            .as_ref()
            .is_some_and(|end| day.format("%Y-%m-%d").to_string() > *end)
    {
        return false;
    }
    if rule.frequency == "weekly" {
        return day.weekday().num_days_from_monday() == rule.weekday;
    }
    let next_month = if day.month() == 12 {
        NaiveDate::from_ymd_opt(day.year() + 1, 1, 1)
    } else {
        NaiveDate::from_ymd_opt(day.year(), day.month() + 1, 1)
    };
    let Some(last) = next_month.and_then(|next| next.pred_opt()) else {
        return false;
    };
    if day.day() != rule.day.min(last.day()) {
        return false;
    }
    match rule.frequency.as_str() {
        "monthly" => true,
        "yearly" => day.month() == start.month(),
        "interval" => {
            rule.interval > 0
                && ((day.year() - start.year()) * 12 + day.month() as i32 - start.month() as i32)
                    % rule.interval as i32
                    == 0
        }
        "months" => rule.months.contains(&day.month()),
        _ => false,
    }
}
fn adjusted(day: NaiveDate, weekend: &str) -> NaiveDate {
    let offset = match (weekend, day.weekday()) {
        ("before", Weekday::Sat) => -1,
        ("before", Weekday::Sun) => -2,
        ("after", Weekday::Sat) => 2,
        ("after", Weekday::Sun) => 1,
        _ => 0,
    };
    day.checked_add_signed(Duration::days(offset))
        .unwrap_or(day)
}
#[derive(Clone, Debug)]
pub(super) struct LedgerOccurrence {
    pub(super) recurring_id: String,
    pub(super) occurrence_date: String,
    pub(super) date: String,
    pub(super) title: String,
    pub(super) amount: u64,
    pub(super) category: String,
    pub(super) estimated: bool,
    pub(super) auto_record: bool,
}
pub(super) fn occurrences(
    state: &DiaryState,
    from: &str,
    through: &str,
) -> Result<Vec<LedgerOccurrence>> {
    let from =
        NaiveDate::parse_from_str(&date(from.to_owned())?, "%Y-%m-%d").map_err(super::err)?;
    let through =
        NaiveDate::parse_from_str(&date(through.to_owned())?, "%Y-%m-%d").map_err(super::err)?;
    if through < from || (through - from).num_days() > 366 {
        return Err("조회 기간은 1년 이내로 골라 주세요.".into());
    }
    let start = from.checked_sub_signed(Duration::days(2)).unwrap_or(from);
    let end = through
        .checked_add_signed(Duration::days(2))
        .unwrap_or(through);
    let mut values = Vec::new();
    for day in start.iter_days().take_while(|day| *day <= end) {
        for rule in &state.ledger_recurring {
            if !due_on(rule, day) {
                continue;
            }
            let target = adjusted(day, &rule.weekend);
            if target < from || target > through {
                continue;
            }
            values.push(LedgerOccurrence {
                recurring_id: rule.id.clone(),
                occurrence_date: day.format("%Y-%m-%d").to_string(),
                date: target.format("%Y-%m-%d").to_string(),
                title: rule.title.clone(),
                amount: rule.amount,
                category: rule.category.clone(),
                estimated: rule.estimated,
                auto_record: rule.auto_record,
            });
        }
    }
    values.sort_by(|a, b| {
        a.date
            .cmp(&b.date)
            .then(a.recurring_id.cmp(&b.recurring_id))
    });
    Ok(values)
}

pub(super) fn mutate(state: &mut DiaryState, action: &str, input: &Value) -> Result<()> {
    match action {
        "ledger-entry-create" => {
            capacity(state.ledger_entries.len(), ENTRY_LIMIT)?;
            let value = entry(state, input, new_id())?;
            state.ledger_entries.push(value);
        }
        "ledger-entry-update" | "ledger-entry-delete" => {
            let id = string(input, "id", 100, true)?;
            let at = state
                .ledger_entries
                .iter()
                .position(|value| value.id == id)
                .ok_or("기록을 찾을 수 없습니다.")?;
            check_expected(input, &state.ledger_entries[at])?;
            if action == "ledger-entry-delete" {
                state.ledger_entries.remove(at);
            } else {
                let mut value = entry(state, input, id)?;
                value.recurring_id = state.ledger_entries[at].recurring_id.clone();
                value.occurrence_date = state.ledger_entries[at].occurrence_date.clone();
                state.ledger_entries[at] = value;
            }
        }
        "ledger-recurring-create" => {
            capacity(state.ledger_recurring.len(), 200)?;
            let value = recurring(state, input, new_id())?;
            state.ledger_recurring.push(value);
        }
        "ledger-recurring-update" | "ledger-recurring-delete" => {
            let id = string(input, "id", 100, true)?;
            let at = state
                .ledger_recurring
                .iter()
                .position(|value| value.id == id)
                .ok_or("고정비를 찾을 수 없습니다.")?;
            check_recurring_expected(input, &state.ledger_recurring[at])?;
            if action == "ledger-recurring-delete" {
                state.ledger_recurring.remove(at);
            } else {
                let mut value = recurring(state, input, id)?;
                value.recorded_dates = state.ledger_recurring[at].recorded_dates.clone();
                state.ledger_recurring[at] = value;
            }
        }
        "ledger-settings-update" => {
            check_expected(input, &state.ledger_settings)?;
            let settings = input.get("settings").ok_or("설정이 필요합니다.")?;
            let mut value: LedgerSettings =
                serde_json::from_value(settings.clone()).map_err(super::err)?;
            value.monthly_budget = amount(settings, "monthlyBudget", true)?;
            if value.reminder_offset_days != 1
                || value.categories.is_empty()
                || value.categories.len() > 50
            {
                return Err("가계부 설정 범위가 올바르지 않습니다.".into());
            }
            let mut ids = std::collections::BTreeSet::new();
            for item in &value.categories {
                if item.id.is_empty()
                    || item.id.len() > 100
                    || item.name.trim().is_empty()
                    || item.name.chars().count() > 30
                    || !ids.insert(item.id.clone())
                    || !matches!(
                        item.color.as_str(),
                        "food"
                            | "delivery"
                            | "cafe"
                            | "transport"
                            | "living"
                            | "culture"
                            | "housing"
                            | "telecom"
                            | "subscription"
                    )
                {
                    return Err("분류 설정이 올바르지 않습니다.".into());
                }
            }
            if state
                .ledger_entries
                .iter()
                .any(|entry| !ids.contains(&entry.category))
                || state
                    .ledger_recurring
                    .iter()
                    .any(|entry| !ids.contains(&entry.category))
            {
                return Err("기록에서 사용 중인 분류는 지울 수 없습니다.".into());
            }
            state.ledger_settings = value;
        }
        "ledger-generate" => {
            let from = string(input, "fromDate", 10, true)?;
            let through = string(input, "throughDate", 10, true)?;
            let manual = boolean(input, "includeManual", false)?;
            let values = occurrences(state, &from, &through)?;
            let mut additions = Vec::new();
            for value in values {
                let Some(rule) = state
                    .ledger_recurring
                    .iter()
                    .find(|rule| rule.id == value.recurring_id)
                else {
                    continue;
                };
                if (!manual && !value.auto_record)
                    || rule.recorded_dates.contains(&value.occurrence_date)
                    || state.ledger_entries.iter().any(|entry| {
                        entry.recurring_id.as_deref() == Some(&value.recurring_id)
                            && entry.occurrence_date.as_deref() == Some(&value.occurrence_date)
                    })
                {
                    continue;
                }
                additions.push(value);
            }
            if state.ledger_entries.len() + additions.len() > ENTRY_LIMIT {
                return Err("기록 저장 공간이 가득 찼습니다.".into());
            }
            for value in additions {
                if let Some(rule) = state
                    .ledger_recurring
                    .iter_mut()
                    .find(|rule| rule.id == value.recurring_id)
                {
                    rule.recorded_dates.push(value.occurrence_date.clone());
                }
                state.ledger_entries.push(LedgerEntry {
                    id: new_id(),
                    date: value.date,
                    kind: "expense".into(),
                    amount: value.amount,
                    category: value.category,
                    title: value.title,
                    memo: if value.estimated {
                        "예상 금액으로 기록한 고정비".into()
                    } else {
                        String::new()
                    },
                    recurring_id: Some(value.recurring_id),
                    occurrence_date: Some(value.occurrence_date),
                });
            }
        }
        _ => return Err("지원하지 않는 가계부 동작입니다.".into()),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn rule() -> Value {
        json!({"title":"월세","amount":550000,"category":"housing","estimated":false,"frequency":"monthly","interval":1,"day":31,"weekday":0,"months":[],"startDate":"2026-01-01","endDate":null,"weekend":"keep","autoRecord":true,"enabled":true})
    }
    #[test]
    fn validates_integer_money_dates_and_stale_edits() {
        let mut state = DiaryState::default();
        let input = json!({"date":"2026-10-15","kind":"expense","amount":4500,"category":"cafe","title":"커피","memo":"  남길 메모\n  "});
        mutate(&mut state, "ledger-entry-create", &input).unwrap();
        let saved = state.ledger_entries[0].clone();
        assert_eq!(saved.memo, "  남길 메모\n  ");
        for patch in [
            json!({"amount":1.5}),
            json!({"amount":-1}),
            json!({"amount":0}),
            json!({"date":"2026-02-30"}),
            json!({"category":"missing"}),
        ] {
            let mut invalid = input.clone();
            for (key, value) in patch.as_object().unwrap() {
                invalid[key] = value.clone();
            }
            assert!(mutate(&mut state, "ledger-entry-create", &invalid).is_err());
        }
        let mut edit = input.clone();
        edit["id"] = json!(saved.id);
        edit["expected"] = json!(saved);
        edit["amount"] = json!(5000);
        mutate(&mut state, "ledger-entry-update", &edit).unwrap();
        assert!(mutate(&mut state, "ledger-entry-update", &edit).is_err());
        assert_eq!(state.ledger_entries.len(), 1);
    }
    #[test]
    fn clamps_month_end_and_never_duplicates_or_restores_deleted_occurrences() {
        let mut state = DiaryState::default();
        mutate(&mut state, "ledger-recurring-create", &rule()).unwrap();
        let period = json!({"fromDate":"2026-02-01","throughDate":"2026-02-28"});
        mutate(&mut state, "ledger-generate", &period).unwrap();
        mutate(&mut state, "ledger-generate", &period).unwrap();
        assert_eq!(state.ledger_entries.len(), 1);
        assert_eq!(state.ledger_entries[0].date, "2026-02-28");
        let saved = state.ledger_entries[0].clone();
        mutate(
            &mut state,
            "ledger-entry-delete",
            &json!({"id":saved.id,"expected":saved}),
        )
        .unwrap();
        mutate(&mut state, "ledger-generate", &period).unwrap();
        assert!(state.ledger_entries.is_empty());
    }
    #[test]
    fn recurring_edits_preserve_generated_history_without_false_conflicts() {
        let mut state = DiaryState::default();
        mutate(&mut state, "ledger-recurring-create", &rule()).unwrap();
        let original = state.ledger_recurring[0].clone();
        let period = json!({"fromDate":"2026-01-01","throughDate":"2026-02-28"});
        mutate(&mut state, "ledger-generate", &period).unwrap();
        let entries = state.ledger_entries.clone();

        let mut edit = rule();
        edit["id"] = json!(original.id);
        edit["expected"] = json!(original);
        edit["amount"] = json!(600000);
        edit["recordedDates"] = json!(["2026-12-31"]);
        mutate(&mut state, "ledger-recurring-update", &edit).unwrap();
        assert_eq!(state.ledger_recurring[0].amount, 600000);
        assert_eq!(
            state.ledger_recurring[0].recorded_dates,
            ["2026-01-31", "2026-02-28"]
        );
        assert_eq!(state.ledger_entries, entries);
        mutate(&mut state, "ledger-generate", &period).unwrap();
        assert_eq!(state.ledger_entries, entries);

        let before_generation = state.ledger_recurring[0].clone();
        mutate(
            &mut state,
            "ledger-generate",
            &json!({"fromDate":"2026-03-01","throughDate":"2026-03-31"}),
        )
        .unwrap();
        assert_eq!(state.ledger_entries.len(), 3);
        assert_eq!(state.ledger_entries[2].amount, 600000);
        mutate(
            &mut state,
            "ledger-recurring-delete",
            &json!({"id":before_generation.id,"expected":before_generation}),
        )
        .unwrap();
        assert!(state.ledger_recurring.is_empty());
        assert_eq!(state.ledger_entries.len(), 3);
    }

    #[test]
    fn recurring_definition_changes_still_reject_stale_edits_and_deletes() {
        let mut state = DiaryState::default();
        mutate(&mut state, "ledger-recurring-create", &rule()).unwrap();
        let original = state.ledger_recurring[0].clone();
        let mut edit = rule();
        edit["id"] = json!(original.id);
        edit["expected"] = json!(original);
        edit["amount"] = json!(600000);
        mutate(&mut state, "ledger-recurring-update", &edit).unwrap();
        let latest = state.clone();
        edit["title"] = json!("오래된 편집");
        assert!(mutate(&mut state, "ledger-recurring-update", &edit).is_err());
        assert!(mutate(
            &mut state,
            "ledger-recurring-delete",
            &json!({"id":original.id,"expected":original}),
        )
        .is_err());
        assert_eq!(state, latest);
    }
    #[test]
    fn respects_selected_months_manual_confirmation_and_weekend_boundaries() {
        let mut state = DiaryState::default();
        let mut input = rule();
        input["frequency"] = json!("months");
        input["months"] = json!([3, 6]);
        input["day"] = json!(1);
        input["weekend"] = json!("before");
        input["autoRecord"] = json!(false);
        mutate(&mut state, "ledger-recurring-create", &input).unwrap();
        let values = occurrences(&state, "2026-02-01", "2026-06-30").unwrap();
        assert_eq!(
            values
                .iter()
                .map(|value| value.date.as_str())
                .collect::<Vec<_>>(),
            ["2026-02-27", "2026-06-01"]
        );
        let mut period = json!({"fromDate":"2026-02-01","throughDate":"2026-06-30"});
        mutate(&mut state, "ledger-generate", &period).unwrap();
        assert!(state.ledger_entries.is_empty());
        period["includeManual"] = json!(true);
        mutate(&mut state, "ledger-generate", &period).unwrap();
        assert_eq!(state.ledger_entries.len(), 2);
        let saved_rule = state.ledger_recurring[0].clone();
        mutate(
            &mut state,
            "ledger-recurring-delete",
            &json!({"id":saved_rule.id,"expected":saved_rule}),
        )
        .unwrap();
        assert_eq!(state.ledger_entries.len(), 2);
    }

    #[test]
    fn settings_preserve_used_categories_and_reject_stale_changes() {
        let mut state = DiaryState::default();
        mutate(&mut state, "ledger-recurring-create", &rule()).unwrap();
        let original = state.ledger_settings.clone();
        let mut settings = serde_json::to_value(&original).unwrap();
        settings["monthlyBudget"] = json!(700000);
        settings["categories"]
            .as_array_mut()
            .unwrap()
            .retain(|value| value["id"] != "housing");
        assert!(mutate(
            &mut state,
            "ledger-settings-update",
            &json!({"expected":original,"settings":settings})
        )
        .is_err());
        assert_eq!(state.ledger_settings, original);
        settings["categories"] = serde_json::to_value(&original.categories).unwrap();
        mutate(
            &mut state,
            "ledger-settings-update",
            &json!({"expected":original,"settings":settings}),
        )
        .unwrap();
        assert_eq!(state.ledger_settings.monthly_budget, 700000);
        assert!(mutate(
            &mut state,
            "ledger-settings-update",
            &json!({"expected":original,"settings":settings})
        )
        .is_err());
    }

    #[test]
    fn interval_weekly_and_annual_schedules_respect_dates_and_end() {
        let mut state = DiaryState::default();
        let mut input = rule();
        input["frequency"] = json!("interval");
        input["interval"] = json!(3);
        input["startDate"] = json!("2026-02-10");
        input["endDate"] = json!("2026-08-01");
        input["day"] = json!(15);
        mutate(&mut state, "ledger-recurring-create", &input).unwrap();
        let dates = |state: &DiaryState| {
            occurrences(state, "2026-01-01", "2026-12-31")
                .unwrap()
                .into_iter()
                .map(|value| value.date)
                .collect::<Vec<_>>()
        };
        assert_eq!(dates(&state), ["2026-02-15", "2026-05-15"]);
        state.ledger_recurring[0].frequency = "yearly".into();
        assert_eq!(dates(&state), ["2026-02-15"]);
        state.ledger_recurring[0].frequency = "weekly".into();
        assert_eq!(
            occurrences(&state, "2026-02-01", "2026-02-28")
                .unwrap()
                .iter()
                .map(|value| value.date.as_str())
                .collect::<Vec<_>>(),
            ["2026-02-16", "2026-02-23"]
        );
        state.ledger_recurring[0].enabled = false;
        assert!(dates(&state).is_empty());
    }
}
