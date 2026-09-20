use super::lifecycle::flush_positions;
use super::scene::{next_scene, start_scene};
use super::unavailable;
use super::{interrupt, is_current, lock, now, phase, publish, schedule_idle, snapshot, AppState};
use crate::{behavior, characters, desktop_toys};
use crate::{desktop, inference, store, types::PanelState, widgets};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::Emitter;
use tauri::Manager;

#[derive(Clone, Copy, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum SettingsSection {
    #[default]
    Characters,
    Widgets,
    Automatic,
    Wordbook,
    Talk,
    Memory,
    Model,
    #[serde(alias = "updates")]
    General,
}

impl SettingsSection {
    fn key(self) -> &'static str {
        match self {
            Self::General => "general",
            Self::Characters => "characters",
            Self::Widgets => "widgets",
            Self::Automatic => "automatic",
            Self::Wordbook => "wordbook",
            Self::Talk => "talk",
            Self::Memory => "memory",
            Self::Model => "model",
        }
    }
}

#[tauri::command]
pub(crate) fn cancel_generation(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), String> {
    skip_talk(app, state)
}

#[tauri::command]
pub(crate) fn open_panel(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    persona: String,
    mode: String,
) -> Result<(), String> {
    if characters::active_character(&*lock(&state.db)?, &persona).is_err()
        || !["menu", "input", "history"].contains(&mode.as_str())
    {
        return Err("열 수 없는 캐릭터 메뉴예요.".into());
    }
    let (epoch, _) = {
        let _action = lock(&state.action)?;
        if unavailable(&state) {
            return Ok(());
        }
        let token = interrupt(&state, false)?;
        *lock(&state.panel)? = Some(PanelState { persona, mode });
        state.last_input.store(now(), Ordering::SeqCst);
        token
    };
    phase(&app, &state, epoch, "idle", None, None);
    if let Some(window) = app.get_webview_window("balloon") {
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn close_panel(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), String> {
    {
        let _action = lock(&state.action)?;
        *lock(&state.panel)? = None;
        state.last_input.store(now(), Ordering::SeqCst);
        let settings = store::settings(&*lock(&state.db)?)?;
        schedule_idle(&state, settings.idle_minutes);
    }
    publish(&app, &state);
    Ok(())
}

#[tauri::command]
pub(crate) fn skip_talk(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let (epoch, _) = {
        let _action = lock(&state.action)?;
        let token = interrupt(&state, false)?;
        *lock(&state.panel)? = None;
        let settings = store::settings(&*lock(&state.db)?)?;
        schedule_idle(&state, settings.idle_minutes);
        token
    };
    phase(&app, &state, epoch, "idle", None, None);
    Ok(())
}

#[tauri::command]
pub(crate) fn resize_balloon(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    height: f64,
) -> Result<(), String> {
    desktop::resize_balloon(&app, &snapshot(&state)?, height)
}

#[tauri::command]
pub(crate) fn talk_now(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let (token, lines, source) = {
        let _action = lock(&state.action)?;
        if unavailable(&state) {
            return Ok(());
        }
        let token = interrupt(&state, false)?;
        *lock(&state.panel)? = None;
        state.last_input.store(now(), Ordering::SeqCst);
        let settings = store::settings(&*lock(&state.db)?)?;
        schedule_idle(&state, settings.idle_minutes);
        let (lines, source) = next_scene(&state)?;
        (token, lines, source)
    };
    start_scene(app, state.inner().clone(), lines, source, token, None);
    Ok(())
}

#[tauri::command]
pub(crate) async fn open_settings(app: tauri::AppHandle) -> Result<(), String> {
    let section = *lock(&app.state::<Arc<AppState>>().settings_section)?;
    open_settings_section(app, section)
}

#[tauri::command]
pub(crate) async fn get_settings_section(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<SettingsSection, String> {
    Ok(*lock(&state.settings_section)?)
}

#[tauri::command]
pub(crate) fn set_settings_section(
    state: tauri::State<'_, Arc<AppState>>,
    section: SettingsSection,
) -> Result<(), String> {
    *lock(&state.settings_section)? = section;
    Ok(())
}

#[tauri::command]
pub(crate) fn set_settings_dirty(state: tauri::State<'_, Arc<AppState>>, dirty: bool) {
    state.settings_dirty.store(dirty, Ordering::SeqCst);
}

pub(crate) fn show_boxes(app: &tauri::AppHandle, state: &AppState) {
    let Ok(action) = lock(&state.action) else {
        return;
    };
    if unavailable(state) {
        return;
    }
    if let Ok(db) = lock(&state.db) {
        if let Ok(mut preferences) = behavior::preferences(&db) {
            preferences.characters_visible = true;
            if behavior::save(&db, &preferences).is_err() {
                return;
            }
        }
    }
    for (label, window) in app.webview_windows() {
        if desktop::is_body(&label) {
            let _ = window.show();
        }
    }
    if let Ok(mut runtime) = lock(&state.runtime) {
        runtime.hidden = false;
    }
    state.last_input.store(now(), Ordering::SeqCst);
    drop(action);
    publish(app, state);
}

#[tauri::command]
pub(crate) fn show_characters(app: tauri::AppHandle, state: tauri::State<'_, Arc<AppState>>) {
    show_boxes(&app, &state);
}

#[tauri::command]
pub(crate) async fn hide_boxes(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let (epoch, cancel) = {
        let _action = lock(&state.action)?;
        let db = lock(&state.db)?;
        let mut preferences = behavior::preferences(&db)?;
        preferences.characters_visible = false;
        behavior::save(&db, &preferences)?;
        drop(db);
        lock(&state.runtime)?.hidden = true;
        *lock(&state.panel)? = None;
        for (label, window) in app.webview_windows() {
            if desktop::is_body(&label) || desktop::is_face(&label) {
                desktop::hide_ambient(&window)?;
            }
        }
        interrupt(&state, false)?
    };
    desktop_toys::clear_automatic(&app);
    phase(&app, &state, epoch, "idle", None, None);
    let _gate = state.gate.lock().await;
    if is_current(&state, epoch, &cancel) {
        inference::stop_local(&state.inference).await;
    }
    publish(&app, &state);
    Ok(())
}

#[tauri::command]
pub(crate) fn set_paused(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    paused: bool,
) -> Result<(), String> {
    let token = apply_pause(&state, paused)?;
    if paused {
        desktop_toys::clear_automatic(&app);
    }
    if let Some((epoch, _)) = token {
        phase(&app, &state, epoch, "idle", None, None);
    } else {
        publish(&app, &state);
    }
    Ok(())
}

pub(crate) fn apply_pause(
    state: &AppState,
    paused: bool,
) -> Result<Option<(u64, Arc<AtomicBool>)>, String> {
    let _action = lock(&state.action)?;
    lock(&state.runtime)?.paused = paused;
    widgets::storage::discard_pending(&*lock(&state.db)?)?;
    if !paused {
        schedule_idle(state, store::settings(&*lock(&state.db)?)?.idle_minutes);
    }
    let has_talk = lock(&state.talk_playback)?.is_some();
    if should_cancel_for_pause(paused, state.automatic.load(Ordering::SeqCst))
        || (paused && has_talk)
    {
        Ok(Some(interrupt(state, false)?))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub(crate) async fn quit_app(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    force: Option<bool>,
) -> Result<(), String> {
    if !force.unwrap_or(false) && confirm_settings_exit(&app, &state)? {
        return Ok(());
    }
    flush_positions(&state, true)?;
    if force.unwrap_or(false) {
        state.settings_exit_confirmed.store(true, Ordering::SeqCst);
    }
    app.exit(0);
    Ok(())
}

pub(crate) fn confirm_settings_exit(
    app: &tauri::AppHandle,
    state: &AppState,
) -> Result<bool, String> {
    if !settings_exit_needs_confirmation(state) {
        return Ok(false);
    }
    let section = *lock(&state.settings_section)?;
    open_settings_section(app.clone(), section)?;
    app.emit_to("settings", "confirm-settings-exit", ())
        .map_err(|error| error.to_string())?;
    Ok(true)
}

pub(crate) fn settings_exit_needs_confirmation(state: &AppState) -> bool {
    state.settings_dirty.load(Ordering::SeqCst)
        && !state.settings_exit_confirmed.load(Ordering::SeqCst)
}

pub(crate) fn should_cancel_for_pause(paused: bool, automatic: bool) -> bool {
    paused && automatic
}

pub(crate) fn open_settings_section(
    app: tauri::AppHandle,
    section: SettingsSection,
) -> Result<(), String> {
    let state = app.state::<Arc<AppState>>();
    skip_talk(app.clone(), app.state::<Arc<AppState>>())?;
    // Keep the latest destination until the WebView has registered its listener,
    // and serialize simultaneous menu requests while the singleton is created.
    let mut current_section = lock(&state.settings_section)?;
    *current_section = section;
    if let Some(window) = app.get_webview_window("settings") {
        window
            .emit("open-settings-section", section)
            .map_err(|e| e.to_string())?;
        window.show().map_err(|e| e.to_string())?;
        return window.set_focus().map_err(|e| e.to_string());
    }
    tauri::WebviewWindowBuilder::new(
        &app,
        "settings",
        tauri::WebviewUrl::App(
            format!("index.html?view=settings&section={}", section.key()).into(),
        ),
    )
    .title("comet · 설정")
    .inner_size(1120.0, 720.0)
    .min_inner_size(960.0, 640.0)
    .decorations(false)
    .maximizable(false)
    .build()
    .map_err(|e| e.to_string())?;
    Ok(())
}
