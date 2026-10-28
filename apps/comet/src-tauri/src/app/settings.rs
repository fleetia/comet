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
pub(crate) fn preview_wordbook_match(
    entries: Vec<WordbookEntry>,
    input: String,
) -> Result<Option<wordbook::MatchPreview>, String> {
    if input.trim().is_empty() || input.chars().count() > 2000 {
        return Err("테스트할 말은 1~2,000자로 입력해 주세요.".into());
    }
    Ok(wordbook::preview_match(&entries, &input))
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
    api_keys: Option<std::collections::BTreeMap<ApiProvider, ApiKeyInput>>,
    scope: Option<SettingsScope>,
) -> Result<(), String> {
    let (epoch, cancel) = apply_settings_with_keys(
        &state,
        &settings,
        scope,
        api_key.as_deref(),
        api_keys.as_ref(),
    )?;
    publish(&app, &state);
    crate::widgets::generated::commands::publish(&app);
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
    if scope != Some(SettingsScope::Model) {
        settings.quiet_hours.validate()?;
    }
    if scope == Some(SettingsScope::Automatic) {
        return Ok(());
    }
    if !["local", "api", "chatgpt", "apple"].contains(&settings.mode.as_str())
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
    if settings.mode == "chatgpt"
        && (settings.chatgpt_model.trim().is_empty() || settings.chatgpt_model.len() > 200)
    {
        return Err("ChatGPT에서 사용할 모델을 선택해 주세요.".into());
    }
    if settings.mode == "local"
        && settings.local_model == LocalModel::Custom
        && !models::selected_ready(&state.app_data, settings)
    {
        return Err("GGUF 모델 파일의 절대 경로를 확인해 주세요.".into());
    }
    Ok(())
}

#[cfg(test)]
pub(crate) fn apply_settings(
    state: &AppState,
    settings: &Settings,
    scope: Option<SettingsScope>,
    api_key: Option<&str>,
) -> Result<(u64, Arc<AtomicBool>), String> {
    apply_settings_with_keys(state, settings, scope, api_key, None)
}

