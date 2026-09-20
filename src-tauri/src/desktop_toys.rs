use crate::desktop_geometry::{self, Edge, Geometry, Rect};
use serde::Serialize;
use std::{
    collections::BTreeMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};
#[cfg(not(target_os = "macos"))]
use tauri::Emitter;
use tauri::{AppHandle, Manager, WebviewWindow};

#[cfg(target_os = "macos")]
#[path = "desktop_toys_macos.rs"]
mod native;

const STEP: f64 = 1.0 / 120.0;
const SIZE: f64 = 56.0;
const MAX_ACTORS: usize = 8;
const BUBBLE_COUNT_MIN: usize = 3;
const BUBBLE_COUNT_MAX: usize = 6;
const BUBBLE_SIZE_MIN: f64 = 24.0;
const BUBBLE_SIZE_MAX: f64 = 48.0;
const BUBBLE_COLOR_COUNT: u8 = 6;

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum Kind {
    Ball,
    PaperPlane,
    Bubbles,
    Pet,
}
fn parse_kind(kind: &str) -> Result<Kind, String> {
    match kind {
        "ball" => Ok(Kind::Ball),
        "paper-plane" => Ok(Kind::PaperPlane),
        "bubbles" => Ok(Kind::Bubbles),
        "pet" => Ok(Kind::Pet),
        _ => Err("바탕화면에서 꺼낼 수 없는 장난감이에요.".into()),
    }
}
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Frame {
    pub id: String,
    pub kind: Kind,
    pub angle: f64,
    pub dragging: bool,
    pub moving: bool,
    pub external_windows_available: bool,
    pub bubble_size: f64,
    pub bubble_color: u8,
}
#[derive(Clone, Debug)]
pub(crate) struct Outcome {
    pub actor_id: String,
    pub widget_id: String,
    pub revision: i64,
    pub kind: Kind,
    pub owner: Option<String>,
    pub automatic: bool,
    pub distance: f64,
    pub bounces: u32,
    pub popped: bool,
}
#[derive(Clone, Copy, Debug)]
struct Motion {
    x: f64,
    y: f64,
    vx: f64,
    vy: f64,
    radius: f64,
}
struct Actor {
    id: String,
    widget_id: String,
    revision: i64,
    owner: Option<String>,
    automatic: bool,
    kind: Kind,
    motion: Motion,
    bubble_color: u8,
    scale: f64,
    angle: f64,
    distance: f64,
    bounces: u32,
    dragging: bool,
    drag_offset: (f64, f64),
    moving: bool,
    resting: f64,
    reported: bool,
    created: Instant,
    expires: Option<Instant>,
    ignore_cursor: bool,
    last_sent: Option<(f64, f64, Frame)>,
}
#[derive(Default)]
struct World {
    actors: BTreeMap<String, Actor>,
    geometry: Geometry,
    outcomes: Vec<Outcome>,
    geometry_at: Option<Instant>,
    last_geometry_ok: Option<Instant>,
    accumulator: f64,
    scales: Vec<(Rect, f64)>,
    clear_version: u64,
    widget_clear_versions: BTreeMap<String, u64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct LaunchToken {
    clear_version: u64,
    widget_clear_version: u64,
}

fn world_launch_token(world: &World, widget_id: &str) -> LaunchToken {
    LaunchToken {
        clear_version: world.clear_version,
        widget_clear_version: world
            .widget_clear_versions
            .get(widget_id)
            .copied()
            .unwrap_or_default(),
    }
}

fn cancel_pending_launches(world: &mut World, widget_id: Option<&str>) {
    if let Some(widget_id) = widget_id {
        let version = world
            .widget_clear_versions
            .entry(widget_id.into())
            .or_default();
        *version = version.wrapping_add(1);
    } else {
        world.clear_version = world.clear_version.wrapping_add(1);
        world.widget_clear_versions.clear();
    }
}

#[derive(Default)]
pub(crate) struct Runtime {
    world: Mutex<World>,
    started: AtomicBool,
    #[cfg(target_os = "macos")]
    native_updates: native::Updates,
}

#[cfg(not(target_os = "macos"))]
fn label(id: &str) -> String {
    format!("desktop-toy-{id}")
}
fn frame(actor: &Actor, geometry: &Geometry) -> Frame {
    Frame {
        id: actor.id.clone(),
        kind: actor.kind,
        angle: actor.angle,
        dragging: actor.dragging,
        moving: actor.moving,
        external_windows_available: geometry.external_windows_available,
        bubble_size: if actor.kind == Kind::Bubbles {
            actor.motion.radius * 2.0 / actor.scale
        } else {
            38.0
        },
        bubble_color: actor.bubble_color,
    }
}
fn outcome(actor: &Actor, popped: bool) -> Outcome {
    Outcome {
        actor_id: actor.id.clone(),
        widget_id: actor.widget_id.clone(),
        revision: actor.revision,
        kind: actor.kind,
        owner: actor.owner.clone(),
        automatic: actor.automatic,
        distance: actor.distance,
        bounces: actor.bounces,
        popped,
    }
}
fn initial_velocity(kind: Kind, scale: f64) -> (f64, f64) {
    match kind {
        Kind::Ball => (230.0 * scale, -270.0 * scale),
        Kind::PaperPlane => (330.0 * scale, -95.0 * scale),
        Kind::Bubbles => (20.0 * scale, -65.0 * scale),
        Kind::Pet => (45.0 * scale, 0.0),
    }
}
#[derive(Clone, Copy, Debug, PartialEq)]
struct BubbleAppearance {
    size: f64,
    color: u8,
}

fn random_fraction(seed: u128, rotation: u32) -> f64 {
    (seed.rotate_left(rotation) % 10_000) as f64 / 9_999.0
}

fn random_range(seed: u128, rotation: u32, min: f64, max: f64) -> f64 {
    min + (max - min) * random_fraction(seed, rotation)
}

fn bubble_appearance(seed: u128) -> BubbleAppearance {
    BubbleAppearance {
        size: random_range(seed, 7, BUBBLE_SIZE_MIN, BUBBLE_SIZE_MAX),
        color: (seed.rotate_left(29) % BUBBLE_COLOR_COUNT as u128) as u8,
    }
}

fn bubble_count(seed: u128, available: usize) -> usize {
    let max = BUBBLE_COUNT_MAX.min(available);
    if max == 0 {
        return 0;
    }
    if max < BUBBLE_COUNT_MIN {
        return max;
    }
    BUBBLE_COUNT_MIN + (seed % (max - BUBBLE_COUNT_MIN + 1) as u128) as usize
}

fn bubble_position(
    seed: u128,
    area: Rect,
    radius: f64,
    scale: f64,
    cursor: Option<(f64, f64)>,
    automatic: bool,
) -> (f64, f64) {
    let x_min = area.x + radius;
    let x_max = (area.x + area.width - radius).max(x_min);
    let y_min = area.y + radius;
    let y_max = (area.y + area.height - radius).max(y_min);
    let mut candidate_seed = seed;
    for _ in 0..8 {
        let candidate = (
            random_range(candidate_seed, 43, x_min, x_max),
            random_range(candidate_seed, 71, y_min, y_max),
        );
        if !automatic
            || cursor.is_none_or(|(x, y)| (x - candidate.0).hypot(y - candidate.1) >= 160.0 * scale)
        {
            return candidate;
        }
        candidate_seed = candidate_seed.rotate_left(17);
    }
    let x = cursor
        .map(|(x, _)| {
            if x < area.x + area.width / 2.0 {
                x_max
            } else {
                x_min
            }
        })
        .unwrap_or(x_min);
    let y = cursor
        .map(|(_, y)| {
            if y < area.y + area.height / 2.0 {
                y_max
            } else {
                y_min
            }
        })
        .unwrap_or(y_min);
    (x, y)
}
fn scale_at(app: &AppHandle, x: f64, y: f64) -> f64 {
    app.state::<Runtime>()
        .world
        .lock()
        .ok()
        .and_then(|world| {
            world
                .scales
                .iter()
                .find(|(area, _)| area.contains(x, y))
                .map(|(_, scale)| *scale)
        })
        .unwrap_or(1.0)
}
#[cfg(not(target_os = "macos"))]
fn set_position(window: &WebviewWindow, x: f64, y: f64) -> Result<(), String> {
    let position = tauri::Position::Physical(tauri::PhysicalPosition::new(
        x.round() as i32,
        y.round() as i32,
    ));
    window
        .set_position(position)
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "windows")]
fn apply_input_region(window: &WebviewWindow, frame: &Frame) -> Result<(), String> {
    use std::ffi::c_void;
    use windows_sys::Win32::Foundation::{HWND, POINT};
    #[link(name = "gdi32")]
    unsafe extern "system" {
        fn CreateEllipticRgn(left: i32, top: i32, right: i32, bottom: i32) -> *mut c_void;
        fn CreatePolygonRgn(points: *const POINT, count: i32, mode: i32) -> *mut c_void;
        fn DeleteObject(object: *mut c_void) -> i32;
    }
    #[link(name = "user32")]
    unsafe extern "system" {
        fn SetWindowRgn(window: HWND, region: *mut c_void, redraw: i32) -> i32;
    }
    let handle = window.hwnd().map_err(|error| error.to_string())?.0 as HWND;
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    unsafe {
        let region = if frame.kind == Kind::PaperPlane {
            let radians = frame.angle.to_radians();
            let points =
                [(-19.0, -16.0), (21.0, 0.0), (-19.0, 16.0), (-11.0, 0.0)].map(|(x, y)| POINT {
                    x: ((28.0 + x * radians.cos() - y * radians.sin()) * scale).round() as i32,
                    y: ((28.0 + x * radians.sin() + y * radians.cos()) * scale).round() as i32,
                });
            CreatePolygonRgn(points.as_ptr(), 4, 1)
        } else {
            let radius = if frame.kind == Kind::Bubbles {
                frame.bubble_size / 2.0
            } else {
                19.0
            };
            CreateEllipticRgn(
                ((28.0 - radius) * scale).round() as i32,
                ((28.0 - radius) * scale).round() as i32,
                ((28.0 + radius) * scale).round() as i32,
                ((28.0 + radius) * scale).round() as i32,
            )
        };
        if region.is_null() {
            return Err("장난감 입력 영역을 만들지 못했어요.".into());
        }
        // Windows owns a region after a successful SetWindowRgn call.
        if SetWindowRgn(handle, region, 1) == 0 {
            DeleteObject(region);
            return Err("장난감 입력 영역을 적용하지 못했어요.".into());
        }
    }
    window
        .set_ignore_cursor_events(false)
        .map_err(|error| error.to_string())
}

