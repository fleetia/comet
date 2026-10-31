use super::{is_current, lock, AppState};
use crate::pack_stories::{RunTicket, StoryAction, StoryEvent, StoryWidget, StoryWindow};
use rusqlite::Connection;
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::atomic::AtomicBool,
};
use tauri::Emitter;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum WaitResult {
    Matched,
    Cancelled,
}

struct Wait {
    run_id: String,
    epoch: u64,
    generation: u64,
    event: StoryEvent,
    cancel_on: Vec<StoryEvent>,
    result: Option<WaitResult>,
}

#[derive(Default)]
pub(crate) struct Runtime {
    wait: Option<Wait>,
    run_id: Option<String>,
    windows: BTreeMap<String, String>,
    saved_memos: BTreeSet<String>,
    focus: Option<String>,
}

pub(crate) fn mark_resumed_locked(state: &AppState, run: &RunTicket) -> Result<(), String> {
    *lock(&state.scene_events)? = Runtime {
        run_id: Some(run.run_id.clone()),
        ..Default::default()
    };
    Ok(())
}

pub(crate) fn execution_current(state: &AppState, run: &RunTicket) -> Result<bool, String> {
    Ok(
        state.epoch.load(std::sync::atomic::Ordering::SeqCst) == run.epoch
            && lock(&state.pack_stories)?
                .run
                .as_ref()
                .is_some_and(|active| active.run_id == run.run_id && active.epoch == run.epoch),
    )
}

pub(crate) fn current(state: &AppState, run: &RunTicket) -> Result<bool, String> {
    Ok(
        state.epoch.load(std::sync::atomic::Ordering::SeqCst) == run.epoch
            && lock(&state.pack_stories)?
                .run
                .as_ref()
                .is_some_and(|active| {
                    active.run_id == run.run_id
                        && active.epoch == run.epoch
                        && active.phase_generation == run.phase_generation
                }),
    )
}

pub(crate) fn available_locked(
    state: &AppState,
    db: &Connection,
    run: &RunTicket,
) -> Result<bool, String> {
    let status = lock(&state.runtime)?.clone();
    if status.hidden
        || status.paused
        || super::unavailable(state)
        || super::quiet_hours::automatic_blocked(state, &crate::store::settings(db)?)?
        || crate::characters::life::sleeping(state, &run.scope.center_id)?
    {
        return Ok(false);
    }
    if crate::widgets::storage::focus_active(db, chrono::Utc::now().timestamp_millis())?
        && !owned_focus(state, run)?
    {
        return Ok(false);
    }
    Ok(true)
}

pub(crate) fn available(state: &AppState, run: &RunTicket) -> Result<bool, String> {
    let _action = lock(&state.action)?;
    let db = lock(&state.db)?;
    Ok(current(state, run)? && available_locked(state, &db, run)?)
}

pub(crate) fn begin_wait(
    state: &AppState,
    run: &RunTicket,
    event: &StoryEvent,
    cancel_on: &[StoryEvent],
) -> Result<bool, String> {
    let _action = lock(&state.action)?;
    if !current(state, run)? || !available_locked(state, &*lock(&state.db)?, run)? {
        return Ok(false);
    }
    let mut events = lock(&state.scene_events)?;
    if events.run_id.as_deref() != Some(&run.run_id) {
        *events = Runtime {
            run_id: Some(run.run_id.clone()),
            ..Default::default()
        };
    }
    events.wait = Some(Wait {
        run_id: run.run_id.clone(),
        epoch: run.epoch,
        generation: run.phase_generation,
        event: event.clone(),
        cancel_on: cancel_on.to_vec(),
        result: None,
    });
    Ok(true)
}

pub(crate) fn take_event(state: &AppState, run: &RunTicket) -> Result<Option<WaitResult>, String> {
    let _action = lock(&state.action)?;
    if !current(state, run)? || !available_locked(state, &*lock(&state.db)?, run)? {
        return Ok(None);
    }
    let mut events = lock(&state.scene_events)?;
    Ok(events
        .wait
        .as_mut()
        .filter(|wait| {
            wait.run_id == run.run_id
                && wait.epoch == run.epoch
                && wait.generation == run.phase_generation
        })
        .and_then(|wait| wait.result.take()))
}

