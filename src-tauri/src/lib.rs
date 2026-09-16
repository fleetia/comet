mod character_commands;
mod character_files;
mod character_sprites;
mod characters;
mod desktop;
mod device_wake;
mod domain;
mod inference;
mod models;
mod playback;
mod resources;
mod store;
pub mod talk;
mod talk_host;
mod types;
mod widget_commands;
mod widget_connections;
mod widgets;
mod wordbook;

use character_commands::*;
use rusqlite::{Connection, OptionalExtension};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager, WindowEvent};
use types::*;
use widget_commands::*;
use widget_connections::*;

struct AppState {
    db: Mutex<Connection>,
    inference: inference::Inference,
    app_data: PathBuf,
    runtime: Mutex<RuntimeStatus>,
    playback: Mutex<Option<Playback>>,
    panel: Mutex<Option<PanelState>>,
    cancellation: Mutex<Option<Arc<AtomicBool>>>,
    download_cancel: Mutex<Option<Arc<AtomicBool>>>,
    gate: tokio::sync::Mutex<()>,
    epoch: AtomicU64,
    widget_epoch: AtomicU64,
    widget_playback: Mutex<Option<widgets::WidgetEvent>>,
    talk: Mutex<talk::runtime::ActiveProgram>,
    talk_playback: Mutex<Option<talk_host::PreparedTalk>>,
    talk_turn: AtomicBool,
    widget_jobs: Mutex<HashMap<String, Arc<AtomicBool>>>,
    widget_clocks: Mutex<std::collections::BTreeMap<String, i64>>,
    last_input: AtomicI64,
    last_foreground: AtomicI64,
    last_scene: AtomicI64,
    next_idle: AtomicI64,
    last_preparation: AtomicI64,
    last_background_check: AtomicI64,
    idle_sequence: AtomicU64,
    action: Mutex<()>,
    automatic: AtomicBool,
    stopping: AtomicBool,
    positions: Mutex<HashMap<String, (WindowPosition, Instant)>>,
}

fn now() -> i64 {
    chrono::Utc::now().timestamp()
}
fn schedule_idle(state: &AppState, minutes: u32) {
    state.next_idle.store(
        playback::next_idle_at(now(), minutes, uuid::Uuid::new_v4().as_u128() as u64),
        Ordering::SeqCst,
    );
}
fn lock<T>(value: &Mutex<T>) -> Result<std::sync::MutexGuard<'_, T>, String> {
    value
        .lock()
        .map_err(|_| "앱 상태를 읽지 못했어요. 앱을 다시 시작해 주세요.".into())
}

fn open_session(path: &std::path::Path) -> Result<Connection, String> {
    let db = store::open(path)?;
    if let Some(directory) = path.parent() {
        widgets::storage::verify_packages(&db, directory)?;
    }
    db.execute("DELETE FROM scenes", [])
        .map_err(|error| error.to_string())?;
    Ok(db)
}

fn snapshot(state: &AppState) -> Result<Snapshot, String> {
    let db = lock(&state.db)?;
    let settings = store::settings(&db)?;
    Ok(Snapshot {
        has_api_key: inference::has_api_key(&settings),
        model_ready: models::model_ready(&state.app_data, settings.local_model),
        local_models: models::model_statuses(&state.app_data),
        settings,
        messages: store::messages(&db, 100)?,
        memories: store::memories(&db)?,
        relationships: store::relationships(&db)?,
        prepared_count: store::prepared_scenes(&db)?.len(),
        runtime: lock(&state.runtime)?.clone(),
        playback: lock(&state.playback)?.clone(),
        panel: lock(&state.panel)?.clone(),
        wordbook: wordbook::entries(&db)?,
        characters: characters::collection(&db)?,
        message_identities: store::message_identities(&db, 100)?,
    })
}

fn publish(app: &tauri::AppHandle, state: &AppState) {
    if let Ok(data) = snapshot(state) {
        desktop::sync_boxes(app, &data);
        desktop::sync_balloon(app, &data);
        let _ = app.emit("app-state", data);
    }
}
fn phase(
    app: &tauri::AppHandle,
    state: &AppState,
    epoch: u64,
    value: &str,
    persona: Option<String>,
    error: Option<String>,
) {
    if set_phase_if_current(state, epoch, value, persona, error).unwrap_or(false) {
        publish(app, state);
    }
}
fn set_phase_if_current(
    state: &AppState,
    epoch: u64,
    value: &str,
    persona: Option<String>,
    error: Option<String>,
) -> Result<bool, String> {
    let _action = lock(&state.action)?;
    if state.epoch.load(Ordering::SeqCst) != epoch {
        return Ok(false);
    }
    if matches!(value, "idle" | "error") {
        *lock(&state.talk_playback)? = None;
    }
    let mut status = lock(&state.runtime)?;
    status.phase = value.into();
    status.persona = persona;
    status.error = error;
    Ok(true)
}

// Call under action; lock order is action, then db/cancellation/runtime. Never hold across await.
fn interrupt(state: &AppState, automatic: bool) -> Result<(u64, Arc<AtomicBool>), String> {
    state.automatic.store(automatic, Ordering::SeqCst);
    let mut active = lock(&state.cancellation)?;
    if let Some(cancel) = active.take() {
        cancel.store(true, Ordering::SeqCst);
    }
    let cancel = Arc::new(AtomicBool::new(false));
    *active = Some(cancel.clone());
    let epoch = state.epoch.fetch_add(1, Ordering::SeqCst) + 1;
    *lock(&state.playback)? = None;
    *lock(&state.widget_playback)? = None;
    *lock(&state.talk_playback)? = None;
    Ok((epoch, cancel))
}

fn is_current(state: &AppState, epoch: u64, cancel: &AtomicBool) -> bool {
    state.epoch.load(Ordering::SeqCst) == epoch && !cancel.load(Ordering::SeqCst)
}

#[tauri::command]
fn get_snapshot(state: tauri::State<'_, Arc<AppState>>) -> Result<Snapshot, String> {
    snapshot(&state)
}

fn validate_target(target: &str) -> Result<Vec<&str>, String> {
    match target {
        "a" => Ok(vec!["a"]),
        "b" => Ok(vec!["b"]),
        "both" => Ok(vec!["a", "b"]),
        _ => Err("대화 상대를 선택해 주세요.".into()),
    }
}

fn route_message(
    state: &AppState,
    db: &Connection,
    content: &str,
) -> Result<Option<Vec<SceneLine>>, String> {
    let entries = wordbook::entries(db)?;
    if let Some(entry) = wordbook::match_entry(&entries, content) {
        return Ok(Some(entry.lines.clone()));
    }
    if let Some(lines) = characters::keyword_scene(db, content)? {
        return Ok(Some(lines));
    }
    let settings = store::settings(db)?;
    if settings.mode == "local" && !models::model_ready(&state.app_data, settings.local_model) {
        return Err("설정에서 모델을 먼저 다운로드해 주세요.".into());
    }
    if settings.mode == "api"
        && (settings.api_model.trim().is_empty() || !inference::has_api_key(&settings))
    {
        return Err("설정에서 API 연결을 먼저 완료해 주세요.".into());
    }
    Ok(None)
}

#[tauri::command]
async fn send_message(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    content: String,
    target: String,
    client_message_id: String,
) -> Result<(), String> {
    validate_target(&target)?;
    let content = content.trim();
    if content.is_empty() || content.chars().count() > 2000 {
        return Err("대화는 1~2,000자로 입력해 주세요.".into());
    }
    uuid::Uuid::parse_str(&client_message_id)
        .map_err(|_| "메시지 식별자가 올바르지 않아요.".to_string())?;
    let (token, registered) = {
        let _action = lock(&state.action)?;
        if state.stopping.load(Ordering::SeqCst) {
            return Err("앱을 종료하고 있어요.".into());
        }
        let db = lock(&state.db)?;
        let settings = store::settings(&db)?;
        let exists: bool = db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM messages WHERE id=?1)",
                [&client_message_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        if exists {
            return Ok(());
        }
        let registered = route_message(&state, &db, content)?;
        store::insert_message(
            &db,
            &Message {
                id: client_message_id.clone(),
                role: "user".into(),
                persona: Some(target.clone()),
                content: content.into(),
                expression: None,
                created_at: now() * 1000,
                status: "complete".into(),
            },
        )?;
        let token = interrupt(&state, false)?;
        *lock(&state.panel)? = None;
        state.last_input.store(now(), Ordering::SeqCst);
        schedule_idle(&state, settings.idle_minutes);
        (token, registered)
    };
    if let Some(lines) = registered {
        start_scene(
            app,
            state.inner().clone(),
            lines,
            "wordbook",
            token,
            Some(client_message_id),
        );
        return Ok(());
    }
    start_turn(
        app,
        state.inner().clone(),
        validate_target(&target)?
            .into_iter()
            .map(str::to_string)
            .collect(),
        client_message_id,
        token,
    );
    Ok(())
}

#[tauri::command]
fn retry_turn(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    message_id: String,
    target: String,
) -> Result<(), String> {
    let (targets, token, registered) = {
        let _action = lock(&state.action)?;
        if state.stopping.load(Ordering::SeqCst) {
            return Err("앱을 종료하고 있어요.".into());
        }
        let db = lock(&state.db)?;
        let history = store::messages(&db, 100)?;
        let latest = history
            .iter()
            .rev()
            .find(|m| m.role == "user")
            .ok_or("다시 요청할 대화가 없어요.")?;
        if latest.id != message_id {
            return Err("가장 최근 대화만 다시 요청할 수 있어요.".into());
        }
        ensure_retry_characters(&db, &message_id, &target)?;
        let registered = route_message(&state, &db, &latest.content)?;
        let completed = validate_target(latest.persona.as_deref().unwrap_or(""))?
            .into_iter()
            .filter(|persona| {
                history
                    .iter()
                    .any(|m| m.id == reply_id(&message_id, persona) && m.status == "complete")
            })
            .map(str::to_string)
            .collect::<Vec<_>>();
        let targets =
            remaining_retry(latest.persona.as_deref().unwrap_or(""), &target, &completed)?;
        if targets.is_empty() && registered.is_none() {
            return Ok(());
        }
        let token = interrupt(&state, false)?;
        *lock(&state.panel)? = None;
        state.last_input.store(now(), Ordering::SeqCst);
        schedule_idle(&state, store::settings(&db)?.idle_minutes);
        (targets, token, registered)
    };
    if let Some(lines) = registered {
        start_scene(
            app,
            state.inner().clone(),
            lines,
            "wordbook",
            token,
            Some(message_id),
        );
        return Ok(());
    }
    start_turn(app, state.inner().clone(), targets, message_id, token);
    Ok(())
}

fn reply_id(message_id: &str, persona: &str) -> String {
    format!("reply:{message_id}:{persona}")
}
fn ensure_retry_characters(db: &Connection, message_id: &str, target: &str) -> Result<(), String> {
    let identities = store::message_identities(db, 100)?;
    for persona in validate_target(target)? {
        let current = characters::active_character(db, persona)?;
        if !identities.iter().any(|identity| {
            identity.message_id == message_id
                && identity.persona == persona
                && identity.character_id == current.id
        }) {
            return Err("대화 상대가 바뀌었어요. 현재 캐릭터에게 새 메시지로 말해 주세요.".into());
        }
    }
    Ok(())
}
fn remaining_retry(
    original: &str,
    requested: &str,
    completed: &[String],
) -> Result<Vec<String>, String> {
    let original_targets = validate_target(original)?;
    let requested_targets = validate_target(requested)?;
    if requested_targets
        .iter()
        .any(|p| !original_targets.contains(p))
    {
        return Err("원래 대화 상대에게만 다시 요청할 수 있어요.".into());
    }
    Ok(requested_targets
        .into_iter()
        .filter(|p| !completed.iter().any(|done| done == p))
        .map(str::to_string)
        .collect())
}

