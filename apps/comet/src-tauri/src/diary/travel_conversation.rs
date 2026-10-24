//! What the conversation registry may see and send for trips. Writes still go through
//! `travel::mutate`; this only shapes model context and turns model input into its payload.

use super::travel::{
    balances, cost_summary, last_rate, mask_confirmation, parse_amount, parse_rate, settle, stage,
    Travel, ME,
};
use super::{DiaryState, Result};
use serde_json::{json, Value};

const COLLECTIONS: [&str; 5] = [
    "travelPlans",
    "travelBookings",
    "travelExpenses",
    "travelPeople",
    "travelTransfers",
];
const PERSON_COLORS: [&str; 7] = ["blue", "coral", "green", "violet", "yellow", "pink", "gray"];

fn with_stage(travel: &Travel) -> Value {
    let (stage, days) = stage(travel, chrono::Utc::now());
    let mut value = json!(travel);
    value["stage"] = json!(stage);
    value["daysUntil"] = json!(days);
    value
}

/// The full confirmation never reaches the model; voucher files are counted, not listed.
pub(crate) fn mask(field: &str, mut item: Value) -> Value {
    if field == "travelBookings" {
        item["confirmation"] = json!(mask_confirmation(
            item["confirmation"].as_str().unwrap_or_default()
        ));
        item["voucherCount"] = json!(item["vouchers"].as_array().map_or(0, Vec::len));
        item.as_object_mut().map(|fields| fields.remove("vouchers"));
    }
    item
}

fn rows(saved: &Value, field: &str, ids: &[&str]) -> Vec<Value> {
    saved[field]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|item| {
            item["travelId"]
                .as_str()
                .is_some_and(|id| ids.contains(&id))
        })
        .map(|item| mask(field, item.clone()))
        .collect()
}

fn rate_text(rate: u64) -> String {
    let text = format!("{}.{:04}", rate / 10_000, rate % 10_000);
    text.trim_end_matches('0').trim_end_matches('.').to_string()
}

/// Trips named in the request, or every unfinished trip when none is named.
fn focus<'a>(state: &'a DiaryState, request: &str) -> Vec<&'a Travel> {
    let request = request.to_lowercase();
    let named: Vec<_> = state
        .travels
        .iter()
        .filter(|travel| {
            [&travel.title, &travel.destination]
                .iter()
                .any(|text| !text.is_empty() && request.contains(&text.to_lowercase()))
        })
        .collect();
    if !named.is_empty() {
        return named;
    }
    state
        .travels
        .iter()
        .filter(|travel| !travel.finished)
        .collect()
}

/// Model context: every trip with its stage, and the records of the trips in focus.
pub(crate) fn context(state: &DiaryState, request: &str) -> Value {
    let trips = focus(state, request);
    let ids: Vec<&str> = trips.iter().map(|travel| travel.id.as_str()).collect();
    let saved = json!(state);
    let count = |field: &str, id: &str| {
        saved[field].as_array().map_or(0, |items| {
            items.iter().filter(|item| item["travelId"] == id).count()
        })
    };
    let travels: Vec<_> = state
        .travels
        .iter()
        .map(|travel| {
            let mut value = with_stage(travel);
            value["linked"] = json!({
                "plans": count("travelPlans", &travel.id),
                "bookings": count("travelBookings", &travel.id),
                "expenses": count("travelExpenses", &travel.id),
                "people": count("travelPeople", &travel.id),
                "transfers": count("travelTransfers", &travel.id),
                "photos": count("travelPhotos", &travel.id),
            });
            value
        })
        .collect();
    let mut value = json!({
        "travels": travels,
        "totalCount": state.travels.len(),
        "me": ME,
        "categories": saved["ledgerSettings"]["categories"].clone(),
    });
    for field in COLLECTIONS {
        value[field] = json!(rows(&saved, field, &ids));
    }
    let mut rates = serde_json::Map::new();
    for travel in &trips {
        let mut currencies: Vec<&str> = vec![&travel.currency];
        currencies.extend(
            state
                .travel_bookings
                .iter()
                .filter(|v| v.travel_id == travel.id)
                .map(|v| v.currency.as_str()),
        );
        currencies.extend(
            state
                .travel_expenses
                .iter()
                .filter(|v| v.travel_id == travel.id)
                .map(|v| v.currency.as_str()),
        );
        let known: serde_json::Map<_, _> = currencies
            .into_iter()
            .filter_map(|currency| {
                last_rate(state, &travel.id, currency)
                    .map(|rate| (currency.to_string(), json!(rate_text(rate))))
            })
            .collect();
        rates.insert(travel.id.clone(), Value::Object(known));
    }
    value["lastRates"] = Value::Object(rates);
    value
}

