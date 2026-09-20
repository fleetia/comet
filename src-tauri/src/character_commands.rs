use crate::{
    app::{
        interrupt, lock, now, publish,
        windows::{open_settings_section, SettingsSection},
        AppState,
    },
    character_files, character_sprites,
    characters::{
        self, CharacterDefinition, CharacterDialogue, CharacterPack, InstalledCharacter,
        InstalledCharacterPack,
    },
    store, wordbook,
};
use rusqlite::Connection;
use std::sync::{atomic::Ordering, Arc};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

pub(crate) const SPRITE_SCHEME: &str = "sprite";

pub(crate) fn sprite_response(
    status: u16,
    mime: &str,
    body: Vec<u8>,
    origin: Option<&str>,
    dev_url: Option<&tauri::Url>,
) -> tauri::http::Response<Vec<u8>> {
    let allowed_origin = origin.filter(|origin| {
        matches!(
            *origin,
            "tauri://localhost" | "http://tauri.localhost" | "https://tauri.localhost"
        ) || (cfg!(debug_assertions)
            && dev_url.is_some_and(|url| {
                matches!(url.scheme(), "http" | "https")
                    && url.origin().ascii_serialization() == *origin
            }))
    });
    let mut response = tauri::http::Response::builder()
        .status(status)
        .header("Content-Type", mime)
        .header("Cache-Control", "public, max-age=31536000, immutable")
        .header("Vary", "Origin");
    if let Some(origin) = allowed_origin {
        response = response.header("Access-Control-Allow-Origin", origin);
    }
    response
        .body(body)
        .unwrap_or_else(|_| tauri::http::Response::new(Vec::new()))
}

// Serves sprite://localhost/<character-id>?expression=<name>&v=<updatedAt> from the database so the
// snapshot event never carries image bytes.
pub(crate) fn serve_sprite(
    ctx: tauri::UriSchemeContext<'_, tauri::Wry>,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let origin = request
        .headers()
        .get("Origin")
        .and_then(|value| value.to_str().ok());
    let dev_url = ctx.app_handle().config().build.dev_url.as_ref();
    let Ok(url) = tauri::Url::parse(&request.uri().to_string()) else {
        return sprite_response(400, "text/plain", Vec::new(), origin, dev_url);
    };
    let id = url
        .path_segments()
        .and_then(|mut segments| segments.next())
        .unwrap_or("")
        .to_string();
    let Some(expression) = url
        .query_pairs()
        .find(|(key, _)| key == "expression")
        .map(|(_, value)| value.into_owned())
    else {
        return sprite_response(400, "text/plain", Vec::new(), origin, dev_url);
    };
    let state = ctx.app_handle().state::<Arc<AppState>>();
    let found = lock(&state.db).and_then(|db| characters::sprite(&db, &id, &expression));
    match found {
        Ok(Some(sprite)) => sprite_response(200, &sprite.mime, sprite.data, origin, dev_url),
        Ok(None) => sprite_response(404, "text/plain", Vec::new(), origin, dev_url),
        Err(_) => sprite_response(500, "text/plain", Vec::new(), origin, dev_url),
    }
}

fn write_sprite(
    app: &tauri::AppHandle,
    state: &AppState,
    change: impl FnOnce(&Connection) -> Result<(), String>,
) -> Result<(), String> {
    {
        let _action = lock(&state.action)?;
        if crate::unavailable(state) {
            return Err("앱을 종료하고 있어요.".into());
        }
        change(&*lock(&state.db)?)?;
    }
    publish(app, state);
    Ok(())
}