fn start_turn(
    app: tauri::AppHandle,
    state: Arc<AppState>,
    targets: Vec<String>,
    message_id: String,
    token: (u64, Arc<AtomicBool>),
) {
    let (epoch, cancel) = token;
    phase(
        &app,
        &state,
        epoch,
        "loading",
        targets.first().cloned(),
        None,
    );
    tauri::async_runtime::spawn(async move {
        let _guard = state.gate.lock().await;
        if !is_current(&state, epoch, &cancel) {
            return;
        }
        let result = run_turn(&app, &state, &targets, &message_id, epoch, cancel.clone()).await;
        if !is_current(&state, epoch, &cancel) {
            return;
        }
        state.last_foreground.store(now(), Ordering::SeqCst);
        match result {
            Ok(()) => phase(&app, &state, epoch, "idle", None, None),
            Err(error) => phase(
                &app,
                &state,
                epoch,
                "error",
                targets.first().cloned(),
                Some(error),
            ),
        }
    });
}

fn turn_prompt(
    db: &Connection,
    targets: &[String],
    message_id: &str,
) -> Result<Vec<ChatMessage>, String> {
    let memories = store::memories(db)?;
    let relationships = store::relationships(db)?;
    match targets {
        [a, b] if a == "a" && b == "b" => {
            let histories = [
                store::context_messages_for(db, 24, "a")?,
                store::context_messages_for(db, 24, "b")?,
            ];
            let latest_user = histories[0]
                .iter()
                .find(|message| {
                    message.id == message_id
                        && message.role == "user"
                        && message.status == "complete"
                        && message.persona.as_deref() == Some("both")
                        && histories[1].iter().any(|other| other.id == message.id)
                })
                .ok_or("대화의 근거가 변경되었어요. 새 메시지로 말해 주세요.")?;
            Ok(domain::pair_prompt_messages(
                &[
                    characters::active_character(db, "a")?.definition,
                    characters::active_character(db, "b")?.definition,
                ],
                &histories,
                &memories,
                &relationships,
                latest_user,
            ))
        }
        [persona] if persona == "a" || persona == "b" => {
            let mut messages = store::context_messages_for(db, 24, persona)?;
            let is_pair_reply = messages.iter().any(|message| {
                message.id == message_id
                    && message.role == "user"
                    && message.status == "complete"
                    && message.persona.as_deref() == Some("both")
            });
            if is_pair_reply {
                let other = if persona == "a" { "b" } else { "a" };
                let previous = store::context_messages_for(db, 100, other)?;
                if let Some(reply) = previous.into_iter().find(|message| {
                    message.id == reply_id(message_id, other)
                        && message.role == "assistant"
                        && message.status == "complete"
                }) {
                    if !messages.iter().any(|message| message.id == reply.id) {
                        messages.push(reply);
                    }
                }
            }
            let score = relationships
                .iter()
                .find(|relationship| relationship.persona == *persona)
                .map_or(20, |relationship| relationship.score);
            Ok(domain::prompt_messages(
                persona,
                &characters::active_character(db, persona)?.definition,
                &messages,
                &memories,
                &Relationship {
                    persona: persona.clone(),
                    score,
                },
            ))
        }
        _ => Err("대화 상대를 선택해 주세요.".into()),
    }
}

async fn generate_turn(
    state: &AppState,
    targets: &[String],
    message_id: &str,
    cancel: Arc<AtomicBool>,
) -> Result<(Vec<SceneLine>, i64), String> {
    let (settings, prompt, revision) = {
        let db = lock(&state.db)?;
        (
            store::settings(&db)?,
            turn_prompt(&db, targets, message_id)?,
            store::revision(&db)?,
        )
    };
    let paired = targets.len() == 2;
    let value = inference::generate(
        &state.inference,
        &settings,
        &prompt,
        if paired {
            domain::pair_reply_schema()
        } else {
            domain::reply_schema()
        },
        if paired { 512 } else { 256 },
        cancel,
    )
    .await?;
    let lines = if paired {
        domain::parse_pair_reply(value)?
    } else {
        let line = domain::parse_reply(value)?;
        if targets
            .first()
            .is_none_or(|persona| line.persona != *persona)
        {
            return Err("대화의 화자를 확인하지 못했어요. 다시 시도해 주세요.".into());
        }
        vec![line]
    };
    Ok((lines, revision))
}

