use crate::{
    app::{
        interrupt, lock, now, publish,
        scene::start_scene,
        windows::{open_settings_section, SettingsSection},
        AppState,
    },
    store,
    types::SceneLine,
    widgets::{self, storage, WidgetEvent, WidgetRequest, WidgetSnapshot},
};
use serde_json::Value;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

pub(crate) fn publish_widgets(app: &tauri::AppHandle, state: &AppState) {
    if let Ok(db) = lock(&state.db) {
        if let Ok(snapshot) = storage::snapshot(&db) {
            let _ = app.emit("widgets-state", snapshot);
        }
    }
    if crate::characters::animation_states::refresh(app, state).unwrap_or(false) {
        publish(app, state);
    }
    crate::desktop::menu::refresh(app);
    crate::widgets::runtime::refresh(app);
}

/// Keeps idle chatter deferred for the whole focus run, so it never fires right after the timer ends.
pub(crate) fn hold_for_focus(state: &AppState, db: &rusqlite::Connection) -> Result<bool, String> {
    let quiet = lock(&state.runtime)?.paused
        || crate::app::quiet_hours::automatic_blocked(state, &store::settings(db)?)?;
    let focus = storage::focus_active(db, chrono::Utc::now().timestamp_millis())?;
    if !quiet && !focus {
        return Ok(false);
    }
    if focus {
        storage::discard_pending_during_focus(db)?;
    } else {
        storage::discard_pending_during_quiet(db)?;
    }
    crate::app::schedule_idle(state, store::settings(db)?.idle_minutes);
    Ok(true)
}

fn current_events(state: &AppState, db: &rusqlite::Connection) -> Result<(), String> {
    let epoch = state.epoch.load(Ordering::SeqCst);
    if state.widget_epoch.load(Ordering::SeqCst) != epoch {
        storage::discard_pending(db)?;
        state.widget_epoch.store(epoch, Ordering::SeqCst);
    }
    Ok(())
}

pub(crate) fn change<T>(
    state: &AppState,
    action: impl FnOnce(&rusqlite::Connection) -> Result<T, String>,
) -> Result<T, String> {
    let _guard = lock(&state.action)?;
    if crate::unavailable(state) {
        return Err("앱을 종료하고 있어요.".into());
    }
    let db = lock(&state.db)?;
    current_events(state, &db)?;
    let was_focused = storage::focus_active(&db, chrono::Utc::now().timestamp_millis())?;
    let result = action(&db)?;
    if !was_focused && storage::focus_active(&db, chrono::Utc::now().timestamp_millis())? {
        store::pause_conversations_for_focus(&db, chrono::Utc::now().timestamp_millis())?;
        let (epoch, _) = crate::app::interrupt_with_db(state, false, &db)?;
        state.widget_epoch.store(epoch, Ordering::SeqCst);
        *lock(&state.panel)? = None;
        storage::discard_pending_during_focus(&db)?;
        crate::widgets::generated::discard_pending(&db)?;
        crate::widgets::generated::commands::skip_automatic_message(&db)?;
        crate::app::schedule_idle(state, store::settings(&db)?.idle_minutes);
        let mut runtime = lock(&state.runtime)?;
        runtime.phase = crate::types::RuntimePhase::Idle;
        runtime.persona = None;
        runtime.error = None;
        state.nlp.pause_indexing(false);
    }
    Ok(result)
}

