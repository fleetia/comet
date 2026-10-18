use super::interrupt;
use super::windows::{hide_boxes, show_boxes, skip_talk};
use super::{
    background::background_loop, conversation, launcher, lock, now, open_session, settings,
    snapshot, windows, AppState,
};
use super::{publish, schedule_idle, unavailable};
use crate::widgets::backgrounds::SCHEME as WIDGET_BACKGROUND_SCHEME;
use crate::{
    behavior,
    characters::{
        self,
        commands::{serve_sprite, SPRITE_SCHEME},
    },
    desktop, device, inference, store, story, talk,
    types::*,
    updater,
    widgets::{self, commands::cancel_widget_jobs},
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
use tauri_plugin_dialog::DialogExt;

pub(crate) fn resource_paths(app: &tauri::AppHandle) -> Result<(PathBuf, PathBuf), String> {
    if cfg!(debug_assertions) {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries");
        return Ok((
            crate::sidecar::development_executable("llama-server"),
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
    if app_data.file_name() != Some(std::ffi::OsStr::new("space.starlight.comet")) {
        return Ok(());
    }
    let Some(parent) = app_data.parent() else {
        return Ok(());
    };
    let old_database_name = crate::legacy_names::database_file();
    let old_database = app_data.join(&old_database_name);
    let new_database = app_data.join(DATABASE_FILE);
    if !new_database.exists()
        && !old_database.exists()
        && [DATABASE_FILE, old_database_name.as_str()]
            .iter()
            .any(|database| {
                ["-wal", "-shm"]
                    .iter()
                    .any(|suffix| app_data.join(format!("{database}{suffix}")).exists())
            })
    {
        return Err(io::Error::new(io::ErrorKind::AlreadyExists,
            "데이터베이스 본체 없이 WAL/SHM 파일이 남아 있습니다. 이전 전에 연결 파일을 확인해 주세요."));
    }
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
            if new_database.exists() || old_database.exists() {
                // A database and its WAL belong to one source. Never fill a current
                // database's missing sidecars from the legacy directory.
                for entry in fs::read_dir(&legacy)? {
                    let entry = entry?;
                    let name = entry.file_name();
                    if [DATABASE_FILE, old_database_name.as_str()]
                        .iter()
                        .any(|database| {
                            ["", "-wal", "-shm"]
                                .iter()
                                .any(|suffix| name == format!("{database}{suffix}").as_str())
                        })
                    {
                        continue;
                    }
                    let source = entry.path();
                    let destination = app_data.join(name);
                    if !destination.exists() {
                        fs::rename(source, destination)?;
                    } else if fs::symlink_metadata(&source)?.file_type().is_dir()
                        && fs::symlink_metadata(&destination)?.file_type().is_dir()
                    {
                        merge_missing_entries(&source, &destination)?;
                    }
                }
            } else {
                merge_missing_entries(&legacy, app_data)?;
            }
        } else {
            fs::rename(&legacy, app_data)?;
        }
    }
    if old_database.exists() && !new_database.exists() {
        for suffix in ["-shm", "-wal"] {
            if app_data.join(format!("{DATABASE_FILE}{suffix}")).exists() {
                return Err(io::Error::new(io::ErrorKind::AlreadyExists,
                    "데이터베이스 이전 대상에 기존 WAL/SHM 파일이 있습니다. 본체와 연결 파일을 확인해 주세요."));
            }
        }
        for suffix in ["-shm", "-wal"] {
            let old_sidecar = app_data.join(format!("{old_database_name}{suffix}"));
            let new_sidecar = app_data.join(format!("{DATABASE_FILE}{suffix}"));
            if old_sidecar.exists() {
                fs::rename(old_sidecar, new_sidecar)?;
            }
        }
        // Publish the new main file last; an interrupted transfer is rejected as
        // orphan sidecars on retry instead of opening a main file without its WAL.
        fs::rename(&old_database, &new_database)?;
    }
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .manage(crate::analytics::Runtime::default())
        .manage(crate::characters::collision_host::Runtime::default())
        .manage(crate::widgets::planning::windows::Navigation::default())
        .plugin(launcher::plugin())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .register_uri_scheme_protocol(SPRITE_SCHEME, serve_sprite)
        .register_uri_scheme_protocol(WIDGET_BACKGROUND_SCHEME, widgets::backgrounds::serve)
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(state) = app.try_state::<Arc<AppState>>() {
                show_boxes(app, &state);
            }
        }))
        .setup(|app| {
            let app_data = app.path().app_data_dir()?;
            migrate_app_data(&app_data)?;
            std::fs::create_dir_all(&app_data)?;
            if crate::exbrain::initialize(&app_data).is_err() {
                eprintln!("Widget context initialization deferred");
            }
            let (sidecar, runtime) = resource_paths(app.handle()).map_err(std::io::Error::other)?;
            let talk = talk::host::initialize(&app_data);
            if let Err(error) = story::initialize_files(&app_data) {
                eprintln!("Story initialization: {error}");
            }
            let story_catalog = story::load(&app_data)
                .or_else(|_| story::catalog())
                .map_err(std::io::Error::other)?;
            let state = Arc::new(AppState {
                organizer: crate::organizer::runtime::Runtime::default(),
                db: Mutex::new(
                    open_session(&app_data.join(DATABASE_FILE)).map_err(std::io::Error::other)?,
                ),
                inference: inference::Inference::new(app_data.clone(), sidecar, runtime),
                nlp: crate::memory_commands::new_nlp(app.handle(), &app_data)
                    .map_err(std::io::Error::other)?,
                app_data,
                runtime: Mutex::new(RuntimeStatus::default()),
                playback: Mutex::new(None),
                panel: Mutex::new(None),
                launcher: Mutex::new(launcher::Runtime::default()),
                launcher_open: AtomicBool::new(false),
                widget_editing: AtomicBool::new(false),
                launcher_session: AtomicU64::new(0),
                launcher_gate: tokio::sync::Mutex::new(()),
                settings_section: Mutex::new(windows::SettingsSection::default()),
                settings_character: Mutex::new(None),
                settings_dirty: AtomicBool::new(false),
                settings_exit_confirmed: AtomicBool::new(false),
                tasks: Mutex::new(super::tasks::Registry::default()),
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
                pack_stories: Mutex::new(crate::pack_stories::Runtime::default()),
                story_clock: Mutex::new(story::Clock::default()),
                story_catalog: Mutex::new(story_catalog),
                widget_jobs: Mutex::new(HashMap::new()),
                widget_open_intents: Mutex::new(HashMap::new()),
                widget_clocks: Mutex::new(std::collections::BTreeMap::new()),
                app_usage_tracker: Mutex::new(crate::app_usage::tracking::Tracker::default()),
                last_input: AtomicI64::new(now()),
                last_foreground: AtomicI64::new(now()),
                last_scene: AtomicI64::new(now()),
                next_idle: AtomicI64::new(now() + 5),
                quiet_hours: Mutex::new(super::quiet_hours::Runtime::default()),
                last_preparation: AtomicI64::new(0),
                last_background_check: AtomicI64::new(0),
                idle_sequence: AtomicU64::new(0),
                presence: Mutex::new(super::presence::Presence::for_app(app.handle())),
                action: Mutex::new(()),
                automatic: AtomicBool::new(false),
                stopping: AtomicBool::new(false),
                update_installing: AtomicBool::new(false),
                behavior: Mutex::new(behavior::Machine::default()),
                reactions: Mutex::new(crate::characters::reaction_host::Runtime::default()),
                animation_states: Mutex::new(
                    crate::characters::animation_states::Runtime::default(),
                ),
                life: Mutex::new(crate::characters::life::Runtime::default()),
                guests: Mutex::new(crate::characters::guests::Runtime::default()),
                positions: Mutex::new(HashMap::new()),
            });
            app.manage(state.clone());
            crate::analytics::attach_request_observer(app.handle(), &state.inference);
            crate::analytics::crash::install(app.handle(), &state);
            state
                .inference
                .configure_chatgpt(&app.config().identifier)
                .map_err(std::io::Error::other)?;
            crate::characters::reaction_host::install(app.handle(), state.clone());
            app.manage(desktop::toys::Runtime::default());
            app.manage(crate::widgets::runtime::Runtime::default());
            app.manage(crate::widgets::desktop::Runtime::default());
            app.manage(updater::UpdateState::default());
            launcher::initialize(app.handle(), &state).map_err(std::io::Error::other)?;
            crate::widgets::memo_notes::schedule_sync(app.handle());
            lock(&state.runtime).map_err(std::io::Error::other)?.hidden =
                !behavior::preferences(&*lock(&state.db).map_err(std::io::Error::other)?)
                    .map_err(std::io::Error::other)?
                    .characters_visible;
            desktop::create_boxes(app.handle(), &state).map_err(std::io::Error::other)?;
            desktop::menu::create(app.handle()).map_err(std::io::Error::other)?;
            crate::widgets::desktop::restore_on_start(app.handle(), state.clone());
            crate::widgets::planning::notifications::install(app.handle())?;
            if let Err(error) = device::wake::install(app.handle()) {
                eprintln!("기기 복귀 알림 연결 실패: {error}");
            }
            let handle = app.handle().clone();
            talk::host::watch(handle.clone(), state.clone());
            tauri::async_runtime::spawn(story::host::run_clock(handle.clone(), state.clone()));
            desktop::toys::start(handle.clone());
            updater::start(handle.clone());
            tauri::async_runtime::spawn(crate::widgets::connection_host::restore_music_bridges(
                handle.clone(),
                state.clone(),
            ));
            tauri::async_runtime::spawn(background_loop(handle, state));
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, WindowEvent::CloseRequested { .. }) {
                if let Some(id) = window.label().strip_prefix("widget-") {
                    if uuid::Uuid::parse_str(id).is_ok() {
                        let state = window.state::<Arc<AppState>>();
                        let _ = widgets::commands::cancel_widget_opens(&state, Some(id));
                    }
                }
            }
            if matches!(event, WindowEvent::Moved(_)) {
                crate::widgets::desktop::moved(window);
            }
            if matches!(event, WindowEvent::Destroyed) {
                let label = window.label();
                if label == "widget-editor" {
                    crate::widgets::desktop::editor_destroyed(window.app_handle());
                }
                #[cfg(not(target_os = "macos"))]
                if let Some(id) = label.strip_prefix("desktop-toy-") {
                    crate::desktop::toys::remove_actor(window.app_handle(), id);
                }
                if label == "planner" || label.starts_with("widget-") {
                    crate::widgets::runtime::refresh(window.app_handle());
                }
            }
            if window.label().starts_with("generated-widget-") {
                match event {
                    WindowEvent::CloseRequested { .. } => {
                        let _ = crate::widgets::generated::commands::cancel_for_window(
                            window.app_handle(),
                            window.label(),
                            None,
                        );
                    }
                    WindowEvent::Destroyed => {
                        let app = window.app_handle().clone();
                        let label = window.label().to_string();
                        let epoch = window.state::<Arc<AppState>>().epoch.load(Ordering::SeqCst);
                        tauri::async_runtime::spawn(async move {
                            let _ = crate::widgets::generated::commands::cancel_for_window(
                                &app,
                                &label,
                                Some(epoch),
                            );
                        });
                    }
                    _ => {}
                }
                return;
            }
            if window.label() == "widget-workshop" {
                if matches!(event, WindowEvent::Destroyed) {
                    let app = window.app_handle().clone();
                    let epoch = window.state::<Arc<AppState>>().epoch.load(Ordering::SeqCst);
                    tauri::async_runtime::spawn(async move {
                        let _ = crate::widgets::generated::commands::cancel_workshop_for_window(
                            &app,
                            Some(epoch),
                        );
                    });
                }
                return;
            }
            if window.label() == "launcher" {
                launcher::window_event(window, event);
                return;
            }
            if window.label() == "settings" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    if let Err(error) = window.hide() {
                        eprintln!("Settings window hide failed: {error}");
                    }
                }
                return;
            }
            if window.label() == "conversation-history" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    // The webview flushes its draft before release_conversation_history hides it.
                    api.prevent_close();
                }
                return;
            }
            if matches!(window.label(), "balloon" | "conversation-input") {
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
            if let WindowEvent::Destroyed = event {
                let state = window.state::<Arc<AppState>>();
                let identity = crate::characters::reaction_host::native_window_identity(window);
                let tracked =
                    crate::characters::guests::forget_window(&state, window.label(), identity)
                        .unwrap_or(false);
                let missing = window
                    .app_handle()
                    .get_webview_window(window.label())
                    .is_none_or(|current| {
                        crate::characters::reaction_host::window_identity(&current) == 0
                    });
                if tracked || missing {
                    if missing {
                        let _ = crate::characters::guests::forget_missing_window(
                            &state,
                            window.label(),
                        );
                    }
                    if !face {
                        crate::characters::gestures::cancel_window(
                            window.app_handle(),
                            window.label(),
                        );
                    }
                    crate::characters::collision_host::remove(window.app_handle(), window.label());
                }
                return;
            }
            if !face {
                match event {
                    WindowEvent::Moved(_)
                    | WindowEvent::Resized(_)
                    | WindowEvent::ScaleFactorChanged { .. }
                    | WindowEvent::Focused(_) => crate::characters::collision_host::refresh(
                        window.app_handle(),
                        window.label(),
                    ),
                    _ => {}
                }
            }
            let state = window.state::<Arc<AppState>>();
            match event {
                WindowEvent::Moved(pos) => {
                    crate::characters::gestures::trace_window_moved(window, pos);
                    if crate::characters::guests::window_authority(
                        &state,
                        window.label(),
                        crate::characters::reaction_host::native_window_identity(window),
                    )
                    .ok()
                    .flatten()
                    .is_none()
                    {
                        return;
                    }
                    if !face {
                        crate::characters::gestures::moved(window.app_handle(), window.label());
                    }
                    let resident_face = face
                        && crate::characters::guests::window_authority(
                            &state,
                            window.label(),
                            crate::characters::reaction_host::native_window_identity(window),
                        )
                        .ok()
                            == Some(Some(None));
                    if resident_face {
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
                    }
                    if !face {
                        if let Ok(data) = snapshot(&state) {
                            desktop::sync_balloon(window.app_handle(), &data);
                        }
                    }
                }
                WindowEvent::CloseRequested { api, .. } if face => {
                    api.prevent_close();
                    if let Some(view) = window
                        .app_handle()
                        .get_webview_window(window.label())
                        .filter(|view| {
                            crate::characters::reaction_host::window_identity(view)
                                == crate::characters::reaction_host::native_window_identity(window)
                        })
                    {
                        let _ = desktop::hide_ambient(&view);
                    }
                }
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let app = window.app_handle().clone();
                    let authority = crate::characters::guests::window_authority(
                        &state,
                        window.label(),
                        crate::characters::reaction_host::native_window_identity(window),
                    )
                    .ok()
                    .flatten();
                    if let Some(Some(generation)) = authority {
                        let Some(id) = window.label().strip_prefix("body-") else {
                            return;
                        };
                        let id = id.to_string();
                        let state = state.inner().clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = crate::characters::guests::close(&app, &state, &id, generation);
                        });
                        return;
                    }
                    if authority.is_none() {
                        return;
                    }
                    tauri::async_runtime::spawn(async move {
                        let state = app.state::<Arc<AppState>>();
                        let _ = hide_boxes(app.clone(), state).await;
                    });
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            crate::analytics::get_analytics_context,
            crate::analytics::set_analytics_consent,
            crate::analytics::send_analytics_event,
            crate::characters::guests::leave_character_guest,
            crate::pack_stories::commands::get_pack_story_definition,
            crate::pack_stories::commands::save_pack_story_definition,
            crate::pack_stories::commands::trial_pack_story,
            crate::pack_stories::commands::trial_pack_authoring,
            crate::widgets::generated::commands::get_generated_widgets,
            crate::widgets::generated::commands::get_widget_workshop_mode,
            crate::widgets::generated::commands::open_widget_workshop,
            crate::widgets::generated::commands::close_widget_workshop,
            crate::widgets::generated::commands::open_widget_state_rules,
            crate::widgets::generated::commands::close_widget_state_rules,
            crate::widgets::generated::commands::get_widget_rule_editor,
            crate::widgets::generated::commands::get_generated_widget,
            crate::widgets::generated::commands::get_generated_execution,
            crate::widgets::generated::commands::complete_generated_execution,
            crate::widgets::generated::commands::execute_generated_ui_action,
            crate::widgets::generated::commands::set_widget_creation_automatic,
            crate::widgets::generated::commands::generate_widget,
            crate::widgets::generated::commands::cancel_widget_generation,
            crate::widgets::generated::commands::import_generated_widget,
            crate::widgets::generated::commands::update_generated_state,
            crate::widgets::generated::commands::report_generated_result,
            crate::widgets::generated::commands::set_generated_widget_enabled,
            crate::widgets::generated::commands::remove_generated_widget,
            crate::widgets::generated::commands::open_generated_widget,
            crate::widgets::generated::commands::close_generated_widget,
            crate::widgets::generated::commands::get_widget_state_rules,
            crate::widgets::generated::commands::save_widget_state_rules,
            crate::widgets::generated::commands::test_widget_state_rule,
            crate::organizer::commands::organizer_search_trial,
            super::autostart::get_autostart_enabled,
            super::autostart::set_autostart_enabled,
            crate::characters::gestures::get_character_gesture_settings,
            crate::characters::gestures::trace_character_gesture,
            crate::characters::gestures::begin_character_drag,
            crate::characters::gestures::cancel_character_drag,
            crate::characters::gestures::trigger_character_interaction,
            crate::characters::gestures::arm_character_move,
            crate::characters::gestures::give_character_snack,
            crate::characters::life::begin_character_contact,
            crate::characters::life::set_character_sleep,
            crate::characters::life::give_character_item,
            crate::characters::life::wandering::report_character_motion_preference,
            crate::characters::reaction_host::trigger_character_reaction,
            crate::characters::reaction_host::acknowledge_character_reaction,
            crate::characters::reaction_host::get_character_reaction_events,
            crate::characters::reaction_host::preview_character_reaction,
            super::get_snapshot,
            super::history::list_character_history,
            super::users::set_user_name,
            super::users::register_user_name,
            super::users::list_legacy_memories,
            super::users::assign_legacy_memories,
            super::users::forget_character_memories,
            super::users::count_character_memories,
            launcher::get_launcher_state,
            launcher::open_launcher,
            launcher::close_launcher,
            launcher::resize_launcher,
            launcher::set_launcher_shortcut,
            launcher::execute_launcher,
            behavior::get_desktop_preferences,
            behavior::set_desktop_preferences,
            behavior::clear_desktop_toys,
            desktop::toys::desktop_toy_action,
            crate::characters::collision_host::set_character_collision,
            crate::characters::collision_host::set_character_collision_animation,
            crate::characters::collision_host::select_character_collision_frame,
            updater::get_update_status,
            updater::check_app_update,
            updater::install_app_update,
            updater::expand_update_notice,
            updater::open_update_settings,
            crate::widgets::memo_notes::create_memo_note,
            crate::widgets::memo_notes::open_memo_note,
            crate::widgets::memo_notes::close_memo_note,
            crate::widgets::memo_notes::request_close_memo_note,
            crate::widgets::memo_notes::save_memo_note,
            widgets::commands::get_widgets,
            widgets::commands::list_usage_applications,
            crate::chatgpt::get_chatgpt_status,
            crate::chatgpt::login_chatgpt,
            crate::chatgpt::cancel_chatgpt_login,
            crate::chatgpt::select_chatgpt_account,
            crate::chatgpt::logout_chatgpt,
            crate::chatgpt::list_chatgpt_models,
            crate::chatgpt::open_chatgpt_usage,
            crate::organizer::commands::organizer_status,
            crate::organizer::commands::organizer_save_settings,
            crate::organizer::commands::organizer_connect_vault,
            crate::organizer::commands::organizer_disconnect_vault,
            crate::organizer::commands::organizer_scan_vault,
            crate::organizer::commands::organizer_run,
            crate::organizer::commands::organizer_pause,
            crate::organizer::commands::organizer_touch,
            crate::organizer::commands::organizer_search,
            crate::organizer::commands::organizer_records,
            crate::organizer::commands::organizer_actions,
            crate::organizer::commands::organizer_open_source,
            crate::organizer::commands::organizer_undo,
            crate::organizer::commands::organizer_open_records,
            crate::organizer::commands::organizer_open_action,
            crate::organizer::commands::organizer_pick_folder,
            crate::diary::get_diary,
            crate::diary::update_diary,
            crate::conversation_notes::get_conversation_notes,
            crate::conversation_notes::set_conversation_note_context,
            crate::conversation_notes::open_conversation_note,
            crate::conversation_notes::save_conversation_note,
            crate::widgets::runtime::get_widget_runtime,
            widgets::commands::install_widgets,
            widgets::commands::set_widget_enabled,
            widgets::commands::remove_widget,
            widgets::commands::execute_widget,
            widgets::commands::configure_widget_appearance,
            widgets::commands::choose_widget_background,
            widgets::commands::remove_widget_background,
            widgets::commands::get_widget_journal,
            widgets::commands::open_widgets,
            widgets::commands::close_widgets,
            widgets::commands::open_widget,
            widgets::commands::close_widget,
            crate::widgets::desktop::get_widget_desktop,
            crate::widgets::desktop::configure_widget_desktop,
            crate::widgets::desktop::restore_widget_desktop,
            crate::widgets::desktop::add_widget_desktop_item,
            crate::widgets::desktop::remove_widget_desktop_item,
            crate::widgets::desktop::set_widget_desktop_shape,
            crate::widgets::desktop::set_widget_stack_style,
            crate::widgets::desktop::set_widget_desktop_editing,
            crate::widgets::desktop::get_widget_desktop_snapshot,
            crate::widgets::desktop::open_widget_stack,
            crate::widgets::desktop::close_widget_stack,
            crate::widgets::desktop::fit_widget_stack,
            crate::widgets::desktop::fit_widget_editor,
            widgets::connection_host::connect_calendar_ics,
            widgets::connection_host::connect_calendar_google,
            widgets::connection_host::connect_calendar_apple,
            widgets::connection_host::list_apple_calendars,
            crate::widgets::planning::windows::get_planner_tab,
            crate::widgets::planning::windows::open_planner_view,
            crate::widgets::planning::windows::get_planner_view_target,
            crate::widgets::planning::windows::get_planner_note_target,
            crate::widgets::planning::windows::set_planner_tab,
            crate::widgets::planning::windows::preview_planner_recurrence,
            crate::widgets::planning::windows::open_planner_settings,
            crate::widgets::planning::windows::get_planner_settings_target,
            crate::widgets::planning::notifications::get_planner_notification_permission,
            crate::widgets::planning::notifications::request_planner_notification_permission,
            crate::widgets::planning::notifications::preview_planner_notification,
            widgets::connection_host::refresh_calendar,
            widgets::connection_host::disconnect_calendar,
            widgets::connection_host::configure_connection_widget,
            widgets::connection_host::music_request,
            widgets::connection_host::music_bridge_pair,
            widgets::connection_host::music_bridge_status,
            widgets::connection_host::music_bridge_disconnect,
            widgets::connection_host::export_music_extension,
            widgets::commands::set_music_expanded,
            widgets::commands::set_focus_expanded,
            widgets::connection_host::refresh_connection_widget,
            widgets::connection_host::search_weather_regions,
            widgets::connection_host::open_widget_link,
            characters::commands::open_characters,
            characters::commands::get_settings_character,
            characters::commands::ack_settings_character,
            characters::commands::create_character,
            characters::commands::save_character,
            characters::commands::get_character_dialogue,
            characters::commands::save_character_dialogue,
            characters::commands::clone_character,
            characters::commands::apply_character_roster,
            characters::commands::get_character_packs,
            characters::commands::apply_character_pack,
            characters::commands::remove_character,
            characters::commands::preview_character_pack,
            characters::commands::choose_character_pack,
            characters::commands::import_character_pack,
            characters::commands::save_character_pack,
            characters::commands::get_character_pack_attribution,
            characters::commands::save_character_pack_attribution,
            crate::talk::commands::get_talk_packs,
            crate::talk::commands::install_talk_pack,
            crate::talk::commands::remove_talk_pack,
            characters::commands::choose_character_sprite,
            characters::commands::choose_animation_assets,
            characters::commands::remove_character_sprite,
            windows::open_panel,
            super::chat::open_reply,
            super::chat::resume_chat,
            super::chat::release_conversation_history,
            super::chat::finish_conversation,
            super::chat::save_conversation_draft,
            super::chat::discuss_music_widget,
            super::chat::get_conversations,
            super::chat::get_conversation_messages,
            windows::close_panel,
            windows::skip_talk,
            windows::talk_now,
            windows::resize_balloon,
            settings::preview_wordbook_match,
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
            crate::memory_commands::list_memories,
            crate::memory_commands::get_nlp_status,
            crate::memory_commands::set_memory_search_settings,
            crate::memory_commands::download_nlp_model,
            crate::memory_commands::cancel_nlp_download,
            crate::memory_commands::remove_nlp_model,
            crate::memory_commands::retry_memory_analysis,
            windows::open_settings,
            windows::get_settings_section,
            windows::set_settings_section,
            windows::set_settings_dirty,
            windows::show_characters,
            windows::hide_boxes,
            windows::set_paused,
            windows::quit_app,
            story::host::choose_story,
            story::host::defer_story,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build comet")
        .run(|app, event| match event {
            tauri::RunEvent::Ready => {
                let auth_state = app.state::<Arc<AppState>>().inner().clone();
                let auth_app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = auth_state.inference.chatgpt.initialize().await;
                    publish(&auth_app, &auth_state);
                });
            }
            tauri::RunEvent::ExitRequested { api, code, .. } => {
                if let Some(state) = app.try_state::<Arc<AppState>>() {
                    if windows::settings_exit_needs_confirmation(&state) {
                        api.prevent_exit();
                        if let Err(error) = windows::confirm_settings_exit(app, &state) {
                            eprintln!("Failed to confirm unsaved settings before exit: {error}");
                        }
                        return;
                    }
                }
                if code == Some(tauri::RESTART_EXIT_CODE) {
                    return;
                }
                if let Some(state) = app.try_state::<Arc<AppState>>() {
                    api.prevent_exit();
                    if unavailable(&state) {
                        return;
                    }
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        request_exit(&app).await;
                    });
                }
            }
            tauri::RunEvent::Exit => {
                device::wake::shutdown(app);
                if let Some(state) = app.try_state::<Arc<AppState>>() {
                    let _ = prepare_exit(&state);
                    // Native macOS termination can skip ExitRequested. Finish before returning to Cocoa.
                    tauri::async_runtime::block_on(stop_owned_work(&state));
                }
                crate::analytics::crash::clean_exit(app);
            }
            _ => {}
        });
}

