use crate::character_collision::{Collider, Mask, Shape};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Manager, WebviewWindow};

#[derive(Clone, Copy, Debug, PartialEq)]
struct Pose {
    origin: (f64, f64),
    scale: f64,
}

#[derive(Clone, Copy)]
struct ReportToken {
    instance: u64,
    visibility_generation: u64,
}

struct AnimationCache {
    revision: u64,
    frames: Vec<Arc<Shape>>,
    fallback: Option<Arc<Shape>>,
}

#[derive(Default)]
struct Entry {
    revision: u64,
    generation: u64,
    visibility_generation: u64,
    instance: u64,
    shape: Option<Arc<Shape>>,
    pose: Option<Pose>,
    suppressed: bool,
    animation: Option<AnimationCache>,
    pending_animation: Option<u64>,
}

#[derive(Default)]
struct Registry {
    entries: BTreeMap<String, Entry>,
    generation: u64,
}

impl Registry {
    fn change(&mut self, label: &str) -> &mut Entry {
        self.generation = self.generation.wrapping_add(1);
        let entry = self.entries.entry(label.into()).or_insert_with(|| Entry {
            visibility_generation: self.generation,
            instance: self.generation,
            suppressed: true,
            ..Entry::default()
        });
        entry.generation = self.generation;
        entry
    }

    fn visibility(&mut self, label: &str, shown: bool) {
        let entry = self.change(label);
        // Every snapshot may re-show an already visible window. Only hide invalidates
        // pending geometry work; an ordinary show must not discard its cache upload.
        if !shown {
            entry.visibility_generation = entry.generation;
        }
        entry.suppressed = !shown;
        entry.pose = None;
        if !shown && (entry.animation.is_some() || entry.pending_animation.is_some()) {
            entry.animation = None;
            entry.pending_animation = None;
            entry.shape = None;
        }
    }

    fn show_token(&mut self, label: &str) -> u64 {
        self.change(label).visibility_generation
    }

    fn did_show(&mut self, label: &str, token: u64) -> bool {
        if !self
            .entries
            .get(label)
            .is_some_and(|entry| entry.visibility_generation == token)
        {
            return false;
        }
        self.visibility(label, true);
        true
    }

    fn begin_refresh(&mut self, label: &str) -> Option<u64> {
        if !self
            .entries
            .get(label)
            .is_some_and(|entry| !entry.suppressed)
        {
            return None;
        }
        Some(self.change(label).generation)
    }

    fn begin_report(&mut self, label: &str) -> ReportToken {
        let entry = self.change(label);
        ReportToken {
            instance: entry.instance,
            visibility_generation: entry.visibility_generation,
        }
    }

    fn finish_report(
        &mut self,
        label: &str,
        token: ReportToken,
        revision: u64,
        shape: Option<Arc<Shape>>,
    ) {
        if self.entries.get(label).is_some_and(|entry| {
            entry.instance == token.instance
                && entry.visibility_generation == token.visibility_generation
        }) {
            self.report(label, revision, shape);
        }
    }

    fn report(&mut self, label: &str, revision: u64, shape: Option<Arc<Shape>>) {
        if self
            .entries
            .get(label)
            .is_some_and(|entry| entry.revision >= revision)
        {
            return;
        }
        let entry = self.change(label);
        entry.revision = revision;
        entry.shape = shape;
        entry.animation = None;
        entry.pending_animation = None;
    }

    fn begin_animation(&mut self, label: &str, revision: u64) -> Option<ReportToken> {
        if self
            .entries
            .get(label)
            .is_some_and(|entry| entry.revision >= revision)
        {
            return None;
        }
        let token = self.begin_report(label);
        let entry = self.entries.get_mut(label)?;
        entry.revision = revision;
        entry.pending_animation = Some(revision);
        entry.animation = None;
        entry.shape = None;
        Some(token)
    }

    fn finish_animation(&mut self, label: &str, token: ReportToken, cache: AnimationCache) {
        let Some(entry) = self.entries.get_mut(label) else {
            return;
        };
        if entry.instance != token.instance
            || entry.visibility_generation != token.visibility_generation
            || entry.pending_animation != Some(cache.revision)
            || entry.revision != cache.revision
        {
            return;
        }
        entry.pending_animation = None;
        entry.shape = cache.fallback.clone();
        entry.animation = Some(cache);
    }

