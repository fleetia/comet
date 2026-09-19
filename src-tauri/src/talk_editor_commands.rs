use crate::{
    app::{interrupt, lock, publish, AppState},
    story_editor, talk,
};
use std::sync::Arc;

#[tauri::command]
pub(crate) fn list_talk_files(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Vec<String>, String> {
    let mut files = talk::editor::list_files(&state.app_data.join("talk/index.talk"))?;
    if state.app_data.join(story_editor::PATH).is_file() {
        files.push(story_editor::PATH.into());
    }
    Ok(files)
}

#[tauri::command]
pub(crate) fn read_talk_file(
    state: tauri::State<'_, Arc<AppState>>,
    path: String,
) -> Result<talk::editor::EditorDocument, String> {
    if path == story_editor::PATH {
        return story_editor::read(&state.app_data);
    }
    talk::editor::read_file(&state.app_data.join("talk/index.talk"), &path)
}

#[tauri::command]
pub(crate) fn save_talk_file(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    path: String,
    source: String,
    expected_revision: String,
) -> Result<talk::editor::EditorDocument, String> {
    let _action = lock(&state.action)?;
    if path == story_editor::PATH {
        let document = story_editor::save(&state.app_data, &source, &expected_revision)?;
        *lock(&state.story_catalog)? = story_editor::validate(&document.source)?;
        if lock(&state.story)?.is_some() {
            interrupt(&state, false)?;
            let mut runtime = lock(&state.runtime)?;
            runtime.phase = "idle".into();
            runtime.persona = None;
        }
        drop(_action);
        publish(&app, &state);
        return Ok(document);
    }
    talk::editor::save_file(
        &state.app_data.join("talk/index.talk"),
        &path,
        &source,
        &expected_revision,
        &talk::context::registry(),
    )
    .map_err(|errors| {
        errors
            .iter()
            .map(|error| {
                format!(
                    "{}:{}:{} [{}] {}",
                    error.path, error.line, error.column, error.code, error.message
                )
            })
            .collect::<Vec<_>>()
            .join("\n")
    })
}
