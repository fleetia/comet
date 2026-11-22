use super::{is_current, lock, phase, presence, tasks, AppState};
use crate::{
    characters,
    routines::{
        briefing,
        driver::{self, Claimed, Driver},
        policy::{self, Decision, SpeakConditions},
        store::{self, ReceiptState, Report},
    },
    types::{RuntimePhase, SceneLine},
    widgets,
};
use chrono::Utc;
use rusqlite::Connection;
use std::collections::BTreeMap;
use std::sync::{atomic::Ordering, Arc};
use tauri::Emitter;
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender};

#[derive(PartialEq, Eq)]
pub(crate) struct NotificationSnapshot {
    reports: BTreeMap<String, String>,
    unread_count: usize,
    latest: BTreeMap<String, (chrono::NaiveDate, ReceiptState, Option<String>)>,
}

pub(crate) fn notification_snapshot(db: &Connection) -> Result<NotificationSnapshot, String> {
    let user = crate::store::current_user(db)?;
    let mut reports = BTreeMap::new();
    let mut unread_count = 0;
    if let Some(user) = user {
        let mut query = db
            .prepare("SELECT id,delivery,is_read FROM routine_reports WHERE user_id=?1")
            .map_err(|error| error.to_string())?;
        let rows = query
            .query_map([user.id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, bool>(2)?,
                ))
            })
            .map_err(|error| error.to_string())?;
        for row in rows {
            let (id, delivery, is_read) = row.map_err(|error| error.to_string())?;
            reports.insert(id, delivery);
            unread_count += usize::from(!is_read);
        }
    }
    let mut latest = BTreeMap::new();
    for routine in store::list(db)? {
        if let Some(receipt) = store::latest_receipt(db, &routine.id)? {
            latest.insert(
                routine.id,
                (receipt.scheduled_date, receipt.state, receipt.reason),
            );
        }
    }
    Ok(NotificationSnapshot {
        reports,
        unread_count,
        latest,
    })
}

impl NotificationSnapshot {
    fn changed_from(&self, before: &Self) -> bool {
        self.unread_count != before.unread_count
            || self
                .reports
                .iter()
                .any(|(id, delivery)| before.reports.get(id) != Some(delivery))
            || self
                .latest
                .iter()
                .any(|(id, receipt)| before.latest.get(id) != Some(receipt))
    }
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RoutineChanged {
    unread_count: usize,
}

pub(crate) fn notify_changed(
    app: &tauri::AppHandle,
    db: &Connection,
    before: &Option<NotificationSnapshot>,
) {
    if let (Some(before), Ok(after)) = (before, notification_snapshot(db)) {
        if after.changed_from(before) {
            let _ = app.emit(
                "routine-changed",
                RoutineChanged {
                    unread_count: after.unread_count,
                },
            );
        }
    }
}

struct ChangeNotification<'a> {
    app: &'a tauri::AppHandle,
    state: &'a AppState,
    before: Option<NotificationSnapshot>,
}

impl<'a> ChangeNotification<'a> {
    fn new(app: &'a tauri::AppHandle, state: &'a AppState) -> Self {
        Self {
            app,
            state,
            before: None,
        }
    }

    fn capture(&mut self, db: &Connection) {
        if self.before.is_none() {
            self.before = notification_snapshot(db).ok();
        }
    }
}

impl Drop for ChangeNotification<'_> {
    fn drop(&mut self) {
        if self.before.is_some() {
            if let Ok(db) = lock(&self.state.db) {
                notify_changed(self.app, &db, &self.before);
            }
        }
    }
}

struct Pending {
    claimed: Claimed,
    user_id: String,
    bubble: String,
    retry: bool,
    ready_since: Option<i64>,
    reset_generation: u64,
}

struct Finished {
    pending: Pending,
    input: bool,
    delivered: bool,
    failed: bool,
}

struct PlaybackGuard {
    pending: Option<Pending>,
    tx: UnboundedSender<Finished>,
}

impl Drop for PlaybackGuard {
    fn drop(&mut self) {
        if let Some(pending) = self.pending.take() {
            let _ = self.tx.send(Finished {
                pending,
                input: false,
                delivered: false,
                failed: true,
            });
        }
    }
}

