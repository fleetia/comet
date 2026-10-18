use super::*;
use crate::types::Message;

fn note(db: &Connection, title: &str, body: &str) -> NoteReference {
    let revision = diary_value(db).unwrap()["revision"].as_u64().unwrap();
    diary::update_in_transaction(
        db,
        revision,
        "note-create",
        &json!({"title":title,"body":body}),
    )
    .unwrap();
    list_notes(db).unwrap().last().unwrap().note_ref.clone()
}

fn session(db: &Connection) -> store::ConversationSession {
    if store::current_user(db).unwrap().is_none() {
        store::set_user_name(db, "원래 사용자", 0).unwrap();
    }
    store::create_conversation(db, &["builtin-a".into()], None, None, 1).unwrap()
}

fn input(db: &Connection, id: &str, content: &str) -> Message {
    let message = Message {
        id: id.into(),
        role: "user".into(),
        persona: Some("builtin-a".into()),
        content: content.into(),
        expression: None,
        created_at: chrono::Utc::now().timestamp_millis(),
        status: "complete".into(),
    };
    store::insert_user_input(db, &message, true).unwrap();
    message
}

#[test]
fn related_notes_join_memory_context_by_shared_words_without_selection() {
    let db = store::open(std::path::Path::new(":memory:")).unwrap();
    session(&db);
    note(&db, "장보기", "우유, 달걀, 두부");
    note(&db, "책 모임", "질문 두 개 적기\n결말은 미정");
    input(&db, "unrelated", "오늘 날씨 어때?");
    assert!(note_memories(&db, "unrelated").unwrap().is_empty());
    input(&db, "related", "책 모임에서 뭐 물어볼까?");
    let memories = note_memories(&db, "related").unwrap();
    assert_eq!(memories.len(), 1);
    assert_eq!(memories[0].kind, "note");
    assert_eq!(memories[0].content, "책 모임\n질문 두 개 적기\n결말은 미정");
    assert_eq!(memories[0].user_name, "원래 사용자");
    assert!(memories[0].id.starts_with("note:diary:"));
}

#[test]
fn related_notes_prefer_title_matches_limit_count_and_clip_long_bodies() {
    let db = store::open(std::path::Path::new(":memory:")).unwrap();
    session(&db);
    note(&db, "기타", "여행 이야기 조금");
    note(&db, "여행 준비", &"짐".repeat(NOTE_MEMORY_CHARS + 50));
    note(&db, "다른 메모", "여행 사진 정리");
    input(&db, "input", "여행 가기 전에 뭐 챙기지?");
    let memories = note_memories(&db, "input").unwrap();
    assert_eq!(memories.len(), NOTE_MEMORY_LIMIT);
    assert!(memories[0].content.starts_with("여행 준비\n"));
    assert!(memories[0].content.ends_with('…'));
    assert_eq!(
        memories[0].content.chars().count(),
        "여행 준비\n".chars().count() + NOTE_MEMORY_CHARS + 1
    );
}

#[test]
fn turn_prompts_carry_related_notes_inside_the_memory_context() {
    let state = app::tests::state();
    let db = app::lock(&state.db).unwrap();
    session(&db);
    note(&db, "책 모임", "질문 두 개 적기");
    let user = input(&db, "input", "책 모임 준비 도와줘");
    let prompt =
        app::conversation::turn_prompt_for_state(&state, &db, &["builtin-a".into()], &user.id, &[])
            .unwrap();
    let data = prompt
        .iter()
        .find(|message| message.content.contains("\"memories\""))
        .expect("memory context");
    assert!(data.content.contains("질문 두 개 적기"));
    assert!(data.content.contains("\"kind\":\"note\""));
    assert!(!prompt
        .iter()
        .any(|message| message.content.contains("selectedNote")));
}

#[test]
fn note_saves_append_exact_text_once_and_reject_changed_sources() {
    let db = store::open(std::path::Path::new(":memory:")).unwrap();
    let reference = note(&db, "원고", "  원본\n ");
    let session = session(&db);
    let user = input(&db, "input", "남겨 줘");
    let request_id = uuid::Uuid::new_v4().to_string();
    let request = SaveRequest {
        session_id: &session.id,
        message_id: &user.id,
        text: "  다음 행동\n원문 유지  ",
        note_id: Some(&reference.id),
        title: None,
        expected_body: Some("  원본\n "),
    };
    let saved = save_note(&db, &request_id, &request).unwrap();
    assert_eq!(save_note(&db, &request_id, &request).unwrap(), saved);
    assert_eq!(
        read_note(&db, &reference).unwrap().body,
        "  원본\n \n\n  다음 행동\n원문 유지  "
    );
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
    let create = SaveRequest {
        note_id: None,
        title: Some("새 메모"),
        ..changed_request
    };
    let created = save_note(&db, &uuid::Uuid::new_v4().to_string(), &create).unwrap();
    assert_eq!(read_note(&db, &created).unwrap().body, "다른 내용");
}

#[test]
fn saving_requires_a_message_in_that_users_session_and_visible_assistant_evidence() {
    let db = store::open(std::path::Path::new(":memory:")).unwrap();
    let session = session(&db);
    input(&db, "input", "안녕");
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
fn desktop_memo_notes_are_found_and_disappear_with_their_widget() {
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
    crate::widgets::storage::remove(&db, directory.path(), &widget.id, false).unwrap();
    assert!(list_notes(&db).unwrap().is_empty());
}
