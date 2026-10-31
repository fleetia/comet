use super::*;
use crate::{characters, store, types::Message};
use std::path::Path;

fn fixture() -> (Connection, String, String, String) {
    let db = store::open(Path::new(":memory:")).unwrap();
    crate::story::initialize(&db).unwrap();
    let mut pack = characters::factory_pack();
    pack.format_version = 8;
    let center = pack.characters[0].source_id.clone();
    let guest = pack.characters[1].source_id.clone();
    pack.characters[1].presence_role = PresenceRole::Npc;
    let line = |persona: &str, text: &str| SceneLine {
        persona: persona.into(),
        expression: "평온".into(),
        text: text.into(),
        widget: None,
        motion: Default::default(),
    };
    pack.world_rules = "  세계 규칙\n원문 그대로  ".into();
    pack.story_flags = vec![StoryFlag {
        id: "done".into(),
        public: false,
    }];
    pack.knowledge = vec![ConditionalKnowledge {
        id: "knowledge".into(),
        keywords: vec!["기억".into()],
        text: "  아는 인물만 볼 본문  ".into(),
        known_by: vec![center.clone()],
        required_flags: vec!["done".into()],
    }];
    pack.scenarios = vec![ScenarioDefinition {
        id: "one".into(),
        purpose: Default::default(),
        chapters: None,
        title: "작은 이야기".into(),
        center_id: center.clone(),
        participants: vec![center.clone(), guest],
        keywords: vec!["이야기".into()],
        required_flags: vec![],
        min_affinity: 0,
        reveal_affinity: None,
        defer: vec![],
        intro: vec![line(&center, "  함께 걸어 볼까?\n원문  ")],
        accept: vec![line(&center, "함께 가자.")],
        decline: vec![line(&center, "다음에 이야기하자.")],
        ending: vec![line(&center, "오늘의 길을 기억해.")],
        accept_keywords: vec!["좋아".into()],
        decline_keywords: vec!["싫어".into()],
        proceed_keywords: vec!["계속".into()],
        cancel_keywords: vec!["그만".into()],
        accept_next_id: None,
        decline_next_id: None,
        allow_incomplete_repeat: true,
        allow_repeat: false,
        completion: CompletionEffects {
            set_flags: vec!["done".into()],
            memory_template: Some("{scenarioTitle}를 마쳤다.".into()),
        },
    }];
    let installed = characters::import_pack(&db, &pack).unwrap();
    characters::apply_roster(&db, vec![installed[0].id.clone()]).unwrap();
    (
        db,
        installed[0].pack_id.clone().unwrap(),
        installed[0].id.clone(),
        installed[1].id.clone(),
    )
}

#[test]
fn chapter_scenarios_are_skipped_by_selection_and_trial() {
    let (db, pack_id, center, guest) = fixture();
    let mut snapshot = characters::get_pack_story_definition(&db, &pack_id).unwrap();
    let mut scene = snapshot.definition.scenarios[0].clone();
    scene.id = "chapter-story".into();
    scene.intro.clear();
    scene.accept.clear();
    scene.decline.clear();
    scene.ending.clear();
    scene.accept_keywords.clear();
    scene.decline_keywords.clear();
    scene.proceed_keywords.clear();
    scene.cancel_keywords.clear();
    scene.chapters = Some(
        serde_json::from_value(serde_json::json!([{
            "id": "start", "title": "시작", "steps": [{
                "kind": "line", "persona": scene.center_id, "expression": "평온", "text": "안녕"
            }]
        }]))
        .unwrap(),
    );
    snapshot.definition.scenarios.insert(0, scene);
    characters::save_pack_story_definition_expected(
        &db,
        &pack_id,
        &snapshot.definition,
        &snapshot.baseline,
    )
    .unwrap();

    let context = input(&db, &center, "이야기", 1);
    let selected = select(&db, &Runtime::default(), &context, "이야기")
        .unwrap()
        .unwrap();
    assert_eq!(selected.run.scenario_id.as_deref(), Some("one"));

    let pack = characters::export_pack(&db, &[center, guest], &[]).unwrap();
    assert_eq!(
        trial(
            &pack.characters,
            &pack.story_definition(),
            "chapter-story",
            &[],
            20,
            &[]
        )
        .unwrap_err(),
        "아직 시험할 수 없어요."
    );
}
#[test]
fn new_story_fields_require_pack_format_12() {
    let (db, _, center, guest) = fixture();
    let original = characters::export_pack(&db, &[center, guest], &[]).unwrap();
    for use_defer in [false, true] {
        let mut pack = original.clone();
        let scenario = &mut pack.scenarios[0];
        scenario.min_affinity = 10;
        if use_defer {
            scenario.defer = scenario.intro.clone();
        } else {
            scenario.reveal_affinity = Some(0);
        }
        let target = store::open(Path::new(":memory:")).unwrap();
        pack.format_version = 8;
        assert!(characters::import_pack(&target, &pack).is_err());
        pack.format_version = 12;
        assert!(characters::import_pack(&target, &pack).is_ok());
    }
}

#[test]
fn mood_and_story_features_preserve_the_highest_pack_version() {
    use crate::characters::animation::{self, Animation, Binding, Bindings, Clip, Frame};
    let (db, pack_id, center, guest) = fixture();
    let asset = animation::prepare_png(animation::png_fixture(2, 2, 255, false)).unwrap();
    let mut definition = characters::get(&db, &center).unwrap().definition;
    definition.animation = Some(Animation {
        clips: vec![Clip {
            id: "mood".into(),
            name: "기분".into(),
            fps: 6,
            frames: vec![Frame {
                asset_id: asset.asset_id.clone(),
                x: 0,
                y: 0,
                width: 2,
                height: 2,
            }],
        }],
        bindings: Bindings {
            mood_high: Some(Binding {
                clip_id: "mood".into(),
                repeat: true,
                interval_ms: 0,
            }),
            ..Default::default()
        },
        overrides: Default::default(),
    });
    characters::save_with_assets(&db, &center, &definition, &[asset]).unwrap();
    let mut story = characters::get_pack_story_definition(&db, &pack_id).unwrap();
    story.definition.scenarios[0].reveal_affinity = Some(0);
    characters::save_pack_story_definition_expected(
        &db,
        &pack_id,
        &story.definition,
        &story.baseline,
    )
    .unwrap();
    let exported = characters::export_pack(&db, &[center, guest], &[]).unwrap();
    assert_eq!(exported.format_version, 13);
    let target = store::open(Path::new(":memory:")).unwrap();
    let installed = characters::import_pack(&target, &exported).unwrap();
    let imported_pack = installed[0].pack_id.as_ref().unwrap();
    let story = characters::get_pack_story_definition(&target, imported_pack).unwrap();
    characters::save_pack_story_definition_expected(
        &target,
        imported_pack,
        &story.definition,
        &story.baseline,
    )
    .unwrap();
    let reexported = characters::export_pack(
        &target,
        &installed.iter().map(|c| c.id.clone()).collect::<Vec<_>>(),
        &[],
    )
    .unwrap();
    assert_eq!(reexported.format_version, 13);
    assert!(reexported.scenarios[0].reveal_affinity.is_some());
}

