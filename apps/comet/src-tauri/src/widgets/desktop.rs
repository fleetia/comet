use crate::{
    app::AppState,
    lock,
    widgets::{self, storage},
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    sync::{atomic::Ordering, Arc, Mutex},
    time::Duration,
};
use tauri::{Emitter, Manager};

const KEY: &str = "desktop-layout-v1";
const STACK: &str = "widget-stack";
const EDITOR: &str = "widget-editor";
const DISPLAY: &str = "widget-display-";
const MARGIN: f64 = 12.0;
const SNAP: f64 = 8.0;
const INSET: f64 = 24.0;
const EDITOR_WIDTH: f64 = 360.0;

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum Mode {
    Freeform,
    #[default]
    Stack,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum Anchor {
    TopLeft,
    #[default]
    TopRight,
    BottomLeft,
    BottomRight,
}
/// Stack row width in logical pixels. Layouts saved before pixel widths stored a named size.
#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(transparent)]
pub(crate) struct Width(pub u16);
impl Width {
    const MIN: u16 = 280;
    const MAX: u16 = 600;
    fn valid(self) -> bool {
        (Self::MIN..=Self::MAX).contains(&self.0)
    }
}
impl Default for Width {
    fn default() -> Self {
        Self(370)
    }
}
impl<'de> Deserialize<'de> for Width {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Raw {
            Pixels(f64),
            Named(String),
        }
        Ok(match Raw::deserialize(deserializer)? {
            Raw::Pixels(value) if value.is_finite() && value >= 0.0 && value <= u16::MAX as f64 => {
                Self(value.round() as u16)
            }
            Raw::Pixels(_) => return Err(serde::de::Error::custom("invalid stack width")),
            Raw::Named(name) => match name.as_str() {
                "narrow" => Self(330),
                "wide" => Self(410),
                _ => Self::default(),
            },
        })
    }
}

