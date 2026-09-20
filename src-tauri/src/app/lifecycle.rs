use super::interrupt;
use super::windows::{hide_boxes, show_boxes, skip_talk};
use super::{
    background::background_loop, conversation, lock, now, open_session, settings, snapshot,
    windows, AppState,
};
use super::{publish, schedule_idle, unavailable};
use crate::widget_backgrounds::{self, SCHEME as WIDGET_BACKGROUND_SCHEME};
use crate::{behavior, desktop_menu, desktop_toys, updater};
use crate::{
    character_commands::{self, serve_sprite, SPRITE_SCHEME},
    desktop, device_wake, inference, store, story, story_host, talk_host,
    types::*,
    widget_commands::{self, cancel_widget_jobs, open_widgets},
    widget_connections, widgets,
};
use std::{
    collections::HashMap,
    fs, io,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{Manager, WindowEvent};

pub(crate) fn resource_paths(app: &tauri::AppHandle) -> Result<(PathBuf, PathBuf), String> {
    if cfg!(debug_assertions) {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries");
        let target = if cfg!(target_os = "macos") {
            "aarch64-apple-darwin"
        } else {
            "x86_64-pc-windows-msvc"
        };
        let suffix = if cfg!(target_os = "windows") {
            ".exe"
        } else {
            ""
        };
        return Ok((
            root.join(format!("llama-server-{target}{suffix}")),
            root.join("runtime"),
        ));
    }
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    let parent = executable.parent().ok_or("앱 경로를 찾지 못했어요.")?;
    Ok((
        parent.join(if cfg!(windows) {
            "llama-server.exe"
        } else {
            "llama-server"
        }),
        app.path()
            .resource_dir()
            .map_err(|e| e.to_string())?
            .join("runtime"),
    ))
}

const DATABASE_FILE: &str = "comet.sqlite";

fn merge_missing_entries(source: &Path, destination: &Path) -> io::Result<()> {
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        if !destination_path.exists() {
            fs::rename(source_path, destination_path)?;
            continue;
        }
        let source_type = fs::symlink_metadata(&source_path)?.file_type();
        let destination_type = fs::symlink_metadata(&destination_path)?.file_type();
        if source_type.is_dir() && destination_type.is_dir() {
            merge_missing_entries(&source_path, &destination_path)?;
        }
    }
    Ok(())
}

