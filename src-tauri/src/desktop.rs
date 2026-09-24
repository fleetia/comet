use crate::{
    characters::InstalledCharacter,
    store,
    types::{Snapshot, WindowPosition},
    AppState,
};
use std::sync::{atomic::Ordering, Arc, Mutex};
use tauri::{AppHandle, Manager, Monitor, PhysicalPosition, PhysicalSize, WebviewWindow};

const BODY_SIZE: (f64, f64) = (112.0, 88.0);
const SPRITE_PADDING: f64 = 8.0;
const FACE_SIZE: (f64, f64) = (120.0, 36.0);
const BODY_PREFIX: &str = "body-";
const FACE_PREFIX: &str = "face-";

pub(crate) fn is_body(label: &str) -> bool {
    label.starts_with(BODY_PREFIX)
}
pub(crate) fn is_face(label: &str) -> bool {
    label.starts_with(FACE_PREFIX)
}
fn body_label(id: &str) -> String {
    format!("{BODY_PREFIX}{id}")
}
fn face_label(id: &str) -> String {
    format!("{FACE_PREFIX}{id}")
}

// Displaying ambient content must not replace the foreground application's key window.
fn show_passive(app: &AppHandle, window: &WebviewWindow) -> Result<(), String> {
    let collision_token = crate::character_collision_host::prepare_show(window);
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        use std::sync::atomic::Ordering;
        let state = app.state::<Arc<AppState>>();
        let epoch = state.epoch.load(Ordering::SeqCst);
        let app = app.clone();
        let label = window.label().to_string();
        window.run_on_main_thread(move || {
            let state = app.state::<Arc<AppState>>();
            // Never wait on locks from the UI thread: the next publish retries a skipped display.
            let (Ok(db), Ok(runtime), Ok(panel), Ok(playback), Ok(story)) = (
                state.db.try_lock(), state.runtime.try_lock(),
                state.panel.try_lock(), state.playback.try_lock(), state.story.try_lock(),
            ) else { return; };
            if state.epoch.load(Ordering::SeqCst) != epoch || runtime.hidden || super::unavailable(&state) {
                return;
            }
            let Ok(characters) = crate::characters::collection(&db) else { return; };
            let wanted = if label == "balloon" {
                owner_id(&runtime, panel.as_ref(), story.as_ref(), playback.as_ref(), &characters.active).is_some()
            } else if let Some(id) = label.strip_prefix(BODY_PREFIX) {
                characters.active.iter().any(|active| active == id)
            } else if let Some(id) = label.strip_prefix(FACE_PREFIX) {
                characters.active.iter().any(|active| active == id)
                    && characters.installed.iter().any(|character| character.id == id
                        && has_visible_sprite(character, &characters.active, playback.as_ref())
                        && character.definition.face_icon)
            } else { false };
            if !wanted { return; }
            drop((db, runtime, panel, playback, story));
            if state.epoch.load(Ordering::SeqCst) != epoch { return; }
            let Some(window) = app.get_webview_window(&label) else { return; };
            #[cfg(target_os = "macos")]
            if let Ok(pointer) = window.ns_window() {
                unsafe {
                    let native = &*(pointer as *mut objc2::runtime::AnyObject);
                    let _: () = objc2::msg_send![native, orderFront: std::ptr::null::<objc2::runtime::AnyObject>()];
                }
            }
            #[cfg(target_os = "windows")]
            if let Ok(handle) = window.hwnd() {
                unsafe {
                    windows_sys::Win32::UI::WindowsAndMessaging::ShowWindow(
                        handle.0 as _, windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNOACTIVATE,
                    );
                }
            }
            crate::character_collision_host::did_show(&window, collision_token);
        }).map_err(|error| error.to_string())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = app;
        window.show().map_err(|error| error.to_string())?;
        crate::character_collision_host::did_show(window, collision_token);
        Ok(())
    }
}

