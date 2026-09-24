use super::*;
use crate::character_animation::{Clip, Frame};
use crate::character_reactions::{
    self as reactions, MotionOverride, ReactionRule, ReactionVariant,
};

fn database() -> Connection {
    crate::store::open(std::path::Path::new(":memory:")).unwrap()
}

fn motion(repeat: bool) -> MotionOverride {
    MotionOverride::Clip {
        clip_id: "wave".into(),
        repeat,
        interval_ms: 0,
    }
}

fn reacting() -> (CharacterDefinition, PreparedAsset) {
    let asset = animation::prepare_png(animation::png_fixture(2, 2, 255, false)).unwrap();
    let mut definition = builtin("a");
    definition.animation = Some(Animation {
        clips: vec![Clip {
            id: "wave".into(),
            name: "손 흔들기".into(),
            fps: 8,
            frames: vec![Frame {
                asset_id: asset.asset_id.clone(),
                x: 0,
                y: 0,
                width: 2,
                height: 2,
            }],
        }],
        ..Default::default()
    });
    definition.reactions = vec![ReactionRule {
        id: "hello".into(),
        event: "click".into(),
        cooldown_ms: 1000,
        variants: vec![ReactionVariant {
            id: "wave".into(),
            text: Some("  안녕\n반가워  ".into()),
            expression: Some("평온".into()),
            motion: motion(false),
        }],
    }];
    definition.greeting[0].motion = motion(true);
    (definition, asset)
}

fn scene(persona: &str) -> SceneLine {
    SceneLine {
        persona: persona.into(),
        expression: "평온".into(),
        text: "  원문\n그대로  ".into(),
        motion: motion(false),
    }
}

#[test]
fn reactions_validate_owned_clips_one_shot_gestures_and_atomic_definition_saves() {
    let conn = database();
    let (definition, asset) = reacting();
    let created = create_with_assets(&conn, &definition, &[asset]).unwrap();
    for event in ["click", "release", "timer-finished"] {
        let mut invalid = created.definition.clone();
        invalid.name = "저장되면 안 됨".into();
        invalid.reactions[0].event = event.into();
        invalid.reactions[0].variants[0].motion = motion(true);
        assert!(save(&conn, &created.id, &invalid).is_err());
        assert_eq!(get(&conn, &created.id).unwrap(), created);
    }
    let mut grabbed = definition.clone();
    grabbed.reactions[0].event = "grab-start".into();
    grabbed.reactions[0].variants[0].motion = motion(true);
    save(&conn, &created.id, &grabbed).unwrap();
    let saved = get(&conn, &created.id).unwrap();
    let mut invalid = saved.definition.clone();
    invalid.animation = None;
    assert!(save(&conn, &created.id, &invalid).is_err());
    assert_eq!(get(&conn, &created.id).unwrap(), saved);
    let mut invalid_interval = definition;
    invalid_interval.reactions[0].variants[0].motion = MotionOverride::Clip {
        clip_id: "wave".into(),
        repeat: false,
        interval_ms: 1,
    };
    assert!(reactions::validate(&invalid_interval).is_err());
}

