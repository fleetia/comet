use crate::{
    app::{lock, AppState},
    widgets::commands::{cancel_widget_scene, change, publish_widgets},
    widgets::{
        desktop::{self, Point, Rect},
        storage, WidgetRequest, WidgetSnapshot,
    },
};
use rusqlite::OptionalExtension;
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};
use tauri::{Emitter, Listener, Manager};

fn execute(
    db: &rusqlite::Connection,
    id: &str,
    action: &str,
    input: Value,
) -> Result<WidgetSnapshot, String> {
    let instance = storage::get(db, id)?;
    if instance.kind != "memo" {
        return Err("메모 위젯을 선택해 주세요.".into());
    }
    storage::execute(
        db,
        &WidgetRequest {
            request_id: uuid::Uuid::new_v4().to_string(),
            instance_id: id.into(),
            expected_revision: instance.revision,
            action: action.into(),
            input,
        },
        chrono::Utc::now().timestamp_millis(),
        uuid::Uuid::new_v4().as_u128() as u64,
    )?;
    storage::snapshot(db)
}

fn label(id: &str, note_id: &str) -> String {
    format!("widget-{id}-note-{note_id}")
}

fn position_key(id: &str, note_id: &str) -> String {
    format!("memo-position:{id}:{note_id}")
}

fn position(db: &rusqlite::Connection, id: &str, note_id: &str) -> Result<Option<Point>, String> {
    let value: Option<String> = db
        .query_row(
            "SELECT value FROM kv WHERE key=?1",
            [position_key(id, note_id)],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    value
        .map(|value| serde_json::from_str(&value).map_err(|error| error.to_string()))
        .transpose()
}

fn prune_positions(db: &rusqlite::Connection) -> Result<(), String> {
    let mut valid = BTreeSet::new();
    for instance in storage::instances(db)?
        .iter()
        .filter(|instance| instance.kind == "memo")
    {
        for note in instance.data["notes"].as_array().into_iter().flatten() {
            if let Some(note_id) = note["id"].as_str() {
                valid.insert(position_key(&instance.id, note_id));
            }
        }
    }
    let keys = {
        let mut statement = db
            .prepare("SELECT key FROM kv WHERE key LIKE 'memo-position:%'")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?
    };
    for key in keys.into_iter().filter(|key| !valid.contains(key)) {
        db.execute("DELETE FROM kv WHERE key=?1", [key])
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn save_position(
    db: &rusqlite::Connection,
    id: &str,
    note_id: &str,
    point: &Point,
) -> Result<bool, String> {
    let instance = storage::get(db, id)?;
    if instance.kind != "memo"
        || !instance.data["notes"].as_array().is_some_and(|notes| {
            notes
                .iter()
                .any(|note| note["id"] == note_id && note["isOpen"] == true)
        })
    {
        return Ok(false);
    }
    db.execute(
        "INSERT INTO kv(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        rusqlite::params![position_key(id, note_id), serde_json::to_string(point).map_err(|error| error.to_string())?],
    ).map_err(|error| error.to_string())?;
    Ok(true)
}

fn accepts_pending_position(
    generation: u64,
    current_generation: Option<u64>,
    epoch: u64,
    current_epoch: u64,
    screen_unchanged: bool,
) -> bool {
    current_generation == Some(generation) && current_epoch == epoch && screen_unchanged
}

fn can_reposition(generation: Option<u64>, current: Option<u64>, dragging: bool) -> bool {
    !dragging && generation == current
}

pub(crate) fn settle_move(
    app: &tauri::AppHandle,
    window_label: &str,
    epoch: u64,
    generation: u64,
) -> Result<(), String> {
    let Some((id, note_id)) = window_label
        .strip_prefix("widget-")
        .and_then(|label| label.split_once("-note-"))
    else {
        return Ok(());
    };
    let Some(window) = app.get_webview_window(window_label) else {
        return Ok(());
    };
    if !window.is_visible().map_err(|error| error.to_string())? {
        return Ok(());
    }
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let point = window
        .outer_position()
        .map_err(|error| error.to_string())?
        .to_logical::<f64>(scale);
    let state = app.state::<Arc<AppState>>();
    let _action = lock(&state.action)?;
    if crate::unavailable(&state)
        || desktop::drag_epoch(app) != epoch
        || !desktop::current_move(app, window_label, generation)
        || !desktop::screen_unchanged(app)
    {
        return Ok(());
    }
    save_position(
        &*lock(&state.db)?,
        id,
        note_id,
        &Point {
            x: point.x,
            y: point.y,
        },
    )?;
    Ok(())
}

fn reveal_note(
    state: &AppState,
    id: &str,
    note_id: &str,
    story: Option<&crate::pack_stories::RunTicket>,
    reveal: impl FnOnce() -> Result<(), String>,
) -> Result<bool, String> {
    let _action = lock(&state.action)?;
    if crate::unavailable(state)
        || story.is_some_and(|run| {
            !crate::app::scene_events::execution_current(state, run).unwrap_or(false)
        })
    {
        return Ok(false);
    }
    let db = lock(&state.db)?;
    if let Some(run) = story {
        if !crate::app::scene_events::available_locked(state, &db, run)? {
            return Ok(false);
        }
    }
    let current = storage::get(&db, id)?;
    if !current.data["notes"].as_array().is_some_and(|notes| {
        notes
            .iter()
            .any(|note| note["id"] == note_id && note["isOpen"] == true)
    }) {
        return Ok(false);
    }
    drop(db);
    reveal()?;
    Ok(true)
}

fn reconcile(
    app: &tauri::AppHandle,
    focus: Option<&str>,
    story: Option<&crate::pack_stories::RunTicket>,
) -> Result<(), String> {
    let state = app.state::<Arc<AppState>>();
    let instances = {
        let _action = lock(&state.action)?;
        if crate::unavailable(&state) {
            return Ok(());
        }
        let db = lock(&state.db)?;
        prune_positions(&db)?;
        storage::instances(&db)?
    };
    let mut desired = BTreeSet::new();
    let mut occupied: Vec<Rect> = desktop::visible_widget_areas(app, "");
    for instance in instances.iter().filter(|item| item.kind == "memo") {
        let Some(notes) = instance.data["notes"].as_array() else {
            continue;
        };
        for note in notes.iter().filter(|note| note["isOpen"] == true) {
            let Some(note_id) = note["id"].as_str() else {
                continue;
            };
            if !note_id
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() || byte == b'-')
            {
                return Err("메모 식별자가 올바르지 않아요.".into());
            }
            let window_label = label(&instance.id, note_id);
            desired.insert(window_label.clone());
            if app.get_webview_window(&window_label).is_none() {
                desktop::invalidate_move(app, &window_label);
                let saved = {
                    let _action = lock(&state.action)?;
                    position(&*lock(&state.db)?, &instance.id, note_id)?
                };
                let size = (320.0, 320.0);
                let point = match saved {
                    Some(point) => desktop::restore_point(&point, size, &desktop::work_areas(app)?),
                    None => {
                        desktop::auto_place(desktop::preferred_area(app, None)?, size, &occupied)
                    }
                };
                occupied.push(Rect::at(&point, size));
                let window = tauri::WebviewWindowBuilder::new(
                    app,
                    window_label.clone(),
                    tauri::WebviewUrl::App(
                        format!(
                            "index.html?view=memo-note&id={}&noteId={note_id}",
                            instance.id
                        )
                        .into(),
                    ),
                )
                .title("comet · 메모")
                .inner_size(320.0, 320.0)
                .position(point.x, point.y)
                .min_inner_size(260.0, 220.0)
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
                .map_err(|error| error.to_string())?;
                let close_window = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ =
                            close_window.emit_to(close_window.label(), "memo-close-request", ());
                    }
                });
                let revealed = reveal_note(
                    &state,
                    &instance.id,
                    note_id,
                    story.filter(|_| focus == Some(window_label.as_str())),
                    || {
                        window.show().map_err(|error| error.to_string())?;
                        if focus == Some(window_label.as_str()) {
                            window.set_focus().map_err(|error| error.to_string())?;
                        }
                        Ok(())
                    },
                );
                if !matches!(revealed, Ok(true)) {
                    let _ = window.destroy();
                }
                revealed?;
            } else if focus == Some(window_label.as_str()) {
                if let Some(window) = app.get_webview_window(&window_label) {
                    reveal_note(
                        &state,
                        &instance.id,
                        note_id,
                        story.filter(|_| focus == Some(window_label.as_str())),
                        || {
                            window.unminimize().map_err(|error| error.to_string())?;
                            window.show().map_err(|error| error.to_string())?;
                            window.set_focus().map_err(|error| error.to_string())
                        },
                    )?;
                }
            }
        }
    }
    for (window_label, window) in app.webview_windows() {
        if window_label.starts_with("widget-")
            && window_label.contains("-note-")
            && !desired.contains(&window_label)
        {
            window.destroy().map_err(|error| error.to_string())?;
        }
    }
    crate::widgets::runtime::refresh(app);
    Ok(())
}

