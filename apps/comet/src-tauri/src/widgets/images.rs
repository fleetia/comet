use crate::{
    app::{lock, AppState},
    widgets::{
        commands::{cancel_widget_scene, change, publish_widgets},
        desktop::{self, Point, Rect},
        image_media, storage, WidgetInstance, WidgetSnapshot,
    },
};
use serde_json::{json, Value};
use std::{
    collections::BTreeSet,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

type Result<T> = std::result::Result<T, String>;
fn err(error: impl std::fmt::Display) -> String {
    error.to_string()
}
fn label(id: &str, image_id: &str) -> String {
    format!("widget-{id}-image-{image_id}")
}
fn active(instance: &WidgetInstance) -> Result<()> {
    if instance.kind != "image" {
        return Err("이미지 위젯을 찾지 못했어요.".into());
    }
    Ok(())
}
fn images(instance: &mut WidgetInstance) -> Result<&mut Vec<Value>> {
    instance.data["images"]
        .as_array_mut()
        .ok_or_else(|| "이미지 목록을 읽을 수 없어요.".into())
}
fn image_mut<'a>(instance: &'a mut WidgetInstance, image_id: &str) -> Result<&'a mut Value> {
    images(instance)?
        .iter_mut()
        .find(|image| image["id"] == image_id)
        .ok_or_else(|| "이미지를 찾지 못했어요.".into())
}
fn mutate(
    state: &AppState,
    id: &str,
    bump: bool,
    update: impl FnOnce(&mut WidgetInstance) -> Result<()>,
) -> Result<WidgetSnapshot> {
    change(state, |db| {
        let tx = db.unchecked_transaction().map_err(err)?;
        let mut instance = storage::get(&tx, id)?;
        if instance.kind != "image" {
            return Err("이미지 위젯을 찾지 못했어요.".into());
        }
        update(&mut instance)?;
        if bump {
            instance.revision += 1;
        }
        storage::put(&tx, &instance)?;
        tx.commit().map_err(err)?;
        storage::snapshot(db)
    })
}
fn size(image: &Value) -> (f64, f64) {
    (
        image["width"].as_f64().unwrap_or(320.0).max(48.0),
        image["height"].as_f64().unwrap_or(320.0).max(48.0),
    )
}
fn position(image: &Value) -> Option<Point> {
    Some(Point {
        x: image["x"].as_f64()?,
        y: image["y"].as_f64()?,
    })
}

