use super::presence;
use super::scene::{next_scene, start_scene};
use super::unavailable;
use super::{is_current, lock, now, phase, publish, schedule_idle, AppState};
use crate::{behavior, characters, desktop, inference, store, types::PanelState, widgets};
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
    #[serde(alias = "wordbook", alias = "talk")]
    Dialogue,
    Memory,
    Model,
    #[serde(alias = "updates", alias = "user")]
    General,
    Organizer,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoryEditorTarget {
    pack_id: String,
    scenario_id: String,
}

#[tauri::command]
pub(crate) fn get_story_editor_target(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Option<StoryEditorTarget>, String> {
    Ok(lock(&state.story_editor_target)?.clone())
}

#[tauri::command]
pub(crate) fn open_story_editor(
    app: tauri::AppHandle,
    pack_id: String,
    scenario_id: String,
) -> Result<(), String> {
    let state = app.state::<Arc<AppState>>();
    let mut current = lock(&state.story_editor_target)?;
    let target = StoryEditorTarget {
        pack_id,
        scenario_id,
    };
    *current = Some(target.clone());
    if let Some(window) = app.get_webview_window("story-editor") {
        window
            .emit("open-story-editor", &target)
            .map_err(|e| e.to_string())?;
        window.unminimize().map_err(|e| e.to_string())?;
        window.show().map_err(|e| e.to_string())?;
        return window.set_focus().map_err(|e| e.to_string());
    }
    let mut url = tauri::Url::parse("https://comet.local/index.html").map_err(|e| e.to_string())?;
    url.query_pairs_mut()
        .append_pair("view", "story-editor")
        .append_pair("packId", &target.pack_id)
        .append_pair("scenarioId", &target.scenario_id);
    let path = format!("index.html?{}", url.query().unwrap_or_default());
    tauri::WebviewWindowBuilder::new(&app, "story-editor", tauri::WebviewUrl::App(path.into()))
        .title("comet · 장면 편집기")
        .inner_size(1280.0, 800.0)
        .min_inner_size(1120.0, 720.0)
        .decorations(false)
        .transparent(true)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

impl SettingsSection {
    fn key(self) -> &'static str {
        match self {
            Self::General => "general",
            Self::Characters => "characters",
            Self::Widgets => "widgets",
            Self::Automatic => "automatic",
            Self::Dialogue => "dialogue",
            Self::Memory => "memory",
            Self::Model => "model",
            Self::Organizer => "organizer",
        }
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum SystemSettingsPage {
    Notifications,
    AppleIntelligence,
    Calendar,
}

#[tauri::command]
pub(crate) fn open_system_settings(page: SystemSettingsPage) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let (program, args): (&str, &[&str]) = (
        "open",
        &[match page {
            SystemSettingsPage::Notifications => {
                "x-apple.systempreferences:com.apple.Notifications-Settings.extension"
            }
            SystemSettingsPage::AppleIntelligence => {
                "x-apple.systempreferences:com.apple.Siri-Settings.extension"
            }
            SystemSettingsPage::Calendar => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars"
            }
        }],
    );
    #[cfg(target_os = "windows")]
    let (program, args): (&str, &[&str]) = match page {
        SystemSettingsPage::Notifications => ("explorer.exe", &["ms-settings:notifications"]),
        _ => return Err("이 시스템 설정은 이 기기에서 열 수 없어요.".into()),
    };
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = page;
        return Err("이 시스템 설정은 이 기기에서 열 수 없어요.".into());
    }
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        let mut child = std::process::Command::new(program)
            .args(args)
            .spawn()
            .map_err(|_| "시스템 설정을 열지 못했어요.".to_string())?;
        std::thread::spawn(move || {
            let _ = child.wait();
        });
        Ok(())
    }
}

#[tauri::command]
pub(crate) fn cancel_generation(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    request: crate::types::ActiveRequest,
) -> Result<(), String> {
    let epoch = cancel_request(&state, &request)?;
    phase(
        &app,
        &state,
        epoch,
        crate::types::RuntimePhase::Idle,
        None,
        None,
    );
    Ok(())
}

