use crate::{
    characters::InstalledCharacter,
    store,
    types::{Snapshot, WindowPosition},
    AppState,
};
use std::sync::{atomic::Ordering, Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, Monitor, PhysicalPosition, PhysicalSize, WebviewWindow};

#[derive(Clone, Copy, Debug, PartialEq, serde::Deserialize, serde::Serialize)]
pub(crate) struct OrbitAnchor {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum BalloonSurface {
    Input,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BalloonPlacement {
    orbit_anchor: Option<OrbitAnchor>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct BalloonAnchorEvent<'a> {
    content_key: &'a str,
    orbit_anchor: Option<OrbitAnchor>,
}

const BODY_SIZE: (f64, f64) = (112.0, 88.0);
const CONVERSATION_CHARACTER_ANCHOR_X: f64 = 76.0;
const SPRITE_PADDING: f64 = 8.0;
const FACE_SIZE: (f64, f64) = (120.0, 36.0);
const ORBIT_MAX_SIZE: (f64, f64) = (640.0, 600.0);
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
    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    {
        use std::sync::atomic::Ordering;
        let state = app.state::<Arc<AppState>>();
        let epoch = state.epoch.load(Ordering::SeqCst);
        let app = app.clone();
        let label = window.label().to_string();
        let identity = crate::character_reaction_host::window_identity(window);
        window.run_on_main_thread(move || {
            let state = app.state::<Arc<AppState>>();
            let Some(window) = app.get_webview_window(&label).filter(|window| crate::character_reaction_host::window_identity(window) == identity) else { return; };
            // Never wait on locks from the UI thread: the next publish retries a skipped display.
            let (Ok(db), Ok(runtime), Ok(panel), Ok(playback), Ok(story), Ok(presence), Ok(guests)) = (
                state.db.try_lock(), state.runtime.try_lock(),
                state.panel.try_lock(), state.playback.try_lock(), state.story.try_lock(), state.presence.try_lock(), state.guests.try_lock(),
            ) else { return; };
            if !passive_show_current(&state, epoch, runtime.hidden) {
                return;
            }
            if (is_body(&label) || is_face(&label)) && !crate::character_guests::window_current_locked(&guests, &label, identity) { return; }
            let Ok(characters) = crate::characters::collection(&db) else { return; };
            let mut status = runtime.clone();
            let Ok(active) = crate::character_guests::display_ids_locked(&state, &db, &guests, runtime.hidden) else { return; };
            status.guest_character_ids = active.iter().filter(|id| !characters.active.contains(id)).cloned().collect();
            let present = active.iter().filter(|id| !characters.active.contains(id) || presence.contains(id)).cloned().collect::<Vec<_>>();
            let wanted = if label == "balloon" {
                owner_id(&status, panel.as_ref(), story.as_ref(), playback.as_ref(), &active)
                    .is_some_and(|id| present.iter().any(|current| current == id))
            } else if let Some(id) = label.strip_prefix(BODY_PREFIX) {
                present.iter().any(|current| current == id) && active.iter().any(|active| active == id)
            } else if let Some(id) = label.strip_prefix(FACE_PREFIX) {
                present.iter().any(|current| current == id) && active.iter().any(|active| active == id)
                    && characters.installed.iter().any(|character| character.id == id
                        && has_visible_sprite(character, &active, playback.as_ref())
                        && character.definition.face_icon)
            } else { false };
            if !wanted { return; }
            drop((db, runtime, panel, playback, story, presence, guests));
            if state.epoch.load(Ordering::SeqCst) != epoch { return; }
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
            #[cfg(target_os = "linux")]
            if show_linux_passive(&window).is_err() {
                return;
            }
            crate::character_collision_host::did_show(&window, collision_token);
        }).map_err(|error| error.to_string())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let _ = app;
        window.show().map_err(|error| error.to_string())?;
        crate::character_collision_host::did_show(window, collision_token);
        Ok(())
    }
}

fn passive_show_current(state: &AppState, epoch: u64, hidden: bool) -> bool {
    state.epoch.load(Ordering::SeqCst) == epoch && !hidden && !super::unavailable(state)
}

// Run only on the GTK/UI thread. `focused(false)` suppresses focus for the first
// draw only; Tao restores accept-focus afterwards. Every later ambient remap
// must retain GTK's no-focus-on-map hint, while explicit clicks/input can focus.
#[cfg(target_os = "linux")]
fn show_linux_passive(window: &WebviewWindow) -> Result<(), String> {
    use gtk::prelude::{GtkWindowExt, WidgetExt};
    let native = window.gtk_window().map_err(|error| error.to_string())?;
    native.set_focus_on_map(false);
    let layout = linux_ambient_layout(window.app_handle());
    let (size, placement) = {
        let layout = layout
            .try_lock()
            .map_err(|_| "창 위치를 다시 확인할게요.")?;
        (
            layout
                .0
                .get(window.label())
                .map(|placement| placement.logical_rect()),
            layout.remap(window.label(), native.is_visible()),
        )
    };
    if let Some(rect) = size {
        // GtkWindow substitutes a 200px natural size for an empty WebKit
        // requisition, then fixes min=max for non-resizable windows. An explicit
        // widget size request disables that fallback; default_size/resize alone
        // cannot. Keep it current when an already-visible body changes size.
        native.set_size_request(rect.width.round() as i32, rect.height.round() as i32);
    }
    if let Some(placement) = placement {
        let rect = placement.logical_rect();
        // Keep move/size/map on the same GTK turn. Tao queues setters and
        // its pre-ConfigureNotify outer-size cache can still be zero.
        native.set_default_size(rect.width.round() as i32, rect.height.round() as i32);
        native.resize(rect.width.round() as i32, rect.height.round() as i32);
        native.move_(rect.x.round() as i32, rect.y.round() as i32);
    }
    native.show_all();
    Ok(())
}

pub(crate) fn hide_ambient(window: &WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    let _ = remember_linux_visible_rect(window);
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

#[derive(Clone, Copy, Debug, PartialEq)]
struct Rect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[cfg(target_os = "linux")]
#[derive(Default)]
struct LinuxAmbientLayout(std::collections::HashMap<String, LinuxPlacement>);

#[cfg(target_os = "linux")]
#[derive(Clone, Copy, Debug, PartialEq)]
struct LinuxPlacement {
    rect: Rect,
    scale: f64,
}

#[cfg(target_os = "linux")]
impl LinuxPlacement {
    fn logical_rect(self) -> Rect {
        Rect {
            x: self.rect.x / self.scale,
            y: self.rect.y / self.scale,
            width: self.rect.width / self.scale,
            height: self.rect.height / self.scale,
        }
    }
}

#[cfg(target_os = "linux")]
impl LinuxAmbientLayout {
    fn remember(&mut self, label: &str, rect: Rect, scale: f64) {
        if (is_body(label) || is_face(label))
            && [rect.x, rect.y, rect.width, rect.height]
                .into_iter()
                .all(f64::is_finite)
            && rect.width > 0.0
            && rect.height > 0.0
            && scale.is_finite()
            && scale > 0.0
        {
            self.0.insert(label.into(), LinuxPlacement { rect, scale });
        }
    }

    fn remap(&self, label: &str, visible: bool) -> Option<LinuxPlacement> {
        (!visible).then(|| self.0.get(label).copied()).flatten()
    }

    fn body_bounds(&self, label: &str, observed: Rect, just_created: bool) -> Rect {
        if !just_created && observed.width > 0.0 && observed.height > 0.0 {
            observed
        } else {
            self.0
                .get(label)
                .map(|placement| placement.rect)
                .unwrap_or(observed)
        }
    }
}

#[cfg(target_os = "linux")]
fn linux_ambient_layout(app: &AppHandle) -> tauri::State<'_, Mutex<LinuxAmbientLayout>> {
    if app.try_state::<Mutex<LinuxAmbientLayout>>().is_none() {
        app.manage(Mutex::new(LinuxAmbientLayout::default()));
    }
    app.state::<Mutex<LinuxAmbientLayout>>()
}

#[cfg(target_os = "linux")]
fn remember_linux_rect(window: &WebviewWindow, rect: Rect, scale: f64) -> Result<(), String> {
    super::lock(&linux_ambient_layout(window.app_handle()))?.remember(window.label(), rect, scale);
    Ok(())
}

#[cfg(target_os = "linux")]
fn remember_linux_visible_rect(window: &WebviewWindow) -> Result<(), String> {
    if (is_body(window.label()) || is_face(window.label())) && window.is_visible().unwrap_or(false)
    {
        let position = window.outer_position().map_err(|error| error.to_string())?;
        let size = window.outer_size().map_err(|error| error.to_string())?;
        remember_linux_rect(
            window,
            Rect {
                x: position.x as f64,
                y: position.y as f64,
                width: size.width as f64,
                height: size.height as f64,
            },
            window.scale_factor().map_err(|error| error.to_string())?,
        )?;
    }
    Ok(())
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

fn monitor_bounds(monitor: &Monitor) -> Rect {
    let position = monitor.position();
    let size = monitor.size();
    Rect {
        x: position.x as f64,
        y: position.y as f64,
        width: size.width as f64,
        height: size.height as f64,
    }
}

fn monitor_at_saved_position<'a, T>(
    monitors: &'a [T],
    saved: Option<&WindowPosition>,
    bounds: impl Fn(&T) -> Rect,
) -> Option<&'a T> {
    let saved = saved.filter(|position| position.x.is_finite() && position.y.is_finite())?;
    monitors.iter().find(|monitor| {
        let area = bounds(monitor);
        saved.x >= area.x
            && saved.y >= area.y
            && saved.x < area.x + area.width
            && saved.y < area.y + area.height
    })
}