fn reconcile(app: &tauri::AppHandle) -> Result<()> {
    let state = app.state::<Arc<AppState>>();
    let instances = {
        let _action = lock(&state.action)?;
        if crate::unavailable(&state) {
            return Ok(());
        }
        storage::instances(&*lock(&state.db)?)?
    };
    let mut desired = BTreeSet::new();
    let mut occupied: Vec<Rect> = instances
        .iter()
        .filter(|item| item.kind == "image")
        .flat_map(|item| item.data["images"].as_array().into_iter().flatten())
        .filter(|image| image["isOpen"] == true)
        .filter_map(|image| position(image).map(|point| Rect::at(&point, size(image))))
        .collect();
    for instance in instances
        .iter()
        .filter(|item| item.kind == "image")
    {
        let Some(items) = instance.data["images"].as_array() else {
            continue;
        };
        for image in items.iter().filter(|item| item["isOpen"] == true) {
            let Some(image_id) = image["id"].as_str() else {
                continue;
            };
            if uuid::Uuid::parse_str(image_id).is_err() {
                continue;
            }
            let window_label = label(&instance.id, image_id);
            desired.insert(window_label.clone());
            let (width, height) = size(image);
            if app.get_webview_window(&window_label).is_some() {
                continue;
            }
            let area = desktop::primary_area(app)?;
            let point = match position(image) {
                Some(point) => {
                    desktop::clamp_point(&point, (width, height), &desktop::work_areas(app)?)
                }
                None => desktop::auto_place(area, (width, height), &occupied),
            };
            if position(image).is_none() {
                occupied.push(Rect::at(&point, (width, height)));
            }
            let window = tauri::WebviewWindowBuilder::new(
                app,
                &window_label,
                tauri::WebviewUrl::App(
                    format!(
                        "index.html?view=image&id={}&imageId={image_id}",
                        instance.id
                    )
                    .into(),
                ),
            )
            .title("comet · 이미지")
            .inner_size(width, height)
            .position(point.x, point.y)
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
            .map_err(err)?;
            let valid = {
                let _action = lock(&state.action)?;
                let db = lock(&state.db)?;
                storage::get(&db, &instance.id).ok().is_some_and(|current| {
                    current.kind == "image"
                        && current.data["images"].as_array().is_some_and(|items| {
                            items
                                .iter()
                                .any(|item| item["id"] == image_id && item["isOpen"] == true)
                        })
                })
            };
            if !valid {
                let _ = window.destroy();
                continue;
            }
            let app_handle = app.clone();
            let id = instance.id.clone();
            let image_id = image_id.to_string();
            let moved_image_id = image_id.clone();
            let moved = Arc::new(AtomicU64::new(0));
            let event_window = window.clone();
            window.on_window_event(move |event| match event {
                tauri::WindowEvent::Moved(_) => {
                    let generation = moved.fetch_add(1, Ordering::SeqCst) + 1;
                    let moved = moved.clone();
                    let app = app_handle.clone();
                    let window = event_window.clone();
                    let id = id.clone();
                    let image_id = moved_image_id.clone();
                    tauri::async_runtime::spawn(async move {
                        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                        if moved.load(Ordering::SeqCst) != generation {
                            return;
                        }
                        let Ok(scale) = window.scale_factor() else {
                            return;
                        };
                        let Ok(position) = window.outer_position() else {
                            return;
                        };
                        let point = position.to_logical::<f64>(scale);
                        let state = app.state::<Arc<AppState>>();
                        let _ = move_image(&app, &state, &id, &image_id, point.x, point.y);
                    });
                }
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let app = app_handle.clone();
                    let id = id.clone();
                    let image_id = moved_image_id.clone();
                    tauri::async_runtime::spawn(async move {
                        let state = app.state::<Arc<AppState>>();
                        let _ = set_open(&app, &state, &id, &image_id, false).await;
                    });
                }
                _ => {}
            });
            {
                let _action = lock(&state.action)?;
                let db = lock(&state.db)?;
                let current = storage::get(&db, &instance.id)?;
                if current.kind != "image"
                    || !current.data["images"].as_array().is_some_and(|items| {
                        items
                            .iter()
                            .any(|item| item["id"] == image_id && item["isOpen"] == true)
                    })
                {
                    let _ = window.destroy();
                    continue;
                }
                window.show().map_err(err)?;
            }
            let _ = mutate(&state, &instance.id, false, |current| {
                let item = image_mut(current, &image_id)?;
                if item["isOpen"] != true {
                    return Ok(());
                }
                item["x"] = json!(point.x);
                item["y"] = json!(point.y);
                Ok(())
            });
        }
    }
    for (window_label, window) in app.webview_windows() {
        if window_label.starts_with("widget-")
            && window_label.contains("-image-")
            && !desired.contains(&window_label)
        {
            window.destroy().map_err(err)?;
        }
    }
    Ok(())
}
async fn sync(app: &tauri::AppHandle) -> Result<()> {
    let (send, receive) = tokio::sync::oneshot::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let _ = send.send(reconcile(&handle));
    })
    .map_err(err)?;
    receive.await.map_err(err)?
}
pub(crate) fn schedule_sync(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = sync(&app).await {
            crate::report_error!("image_window_refresh", "이미지 창 갱신 실패: {error}");
        }
    });
}