/// How one widget looks inside the stack. Freeform appearance is stored with the widget itself.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StackStyle {
    pub follow_theme: bool,
    pub background_color: String,
    pub text_color: String,
    /// Background opacity in percent; the theme's own translucency is multiplied by it.
    pub opacity: u8,
    pub radius: u8,
}
impl StackStyle {
    fn valid(&self) -> bool {
        let hex = |value: &str| {
            value.len() == 7
                && value.starts_with('#')
                && value[1..].chars().all(|c| c.is_ascii_hexdigit())
        };
        hex(&self.background_color)
            && hex(&self.text_color)
            && self.opacity <= 100
            && self.radius <= 24
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct Layout {
    pub mode: Mode,
    pub order: Vec<String>,
    pub anchor: Anchor,
    pub width: Width,
    pub overlapped: bool,
    pub one_expanded: bool,
    pub positions: BTreeMap<String, Point>,
    pub shapes: BTreeMap<String, Shape>,
    pub stack_styles: BTreeMap<String, StackStyle>,
    pub snap_to_grid: bool,
    pub show_guides: bool,
    pub stack_position: Option<Point>,
    /// The user closed the stack; it stays closed across restarts until opened again.
    pub stack_hidden: bool,
}
impl Default for Layout {
    fn default() -> Self {
        Self {
            mode: Mode::Stack,
            order: vec![],
            anchor: Anchor::TopRight,
            width: Width::default(),
            overlapped: true,
            one_expanded: true,
            positions: BTreeMap::new(),
            shapes: BTreeMap::new(),
            stack_styles: BTreeMap::new(),
            snap_to_grid: false,
            show_guides: true,
            stack_position: None,
            stack_hidden: false,
        }
    }
}
fn default_show_guides() -> bool {
    true
}

/// Everything except the saved geometry, which only drags, shape edits and restores change.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LayoutSettings {
    pub mode: Mode,
    pub order: Vec<String>,
    pub anchor: Anchor,
    pub width: Width,
    pub overlapped: bool,
    pub one_expanded: bool,
    #[serde(default)]
    pub snap_to_grid: bool,
    #[serde(default = "default_show_guides")]
    pub show_guides: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Shape {
    source: String,
    preset: String,
    cloud_count: u8,
    roundness: u8,
    rotation: f64,
    flip_x: bool,
    flip_y: bool,
    fit_content: bool,
    width: f64,
    height: f64,
    strokes: Vec<Vec<Point>>,
}
impl Shape {
    fn valid(&self) -> bool {
        matches!(self.source.as_str(), "preset" | "drawing" | "image")
            && (matches!(self.preset.as_str(), "default" | "circle" | "cloud")
                || self.preset.parse::<u8>().is_ok_and(|value| {
                    (1..=22).contains(&value) && format!("{value:02}") == self.preset
                }))
            && (2..=8).contains(&self.cloud_count)
            && self.roundness <= 100
            && self.rotation.is_finite()
            && (-180.0..=180.0).contains(&self.rotation)
            && self.width.is_finite()
            && (48.0..=800.0).contains(&self.width)
            && self.height.is_finite()
            && (24.0..=600.0).contains(&self.height)
            && self.strokes.len() <= 8
            && self.strokes.iter().all(|stroke| {
                (3..=256).contains(&stroke.len())
                    && stroke.iter().all(|point| {
                        point.x.is_finite()
                            && point.y.is_finite()
                            && (0.0..=24.0).contains(&point.x)
                            && (0.0..=24.0).contains(&point.y)
                    })
            })
    }
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub(crate) struct Point {
    pub x: f64,
    pub y: f64,
}
impl Point {
    fn valid(&self) -> bool {
        self.x.is_finite()
            && self.y.is_finite()
            && self.x.abs() <= 32768.0
            && self.y.abs() <= 32768.0
    }
    fn near(&self, other: &Point) -> bool {
        (self.x - other.x).abs() < 1.0 && (self.y - other.y).abs() < 1.0
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
struct Stored {
    revision: i64,
    #[serde(flatten)]
    layout: Layout,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopState {
    revision: i64,
    editing: bool,
    #[serde(flatten)]
    layout: Layout,
}

/// Native window bookkeeping that never enters the database.
#[derive(Default)]
pub(crate) struct Runtime {
    snapshot: Mutex<Option<Layout>>,
    moves: Mutex<HashMap<String, u64>>,
    placed: Mutex<HashMap<String, (i32, i32)>>,
    /// Where the stack's anchor content (the capsule bar) sits inside the window while a
    /// bubble opens above or before it. The saved stack position always describes that content.
    stack_lead: Mutex<(f64, f64)>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct Rect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}
impl Rect {
    fn at(point: &Point, (width, height): (f64, f64)) -> Self {
        Self {
            x: point.x,
            y: point.y,
            width,
            height,
        }
    }
    fn intersects(&self, other: &Rect) -> bool {
        self.x < other.x + other.width
            && other.x < self.x + self.width
            && self.y < other.y + other.height
            && other.y < self.y + self.height
    }
}

pub(crate) fn supports(kind: &str) -> bool {
    widgets::desktop_kind(kind).is_some()
}

/// Window size: the rotated shape's bounding box plus the same margin on every side.
fn display_size(shape: Option<&Shape>, kind: &str) -> (f64, f64) {
    let size = shape
        .map(|shape| (shape.width, shape.height))
        .or_else(|| widgets::desktop_kind(kind).map(|spec| (spec.width, spec.height)))
        .unwrap_or((214.0, 150.0));
    let rotated = shape
        .map(|shape| {
            let angle = shape.rotation.to_radians();
            (
                size.0 * angle.cos().abs() + size.1 * angle.sin().abs(),
                size.0 * angle.sin().abs() + size.1 * angle.cos().abs(),
            )
        })
        .unwrap_or(size);
    (
        rotated.0.max(size.0) + MARGIN * 2.0,
        rotated.1.max(size.1) + MARGIN * 2.0,
    )
}

fn overlap(start: f64, length: f64, other: f64, other_length: f64) -> f64 {
    ((start + length).min(other + other_length) - start.max(other)).max(0.0)
}

/// Keeps a saved spot unless no work area shows enough of it, then moves it into the nearest one.
fn clamp_point(point: &Point, size: (f64, f64), areas: &[Rect]) -> Point {
    let visible = |area: &&Rect| {
        overlap(point.x, size.0, area.x, area.width) >= size.0.min(48.0)
            && overlap(point.y, size.1, area.y, area.height) >= size.1.min(48.0)
    };
    if areas.is_empty() || areas.iter().any(|area| visible(&area)) {
        return point.clone();
    }
    let center = (point.x + size.0 / 2.0, point.y + size.1 / 2.0);
    let distance = |area: &Rect| {
        let dx = (area.x - center.0)
            .max(center.0 - area.x - area.width)
            .max(0.0);
        let dy = (area.y - center.1)
            .max(center.1 - area.y - area.height)
            .max(0.0);
        dx * dx + dy * dy
    };
    let area = areas
        .iter()
        .min_by(|a, b| distance(a).total_cmp(&distance(b)))
        .expect("areas is not empty");
    Point {
        x: point
            .x
            .clamp(area.x, (area.x + area.width - size.0).max(area.x)),
        y: point
            .y
            .clamp(area.y, (area.y + area.height - size.1).max(area.y)),
    }
}

/// Column by column from the top-right corner, the first spot that overlaps no placed widget.
fn auto_place(area: Rect, size: (f64, f64), occupied: &[Rect]) -> Point {
    let right = area.x + area.width - INSET - size.0;
    let bottom = area.y + area.height - INSET - size.1;
    let mut x = right;
    while x >= area.x + INSET {
        let mut y = area.y + INSET;
        while y <= bottom {
            let candidate = Rect::at(&Point { x, y }, size);
            match occupied.iter().find(|rect| rect.intersects(&candidate)) {
                Some(blocker) => y = (blocker.y + blocker.height).max(y + SNAP),
                None => return Point { x, y },
            }
        }
        x -= SNAP * 2.0;
    }
    let step = occupied.len() as f64 * INSET;
    Point {
        x: (right - step).max(area.x),
        y: (area.y + INSET + step).min(bottom.max(area.y)),
    }
}

fn snap_axis(start: f64, length: f64, others: impl Iterator<Item = (f64, f64)>) -> Option<f64> {
    let own = [start, start + length / 2.0, start + length];
    let mut best: Option<f64> = None;
    for (other, other_length) in others {
        for target in [other, other + other_length / 2.0, other + other_length] {
            for edge in own {
                let delta = target - edge;
                if delta.abs() <= SNAP && best.is_none_or(|current| delta.abs() < current.abs()) {
                    best = Some(delta);
                }
            }
        }
    }
    best.map(|delta| start + delta)
}

/// Other widgets' edges and centers win over the grid when both are enabled.
fn snap(point: &Point, size: (f64, f64), others: &[Rect], grid: bool, guides: bool) -> Point {
    let axis = |value: f64, guided: Option<f64>| {
        guided.filter(|_| guides).unwrap_or(if grid {
            (value / SNAP).round() * SNAP
        } else {
            value
        })
    };
    Point {
        x: axis(
            point.x,
            snap_axis(point.x, size.0, others.iter().map(|r| (r.x, r.width))),
        ),
        y: axis(
            point.y,
            snap_axis(point.y, size.1, others.iter().map(|r| (r.y, r.height))),
        ),
    }
}

/// Unlike freeform widgets, keep the whole stack reachable after its content changes size.
fn clamp_stack_point(point: &Point, size: (f64, f64), areas: &[Rect]) -> Point {
    let distance =
        |candidate: &Point| (candidate.x - point.x).powi(2) + (candidate.y - point.y).powi(2);
    areas
        .iter()
        .map(|area| Point {
            x: point
                .x
                .clamp(area.x, (area.x + area.width - size.0).max(area.x)),
            y: point
                .y
                .clamp(area.y, (area.y + area.height - size.1).max(area.y)),
        })
        .min_by(|a, b| distance(a).total_cmp(&distance(b)))
        .unwrap_or_else(|| point.clone())
}

fn stack_origin(area: Rect, size: (f64, f64), anchor: &Anchor) -> Point {
    let left = area.x + INSET;
    let top = area.y + INSET;
    let right = area.x + area.width - size.0 - INSET;
    let bottom = area.y + area.height - size.1 - INSET;
    let (x, y) = match anchor {
        Anchor::TopLeft => (left, top),
        Anchor::TopRight => (right, top),
        Anchor::BottomLeft => (left, bottom),
        Anchor::BottomRight => (right, bottom),
    };
    Point {
        x: x.max(area.x),
        y: y.max(area.y),
    }
}

fn fit_size(width: f64, height: f64, area: Rect) -> Result<(f64, f64), String> {
    if !width.is_finite() || !height.is_finite() || width <= 0.0 || height <= 0.0 {
        return Err("모아두기 크기를 확인해 주세요.".into());
    }
    Ok((
        width.clamp(80.0, (area.width - INSET * 2.0).max(80.0)),
        height.clamp(48.0, (area.height - INSET * 2.0).max(48.0)),
    ))
}

/// Initial window width before the first fit: the rows plus the stack padding.
fn stack_width(width: &Width) -> f64 {
    f64::from(width.0) + 40.0
}

fn read(db: &Connection) -> Result<Stored, String> {
    let value: Option<String> = db
        .query_row(
            "SELECT value FROM widget_preferences WHERE key=?1",
            [KEY],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    value
        .map(|raw| serde_json::from_str(&raw).map_err(|e| e.to_string()))
        .transpose()
        .map(Option::unwrap_or_default)
}

/// Widgets that can sit on the desktop, by id.
fn placeable(db: &Connection) -> Result<HashMap<String, String>, String> {
    Ok(storage::instances(db)?
        .into_iter()
        .filter(|widget| supports(&widget.kind))
        .map(|widget| (widget.id, widget.kind))
        .collect())
}

/// Drops ids that can no longer be placed (disabled, removed or retired) and their geometry.
fn pruned(mut layout: Layout, placeable: &HashMap<String, String>) -> Layout {
    let mut seen = HashSet::new();
    layout
        .order
        .retain(|id| placeable.contains_key(id) && seen.insert(id.clone()));
    layout.order.truncate(64);
    if !layout.width.valid() {
        layout.width = Width::default();
    }
    layout
        .positions
        .retain(|id, point| layout.order.contains(id) && point.valid());
    for shape in layout.shapes.values_mut() {
        // Preset 23 was retired without artwork; saved shapes fall back to the rounded square.
        if shape.preset == "23" {
            shape.preset = "01".into();
        }
    }
    layout
        .shapes
        .retain(|id, shape| layout.order.contains(id) && shape.valid());
    layout
        .stack_styles
        .retain(|id, style| layout.order.contains(id) && style.valid());
    if layout
        .stack_position
        .as_ref()
        .is_some_and(|point| !point.valid())
    {
        layout.stack_position = None;
    }
    layout
}

fn validate(layout: &Layout) -> Result<(), String> {
    if layout.order.len() > 64
        || layout
            .order
            .iter()
            .any(|id| uuid::Uuid::parse_str(id).is_err())
        || layout.order.iter().collect::<HashSet<_>>().len() != layout.order.len()
        || !layout.width.valid()
        || layout
            .positions
            .iter()
            .any(|(id, point)| !layout.order.contains(id) || !point.valid())
        || layout
            .shapes
            .iter()
            .any(|(id, shape)| !layout.order.contains(id) || !shape.valid())
        || layout
            .stack_styles
            .iter()
            .any(|(id, style)| !layout.order.contains(id) || !style.valid())
        || layout
            .stack_position
            .as_ref()
            .is_some_and(|point| !point.valid())
    {
        return Err("위젯 배치 목록이 올바르지 않아요.".into());
    }
    Ok(())
}

fn commit(db: &Connection, previous: &Stored, layout: Layout) -> Result<Stored, String> {
    validate(&layout)?;
    let placeable = placeable(db)?;
    if layout.order.iter().any(|id| !placeable.contains_key(id)) {
        return Err("바탕화면에 놓을 수 있는 위젯만 배치할 수 있어요.".into());
    }
    let next = Stored {
        revision: previous
            .revision
            .checked_add(1)
            .ok_or("위젯 배치 버전이 올바르지 않아요.")?,
        layout,
    };
    db.execute("INSERT INTO widget_preferences(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![KEY, serde_json::to_string(&next).map_err(|e| e.to_string())?]).map_err(|e| e.to_string())?;
    Ok(next)
}

/// Reads the layout and persists the removal of ids that can no longer be placed.
fn load(db: &Connection) -> Result<Stored, String> {
    let stored = read(db)?;
    let next = pruned(stored.layout.clone(), &placeable(db)?);
    if next == stored.layout {
        return Ok(stored);
    }
    commit(db, &stored, next)
}

fn current(db: &Connection, expected_revision: i64) -> Result<Stored, String> {
    let stored = load(db)?;
    if stored.revision != expected_revision {
        return Err("다른 화면에서 위젯 배치를 바꿨어요. 최신 상태를 확인해 주세요.".into());
    }
    Ok(stored)
}

fn configured(current: &Layout, input: LayoutSettings) -> Layout {
    let order = input.order;
    Layout {
        stack_position: current
            .stack_position
            .clone()
            .filter(|_| input.anchor == current.anchor),
        positions: current
            .positions
            .iter()
            .filter(|(id, _)| order.contains(id))
            .map(|(id, point)| (id.clone(), point.clone()))
            .collect(),
        shapes: current
            .shapes
            .iter()
            .filter(|(id, _)| order.contains(id))
            .map(|(id, shape)| (id.clone(), shape.clone()))
            .collect(),
        stack_styles: current
            .stack_styles
            .iter()
            .filter(|(id, _)| order.contains(id))
            .map(|(id, style)| (id.clone(), style.clone()))
            .collect(),
        mode: input.mode,
        order,
        anchor: input.anchor,
        width: input.width,
        overlapped: input.overlapped,
        one_expanded: input.one_expanded,
        snap_to_grid: input.snap_to_grid,
        show_guides: input.show_guides,
        stack_hidden: current.stack_hidden,
    }
}

fn configure(
    db: &Connection,
    expected_revision: i64,
    input: LayoutSettings,
) -> Result<Stored, String> {
    let stored = current(db, expected_revision)?;
    commit(db, &stored, configured(&stored.layout, input))
}

fn restore(db: &Connection, expected_revision: i64, layout: Layout) -> Result<Stored, String> {
    let stored = current(db, expected_revision)?;
    commit(db, &stored, pruned(layout, &placeable(db)?))
}

/// Revision-free change; an unchanged layout keeps its revision.
fn update(
    db: &Connection,
    change: impl FnOnce(&mut Layout) -> Result<(), String>,
) -> Result<(Stored, bool), String> {
    let stored = load(db)?;
    let mut next = stored.layout.clone();
    change(&mut next)?;
    if next == stored.layout {
        return Ok((stored, false));
    }
    Ok((commit(db, &stored, next)?, true))
}

fn without(layout: &mut Layout, id: &str) {
    layout.order.retain(|value| value != id);
    layout.positions.remove(id);
    layout.shapes.remove(id);
    layout.stack_styles.remove(id);
}

fn desktop_state(state: &AppState, stored: &Stored) -> DesktopState {
    DesktopState {
        revision: stored.revision,
        editing: state.widget_editing.load(Ordering::SeqCst),
        layout: stored.layout.clone(),
    }
}

fn emit_state(app: &tauri::AppHandle, state: &AppState, stored: &Stored) -> DesktopState {
    let current = desktop_state(state, stored);
    let _ = app.emit("widget-desktop-state", &current);
    current
}

fn widget_id(id: &str) -> Result<(), String> {
    uuid::Uuid::parse_str(id)
        .map(|_| ())
        .map_err(|_| "위젯 식별자가 올바르지 않아요.".to_string())
}

/// Called after a widget is disabled or removed so stale ids never block later saves.
pub(crate) fn prune(app: &tauri::AppHandle, state: &AppState) -> Result<(), String> {
    let (before, after) =
        widgets::commands::change(state, |db| Ok((read(db)?.revision, load(db)?)))?;
    if after.revision != before {
        emit_state(app, state, &after);
    }
    Ok(())
}

fn area_of(monitor: &tauri::Monitor) -> Rect {
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    Rect {
        x: area.position.x as f64 / scale,
        y: area.position.y as f64 / scale,
        width: area.size.width as f64 / scale,
        height: area.size.height as f64 / scale,
    }
}
fn work_areas(app: &tauri::AppHandle) -> Result<Vec<Rect>, String> {
    Ok(app
        .available_monitors()
        .map_err(|e| e.to_string())?
        .iter()
        .map(area_of)
        .collect())
}
fn primary_area(app: &tauri::AppHandle) -> Result<Rect, String> {
    let monitor = match app.primary_monitor().map_err(|e| e.to_string())? {
        Some(monitor) => Some(monitor),
        None => app
            .available_monitors()
            .map_err(|e| e.to_string())?
            .into_iter()
            .next(),
    };
    monitor
        .map(|monitor| area_of(&monitor))
        .ok_or_else(|| "화면을 확인하지 못했어요.".into())
}
fn window_area(app: &tauri::AppHandle, window: &tauri::WebviewWindow) -> Result<Rect, String> {
    match window.current_monitor().map_err(|e| e.to_string())? {
        Some(monitor) => Ok(area_of(&monitor)),
        None => primary_area(app),
    }
}
fn window_rect(window: &tauri::WebviewWindow) -> Result<Rect, String> {
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let position = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    Ok(Rect {
        x: position.x as f64 / scale,
        y: position.y as f64 / scale,
        width: size.width as f64 / scale,
        height: size.height as f64 / scale,
    })
}

/// Records where the app put a window so the resulting Moved event is not saved as a drag.
fn place(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
    point: &Point,
) -> Result<(), String> {
    window
        .set_position(tauri::LogicalPosition::new(point.x, point.y))
        .map_err(|e| e.to_string())?;
    remember_position(app, window)
}
fn remember_position(app: &tauri::AppHandle, window: &tauri::WebviewWindow) -> Result<(), String> {
    let position = window.outer_position().map_err(|e| e.to_string())?;
    if let Some(runtime) = app.try_state::<Runtime>() {
        lock(&runtime.placed)?.insert(window.label().into(), (position.x, position.y));
    }
    Ok(())
}

fn close(app: &tauri::AppHandle, label: &str) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(label) {
        window.destroy().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// The layout and kind when `id` should currently be shown as its own desktop window.
fn displayable(state: &AppState, id: &str) -> Result<(Layout, HashMap<String, String>), String> {
    let db = lock(&state.db)?;
    let layout = read(&db)?.layout;
    let placeable = placeable(&db)?;
    if layout.mode != Mode::Freeform
        || !layout.order.iter().any(|value| value == id)
        || !placeable.contains_key(id)
    {
        return Err("바탕화면에 놓인 켜진 위젯만 표시할 수 있어요.".into());
    }
    Ok((layout, placeable))
}

#[cfg(target_os = "linux")]
fn request_display_size(window: &tauri::WebviewWindow, size: (f64, f64)) -> Result<(), String> {
    let target = window.clone();
    let (send, receive) = std::sync::mpsc::channel();
    window
        .run_on_main_thread(move || {
            use gtk::prelude::WidgetExt;
            let result = target
                .gtk_window()
                .map(|native| {
                    // Empty WebKit requisitions otherwise become GTK's 200px natural
                    // size, fixed as min=max for non-resizable windows. resize alone
                    // cannot override it. Refresh the request for shape edits too.
                    native.set_size_request(size.0.round() as i32, size.1.round() as i32);
                })
                .map_err(|error| error.to_string());
            let _ = send.send(result);
        })
        .map_err(|error| error.to_string())?;
    // Tauri runs the closure inline when already on the UI thread. Otherwise
    // wait before resize/map so the first frame uses the placement dimensions.
    receive.recv().map_err(|error| error.to_string())?
}

// No lifecycle lock is held while native window calls wait for the main thread.
fn open_display(app: &tauri::AppHandle, state: &AppState, id: &str) -> Result<(), String> {
    widget_id(id)?;
    let (layout, kinds) = displayable(state, id)?;
    let kind = &kinds[id];
    let size = display_size(layout.shapes.get(id), kind);
    let label = format!("{DISPLAY}{id}");
    let window = match app.get_webview_window(&label) {
        Some(window) => window,
        None => tauri::WebviewWindowBuilder::new(
            app,
            &label,
            tauri::WebviewUrl::App(format!("index.html?view=widget-display&id={id}").into()),
        )
        .title(format!("comet · {}", widgets::manifest(kind)?.name))
        .inner_size(size.0, size.1)
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
        .map_err(|e| e.to_string())?,
    };
    #[cfg(target_os = "linux")]
    request_display_size(&window, size)?;
    window
        .set_size(tauri::LogicalSize::new(size.0, size.1))
        .map_err(|e| e.to_string())?;
    let point = match layout.positions.get(id) {
        Some(saved) => clamp_point(saved, size, &work_areas(app)?),
        None => {
            let occupied: Vec<Rect> = layout
                .order
                .iter()
                .filter(|other| *other != id)
                .filter_map(|other| {
                    let point = layout.positions.get(other)?;
                    let kind = kinds.get(other)?;
                    Some(Rect::at(
                        point,
                        display_size(layout.shapes.get(other), kind),
                    ))
                })
                .collect();
            auto_place(primary_area(app)?, size, &occupied)
        }
    };
    if !layout
        .positions
        .get(id)
        .is_some_and(|saved| saved.near(&point))
    {
        let (stored, changed) = widgets::commands::change(state, |db| {
            update(db, |layout| {
                if layout.order.iter().any(|value| value == id) {
                    layout.positions.insert(id.into(), point.clone());
                }
                Ok(())
            })
        })?;
        if changed {
            emit_state(app, state, &stored);
        }
    }
    place(app, &window, &point)?;
    window.show().map_err(|e| e.to_string())?;
    // A disable, removal or mode change may have finished while the window was being built.
    if displayable(state, id).is_err() {
        let _ = window.destroy();
    }
    Ok(())
}

fn position_stack(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
    layout: &Layout,
    size: (f64, f64),
) -> Result<(), String> {
    let point = match &layout.stack_position {
        Some(saved) => {
            let (x, y) = stack_lead(app)?;
            let origin = Point {
                x: saved.x - x,
                y: saved.y - y,
            };
            clamp_stack_point(&origin, size, &work_areas(app)?)
        }
        // Anchored stacks keep their anchor edges; the page aligns its content to them.
        None => stack_origin(window_area(app, window)?, size, &layout.anchor),
    };
    place(app, window, &point)
}

fn stack_lead(app: &tauri::AppHandle) -> Result<(f64, f64), String> {
    match app.try_state::<Runtime>() {
        Some(runtime) => Ok(*lock(&runtime.stack_lead)?),
        None => Ok((0.0, 0.0)),
    }
}

fn open_stack(app: &tauri::AppHandle, state: &AppState) -> Result<(), String> {
    let layout = read(&*lock(&state.db)?)?.layout;
    let window = match app.get_webview_window(STACK) {
        Some(window) => window,
        None => tauri::WebviewWindowBuilder::new(
            app,
            STACK,
            tauri::WebviewUrl::App("index.html?view=widget-stack".into()),
        )
        .title("comet · 바탕화면 위젯")
        .inner_size(stack_width(&layout.width), 320.0)
        .min_inner_size(80.0, 48.0)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .disable_drag_drop_handler()
        .maximizable(false)
        .focused(false)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?,
    };
    let rect = window_rect(&window)?;
    position_stack(app, &window, &layout, (rect.width, rect.height))?;
    window.show().map_err(|e| e.to_string())
}

/// Matches native windows to the layout. `reveal_stack` opens the stack window when it is closed.
fn sync(
    app: &tauri::AppHandle,
    state: &AppState,
    layout: &Layout,
    reveal_stack: bool,
) -> Result<(), String> {
    let mut errors = Vec::new();
    for (label, window) in app.webview_windows() {
        if let Some(id) = label.strip_prefix(DISPLAY) {
            if layout.mode == Mode::Stack || !layout.order.iter().any(|value| value == id) {
                if let Err(error) = window.destroy() {
                    errors.push(error.to_string());
                }
            }
        }
    }
    match layout.mode {
        Mode::Stack => {
            if reveal_stack || app.get_webview_window(STACK).is_some() {
                if let Err(error) = open_stack(app, state) {
                    errors.push(error);
                }
            }
        }
        Mode::Freeform => {
            if let Err(error) = close(app, STACK) {
                errors.push(error);
            }
            for id in &layout.order {
                if let Err(error) = open_display(app, state, id) {
                    errors.push(error);
                }
            }
        }
    }
    crate::widgets::runtime::refresh(app);
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join(" · "))
    }
}

/// Desktop widgets come back where they were after the app starts.
pub(crate) fn restore_on_start(app: &tauri::AppHandle, state: Arc<AppState>) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let result = widgets::commands::change(&state, load).and_then(|stored| {
            let layout = &stored.layout;
            match layout.mode {
                Mode::Freeform => sync(&app, &state, layout, false),
                Mode::Stack if !layout.stack_hidden && !layout.order.is_empty() => {
                    sync(&app, &state, layout, true)
                }
                Mode::Stack => Ok(()),
            }
        });
        if let Err(error) = result {
            crate::report_error!("desktop_widget_restore", "바탕화면 위젯 복원 실패: {error}");
        }
    });
}

fn open_editor(app: &tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(EDITOR) {
        window.show().map_err(|e| e.to_string())?;
        return window.set_focus().map_err(|e| e.to_string());
    }
    let area = primary_area(app)?;
    let window = tauri::WebviewWindowBuilder::new(
        app,
        EDITOR,
        tauri::WebviewUrl::App("index.html?view=widget-editor".into()),
    )
    .title("comet · 바탕화면 위젯 편집")
    .inner_size(
        EDITOR_WIDTH,
        600.0_f64.min(area.height - INSET * 2.0).max(200.0),
    )
    .position(area.x + (area.width - EDITOR_WIDTH) / 2.0, area.y + INSET)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .disable_drag_drop_handler()
    .maximizable(false)
    .visible(false)
    .build()
    .map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

pub(crate) fn apply_editing(state: &AppState, editing: bool) -> Result<bool, String> {
    let _guard = lock(&state.action)?;
    let db = lock(&state.db)?;
    editing_locked(state, &db, editing)
}

fn discard_automatic(db: &Connection) -> Result<(), String> {
    storage::discard_pending_during_quiet(db)?;
    crate::widgets::generated::discard_pending(db)?;
    crate::widgets::generated::commands::skip_automatic_message(db)
}

// The caller holds action. This gate never changes the user's pause or saved settings.
fn editing_locked(state: &AppState, db: &Connection, editing: bool) -> Result<bool, String> {
    if state.widget_editing.load(Ordering::SeqCst) == editing {
        return Ok(false);
    }
    let settings = crate::store::settings(db)?;
    if !editing {
        state.widget_editing.store(false, Ordering::SeqCst);
        discard_automatic(db)?;
        crate::app::schedule_idle(state, settings.idle_minutes);
        return Ok(true);
    }
    // Database cleanup commits as a whole before the gate turns on.
    let tx = db
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    discard_automatic(&tx)?;
    tx.execute("DELETE FROM scenes", [])
        .map_err(|error| error.to_string())?;
    tx.commit().map_err(|error| error.to_string())?;
    state.widget_editing.store(true, Ordering::SeqCst);
    crate::app::schedule_idle(state, settings.idle_minutes);
    lock(&state.story_clock)?.elapsed = std::time::Duration::ZERO;
    lock(&state.reactions)?
        .runs
        .retain(|_, run| !crate::characters::reactions::ambient_gesture(&run.event));
    if crate::app::quiet_hours::playback_blocked(state, &settings, false)? {
        let (epoch, _) = crate::app::interrupt_with_db(state, false, db)?;
        state.widget_epoch.store(epoch, Ordering::SeqCst);
        let mut runtime = lock(&state.runtime)?;
        runtime.phase = crate::types::RuntimePhase::Idle;
        runtime.persona = None;
        runtime.error = None;
        state.nlp.pause_indexing(false);
    }
    Ok(true)
}

fn set_snapshot(app: &tauri::AppHandle, layout: Option<Layout>, replace: bool) {
    if let Some(runtime) = app.try_state::<Runtime>() {
        if let Ok(mut snapshot) = runtime.snapshot.lock() {
            if replace || snapshot.is_none() {
                *snapshot = layout;
            }
        }
    }
}

fn end_editing(app: &tauri::AppHandle, state: &AppState) {
    set_snapshot(app, None, true);
    if apply_editing(state, false).unwrap_or(false) {
        crate::app::publish(app, state);
        let _ = app.emit("widget-desktop-editing", false);
        let stored = lock(&state.db).and_then(|db| read(&db));
        if let Ok(stored) = stored {
            emit_state(app, state, &stored);
        }
    }
}

/// Runs off the main thread: the action lock may be held by a command waiting on native calls.
pub(crate) fn editor_destroyed(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if app.get_webview_window(EDITOR).is_some() {
            return;
        }
        let state = app.state::<Arc<AppState>>();
        end_editing(&app, &state);
    });
}

/// Debounces native moves of desktop widget windows and saves where the user left them.
pub(crate) fn moved(window: &tauri::Window) {
    let label = window.label();
    if label != STACK && !label.starts_with(DISPLAY) {
        return;
    }
    let app = window.app_handle().clone();
    let Some(runtime) = app.try_state::<Runtime>() else {
        return;
    };
    let expected = {
        let Ok(mut moves) = runtime.moves.lock() else {
            return;
        };
        let generation = moves.entry(label.to_string()).or_default();
        *generation += 1;
        *generation
    };
    let label = label.to_string();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(200)).await;
        let latest = app
            .state::<Runtime>()
            .moves
            .lock()
            .ok()
            .and_then(|moves| moves.get(&label).copied());
        if latest == Some(expected) {
            let _ = tauri::async_runtime::spawn_blocking(move || settle(&app, &label)).await;
        }
    });
}

