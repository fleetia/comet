use crate::{
    interrupt, lock, now, publish, skip_talk, start_scene, store,
    widgets::{self, storage, WidgetEvent, WidgetRequest, WidgetSnapshot},
    AppState, SceneLine,
};
use std::sync::{atomic::Ordering, Arc};
use tauri::{Emitter, Manager};

pub(crate) fn publish_widgets(app: &tauri::AppHandle, state: &AppState) {
    if let Ok(db) = lock(&state.db) {
        if let Ok(snapshot) = storage::snapshot(&db) {
            let _ = app.emit("widgets-state", snapshot);
        }
    }
}

fn current_events(state: &AppState, db: &rusqlite::Connection) -> Result<(), String> {
    let epoch = state.epoch.load(Ordering::SeqCst);
    if state.widget_epoch.load(Ordering::SeqCst) != epoch {
        storage::discard_pending(db)?;
        state.widget_epoch.store(epoch, Ordering::SeqCst);
    }
    Ok(())
}

fn change<T>(
    state: &AppState,
    action: impl FnOnce(&rusqlite::Connection) -> Result<T, String>,
) -> Result<T, String> {
    let _guard = lock(&state.action)?;
    if state.stopping.load(Ordering::SeqCst) {
        return Err("앱을 종료하고 있어요.".into());
    }
    let db = lock(&state.db)?;
    current_events(state, &db)?;
    action(&db)
}