pub(crate) async fn add(
    app: &tauri::AppHandle,
    state: &Arc<AppState>,
    id: Option<String>,
) -> Result<WidgetSnapshot> {
    add_expected(app, state, id, None, None).await
}
pub(crate) async fn add_current(
    app: &tauri::AppHandle,
    state: &Arc<AppState>,
    id: String,
    revision: i64,
) -> Result<WidgetSnapshot> {
    add_expected(app, state, Some(id), None, Some(revision)).await
}
pub(crate) async fn add_for_launcher(
    app: &tauri::AppHandle,
    state: &Arc<AppState>,
    expected: Option<i64>,
) -> Result<WidgetSnapshot> {
    add_expected(app, state, None, Some(expected), None).await
}
async fn add_expected(
    app: &tauri::AppHandle,
    state: &Arc<AppState>,
    id: Option<String>,
    expected_uninstalled: Option<Option<i64>>,
    expected_installed: Option<i64>,
) -> Result<WidgetSnapshot> {
    let (id, expected) = change(state, |db| {
        let instance = match &id {
            Some(id) => storage::get(db, id)?,
            None => storage::instances(db)?
                .into_iter()
                .find(|instance| instance.kind == "image")
                .ok_or("이미지 위젯을 찾지 못했어요.")?,
        };
        active(&instance)?;
        Ok((instance.id, instance.revision))
    })?;
    if expected_uninstalled.is_some_and(|revision| revision != Some(expected))
        || expected_installed.is_some_and(|revision| revision != expected)
    {
        return Err("위젯이 변경됐어요. 다시 시도해 주세요.".into());
    }
    let (send, receive) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("이미지 선택")
        .add_filter(
            "이미지와 동영상",
            &["svg", "png", "gif", "webp", "jpg", "jpeg", "mp4"],
        )
        .pick_file(move |path| {
            let _ = send.send(path);
        });
    let Some(path) = receive.await.map_err(err)? else {
        return storage::snapshot(&*lock(&state.db)?);
    };
    let path = path.into_path().map_err(err)?;
    let media = tauri::async_runtime::spawn_blocking(move || image_media::read(&path))
        .await
        .map_err(err)??;
    let image_id = uuid::Uuid::new_v4().to_string();
    let snapshot = change(state, |db| {
        let tx = db.unchecked_transaction().map_err(err)?;
        let mut instance = storage::get(&tx, &id)?;
        active(&instance)?;
        if instance.revision != expected {
            return Err("위젯이 변경됐어요. 다시 시도해 주세요.".into());
        }
        let items = images(&mut instance)?;
        if items.len() >= 20 {
            return Err("이미지는 20장까지 띄울 수 있어요.".into());
        }
        let scale = 320.0 / media.width.max(media.height) as f64;
        items.push(json!({"id":image_id,"addedAt":chrono::Utc::now().timestamp_millis(),"mime":media.mime,"naturalWidth":media.width,"naturalHeight":media.height,"x":null,"y":null,"width":(media.width as f64 * scale).max(48.0),"height":(media.height as f64 * scale).max(48.0),"isOpen":true}));
        instance.revision += 1;
        storage::put(&tx, &instance)?;
        media.store(&tx, &format!("image:{image_id}"))?;
        tx.commit().map_err(err)?;
        storage::snapshot(db)
    })?;
    cancel_widget_scene(app, state)?;
    publish_widgets(app, state);
    sync(app).await?;
    Ok(snapshot)
}
#[tauri::command]
pub(crate) async fn add_widget_image(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: Option<String>,
) -> Result<WidgetSnapshot> {
    add(&app, &state, id).await
}

