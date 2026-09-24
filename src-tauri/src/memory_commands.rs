use crate::{
    app::{lock, unavailable, AppState},
    nlp::{ModelKind, NlpService, NlpStatus, SearchSettings},
    store,
};
use serde::Serialize;
use std::{path::Path, sync::Arc};
use tauri::Manager;

pub(crate) fn new_nlp(app: &tauri::AppHandle, data: &Path) -> Result<NlpService, String> {
    let (executable, runtime) = if cfg!(debug_assertions) {
        let binaries = Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries");
        let target = if cfg!(windows) {
            "x86_64-pc-windows-msvc.exe"
        } else {
            "aarch64-apple-darwin"
        };
        (
            binaries.join(format!("comet-nlp-{target}")),
            binaries.join("nlp-runtime"),
        )
    } else {
        let executable = std::env::current_exe().map_err(|error| error.to_string())?;
        let parent = executable.parent().ok_or("앱 경로를 찾지 못했어요.")?;
        (
            parent.join(if cfg!(windows) {
                "comet-nlp.exe"
            } else {
                "comet-nlp"
            }),
            app.path()
                .resource_dir()
                .map_err(|error| error.to_string())?
                .join("nlp-runtime"),
        )
    };
    NlpService::new(data.to_path_buf(), executable, runtime)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IndexStatus {
    kiwi_pending: usize,
    semantic_pending: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchStatus {
    nlp: NlpStatus,
    analysis: store::AnalysisStatus,
    index: IndexStatus,
}

fn sync_profiles(db: &rusqlite::Connection, status: &NlpStatus) -> Result<(), String> {
    for (kind, model) in [("kiwi", &status.kiwi), ("semantic", &status.semantic)] {
        store::set_search_profile(
            db,
            kind,
            model.profile.as_deref().filter(|_| model.installed),
        )?;
    }
    Ok(())
}

pub(crate) fn search_terms(tokens: &[crate::nlp::protocol::Token]) -> Vec<String> {
    tokens
        .iter()
        .filter(|token| {
            matches!(
                token.tag.split('-').next().unwrap_or_default(),
                "NNG" | "NNP" | "VV" | "VA" | "VX" | "MAG" | "SL" | "SH" | "SN"
            )
        })
        .map(|token| token.form.clone())
        .collect()
}

#[tauri::command]
pub(crate) fn list_memories(
    state: tauri::State<'_, Arc<AppState>>,
    character_id: String,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<store::MemoryPage, String> {
    store::scoped_memory_page(
        &*lock(&state.db)?,
        &character_id,
        offset.unwrap_or(0),
        limit.unwrap_or(50),
    )
}

#[tauri::command]
pub(crate) fn get_nlp_status(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<SearchStatus, String> {
    let _action = lock(&state.action)?;
    let nlp = state.nlp.status();
    let db = lock(&state.db)?;
    sync_profiles(&db, &nlp)?;
    let pending = |kind: &str, profile: Option<&str>| -> Result<usize, String> {
        profile
            .map(|profile| store::pending_index_count(&db, kind, profile))
            .unwrap_or(Ok(0))
    };
    let index = IndexStatus {
        kiwi_pending: pending("kiwi", nlp.kiwi.profile.as_deref())?,
        semantic_pending: pending("semantic", nlp.semantic.profile.as_deref())?,
    };
    Ok(SearchStatus {
        analysis: store::analysis_status(&db)?,
        index,
        nlp,
    })
}

#[tauri::command]
pub(crate) async fn set_memory_search_settings(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    settings: SearchSettings,
) -> Result<(), String> {
    if unavailable(&state) {
        return Err("앱을 정리하고 있어요.".into());
    }
    if crate::app::cancel_model_test(&state)?.is_some() {
        crate::publish(&app, &state);
    }
    state.nlp.configure(settings).await?;
    let _action = lock(&state.action)?;
    if unavailable(&state) {
        return Err("앱을 정리하고 있어요.".into());
    }
    sync_profiles(&*lock(&state.db)?, &state.nlp.status())
}

#[tauri::command]
pub(crate) async fn download_nlp_model(
    state: tauri::State<'_, Arc<AppState>>,
    model: ModelKind,
) -> Result<(), String> {
    if unavailable(&state) {
        return Err("앱을 정리하고 있어요.".into());
    }
    state.nlp.download(model).await?;
    let _action = lock(&state.action)?;
    if unavailable(&state) {
        return Err("앱을 정리하고 있어요.".into());
    }
    sync_profiles(&*lock(&state.db)?, &state.nlp.status())
}

#[tauri::command]
pub(crate) fn cancel_nlp_download(state: tauri::State<'_, Arc<AppState>>, model: ModelKind) {
    state.nlp.cancel_download(model);
}

#[tauri::command]
pub(crate) async fn remove_nlp_model(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    model: ModelKind,
) -> Result<(), String> {
    if unavailable(&state) {
        return Err("앱을 정리하고 있어요.".into());
    }
    if crate::app::cancel_model_test(&state)?.is_some() {
        crate::publish(&app, &state);
    }
    state.nlp.remove(model).await?;
    let _action = lock(&state.action)?;
    if unavailable(&state) {
        return Err("앱을 정리하고 있어요.".into());
    }
    let kind = match model {
        ModelKind::Kiwi => "kiwi",
        ModelKind::Semantic => "semantic",
    };
    store::clear_search_index(&*lock(&state.db)?, kind)
}

#[tauri::command]
pub(crate) fn retry_memory_analysis(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<usize, String> {
    let _action = lock(&state.action)?;
    if unavailable(&state) {
        return Err("앱을 정리하고 있어요.".into());
    }
    store::retry_deferred_analysis(&*lock(&state.db)?)
}

pub(crate) async fn search_for_turn(
    state: &AppState,
    message_id: &str,
) -> Result<Vec<store::MemorySearchHit>, String> {
    let query = {
        let db = lock(&state.db)?;
        crate::app::conversation::ensure_current_user_message(&db, message_id)?;
        db.query_row(
            "SELECT data FROM messages WHERE id=?1 AND role='user'",
            [message_id],
            |row| row.get::<_, String>(0),
        )
        .map_err(|error| error.to_string())?
    };
    let message: crate::types::Message =
        serde_json::from_str(&query).map_err(|error| error.to_string())?;
    let result = state.nlp.query(&message.content).await;
    let _action = lock(&state.action)?;
    let status = state.nlp.status();
    let db = lock(&state.db)?;
    crate::app::conversation::ensure_current_user_message(&db, message_id)?;
    sync_profiles(&db, &status)?;
    let tokens = result
        .as_ref()
        .filter(|result| {
            status.kiwi.enabled
                && result.kiwi_profile.is_some()
                && result.kiwi_profile == status.kiwi.profile
        })
        .map(|result| search_terms(&result.tokens))
        .unwrap_or_default();
    let semantic = result
        .as_ref()
        .filter(|result| {
            status.semantic.enabled
                && result.semantic_profile.is_some()
                && result.semantic_profile == status.semantic.profile
        })
        .and_then(|result| {
            Some((
                result.semantic_profile.as_deref()?,
                result.embeddings.first()?.vector.as_slice(),
                state.nlp.semantic_threshold()?,
            ))
        });
    let targets = store::message_targets(&db, message_id)?;
    store::search_memories_for(
        &db,
        &message.content,
        &tokens,
        semantic,
        &targets,
        chrono::Utc::now().timestamp_millis(),
    )
}

/// Called from the single maintenance worker; never holds action, DB or gate while awaiting native work.
pub(crate) async fn index_next(state: &AppState) -> Result<(), String> {
    if unavailable(state) {
        return Ok(());
    }
    {
        let runtime = lock(&state.runtime)?;
        if !matches!(
            runtime.phase,
            crate::types::RuntimePhase::Idle | crate::types::RuntimePhase::Error
        ) || lock(&state.panel)?.is_some()
        {
            return Ok(());
        }
    }
    let memory = {
        let _action = lock(&state.action)?;
        let status = state.nlp.status();
        let db = lock(&state.db)?;
        sync_profiles(&db, &status)?;
        index_candidate(&db, &status)?
    };
    let Some(memory) = memory else {
        return Ok(());
    };
    let Some(result) = state.nlp.index(&memory.content).await else {
        return Ok(());
    };
    if unavailable(state) {
        return Ok(());
    }
    let _action = lock(&state.action)?;
    let current = state.nlp.status();
    let db = lock(&state.db)?;
    sync_profiles(&db, &current)?;
    if let Some(profile) = result
        .kiwi_profile
        .as_deref()
        .filter(|profile| current.kiwi.enabled && current.kiwi.profile.as_deref() == Some(*profile))
    {
        let tokens = search_terms(&result.tokens).join(" ");
        store::save_kiwi_index(&db, &memory.id, memory.content_version, profile, &tokens)?;
    }
    if let Some(profile) = result.semantic_profile.as_deref().filter(|profile| {
        current.semantic.enabled && current.semantic.profile.as_deref() == Some(*profile)
    }) {
        let windows = result
            .embeddings
            .into_iter()
            .map(|embedding| store::MemoryEmbedding {
                window_start: embedding.start,
                window_end: embedding.end,
                vector: embedding.vector,
            })
            .collect::<Vec<_>>();
        if !windows.is_empty() {
            store::save_vector_index(&db, &memory.id, memory.content_version, profile, &windows)?;
        }
    }
    Ok(())
}

fn index_candidate(
    db: &rusqlite::Connection,
    status: &NlpStatus,
) -> Result<Option<store::IndexMemory>, String> {
    for (kind, model) in [("kiwi", &status.kiwi), ("semantic", &status.semantic)] {
        if model.installed
            && model.enabled
            && !matches!(
                model.state.as_str(),
                "error" | "unavailable" | "downloading" | "verifying"
            )
        {
            if let Some(profile) = &model.profile {
                if let Some(next) = store::next_memory_for_index(db, kind, profile)? {
                    return Ok(Some(next));
                }
            }
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_failed_kiwi_model_does_not_starve_semantic_indexing() {
        let directory = tempfile::tempdir().unwrap();
        let db = store::open(&directory.path().join("test.sqlite")).unwrap();
        db.execute_batch("INSERT INTO memories(id,content,source,updated) VALUES('first','첫 기억','source-one',2),('second','다음 기억','source-two',1);").unwrap();
        let model = crate::nlp::ModelStatus {
            installed: true,
            enabled: true,
            state: "ready".into(),
            downloaded_bytes: 0,
            total_bytes: 0,
            error: None,
            profile: Some("profile".into()),
        };
        let mut status = NlpStatus {
            settings: SearchSettings {
                kiwi_enabled: true,
                semantic_enabled: true,
            },
            kiwi: model.clone(),
            semantic: model,
            running: true,
            busy: false,
            active_methods: vec!["semantic".into()],
        };
        status.kiwi.state = "error".into();
        sync_profiles(&db, &status).unwrap();
        let mut vector = vec![0.0; 384];
        vector[0] = 1.0;
        store::save_vector_index(
            &db,
            "first",
            1,
            "profile",
            &[store::MemoryEmbedding {
                window_start: 0,
                window_end: "첫 기억".len(),
                vector,
            }],
        )
        .unwrap();
        assert_eq!(index_candidate(&db, &status).unwrap().unwrap().id, "second");
    }

    #[test]
    fn korean_particles_and_endings_are_not_search_terms() {
        let tokens = [
            ("사과", "NNG"),
            ("는", "JX"),
            ("먹", "VV"),
            ("다", "EF"),
            ("것", "NNB"),
            ("맵", "VA-I"),
            ("듣", "VV-R"),
        ]
        .map(|(form, tag)| crate::nlp::protocol::Token {
            form: form.into(),
            tag: tag.into(),
            start: 0,
            end: 0,
        });
        assert_eq!(search_terms(&tokens), vec!["사과", "먹", "맵", "듣"]);
    }
}
