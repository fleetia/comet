use super::*;
use crate::character_animation::{self, Binding, Bindings, Clip, Frame};

fn animated() -> (CharacterDefinition, PreparedAsset) {
    let asset =
        character_animation::prepare_png(character_animation::png_fixture(4, 2, 255, false))
            .unwrap();
    let mut definition = builtin("a");
    definition.animation = Some(Animation {
        clips: vec![Clip {
            id: "hello".into(),
            name: "인사".into(),
            fps: 6,
            frames: vec![
                Frame {
                    asset_id: asset.asset_id.clone(),
                    x: 0,
                    y: 0,
                    width: 2,
                    height: 2,
                },
                Frame {
                    asset_id: asset.asset_id.clone(),
                    x: 2,
                    y: 0,
                    width: 2,
                    height: 2,
                },
            ],
        }],
        bindings: Bindings {
            idle: Some(Binding {
                clip_id: "hello".into(),
                repeat: true,
                interval_ms: 4000,
            }),
            click: Some(Binding {
                clip_id: "hello".into(),
                repeat: false,
                interval_ms: 0,
            }),
            ..Default::default()
        },
        overrides: BTreeMap::from([("평온".into(), BTreeMap::from([("speaking".into(), None)]))]),
    });
    (definition, asset)
}
fn database() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    initialize_for_tests(&conn).unwrap();
    conn
}

#[test]
fn animation_draft_save_is_atomic_and_cancelled_assets_are_not_installed() {
    let conn = database();
    let (mut definition, asset) = animated();
    let original = active_character(&conn, "a").unwrap();
    let prepared = character_animation::prepare_assets(vec![asset.payload()]).unwrap();
    assert!(animation::list(&conn, &original.id).unwrap().is_empty());
    save_with_assets(&conn, &original.id, &definition, &prepared).unwrap();
    let saved = get(&conn, &original.id).unwrap();
    assert_eq!(saved.definition.animation, definition.animation);
    assert_eq!(saved.animation_assets.len(), 1);
    assert_eq!(
        animation::get(&conn, &original.id, &asset.asset_id)
            .unwrap()
            .unwrap()
            .bytes,
        asset.bytes
    );
    definition.name = "바뀌면 안 되는 이름".into();
    definition.animation.as_mut().unwrap().clips[0].frames[0].asset_id = "0".repeat(64);
    assert!(save_with_assets(&conn, &original.id, &definition, &[]).is_err());
    assert_eq!(get(&conn, &original.id).unwrap(), saved);
    let before = collection(&conn).unwrap().installed.len();
    assert!(create_with_assets(&conn, &definition, &prepared).is_err());
    assert_eq!(collection(&conn).unwrap().installed.len(), before);
    let count: usize = conn
        .query_row(
            "SELECT count(*) FROM character_animation_assets",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 1);
}

#[test]
fn existing_assets_survive_metadata_edits_and_unused_assets_are_removed_without_static_images() {
    let conn = database();
    let (mut definition, asset) = animated();
    let created = create_with_assets(&conn, &definition, &[asset]).unwrap();
    let sprite = b"\x89PNG\r\n\x1a\n-existing-static";
    set_sprite(&conn, &created.id, DEFAULT_EXPRESSION, sprite).unwrap();
    definition.animation.as_mut().unwrap().clips[0].fps = 12;
    save(&conn, &created.id, &definition).unwrap();
    assert_eq!(
        get(&conn, &created.id).unwrap().animation_assets,
        created.animation_assets
    );
    definition.animation = None;
    save(&conn, &created.id, &definition).unwrap();
    let saved = get(&conn, &created.id).unwrap();
    assert!(saved.animation_assets.is_empty());
    assert_eq!(saved.definition.greeting, created.definition.greeting);
    assert_eq!(
        sprites::get(&conn, &created.id, DEFAULT_EXPRESSION)
            .unwrap()
            .unwrap()
            .data,
        sprite
    );
    let exported = export_pack(&conn, &[created.id], &[]).unwrap();
    assert_eq!(exported.format_version, 2);
    assert!(!pack_json(&exported).unwrap().contains("animation"));
}

