use super::*;
use crate::types::{Message, SceneLine};

fn note(db: &Connection, body: &str) -> NoteReference {
    let revision = diary_value(db).unwrap()["revision"].as_u64().unwrap();
    diary::update_in_transaction(
        db,
        revision,
        "note-create",
        &json!({"title":"원고","body":body}),
    )
    .unwrap();
    list_notes(db).unwrap().last().unwrap().note_ref.clone()
}

fn connect(db: &Connection, reference: &NoteReference) -> store::ConversationSession {
    if store::current_user(db).unwrap().is_none() {
        store::set_user_name(db, "원래 사용자", 0).unwrap();
    }
    let session = store::create_conversation(db, &["builtin-a".into()], None, None, 1).unwrap();
    save_context(
        db,
        &session.id,
        Some(&NoteContext {
            note_ref: reference.clone(),
            linked_at: 2,
            checkpoint: None,
        }),
    )
    .unwrap();
    store::conversation(db, &session.id).unwrap()
}

fn input(db: &Connection, id: &str) -> Message {
    let message = Message {
        id: id.into(),
        role: "user".into(),
        persona: Some("builtin-a".into()),
        content: "영어 한 문장으로 이 메모의 미정 사항만 짚어 줘.".into(),
        expression: None,
        created_at: chrono::Utc::now().timestamp_millis(),
        status: "complete".into(),
    };
    store::insert_user_input(db, &message, true).unwrap();
    message
}

fn change(db: &Connection, reference: &NoteReference, action: &str, body: &str) {
    let revision = diary_value(db).unwrap()["revision"].as_u64().unwrap();
    diary::update_in_transaction(
        db,
        revision,
        action,
        &json!({"id":reference.id,"body":body}),
    )
    .unwrap();
}

#[test]
fn input_snapshots_preserve_originals_and_reject_changed_deleted_detached_or_foreign_sources() {
    let db = store::open(std::path::Path::new(":memory:")).unwrap();
    let reference = note(&db, "  받는 사람은 민수\n결말은 미정  ");
    let session = connect(&db, &reference);
    let user = input(&db, "input");
    let frozen = prompt_context(&db, &user.id).unwrap().unwrap();
    assert_eq!(
        frozen["source"]["body"],
        "  받는 사람은 민수\n결말은 미정  "
    );
    note(&db, "상관없는 메모");
    assert_eq!(prompt_context(&db, &user.id).unwrap().unwrap(), frozen);
    change(&db, &reference, "note-update", "사진을 받는 사람은 지수");
    assert!(prompt_context(&db, &user.id).is_err());
    assert_eq!(
        input_note(&db, &user.id)
            .unwrap()
            .unwrap()
            .source
            .unwrap()
            .body,
        frozen["source"]["body"]
    );
    let next = input(&db, "new-input");
    assert_eq!(
        prompt_context(&db, &next.id).unwrap().unwrap()["source"]["body"],
        "사진을 받는 사람은 지수"
    );
    save_context(&db, &session.id, None).unwrap();
    assert!(prompt_context(&db, &next.id).is_err());
    save_context(&db, &session.id, session.note_context.as_ref()).unwrap();
    change(&db, &reference, "note-delete", "");
    assert!(prompt_context(&db, &next.id).is_err());
    assert!(
        !store::conversation_view(&db, &session.id)
            .unwrap()
            .note_context
            .unwrap()
            .available
    );
    assert_eq!(
        store::conversation_messages(&db, &session.id, None)
            .unwrap()
            .messages[0]
            .content,
        user.content
    );
    store::set_user_name(&db, "다른 사용자", 4).unwrap();
    assert!(prompt_context(&db, &user.id).is_err());
}

