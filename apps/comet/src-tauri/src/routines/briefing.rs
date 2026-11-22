use chrono::{Datelike, NaiveDate};
use serde_json::Value;

use super::store::{BuiltinSource, Source};
use crate::{
    organizer::actions,
    talk::context,
    widgets::{self, WidgetSnapshot},
};

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Briefing {
    pub body: String,
    pub bubble: String,
    pub skipped: Vec<String>,
}

pub(crate) fn build(
    sources: &[Source],
    snapshot: &WidgetSnapshot,
    day: NaiveDate,
    now: i64,
) -> Briefing {
    let (values, _) = context::project(snapshot, now);
    let day_text = day.to_string();
    let mut sentences = Vec::new();
    let mut skipped = Vec::new();
    for source in sources {
        let kind = match source {
            Source::Builtin(BuiltinSource::Schedule) => "calendar",
            Source::Builtin(BuiltinSource::Tasks) => "todo",
            Source::Builtin(BuiltinSource::Weather) => "weather",
            Source::External { .. } => {
                skipped.push("바깥 재료는 아직 읽을 수 없어요.".into());
                continue;
            }
        };
        let widget = snapshot.widgets.iter().find(|widget| {
            widget.instance.kind == kind
                && !matches!(widget.status.as_str(), "setup" | "install-error")
        });
        let sentence = widget.and_then(|widget| {
            let data = &widget.instance.data;
            match kind {
                "calendar" => {
                    let connections = data["connections"].as_array();
                    if connections.is_some_and(|connections| {
                        connections
                            .iter()
                            .any(|connection| !context::fresh(connection, now, 30 * 60 * 1000))
                    }) {
                        return None;
                    }
                    let events: Vec<Value> = data["events"]
                        .as_array()?
                        .iter()
                        .filter(|event| {
                            event["cancelled"] != true
                                && actions::matches_dates(event, Some(&day_text), Some(&day_text))
                        })
                        .cloned()
                        .collect();
                    if events.is_empty() {
                        return None;
                    }
                    let count = events.len() as u64;
                    let shown = actions::format_lookup_items(&events, count, |event| {
                        let title = event["title"]
                            .as_str()
                            .unwrap_or_default()
                            .trim()
                            .to_string();
                        let detail = event["startAt"]
                            .as_i64()
                            .and_then(|at| actions::spoken_time_at(at, day.year()));
                        (title, detail)
                    });
                    Some(vec![
                        format!("오늘 일정은 {count}개예요."),
                        format!("{shown}."),
                    ])
                }
                "todo" => {
                    let items = data["items"].as_array()?;
                    let open: Vec<&Value> = items
                        .iter()
                        .filter(|item| item["completedAt"].is_null())
                        .collect();
                    if open.is_empty() {
                        return None;
                    }
                    let overdue = open
                        .iter()
                        .filter(|item| {
                            item["dueAt"].as_i64().is_some_and(|at| at < now)
                                || (item["dueAt"].is_null()
                                    && item["dueDate"]
                                        .as_str()
                                        .and_then(|date| {
                                            NaiveDate::parse_from_str(date, "%Y-%m-%d").ok()
                                        })
                                        .is_some_and(|date| date < day))
                        })
                        .count();
                    Some(vec![if overdue == 0 {
                        format!("할 일은 {}개 남았어요.", open.len())
                    } else {
                        format!(
                            "할 일은 {}개 남았고 {overdue}개는 기한이 지났어요.",
                            open.len()
                        )
                    }])
                }
                "weather" => {
                    if values.get("weather.ready") != Some(&Value::Bool(true)) {
                        return None;
                    }
                    let mut parts = Vec::new();
                    if let Some(max) = values.get("weather.todayMax").and_then(Value::as_f64) {
                        parts.push(format!("오늘은 최고 {max}도예요."));
                    }
                    if widgets::commands::tomorrow_has_rain(&values) {
                        parts.push("내일은 비가 올 수 있어요.".into());
                    }
                    (!parts.is_empty()).then_some(parts)
                }
                _ => None,
            }
        });
        if let Some(parts) = sentence {
            for (index, part) in parts.into_iter().enumerate() {
                let separator = if sentences.is_empty() {
                    ""
                } else if index == 0 {
                    "\n"
                } else {
                    " "
                };
                sentences.push(format!("{separator}{part}"));
            }
        } else {
            let label = match kind {
                "calendar" => "일정",
                "todo" => "할 일",
                _ => "날씨",
            };
            skipped.push(format!("{label}에서 전할 내용이 없거나 읽을 수 없어요."));
        }
    }
    let body = sentences.concat();
    let bubble = bubble_text(&sentences);
    Briefing {
        body,
        bubble,
        skipped,
    }
}