fn active_appearance_target(
    instance: &widgets::WidgetInstance,
    expected_revision: i64,
) -> Result<(), String> {
    if instance.revision != expected_revision {
        return Err(
            "다른 화면에서 위젯이 변경됐어요. 최신 상태를 확인하고 다시 시도해 주세요.".into(),
        );
    }
    if !widgets::appearance::supports(&instance.kind) {
        return Err("이 위젯은 색상·글자를 바꿀 수 없어요.".into());
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn get_widgets(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<WidgetSnapshot, String> {
    storage::snapshot(&*lock(&state.db)?)
}

#[tauri::command]
pub(crate) fn set_widget_reaction(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
    enabled: bool,
) -> Result<(), String> {
    change(&state, |db| {
        let official = storage::instances(db)?.iter().any(|widget| widget.id == id);
        let generated: bool = db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM generated_widgets WHERE id=?1 AND installed=1)",
                [&id],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if !official && !generated {
            return Err("위젯을 찾지 못했어요.".into());
        }
        storage::set_reaction(db, &id, enabled)
    })?;
    if !enabled {
        let _action = lock(&state.action)?;
        let db = lock(&state.db)?;
        let is_target = lock(&state.widget_playback)?
            .as_ref()
            .is_some_and(|event| event.instance_id == id);
        if is_target {
            cancel_stale_widget_scene(&state, &db)?;
        }
        drop(db);
        drop(_action);
        publish(&app, &state);
    }
    publish_widgets(&app, &state);
    widgets::generated::commands::publish(&app);
    Ok(())
}

pub(crate) fn cancel_widget_scene(app: &tauri::AppHandle, state: &AppState) -> Result<(), String> {
    {
        let _action = lock(&state.action)?;
        let db = lock(&state.db)?;
        cancel_stale_widget_scene(state, &db)?;
    }
    publish(app, state);
    Ok(())
}

fn cancel_stale_widget_scene(state: &AppState, db: &rusqlite::Connection) -> Result<(), String> {
    let has_scene = lock(&state.widget_playback)?.is_some();
    let has_talk = lock(&state.talk_playback)?.is_some();
    if (has_scene && !widget_event_current(state, db)?)
        || (has_talk && !crate::talk::host::current(state, db)?)
    {
        let token = interrupt(state, true)?;
        state.widget_epoch.store(token.0, Ordering::SeqCst);
        let mut runtime = lock(&state.runtime)?;
        runtime.phase = crate::types::RuntimePhase::Idle;
        runtime.persona = None;
    }
    Ok(())
}

pub(crate) fn cancel_widget_jobs(state: &AppState, id: Option<&str>) -> Result<(), String> {
    cancel_widget_opens(state, id)?;
    if let Some(id) = id {
        crate::widgets::music_bridge::revoke(id);
    } else {
        crate::widgets::music_bridge::revoke_all();
    }
    let mut jobs = lock(&state.widget_jobs)?;
    if let Some(id) = id {
        if let Some(cancel) = jobs.remove(id) {
            cancel.store(true, Ordering::SeqCst);
        }
    } else {
        for (_, cancel) in jobs.drain() {
            cancel.store(true, Ordering::SeqCst);
        }
    }
    Ok(())
}

fn begin_widget_open(state: &AppState, id: &str) -> Result<Arc<AtomicBool>, String> {
    let token = Arc::new(AtomicBool::new(false));
    if let Some(previous) = lock(&state.widget_open_intents)?.insert(id.into(), token.clone()) {
        previous.store(true, Ordering::SeqCst);
    }
    Ok(token)
}

pub(crate) fn cancel_widget_opens(state: &AppState, id: Option<&str>) -> Result<(), String> {
    let mut intents = lock(&state.widget_open_intents)?;
    if let Some(id) = id {
        if let Some(token) = intents.remove(id) {
            token.store(true, Ordering::SeqCst);
        }
    } else {
        for (_, token) in intents.drain() {
            token.store(true, Ordering::SeqCst);
        }
    }
    Ok(())
}

fn widget_open_current(state: &AppState, id: &str, token: &Arc<AtomicBool>) -> Result<(), String> {
    if token.load(Ordering::SeqCst)
        || !lock(&state.widget_open_intents)?
            .get(id)
            .is_some_and(|current| Arc::ptr_eq(current, token))
    {
        return Err("위젯 열기를 취소했어요.".into());
    }
    Ok(())
}

#[cfg(test)]
mod music_open_tests {
    use super::*;

    #[test]
    fn newer_music_open_supersedes_a_waiting_open_without_using_refresh_slots() {
        let state = crate::app::tests::state();
        let first = begin_widget_open(&state, "music").unwrap();
        let second = begin_widget_open(&state, "music").unwrap();
        assert!(widget_open_current(&state, "music", &first).is_err());
        assert!(widget_open_current(&state, "music", &second).is_ok());
        assert!(lock(&state.widget_jobs).unwrap().is_empty());
    }

    #[test]
    fn close_cancels_a_waiting_music_open_but_preserves_background_reading() {
        let state = crate::app::tests::state();
        let reading = Arc::new(AtomicBool::new(false));
        lock(&state.widget_jobs)
            .unwrap()
            .insert("music".into(), reading.clone());
        let pending = begin_widget_open(&state, "music").unwrap();
        cancel_widget_opens(&state, Some("music")).unwrap();
        assert!(widget_open_current(&state, "music", &pending).is_err());
        assert!(!reading.load(Ordering::SeqCst));
        let reopened = begin_widget_open(&state, "music").unwrap();
        assert!(widget_open_current(&state, "music", &reopened).is_ok());
        assert!(widget_open_current(&state, "music", &pending).is_err());
    }

    #[test]
    fn cancelling_music_jobs_cannot_revive_an_earlier_open() {
        let state = crate::app::tests::state();
        let directory = tempfile::tempdir().unwrap();
        let id = change(&state, |db| {
            storage::verify_packages(db, directory.path())?;
            Ok(storage::instances(db)?.into_iter().find(|widget| widget.kind == "music").ok_or("음악 위젯이 없어요")?.id)
        })
        .unwrap();
        let pending = begin_widget_open(&state, &id).unwrap();
        change(&state, |db| {
            cancel_widget_jobs(&state, Some(&id))?;
            validate_open_widget(&state, &storage::get(db, &id)?, None)
        })
        .unwrap();
        assert!(widget_open_current(&state, &id, &pending).is_err());
        assert!(widget_open_current(&state, &id, &begin_widget_open(&state, &id).unwrap()).is_ok());
    }

    #[test]
    fn cancelling_music_jobs_or_stopping_the_app_invalidates_pending_opens() {
        let state = crate::app::tests::state();
        let directory = tempfile::tempdir().unwrap();
        let id = change(&state, |db| {
            storage::verify_packages(db, directory.path())?;
            Ok(storage::instances(db)?.into_iter().find(|widget| widget.kind == "music").ok_or("음악 위젯이 없어요")?.id)
        })
        .unwrap();
        let removed = begin_widget_open(&state, &id).unwrap();
        change(&state, |db| {
            cancel_widget_jobs(&state, Some(&id))
        })
        .unwrap();
        assert!(widget_open_current(&state, &id, &removed).is_err());
        let stopping = begin_widget_open(&state, &id).unwrap();
        cancel_widget_jobs(&state, None).unwrap();
        assert!(widget_open_current(&state, &id, &stopping).is_err());
    }
}

pub(crate) fn widget_event_current(
    state: &AppState,
    db: &rusqlite::Connection,
) -> Result<bool, String> {
    let Some(event) = lock(&state.widget_playback)?.clone() else {
        return Ok(false);
    };
    if lock(&state.runtime)?.paused && !crate::app::quiet_hours::event_allowed(&event.event) {
        return Ok(false);
    }
    event_current(db, &event)
}

pub(crate) fn event_current(
    db: &rusqlite::Connection,
    event: &WidgetEvent,
) -> Result<bool, String> {
    if storage::focus_active(db, chrono::Utc::now().timestamp_millis())? {
        return Ok(false);
    }
    if crate::app::quiet_hours::active(&store::settings(db)?)
        && !crate::app::quiet_hours::event_allowed(&event.event)
    {
        return Ok(false);
    }
    if event.widget_kind == "state-rule" {
        return crate::widgets::generated::commands::event_current(db, event);
    }
    let Ok(instance) = storage::get(db, &event.instance_id) else {
        return Ok(false);
    };
    Ok(storage::reaction_enabled(db, &event.instance_id)?
        && event.expires_at > chrono::Utc::now().timestamp_millis()
        && widgets::reminders::event_current(db, event)?
        && !widgets::is_retired(&instance.kind)
        && instance.revision == event.revision)
}

#[tauri::command]
pub(crate) async fn execute_widget(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    request: WidgetRequest,
) -> Result<Option<String>, String> {
    if matches!(request.action.as_str(), "desktop-open" | "desktop-clear") {
        let launch = if request.action == "desktop-open" {
            let token = crate::desktop::toys::launch_token(&app, &request.instance_id)?;
            Some((token, crate::desktop::toys::current_geometry(&app).await?))
        } else {
            None
        };
        return change(&state, |db| {
            let instance = storage::get(db, &request.instance_id)?;
            if instance.revision != request.expected_revision
                || !crate::behavior::DESKTOP_TOYS.contains(&instance.kind.as_str())
            {
                return Err("장난감 상태가 바뀌었어요. 다시 열어 주세요.".into());
            }
            if let Some((token, geometry)) = &launch {
                crate::desktop::toys::validate_launch(&app, &instance.id, *token)?;
                crate::desktop::toys::open(
                    &app,
                    &instance.id,
                    &instance.kind,
                    None,
                    instance.revision,
                    false,
                    geometry,
                )?;
            } else {
                crate::desktop::toys::remove_widget(&app, &instance.id);
            }
            Ok(None)
        });
    }
    let created_id = change(&state, |db| {
        let created_id = execute_with_created_id(
            db,
            &request,
            chrono::Utc::now().timestamp_millis(),
            uuid::Uuid::new_v4().as_u128() as u64,
        )?;
        if request.action == "configure-alerts" {
            lock(&state.widget_clocks)?.remove(&request.instance_id);
        }
        Ok(created_id)
    })?;
    crate::widgets::memo_notes::schedule_sync(&app);
    // New state can invalidate an already playing reaction to this widget.
    if let Err(error) = cancel_widget_scene(&app, &state) {
        if created_id.is_none() {
            return Err(error);
        }
        crate::report_error!(
            "widget_save_reaction",
            "위젯 내용 저장 후 반응 갱신 실패: {error}"
        );
        if let Ok(mut runtime) = lock(&state.runtime) {
            runtime.error = Some("내용은 저장했지만 캐릭터 반응을 갱신하지 못했어요.".into());
        }
        publish(&app, &state);
    }
    publish_widgets(&app, &state);
    Ok(created_id)
}

fn execute_with_created_id(
    db: &rusqlite::Connection,
    request: &WidgetRequest,
    now: i64,
    entropy: u64,
) -> Result<Option<String>, String> {
    use rusqlite::OptionalExtension;

    let tx = db
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    let before = if matches!(request.action.as_str(), "add" | "create") {
        storage::get(&tx, &request.instance_id).ok()
    } else {
        None
    };
    let preparation_creation = request.action == "create"
        && before
            .as_ref()
            .is_some_and(|instance| instance.kind == "preparation");
    let already_applied = preparation_creation
        && tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM widget_requests WHERE id=?1)",
                [&request.request_id],
                |row| row.get::<_, bool>(0),
            )
            .map_err(|error| error.to_string())?;
    if let Err(error) = storage::execute_in_transaction(&tx, request, now, entropy) {
        tx.rollback().map_err(|error| error.to_string())?;
        return Err(if preparation_creation && !already_applied {
            format!("PREPARATION_CREATE_REJECTED:{error}")
        } else {
            error
        });
    }
    let saved: Option<Option<String>> = tx
        .query_row(
            "SELECT created_id FROM widget_request_results WHERE request_id=?1",
            [&request.request_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let created_id = if let Some(saved) = saved {
        saved
    } else {
        let field = before.as_ref().and_then(|instance| {
            match (instance.kind.as_str(), request.action.as_str()) {
                ("todo", "add") => Some("items"),
                ("preparation", "create") => Some("envelopes"),
                _ => None,
            }
        });
        let created = if let (Some(before), Some(field)) = (before, field) {
            let previous_ids: std::collections::BTreeSet<&str> = before.data[field]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|item| item["id"].as_str())
                .collect();
            let after = storage::get(&tx, &request.instance_id)?;
            after.data[field]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|item| item["id"].as_str())
                .find(|id| !previous_ids.contains(id))
                .map(str::to_owned)
        } else {
            None
        };
        tx.execute(
            "INSERT INTO widget_request_results(request_id,created_id) VALUES(?1,?2)",
            rusqlite::params![request.request_id, created],
        )
        .map_err(|error| error.to_string())?;
        created
    };
    tx.commit().map_err(|error| error.to_string())?;
    Ok(created_id)
}