pub(crate) fn hide_ambient(window: &WebviewWindow) -> Result<(), String> {
    crate::character_collision_host::visibility(window, false);
    #[cfg(target_os = "windows")]
    {
        window.hide().map_err(|error| error.to_string())?;
        let app = window.app_handle().clone();
        let label = window.label().to_string();
        window
            .run_on_main_thread(move || {
                let Some(window) = app.get_webview_window(&label) else {
                    return;
                };
                if let Ok(handle) = window.hwnd() {
                    unsafe {
                        windows_sys::Win32::UI::WindowsAndMessaging::ShowWindow(
                            handle.0 as _,
                            windows_sys::Win32::UI::WindowsAndMessaging::SW_HIDE,
                        );
                    }
                }
            })
            .map_err(|error| error.to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        window.hide().map_err(|error| error.to_string())
    }
}

#[derive(Clone, Copy, Debug)]
struct Rect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

fn work_area(monitor: &Monitor) -> Rect {
    let area = monitor.work_area();
    Rect {
        x: area.position.x as f64,
        y: area.position.y as f64,
        width: area.size.width as f64,
        height: area.size.height as f64,
    }
}

fn clamp_position(x: f64, y: f64, width: f64, height: f64, area: Rect) -> (f64, f64) {
    (
        x.clamp(area.x, (area.x + area.width - width).max(area.x)),
        y.clamp(area.y, (area.y + area.height - height).max(area.y)),
    )
}

fn balloon_rect(body: Rect, area: Rect, scale: f64, size: (f64, f64)) -> Rect {
    let width = (size.0.clamp(48.0, 320.0) * scale).min(area.width);
    let height = (size.1.clamp(32.0, 520.0) * scale).min(area.height);
    let gap = 8.0 * scale;
    let above = body.y - height - gap;
    let y = if above >= area.y {
        above
    } else {
        body.y + body.height + gap
    };
    let (x, y) = clamp_position(body.x + (body.width - width) / 2.0, y, width, height, area);
    Rect {
        x,
        y,
        width,
        height,
    }
}

// Positions saved before the roster existed live under the old a/b labels.
fn saved_body_position(
    state: &AppState,
    index: usize,
    label: &str,
) -> Result<Option<WindowPosition>, String> {
    let db = super::lock(&state.db)?;
    if let Some(position) = store::window_position(&db, label)? {
        return Ok(Some(position));
    }
    match ["a", "b"].get(index) {
        Some(legacy) => store::window_position(&db, legacy),
        None => Ok(None),
    }
}

struct BodySpec<'a> {
    index: usize,
    total: usize,
    id: &'a str,
    title: &'a str,
    size: (f64, f64),
    visible: bool,
}

fn create_body(app: &AppHandle, state: &AppState, spec: BodySpec) -> Result<(), String> {
    let BodySpec {
        index,
        total,
        id,
        title,
        size,
        visible,
    } = spec;
    let label = body_label(id);
    let window = tauri::WebviewWindowBuilder::new(
        app,
        &label,
        tauri::WebviewUrl::App(format!("index.html?body={id}").into()),
    )
    .title(format!("comet · {title}"))
    .inner_size(size.0, size.1)
    .min_inner_size(32.0, 32.0)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .maximizable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    .visible(false)
    .build()
    .map_err(|e| e.to_string())?;
    let monitors = window.available_monitors().map_err(|e| e.to_string())?;
    let saved = saved_body_position(state, index, &label)?;
    let saved_monitor = saved
        .as_ref()
        .filter(|p| p.x.is_finite() && p.y.is_finite())
        .and_then(|p| {
            monitors.iter().find(|monitor| {
                let position = monitor.position();
                let size = monitor.size();
                p.x >= position.x as f64
                    && p.y >= position.y as f64
                    && p.x < position.x as f64 + size.width as f64
                    && p.y < position.y as f64 + size.height as f64
            })
        });
    let primary = window.primary_monitor().map_err(|e| e.to_string())?;
    if let Some(monitor) = saved_monitor.or(primary.as_ref()).or(monitors.first()) {
        let scale = monitor.scale_factor();
        let area = work_area(monitor);
        let width = size.0 * scale;
        let height = size.1 * scale;
        let (x, y) = if saved_monitor.is_some() {
            let saved = saved.as_ref().ok_or("창 위치를 읽지 못했습니다.")?;
            clamp_position(saved.x, saved.y, width, height, area)
        } else {
            let offset = 24.0 + 180.0 * total.saturating_sub(index + 1) as f64;
            clamp_position(
                area.x + area.width - width - offset * scale,
                area.y + area.height - height - 12.0 * scale,
                width,
                height,
                area,
            )
        };
        window
            .set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32))
            .map_err(|e| e.to_string())?;
    }
    if visible {
        show_passive(app, &window)?;
    }
    Ok(())
}

pub(crate) fn create_boxes(app: &AppHandle, state: &AppState) -> Result<(), String> {
    reconcile(app, state, &super::snapshot(state)?)
}

fn character_by_id<'a>(snapshot: &'a Snapshot, id: &str) -> Option<&'a InstalledCharacter> {
    snapshot
        .characters
        .installed
        .iter()
        .find(|character| character.id == id)
}

fn has_visible_sprite(
    character: &InstalledCharacter,
    active: &[String],
    playback: Option<&crate::types::Playback>,
) -> bool {
    if character
        .definition
        .animation
        .as_ref()
        .is_some_and(|animation| !animation.clips.is_empty())
    {
        return true;
    }
    let expression = playback
        .filter(|line| {
            let speaker = active.iter().find(|id| **id == line.persona).or_else(|| {
                crate::characters::slot_index(&line.persona)
                    .ok()
                    .and_then(|index| active.get(index))
            });
            speaker.is_some_and(|id| *id == character.id)
        })
        .map(|line| line.expression.as_str())
        .filter(|expression| character.definition.expressions.contains_key(*expression))
        .unwrap_or(crate::characters::DEFAULT_EXPRESSION);
    character.sprites.contains_key(expression)
        || character
            .sprites
            .contains_key(crate::characters::DEFAULT_EXPRESSION)
}

