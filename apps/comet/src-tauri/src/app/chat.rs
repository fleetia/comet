#[cfg(test)]
use super::interrupt;
use super::{lock, now, phase, schedule_idle, unavailable, AppState};
use crate::{
    characters, store,
    types::{PanelState, RuntimePhase},
};
use std::sync::{atomic::Ordering, Arc};

#[tauri::command]
pub(crate) fn open_reply(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    playback_id: String,
) -> Result<(), String> {
    if focus_history_editor(&app, &state)?.is_some() {
        return Ok(());
    }
    let epoch = begin_reply(&state, &playback_id)?;
    crate::desktop::request_balloon_focus(&app)?;
    phase(&app, &state, epoch, RuntimePhase::Idle, None, None);
    Ok(())
}

fn begin_reply(state: &AppState, playback_id: &str) -> Result<u64, String> {
    let _action = lock(&state.action)?;
    if unavailable(state) {
        return Err("앱을 종료하고 있어요.".into());
    }
    if history_editor_active(state)? {
        return Err("지난 대화 창에서 쓰던 내용을 저장하고 닫은 뒤 이어 주세요.".into());
    }
    let db = lock(&state.db)?;
    let line = lock(&state.playback)?
        .as_ref()
        .filter(|line| line.id == playback_id && line.display_started_at.is_some())
        .cloned()
        .ok_or("이 말풍선은 이미 지나갔어요. 지난 대화에서 확인해 주세요.")?;
    if line.source == "update" {
        return Err("업데이트 알림의 이동하기 버튼으로 설정을 열어 주세요.".into());
    }
    let actor = crate::characters::guests::actor(state, &db, &line.persona)?;
    let center =
        crate::characters::guests::center_id(state, &actor.id)?.unwrap_or(actor.id.clone());
    crate::characters::life::wake(state, &actor.id)?;
    super::conversation::ensure_available(&db)?;
    let waiting_pack =
        super::conversation::waiting_pack_run(state, &db, std::slice::from_ref(&center))?;
    if actor.definition.presence_role == crate::pack_stories::PresenceRole::Npc
        && waiting_pack.is_none()
    {
        return Err("이야기 대사가 끝난 뒤 NPC에게 말 걸어 주세요.".into());
    }
    let registered = store::current_user(&db)?.is_some();
    if registered {
        let seed = (actor.definition.presence_role == crate::pack_stories::PresenceRole::Resident
            && !matches!(line.source.as_str(), "story" | "scenario" | "npc"))
        .then_some(line.id.as_str());
        let source =
            if seed.is_some() && store::automatic_message_displayed_at(&db, &line.id)?.is_some() {
                "automatic"
            } else {
                "reply"
            };
        store::create_conversation_with_source(
            &db,
            std::slice::from_ref(&center),
            seed,
            None,
            chrono::Utc::now().timestamp_millis(),
            Some(source),
        )?;
    }
    let epoch = if waiting_pack.is_some() {
        super::interrupt_for_conversation(state, false)?.0
    } else {
        super::interrupt_with_db(state, false, &db)?.0
    };
    super::conversation::retain_pack_run(state, &db, waiting_pack, epoch)?;
    *lock(&state.panel)? = Some(PanelState {
        persona: line.persona,
        mode: if registered { "input" } else { "name" }.into(),
    });
    state.last_input.store(now(), Ordering::SeqCst);
    Ok(epoch)
}

#[tauri::command]
pub(crate) fn resume_chat(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    session_id: String,
    surface: Option<String>,
) -> Result<store::ConversationView, String> {
    let mode = match surface.as_deref() {
        None | Some("desktop") => "input",
        Some("history") => "history-input",
        _ => return Err("이 대화를 이어갈 화면을 확인해 주세요.".into()),
    };
    if mode == "input" {
        if let Some(view) = focus_history_editor(&app, &state)? {
            return Ok(view);
        }
    }
    let (epoch, recovery, view) = begin_resume_on_surface(&state, &session_id, mode)?;
    if mode == "input" {
        crate::desktop::request_balloon_focus(&app)?;
    }
    phase(
        &app,
        &state,
        epoch,
        if recovery.is_some() {
            RuntimePhase::Error
        } else {
            RuntimePhase::Idle
        },
        None,
        recovery,
    );
    Ok(view)
}

#[cfg(test)]
fn begin_resume(state: &AppState, session_id: &str) -> Result<(u64, Option<String>), String> {
    begin_resume_on_surface(state, session_id, "input")
        .map(|(epoch, recovery, _)| (epoch, recovery))
}

