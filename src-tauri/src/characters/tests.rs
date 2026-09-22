use super::*;
const PNG: &[u8] = b"\x89PNG\r\n\x1a\n-body";
fn database() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    initialize_for_tests(&conn).unwrap();
    conn
}
fn pack() -> CharacterPack {
    CharacterPack {
        format_version: 1,
        name: "두 친구".into(),
        author: "제작자".into(),
        source_url: String::new(),
        license: "수정·공유 가능".into(),
        characters: vec![builtin("a"), builtin("b")],
        pair_scenes: vec![vec![
            SceneLine {
                persona: "a".into(),
                expression: "평온".into(),
                text: "  원문\n그대로  ".into(),
            },
            SceneLine {
                persona: "b".into(),
                expression: "장난".into(),
                text: "응.".into(),
            },
        ]],
        wordbook: vec![WordbookEntry {
            id: uuid::Uuid::new_v4().to_string(),
            title: "인사".into(),
            keywords: vec!["HELLO".into()],
            lines: vec![SceneLine {
                persona: "b".into(),
                expression: "기쁨".into(),
                text: "  안녕\n반가워  ".into(),
            }],
            enabled: true,
            use_for_idle: false,
        }],
        sprites: Vec::new(),
    }
}
#[test]
fn fresh_install_starts_with_byulkkori_alone_as_a_removable_pack() {
    let conn = Connection::open_in_memory().unwrap();
    initialize(&conn).unwrap();
    let current = collection(&conn).unwrap();
    assert_eq!(current.installed.len(), 1);
    let only = &current.installed[0];
    assert_eq!(current.active, std::slice::from_ref(&only.id));
    assert_eq!(only.definition.name, "별꼬리");
    assert!(only.pack_id.is_some(), "installed as an ordinary pack");
    assert_eq!(only.sprites.len(), 9);
    assert!(only.definition.face_icon);
    let idle = idle_scene(&conn, 0).unwrap();
    assert_eq!(idle.len(), 1);
    assert_eq!(idle[0].persona, "a");
    assert!(!idle[0].text.contains("나디르"));
    assert_eq!(greeting(&conn, "a").unwrap().len(), 1);
    // Restart keeps the same single character and does not add A/B.
    initialize(&conn).unwrap();
    assert_eq!(collection(&conn).unwrap().installed.len(), 1);
    // The default is removable once another friend is present.
    let other = create(&conn, &builtin("a")).unwrap();
    apply_roster(&conn, vec![other.id.clone()]).unwrap();
    remove(&conn, &only.id).unwrap();
    assert_eq!(collection(&conn).unwrap().installed.len(), 1);
    initialize(&conn).unwrap();
    assert_eq!(collection(&conn).unwrap().active, [other.id]);
}

#[test]
fn legacy_factory_pair_keeps_a_and_b_and_local_dialogue() {
    let conn = database();
    let current = collection(&conn).unwrap();
    assert_eq!(current.active, ["builtin-a", "builtin-b"]);
    assert_eq!(current.installed.len(), 2);
    for (slot, name) in [("a", "A"), ("b", "B")] {
        let character = active_character(&conn, slot).unwrap();
        assert_eq!(character.definition.source_id, format!("builtin-{slot}"));
        assert_eq!(character.definition.name, name);
        assert!(character.pack_id.is_none());
        assert!(!greeting(&conn, slot).unwrap().is_empty());
    }
    let idle = idle_scene(&conn, 0).unwrap();
    assert_eq!(idle.len(), 2);
    for line in idle {
        assert!(!line.text.contains("나디르"));
        assert!(!line.text.contains("별꼬리"));
    }
}

#[test]
fn addon_keeps_public_profiles_and_greeting_alternatives_after_import() {
    let pack = nadir_pack();
    assert_eq!(pack.pair_scenes.len(), 5);
    for character in &pack.characters {
        assert_eq!(character.greeting.len(), 5);
        assert!(character.idle_lines.len() >= 5);
        let public = serde_json::to_string(character).unwrap();
        for secret in ["불로불사", "악마", "리치", "수명", "소환 사고"] {
            assert!(!public.contains(secret), "public profile exposed {secret}");
        }
    }
    let conn = database();
    let imported = import_pack(&conn, &pack).unwrap();
    assert_eq!(active_ids(&conn).unwrap(), ["builtin-a", "builtin-b"]);
    apply_pair(&conn, [imported[0].id.clone(), imported[1].id.clone()]).unwrap();
    for (index, slot) in ["a", "b"].iter().enumerate() {
        for _ in 0..20 {
            let lines = greeting(&conn, slot).unwrap();
            assert_eq!(lines.len(), 1);
            assert!(pack.characters[index]
                .greeting
                .iter()
                .any(|line| line.text == lines[0].text));
        }
    }
    let mut edited = imported[0].definition.clone();
    edited.greeting = vec![
        CharacterLine {
            expression: "평온".into(),
            text: "첫 줄".into(),
        },
        CharacterLine {
            expression: "평온".into(),
            text: "둘째 줄".into(),
        },
    ];
    save(&conn, &imported[0].id, &edited).unwrap();
    assert_eq!(greeting(&conn, "a").unwrap().len(), 2);
}

#[test]
fn initialization_preserves_existing_addon_characters_and_personal_data() {
    let conn = crate::store::open(std::path::Path::new(":memory:")).unwrap();
    let pack = nadir_pack();
    for (slot, definition) in ["a", "b"].iter().zip(&pack.characters) {
        conn.execute(
            "UPDATE characters SET data=?1 WHERE id=?2",
            params![
                serde_json::to_string(definition).unwrap(),
                format!("builtin-{slot}")
            ],
        )
        .unwrap();
    }
    conn.execute_batch(
        "INSERT INTO memories(id,content,source,updated,deleted,locked) VALUES('memory','기억 원문','source',123,0,0);
        INSERT INTO character_affinity VALUES('source','builtin-a','2026-09-20',5,'fingerprint');
        ",
    )
    .unwrap();
    crate::store::insert_message(
        &conn,
        &crate::types::Message {
            id: "message".into(),
            role: "assistant".into(),
            persona: Some("a".into()),
            content: "  이전 대화\n원문  ".into(),
            expression: Some("평온".into()),
            created_at: 123,
            status: "complete".into(),
        },
    )
    .unwrap();
    let mut edited = builtin("b");
    edited.name = "내가 고친 친구".into();
    let custom = create(&conn, &edited).unwrap();
    let before = serde_json::to_string(&collection(&conn).unwrap()).unwrap();
    initialize_for_tests(&conn).unwrap();
    assert_eq!(
        serde_json::to_string(&collection(&conn).unwrap()).unwrap(),
        before
    );
    assert_eq!(
        serde_json::to_value(idle_scene(&conn, 0).unwrap()).unwrap(),
        serde_json::to_value(&pack.pair_scenes[0]).unwrap()
    );
    assert_eq!(greeting(&conn, "a").unwrap().len(), 1);
    assert_eq!(
        crate::store::messages(&conn, 10).unwrap()[0].content,
        "  이전 대화\n원문  "
    );
    assert_eq!(
        crate::store::memories(&conn).unwrap()[0].content,
        "기억 원문"
    );
    assert_eq!(crate::store::relationships(&conn).unwrap()[0].score, 25);
    assert_eq!(
        crate::store::message_identities(&conn, 10).unwrap()[0].name,
        "나디르"
    );
    assert_eq!(get(&conn, &custom.id).unwrap().definition, edited);
    remove(&conn, "builtin-b").unwrap();
    initialize_for_tests(&conn).unwrap();
    assert!(get(&conn, "builtin-b").is_err());
    assert_eq!(active_ids(&conn).unwrap(), ["builtin-a"]);
}