fn body_size(snapshot: &Snapshot, character: Option<&InstalledCharacter>) -> (f64, f64) {
    match character {
        Some(character)
            if has_visible_sprite(
                character,
                &snapshot.characters.active,
                snapshot.playback.as_ref(),
            ) =>
        {
            let side = f64::from(character.definition.sprite_size) + SPRITE_PADDING;
            (side, side)
        }
        _ => BODY_SIZE,
    }
}

fn face_wanted(snapshot: &Snapshot, character: Option<&InstalledCharacter>) -> bool {
    !snapshot.runtime.hidden
        && character.is_some_and(|character| {
            character.definition.face_icon
                && has_visible_sprite(
                    character,
                    &snapshot.characters.active,
                    snapshot.playback.as_ref(),
                )
        })
}

fn set_logical_size(window: &WebviewWindow, (width, height): (f64, f64)) -> Result<(), String> {
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let target = PhysicalSize::new(
        (width * scale).round() as u32,
        (height * scale).round() as u32,
    );
    if window.inner_size().map_err(|e| e.to_string())? != target {
        window.set_size(target).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn create_face(app: &AppHandle, id: &str, title: &str) -> Result<(), String> {
    let label = face_label(id);
    let body = app
        .get_webview_window(&body_label(id))
        .ok_or("캐릭터 창이 없습니다.")?;
    let window = tauri::WebviewWindowBuilder::new(
        app,
        &label,
        tauri::WebviewUrl::App(format!("index.html?face={id}").into()),
    )
    .title(format!("comet · {title} 표정"))
    .inner_size(FACE_SIZE.0, FACE_SIZE.1)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .maximizable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    .visible(false)
    .build()
    .map_err(|e| e.to_string())?;
    let state = app.state::<Arc<AppState>>();
    let saved = store::window_position(&*super::lock(&state.db)?, &label)?;
    let monitor = body
        .current_monitor()
        .map_err(|e| e.to_string())?
        .or(body.primary_monitor().map_err(|e| e.to_string())?)
        .ok_or("화면 영역을 확인할 수 없습니다.")?;
    let scale = monitor.scale_factor();
    let area = work_area(&monitor);
    let (width, height) = (FACE_SIZE.0 * scale, FACE_SIZE.1 * scale);
    let (x, y) = match saved.filter(|p| p.x.is_finite() && p.y.is_finite()) {
        Some(saved) => clamp_position(saved.x, saved.y, width, height, area),
        None => {
            let position = body.outer_position().map_err(|e| e.to_string())?;
            let size = body.outer_size().map_err(|e| e.to_string())?;
            clamp_position(
                position.x as f64 + size.width as f64 + 4.0 * scale,
                position.y as f64 + (size.height as f64 - height) / 2.0,
                width,
                height,
                area,
            )
        }
    };
    window
        .set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32))
        .map_err(|e| e.to_string())?;
    show_passive(app, &window)
}

// One body window per roster member, sized to its sprite, with the detached expression tag only
// when the character asks for one. Windows of characters that left the roster are destroyed.
fn reconcile(app: &AppHandle, state: &AppState, snapshot: &Snapshot) -> Result<(), String> {
    let roster = &snapshot.characters.active;
    for (index, id) in roster.iter().enumerate() {
        let character = character_by_id(snapshot, id);
        let title = character.map_or(id.as_str(), |character| character.definition.name.as_str());
        let size = body_size(snapshot, character);
        match app.get_webview_window(&body_label(id)) {
            Some(window) => {
                set_logical_size(&window, size)?;
                if !snapshot.runtime.hidden {
                    show_passive(app, &window)?;
                }
            }
            None => create_body(
                app,
                state,
                BodySpec {
                    index,
                    total: roster.len(),
                    id,
                    title,
                    size,
                    visible: !snapshot.runtime.hidden,
                },
            )?,
        }
        match (
            app.get_webview_window(&face_label(id)),
            face_wanted(snapshot, character),
        ) {
            (Some(window), true) => {
                let _ = show_passive(app, &window);
            }
            (Some(window), false) => {
                let _ = hide_ambient(&window);
            }
            (None, true) => {
                let _ = create_face(app, id, title);
            }
            (None, false) => {}
        }
    }
    for (label, window) in app.webview_windows() {
        let id = label
            .strip_prefix(BODY_PREFIX)
            .or_else(|| label.strip_prefix(FACE_PREFIX));
        if id.is_some_and(|id| !roster.iter().any(|active| active == id)) {
            crate::character_collision_host::remove(app, &label);
            let _ = window.destroy();
        }
    }
    Ok(())
}