fn send_locked(
    state: &AppState,
    event: StoryEvent,
    window: Option<(&str, &str)>,
    center: Option<&str>,
) -> Result<bool, String> {
    let active = lock(&state.pack_stories)?.run.clone();
    let Some(run) = active else {
        return Ok(false);
    };
    if state.epoch.load(std::sync::atomic::Ordering::SeqCst) != run.epoch
        || center.is_some_and(|id| id != run.scope.center_id)
    {
        return Ok(false);
    }
    let mut runtime = lock(&state.scene_events)?;
    if runtime.run_id.as_deref() != Some(&run.run_id) {
        return Ok(false);
    }
    if let Some((kind, id)) = window {
        if runtime.windows.get(kind).map(String::as_str) != Some(id) {
            return Ok(false);
        }
    }
    let Some(wait) = runtime.wait.as_mut().filter(|wait| {
        wait.run_id == run.run_id
            && wait.epoch == run.epoch
            && wait.generation == run.phase_generation
            && wait.result.is_none()
    }) else {
        return Ok(false);
    };
    wait.result = if wait.event == event {
        Some(WaitResult::Matched)
    } else if wait.cancel_on.contains(&event) {
        Some(WaitResult::Cancelled)
    } else {
        None
    };
    Ok(wait.result.is_some())
}

pub(crate) fn body_event(state: &AppState, center: &str, moved: bool) -> Result<(), String> {
    let _action = lock(&state.action)?;
    body_event_locked(state, center, moved)
}

pub(crate) fn body_event_locked(state: &AppState, center: &str, moved: bool) -> Result<(), String> {
    send_locked(
        state,
        if moved {
            StoryEvent::BodyMoved {}
        } else {
            StoryEvent::BodyClicked {}
        },
        None,
        Some(center),
    )
    .map(|_| ())
}

pub(crate) fn memo_saved_locked(state: &AppState, id: &str, note: &str) -> Result<(), String> {
    let key = format!("{id}:{note}");
    {
        let events = lock(&state.scene_events)?;
        if events.windows.get("memo") != Some(&key) || events.saved_memos.contains(&key) {
            return Ok(());
        }
    }
    if send_locked(
        state,
        StoryEvent::WidgetSaved {
            widget: crate::pack_stories::SavedWidget::Memo,
        },
        Some(("memo", &key)),
        None,
    )? {
        lock(&state.scene_events)?.saved_memos.insert(key);
    }
    Ok(())
}

#[cfg(test)]
pub(crate) fn window_closed(state: &AppState, kind: StoryWindow, id: &str) -> Result<(), String> {
    let _action = lock(&state.action)?;
    window_closed_locked(state, kind, id)
}

pub(crate) fn window_closed_locked(
    state: &AppState,
    kind: StoryWindow,
    id: &str,
) -> Result<(), String> {
    let key = window_key(&kind);
    send_locked(
        state,
        StoryEvent::WindowClosed { window: kind },
        Some((key, id)),
        None,
    )?;
    let mut events = lock(&state.scene_events)?;
    if events.windows.get(key).map(String::as_str) == Some(id) {
        events.windows.remove(key);
    }
    Ok(())
}

pub(crate) fn closed_label(state: &AppState, label: &str) -> Result<(), String> {
    let mut events = lock(&state.scene_events)?;
    let entries: Vec<(String, StoryWindow)> = events
        .windows
        .iter()
        .filter_map(|(kind, id)| {
            let window = match kind.as_str() {
                "settings" if label == "settings" => StoryWindow::Settings,
                "focus-timer" if label == format!("widget-{id}") => StoryWindow::FocusTimer,
                "music" if label == format!("widget-{id}") => StoryWindow::Music,
                "todo" if label == "planner" => StoryWindow::Todo,
                "calendar" if label == "planner" => StoryWindow::Calendar,
                "ball" if label == format!("desktop-toy-{id}") => StoryWindow::Ball,
                "paper-plane" if label == format!("desktop-toy-{id}") => StoryWindow::PaperPlane,
                "bubbles" if label == format!("desktop-toy-{id}") => StoryWindow::Bubbles,
                _ => return None,
            };
            Some((kind.clone(), window))
        })
        .collect();
    let run_id = events.run_id.clone();
    let epoch = state.epoch.load(std::sync::atomic::Ordering::SeqCst);
    for (kind, window) in entries {
        let event = StoryEvent::WindowClosed { window };
        if let Some(wait) = events.wait.as_mut().filter(|wait| {
            Some(&wait.run_id) == run_id.as_ref() && wait.epoch == epoch && wait.result.is_none()
        }) {
            wait.result = if wait.event == event {
                Some(WaitResult::Matched)
            } else if wait.cancel_on.contains(&event) {
                Some(WaitResult::Cancelled)
            } else {
                None
            };
        }
        events.windows.remove(&kind);
    }
    Ok(())
}

