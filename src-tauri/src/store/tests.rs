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
    assert!(context
        .iter()
        .all(|m| m.persona.as_deref() == Some("builtin-a")));
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
    let imported = crate::characters::import_pack(&conn, &crate::characters::nadir_pack()).unwrap();
    crate::characters::apply_pair(&conn, [imported[0].id.clone(), imported[1].id.clone()]).unwrap();
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
            "INSERT INTO character_affinity VALUES(?1,?2,?3,?4,?1)",
            params![source, imported[0].id, date, delta],
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

#[test]
fn memory_search_uses_full_current_sources_and_never_pads_unrelated_results() {
    let conn = open(Path::new(":memory:")).unwrap();
    insert_message(&conn, &message("tea", "user", "나는 녹차를 좋아해 🍵")).unwrap();
    insert_message(&conn, &message("home", "user", "나는 서울에서 살아")).unwrap();
    apply(
        &conn,
        vec![
            fact("tea", "나는 녹차를 좋아해 🍵"),
            fact("home", "나는 서울에서 살아"),
        ],
        vec![],
    );
    let hits = search_memories(&conn, "녹차", &[], None).unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].memory.content, "나는 녹차를 좋아해 🍵");
    assert_eq!(hits[0].memory.source_message_id, "tea");
    assert!(search_memories(&conn, "우주선", &[], None)
        .unwrap()
        .is_empty());
    assert!(search_memories(&conn, "\" OR * ()", &[], None)
        .unwrap()
        .is_empty());
    let id = &hits[0].memory.id;
    edit_memory(&conn, id, "이제 홍차를 좋아해 🍵").unwrap();
    assert!(revalidate_search_hits(&conn, &hits).unwrap().is_empty());
    assert!(search_memories(&conn, "녹차", &[], None)
        .unwrap()
        .is_empty());
    let updated = search_memories(&conn, "홍차", &[], None).unwrap();
    assert_eq!(updated[0].content_version, 2);
    assert_eq!(updated[0].memory.content, "이제 홍차를 좋아해 🍵");
    delete_memory(&conn, id).unwrap();
    assert!(search_memories(&conn, "홍차", &[], None)
        .unwrap()
        .is_empty());
}

#[test]
fn derived_memory_indices_reject_edited_deleted_and_replaced_profiles() {
    let conn = open(Path::new(":memory:")).unwrap();
    insert_message(&conn, &message("tea", "user", "나는 차를 좋아해")).unwrap();
    apply(&conn, vec![fact("tea", "나는 차를 좋아해")], vec![]);
    set_search_profile(&conn, "kiwi", Some("kiwi-v1")).unwrap();
    set_search_profile(&conn, "semantic", Some("e5-v1")).unwrap();
    let item = next_memory_for_index(&conn, "semantic", "e5-v1")
        .unwrap()
        .unwrap();
    let mut vector = vec![0.0; 384];
    vector[0] = 1.0;
    let windows = [MemoryEmbedding {
        window_start: 0,
        window_end: item.content.len(),
        vector: vector.clone(),
    }];
    assert!(save_vector_index(&conn, &item.id, item.content_version, "e5-v1", &windows).unwrap());
    assert!(save_kiwi_index(
        &conn,
        &item.id,
        item.content_version,
        "kiwi-v1",
        "녹차 음료"
    )
    .unwrap());
    assert_eq!(pending_index_count(&conn, "semantic", "e5-v1").unwrap(), 0);
    assert!(search_memories(&conn, "녹차", &[], None)
        .unwrap()
        .is_empty());
    assert_eq!(
        search_memories(&conn, "", &[], Some(("e5-v1", &vector, 0.9)))
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        search_memories(&conn, "녹차", &["음료".into()], None)
            .unwrap()
            .len(),
        1
    );
    edit_memory(&conn, &item.id, "이제 커피를 좋아해").unwrap();
    assert!(!save_vector_index(&conn, &item.id, item.content_version, "e5-v1", &windows).unwrap());
    assert!(!save_kiwi_index(&conn, &item.id, item.content_version, "kiwi-v1", "녹차").unwrap());
    assert!(
        search_memories(&conn, "", &[], Some(("e5-v1", &vector, 0.9)))
            .unwrap()
            .is_empty()
    );
    assert!(search_memories(&conn, "녹차", &[], None)
        .unwrap()
        .is_empty());
    let current = next_memory_for_index(&conn, "semantic", "e5-v1")
        .unwrap()
        .unwrap();
    set_search_profile(&conn, "semantic", Some("e5-v2")).unwrap();
    assert!(!save_vector_index(
        &conn,
        &current.id,
        current.content_version,
        "e5-v1",
        &windows
    )
    .unwrap());
    assert!(save_vector_index(
        &conn,
        &current.id,
        current.content_version,
        "e5-v2",
        &windows
    )
    .unwrap());
    clear_search_index(&conn, "semantic").unwrap();
    assert!(!save_vector_index(
        &conn,
        &current.id,
        current.content_version,
        "e5-v2",
        &windows
    )
    .unwrap());
    assert_eq!(memories(&conn).unwrap().len(), 1);
    delete_memory(&conn, &item.id).unwrap();
    assert!(!save_kiwi_index(
        &conn,
        &current.id,
        current.content_version,
        "kiwi-v1",
        "커피"
    )
    .unwrap());
}