pub(super) struct Runtime {
    driver: Option<Driver>,
    timezone: driver::Timezone,
    pending: Vec<Pending>,
    tx: UnboundedSender<Finished>,
    rx: UnboundedReceiver<Finished>,
    playing: bool,
    reset_generation: u64,
}

impl Runtime {
    pub(super) fn new() -> Self {
        let (tx, rx) = unbounded_channel();
        Self {
            driver: None,
            timezone: driver::Timezone::default(),
            pending: Vec::new(),
            tx,
            rx,
            playing: false,
            reset_generation: 0,
        }
    }

    #[cfg(test)]
    pub(super) fn observe(&mut self, state: &AppState) -> Result<(), String> {
        self.observe_inner(state, None)
    }

    pub(super) fn observe_with_notifications(
        &mut self,
        app: &tauri::AppHandle,
        state: &AppState,
    ) -> Result<(), String> {
        self.observe_inner(state, Some(app))
    }

    fn observe_inner(
        &mut self,
        state: &AppState,
        app: Option<&tauri::AppHandle>,
    ) -> Result<(), String> {
        let _action = lock(&state.action)?;
        let mut notification = app.map(|app| ChangeNotification::new(app, state));
        let reset_generation = state.routine_reset_generation.load(Ordering::SeqCst);
        if self.reset_generation != reset_generation {
            self.pending.clear();
            self.driver = None;
            self.reset_generation = reset_generation;
        }
        if super::unavailable(state) {
            self.pending.clear();
            self.driver = None;
            return Ok(());
        }
        while let Ok(result) = self.rx.try_recv() {
            self.playing = false;
            if result.pending.reset_generation != reset_generation {
                continue;
            }
            if result.input && result.delivered && !result.pending.retry {
                self.pending.push(Pending {
                    retry: true,
                    ready_since: None,
                    ..result.pending
                });
            } else if !result.delivered {
                let db = lock(&state.db)?;
                if let Some(notification) = notification.as_mut() {
                    notification.capture(&db);
                }
                if result.failed {
                    let _ = store::finish_failed_playback(
                        &db,
                        &result.pending.user_id,
                        &result.pending.claimed.routine.id,
                        result.pending.claimed.occurrence.scheduled_date,
                        Utc::now().timestamp_millis(),
                    );
                } else {
                    let _ = finish(&db, &result.pending, "말풍선을 전하지 못했어요.");
                }
            }
        }
        let now = Utc::now();
        let Some(timezone) = self.timezone.get()? else {
            return Ok(());
        };
        let db = lock(&state.db)?;
        if self.driver.is_none() {
            if let Some(notification) = notification.as_mut() {
                notification.capture(&db);
            }
            self.driver = Some(Driver::new(&db, now, timezone)?);
        }
        let Some(driver) = self.driver.as_mut() else {
            return Ok(());
        };
        let claimed = driver.tick_with_notification(&db, now, timezone, |db| {
            if let Some(notification) = notification.as_mut() {
                notification.capture(db);
            }
        })?;
        state
            .routine_observed_at
            .store(now.timestamp_millis(), Ordering::SeqCst);
        for claimed in claimed {
            let failure_id = claimed.routine.id.clone();
            let failure_day = claimed.occurrence.scheduled_date;
            let result = (|| -> Result<(), String> {
                let epoch = state.epoch.load(Ordering::SeqCst);
                let Some(user) = crate::store::current_user(&db)? else {
                    let _ = store::transition(
                        &db,
                        &claimed.routine.id,
                        claimed.occurrence.scheduled_date,
                        ReceiptState::Claimed,
                        ReceiptState::Interrupted,
                        now.timestamp_millis(),
                        Some("사용자를 확인할 수 없어요."),
                    );
                    return Ok(());
                };
                let mut snapshot = widgets::storage::snapshot(&db)?;
                snapshot.widgets.retain(|widget| {
                    widgets::storage::installed_and_enabled(&db, &widget.instance.id)
                        .unwrap_or(false)
                });
                let briefing = briefing::build(
                    &claimed.routine.sources,
                    &snapshot,
                    claimed.occurrence.scheduled_date,
                    now.timestamp_millis(),
                );
                if state.epoch.load(Ordering::SeqCst) != epoch
                    || !store::list(&db)?.contains(&claimed.routine)
                {
                    let _ = store::transition(
                        &db,
                        &claimed.routine.id,
                        claimed.occurrence.scheduled_date,
                        ReceiptState::Claimed,
                        ReceiptState::Interrupted,
                        now.timestamp_millis(),
                        Some("루틴이 변경됐어요."),
                    );
                    return Ok(());
                }
                store::transition(
                    &db,
                    &claimed.routine.id,
                    claimed.occurrence.scheduled_date,
                    ReceiptState::Claimed,
                    ReceiptState::Read,
                    now.timestamp_millis(),
                    None,
                )?;
                if briefing.body.is_empty() {
                    let reason = std::iter::once("전할 내용이 없어요.")
                        .chain(briefing.skipped.iter().map(String::as_str))
                        .collect::<Vec<_>>()
                        .join(" ");
                    store::transition(
                        &db,
                        &claimed.routine.id,
                        claimed.occurrence.scheduled_date,
                        ReceiptState::Read,
                        ReceiptState::Reported,
                        now.timestamp_millis(),
                        Some(&reason),
                    )?;
                    return Ok(());
                }
                let report = Report {
                    id: uuid::Uuid::new_v4().to_string(),
                    user_id: user.id.clone(),
                    routine_id: claimed.routine.id.clone(),
                    routine_name: claimed.routine.name.clone(),
                    scheduled_date: claimed.occurrence.scheduled_date,
                    body: briefing.body,
                    bubble: briefing.bubble.clone(),
                    delivery: "summarized".into(),
                    reason: (!briefing.skipped.is_empty()).then(|| briefing.skipped.join(" ")),
                    is_read: false,
                    created_at: now.timestamp_millis(),
                };
                store::save_report_and_summarize(&db, &report, now.timestamp_millis())?;
                let pending = Pending {
                    claimed,
                    user_id: user.id,
                    bubble: briefing.bubble,
                    retry: false,
                    ready_since: None,
                    reset_generation,
                };
                if pending.bubble.is_empty() {
                    finish(&db, &pending, "전할 내용이 없어요.")?;
                } else {
                    self.pending.push(pending);
                }
                Ok(())
            })();
            if let Err(error) = result {
                crate::report_error!("routine_read", "루틴을 읽지 못했어요: {error}");
                for from in [ReceiptState::Claimed, ReceiptState::Read] {
                    if store::transition(
                        &db,
                        &failure_id,
                        failure_day,
                        from,
                        ReceiptState::Failed,
                        now.timestamp_millis(),
                        Some("루틴을 읽지 못했어요."),
                    )
                    .is_ok()
                    {
                        break;
                    }
                }
            }
        }
        Ok(())
    }