#[test]
fn factory_expression_migration_preserves_customizations_and_installed_identity() {
    let conn = database();
    let old_maps: [BTreeMap<String, String>; 2] = serde_json::from_str(r#"[
            {"평온":"안경을 고쳐 쓰는 나디르","기쁨":"조금 웃는 나디르","호기심":"한쪽 눈썹을 올린 나디르","생각중":"음절을 짚는 나디르","걱정":"말끝을 고르는 나디르","장난":"작게 웃음을 참는 나디르"},
            {"평온":"꼬리를 살랑이는 별꼬리","기쁨":"폴짝 웃는 별꼬리","호기심":"고개를 갸웃한 별꼬리","생각중":"꼬리를 동그랗게 만 별꼬리","걱정":"살짝 처진 별꼬리","장난":"한쪽 눈을 찡긋한 별꼬리"}
        ]"#).unwrap();
    let mut old_pack = nadir_pack();
    for (index, definition) in old_pack.characters.iter_mut().enumerate() {
        definition.expressions = old_maps[index].clone();
        conn.execute(
            "UPDATE characters SET data=?1 WHERE id=?2",
            params![
                serde_json::to_string(definition).unwrap(),
                ["builtin-a", "builtin-b"][index]
            ],
        )
        .unwrap();
    }
    let imported = import_pack(&conn, &old_pack).unwrap();
    let mut named = imported[0].definition.clone();
    named.name = "내가 지은 이름".into();
    named.personality = "사용자 성격 원문".into();
    save(&conn, &imported[0].id, &named).unwrap();
    let named = get(&conn, &imported[0].id).unwrap();
    let mut edited = imported[1].definition.clone();
    edited.expressions.insert("기쁨".into(), "내 표정".into());
    save(&conn, &imported[1].id, &edited).unwrap();
    let edited = get(&conn, &imported[1].id).unwrap();
    let mut unrelated = old_pack.characters[0].clone();
    unrelated.source_id = "another-character".into();
    let unrelated = create(&conn, &unrelated).unwrap();
    initialize_for_tests(&conn).unwrap();
    for (index, slot) in ["a", "b"].iter().enumerate() {
        assert_eq!(
            get(&conn, &format!("builtin-{slot}")).unwrap().definition,
            nadir_pack().characters[index]
        );
    }
    assert_eq!(
        dialogue(&conn, &["builtin-a".into(), "builtin-b".into()])
            .unwrap()
            .pair_scenes
            .len(),
        nadir_pack().pair_scenes.len()
    );
    let migrated = get(&conn, &named.id).unwrap();
    let mut expected = named.definition;
    expected.expressions = builtin("a").expressions;
    assert_eq!(migrated.id, named.id);
    assert_eq!(migrated.pack_id, named.pack_id);
    assert_eq!(migrated.definition, expected);
    assert_eq!(
        get(&conn, &edited.id).unwrap().definition,
        edited.definition
    );
    assert_eq!(
        get(&conn, &unrelated.id).unwrap().definition,
        unrelated.definition
    );
    assert_eq!(active_ids(&conn).unwrap(), ["builtin-a", "builtin-b"]);
    let before = serde_json::to_string(&collection(&conn).unwrap()).unwrap();
    initialize_for_tests(&conn).unwrap();
    assert_eq!(
        serde_json::to_string(&collection(&conn).unwrap()).unwrap(),
        before
    );
}

