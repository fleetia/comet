use crate::{
    app::{self, lock, AppState},
    characters,
    pack_stories::{self, PackStoryDefinition, PackStoryDefinitionSnapshot, TrialTrace},
    store,
};
use std::sync::Arc;

#[tauri::command]
pub(crate) fn get_pack_story_definition(
    state: tauri::State<'_, Arc<AppState>>,
    pack_id: String,
) -> Result<PackStoryDefinitionSnapshot, String> {
    let db = lock(&state.db)?;
    characters::get_pack_story_definition(&db, &pack_id)
}

#[tauri::command]
pub(crate) fn save_pack_story_definition(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    pack_id: String,
    definition: PackStoryDefinition,
    expected_baseline: String,
) -> Result<PackStoryDefinitionSnapshot, String> {
    let saved = {
        let _action = lock(&state.action)?;
        if app::unavailable(&state) {
            return Err("앱을 종료하고 있어요.".into());
        }
        let db = lock(&state.db)?;
        let tx = db
            .unchecked_transaction()
            .map_err(|error| error.to_string())?;
        let saved = characters::save_pack_story_definition_expected(
            &tx,
            &pack_id,
            &definition,
            &expected_baseline,
        )?;
        let changed = saved.baseline != expected_baseline;
        if changed {
            store::bump_revision(&tx)?;
        }
        tx.commit().map_err(|error| error.to_string())?;
        if changed {
            app::interrupt_with_db(&state, false, &db)?;
        }
        saved
    };
    app::publish(&app, &state);
    Ok(saved)
}

#[tauri::command]
pub(crate) fn trial_pack_story(
    definitions: Vec<characters::CharacterDefinition>,
    definition: PackStoryDefinition,
    scenario_id: String,
    flags: Vec<String>,
    affinity: i32,
    inputs: Vec<String>,
) -> Result<TrialTrace, String> {
    if definitions.is_empty()
        || definitions.len() > characters::MAX_ROSTER
        || !(0..=100).contains(&affinity)
        || inputs.len() > 32
        || inputs.iter().any(|input| input.chars().count() > 500)
        || flags.len() > definition.story_flags.len()
        || flags
            .iter()
            .any(|flag| !definition.story_flags.iter().any(|known| known.id == *flag))
        || flags
            .iter()
            .collect::<std::collections::BTreeSet<_>>()
            .len()
            != flags.len()
    {
        return Err("시험할 인물·입력·조건을 확인해 주세요.".into());
    }
    for actor in &definitions {
        characters::validate_definition(actor)?;
    }
    pack_stories::trial(
        &definitions,
        &definition,
        &scenario_id,
        &flags,
        affinity,
        &inputs,
    )
}

#[tauri::command]
pub(crate) fn trial_pack_authoring(
    request: pack_stories::AuthoringTrialRequest,
) -> Result<pack_stories::AuthoringTrialTrace, String> {
    pack_stories::authoring_trial(request)
}