fn clamp_position(x: f64, y: f64, width: f64, height: f64, area: Rect) -> (f64, f64) {
    (
        x.clamp(area.x, (area.x + area.width - width).max(area.x)),
        y.clamp(area.y, (area.y + area.height - height).max(area.y)),
    )
}

fn balloon_rect(body: Rect, area: Rect, scale: f64, size: (f64, f64)) -> Rect {
    let width = (size.0.clamp(48.0, 340.0) * scale).min(area.width);
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

fn story_rect(body: Rect, area: Rect, scale: f64, size: (f64, f64)) -> Option<Rect> {
    let width = (size.0.clamp(48.0, 340.0) * scale).min(area.width);
    let height = (size.1.clamp(32.0, 520.0) * scale).min(area.height);
    let gap = 18.0 * scale;
    let above = body.y - height - gap;
    let below = body.y + body.height + gap;
    let desired_x = body.x + body.width / 2.0 - 70.0 * scale;
    for y in [above, below] {
        if y >= area.y && y + height <= area.y + area.height {
            let (x, y) = clamp_position(desired_x, y, width, height, area);
            return Some(Rect {
                x,
                y,
                width,
                height,
            });
        }
    }
    regions_around(area, body, gap)
        .into_iter()
        .filter(|region| region.width >= 48.0 * scale && region.height >= 32.0 * scale)
        .map(|region| {
            let width = width.min(region.width);
            let height = height.min(region.height);
            let (x, y) = clamp_position(desired_x, above, width, height, region);
            Rect {
                x,
                y,
                width,
                height,
            }
        })
        .max_by(|left, right| {
            let score = |rect: &Rect| {
                (
                    rect.width * rect.height,
                    -((rect.x - desired_x).abs() + (rect.y - above).abs()),
                )
            };
            score(left)
                .partial_cmp(&score(right))
                .unwrap_or(std::cmp::Ordering::Equal)
        })
}

fn regions_around(area: Rect, obstacle: Rect, gap: f64) -> Vec<Rect> {
    let left = (obstacle.x - gap).clamp(area.x, area.x + area.width);
    let right = (obstacle.x + obstacle.width + gap).clamp(area.x, area.x + area.width);
    let top = (obstacle.y - gap).clamp(area.y, area.y + area.height);
    let bottom = (obstacle.y + obstacle.height + gap).clamp(area.y, area.y + area.height);
    if right <= area.x
        || left >= area.x + area.width
        || bottom <= area.y
        || top >= area.y + area.height
    {
        return vec![area];
    }
    vec![
        Rect {
            height: top - area.y,
            ..area
        },
        Rect {
            y: bottom,
            height: area.y + area.height - bottom,
            ..area
        },
        Rect {
            width: left - area.x,
            ..area
        },
        Rect {
            x: right,
            width: area.x + area.width - right,
            ..area
        },
    ]
}

// Separate native windows leave the real character clickable between the reply and composer.
fn conversation_rect(
    body: Rect,
    area: Rect,
    scale: f64,
    size: (f64, f64),
    below: bool,
    response: Option<Rect>,
) -> Option<Rect> {
    let gap = 8.0 * scale;
    let width = (size.0 * scale).min(area.width);
    let height = (size.1 * scale).min(area.height);
    let desired_x = body.x + body.width / 2.0 - CONVERSATION_CHARACTER_ANCHOR_X * scale;
    let desired_y = if below {
        body.y + body.height + gap
    } else {
        body.y - height - gap
    };
    let regions = regions_around(area, body, gap);
    let regions = if let Some(response) = response {
        regions
            .into_iter()
            .flat_map(|region| regions_around(region, response, gap))
            .collect()
    } else {
        regions
    };
    regions
        .into_iter()
        .filter(|region| region.width >= 48.0 * scale && region.height >= 32.0 * scale)
        .map(|region| {
            let width = width.min(region.width);
            let height = height.min(region.height);
            let (x, y) = clamp_position(desired_x, desired_y, width, height, region);
            Rect {
                x,
                y,
                width,
                height,
            }
        })
        .max_by(|left, right| {
            let score = |rect: &Rect| {
                (
                    rect.width * rect.height,
                    -((rect.x - desired_x).abs() + (rect.y - desired_y).abs()),
                )
            };
            score(left)
                .partial_cmp(&score(right))
                .unwrap_or(std::cmp::Ordering::Equal)
        })
}

fn balloon_placement(
    body: Rect,
    area: Rect,
    scale: f64,
    size: (f64, f64),
    orbit_anchor: Option<OrbitAnchor>,
) -> (Rect, BalloonPlacement) {
    let Some(anchor) = orbit_anchor else {
        return (
            balloon_rect(body, area, scale, size),
            BalloonPlacement::default(),
        );
    };
    let width = (size.0.clamp(48.0, ORBIT_MAX_SIZE.0) * scale).min(area.width);
    let height = (size.1.clamp(32.0, ORBIT_MAX_SIZE.1) * scale).min(area.height);
    let center = (body.x + body.width / 2.0, body.y + body.height / 2.0);
    let (x, y) = clamp_position(
        center.0 - anchor.x * scale,
        center.1 - anchor.y * scale,
        width,
        height,
        area,
    );
    // Match the physical position passed to Tauri, including fractional logical anchors.
    let rect = Rect {
        x: x.round(),
        y: y.round(),
        width,
        height,
    };
    (
        rect,
        BalloonPlacement {
            orbit_anchor: Some(OrbitAnchor {
                x: (center.0 - rect.x) / scale,
                y: (center.1 - rect.y) / scale,
            }),
        },
    )
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
    let legacy = ["a", "b"].get(index).copied();
    store::migrate_body_position(&db, label, legacy)
}

struct BodySpec<'a> {
    index: usize,
    total: usize,
    id: &'a str,
    title: &'a str,
    size: (f64, f64),
    visible: bool,
    guest: bool,
}

fn guest_initial_position(
    app: &AppHandle,
    state: &AppState,
    id: &str,
    size: (f64, f64),
) -> Option<WindowPosition> {
    let center = crate::character_guests::center_id(state, id)
        .ok()
        .flatten()?;
    let center = app.get_webview_window(&body_label(&center))?;
    let monitor = center.current_monitor().ok().flatten()?;
    let area = work_area(&monitor);
    let scale = monitor.scale_factor();
    let position = center.outer_position().ok()?;
    let center_size = center.outer_size().ok()?;
    let width = size.0 * scale;
    let height = size.1 * scale;
    let gap = 16.0 * scale;
    let occupied = app
        .webview_windows()
        .into_values()
        .filter(|window| is_body(window.label()) && window.label() != body_label(id))
        .filter_map(|window| {
            let point = window.outer_position().ok()?;
            let size = window.outer_size().ok()?;
            Some(Rect {
                x: point.x as f64,
                y: point.y as f64,
                width: size.width as f64,
                height: size.height as f64,
            })
        })
        .collect::<Vec<_>>();
    let mut choices = Vec::new();
    for column in 0..4 {
        for side in [-1.0, 1.0] {
            for row in [-2.0, -1.0, 0.0, 1.0, 2.0] {
                let x = position.x as f64
                    + if side < 0.0 {
                        -(width + gap) * (column + 1) as f64
                    } else {
                        center_size.width as f64 + gap + (width + gap) * column as f64
                    };
                let y = position.y as f64 + (height + gap) * row;
                let (x, y) = clamp_position(x, y, width, height, area);
                let overlap = occupied
                    .iter()
                    .map(|other| {
                        ((x + width).min(other.x + other.width) - x.max(other.x)).max(0.0)
                            * ((y + height).min(other.y + other.height) - y.max(other.y)).max(0.0)
                    })
                    .sum::<f64>();
                let distance = (x - position.x as f64).hypot(y - position.y as f64);
                choices.push((overlap, distance, WindowPosition { x, y }));
            }
        }
    }
    choices
        .into_iter()
        .min_by(|a, b| a.0.total_cmp(&b.0).then(a.1.total_cmp(&b.1)))
        .map(|(_, _, point)| point)
}

fn create_body(app: &AppHandle, state: &AppState, spec: BodySpec) -> Result<(), String> {
    let BodySpec {
        index,
        total,
        id,
        title,
        size,
        visible,
        guest,
    } = spec;
    let guest_generation = if guest {
        crate::character_guests::generation(state, id)?
    } else {
        None
    };
    if guest && guest_generation.is_none() {
        return Err("NPC 창을 준비하기 전에 입장이 끝났어요.".into());
    }
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
    crate::character_guests::record_window(
        state,
        &label,
        id,
        crate::character_reaction_host::window_identity(&window),
        guest_generation,
    )?;
    let monitors = window.available_monitors().map_err(|e| e.to_string())?;
    let saved = if guest {
        crate::character_guests::transient_position(state, id)?
    } else {
        saved_body_position(state, index, &label)?
    };
    let center_position = if guest {
        guest_initial_position(app, state, id, size)
    } else {
        None
    };
    let saved = saved.or(center_position);
    let saved_monitor = monitor_at_saved_position(&monitors, saved.as_ref(), monitor_bounds);
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
        #[cfg(target_os = "linux")]
        remember_linux_rect(
            &window,
            Rect {
                x,
                y,
                width,
                height,
            },
            scale,
        )?;
        #[cfg(not(target_os = "linux"))]
        window
            .set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32))
            .map_err(|e| e.to_string())?;
    }
    if visible {
        show_passive(app, &window)?;
    }
    if guest {
        if let (Some(generation), Ok(position)) = (guest_generation, window.outer_position()) {
            let _action = super::lock(&state.action)?;
            crate::character_guests::set_position_locked(
                state,
                id,
                generation,
                WindowPosition {
                    x: position.x as f64,
                    y: position.y as f64,
                },
            )?;
        }
    }
    Ok(())
}

pub(crate) fn create_boxes(app: &AppHandle, state: &AppState) -> Result<(), String> {
    reconcile(app, state, &super::snapshot(state)?)
}

