use super::{EvalContext, Registry, ValueType, Variable};
pub use crate::widgets::WidgetEvent;
use crate::widgets::{self, storage, WidgetSnapshot};
use chrono::{DateTime, Local, NaiveDate, Timelike};
use rusqlite::{Connection, OptionalExtension};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

const FIELDS: &[(&str, &str, &str, &str, &str)] = &[
    (
        "todo",
        "todo",
        "openCount completedCount overdueCount",
        "",
        "",
    ),
    (
        "calendar",
        "calendar",
        "eventCount",
        "nextTitle",
        "nextAllDay",
    ),
    ("timer", "focus-timer", "remainingMs", "state mode", ""),
    (
        "preparation",
        "preparation",
        "count checkCount uncheckedCount",
        "",
        "",
    ),
    ("jar", "completion-jar", "count", "", ""),
    (
        "clock",
        "clock",
        "hour anniversaryCount daysUntil",
        "title",
        "",
    ),
    ("memo", "memo", "count", "", ""),
    ("weather", "weather", "temperature code", "name", ""),
    ("music", "music", "", "title artist", "running playing"),
    (
        "device",
        "device",
        "percent",
        "powerState",
        "hasBattery woke",
    ),
    ("interaction", "interaction", "snacks touches", "", ""),
    ("ball", "ball", "bounces", "", "moving"),
    ("plane", "paper-plane", "distance best", "", "flying"),
    ("bubbles", "bubbles", "count streak", "", ""),
    ("match", "small-match", "rounds", "game result", ""),
    ("guessing", "guessing", "attempts", "mode hint", "playing"),
    ("fishing", "fishing", "catches", "phase lastCatch", ""),
    ("fortune", "fortune", "draws", "text", ""),
    ("plant", "plant", "stage water", "", ""),
    ("pet", "pet", "arrivals", "", "moving"),
    ("collection", "collection", "count decorationCount", "", ""),
    ("journal", "journal", "count", "recentKind", ""),
];