pub(crate) fn reposition_on_screen_change(app: &tauri::AppHandle) {
    type NotePosition = (String, Option<Point>, Option<u64>);

    let state = app.state::<Arc<AppState>>();
    let epoch = desktop::drag_epoch(app);
    let notes = (|| -> Result<Vec<NotePosition>, String> {
        let _action = lock(&state.action)?;
        let db = lock(&state.db)?;
        let mut notes = Vec::new();
        for instance in storage::instances(&db)?
            .iter()
            .filter(|instance| instance.kind == "memo")
        {
            for note in instance.data["notes"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|note| note["isOpen"] == true)
            {
                if let Some(note_id) = note["id"].as_str() {
                    let window_label = label(&instance.id, note_id);
                    let generation = desktop::move_generation(app, &window_label);
                    if desktop::drag_pending(app, &window_label) {
                        continue;
                    }
                    notes.push((
                        window_label,
                        position(&db, &instance.id, note_id)?,
                        generation,
                    ));
                }
            }
        }
        Ok(notes)
    })();
    let (Ok(notes), Ok(areas)) = (notes, desktop::work_areas(app)) else {
        return;
    };
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if desktop::drag_epoch(&handle) != epoch {
            return;
        }
        for (label, saved, generation) in notes {
            if !can_reposition(
                generation,
                desktop::move_generation(&handle, &label),
                desktop::drag_pending(&handle, &label),
            ) {
                continue;
            }
            let Some(window) = handle.get_webview_window(&label) else {
                continue;
            };
            let (Ok(scale), Ok(position), Ok(size)) = (
                window.scale_factor(),
                window.outer_position(),
                window.outer_size(),
            ) else {
                continue;
            };
            let position = position.to_logical::<f64>(scale);
            let size = size.to_logical::<f64>(scale);
            let point = saved.unwrap_or(Point {
                x: position.x,
                y: position.y,
            });
            let point = desktop::restore_point(&point, (size.width, size.height), &areas);
            let _ = window.set_position(tauri::LogicalPosition::new(point.x, point.y));
        }
    });
}

