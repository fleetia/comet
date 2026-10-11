use crate::{
    app, lock, organizer as records, organizer_actions as actions, organizer_runtime as runtime,
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
        settings: records::get_settings(&db, &user)?,
        vaults: records::list_vaults(&db, &user)?,
        error: lock(&state.organizer.error)?
            .clone()
            .or_else(|| progress.latest_error.clone()),
        progress,
        paused: state.organizer.paused.load(Ordering::SeqCst),
    })
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
    {
        let _action = lock(&state.action)?;
        let db = lock(&state.db)?;
        let user = store::active_user_id(&db)?;
        if actions::receipts(&db, &user, None)?
            .iter()
            .any(|r| r.id == operation_id && r.kind != "summary")
        {
            actions::undo(&db, &user, &operation_id)?;
        } else {
            records::undo_record(&db, &user, &operation_id)?;
        }
    }
    runtime::publish_changes(&app, &state);
    Ok(())
}

#[tauri::command]
pub(crate) fn organizer_open_action(
    state: tauri::State<'_, Arc<AppState>>,
    operation_id: String,
) -> Result<records::SourceDocument, String> {
    let db = lock(&state.db)?;
    actions::open_result(&db, &store::active_user_id(&db)?, &operation_id)
}

#[tauri::command]
pub(crate) fn organizer_open_records(app: tauri::AppHandle) -> Result<(), String> {
    crate::planner_windows::open(&app, "organizer")
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