pub(crate) fn sync_boxes(app: &AppHandle, state: &AppState, snapshot: &Snapshot) {
    let _ = reconcile(app, state, snapshot);
}

fn owner(snapshot: &Snapshot) -> Option<&str> {
    owner_id(
        &snapshot.runtime,
        snapshot.panel.as_ref(),
        snapshot.story.as_ref(),
        snapshot.playback.as_ref(),
        &snapshot.characters.active,
    )
}

fn owner_id<'a>(
    runtime: &crate::types::RuntimeStatus,
    panel: Option<&crate::types::PanelState>,
    story: Option<&crate::story::Request>,
    playback: Option<&crate::types::Playback>,
    active: &'a [String],
) -> Option<&'a str> {
    if runtime.hidden {
        return None;
    }
    panel
        .map(|panel| panel.persona.as_str())
        .or_else(|| story.map(|story| story.persona.as_str()))
        .or_else(|| playback.map(|playback| playback.persona.as_str()))
        .or_else(|| {
            if ["loading", "generating", "error"].contains(&runtime.phase.as_str()) {
                runtime.persona.as_deref()
            } else {
                None
            }
        })
        .and_then(|persona| match persona {
            "a" => active.first(),
            "b" => active.get(1),
            id => active.iter().find(|active| active.as_str() == id),
        })
        .map(String::as_str)
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct BalloonTarget {
    key: String,
    owner: String,
    epoch: u64,
}

fn balloon_target(
    runtime: &crate::types::RuntimeStatus,
    panel: Option<&crate::types::PanelState>,
    story: Option<&crate::story::Request>,
    playback: Option<&crate::types::Playback>,
    active: &[String],
    epoch: u64,
) -> Option<BalloonTarget> {
    let owner = owner_id(runtime, panel, story, playback, active)?.to_owned();
    let key = if let Some(panel) = panel {
        format!("panel:{}:{}", panel.persona, panel.mode)
    } else if let Some(story) = story {
        format!("story:{}", story.id)
    } else if let Some(playback) = playback {
        format!("playback:{}", playback.id)
    } else {
        format!(
            "runtime:{}:{}",
            runtime.phase.as_str(),
            runtime.persona.as_deref().unwrap_or_default()
        )
    };
    Some(BalloonTarget { key, owner, epoch })
}

#[derive(Default)]
struct BalloonLayout {
    target: Option<BalloonTarget>,
    size: Option<(f64, f64)>,
}

impl BalloonLayout {
    fn sync(&mut self, target: Option<BalloonTarget>) -> Option<(f64, f64)> {
        let same_content =
            self.target
                .as_ref()
                .zip(target.as_ref())
                .is_some_and(|(previous, current)| {
                    previous.key == current.key && previous.owner == current.owner
                });
        if !same_content {
            self.size = None;
        }
        self.target = target;
        self.size
    }

    fn measured(&mut self, target: BalloonTarget, key: &str, size: (f64, f64)) -> bool {
        if target.key != key {
            return false;
        }
        self.sync(Some(target));
        self.size = Some(size);
        true
    }
}

fn balloon_layout(app: &AppHandle) -> tauri::State<'_, Mutex<BalloonLayout>> {
    if app.try_state::<Mutex<BalloonLayout>>().is_none() {
        app.manage(Mutex::new(BalloonLayout::default()));
    }
    app.state::<Mutex<BalloonLayout>>()
}

fn measured_balloon_size(width: f64, height: f64) -> Result<(f64, f64), String> {
    if !width.is_finite() || !height.is_finite() {
        return Err("말풍선 크기가 올바르지 않습니다.".into());
    }
    Ok((width.clamp(48.0, 320.0), height.clamp(32.0, 520.0)))
}

fn get_balloon(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window("balloon") {
        return Ok(window);
    }
    tauri::WebviewWindowBuilder::new(
        app,
        "balloon",
        tauri::WebviewUrl::App("index.html?view=balloon".into()),
    )
    .title("comet · 말풍선")
    .inner_size(320.0, 180.0)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .maximizable(false)
    .always_on_top(true)
    .focused(false)
    .resizable(false)
    .skip_taskbar(true)
    .visible(false)
    .build()
    .map_err(|e| e.to_string())
}

