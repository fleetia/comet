//! Trip reminders. Times are the trip's local times; each reminder has a window
//! and is claimed once by key, so a missed window never replays later.
use super::{travel::instant, DiaryState};
use chrono::{DateTime, Duration, NaiveDate, Utc};

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Alert {
    pub(crate) key: String,
    pub(crate) text: String,
    /// Free-cancellation deadlines go to the OS even in quiet hours; the rest wait for a speaker.
    pub(crate) os: bool,
}

fn at(day: &str, time: &str, zone: &str) -> Option<i64> {
    instant(day, time, zone).ok()
}

fn previous_day(day: &str, days: i64) -> Option<String> {
    NaiveDate::parse_from_str(day, "%Y-%m-%d")
        .ok()
        .and_then(|value| value.checked_sub_signed(Duration::days(days)))
        .map(|value| value.format("%Y-%m-%d").to_string())
}

fn label(day: &str, time: Option<&str>) -> String {
    let date = NaiveDate::parse_from_str(day, "%Y-%m-%d")
        .map(|value| value.format("%-m월 %-d일").to_string())
        .unwrap_or_else(|_| day.to_string());
    match time {
        Some(time) => format!("{date} {time}"),
        None => date,
    }
}

pub(crate) fn due(state: &DiaryState, now: DateTime<Utc>) -> Vec<Alert> {
    let now = now.timestamp();
    let open = |from: Option<i64>, until: Option<i64>| matches!((from, until), (Some(from), Some(until)) if from <= now && now < until);
    let mut alerts = Vec::new();
    for travel in state.travels.iter().filter(|travel| !travel.finished) {
        let zone = travel.time_zone.as_str();
        let trip_start = at(&travel.start_date, "00:00", zone);
        for booking in state
            .travel_bookings
            .iter()
            .filter(|booking| booking.travel_id == travel.id)
        {
            let booking_zone = booking.start_zone.as_deref().unwrap_or(zone);
            if let Some(day) = &booking.cancel_date {
                let time = booking.cancel_time.as_deref().unwrap_or("23:59");
                let deadline = at(day, time, booking_zone);
                let from = previous_day(day, 1).and_then(|before| at(&before, "20:00", zone));
                if open(
                    from.map(|from| from.min(deadline.unwrap_or(from))),
                    deadline,
                ) {
                    alerts.push(Alert {
                        key: format!("travel-cancel:{}:{day}T{time}", booking.id),
                        text: format!(
                            "‘{}’ 무료 취소가 {}까지예요. 그대로 둘지 확인해 주세요.",
                            booking.title,
                            label(day, Some(time))
                        ),
                        os: true,
                    });
                }
            }
            if booking.status == "unpaid" && booking.amount > 0 {
                let from =
                    previous_day(&travel.start_date, 3).and_then(|day| at(&day, "09:00", zone));
                if open(from, trip_start) {
                    alerts.push(Alert {
                        key: format!("travel-unpaid:{}", booking.id),
                        text: format!("‘{}’ 결제가 아직 남았어요.", booking.title),
                        os: false,
                    });
                }
            }
            let Some(time) = booking.start_time.as_deref() else {
                continue;
            };
            let starts = at(&booking.start_date, time, booking_zone);
            let lead = match booking.kind.as_str() {
                "flight" => Some(3 * 3600),
                "train" | "bus" => Some(3600),
                "stay" => Some(3600),
                _ => None,
            };
            if let Some(lead) = lead {
                if open(starts.map(|value| value - lead), starts) {
                    let what = if booking.kind == "stay" {
                        "체크인"
                    } else {
                        "출발"
                    };
                    let place = if booking.place.is_empty() {
                        String::new()
                    } else {
                        format!(" · {}", booking.place)
                    };
                    alerts.push(Alert {
                        key: format!("travel-start:{}:{}T{time}", booking.id, booking.start_date),
                        text: format!("{time}에 ‘{}’ {what}이에요{place}.", booking.title),
                        os: false,
                    });
                }
            }
        }
        for plan in state.travel_plans.iter().filter(|plan| {
            plan.travel_id == travel.id && plan.kind == "move" && plan.booking_id.is_none()
        }) {
            let Some(time) = plan.time.as_deref() else {
                continue;
            };
            let departs = at(
                &plan.date,
                time,
                plan.depart_zone.as_deref().unwrap_or(zone),
            );
            if open(departs.map(|value| value - 3600), departs) {
                alerts.push(Alert {
                    key: format!("travel-start:{}:{}T{time}", plan.id, plan.date),
                    text: format!("{time}에 ‘{}’ 출발이에요.", plan.title),
                    os: false,
                });
            }
        }
        let from = NaiveDate::parse_from_str(&travel.end_date, "%Y-%m-%d")
            .ok()
            .and_then(|day| day.succ_opt())
            .map(|day| day.format("%Y-%m-%d").to_string())
            .and_then(|day| at(&day, "20:00", zone));
        if open(from, from.map(|value| value + 3 * 24 * 3600)) {
            alerts.push(Alert {
                key: format!("travel-photos:{}", travel.id),
                text: format!("‘{}’ 사진을 모아 정리해 볼까요?", travel.title),
                os: false,
            });
        }
    }
    alerts
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn state() -> DiaryState {
        let mut state = DiaryState::default();
        super::super::mutate(
            &mut state,
            "travel-create",
            &json!({"title":"제주 가족 여행","destination":"제주","startDate":"2026-10-24","endDate":"2026-10-25","timeZone":"Asia/Seoul","currency":"KRW","budget":0}),
        )
        .unwrap();
        let travel = state.travels[0].id.clone();
        for (kind, status, title, time, cancel) in [
            ("stay", "paid", "애월 숙소", "15:00", Some("2026-10-21")),
            ("flight", "unpaid", "김포 → 제주", "09:10", None),
        ] {
            let mut input = json!({"travelId":travel,"kind":kind,"title":title,"vendor":"","confirmation":"","status":status,"amount":10_000,"currency":"KRW","category":"other","startDate":"2026-10-24","startTime":time,"place":"애월","destination":"","link":"","memo":""});
            if let Some(day) = cancel {
                input["cancelDate"] = json!(day);
            }
            super::super::mutate(&mut state, "travel-booking-create", &input).unwrap();
        }
        state
    }

    fn keys(state: &DiaryState, iso: &str) -> Vec<(String, bool)> {
        let now = DateTime::parse_from_rfc3339(iso)
            .unwrap()
            .with_timezone(&Utc);
        due(state, now)
            .into_iter()
            .map(|alert| (alert.key.split(':').next().unwrap().to_string(), alert.os))
            .collect()
    }

    #[test]
    fn reminders_open_at_their_local_time_and_close_at_the_deadline() {
        let state = state();
        assert!(keys(&state, "2026-10-20T19:59:00+09:00").is_empty());
        assert_eq!(
            keys(&state, "2026-10-20T20:00:00+09:00"),
            vec![("travel-cancel".into(), true)]
        );
        assert_eq!(
            keys(&state, "2026-10-21T09:00:00+09:00"),
            vec![
                ("travel-cancel".into(), true),
                ("travel-unpaid".into(), false)
            ]
        );
        assert_eq!(
            keys(&state, "2026-10-22T00:00:00+09:00"),
            vec![("travel-unpaid".into(), false)]
        );
        assert_eq!(
            keys(&state, "2026-10-24T06:30:00+09:00"),
            vec![("travel-start".into(), false)]
        );
        assert_eq!(
            keys(&state, "2026-10-24T14:10:00+09:00"),
            vec![("travel-start".into(), false)]
        );
        assert_eq!(
            keys(&state, "2026-10-26T20:00:00+09:00"),
            vec![("travel-photos".into(), false)]
        );
        let mut finished = state.clone();
        finished.travels[0].finished = true;
        assert!(keys(&finished, "2026-10-26T20:00:00+09:00").is_empty());
    }
}
