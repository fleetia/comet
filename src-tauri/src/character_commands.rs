use crate::{
    app::{interrupt, lock, now, publish, windows::skip_talk, AppState},
    character_files,
    characters::{self, CharacterDefinition, CharacterDialogue, CharacterPack, InstalledCharacter},
    store, wordbook,
};
use rusqlite::Connection;
use std::sync::{atomic::Ordering, Arc};
use tauri::Manager;

pub(crate) fn mutate<T>(
    state: &AppState,
    change: impl FnOnce(&Connection) -> Result<T, String>,
) -> Result<T, String> {
    mutate_inner(state, false, change)
}

fn mutate_inner<T>(
    state: &AppState,
    dialogue_changed: bool,
    change: impl FnOnce(&Connection) -> Result<T, String>,
) -> Result<T, String> {
    let _action = lock(&state.action)?;
    if state.stopping.load(Ordering::SeqCst) {
        return Err("앱을 종료하고 있어요.".into());
    }
    let db = lock(&state.db)?;
    let tx = db
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    let before = [
        characters::active_character(&tx, "a")?,
        characters::active_character(&tx, "b")?,
    ];
    let result = change(&tx)?;
    let after = [
        characters::active_character(&tx, "a")?,
        characters::active_character(&tx, "b")?,
    ];
    let changed = dialogue_changed || before != after;
    if changed {
        store::bump_revision(&tx)?;
    }
    tx.commit().map_err(|error| error.to_string())?;
    if changed {
        interrupt(state, false)?;
        *lock(&state.panel)? = None;
        state.idle_sequence.store(0, Ordering::SeqCst);
        state.last_input.store(now(), Ordering::SeqCst);
        state.next_idle.store(now() + 5, Ordering::SeqCst);
        let mut runtime = lock(&state.runtime)?;
        runtime.phase = "idle".into();
        runtime.persona = None;
        runtime.error = None;
    }
    Ok(result)
}

#[tauri::command]
pub(crate) fn create_character(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    definition: CharacterDefinition,
) -> Result<InstalledCharacter, String> {
    let character = mutate(&state, |db| characters::create(db, &definition))?;
    publish(&app, &state);
    Ok(character)
}
#[tauri::command]
pub(crate) fn save_character(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
    definition: CharacterDefinition,
) -> Result<(), String> {
    mutate(&state, |db| characters::save(db, &id, &definition))?;
    publish(&app, &state);
    Ok(())
}
#[tauri::command]
pub(crate) fn clone_character(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
) -> Result<InstalledCharacter, String> {
    let character = mutate(&state, |db| characters::clone_character(db, &id))?;
    publish(&app, &state);
    Ok(character)
}
#[tauri::command]
pub(crate) fn assign_character(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    persona: String,
    id: String,
) -> Result<(), String> {
    mutate(&state, |db| characters::assign(db, &persona, &id))?;
    publish(&app, &state);
    Ok(())
}
#[tauri::command]
pub(crate) fn apply_character_pair(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    ids: [String; 2],
) -> Result<(), String> {
    mutate(&state, |db| characters::apply_pair(db, ids))?;
    publish(&app, &state);
    Ok(())
}
#[tauri::command]
pub(crate) fn remove_character(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), String> {
    mutate(&state, |db| characters::remove(db, &id))?;
    publish(&app, &state);
    Ok(())
}
#[tauri::command]
pub(crate) fn get_character_dialogue(
    state: tauri::State<'_, Arc<AppState>>,
    ids: Vec<String>,
) -> Result<CharacterDialogue, String> {
    characters::dialogue(&*lock(&state.db)?, &ids)
}
#[tauri::command]
pub(crate) fn save_character_dialogue(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    ids: Vec<String>,
    dialogue: CharacterDialogue,
) -> Result<(), String> {
    mutate_inner(&state, true, |db| {
        characters::save_dialogue(db, &ids, &dialogue)
    })?;
    publish(&app, &state);
    Ok(())
}
#[tauri::command]
pub(crate) fn preview_character_pack(json: String) -> Result<CharacterPack, String> {
    characters::parse_pack(&json)
}
#[tauri::command]
pub(crate) async fn choose_character_pack(
    app: tauri::AppHandle,
) -> Result<Option<CharacterPack>, String> {
    character_files::choose(app).await
}
#[tauri::command]
pub(crate) fn import_character_pack(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    pack: CharacterPack,
) -> Result<Vec<InstalledCharacter>, String> {
    let imported = mutate(&state, |db| characters::import_pack(db, &pack))?;
    publish(&app, &state);
    Ok(imported)
}
#[tauri::command]
pub(crate) async fn save_character_pack(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    ids: Vec<String>,
    wordbook_ids: Vec<String>,
) -> Result<Option<String>, String> {
    let json = {
        let db = lock(&state.db)?;
        let entries = wordbook::entries(&db)?;
        if wordbook_ids.len() > 100 {
            return Err("공유할 단어장은 100개까지 선택해 주세요.".into());
        }
        let selected = wordbook_ids
            .iter()
            .map(|id| {
                entries
                    .iter()
                    .find(|e| &e.id == id)
                    .cloned()
                    .ok_or_else(|| "선택한 개인 단어장을 찾지 못했어요.".to_string())
            })
            .collect::<Result<Vec<_>, _>>()?;
        let pack = characters::export_pack(&db, &ids, &selected)?;
        serde_json::to_string_pretty(&pack).map_err(|error| error.to_string())?
    };
    character_files::save(app, json).await
}
#[tauri::command]
pub(crate) fn open_characters(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<Arc<AppState>>();
    skip_talk(app.clone(), state)?;
    if let Some(window) = app.get_webview_window("characters") {
        window.show().map_err(|error| error.to_string())?;
        return window.set_focus().map_err(|error| error.to_string());
    }
    tauri::WebviewWindowBuilder::new(
        &app,
        "characters",
        tauri::WebviewUrl::App("index.html?view=characters".into()),
    )
    .title("comet · 캐릭터 관리")
    .inner_size(920.0, 760.0)
    .min_inner_size(640.0, 480.0)
    .decorations(false)
    .maximizable(false)
    .build()
    .map_err(|error| error.to_string())?;
    Ok(())
}
