use super::{interrupt, is_current, lock, phase, publish, schedule_idle, AppState};
use crate::{inference, models, store, types::*, wordbook};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

#[tauri::command]
pub(super) fn save_wordbook_entry(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    entry: WordbookEntry,
) -> Result<(), String> {
    {
        let _action = lock(&state.action)?;
        wordbook::save(&*lock(&state.db)?, &entry)?;
    }
    publish(&app, &state);
    Ok(())
}

#[tauri::command]
pub(super) fn delete_wordbook_entry(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), String> {
    {
        let _action = lock(&state.action)?;
        wordbook::delete(&*lock(&state.db)?, &id)?;
    }
    publish(&app, &state);
    Ok(())
}

#[tauri::command]
pub(super) async fn save_settings(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    settings: Settings,
    api_key: Option<String>,
) -> Result<(), String> {
    if !["local", "api"].contains(&settings.mode.as_str())
        || !(1..=60).contains(&settings.idle_minutes)
        || !["max_tokens", "max_completion_tokens"].contains(&settings.api_token_parameter.as_str())
    {
        return Err("설정값을 확인해 주세요.".into());
    }
    if settings.mode == "api" {
        let url = reqwest::Url::parse(&settings.base_url)
            .map_err(|_| "API 주소를 확인해 주세요.".to_string())?;
        if url.scheme() != "https"
            && !(url.scheme() == "http"
                && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]")))
        {
            return Err("외부 API에는 HTTPS 주소를 사용해 주세요.".into());
        }
        if settings.api_model.trim().is_empty() {
            return Err("API 모델명을 입력해 주세요.".into());
        }
    }
    if let Some(key) = api_key {
        if !key.trim().is_empty() {
            inference::set_api_key(&settings, key.trim())?;
        }
    }
    let (epoch, cancel) = apply_settings(&state, &settings)?;
    publish(&app, &state);
    let _gate = state.gate.lock().await;
    if is_current(&state, epoch, &cancel) {
        inference::stop_local(&state.inference).await;
    }
    phase(&app, &state, epoch, "idle", None, None);
    Ok(())
}

pub(super) fn apply_settings(
    state: &AppState,
    settings: &Settings,
) -> Result<(u64, Arc<AtomicBool>), String> {
    let _action = lock(&state.action)?;
    let db = lock(&state.db)?;
    let tx = db
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    store::save_settings(&tx, settings)?;
    store::bump_revision(&tx)?;
    tx.commit().map_err(|error| error.to_string())?;
    let token = interrupt(state, false)?;
    schedule_idle(state, settings.idle_minutes);
    let mut runtime = lock(&state.runtime)?;
    runtime.phase = "loading".into();
    runtime.persona = None;
    runtime.error = None;
    Ok(token)
}

#[tauri::command]
pub(super) async fn test_connection(
    settings: Settings,
    api_key: Option<String>,
) -> Result<String, String> {
    inference::test_connection(&settings, api_key).await
}

#[tauri::command]
pub(super) fn download_model(
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

pub(super) fn begin_download(
    state: &AppState,
    model: LocalModel,
) -> Result<Arc<AtomicBool>, String> {
    let _action = lock(&state.action)?;
    if state.stopping.load(Ordering::SeqCst) {
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
pub(super) fn cancel_download(state: tauri::State<'_, Arc<AppState>>) -> Result<(), String> {
    if let Some(cancel) = lock(&state.download_cancel)?.as_ref() {
        cancel.store(true, Ordering::SeqCst);
    }
    Ok(())
}

#[tauri::command]
pub(super) fn edit_memory(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
    content: String,
) -> Result<(), String> {
    let (epoch, _) = {
        let _action = lock(&state.action)?;
        store::edit_memory(&*lock(&state.db)?, &id, &content)?;
        interrupt(&state, false)?
    };
    phase(&app, &state, epoch, "idle", None, None);
    Ok(())
}
#[tauri::command]
pub(super) fn delete_memory(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), String> {
    let (epoch, _) = {
        let _action = lock(&state.action)?;
        store::delete_memory(&*lock(&state.db)?, &id)?;
        interrupt(&state, false)?
    };
    phase(&app, &state, epoch, "idle", None, None);
    Ok(())
}

#[tauri::command]
pub(super) fn clear_api_key(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let (epoch, _) = {
        let _action = lock(&state.action)?;
        let settings = store::settings(&*lock(&state.db)?)?;
        inference::clear_api_key(&settings)?;
        interrupt(&state, false)?
    };
    phase(&app, &state, epoch, "idle", None, None);
    Ok(())
}