pub(crate) async fn stop_owned_work(state: &AppState) {
    // Cancelling tasks first releases gate and any inference state guards. The
    // total grace period is shared; no standard mutex guard crosses an await.
    let _ = tokio::join!(state.nlp.shutdown(), super::tasks::shutdown(state),);
    inference::stop_local(&state.inference).await;
}

async fn request_exit(app: &tauri::AppHandle) {
    static EXIT: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    let Ok(_operation) = EXIT.try_lock() else {
        return;
    };
    let state = app.state::<Arc<AppState>>();
    let result = async {
        let mut notes = prepare_after_notes(
            &state,
            crate::widgets::memo_notes::flush_notes(app, &state, None),
            |notes| {
                if windows::settings_exit_needs_confirmation(&state) {
                    return Err("저장하지 않은 설정을 확인한 뒤 다시 종료해 주세요.".into());
                }
                notes.ensure_current(app, &*lock(&state.db)?)?;
                prepare_exit_locked(&state)
            },
        )
        .await?;
        desktop::toys::clear(app);
        device::wake::shutdown(app);
        stop_owned_work(&state).await;
        let exit_app = app.clone();
        app.run_on_main_thread(move || {
            exit_app.cleanup_before_exit();
            crate::analytics::crash::clean_exit(&exit_app);
            std::process::exit(0);
        })
        .map_err(|error| error.to_string())?;
        notes.keep_locked();
        Ok::<(), String>(())
    }
    .await;
    if let Err(error) = result {
        state.settings_exit_confirmed.store(false, Ordering::SeqCst);
        app.dialog()
            .message(error)
            .title("comet · 종료하지 못했어요")
            .show(|_| {});
    }
}