fn bubble_text(sentences: &[String]) -> String {
    const LIMIT: usize = 500;
    const SUFFIX: &str = "… 나머지는 보고함에 있어요.";
    let body = sentences.concat();
    if body.chars().count() <= LIMIT {
        return body;
    }
    let count = LIMIT - SUFFIX.chars().count();
    if sentences[0].chars().count() > LIMIT {
        return format!(
            "{}{SUFFIX}",
            sentences[0]
                .chars()
                .take(count)
                .collect::<String>()
                .trim_end()
        );
    }
    let mut kept = sentences.len();
    while kept > 0 && sentences[..kept].concat().chars().count() > count {
        kept -= 1;
    }
    format!("{}{SUFFIX}", sentences[..kept].concat())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn snapshot(entries: Vec<(&str, Value)>) -> WidgetSnapshot {
        WidgetSnapshot {
            catalog: vec![],
            widgets: entries.into_iter().map(|(kind, data)| serde_json::from_value(json!({
                "id":kind,"kind":kind,"version":1,"revision":1,"data":data,"error":null,
                "status":"enabled","missing":[],"reaction":true,"packageBytes":0,"backgroundUpdatedAt":null
            })).unwrap()).collect(),
            onboarding_done: true,
        }
    }

    fn day() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 11, 21).unwrap()
    }
    fn now() -> i64 {
        1_795_241_600_000
    }
    fn sources() -> Vec<Source> {
        vec![
            Source::Builtin(BuiltinSource::Schedule),
            Source::Builtin(BuiltinSource::Tasks),
            Source::Builtin(BuiltinSource::Weather),
        ]
    }

    #[test]
    fn builds_bounded_event_list_and_counts_unfinished_and_overdue_tasks() {
        let d = day().to_string();
        let events: Vec<Value> = (1..=4).map(|i| json!({"title":format!("일정{i}"),"startDate":d,"endDate":"2026-11-22","cancelled":false})).collect();
        let data = snapshot(vec![
            ("calendar", json!({"connections":[],"events":events})),
            (
                "todo",
                json!({"items":[{"completedAt":null,"dueDate":"2026-11-20"},{"completedAt":null},{"completedAt":1}]}),
            ),
        ]);
        let result = build(&sources(), &data, day(), now());
        assert_eq!(result.body, "오늘 일정은 4개예요. '일정1', '일정2', '일정3' 외 1개.\n할 일은 2개 남았고 1개는 기한이 지났어요.");
        assert_eq!(result.skipped.len(), 1);
    }

    #[test]
    fn calendar_uses_the_query_date_overlap_and_rejects_cancelled_events() {
        let data = snapshot(vec![(
            "calendar",
            json!({"connections":[], "events":[
                {"title":"전날부터", "startDate":"2026-11-20", "endDate":"2026-11-22"},
                {"title":"취소", "startDate":"2026-11-21", "endDate":"2026-11-22", "cancelled":true},
                {"title":"전날", "startDate":"2026-11-20", "endDate":"2026-11-21"},
                {"title":"다음날", "startDate":"2026-11-22", "endDate":"2026-11-23"}
            ]}),
        )]);
        let result = build(
            &[Source::Builtin(BuiltinSource::Schedule)],
            &data,
            day(),
            now(),
        );
        assert_eq!(result.body, "오늘 일정은 1개예요. '전날부터'.");
    }

    #[test]
    fn calendar_accepts_fresh_syncing_connections_and_omits_expired_ones() {
        let make = |last_success| {
            snapshot(vec![(
                "calendar",
                json!({
                    "connections":[{"status":"syncing","lastSuccessAt":last_success}],
                    "events":[{"title":"일정","startDate":"2026-11-21","endDate":"2026-11-22"}]
                }),
            )])
        };
        let sources = [Source::Builtin(BuiltinSource::Schedule)];
        assert!(!build(&sources, &make(now() - 1_800_000), day(), now())
            .body
            .is_empty());
        assert!(build(&sources, &make(now() - 1_800_001), day(), now())
            .body
            .is_empty());
    }

    #[test]
    fn stale_or_empty_sources_are_omitted_and_external_is_reported() {
        let data = snapshot(vec![
            (
                "calendar",
                json!({"connections":[{"status":"ready","lastSuccessAt":now()-1_800_001}],"events":[{"title":"오래된 일정","startDate":"2026-11-21"}]}),
            ),
            ("todo", json!({"items":[{"completedAt":1}]})),
            (
                "weather",
                json!({"status":"ready","lastSuccessAt":now()-7_200_001,"observation":{"observedAt":now()}}),
            ),
        ]);
        let mut inputs = sources();
        inputs.push(Source::External {
            server_id: "server".into(),
            tool_name: "tool".into(),
            input: json!({}),
        });
        let result = build(&inputs, &data, day(), now());
        assert!(result.body.is_empty());
        assert!(result.bubble.is_empty());
        assert_eq!(result.skipped.len(), 4);
        assert_eq!(result.skipped[3], "바깥 재료는 아직 읽을 수 없어요.");
    }

    #[test]
    fn weather_uses_fresh_forecast_and_talk_permission() {
        let instant = chrono::DateTime::from_timestamp_millis(now()).unwrap();
        let today = instant.with_timezone(&chrono_tz::Asia::Seoul).date_naive();
        let data = json!({"status":"ready","lastSuccessAt":now(),"config":{"allowTalk":true},
            "observation":{"observedAt":now(),"temperature":10,"weatherCode":0},
            "forecast":{"timezone":"Asia/Seoul","today":{"date":today.to_string(),"tMax":12},
                "tomorrow":{"date":today.succ_opt().unwrap().to_string(),"code":61,"precipProb":60}}});
        let result = build(
            &[Source::Builtin(BuiltinSource::Weather)],
            &snapshot(vec![("weather", data.clone())]),
            day(),
            now(),
        );
        assert_eq!(
            result.body,
            "오늘은 최고 12도예요. 내일은 비가 올 수 있어요."
        );
        let mut stale_observation = data.clone();
        stale_observation["observation"]["observedAt"] = json!(now() - 7_200_001);
        let stale = build(
            &[Source::Builtin(BuiltinSource::Weather)],
            &snapshot(vec![("weather", stale_observation)]),
            day(),
            now(),
        );
        assert!(stale.body.is_empty());
        assert_eq!(
            stale.skipped,
            ["날씨에서 전할 내용이 없거나 읽을 수 없어요."]
        );
        let mut disabled = data;
        disabled["config"]["allowTalk"] = json!(false);
        assert!(build(
            &[Source::Builtin(BuiltinSource::Weather)],
            &snapshot(vec![("weather", disabled)]),
            day(),
            now()
        )
        .body
        .is_empty());
    }

    #[test]
    fn truncation_drops_whole_sentences_and_preserves_the_full_report() {
        let sentences = vec![
            "가".repeat(245),
            format!("\n{}", "나".repeat(245)),
            format!("\n{}", "다".repeat(30)),
        ];
        assert_eq!(
            bubble_text(&sentences),
            format!("{}… 나머지는 보고함에 있어요.", sentences[0])
        );
        assert_eq!(bubble_text(&["짧은 본문".into()]), "짧은 본문");

        let title = "긴 일정".repeat(200);
        let data = snapshot(vec![(
            "calendar",
            json!({
                "connections": [],
                "events": [{"title": title, "startDate": "2026-11-21", "endDate": "2026-11-22"}]
            }),
        )]);
        let result = build(
            &[Source::Builtin(BuiltinSource::Schedule)],
            &data,
            day(),
            now(),
        );
        assert_eq!(result.body, format!("오늘 일정은 1개예요. '{title}'."));
        assert_eq!(
            result.bubble,
            "오늘 일정은 1개예요.… 나머지는 보고함에 있어요."
        );
    }

    #[test]
    fn truncation_only_cuts_an_oversized_first_sentence() {
        let sentence = "가나다".repeat(200);
        let bubble = bubble_text(&[sentence]);
        assert_eq!(bubble.chars().count(), 500);
        assert!(bubble.ends_with("… 나머지는 보고함에 있어요."));

        let nearly_full = "가".repeat(499);
        assert_eq!(
            bubble_text(&[nearly_full, "나다".into()]),
            "… 나머지는 보고함에 있어요."
        );
    }
}
