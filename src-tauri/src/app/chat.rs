use super::{interrupt, lock, now, phase, schedule_idle, unavailable, AppState};
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
    let db = lock(&state.db)?;
    super::conversation::ensure_available(&db)?;
    let line = lock(&state.playback)?
        .as_ref()
        .filter(|line| line.id == playback_id && line.display_started_at.is_some())
        .cloned()
        .ok_or("이 말풍선은 이미 지나갔어요. 지난 대화에서 확인해 주세요.")?;
    let registered = store::current_user(&db)?.is_some();
    if registered {
        store::create_conversation(
            &db,
            std::slice::from_ref(&line.persona),
            Some(&line.id),
            None,
            chrono::Utc::now().timestamp_millis(),
        )?;
    }
    let epoch = interrupt(state, false)?.0;
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
) -> Result<(), String> {
    let (epoch, recovery) = begin_resume(&state, &session_id)?;
    crate::desktop::request_balloon_focus(&app)?;
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
    Ok(())
}

fn begin_resume(state: &AppState, session_id: &str) -> Result<(u64, Option<String>), String> {
    let _action = lock(&state.action)?;
    if unavailable(state) {
        return Err("앱을 종료하고 있어요.".into());
    }
    let db = lock(&state.db)?;
    super::conversation::ensure_available(&db)?;
    let session = store::conversation(&db, session_id)?;
    let active = characters::active_ids(&db)?;
    if session.participants.iter().any(|id| !active.contains(id)) {
        return Err("그때의 친구들을 다시 함께 지내기로 선택하면 이어갈 수 있어요.".into());
    }
    let recovery = store::conversation_reply_pending(&db, &session.id)?
        .then(|| "마지막 답변을 마치지 못했어요. 다시 이야기하기로 이어갈 수 있어요.".to_string());
    let at = chrono::Utc::now().timestamp_millis();
    if session.status == "ended" {
        store::create_conversation(&db, &session.participants, None, Some(&session.id), at)?;
    } else {
        store::set_conversation_status(&db, &session.id, "active", at)?;
    }
    let epoch = interrupt(state, false)?.0;
    *lock(&state.panel)? = Some(PanelState {
        persona: session
            .participants
            .first()
            .cloned()
            .ok_or("대화 상대가 없어요.")?,
        mode: "input".into(),
    });
    state.last_input.store(now(), Ordering::SeqCst);
    Ok((epoch, recovery))
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
        let epoch = interrupt(&state, false)?.0;
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
) -> Result<(), String> {
    let _action = lock(&state.action)?;
    store::save_conversation_draft(&*lock(&state.db)?, &session_id, &draft)
}

#[tauri::command]
pub(crate) fn get_conversations(
    state: tauri::State<'_, Arc<AppState>>,
    persona: String,
) -> Result<Vec<store::ConversationSession>, String> {
    let db = lock(&state.db)?;
    let character = characters::active_character(&db, &persona)?;
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
        lock(&state.playback)
            .unwrap()
            .as_mut()
            .unwrap()
            .display_started_at = Some(at);
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
            crate::widgets::storage::install(&db, directory.path(), &["focus-timer".into()])
                .unwrap();
            let timer = crate::widgets::storage::instances(&db).unwrap().remove(0);
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