fn display_ids(snapshot: &Snapshot) -> Vec<String> {
    snapshot
        .characters
        .active
        .iter()
        .chain(snapshot.runtime.guest_character_ids.iter())
        .cloned()
        .collect()
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
                    .filter(|_| {
                        character.definition.presence_role
                            == crate::pack_stories::PresenceRole::Resident
                    })
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
                &display_ids(snapshot),
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
            snapshot
                .runtime
                .present_character_ids
                .contains(&character.id)
                && character.definition.face_icon
                && has_visible_sprite(
                    character,
                    &display_ids(snapshot),
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
    #[cfg(target_os = "linux")]
    if let Some(rect) = super::lock(&linux_ambient_layout(window.app_handle()))?
        .0
        .get_mut(window.label())
    {
        // Keep the cached destination scale until a real visible snapshot
        // replaces it; an unmapped body's current GTK scale may be primary.
        rect.rect.width = width * rect.scale;
        rect.rect.height = height * rect.scale;
    }
    Ok(())
}

fn face_position(body: Rect, area: Rect, scale: f64) -> (f64, f64) {
    clamp_position(
        body.x + body.width + 4.0 * scale,
        body.y + (body.height - FACE_SIZE.1 * scale) / 2.0,
        FACE_SIZE.0 * scale,
        FACE_SIZE.1 * scale,
        area,
    )
}

fn create_face(app: &AppHandle, id: &str, title: &str, _body_created: bool) -> Result<(), String> {
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
    let identity = crate::character_reaction_host::window_identity(&body);
    let guest_generation =
        crate::character_guests::window_authority(&state, body.label(), identity)?.flatten();
    crate::character_guests::record_window(
        &state,
        &label,
        id,
        crate::character_reaction_host::window_identity(&window),
        guest_generation,
    )?;
    let saved = if guest_generation.is_some() {
        None
    } else {
        store::window_position(&*super::lock(&state.db)?, &label)?
    };
    let monitors = window.available_monitors().map_err(|e| e.to_string())?;
    let saved_monitor = monitor_at_saved_position(&monitors, saved.as_ref(), monitor_bounds);
    let body_monitor = body.current_monitor().map_err(|e| e.to_string())?;
    #[cfg(target_os = "linux")]
    let body_bounds = {
        let position = body.outer_position().map_err(|error| error.to_string())?;
        let size = body.outer_size().map_err(|error| error.to_string())?;
        super::lock(&linux_ambient_layout(app))?.body_bounds(
            body.label(),
            Rect {
                x: position.x as f64,
                y: position.y as f64,
                width: size.width as f64,
                height: size.height as f64,
            },
            _body_created,
        )
    };
    #[cfg(target_os = "linux")]
    let body_monitor = {
        // An unmapped GTK body reports the primary monitor. Resolve the same
        // planned-or-observed bounds used below, including first show after a
        // hidden startup, before choosing scale and the clipping work area.
        let position = WindowPosition {
            x: body_bounds.x,
            y: body_bounds.y,
        };
        monitor_at_saved_position(&monitors, Some(&position), monitor_bounds)
            .cloned()
            .or(body_monitor)
    };
    let primary = body.primary_monitor().map_err(|e| e.to_string())?;
    let monitor = saved_monitor
        .or(body_monitor.as_ref())
        .or(primary.as_ref())
        .ok_or("화면 영역을 확인할 수 없습니다.")?;
    let scale = monitor.scale_factor();
    let area = work_area(monitor);
    let (width, height) = (FACE_SIZE.0 * scale, FACE_SIZE.1 * scale);
    let (x, y) = match saved.filter(|p| p.x.is_finite() && p.y.is_finite()) {
        Some(saved) => clamp_position(saved.x, saved.y, width, height, area),
        None => {
            #[cfg(not(target_os = "linux"))]
            let bounds = {
                let position = body.outer_position().map_err(|e| e.to_string())?;
                let size = body.outer_size().map_err(|e| e.to_string())?;
                Rect {
                    x: position.x as f64,
                    y: position.y as f64,
                    width: size.width as f64,
                    height: size.height as f64,
                }
            };
            #[cfg(target_os = "linux")]
            let bounds = body_bounds;
            face_position(bounds, area, scale)
        }
    };
    #[cfg(target_os = "linux")]
    remember_linux_rect(
        &window,
        Rect {
            x,
            y,
            width,
            height,
        },
        scale,
    )?;
    #[cfg(not(target_os = "linux"))]
    window
        .set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32))
        .map_err(|e| e.to_string())?;
    show_passive(app, &window)
}

// One body window per roster member, sized to its sprite, with the detached expression tag only
// when the character asks for one. Windows of characters that left the roster are destroyed.
fn reconcile(app: &AppHandle, state: &AppState, snapshot: &Snapshot) -> Result<(), String> {
    let roster = display_ids(snapshot);
    for (index, id) in roster.iter().enumerate() {
        let present = snapshot.runtime.present_character_ids.contains(id);
        let character = character_by_id(snapshot, id);
        let title = character.map_or(id.as_str(), |character| character.definition.name.as_str());
        let size = body_size(snapshot, character);
        let mut body = app.get_webview_window(&body_label(id));
        let expected = if snapshot.runtime.guest_character_ids.contains(id) {
            crate::character_guests::generation(state, id)?
        } else {
            None
        };
        if body.as_ref().is_some_and(|window| {
            crate::character_guests::window_authority(
                state,
                window.label(),
                crate::character_reaction_host::window_identity(window),
            )
            .ok()
            .flatten()
            .is_some_and(|current| current != expected)
        }) {
            if let Some(face) = app.get_webview_window(&face_label(id)) {
                let _ = face.destroy();
            }
            if let Some(window) = body.take() {
                crate::character_collision_host::remove(app, window.label());
                window.destroy().map_err(|error| error.to_string())?;
            }
        }
        let body_created = body.is_none();
        match body {
            Some(window) => {
                set_logical_size(&window, size)?;
                if !snapshot.runtime.hidden && present {
                    show_passive(app, &window)?;
                } else {
                    hide_ambient(&window)?;
                }
            }
            None => create_body(
                app,
                state,
                BodySpec {
                    index,
                    total: snapshot.characters.active.len(),
                    id,
                    title,
                    size,
                    visible: !snapshot.runtime.hidden && present,
                    guest: snapshot.runtime.guest_character_ids.contains(id),
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
                let _ = create_face(app, id, title, body_created);
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
            #[cfg(target_os = "linux")]
            if let Ok(mut layout) = linux_ambient_layout(app).lock() {
                layout.0.remove(&label);
            }
            let _ = window.destroy();
        }
    }
    Ok(())
}

pub(crate) fn sync_boxes(app: &AppHandle, state: &AppState, snapshot: &Snapshot) {
    let _ = reconcile(app, state, snapshot);
}

fn owner(snapshot: &Snapshot) -> Option<&str> {
    let persona = owner_persona(
        &snapshot.runtime,
        snapshot.panel.as_ref(),
        snapshot.story.as_ref(),
        snapshot.playback.as_ref(),
    )?;
    let id = if snapshot
        .runtime
        .guest_character_ids
        .iter()
        .any(|id| id == persona)
    {
        Some(persona)
    } else {
        owner_id(
            &snapshot.runtime,
            snapshot.panel.as_ref(),
            snapshot.story.as_ref(),
            snapshot.playback.as_ref(),
            &snapshot.characters.active,
        )
    };
    id.filter(|id| {
        snapshot
            .runtime
            .present_character_ids
            .iter()
            .any(|present| present == *id)
    })
}

fn owner_id<'a>(
    runtime: &crate::types::RuntimeStatus,
    panel: Option<&crate::types::PanelState>,
    story: Option<&crate::story::Request>,
    playback: Option<&crate::types::Playback>,
    active: &'a [String],
) -> Option<&'a str> {
    owner_persona(runtime, panel, story, playback)
        .and_then(
            |persona| match crate::characters::slot_index(persona).ok() {
                Some(index) => active
                    .iter()
                    .filter(|id| !runtime.guest_character_ids.contains(id))
                    .nth(index),
                None => active.iter().find(|active| active.as_str() == persona),
            },
        )
        .map(String::as_str)
}

fn owner_persona<'a>(
    runtime: &'a crate::types::RuntimeStatus,
    panel: Option<&'a crate::types::PanelState>,
    story: Option<&'a crate::story::Request>,
    playback: Option<&'a crate::types::Playback>,
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
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct BalloonTarget {
    key: String,
    owner: String,
    epoch: u64,
    input: bool,
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
        let base = format!("panel:{}:{}", panel.persona, panel.mode);
        if let Some(line) =
            playback.filter(|_| matches!(panel.mode.as_str(), "input" | "history-input" | "update"))
        {
            format!("{base}:playback:{}", line.id)
        } else {
            base
        }
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
    Some(BalloonTarget {
        key,
        owner,
        epoch,
        input: panel.is_some_and(|panel| matches!(panel.mode.as_str(), "input" | "name")),
    })
}