#[test]
fn mutations_participate_in_outer_transaction_rollback() {
    let conn = database();
    {
        let tx = conn.unchecked_transaction().unwrap();
        let imported = import_pack(&tx, &pack()).unwrap();
        apply_pair(&tx, [imported[0].id.clone(), imported[1].id.clone()]).unwrap();
        remove(&tx, &imported[0].id).unwrap();
        assert_eq!(collection(&tx).unwrap().installed.len(), 3);
    }
    assert_eq!(collection(&conn).unwrap().installed.len(), 2);
    assert_eq!(active_ids(&conn).unwrap(), ["builtin-a", "builtin-b"]);
}
#[test]
fn import_is_atomic_separate_and_does_not_activate() {
    let conn = database();
    let source = pack();
    let first = import_pack(&conn, &source).unwrap();
    let second = import_pack(&conn, &source).unwrap();
    assert_ne!(first[0].id, second[0].id);
    assert_ne!(first[0].id, "builtin-a");
    assert_eq!(active_ids(&conn).unwrap(), ["builtin-a", "builtin-b"]);
    let mut invalid = source;
    invalid.characters[1].name.clear();
    assert!(import_pack(&conn, &invalid).is_err());
    assert_eq!(collection(&conn).unwrap().installed.len(), 6);
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM character_packs", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        2
    );
}
#[test]
fn installed_packs_keep_original_member_order_and_separate_local_copies() {
    let conn = database();
    create(&conn, &builtin("a")).unwrap();
    assert!(installed_packs(&conn).unwrap().is_empty());
    let first = import_pack(&conn, &pack()).unwrap();
    let second = import_pack(&conn, &pack()).unwrap();
    let cloned = clone_character(&conn, &first[0].id).unwrap();
    apply_roster(&conn, vec![first[1].id.clone(), first[0].id.clone()]).unwrap();
    let packs = installed_packs(&conn).unwrap();
    assert_eq!(packs.len(), 3);
    assert_eq!(packs[0].id, first[0].pack_id.as_deref().unwrap());
    assert_eq!(packs[0].name, "두 친구");
    assert_eq!(
        packs[0].character_ids,
        [first[0].id.clone(), first[1].id.clone()]
    );
    assert_eq!(packs[1].id, second[0].pack_id.as_deref().unwrap());
    assert_eq!(packs[1].name, packs[0].name);
    assert_eq!(
        packs[1].character_ids,
        [second[0].id.clone(), second[1].id.clone()]
    );
    assert_eq!(packs[2].id, cloned.pack_id.as_deref().unwrap());
    assert_eq!(packs[2].character_ids, [cloned.id]);
}
#[test]
fn pack_selection_resolves_remaining_members_and_never_restores_removed_characters() {
    let conn = database();
    let imported = import_pack(&conn, &pack()).unwrap();
    let selected = installed_packs(&conn).unwrap().remove(0);
    remove(&conn, &imported[0].id).unwrap();
    let mut edited = imported[1].definition.clone();
    edited.name = "내가 고친 친구".into();
    save(&conn, &imported[1].id, &edited).unwrap();
    apply_pack(&conn, &selected.id).unwrap();
    assert_eq!(active_ids(&conn).unwrap(), [imported[1].id.clone()]);
    assert_eq!(
        installed_packs(&conn).unwrap()[0].character_ids,
        [imported[1].id.clone()]
    );
    assert_eq!(
        active_character(&conn, "a").unwrap().definition.name,
        "내가 고친 친구"
    );
    assert!(get(&conn, &imported[0].id).is_err());
    assert!(apply_pack(&conn, "missing-pack").is_err());
    assert_eq!(active_ids(&conn).unwrap(), [imported[1].id.clone()]);
    apply_roster(&conn, vec!["builtin-a".into()]).unwrap();
    remove(&conn, &imported[1].id).unwrap();
    assert!(installed_packs(&conn).unwrap().is_empty());
    assert!(apply_pack(&conn, &selected.id).is_err());
    assert_eq!(active_ids(&conn).unwrap(), ["builtin-a"]);
    conn.execute(
        "INSERT INTO character_packs(id,data,members) VALUES('empty-pack',?1,'[]')",
        [serde_json::to_string(&pack()).unwrap()],
    )
    .unwrap();
    assert!(installed_packs(&conn).unwrap().is_empty());
    assert!(apply_pack(&conn, "empty-pack").is_err());
    assert_eq!(active_ids(&conn).unwrap(), ["builtin-a"]);
}
#[test]
fn database_failure_rolls_back_entire_import() {
    let conn = database();
    conn.execute_batch("CREATE TRIGGER reject_second BEFORE INSERT ON characters WHEN json_extract(NEW.data,'$.sourceId')='builtin-b' BEGIN SELECT RAISE(ABORT,'test failure'); END;").unwrap();
    assert!(import_pack(&conn, &pack()).is_err());
    assert_eq!(collection(&conn).unwrap().installed.len(), 2);
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM character_packs", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
}
#[test]
fn swapped_pair_maps_exact_text_and_replacement_disables_pack_content() {
    let conn = database();
    let imported = import_pack(&conn, &pack()).unwrap();
    apply_pair(&conn, [imported[1].id.clone(), imported[0].id.clone()]).unwrap();
    let idle = idle_scene(&conn, 0).unwrap();
    assert_eq!(idle[0].persona, "b");
    assert_eq!(idle[0].text, "  원문\n그대로  ");
    let matched = keyword_scene(&conn, "hello!").unwrap().unwrap();
    assert_eq!(matched[0].persona, "a");
    assert_eq!(matched[0].text, "  안녕\n반가워  ");
    assign(&conn, "a", "builtin-a").unwrap();
    assert!(keyword_scene(&conn, "hello").unwrap().is_none());
    assert!(!idle_scene(&conn, 0)
        .unwrap()
        .iter()
        .any(|l| l.text.contains("원문")));
}
#[test]
fn edit_preserves_identity_and_increments_host_version() {
    let conn = database();
    let created = clone_character(&conn, "builtin-a").unwrap();
    assign(&conn, "a", &created.id).unwrap();
    let mut edited = created.definition.clone();
    edited.name = "새 이름".into();
    edited.version = 900;
    edited.source_id = "steal".into();
    save(&conn, &created.id, &edited).unwrap();
    let current = active_character(&conn, "a").unwrap();
    assert_eq!(current.id, created.id);
    assert_eq!(current.definition.version, created.definition.version + 1);
    assert_eq!(current.definition.source_id, "builtin-a");
    let copy = clone_character(&conn, &created.id).unwrap();
    assert_ne!(copy.id, created.id);
    assert!(assign(&conn, "b", &created.id).is_err());
    assert_eq!(active_character(&conn, "b").unwrap().id, "builtin-b");
}

#[test]
fn legacy_character_json_defaults_to_empty_instructions_and_relationships() {
    for version in [1, 2] {
        let mut legacy = pack();
        legacy.format_version = version;
        let mut value: serde_json::Value =
            serde_json::from_str(&pack_json(&legacy).unwrap()).unwrap();
        for definition in value["characters"].as_array_mut().unwrap() {
            let fields = definition.as_object_mut().unwrap();
            fields.remove("instructions");
            fields.remove("relationships");
        }
        let parsed = parse_pack(&value.to_string()).unwrap();
        assert!(parsed.characters.iter().all(|definition| {
            definition.instructions.is_empty() && definition.relationships.is_empty()
        }));
        let conn = database();
        let installed = import_pack(&conn, &parsed).unwrap();
        assert!(installed.iter().all(|character| {
            character.definition.instructions.is_empty()
                && character.definition.relationships.is_empty()
        }));
    }
}

#[test]
fn authored_instructions_and_directional_relationships_preserve_local_identity() {
    let conn = crate::store::open(std::path::Path::new(":memory:")).unwrap();
    conn.execute_batch(
        "INSERT INTO memories(id,content,source,updated,deleted,locked) VALUES('memory','기억 원문','source',123,0,0);
        INSERT INTO character_affinity VALUES('source','builtin-a','2026-09-22',5,'fingerprint');",
    )
    .unwrap();
    crate::store::insert_message(
        &conn,
        &crate::types::Message {
            id: "message".into(),
            role: "assistant".into(),
            persona: Some("a".into()),
            content: "  이전 대화\n원문  ".into(),
            expression: Some("평온".into()),
            created_at: 123,
            status: "complete".into(),
        },
    )
    .unwrap();
    let original = get(&conn, "builtin-a").unwrap();
    let mut definition = original.definition.clone();
    definition.instructions = "  질문부터 듣고\n짧게 답한다.  ".into();
    definition.relationships = vec![CharacterRelationship {
        target_id: "builtin-b".into(),
        description: "  B는 오래된 친구.\n가끔 장난친다.  ".into(),
    }];
    save(&conn, &original.id, &definition).unwrap();
    apply_pair(&conn, ["builtin-b".into(), "builtin-a".into()]).unwrap();
    let saved = active_character(&conn, "b").unwrap();
    assert_eq!(saved.id, original.id);
    assert_eq!(saved.definition.source_id, original.definition.source_id);
    assert_eq!(saved.definition.version, original.definition.version + 1);
    assert_eq!(saved.definition.instructions, definition.instructions);
    assert_eq!(saved.definition.relationships, definition.relationships);
    assert!(get(&conn, "builtin-b")
        .unwrap()
        .definition
        .relationships
        .is_empty());
    initialize_for_tests(&conn).unwrap();
    assert_eq!(
        get(&conn, "builtin-a").unwrap().definition,
        saved.definition
    );
    assert_eq!(crate::store::relationships(&conn).unwrap()[1].score, 25);
    assert_eq!(
        crate::store::messages(&conn, 10).unwrap()[0].content,
        "  이전 대화\n원문  "
    );
    assert_eq!(
        crate::store::message_identities(&conn, 10).unwrap()[0].character_id,
        original.id
    );
    assert_eq!(
        conn.query_row(
            "SELECT content FROM memories WHERE id='memory'",
            [],
            |row| { row.get::<_, String>(0) }
        )
        .unwrap(),
        "기억 원문"
    );
}