fn cancel_request(state: &AppState, request: &crate::types::ActiveRequest) -> Result<u64, String> {
    let _action = lock(&state.action)?;
    if unavailable(state)
        || state.epoch.load(Ordering::SeqCst) != request.epoch
        || super::tasks::active_request(state)?.as_ref() != Some(request)
    {
        return Err("이전 요청은 이미 끝났거나 현재 요청이 바뀌었어요.".into());
    }
    let db = lock(&state.db)?;
    if let (Some(session_id), Some(message_id)) = (&request.session_id, &request.message_id) {
        store::cancel_conversation_reply(&db, session_id, message_id)?;
    }
    Ok(super::interrupt_with_db(state, false, &db)?.0)
}

#[tauri::command]
pub(crate) async fn open_panel(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    persona: String,
    mode: String,
    history_all: Option<bool>,
) -> Result<(), String> {
    if super::chat::focus_history_editor(&app, &state)?.is_some() {
        return Ok(());
    }
    let history = mode == "history";
    let Some(epoch) = begin_panel(&state, &persona, mode)? else {
        return Ok(());
    };
    if !history {
        desktop::request_balloon_focus(&app)?;
    }
    phase(
        &app,
        &state,
        epoch,
        crate::types::RuntimePhase::Idle,
        None,
        None,
    );
    if history {
        open_conversation_history(
            &app,
            if history_all == Some(true) {
                "all"
            } else {
                &persona
            },
        )?;
    }
    state.nlp.warmup();
    Ok(())
}

pub(crate) fn begin_panel(
    state: &AppState,
    persona: &str,
    mode: String,
) -> Result<Option<u64>, String> {
    begin_panel_with_source(state, persona, mode, "desktop")
}

pub(crate) fn begin_panel_with_source(
    state: &AppState,
    persona: &str,
    mode: String,
    source: &str,
) -> Result<Option<u64>, String> {
    if crate::characters::guests::actor(state, &*lock(&state.db)?, persona).is_err()
        || !["menu", "input", "history"].contains(&mode.as_str())
    {
        return Err("열 수 없는 캐릭터 메뉴예요.".into());
    }
    let epoch = {
        let _action = lock(&state.action)?;
        if unavailable(state) {
            return Ok(None);
        }
        if super::chat::history_editor_active(state)? {
            return Ok(None);
        }
        let db = lock(&state.db)?;
        let id = crate::characters::guests::actor(state, &db, persona)?.id;
        let center = crate::characters::guests::center_id(state, &id)?.unwrap_or(id.clone());
        lock(&state.reactions)?.clear_ambient(&id);
        if mode == "input" {
            crate::characters::life::wake(state, &id)?;
        }
        if crate::characters::guests::generation(state, &id)?.is_none() {
            presence::summon_locked(state, &id)?;
        }
        let focusing = mode == "input"
            && widgets::storage::focus_active(&db, chrono::Utc::now().timestamp_millis())?;
        if mode == "input" && !focusing && store::current_user(&db)?.is_some() {
            store::create_conversation_with_source(
                &db,
                std::slice::from_ref(&center),
                None,
                None,
                chrono::Utc::now().timestamp_millis(),
                Some(source),
            )?;
        } else {
            store::pause_conversations(&db)?;
        }
        let mode = if focusing {
            "focus".into()
        } else if mode == "input" && store::current_user(&db)?.is_none() {
            "name".into()
        } else {
            mode
        };
        let waiting = if matches!(mode.as_str(), "input" | "menu") && !focusing {
            super::conversation::waiting_story(state, &db, std::slice::from_ref(&id))?
        } else {
            None
        };
        let waiting_pack = if matches!(mode.as_str(), "input" | "menu") && !focusing {
            super::conversation::waiting_pack_run(state, &db, std::slice::from_ref(&center))?
        } else {
            None
        };
        let token = if waiting_pack.is_some() {
            super::interrupt_for_conversation(state, false)?
        } else {
            super::interrupt_with_db(state, false, &db)?
        };
        super::conversation::retain_waiting_story(state, waiting, token.0)?;
        super::conversation::retain_pack_run(state, &db, waiting_pack, token.0)?;
        *lock(&state.panel)? = if mode == "history" {
            schedule_idle(state, store::settings(&db)?.idle_minutes);
            None
        } else {
            Some(PanelState {
                persona: persona.into(),
                mode,
            })
        };
        state.last_input.store(now(), Ordering::SeqCst);
        token.0
    };
    Ok(Some(epoch))
}