#[test]
fn memory_pages_are_bounded_and_revision_tracks_memory_changes_only() {
    let conn = open(Path::new(":memory:")).unwrap();
    let before = memory_revision(&conn).unwrap();
    insert_message(&conn, &message("input", "user", "안녕")).unwrap();
    assert_eq!(memory_revision(&conn).unwrap(), before);
    for index in 0..53 {
        conn.execute(
            "INSERT INTO memories(id,content,source,updated) VALUES(?1,?2,?1,?3)",
            params![
                format!("id-{index:02}"),
                format!("공통 기억 {index}"),
                index
            ],
        )
        .unwrap();
    }
    let page = memory_page(&conn, 0, 1000).unwrap();
    assert_eq!(page.total, 53);
    assert_eq!(page.items.len(), 50);
    assert_eq!(page.next_offset, Some(50));
    assert_eq!(page.revision, before + 53);
    let tail = memory_page(&conn, 50, 50).unwrap();
    assert_eq!(tail.items.len(), 3);
    assert_eq!(tail.next_offset, None);
    let hits = search_memories(&conn, "공통", &[], None).unwrap();
    assert_eq!(hits.len(), 8);
}

#[test]
fn analysis_completes_only_submitted_sources_and_rejects_other_source_ids() {
    let conn = open(Path::new(":memory:")).unwrap();
    for id in ["one", "two", "three"] {
        insert_message(&conn, &message(id, "user", "나는 녹차를 좋아해")).unwrap();
    }
    let revision = revision(&conn).unwrap();
    let bad =
        json!({"revision":revision,"memories":[fact("two","나는 녹차를 좋아해")],"events":[]});
    assert!(analyze_apply_batch(&conn, &bad, &["one".into()]).is_err());
    assert_eq!(analysis_status(&conn).unwrap().pending, 3);
    let good =
        json!({"revision":revision,"memories":[fact("one","나는 녹차를 좋아해")],"events":[]});
    analyze_apply_batch(&conn, &good, &["one".into()]).unwrap();
    assert_eq!(
        pending_user_messages(&conn)
            .unwrap()
            .iter()
            .map(|message| message.id.as_str())
            .collect::<Vec<_>>(),
        ["two", "three"]
    );
    assert!(analyze_apply_batch(&conn, &good, &["two".into()]).is_err());
    assert_eq!(analysis_status(&conn).unwrap().pending, 2);
}

