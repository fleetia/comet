use super::*;
fn database() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    initialize(&conn).unwrap();
    conn
}
fn pack() -> CharacterPack {
    CharacterPack {
        format_version: 1,
        name: "두 친구".into(),
        author: "제작자".into(),
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
    }
}
#[test]
fn factory_pack_has_public_profiles_and_real_greeting_alternatives() {
    let pack = factory_pack();
    validate_pack(&pack).unwrap();
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
    for slot in ["a", "b"] {
        for _ in 0..20 {
            let lines = greeting(&conn, slot).unwrap();
            assert_eq!(lines.len(), 1);
            assert!(builtin(slot)
                .greeting
                .iter()
                .any(|line| line.text == lines[0].text));
        }
    }
    let mut edited = builtin("a");
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
    save(&conn, "builtin-a", &edited).unwrap();
    assert_eq!(greeting(&conn, "a").unwrap().len(), 2);
}

#[test]
fn legacy_factory_migrates_only_exact_definitions_and_retains_identity() {
    let conn = database();
    let legacy: [CharacterDefinition; 2] = serde_json::from_str(r#"[{"sourceId":"builtin-a","version":1,"name":"A","description":"Comet 기본 캐릭터","personality":"호기심이 많고 다정하며 먼저 말을 건넨다.","expressions":{"걱정":"(・・;)","기쁨":"(^‿^)","생각중":"(－_－)","장난":"(¬‿¬)","평온":"(・_・)","호기심":"(・o・)"},"greeting":[{"expression":"기쁨","text":"왔네. 오늘도 여기서 같이 지내자."}],"idleLines":[{"expression":"평온","text":"잠깐 쉬어 가도 좋겠다."}]},{"sourceId":"builtin-b","version":1,"name":"B","description":"Comet 기본 캐릭터","personality":"차분하고 간결하며 가끔 부드러운 농담을 한다.","expressions":{"걱정":"(・・;)","기쁨":"(^‿^)","생각중":"(－_－)","장난":"(¬‿¬)","평온":"(・_・)","호기심":"(・o・)"},"greeting":[{"expression":"기쁨","text":"계속 대답해 주지는 않아도 돼. 우리끼리도 잘 놀거든."}],"idleLines":[{"expression":"평온","text":"여기서 조용히 같이 있을게."}]}]"#).unwrap();
    for (slot, definition) in ["a", "b"].iter().zip(&legacy) {
        conn.execute(
            "UPDATE characters SET data=?1 WHERE id=?2",
            params![
                serde_json::to_string(definition).unwrap(),
                format!("builtin-{slot}")
            ],
        )
        .unwrap();
    }
    let mut edited = legacy[1].clone();
    edited.name = "내가 고친 친구".into();
    conn.execute(
        "UPDATE characters SET data=?1 WHERE id='builtin-b'",
        [serde_json::to_string(&edited).unwrap()],
    )
    .unwrap();
    initialize(&conn).unwrap();
    assert_eq!(get(&conn, "builtin-a").unwrap().definition, builtin("a"));
    assert_eq!(get(&conn, "builtin-b").unwrap().definition, edited);
    assert_eq!(active_ids(&conn).unwrap(), ["builtin-a", "builtin-b"]);
    initialize(&conn).unwrap();
    assert_eq!(get(&conn, "builtin-b").unwrap().definition, edited);
    conn.execute(
        "UPDATE characters SET data=?1 WHERE id='builtin-b'",
        [serde_json::to_string(&legacy[1]).unwrap()],
    )
    .unwrap();
    initialize(&conn).unwrap();
    assert_eq!(get(&conn, "builtin-b").unwrap().definition, builtin("b"));
}

#[test]
fn factory_expression_migration_preserves_customizations_and_installed_identity() {
    let conn = database();
    let old_maps: [BTreeMap<String, String>; 2] = serde_json::from_str(r#"[
            {"평온":"안경을 고쳐 쓰는 나디르","기쁨":"조금 웃는 나디르","호기심":"한쪽 눈썹을 올린 나디르","생각중":"음절을 짚는 나디르","걱정":"말끝을 고르는 나디르","장난":"작게 웃음을 참는 나디르"},
            {"평온":"꼬리를 살랑이는 별꼬리","기쁨":"폴짝 웃는 별꼬리","호기심":"고개를 갸웃한 별꼬리","생각중":"꼬리를 동그랗게 만 별꼬리","걱정":"살짝 처진 별꼬리","장난":"한쪽 눈을 찡긋한 별꼬리"}
        ]"#).unwrap();
    let mut old_pack = factory_pack();
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
    initialize(&conn).unwrap();
    for slot in ["a", "b"] {
        assert_eq!(
            get(&conn, &format!("builtin-{slot}")).unwrap().definition,
            builtin(slot)
        );
    }
    assert_eq!(
        dialogue(&conn, &["builtin-a".into(), "builtin-b".into()])
            .unwrap()
            .pair_scenes
            .len(),
        factory_pack().pair_scenes.len()
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
    initialize(&conn).unwrap();
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
fn database_failure_rolls_back_entire_import() {
    let conn = database();
    conn.execute_batch("CREATE TRIGGER reject_second BEFORE INSERT ON characters WHEN json_extract(NEW.data,'$.sourceId')='star-tail' BEGIN SELECT RAISE(ABORT,'test failure'); END;").unwrap();
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
    assert_eq!(current.definition.source_id, "nadir");
    let copy = clone_character(&conn, &created.id).unwrap();
    assert_ne!(copy.id, created.id);
    assert!(assign(&conn, "b", &created.id).is_err());
    assert_eq!(active_character(&conn, "b").unwrap().id, "builtin-b");
}
#[test]
fn reopen_removal_and_fallback_preserve_unrelated_data() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("test.db");
    let id;
    {
        let conn = Connection::open(&path).unwrap();
        initialize(&conn).unwrap();
        conn.execute_batch("CREATE TABLE history(text TEXT); INSERT INTO history VALUES('old');")
            .unwrap();
        id = clone_character(&conn, "builtin-b").unwrap().id;
        assign(&conn, "b", &id).unwrap();
    }
    let conn = Connection::open(&path).unwrap();
    initialize(&conn).unwrap();
    assert_eq!(active_character(&conn, "b").unwrap().id, id);
    remove(&conn, &id).unwrap();
    assert_eq!(active_ids(&conn).unwrap(), ["builtin-a", "builtin-b"]);
    initialize(&conn).unwrap();
    assert_eq!(collection(&conn).unwrap().installed.len(), 2);
    assert_eq!(
        conn.query_row("SELECT text FROM history", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "old"
    );
    assert!(remove(&conn, "builtin-a").is_err());
}
#[test]
fn fallback_avoids_builtin_already_in_other_slot() {
    let conn = database();
    let created = clone_character(&conn, "builtin-a").unwrap();
    apply_pair(&conn, [created.id.clone(), "builtin-a".into()]).unwrap();
    remove(&conn, &created.id).unwrap();
    assert_eq!(active_ids(&conn).unwrap(), ["builtin-b", "builtin-a"]);
    assert!(apply_pair(&conn, ["builtin-a".into(), "missing".into()]).is_err());
    assert_eq!(active_ids(&conn).unwrap(), ["builtin-b", "builtin-a"]);
}
#[test]
fn canonical_export_roundtrip_preserves_talk_scope_and_story_activation() {
    let conn = crate::store::open(std::path::Path::new(":memory:")).unwrap();
    let exported = export_pack(&conn, &["builtin-a".into(), "builtin-b".into()], &[]).unwrap();
    assert_eq!(exported.characters[0].source_id, "nadir");
    assert_eq!(exported.characters[1].source_id, "star-tail");
    let parsed = parse_pack(&serde_json::to_string(&exported).unwrap()).unwrap();
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
    let text = serde_json::to_string(&exported).unwrap();
    assert!(!text.contains("never-export"));
    let imported = import_pack(&conn, &parse_pack(&text).unwrap()).unwrap();
    assert_eq!(imported[0].definition.name, "별꼬리");
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
    invalid.format_version = 2;
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
        initialize(&conn).unwrap();
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
    initialize(&conn).unwrap();
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