fn description(prefix: &str, field: &str, nullable: bool) -> String {
    let text = match (prefix, field) {
        (_, "ready") => "설치·활성·의존성과 데이터 최신성 검사를 통과했는지 여부",
        (_, "status") => "설치 상태 또는 연결 상태. unavailable·실패·stale은 성공한 빈 값과 구분",
        (_, "openCount") => "완료하지 않은 할 일 수",
        (_, "completedCount") => "완료한 할 일 수",
        (_, "overdueCount") => "미완료이며 지정 시각 또는 날짜를 지난 할 일 수. 날짜 비교는 기기 현지 날짜 기준",
        (_, "eventCount") => "모든 연결이 최근 30분 안에 성공했을 때의 취소되지 않은 일정 수",
        (_, "nextTitle") => "현재 이후 가장 먼저 시작하는 일정 제목. 종일 일정은 날짜 기준",
        (_, "nextAllDay") => "다음 일정이 종일 일정인지 여부",
        (_, "remainingMs") => "타이머 남은 시간(밀리초). 실행 중에는 deadline에서 현재 시각을 뺀 값",
        ("timer", "state") => "타이머 상태: idle, running, paused, finished",
        ("timer", "mode") => "타이머 모드: focus 또는 rest",
        ("preparation", "count") => "저장된 준비 봉투 수",
        (_, "checkCount") => "모든 준비 봉투에 등록된 체크 항목 수",
        (_, "uncheckedCount") => "모든 준비 봉투에서 아직 체크하지 않은 항목 수",
        ("jar", "count") => "원본 할 일에서 완료 상태로 남아 있는 항목 수",
        (_, "hour") => "현재 기기 현지 시각의 시(0~23)",
        (_, "anniversaryCount") => "등록된 기념일 수",
        (_, "daysUntil") => "오늘과 날짜 차이가 가장 작은 기념일까지 남은 일수. 과거 음수, 오늘 0, 미래 양수",
        ("clock", "title") => "오늘과 날짜 차이가 가장 작은 기념일의 제목",
        ("memo", "count") => "저장된 메모 수. 메모 본문은 제공하지 않음",
        (_, "temperature") => "최근 관측 기온(섭씨). 관측·조회 성공 시각 모두 2시간 이내일 때만 제공",
        (_, "code") => "날씨 제공자의 WMO weatherCode 숫자",
        ("weather", "name") => "관측 대상 지역 이름",
        (_, "running") => "음악 제공 앱이 실행 중인지 여부",
        (_, "playing") if prefix == "music" => "현재 음악을 재생 중인지 여부. 중지·일시정지는 false",
        ("music", "title") => "현재 재생 중인 곡 제목. 비재생 시 null",
        (_, "artist") => "현재 재생 중인 곡의 아티스트. 비재생 시 null",
        (_, "hasBattery") => "기기에 배터리가 있는지 여부. 배터리 없는 데스크톱은 false",
        (_, "percent") => "장착 배터리 중 가장 낮은 잔량(0~100%). 배터리가 없으면 null",
        (_, "powerState") => "가장 낮은 잔량 배터리의 충전 상태: charging, discharging, charged, not-charging, unknown 등",
        (_, "woke") => "최근 60초 안에 실제 절전 복귀가 관측됐는지 여부. 배터리 조회 실패와 독립",
        (_, "snacks") => "남은 간식 조각 수(0~6)",
        (_, "touches") => "누적 교감 횟수",
        ("ball", "moving") => "공이 현재 이동 중인지 여부",
        (_, "bounces") => "이번 공 던지기에서 벽에 튕긴 횟수",
        (_, "flying") => "종이비행기가 현재 비행 중인지 여부",
        (_, "distance") => "이번 종이비행기의 이동 거리(위젯 좌표 단위)",
        (_, "best") => "종이비행기 최고 비행 거리(위젯 좌표 단위)",
        ("bubbles", "count") => "현재 화면에 남은 비눗방울 수",
        (_, "streak") => "초기화 이후 연속으로 터뜨린 비눗방울 수",
        (_, "game") => "최근 작은 승부 종류: 빈 문자열, dice, coin, rps",
        (_, "result") => "최근 작은 승부의 기존 한국어 결과 문자열. 사건 판정은 event.outcome 사용",
        (_, "rounds") => "작은 승부 누적 판 수",
        ("guessing", "playing") => "맞히기 놀이가 아직 진행 중인지 여부. 정답은 제공하지 않음",
        ("guessing", "mode") => "맞히기 놀이 종류: cups 또는 number",
        (_, "attempts") => "현재 또는 직전 맞히기 놀이의 시도 횟수",
        (_, "hint") => "사용자에게 이미 공개한 맞히기 힌트",
        (_, "phase") => "낚시 상태: idle, waiting, bite",
        (_, "catches") => "누적 낚시 성공 횟수",
        (_, "lastCatch") => "마지막으로 낚은 물건 이름. 아직 성공하지 않았으면 null",
        (_, "draws") => "가상의 장난 운세를 뽑은 횟수",
        ("fortune", "text") => "현재 가상 장난 운세의 원문. 실제 예측이 아님",
        (_, "stage") => "화분 성장 단계: 0 씨앗, 1 새싹, 2 잎, 3 꽃",
        (_, "water") => "화분에 남은 물(0~3)",
        ("pet", "moving") => "펫이 놓인 먹이를 향해 이동 중인지 여부",
        (_, "arrivals") => "펫이 먹이에 도착한 누적 횟수",
        ("collection", "count") => "수집함에 있는 서로 다른 물건 종류 수. 총 수량이 아님",
        (_, "decorationCount") => "현재 꺼내 배치한 소품 수",
        ("journal", "count") => "켜 둔 사건 일지에 실제로 보관한 사건 수",
        (_, "recentKind") => "보관된 사건 일지 중 가장 최근 사건의 kind. 일지가 비었으면 null",
        ("event", "kind") => "현재 전달된 실제 사건의 kind. idle 평가에는 null",
        ("event", "widget") => "현재 사건을 발행한 위젯 kind",
        ("event", "action") => "교감 사건의 실제 사용자 동작: stroke, poke, snack",
        ("event", "character") => "교감 사건의 대상 자리: A 또는 B",
        ("event", "outcome") => "작은 승부 또는 맞히기 결과의 기계 식별자. 공개된 결과만 제공",
        ("event", "mode") => "사건의 timer 모드, 승부 종류 또는 맞히기 종류",
        ("event", "itemName") => "실제 item-acquired 사건에서 획득한 물건 이름",
        _ => "읽기 전용 위젯 관측값",
    };
    if nullable {
        format!("{text}. 미설치·비활성·자료 없음·오래됨에는 null(별도 명시된 독립 관측값 제외).")
    } else {
        text.to_owned()
    }
}

