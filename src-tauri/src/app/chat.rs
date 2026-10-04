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
    let line = lock(&state.playback)?
        .as_ref()
        .filter(|line| line.id == playback_id && line.display_started_at.is_some())
        .cloned()
        .ok_or("이 말풍선은 이미 지나갔어요. 지난 대화에서 확인해 주세요.")?;
    let db = lock(&state.db)?;
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
    let epoch = {
        let _action = lock(&state.action)?;
        if unavailable(&state) {
            return Err("앱을 종료하고 있어요.".into());
        }
        let db = lock(&state.db)?;
        let session = store::conversation(&db, &session_id)?;
        let active = characters::active_ids(&db)?;
        if session.participants.iter().any(|id| !active.contains(id)) {
            return Err("그때의 친구들을 다시 함께 지내기로 선택하면 이어갈 수 있어요.".into());
        }
        let at = chrono::Utc::now().timestamp_millis();
        if session.status == "ended" {
            store::create_conversation(&db, &session.participants, None, Some(&session.id), at)?;
        } else {
            store::set_conversation_status(&db, &session.id, "active", at)?;
        }
        let epoch = interrupt(&state, false)?.0;
        *lock(&state.panel)? = Some(PanelState {
            persona: session
                .participants
                .first()
                .cloned()
                .ok_or("대화 상대가 없어요.")?,
            mode: "input".into(),
        });
        state.last_input.store(now(), Ordering::SeqCst);
        epoch
    };
    crate::desktop::request_balloon_focus(&app)?;
    phase(&app, &state, epoch, RuntimePhase::Idle, None, None);
    Ok(())
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
    use crate::types::{Message, Playback};

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
}
