use crate::{
    app, characters, lock, store,
    types::{PanelState, Playback, RuntimePhase},
    AppState,
};
use serde::Serialize;
use std::collections::HashSet;
use std::sync::{atomic::Ordering, Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateStatus {
    phase: &'static str,
    version: Option<String>,
    notes: Option<String>,
    downloaded: u64,
    total: Option<u64>,
    message: Option<String>,
}

impl Default for UpdateStatus {
    fn default() -> Self {
        Self {
            phase: "idle",
            version: None,
            notes: None,
            downloaded: 0,
            total: None,
            message: None,
        }
    }
}

#[derive(Default)]
pub(crate) struct UpdateState {
    status: Mutex<UpdateStatus>,
    available: Mutex<Option<Update>>,
    operation: tokio::sync::Mutex<()>,
    notices: Mutex<Notices>,
}

#[derive(Default)]
struct Notices {
    announced: HashSet<String>,
    active: Option<ActiveNotice>,
}

struct ActiveNotice {
    id: String,
    version: String,
    created_at: i64,
}

fn notice_blocked(state: &AppState, db: &rusqlite::Connection) -> Result<bool, String> {
    let runtime = lock(&state.runtime)?.clone();
    let settings = store::settings(db)?;
    Ok(app::unavailable(state)
        || runtime.hidden
        || runtime.paused
        || !settings.autonomous_enabled
        || state.launcher_open.load(Ordering::SeqCst)
        || app::quiet_hours::automatic_blocked(state, &settings)?
        || crate::widgets::storage::focus_active(db, chrono::Utc::now().timestamp_millis())?
        || crate::behavior::reactions_blocked(state)?)
}

fn notice_actor_available(
    state: &AppState,
    db: &rusqlite::Connection,
    id: &str,
) -> Result<bool, String> {
    Ok(characters::active_ids(db)?
        .iter()
        .any(|active| active == id)
        && app::presence::is_present(state, id)?
        && !crate::characters::life::sleeping(state, id)?)
}

fn finish_notice(state: &AppState, db: &rusqlite::Connection) -> Result<(), String> {
    app::interrupt_for_conversation(state, false)?;
    let mut runtime = lock(&state.runtime)?;
    runtime.phase = RuntimePhase::Idle;
    runtime.persona = None;
    runtime.error = None;
    app::schedule_idle(state, store::settings(db)?.idle_minutes);
    Ok(())
}

fn advance_notice(state: &AppState, updates: &UpdateState, now: i64) -> Result<bool, String> {
    let _action = lock(&state.action)?;
    let db = lock(&state.db)?;
    let status = lock(&updates.status)?.clone();
    let mut notices = lock(&updates.notices)?;
    let playback = lock(&state.playback)?.clone();
    if let Some(active) = &notices.active {
        if let Some(line) = playback
            .as_ref()
            .filter(|line| line.id == active.id && line.source == "update")
        {
            let expanded = lock(&state.panel)?
                .as_ref()
                .is_some_and(|panel| panel.mode == "update" && panel.persona == line.persona);
            let expired = !expanded
                && line
                    .display_started_at
                    .map_or(now - active.created_at >= 30_000, |_| now >= line.ends_at);
            if status.phase != "available"
                || status.version.as_ref() != Some(&active.version)
                || notice_blocked(state, &db)?
                || !notice_actor_available(state, &db, &line.persona)?
                || expired
            {
                finish_notice(state, &db)?;
                notices.active = None;
                return Ok(true);
            }
            return Ok(false);
        }
        notices.active = None;
    }
    let Some(version) = status.version.filter(|_| status.phase == "available") else {
        return Ok(false);
    };
    if notices.announced.contains(&version)
        || notice_blocked(state, &db)?
        || !matches!(
            lock(&state.runtime)?.phase,
            RuntimePhase::Idle | RuntimePhase::Error
        )
        || lock(&state.panel)?.is_some()
        || playback.is_some()
        || lock(&state.story)?.is_some()
        || lock(&state.pack_stories)?.run.is_some()
        || lock(&state.tasks)?.active.is_some()
        || store::active_conversation(&db)?.is_some()
        || app::now() - state.last_input.load(Ordering::SeqCst) < 15
    {
        return Ok(false);
    }
    let mut persona = None;
    for id in characters::active_ids(&db)? {
        if notice_actor_available(state, &db, &id)? {
            persona = Some(id);
            break;
        }
    }
    let Some(persona) = persona else {
        return Ok(false);
    };
    app::interrupt_for_conversation(state, true)?;
    let id = format!("update:{}:{}", version, uuid::Uuid::new_v4());
    *lock(&state.playback)? = Some(Playback {
        id: id.clone(),
        persona: persona.clone(),
        expression: "평온".into(),
        text: "새로운 업데이트가 있어요!".into(),
        motion: Default::default(),
        source: "update".into(),
        text_speed: 0,
        display_started_at: None,
        ends_at: 0,
        line_index: 0,
        line_count: 1,
    });
    let mut runtime = lock(&state.runtime)?;
    runtime.phase = RuntimePhase::Playing;
    runtime.persona = Some(persona);
    runtime.error = None;
    notices.announced.insert(version.clone());
    notices.active = Some(ActiveNotice {
        id,
        version,
        created_at: now,
    });
    Ok(true)
}

pub(crate) fn tick(app: &tauri::AppHandle, state: &AppState) -> Result<bool, String> {
    let changed = advance_notice(
        state,
        &app.state::<UpdateState>(),
        chrono::Utc::now().timestamp_millis(),
    )?;
    if changed {
        app::publish(app, state);
    }
    Ok(changed)
}

// Caller owns action; the playback and available version must still be the ones clicked.
fn current_notice(state: &AppState, updates: &UpdateState, id: &str) -> Result<Playback, String> {
    let status = lock(&updates.status)?.clone();
    let notices = lock(&updates.notices)?;
    let line = lock(&state.playback)?
        .as_ref()
        .filter(|line| {
            line.id == id && line.source == "update" && line.display_started_at.is_some()
        })
        .cloned();
    let current = notices.active.as_ref().is_some_and(|active| {
        active.id == id
            && status.phase == "available"
            && status.version.as_ref() == Some(&active.version)
    });
    let db = lock(&state.db)?;
    if let Some(line) = line.filter(|_| current) {
        let expanded = lock(&state.panel)?
            .as_ref()
            .is_some_and(|panel| panel.mode == "update" && panel.persona == line.persona);
        if !notice_blocked(state, &db)?
            && notice_actor_available(state, &db, &line.persona)?
            && (expanded || chrono::Utc::now().timestamp_millis() < line.ends_at)
        {
            return Ok(line);
        }
    }
    Err("이 업데이트 알림은 이미 닫혔어요. 설정에서 다시 확인해 주세요.".into())
}

fn expand_notice(state: &AppState, updates: &UpdateState, id: &str) -> Result<(), String> {
    let _action = lock(&state.action)?;
    let line = current_notice(state, updates, id)?;
    let mut panel = lock(&state.panel)?;
    if panel.as_ref().is_some_and(|panel| panel.mode != "update") {
        return Err("다른 화면을 사용하고 있어요.".into());
    }
    *panel = Some(PanelState {
        persona: line.persona,
        mode: "update".into(),
    });
    state.last_input.store(app::now(), Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub(crate) fn expand_update_notice(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    playback_id: String,
) -> Result<(), String> {
    expand_notice(&state, &app.state::<UpdateState>(), &playback_id)?;
    let _ = crate::desktop::request_balloon_focus(&app);
    app::publish(&app, &state);
    Ok(())
}

fn navigate_notice(
    state: &AppState,
    updates: &UpdateState,
    id: &str,
    open: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    {
        let _action = lock(&state.action)?;
        let line = current_notice(state, updates, id)?;
        if !lock(&state.panel)?
            .as_ref()
            .is_some_and(|panel| panel.mode == "update" && panel.persona == line.persona)
        {
            return Err("업데이트 알림을 먼저 열어 주세요.".into());
        }
    }
    open()?;
    let _action = lock(&state.action)?;
    // Native window operations can yield to other commands. Only dismiss the original notice.
    if lock(&state.playback)?
        .as_ref()
        .is_some_and(|line| line.id == id && line.source == "update")
        && lock(&state.panel)?
            .as_ref()
            .is_some_and(|panel| panel.mode == "update")
    {
        finish_notice(state, &*lock(&state.db)?)?;
        lock(&updates.notices)?.active = None;
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn open_update_settings(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    playback_id: String,
) -> Result<(), String> {
    navigate_notice(&state, &app.state::<UpdateState>(), &playback_id, || {
        app::windows::show_settings_section(app.clone(), app::windows::SettingsSection::General)
    })?;
    app::publish(&app, &state);
    Ok(())
}

fn configured(app: &tauri::AppHandle) -> bool {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|config| config.get("pubkey"))
        .and_then(|key| key.as_str())
        .is_some_and(|key| !key.trim().is_empty())
}

fn publish(app: &tauri::AppHandle, status: UpdateStatus) -> Result<UpdateStatus, String> {
    {
        let state = app.state::<UpdateState>();
        let mut current = super::lock(&state.status)?;
        *current = status.clone();
    }
    let _ = app.emit("app-update", &status);
    Ok(status)
}

fn failure_message(error: &tauri_plugin_updater::Error) -> &'static str {
    use tauri_plugin_updater::Error;
    match error {
        Error::Minisign(_) | Error::Base64(_) | Error::SignatureUtf8(_) => {
            "업데이트 서명을 확인하지 못해 설치하지 않았어요. 다시 확인해 주세요."
        }
        Error::ReleaseNotFound => {
            "공개된 업데이트 정보를 찾지 못했어요. 나중에 다시 확인해 주세요."
        }
        Error::Reqwest(_) | Error::Network(_) => {
            "업데이트 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요."
        }
        Error::TargetNotFound(_) | Error::TargetsNotFound(_) => {
            "이 운영체제에 맞는 업데이트 파일이 아직 없어요."
        }
        _ => "업데이트를 완료하지 못했어요. 다시 시도해 주세요.",
    }
}

fn report_failure(app: &tauri::AppHandle, message: String) -> String {
    if let Ok(mut status) = get_status(app) {
        status.phase = "error";
        status.message = Some(message.clone());
        let _ = publish(app, status);
    }
    message
}

fn get_status(app: &tauri::AppHandle) -> Result<UpdateStatus, String> {
    Ok(super::lock(&app.state::<UpdateState>().status)?.clone())
}

#[tauri::command]
pub(crate) fn get_update_status(app: tauri::AppHandle) -> Result<UpdateStatus, String> {
    get_status(&app)
}

#[tauri::command]
pub(crate) async fn check_app_update(app: tauri::AppHandle) -> Result<UpdateStatus, String> {
    let state = app.state::<UpdateState>();
    let _operation = state
        .operation
        .try_lock()
        .map_err(|_| "업데이트 작업이 진행 중이에요.")?;
    if !configured(&app) {
        return publish(
            &app,
            UpdateStatus {
                phase: "disabled",
                message: Some("이 빌드에는 업데이트 서명 키가 설정되지 않았어요.".into()),
                ..UpdateStatus::default()
            },
        );
    }
    publish(
        &app,
        UpdateStatus {
            phase: "checking",
            ..UpdateStatus::default()
        },
    )?;
    *super::lock(&state.available)? = None;
    let result = async {
        app.updater_builder()
            .timeout(Duration::from_secs(30))
            .build()?
            .check()
            .await
    }
    .await;
    match result {
        Ok(update) => {
            let status = match &update {
                Some(update) => UpdateStatus {
                    phase: "available",
                    version: Some(update.version.clone()),
                    notes: update.body.clone(),
                    ..UpdateStatus::default()
                },
                None => UpdateStatus {
                    phase: "current",
                    ..UpdateStatus::default()
                },
            };
            *super::lock(&state.available)? = update;
            publish(&app, status)
        }
        Err(error) => Err(report_failure(&app, failure_message(&error).into())),
    }
}

fn confirm_version(available: Option<&str>, expected: &str) -> Result<(), String> {
    if available != Some(expected) {
        return Err("업데이트를 다시 확인하고 설치할 버전을 선택해 주세요.".into());
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn install_app_update(
    app: tauri::AppHandle,
    version: String,
) -> Result<(), String> {
    crate::app::lifecycle::ensure_settings_saved_for_update(
        &app.state::<std::sync::Arc<crate::app::AppState>>(),
    )?;
    let state = app.state::<UpdateState>();
    let _operation = state
        .operation
        .try_lock()
        .map_err(|_| "업데이트 작업이 진행 중이에요.")?;
    let update = super::lock(&state.available)?.clone();
    confirm_version(
        update.as_ref().map(|update| update.version.as_str()),
        &version,
    )?;
    let mut update = update.ok_or("먼저 업데이트를 확인해 주세요.")?;
    update.timeout = Some(Duration::from_secs(300));
    let mut status = UpdateStatus {
        phase: "downloading",
        version: Some(update.version.clone()),
        notes: update.body.clone(),
        ..UpdateStatus::default()
    };
    publish(&app, status.clone())?;
    // The plugin verifies the signature before returning these bytes.
    let mut last_progress = Instant::now();
    let bytes = update
        .download(
            |chunk, total| {
                status.downloaded = status.downloaded.saturating_add(chunk as u64);
                status.total = total;
                if last_progress.elapsed() >= Duration::from_millis(100) {
                    let _ = publish(&app, status.clone());
                    last_progress = Instant::now();
                }
            },
            || {},
        )
        .await
        .map_err(|error| report_failure(&app, failure_message(&error).into()))?;
    let mut notes = super::prepare_update_install(&app)
        .await
        .map_err(|error| report_failure(&app, error))?;
    status.phase = "installing";
    if let Err(error) = publish(&app, status) {
        let _ = super::restore_update_install(&app);
        return Err(error);
    }
    if let Err(error) = update.install(bytes) {
        let recovery = super::restore_update_install(&app);
        let message = match recovery {
            Ok(()) => failure_message(&error).to_string(),
            Err(_) => "업데이트 설치에 실패했어요. 앱을 다시 실행해 주세요.".into(),
        };
        return Err(report_failure(&app, message));
    }
    // Windows exits inside install; macOS needs an explicit restart.
    notes.keep_locked();
    app.request_restart();
    Ok(())
}

pub(crate) fn start(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            let _ = check_app_update(app.clone()).await;
            tokio::time::sleep(Duration::from_secs(24 * 60 * 60)).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn available(version: &str) -> UpdateState {
        UpdateState {
            status: Mutex::new(UpdateStatus {
                phase: "available",
                version: Some(version.into()),
                ..UpdateStatus::default()
            }),
            ..UpdateState::default()
        }
    }

    fn displayed_notice(state: &AppState, updates: &UpdateState) -> String {
        let now = chrono::Utc::now().timestamp_millis();
        assert!(advance_notice(state, updates, now).unwrap());
        let mut playback = lock(&state.playback).unwrap();
        let line = playback.as_mut().unwrap();
        app::scene::mark_line_displayed(line, now);
        line.id.clone()
    }

    #[test]
    fn update_notices_are_once_per_version_and_never_saved_as_conversation_or_memory() {
        let state = crate::lifecycle_tests::state();
        let updates = available("0.14.0");
        let id = displayed_notice(&state, &updates);
        let snapshot = app::snapshot(&state).unwrap();
        let line = snapshot.playback.unwrap();
        assert_eq!(line.id, id);
        assert_eq!(line.source, "update");
        assert_eq!(line.text, "새로운 업데이트가 있어요!");
        assert!(snapshot.messages.is_empty());
        assert_eq!(snapshot.memory_count, 0);
        assert!(advance_notice(&state, &updates, line.ends_at).unwrap());
        assert!(lock(&state.playback).unwrap().is_none());
        assert!(!advance_notice(&state, &updates, line.ends_at + 1).unwrap());
        lock(&updates.status).unwrap().version = Some("0.14.1".into());
        assert!(advance_notice(&state, &updates, line.ends_at + 2).unwrap());
        assert_ne!(lock(&state.playback).unwrap().as_ref().unwrap().id, id);
        assert!(store::messages(&lock(&state.db).unwrap(), 100)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn unavailable_update_states_never_announce_even_if_they_retain_a_version() {
        for phase in [
            "idle",
            "disabled",
            "checking",
            "current",
            "downloading",
            "installing",
            "error",
        ] {
            let state = crate::lifecycle_tests::state();
            let updates = available("0.14.0");
            lock(&updates.status).unwrap().phase = phase;
            assert!(
                !advance_notice(&state, &updates, chrono::Utc::now().timestamp_millis()).unwrap(),
                "{phase}"
            );
            assert!(lock(&state.playback).unwrap().is_none());
        }
    }

    #[test]
    fn update_notices_wait_for_an_available_idle_character_without_interrupting_work() {
        use chrono::Timelike;
        for blocked in [
            "hidden",
            "paused",
            "automatic",
            "editing",
            "launcher",
            "quiet",
            "focus",
            "sleeping",
            "busy",
            "panel",
            "conversation",
            "stopping",
            "installing",
        ] {
            let state = crate::lifecycle_tests::state();
            let updates = available("0.14.0");
            match blocked {
                "hidden" => lock(&state.runtime).unwrap().hidden = true,
                "paused" => lock(&state.runtime).unwrap().paused = true,
                "automatic" | "quiet" => {
                    let db = lock(&state.db).unwrap();
                    let mut settings = store::settings(&db).unwrap();
                    if blocked == "automatic" {
                        settings.autonomous_enabled = false;
                    } else {
                        let at = chrono::Local::now();
                        let start = at.hour() * 60 + at.minute();
                        let end = (start + 1) % (24 * 60);
                        settings.quiet_hours = crate::types::QuietHours {
                            enabled: true,
                            start: format!("{:02}:{:02}", start / 60, start % 60),
                            end: format!("{:02}:{:02}", end / 60, end % 60),
                            weekdays: (0..7).collect(),
                        };
                    }
                    store::save_settings(&db, &settings).unwrap();
                }
                "editing" => state.widget_editing.store(true, Ordering::SeqCst),
                "launcher" => state.launcher_open.store(true, Ordering::SeqCst),
                "focus" => {
                    let directory = tempfile::tempdir().unwrap();
                    let db = lock(&state.db).unwrap();
                    crate::widgets::storage::verify_packages(&db, directory.path()).unwrap();
                    let timer = crate::widgets::storage::instances(&db)
                        .unwrap()
                        .into_iter()
                        .find(|instance| instance.kind == "focus-timer")
                        .unwrap();
                    crate::widgets::storage::execute(
                        &db,
                        &crate::widgets::WidgetRequest {
                            request_id: uuid::Uuid::new_v4().to_string(),
                            instance_id: timer.id,
                            expected_revision: timer.revision,
                            action: "start".into(),
                            input: serde_json::json!({"durationMs": 60_000}),
                        },
                        chrono::Utc::now().timestamp_millis(),
                        1,
                    )
                    .unwrap();
                }
                "sleeping" => {
                    let active = characters::active_ids(&lock(&state.db).unwrap()).unwrap();
                    for id in active {
                        crate::characters::life::set_sleep(&state, &id, true).unwrap();
                    }
                }
                "busy" => lock(&state.runtime).unwrap().phase = RuntimePhase::Generating,
                "panel" => {
                    *lock(&state.panel).unwrap() = Some(PanelState {
                        persona: "a".into(),
                        mode: "input".into(),
                    })
                }
                "conversation" => {
                    let db = lock(&state.db).unwrap();
                    store::set_user_name(&db, "알림 검사", 1).unwrap();
                    let actor = characters::active_ids(&db).unwrap()[0].clone();
                    store::create_conversation(&db, &[actor], None, None, 1).unwrap();
                }
                "stopping" => state.stopping.store(true, Ordering::SeqCst),
                "installing" => state.update_installing.store(true, Ordering::SeqCst),
                _ => unreachable!(),
            }
            assert!(
                !advance_notice(&state, &updates, chrono::Utc::now().timestamp_millis()).unwrap(),
                "{blocked}"
            );
            assert!(lock(&state.playback).unwrap().is_none(), "{blocked}");
            assert!(
                lock(&updates.notices).unwrap().announced.is_empty(),
                "{blocked}"
            );
        }
    }

    #[test]
    fn expanding_pins_the_same_notice_and_navigation_preserves_saved_drafts() {
        let state = crate::lifecycle_tests::state();
        let updates = available("0.14.0");
        let previous = {
            let db = lock(&state.db).unwrap();
            store::set_user_name(&db, "알림 검사", 1).unwrap();
            let actor = characters::active_ids(&db).unwrap()[0].clone();
            let session = store::create_conversation(&db, &[actor], None, None, 1).unwrap();
            store::save_conversation_draft(&db, &session.id, "작성하던 초안\n그대로").unwrap();
            store::pause_conversations(&db).unwrap();
            session.id
        };
        let id = displayed_notice(&state, &updates);
        assert!(navigate_notice(&state, &updates, &id, || Ok(())).is_err());
        expand_notice(&state, &updates, &id).unwrap();
        let ends_at = lock(&state.playback).unwrap().as_ref().unwrap().ends_at;
        assert!(!advance_notice(&state, &updates, ends_at + 60_000).unwrap());
        assert_eq!(lock(&state.playback).unwrap().as_ref().unwrap().id, id);
        assert_eq!(lock(&state.panel).unwrap().as_ref().unwrap().mode, "update");
        navigate_notice(&state, &updates, &id, || {
            *lock(&state.settings_section)? = app::windows::SettingsSection::General;
            Ok(())
        })
        .unwrap();
        assert!(lock(&state.playback).unwrap().is_none());
        assert!(lock(&state.panel).unwrap().is_none());
        assert_eq!(
            *lock(&state.settings_section).unwrap(),
            app::windows::SettingsSection::General
        );
        assert_eq!(
            store::conversation(&lock(&state.db).unwrap(), &previous)
                .unwrap()
                .draft,
            "작성하던 초안\n그대로"
        );
    }

    #[test]
    fn stale_notice_actions_cannot_change_a_later_notice_or_settings_destination() {
        let state = crate::lifecycle_tests::state();
        let updates = available("0.14.0");
        let old = displayed_notice(&state, &updates);
        let ends_at = lock(&state.playback).unwrap().as_ref().unwrap().ends_at;
        assert!(advance_notice(&state, &updates, ends_at).unwrap());
        lock(&updates.status).unwrap().version = Some("0.14.1".into());
        let next = displayed_notice(&state, &updates);
        assert!(expand_notice(&state, &updates, &old).is_err());
        assert!(navigate_notice(&state, &updates, &old, || panic!(
            "stale navigation must not open settings"
        ))
        .is_err());
        assert_eq!(lock(&state.playback).unwrap().as_ref().unwrap().id, next);
        assert_eq!(
            *lock(&state.settings_section).unwrap(),
            app::windows::SettingsSection::Characters
        );
        lock(&state.runtime).unwrap().hidden = true;
        assert!(advance_notice(&state, &updates, chrono::Utc::now().timestamp_millis()).unwrap());
        lock(&state.runtime).unwrap().hidden = false;
        assert!(!advance_notice(&state, &updates, chrono::Utc::now().timestamp_millis()).unwrap());
    }

    #[test]
    fn a_failed_settings_window_keeps_the_expanded_notice_available_for_retry() {
        let state = crate::lifecycle_tests::state();
        let updates = available("0.14.0");
        let id = displayed_notice(&state, &updates);
        expand_notice(&state, &updates, &id).unwrap();
        let result = navigate_notice(&state, &updates, &id, || Err("창을 열지 못했어요.".into()));
        assert_eq!(result.unwrap_err(), "창을 열지 못했어요.");
        assert_eq!(lock(&state.playback).unwrap().as_ref().unwrap().id, id);
        assert_eq!(lock(&state.panel).unwrap().as_ref().unwrap().mode, "update");
        navigate_notice(&state, &updates, &id, || Ok(())).unwrap();
        assert!(lock(&state.playback).unwrap().is_none());
    }

    #[test]
    fn successful_navigation_does_not_dismiss_an_unrelated_later_playback() {
        let state = crate::lifecycle_tests::state();
        let updates = available("0.14.0");
        let id = displayed_notice(&state, &updates);
        expand_notice(&state, &updates, &id).unwrap();
        navigate_notice(&state, &updates, &id, || {
            lock(&state.playback)?.as_mut().unwrap().id = "later-playback".into();
            Ok(())
        })
        .unwrap();
        assert_eq!(
            lock(&state.playback).unwrap().as_ref().unwrap().id,
            "later-playback"
        );
    }

    #[test]
    fn an_interruption_clears_the_expanded_notice_without_replaying_it() {
        let state = crate::lifecycle_tests::state();
        let updates = available("0.14.0");
        let id = displayed_notice(&state, &updates);
        expand_notice(&state, &updates, &id).unwrap();
        let epoch = {
            let _action = lock(&state.action).unwrap();
            app::interrupt(&state, false).unwrap().0
        };
        app::set_phase_if_current(&state, epoch, RuntimePhase::Idle, None, None).unwrap();
        assert!(lock(&state.panel).unwrap().is_none());
        assert!(lock(&state.playback).unwrap().is_none());
        assert!(!advance_notice(&state, &updates, chrono::Utc::now().timestamp_millis()).unwrap());
    }

    #[test]
    fn install_requires_the_version_the_user_approved() {
        assert!(confirm_version(Some("0.4.1"), "0.4.1").is_ok());
        assert!(confirm_version(Some("0.4.2"), "0.4.1").is_err());
        assert!(confirm_version(None, "0.4.1").is_err());
    }

    #[test]
    fn signature_failure_is_distinct_from_offline_and_missing_release() {
        let signature = failure_message(&tauri_plugin_updater::Error::SignatureUtf8("bad".into()));
        assert!(signature.contains("서명"));
        assert!(signature.contains("설치하지 않았어요"));
        let offline = failure_message(&tauri_plugin_updater::Error::Network("offline".into()));
        assert!(offline.contains("연결"));
        let missing = failure_message(&tauri_plugin_updater::Error::ReleaseNotFound);
        assert!(missing.contains("찾지 못했어요"));
        assert_ne!(signature, offline);
    }
}