#[derive(Default)]
struct BalloonLayout {
    target: Option<BalloonTarget>,
    size: Option<(f64, f64)>,
    input_size: Option<(f64, f64)>,
    orbit_anchor: Option<OrbitAnchor>,
    focus_requested: bool,
    keep_visible_during_measurement: bool,
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
            if !self
                .target
                .as_ref()
                .zip(target.as_ref())
                .is_some_and(|(previous, current)| {
                    previous.input && current.input && previous.owner == current.owner
                })
            {
                self.input_size = None;
            }
            self.keep_visible_during_measurement = !self.focus_requested
                && (self.size.is_some() || self.keep_visible_during_measurement)
                && self.target.as_ref().is_some_and(|previous| previous.input)
                && target.as_ref().is_some_and(|current| current.input);
            self.size = None;
            self.orbit_anchor = None;
        }
        if target.is_none() {
            self.focus_requested = false;
            self.keep_visible_during_measurement = false;
        }
        self.target = target;
        self.size
    }

    fn take_focus_request(&mut self) -> bool {
        if self.target.is_none() || self.size.is_none() {
            return false;
        }
        std::mem::take(&mut self.focus_requested)
    }

    fn measured(
        &mut self,
        target: BalloonTarget,
        key: &str,
        size: (f64, f64),
        orbit_anchor: Option<OrbitAnchor>,
    ) -> bool {
        if target.key != key {
            return false;
        }
        self.sync(Some(target));
        self.size = Some(size);
        self.orbit_anchor = orbit_anchor;
        self.keep_visible_during_measurement = false;
        true
    }

    fn measured_input(&mut self, target: BalloonTarget, key: &str, size: (f64, f64)) -> bool {
        if target.key != key || !target.input {
            return false;
        }
        self.sync(Some(target));
        self.input_size = Some(size);
        true
    }
}

fn balloon_layout(app: &AppHandle) -> tauri::State<'_, Mutex<BalloonLayout>> {
    if app.try_state::<Mutex<BalloonLayout>>().is_none() {
        app.manage(Mutex::new(BalloonLayout::default()));
    }
    app.state::<Mutex<BalloonLayout>>()
}

pub(crate) fn request_balloon_focus(app: &AppHandle) -> Result<(), String> {
    super::lock(&balloon_layout(app))?.focus_requested = true;
    Ok(())
}

fn measured_balloon_size(width: f64, height: f64, orbit: bool) -> Result<(f64, f64), String> {
    if !width.is_finite() || !height.is_finite() {
        return Err("말풍선 크기가 올바르지 않습니다.".into());
    }
    let maximum = if orbit {
        ORBIT_MAX_SIZE
    } else {
        (340.0, 520.0)
    };
    Ok((width.clamp(48.0, maximum.0), height.clamp(32.0, maximum.1)))
}

fn validate_orbit_anchor(
    anchor: Option<OrbitAnchor>,
    size: (f64, f64),
    menu: bool,
) -> Result<(), String> {
    if let Some(anchor) = anchor {
        if !menu {
            return Err("궤도 기준점은 캐릭터 메뉴에서만 사용할 수 있어요.".into());
        }
        if !anchor.x.is_finite()
            || !anchor.y.is_finite()
            || anchor.x < 0.0
            || anchor.y < 0.0
            || anchor.x > size.0
            || anchor.y > size.1
        {
            return Err("궤도 기준점이 말풍선 영역을 벗어났어요.".into());
        }
    }
    Ok(())
}

pub(crate) fn get_balloon(app: &AppHandle) -> Result<WebviewWindow, String> {
    get_conversation_surface(app, false)
}

fn get_conversation_surface(app: &AppHandle, input: bool) -> Result<WebviewWindow, String> {
    let label = if input {
        "conversation-input"
    } else {
        "balloon"
    };
    if let Some(window) = app.get_webview_window(label) {
        return Ok(window);
    }
    tauri::WebviewWindowBuilder::new(
        app,
        label,
        tauri::WebviewUrl::App(format!("index.html?view={label}").into()),
    )
    .title(if input {
        "comet · 말 걸기"
    } else {
        "comet · 말풍선"
    })
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

fn balloon_owner_geometry(app: &AppHandle, id: &str) -> Result<(Rect, Rect, f64), String> {
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
    Ok((
        Rect {
            x: position.x as f64,
            y: position.y as f64,
            width: body_size.width as f64,
            height: body_size.height as f64,
        },
        work_area(&monitor),
        monitor.scale_factor(),
    ))
}

fn set_window_rect(window: &WebviewWindow, rect: Rect) -> Result<(), String> {
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
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn position_balloon(
    app: &AppHandle,
    window: &WebviewWindow,
    id: &str,
    size: (f64, f64),
    orbit_anchor: Option<OrbitAnchor>,
    conversation: bool,
    story: bool,
) -> Result<Option<BalloonPlacement>, String> {
    let (body, area, scale) = balloon_owner_geometry(app, id)?;
    let (rect, placement) = if conversation {
        let Some(rect) = conversation_rect(body, area, scale, size, false, None) else {
            window.hide().map_err(|error| error.to_string())?;
            return Ok(None);
        };
        (rect, BalloonPlacement::default())
    } else if story {
        let Some(rect) = story_rect(body, area, scale, size) else {
            window.hide().map_err(|error| error.to_string())?;
            return Ok(None);
        };
        (rect, BalloonPlacement::default())
    } else {
        balloon_placement(body, area, scale, size, orbit_anchor)
    };
    set_window_rect(window, rect)?;
    Ok(Some(placement))
}

fn show_conversation_surface(window: &WebviewWindow) -> Result<(), String> {
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
    #[cfg(target_os = "linux")]
    show_linux_passive(window)?;
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    window.show().map_err(|error| error.to_string())?;
    Ok(())
}

fn apply_measured_balloon(app: &AppHandle) -> Result<Option<BalloonPlacement>, String> {
    let state = app.state::<Arc<AppState>>();
    // A worker may be waiting on this thread, so retry contended state without blocking the UI.
    let Ok(_action) = state.action.try_lock() else {
        return Ok(None);
    };
    let (
        Ok(db),
        Ok(mut runtime),
        Ok(panel),
        Ok(mut playback),
        Ok(mut story),
        Ok(presence),
        Ok(guests),
    ) = (
        state.db.try_lock(),
        state.runtime.try_lock(),
        state.panel.try_lock(),
        state.playback.try_lock(),
        state.story.try_lock(),
        state.presence.try_lock(),
        state.guests.try_lock(),
    )
    else {
        return Ok(None);
    };
    if let Some(error) = playback
        .as_ref()
        .filter(|line| matches!(line.source.as_str(), "llm" | "question"))
        .and_then(|line| crate::conversation_notes::validate_reply(&db, &line.id).err())
    {
        *playback = None;
        runtime.phase = crate::types::RuntimePhase::Error;
        runtime.error = Some(error);
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let state = app.state::<Arc<AppState>>();
            super::publish(&app, &state);
        });
    }
    let mut status = runtime.clone();
    let residents = crate::characters::active_ids(&db)?;
    let active = crate::character_guests::display_ids_locked(&state, &db, &guests, runtime.hidden)?;
    status.guest_character_ids = active
        .iter()
        .filter(|id| !residents.contains(id))
        .cloned()
        .collect();
    let present = active
        .iter()
        .filter(|id| !residents.contains(id) || presence.contains(id))
        .cloned()
        .collect::<Vec<_>>();
    drop((runtime, presence, guests));
    let target = if super::unavailable(&state)
        || (crate::widgets::storage::focus_active(&db, chrono::Utc::now().timestamp_millis())?
            && panel.as_ref().is_none_or(|panel| {
                matches!(
                    panel.mode.as_str(),
                    "input" | "history-input" | "name" | "update"
                )
            }))
        || crate::app::quiet_hours::playback_blocked(&state, &store::settings(&db)?, status.paused)?
    {
        None
    } else {
        balloon_target(
            &status,
            panel.as_ref(),
            story.as_ref(),
            playback.as_ref(),
            &active,
            state.epoch.load(Ordering::SeqCst),
        )
        .filter(|target| present.contains(&target.owner))
    };
    let input = panel.as_ref().is_some_and(|panel| panel.mode == "input");
    let conversation = panel
        .as_ref()
        .is_some_and(|panel| matches!(panel.mode.as_str(), "input" | "history-input"));
    drop(panel);
    let layout = balloon_layout(app);
    let Ok(mut layout) = layout.try_lock() else {
        return Ok(None);
    };
    let size = layout.sync(target.clone());
    if let Some(input_window) = app.get_webview_window("conversation-input") {
        if let Some((target, input_size)) = target.as_ref().zip(layout.input_size).filter(|_| input)
        {
            let (body, area, scale) = balloon_owner_geometry(app, &target.owner)?;
            let response =
                size.and_then(|size| conversation_rect(body, area, scale, size, false, None));
            if let Some(rect) = conversation_rect(body, area, scale, input_size, true, response) {
                set_window_rect(&input_window, rect)?;
                show_conversation_surface(&input_window)?;
                if std::mem::take(&mut layout.focus_requested) {
                    input_window
                        .set_focus()
                        .map_err(|error| error.to_string())?;
                }
            } else {
                input_window.hide().map_err(|error| error.to_string())?;
            }
        } else {
            input_window.hide().map_err(|error| error.to_string())?;
        }
    }
    let Some(window) = app.get_webview_window("balloon") else {
        return Ok(Some(BalloonPlacement::default()));
    };
    if target.is_some()
        && size.is_none()
        && layout.keep_visible_during_measurement
        && window.is_visible().unwrap_or(false)
    {
        return Ok(Some(BalloonPlacement::default()));
    }
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
        return Ok(Some(BalloonPlacement::default()));
    };
    let Some(placement) = position_balloon(
        app,
        &window,
        &target.owner,
        size,
        layout.orbit_anchor,
        conversation,
        target.key.starts_with("story:"),
    )?
    else {
        return Ok(Some(BalloonPlacement::default()));
    };
    window
        .emit(
            "balloon-orbit-anchor",
            BalloonAnchorEvent {
                content_key: &target.key,
                orbit_anchor: placement.orbit_anchor,
            },
        )
        .map_err(|error| error.to_string())?;
    show_conversation_surface(&window)?;
    if !input && layout.take_focus_request() {
        window.set_focus().map_err(|error| error.to_string())?;
    }
    drop(layout);
    let mut first_display = false;
    let mut displayed_message = None;
    if let Some(line) = playback.as_mut() {
        if target.key == format!("playback:{}", line.id)
            || target
                .key
                .ends_with(&format!(":input:playback:{}", line.id))
            || target
                .key
                .ends_with(&format!(":history-input:playback:{}", line.id))
            || target
                .key
                .ends_with(&format!(":update:playback:{}", line.id))
        {
            first_display =
                crate::app::scene::mark_line_displayed(line, chrono::Utc::now().timestamp_millis());
            if first_display && line.source != "update" {
                displayed_message = line.display_started_at.map(|at| (line.id.clone(), at));
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
    if let Some((id, at)) = displayed_message {
        store::mark_message_displayed_with_provenance(
            &db,
            &id,
            at,
            Some(state.automatic.load(Ordering::SeqCst)),
        )?;
        if let Some(ticket) = super::lock(&state.tasks)?.participants.clone() {
            crate::character_guests::hear_displayed_locked(&state, &db, &ticket, &id, at)?;
        }
    }
    drop((db, _action));
    if first_display {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let state = app.state::<Arc<AppState>>();
            super::publish(&app, &state);
        });
    }
    Ok(Some(placement))
}