async fn set_open(
    app: &tauri::AppHandle,
    state: &Arc<AppState>,
    id: &str,
    image_id: &str,
    open: bool,
) -> Result<WidgetSnapshot> {
    let snapshot = mutate(state, id, true, |instance| {
        if open {
            active(instance)?;
        }
        image_mut(instance, image_id)?["isOpen"] = json!(open);
        Ok(())
    })?;
    cancel_widget_scene(app, state)?;
    publish_widgets(app, state);
    sync(app).await?;
    Ok(snapshot)
}
#[tauri::command]
pub(crate) async fn open_widget_image(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
    image_id: String,
) -> Result<WidgetSnapshot> {
    set_open(&app, &state, &id, &image_id, true).await
}
#[tauri::command]
pub(crate) async fn close_widget_image(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
    image_id: String,
) -> Result<WidgetSnapshot> {
    set_open(&app, &state, &id, &image_id, false).await
}
#[tauri::command]
pub(crate) async fn close_all_widget_images(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
) -> Result<WidgetSnapshot> {
    let snapshot = mutate(&state, &id, true, |instance| {
        for item in images(instance)? {
            item["isOpen"] = json!(false);
        }
        Ok(())
    })?;
    cancel_widget_scene(&app, &state)?;
    publish_widgets(&app, &state);
    sync(&app).await?;
    Ok(snapshot)
}
#[tauri::command]
pub(crate) async fn remove_widget_image(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
    image_id: String,
) -> Result<WidgetSnapshot> {
    let snapshot = change(&state, |db| {
        let tx = db.unchecked_transaction().map_err(err)?;
        let mut instance = storage::get(&tx, &id)?;
        if instance.kind != "image" {
            return Err("이미지 위젯을 찾지 못했어요.".into());
        }
        let items = images(&mut instance)?;
        let index = items
            .iter()
            .position(|item| item["id"] == image_id)
            .ok_or("이미지를 찾지 못했어요.")?;
        items.remove(index);
        instance.revision += 1;
        storage::put(&tx, &instance)?;
        super::backgrounds::remove(&tx, &format!("image:{image_id}"))?;
        tx.commit().map_err(err)?;
        storage::snapshot(db)
    })?;
    cancel_widget_scene(&app, &state)?;
    publish_widgets(&app, &state);
    sync(&app).await?;
    Ok(snapshot)
}
fn move_image(
    app: &tauri::AppHandle,
    state: &Arc<AppState>,
    id: &str,
    image_id: &str,
    x: f64,
    y: f64,
) -> Result<WidgetSnapshot> {
    if !x.is_finite() || !y.is_finite() || x.abs() > 32768.0 || y.abs() > 32768.0 {
        return Err("위치가 올바르지 않아요.".into());
    }
    let areas = desktop::work_areas(app)?;
    let mut target = None;
    let snapshot = mutate(state, id, false, |instance| {
        active(instance)?;
        let item = image_mut(instance, image_id)?;
        if item["isOpen"] != true {
            return Err("닫힌 이미지예요.".into());
        }
        let p = desktop::clamp_point(
            &Point {
                x: (x / 8.0).round() * 8.0,
                y: (y / 8.0).round() * 8.0,
            },
            size(item),
            &areas,
        );
        item["x"] = json!(p.x);
        item["y"] = json!(p.y);
        target = Some(p);
        Ok(())
    })?;
    if let (Some(window), Some(point)) = (app.get_webview_window(&label(id, image_id)), target) {
        if (point.x - x).abs() >= 1.0 || (point.y - y).abs() >= 1.0 {
            window
                .set_position(tauri::LogicalPosition::new(point.x, point.y))
                .map_err(err)?;
        }
    }
    Ok(snapshot)
}
#[tauri::command]
pub(crate) fn move_widget_image(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
    image_id: String,
    x: f64,
    y: f64,
) -> Result<WidgetSnapshot> {
    move_image(&app, &state, &id, &image_id, x, y)
}
#[tauri::command]
pub(crate) fn resize_widget_image(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
    image_id: String,
    width: f64,
    height: f64,
    restore: Option<bool>,
) -> Result<WidgetSnapshot> {
    if !width.is_finite() || !height.is_finite() || width <= 0.0 || height <= 0.0 {
        return Err("크기가 올바르지 않아요.".into());
    }
    let window = app
        .get_webview_window(&label(&id, &image_id))
        .ok_or("이미지 창을 찾지 못했어요.")?;
    let area = desktop::window_area(&app, &window)?;
    let scale = (area.width / width).min(area.height / height).min(1.0);
    let snap_scale = if restore.unwrap_or(false) {
        1.0
    } else {
        let longest = width.max(height) * scale;
        ((longest / 8.0).round() * 8.0).max(48.0) / longest
    };
    let scale = (scale * snap_scale)
        .min(area.width / width)
        .min(area.height / height);
    let width = (width * scale).max(48.0).min(area.width.max(48.0));
    let height = (height * scale).max(48.0).min(area.height.max(48.0));
    let snapshot = mutate(&state, &id, false, |instance| {
        active(instance)?;
        let item = image_mut(instance, &image_id)?;
        if item["isOpen"] != true {
            return Err("닫힌 이미지예요.".into());
        }
        item["width"] = json!(width);
        item["height"] = json!(height);
        Ok(())
    })?;
    window
        .set_size(tauri::LogicalSize::new(width, height))
        .map_err(err)?;
    publish_widgets(&app, &state);
    Ok(snapshot)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reaction_setting_does_not_remove_or_block_existing_images() {
        let state = crate::app::tests::state();
        let id = {
            let db = lock(&state.db).unwrap();
            let mut instance = storage::instances(&db).unwrap().into_iter()
                .find(|instance| instance.kind == "image").unwrap();
            instance.data["images"] = json!([{ "id": "image-one", "isOpen": true }]);
            storage::put(&db, &instance).unwrap();
            super::super::backgrounds::put_media(&db, "image:image-one", "image/png", b"original").unwrap();
            storage::set_reaction(&db, &instance.id, false).unwrap();
            instance.id
        };
        mutate(&state, &id, true, |instance| {
            active(instance)?;
            image_mut(instance, "image-one")?["isOpen"] = json!(false);
            Ok(())
        }).unwrap();
        let db = lock(&state.db).unwrap();
        let instance = storage::get(&db, &id).unwrap();
        assert_eq!(instance.data["images"][0]["isOpen"], false);
        assert_eq!(super::super::backgrounds::get(&db, "image:image-one").unwrap().unwrap().data.as_slice(), b"original");
        assert!(!storage::reaction_enabled(&db, &id).unwrap());
    }
}
