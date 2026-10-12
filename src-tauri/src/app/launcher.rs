use super::{
    conversation, interrupt, lock, now, publish, schedule_idle, unavailable, windows, AppState,
};
use crate::{desktop_toys, store, types::RuntimePhase, widget_commands, widgets};
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::sync::{atomic::Ordering, Arc};
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

const DEFAULT_SHORTCUT: &str = "CommandOrControl+Shift+Space";
const SHORTCUT_KEY: &str = "launcher_shortcut";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LauncherState {
    session_id: u64,
    shortcut: String,
    shortcut_registered: bool,
    shortcut_error: Option<String>,
}

#[derive(Default)]
struct PreviousFocus {
    window: Option<String>,
    native: Option<isize>,
}

pub(crate) struct Runtime {
    session_id: u64,
    executing: bool,
    cancellable: bool,
    shortcut: String,
    registered: Option<Shortcut>,
    shortcut_error: Option<String>,
    previous_focus: PreviousFocus,
    height: f64,
}

impl Default for Runtime {
    fn default() -> Self {
        Self {
            session_id: 0,
            executing: false,
            cancellable: false,
            shortcut: DEFAULT_SHORTCUT.into(),
            registered: None,
            shortcut_error: None,
            previous_focus: PreviousFocus::default(),
            height: 500.0,
        }
    }
}

impl Runtime {
    fn snapshot(&self) -> LauncherState {
        LauncherState {
            session_id: self.session_id,
            shortcut: self.shortcut.clone(),
            shortcut_registered: self.registered.is_some(),
            shortcut_error: self.shortcut_error.clone(),
        }
    }
}

pub(crate) fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, _, event| {
            if event.state == ShortcutState::Pressed {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let state = app.state::<Arc<AppState>>();
                    if let Err(error) = open_launcher(app.clone(), state).await {
                        eprintln!("빠른 실행 창을 열지 못했어요: {error}");
                    }
                });
            }
        })
        .build()
}

fn read_shortcut(db: &Connection) -> Result<String, String> {
    db.query_row("SELECT value FROM kv WHERE key=?1", [SHORTCUT_KEY], |row| {
        row.get(0)
    })
    .optional()
    .map(|value| value.unwrap_or_else(|| DEFAULT_SHORTCUT.into()))
    .map_err(|error| error.to_string())
}

fn save_shortcut(db: &Connection, shortcut: &str) -> Result<(), String> {
    db.execute(
        "INSERT INTO kv(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [SHORTCUT_KEY, shortcut],
    )
    .map(|_| ())
    .map_err(|error| error.to_string())
}

fn parse_shortcut(value: &str) -> Result<Option<Shortcut>, String> {
    if value.is_empty() {
        return Ok(None);
    }
    let shortcut = value
        .parse::<Shortcut>()
        .map_err(|_| "단축키 형식을 확인해 주세요. 예: CommandOrControl+Shift+Space".to_string())?;
    if !shortcut
        .mods
        .intersects(Modifiers::CONTROL | Modifiers::ALT | Modifiers::SUPER)
    {
        return Err(
            "일반 입력을 가로채지 않도록 Command·Control·Alt 중 하나를 함께 사용해 주세요.".into(),
        );
    }
    Ok(Some(shortcut))
}