pub(crate) async fn prepare_after_notes<T>(
    state: &AppState,
    flush: impl std::future::Future<Output = Result<T, String>>,
    prepare: impl FnOnce(&T) -> Result<(), String>,
) -> Result<T, String> {
    let notes = flush.await?;
    {
        let _action = lock(&state.action)?;
        if unavailable(state) {
            return Err("앱을 정리하고 있어요.".into());
        }
        prepare(&notes)?;
    }
    Ok(notes)
}

pub(crate) fn prepare_exit(state: &AppState) -> Result<(), String> {
    let _action = lock(&state.action)?;
    prepare_exit_locked(state)
}

pub(crate) fn prepare_exit_locked(state: &AppState) -> Result<(), String> {
    flush_positions(state, true)?;
    interrupt(state, false)?;
    if let Some(cancel) = lock(&state.download_cancel)?.as_ref() {
        cancel.store(true, Ordering::SeqCst);
    }
    cancel_widget_jobs(state, None)?;
    lock(&state.runtime)?.hidden = true;
    state.stopping.store(true, Ordering::SeqCst);
    Ok(())
}

pub(crate) fn flush_positions(state: &AppState, all: bool) -> Result<(), String> {
    let mut positions = lock(&state.positions)?;
    let due = positions
        .iter()
        .filter(|(_, (_, at))| all || at.elapsed() > Duration::from_millis(500))
        .map(|(id, (pos, _))| (id.clone(), pos.clone()))
        .collect::<Vec<_>>();
    let db = lock(&state.db)?;
    let residents = characters::active_ids(&db)?;
    for (id, pos) in due {
        let resident_face = id
            .strip_prefix("face-")
            .is_some_and(|owner| residents.iter().any(|id| id == owner));
        let legacy_resident =
            characters::slot_index(&id).is_ok_and(|slot| residents.get(slot).is_some());
        if resident_face || legacy_resident {
            store::set_window_position(&db, &id, &pos)?;
        }
        positions.remove(&id);
    }
    Ok(())
}