    fn select_frame(
        &mut self,
        label: &str,
        revision: u64,
        cache_revision: u64,
        frame: Option<usize>,
    ) {
        let Some(entry) = self.entries.get_mut(label) else {
            return;
        };
        let Some(cache) = &entry.animation else {
            return;
        };
        if entry.suppressed || entry.revision >= revision || cache.revision != cache_revision {
            return;
        }
        let shape = if let Some(frame) = frame {
            let Some(shape) = cache.frames.get(frame) else {
                return;
            };
            Some(shape.clone())
        } else {
            cache.fallback.clone()
        };
        entry.revision = revision;
        entry.shape = shape;
    }

    fn update_pose(&mut self, label: &str, generation: u64, pose: Option<Pose>) {
        if let Some(entry) = self.entries.get_mut(label) {
            if !entry.suppressed && entry.generation == generation {
                entry.pose = pose;
            }
        }
    }

    fn colliders(&self) -> Vec<Collider> {
        self.entries
            .values()
            .filter_map(|entry| {
                if entry.suppressed {
                    return None;
                }
                let pose = entry.pose?;
                Some(Collider {
                    shape: entry.shape.clone()?,
                    origin: pose.origin,
                    scale: pose.scale,
                })
            })
            .collect()
    }
}

#[derive(Default)]
pub(crate) struct Runtime(Mutex<Registry>);

fn projected_pose(x: f64, y: f64, scale: f64, quartz: bool) -> Option<Pose> {
    if ![x, y, scale].into_iter().all(f64::is_finite) || scale <= 0.0 {
        return None;
    }
    Some(if quartz {
        Pose {
            origin: (x / scale, y / scale),
            scale: 1.0,
        }
    } else {
        Pose {
            origin: (x, y),
            scale,
        }
    })
}

fn window_pose(window: &WebviewWindow) -> Option<Pose> {
    if !window.is_visible().ok()? || window.is_minimized().ok()? {
        return None;
    }
    let scale = window.scale_factor().ok()?;
    let position = window.inner_position().ok()?;
    projected_pose(
        position.x as f64,
        position.y as f64,
        scale,
        cfg!(target_os = "macos"),
    )
}

pub(crate) fn refresh(app: &AppHandle, label: &str) {
    let Some(runtime) = app.try_state::<Runtime>() else {
        return;
    };
    let generation = runtime
        .0
        .lock()
        .ok()
        .and_then(|mut registry| registry.begin_refresh(label));
    let Some(generation) = generation else {
        return;
    };
    // Native getters may dispatch to the UI thread. Never hold a registry or physics lock here.
    let pose = app.get_webview_window(label).as_ref().and_then(window_pose);
    if let Ok(mut registry) = runtime.0.lock() {
        registry.update_pose(label, generation, pose);
    };
}

pub(crate) fn refresh_all(app: &AppHandle) {
    let Some(runtime) = app.try_state::<Runtime>() else {
        return;
    };
    let labels: Vec<_> = runtime
        .0
        .lock()
        .map(|registry| registry.entries.keys().cloned().collect())
        .unwrap_or_default();
    for label in labels {
        refresh(app, &label);
    }
}

pub(crate) fn prepare_show(window: &WebviewWindow) -> Option<u64> {
    if !crate::desktop::is_body(window.label()) {
        return None;
    }
    window
        .try_state::<Runtime>()?
        .0
        .lock()
        .ok()
        .map(|mut registry| registry.show_token(window.label()))
}

pub(crate) fn did_show(window: &WebviewWindow, token: Option<u64>) {
    let Some(token) = token else {
        return;
    };
    let Some(runtime) = window.try_state::<Runtime>() else {
        return;
    };
    let accepted = runtime
        .0
        .lock()
        .map(|mut registry| registry.did_show(window.label(), token))
        .unwrap_or(false);
    if accepted {
        refresh(window.app_handle(), window.label());
    }
}

pub(crate) fn visibility(window: &WebviewWindow, shown: bool) {
    if !crate::desktop::is_body(window.label()) {
        return;
    }
    let Some(runtime) = window.try_state::<Runtime>() else {
        return;
    };
    if let Ok(mut registry) = runtime.0.lock() {
        registry.visibility(window.label(), shown);
    }
    if shown {
        refresh(window.app_handle(), window.label());
    }
}

pub(crate) fn remove(app: &AppHandle, label: &str) {
    if let Some(runtime) = app.try_state::<Runtime>() {
        if let Ok(mut registry) = runtime.0.lock() {
            registry.entries.remove(label);
        }
    }
}