#[test]
fn local_relationship_validation_rejects_new_missing_self_and_duplicate_targets() {
    let conn = database();
    let original = get(&conn, "builtin-a").unwrap().definition;
    let mut invalid = original.clone();
    invalid.instructions = "가".repeat(2001);
    assert!(save(&conn, "builtin-a", &invalid).is_err());
    invalid = original.clone();
    invalid.relationships = vec![CharacterRelationship {
        target_id: "missing".into(),
        description: "친구".into(),
    }];
    assert!(create(&conn, &invalid).is_err());
    assert!(save(&conn, "builtin-a", &invalid).is_err());
    invalid.relationships[0].target_id = "builtin-a".into();
    assert!(save(&conn, "builtin-a", &invalid).is_err());
    invalid.relationships[0].target_id = "builtin-b".into();
    invalid.relationships[0].description = " \n ".into();
    assert!(save(&conn, "builtin-a", &invalid).is_err());
    invalid.relationships[0].description = "가".repeat(501);
    assert!(save(&conn, "builtin-a", &invalid).is_err());
    invalid.relationships[0].description = "친구".into();
    invalid.relationships.push(invalid.relationships[0].clone());
    assert!(save(&conn, "builtin-a", &invalid).is_err());
    assert_eq!(get(&conn, "builtin-a").unwrap().definition, original);
    let mut valid = original;
    valid.instructions = "가".repeat(2000);
    valid.relationships = vec![CharacterRelationship {
        target_id: "builtin-b".into(),
        description: "가".repeat(500),
    }];
    save(&conn, "builtin-a", &valid).unwrap();
    assert_eq!(
        get(&conn, "builtin-a").unwrap().definition.instructions,
        valid.instructions
    );
    let targets: Vec<_> = (0..33)
        .map(|_| create(&conn, &builtin("b")).unwrap())
        .collect();
    valid.relationships = targets[..32]
        .iter()
        .map(|target| CharacterRelationship {
            target_id: target.id.clone(),
            description: "친구".into(),
        })
        .collect();
    save(&conn, "builtin-a", &valid).unwrap();
    valid.relationships.push(CharacterRelationship {
        target_id: targets[32].id.clone(),
        description: "친구".into(),
    });
    assert!(save(&conn, "builtin-a", &valid).is_err());
    assert_eq!(
        get(&conn, "builtin-a")
            .unwrap()
            .definition
            .relationships
            .len(),
        32
    );
}

#[test]
fn removed_relationship_targets_remain_editable_and_clones_keep_outgoing_relations() {
    let conn = database();
    let target = clone_character(&conn, "builtin-b").unwrap();
    let mut definition = builtin("a");
    definition.instructions = "천천히 말한다.".into();
    definition.relationships = vec![CharacterRelationship {
        target_id: target.id.clone(),
        description: "아끼는 동생".into(),
    }];
    save(&conn, "builtin-a", &definition).unwrap();
    let cloned = clone_character(&conn, "builtin-a").unwrap();
    assert_eq!(cloned.definition.relationships, definition.relationships);
    assert_eq!(cloned.definition.instructions, definition.instructions);
    remove(&conn, &target.id).unwrap();
    definition.name = "이름을 바꾼 A".into();
    save(&conn, "builtin-a", &definition).unwrap();
    assert_eq!(
        get(&conn, "builtin-a").unwrap().definition.relationships,
        definition.relationships
    );
    let cloned_missing = clone_character(&conn, "builtin-a").unwrap();
    assert_eq!(
        cloned_missing.definition.relationships,
        definition.relationships
    );
    assert!(create(&conn, &definition).is_err());
    definition.relationships.clear();
    save(&conn, "builtin-a", &definition).unwrap();
    assert!(get(&conn, "builtin-a")
        .unwrap()
        .definition
        .relationships
        .is_empty());
}

#[test]
fn relationship_pack_roundtrip_remaps_local_ids_without_crossing_reimports() {
    let conn = database();
    let first = clone_character(&conn, "builtin-a").unwrap();
    let second = clone_character(&conn, "builtin-a").unwrap();
    let mut first_definition = first.definition.clone();
    first_definition.instructions = "  지침\n원문  ".into();
    first_definition.relationships = vec![
        CharacterRelationship {
            target_id: second.id.clone(),
            description: "둘째에게만 다정하다.".into(),
        },
        CharacterRelationship {
            target_id: "builtin-b".into(),
            description: "팩 밖 친구".into(),
        },
    ];
    save(&conn, &first.id, &first_definition).unwrap();
    let mut second_definition = second.definition.clone();
    second_definition.relationships = vec![CharacterRelationship {
        target_id: first.id.clone(),
        description: "첫째를 존경한다.".into(),
    }];
    save(&conn, &second.id, &second_definition).unwrap();
    let exported = export_pack(&conn, &[second.id.clone(), first.id.clone()], &[]).unwrap();
    assert_eq!(exported.characters[0].source_id, "character-1");
    assert_eq!(
        exported.characters[0].relationships[0].target_id,
        "character-2"
    );
    assert_eq!(exported.characters[1].relationships.len(), 1);
    assert_eq!(
        exported.characters[1].relationships[0].target_id,
        "character-1"
    );
    let single = export_pack(&conn, std::slice::from_ref(&first.id), &[]).unwrap();
    assert!(single.characters[0].relationships.is_empty());
    let mut parsed = parse_pack(&pack_json(&exported).unwrap()).unwrap();
    parsed.characters.reverse();
    let imported = import_pack(&conn, &parsed).unwrap();
    let reimported = import_pack(&conn, &parsed).unwrap();
    assert_eq!(
        imported[0].definition.instructions,
        first_definition.instructions
    );
    for members in [&imported, &reimported] {
        assert_eq!(
            members[0].definition.relationships[0].target_id,
            members[1].id
        );
        assert_eq!(
            members[1].definition.relationships[0].target_id,
            members[0].id
        );
    }
    assert_ne!(imported[0].id, reimported[0].id);
    assert_eq!(
        get(&conn, &first.id).unwrap().definition.relationships,
        first_definition.relationships
    );
}

