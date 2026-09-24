use super::*;
use crate::{store, types::Message};

fn database() -> Connection {
    let conn = store::open(std::path::Path::new(":memory:")).unwrap();
    store::set_user_name(
        &conn,
        "민수",
        chrono::Utc::now().timestamp_millis() - 10_000,
    )
    .unwrap();
    conn
}

fn donor() -> Connection {
    let conn = database();
    let at = chrono::Utc::now().timestamp_millis() - 1000;
    let person = store::active_user_id(&conn).unwrap();
    for (id, role, persona, text) in [
        ("shared", "user", "both", "나는 녹차를 좋아해."),
        ("reply-a", "assistant", "a", "녹차를 좋아하는구나."),
        ("reply-b", "assistant", "b", "나는 함께 마실게."),
        ("private-b", "user", "b", "B만 알고 있는 이야기"),
    ] {
        store::insert_message(
            &conn,
            &Message {
                id: id.into(),
                role: role.into(),
                persona: Some(persona.into()),
                content: text.into(),
                expression: None,
                created_at: at,
                status: "complete".into(),
            },
        )
        .unwrap();
    }
    for character in ["builtin-a", "builtin-b"] {
        conn.execute("INSERT INTO memories(id,content,source,updated,character_id,user_id,kind,source_text,source_created_at)
            VALUES(?1,'나는 녹차를 좋아해.','shared',?2,?3,?4,'user_fact','나는 녹차를 좋아해.',?2)",params![format!("memory-{character}"),at,character,person]).unwrap();
        conn.execute("INSERT INTO character_affinity(source,character_id,day,delta,fingerprint,user_id) VALUES(?1,?2,'today',7,'fixture',?3)",params![format!("affinity-{character}"),character,person]).unwrap();
    }
    conn
}

fn all() -> ExportOptions {
    ExportOptions {
        include_sprites: true,
        include_memories: true,
        include_affinity: true,
        include_messages: true,
    }
}

fn count(conn: &Connection, table: &str) -> i64 {
    conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
        row.get(0)
    })
    .unwrap()
}