pub fn registry() -> Registry {
    let mut variables = BTreeMap::new();
    let mut add = |prefix: &str, field: &str, kind: ValueType, nullable, widget: Option<&str>| {
        let name = format!("{prefix}.{field}");
        variables.insert(
            name.clone(),
            Variable {
                description: description(prefix, field, nullable),
                name,
                kind,
                nullable,
                widget: widget.map(str::to_owned),
            },
        );
    };
    for &(prefix, widget, numbers, strings, booleans) in FIELDS {
        add(prefix, "ready", ValueType::Boolean, false, Some(widget));
        add(prefix, "status", ValueType::String, false, Some(widget));
        for name in numbers.split_whitespace() {
            add(prefix, name, ValueType::Number, true, Some(widget));
        }
        for name in strings.split_whitespace() {
            add(prefix, name, ValueType::String, true, Some(widget));
        }
        for name in booleans.split_whitespace() {
            add(prefix, name, ValueType::Boolean, true, Some(widget));
        }
    }
    for name in [
        "kind",
        "widget",
        "action",
        "character",
        "outcome",
        "mode",
        "itemName",
    ] {
        add("event", name, ValueType::String, true, None);
    }
    Registry {
        variables,
        events: [
            "idle",
            "todo-completed",
            "todo-undone",
            "timer-finished",
            "calendar-reminder",
            "device-woke",
            "interaction.touch",
            "ball.stopped",
            "paper-plane.landed",
            "bubbles.streak",
            "small-match.result",
            "guessing.attempt",
            "fishing.bite",
            "fishing.missed",
            "item-acquired",
            "fortune.draw",
            "plant.growth",
            "pet.arrived",
        ]
        .into_iter()
        .map(str::to_owned)
        .collect(),
    }
}