fn position_balloon(
    app: &AppHandle,
    window: &WebviewWindow,
    id: &str,
    size: (f64, f64),
) -> Result<(), String> {
    let body = app
        .get_webview_window(&body_label(id))
        .ok_or("캐릭터 창이 없습니다.")?;
    let monitor = body
        .current_monitor()
        .map_err(|e| e.to_string())?
        .or(body.primary_monitor().map_err(|e| e.to_string())?)
        .ok_or("화면 영역을 확인할 수 없습니다.")?;
    let position = body.outer_position().map_err(|e| e.to_string())?;
    let body_size = body.outer_size().map_err(|e| e.to_string())?;
    let rect = balloon_rect(
        Rect {
            x: position.x as f64,
            y: position.y as f64,
            width: body_size.width as f64,
            height: body_size.height as f64,
        },
        work_area(&monitor),
        monitor.scale_factor(),
        size,
    );
    window
        .set_position(PhysicalPosition::new(
            rect.x.round() as i32,
            rect.y.round() as i32,
        ))
        .map_err(|e| e.to_string())?;
    window
        .set_size(PhysicalSize::new(
            rect.width.round() as u32,
            rect.height.round() as u32,
        ))
        .map_err(|e| e.to_string())
}

fn apply_measured_balloon(app: &AppHandle) -> Result<bool, String> {
    let state = app.state::<Arc<AppState>>();
    // A worker may be waiting on this thread, so retry contended state without blocking the UI.
    let Ok(_action) = state.action.try_lock() else {
        return Ok(false);
    };
    let (Ok(db), Ok(runtime), Ok(panel), Ok(mut playback), Ok(mut story)) = (
        state.db.try_lock(),
        state.runtime.try_lock(),
        state.panel.try_lock(),
        state.playback.try_lock(),
        state.story.try_lock(),
    ) else {
        return Ok(false);
    };
    let characters = crate::characters::collection(&db)?;
    let target = if super::unavailable(&state) {
        None
    } else {
        balloon_target(
            &runtime,
            panel.as_ref(),
            story.as_ref(),
            playback.as_ref(),
            &characters.active,
            state.epoch.load(Ordering::SeqCst),
        )
    };
    let focus_panel = panel.is_some();
    drop((runtime, panel));
    let layout = balloon_layout(app);
    let Ok(mut layout) = layout.try_lock() else {
        return Ok(false);
    };
    let size = layout.sync(target.clone());
    drop(layout);
    let Some(window) = app.get_webview_window("balloon") else {
        return Ok(true);
    };
    let (Some(target), Some(size)) = (target, size) else {
        window.hide().map_err(|error| error.to_string())?;
        #[cfg(target_os = "windows")]
        if let Ok(handle) = window.hwnd() {
            unsafe {
                windows_sys::Win32::UI::WindowsAndMessaging::ShowWindow(
                    handle.0 as _,
                    windows_sys::Win32::UI::WindowsAndMessaging::SW_HIDE,
                );
            }
        }
        return Ok(true);
    };
    let was_visible = window.is_visible().unwrap_or(false);
    position_balloon(app, &window, &target.owner, size)?;
    #[cfg(target_os = "macos")]
    {
        let pointer = window.ns_window().map_err(|error| error.to_string())?;
        unsafe {
            let native = &*(pointer as *mut objc2::runtime::AnyObject);
            let _: () =
                objc2::msg_send![native, orderFront: std::ptr::null::<objc2::runtime::AnyObject>()];
        }
    }
    #[cfg(target_os = "windows")]
    {
        let handle = window.hwnd().map_err(|error| error.to_string())?;
        unsafe {
            windows_sys::Win32::UI::WindowsAndMessaging::ShowWindow(
                handle.0 as _,
                windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNOACTIVATE,
            );
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    window.show().map_err(|error| error.to_string())?;
    if focus_panel && !was_visible {
        window.set_focus().map_err(|error| error.to_string())?;
    }
    let mut first_display = false;
    let mut displayed_message = None;
    if let Some(line) = playback.as_mut() {
        if target.key == format!("playback:{}", line.id) {
            first_display =
                crate::app::scene::mark_line_displayed(line, chrono::Utc::now().timestamp_millis());
            if first_display {
                displayed_message = Some(line.id.clone());
            }
        }
    }
    if let Some(request) = story.as_mut() {
        if target.key == format!("story:{}", request.id) && request.display_started_at.is_none() {
            request.display_started_at = Some(chrono::Utc::now().timestamp_millis());
            first_display = true;
        }
    }
    drop((playback, story));
    if let Some(id) = displayed_message {
        store::mark_message_displayed(&db, &id, chrono::Utc::now().timestamp_millis())?;
    }
    drop((db, _action));
    if first_display {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let state = app.state::<Arc<AppState>>();
            super::publish(&app, &state);
        });
    }
    Ok(true)
}

fn sync_measured_balloon(
    app: &AppHandle,
) -> Result<tokio::sync::oneshot::Receiver<Result<bool, String>>, String> {
    let (send, receive) = tokio::sync::oneshot::channel();
    let app = app.clone();
    let scheduler = app.clone();
    scheduler
        .run_on_main_thread(move || {
            let _ = send.send(apply_measured_balloon(&app));
        })
        .map_err(|error| error.to_string())?;
    Ok(receive)
}

