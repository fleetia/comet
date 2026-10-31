use super::*;
use crate::app::scene::{line_completion_locked, mark_line_displayed, LineCompletion};

fn fixture(npc: bool) -> (AppState, Vec<String>) {
    let state = super::super::tests::state();
    let ids = {
        let db = lock(&state.db).unwrap();
        store::set_user_name(&db, "합성 이야기 사용자", 1).unwrap();
        story::initialize(&db).unwrap();
        db.execute("INSERT INTO story_answers(request_id,character_id,scene_id,chapter,choice_id,user_id) VALUES('historical-nadir','builtin-b','preserved-scene',0,'listen',?1)",[store::active_user_id(&db).unwrap()]).unwrap();
        let mut pack = characters::factory_pack();
        pack.format_version = 8;
        pack.pair_scenes.clear();
        pack.wordbook.clear();
        pack.characters[0].name = "중심".into();
        pack.characters[1].name = "손님".into();
        if npc {
            pack.characters[1].presence_role = pack_stories::PresenceRole::Npc;
        }
        let center = pack.characters[0].source_id.clone();
        let guest = pack.characters[1].source_id.clone();
        let line = |text: &str| SceneLine {
            persona: center.clone(),
            expression: "평온".into(),
            text: text.into(),
            widget: None,
            motion: Default::default(),
        };
        pack.story_flags = vec![pack_stories::StoryFlag {
            id: "done".into(),
            public: true,
        }];
        let scenario = pack_stories::ScenarioDefinition {
            purpose: Default::default(),
            chapters: None,
            id: "one".into(),
            title: "작은 이야기".into(),
            center_id: center.clone(),
            participants: vec![center.clone(), guest],
            keywords: vec!["이야기 시작".into()],
            required_flags: vec![],
            min_affinity: 0,
            reveal_affinity: None,
            defer: vec![],
            intro: vec![line("  같이 갈까?\n원문  ")],
            accept: vec![line("같이 가자.")],
            decline: vec![line("다음에 만나자.")],
            ending: vec![line("  오늘의 길\n기억해.  ")],
            accept_keywords: vec!["좋아".into()],
            decline_keywords: vec!["싫어".into()],
            proceed_keywords: vec!["계속".into()],
            cancel_keywords: vec!["그만".into()],
            accept_next_id: None,
            decline_next_id: Some("next".into()),
            allow_incomplete_repeat: true,
            allow_repeat: false,
            completion: pack_stories::CompletionEffects {
                set_flags: vec!["done".into()],
                memory_template: Some("{scenarioTitle}를 마쳤다.".into()),
            },
        };
        pack.scenarios = vec![
            scenario.clone(),
            pack_stories::ScenarioDefinition {
                id: "next".into(),
                title: "다음 이야기".into(),
                keywords: vec!["후속".into()],
                decline_next_id: None,
                ..scenario
            },
        ];
        let installed = characters::import_pack(&db, &pack).unwrap();
        let ids = installed
            .iter()
            .map(|actor| actor.id.clone())
            .collect::<Vec<_>>();
        characters::apply_roster(
            &db,
            if npc {
                vec![ids[0].clone()]
            } else {
                ids.clone()
            },
        )
        .unwrap();
        ids
    };
    (state, ids)
}

fn choose(state: &AppState, center: &str, content: &str) -> pack_stories::Plan {
    let _action = lock(&state.action).unwrap();
    let db = lock(&state.db).unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    let lines = record_input_and_route(state, &db, content, center, &[center.into()], &id, false)
        .unwrap()
        .unwrap();
    let mut plan = pack_stories::load_plan(&db, &id).unwrap().unwrap();
    plan.retry = false;
    assert_eq!(lines, plan.lines);
    let (epoch, _) = super::super::tasks::reserve_conversation(state, None, &id).unwrap();
    bind_pack_plan_locked(state, &db, &plan, epoch).unwrap();
    characters::guests::hear_locked(
        state,
        &db,
        lock(&state.tasks).unwrap().participants.as_ref().unwrap(),
        &id,
    )
    .unwrap();
    plan
}

fn present_last(state: &AppState, plan: &pack_stories::Plan) {
    let epoch = state.epoch.load(Ordering::SeqCst);
    let revision = store::revision(&lock(&state.db).unwrap()).unwrap();
    let run = lock(&state.pack_stories).unwrap().run.clone().unwrap();
    assert!(present_line(
        state,
        plan.lines.last().unwrap(),
        &plan.source,
        &run.last_playback_id,
        plan.lines.len() - 1,
        plan.lines.len(),
        revision,
        epoch,
        &AtomicBool::new(false),
        true
    )
    .unwrap());
}

fn displayed_proof(state: &AppState) -> LineCompletion {
    let _action = lock(&state.action).unwrap();
    let line = {
        let db = lock(&state.db).unwrap();
        let mut playback = lock(&state.playback).unwrap();
        let line = playback.as_mut().unwrap();
        let start = chrono::Utc::now().timestamp_millis() + 10;
        assert!(mark_line_displayed(line, start));
        store::mark_message_displayed(&db, &line.id, start).unwrap();
        line.clone()
    };
    line_completion_locked(
        state,
        &line,
        state.epoch.load(Ordering::SeqCst),
        &AtomicBool::new(false),
        line.ends_at,
    )
    .unwrap()
    .unwrap()
}

fn finish(state: &AppState, plan: &pack_stories::Plan) {
    present_last(state, plan);
    let proof = displayed_proof(state);
    let _action = lock(&state.action).unwrap();
    let db = lock(&state.db).unwrap();
    assert!(complete_pack_stage_locked(
        state,
        &db,
        &plan.input_id,
        &proof,
        state.epoch.load(Ordering::SeqCst)
    )
    .unwrap());
    *lock(&state.playback).unwrap() = None;
}

