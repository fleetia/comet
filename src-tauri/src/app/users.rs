use super::{
    interrupt, is_current, lock, now, phase, presence, publish, schedule_idle, unavailable,
    AppState,
};
use crate::{
    characters, store,
    types::{PanelState, RuntimePhase},
    widgets,
};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

pub(crate) fn change_user(state: &AppState, name: &str) -> Result<(bool, bool), String> {
    save_name(state, name, false)
}

fn save_name(state: &AppState, name: &str, first_only: bool) -> Result<(bool, bool), String> {
    let _action = lock(&state.action)?;
    if unavailable(state) {
        return Err("앱을 정리하고 있어요.".into());
    }
    let db = lock(&state.db)?;
    let first = store::current_user(&db)?.is_none();
    if first_only && !first {
        return Err("이미 이름을 등록했어요. 이름 변경은 설정에서 할 수 있어요.".into());
    }
    let changed = store::set_user_name(&db, name, chrono::Utc::now().timestamp_millis())?;
    if changed {
        interrupt(state, false)?;
        *lock(&state.panel)? = None;
        let mut runtime = lock(&state.runtime)?;
        runtime.phase = RuntimePhase::Idle;
        runtime.persona = None;
        runtime.error = None;
        if first {
            schedule_idle(state, store::settings(&db)?.idle_minutes);
        }
    }
    Ok((changed, first))
}

#[tauri::command]
pub(crate) fn set_user_name(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    name: String,
) -> Result<(), String> {
    change_user(&state, &name)?;
    publish(&app, &state);
    Ok(())
}

#[tauri::command]
pub(crate) fn register_user_name(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    name: String,
) -> Result<(), String> {
    save_name(&state, &name, true)?;
    publish(&app, &state);
    Ok(())
}

