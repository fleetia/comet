use super::messages::GENERATED_RECALL_MILLIS;
use super::*;
use serde_json::json;
use serde_json::Value;
fn message(id: &str, role: &str, text: &str) -> Message {
    Message {
        id: id.into(),
        role: role.into(),
        persona: Some("a".into()),
        content: text.into(),
        expression: None,
        created_at: 1_800_000_000_000,
        status: "complete".into(),
    }
}
fn fact(id: &str, text: &str) -> Value {
    json!({"kind":"user_fact","certain":true,"sourceMessageId":id,"evidence":text,"supersedesId":""})
}
fn apply(conn: &Connection, facts: Vec<Value>, events: Vec<Value>) {
    analyze_apply(
        conn,
        &json!({"revision":revision(conn).unwrap(),"memories":facts,"events":events}),
    )
    .unwrap();
}
#[test]
fn generated_recall_expires_without_changing_authored_history_or_user_memory() {
    let conn = open(Path::new(":memory:")).unwrap();
    let user = message("user", "user", "나는 차를 좋아해");
    insert_message(&conn, &user).unwrap();
    apply(&conn, vec![fact("user", &user.content)], vec![]);
    for source in ["llm", "wordbook", "script", "talk", "widget"] {
        insert_message_with_source(
            &conn,
            &message(source, "assistant", "  어릴 때 바다에 갔어.\n  "),
            source,
            None,
            false,
        )
        .unwrap();
    }
    let transcript = messages(&conn, 100).unwrap();
    let memory = memories(&conn).unwrap();
    let identities = message_identities(&conn, 100).unwrap();
    let relationships = relationships(&conn).unwrap();
    let before = revision(&conn).unwrap();
    add_scene(
        &conn,
        &PreparedScene {
            id: "prepared".into(),
            revision: before,
            lines: vec![],
        },
    )
    .unwrap();
    let expires_at = user.created_at + GENERATED_RECALL_MILLIS;
    assert!(!expire_generated_recall(&conn, expires_at - 1).unwrap());
    assert_eq!(context_messages(&conn, 100).unwrap().len(), 6);
    assert!(expire_generated_recall(&conn, expires_at).unwrap());
    assert_eq!(revision(&conn).unwrap(), before + 1);
    assert!(prepared_scenes(&conn).unwrap().is_empty());
    assert_eq!(
        context_messages(&conn, 100)
            .unwrap()
            .iter()
            .map(|m| m.id.as_str())
            .collect::<Vec<_>>(),
        ["user", "wordbook", "script", "talk", "widget"]
    );
    assert!(!expire_generated_recall(&conn, expires_at + 1).unwrap());
    assert_eq!(revision(&conn).unwrap(), before + 1);
    assert_eq!(
        serde_json::to_value(messages(&conn, 100).unwrap()).unwrap(),
        serde_json::to_value(transcript).unwrap()
    );
    assert_eq!(
        serde_json::to_value(memories(&conn).unwrap()).unwrap(),
        serde_json::to_value(memory).unwrap()
    );
    assert_eq!(message_identities(&conn, 100).unwrap(), identities);
    assert_eq!(
        serde_json::to_value(super::relationships(&conn).unwrap()).unwrap(),
        serde_json::to_value(relationships).unwrap()
    );
}

#[test]
fn direct_conversation_extends_recall_but_automatic_chatter_does_not() {
    let conn = open(Path::new(":memory:")).unwrap();
    let mut generated = message("first", "assistant", "어릴 때 바다에 갔어");
    let start = generated.created_at;
    insert_message_with_source(&conn, &generated, "llm", None, false).unwrap();
    let mut user = message("followup", "user", "그다음에는?");
    user.created_at = start + GENERATED_RECALL_MILLIS - 1;
    insert_message(&conn, &user).unwrap();
    let mut reply = message("direct-reply", "assistant", "계속 이야기할게");
    reply.created_at = user.created_at + 60_000;
    insert_message_with_source(&conn, &reply, "llm", None, true).unwrap();
    let expires_at = reply.created_at + GENERATED_RECALL_MILLIS;
    generated.id = "automatic".into();
    generated.created_at = expires_at - 1;
    insert_message_with_source(&conn, &generated, "llm", None, false).unwrap();
    assert!(!expire_generated_recall(&conn, expires_at - 1).unwrap());
    assert!(expire_generated_recall(&conn, expires_at).unwrap());
    assert_eq!(
        context_messages(&conn, 100)
            .unwrap()
            .iter()
            .map(|m| m.id.as_str())
            .collect::<Vec<_>>(),
        ["followup", "automatic"]
    );
    let mut next = message("next", "user", "안녕");
    next.created_at = expires_at + GENERATED_RECALL_MILLIS;
    insert_message(&conn, &next).unwrap();
    assert!(context_messages(&conn, 100)
        .unwrap()
        .iter()
        .all(|m| m.role == "user"));
    resume_conversation(&conn, start).unwrap();
    assert!(context_messages(&conn, 100)
        .unwrap()
        .iter()
        .all(|m| m.role == "user"));
    assert_eq!(messages(&conn, 100).unwrap().len(), 5);
}