#[tauri::command]
pub(crate) async fn choose_character_sprite(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
    expression: String,
) -> Result<bool, String> {
    {
        let db = lock(&state.db)?;
        let character = characters::collection(&db)?
            .installed
            .into_iter()
            .find(|character| character.id == id)
            .ok_or("설치된 캐릭터를 찾을 수 없습니다.")?;
        if !characters::sprite_slot_allowed(&character.definition, &expression) {
            return Err("먼저 캐릭터에 그 표정을 추가하고 저장해 주세요.".into());
        }
    }
    let (send, receive) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title(format!("{expression} 표정 이미지 선택"))
        .add_filter("이미지", &character_sprites::SPRITE_EXTENSIONS)
        .pick_file(move |path| {
            let _ = send.send(path);
        });
    let Some(path) = receive.await.map_err(|_| "파일 선택이 중단됐어요.")? else {
        return Ok(false);
    };
    let path = path.into_path().map_err(|error| error.to_string())?;
    let bytes = tauri::async_runtime::spawn_blocking(move || character_sprites::read_file(&path))
        .await
        .map_err(|error| error.to_string())??;
    write_sprite(&app, &state, |db| {
        characters::set_sprite(db, &id, &expression, &bytes)
    })?;
    Ok(true)
}
#[tauri::command]
pub(crate) fn remove_character_sprite(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
    expression: String,
) -> Result<(), String> {
    write_sprite(&app, &state, |db| {
        characters::remove_sprite(db, &id, &expression)
    })
}

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
    if crate::unavailable(state) {
        return Err("앱을 종료하고 있어요.".into());
    }
    let db = lock(&state.db)?;
    let tx = db
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    let before = characters::active_members(&tx)?;
    let result = change(&tx)?;
    let after = characters::active_members(&tx)?;
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
pub(crate) fn get_character_packs(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Vec<InstalledCharacterPack>, String> {
    characters::installed_packs(&*lock(&state.db)?)
}
#[tauri::command]
pub(crate) fn apply_character_pack(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    pack_id: String,
) -> Result<(), String> {
    mutate(&state, |db| characters::apply_pack(db, &pack_id))?;
    publish(&app, &state);
    Ok(())
}
#[tauri::command]
pub(crate) fn apply_character_roster(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    ids: Vec<String>,
) -> Result<(), String> {
    mutate(&state, |db| characters::apply_roster(db, ids))?;
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
        characters::pack_json(&pack)?
    };
    character_files::save(app, json).await
}
#[tauri::command]
pub(crate) async fn open_characters(app: tauri::AppHandle) -> Result<(), String> {
    open_settings_section(app, SettingsSection::Characters)
}

#[tauri::command]
pub(crate) fn get_character_pack_attribution(
    state: tauri::State<'_, Arc<AppState>>,
    pack_id: String,
) -> Result<characters::PackAttribution, String> {
    characters::pack_attribution(&*lock(&state.db)?, &pack_id)
}
#[tauri::command]
pub(crate) fn save_character_pack_attribution(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    pack_id: String,
    value: characters::PackAttribution,
) -> Result<(), String> {
    write_sprite(&app, &state, |db| {
        characters::save_pack_attribution(db, &pack_id, &value)
    })
}

#[cfg(test)]
mod tests {
    use super::sprite_response;

    #[test]
    fn sprite_cors_allows_only_app_origins_and_varies_cached_responses() {
        for origin in [
            "tauri://localhost",
            "http://tauri.localhost",
            "https://tauri.localhost",
        ] {
            let response = sprite_response(200, "image/png", vec![1, 2, 3], Some(origin), None);
            assert_eq!(response.status(), 200);
            assert_eq!(response.headers()["Access-Control-Allow-Origin"], origin);
            assert_eq!(response.headers()["Vary"], "Origin");
            assert_eq!(response.headers()["Content-Type"], "image/png");
            assert_eq!(response.body(), &[1, 2, 3]);
            assert!(!response
                .headers()
                .contains_key("Access-Control-Allow-Credentials"));
        }
        for origin in [
            None,
            Some("null"),
            Some("https://example.com"),
            Some("http://tauri.localhost.attacker.test"),
            Some("http://tauri.localhost:1420"),
            Some("http://127.0.0.1:1420"),
        ] {
            let response = sprite_response(200, "image/png", vec![], origin, None);
            assert!(!response
                .headers()
                .contains_key("Access-Control-Allow-Origin"));
            assert_eq!(response.headers()["Vary"], "Origin");
        }
    }

    #[test]
    fn sprite_cors_allows_the_configured_dev_origin_only_in_debug() {
        let dev_url = tauri::Url::parse("http://127.0.0.1:5173/nested/path").unwrap();
        let response = sprite_response(
            200,
            "image/png",
            vec![],
            Some("http://127.0.0.1:5173"),
            Some(&dev_url),
        );
        assert_eq!(
            response.headers().get("Access-Control-Allow-Origin"),
            cfg!(debug_assertions).then_some(&tauri::http::HeaderValue::from_static(
                "http://127.0.0.1:5173"
            ))
        );
        for origin in ["http://127.0.0.1:1420", "http://localhost:5173", "null"] {
            let response = sprite_response(200, "image/png", vec![], Some(origin), Some(&dev_url));
            assert!(!response
                .headers()
                .contains_key("Access-Control-Allow-Origin"));
        }
        let opaque_url = tauri::Url::parse("file:///tmp/index.html").unwrap();
        let response = sprite_response(200, "image/png", vec![], Some("null"), Some(&opaque_url));
        assert!(!response
            .headers()
            .contains_key("Access-Control-Allow-Origin"));
    }

    #[test]
    fn sprite_errors_keep_the_same_cors_contract() {
        for status in [400, 404, 500] {
            let response = sprite_response(
                status,
                "text/plain",
                vec![],
                Some("tauri://localhost"),
                None,
            );
            assert_eq!(response.status(), status);
            assert_eq!(
                response.headers()["Access-Control-Allow-Origin"],
                "tauri://localhost"
            );
            assert_eq!(response.headers()["Vary"], "Origin");
        }
    }
}
