use crate::{
    app, lock, organizer as records, organizer::actions as actions, organizer::runtime as runtime,
    store, AppState,
};
use serde::{Deserialize, Serialize};
use std::{
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use tauri_plugin_dialog::DialogExt;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Status {
    context: SearchContext,
    settings: records::OrganizerSettings,
    vaults: Vec<records::VaultConnection>,
    progress: records::OrganizerStatus,
    paused: bool,
    error: Option<String>,
}
fn status(state: &AppState) -> Result<Status, String> {
    let db = lock(&state.db)?;
    let user = store::active_user_id(&db)?;
    let progress = records::status(&db, &user, &runtime::day())?;
    Ok(Status {
        context: search_context(&db)?,
        settings: records::get_settings(&db, &user)?,
        vaults: records::list_vaults(&db, &user)?,
        error: lock(&state.organizer.error)?
            .clone()
            .or_else(|| progress.latest_error.clone()),
        progress,
        paused: state.organizer.paused.load(Ordering::SeqCst),
    })
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SearchContext {
    user_id: String,
    revision: i64,
}
fn search_context(db: &rusqlite::Connection) -> Result<SearchContext, String> {
    Ok(SearchContext {
        user_id: store::active_user_id(db)?,
        revision: records::scope_revision(db)?,
    })
}

#[derive(Serialize)]
pub(crate) struct SearchTrial {
    context: SearchContext,
    hits: Vec<records::SearchHit>,
}
fn search_trial(
    db: &rusqlite::Connection,
    query: &str,
    expected_context: SearchContext,
) -> Result<SearchTrial, String> {
    let query = query.trim();
    if query.is_empty() || query.chars().count() > 240 {
        return Err("검색어는 1~240자로 입력해 주세요.".into());
    }
    let context = search_context(db)?;
    if context != expected_context {
        return Err("사용자나 검색 연결이 바뀌었어요. 현재 설정에서 다시 검색해 주세요.".into());
    }
    runtime::collect_comet(db, &context.user_id)?;
    let hits = records::search(db, &context.user_id, query, 50)?;
    Ok(SearchTrial { context, hits })
}

#[tauri::command]
pub(crate) fn organizer_search_trial(
    state: tauri::State<'_, Arc<AppState>>,
    query: String,
    expected_context: SearchContext,
) -> Result<SearchTrial, String> {
    search_trial(&*lock(&state.db)?, &query, expected_context)
}

#[tauri::command]
pub(crate) fn organizer_status(state: tauri::State<'_, Arc<AppState>>) -> Result<Status, String> {
    status(&state)
}

#[tauri::command]
pub(crate) fn organizer_save_settings(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    settings: records::OrganizerSettings,
) -> Result<Status, String> {
    runtime::touch(&state);
    runtime::stop_work(&state)?;
    {
        let _action = lock(&state.action)?;
        let db = lock(&state.db)?;
        let user = store::active_user_id(&db)?;
        records::save_settings(&db, &user, &settings)?;
        runtime::collect_comet(&db, &user)?;
    }
    runtime::changed(&app);
    app::publish(&app, &state);
    status(&state)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ConnectionInput {
    root: String,
    include: Vec<String>,
    exclude: Vec<String>,
    output_dir: String,
    automatic: bool,
}

#[tauri::command]
pub(crate) async fn organizer_connect_vault(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    connection: ConnectionInput,
) -> Result<Status, String> {
    runtime::touch(&state);
    runtime::stop_work(&state)?;
    let (user, id) = {
        let _action = lock(&state.action)?;
        let db = lock(&state.db)?;
        let user = store::active_user_id(&db)?;
        let vault = records::connect_vault(
            &db,
            &user,
            Path::new(&connection.root),
            &connection.include,
            &connection.exclude,
            &connection.output_dir,
            connection.automatic,
        )?;
        (user, vault.id)
    };
    runtime::changed(&app);
    let result = runtime::scan(&state, &user, Some(id), Arc::new(AtomicBool::new(false))).await;
    *lock(&state.organizer.error)? = result.err();
    runtime::changed(&app);
    app::publish(&app, &state);
    status(&state)
}

#[tauri::command]
pub(crate) fn organizer_disconnect_vault(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
) -> Result<Status, String> {
    runtime::touch(&state);
    runtime::stop_work(&state)?;
    {
        let _action = lock(&state.action)?;
        let db = lock(&state.db)?;
        records::disconnect_vault(&db, &store::active_user_id(&db)?, &id)?;
    }
    runtime::changed(&app);
    app::publish(&app, &state);
    status(&state)
}

#[tauri::command]
pub(crate) async fn organizer_scan_vault(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
) -> Result<Status, String> {
    let user = store::active_user_id(&*lock(&state.db)?)?;
    let result = runtime::scan(&state, &user, Some(id), Arc::new(AtomicBool::new(false))).await;
    *lock(&state.organizer.error)? = result.err();
    runtime::changed(&app);
    app::publish(&app, &state);
    status(&state)
}

#[tauri::command]
pub(crate) async fn organizer_run(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    retry: Option<bool>,
) -> Result<Status, String> {
    let (epoch, cancel) = {
        let _action = lock(&state.action)?;
        if !matches!(
            lock(&state.runtime)?.phase,
            crate::types::RuntimePhase::Idle | crate::types::RuntimePhase::Error
        ) {
            return Err("진행 중인 대화가 끝난 뒤 실행해 주세요.".into());
        }
        let db = lock(&state.db)?;
        app::conversation::ensure_available(&db)?;
        let user = store::active_user_id(&db)?;
        if retry.unwrap_or(false) {
            records::retry_deferred(&db, &user)?;
        }
        runtime::collect_comet(&db, &user)?;
        records::enqueue_manual_jobs(&db, &user)?;
        state.organizer.paused.store(false, Ordering::SeqCst);
        app::tasks::reserve(&state, app::tasks::Kind::Background, true)?
    };
    let worker = state.inner().clone();
    let handle = app.clone();
    app::tasks::spawn(
        app.clone(),
        state.inner().clone(),
        app::tasks::Kind::Background,
        epoch,
        async move {
            if let Some(_guard) = app::tasks::acquire_gate(&worker, epoch, cancel.clone()).await {
                // A user-triggered batch uses the same daily budget as the initial automatic backlog.
                loop {
                    if !app::is_current(&worker, epoch, &cancel) {
                        break;
                    }
                    match runtime::run_next(&handle, &worker, epoch, cancel.clone(), true).await {
                        Ok(true) => {
                            if lock(&worker.organizer.error).is_ok_and(|e| e.is_some()) {
                                break;
                            }
                        }
                        Ok(false) => break,
                        Err(error) => {
                            if let Ok(mut value) = lock(&worker.organizer.error) {
                                *value = Some(error);
                            }
                            break;
                        }
                    }
                }
            }
            // A cancelled token still needs to release its own loading state, never a newer request.
            app::phase(
                &handle,
                &worker,
                epoch,
                crate::types::RuntimePhase::Idle,
                None,
                None,
            );
            runtime::changed(&handle);
        },
    )?;
    runtime::changed(&app);
    app::publish(&app, &state);
    status(&state)
}

#[tauri::command]
pub(crate) fn organizer_pause(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    paused: bool,
) -> Result<Status, String> {
    state.organizer.paused.store(paused, Ordering::SeqCst);
    if paused {
        runtime::touch(&state);
        if state.organizer.active_epoch.load(Ordering::SeqCst) == state.epoch.load(Ordering::SeqCst)
        {
            if let Some(cancel) = &*lock(&state.cancellation)? {
                cancel.store(true, Ordering::SeqCst);
            }
        }
    } else {
        state.organizer.next_check.store(0, Ordering::SeqCst);
    }
    runtime::changed(&app);
    app::publish(&app, &state);
    status(&state)
}

#[tauri::command]
pub(crate) fn organizer_touch(state: tauri::State<'_, Arc<AppState>>) {
    runtime::touch(&state);
}

#[tauri::command]
pub(crate) fn organizer_search(
    state: tauri::State<'_, Arc<AppState>>,
    query: String,
) -> Result<Vec<records::SearchHit>, String> {
    let db = lock(&state.db)?;
    let user = store::active_user_id(&db)?;
    runtime::collect_comet(&db, &user)?;
    records::search(&db, &user, &query, 50)
}

#[tauri::command]
pub(crate) fn organizer_records(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Vec<records::OrganizerRecord>, String> {
    let db = lock(&state.db)?;
    records::list_records(&db, &store::active_user_id(&db)?, 500)
}

#[tauri::command]
pub(crate) fn organizer_actions(
    state: tauri::State<'_, Arc<AppState>>,
    input_id: Option<String>,
) -> Result<Vec<actions::Receipt>, String> {
    let db = lock(&state.db)?;
    actions::receipts(&db, &store::active_user_id(&db)?, input_id.as_deref())
}

#[tauri::command]
pub(crate) fn organizer_open_source(
    state: tauri::State<'_, Arc<AppState>>,
    source_id: String,
    record_id: Option<String>,
) -> Result<records::SourceDocument, String> {
    let db = lock(&state.db)?;
    let user = store::active_user_id(&db)?;
    if let Some(id) = record_id {
        let record = records::list_records(&db, &user, 500)?
            .into_iter()
            .find(|r| r.id == id && r.source.id == source_id)
            .ok_or("정리 기록을 찾지 못했어요.")?;
        // Revalidate the source permission before returning even a stored summary.
        records::read_sources(&db, &user, std::slice::from_ref(&source_id))?;
        return Ok(records::SourceDocument {
            source: record.source,
            content: record.markdown,
        });
    }
    records::read_sources(&db, &user, &[source_id])?
        .into_iter()
        .next()
        .ok_or_else(|| "원문을 찾지 못했어요.".into())
}

#[tauri::command]
pub(crate) fn organizer_undo(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    operation_id: String,
) -> Result<(), String> {
    runtime::touch(&state);
    runtime::stop_work(&state)?;
    app::publish(&app, &state);
    {
        let _action = lock(&state.action)?;
        let db = lock(&state.db)?;
        let user = store::active_user_id(&db)?;
        if crate::widgets::generated::actions::receipt(&db, &user, &operation_id)?.is_some() {
            crate::widgets::generated::actions::undo(&db, &user, &operation_id)?;
        } else if actions::receipts(&db, &user, None)?
            .iter()
            .any(|r| r.id == operation_id && r.kind != "summary")
        {
            actions::undo(&db, &user, &operation_id)?;
        } else {
            records::undo_record(&db, &user, &operation_id)?;
        }
    }
    runtime::publish_changes(&app, &state);
    crate::widgets::generated::commands::publish(&app);
    Ok(())
}

#[tauri::command]
pub(crate) fn organizer_open_action(
    state: tauri::State<'_, Arc<AppState>>,
    operation_id: String,
) -> Result<records::SourceDocument, String> {
    let db = lock(&state.db)?;
    let user = store::active_user_id(&db)?;
    if let Some(receipt) = crate::widgets::generated::actions::receipt(&db, &user, &operation_id)? {
        let content = format!(
            "{}\n{}",
            if receipt.undone {
                "되돌린 위젯 작업"
            } else {
                "위젯 작업 결과"
            },
            serde_json::to_string_pretty(&receipt.result).map_err(|error| error.to_string())?
        );
        return Ok(records::SourceDocument {
            source: records::SourceRef {
                id: receipt.id,
                user_id: user,
                workspace_id: "comet".into(),
                project_id: String::new(),
                kind: receipt.action_id,
                locator: receipt.widget_id,
                title: receipt.title,
                content_hash: records::hash(&content),
                active: true,
            },
            content,
        });
    }
    actions::open_result(&db, &user, &operation_id)
}

#[tauri::command]
pub(crate) fn organizer_open_records(app: tauri::AppHandle) -> Result<(), String> {
    crate::widgets::planning::windows::open(&app, "organizer")
}

#[tauri::command]
pub(crate) async fn organizer_pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let (send, receive) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Ex-brain Vault 폴더 선택")
        .pick_folder(move |folder| {
            let _ = send.send(folder);
        });
    receive
        .await
        .map_err(|e| e.to_string())?
        .map(|path| {
            path.into_path()
                .map(|p| p.to_string_lossy().into_owned())
                .map_err(|e| e.to_string())
        })
        .transpose()
}

#[cfg(test)]
mod search_trial_tests {
    use super::*;
    use crate::types::Message;

    fn database() -> rusqlite::Connection {
        let db = store::open(Path::new(":memory:")).unwrap();
        store::set_user_name(&db, "검색 검사", 1).unwrap();
        db
    }

    #[test]
    fn search_trial_uses_saved_scope_and_preserves_settings_messages_and_external_files() {
        let db = database();
        let user = store::active_user_id(&db).unwrap();
        let settings = records::OrganizerSettings {
            comet_enabled: true,
            ..Default::default()
        };
        records::save_settings(&db, &user, &settings).unwrap();
        store::insert_user_input(
            &db,
            &Message {
                id: "search-input".into(),
                role: "user".into(),
                persona: Some("builtin-a".into()),
                content: "회의에서 정한 다음 작업".into(),
                expression: None,
                created_at: 2,
                status: "complete".into(),
            },
            false,
        )
        .unwrap();
        let root = tempfile::tempdir().unwrap();
        let content = "# 회의 메모\n\n아직 정리하지 않은 원문";
        std::fs::write(root.path().join("회의.md"), content).unwrap();
        let vault =
            records::connect_vault(&db, &user, root.path(), &[], &[], "Comet", false).unwrap();
        records::scan_vault(&db, &user, &vault.id, &AtomicBool::new(false)).unwrap();
        let context = search_context(&db).unwrap();
        let messages = serde_json::to_value(store::messages(&db, 100).unwrap()).unwrap();
        let model = serde_json::to_value(store::settings(&db).unwrap()).unwrap();
        let result = search_trial(&db, "  회의  ", context.clone()).unwrap();
        assert_eq!(result.context, context);
        assert!(result
            .hits
            .iter()
            .any(|hit| hit.source.kind == "conversation"));
        assert!(result.hits.iter().any(|hit| hit.source.kind == "vault"));
        assert!(result.hits.iter().all(|hit| hit.source.user_id == user));
        assert_eq!(
            serde_json::to_value(records::get_settings(&db, &user).unwrap()).unwrap(),
            serde_json::to_value(settings).unwrap()
        );
        assert_eq!(
            serde_json::to_value(store::messages(&db, 100).unwrap()).unwrap(),
            messages
        );
        assert_eq!(
            serde_json::to_value(store::settings(&db).unwrap()).unwrap(),
            model
        );
        assert_eq!(
            std::fs::read_to_string(root.path().join("회의.md")).unwrap(),
            content
        );
        assert!(!root.path().join("Comet").exists());
        assert_eq!(search_context(&db).unwrap(), context);
        assert_eq!(
            records::status(&db, &user, &runtime::day())
                .unwrap()
                .requests_today,
            0
        );
    }

    #[test]
    fn search_trial_rejects_blank_oversized_and_saved_scope_a_b_a_before_collecting() {
        let db = database();
        let user = store::active_user_id(&db).unwrap();
        let settings = records::OrganizerSettings::default();
        records::save_settings(&db, &user, &settings).unwrap();
        let original = search_context(&db).unwrap();
        for query in ["  ".to_string(), "가".repeat(241)] {
            assert!(search_trial(&db, &query, original.clone()).is_err());
        }
        records::save_settings(
            &db,
            &user,
            &records::OrganizerSettings {
                comet_enabled: true,
                ..settings.clone()
            },
        )
        .unwrap();
        records::save_settings(&db, &user, &settings).unwrap();
        assert!(search_context(&db).unwrap().revision > original.revision);
        assert!(search_trial(&db, "회의", original).is_err());
        let source_count: i64 = db
            .query_row("SELECT COUNT(*) FROM organizer_sources", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(source_count, 0);
        assert!(search_trial(&db, "회의", search_context(&db).unwrap())
            .unwrap()
            .hits
            .is_empty());
    }

    #[test]
    fn active_user_a_b_a_invalidates_saved_search_context_without_changing_settings() {
        let db = database();
        let original = search_context(&db).unwrap();
        let other = serde_json::to_string("another-user").unwrap();
        db.execute(
            "UPDATE kv SET value=?1 WHERE key='active_user_id'",
            [&other],
        )
        .unwrap();
        assert!(search_trial(&db, "회의", original.clone()).is_err());
        let returned = serde_json::to_string(&original.user_id).unwrap();
        db.execute(
            "UPDATE kv SET value=?1 WHERE key='active_user_id'",
            [&returned],
        )
        .unwrap();
        let current = search_context(&db).unwrap();
        assert_eq!(current.user_id, original.user_id);
        assert!(current.revision > original.revision);
        assert!(search_trial(&db, "회의", original).is_err());
        assert!(search_trial(&db, "회의", current).unwrap().hits.is_empty());
    }
}