fn open_conversation_history(app: &tauri::AppHandle, persona: &str) -> Result<(), String> {
    super::history_window::open(app, persona)
}

#[tauri::command]
pub(crate) fn close_panel(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    session_id: Option<String>,
    idle: Option<bool>,
) -> Result<(), String> {
    let epoch = {
        let _action = lock(&state.action)?;
        let db = lock(&state.db)?;
        let Some(epoch) =
            close_panel_locked(&state, &db, session_id.as_deref(), idle.unwrap_or(false))?
        else {
            return Ok(());
        };
        epoch
    };
    phase(
        &app,
        &state,
        epoch,
        crate::types::RuntimePhase::Idle,
        None,
        None,
    );
    Ok(())
}

// Caller holds action and DB; an idle fold only retains a finished, current generic stage.
pub(crate) fn close_panel_locked(
    state: &AppState,
    db: &rusqlite::Connection,
    session_id: Option<&str>,
    idle: bool,
) -> Result<Option<u64>, String> {
    if let Some(id) = session_id {
        if store::active_conversation(db)?.is_none_or(|session| session.id != id) {
            return Ok(None);
        }
    }
    let panel = lock(&state.panel)?.clone();
    let waiting =
        if idle && lock(&state.tasks)?.active.is_none() && lock(&state.playback)?.is_none() {
            if let Some(panel) = panel.filter(|panel| panel.mode == "input") {
                let actor = crate::characters::guests::actor(state, db, &panel.persona)
                    .map(|actor| actor.id)
                    .unwrap_or(panel.persona);
                let center = crate::characters::guests::center_id(state, &actor)?.unwrap_or(actor);
                super::conversation::waiting_pack_run(state, db, std::slice::from_ref(&center))
                    .ok()
                    .flatten()
            } else {
                None
            }
        } else {
            None
        };
    store::pause_conversations(db)?;
    let token = if waiting.is_some() {
        super::interrupt_for_conversation(state, false)?
    } else {
        super::interrupt_with_db(state, false, db)?
    };
    super::conversation::retain_pack_run(state, db, waiting, token.0)?;
    *lock(&state.panel)? = None;
    state.last_input.store(now(), Ordering::SeqCst);
    schedule_idle(state, store::settings(db)?.idle_minutes);
    Ok(Some(token.0))
}

#[tauri::command]
pub(crate) fn skip_talk(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let (epoch, _) = {
        let _action = lock(&state.action)?;
        let db = lock(&state.db)?;
        store::pause_conversations(&db)?;
        let token = super::interrupt_with_db(&state, false, &db)?;
        *lock(&state.panel)? = None;
        let settings = store::settings(&db)?;
        schedule_idle(&state, settings.idle_minutes);
        token
    };
    phase(
        &app,
        &state,
        epoch,
        crate::types::RuntimePhase::Idle,
        None,
        None,
    );
    Ok(())
}

