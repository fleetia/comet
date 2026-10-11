use super::*;

fn input(db: &Connection, id: &str, role: &str, status: &str) {
    store::insert_message(
        db,
        &Message {
            id: id.into(),
            role: role.into(),
            persona: None,
            content: format!("{id} 원본 자료"),
            expression: None,
            created_at: 1,
            status: status.into(),
        },
    )
    .unwrap();
}

fn source_locators(db: &Connection, user: &str) -> Vec<String> {
    db.prepare(
        "SELECT locator FROM organizer_sources WHERE user_id=?1 AND active=1 ORDER BY locator",
    )
    .unwrap()
    .query_map([user], |row| row.get(0))
    .unwrap()
    .collect::<Result<_, _>>()
    .unwrap()
}

#[test]
fn activity_cancels_background_and_scans_but_preserves_direct_conversation() {
    let state = app::tests::state();
    let conversation = Arc::new(AtomicBool::new(false));
    let scan = Arc::new(AtomicBool::new(false));
    *lock(&state.cancellation).unwrap() = Some(conversation.clone());
    *lock(&state.organizer.scan_cancel).unwrap() = Some(scan.clone());
    touch(&state);
    assert!(!conversation.load(Ordering::SeqCst));
    assert!(scan.load(Ordering::SeqCst));
    assert!(state.organizer.activity.load(Ordering::SeqCst) > 0);

    state.automatic.store(true, Ordering::SeqCst);
    touch(&state);
    assert!(conversation.load(Ordering::SeqCst));
}

#[test]
fn comet_collection_without_opt_in_excludes_conversations_and_notes() {
    let db = store::open(std::path::Path::new(":memory:")).unwrap();
    let user = store::active_user_id(&db).unwrap();
    input(&db, "unshared-message", "user", "complete");
    crate::diary::update_in_transaction(
        &db,
        0,
        "note-create",
        &json!({"title":"비공개 메모", "body":"선택 전에는 수집하지 않는다"}),
    )
    .unwrap();
    collect_comet(&db, &user).unwrap();
    assert!(source_locators(&db, &user).is_empty());
    assert_eq!(records::status(&db, &user, &day()).unwrap().pending, 0);
}

#[test]
fn collection_uses_only_current_owned_user_inputs_without_creating_character_memories() {
    let db = store::open(std::path::Path::new(":memory:")).unwrap();
    store::set_user_name(&db, "이전 사용자", 1).unwrap();
    input(&db, "previous-user", "user", "complete");
    store::set_user_name(&db, "현재 사용자", 2).unwrap();
    let user = store::active_user_id(&db).unwrap();
    records::save_settings(
        &db,
        &user,
        &records::OrganizerSettings {
            comet_enabled: true,
            ..Default::default()
        },
    )
    .unwrap();
    input(&db, "current-user", "user", "complete");
    input(&db, "generated-character", "assistant", "complete");
    input(&db, "incomplete-user", "user", "pending");
    input(&db, "forgotten-user", "user", "complete");
    db.execute(
        "UPDATE message_context SET forgotten=1 WHERE message_id='forgotten-user'",
        [],
    )
    .unwrap();
    let before: i64 = db
        .query_row("SELECT COUNT(*) FROM memories", [], |row| row.get(0))
        .unwrap();

    collect_comet(&db, &user).unwrap();

    assert_eq!(source_locators(&db, &user), ["current-user"]);
    let after: i64 = db
        .query_row("SELECT COUNT(*) FROM memories", [], |row| row.get(0))
        .unwrap();
    assert_eq!(after, before);
    assert_eq!(store::messages(&db, 20).unwrap().len(), 5);
}

#[test]
fn withdrawing_comet_sources_deactivates_index_and_preserves_originals() {
    let db = store::open(std::path::Path::new(":memory:")).unwrap();
    let user = store::active_user_id(&db).unwrap();
    input(&db, "preserved-user", "user", "complete");
    let mut settings = records::OrganizerSettings {
        enabled: true,
        comet_enabled: true,
        ..Default::default()
    };
    records::save_settings(&db, &user, &settings).unwrap();
    collect_comet(&db, &user).unwrap();
    assert_eq!(source_locators(&db, &user), ["preserved-user"]);
    let original = serde_json::to_value(store::messages(&db, 20).unwrap()).unwrap();

    settings.comet_enabled = false;
    records::save_settings(&db, &user, &settings).unwrap();
    collect_comet(&db, &user).unwrap();

    assert!(source_locators(&db, &user).is_empty());
    assert!(records::search(&db, &user, "원본", 20).unwrap().is_empty());
    assert_eq!(
        serde_json::to_value(store::messages(&db, 20).unwrap()).unwrap(),
        original
    );
}

