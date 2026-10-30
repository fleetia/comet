use super::*;

fn fixture(subject: AuthoringSubject) -> AuthoringTrialRequest {
    let mut definitions = characters::factory_pack().characters;
    definitions.truncate(2);
    let center_source = definitions[0].source_id.clone();
    let guest_source = definitions[1].source_id.clone();
    definitions[0].balloon_style.text_speed = 2;
    definitions[0].relationships = vec![characters::CharacterRelationship {
        target_id: "local-guest".into(),
        description: "한 방향의 친구".into(),
        reply_lines: vec![CharacterLine {
            expression: "평온".into(),
            text: "  원문\n줄바꿈  ".into(),
            motion: Default::default(),
        }],
    }];
    definitions[1].presence_role = PresenceRole::Npc;
    definitions[1].npc = Some(NpcDefinition {
        invite_keywords: vec!["초대".into()],
        appearance_keywords: vec!["방문".into()],
        required_flags: vec!["open".into()],
        exit_policy: NpcExitPolicy::TopicChange,
        entry_lines: vec![CharacterLine {
            expression: "평온".into(),
            text: "  들어왔어.\n원문  ".into(),
            motion: Default::default(),
        }],
    });
    let line = |source: &str, text: &str| SceneLine {
        persona: source.into(),
        expression: "평온".into(),
        text: text.into(),
        widget: None,
        motion: Default::default(),
    };
    AuthoringTrialRequest {
        actors: definitions
            .into_iter()
            .enumerate()
            .map(|(index, definition)| AuthoringActor {
                id: if index == 0 {
                    "local-center"
                } else {
                    "local-guest"
                }
                .into(),
                pack_id: Some("pack-one".into()),
                definition,
            })
            .collect(),
        definition: PackStoryDefinition {
            story_flags: vec![
                StoryFlag {
                    id: "open".into(),
                    public: true,
                },
                StoryFlag {
                    id: "done".into(),
                    public: true,
                },
            ],
            scenarios: vec![ScenarioDefinition {
                id: "one".into(),
                purpose: Default::default(),
                chapters: None,
                title: "원문 이야기".into(),
                center_id: center_source.clone(),
                participants: vec![center_source.clone(), guest_source],
                keywords: vec!["이야기".into()],
                required_flags: vec![],
                min_affinity: 20,
                reveal_affinity: None,
                defer: vec![],
                intro: vec![line(&center_source, "  같이 할까?\n원문  ")],
                accept: vec![line(&center_source, "좋아.")],
                decline: vec![line(&center_source, "다음에.")],
                ending: vec![line(&center_source, "  마쳤어.\n원문  ")],
                accept_keywords: vec!["좋아".into()],
                decline_keywords: vec!["싫어".into()],
                proceed_keywords: vec!["계속".into()],
                cancel_keywords: vec!["그만".into()],
                accept_next_id: None,
                decline_next_id: None,
                allow_incomplete_repeat: false,
                allow_repeat: false,
                completion: CompletionEffects {
                    set_flags: vec!["done".into()],
                    memory_template: Some("{scenarioTitle}를 마쳤다.".into()),
                },
            }],
            ..Default::default()
        },
        subject,
        context: AuthoringContext {
            center_id: "local-center".into(),
            present_ids: vec!["local-center".into()],
            flags: vec!["open".into()],
            affinity: 20,
            turn: 0,
            wait_turn: 0,
            completed_scenario_ids: vec![],
            incomplete_scenario_ids: vec![],
        },
        inputs: vec![],
    }
}

fn scenario() -> AuthoringTrialRequest {
    fixture(AuthoringSubject::Scenario {
        scenario_id: "one".into(),
    })
}

#[test]
fn chapter_scenario_cannot_be_tried() {
    let mut request = scenario();
    let scene = &mut request.definition.scenarios[0];
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
    assert_eq!(
        authoring_trial(request).unwrap_err(),
        "아직 시험할 수 없어요."
    );
}

#[test]
fn scenario_trial_maps_sources_preserves_raw_text_and_only_plans_assumed_effects() {
    let mut request = scenario();
    request.inputs = vec!["이야기".into(), "글쎄".into(), "좋아".into(), "계속".into()];
    let actor_before = serde_json::to_value(&request.actors[0].definition).unwrap();
    let definition_before = request.definition.clone();
    let trace = authoring_trial(request.clone()).unwrap();
    assert_eq!(trace.steps[0].lines.len(), 2);
    assert_eq!(trace.steps[0].lines[0].persona, "local-guest");
    assert_eq!(trace.steps[0].lines[1].persona, "local-center");
    assert_eq!(trace.steps[0].lines[1].text, "  같이 할까?\n원문  ");
    assert_eq!(
        trace.steps[0].line_durations_ms[1],
        crate::playback::line_duration_millis("  같이 할까?\n원문  ", 2)
    );
    assert!(trace.steps[1].model_required);
    assert_eq!(trace.steps[1].before_state.stage, Some(Stage::Intro));
    assert_eq!(trace.steps[1].after_state.stage, Some(Stage::Intro));
    assert!(trace.steps[2].planned_effects.set_flags.is_empty());
    assert!(!trace.steps[2].after_state.flags.contains(&"done".into()));
    assert_eq!(
        trace.steps[3].planned_effects,
        definition_before.scenarios[0].completion
    );
    assert!(trace.steps[3].presentation_assumed);
    assert_eq!(trace.steps[3].after_state.flags, vec!["open", "done"]);
    assert_eq!(trace.steps[3].after_state.wait_turn, 7);
    assert_eq!(trace.steps[3].after_state.present_ids, vec!["local-center"]);
    assert_eq!(
        serde_json::to_value(&request.actors[0].definition).unwrap(),
        actor_before
    );
    assert_eq!(request.definition, definition_before);
}

