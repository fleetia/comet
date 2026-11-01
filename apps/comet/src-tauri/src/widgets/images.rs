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
    collections::{BTreeMap, BTreeSet},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex, OnceLock, Weak,
    },
};
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

type Result<T> = std::result::Result<T, String>;
#[derive(PartialEq, Eq)]
enum AddState {
    Pending,
    Cancelled,
    Saved,
}

struct ImageDrag {
    moved: AtomicU64,
    dragging: AtomicBool,
    pending: AtomicBool,
    epoch: AtomicU64,
}

static IMAGE_DRAGS: OnceLock<Mutex<BTreeMap<String, Weak<ImageDrag>>>> = OnceLock::new();

fn stop_image_drag(label: &str) -> Option<u64> {
    let drags = IMAGE_DRAGS.get()?;
    let Ok(drags) = drags.lock() else {
        return None;
    };
    if let Some(drag) = drags.get(label).and_then(Weak::upgrade) {
        drag.dragging.store(false, Ordering::SeqCst);
        let was_dragging = drag.pending.swap(false, Ordering::SeqCst);
        drag.moved.fetch_add(1, Ordering::SeqCst);
        return was_dragging.then(|| drag.epoch.load(Ordering::SeqCst));
    }
    None
}

impl AddState {
    fn cancel(&mut self) -> bool {
        if *self != Self::Pending {
            return false;
        }
        *self = Self::Cancelled;
        true
    }
}
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
fn can_add(db: &rusqlite::Connection, instance: &WidgetInstance) -> Result<()> {
    active(instance)?;
    let enabled: bool = db
        .query_row(
            "SELECT installed AND enabled FROM widget_instances WHERE id=?1",
            [&instance.id],
            |row| row.get(0),
        )
        .map_err(err)?;
    if !enabled {
        return Err("이미지 위젯을 사용할 수 없어요.".into());
    }
    if instance.data["images"]
        .as_array()
        .is_some_and(|items| items.len() >= 20)
    {
        return Err(
            "이미지는 20장까지 저장할 수 있어요. 닫아 둔 이미지를 다시 열어 지워 주세요.".into(),
        );
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

fn requested_image(target: Option<(&str, &str)>, id: &str, image_id: &str) -> bool {
    target.is_none_or(|target| target == (id, image_id))
}

fn reconcile(app: &tauri::AppHandle, target: Option<(&str, &str)>) -> Result<()> {
    let state = app.state::<Arc<AppState>>();
    let instances = {
        let _action = lock(&state.action)?;
        if crate::unavailable(&state) {
            return Ok(());
        }
        storage::instances(&*lock(&state.db)?)?
    };
    let mut desired = BTreeSet::new();
    let mut occupied: Vec<Rect> = desktop::visible_widget_areas(app, "");
    for instance in instances.iter().filter(|item| item.kind == "image") {
        let Some(items) = instance.data["images"].as_array() else {
            continue;
        };
        for image in items.iter().filter(|item| item["isOpen"] == true) {
            let Some(image_id) = image["id"].as_str() else {
                continue;
            };
            if !requested_image(target, &instance.id, image_id) {
                continue;
            }
            if uuid::Uuid::parse_str(image_id).is_err() {
                continue;
            }
            let window_label = label(&instance.id, image_id);
            desired.insert(window_label.clone());
            let (width, height) = size(image);
            if app.get_webview_window(&window_label).is_some() {
                continue;
            }
            let area = desktop::preferred_area(app, None)?;
            let point = match position(image) {
                Some(point) => {
                    desktop::restore_point(&point, (width, height), &desktop::work_areas(app)?)
                }
                None => desktop::auto_place(area, (width, height), &occupied),
            };
            occupied.push(Rect::at(&point, (width, height)));
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
            .accept_first_mouse(true)
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
            let drag = Arc::new(ImageDrag {
                moved: AtomicU64::new(0),
                dragging: AtomicBool::new(false),
                pending: AtomicBool::new(false),
                epoch: AtomicU64::new(desktop::drag_epoch(app)),
            });
            if let Ok(mut drags) = IMAGE_DRAGS
                .get_or_init(|| Mutex::new(BTreeMap::new()))
                .lock()
            {
                drags.retain(|_, value| value.strong_count() > 0);
                drags.insert(window_label.clone(), Arc::downgrade(&drag));
            }
            let event_window = window.clone();
            window.on_window_event(move |event| match event {
                tauri::WindowEvent::Moved(_) => {
                    let epoch = desktop::drag_epoch(&app_handle);
                    if drag.epoch.load(Ordering::SeqCst) != epoch {
                        drag.dragging.store(false, Ordering::SeqCst);
                        drag.pending.store(false, Ordering::SeqCst);
                    }
                    let active = drag.dragging.load(Ordering::SeqCst);
                    let marked = !active && desktop::take_drag(&app_handle, event_window.label());
                    if !desktop::accepts_drag_move(active, marked) {
                        return;
                    }
                    drag.epoch.store(epoch, Ordering::SeqCst);
                    drag.dragging.store(true, Ordering::SeqCst);
                    drag.pending.store(true, Ordering::SeqCst);
                    let generation = drag.moved.fetch_add(1, Ordering::SeqCst) + 1;
                    let drag = drag.clone();
                    let app = app_handle.clone();
                    let window = event_window.clone();
                    let id = id.clone();
                    let image_id = moved_image_id.clone();
                    tauri::async_runtime::spawn(async move {
                        let started = std::time::Instant::now();
                        loop {
                            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                            if drag.moved.load(Ordering::SeqCst) != generation {
                                return;
                            }
                            if desktop::drag_epoch(&app) != epoch
                                || !desktop::screen_unchanged(&app)
                            {
                                drag.dragging.store(false, Ordering::SeqCst);
                                drag.pending.store(false, Ordering::SeqCst);
                                return;
                            }
                            if !desktop::wait_for_drag_release(
                                desktop::drag_button_pressed(),
                                started.elapsed(),
                            ) {
                                break;
                            }
                        }
                        drag.dragging.store(false, Ordering::SeqCst);
                        let Ok(scale) = window.scale_factor() else {
                            return;
                        };
                        let Ok(position) = window.outer_position() else {
                            return;
                        };
                        let point = position.to_logical::<f64>(scale);
                        if desktop::drag_epoch(&app) != epoch || !desktop::screen_unchanged(&app) {
                            return;
                        }
                        let state = app.state::<Arc<AppState>>();
                        let _ = move_image(
                            &app,
                            &state,
                            &id,
                            &image_id,
                            point.x,
                            point.y,
                            Some((&drag, generation)),
                        );
                        if drag.moved.load(Ordering::SeqCst) == generation {
                            drag.pending.store(false, Ordering::SeqCst);
                        }
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
                crate::desktop::show_passive(app, &window)?;
            }
            if position(image).is_none() {
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
    }
    for (window_label, window) in app.webview_windows() {
        if window_label.starts_with("widget-")
            && window_label.contains("-image-")
            && target.is_none()
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
        let _ = send.send(reconcile(&handle, None));
    })
    .map_err(err)?;
    receive.await.map_err(err)?
}
async fn sync_image(app: &tauri::AppHandle, id: &str, image_id: &str) -> Result<()> {
    let (send, receive) = tokio::sync::oneshot::channel();
    let handle = app.clone();
    let id = id.to_string();
    let image_id = image_id.to_string();
    app.run_on_main_thread(move || {
        let _ = send.send(reconcile(&handle, Some((&id, &image_id))));
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

pub(crate) fn reposition_on_screen_change(app: &tauri::AppHandle) {
    let state = app.state::<Arc<AppState>>();
    let instances = (|| -> Result<_> {
        let _action = lock(&state.action)?;
        storage::instances(&*lock(&state.db)?)
    })();
    let (Ok(instances), Ok(areas)) = (instances, desktop::work_areas(app)) else {
        return;
    };
    let epoch = desktop::drag_epoch(app);
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if desktop::drag_epoch(&handle) != epoch {
            return;
        }
        for instance in instances.iter().filter(|item| item.kind == "image") {
            for image in instance.data["images"].as_array().into_iter().flatten() {
                let (Some(image_id), Some(point)) = (image["id"].as_str(), position(image)) else {
                    continue;
                };
                if image["isOpen"] != true {
                    continue;
                }
                if let Some(window) = handle.get_webview_window(&label(&instance.id, image_id)) {
                    let point = desktop::restore_point(&point, size(image), &areas);
                    let _ = window.set_position(tauri::LogicalPosition::new(point.x, point.y));
                }
            }
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

fn save_image(
    state: &AppState,
    id: &str,
    image_id: &str,
    media: &image_media::Media,
    status: &Mutex<AddState>,
) -> Result<bool> {
    change(state, |db| {
        if *status.lock().map_err(err)? == AddState::Cancelled {
            return Ok(false);
        }
        let tx = db.unchecked_transaction().map_err(err)?;
        let mut instance = storage::get(&tx, id)?;
        can_add(&tx, &instance)?;
        let items = images(&mut instance)?;
        let scale = 320.0 / media.width.max(media.height) as f64;
        items.push(json!({"id":image_id,"addedAt":chrono::Utc::now().timestamp_millis(),"mime":media.mime,"naturalWidth":media.width,"naturalHeight":media.height,"x":null,"y":null,"width":(media.width as f64 * scale).max(48.0),"height":(media.height as f64 * scale).max(48.0),"isOpen":true}));
        instance.revision += 1;
        storage::put(&tx, &instance)?;
        media.store(&tx, &format!("image:{image_id}"))?;
        let mut status = status.lock().map_err(err)?;
        if *status == AddState::Cancelled {
            return Ok(false);
        }
        tx.commit().map_err(err)?;
        *status = AddState::Saved;
        Ok(true)
    })
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
    let progress = tauri::WebviewWindowBuilder::new(
        app,
        format!("widget-imageprogress-{}", uuid::Uuid::new_v4()),
        tauri::WebviewUrl::App("index.html?view=image-processing".into()),
    )
    .title("이미지 준비")
    .inner_size(320.0, 150.0)
    .resizable(false)
    .visible(false)
    .build()
    .map_err(err)?;
    let status = Arc::new(Mutex::new(AddState::Pending));
    let status_on_close = status.clone();
    let (cancel_send, cancel_receive) = tokio::sync::oneshot::channel();
    let cancel_send = Mutex::new(Some(cancel_send));
    progress.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            match status_on_close.try_lock() {
                Ok(mut status) => {
                    if status.cancel() {
                        if let Ok(mut send) = cancel_send.lock() {
                            if let Some(send) = send.take() {
                                let _ = send.send(());
                            }
                        }
                    }
                }
                Err(std::sync::TryLockError::WouldBlock) => api.prevent_close(),
                Err(std::sync::TryLockError::Poisoned(_)) => {}
            }
        }
    });
    if let Err(error) = progress.show() {
        let _ = progress.destroy();
        return Err(err(error));
    }
    let worker = tauri::async_runtime::spawn_blocking(move || image_media::read(&path));
    let media = tokio::select! {
        result = worker => match result {
            Ok(Ok(media)) => media,
            Ok(Err(error)) => { let _ = progress.destroy(); return Err(error); }
            Err(error) => { let _ = progress.destroy(); return Err(err(error)); }
        },
        _ = cancel_receive => return storage::snapshot(&*lock(&state.db)?),
    };
    let image_id = uuid::Uuid::new_v4().to_string();
    let saved = save_image(state, &id, &image_id, &media, &status);
    let _ = progress.destroy();
    let saved = match saved {
        Ok(saved) => saved,
        Err(error) => {
            if *status.lock().map_err(err)? != AddState::Saved {
                return Err(error);
            }
            crate::report_error!("image_add_followup", "이미지 저장 후 갱신 실패: {error}");
            true
        }
    };
    if !saved {
        return storage::snapshot(&*lock(&state.db)?);
    }
    if let Err(error) = cancel_widget_scene(app, state) {
        crate::report_error!(
            "image_scene_cancel",
            "이미지 추가 후 장면 중단 실패: {error}"
        );
    }
    publish_widgets(app, state);
    while let Err(error) = sync_image(app, &id, &image_id).await {
        if let Some(window) = app.get_webview_window(&label(&id, &image_id)) {
            if window.is_visible().unwrap_or(false) {
                break;
            }
            let _ = window.destroy();
        }
        let (send, receive) = tokio::sync::oneshot::channel();
        app.dialog()
            .message(format!(
                "이미지는 저장했지만 창을 열지 못했어요. 다시 열까요?\n{error}"
            ))
            .title("이미지 창 열기")
            .buttons(MessageDialogButtons::OkCancelCustom(
                "다시 열기".into(),
                "나중에 열기".into(),
            ))
            .show(move |retry| {
                let _ = send.send(retry);
            });
        if !receive.await.unwrap_or(false) {
            if app.get_webview_window(&label(&id, &image_id)).is_none() {
                mutate(state, &id, false, |instance| {
                    image_mut(instance, &image_id)?["isOpen"] = json!(false);
                    Ok(())
                })?;
                publish_widgets(app, state);
            }
            break;
        }
    }
    storage::snapshot(&*lock(&state.db)?)
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
    drag: Option<(&ImageDrag, u64)>,
) -> Result<WidgetSnapshot> {
    if !x.is_finite() || !y.is_finite() || x.abs() > 32768.0 || y.abs() > 32768.0 {
        return Err("위치가 올바르지 않아요.".into());
    }
    let areas = desktop::work_areas(app)?;
    let mut target = None;
    let snapshot = mutate(state, id, false, |instance| {
        if drag.is_some_and(|(drag, generation)| drag.moved.load(Ordering::SeqCst) != generation) {
            return Err("이동이 중단됐어요.".into());
        }
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
    move_image(&app, &state, &id, &image_id, x, y, None)
}
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImageResize {
    width: f64,
    height: f64,
    restore: Option<bool>,
    preview: Option<bool>,
    origin_x: Option<f64>,
    origin_y: Option<f64>,
}

#[tauri::command]
pub(crate) fn resize_widget_image(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
    image_id: String,
    resize: ImageResize,
) -> Result<WidgetSnapshot> {
    let ImageResize {
        width,
        height,
        restore,
        preview,
        origin_x,
        origin_y,
    } = resize;
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
    let position = match (origin_x, origin_y) {
        (Some(x), Some(y)) if x.is_finite() && y.is_finite() => Point { x, y },
        (None, None) => {
            let position = window
                .outer_position()
                .map_err(err)?
                .to_logical::<f64>(window.scale_factor().map_err(err)?);
            Point {
                x: position.x,
                y: position.y,
            }
        }
        _ => return Err("위치가 올바르지 않아요.".into()),
    };
    let areas = desktop::work_areas(&app)?;
    let update = |instance: &mut WidgetInstance| {
        active(instance)?;
        let item = image_mut(instance, &image_id)?;
        if item["isOpen"] != true {
            return Err("닫힌 이미지예요.".into());
        }
        let dragged = stop_image_drag(window.label());
        if dragged == Some(desktop::drag_epoch(&app)) && desktop::screen_unchanged(&app) {
            let dragged_point = desktop::clamp_point(
                &Point {
                    x: (position.x / 8.0).round() * 8.0,
                    y: (position.y / 8.0).round() * 8.0,
                },
                size(item),
                &areas,
            );
            item["x"] = json!(dragged_point.x);
            item["y"] = json!(dragged_point.y);
        }
        if !preview.unwrap_or(false) {
            item["width"] = json!(width);
            item["height"] = json!(height);
        }
        Ok(dragged.is_some())
    };
    let snapshot = if preview.unwrap_or(false) {
        change(&state, |db| {
            let mut instance = storage::get(db, &id)?;
            if update(&mut instance)? {
                storage::put(db, &instance)?;
            }
            storage::snapshot(db)
        })?
    } else {
        mutate(&state, &id, false, |instance| update(instance).map(|_| ()))?
    };
    let point = desktop::restore_point(&position, (width, height), &[area]);
    window
        .set_size(tauri::LogicalSize::new(width, height))
        .map_err(err)?;
    window
        .set_position(tauri::LogicalPosition::new(point.x, point.y))
        .map_err(err)?;
    if !preview.unwrap_or(false) {
        publish_widgets(&app, &state);
    }
    Ok(snapshot)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retry_targets_only_the_saved_image() {
        let target = Some(("widget-one", "image-one"));
        assert!(requested_image(target, "widget-one", "image-one"));
        assert!(!requested_image(target, "widget-one", "image-two"));
        assert!(!requested_image(target, "widget-two", "image-one"));
        assert!(requested_image(None, "widget-two", "image-two"));
    }

    #[test]
    fn add_limit_counts_closed_images_and_ignores_revision_changes() {
        let state = crate::app::tests::state();
        let db = lock(&state.db).unwrap();
        let mut instance = storage::instances(&db)
            .unwrap()
            .into_iter()
            .find(|item| item.kind == "image")
            .unwrap();
        instance.data["images"] = json!((0..19)
            .map(|i| json!({"id": i, "isOpen": false}))
            .collect::<Vec<_>>());
        instance.revision += 1;
        assert!(can_add(&db, &instance).is_ok());
        instance.data["images"]
            .as_array_mut()
            .unwrap()
            .push(json!({"id": 19, "isOpen": false}));
        assert!(can_add(&db, &instance)
            .unwrap_err()
            .contains("20장까지 저장"));
        instance.data["images"].as_array_mut().unwrap().pop();
        db.execute(
            "UPDATE widget_instances SET enabled=0 WHERE id=?1",
            [&instance.id],
        )
        .unwrap();
        assert!(can_add(&db, &instance).is_err());
    }

    #[test]
    fn cancellation_only_wins_before_image_is_saved() {
        let mut pending = AddState::Pending;
        assert!(pending.cancel());
        assert!(pending == AddState::Cancelled);
        assert!(!pending.cancel());
        let mut saved = AddState::Saved;
        assert!(!saved.cancel());
        assert!(saved == AddState::Saved);
    }

    #[test]
    fn cancelled_add_keeps_the_image_list_and_media_unchanged() {
        let state = crate::app::tests::state();
        let id = {
            let db = lock(&state.db).unwrap();
            storage::instances(&db)
                .unwrap()
                .into_iter()
                .find(|item| item.kind == "image")
                .unwrap()
                .id
        };
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("image.svg");
        std::fs::write(&source, b"<svg width=\"20\" height=\"10\"></svg>").unwrap();
        let media = image_media::read(&source).unwrap();
        let status = Mutex::new(AddState::Cancelled);
        assert!(!save_image(&state, &id, "cancelled", &media, &status).unwrap());
        let db = lock(&state.db).unwrap();
        let instance = storage::get(&db, &id).unwrap();
        assert!(instance.data["images"].as_array().unwrap().is_empty());
        assert!(super::super::backgrounds::get(&db, "image:cancelled")
            .unwrap()
            .is_none());
    }

    #[test]
    fn reaction_setting_does_not_remove_or_block_existing_images() {
        let state = crate::app::tests::state();
        let id = {
            let db = lock(&state.db).unwrap();
            let mut instance = storage::instances(&db)
                .unwrap()
                .into_iter()
                .find(|instance| instance.kind == "image")
                .unwrap();
            instance.data["images"] = json!([{ "id": "image-one", "isOpen": true }]);
            storage::put(&db, &instance).unwrap();
            super::super::backgrounds::put_media(&db, "image:image-one", "image/png", b"original")
                .unwrap();
            storage::set_reaction(&db, &instance.id, false).unwrap();
            instance.id
        };
        mutate(&state, &id, true, |instance| {
            active(instance)?;
            image_mut(instance, "image-one")?["isOpen"] = json!(false);
            Ok(())
        })
        .unwrap();
        let db = lock(&state.db).unwrap();
        let instance = storage::get(&db, &id).unwrap();
        assert_eq!(instance.data["images"][0]["isOpen"], false);
        assert_eq!(
            super::super::backgrounds::get(&db, "image:image-one")
                .unwrap()
                .unwrap()
                .data
                .as_slice(),
            b"original"
        );
        assert!(!storage::reaction_enabled(&db, &id).unwrap());
    }
}