#[tauri::command]
pub(crate) async fn resize_balloon(
    app: tauri::AppHandle,
    width: f64,
    height: f64,
    content_key: String,
    orbit_anchor: Option<desktop::OrbitAnchor>,
    surface: Option<desktop::BalloonSurface>,
) -> Result<desktop::BalloonPlacement, String> {
    desktop::resize_balloon(&app, width, height, &content_key, orbit_anchor, surface).await
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
        {
            let db = lock(&state.db)?;
            let active = characters::active_ids(&db)?;
            for id in &active {
                crate::characters::life::wake(&state, id)?;
            }
            super::conversation::ensure_available(&db)?;
            if presence::present_ids(&state, &active)?.is_empty() {
                if let Some(first) = active.first() {
                    presence::summon_locked(&state, first)?;
                }
            }
        }
        store::pause_conversations(&*lock(&state.db)?)?;
        let token = super::tasks::reserve(&state, super::tasks::Kind::Scene, false)?;
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
pub(crate) async fn open_organizer_settings(app: tauri::AppHandle) -> Result<(), String> {
    open_settings_section(app, SettingsSection::Organizer)
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
    if let Ok(mut presence) = lock(&state.presence) {
        presence.reset(now());
    }
    // Linux remaps body/face together in publish through the passive placement
    // adapter; a raw show here would let GTK/WM reset their saved positions.
    #[cfg(not(target_os = "linux"))]
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
    crate::desktop::menu::refresh(app);
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
        store::pause_conversations(&db)?;
        lock(&state.runtime)?.hidden = true;
        *lock(&state.panel)? = None;
        let token = super::interrupt_with_db(&state, false, &db)?;
        drop(db);
        for (label, window) in app.webview_windows() {
            if desktop::is_body(&label) || desktop::is_face(&label) {
                desktop::hide_ambient(&window)?;
            }
        }
        token
    };
    desktop::toys::clear_automatic(&app);
    phase(
        &app,
        &state,
        epoch,
        crate::types::RuntimePhase::Idle,
        None,
        None,
    );
    let _gate = state.gate.lock().await;
    if is_current(&state, epoch, &cancel) {
        inference::stop_local(&state.inference).await;
    }
    publish(&app, &state);
    crate::desktop::menu::refresh(&app);
    Ok(())
}

#[tauri::command]
pub(crate) fn set_paused(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    paused: bool,
    minutes: Option<u32>,
) -> Result<(), String> {
    let until = pause_until(paused, minutes, chrono::Utc::now().timestamp_millis())?;
    let token = apply_pause(&state, paused, until)?;
    if paused {
        desktop::toys::clear_automatic(&app);
    }
    if let Some((epoch, _)) = token {
        phase(
            &app,
            &state,
            epoch,
            crate::types::RuntimePhase::Idle,
            None,
            None,
        );
    } else {
        publish(&app, &state);
    }
    crate::desktop::menu::refresh(&app);
    Ok(())
}

pub(crate) fn pause_until(
    paused: bool,
    minutes: Option<u32>,
    now_ms: i64,
) -> Result<Option<i64>, String> {
    match minutes {
        Some(minutes) if paused => {
            if !(1..=720).contains(&minutes) {
                return Err("쉬는 시간은 1분에서 12시간 사이로 정해 주세요.".into());
            }
            Ok(Some(now_ms + i64::from(minutes) * 60_000))
        }
        _ => Ok(None),
    }
}

pub(crate) fn apply_pause(
    state: &AppState,
    paused: bool,
    until: Option<i64>,
) -> Result<Option<(u64, Arc<AtomicBool>)>, String> {
    let _action = lock(&state.action)?;
    pause_locked(state, paused, until)
}

/// Ends a timed pause. Checks and resumes under one action lock so a newer open-ended pause stays.
pub(crate) fn expire_pause(state: &AppState, now_ms: i64) -> Result<bool, String> {
    let _action = lock(&state.action)?;
    let expired = {
        let runtime = lock(&state.runtime)?;
        runtime.paused && runtime.paused_until.is_some_and(|until| until <= now_ms)
    };
    if expired {
        // Resuming never interrupts playback, so there is no epoch to settle.
        pause_locked(state, false, None)?;
    }
    Ok(expired)
}

/// The caller holds the action lock.
fn pause_locked(
    state: &AppState,
    paused: bool,
    until: Option<i64>,
) -> Result<Option<(u64, Arc<AtomicBool>)>, String> {
    {
        let mut runtime = lock(&state.runtime)?;
        runtime.paused = paused;
        runtime.paused_until = until.filter(|_| paused);
    }
    widgets::storage::discard_pending_during_quiet(&*lock(&state.db)?)?;
    if paused {
        widgets::storage::discard_pending_external_notice(&*lock(&state.db)?)?;
    }
    if !paused {
        schedule_idle(state, store::settings(&*lock(&state.db)?)?.idle_minutes);
    }
    let cancel = lock(&state.widget_playback)?.as_ref().map_or_else(
        || should_cancel_for_pause(paused, state.automatic.load(Ordering::SeqCst)),
        |event| paused && !super::quiet_hours::event_allowed_when_paused(&event.event),
    );
    if cancel || (paused && lock(&state.pack_stories)?.run.is_some()) {
        let db = lock(&state.db)?;
        let token = super::interrupt_with_db(state, false, &db)?;
        state.widget_epoch.store(token.0, Ordering::SeqCst);
        Ok(Some(token))
    } else {
        Ok(None)
    }
}