    pub(super) fn has_pending(&self) -> bool {
        !self.pending.is_empty() && !self.playing
    }

    pub(super) fn deliver(
        &mut self,
        app: &tauri::AppHandle,
        state: &Arc<AppState>,
        fullscreen: bool,
    ) -> Result<bool, String> {
        if !self.has_pending() {
            return Ok(false);
        }
        let now = Utc::now().timestamp_millis();
        let _action = lock(&state.action)?;
        let mut notification = ChangeNotification::new(app, state);
        let db = lock(&state.db)?;
        let status = lock(&state.runtime)?.clone();
        let settings = crate::store::settings(&db)?;
        let active = characters::active_ids(&db)?;
        let present = presence::present_ids(state, &active)?;
        let awake: Vec<_> = present
            .iter()
            .filter(|id| !characters::life::sleeping(state, id).unwrap_or(true))
            .cloned()
            .collect();
        let conditions = SpeakConditions {
            hidden: status.hidden,
            paused: status.paused,
            focused: widgets::storage::focus_active(&db, now)?,
            quiet_hours: super::quiet_hours::active_at(
                &settings.quiet_hours,
                chrono::Local::now().naive_local(),
            ),
            screen_locked: crate::device::wake::screen_blocked(),
            fullscreen,
            no_speaker: present.is_empty(),
            sleeping: !present.is_empty() && awake.is_empty(),
            bubble_disabled: !store::bubble_enabled(&db)?,
            story_or_tutorial: !matches!(status.phase.as_str(), "idle" | "error")
                || lock(&state.pack_stories)?.run.is_some(),
            panel_or_input_open: lock(&state.panel)?.is_some() || super::widget_form_active(state)?,
            quick_launch_open: state.launcher_open.load(Ordering::SeqCst),
            recent_input: now
                .saturating_sub(state.last_input.load(Ordering::SeqCst).saturating_mul(1000))
                < 15_000,
            widget_editing: state.widget_editing.load(Ordering::SeqCst),
        };
        let current_user = crate::store::current_user(&db)?.map(|user| user.id);
        let routines = store::list(&db)?;
        let mut eligible = Vec::new();
        let mut index = 0;
        while index < self.pending.len() {
            let pending = &mut self.pending[index];
            let changed = current_user.as_deref() != Some(pending.user_id.as_str())
                || !routines.contains(&pending.claimed.routine)
                || store::generation(&db, &pending.claimed.routine.id)?
                    != pending.claimed.generation;
            let decision = pending_decision(pending, &conditions, changed, now);
            let decision = if pending.retry {
                match decision {
                    Decision::Report(reason)
                        if conditions.hidden
                            || conditions.paused
                            || conditions.focused
                            || conditions.bubble_disabled
                            || changed =>
                    {
                        Decision::Report(reason)
                    }
                    Decision::Speak => {
                        let ready = *pending.ready_since.get_or_insert(now);
                        policy::retry_decision(
                            true,
                            false,
                            Some(ready),
                            pending.claimed.occurrence.scheduled_at.timestamp_millis(),
                            now,
                        )
                    }
                    _ => {
                        pending.ready_since = None;
                        policy::retry_decision(
                            true,
                            false,
                            None,
                            pending.claimed.occurrence.scheduled_at.timestamp_millis(),
                            now,
                        )
                    }
                }
            } else {
                decision
            };
            match decision {
                Decision::Report(reason) => {
                    let pending = self.pending.remove(index);
                    if !pending.retry {
                        notification.capture(&db);
                        let _ = finish(&db, &pending, reason);
                    }
                }
                Decision::Wait => index += 1,
                Decision::Speak => {
                    eligible.push(index);
                    index += 1;
                }
            }
        }
        let choices: Vec<_> = eligible
            .iter()
            .map(|&i| {
                (
                    self.pending[i]
                        .claimed
                        .occurrence
                        .scheduled_at
                        .timestamp_millis(),
                    self.pending[i].claimed.routine.created_at,
                )
            })
            .collect();
        let Some(chosen) = policy::choose_occurrence(&choices).map(|i| eligible[i]) else {
            return Ok(false);
        };
        for &i in eligible.iter().rev() {
            if i != chosen {
                let pending = self.pending.remove(i);
                if !pending.retry {
                    notification.capture(&db);
                    let _ = finish(&db, &pending, "다른 루틴을 먼저 전했어요.");
                }
            }
        }
        let chosen = chosen - eligible.iter().filter(|&&i| i < chosen).count();
        let pending = &self.pending[chosen];
        let lines = crate::talk::host::prepare_routine(state, &db, &pending.bubble)?
            .unwrap_or_else(|| {
                vec![SceneLine {
                    persona: awake[0].clone(),
                    expression: "평온".into(),
                    text: pending.bubble.clone(),
                    widget: None,
                    motion: Default::default(),
                }]
            });
        let token = tasks::reserve(state, tasks::Kind::Scene, true)?;
        *lock(&state.routine_playback)? = Some((
            pending.claimed.routine.clone(),
            pending.user_id.clone(),
            pending.claimed.occurrence.scheduled_date,
            pending.claimed.generation,
            token.0,
        ));
        let input_before = state.last_input.load(Ordering::SeqCst);
        let pending = self.pending.remove(chosen);
        drop(db);
        drop(notification);
        drop(_action);
        let guard = PlaybackGuard {
            pending: Some(pending),
            tx: self.tx.clone(),
        };
        let app2 = app.clone();
        let state2 = state.clone();
        let epoch = token.0;
        self.playing = true;
        let started = tasks::spawn_checked(
            app.clone(),
            state.clone(),
            tasks::Kind::Scene,
            epoch,
            async move {
                let mut guard = guard;
                if let Some(_gate) = tasks::acquire_gate(&state2, epoch, token.1.clone()).await {
                    let fullscreen = crate::desktop::toys::current_geometry(&app2)
                        .await
                        .map_or(true, |geometry| geometry.fullscreen);
                    if !fullscreen && preplay_allowed(&state2, epoch, &token.1).unwrap_or(false) {
                        let _ = super::scene::run_scene(
                            &app2,
                            &state2,
                            &lines,
                            "routine",
                            &uuid::Uuid::new_v4().to_string(),
                            false,
                            epoch,
                            token.1.clone(),
                        )
                        .await;
                    }
                }
                let input = interrupted_by_input(&state2, input_before, epoch, &token.1);
                let delivered = lock(&state2.db)
                    .ok()
                    .and_then(|db| {
                        store::latest_receipt(
                            &db,
                            &guard.pending.as_ref().unwrap().claimed.routine.id,
                        )
                        .ok()
                        .flatten()
                    })
                    .is_some_and(|receipt| {
                        receipt.scheduled_date
                            == guard
                                .pending
                                .as_ref()
                                .unwrap()
                                .claimed
                                .occurrence
                                .scheduled_date
                            && receipt.state == ReceiptState::Delivered
                    });
                if is_current(&state2, epoch, &token.1) {
                    let _ = lock(&state2.routine_playback).map(|mut value| *value = None);
                    phase(&app2, &state2, epoch, RuntimePhase::Idle, None, None);
                }
                let pending = guard.pending.take().unwrap();
                let _ = guard.tx.send(Finished {
                    pending,
                    input,
                    delivered,
                    failed: false,
                });
            },
        );
        let started = match started {
            Ok(started) => started,
            Err(error) => {
                crate::report_error!("routine_playback", "루틴을 시작하지 못했어요: {error}");
                false
            }
        };
        if !started {
            if state.epoch.load(Ordering::SeqCst) == epoch {
                let _ = lock(&state.routine_playback).map(|mut value| *value = None);
                phase(app, state, epoch, RuntimePhase::Idle, None, None);
            }
            return Ok(false);
        }
        Ok(true)
    }
}