// Authorization belongs to the existing widget command: only pass an installed,
// enabled instance after checking its revision and the current action gate.
pub(crate) fn open(
    app: &AppHandle,
    widget_id: &str,
    kind: &str,
    owner: Option<String>,
    revision: i64,
    automatic: bool,
    geometry: &Geometry,
) -> Result<String, String> {
    let kind = parse_kind(kind)?;
    let count = if kind == Kind::Bubbles && !automatic {
        let available = available_actor_slots(app)?;
        bubble_count(uuid::Uuid::new_v4().as_u128(), available)
    } else {
        1
    };
    if count == 0 {
        return Err("먼저 꺼낸 장난감을 정리해 주세요.".into());
    }
    let mut ids = Vec::with_capacity(count);
    for _ in 0..count {
        match open_one(
            app,
            widget_id,
            kind,
            owner.clone(),
            revision,
            automatic,
            geometry,
        ) {
            Ok(id) => ids.push(id),
            Err(error) => {
                for id in ids {
                    remove_actor(app, &id);
                }
                return Err(error);
            }
        }
    }
    ids.into_iter()
        .next()
        .ok_or("장난감을 꺼내지 못했어요.".into())
}

fn available_actor_slots(app: &AppHandle) -> Result<usize, String> {
    let runtime = app.state::<Runtime>();
    let world = crate::lock(&runtime.world)?;
    Ok(MAX_ACTORS.saturating_sub(world.actors.len()))
}