#[tauri::command]
pub(crate) fn configure_widget_appearance(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
    expected_revision: i64,
    input: Value,
) -> Result<(), String> {
    change(&state, |db| {
        let instance = storage::get(db, &id)?;
        active_appearance_target(&instance, expected_revision)?;
        let data = widgets::configure_appearance(&instance, &input)?;
        storage::commit_data(db, &id, expected_revision, data, vec![], now())
    })?;
    crate::widgets::memo_notes::schedule_sync(&app);
    cancel_widget_scene(&app, &state)?;
    publish_widgets(&app, &state);
    Ok(())
}

#[tauri::command]
pub(crate) async fn choose_widget_background(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
    expected_revision: i64,
) -> Result<bool, String> {
    {
        let db = lock(&state.db)?;
        let instance = storage::get(&db, &id)?;
        active_appearance_target(&instance, expected_revision)?;
    }
    let (send, receive) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("위젯 배경 이미지 선택")
        .add_filter("이미지", &widgets::backgrounds::EXTENSIONS)
        .pick_file(move |path| {
            let _ = send.send(path);
        });
    let Some(path) = receive
        .await
        .map_err(|_| "파일 선택이 중단됐어요.".to_string())?
    else {
        return Ok(false);
    };
    let path = path.into_path().map_err(|error| error.to_string())?;
    let bytes =
        tauri::async_runtime::spawn_blocking(move || widgets::backgrounds::read_file(&path))
            .await
            .map_err(|error| error.to_string())??;
    change(&state, |db| {
        let tx = db
            .unchecked_transaction()
            .map_err(|error| error.to_string())?;
        let instance = storage::get(&tx, &id)?;
        active_appearance_target(&instance, expected_revision)?;
        widgets::backgrounds::put(&tx, &id, &bytes)?;
        storage::bump_revision(&tx, &id, expected_revision)?;
        tx.commit().map_err(|error| error.to_string())
    })?;
    crate::widgets::memo_notes::schedule_sync(&app);
    cancel_widget_scene(&app, &state)?;
    publish_widgets(&app, &state);
    Ok(true)
}

#[tauri::command]
pub(crate) fn remove_widget_background(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
    expected_revision: i64,
) -> Result<bool, String> {
    let removed = change(&state, |db| {
        let tx = db
            .unchecked_transaction()
            .map_err(|error| error.to_string())?;
        let instance = storage::get(&tx, &id)?;
        active_appearance_target(&instance, expected_revision)?;
        if !widgets::backgrounds::remove(&tx, &id)? {
            tx.commit().map_err(|error| error.to_string())?;
            return Ok(false);
        }
        storage::bump_revision(&tx, &id, expected_revision)?;
        tx.commit().map_err(|error| error.to_string())?;
        Ok(true)
    })?;
    if removed {
        crate::widgets::memo_notes::schedule_sync(&app);
        cancel_widget_scene(&app, &state)?;
        publish_widgets(&app, &state);
    }
    Ok(removed)
}

#[tauri::command]
pub(crate) fn get_widget_journal(
    state: tauri::State<'_, Arc<AppState>>,
    before: Option<i64>,
    start_at: i64,
    end_at: i64,
) -> Result<Vec<(i64, WidgetEvent)>, String> {
    let db = lock(&state.db)?;
    storage::journal(&db, before, start_at, end_at)
}

#[tauri::command]
pub(crate) async fn open_widgets(app: tauri::AppHandle) -> Result<(), String> {
    open_settings_section(app, SettingsSection::Widgets)
}

#[tauri::command]
pub(crate) fn close_widgets(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("settings") {
        window.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn open_widget(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), String> {
    open_widget_inner(&app, &state, &id, None, None).await
}

/// Widgets the character menu's "같이 놀기" ring opens.
const PLAY_KINDS: [&str; 7] = [
    "small-match",
    "guessing",
    "fortune",
    "ball",
    "paper-plane",
    "bubbles",
    "pet",
];

/// Picks the requested game on a play widget and returns its id. Picking never plays a round.
pub(crate) fn prepare_play(
    db: &rusqlite::Connection,
    kind: &str,
    mode: Option<&str>,
    now: i64,
) -> Result<Option<String>, String> {
    if !PLAY_KINDS.contains(&kind) {
        return Err("같이 놀 수 있는 위젯이 아니에요.".into());
    }
    let Some(instance) = storage::instances(db)?
        .into_iter()
        .find(|instance| instance.kind == kind)
    else {
        return Ok(None);
    };
    let action = match (kind, mode) {
        ("small-match", Some(game)) => Some(("choose", serde_json::json!({ "game": game }))),
        ("guessing", Some(mode))
            if !(instance.data["playing"] == true && instance.data["mode"] == mode) =>
        {
            Some(("start", serde_json::json!({ "mode": mode })))
        }
        (_, None) | ("guessing", Some(_)) => None,
        _ => return Err("이 위젯은 놀이를 고를 수 없어요.".into()),
    };
    if let Some((action, input)) = action {
        storage::execute(
            db,
            &WidgetRequest {
                request_id: uuid::Uuid::new_v4().to_string(),
                instance_id: instance.id.clone(),
                expected_revision: instance.revision,
                action: action.into(),
                input,
            },
            now,
            uuid::Uuid::new_v4().as_u128() as u64,
        )?;
    }
    Ok(Some(instance.id))
}

#[tauri::command]
pub(crate) async fn open_play_widget(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    kind: String,
    mode: Option<String>,
) -> Result<(), String> {
    let prepared = change(&state, |db| {
        prepare_play(
            db,
            &kind,
            mode.as_deref(),
            chrono::Utc::now().timestamp_millis(),
        )
    })?;
    publish_widgets(&app, &state);
    match prepared {
        Some(id) => open_widget_inner(&app, &state, &id, None, None).await,
        None => crate::widgets::planning::windows::open_widget_settings(app.clone(), &kind),
    }
}

/// Checks the launcher session, the widget kind and its revision in the same action section as
/// the write. A reused request id is a no-op, so a retried Enter never adds a second task.
pub(crate) fn commit_todo_for_launcher(
    state: &AppState,
    session_id: u64,
    id: &str,
    expected_revision: i64,
    title: &str,
    request_id: &str,
) -> Result<(), String> {
    uuid::Uuid::parse_str(request_id).map_err(|_| "요청 식별자가 올바르지 않아요.".to_string())?;
    change(state, |db| {
        if storage::get(db, id)?.kind != "todo" {
            return Err("할 일 위젯에만 적을 수 있어요.".into());
        }
        crate::app::launcher::accept_execution(state, session_id)?;
        storage::execute(
            db,
            &WidgetRequest {
                request_id: request_id.into(),
                instance_id: id.into(),
                expected_revision,
                action: "add".into(),
                input: serde_json::json!({ "title": title }),
            },
            chrono::Utc::now().timestamp_millis(),
            uuid::Uuid::new_v4().as_u128() as u64,
        )
    })
}

pub(crate) fn add_todo_for_launcher(
    app: &tauri::AppHandle,
    state: &AppState,
    id: &str,
    expected_revision: i64,
    title: &str,
    request_id: &str,
    session_id: u64,
) -> Result<(), String> {
    commit_todo_for_launcher(state, session_id, id, expected_revision, title, request_id)?;
    crate::widgets::memo_notes::schedule_sync(app);
    cancel_widget_scene(app, state)?;
    publish_widgets(app, state);
    Ok(())
}

pub(crate) async fn open_widget_for_launcher(
    app: tauri::AppHandle,
    state: &Arc<AppState>,
    id: String,
    expected_revision: i64,
    session_id: u64,
) -> Result<(), String> {
    open_widget_inner(
        &app,
        state,
        &id,
        Some((expected_revision, session_id)),
        None,
    )
    .await
}

struct ConversationOpen<'a> {
    expected_revision: i64,
    epoch: u64,
    cancel: &'a AtomicBool,
}

#[cfg(test)]
mod conversation_open_tests {
    use super::*;

    #[test]
    fn conversation_open_requires_current_epoch_revision_and_allowed_kind() {
        let state = crate::app::tests::state();
        let cancel = AtomicBool::new(false);
        let guard = ConversationOpen {
            expected_revision: 3,
            epoch: state.epoch.load(Ordering::SeqCst),
            cancel: &cancel,
        };
        let mut instance = widgets::WidgetInstance {
            id: uuid::Uuid::new_v4().to_string(),
            kind: "ball".into(),
            version: 1,
            revision: 3,
            data: serde_json::json!({}),
            error: None,
        };
        assert!(validate_conversation_open(&state, &instance, Some(&guard)).is_ok());
        instance.revision = 4;
        assert!(validate_conversation_open(&state, &instance, Some(&guard)).is_err());
        instance.revision = 3;
        instance.kind = "memo".into();
        assert!(validate_conversation_open(&state, &instance, Some(&guard)).is_err());
        instance.kind = "music".into();
        assert!(validate_conversation_open(&state, &instance, Some(&guard)).is_err());
        instance.kind = "interaction".into();
        cancel.store(true, Ordering::SeqCst);
        assert!(validate_conversation_open(&state, &instance, Some(&guard)).is_err());
        cancel.store(false, Ordering::SeqCst);
        state.epoch.fetch_add(1, Ordering::SeqCst);
        assert!(validate_conversation_open(&state, &instance, Some(&guard)).is_err());
    }
}

fn validate_conversation_open(
    state: &AppState,
    instance: &widgets::WidgetInstance,
    guard: Option<&ConversationOpen<'_>>,
) -> Result<(), String> {
    let Some(guard) = guard else {
        return Ok(());
    };
    if !matches!(
        instance.kind.as_str(),
        "ball" | "paper-plane" | "interaction"
    ) {
        return Err("이 위젯은 대화에서 자동으로 열 수 없어요.".into());
    }
    if instance.revision != guard.expected_revision
        || !crate::app::is_current(state, guard.epoch, guard.cancel)
    {
        return Err("대화 또는 위젯 상태가 바뀌어 열지 않았어요.".into());
    }
    Ok(())
}

pub(crate) async fn open_widget_for_conversation(
    app: &tauri::AppHandle,
    state: &AppState,
    id: &str,
    expected_revision: i64,
    epoch: u64,
    cancel: &AtomicBool,
) -> Result<Value, String> {
    if !crate::app::is_current(state, epoch, cancel) {
        return Err("대화가 바뀌어 위젯을 열지 않았어요.".into());
    }
    let managed = app.state::<Arc<AppState>>();
    let guard = ConversationOpen {
        expected_revision,
        epoch,
        cancel,
    };
    open_widget_inner(app, managed.inner(), id, None, Some(&guard)).await?;
    Ok(serde_json::json!({"opened":true,"widgetId":id,"revision":expected_revision}))
}

fn validate_open_widget(
    state: &AppState,
    instance: &widgets::WidgetInstance,
    launcher: Option<(i64, u64)>,
) -> Result<(), String> {
    if widgets::is_retired(&instance.kind) {
        return Err("위젯을 찾지 못했어요.".into());
    }
    if let Some((revision, session)) = launcher {
        crate::app::launcher::validate_session(state, session)?;
        if instance.revision != revision {
            return Err(
                "위젯 상태가 바뀌었어요. 최신 검색 결과를 확인하고 다시 실행해 주세요.".into(),
            );
        }
    }
    Ok(())
}

fn create_memo_for_open(
    state: &AppState,
    id: &str,
    launcher: Option<(i64, u64)>,
) -> Result<WidgetSnapshot, String> {
    change(state, |db| {
        let current = storage::get(db, id)?;
        validate_open_widget(state, &current, launcher)?;
        if let Some((_, session)) = launcher {
            crate::app::launcher::accept_execution(state, session)?;
        }
        crate::widgets::memo_notes::create_note(db, id)
    })
}

fn planner_tab_for_widget(kind: &str) -> Option<&'static str> {
    match kind {
        "todo" => Some("todos"),
        "calendar" => Some("calendar"),
        "preparation" => Some("envelopes"),
        _ => None,
    }
}