fn input(db: &Connection, center: &str, content: &str, epoch: u64) -> InputContext {
    let id = uuid::Uuid::new_v4().to_string();
    store::insert_user_input(
        db,
        &Message {
            id: id.clone(),
            role: "user".into(),
            persona: Some(center.into()),
            content: content.into(),
            expression: None,
            created_at: 1000,
            status: "complete".into(),
        },
        false,
    )
    .unwrap();
    InputContext {
        input_id: id,
        user_id: store::active_user_id(db).unwrap(),
        targets: vec![center.into()],
        epoch,
    }
}
fn proof(db: &Connection, plan: &Plan, ticket: &RunTicket) -> DisplayProof {
    let line = plan.lines.last().unwrap();
    let actor = characters::get(db, &line.persona).unwrap();
    store::insert_message_with_actor(
        db,
        &Message {
            id: ticket.last_playback_id.clone(),
            role: "assistant".into(),
            persona: Some(line.persona.clone()),
            content: line.text.clone(),
            expression: Some(line.expression.clone()),
            created_at: 1000,
            status: "complete".into(),
        },
        &plan.source,
        true,
        line,
        &actor,
    )
    .unwrap();
    store::mark_message_displayed(db, &ticket.last_playback_id, 1000).unwrap();
    let ends_at = 1000
        + crate::playback::line_duration_millis(
            &line.text,
            actor.definition.balloon_style.text_speed,
        );
    DisplayProof {
        playback_id: ticket.last_playback_id.clone(),
        input_id: ticket.input_id.clone(),
        display_started_at: Some(1000),
        ends_at,
        now: ends_at,
        epoch: ticket.epoch,
        participants: ticket.participants.clone(),
        pack_baseline: ticket.pack_baseline.clone(),
    }
}
#[test]
fn model_free_story_completion_requires_valid_final_duration_and_commits_once() {
    let (db, _, center, _) = fixture();
    let user = store::active_user_id(&db).unwrap();
    db.execute("INSERT INTO story_answers(request_id,character_id,scene_id,chapter,choice_id,user_id) VALUES('legacy-nadir',?1,'legacy-scene',2,'listen',?2)", params![center, user]).unwrap();
    let mut runtime = Runtime::default();
    let context = input(&db, &center, "이야기", 1);
    let intro = select(&db, &runtime, &context, "이야기").unwrap().unwrap();
    let ticket = bind_plan(&mut runtime, &intro, 1).unwrap();
    assert!(
        select(&db, &runtime, &input(&db, &center, "좋아", 2), "좋아")
            .unwrap()
            .is_none()
    );
    display_finished(&db, &mut runtime, &ticket, &proof(&db, &intro, &ticket)).unwrap();
    assert!(
        select(&db, &runtime, &input(&db, &center, "글쎄", 3), "글쎄")
            .unwrap()
            .is_none()
    );
    let accept = select(&db, &runtime, &input(&db, &center, "좋아", 4), "좋아")
        .unwrap()
        .unwrap();
    let ticket = bind_plan(&mut runtime, &accept, 4).unwrap();
    display_finished(&db, &mut runtime, &ticket, &proof(&db, &accept, &ticket)).unwrap();
    let ending = select(&db, &runtime, &input(&db, &center, "계속", 5), "계속")
        .unwrap()
        .unwrap();
    let ticket = bind_plan(&mut runtime, &ending, 5).unwrap();
    let mut evidence = proof(&db, &ending, &ticket);
    evidence.display_started_at = None;
    assert!(
        !display_finished(&db, &mut runtime, &ticket, &evidence)
            .unwrap()
            .completed
    );
    evidence.display_started_at = Some(1000);
    evidence.now = evidence.ends_at - 1;
    assert!(
        !display_finished(&db, &mut runtime, &ticket, &evidence)
            .unwrap()
            .completed
    );
    assert_eq!(
        db.query_row(
            "SELECT COUNT(*) FROM pack_story_outcomes WHERE kind='completed'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
    evidence.now = evidence.ends_at;
    let mut shortened = evidence.clone();
    shortened.ends_at = 1001;
    shortened.now = 1001;
    assert!(
        !display_finished(&db, &mut runtime, &ticket, &shortened)
            .unwrap()
            .completed
    );
    assert!(
        display_finished(&db, &mut runtime, &ticket, &evidence)
            .unwrap()
            .completed
    );
    assert!(
        !display_finished(&db, &mut runtime, &ticket, &evidence)
            .unwrap()
            .completed
    );
    assert_eq!(
        db.query_row(
            "SELECT COUNT(*) FROM pack_story_outcomes WHERE kind='accepted'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        1
    );
    assert_eq!(
        db.query_row(
            "SELECT COUNT(*) FROM pack_story_outcomes WHERE kind='completed'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        1
    );
    assert_eq!(
        db.query_row(
            "SELECT COUNT(*) FROM memories WHERE source LIKE 'moment:story-complete:%'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        1
    );
    let (source, source_text): (String, String) = db
        .query_row(
            "SELECT source,source_text FROM memories WHERE source LIKE 'moment:story-complete:%'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    let scenario_id = ticket.scenario_id.as_deref().unwrap();
    assert!(source.ends_with(&format!(":{scenario_id}")));
    let source_text: serde_json::Value = serde_json::from_str(&source_text).unwrap();
    assert_eq!(source_text["refs"]["scenarioId"], scenario_id);
    assert_eq!(
        db.query_row("SELECT COUNT(*) FROM story_answers", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert_eq!(
        db.query_row(
            "SELECT chapter,choice_id,user_id FROM story_answers WHERE request_id='legacy-nadir'",
            [],
            |row| Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?
            ))
        )
        .unwrap(),
        (2, "listen".into(), user),
    );
    assert_eq!(
        db.query_row("SELECT COUNT(*) FROM character_affinity", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
}
#[test]
fn cancelled_ending_has_zero_effects_and_retries_do_not_recreate_a_run() {
    let (db, _, center, _) = fixture();
    let mut runtime = Runtime::default();
    let context = input(&db, &center, "이야기", 1);
    let plan = select(&db, &runtime, &context, "이야기").unwrap().unwrap();
    let ticket = bind_plan(&mut runtime, &plan, 1).unwrap();
    let evidence = proof(&db, &plan, &ticket);
    let turn = count_input(&db, &context.input_id).unwrap();
    let retry = load_plan(&db, &context.input_id).unwrap().unwrap();
    assert_eq!(count_input(&db, &context.input_id).unwrap(), turn);
    bind_plan(&mut runtime, &retry, 2).unwrap();
    let before = db
        .query_row("SELECT COUNT(*) FROM pack_story_outcomes", [], |r| {
            r.get::<_, i64>(0)
        })
        .unwrap();
    cancel_with_progress(&db, &mut runtime).unwrap();
    assert!(
        !display_finished(&db, &mut runtime, &ticket, &evidence)
            .unwrap()
            .completed
    );
    assert!(bind_plan(&mut runtime, &retry, 3).is_err());
    assert_eq!(
        db.query_row("SELECT COUNT(*) FROM pack_story_outcomes", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        before + 1
    );
    for offset in 1..=3 {
        let next = input(&db, &center, "이야기", offset + 3);
        let choice = select(&db, &runtime, &next, "이야기").unwrap();
        assert_eq!(choice.is_some(), offset == 3);
    }
    assert_eq!(
        db.query_row(
            "SELECT COUNT(*) FROM memories WHERE source LIKE 'moment:story-complete:%'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
}
#[test]
fn restart_cancels_once_without_restoring_state_or_extending_wait() {
    let (db, _, center, _) = fixture();
    let runtime = Runtime::default();
    let context = input(&db, &center, "이야기", 1);
    select(&db, &runtime, &context, "이야기").unwrap().unwrap();
    recover_interrupted(&db).unwrap();
    let first: u64 = db
        .query_row("SELECT wait_turn FROM pack_story_progress", [], |r| {
            r.get(0)
        })
        .unwrap();
    count_input(&db, &input(&db, &center, "다른 말", 2).input_id).unwrap();
    recover_interrupted(&db).unwrap();
    assert_eq!(
        db.query_row("SELECT wait_turn FROM pack_story_progress", [], |r| r
            .get::<_, u64>(0))
            .unwrap(),
        first
    );
    assert!(Runtime::default().run.is_none());
    assert_eq!(
        db.query_row(
            "SELECT COUNT(*) FROM pack_story_outcomes WHERE kind='cancelled'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        1
    );
}
#[test]
fn cancelled_offer_respects_disabled_incomplete_repeat_after_three_new_inputs() {
    let (db, pack_id, center, _) = fixture();
    let mut snapshot = characters::get_pack_story_definition(&db, &pack_id).unwrap();
    snapshot.definition.scenarios[0].allow_incomplete_repeat = false;
    characters::save_pack_story_definition_expected(
        &db,
        &pack_id,
        &snapshot.definition,
        &snapshot.baseline,
    )
    .unwrap();
    let mut runtime = Runtime::default();
    let context = input(&db, &center, "이야기", 1);
    let plan = select(&db, &runtime, &context, "이야기").unwrap().unwrap();
    bind_plan(&mut runtime, &plan, 1).unwrap();
    cancel_with_progress(&db, &mut runtime).unwrap();
    for epoch in 2..=4 {
        count_input(&db, &input(&db, &center, "다른 말", epoch).input_id).unwrap();
    }
    assert!(
        select(&db, &runtime, &input(&db, &center, "이야기", 5), "이야기")
            .unwrap()
            .is_none()
    );
    assert_eq!(
        db.query_row(
            "SELECT COUNT(*) FROM pack_story_outcomes WHERE kind='accepted'",
            [],
            |row| row.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
    assert_eq!(
        db.query_row(
            "SELECT COUNT(*) FROM pack_story_outcomes WHERE kind='cancelled'",
            [],
            |row| row.get::<_, i64>(0)
        )
        .unwrap(),
        1
    );
}

#[test]
fn format8_round_trip_validation_trial_and_monotonic_aba_preserve_existing_data() {
    let (db, pack_id, center, guest) = fixture();
    let before = characters::get_pack_story_definition(&db, &pack_id).unwrap();
    let revision = store::revision(&db).unwrap();
    let same = characters::save_pack_story_definition_expected(
        &db,
        &pack_id,
        &before.definition,
        &before.baseline,
    )
    .unwrap();
    assert_eq!(same.baseline, before.baseline);
    let mut changed = before.definition.clone();
    changed.world_rules.push_str(" 변경");
    let changed_snapshot =
        characters::save_pack_story_definition_expected(&db, &pack_id, &changed, &before.baseline)
            .unwrap();
    let restored = characters::save_pack_story_definition_expected(
        &db,
        &pack_id,
        &before.definition,
        &changed_snapshot.baseline,
    )
    .unwrap();
    assert_ne!(restored.baseline, before.baseline);
    assert!(characters::save_pack_story_definition_expected(
        &db,
        &pack_id,
        &changed,
        &before.baseline
    )
    .is_err());
    assert!(characters::apply_roster(&db, vec![guest.clone()]).is_err());
    assert_eq!(characters::active_ids(&db).unwrap(), vec![center.clone()]);
    let mut actor = characters::get(&db, &center).unwrap();
    let actor_before = characters::character_definition_baseline(&db, &center).unwrap();
    let original = actor.definition.clone();
    actor.definition.description.push_str(" 변경");
    characters::save(&db, &center, &actor.definition).unwrap();
    characters::save(&db, &center, &original).unwrap();
    assert_ne!(
        characters::character_definition_baseline(&db, &center).unwrap(),
        actor_before
    );
    let exported = characters::export_pack(&db, &[center.clone(), guest], &[]).unwrap();
    assert_eq!(exported.format_version, 8);
    assert_eq!(exported.world_rules, before.definition.world_rules);
    let parsed = characters::parse_pack(&characters::pack_json(&exported).unwrap()).unwrap();
    assert_eq!(
        parsed.scenarios[0].intro[0].text,
        before.definition.scenarios[0].intro[0].text
    );
    let mut invalid = parsed.clone();
    invalid.knowledge[0].known_by.push("absent".into());
    assert!(characters::prepare_pack(invalid).is_err());
    let mut old = parsed.clone();
    old.format_version = 7;
    assert!(characters::prepare_pack(old).is_err());
    let trace = trial(
        &parsed.characters,
        &parsed.story_definition(),
        "one",
        &[],
        20,
        &["글쎄".into(), "좋아".into(), "계속".into()],
    )
    .unwrap();
    assert_eq!(trace.steps.len(), 3);
    assert_eq!(trace.steps[2].planned_effects.set_flags, vec!["done"]);
    assert_eq!(store::revision(&db).unwrap(), revision);
    assert_eq!(
        db.query_row("SELECT COUNT(*) FROM pack_story_outcomes", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
    let legacy = characters::factory_pack();
    assert!(legacy.story_definition().is_empty());
    assert!(legacy
        .characters
        .iter()
        .all(|actor| actor.presence_role == PresenceRole::Resident && actor.npc.is_none()));
    assert!(!characters::pack_json(&legacy)
        .unwrap()
        .contains("presenceRole"));
}

#[test]
fn format8_character_clones_keep_assets_relations_and_only_referenced_flag_declarations() {
    use crate::characters::animation::{
        Animation, Binding, Bindings, Clip, Frame, PackAnimationAsset,
    };
    use base64::Engine;
    use sha2::{Digest, Sha256};
    let (db, _, center, guest) = fixture();
    let mut pack = characters::export_pack(&db, &[center, guest], &[]).unwrap();
    let sources = pack
        .characters
        .iter()
        .map(|actor| actor.source_id.clone())
        .collect::<Vec<_>>();
    for (index, actor) in pack.characters.iter_mut().enumerate() {
        actor.relationships = vec![characters::CharacterRelationship {
            target_id: sources[1 - index].clone(),
            description: "기존 친구".into(),
            reply_lines: vec![characters::CharacterLine {
                expression: "평온".into(),
                text: "  관계 원문\n그대로  ".into(),
                motion: Default::default(),
            }],
        }];
    }
    pack.story_flags.push(StoryFlag {
        id: "unused".into(),
        public: true,
    });
    pack.characters[1].npc = Some(NpcDefinition {
        invite_keywords: vec!["복제 초대".into()],
        required_flags: vec!["done".into()],
        ..Default::default()
    });
    let atlas_bytes = include_bytes!("../../../character-packs/byulkkori-motions/atlas.png");
    let asset_id = format!("{:x}", Sha256::digest(atlas_bytes));
    let atlas = base64::engine::general_purpose::STANDARD.encode(atlas_bytes);
    for actor in &mut pack.characters {
        actor.animation = Some(Animation {
            clips: vec![Clip {
                id: "idle".into(),
                name: "대기".into(),
                fps: 8,
                frames: vec![Frame {
                    asset_id: asset_id.clone(),
                    x: 0,
                    y: 0,
                    width: 64,
                    height: 64,
                }],
            }],
            bindings: Bindings {
                idle: Some(Binding {
                    clip_id: "idle".into(),
                    repeat: true,
                    interval_ms: 0,
                }),
                ..Default::default()
            },
            ..Default::default()
        });
        pack.animation_assets.push(PackAnimationAsset {
            source_id: actor.source_id.clone(),
            asset_id: asset_id.clone(),
            mime: "image/png".into(),
            width: 512,
            height: 832,
            data: atlas.clone(),
        });
        pack.sprites.push(characters::PackSprite {
            source_id: actor.source_id.clone(),
            expression: "평온".into(),
            mime: "image/png".into(),
            data: atlas.clone(),
        });
    }
    let installed = characters::import_pack(&db, &pack).unwrap();
    characters::apply_roster(&db, vec![installed[0].id.clone()]).unwrap();
    let original_pack = installed[0].pack_id.as_ref().unwrap();
    let baseline = characters::pack_definition_baseline(&db, original_pack).unwrap();
    let original_scope = Scope {
        user_id: store::active_user_id(&db).unwrap(),
        pack_id: original_pack.clone(),
        center_id: installed[0].id.clone(),
    };
    db.execute(
        "INSERT INTO pack_story_progress VALUES(?1,42,?2)",
        params![
            scope_key(&original_scope).unwrap(),
            serde_json::to_string(&vec!["done"]).unwrap()
        ],
    )
    .unwrap();
    assert!(characters::export_pack(&db, &[installed[0].id.clone()], &[]).is_err());
    let mut cloned_npc = None;
    for original in &installed {
        let cloned = characters::clone_character(&db, &original.id).unwrap();
        assert_ne!(cloned.id, original.id);
        assert_eq!(cloned.definition, original.definition);
        assert_eq!(cloned.animation_assets, original.animation_assets);
        assert_eq!(
            crate::characters::animation::all(&db, &cloned.id)
                .unwrap()
                .iter()
                .map(|asset| asset.payload())
                .collect::<Vec<_>>(),
            crate::characters::animation::all(&db, &original.id)
                .unwrap()
                .iter()
                .map(|asset| asset.payload())
                .collect::<Vec<_>>()
        );
        assert_eq!(
            crate::characters::sprites::all(&db, &cloned.id).unwrap(),
            crate::characters::sprites::all(&db, &original.id).unwrap()
        );
        let definition =
            characters::get_pack_story_definition(&db, cloned.pack_id.as_ref().unwrap())
                .unwrap()
                .definition;
        assert!(definition.world_rules.is_empty());
        assert!(definition.knowledge.is_empty());
        assert!(definition.scenarios.is_empty());
        if cloned.definition.presence_role == PresenceRole::Npc {
            assert_eq!(
                definition.story_flags,
                vec![StoryFlag {
                    id: "done".into(),
                    public: false
                }]
            );
            assert!(characters::npc_only_pack(&db, cloned.pack_id.as_ref().unwrap()).unwrap());
            cloned_npc = Some(cloned);
        } else {
            assert!(definition.story_flags.is_empty());
        }
    }
    assert_eq!(
        characters::pack_definition_baseline(&db, original_pack).unwrap(),
        baseline
    );
    assert_eq!(
        db.query_row("SELECT COUNT(*) FROM pack_story_progress", [], |row| row
            .get::<_, i64>(0))
            .unwrap(),
        1
    );
    let mut cloned = cloned_npc.unwrap();
    assert_eq!(
        progress_flags(&db, &original_scope).unwrap(),
        BTreeSet::from(["done".into()])
    );
    let cloned_scope = Scope {
        pack_id: cloned.pack_id.clone().unwrap(),
        ..original_scope.clone()
    };
    assert!(progress_flags(&db, &cloned_scope).unwrap().is_empty());
    cloned
        .definition
        .npc
        .as_mut()
        .unwrap()
        .required_flags
        .clear();
    characters::save(&db, &cloned.id, &cloned.definition).unwrap();
    let context = input(&db, &installed[0].id, "복제 초대", 1);
    let entry = select(&db, &Runtime::default(), &context, "복제 초대")
        .unwrap()
        .unwrap();
    assert_eq!(entry.run.stage, Stage::Entry);
    assert_eq!(entry.run.scope.center_id, installed[0].id);
    assert_eq!(entry.run.scope.pack_id, cloned.pack_id.unwrap());
    assert_eq!(entry.required_guest_ids, vec![cloned.id]);
}

#[test]
fn removed_npc_references_can_be_repaired_without_restoring_the_deleted_character() {
    let (db, pack_id, center, guest) = fixture();
    characters::remove(&db, &guest).unwrap();
    let snapshot = characters::get_pack_story_definition(&db, &pack_id).unwrap();
    assert_eq!(snapshot.source_to_local.len(), 1);
    assert!(characters::save_pack_story_definition_expected(
        &db,
        &pack_id,
        &snapshot.definition,
        &snapshot.baseline,
    )
    .is_err());
    let mut repaired = snapshot.definition.clone();
    let source = characters::get(&db, &center).unwrap().definition.source_id;
    repaired.scenarios[0].participants = vec![source];
    let saved = characters::save_pack_story_definition_expected(
        &db,
        &pack_id,
        &repaired,
        &snapshot.baseline,
    )
    .unwrap();
    assert_eq!(saved.definition, repaired);
    assert!(characters::get(&db, &guest).is_err());
    let exported = characters::export_pack(&db, &[center], &[]).unwrap();
    assert_eq!(exported.characters.len(), 1);
    assert_eq!(exported.scenarios[0].participants.len(), 1);
    assert!(characters::prepare_pack(exported).is_ok());
}

#[test]
fn format8_rejects_unsupported_or_unbounded_definitions_before_writes() {
    let (db, pack_id, center, guest) = fixture();
    let pack = characters::export_pack(&db, &[center, guest], &[]).unwrap();
    type InvalidPackCase = (&'static str, fn(&mut characters::CharacterPack));
    let cases: Vec<InvalidPackCase> = vec![
        ("duplicate source", |pack| {
            pack.characters[1].source_id = pack.characters[0].source_id.clone();
        }),
        ("NPC center", |pack| {
            pack.scenarios[0].center_id = pack.characters[1].source_id.clone();
        }),
        ("no participants", |pack| {
            pack.scenarios[0].participants.clear()
        }),
        ("foreign speaker", |pack| {
            pack.scenarios[0].intro[0].persona = "absent".into();
        }),
        ("33 phase lines", |pack| {
            pack.scenarios[0].ending = vec![pack.scenarios[0].ending[0].clone(); 33];
        }),
        ("unknown branch", |pack| {
            pack.scenarios[0].accept_next_id = Some("absent".into());
        }),
        ("unknown flag", |pack| {
            pack.scenarios[0].completion.set_flags.push("absent".into());
        }),
        ("world bounds", |pack| pack.world_rules = "가".repeat(2001)),
        ("lore bounds", |pack| {
            pack.knowledge[0].text = "가".repeat(2001)
        }),
        ("empty knownBy", |pack| pack.knowledge[0].known_by.clear()),
        ("duplicate knownBy", |pack| {
            let source = pack.knowledge[0].known_by[0].clone();
            pack.knowledge[0].known_by.push(source);
        }),
        ("expanded memory bounds", |pack| {
            pack.scenarios[0].title = "가".repeat(80);
            pack.scenarios[0].completion.memory_template = Some("{scenarioTitle}".repeat(7));
        }),
    ];
    let baseline = characters::get_pack_story_definition(&db, &pack_id).unwrap();
    for (name, mutate) in cases {
        let mut invalid = pack.clone();
        mutate(&mut invalid);
        assert!(characters::prepare_pack(invalid.clone()).is_err(), "{name}");
        if name != "duplicate source" {
            assert!(
                characters::save_pack_story_definition_expected(
                    &db,
                    &pack_id,
                    &invalid.story_definition(),
                    &baseline.baseline,
                )
                .is_err(),
                "{name}"
            );
        }
        assert_eq!(
            characters::get_pack_story_definition(&db, &pack_id)
                .unwrap()
                .baseline,
            baseline.baseline,
            "{name}",
        );
    }
    let mut unknown_line = serde_json::to_value(&pack).unwrap();
    unknown_line["scenarios"][0]["intro"][0]["extra"] = true.into();
    assert!(characters::parse_pack(&unknown_line.to_string()).is_err());
    let mut rewards = serde_json::to_value(&pack).unwrap();
    rewards["scenarios"][0]["completion"]["reward"] = 1.into();
    assert!(characters::parse_pack(&rewards.to_string()).is_err());
}

#[test]
fn candidate_selection_uses_each_declared_resident_scope_and_same_pack_invitation() {
    let (db, _, foreign_center, guest) = fixture();
    let mut pack = characters::export_pack(&db, &[foreign_center.clone(), guest], &[]).unwrap();
    let mut second_center = pack.characters[0].clone();
    second_center.source_id = "second-center".into();
    pack.characters.push(second_center.clone());
    pack.characters[1].npc = Some(NpcDefinition {
        invite_keywords: vec!["초대".into()],
        ..Default::default()
    });
    let scenario = &mut pack.scenarios[0];
    scenario.center_id = second_center.source_id.clone();
    scenario.participants[0] = second_center.source_id.clone();
    for line in scenario
        .intro
        .iter_mut()
        .chain(&mut scenario.accept)
        .chain(&mut scenario.decline)
        .chain(&mut scenario.ending)
    {
        line.persona = second_center.source_id.clone();
    }
    let installed = characters::import_pack(&db, &pack).unwrap();
    characters::apply_roster(
        &db,
        vec![
            foreign_center.clone(),
            installed[0].id.clone(),
            installed[2].id.clone(),
        ],
    )
    .unwrap();
    let mut context = input(&db, &installed[0].id, "이야기", 1);
    context.targets.push(installed[2].id.clone());
    let selected = select(&db, &Runtime::default(), &context, "이야기")
        .unwrap()
        .unwrap();
    assert_eq!(selected.run.scope.center_id, installed[2].id);

    let mut context = input(&db, &foreign_center, "초대", 2);
    context.targets.push(installed[2].id.clone());
    let invitation = select(&db, &Runtime::default(), &context, "초대")
        .unwrap()
        .unwrap();
    assert_eq!(invitation.run.scope.center_id, installed[2].id);
    assert_eq!(invitation.required_guest_ids, vec![installed[1].id.clone()]);

    let unrelated = input(&db, &foreign_center, "초대", 3);
    assert!(select(&db, &Runtime::default(), &unrelated, "초대")
        .unwrap()
        .is_none());
}

#[test]
fn cancellation_after_a_shown_ending_grants_no_completion_or_memory() {
    let (db, _, center, _) = fixture();
    let mut runtime = Runtime::default();
    let mut final_stage = None;
    for (index, text) in ["이야기", "좋아", "계속"].iter().enumerate() {
        let context = input(&db, &center, text, index as u64 + 1);
        let plan = select(&db, &runtime, &context, text).unwrap().unwrap();
        let ticket = bind_plan(&mut runtime, &plan, index as u64 + 1).unwrap();
        let evidence = proof(&db, &plan, &ticket);
        if index < 2 {
            display_finished(&db, &mut runtime, &ticket, &evidence).unwrap();
        } else {
            final_stage = Some((ticket, evidence));
        }
    }
    let (ticket, evidence) = final_stage.unwrap();
    assert!(!store::message_finished(&db, &ticket.last_playback_id).unwrap());
    cancel_with_progress(&db, &mut runtime).unwrap();
    assert!(
        !display_finished(&db, &mut runtime, &ticket, &evidence)
            .unwrap()
            .completed
    );
    assert_eq!(
        db.query_row(
            "SELECT COUNT(*) FROM pack_story_outcomes WHERE kind='completed'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
    assert_eq!(
        db.query_row(
            "SELECT COUNT(*) FROM memories WHERE source LIKE 'moment:story-complete:%'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
}

#[test]
fn explicit_invitation_keeps_resident_scope_and_only_a_selected_scene_replaces_entry() {
    let (db, _, center, guest) = fixture();
    let mut actor = characters::get(&db, &guest).unwrap();
    actor.definition.npc = Some(NpcDefinition {
        invite_keywords: vec!["불러줘".into()],
        entry_lines: actor.definition.greeting.clone(),
        ..Default::default()
    });
    characters::save(&db, &guest, &actor.definition).unwrap();
    let mut runtime = Runtime::default();
    assert!(select(
        &db,
        &runtime,
        &input(&db, &center, &actor.definition.name, 1),
        &actor.definition.name
    )
    .unwrap()
    .is_none());
    let entry = select(&db, &runtime, &input(&db, &center, "불러줘", 2), "불러줘")
        .unwrap()
        .unwrap();
    assert_eq!(entry.run.scope.center_id, center);
    assert_eq!(entry.required_guest_ids, vec![guest]);
    let ticket = bind_plan(&mut runtime, &entry, 2).unwrap();
    display_finished(&db, &mut runtime, &ticket, &proof(&db, &entry, &ticket)).unwrap();
    for content in [" 그만 ", "다른 이야기", "화제 바꾸자"] {
        assert!(cancellation_requested(&runtime, content));
    }
    for content in ["그만이라고 말했어", "다른 이야기를 들었어", "이야기"] {
        assert!(!cancellation_requested(&runtime, content));
    }
    assert!(
        select(&db, &runtime, &input(&db, &center, "불러줘", 3), "불러줘")
            .unwrap()
            .is_none()
    );
    assert_eq!(runtime.run.as_ref().unwrap().run_id, entry.run_id);
    let scene = select(&db, &runtime, &input(&db, &center, "이야기", 4), "이야기")
        .unwrap()
        .unwrap();
    assert_eq!(scene.replaced_run_id, Some(entry.run_id.clone()));
    assert_eq!(runtime.run.as_ref().unwrap().run_id, entry.run_id);
}
#[test]
fn deferred_cancel_flush_is_atomic_and_recovery_preserves_wait_after_a_failed_write() {
    let (db, _, center, _) = fixture();
    let mut runtime = Runtime::default();
    let plan = select(&db, &runtime, &input(&db, &center, "이야기", 1), "이야기")
        .unwrap()
        .unwrap();
    bind_plan(&mut runtime, &plan, 1).unwrap();
    cancel_deferred(&mut runtime);
    assert!(runtime.run.is_none());
    assert_eq!(runtime.pending_cancellations.len(), 1);
    db.execute_batch("CREATE TRIGGER fail_cancel BEFORE INSERT ON pack_story_outcomes BEGIN SELECT RAISE(ABORT,'storage failed'); END;").unwrap();
    assert!(flush_cancellations(&db, &mut runtime).is_err());
    assert_eq!(runtime.pending_cancellations.len(), 1);
    assert_eq!(
        db.query_row("SELECT COUNT(*) FROM pack_story_outcomes", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
    db.execute_batch("DROP TRIGGER fail_cancel;").unwrap();
    flush_cancellations(&db, &mut runtime).unwrap();
    assert!(runtime.pending_cancellations.is_empty());
    let wait: u64 = db
        .query_row("SELECT wait_turn FROM pack_story_progress", [], |r| {
            r.get(0)
        })
        .unwrap();
    recover_interrupted(&db).unwrap();
    assert_eq!(
        db.query_row("SELECT wait_turn FROM pack_story_progress", [], |r| r
            .get::<_, u64>(0))
            .unwrap(),
        wait
    );
}

fn scene_schema_fixture() -> (Vec<CharacterDefinition>, PackStoryDefinition) {
    let (db, _, center, guest) = fixture();
    let pack = characters::export_pack(&db, &[center, guest], &[]).unwrap();
    let mut extras = pack.story_definition();
    let scene = &mut extras.scenarios[0];
    scene.intro.clear();
    scene.accept.clear();
    scene.decline.clear();
    scene.ending.clear();
    scene.accept_keywords.clear();
    scene.decline_keywords.clear();
    scene.proceed_keywords.clear();
    scene.cancel_keywords.clear();
    scene.chapters = Some(serde_json::from_value(serde_json::json!([{
        "id": "start", "title": "시작", "steps": [
            {"kind":"ask", "id":"name", "persona":scene.center_id, "expression":"평온", "prompt":"이름은?", "input":"name", "known":"반가워요 {userName}"},
            {"kind":"ask", "id":"topic", "persona":scene.center_id, "expression":"평온", "prompt":"무엇을 좋아해요?", "input":"text"},
            {"kind":"line", "persona":scene.center_id, "expression":"평온", "text":"{userName}님, {answer.topic}!"},
            {"kind":"action", "do":"widget.open", "widget":"focus-timer"},
            {"kind":"wait", "event":"focus.started", "timeoutSec":90, "cancelOn":[{"event":"window.closed", "window":"focus-timer"}], "onTimeout":{"steps":[{"kind":"action", "do":"focus.start", "minutes":5}], "then":"next"}},
            {"kind":"choice", "persona":scene.center_id, "expression":"평온", "prompt":"고르세요", "options":[{"id":"a", "label":"계속", "goto":"next"}, {"id":"b", "label":"끝", "goto":"end"}]}
        ]
    }])).unwrap());
    (pack.characters, extras)
}

#[test]
fn chapter_schema_validates_and_round_trips_all_step_types() {
    let (characters, mut extras) = scene_schema_fixture();
    let scene = &mut extras.scenarios[0];
    scene.purpose = ScenarioPurpose::Tutorial;
    scene.chapters.as_mut().unwrap()[0].steps.push(
        serde_json::from_value(
            serde_json::json!({"kind":"move", "persona":scene.center_id, "enter":"left"}),
        )
        .unwrap(),
    );
    validate_pack(&characters, &extras).unwrap();
    let encoded = serde_json::to_string(&extras).unwrap();
    assert_eq!(
        serde_json::from_str::<PackStoryDefinition>(&encoded).unwrap(),
        extras
    );
}

#[test]
fn choice_option_ids_are_unique_within_each_choice() {
    let (characters, mut extras) = scene_schema_fixture();
    let steps = &mut extras.scenarios[0].chapters.as_mut().unwrap()[0].steps;
    let choice = steps.last().unwrap().clone();
    if let StoryStep::Choice { options, .. } = &choice {
        assert_eq!((&options[0].id[..], &options[0].goto[..]), ("a", "next"));
        assert_eq!((&options[1].id[..], &options[1].goto[..]), ("b", "end"));
    } else {
        panic!("fixture must end with a choice");
    }
    validate_pack(&characters, &extras).unwrap();

    let mut duplicate = extras.clone();
    if let StoryStep::Choice { options, .. } = duplicate.scenarios[0].chapters.as_mut().unwrap()[0]
        .steps
        .last_mut()
        .unwrap()
    {
        options[1].id = options[0].id.clone();
    } else {
        panic!("fixture must end with a choice");
    }
    assert_eq!(
        validate_pack(&characters, &duplicate).unwrap_err(),
        "선택지 ID·표시 문구를 확인해 주세요."
    );

    extras.scenarios[0].chapters.as_mut().unwrap()[0]
        .steps
        .push(choice);
    validate_pack(&characters, &extras).unwrap();
}

#[test]
fn tutorial_rejects_proposal_story_without_chapters() {
    let (db, _, center, guest) = fixture();
    let pack = characters::export_pack(&db, &[center, guest], &[]).unwrap();
    let mut proposal = pack.story_definition();
    validate_pack(&pack.characters, &proposal).unwrap();
    proposal.scenarios[0].purpose = ScenarioPurpose::Tutorial;

    let original = serde_json::to_value(&proposal).unwrap();
    for chapters in [None, Some(serde_json::Value::Null)] {
        let mut input = original.clone();
        if let Some(chapters) = chapters {
            input["scenarios"][0]["chapters"] = chapters;
        }
        let parsed: PackStoryDefinition = serde_json::from_value(input).unwrap();
        assert_eq!(
            validate_pack(&pack.characters, &parsed).unwrap_err(),
            "튜토리얼은 장면형 이야기로만 만들 수 있어요."
        );
    }

    let (characters, mut extras) = scene_schema_fixture();
    extras.scenarios[0].purpose = ScenarioPurpose::Tutorial;
    let mut invalid = extras.scenarios[0].clone();
    invalid.chapters = None;
    invalid.title.clear();
    extras.scenarios.push(invalid);
    assert_eq!(
        validate_pack(&characters, &extras).unwrap_err(),
        "튜토리얼은 장면형 이야기로만 만들 수 있어요."
    );
}

#[test]
fn chapter_schema_rejects_wrong_shapes_and_unsupported_targets() {
    for value in [
        serde_json::json!({"kind":"line", "persona":"p", "expression":"e", "text":"x", "extra":true}),
        serde_json::json!({"kind":"action", "do":"widget.open", "widget":"unknown"}),
        serde_json::json!({"kind":"action", "do":"focus.stop", "minutes":5}),
        serde_json::json!({"kind":"action", "do":"guide.open", "page":"unknown"}),
        serde_json::json!({"kind":"wait", "event":"widget.saved", "widget":"todo", "timeoutSec":90, "onTimeout":{"steps":[], "then":"end"}}),
        serde_json::json!({"kind":"wait", "event":"body.clicked", "window":"settings", "timeoutSec":90, "onTimeout":{"steps":[], "then":"end"}}),
    ] {
        assert!(serde_json::from_value::<StoryStep>(value).is_err());
    }
}

#[test]
fn chapter_schema_rejects_invalid_scenes() {
    let (characters, extras) = scene_schema_fixture();
    let original = serde_json::to_value(&extras).unwrap();
    let invalid = [
        (
            "/scenarios/0/intro",
            serde_json::json!([{"persona":"bad", "expression":"평온", "text":"x"}]),
        ),
        ("/scenarios/0/chapters", serde_json::json!([])),
        ("/scenarios/0/chapters/0/steps", serde_json::json!([])),
        ("/scenarios/0/chapters/0/title", serde_json::json!("")),
        ("/scenarios/0/chapters/0/next", serde_json::json!("missing")),
        (
            "/scenarios/0/chapters/0/steps/0/known",
            serde_json::Value::Null,
        ),
        (
            "/scenarios/0/chapters/0/steps/2/text",
            serde_json::json!(""),
        ),
        (
            "/scenarios/0/chapters/0/steps/2/persona",
            serde_json::json!("missing"),
        ),
        (
            "/scenarios/0/chapters/0/steps/2/expression",
            serde_json::json!("missing"),
        ),
        (
            "/scenarios/0/chapters/0/steps/4/timeoutSec",
            serde_json::json!(9),
        ),
        (
            "/scenarios/0/chapters/0/steps/4/onTimeout/then",
            serde_json::json!("missing"),
        ),
        (
            "/scenarios/0/chapters/0/steps/4/onTimeout/steps/0/minutes",
            serde_json::json!(61),
        ),
        (
            "/scenarios/0/chapters/0/steps/5/options/0/goto",
            serde_json::json!("missing"),
        ),
        (
            "/scenarios/0/chapters/0/steps/5/options/0/label",
            serde_json::json!(""),
        ),
        (
            "/scenarios/0/chapters/0/steps/2/text",
            serde_json::json!("{answer.missing}"),
        ),
        (
            "/scenarios/0/chapters/0/steps/0/prompt",
            serde_json::json!("{userName}"),
        ),
    ];
    for (path, value) in invalid {
        let mut input = original.clone();
        if path == "/scenarios/0/chapters/0/next" {
            input["scenarios"][0]["chapters"][0]["next"] = value;
        } else {
            *input.pointer_mut(path).unwrap() = value;
        }
        let parsed: PackStoryDefinition = serde_json::from_value(input).unwrap();
        assert!(validate_pack(&characters, &parsed).is_err(), "{path}");
    }
    let mut duplicate = extras.clone();
    let mut second = duplicate.scenarios[0].clone();
    duplicate.scenarios[0].purpose = ScenarioPurpose::Tutorial;
    second.purpose = ScenarioPurpose::Tutorial;
    second.id = "other".into();
    duplicate.scenarios.push(second);
    assert!(validate_pack(&characters, &duplicate).is_err());
}

#[test]
fn chapter_schema_rejects_unconditional_cycles_and_name_bypasses() {
    let (characters, extras) = scene_schema_fixture();
    let mut cycle = extras.clone();
    let chapter = &mut cycle.scenarios[0].chapters.as_mut().unwrap()[0];
    chapter
        .steps
        .retain(|step| matches!(step, StoryStep::Line { .. } | StoryStep::Action { .. }));
    chapter.next = Some("start".into());
    assert!(validate_pack(&characters, &cycle).is_err());

    let mut bypass = extras.clone();
    let scene = &mut bypass.scenarios[0];
    let chapters = scene.chapters.as_mut().unwrap();
    let first = serde_json::from_value(serde_json::json!({"id":"branch", "title":"선택", "steps":[
        {"kind":"choice", "persona":scene.center_id, "expression":"평온", "prompt":"고르세요", "options":[{"id":"a", "label":"다음", "goto":"next"}, {"id":"b", "label":"건너뛰기", "goto":"after"}]}
    ]})).unwrap();
    let last = serde_json::from_value(serde_json::json!({"id":"after", "title":"뒤", "steps":[{"kind":"line", "persona":scene.center_id, "expression":"평온", "text":"{userName}"}]})).unwrap();
    chapters.insert(0, first);
    chapters.push(last);
    assert!(validate_pack(&characters, &bypass).is_err());
}

#[test]
fn chapter_schema_enforces_count_limits_and_story_size() {
    let (characters, extras) = scene_schema_fixture();
    let mut value = serde_json::to_value(&extras).unwrap();
    let chapter = value["scenarios"][0]["chapters"][0].clone();
    let check = |candidate: serde_json::Value| {
        let scene = serde_json::from_value::<PackStoryDefinition>(candidate).unwrap();
        assert!(validate_pack(&characters, &scene).is_err());
    };
    value["scenarios"][0]["chapters"] = serde_json::json!(vec![chapter.clone(); 13]);
    check(value.clone());
    value = serde_json::to_value(&extras).unwrap();
    value["scenarios"][0]["chapters"][0]["steps"] =
        serde_json::json!(vec![chapter["steps"][2].clone(); 33]);
    check(value.clone());
    value = serde_json::to_value(&extras).unwrap();
    value["scenarios"][0]["chapters"][0]["steps"][5]["options"] =
        serde_json::json!([{"id":"a", "label":"하나", "goto":"end"}]);
    check(value.clone());
    value = serde_json::to_value(&extras).unwrap();
    value["scenarios"][0]["chapters"][0]["steps"][4]["onTimeout"]["steps"] =
        serde_json::json!(vec![chapter["steps"][3].clone(); 5]);
    check(value.clone());
    value = serde_json::to_value(&extras).unwrap();
    value["scenarios"][0]["chapters"][0]["steps"][4]["onTimeout"]["steps"] =
        serde_json::json!([chapter["steps"][0].clone()]);
    check(value);

    let mut large_scene = extras.clone();
    let persona = large_scene.scenarios[0].center_id.clone();
    let line = StoryStep::Line {
        persona: persona.clone(),
        expression: "평온".into(),
        text: "가".repeat(500),
        motion: Default::default(),
    };
    large_scene.scenarios[0].chapters = Some(
        (0..4)
            .map(|index| Chapter {
                id: format!("chapter-{index}"),
                title: "장".into(),
                next: None,
                steps: vec![line.clone(); 32],
            })
            .collect(),
    );
    assert!(validate_pack(&characters, &large_scene).is_err());

    let mut proposal = extras;
    let scene = &mut proposal.scenarios[0];
    scene.chapters = None;
    let proposal_line = SceneLine {
        persona,
        expression: "평온".into(),
        text: "가".repeat(500),
        widget: None,
        motion: Default::default(),
    };
    scene.intro = vec![proposal_line.clone(); 24];
    scene.accept = vec![proposal_line.clone(); 32];
    scene.decline = vec![proposal_line.clone(); 32];
    scene.ending = vec![proposal_line; 32];
    assert!(serde_json::to_vec(scene).unwrap().len() > 128 * 1024);
    validate_pack(&characters, &proposal).unwrap();
}

#[test]
fn chapter_schema_rejects_additional_invalid_values() {
    let (characters, extras) = scene_schema_fixture();
    let original = serde_json::to_value(&extras).unwrap();
    let cases = [
        (
            "/scenarios/0/chapters/0/steps/0/known",
            serde_json::json!(""),
        ),
        (
            "/scenarios/0/chapters/0/steps/0/prompt",
            serde_json::json!("가".repeat(501)),
        ),
        (
            "/scenarios/0/chapters/0/steps/2/text",
            serde_json::json!("가".repeat(501)),
        ),
        (
            "/scenarios/0/chapters/0/steps/2/motion",
            serde_json::json!({"mode":"clip", "clipId":"missing", "repeat":true, "intervalMs":0}),
        ),
        (
            "/scenarios/0/chapters/0/steps/4/timeoutSec",
            serde_json::json!(901),
        ),
        (
            "/scenarios/0/chapters/0/steps/5/options/0/label",
            serde_json::json!("가".repeat(21)),
        ),
    ];
    for (path, value) in cases {
        let mut input = original.clone();
        if path.ends_with("/motion") {
            input["scenarios"][0]["chapters"][0]["steps"][2]["motion"] = value;
        } else {
            *input.pointer_mut(path).unwrap() = value;
        }
        let parsed: PackStoryDefinition = serde_json::from_value(input).unwrap();
        assert!(validate_pack(&characters, &parsed).is_err(), "{path}");
    }

    let mut duplicate = extras.clone();
    let chapters = duplicate.scenarios[0].chapters.as_mut().unwrap();
    chapters.push(chapters[0].clone());
    assert!(validate_pack(&characters, &duplicate).is_err());

    let mut no_story = extras.clone();
    no_story.scenarios[0].chapters = None;
    assert!(validate_pack(&characters, &no_story).is_err());

    let mut too_many = extras.clone();
    let scenario = too_many.scenarios[0].clone();
    too_many.scenarios = (0..33)
        .map(|index| {
            let mut scenario = scenario.clone();
            scenario.id = format!("story-{index}");
            scenario
        })
        .collect();
    assert!(validate_pack(&characters, &too_many).is_err());
}

#[test]
fn chapter_answers_expire_at_chapter_boundaries() {
    let (characters, mut extras) = scene_schema_fixture();
    let scenario = &mut extras.scenarios[0];
    let chapters = scenario.chapters.as_mut().unwrap();
    chapters.push(Chapter {
        id: "next-chapter".into(),
        title: "다음 장".into(),
        next: None,
        steps: vec![StoryStep::Line {
            persona: scenario.center_id.clone(),
            expression: "평온".into(),
            text: "{answer.topic}".into(),
            motion: Default::default(),
        }],
    });
    assert!(validate_pack(&characters, &extras).is_err());
}

fn resume_fixture() -> (Connection, RunTicket) {
    let (db, pack_id, center, _) = fixture();
    store::set_user_name(&db, "사용자", 1000).unwrap();
    let context = input(&db, &center, "이야기", 1);
    let mut run = select(&db, &Runtime::default(), &context, "이야기")
        .unwrap().unwrap().run;
    let mut snapshot = characters::get_pack_story_definition(&db, &pack_id).unwrap();
    let definition = &mut snapshot.definition.scenarios[0];
    definition.intro.clear();
    definition.accept.clear();
    definition.decline.clear();
    definition.ending.clear();
    definition.accept_keywords.clear();
    definition.decline_keywords.clear();
    definition.proceed_keywords.clear();
    definition.cancel_keywords.clear();
    definition.completion = CompletionEffects::default();
    definition.chapters = Some(serde_json::from_value(serde_json::json!([
        {"id":"first", "title":"첫 장", "steps":[{"kind":"line", "persona":definition.center_id, "expression":"평온", "text":"첫 줄"}]},
        {"id":"second", "title":"둘째 장", "steps":[{"kind":"line", "persona":definition.center_id, "expression":"평온", "text":"다음 줄"}]}
    ])).unwrap());
    let saved = characters::save_pack_story_definition_expected(&db, &pack_id, &snapshot.definition, &snapshot.baseline).unwrap();
    run.definition = Some(saved.definition.scenarios[0].clone());
    run.pack_baseline = saved.baseline;
    (db, run)
}

#[test]
fn chapter_tutorial_plan_uses_tutorial_source() {
    let (db, run) = resume_fixture();
    let mut snapshot = characters::get_pack_story_definition(&db, &run.scope.pack_id).unwrap();
    snapshot.definition.scenarios[0].purpose = ScenarioPurpose::Tutorial;
    characters::save_pack_story_definition_expected(
        &db,
        &run.scope.pack_id,
        &snapshot.definition,
        &snapshot.baseline,
    )
    .unwrap();

    let context = input(&db, &run.scope.center_id, "이야기", 2);
    let plan = select(&db, &Runtime::default(), &context, "이야기")
        .unwrap()
        .unwrap();
    assert_eq!(plan.run.stage, Stage::Chapter);
    assert_eq!(plan.source, "tutorial");
    assert_eq!(plan.run.chapter_id.as_deref(), Some("first"));
}

#[test]
fn resume_persists_chapter_and_falls_back_when_pack_removes_it() {
    let (db, run) = resume_fixture();
    resume::record_accepted(&db, &run).unwrap();
    resume::save_chapter(&db, &run, "second", 100).unwrap();
    let point = resume::load_for_scope(&db, &run.scope).unwrap().remove(0);
    assert_eq!(resume::resolve(&db, &run.scope, &point).unwrap().unwrap().chapter_id, "second");

    let mut snapshot = characters::get_pack_story_definition(&db, &run.scope.pack_id).unwrap();
    snapshot.definition.scenarios[0].chapters.as_mut().unwrap().pop();
    characters::save_pack_story_definition_expected(&db, &run.scope.pack_id, &snapshot.definition, &snapshot.baseline).unwrap();
    let resolved = resume::resolve(&db, &run.scope, &point).unwrap().unwrap();
    assert_eq!(resolved.chapter_id, "first");
    assert_eq!(resolved.chapter_title, "첫 장");
    assert_ne!(characters::get_pack_story_definition(&db, &run.scope.pack_id).unwrap().baseline, point.pack_baseline);
    assert!(resume::save_chapter(&db, &run, "first", 200).is_err());
}

#[test]
fn resume_decline_deletes_only_the_offered_point_and_rolls_back_on_error() {
    let (db, run) = resume_fixture();
    resume::record_accepted(&db, &run).unwrap();
    resume::save_chapter(&db, &run, "first", 100).unwrap();
    let stale = resume::load_for_scope(&db, &run.scope).unwrap().remove(0);
    resume::save_chapter(&db, &run, "second", 200).unwrap();
    assert!(!resume::decline(&db, &run.scope, &stale).unwrap());
    let current = resume::load_for_scope(&db, &run.scope).unwrap().remove(0);
    db.execute_batch("CREATE TRIGGER fail_resume_decline BEFORE INSERT ON pack_story_outcomes WHEN NEW.kind='declined' BEGIN SELECT RAISE(ABORT, 'failed'); END;").unwrap();
    assert!(resume::decline(&db, &run.scope, &current).is_err());
    assert_eq!(resume::load_for_scope(&db, &run.scope).unwrap(), vec![current.clone()]);
    db.execute_batch("DROP TRIGGER fail_resume_decline").unwrap();
    assert!(resume::decline(&db, &run.scope, &current).unwrap());
    assert!(resume::load_for_scope(&db, &run.scope).unwrap().is_empty());
    let (count, run_id): (i64, String) = db.query_row("SELECT COUNT(*),run_id FROM pack_story_outcomes WHERE kind='declined'", [], |row| Ok((row.get(0)?, row.get(1)?))).unwrap();
    assert_eq!(count, 1);
    assert_ne!(run_id, run.run_id);
}

#[test]
fn resume_removes_point_if_scenario_purpose_changes() {
    let (db, run) = resume_fixture();
    resume::record_accepted(&db, &run).unwrap();
    resume::save_chapter(&db, &run, "first", 100).unwrap();
    let point = resume::load_for_scope(&db, &run.scope).unwrap().remove(0);
    let mut snapshot = characters::get_pack_story_definition(&db, &run.scope.pack_id).unwrap();
    snapshot.definition.scenarios[0].purpose = ScenarioPurpose::Tutorial;
    characters::save_pack_story_definition_expected(&db, &run.scope.pack_id, &snapshot.definition, &snapshot.baseline).unwrap();
    assert!(resume::resolve(&db, &run.scope, &point).unwrap().is_none());
    assert!(resume::load_for_scope(&db, &run.scope).unwrap().is_empty());
}