pub(crate) fn colliders(app: &AppHandle) -> Vec<Collider> {
    app.try_state::<Runtime>()
        .and_then(|runtime| runtime.0.lock().ok().map(|registry| registry.colliders()))
        .unwrap_or_default()
}

#[tauri::command]
pub(crate) async fn set_character_collision(
    window: WebviewWindow,
    revision: u64,
    mask: Option<Mask>,
) -> Result<(), String> {
    if !crate::desktop::is_body(window.label()) {
        return Err("캐릭터 본체에서만 충돌 영역을 갱신할 수 있어요.".into());
    }
    let runtime = window.state::<Runtime>();
    let instance = crate::lock(&runtime.0)?.begin_report(window.label());
    // A queued invocation may still carry a destroyed window with a reused label.
    window.inner_position().map_err(|error| error.to_string())?;
    let shape = if let Some(mask) = mask {
        Some(Arc::new(
            tauri::async_runtime::spawn_blocking(move || Shape::from_mask(mask))
                .await
                .map_err(|error| error.to_string())??,
        ))
    } else {
        None
    };
    crate::lock(&runtime.0)?.finish_report(window.label(), instance, revision, shape);
    refresh(window.app_handle(), window.label());
    Ok(())
}

fn build_animation(
    revision: u64,
    masks: Vec<Mask>,
    fallback: Option<Mask>,
) -> Result<AnimationCache, String> {
    if !(1..=64).contains(&masks.len()) {
        return Err("캐릭터 동작의 충돌 프레임은 1~64개여야 해요.".into());
    }
    let frames = masks
        .into_iter()
        .map(|mask| Shape::from_mask(mask).map(Arc::new))
        .collect::<Result<Vec<_>, _>>()?;
    let fallback = fallback.map(Shape::from_mask).transpose()?.map(Arc::new);
    Ok(AnimationCache {
        revision,
        frames,
        fallback,
    })
}

#[tauri::command]
pub(crate) async fn set_character_collision_animation(
    window: WebviewWindow,
    revision: u64,
    masks: Vec<Mask>,
    fallback: Option<Mask>,
) -> Result<(), String> {
    if !crate::desktop::is_body(window.label()) {
        return Err("캐릭터 본체에서만 충돌 영역을 갱신할 수 있어요.".into());
    }
    // Check the invocation's native window before reserving this label's cache revision.
    window.inner_position().map_err(|error| error.to_string())?;
    let runtime = window.state::<Runtime>();
    let Some(token) = crate::lock(&runtime.0)?.begin_animation(window.label(), revision) else {
        return Ok(());
    };
    let cache =
        tauri::async_runtime::spawn_blocking(move || build_animation(revision, masks, fallback))
            .await
            .map_err(|error| error.to_string())??;
    crate::lock(&runtime.0)?.finish_animation(window.label(), token, cache);
    refresh(window.app_handle(), window.label());
    Ok(())
}

