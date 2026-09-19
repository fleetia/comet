use crate::{app::AppState, store, types::Snapshot};
use tauri::{AppHandle, Manager, Monitor, PhysicalPosition, PhysicalSize, WebviewWindow};

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

fn balloon_rect(body: Rect, area: Rect, scale: f64, height: f64) -> Rect {
    let width = (320.0 * scale).min(area.width);
    let height = (height.clamp(110.0, 520.0) * scale).min(area.height);
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

pub(crate) fn create_boxes(app: &AppHandle, state: &AppState) -> Result<(), String> {
    for (index, id) in ["a", "b"].iter().enumerate() {
        let window = tauri::WebviewWindowBuilder::new(
            app,
            *id,
            tauri::WebviewUrl::App(format!("index.html?persona={id}").into()),
        )
        .title(format!("comet · {}", id.to_uppercase()))
        .inner_size(112.0, 88.0)
        .min_inner_size(112.0, 88.0)
        .resizable(false)
        .decorations(false)
        .maximizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?;
        let monitors = window.available_monitors().map_err(|e| e.to_string())?;
        let saved = store::window_position(&*crate::app::lock(&state.db)?, id)?;
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
            let width = 112.0 * scale;
            let height = 88.0 * scale;
            let (x, y) = if saved_monitor.is_some() {
                let saved = saved.as_ref().ok_or("창 위치를 읽지 못했습니다.")?;
                clamp_position(saved.x, saved.y, width, height, area)
            } else {
                clamp_position(
                    area.x + area.width - width - (24.0 + 180.0 * (1 - index) as f64) * scale,
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
        window.show().map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn owner(snapshot: &Snapshot) -> Option<&str> {
    if snapshot.runtime.hidden {
        return None;
    }
    snapshot
        .panel
        .as_ref()
        .map(|panel| panel.persona.as_str())
        .or_else(|| snapshot.story.as_ref().map(|story| story.persona.as_str()))
        .or_else(|| {
            snapshot
                .playback
                .as_ref()
                .map(|playback| playback.persona.as_str())
        })
        .or_else(|| {
            if ["loading", "generating", "error"].contains(&snapshot.runtime.phase.as_str()) {
                snapshot.runtime.persona.as_deref()
            } else {
                None
            }
        })
        .filter(|persona| ["a", "b"].contains(persona))
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
    persona: &str,
    height: f64,
) -> Result<(), String> {
    let body = app
        .get_webview_window(persona)
        .ok_or("캐릭터 창이 없습니다.")?;
    let monitor = body
        .current_monitor()
        .map_err(|e| e.to_string())?
        .or(body.primary_monitor().map_err(|e| e.to_string())?)
        .ok_or("화면 영역을 확인할 수 없습니다.")?;
    let position = body.outer_position().map_err(|e| e.to_string())?;
    let size = body.outer_size().map_err(|e| e.to_string())?;
    let rect = balloon_rect(
        Rect {
            x: position.x as f64,
            y: position.y as f64,
            width: size.width as f64,
            height: size.height as f64,
        },
        work_area(&monitor),
        monitor.scale_factor(),
        height,
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

pub(crate) fn sync_balloon(app: &AppHandle, snapshot: &Snapshot) {
    let Some(persona) = owner(snapshot) else {
        if let Some(window) = app.get_webview_window("balloon") {
            let _ = window.hide();
        }
        return;
    };
    let Ok(window) = get_balloon(app) else {
        return;
    };
    let height = window
        .inner_size()
        .ok()
        .zip(window.scale_factor().ok())
        .map(|(size, scale)| size.height as f64 / scale)
        .unwrap_or(180.0);
    if position_balloon(app, &window, persona, height).is_ok() {
        let _ = window.show();
    }
}

pub(crate) fn resize_balloon(
    app: &AppHandle,
    snapshot: &Snapshot,
    height: f64,
) -> Result<(), String> {
    if !height.is_finite() {
        return Err("말풍선 높이가 올바르지 않습니다.".into());
    }
    let Some(persona) = owner(snapshot) else {
        return Ok(());
    };
    if let Some(window) = app.get_webview_window("balloon") {
        position_balloon(app, &window, persona, height)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pending_story_owns_native_balloon_and_interruption_removes_it() {
        let state = crate::app::tests::state();
        let request = crate::story::prepare(&crate::app::lock(&state.db).unwrap(), "a", 0, 0)
            .unwrap()
            .unwrap();
        *crate::app::lock(&state.story).unwrap() = Some(request);
        crate::app::lock(&state.runtime).unwrap().phase = "story".into();
        assert!(crate::app::lock(&state.playback).unwrap().is_none());
        assert_eq!(owner(&crate::app::snapshot(&state).unwrap()), Some("a"));
        crate::app::lock(&state.runtime).unwrap().hidden = true;
        assert_eq!(owner(&crate::app::snapshot(&state).unwrap()), None);
        crate::app::lock(&state.runtime).unwrap().hidden = false;
        crate::app::interrupt(&state, false).unwrap();
        assert_eq!(owner(&crate::app::snapshot(&state).unwrap()), None);
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
                let bubble = balloon_rect(body, area, scale, 180.0);
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
            900.0,
        );
        assert_eq!(bubble.height, 400.0);
        assert_eq!((bubble.x, bubble.y), (-500.0, 20.0));
        assert_eq!(
            clamp_position(-40.0, 410.0, 112.0, 88.0, area),
            (-112.0, 332.0)
        );
    }
}