#[test]
fn archive_toggles_are_independent_and_selected_characters_bound_private_records() {
    let conn = donor();
    for bits in 0..8 {
        let options = ExportOptions {
            include_memories: bits & 1 != 0,
            include_affinity: bits & 2 != 0,
            include_messages: bits & 4 != 0,
            ..Default::default()
        };
        let pack = export_pack_with_options(&conn, &["builtin-a".into()], &[], &options).unwrap();
        let json = pack_json(&pack).unwrap();
        let parsed = parse_pack(&json).unwrap();
        if bits == 0 {
            assert!(parsed.archive.is_none());
            assert!(!json.contains("녹차"));
            continue;
        }
        assert_eq!(parsed.format_version, 4);
        let archive = parsed.archive.unwrap();
        assert_eq!(
            archive.memories.len(),
            usize::from(options.include_memories)
        );
        assert_eq!(
            archive.affinity.len(),
            usize::from(options.include_affinity)
        );
        assert_eq!(
            archive.messages.len(),
            if options.include_messages { 2 } else { 0 }
        );
        assert_eq!(archive.people.len(), 1);
        assert_eq!(archive.people[0].name, "민수");
        assert!(!json.contains("B만 알고"));
        assert!(!json.contains("나는 함께 마실게"));
        assert!(!json.contains("builtin-a"));
        assert!(!json.contains("builtin-b"));
        assert!(archive
            .messages
            .iter()
            .all(|message| message.characters.len() == 1));
    }
    let default: ExportOptions = serde_json::from_str("{}").unwrap();
    assert!(default.include_sprites);
    assert!(!default.includes_archive());
    let cloned = clone_character(&conn, "builtin-a").unwrap();
    assert_eq!(
        conn.query_row(
            "SELECT COUNT(*) FROM memories WHERE character_id=?1",
            [cloned.id],
            |row| row.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
}

#[test]
fn story_experience_roundtrip_preserves_zero_and_private_chapter_gates() {
    let donor = database();
    let character = import_pack(&donor, &nadir_pack()).unwrap().remove(0);
    let person = store::active_user_id(&donor).unwrap();
    let at = chrono::Utc::now().timestamp_millis();
    for chapter in [0, 2] {
        store::insert_experience(
            &donor,
            &character.id,
            &person,
            &format!("story:chapter-{chapter}"),
            &format!("이야기 {chapter}: 이야기를 듣기로 했다."),
            "이야기를 들을까? 들어 볼게. 함께 이야기했다.",
            at,
            Some(chapter),
        )
        .unwrap();
    }
    let options = ExportOptions {
        include_memories: true,
        ..Default::default()
    };
    let pack = export_pack_with_options(&donor, &[character.id], &[], &options).unwrap();
    let pack = parse_pack(&pack_json(&pack).unwrap()).unwrap();
    let receiver = database();
    let character = import_pack(&receiver, &pack).unwrap().remove(0);
    apply_roster(&receiver, vec![character.id.clone()]).unwrap();
    let now = chrono::Utc::now().timestamp_millis();
    let recall = store::idle_memories(&receiver, now).unwrap();
    assert_eq!(recall.len(), 1);
    assert_eq!(recall[0].content, "이야기 0: 이야기를 듣기로 했다.");
    assert_eq!(count(&receiver, "story_answers"), 0);

    let forwarded = export_pack_with_options(
        &receiver,
        std::slice::from_ref(&character.id),
        &[],
        &options,
    )
    .unwrap();
    let mut chapters = forwarded
        .archive
        .unwrap()
        .memories
        .iter()
        .map(|memory| memory.required_chapter)
        .collect::<Vec<_>>();
    chapters.sort();
    assert_eq!(chapters, vec![Some(0), Some(2)]);

    let current = store::active_user_id(&receiver).unwrap();
    receiver.execute("INSERT INTO character_affinity(source,character_id,day,delta,fingerprint,user_id) VALUES('earned',?1,'today',60,'earned',?2)",params![character.id,current]).unwrap();
    for chapter in 0..2 {
        for index in 0..5 {
            let id = format!("receiver-{chapter}-{index}");
            receiver.execute("INSERT INTO story_answers(request_id,character_id,scene_id,chapter,choice_id,user_id) VALUES(?1,?2,?1,?3,'listen',?4)",params![id,character.id,chapter,current]).unwrap();
        }
    }
    assert_eq!(store::idle_memories(&receiver, now).unwrap().len(), 2);
    for invalid_chapter in [-1, 101] {
        let mut invalid = pack.clone();
        invalid.archive.as_mut().unwrap().memories[0].required_chapter = Some(invalid_chapter);
        assert!(parse_pack(&serde_json::to_string(&invalid).unwrap()).is_err());
    }
}

#[test]
fn import_never_merges_same_name_or_feeds_history_and_affinity_into_current_user() {
    let donor = donor();
    let pack = export_pack_with_options(&donor, &["builtin-a".into()], &[], &all()).unwrap();
    let receiver = database();
    let active = store::active_user_id(&receiver).unwrap();
    let original = store::user_identity(&donor, &store::active_user_id(&donor).unwrap())
        .unwrap()
        .unwrap();
    assert!(original.ended_at.is_none());
    let first = import_pack(&receiver, &pack).unwrap().remove(0);
    let second = import_pack(&receiver, &pack).unwrap().remove(0);
    assert_ne!(first.id, second.id);
    assert_eq!(store::active_user_id(&receiver).unwrap(), active);
    let owners: Vec<String> = receiver
        .prepare("SELECT user_id FROM memories ORDER BY rowid")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    assert_eq!(owners.len(), 2);
    assert_ne!(owners[0], owners[1]);
    assert!(owners.iter().all(|owner| *owner != active));
    assert_eq!(count(&receiver, "messages"), 0);
    assert_eq!(count(&receiver, "memory_analysis_jobs"), 0);
    assert_eq!(count(&receiver, "character_archived_messages"), 4);
    apply_roster(&receiver, vec![first.id.clone()]).unwrap();
    assert_eq!(store::relationships(&receiver).unwrap()[0].score, 20);
    assert!(store::context_messages_for(&receiver, 24, &first.id)
        .unwrap()
        .is_empty());
    let metadata: String = receiver
        .query_row(
            "SELECT data FROM character_packs WHERE id=?1",
            [first.pack_id.unwrap()],
            |row| row.get(0),
        )
        .unwrap();
    assert!(!metadata.contains("녹차"));
    assert!(!metadata.contains("archive"));
}

#[test]
fn repeated_transfers_preserve_memory_age_and_forgetting_cannot_recover_from_pack_metadata() {
    let donor = donor();
    let mut pack = export_pack_with_options(&donor, &["builtin-a".into()], &[], &all()).unwrap();
    let original = pack.archive.as_mut().unwrap();
    let ended = original.exported_at - 1000;
    original.people[0].ended_at = ended;
    let updated = original.memories[0].updated_at;
    let receiver = database();
    let character = import_pack(&receiver, &pack).unwrap().remove(0);
    let again =
        export_pack_with_options(&receiver, std::slice::from_ref(&character.id), &[], &all())
            .unwrap();
    let archive = again.archive.as_ref().unwrap();
    let memory = &archive.memories[0];
    assert_eq!(memory.updated_at, updated);
    assert_eq!(
        archive
            .people
            .iter()
            .find(|person| person.id == memory.person_id)
            .unwrap()
            .ended_at,
        ended
    );
    let next = database();
    let next_character = import_pack(&next, &again).unwrap().remove(0);
    let once_more = export_pack_with_options(&next, &[next_character.id], &[], &all()).unwrap();
    let last = once_more.archive.unwrap();
    assert_eq!(
        last.people
            .iter()
            .find(|p| p.id == last.memories[0].person_id)
            .unwrap()
            .ended_at,
        ended
    );
    let memory_id: String = receiver
        .query_row(
            "SELECT id FROM memories WHERE character_id=?1",
            [&character.id],
            |row| row.get(0),
        )
        .unwrap();
    store::delete_memory(&receiver, &memory_id).unwrap();
    let forgotten = export_pack_with_options(&receiver, &[character.id], &[], &all()).unwrap();
    assert!(forgotten.archive.as_ref().unwrap().memories.is_empty());
    assert_eq!(forgotten.archive.as_ref().unwrap().messages.len(), 2);
    let third = database();
    import_pack(&third, &forgotten).unwrap();
    assert_eq!(count(&third, "memories"), 0);
    assert_eq!(count(&third, "memory_analysis_jobs"), 0);
}

#[test]
fn imported_expired_memories_stay_archived_and_cannot_be_exported_as_recallable() {
    let donor = donor();
    let mut pack = export_pack_with_options(&donor, &["builtin-a".into()], &[], &all()).unwrap();
    let old = chrono::Utc::now().timestamp_millis() - store::MEMORY_LIFETIME_MILLIS - 10_000;
    let archive = pack.archive.as_mut().unwrap();
    archive.exported_at = old;
    archive.people[0].started_at = old - 10_000;
    archive.people[0].ended_at = old;
    for memory in &mut archive.memories {
        memory.updated_at = old - 1000;
        memory.source_created_at = old - 1000;
    }
    for message in &mut archive.messages {
        message.created_at = old - 1000;
    }
    let receiver = database();
    let character = import_pack(&receiver, &pack).unwrap().remove(0);
    assert_eq!(count(&receiver, "memories"), 1);
    assert_eq!(
        receiver
            .query_row("SELECT expired FROM memories", [], |row| row
                .get::<_, i32>(0))
            .unwrap(),
        1
    );
    let exported = export_pack_with_options(&receiver, &[character.id], &[], &all()).unwrap();
    assert!(exported.archive.unwrap().memories.is_empty());
}

#[test]
fn invalid_archive_and_late_storage_failure_never_partially_install() {
    let donor = donor();
    let pack = export_pack_with_options(&donor, &["builtin-a".into()], &[], &all()).unwrap();
    let receiver = database();
    let before = (
        count(&receiver, "characters"),
        count(&receiver, "user_identities"),
        count(&receiver, "character_packs"),
    );
    let mut invalid = pack.clone();
    invalid.archive.as_mut().unwrap().memories[0].person_id = "missing".into();
    assert!(import_pack(&receiver, &invalid).is_err());
    invalid = pack.clone();
    invalid.format_version = 3;
    assert!(import_pack(&receiver, &invalid).is_err());
    invalid = pack.clone();
    invalid.archive.as_mut().unwrap().memories[0].content = "x".repeat(MAX_PACK_BYTES + 1);
    assert!(import_pack(&receiver, &invalid).is_err());
    assert!(parse_pack(&" ".repeat(MAX_PACK_BYTES + 1)).is_err());
    invalid = pack.clone();
    let prototype = invalid.archive.as_ref().unwrap().messages[0].clone();
    invalid.archive.as_mut().unwrap().messages = (0..4300)
        .map(|index| {
            let mut message = prototype.clone();
            message.id = format!("large-{index}");
            message.content = "x".repeat(8000);
            message
        })
        .collect();
    assert!(import_pack(&receiver, &invalid)
        .unwrap_err()
        .contains("32 MiB"));
    receiver.execute_batch("CREATE TRIGGER fail_archive BEFORE INSERT ON character_archived_messages BEGIN SELECT RAISE(ABORT,'archive write failed'); END;").unwrap();
    assert!(import_pack(&receiver, &pack).is_err());
    assert_eq!(
        (
            count(&receiver, "characters"),
            count(&receiver, "user_identities"),
            count(&receiver, "character_packs")
        ),
        before
    );
    assert_eq!(count(&receiver, "memories"), 0);
    assert_eq!(count(&receiver, "character_affinity"), 0);
}

#[test]
fn image_toggle_removes_animation_references_and_preserves_donor_assets() {
    use crate::character_animation::{Bindings, Clip, Frame};
    let conn = database();
    let asset = animation::prepare_png(animation::png_fixture(2, 2, 255, false)).unwrap();
    let mut definition = get(&conn, "builtin-a").unwrap().definition;
    definition.animation = Some(Animation {
        clips: vec![Clip {
            id: "idle".into(),
            name: "가만히".into(),
            fps: 6,
            frames: vec![Frame {
                asset_id: asset.asset_id.clone(),
                x: 0,
                y: 0,
                width: 2,
                height: 2,
            }],
        }],
        bindings: Bindings::default(),
        overrides: BTreeMap::new(),
    });
    save_with_assets(
        &conn,
        "builtin-a",
        &definition,
        std::slice::from_ref(&asset),
    )
    .unwrap();
    set_sprite(&conn, "builtin-a", DEFAULT_EXPRESSION, &asset.bytes).unwrap();
    let included = export_pack(&conn, &["builtin-a".into()], &[]).unwrap();
    assert_eq!(included.format_version, 3);
    assert_eq!(included.animation_assets.len(), 1);
    assert_eq!(included.sprites.len(), 1);
    let options = ExportOptions {
        include_sprites: false,
        ..Default::default()
    };
    let excluded = export_pack_with_options(&conn, &["builtin-a".into()], &[], &options).unwrap();
    assert_eq!(excluded.format_version, 2);
    assert!(excluded.animation_assets.is_empty());
    assert!(excluded.sprites.is_empty());
    assert!(excluded.characters[0].animation.is_none());
    parse_pack(&pack_json(&excluded).unwrap()).unwrap();
    assert_eq!(
        get(&conn, "builtin-a").unwrap().definition.animation,
        definition.animation
    );
    assert_eq!(animation::all(&conn, "builtin-a").unwrap().len(), 1);
    let cloned = clone_character(&conn, "builtin-a").unwrap();
    assert_eq!(count(&conn, "memories"), 0);
    assert!(get(&conn, &cloned.id)
        .unwrap()
        .definition
        .animation
        .is_some());
}
