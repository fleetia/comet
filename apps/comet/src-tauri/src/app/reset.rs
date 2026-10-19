use super::{lifecycle, lock, publish, unavailable, AppState};
use crate::{inference, store, widgets};
use std::{
    fs, io,
    path::Path,
    sync::{atomic::Ordering, Arc},
};
use tauri::Manager;

const MARKER: &str = ".reset-pending";
const DATABASE_SIDECARS: [&str; 2] = ["comet.sqlite-wal", "comet.sqlite-shm"];

/// Wipes the data folder when a reset was scheduled by `reset_app`. Runs before the
/// database opens, so a fresh start seeds the bundled 별꼬리 character. The marker is
/// removed last, so an interrupted wipe resumes on the next launch.
pub(crate) fn apply_pending(app_data: &Path) -> io::Result<()> {
    let marker = app_data.join(MARKER);
    if !marker.exists() {
        return Ok(());
    }
    let mut first_error = None;
    let mut keep = |result: io::Result<()>| {
        if let Err(error) = result {
            first_error.get_or_insert(error);
        }
    };
    // The database goes first and sidecars before the main file, so no WAL outlives its database.
    for name in DATABASE_SIDECARS {
        keep(remove_if_exists(&app_data.join(name)));
    }
    keep(remove_if_exists(&app_data.join("comet.sqlite")));
    for entry in fs::read_dir(app_data)? {
        let entry = entry?;
        if entry.file_name() != MARKER {
            keep(remove_if_exists(&entry.path()));
        }
    }
    match first_error {
        Some(error) => Err(error),
        None => fs::remove_file(marker),
    }
}

fn remove_if_exists(path: &Path) -> io::Result<()> {
    let result = if fs::symlink_metadata(path)?.file_type().is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    };
    match result {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        other => other,
    }
}

#[tauri::command]
pub(crate) async fn reset_app(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), String> {
    if window.label() != "settings" {
        return Err("초기화는 설정창에서만 할 수 있어요.".into());
    }
    let app = window.app_handle().clone();
    let state = state.inner().clone();
    let (settings, instances) = {
        let _action = lock(&state.action)?;
        if unavailable(&state) {
            return Err("지금은 초기화할 수 없어요. 잠시 뒤에 다시 시도해 주세요.".into());
        }
        if state.settings_dirty.load(Ordering::SeqCst) {
            return Err(
                "저장하지 않은 설정이 있어요. 저장하거나 변경을 취소한 뒤 초기화해 주세요.".into(),
            );
        }
        lifecycle::prepare_update_install_locked(&state)?;
        let db = lock(&state.db)?;
        (store::settings(&db)?, widgets::storage::instances(&db)?)
    };
    crate::desktop::toys::clear(&app);
    publish(&app, &state);
    let result = wipe_outside_data(&app, &state, settings, instances).await;
    if let Err(error) = result {
        let _ = lifecycle::restore_update_install(&app);
        return Err(error);
    }
    lock(&state.positions)?.clear();
    // Reaches `ExitRequested` with the restart code, which skips the quit confirmation.
    app.request_restart();
    Ok(())
}

/// Stops owned work, clears OS-level state, and schedules the data wipe for the next start.
async fn wipe_outside_data(
    app: &tauri::AppHandle,
    state: &Arc<AppState>,
    settings: crate::types::Settings,
    instances: Vec<widgets::WidgetInstance>,
) -> Result<(), String> {
    let (nlp, ()) = tokio::join!(state.nlp.suspend(), super::tasks::shutdown(state));
    inference::stop_local(&state.inference).await;
    nlp?;
    state.inference.chatgpt.forget_all().await?;
    let identifier = app.config().identifier.clone();
    let app_data = state.app_data.clone();
    tokio::task::spawn_blocking(move || {
        inference::clear_api_key(&settings)?;
        for (provider, profile) in &settings.api_profiles {
            inference::clear_api_key(&settings.with_api_profile(*provider, profile))?;
        }
        widgets::connection_host::forget_external_credentials(&instances)?;
        super::autostart::disable(&identifier);
        fs::write(app_data.join(MARKER), b"").map_err(|error| error.to_string())
    })
    .await
    .map_err(|_| "초기화가 중단됐어요.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn data_folder() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        for name in [
            "comet.sqlite",
            "comet.sqlite-wal",
            "comet.sqlite-shm",
            "keep.txt",
        ] {
            fs::write(dir.path().join(name), b"x").unwrap();
        }
        for folder in ["models", "talk/packs/a", "widgets"] {
            fs::create_dir_all(dir.path().join(folder)).unwrap();
            fs::write(dir.path().join(folder).join("file"), b"x").unwrap();
        }
        dir
    }

    #[test]
    fn without_a_marker_nothing_is_removed() {
        let dir = data_folder();
        apply_pending(dir.path()).unwrap();
        assert!(dir.path().join("comet.sqlite").exists());
        assert!(dir.path().join("models/file").exists());
    }

    #[test]
    fn marker_wipes_the_whole_data_folder_and_is_removed_last() {
        let dir = data_folder();
        fs::write(dir.path().join(MARKER), b"").unwrap();
        apply_pending(dir.path()).unwrap();
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    #[test]
    fn a_failed_wipe_keeps_the_marker_for_the_next_start() {
        let dir = data_folder();
        fs::write(dir.path().join(MARKER), b"").unwrap();
        let locked = dir.path().join("locked");
        fs::create_dir(&locked).unwrap();
        fs::write(locked.join("file"), b"x").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o500)).unwrap();
            let outcome = apply_pending(dir.path());
            fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o700)).unwrap();
            assert!(outcome.is_err());
            assert!(dir.path().join(MARKER).exists());
            apply_pending(dir.path()).unwrap();
            assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
        }
    }

    #[test]
    fn a_fresh_start_after_the_wipe_has_only_byulkkori() {
        let dir = data_folder();
        fs::write(dir.path().join(MARKER), b"").unwrap();
        apply_pending(dir.path()).unwrap();
        let db = rusqlite::Connection::open(dir.path().join("comet.sqlite")).unwrap();
        crate::characters::initialize(&db).unwrap();
        assert_eq!(crate::characters::active_ids(&db).unwrap().len(), 1);
    }
}