async fn open_widget_inner(
    app: &tauri::AppHandle,
    state: &Arc<AppState>,
    id: &str,
    launcher: Option<(i64, u64)>,
    conversation: Option<&ConversationOpen<'_>>,
) -> Result<(), String> {
    uuid::Uuid::parse_str(id).map_err(|_| "위젯 식별자가 올바르지 않아요.".to_string())?;
    let (instance, open_intent) = change(state, |db| {
        let instance = storage::get(db, id)?;
        validate_open_widget(state, &instance, launcher)?;
        validate_conversation_open(state, &instance, conversation)?;
        let intent = if instance.kind == "music" {
            Some(begin_widget_open(state, id)?)
        } else {
            None
        };
        Ok((instance, intent))
    })?;
    if instance.kind == "memo" {
        let snapshot = create_memo_for_open(state, id, launcher)?;
        crate::widgets::memo_notes::reveal_created_note(app, state, id, snapshot).await?;
        return Ok(());
    }
    if instance.kind == "travel" {
        if let Some((_, session)) = launcher {
            change(state, |_| {
                crate::app::launcher::accept_execution(state, session)
            })?;
        }
        return crate::widgets::planning::windows::open_travel(app.clone(), None).await;
    }
    if crate::behavior::DESKTOP_TOYS.contains(&instance.kind.as_str()) {
        let token = crate::desktop::toys::launch_token(app, id)?;
        let geometry = crate::desktop::toys::current_geometry(app).await?;
        return change(state, |db| {
            let current = storage::get(db, id)?;
            validate_open_widget(state, &current, launcher)?;
            validate_conversation_open(state, &current, conversation)?;
            crate::desktop::toys::validate_launch(app, id, token)?;
            if let Some((_, session)) = launcher {
                crate::app::launcher::accept_execution(state, session)?;
            }
            crate::desktop::toys::open(
                app,
                &current.id,
                &current.kind,
                None,
                current.revision,
                false,
                &geometry,
            )?;
            Ok(())
        });
    }
    if crate::widgets::connection_host::spotify_widget(&instance) {
        let _ = crate::widgets::connection_host::prepare_music_widget(app, state, id, true).await;
    }
    // The widget may have been disabled or removed while the OS was launching Spotify.
    let _action = lock(&state.action)?;
    if crate::unavailable(state) {
        return Err("앱을 정리하고 있어요.".into());
    }
    if let Some(intent) = &open_intent {
        widget_open_current(state, id, intent)?;
    }
    let current = {
        let db = lock(&state.db)?;
        current_events(state, &db)?;
        let current = storage::get(&db, id)?;
        validate_open_widget(state, &current, launcher)?;
        validate_conversation_open(state, &current, conversation)?;
        current
    };
    if let Some((_, session)) = launcher {
        crate::app::launcher::accept_execution(state, session)?;
    }
    if let Some(tab) = planner_tab_for_widget(&current.kind) {
        return crate::widgets::planning::windows::open(app, tab);
    }
    let label = format!("widget-{id}");
    if let Some(window) = app.get_webview_window(&label) {
        window.unminimize().map_err(|error| error.to_string())?;
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        crate::widgets::runtime::refresh(app);
        return Ok(());
    }
    let floating = matches!(
        current.kind.as_str(),
        "music"
            | "focus-timer"
            | "interaction"
            | "small-match"
            | "fortune"
            | "guessing"
            | "fishing"
            | "plant"
            | "completion-jar"
            | "device"
            | "ball"
            | "paper-plane"
            | "bubbles"
    );
    let window = tauri::WebviewWindowBuilder::new(
        app,
        label,
        tauri::WebviewUrl::App(format!("index.html?view=widget&id={id}").into()),
    )
    .title(format!(
        "comet · {}",
        widgets::manifest(&current.kind)?.name
    ))
    .inner_size(
        match current.kind.as_str() {
            "music" => 370.0,
            "focus-timer" => 946.0,
            "interaction" | "small-match" | "fortune" | "guessing" | "fishing" | "plant"
            | "completion-jar" | "device" | "ball" | "paper-plane" | "bubbles" => 330.0,
            _ => 360.0,
        },
        match current.kind.as_str() {
            "music" => 310.0,
            "focus-timer" => 580.0,
            "interaction" => 250.0,
            "small-match" | "guessing" => 430.0,
            "fishing" => 380.0,
            "plant" => 360.0,
            "completion-jar" | "device" => 240.0,
            "fortune" => 340.0,
            "ball" | "paper-plane" | "bubbles" => 400.0,
            _ => 480.0,
        },
    )
    .min_inner_size(
        if current.kind == "music" {
            370.0
        } else if current.kind == "focus-timer" {
            310.0
        } else {
            296.0
        },
        if current.kind == "music" {
            310.0
        } else if current.kind == "focus-timer" {
            56.0
        } else if current.kind == "interaction" {
            250.0
        } else {
            220.0
        },
    )
    .transparent(true)
    .shadow(!floating)
    .always_on_top(floating)
    .skip_taskbar(floating)
    .decorations(false)
    .disable_drag_drop_handler()
    .maximizable(false)
    .visible(open_intent.is_none())
    .focused(open_intent.is_none())
    .build()
    .map_err(|error| error.to_string())?;
    if let Some(intent) = &open_intent {
        if let Err(error) = widget_open_current(state, id, intent) {
            let _ = window.destroy();
            return Err(error);
        }
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
    }
    crate::widgets::runtime::refresh(app);
    Ok(())
}