#[test]
fn scenario_checks_all_admission_conditions_and_does_not_evict_occupied_slots() {
    let mut request = scenario();
    request
        .context
        .present_ids
        .extend((1..8).map(|index| format!("outside-{index}")));
    request.context.flags.clear();
    request.context.affinity = 19;
    request.context.wait_turn = 3;
    request.context.completed_scenario_ids = vec!["one".into()];
    request.context.incomplete_scenario_ids = vec!["one".into()];
    request.inputs = vec!["무관한 입력".into()];
    let original = request.context.present_ids.clone();
    let trace = authoring_trial(request).unwrap();
    let step = &trace.steps[0];
    for id in [
        "keyword", "npcFlags", "affinity", "repeat", "wait", "capacity",
    ] {
        assert!(step
            .conditions
            .iter()
            .any(|condition| condition.id == id && !condition.matched));
    }
    assert!(step.lines.is_empty());
    assert_eq!(step.after_state.present_ids, original);
    assert_eq!(step.after_state.flags, Vec::<String>::new());
}

#[test]
fn decline_and_cancel_do_not_plan_completion_and_wait_for_three_new_inputs() {
    for terminal in ["싫어", "그만"] {
        let mut request = scenario();
        request.inputs = vec![
            "이야기".into(),
            terminal.into(),
            "이야기".into(),
            "이야기".into(),
            "이야기".into(),
        ];
        if terminal == "그만" {
            request.definition.scenarios[0].allow_incomplete_repeat = true;
        }
        let trace = authoring_trial(request).unwrap();
        assert!(trace
            .steps
            .iter()
            .all(|step| step.planned_effects.set_flags.is_empty()));
        assert_eq!(trace.steps[1].after_state.wait_turn, 5);
        assert!(trace.steps[2].lines.is_empty());
        assert!(trace.steps[3].lines.is_empty());
        assert_eq!(trace.steps[4].stage, Some(Stage::Intro));
        assert_eq!(trace.steps[4].after_state.flags, vec!["open"]);
    }
}

#[test]
fn directed_relation_trial_uses_local_ids_and_never_invites_the_named_target() {
    let mut request = fixture(AuthoringSubject::Relation {
        actor_id: "local-center".into(),
        target_id: "local-guest".into(),
    });
    request.actors[1].pack_id = Some("other-pack".into());
    // Relation-only scope has no cross-pack scenario references.
    request.definition.scenarios.clear();
    request.inputs = vec![
        request.actors[1].definition.name.clone(),
        "상대 이름 없음".into(),
    ];
    let trace = authoring_trial(request).unwrap();
    assert_eq!(trace.steps[0].lines[0].persona, "local-center");
    assert_eq!(trace.steps[0].lines[0].text, "  원문\n줄바꿈  ");
    assert_eq!(trace.steps[0].stage, None);
    assert_eq!(trace.steps[0].after_state.present_ids, vec!["local-center"]);
    assert!(trace.steps[1].model_required);
    assert!(trace.steps[1].model_not_run_reason.is_some());
    assert!(trace
        .steps
        .iter()
        .all(|step| step.planned_effects == CompletionEffects::default()));
}

#[test]
fn npc_trial_respects_required_flags_capacity_and_exit_policy() {
    let mut request = fixture(AuthoringSubject::Npc {
        actor_id: "local-guest".into(),
    });
    request.inputs = vec![
        "초대".into(),
        "그만".into(),
        "초대".into(),
        "초대".into(),
        "초대".into(),
    ];
    let trace = authoring_trial(request.clone()).unwrap();
    assert_eq!(
        trace.steps[0].after_state.present_ids,
        vec!["local-center", "local-guest"]
    );
    assert_eq!(trace.steps[0].lines[0].text, "  들어왔어.\n원문  ");
    assert_eq!(trace.steps[1].after_state.present_ids, vec!["local-center"]);
    assert!(trace.steps[2].lines.is_empty());
    assert!(trace.steps[3].lines.is_empty());
    assert_eq!(trace.steps[4].stage, Some(Stage::Entry));
    request.actors[1]
        .definition
        .npc
        .as_mut()
        .unwrap()
        .exit_policy = NpcExitPolicy::SceneEnd;
    request.inputs = vec!["초대".into()];
    let trace = authoring_trial(request.clone()).unwrap();
    assert_eq!(trace.steps[0].after_state.present_ids, vec!["local-center"]);
    assert_eq!(trace.steps[0].after_state.stage, None);
    request
        .context
        .present_ids
        .extend((1..8).map(|index| format!("outside-{index}")));
    let trace = authoring_trial(request).unwrap();
    assert!(trace.steps[0].lines.is_empty());
    assert!(trace.steps[0]
        .conditions
        .iter()
        .any(|item| item.id == "capacity" && !item.matched));
}