#[test]
fn analysis_failure_rolls_back_memory_fts_and_job_completion_together() {
    let conn = open(Path::new(":memory:")).unwrap();
    insert_message(&conn, &message("one", "user", "나는 녹차를 좋아해")).unwrap();
    let before = revision(&conn).unwrap();
    conn.execute_batch("CREATE TRIGGER fail_completion BEFORE UPDATE OF state ON memory_analysis_jobs WHEN new.state='done' BEGIN SELECT RAISE(ABORT,'injected storage failure'); END;").unwrap();
    let result =
        json!({"revision":before,"memories":[fact("one","나는 녹차를 좋아해")],"events":[]});
    assert!(analyze_apply_batch(&conn, &result, &["one".into()]).is_err());
    assert!(memories(&conn).unwrap().is_empty());
    assert!(search_memories(&conn, "녹차", &[], None)
        .unwrap()
        .is_empty());
    assert_eq!(analysis_status(&conn).unwrap().pending, 1);
    assert_eq!(memory_revision(&conn).unwrap(), 0);
    assert_eq!(revision(&conn).unwrap(), before);
}

#[test]
fn analysis_retries_back_off_then_require_manual_retry() {
    let conn = open(Path::new(":memory:")).unwrap();
    insert_message(&conn, &message("one", "user", "나는 녹차를 좋아해")).unwrap();
    for (attempt, delay) in [60000, 300000, 900000, 900000].into_iter().enumerate() {
        analysis_failure(&conn, &["one".into()], 100).unwrap();
        let (count,next,state):(usize,i64,String) = conn.query_row("SELECT attempts,next_attempt_at,state FROM memory_analysis_jobs WHERE message_id='one'",[],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?))).unwrap();
        assert_eq!(count, attempt + 1);
        assert_eq!(next, 100 + delay);
        assert_eq!(state, if attempt == 3 { "deferred" } else { "pending" });
    }
    assert!(pending_user_messages(&conn).unwrap().is_empty());
    assert_eq!(retry_deferred_analysis(&conn).unwrap(), 1);
    assert_eq!(analysis_status(&conn).unwrap().pending, 1);
}

#[test]
fn analysis_migration_preserves_legacy_cursor_without_replaying_affinity() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("legacy.sqlite");
    let conn = open(&path).unwrap();
    insert_message(&conn, &message("before", "user", "고마워")).unwrap();
    insert_message(&conn, &message("after", "user", "나는 녹차를 좋아해")).unwrap();
    put(&conn, "last_analysis_id", &"before").unwrap();
    conn.execute_batch("DROP TABLE memory_analysis_jobs; DELETE FROM character_affinity; DELETE FROM kv WHERE key='memory_analysis_jobs_v1';").unwrap();
    drop(conn);
    let conn = open(&path).unwrap();
    assert_eq!(analysis_status(&conn).unwrap().legacy_unverified, 1);
    assert_eq!(pending_user_messages(&conn).unwrap()[0].id, "after");
    assert_eq!(relationships(&conn).unwrap()[0].score, 20);
    assert_eq!(messages(&conn, 10).unwrap().len(), 2);
    drop(conn);
    let conn = open(&path).unwrap();
    assert_eq!(analysis_status(&conn).unwrap().legacy_unverified, 1);
    assert_eq!(relationships(&conn).unwrap()[0].score, 20);
}

#[test]
fn direct_affinity_requires_no_model_and_only_applies_new_inputs() {
    let conn = open(Path::new(":memory:")).unwrap();
    let thanks = message("thanks", "user", "고마워!");
    insert_message(&conn, &thanks).unwrap();
    assert_eq!(relationships(&conn).unwrap()[0].score, 21);
    assert_eq!(relationships(&conn).unwrap()[1].score, 20);
    insert_message(&conn, &thanks).unwrap();
    insert_message(&conn, &message("quoted", "user", "친구가 고마워라고 했어")).unwrap();
    insert_message(
        &conn,
        &message("not-thanks", "user", "고마워라고 생각하지 않아"),
    )
    .unwrap();
    assert_eq!(relationships(&conn).unwrap()[0].score, 21);
}