#[test]
fn source_and_checkpoint_survive_restart_and_ended_continuation_without_changing_drafts() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("notes.sqlite");
    let db = store::open(&path).unwrap();
    let reference = note(&db, "원본");
    let session = connect(&db, &reference);
    let mut context = session.note_context.clone().unwrap();
    context.checkpoint = Some(Checkpoint {
        text: "다음에는 03D 확인".into(),
        saved_at: 3,
    });
    save_context(&db, &session.id, Some(&context)).unwrap();
    input(&db, "input");
    store::save_conversation_draft(&db, &session.id, "  미저장처럼 보이는 저장 초안\n ").unwrap();
    drop(db);
    let db = store::open(&path).unwrap();
    let reopened = store::conversation(&db, &session.id).unwrap();
    assert_eq!(reopened.status, "paused");
    assert_eq!(reopened.note_context, Some(context.clone()));
    assert_eq!(reopened.draft, "  미저장처럼 보이는 저장 초안\n ");
    assert!(prompt_context(&db, "input").unwrap().is_some());
    store::set_conversation_status(&db, &session.id, "ended", 4).unwrap();
    let child =
        store::create_conversation(&db, &session.participants, None, Some(&session.id), 5).unwrap();
    assert_eq!(child.note_context, Some(context));
    assert_eq!(
        store::conversation(&db, &session.id).unwrap().draft,
        reopened.draft
    );
}

#[test]
fn confirmed_note_saves_append_exact_text_once_and_checkpoint_is_opt_in() {
    let db = store::open(std::path::Path::new(":memory:")).unwrap();
    let reference = note(&db, "  원본\n ");
    let session = connect(&db, &reference);
    let user = input(&db, "input");
    let request_id = uuid::Uuid::new_v4().to_string();
    let request = SaveRequest {
        session_id: &session.id,
        message_id: &user.id,
        text: "  다음 행동\n원문 유지  ",
        note_id: Some(&reference.id),
        title: None,
        expected_body: Some("  원본\n "),
        checkpoint: false,
    };
    let saved = save_note(&db, &request_id, &request).unwrap();
    assert_eq!(save_note(&db, &request_id, &request).unwrap(), saved);
    let refreshed_body = read_note(&db, &reference).unwrap().body;
    let refreshed = SaveRequest {
        expected_body: Some(&refreshed_body),
        ..request
    };
    assert_eq!(save_note(&db, &request_id, &refreshed).unwrap(), saved);
    assert_eq!(
        read_note(&db, &reference).unwrap().body,
        "  원본\n \n\n  다음 행동\n원문 유지  "
    );
    assert!(store::conversation(&db, &session.id)
        .unwrap()
        .note_context
        .unwrap()
        .checkpoint
        .is_none());
    let before = diary_value(&db).unwrap();
    assert!(save_note(&db, &uuid::Uuid::new_v4().to_string(), &request).is_err());
    assert_eq!(diary_value(&db).unwrap(), before);
    let missing_expectation = SaveRequest {
        expected_body: None,
        ..request
    };
    assert!(save_note(&db, &uuid::Uuid::new_v4().to_string(), &missing_expectation).is_err());
    let changed_request = SaveRequest {
        text: "다른 내용",
        ..missing_expectation
    };
    assert!(save_note(&db, &request_id, &changed_request).is_err());
    store::set_conversation_status(&db, &session.id, "ended", 4).unwrap();
    let create = SaveRequest {
        note_id: None,
        expected_body: None,
        title: Some("재개 지점"),
        checkpoint: true,
        ..changed_request
    };
    let created = save_note(&db, &uuid::Uuid::new_v4().to_string(), &create).unwrap();
    let context = store::conversation(&db, &session.id)
        .unwrap()
        .note_context
        .unwrap();
    assert_eq!(context.note_ref, created);
    assert_eq!(context.checkpoint.unwrap().text, "다른 내용");
    assert_eq!(read_note(&db, &created).unwrap().body, "다른 내용");
}