fn begin_resume_on_surface(
    state: &AppState,
    session_id: &str,
    mode: &str,
) -> Result<(u64, Option<String>, store::ConversationView), String> {
    let _action = lock(&state.action)?;
    if unavailable(state) {
        return Err("앱을 종료하고 있어요.".into());
    }
    if lock(&state.runtime)?.hidden {
        return Err("캐릭터를 다시 표시한 뒤 대화를 이어 주세요.".into());
    }
    let db = lock(&state.db)?;
    if mode == "input" && history_editor_active(state)? {
        return Err("지난 대화 창에서 쓰던 내용을 저장하고 닫은 뒤 이어 주세요.".into());
    }
    let session = store::conversation(&db, session_id)?;
    let active = characters::active_ids(&db)?;
    if session.participants.iter().any(|id| !active.contains(id)) {
        return Err("그때의 친구들을 다시 함께 지내기로 선택하면 이어갈 수 있어요.".into());
    }
    for id in &session.participants {
        crate::characters::life::wake(state, id)?;
    }
    super::conversation::ensure_available(&db)?;
    let recovery = store::conversation_recovery(&db, &session.id)?.and_then(|recovery| {
        (recovery.reason == store::RecoveryReason::Incomplete).then(|| {
            "마지막 답변을 마치지 못했어요. 다시 이야기하기로 이어갈 수 있어요.".to_string()
        })
    });
    let at = chrono::Utc::now().timestamp_millis();
    let source = if mode == "history-input" {
        "history"
    } else {
        "desktop"
    };
    let active_id = if session.status == "ended" {
        store::create_conversation_with_source(
            &db,
            &session.participants,
            None,
            Some(&session.id),
            at,
            Some(source),
        )?
        .id
    } else {
        let resumed = session.status != "active"
            || lock(&state.panel)?
                .as_ref()
                .is_none_or(|panel| panel.mode != mode);
        store::set_conversation_status(&db, &session.id, "active", at)?;
        if resumed {
            store::record_conversation_event(&db, &session.id, "resumed", Some(source), None, at)?;
        }
        session.id.clone()
    };
    let epoch = super::interrupt_with_db(state, false, &db)?.0;
    *lock(&state.panel)? = Some(PanelState {
        persona: session
            .participants
            .first()
            .cloned()
            .ok_or("대화 상대가 없어요.")?,
        mode: mode.into(),
    });
    state.last_input.store(now(), Ordering::SeqCst);
    Ok((epoch, recovery, store::conversation_view(&db, &active_id)?))
}

#[tauri::command]
pub(crate) fn finish_conversation(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    session_id: String,
) -> Result<(), String> {
    let epoch = {
        let _action = lock(&state.action)?;
        let db = lock(&state.db)?;
        let current = store::active_conversation(&db)?.ok_or("진행 중인 대화가 없어요.")?;
        if current.id != session_id {
            return Err("현재 대화가 바뀌었어요.".into());
        }
        store::set_conversation_status(
            &db,
            &session_id,
            "ended",
            chrono::Utc::now().timestamp_millis(),
        )?;
        let epoch = super::interrupt_with_db(&state, false, &db)?.0;
        *lock(&state.panel)? = None;
        schedule_idle(&state, store::settings(&db)?.idle_minutes);
        epoch
    };
    phase(&app, &state, epoch, RuntimePhase::Idle, None, None);
    Ok(())
}

#[tauri::command]
pub(crate) fn save_conversation_draft(
    state: tauri::State<'_, Arc<AppState>>,
    session_id: String,
    draft: String,
    input_owner: Option<String>,
) -> Result<(), String> {
    save_editor_draft(&state, &session_id, &draft, input_owner.as_deref())
}

fn save_editor_draft(
    state: &AppState,
    session_id: &str,
    draft: &str,
    input_owner: Option<&str>,
) -> Result<(), String> {
    let _action = lock(&state.action)?;
    let db = lock(&state.db)?;
    if let Some(owner) = input_owner {
        let mode = match owner {
            "desktop" => "input",
            "history" => "history-input",
            _ => return Err("대화 입력 위치가 올바르지 않아요.".into()),
        };
        let competing = lock(&state.panel)?.as_ref().is_some_and(|panel| {
            matches!(panel.mode.as_str(), "input" | "history-input") && panel.mode != mode
        });
        if competing
            || store::active_conversation(&db)?.is_some_and(|session| session.id != session_id)
        {
            return Err("대화 입력 위치가 바뀌었어요. 현재 열린 입력창에서 이어 주세요.".into());
        }
    }
    store::save_conversation_draft(&db, session_id, draft)
}

pub(crate) fn history_editor_active(state: &AppState) -> Result<bool, String> {
    Ok(lock(&state.panel)?
        .as_ref()
        .is_some_and(|panel| panel.mode == "history-input"))
}

pub(crate) fn focus_history_editor(
    app: &tauri::AppHandle,
    state: &AppState,
) -> Result<Option<store::ConversationView>, String> {
    let view = {
        let _action = lock(&state.action)?;
        if !history_editor_active(state)? {
            return Ok(None);
        }
        let db = lock(&state.db)?;
        let session = store::active_conversation(&db)?.ok_or("진행 중인 대화가 없어요.")?;
        store::conversation_view(&db, &session.id)?
    };
    super::history_window::open(app, "all")?;
    Ok(Some(view))
}

fn ensure_editor(
    state: &AppState,
    db: &rusqlite::Connection,
    session_id: &str,
    mode: &str,
) -> Result<(), String> {
    if lock(&state.panel)?
        .as_ref()
        .is_none_or(|panel| panel.mode != mode)
        || store::active_conversation(db)?.is_none_or(|session| session.id != session_id)
    {
        return Err("대화 입력 위치가 바뀌었어요. 현재 열린 입력창에서 이어 주세요.".into());
    }
    Ok(())
}