fn rows(value: &Value) -> &[Value] {
    value.as_array().map(Vec::as_slice).unwrap_or(&[])
}
fn fresh(data: &Value, now: i64, age: i64) -> bool {
    matches!(data["status"].as_str(), Some("ready" | "syncing"))
        && data["lastSuccessAt"]
            .as_i64()
            .is_some_and(|at| now >= at && now - at <= age)
}
fn project(snapshot: &WidgetSnapshot, now: i64) -> (BTreeMap<String, Value>, BTreeSet<String>) {
    let mut values = registry()
        .variables
        .keys()
        .map(|name| (name.clone(), Value::Null))
        .collect::<BTreeMap<_, _>>();
    let mut available = BTreeSet::new();
    let instant = DateTime::from_timestamp_millis(now).map(|time| time.with_timezone(&Local));
    let today = instant.map(|time| time.date_naive());
    for &(prefix, kind, numbers, strings, booleans) in FIELDS {
        let widget = snapshot
            .widgets
            .iter()
            .find(|item| item.instance.kind == kind);
        let mut set = |field: &str, value: Value| {
            values.insert(format!("{prefix}.{field}"), value);
        };
        set("ready", json!(false));
        set(
            "status",
            json!(widget
                .map(|item| item.status.as_str())
                .unwrap_or("not-installed")),
        );
        let Some(widget) = widget else {
            continue;
        };
        if !widget.instance.installed || !widget.instance.enabled || !widget.missing.is_empty() {
            continue;
        }
        available.insert(kind.to_owned());
        let d = &widget.instance.data;
        let external = matches!(kind, "weather" | "music" | "device");
        let mut ready = widget.status == "enabled";
        if external {
            let age = if kind == "weather" {
                2 * 60 * 60 * 1000
            } else {
                2 * widgets::connections::min_interval(kind)
            };
            ready = fresh(d, now, age)
                && !d["observation"].is_null()
                && (kind != "weather"
                    || d["observation"]["observedAt"]
                        .as_i64()
                        .is_some_and(|at| now >= at && now - at <= age));
            let status = if ready {
                d["status"].as_str().unwrap_or("ready")
            } else if d["status"] == "ready" && d["observation"].is_null() {
                "error"
            } else if d["status"] == "syncing" && d["observation"].is_null() {
                "syncing"
            } else if matches!(d["status"].as_str(), Some("ready" | "syncing")) {
                "stale"
            } else {
                d["status"].as_str().unwrap_or("permission-needed")
            };
            set("status", json!(status));
        }
        if kind == "calendar" {
            let connections = rows(&d["connections"]);
            ready = !connections.is_empty()
                && connections
                    .iter()
                    .all(|connection| fresh(connection, now, 30 * 60 * 1000));
            set(
                "status",
                json!(if connections.is_empty() {
                    "permission-needed"
                } else if ready {
                    "ready"
                } else {
                    connections
                        .iter()
                        .find(|connection| !fresh(connection, now, 30 * 60 * 1000))
                        .map(|connection| match connection["status"].as_str() {
                            Some("ready") => "stale",
                            Some("syncing") if !connection["lastSuccessAt"].is_null() => "stale",
                            Some(status) => status,
                            None => "stale",
                        })
                        .unwrap_or("stale")
                }),
            );
        }
        set("ready", json!(ready));
        if kind == "device" {
            set(
                "woke",
                json!(d["lastWakeAt"]
                    .as_i64()
                    .is_some_and(|at| now >= at && now - at <= 60_000)),
            );
        }
        if !ready {
            continue;
        }
        for field in numbers
            .split_whitespace()
            .chain(strings.split_whitespace())
            .chain(booleans.split_whitespace())
        {
            set(field, d[field].clone());
        }
        match kind {
            "todo" => {
                let items = rows(&d["items"]);
                let open = items
                    .iter()
                    .filter(|item| item["completedAt"].is_null())
                    .collect::<Vec<_>>();
                set("openCount", json!(open.len()));
                set("completedCount", json!(items.len() - open.len()));
                set(
                    "overdueCount",
                    json!(open
                        .iter()
                        .filter(|item| item["dueAt"].as_i64().is_some_and(|at| at < now)
                            || (item["dueAt"].is_null()
                                && item["dueDate"]
                                    .as_str()
                                    .and_then(
                                        |date| NaiveDate::parse_from_str(date, "%Y-%m-%d").ok()
                                    )
                                    .zip(today)
                                    .is_some_and(|(date, today)| date < today)))
                        .count()),
                );
            }
            "calendar" => {
                let events = rows(&d["events"])
                    .iter()
                    .filter(|event| event["cancelled"] != true)
                    .collect::<Vec<_>>();
                set("eventCount", json!(events.len()));
                let next = events
                    .iter()
                    .filter_map(|event| {
                        let at = event["startAt"].as_i64().or_else(|| {
                            event["startDate"]
                                .as_str()
                                .and_then(|date| NaiveDate::parse_from_str(date, "%Y-%m-%d").ok())
                                .zip(today)
                                .map(|(date, today)| now + (date - today).num_days() * 86_400_000)
                        })?;
                        (at >= now).then_some((at, *event))
                    })
                    .min_by_key(|(at, _)| *at);
                if let Some((_, event)) = next {
                    set("nextTitle", event["title"].clone());
                    set("nextAllDay", event["allDay"].clone());
                }
            }
            "focus-timer" => {
                set("state", d["status"].clone());
                if d["status"] == "running" {
                    set(
                        "remainingMs",
                        d["deadline"]
                            .as_i64()
                            .map(|at| json!(at.saturating_sub(now).max(0)))
                            .unwrap_or(Value::Null),
                    );
                }
            }
            "preparation" => {
                let envelopes = rows(&d["envelopes"]);
                set("count", json!(envelopes.len()));
                set(
                    "checkCount",
                    json!(envelopes
                        .iter()
                        .map(|item| rows(&item["checks"]).len())
                        .sum::<usize>()),
                );
                set(
                    "uncheckedCount",
                    json!(envelopes
                        .iter()
                        .flat_map(|item| rows(&item["checks"]))
                        .filter(|item| item["done"] != true)
                        .count()),
                );
            }
            "completion-jar" => set("count", json!(rows(&d["completed"]).len())),
            "clock" => {
                set(
                    "hour",
                    instant
                        .map(|time| json!(time.hour()))
                        .unwrap_or(Value::Null),
                );
                set("anniversaryCount", json!(rows(&d["anniversaries"]).len()));
                let next = rows(&d["anniversaries"])
                    .iter()
                    .filter_map(|item| {
                        item["date"]
                            .as_str()
                            .and_then(|date| NaiveDate::parse_from_str(date, "%Y-%m-%d").ok())
                            .zip(today)
                            .map(|(date, today)| ((date - today).num_days(), item))
                    })
                    .min_by_key(|(days, _)| days.unsigned_abs());
                if let Some((days, item)) = next {
                    set("daysUntil", json!(days));
                    set("title", item["title"].clone());
                }
            }
            "memo" => set("count", json!(rows(&d["notes"]).len())),
            "weather" => {
                let o = &d["observation"];
                set("temperature", o["temperature"].clone());
                set("code", o["weatherCode"].clone());
                set("name", o["name"].clone());
            }
            "music" => {
                for field in ["running", "playing", "title", "artist"] {
                    set(field, d["observation"][field].clone());
                }
            }
            "device" => {
                let o = &d["observation"];
                set("hasBattery", o["hasBattery"].clone());
                if let Some(battery) = rows(&o["batteries"])
                    .iter()
                    .min_by_key(|item| item["percent"].as_u64().unwrap_or(101))
                {
                    set("percent", battery["percent"].clone());
                    set("powerState", battery["status"].clone());
                }
                set(
                    "woke",
                    json!(d["lastWakeAt"]
                        .as_i64()
                        .is_some_and(|at| now >= at && now - at <= 60_000)),
                );
            }
            "bubbles" => set("count", json!(rows(&d["bubbles"]).len())),
            "pet" => set("moving", json!(!d["food"].is_null())),
            "collection" => {
                set("count", json!(rows(&d["items"]).len()));
                set("decorationCount", json!(rows(&d["decorations"]).len()));
            }
            _ => {}
        }
    }
    (values, available)
}