fn open_one(
    app: &AppHandle,
    widget_id: &str,
    kind: Kind,
    owner: Option<String>,
    revision: i64,
    automatic: bool,
    geometry: &Geometry,
) -> Result<String, String> {
    let seed = uuid::Uuid::new_v4().as_u128();
    let cursor = desktop_geometry::cursor_position();
    let location = cursor;
    let area = geometry
        .monitors
        .iter()
        .find(|area| location.is_some_and(|(x, y)| area.contains(x, y)))
        .or_else(|| geometry.monitors.first())
        .ok_or("사용할 수 있는 화면이 없어요.")?;
    let scale = scale_at(app, area.x + area.width * 0.5, area.y + area.height * 0.5);
    let appearance = if kind == Kind::Bubbles {
        bubble_appearance(seed)
    } else {
        BubbleAppearance {
            size: 38.0,
            color: 0,
        }
    };
    let radius = if kind == Kind::Bubbles {
        appearance.size / 2.0 * scale
    } else {
        19.0 * scale
    };
    let (x, y) = if kind == Kind::Bubbles {
        bubble_position(seed, *area, radius, scale, cursor, automatic)
    } else {
        let x = (area.x + area.width * 0.25).clamp(
            area.x + radius,
            (area.x + area.width - radius).max(area.x + radius),
        );
        let y = (area.y + area.height * 0.35).clamp(
            area.y + radius,
            (area.y + area.height - radius).max(area.y + radius),
        );
        (x, y)
    };
    if automatic && cursor.is_some_and(|(cx, cy)| (cx - x).hypot(cy - y) < 160.0 * scale) {
        return Err("포인터 근처에서는 자동으로 놀지 않아요.".into());
    }
    let id = uuid::Uuid::new_v4().to_string();
    let (vx, vy) = initial_velocity(kind, scale);
    let now = Instant::now();
    let actor = Actor {
        id: id.clone(),
        widget_id: widget_id.into(),
        revision,
        owner,
        automatic,
        kind,
        motion: Motion {
            x,
            y,
            vx,
            vy,
            radius,
        },
        bubble_color: appearance.color,
        scale,
        angle: 0.0,
        distance: 0.0,
        bounces: 0,
        dragging: false,
        drag_offset: (0.0, 0.0),
        moving: true,
        resting: 0.0,
        reported: false,
        created: now,
        expires: (automatic || matches!(kind, Kind::Bubbles | Kind::Pet))
            .then_some(now + Duration::from_secs(if automatic { 20 } else { 45 })),
        ignore_cursor: true,
        last_sent: None,
    };
    #[cfg(target_os = "macos")]
    let initial_frame = frame(&actor, geometry);
    {
        let runtime = app.state::<Runtime>();
        let mut world = crate::lock(&runtime.world)?;
        if world.actors.len() >= MAX_ACTORS {
            return Err("먼저 꺼낸 장난감을 정리해 주세요.".into());
        }
        if automatic && world.actors.values().any(|actor| actor.automatic) {
            return Err("이미 함께 놀고 있어요.".into());
        }
        if automatic && world.actors.values().any(|actor| actor.dragging) {
            return Err("장난감을 조작하는 동안에는 기다릴게요.".into());
        }
        world.geometry = geometry.clone();
        world.geometry_at = Some(now);
        world.last_geometry_ok = Some(now);
        world.actors.insert(id.clone(), actor);
    }
    #[cfg(target_os = "macos")]
    {
        match native::create(app, initial_frame, x - SIZE / 2.0, y - SIZE / 2.0) {
            Ok(()) => Ok(id),
            Err(error) => {
                remove_actor(app, &id);
                Err(error)
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let app = app.clone();
        let actor_id = id.clone();
        tauri::async_runtime::spawn_blocking(move || {
            if let Err(error) = create_webview(&app, &actor_id, x, y, scale) {
                remove_actor(&app, &actor_id);
                eprintln!("desktop toy window creation failed: {error}");
            }
        });
        Ok(id)
    }
}

#[cfg(not(target_os = "macos"))]
fn create_webview(app: &AppHandle, id: &str, x: f64, y: f64, scale: f64) -> Result<(), String> {
    let built = tauri::WebviewWindowBuilder::new(
        app,
        label(id),
        tauri::WebviewUrl::App(format!("index.html?view=desktop-toy&id={id}").into()),
    )
    .title("Comet toy")
    .inner_size(SIZE, SIZE)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    .focusable(false)
    .accept_first_mouse(true)
    .visible(false)
    .build()
    .map_err(|error| error.to_string())?;
    let exists = app
        .state::<Runtime>()
        .world
        .lock()
        .map(|world| world.actors.contains_key(id))
        .unwrap_or(false);
    if !exists {
        let _ = built.close();
        return Ok(());
    }
    set_position(&built, x - SIZE * scale / 2.0, y - SIZE * scale / 2.0)?;
    built
        .set_ignore_cursor_events(true)
        .map_err(|error| error.to_string())?;
    // The renderer calls ready after its event listener and initial frame exist.
    Ok(())
}

fn remove_matching(app: &AppHandle, matches: impl Fn(&Actor) -> bool) {
    let runtime = app.state::<Runtime>();
    let ids = if let Ok(mut world) = runtime.world.lock() {
        let ids: Vec<_> = world
            .actors
            .values()
            .filter(|a| matches(a))
            .map(|a| a.id.clone())
            .collect();
        for id in &ids {
            world.actors.remove(id);
        }
        ids
    } else {
        vec![]
    };
    for id in ids {
        close_window(app, &id);
    }
}
fn close_window(app: &AppHandle, id: &str) {
    #[cfg(target_os = "macos")]
    native::close(app, id.to_string());
    #[cfg(not(target_os = "macos"))]
    if let Some(window) = app.get_webview_window(&label(id)) {
        let _ = window.close();
    }
}
pub(crate) fn remove_actor(app: &AppHandle, id: &str) {
    remove_matching(app, |actor| actor.id == id);
}
pub(crate) fn remove_widget(app: &AppHandle, id: &str) {
    remove_matching(app, |actor| actor.widget_id == id);
    if let Ok(mut world) = app.state::<Runtime>().world.lock() {
        cancel_pending_launches(&mut world, Some(id));
        world.outcomes.retain(|event| event.widget_id != id);
    }
}
pub(crate) fn clear_automatic(app: &AppHandle) {
    remove_matching(app, |actor| actor.automatic);
    if let Ok(mut world) = app.state::<Runtime>().world.lock() {
        world.outcomes.retain(|event| !event.automatic);
    }
}
pub(crate) fn clear(app: &AppHandle) {
    remove_matching(app, |_| true);
    if let Ok(mut world) = app.state::<Runtime>().world.lock() {
        cancel_pending_launches(&mut world, None);
        world.outcomes.clear();
        world.accumulator = 0.0;
    }
}
pub(crate) fn drain_outcomes(app: &AppHandle) -> Vec<Outcome> {
    app.state::<Runtime>()
        .world
        .lock()
        .map(|mut world| std::mem::take(&mut world.outcomes))
        .unwrap_or_default()
}

pub(crate) fn launch_token(app: &AppHandle, widget_id: &str) -> Result<LaunchToken, String> {
    let runtime = app.state::<Runtime>();
    let world = crate::lock(&runtime.world)?;
    Ok(world_launch_token(&world, widget_id))
}

// The caller holds the action gate through validation and actor creation.
pub(crate) fn validate_launch(
    app: &AppHandle,
    widget_id: &str,
    token: LaunchToken,
) -> Result<(), String> {
    if launch_token(app, widget_id)? != token {
        return Err("장난감을 정리해서 꺼내기를 취소했어요.".into());
    }
    Ok(())
}

// Call before entering action/DB gates: the macOS query runs on the UI thread.
pub(crate) async fn current_geometry(app: &AppHandle) -> Result<Geometry, String> {
    let runtime = app.state::<Runtime>();
    if let Ok(world) = runtime.world.lock() {
        if world.geometry.external_windows_available
            && world
                .last_geometry_ok
                .is_some_and(|at| at.elapsed() < Duration::from_millis(150))
        {
            return Ok(world.geometry.clone());
        }
    }
    let sample = request_geometry(app)
        .await
        .map_err(|_| "화면 위치를 읽지 못했어요.".to_string())?;
    let now = Instant::now();
    let result = if now.duration_since(sample.started) <= Duration::from_secs(1) {
        sample.result.clone()
    } else {
        Err("화면 위치를 제때 읽지 못했어요. 다시 시도해 주세요.".into())
    };
    let mut world = crate::lock(&runtime.world)?;
    apply_geometry(&mut world, Some(sample), now);
    result.map(|_| world.geometry.clone())
}
#[tauri::command]
pub(crate) fn desktop_toy_action(
    app: AppHandle,
    window: WebviewWindow,
    id: String,
    action: String,
) -> Result<Frame, String> {
    #[cfg(target_os = "macos")]
    {
        let _ = (app, window, id, action);
        Err("macOS 장난감은 native 창에서 조작해 주세요.".into())
    }
    #[cfg(not(target_os = "macos"))]
    {
        if window.label() != label(&id) {
            return Err("이 장난감 창에서만 조작할 수 있어요.".into());
        }
        let current = perform_action(&app, &id, &action)?;
        if action == "ready" {
            #[cfg(target_os = "windows")]
            if let Err(error) = apply_input_region(&window, &current) {
                remove_actor(&app, &id);
                return Err(error);
            }
            if let Err(error) = window.show().map_err(|error| error.to_string()) {
                remove_actor(&app, &id);
                return Err(error);
            }
        }
        Ok(current)
    }
}

fn begin_grab(actor: &mut Actor, x: f64, y: f64) {
    actor.dragging = true;
    actor.moving = true;
    actor.reported = false;
    actor.resting = 0.0;
    actor.distance = 0.0;
    actor.bounces = 0;
    actor.drag_offset = (actor.motion.x - x, actor.motion.y - y);
    actor.motion.vx = 0.0;
    actor.motion.vy = 0.0;
}

fn perform_action(app: &AppHandle, id: &str, action: &str) -> Result<Frame, String> {
    let cursor = desktop_geometry::cursor_position();
    let runtime = app.state::<Runtime>();
    let mut world = crate::lock(&runtime.world)?;
    let geometry = world.geometry.clone();
    let actor = world
        .actors
        .get_mut(id)
        .ok_or("이미 정리한 장난감이에요.")?;
    let mut popped = None;
    match action {
        "ready" | "snapshot" => {}
        "grab" => {
            let (x, y) = cursor.ok_or("포인터 위치를 읽지 못했어요.")?;
            begin_grab(actor, x, y);
        }
        "release" => {
            actor.dragging = false;
            actor.moving = true;
        }
        "cancel" => {
            actor.dragging = false;
            actor.motion.vx = 0.0;
            actor.motion.vy = 0.0;
        }
        "pop" if actor.kind == Kind::Bubbles => {
            popped = Some(outcome(actor, true));
        }
        "dismiss" => {}
        _ => return Err("알 수 없는 장난감 조작이에요.".into()),
    }
    let current = frame(actor, &geometry);
    if let Some(event) = popped {
        world.outcomes.push(event);
    }
    drop(world);
    if matches!(action, "dismiss" | "pop") {
        remove_actor(app, id);
    }
    Ok(current)
}

#[derive(Clone, Copy)]
struct Hit {
    time: f64,
    nx: f64,
    ny: f64,
}
fn segment_hit(body: Motion, edge: Edge, dt: f64) -> Option<Hit> {
    let (axis, along, velocity, tangent) = if edge.horizontal {
        (body.y, body.x, body.vy, body.vx)
    } else {
        (body.x, body.y, body.vx, body.vy)
    };
    let mut best: Option<Hit> = None;
    for side in [-1.0, 1.0] {
        if velocity * side >= 0.0 {
            continue;
        }
        let time = (edge.axis + side * body.radius - axis) / velocity;
        if time >= -1e-8 && time <= dt && (edge.from..=edge.to).contains(&(along + tangent * time))
        {
            best = Some(Hit {
                time: time.max(0.0),
                nx: if edge.horizontal { 0.0 } else { side },
                ny: if edge.horizontal { side } else { 0.0 },
            });
        }
    }
    // Rounded endpoints prevent diagonal motion from slipping through exposed corners.
    let speed2 = body.vx * body.vx + body.vy * body.vy;
    if speed2 > 1e-10 {
        for endpoint in [edge.from, edge.to] {
            let (ex, ey) = if edge.horizontal {
                (endpoint, edge.axis)
            } else {
                (edge.axis, endpoint)
            };
            let dx = body.x - ex;
            let dy = body.y - ey;
            let b = 2.0 * (dx * body.vx + dy * body.vy);
            let c = dx * dx + dy * dy - body.radius * body.radius;
            let discriminant = b * b - 4.0 * speed2 * c;
            if discriminant < 0.0 {
                continue;
            }
            let time = (-b - discriminant.sqrt()) / (2.0 * speed2);
            if time < -1e-8 || time > dt || best.is_some_and(|hit| hit.time <= time) {
                continue;
            }
            let nx = (dx + body.vx * time) / body.radius;
            let ny = (dy + body.vy * time) / body.radius;
            if nx * body.vx + ny * body.vy < 0.0 {
                best = Some(Hit {
                    time: time.max(0.0),
                    nx,
                    ny,
                });
            }
        }
    }
    best
}
fn resolve_overlap(body: &mut Motion, edges: &[Edge], scale: f64) {
    for edge in edges {
        let (axis, along, velocity) = if edge.horizontal {
            (body.y, body.x, body.vy)
        } else {
            (body.x, body.y, body.vx)
        };
        if along < edge.from || along > edge.to {
            continue;
        }
        let delta = axis - edge.axis;
        if delta.abs() >= body.radius {
            continue;
        }
        let side = if delta.abs() > 1e-6 {
            delta.signum()
        } else if velocity > 0.0 {
            -1.0
        } else {
            1.0
        };
        if edge.horizontal {
            body.y = edge.axis + side * (body.radius + 0.01 * scale);
            body.vy = body.vy.max(-600.0 * scale).min(600.0 * scale);
        } else {
            body.x = edge.axis + side * (body.radius + 0.01 * scale);
            body.vx = body.vx.max(-600.0 * scale).min(600.0 * scale);
        }
    }
}
fn advance_motion(
    body: &mut Motion,
    edges: &[Edge],
    dt: f64,
    restitution: f64,
    friction: f64,
) -> (u32, bool) {
    let mut remaining = dt;
    let mut bounces = 0;
    let mut support = false;
    for _ in 0..8 {
        let hit = edges
            .iter()
            .filter_map(|edge| segment_hit(*body, *edge, remaining))
            .min_by(|left, right| left.time.total_cmp(&right.time));
        let Some(hit) = hit else {
            body.x += body.vx * remaining;
            body.y += body.vy * remaining;
            break;
        };
        body.x += body.vx * hit.time;
        body.y += body.vy * hit.time;
        let normal = body.vx * hit.nx + body.vy * hit.ny;
        let tangent_x = body.vx - normal * hit.nx;
        let tangent_y = body.vy - normal * hit.ny;
        body.vx = tangent_x * friction - restitution * normal * hit.nx;
        body.vy = tangent_y * friction - restitution * normal * hit.ny;
        body.x += hit.nx * 0.01;
        body.y += hit.ny * 0.01;
        remaining -= hit.time;
        bounces += 1;
        support |= hit.ny < -0.5;
        if remaining <= 1e-8 {
            break;
        }
    }
    (bounces, support)
}
#[cfg(not(target_os = "macos"))]
fn hit_shape(actor: &Actor, x: f64, y: f64) -> bool {
    let dx = (x - actor.motion.x) / actor.scale;
    let dy = (y - actor.motion.y) / actor.scale;
    if actor.kind == Kind::PaperPlane {
        let angle = actor.angle.to_radians();
        let px = dx * angle.cos() + dy * angle.sin();
        let py = -dx * angle.sin() + dy * angle.cos();
        return (-19.0..=21.0).contains(&px) && py.abs() <= (21.0 - px) * 0.4;
    }
    dx.hypot(dy) <= actor.motion.radius / actor.scale
}
fn supported(body: Motion, edges: &[Edge]) -> bool {
    edges.iter().any(|edge| {
        edge.horizontal
            && body.x >= edge.from
            && body.x <= edge.to
            && (edge.axis - body.y - body.radius).abs() < 1.0
    })
}

fn append_character_edges(body: Motion, geometry: &Geometry, dt: f64, edges: &mut Vec<Edge>) {
    // A rebound can travel in any direction. Include the support tolerance and
    // collision nudges as well as the circle's full swept reach.
    let reach = body.radius + body.vx.hypot(body.vy) * dt + 1.0;
    let query = Rect {
        x: body.x - reach,
        y: body.y - reach,
        width: reach * 2.0,
        height: reach * 2.0,
    };
    for character in &geometry.characters {
        character
            .shape
            .append_edges(character.origin, character.scale, query, edges);
    }
}

fn step(actor: &mut Actor, geometry: &Geometry, dt: f64) -> Option<Outcome> {
    if actor.dragging {
        return None;
    }
    let mut character_edges = Vec::new();
    if !actor.moving {
        append_character_edges(actor.motion, geometry, 0.0, &mut character_edges);
        if supported(actor.motion, &geometry.edges) || supported(actor.motion, &character_edges) {
            return None;
        }
        character_edges.clear();
    }
    actor.moving = true;
    resolve_overlap(&mut actor.motion, &geometry.edges, actor.scale);
    append_character_edges(actor.motion, geometry, 0.0, &mut character_edges);
    resolve_overlap(&mut actor.motion, &character_edges, actor.scale);
    let old = (actor.motion.x, actor.motion.y);
    match actor.kind {
        Kind::Ball => {
            actor.motion.vy += 780.0 * actor.scale * dt;
            actor.motion.vx *= (-0.12 * dt).exp();
        }
        Kind::PaperPlane => {
            actor.motion.vy += 150.0 * actor.scale * dt;
            actor.motion.vx *= (-0.2 * dt).exp();
            actor.motion.vy *= (-0.65 * dt).exp();
        }
        Kind::Bubbles => {
            actor.motion.vy = -65.0 * actor.scale;
        }
        Kind::Pet => {
            actor.motion.vy += 780.0 * actor.scale * dt;
            actor.motion.vx = if actor.motion.vx < 0.0 { -45.0 } else { 45.0 } * actor.scale;
        }
    }
    // Gather again after overlap correction and acceleration, so neither can
    // move the swept path outside the character contour query.
    character_edges.clear();
    append_character_edges(actor.motion, geometry, dt, &mut character_edges);
    let edges = if character_edges.is_empty() {
        geometry.edges.as_slice()
    } else {
        character_edges.extend_from_slice(&geometry.edges);
        character_edges.as_slice()
    };
    let restitution = match actor.kind {
        Kind::Ball => 0.66,
        Kind::PaperPlane => 0.16,
        Kind::Pet => 0.0,
        Kind::Bubbles => 0.5,
    };
    let incoming_vx = actor.motion.vx;
    let (hits, on_ground) = advance_motion(
        &mut actor.motion,
        edges,
        dt,
        restitution,
        if actor.kind == Kind::Pet { 1.0 } else { 0.82 },
    );
    if actor.kind == Kind::Pet && hits > 0 && actor.motion.vx.abs() < 1.0 {
        actor.motion.vx = -incoming_vx;
    }
    if actor.kind == Kind::Bubbles && hits > 0 && !actor.reported {
        actor.reported = true;
        actor.expires = Some(Instant::now());
        return Some(outcome(actor, true));
    }
    actor.bounces = actor.bounces.saturating_add(hits);
    actor.distance += (actor.motion.x - old.0).hypot(actor.motion.y - old.1) / actor.scale;
    if actor.kind == Kind::PaperPlane {
        actor.angle = actor.motion.vy.atan2(actor.motion.vx).to_degrees();
    }
    if actor.kind == Kind::Ball {
        actor.angle += actor.motion.vx / actor.motion.radius * dt * 180.0 / std::f64::consts::PI;
    }
    if actor.kind == Kind::Pet {
        actor.angle = if actor.motion.vx < 0.0 { 180.0 } else { 0.0 };
    }
    if (on_ground || supported(actor.motion, edges))
        && actor.motion.vx.hypot(actor.motion.vy) < 30.0 * actor.scale
    {
        actor.resting += dt;
    } else {
        actor.resting = 0.0;
    }
    if actor.resting > 0.18 && actor.kind != Kind::Pet {
        actor.motion.vx = 0.0;
        actor.motion.vy = 0.0;
        actor.moving = false;
        if !actor.reported {
            actor.reported = true;
            return Some(outcome(actor, false));
        }
    }
    None
}

struct GeometrySample {
    started: Instant,
    result: Result<Geometry, String>,
    scales: Option<Vec<(Rect, f64)>>,
}

fn capture_geometry(_app: &AppHandle) -> GeometrySample {
    let started = Instant::now();
    crate::character_collision_host::refresh_all(_app);
    let result = desktop_geometry::capture();
    #[cfg(target_os = "windows")]
    let scales = {
        _app.available_monitors().ok().map(|monitors| {
            monitors
                .into_iter()
                .map(|monitor| {
                    let p = monitor.position();
                    let size = monitor.size();
                    (
                        Rect {
                            x: p.x as f64,
                            y: p.y as f64,
                            width: size.width as f64,
                            height: size.height as f64,
                        },
                        monitor.scale_factor(),
                    )
                })
                .collect::<Vec<_>>()
        })
    };
    #[cfg(not(target_os = "windows"))]
    let scales: Option<Vec<(Rect, f64)>> = None;

    GeometrySample {
        started,
        result,
        scales,
    }
}

fn request_geometry(app: &AppHandle) -> tokio::sync::oneshot::Receiver<GeometrySample> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let capture_app = app.clone();
    let capture = move || {
        let _ = sender.send(capture_geometry(&capture_app));
    };
    // Quartz window queries share a connection lock with AppKit commits.
    // Running them on a worker can stall both threads until a timeout.
    #[cfg(target_os = "macos")]
    let _ = app.run_on_main_thread(capture);
    #[cfg(not(target_os = "macos"))]
    tauri::async_runtime::spawn_blocking(capture);
    receiver
}

fn poll_geometry(
    pending: &mut Option<tokio::sync::oneshot::Receiver<GeometrySample>>,
) -> Option<GeometrySample> {
    let result = pending.as_mut()?.try_recv();
    match result {
        Ok(sample) => {
            *pending = None;
            Some(sample)
        }
        Err(tokio::sync::oneshot::error::TryRecvError::Closed) => {
            *pending = None;
            None
        }
        Err(tokio::sync::oneshot::error::TryRecvError::Empty) => None,
    }
}

fn apply_geometry(world: &mut World, sample: Option<GeometrySample>, now: Instant) {
    // A launch can install newer geometry while this OS query is still running.
    if let Some(sample) =
        sample.filter(|sample| world.geometry_at.is_none_or(|at| at <= sample.started))
    {
        world.geometry_at = Some(sample.started);
        match sample.result {
            Ok(geometry) if now.duration_since(sample.started) <= Duration::from_secs(1) => {
                world.geometry = geometry;
                world.last_geometry_ok = Some(sample.started);
                if let Some(scales) = sample.scales {
                    world.scales = scales;
                }
            }
            _ => world.geometry.external_windows_available = false,
        }
    }
    // A stalled query must not keep obsolete window edges alive indefinitely.
    if world
        .last_geometry_ok
        .is_none_or(|at| now.duration_since(at) > Duration::from_secs(1))
    {
        world.geometry.external_windows_available = false;
        world.geometry.edges = desktop_geometry::monitor_edges(&world.geometry.monitors);
    }
}

pub(crate) fn start(app: AppHandle) {
    if app.state::<Runtime>().started.swap(true, Ordering::SeqCst) {
        return;
    }
    tauri::async_runtime::spawn(async move {
        let mut timer = tokio::time::interval(Duration::from_millis(16));
        timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut previous = Instant::now();
        let mut pending_geometry = None;
        loop {
            timer.tick().await;
            let now = Instant::now();
            let elapsed = now.duration_since(previous).as_secs_f64();
            previous = now;
            let runtime = app.state::<Runtime>();
            let refresh = runtime
                .world
                .lock()
                .map(|world| {
                    !world.actors.is_empty()
                        && world
                            .geometry_at
                            .is_none_or(|at| now.duration_since(at) >= Duration::from_millis(150))
                })
                .unwrap_or(false);
            let active = runtime
                .world
                .lock()
                .map(|world| !world.actors.is_empty())
                .unwrap_or(false);
            let captured = poll_geometry(&mut pending_geometry);
            if !active {
                continue;
            }
            if refresh && pending_geometry.is_none() && captured.is_none() {
                pending_geometry = Some(request_geometry(&app));
            }
            let characters = crate::character_collision_host::colliders(&app);
            let cursor = desktop_geometry::cursor_position();
            let mut displays = vec![];
            let mut removed = vec![];
            {
                let Ok(mut world) = runtime.world.lock() else {
                    continue;
                };
                if world.actors.is_empty() {
                    world.accumulator = 0.0;
                    continue;
                }
                if elapsed > 1.0 {
                    // Sleep/resume is not elapsed play time and must never replay a launch.
                    removed.extend(world.actors.keys().cloned());
                    world.actors.clear();
                    world.outcomes.clear();
                    world.accumulator = 0.0;
                }
                apply_geometry(&mut world, captured, now);
                let scales = world.scales.clone();
                let mut geometry = world.geometry.clone();
                geometry.characters = characters;
                world.accumulator = (world.accumulator + elapsed.min(0.1)).min(0.1);
                let steps = (world.accumulator / STEP).floor() as usize;
                world.accumulator -= steps as f64 * STEP;
                let mut outcomes = vec![];
                for actor in world.actors.values_mut() {
                    if let Some((_, scale)) = scales
                        .iter()
                        .find(|(area, _)| area.contains(actor.motion.x, actor.motion.y))
                    {
                        if *scale != actor.scale {
                            let ratio = *scale / actor.scale;
                            actor.motion.radius *= ratio;
                            actor.motion.vx *= ratio;
                            actor.motion.vy *= ratio;
                            actor.scale = *scale;
                        }
                    }
                    if actor.expires.is_some_and(|at| at <= now)
                        || now.duration_since(actor.created) > Duration::from_secs(3600)
                    {
                        if !actor.reported {
                            outcomes.push(outcome(actor, false));
                        }
                        removed.push(actor.id.clone());
                        continue;
                    }
                    if let Some(area) = geometry.monitors.iter().min_by(|left, right| {
                        let distance = |r: &&Rect| {
                            (actor.motion.x - actor.motion.x.clamp(r.x, r.x + r.width))
                                .hypot(actor.motion.y - actor.motion.y.clamp(r.y, r.y + r.height))
                        };
                        distance(left).total_cmp(&distance(right))
                    }) {
                        if !geometry
                            .monitors
                            .iter()
                            .any(|area| area.contains(actor.motion.x, actor.motion.y))
                        {
                            actor.motion.x = actor.motion.x.clamp(
                                area.x + actor.motion.radius,
                                (area.x + area.width - actor.motion.radius)
                                    .max(area.x + actor.motion.radius),
                            );
                            actor.motion.y = actor.motion.y.clamp(
                                area.y + actor.motion.radius,
                                (area.y + area.height - actor.motion.radius)
                                    .max(area.y + actor.motion.radius),
                            );
                            actor.motion.vx = 0.0;
                            actor.motion.vy = 0.0;
                        }
                    }
                    if actor.dragging {
                        if let Some((cx, cy)) = cursor {
                            let x = cx + actor.drag_offset.0;
                            let y = cy + actor.drag_offset.1;
                            let limit = 1600.0 * actor.scale;
                            actor.motion.vx =
                                ((x - actor.motion.x) / elapsed.max(0.001)).clamp(-limit, limit);
                            actor.motion.vy =
                                ((y - actor.motion.y) / elapsed.max(0.001)).clamp(-limit, limit);
                            actor.motion.x = x;
                            actor.motion.y = y;
                        }
                    } else {
                        for _ in 0..steps {
                            if let Some(event) = step(actor, &geometry, STEP) {
                                outcomes.push(event);
                            }
                        }
                    }
                    #[cfg(target_os = "macos")]
                    let hit = false;
                    #[cfg(not(target_os = "macos"))]
                    let hit = cursor.is_some_and(|(x, y)| hit_shape(actor, x, y));
                    let ignore = !actor.dragging && !hit;
                    let input_change = (ignore != actor.ignore_cursor).then_some(ignore);
                    actor.ignore_cursor = ignore;
                    let current = (
                        actor.motion.x - SIZE * actor.scale / 2.0,
                        actor.motion.y - SIZE * actor.scale / 2.0,
                        frame(actor, &geometry),
                    );
                    if actor.last_sent.as_ref() != Some(&current) || input_change.is_some() {
                        displays.push((
                            actor.id.clone(),
                            current.0,
                            current.1,
                            input_change,
                            current.2.clone(),
                        ));
                        actor.last_sent = Some(current);
                    }
                }
                for id in &removed {
                    world.actors.remove(id);
                }
                world.outcomes.extend(outcomes);
            }
            for id in removed {
                close_window(&app, &id);
            }
            for (id, x, y, input_change, frame) in displays {
                #[cfg(target_os = "macos")]
                {
                    let _ = input_change;
                    native::update(&app, id, x, y, frame);
                }
                #[cfg(not(target_os = "macos"))]
                if let Some(window) = app.get_webview_window(&label(&id)) {
                    let _ = set_position(&window, x, y);
                    #[cfg(target_os = "windows")]
                    {
                        let _ = input_change;
                        let _ = apply_input_region(&window, &frame);
                    }
                    #[cfg(not(target_os = "windows"))]
                    if let Some(ignore) = input_change {
                        let _ = window.set_ignore_cursor_events(ignore);
                    }
                    let _ = window.emit("desktop-toy-frame", frame);
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clearing_cancels_pending_launches_without_blocking_new_or_unrelated_requests() {
        let mut world = World::default();
        let pending_ball = world_launch_token(&world, "ball");
        let pending_plane = world_launch_token(&world, "plane");

        // A clear must cancel an in-flight launch even before it created an actor.
        assert!(world.actors.is_empty());
        cancel_pending_launches(&mut world, Some("ball"));
        assert_ne!(pending_ball, world_launch_token(&world, "ball"));
        assert_eq!(pending_plane, world_launch_token(&world, "plane"));

        let new_ball = world_launch_token(&world, "ball");
        cancel_pending_launches(&mut world, Some("plane"));
        assert_eq!(new_ball, world_launch_token(&world, "ball"));
        cancel_pending_launches(&mut world, None);
        assert_ne!(new_ball, world_launch_token(&world, "ball"));
        assert_ne!(pending_plane, world_launch_token(&world, "plane"));
        assert_ne!(pending_ball, world_launch_token(&world, "ball"));

        let new_plane = world_launch_token(&world, "plane");
        cancel_pending_launches(&mut world, Some("ball"));
        assert_eq!(new_plane, world_launch_token(&world, "plane"));
    }

    #[test]
    fn bubbles_randomize_count_position_size_and_color_within_safe_bounds() {
        let area = Rect {
            x: -400.0,
            y: 20.0,
            width: 1200.0,
            height: 800.0,
        };
        let counts: Vec<_> = (0..32).map(|seed| bubble_count(seed, MAX_ACTORS)).collect();
        assert!(counts
            .iter()
            .all(|count| (BUBBLE_COUNT_MIN..=BUBBLE_COUNT_MAX).contains(count)));
        assert!(counts.windows(2).any(|pair| pair[0] != pair[1]));

        let samples: Vec<_> = (1..=8)
            .map(|seed| {
                let appearance = bubble_appearance(seed);
                let radius = appearance.size / 2.0;
                let position = bubble_position(seed, area, radius, 1.0, None, false);
                (appearance, position, radius)
            })
            .collect();
        assert!(samples.iter().all(|(appearance, (x, y), radius)| {
            (BUBBLE_SIZE_MIN..=BUBBLE_SIZE_MAX).contains(&appearance.size)
                && (0..BUBBLE_COLOR_COUNT).contains(&appearance.color)
                && *x >= area.x + radius
                && *x <= area.x + area.width - radius
                && *y >= area.y + radius
                && *y <= area.y + area.height - radius
        }));
        assert!(samples
            .windows(2)
            .any(|pair| pair[0].0.size != pair[1].0.size));
        assert!(samples
            .windows(2)
            .any(|pair| pair[0].0.color != pair[1].0.color));
        assert!(samples.windows(2).any(|pair| pair[0].1 != pair[1].1));
    }

    fn resting_ball() -> Actor {
        Actor {
            id: "test".into(),
            widget_id: "widget".into(),
            revision: 1,
            owner: None,
            automatic: false,
            kind: Kind::Ball,
            motion: Motion {
                x: 50.0,
                y: 80.0,
                vx: 0.0,
                vy: 0.0,
                radius: 10.0,
            },
            bubble_color: 0,
            scale: 1.0,
            angle: 0.0,
            distance: 0.0,
            bounces: 0,
            dragging: false,
            drag_offset: (0.0, 0.0),
            moving: true,
            resting: 0.0,
            reported: false,
            created: Instant::now(),
            expires: None,
            ignore_cursor: true,
            last_sent: None,
        }
    }
    #[test]
    fn pending_geometry_does_not_block_toy_motion_and_is_consumed_once() {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        let mut pending = Some(receiver);
        for kind in [Kind::Ball, Kind::PaperPlane, Kind::Bubbles] {
            let mut actor = resting_ball();
            actor.kind = kind;
            let start = (actor.motion.x, actor.motion.y);
            for _ in 0..60 {
                assert!(poll_geometry(&mut pending).is_none());
                step(&mut actor, &Geometry::default(), STEP);
            }
            assert_ne!((actor.motion.x, actor.motion.y), start);
        }
        assert!(pending.is_some());
        assert!(sender
            .send(GeometrySample {
                started: Instant::now(),
                result: Ok(Geometry::default()),
                scales: None,
            })
            .is_ok());
        assert!(poll_geometry(&mut pending).is_some());
        assert!(poll_geometry(&mut pending).is_none());
        assert!(pending.is_none());
    }

    #[test]
    fn late_geometry_cannot_replace_a_newer_launch_snapshot() {
        let now = Instant::now();
        let mut world = World {
            geometry: Geometry {
                fullscreen: true,
                external_windows_available: true,
                ..Geometry::default()
            },
            geometry_at: Some(now),
            last_geometry_ok: Some(now),
            ..World::default()
        };
        for result in [Ok(Geometry::default()), Err("query failed".into())] {
            apply_geometry(
                &mut world,
                Some(GeometrySample {
                    started: now - Duration::from_millis(100),
                    result,
                    scales: Some(vec![]),
                }),
                now,
            );
            assert!(world.geometry.fullscreen);
            assert!(world.geometry.external_windows_available);
            assert_eq!(world.geometry_at, Some(now));
        }
    }

    #[test]
    fn unavailable_geometry_keeps_a_short_grace_then_uses_only_screen_edges() {
        let now = Instant::now();
        let mut world = World {
            geometry: Geometry {
                monitors: vec![Rect {
                    x: 0.0,
                    y: 0.0,
                    width: 1000.0,
                    height: 800.0,
                }],
                edges: vec![Edge {
                    horizontal: true,
                    axis: 123.0,
                    from: 0.0,
                    to: 500.0,
                }],
                external_windows_available: true,
                ..Geometry::default()
            },
            geometry_at: Some(now),
            last_geometry_ok: Some(now),
            ..World::default()
        };
        apply_geometry(
            &mut world,
            Some(GeometrySample {
                started: now + Duration::from_millis(150),
                result: Err("query failed".into()),
                scales: None,
            }),
            now + Duration::from_millis(200),
        );
        assert!(!world.geometry.external_windows_available);
        assert_eq!(world.geometry.edges.len(), 1);
        // The next query is still pending; expiry cannot depend on it returning.
        apply_geometry(&mut world, None, now + Duration::from_millis(1100));
        assert_eq!(world.geometry.edges.len(), 4);
        assert!(world.geometry.edges.iter().all(|edge| edge.axis != 123.0));
        apply_geometry(
            &mut world,
            Some(GeometrySample {
                started: now + Duration::from_millis(250),
                result: Ok(Geometry::default()),
                scales: None,
            }),
            now + Duration::from_millis(1400),
        );
        assert!(!world.geometry.external_windows_available);
        assert_eq!(world.geometry.edges.len(), 4);
        assert_eq!(world.last_geometry_ok, Some(now));
    }

    #[test]
    fn resting_on_a_window_emits_one_result_and_removing_it_resumes_gravity() {
        let mut actor = resting_ball();
        let geometry = Geometry {
            edges: vec![Edge {
                horizontal: true,
                axis: 100.0,
                from: 0.0,
                to: 300.0,
            }],
            ..Geometry::default()
        };
        let outcomes: Vec<_> = (0..600)
            .filter_map(|_| step(&mut actor, &geometry, STEP))
            .collect();
        assert_eq!(outcomes.len(), 1);
        assert!(!actor.moving);
        let y = actor.motion.y;
        step(&mut actor, &Geometry::default(), STEP);
        assert!(actor.moving && actor.motion.y > y);
    }
    #[test]
    fn drag_bypasses_all_physics_until_release() {
        let mut actor = resting_ball();
        actor.dragging = true;
        let geometry = Geometry {
            edges: vec![Edge {
                horizontal: true,
                axis: actor.motion.y,
                from: 0.0,
                to: 300.0,
            }],
            ..Geometry::default()
        };
        let y = actor.motion.y;
        assert!(step(&mut actor, &geometry, 1.0).is_none());
        assert_eq!(actor.motion.y, y);
        actor.dragging = false;
        step(&mut actor, &geometry, STEP);
        assert!((actor.motion.y - y).abs() >= actor.motion.radius);
    }
    #[test]
    fn grabbing_starts_a_new_throw_without_accumulating_earlier_results() {
        let mut actor = resting_ball();
        actor.distance = 700.0;
        actor.bounces = 21;
        actor.reported = true;
        begin_grab(&mut actor, 45.0, 75.0);
        assert_eq!(actor.distance, 0.0);
        assert_eq!(actor.bounces, 0);
        assert!(!actor.reported && actor.dragging);
        assert_eq!(actor.drag_offset, (5.0, 5.0));
    }
    #[test]
    fn fast_ball_hits_both_sides_of_window_edges_without_tunneling() {
        let edge = Edge {
            horizontal: false,
            axis: 100.0,
            from: 0.0,
            to: 300.0,
        };
        for (x, vx, expected) in [(50.0, 2000.0, -1.0), (150.0, -2000.0, 1.0)] {
            let mut body = Motion {
                x,
                y: 100.0,
                vx,
                vy: 0.0,
                radius: 10.0,
            };
            let (hits, _) = advance_motion(&mut body, &[edge], 0.1, 0.5, 1.0);
            assert_eq!(hits, 1);
            assert_eq!(body.vx.signum(), expected);
            assert_eq!((body.x - 100.0).signum(), expected);
        }
    }
    #[test]
    fn diagonal_flight_hits_exposed_corner_and_keeps_finite_state() {
        let mut body = Motion {
            x: 70.0,
            y: 70.0,
            vx: 500.0,
            vy: 500.0,
            radius: 12.0,
        };
        let edge = Edge {
            horizontal: true,
            axis: 100.0,
            from: 100.0,
            to: 200.0,
        };
        let (hits, _) = advance_motion(&mut body, &[edge], 0.15, 0.6, 0.9);
        assert_eq!(hits, 1);
        assert!(body.vx < 0.0 && body.vy < 0.0);
        assert!(body.x.is_finite() && body.y.is_finite());
    }
    #[test]
    fn moving_window_resolves_overlap_without_launching_the_ball() {
        let mut body = Motion {
            x: 101.0,
            y: 60.0,
            vx: 0.0,
            vy: 0.0,
            radius: 10.0,
        };
        resolve_overlap(
            &mut body,
            &[Edge {
                horizontal: false,
                axis: 100.0,
                from: 0.0,
                to: 200.0,
            }],
            1.0,
        );
        assert!(body.x > 110.0);
        assert_eq!(body.vx, 0.0);
    }

    fn character_geometry(pixels: &[&str], bounds: Rect) -> Geometry {
        let columns = pixels[0].len();
        let rows = pixels.len();
        let mut bits = vec![0; (columns * rows).div_ceil(8)];
        for (row, pixels) in pixels.iter().enumerate() {
            for (column, pixel) in pixels.bytes().enumerate() {
                if pixel == b'#' {
                    let index = row * columns + column;
                    bits[index / 8] |= 1 << (index % 8);
                }
            }
        }
        let shape =
            crate::character_collision::Shape::from_mask(crate::character_collision::Mask {
                x: 0.0,
                y: 0.0,
                width: bounds.width,
                height: bounds.height,
                columns,
                rows,
                bits,
            })
            .unwrap();
        Geometry {
            characters: vec![crate::character_collision::Collider {
                shape: std::sync::Arc::new(shape),
                origin: (bounds.x, bounds.y),
                scale: 1.0,
            }],
            ..Geometry::default()
        }
    }

    #[test]
    fn ball_and_plane_bounce_off_opaque_character_pixels() {
        let geometry = character_geometry(
            &["#"],
            Rect {
                x: 100.0,
                y: 0.0,
                width: 40.0,
                height: 200.0,
            },
        );
        for kind in [Kind::Ball, Kind::PaperPlane] {
            let mut actor = resting_ball();
            actor.kind = kind;
            actor.motion.vx = 1000.0;
            step(&mut actor, &geometry, 0.1);
            assert!(actor.bounces > 0);
            assert!(actor.motion.x < 90.0);
            assert!(actor.motion.vx < 0.0);
        }
    }

    #[test]
    fn transparent_character_gap_does_not_collide_with_the_image_rectangle() {
        let geometry = character_geometry(
            &["#.#"],
            Rect {
                x: 100.0,
                y: 0.0,
                width: 120.0,
                height: 200.0,
            },
        );
        let mut actor = resting_ball();
        actor.motion.x = 160.0;
        actor.motion.y = -40.0;
        actor.motion.vy = 1000.0;
        step(&mut actor, &geometry, 0.1);
        assert_eq!(actor.bounces, 0);
        assert_eq!(actor.motion.x, 160.0);
        assert!(actor.motion.y > 0.0);
    }

    #[test]
    fn bubble_pops_on_the_character_contour() {
        let geometry = character_geometry(
            &["#"],
            Rect {
                x: 0.0,
                y: 40.0,
                width: 200.0,
                height: 20.0,
            },
        );
        let mut actor = resting_ball();
        actor.kind = Kind::Bubbles;
        let result = step(&mut actor, &geometry, 0.4).expect("bubble touches the opaque pixels");
        assert!(result.popped);
        assert!(actor.reported);
        assert!(actor.expires.is_some());
    }

    #[test]
    fn character_support_settles_once_and_resumes_when_the_character_disappears() {
        let geometry = character_geometry(
            &["....#", "...##", "..###", ".####", "#####"],
            Rect {
                x: 0.0,
                y: 100.0,
                width: 100.0,
                height: 100.0,
            },
        );
        let mut actor = resting_ball();
        let outcomes: Vec<_> = (0..600)
            .filter_map(|_| step(&mut actor, &geometry, STEP))
            .collect();
        assert_eq!(outcomes.len(), 1);
        assert!(!actor.moving);
        let y = actor.motion.y;
        step(&mut actor, &Geometry::default(), STEP);
        assert!(actor.moving && actor.motion.y > y);
    }

    #[test]
    fn character_candidates_cover_rebounds_in_the_same_step() {
        let geometry = character_geometry(
            &["#..#"],
            Rect {
                x: 40.0,
                y: 0.0,
                width: 40.0,
                height: 200.0,
            },
        );
        let mut actor = resting_ball();
        actor.motion.x = 60.0;
        actor.motion.radius = 3.0;
        actor.motion.vx = 200.0;
        step(&mut actor, &geometry, 0.2);
        assert!(actor.bounces >= 2);
        assert!((53.0..=67.0).contains(&actor.motion.x));
    }
}