#[tauri::command]
pub(crate) async fn close_widget(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), String> {
    uuid::Uuid::parse_str(&id).map_err(|_| "위젯 식별자가 올바르지 않아요.".to_string())?;
    let _action = lock(&state.action)?;
    cancel_widget_opens(&state, Some(&id))?;
    if let Some(window) = app.get_webview_window(&format!("widget-{id}")) {
        window.destroy().map_err(|error| error.to_string())?;
    }
    crate::widgets::runtime::refresh(&app);
    Ok(())
}

pub(crate) fn advance_widgets(app: &tauri::AppHandle, state: &AppState) -> Result<(), String> {
    let (changed, usage_changed) = change(state, |db| {
        let timestamp = chrono::Utc::now().timestamp_millis();
        let usage_changed = advance_app_usage(state, db, timestamp)?;
        let continuous = lock(&state.widget_clocks)?
            .get("focus-completions")
            .is_some_and(|previous| timestamp >= *previous && timestamp - *previous <= 120_000);
        let changed = storage::advance_with_continuity(db, timestamp, continuous)?;
        let quiet = lock(&state.runtime)?.paused
            || crate::app::quiet_hours::automatic_blocked(state, &store::settings(db)?)?;
        let alerted =
            widgets::reminders::advance(db, &mut *lock(&state.widget_clocks)?, timestamp, quiet)?;
        let runtime = lock(&state.runtime)?;
        if state.launcher_open.load(Ordering::SeqCst)
            || runtime.hidden
            || !store::settings(db)?.autonomous_enabled
        {
            storage::discard_pending(db)?;
        }
        drop(runtime);
        hold_for_focus(state, db)?;
        if changed || alerted.changed {
            cancel_stale_widget_scene(state, db)?;
        }
        for delivery in alerted.os {
            // OS delivery has its own opt-in and survives a hidden character balloon.
            crate::widgets::planning::notifications::deliver(
                app,
                delivery,
                timestamp,
                state.epoch.load(Ordering::SeqCst),
            );
        }
        Ok((changed || alerted.changed, usage_changed))
    })?;
    if changed {
        publish(app, state);
        publish_widgets(app, state);
    } else if usage_changed {
        // Telemetry must not cancel scenes, refresh native menus, or publish chat history.
        let snapshot = storage::snapshot(&*lock(&state.db)?)?;
        let _ = app.emit("widgets-state", snapshot);
    }
    Ok(())
}

/// Caller holds action and db. Share eligibility and queue consumption with the scheduler tests.
pub(crate) fn take_pending_reaction(
    state: &AppState,
    db: &rusqlite::Connection,
) -> Result<Option<WidgetEvent>, String> {
    if crate::unavailable(state) {
        return Ok(None);
    }
    let status = lock(&state.runtime)?.clone();
    current_events(state, db)?;
    if state.launcher_open.load(Ordering::SeqCst)
        || status.hidden
        || !store::settings(db)?.autonomous_enabled
    {
        storage::discard_pending(db)?;
        return Ok(None);
    }
    if state.stopping.load(Ordering::SeqCst)
        || status.phase != "idle"
        || lock(&state.panel)?.is_some()
        || lock(&state.pack_stories)?.run.is_some()
        || now() - state.last_input.load(Ordering::SeqCst) < 3
    {
        return Ok(None);
    }
    hold_for_focus(state, db)?;
    let event = storage::take_reaction(db, chrono::Utc::now().timestamp_millis())?;
    match event {
        Some(event) if widgets::reminders::event_current(db, &event)? => Ok(Some(event)),
        _ => Ok(None),
    }
}

pub(crate) fn play_widget_reaction(
    app: &tauri::AppHandle,
    state: &Arc<AppState>,
) -> Result<bool, String> {
    let pending = {
        let _action = lock(&state.action)?;
        let db = lock(&state.db)?;
        if let Some(event) = take_pending_reaction(state, &db)? {
            if let Some(character_id) =
                crate::characters::reaction_host::widget_character(&db, &event)?
            {
                let epoch = state.epoch.load(Ordering::SeqCst);
                drop(db);
                drop(_action);
                crate::characters::reaction_host::trigger_widget(
                    app,
                    state.clone(),
                    &character_id,
                    &event,
                    epoch,
                )?;
                return Ok(true);
            }
            let token = crate::app::interrupt_with_db(state, true, &db)?;
            state.widget_epoch.store(token.0, Ordering::SeqCst);
            *lock(&state.widget_playback)? = Some(event.clone());
            state.last_input.store(now(), Ordering::SeqCst);
            let (lines, source) = match crate::talk::host::prepare(state, &db, Some(&event))? {
                Some(lines) => (lines, "talk"),
                None => match fallback_reaction(&db, &event)? {
                    Some(lines) => (lines, "widget"),
                    None => {
                        *lock(&state.widget_playback)? = None;
                        return Ok(false);
                    }
                },
            };
            Some((event.id, token, lines, source))
        } else {
            None
        }
    };
    let Some((event_id, token, lines, source)) = pending else {
        return Ok(false);
    };
    start_scene(
        app.clone(),
        state.clone(),
        lines,
        source,
        token,
        Some(event_id),
    );
    Ok(true)
}

