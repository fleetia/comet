use super::unavailable;
use super::{interrupt, is_current, lock, phase, publish, schedule_idle, AppState};
use crate::{inference, models, store, types::*, wordbook};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Duration;

#[derive(Clone, Copy, PartialEq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum SettingsScope {
    Automatic,
    Model,
}

#[tauri::command]
pub(crate) fn save_wordbook_entry(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    entry: WordbookEntry,
) -> Result<(), String> {
    {
        let _action = lock(&state.action)?;
        wordbook::save(&*lock(&state.db)?, &entry)?;
    }
    super::cancel_model_test(&state)?;
    publish(&app, &state);
    Ok(())
}

#[tauri::command]
pub(crate) fn delete_wordbook_entry(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), String> {
    {
        let _action = lock(&state.action)?;
        wordbook::delete(&*lock(&state.db)?, &id)?;
    }
    super::cancel_model_test(&state)?;
    publish(&app, &state);
    Ok(())
}

#[tauri::command]
pub(crate) async fn save_settings(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    settings: Settings,
    api_key: Option<String>,
    scope: Option<SettingsScope>,
) -> Result<(), String> {
    let (epoch, cancel) = apply_settings(&state, &settings, scope, api_key.as_deref())?;
    publish(&app, &state);
    let _gate = state.gate.lock().await;
    if is_current(&state, epoch, &cancel) {
        inference::stop_local(&state.inference).await;
    }
    phase(
        &app,
        &state,
        epoch,
        crate::types::RuntimePhase::Idle,
        None,
        None,
    );
    Ok(())
}

fn validate_settings(
    state: &AppState,
    settings: &Settings,
    scope: Option<SettingsScope>,
) -> Result<(), String> {
    if scope != Some(SettingsScope::Model) && !(1..=60).contains(&settings.idle_minutes) {
        return Err("설정값을 확인해 주세요.".into());
    }
    if scope == Some(SettingsScope::Automatic) {
        return Ok(());
    }
    if !["local", "api"].contains(&settings.mode.as_str())
        || !["max_tokens", "max_completion_tokens"].contains(&settings.api_token_parameter.as_str())
    {
        return Err("설정값을 확인해 주세요.".into());
    }
    if settings.mode == "api" {
        inference::endpoint(settings)?;
        if settings.api_model.trim().is_empty() {
            return Err("API 모델명을 입력해 주세요.".into());
        }
    }
    if settings.mode == "local"
        && settings.local_model == LocalModel::Custom
        && !models::selected_ready(&state.app_data, settings)
    {
        return Err("GGUF 모델 파일의 절대 경로를 확인해 주세요.".into());
    }
    Ok(())
}

pub(crate) fn apply_settings(
    state: &AppState,
    settings: &Settings,
    scope: Option<SettingsScope>,
    api_key: Option<&str>,
) -> Result<(u64, Arc<AtomicBool>), String> {
    let _action = lock(&state.action)?;
    if unavailable(state) {
        return Err("앱을 정리하고 있어요.".into());
    }
    let db = lock(&state.db)?;
    let tx = db
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    let current = store::settings(&tx)?;
    let settings = match scope {
        Some(SettingsScope::Automatic) => Settings {
            autonomous_enabled: settings.autonomous_enabled,
            local_idle_enabled: settings.local_idle_enabled,
            api_idle_enabled: settings.api_idle_enabled,
            idle_minutes: settings.idle_minutes,
            ..current
        },
        Some(SettingsScope::Model) => Settings {
            mode: settings.mode.clone(),
            local_model: settings.local_model,
            local_model_path: settings.local_model_path.clone(),
            base_url: settings.base_url.clone(),
            api_model: settings.api_model.clone(),
            api_token_parameter: settings.api_token_parameter.clone(),
            ..current
        },
        None => settings.clone(),
    };
    validate_settings(state, &settings, scope)?;
    if scope != Some(SettingsScope::Automatic) {
        if let Some(key) = api_key.map(str::trim).filter(|key| !key.is_empty()) {
            inference::set_api_key(&settings, key)?;
        }
    }
    store::save_settings(&tx, &settings)?;
    store::bump_revision(&tx)?;
    tx.commit().map_err(|error| error.to_string())?;
    let token = interrupt(state, false)?;
    schedule_idle(state, settings.idle_minutes);
    let mut runtime = lock(&state.runtime)?;
    runtime.phase = crate::types::RuntimePhase::Loading;
    runtime.persona = None;
    runtime.error = None;
    Ok(token)
}