#[test]
fn v5_roundtrip_remaps_speakers_preserves_motions_and_clones_without_private_archive() {
    let conn = database();
    let (definition, asset) = reacting();
    let a = create_with_assets(&conn, &definition, &[asset]).unwrap();
    let b = create(&conn, &builtin("b")).unwrap();
    let ids = vec![b.id.clone(), a.id.clone()];
    let content = CharacterDialogue {
        pair_scenes: vec![vec![scene("b")]],
        wordbook: vec![],
    };
    save_dialogue(&conn, &ids, &content).unwrap();
    let pack = export_pack(&conn, &ids, &[]).unwrap();
    assert_eq!(pack.format_version, 5);
    assert!(pack.archive.is_none());
    let json = pack_json(&pack).unwrap();
    let wire: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert_eq!(wire["pairScenes"][0][0]["speaker"], "character-2");
    assert_eq!(wire["pairScenes"][0][0]["motion"]["clipId"], "wave");
    let parsed = parse_pack(&json).unwrap();
    let mut expected = a.definition.clone();
    expected.source_id = "character-2".into();
    assert_eq!(parsed.characters[1], expected);
    let imported = import_pack(&conn, &parsed).unwrap();
    let swapped = vec![imported[1].id.clone(), imported[0].id.clone()];
    let remapped = dialogue(&conn, &swapped).unwrap();
    assert_eq!(remapped.pair_scenes[0][0].persona, "a");
    assert_eq!(remapped.pair_scenes[0][0].motion, motion(false));
    let cloned = clone_character(&conn, &a.id).unwrap();
    assert_eq!(cloned.definition.reactions, a.definition.reactions);
    assert_eq!(cloned.definition.greeting[0].motion, motion(true));
    assert_eq!(cloned.animation_assets, a.animation_assets);
    remove(&conn, &cloned.id).unwrap();
    assert!(animation::list(&conn, &cloned.id).unwrap().is_empty());
    let archived = export_pack_with_options(
        &conn,
        &[a.id],
        &[],
        &ExportOptions {
            include_memories: true,
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(archived.format_version, 5);
    assert!(parse_pack(&pack_json(&archived).unwrap())
        .unwrap()
        .archive
        .is_some());
}

#[test]
fn image_exclusion_retains_text_expression_and_static_effects_and_chooses_lowest_version() {
    let conn = database();
    let (mut definition, asset) = reacting();
    definition.reactions[0].variants.extend([
        ReactionVariant {
            id: "only-clip".into(),
            text: None,
            expression: None,
            motion: motion(false),
        },
        ReactionVariant {
            id: "static".into(),
            text: None,
            expression: None,
            motion: MotionOverride::Static,
        },
    ]);
    let created = create_with_assets(&conn, &definition, &[asset]).unwrap();
    save_dialogue(
        &conn,
        std::slice::from_ref(&created.id),
        &CharacterDialogue {
            pair_scenes: vec![vec![scene("a")]],
            wordbook: vec![],
        },
    )
    .unwrap();
    let options = ExportOptions {
        include_sprites: false,
        ..Default::default()
    };
    let exported =
        export_pack_with_options(&conn, std::slice::from_ref(&created.id), &[], &options).unwrap();
    assert_eq!(exported.format_version, 5);
    assert!(exported.animation_assets.is_empty());
    let definition = &exported.characters[0];
    assert!(definition.animation.is_none());
    assert!(definition.greeting[0].motion.is_inherit());
    assert!(exported.pair_scenes[0][0].motion.is_inherit());
    let variants = &definition.reactions[0].variants;
    assert_eq!(variants.len(), 2);
    assert_eq!(variants[0].text.as_deref(), Some("  안녕\n반가워  "));
    assert_eq!(variants[0].expression.as_deref(), Some("평온"));
    assert!(variants[0].motion.is_inherit());
    assert_eq!(variants[1].motion, MotionOverride::Static);
    parse_pack(&pack_json(&exported).unwrap()).unwrap();
    let mut only_clip = created.definition;
    only_clip.reactions[0]
        .variants
        .retain(|variant| variant.id == "only-clip");
    save(&conn, &created.id, &only_clip).unwrap();
    let minimal = export_pack_with_options(&conn, &[created.id], &[], &options).unwrap();
    assert_eq!(minimal.format_version, 2);
    assert!(minimal.characters[0].reactions.is_empty());
    parse_pack(&pack_json(&minimal).unwrap()).unwrap();
}

#[test]
fn pack_and_dialogue_reject_foreign_clips_old_versions_and_unknown_motion_fields() {
    let conn = database();
    let (definition, asset) = reacting();
    let a = create_with_assets(&conn, &definition, &[asset]).unwrap();
    let b = create(&conn, &builtin("b")).unwrap();
    let ids = [a.id, b.id];
    let foreign = CharacterDialogue {
        pair_scenes: vec![vec![scene("b")]],
        wordbook: vec![],
    };
    assert!(save_dialogue(&conn, &ids, &foreign).is_err());
    let mut pack = export_pack(&conn, &ids, &[]).unwrap();
    for version in [1, 2, 3, 6] {
        let mut invalid = pack.clone();
        invalid.format_version = version;
        assert!(validate_pack(&invalid).is_err(), "version {version}");
    }
    pack.pair_scenes = foreign.pair_scenes;
    assert!(validate_pack(&pack).is_err());
    pack.pair_scenes[0][0].persona = "a".into();
    let mut wire: serde_json::Value = serde_json::from_str(&pack_json(&pack).unwrap()).unwrap();
    wire["pairScenes"][0][0]["motion"]["extra"] = true.into();
    assert!(parse_pack(&wire.to_string()).is_err());
}

#[test]
fn deleting_a_clip_used_by_saved_dialogue_requires_clearing_the_reference_first() {
    let conn = database();
    let (definition, asset) = reacting();
    let created = create_with_assets(&conn, &definition, &[asset]).unwrap();
    let ids = [created.id.clone()];
    save_dialogue(
        &conn,
        &ids,
        &CharacterDialogue {
            pair_scenes: vec![vec![scene("a")]],
            wordbook: vec![],
        },
    )
    .unwrap();
    let pack = export_pack(&conn, &ids, &[]).unwrap();
    let imported = import_pack(&conn, &pack).unwrap().remove(0);
    for character in [created, imported] {
        let mut without_clip = character.definition.clone();
        without_clip.animation = None;
        without_clip.reactions.clear();
        without_clip.greeting[0].motion = MotionOverride::Inherit;
        assert!(save(&conn, &character.id, &without_clip).is_err());
        assert_eq!(get(&conn, &character.id).unwrap(), character);
        save_dialogue(
            &conn,
            std::slice::from_ref(&character.id),
            &CharacterDialogue::default(),
        )
        .unwrap();
        save(&conn, &character.id, &without_clip).unwrap();
        assert!(get(&conn, &character.id)
            .unwrap()
            .animation_assets
            .is_empty());
    }
}

#[test]
fn personal_wordbook_motion_uses_current_speaker_while_legacy_absent_slots_still_save() {
    let conn = database();
    let (definition, asset) = reacting();
    let created = create_with_assets(&conn, &definition, &[asset]).unwrap();
    apply_roster(&conn, vec![created.id.clone()]).unwrap();
    let mut entry = WordbookEntry {
        id: uuid::Uuid::new_v4().to_string(),
        title: "인사".into(),
        keywords: vec!["안녕".into()],
        lines: vec![scene("a")],
        enabled: true,
        use_for_idle: false,
    };
    crate::wordbook::save(&conn, &entry).unwrap();
    entry.lines[0].persona = "h".into();
    assert!(crate::wordbook::save(&conn, &entry).is_err());
    entry.lines[0].motion = MotionOverride::Inherit;
    crate::wordbook::save(&conn, &entry).unwrap();
    entry.lines[0] = scene("a");
    crate::wordbook::save(&conn, &entry).unwrap();
    let mut without_clip = created.definition;
    without_clip.animation = None;
    without_clip.reactions.clear();
    without_clip.greeting[0].motion = MotionOverride::Inherit;
    assert!(save(&conn, &created.id, &without_clip).is_err());
    entry.lines[0].motion = MotionOverride::Inherit;
    crate::wordbook::save(&conn, &entry).unwrap();
    save(&conn, &created.id, &without_clip).unwrap();
}