pub(crate) fn input_panel_mode(state: &AppState) -> Result<&'static str, String> {
    Ok(
        if lock(&state.panel)?
            .as_ref()
            .is_some_and(|panel| panel.mode == "history-input")
        {
            "history-input"
        } else {
            "input"
        },
    )
}

#[tauri::command]
pub(crate) async fn release_conversation_history(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    session_id: Option<String>,
    generation: u64,
    restoration: Option<super::history_window::Restoration>,
) -> Result<bool, String> {
    super::history_window::release(
        app,
        state.inner().clone(),
        session_id,
        generation,
        restoration,
    )
    .await
}

#[cfg(test)]
fn release_history_editor(state: &AppState, session_id: Option<&str>) -> Result<bool, String> {
    let _action = lock(&state.action)?;
    release_history_editor_locked(state, session_id)
}

pub(super) fn release_history_editor_locked(
    state: &AppState,
    session_id: Option<&str>,
) -> Result<bool, String> {
    let db = lock(&state.db)?;
    let Some(session_id) = session_id else {
        if lock(&state.panel)?
            .as_ref()
            .is_some_and(|panel| panel.mode == "history-input")
        {
            return Err("작성 중인 대화를 저장한 뒤 닫아 주세요.".into());
        }
        return Ok(false);
    };
    ensure_editor(state, &db, session_id, "history-input")?;
    if let Some(panel) = lock(&state.panel)?.as_mut() {
        panel.mode = "input".into();
    }
    Ok(true)
}

#[tauri::command]
pub(crate) fn discuss_music_widget(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
    expected_revision: i64,
) -> Result<(), String> {
    if focus_history_editor(&app, &state)?.is_some() {
        return Ok(());
    }
    let epoch = begin_music_discussion(&state, &id, expected_revision)?;
    crate::desktop::request_balloon_focus(&app)?;
    phase(&app, &state, epoch, RuntimePhase::Idle, None, None);
    Ok(())
}

fn music_discussion_draft(
    instance: &crate::widgets::WidgetInstance,
    revision: i64,
    at: i64,
) -> Result<String, String> {
    let observation = &instance.data["observation"];
    if instance.kind != "music"
        || instance.revision != revision
        || instance.data["configured"] != true
        || !matches!(instance.data["status"].as_str(), Some("ready" | "syncing"))
        || !observation["observedAt"]
            .as_i64()
            .is_some_and(|value| at >= value && at - value <= 30_000)
    {
        return Err("곡 정보가 바뀌었어요. 다시 확인한 뒤 이야기해 주세요.".into());
    }
    let title = observation["title"]
        .as_str()
        .filter(|value| !value.trim().is_empty())
        .ok_or("이야기할 곡이 없어요.")?;
    let artist = observation["artist"].as_str().unwrap_or("");
    let title: String = title.chars().take(500).collect();
    let artist: String = artist.chars().take(500).collect();
    Ok(if artist.is_empty() {
        format!("지금 듣는 곡 ‘{title}’에 대해 이야기해 줘.")
    } else {
        format!("지금 듣는 곡 ‘{title}’ — {artist}에 대해 이야기해 줘.")
    })
}

fn begin_music_discussion(state: &AppState, id: &str, revision: i64) -> Result<u64, String> {
    let (persona, draft) = {
        let _action = lock(&state.action)?;
        let db = lock(&state.db)?;
        if store::current_user(&db)?.is_none() {
            return Err("친구에게 이름을 알려 준 뒤 이야기할 수 있어요.".into());
        }
        if crate::widgets::storage::focus_active(&db, chrono::Utc::now().timestamp_millis())? {
            return Err("집중을 마친 뒤 곡 이야기를 할 수 있어요.".into());
        }
        let instance = crate::widgets::storage::get(&db, id)?;
        let draft =
            music_discussion_draft(&instance, revision, chrono::Utc::now().timestamp_millis())?;
        let persona = characters::active_ids(&db)?
            .into_iter()
            .next()
            .ok_or("함께 지내는 친구를 먼저 골라 주세요.")?;
        (persona, draft)
    };
    let epoch = super::windows::begin_panel_with_source(state, &persona, "input".into(), "music")?
        .ok_or("대화창을 열 수 없어요.")?;
    let _action = lock(&state.action)?;
    if state.epoch.load(Ordering::SeqCst) != epoch {
        return Err("대화가 바뀌어 곡 초안을 넣지 않았어요.".into());
    }
    let db = lock(&state.db)?;
    let instance = crate::widgets::storage::get(&db, id)?;
    music_discussion_draft(&instance, revision, chrono::Utc::now().timestamp_millis())?;
    let session = store::active_conversation(&db)?.ok_or("대화창을 열 수 없어요.")?;
    if !session.draft.is_empty() {
        return Err("작성 중인 초안을 보존했어요.".into());
    }
    store::save_conversation_draft(&db, &session.id, &draft)?;
    Ok(epoch)
}

#[tauri::command]
pub(crate) fn get_conversations(
    state: tauri::State<'_, Arc<AppState>>,
    persona: Option<String>,
    query: Option<String>,
) -> Result<Vec<store::ConversationSession>, String> {
    let db = lock(&state.db)?;
    let character = persona
        .as_deref()
        .map(|persona| crate::characters::guests::actor(&state, &db, persona))
        .transpose()?;
    store::conversation_history(
        &db,
        character.as_ref().map(|actor| actor.id.as_str()),
        query.as_deref(),
    )
}