async fn await_balloon_sync(
    app: &AppHandle,
    mut pending: tokio::sync::oneshot::Receiver<Result<bool, String>>,
) -> Result<(), String> {
    for attempt in 0..50 {
        if pending.await.map_err(|error| error.to_string())?? {
            return Ok(());
        }
        if attempt == 49 {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        pending = sync_measured_balloon(app)?;
    }
    Err("말풍선 크기 반영을 기다리지 못했습니다.".into())
}

pub(crate) fn sync_balloon(app: &AppHandle, snapshot: &Snapshot) {
    let _ = balloon_layout(app);
    if owner(snapshot).is_some() && get_balloon(app).is_err() {
        return;
    }
    if let Ok(pending) = sync_measured_balloon(app) {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let _ = await_balloon_sync(&app, pending).await;
        });
    }
}

pub(crate) async fn resize_balloon(
    app: &AppHandle,
    width: f64,
    height: f64,
    content_key: &str,
) -> Result<(), String> {
    let size = measured_balloon_size(width, height)?;
    let state = app.state::<Arc<AppState>>();
    {
        let _action = super::lock(&state.action)?;
        if super::unavailable(&state) {
            return Ok(());
        }
        let snapshot = super::snapshot(&state)?;
        let Some(target) = balloon_target(
            &snapshot.runtime,
            snapshot.panel.as_ref(),
            snapshot.story.as_ref(),
            snapshot.playback.as_ref(),
            &snapshot.characters.active,
            state.epoch.load(Ordering::SeqCst),
        ) else {
            return Ok(());
        };
        if !super::lock(&balloon_layout(app))?.measured(target, content_key, size) {
            return Ok(());
        }
    }
    await_balloon_sync(app, sync_measured_balloon(app)?).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_body_and_face_follow_the_displayed_expression() {
        let mut data = crate::app::snapshot(&crate::app::tests::state()).unwrap();
        let character = &mut data.characters.installed[0];
        character.definition.face_icon = true;
        character.definition.sprite_size = 32;
        character.sprites.insert(
            "기쁨".into(),
            crate::character_sprites::SpriteInfo {
                mime: "image/png".into(),
                updated_at: 1,
            },
        );
        let id = character.id.clone();
        assert_eq!(body_size(&data, character_by_id(&data, &id)), BODY_SIZE);
        assert!(!face_wanted(&data, character_by_id(&data, &id)));

        data.playback = Some(crate::types::Playback {
            id: "expression-test".into(),
            persona: id.clone(),
            expression: "기쁨".into(),
            text: "안녕".into(),
            source: "script".into(),
            ends_at: 1,
            text_speed: 0,
            display_started_at: None,
            line_index: 0,
            line_count: 1,
        });
        for persona in [id.as_str(), "a"] {
            data.playback.as_mut().unwrap().persona = persona.into();
            assert_eq!(body_size(&data, character_by_id(&data, &id)), (40.0, 40.0));
            assert!(face_wanted(&data, character_by_id(&data, &id)));
        }
        data.runtime.hidden = true;
        assert!(!face_wanted(&data, character_by_id(&data, &id)));
        data.runtime.hidden = false;
        data.playback.as_mut().unwrap().persona = "b".into();
        assert_eq!(body_size(&data, character_by_id(&data, &id)), BODY_SIZE);
        assert!(!face_wanted(&data, character_by_id(&data, &id)));
        data.playback = None;
        assert_eq!(body_size(&data, character_by_id(&data, &id)), BODY_SIZE);
        assert!(!face_wanted(&data, character_by_id(&data, &id)));
    }

    #[test]
    fn native_sprite_fallback_ignores_balloon_and_undeclared_expressions() {
        let mut data = crate::app::snapshot(&crate::app::tests::state()).unwrap();
        let character = &mut data.characters.installed[0];
        character.definition.face_icon = true;
        character.definition.sprite_size = 128;
        let sprite = crate::character_sprites::SpriteInfo {
            mime: "image/png".into(),
            updated_at: 1,
        };
        character.sprites.insert("$balloon".into(), sprite.clone());
        character.sprites.insert("미등록".into(), sprite.clone());
        let id = character.id.clone();
        data.playback = Some(crate::types::Playback {
            id: "fallback-test".into(),
            persona: id.clone(),
            expression: "미등록".into(),
            text: "안녕".into(),
            source: "script".into(),
            ends_at: 1,
            text_speed: 0,
            display_started_at: None,
            line_index: 0,
            line_count: 1,
        });
        assert_eq!(body_size(&data, character_by_id(&data, &id)), BODY_SIZE);
        assert!(!face_wanted(&data, character_by_id(&data, &id)));
        data.characters.installed[0]
            .sprites
            .insert("평온".into(), sprite);
        assert_eq!(
            body_size(&data, character_by_id(&data, &id)),
            (136.0, 136.0)
        );
        assert!(face_wanted(&data, character_by_id(&data, &id)));
        data.playback = None;
        assert_eq!(
            body_size(&data, character_by_id(&data, &id)),
            (136.0, 136.0)
        );
    }

    #[test]
    fn pending_story_owns_native_balloon_and_interruption_removes_it() {
        let state = crate::app::tests::state();
        let (request, character_id) = {
            let db = crate::app::lock(&state.db).unwrap();
            let imported =
                crate::characters::import_pack(&db, &crate::characters::nadir_pack()).unwrap();
            crate::characters::apply_pair(&db, [imported[0].id.clone(), imported[1].id.clone()])
                .unwrap();
            (
                crate::story::prepare(&db, "a", 0, 0).unwrap().unwrap(),
                imported[0].id.clone(),
            )
        };
        *crate::app::lock(&state.story).unwrap() = Some(request);
        crate::app::lock(&state.runtime).unwrap().phase = crate::types::RuntimePhase::Story;
        assert!(crate::app::lock(&state.playback).unwrap().is_none());
        assert_eq!(
            owner(&crate::app::snapshot(&state).unwrap()),
            Some(character_id.as_str())
        );
        crate::app::lock(&state.runtime).unwrap().hidden = true;
        assert_eq!(owner(&crate::app::snapshot(&state).unwrap()), None);
        crate::app::lock(&state.runtime).unwrap().hidden = false;
        crate::app::interrupt(&state, false).unwrap();
        assert_eq!(owner(&crate::app::snapshot(&state).unwrap()), None);
    }

    #[test]
    fn ambient_balloon_visibility_uses_current_owner_and_hidden_state() {
        let mut runtime = crate::types::RuntimeStatus::default();
        let panel = crate::types::PanelState {
            persona: "b".into(),
            mode: "input".into(),
        };
        let roster = vec!["first".into(), "second".into()];
        assert_eq!(
            owner_id(&runtime, Some(&panel), None, None, &roster),
            Some("second")
        );
        runtime.hidden = true;
        assert_eq!(owner_id(&runtime, Some(&panel), None, None, &roster), None);
        runtime.hidden = false;
        assert_eq!(owner_id(&runtime, None, None, None, &roster), None);
        assert_eq!(
            owner_id(&runtime, Some(&panel), None, None, &roster[..1]),
            None
        );
    }

    #[test]
    fn balloon_waits_for_current_content_measurement_and_keeps_size_while_moving() {
        let mut layout = BalloonLayout::default();
        let first = BalloonTarget {
            key: "playback:first".into(),
            owner: "one".into(),
            epoch: 1,
        };
        let second = BalloonTarget {
            key: "playback:second".into(),
            ..first.clone()
        };
        assert_eq!(layout.sync(Some(first.clone())), None);
        assert!(layout.measured(first.clone(), &first.key, (108.0, 56.0)));
        assert_eq!(layout.sync(Some(first.clone())), Some((108.0, 56.0)));
        assert_eq!(layout.sync(Some(second.clone())), None);
        assert!(!layout.measured(second.clone(), &first.key, (320.0, 180.0)));
        assert_eq!(layout.sync(Some(second.clone())), None);
        assert!(layout.measured(second.clone(), &second.key, (212.0, 93.0)));
        assert_eq!(layout.sync(Some(second)), Some((212.0, 93.0)));
        assert_eq!(layout.sync(None), None);
        assert_eq!(layout.sync(Some(first.clone())), None);
        assert!(layout.measured(first.clone(), &first.key, (108.0, 56.0)));
        let restarted = BalloonTarget { epoch: 2, ..first };
        assert_eq!(layout.sync(Some(restarted.clone())), Some((108.0, 56.0)));
        assert_eq!(layout.target.as_ref().unwrap().epoch, 2);
        assert_eq!(
            layout.sync(Some(BalloonTarget {
                owner: "two".into(),
                ..restarted
            })),
            None
        );
    }

    #[test]
    fn balloon_keys_follow_panel_story_playback_and_runtime_ownership() {
        let state = crate::app::tests::state();
        let mut data = crate::app::snapshot(&state).unwrap();
        let id = data.characters.active[0].clone();
        let target = |data: &Snapshot| {
            balloon_target(
                &data.runtime,
                data.panel.as_ref(),
                data.story.as_ref(),
                data.playback.as_ref(),
                &data.characters.active,
                7,
            )
        };
        assert_eq!(target(&data), None);
        data.runtime.phase = crate::types::RuntimePhase::Generating;
        data.runtime.persona = Some(id.clone());
        assert_eq!(
            target(&data).unwrap().key,
            format!("runtime:generating:{id}")
        );
        data.playback = Some(crate::types::Playback {
            id: "line-1".into(),
            persona: id.clone(),
            expression: "평온".into(),
            text: "안녕".into(),
            source: "script".into(),
            ends_at: 1,
            text_speed: 0,
            display_started_at: None,
            line_index: 0,
            line_count: 1,
        });
        assert_eq!(target(&data).unwrap().key, "playback:line-1");
        data.story = Some(crate::story::Request {
            id: "story-1".into(),
            user_id: "legacy-user".into(),
            display_started_at: None,
            persona: id.clone(),
            title: "제목".into(),
            prompt: "본문".into(),
            choices: vec![],
            character_id: id.clone(),
            epoch: 7,
            scene: crate::story::Scene {
                id: "scene-1".into(),
                chapter: 1,
                title: "제목".into(),
                prompt: "본문".into(),
                choices: vec![],
            },
        });
        assert_eq!(target(&data).unwrap().key, "story:story-1");
        data.panel = Some(crate::types::PanelState {
            persona: "a".into(),
            mode: "input".into(),
        });
        assert_eq!(target(&data).unwrap().key, "panel:a:input");
        assert_eq!(target(&data).unwrap().owner, id);
        data.runtime.hidden = true;
        assert_eq!(target(&data), None);
    }

    #[test]
    fn reopening_the_visible_panel_keeps_its_measurement_but_closing_invalidates_it() {
        let mut layout = BalloonLayout::default();
        let panel = BalloonTarget {
            key: "panel:a:input".into(),
            owner: "one".into(),
            epoch: 1,
        };
        assert!(layout.measured(panel.clone(), &panel.key, (320.0, 240.0)));
        let reopened = BalloonTarget { epoch: 2, ..panel };
        assert_eq!(layout.sync(Some(reopened.clone())), Some((320.0, 240.0)));
        assert_eq!(layout.target.as_ref().unwrap().epoch, 2);
        assert_eq!(layout.sync(None), None);
        assert_eq!(layout.sync(Some(reopened)), None);
    }

    #[test]
    fn balloon_measurements_reject_nonfinite_dimensions_and_clamp_both_axes() {
        for invalid in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            assert!(measured_balloon_size(invalid, 50.0).is_err());
            assert!(measured_balloon_size(100.0, invalid).is_err());
        }
        assert_eq!(measured_balloon_size(-10.0, 0.0).unwrap(), (48.0, 32.0));
        assert_eq!(
            measured_balloon_size(1000.0, 1000.0).unwrap(),
            (320.0, 520.0)
        );
        assert_eq!(measured_balloon_size(82.5, 39.5).unwrap(), (82.5, 39.5));
    }

    #[test]
    fn balloon_stays_in_work_area_across_scale_and_screen_edges() {
        for (area, scale) in [
            (
                Rect {
                    x: 0.0,
                    y: 28.0,
                    width: 1440.0,
                    height: 840.0,
                },
                1.0,
            ),
            (
                Rect {
                    x: -2560.0,
                    y: 50.0,
                    width: 2560.0,
                    height: 1390.0,
                },
                2.0,
            ),
        ] {
            for (x, y) in [
                (area.x, area.y),
                (
                    area.x + area.width - 112.0 * scale,
                    area.y + area.height - 88.0 * scale,
                ),
            ] {
                let body = Rect {
                    x,
                    y,
                    width: 112.0 * scale,
                    height: 88.0 * scale,
                };
                let bubble = balloon_rect(body, area, scale, (126.0, 180.0));
                assert_eq!(bubble.width, 126.0 * scale);
                assert!(bubble.x >= area.x && bubble.y >= area.y);
                assert!(bubble.x + bubble.width <= area.x + area.width);
                assert!(bubble.y + bubble.height <= area.y + area.height);
                if y == area.y {
                    assert_eq!(bubble.y, y + body.height + 8.0 * scale);
                } else {
                    assert_eq!(bubble.y + bubble.height + 8.0 * scale, y);
                }
            }
        }
    }

    #[test]
    fn clamps_height_to_small_screen_and_body_to_bounds() {
        let area = Rect {
            x: -500.0,
            y: 20.0,
            width: 500.0,
            height: 400.0,
        };
        let bubble = balloon_rect(
            Rect {
                x: -490.0,
                y: 25.0,
                width: 224.0,
                height: 176.0,
            },
            area,
            2.0,
            (900.0, 900.0),
        );
        assert_eq!(bubble.height, 400.0);
        assert_eq!((bubble.x, bubble.y), (-500.0, 20.0));
        assert_eq!(
            clamp_position(-40.0, 410.0, 112.0, 88.0, area),
            (-112.0, 332.0)
        );
    }
}