#[test]
fn relationship_packs_reject_missing_self_unknown_and_excessive_relationships() {
    let conn = database();
    let mut content = pack();
    content.characters[0].relationships = vec![CharacterRelationship {
        target_id: "not-in-pack".into(),
        description: "친구".into(),
    }];
    assert!(import_pack(&conn, &content).is_err());
    content.characters[0].relationships[0].target_id = content.characters[0].source_id.clone();
    assert!(import_pack(&conn, &content).is_err());
    content.characters[0].relationships[0].target_id = content.characters[1].source_id.clone();
    let valid = pack_json(&content).unwrap();
    let mut unknown: serde_json::Value = serde_json::from_str(&valid).unwrap();
    unknown["characters"][0]["relationships"][0]["unexpected"] = serde_json::json!(true);
    assert!(parse_pack(&unknown.to_string()).is_err());
    content.characters[0].relationships = (0..33)
        .map(|index| CharacterRelationship {
            target_id: format!("target-{index}"),
            description: "친구".into(),
        })
        .collect();
    assert!(import_pack(&conn, &content).is_err());
    assert_eq!(collection(&conn).unwrap().installed.len(), 2);
}

#[test]
fn canonical_export_roundtrip_preserves_talk_scope_and_story_activation() {
    let conn = crate::store::open(std::path::Path::new(":memory:")).unwrap();
    let addon = import_pack(&conn, &nadir_pack()).unwrap();
    let exported = export_pack(&conn, &[addon[0].id.clone(), addon[1].id.clone()], &[]).unwrap();
    assert_eq!(exported.characters[0].source_id, "nadir");
    assert_eq!(exported.characters[1].source_id, "star-tail");
    let parsed = parse_pack(&pack_json(&exported).unwrap()).unwrap();
    let imported = import_pack(&conn, &parsed).unwrap();
    apply_pair(&conn, [imported[1].id.clone(), imported[0].id.clone()]).unwrap();
    let context = crate::talk::context::build(&conn, None, 0, 0).unwrap();
    assert_eq!(
        context.values["character.b.sourceId"],
        serde_json::json!("nadir")
    );
    assert_eq!(
        context.values["character.a.sourceId"],
        serde_json::json!("star-tail")
    );
    assert!(crate::story::prepare(&conn, "b", 0, 0).unwrap().is_some());
    assert!(crate::story::prepare(&conn, "a", 0, 0).unwrap().is_none());
    let copy = clone_character(&conn, &imported[0].id).unwrap();
    assert!(export_pack(&conn, &[imported[0].id.clone(), copy.id.clone()], &[]).is_err());
    assert_eq!(
        export_pack(&conn, &[copy.id], &[]).unwrap().characters[0].source_id,
        "nadir"
    );
    let mut custom = builtin("a");
    custom.source_id = "custom".into();
    let first = create(&conn, &custom).unwrap();
    let second = clone_character(&conn, &first.id).unwrap();
    let custom_pack = export_pack(&conn, &[first.id, second.id], &[]).unwrap();
    assert_eq!(custom_pack.characters[0].source_id, "character-1");
    assert_eq!(custom_pack.characters[1].source_id, "character-2");
}