#[test]
fn recall_metadata_and_expiration_roll_back_with_failed_storage() {
    let conn = open(Path::new(":memory:")).unwrap();
    let mut original = message("generated", "assistant", "임시 대사");
    insert_message_with_source(&conn, &original, "llm", None, false).unwrap();
    let expires_at = original.created_at + GENERATED_RECALL_MILLIS;
    let before = revision(&conn).unwrap();
    conn.execute_batch("CREATE TRIGGER fail_revision BEFORE UPDATE ON kv WHEN OLD.key='revision' BEGIN SELECT RAISE(ABORT,'storage failure'); END;").unwrap();
    let mut user = message("new-user", "user", "새 대화");
    user.created_at = expires_at;
    assert!(insert_message(&conn, &user).is_err());
    assert!(expire_generated_recall(&conn, expires_at).is_err());
    assert_eq!(messages(&conn, 100).unwrap().len(), 1);
    assert_eq!(context_messages(&conn, 100).unwrap().len(), 1);
    assert_eq!(revision(&conn).unwrap(), before);
    conn.execute_batch("DROP TRIGGER fail_revision").unwrap();
    original.created_at = expires_at + 1;
    original.content = "중복으로 바뀐 원문".into();
    insert_message_with_source(&conn, &original, "script", None, true).unwrap();
    assert!(expire_generated_recall(&conn, expires_at).unwrap());
    assert!(context_messages(&conn, 100).unwrap().is_empty());
    assert_eq!(messages(&conn, 100).unwrap()[0].content, "임시 대사");
    let source: String = conn
        .query_row(
            "SELECT source FROM message_context WHERE message_id='generated'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(source, "llm");
}

#[test]
fn legacy_unknown_recall_migrates_once_and_stays_forgotten_after_reopen() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("legacy-recall.sqlite");
    let legacy = Connection::open(&path).unwrap();
    legacy.execute_batch("CREATE TABLE messages(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,role TEXT NOT NULL,data TEXT NOT NULL);").unwrap();
    let old = message("old", "assistant", "  예전 이야기\n  ");
    let raw = serde_json::to_string_pretty(&old).unwrap();
    legacy
        .execute(
            "INSERT INTO messages(id,role,data) VALUES('old','assistant',?1)",
            [&raw],
        )
        .unwrap();
    drop(legacy);
    let conn = open(&path).unwrap();
    assert_eq!(context_messages_for(&conn, 100, "a").unwrap().len(), 1);
    assert!(expire_generated_recall(&conn, old.created_at + GENERATED_RECALL_MILLIS).unwrap());
    drop(conn);
    let conn = open(&path).unwrap();
    resume_conversation(&conn, old.created_at).unwrap();
    assert!(context_messages_for(&conn, 100, "a").unwrap().is_empty());
    let preserved: String = conn
        .query_row("SELECT data FROM messages WHERE id='old'", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(preserved, raw);
    let source: String = conn
        .query_row(
            "SELECT source FROM message_context WHERE message_id='old'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(source, "unknown");
    assert_eq!(messages(&conn, 100).unwrap()[0].content, old.content);
}
#[test]
fn swaps_restore_relationships_and_late_analysis_uses_original_target() {
    let conn = open(Path::new(":memory:")).unwrap();
    let mut thanks = message("thanks", "user", "고마워");
    thanks.persona = Some("both".into());
    insert_message(&conn, &thanks).unwrap();
    insert_message(&conn, &message("old-reply", "assistant", "반가워")).unwrap();
    insert_message(&conn, &message("fact", "user", "나는 차를 좋아해")).unwrap();
    apply(&conn, vec![fact("fact", "나는 차를 좋아해")], vec![]);
    let created = crate::characters::clone_character(&conn, "builtin-a").unwrap();
    crate::characters::assign(&conn, "a", &created.id).unwrap();
    apply(
        &conn,
        vec![],
        vec![
            json!({"sourceMessageId":"thanks","evidence":"고마워","kind":"thanks","certain":true,"persona":"a"}),
            json!({"sourceMessageId":"thanks","evidence":"고마워","kind":"thanks","certain":true,"persona":"b"}),
        ],
    );
    assert_eq!(relationships(&conn).unwrap()[0].score, 20);
    assert_eq!(relationships(&conn).unwrap()[1].score, 21);
    assert!(context_messages_for(&conn, 100, "a").unwrap().is_empty());
    assert_eq!(
        context_messages_for(&conn, 100, "b").unwrap()[0].id,
        "thanks"
    );
    assert_eq!(memories(&conn).unwrap()[0].content, "나는 차를 좋아해");
    assert_eq!(messages(&conn, 100).unwrap().len(), 3);
    crate::characters::assign(&conn, "a", "builtin-a").unwrap();
    assert_eq!(relationships(&conn).unwrap()[0].score, 21);
    assert_eq!(context_messages_for(&conn, 100, "a").unwrap().len(), 3);
    apply(
        &conn,
        vec![],
        vec![
            json!({"sourceMessageId":"thanks","evidence":"고마워","kind":"thanks","certain":true,"persona":"a"}),
        ],
    );
    assert_eq!(relationships(&conn).unwrap()[0].score, 21);
}
#[test]
fn historical_identity_survives_rename_reinsert_and_slot_move() {
    let conn = open(Path::new(":memory:")).unwrap();
    let original = message("reply", "assistant", "안녕!");
    insert_message(&conn, &original).unwrap();
    let old = message_identities(&conn, 1).unwrap();
    let mut renamed = crate::characters::active_character(&conn, "a")
        .unwrap()
        .definition;
    let original_name = renamed.name.clone();
    renamed.name = "새 이름".into();
    crate::characters::save(&conn, "builtin-a", &renamed).unwrap();
    insert_message(&conn, &original).unwrap();
    assert_eq!(message_identities(&conn, 1).unwrap(), old);
    assert_eq!(old[0].name, original_name);
    insert_message(&conn, &message("new-reply", "assistant", "다시 안녕!")).unwrap();
    let latest = message_identities(&conn, 1).unwrap();
    assert_eq!(latest[0].name, "새 이름");
    assert!(latest[0].version > old[0].version);
    crate::characters::apply_pair(&conn, ["builtin-b".into(), "builtin-a".into()]).unwrap();
    let context = context_messages_for(&conn, 10, "b").unwrap();
    assert_eq!(context.len(), 2);
    assert!(context.iter().all(|m| m.persona.as_deref() == Some("b")));
    assert_eq!(
        messages(&conn, 10).unwrap()[0].persona.as_deref(),
        Some("a")
    );
    assert_eq!(message_identities(&conn, 10).unwrap()[0], old[0]);
}
#[test]
fn legacy_migration_preserves_raw_history_and_affinity_once() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("legacy.sqlite");
    let legacy = Connection::open(&path).unwrap();
    legacy.execute_batch("CREATE TABLE messages(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,role TEXT NOT NULL,data TEXT NOT NULL);
CREATE TABLE affinity(source TEXT NOT NULL,persona TEXT NOT NULL,day TEXT NOT NULL,delta INTEGER NOT NULL,fingerprint TEXT NOT NULL,PRIMARY KEY(source,persona));").unwrap();
    let mut user = message("original", "user", "고마워");
    user.persona = Some("both".into());
    let raw = serde_json::to_string_pretty(&user).unwrap();
    legacy
        .execute(
            "INSERT INTO messages(id,role,data) VALUES('original','user',?)",
            [&raw],
        )
        .unwrap();
    legacy
        .execute(
            "INSERT INTO affinity VALUES('original','a','2026-09-15',1,'thanks')",
            [],
        )
        .unwrap();
    drop(legacy);
    for _ in 0..2 {
        let conn = open(&path).unwrap();
        let restored: String = conn
            .query_row("SELECT data FROM messages WHERE id='original'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(restored, raw);
        assert_eq!(
            message_identities(&conn, 1)
                .unwrap()
                .iter()
                .map(|i| i.character_id.as_str())
                .collect::<Vec<_>>(),
            vec!["builtin-a", "builtin-b"]
        );
        assert_eq!(relationships(&conn).unwrap()[0].score, 21);
        assert_eq!(relationships(&conn).unwrap()[1].score, 20);
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM affinity", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
        let copied: i64 = conn
            .query_row("SELECT COUNT(*) FROM character_affinity", [], |r| r.get(0))
            .unwrap();
        assert_eq!(copied, 1);
    }
}
#[test]
fn grounds_only_in_user_sources_and_preserves_manual_choices() {
    let conn = open(Path::new(":memory:")).unwrap();
    insert_message(&conn, &message("u", "user", "나는 커피를 좋아해")).unwrap();
    insert_message(&conn, &message("a", "assistant", "사용자는 서울에 산다")).unwrap();
    apply(
        &conn,
        vec![
            fact("a", "사용자는 서울에 산다"),
            fact("u", "서울에 산다"),
            fact("u", "나는 커피를 좋아해"),
        ],
        vec![],
    );
    let stored = memories(&conn).unwrap();
    assert_eq!(stored.len(), 1);
    let stale = json!({"revision":revision(&conn).unwrap(),"memories":[fact("u","나는 커피를 좋아해")],"events":[]});
    edit_memory(&conn, &stored[0].id, "나는 차를 좋아해").unwrap();
    assert!(analyze_apply(&conn, &stale).is_err());
    apply(&conn, vec![fact("u", "나는 커피를 좋아해")], vec![]);
    assert_eq!(memories(&conn).unwrap()[0].content, "나는 차를 좋아해");
    delete_memory(&conn, &stored[0].id).unwrap();
    apply(&conn, vec![fact("u", "나는 커피를 좋아해")], vec![]);
    assert!(memories(&conn).unwrap().is_empty());
}
#[test]
fn correction_replaces_and_old_source_cannot_resurrect() {
    let conn = open(Path::new(":memory:")).unwrap();
    insert_message(&conn, &message("u1", "user", "나는 커피를 좋아해")).unwrap();
    apply(&conn, vec![fact("u1", "나는 커피를 좋아해")], vec![]);
    let old = memories(&conn).unwrap()[0].id.clone();
    insert_message(&conn, &message("u2", "user", "정정할게 나는 차를 좋아해")).unwrap();
    let mut correction = fact("u2", "나는 차를 좋아해");
    correction["supersedesId"] = json!(old);
    apply(&conn, vec![correction], vec![]);
    apply(&conn, vec![fact("u1", "나는 커피를 좋아해")], vec![]);
    assert_eq!(memories(&conn).unwrap().len(), 1);
    assert_eq!(memories(&conn).unwrap()[0].content, "나는 차를 좋아해");
}
#[test]
fn prompt_context_excludes_retired_sources_without_changing_the_transcript() {
    let conn = open(Path::new(":memory:")).unwrap();
    for (id, role, text) in [
        ("old", "user", "나는 커피를 좋아해"),
        ("reply", "assistant", "취향을 알려줘서 고마워"),
        ("corrected", "user", "정정할게 나는 차를 좋아해"),
        ("edited", "user", "나는 서울에 살아"),
        ("deleted", "user", "내 이름은 민수야"),
    ] {
        insert_message(&conn, &message(id, role, text)).unwrap();
    }
    apply(
        &conn,
        vec![
            fact("old", "나는 커피를 좋아해"),
            fact("edited", "나는 서울에 살아"),
            fact("deleted", "내 이름은 민수야"),
        ],
        vec![],
    );
    assert_eq!(context_messages(&conn, 100).unwrap().len(), 5);
    let stored = memories(&conn).unwrap();
    let id_for = |source: &str| {
        stored
            .iter()
            .find(|memory| memory.source_message_id == source)
            .unwrap()
            .id
            .clone()
    };
    let mut correction = fact("corrected", "나는 차를 좋아해");
    correction["supersedesId"] = json!(id_for("old"));
    apply(&conn, vec![correction], vec![]);
    edit_memory(&conn, &id_for("edited"), "나는 부산에 살아").unwrap();
    delete_memory(&conn, &id_for("deleted")).unwrap();
    let context = context_messages(&conn, 100).unwrap();
    assert_eq!(
        context
            .iter()
            .map(|message| message.id.as_str())
            .collect::<Vec<_>>(),
        vec!["reply", "corrected"]
    );
    assert_eq!(context_messages(&conn, 1).unwrap()[0].id, "corrected");
    let transcript = messages(&conn, 100).unwrap();
    assert_eq!(
        transcript
            .iter()
            .map(|message| message.id.as_str())
            .collect::<Vec<_>>(),
        vec!["old", "reply", "corrected", "edited", "deleted"]
    );
    assert_eq!(transcript[0].content, "나는 커피를 좋아해");
    assert_eq!(transcript[3].content, "나는 서울에 살아");
    assert_eq!(transcript[4].content, "내 이름은 민수야");
}
#[test]
fn affinity_replay_farming_and_ambiguous_corrections_do_not_change_scores() {
    let conn = open(Path::new(":memory:")).unwrap();
    for (id, text) in [
        ("1", "고마워"),
        ("2", "고마워"),
        ("3", "고마워, 그런데 그건 틀렸어"),
    ] {
        insert_message(&conn, &message(id, "user", text)).unwrap();
        let event = json!({"sourceMessageId":id,"evidence":text,"kind":"thanks","certain":true,"persona":"a"});
        let mut wrong_target = event.clone();
        wrong_target["persona"] = json!("b");
        apply(&conn, vec![], vec![event.clone(), event, wrong_target]);
    }
    assert_eq!(relationships(&conn).unwrap()[0].score, 21);
    assert_eq!(relationships(&conn).unwrap()[1].score, 20);
}
#[test]
fn story_rewards_do_not_consume_direct_affinity_budget_or_fingerprints() {
    let conn = open(Path::new(":memory:")).unwrap();
    let mut request = crate::story::prepare(&conn, "a", 0, 0).unwrap().unwrap();
    request.scene.id = "thanks".into();
    crate::story::answer(&conn, &request, "listen", 0).unwrap();
    let at = chrono::Utc::now().timestamp_millis();
    let date = chrono::DateTime::from_timestamp_millis(at)
        .unwrap()
        .date_naive()
        .to_string();
    let mut thanks = message("direct-thanks", "user", "고마워");
    thanks.created_at = at;
    insert_message(&conn, &thanks).unwrap();
    let event = json!({"sourceMessageId":thanks.id,"evidence":"고마워","kind":"thanks","certain":true,"persona":"a"});
    apply(&conn, vec![], vec![event.clone()]);
    assert_eq!(relationships(&conn).unwrap()[0].score, 26);
    apply(&conn, vec![], vec![event]);
    assert_eq!(relationships(&conn).unwrap()[0].score, 26);
    for (source, delta) in [("earlier-positive", 1), ("earlier-negative", -1)] {
        conn.execute(
            "INSERT INTO character_affinity VALUES(?1,'builtin-a',?2,?3,?1)",
            params![source, date, delta],
        )
        .unwrap();
    }
    let mut insult = message("direct-insult", "user", "꺼져");
    insult.created_at = at;
    insert_message(&conn, &insult).unwrap();
    apply(
        &conn,
        vec![],
        vec![
            json!({"sourceMessageId":insult.id,"evidence":"꺼져","kind":"insult","certain":true,"persona":"a"}),
        ],
    );
    assert_eq!(relationships(&conn).unwrap()[0].score, 26);
    assert!(!conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM character_affinity WHERE source='direct-insult')",
            [],
            |r| r.get::<_, bool>(0)
        )
        .unwrap());
}

#[test]
fn daily_cap_counts_absolute_changes() {
    let conn = open(Path::new(":memory:")).unwrap();
    let date = chrono::DateTime::from_timestamp_millis(1_800_000_000_000)
        .unwrap()
        .date_naive()
        .to_string();
    for (source, delta) in [("old1", 1), ("old2", -1), ("old3", 1)] {
        conn.execute(
            "INSERT INTO character_affinity VALUES(?1,'builtin-a',?2,?3,?1)",
            params![source, date, delta],
        )
        .unwrap();
    }
    insert_message(&conn, &message("u", "user", "고마워")).unwrap();
    apply(
        &conn,
        vec![],
        vec![
            json!({"sourceMessageId":"u","evidence":"고마워","kind":"thanks","certain":true,"persona":"a"}),
        ],
    );
    assert_eq!(relationships(&conn).unwrap()[0].score, 21);
}
#[test]
fn user_input_invalidates_prepared_scene_and_pending_tracking_is_bounded() {
    let conn = open(Path::new(":memory:")).unwrap();
    let scene = PreparedScene {
        id: "s".into(),
        revision: 0,
        lines: vec![],
    };
    add_scene(&conn, &scene).unwrap();
    insert_message(&conn, &message("u", "user", "안녕")).unwrap();
    assert!(prepared_scenes(&conn).unwrap().is_empty());
    assert!(add_scene(&conn, &scene).is_err());
    set_last_analysis_id(&conn, "u").unwrap();
    insert_message(&conn, &message("u2", "user", "다시 안녕")).unwrap();
    assert_eq!(pending_user_messages(&conn).unwrap()[0].id, "u2");
}