#[test]
fn saving_requires_a_message_in_that_users_session_and_visible_assistant_evidence() {
    let db = store::open(std::path::Path::new(":memory:")).unwrap();
    let reference = note(&db, "원문");
    let session = connect(&db, &reference);
    input(&db, "input");
    let reply = Message {
        id: "reply:input:builtin-a".into(),
        role: "assistant".into(),
        persona: Some("builtin-a".into()),
        content: "생성 결과".into(),
        expression: Some("평온".into()),
        created_at: chrono::Utc::now().timestamp_millis(),
        status: "complete".into(),
    };
    store::insert_message_with_source(&db, &reply, "llm", None, true).unwrap();
    let request = SaveRequest {
        session_id: &session.id,
        message_id: &reply.id,
        text: "사용자가 고친 문장",
        note_id: None,
        title: None,
        expected_body: None,
        checkpoint: false,
    };
    let before = diary_value(&db).unwrap();
    assert!(save_note(&db, &uuid::Uuid::new_v4().to_string(), &request).is_err());
    assert_eq!(diary_value(&db).unwrap(), before);
    store::mark_message_displayed(&db, &reply.id, 3).unwrap();
    let request_id = uuid::Uuid::new_v4().to_string();
    save_note(&db, &request_id, &request).unwrap();
    store::set_user_name(&db, "새 사용자", 4).unwrap();
    assert!(save_note(&db, &request_id, &request).is_err());
    assert!(save_note(&db, &uuid::Uuid::new_v4().to_string(), &request).is_err());
}

#[test]
fn note_prompt_keeps_source_out_of_user_text_and_filters_revoked_source_replies() {
    let db = store::open(std::path::Path::new(":memory:")).unwrap();
    let reference = note(&db, "작품 속 나의 동기는 미정");
    let session = connect(&db, &reference);
    let user = input(&db, "input");
    let prompt =
        app::conversation::turn_prompt_with_memories(&db, &["builtin-a".into()], &user.id, &[])
            .unwrap();
    assert!(prompt
        .iter()
        .any(|message| message.role == "user" && message.content == user.content));
    assert!(prompt
        .iter()
        .any(|message| message.content.contains("selectedNote")
            && message.content.contains("작품 속 나의 동기는 미정")));
    let reply = Message {
        id: "reply:input:builtin-a".into(),
        role: "assistant".into(),
        persona: Some("builtin-a".into()),
        content: "앞선 메모로 만든 답변".into(),
        expression: Some("평온".into()),
        created_at: chrono::Utc::now().timestamp_millis(),
        status: "complete".into(),
    };
    store::insert_message_with_source(&db, &reply, "llm", None, true).unwrap();
    store::mark_message_displayed(&db, &reply.id, 3).unwrap();
    input(&db, "same-note");
    assert!(history_allowed(&db, "same-note", &reply).unwrap());
    save_context(&db, &session.id, None).unwrap();
    let unlinked = input(&db, "unlinked");
    assert!(!history_allowed(&db, &unlinked.id, &reply).unwrap());
    let prompt =
        app::conversation::turn_prompt_with_memories(&db, &["builtin-a".into()], &unlinked.id, &[])
            .unwrap();
    assert!(!prompt
        .iter()
        .any(|message| message.content.contains("앞선 메모로 만든 답변")
            || message.content.contains("작품 속 나의 동기는 미정")));
}

#[test]
fn source_changes_block_model_presentation_but_keyword_playback_still_works() {
    let state = app::tests::state();
    let reference = {
        let db = app::lock(&state.db).unwrap();
        let reference = note(&db, "원문");
        connect(&db, &reference);
        input(&db, "input");
        reference
    };
    let token = app::interrupt(&state, false).unwrap();
    let revision = store::revision(&app::lock(&state.db).unwrap()).unwrap();
    let line = SceneLine {
        persona: "builtin-a".into(),
        expression: "평온".into(),
        text: "생성 답변".into(),
        motion: Default::default(),
    };
    change(
        &app::lock(&state.db).unwrap(),
        &reference,
        "note-update",
        "바뀐 원문",
    );
    assert!(app::scene::present_line(
        &state,
        &line,
        "llm",
        "reply:input:builtin-a",
        0,
        1,
        revision,
        token.0,
        &token.1,
        true
    )
    .is_err());
    assert!(app::lock(&state.playback).unwrap().is_none());
    assert!(app::scene::present_line(
        &state,
        &line,
        "wordbook",
        "scene:input:0",
        0,
        1,
        revision,
        token.0,
        &token.1,
        true
    )
    .unwrap());
}