pub(crate) async fn prepare_update_install(
    app: &tauri::AppHandle,
) -> Result<crate::widgets::memo_notes::FlushedNotes, String> {
    let state = app.state::<Arc<AppState>>();
    let notes = prepare_after_notes(
        &state,
        crate::widgets::memo_notes::flush_notes(app, &state, None),
        |notes| {
            notes.ensure_current(app, &*lock(&state.db)?)?;
            prepare_update_install_locked(&state)
        },
    )
    .await?;
    desktop::toys::clear(app);
    publish(app, &state);
    let result = async {
        let (nlp, ()) = tokio::join!(state.nlp.suspend(), super::tasks::shutdown(&state));
        inference::stop_local(&state.inference).await;
        nlp?;
        lock(&state.db)?
            .execute_batch("PRAGMA wal_checkpoint(FULL);")
            .map_err(|error| error.to_string())?;
        Ok::<(), String>(())
    }
    .await;
    if let Err(error) = result {
        let _ = restore_update_install(app);
        return Err(error);
    }
    Ok(notes)
}

pub(crate) fn prepare_update_install_locked(state: &AppState) -> Result<(), String> {
    ensure_settings_saved_for_update(state)?;
    flush_positions(state, true)?;
    interrupt(state, false)?;
    *lock(&state.panel)? = None;
    lock(&state.runtime)?.phase = crate::types::RuntimePhase::Idle;
    if let Some(cancel) = lock(&state.download_cancel)?.as_ref() {
        cancel.store(true, Ordering::SeqCst);
    }
    cancel_widget_jobs(state, None)?;
    state.update_installing.store(true, Ordering::SeqCst);
    Ok(())
}

