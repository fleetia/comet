use serde::Serialize;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateStatus {
    phase: &'static str,
    version: Option<String>,
    notes: Option<String>,
    downloaded: u64,
    total: Option<u64>,
    message: Option<String>,
}

impl Default for UpdateStatus {
    fn default() -> Self {
        Self {
            phase: "idle",
            version: None,
            notes: None,
            downloaded: 0,
            total: None,
            message: None,
        }
    }
}

#[derive(Default)]
pub(crate) struct UpdateState {
    status: Mutex<UpdateStatus>,
    available: Mutex<Option<Update>>,
    operation: tokio::sync::Mutex<()>,
}

fn configured(app: &tauri::AppHandle) -> bool {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|config| config.get("pubkey"))
        .and_then(|key| key.as_str())
        .is_some_and(|key| !key.trim().is_empty())
}

fn publish(app: &tauri::AppHandle, status: UpdateStatus) -> Result<UpdateStatus, String> {
    let refresh_menu = {
        let state = app.state::<UpdateState>();
        let mut current = super::lock(&state.status)?;
        let changed = current.phase != status.phase || current.version != status.version;
        *current = status.clone();
        changed
    };
    let _ = app.emit("app-update", &status);
    if refresh_menu {
        crate::desktop_menu::refresh(app);
    }
    Ok(status)
}

fn failure_message(error: &tauri_plugin_updater::Error) -> &'static str {
    use tauri_plugin_updater::Error;
    match error {
        Error::Minisign(_) | Error::Base64(_) | Error::SignatureUtf8(_) => {
            "업데이트 서명을 확인하지 못해 설치하지 않았어요. 다시 확인해 주세요."
        }
        Error::ReleaseNotFound => {
            "공개된 업데이트 정보를 찾지 못했어요. 나중에 다시 확인해 주세요."
        }
        Error::Reqwest(_) | Error::Network(_) => {
            "업데이트 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요."
        }
        Error::TargetNotFound(_) | Error::TargetsNotFound(_) => {
            "이 운영체제에 맞는 업데이트 파일이 아직 없어요."
        }
        _ => "업데이트를 완료하지 못했어요. 다시 시도해 주세요.",
    }
}

fn report_failure(app: &tauri::AppHandle, message: String) -> String {
    if let Ok(mut status) = get_status(app) {
        status.phase = "error";
        status.message = Some(message.clone());
        let _ = publish(app, status);
    }
    message
}

fn get_status(app: &tauri::AppHandle) -> Result<UpdateStatus, String> {
    Ok(super::lock(&app.state::<UpdateState>().status)?.clone())
}

pub(crate) fn menu_label(app: &tauri::AppHandle) -> String {
    let Ok(status) = get_status(app) else {
        return "업데이트 확인".into();
    };
    match status.phase {
        "available" | "error" if status.version.is_some() => {
            format!("새 버전 {} 설치 가능", status.version.unwrap_or_default())
        }
        "checking" => "업데이트 확인 중…".into(),
        "downloading" => "업데이트 다운로드 중…".into(),
        "installing" => "업데이트 설치 중…".into(),
        _ => "업데이트 확인".into(),
    }
}

#[tauri::command]
pub(crate) fn get_update_status(app: tauri::AppHandle) -> Result<UpdateStatus, String> {
    get_status(&app)
}

#[tauri::command]
pub(crate) async fn check_app_update(app: tauri::AppHandle) -> Result<UpdateStatus, String> {
    let state = app.state::<UpdateState>();
    let _operation = state
        .operation
        .try_lock()
        .map_err(|_| "업데이트 작업이 진행 중이에요.")?;
    if !configured(&app) {
        return publish(
            &app,
            UpdateStatus {
                phase: "disabled",
                message: Some("이 빌드에는 업데이트 서명 키가 설정되지 않았어요.".into()),
                ..UpdateStatus::default()
            },
        );
    }
    publish(
        &app,
        UpdateStatus {
            phase: "checking",
            ..UpdateStatus::default()
        },
    )?;
    *super::lock(&state.available)? = None;
    let result = async {
        app.updater_builder()
            .timeout(Duration::from_secs(30))
            .build()?
            .check()
            .await
    }
    .await;
    match result {
        Ok(update) => {
            let status = match &update {
                Some(update) => UpdateStatus {
                    phase: "available",
                    version: Some(update.version.clone()),
                    notes: update.body.clone(),
                    ..UpdateStatus::default()
                },
                None => UpdateStatus {
                    phase: "current",
                    ..UpdateStatus::default()
                },
            };
            *super::lock(&state.available)? = update;
            publish(&app, status)
        }
        Err(error) => Err(report_failure(&app, failure_message(&error).into())),
    }
}

