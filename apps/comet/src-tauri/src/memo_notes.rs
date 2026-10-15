use crate::{
    app::{lock, AppState},
    widget_commands::{cancel_widget_scene, change, publish_widgets},
    widgets::{storage, WidgetRequest, WidgetSnapshot},
};
use serde_json::{json, Value};
use std::{collections::BTreeSet, sync::Arc};
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

fn reveal_note(
    state: &AppState,
    id: &str,
    note_id: &str,
    reveal: impl FnOnce() -> Result<(), String>,
) -> Result<bool, String> {
    let _action = lock(&state.action)?;
    if crate::unavailable(state) {
        return Ok(false);
    }
    let current = storage::get(&*lock(&state.db)?, id)?;
    if !current.installed
        || !current.enabled
        || !current.data["notes"].as_array().is_some_and(|notes| {
            notes
                .iter()
                .any(|note| note["id"] == note_id && note["isOpen"] == true)
        })
    {
        return Ok(false);
    }
    reveal()?;
    Ok(true)
}

fn reconcile(app: &tauri::AppHandle, focus: Option<&str>) -> Result<(), String> {
    let state = app.state::<Arc<AppState>>();
    let instances = {
        let _action = lock(&state.action)?;
        if crate::unavailable(&state) {
            return Ok(());
        }
        storage::instances(&*lock(&state.db)?)?
    };
    let mut desired = BTreeSet::new();
    for instance in instances
        .iter()
        .filter(|item| item.kind == "memo" && item.installed && item.enabled)
    {
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
                return Err("메모 식별자가 올바르지 않습니다.".into());
            }
            let window_label = label(&instance.id, note_id);
            desired.insert(window_label.clone());
            if app.get_webview_window(&window_label).is_none() {
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
                .min_inner_size(260.0, 220.0)
                .decorations(false)
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
                let revealed = reveal_note(&state, &instance.id, note_id, || {
                    window.show().map_err(|error| error.to_string())?;
                    if focus == Some(window_label.as_str()) {
                        window.set_focus().map_err(|error| error.to_string())?;
                    }
                    Ok(())
                });
                if !matches!(revealed, Ok(true)) {
                    let _ = window.destroy();
                }
                revealed?;
            } else if focus == Some(window_label.as_str()) {
                if let Some(window) = app.get_webview_window(&window_label) {
                    reveal_note(&state, &instance.id, note_id, || {
                        window.unminimize().map_err(|error| error.to_string())?;
                        window.show().map_err(|error| error.to_string())?;
                        window.set_focus().map_err(|error| error.to_string())
                    })?;
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
    crate::widget_runtime::refresh(app);
    Ok(())
}

async fn sync(app: &tauri::AppHandle, focus: Option<String>) -> Result<(), String> {
    let (send, receive) = tokio::sync::oneshot::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let _ = send.send(reconcile(&handle, focus.as_deref()));
    })
    .map_err(|error| error.to_string())?;
    receive.await.map_err(|error| error.to_string())?
}

pub(crate) fn schedule_sync(app: &tauri::AppHandle) {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = sync(&handle, None).await {
            eprintln!("메모 창 갱신 실패: {error}");
        }
    });
}

pub(crate) fn create_note(db: &rusqlite::Connection, id: &str) -> Result<WidgetSnapshot, String> {
    execute(db, id, "add", json!({"isOpen":true}))
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
    let snapshot = change(&state, |db| create_note(db, &id))?;
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
    let snapshot = change(&state, |db| {
        execute(db, &id, "update", json!({"id":note_id,"isOpen":false}))
    })?;
    cancel_widget_scene(&app, &state)?;
    publish_widgets(&app, &state);
    sync(&app, None).await?;
    Ok(snapshot)
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
        execute(
            db,
            &id,
            "update",
            json!({"id":note_id,"body":body,"fontSize":font_size,"expectedBody":expected_body}),
        )
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
    for instance in storage::instances(db)?.into_iter().filter(|instance| {
        instance.kind == "memo"
            && instance.installed
            && instance.enabled
            && id.is_none_or(|id| instance.id == id)
    }) {
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
        if self.labels != current || self.open_notes != open_notes(db, self.id.as_deref())? {
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

pub(crate) async fn flush_notes(
    app: &tauri::AppHandle,
    state: &AppState,
    id: Option<&str>,
) -> Result<FlushedNotes, String> {
    static LIFECYCLE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
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

pub(crate) async fn with_flushed_notes<T>(
    app: &tauri::AppHandle,
    state: &AppState,
    id: &str,
    action: impl FnOnce(&rusqlite::Connection) -> Result<T, String>,
) -> Result<T, String> {
    if storage::get(&*lock(&state.db)?, id)?.kind != "memo" {
        return change(state, action);
    }
    let mut flushed = flush_notes(app, state, Some(id)).await?;
    let result = change(state, |db| {
        flushed.ensure_current(app, db)?;
        action(db)
    })?;
    flushed.keep_locked();
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database() -> (rusqlite::Connection, tempfile::TempDir, String) {
        let directory = tempfile::tempdir().unwrap();
        let db = crate::store::open(&directory.path().join("notes.sqlite")).unwrap();
        storage::install(&db, directory.path(), &["memo".into()]).unwrap();
        let id = storage::instances(&db).unwrap()[0].id.clone();
        (db, directory, id)
    }

    fn notes(db: &rusqlite::Connection, id: &str) -> Vec<Value> {
        storage::get(db, id).unwrap().data["notes"]
            .as_array()
            .unwrap()
            .clone()
    }

    #[test]
    fn pending_note_reveal_rechecks_shutdown_and_open_intent() {
        for mutation in ["exit", "update", "close", "disable", "remove", "delete"] {
            let (db, directory, id) = database();
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
                    "disable" => {
                        storage::set_enabled(&lock(&state.db).unwrap(), &id, false).unwrap()
                    }
                    "remove" | "delete" => storage::remove(
                        &lock(&state.db).unwrap(),
                        directory.path(),
                        &id,
                        mutation == "delete",
                    )
                    .unwrap(),
                    _ => unreachable!(),
                }
            }
            let result = reveal_note(&state, &id, &note_id, || {
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
        assert!(reveal_note(&state, &id, &note_id, || {
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
    fn disabling_and_reinstalling_keep_note_data_and_open_intent() {
        let (db, directory, id) = database();
        execute(
            &db,
            &id,
            "add",
            json!({"isOpen":true,"body":"보관할 메모","fontSize":20}),
        )
        .unwrap();
        let saved = notes(&db, &id);
        storage::set_enabled(&db, &id, false).unwrap();
        assert!(execute(&db, &id, "add", json!({})).is_err());
        assert_eq!(notes(&db, &id), saved);
        storage::remove(&db, directory.path(), &id, false).unwrap();
        storage::install(&db, directory.path(), &["memo".into()]).unwrap();
        assert_eq!(notes(&db, &id), saved);
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