#[test]
fn export_single_b_remaps_selected_personal_lines_and_excludes_private_data() {
    let conn = database();
    conn.execute_batch(
        "CREATE TABLE secrets(value TEXT); INSERT INTO secrets VALUES('never-export');",
    )
    .unwrap();
    let entry = pack().wordbook.remove(0);
    let exported = export_pack(&conn, &["builtin-b".into()], std::slice::from_ref(&entry)).unwrap();
    assert_eq!(exported.wordbook[0].lines[0].persona, "a");
    assert_eq!(exported.wordbook[0].lines[0].text, entry.lines[0].text);
    assert!(export_pack(&conn, &["builtin-a".into()], &[entry]).is_err());
    let text = pack_json(&exported).unwrap();
    assert!(!text.contains("never-export"));
    let imported = import_pack(&conn, &parse_pack(&text).unwrap()).unwrap();
    assert_eq!(imported[0].definition.name, "B");
    assert!(export_pack(&conn, &["builtin-b".into()], &[])
        .unwrap()
        .wordbook
        .is_empty());
}
#[test]
fn malformed_unknown_nested_fields_and_oversize_are_rejected() {
    assert!(parse_pack("invalid").is_err());
    assert!(parse_pack(&" ".repeat(MAX_PACK_BYTES + 1)).is_err());
    for path in ["root", "definition", "line", "wordbook"] {
        let mut value = serde_json::to_value(pack()).unwrap();
        match path {
            "root" => value["secret"] = serde_json::json!(true),
            "definition" => value["characters"][0]["secret"] = serde_json::json!(true),
            "line" => value["pairScenes"][0][0]["secret"] = serde_json::json!(true),
            _ => value["wordbook"][0]["secret"] = serde_json::json!(true),
        }
        assert!(parse_pack(&value.to_string()).is_err(), "{path}");
    }
    let mut invalid = pack();
    invalid.format_version = 3;
    assert!(validate_pack(&invalid).is_err());
    invalid = pack();
    invalid.characters.truncate(1);
    assert!(validate_pack(&invalid).is_err());
}
#[test]
fn pair_dialogue_override_survives_swap_export_and_empty_deletion() {
    let conn = database();
    let imported = import_pack(&conn, &pack()).unwrap();
    let ids = [imported[0].id.clone(), imported[1].id.clone()];
    apply_pair(&conn, ids.clone()).unwrap();
    let mut edited = dialogue(&conn, &ids).unwrap();
    edited.wordbook[0].lines[0].text = "  편집한 원문\n ".into();
    save_dialogue(&conn, &ids, &edited).unwrap();
    apply_pair(&conn, [ids[1].clone(), ids[0].clone()]).unwrap();
    let found = keyword_scene(&conn, "hello").unwrap().unwrap();
    assert_eq!(found[0].persona, "a");
    assert_eq!(found[0].text, "  편집한 원문\n ");
    let exported = export_pack(&conn, &[ids[1].clone(), ids[0].clone()], &[]).unwrap();
    assert_eq!(exported.wordbook[0].lines[0].persona, "a");
    assert_eq!(exported.wordbook[0].lines[0].text, found[0].text);
    save_dialogue(&conn, &ids, &CharacterDialogue::default()).unwrap();
    assert!(keyword_scene(&conn, "hello").unwrap().is_none());
    assert!(export_pack(&conn, &ids, &[]).unwrap().wordbook.is_empty());
    let original = pack_record(&conn, imported[0].pack_id.as_ref().unwrap())
        .unwrap()
        .0;
    assert_eq!(original.wordbook[0].lines[0].text, "  안녕\n반가워  ");
}
#[test]
fn single_override_follows_character_in_mixed_pair_without_pair_leak() {
    let conn = database();
    let first = clone_character(&conn, "builtin-a").unwrap();
    let second = clone_character(&conn, "builtin-b").unwrap();
    let mut single = CharacterDialogue {
        pair_scenes: Vec::new(),
        wordbook: pack().wordbook,
    };
    single.wordbook[0].lines[0].persona = "a".into();
    save_dialogue(&conn, std::slice::from_ref(&first.id), &single).unwrap();
    let copy = clone_character(&conn, &first.id).unwrap();
    assert_ne!(copy.id, first.id);
    assert_eq!(
        dialogue(&conn, std::slice::from_ref(&copy.id))
            .unwrap()
            .wordbook[0]
            .lines[0]
            .text,
        single.wordbook[0].lines[0].text
    );
    apply_pair(&conn, ["builtin-b".into(), first.id.clone()]).unwrap();
    assert_eq!(
        keyword_scene(&conn, "hello").unwrap().unwrap()[0].persona,
        "b"
    );
    let ids = [first.id.clone(), second.id.clone()];
    let mut pair = single.clone();
    pair.wordbook[0].lines[0].text = "pair only".into();
    save_dialogue(&conn, &ids, &pair).unwrap();
    assert_ne!(
        keyword_scene(&conn, "hello").unwrap().unwrap()[0].text,
        "pair only"
    );
    apply_pair(&conn, ids.clone()).unwrap();
    assert_eq!(
        keyword_scene(&conn, "hello").unwrap().unwrap()[0].text,
        "pair only"
    );
    save_dialogue(&conn, &ids, &CharacterDialogue::default()).unwrap();
    assert!(keyword_scene(&conn, "hello").unwrap().is_none());
    assert_eq!(
        dialogue(&conn, std::slice::from_ref(&first.id))
            .unwrap()
            .wordbook
            .len(),
        1
    );
}
#[test]
fn invalid_dialogue_does_not_replace_saved_content_and_reopens() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("dialogue.db");
    let ids = ["builtin-a".to_string()];
    {
        let conn = Connection::open(&path).unwrap();
        initialize_for_tests(&conn).unwrap();
        let mut content = CharacterDialogue {
            pair_scenes: Vec::new(),
            wordbook: pack().wordbook,
        };
        content.wordbook[0].lines[0].persona = "a".into();
        save_dialogue(&conn, &ids, &content).unwrap();
        content.wordbook[0].lines[0].persona = "b".into();
        assert!(save_dialogue(&conn, &ids, &content).is_err());
    }
    let conn = Connection::open(&path).unwrap();
    initialize_for_tests(&conn).unwrap();
    assert_eq!(
        dialogue(&conn, &ids).unwrap().wordbook[0].lines[0].persona,
        "a"
    );
}
#[test]
fn cloning_imported_character_preserves_attribution_after_original_removal() {
    let conn = database();
    let mut source = pack();
    source.characters.truncate(1);
    source.pair_scenes.clear();
    source.wordbook[0].lines[0].persona = "a".into();
    let original = import_pack(&conn, &source).unwrap().remove(0);
    let cloned = clone_character(&conn, &original.id).unwrap();
    remove(&conn, &original.id).unwrap();
    let exported = export_pack(&conn, std::slice::from_ref(&cloned.id), &[]).unwrap();
    assert_eq!(exported.author, source.author);
    assert_eq!(exported.license, source.license);
    assert_eq!(exported.characters[0].name, source.characters[0].name);
    assert_eq!(
        exported.wordbook[0].lines[0].text,
        source.wordbook[0].lines[0].text
    );
}
#[test]
fn combined_duplicate_source_wordbook_ids_remain_stable_and_editable() {
    let conn = database();
    let mut source = pack();
    source.characters.truncate(1);
    source.pair_scenes.clear();
    source.wordbook[0].lines[0].persona = "a".into();
    let first = import_pack(&conn, &source).unwrap().remove(0);
    let second = import_pack(&conn, &source).unwrap().remove(0);
    let ids = [first.id.clone(), second.id.clone()];
    let combined = dialogue(&conn, &ids).unwrap();
    assert_eq!(combined.wordbook.len(), 2);
    assert_ne!(combined.wordbook[0].id, combined.wordbook[1].id);
    assert_eq!(
        dialogue(&conn, &ids).unwrap().wordbook[0].id,
        combined.wordbook[0].id
    );
    save_dialogue(&conn, &ids, &combined).unwrap();
    let swapped = dialogue(&conn, &[second.id.clone(), first.id.clone()]).unwrap();
    assert_eq!(swapped.wordbook[0].id, combined.wordbook[0].id);
    assert_eq!(swapped.wordbook[0].lines[0].persona, "b");
    // Separately authored local overrides can also reuse the same source UUID.
    let content = CharacterDialogue {
        pair_scenes: Vec::new(),
        wordbook: source.wordbook,
    };
    save_dialogue(&conn, std::slice::from_ref(&first.id), &content).unwrap();
    let third = clone_character(&conn, "builtin-a").unwrap();
    save_dialogue(&conn, std::slice::from_ref(&third.id), &content).unwrap();
    let mixed = [first.id, third.id];
    let composed = dialogue(&conn, &mixed).unwrap();
    assert_ne!(composed.wordbook[0].id, composed.wordbook[1].id);
    save_dialogue(&conn, &mixed, &composed).unwrap();
}
#[test]
fn keyword_ties_follow_install_order_not_slot_order() {
    let conn = database();
    let mut source = pack();
    source.characters.truncate(1);
    source.pair_scenes.clear();
    source.wordbook[0].lines[0].persona = "a".into();
    let first = import_pack(&conn, &source).unwrap();
    source.wordbook[0].lines[0].text = "second".into();
    let second = import_pack(&conn, &source).unwrap();
    apply_pair(&conn, [second[0].id.clone(), first[0].id.clone()]).unwrap();
    assert_eq!(
        keyword_scene(&conn, "hello").unwrap().unwrap()[0].text,
        "  안녕\n반가워  "
    );
}