fn window_key(window: &StoryWindow) -> &'static str {
    match window {
        StoryWindow::Settings => "settings",
        StoryWindow::Memo => "memo",
        StoryWindow::FocusTimer => "focus-timer",
        StoryWindow::Todo => "todo",
        StoryWindow::Calendar => "calendar",
        StoryWindow::Music => "music",
        StoryWindow::Ball => "ball",
        StoryWindow::PaperPlane => "paper-plane",
        StoryWindow::Bubbles => "bubbles",
    }
}
fn widget_key(widget: &StoryWidget) -> &'static str {
    match widget {
        StoryWidget::Memo => "memo",
        StoryWidget::FocusTimer => "focus-timer",
        StoryWidget::Todo => "todo",
        StoryWidget::Calendar => "calendar",
        StoryWidget::Music => "music",
        StoryWidget::Ball => "ball",
        StoryWidget::PaperPlane => "paper-plane",
        StoryWidget::Bubbles => "bubbles",
    }
}

pub(crate) fn focus_running(db: &Connection) -> Result<bool, String> {
    db.query_row("SELECT EXISTS(SELECT 1 FROM widget_instances WHERE kind='focus-timer' AND json_extract(data,'$.status')='running' AND json_extract(data,'$.mode')='focus')", [], |row| row.get(0)).map_err(|error| error.to_string())
}

pub(crate) fn focus_changed_locked(
    state: &AppState,
    db: &Connection,
    before: bool,
    after: bool,
    focus_window: bool,
) -> Result<bool, String> {
    if before == after {
        return Ok(false);
    }
    let run = lock(&state.pack_stories)?.run.clone();
    let Some(run) = run else {
        return Ok(false);
    };
    let id = crate::widgets::storage::instances(db)?
        .into_iter()
        .find(|item| item.kind == "focus-timer")
        .map(|item| item.id);
    if !before && after {
        let mut events = lock(&state.scene_events)?;
        let waiting = events.wait.as_ref().is_some_and(|wait| {
            wait.run_id == run.run_id
                && wait.epoch == run.epoch
                && wait.generation == run.phase_generation
                && wait.event == (StoryEvent::FocusStarted {})
        });
        if waiting
            && focus_window
            && id
                .as_ref()
                .is_some_and(|id| events.windows.get("focus-timer") == Some(id))
        {
            events.focus = id;
        }
        let owned = events.run_id.as_deref() == Some(&run.run_id) && events.focus.is_some();
        drop(events);
        if owned {
            send_locked(state, StoryEvent::FocusStarted {}, None, None)?;
        }
        return Ok(owned);
    }
    if owned_focus(state, &run)? {
        send_locked(state, StoryEvent::FocusStopped {}, None, None)?;
    }
    let paused = id
        .as_ref()
        .and_then(|id| crate::widgets::storage::get(db, id).ok())
        .is_some_and(|instance| {
            instance.data["status"] == "paused" && instance.data["mode"] == "focus"
        });
    if !paused {
        lock(&state.scene_events)?.focus = None;
    }
    Ok(false)
}

pub(crate) fn owned_focus(state: &AppState, run: &RunTicket) -> Result<bool, String> {
    let events = lock(&state.scene_events)?;
    Ok(events.run_id.as_deref() == Some(&run.run_id) && events.focus.is_some())
}

pub(crate) fn clear_run(state: &AppState, db: &Connection, run_id: &str) -> Result<(), String> {
    let mut events = lock(&state.scene_events)?;
    if events.run_id.as_deref() != Some(run_id) {
        return Ok(());
    }
    if let Some(id) = events.focus.take() {
        if let Ok(instance) = crate::widgets::storage::get(db, &id) {
            if instance.data["mode"] == "focus"
                && matches!(instance.data["status"].as_str(), Some("running" | "paused"))
            {
                crate::widgets::storage::execute(
                    db,
                    &crate::widgets::WidgetRequest {
                        request_id: uuid::Uuid::new_v4().to_string(),
                        instance_id: id,
                        expected_revision: instance.revision,
                        action: "cancel".into(),
                        input: serde_json::json!({}),
                    },
                    chrono::Utc::now().timestamp_millis(),
                    0,
                )?;
            }
        }
    }
    *events = Runtime::default();
    Ok(())
}