pub(crate) fn apply_settings_with_keys(
    state: &AppState,
    settings: &Settings,
    scope: Option<SettingsScope>,
    api_key: Option<&str>,
    api_keys: Option<&std::collections::BTreeMap<ApiProvider, ApiKeyInput>>,
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
    if scope != Some(SettingsScope::Automatic)
        && settings.mode == "apple"
        && current.mode != "apple"
    {
        crate::apple_models::status().require()?;
    }
    let analytics_consent = current.analytics_consent;
    let old_presence = current.random_presence_enabled;
    let old_automatic = current.autonomous_enabled;
    let mut profiles = current.api_profiles.clone();
    profiles.extend(settings.api_profiles.clone());
    let mut settings = match scope {
        Some(SettingsScope::Automatic) => Settings {
            autonomous_enabled: settings.autonomous_enabled,
            diary_recall_enabled: settings.diary_recall_enabled,
            show_follow_ups: settings.show_follow_ups,
            random_presence_enabled: settings.random_presence_enabled,
            local_idle_enabled: settings.local_idle_enabled,
            api_idle_enabled: settings.api_idle_enabled,
            chatgpt_idle_enabled: settings.chatgpt_idle_enabled,
            apple_idle_enabled: settings.apple_idle_enabled,
            idle_minutes: settings.idle_minutes,
            quiet_hours: settings.quiet_hours.clone(),
            ..current
        },
        Some(SettingsScope::Model) => Settings {
            mode: settings.mode.clone(),
            local_model: settings.local_model,
            local_model_path: settings.local_model_path.clone(),
            local_reasoning_enabled: settings.local_reasoning_enabled,
            base_url: settings.base_url.clone(),
            api_model: settings.api_model.clone(),
            api_token_parameter: settings.api_token_parameter.clone(),
            api_provider: settings.api_provider,
            api_profiles: profiles.clone(),
            chatgpt_model: settings.chatgpt_model.clone(),
            ..current
        },
        None => settings.clone(),
    };
    settings.analytics_consent = analytics_consent;
    if scope != Some(SettingsScope::Automatic) {
        settings.api_profiles = profiles;
        settings.remember_api_profile();
    }
    validate_settings(state, &settings, scope)?;
    let restore_presence = settings.random_presence_enabled != old_presence
        || (old_automatic && !settings.autonomous_enabled);
    if scope != Some(SettingsScope::Automatic) {
        let keys = inference::validated_api_keys(&settings, api_keys)?;
        for (profile, key) in keys {
            inference::set_api_key(&profile, &key)?;
        }
        if let Some(key) = api_key.map(str::trim).filter(|key| !key.is_empty()) {
            inference::set_api_key(&settings, key)?;
        }
    }
    store::save_settings(&tx, &settings)?;
    store::bump_revision(&tx)?;
    tx.commit().map_err(|error| error.to_string())?;
    if restore_presence {
        lock(&state.presence)?.reset(super::now());
    }
    let token = super::interrupt_with_db(state, false, &db)?;
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
                result = tokio::time::timeout(Duration::from_secs(120), inference::test_connection(&worker.inference, &settings, api_key, cancel.clone())) => {
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
    settings: Option<Settings>,
) -> Result<(), String> {
    let (epoch, _) = {
        let _action = lock(&state.action)?;
        let current = store::settings(&*lock(&state.db)?)?;
        let selected = api_key_target(&current, settings.as_ref())?;
        inference::clear_api_key(&selected)?;
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

fn api_key_target(current: &Settings, selected: Option<&Settings>) -> Result<Settings, String> {
    let Some(selected) = selected else {
        return Ok(current.clone());
    };
    let profile = current
        .api_profiles
        .get(&selected.api_provider)
        .ok_or("저장된 API 설정을 찾을 수 없습니다.")?;
    let saved = current.with_api_profile(selected.api_provider, profile);
    let supplied = Settings {
        api_provider: ApiProvider::Custom,
        ..selected.clone()
    };
    if inference::endpoint(&saved)? != inference::endpoint(&supplied)? {
        return Err("저장된 API 주소와 다릅니다. 저장한 서비스에서 키를 삭제해 주세요.".into());
    }
    Ok(saved)
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
            let timeout = Duration::from_secs(if settings.local_reasoning_enabled {
                300
            } else {
                120
            });
            let result = tokio::select! {
                _ = models::cancelled(cancel.clone()) => Err("모델 테스트가 취소됐어요.".into()),
                result = tokio::time::timeout(timeout, inference::test_local(&worker.inference, &settings, cancel.clone())) => {
                    result.unwrap_or_else(|_| Err("모델 테스트 시간이 초과되었어요. 더 작은 모델을 시도해 보세요.".into()))
                }
            };
            let saved = lock(&worker.db).and_then(|db| store::settings(&db));
            let changed = saved.as_ref().map_or(true, |saved| {
                models::selected_path(&worker.app_data, saved)
                    != models::selected_path(&worker.app_data, &settings)
                    || saved.local_reasoning_enabled != settings.local_reasoning_enabled
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
pub(crate) async fn test_apple_model(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<LocalModelTest, String> {
    crate::apple_models::status().require()?;
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
                let _ = send.send(Err("모델 테스트가 취소됐어요.".into()));
                return;
            };
            let settings = Settings {
                mode: "apple".into(),
                ..Settings::default()
            };
            let started = std::time::Instant::now();
            let result = inference::generate(
                &worker.inference,
                &settings,
                &[ChatMessage { role: "user".into(), content: "한국어 한 문장으로 짧게 인사해 줘.".into() }],
                serde_json::json!({"type":"object","properties":{"text":{"type":"string","minLength":1,"maxLength":300}},"required":["text"],"additionalProperties":false}),
                128,
                cancel.clone(),
            ).await.and_then(|value| {
                let reply = value["text"].as_str().filter(|text| !text.trim().is_empty())
                    .ok_or("Apple 모델이 빈 응답을 보냈어요.")?;
                Ok(LocalModelTest { reply: reply.into(), elapsed_ms: started.elapsed().as_millis() as u64 })
            });
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

#[cfg(test)]
mod api_profile_tests {
    use super::*;

    #[test]
    fn clearing_a_saved_inactive_provider_requires_the_saved_endpoint() {
        let mut current = Settings {
            api_provider: ApiProvider::Claude,
            api_model: "claude-saved".into(),
            ..Settings::default()
        };
        current.remember_api_profile();
        let selected = current.clone();
        current.api_provider = ApiProvider::Gemini;
        current.api_model = "gemini-saved".into();
        current.remember_api_profile();
        let target = api_key_target(&current, Some(&selected)).unwrap();
        assert_eq!(target.api_provider, ApiProvider::Claude);
        assert_eq!(target.base_url, "https://api.anthropic.com/v1");
        assert_eq!(
            api_key_target(&current, None).unwrap().api_provider,
            ApiProvider::Gemini
        );
        let changed = Settings {
            base_url: "https://other.example/v1".into(),
            ..selected
        };
        assert!(api_key_target(&current, Some(&changed)).is_err());
        assert!(api_key_target(&current, Some(&Settings::default())).is_err());
    }
}