fn fallback_reaction(
    db: &rusqlite::Connection,
    event: &WidgetEvent,
) -> Result<Option<Vec<SceneLine>>, String> {
    // Any roster size: the Nadir/Byulkkori pair skips raw widget text wherever the two sit.
    let members = crate::characters::active_members(db)?;
    let has = |source: &str| {
        members
            .iter()
            .any(|member| member.definition.source_id == source)
    };
    if has("nadir") && has("star-tail") && !event.event.kind.starts_with("planner-") {
        return Ok(None);
    }
    Ok(Some(vec![SceneLine {
        motion: Default::default(),
        persona: "a".into(),
        expression: "평온".into(),
        text: event.event.text.clone(),
    }]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn widget_navigation_opens_the_matching_planner_destination() {
        assert_eq!(planner_tab_for_widget("todo"), Some("todos"));
        assert_eq!(planner_tab_for_widget("calendar"), Some("calendar"));
        assert_eq!(planner_tab_for_widget("preparation"), Some("envelopes"));
        for kind in ["memo", "clock", "weather", "music", "focus-timer"] {
            assert_eq!(planner_tab_for_widget(kind), None);
        }
    }

    #[test]
    fn created_widget_item_id_is_recovered_on_replay_without_duplicate_items() {
        let db = rusqlite::Connection::open_in_memory().unwrap();
        storage::initialize(&db).unwrap();
        let directory = tempfile::tempdir().unwrap();
        storage::verify_packages(&db, directory.path()).unwrap();
        for (kind, action, field) in [
            ("todo", "add", "items"),
            ("preparation", "create", "envelopes"),
        ] {
            let instance = storage::instances(&db)
                .unwrap()
                .into_iter()
                .find(|item| item.kind == kind)
                .unwrap();
            let first = WidgetRequest {
                request_id: uuid::Uuid::new_v4().to_string(),
                instance_id: instance.id.clone(),
                expected_revision: instance.revision,
                action: action.into(),
                input: serde_json::json!({"title":"먼저 만든 내용"}),
            };
            storage::execute(&db, &first, 1000, 1).unwrap();
            let before = storage::get(&db, &instance.id).unwrap();
            let created = WidgetRequest {
                request_id: uuid::Uuid::new_v4().to_string(),
                expected_revision: before.revision,
                input: serde_json::json!({"title":"이번에 만든 내용"}),
                ..first
            };
            let id = execute_with_created_id(&db, &created, 2000, 2)
                .unwrap()
                .unwrap();
            let after = storage::get(&db, &instance.id).unwrap();
            assert_ne!(before.data[field][0]["id"], id);
            assert_eq!(after.data[field][1]["id"], id);
            assert_eq!(after.data[field][1]["title"], "이번에 만든 내용");
            assert_eq!(
                execute_with_created_id(&db, &created, 3000, 3).unwrap(),
                Some(id.clone())
            );
            assert_eq!(storage::get(&db, &instance.id).unwrap().data, after.data);
            let update = WidgetRequest {
                request_id: uuid::Uuid::new_v4().to_string(),
                expected_revision: after.revision,
                action: "update".into(),
                input: serde_json::json!({"id":id,"title":"수정한 내용"}),
                ..created
            };
            assert_eq!(
                execute_with_created_id(&db, &update, 4000, 4).unwrap(),
                None
            );
            assert_eq!(
                storage::get(&db, &instance.id).unwrap().data[field][1]["title"],
                "수정한 내용"
            );
        }
    }

    #[test]
    fn preparation_creation_rejection_preserves_data_and_allows_an_edited_request() {
        for events in [
            serde_json::json!([{"id":"event","title":"모임","connectionId":"local","cancelled":true}]),
            serde_json::json!([]),
        ] {
            let db = rusqlite::Connection::open_in_memory().unwrap();
            storage::initialize(&db).unwrap();
            let directory = tempfile::tempdir().unwrap();
            storage::verify_packages(&db, directory.path()).unwrap();
            let instances = storage::instances(&db).unwrap();
            let preparation = instances
                .iter()
                .find(|item| item.kind == "preparation")
                .unwrap();
            let todo = instances.iter().find(|item| item.kind == "todo").unwrap();
            let calendar = instances
                .iter()
                .find(|item| item.kind == "calendar")
                .unwrap();
            let mut calendar_data = calendar.data.clone();
            calendar_data["events"] = events;
            storage::commit_data(
                &db,
                &calendar.id,
                calendar.revision,
                calendar_data,
                vec![],
                1,
            )
            .unwrap();
            let request = WidgetRequest {
                request_id: uuid::Uuid::new_v4().to_string(),
                instance_id: preparation.id.clone(),
                expected_revision: preparation.revision,
                action: "create".into(),
                input: serde_json::json!({
                    "title":"모임 준비","eventId":"event","eventLabel":"모임",
                    "checks":["카메라"],"tasks":[{"title":"예약 확인"}]
                }),
            };
            let error = execute_with_created_id(&db, &request, 100, 1).unwrap_err();
            assert_eq!(
                error,
                "PREPARATION_CREATE_REJECTED:현재 조회할 수 있는 일정을 선택해 주세요."
            );
            assert_eq!(
                storage::get(&db, &preparation.id).unwrap().data,
                preparation.data
            );
            assert_eq!(storage::get(&db, &todo.id).unwrap().data, todo.data);
            for table in ["widget_requests", "widget_request_results"] {
                let count: i64 = db
                    .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
                        row.get(0)
                    })
                    .unwrap();
                assert_eq!(count, 0);
            }
            let edited = WidgetRequest {
                request_id: uuid::Uuid::new_v4().to_string(),
                input: serde_json::json!({
                    "title":"모임 준비","checks":["카메라"],"tasks":[{"title":"예약 확인"}]
                }),
                ..request.clone()
            };
            let id = execute_with_created_id(&db, &edited, 200, 2)
                .unwrap()
                .unwrap();
            let saved = storage::get(&db, &preparation.id).unwrap();
            assert_eq!(saved.data["envelopes"][0]["id"], id);
            assert_eq!(saved.data["envelopes"][0]["checks"][0]["text"], "카메라");
            assert_eq!(
                storage::get(&db, &todo.id).unwrap().data["items"]
                    .as_array()
                    .unwrap()
                    .len(),
                1
            );
            let stale = WidgetRequest {
                request_id: uuid::Uuid::new_v4().to_string(),
                ..edited
            };
            assert!(execute_with_created_id(&db, &stale, 300, 3)
                .unwrap_err()
                .starts_with("PREPARATION_CREATE_REJECTED:"));
            assert_eq!(storage::get(&db, &preparation.id).unwrap().data, saved.data);
        }
    }

    #[test]
    fn preparation_creation_receipt_replays_before_changed_event_and_revision_validation() {
        let db = rusqlite::Connection::open_in_memory().unwrap();
        storage::initialize(&db).unwrap();
        let directory = tempfile::tempdir().unwrap();
        storage::verify_packages(&db, directory.path()).unwrap();
        let instances = storage::instances(&db).unwrap();
        let preparation = instances
            .iter()
            .find(|item| item.kind == "preparation")
            .unwrap();
        let todo = instances.iter().find(|item| item.kind == "todo").unwrap();
        let calendar = instances
            .iter()
            .find(|item| item.kind == "calendar")
            .unwrap();
        let mut data = calendar.data.clone();
        data["events"] = serde_json::json!([{"id":"event","title":"모임","connectionId":"local"}]);
        storage::commit_data(&db, &calendar.id, calendar.revision, data, vec![], 1).unwrap();
        let request = WidgetRequest {
            request_id: uuid::Uuid::new_v4().to_string(),
            instance_id: preparation.id.clone(),
            expected_revision: preparation.revision,
            action: "create".into(),
            input: serde_json::json!({
                "title":"모임 준비","eventId":"event","eventLabel":"모임",
                "tasks":[{"title":"예약 확인"}]
            }),
        };
        let id = execute_with_created_id(&db, &request, 100, 1)
            .unwrap()
            .unwrap();
        let saved = storage::get(&db, &preparation.id).unwrap().data;
        let tasks = storage::get(&db, &todo.id).unwrap().data;
        for events in [
            serde_json::json!([{"id":"event","title":"모임","connectionId":"local","cancelled":true}]),
            serde_json::json!([]),
        ] {
            let current = storage::get(&db, &calendar.id).unwrap();
            let mut data = current.data;
            data["events"] = events;
            storage::commit_data(&db, &calendar.id, current.revision, data, vec![], 200).unwrap();
            assert_eq!(
                execute_with_created_id(&db, &request, 300, 3).unwrap(),
                Some(id.clone())
            );
            assert_eq!(storage::get(&db, &preparation.id).unwrap().data, saved);
            assert_eq!(storage::get(&db, &todo.id).unwrap().data, tasks);
        }
        let mut changed = request.clone();
        changed.input["title"] = serde_json::json!("다른 입력");
        let error = execute_with_created_id(&db, &changed, 400, 4).unwrap_err();
        assert_eq!(error, "이미 사용한 요청 식별자의 내용이 달라졌어요.");
        assert_eq!(
            execute_with_created_id(&db, &request, 500, 5).unwrap(),
            Some(id)
        );
    }

    #[test]
    fn launcher_widget_dispatch_rejects_changed_or_disabled_preview() {
        let state = crate::app::tests::state();
        let instance = widgets::WidgetInstance {
            id: uuid::Uuid::new_v4().to_string(),
            kind: "ball".into(),
            version: 1,
            revision: 3,
            data: serde_json::json!({}),
            error: None,
        };
        state.launcher_open.store(true, Ordering::SeqCst);
        assert!(validate_open_widget(&state, &instance, Some((3, 0))).is_ok());
        assert!(validate_open_widget(&state, &instance, Some((2, 0))).is_err());
        assert!(validate_open_widget(&state, &instance, Some((3, 1))).is_err());
    }

    #[test]
    fn memo_open_creates_a_detached_sheet_only_for_the_current_launcher_preview() {
        let directory = tempfile::tempdir().unwrap();
        let mut state = crate::app::tests::state();
        state.app_data = directory.path().into();
        let first = change(&state, |db| {
            storage::verify_packages(db, &state.app_data)?;
            storage::instances(db)?.into_iter().find(|widget| widget.kind == "memo").ok_or("메모 위젯이 없어요".into())
        })
        .unwrap();
        let created = create_memo_for_open(&state, &first.id, None).unwrap();
        let note = &created.widgets.iter().find(|widget| widget.instance.id == first.id).unwrap().instance.data["notes"][0];
        assert_eq!(note["isOpen"], true);
        let note_id = note["id"].clone();
        change(&state, |db| {
            let current = storage::get(db, &first.id)?;
            storage::execute(
                db,
                &WidgetRequest {
                    request_id: uuid::Uuid::new_v4().to_string(),
                    instance_id: first.id.clone(),
                    expected_revision: current.revision,
                    action: "update".into(),
                    input: serde_json::json!({"id":note_id,"body":"  원문\n  보존","isOpen":false}),
                },
                1,
                0,
            )
        })
        .unwrap();
        let before = storage::get(&lock(&state.db).unwrap(), &first.id).unwrap();
        state.launcher_open.store(true, Ordering::SeqCst);
        assert!(create_memo_for_open(&state, &first.id, Some((first.revision, 0))).is_err());
        assert!(create_memo_for_open(&state, &first.id, Some((before.revision, 1))).is_err());
        let result = create_memo_for_open(&state, &first.id, Some((before.revision, 0))).unwrap();
        let notes = result.widgets.iter().find(|widget| widget.instance.id == first.id).unwrap().instance.data["notes"].as_array().unwrap();
        assert_eq!(notes.len(), 2);
        assert_eq!(notes[0], before.data["notes"][0]);
        assert_eq!(notes[1]["isOpen"], true);
        assert!(create_memo_for_open(&state, &first.id, Some((before.revision, 0))).is_err());
        assert_eq!(
            storage::get(&lock(&state.db).unwrap(), &first.id)
                .unwrap()
                .data["notes"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
    }

    #[test]
    fn addon_pair_skips_raw_widget_notifications_while_default_and_custom_keep_fallback() {
        let db = store::open(std::path::Path::new(":memory:")).unwrap();
        let event = WidgetEvent {
            id: "test-event".into(),
            instance_id: "timer".into(),
            widget_kind: "focus-timer".into(),
            revision: 0,
            created_at: 0,
            expires_at: 10_000,
            event: widgets::EventDraft {
                kind: "timer-finished".into(),
                text: "원본 위젯 알림".into(),
                payload: serde_json::json!({}),
            },
        };
        let lines = fallback_reaction(&db, &event).unwrap().unwrap();
        assert_eq!(lines[0].text, event.event.text);
        let imported =
            crate::characters::import_pack(&db, &crate::characters::nadir_pack()).unwrap();
        crate::characters::apply_pair(&db, [imported[0].id.clone(), imported[1].id.clone()])
            .unwrap();
        assert!(fallback_reaction(&db, &event).unwrap().is_none());
        crate::characters::apply_pair(&db, [imported[1].id.clone(), imported[0].id.clone()])
            .unwrap();
        assert!(fallback_reaction(&db, &event).unwrap().is_none());
        let character = crate::characters::active_character(&db, "a").unwrap();
        let mut definition = character.definition;
        definition.source_id = "custom".into();
        db.execute(
            "UPDATE characters SET data=?1 WHERE id=?2",
            rusqlite::params![serde_json::to_string(&definition).unwrap(), character.id],
        )
        .unwrap();
        let lines = fallback_reaction(&db, &event).unwrap().unwrap();
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].persona, "a");
        assert_eq!(lines[0].text, event.event.text);
    }
}