#[tauri::command]
pub(crate) fn select_character_collision_frame(
    window: WebviewWindow,
    revision: u64,
    cache_revision: u64,
    frame: Option<usize>,
) -> Result<(), String> {
    if !crate::desktop::is_body(window.label()) {
        return Err("캐릭터 본체에서만 충돌 영역을 갱신할 수 있어요.".into());
    }
    crate::lock(&window.state::<Runtime>().0)?.select_frame(
        window.label(),
        revision,
        cache_revision,
        frame,
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn shape() -> Arc<Shape> {
        Arc::new(
            Shape::from_mask(Mask {
                x: 4.0,
                y: 4.0,
                width: 64.0,
                height: 64.0,
                columns: 1,
                rows: 1,
                bits: vec![1],
            })
            .unwrap(),
        )
    }
    fn pose() -> Option<Pose> {
        projected_pose(-200.0, 300.0, 2.0, true)
    }
    #[test]
    fn hide_blocks_late_reports_and_pose_until_explicit_show() {
        let mut registry = Registry::default();
        registry.visibility("body-a", true);
        registry.report("body-a", 1, Some(shape()));
        let old = registry.entries["body-a"].generation;
        registry.update_pose("body-a", old, pose());
        assert_eq!(registry.colliders().len(), 1);
        registry.visibility("body-a", false);
        registry.report("body-a", 2, Some(shape()));
        registry.update_pose("body-a", old, pose());
        let hidden = registry.entries["body-a"].generation;
        registry.update_pose("body-a", hidden, pose());
        assert!(registry.colliders().is_empty());
        registry.visibility("body-a", true);
        let shown = registry.entries["body-a"].generation;
        registry.update_pose("body-a", shown, pose());
        assert_eq!(registry.colliders().len(), 1);
    }
    #[test]
    fn destroyed_and_recreated_window_rejects_old_pose() {
        let mut registry = Registry::default();
        registry.visibility("body-a", true);
        let old = registry.entries["body-a"].generation;
        registry.entries.remove("body-a");
        registry.update_pose("body-a", old, pose());
        assert!(registry.entries.is_empty());
        registry.visibility("body-a", true);
        registry.report("body-a", 1, Some(shape()));
        registry.update_pose("body-a", old, pose());
        assert!(registry.colliders().is_empty());
    }
    #[test]
    fn stale_mask_cannot_restore_cleared_shape() {
        let mut registry = Registry::default();
        registry.report("body-a", 2, None);
        registry.report("body-a", 1, Some(shape()));
        assert!(registry.entries["body-a"].shape.is_none());
    }
    #[test]
    fn native_coordinates_preserve_negative_origins_and_dpi() {
        assert_eq!(
            projected_pose(-600.0, 400.0, 2.0, true),
            Some(Pose {
                origin: (-300.0, 200.0),
                scale: 1.0
            })
        );
        assert_eq!(
            projected_pose(-600.0, 400.0, 1.5, false),
            Some(Pose {
                origin: (-600.0, 400.0),
                scale: 1.5
            })
        );
        assert!(projected_pose(0.0, 0.0, 0.0, true).is_none());
    }
    #[test]
    fn queued_show_cannot_undo_a_later_hide_or_destroy() {
        let mut registry = Registry::default();
        let token = registry.show_token("body-a");
        registry.visibility("body-a", false);
        assert!(!registry.did_show("body-a", token));
        assert!(registry.entries["body-a"].suppressed);
        let token = registry.show_token("body-a");
        registry.entries.remove("body-a");
        registry.show_token("body-a");
        assert!(!registry.did_show("body-a", token));
    }
    #[test]
    fn later_refresh_wins_over_an_older_native_query() {
        let mut registry = Registry::default();
        registry.visibility("body-a", true);
        let first = registry.begin_refresh("body-a").unwrap();
        let second = registry.begin_refresh("body-a").unwrap();
        registry.update_pose("body-a", second, pose());
        registry.update_pose("body-a", first, None);
        assert_eq!(registry.entries["body-a"].pose, pose());
    }
    #[test]
    fn mask_build_finishing_after_window_replacement_is_discarded() {
        let mut registry = Registry::default();
        let old = registry.begin_report("body-a");
        registry.entries.remove("body-a");
        registry.finish_report("body-a", old, 1, Some(shape()));
        assert!(registry.entries.is_empty());
        registry.show_token("body-a");
        registry.finish_report("body-a", old, 2, Some(shape()));
        assert!(registry.entries["body-a"].shape.is_none());
    }

    fn frame_mask(hole: bool) -> Mask {
        Mask {
            x: 0.0,
            y: 0.0,
            width: 30.0,
            height: 30.0,
            columns: 3,
            rows: 3,
            bits: vec![if hole { 0xef } else { 0xff }, 1],
        }
    }

    fn animation(revision: u64) -> AnimationCache {
        build_animation(
            revision,
            vec![frame_mask(true), frame_mask(false)],
            Some(frame_mask(false)),
        )
        .unwrap()
    }

    fn edge_count(shape: &Shape) -> usize {
        let mut edges = Vec::new();
        shape.append_edges(
            (0.0, 0.0),
            1.0,
            crate::desktop_geometry::Rect {
                x: 0.0,
                y: 0.0,
                width: 30.0,
                height: 30.0,
            },
            &mut edges,
        );
        edges.len()
    }

    #[test]
    fn cached_frames_select_independent_holes_and_static_fallback_without_rebuilding() {
        let mut registry = Registry::default();
        registry.visibility("body-a", true);
        let token = registry.begin_animation("body-a", 1).unwrap();
        let cache = animation(1);
        let ring = cache.frames[0].clone();
        let solid = cache.frames[1].clone();
        let fallback = cache.fallback.clone().unwrap();
        registry.finish_animation("body-a", token, cache);
        registry.select_frame("body-a", 2, 1, Some(0));
        let selected = registry.entries["body-a"].shape.as_ref().unwrap();
        assert!(Arc::ptr_eq(selected, &ring));
        assert_eq!(edge_count(selected), 8);
        registry.select_frame("body-a", 3, 1, Some(1));
        let selected = registry.entries["body-a"].shape.as_ref().unwrap();
        assert!(Arc::ptr_eq(selected, &solid));
        assert_eq!(edge_count(selected), 4);
        registry.select_frame("body-a", 4, 1, None);
        assert!(Arc::ptr_eq(
            registry.entries["body-a"].shape.as_ref().unwrap(),
            &fallback
        ));
    }

    #[test]
    fn clearing_or_replacing_cache_rejects_pending_registration_and_old_frame_selections() {
        let mut registry = Registry::default();
        registry.visibility("body-a", true);
        let old = registry.begin_animation("body-a", 1).unwrap();
        let current = registry.begin_animation("body-a", 2).unwrap();
        registry.finish_animation("body-a", old, animation(1));
        assert!(registry.entries["body-a"].animation.is_none());
        registry.finish_animation("body-a", current, animation(2));
        registry.select_frame("body-a", 3, 2, Some(0));
        let shape = registry.entries["body-a"].shape.clone().unwrap();
        for (revision, cache_revision, frame) in [(2, 2, 1), (4, 1, 1), (4, 2, 64)] {
            registry.select_frame("body-a", revision, cache_revision, Some(frame));
            assert!(Arc::ptr_eq(
                registry.entries["body-a"].shape.as_ref().unwrap(),
                &shape
            ));
        }
        assert!(registry.begin_animation("body-a", 2).is_none());
        let pending = registry.begin_animation("body-a", 5).unwrap();
        registry.report("body-a", 6, None);
        registry.finish_animation("body-a", pending, animation(5));
        registry.select_frame("body-a", 7, 2, Some(0));
        assert!(registry.entries["body-a"].shape.is_none());
        assert!(registry.entries["body-a"].animation.is_none());
    }

    #[test]
    fn hidden_or_recreated_windows_discard_pending_cache_and_frame_updates() {
        let mut registry = Registry::default();
        registry.visibility("body-a", true);
        let hidden = registry.begin_animation("body-a", 1).unwrap();
        registry.visibility("body-a", false);
        registry.visibility("body-a", true);
        registry.finish_animation("body-a", hidden, animation(1));
        assert!(registry.entries["body-a"].animation.is_none());
        let destroyed = registry.begin_animation("body-a", 2).unwrap();
        registry.entries.remove("body-a");
        registry.visibility("body-a", true);
        registry.finish_animation("body-a", destroyed, animation(2));
        assert!(registry.entries["body-a"].animation.is_none());
        let current = registry.begin_animation("body-a", 3).unwrap();
        registry.finish_animation("body-a", current, animation(3));
        registry.visibility("body-a", false);
        registry.select_frame("body-a", 4, 3, Some(0));
        registry.visibility("body-a", true);
        registry.select_frame("body-a", 5, 3, Some(0));
        assert!(registry.entries["body-a"].shape.is_none());
    }

    #[test]
    fn animation_cache_enforces_frame_count_and_each_frames_mask_bounds() {
        assert!(build_animation(1, vec![], None).is_err());
        assert!(build_animation(1, (0..65).map(|_| frame_mask(false)).collect(), None).is_err());
        let mut oversized = frame_mask(false);
        oversized.width = 521.0;
        assert!(build_animation(1, vec![frame_mask(false), oversized], None).is_err());
        assert!(build_animation(1, (0..64).map(|_| frame_mask(false)).collect(), None).is_ok());
    }

    #[test]
    fn static_decode_started_before_hide_cannot_restore_shape_after_show() {
        let mut registry = Registry::default();
        registry.visibility("body-a", true);
        let token = registry.begin_report("body-a");
        registry.visibility("body-a", false);
        registry.visibility("body-a", true);
        registry.finish_report("body-a", token, 1, Some(shape()));
        assert!(registry.entries["body-a"].shape.is_none());
    }

    #[test]
    fn normal_snapshot_reshow_keeps_pending_animation_registration_valid() {
        let mut registry = Registry::default();
        let pending = registry.begin_animation("body-a", 1).unwrap();
        registry.visibility("body-a", true);
        registry.visibility("body-a", true);
        registry.finish_animation("body-a", pending, animation(1));
        registry.select_frame("body-a", 2, 1, Some(0));
        assert_eq!(
            edge_count(registry.entries["body-a"].shape.as_ref().unwrap()),
            8
        );
    }
}
