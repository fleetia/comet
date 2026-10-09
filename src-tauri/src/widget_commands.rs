use crate::{
    app::{
        interrupt, lock, now, publish,
        scene::start_scene,
        windows::{open_settings_section, SettingsSection},
        AppState,
    },
    store,
    types::SceneLine,
    widget_backgrounds,
    widgets::{self, storage, WidgetEvent, WidgetRequest, WidgetSnapshot},
};
use serde_json::Value;
use std::sync::{atomic::Ordering, Arc};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

pub(crate) fn publish_widgets(app: &tauri::AppHandle, state: &AppState) {
    if let Ok(db) = lock(&state.db) {
        if let Ok(snapshot) = storage::snapshot(&db) {
            let _ = app.emit("widgets-state", snapshot);
        }
    }
    if crate::character_animation_states::refresh(app, state).unwrap_or(false) {
        publish(app, state);
    }
    crate::desktop_menu::refresh(app);
    crate::widget_runtime::refresh(app);
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
        store::pause_conversations(&db)?;
        let (epoch, _) = interrupt(state, false)?;
        state.widget_epoch.store(epoch, Ordering::SeqCst);
        *lock(&state.panel)? = None;
        storage::discard_pending_during_focus(&db)?;
        crate::generated_widgets::discard_pending(&db)?;
        crate::generated_widget_commands::skip_automatic_message(&db)?;
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
    if !instance.installed || !instance.enabled {
        return Err("설치하고 켠 위젯만 사용할 수 있어요.".into());
    }
    if instance.revision != expected_revision {
        return Err(
            "다른 화면에서 위젯이 변경됐어요. 최신 상태를 확인하고 다시 시도해 주세요.".into(),
        );
    }
    if !widgets::appearance::supports(&instance.kind) {
        return Err("이 위젯은 바탕화면 표시를 지원하지 않아요.".into());
    }
    Ok(())
}