fn overlaps(start: &str, end: &str, from: Option<&str>, through: Option<&str>) -> bool {
    from.is_none_or(|from| end >= from) && through.is_none_or(|through| start <= through)
}

fn person_name(state: &DiaryState, id: &str) -> String {
    if id == ME {
        return "나".into();
    }
    state
        .travel_people
        .iter()
        .find(|person| person.id == id)
        .map_or_else(|| "알 수 없는 사람".into(), |person| person.name.clone())
}

/// `from`/`through` are inclusive calendar days already checked by the caller.
pub(crate) fn query(
    state: &DiaryState,
    input: &Value,
    from: Option<&str>,
    through: Option<&str>,
) -> Result<Value> {
    let text = input["query"].as_str().unwrap_or_default().to_lowercase();
    let Some(id) = input["travelId"].as_str() else {
        let travels: Vec<_> = state
            .travels
            .iter()
            .filter(|travel| {
                overlaps(&travel.start_date, &travel.end_date, from, through)
                    && (text.is_empty()
                        || [&travel.title, &travel.destination].iter().any(|value| {
                            !value.is_empty()
                                && (text.contains(&value.to_lowercase())
                                    || value.to_lowercase().contains(&text))
                        }))
            })
            .map(with_stage)
            .collect();
        return Ok(json!({"totalCount": travels.len(), "travels": travels}));
    };
    let travel = state
        .travels
        .iter()
        .find(|travel| travel.id == id)
        .ok_or("여행을 찾을 수 없어요.")?;
    let mut result = json!({
        "travel": with_stage(travel),
        "summary": cost_summary(state, travel),
        "balances": balances(state, id).into_iter().map(|(person, amount)| {
            json!({"person": person, "name": person_name(state, &person), "amount": amount})
        }).collect::<Vec<_>>(),
        "settlement": settle(state, id).into_iter().map(|(from, to, amount)| {
            json!({"from": from, "fromName": person_name(state, &from),
                   "to": to, "toName": person_name(state, &to), "amount": amount})
        }).collect::<Vec<_>>(),
    });
    let saved = json!(state);
    for field in COLLECTIONS {
        let items: Vec<_> = rows(&saved, field, &[id])
            .into_iter()
            .filter(|item| {
                let start = item["date"].as_str().or(item["startDate"].as_str());
                let end = item["arriveDate"]
                    .as_str()
                    .or(item["endDate"].as_str())
                    .or(start);
                match (start, end) {
                    (Some(start), Some(end)) => overlaps(start, end, from, through),
                    _ => true,
                }
            })
            .collect();
        result[field] = json!(items);
    }
    Ok(result)
}

fn booking_category(kind: &str) -> &'static str {
    match kind {
        "stay" => "housing",
        "ticket" => "culture",
        "food" => "food",
        "other" => "other",
        _ => "transport",
    }
}

/// Copies only text the user actually wrote; masked or invented values never replace the saved one.
fn verbatim(model: &Value, key: &str, request: &str) -> Result<()> {
    let Some(value) = model.get(key).and_then(Value::as_str) else {
        return Ok(());
    };
    if !value.is_empty() && (value.contains('•') || !request.contains(value)) {
        return Err(match key {
            "confirmation" => {
                "예약번호는 직접 적은 그대로만 저장해요. 예약번호를 다시 알려 주세요."
            }
            _ => "확인 링크는 직접 적은 그대로만 저장해요. 링크를 다시 알려 주세요.",
        }
        .into());
    }
    Ok(())
}

fn money(payload: &mut Value, travel_id: &str, state: &DiaryState) -> Result<()> {
    let currency = payload["currency"]
        .as_str()
        .ok_or("통화를 알려 주세요.")?
        .to_string();
    if let Some(text) = payload["amount"].as_str() {
        payload["amount"] = json!(parse_amount(text, &currency)
            .ok_or_else(|| format!("금액을 {currency} 단위에 맞게 다시 알려 주세요."))?);
    }
    match payload.get("rate").cloned() {
        Some(Value::String(text)) => {
            payload["rate"] = json!(parse_rate(&text)
                .ok_or("환율을 다시 알려 주세요. 1단위가 몇 원인지 적어 주면 돼요.")?);
        }
        None | Some(Value::Null) if currency != "KRW" => {
            payload["rate"] = json!(last_rate(state, travel_id, &currency).ok_or_else(
                || format!(
                    "{currency} 환율을 알려 주세요. 1{currency}가 몇 원인지 적어 주면 돼요."
                )
            )?);
        }
        _ => {}
    }
    Ok(())
}