fn pending_decision(
    pending: &Pending,
    conditions: &SpeakConditions,
    changed: bool,
    now: i64,
) -> Decision {
    if changed {
        return Decision::Report("루틴이나 사용자가 변경됐어요.");
    }
    policy::decide(
        conditions,
        if pending.retry {
            now
        } else {
            pending.claimed.occurrence.scheduled_at.timestamp_millis()
        },
        now,
    )
}

fn interrupted_by_input(
    state: &AppState,
    input_before: i64,
    epoch: u64,
    cancel: &std::sync::atomic::AtomicBool,
) -> bool {
    state.last_input.load(Ordering::SeqCst) > input_before
        && !is_current(state, epoch, cancel)
        && lock(&state.runtime).is_ok_and(|status| !status.hidden && !status.paused)
        && lock(&state.db).is_ok_and(|db| {
            !widgets::storage::focus_active(&db, Utc::now().timestamp_millis()).unwrap_or(true)
        })
}

fn preplay_allowed(
    state: &AppState,
    epoch: u64,
    cancel: &std::sync::atomic::AtomicBool,
) -> Result<bool, String> {
    let _action = lock(&state.action)?;
    let db = lock(&state.db)?;
    let status = lock(&state.runtime)?.clone();
    let settings = crate::store::settings(&db)?;
    Ok(is_current(state, epoch, cancel)
        && !status.hidden
        && !status.paused
        && store::bubble_enabled(&db)?
        && !widgets::storage::focus_active(&db, Utc::now().timestamp_millis())?
        && !super::quiet_hours::automatic_blocked(state, &settings)?
        && lock(&state.panel)?.is_none()
        && !state.launcher_open.load(Ordering::SeqCst)
        && !super::widget_form_active(state)?)
}