pub(crate) fn initialize(app: &tauri::AppHandle, state: &AppState) -> Result<(), String> {
    let shortcut = read_shortcut(&*lock(&state.db)?)?;
    let mut runtime = lock(&state.launcher)?;
    runtime.shortcut = shortcut.clone();
    match parse_shortcut(&shortcut) {
        Ok(Some(key)) => match app.global_shortcut().register(key) {
            Ok(()) => runtime.registered = Some(key),
            Err(_) => runtime.shortcut_error = Some(
                "빠른 실행 단축키를 등록하지 못했어요. 다른 앱과 겹치는지 확인하거나 단축키를 바꿔 주세요. 트레이의 빠른 실행은 계속 사용할 수 있어요.".into(),
            ),
        },
        Ok(None) => {},
        Err(error) => runtime.shortcut_error = Some(error),
    }
    drop(runtime);
    tauri::WebviewWindowBuilder::new(
        app,
        "launcher",
        tauri::WebviewUrl::App("index.html?view=launcher".into()),
    )
    .title("comet · 빠른 실행")
    .inner_size(620.0, 500.0)
    .decorations(false)
    .maximizable(false)
    .resizable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible_on_all_workspaces(true)
    .visible(false)
    .focused(false)
    .build()
    .map_err(|error| error.to_string())?;
    #[cfg(target_os = "macos")]
    {
        let window = app
            .get_webview_window("launcher")
            .ok_or("빠른 실행 창을 만들지 못했어요.")?;
        native_panel::convert(window.ns_window().map_err(|error| error.to_string())?);
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn get_launcher_state(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<LauncherState, String> {
    Ok(lock(&state.launcher)?.snapshot())
}

#[tauri::command]
pub(crate) async fn set_launcher_shortcut(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    shortcut: String,
) -> Result<LauncherState, String> {
    let _action = lock(&state.action)?;
    let value = shortcut.trim();
    let parsed = parse_shortcut(value)?;
    let mut runtime = lock(&state.launcher)?;
    if runtime.registered == parsed && runtime.shortcut == value {
        runtime.shortcut_error = None;
        return Ok(runtime.snapshot());
    }
    let previous = runtime.registered;
    if parsed != previous {
        if let Some(key) = parsed {
            if app.global_shortcut().register(key).is_err() {
                runtime.shortcut_error = Some("이 단축키는 등록할 수 없어요. 다른 앱과 겹치는지 확인해 주세요. 기존 단축키는 유지했어요.".into());
                return Ok(runtime.snapshot());
            }
        }
    }
    if let Err(error) = save_shortcut(&*lock(&state.db)?, value) {
        if parsed != previous {
            if let Some(key) = parsed {
                let _ = app.global_shortcut().unregister(key);
            }
        }
        return Err(error);
    }
    if parsed != previous {
        if let Some(old) = previous {
            if app.global_shortcut().unregister(old).is_err() {
                if let Some(key) = parsed {
                    let _ = app.global_shortcut().unregister(key);
                }
                save_shortcut(&*lock(&state.db)?, &runtime.shortcut)?;
                runtime.shortcut_error =
                    Some("기존 단축키를 해제하지 못했어요. 기존 설정을 유지했어요.".into());
                return Ok(runtime.snapshot());
            }
        }
    }
    runtime.shortcut = value.into();
    runtime.registered = parsed;
    runtime.shortcut_error = None;
    let snapshot = runtime.snapshot();
    drop(runtime);
    let _ = app.emit("launcher-shortcut-changed", &snapshot);
    Ok(snapshot)
}

fn capture_focus(app: &tauri::AppHandle) -> PreviousFocus {
    let native = native_focus::capture();
    let window = if native.is_none() {
        app.webview_windows()
            .into_iter()
            .find_map(|(label, window)| {
                (label != "launcher" && window.is_focused().unwrap_or(false)).then_some(label)
            })
    } else {
        None
    };
    PreviousFocus { window, native }
}

fn restore_focus(app: &tauri::AppHandle, previous: PreviousFocus) {
    if let Some(label) = previous.window {
        if let Some(window) = app.get_webview_window(&label) {
            if window.is_visible().unwrap_or(false) {
                let _ = window.set_focus();
            }
        }
    } else if let Some(native) = previous.native {
        native_focus::restore(native);
    }
}

fn position_window(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
    desired_height: f64,
) -> Result<(), String> {
    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|point| app.monitor_from_point(point.x, point.y).ok().flatten())
        .or_else(|| window.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    if let Some(monitor) = monitor {
        let area = monitor.work_area();
        let scale = monitor.scale_factor();
        let width = (620.0 * scale).min(f64::from(area.size.width)).round() as u32;
        let height = (desired_height * scale)
            .min(f64::from(area.size.height))
            .round() as u32;
        window
            .set_size(tauri::PhysicalSize::new(width, height))
            .map_err(|e| e.to_string())?;
        window
            .set_position(tauri::PhysicalPosition::new(
                area.position.x + (area.size.width.saturating_sub(width) / 2) as i32,
                area.position.y + (area.size.height.saturating_sub(height) / 3) as i32,
            ))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn begin_session(state: &AppState) -> Result<u64, String> {
    // Caller owns action; it serializes cancellation with all automatic publishers.
    if unavailable(state) {
        return Err("앱을 종료하고 있어요.".into());
    }
    interrupt(state, false)?;
    *lock(&state.panel)? = None;
    widgets::storage::discard_pending(&*lock(&state.db)?)?;
    state.last_input.store(now(), Ordering::SeqCst);
    let mut status = lock(&state.runtime)?;
    status.phase = RuntimePhase::Idle;
    status.persona = None;
    status.error = None;
    drop(status);
    let mut launcher = lock(&state.launcher)?;
    launcher.session_id = launcher.session_id.wrapping_add(1);
    launcher.executing = false;
    launcher.cancellable = false;
    state
        .launcher_session
        .store(launcher.session_id, Ordering::SeqCst);
    state.launcher_open.store(true, Ordering::SeqCst);
    Ok(launcher.session_id)
}

#[tauri::command]
pub(crate) async fn open_launcher(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let _gate = state.launcher_gate.lock().await;
    let window = app
        .get_webview_window("launcher")
        .ok_or("빠른 실행 창을 찾지 못했어요.")?;
    let previous = capture_focus(&app);
    {
        let _action = lock(&state.action)?;
        let was_open = state.launcher_open.load(Ordering::SeqCst);
        begin_session(&state)?;
        if !was_open {
            lock(&state.launcher)?.previous_focus = previous;
        }
        desktop_toys::clear_automatic(&app);
        let height = lock(&state.launcher)?.height;
        // On macOS the panel becomes key without activating comet, so the
        // current Space stays put. set_focus would activate the app.
        if let Err(error) = position_window(&app, &window, height)
            .and_then(|_| window.show().map_err(|e| e.to_string()))
            .and_then(|_| {
                if cfg!(target_os = "macos") {
                    Ok(())
                } else {
                    window.set_focus().map_err(|e| e.to_string())
                }
            })
        {
            state.launcher_open.store(false, Ordering::SeqCst);
            let _ = window.hide();
            return Err(error);
        }
        window
            .emit("launcher-opened", lock(&state.launcher)?.snapshot())
            .map_err(|e| e.to_string())?;
    }
    publish(&app, &state);
    Ok(())
}

pub(crate) fn validate_session(state: &AppState, session_id: u64) -> Result<(), String> {
    if unavailable(state)
        || !state.launcher_open.load(Ordering::SeqCst)
        || lock(&state.launcher)?.session_id != session_id
    {
        return Err("이미 닫힌 빠른 실행 요청이에요. 다시 열어 주세요.".into());
    }
    Ok(())
}

fn close_current(
    app: &tauri::AppHandle,
    state: &AppState,
    session_id: u64,
    restore: bool,
    pending_only: bool,
) -> Result<(), String> {
    // Keep hide and focus restoration in the same boundary as a new open.
    let _action = lock(&state.action)?;
    let (previous, should_restore) = {
        let mut launcher = lock(&state.launcher)?;
        if launcher.session_id != session_id
            || !state.launcher_open.load(Ordering::SeqCst)
            || (pending_only && launcher.executing && !launcher.cancellable)
        {
            return Ok(());
        }
        let should_restore = if let Some(window) = app.get_webview_window("launcher") {
            let focused = window.is_focused().unwrap_or(false);
            window.hide().map_err(|e| e.to_string())?;
            restore && focused
        } else {
            false
        };
        state.launcher_open.store(false, Ordering::SeqCst);
        launcher.executing = false;
        state.last_input.store(now(), Ordering::SeqCst);
        schedule_idle(state, store::settings(&*lock(&state.db)?)?.idle_minutes);
        (std::mem::take(&mut launcher.previous_focus), should_restore)
    };
    if should_restore {
        restore_focus(app, previous);
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn close_launcher(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    session_id: u64,
) -> Result<(), String> {
    close_current(&app, &state, session_id, true, false)
}

#[tauri::command]
pub(crate) async fn resize_launcher(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    session_id: u64,
    height: f64,
) -> Result<(), String> {
    let _gate = state.launcher_gate.lock().await;
    if validate_session(&state, session_id).is_err() || !height.is_finite() {
        return Ok(());
    }
    let window = app
        .get_webview_window("launcher")
        .ok_or("빠른 실행 창을 찾지 못했어요.")?;
    let height = height.clamp(250.0, 500.0);
    lock(&state.launcher)?.height = height;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let size = window.inner_size().map_err(|e| e.to_string())?;
    let mut position = window.outer_position().map_err(|e| e.to_string())?;
    let mut physical_height = (height * scale).round() as u32;
    if let Some(monitor) = window.current_monitor().map_err(|e| e.to_string())? {
        let area = monitor.work_area();
        physical_height = physical_height.min(area.size.height);
        position.y = position.y.clamp(
            area.position.y,
            area.position.y + area.size.height.saturating_sub(physical_height) as i32,
        );
    }
    window
        .set_size(tauri::PhysicalSize::new(size.width, physical_height))
        .map_err(|e| e.to_string())?;
    window.set_position(position).map_err(|e| e.to_string())?;
    Ok(())
}

pub(crate) fn window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    let restore = match event {
        tauri::WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            true
        }
        tauri::WindowEvent::Focused(false) => false,
        _ => return,
    };
    let app = window.app_handle().clone();
    // Event callbacks run on the native thread. Snapshot the session without
    // taking a mutex that a worker may hold while waiting on that thread.
    let session = app
        .state::<Arc<AppState>>()
        .launcher_session
        .load(Ordering::SeqCst);
    tauri::async_runtime::spawn(async move {
        let state = app.state::<Arc<AppState>>();
        if !restore
            && app
                .get_webview_window("launcher")
                .is_some_and(|window| window.is_focused().unwrap_or(false))
        {
            return;
        }
        let _ = close_current(&app, &state, session, restore, !restore);
    });
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExecuteRequest {
    session_id: u64,
    action: LauncherAction,
}

#[derive(Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum LauncherAction {
    Settings {
        section: Option<windows::SettingsSection>,
    },
    Widget {
        id: String,
        expected_revision: i64,
    },
    Chat {
        content: String,
        target: String,
        client_message_id: String,
    },
    /// Saves the whole input as one undated inbox task; nothing is parsed from the text.
    AddTodo {
        id: String,
        expected_revision: i64,
        title: String,
        request_id: String,
    },
}

fn claim_execution(state: &AppState, session_id: u64) -> Result<(), String> {
    let _action = lock(&state.action)?;
    validate_session(state, session_id)?;
    let mut launcher = lock(&state.launcher)?;
    if launcher.executing {
        return Err("선택한 항목을 실행하고 있어요.".into());
    }
    launcher.executing = true;
    launcher.cancellable = true;
    Ok(())
}

// Caller owns action; mark the point after which an accepted command may finish.
pub(crate) fn accept_execution(state: &AppState, session_id: u64) -> Result<(), String> {
    validate_session(state, session_id)?;
    lock(&state.launcher)?.cancellable = false;
    Ok(())
}

#[tauri::command]
pub(crate) async fn execute_launcher(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    request: ExecuteRequest,
) -> Result<(), String> {
    let _gate = state.launcher_gate.lock().await;
    claim_execution(&state, request.session_id)?;
    let restore = match &request.action {
        LauncherAction::Chat { .. } | LauncherAction::AddTodo { .. } => true,
        LauncherAction::Widget { id, .. } => lock(&state.db)
            .and_then(|db| widgets::storage::get(&db, id))
            .map(|widget| crate::behavior::TOYS.contains(&widget.kind.as_str()))
            .unwrap_or(false),
        LauncherAction::Settings { .. } => false,
    };
    let result = async {
        match request.action {
            LauncherAction::Settings { section } => {
                {
                    let _action = lock(&state.action)?;
                    accept_execution(&state, request.session_id)?;
                }
                match section {
                    Some(section) => windows::open_settings_section(app.clone(), section),
                    None => windows::open_settings(app.clone()).await,
                }
            }
            LauncherAction::Widget {
                id,
                expected_revision,
            } => {
                widget_commands::open_widget_for_launcher(
                    app.clone(),
                    &state,
                    id,
                    expected_revision,
                    request.session_id,
                )
                .await
            }
            LauncherAction::Chat {
                content,
                target,
                client_message_id,
            } => {
                {
                    let _action = lock(&state.action)?;
                    conversation::ensure_available(&*lock(&state.db)?)?;
                    accept_execution(&state, request.session_id)?;
                }
                if lock(&state.runtime)?.hidden {
                    windows::show_boxes(&app, &state);
                }
                conversation::send_message(
                    app.clone(),
                    app.state::<Arc<AppState>>(),
                    content,
                    target,
                    client_message_id,
                    None,
                )
                .await
            }
            LauncherAction::AddTodo {
                id,
                expected_revision,
                title,
                request_id,
            } => widget_commands::add_todo_for_launcher(
                &app,
                &state,
                &id,
                expected_revision,
                &title,
                &request_id,
                request.session_id,
            ),
        }?;
        close_current(&app, &state, request.session_id, restore, false)
    }
    .await;
    let mut launcher = lock(&state.launcher)?;
    if launcher.session_id == request.session_id {
        launcher.executing = false;
        launcher.cancellable = false;
    }
    result
}

#[cfg(target_os = "macos")]
mod native_focus {
    use objc2_app_kit::{NSApplicationActivationOptions, NSRunningApplication, NSWorkspace};
    pub(super) fn capture() -> Option<isize> {
        NSWorkspace::sharedWorkspace()
            .frontmostApplication()
            .map(|app| app.processIdentifier())
            .filter(|pid| *pid as u32 != std::process::id())
            .map(|pid| pid as isize)
    }
    pub(super) fn restore(pid: isize) {
        if let Some(app) = NSRunningApplication::runningApplicationWithProcessIdentifier(pid as i32)
        {
            #[allow(deprecated)]
            let _ =
                app.activateWithOptions(NSApplicationActivationOptions::ActivateIgnoringOtherApps);
        }
    }
}

/// Spotlight-style launcher: a non-activating panel takes keyboard input over
/// the current Space, including another app's full-screen Space, without
/// bringing comet forward.
#[cfg(target_os = "macos")]
mod native_panel {
    use objc2::runtime::{AnyClass, AnyObject, Bool, ClassBuilder, Sel};
    use objc2::{msg_send, sel};
    use std::sync::OnceLock;

    const NON_ACTIVATING_PANEL: usize = 1 << 7;
    const CAN_JOIN_ALL_SPACES: usize = 1 << 0;
    const FULL_SCREEN_AUXILIARY: usize = 1 << 8;

    extern "C" fn yes(_: *mut AnyObject, _: Sel) -> Bool {
        Bool::YES
    }

    extern "C" fn no(_: *mut AnyObject, _: Sel) -> Bool {
        Bool::NO
    }

    fn panel_class() -> &'static AnyClass {
        static CLASS: OnceLock<&'static AnyClass> = OnceLock::new();
        CLASS.get_or_init(|| {
            let superclass = AnyClass::get(c"NSPanel").expect("AppKit provides NSPanel");
            let mut builder = ClassBuilder::new(c"CometLauncherPanel", superclass)
                .expect("launcher panel class is registered once");
            unsafe {
                builder.add_method(
                    sel!(canBecomeKeyWindow),
                    yes as extern "C" fn(*mut AnyObject, Sel) -> Bool,
                );
                builder.add_method(
                    sel!(canBecomeMainWindow),
                    no as extern "C" fn(*mut AnyObject, Sel) -> Bool,
                );
            }
            builder.register()
        })
    }

    /// Must run on the main thread before the window is first shown.
    pub(super) fn convert(pointer: *mut std::ffi::c_void) {
        let window = pointer.cast::<AnyObject>();
        unsafe {
            objc2::ffi::object_setClass(window, panel_class());
            let native = &*window;
            let style: usize = msg_send![native, styleMask];
            let _: () = msg_send![native, setStyleMask: style | NON_ACTIVATING_PANEL];
            let behavior: usize = msg_send![native, collectionBehavior];
            let _: () = msg_send![
                native,
                setCollectionBehavior: behavior | CAN_JOIN_ALL_SPACES | FULL_SCREEN_AUXILIARY
            ];
            // Panels hide on deactivation by default, and comet stays inactive here.
            let _: () = msg_send![native, setHidesOnDeactivate: false];
        }
    }
}

#[cfg(target_os = "windows")]
mod native_focus {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowThreadProcessId, IsWindow, SetForegroundWindow,
    };
    pub(super) fn capture() -> Option<isize> {
        unsafe {
            let window = GetForegroundWindow();
            let mut pid = 0;
            GetWindowThreadProcessId(window, &mut pid);
            (!window.is_null() && pid != std::process::id()).then_some(window as isize)
        }
    }
    pub(super) fn restore(window: isize) {
        unsafe {
            let window = window as windows_sys::Win32::Foundation::HWND;
            if IsWindow(window) != 0 {
                SetForegroundWindow(window);
            }
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod native_focus {
    pub(super) fn capture() -> Option<isize> {
        None
    }
    pub(super) fn restore(_: isize) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_disabled_and_invalid_shortcuts_are_distinct() {
        let db = store::open(std::path::Path::new(":memory:")).unwrap();
        assert_eq!(read_shortcut(&db).unwrap(), DEFAULT_SHORTCUT);
        assert!(parse_shortcut(DEFAULT_SHORTCUT).unwrap().is_some());
        save_shortcut(&db, "").unwrap();
        assert_eq!(read_shortcut(&db).unwrap(), "");
        assert!(parse_shortcut("").unwrap().is_none());
        assert!(parse_shortcut("Space").is_err());
        assert!(parse_shortcut("Shift+KeyK").is_err());
        assert!(parse_shortcut("CommandOrControl+Shift+Space+KeyK").is_err());
    }

    #[test]
    fn opening_interrupts_work_and_blocks_background_until_closed() {
        let state = crate::app::tests::state();
        let (_, pending) = {
            let _action = lock(&state.action).unwrap();
            interrupt(&state, true).unwrap()
        };
        let session = {
            let _action = lock(&state.action).unwrap();
            begin_session(&state).unwrap()
        };
        assert!(pending.load(Ordering::SeqCst));
        assert!(state.launcher_open.load(Ordering::SeqCst));
        state.last_input.store(0, Ordering::SeqCst);
        state.next_idle.store(0, Ordering::SeqCst);
        assert!(super::super::background::begin_background(&state)
            .unwrap()
            .is_none());
        assert!(validate_session(&state, session).is_ok());
        assert!(validate_session(&state, session + 1).is_err());
    }

    #[test]
    fn cancelled_preparation_cannot_be_accepted_and_accepted_focus_transfer_is_distinct() {
        let state = crate::app::tests::state();
        let session = {
            let _action = lock(&state.action).unwrap();
            begin_session(&state).unwrap()
        };
        claim_execution(&state, session).unwrap();
        assert!(lock(&state.launcher).unwrap().cancellable);
        state.launcher_open.store(false, Ordering::SeqCst);
        assert!(accept_execution(&state, session).is_err());
        let next = {
            let _action = lock(&state.action).unwrap();
            begin_session(&state).unwrap()
        };
        claim_execution(&state, next).unwrap();
        accept_execution(&state, next).unwrap();
        assert!(!lock(&state.launcher).unwrap().cancellable);
        assert_eq!(state.launcher_session.load(Ordering::SeqCst), next);
        assert!(validate_session(&state, session).is_err());
    }

    #[test]
    fn a_new_session_rejects_old_or_duplicate_execution() {
        let state = crate::app::tests::state();
        let first = {
            let _action = lock(&state.action).unwrap();
            begin_session(&state).unwrap()
        };
        claim_execution(&state, first).unwrap();
        assert!(claim_execution(&state, first).is_err());
        let second = {
            let _action = lock(&state.action).unwrap();
            begin_session(&state).unwrap()
        };
        assert!(claim_execution(&state, first).is_err());
        claim_execution(&state, second).unwrap();
        state.launcher_open.store(false, Ordering::SeqCst);
        assert!(validate_session(&state, second).is_err());
    }

    fn installed(state: &AppState, kind: &str) -> widgets::WidgetInstance {
        widgets::storage::instances(&lock(&state.db).unwrap())
            .unwrap()
            .into_iter()
            .find(|instance| instance.kind == kind)
            .unwrap()
    }

    fn todo_items(state: &AppState) -> Vec<serde_json::Value> {
        installed(state, "todo").data["items"]
            .as_array()
            .cloned()
            .unwrap_or_default()
    }

    #[test]
    fn launcher_todo_requires_current_session_kind_and_revision() {
        let state = crate::app::tests::state();
        let directory = tempfile::tempdir().unwrap();
        widgets::storage::install(
            &lock(&state.db).unwrap(),
            directory.path(),
            &["todo".into(), "memo".into()],
        )
        .unwrap();
        let (todo, memo) = (installed(&state, "todo"), installed(&state, "memo"));
        let session = {
            let _action = lock(&state.action).unwrap();
            begin_session(&state).unwrap()
        };
        let commit = |session: u64, id: &str, revision: i64| {
            crate::widget_commands::commit_todo_for_launcher(
                &state,
                session,
                id,
                revision,
                "우유 사기",
                &uuid::Uuid::new_v4().to_string(),
            )
        };
        assert!(commit(session + 1, &todo.id, todo.revision).is_err());
        assert!(commit(session, &memo.id, memo.revision).is_err());
        assert!(commit(session, &todo.id, todo.revision - 1).is_err());
        widgets::storage::set_enabled(&lock(&state.db).unwrap(), &todo.id, false).unwrap();
        assert!(commit(session, &todo.id, installed(&state, "todo").revision).is_err());
        assert!(todo_items(&state).is_empty());
    }

    #[test]
    fn launcher_todo_stores_verbatim_inbox_once() {
        let state = crate::app::tests::state();
        let directory = tempfile::tempdir().unwrap();
        widgets::storage::install(
            &lock(&state.db).unwrap(),
            directory.path(),
            &["todo".into()],
        )
        .unwrap();
        let todo = installed(&state, "todo");
        let session = {
            let _action = lock(&state.action).unwrap();
            begin_session(&state).unwrap()
        };
        let request_id = uuid::Uuid::new_v4().to_string();
        let title = "내일 3시 치과 예약 확인";
        for _ in 0..2 {
            crate::widget_commands::commit_todo_for_launcher(
                &state,
                session,
                &todo.id,
                todo.revision,
                title,
                &request_id,
            )
            .unwrap();
        }
        let items = todo_items(&state);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["title"], title);
        assert_eq!(items[0]["listId"], "default");
        assert_eq!(items[0]["planPeriod"], "none");
        // The text is kept as written; no date is inferred from it.
        for field in ["plannedDate", "dueDate", "dueAt"] {
            assert!(items[0][field].is_null(), "{field}");
        }
    }

    #[test]
    fn launcher_action_deserializes_add_todo() {
        let action: LauncherAction = serde_json::from_value(serde_json::json!({
            "type": "addTodo",
            "id": "todo-id",
            "expectedRevision": 3,
            "title": "우유 사기",
            "requestId": "request-id"
        }))
        .unwrap();
        assert!(matches!(
            action,
            LauncherAction::AddTodo {
                expected_revision: 3,
                ..
            }
        ));
    }
}