fn sync_measured_balloon(
    app: &AppHandle,
) -> Result<tokio::sync::oneshot::Receiver<Result<Option<BalloonPlacement>, String>>, String> {
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
    mut pending: tokio::sync::oneshot::Receiver<Result<Option<BalloonPlacement>, String>>,
) -> Result<BalloonPlacement, String> {
    for attempt in 0..50 {
        if let Some(placement) = pending.await.map_err(|error| error.to_string())?? {
            return Ok(placement);
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
    if owner(snapshot).is_some() {
        if get_balloon(app).is_err() {
            return;
        }
        if snapshot
            .panel
            .as_ref()
            .is_some_and(|panel| panel.mode == "input")
            && get_conversation_surface(app, true).is_err()
        {
            return;
        }
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
    orbit_anchor: Option<OrbitAnchor>,
    surface: Option<BalloonSurface>,
) -> Result<BalloonPlacement, String> {
    let input = matches!(surface, Some(BalloonSurface::Input));
    let size = if input {
        if !width.is_finite() || !height.is_finite() || orbit_anchor.is_some() {
            return Err("입력 캡슐 크기가 올바르지 않습니다.".into());
        }
        (width.clamp(48.0, 520.0), height.clamp(32.0, 520.0))
    } else {
        measured_balloon_size(width, height, orbit_anchor.is_some())?
    };
    let state = app.state::<Arc<AppState>>();
    {
        let _action = super::lock(&state.action)?;
        if super::unavailable(&state) {
            return Ok(BalloonPlacement::default());
        }
        let snapshot = super::snapshot(&state)?;
        let Some(target) = balloon_target(
            &snapshot.runtime,
            snapshot.panel.as_ref(),
            snapshot.story.as_ref(),
            snapshot.playback.as_ref(),
            &display_ids(&snapshot),
            state.epoch.load(Ordering::SeqCst),
        )
        .filter(|target| {
            snapshot
                .runtime
                .present_character_ids
                .contains(&target.owner)
        }) else {
            return Ok(BalloonPlacement::default());
        };
        if target.key != content_key {
            return Ok(BalloonPlacement::default());
        }
        if input {
            if !snapshot
                .panel
                .as_ref()
                .is_some_and(|panel| panel.mode == "input")
                || !super::lock(&balloon_layout(app))?.measured_input(target, content_key, size)
            {
                return Ok(BalloonPlacement::default());
            }
        } else {
            validate_orbit_anchor(
                orbit_anchor,
                size,
                snapshot
                    .panel
                    .as_ref()
                    .is_some_and(|panel| panel.mode == "menu"),
            )?;
            if !super::lock(&balloon_layout(app))?.measured(target, content_key, size, orbit_anchor)
            {
                return Ok(BalloonPlacement::default());
            }
        }
    }
    await_balloon_sync(app, sync_measured_balloon(app)?).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn overlaps(left: Rect, right: Rect) -> bool {
        left.x < right.x + right.width
            && right.x < left.x + left.width
            && left.y < right.y + right.height
            && right.y < left.y + left.height
    }

    #[test]
    fn conversation_surfaces_prefer_above_and_below_the_real_character() {
        for scale in [1.0, 2.0] {
            let area = Rect {
                x: 0.0,
                y: 0.0,
                width: 1200.0 * scale,
                height: 900.0 * scale,
            };
            let body = Rect {
                x: 500.0 * scale,
                y: 400.0 * scale,
                width: 112.0 * scale,
                height: 88.0 * scale,
            };
            let response =
                conversation_rect(body, area, scale, (340.0, 120.0), false, None).unwrap();
            let input =
                conversation_rect(body, area, scale, (344.0, 54.0), true, Some(response)).unwrap();
            assert_eq!(
                (response.width, response.height),
                (340.0 * scale, 120.0 * scale)
            );
            assert_eq!(response.y + response.height, body.y - 8.0 * scale);
            assert_eq!((input.width, input.height), (344.0 * scale, 54.0 * scale));
            assert_eq!(input.y, body.y + body.height + 8.0 * scale);
            assert_eq!(response.x, body.x - 20.0 * scale);
            assert_eq!(input.x, response.x);
            assert!(!overlaps(response, body));
            assert!(!overlaps(input, body));
            assert!(!overlaps(input, response));
        }
    }

    #[test]
    fn conversation_surfaces_stay_on_screen_without_covering_character_or_each_other_at_edges() {
        for scale in [1.0, 2.0] {
            let area = Rect {
                x: -1200.0,
                y: 40.0,
                width: 1200.0 * scale,
                height: 900.0 * scale,
            };
            for (horizontal, vertical) in [(0.0, 0.0), (1.0, 0.0), (0.0, 1.0), (1.0, 1.0)] {
                let body = Rect {
                    x: area.x + horizontal * (area.width - 112.0 * scale),
                    y: area.y + vertical * (area.height - 88.0 * scale),
                    width: 112.0 * scale,
                    height: 88.0 * scale,
                };
                let response =
                    conversation_rect(body, area, scale, (340.0, 520.0), false, None).unwrap();
                let input =
                    conversation_rect(body, area, scale, (340.0, 220.0), true, Some(response))
                        .unwrap();
                for rect in [response, input] {
                    assert!(rect.x >= area.x && rect.y >= area.y);
                    assert!(rect.x + rect.width <= area.x + area.width);
                    assert!(rect.y + rect.height <= area.y + area.height);
                    assert!(!overlaps(rect, body));
                }
                assert!(!overlaps(input, response));
            }
        }
        let area = Rect {
            x: 0.0,
            y: 0.0,
            width: 100.0,
            height: 80.0,
        };
        assert!(conversation_rect(area, area, 1.0, (340.0, 54.0), true, None).is_none());
    }

    #[test]
    fn input_measurements_survive_reply_changes_but_not_history_handoffs_or_stale_content() {
        let mut layout = BalloonLayout::default();
        let panel = BalloonTarget {
            key: "panel:a:input".into(),
            owner: "a".into(),
            epoch: 1,
            input: true,
        };
        assert!(!layout.measured_input(panel.clone(), "old", (340.0, 54.0)));
        assert!(layout.measured_input(panel.clone(), &panel.key, (340.0, 54.0)));
        assert!(layout.size.is_none());
        let reply = BalloonTarget {
            key: "panel:a:input:playback:reply".into(),
            ..panel.clone()
        };
        layout.sync(Some(reply));
        assert_eq!(layout.input_size, Some((340.0, 54.0)));
        let history = BalloonTarget {
            key: "panel:a:history-input".into(),
            input: false,
            ..panel.clone()
        };
        layout.sync(Some(history.clone()));
        assert!(layout.input_size.is_none());
        assert!(!layout.measured_input(history.clone(), &history.key, (340.0, 54.0)));
        layout.sync(Some(panel));
        assert!(layout.input_size.is_none());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_first_face_uses_planned_body_not_unmapped_tao_geometry() {
        let mut layout = LinuxAmbientLayout::default();
        let planned = Rect {
            x: 500.0,
            y: 600.0,
            width: 200.0,
            height: 200.0,
        };
        layout.remember("body-one", planned, 1.0);
        let unmapped = Rect {
            x: 0.0,
            y: 0.0,
            width: 0.0,
            height: 0.0,
        };
        let area = Rect {
            x: 0.0,
            y: 0.0,
            width: 1400.0,
            height: 1000.0,
        };
        assert_eq!(
            face_position(layout.body_bounds("body-one", unmapped, true), area, 1.0),
            (704.0, 682.0)
        );
        let initial_configure = Rect {
            width: 200.0,
            height: 200.0,
            ..unmapped
        };
        assert_eq!(
            layout.body_bounds("body-one", initial_configure, true),
            planned
        );
        let moved = Rect {
            x: 750.0,
            y: 420.0,
            ..planned
        };
        assert_eq!(layout.body_bounds("body-one", moved, false), moved);
        assert_eq!(layout.body_bounds("body-one", unmapped, false), planned);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_new_face_uses_planned_secondary_monitor_before_body_is_mapped() {
        let mut layout = LinuxAmbientLayout::default();
        let body = Rect {
            x: -800.0,
            y: 500.0,
            width: 200.0,
            height: 200.0,
        };
        let monitors = [
            Rect {
                x: 0.0,
                y: 0.0,
                width: 1400.0,
                height: 1000.0,
            },
            Rect {
                x: -1600.0,
                y: 0.0,
                width: 1600.0,
                height: 900.0,
            },
        ];
        layout.remember("body-one", body, 1.0);
        let planned = layout.0.get("body-one").map(|rect| WindowPosition {
            x: rect.rect.x,
            y: rect.rect.y,
        });
        let monitor = monitor_at_saved_position(&monitors, planned.as_ref(), |area| *area).unwrap();
        assert_eq!(*monitor, monitors[1]);
        assert_eq!(face_position(body, *monitor, 1.0), (-596.0, 582.0));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_remap_preserves_independent_positions_and_never_moves_visible_windows() {
        let mut layout = LinuxAmbientLayout::default();
        let body = Rect {
            x: 700.0,
            y: 500.0,
            width: 200.0,
            height: 200.0,
        };
        let face = Rect {
            x: 30.0,
            y: 80.0,
            width: 120.0,
            height: 36.0,
        };
        layout.remember("body-one", body, 1.0);
        layout.remember("face-one", face, 1.0);
        assert_eq!(
            layout.remap("body-one", false),
            Some(LinuxPlacement {
                rect: body,
                scale: 1.0
            })
        );
        assert_eq!(
            layout.remap("face-one", false),
            Some(LinuxPlacement {
                rect: face,
                scale: 1.0
            })
        );
        assert_eq!(layout.remap("face-one", true), None);
        let dragged = Rect {
            x: -300.0,
            y: 90.0,
            ..face
        };
        layout.remember("face-one", dragged, 1.0);
        assert_eq!(
            layout.remap("face-one", false),
            Some(LinuxPlacement {
                rect: dragged,
                scale: 1.0
            })
        );
        assert_eq!(
            layout.remap("body-one", false),
            Some(LinuxPlacement {
                rect: body,
                scale: 1.0
            })
        );
        layout.remember("face-one", Rect { width: 0.0, ..face }, 1.0);
        assert_eq!(
            layout.remap("face-one", false),
            Some(LinuxPlacement {
                rect: dragged,
                scale: 1.0
            })
        );
        layout.remember("balloon", body, 1.0);
        assert_eq!(layout.remap("balloon", false), None);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_initial_mapping_preserves_target_monitor_logical_size() {
        let placement = LinuxPlacement {
            rect: Rect {
                x: -1800.0,
                y: 600.0,
                width: 240.0,
                height: 72.0,
            },
            scale: 2.0,
        };
        assert_eq!(
            placement.logical_rect(),
            Rect {
                x: -900.0,
                y: 300.0,
                width: 120.0,
                height: 36.0
            }
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_widget_size_request_stays_smaller_than_gtk_empty_child_fallback() {
        let mut layout = LinuxAmbientLayout::default();
        let rect = Rect {
            x: 400.0,
            y: 300.0,
            width: FACE_SIZE.0,
            height: FACE_SIZE.1,
        };
        layout.remember("face-one", rect, 1.0);
        let request = layout.0.get("face-one").unwrap().logical_rect();
        assert_eq!((request.width as i32, request.height as i32), (120, 36));
        // A visible face keeps the request while remapping remains disabled.
        assert!(layout.remap("face-one", true).is_none());
        let body = Rect {
            width: 136.0,
            height: 136.0,
            ..rect
        };
        layout.remember("body-one", body, 1.0);
        let request = layout.0.get("body-one").unwrap().logical_rect();
        assert_eq!((request.width as i32, request.height as i32), (136, 136));
    }

    #[test]
    fn initial_face_placement_clamps_inside_negative_monitor_bounds() {
        let area = Rect {
            x: -1600.0,
            y: -100.0,
            width: 1600.0,
            height: 900.0,
        };
        let body = Rect {
            x: -100.0,
            y: 720.0,
            width: 200.0,
            height: 200.0,
        };
        assert_eq!(face_position(body, area, 1.0), (-120.0, 764.0));
        assert_eq!(
            clamp_position(-900.0, 100.0, FACE_SIZE.0, FACE_SIZE.1, area),
            (-900.0, 100.0)
        );
    }

    #[test]
    fn queued_passive_show_rejects_old_hidden_and_stopping_work() {
        let state = crate::app::tests::state();
        let epoch = state.epoch.load(Ordering::SeqCst);
        assert!(passive_show_current(&state, epoch, false));
        assert!(!passive_show_current(&state, epoch, true));
        state.epoch.fetch_add(1, Ordering::SeqCst);
        assert!(!passive_show_current(&state, epoch, false));
        let epoch = state.epoch.load(Ordering::SeqCst);
        state.stopping.store(true, Ordering::SeqCst);
        assert!(!passive_show_current(&state, epoch, false));
        state.stopping.store(false, Ordering::SeqCst);
        state.update_installing.store(true, Ordering::SeqCst);
        assert!(!passive_show_current(&state, epoch, false));
        state.update_installing.store(false, Ordering::SeqCst);
        assert!(passive_show_current(&state, epoch, false));
    }

    #[test]
    fn saved_face_position_uses_its_own_monitor() {
        let monitors = [
            Rect {
                x: 0.0,
                y: 0.0,
                width: 1920.0,
                height: 1080.0,
            },
            Rect {
                x: -2560.0,
                y: 0.0,
                width: 2560.0,
                height: 1440.0,
            },
        ];
        let saved = WindowPosition {
            x: -2000.0,
            y: 600.0,
        };
        let selected = monitor_at_saved_position(&monitors, Some(&saved), |monitor| *monitor)
            .expect("saved face monitor should be available");
        assert_eq!(selected.x, -2560.0);
        assert_eq!(
            clamp_position(saved.x, saved.y, 120.0, 36.0, *selected),
            (-2000.0, 600.0)
        );
        assert!(
            monitor_at_saved_position(&monitors[..1], Some(&saved), |monitor| *monitor).is_none()
        );
    }

    #[test]
    fn update_notice_expansion_keeps_the_native_owner_and_uses_its_playback_identity() {
        let mut data = crate::app::snapshot(&crate::app::tests::state()).unwrap();
        let actor = data.characters.active[0].clone();
        data.playback = Some(crate::types::Playback {
            id: "update-notice".into(),
            persona: actor.clone(),
            expression: "평온".into(),
            text: "새로운 업데이트가 있어요!".into(),
            motion: Default::default(),
            source: "update".into(),
            text_speed: 0,
            display_started_at: None,
            ends_at: 0,
            line_index: 0,
            line_count: 1,
        });
        let target = balloon_target(
            &data.runtime,
            None,
            None,
            data.playback.as_ref(),
            &data.characters.active,
            7,
        )
        .unwrap();
        assert_eq!(target.owner, actor);
        assert_eq!(target.key, "playback:update-notice");
        data.panel = Some(crate::types::PanelState {
            persona: actor.clone(),
            mode: "update".into(),
        });
        let expanded = balloon_target(
            &data.runtime,
            data.panel.as_ref(),
            None,
            data.playback.as_ref(),
            &data.characters.active,
            7,
        )
        .unwrap();
        assert_eq!(expanded.owner, actor);
        assert_eq!(
            expanded.key,
            format!("panel:{actor}:update:playback:update-notice")
        );
        data.runtime.hidden = true;
        assert!(balloon_target(
            &data.runtime,
            data.panel.as_ref(),
            None,
            data.playback.as_ref(),
            &data.characters.active,
            7
        )
        .is_none());
    }

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
            motion: Default::default(),
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
    fn native_guest_uses_explicit_uuid_and_never_claims_a_resident_alias() {
        let mut data = crate::app::snapshot(&crate::app::tests::state()).unwrap();
        let guest = &mut data.characters.installed[1];
        guest.definition.presence_role = crate::pack_stories::PresenceRole::Npc;
        guest.definition.sprite_size = 32;
        guest.sprites.insert(
            "기쁨".into(),
            crate::character_sprites::SpriteInfo {
                mime: "image/png".into(),
                updated_at: 1,
            },
        );
        let id = guest.id.clone();
        data.characters.active.truncate(1);
        data.runtime.guest_character_ids = vec![id.clone()];
        data.runtime.present_character_ids.push(id.clone());
        data.playback = Some(crate::types::Playback {
            id: "npc-line".into(),
            persona: "b".into(),
            expression: "기쁨".into(),
            text: "안녕".into(),
            motion: Default::default(),
            source: "npc".into(),
            ends_at: 1,
            text_speed: 0,
            display_started_at: None,
            line_index: 0,
            line_count: 1,
        });
        assert!(owner(&data).is_none());
        assert!(balloon_target(
            &data.runtime,
            None,
            None,
            data.playback.as_ref(),
            &display_ids(&data),
            0
        )
        .is_none());
        assert_eq!(body_size(&data, character_by_id(&data, &id)), BODY_SIZE);
        data.playback.as_mut().unwrap().persona = id.clone();
        assert_eq!(owner(&data), Some(id.as_str()));
        assert_eq!(
            balloon_target(
                &data.runtime,
                None,
                None,
                data.playback.as_ref(),
                &display_ids(&data),
                0
            )
            .unwrap()
            .owner,
            id
        );
        assert_eq!(body_size(&data, character_by_id(&data, &id)), (40.0, 40.0));
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
            motion: Default::default(),
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
    fn native_input_keeps_explicit_guest_owner_after_final_playback_clears() {
        let mut data = crate::app::snapshot(&crate::app::tests::state()).unwrap();
        data.characters.installed[1].definition.presence_role =
            crate::pack_stories::PresenceRole::Npc;
        let guest = data.characters.installed[1].id.clone();
        data.characters.active.truncate(1);
        data.runtime.guest_character_ids = vec![guest.clone()];
        data.runtime.present_character_ids = vec![data.characters.active[0].clone(), guest.clone()];
        data.runtime.phase = crate::types::RuntimePhase::Idle;
        data.panel = Some(crate::types::PanelState {
            persona: guest.clone(),
            mode: "input".into(),
        });
        data.playback = None;
        assert_eq!(owner(&data), Some(guest.as_str()));
        let target = balloon_target(
            &data.runtime,
            data.panel.as_ref(),
            None,
            None,
            &display_ids(&data),
            7,
        )
        .unwrap();
        assert_eq!(target.owner, guest);
        assert!(target.input);
        assert_eq!(target.key, format!("panel:{guest}:input"));
        data.runtime.present_character_ids.retain(|id| id != &guest);
        assert!(owner(&data).is_none());
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
            input: false,
        };
        let second = BalloonTarget {
            key: "playback:second".into(),
            ..first.clone()
        };
        assert_eq!(layout.sync(Some(first.clone())), None);
        assert!(layout.measured(first.clone(), &first.key, (108.0, 56.0), None));
        assert_eq!(layout.sync(Some(first.clone())), Some((108.0, 56.0)));
        assert_eq!(layout.sync(Some(second.clone())), None);
        assert!(!layout.measured(second.clone(), &first.key, (320.0, 180.0), None));
        assert_eq!(layout.sync(Some(second.clone())), None);
        assert!(layout.measured(second.clone(), &second.key, (212.0, 93.0), None));
        assert_eq!(layout.sync(Some(second)), Some((212.0, 93.0)));
        assert_eq!(layout.sync(None), None);
        assert_eq!(layout.sync(Some(first.clone())), None);
        assert!(layout.measured(first.clone(), &first.key, (108.0, 56.0), None));
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
            motion: Default::default(),
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
        assert!(target(&data).unwrap().input);
        assert_eq!(target(&data).unwrap().key, "panel:a:input:playback:line-1");
        data.playback = None;
        assert_eq!(target(&data).unwrap().key, "panel:a:input");
        assert_eq!(target(&data).unwrap().owner, id);
        data.panel.as_mut().unwrap().mode = "name".into();
        assert!(target(&data).unwrap().input);
        assert_eq!(target(&data).unwrap().key, "panel:a:name");
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
            input: true,
        };
        assert!(layout.measured(panel.clone(), &panel.key, (320.0, 240.0), None));
        let reopened = BalloonTarget { epoch: 2, ..panel };
        assert_eq!(layout.sync(Some(reopened.clone())), Some((320.0, 240.0)));
        assert_eq!(layout.target.as_ref().unwrap().epoch, 2);
        assert_eq!(layout.sync(None), None);
        assert_eq!(layout.sync(Some(reopened)), None);
    }

    #[test]
    fn explicit_focus_waits_for_measurement_and_does_not_repeat_for_responses_or_resize() {
        let mut layout = BalloonLayout::default();
        let panel = BalloonTarget {
            key: "panel:a:input".into(),
            owner: "one".into(),
            epoch: 1,
            input: true,
        };
        layout.focus_requested = true;
        assert_eq!(layout.sync(Some(panel.clone())), None);
        assert!(!layout.take_focus_request());
        assert!(!layout.measured(panel.clone(), "playback:old", (120.0, 80.0), None));
        assert!(!layout.take_focus_request());
        assert!(layout.measured(panel.clone(), &panel.key, (320.0, 240.0), None));
        assert!(layout.take_focus_request());
        assert!(!layout.take_focus_request());

        let response = BalloonTarget {
            key: "panel:a:input:playback:reply".into(),
            ..panel
        };
        assert_eq!(layout.sync(Some(response.clone())), None);
        assert!(layout.measured(response.clone(), &response.key, (320.0, 300.0), None));
        assert!(!layout.take_focus_request());
        assert!(layout.measured(response.clone(), &response.key, (320.0, 400.0), None));
        assert!(!layout.take_focus_request());
    }

    #[test]
    fn explicit_reopen_focuses_visible_panel_and_closing_cancels_pending_focus() {
        let mut layout = BalloonLayout::default();
        let panel = BalloonTarget {
            key: "panel:a:input".into(),
            owner: "one".into(),
            epoch: 1,
            input: true,
        };
        assert!(layout.measured(panel.clone(), &panel.key, (320.0, 240.0), None));
        assert!(!layout.take_focus_request());
        layout.focus_requested = true;
        let reopened = BalloonTarget { epoch: 2, ..panel };
        assert_eq!(layout.sync(Some(reopened.clone())), Some((320.0, 240.0)));
        assert!(layout.take_focus_request());

        layout.focus_requested = true;
        assert_eq!(layout.sync(None), None);
        assert!(!layout.take_focus_request());
        assert!(layout.measured(reopened.clone(), &reopened.key, (320.0, 240.0), None));
        assert!(!layout.take_focus_request());
    }

    #[test]
    fn ongoing_input_stays_visible_while_new_reply_and_owner_wait_for_measurement() {
        let mut layout = BalloonLayout::default();
        let panel = BalloonTarget {
            key: "panel:a:input".into(),
            owner: "one".into(),
            epoch: 1,
            input: true,
        };
        assert!(layout.measured(panel.clone(), &panel.key, (320.0, 240.0), None));
        let response = BalloonTarget {
            key: "panel:a:input:playback:reply".into(),
            owner: "two".into(),
            ..panel.clone()
        };
        assert_eq!(layout.sync(Some(response.clone())), None);
        assert!(layout.keep_visible_during_measurement);
        assert_eq!(layout.sync(Some(response.clone())), None);
        assert!(layout.keep_visible_during_measurement);
        assert!(!layout.measured(response.clone(), &panel.key, (320.0, 240.0), None));
        assert!(layout.keep_visible_during_measurement);
        assert!(!layout.take_focus_request());

        let next_response = BalloonTarget {
            key: "panel:a:input:playback:next".into(),
            ..response
        };
        assert_eq!(layout.sync(Some(next_response.clone())), None);
        assert!(layout.keep_visible_during_measurement);
        assert!(layout.measured(
            next_response.clone(),
            &next_response.key,
            (320.0, 300.0),
            None
        ));
        assert!(!layout.keep_visible_during_measurement);
        assert_eq!(layout.sync(Some(next_response)), Some((320.0, 300.0)));
    }

    #[test]
    fn new_input_close_and_other_targets_do_not_keep_unmeasured_panel_visible() {
        let mut layout = BalloonLayout::default();
        let panel = BalloonTarget {
            key: "panel:a:input".into(),
            owner: "one".into(),
            epoch: 1,
            input: true,
        };
        assert_eq!(layout.sync(Some(panel.clone())), None);
        assert!(!layout.keep_visible_during_measurement);
        assert!(layout.measured(panel.clone(), &panel.key, (320.0, 240.0), None));
        let response = BalloonTarget {
            key: "panel:a:input:playback:reply".into(),
            ..panel.clone()
        };
        assert_eq!(layout.sync(Some(response.clone())), None);
        assert!(layout.keep_visible_during_measurement);
        assert_eq!(layout.sync(None), None);
        assert!(!layout.keep_visible_during_measurement);
        assert_eq!(layout.sync(Some(response.clone())), None);
        assert!(!layout.keep_visible_during_measurement);

        assert!(layout.measured(response.clone(), &response.key, (320.0, 300.0), None));
        layout.focus_requested = true;
        assert_eq!(layout.sync(Some(panel.clone())), None);
        assert!(!layout.keep_visible_during_measurement);
        assert!(layout.measured(panel.clone(), &panel.key, (320.0, 240.0), None));
        assert!(layout.take_focus_request());
        let menu = BalloonTarget {
            key: "panel:a:menu".into(),
            input: false,
            ..panel
        };
        assert_eq!(layout.sync(Some(menu)), None);
        assert!(!layout.keep_visible_during_measurement);
    }

    #[test]
    fn balloon_measurements_reject_nonfinite_dimensions_and_clamp_both_axes() {
        for invalid in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            for orbit in [false, true] {
                assert!(measured_balloon_size(invalid, 50.0, orbit).is_err());
                assert!(measured_balloon_size(100.0, invalid, orbit).is_err());
            }
        }
        assert_eq!(
            measured_balloon_size(-10.0, 0.0, false).unwrap(),
            (48.0, 32.0)
        );
        assert_eq!(
            measured_balloon_size(1000.0, 1000.0, false).unwrap(),
            (340.0, 520.0)
        );
        assert_eq!(
            measured_balloon_size(82.5, 39.5, false).unwrap(),
            (82.5, 39.5)
        );
    }

    #[test]
    fn expanded_orbits_keep_their_size_and_normal_panels_restore_the_smaller_limit() {
        let expanded = measured_balloon_size(900.0, 900.0, true).unwrap();
        let normal = measured_balloon_size(900.0, 900.0, false).unwrap();
        assert_eq!(expanded, (640.0, 600.0));
        assert_eq!(normal, (340.0, 520.0));
        let anchor = Some(OrbitAnchor { x: 500.0, y: 550.0 });
        assert!(validate_orbit_anchor(anchor, expanded, true).is_ok());
        assert!(validate_orbit_anchor(anchor, expanded, false).is_err());
        let target = BalloonTarget {
            key: "panel:one:menu".into(),
            owner: "one".into(),
            epoch: 1,
            input: false,
        };
        let mut layout = BalloonLayout::default();
        assert!(layout.measured(target.clone(), &target.key, expanded, anchor));
        assert_eq!(layout.size, Some(expanded));
        assert!(layout.measured(target.clone(), &target.key, normal, None));
        assert_eq!(layout.size, Some(normal));
        assert_eq!(layout.orbit_anchor, None);
        for scale in [1.0, 2.0] {
            for area in [
                Rect {
                    x: -2560.0,
                    y: 50.0,
                    width: 2560.0,
                    height: 1390.0,
                },
                Rect {
                    x: -500.0,
                    y: 20.0,
                    width: 500.0,
                    height: 400.0,
                },
            ] {
                let body = Rect {
                    x: area.x + 10.0,
                    y: area.y + 10.0,
                    width: 112.0 * scale,
                    height: 88.0 * scale,
                };
                let (frame, placement) = balloon_placement(body, area, scale, expanded, anchor);
                assert_eq!(frame.width, (640.0 * scale).min(area.width));
                assert_eq!(frame.height, (600.0 * scale).min(area.height));
                assert!(frame.x >= area.x && frame.y >= area.y);
                assert!(frame.x + frame.width <= area.x + area.width);
                assert!(frame.y + frame.height <= area.y + area.height);
                let actual = placement.orbit_anchor.unwrap();
                assert_eq!(frame.x + actual.x * scale, body.x + body.width / 2.0);
                assert_eq!(frame.y + actual.y * scale, body.y + body.height / 2.0);
                let (panel, placement) = balloon_placement(body, area, scale, expanded, None);
                assert_eq!(panel, balloon_rect(body, area, scale, normal));
                assert_eq!(placement.orbit_anchor, None);
            }
        }
    }

    #[test]
    fn orbit_tracks_the_real_body_center_across_scale_and_movement() {
        let anchor = OrbitAnchor { x: 154.0, y: 254.0 };
        for scale in [1.0, 2.0] {
            let area = Rect {
                x: -2560.0,
                y: 50.0,
                width: 2560.0,
                height: 1390.0,
            };
            let body = Rect {
                x: area.x + 700.0 * scale,
                y: area.y + 350.0 * scale,
                width: 112.0 * scale,
                height: 88.0 * scale,
            };
            let (first, placement) =
                balloon_placement(body, area, scale, (320.0, 340.0), Some(anchor));
            assert_eq!(placement.orbit_anchor, Some(anchor));
            assert_eq!(first.x + anchor.x * scale, body.x + body.width / 2.0);
            assert_eq!(first.y + anchor.y * scale, body.y + body.height / 2.0);
            let moved = Rect {
                x: body.x + 40.0 * scale,
                y: body.y + 20.0 * scale,
                ..body
            };
            let (next, next_placement) =
                balloon_placement(moved, area, scale, (320.0, 340.0), Some(anchor));
            assert_eq!(next_placement, placement);
            assert_eq!(next.x - first.x, 40.0 * scale);
            assert_eq!(next.y - first.y, 20.0 * scale);
            let (normal, normal_placement) =
                balloon_placement(body, area, scale, (320.0, 340.0), None);
            assert_eq!(normal, balloon_rect(body, area, scale, (320.0, 340.0)));
            assert_eq!(normal_placement.orbit_anchor, None);
        }
    }

    #[test]
    fn clamped_orbit_reports_the_actual_anchor_on_all_monitor_edges() {
        let requested = OrbitAnchor {
            x: 154.25,
            y: 254.25,
        };
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
            for x in [area.x, area.x + area.width - 112.0 * scale] {
                for y in [area.y, area.y + area.height - 88.0 * scale] {
                    let body = Rect {
                        x,
                        y,
                        width: 112.0 * scale,
                        height: 88.0 * scale,
                    };
                    let (frame, placement) =
                        balloon_placement(body, area, scale, (320.0, 340.0), Some(requested));
                    let actual = placement.orbit_anchor.unwrap();
                    assert_ne!(actual, requested);
                    assert!(frame.x >= area.x && frame.y >= area.y);
                    assert!(frame.x + frame.width <= area.x + area.width);
                    assert!(frame.y + frame.height <= area.y + area.height);
                    assert_eq!(frame.x + actual.x * scale, body.x + body.width / 2.0);
                    assert_eq!(frame.y + actual.y * scale, body.y + body.height / 2.0);
                }
            }
        }
    }

    #[test]
    fn orbit_measurements_require_menu_and_finite_in_bounds_coordinates() {
        let size = (320.0, 340.0);
        let anchor = OrbitAnchor { x: 154.0, y: 254.0 };
        assert!(validate_orbit_anchor(Some(anchor), size, true).is_ok());
        assert!(validate_orbit_anchor(Some(anchor), size, false).is_err());
        assert!(validate_orbit_anchor(None, size, false).is_ok());
        for anchor in [
            OrbitAnchor {
                x: f64::NAN,
                y: 1.0,
            },
            OrbitAnchor {
                x: 1.0,
                y: f64::INFINITY,
            },
            OrbitAnchor {
                x: f64::NEG_INFINITY,
                y: 1.0,
            },
            OrbitAnchor { x: -0.5, y: 1.0 },
            OrbitAnchor { x: 1.0, y: -0.5 },
            OrbitAnchor { x: 320.5, y: 1.0 },
            OrbitAnchor { x: 1.0, y: 340.5 },
        ] {
            assert!(validate_orbit_anchor(Some(anchor), size, true).is_err());
        }
    }

    #[test]
    fn orbit_cache_rejects_stale_keys_and_clears_for_panels_owners_and_hiding() {
        let mut layout = BalloonLayout::default();
        let menu = BalloonTarget {
            key: "panel:one:menu".into(),
            owner: "one".into(),
            epoch: 1,
            input: false,
        };
        let anchor = Some(OrbitAnchor { x: 154.0, y: 254.0 });
        assert!(layout.measured(menu.clone(), &menu.key, (320.0, 340.0), anchor));
        layout.sync(Some(menu.clone()));
        assert_eq!(layout.orbit_anchor, anchor);
        assert!(!layout.measured(menu.clone(), "panel:old:menu", (320.0, 340.0), None));
        assert_eq!(layout.orbit_anchor, anchor);
        // An in-menu pause/resume panel can have the same dimensions and content key.
        assert!(layout.measured(menu.clone(), &menu.key, (320.0, 340.0), None));
        assert_eq!(layout.orbit_anchor, None);
        assert!(layout.measured(menu.clone(), &menu.key, (320.0, 340.0), anchor));
        layout.sync(Some(BalloonTarget {
            owner: "two".into(),
            ..menu.clone()
        }));
        assert_eq!(layout.orbit_anchor, None);
        assert!(layout.measured(menu.clone(), &menu.key, (320.0, 340.0), anchor));
        layout.sync(Some(BalloonTarget {
            key: "panel:one:input".into(),
            input: true,
            ..menu.clone()
        }));
        assert_eq!(layout.orbit_anchor, None);
        assert!(layout.measured(menu.clone(), &menu.key, (320.0, 340.0), anchor));
        layout.sync(None);
        assert_eq!(layout.orbit_anchor, None);
        assert_eq!(layout.size, None);
    }

    #[test]
    fn orbit_placement_response_and_movement_event_keep_the_frontend_wire_contract() {
        assert_eq!(
            serde_json::to_value(BalloonPlacement::default()).unwrap(),
            serde_json::json!({"orbitAnchor": null})
        );
        let anchor = Some(OrbitAnchor { x: 56.0, y: 44.0 });
        assert_eq!(
            serde_json::to_value(BalloonPlacement {
                orbit_anchor: anchor
            })
            .unwrap(),
            serde_json::json!({"orbitAnchor": {"x":56.0,"y":44.0}})
        );
        assert_eq!(
            serde_json::to_value(BalloonAnchorEvent {
                content_key: "panel:one:menu",
                orbit_anchor: anchor
            })
            .unwrap(),
            serde_json::json!({"contentKey":"panel:one:menu", "orbitAnchor":{"x":56.0,"y":44.0}})
        );
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
    fn story_aligns_the_character_with_the_constellation_and_keeps_its_gap() {
        for scale in [1.0, 2.0] {
            let area = Rect {
                x: -1500.0 * scale,
                y: 20.0 * scale,
                width: 1440.0 * scale,
                height: 900.0 * scale,
            };
            let body = Rect {
                x: -1100.0 * scale,
                y: 700.0 * scale,
                width: 96.0 * scale,
                height: 96.0 * scale,
            };
            for height in [230.0, 290.0, 460.0, 520.0] {
                let story = story_rect(body, area, scale, (340.0, height)).unwrap();
                assert_eq!(story.x + 70.0 * scale, body.x + body.width / 2.0);
                assert_eq!(story.y + story.height + 18.0 * scale, body.y);
                assert_eq!(story.width, 340.0 * scale);
                assert_eq!(story.height, height * scale);
            }
            let top_body = Rect {
                x: area.x,
                y: area.y,
                ..body
            };
            let story = story_rect(top_body, area, scale, (340.0, 290.0)).unwrap();
            assert_eq!(story.x, area.x);
            assert_eq!(story.y, top_body.y + top_body.height + 18.0 * scale);
            assert!(story.x + story.width <= area.x + area.width);
            assert!(story.y + story.height <= area.y + area.height);
        }
    }

    #[test]
    fn story_uses_free_space_without_covering_a_middle_character() {
        for scale in [1.0, 2.0] {
            for (area_width, area_height) in [(1440.0, 900.0), (360.0, 400.0)] {
                let area = Rect {
                    x: -1500.0 * scale,
                    y: 20.0 * scale,
                    width: area_width * scale,
                    height: area_height * scale,
                };
                let body = Rect {
                    x: area.x + area.width / 2.0 - 56.0 * scale,
                    y: area.y + area.height / 2.0 - 44.0 * scale,
                    width: 112.0 * scale,
                    height: 88.0 * scale,
                };
                let story = story_rect(body, area, scale, (340.0, 520.0)).unwrap();
                let gap = 18.0 * scale;
                assert!(story.x >= area.x && story.y >= area.y);
                assert!(story.x + story.width <= area.x + area.width);
                assert!(story.y + story.height <= area.y + area.height);
                assert!(
                    story.x + story.width + gap <= body.x
                        || story.x >= body.x + body.width + gap
                        || story.y + story.height + gap <= body.y
                        || story.y >= body.y + body.height + gap
                );
                if area_width > 1000.0 {
                    assert_eq!(story.height, 520.0 * scale);
                } else {
                    assert!(story.height < 520.0 * scale);
                }
            }
        }
        let area = Rect {
            x: 0.0,
            y: 0.0,
            width: 112.0,
            height: 88.0,
        };
        assert!(story_rect(area, area, 1.0, (340.0, 520.0)).is_none());
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
