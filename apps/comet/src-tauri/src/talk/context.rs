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
    ("travel", "travel", "count daysUntil", "title stage", ""),
];

fn description(prefix: &str, field: &str, nullable: bool) -> String {
    let text = match (prefix, field) {
        ("dialogue", "variant") => "한 대본 재생 동안 고정되는 0~4 변형 번호",
        ("environment", "weatherReady") => "날씨 연결에 2시간 이내의 유효한 관측이 있는지 여부. 연결 실패·오래됨에는 false",
        ("environment", "weatherStatus") => "날씨 연결 상태. not-installed·disabled·offline·stale을 관측 성공과 구분",
        ("environment", "weatherTemperature") => "날씨 연결의 최신 관측 기온(섭씨)",
        ("environment", "weatherCode") => "날씨 연결의 최신 WMO weatherCode 숫자",
        ("environment", "weatherName") => "날씨 연결의 관측 대상 지역 이름",
        ("character.nadir", "present") => "활성 캐릭터 중 sourceId가 nadir인 캐릭터가 있는지 여부",
        ("character", "count") => "지금 바탕화면에 함께 지내는 캐릭터 수(1~8). speakers: random 장면의 화자 수 조건에 사용",
        (_, "sourceId") if prefix.starts_with("character.") => "현재 자리에 설치된 캐릭터의 원본 sourceId. 표시 이름·로컬 ID와 구분",
        (_, "affinity") if prefix.starts_with("character.") => "해당 캐릭터의 현재 친밀도 점수",
        (_, "total") if prefix.starts_with("character.") && prefix.ends_with(".touches") => "현재 사용자와 해당 캐릭터의 누적 교감 횟수",
        (_, "stroke") if prefix.starts_with("character.") && prefix.ends_with(".touches") => "현재 사용자와 해당 캐릭터의 누적 쓰다듬기 횟수",
        (_, "poke") if prefix.starts_with("character.") && prefix.ends_with(".touches") => "현재 사용자와 해당 캐릭터의 누적 찌르기 횟수",
        (_, "cheek") if prefix.starts_with("character.") && prefix.ends_with(".touches") => "현재 사용자와 해당 캐릭터의 누적 볼 잡기 횟수",
        (_, "snack") if prefix.starts_with("character.") && prefix.ends_with(".touches") => "현재 사용자와 해당 캐릭터의 누적 간식 횟수",
        (_, "today") if prefix.starts_with("character.") && prefix.ends_with(".touches") => "기기 현지 오늘의 교감 횟수",
        ("interaction", "milestone") => "이번 교감에서 달성한 기념 횟수. 기념이 없으면 null",
        ("interaction", "milestoneAction") => "기념 횟수를 달성한 누적 종류: total, stroke, poke, cheek 또는 snack",

        ("travel", "count") => "끝나지 않은 여행 수. 다녀와서 정리 중인 여행도 포함",
        ("travel", "daysUntil") => "가장 가까운 여행의 첫날까지 남은 일수(그곳 날짜 기준). 이미 시작했으면 0 이하",
        ("travel", "title") => "가장 가까운 여행의 이름. 여행이 없으면 null",
        ("travel", "stage") => "가장 가까운 여행의 단계: planning, before, traveling, wrapping",
        (_, "ready") => "연결과 데이터 최신성 검사를 통과했는지 여부",
        (_, "status") => "연결 상태. unavailable·실패·stale은 성공한 빈 값과 구분",
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
        (_, "bounces") => "호환용 이전 공 충돌 통계. 현재는 항상 null",
        (_, "flying") => "종이비행기가 현재 비행 중인지 여부",
        (_, "distance") => "호환용 이전 종이비행기 이동 거리. 현재는 항상 null",
        (_, "best") => "호환용 이전 종이비행기 최고 기록. 현재는 항상 null",
        ("bubbles", "count") => "현재 화면에 남은 비눗방울 수",
        (_, "streak") => "호환용 이전 비눗방울 연속 통계. 현재는 항상 null",
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
        (_, "arrivals") => "호환용 이전 펫 도착 통계. 현재는 항상 null",
        ("collection", "count") => "수집함에 있는 서로 다른 물건 종류 수. 총 수량이 아님",
        (_, "decorationCount") => "현재 꺼내 배치한 소품 수",
        ("journal", "count") => "켜 둔 사건 일지에 실제로 보관한 사건 수",
        (_, "recentKind") => "보관된 사건 일지 중 가장 최근 사건의 kind. 일지가 비었으면 null",
        ("event", "kind") => "현재 전달된 실제 사건의 kind. idle 평가에는 null",
        ("event", "widget") => "현재 사건을 발행한 위젯 kind",
        ("event", "action") => "교감 사건의 실제 사용자 동작: stroke, poke, snack",
        ("event", "character") => "교감 사건의 대상 자리: 함께 지내는 순서의 A~H",
        ("event", "outcome") => "작은 승부 또는 맞히기 결과의 기계 식별자. 공개된 결과만 제공",
        ("event", "mode") => "사건의 timer 모드, 승부 종류 또는 맞히기 종류",
        ("event", "itemName") => "실제 item-acquired 사건에서 획득한 물건 이름",
        _ => "읽기 전용 위젯 관측값",
    };
    if prefix == "environment" && field == "hour" {
        return format!("{text}. 시계 위젯 설치와 무관하며 표현할 수 없는 시각만 null.");
    }
    if prefix.starts_with("character.") && nullable {
        return format!("{text}. 해당 캐릭터가 없으면 null.");
    }
    if nullable {
        format!("{text}. 자료 없음·오래됨에는 null(별도 명시된 독립 관측값 제외).")
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
    add("interaction", "milestone", ValueType::Number, true, None);
    add("interaction", "milestoneAction", ValueType::String, true, None);
    add("dialogue", "variant", ValueType::Number, false, None);
    add("environment", "hour", ValueType::Number, true, None);
    add(
        "environment",
        "weatherReady",
        ValueType::Boolean,
        false,
        None,
    );
    add(
        "environment",
        "weatherStatus",
        ValueType::String,
        false,
        None,
    );
    for field in ["weatherTemperature", "weatherCode"] {
        add("environment", field, ValueType::Number, true, None);
    }
    add("environment", "weatherName", ValueType::String, true, None);
    for persona in crate::characters::SLOTS {
        for field in ["total", "stroke", "poke", "cheek", "snack", "today"] {
            add(
                &format!("character.{persona}.touches"),
                field,
                ValueType::Number,
                true,
                None,
            );
        }
        add(
            &format!("character.{persona}"),
            "sourceId",
            ValueType::String,
            true,
            None,
        );
        add(
            &format!("character.{persona}"),
            "affinity",
            ValueType::Number,
            true,
            None,
        );
    }
    add(
        "character.nadir",
        "present",
        ValueType::Boolean,
        false,
        None,
    );
    add("character.nadir", "affinity", ValueType::Number, true, None);
    add("character", "count", ValueType::Number, false, None);
    Registry {
        variables,
        events: [
            "idle",
            "todo-completed",
            "todo-undone",
            "timer-finished",
            "calendar-reminder",
            "planner-reminder",
            "planner-mood",
            "device-woke",
            "interaction.touch",
            "interaction.milestone",
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
            .find(|item| item.instance.kind == kind && !widgets::is_retired(kind));
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
        available.insert(kind.to_owned());
        if widget.status == "install-error" {
            continue;
        }
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
            if matches!(
                (prefix, field),
                ("ball", "bounces")
                    | ("plane", "distance" | "best")
                    | ("bubbles", "streak")
                    | ("pet", "arrivals")
            ) {
                continue;
            }
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
                if d["config"]["allowTalk"] == false {
                    set("ready", json!(false));
                    set("status", json!("disabled"));
                    available.remove(kind);
                    continue;
                }
                let o = &d["observation"];
                set("temperature", o["temperature"].clone());
                set("code", o["weatherCode"].clone());
                set("name", o["name"].clone());
            }
            "music" => {
                if d["config"]["allowTalk"] == false {
                    set("ready", json!(false));
                    set("status", json!("disabled"));
                    available.remove(kind);
                    continue;
                }
                for field in ["running", "playing"] {
                    set(field, d["observation"][field].clone());
                }
                if d["observation"]["playing"] == true {
                    for field in ["title", "artist"] {
                        set(field, d["observation"][field].clone());
                    }
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
    values.insert(
        "environment.hour".into(),
        json!(instant.map(|time| time.hour())),
    );
    for (target, source) in [
        ("weatherReady", "ready"),
        ("weatherStatus", "status"),
        ("weatherTemperature", "temperature"),
        ("weatherCode", "code"),
        ("weatherName", "name"),
    ] {
        values.insert(
            format!("environment.{target}"),
            values[&format!("weather.{source}")].clone(),
        );
    }
    (values, available)
}

fn body_interaction_data<'a>(
    db: &Connection,
    snapshot: &'a WidgetSnapshot,
    event: Option<&WidgetEvent>,
    active: &[String],
    now: i64,
) -> Result<Option<&'a Value>, String> {
    let Some(event) = event.filter(|event| {
        event.widget_kind == "interaction"
            && matches!(
                event.event.kind.as_str(),
                "interaction.touch" | "interaction.milestone"
            )
            && event.event.payload["source"] == "body"
            && event.created_at <= now
            && now.saturating_sub(event.created_at) < 30_000
            && event.expires_at > now
    }) else {
        return Ok(None);
    };
    let Some(owner) = event.event.payload["owner"].as_str() else {
        return Ok(None);
    };
    let Some(slot) = active.iter().position(|id| id == owner) else {
        return Ok(None);
    };
    let Some(action) = event.event.payload["action"].as_str().filter(|action| {
        matches!(
            *action,
            "poke" | "stroke" | "cheek-grab" | "snack" | "drink" | "gift"
        )
    }) else {
        return Ok(None);
    };
    if event.event.payload["character"] != ((b'A' + slot as u8) as char).to_string() {
        return Ok(None);
    }
    let receipt: Option<String> = db
        .query_row(
            "SELECT fingerprint FROM widget_requests WHERE id=?",
            [&event.id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    if receipt.as_deref() != Some(format!("body:{owner}:{action}").as_str()) {
        return Ok(None);
    }
    Ok(snapshot
        .widgets
        .iter()
        .find(|widget| {
            widget.instance.kind == "interaction"
                && widget.instance.id == event.instance_id
                && widget.instance.revision == event.revision
        })
        .map(|widget| &widget.instance.data))
}

pub fn build(
    db: &Connection,
    event: Option<&WidgetEvent>,
    now_ms: i64,
    seed: u64,
) -> Result<EvalContext, String> {
    let snapshot = storage::snapshot(db)?;
    let (mut values, mut available) = project(&snapshot, now_ms);
    let characters = crate::characters::active_members(db)?;
    let active = characters
        .iter()
        .map(|member| member.id.clone())
        .collect::<Vec<_>>();
    let body_data = body_interaction_data(db, &snapshot, event, &active, now_ms)?;
    if let Some(data) = body_data {
        available.insert("interaction".into());
        values.insert("interaction.ready".into(), json!(true));
        values.insert("interaction.status".into(), json!("body"));
        for field in ["snacks", "touches"] {
            values.insert(format!("interaction.{field}"), data[field].clone());
        }
    }
    if values["travel.ready"] == true {
        // Trips live in the diary; the widget only says the user wants to hear about them.
        let diary = crate::diary::read(db)?;
        let now = DateTime::from_timestamp_millis(now_ms).unwrap_or_default();
        let open: Vec<_> = diary
            .travels()
            .iter()
            .map(|travel| (travel, crate::diary::travel::stage(travel, now)))
            .filter(|(_, (stage, _))| *stage != "done")
            .collect();
        values.insert("travel.count".into(), json!(open.len()));
        let nearest = open
            .iter()
            .filter(|(_, (stage, _))| *stage != "wrapping")
            .min_by_key(|(_, (_, days))| *days)
            .or_else(|| open.first());
        if let Some((travel, (stage, days))) = nearest {
            values.insert("travel.title".into(), json!(travel.title));
            values.insert("travel.stage".into(), json!(stage));
            values.insert("travel.daysUntil".into(), json!(days));
        }
    }
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
    let is_body_receipt = if let Some(event) = event.filter(|event| {
        event.widget_kind == "interaction" && event.event.kind == "interaction.touch"
    }) {
        let receipt: Option<String> = db
            .query_row(
                "SELECT fingerprint FROM widget_requests WHERE id=?",
                [&event.id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        receipt.is_some_and(|value| value.starts_with("body:"))
    } else {
        false
    };
    let event = event.filter(|event| {
        !widgets::is_retired(&event.widget_kind)
            && ((event.event.payload["source"] != "body" && !is_body_receipt)
                || body_data.is_some())
    });
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
        if body_data.is_some() && event.event.payload["action"] == "cheek-grab" {
            values.insert("event.action".into(), json!("stroke"));
        }
        if body_data.is_some() {
            if let Some(milestone) = event.event.payload["milestone"].as_i64() {
                values.insert("interaction.milestone".into(), json!(milestone));
                let counter = match event.event.payload["counter"].as_str() {
                    Some(counter @ ("total" | "stroke" | "poke" | "cheek" | "snack")) => {
                        Some(counter)
                    }
                    _ => None,
                };
                values.insert("interaction.milestoneAction".into(), json!(counter));
            }
        }
    }
    let relationships = crate::store::relationships(db)?;
    values.insert("dialogue.variant".into(), json!(seed % 5));
    values.insert("character.nadir.present".into(), json!(false));
    values.insert("character.count".into(), json!(characters.len()));
    for (persona, character) in crate::characters::SLOTS.into_iter().zip(&characters) {
        let touches = storage::character_touches(db, &character.id, now_ms)?;
        for (field, count) in [
            ("total", touches.total),
            ("stroke", touches.stroke),
            ("poke", touches.poke),
            ("cheek", touches.cheek),
            ("snack", touches.snack),
            ("today", touches.today),
        ] {
            values.insert(
                format!("character.{persona}.touches.{field}"),
                json!(count),
            );
        }
        let score = relationships
            .iter()
            .find(|item| item.persona == character.id)
            .map_or(20, |item| item.score);
        values.insert(
            format!("character.{persona}.sourceId"),
            json!(character.definition.source_id),
        );
        values.insert(format!("character.{persona}.affinity"), json!(score));
        if character.definition.source_id == "nadir" {
            values.insert("character.nadir.present".into(), json!(true));
            values.insert("character.nadir.affinity".into(), json!(score));
        }
    }
    Ok(EvalContext {
        values,
        visible: active.clone(),
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

    #[test]
    fn body_interaction_context_requires_a_fresh_owned_receipt_and_keeps_widget_gates() {
        let db = crate::store::open(std::path::Path::new(":memory:")).unwrap();
        let owner = crate::characters::active_ids(&db).unwrap()[1].clone();
        let event = storage::body_interaction(
            &db,
            &owner,
            "stroke",
            &uuid::Uuid::new_v4().to_string(),
            1000,
        )
        .unwrap()
        .unwrap();
        let program = super::super::validate_source(
            std::path::Path::new("body.talk"),
            "format: 1\nscene: body\non: interaction.touch\nwhen: event.action == \"stroke\" and interaction.touches > 0\n---\nB: 교감 대사\n===\n",
            &registry(),
        )
        .unwrap();
        let context = build(&db, Some(&event), 1001, 0).unwrap();
        assert_eq!(context.values["interaction.snacks"], 6);
        assert_eq!(context.values["interaction.touches"], 1);
        assert!(
            super::super::simulate(&program, &context, &super::super::History::new())
                .selected
                .is_some()
        );
        let idle = build(&db, None, 1001, 0).unwrap();
        assert!(idle.available.contains("interaction"));
        assert_eq!(idle.values["event.action"], Value::Null);
        for kind in 0..6 {
            let mut invalid = event.clone();
            match kind {
                0 => invalid.event.payload["source"] = Value::Null,
                1 => invalid.id = uuid::Uuid::new_v4().to_string(),
                2 => invalid.event.payload["owner"] = json!("other"),
                3 => invalid.revision += 1,
                4 => invalid.expires_at = 1001,
                _ => invalid.event.payload["character"] = json!("A"),
            }
            let context = build(&db, Some(&invalid), 1001, 0).unwrap();
            assert!(context.available.contains("interaction"), "case {kind}");
            assert_eq!(context.values["event.action"], Value::Null, "case {kind}");
            assert!(
                super::super::simulate(&program, &context, &super::super::History::new())
                    .selected
                    .is_none(),
                "case {kind}"
            );
        }
        let cheek = storage::body_interaction(
            &db,
            &owner,
            "cheek-grab",
            &uuid::Uuid::new_v4().to_string(),
            6001,
        )
        .unwrap()
        .unwrap();
        assert_eq!(
            build(&db, Some(&cheek), 6002, 0).unwrap().values["event.action"],
            "stroke"
        );
        let stale = build(&db, Some(&event), 6002, 0).unwrap();
        assert!(stale.available.contains("interaction"));
        assert_eq!(stale.values["event.action"], Value::Null);

        let widget = storage::instances(&db).unwrap().into_iter()
            .find(|instance| instance.kind == "interaction").unwrap();
        storage::execute(&db, &crate::widgets::WidgetRequest {
            request_id: uuid::Uuid::new_v4().to_string(),
            instance_id: widget.id,
            expected_revision: widget.revision,
            action: "stroke".into(),
            input: json!({"character":"B", "owner":owner}),
        }, 12_000, 0).unwrap();
        let normal_event = storage::take_reaction(&db, 12_001).unwrap().unwrap();
        let normal_context = build(&db, Some(&normal_event), 12_001, 0).unwrap();
        assert_eq!(normal_context.values["event.action"], "stroke");
    }

    #[test]
    fn core_context_is_typed_and_time_available_before_weather_setup() {
        let db = crate::store::open(std::path::Path::new(":memory:")).unwrap();
        let now = 1_000_000;
        let context = build(&db, None, now, 14).unwrap();
        assert_eq!(
            context.values["environment.hour"],
            DateTime::from_timestamp_millis(now)
                .unwrap()
                .with_timezone(&Local)
                .hour()
        );
        assert_eq!(context.values["environment.weatherReady"], false);
        assert_eq!(context.values["environment.weatherStatus"], "permission-needed");
        assert_eq!(
            context.values["environment.weatherTemperature"],
            Value::Null
        );
        assert_eq!(context.values["environment.weatherCode"], Value::Null);
        assert_eq!(context.values["dialogue.variant"], 4);
        for variable in registry()
            .variables
            .values()
            .filter(|variable| !variable.nullable)
        {
            let value = &context.values[&variable.name];
            assert!(!value.is_null(), "{}", variable.name);
            assert!(
                match variable.kind {
                    ValueType::Boolean => value.is_boolean(),
                    ValueType::Number => value.is_number(),
                    ValueType::String => value.is_string(),
                },
                "{}",
                variable.name
            );
        }
    }

    #[test]
    fn core_weather_never_turns_missing_stale_or_failed_observation_into_facts() {
        let now = 10_000_000;
        let source = json!({"status":"ready","lastSuccessAt":now,"observation":{"temperature":0,"weatherCode":3,"name":"서울","observedAt":now}});
        let (fresh, _) = project(&snapshot("weather", source.clone()), now);
        assert_eq!(fresh["environment.weatherReady"], true);
        assert_eq!(fresh["environment.weatherTemperature"], 0);
        assert_eq!(fresh["environment.weatherCode"], 3);
        assert_eq!(fresh["environment.weatherName"], "서울");
        for failure in ["stale", "offline", "missing"] {
            let mut state = snapshot("weather", source.clone());
            match failure {
                "stale" => state.widgets[0].instance.data["observation"]["observedAt"] = json!(0),
                "offline" => state.widgets[0].instance.data["status"] = json!("offline"),
                "missing" => state.widgets[0].instance.data["observation"] = Value::Null,
                _ => unreachable!(),
            }
            let (values, _) = project(&state, now);
            assert_eq!(values["environment.weatherReady"], false, "{failure}");
            for name in ["weatherTemperature", "weatherCode", "weatherName"] {
                assert_eq!(
                    values[&format!("environment.{name}")],
                    Value::Null,
                    "{failure}"
                );
            }
        }
    }

    fn snapshot(kind: &str, data: Value) -> WidgetSnapshot {
        WidgetSnapshot {
            catalog: vec![],
            onboarding_done: true,
            widgets: vec![WidgetView {
                instance: WidgetInstance {
                    id: "test".into(),
                    kind: kind.into(),
                    version: 1,
                    revision: 1,
                    data,
                    error: None,
                },
                status: "enabled".into(),
                missing: vec![],
                reaction: true,
                package_bytes: 0,
                background_updated_at: None,
            }],
        }
    }

    #[test]
    fn disabling_reactions_keeps_weather_context_available() {
        let now = 1_000_000;
        let mut state = snapshot(
            "weather",
            json!({"status":"ready","lastSuccessAt":now,"observation":{"temperature":0,"observedAt":now}}),
        );
        state.widgets[0].reaction = false;
        let (values, available) = project(&state, now);
        assert!(available.contains("weather"));
        assert_eq!(values["weather.ready"], true);
        assert_eq!(values["weather.temperature"], 0);
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
    fn retired_toy_statistics_stay_null_even_with_saved_legacy_values() {
        for (kind, prefix, stats, state, expected) in [
            ("ball", "ball", vec!["bounces"], "moving", json!(true)),
            (
                "paper-plane",
                "plane",
                vec!["distance", "best"],
                "flying",
                json!(true),
            ),
            ("bubbles", "bubbles", vec!["streak"], "count", json!(1)),
            ("pet", "pet", vec!["arrivals"], "moving", json!(true)),
        ] {
            let mut data =
                json!({"moving":true,"flying":true,"bubbles":[{"id":1}],"food":{"x":50,"y":50}});
            for field in &stats {
                data[*field] = json!(123);
            }
            let snapshot = snapshot(kind, data.clone());
            let (values, available) = project(&snapshot, 1_000_000);
            assert!(available.contains(kind));
            assert_eq!(values[&format!("{prefix}.{state}")], expected);
            for field in stats {
                let name = format!("{prefix}.{field}");
                assert_eq!(values[&name], Value::Null, "{name}");
                assert!(registry().variables.contains_key(&name));
            }
            assert_eq!(snapshot.widgets[0].instance.data, data);
        }
    }

    #[test]
    fn music_talk_permission_does_not_expose_screen_metadata() {
        let now = 1_000_000;
        let data = json!({"status":"ready","lastSuccessAt":now,"config":{"allowTalk":false},
            "observation":{"running":true,"playing":true,"title":"Song","artist":"Artist"}});
        let (values, available) = project(&snapshot("music", data), now);
        assert_eq!(values["music.ready"], false);
        assert_eq!(values["music.status"], "disabled");
        assert_eq!(values["music.title"], Value::Null);
        assert!(!available.contains("music"));
    }
    #[test]
    fn weather_talk_permission_keeps_local_weather_out_of_conversation_context() {
        let now = 1_000_000;
        let data = json!({"status":"ready","lastSuccessAt":now,"config":{"allowTalk":false},"observation":{"observedAt":now,"name":"서울","temperature":21,"weatherCode":0}});
        let (values, available) = project(&snapshot("weather", data), now);
        assert_eq!(values["weather.ready"], false);
        assert_eq!(values["weather.status"], "disabled");
        assert_eq!(values["weather.temperature"], Value::Null);
        assert!(!available.contains("weather"));
    }
    #[test]
    fn elapsed_freshness_invalidates_successful_cache() {
        let now = 1_000_000;
        let data = json!({"status":"ready","lastSuccessAt":now,"observation":{"playing":false,"running":true,"title":"Paused song","artist":"Paused artist"}});
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
        assert_eq!(
            FIELDS
                .iter()
                .filter(|(_, kind, _, _, _)| !widgets::is_retired(kind))
                .count(),
            widgets::catalog().unwrap().len()
        );
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
    fn todo_counts_describe_actual_items_and_retired_collection_stays_unavailable() {
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
        let saved = json!({"items":[{"quantity":5}],"decorations":[{},{}]});
        let state = snapshot("collection", saved.clone());
        let (collection, available) = project(&state, 10);
        assert_eq!(collection["collection.count"], Value::Null);
        assert_eq!(collection["collection.decorationCount"], Value::Null);
        assert_eq!(collection["collection.ready"], false);
        assert!(!available.contains("collection"));
        assert!(registry().variables.contains_key("collection.count"));
        assert_eq!(state.widgets[0].instance.data, saved);
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
        assert_eq!(context.available.len(), 21);
        // Trips come from the diary; a fresh diary has none and no nearest-trip fields.
        assert_eq!(context.values["travel.count"], 0);
        assert_eq!(context.values["travel.title"], Value::Null);
        assert!(!context.available.contains("collection"));
        assert!(!context.available.contains("journal"));
        assert_eq!(context.values["event.action"], "poke");
        assert_eq!(context.values["journal.count"], Value::Null);
        assert_eq!(context.values["journal.ready"], false);
        assert!(registry().variables.contains_key("journal.count"));
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
        let mut state = snapshot(
            "weather",
            json!({"status":"ready","lastSuccessAt":now,"observation":{"temperature":0,"observedAt":now}}),
        );
        state.widgets[0].status = "install-error".into();
        let (values, available) = project(&state, now);
        assert_eq!(values["weather.status"], "install-error");
        assert_eq!(values["weather.ready"], false);
        assert_eq!(values["weather.temperature"], Value::Null);
        assert!(available.contains("weather"));
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
