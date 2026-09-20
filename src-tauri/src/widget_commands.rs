use crate::{
    app::{interrupt, lock, now, publish, scene::start_scene, windows::skip_talk, AppState},
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
    crate::desktop_menu::refresh(app);
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
    action(&db)
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
            window.close().map_err(|error| error.to_string())?;
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
pub(crate) fn finish_widget_onboarding(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), String> {
    change(&state, storage::finish_onboarding)?;
    publish_widgets(&app, &state);
    Ok(())
}

#[tauri::command]
pub(crate) async fn set_widget_enabled(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
    enabled: bool,
) -> Result<(), String> {
    let mutation = |db: &rusqlite::Connection| {
        storage::set_enabled(db, &id, enabled)?;
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
        storage::remove(db, &state.app_data, &id, delete_data)?;
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
            runtime.phase = "idle".into();
            runtime.persona = None;
        }
    }
    publish(app, state);
    Ok(())
}

pub(crate) fn cancel_widget_jobs(state: &AppState, id: Option<&str>) -> Result<(), String> {
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
    let all = storage::instances(db)?;
    Ok(event.expires_at > chrono::Utc::now().timestamp_millis()
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
) -> Result<(), String> {
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
            Ok(())
        });
    }
    change(&state, |db| {
        storage::execute(
            db,
            &request,
            chrono::Utc::now().timestamp_millis(),
            uuid::Uuid::new_v4().as_u128() as u64,
        )
    })?;
    crate::memo_notes::schedule_sync(&app);
    // New state can invalidate an already playing reaction to this widget.
    cancel_widget_scene(&app, &state)?;
    publish_widgets(&app, &state);
    Ok(())
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
) -> Result<Vec<(i64, WidgetEvent)>, String> {
    let db = lock(&state.db)?;
    if !storage::instances(&db)?
        .iter()
        .any(|entry| entry.kind == "journal" && entry.installed && entry.enabled)
    {
        return Err("사건 일지를 설치하고 켜 주세요.".into());
    }
    storage::journal(&db, before)
}

#[tauri::command]
pub(crate) fn open_widgets(app: tauri::AppHandle) -> Result<(), String> {
    skip_talk(app.clone(), app.state::<Arc<AppState>>())?;
    if let Some(window) = app.get_webview_window("widgets") {
        window.show().map_err(|error| error.to_string())?;
        return window.set_focus().map_err(|error| error.to_string());
    }
    tauri::WebviewWindowBuilder::new(
        &app,
        "widgets",
        tauri::WebviewUrl::App("index.html?view=widgets".into()),
    )
    .title("comet · 위젯 관리")
    .inner_size(880.0, 760.0)
    .min_inner_size(560.0, 480.0)
    .decorations(false)
    .maximizable(false)
    .build()
    .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) fn close_widgets(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("widgets") {
        window.close().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn open_widget(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), String> {
    if crate::unavailable(&state) {
        return Err("앱을 정리하고 있어요.".into());
    }
    let instance = storage::get(&*lock(&state.db)?, &id)?;
    if !instance.installed || !instance.enabled {
        return Err("위젯을 설치하고 켜 주세요.".into());
    }
    uuid::Uuid::parse_str(&id).map_err(|_| "위젯 식별자가 올바르지 않아요.".to_string())?;
    if crate::behavior::TOYS.contains(&instance.kind.as_str()) {
        let token = crate::desktop_toys::launch_token(&app, &id)?;
        let geometry = crate::desktop_toys::current_geometry(&app).await?;
        return change(&state, |db| {
            let current = storage::get(db, &id)?;
            if !current.installed || !current.enabled {
                return Err("장난감을 설치하고 켜 주세요.".into());
            }
            crate::desktop_toys::validate_launch(&app, &id, token)?;
            crate::desktop_toys::open(
                &app,
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
    let label = format!("widget-{id}");
    if let Some(window) = app.get_webview_window(&label) {
        window.show().map_err(|error| error.to_string())?;
        return window.set_focus().map_err(|error| error.to_string());
    }
    tauri::WebviewWindowBuilder::new(
        &app,
        label,
        tauri::WebviewUrl::App(format!("index.html?view=widget&id={id}").into()),
    )
    .title(format!(
        "comet · {}",
        widgets::manifest(&instance.kind)?.name
    ))
    .inner_size(360.0, 480.0)
    .min_inner_size(296.0, 320.0)
    .decorations(false)
    .maximizable(false)
    .build()
    .map_err(|error| error.to_string())?;
    Ok(())
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
        window.show().map_err(|error| error.to_string())?;
        return window.set_focus().map_err(|error| error.to_string());
    }
    tauri::WebviewWindowBuilder::new(
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
    .build()
    .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) fn close_widget(app: tauri::AppHandle, id: String) -> Result<(), String> {
    uuid::Uuid::parse_str(&id).map_err(|_| "위젯 식별자가 올바르지 않아요.".to_string())?;
    if let Some(window) = app.get_webview_window(&format!("widget-{id}")) {
        window.close().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn close_widget_display(app: tauri::AppHandle, id: String) -> Result<(), String> {
    uuid::Uuid::parse_str(&id).map_err(|_| "위젯 식별자가 올바르지 않아요.".to_string())?;
    if let Some(window) = app.get_webview_window(&format!("widget-display-{id}")) {
        window.close().map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub(crate) fn advance_widgets(app: &tauri::AppHandle, state: &AppState) -> Result<(), String> {
    let changed = change(state, |db| {
        let timestamp = chrono::Utc::now().timestamp_millis();
        let changed = storage::advance(db, timestamp)?;
        let alerted =
            widgets::reminders::advance(db, &mut *lock(&state.widget_clocks)?, timestamp)?;
        let runtime = lock(&state.runtime)?;
        if runtime.hidden || runtime.paused || !store::settings(db)?.autonomous_enabled {
            storage::discard_pending(db)?;
        }
        Ok(changed || alerted)
    })?;
    if changed {
        cancel_widget_scene(app, state)?;
        publish_widgets(app, state);
    }
    Ok(())
}

pub(crate) fn play_widget_reaction(
    app: &tauri::AppHandle,
    state: &Arc<AppState>,
) -> Result<bool, String> {
    let pending = {
        let _action = lock(&state.action)?;
        if crate::unavailable(state) {
            return Ok(false);
        }
        let status = lock(&state.runtime)?.clone();
        let db = lock(&state.db)?;
        current_events(state, &db)?;
        if status.hidden || status.paused || !store::settings(&db)?.autonomous_enabled {
            storage::discard_pending(&db)?;
            return Ok(false);
        }
        if state.stopping.load(Ordering::SeqCst)
            || status.phase != "idle"
            || lock(&state.panel)?.is_some()
            || now() - state.last_input.load(Ordering::SeqCst) < 3
        {
            return Ok(false);
        }
        let event = storage::take_reaction(&db, chrono::Utc::now().timestamp_millis())?;
        if let Some(event) = event {
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
    if has("nadir") && has("star-tail") {
        return Ok(None);
    }
    Ok(Some(vec![SceneLine {
        persona: "a".into(),
        expression: "평온".into(),
        text: event.event.text.clone(),
    }]))
}

#[cfg(test)]
mod tests {
    use super::*;

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