pub(crate) fn begin_name_prompt(
    state: &AppState,
    epoch: u64,
    cancel: &AtomicBool,
) -> Result<bool, String> {
    let _action = lock(&state.action)?;
    if unavailable(state) || !is_current(state, epoch, cancel) {
        return Ok(false);
    }
    let db = lock(&state.db)?;
    let settings = store::settings(&db)?;
    let runtime = lock(&state.runtime)?.clone();
    if store::current_user(&db)?.is_some()
        || runtime.hidden
        || runtime.paused
        || state.launcher_open.load(Ordering::SeqCst)
        || lock(&state.panel)?.is_some()
        || !settings.autonomous_enabled
        || now() < state.next_idle.load(Ordering::SeqCst)
        || super::quiet_hours::automatic_blocked(state, &settings)?
        || widgets::storage::focus_active(&db, chrono::Utc::now().timestamp_millis())?
    {
        return Ok(false);
    }
    let Some(persona) = presence::present_ids(state, &characters::active_ids(&db)?)?
        .first()
        .cloned()
    else {
        return Ok(false);
    };
    *lock(&state.panel)? = Some(PanelState {
        persona,
        mode: "name".into(),
    });
    schedule_idle(state, settings.idle_minutes);
    Ok(true)
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
    fn initial_registration_keeps_identity_and_rejects_a_stale_second_registration() {
        let state = super::super::tests::state();
        let original = store::active_user_id(&lock(&state.db).unwrap()).unwrap();
        assert_eq!(save_name(&state, "  민수  ", true).unwrap(), (true, true));
        let first = store::current_user(&lock(&state.db).unwrap())
            .unwrap()
            .unwrap();
        assert_eq!(first.id, original);
        assert_eq!(first.name, "민수");
        assert!(state.next_idle.load(Ordering::SeqCst) > now());
        assert!(save_name(&state, "다른 사람", true).is_err());
        let current = store::current_user(&lock(&state.db).unwrap())
            .unwrap()
            .unwrap();
        assert_eq!(current.id, first.id);
        assert_eq!(current.name, first.name);
    }

    #[test]
    fn first_registration_validates_unicode_length_and_controls_without_losing_the_prompt() {
        let state = super::super::tests::state();
        let (epoch, cancel) = interrupt(&state, true).unwrap();
        assert!(begin_name_prompt(&state, epoch, &cancel).unwrap());
        for name in [" ".to_string(), "별".repeat(41), "이름\n둘".to_string()] {
            assert!(save_name(&state, &name, true).is_err());
            assert!(store::current_user(&lock(&state.db).unwrap())
                .unwrap()
                .is_none());
            assert_eq!(lock(&state.panel).unwrap().as_ref().unwrap().mode, "name");
        }
        let name = "⭐".repeat(40);
        save_name(&state, &name, true).unwrap();
        assert!(lock(&state.panel).unwrap().is_none());
        assert!(cancel.load(Ordering::SeqCst));
        assert_eq!(
            store::current_user(&lock(&state.db).unwrap())
                .unwrap()
                .unwrap()
                .name,
            name
        );
    }

    #[test]
    fn unnamed_prompt_waits_until_due_and_can_return_after_dismissal_without_a_model() {
        let state = super::super::tests::state();
        let (epoch, cancel) = interrupt(&state, true).unwrap();
        state.next_idle.store(now() + 5, Ordering::SeqCst);
        assert!(!begin_name_prompt(&state, epoch, &cancel).unwrap());
        state.next_idle.store(0, Ordering::SeqCst);
        assert!(begin_name_prompt(&state, epoch, &cancel).unwrap());
        let persona = lock(&state.panel)
            .unwrap()
            .as_ref()
            .unwrap()
            .persona
            .clone();
        assert!(
            !characters::active_character(&lock(&state.db).unwrap(), &persona)
                .unwrap()
                .definition
                .greeting
                .is_empty()
        );
        let (next_epoch, next_cancel) = interrupt(&state, false).unwrap();
        assert!(lock(&state.panel).unwrap().is_none());
        assert!(!begin_name_prompt(&state, epoch, &cancel).unwrap());
        assert!(!begin_name_prompt(&state, next_epoch, &next_cancel).unwrap());
        state.next_idle.store(0, Ordering::SeqCst);
        assert!(begin_name_prompt(&state, next_epoch, &next_cancel).unwrap());
        save_name(&state, "친구", true).unwrap();
        let (epoch, cancel) = interrupt(&state, true).unwrap();
        state.next_idle.store(0, Ordering::SeqCst);
        assert!(!begin_name_prompt(&state, epoch, &cancel).unwrap());
        assert!(!super::super::scene::next_scene(&state)
            .unwrap()
            .0
            .is_empty());
    }

    #[test]
    fn registration_prompt_obeys_cancellation_and_automatic_visibility_boundaries() {
        for reason in [
            "hidden",
            "paused",
            "automatic-off",
            "launcher",
            "panel",
            "stale",
            "cancelled",
        ] {
            let state = super::super::tests::state();
            let (epoch, cancel) = interrupt(&state, true).unwrap();
            match reason {
                "hidden" => lock(&state.runtime).unwrap().hidden = true,
                "paused" => lock(&state.runtime).unwrap().paused = true,
                "automatic-off" => {
                    let db = lock(&state.db).unwrap();
                    let mut settings = store::settings(&db).unwrap();
                    settings.autonomous_enabled = false;
                    store::save_settings(&db, &settings).unwrap();
                }
                "launcher" => state.launcher_open.store(true, Ordering::SeqCst),
                "panel" => {
                    *lock(&state.panel).unwrap() = Some(PanelState {
                        persona: "a".into(),
                        mode: "menu".into(),
                    })
                }
                "stale" => {
                    interrupt(&state, false).unwrap();
                }
                "cancelled" => cancel.store(true, Ordering::SeqCst),
                _ => unreachable!(),
            }
            assert!(
                !begin_name_prompt(&state, epoch, &cancel).unwrap(),
                "{reason}"
            );
            assert!(lock(&state.panel)
                .unwrap()
                .as_ref()
                .is_none_or(|panel| panel.mode != "name"));
        }
    }

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