pub(crate) fn migrate_app_data(app_data: &Path) -> io::Result<()> {
    let Some(parent) = app_data.parent() else {
        return Ok(());
    };
    let legacy = parent.join(crate::legacy_names::app_identifier());
    if legacy.exists() {
        let legacy_type = fs::symlink_metadata(&legacy)?.file_type();
        if legacy_type.is_symlink() || !legacy_type.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "기존 Comet 데이터 위치가 디렉터리가 아닙니다.",
            ));
        }
        if app_data.exists() {
            let current_type = fs::symlink_metadata(app_data)?.file_type();
            if current_type.is_symlink() || !current_type.is_dir() {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "Comet 데이터 위치가 디렉터리가 아닙니다.",
                ));
            }
            merge_missing_entries(&legacy, app_data)?;
        } else {
            fs::rename(&legacy, app_data)?;
        }
    }
    let old_database = app_data.join(crate::legacy_names::database_file());
    let new_database = app_data.join(DATABASE_FILE);
    if old_database.exists() && !new_database.exists() {
        fs::rename(old_database, new_database)?;
    }
    let old_database_name = crate::legacy_names::database_file();
    for suffix in ["-shm", "-wal"] {
        let old_sidecar = app_data.join(format!("{old_database_name}{suffix}"));
        let new_sidecar = app_data.join(format!("{DATABASE_FILE}{suffix}"));
        if old_sidecar.exists() && !new_sidecar.exists() {
            fs::rename(old_sidecar, new_sidecar)?;
        }
    }
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .manage(crate::character_collision_host::Runtime::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .register_uri_scheme_protocol(SPRITE_SCHEME, serve_sprite)
        .register_uri_scheme_protocol(WIDGET_BACKGROUND_SCHEME, widget_backgrounds::serve)
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(state) = app.try_state::<Arc<AppState>>() {
                show_boxes(app, &state);
            }
        }))
        .setup(|app| {
            let app_data = app.path().app_data_dir()?;
            migrate_app_data(&app_data)?;
            std::fs::create_dir_all(&app_data)?;
            let (sidecar, runtime) = resource_paths(app.handle()).map_err(std::io::Error::other)?;
            let talk = talk_host::initialize(&app_data);
            if let Err(error) = story::initialize_files(&app_data) {
                eprintln!("Story initialization: {error}");
            }
            let story_catalog = story::load(&app_data)
                .or_else(|_| story::catalog())
                .map_err(std::io::Error::other)?;
            let state = Arc::new(AppState {
                db: Mutex::new(
                    open_session(&app_data.join(DATABASE_FILE)).map_err(std::io::Error::other)?,
                ),
                inference: inference::Inference::new(app_data.clone(), sidecar, runtime),
                app_data,
                runtime: Mutex::new(RuntimeStatus::default()),
                playback: Mutex::new(None),
                panel: Mutex::new(None),
                cancellation: Mutex::new(None),
                download_cancel: Mutex::new(None),
                gate: tokio::sync::Mutex::new(()),
                epoch: AtomicU64::new(0),
                widget_epoch: AtomicU64::new(0),
                widget_playback: Mutex::new(None),
                talk: Mutex::new(talk),
                talk_playback: Mutex::new(None),
                talk_turn: AtomicBool::new(true),
                story: Mutex::new(None),
                story_clock: Mutex::new(story::Clock::default()),
                story_catalog: Mutex::new(story_catalog),
                widget_jobs: Mutex::new(HashMap::new()),
                widget_clocks: Mutex::new(std::collections::BTreeMap::new()),
                last_input: AtomicI64::new(now()),
                last_foreground: AtomicI64::new(now()),
                last_scene: AtomicI64::new(now()),
                next_idle: AtomicI64::new(now() + 5),
                last_preparation: AtomicI64::new(0),
                last_background_check: AtomicI64::new(0),
                idle_sequence: AtomicU64::new(0),
                action: Mutex::new(()),
                automatic: AtomicBool::new(false),
                stopping: AtomicBool::new(false),
                update_installing: AtomicBool::new(false),
                behavior: Mutex::new(behavior::Machine::default()),
                positions: Mutex::new(HashMap::new()),
            });
            app.manage(state.clone());
            app.manage(desktop_toys::Runtime::default());
            app.manage(updater::UpdateState::default());
            crate::memo_notes::schedule_sync(app.handle());
            lock(&state.runtime).map_err(std::io::Error::other)?.hidden =
                !behavior::preferences(&*lock(&state.db).map_err(std::io::Error::other)?)
                    .map_err(std::io::Error::other)?
                    .characters_visible;
            desktop::create_boxes(app.handle(), &state).map_err(std::io::Error::other)?;
            desktop_menu::create(app.handle()).map_err(std::io::Error::other)?;
            if let Err(error) = device_wake::install(app.handle()) {
                eprintln!("기기 복귀 알림 연결 실패: {error}");
            }
            if !widgets::storage::snapshot(&*lock(&state.db).map_err(std::io::Error::other)?)
                .map_err(std::io::Error::other)?
                .onboarding_done
            {
                open_widgets(app.handle().clone()).map_err(std::io::Error::other)?;
            }
            let handle = app.handle().clone();
            talk_host::watch(handle.clone(), state.clone());
            tauri::async_runtime::spawn(story_host::run_clock(handle.clone(), state.clone()));
            desktop_toys::start(handle.clone());
            updater::start(handle.clone());
            tauri::async_runtime::spawn(background_loop(handle, state));
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "balloon" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let app = window.app_handle();
                    let _ = skip_talk(app.clone(), app.state::<Arc<AppState>>());
                }
                return;
            }
            let face = desktop::is_face(window.label());
            if !face && !desktop::is_body(window.label()) {
                return;
            }
            if !face {
                match event {
                    WindowEvent::Moved(_)
                    | WindowEvent::Resized(_)
                    | WindowEvent::ScaleFactorChanged { .. }
                    | WindowEvent::Focused(_) => crate::character_collision_host::refresh(
                        window.app_handle(),
                        window.label(),
                    ),
                    WindowEvent::Destroyed => {
                        crate::character_collision_host::remove(window.app_handle(), window.label())
                    }
                    _ => {}
                }
            }
            let state = window.state::<Arc<AppState>>();
            match event {
                WindowEvent::Moved(pos) => {
                    if let Ok(mut positions) = lock(&state.positions) {
                        positions.insert(
                            window.label().into(),
                            (
                                WindowPosition {
                                    x: pos.x as f64,
                                    y: pos.y as f64,
                                },
                                Instant::now(),
                            ),
                        );
                    }
                    if !face {
                        if let Ok(data) = snapshot(&state) {
                            desktop::sync_balloon(window.app_handle(), &data);
                        }
                    }
                }
                WindowEvent::CloseRequested { api, .. } if face => {
                    api.prevent_close();
                    if let Some(view) = window.app_handle().get_webview_window(window.label()) {
                        let _ = desktop::hide_ambient(&view);
                    }
                }
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let app = window.app_handle().clone();
                    tauri::async_runtime::spawn(async move {
                        let state = app.state::<Arc<AppState>>();
                        let _ = hide_boxes(app.clone(), state).await;
                    });
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            super::get_snapshot,
            behavior::get_desktop_preferences,
            behavior::set_desktop_preferences,
            behavior::clear_desktop_toys,
            desktop_toys::desktop_toy_action,
            crate::character_collision_host::set_character_collision,
            updater::get_update_status,
            updater::check_app_update,
            updater::install_app_update,
            crate::memo_notes::create_memo_note,
            crate::memo_notes::open_memo_note,
            crate::memo_notes::close_memo_note,
            crate::memo_notes::request_close_memo_note,
            crate::memo_notes::save_memo_note,
            widget_commands::get_widgets,
            widget_commands::install_widgets,
            widget_commands::finish_widget_onboarding,
            widget_commands::set_widget_enabled,
            widget_commands::remove_widget,
            widget_commands::execute_widget,
            widget_commands::configure_widget_appearance,
            widget_commands::choose_widget_background,
            widget_commands::remove_widget_background,
            widget_commands::get_widget_journal,
            widget_commands::open_widgets,
            widget_commands::close_widgets,
            widget_commands::open_widget,
            widget_commands::close_widget,
            widget_commands::open_widget_display,
            widget_commands::close_widget_display,
            widget_connections::connect_calendar_ics,
            widget_connections::connect_calendar_google,
            widget_connections::refresh_calendar,
            widget_connections::disconnect_calendar,
            widget_connections::configure_connection_widget,
            widget_connections::refresh_connection_widget,
            widget_connections::search_weather_regions,
            widget_connections::open_widget_link,
            character_commands::open_characters,
            character_commands::create_character,
            character_commands::save_character,
            character_commands::get_character_dialogue,
            character_commands::save_character_dialogue,
            character_commands::clone_character,
            character_commands::apply_character_roster,
            character_commands::get_character_packs,
            character_commands::apply_character_pack,
            character_commands::remove_character,
            character_commands::preview_character_pack,
            character_commands::choose_character_pack,
            character_commands::import_character_pack,
            character_commands::save_character_pack,
            character_commands::get_character_pack_attribution,
            character_commands::save_character_pack_attribution,
            crate::talk_commands::get_talk_packs,
            crate::talk_commands::install_talk_pack,
            crate::talk_commands::remove_talk_pack,
            character_commands::choose_character_sprite,
            character_commands::remove_character_sprite,
            windows::open_panel,
            windows::close_panel,
            windows::skip_talk,
            windows::talk_now,
            windows::resize_balloon,
            settings::save_wordbook_entry,
            settings::delete_wordbook_entry,
            conversation::send_message,
            conversation::retry_turn,
            windows::cancel_generation,
            settings::save_settings,
            settings::clear_api_key,
            settings::test_connection,
            settings::test_local_model,
            settings::pick_model_file,
            settings::download_model,
            settings::cancel_download,
            settings::edit_memory,
            settings::delete_memory,
            windows::open_settings,
            windows::hide_boxes,
            windows::set_paused,
            windows::quit_app,
            story_host::choose_story,
            story_host::defer_story,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build comet")
        .run(|app, event| match event {
            tauri::RunEvent::ExitRequested { api, code, .. } => {
                if code == Some(tauri::RESTART_EXIT_CODE) {
                    return;
                }
                desktop_toys::clear(app);
                device_wake::shutdown(app);
                if let Some(state) = app.try_state::<Arc<AppState>>() {
                    let _ = prepare_exit(&state);
                    let state = state.inner().clone();
                    api.prevent_exit();
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let _gate = state.gate.lock().await;
                        inference::stop_local(&state.inference).await;
                        let exit_app = app.clone();
                        if let Err(error) = app.run_on_main_thread(move || {
                            exit_app.cleanup_before_exit();
                            std::process::exit(0);
                        }) {
                            eprintln!("Failed to finish shutdown on the main thread: {error}");
                        }
                    });
                }
            }
            tauri::RunEvent::Exit => {
                device_wake::shutdown(app);
                if let Some(state) = app.try_state::<Arc<AppState>>() {
                    let _ = prepare_exit(&state);
                    // Native macOS termination can skip ExitRequested. Finish before returning to Cocoa.
                    tauri::async_runtime::block_on(inference::stop_local(&state.inference));
                }
            }
            _ => {}
        });
}

