use crate::{
    app::{lock, AppState},
    character_reaction_host, characters,
    desktop_geometry::Rect,
    store,
};
use std::{
    collections::BTreeMap,
    sync::{atomic::Ordering, Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, WebviewWindow};

type Result<T> = std::result::Result<T, String>;
const FRAME: Duration = Duration::from_millis(33);
const MAX_RUN: Duration = Duration::from_secs(6);
const GESTURES: [&str; 6] = ["walk", "fast-walk", "crawl", "climb", "short-fall", "peek"];

#[derive(Clone, Copy, Debug, PartialEq)]
struct Point {
    x: f64,
    y: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct Bounds {
    area: Rect,
    sprite: Rect,
    width: f64,
    height: f64,
    peek_left: bool,
    peek_right: bool,
}

impl Bounds {
    fn clamp(self, point: Point, peek: bool) -> Point {
        let visible = if peek { 0.5 } else { 1.0 };
        let left = self.area.x - self.sprite.x - self.sprite.width * (1.0 - visible);
        let right = self.area.x + self.area.width - self.sprite.x - self.sprite.width * visible;
        let top = self.area.y - self.sprite.y;
        let bottom = self.area.y + self.area.height - self.sprite.y - self.sprite.height;
        Point {
            x: point.x.clamp(left.ceil(), right.floor().max(left.ceil())),
            y: point.y.clamp(top.ceil(), bottom.floor().max(top.ceil())),
        }
    }

    fn rect(self, point: Point) -> Rect {
        Rect {
            x: point.x + self.sprite.x,
            y: point.y + self.sprite.y,
            ..self.sprite
        }
    }
}

#[derive(Clone)]
struct Run {
    token: String,
    execution: Option<String>,
    identity: usize,
    epoch: u64,
    definition: String,
    roster: Vec<String>,
    bounds: Bounds,
    plan: Plan,
    started: Instant,
    trace_skips: Option<Arc<Mutex<u32>>>,
}

struct Entry {
    anchor: Point,
    saved: Option<(f64, f64)>,
    bounds: Bounds,
    identity: usize,
    definition: String,
    epoch: u64,
    due: Instant,
    blocked: bool,
    run: Option<Run>,
    restore: Option<Restore>,
    trace_gate: Option<(bool, bool, bool)>,
}

#[derive(Clone, Copy, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
enum FrameSkip {
    AmbientOrEpoch,
    Context,
    PreferenceOrReservation,
    MissingWindow,
    Geometry,
    WindowChanged,
    MissingPosition,
    Collision,
    ActionBusy,
    QueuedAmbientOrEpoch,
    DbBusy,
    QueuedContext,
    LifeBusy,
    QueuedPreferenceOrReservation,
    PositionFailed,
}

fn trace_frame_skip(id: &str, run: &Run, reason: FrameSkip) {
    let Some(seen) = &run.trace_skips else { return };
    let Ok(mut seen) = seen.lock() else { return };
    let bit = 1 << reason as u32;
    if *seen & bit != 0 {
        return;
    }
    *seen |= bit;
    drop(seen);
    crate::character_gestures::trace_record(serde_json::json!({
        "kind": "wander-frame-skipped", "characterId": id,
        "token": run.token, "reason": reason, "elapsedMs": run.started.elapsed().as_millis(),
    }));
}

impl Entry {
    fn ready(&mut self, allowed: bool, now: Instant, seed: u64) -> bool {
        if !allowed {
            self.blocked = true;
            self.due = now + interval(seed);
            false
        } else if self.blocked {
            self.blocked = false;
            self.due = now + interval(seed);
            false
        } else {
            self.run.is_none() && now >= self.due
        }
    }
}

#[derive(Clone)]
struct Restore {
    token: String,
    identity: usize,
    anchor: Point,
    bounds: Bounds,
}

#[derive(Default)]
pub(crate) struct Runtime {
    entries: BTreeMap<String, Entry>,
    preferences: BTreeMap<String, (usize, bool)>,
}

impl Runtime {
    pub(crate) fn motion_allowed(&self, id: &str) -> bool {
        self.preferences.get(id).is_some_and(|&(owner, reduced)| {
            !reduced
                && self
                    .entries
                    .get(id)
                    .is_none_or(|entry| entry.identity == owner)
        })
    }
    pub(crate) fn reduced_motion(&self, id: &str, identity: usize) -> bool {
        self.preferences
            .get(id)
            .is_none_or(|&(owner, reduced)| owner != identity || reduced)
    }
}

#[derive(Clone, Copy, Debug)]
struct Plan {
    gesture: &'static str,
    anchor: Point,
    target: Point,
    duration: Duration,
}

impl Plan {
    fn at(self, elapsed: Duration) -> Point {
        let progress = (elapsed.as_secs_f64() / self.duration.as_secs_f64()).clamp(0.0, 1.0);
        // Out and back in one bounded run. Walking never changes the placement height.
        let distance = (std::f64::consts::PI * progress).sin().powi(2);
        Point {
            x: self.anchor.x + (self.target.x - self.anchor.x) * distance,
            y: self.anchor.y + (self.target.y - self.anchor.y) * distance,
        }
    }
}

fn interval(seed: u64) -> Duration {
    Duration::from_millis(20_000 + seed % 25_001)
}

fn random() -> u64 {
    let bytes = *uuid::Uuid::new_v4().as_bytes();
    u64::from_le_bytes(bytes[..8].try_into().expect("UUID prefix"))
}

fn intersects(a: Rect, b: Rect) -> bool {
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

fn swept(from: Rect, to: Rect) -> Rect {
    let x = from.x.min(to.x);
    let y = from.y.min(to.y);
    Rect {
        x,
        y,
        width: (from.x + from.width).max(to.x + to.width) - x,
        height: (from.y + from.height).max(to.y + to.height) - y,
    }
}

// prepare_direct owns action when checking this reservation. User contact
// removes it before an older automatic start can replace the user's reaction.
pub(crate) fn accepts_start(
    state: &AppState,
    id: &str,
    token: &str,
    identity: usize,
) -> Result<bool> {
    let life = lock(&state.life)?;
    Ok(life
        .wandering
        .entries
        .get(id)
        .and_then(|entry| entry.run.as_ref())
        .is_some_and(|run| {
            run.token == token
                && run.identity == identity
                && run.epoch == state.epoch.load(Ordering::SeqCst)
        }))
}

fn plan(bounds: Bounds, anchor: Point, available: &[String], seed: u64) -> Option<Plan> {
    let normal = bounds.clamp(anchor, false);
    let radius = bounds.width * 1.5;
    let left = bounds.area.x - bounds.sprite.x;
    let right = bounds.area.x + bounds.area.width - bounds.sprite.x - bounds.sprite.width;
    let near_left = (normal.x - left).abs() <= radius;
    let near_right = (normal.x - right).abs() <= radius;
    let edge = near_left || near_right;
    let options: Vec<_> = GESTURES
        .into_iter()
        .filter(|name| {
            available.iter().any(|value| value.as_str() == *name)
                && (!matches!(*name, "climb" | "short-fall" | "peek") || edge)
                && (*name != "peek"
                    || (near_left && bounds.peek_left)
                    || (near_right && bounds.peek_right))
        })
        .collect();
    let gesture = *options.get((seed as usize) % options.len().max(1))?;
    let direction = if seed & 1 == 0 { -1.0 } else { 1.0 };
    let fraction = 0.4 + ((seed >> 8) % 601) as f64 / 1000.0;
    let mut target = Point {
        x: normal.x + direction * radius * fraction,
        y: normal.y,
    };
    if matches!(gesture, "climb" | "short-fall" | "peek") {
        let use_left = near_left && (!near_right || (seed & 1 == 0));
        target.x = if use_left { left } else { right };
        if gesture == "climb" {
            target.y -= bounds.height * 0.5;
        } else if gesture == "short-fall" {
            target.y += bounds.height * 0.5;
        } else {
            target.x += if use_left {
                -bounds.sprite.width * 0.5
            } else {
                bounds.sprite.width * 0.5
            };
        }
    }
    target = bounds.clamp(target, gesture == "peek");
    target.x = target.x.clamp(normal.x - radius, normal.x + radius);
    target.y = target.y.clamp(
        normal.y - bounds.height * 0.5,
        normal.y + bounds.height * 0.5,
    );
    if (target.x - normal.x).abs() < 1.0 && (target.y - normal.y).abs() < 1.0 {
        return None;
    }
    Some(Plan {
        gesture,
        anchor: normal,
        target,
        duration: if gesture == "fast-walk" {
            Duration::from_millis(3400)
        } else {
            MAX_RUN
        },
    })
}

fn bounds(window: &WebviewWindow, sprite_size: u32) -> Option<(Point, Bounds)> {
    let position = window.outer_position().ok()?;
    let size = window.inner_size().ok()?;
    let scale = window.scale_factor().ok()?;
    let monitor = window.current_monitor().ok()??;
    let area = monitor.work_area();
    let monitors = window.available_monitors().ok()?;
    let area = Rect {
        x: area.position.x as f64,
        y: area.position.y as f64,
        width: area.size.width as f64,
        height: area.size.height as f64,
    };
    let physical_sprite = sprite_size as f64 * scale;
    // Reserve the entire sprite envelope for changing animation frames. The
    // current opaque mask is used separately for collisions with other bodies.
    let sprite = Rect {
        x: (size.width as f64 - physical_sprite) / 2.0,
        y: (size.height as f64 - physical_sprite) / 2.0,
        width: physical_sprite,
        height: physical_sprite,
    };
    let adjacent = |x: f64| {
        monitors.iter().any(|other| {
            other.position() != monitor.position() && {
                let at = other.position();
                let size = other.size();
                x >= at.x as f64
                    && x < at.x as f64 + size.width as f64
                    && area.y < at.y as f64 + size.height as f64
                    && area.y + area.height > at.y as f64
            }
        })
    };
    Some((
        Point {
            x: position.x as f64,
            y: position.y as f64,
        },
        Bounds {
            area,
            sprite,
            width: physical_sprite,
            height: physical_sprite,
            peek_left: !adjacent(area.x - 1.0),
            peek_right: !adjacent(area.x + area.width + 1.0),
        },
    ))
}

fn saved_position(state: &AppState, id: &str) -> Result<Option<(f64, f64)>> {
    Ok(
        store::window_position(&*lock(&state.db)?, &format!("body-{id}"))?
            .filter(|point| point.x.is_finite() && point.y.is_finite())
            .map(|point| (point.x, point.y)),
    )
}

fn matches_geometry(bounds: Bounds, area: Rect, size: tauri::PhysicalSize<u32>) -> bool {
    bounds.area == area
        && size.width == (bounds.width + bounds.sprite.x * 2.0).round() as u32
        && size.height == (bounds.height + bounds.sprite.y * 2.0).round() as u32
}

fn same_geometry(window: &WebviewWindow, bounds: Bounds) -> bool {
    let Some(monitor) = window.current_monitor().ok().flatten() else {
        return false;
    };
    let Ok(size) = window.inner_size() else {
        return false;
    };
    let work = monitor.work_area();
    matches_geometry(
        bounds,
        Rect {
            x: work.position.x as f64,
            y: work.position.y as f64,
            width: work.size.width as f64,
            height: work.size.height as f64,
        },
        size,
    )
}

pub(crate) fn cancel(app: &AppHandle, state: &Arc<AppState>, id: &str) -> Result<()> {
    let pending = {
        let _action = lock(&state.action)?;
        let mut life = lock(&state.life)?;
        let Some(entry) = life.wandering.entries.get_mut(id) else {
            return Ok(());
        };
        entry.blocked = true;
        entry.due = Instant::now() + interval(random());
        let execution = if let Some(run) = entry.run.take() {
            entry.restore = Some(Restore {
                token: run.token,
                identity: run.identity,
                anchor: entry.anchor,
                bounds: run.bounds,
            });
            run.execution
        } else {
            None
        };
        entry.restore.clone().map(|restore| (restore, execution))
    };
    if let Some((pending, execution)) = pending {
        if crate::character_gestures::trace_enabled() {
            crate::character_gestures::trace_record(serde_json::json!({
                "kind": "wander-restore-request", "characterId": id, "token": pending.token,
                "identity": pending.identity,
                "anchorPhysical": { "x": pending.anchor.x, "y": pending.anchor.y },
            }));
        }
        if let Some(execution) = execution {
            character_reaction_host::direct_end(app, state.clone(), id, &execution, true)?;
        }
        if let Some(window) = app.get_webview_window(&format!("body-{id}")) {
            if character_reaction_host::window_identity(&window) == pending.identity {
                let anchor = window
                    .current_monitor()
                    .ok()
                    .flatten()
                    .and_then(|monitor| {
                        let work = monitor.work_area();
                        let size = window.inner_size().ok()?;
                        let area = Rect {
                            x: work.position.x as f64,
                            y: work.position.y as f64,
                            width: work.size.width as f64,
                            height: work.size.height as f64,
                        };
                        let changed = !matches_geometry(pending.bounds, area, size);
                        Some(if changed {
                            Bounds {
                                area,
                                sprite: Rect {
                                    x: 0.0,
                                    y: 0.0,
                                    width: size.width as f64,
                                    height: size.height as f64,
                                },
                                ..pending.bounds
                            }
                            .clamp(pending.anchor, false)
                        } else {
                            pending.anchor
                        })
                    })
                    .unwrap_or(pending.anchor);
                // Serialize restoration with physical contact/native drag setup.
                // Frame callbacks try action rather than waiting on the UI thread.
                let _action = lock(&state.action)?;
                let restore = {
                    let mut life = lock(&state.life)?;
                    life.wandering.entries.get_mut(id).is_some_and(|entry| {
                        let current = entry.identity == pending.identity
                            && entry.run.is_none()
                            && entry
                                .restore
                                .as_ref()
                                .is_some_and(|restore| restore.token == pending.token);
                        if current {
                            entry.restore = None;
                            entry.anchor = anchor;
                        }
                        current
                    })
                };
                if !restore {
                    return Ok(());
                }
                let result = window.set_position(tauri::PhysicalPosition::new(
                    anchor.x.round() as i32,
                    anchor.y.round() as i32,
                ));
                if crate::character_gestures::trace_enabled() {
                    crate::character_gestures::trace_record(serde_json::json!({
                        "kind": "wander-restore-result", "characterId": id,
                        "token": pending.token, "accepted": result.is_ok(),
                        "targetPhysical": { "x": anchor.x.round(), "y": anchor.y.round() },
                    }));
                }
                result.map_err(|error| error.to_string())?;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn report_character_motion_preference(
    app: AppHandle,
    window: WebviewWindow,
    state: tauri::State<'_, Arc<AppState>>,
    reduced_motion: bool,
) -> Result<()> {
    let id = window
        .label()
        .strip_prefix("body-")
        .ok_or("캐릭터 본체에서 동작 설정을 알려 주세요.")?;
    let identity = character_reaction_host::window_identity(&window);
    {
        let _action = lock(&state.action)?;
        if !characters::active_ids(&*lock(&state.db)?)?
            .iter()
            .any(|active| active == id)
        {
            return Ok(());
        }
        lock(&state.life)?
            .wandering
            .preferences
            .insert(id.into(), (identity, reduced_motion));
    }
    if crate::character_gestures::trace_enabled() {
        crate::character_gestures::trace_record(serde_json::json!({
            "kind": "motion-preference", "characterId": id, "identity": identity,
            "reducedMotion": reduced_motion,
        }));
    }
    if reduced_motion {
        cancel(&app, state.inner(), id)?;
    }
    Ok(())
}

// Native observations happen before the action guard: Tauri getters may wait for
// the UI thread, which must remain able to deliver user cancellation.
pub(crate) fn tick(app: &AppHandle, state: &Arc<AppState>) -> Result<()> {
    let members = characters::active_members(&*lock(&state.db)?)?;
    let active = members
        .iter()
        .map(|member| member.id.clone())
        .collect::<Vec<_>>();
    let old = lock(&state.life)?
        .wandering
        .entries
        .keys()
        .cloned()
        .collect::<Vec<_>>();
    for id in old.iter().filter(|id| !active.contains(id)) {
        cancel(app, state, id)?;
    }
    {
        let mut life = lock(&state.life)?;
        life.wandering.entries.retain(|id, _| active.contains(id));
        life.wandering
            .preferences
            .retain(|id, _| active.contains(id));
    }
    for member in members {
        let id = &member.id;
        let Some(window) = app.get_webview_window(&format!("body-{id}")) else {
            cancel(app, state, id)?;
            continue;
        };
        let identity = character_reaction_host::window_identity(&window);
        let Some((observed, bounds)) = bounds(&window, member.definition.sprite_size) else {
            cancel(app, state, id)?;
            continue;
        };
        let visible =
            window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(true);
        let definition = character_reaction_host::definition_revision(&member.definition);
        let epoch = state.epoch.load(Ordering::SeqCst);
        let saved = saved_position(state, id)?;
        let changed = lock(&state.life)?
            .wandering
            .entries
            .get(id)
            .is_some_and(|entry| {
                entry.identity != identity
                    || entry.definition != definition
                    || entry.bounds.area != bounds.area
                    || entry.bounds.width != bounds.width
                    || entry.saved != saved
                    || entry.epoch != epoch
            });
        if changed {
            cancel(app, state, id)?;
        }
        let start = {
            let _action = lock(&state.action)?;
            let allowed = visible && super::ambient_allowed(state, id)?;
            let now = Instant::now();
            let mut life = lock(&state.life)?;
            let reduced = life.wandering.reduced_motion(id, identity);
            let entry = life
                .wandering
                .entries
                .entry(id.clone())
                .or_insert_with(|| Entry {
                    anchor: bounds.clamp(observed, false),
                    saved,
                    bounds,
                    identity,
                    definition: definition.clone(),
                    epoch,
                    due: now + interval(random()),
                    blocked: true,
                    run: None,
                    restore: None,
                    trace_gate: None,
                });
            if changed {
                entry.anchor = bounds.clamp(
                    if (entry.saved != saved && saved.is_some()) || entry.identity != identity {
                        observed
                    } else {
                        entry.anchor
                    },
                    false,
                );
                entry.saved = saved;
                entry.bounds = bounds;
                entry.identity = identity;
                entry.definition = definition.clone();
                entry.epoch = epoch;
                entry.restore = None;
            }
            let ready = entry.ready(allowed && !reduced, now, random());
            if crate::character_gestures::trace_enabled() {
                let gate = (visible, allowed, reduced);
                if entry.trace_gate != Some(gate) || ready {
                    crate::character_gestures::trace_record(serde_json::json!({
                        "kind": "wander-gate", "characterId": id, "identity": identity,
                        "visible": visible, "ambientAllowed": allowed, "reducedMotion": reduced,
                        "blocked": entry.blocked, "ready": ready,
                        "dueAfterMs": entry.due.saturating_duration_since(now).as_millis(),
                        "actualPhysical": { "x": observed.x, "y": observed.y },
                        "anchorPhysical": { "x": entry.anchor.x, "y": entry.anchor.y },
                    }));
                }
                entry.trace_gate = Some(gate);
            }
            if !ready {
                None
            } else {
                entry.due = now + interval(random());
                let available = member
                    .definition
                    .gesture_motions
                    .iter()
                    .filter(|gesture| gesture.hold.is_some())
                    .map(|gesture| gesture.gesture.clone())
                    .collect::<Vec<_>>();
                plan(entry.bounds, entry.anchor, &available, random()).map(|plan| {
                    let run = Run {
                        token: uuid::Uuid::new_v4().to_string(),
                        execution: None,
                        identity,
                        epoch: state.epoch.load(Ordering::SeqCst),
                        definition: definition.clone(),
                        roster: active.clone(),
                        bounds: entry.bounds,
                        plan,
                        started: now,
                        trace_skips: crate::character_gestures::trace_enabled()
                            .then(|| Arc::new(Mutex::new(0))),
                    };
                    if crate::character_gestures::trace_enabled() {
                        crate::character_gestures::trace_record(serde_json::json!({
                            "kind": "wander-plan", "characterId": id, "token": run.token,
                            "identity": identity, "epoch": run.epoch, "gesture": plan.gesture,
                            "durationMs": plan.duration.as_millis(),
                            "nextAfterMs": entry.due.saturating_duration_since(now).as_millis(),
                            "actualPhysical": { "x": observed.x, "y": observed.y },
                            "anchorPhysical": { "x": plan.anchor.x, "y": plan.anchor.y },
                            "targetPhysical": { "x": plan.target.x, "y": plan.target.y },
                            "savedPhysical": saved,
                            "workAreaPhysical": entry.bounds.area,
                            "spritePhysical": entry.bounds.sprite,
                            "bodyWidthPhysical": entry.bounds.width,
                            "bodyHeightPhysical": entry.bounds.height,
                        }));
                    }
                    entry.run = Some(run.clone());
                    run
                })
            }
        };
        if !visible
            || !super::ambient_allowed(state, id)?
            || lock(&state.life)?.wandering.reduced_motion(id, identity)
        {
            cancel(app, state, id)?;
        } else if let Some(run) = start {
            start_run(app, state, id, run)?;
        }
    }
    Ok(())
}

fn start_run(app: &AppHandle, state: &Arc<AppState>, id: &str, run: Run) -> Result<()> {
    let execution = character_reaction_host::ambient_start(
        app,
        state.clone(),
        id,
        run.plan.gesture,
        run.identity,
        &run.token,
    )?;
    let retained = {
        let mut life = lock(&state.life)?;
        let current = life
            .wandering
            .entries
            .get_mut(id)
            .and_then(|entry| entry.run.as_mut())
            .filter(|current| current.token == run.token);
        if let Some(current) = current {
            current.execution = execution.clone();
            execution.is_some()
        } else {
            false
        }
    };
    if crate::character_gestures::trace_enabled() {
        crate::character_gestures::trace_record(serde_json::json!({
            "kind": "wander-start", "characterId": id, "token": run.token,
            "executionId": execution, "retained": retained,
        }));
    }
    if !retained {
        if let Some(execution) = execution {
            character_reaction_host::direct_end(app, state.clone(), id, &execution, true)?;
        }
        cancel(app, state, id)?;
        return Ok(());
    }
    let app = app.clone();
    let state = state.clone();
    let id = id.to_string();
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(FRAME);
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            let elapsed = run.started.elapsed();
            if elapsed >= run.plan.duration.min(MAX_RUN)
                || !frame(&app, &state, &id, &run, elapsed).unwrap_or(false)
            {
                if crate::character_gestures::trace_enabled() {
                    crate::character_gestures::trace_record(serde_json::json!({
                        "kind": "wander-finish", "characterId": id, "token": run.token,
                        "elapsedMs": elapsed.as_millis(),
                        "durationReached": elapsed >= run.plan.duration.min(MAX_RUN),
                    }));
                }
                let current = lock(&state.life)
                    .ok()
                    .and_then(|life| {
                        life.wandering
                            .entries
                            .get(&id)
                            .and_then(|entry| entry.run.as_ref())
                            .map(|current| current.token == run.token)
                    })
                    .unwrap_or(false);
                if current {
                    let _ = cancel(&app, &state, &id);
                }
                break;
            }
        }
    });
    Ok(())
}

fn frame(
    app: &AppHandle,
    state: &Arc<AppState>,
    id: &str,
    run: &Run,
    elapsed: Duration,
) -> Result<bool> {
    {
        let _action = lock(&state.action)?;
        if state.epoch.load(Ordering::SeqCst) != run.epoch || !super::ambient_allowed(state, id)? {
            trace_frame_skip(id, run, FrameSkip::AmbientOrEpoch);
            return Ok(false);
        }
        let db = lock(&state.db)?;
        if characters::active_ids(&db)? != run.roster
            || character_reaction_host::definition_revision(&characters::get(&db, id)?.definition)
                != run.definition
        {
            trace_frame_skip(id, run, FrameSkip::Context);
            return Ok(false);
        }
        let life = lock(&state.life)?;
        if life.wandering.reduced_motion(id, run.identity)
            || life
                .wandering
                .entries
                .get(id)
                .and_then(|entry| entry.run.as_ref())
                .is_none_or(|current| current.token != run.token)
        {
            trace_frame_skip(id, run, FrameSkip::PreferenceOrReservation);
            return Ok(false);
        }
    }
    let Some(window) = app.get_webview_window(&format!("body-{id}")) else {
        trace_frame_skip(id, run, FrameSkip::MissingWindow);
        return Ok(false);
    };
    if !same_geometry(&window, run.bounds) {
        trace_frame_skip(id, run, FrameSkip::Geometry);
        return Ok(false);
    }
    let target = run.plan.at(elapsed);
    let state = state.clone();
    let id = id.to_string();
    let run = run.clone();
    let app = app.clone();
    window
        .clone()
        .run_on_main_thread(move || {
            if character_reaction_host::window_identity(&window) != run.identity
                || !same_geometry(&window, run.bounds)
            {
                trace_frame_skip(&id, &run, FrameSkip::WindowChanged);
                return;
            }
            // Read native poses before mutexes; other bodies are obstacles even while idle.
            let obstacles = app
                .webview_windows()
                .into_values()
                .filter(|other| {
                    crate::desktop::is_body(other.label())
                        && other.label() != window.label()
                        && other.is_visible().unwrap_or(false)
                })
                .filter_map(|other| {
                    let position = other.outer_position().ok()?;
                    let scale = other.scale_factor().ok()?;
                    let shape = crate::character_collision_host::body_bounds(&app, other.label())?;
                    Some(Rect {
                        x: position.x as f64 + shape.x * scale,
                        y: position.y as f64 + shape.y * scale,
                        width: shape.width * scale,
                        height: shape.height * scale,
                    })
                })
                .collect::<Vec<_>>();
            let own = crate::character_collision_host::body_bounds(&app, window.label())
                .and_then(|shape| {
                    window.scale_factor().ok().map(|scale| Rect {
                        x: target.x + shape.x * scale,
                        y: target.y + shape.y * scale,
                        width: shape.width * scale,
                        height: shape.height * scale,
                    })
                })
                .unwrap_or_else(|| run.bounds.rect(target));
            let Some(position) = window.outer_position().ok() else {
                trace_frame_skip(&id, &run, FrameSkip::MissingPosition);
                return;
            };
            let current = Rect {
                x: own.x + position.x as f64 - target.x,
                y: own.y + position.y as f64 - target.y,
                ..own
            };
            if obstacles
                .iter()
                .any(|other| intersects(swept(current, own), *other))
            {
                trace_frame_skip(&id, &run, FrameSkip::Collision);
                return;
            }
            let Ok(_action) = state.action.try_lock() else {
                trace_frame_skip(&id, &run, FrameSkip::ActionBusy);
                return;
            };
            if state.epoch.load(Ordering::SeqCst) != run.epoch
                || !super::ambient_allowed(&state, &id).unwrap_or(false)
            {
                trace_frame_skip(&id, &run, FrameSkip::QueuedAmbientOrEpoch);
                return;
            }
            let Ok(db) = state.db.try_lock() else {
                trace_frame_skip(&id, &run, FrameSkip::DbBusy);
                return;
            };
            if !characters::active_ids(&db).is_ok_and(|active| active == run.roster)
                || !characters::get(&db, &id).is_ok_and(|member| {
                    character_reaction_host::definition_revision(&member.definition)
                        == run.definition
                })
            {
                trace_frame_skip(&id, &run, FrameSkip::QueuedContext);
                return;
            }
            drop(db);
            let Ok(life) = state.life.try_lock() else {
                trace_frame_skip(&id, &run, FrameSkip::LifeBusy);
                return;
            };
            if life.wandering.reduced_motion(&id, run.identity)
                || life
                    .wandering
                    .entries
                    .get(&id)
                    .and_then(|entry| entry.run.as_ref())
                    .is_none_or(|current| current.token != run.token)
            {
                trace_frame_skip(&id, &run, FrameSkip::QueuedPreferenceOrReservation);
                return;
            }
            if window
                .set_position(tauri::PhysicalPosition::new(
                    target.x.round() as i32,
                    target.y.round() as i32,
                ))
                .is_err()
            {
                trace_frame_skip(&id, &run, FrameSkip::PositionFailed);
            }
        })
        .map_err(|error| error.to_string())?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bounds() -> Bounds {
        Bounds {
            area: Rect {
                x: -1600.0,
                y: 50.0,
                width: 1600.0,
                height: 950.0,
            },
            sprite: Rect {
                x: 8.0,
                y: 8.0,
                width: 184.0,
                height: 184.0,
            },
            width: 200.0,
            height: 200.0,
            peek_left: true,
            peek_right: true,
        }
    }

    fn entry(now: Instant) -> Entry {
        Entry {
            anchor: Point {
                x: -850.0,
                y: 700.0,
            },
            saved: Some((-850.0, 700.0)),
            bounds: bounds(),
            identity: 11,
            definition: "definition".into(),
            epoch: 0,
            due: now + Duration::from_secs(20),
            blocked: false,
            run: None,
            restore: None,
            trace_gate: None,
        }
    }

    #[test]
    fn resuming_after_a_long_pause_schedules_fresh_movement_without_catchup() {
        let now = Instant::now();
        let mut entry = entry(now);
        assert!(!entry.ready(true, now + Duration::from_secs(19), 0));
        assert!(entry.ready(true, now + Duration::from_secs(20), 0));
        assert!(!entry.ready(false, now + Duration::from_secs(21), 0));
        let resumed = now + Duration::from_secs(3600);
        assert!(!entry.ready(true, resumed, 0));
        assert!(!entry.ready(true, resumed + Duration::from_secs(19), 0));
        assert!(entry.ready(true, resumed + Duration::from_secs(20), 0));
        assert_eq!(
            entry.anchor,
            Point {
                x: -850.0,
                y: 700.0
            }
        );
    }

    #[test]
    fn cancelled_or_replaced_native_reservations_cannot_start_a_late_automatic_motion() {
        let state = crate::app::tests::state();
        let now = Instant::now();
        let mut entry = entry(now);
        entry.run = Some(Run {
            token: "request".into(),
            execution: None,
            identity: 11,
            epoch: 0,
            definition: "definition".into(),
            roster: vec!["local".into()],
            bounds: bounds(),
            plan: plan(bounds(), entry.anchor, &["walk".into()], 0).unwrap(),
            started: now,
            trace_skips: None,
        });
        lock(&state.life)
            .unwrap()
            .wandering
            .entries
            .insert("local".into(), entry);
        assert!(accepts_start(&state, "local", "request", 11).unwrap());
        assert!(!accepts_start(&state, "local", "stale", 11).unwrap());
        assert!(!accepts_start(&state, "local", "request", 12).unwrap());
        state.epoch.fetch_add(1, Ordering::SeqCst);
        assert!(!accepts_start(&state, "local", "request", 11).unwrap());
        state.epoch.store(0, Ordering::SeqCst);
        lock(&state.life)
            .unwrap()
            .wandering
            .entries
            .get_mut("local")
            .unwrap()
            .run = None;
        assert!(!accepts_start(&state, "local", "request", 11).unwrap());
    }

    #[test]
    fn swept_collision_blocks_jumping_over_another_character() {
        let from = Rect {
            x: 0.0,
            y: 0.0,
            width: 20.0,
            height: 20.0,
        };
        let to = Rect { x: 120.0, ..from };
        let other = Rect { x: 50.0, ..from };
        assert!(!intersects(from, other) && !intersects(to, other));
        assert!(intersects(swept(from, to), other));
        assert!(!intersects(swept(from, to), Rect { y: 30.0, ..other }));
    }

    #[test]
    fn changed_monitor_or_physical_size_rejects_queued_frames_at_fractional_scale() {
        let mut bounds = bounds();
        bounds.width = 176.8;
        bounds.height = 176.8;
        bounds.sprite.width = bounds.width;
        bounds.sprite.height = bounds.height;
        bounds.sprite.x = (185.0 - bounds.width) / 2.0;
        bounds.sprite.y = bounds.sprite.x;
        let size = tauri::PhysicalSize::new(185, 185);
        assert!(matches_geometry(bounds, bounds.area, size));
        assert!(!matches_geometry(
            bounds,
            Rect {
                x: 0.0,
                ..bounds.area
            },
            size
        ));
        assert!(!matches_geometry(
            bounds,
            bounds.area,
            tauri::PhysicalSize::new(280, 280)
        ));
        let point = bounds.clamp(
            Point {
                x: -2000.0,
                y: 2000.0,
            },
            false,
        );
        assert!(point.x + bounds.sprite.x >= bounds.area.x);
        assert!(
            point.y + bounds.sprite.y + bounds.sprite.height <= bounds.area.y + bounds.area.height
        );
    }

    #[test]
    fn eligible_intervals_are_twenty_to_forty_five_seconds() {
        for seed in [0, 1, 25_000, 25_001, u64::MAX] {
            assert!((Duration::from_secs(20)..=Duration::from_secs(45)).contains(&interval(seed)));
        }
    }

    #[test]
    fn walks_keep_the_baseline_and_return_without_changing_the_anchor() {
        let bounds = bounds();
        let anchor = Point {
            x: -850.0,
            y: 700.0,
        };
        for gesture in ["walk", "fast-walk", "crawl"] {
            for seed in 0..32 {
                let plan = plan(bounds, anchor, &[gesture.into()], seed).unwrap();
                assert!(plan.duration <= MAX_RUN);
                for frame in 0..=100 {
                    let position = plan.at(plan.duration.mul_f64(frame as f64 / 100.0));
                    assert_eq!(position.y, anchor.y);
                    assert!((position.x - anchor.x).abs() <= bounds.width * 1.5);
                    assert!(position.x + bounds.sprite.x >= bounds.area.x);
                    assert!(
                        position.x + bounds.sprite.x + bounds.sprite.width
                            <= bounds.area.x + bounds.area.width
                    );
                }
                assert_eq!(plan.at(plan.duration), anchor);
            }
        }
    }

    #[test]
    fn edges_stay_local_and_peek_remains_half_visible() {
        let bounds = bounds();
        let anchor = Point {
            x: -1608.0,
            y: 700.0,
        };
        for gesture in ["climb", "short-fall", "peek"] {
            let plan = plan(bounds, anchor, &[gesture.into()], 0).unwrap();
            assert!((plan.target.y - anchor.y).abs() <= bounds.height * 0.5);
            assert!((plan.target.x - anchor.x).abs() <= bounds.width * 1.5);
            assert!(plan.target.y + bounds.sprite.y >= bounds.area.y);
            assert!(
                plan.target.y + bounds.sprite.y + bounds.sprite.height
                    <= bounds.area.y + bounds.area.height
            );
            let visible_right = plan.target.x + bounds.sprite.x + bounds.sprite.width;
            assert!(visible_right - bounds.area.x >= bounds.sprite.width * 0.5);
        }
        let interior = Point {
            x: -850.0,
            y: 700.0,
        };
        assert!(plan(
            bounds,
            interior,
            &["climb".into(), "short-fall".into(), "peek".into()],
            0
        )
        .is_none());
        assert!(plan(
            Bounds {
                peek_left: false,
                peek_right: false,
                ..bounds
            },
            anchor,
            &["peek".into()],
            0
        )
        .is_none());
    }

    #[test]
    fn reduced_motion_defaults_closed_and_reports_belong_to_one_native_body() {
        let mut runtime = Runtime::default();
        assert!(runtime.reduced_motion("local", 11));
        runtime.preferences.insert("local".into(), (11, false));
        assert!(!runtime.reduced_motion("local", 11));
        assert!(runtime.reduced_motion("local", 12));
        assert!(runtime.reduced_motion("other", 11));
        runtime.preferences.insert("local".into(), (11, true));
        assert!(runtime.reduced_motion("local", 11));
    }
}