/// Shows the app data folder in the system file manager; it never changes its contents.
#[tauri::command]
pub(crate) fn reveal_data_folder(app: tauri::AppHandle) -> Result<(), String> {
    let folder = app
        .path()
        .app_data_dir()
        .map_err(|_| "데이터 폴더를 찾지 못했어요.".to_string())?;
    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(target_os = "windows")]
    let program = "explorer";
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let program = "xdg-open";
    let mut child = std::process::Command::new(program)
        .arg(&folder)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|_| "데이터 폴더를 열지 못했어요.".to_string())?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
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
    if let Some(window) = app.get_webview_window("settings") {
        skip_talk(app.clone(), app.state::<Arc<AppState>>())?;
        window.unminimize().map_err(|error| error.to_string())?;
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
    } else {
        let section = *lock(&state.settings_section)?;
        open_settings_section(app.clone(), section)?;
    }
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
    skip_talk(app.clone(), app.state::<Arc<AppState>>())?;
    show_settings_section(app, section)
}

pub(crate) fn show_settings_section(
    app: tauri::AppHandle,
    section: SettingsSection,
) -> Result<(), String> {
    let state = app.state::<Arc<AppState>>();
    // Keep the latest destination until the WebView has registered its listener,
    // and serialize simultaneous menu requests while the singleton is created.
    let mut current_section = lock(&state.settings_section)?;
    *current_section = section;
    if let Some(window) = app.get_webview_window("settings") {
        window
            .emit("open-settings-section", section)
            .map_err(|e| e.to_string())?;
        window.unminimize().map_err(|e| e.to_string())?;
        window.show().map_err(|e| e.to_string())?;
        return window.set_focus().map_err(|e| e.to_string());
    }
    let preferred_size = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|monitor| {
            let area = monitor
                .work_area()
                .size
                .to_logical::<f64>(monitor.scale_factor());
            (
                area.width.clamp(960.0, 1920.0),
                area.height.clamp(640.0, 1080.0),
            )
        })
        .unwrap_or((1120.0, 720.0));
    tauri::WebviewWindowBuilder::new(
        &app,
        "settings",
        tauri::WebviewUrl::App(
            format!("index.html?view=settings&section={}", section.key()).into(),
        ),
    )
    .title("comet · 설정")
    .inner_size(preferred_size.0, preferred_size.1)
    .min_inner_size(960.0, 640.0)
    .decorations(false)
    .transparent(true)
    .maximizable(false)
    .build()
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{Message, RuntimePhase};

    fn pending_request(state: &AppState) -> (store::ConversationSession, (u64, Arc<AtomicBool>)) {
        let _action = lock(&state.action).unwrap();
        let db = lock(&state.db).unwrap();
        let session =
            store::create_conversation(&db, &["builtin-a".into()], None, None, 1).unwrap();
        store::insert_user_input(
            &db,
            &Message {
                id: "input".into(),
                role: "user".into(),
                persona: Some("a".into()),
                content: "  합성 질문\n원문  ".into(),
                expression: None,
                created_at: chrono::Utc::now().timestamp_millis(),
                status: "complete".into(),
            },
            true,
        )
        .unwrap();
        store::save_conversation_draft(&db, &session.id, "새 초안").unwrap();
        let token =
            super::super::tasks::reserve_conversation(state, Some(&session.id), "input").unwrap();
        (session, token)
    }

    #[test]
    fn cancelling_current_request_persists_reason_and_rejects_late_results_or_old_clicks() {
        let state = super::super::tests::state();
        let (session, old) = pending_request(&state);
        let request = super::super::tasks::active_request(&state)
            .unwrap()
            .unwrap();
        let raw =
            serde_json::to_value(store::messages(&lock(&state.db).unwrap(), 100).unwrap()).unwrap();
        let mut wrong = request.clone();
        wrong.message_id = Some("other-input".into());
        assert!(cancel_request(&state, &wrong).is_err());
        assert!(!old.1.load(Ordering::SeqCst));
        let epoch = cancel_request(&state, &request).unwrap();
        assert!(epoch > old.0);
        assert!(old.1.load(Ordering::SeqCst));
        assert!(super::super::tasks::active_request(&state)
            .unwrap()
            .is_none());
        assert!(!super::super::set_phase_if_current(
            &state,
            old.0,
            RuntimePhase::Error,
            None,
            Some("late failure".into())
        )
        .unwrap());
        {
            let db = lock(&state.db).unwrap();
            assert_eq!(
                store::conversation_recovery(&db, &session.id)
                    .unwrap()
                    .unwrap()
                    .reason,
                store::RecoveryReason::Cancelled
            );
            assert_eq!(
                store::conversation(&db, &session.id).unwrap().draft,
                "새 초안"
            );
            assert!(store::input_ai_only(&db, "input").unwrap());
            assert_eq!(
                serde_json::to_value(store::messages(&db, 100).unwrap()).unwrap(),
                raw
            );
        }
        let next = {
            let _action = lock(&state.action).unwrap();
            store::clear_conversation_cancellation(&lock(&state.db).unwrap(), "input").unwrap();
            super::super::tasks::reserve_conversation(&state, Some(&session.id), "input").unwrap()
        };
        assert!(cancel_request(&state, &request).is_err());
        assert!(!next.1.load(Ordering::SeqCst));
        assert_eq!(
            super::super::tasks::active_request(&state)
                .unwrap()
                .unwrap()
                .epoch,
            next.0
        );
        assert_eq!(
            store::conversation_recovery(&lock(&state.db).unwrap(), &session.id)
                .unwrap()
                .unwrap()
                .reason,
            store::RecoveryReason::Incomplete
        );
    }

    #[test]
    fn cancellation_after_final_display_does_not_create_recovery() {
        let state = super::super::tests::state();
        let (session, _) = pending_request(&state);
        let request = super::super::tasks::active_request(&state)
            .unwrap()
            .unwrap();
        {
            let db = lock(&state.db).unwrap();
            store::insert_message_with_source(
                &db,
                &Message {
                    id: "reply:input:builtin-a".into(),
                    role: "assistant".into(),
                    persona: Some("a".into()),
                    content: "완료 응답".into(),
                    expression: Some("평온".into()),
                    created_at: chrono::Utc::now().timestamp_millis(),
                    status: "complete".into(),
                },
                "llm",
                None,
                true,
            )
            .unwrap();
            store::mark_message_displayed(&db, "reply:input:builtin-a", 2).unwrap();
        }
        cancel_request(&state, &request).unwrap();
        let db = lock(&state.db).unwrap();
        assert!(store::conversation_recovery(&db, &session.id)
            .unwrap()
            .is_none());
        assert!(db
            .query_row(
                "SELECT cancelled_message_id FROM conversation_sessions WHERE id=?1",
                [&session.id],
                |row| row.get::<_, Option<String>>(0)
            )
            .unwrap()
            .is_none());
        assert!(cancel_request(&state, &request).is_err());
    }

    #[test]
    fn automatic_request_cancellation_uses_epoch_without_marking_a_conversation() {
        let state = super::super::tests::state();
        let (session, _) = pending_request(&state);
        let old = super::super::tasks::active_request(&state)
            .unwrap()
            .unwrap();
        let token = {
            let _action = lock(&state.action).unwrap();
            super::super::tasks::reserve(&state, super::super::tasks::Kind::Background, true)
                .unwrap()
        };
        let request = super::super::tasks::active_request(&state)
            .unwrap()
            .unwrap();
        assert!(request.session_id.is_none());
        assert!(request.message_id.is_none());
        assert!(cancel_request(&state, &old).is_err());
        cancel_request(&state, &request).unwrap();
        assert!(token.1.load(Ordering::SeqCst));
        assert_eq!(
            store::conversation_recovery(&lock(&state.db).unwrap(), &session.id)
                .unwrap()
                .unwrap()
                .reason,
            store::RecoveryReason::Incomplete
        );
    }
}