async fn sync_story(
    app: &tauri::AppHandle,
    focus: Option<String>,
    story: Option<crate::pack_stories::RunTicket>,
) -> Result<(), String> {
    let (send, receive) = tokio::sync::oneshot::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let _ = send.send(reconcile(&handle, focus.as_deref(), story.as_ref()));
    })
    .map_err(|error| error.to_string())?;
    receive.await.map_err(|error| error.to_string())?
}

pub(crate) async fn sync(app: &tauri::AppHandle, focus: Option<String>) -> Result<(), String> {
    sync_story(app, focus, None).await
}

pub(crate) async fn reveal_story_note(
    app: &tauri::AppHandle,
    state: &AppState,
    id: &str,
    note: &str,
    run: crate::pack_stories::RunTicket,
) -> Result<(), String> {
    publish_widgets(app, state);
    sync_story(app, Some(label(id, note)), Some(run)).await
}

pub(crate) fn schedule_sync(app: &tauri::AppHandle) {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = sync(&handle, None).await {
            crate::report_error!("memo_window_refresh", "메모 창 갱신 실패: {error}");
        }
    });
}

pub(crate) fn create_note(db: &rusqlite::Connection, id: &str) -> Result<WidgetSnapshot, String> {
    execute(db, id, "add", json!({"isOpen":true}))
}

pub(crate) fn open_story_note(db: &rusqlite::Connection, id: &str) -> Result<String, String> {
    let instance = storage::get(db, id)?;
    let note = instance.data["notes"].as_array().and_then(|notes| {
        notes
            .iter()
            .filter(|note| note["title"] == "" && note["body"] == "")
            .max_by_key(|note| note["updatedAt"].as_i64())
            .and_then(|note| note["id"].as_str())
    });
    if let Some(note) = note {
        execute(db, id, "update", json!({"id":note,"isOpen":true}))?;
        return Ok(note.to_owned());
    }
    let snapshot = create_note(db, id)?;
    let note = snapshot
        .widgets
        .iter()
        .find(|item| item.instance.id == id)
        .and_then(|item| item.instance.data["notes"].as_array())
        .and_then(|notes| notes.last())
        .and_then(|note| note["id"].as_str())
        .ok_or("메모를 열지 못했어요.")?
        .to_owned();
    Ok(note)
}

fn interrupt_scene_for_user_open(
    state: &AppState,
    db: &rusqlite::Connection,
) -> Result<(), String> {
    if !lock(&state.pack_stories)?
        .run
        .as_ref()
        .is_some_and(|run| run.stage == crate::pack_stories::Stage::Chapter)
    {
        return Ok(());
    }
    let (epoch, _) = crate::app::interrupt_with_db(state, false, db)?;
    state
        .widget_epoch
        .store(epoch, std::sync::atomic::Ordering::SeqCst);
    *lock(&state.panel)? = None;
    let mut runtime = lock(&state.runtime)?;
    runtime.phase = crate::types::RuntimePhase::Idle;
    runtime.persona = None;
    runtime.error = None;
    state.nlp.pause_indexing(false);
    Ok(())
}

pub(crate) async fn reveal_created_note(
    app: &tauri::AppHandle,
    state: &AppState,
    id: &str,
    snapshot: WidgetSnapshot,
) -> Result<WidgetSnapshot, String> {
    let note_id = snapshot
        .widgets
        .iter()
        .find(|widget| widget.instance.id == id)
        .and_then(|widget| widget.instance.data["notes"].as_array())
        .and_then(|notes| notes.last())
        .and_then(|note| note["id"].as_str());
    cancel_widget_scene(app, state)?;
    publish_widgets(app, state);
    sync(app, note_id.map(|note_id| label(id, note_id))).await?;
    Ok(snapshot)
}

#[tauri::command]
pub(crate) async fn create_memo_note(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
) -> Result<WidgetSnapshot, String> {
    let snapshot = change(&state, |db| {
        interrupt_scene_for_user_open(&state, db)?;
        create_note(db, &id)
    })?;
    reveal_created_note(&app, &state, &id, snapshot).await
}

#[tauri::command]
pub(crate) async fn open_memo_note(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
    note_id: String,
) -> Result<WidgetSnapshot, String> {
    let snapshot = change(&state, |db| {
        interrupt_scene_for_user_open(&state, db)?;
        execute(db, &id, "update", json!({"id":note_id,"isOpen":true}))
    })?;
    cancel_widget_scene(&app, &state)?;
    publish_widgets(&app, &state);
    sync(&app, Some(label(&id, &note_id))).await?;
    Ok(snapshot)
}