#[tauri::command]
pub(crate) async fn test_connection(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    settings: Settings,
    api_key: Option<String>,
) -> Result<String, String> {
    let (epoch, cancel) = begin_test(&state, false)?;
    publish(&app, &state);
    let (send, receive) = tokio::sync::oneshot::channel();
    let worker = state.inner().clone();
    let worker_app = app.clone();
    super::tasks::spawn(
        app,
        state.inner().clone(),
        super::tasks::Kind::ModelTest,
        epoch,
        async move {
            let Some(_gate) = super::tasks::acquire_gate(&worker, epoch, cancel.clone()).await
            else {
                let _ = send.send(Err("API 연결 테스트가 취소됐어요.".into()));
                return;
            };
            let result = tokio::select! {
                _ = models::cancelled(cancel.clone()) => Err("API 연결 테스트가 취소됐어요.".into()),
                result = tokio::time::timeout(Duration::from_secs(120), inference::test_connection(&settings, api_key)) => {
                    result.unwrap_or_else(|_| Err("API 연결 테스트 시간이 초과됐어요.".into()))
                }
            };
            if finish_test(&worker, epoch, &cancel, result, send).unwrap_or(false) {
                publish(&worker_app, &worker);
            }
        },
    )?;
    receive
        .await
        .map_err(|_| "API 연결 테스트가 중단됐어요.".to_string())?
}

#[tauri::command]
pub(crate) fn download_model(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    model: LocalModel,
) -> Result<(), String> {
    let cancel = begin_download(&state, model)?;
    publish(&app, &state);
    let state = state.inner().clone();
    tauri::async_runtime::spawn(async move {
        let progress_app = app.clone();
        let progress_state = state.clone();
        let _ = models::download_model(&state.app_data, model, cancel, move |progress| {
            if let Ok(mut runtime) = lock(&progress_state.runtime) {
                runtime.download = Some(progress);
            }
            publish(&progress_app, &progress_state);
        })
        .await;
        if let Ok(mut active) = lock(&state.download_cancel) {
            *active = None;
        }
        publish(&app, &state);
    });
    Ok(())
}

pub(crate) fn begin_download(
    state: &AppState,
    model: LocalModel,
) -> Result<Arc<AtomicBool>, String> {
    let _action = lock(&state.action)?;
    if unavailable(state) {
        return Err("앱을 종료하고 있어요.".into());
    }
    let mut active = lock(&state.download_cancel)?;
    if active.is_some() {
        return Err("이미 모델을 다운로드하고 있어요.".into());
    }
    let selected = models::model_statuses(&state.app_data)
        .into_iter()
        .find(|status| status.id == model)
        .ok_or("지원하지 않는 모델이에요.")?;
    lock(&state.runtime)?.download = Some(DownloadProgress {
        model,
        received: selected.downloaded_bytes,
        total: selected.size,
        status: "downloading".into(),
        error: None,
    });
    let cancel = Arc::new(AtomicBool::new(false));
    *active = Some(cancel.clone());
    Ok(cancel)
}