/// Turns validated model input into the payload `travel::mutate` expects.
/// `original` is the saved record for updates and deletes; the caller sets `id`.
pub(crate) fn prepare(
    state: &DiaryState,
    kind: &str,
    model: &Value,
    payload: &mut Value,
    original: Option<&Value>,
    request: &str,
) -> Result<()> {
    verbatim(model, "confirmation", request)?;
    verbatim(model, "link", request)?;
    if let Some(original) = original {
        // The diary replaces whole records, so whatever was not mentioned comes from the saved one.
        for (key, value) in original.as_object().into_iter().flatten() {
            if payload.get(key).is_none() {
                payload[key] = value.clone();
            }
        }
        payload["expected"] = original.clone();
    }
    // The travel window always sends its optional text fields, empty when unused.
    let blanks: &[&str] = match kind {
        "travel_create" => &["destination"],
        "travel_plan_add" => &["place", "memo"],
        "travel_booking_add" => &[
            "vendor",
            "confirmation",
            "place",
            "destination",
            "link",
            "memo",
        ],
        "travel_expense_add" => &["memo"],
        _ => &[],
    };
    for key in blanks {
        if payload.get(*key).is_none_or(Value::is_null) {
            payload[*key] = json!("");
        }
    }
    let travel_id = payload["travelId"].as_str().unwrap_or_default().to_string();
    let travel = state.travels.iter().find(|travel| travel.id == travel_id);
    match kind {
        "travel_create" => {
            if payload.get("budget").is_none() {
                payload["budget"] = json!(0);
            }
        }
        "travel_booking_add" | "travel_expense_add" => {
            let travel = travel.ok_or("여행을 찾을 수 없어요.")?;
            if payload.get("currency").is_none() {
                payload["currency"] = json!(travel.currency);
            }
            if kind == "travel_booking_add" {
                if payload.get("amount").is_none() {
                    payload["amount"] = json!(0);
                }
                if payload.get("category").is_none() {
                    payload["category"] = json!(booking_category(
                        payload["kind"].as_str().unwrap_or_default()
                    ));
                }
            } else {
                if payload.get("category").is_none() {
                    payload["category"] = json!("other");
                }
                if payload.get("payer").is_none() {
                    payload["payer"] = json!(ME);
                }
                if payload.get("shares").is_none() {
                    let mut people = vec![ME.to_string()];
                    people.extend(
                        state
                            .travel_people
                            .iter()
                            .filter(|v| v.travel_id == travel.id)
                            .map(|v| v.id.clone()),
                    );
                    people.sort();
                    payload["shares"] = json!(people
                        .into_iter()
                        .map(|person| json!({"person": person, "weight": 1}))
                        .collect::<Vec<_>>());
                }
            }
            money(payload, &travel_id, state)?;
        }
        "travel_booking_update" | "travel_expense_update" => money(payload, &travel_id, state)?,
        "travel_person_add" => {
            let used: Vec<_> = state
                .travel_people
                .iter()
                .filter(|v| v.travel_id == travel_id)
                .map(|v| v.color.as_str())
                .collect();
            let color = PERSON_COLORS
                .iter()
                .find(|color| !used.contains(color))
                .unwrap_or(&PERSON_COLORS[0]);
            payload["color"] = json!(color);
            payload["joinShares"] = json!(true);
        }
        _ => {}
    }
    Ok(())
}

/// The app, not the model, asks before a trip and everything in it goes away.
/// `travel` is a trip from `context`, which carries the `linked` counts.
pub(crate) fn delete_question(travel: &Value) -> String {
    let count = |key: &str| travel["linked"][key].as_u64().unwrap_or(0);
    format!(
        "‘{}’을 지우면 일정 {}·예약 {}·비용 {}·사람 {}·보낸 기록 {}·사진 {}개가 함께 지워져요. 가계부에 들어간 기록은 남아요. 지울까요?",
        travel["title"].as_str().unwrap_or_default(),
        count("plans"),
        count("bookings"),
        count("expenses"),
        count("people"),
        count("transfers"),
        count("photos"),
    )
}

/// "<trip> · <item>" so the organizer records say which trip changed.
pub(crate) fn receipt_title(state: &DiaryState, item: &Value, fallback: &str) -> String {
    let own = item["title"]
        .as_str()
        .or(item["name"].as_str())
        .unwrap_or(fallback);
    match item["travelId"]
        .as_str()
        .and_then(|id| state.travels.iter().find(|travel| travel.id == id))
    {
        Some(travel) => format!("{} · {own}", travel.title),
        None => own.to_string(),
    }
}