fn effects(db: &Connection) -> (i64, i64) {
    (
        db.query_row(
            "SELECT COUNT(*) FROM pack_story_outcomes WHERE kind='completed'",
            [],
            |row| row.get(0),
        )
        .unwrap(),
        db.query_row(
            "SELECT COUNT(*) FROM memories WHERE source LIKE 'moment:story-complete:%'",
            [],
            |row| row.get(0),
        )
        .unwrap(),
    )
}

#[test]
fn automatic_pause_cancels_previous_run_but_new_manual_story_can_finish() {
    let (state, ids) = fixture(false);
    let previous = choose(&state, &ids[0], "이야기 시작");
    present_last(&state, &previous);
    let proof = displayed_proof(&state);
    let old_epoch = state.epoch.load(Ordering::SeqCst);
    assert!(super::super::windows::apply_pause(&state, true, None)
        .unwrap()
        .is_some());
    {
        let _action = lock(&state.action).unwrap();
        assert!(line_completion_locked(
            &state,
            &proof.playback,
            old_epoch,
            &AtomicBool::new(false),
            proof.finished_at
        )
        .unwrap()
        .is_none());
        let db = lock(&state.db).unwrap();
        assert!(
            !complete_pack_stage_locked(&state, &db, &previous.input_id, &proof, old_epoch)
                .unwrap()
        );
        assert!(lock(&state.pack_stories).unwrap().run.is_none());
        assert_eq!(effects(&db), (0, 0));
        wordbook::save(
            &db,
            &WordbookEntry {
                id: uuid::Uuid::new_v4().to_string(),
                title: "쉬는 동안 등록 응답".into(),
                keywords: vec!["paused-registered".into()],
                lines: vec![SceneLine {
                    persona: "a".into(),
                    expression: "평온".into(),
                    text: "수동 등록 응답이야.".into(),
                    widget: None,
                    motion: Default::default(),
                }],
                enabled: true,
                use_for_idle: false,
                group: None,
            },
        )
        .unwrap();
        // Explicit cancellation keeps its normal three-input wait during automatic pause.
        for _ in 0..3 {
            let input = uuid::Uuid::new_v4().to_string();
            assert_eq!(
                record_input_and_route(
                    &state,
                    &db,
                    "paused-registered",
                    &ids[0],
                    &ids[..1],
                    &input,
                    false
                )
                .unwrap()
                .unwrap()[0]
                    .text,
                "수동 등록 응답이야."
            );
        }
    }
    let intro = choose(&state, &ids[0], "이야기 시작");
    assert_ne!(intro.run_id, previous.run_id);
    finish(&state, &intro);
    assert!(
        lock(&state.pack_stories)
            .unwrap()
            .run
            .as_ref()
            .unwrap()
            .ready
    );
    let accept = choose(&state, &ids[0], "좋아");
    finish(&state, &accept);
    let ending = choose(&state, &ids[0], "계속");
    finish(&state, &ending);
    assert!(lock(&state.runtime).unwrap().paused);
    assert_eq!(effects(&lock(&state.db).unwrap()), (1, 1));
    assert!(super::super::background::begin_background(&state)
        .unwrap()
        .is_none());
}