const FOCUS_RESIZE_DURATION: std::time::Duration = std::time::Duration::from_millis(280);

fn focus_resize_target(
    current: tauri::PhysicalSize<u32>,
    scale: f64,
    expanded: bool,
    collapsed: bool,
    height: Option<f64>,
) -> tauri::PhysicalSize<u32> {
    let width = if collapsed || !expanded { 310.0 } else { 946.0 };
    let minimum = if collapsed {
        56.0
    } else if expanded {
        547.0
    } else {
        376.0
    };
    let height = if collapsed {
        56.0
    } else {
        height
            .filter(|value| value.is_finite())
            .map(|value| value.clamp(minimum, 2000.0))
            .unwrap_or((f64::from(current.height) / scale).max(minimum))
    };
    tauri::PhysicalSize::new(
        (width * scale).round() as u32,
        (height * scale).ceil() as u32,
    )
}

fn focus_resize_frame(
    start: tauri::PhysicalSize<u32>,
    target: tauri::PhysicalSize<u32>,
    elapsed: std::time::Duration,
) -> tauri::PhysicalSize<u32> {
    let progress = (elapsed.as_secs_f64() / FOCUS_RESIZE_DURATION.as_secs_f64()).min(1.0);
    let eased = 1.0 - (1.0 - progress).powi(3);
    let interpolate = |from: u32, to: u32| {
        (f64::from(from) + (f64::from(to) - f64::from(from)) * eased).round() as u32
    };
    tauri::PhysicalSize::new(
        interpolate(start.width, target.width),
        interpolate(start.height, target.height),
    )
}