pub(crate) fn ensure_settings_saved_for_update(state: &AppState) -> Result<(), String> {
    if state.settings_dirty.load(Ordering::SeqCst) {
        return Err(
            "저장하지 않은 설정이 있어요. 저장하거나 변경을 취소한 뒤 업데이트를 설치해 주세요."
                .into(),
        );
    }
    Ok(())
}

pub(crate) fn restore_update_install(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<Arc<AppState>>();
    {
        let _action = lock(&state.action)?;
        state.update_installing.store(false, Ordering::SeqCst);
        state.nlp.resume();
        schedule_idle(&state, store::settings(&*lock(&state.db)?)?.idle_minutes);
    }
    publish(app, &state);
    Ok(())
}

#[cfg(test)]
mod migration_tests {
    use super::*;

    #[test]
    fn qa_profile_does_not_import_or_move_legacy_data() {
        let root = tempfile::tempdir().unwrap();
        let qa = root.path().join("space.starlight.comet.windows-qa");
        let legacy = root.path().join(crate::legacy_names::app_identifier());
        fs::create_dir_all(&qa).unwrap();
        fs::create_dir_all(legacy.join("models")).unwrap();
        fs::create_dir_all(legacy.join("talk")).unwrap();
        fs::write(qa.join(DATABASE_FILE), b"qa database").unwrap();
        fs::write(
            legacy.join(crate::legacy_names::database_file()),
            b"legacy database",
        )
        .unwrap();
        fs::write(legacy.join("models").join("model.gguf"), b"legacy model").unwrap();
        fs::write(legacy.join("talk").join("index.talk"), b"legacy talk").unwrap();

        migrate_app_data(&qa).unwrap();

        assert_eq!(fs::read(qa.join(DATABASE_FILE)).unwrap(), b"qa database");
        assert!(!qa.join("models").exists());
        assert!(!qa.join("talk").exists());
        assert_eq!(
            fs::read(legacy.join(crate::legacy_names::database_file())).unwrap(),
            b"legacy database"
        );
        assert_eq!(
            fs::read(legacy.join("models").join("model.gguf")).unwrap(),
            b"legacy model"
        );
        assert_eq!(
            fs::read(legacy.join("talk").join("index.talk")).unwrap(),
            b"legacy talk"
        );
    }

