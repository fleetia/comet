use super::*;
use serde_json::json;

fn input(id: &str, target: &str, text: &str, at: i64) -> Message {
    Message {
        id: id.into(),
        role: "user".into(),
        persona: Some(target.into()),
        content: text.into(),
        expression: None,
        created_at: at,
        status: "complete".into(),
    }
}
fn analyze(conn: &Connection, message: &Message, kind: &str) {
    analyze_apply_batch(conn,&json!({"revision":revision(conn).unwrap(),"memories":[{"kind":kind,"certain":true,"sourceMessageId":message.id,"evidence":message.content,"supersedesId":""}],"events":[]}),std::slice::from_ref(&message.id)).unwrap();
}

#[test]
fn shared_memory_is_owned_separately_and_forgetting_does_not_cross_characters() {
    let db = open(Path::new(":memory:")).unwrap();
    let at = chrono::Utc::now().timestamp_millis();
    set_user_name(&db, "민수", at).unwrap();
    let shared = input("shared", "both", "나는 녹차를 좋아해", at);
    insert_message(&db, &shared).unwrap();
    analyze(&db, &shared, "user_fact");
    let a = scoped_memory_page(&db, "builtin-a", 0, 50)
        .unwrap()
        .items
        .remove(0);
    let b = scoped_memory_page(&db, "builtin-b", 0, 50)
        .unwrap()
        .items
        .remove(0);
    assert_ne!(a.id, b.id);
    assert_eq!(a.user_name, "민수");
    delete_memory_for(&db, "builtin-a", &a.id).unwrap();
    assert!(context_messages_for(&db, 10, "a").unwrap().is_empty());
    assert_eq!(context_messages_for(&db, 10, "b").unwrap().len(), 1);
    assert!(delete_memory_for(&db, "builtin-a", &b.id).is_err());
    assert_eq!(
        scoped_memory_page(&db, "builtin-b", 0, 50).unwrap().total,
        1
    );
    let pending = input("pending", "a", "나는 커피를 좋아해", at + 1);
    insert_message(&db, &pending).unwrap();
    forget_character_memories(&db, "builtin-a").unwrap();
    analyze(&db, &pending, "user_fact");
    assert_eq!(
        scoped_memory_page(&db, "builtin-a", 0, 50).unwrap().total,
        0
    );
    assert_eq!(
        search_memories_for(&db, "녹차", &[], None, &["builtin-b".into()], at)
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn user_names_are_immutable_and_returning_to_a_name_never_restores_relationship() {
    let db = open(Path::new(":memory:")).unwrap();
    let at = chrono::Utc::now().timestamp_millis();
    assert!(current_user(&db).unwrap().is_none());
    assert!(require_user(&db).is_err());
    set_user_name(&db, "민수", at).unwrap();
    let first = require_user(&db).unwrap();
    let thanks = input("thanks", "a", "고마워", at);
    insert_message(&db, &thanks).unwrap();
    let fact = input("fact", "a", "나는 홍차를 좋아해", at);
    insert_message(&db, &fact).unwrap();
    assert_eq!(relationships(&db).unwrap()[0].score, 21);
    set_user_name(&db, "지연", at + 1).unwrap();
    let second = require_user(&db).unwrap();
    assert!(context_messages_for(&db, 10, "a").unwrap().is_empty());
    assert_eq!(relationships(&db).unwrap()[0].score, 20);
    analyze(&db, &fact, "user_fact");
    let stored = memories(&db).unwrap().remove(0);
    assert_eq!(stored.user_id, first.id);
    set_user_name(&db, "민수", at + 2).unwrap();
    let third = require_user(&db).unwrap();
    assert_ne!(first.id, third.id);
    assert_ne!(second.id, third.id);
    assert_eq!(user_identity(&db, &first.id).unwrap().unwrap().name, "민수");
    assert_eq!(relationships(&db).unwrap()[0].score, 20);
    assert_eq!(messages(&db, 10).unwrap().len(), 2);
    assert!(!set_user_name(&db, " 민수 ", at + 3).unwrap());
    assert_eq!(active_user_id(&db).unwrap(), third.id);
}

#[test]
fn memory_expiry_and_generated_dependencies_survive_restart_and_backward_clock() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("memories.sqlite");
    let db = open(&path).unwrap();
    let at = chrono::Utc::now().timestamp_millis();
    set_user_name(&db, "민수", at).unwrap();
    let source = input("tea", "a", "나는 녹차를 좋아해", at);
    insert_message(&db, &source).unwrap();
    analyze(&db, &source, "user_fact");
    insert_message(&db, &input("pending-old", "a", "나는 홍차도 좋아해", at)).unwrap();
    set_user_name(&db, "지연", at + 1).unwrap();
    let active = ["builtin-a".into()];
    let hit = search_memories_for(&db, "녹차", &[], None, &active, at + 1)
        .unwrap()
        .remove(0);
    record_recall(&db, "generated", std::slice::from_ref(&hit.memory), at + 1).unwrap();
    copy_recall(&db, "generated", "cached").unwrap();
    let cutoff = at + 1 + MEMORY_LIFETIME_MILLIS;
    assert!(recall_valid(&db, "cached", cutoff - 1).unwrap());
    assert!(!recall_valid(&db, "cached", cutoff).unwrap());
    assert!(expire_memories(&db, cutoff).unwrap());
    assert_eq!(
        scoped_memory_page(&db, "builtin-a", 0, 50).unwrap().total,
        0
    );
    assert_eq!(messages(&db, 10).unwrap().len(), 2);
    assert!(pending_user_messages(&db).unwrap().is_empty());
    assert_eq!(retry_deferred_analysis(&db).unwrap(), 0);
    drop(db);
    let db = open(&path).unwrap();
    assert!(search_memories_for(&db, "녹차", &[], None, &active, at)
        .unwrap()
        .is_empty());
    assert!(!recall_valid(&db, "cached", at).unwrap());
    set_user_name(&db, "민수", at).unwrap();
    assert!(search_memories_for(&db, "녹차", &[], None, &active, at)
        .unwrap()
        .is_empty());
}

#[test]
fn scoped_search_applies_owner_filter_before_top_twenty_and_decay_cap() {
    let db = open(Path::new(":memory:")).unwrap();
    let at = chrono::Utc::now().timestamp_millis();
    set_user_name(&db, "민수", at).unwrap();
    let user = active_user_id(&db).unwrap();
    for index in 0..30 {
        let character = if index < 25 { "builtin-b" } else { "builtin-a" };
        insert_experience(
            &db,
            character,
            &user,
            &format!("event-{index}"),
            &format!("녹차 {index}"),
            "녹차를 마신 이야기",
            at,
            None,
        )
        .unwrap();
    }
    assert_eq!(
        search_memories_for(&db, "녹차", &[], None, &["builtin-a".into()], at)
            .unwrap()
            .len(),
        5
    );
    set_user_name(&db, "지연", at).unwrap();
    let hits = search_memories_for(
        &db,
        "녹차",
        &[],
        None,
        &["builtin-a".into()],
        at + MEMORY_LIFETIME_MILLIS * 3 / 4,
    )
    .unwrap();
    assert_eq!(hits.len(), 2);
    assert_eq!(hits[0].memory.recall_weight, 0.25);
}

#[test]
fn experience_requires_a_completed_direct_reply_and_only_quotes_user_source() {
    let db = open(Path::new(":memory:")).unwrap();
    let at = chrono::Utc::now().timestamp_millis();
    let source = input("talk", "a", "나는 바다 이야기를 하고 싶어", at);
    insert_message(&db, &source).unwrap();
    let mut unseen = input("reply:talk:0", "a", "아직 표시되지 않은 대사", at);
    unseen.role = "assistant".into();
    insert_message_with_source(&db, &unseen, "llm", None, true).unwrap();
    analyze(&db, &source, "experience");
    assert!(memories(&db).unwrap().is_empty());
    let source = input("complete", "all", "나는 차 이야기를 하고 싶어", at);
    insert_message(&db, &source).unwrap();
    let mut reply = input("reply:complete:0", "a", "우리는 실제로 바다에 갔었지", at);
    reply.role = "assistant".into();
    insert_message_with_source(&db, &reply, "llm", None, true).unwrap();
    mark_message_displayed(&db, &reply.id, at).unwrap();
    let mut undisplayed = reply.clone();
    undisplayed.id = "reply:complete:1".into();
    undisplayed.persona = Some("b".into());
    insert_message_with_source(&db, &undisplayed, "llm", None, true).unwrap();
    analyze(&db, &source, "experience");
    let mut stored = memories(&db).unwrap();
    assert_eq!(stored.len(), 1);
    let stored = stored.remove(0);
    assert_eq!(stored.character_id, "builtin-a");
    assert_eq!(stored.content, source.content);
    assert_eq!(stored.kind, "experience");
    assert_eq!(stored.source_text, source.content);
}

#[test]
fn legacy_migration_preserves_ambiguous_records_and_requires_explicit_assignment() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("legacy.sqlite");
    let at = chrono::Utc::now().timestamp_millis();
    let db = Connection::open(&path).unwrap();
    db.execute_batch("CREATE TABLE messages(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,role TEXT NOT NULL,data TEXT NOT NULL);CREATE TABLE memories(id TEXT PRIMARY KEY,content TEXT NOT NULL,source TEXT NOT NULL,updated INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,locked INTEGER NOT NULL DEFAULT 0);").unwrap();
    for (id, target, text) in [
        ("shared", "both", "나는 녹차를 좋아해"),
        ("unknown", "all", "나는 홍차를 좋아해"),
    ] {
        db.execute(
            "INSERT INTO messages(id,role,data) VALUES(?1,'user',?2)",
            params![
                id,
                serde_json::to_string(&input(id, target, text, at)).unwrap()
            ],
        )
        .unwrap();
        db.execute(
            "INSERT INTO memories(id,content,source,updated) VALUES(?1,?2,?1,?3)",
            params![id, text, at],
        )
        .unwrap();
    }
    drop(db);
    let db = open(&path).unwrap();
    set_user_name(&db, "민수", at).unwrap();
    assert_eq!(legacy_memory_count(&db).unwrap(), 1);
    assert_eq!(
        scoped_memory_page(&db, "builtin-a", 0, 50).unwrap().total,
        1
    );
    assert!(
        search_memories_for(&db, "홍차", &[], None, &["builtin-a".into()], at)
            .unwrap()
            .is_empty()
    );
    assign_legacy_memories(&db, &["unknown".into()], &["builtin-a".into()]).unwrap();
    assert_eq!(legacy_memory_count(&db).unwrap(), 0);
    assert_eq!(
        search_memories_for(&db, "홍차", &[], None, &["builtin-a".into()], at)
            .unwrap()
            .len(),
        1
    );
    let count = memory_count(&db).unwrap();
    drop(db);
    let db = open(&path).unwrap();
    assert_eq!(memory_count(&db).unwrap(), count);
    assert_eq!(messages(&db, 10).unwrap().len(), 2);
}