fn close_widget_windows(app: &tauri::AppHandle, id: &str) -> Result<(), String> {
    for label in [format!("widget-{id}"), format!("widget-display-{id}")] {
        if let Some(window) = app.get_webview_window(&label) {
            window.destroy().map_err(|error| error.to_string())?;
        }
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
pub(crate) fn install_widgets(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    kinds: Vec<String>,
) -> Result<(), String> {
    let result = change(&state, |db| storage::install(db, &state.app_data, &kinds));
    crate::memo_notes::schedule_sync(&app);
    publish_widgets(&app, &state);
    result
}

#[tauri::command]
pub(crate) async fn set_widget_enabled(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
    enabled: bool,
) -> Result<(), String> {
    let mutation = |db: &rusqlite::Connection| {
        if !enabled {
            crate::widget_connections::clear_music_pairing(db, &id)?;
        }
        storage::set_enabled(db, &id, enabled)?;
        crate::generated_widget_commands::reset_rule_baseline(db, &id)?;
        if !enabled {
            cancel_widget_jobs(&state, Some(&id))?;
        }
        Ok(())
    };
    if enabled {
        change(&state, mutation)?;
    } else {
        crate::memo_notes::with_flushed_notes(&app, &state, &id, mutation).await?;
    }
    crate::memo_notes::schedule_sync(&app);
    if !enabled {
        crate::desktop_toys::remove_widget(&app, &id);
        cancel_widget_scene(&app, &state)?;
        close_widget_windows(&app, &id)?;
    }
    publish_widgets(&app, &state);
    Ok(())
}

#[tauri::command]
pub(crate) async fn remove_widget(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
    delete_data: bool,
) -> Result<(), String> {
    crate::memo_notes::with_flushed_notes(&app, &state, &id, |db| {
        crate::widget_connections::clear_music_pairing(db, &id)?;
        storage::remove(db, &state.app_data, &id, delete_data)?;
        crate::generated_widget_commands::reset_rule_baseline(db, &id)?;
        cancel_widget_jobs(&state, Some(&id))
    })
    .await?;
    crate::memo_notes::schedule_sync(&app);
    cancel_widget_scene(&app, &state)?;
    crate::desktop_toys::remove_widget(&app, &id);
    close_widget_windows(&app, &id)?;
    publish_widgets(&app, &state);
    Ok(())
}

pub(crate) fn cancel_widget_scene(app: &tauri::AppHandle, state: &AppState) -> Result<(), String> {
    {
        let _action = lock(&state.action)?;
        let has_scene = lock(&state.widget_playback)?.is_some();
        let has_talk = lock(&state.talk_playback)?.is_some();
        let db = lock(&state.db)?;
        if (has_scene && !widget_event_current(state, &db)?)
            || (has_talk && !crate::talk_host::current(state, &db)?)
        {
            let token = interrupt(state, true)?;
            state.widget_epoch.store(token.0, Ordering::SeqCst);
            let mut runtime = lock(&state.runtime)?;
            runtime.phase = crate::types::RuntimePhase::Idle;
            runtime.persona = None;
        }
    }
    publish(app, state);
    Ok(())
}

pub(crate) fn cancel_widget_jobs(state: &AppState, id: Option<&str>) -> Result<(), String> {
    if let Some(id) = id {
        crate::music_bridge::revoke(id);
    } else {
        crate::music_bridge::revoke_all();
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
        return crate::generated_widget_commands::event_current(db, event);
    }
    let all = storage::instances(db)?;
    Ok(event.expires_at > chrono::Utc::now().timestamp_millis()
        && widgets::reminders::event_current(db, event)?
        && all.iter().any(|instance| {
            instance.id == event.instance_id
                && instance.installed
                && instance.enabled
                && instance.revision == event.revision
        })
        && widgets::manifest(&event.widget_kind)?
            .required
            .iter()
            .all(|kind| {
                all.iter().any(|instance| {
                    instance.kind == *kind && instance.installed && instance.enabled
                })
            }))
}

#[tauri::command]
pub(crate) async fn execute_widget(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    request: WidgetRequest,
) -> Result<Option<String>, String> {
    if matches!(request.action.as_str(), "desktop-open" | "desktop-clear") {
        let launch = if request.action == "desktop-open" {
            let token = crate::desktop_toys::launch_token(&app, &request.instance_id)?;
            Some((token, crate::desktop_toys::current_geometry(&app).await?))
        } else {
            None
        };
        return change(&state, |db| {
            let instance = storage::get(db, &request.instance_id)?;
            if !instance.installed
                || !instance.enabled
                || instance.revision != request.expected_revision
                || !crate::behavior::TOYS.contains(&instance.kind.as_str())
            {
                return Err("장난감 상태가 바뀌었어요. 다시 열어 주세요.".into());
            }
            if let Some((token, geometry)) = &launch {
                crate::desktop_toys::validate_launch(&app, &instance.id, *token)?;
                crate::desktop_toys::open(
                    &app,
                    &instance.id,
                    &instance.kind,
                    None,
                    instance.revision,
                    false,
                    geometry,
                )?;
            } else {
                crate::desktop_toys::remove_widget(&app, &instance.id);
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
    crate::memo_notes::schedule_sync(&app);
    // New state can invalidate an already playing reaction to this widget.
    if let Err(error) = cancel_widget_scene(&app, &state) {
        if created_id.is_none() {
            return Err(error);
        }
        eprintln!("위젯 내용 저장 후 반응 갱신 실패: {error}");
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
    let before = if matches!(request.action.as_str(), "add" | "create") {
        storage::get(db, &request.instance_id).ok()
    } else {
        None
    };
    storage::execute(db, request, now, entropy)?;
    let Some(before) = before else {
        return Ok(None);
    };
    let field = match (before.kind.as_str(), request.action.as_str()) {
        ("todo", "add") => "items",
        ("preparation", "create") => "envelopes",
        _ => return Ok(None),
    };
    let previous_ids: std::collections::BTreeSet<&str> = before.data[field]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| item["id"].as_str())
        .collect();
    let after = storage::get(db, &request.instance_id)?;
    Ok(after.data[field]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| item["id"].as_str())
        .find(|id| !previous_ids.contains(id))
        .map(str::to_owned))
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
    crate::memo_notes::schedule_sync(&app);
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
        .add_filter("이미지", &widget_backgrounds::EXTENSIONS)
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
    let bytes = tauri::async_runtime::spawn_blocking(move || widget_backgrounds::read_file(&path))
        .await
        .map_err(|error| error.to_string())??;
    change(&state, |db| {
        let tx = db
            .unchecked_transaction()
            .map_err(|error| error.to_string())?;
        let instance = storage::get(&tx, &id)?;
        active_appearance_target(&instance, expected_revision)?;
        widget_backgrounds::put(&tx, &id, &bytes)?;
        storage::bump_revision(&tx, &id, expected_revision)?;
        tx.commit().map_err(|error| error.to_string())
    })?;
    crate::memo_notes::schedule_sync(&app);
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
        if !widget_backgrounds::remove(&tx, &id)? {
            tx.commit().map_err(|error| error.to_string())?;
            return Ok(false);
        }
        storage::bump_revision(&tx, &id, expected_revision)?;
        tx.commit().map_err(|error| error.to_string())?;
        Ok(true)
    })?;
    if removed {
        crate::memo_notes::schedule_sync(&app);
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
    open_widget_inner(&app, &state, &id, None).await
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
    crate::memo_notes::schedule_sync(app);
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
    open_widget_inner(&app, state, &id, Some((expected_revision, session_id))).await
}

fn validate_open_widget(
    state: &AppState,
    instance: &widgets::WidgetInstance,
    launcher: Option<(i64, u64)>,
) -> Result<(), String> {
    if widgets::is_retired(&instance.kind) || !instance.installed || !instance.enabled {
        return Err("위젯을 설치하고 켜 주세요.".into());
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
        crate::memo_notes::create_note(db, id)
    })
}

async fn open_widget_inner(
    app: &tauri::AppHandle,
    state: &Arc<AppState>,
    id: &str,
    launcher: Option<(i64, u64)>,
) -> Result<(), String> {
    uuid::Uuid::parse_str(id).map_err(|_| "위젯 식별자가 올바르지 않아요.".to_string())?;
    let instance = change(state, |db| {
        let instance = storage::get(db, id)?;
        validate_open_widget(state, &instance, launcher)?;
        Ok(instance)
    })?;
    if instance.kind == "memo" {
        let snapshot = create_memo_for_open(state, id, launcher)?;
        crate::memo_notes::reveal_created_note(app, state, id, snapshot).await?;
        return Ok(());
    }
    if crate::behavior::TOYS.contains(&instance.kind.as_str()) {
        let token = crate::desktop_toys::launch_token(app, id)?;
        let geometry = crate::desktop_toys::current_geometry(app).await?;
        return change(state, |db| {
            let current = storage::get(db, id)?;
            validate_open_widget(state, &current, launcher)?;
            crate::desktop_toys::validate_launch(app, id, token)?;
            if let Some((_, session)) = launcher {
                crate::app::launcher::accept_execution(state, session)?;
            }
            crate::desktop_toys::open(
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
    if crate::widget_connections::spotify_widget(&instance) {
        let _ = crate::widget_connections::prepare_music_widget(app, state, id, true).await;
    }
    // The widget may have been disabled or removed while the OS was launching Spotify.
    let _action = lock(&state.action)?;
    if crate::unavailable(state) {
        return Err("앱을 정리하고 있어요.".into());
    }
    let current = {
        let db = lock(&state.db)?;
        current_events(state, &db)?;
        let current = storage::get(&db, id)?;
        validate_open_widget(state, &current, launcher)?;
        current
    };
    if let Some((_, session)) = launcher {
        crate::app::launcher::accept_execution(state, session)?;
    }
    if matches!(current.kind.as_str(), "todo" | "calendar") {
        return crate::planner_windows::open(
            app,
            if current.kind == "calendar" {
                "calendar"
            } else {
                "today"
            },
        );
    }
    let label = format!("widget-{id}");
    if let Some(window) = app.get_webview_window(&label) {
        window.unminimize().map_err(|error| error.to_string())?;
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        crate::widget_runtime::refresh(app);
        return Ok(());
    }
    tauri::WebviewWindowBuilder::new(
        app,
        label,
        tauri::WebviewUrl::App(format!("index.html?view=widget&id={id}").into()),
    )
    .title(format!(
        "comet · {}",
        widgets::manifest(&current.kind)?.name
    ))
    .inner_size(
        if current.kind == "music" {
            440.0
        } else if current.kind == "focus-timer" {
            840.0
        } else {
            360.0
        },
        if current.kind == "music" {
            340.0
        } else if current.kind == "focus-timer" {
            700.0
        } else {
            480.0
        },
    )
    .min_inner_size(
        if current.kind == "focus-timer" {
            740.0
        } else {
            296.0
        },
        if current.kind == "focus-timer" {
            620.0
        } else {
            320.0
        },
    )
    .decorations(false)
    .disable_drag_drop_handler()
    .maximizable(false)
    .build()
    .map_err(|error| error.to_string())?;
    crate::widget_runtime::refresh(app);
    Ok(())
}

fn reveal_widget_display(
    state: &AppState,
    id: &str,
    expected_revision: i64,
    reveal: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    let _action = lock(&state.action)?;
    if crate::unavailable(state) {
        return Err("앱을 정리하고 있어요.".into());
    }
    let current = storage::get(&*lock(&state.db)?, id)?;
    active_appearance_target(&current, expected_revision)?;
    reveal()
}

#[tauri::command]
pub(crate) async fn open_widget_display(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), String> {
    if crate::unavailable(&state) {
        return Err("앱을 정리하고 있어요.".into());
    }
    let instance = storage::get(&*lock(&state.db)?, &id)?;
    if !instance.installed || !instance.enabled || !widgets::appearance::supports(&instance.kind) {
        return Err("기념일·날씨·배터리 위젯을 설치하고 켜 주세요.".into());
    }
    uuid::Uuid::parse_str(&id).map_err(|_| "위젯 식별자가 올바르지 않아요.".to_string())?;
    let label = format!("widget-display-{id}");
    if let Some(window) = app.get_webview_window(&label) {
        let result = reveal_widget_display(&state, &id, instance.revision, || {
            window.unminimize().map_err(|error| error.to_string())?;
            window.show().map_err(|error| error.to_string())?;
            window.set_focus().map_err(|error| error.to_string())
        });
        crate::widget_runtime::refresh(&app);
        return result;
    }
    // Building waits for the UI thread, so keep it outside the lifecycle lock and hidden.
    let window = tauri::WebviewWindowBuilder::new(
        &app,
        label,
        tauri::WebviewUrl::App(format!("index.html?view=widget-display&id={id}").into()),
    )
    .title(format!(
        "comet · {}",
        widgets::manifest(&instance.kind)?.name
    ))
    .inner_size(340.0, 220.0)
    .min_inner_size(240.0, 160.0)
    .resizable(true)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .maximizable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    .visible(false)
    .build()
    .map_err(|error| error.to_string())?;
    let result = reveal_widget_display(&state, &id, instance.revision, || {
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())
    });
    if result.is_err() {
        let _ = window.destroy();
    }
    crate::widget_runtime::refresh(&app);
    result
}

#[tauri::command]
pub(crate) fn close_widget(app: tauri::AppHandle, id: String) -> Result<(), String> {
    uuid::Uuid::parse_str(&id).map_err(|_| "위젯 식별자가 올바르지 않아요.".to_string())?;
    if let Some(window) = app.get_webview_window(&format!("widget-{id}")) {
        window.destroy().map_err(|error| error.to_string())?;
    }
    crate::widget_runtime::refresh(&app);
    Ok(())
}

#[tauri::command]
pub(crate) fn close_widget_display(app: tauri::AppHandle, id: String) -> Result<(), String> {
    uuid::Uuid::parse_str(&id).map_err(|_| "위젯 식별자가 올바르지 않아요.".to_string())?;
    if let Some(window) = app.get_webview_window(&format!("widget-display-{id}")) {
        window.destroy().map_err(|error| error.to_string())?;
    }
    crate::widget_runtime::refresh(&app);
    Ok(())
}

pub(crate) fn advance_widgets(app: &tauri::AppHandle, state: &AppState) -> Result<(), String> {
    let (changed, usage_changed) = change(state, |db| {
        let timestamp = chrono::Utc::now().timestamp_millis();
        let usage_changed = advance_app_usage(state, db, timestamp)?;
        let changed = storage::advance(db, timestamp)?;
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
        for delivery in alerted.os {
            // OS delivery has its own opt-in and survives a hidden character balloon.
            crate::planner_notifications::deliver(
                app,
                &delivery.instance_id,
                timestamp,
                &delivery.text,
                delivery.sound_enabled,
            );
        }
        Ok((changed || alerted.changed, usage_changed))
    })?;
    if changed {
        cancel_widget_scene(app, state)?;
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
                crate::character_reaction_host::widget_character(&db, &event)?
            {
                let epoch = state.epoch.load(Ordering::SeqCst);
                drop(db);
                drop(_action);
                crate::character_reaction_host::trigger_widget(
                    app,
                    state.clone(),
                    &character_id,
                    &event,
                    epoch,
                )?;
                return Ok(true);
            }
            let token = interrupt(state, true)?;
            state.widget_epoch.store(token.0, Ordering::SeqCst);
            *lock(&state.widget_playback)? = Some(event.clone());
            state.last_input.store(now(), Ordering::SeqCst);
            let (lines, source) = match crate::talk_host::prepare(state, &db, Some(&event))? {
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
    fn created_widget_item_id_belongs_to_the_action_and_replay_is_a_noop() {
        let db = rusqlite::Connection::open_in_memory().unwrap();
        storage::initialize(&db).unwrap();
        let directory = tempfile::tempdir().unwrap();
        storage::install(
            &db,
            directory.path(),
            &["todo".into(), "preparation".into()],
        )
        .unwrap();
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
                None
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
    fn launcher_widget_dispatch_rejects_changed_or_disabled_preview() {
        let state = crate::app::tests::state();
        let instance = widgets::WidgetInstance {
            id: uuid::Uuid::new_v4().to_string(),
            kind: "ball".into(),
            version: 1,
            installed: true,
            enabled: true,
            revision: 3,
            data: serde_json::json!({}),
            error: None,
        };
        state.launcher_open.store(true, Ordering::SeqCst);
        assert!(validate_open_widget(&state, &instance, Some((3, 0))).is_ok());
        assert!(validate_open_widget(&state, &instance, Some((2, 0))).is_err());
        assert!(validate_open_widget(&state, &instance, Some((3, 1))).is_err());
        let mut disabled = instance;
        disabled.enabled = false;
        assert!(validate_open_widget(&state, &disabled, Some((3, 0))).is_err());
    }

    #[test]
    fn memo_open_creates_a_detached_sheet_only_for_the_current_launcher_preview() {
        let directory = tempfile::tempdir().unwrap();
        let mut state = crate::app::tests::state();
        state.app_data = directory.path().into();
        let first = change(&state, |db| {
            storage::install(db, &state.app_data, &["memo".into()])?;
            Ok(storage::instances(db)?.remove(0))
        })
        .unwrap();
        let created = create_memo_for_open(&state, &first.id, None).unwrap();
        let note = &created.widgets[0].instance.data["notes"][0];
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
        let notes = result.widgets[0].instance.data["notes"].as_array().unwrap();
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
    fn display_reveal_rejects_disabled_removed_and_reinstalled_widgets() {
        for mutation in ["disable", "remove", "delete", "reenable", "reinstall"] {
            let directory = tempfile::tempdir().unwrap();
            let mut state = crate::app::tests::state();
            state.app_data = directory.path().into();
            let instance = change(&state, |db| {
                storage::install(db, &state.app_data, &["clock".into()])?;
                Ok(storage::instances(db)?.remove(0))
            })
            .unwrap();
            change(&state, |db| {
                match mutation {
                    "disable" => storage::set_enabled(db, &instance.id, false)?,
                    "remove" => storage::remove(db, &state.app_data, &instance.id, false)?,
                    "delete" => storage::remove(db, &state.app_data, &instance.id, true)?,
                    "reenable" => {
                        storage::set_enabled(db, &instance.id, false)?;
                        storage::set_enabled(db, &instance.id, true)?;
                    }
                    "reinstall" => {
                        storage::remove(db, &state.app_data, &instance.id, false)?;
                        storage::install(db, &state.app_data, &["clock".into()])?;
                    }
                    _ => unreachable!(),
                }
                Ok(())
            })
            .unwrap();
            let mut revealed = false;
            let result = reveal_widget_display(&state, &instance.id, instance.revision, || {
                revealed = true;
                Ok(())
            });
            assert!(result.is_err(), "{mutation}");
            assert!(!revealed, "{mutation}");
        }
    }

    #[test]
    fn display_reveal_queues_visibility_inside_the_lifecycle_boundary() {
        let directory = tempfile::tempdir().unwrap();
        let mut state = crate::app::tests::state();
        state.app_data = directory.path().into();
        let instance = change(&state, |db| {
            storage::install(db, &state.app_data, &["clock".into()])?;
            Ok(storage::instances(db)?.remove(0))
        })
        .unwrap();
        let mut revealed = false;
        reveal_widget_display(&state, &instance.id, instance.revision, || {
            assert!(matches!(
                state.action.try_lock(),
                Err(std::sync::TryLockError::WouldBlock)
            ));
            assert!(state.db.try_lock().is_ok());
            revealed = true;
            Ok(())
        })
        .unwrap();
        assert!(revealed);
        state.stopping.store(true, Ordering::SeqCst);
        assert!(
            reveal_widget_display(&state, &instance.id, instance.revision, || {
                panic!("an exiting app must not reveal a display")
            })
            .is_err()
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
) -> tauri::PhysicalSize<u32> {
    tauri::PhysicalSize::new(
        ((if expanded { 840.0 } else { 380.0 }) * scale).round() as u32,
        if expanded {
            current.height.max((620.0 * scale).ceil() as u32)
        } else {
            current.height
        },
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
pub(crate) async fn set_focus_expanded(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
    expanded: bool,
    animate: Option<bool>,
) -> Result<(), String> {
    let (window, start, position, scale) = change(&state, |db| {
        let instance = storage::get(db, &id)?;
        if instance.kind != "focus-timer" || !instance.installed || !instance.enabled {
            return Err("집중 타이머를 먼저 켜 주세요.".into());
        }
        let window = app
            .get_webview_window(&format!("widget-{id}"))
            .ok_or("집중 타이머 창을 찾을 수 없어요.")?;
        let start = window.inner_size().map_err(|error| error.to_string())?;
        let position = window.outer_position().map_err(|error| error.to_string())?;
        let scale = window.scale_factor().map_err(|error| error.to_string())?;
        Ok((window, start, position, scale))
    })?;
    let target = focus_resize_target(start, scale, expanded);
    // Intermediate widths must remain below the expanded minimum until the final frame.
    window
        .set_min_size(Some(tauri::LogicalSize::new(340.0, 520.0)))
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
    if expanded {
        window
            .set_min_size(Some(tauri::LogicalSize::new(740.0, 620.0)))
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
            focus_resize_target(PhysicalSize::new(1680, 1500), 2.0, false),
            PhysicalSize::new(760, 1500)
        );
        assert_eq!(
            focus_resize_target(PhysicalSize::new(760, 1500), 2.0, true),
            PhysicalSize::new(1680, 1500)
        );
        assert_eq!(
            focus_resize_target(PhysicalSize::new(475, 650), 1.25, true),
            PhysicalSize::new(1050, 775)
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
        if instance.kind != "music" || !instance.installed || !instance.enabled {
            return Err("음악 위젯을 먼저 켜 주세요.".into());
        }
        let window = app
            .get_webview_window(&format!("widget-{id}"))
            .ok_or("음악 창을 찾을 수 없어요.")?;
        window
            .set_min_size(Some(tauri::LogicalSize::new(
                440.0,
                if expanded { 520.0 } else { 340.0 },
            )))
            .map_err(|error| error.to_string())?;
        window
            .set_size(tauri::LogicalSize::new(
                if expanded { 720.0 } else { 440.0 },
                if expanded { 730.0 } else { 340.0 },
            ))
            .map_err(|error| error.to_string())
    })
}

// Called with action + db locked: no sample can be applied after a newer timer action.
fn advance_app_usage(state: &AppState, db: &rusqlite::Connection, at: i64) -> Result<bool, String> {
    let timers: Vec<_> = storage::instances(db)?
        .into_iter()
        .filter(|instance| {
            instance.kind == "focus-timer"
                && instance.installed
                && instance.enabled
                && crate::app_usage_tracking::enabled(&instance.data)
        })
        .collect();
    let mut tracker = lock(&state.app_usage_tracker)?;
    tracker.retain(&timers.iter().map(|timer| timer.id.clone()).collect::<Vec<_>>());
    if timers.is_empty() {
        tracker.clear();
        return Ok(false);
    }
    let sample = crate::app_usage::sample();
    let instant = std::time::Instant::now();
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
        Ok(applications) => serde_json::json!({"applications":applications,"supported":true,"message":""}),
        Err(message) => serde_json::json!({"applications":[],"supported":false,"message":message}),
    }
}