#[tauri::command]
pub(crate) async fn close_memo_note(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
    note_id: String,
) -> Result<WidgetSnapshot, String> {
    let window_label = label(&id, &note_id);
    let pending_position = (|| {
        let generation = desktop::active_drag_move(&app, &window_label)?;
        let epoch = desktop::drag_epoch(&app);
        let window = app.get_webview_window(&window_label)?;
        let scale = window.scale_factor().ok()?;
        let position = window.outer_position().ok()?.to_logical::<f64>(scale);
        Some((
            generation,
            epoch,
            Point {
                x: position.x,
                y: position.y,
            },
        ))
    })();
    let snapshot = change(&state, |db| {
        if let Some((generation, epoch, point)) = &pending_position {
            if accepts_pending_position(
                *generation,
                desktop::active_drag_move(&app, &window_label),
                *epoch,
                desktop::drag_epoch(&app),
                desktop::screen_unchanged(&app),
            ) {
                save_position(db, &id, &note_id, point)?;
            }
        }
        desktop::invalidate_move(&app, &window_label);
        let snapshot = put_away(db, &id, &note_id)?;
        crate::app::scene_events::window_closed_locked(
            &state,
            crate::pack_stories::StoryWindow::Memo,
            &format!("{id}:{note_id}"),
        )?;
        Ok(snapshot)
    })?;
    cancel_widget_scene(&app, &state)?;
    publish_widgets(&app, &state);
    sync(&app, None).await?;
    Ok(snapshot)
}

fn put_away(db: &rusqlite::Connection, id: &str, note_id: &str) -> Result<WidgetSnapshot, String> {
    let instance = storage::get(db, id)?;
    let note = instance.data["notes"]
        .as_array()
        .and_then(|notes| notes.iter().find(|note| note["id"] == note_id))
        .ok_or("메모를 찾지 못했어요.")?;
    if note["title"] == "" && note["body"] == "" {
        execute(db, id, "delete", json!({"id":note_id}))
    } else {
        execute(db, id, "update", json!({"id":note_id,"isOpen":false}))
    }
}

#[tauri::command]
pub(crate) fn save_memo_note(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
    note_id: String,
    body: String,
    font_size: u8,
    expected_body: String,
) -> Result<WidgetSnapshot, String> {
    let snapshot = change(&state, |db| {
        let snapshot = execute(
            db,
            &id,
            "update",
            json!({"id":note_id,"body":body,"fontSize":font_size,"expectedBody":expected_body}),
        )?;
        crate::app::scene_events::memo_saved_locked(&state, &id, &note_id)?;
        Ok(snapshot)
    })?;
    cancel_widget_scene(&app, &state)?;
    publish_widgets(&app, &state);
    Ok(snapshot)
}

#[tauri::command]
pub(crate) async fn request_close_memo_note(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
    note_id: String,
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(&label(&id, &note_id)) {
        return window
            .emit_to(window.label(), "memo-close-request", ())
            .map_err(|error| error.to_string());
    }
    close_memo_note(app, state, id, note_id).await?;
    Ok(())
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct FlushResult {
    request_id: String,
    window_label: String,
    success: bool,
    error: Option<String>,
}

fn flush_result(
    payload: &str,
    request_id: &str,
    window_label: &str,
) -> Option<Result<String, String>> {
    let result: FlushResult = serde_json::from_str(payload).ok()?;
    if result.request_id != request_id || result.window_label != window_label {
        return None;
    }
    Some(if result.success {
        Ok(window_label.into())
    } else {
        Err(result
            .error
            .filter(|error| !error.trim().is_empty())
            .unwrap_or_else(|| {
                "메모를 저장하지 못했어요. 열린 메모를 확인한 뒤 다시 시도해 주세요.".into()
            }))
    })
}

async fn wait_for_flush(
    receiver: &mut tokio::sync::mpsc::UnboundedReceiver<Result<String, String>>,
    mut pending: BTreeSet<String>,
) -> Result<(), String> {
    while !pending.is_empty() {
        let label = receiver
            .recv()
            .await
            .ok_or("메모 저장 응답을 받지 못했어요.")??;
        pending.remove(&label);
    }
    Ok(())
}

fn note_windows(app: &tauri::AppHandle, id: Option<&str>) -> Vec<tauri::WebviewWindow> {
    let prefix = id.map(|id| format!("widget-{id}-note-"));
    app.webview_windows()
        .into_iter()
        .filter(|(label, _)| match &prefix {
            Some(prefix) => label.starts_with(prefix),
            None => label.starts_with("widget-") && label.contains("-note-"),
        })
        .map(|(_, window)| window)
        .collect()
}

fn open_notes(db: &rusqlite::Connection, id: Option<&str>) -> Result<BTreeSet<String>, String> {
    let mut notes = BTreeSet::new();
    for instance in storage::instances(db)?
        .into_iter()
        .filter(|instance| instance.kind == "memo" && id.is_none_or(|id| instance.id == id))
    {
        if let Some(items) = instance.data["notes"].as_array() {
            notes.extend(
                items
                    .iter()
                    .filter(|note| note["isOpen"] == true)
                    .filter_map(|note| {
                        note["id"]
                            .as_str()
                            .map(|note_id| label(&instance.id, note_id))
                    }),
            );
        }
    }
    Ok(notes)
}

pub(crate) struct FlushedNotes {
    windows: Vec<tauri::WebviewWindow>,
    labels: BTreeSet<String>,
    open_notes: BTreeSet<String>,
    id: Option<String>,
    generations: Option<BTreeMap<String, Option<u64>>>,
    payload: Value,
    release: bool,
    _operation: tokio::sync::MutexGuard<'static, ()>,
}

impl FlushedNotes {
    // The caller holds action until its lifecycle mutation has committed.
    pub(crate) fn ensure_current(
        &self,
        app: &tauri::AppHandle,
        db: &rusqlite::Connection,
    ) -> Result<(), String> {
        let current: BTreeSet<String> = note_windows(app, self.id.as_deref())
            .iter()
            .map(|window| window.label().into())
            .collect();
        if self.labels != current
            || self.open_notes != open_notes(db, self.id.as_deref())?
            || self.generations.as_ref().is_some_and(|values| {
                values.iter().any(|(label, generation)| {
                    desktop::move_generation(app, label) != *generation
                })
            })
        {
            return Err("열린 메모가 바뀌었어요. 다시 시도해 주세요.".into());
        }
        Ok(())
    }

    pub(crate) fn keep_locked(&mut self) {
        self.release = false;
    }
}

impl Drop for FlushedNotes {
    fn drop(&mut self) {
        if self.release {
            for window in &self.windows {
                let _ = window.emit_to(window.label(), "memo-flush-release", self.payload.clone());
            }
        }
    }
}

static LIFECYCLE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

pub(crate) async fn flush_notes(
    app: &tauri::AppHandle,
    state: &AppState,
    id: Option<&str>,
) -> Result<FlushedNotes, String> {
    let operation = LIFECYCLE.lock().await;
    let (windows, open_notes) = {
        let _action = lock(&state.action)?;
        if crate::unavailable(state) {
            return Err("앱을 정리하고 있어요.".into());
        }
        (note_windows(app, id), open_notes(&*lock(&state.db)?, id)?)
    };
    let labels: BTreeSet<String> = windows.iter().map(|window| window.label().into()).collect();
    let request_id = uuid::Uuid::new_v4().to_string();
    let flushed = FlushedNotes {
        windows,
        labels,
        open_notes,
        id: id.map(str::to_owned),
        generations: None,
        payload: json!({"requestId":request_id}),
        release: true,
        _operation: operation,
    };
    let (send, mut receive) = tokio::sync::mpsc::unbounded_channel();
    let listeners: Vec<_> = flushed
        .windows
        .iter()
        .map(|window| {
            let send = send.clone();
            let request_id = request_id.clone();
            let window_label = window.label().to_owned();
            let listener = window.listen("memo-flush-result", move |event| {
                if let Some(result) = flush_result(event.payload(), &request_id, &window_label) {
                    let _ = send.send(result);
                }
            });
            (window, listener)
        })
        .collect();
    drop(send);
    let result = async {
        for window in &flushed.windows {
            window
                .emit_to(
                    window.label(),
                    "memo-flush-request",
                    flushed.payload.clone(),
                )
                .map_err(|error| error.to_string())?;
        }
        tokio::time::timeout(
            std::time::Duration::from_secs(10),
            wait_for_flush(&mut receive, flushed.labels.clone()),
        )
        .await
        .map_err(|_| {
            "메모 저장 확인 시간이 초과됐어요. 열린 메모를 확인한 뒤 다시 시도해 주세요."
                .to_string()
        })?
    }
    .await;
    for (window, listener) in listeners {
        window.unlisten(listener);
    }
    result?;
    Ok(flushed)
}


#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct InspectionResult {
    request_id: String,
    window_label: String,
    success: bool,
    token: Option<String>,
    dirty: Option<bool>,
}