pub fn build(
    db: &Connection,
    event: Option<&WidgetEvent>,
    now_ms: i64,
    seed: u64,
) -> Result<EvalContext, String> {
    let snapshot = storage::snapshot(db)?;
    let (mut values, available) = project(&snapshot, now_ms);
    if values["journal.ready"] == true {
        let count: i64 = db
            .query_row("SELECT COUNT(*) FROM widget_journal", [], |row| row.get(0))
            .map_err(|error| error.to_string())?;
        values.insert("journal.count".into(), json!(count));
        let recent: Option<String> = db.query_row(
            "SELECT json_extract(e.data,'$.kind') FROM widget_events e JOIN widget_journal j ON j.event_id=e.id ORDER BY e.seq DESC LIMIT 1", [], |row| row.get(0),
        ).optional().map_err(|error| error.to_string())?;
        if let Some(kind) = recent {
            values.insert("journal.recentKind".into(), json!(kind));
        }
    }
    if let Some(event) = event {
        values.insert("event.kind".into(), json!(event.event.kind));
        values.insert("event.widget".into(), json!(event.widget_kind));
        for (field, source) in [
            ("action", "action"),
            ("character", "character"),
            ("outcome", "outcome"),
            ("mode", "mode"),
            ("itemName", "name"),
        ] {
            let value = event.event.payload[source]
                .as_str()
                .map(|text| json!(text))
                .unwrap_or(Value::Null);
            values.insert(format!("event.{field}"), value);
        }
    }
    let active = [
        crate::characters::active_character(db, "a")?.id,
        crate::characters::active_character(db, "b")?.id,
    ];
    Ok(EvalContext {
        values,
        active,
        available,
        now_ms,
        seed,
        trigger: event
            .map(|event| event.event.kind.clone())
            .unwrap_or_else(|| "idle".into()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::widgets::{WidgetInstance, WidgetView};

    fn snapshot(kind: &str, data: Value) -> WidgetSnapshot {
        WidgetSnapshot {
            catalog: vec![],
            onboarding_done: true,
            widgets: vec![WidgetView {
                instance: WidgetInstance {
                    id: "test".into(),
                    kind: kind.into(),
                    version: 1,
                    installed: true,
                    enabled: true,
                    revision: 1,
                    data,
                    error: None,
                },
                status: "enabled".into(),
                missing: vec![],
                package_bytes: 0,
            }],
        }
    }

    #[test]
    fn unavailable_and_failed_weather_are_not_zero_temperature() {
        let now = 1_000_000;
        let mut data = json!({"status":"ready","lastSuccessAt":now,"observation":{"temperature":0,"weatherCode":3,"name":"서울","observedAt":now}});
        let (ready, _) = project(&snapshot("weather", data.clone()), now);
        assert_eq!(ready["weather.temperature"], 0);
        assert_eq!(ready["weather.ready"], true);
        assert_eq!(ready["todo.openCount"], Value::Null);
        data["status"] = json!("offline");
        let (failed, _) = project(&snapshot("weather", data), now);
        assert_eq!(failed["weather.temperature"], Value::Null);
        assert_eq!(failed["weather.status"], "offline");
    }

    #[test]
    fn elapsed_freshness_invalidates_successful_cache() {
        let now = 1_000_000;
        let data = json!({"status":"ready","lastSuccessAt":now,"observation":{"playing":false,"running":true,"title":null}});
        let (ready, _) = project(&snapshot("music", data.clone()), now);
        assert_eq!(ready["music.playing"], false);
        assert_eq!(ready["music.title"], Value::Null);
        let (old, _) = project(&snapshot("music", data), now + 30_001);
        assert_eq!(old["music.ready"], false);
        assert_eq!(old["music.status"], "stale");
        assert_eq!(old["music.playing"], Value::Null);
    }

    #[test]
    fn calendar_partial_failure_cannot_claim_empty_or_latest() {
        let now = 1_000_000;
        let mut data = json!({"connections":[{"status":"ready","lastSuccessAt":now},{"status":"offline","lastSuccessAt":now}],"events":[]});
        let (failed, _) = project(&snapshot("calendar", data.clone()), now);
        assert_eq!(failed["calendar.eventCount"], Value::Null);
        data["connections"][1]["status"] = json!("ready");
        let (empty, _) = project(&snapshot("calendar", data), now);
        assert_eq!(empty["calendar.eventCount"], 0);
        assert_eq!(empty["calendar.nextTitle"], Value::Null);
    }

    #[test]
    fn hidden_answer_and_secrets_never_enter_registry_or_values() {
        let (values, _) = project(
            &snapshot(
                "guessing",
                json!({"playing":true,"answer":42,"hint":"더 큰 숫자예요.","attempts":1,"mode":"number","accessToken":"secret"}),
            ),
            0,
        );
        assert_eq!(values["guessing.hint"], "더 큰 숫자예요.");
        assert!(!values
            .keys()
            .any(|key| key.contains("answer") || key.contains("Token")));
        assert!(!serde_json::to_string(&values).unwrap().contains("secret"));
        assert_eq!(FIELDS.len(), widgets::catalog().unwrap().len());
    }

    #[test]
    fn disabled_dependency_prevents_projection_and_availability() {
        let mut state = snapshot("completion-jar", json!({"completed":[]}));
        state.widgets[0].missing = vec!["todo".into()];
        state.widgets[0].status = "setup".into();
        let (values, available) = project(&state, 0);
        assert_eq!(values["jar.count"], Value::Null);
        assert_eq!(values["jar.ready"], false);
        assert!(!available.contains("completion-jar"));
    }

    #[test]
    fn counts_describe_actual_items_and_collection_not_events() {
        let (todo, _) = project(
            &snapshot(
                "todo",
                json!({"items":[{"completedAt":null,"dueAt":1},{"completedAt":2,"dueAt":1},{"completedAt":null,"dueAt":null}]}),
            ),
            10,
        );
        assert_eq!(todo["todo.openCount"], 2);
        assert_eq!(todo["todo.completedCount"], 1);
        assert_eq!(todo["todo.overdueCount"], 1);
        let (collection, _) = project(
            &snapshot(
                "collection",
                json!({"items":[{"quantity":5}],"decorations":[{},{}]}),
            ),
            10,
        );
        assert_eq!(collection["collection.count"], 1);
        assert_eq!(collection["collection.decorationCount"], 2);
    }
    #[test]
    fn build_projects_all_catalog_kinds_and_allowlisted_event_only() {
        let db = crate::store::open(std::path::Path::new(":memory:")).unwrap();
        for manifest in widgets::catalog().unwrap() {
            let data = widgets::initial(&manifest.id).unwrap();
            db.execute("INSERT INTO widget_instances(id,kind,version,installed,enabled,revision,data,error) VALUES(?1,?1,1,1,1,0,?2,NULL)", rusqlite::params![manifest.id, serde_json::to_string(&data).unwrap()]).unwrap();
        }
        let event = WidgetEvent {
            id: "test".into(),
            instance_id: "interaction".into(),
            widget_kind: "interaction".into(),
            revision: 0,
            created_at: 0,
            expires_at: 30_000,
            event: widgets::EventDraft {
                kind: "interaction.touch".into(),
                text: "<<malicious>>".into(),
                payload: json!({"action":"poke","character":"A","secret":"never","answer":42}),
            },
        };
        let context = build(&db, Some(&event), 100, 5).unwrap();
        assert_eq!(context.available.len(), 22);
        assert_eq!(context.values["event.action"], "poke");
        assert_eq!(context.values["journal.count"], 0);
        assert_eq!(context.values["todo.openCount"], 0);
        assert_eq!(context.values["weather.temperature"], Value::Null);
        assert_eq!(context.active, ["builtin-a", "builtin-b"]);
        let serialized = serde_json::to_string(&context.values).unwrap();
        assert!(!serialized.contains("malicious"));
        assert!(!serialized.contains("never"));
    }
    #[test]
    fn timer_remaining_time_and_wake_do_not_depend_on_stale_display_values() {
        let (timer, _) = project(
            &snapshot(
                "focus-timer",
                json!({"status":"running","mode":"focus","deadline":2000,"remainingMs":5000}),
            ),
            1000,
        );
        assert_eq!(timer["timer.remainingMs"], 1000);
        let (wake, _) = project(
            &snapshot(
                "device",
                json!({"configured":true,"status":"offline","lastWakeAt":1000,"observation":null}),
            ),
            1500,
        );
        assert_eq!(wake["device.woke"], true);
        assert_eq!(wake["device.ready"], false);
        assert_eq!(wake["device.percent"], Value::Null);
    }
    #[test]
    fn initial_refresh_is_loading_and_weather_age_uses_observation_time() {
        let now = 10_000_000;
        for kind in ["weather", "music", "device"] {
            let (values, _) = project(
                &snapshot(
                    kind,
                    json!({"status":"syncing","lastSuccessAt":null,"observation":null}),
                ),
                now,
            );
            assert_eq!(values[&format!("{kind}.status")], "syncing");
            assert_eq!(values[&format!("{kind}.ready")], false);
        }
        let (weather, _) = project(
            &snapshot(
                "weather",
                json!({"status":"ready","lastSuccessAt":now,"observation":{"temperature":12,"observedAt":1}}),
            ),
            now,
        );
        assert_eq!(weather["weather.status"], "stale");
        assert_eq!(weather["weather.temperature"], Value::Null);
    }
    #[test]
    fn installation_failures_and_missing_success_cache_remain_distinct() {
        let now = 1000;
        for (installed, enabled, status) in
            [(false, false, "install-error"), (true, false, "disabled")]
        {
            let mut state = snapshot(
                "weather",
                json!({"status":"ready","lastSuccessAt":now,"observation":{"temperature":0,"observedAt":now}}),
            );
            state.widgets[0].instance.installed = installed;
            state.widgets[0].instance.enabled = enabled;
            state.widgets[0].status = status.into();
            let (values, available) = project(&state, now);
            assert_eq!(values["weather.status"], status);
            assert_eq!(values["weather.ready"], false);
            assert_eq!(values["weather.temperature"], Value::Null);
            assert!(!available.contains("weather"));
        }
        for kind in ["weather", "music", "device"] {
            let (values, _) = project(
                &snapshot(
                    kind,
                    json!({"status":"ready","lastSuccessAt":now,"observation":null}),
                ),
                now,
            );
            assert_eq!(values[&format!("{kind}.status")], "error");
            assert_eq!(values[&format!("{kind}.ready")], false);
        }
    }
}