#[test]
#[ignore = "diagnostic benchmark; run explicitly with --ignored --nocapture --test-threads=1"]
fn memory_retrieval_diagnostic_benchmark() {
    use std::time::Instant;
    let percentile = |samples: &mut Vec<f64>, percentile: usize| {
        samples.sort_by(f64::total_cmp);
        samples[(samples.len() - 1) * percentile / 100]
    };
    for count in [100, 1000, 10_000] {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("benchmark.sqlite");
        let conn = open(&path).unwrap();
        set_search_profile(&conn, "semantic", Some("synthetic-384-normalized")).unwrap();
        let mut query_vector = vec![0.0_f32; 384];
        query_vector[0] = 1.0;
        let started = Instant::now();
        let tx = conn.unchecked_transaction().unwrap();
        for index in 0..count {
            let id = format!("memory-{index:05}");
            let content = format!("내 취미{index} 기록은 주말에 책을 읽고 차를 마시는 것이다.");
            tx.execute(
                "INSERT INTO memories(id,content,source,updated) VALUES(?1,?2,?1,?3)",
                params![id, content, index],
            )
            .unwrap();
            let mut vector = vec![0.0_f32; 384];
            vector[index as usize % 384] = 1.0;
            let bytes: Vec<_> = vector
                .iter()
                .flat_map(|value| value.to_le_bytes())
                .collect();
            tx.execute(
                "INSERT INTO memory_vectors VALUES(?1,1,'synthetic-384-normalized',0,?2,?3)",
                params![id, content.len() as i64, bytes],
            )
            .unwrap();
        }
        tx.commit().unwrap();
        let population_ms = started.elapsed().as_secs_f64() * 1000.0;
        drop(conn);
        let started = Instant::now();
        let conn = open(&path).unwrap();
        let page = memory_page(&conn, 0, 50).unwrap();
        let initial_page_ms = started.elapsed().as_secs_f64() * 1000.0;
        assert_eq!(page.items.len(), 50);
        assert_eq!(page.total, count as usize);
        let mut lexical = Vec::new();
        let mut semantic = Vec::new();
        for _ in 0..30 {
            let started = Instant::now();
            let _ = search_memories(&conn, "취미42", &[], None).unwrap();
            lexical.push(started.elapsed().as_secs_f64() * 1000.0);
            let started = Instant::now();
            let _ = search_memories(
                &conn,
                "취미42",
                &[],
                Some(("synthetic-384-normalized", &query_vector, 0.9)),
            )
            .unwrap();
            semantic.push(started.elapsed().as_secs_f64() * 1000.0);
        }
        let bytes: i64 = conn
            .query_row(
                "SELECT SUM(length(vector)) FROM memory_vectors",
                [],
                |row| row.get(0),
            )
            .unwrap();
        println!(
            "{}",
            json!({"memories":count,"build":if cfg!(debug_assertions) {"debug"} else {"release"},"populationMs":population_ms,"initialPageMs":initial_page_ms,"lexicalP50Ms":percentile(&mut lexical,50),"lexicalP95Ms":percentile(&mut lexical,95),"vectorScanP50Ms":percentile(&mut semantic,50),"vectorScanP95Ms":percentile(&mut semantic,95),"vectorCacheBytes":bytes,"note":"Synthetic vectors; no NLP model, tokenizer, child-process startup, or device support guarantee."})
        );
    }
}

