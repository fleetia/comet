use super::{interrupt, lock, phase, publish, unavailable, windows, AppState};
use crate::{store, types::RuntimePhase, widgets};
use std::sync::Arc;

pub(crate) fn change_user(state: &AppState, name: &str) -> Result<(bool, bool), String> {
    let _action = lock(&state.action)?;
    if unavailable(state) {
        return Err("앱을 정리하고 있어요.".into());
    }
    let db = lock(&state.db)?;
    let first = store::current_user(&db)?.is_none();
    let changed = store::set_user_name(&db, name, chrono::Utc::now().timestamp_millis())?;
    if changed {
        interrupt(state, false)?;
        let mut runtime = lock(&state.runtime)?;
        runtime.phase = RuntimePhase::Idle;
        runtime.persona = None;
        runtime.error = None;
    }
    Ok((changed, first))
}

#[tauri::command]
pub(crate) fn set_user_name(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    name: String,
) -> Result<(), String> {
    let (_, first) = change_user(&state, &name)?;
    publish(&app, &state);
    if first && !widgets::storage::snapshot(&*lock(&state.db)?)?.onboarding_done {
        windows::open_settings_section(app, windows::SettingsSection::Widgets)?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn list_legacy_memories(
    state: tauri::State<'_, Arc<AppState>>,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<store::MemoryPage, String> {
    store::legacy_memory_page(&*lock(&state.db)?, offset.unwrap_or(0), limit.unwrap_or(50))
}

#[tauri::command]
pub(crate) fn assign_legacy_memories(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    ids: Vec<String>,
    character_ids: Vec<String>,
) -> Result<(), String> {
    let epoch = {
        let _action = lock(&state.action)?;
        if unavailable(&state) {
            return Err("앱을 정리하고 있어요.".into());
        }
        store::assign_legacy_memories(&*lock(&state.db)?, &ids, &character_ids)?;
        interrupt(&state, false)?.0
    };
    phase(&app, &state, epoch, RuntimePhase::Idle, None, None);
    Ok(())
}

#[tauri::command]
pub(crate) fn count_character_memories(
    state: tauri::State<'_, Arc<AppState>>,
    character_id: String,
) -> Result<usize, String> {
    let db = lock(&state.db)?;
    crate::characters::get(&db, &character_id)?;
    db.query_row(
        "SELECT COUNT(*) FROM memories WHERE character_id=?1 AND deleted=0",
        [&character_id],
        |row| row.get(0),
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn forget_character_memories(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    character_id: String,
) -> Result<usize, String> {
    let (count, epoch) = {
        let _action = lock(&state.action)?;
        if unavailable(&state) {
            return Err("앱을 정리하고 있어요.".into());
        }
        let count = {
            let db = lock(&state.db)?;
            crate::characters::get(&db, &character_id)?;
            store::forget_character_memories(&db, &character_id)?
        };
        (count, interrupt(&state, false)?.0)
    };
    phase(&app, &state, epoch, RuntimePhase::Idle, None, None);
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::Ordering;

    #[test]
    fn each_name_change_starts_a_distinct_relationship_and_cancels_old_work() {
        let state = super::super::tests::state();
        change_user(&state, "민수").unwrap();
        let first = store::current_user(&lock(&state.db).unwrap())
            .unwrap()
            .unwrap();
        let (epoch, cancel) = interrupt(&state, false).unwrap();
        assert_eq!(change_user(&state, " 민수 ").unwrap(), (false, false));
        assert!(!cancel.load(Ordering::SeqCst));
        assert_eq!(state.epoch.load(Ordering::SeqCst), epoch);
        change_user(&state, "지연").unwrap();
        assert!(cancel.load(Ordering::SeqCst));
        change_user(&state, "민수").unwrap();
        let db = lock(&state.db).unwrap();
        let again = store::current_user(&db).unwrap().unwrap();
        assert_ne!(first.id, again.id);
        assert_eq!(first.name, again.name);
        assert!(store::relationships(&db)
            .unwrap()
            .iter()
            .all(|relation| relation.score == 20));
    }
}