#[test]
fn typed_controller_completion_requires_native_display_full_duration_and_applies_once() {
    for outcome in ["unshown", "cancelled", "finished"] {
        let (state, ids) = fixture(false);
        let intro = choose(&state, &ids[0], "이야기 시작");
        finish(&state, &intro);
        let accept = choose(&state, &ids[0], "좋아");
        finish(&state, &accept);
        let ending = choose(&state, &ids[0], "계속");
        present_last(&state, &ending);
        let epoch = state.epoch.load(Ordering::SeqCst);
        let line = lock(&state.playback).unwrap().clone().unwrap();
        {
            let _action = lock(&state.action).unwrap();
            assert!(line_completion_locked(
                &state,
                &line,
                epoch,
                &AtomicBool::new(false),
                i64::MAX
            )
            .unwrap()
            .is_none());
        }
        if outcome != "unshown" {
            let proof = displayed_proof(&state);
            let _action = lock(&state.action).unwrap();
            let db = lock(&state.db).unwrap();
            let early = LineCompletion {
                finished_at: proof.playback.ends_at - 1,
                ..proof.clone()
            };
            assert!(
                !complete_pack_stage_locked(&state, &db, &ending.input_id, &early, epoch).unwrap()
            );
            if outcome == "cancelled" {
                super::super::interrupt_with_db(&state, false, &db).unwrap();
            }
            assert_eq!(
                complete_pack_stage_locked(&state, &db, &ending.input_id, &proof, epoch).unwrap(),
                outcome == "finished"
            );
            assert!(
                !complete_pack_stage_locked(&state, &db, &ending.input_id, &proof, epoch).unwrap()
            );
        }
        let db = lock(&state.db).unwrap();
        assert_eq!(
            effects(&db),
            if outcome == "finished" {
                (1, 1)
            } else {
                (0, 0)
            },
            "{outcome}"
        );
        assert_eq!(
            db.query_row(
                "SELECT COUNT(*) FROM pack_story_outcomes WHERE kind='accepted'",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
            1
        );
        assert_eq!(db.query_row("SELECT COUNT(*) FROM story_answers WHERE request_id='historical-nadir' AND scene_id='preserved-scene' AND choice_id='listen'",[],|row|row.get::<_,i64>(0)).unwrap(),1);
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM story_answers", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM character_affinity", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
}

#[test]
fn registered_inputs_count_three_turns_without_consuming_branch_or_reselecting_retry() {
    let (state, ids) = fixture(false);
    let intro = choose(&state, &ids[0], "이야기 시작");
    finish(&state, &intro);
    let decline = choose(&state, &ids[0], "싫어");
    finish(&state, &decline);
    let db = lock(&state.db).unwrap();
    let branch = lock(&state.pack_stories)
        .unwrap()
        .pending_next
        .clone()
        .unwrap();
    wordbook::save(
        &db,
        &WordbookEntry {
            id: uuid::Uuid::new_v4().to_string(),
            title: "우선 원문".into(),
            keywords: vec!["후속".into()],
            lines: vec![SceneLine {
                persona: "a".into(),
                expression: "평온".into(),
                text: "  등록 응답\n그대로  ".into(),
                widget: None,
                motion: Default::default(),
            }],
            enabled: true,
            use_for_idle: false,
            group: None,
        },
    )
    .unwrap();
    let mut last = String::new();
    for _ in 0..3 {
        last = uuid::Uuid::new_v4().to_string();
        let lines = record_input_and_route(
            &state,
            &db,
            "후속",
            &ids[0],
            &[ids[0].clone()],
            &last,
            false,
        )
        .unwrap()
        .unwrap();
        assert_eq!(lines[0].text, "  등록 응답\n그대로  ");
        assert_eq!(
            lock(&state.pack_stories).unwrap().pending_next.as_ref(),
            Some(&branch)
        );
        assert!(lock(&state.pack_stories).unwrap().run.is_none());
    }
    let count: i64 = db
        .query_row("SELECT COUNT(*) FROM pack_story_inputs", [], |row| {
            row.get(0)
        })
        .unwrap();
    route_input(&state, &db, "후속", &[ids[0].clone()], &last)
        .unwrap()
        .unwrap();
    assert_eq!(
        db.query_row("SELECT COUNT(*) FROM pack_story_inputs", [], |row| row
            .get::<_, i64>(0))
            .unwrap(),
        count
    );
    let mut entry = wordbook::entries(&db)
        .unwrap()
        .into_iter()
        .find(|entry| entry.title == "우선 원문")
        .unwrap();
    entry.enabled = false;
    wordbook::save(&db, &entry).unwrap();
    let next = uuid::Uuid::new_v4().to_string();
    record_input_and_route(
        &state,
        &db,
        "후속",
        &ids[0],
        &[ids[0].clone()],
        &next,
        false,
    )
    .unwrap()
    .unwrap();
    let plan = pack_stories::load_plan(&db, &next).unwrap().unwrap();
    assert_eq!(plan.run.scenario_id.as_deref(), Some("next"));
    assert_eq!(
        db.query_row("SELECT COUNT(*) FROM pack_story_inputs", [], |row| row
            .get::<_, i64>(0))
            .unwrap(),
        count + 1
    );
}

#[test]
fn normal_input_retickets_waiting_guest_run_and_unrelated_widget_revision_does_not_expire_it() {
    let (state, ids) = fixture(true);
    let intro = choose(&state, &ids[0], "이야기 시작");
    finish(&state, &intro);
    let before = lock(&state.pack_stories).unwrap().run.clone().unwrap();
    let epoch = super::super::windows::begin_panel(&state, &ids[1], "input".into())
        .unwrap()
        .unwrap();
    let db = lock(&state.db).unwrap();
    store::bump_revision(&db).unwrap();
    let run = lock(&state.pack_stories).unwrap().run.clone().unwrap();
    assert_eq!(run.run_id, before.run_id);
    assert!(run.ready);
    assert_eq!(run.epoch, epoch);
    assert!(characters::guests::is_present(&state, &db, &ids[1]).unwrap());
    assert!(pack_stories::current(&db, &run).unwrap());
    assert!(route_input(
        &state,
        &db,
        "이야기 시작",
        &[ids[0].clone()],
        &intro.input_id
    )
    .unwrap()
    .is_some());
    assert_eq!(
        db.query_row(
            "SELECT COUNT(*) FROM pack_story_outcomes WHERE kind='cancelled'",
            [],
            |row| row.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
}

#[test]
fn idle_input_fold_keeps_ready_npc_story_but_explicit_close_or_active_playback_cancels() {
    for mode in ["idle-ready", "explicit-ready", "idle-playing"] {
        let (state, ids) = fixture(true);
        let session = {
            let db = lock(&state.db).unwrap();
            store::create_conversation(&db, &ids[..1], None, None, 1).unwrap()
        };
        let intro = choose(&state, &ids[0], "이야기 시작");
        if mode == "idle-playing" {
            present_last(&state, &intro);
        } else {
            finish(&state, &intro);
            lock(&state.tasks).unwrap().active = None;
            lock(&state.runtime).unwrap().phase = RuntimePhase::Idle;
        }
        *lock(&state.panel).unwrap() = Some(PanelState {
            persona: ids[1].clone(),
            mode: "input".into(),
        });
        let old_epoch = state.epoch.load(Ordering::SeqCst);
        {
            let _action = lock(&state.action).unwrap();
            let db = lock(&state.db).unwrap();
            let epoch = super::super::windows::close_panel_locked(
                &state,
                &db,
                Some(&session.id),
                mode != "explicit-ready",
            )
            .unwrap()
            .unwrap();
            assert!(epoch > old_epoch);
            assert!(lock(&state.panel).unwrap().is_none());
            assert_eq!(
                store::conversation(&db, &session.id).unwrap().status,
                "paused"
            );
            assert_eq!(effects(&db), (0, 0));
            if mode == "idle-ready" {
                let run = lock(&state.pack_stories).unwrap().run.clone().unwrap();
                assert_eq!(run.run_id, intro.run_id);
                assert_eq!(run.epoch, epoch);
                assert!(run.ready);
                assert!(characters::guests::is_present(&state, &db, &ids[1]).unwrap());
                assert_eq!(
                    db.query_row(
                        "SELECT COUNT(*) FROM pack_story_outcomes WHERE kind='cancelled'",
                        [],
                        |row| row.get::<_, i64>(0)
                    )
                    .unwrap(),
                    0
                );
            } else {
                assert!(lock(&state.pack_stories).unwrap().run.is_none());
                assert!(characters::guests::guest_ids(&state, &db)
                    .unwrap()
                    .is_empty());
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
        }
        if mode == "idle-ready" {
            super::super::windows::begin_panel(&state, &ids[0], "menu".into())
                .unwrap()
                .unwrap();
            super::super::windows::begin_panel(&state, &ids[0], "input".into())
                .unwrap()
                .unwrap();
            let accept = choose(&state, &ids[0], "좋아");
            assert_eq!(accept.run.stage, pack_stories::Stage::Accept);
            assert_eq!(accept.run_id, intro.run_id);
            finish(&state, &accept);
            let ending = choose(&state, &ids[0], "계속");
            finish(&state, &ending);
            assert_eq!(effects(&lock(&state.db).unwrap()), (1, 1));
        }
    }
}

#[test]
fn idle_folded_guest_menu_reopens_resident_owned_session_and_accepts_the_waiting_story() {
    let (state, ids) = fixture(true);
    let previous = {
        let db = lock(&state.db).unwrap();
        store::create_conversation(&db, &ids[..1], None, None, 1).unwrap()
    };
    let intro = choose(&state, &ids[0], "이야기 시작");
    finish(&state, &intro);
    lock(&state.tasks).unwrap().active = None;
    lock(&state.runtime).unwrap().phase = RuntimePhase::Idle;
    *lock(&state.panel).unwrap() = Some(PanelState {
        persona: ids[1].clone(),
        mode: "input".into(),
    });
    {
        let _action = lock(&state.action).unwrap();
        let db = lock(&state.db).unwrap();
        super::super::windows::close_panel_locked(&state, &db, Some(&previous.id), true)
            .unwrap()
            .unwrap();
    }
    super::super::windows::begin_panel(&state, &ids[1], "menu".into())
        .unwrap()
        .unwrap();
    assert!(super::super::chat::conversation_sessions(&state, &ids[1])
        .unwrap()
        .is_empty());
    assert_eq!(
        super::super::chat::conversation_sessions(&state, &ids[0]).unwrap()[0].id,
        previous.id
    );
    super::super::windows::begin_panel(&state, &ids[1], "input".into())
        .unwrap()
        .unwrap();
    let accept = {
        let _action = lock(&state.action).unwrap();
        let db = lock(&state.db).unwrap();
        let session = store::active_conversation(&db).unwrap().unwrap();
        assert_ne!(session.id, previous.id);
        assert_eq!(session.participants, ids[..1]);
        assert_eq!(
            lock(&state.panel).unwrap().as_ref().unwrap().persona,
            ids[1]
        );
        assert_eq!(
            session_targets(&db, &ids[0], Some(&session)).unwrap(),
            ids[..1]
        );
        let input = uuid::Uuid::new_v4().to_string();
        let lines = record_input_and_route(&state, &db, "좋아", &ids[0], &ids, &input, false)
            .unwrap()
            .unwrap();
        let mut plan = pack_stories::load_plan(&db, &input).unwrap().unwrap();
        plan.retry = false;
        assert_eq!(lines, plan.lines);
        assert_eq!(plan.run.stage, pack_stories::Stage::Accept);
        assert_eq!(plan.run_id, intro.run_id);
        let (epoch, _) =
            super::super::tasks::reserve_conversation(&state, Some(&session.id), &input).unwrap();
        bind_pack_plan_locked(&state, &db, &plan, epoch).unwrap();
        characters::guests::hear_locked(
            &state,
            &db,
            lock(&state.tasks).unwrap().participants.as_ref().unwrap(),
            &input,
        )
        .unwrap();
        assert!(characters::guests::heard_message_ids(&state, &db, &ids[1])
            .unwrap()
            .contains(&input));
        assert_eq!(
            store::conversation_for_message(&db, &input)
                .unwrap()
                .unwrap()
                .id,
            session.id
        );
        assert_eq!(characters::active_ids(&db).unwrap(), ids[..1]);
        assert_eq!(
            db.query_row(
                "SELECT COUNT(*) FROM pack_story_outcomes WHERE kind='cancelled'",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
        assert_eq!(effects(&db), (0, 0));
        plan
    };
    finish(&state, &accept);
    let ending = choose(&state, &ids[0], "계속");
    finish(&state, &ending);
    assert_eq!(effects(&lock(&state.db).unwrap()), (1, 1));
    assert!(super::super::chat::conversation_sessions(&state, &ids[1]).is_err());
}

#[test]
fn cancelled_or_restarted_resident_ending_retries_original_lines_without_restoring_effects() {
    for restarted in [false, true] {
        let (state, ids) = fixture(false);
        let intro = choose(&state, &ids[0], "이야기 시작");
        finish(&state, &intro);
        let accept = choose(&state, &ids[0], "좋아");
        finish(&state, &accept);
        let ending = choose(&state, &ids[0], "계속");
        present_last(&state, &ending);
        let _old = displayed_proof(&state);
        let epoch = {
            let _action = lock(&state.action).unwrap();
            let db = lock(&state.db).unwrap();
            // This DB-held raw cancellation specifically guards against nested DB locking.
            super::super::interrupt(&state, false).unwrap();
            pack_stories::flush_cancellations(&db, &mut lock(&state.pack_stories).unwrap())
                .unwrap();
            if restarted {
                *lock(&state.pack_stories).unwrap() = pack_stories::Runtime::default();
                pack_stories::recover_interrupted(&db).unwrap();
            }
            let plan = pack_stories::load_plan(&db, &ending.input_id)
                .unwrap()
                .unwrap();
            let (epoch, _) =
                super::super::tasks::reserve_conversation(&state, None, &ending.input_id).unwrap();
            assert!(prepare_pack_retry_locked(&state, &db, &plan, epoch)
                .unwrap()
                .is_empty());
            assert!(lock(&state.pack_stories).unwrap().run.is_none());
            assert_eq!(
                lock(&state.tasks).unwrap().pack_replay.as_deref(),
                Some(ending.input_id.as_str())
            );
            epoch
        };
        let revision = store::revision(&lock(&state.db).unwrap()).unwrap();
        let line = &ending.lines[0];
        let id = format!("scene:{}:0", ending.input_id);
        assert!(present_line(
            &state,
            line,
            &ending.source,
            &id,
            0,
            1,
            revision,
            epoch,
            &AtomicBool::new(false),
            true
        )
        .unwrap());
        let shown = lock(&state.playback).unwrap().clone().unwrap();
        assert_eq!(shown.text, line.text);
        let proof = LineCompletion {
            playback: shown,
            finished_at: i64::MAX,
        };
        let _action = lock(&state.action).unwrap();
        let db = lock(&state.db).unwrap();
        assert!(!complete_pack_stage_locked(&state, &db, &ending.input_id, &proof, epoch).unwrap());
        assert_eq!(effects(&db), (0, 0));
        assert!(!store::message_finished(&db, &id).unwrap());
    }
}

#[test]
fn cancelled_guest_plan_errors_without_implicit_admission_or_ai_fallback() {
    let (state, ids) = fixture(true);
    let intro = choose(&state, &ids[0], "이야기 시작");
    let _action = lock(&state.action).unwrap();
    let db = lock(&state.db).unwrap();
    super::super::interrupt_with_db(&state, false, &db).unwrap();
    let plan = pack_stories::load_plan(&db, &intro.input_id)
        .unwrap()
        .unwrap();
    let (epoch, _) =
        super::super::tasks::reserve_conversation(&state, None, &intro.input_id).unwrap();
    assert!(prepare_pack_retry_locked(&state, &db, &plan, epoch)
        .unwrap_err()
        .contains("찾아오는 친구"));
    assert!(characters::guests::guest_ids(&state, &db)
        .unwrap()
        .is_empty());
    assert!(!store::input_ai_only(&db, &intro.input_id).unwrap());
    assert_eq!(effects(&db), (0, 0));
}

#[test]
fn new_inputs_freeze_one_bundle_for_one_to_eight_and_stage_all_raw_lines_atomically() {
    for count in [1, 2, 3, 8] {
        let state = super::super::tests::state();
        let db = lock(&state.db).unwrap();
        let mut ids = vec!["builtin-a".to_string()];
        while ids.len() < count {
            ids.push(characters::clone_character(&db, "builtin-b").unwrap().id);
        }
        characters::apply_roster(&db, ids.clone()).unwrap();
        let session = store::create_conversation(&db, &ids, None, None, 1).unwrap();
        let input = uuid::Uuid::new_v4().to_string();
        store::insert_user_input(
            &db,
            &Message {
                id: input.clone(),
                role: "user".into(),
                persona: Some("all".into()),
                content: "한 번에 답해 줘".into(),
                expression: None,
                created_at: chrono::Utc::now().timestamp_millis(),
                status: "complete".into(),
            },
            false,
        )
        .unwrap();
        // Historical inputs retain their old group selection until the explicit new-input marker.
        assert_eq!(
            turn_groups(&db, &ids, &input).unwrap().len(),
            if count <= 2 { 1 } else { count }
        );
        store::select_single_bundle_targets(&db, &input, &ids).unwrap();
        assert_eq!(
            turn_groups(&db, &ids[0..1], &input).unwrap(),
            vec![ids.clone()]
        );
        let actors = ids
            .iter()
            .map(|id| characters::get(&db, id).unwrap())
            .collect::<Vec<_>>();
        let lines = ids
            .iter()
            .enumerate()
            .map(|(index, id)| SceneLine {
                persona: id.clone(),
                expression: "평온".into(),
                text: format!("  대사 {index}\n원문 그대로  "),
                widget: None,
                motion: Default::default(),
            })
            .collect::<Vec<_>>();
        if count > 1 {
            let mut invalid = actors.clone();
            invalid[count - 1].definition.name.push('!');
            assert!(store::save_generated_bundle(
                &db,
                &input,
                &lines,
                &invalid,
                chrono::Utc::now().timestamp_millis()
            )
            .is_err());
            assert!(!store::has_turn_replies(&db, &input, "reply").unwrap());
            let mut reversed = lines.clone();
            reversed.reverse();
            assert!(store::save_generated_bundle(
                &db,
                &input,
                &reversed,
                &actors,
                chrono::Utc::now().timestamp_millis()
            )
            .is_err());
        }
        store::save_generated_bundle(
            &db,
            &input,
            &lines,
            &actors,
            chrono::Utc::now().timestamp_millis(),
        )
        .unwrap();
        assert_eq!(
            store::conversation_messages(&db, &session.id, None)
                .unwrap()
                .messages
                .len(),
            1
        );
        for line in &lines {
            let id = reply_id(&input, &line.persona);
            assert!(!store::message_displayed(&db, &id).unwrap());
            assert_eq!(
                store::saved_reply_for_participants(&db, &id, Some(&ids))
                    .unwrap()
                    .unwrap()
                    .0,
                *line
            );
        }
        let prompt = turn_prompt_for_state(&state, &db, &ids, &input, &[]).unwrap();
        assert!(!serde_json::to_string(&prompt).unwrap().contains("대사 0"));
        store::mark_message_displayed(
            &db,
            &reply_id(&input, &ids[0]),
            chrono::Utc::now().timestamp_millis(),
        )
        .unwrap();
        assert_eq!(pending_reply_targets(&db, &input, &ids).unwrap(), ids[1..]);
        assert_eq!(
            store::conversation_messages(&db, &session.id, None)
                .unwrap()
                .messages[1]
                .content,
            lines[0].text
        );
    }
}

#[test]
fn staged_guest_bundle_links_to_resident_session_and_prompt_contains_only_heard_history() {
    let (state, ids) = fixture(true);
    {
        let db = lock(&state.db).unwrap();
        store::create_conversation(&db, &ids[..1], None, None, 1).unwrap();
        store::insert_user_input(
            &db,
            &Message {
                id: "before-entry".into(),
                role: "user".into(),
                persona: Some(ids[0].clone()),
                content: "PRIVATE-BEFORE-GUEST".into(),
                expression: None,
                created_at: 1,
                status: "complete".into(),
            },
            false,
        )
        .unwrap();
    }
    let intro = choose(&state, &ids[0], "이야기 시작");
    finish(&state, &intro);
    let db = lock(&state.db).unwrap();
    let input = uuid::Uuid::new_v4().to_string();
    store::insert_user_input(
        &db,
        &Message {
            id: input.clone(),
            role: "user".into(),
            persona: Some(ids[0].clone()),
            content: "지금 둘이 들은 질문".into(),
            expression: None,
            created_at: chrono::Utc::now().timestamp_millis() + 20,
            status: "complete".into(),
        },
        false,
    )
    .unwrap();
    store::select_single_bundle_targets(&db, &input, &ids).unwrap();
    let ticket =
        capture_participants_locked(&state, &db, &ids, state.epoch.load(Ordering::SeqCst)).unwrap();
    characters::guests::hear_locked(&state, &db, &ticket, &input).unwrap();
    let actors = ids
        .iter()
        .map(|id| characters::guests::actor(&state, &db, id).unwrap())
        .collect::<Vec<_>>();
    let lines = ids
        .iter()
        .map(|id| SceneLine {
            persona: id.clone(),
            expression: "평온".into(),
            text: "UNSHOWN-BUNDLE-LINE".into(),
            widget: None,
            motion: Default::default(),
        })
        .collect::<Vec<_>>();
    store::save_generated_bundle(
        &db,
        &input,
        &lines,
        &actors,
        chrono::Utc::now().timestamp_millis(),
    )
    .unwrap();
    let memory = Memory {
        id: "private-memory".into(),
        content: "PRIVATE-RESIDENT-MEMORY".into(),
        character_id: ids[0].clone(),
        ..Default::default()
    };
    let hit = store::MemorySearchHit {
        memory,
        content_version: 1,
        methods: Vec::new(),
    };
    let prompt = turn_prompt_for_state(&state, &db, &ids, &input, &[hit]).unwrap();
    let serialized = serde_json::to_string(&prompt).unwrap();
    assert!(serialized.contains("지금 둘이 들은 질문"));
    assert!(!serialized.contains("PRIVATE-BEFORE-GUEST"));
    assert!(!serialized.contains("PRIVATE-RESIDENT-MEMORY"));
    assert!(!serialized.contains("UNSHOWN-BUNDLE-LINE"));
    assert!(
        prompt
            .iter()
            .map(|message| message.content.len() + 40)
            .sum::<usize>()
            <= 7200
    );
    assert!(
        store::conversation_for_message(&db, &reply_id(&input, &ids[1]))
            .unwrap()
            .is_some()
    );
    assert_eq!(
        store::single_bundle_targets(&db, &input).unwrap().unwrap(),
        ids
    );
}

#[test]
fn npc_registered_keyword_selection_preserves_absent_speaker_error_and_deleted_override() {
    let state = super::super::tests::state();
    let db = lock(&state.db).unwrap();
    let mut pack = characters::factory_pack();
    pack.format_version = 8;
    pack.pair_scenes.clear();
    pack.characters[1].presence_role = pack_stories::PresenceRole::Npc;
    pack.wordbook = vec![WordbookEntry {
        id: uuid::Uuid::new_v4().to_string(),
        title: "NPC 등록 원문".into(),
        keywords: vec!["special-npc".into()],
        lines: vec![SceneLine {
            persona: "b".into(),
            expression: "평온".into(),
            text: "  NPC 원문\n그대로  ".into(),
            widget: None,
            motion: Default::default(),
        }],
        enabled: true,
        use_for_idle: false,
        group: None,
    }];
    let installed = characters::import_pack(&db, &pack).unwrap();
    let ids = installed
        .iter()
        .map(|actor| actor.id.clone())
        .collect::<Vec<_>>();
    characters::apply_roster(&db, ids[..1].to_vec()).unwrap();
    let raw = characters::registered_keyword_scene(&db, "special-npc", &ids[..1])
        .unwrap()
        .unwrap();
    assert_eq!(raw[0].persona, ids[1]);
    let input = uuid::Uuid::new_v4().to_string();
    assert!(record_input_and_route(
        &state,
        &db,
        "special-npc",
        &ids[0],
        &ids[..1],
        &input,
        false
    )
    .unwrap_err()
    .contains("화자"));
    assert!(!store::input_ai_only(&db, &input).unwrap());
    characters::save_dialogue(&db, &ids, &characters::CharacterDialogue::default()).unwrap();
    assert!(
        characters::registered_keyword_scene(&db, "special-npc", &ids[..1])
            .unwrap()
            .is_none()
    );
    assert!(route_input(&state, &db, "special-npc", &ids[..1], &input).is_err());
}

#[test]
fn directed_registered_relation_can_mention_absent_npc_without_admitting_or_advancing_story() {
    let (state, ids) = fixture(true);
    let db = lock(&state.db).unwrap();
    let mut definition = characters::get(&db, &ids[0]).unwrap().definition;
    definition.relationships = vec![characters::CharacterRelationship {
        target_id: ids[1].clone(),
        description: "예전부터 아는 친구".into(),
        reply_lines: vec![characters::CharacterLine {
            expression: "평온".into(),
            text: "  손님은 내가 아는 친구야.\n원문  ".into(),
            motion: Default::default(),
        }],
    }];
    characters::save(&db, &ids[0], &definition).unwrap();
    let input = uuid::Uuid::new_v4().to_string();
    let lines = record_input_and_route(
        &state,
        &db,
        "손님은 누구야?",
        &ids[0],
        &ids[..1],
        &input,
        false,
    )
    .unwrap()
    .unwrap();
    assert_eq!(lines[0].persona, ids[0]);
    assert_eq!(
        lines[0].text,
        definition.relationships[0].reply_lines[0].text
    );
    assert!(characters::guests::guest_ids(&state, &db)
        .unwrap()
        .is_empty());
    assert!(lock(&state.pack_stories).unwrap().run.is_none());
    assert!(!store::input_ai_only(&db, &input).unwrap());
    assert_eq!(effects(&db), (0, 0));
}

#[test]
fn registered_pack_keyword_ties_keep_first_pack_registration_even_when_speaker_is_absent() {
    let state = super::super::tests::state();
    let db = lock(&state.db).unwrap();
    let mut packs = Vec::new();
    for npc in [true, false] {
        let mut pack = characters::factory_pack();
        pack.format_version = 8;
        pack.pair_scenes.clear();
        if npc {
            pack.characters[1].presence_role = pack_stories::PresenceRole::Npc;
        }
        pack.wordbook = vec![WordbookEntry {
            id: uuid::Uuid::new_v4().to_string(),
            title: "동일 키워드".into(),
            keywords: vec!["same-keyword".into()],
            lines: vec![SceneLine {
                persona: "b".into(),
                expression: "평온".into(),
                text: if npc {
                    "first-absent"
                } else {
                    "second-present"
                }
                .into(),
                widget: None,
                motion: Default::default(),
            }],
            enabled: true,
            use_for_idle: false,
            group: None,
        }];
        packs.push(characters::import_pack(&db, &pack).unwrap());
    }
    let ids = vec![
        packs[0][0].id.clone(),
        packs[1][0].id.clone(),
        packs[1][1].id.clone(),
    ];
    characters::apply_roster(&db, ids.clone()).unwrap();
    assert_eq!(
        characters::registered_keyword_scene(&db, "same-keyword", &ids)
            .unwrap()
            .unwrap()[0]
            .text,
        "first-absent"
    );
    let input = uuid::Uuid::new_v4().to_string();
    assert!(
        record_input_and_route(&state, &db, "same-keyword", "all", &ids, &input, false)
            .unwrap_err()
            .contains("화자")
    );
    assert!(!store::input_ai_only(&db, &input).unwrap());
}

#[test]
fn registered_pair_scene_requires_explicit_named_allowed_actors_and_preserves_order() {
    let (state, ids) = fixture(false);
    let db = lock(&state.db).unwrap();
    let authored = vec![
        SceneLine {
            persona: "b".into(),
            expression: "평온".into(),
            text: "  먼저 말하는 손님  ".into(),
            widget: None,
            motion: Default::default(),
        },
        SceneLine {
            persona: "a".into(),
            expression: "평온".into(),
            text: "  뒤에 답하는 중심\n원문  ".into(),
            widget: None,
            motion: Default::default(),
        },
    ];
    characters::save_dialogue(
        &db,
        &ids,
        &characters::CharacterDialogue {
            pair_scenes: vec![authored.clone()],
            wordbook: vec![],
        },
    )
    .unwrap();
    assert!(
        characters::registered_relation_scene(&db, "일반 대화가 필요해", &ids)
            .unwrap()
            .is_none()
    );
    assert!(
        characters::registered_relation_scene(&db, "중심에게 물어볼게", &ids)
            .unwrap()
            .is_none()
    );
    let input = uuid::Uuid::new_v4().to_string();
    let lines = record_input_and_route(
        &state,
        &db,
        "중심과 손님이 이야기해 줘",
        "all",
        &ids,
        &input,
        false,
    )
    .unwrap()
    .unwrap();
    assert_eq!(
        lines
            .iter()
            .map(|line| line.persona.clone())
            .collect::<Vec<_>>(),
        vec![ids[1].clone(), ids[0].clone()]
    );
    assert_eq!(
        lines
            .iter()
            .map(|line| line.text.clone())
            .collect::<Vec<_>>(),
        authored
            .iter()
            .map(|line| line.text.clone())
            .collect::<Vec<_>>()
    );
    assert!(!store::input_ai_only(&db, &input).unwrap());
    let mut same_name = characters::get(&db, &ids[1]).unwrap().definition;
    same_name.name = "중심".into();
    characters::save(&db, &ids[1], &same_name).unwrap();
    assert!(
        characters::registered_relation_scene(&db, "중심에게 물어볼게", &ids)
            .unwrap()
            .is_none()
    );
}

#[test]
fn registered_resident_line_keeps_valid_waiting_npc_as_listener_without_changing_authored_speaker()
{
    let (state, ids) = fixture(true);
    let intro = choose(&state, &ids[0], "이야기 시작");
    finish(&state, &intro);
    let _action = lock(&state.action).unwrap();
    let db = lock(&state.db).unwrap();
    let before = lock(&state.pack_stories).unwrap().run.clone().unwrap();
    let input = uuid::Uuid::new_v4().to_string();
    wordbook::save(
        &db,
        &WordbookEntry {
            id: uuid::Uuid::new_v4().to_string(),
            title: "중심만 말하는 원문".into(),
            keywords: vec!["listener-keyword".into()],
            lines: vec![SceneLine {
                persona: "a".into(),
                expression: "평온".into(),
                text: "나만 말하는 등록 원문".into(),
                widget: None,
                motion: Default::default(),
            }],
            enabled: true,
            use_for_idle: false,
            group: None,
        },
    )
    .unwrap();
    let lines = record_input_and_route(
        &state,
        &db,
        "listener-keyword",
        &ids[0],
        &ids[..1],
        &input,
        false,
    )
    .unwrap()
    .unwrap();
    let waiting = waiting_pack_run(&state, &db, &ids[..1]).unwrap();
    let (epoch, _) = super::super::tasks::reserve_conversation(&state, None, &input).unwrap();
    retain_pack_run(&state, &db, waiting, epoch).unwrap();
    let listeners = registered_participants(&state, &db, &lines, &ids[..1]).unwrap();
    let ticket = capture_participants_locked(&state, &db, &listeners, epoch).unwrap();
    characters::guests::hear_locked(&state, &db, &ticket, &input).unwrap();
    assert_eq!(lines[0].persona, ids[0]);
    assert!(ticket.ids.contains(&ids[1]));
    assert!(characters::guests::heard_message_ids(&state, &db, &ids[1])
        .unwrap()
        .contains(&input));
    let run = lock(&state.pack_stories).unwrap().run.clone().unwrap();
    assert_eq!(run.run_id, before.run_id);
    assert_eq!(run.phase_generation, before.phase_generation);
    assert!(run.ready);
    assert_eq!(effects(&db), (0, 0));
}

#[test]
fn visiting_friend_name_gets_the_reaction_but_an_exact_invite_still_brings_it_in() {
    let (state, ids) = fixture(true);
    {
        let db = lock(&state.db).unwrap();
        let mut guest = characters::get(&db, &ids[1]).unwrap().definition;
        guest.npc = Some(pack_stories::NpcDefinition {
            invite_keywords: vec!["손님 불러 줘".into()],
            entry_lines: vec![characters::CharacterLine {
                expression: "평온".into(),
                text: "초대받아 왔어.".into(),
                motion: Default::default(),
            }],
            ..Default::default()
        });
        characters::save(&db, &ids[1], &guest).unwrap();
        let mut center = characters::get(&db, &ids[0]).unwrap().definition;
        center.relationships = vec![characters::CharacterRelationship {
            target_id: ids[1].clone(),
            description: "가끔 놀러 오는 친구".into(),
            reply_lines: vec![characters::CharacterLine {
                expression: "평온".into(),
                text: "달빛 산책 좋아하는 애지?".into(),
                motion: Default::default(),
            }],
        }];
        characters::save(&db, &ids[0], &center).unwrap();
        let input = uuid::Uuid::new_v4().to_string();
        let lines = record_input_and_route(
            &state,
            &db,
            "손님 요즘 어때?",
            &ids[0],
            &ids[..1],
            &input,
            false,
        )
        .unwrap()
        .unwrap();
        assert_eq!(lines[0].text, "달빛 산책 좋아하는 애지?");
        assert!(lock(&state.pack_stories).unwrap().run.is_none());
        assert!(!characters::guests::is_present(&state, &db, &ids[1]).unwrap());
    }
    let entry = choose(&state, &ids[0], "손님 불러 줘");
    assert_eq!(entry.run.stage, pack_stories::Stage::Entry);
    assert_eq!(entry.lines[0].text, "초대받아 왔어.");
}

#[test]
fn standalone_entry_exact_cancellation_leaves_guest_quietly_after_registered_priority() {
    for content in [
        "그만",
        "다른 이야기",
        "화제 바꾸자",
        "그만이라는 말이 궁금해",
        "registered-priority",
    ] {
        let (state, ids) = fixture(true);
        {
            let db = lock(&state.db).unwrap();
            let mut actor = characters::get(&db, &ids[1]).unwrap().definition;
            actor.npc = Some(pack_stories::NpcDefinition {
                invite_keywords: vec!["입장".into()],
                entry_lines: vec![characters::CharacterLine {
                    expression: "평온".into(),
                    text: "초대받아 왔어.".into(),
                    motion: Default::default(),
                }],
                ..Default::default()
            });
            characters::save(&db, &ids[1], &actor).unwrap();
        }
        let entry = choose(&state, &ids[0], "입장");
        assert_eq!(entry.run.stage, pack_stories::Stage::Entry);
        finish(&state, &entry);
        let db = lock(&state.db).unwrap();
        let content = if content == "registered-priority" {
            wordbook::save(
                &db,
                &WordbookEntry {
                    id: uuid::Uuid::new_v4().to_string(),
                    title: "그만 우선 원문".into(),
                    keywords: vec!["그만".into()],
                    lines: vec![SceneLine {
                        persona: "a".into(),
                        expression: "평온".into(),
                        text: "등록 원문이 우선이야.".into(),
                        widget: None,
                        motion: Default::default(),
                    }],
                    enabled: true,
                    use_for_idle: false,
                    group: None,
                },
            )
            .unwrap();
            "그만"
        } else {
            content
        };
        let input = uuid::Uuid::new_v4().to_string();
        let result =
            record_input_and_route(&state, &db, content, &ids[0], &ids[..1], &input, false);
        if content == "그만이라는 말이 궁금해"
            || wordbook::entries(&db)
                .unwrap()
                .iter()
                .any(|entry| entry.title == "그만 우선 원문")
        {
            assert!(lock(&state.pack_stories)
                .unwrap()
                .run
                .as_ref()
                .is_some_and(|run| run.ready));
            assert!(characters::guests::is_present(&state, &db, &ids[1]).unwrap());
            if content == "그만" {
                assert_eq!(result.unwrap().unwrap()[0].text, "등록 원문이 우선이야.");
            } else {
                assert!(result.unwrap_err().contains("모델"));
            }
        } else {
            assert!(result.unwrap().unwrap().is_empty());
            assert!(lock(&state.pack_stories).unwrap().run.is_none());
            assert!(characters::guests::guest_ids(&state, &db)
                .unwrap()
                .is_empty());
            assert!(!store::input_ai_only(&db, &input).unwrap());
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
        assert_eq!(effects(&db), (0, 0));
    }
}
