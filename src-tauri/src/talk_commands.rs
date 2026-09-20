use crate::{
    app::AppState,
    talk::runtime::{self, PackStatus},
};
use std::sync::Arc;

// Installing or removing a pack only touches files under `<app data>/talk/packs/`; the file
// watcher reloads the bundle and cancels any running `.talk` playback on its own.
fn statuses(state: &AppState) -> Result<Vec<PackStatus>, String> {
    runtime::pack_statuses(&runtime::root(&state.app_data))
}

#[tauri::command]
pub(crate) fn get_talk_packs(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Vec<PackStatus>, String> {
    statuses(&state)
}

#[tauri::command]
pub(crate) fn install_talk_pack(
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
) -> Result<Vec<PackStatus>, String> {
    runtime::install_bundled_pack(&runtime::root(&state.app_data), &id)?;
    statuses(&state)
}

#[tauri::command]
pub(crate) fn remove_talk_pack(
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
) -> Result<Vec<PackStatus>, String> {
    runtime::remove_pack(&runtime::root(&state.app_data), &id)?;
    statuses(&state)
}