fn confirm_version(available: Option<&str>, expected: &str) -> Result<(), String> {
    if available != Some(expected) {
        return Err("업데이트를 다시 확인하고 설치할 버전을 선택해 주세요.".into());
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn install_app_update(
    app: tauri::AppHandle,
    version: String,
) -> Result<(), String> {
    crate::app::lifecycle::ensure_settings_saved_for_update(
        &app.state::<std::sync::Arc<crate::app::AppState>>(),
    )?;
    let state = app.state::<UpdateState>();
    let _operation = state
        .operation
        .try_lock()
        .map_err(|_| "업데이트 작업이 진행 중이에요.")?;
    let update = super::lock(&state.available)?.clone();
    confirm_version(
        update.as_ref().map(|update| update.version.as_str()),
        &version,
    )?;
    let mut update = update.ok_or("먼저 업데이트를 확인해 주세요.")?;
    update.timeout = Some(Duration::from_secs(300));
    let mut status = UpdateStatus {
        phase: "downloading",
        version: Some(update.version.clone()),
        notes: update.body.clone(),
        ..UpdateStatus::default()
    };
    publish(&app, status.clone())?;
    // The plugin verifies the signature before returning these bytes.
    let mut last_progress = Instant::now();
    let bytes = update
        .download(
            |chunk, total| {
                status.downloaded = status.downloaded.saturating_add(chunk as u64);
                status.total = total;
                if last_progress.elapsed() >= Duration::from_millis(100) {
                    let _ = publish(&app, status.clone());
                    last_progress = Instant::now();
                }
            },
            || {},
        )
        .await
        .map_err(|error| report_failure(&app, failure_message(&error).into()))?;
    if let Err(error) = super::prepare_update_install(&app).await {
        let _ = super::restore_update_install(&app);
        return Err(report_failure(&app, error));
    }
    status.phase = "installing";
    publish(&app, status)?;
    if let Err(error) = update.install(bytes) {
        let recovery = super::restore_update_install(&app);
        let message = match recovery {
            Ok(()) => failure_message(&error).to_string(),
            Err(_) => "업데이트 설치에 실패했어요. 앱을 다시 실행해 주세요.".into(),
        };
        return Err(report_failure(&app, message));
    }
    // Windows exits inside install; macOS needs an explicit restart.
    app.request_restart();
    Ok(())
}

pub(crate) fn start(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            let _ = check_app_update(app.clone()).await;
            tokio::time::sleep(Duration::from_secs(24 * 60 * 60)).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn install_requires_the_version_the_user_approved() {
        assert!(confirm_version(Some("0.4.1"), "0.4.1").is_ok());
        assert!(confirm_version(Some("0.4.2"), "0.4.1").is_err());
        assert!(confirm_version(None, "0.4.1").is_err());
    }

    #[test]
    fn signature_failure_is_distinct_from_offline_and_missing_release() {
        let signature = failure_message(&tauri_plugin_updater::Error::SignatureUtf8("bad".into()));
        assert!(signature.contains("서명"));
        assert!(signature.contains("설치하지 않았어요"));
        let offline = failure_message(&tauri_plugin_updater::Error::Network("offline".into()));
        assert!(offline.contains("연결"));
        let missing = failure_message(&tauri_plugin_updater::Error::ReleaseNotFound);
        assert!(missing.contains("찾지 못했어요"));
        assert_ne!(signature, offline);
    }
}