#[test]
fn expressions_are_dynamic_but_keep_the_default_key() {
    let conn = database();
    let mut definition = builtin("a");
    definition
        .expressions
        .insert("슬픔".into(), "(；_；)".into());
    definition.expressions.remove("장난");
    definition.greeting[0].expression = "화남".into();
    let created = create(&conn, &definition).unwrap();
    assert_eq!(created.definition.expressions.len(), 6);
    assert_eq!(created.definition.greeting[0].expression, "화남");
    let mut invalid = definition.clone();
    invalid.expressions.remove(DEFAULT_EXPRESSION);
    assert!(create(&conn, &invalid).is_err());
    invalid = definition.clone();
    invalid.expressions.insert(" 공백 ".into(), "x".into());
    assert!(create(&conn, &invalid).is_err());
    invalid = definition.clone();
    for index in 0..30 {
        invalid
            .expressions
            .insert(format!("표정{index}"), "x".into());
    }
    assert!(create(&conn, &invalid).is_err());
    invalid = definition.clone();
    invalid.sprite_size = 16;
    assert!(create(&conn, &invalid).is_err());
    invalid = definition.clone();
    invalid.expressions.insert("$balloon".into(), "x".into());
    assert!(create(&conn, &invalid).is_err());
    let legacy: CharacterDefinition = serde_json::from_str(
        &serde_json::to_string(&builtin("b"))
            .unwrap()
            .replace(",\"spriteSize\":64", "")
            .replace(",\"faceIcon\":false", ""),
    )
    .unwrap();
    assert_eq!(legacy.sprite_size, DEFAULT_SPRITE_SIZE);
    assert!(!legacy.face_icon);
}

#[test]
fn sprites_follow_save_clone_export_import_and_removal() {
    let conn = database();
    let created = clone_character(&conn, "builtin-a").unwrap();
    assert!(set_sprite(&conn, &created.id, "슬픔", PNG).is_err());
    set_sprite(&conn, &created.id, "기쁨", PNG).unwrap();
    set_sprite(
        &conn,
        &created.id,
        "장난",
        b"<svg xmlns='http://www.w3.org/2000/svg'/>",
    )
    .unwrap();
    assert!(set_sprite(&conn, &created.id, "평온", b"nope").is_err());
    let listed = get(&conn, &created.id).unwrap().sprites;
    assert_eq!(listed["기쁨"].mime, "image/png");
    assert_eq!(listed["장난"].mime, "image/svg+xml");
    set_sprite(&conn, &created.id, BALLOON_SPRITE, b"GIF89a-skin").unwrap();
    let mut edited = created.definition.clone();
    edited.expressions.remove("장난");
    save(&conn, &created.id, &edited).unwrap();
    let after = get(&conn, &created.id).unwrap().sprites;
    assert_eq!(after.keys().collect::<Vec<_>>(), [BALLOON_SPRITE, "기쁨"]);
    let copy = clone_character(&conn, &created.id).unwrap();
    assert_eq!(copy.sprites["기쁨"].mime, "image/png");
    assert_eq!(copy.sprites[BALLOON_SPRITE].mime, "image/gif");
    assert_eq!(copy.definition.source_id, created.definition.source_id);
    remove_sprite(&conn, &created.id, BALLOON_SPRITE).unwrap();
    let exported = export_pack(&conn, std::slice::from_ref(&created.id), &[]).unwrap();
    assert_eq!(exported.sprites.len(), 1);
    assert_eq!(exported.characters[0].source_id, "character-1");
    assert_eq!(
        exported.sprites[0].source_id,
        exported.characters[0].source_id
    );
    let json = serde_json::to_string(&exported).unwrap();
    let imported = import_pack(&conn, &parse_pack(&json).unwrap()).unwrap();
    assert_eq!(
        sprite(&conn, &imported[0].id, "기쁨")
            .unwrap()
            .unwrap()
            .data,
        PNG
    );
    let stored = pack_record(&conn, imported[0].pack_id.as_ref().unwrap())
        .unwrap()
        .0;
    assert!(stored.sprites.is_empty());
    remove_sprite(&conn, &created.id, "기쁨").unwrap();
    assert!(get(&conn, &created.id).unwrap().sprites.is_empty());
    remove(&conn, &imported[0].id).unwrap();
    assert!(sprite(&conn, &imported[0].id, "기쁨").unwrap().is_none());
    let mut tampered = exported.clone();
    tampered.sprites[0].mime = "image/gif".into();
    assert!(validate_pack(&tampered).is_err());
    tampered = exported.clone();
    tampered.sprites[0].expression = "없는표정".into();
    assert!(validate_pack(&tampered).is_err());
    tampered = exported;
    tampered.sprites.push(tampered.sprites[0].clone());
    assert!(validate_pack(&tampered).is_err());
}

#[test]
fn reopen_and_last_member_protection_preserve_unrelated_data() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("test.db");
    let id;
    {
        let conn = Connection::open(&path).unwrap();
        initialize_for_tests(&conn).unwrap();
        conn.execute_batch("CREATE TABLE history(text TEXT); INSERT INTO history VALUES('old');")
            .unwrap();
        id = clone_character(&conn, "builtin-b").unwrap().id;
        assign(&conn, "b", &id).unwrap();
    }
    let conn = Connection::open(&path).unwrap();
    initialize_for_tests(&conn).unwrap();
    assert_eq!(active_character(&conn, "b").unwrap().id, id);
    remove(&conn, &id).unwrap();
    assert_eq!(active_ids(&conn).unwrap(), ["builtin-a"]);
    initialize_for_tests(&conn).unwrap();
    assert_eq!(collection(&conn).unwrap().installed.len(), 2);
    assert_eq!(
        conn.query_row("SELECT text FROM history", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "old"
    );
    remove(&conn, "builtin-b").unwrap();
    initialize_for_tests(&conn).unwrap();
    assert_eq!(collection(&conn).unwrap().installed.len(), 1);
    let mut edited = builtin("a");
    edited.name = "바뀐 A".into();
    save(&conn, "builtin-a", &edited).unwrap();
    assert!(remove(&conn, "builtin-a").is_err());
    initialize_for_tests(&conn).unwrap();
    assert_eq!(active_ids(&conn).unwrap(), ["builtin-a"]);
    assert_eq!(
        active_character(&conn, "a").unwrap().definition.name,
        "바뀐 A"
    );
    assert_eq!(collection(&conn).unwrap().installed.len(), 1);
}

#[test]
fn legacy_slot_table_migrates_once_into_the_roster() {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("CREATE TABLE characters(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,pack_id TEXT,data TEXT NOT NULL); CREATE TABLE character_slots(slot TEXT PRIMARY KEY,character_id TEXT NOT NULL UNIQUE); INSERT INTO character_slots VALUES('a','builtin-b'),('b','builtin-a');").unwrap();
    for slot in ["a", "b"] {
        conn.execute(
            "INSERT INTO characters(id,pack_id,data) VALUES(?1,NULL,?2)",
            params![
                format!("builtin-{slot}"),
                serde_json::to_string(&builtin(slot)).unwrap()
            ],
        )
        .unwrap();
    }
    initialize_for_tests(&conn).unwrap();
    assert_eq!(active_ids(&conn).unwrap(), ["builtin-b", "builtin-a"]);
    let has_slots: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='character_slots')",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(!has_slots);
    apply_roster(&conn, vec!["builtin-a".into()]).unwrap();
    initialize_for_tests(&conn).unwrap();
    assert_eq!(active_ids(&conn).unwrap(), ["builtin-a"]);
}