fn finish(db: &rusqlite::Connection, pending: &Pending, reason: &str) -> Result<(), String> {
    store::finish_report(
        db,
        &pending.user_id,
        &pending.claimed.routine.id,
        pending.claimed.occurrence.scheduled_date,
        ReceiptState::Reported,
        Utc::now().timestamp_millis(),
        Some(reason),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::routines::{
        scheduler::Occurrence,
        store::{Repeat, Routine},
    };
    use std::sync::atomic::AtomicBool;

    #[test]
    fn notifications_follow_current_user_reports_and_latest_occurrence_changes() {
        let db = crate::store::open(std::path::Path::new(":memory:")).unwrap();
        crate::store::set_user_name(&db, "사용자", 1).unwrap();
        let user = crate::store::current_user(&db).unwrap().unwrap().id;
        let day = chrono::NaiveDate::from_ymd_opt(2026, 11, 21).unwrap();
        let routine = Routine {
            id: "r".into(),
            name: "아침".into(),
            time: "09:00".into(),
            repeat: Repeat::Daily,
            sources: vec![],
            enabled: true,
            created_at: 1,
        };
        store::save(&db, &routine).unwrap();
        let initial = notification_snapshot(&db).unwrap();
        assert!(!notification_snapshot(&db).unwrap().changed_from(&initial));

        let report = Report {
            id: "report".into(),
            user_id: "other".into(),
            routine_id: "other".into(),
            routine_name: "다른 루틴".into(),
            scheduled_date: day,
            body: "본문".into(),
            bubble: "말풍선".into(),
            delivery: "reported".into(),
            reason: None,
            is_read: false,
            created_at: 2,
        };
        store::save_report(&db, &report).unwrap();
        assert!(!notification_snapshot(&db).unwrap().changed_from(&initial));
        store::save_report(
            &db,
            &Report {
                id: "mine".into(),
                user_id: user.clone(),
                ..report
            },
        )
        .unwrap();
        let created = notification_snapshot(&db).unwrap();
        assert!(created.changed_from(&initial));
        assert_eq!(created.unread_count, 1);
        db.execute(
            "UPDATE routine_reports SET delivery='delivered' WHERE id='mine'",
            [],
        )
        .unwrap();
        let delivered = notification_snapshot(&db).unwrap();
        assert!(delivered.changed_from(&created));
        store::mark_report_read(&db, &user, "mine").unwrap();
        let read = notification_snapshot(&db).unwrap();
        assert!(read.changed_from(&delivered));
        assert_eq!(read.unread_count, 0);
        store::delete_report(&db, &user, "mine").unwrap();
        let deleted_read = notification_snapshot(&db).unwrap();
        assert!(!deleted_read.changed_from(&read));
        store::mark_missed(&db, "r", day, 3, "예정 시각이 지났어요").unwrap();
        let missed = notification_snapshot(&db).unwrap();
        assert!(missed.changed_from(&deleted_read));
        assert!(!notification_snapshot(&db).unwrap().changed_from(&missed));
        assert_eq!(
            serde_json::to_value(RoutineChanged { unread_count: 1 }).unwrap(),
            serde_json::json!({"unreadCount": 1})
        );
    }

    #[test]
    fn empty_briefing_closes_receipt_without_saving_a_report() {
        use crate::routines::store::{BuiltinSource, Source};

        let state = super::super::tests::state();
        let now = Utc::now();
        let timezone = driver::Timezone::default().get().unwrap().unwrap();
        let scheduled = chrono::DateTime::from_timestamp_millis(
            now.timestamp_millis().div_euclid(60_000) * 60_000,
        )
        .unwrap();
        let previous = scheduled - chrono::Duration::seconds(1);
        let db = lock(&state.db).unwrap();
        crate::store::set_user_name(&db, "사용자", previous.timestamp_millis()).unwrap();
        store::save(
            &db,
            &Routine {
                id: "empty".into(),
                name: "빈 루틴".into(),
                time: scheduled
                    .with_timezone(&timezone)
                    .format("%H:%M")
                    .to_string(),
                repeat: Repeat::Daily,
                sources: vec![
                    Source::Builtin(BuiltinSource::Schedule),
                    Source::External {
                        server_id: "server".into(),
                        tool_name: "tool".into(),
                        input: serde_json::json!({}),
                    },
                ],
                enabled: true,
                created_at: previous.timestamp_millis(),
            },
        )
        .unwrap();
        let mut runtime = Runtime::new();
        runtime.driver = Some(Driver::new(&db, previous, timezone).unwrap());
        drop(db);

        runtime.observe(&state).unwrap();

        let db = lock(&state.db).unwrap();
        let receipt = store::latest_receipt(&db, "empty").unwrap().unwrap();
        assert_eq!(receipt.state, ReceiptState::Reported);
        assert_eq!(
            receipt.reason.as_deref(),
            Some("전할 내용이 없어요. 일정에서 전할 내용이 없거나 읽을 수 없어요. 바깥 재료는 아직 읽을 수 없어요.")
        );
        let reports: i64 = db
            .query_row("SELECT count(*) FROM routine_reports", [], |row| row.get(0))
            .unwrap();
        assert_eq!(reports, 0);
        assert!(!runtime.has_pending());
    }

    fn pending() -> Pending {
        let scheduled_at = chrono::DateTime::from_timestamp_millis(1_000).unwrap();
        Pending {
            claimed: Claimed {
                occurrence: Occurrence {
                    routine_id: "r".into(),
                    scheduled_date: scheduled_at.date_naive(),
                    scheduled_at,
                },
                routine: Routine {
                    id: "r".into(),
                    name: "루틴".into(),
                    time: "00:00".into(),
                    repeat: Repeat::Daily,
                    sources: vec![],
                    enabled: true,
                    created_at: 0,
                },
                generation: 0,
            },
            user_id: "user".into(),
            bubble: "일정이 있어요.".into(),
            retry: false,
            ready_since: None,
            reset_generation: 0,
        }
    }

    #[test]
    fn reset_discards_pending_and_late_playback_completion() {
        let state = super::super::tests::state();
        let mut runtime = Runtime::new();
        runtime.pending.push(pending());
        state.update_installing.store(true, Ordering::SeqCst);
        state
            .routine_reset_generation
            .fetch_add(1, Ordering::SeqCst);
        runtime
            .tx
            .send(Finished {
                pending: pending(),
                input: true,
                delivered: true,
                failed: false,
            })
            .unwrap_or_else(|_| panic!("receiver closed"));
        runtime.observe(&state).unwrap();
        assert!(!runtime.has_pending());
        state.update_installing.store(false, Ordering::SeqCst);
        runtime.observe(&state).unwrap();
        assert!(!runtime.has_pending());
    }

    #[test]
    fn preplay_uses_routine_option_and_epoch_without_autonomous_setting() {
        let state = super::super::tests::state();
        let cancel = AtomicBool::new(false);
        let db = lock(&state.db).unwrap();
        let mut settings = crate::store::settings(&db).unwrap();
        settings.autonomous_enabled = false;
        crate::store::save_settings(&db, &settings).unwrap();
        drop(db);
        assert!(preplay_allowed(&state, 0, &cancel).unwrap());
        store::set_bubble_enabled(&lock(&state.db).unwrap(), false).unwrap();
        assert!(!preplay_allowed(&state, 0, &cancel).unwrap());
        store::set_bubble_enabled(&lock(&state.db).unwrap(), true).unwrap();
        state.epoch.store(1, Ordering::SeqCst);
        assert!(!preplay_allowed(&state, 0, &cancel).unwrap());
        lock(&state.runtime).unwrap().hidden = true;
        assert!(!preplay_allowed(&state, 1, &cancel).unwrap());
    }

    #[test]
    fn opening_and_closing_panel_and_input_preserve_pending_until_ready() {
        let state = super::super::tests::state();
        let mut runtime = Runtime::new();
        runtime.pending.push(pending());
        let original = state.epoch.load(Ordering::SeqCst);
        let character = characters::active_ids(&lock(&state.db).unwrap()).unwrap()[0].clone();
        super::super::windows::begin_panel(&state, &character, "menu".into()).unwrap();
        let blocked = SpeakConditions {
            panel_or_input_open: true,
            ..Default::default()
        };
        assert_eq!(
            pending_decision(&runtime.pending[0], &blocked, false, 2_000),
            Decision::Wait
        );
        {
            let _action = lock(&state.action).unwrap();
            let db = lock(&state.db).unwrap();
            super::super::windows::close_panel_locked(&state, &db, None, false).unwrap();
            super::super::interrupt(&state, false).unwrap();
        }
        assert!(state.epoch.load(Ordering::SeqCst) > original);
        let recent = SpeakConditions {
            recent_input: true,
            ..Default::default()
        };
        assert_eq!(
            pending_decision(&runtime.pending[0], &recent, false, 2_000),
            Decision::Wait
        );
        assert_eq!(
            pending_decision(
                &runtime.pending[0],
                &SpeakConditions::default(),
                false,
                17_000
            ),
            Decision::Speak
        );
        assert!(matches!(
            pending_decision(
                &runtime.pending[0],
                &SpeakConditions::default(),
                true,
                17_000
            ),
            Decision::Report(_)
        ));
        assert!(matches!(
            pending_decision(
                &runtime.pending[0],
                &SpeakConditions::default(),
                false,
                601_000
            ),
            Decision::Report(_)
        ));
    }

    #[test]
    fn opening_panel_during_playback_marks_finished_as_input() {
        let state = super::super::tests::state();
        let (epoch, cancel) = {
            let _action = lock(&state.action).unwrap();
            super::super::interrupt(&state, false).unwrap()
        };
        state.last_input.store(0, Ordering::SeqCst);
        let character = characters::active_ids(&lock(&state.db).unwrap()).unwrap()[0].clone();
        super::super::windows::begin_panel(&state, &character, "menu".into()).unwrap();
        let (tx, mut rx) = unbounded_channel();
        tx.send(Finished {
            pending: pending(),
            input: interrupted_by_input(&state, 0, epoch, &cancel),
            delivered: true,
            failed: false,
        })
        .unwrap_or_else(|_| panic!("receiver closed"));
        assert!(rx.try_recv().unwrap().input);
        lock(&state.runtime).unwrap().hidden = true;
        assert!(!interrupted_by_input(&state, 0, epoch, &cancel));
        lock(&state.runtime).unwrap().hidden = false;
        lock(&state.runtime).unwrap().paused = true;
        assert!(!interrupted_by_input(&state, 0, epoch, &cancel));
    }

    #[test]
    fn playback_guard_sends_failure_when_unwinding() {
        let (tx, mut rx) = unbounded_channel();
        let result = std::panic::catch_unwind(|| {
            let _guard = PlaybackGuard {
                pending: Some(pending()),
                tx,
            };
            panic!("playback failed");
        });
        assert!(result.is_err());
        let finished = rx.try_recv().unwrap();
        assert!(!finished.input);
        assert!(!finished.delivered);
        assert!(finished.failed);
        assert!(rx.try_recv().is_err());
    }

    #[test]
    fn playback_panic_after_display_closes_report_and_unblocks_next_routine() {
        let state = super::super::tests::state();
        let pending = pending();
        let day = pending.claimed.occurrence.scheduled_date;
        let db = lock(&state.db).unwrap();
        store::save(&db, &pending.claimed.routine).unwrap();
        store::claim(&db, "r", day, 1).unwrap();
        store::transition(
            &db,
            "r",
            day,
            ReceiptState::Claimed,
            ReceiptState::Read,
            2,
            None,
        )
        .unwrap();
        let report = Report {
            id: "report".into(),
            user_id: "user".into(),
            routine_id: "r".into(),
            routine_name: "아침".into(),
            scheduled_date: day,
            body: "일정이 있어요.".into(),
            bubble: "일정이 있어요.".into(),
            delivery: "summarized".into(),
            reason: Some("날씨가 없어요.".into()),
            is_read: false,
            created_at: 3,
        };
        store::save_report_and_summarize(&db, &report, 3).unwrap();
        store::mark_displayed(&db, "r", "user", day, 4).unwrap();
        drop(db);
        let mut runtime = Runtime::new();
        runtime.playing = true;
        let tx = runtime.tx.clone();
        let _ = std::panic::catch_unwind(|| {
            let _guard = PlaybackGuard {
                pending: Some(pending),
                tx,
            };
            panic!("playback failed after display");
        });
        runtime.observe(&state).unwrap();
        assert!(!runtime.playing);
        let db = lock(&state.db).unwrap();
        let receipt = store::latest_receipt(&db, "r").unwrap().unwrap();
        assert_eq!(receipt.state, ReceiptState::Reported);
        assert_eq!(
            receipt.reason.as_deref(),
            Some("날씨가 없어요. 말풍선을 전하지 못했어요.")
        );
        let reports = store::reports(&db, "user").unwrap();
        assert_eq!(reports[0].delivery, "reported");
        assert_eq!(reports[0].reason, receipt.reason);
    }
}