    fn copy_database_with_wal(destination: &Path, name: &str) {
        let source = tempfile::tempdir().unwrap();
        let database = source.path().join("source.sqlite");
        let connection = rusqlite::Connection::open(&database).unwrap();
        connection.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE records(value TEXT); INSERT INTO records VALUES('legacy-main'); PRAGMA wal_checkpoint(TRUNCATE); INSERT INTO records VALUES('legacy-wal');").unwrap();
        for suffix in ["", "-wal", "-shm"] {
            fs::copy(
                source.path().join(format!("source.sqlite{suffix}")),
                destination.join(format!("{name}{suffix}")),
            )
            .unwrap();
        }
    }

    fn records(path: &Path) -> Vec<String> {
        let connection = rusqlite::Connection::open(path).unwrap();
        let mut query = connection
            .prepare("SELECT value FROM records ORDER BY rowid")
            .unwrap();
        query
            .query_map([], |row| row.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect()
    }

    #[test]
    fn existing_current_database_never_inherits_legacy_named_or_current_named_sidecars() {
        for (name, already_merged) in [
            (crate::legacy_names::database_file(), false),
            (DATABASE_FILE.to_string(), false),
            (crate::legacy_names::database_file(), true),
        ] {
            let root = tempfile::tempdir().unwrap();
            let app_data = root.path().join("space.starlight.comet");
            let legacy = root.path().join(crate::legacy_names::app_identifier());
            fs::create_dir_all(&app_data).unwrap();
            fs::create_dir_all(&legacy).unwrap();
            let database = app_data.join(DATABASE_FILE);
            let current = rusqlite::Connection::open(&database).unwrap();
            current
                .execute_batch(
                    "CREATE TABLE records(value TEXT); INSERT INTO records VALUES('current');",
                )
                .unwrap();
            drop(current);
            let source = if already_merged { &app_data } else { &legacy };
            copy_database_with_wal(source, &name);
            fs::write(legacy.join("keep-model.gguf"), b"model").unwrap();

            migrate_app_data(&app_data).unwrap();
            migrate_app_data(&app_data).unwrap();

            assert!(!app_data.join(format!("{DATABASE_FILE}-wal")).exists());
            assert!(!app_data.join(format!("{DATABASE_FILE}-shm")).exists());
            assert_eq!(records(&database), ["current"]);
            assert_eq!(
                fs::read(app_data.join("keep-model.gguf")).unwrap(),
                b"model"
            );
            assert!(source.join(format!("{name}-wal")).exists());
        }
    }

    #[test]
    fn orphan_destination_sidecar_does_not_get_paired_with_a_renamed_database() {
        let root = tempfile::tempdir().unwrap();
        let app_data = root.path().join("space.starlight.comet");
        fs::create_dir_all(&app_data).unwrap();
        let old_database = app_data.join(crate::legacy_names::database_file());
        fs::write(&old_database, b"legacy database").unwrap();
        let orphan = app_data.join(format!("{DATABASE_FILE}-wal"));
        fs::write(&orphan, b"unrelated WAL").unwrap();

        assert_eq!(
            migrate_app_data(&app_data).unwrap_err().kind(),
            io::ErrorKind::AlreadyExists
        );
        assert_eq!(fs::read(old_database).unwrap(), b"legacy database");
        assert_eq!(fs::read(orphan).unwrap(), b"unrelated WAL");
        assert!(!app_data.join(DATABASE_FILE).exists());
    }

    #[test]
    fn orphan_sidecars_block_legacy_merge_before_a_database_is_imported() {
        for name in [
            crate::legacy_names::database_file(),
            DATABASE_FILE.to_string(),
        ] {
            let root = tempfile::tempdir().unwrap();
            let app_data = root.path().join("space.starlight.comet");
            let legacy = root.path().join(crate::legacy_names::app_identifier());
            fs::create_dir_all(&app_data).unwrap();
            fs::create_dir_all(&legacy).unwrap();
            copy_database_with_wal(&legacy, &name);
            let orphan = app_data.join(format!("{name}-wal"));
            fs::write(&orphan, b"unrelated WAL").unwrap();

            assert_eq!(
                migrate_app_data(&app_data).unwrap_err().kind(),
                io::ErrorKind::AlreadyExists
            );

            assert_eq!(fs::read(orphan).unwrap(), b"unrelated WAL");
            assert!(!app_data.join(DATABASE_FILE).exists());
            assert!(!app_data.join(crate::legacy_names::database_file()).exists());
            assert!(legacy.join(format!("{name}-wal")).exists());
            assert_eq!(records(&legacy.join(name)), ["legacy-main", "legacy-wal"]);
        }
    }

    #[test]
    fn renamed_legacy_database_replays_its_own_pending_wal() {
        let root = tempfile::tempdir().unwrap();
        let app_data = root.path().join("space.starlight.comet");
        let legacy = root.path().join(crate::legacy_names::app_identifier());
        fs::create_dir_all(&legacy).unwrap();
        copy_database_with_wal(&legacy, &crate::legacy_names::database_file());

        migrate_app_data(&app_data).unwrap();

        assert!(app_data.join(format!("{DATABASE_FILE}-wal")).exists());
        assert!(app_data.join(format!("{DATABASE_FILE}-shm")).exists());
        assert_eq!(
            records(&app_data.join(DATABASE_FILE)),
            ["legacy-main", "legacy-wal"]
        );
    }

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