#[test]
fn grammatical_query_words_cannot_retrieve_unrelated_memories() {
    let conn = open(Path::new(":memory:")).unwrap();
    for (id, content) in [
        ("hiking", "나는 주말마다 등산을 한다."),
        ("cat", "내가 키우는 고양이의 이름은 별이다."),
        ("birthday", "내 생일은 팔월이다."),
        ("accent", "My favorite place is Café Étoile."),
    ] {
        conn.execute(
            "INSERT INTO memories(id,content,source,updated) VALUES(?1,?2,?1,0)",
            params![id, content],
        )
        .unwrap();
    }
    for query in [
        "나는",
        "내가 뭘 기억하니",
        "내 혈액형은 뭐야?",
        "내 고양이 생일은 언제야?",
    ] {
        assert!(
            search_memories(&conn, query, &[], None).unwrap().is_empty(),
            "{query}"
        );
    }
    for terms in [
        vec!["나", "혈액형", "뭐"],
        vec!["고양이", "생일"],
        vec!["고양이", "입양", "날짜"],
    ] {
        let terms = terms.into_iter().map(str::to_string).collect::<Vec<_>>();
        assert!(search_memories(&conn, "사용자 질문", &terms, None)
            .unwrap()
            .is_empty());
    }
    assert_eq!(
        search_memories(&conn, "cafe etoile", &[], None).unwrap()[0]
            .memory
            .id,
        "accent"
    );
    assert_eq!(
        search_memories(&conn, "등산", &[], None).unwrap()[0]
            .memory
            .id,
        "hiking"
    );
    assert_eq!(
        search_memories(&conn, "고양이 이름 알려줘", &[], None).unwrap()[0]
            .memory
            .id,
        "cat"
    );
    assert_eq!(
        search_memories(
            &conn,
            "고양이의 이름은 뭐지",
            &["고양이".into(), "이름".into()],
            None
        )
        .unwrap()[0]
            .memory
            .id,
        "cat"
    );
}

#[test]
fn lexical_coverage_does_not_override_independent_semantic_candidates() {
    let conn = open(Path::new(":memory:")).unwrap();
    let content = "나는 주말에 산길을 걷는다.";
    conn.execute(
        "INSERT INTO memories(id,content,source,updated) VALUES('outdoors',?1,'source',0)",
        [content],
    )
    .unwrap();
    set_search_profile(&conn, "semantic", Some("coverage-regression")).unwrap();
    let mut vector = vec![0.0; 384];
    vector[0] = 1.0;
    save_vector_index(
        &conn,
        "outdoors",
        1,
        "coverage-regression",
        &[MemoryEmbedding {
            window_start: 0,
            window_end: content.len(),
            vector: vector.clone(),
        }],
    )
    .unwrap();
    let hits = search_memories(
        &conn,
        "휴일 등산 취미",
        &[],
        Some(("coverage-regression", &vector, 0.9)),
    )
    .unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].methods, ["semantic"]);
    vector[0] = 0.0;
    vector[1] = 1.0;
    assert!(search_memories(
        &conn,
        "내 혈액형은 뭐야",
        &[],
        Some(("coverage-regression", &vector, 0.9))
    )
    .unwrap()
    .is_empty());
}

#[test]
fn morphology_still_recovers_particle_and_irregular_inflection_queries() {
    let conn = open(Path::new(":memory:")).unwrap();
    set_search_profile(&conn, "kiwi", Some("morphology-regression")).unwrap();
    for (id, content, tokens) in [
        ("pet", "고양이의 이름은 별이다.", "고양이 이름 별"),
        (
            "taste",
            "매운 음식보다 순한 음식을 좋아한다.",
            "맵 음식 순하 음식 좋아하",
        ),
    ] {
        conn.execute(
            "INSERT INTO memories(id,content,source,updated) VALUES(?1,?2,?1,0)",
            params![id, content],
        )
        .unwrap();
        save_kiwi_index(&conn, id, 1, "morphology-regression", tokens).unwrap();
    }
    assert_eq!(
        search_memories(
            &conn,
            "고양이는 이름이 뭐야?",
            &["고양이".into(), "이름".into()],
            None
        )
        .unwrap()[0]
            .memory
            .id,
        "pet"
    );
    let hits = search_memories(
        &conn,
        "맵거나 순한 음식?",
        &["맵".into(), "순하".into(), "음식".into()],
        None,
    )
    .unwrap();
    assert_eq!(hits[0].memory.id, "taste");
    assert!(hits[0].methods.iter().any(|method| method == "kiwi"));
}