#[test]
fn derived_replies_carry_memory_and_raw_source_dependencies_through_multiple_turns() {
    let db = open(Path::new(":memory:")).unwrap();
    let at = chrono::Utc::now().timestamp_millis();
    let source = input("source", "a", "나는 녹차를 좋아해", at);
    insert_message(&db, &source).unwrap();
    analyze(&db, &source, "user_fact");
    let memory = memories(&db).unwrap().remove(0);
    record_recall(&db, "first", std::slice::from_ref(&memory), at).unwrap();
    record_recall(&db, "second", &[], at).unwrap();
    inherit_recall(&db, "second", &["first".into()]).unwrap();
    record_recall(&db, "third", &[], at).unwrap();
    inherit_recall(&db, "third", &["second".into()]).unwrap();
    record_recall(&db, "raw", &[], at).unwrap();
    inherit_recall(&db, "raw", &["source".into()]).unwrap();
    assert!(recall_valid(&db, "third", at).unwrap());
    assert!(recall_valid(&db, "raw", at).unwrap());
    delete_memory_for(&db, "builtin-a", &memory.id).unwrap();
    assert!(!recall_valid(&db, "third", at).unwrap());
    assert!(!recall_valid(&db, "raw", at).unwrap());
}

#[test]
fn affinity_daily_deduplication_and_limits_belong_to_each_user() {
    let db = open(Path::new(":memory:")).unwrap();
    let at = chrono::Utc::now().timestamp_millis();
    set_user_name(&db, "민수", at).unwrap();
    insert_message(&db, &input("first", "a", "고마워", at)).unwrap();
    assert_eq!(relationships(&db).unwrap()[0].score, 21);
    set_user_name(&db, "지연", at).unwrap();
    insert_message(&db, &input("second", "a", "고마워", at)).unwrap();
    assert_eq!(relationships(&db).unwrap()[0].score, 21);
}