#[test]
fn animation_pack_v3_roundtrip_clone_and_delete_preserve_frames_and_attribution() {
    let conn = database();
    let (definition, asset) = animated();
    let created = create_with_assets(&conn, &definition, std::slice::from_ref(&asset)).unwrap();
    let mut pack = export_pack(&conn, std::slice::from_ref(&created.id), &[]).unwrap();
    pack.author = "제작자".into();
    pack.source_url = "https://example.com/animation".into();
    assert_eq!(pack.format_version, 3);
    assert_eq!(pack.animation_assets.len(), 1);
    let json = pack_json(&pack).unwrap();
    let imported = import_pack(&conn, &parse_pack(&json).unwrap())
        .unwrap()
        .remove(0);
    assert_eq!(imported.definition.animation, created.definition.animation);
    assert_eq!(imported.animation_assets, created.animation_assets);
    assert_ne!(imported.id, created.id);
    let cloned = clone_character(&conn, &imported.id).unwrap();
    assert_eq!(cloned.definition.animation, imported.definition.animation);
    assert_eq!(cloned.animation_assets, imported.animation_assets);
    save_pack_attribution(
        &conn,
        cloned.pack_id.as_ref().unwrap(),
        &PackAttribution {
            author: "수정한 제작자".into(),
            source_url: "https://example.com/edited".into(),
        },
    )
    .unwrap();
    remove(&conn, &imported.id).unwrap();
    assert!(animation::list(&conn, &imported.id).unwrap().is_empty());
    assert_eq!(
        animation::get(&conn, &cloned.id, &asset.asset_id)
            .unwrap()
            .unwrap()
            .bytes,
        asset.bytes
    );
    let cloned_pack = export_pack(&conn, &[cloned.id], &[]).unwrap();
    assert_eq!(cloned_pack.author, "수정한 제작자");
    assert_eq!(
        cloned_pack.animation_assets[0].source_id,
        cloned_pack.characters[0].source_id
    );
}

#[test]
fn packs_reject_missing_duplicate_foreign_tampered_and_legacy_animation_assets() {
    let conn = database();
    let (definition, asset) = animated();
    let created = create_with_assets(&conn, &definition, &[asset]).unwrap();
    let pack = export_pack(&conn, &[created.id], &[]).unwrap();
    let before = collection(&conn).unwrap().installed.len();
    for fault in ["missing", "duplicate", "foreign", "pixels", "bounds", "v2"] {
        let mut invalid = pack.clone();
        match fault {
            "missing" => invalid.animation_assets.clear(),
            "duplicate" => invalid
                .animation_assets
                .push(invalid.animation_assets[0].clone()),
            "foreign" => invalid.animation_assets[0].source_id = "unknown".into(),
            "pixels" => {
                invalid.animation_assets[0].data =
                    base64::engine::general_purpose::STANDARD.encode(b"\x89PNG\r\n\x1a\n-body")
            }
            "bounds" => invalid.characters[0].animation.as_mut().unwrap().clips[0].frames[0].x = 4,
            _ => invalid.format_version = 2,
        }
        assert!(import_pack(&conn, &invalid).is_err(), "{fault}");
        assert_eq!(collection(&conn).unwrap().installed.len(), before);
    }
}

#[test]
fn animation_assets_survive_restart_and_legacy_definitions_need_no_animation_fields() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("characters.sqlite");
    let (definition, asset) = animated();
    let saved = {
        let conn = Connection::open(&path).unwrap();
        initialize_for_tests(&conn).unwrap();
        let old = active_character(&conn, "a").unwrap();
        let encoded = serde_json::to_string(&old.definition).unwrap();
        assert!(!encoded.contains("animation"));
        assert!(serde_json::from_str::<CharacterDefinition>(&encoded)
            .unwrap()
            .animation
            .is_none());
        create_with_assets(&conn, &definition, &[asset]).unwrap()
    };
    let conn = Connection::open(&path).unwrap();
    initialize_for_tests(&conn).unwrap();
    assert_eq!(get(&conn, &saved.id).unwrap(), saved);
}