pub(crate) fn prepare_exit(state: &AppState) -> Result<(), String> {
    {
        let _action = lock(&state.action)?;
        state.stopping.store(true, Ordering::SeqCst);
        lock(&state.runtime)?.hidden = true;
        interrupt(state, false)?;
    }
    if let Some(cancel) = lock(&state.download_cancel)?.as_ref() {
        cancel.store(true, Ordering::SeqCst);
    }
    cancel_widget_jobs(state, None)?;
    flush_positions(state, true)
}

pub(crate) fn flush_positions(state: &AppState, all: bool) -> Result<(), String> {
    let mut positions = lock(&state.positions)?;
    let due = positions
        .iter()
        .filter(|(_, (_, at))| all || at.elapsed() > Duration::from_millis(500))
        .map(|(id, (pos, _))| (id.clone(), pos.clone()))
        .collect::<Vec<_>>();
    let db = lock(&state.db)?;
    for (id, pos) in due {
        store::set_window_position(&db, &id, &pos)?;
        positions.remove(&id);
    }
    Ok(())
}

pub(crate) async fn prepare_update_install(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<Arc<AppState>>();
    {
        let _action = lock(&state.action)?;
        if unavailable(&state) {
            return Err("앱을 정리하고 있어요.".into());
        }
        state.update_installing.store(true, Ordering::SeqCst);
        interrupt(&state, false)?;
        *lock(&state.panel)? = None;
        lock(&state.runtime)?.phase = "idle".into();
        if let Some(cancel) = lock(&state.download_cancel)?.as_ref() {
            cancel.store(true, Ordering::SeqCst);
        }
        cancel_widget_jobs(&state, None)?;
    }
    desktop_toys::clear(app);
    flush_positions(&state, true)?;
    publish(app, &state);
    let _gate = state.gate.lock().await;
    inference::stop_local(&state.inference).await;
    lock(&state.db)?
        .execute_batch("PRAGMA wal_checkpoint(FULL);")
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub(crate) fn restore_update_install(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<Arc<AppState>>();
    {
        let _action = lock(&state.action)?;
        state.update_installing.store(false, Ordering::SeqCst);
        schedule_idle(&state, store::settings(&*lock(&state.db)?)?.idle_minutes);
    }
    publish(app, &state);
    Ok(())
}

#[cfg(test)]
mod migration_tests {
    use super::*;

    #[test]
    fn moves_legacy_directory_and_database_without_losing_entries() {
        let root = tempfile::tempdir().unwrap();
        let app_data = root.path().join("space.starlight.comet");
        let legacy = root.path().join(crate::legacy_names::app_identifier());
        fs::create_dir_all(legacy.join("models")).unwrap();
        fs::write(
            legacy.join(crate::legacy_names::database_file()),
            b"database",
        )
        .unwrap();
        fs::write(
            legacy.join(format!("{}-wal", crate::legacy_names::database_file())),
            b"wal",
        )
        .unwrap();
        fs::write(
            legacy.join(format!("{}-shm", crate::legacy_names::database_file())),
            b"shm",
        )
        .unwrap();
        fs::write(legacy.join("models").join("model.gguf"), b"model").unwrap();

        migrate_app_data(&app_data).unwrap();

        assert_eq!(fs::read(app_data.join(DATABASE_FILE)).unwrap(), b"database");
        assert_eq!(
            fs::read(app_data.join(format!("{DATABASE_FILE}-wal"))).unwrap(),
            b"wal"
        );
        assert_eq!(
            fs::read(app_data.join(format!("{DATABASE_FILE}-shm"))).unwrap(),
            b"shm"
        );
        assert_eq!(
            fs::read(app_data.join("models").join("model.gguf")).unwrap(),
            b"model"
        );
        assert!(!legacy.exists());
    }

    #[test]
    fn merges_only_missing_entries_when_new_directory_already_exists() {
        let root = tempfile::tempdir().unwrap();
        let app_data = root.path().join("space.starlight.comet");
        let legacy = root.path().join(crate::legacy_names::app_identifier());
        fs::create_dir_all(&app_data).unwrap();
        fs::create_dir_all(&legacy).unwrap();
        fs::write(app_data.join("keep.txt"), b"new").unwrap();
        fs::write(legacy.join("keep.txt"), b"old").unwrap();
        fs::write(
            legacy.join(crate::legacy_names::database_file()),
            b"database",
        )
        .unwrap();

        migrate_app_data(&app_data).unwrap();

        assert_eq!(fs::read(app_data.join("keep.txt")).unwrap(), b"new");
        assert_eq!(fs::read(app_data.join(DATABASE_FILE)).unwrap(), b"database");
        assert!(legacy.exists());
    }
}