#[tauri::command]
pub(crate) fn cancel_download(state: tauri::State<'_, Arc<AppState>>) -> Result<(), String> {
    if let Some(cancel) = lock(&state.download_cancel)?.as_ref() {
        cancel.store(true, Ordering::SeqCst);
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn edit_memory(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
    character_id: String,
    content: String,
) -> Result<(), String> {
    let (epoch, _) = {
        let _action = lock(&state.action)?;
        store::edit_memory_for(&*lock(&state.db)?, &character_id, &id, &content)?;
        interrupt(&state, false)?
    };
    phase(
        &app,
        &state,
        epoch,
        crate::types::RuntimePhase::Idle,
        None,
        None,
    );
    Ok(())
}
#[tauri::command]
pub(crate) fn delete_memory(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
    character_id: String,
) -> Result<(), String> {
    let (epoch, _) = {
        let _action = lock(&state.action)?;
        store::delete_memory_for(&*lock(&state.db)?, &character_id, &id)?;
        interrupt(&state, false)?
    };
    phase(
        &app,
        &state,
        epoch,
        crate::types::RuntimePhase::Idle,
        None,
        None,
    );
    Ok(())
}

#[tauri::command]
pub(crate) fn clear_api_key(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let (epoch, _) = {
        let _action = lock(&state.action)?;
        let settings = store::settings(&*lock(&state.db)?)?;
        inference::clear_api_key(&settings)?;
        interrupt(&state, false)?
    };
    phase(
        &app,
        &state,
        epoch,
        crate::types::RuntimePhase::Idle,
        None,
        None,
    );
    Ok(())
}

pub(crate) fn finish_test<T>(
    state: &AppState,
    epoch: u64,
    cancel: &AtomicBool,
    result: Result<T, String>,
    reply: tokio::sync::oneshot::Sender<Result<T, String>>,
) -> Result<bool, String> {
    let _action = lock(&state.action)?;
    let current = is_current(state, epoch, cancel);
    if current {
        let mut runtime = lock(&state.runtime)?;
        runtime.phase = RuntimePhase::Idle;
        runtime.persona = None;
        runtime.error = None;
        state.nlp.pause_indexing(false);
    }
    let _ = reply.send(if current {
        result
    } else {
        Err("모델 테스트가 취소됐어요.".into())
    });
    Ok(current)
}

pub(crate) fn begin_model_test(state: &AppState) -> Result<(u64, Arc<AtomicBool>), String> {
    begin_test(state, true)
}

pub(crate) fn begin_test(state: &AppState, local: bool) -> Result<(u64, Arc<AtomicBool>), String> {
    let _action = lock(&state.action)?;
    if unavailable(state) {
        return Err("앱을 종료하고 있어요.".into());
    }
    if super::tasks::model_test_running(state)? {
        return Err("이미 모델을 테스트하고 있어요.".into());
    }
    if local && lock(&state.download_cancel)?.is_some() {
        return Err("모델 다운로드가 끝난 뒤에 테스트할 수 있어요.".into());
    }
    if !matches!(
        lock(&state.runtime)?.phase,
        RuntimePhase::Idle | RuntimePhase::Error
    ) {
        return Err("진행 중인 대화가 끝난 뒤에 테스트할 수 있어요.".into());
    }
    super::tasks::reserve(state, super::tasks::Kind::ModelTest, false)
}

#[tauri::command]
pub(crate) async fn test_local_model(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    settings: Settings,
) -> Result<LocalModelTest, String> {
    let (epoch, cancel) = begin_model_test(&state)?;
    publish(&app, &state);
    let (send, receive) = tokio::sync::oneshot::channel();
    let worker = state.inner().clone();
    let worker_app = app.clone();
    super::tasks::spawn(
        app,
        state.inner().clone(),
        super::tasks::Kind::ModelTest,
        epoch,
        async move {
            let Some(_gate) = super::tasks::acquire_gate(&worker, epoch, cancel.clone()).await
            else {
                let _ = send.send(Err("모델 테스트가 취소됐어요.".into()));
                return;
            };
            let result = tokio::select! {
                _ = models::cancelled(cancel.clone()) => Err("모델 테스트가 취소됐어요.".into()),
                result = tokio::time::timeout(Duration::from_secs(120), inference::test_local(&worker.inference, &settings, cancel.clone())) => {
                    result.unwrap_or_else(|_| Err("모델 테스트 시간이 초과되었어요. 더 작은 모델을 시도해 보세요.".into()))
                }
            };
            let saved = lock(&worker.db).and_then(|db| store::settings(&db));
            let changed = saved.as_ref().map_or(true, |saved| {
                models::selected_path(&worker.app_data, saved)
                    != models::selected_path(&worker.app_data, &settings)
            });
            if result.is_err() || changed {
                inference::stop_local(&worker.inference).await;
            }
            if finish_test(&worker, epoch, &cancel, result, send).unwrap_or(false) {
                publish(&worker_app, &worker);
            }
        },
    )?;
    receive
        .await
        .map_err(|_| "모델 테스트가 중단됐어요.".to_string())?
}

#[tauri::command]
pub(crate) async fn pick_model_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (send, receive) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("GGUF 모델 파일 선택")
        .add_filter("GGUF 모델", &["gguf"])
        .pick_file(move |path| {
            let _ = send.send(path);
        });
    let Some(path) = receive.await.map_err(|_| "파일 선택이 중단됐어요.")? else {
        return Ok(None);
    };
    let path = path.into_path().map_err(|error| error.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}