async fn apply_focus_window_size(
    window: &tauri::WebviewWindow,
    size: tauri::PhysicalSize<u32>,
    position: tauri::PhysicalPosition<i32>,
) -> Result<(), String> {
    let (send, receive) = tokio::sync::oneshot::channel();
    let resizing = window.clone();
    window
        .run_on_main_thread(move || {
            let result = resizing
                .set_size(size)
                .and_then(|()| resizing.set_position(position))
                .map_err(|error| error.to_string());
            let _ = send.send(result);
        })
        .map_err(|error| error.to_string())?;
    receive.await.map_err(|error| error.to_string())?
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn set_focus_expanded(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
    expanded: bool,
    animate: Option<bool>,
    collapsed: Option<bool>,
    height: Option<f64>,
    auto_fit: Option<bool>,
) -> Result<(), String> {
    change(&state, |db| {
        let instance = storage::get(db, &id)?;
        if instance.kind != "focus-timer" {
            return Err("집중 타이머를 찾지 못했어요.".into());
        }
        Ok(())
    })?;
    // Native geometry queries wait for the main thread, which can be waiting for this DB.
    let window = app
        .get_webview_window(&format!("widget-{id}"))
        .ok_or("집중 타이머 창을 찾을 수 없어요.")?;
    let start = window.inner_size().map_err(|error| error.to_string())?;
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let collapsed = collapsed.unwrap_or(false);
    let mut target = focus_resize_target(start, scale, expanded, collapsed, height);
    if auto_fit.unwrap_or(false) && !collapsed {
        target.width = target.width.max(start.width);
    }
    // Intermediate widths must remain below the expanded minimum until the final frame.
    window
        .set_min_size(Some(tauri::LogicalSize::new(310.0, 56.0)))
        .map_err(|error| error.to_string())?;
    if animate.unwrap_or(true) && start != target {
        let started = std::time::Instant::now();
        loop {
            let elapsed = started.elapsed();
            if elapsed >= FOCUS_RESIZE_DURATION {
                break;
            }
            apply_focus_window_size(
                &window,
                focus_resize_frame(start, target, elapsed),
                position,
            )
            .await?;
            tokio::time::sleep(std::time::Duration::from_millis(16)).await;
        }
    }
    apply_focus_window_size(&window, target, position).await?;
    if expanded && !collapsed {
        window
            .set_min_size(Some(tauri::LogicalSize::new(946.0, 547.0)))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod focus_resize_tests {
    use super::{focus_resize_frame, focus_resize_target, FOCUS_RESIZE_DURATION};
    use tauri::PhysicalSize;

    #[test]
    fn resize_targets_preserve_height_and_apply_expanded_minimum_at_display_scale() {
        assert_eq!(
            focus_resize_target(PhysicalSize::new(1892, 1500), 2.0, false, false, None),
            PhysicalSize::new(620, 1500)
        );
        assert_eq!(
            focus_resize_target(PhysicalSize::new(620, 1500), 2.0, true, false, None),
            PhysicalSize::new(1892, 1500)
        );
        assert_eq!(
            focus_resize_target(PhysicalSize::new(475, 650), 1.25, true, false, None),
            PhysicalSize::new(1183, 684)
        );
    }

    #[test]
    fn compact_focus_uses_the_design_size_and_rejects_non_finite_height() {
        assert_eq!(
            focus_resize_target(PhysicalSize::new(946, 700), 1.0, true, true, None),
            PhysicalSize::new(310, 56)
        );
        assert_eq!(
            focus_resize_target(
                PhysicalSize::new(310, 56),
                1.0,
                false,
                false,
                Some(f64::NAN)
            ),
            PhysicalSize::new(310, 376)
        );
        assert_eq!(
            focus_resize_target(PhysicalSize::new(310, 56), 1.0, true, false, Some(10.0)),
            PhysicalSize::new(946, 547)
        );
        assert_eq!(
            focus_resize_target(PhysicalSize::new(620, 752), 2.0, true, false, Some(547.0)),
            PhysicalSize::new(1892, 1094)
        );
    }

    #[test]
    fn resizing_moves_monotonically_without_overshoot_in_both_directions() {
        for (start, target) in [
            (PhysicalSize::new(380, 520), PhysicalSize::new(840, 620)),
            (PhysicalSize::new(840, 700), PhysicalSize::new(380, 700)),
        ] {
            let mut previous = start;
            for step in 0..=20 {
                let next = focus_resize_frame(start, target, FOCUS_RESIZE_DURATION * step / 20);
                if target.width > start.width {
                    assert!((previous.width..=target.width).contains(&next.width));
                } else {
                    assert!((target.width..=previous.width).contains(&next.width));
                }
                assert!((previous.height..=target.height).contains(&next.height));
                previous = next;
            }
            assert_eq!(previous, target);
            assert_eq!(
                focus_resize_frame(start, target, FOCUS_RESIZE_DURATION * 2),
                target
            );
        }
    }
}

#[tauri::command]
pub(crate) fn set_music_expanded(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
    expanded: bool,
) -> Result<(), String> {
    change(&state, |db| {
        let instance = storage::get(db, &id)?;
        if instance.kind != "music" {
            return Err("음악 위젯을 찾지 못했어요.".into());
        }
        let window = app
            .get_webview_window(&format!("widget-{id}"))
            .ok_or("음악 창을 찾을 수 없어요.")?;
        window
            .set_min_size(Some(tauri::LogicalSize::new(
                370.0,
                if expanded { 520.0 } else { 310.0 },
            )))
            .map_err(|error| error.to_string())?;
        window
            .set_size(tauri::LogicalSize::new(
                if expanded { 720.0 } else { 370.0 },
                if expanded { 730.0 } else { 310.0 },
            ))
            .map_err(|error| error.to_string())
    })
}

// Called with action + db locked: no sample can be applied after a newer timer action.
fn advance_app_usage(state: &AppState, db: &rusqlite::Connection, at: i64) -> Result<bool, String> {
    let timers: Vec<_> = storage::instances(db)?
        .into_iter()
        .filter(|instance| {
            instance.kind == "focus-timer" && crate::app_usage::tracking::enabled(&instance.data)
        })
        .collect();
    let mut tracker = lock(&state.app_usage_tracker)?;
    tracker.retain(
        &timers
            .iter()
            .map(|timer| timer.id.clone())
            .collect::<Vec<_>>(),
    );
    let preferences = crate::behavior::preferences(db)?;
    let instant = std::time::Instant::now();
    if !preferences.activity_enabled {
        lock(&state.life)?.activity.clear();
    }
    let activity_due = preferences.activity_enabled && lock(&state.life)?.activity.due(instant);
    if timers.is_empty() {
        tracker.clear();
        if !activity_due {
            return Ok(false);
        }
    }
    let sample = if activity_due {
        let sample = crate::app_usage::detailed_sample();
        let focus_sample = sample.sample.clone();
        lock(&state.life)?
            .activity
            .observe(sample, &preferences.activity_excluded_apps, instant);
        focus_sample
    } else {
        crate::app_usage::sample()
    };
    let mut changed = false;
    for timer in timers {
        if let Some(data) = tracker.observe(&timer.id, &timer.data, &sample, at, instant) {
            storage::save_usage_observation(db, &timer.id, timer.revision, &data)?;
            changed = true;
        }
    }
    Ok(changed)
}

#[tauri::command]
pub(crate) fn list_usage_applications() -> Value {
    match crate::app_usage::applications() {
        Ok(applications) => {
            serde_json::json!({"applications":applications,"supported":true,"message":""})
        }
        Err(message) => serde_json::json!({"applications":[],"supported":false,"message":message}),
    }
}

#[cfg(test)]
mod play_tests {
    use super::*;

    fn count(db: &rusqlite::Connection, table: &str) -> i64 {
        db.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
            row.get(0)
        })
        .unwrap()
    }
    fn data(db: &rusqlite::Connection, kind: &str) -> Value {
        storage::instances(db)
            .unwrap()
            .into_iter()
            .find(|instance| instance.kind == kind)
            .unwrap()
            .data
    }

    #[test]
    fn menu_play_picks_the_game_without_playing_and_asks_for_setup_when_missing() {
        let state = crate::app::tests::state();
        let directory = tempfile::tempdir().unwrap();
        let db = lock(&state.db).unwrap();

        storage::verify_packages(&db, directory.path()).unwrap();
        let id = prepare_play(&db, "small-match", Some("coin"), 1)
            .unwrap()
            .unwrap();
        assert_eq!(storage::get(&db, &id).unwrap().kind, "small-match");
        let picked = data(&db, "small-match");
        assert_eq!(picked["game"], "coin");
        assert_eq!(picked["result"], "");
        assert_eq!(picked["rounds"], 0);
        prepare_play(&db, "guessing", Some("number"), 2)
            .unwrap()
            .unwrap();
        let started = data(&db, "guessing");
        assert_eq!(
            (started["mode"].clone(), started["playing"].clone()),
            ("number".into(), true.into())
        );
        // Reopening the same game keeps the round in progress.
        let answer = started["answer"].clone();
        prepare_play(&db, "guessing", Some("number"), 3).unwrap();
        assert_eq!(data(&db, "guessing")["answer"], answer);
        assert!(prepare_play(&db, "fortune", None, 4).unwrap().is_some());
        assert!(prepare_play(&db, "fortune", Some("dice"), 4).is_err());
        assert!(prepare_play(&db, "small-match", Some("chess"), 4).is_err());
        assert!(prepare_play(&db, "todo", None, 4).is_err());
    }

    #[test]
    fn play_results_stay_out_of_conversation_history_affinity_and_memories() {
        let state = crate::app::tests::state();
        let directory = tempfile::tempdir().unwrap();
        let db = lock(&state.db).unwrap();
        storage::verify_packages(&db, directory.path()).unwrap();
        let before = ["messages", "affinity", "memories"].map(|table| count(&db, table));
        for (kind, mode, action, input) in [
            ("small-match", Some("dice"), "dice", serde_json::json!({})),
            (
                "small-match",
                Some("rps"),
                "rps",
                serde_json::json!({"choice":"rock"}),
            ),
            (
                "guessing",
                Some("cups"),
                "guess",
                serde_json::json!({"value":1}),
            ),
            ("fortune", None, "draw", serde_json::json!({})),
        ] {
            let id = prepare_play(&db, kind, mode, 10).unwrap().unwrap();
            let revision = storage::get(&db, &id).unwrap().revision;
            storage::execute(
                &db,
                &WidgetRequest {
                    request_id: uuid::Uuid::new_v4().to_string(),
                    instance_id: id,
                    expected_revision: revision,
                    action: action.into(),
                    input,
                },
                11,
                7,
            )
            .unwrap();
        }
        assert_eq!(
            ["messages", "affinity", "memories"].map(|table| count(&db, table)),
            before
        );
    }
}
