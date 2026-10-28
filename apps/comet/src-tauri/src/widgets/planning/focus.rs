use super::{decode, encode, optional_text, text, TodoState};
use crate::widgets::calendar::NoteReference;
use crate::widgets::{EventDraft, WidgetEffect};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;

#[cfg(test)]
mod tests;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Timer {
    status: String,
    mode: String,
    duration_ms: i64,
    #[serde(default)]
    focus_duration_ms: Option<i64>,
    remaining_ms: i64,
    deadline: Option<i64>,
    todo_id: Option<String>,
    #[serde(default)]
    title: String,
    #[serde(default = "presentation")]
    presentation: String,
    #[serde(default)]
    event_ref: Option<EventReference>,
    #[serde(default)]
    note_ref: Option<NoteReference>,
    #[serde(default)]
    memo: String,
    #[serde(default)]
    settings: Settings,
    #[serde(default)]
    sessions: Vec<Session>,
    #[serde(default)]
    active_session: Option<ActiveSession>,
    #[serde(default)]
    completed_focus_pending: bool,
    #[serde(default)]
    app_usage_target: Option<crate::widgets::AppUsageTarget>,
    #[serde(default)]
    queue: Vec<QueueItem>,
    #[serde(default)]
    cycle: u64,
    #[serde(default)]
    rest_kind: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct QueueItem {
    id: String,
    todo_id: Option<String>,
    title: String,
    focus_duration_ms: i64,
    event_ref: Option<EventReference>,
    note_ref: Option<NoteReference>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EventReference {
    calendar_widget_id: String,
    id: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    start_at: Option<i64>,
    #[serde(default)]
    end_at: Option<i64>,
    #[serde(default)]
    connection_id: String,
    #[serde(default)]
    source_id: String,
    #[serde(default)]
    occurrence_id: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Settings {
    #[serde(default = "rest_duration")]
    rest_duration_ms: i64,
    #[serde(default)]
    auto_start_rest: bool,
    #[serde(default = "finish_notification")]
    finish_notification: String,
    #[serde(default)]
    finish_sound_enabled: bool,
    #[serde(default)]
    linked_event_lead_minutes: Option<i64>,
    #[serde(default = "enabled")]
    record_timeline: bool,
    #[serde(default)]
    continuous: bool,
    #[serde(default = "long_rest_every")]
    long_rest_every: u8,
    #[serde(default = "long_rest_duration")]
    long_rest_duration_ms: i64,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            rest_duration_ms: rest_duration(),
            auto_start_rest: false,
            finish_notification: finish_notification(),
            finish_sound_enabled: false,
            linked_event_lead_minutes: None,
            record_timeline: true,
            continuous: false,
            long_rest_every: long_rest_every(),
            long_rest_duration_ms: long_rest_duration(),
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Segment {
    start_at: i64,
    end_at: i64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppUsage {
    target: crate::widgets::AppUsageTarget,
    elapsed_ms: i64,
    status: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActiveSession {
    id: String,
    title: String,
    started_at: i64,
    elapsed_ms: i64,
    running_since: Option<i64>,
    duration_ms: i64,
    todo_id: Option<String>,
    event_ref: Option<EventReference>,
    note_ref: Option<NoteReference>,
    memo: String,
    segments: Vec<Segment>,
    #[serde(default = "enabled")]
    record_timeline: bool,
    #[serde(default)]
    app_usage: Option<AppUsage>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Session {
    id: String,
    title: String,
    started_at: i64,
    ended_at: i64,
    elapsed_ms: i64,
    duration_ms: i64,
    outcome: String,
    todo_id: Option<String>,
    event_ref: Option<EventReference>,
    note_ref: Option<NoteReference>,
    memo: String,
    segments: Vec<Segment>,
    #[serde(default = "enabled")]
    record_timeline: bool,
    #[serde(default)]
    app_usage: Option<AppUsage>,
}

fn enabled() -> bool {
    true
}

fn finish_notification() -> String {
    "bubble".into()
}

fn rest_duration() -> i64 {
    300000
}

fn long_rest_every() -> u8 {
    4
}

fn long_rest_duration() -> i64 {
    900000
}

fn presentation() -> String {
    "dial".into()
}

pub(super) fn initial() -> Value {
    json!({
        "status":"idle", "mode":"focus", "durationMs":1500000,
        "focusDurationMs":1500000, "remainingMs":1500000, "deadline":null,
        "todoId":null, "title":"", "presentation":"dial", "eventRef":null,
        "noteRef":null, "memo":"", "settings":{
            "restDurationMs":rest_duration(), "autoStartRest":true,
            "finishNotification":"both", "finishSoundEnabled":true,
            "linkedEventLeadMinutes":5, "recordTimeline":true,
            "continuous":false, "longRestEvery":long_rest_every(),
            "longRestDurationMs":long_rest_duration()
        }, "completedFocusPending":false,
        "sessions":[], "activeSession":null, "queue":[], "cycle":0, "restKind":null
    })
}

fn duration(input: &Value, fallback: i64) -> Result<i64, String> {
    let duration = match input.get("durationMs") {
        None => fallback,
        Some(value) => value.as_i64().ok_or("타이머 길이가 올바르지 않습니다.")?,
    };
    if !(1000..=86400000).contains(&duration) {
        return Err("타이머는 1초부터 24시간까지 설정할 수 있습니다.".into());
    }
    Ok(duration)
}

fn bounded(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && value.chars().count() <= max
}

fn event_reference(
    input: &Value,
    related: &BTreeMap<String, Value>,
) -> Result<EventReference, String> {
    let mut reference: EventReference = serde_json::from_value(input.clone())
        .map_err(|_| "연결할 일정 형식이 올바르지 않습니다.")?;
    if !bounded(&reference.calendar_widget_id, 200) || !bounded(&reference.id, 8192) {
        return Err("연결할 일정 식별자가 올바르지 않습니다.".into());
    }
    let event = related
        .get("calendar")
        .and_then(|data| data["events"].as_array())
        .and_then(|events| {
            events
                .iter()
                .find(|event| event["id"] == reference.id && event["cancelled"] != true)
        })
        .ok_or("현재 조회할 수 있는 일정을 선택해 주세요.")?;
    reference.title = event["title"].as_str().unwrap_or_default().into();
    reference.start_at = event["startAt"].as_i64();
    reference.end_at = event["endAt"].as_i64();
    reference.connection_id = event["connectionId"].as_str().unwrap_or_default().into();
    reference.source_id = event["sourceId"].as_str().unwrap_or_default().into();
    reference.occurrence_id = event["occurrenceId"].as_str().unwrap_or_default().into();
    Ok(reference)
}

fn note_reference(
    input: &Value,
    related: &BTreeMap<String, Value>,
) -> Result<NoteReference, String> {
    let mut reference: NoteReference = serde_json::from_value(input.clone())
        .map_err(|_| "연결할 노트 형식이 올바르지 않습니다.")?;
    if !matches!(reference.kind.as_str(), "diary" | "memo")
        || !bounded(&reference.id, 200)
        || reference.title.chars().count() > 500
        || reference
            .widget_id
            .as_deref()
            .is_some_and(|id| !bounded(id, 200))
    {
        return Err("연결할 노트 정보가 올바르지 않습니다.".into());
    }
    if reference.kind == "memo" {
        let note = related
            .get("memo")
            .and_then(|data| data["notes"].as_array())
            .and_then(|notes| notes.iter().find(|note| note["id"] == reference.id))
            .ok_or("현재 조회할 수 있는 메모를 선택해 주세요.")?;
        reference.title = note["title"].as_str().unwrap_or_default().into();
    }
    Ok(reference)
}

fn configure(
    state: &mut Timer,
    input: &Value,
    related: &BTreeMap<String, Value>,
) -> Result<(), String> {
    let keys = [
        "durationMs",
        "title",
        "presentation",
        "todoId",
        "eventRef",
        "noteRef",
        "memo",
        "appUsageTarget",
    ];
    if input
        .as_object()
        .is_some_and(|input| input.keys().any(|key| !keys.contains(&key.as_str())))
    {
        return Err("지원하지 않는 집중 설정입니다.".into());
    }
    if matches!(state.status.as_str(), "running" | "paused")
        && input
            .as_object()
            .is_some_and(|input| input.keys().any(|key| key != "presentation"))
    {
        return Err("집중을 마친 뒤 시간과 연결 정보를 변경해 주세요.".into());
    }
    if let Some(value) = input.get("presentation") {
        let value = value
            .as_str()
            .filter(|value| matches!(*value, "dial" | "digits"))
            .ok_or("타이머 표시 방식을 선택해 주세요.")?;
        state.presentation = value.into();
    }
    if let Some(value) = input.get("appUsageTarget") {
        state.app_usage_target = if value.is_null() {
            None
        } else {
            let target: crate::widgets::AppUsageTarget = serde_json::from_value(value.clone())
                .map_err(|_| "프로그램 선택 정보가 올바르지 않습니다.")?;
            if !bounded(&target.id, 1024)
                || !bounded(&target.name, 200)
                || target.id.chars().any(char::is_control)
                || target.name.chars().any(char::is_control)
            {
                return Err("프로그램 식별자가 올바르지 않습니다.".into());
            }
            Some(target)
        };
    }
    if input.get("title").is_some() {
        state.title = optional_text(input, "title", 500)?;
    }
    if input.get("memo").is_some() {
        state.memo = optional_text(input, "memo", 50000)?;
    }
    if input.get("durationMs").is_some() {
        let value = duration(input, state.focus_duration_ms.unwrap_or(state.duration_ms))?;
        state.focus_duration_ms = Some(value);
        if state.status == "idle" {
            state.duration_ms = value;
            state.remaining_ms = value;
            state.mode = "focus".into();
        }
    }
    if input.get("todoId").is_some() {
        state.todo_id = if input["todoId"].is_null() {
            None
        } else {
            let key = text(input, "todoId", 200)?;
            let todo: TodoState = decode(related.get("todo").ok_or("할 일 위젯을 켜 주세요.")?)?;
            if !todo
                .items
                .iter()
                .any(|todo| todo.id == key && todo.completed_at.is_none())
            {
                return Err("항목을 찾을 수 없습니다.".into());
            }
            Some(key)
        };
    }
    if let Some(value) = input.get("eventRef") {
        state.event_ref = if value.is_null() {
            None
        } else {
            Some(event_reference(value, related)?)
        };
    }
    if let Some(value) = input.get("noteRef") {
        state.note_ref = if value.is_null() {
            None
        } else {
            Some(note_reference(value, related)?)
        };
    }
    Ok(())
}

fn new_session(state: &Timer, now: i64, running: bool) -> ActiveSession {
    ActiveSession {
        id: uuid::Uuid::new_v4().to_string(),
        title: state.title.clone(),
        started_at: now,
        elapsed_ms: 0,
        running_since: running.then_some(now),
        duration_ms: state.duration_ms,
        todo_id: state.todo_id.clone(),
        event_ref: state.event_ref.clone(),
        note_ref: state.note_ref.clone(),
        memo: state.memo.clone(),
        segments: vec![],
        record_timeline: state.settings.record_timeline,
        app_usage: state.app_usage_target.clone().map(|target| AppUsage {
            target,
            elapsed_ms: 0,
            status: "waiting".into(),
        }),
    }
}

fn migrate_active(state: &mut Timer, now: i64) -> bool {
    if state.mode != "focus"
        || state.active_session.is_some()
        || !matches!(state.status.as_str(), "running" | "paused")
    {
        return false;
    }
    // Old timers did not store dated focus intervals. Only observed time is recorded.
    let observed_at = state.deadline.map_or(now, |deadline| now.min(deadline));
    state.active_session = Some(new_session(state, observed_at, state.status == "running"));
    true
}

fn close_segment(state: &mut Timer, now: i64) {
    let Some(active) = state.active_session.as_mut() else {
        return;
    };
    let Some(start) = active.running_since.take() else {
        return;
    };
    let end = state.deadline.map_or(now, |deadline| now.min(deadline));
    let remaining = active.duration_ms.saturating_sub(active.elapsed_ms).max(0);
    let length = end.saturating_sub(start).max(0).min(remaining);
    if length > 0 {
        active.segments.push(Segment {
            start_at: start,
            end_at: start.saturating_add(length),
        });
        active.elapsed_ms = active.elapsed_ms.saturating_add(length);
    }
    if let Some(usage) = active.app_usage.as_mut() {
        usage.elapsed_ms = usage.elapsed_ms.min(active.elapsed_ms).max(0);
    }
}

fn save_session(state: &mut Timer, now: i64, outcome: &str) {
    let ended_at = state.deadline.map_or(now, |deadline| now.min(deadline));
    close_segment(state, now);
    let Some(active) = state.active_session.take() else {
        return;
    };
    if active.elapsed_ms == 0 {
        return;
    }
    state.sessions.push(Session {
        id: active.id,
        title: active.title,
        started_at: active.started_at,
        ended_at: ended_at.max(active.started_at),
        elapsed_ms: active.elapsed_ms,
        duration_ms: active.duration_ms,
        outcome: outcome.into(),
        todo_id: active.todo_id,
        event_ref: active.event_ref,
        note_ref: active.note_ref,
        memo: active.memo,
        segments: active.segments,
        record_timeline: active.record_timeline,
        app_usage: active.app_usage.map(|mut usage| {
            usage.elapsed_ms = usage.elapsed_ms.min(active.elapsed_ms).max(0);
            usage
        }),
    });
}

fn start_queued(
    state: &mut Timer,
    related: &BTreeMap<String, Value>,
    now: i64,
) -> Result<(), String> {
    let item = state.queue.remove(0);
    let todo_exists = item.todo_id.as_ref().is_some_and(|id| {
        related
            .get("todo")
            .and_then(|data| data["items"].as_array())
            .is_some_and(|items| items.iter().any(|todo| todo["id"] == *id))
    });
    state.todo_id = if todo_exists { item.todo_id } else { None };
    state.title = item.title;
    state.event_ref = item.event_ref;
    state.note_ref = item.note_ref;
    state.memo.clear();
    state.app_usage_target = None;
    state.focus_duration_ms = Some(item.focus_duration_ms);
    state.duration_ms = item.focus_duration_ms;
    state.remaining_ms = item.focus_duration_ms;
    state.deadline = Some(
        now.checked_add(item.focus_duration_ms)
            .ok_or("시각 범위를 벗어났습니다.")?,
    );
    state.status = "running".into();
    state.mode = "focus".into();
    state.rest_kind = None;
    state.completed_focus_pending = false;
    state.active_session = Some(new_session(state, now, true));
    Ok(())
}

fn finish(
    mut state: Timer,
    now: i64,
    allow_auto_rest: bool,
    related: &BTreeMap<String, Value>,
) -> Result<WidgetEffect, String> {
    let finished_at = state.deadline.unwrap_or(now);
    let finished_mode = state.mode.clone();
    let finished_todo = state.todo_id.clone();
    let finished_rest_kind = state.rest_kind.clone();
    save_session(&mut state, now, "completed");
    state.status = "finished".into();
    state.deadline = None;
    state.remaining_ms = 0;
    if finished_mode == "focus" {
        state.cycle = state.cycle.saturating_add(1);
    }
    let completed_cycle = state.cycle;
    let start_rest = finished_mode == "focus" && state.settings.auto_start_rest && allow_auto_rest;
    let is_long =
        start_rest && state.cycle % u64::from(state.settings.long_rest_every.clamp(2, 8)) == 0;
    let start_next = finished_mode == "rest"
        && state.settings.continuous
        && allow_auto_rest
        && !state.queue.is_empty();
    let next_title = start_next.then(|| state.queue[0].title.clone());
    let text = if let Some(title) = &next_title {
        format!("쉬는 시간 끝! 이제 '{}' 집중할게요.", title)
    } else if finished_mode == "rest" {
        "쉬는 시간이 끝났어요.".into()
    } else if is_long {
        format!("{}번 집중했어요. 길게 쉬어요.", completed_cycle)
    } else if start_rest {
        "집중 시간이 끝났어요. 쉬는 시간을 시작했어요.".into()
    } else {
        "집중 시간이 끝났어요. 계속할지 쉴지 골라 주세요.".into()
    };
    let event = EventDraft {
        kind: "timer-finished".into(),
        text,
        payload: json!({"todoId":finished_todo,"mode":finished_mode, "bubbleEnabled":state.settings.finish_notification != "os", "finishedAt":finished_at, "cycle":completed_cycle, "restKind":if start_rest { Some(if is_long { "long" } else { "short" }) } else { finished_rest_kind.as_deref() }, "nextTitle":next_title}),
    };
    if start_rest {
        state.mode = "rest".into();
        state.status = "running".into();
        state.rest_kind = Some(if is_long { "long" } else { "short" }.into());
        if is_long {
            state.cycle = 0;
        }
        state.duration_ms = if is_long {
            state.settings.long_rest_duration_ms
        } else {
            state.settings.rest_duration_ms
        };
        state.remaining_ms = state.duration_ms;
        state.deadline = Some(
            now.checked_add(state.duration_ms)
                .ok_or("시각 범위를 벗어났습니다.")?,
        );
        state.completed_focus_pending = true;
    } else if start_next {
        start_queued(&mut state, related, now)?;
    } else {
        state.completed_focus_pending = false;
    }
    encode(state, vec![event])
}

fn check_memo(input: &Value, current: &str) -> Result<(), String> {
    if let Some(expected) = input.get("expectedMemo") {
        if expected.as_str() != Some(current) {
            return Err(
                "메모가 다른 창에서 바뀌었어요. 작성한 내용을 보관하고 최신 메모를 확인해 주세요."
                    .into(),
            );
        }
    }
    Ok(())
}

fn update_memo(state: &mut Timer, input: &Value) -> Result<(), String> {
    if input.get("memo").is_none() {
        return Err("저장할 메모를 입력해 주세요.".into());
    }
    let memo = optional_text(input, "memo", 50000)?;
    let current = if let Some(active) = &state.active_session {
        &active.memo
    } else if state.status == "finished" || state.mode == "rest" {
        state
            .sessions
            .last()
            .map_or(&state.memo, |session| &session.memo)
    } else {
        &state.memo
    };
    check_memo(input, current)?;
    if let Some(active) = state.active_session.as_mut() {
        active.memo = memo.clone();
    } else if state.status == "finished" || state.mode == "rest" {
        if let Some(session) = state.sessions.last_mut() {
            session.memo = memo.clone();
        }
    }
    state.memo = memo;
    Ok(())
}

pub(super) fn act(
    data: &Value,
    action: &str,
    input: &Value,
    related: &BTreeMap<String, Value>,
    now: i64,
) -> Result<WidgetEffect, String> {
    let mut state: Timer = decode(data)?;
    migrate_active(&mut state, now);
    match action {
        "configure" => configure(&mut state, input, related)?,
        "configure-settings" => {
            let mut merged =
                serde_json::to_value(&state.settings).map_err(|error| error.to_string())?;
            let values = input
                .as_object()
                .ok_or("집중 타이머 설정이 올바르지 않습니다.")?;
            merged
                .as_object_mut()
                .ok_or("집중 타이머 설정이 올바르지 않습니다.")?
                .extend(values.clone());
            let settings: Settings = serde_json::from_value(merged)
                .map_err(|_| "집중 타이머 설정이 올바르지 않습니다.")?;
            duration(
                &json!({"durationMs":settings.rest_duration_ms}),
                rest_duration(),
            )?;
            duration(
                &json!({"durationMs":settings.long_rest_duration_ms}),
                long_rest_duration(),
            )?;
            if !(2..=8).contains(&settings.long_rest_every) {
                return Err("긴 휴식 주기는 2회부터 8회까지 설정할 수 있습니다.".into());
            }
            if !matches!(
                settings.finish_notification.as_str(),
                "bubble" | "os" | "both"
            ) || settings
                .linked_event_lead_minutes
                .is_some_and(|minutes| !(0..=120).contains(&minutes))
            {
                return Err("집중 타이머 알림 설정이 올바르지 않습니다.".into());
            }
            state.settings = settings;
        }
        "queue-add" => {
            if state.queue.len() >= 8 {
                return Err("다음 집중은 8개까지 추가할 수 있습니다.".into());
            }
            let title = text(input, "title", 500)?;
            let focus_duration_ms = duration(
                &json!({"durationMs": input.get("focusDurationMs").cloned().unwrap_or(json!(state.focus_duration_ms.unwrap_or(state.duration_ms)))}),
                1500000,
            )?;
            let todo_id = match input.get("todoId") {
                None | Some(Value::Null) => None,
                Some(_) => {
                    let id = text(input, "todoId", 200)?;
                    let todo: TodoState =
                        decode(related.get("todo").ok_or("할 일 위젯을 켜 주세요.")?)?;
                    if !todo
                        .items
                        .iter()
                        .any(|item| item.id == id && item.completed_at.is_none())
                    {
                        return Err("항목을 찾을 수 없습니다.".into());
                    }
                    Some(id)
                }
            };
            let event_ref = match input.get("eventRef") {
                None | Some(Value::Null) => None,
                Some(value) => Some(event_reference(value, related)?),
            };
            let note_ref = match input.get("noteRef") {
                None | Some(Value::Null) => None,
                Some(value) => Some(note_reference(value, related)?),
            };
            state.queue.push(QueueItem {
                id: uuid::Uuid::new_v4().to_string(),
                todo_id,
                title,
                focus_duration_ms,
                event_ref,
                note_ref,
            });
        }
        "queue-remove" => {
            let id = text(input, "id", 200)?;
            let index = state
                .queue
                .iter()
                .position(|item| item.id == id)
                .ok_or("항목을 찾을 수 없습니다.")?;
            state.queue.remove(index);
        }
        "queue-move" => {
            let id = text(input, "id", 200)?;
            let from = state
                .queue
                .iter()
                .position(|item| item.id == id)
                .ok_or("항목을 찾을 수 없습니다.")?;
            let to = if input.get("targetId").is_some() {
                let target = text(input, "targetId", 200)?;
                state
                    .queue
                    .iter()
                    .position(|item| item.id == target)
                    .ok_or("항목을 찾을 수 없습니다.")?
            } else {
                match input["direction"].as_str() {
                    Some("up") => from.saturating_sub(1),
                    Some("down") => (from + 1).min(state.queue.len() - 1),
                    _ => return Err("이동할 방향을 선택해 주세요.".into()),
                }
            };
            let item = state.queue.remove(from);
            state.queue.insert(to, item);
        }
        "queue-clear" => state.queue.clear(),
        "reset-cycle" => state.cycle = 0,
        "update-memo" => update_memo(&mut state, input)?,
        "update-session-memo" => {
            let id = text(input, "id", 200)?;
            if input.get("memo").is_none() {
                return Err("저장할 메모를 입력해 주세요.".into());
            }
            let memo = optional_text(input, "memo", 50000)?;
            let session = state
                .sessions
                .iter_mut()
                .find(|session| session.id == id)
                .ok_or("집중 기록을 찾을 수 없습니다.")?;
            check_memo(input, &session.memo)?;
            session.memo = memo.clone();
            if (state.status == "finished" || state.mode == "rest")
                && state.sessions.last().is_some_and(|last| last.id == id)
            {
                state.memo = memo;
            }
        }
        "show-rest" => {
            if state.mode != "rest" || !state.completed_focus_pending {
                return Err("진행 중인 자동 휴식이 없습니다.".into());
            }
            if input.get("memo").is_some() {
                update_memo(&mut state, input)?;
            }
            state.completed_focus_pending = false;
        }
        "start" | "rest" | "continue" => {
            if action == "start" && matches!(state.status.as_str(), "running" | "paused") {
                return Err("진행 중인 타이머를 먼저 마쳐 주세요.".into());
            }
            let continuing_rest = action == "continue" && state.mode == "rest";
            if action != "start" && state.status != "finished" && !continuing_rest {
                return Err("타이머 종료 후 선택할 수 있습니다.".into());
            }
            if action != "start" && input.get("memo").is_some() {
                update_memo(&mut state, input)?;
            }
            if action == "continue" && !state.queue.is_empty() {
                start_queued(&mut state, related, now)?;
                return encode(state, vec![]);
            }
            let rest_kind = if action == "rest" {
                match input.get("kind").and_then(Value::as_str).unwrap_or("short") {
                    "short" => "short",
                    "long" => "long",
                    _ => return Err("휴식 종류가 올바르지 않습니다.".into()),
                }
            } else {
                "short"
            };
            let fallback = if action == "rest" && rest_kind == "long" {
                state.settings.long_rest_duration_ms
            } else if action == "rest" {
                state.settings.rest_duration_ms
            } else {
                state.focus_duration_ms.unwrap_or(state.duration_ms)
            };
            let value = duration(input, fallback)?;
            if action != "rest" {
                if continuing_rest {
                    state.status = "finished".into();
                }
                let mut configuration = input.clone();
                if action != "start" {
                    if let Some(values) = configuration.as_object_mut() {
                        values.remove("memo");
                        values.remove("expectedMemo");
                    }
                }
                configure(&mut state, &configuration, related)?;
                state.focus_duration_ms = Some(value);
            }
            state.completed_focus_pending = false;
            state.duration_ms = value;
            state.remaining_ms = value;
            state.deadline = Some(now.checked_add(value).ok_or("시각 범위를 벗어났습니다.")?);
            state.status = "running".into();
            state.mode = if action == "rest" { "rest" } else { "focus" }.into();
            state.rest_kind = (action == "rest").then(|| rest_kind.into());
            if action == "rest" && rest_kind == "long" {
                let cycle = state.cycle;
                state.cycle = 0;
                state.active_session = None;
                let bubble_enabled = state.settings.finish_notification != "os";
                return encode(
                    state,
                    vec![EventDraft {
                        kind: "focus-long-rest-started".into(),
                        text: format!("{}번 집중했어요. 길게 쉬어요.", cycle),
                        payload: json!({"cycle":cycle, "bubbleEnabled":bubble_enabled}),
                    }],
                );
            }
            state.active_session = if action == "rest" {
                None
            } else {
                Some(new_session(&state, now, true))
            };
        }
        "pause" => {
            if state.status != "running" {
                return Err("실행 중인 타이머가 없습니다.".into());
            }
            let remaining = state
                .deadline
                .ok_or("종료 시각 오류")?
                .saturating_sub(now)
                .max(0)
                .min(state.remaining_ms);
            if remaining == 0 {
                return finish(state, now, true, related);
            }
            close_segment(&mut state, now);
            state.remaining_ms = remaining;
            state.deadline = None;
            state.status = "paused".into();
        }
        "resume" => {
            if state.status != "paused" {
                return Err("일시정지된 타이머가 없습니다.".into());
            }
            state.deadline = Some(
                now.checked_add(state.remaining_ms)
                    .ok_or("시각 범위 오류")?,
            );
            if let Some(active) = state.active_session.as_mut() {
                active.running_since = Some(
                    active
                        .segments
                        .last()
                        .map_or(now, |last| now.max(last.end_at)),
                );
            }
            state.status = "running".into();
        }
        "cancel" => {
            if input.get("memo").is_some() {
                update_memo(&mut state, input)?;
            }
            let completed =
                state.status == "running" && state.deadline.is_some_and(|end| end <= now);
            // A cancelled focus stays out of the records; only one that already reached its deadline counts.
            if completed {
                save_session(&mut state, now, "completed");
            } else {
                state.active_session = None;
            }
            state.status = "idle".into();
            state.completed_focus_pending = false;
            state.deadline = None;
            state.duration_ms = state.focus_duration_ms.unwrap_or(if state.mode == "rest" {
                1500000
            } else {
                state.duration_ms
            });
            state.mode = "focus".into();
            state.rest_kind = None;
            state.remaining_ms = state.duration_ms;
        }
        _ => return Err("지원하지 않는 타이머 동작입니다.".into()),
    }
    encode(state, vec![])
}

pub(super) fn tick(data: &Value, now: i64) -> Result<Option<WidgetEffect>, String> {
    tick_with_related(data, now, &BTreeMap::new())
}

pub(super) fn tick_with_related(
    data: &Value,
    now: i64,
    related: &BTreeMap<String, Value>,
) -> Result<Option<WidgetEffect>, String> {
    let mut state: Timer = decode(data)?;
    let migrated = migrate_active(&mut state, now);
    if state.status == "running" && state.deadline.is_some_and(|deadline| deadline <= now) {
        return finish(state, now, true, related).map(Some);
    }
    if migrated {
        return encode(state, vec![]).map(Some);
    }
    Ok(None)
}

pub(super) fn suspend(data: &Value, now: i64, restarting: bool) -> Result<Value, String> {
    let mut state: Timer = decode(data)?;
    migrate_active(&mut state, now);
    if state.status != "running" {
        return serde_json::to_value(state).map_err(|error| error.to_string());
    }
    let remaining = state
        .deadline
        .ok_or("종료 시각 오류")?
        .saturating_sub(now)
        .max(0)
        .min(state.remaining_ms);
    if remaining == 0 {
        return finish(state, now, false, &BTreeMap::new()).map(|effect| effect.data);
    }
    state.remaining_ms = remaining;
    if !restarting {
        close_segment(&mut state, now);
        state.status = "paused".into();
        state.deadline = None;
    }
    serde_json::to_value(state).map_err(|error| error.to_string())
}