#[test]
fn desktop_note_references_keep_widget_identity_and_become_unavailable_on_removal() {
    let directory = tempfile::tempdir().unwrap();
    let db = store::open(&directory.path().join("memo.sqlite")).unwrap();
    crate::widgets::storage::install(&db, directory.path(), &["memo".into()]).unwrap();
    let widget = crate::widgets::storage::instances(&db)
        .unwrap()
        .into_iter()
        .find(|widget| widget.kind == "memo")
        .unwrap();
    crate::widgets::memo_notes::create_note(&db, &widget.id).unwrap();
    let reference = list_notes(&db)
        .unwrap()
        .into_iter()
        .find(|note| note.note_ref.kind == "memo")
        .unwrap()
        .note_ref;
    assert_eq!(reference.widget_id.as_deref(), Some(widget.id.as_str()));
    let session = connect(&db, &reference);
    input(&db, "memo-input");
    assert!(prompt_context(&db, "memo-input").unwrap().is_some());
    crate::widgets::storage::remove(&db, directory.path(), &widget.id, false).unwrap();
    assert!(prompt_context(&db, "memo-input").is_err());
    assert!(
        !store::conversation_view(&db, &session.id)
            .unwrap()
            .note_context
            .unwrap()
            .available
    );
    assert!(list_notes(&db).unwrap().is_empty());
}

#[tokio::test]
async fn source_changed_while_balloon_measurement_waits_never_gets_a_display_receipt() {
    let state = app::tests::state();
    let reference = {
        let db = app::lock(&state.db).unwrap();
        let reference = note(&db, "원문");
        connect(&db, &reference);
        input(&db, "measuring-input");
        reference
    };
    let token = app::interrupt(&state, false).unwrap();
    let revision = store::revision(&app::lock(&state.db).unwrap()).unwrap();
    let line = SceneLine {
        persona: "builtin-a".into(),
        expression: "평온".into(),
        text: "아직 표시하지 않은 답변".into(),
        motion: Default::default(),
    };
    let id = "reply:measuring-input:builtin-a";
    assert!(app::scene::present_line(
        &state, &line, "llm", id, 0, 1, revision, token.0, &token.1, true
    )
    .unwrap());
    change(
        &app::lock(&state.db).unwrap(),
        &reference,
        "note-delete",
        "",
    );
    assert!(app::snapshot(&state).unwrap().playback.is_none());
    assert!(
        app::scene::wait_for_displayed_line(&state, token.0, token.1)
            .await
            .is_err()
    );
    assert!(app::lock(&state.playback).unwrap().is_none());
    assert!(!store::message_displayed(&app::lock(&state.db).unwrap(), id).unwrap());
}

#[tokio::test]
async fn native_discarded_playback_preserves_its_error_in_the_waiting_worker() {
    let state = app::tests::state();
    let token = app::interrupt(&state, false).unwrap();
    let revision = store::revision(&app::lock(&state.db).unwrap()).unwrap();
    let line = SceneLine {
        persona: "builtin-a".into(),
        expression: "평온".into(),
        text: "표시를 기다리는 답변".into(),
        motion: Default::default(),
    };
    assert!(app::scene::present_line(
        &state,
        &line,
        "llm",
        "reply:native-discarded:builtin-a",
        0,
        1,
        revision,
        token.0,
        &token.1,
        true
    )
    .unwrap());
    let discard = async {
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        let _action = app::lock(&state.action).unwrap();
        let mut runtime = app::lock(&state.runtime).unwrap();
        *app::lock(&state.playback).unwrap() = None;
        runtime.phase = crate::types::RuntimePhase::Error;
        runtime.error = Some(CHANGED.into());
    };
    let (result, ()) = tokio::join!(
        app::scene::wait_for_displayed_line(&state, token.0, token.1.clone()),
        discard
    );
    assert_eq!(result.unwrap_err(), CHANGED);
    // The native receipt can also discard the line before the worker begins waiting.
    {
        let mut runtime = app::lock(&state.runtime).unwrap();
        runtime.phase = crate::types::RuntimePhase::Error;
        runtime.error = Some(CHANGED.into());
    }
    assert_eq!(
        app::scene::wait_for_displayed_line(&state, token.0, token.1)
            .await
            .unwrap_err(),
        CHANGED
    );
}