pub(crate) async fn inspect_note(
    app: &tauri::AppHandle,
    state: &AppState,
    id: &str,
    note_id: &str,
) -> Result<(FlushedNotes, Option<(String, bool)>), String> {
    let operation = LIFECYCLE.lock().await;
    let (windows, open_notes) = {
        let _action = lock(&state.action)?;
        if crate::unavailable(state) {
            return Err("앱을 정리하고 있어요.".into());
        }
        (
            note_windows(app, Some(id)),
            open_notes(&*lock(&state.db)?, Some(id))?,
        )
    };
    let labels: BTreeSet<String> = windows.iter().map(|window| window.label().into()).collect();
    let target = label(id, note_id);
    let request_id = uuid::Uuid::new_v4().to_string();
    let flushed = FlushedNotes {
        windows,
        labels: labels.clone(),
        open_notes,
        id: Some(id.to_owned()),
        generations: Some(
            labels.iter().map(|label| (label.clone(), desktop::move_generation(app, label))).collect(),
        ),
        payload: json!({"requestId":request_id, "inspect":true}),
        release: true,
        _operation: operation,
    };
    let Some(window) = flushed.windows.iter().find(|window| window.label() == target) else {
        if flushed.open_notes.contains(&target) {
            return Err("열린 메모 창을 확인하지 못했어요. 다시 시도해 주세요.".into());
        }
        return Ok((flushed, None));
    };
    let (send, mut receive) = tokio::sync::mpsc::unbounded_channel();
    let listener_id = request_id.clone();
    let listener_label = target.clone();
    let listener = window.listen("memo-flush-result", move |event| {
        if let Some(result) = serde_json::from_str::<InspectionResult>(event.payload())
            .ok()
            .filter(|result| result.request_id == listener_id && result.window_label == listener_label)
        {
            let _ = send.send(result);
        }
    });
    let result = async {
        window.emit_to(window.label(), "memo-flush-request", flushed.payload.clone())
            .map_err(|error| error.to_string())?;
        let result = tokio::time::timeout(std::time::Duration::from_secs(10), receive.recv())
            .await.map_err(|_| "메모 확인 시간이 초과됐어요. 다시 시도해 주세요.".to_string())?
            .ok_or("메모 확인 응답을 받지 못했어요.")?;
        match (result.success, result.token, result.dirty) {
            (true, Some(token), Some(dirty)) => Ok(Some((token, dirty))),
            _ => Err(String::from("메모가 저장 중이거나 확인할 수 없어요. 다시 시도해 주세요.")),
        }
    }
    .await;
    window.unlisten(listener);
    Ok((flushed, result?))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database() -> (rusqlite::Connection, tempfile::TempDir, String) {
        let directory = tempfile::tempdir().unwrap();
        let db = crate::store::open(&directory.path().join("notes.sqlite")).unwrap();
        storage::verify_packages(&db, directory.path()).unwrap();
        let id = storage::instances(&db)
            .unwrap()
            .into_iter()
            .find(|widget| widget.kind == "memo")
            .unwrap()
            .id;
        (db, directory, id)
    }

    fn notes(db: &rusqlite::Connection, id: &str) -> Vec<Value> {
        storage::get(db, id).unwrap().data["notes"]
            .as_array()
            .unwrap()
            .clone()
    }

    #[test]
    fn put_away_deletes_only_empty_notes_and_keeps_saved_drafts() {
        let (db, _directory, id) = database();
        create_note(&db, &id).unwrap();
        let note_id = notes(&db, &id)[0]["id"].as_str().unwrap().to_owned();
        execute(
            &db,
            &id,
            "update",
            json!({"id": note_id, "body": "  초안\n "}),
        )
        .unwrap();
        put_away(&db, &id, &note_id).unwrap();
        assert_eq!(notes(&db, &id)[0]["body"], "  초안\n ");
        assert_eq!(notes(&db, &id)[0]["isOpen"], false);
        create_note(&db, &id).unwrap();
        let blank_id = notes(&db, &id)[1]["id"].as_str().unwrap().to_owned();
        put_away(&db, &id, &blank_id).unwrap();
        assert_eq!(notes(&db, &id).len(), 1);
    }

    #[test]
    fn position_is_retained_across_edits_and_reopening_without_writing_restore_correction() {
        let (db, _directory, id) = database();
        create_note(&db, &id).unwrap();
        let note_id = notes(&db, &id)[0]["id"].as_str().unwrap().to_owned();
        let stored = Point {
            x: 1400.0,
            y: 850.0,
        };
        assert!(save_position(&db, &id, &note_id, &stored).unwrap());
        execute(&db, &id, "update", json!({"id": note_id, "body": "내용"})).unwrap();
        put_away(&db, &id, &note_id).unwrap();
        execute(&db, &id, "update", json!({"id": note_id, "isOpen": true})).unwrap();
        let area = Rect {
            x: 0.0,
            y: 0.0,
            width: 800.0,
            height: 600.0,
        };
        let restored = desktop::restore_point(
            &position(&db, &id, &note_id).unwrap().unwrap(),
            (320.0, 320.0),
            &[area],
        );
        assert_eq!(restored, Point { x: 480.0, y: 280.0 });
        assert_eq!(position(&db, &id, &note_id).unwrap(), Some(stored));
    }

    #[test]
    fn delayed_move_does_not_save_after_note_is_closed_or_deleted() {
        let (db, _directory, id) = database();
        create_note(&db, &id).unwrap();
        let note_id = notes(&db, &id)[0]["id"].as_str().unwrap().to_owned();
        execute(&db, &id, "update", json!({"id": note_id, "body": "내용"})).unwrap();
        let point = Point { x: 10.0, y: 20.0 };
        assert!(save_position(&db, &id, &note_id, &point).unwrap());
        put_away(&db, &id, &note_id).unwrap();
        assert!(!save_position(&db, &id, &note_id, &point).unwrap());
        assert_eq!(position(&db, &id, &note_id).unwrap(), Some(point.clone()));
        execute(&db, &id, "delete", json!({"id": note_id})).unwrap();
        prune_positions(&db).unwrap();
        assert!(!save_position(&db, &id, &note_id, &point).unwrap());
        assert_eq!(position(&db, &id, &note_id).unwrap(), None);
    }

    #[test]
    fn new_note_placement_avoids_existing_windows_and_unmarked_moves_are_rejected() {
        let area = Rect {
            x: 0.0,
            y: 0.0,
            width: 1200.0,
            height: 800.0,
        };
        let size = (320.0, 320.0);
        let first = desktop::auto_place(area, size, &[]);
        let second = desktop::auto_place(area, size, &[Rect::at(&first, size)]);
        assert!(first.x != second.x || first.y != second.y);
        assert!(!desktop::accepts_drag_move(false, false));
        assert!(desktop::accepts_drag_move(false, true));
    }

    #[test]
    fn closing_during_drag_preserves_only_the_current_screen_and_move() {
        assert!(accepts_pending_position(3, Some(3), 7, 7, true));
        assert!(!accepts_pending_position(3, None, 7, 7, true));
        assert!(!accepts_pending_position(3, Some(4), 7, 7, true));
        assert!(!accepts_pending_position(3, Some(3), 7, 8, true));
        assert!(!accepts_pending_position(3, Some(3), 7, 7, false));
    }

    #[test]
    fn last_drag_position_survives_put_away_and_reopen() {
        let (db, _directory, id) = database();
        create_note(&db, &id).unwrap();
        let note_id = notes(&db, &id)[0]["id"].as_str().unwrap().to_owned();
        execute(&db, &id, "update", json!({"id": note_id, "body": "내용"})).unwrap();
        let last_drag = Point { x: 50.0, y: 100.0 };
        if accepts_pending_position(3, Some(3), 7, 7, true) {
            save_position(&db, &id, &note_id, &last_drag).unwrap();
        }
        put_away(&db, &id, &note_id).unwrap();
        execute(&db, &id, "update", json!({"id": note_id, "isOpen": true})).unwrap();
        assert_eq!(position(&db, &id, &note_id).unwrap(), Some(last_drag));
    }

    #[test]
    fn screen_reposition_skips_a_new_or_pending_drag() {
        assert!(can_reposition(None, None, false));
        assert!(!can_reposition(None, Some(1), false));
        assert!(!can_reposition(Some(1), Some(2), false));
        assert!(!can_reposition(Some(1), Some(1), true));
    }

    #[test]
    fn opening_a_user_memo_interrupts_a_chapter_and_keeps_its_resume_point() {
        for create in [true, false] {
            let (db, _directory, id) = database();
            let state = crate::app::tests::state();
            *lock(&state.db).unwrap() = db;
            let (epoch, cancel) = {
                let _action = lock(&state.action).unwrap();
                crate::app::interrupt(&state, false).unwrap()
            };
            let note_id = {
                let db = lock(&state.db).unwrap();
                let user_id = crate::store::active_user_id(&db).unwrap();
                let run = crate::pack_stories::RunTicket {
                    run_id: "chapter-run".into(),
                    input_id: "input".into(),
                    scope: crate::pack_stories::Scope {
                        user_id,
                        pack_id: "pack".into(),
                        center_id: "a".into(),
                    },
                    scenario_id: Some("tutorial".into()),
                    stage: crate::pack_stories::Stage::Chapter,
                    chapter_id: Some("first".into()),
                    step: 0,
                    phase_generation: 1,
                    epoch,
                    participants: vec!["a".into()],
                    pack_baseline: "1".into(),
                    definition_baselines: Default::default(),
                    last_playback_id: String::new(),
                    definition: None,
                    ready: false,
                };
                let scope = serde_json::to_string(&run.scope).unwrap();
                db.execute("INSERT INTO pack_story_resume VALUES(?1,'tutorial','first','chapter-run','1',100)", [scope]).unwrap();
                *lock(&state.pack_stories).unwrap() = crate::pack_stories::Runtime {
                    run: Some(run),
                    ..Default::default()
                };
                execute(&db, &id, "add", json!({"isOpen":false})).unwrap();
                notes(&db, &id)[0]["id"].as_str().unwrap().to_owned()
            };
            change(&state, |db| {
                interrupt_scene_for_user_open(&state, db)?;
                if create {
                    create_note(db, &id)?;
                } else {
                    execute(db, &id, "update", json!({"id":note_id,"isOpen":true}))?;
                }
                Ok(())
            })
            .unwrap();
            assert!(cancel.load(std::sync::atomic::Ordering::SeqCst));
            assert!(lock(&state.pack_stories).unwrap().run.is_none());
            let db = lock(&state.db).unwrap();
            assert_eq!(db.query_row("SELECT COUNT(*) FROM pack_story_outcomes WHERE run_id='chapter-run' AND kind='cancelled'", [], |row| row.get::<_, i64>(0)).unwrap(), 1);
            assert_eq!(
                db.query_row("SELECT COUNT(*) FROM pack_story_resume", [], |row| row
                    .get::<_, i64>(0))
                    .unwrap(),
                1
            );
            assert!(notes(&db, &id).iter().any(|note| note["isOpen"] == true));
        }
    }

    #[test]
    fn pending_note_reveal_rechecks_shutdown_and_open_intent() {
        for mutation in ["exit", "update", "close"] {
            let (db, _directory, id) = database();
            execute(&db, &id, "add", json!({"isOpen":true})).unwrap();
            let note_id = notes(&db, &id)[0]["id"].as_str().unwrap().to_owned();
            let state = crate::app::tests::state();
            *lock(&state.db).unwrap() = db;
            {
                let _action = lock(&state.action).unwrap();
                match mutation {
                    "exit" => crate::app::lifecycle::prepare_exit_locked(&state).unwrap(),
                    "update" => {
                        crate::app::lifecycle::prepare_update_install_locked(&state).unwrap()
                    }
                    "close" => {
                        execute(
                            &lock(&state.db).unwrap(),
                            &id,
                            "update",
                            json!({"id":note_id,"isOpen":false}),
                        )
                        .unwrap();
                    }
                    _ => unreachable!(),
                }
            }
            let result = reveal_note(&state, &id, &note_id, None, || {
                panic!("a stale pending note must not become visible: {mutation}")
            });
            assert!(!matches!(result, Ok(true)), "{mutation}");
            if matches!(mutation, "exit" | "update") {
                assert_eq!(notes(&lock(&state.db).unwrap(), &id)[0]["isOpen"], true);
            }
        }
    }

    #[test]
    fn note_reveal_queues_visibility_inside_the_lifecycle_boundary() {
        let (db, _directory, id) = database();
        execute(&db, &id, "add", json!({"isOpen":true})).unwrap();
        let note_id = notes(&db, &id)[0]["id"].as_str().unwrap().to_owned();
        let state = crate::app::tests::state();
        *lock(&state.db).unwrap() = db;
        let mut revealed = false;
        assert!(reveal_note(&state, &id, &note_id, None, || {
            assert!(matches!(
                state.action.try_lock(),
                Err(std::sync::TryLockError::WouldBlock)
            ));
            assert!(state.db.try_lock().is_ok());
            revealed = true;
            Ok(())
        })
        .unwrap());
        assert!(revealed);
    }

    #[test]
    fn empty_notes_keep_independent_open_and_font_preferences() {
        let (db, _directory, id) = database();
        execute(&db, &id, "add", json!({"isOpen":true})).unwrap();
        execute(&db, &id, "add", json!({"isOpen":true})).unwrap();
        let initial = notes(&db, &id);
        assert_eq!(initial[0]["title"], "");
        assert_eq!(initial[0]["body"], "");
        assert_eq!(initial[0]["fontSize"], 16);
        execute(
            &db,
            &id,
            "update",
            json!({"id":initial[0]["id"],"fontSize":12,"isOpen":false}),
        )
        .unwrap();
        let saved = notes(&db, &id);
        assert_eq!(saved[0]["fontSize"], 12);
        assert_eq!(saved[0]["isOpen"], false);
        assert_eq!(saved[1]["fontSize"], 16);
        assert_eq!(saved[1]["isOpen"], true);
        for font in [0, 11, 13, 25, 100] {
            assert!(execute(
                &db,
                &id,
                "update",
                json!({"id":initial[0]["id"],"fontSize":font})
            )
            .is_err());
        }
        assert_eq!(notes(&db, &id), saved);
    }

    #[test]
    fn legacy_titles_and_exact_bodies_survive_independent_writes_and_conflicts() {
        let (db, _directory, id) = database();
        let legacy = json!({"notes":[{"id":"1-a","title":"기존 제목","body":"  원문\n둘째 줄  ","updatedAt":1},{"id":"2-b","title":"","body":"다른 메모","updatedAt":2}]});
        db.execute(
            "UPDATE widget_instances SET data=?1 WHERE id=?2",
            rusqlite::params![legacy.to_string(), id],
        )
        .unwrap();
        execute(&db, &id, "update", json!({"id":"1-a","body":"  새 원문\n  ","expectedBody":"  원문\n둘째 줄  ","fontSize":14})).unwrap();
        execute(
            &db,
            &id,
            "update",
            json!({"id":"2-b","body":"두 번째 수정","expectedBody":"다른 메모","fontSize":24}),
        )
        .unwrap();
        let saved = notes(&db, &id);
        assert_eq!(saved[0]["title"], "기존 제목");
        assert_eq!(saved[0]["body"], "  새 원문\n  ");
        assert_eq!(saved[0]["isOpen"], false);
        assert_eq!(saved[1]["body"], "두 번째 수정");
        assert!(execute(
            &db,
            &id,
            "update",
            json!({"id":"1-a","body":"오래된 덮어쓰기","expectedBody":"  원문\n둘째 줄  "})
        )
        .is_err());
        assert_eq!(notes(&db, &id), saved);
        execute(&db, &id, "delete", json!({"id":"1-a"})).unwrap();
        assert!(execute(
            &db,
            &id,
            "update",
            json!({"id":"1-a","body":"복원 금지","expectedBody":""})
        )
        .is_err());
    }

    #[test]
    fn restarting_preserves_note_data_and_open_intent() {
        let (db, directory, id) = database();
        execute(
            &db,
            &id,
            "add",
            json!({"isOpen":true,"body":"보관할 메모","fontSize":20}),
        )
        .unwrap();
        let saved = notes(&db, &id);
        drop(db);
        let db = crate::store::open(&directory.path().join("notes.sqlite")).unwrap();
        storage::verify_packages(&db, directory.path()).unwrap();
        assert_eq!(notes(&db, &id), saved);
    }

    #[tokio::test]
    async fn flush_requires_each_window_and_propagates_save_failure() {
        let expected = BTreeSet::from(["first".into(), "second".into()]);
        let (send, mut receive) = tokio::sync::mpsc::unbounded_channel();
        send.send(Ok("first".into())).unwrap();
        send.send(Ok("first".into())).unwrap();
        drop(send);
        assert!(wait_for_flush(&mut receive, expected.clone())
            .await
            .is_err());

        let (send, mut receive) = tokio::sync::mpsc::unbounded_channel();
        send.send(Ok("first".into())).unwrap();
        send.send(Err("저장 공간 부족".into())).unwrap();
        assert_eq!(
            wait_for_flush(&mut receive, expected.clone())
                .await
                .unwrap_err(),
            "저장 공간 부족"
        );

        let (send, mut receive) = tokio::sync::mpsc::unbounded_channel();
        send.send(Ok("second".into())).unwrap();
        send.send(Ok("first".into())).unwrap();
        assert!(wait_for_flush(&mut receive, expected).await.is_ok());
    }

    #[test]
    fn flush_acknowledgements_are_bound_to_request_and_window() {
        let payload =
            json!({"requestId":"request","windowLabel":"note-a","success":true}).to_string();
        assert!(flush_result(&payload, "old-request", "note-a").is_none());
        assert!(flush_result(&payload, "request", "note-b").is_none());
        assert_eq!(
            flush_result(&payload, "request", "note-a"),
            Some(Ok("note-a".into()))
        );
        let failure = json!({"requestId":"request","windowLabel":"note-a","success":false,"error":"저장 실패"}).to_string();
        assert_eq!(
            flush_result(&failure, "request", "note-a"),
            Some(Err("저장 실패".into()))
        );
    }
}
