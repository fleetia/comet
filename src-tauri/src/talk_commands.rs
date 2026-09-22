use crate::{
    app::{lock, publish, AppState},
    talk::runtime::{self, PackStatus},
    talk_host,
};
use std::sync::Arc;

// Installation is picked up by the file watcher. Explicit removal also revokes the active
// pack immediately, even when an unrelated invalid file prevents a full reload.
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
    {
        let _action = lock(&state.action)?;
        if crate::unavailable(&state) {
            return Err("앱을 종료하고 있어요.".into());
        }
        runtime::install_bundled_pack(&runtime::root(&state.app_data), &id)?;
    }
    statuses(&state)
}

#[tauri::command]
pub(crate) fn remove_talk_pack(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
) -> Result<Vec<PackStatus>, String> {
    if talk_host::remove_pack(&state, &id)? {
        publish(&app, &state);
    }
    statuses(&state)
}