#[test]
fn single_member_roster_leaves_slot_b_empty_and_appends_on_assign() {
    let conn = database();
    apply_roster(&conn, vec!["builtin-b".into()]).unwrap();
    assert_eq!(collection(&conn).unwrap().active, ["builtin-b"]);
    assert_eq!(active_character(&conn, "a").unwrap().id, "builtin-b");
    assert!(active_character(&conn, "b").is_err());
    assert_eq!(idle_scene(&conn, 0).unwrap().len(), 1);
    assign(&conn, "b", "builtin-a").unwrap();
    assert_eq!(active_ids(&conn).unwrap(), ["builtin-b", "builtin-a"]);
    assert!(apply_roster(&conn, Vec::new()).is_err());
    assert!(apply_roster(&conn, vec!["builtin-a".into(), "builtin-a".into()]).is_err());
    let many: Vec<String> = (0..=MAX_ROSTER)
        .map(|_| clone_character(&conn, "builtin-a").unwrap().id)
        .collect();
    assert!(apply_roster(&conn, many.clone()).is_err());
    apply_roster(&conn, many[..MAX_ROSTER].to_vec()).unwrap();
    assert_eq!(active_ids(&conn).unwrap().len(), MAX_ROSTER);
}

#[test]
fn removing_members_keeps_order_and_protects_the_last_identity() {
    let conn = database();
    let created = clone_character(&conn, "builtin-a").unwrap();
    apply_roster(
        &conn,
        vec![created.id.clone(), "builtin-b".into(), "builtin-a".into()],
    )
    .unwrap();
    remove(&conn, &created.id).unwrap();
    assert_eq!(active_ids(&conn).unwrap(), ["builtin-b", "builtin-a"]);
    assert!(apply_pair(&conn, ["builtin-a".into(), "missing".into()]).is_err());
    assert_eq!(active_ids(&conn).unwrap(), ["builtin-b", "builtin-a"]);
    let alone = clone_character(&conn, "builtin-b").unwrap();
    apply_roster(&conn, vec![alone.id.clone()]).unwrap();
    assert!(remove(&conn, &alone.id).is_err());
    assert_eq!(active_ids(&conn).unwrap(), [alone.id]);
}

#[test]
fn attribution_reopens_and_exports_without_private_data() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("attribution.db");
    let (id, pack_id) = {
        let conn = Connection::open(&path).unwrap();
        initialize_for_tests(&conn).unwrap();
        let character = import_pack(&conn, &pack()).unwrap().remove(0);
        let pack_id = character.pack_id.unwrap();
        save_pack_attribution(
            &conn,
            &pack_id,
            &PackAttribution {
                author: "원작자".into(),
                source_url: "https://example.com/author".into(),
            },
        )
        .unwrap();
        (character.id, pack_id)
    };
    let conn = Connection::open(&path).unwrap();
    initialize_for_tests(&conn).unwrap();
    let saved = pack_attribution(&conn, &pack_id).unwrap();
    assert_eq!(saved.author, "원작자");
    let exported = export_pack(&conn, &[id], &[]).unwrap();
    assert_eq!(exported.author, saved.author);
    assert_eq!(exported.source_url, saved.source_url);
    let json = pack_json(&exported).unwrap();
    assert!(!json.contains("messages"));
    assert!(!json.contains("affinity"));
    assert!(save_pack_attribution(
        &conn,
        &pack_id,
        &PackAttribution {
            author: String::new(),
            source_url: "javascript:bad".into()
        }
    )
    .is_err());
    assert_eq!(
        pack_attribution(&conn, &pack_id).unwrap().author,
        saved.author
    );
}

#[test]
fn v2_eight_member_pack_uses_source_ids_and_survives_definition_reordering() {
    let conn = database();
    let mut definition = builtin("a");
    definition.source_id = "custom-character".into();
    let original = create(&conn, &definition).unwrap();
    let ids: Vec<String> = (0..8)
        .map(|_| clone_character(&conn, &original.id).unwrap().id)
        .collect();
    apply_roster(&conn, ids.clone()).unwrap();
    let authored = CharacterDialogue {
        pair_scenes: vec![vec![
            SceneLine {
                persona: "h".into(),
                expression: "평온".into(),
                text: "  마지막 친구\n원문  ".into(),
            },
            SceneLine {
                persona: "c".into(),
                expression: "기쁨".into(),
                text: "셋째".into(),
            },
        ]],
        wordbook: vec![],
    };
    save_dialogue(&conn, &ids, &authored).unwrap();
    let exported = export_pack(&conn, &ids, &[]).unwrap();
    let json = pack_json(&exported).unwrap();
    assert!(!ids.iter().any(|id| json.contains(id)));
    let mut value: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert_eq!(value["pairScenes"][0][0]["speaker"], "character-8");
    assert!(value["pairScenes"][0][0].get("persona").is_none());
    value["characters"].as_array_mut().unwrap().reverse();
    let pack = parse_pack(&value.to_string()).unwrap();
    let imported = import_pack(&conn, &pack).unwrap();
    let imported_ids: Vec<_> = imported.iter().map(|c| c.id.clone()).collect();
    apply_roster(&conn, imported_ids).unwrap();
    let scene = idle_scene(&conn, 0).unwrap();
    assert_eq!(scene[0].persona, "a");
    assert_eq!(scene[0].text, "  마지막 친구\n원문  ");
    assert_eq!(
        resolve_lines(&conn, &scene).unwrap()[0].persona,
        imported[0].id
    );
    value["pairScenes"][0][0]["speaker"] = serde_json::json!("missing");
    assert!(parse_pack(&value.to_string()).is_err());
}

#[test]
fn removed_builtins_are_not_reseeded_and_final_member_cannot_be_deleted() {
    let conn = database();
    let friend = clone_character(&conn, "builtin-a").unwrap();
    apply_roster(&conn, vec![friend.id.clone()]).unwrap();
    remove(&conn, "builtin-a").unwrap();
    remove(&conn, "builtin-b").unwrap();
    initialize_for_tests(&conn).unwrap();
    assert_eq!(collection(&conn).unwrap().installed.len(), 1);
    assert!(remove(&conn, &friend.id).is_err());
    initialize_for_tests(&conn).unwrap();
    assert_eq!(active_ids(&conn).unwrap(), [friend.id]);
}