#[test]
fn direct_task_contract_uses_only_allowed_action_and_current_widget_revision() {
    for revision in [3, 19] {
        let instruction = direct_instruction(
            &["task_add"],
            &json!({"widgets":[{"id":"todo","kind":"todo","revision":revision,"lists":[]}]}),
        );
        for unrelated in [
            "note_create",
            "note_update",
            "task_complete",
            "event_add",
            "event_update",
        ] {
            assert!(!instruction.contains(unrelated));
        }
        let example: Step = serde_json::from_str(instruction.rsplit_once(": ").unwrap().1).unwrap();
        assert_eq!(example.kind, "act");
        assert!(example.answer.is_empty());
        let action: actions::Action = serde_json::from_str(&example.action_json).unwrap();
        assert_eq!(action.kind, "task_add");
        assert_eq!(action.expected_revision, revision);
        assert!(action.target_id.is_empty());
        assert!(action.input.get("dueAt").is_none());
    }
    let read_only = direct_instruction(&[], &json!({}));
    assert!(!read_only.contains("task_add"));
    assert!(!read_only.contains("expectedRevision"));
}

#[tokio::test]
async fn failed_explicit_change_is_saved_and_cannot_enter_character_inference() {
    let state = app::tests::state();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let (user, target) = {
        let db = lock(&state.db).unwrap();
        let user = store::active_user_id(&db).unwrap();
        let target = crate::characters::active_ids(&db).unwrap().remove(0);
        store::save_settings(
            &db,
            &Settings {
                mode: "api".into(),
                base_url: format!("http://{}/v1", listener.local_addr().unwrap()),
                api_model: "must-not-be-called".into(),
                ..Settings::default()
            },
        )
        .unwrap();
        store::insert_message(
            &db,
            &Message {
                id: "failed-mutation".into(),
                role: "user".into(),
                persona: Some(target.clone()),
                content: "할 일 추가해: 로컬 QA 검증".into(),
                expression: None,
                created_at: 1,
                status: "complete".into(),
            },
        )
        .unwrap();
        for outcome in [
            vec![json!({"error":"작업 제안을 검증하지 못했어요."}); 4],
            vec![json!({"answer":"추가했어요!"})],
        ] {
            let error = save_direct_outcome(&db, &user, "failed-mutation", &[], &outcome, true)
                .unwrap_err();
            assert!(error.starts_with("요청한 변경을 저장하지 못했어요."));
            let saved: Value = serde_json::from_str(
                &actions::turn_context(&db, &user, "failed-mutation")
                    .unwrap()
                    .unwrap(),
            )
            .unwrap();
            assert_eq!(saved["state"], "failed");
            assert_eq!(saved["appliedChanges"], json!([]));
            assert!(actions::replay_context(&db, &user, "failed-mutation").is_err());
        }
        (user, target)
    };
    let error = crate::app::conversation::generate_turn_with_memories(
        &state,
        &[target],
        "failed-mutation",
        Arc::new(AtomicBool::new(false)),
        &[],
    )
    .await
    .unwrap_err();
    assert!(
        error.starts_with("요청한 변경을 저장하지 못했어요."),
        "{error}"
    );
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(20), listener.accept())
            .await
            .is_err()
    );
    let db = lock(&state.db).unwrap();
    assert!(actions::receipts(&db, &user, Some("failed-mutation"))
        .unwrap()
        .is_empty());
    assert_eq!(store::messages(&db, 20).unwrap().len(), 1);
}

#[test]
fn summary_receipt_satisfies_explicit_change_even_without_direct_action_receipt() {
    let db = store::open(std::path::Path::new(":memory:")).unwrap();
    let user = store::active_user_id(&db).unwrap();
    let source = records::put_source(
        &db,
        &user,
        "comet",
        "",
        "note",
        "qa",
        "정리 원문",
        "확인한 원문",
        false,
    )
    .unwrap();
    let job = records::claim_source_job(
        &db,
        &user,
        &source.id,
        chrono::Utc::now().timestamp_millis(),
    )
    .unwrap()
    .unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    let record = records::save_summary(
        &db,
        &user,
        &job.id,
        &records::SummaryInput {
            title: "정리 기록".into(),
            summary: "확인한 원문".into(),
            ..Default::default()
        },
        &id,
    )
    .unwrap();
    actions::link_summary(&db, &user, "summary", &id).unwrap();
    save_direct_outcome(
        &db,
        &user,
        "summary",
        &[],
        &[json!({"savedSummary":record})],
        true,
    )
    .unwrap();
    let replay = actions::replay_context(&db, &user, "summary")
        .unwrap()
        .unwrap();
    assert_eq!(replay["context"]["state"], "done");
    assert_eq!(replay["receipts"][0]["kind"], "summary");
}
