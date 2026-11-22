use super::{lock, AppState};
use crate::routines::store::{self, BuiltinSource, ReceiptState, Repeat, Routine, Source};
use chrono::{Datelike, NaiveDate, NaiveTime};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::sync::{atomic::Ordering, Arc};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum RoutineRepeat {
    Daily,
    Weekdays(Vec<u32>),
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum RoutineSource {
    Schedule,
    Tasks,
    Weather,
    External {
        #[serde(rename = "serverId")]
        server_id: String,
        #[serde(rename = "toolName")]
        tool_name: String,
        input: serde_json::Value,
    },
}

impl From<RoutineRepeat> for Repeat {
    fn from(value: RoutineRepeat) -> Self {
        match value {
            RoutineRepeat::Daily => Self::Daily,
            RoutineRepeat::Weekdays(days) => Self::Weekdays(days),
        }
    }
}
impl From<Repeat> for RoutineRepeat {
    fn from(value: Repeat) -> Self {
        match value {
            Repeat::Daily => Self::Daily,
            Repeat::Weekdays(days) => Self::Weekdays(days),
        }
    }
}
impl From<RoutineSource> for Source {
    fn from(value: RoutineSource) -> Self {
        match value {
            RoutineSource::Schedule => Self::Builtin(BuiltinSource::Schedule),
            RoutineSource::Tasks => Self::Builtin(BuiltinSource::Tasks),
            RoutineSource::Weather => Self::Builtin(BuiltinSource::Weather),
            RoutineSource::External {
                server_id,
                tool_name,
                input,
            } => Self::External {
                server_id,
                tool_name,
                input,
            },
        }
    }
}
impl From<Source> for RoutineSource {
    fn from(value: Source) -> Self {
        match value {
            Source::Builtin(BuiltinSource::Schedule) => Self::Schedule,
            Source::Builtin(BuiltinSource::Tasks) => Self::Tasks,
            Source::Builtin(BuiltinSource::Weather) => Self::Weather,
            Source::External {
                server_id,
                tool_name,
                input,
            } => Self::External {
                server_id,
                tool_name,
                input,
            },
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RoutineInput {
    id: Option<String>,
    name: String,
    time: String,
    repeat: RoutineRepeat,
    sources: Vec<RoutineSource>,
    enabled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RoutineItem {
    id: String,
    name: String,
    time: String,
    repeat: RoutineRepeat,
    sources: Vec<RoutineSource>,
    enabled: bool,
    created_at: i64,
    last_occurrence: Option<LastOccurrence>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LastOccurrence {
    scheduled_date: String,
    state: &'static str,
    reason: Option<String>,
}

fn routine_item(db: &Connection, routine: Routine) -> Result<RoutineItem, String> {
    let last_occurrence = store::latest_receipt(db, &routine.id)?.map(|receipt| LastOccurrence {
        scheduled_date: receipt.scheduled_date.to_string(),
        state: match receipt.state {
            ReceiptState::Claimed => "claimed",
            ReceiptState::Read => "read",
            ReceiptState::Summarized => "summarized",
            ReceiptState::Delivered => "delivered",
            ReceiptState::Reported => "reported",
            ReceiptState::Missed => "missed",
            ReceiptState::Interrupted => "interrupted",
            ReceiptState::Failed => "failed",
        },
        reason: receipt.reason,
    });
    Ok(RoutineItem {
        id: routine.id,
        name: routine.name,
        time: routine.time,
        repeat: routine.repeat.into(),
        sources: routine.sources.into_iter().map(Into::into).collect(),
        enabled: routine.enabled,
        created_at: routine.created_at,
        last_occurrence,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SavedRoutine {
    routine: RoutineItem,
    warning: Option<&'static str>,
}

fn quiet_warning(db: &Connection, routine: &Routine) -> Result<Option<&'static str>, String> {
    let quiet = crate::store::settings(db)?.quiet_hours;
    let time = NaiveTime::parse_from_str(&routine.time, "%H:%M")
        .map_err(|_| "시각을 HH:MM 형식으로 입력해 주세요.")?;
    let monday = NaiveDate::from_ymd_opt(2026, 11, 16).expect("valid date");
    let overlaps = (0..7).any(|day| {
        let date = monday + chrono::Duration::days(day);
        let repeats = match &routine.repeat {
            Repeat::Daily => true,
            Repeat::Weekdays(days) => days.contains(&date.weekday().number_from_monday()),
        };
        repeats && super::quiet_hours::active_at(&quiet, date.and_time(time))
    });
    Ok(overlaps.then_some("조용한 시간에는 말풍선 없이 보고함으로만 보내요."))
}

fn save(db: &Connection, input: RoutineInput, now: i64) -> Result<SavedRoutine, String> {
    let existing = match input.id.as_deref() {
        Some(id) => Some(
            store::list(db)?
                .into_iter()
                .find(|item| item.id == id)
                .ok_or("루틴을 찾을 수 없어요.")?,
        ),
        None => None,
    };
    let routine = Routine {
        id: existing
            .as_ref()
            .map(|r| r.id.clone())
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
        name: input.name,
        time: input.time,
        repeat: input.repeat.into(),
        sources: input.sources.into_iter().map(Into::into).collect(),
        enabled: input.enabled,
        created_at: existing.map_or(now, |r| r.created_at),
    };
    let warning = quiet_warning(db, &routine)?;
    store::save(db, &routine)?;
    Ok(SavedRoutine {
        warning,
        routine: routine_item(db, routine)?,
    })
}

#[tauri::command]
pub(crate) fn list_routines(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Vec<RoutineItem>, String> {
    let db = lock(&state.db)?;
    store::list(&db)?
        .into_iter()
        .map(|routine| routine_item(&db, routine))
        .collect()
}

#[tauri::command]
pub(crate) fn save_routine(
    state: tauri::State<'_, Arc<AppState>>,
    routine: RoutineInput,
) -> Result<SavedRoutine, String> {
    let _action = lock(&state.action)?;
    if super::unavailable(&state) {
        return Err("앱을 정리하고 있어요.".into());
    }
    save(
        &*lock(&state.db)?,
        routine,
        chrono::Utc::now().timestamp_millis(),
    )
}

#[tauri::command]
pub(crate) fn delete_routine(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), String> {
    delete_with_notification(&state, &id, Some(&app))?;
    super::publish(&app, &state);
    Ok(())
}

#[cfg(test)]
fn delete(state: &AppState, id: &str) -> Result<(), String> {
    delete_with_notification(state, id, None)
}

fn delete_with_notification(
    state: &AppState,
    id: &str,
    app: Option<&tauri::AppHandle>,
) -> Result<(), String> {
    let _action = lock(&state.action)?;
    if super::unavailable(state) {
        return Err("앱을 정리하고 있어요.".into());
    }
    let playing = {
        let mut playback = lock(&state.routine_playback)?;
        if playback
            .as_ref()
            .is_some_and(|(routine, _, _, _, _)| routine.id == id)
        {
            let current = playback
                .as_ref()
                .is_some_and(|(_, _, _, _, epoch)| *epoch == state.epoch.load(Ordering::SeqCst));
            *playback = None;
            current
        } else {
            false
        }
    };
    if playing {
        super::interrupt(state, false)?;
        let mut runtime = lock(&state.runtime)?;
        runtime.phase = crate::types::RuntimePhase::Idle;
        runtime.persona = None;
        runtime.error = None;
        state.nlp.pause_indexing(false);
    }
    let db = lock(&state.db)?;
    if !store::list(&db)?.iter().any(|routine| routine.id == id) {
        return Err("루틴을 찾을 수 없어요.".into());
    }
    let before = app.and_then(|_| super::routine::notification_snapshot(&db).ok());
    store::delete(&db, id)?;
    if let Some(app) = app {
        super::routine::notify_changed(app, &db, &before);
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn set_routine_enabled(
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
    enabled: bool,
) -> Result<RoutineItem, String> {
    let _action = lock(&state.action)?;
    if super::unavailable(&state) {
        return Err("앱을 정리하고 있어요.".into());
    }
    set_enabled(&*lock(&state.db)?, &id, enabled)
}

fn set_enabled(db: &Connection, id: &str, enabled: bool) -> Result<RoutineItem, String> {
    let mut routine = store::list(db)?
        .into_iter()
        .find(|item| item.id == id)
        .ok_or("루틴을 찾을 수 없어요.")?;
    routine.enabled = enabled;
    store::save(db, &routine)?;
    routine_item(db, routine)
}

#[tauri::command]
pub(crate) fn get_routine_bubble_enabled(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<bool, String> {
    store::bubble_enabled(&*lock(&state.db)?)
}

#[tauri::command]
pub(crate) fn set_routine_bubble_enabled(
    state: tauri::State<'_, Arc<AppState>>,
    enabled: bool,
) -> Result<bool, String> {
    let _action = lock(&state.action)?;
    if super::unavailable(&state) {
        return Err("앱을 정리하고 있어요.".into());
    }
    store::set_bubble_enabled(&*lock(&state.db)?, enabled)?;
    Ok(enabled)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReportItem {
    id: String,
    routine_id: String,
    routine_name: String,
    scheduled_date: String,
    body: String,
    bubble: String,
    delivery: String,
    reason: Option<String>,
    is_read: bool,
    created_at: i64,
}
impl From<store::Report> for ReportItem {
    fn from(report: store::Report) -> Self {
        Self {
            id: report.id,
            routine_id: report.routine_id,
            routine_name: report.routine_name,
            scheduled_date: report.scheduled_date.to_string(),
            body: report.body,
            bubble: report.bubble,
            delivery: report.delivery,
            reason: report.reason,
            is_read: report.is_read,
            created_at: report.created_at,
        }
    }
}

fn current_reports(db: &Connection) -> Result<Vec<store::Report>, String> {
    let user = crate::store::current_user(db)?.ok_or("먼저 이름을 등록해 주세요.")?;
    store::reports(db, &user.id)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReportPage {
    items: Vec<ReportItem>,
    total: usize,
    offset: usize,
    next_offset: Option<usize>,
}
fn report_page(db: &Connection, offset: usize, limit: usize) -> Result<ReportPage, String> {
    if !(1..=50).contains(&limit) {
        return Err("한 번에 보고를 1~50개까지 불러올 수 있어요.".into());
    }
    let reports = current_reports(db)?;
    let total = reports.len();
    let offset = offset.min(total);
    let items: Vec<_> = reports
        .into_iter()
        .skip(offset)
        .take(limit)
        .map(Into::into)
        .collect();
    let end = offset + items.len();
    Ok(ReportPage {
        items,
        total,
        offset,
        next_offset: (end < total).then_some(end),
    })
}
#[tauri::command]
pub(crate) fn list_routine_reports(
    state: tauri::State<'_, Arc<AppState>>,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<ReportPage, String> {
    report_page(&*lock(&state.db)?, offset.unwrap_or(0), limit.unwrap_or(50))
}
fn report(db: &Connection, id: &str) -> Result<ReportItem, String> {
    current_reports(db)?
        .into_iter()
        .find(|report| report.id == id)
        .map(Into::into)
        .ok_or_else(|| "보고를 찾을 수 없어요.".into())
}
#[tauri::command]
pub(crate) fn get_routine_report(
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
) -> Result<ReportItem, String> {
    report(&*lock(&state.db)?, &id)
}
fn mark_read(db: &Connection, id: &str) -> Result<(), String> {
    let user = crate::store::current_user(db)?.ok_or("먼저 이름을 등록해 주세요.")?;
    if !store::mark_report_read(db, &user.id, id)? {
        return Err("보고를 찾을 수 없어요.".into());
    }
    Ok(())
}
#[tauri::command]
pub(crate) fn mark_routine_report_read(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), String> {
    let _action = lock(&state.action)?;
    if super::unavailable(&state) {
        return Err("앱을 정리하고 있어요.".into());
    }
    let db = lock(&state.db)?;
    let before = super::routine::notification_snapshot(&db).ok();
    mark_read(&db, &id)?;
    super::routine::notify_changed(&app, &db, &before);
    Ok(())
}

fn delete_report(db: &Connection, id: &str) -> Result<(), String> {
    let user = crate::store::current_user(db)?.ok_or("먼저 이름을 등록해 주세요.")?;
    if !store::delete_report(db, &user.id, id)? {
        return Err("보고를 찾을 수 없어요.".into());
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn delete_routine_report(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), String> {
    let _action = lock(&state.action)?;
    if super::unavailable(&state) {
        return Err("앱을 정리하고 있어요.".into());
    }
    let db = lock(&state.db)?;
    let before = super::routine::notification_snapshot(&db).ok();
    delete_report(&db, &id)?;
    super::routine::notify_changed(&app, &db, &before);
    Ok(())
}

fn clear_reports(db: &Connection) -> Result<(), String> {
    let user = crate::store::current_user(db)?.ok_or("먼저 이름을 등록해 주세요.")?;
    store::clear_reports(db, &user.id)?;
    Ok(())
}

#[tauri::command]
pub(crate) fn clear_routine_reports(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let _action = lock(&state.action)?;
    if super::unavailable(&state) {
        return Err("앱을 정리하고 있어요.".into());
    }
    let db = lock(&state.db)?;
    let before = super::routine::notification_snapshot(&db).ok();
    clear_reports(&db)?;
    super::routine::notify_changed(&app, &db, &before);
    Ok(())
}
#[tauri::command]
pub(crate) fn get_unread_routine_report_count(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<usize, String> {
    unread_count(&*lock(&state.db)?)
}

fn unread_count(db: &Connection) -> Result<usize, String> {
    Ok(current_reports(db)?
        .iter()
        .filter(|report| !report.is_read)
        .count())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Connection {
        crate::store::open(std::path::Path::new(":memory:")).unwrap()
    }

    fn input() -> RoutineInput {
        RoutineInput {
            id: None,
            name: "아침".into(),
            time: "08:30".into(),
            repeat: RoutineRepeat::Daily,
            sources: vec![RoutineSource::Schedule],
            enabled: true,
        }
    }

    #[test]
    fn saving_validates_preserves_creation_and_warns_for_matching_quiet_hours() {
        let db = db();
        let mut settings = crate::store::settings(&db).unwrap();
        settings.quiet_hours = crate::types::QuietHours {
            enabled: true,
            start: "23:00".into(),
            end: "09:00".into(),
            weekdays: vec![0],
        };
        crate::store::save_settings(&db, &settings).unwrap();
        let mut created_input = input();
        created_input.repeat = RoutineRepeat::Weekdays(vec![2]);
        let created = save(&db, created_input, 100).unwrap();
        assert!(created.warning.is_some());
        let day = NaiveDate::from_ymd_opt(2026, 11, 17).unwrap();
        store::mark_missed(&db, &created.routine.id, day, 150, "예정 시각이 지났어요").unwrap();
        let disabled = set_enabled(&db, &created.routine.id, false).unwrap();
        assert!(!disabled.enabled);
        let last = disabled.last_occurrence.unwrap();
        assert_eq!(last.state, "missed");
        assert_eq!(last.reason.as_deref(), Some("예정 시각이 지났어요"));
        assert!(set_enabled(&db, "missing", true).is_err());
        assert!(store::bubble_enabled(&db).unwrap());
        store::set_bubble_enabled(&db, false).unwrap();
        assert!(!store::bubble_enabled(&db).unwrap());
        let before = store::revision(&db).unwrap();
        let mut edited_input = input();
        edited_input.id = Some(created.routine.id.clone());
        edited_input.name = "저녁".into();
        edited_input.repeat = RoutineRepeat::Weekdays(vec![3]);
        let edited = save(&db, edited_input, 200).unwrap();
        assert_eq!(edited.routine.created_at, 100);
        assert_eq!(store::revision(&db).unwrap(), before + 1);
        assert!(edited.warning.is_none());
        let mut invalid = input();
        invalid.time = "8:30".into();
        assert!(save(&db, invalid, 300).is_err());
        let mut invalid = input();
        invalid.repeat = RoutineRepeat::Weekdays(vec![0]);
        assert!(save(&db, invalid, 300).is_err());
        let mut invalid = input();
        invalid.sources = vec![RoutineSource::Schedule; 6];
        assert!(save(&db, invalid, 300).is_err());
        let mut missing = input();
        missing.id = Some("없는 루틴".into());
        assert!(save(&db, missing, 300).is_err());
        for n in 1..20 {
            save(&db, input(), 300 + n).unwrap();
        }
        assert!(save(&db, input(), 400).is_err());
    }

    #[test]
    fn reports_are_paginated_and_owned_by_the_current_user() {
        let db = db();
        crate::store::set_user_name(&db, "첫 사용자", 1).unwrap();
        let first_user = crate::store::current_user(&db).unwrap().unwrap().id;
        let make = |id: &str, user_id: &str, created_at| store::Report {
            id: id.into(),
            user_id: user_id.into(),
            routine_id: id.into(),
            routine_name: "아침".into(),
            scheduled_date: NaiveDate::from_ymd_opt(2026, 11, 21).unwrap(),
            body: "보고 본문".into(),
            bubble: "말풍선".into(),
            delivery: "reported".into(),
            reason: None,
            is_read: false,
            created_at,
        };
        store::save_report(&db, &make("one", &first_user, 10)).unwrap();
        store::save_report(&db, &make("two", &first_user, 20)).unwrap();
        assert_eq!(unread_count(&db).unwrap(), 2);
        let page = report_page(&db, 0, 1).unwrap();
        assert_eq!(page.total, 2);
        assert_eq!(page.items[0].id, "two");
        assert_eq!(page.next_offset, Some(1));
        assert_eq!(report_page(&db, 1, 1).unwrap().items[0].id, "one");
        assert!(report_page(&db, 0, 0).is_err());
        assert!(report_page(&db, 0, 51).is_err());
        mark_read(&db, "one").unwrap();
        assert_eq!(unread_count(&db).unwrap(), 1);
        assert!(report(&db, "one").unwrap().is_read);
        crate::store::set_user_name(&db, "둘째 사용자", 30).unwrap();
        let second_user = crate::store::current_user(&db).unwrap().unwrap().id;
        assert_ne!(first_user, second_user);
        assert_eq!(report_page(&db, 0, 50).unwrap().total, 0);
        assert_eq!(unread_count(&db).unwrap(), 0);
        assert!(report(&db, "two").is_err());
        assert!(mark_read(&db, "two").is_err());
        assert!(
            !store::reports(&db, &first_user)
                .unwrap()
                .into_iter()
                .find(|r| r.id == "two")
                .unwrap()
                .is_read
        );
    }

    #[test]
    fn report_deletion_respects_owner_and_open_occurrences() {
        let db = db();
        crate::store::set_user_name(&db, "첫 사용자", 1).unwrap();
        let first = crate::store::current_user(&db).unwrap().unwrap().id;
        let day = NaiveDate::from_ymd_opt(2026, 11, 21).unwrap();
        let routine = Routine {
            id: "open".into(),
            name: "아침".into(),
            time: "08:30".into(),
            repeat: Repeat::Daily,
            sources: vec![],
            enabled: true,
            created_at: 1,
        };
        store::save(&db, &routine).unwrap();
        store::claim(&db, &routine.id, day, 2).unwrap();
        store::transition(
            &db,
            &routine.id,
            day,
            ReceiptState::Claimed,
            ReceiptState::Read,
            3,
            None,
        )
        .unwrap();
        let mut open = store::Report {
            id: "open-report".into(),
            user_id: first.clone(),
            routine_id: routine.id.clone(),
            routine_name: routine.name.clone(),
            scheduled_date: day,
            body: "본문".into(),
            bubble: "말풍선".into(),
            delivery: "summarized".into(),
            reason: None,
            is_read: false,
            created_at: 4,
        };
        store::save_report_and_summarize(&db, &open, 4).unwrap();
        let mut closed = open.clone();
        closed.id = "closed".into();
        closed.routine_id = "closed-routine".into();
        closed.delivery = "reported".into();
        store::save_report(&db, &closed).unwrap();
        assert!(delete_report(&db, "open-report")
            .unwrap_err()
            .contains("삭제할 수 없어요"));

        crate::store::set_user_name(&db, "둘째 사용자", 5).unwrap();
        let second = crate::store::current_user(&db).unwrap().unwrap().id;
        assert_ne!(first, second);
        assert!(delete_report(&db, "closed").is_err());
        clear_reports(&db).unwrap();
        assert_eq!(store::reports(&db, &first).unwrap().len(), 2);
        open.id = "second".into();
        open.user_id = second.clone();
        open.routine_id = "second-routine".into();
        open.delivery = "reported".into();
        store::save_report(&db, &open).unwrap();
        delete_report(&db, "second").unwrap();
        assert!(store::reports(&db, &second).unwrap().is_empty());

        assert_eq!(store::clear_reports(&db, &first).unwrap(), 1);
        assert_eq!(store::reports(&db, &first).unwrap().len(), 1);
        store::finish_report(
            &db,
            &first,
            &routine.id,
            day,
            ReceiptState::Reported,
            6,
            None,
        )
        .unwrap();
        assert!(store::delete_report(&db, &first, "open-report").unwrap());
        assert!(store::reports(&db, &first).unwrap().is_empty());
    }

    #[test]
    fn input_uses_camel_case_and_rejects_invalid_types() {
        let parsed: RoutineInput = serde_json::from_value(serde_json::json!({
            "name": "아침", "time": "08:30", "repeat": "daily",
            "sources": [{"external": {"serverId": "server", "toolName": "tool", "input": {}}}],
            "enabled": true
        }))
        .unwrap();
        assert!(
            matches!(&parsed.sources[0], RoutineSource::External { server_id, tool_name, .. } if server_id == "server" && tool_name == "tool")
        );
        assert!(serde_json::from_value::<RoutineInput>(serde_json::json!({
            "name": "아침", "time": 830, "repeat": "daily", "sources": [], "enabled": true
        }))
        .is_err());
    }

    #[test]
    fn deletion_cancels_playback_and_keeps_the_report() {
        use std::sync::atomic::{AtomicBool, Ordering};

        let state = super::super::tests::state();
        let day = NaiveDate::from_ymd_opt(2026, 11, 21).unwrap();
        let routine = Routine {
            id: "routine".into(),
            name: "아침".into(),
            time: "08:30".into(),
            repeat: Repeat::Daily,
            sources: vec![],
            enabled: true,
            created_at: 1,
        };
        {
            let db = lock(&state.db).unwrap();
            store::save(&db, &routine).unwrap();
            store::claim(&db, &routine.id, day, 2).unwrap();
            store::transition(
                &db,
                &routine.id,
                day,
                ReceiptState::Claimed,
                ReceiptState::Read,
                3,
                None,
            )
            .unwrap();
            store::save_report_and_summarize(
                &db,
                &store::Report {
                    id: "report".into(),
                    user_id: "user".into(),
                    routine_id: routine.id.clone(),
                    routine_name: routine.name.clone(),
                    scheduled_date: day,
                    body: "본문".into(),
                    bubble: "말풍선".into(),
                    delivery: "summarized".into(),
                    reason: None,
                    is_read: false,
                    created_at: 4,
                },
                4,
            )
            .unwrap();
        }
        let cancel = Arc::new(AtomicBool::new(false));
        *lock(&state.cancellation).unwrap() = Some(cancel.clone());
        *lock(&state.routine_playback).unwrap() = Some((routine, "user".into(), day, 0, 0));
        lock(&state.runtime).unwrap().phase = crate::types::RuntimePhase::Playing;
        delete(&state, "routine").unwrap();
        assert!(cancel.load(Ordering::SeqCst));
        assert!(lock(&state.routine_playback).unwrap().is_none());
        assert_eq!(
            lock(&state.runtime).unwrap().phase,
            crate::types::RuntimePhase::Idle
        );
        let db = lock(&state.db).unwrap();
        assert!(store::list(&db).unwrap().is_empty());
        assert!(!store::receipt_exists(&db, "routine", day).unwrap());
        let reports = store::reports(&db, "user").unwrap();
        assert_eq!(reports.len(), 1);
        assert_eq!(reports[0].delivery, "reported");
        assert_eq!(reports[0].routine_name, "아침");
        let output = serde_json::to_value(ReportItem::from(reports[0].clone())).unwrap();
        assert_eq!(output["routineName"], "아침");
        drop(db);
        assert!(delete(&state, "missing").is_err());
    }

    #[test]
    fn deletion_does_not_interrupt_a_newer_operation() {
        use std::sync::atomic::AtomicBool;

        let state = super::super::tests::state();
        let routine = Routine {
            id: "routine".into(),
            name: "아침".into(),
            time: "08:30".into(),
            repeat: Repeat::Daily,
            sources: vec![],
            enabled: true,
            created_at: 1,
        };
        store::save(&lock(&state.db).unwrap(), &routine).unwrap();
        let cancel = Arc::new(AtomicBool::new(false));
        *lock(&state.cancellation).unwrap() = Some(cancel.clone());
        *lock(&state.routine_playback).unwrap() = Some((
            routine,
            "user".into(),
            NaiveDate::from_ymd_opt(2026, 11, 21).unwrap(),
            0,
            1,
        ));
        state.epoch.store(2, Ordering::SeqCst);
        lock(&state.runtime).unwrap().phase = crate::types::RuntimePhase::Generating;

        delete(&state, "routine").unwrap();

        assert!(!cancel.load(Ordering::SeqCst));
        assert_eq!(state.epoch.load(Ordering::SeqCst), 2);
        assert_eq!(
            lock(&state.runtime).unwrap().phase,
            crate::types::RuntimePhase::Generating
        );
        assert!(lock(&state.routine_playback).unwrap().is_none());
    }
}