fn settle(app: &tauri::AppHandle, label: &str) -> Result<(), String> {
    let Some(window) = app.get_webview_window(label) else {
        return Ok(());
    };
    if !window.is_visible().map_err(|e| e.to_string())? {
        return Ok(());
    }
    let physical = window.outer_position().map_err(|e| e.to_string())?;
    let runtime = app.state::<Runtime>();
    if lock(&runtime.placed)?.get(label) == Some(&(physical.x, physical.y)) {
        return Ok(());
    }
    let state = app.state::<Arc<AppState>>();
    let rect = window_rect(&window)?;
    let mut point = Point {
        x: rect.x,
        y: rect.y,
    };
    let id = label.strip_prefix(DISPLAY);
    if id.is_some() {
        let layout = read(&*lock(&state.db)?)?.layout;
        let mut others = Vec::new();
        for (other, display) in app.webview_windows() {
            if other != label && other.starts_with(DISPLAY) && display.is_visible().unwrap_or(false)
            {
                others.push(window_rect(&display)?);
            }
        }
        let snapped = snap(
            &point,
            (rect.width, rect.height),
            &others,
            layout.snap_to_grid,
            layout.show_guides,
        );
        if snapped.near(&point) {
            remember_position(app, &window)?;
        } else {
            place(app, &window, &snapped)?;
            point = snapped;
        }
    } else {
        remember_position(app, &window)?;
        let (x, y) = *lock(&runtime.stack_lead)?;
        point.x += x;
        point.y += y;
    }
    let (stored, changed) = widgets::commands::change(&state, |db| {
        update(db, |layout| {
            match id {
                Some(id) => {
                    if layout.order.iter().any(|value| value == id)
                        && !layout
                            .positions
                            .get(id)
                            .is_some_and(|saved| saved.near(&point))
                    {
                        layout.positions.insert(id.into(), point.clone());
                    }
                }
                None => {
                    if layout.mode == Mode::Stack
                        && !layout
                            .stack_position
                            .as_ref()
                            .is_some_and(|saved| saved.near(&point))
                    {
                        layout.stack_position = Some(point.clone());
                    }
                }
            }
            Ok(())
        })
    })?;
    if changed {
        emit_state(app, &state, &stored);
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn get_widget_desktop(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<DesktopState, String> {
    let stored = widgets::commands::change(&state, load)?;
    Ok(desktop_state(&state, &stored))
}

#[tauri::command]
pub(crate) async fn configure_widget_desktop(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    expected_revision: i64,
    input: LayoutSettings,
) -> Result<DesktopState, String> {
    let (previous, stored) = widgets::commands::change(&state, |db| {
        let previous = read(db)?.layout.mode;
        Ok((previous, configure(db, expected_revision, input)?))
    })?;
    let current = emit_state(&app, &state, &stored);
    sync(&app, &state, &stored.layout, previous != stored.layout.mode)?;
    Ok(current)
}

#[tauri::command]
pub(crate) async fn restore_widget_desktop(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    expected_revision: i64,
    layout: Layout,
) -> Result<DesktopState, String> {
    let (previous, stored) = widgets::commands::change(&state, |db| {
        let previous = read(db)?.layout.mode;
        Ok((previous, restore(db, expected_revision, layout)?))
    })?;
    let current = emit_state(&app, &state, &stored);
    sync(&app, &state, &stored.layout, previous != stored.layout.mode)?;
    Ok(current)
}

#[tauri::command]
pub(crate) async fn add_widget_desktop_item(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
) -> Result<DesktopState, String> {
    widget_id(&id)?;
    let (stored, _) = widgets::commands::change(&state, |db| {
        if !placeable(db)?.contains_key(&id) {
            return Err("바탕화면에 놓을 수 있는 위젯만 놓을 수 있어요.".into());
        }
        update(db, |layout| {
            if !layout.order.contains(&id) {
                layout.order.push(id.clone());
            }
            layout.stack_hidden = false;
            Ok(())
        })
    })?;
    let current = emit_state(&app, &state, &stored);
    sync(
        &app,
        &state,
        &stored.layout,
        stored.layout.mode == Mode::Stack,
    )?;
    Ok(current)
}

#[tauri::command]
pub(crate) async fn remove_widget_desktop_item(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
) -> Result<DesktopState, String> {
    widget_id(&id)?;
    let (stored, _) = widgets::commands::change(&state, |db| {
        update(db, |layout| {
            without(layout, &id);
            Ok(())
        })
    })?;
    let current = emit_state(&app, &state, &stored);
    close(&app, &format!("{DISPLAY}{id}"))?;
    crate::widgets::runtime::refresh(&app);
    Ok(current)
}

#[tauri::command]
pub(crate) async fn set_widget_desktop_shape(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
    shape: Option<Shape>,
) -> Result<DesktopState, String> {
    widget_id(&id)?;
    if shape.as_ref().is_some_and(|shape| !shape.valid()) {
        return Err("위젯 모양 설정이 올바르지 않아요.".into());
    }
    let (stored, _) = widgets::commands::change(&state, |db| {
        update(db, |layout| {
            if !layout.order.contains(&id) {
                return Err("바탕화면에 놓인 위젯만 모양을 바꿀 수 있어요.".into());
            }
            match shape {
                Some(shape) => layout.shapes.insert(id.clone(), shape),
                None => layout.shapes.remove(&id),
            };
            Ok(())
        })
    })?;
    let current = emit_state(&app, &state, &stored);
    if stored.layout.mode == Mode::Freeform
        && app.get_webview_window(&format!("{DISPLAY}{id}")).is_some()
    {
        open_display(&app, &state, &id)?;
    }
    Ok(current)
}

/// Stack-only look of one widget; `None` returns it to the theme defaults.
#[tauri::command]
pub(crate) async fn set_widget_stack_style(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
    style: Option<StackStyle>,
) -> Result<DesktopState, String> {
    widget_id(&id)?;
    if style.as_ref().is_some_and(|style| !style.valid()) {
        return Err("모아두기 꾸미기 설정이 올바르지 않아요.".into());
    }
    let (stored, _) = widgets::commands::change(&state, |db| {
        update(db, |layout| {
            if !layout.order.contains(&id) {
                return Err("바탕화면에 놓인 위젯만 꾸밀 수 있어요.".into());
            }
            match style {
                Some(style) => layout.stack_styles.insert(id.clone(), style),
                None => layout.stack_styles.remove(&id),
            };
            Ok(())
        })
    })?;
    Ok(emit_state(&app, &state, &stored))
}

#[tauri::command]
pub(crate) async fn set_widget_desktop_editing(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    editing: bool,
) -> Result<DesktopState, String> {
    let (changed, stored) = {
        let _action = lock(&state.action)?;
        if crate::unavailable(&state) {
            return Err("앱을 정리하고 있어요.".into());
        }
        let db = lock(&state.db)?;
        let stored = load(&db)?;
        match editing_locked(&state, &db, editing) {
            Ok(changed) => (changed, stored),
            Err(error) => {
                if editing {
                    let _ = editing_locked(&state, &db, false);
                }
                return Err(error);
            }
        }
    };
    let mut synced = Ok(());
    if editing {
        set_snapshot(&app, Some(stored.layout.clone()), changed);
        if changed {
            crate::desktop::toys::clear_automatic(&app);
        }
        if let Err(error) = open_editor(&app) {
            end_editing(&app, &state);
            return Err(error);
        }
        synced = sync(&app, &state, &stored.layout, true);
    } else {
        set_snapshot(&app, None, true);
        close(&app, EDITOR)?;
    }
    if changed {
        crate::app::publish(&app, &state);
    }
    let _ = app.emit("widget-desktop-editing", editing);
    let current = emit_state(&app, &state, &stored);
    synced.map(|()| current)
}

#[tauri::command]
pub(crate) fn get_widget_desktop_snapshot(
    runtime: tauri::State<'_, Runtime>,
) -> Result<Option<Layout>, String> {
    Ok(lock(&runtime.snapshot)?.clone())
}

#[tauri::command]
pub(crate) async fn open_widget_stack(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let (stored, changed) = widgets::commands::change(&state, |db| {
        update(db, |layout| {
            layout.stack_hidden = false;
            Ok(())
        })
    })?;
    if changed {
        emit_state(&app, &state, &stored);
    }
    sync(&app, &state, &stored.layout, true)
}

#[tauri::command]
pub(crate) async fn close_widget_stack(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let (stored, changed) = widgets::commands::change(&state, |db| {
        update(db, |layout| {
            layout.stack_hidden = true;
            Ok(())
        })
    })?;
    if changed {
        emit_state(&app, &state, &stored);
    }
    close(&app, STACK)?;
    crate::widgets::runtime::refresh(&app);
    Ok(())
}

#[tauri::command]
pub(crate) async fn fit_widget_stack(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    runtime: tauri::State<'_, Runtime>,
    width: f64,
    height: f64,
    lead: Option<Point>,
) -> Result<(), String> {
    let Some(window) = app.get_webview_window(STACK) else {
        return Ok(());
    };
    let size = fit_size(width, height, window_area(&app, &window)?)?;
    let lead = lead
        .filter(Point::valid)
        .map_or((0.0, 0.0), |point| (point.x.clamp(0.0, size.0), point.y.clamp(0.0, size.1)));
    *lock(&runtime.stack_lead)? = lead;
    let layout = read(&*lock(&state.db)?)?.layout;
    window
        .set_size(tauri::LogicalSize::new(size.0, size.1))
        .map_err(|e| e.to_string())?;
    // Native resize is asynchronous: outer_size may still describe the previous content.
    position_stack(&app, &window, &layout, size)
}

#[tauri::command]
pub(crate) async fn fit_widget_editor(app: tauri::AppHandle, height: f64) -> Result<(), String> {
    let Some(window) = app.get_webview_window(EDITOR) else {
        return Ok(());
    };
    if !height.is_finite() || height <= 0.0 {
        return Err("편집 창 높이를 확인해 주세요.".into());
    }
    let area = window_area(&app, &window)?;
    let height = height.clamp(160.0, (area.height - INSET * 2.0).max(160.0));
    window
        .set_size(tauri::LogicalSize::new(EDITOR_WIDTH, height))
        .map_err(|e| e.to_string())?;
    let rect = window_rect(&window)?;
    if rect.y + height > area.y + area.height {
        window
            .set_position(tauri::LogicalPosition::new(
                rect.x,
                (area.y + area.height - height).max(area.y),
            ))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn database() -> Connection {
        let db = Connection::open_in_memory().unwrap();
        storage::initialize(&db).unwrap();
        db
    }
    fn install(db: &Connection, kinds: &[&str]) -> Vec<String> {
        let directory = tempfile::tempdir().unwrap();
        storage::install(
            db,
            directory.path(),
            &kinds
                .iter()
                .map(|kind| kind.to_string())
                .collect::<Vec<_>>(),
        )
        .unwrap();
        kinds
            .iter()
            .map(|kind| {
                storage::instances(db)
                    .unwrap()
                    .into_iter()
                    .find(|widget| widget.kind == *kind)
                    .unwrap()
                    .id
            })
            .collect()
    }
    fn shape(width: f64, height: f64, rotation: f64) -> Shape {
        serde_json::from_value(serde_json::json!({"source":"drawing","preset":"default","cloudCount":4,"roundness":70,"rotation":rotation,"flipX":true,"flipY":false,"fitContent":true,"width":width,"height":height,"strokes":[[{"x":1,"y":1},{"x":23,"y":1},{"x":12,"y":23}]]})).unwrap()
    }
    fn style() -> StackStyle {
        StackStyle {
            follow_theme: false,
            background_color: "#223344".into(),
            text_color: "#FFFFFF".into(),
            opacity: 60,
            radius: 12,
        }
    }
    fn settings(layout: &Layout) -> LayoutSettings {
        serde_json::from_value(serde_json::to_value(layout).unwrap()).unwrap()
    }
    const AREA: Rect = Rect {
        x: 0.0,
        y: 25.0,
        width: 1440.0,
        height: 875.0,
    };

    #[test]
    fn desktop_layout_has_an_independent_revision_and_preserves_other_preferences() {
        let db = database();
        db.execute(
            "INSERT INTO widget_preferences VALUES('existing','keep')",
            [],
        )
        .unwrap();
        let input = Layout {
            mode: Mode::Freeform,
            anchor: Anchor::BottomLeft,
            snap_to_grid: true,
            show_guides: false,
            ..Layout::default()
        };
        let next = configure(&db, 0, settings(&input)).unwrap();
        assert_eq!(next.revision, 1);
        assert_eq!(read(&db).unwrap().layout, input);
        assert!(configure(&db, 0, settings(&Layout::default())).is_err());
        assert_eq!(
            db.query_row(
                "SELECT value FROM widget_preferences WHERE key='existing'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            "keep"
        );
    }

    #[test]
    fn desktop_layout_rejects_invalid_and_unknown_widget_ids() {
        let db = database();
        for id in ["invalid", "00000000-0000-0000-0000-000000000000"] {
            let input = Layout {
                order: vec![id.into()],
                ..Layout::default()
            };
            assert!(configure(&db, 0, settings(&input)).is_err());
        }
        let id = install(&db, &["clock"]).remove(0);
        let duplicate = Layout {
            order: vec![id.clone(), id],
            ..Layout::default()
        };
        assert!(configure(&db, 0, settings(&duplicate)).is_err());
        assert_eq!(read(&db).unwrap().revision, 0);
    }

    #[test]
    fn legacy_layout_defaults_and_unknown_fields_are_tolerated() {
        let db = database();
        db.execute("INSERT INTO widget_preferences VALUES(?1,?2)", params![KEY, r#"{"revision":2,"mode":"freeform","order":[],"anchor":"top-right","width":"normal","overlapped":true,"oneExpanded":true,"positions":{},"summaryWidth":320}"#]).unwrap();
        let legacy = read(&db).unwrap();
        assert_eq!(legacy.revision, 2);
        assert_eq!(legacy.layout.mode, Mode::Freeform);
        assert!(legacy.layout.shapes.is_empty());
        assert!(!legacy.layout.snap_to_grid);
        assert!(legacy.layout.show_guides);
        assert!(legacy.layout.stack_styles.is_empty());
        assert_eq!(legacy.layout.width, Width(370));
        assert!(legacy.layout.stack_position.is_none());
        assert_eq!(load(&db).unwrap().revision, 2);
        let serialized =
            serde_json::to_value(desktop_state(&crate::app::tests::state(), &legacy)).unwrap();
        assert_eq!(serialized["revision"], 2);
        assert_eq!(serialized["editing"], false);
        assert_eq!(serialized["mode"], "freeform");
        assert!(serialized["stackPosition"].is_null());
    }

    #[test]
    fn stack_width_reads_legacy_names_and_rejects_out_of_range_pixels() {
        for (raw, width) in [
            (r#""narrow""#, 330),
            (r#""normal""#, 370),
            (r#""wide""#, 410),
            ("452.4", 452),
        ] {
            let layout: Layout = serde_json::from_str(&format!(r#"{{"width":{raw}}}"#)).unwrap();
            assert_eq!(layout.width, Width(width));
        }
        let db = database();
        for width in [279, 601] {
            let layout = Layout {
                width: Width(width),
                ..Layout::default()
            };
            assert!(configure(&db, 0, settings(&layout)).is_err());
        }
        let layout = Layout {
            width: Width(600),
            ..Layout::default()
        };
        assert_eq!(configure(&db, 0, settings(&layout)).unwrap().layout.width, Width(600));
    }

    #[test]
    fn stack_styles_are_bounded_and_legacy_pins_are_dropped() {
        let mut value = style();
        assert!(value.valid());
        value.opacity = 101;
        assert!(!value.valid());
        value = style();
        value.radius = 25;
        assert!(!value.valid());
        value = style();
        value.background_color = "red".into();
        assert!(!value.valid());
        let db = database();
        let ids = install(&db, &["clock"]);
        db.execute(
            "INSERT INTO widget_preferences(key,value) VALUES(?1,?2)",
            params![
                KEY,
                format!(r#"{{"revision":1,"order":["{0}"],"pinned":["{0}"]}}"#, ids[0])
            ],
        )
        .unwrap();
        let loaded = load(&db).unwrap();
        assert_eq!(loaded.layout.order, ids);
        assert!(!serde_json::to_value(&loaded).unwrap().as_object().unwrap().contains_key("pinned"));
    }

    #[test]
    fn shape_points_and_sizes_are_bounded() {
        let mut shape = shape(230.0, 150.0, 0.0);
        assert!(shape.valid());
        shape.strokes[0][0].x = 24.1;
        assert!(!shape.valid());
        shape.strokes.clear();
        shape.width = 801.0;
        assert!(!shape.valid());
        shape.width = 230.0;
        shape.source = "file:///arbitrary.svg".into();
        assert!(!shape.valid());
        shape.source = "preset".into();
        shape.preset = "22".into();
        assert!(shape.valid());
        shape.preset = "23".into();
        assert!(!shape.valid());
    }

    #[test]
    fn stored_retired_preset_23_is_read_as_the_rounded_square() {
        let db = database();
        let ids = install(&db, &["clock"]);
        let mut legacy = shape(184.0, 184.0, 0.0);
        legacy.preset = "23".into();
        let stored = Stored {
            revision: 3,
            layout: Layout {
                order: ids.clone(),
                shapes: BTreeMap::from([(ids[0].clone(), legacy.clone())]),
                ..Layout::default()
            },
        };
        db.execute(
            "INSERT INTO widget_preferences(key,value) VALUES(?1,?2)",
            params![KEY, serde_json::to_string(&stored).unwrap()],
        )
        .unwrap();
        let loaded = load(&db).unwrap();
        legacy.preset = "01".into();
        assert_eq!(loaded.layout.shapes.get(&ids[0]), Some(&legacy));
        assert_eq!(loaded.revision, 4);
    }

    #[test]
    fn stored_retired_disabled_and_removed_ids_are_pruned_with_their_geometry() {
        let db = database();
        let ids = install(&db, &["clock", "weather", "memo"]);
        let layout = Layout {
            mode: Mode::Freeform,
            order: ids.clone(),
            stack_styles: ids.iter().map(|id| (id.clone(), style())).collect(),
            positions: ids
                .iter()
                .map(|id| (id.clone(), Point { x: 48.0, y: 64.0 }))
                .collect(),
            shapes: BTreeMap::from([(ids[1].clone(), shape(230.0, 150.0, 0.0))]),
            ..Layout::default()
        };
        let saved = configure(&db, 0, settings(&layout)).unwrap();
        restore(&db, saved.revision, layout).unwrap();
        storage::set_enabled(&db, &ids[1], false).unwrap();
        db.execute(
            "UPDATE widget_instances SET kind='fishing' WHERE id=?1",
            [&ids[2]],
        )
        .unwrap();
        let before = read(&db).unwrap();
        let after = load(&db).unwrap();
        assert_eq!(after.revision, before.revision + 1);
        assert_eq!(after.layout.order, vec![ids[0].clone()]);
        assert_eq!(
            after.layout.stack_styles.keys().collect::<Vec<_>>(),
            vec![&ids[0]]
        );
        assert_eq!(after.layout.positions.len(), 1);
        assert!(after.layout.shapes.is_empty());
        assert_eq!(load(&db).unwrap().revision, after.revision);
    }

    #[test]
    fn configure_preserves_positions_shapes_and_clears_the_stack_spot_on_anchor_change() {
        let db = database();
        let ids = install(&db, &["clock", "weather"]);
        let layout = Layout {
            mode: Mode::Freeform,
            order: ids.clone(),
            positions: BTreeMap::from([
                (ids[0].clone(), Point { x: 48.0, y: 64.0 }),
                (ids[1].clone(), Point { x: 300.0, y: 64.0 }),
            ]),
            shapes: BTreeMap::from([(ids[0].clone(), shape(184.0, 184.0, 30.0))]),
            stack_styles: ids.iter().map(|id| (id.clone(), style())).collect(),
            stack_position: Some(Point { x: 900.0, y: 40.0 }),
            ..Layout::default()
        };
        let saved = restore(&db, 0, layout.clone()).unwrap();
        let mut input = settings(&layout);
        input.mode = Mode::Stack;
        input.overlapped = false;
        let next = configure(&db, saved.revision, input.clone()).unwrap();
        assert_eq!(next.layout.positions, layout.positions);
        assert_eq!(next.layout.shapes, layout.shapes);
        assert_eq!(next.layout.stack_position, layout.stack_position);
        assert_eq!(next.layout.stack_styles, layout.stack_styles);
        input.order = vec![ids[1].clone()];
        input.anchor = Anchor::BottomLeft;
        let next = configure(&db, next.revision, input).unwrap();
        assert_eq!(
            next.layout.positions.keys().collect::<Vec<_>>(),
            vec![&ids[1]]
        );
        assert!(next.layout.shapes.is_empty());
        assert_eq!(
            next.layout.stack_styles.keys().collect::<Vec<_>>(),
            vec![&ids[1]]
        );
        assert!(next.layout.stack_position.is_none());
    }

    #[test]
    fn restore_replaces_geometry_and_skips_widgets_that_can_no_longer_be_placed() {
        let db = database();
        let ids = install(&db, &["clock", "music"]);
        let snapshot = Layout {
            mode: Mode::Freeform,
            order: ids.clone(),
            positions: BTreeMap::from([(ids[1].clone(), Point { x: 10.0, y: 20.0 })]),
            ..Layout::default()
        };
        let saved = restore(&db, 0, snapshot.clone()).unwrap();
        let (moved, changed) = update(&db, |layout| {
            layout
                .positions
                .insert(ids[0].clone(), Point { x: 500.0, y: 500.0 });
            layout.mode = Mode::Stack;
            Ok(())
        })
        .unwrap();
        assert!(changed);
        assert_eq!(moved.revision, saved.revision + 1);
        assert_eq!(update(&db, |_| Ok(())).unwrap(), (moved.clone(), false));
        storage::set_enabled(&db, &ids[1], false).unwrap();
        let restored = restore(&db, load(&db).unwrap().revision, snapshot).unwrap();
        assert_eq!(restored.layout.order, vec![ids[0].clone()]);
        assert!(restored.layout.positions.is_empty());
        assert_eq!(restored.layout.mode, Mode::Freeform);
    }

    #[test]
    fn removing_an_item_clears_its_geometry_without_touching_widget_data() {
        let db = database();
        let ids = install(&db, &["clock"]);
        let widget = storage::get(&db, &ids[0]).unwrap();
        update(&db, |layout| {
            layout.order.push(ids[0].clone());
            layout.stack_styles.insert(ids[0].clone(), style());
            layout
                .positions
                .insert(ids[0].clone(), Point { x: 1.0, y: 2.0 });
            layout
                .shapes
                .insert(ids[0].clone(), shape(184.0, 184.0, 0.0));
            Ok(())
        })
        .unwrap();
        let (stored, changed) = update(&db, |layout| {
            without(layout, &ids[0]);
            Ok(())
        })
        .unwrap();
        assert!(changed);
        assert_eq!(stored.layout, Layout::default());
        let current = storage::get(&db, &ids[0]).unwrap();
        assert_eq!(current.data, widget.data);
        assert_eq!(current.revision, widget.revision);
    }

    #[test]
    fn display_windows_open_only_for_placed_enabled_widgets_in_freeform() {
        for mutation in [
            "none",
            "stack",
            "unplaced",
            "disable",
            "remove",
            "reinstall",
        ] {
            let directory = tempfile::tempdir().unwrap();
            let mut state = crate::app::tests::state();
            state.app_data = directory.path().into();
            let db = lock(&state.db).unwrap();
            let id = install(&db, &["clock"]).remove(0);
            update(&db, |layout| {
                layout.mode = Mode::Freeform;
                layout.order.push(id.clone());
                Ok(())
            })
            .unwrap();
            match mutation {
                "stack" => {
                    update(&db, |layout| {
                        layout.mode = Mode::Stack;
                        Ok(())
                    })
                    .unwrap();
                }
                "unplaced" => {
                    update(&db, |layout| {
                        without(layout, &id);
                        Ok(())
                    })
                    .unwrap();
                }
                "disable" => storage::set_enabled(&db, &id, false).unwrap(),
                "remove" => storage::remove(&db, &state.app_data, &id, false).unwrap(),
                "reinstall" => {
                    storage::remove(&db, &state.app_data, &id, false).unwrap();
                    load(&db).unwrap();
                    storage::install(&db, &state.app_data, &["clock".into()]).unwrap();
                }
                _ => {}
            }
            drop(db);
            assert_eq!(
                displayable(&state, &id).is_ok(),
                mutation == "none",
                "{mutation}"
            );
        }
    }

    #[test]
    fn editing_gate_is_reversible_and_keeps_the_users_pause() {
        let state = crate::app::tests::state();
        lock(&state.runtime).unwrap().paused = true;
        assert!(apply_editing(&state, true).unwrap());
        assert!(state.widget_editing.load(Ordering::SeqCst));
        assert!(!apply_editing(&state, true).unwrap());
        assert!(apply_editing(&state, false).unwrap());
        assert!(!state.widget_editing.load(Ordering::SeqCst));
        assert!(lock(&state.runtime).unwrap().paused);
    }

    #[test]
    fn display_size_uses_shared_kind_sizes_rotation_and_a_uniform_margin() {
        assert_eq!(display_size(None, "weather"), (254.0, 174.0));
        assert_eq!(display_size(None, "clock"), (208.0, 208.0));
        let rotated = display_size(Some(&shape(100.0, 50.0, 90.0)), "clock");
        assert!((rotated.0 - 124.0).abs() < 1e-9 && (rotated.1 - 124.0).abs() < 1e-9);
    }

    #[test]
    fn clamping_keeps_visible_spots_and_pulls_lost_ones_into_the_nearest_work_area() {
        let second = Rect {
            x: 1440.0,
            y: 0.0,
            width: 1920.0,
            height: 1080.0,
        };
        let areas = [AREA, second];
        let visible = Point {
            x: 1400.0,
            y: 100.0,
        };
        assert_eq!(clamp_point(&visible, (200.0, 100.0), &areas), visible);
        let lost = Point {
            x: 4000.0,
            y: -500.0,
        };
        assert_eq!(
            clamp_point(&lost, (200.0, 100.0), &areas),
            Point { x: 3160.0, y: 0.0 }
        );
        let barely = Point {
            x: 1430.0,
            y: 100.0,
        };
        assert_eq!(
            clamp_point(&barely, (200.0, 100.0), &[AREA]),
            Point {
                x: 1240.0,
                y: 100.0
            }
        );
        assert_eq!(clamp_point(&lost, (200.0, 100.0), &[]), lost);
    }

    #[test]
    fn automatic_placement_starts_top_right_and_avoids_placed_widgets() {
        let size = (208.0, 208.0);
        let first = auto_place(AREA, size, &[]);
        assert_eq!(first, Point { x: 1208.0, y: 49.0 });
        let occupied = [Rect::at(&first, size)];
        let second = auto_place(AREA, size, &occupied);
        assert_eq!(second.x, first.x);
        assert!(second.y >= first.y + size.1);
        assert!(!Rect::at(&second, size).intersects(&occupied[0]));
        let full = [AREA];
        let fallback = auto_place(AREA, size, &full);
        assert!(fallback.x >= AREA.x && fallback.y >= AREA.y);
    }

    #[test]
    fn compact_widgets_use_their_content_sizes_for_non_overlapping_placement() {
        let todo = display_size(None, "todo");
        let focus = display_size(None, "focus-timer");
        assert_eq!(todo, (124.0, 54.0));
        assert_eq!(focus, (180.0, 192.0));
        assert_eq!(display_size(None, "memo"), (238.0, 174.0));
        let first = auto_place(AREA, todo, &[]);
        let occupied = [Rect::at(&first, todo)];
        let second = auto_place(AREA, focus, &occupied);
        assert_eq!(second.y, first.y + todo.1);
        assert!(!Rect::at(&second, focus).intersects(&occupied[0]));
        // Removing and placing the timer again yields the same safe position.
        assert_eq!(auto_place(AREA, focus, &occupied), second);
    }

    #[test]
    fn snapping_prefers_nearby_widget_edges_then_the_grid() {
        let others = [Rect {
            x: 100.0,
            y: 100.0,
            width: 200.0,
            height: 100.0,
        }];
        let size = (120.0, 80.0);
        let point = Point { x: 305.0, y: 97.0 };
        assert_eq!(
            snap(&point, size, &others, false, true),
            Point { x: 300.0, y: 100.0 }
        );
        assert_eq!(
            snap(&point, size, &others, true, false),
            Point { x: 304.0, y: 96.0 }
        );
        assert_eq!(snap(&point, size, &others, false, false), point);
        let far = Point { x: 500.0, y: 403.0 };
        assert_eq!(
            snap(&far, size, &others, true, true),
            Point { x: 504.0, y: 400.0 }
        );
    }

    #[test]
    fn stack_fold_uses_the_target_width_for_anchored_and_saved_positions() {
        let area = Rect {
            x: 0.0,
            y: 0.0,
            width: 1364.0,
            height: 1024.0,
        };
        let saved = Point { x: 954.0, y: 24.0 };
        for _ in 0..2 {
            assert_eq!(clamp_stack_point(&saved, (354.0, 320.0), &[area]), saved);
            assert_eq!(
                clamp_stack_point(&saved, (454.0, 92.0), &[area]),
                Point { x: 910.0, y: 24.0 }
            );
            assert_eq!(
                stack_origin(area, (454.0, 92.0), &Anchor::TopRight),
                Point { x: 886.0, y: 24.0 }
            );
        }
        // Freeform windows deliberately retain their partially visible saved placement.
        assert_eq!(clamp_point(&saved, (454.0, 92.0), &[area]), saved);
    }

    #[test]
    fn stack_bounds_preserve_visible_positions_and_choose_the_nearest_monitor() {
        let left = Rect {
            x: -1364.0,
            y: -200.0,
            width: 1364.0,
            height: 1024.0,
        };
        let right = Rect {
            x: 0.0,
            y: 0.0,
            width: 1920.0,
            height: 1080.0,
        };
        let areas = [left, right];
        let visible = Point {
            x: -800.5,
            y: 20.25,
        };
        assert_eq!(clamp_stack_point(&visible, (454.0, 92.0), &areas), visible);
        for (point, expected) in [
            (Point { x: -410.0, y: 24.0 }, Point { x: -454.0, y: 24.0 }),
            (
                Point {
                    x: -1400.0,
                    y: -240.0,
                },
                Point {
                    x: -1364.0,
                    y: -200.0,
                },
            ),
            (
                Point {
                    x: 1800.0,
                    y: 1000.0,
                },
                Point {
                    x: 1466.0,
                    y: 988.0,
                },
            ),
            (
                Point {
                    x: 4000.0,
                    y: -500.0,
                },
                Point { x: 1466.0, y: 0.0 },
            ),
        ] {
            assert_eq!(clamp_stack_point(&point, (454.0, 92.0), &areas), expected);
        }
        assert_eq!(clamp_stack_point(&visible, (454.0, 92.0), &[]), visible);
        let tiny = Rect {
            x: -200.0,
            y: 50.0,
            width: 40.0,
            height: 30.0,
        };
        assert_eq!(
            clamp_stack_point(&visible, (80.0, 48.0), &[tiny]),
            Point { x: -200.0, y: 50.0 }
        );
    }

    #[test]
    fn stack_anchor_and_fit_use_the_work_area() {
        let size = (300.0, 200.0);
        assert_eq!(
            stack_origin(AREA, size, &Anchor::TopLeft),
            Point { x: 24.0, y: 49.0 }
        );
        assert_eq!(
            stack_origin(AREA, size, &Anchor::BottomRight),
            Point {
                x: 1116.0,
                y: 676.0
            }
        );
        assert_eq!(fit_size(606.0, 92.0, AREA).unwrap(), (606.0, 92.0));
        assert_eq!(fit_size(12.0, 12.0, AREA).unwrap(), (80.0, 48.0));
        assert_eq!(fit_size(1800.0, 2000.0, AREA).unwrap(), (1392.0, 827.0));
        assert!(fit_size(f64::NAN, 92.0, AREA).is_err());
        assert!(fit_size(300.0, f64::INFINITY, AREA).is_err());
    }

    #[test]
    fn closing_the_stack_survives_settings_changes_and_legacy_layouts_start_open() {
        let legacy: Layout = serde_json::from_str(r#"{"mode":"stack","order":[]}"#).unwrap();
        assert!(!legacy.stack_hidden);
        let hidden = Layout {
            stack_hidden: true,
            ..Layout::default()
        };
        let input = LayoutSettings {
            mode: Mode::Stack,
            order: vec![],
            anchor: Anchor::TopLeft,
            width: Width(410),
            overlapped: false,
            one_expanded: false,
            snap_to_grid: true,
            show_guides: false,
        };
        assert!(configured(&hidden, input).stack_hidden);
    }
}