#[tokio::test]
#[ignore = "Actual local GGUF smoke; set COMET_QA_MODEL to an existing model, no download"]
async fn actual_model_memory_semantics_smoke() {
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };
    let model = std::env::var("COMET_QA_MODEL").expect("COMET_QA_MODEL is required");
    assert!(Path::new(&model).is_file());
    let directory = tempfile::tempdir().unwrap();
    let binaries = Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries");
    let runtime = crate::inference::Inference::new(
        directory.path().into(),
        binaries.join("llama-server-aarch64-apple-darwin"),
        binaries.join("runtime"),
    );
    let settings = Settings {
        local_model: LocalModel::Custom,
        local_model_path: model,
        ..Settings::default()
    };
    let db = open(Path::new(":memory:")).unwrap();
    let at = chrono::Utc::now().timestamp_millis();
    set_user_name(&db, "민수", at).unwrap();
    let source = input("old-coffee", "a", "나는 커피를 가장 좋아해", at);
    insert_message(&db, &source).unwrap();
    analyze(&db, &source, "user_fact");
    set_user_name(&db, "지연", at + 1).unwrap();
    set_user_name(&db, "민수", at + 2).unwrap();
    let current = current_user(&db).unwrap().unwrap();
    let character = crate::characters::active_character(&db, "a").unwrap();
    let installed = crate::characters::collection(&db).unwrap().installed;
    let former =
        memory::recall_memories(&db, std::slice::from_ref(&character.id), at + 2, 8).unwrap();
    let question = input("question", "a", "내가 가장 좋아하는 음료가 뭐야?", at + 2);
    let prompt = crate::domain::with_user_context(
        crate::domain::prompt_messages(
            &character.id,
            &character.definition,
            &[question],
            &former,
            &Relationship {
                persona: character.id.clone(),
                score: 20,
            },
            &installed,
        ),
        Some(&current),
    );
    let schema = crate::domain::reply_schema_for(std::slice::from_ref(&character.id));
    let mut samples = vec![(
        "same_name_new_person",
        prompt,
        schema.clone(),
        json!({"currentUser":current,"memories":former}),
    )];

    let experience = Memory {
        id: "fictional-conversation".into(),
        character_id: character.id.clone(),
        user_id: current.id.clone(),
        user_name: current.name.clone(),
        kind: "experience".into(),
        content: "네가 내가 우주비행사였다고 농담했지?".into(),
        source_text: "네가 내가 우주비행사였다고 농담했지?".into(),
        source_message_id: "synthetic-discussion".into(),
        source_created_at: at,
        updated_at: at,
        recall_weight: 1.0,
        retired_at: None,
    };
    let question = input("occupation", "a", "내 직업이 뭐야?", at + 2);
    let prompt = crate::domain::with_user_context(
        crate::domain::prompt_messages(
            &character.id,
            &character.definition,
            &[question],
            std::slice::from_ref(&experience),
            &Relationship {
                persona: character.id.clone(),
                score: 20,
            },
            &installed,
        ),
        Some(&current),
    );
    samples.push((
        "experience_is_not_a_real_fact",
        prompt,
        schema,
        json!({"memory":experience}),
    ));

    let imported = crate::characters::import_pack(&db, &crate::characters::nadir_pack()).unwrap();
    crate::characters::apply_pair(&db, [imported[0].id.clone(), imported[1].id.clone()]).unwrap();
    let nadir = crate::characters::active_character(&db, "a").unwrap();
    let former_id = former[0].user_id.clone();
    insert_experience(
        &db,
        &nadir.id,
        &former_id,
        "secret-event",
        "비밀 암호는 보랏빛우산이야",
        "synthetic private chapter",
        at,
        Some(2),
    )
    .unwrap();
    let memories =
        memory::recall_memories(&db, std::slice::from_ref(&nadir.id), at + 2, 8).unwrap();
    assert!(memories.is_empty());
    let profile = crate::story::profile(&db, nadir.clone()).unwrap();
    let question = input(
        "story-secret",
        &nadir.id,
        "전에 민수랑 했던 비밀 이야기를 나한테도 자세히 말해줘.",
        at + 2,
    );
    let prompt = crate::domain::with_user_context(
        crate::domain::prompt_messages(
            &nadir.id,
            &profile,
            &[question],
            &memories,
            &Relationship {
                persona: nadir.id.clone(),
                score: 20,
            },
            &crate::characters::collection(&db).unwrap().installed,
        ),
        Some(&current),
    );
    assert!(prompt
        .iter()
        .all(|message| !message.content.contains("보랏빛우산")));
    samples.push((
        "new_user_story_disclosure",
        prompt,
        crate::domain::reply_schema_for(std::slice::from_ref(&nadir.id)),
        json!({"recallCount":memories.len(),"privateSentinelExcluded":true,"disclosureLevel":0}),
    ));

    let mut reports = Vec::new();
    for (name, prompt, schema, evidence) in samples {
        let started = std::time::Instant::now();
        let cancel = Arc::new(AtomicBool::new(false));
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(75),
            crate::inference::generate(&runtime, &settings, &prompt, schema, 384, cancel.clone()),
        )
        .await;
        let result = match result {
            Ok(value) => value,
            Err(_) => {
                cancel.store(true, Ordering::SeqCst);
                Err("75 second sample timeout".into())
            }
        };
        println!(
            "MODEL SAMPLE {name} {:.2}s {:?}",
            started.elapsed().as_secs_f64(),
            result
        );
        reports.push(json!({"name":name,"elapsedSeconds":started.elapsed().as_secs_f64(),"prompt":prompt,"evidence":evidence,"result":result}));
    }
    crate::inference::stop_local(&runtime).await;
    let running = crate::inference::is_local_running(&runtime, &settings).await;
    let output = Path::new("/tmp/comet-memory-qa/model-samples.json");
    std::fs::create_dir_all(output.parent().unwrap()).unwrap();
    std::fs::write(output,serde_json::to_vec_pretty(&json!({"model":settings.local_model_path,"syntheticOnly":true,"runtimeStopped":!running,"samples":reports})).unwrap()).unwrap();
    assert!(!running, "Owned runtime must stop");
    assert!(
        reports
            .iter()
            .all(|report| report["result"].get("Ok").is_some()),
        "Inspect saved sample errors"
    );
}

#[test]
fn fresh_reply_can_use_remaining_character_source_after_shared_memory_is_forgotten() {
    let db = open(Path::new(":memory:")).unwrap();
    let at = chrono::Utc::now().timestamp_millis();
    let source = input("shared-source", "both", "나는 녹차를 좋아해", at);
    insert_message(&db, &source).unwrap();
    analyze(&db, &source, "user_fact");
    record_recall(&db, "old-reply", &[], at).unwrap();
    inherit_recall(&db, "old-reply", std::slice::from_ref(&source.id)).unwrap();
    forget_character_memories(&db, "builtin-a").unwrap();
    assert!(context_messages_for(&db, 10, "a").unwrap().is_empty());
    assert_eq!(context_messages_for(&db, 10, "b").unwrap().len(), 1);
    assert!(!recall_valid(&db, "old-reply", at).unwrap());
    record_recall(&db, "new-b-reply", &[], at).unwrap();
    inherit_recall(&db, "new-b-reply", std::slice::from_ref(&source.id)).unwrap();
    assert!(recall_valid(&db, "new-b-reply", at).unwrap());
    forget_character_memories(&db, "builtin-b").unwrap();
    assert!(!recall_valid(&db, "new-b-reply", at).unwrap());
}