async fn run_turn(
    app: &tauri::AppHandle,
    state: &AppState,
    targets: &[String],
    message_id: &str,
    epoch: u64,
    cancel: Arc<AtomicBool>,
) -> Result<(), String> {
    if !is_current(state, epoch, &cancel) {
        return Ok(());
    }
    phase(
        app,
        state,
        epoch,
        "generating",
        targets.first().cloned(),
        None,
    );
    let (lines, revision) = generate_turn(state, targets, message_id, cancel.clone()).await?;
    for (index, line) in lines.iter().enumerate() {
        if !present_line(
            state,
            line,
            "llm",
            &reply_id(message_id, &line.persona),
            index,
            lines.len(),
            revision,
            epoch,
            &cancel,
        )? {
            return Ok(());
        }
        publish(app, state);
        wait_for_line(app, state, epoch, cancel.clone(), &line.text).await?;
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn present_line(
    state: &AppState,
    line: &SceneLine,
    source: &str,
    id: &str,
    line_index: usize,
    line_count: usize,
    revision: i64,
    epoch: u64,
    cancel: &AtomicBool,
) -> Result<bool, String> {
    let _action = lock(&state.action)?;
    let db = lock(&state.db)?;
    if !is_current(state, epoch, cancel) || store::revision(&db)? != revision {
        return Ok(false);
    }
    if source == "widget" && !widget_commands::widget_event_current(state, &db)? {
        return Ok(false);
    }
    if source == "talk" && !talk_host::current(state, &db)? {
        return Ok(false);
    }
    let scene_key = if source == "talk" && line_index == 0 {
        lock(&state.talk_playback)?
            .as_ref()
            .map(|prepared| prepared.selection.key.clone())
    } else {
        None
    };
    store::insert_message_with_talk(
        &db,
        &Message {
            id: id.into(),
            role: "assistant".into(),
            persona: Some(line.persona.clone()),
            content: line.text.clone(),
            expression: Some(line.expression.clone()),
            created_at: chrono::Utc::now().timestamp_millis(),
            status: "complete".into(),
        },
        scene_key.as_deref(),
    )?;
    *lock(&state.playback)? = Some(Playback {
        id: id.into(),
        persona: line.persona.clone(),
        expression: line.expression.clone(),
        text: line.text.clone(),
        source: source.into(),
        ends_at: chrono::Utc::now().timestamp_millis() + playback::reading_millis(&line.text),
        line_index,
        line_count,
    });
    let mut runtime = lock(&state.runtime)?;
    runtime.phase = "playing".into();
    runtime.persona = Some(line.persona.clone());
    runtime.error = None;
    Ok(true)
}

async fn wait_for_line(
    app: &tauri::AppHandle,
    state: &AppState,
    epoch: u64,
    cancel: Arc<AtomicBool>,
    text: &str,
) -> Result<(), String> {
    tokio::select! {
        _ = models::cancelled(cancel.clone()) => return Ok(()),
        _ = tokio::time::sleep(Duration::from_millis(playback::reading_millis(text) as u64)) => {}
    }
    if clear_line_if_current(state, epoch, &cancel)? {
        publish(app, state);
    }
    Ok(())
}

fn clear_line_if_current(
    state: &AppState,
    epoch: u64,
    cancel: &AtomicBool,
) -> Result<bool, String> {
    let _action = lock(&state.action)?;
    if !is_current(state, epoch, cancel) {
        return Ok(false);
    }
    *lock(&state.playback)? = None;
    Ok(true)
}

async fn run_scene(
    app: &tauri::AppHandle,
    state: &AppState,
    lines: &[SceneLine],
    source: &str,
    prefix: &str,
    epoch: u64,
    cancel: Arc<AtomicBool>,
) -> Result<(), String> {
    let revision = store::revision(&*lock(&state.db)?)?;
    for (index, line) in lines.iter().enumerate() {
        if !present_line(
            state,
            line,
            source,
            &format!("scene:{prefix}:{index}"),
            index,
            lines.len(),
            revision,
            epoch,
            &cancel,
        )? {
            return Ok(());
        }
        publish(app, state);
        wait_for_line(app, state, epoch, cancel.clone(), &line.text).await?;
        if !is_current(state, epoch, &cancel) {
            return Ok(());
        }
        tokio::select! {
            _ = models::cancelled(cancel.clone()) => return Ok(()),
            _ = tokio::time::sleep(Duration::from_millis(220)) => {}
        }
    }
    Ok(())
}

fn start_scene(
    app: tauri::AppHandle,
    state: Arc<AppState>,
    lines: Vec<SceneLine>,
    source: &'static str,
    token: (u64, Arc<AtomicBool>),
    message_id: Option<String>,
) {
    let (epoch, cancel) = token;
    phase(&app, &state, epoch, "playing", None, None);
    tauri::async_runtime::spawn(async move {
        let _guard = state.gate.lock().await;
        if !is_current(&state, epoch, &cancel) {
            return;
        }
        let prefix = message_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let result = run_scene(&app, &state, &lines, source, &prefix, epoch, cancel.clone()).await;
        if !is_current(&state, epoch, &cancel) {
            return;
        }
        phase(&app, &state, epoch, "idle", None, result.err());
    });
}

#[tauri::command]
fn cancel_generation(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), String> {
    skip_talk(app, state)
}

#[tauri::command]
fn open_panel(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    persona: String,
    mode: String,
) -> Result<(), String> {
    if !["a", "b"].contains(&persona.as_str())
        || !["menu", "input", "history"].contains(&mode.as_str())
    {
        return Err("열 수 없는 캐릭터 메뉴예요.".into());
    }
    let (epoch, _) = {
        let _action = lock(&state.action)?;
        if state.stopping.load(Ordering::SeqCst) {
            return Ok(());
        }
        let token = interrupt(&state, false)?;
        *lock(&state.panel)? = Some(PanelState { persona, mode });
        state.last_input.store(now(), Ordering::SeqCst);
        token
    };
    phase(&app, &state, epoch, "idle", None, None);
    if let Some(window) = app.get_webview_window("balloon") {
        window.set_focus().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn close_panel(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), String> {
    {
        let _action = lock(&state.action)?;
        *lock(&state.panel)? = None;
        state.last_input.store(now(), Ordering::SeqCst);
        let settings = store::settings(&*lock(&state.db)?)?;
        schedule_idle(&state, settings.idle_minutes);
    }
    publish(&app, &state);
    Ok(())
}

#[tauri::command]
fn skip_talk(app: tauri::AppHandle, state: tauri::State<'_, Arc<AppState>>) -> Result<(), String> {
    let (epoch, _) = {
        let _action = lock(&state.action)?;
        let token = interrupt(&state, false)?;
        *lock(&state.panel)? = None;
        let settings = store::settings(&*lock(&state.db)?)?;
        schedule_idle(&state, settings.idle_minutes);
        token
    };
    phase(&app, &state, epoch, "idle", None, None);
    Ok(())
}

#[tauri::command]
fn resize_balloon(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    height: f64,
) -> Result<(), String> {
    desktop::resize_balloon(&app, &snapshot(&state)?, height)
}

fn next_scene(state: &AppState) -> Result<(Vec<SceneLine>, &'static str), String> {
    let db = lock(&state.db)?;
    *lock(&state.talk_playback)? = None;
    if state.idle_sequence.load(Ordering::SeqCst) > 0
        && state.talk_turn.fetch_xor(true, Ordering::SeqCst)
    {
        if let Some(lines) = talk_host::prepare(state, &db, None)? {
            return Ok((lines, "talk"));
        }
    }
    let sequence = state.idle_sequence.fetch_add(1, Ordering::SeqCst);
    if sequence == 0 {
        return Ok((character_script(&db, 0)?, "script"));
    }
    let registered: Vec<_> = wordbook::entries(&db)?
        .into_iter()
        .filter(|entry| entry.enabled && entry.use_for_idle)
        .collect();
    let scenes = store::prepared_scenes(&db)?;
    let source = playback::idle_source(sequence, !registered.is_empty(), !scenes.is_empty());
    match source {
        "wordbook" => Ok((
            registered[(sequence as usize / 2) % registered.len()]
                .lines
                .clone(),
            source,
        )),
        "llm" => {
            let scene = &scenes[0];
            store::delete_scene(&db, &scene.id)?;
            Ok((scene.lines.clone(), source))
        }
        _ => Ok((character_script(&db, sequence)?, "script")),
    }
}

fn character_script(db: &Connection, sequence: u64) -> Result<Vec<SceneLine>, String> {
    let a = characters::active_character(db, "a")?;
    let b = characters::active_character(db, "b")?;
    let dialogue = characters::dialogue(db, &[a.id.clone(), b.id.clone()])?;
    if a.id == "builtin-a"
        && b.id == "builtin-b"
        && a.definition.version == 1
        && b.definition.version == 1
        && dialogue.pair_scenes.is_empty()
        && !dialogue
            .wordbook
            .iter()
            .any(|entry| entry.enabled && entry.use_for_idle)
    {
        return Ok(playback::builtin_scene(sequence));
    }
    if sequence == 0 {
        let mut greeting = characters::greeting(db, "a")?;
        greeting.extend(characters::greeting(db, "b")?);
        return Ok(greeting);
    }
    characters::idle_scene(db, sequence as usize)
}

#[tauri::command]
fn talk_now(app: tauri::AppHandle, state: tauri::State<'_, Arc<AppState>>) -> Result<(), String> {
    let (token, lines, source) = {
        let _action = lock(&state.action)?;
        if state.stopping.load(Ordering::SeqCst) {
            return Ok(());
        }
        let token = interrupt(&state, false)?;
        *lock(&state.panel)? = None;
        state.last_input.store(now(), Ordering::SeqCst);
        let settings = store::settings(&*lock(&state.db)?)?;
        schedule_idle(&state, settings.idle_minutes);
        let (lines, source) = next_scene(&state)?;
        (token, lines, source)
    };
    start_scene(app, state.inner().clone(), lines, source, token, None);
    Ok(())
}

#[tauri::command]
fn save_wordbook_entry(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    entry: WordbookEntry,
) -> Result<(), String> {
    {
        let _action = lock(&state.action)?;
        wordbook::save(&*lock(&state.db)?, &entry)?;
    }
    publish(&app, &state);
    Ok(())
}

#[tauri::command]
fn delete_wordbook_entry(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), String> {
    {
        let _action = lock(&state.action)?;
        wordbook::delete(&*lock(&state.db)?, &id)?;
    }
    publish(&app, &state);
    Ok(())
}

#[tauri::command]
async fn save_settings(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    settings: Settings,
    api_key: Option<String>,
) -> Result<(), String> {
    if !["local", "api"].contains(&settings.mode.as_str())
        || !(1..=60).contains(&settings.idle_minutes)
        || !["max_tokens", "max_completion_tokens"].contains(&settings.api_token_parameter.as_str())
    {
        return Err("설정값을 확인해 주세요.".into());
    }
    if settings.mode == "api" {
        let url = reqwest::Url::parse(&settings.base_url)
            .map_err(|_| "API 주소를 확인해 주세요.".to_string())?;
        if url.scheme() != "https"
            && !(url.scheme() == "http"
                && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]")))
        {
            return Err("외부 API에는 HTTPS 주소를 사용해 주세요.".into());
        }
        if settings.api_model.trim().is_empty() {
            return Err("API 모델명을 입력해 주세요.".into());
        }
    }
    if let Some(key) = api_key {
        if !key.trim().is_empty() {
            inference::set_api_key(&settings, key.trim())?;
        }
    }
    let (epoch, cancel) = apply_settings(&state, &settings)?;
    publish(&app, &state);
    let _gate = state.gate.lock().await;
    if is_current(&state, epoch, &cancel) {
        inference::stop_local(&state.inference).await;
    }
    phase(&app, &state, epoch, "idle", None, None);
    Ok(())
}

fn apply_settings(state: &AppState, settings: &Settings) -> Result<(u64, Arc<AtomicBool>), String> {
    let _action = lock(&state.action)?;
    let db = lock(&state.db)?;
    let tx = db
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    store::save_settings(&tx, settings)?;
    store::bump_revision(&tx)?;
    tx.commit().map_err(|error| error.to_string())?;
    let token = interrupt(state, false)?;
    schedule_idle(state, settings.idle_minutes);
    let mut runtime = lock(&state.runtime)?;
    runtime.phase = "loading".into();
    runtime.persona = None;
    runtime.error = None;
    Ok(token)
}

#[tauri::command]
async fn test_connection(settings: Settings, api_key: Option<String>) -> Result<String, String> {
    inference::test_connection(&settings, api_key).await
}

#[tauri::command]
fn download_model(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    model: LocalModel,
) -> Result<(), String> {
    let cancel = begin_download(&state, model)?;
    publish(&app, &state);
    let state = state.inner().clone();
    tauri::async_runtime::spawn(async move {
        let progress_app = app.clone();
        let progress_state = state.clone();
        let _ = models::download_model(&state.app_data, model, cancel, move |progress| {
            if let Ok(mut runtime) = lock(&progress_state.runtime) {
                runtime.download = Some(progress);
            }
            publish(&progress_app, &progress_state);
        })
        .await;
        if let Ok(mut active) = lock(&state.download_cancel) {
            *active = None;
        }
        publish(&app, &state);
    });
    Ok(())
}

fn begin_download(state: &AppState, model: LocalModel) -> Result<Arc<AtomicBool>, String> {
    let _action = lock(&state.action)?;
    if state.stopping.load(Ordering::SeqCst) {
        return Err("앱을 종료하고 있어요.".into());
    }
    let mut active = lock(&state.download_cancel)?;
    if active.is_some() {
        return Err("이미 모델을 다운로드하고 있어요.".into());
    }
    let selected = models::model_statuses(&state.app_data)
        .into_iter()
        .find(|status| status.id == model)
        .ok_or("지원하지 않는 모델이에요.")?;
    lock(&state.runtime)?.download = Some(DownloadProgress {
        model,
        received: selected.downloaded_bytes,
        total: selected.size,
        status: "downloading".into(),
        error: None,
    });
    let cancel = Arc::new(AtomicBool::new(false));
    *active = Some(cancel.clone());
    Ok(cancel)
}

#[tauri::command]
fn cancel_download(state: tauri::State<'_, Arc<AppState>>) -> Result<(), String> {
    if let Some(cancel) = lock(&state.download_cancel)?.as_ref() {
        cancel.store(true, Ordering::SeqCst);
    }
    Ok(())
}

#[tauri::command]
fn edit_memory(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
    content: String,
) -> Result<(), String> {
    let (epoch, _) = {
        let _action = lock(&state.action)?;
        store::edit_memory(&*lock(&state.db)?, &id, &content)?;
        interrupt(&state, false)?
    };
    phase(&app, &state, epoch, "idle", None, None);
    Ok(())
}
#[tauri::command]
fn delete_memory(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), String> {
    let (epoch, _) = {
        let _action = lock(&state.action)?;
        store::delete_memory(&*lock(&state.db)?, &id)?;
        interrupt(&state, false)?
    };
    phase(&app, &state, epoch, "idle", None, None);
    Ok(())
}

#[tauri::command]
fn open_settings(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<Arc<AppState>>();
    skip_talk(app.clone(), state)?;
    if let Some(window) = app.get_webview_window("settings") {
        window.show().map_err(|e| e.to_string())?;
        return window.set_focus().map_err(|e| e.to_string());
    }
    tauri::WebviewWindowBuilder::new(
        &app,
        "settings",
        tauri::WebviewUrl::App("index.html?view=settings".into()),
    )
    .title("Nanika Box · 설정")
    .inner_size(760.0, 760.0)
    .min_inner_size(560.0, 480.0)
    .decorations(false)
    .maximizable(false)
    .build()
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn show_boxes(app: &tauri::AppHandle, state: &AppState) {
    if state.stopping.load(Ordering::SeqCst) {
        return;
    }
    for id in ["a", "b"] {
        if let Some(window) = app.get_webview_window(id) {
            let _ = window.show();
        }
    }
    if let Ok(mut runtime) = lock(&state.runtime) {
        runtime.hidden = false;
    }
    state.last_input.store(now(), Ordering::SeqCst);
    publish(app, state);
}

#[tauri::command]
async fn hide_boxes(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), String> {
    for id in ["a", "b"].iter().chain(&desktop::FACE_LABELS) {
        if let Some(window) = app.get_webview_window(id) {
            window.hide().map_err(|e| e.to_string())?;
        }
    }
    let (epoch, cancel) = {
        let _action = lock(&state.action)?;
        lock(&state.runtime)?.hidden = true;
        *lock(&state.panel)? = None;
        interrupt(&state, false)?
    };
    phase(&app, &state, epoch, "idle", None, None);
    let _gate = state.gate.lock().await;
    if is_current(&state, epoch, &cancel) {
        inference::stop_local(&state.inference).await;
    }
    publish(&app, &state);
    Ok(())
}

#[tauri::command]
fn set_paused(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    paused: bool,
) -> Result<(), String> {
    let token = apply_pause(&state, paused)?;
    if let Some((epoch, _)) = token {
        phase(&app, &state, epoch, "idle", None, None);
    } else {
        publish(&app, &state);
    }
    Ok(())
}

fn apply_pause(state: &AppState, paused: bool) -> Result<Option<(u64, Arc<AtomicBool>)>, String> {
    let _action = lock(&state.action)?;
    lock(&state.runtime)?.paused = paused;
    widgets::storage::discard_pending(&*lock(&state.db)?)?;
    if !paused {
        schedule_idle(state, store::settings(&*lock(&state.db)?)?.idle_minutes);
    }
    let has_talk = lock(&state.talk_playback)?.is_some();
    if should_cancel_for_pause(paused, state.automatic.load(Ordering::SeqCst))
        || (paused && has_talk)
    {
        Ok(Some(interrupt(state, false)?))
    } else {
        Ok(None)
    }
}

#[tauri::command]
async fn quit_app(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), String> {
    flush_positions(&state, true)?;
    app.exit(0);
    Ok(())
}

fn resource_paths(app: &tauri::AppHandle) -> Result<(PathBuf, PathBuf), String> {
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

fn create_tray(app: &tauri::AppHandle) -> Result<(), String> {
    use tauri::menu::{Menu, MenuItem};
    let show = MenuItem::with_id(app, "show", "박스 표시", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let hide = MenuItem::with_id(app, "hide", "박스 숨김", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let pause = MenuItem::with_id(app, "pause", "자동 잡담 정지 / 재개", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let settings = MenuItem::with_id(app, "settings", "설정", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let characters = MenuItem::with_id(app, "characters", "캐릭터 관리", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let widgets = MenuItem::with_id(app, "widgets", "위젯 관리", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let quit = MenuItem::with_id(app, "quit", "완전 종료", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let menu = Menu::with_items(
        app,
        &[
            &show,
            &hide,
            &pause,
            &characters,
            &widgets,
            &settings,
            &quit,
        ],
    )
    .map_err(|e| e.to_string())?;
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or("앱 아이콘을 읽지 못했어요.")?;
    tauri::tray::TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .on_menu_event(|app, event| {
            let state = app.state::<Arc<AppState>>();
            match event.id.as_ref() {
                "show" => show_boxes(app, &state),
                "settings" => {
                    let _ = open_settings(app.clone());
                }
                "characters" => {
                    let _ = open_characters(app.clone());
                }
                "widgets" => {
                    let _ = open_widgets(app.clone());
                }
                "pause" => {
                    let paused = lock(&state.runtime).map(|s| !s.paused).unwrap_or(true);
                    let _ = set_paused(app.clone(), state, paused);
                }
                "hide" | "quit" => {
                    let app = app.clone();
                    let is_quit = event.id.as_ref() == "quit";
                    tauri::async_runtime::spawn(async move {
                        let state = app.state::<Arc<AppState>>();
                        if is_quit {
                            let _ = quit_app(app.clone(), state).await;
                        } else {
                            let _ = hide_boxes(app.clone(), state).await;
                        }
                    });
                }
                _ => {}
            }
        })
        .build(app)
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .register_uri_scheme_protocol(SPRITE_SCHEME, serve_sprite)
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(state) = app.try_state::<Arc<AppState>>() {
                show_boxes(app, &state);
            }
        }))
        .setup(|app| {
            let app_data = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data)?;
            let (sidecar, runtime) = resource_paths(app.handle()).map_err(std::io::Error::other)?;
            let talk = talk_host::initialize(&app_data);
            let state = Arc::new(AppState {
                db: Mutex::new(
                    open_session(&app_data.join("nanika.sqlite")).map_err(std::io::Error::other)?,
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
                positions: Mutex::new(HashMap::new()),
            });
            app.manage(state.clone());
            desktop::create_boxes(app.handle(), &state).map_err(std::io::Error::other)?;
            create_tray(app.handle()).map_err(std::io::Error::other)?;
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
            let face = desktop::FACE_LABELS.contains(&window.label());
            if !face && !["a", "b"].contains(&window.label()) {
                return;
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
                    let _ = window.hide();
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
            get_snapshot,
            get_widgets,
            install_widgets,
            finish_widget_onboarding,
            set_widget_enabled,
            remove_widget,
            execute_widget,
            get_widget_journal,
            open_widgets,
            close_widgets,
            open_widget,
            close_widget,
            connect_calendar_ics,
            connect_calendar_google,
            refresh_calendar,
            disconnect_calendar,
            configure_connection_widget,
            refresh_connection_widget,
            search_weather_regions,
            open_widget_link,
            open_characters,
            create_character,
            save_character,
            get_character_dialogue,
            save_character_dialogue,
            clone_character,
            assign_character,
            apply_character_pair,
            remove_character,
            preview_character_pack,
            choose_character_pack,
            import_character_pack,
            save_character_pack,
            choose_character_sprite,
            remove_character_sprite,
            open_panel,
            close_panel,
            skip_talk,
            talk_now,
            resize_balloon,
            save_wordbook_entry,
            delete_wordbook_entry,
            send_message,
            retry_turn,
            cancel_generation,
            save_settings,
            clear_api_key,
            test_connection,
            download_model,
            cancel_download,
            edit_memory,
            delete_memory,
            open_settings,
            hide_boxes,
            set_paused,
            quit_app
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Nanika Box")
        .run(|app, event| match event {
            tauri::RunEvent::ExitRequested { api, .. } => {
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

fn prepare_exit(state: &AppState) -> Result<(), String> {
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

async fn background_loop(app: tauri::AppHandle, state: Arc<AppState>) {
    let mut interval = tokio::time::interval(Duration::from_millis(500));
    loop {
        interval.tick().await;
        if state.stopping.load(Ordering::SeqCst) {
            break;
        }
        let _ = flush_positions(&state, false);
        let _ = advance_widgets(&app, &state);
        start_due_widget_refreshes(&app, &state);
        let Ok(status) = lock(&state.runtime).map(|runtime| runtime.clone()) else {
            continue;
        };
        if !["idle", "error"].contains(&status.phase.as_str()) {
            continue;
        }
        if play_widget_reaction(&app, &state).unwrap_or(false) {
            continue;
        }
        let Ok(_guard) = state.gate.try_lock() else {
            continue;
        };
        if now() - state.last_foreground.load(Ordering::SeqCst) >= 120 {
            inference::stop_local(&state.inference).await;
        }
        if let Ok(Some((epoch, cancel))) = begin_background(&state) {
            let result = run_background(&app, &state, epoch, cancel.clone()).await;
            if is_current(&state, epoch, &cancel) {
                if let Err(error) = result {
                    eprintln!("Automatic preparation deferred: {error}");
                }
                phase(&app, &state, epoch, "idle", None, None);
            }
        }
    }
}

fn begin_background(state: &AppState) -> Result<Option<(u64, Arc<AtomicBool>)>, String> {
    let _action = lock(&state.action)?;
    let status = lock(&state.runtime)?.clone();
    if state.stopping.load(Ordering::SeqCst)
        || status.hidden
        || status.paused
        || lock(&state.panel)?.is_some()
    {
        return Ok(None);
    }
    let settings = store::settings(&*lock(&state.db)?)?;
    let due = settings.autonomous_enabled && now() >= state.next_idle.load(Ordering::SeqCst);
    if status.phase != "idle" && !(status.phase == "error" && due) {
        return Ok(None);
    }
    if !due
        && (now() - state.last_input.load(Ordering::SeqCst) < 15
            || now() - state.last_background_check.load(Ordering::SeqCst) < 15)
    {
        return Ok(None);
    }
    state.last_background_check.store(now(), Ordering::SeqCst);
    Ok(Some(interrupt(state, true)?))
}

async fn run_background(
    app: &tauri::AppHandle,
    state: &AppState,
    epoch: u64,
    cancel: Arc<AtomicBool>,
) -> Result<(), String> {
    let (settings, pending, memories, relationships, revision, scenes, characters) = {
        let db = lock(&state.db)?;
        (
            store::settings(&db)?,
            store::pending_user_messages(&db)?
                .into_iter()
                .take(8)
                .collect::<Vec<_>>(),
            store::memories(&db)?,
            store::relationships(&db)?,
            store::revision(&db)?,
            store::prepared_scenes(&db)?,
            [
                characters::active_character(&db, "a")?.definition,
                characters::active_character(&db, "b")?.definition,
            ],
        )
    };
    if settings.autonomous_enabled && now() >= state.next_idle.load(Ordering::SeqCst) {
        let (lines, source) = {
            let _action = lock(&state.action)?;
            if !is_current(state, epoch, &cancel) {
                return Ok(());
            }
            schedule_idle(state, settings.idle_minutes);
            state.last_scene.store(now(), Ordering::SeqCst);
            next_scene(state)?
        };
        return run_scene(
            app,
            state,
            &lines,
            source,
            &uuid::Uuid::new_v4().to_string(),
            epoch,
            cancel,
        )
        .await;
    }
    if now() - state.last_input.load(Ordering::SeqCst) < 15 {
        return Ok(());
    }
    if !pending.is_empty() {
        let ready = if settings.mode == "local" {
            inference::is_local_running(&state.inference, settings.local_model).await
        } else {
            inference::has_api_key(&settings) && !settings.api_model.is_empty()
        };
        if ready && now() - state.last_preparation.load(Ordering::SeqCst) >= 15 {
            state.last_preparation.store(now(), Ordering::SeqCst);
            phase(app, state, epoch, "analyzing", None, None);
            let result = background_generate(
                state,
                &settings,
                &domain::analysis_prompt(&pending, &memories, revision),
                domain::analysis_schema(),
                768,
                cancel.clone(),
            )
            .await?;
            let _action = lock(&state.action)?;
            let db = lock(&state.db)?;
            if !is_current(state, epoch, &cancel) || store::revision(&db)? != revision {
                return Ok(());
            }
            store::analyze_apply(&db, &result)?;
            if let Some(last) = pending.last() {
                store::set_last_analysis_id(&db, &last.id)?;
            }
            return Ok(());
        }
    }
    let generate_enabled = if settings.mode == "api" {
        settings.api_idle_enabled
    } else {
        settings.local_idle_enabled
    };
    if !settings.autonomous_enabled
        || !generate_enabled
        || scenes.len() >= 3
        || now() - state.last_preparation.load(Ordering::SeqCst)
            < (i64::from(settings.idle_minutes) * 60).max(60)
        || lock(&state.download_cancel)?.is_some()
    {
        return Ok(());
    }
    let ready = if settings.mode == "local" {
        models::model_ready(&state.app_data, settings.local_model)
    } else {
        !settings.api_model.is_empty() && inference::has_api_key(&settings)
    };
    if !ready {
        return Ok(());
    }
    state.last_preparation.store(now(), Ordering::SeqCst);
    if settings.mode == "local" && !resources::background_allowed() {
        return Ok(());
    }
    if settings.mode == "api" {
        let _action = lock(&state.action)?;
        if !is_current(state, epoch, &cancel) || !reserve_api_idle(&*lock(&state.db)?, now())? {
            return Ok(());
        }
    }
    phase(app, state, epoch, "preparing", None, None);
    let result = background_generate(
        state,
        &settings,
        &domain::scene_prompt(&memories, &relationships, &characters),
        domain::scene_schema(),
        512,
        cancel.clone(),
    )
    .await?;
    let lines = domain::parse_scene(result)?;
    let _action = lock(&state.action)?;
    let db = lock(&state.db)?;
    if !is_current(state, epoch, &cancel) || store::revision(&db)? != revision {
        return Ok(());
    }
    store::add_scene(
        &db,
        &PreparedScene {
            id: uuid::Uuid::new_v4().to_string(),
            revision,
            lines,
        },
    )?;
    Ok(())
}

async fn background_generate(
    state: &AppState,
    settings: &Settings,
    prompt: &[ChatMessage],
    schema: serde_json::Value,
    max_tokens: u32,
    cancel: Arc<AtomicBool>,
) -> Result<serde_json::Value, String> {
    let seconds = if settings.autonomous_enabled {
        (state.next_idle.load(Ordering::SeqCst) - now()).clamp(1, 45)
    } else {
        45
    };
    match tokio::time::timeout(
        Duration::from_secs(seconds as u64),
        inference::generate(
            &state.inference,
            settings,
            prompt,
            schema,
            max_tokens,
            cancel,
        ),
    )
    .await
    {
        Ok(result) => result,
        Err(_) => {
            if settings.mode == "local" {
                inference::stop_local(&state.inference).await;
            }
            Err("정해진 잡담 시간을 위해 새 대사 준비를 다음으로 미뤘어요.".into())
        }
    }
}

fn should_cancel_for_pause(paused: bool, automatic: bool) -> bool {
    paused && automatic
}
fn flush_positions(state: &AppState, all: bool) -> Result<(), String> {
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
fn reserve_api_idle(db: &Connection, at: i64) -> Result<bool, String> {
    let tx = db.unchecked_transaction().map_err(|e| e.to_string())?;
    let raw: Option<String> = tx
        .query_row("SELECT value FROM kv WHERE key='api_idle_times'", [], |r| {
            r.get(0)
        })
        .optional()
        .map_err(|e| e.to_string())?;
    let mut times: Vec<i64> = raw
        .map(|v| serde_json::from_str(&v))
        .transpose()
        .map_err(|e| e.to_string())?
        .unwrap_or_default();
    times.retain(|t| at.saturating_sub(*t) < 3600);
    if times.len() >= 2 {
        return Ok(false);
    }
    times.push(at);
    tx.execute("INSERT INTO kv(key,value) VALUES('api_idle_times',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[serde_json::to_string(&times).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(true)
}
#[tauri::command]
fn clear_api_key(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let (epoch, _) = {
        let _action = lock(&state.action)?;
        let settings = store::settings(&*lock(&state.db)?)?;
        inference::clear_api_key(&settings)?;
        interrupt(&state, false)?
    };
    phase(&app, &state, epoch, "idle", None, None);
    Ok(())
}

#[cfg(test)]
mod lifecycle_tests {
    use super::*;
    fn state() -> AppState {
        AppState {
            db: Mutex::new(store::open(std::path::Path::new(":memory:")).unwrap()),
            inference: inference::Inference::new(PathBuf::new(), PathBuf::new(), PathBuf::new()),
            app_data: PathBuf::new(),
            runtime: Mutex::new(RuntimeStatus::default()),
            playback: Mutex::new(None),
            panel: Mutex::new(None),
            cancellation: Mutex::new(None),
            download_cancel: Mutex::new(None),
            gate: tokio::sync::Mutex::new(()),
            epoch: AtomicU64::new(0),
            widget_epoch: AtomicU64::new(0),
            widget_playback: Mutex::new(None),
            talk: Mutex::new(talk::runtime::ActiveProgram::default()),
            talk_playback: Mutex::new(None),
            talk_turn: AtomicBool::new(true),
            widget_jobs: Mutex::new(HashMap::new()),
            widget_clocks: Mutex::new(std::collections::BTreeMap::new()),
            last_input: AtomicI64::new(0),
            last_foreground: AtomicI64::new(0),
            last_scene: AtomicI64::new(0),
            next_idle: AtomicI64::new(0),
            last_preparation: AtomicI64::new(0),
            last_background_check: AtomicI64::new(0),
            idle_sequence: AtomicU64::new(0),
            action: Mutex::new(()),
            automatic: AtomicBool::new(false),
            stopping: AtomicBool::new(false),
            positions: Mutex::new(HashMap::new()),
        }
    }
    #[test]
    fn talk_turns_leave_general_sequence_and_prepared_history_untouched() {
        let state = state();
        let program = talk::validate_source(
            std::path::Path::new("index.talk"),
            "format: 1\nscene: example\non: idle\ncooldown: 1h\n---\nA: 하나\nB: 둘\n===",
            &talk::context::registry(),
        )
        .unwrap();
        lock(&state.talk).unwrap().apply(Ok(program));
        assert_eq!(next_scene(&state).unwrap().1, "script");
        assert_eq!(next_scene(&state).unwrap().1, "talk");
        assert_eq!(state.idle_sequence.load(Ordering::SeqCst), 1);
        assert!(talk::runtime::history(&lock(&state.db).unwrap())
            .unwrap()
            .is_empty());
        assert_eq!(next_scene(&state).unwrap().1, "script");
        assert_eq!(state.idle_sequence.load(Ordering::SeqCst), 2);
        assert_eq!(next_scene(&state).unwrap().1, "talk");
        let revision = store::revision(&lock(&state.db).unwrap()).unwrap();
        let line = lock(&state.talk_playback)
            .unwrap()
            .as_ref()
            .unwrap()
            .selection
            .lines[0]
            .clone();
        assert!(present_line(
            &state,
            &line,
            "talk",
            "shown",
            0,
            2,
            revision,
            0,
            &AtomicBool::new(false)
        )
        .unwrap());
        assert_eq!(next_scene(&state).unwrap().1, "script");
        assert_eq!(next_scene(&state).unwrap().1, "script");
        assert_eq!(state.idle_sequence.load(Ordering::SeqCst), 4);
    }

    #[test]
    fn talk_remaining_lines_stop_after_each_dependency_and_host_invalidation() {
        for cause in [
            "todo",
            "memo",
            "disable",
            "input",
            "pause",
            "manual-pause",
            "auto-off",
            "reload",
            "swap",
            "hide",
        ] {
            let state = state();
            let directory = tempfile::tempdir().unwrap();
            let program = talk::validate_source(std::path::Path::new("index.talk"),
                "format: 1\nscene: joint\non: idle\nwhen: todo.ready and memo.ready\n---\nA: 할 일 ${todo.openCount}개\nB: 메모 ${memo.count}개\n===", &talk::context::registry()).unwrap();
            lock(&state.talk).unwrap().apply(Ok(program));
            let (token, lines, revision) = {
                let _action = lock(&state.action).unwrap();
                let db = lock(&state.db).unwrap();
                widgets::storage::install(&db, directory.path(), &["todo".into(), "memo".into()])
                    .unwrap();
                let token = interrupt(&state, cause != "manual-pause").unwrap();
                let lines = talk_host::prepare(&state, &db, None).unwrap().unwrap();
                assert!(talk::runtime::history(&db).unwrap().is_empty());
                (token, lines, store::revision(&db).unwrap())
            };
            assert!(present_line(
                &state, &lines[0], "talk", "first", 0, 2, revision, token.0, &token.1
            )
            .unwrap());
            match cause {
                "todo" | "memo" | "disable" => {
                    let db = lock(&state.db).unwrap();
                    let instance = widgets::storage::instances(&db)
                        .unwrap()
                        .into_iter()
                        .find(|instance| {
                            instance.kind == if cause == "disable" { "memo" } else { cause }
                        })
                        .unwrap();
                    if cause == "disable" {
                        widgets::storage::set_enabled(&db, &instance.id, false).unwrap();
                    } else {
                        let mut changed = instance.data;
                        changed["items"] = serde_json::json!([{"id":"added","title":"추가","text":"메모","completedAt":null}]);
                        widgets::storage::commit_data(
                            &db,
                            &instance.id,
                            instance.revision,
                            changed,
                            vec![],
                            chrono::Utc::now().timestamp_millis(),
                        )
                        .unwrap();
                    }
                }
                "pause" | "manual-pause" => {
                    apply_pause(&state, true).unwrap();
                }
                "auto-off" => {
                    let mut settings = store::settings(&lock(&state.db).unwrap()).unwrap();
                    settings.autonomous_enabled = false;
                    apply_settings(&state, &settings).unwrap();
                }
                "reload" => {
                    lock(&state.talk).unwrap().apply(talk::validate_source(
                        std::path::Path::new("index.talk"),
                        "format: 1\n",
                        &talk::context::registry(),
                    ));
                }
                "swap" => {
                    character_commands::mutate(&state, |db| {
                        characters::apply_pair(db, ["builtin-b".into(), "builtin-a".into()])
                    })
                    .unwrap();
                }
                _ => {
                    let _action = lock(&state.action).unwrap();
                    interrupt(&state, false).unwrap();
                }
            }
            assert!(
                !present_line(
                    &state, &lines[1], "talk", "second", 1, 2, revision, token.0, &token.1
                )
                .unwrap(),
                "{cause}"
            );
            assert_eq!(
                store::messages(&lock(&state.db).unwrap(), 10)
                    .unwrap()
                    .len(),
                1,
                "{cause}"
            );
            assert_eq!(
                talk::runtime::history(&lock(&state.db).unwrap())
                    .unwrap()
                    .len(),
                1,
                "{cause}"
            );
        }
    }

    #[test]
    fn talk_history_and_shown_message_commit_together_and_survive_reopen() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("history.sqlite");
        let message = Message {
            id: "first".into(),
            role: "assistant".into(),
            persona: Some("a".into()),
            content: "원문\n 그대로".into(),
            expression: Some("평온".into()),
            created_at: 1000,
            status: "complete".into(),
        };
        {
            let db = store::open(&path).unwrap();
            store::insert_message_with_talk(&db, &message, Some("scene-key")).unwrap();
            let duplicate = Message {
                created_at: 2000,
                ..message.clone()
            };
            store::insert_message_with_talk(&db, &duplicate, Some("scene-key")).unwrap();
            assert_eq!(talk::runtime::history(&db).unwrap()["scene-key"], 1000);
            db.execute_batch("CREATE TRIGGER fail_talk BEFORE INSERT ON talk_history BEGIN SELECT RAISE(ABORT,'test failure'); END;").unwrap();
            let failed = Message {
                id: "failed".into(),
                ..message.clone()
            };
            assert!(store::insert_message_with_talk(&db, &failed, Some("other")).is_err());
            assert_eq!(store::messages(&db, 10).unwrap().len(), 1);
        }
        let reopened = open_session(&path).unwrap();
        assert_eq!(
            talk::runtime::history(&reopened).unwrap()["scene-key"],
            1000
        );
        assert_eq!(
            store::messages(&reopened, 10).unwrap()[0].content,
            message.content
        );
    }

    #[test]
    fn brief_idle_pause_discards_widget_queue_before_a_scheduler_tick() {
        let state = state();
        let directory = tempfile::tempdir().unwrap();
        {
            let db = lock(&state.db).unwrap();
            widgets::storage::install(&db, directory.path(), &["small-match".into()]).unwrap();
            let instance = widgets::storage::instances(&db).unwrap().remove(0);
            widgets::storage::commit_data(
                &db,
                &instance.id,
                instance.revision,
                instance.data,
                vec![widgets::EventDraft {
                    kind: "small-match.result".into(),
                    text: "주사위 결과".into(),
                    payload: serde_json::json!({}),
                }],
                chrono::Utc::now().timestamp_millis(),
            )
            .unwrap();
        }
        assert!(!state.automatic.load(Ordering::SeqCst));
        assert!(apply_pause(&state, true).unwrap().is_none());
        {
            let db = lock(&state.db).unwrap();
            assert!(
                widgets::storage::take_reaction(&db, chrono::Utc::now().timestamp_millis())
                    .unwrap()
                    .is_none()
            );
            let instance = widgets::storage::instances(&db).unwrap().remove(0);
            widgets::storage::commit_data(
                &db,
                &instance.id,
                instance.revision,
                instance.data,
                vec![widgets::EventDraft {
                    kind: "small-match.result".into(),
                    text: "일시정지 중 발생한 결과".into(),
                    payload: serde_json::json!({}),
                }],
                chrono::Utc::now().timestamp_millis(),
            )
            .unwrap();
        }
        assert!(apply_pause(&state, false).unwrap().is_none());
        assert!(widgets::storage::take_reaction(
            &lock(&state.db).unwrap(),
            chrono::Utc::now().timestamp_millis()
        )
        .unwrap()
        .is_none());
    }

    #[test]
    fn widget_lines_stop_after_source_change_or_user_cancellation() {
        for cause in ["source-change", "disable", "input", "pause", "auto-off"] {
            let state = state();
            let directory = tempfile::tempdir().unwrap();
            let (instance, revision, event) = {
                let db = lock(&state.db).unwrap();
                widgets::storage::install(&db, directory.path(), &["small-match".into()]).unwrap();
                let instance = widgets::storage::instances(&db).unwrap().remove(0);
                widgets::storage::commit_data(
                    &db,
                    &instance.id,
                    instance.revision,
                    instance.data.clone(),
                    vec![widgets::EventDraft {
                        kind: "small-match.result".into(),
                        text: "주사위 결과".into(),
                        payload: serde_json::json!({}),
                    }],
                    chrono::Utc::now().timestamp_millis(),
                )
                .unwrap();
                let event =
                    widgets::storage::take_reaction(&db, chrono::Utc::now().timestamp_millis())
                        .unwrap()
                        .unwrap();
                (
                    widgets::storage::get(&db, &instance.id).unwrap(),
                    store::revision(&db).unwrap(),
                    event,
                )
            };
            let (epoch, cancel) = {
                let _guard = lock(&state.action).unwrap();
                let token = interrupt(&state, true).unwrap();
                *lock(&state.widget_playback).unwrap() = Some(event);
                token
            };
            let line = SceneLine {
                persona: "a".into(),
                expression: "normal".into(),
                text: "이미 표시한 결과".into(),
            };
            assert!(present_line(
                &state,
                &line,
                "widget",
                "widget-first",
                0,
                2,
                revision,
                epoch,
                &cancel
            )
            .unwrap());
            match cause {
                "source-change" => {
                    let db = lock(&state.db).unwrap();
                    let mut data = instance.data.clone();
                    data["rounds"] = serde_json::json!(2);
                    widgets::storage::commit_data(
                        &db,
                        &instance.id,
                        instance.revision,
                        data,
                        vec![],
                        chrono::Utc::now().timestamp_millis(),
                    )
                    .unwrap();
                }
                "disable" => {
                    widgets::storage::set_enabled(&lock(&state.db).unwrap(), &instance.id, false)
                        .unwrap()
                }
                "pause" => {
                    apply_pause(&state, true).unwrap();
                }
                "auto-off" => {
                    let mut settings = store::settings(&lock(&state.db).unwrap()).unwrap();
                    settings.autonomous_enabled = false;
                    apply_settings(&state, &settings).unwrap();
                }
                _ => {
                    let _guard = lock(&state.action).unwrap();
                    interrupt(&state, false).unwrap();
                }
            }
            assert!(
                !present_line(
                    &state,
                    &line,
                    "widget",
                    "widget-stale",
                    1,
                    2,
                    revision,
                    epoch,
                    &cancel
                )
                .unwrap(),
                "{cause}"
            );
            let history = store::messages(&lock(&state.db).unwrap(), 10).unwrap();
            assert_eq!(history.len(), 1, "{cause}");
            assert_eq!(history[0].id, "widget-first");
        }
    }

    #[test]
    fn inactive_character_installs_preserve_playback_but_active_definition_edits_cancel_it() {
        let state = state();
        let (epoch, cancel) = {
            let _action = lock(&state.action).unwrap();
            interrupt(&state, false).unwrap()
        };
        let (revision, definition) = {
            let db = lock(&state.db).unwrap();
            (
                store::revision(&db).unwrap(),
                characters::active_character(&db, "a").unwrap().definition,
            )
        };
        let line = SceneLine {
            persona: "a".into(),
            expression: "평온".into(),
            text: "아직 하고 있는 이야기야.".into(),
        };
        assert!(present_line(
            &state,
            &line,
            "script",
            "continuing-line",
            0,
            1,
            revision,
            epoch,
            &cancel
        )
        .unwrap());
        let before_playback = serde_json::to_value(lock(&state.playback).unwrap().clone()).unwrap();
        let pack = characters::parse_pack(include_str!(
            "../../examples/character-packs/sol-and-dal.comet-character.json"
        ))
        .unwrap();
        character_commands::mutate(&state, |db| characters::create(db, &definition)).unwrap();
        assert_eq!(state.epoch.load(Ordering::SeqCst), epoch);
        assert!(!cancel.load(Ordering::SeqCst));
        assert_eq!(
            store::revision(&lock(&state.db).unwrap()).unwrap(),
            revision
        );
        assert_eq!(
            serde_json::to_value(lock(&state.playback).unwrap().clone()).unwrap(),
            before_playback
        );
        character_commands::mutate(&state, |db| characters::import_pack(db, &pack)).unwrap();
        assert_eq!(state.epoch.load(Ordering::SeqCst), epoch);
        assert!(!cancel.load(Ordering::SeqCst));
        assert_eq!(
            store::revision(&lock(&state.db).unwrap()).unwrap(),
            revision
        );
        assert_eq!(
            serde_json::to_value(lock(&state.playback).unwrap().clone()).unwrap(),
            before_playback
        );
        let mut edited = definition;
        edited.name = "편집한 A".into();
        character_commands::mutate(&state, |db| characters::save(db, "builtin-a", &edited))
            .unwrap();
        assert!(state.epoch.load(Ordering::SeqCst) > epoch);
        assert!(cancel.load(Ordering::SeqCst));
        assert!(store::revision(&lock(&state.db).unwrap()).unwrap() > revision);
        assert!(lock(&state.playback).unwrap().is_none());
        assert!(!present_line(
            &state,
            &line,
            "script",
            "stale-line",
            0,
            1,
            revision,
            epoch,
            &cancel
        )
        .unwrap());
    }

    #[test]
    fn character_change_cancels_old_playback_and_retry_preserving_the_transcript() {
        let state = state();
        let old = {
            let _action = lock(&state.action).unwrap();
            interrupt(&state, false).unwrap()
        };
        let replacement = {
            let db = lock(&state.db).unwrap();
            store::insert_message(
                &db,
                &Message {
                    id: "before-change".into(),
                    role: "user".into(),
                    persona: Some("a".into()),
                    content: "내가 한 말은 그대로 남겨 줘.".into(),
                    expression: None,
                    created_at: 1,
                    status: "complete".into(),
                },
            )
            .unwrap();
            characters::clone_character(&db, "builtin-a").unwrap()
        };
        let revision = store::revision(&*lock(&state.db).unwrap()).unwrap();
        let line = SceneLine {
            persona: "a".into(),
            expression: "평온".into(),
            text: "이전 캐릭터의 대답".into(),
        };
        assert!(present_line(
            &state,
            &line,
            "llm",
            "old-reply",
            0,
            1,
            revision,
            old.0,
            &old.1
        )
        .unwrap());
        let before =
            serde_json::to_value(store::messages(&*lock(&state.db).unwrap(), 100).unwrap())
                .unwrap();
        character_commands::mutate(&state, |db| characters::assign(db, "a", &replacement.id))
            .unwrap();
        assert!(old.1.load(Ordering::SeqCst));
        assert!(lock(&state.playback).unwrap().is_none());
        assert!(!present_line(
            &state,
            &line,
            "llm",
            "late-reply",
            0,
            1,
            revision,
            old.0,
            &old.1
        )
        .unwrap());
        {
            let db = lock(&state.db).unwrap();
            assert_eq!(
                serde_json::to_value(store::messages(&db, 100).unwrap()).unwrap(),
                before
            );
            assert!(ensure_retry_characters(&db, "before-change", "a").is_err());
            assert!(store::prepared_scenes(&db).unwrap().is_empty());
        }
        character_commands::mutate(&state, |db| characters::assign(db, "a", "builtin-a")).unwrap();
        ensure_retry_characters(&lock(&state.db).unwrap(), "before-change", "a").unwrap();
    }

    #[test]
    fn character_change_rolls_back_if_prepared_scene_invalidation_fails() {
        let state = state();
        let id = characters::clone_character(&lock(&state.db).unwrap(), "builtin-a")
            .unwrap()
            .id;
        let before_epoch = state.epoch.load(Ordering::SeqCst);
        lock(&state.db).unwrap().execute_batch("CREATE TRIGGER fail_revision BEFORE UPDATE ON kv WHEN OLD.key='revision' BEGIN SELECT RAISE(ABORT,'storage failure'); END;").unwrap();
        assert!(character_commands::mutate(&state, |db| characters::assign(db, "a", &id)).is_err());
        assert_eq!(
            characters::active_character(&lock(&state.db).unwrap(), "a")
                .unwrap()
                .id,
            "builtin-a"
        );
        assert_eq!(state.epoch.load(Ordering::SeqCst), before_epoch);
    }

    #[test]
    fn authored_idle_wordbook_overrides_the_original_builtin_script() {
        let state = state();
        let db = lock(&state.db).unwrap();
        let lines = vec![SceneLine {
            persona: "b".into(),
            expression: "장난".into(),
            text: "내가 등록한 자동 수다.".into(),
        }];
        characters::save_dialogue(
            &db,
            &["builtin-a".into(), "builtin-b".into()],
            &characters::CharacterDialogue {
                pair_scenes: vec![],
                wordbook: vec![WordbookEntry {
                    id: uuid::Uuid::new_v4().to_string(),
                    title: "기본 캐릭터 수다".into(),
                    keywords: vec!["자동 수다".into()],
                    lines: lines.clone(),
                    enabled: true,
                    use_for_idle: true,
                }],
            },
        )
        .unwrap();
        assert_eq!(
            serde_json::to_value(character_script(&db, 1).unwrap()).unwrap(),
            serde_json::to_value(lines).unwrap()
        );
    }

    #[test]
    fn shared_character_pack_uses_authored_keyword_order_after_personal_entries() {
        let state = state();
        let pack = characters::parse_pack(include_str!(
            "../../examples/character-packs/sol-and-dal.comet-character.json"
        ))
        .unwrap();
        let imported =
            character_commands::mutate(&state, |db| characters::import_pack(db, &pack)).unwrap();
        character_commands::mutate(&state, |db| {
            characters::apply_pair(db, [imported[0].id.clone(), imported[1].id.clone()])
        })
        .unwrap();
        let db = lock(&state.db).unwrap();
        let lines = route_message(&state, &db, "별사탕").unwrap().unwrap();
        assert_eq!(
            serde_json::to_value(lines).unwrap(),
            serde_json::to_value(&pack.wordbook[0].lines).unwrap()
        );
        let greeting = character_script(&db, 0).unwrap();
        assert_eq!(greeting[0].text, pack.characters[0].greeting[0].text);
        let local = WordbookEntry {
            id: uuid::Uuid::new_v4().to_string(),
            title: "개인 대사".into(),
            keywords: vec!["별".into()],
            lines: vec![SceneLine {
                persona: "b".into(),
                expression: "장난".into(),
                text: "  내가 적은 말부터.\n\n  ".into(),
            }],
            enabled: true,
            use_for_idle: false,
        };
        wordbook::save(&db, &local).unwrap();
        assert_eq!(
            route_message(&state, &db, "별사탕").unwrap().unwrap()[0].text,
            local.lines[0].text
        );
        let automatic = character_script(&db, 1).unwrap();
        assert!(pack
            .pair_scenes
            .iter()
            .any(|scene| serde_json::to_value(scene).unwrap()
                == serde_json::to_value(&automatic).unwrap()));
    }

    #[test]
    fn keyword_route_works_without_a_model_and_preserves_authored_lines() {
        let mut state = state();
        let directory = tempfile::tempdir().unwrap();
        state.app_data = directory.path().to_path_buf();
        let db = lock(&state.db).unwrap();
        let entry = WordbookEntry {
            id: uuid::Uuid::new_v4().to_string(),
            title: "고정 대사".into(),
            keywords: vec!["수박".into()],
            lines: vec![
                SceneLine {
                    persona: "b".into(),
                    expression: "장난".into(),
                    text: "  그대로\n\n말할게.  ".into(),
                },
                SceneLine {
                    persona: "b".into(),
                    expression: "평온".into(),
                    text: "순서도 그대로.".into(),
                },
            ],
            enabled: true,
            use_for_idle: false,
        };
        wordbook::save(&db, &entry).unwrap();
        let lines = route_message(&state, &db, "오늘 수박 먹었어")
            .unwrap()
            .unwrap();
        assert_eq!(
            serde_json::to_value(lines).unwrap(),
            serde_json::to_value(&entry.lines).unwrap()
        );
        assert!(route_message(&state, &db, "새로운 주제로 이야기해 줘").is_err());
        store::save_settings(
            &db,
            &Settings {
                mode: "api".into(),
                api_model: String::new(),
                ..Settings::default()
            },
        )
        .unwrap();
        assert!(route_message(&state, &db, "수박").unwrap().is_some());
        assert!(route_message(&state, &db, "다른 말").is_err());
    }

    #[test]
    fn playback_cancellation_rejects_old_lines_and_old_timers_without_erasing_history() {
        let state = state();
        let revision = store::revision(&lock(&state.db).unwrap()).unwrap();
        let old = interrupt(&state, true).unwrap();
        let lines = playback::builtin_scene(0);
        assert!(present_line(
            &state, &lines[0], "script", "old-line", 0, 4, revision, old.0, &old.1
        )
        .unwrap());
        let current = interrupt(&state, false).unwrap();
        assert!(lock(&state.playback).unwrap().is_none());
        assert!(!present_line(
            &state,
            &lines[1],
            "script",
            "stale-line",
            1,
            4,
            revision,
            old.0,
            &old.1
        )
        .unwrap());
        assert!(present_line(
            &state, &lines[1], "wordbook", "new-line", 0, 1, revision, current.0, &current.1
        )
        .unwrap());
        assert!(!clear_line_if_current(&state, old.0, &old.1).unwrap());
        assert_eq!(
            lock(&state.playback).unwrap().as_ref().unwrap().id,
            "new-line"
        );
        assert!(clear_line_if_current(&state, current.0, &current.1).unwrap());
        assert!(lock(&state.playback).unwrap().is_none());
        let db = lock(&state.db).unwrap();
        let history = store::messages(&db, 100).unwrap();
        assert_eq!(history.len(), 2);
        assert!(history.iter().all(|message| message.id != "stale-line"));
        store::bump_revision(&db).unwrap();
        drop(db);
        assert!(!present_line(
            &state,
            &lines[2],
            "llm",
            "stale-revision",
            0,
            1,
            revision,
            current.0,
            &current.1
        )
        .unwrap());
    }

    #[test]
    fn automatic_chatter_recovers_from_errors_and_obeys_interaction_boundaries() {
        let state = state();
        state.last_input.store(now(), Ordering::SeqCst);
        state.next_idle.store(now() - 1, Ordering::SeqCst);
        assert!(begin_background(&state).unwrap().is_some());
        let (lines, source) = next_scene(&state).unwrap();
        assert_eq!(source, "script");
        assert_eq!(lines[0].text, playback::builtin_scene(0)[0].text);
        lock(&state.runtime).unwrap().phase = "error".into();
        assert!(begin_background(&state).unwrap().is_some());
        lock(&state.runtime).unwrap().paused = true;
        assert!(begin_background(&state).unwrap().is_none());
        lock(&state.runtime).unwrap().paused = false;
        lock(&state.runtime).unwrap().hidden = true;
        assert!(begin_background(&state).unwrap().is_none());
        lock(&state.runtime).unwrap().hidden = false;
        *lock(&state.panel).unwrap() = Some(PanelState {
            persona: "a".into(),
            mode: "input".into(),
        });
        assert!(begin_background(&state).unwrap().is_none());
        *lock(&state.panel).unwrap() = None;
        store::save_settings(
            &lock(&state.db).unwrap(),
            &Settings {
                autonomous_enabled: false,
                ..Settings::default()
            },
        )
        .unwrap();
        assert!(begin_background(&state).unwrap().is_none());
        assert_eq!(next_scene(&state).unwrap().1, "script");
    }

    #[test]
    fn restart_discards_prepared_scenes_but_keeps_saved_conversations_and_wordbook() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("session.sqlite");
        let db = open_session(&path).unwrap();
        store::add_scene(
            &db,
            &PreparedScene {
                id: "old-scene".into(),
                revision: 0,
                lines: playback::builtin_scene(1),
            },
        )
        .unwrap();
        store::insert_message(
            &db,
            &Message {
                id: "history".into(),
                role: "assistant".into(),
                persona: Some("a".into()),
                content: "어제의 이야기".into(),
                expression: Some("평온".into()),
                created_at: 1,
                status: "complete".into(),
            },
        )
        .unwrap();
        let entries = wordbook::entries(&db).unwrap();
        wordbook::delete(&db, &entries[0].id).unwrap();
        drop(db);
        let reopened = open_session(&path).unwrap();
        assert!(store::prepared_scenes(&reopened).unwrap().is_empty());
        assert_eq!(
            store::messages(&reopened, 10).unwrap()[0].content,
            "어제의 이야기"
        );
        assert_eq!(
            wordbook::entries(&reopened).unwrap().len(),
            entries.len() - 1
        );
    }
    #[test]
    fn model_change_preserves_history_and_invalidates_previous_work() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("settings.sqlite");
        let mut state = state();
        state.db = Mutex::new(store::open(&path).unwrap());
        let old = {
            let _action = lock(&state.action).unwrap();
            interrupt(&state, true).unwrap()
        };
        {
            let db = lock(&state.db).unwrap();
            let mut legacy = serde_json::to_value(Settings::default()).unwrap();
            legacy.as_object_mut().unwrap().remove("localModel");
            db.execute(
                "INSERT INTO kv VALUES('settings', ?1)",
                [legacy.to_string()],
            )
            .unwrap();
            assert_eq!(
                store::settings(&db).unwrap().local_model,
                LocalModel::Qwen35_4B
            );
            store::insert_message(
                &db,
                &Message {
                    id: "existing-message".into(),
                    role: "user".into(),
                    persona: Some("a".into()),
                    content: "안녕".into(),
                    expression: None,
                    created_at: 1,
                    status: "complete".into(),
                },
            )
            .unwrap();
            store::add_scene(
                &db,
                &PreparedScene {
                    id: "previous-model-scene".into(),
                    revision: store::revision(&db).unwrap(),
                    lines: vec![SceneLine {
                        persona: "a".into(),
                        expression: "평온".into(),
                        text: "안녕".into(),
                    }],
                },
            )
            .unwrap();
        }
        let selected = Settings {
            local_model: LocalModel::Qwen35_9B,
            ..Settings::default()
        };
        let current = apply_settings(&state, &selected).unwrap();
        assert!(old.1.load(Ordering::SeqCst));
        assert!(!set_phase_if_current(&state, old.0, "idle", None, None).unwrap());
        assert!(is_current(&state, current.0, &current.1));
        assert!(begin_background(&state).unwrap().is_none());
        drop(state);
        let reopened = store::open(&path).unwrap();
        assert_eq!(
            store::settings(&reopened).unwrap().local_model,
            LocalModel::Qwen35_9B
        );
        assert_eq!(store::messages(&reopened, 10).unwrap()[0].content, "안녕");
        assert!(store::prepared_scenes(&reopened).unwrap().is_empty());
    }
    #[test]
    fn download_reserves_selected_model_before_work_begins() {
        let mut state = state();
        let directory = tempfile::tempdir().unwrap();
        state.app_data = directory.path().to_path_buf();
        let cancel = begin_download(&state, LocalModel::Qwen35_9B).unwrap();
        assert_eq!(
            store::settings(&lock(&state.db).unwrap())
                .unwrap()
                .local_model,
            LocalModel::Qwen35_4B
        );
        assert!(begin_download(&state, LocalModel::Qwen35_4B).is_err());
        let progress = lock(&state.runtime).unwrap().download.clone().unwrap();
        assert_eq!(progress.model, LocalModel::Qwen35_9B);
        assert_eq!(progress.status, "downloading");
        assert_eq!(progress.total, 5_680_522_464);
        prepare_exit(&state).unwrap();
        assert!(cancel.load(Ordering::SeqCst));
        *lock(&state.download_cancel).unwrap() = None;
        assert!(begin_download(&state, LocalModel::Qwen35_4B).is_err());
    }
    #[test]
    fn new_submission_cancels_old_work_and_rejects_its_status_updates() {
        let state = state();
        let old = {
            let _action = lock(&state.action).unwrap();
            interrupt(&state, true).unwrap()
        };
        set_phase_if_current(&state, old.0, "analyzing", None, None).unwrap();
        let current = {
            let _action = lock(&state.action).unwrap();
            interrupt(&state, false).unwrap()
        };
        set_phase_if_current(&state, current.0, "generating", Some("a".into()), None).unwrap();
        assert!(old.1.load(Ordering::SeqCst));
        assert!(!is_current(&state, old.0, &old.1));
        assert!(
            !set_phase_if_current(&state, old.0, "error", None, Some("stale failure".into()))
                .unwrap()
        );
        assert_eq!(lock(&state.runtime).unwrap().phase, "generating");
        assert!(!should_cancel_for_pause(
            true,
            state.automatic.load(Ordering::SeqCst)
        ));
        assert!(should_cancel_for_pause(true, true));
        assert!(is_current(&state, current.0, &current.1));
    }
    #[tokio::test]
    async fn pair_generation_uses_one_request_and_partial_retry_only_generates_the_missing_reply() {
        use tokio::{
            io::{AsyncReadExt, AsyncWriteExt},
            net::TcpListener,
        };
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let calls = Arc::new(AtomicU64::new(0));
        let observed = calls.clone();
        let server = tokio::spawn(async move {
            let replies = [
                serde_json::json!({"lines":[
                    {"persona":"a","expression":"기쁨","text":"차를 마시며 쉬어 보자."},
                    {"persona":"b","expression":"장난","text":"그 차는 내가 고를게."}
                ]}),
                serde_json::json!({"persona":"b","expression":"평온","text":"따뜻한 차로 준비할게."}),
                serde_json::json!({"lines":[
                    {"persona":"a","expression":"기쁨","text":"검증 전에는 표시하지 마."}
                ]}),
            ];
            for (index, reply) in replies.into_iter().enumerate() {
                let (mut socket, _) =
                    tokio::time::timeout(Duration::from_secs(5), listener.accept())
                        .await
                        .unwrap()
                        .unwrap();
                let mut request = Vec::new();
                let body = loop {
                    let mut chunk = [0; 4096];
                    let read = socket.read(&mut chunk).await.unwrap();
                    assert!(read > 0);
                    request.extend_from_slice(&chunk[..read]);
                    if let Some(end) = request.windows(4).position(|bytes| bytes == b"\r\n\r\n") {
                        let headers = String::from_utf8_lossy(&request[..end]);
                        let length: usize = headers
                            .lines()
                            .find_map(|line| {
                                let (name, value) = line.split_once(':')?;
                                name.eq_ignore_ascii_case("content-length")
                                    .then(|| value.trim().parse().unwrap())
                            })
                            .unwrap();
                        if request.len() >= end + 4 + length {
                            break serde_json::from_slice::<serde_json::Value>(
                                &request[end + 4..end + 4 + length],
                            )
                            .unwrap();
                        }
                    }
                };
                observed.fetch_add(1, Ordering::SeqCst);
                let schema = &body["response_format"]["json_schema"]["schema"];
                if index == 1 {
                    assert!(schema["properties"].get("lines").is_none());
                    assert!(body["messages"].as_array().unwrap().iter().any(|message| {
                        message["content"]
                            .as_str()
                            .unwrap()
                            .contains("차를 마시며 쉬어 보자.")
                    }));
                } else {
                    assert_eq!(schema["properties"]["lines"]["minItems"], 2);
                    assert_eq!(schema["properties"]["lines"]["maxItems"], 2);
                }
                let body =
                    serde_json::json!({"choices":[{"message":{"content":reply.to_string()}}]})
                        .to_string();
                socket.write_all(format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                ).as_bytes()).await.unwrap();
            }
        });
        let state = state();
        let user = Message {
            id: "pair-user".into(),
            role: "user".into(),
            persona: Some("both".into()),
            content: "오늘은 차를 마시고 싶어. 둘이 골라 줘.".into(),
            expression: None,
            created_at: 1,
            status: "complete".into(),
        };
        {
            let db = lock(&state.db).unwrap();
            store::save_settings(
                &db,
                &Settings {
                    mode: "api".into(),
                    base_url: format!("http://{address}/v1"),
                    api_model: "test".into(),
                    api_token_parameter: "max_tokens".into(),
                    ..Settings::default()
                },
            )
            .unwrap();
            store::insert_message(&db, &user).unwrap();
        }
        let targets = vec!["a".into(), "b".into()];
        let original = interrupt(&state, false).unwrap();
        let (lines, revision) = generate_turn(&state, &targets, &user.id, original.1.clone())
            .await
            .unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(lines.len(), 2);
        assert_eq!(
            store::messages(&lock(&state.db).unwrap(), 100)
                .unwrap()
                .len(),
            1
        );
        assert!(present_line(
            &state,
            &lines[0],
            "llm",
            &reply_id(&user.id, "a"),
            0,
            2,
            revision,
            original.0,
            &original.1
        )
        .unwrap());
        let retry = interrupt(&state, false).unwrap();
        assert!(!present_line(
            &state,
            &lines[1],
            "llm",
            &reply_id(&user.id, "b"),
            1,
            2,
            revision,
            original.0,
            &original.1
        )
        .unwrap());
        let missing = remaining_retry("both", "both", &["a".into()]).unwrap();
        let (retried, revision) = generate_turn(&state, &missing, &user.id, retry.1.clone())
            .await
            .unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        assert_eq!(retried.len(), 1);
        assert_eq!(retried[0].persona, "b");
        assert!(present_line(
            &state,
            &retried[0],
            "llm",
            &reply_id(&user.id, "b"),
            0,
            1,
            revision,
            retry.0,
            &retry.1
        )
        .unwrap());
        let history = store::messages(&lock(&state.db).unwrap(), 100).unwrap();
        assert_eq!(history.len(), 3);
        assert_eq!(history[1].content, lines[0].text);
        assert_eq!(history[2].content, retried[0].text);
        let invalid_user = Message {
            id: "invalid-pair".into(),
            ..user
        };
        store::insert_message(&lock(&state.db).unwrap(), &invalid_user).unwrap();
        assert!(
            generate_turn(&state, &targets, &invalid_user.id, retry.1.clone())
                .await
                .is_err()
        );
        assert_eq!(calls.load(Ordering::SeqCst), 3);
        assert_eq!(
            store::messages(&lock(&state.db).unwrap(), 100)
                .unwrap()
                .len(),
            4
        );
        server.await.unwrap();
    }

    #[test]
    fn retry_only_requests_missing_original_recipients() {
        assert_eq!(
            remaining_retry("both", "both", &["a".into()]).unwrap(),
            vec!["b"]
        );
        assert!(remaining_retry("a", "both", &[]).is_err());
        assert!(remaining_retry("both", "a", &["a".into()])
            .unwrap()
            .is_empty());
        assert!(remaining_retry("both", "both", &["a".into(), "b".into()])
            .unwrap()
            .is_empty());
        assert_ne!(reply_id("first", "a"), reply_id("second", "a"));
    }
    #[test]
    fn api_idle_budget_survives_reopen_and_expires_after_an_hour() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("state.sqlite");
        let db = store::open(&path).unwrap();
        assert!(reserve_api_idle(&db, 100).unwrap());
        assert!(reserve_api_idle(&db, 101).unwrap());
        drop(db);
        let db = store::open(&path).unwrap();
        assert!(!reserve_api_idle(&db, 102).unwrap());
        assert!(!reserve_api_idle(&db, 99).unwrap());
        assert!(reserve_api_idle(&db, 3700).unwrap());
        assert!(!reserve_api_idle(&db, 3700).unwrap());
    }
    #[test]
    fn exit_preparation_cancels_owned_work_and_flushes_before_shutdown() {
        let state = state();
        let token = {
            let _action = lock(&state.action).unwrap();
            interrupt(&state, false).unwrap()
        };
        let download = Arc::new(AtomicBool::new(false));
        *lock(&state.download_cancel).unwrap() = Some(download.clone());
        lock(&state.positions).unwrap().insert(
            "b".into(),
            (WindowPosition { x: 320.0, y: 440.0 }, Instant::now()),
        );
        prepare_exit(&state).unwrap();
        assert!(state.stopping.load(Ordering::SeqCst));
        assert!(lock(&state.runtime).unwrap().hidden);
        assert!(token.1.load(Ordering::SeqCst));
        assert!(download.load(Ordering::SeqCst));
        assert!(begin_background(&state).unwrap().is_none());
        assert_eq!(
            store::window_position(&lock(&state.db).unwrap(), "b")
                .unwrap()
                .unwrap()
                .y,
            440.0
        );
        prepare_exit(&state).unwrap();
        assert!(lock(&state.action).is_ok());
        assert!(lock(&state.positions).unwrap().is_empty());
    }
    #[test]
    fn quit_flushes_positions_inside_the_debounce_window() {
        let state = state();
        lock(&state.positions).unwrap().insert(
            "a".into(),
            (WindowPosition { x: 120.0, y: 240.0 }, Instant::now()),
        );
        flush_positions(&state, false).unwrap();
        assert!(store::window_position(&lock(&state.db).unwrap(), "a")
            .unwrap()
            .is_none());
        flush_positions(&state, true).unwrap();
        assert_eq!(
            store::window_position(&lock(&state.db).unwrap(), "a")
                .unwrap()
                .unwrap()
                .x,
            120.0
        );
        assert!(lock(&state.positions).unwrap().is_empty());
    }
    #[test]
    fn pair_prompt_rejects_questions_removed_from_active_contexts() {
        for reason in ["swapped", "edited", "deleted"] {
            let db = store::open(std::path::Path::new(":memory:")).unwrap();
            let user = Message {
                id: "pair-question".into(),
                role: "user".into(),
                persona: Some("both".into()),
                content: "나는 산책을 좋아해".into(),
                expression: None,
                created_at: 1_800_000_000_000,
                status: "complete".into(),
            };
            store::insert_message(&db, &user).unwrap();
            let targets = vec!["a".into(), "b".into()];
            assert!(turn_prompt(&db, &targets, &user.id).is_ok());
            if reason == "swapped" {
                let new_character = characters::clone_character(&db, "builtin-a").unwrap();
                characters::assign(&db, "a", &new_character.id).unwrap();
                assert!(store::context_messages_for(&db, 24, "a")
                    .unwrap()
                    .is_empty());
                assert_eq!(store::context_messages_for(&db, 24, "b").unwrap().len(), 1);
            } else {
                store::analyze_apply(
                    &db,
                    &serde_json::json!({
                        "revision": store::revision(&db).unwrap(),
                        "memories": [{"kind":"user_fact", "certain":true,
                            "sourceMessageId":user.id, "evidence":user.content, "supersedesId":""}],
                        "events":[]
                    }),
                )
                .unwrap();
                let memory = store::memories(&db).unwrap().remove(0);
                if reason == "edited" {
                    store::edit_memory(&db, &memory.id, "나는 독서를 좋아해").unwrap();
                } else {
                    store::delete_memory(&db, &memory.id).unwrap();
                }
            }
            assert!(turn_prompt(&db, &targets, &user.id).is_err(), "{reason}");
            assert_eq!(store::messages(&db, 24).unwrap()[0].content, user.content);
        }
    }

    #[test]
    fn partial_retry_references_only_current_characters_completed_same_turn_reply() {
        for scenario in ["complete", "incomplete", "other-turn", "swapped"] {
            let db = store::open(std::path::Path::new(":memory:")).unwrap();
            let user = Message {
                id: "partial-question".into(),
                role: "user".into(),
                persona: Some("both".into()),
                content: "둘 다 한마디씩 해 줘".into(),
                expression: None,
                created_at: 1_800_000_000_000,
                status: "complete".into(),
            };
            store::insert_message(&db, &user).unwrap();
            let reply = Message {
                id: reply_id(
                    if scenario == "other-turn" {
                        "earlier-question"
                    } else {
                        &user.id
                    },
                    "a",
                ),
                role: "assistant".into(),
                persona: Some("a".into()),
                content: "SAME_TURN_A_REFERENCE".into(),
                expression: Some("평온".into()),
                created_at: user.created_at + 1,
                status: if scenario == "incomplete" {
                    "pending"
                } else {
                    "complete"
                }
                .into(),
            };
            store::insert_message(&db, &reply).unwrap();
            if scenario == "swapped" {
                let new_character = characters::clone_character(&db, "builtin-a").unwrap();
                characters::assign(&db, "a", &new_character.id).unwrap();
            }
            let prompt = turn_prompt(&db, &["b".into()], &user.id).unwrap();
            assert_eq!(
                prompt
                    .iter()
                    .any(|message| message.content.contains("SAME_TURN_A_REFERENCE")),
                scenario == "complete",
                "{scenario}"
            );
            assert_eq!(store::messages(&db, 24).unwrap().len(), 2);
        }
    }
}