#[test]
fn trial_rejects_untrusted_ids_flags_progress_and_inputs_before_simulating() {
    let mut mutations = vec![];
    let mut request = scenario();
    request.context.flags.push("undeclared".into());
    mutations.push(request);
    let mut request = scenario();
    request.context.flags.push("open".into());
    mutations.push(request);
    let mut request = scenario();
    request.context.center_id = "source-not-local".into();
    mutations.push(request);
    let mut request = scenario();
    request
        .context
        .completed_scenario_ids
        .push("missing".into());
    mutations.push(request);
    let mut request = scenario();
    request.context.turn = MAX_SAFE_TURN + 1;
    mutations.push(request);
    let mut request = scenario();
    request.inputs = vec!["x".repeat(501)];
    mutations.push(request);
    let mut request = scenario();
    request.context.present_ids.push("local-center".into());
    mutations.push(request);
    let mut request = scenario();
    request.actors[1].id = "local-center".into();
    mutations.push(request);
    for request in mutations {
        assert!(authoring_trial(request).is_err());
    }
    let mut unknown = serde_json::to_value(scenario().definition).unwrap();
    unknown["extra"] = serde_json::json!(true);
    assert!(serde_json::from_value::<PackStoryDefinition>(unknown).is_err());
}

#[test]
fn deserialization_keeps_subject_local_ids_distinct_from_scenario_source_ids() {
    let request = fixture(AuthoringSubject::Relation {
        actor_id: "local-center".into(),
        target_id: "local-guest".into(),
    });
    let json = serde_json::json!({
        "actors": request.actors.iter().map(|actor| serde_json::json!({"id": actor.id, "packId": actor.pack_id, "definition": actor.definition})).collect::<Vec<_>>(),
        "definition": request.definition,
        "subject": {"kind": "relation", "actorId": "local-center", "targetId": "local-guest"},
        "context": {"centerId": "local-center", "presentIds": ["local-center"], "flags": ["open"], "affinity": 20, "turn": 0, "waitTurn": 0, "completedScenarioIds": [], "incompleteScenarioIds": []},
        "inputs": []
    });
    assert!(serde_json::from_value::<AuthoringTrialRequest>(json.clone()).is_ok());
    let mut unknown = json;
    unknown["context"]["secret"] = serde_json::json!(true);
    assert!(serde_json::from_value::<AuthoringTrialRequest>(unknown).is_err());
}

#[test]
fn npc_only_pack_can_use_an_external_resident_without_merging_pack_definitions() {
    let mut request = fixture(AuthoringSubject::Npc {
        actor_id: "local-guest".into(),
    });
    request.actors[0].pack_id = Some("resident-pack".into());
    request.definition.scenarios.clear();
    request.inputs = vec!["초대".into()];
    let trace = authoring_trial(request).unwrap();
    assert_eq!(trace.steps[0].source, "registered");
    assert_eq!(trace.steps[0].lines[0].persona, "local-guest");
    assert_eq!(
        trace.steps[0].after_state.present_ids,
        vec!["local-center", "local-guest"]
    );
}

#[test]
fn remapping_ignores_matching_source_ids_from_a_different_reimported_pack() {
    let mut request = scenario();
    let mut duplicate = request.actors[0].clone();
    duplicate.id = "other-local-center".into();
    duplicate.pack_id = Some("other-reimport".into());
    request.actors.insert(0, duplicate);
    request.inputs = vec!["이야기".into()];
    let trace = authoring_trial(request).unwrap();
    assert_eq!(trace.steps[0].lines[1].persona, "local-center");
    assert!(!trace.steps[0]
        .after_state
        .present_ids
        .contains(&"other-local-center".into()));
}

#[test]
fn reserved_next_story_rechecks_conditions_after_three_inputs() {
    let mut request = scenario();
    let mut next = request.definition.scenarios[0].clone();
    next.id = "two".into();
    next.title = "다음 이야기".into();
    next.required_flags = vec!["done".into()];
    request.definition.scenarios[0].accept_next_id = Some("two".into());
    request.definition.scenarios.push(next);
    request.inputs = ["이야기", "좋아", "계속", "이야기", "이야기", "이야기"]
        .into_iter()
        .map(str::to_string)
        .collect();
    let trace = authoring_trial(request).unwrap();
    assert_eq!(
        trace.steps[2]
            .after_state
            .pending_next_scenario_id
            .as_deref(),
        Some("two")
    );
    assert!(trace.steps[3].lines.is_empty());
    assert!(trace.steps[4].lines.is_empty());
    assert_eq!(trace.steps[5].stage, Some(Stage::Intro));
    assert!(trace.steps[5]
        .conditions
        .iter()
        .any(|item| item.id == "flags" && item.matched));
    assert_eq!(trace.steps[5].after_state.pending_next_scenario_id, None);
}