pub(crate) async fn execute_action(
    app: &tauri::AppHandle,
    state: &AppState,
    run: &RunTicket,
    cancel: &AtomicBool,
    action: &StoryAction,
) -> Result<bool, String> {
    {
        let _action = lock(&state.action)?;
        if !is_current(state, run.epoch, cancel)
            || !current(state, run)?
            || !available_locked(state, &*lock(&state.db)?, run)?
        {
            return Ok(false);
        }
        let mut events = lock(&state.scene_events)?;
        if events.run_id.as_deref() != Some(&run.run_id) {
            *events = Runtime {
                run_id: Some(run.run_id.clone()),
                ..Default::default()
            };
        }
    }
    match action {
        StoryAction::WidgetOpen { widget } => {
            crate::widgets::commands::open_widget_for_story(
                app,
                state,
                run,
                cancel,
                widget_key(widget),
            )
            .await?
        }
        StoryAction::FocusStart { minutes } => {
            focus_action(
                state,
                run,
                cancel,
                "start",
                serde_json::json!({"durationMs":u64::from(*minutes)*60_000}),
            )?;
            crate::widgets::commands::publish_widgets(app, state);
        }
        StoryAction::FocusStop {} => {
            focus_action(state, run, cancel, "cancel", serde_json::json!({}))?;
            crate::widgets::commands::publish_widgets(app, state);
        }
        StoryAction::SettingsOpen { tab, highlight } => {
            use crate::pack_stories::SettingsTab;
            let section = match tab {
                SettingsTab::Friends => super::windows::SettingsSection::Characters,
                SettingsTab::Dialogue => super::windows::SettingsSection::Dialogue,
                SettingsTab::Desktop => super::windows::SettingsSection::Automatic,
                SettingsTab::Widgets => super::windows::SettingsSection::Widgets,
                SettingsTab::Ai => super::windows::SettingsSection::Model,
                SettingsTab::General => super::windows::SettingsSection::General,
            };
            let _action = lock(&state.action)?;
            if !is_current(state, run.epoch, cancel)
                || !current(state, run)?
                || !available_locked(state, &*lock(&state.db)?, run)?
            {
                return Ok(false);
            }
            super::windows::show_settings_section(app.clone(), section)?;
            lock(&state.scene_events)?
                .windows
                .insert("settings".into(), "settings".into());
            if let Some(highlight) = highlight {
                app.emit_to("settings", "story-settings-highlight", highlight)
                    .map_err(|error| error.to_string())?;
            }
        }
        StoryAction::GuideOpen { page } => {
            eprintln!("guide.open skipped: {page:?}");
        }
    }
    Ok(true)
}

pub(crate) fn register_window_locked(
    state: &AppState,
    run: &RunTicket,
    kind: &str,
    id: String,
) -> Result<(), String> {
    if !current(state, run)? {
        return Err("이야기 실행이 바뀌었어요.".into());
    }
    lock(&state.scene_events)?.windows.insert(kind.into(), id);
    Ok(())
}

fn focus_action(
    state: &AppState,
    run: &RunTicket,
    cancel: &AtomicBool,
    action: &str,
    input: serde_json::Value,
) -> Result<(), String> {
    let _action = lock(&state.action)?;
    if !is_current(state, run.epoch, cancel) || !current(state, run)? {
        return Ok(());
    }
    let db = lock(&state.db)?;
    if !available_locked(state, &db, run)? {
        return Ok(());
    }
    let instance = crate::widgets::storage::instances(&db)?
        .into_iter()
        .find(|item| item.kind == "focus-timer")
        .ok_or("집중 타이머를 찾지 못했어요.")?;
    crate::widgets::storage::execute(
        &db,
        &crate::widgets::WidgetRequest {
            request_id: uuid::Uuid::new_v4().to_string(),
            instance_id: instance.id.clone(),
            expected_revision: instance.revision,
            action: action.into(),
            input,
        },
        chrono::Utc::now().timestamp_millis(),
        0,
    )?;
    let mut events = lock(&state.scene_events)?;
    if action == "start" {
        events.focus = Some(instance.id);
    } else {
        events.focus = None;
    }
    Ok(())
}