#[tauri::command]
pub(crate) fn get_widgets(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<WidgetSnapshot, String> {
    storage::snapshot(&*lock(&state.db)?)
}

#[tauri::command]
pub(crate) fn install_widgets(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    kinds: Vec<String>,
) -> Result<(), String> {
    let result = change(&state, |db| storage::install(db, &state.app_data, &kinds));
    publish_widgets(&app, &state);
    result
}

#[tauri::command]
pub(crate) fn finish_widget_onboarding(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), String> {
    change(&state, storage::finish_onboarding)?;
    publish_widgets(&app, &state);
    Ok(())
}

#[tauri::command]
pub(crate) fn set_widget_enabled(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
    enabled: bool,
) -> Result<(), String> {
    change(&state, |db| {
        storage::set_enabled(db, &id, enabled)?;
        if !enabled {
            cancel_widget_jobs(&state, Some(&id))?;
        }
        Ok(())
    })?;
    if !enabled {
        cancel_widget_scene(&app, &state)?;
        if let Some(window) = app.get_webview_window(&format!("widget-{id}")) {
            window.close().map_err(|error| error.to_string())?;
        }
    }
    publish_widgets(&app, &state);
    Ok(())
}

#[tauri::command]
pub(crate) fn remove_widget(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
    delete_data: bool,
) -> Result<(), String> {
    change(&state, |db| {
        storage::remove(db, &state.app_data, &id, delete_data)?;
        cancel_widget_jobs(&state, Some(&id))
    })?;
    cancel_widget_scene(&app, &state)?;
    if let Some(window) = app.get_webview_window(&format!("widget-{id}")) {
        window.close().map_err(|error| error.to_string())?;
    }
    publish_widgets(&app, &state);
    Ok(())
}

fn cancel_widget_scene(app: &tauri::AppHandle, state: &AppState) -> Result<(), String> {
    {
        let _action = lock(&state.action)?;
        let has_scene = lock(&state.widget_playback)?.is_some();
        let has_talk = lock(&state.talk_playback)?.is_some();
        let db = lock(&state.db)?;
        if (has_scene && !widget_event_current(state, &db)?)
            || (has_talk && !crate::talk_host::current(state, &db)?)
        {
            let token = interrupt(state, true)?;
            state.widget_epoch.store(token.0, Ordering::SeqCst);
            let mut runtime = lock(&state.runtime)?;
            runtime.phase = "idle".into();
            runtime.persona = None;
        }
    }
    publish(app, state);
    Ok(())
}

pub(crate) fn cancel_widget_jobs(state: &AppState, id: Option<&str>) -> Result<(), String> {
    let mut jobs = lock(&state.widget_jobs)?;
    if let Some(id) = id {
        if let Some(cancel) = jobs.remove(id) {
            cancel.store(true, Ordering::SeqCst);
        }
    } else {
        for (_, cancel) in jobs.drain() {
            cancel.store(true, Ordering::SeqCst);
        }
    }
    Ok(())
}

pub(crate) fn widget_event_current(
    state: &AppState,
    db: &rusqlite::Connection,
) -> Result<bool, String> {
    let Some(event) = lock(&state.widget_playback)?.clone() else {
        return Ok(false);
    };
    let all = storage::instances(db)?;
    Ok(event.expires_at > chrono::Utc::now().timestamp_millis()
        && all.iter().any(|instance| {
            instance.id == event.instance_id
                && instance.installed
                && instance.enabled
                && instance.revision == event.revision
        })
        && widgets::manifest(&event.widget_kind)?
            .required
            .iter()
            .all(|kind| {
                all.iter().any(|instance| {
                    instance.kind == *kind && instance.installed && instance.enabled
                })
            }))
}

#[tauri::command]
pub(crate) fn execute_widget(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    request: WidgetRequest,
) -> Result<(), String> {
    change(&state, |db| {
        storage::execute(
            db,
            &request,
            chrono::Utc::now().timestamp_millis(),
            uuid::Uuid::new_v4().as_u128() as u64,
        )
    })?;
    // New state can invalidate an already playing reaction to this widget.
    cancel_widget_scene(&app, &state)?;
    publish_widgets(&app, &state);
    Ok(())
}

#[tauri::command]
pub(crate) fn get_widget_journal(
    state: tauri::State<'_, Arc<AppState>>,
    before: Option<i64>,
) -> Result<Vec<(i64, WidgetEvent)>, String> {
    let db = lock(&state.db)?;
    if !storage::instances(&db)?
        .iter()
        .any(|entry| entry.kind == "journal" && entry.installed && entry.enabled)
    {
        return Err("사건 일지를 설치하고 켜 주세요.".into());
    }
    storage::journal(&db, before)
}

#[tauri::command]
pub(crate) fn open_widgets(app: tauri::AppHandle) -> Result<(), String> {
    skip_talk(app.clone(), app.state::<Arc<AppState>>())?;
    if let Some(window) = app.get_webview_window("widgets") {
        window.show().map_err(|error| error.to_string())?;
        return window.set_focus().map_err(|error| error.to_string());
    }
    tauri::WebviewWindowBuilder::new(
        &app,
        "widgets",
        tauri::WebviewUrl::App("index.html?view=widgets".into()),
    )
    .title("Comet · 위젯 관리")
    .inner_size(880.0, 760.0)
    .min_inner_size(560.0, 480.0)
    .decorations(false)
    .maximizable(false)
    .build()
    .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) fn close_widgets(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("widgets") {
        window.close().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn open_widget(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), String> {
    let instance = storage::get(&*lock(&state.db)?, &id)?;
    if !instance.installed || !instance.enabled {
        return Err("위젯을 설치하고 켜 주세요.".into());
    }
    uuid::Uuid::parse_str(&id).map_err(|_| "위젯 식별자가 올바르지 않아요.".to_string())?;
    let label = format!("widget-{id}");
    if let Some(window) = app.get_webview_window(&label) {
        window.show().map_err(|error| error.to_string())?;
        return window.set_focus().map_err(|error| error.to_string());
    }
    tauri::WebviewWindowBuilder::new(
        &app,
        label,
        tauri::WebviewUrl::App(format!("index.html?view=widget&id={id}").into()),
    )
    .title(format!(
        "Comet · {}",
        widgets::manifest(&instance.kind)?.name
    ))
    .inner_size(360.0, 480.0)
    .min_inner_size(296.0, 320.0)
    .decorations(false)
    .maximizable(false)
    .build()
    .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) fn close_widget(app: tauri::AppHandle, id: String) -> Result<(), String> {
    uuid::Uuid::parse_str(&id).map_err(|_| "위젯 식별자가 올바르지 않아요.".to_string())?;
    if let Some(window) = app.get_webview_window(&format!("widget-{id}")) {
        window.close().map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub(crate) fn advance_widgets(app: &tauri::AppHandle, state: &AppState) -> Result<(), String> {
    let changed = change(state, |db| {
        let timestamp = chrono::Utc::now().timestamp_millis();
        let changed = storage::advance(db, timestamp)?;
        let alerted =
            widgets::reminders::advance(db, &mut *lock(&state.widget_clocks)?, timestamp)?;
        let runtime = lock(&state.runtime)?;
        if runtime.hidden || runtime.paused || !store::settings(db)?.autonomous_enabled {
            storage::discard_pending(db)?;
        }
        Ok(changed || alerted)
    })?;
    if changed {
        cancel_widget_scene(app, state)?;
        publish_widgets(app, state);
    }
    Ok(())
}

pub(crate) fn play_widget_reaction(
    app: &tauri::AppHandle,
    state: &Arc<AppState>,
) -> Result<bool, String> {
    let pending = {
        let _action = lock(&state.action)?;
        let status = lock(&state.runtime)?.clone();
        let db = lock(&state.db)?;
        current_events(state, &db)?;
        if status.hidden || status.paused || !store::settings(&db)?.autonomous_enabled {
            storage::discard_pending(&db)?;
            return Ok(false);
        }
        if state.stopping.load(Ordering::SeqCst)
            || status.phase != "idle"
            || lock(&state.panel)?.is_some()
            || now() - state.last_input.load(Ordering::SeqCst) < 3
        {
            return Ok(false);
        }
        let event = storage::take_reaction(&db, chrono::Utc::now().timestamp_millis())?;
        if let Some(event) = event {
            let token = interrupt(state, true)?;
            state.widget_epoch.store(token.0, Ordering::SeqCst);
            *lock(&state.widget_playback)? = Some(event.clone());
            state.last_input.store(now(), Ordering::SeqCst);
            let (lines, source) = match crate::talk_host::prepare(state, &db, Some(&event))? {
                Some(lines) => (lines, "talk"),
                None => (
                    vec![SceneLine {
                        persona: "a".into(),
                        expression: "normal".into(),
                        text: event.event.text.clone(),
                    }],
                    "widget",
                ),
            };
            Some((event.id, token, lines, source))
        } else {
            None
        }
    };
    let Some((event_id, token, lines, source)) = pending else {
        return Ok(false);
    };
    start_scene(
        app.clone(),
        state.clone(),
        lines,
        source,
        token,
        Some(event_id),
    );
    Ok(true)
}