#[cfg(test)]
pub(crate) fn conversation_sessions(
    state: &AppState,
    persona: &str,
) -> Result<Vec<store::ConversationSession>, String> {
    let db = lock(&state.db)?;
    let character = crate::characters::guests::actor(state, &db, persona)?;
    store::conversations(&db, &character.id)
}

#[tauri::command]
pub(crate) fn get_conversation_messages(
    state: tauri::State<'_, Arc<AppState>>,
    session_id: String,
    before: Option<i64>,
) -> Result<store::ConversationMessages, String> {
    store::conversation_messages(&*lock(&state.db)?, &session_id, before)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{Message, Playback, SceneLine, Settings, WordbookEntry};

    #[test]
    fn hidden_characters_reject_history_resume_without_consuming_the_saved_draft() {
        let state = super::super::tests::state();
        let session = {
            let db = lock(&state.db).unwrap();
            store::set_user_name(&db, "대화 검사", 1).unwrap();
            let session =
                store::create_conversation(&db, &["builtin-a".into()], None, None, 1).unwrap();
            store::save_conversation_draft(&db, &session.id, "  숨기기 전 초안\n보존  ").unwrap();
            store::pause_conversations(&db).unwrap();
            store::conversation(&db, &session.id).unwrap()
        };
        lock(&state.runtime).unwrap().hidden = true;
        let epoch = state.epoch.load(Ordering::SeqCst);
        let error = begin_resume_on_surface(&state, &session.id, "history-input").unwrap_err();
        assert_eq!(error, "캐릭터를 다시 표시한 뒤 대화를 이어 주세요.");
        assert_eq!(state.epoch.load(Ordering::SeqCst), epoch);
        assert!(lock(&state.panel).unwrap().is_none());
        let db = lock(&state.db).unwrap();
        assert!(store::active_conversation(&db).unwrap().is_none());
        assert_eq!(store::conversation(&db, &session.id).unwrap(), session);
    }

    #[test]
    fn history_editor_handoff_preserves_drafts_and_rejects_competing_desktop_commands() {
        let state = super::super::tests::state();
        let session = {
            let db = lock(&state.db).unwrap();
            store::set_user_name(&db, "대화 검사", 1).unwrap();
            let session =
                store::create_conversation(&db, &["builtin-a".into()], None, None, 1).unwrap();
            store::save_conversation_draft(&db, &session.id, "  저장된 초안\n그대로  ").unwrap();
            session
        };
        let (_, _, view) = begin_resume_on_surface(&state, &session.id, "history-input").unwrap();
        assert_eq!(view.session.id, session.id);
        assert_eq!(view.timeline_events.last().unwrap().kind, "resumed");
        assert_eq!(
            view.timeline_events.last().unwrap().source.as_deref(),
            Some("history")
        );
        let (_, _, repeated) =
            begin_resume_on_surface(&state, &session.id, "history-input").unwrap();
        assert_eq!(repeated.timeline_events, view.timeline_events);
        assert_eq!(view.session.draft, "  저장된 초안\n그대로  ");
        assert_eq!(input_panel_mode(&state).unwrap(), "history-input");
        let epoch = state.epoch.load(Ordering::SeqCst);
        for mode in ["input", "menu", "history"] {
            assert!(
                super::super::windows::begin_panel(&state, "builtin-b", mode.into())
                    .unwrap()
                    .is_none()
            );
        }
        assert!(begin_resume(&state, &session.id).is_err());
        assert!(begin_reply(&state, "stale-playback").is_err());
        assert_eq!(state.epoch.load(Ordering::SeqCst), epoch);
        assert!(
            save_editor_draft(&state, &session.id, "오래된 desktop 초안", Some("desktop")).is_err()
        );
        save_editor_draft(
            &state,
            &session.id,
            "지난 창에서 고친 초안",
            Some("history"),
        )
        .unwrap();
        assert!(release_history_editor(&state, None).is_err());
        assert!(release_history_editor(&state, Some("old-session")).is_err());
        assert!(history_editor_active(&state).unwrap());
        assert!(release_history_editor(&state, Some(&session.id)).unwrap());
        assert_eq!(input_panel_mode(&state).unwrap(), "input");
        assert_eq!(state.epoch.load(Ordering::SeqCst), epoch);
        assert!(save_editor_draft(
            &state,
            &session.id,
            "늦게 도착한 history 초안",
            Some("history")
        )
        .is_err());
        let db = lock(&state.db).unwrap();
        assert_eq!(
            store::active_conversation(&db).unwrap().unwrap().id,
            session.id
        );
        assert_eq!(
            store::conversation(&db, &session.id).unwrap().draft,
            "지난 창에서 고친 초안"
        );
    }

    #[test]
    fn history_resume_returns_new_session_for_ended_records_and_final_flush_allows_paused_owner() {
        let state = super::super::tests::state();
        let ended = {
            let db = lock(&state.db).unwrap();
            store::set_user_name(&db, "대화 검사", 1).unwrap();
            let ended =
                store::create_conversation(&db, &["builtin-a".into()], None, None, 1).unwrap();
            store::set_conversation_status(&db, &ended.id, "ended", 2).unwrap();
            ended
        };
        let (_, _, view) = begin_resume_on_surface(&state, &ended.id, "history-input").unwrap();
        assert_ne!(view.session.id, ended.id);
        assert_eq!(
            view.session.continued_from.as_deref(),
            Some(ended.id.as_str())
        );
        *lock(&state.panel).unwrap() = None;
        store::pause_conversations(&lock(&state.db).unwrap()).unwrap();
        save_editor_draft(
            &state,
            &view.session.id,
            "숨김 직전 초안\n보존",
            Some("history"),
        )
        .unwrap();
        assert!(!release_history_editor(&state, None).unwrap());
        {
            let db = lock(&state.db).unwrap();
            assert_eq!(
                store::conversation(&db, &view.session.id).unwrap().draft,
                "숨김 직전 초안\n보존"
            );
            store::create_conversation(&db, &["builtin-b".into()], None, None, 3).unwrap();
        }
        assert!(save_editor_draft(
            &state,
            &view.session.id,
            "다른 세션을 덮는 초안",
            Some("history")
        )
        .is_err());
        store::set_user_name(&lock(&state.db).unwrap(), "다른 사용자", 4).unwrap();
        assert!(save_editor_draft(
            &state,
            &view.session.id,
            "다른 사용자의 초안",
            Some("history")
        )
        .is_err());
    }

    #[test]
    fn opening_history_pauses_desktop_conversation_and_removes_only_its_panel() {
        let state = super::super::tests::state();
        let session = {
            let db = lock(&state.db).unwrap();
            store::set_user_name(&db, "대화 검사", 1).unwrap();
            let session =
                store::create_conversation(&db, &["builtin-a".into()], None, None, 1).unwrap();
            store::save_conversation_draft(&db, &session.id, "이어서 쓸 초안").unwrap();
            session
        };
        *lock(&state.panel).unwrap() = Some(PanelState {
            persona: "builtin-a".into(),
            mode: "input".into(),
        });
        assert!(
            super::super::windows::begin_panel(&state, "builtin-a", "history".into())
                .unwrap()
                .is_some()
        );
        assert!(lock(&state.panel).unwrap().is_none());
        let db = lock(&state.db).unwrap();
        let stored = store::conversation(&db, &session.id).unwrap();
        assert_eq!(stored.status, "paused");
        assert_eq!(stored.draft, "이어서 쓸 초안");
    }

    #[test]
    fn music_discussion_creates_only_a_new_draft_and_preserves_existing_conversations() {
        let state = super::super::tests::state();
        let at = chrono::Utc::now().timestamp_millis();
        let old = {
            let db = lock(&state.db).unwrap();
            store::set_user_name(&db, "음악 검사", at).unwrap();
            let actor = characters::active_ids(&db).unwrap()[0].clone();
            let old = store::create_conversation(&db, &[actor], None, None, at).unwrap();
            store::save_conversation_draft(&db, &old.id, "쓰던 초안\n보존").unwrap();
            let data = serde_json::json!({"configured":true,"status":"ready","observation":{"observedAt":at,"title":"밤의 산책","artist":"별빛정원"}});
            db.execute("INSERT INTO widget_instances(id,kind,version,installed,enabled,revision,data) VALUES('music-talk','music',1,1,1,7,?1)", [data.to_string()]).unwrap();
            old
        };
        assert!(begin_music_discussion(&state, "music-talk", 6).is_err());
        begin_music_discussion(&state, "music-talk", 7).unwrap();
        let db = lock(&state.db).unwrap();
        let current = store::active_conversation(&db).unwrap().unwrap();
        assert_ne!(current.id, old.id);
        assert_eq!(
            store::conversation_view(&db, &current.id)
                .unwrap()
                .timeline_events[0]
                .source
                .as_deref(),
            Some("music")
        );
        assert_eq!(
            store::conversation(&db, &old.id).unwrap().draft,
            "쓰던 초안\n보존"
        );
        assert_eq!(
            current.draft,
            "지금 듣는 곡 ‘밤의 산책’ — 별빛정원에 대해 이야기해 줘."
        );
        assert_eq!(
            db.query_row(
                "SELECT COUNT(*) FROM messages WHERE role='user'",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
    }

    #[test]
    fn replying_before_registration_opens_the_name_prompt_without_a_conversation() {
        let state = super::super::tests::state();
        let id = characters::active_ids(&lock(&state.db).unwrap()).unwrap()[0].clone();
        *lock(&state.playback).unwrap() = Some(Playback {
            id: "greeting".into(),
            persona: id,
            expression: "평온".into(),
            text: "안녕!".into(),
            motion: Default::default(),
            source: "script".into(),
            text_speed: 0,
            display_started_at: Some(1),
            ends_at: 100,
            line_index: 0,
            line_count: 1,
        });
        begin_reply(&state, "greeting").unwrap();
        assert_eq!(lock(&state.panel).unwrap().as_ref().unwrap().mode, "name");
        assert!(store::active_conversation(&lock(&state.db).unwrap())
            .unwrap()
            .is_none());
    }

    #[test]
    fn update_notices_cannot_be_captured_as_a_conversation_reply() {
        let state = super::super::tests::state();
        let actor = characters::active_ids(&lock(&state.db).unwrap()).unwrap()[0].clone();
        *lock(&state.playback).unwrap() = Some(Playback {
            id: "update-notice".into(),
            persona: actor,
            expression: "평온".into(),
            text: "새로운 업데이트가 있어요!".into(),
            motion: Default::default(),
            source: "update".into(),
            text_speed: 0,
            display_started_at: Some(1),
            ends_at: 100,
            line_index: 0,
            line_count: 1,
        });
        assert!(begin_reply(&state, "update-notice")
            .unwrap_err()
            .contains("이동하기"));
        assert!(lock(&state.panel).unwrap().is_none());
        assert!(store::active_conversation(&lock(&state.db).unwrap())
            .unwrap()
            .is_none());
        assert_eq!(
            lock(&state.playback).unwrap().as_ref().unwrap().id,
            "update-notice"
        );
    }

    #[test]
    fn clicking_only_the_displayed_line_captures_original_and_cancels_the_old_scene() {
        let state = super::super::tests::state();
        let at = chrono::Utc::now().timestamp_millis();
        let id = {
            let db = lock(&state.db).unwrap();
            store::set_user_name(&db, "대화 검사", at).unwrap();
            let id = characters::active_ids(&db).unwrap()[0].clone();
            store::insert_message_with_source(
                &db,
                &Message {
                    id: "shown".into(),
                    role: "assistant".into(),
                    persona: Some(id.clone()),
                    content: "  원문\n그대로  ".into(),
                    expression: Some("평온".into()),
                    created_at: at,
                    status: "complete".into(),
                },
                "script",
                None,
                false,
            )
            .unwrap();
            id
        };
        let (epoch, cancel) = interrupt(&state, true).unwrap();
        *lock(&state.playback).unwrap() = Some(Playback {
            id: "shown".into(),
            persona: id.clone(),
            expression: "평온".into(),
            text: "  원문\n그대로  ".into(),
            motion: Default::default(),
            source: "script".into(),
            text_speed: 0,
            display_started_at: None,
            ends_at: 0,
            line_index: 0,
            line_count: 2,
        });
        assert!(begin_reply(&state, "shown").is_err());
        assert_eq!(
            store::automatic_message_displayed_at(&lock(&state.db).unwrap(), "shown").unwrap(),
            None
        );
        lock(&state.playback)
            .unwrap()
            .as_mut()
            .unwrap()
            .display_started_at = Some(at);
        store::mark_message_displayed_with_provenance(
            &lock(&state.db).unwrap(),
            "shown",
            at,
            Some(true),
        )
        .unwrap();
        assert!(begin_reply(&state, "previous").is_err());
        assert_eq!(state.epoch.load(Ordering::SeqCst), epoch);
        assert!(!cancel.load(Ordering::SeqCst));
        assert!(begin_reply(&state, "shown").unwrap() > epoch);
        assert!(cancel.load(Ordering::SeqCst));
        assert!(lock(&state.playback).unwrap().is_none());
        let db = lock(&state.db).unwrap();
        let session = store::active_conversation(&db).unwrap().unwrap();
        assert_eq!(session.participants, vec![id]);
        let view = store::conversation_view(&db, &session.id).unwrap();
        assert_eq!(view.messages[0].content, "  원문\n그대로  ");
        assert_eq!(view.timeline_events[0].source.as_deref(), Some("automatic"));
        assert_eq!(view.timeline_events[0].message_id.as_deref(), Some("shown"));
        assert_eq!(view.timeline_events[0].created_at, at);
        assert_eq!(lock(&state.panel).unwrap().as_ref().unwrap().mode, "input");
    }

    #[test]
    fn resume_restores_unanswered_input_after_close_and_database_reopen() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("resume.sqlite");
        let state = super::super::tests::state();
        *lock(&state.db).unwrap() = store::open(&path).unwrap();
        let at = chrono::Utc::now().timestamp_millis();
        let session = {
            let db = lock(&state.db).unwrap();
            store::set_user_name(&db, "합성 복원 검사", at).unwrap();
            let session =
                store::create_conversation(&db, &["builtin-a".into()], None, None, at).unwrap();
            crate::wordbook::save(
                &db,
                &WordbookEntry {
                    id: uuid::Uuid::new_v4().to_string(),
                    title: "합성 고정 대사".into(),
                    keywords: vec!["lighthouse".into()],
                    lines: vec![SceneLine {
                        persona: "a".into(),
                        text: "  원문\n보존  ".into(),
                        expression: "평온".into(),
                        motion: Default::default(),
                    }],
                    enabled: true,
                    use_for_idle: false,
                    group: None,
                },
            )
            .unwrap();
            db.execute(
                "INSERT INTO memories(id,content,source,updated,deleted,locked) VALUES('synthetic-memory','합성 기억','manual',1,0,0)",
                [],
            )
            .unwrap();
            store::save_settings(
                &db,
                &Settings {
                    mode: "api".into(),
                    base_url: "http://127.0.0.1:11434/v1".into(),
                    api_model: "synthetic-no-network".into(),
                    ..Settings::default()
                },
            )
            .unwrap();
            store::insert_user_input(
                &db,
                &Message {
                    id: "failed-ai".into(),
                    role: "user".into(),
                    persona: Some("builtin-a".into()),
                    content: "lighthouse failed".into(),
                    expression: None,
                    created_at: at,
                    status: "complete".into(),
                },
                true,
            )
            .unwrap();
            store::save_conversation_draft(&db, &session.id, "새로 작성한 초안\n보존").unwrap();
            store::pause_conversations(&db).unwrap();
            session
        };
        let original = preserved_data(&lock(&state.db).unwrap());
        let mut recovery_found = Vec::new();
        for reopen in [false, true] {
            if reopen {
                *lock(&state.db).unwrap() = store::open(std::path::Path::new(":memory:")).unwrap();
                *lock(&state.db).unwrap() = store::open(&path).unwrap();
            }
            let (_, recovery) = begin_resume(&state, &session.id).unwrap();
            recovery_found.push(recovery.is_some());
            assert!(lock(&state.tasks).unwrap().active.is_none());
            assert!(lock(&state.playback).unwrap().is_none());
            let db = lock(&state.db).unwrap();
            assert!(store::input_ai_only(&db, "failed-ai").unwrap());
            assert_eq!(preserved_data(&db), original);
            let targets = vec!["builtin-a".into()];
            assert!(super::super::conversation::route_input(
                &state,
                &db,
                "lighthouse failed",
                &targets,
                "failed-ai"
            )
            .unwrap()
            .is_none());
            assert_eq!(
                super::super::conversation::route_message(
                    &state,
                    &db,
                    "lighthouse failed",
                    &targets
                )
                .unwrap()
                .unwrap()[0]
                    .text,
                "  원문\n보존  "
            );
            assert_eq!(
                db.query_row("PRAGMA integrity_check", [], |row| row.get::<_, String>(0))
                    .unwrap(),
                "ok"
            );
            assert_eq!(
                db.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap(),
                0
            );
            assert_eq!(
                store::conversation(&db, &session.id).unwrap().draft,
                "새로 작성한 초안\n보존"
            );
            assert_eq!(
                store::conversation_messages(&db, &session.id, None)
                    .unwrap()
                    .messages
                    .len(),
                1
            );
            store::pause_conversations(&db).unwrap();
        }
        assert_eq!(
            recovery_found,
            vec![true, true],
            "retry notice lost after close/reopen or restart"
        );
    }

    fn preserved_data(db: &rusqlite::Connection) -> Vec<Vec<Vec<String>>> {
        [
            "sqlite_master",
            "messages",
            "message_context",
            "message_users",
            "message_targets",
            "message_characters",
            "message_presentations",
            "message_playback",
            "direct_reply_scenes",
            "ai_only_inputs",
            "wordbook",
            "memories",
            "character_affinity",
        ]
        .into_iter()
        .map(|table| {
            let mut statement = db
                .prepare(&format!("SELECT * FROM {table} ORDER BY rowid"))
                .unwrap();
            let columns = statement.column_count();
            statement
                .query_map([], |row| {
                    (0..columns)
                        .map(|index| {
                            row.get::<_, rusqlite::types::Value>(index)
                                .map(|value| format!("{value:?}"))
                        })
                        .collect::<rusqlite::Result<Vec<_>>>()
                })
                .unwrap()
                .collect::<rusqlite::Result<Vec<_>>>()
                .unwrap()
        })
        .collect()
    }

    #[test]
    fn resume_does_not_recover_ended_or_other_conversations_and_rejects_changed_owners() {
        let state = super::super::tests::state();
        let session = {
            let db = lock(&state.db).unwrap();
            store::set_user_name(&db, "합성 사용자", 1).unwrap();
            let session =
                store::create_conversation(&db, &["builtin-a".into()], None, None, 1).unwrap();
            store::insert_user_input(
                &db,
                &Message {
                    id: "unfinished".into(),
                    role: "user".into(),
                    persona: Some("builtin-a".into()),
                    content: "합성 질문".into(),
                    expression: None,
                    created_at: 1,
                    status: "complete".into(),
                },
                false,
            )
            .unwrap();
            session
        };
        let old_token = interrupt(&state, false).unwrap();
        let (epoch, recovery) = begin_resume(&state, &session.id).unwrap();
        assert!(recovery.is_some());
        assert!(epoch > old_token.0);
        assert!(old_token.1.load(Ordering::SeqCst));
        assert!(!super::super::set_phase_if_current(
            &state,
            old_token.0,
            RuntimePhase::Idle,
            None,
            None
        )
        .unwrap());
        super::super::set_phase_if_current(&state, epoch, RuntimePhase::Error, None, recovery)
            .unwrap();
        assert_eq!(lock(&state.runtime).unwrap().phase, RuntimePhase::Error);
        let empty = {
            let db = lock(&state.db).unwrap();
            store::create_conversation(&db, &["builtin-b".into()], None, None, 2).unwrap()
        };
        assert!(begin_resume(&state, &empty.id).unwrap().1.is_none());
        {
            let db = lock(&state.db).unwrap();
            store::set_conversation_status(&db, &session.id, "ended", 3).unwrap();
        }
        assert!(begin_resume(&state, &session.id).unwrap().1.is_none());
        {
            let db = lock(&state.db).unwrap();
            let continued = store::active_conversation(&db).unwrap().unwrap();
            assert_ne!(continued.id, session.id);
            assert_eq!(
                continued.continued_from.as_deref(),
                Some(session.id.as_str())
            );
            store::set_user_name(&db, "바뀐 합성 사용자", 4).unwrap();
        }
        assert!(begin_resume(&state, &session.id).is_err());
    }

    #[test]
    fn resume_keeps_user_cancellation_separate_from_runtime_errors_without_starting_a_request() {
        let state = super::super::tests::state();
        let session = {
            let db = lock(&state.db).unwrap();
            let session =
                store::create_conversation(&db, &["builtin-a".into()], None, None, 1).unwrap();
            store::insert_user_input(
                &db,
                &Message {
                    id: "cancelled-input".into(),
                    role: "user".into(),
                    persona: Some("a".into()),
                    content: "멈춘 입력".into(),
                    expression: None,
                    created_at: 1,
                    status: "complete".into(),
                },
                true,
            )
            .unwrap();
            store::save_conversation_draft(&db, &session.id, "새 초안").unwrap();
            store::cancel_conversation_reply(&db, &session.id, "cancelled-input").unwrap();
            store::pause_conversations(&db).unwrap();
            session
        };
        let (_, error) = begin_resume(&state, &session.id).unwrap();
        assert!(error.is_none());
        assert!(super::super::tasks::active_request(&state)
            .unwrap()
            .is_none());
        let db = lock(&state.db).unwrap();
        let view = store::conversation_view(&db, &session.id).unwrap();
        assert_eq!(
            view.recovery.unwrap().reason,
            store::RecoveryReason::Cancelled
        );
        assert_eq!(view.session.draft, "새 초안");
        assert_eq!(view.messages.len(), 1);
        assert!(store::input_ai_only(&db, "cancelled-input").unwrap());
    }

    #[test]
    fn focus_rejects_resume_without_mutating_pending_input_or_session() {
        let state = super::super::tests::state();
        let directory = tempfile::tempdir().unwrap();
        let at = chrono::Utc::now().timestamp_millis();
        let session = {
            let db = lock(&state.db).unwrap();
            store::set_user_name(&db, "합성 사용자", at).unwrap();
            let session =
                store::create_conversation(&db, &["builtin-a".into()], None, None, at).unwrap();
            store::insert_user_input(
                &db,
                &Message {
                    id: "unfinished-ai".into(),
                    role: "user".into(),
                    persona: Some("builtin-a".into()),
                    content: "  미완료 질문\n보존  ".into(),
                    expression: None,
                    created_at: at,
                    status: "complete".into(),
                },
                true,
            )
            .unwrap();
            store::save_conversation_draft(&db, &session.id, "다음 질문 초안").unwrap();
            store::pause_conversations(&db).unwrap();
            crate::widgets::storage::verify_packages(&db, directory.path())
                .unwrap();
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
                    input: serde_json::json!({"durationMs":60_000}),
                },
                at,
                1,
            )
            .unwrap();
            store::conversation(&db, &session.id).unwrap()
        };
        let (epoch, cancel) = interrupt(&state, false).unwrap();
        let original = preserved_data(&lock(&state.db).unwrap());
        assert_eq!(
            begin_resume(&state, &session.id).unwrap_err(),
            super::super::conversation::FOCUS_UNAVAILABLE,
        );
        assert_eq!(state.epoch.load(Ordering::SeqCst), epoch);
        assert!(!cancel.load(Ordering::SeqCst));
        assert!(lock(&state.panel).unwrap().is_none());
        let db = lock(&state.db).unwrap();
        assert_eq!(store::conversation(&db, &session.id).unwrap(), session);
        assert!(store::active_conversation(&db).unwrap().is_none());
        assert!(store::conversation_reply_pending(&db, &session.id).unwrap());
        assert_eq!(preserved_data(&db), original);
    }

    #[test]
    fn resume_rejects_removed_participant_without_switching_the_current_conversation() {
        let state = super::super::tests::state();
        let (old, current) = {
            let db = lock(&state.db).unwrap();
            store::set_user_name(&db, "합성 사용자", 1).unwrap();
            let old =
                store::create_conversation(&db, &["builtin-a".into()], None, None, 1).unwrap();
            let current =
                store::create_conversation(&db, &["builtin-b".into()], None, None, 2).unwrap();
            characters::apply_roster(&db, vec!["builtin-b".into()]).unwrap();
            (old, current)
        };
        let epoch = begin_resume(&state, &current.id).unwrap().0;
        let original = preserved_data(&lock(&state.db).unwrap());
        assert!(begin_resume(&state, &old.id)
            .unwrap_err()
            .contains("그때의 친구"));
        assert_eq!(state.epoch.load(Ordering::SeqCst), epoch);
        let db = lock(&state.db).unwrap();
        assert_eq!(
            store::active_conversation(&db).unwrap().unwrap().id,
            current.id
        );
        assert_eq!(preserved_data(&db), original);
    }
}
