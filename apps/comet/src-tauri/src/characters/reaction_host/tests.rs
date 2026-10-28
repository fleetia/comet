use super::*;
use crate::{
    characters::reactions::ReactionRule,
    store,
    types::{PanelState, Playback},
    widgets,
};

fn configured() -> (AppState, String) {
    let state = crate::app::tests::state();
    let id = {
        let db = lock(&state.db).unwrap();
        let mut character = characters::active_character(&db, "a").unwrap();
        character.definition.reactions = ["click", "grab-start", "release", "timer-finished"]
            .into_iter()
            .map(|event| ReactionRule {
                id: event.into(),
                event: event.into(),
                cooldown_ms: 60_000,
                variants: vec![ReactionVariant {
                    id: "one".into(),
                    text: Some(format!("  {event}\n그대로  ")),
                    expression: Some("평온".into()),
                    motion: MotionOverride::Static,
                }],
            })
            .collect();
        characters::save(&db, &character.id, &character.definition).unwrap();
        character.id
    };
    (state, id)
}

fn configured_gesture(gesture: &str) -> (AppState, String) {
    let (state, id) = configured();
    let db = lock(&state.db).unwrap();
    let mut character = characters::get(&db, &id).unwrap();
    character.definition.gesture_motions = vec![characters::reactions::GestureMotion {
        id: "direct".into(),
        gesture: gesture.into(),
        region_id: None,
        expression: Some("평온".into()),
        start: Some(MotionOverride::Static),
        hold: characters::reactions::sustained_gesture(gesture).then_some(MotionOverride::Static),
        moving_hold: (gesture == "pickup").then_some(MotionOverride::Inherit),
        end: Some(MotionOverride::Static),
    }];
    characters::save(&db, &id, &character.definition).unwrap();
    drop(db);
    (state, id)
}

#[test]
fn rare_idle_start_rechecks_higher_priority_states_before_owning_the_body() {
    let (state, id) = configured_gesture("idle-yawn");
    state.last_input.store(app::now() - 3, Ordering::SeqCst);
    for condition in ["focus", "rest", "calendar", "music"] {
        {
            let mut runtime = lock(&state.animation_states).unwrap();
            runtime.states = Default::default();
            match condition {
                "focus" => runtime.states.focus = true,
                "rest" => runtime.states.rest = true,
                "calendar" => runtime.states.calendar_open = true,
                _ => runtime.states.music_playing = true,
            }
        }
        assert!(
            prepare_direct(&state, &id, "idle-yawn", None, 7)
                .unwrap()
                .is_none(),
            "{condition}"
        );
        assert!(lock(&state.reactions).unwrap().runs.is_empty());
    }
    lock(&state.animation_states).unwrap().states = Default::default();
    assert!(prepare_direct(&state, &id, "idle-yawn", None, 7)
        .unwrap()
        .is_some());
}

#[test]
fn common_body_talk_uses_the_existing_pack_with_the_builtin_interaction_widget() {
    let state = crate::app::tests::state();
    let directory = tempfile::tempdir().unwrap();
    *lock(&state.talk).unwrap() = crate::talk::host::initialize(directory.path());
    let db = lock(&state.db).unwrap();
    let id = characters::active_character(&db, "b").unwrap().id;
    let event = widgets::storage::body_interaction(
        &db,
        &id,
        "stroke",
        &uuid::Uuid::new_v4().to_string(),
        chrono::Utc::now().timestamp_millis(),
    )
    .unwrap()
    .unwrap();
    assert!(widgets::storage::instances(&db)
        .unwrap()
        .iter()
        .any(|instance| instance.kind == "interaction"));
    let lines = crate::talk::host::prepare(&state, &db, Some(&event))
        .unwrap()
        .unwrap();
    assert!(!lines.is_empty());
    assert!(lines.iter().all(|line| line.persona == "b"));
    assert!(crate::talk::host::current(&state, &db).unwrap());
    db.execute(
        "UPDATE widget_instances SET revision=revision+1 WHERE kind='interaction'",
        [],
    )
    .unwrap();
    assert!(!crate::talk::host::current(&state, &db).unwrap());
}

#[test]
fn touching_one_character_expires_old_events_for_all_owners() {
    let state = crate::app::tests::state();
    let db = lock(&state.db).unwrap();
    let id = characters::active_character(&db, "a").unwrap().id;
    let user = store::active_user_id(&db).unwrap();
    let now = 1_000_000_000_i64;
    let cutoff = now - 172_800_000;
    for (character, owner, at) in [
        (id.as_str(), user.as_str(), cutoff - 1),
        (id.as_str(), "other-user", cutoff - 1),
        ("other-character", user.as_str(), cutoff - 1),
        ("other-character", "other-user", cutoff - 1),
        ("other-character", "other-user", cutoff),
        ("other-character", "other-user", cutoff + 1),
    ] {
        db.execute(
            "INSERT INTO character_touch_events(character_id,user_id,created_at) VALUES(?1,?2,?3)",
            rusqlite::params![character, owner, at],
        )
        .unwrap();
    }
    db.execute(
        "INSERT INTO character_touches(character_id,user_id,action,count,last_at) VALUES('other-character','other-user','stroke',7,?1)",
        [cutoff - 1],
    )
    .unwrap();
    widgets::storage::body_interaction(&db, &id, "stroke", &uuid::Uuid::new_v4().to_string(), now)
        .unwrap();
    let expired: i64 = db
        .query_row("SELECT COUNT(*) FROM character_touch_events WHERE created_at<?1", [cutoff], |row| row.get(0))
        .unwrap();
    let retained: i64 = db
        .query_row("SELECT COUNT(*) FROM character_touch_events WHERE character_id='other-character' AND user_id='other-user'", [], |row| row.get(0))
        .unwrap();
    let total: i64 = db
        .query_row("SELECT count FROM character_touches WHERE character_id='other-character' AND user_id='other-user'", [], |row| row.get(0))
        .unwrap();
    assert_eq!((expired, retained, total), (0, 2, 7));
}

#[test]
fn milestone_interrupts_automatic_talk_only_when_allowed_and_matched() {
    let state = crate::app::tests::state();
    let program = crate::talk::validate_source(
        std::path::Path::new("index.talk"),
        "format: 1\nscene: idle\non: idle\n---\nA: 이전 첫 줄\nA: 이전 다음 줄\n===\nscene: milestone\non: interaction.milestone\nwhen: interaction.milestone == 1\n---\nA: 기념 대사\n===\n",
        &crate::talk::context::registry(),
    )
    .unwrap();
    lock(&state.talk).unwrap().apply(Ok(program));
    let (old_epoch, old_cancel) = app::interrupt(&state, true).unwrap();
    let (old_lines, mut event, revision) = {
        let db = lock(&state.db).unwrap();
        let lines = crate::talk::host::prepare(&state, &db, None)
            .unwrap()
            .unwrap();
        let id = characters::active_character(&db, "a").unwrap().id;
        let mut event = widgets::storage::body_interaction(
            &db,
            &id,
            "stroke",
            &uuid::Uuid::new_v4().to_string(),
            chrono::Utc::now().timestamp_millis(),
        )
        .unwrap()
        .unwrap();
        event.event.kind = "interaction.milestone".into();
        (lines, event, store::revision(&db).unwrap())
    };
    assert!(scene::present_line(
        &state, &old_lines[0], "talk", "old-first", 0, 2, revision, old_epoch, &old_cancel, false,
    ).unwrap());
    assert!(scene::clear_line_if_current(&state, old_epoch, &old_cancel).unwrap());
    assert!(speech_reason(&state).unwrap().is_none());
    state.automatic.store(false, Ordering::SeqCst);
    assert!(speech_reason(&state).unwrap().is_some());
    state.automatic.store(true, Ordering::SeqCst);
    let (new_lines, new_epoch, new_cancel) = {
        let db = lock(&state.db).unwrap();
        lock(&state.runtime).unwrap().paused = true;
        assert!(prepare_milestone(&state, &db, &event).unwrap().is_none());
        lock(&state.runtime).unwrap().paused = false;
        event.event.payload["milestone"] = serde_json::json!(10);
        assert!(prepare_milestone(&state, &db, &event).unwrap().is_none());
        assert!(!old_cancel.load(Ordering::SeqCst));
        assert!(crate::talk::host::current(&state, &db).unwrap());
        event.event.payload["milestone"] = serde_json::json!(1);
        let (lines, (epoch, cancel)) = prepare_milestone(&state, &db, &event)
            .unwrap()
            .unwrap();
        assert_eq!(lines[0].text, "기념 대사");
        assert!(!cancel.load(Ordering::SeqCst));
        assert!(crate::talk::host::current(&state, &db).unwrap());
        let count: i64 = db
            .query_row("SELECT SUM(count) FROM character_touches", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
        (lines, epoch, cancel)
    };
    assert!(old_cancel.load(Ordering::SeqCst));
    assert!(!scene::present_line(
        &state, &old_lines[1], "talk", "old-next", 1, 2, revision, old_epoch, &old_cancel, false,
    ).unwrap());
    assert!(scene::present_line(
        &state, &new_lines[0], "talk", "milestone", 0, 1, revision, new_epoch, &new_cancel, false,
    ).unwrap());
}

#[test]
fn gesture_phases_ignore_late_completion_and_hold_cycles_until_explicit_release() {
    let (state, id) = configured_gesture("cheek-grab");
    let execution = prepare_direct(&state, &id, "cheek-grab", None, 7)
        .unwrap()
        .unwrap();
    let revision = lock(&state.reactions).unwrap().runs[&id]
        .definition_revision
        .clone();
    assert!(acknowledge_current(
        &state,
        &id,
        7,
        &execution,
        "finished",
        Some(1),
        Some(&revision)
    )
    .unwrap());
    assert_eq!(lock(&state.reactions).unwrap().runs[&id].phase, "hold");
    assert!(!acknowledge_current(
        &state,
        &id,
        7,
        &execution,
        "finished",
        Some(1),
        Some(&revision)
    )
    .unwrap());
    assert!(!acknowledge_current(
        &state,
        &id,
        7,
        &execution,
        "finished",
        Some(2),
        Some(&revision)
    )
    .unwrap());
    assert_eq!(lock(&state.reactions).unwrap().runs[&id].phase, "hold");
    assert!(end_direct(&state, &id, &execution, false).unwrap());
    assert_eq!(lock(&state.reactions).unwrap().runs[&id].phase, "end");
    assert!(!acknowledge_current(
        &state,
        &id,
        7,
        &execution,
        "finished",
        Some(2),
        Some(&revision)
    )
    .unwrap());
    assert!(acknowledge_current(
        &state,
        &id,
        7,
        &execution,
        "finished",
        Some(3),
        Some(&revision)
    )
    .unwrap());
    assert!(!lock(&state.reactions).unwrap().runs.contains_key(&id));
    assert!(!end_direct(&state, &id, &execution, false).unwrap());
}

#[test]
fn pickup_activity_selects_one_hold_phase_and_rejects_its_late_cycle_completion() {
    let (state, id) = configured_gesture("pickup");
    let execution = prepare_direct(&state, &id, "pickup", None, 7)
        .unwrap()
        .unwrap();
    assert!(update_direct_moving(&state, &id, &execution, true).unwrap());
    assert_eq!(
        lock(&state.reactions).unwrap().runs[&id].phase_generation,
        1
    );
    assert!(acknowledge(&state, &id, 7, &execution, "finished").unwrap());
    let revision = lock(&state.reactions).unwrap().runs[&id]
        .definition_revision
        .clone();
    assert!(lock(&state.reactions).unwrap().runs[&id]
        .motion
        .is_inherit());
    assert!(update_direct_moving(&state, &id, &execution, false).unwrap());
    assert_eq!(
        lock(&state.reactions).unwrap().runs[&id].motion,
        MotionOverride::Static
    );
    assert_eq!(
        lock(&state.reactions).unwrap().runs[&id].phase_generation,
        3
    );
    assert!(!acknowledge_current(
        &state,
        &id,
        7,
        &execution,
        "finished",
        Some(2),
        Some(&revision)
    )
    .unwrap());
    assert!(end_direct(&state, &id, &execution, false).unwrap());
    assert!(!update_direct_moving(&state, &id, &execution, true).unwrap());
    assert_eq!(lock(&state.reactions).unwrap().runs[&id].phase, "end");
}

#[test]
fn replacement_cancel_and_definition_edit_cannot_advance_an_old_gesture() {
    let (state, id) = configured_gesture("pickup");
    let old = prepare_direct(&state, &id, "pickup", None, 7)
        .unwrap()
        .unwrap();
    let current = prepare_direct(&state, &id, "pickup", None, 7)
        .unwrap()
        .unwrap();
    assert!(!end_direct(&state, &id, &old, false).unwrap());
    assert!(end_direct(&state, &id, &current, true).unwrap());
    assert!(!lock(&state.reactions).unwrap().runs.contains_key(&id));
    let edited = prepare_direct(&state, &id, "pickup", None, 7)
        .unwrap()
        .unwrap();
    {
        let db = lock(&state.db).unwrap();
        let mut character = characters::get(&db, &id).unwrap();
        character.definition.name.push('!');
        characters::save(&db, &id, &character.definition).unwrap();
    }
    assert!(!acknowledge(&state, &id, 7, &edited, "finished").unwrap());
    assert!(!end_direct(&state, &id, &edited, false).unwrap());
    reconcile_state(&state, &[]).unwrap();
    assert!(lock(&state.reactions).unwrap().runs.is_empty());
}

#[test]
fn a_drag_blocks_presence_even_without_a_reaction_visual() {
    let mut runtime = Runtime::default();
    assert!(!runtime.blocks_presence());
    runtime.dragging.insert(
        "character".into(),
        Drag {
            session_id: "drag".into(),
            generation: 1,
            definition: "definition".into(),
            roster: "roster".into(),
            actor: crate::characters::guests::ActorTicket {
                id: "character".into(),
                definition_baseline: "definition".into(),
                guest_generation: None,
            },
        },
    );
    assert!(runtime.runs.is_empty());
    assert!(runtime.blocks_presence());
    runtime.dragging.clear();
    assert!(!runtime.blocks_presence());
}
fn prepare(state: &AppState, id: &str, event: &str) -> Prepared {
    prepare_reaction(state, id, event, 7, None, None)
        .unwrap()
        .unwrap()
}
fn display(state: &AppState, prepared: Prepared) -> String {
    let (line, (epoch, cancel), id) = prepared.speech.unwrap();
    let revision = store::revision(&lock(&state.db).unwrap()).unwrap();
    let message_id = format!("scene:reaction:{id}:0");
    assert!(scene::present_line(
        state,
        &line,
        "reaction",
        &message_id,
        0,
        1,
        revision,
        epoch,
        &cancel,
        false
    )
    .unwrap());
    scene::mark_line_displayed(
        lock(&state.playback).unwrap().as_mut().unwrap(),
        chrono::Utc::now().timestamp_millis(),
    );
    reconcile_state(state, &[]).unwrap();
    message_id
}
fn playback(source: &str, id: &str) -> Playback {
    Playback {
        id: "existing".into(),
        persona: id.into(),
        expression: "평온".into(),
        text: "읽던 대화".into(),
        motion: MotionOverride::Inherit,
        source: source.into(),
        link: None,
        text_speed: 0,
        display_started_at: Some(1),
        ends_at: i64::MAX,
        line_index: 0,
        line_count: 1,
    }
}
fn timer_event(state: &AppState, owner: &str) -> widgets::WidgetEvent {
    let directory = tempfile::tempdir().unwrap();
    let db = lock(&state.db).unwrap();
    widgets::storage::verify_packages(&db, directory.path()).unwrap();
    let instance = widgets::storage::instances(&db)
        .unwrap()
        .into_iter()
        .find(|value| value.kind == "focus-timer")
        .unwrap();
    widgets::WidgetEvent {
        id: "timer-event".into(),
        instance_id: instance.id,
        widget_kind: instance.kind,
        revision: instance.revision,
        created_at: 0,
        expires_at: i64::MAX,
        event: widgets::EventDraft {
            kind: "timer-finished".into(),
            text: "default".into(),
            payload: serde_json::json!({"owner":owner}),
        },
    }
}
#[test]
fn visual_reactions_do_not_interrupt_direct_dialogue_or_panels_and_keep_character_identity() {
    let (state, id) = configured();
    for panel in [
        None,
        Some(PanelState {
            persona: id.clone(),
            mode: "menu".into(),
        }),
    ] {
        *lock(&state.panel).unwrap() = panel;
        lock(&state.runtime).unwrap().phase = RuntimePhase::Playing;
        *lock(&state.playback).unwrap() = Some(playback("wordbook", &id));
        let epoch = state.epoch.load(Ordering::SeqCst);
        assert!(prepare(&state, &id, "click").speech.is_none());
        assert_eq!(state.epoch.load(Ordering::SeqCst), epoch);
        assert_eq!(
            lock(&state.playback).unwrap().as_ref().unwrap().id,
            "existing"
        );
        assert!(lock(&state.reactions).unwrap().runs.contains_key(&id));
    }
}

#[test]
fn focus_preserves_physical_reactions_without_starting_speech() {
    let (state, id) = configured();
    let directory = tempfile::tempdir().unwrap();
    {
        let db = lock(&state.db).unwrap();
        widgets::storage::verify_packages(&db, directory.path()).unwrap();
        let timer = widgets::storage::instances(&db)
            .unwrap()
            .into_iter()
            .find(|instance| instance.kind == "focus-timer")
            .unwrap();
        let mut data = timer.data;
        data["status"] = serde_json::json!("running");
        data["mode"] = serde_json::json!("focus");
        data["deadline"] = serde_json::json!(chrono::Utc::now().timestamp_millis() + 60_000);
        widgets::storage::commit_data(&db, &timer.id, timer.revision, data, vec![], 0).unwrap();
    }
    let epoch = state.epoch.load(Ordering::SeqCst);
    for event in ["click", "grab-start", "release"] {
        let prepared = prepare(&state, &id, event);
        assert!(prepared.speech.is_none());
        assert_eq!(lock(&state.reactions).unwrap().runs[&id].event, event);
        assert_eq!(state.epoch.load(Ordering::SeqCst), epoch);
    }
    assert!(lock(&state.playback).unwrap().is_none());
}

#[test]
fn a_current_registered_story_keeps_direct_reactions_silent_without_advancing_or_cancelling() {
    let (state, original_id) = configured();
    let id = {
        let db = lock(&state.db).unwrap();
        let mut pack = characters::factory_pack();
        pack.characters[0].reactions = characters::get(&db, &original_id)
            .unwrap()
            .definition
            .reactions;
        let installed = characters::import_pack(&db, &pack).unwrap();
        characters::apply_roster(&db, vec![installed[0].id.clone()]).unwrap();
        installed[0].id.clone()
    };
    let run = {
        let db = lock(&state.db).unwrap();
        let pack_id = characters::get(&db, &id).unwrap().pack_id.unwrap();
        crate::pack_stories::RunTicket {
            run_id: "protected-story".into(),
            input_id: uuid::Uuid::new_v4().to_string(),
            scope: crate::pack_stories::Scope {
                user_id: store::active_user_id(&db).unwrap(),
                pack_id: pack_id.clone(),
                center_id: id.clone(),
            },
            scenario_id: None,
            stage: crate::pack_stories::Stage::Entry,
            phase_generation: 1,
            epoch: 0,
            participants: vec![id.clone()],
            pack_baseline: characters::pack_definition_baseline(&db, &pack_id).unwrap(),
            definition_baselines: std::collections::BTreeMap::from([(
                id.clone(),
                characters::character_definition_baseline(&db, &id).unwrap(),
            )]),
            last_playback_id: "entry:final".into(),
            definition: None,
            ready: true,
        }
    };
    lock(&state.pack_stories).unwrap().run = Some(run.clone());
    assert!(speech_reason(&state).unwrap().is_some());
    let prepared = prepare(&state, &id, "click");
    assert!(prepared.speech.is_none());
    assert!(lock(&state.reactions).unwrap().runs.contains_key(&id));
    assert_eq!(state.epoch.load(Ordering::SeqCst), 0);
    let current = lock(&state.pack_stories).unwrap().run.clone().unwrap();
    assert_eq!(
        (current.run_id, current.stage, current.ready),
        (run.run_id, run.stage, run.ready)
    );
}

#[test]
fn only_ambient_automatic_speech_yields_and_pending_reaction_does_not_queue_more_text() {
    let (state, id) = configured();
    lock(&state.runtime).unwrap().phase = RuntimePhase::Playing;
    *lock(&state.playback).unwrap() = Some(playback("script", &id));
    state.automatic.store(true, Ordering::SeqCst);
    let accepted = prepare(&state, &id, "click");
    assert!(accepted.speech.is_some());
    let first_run = lock(&state.reactions).unwrap().runs[&id].id.clone();
    let epoch = state.epoch.load(Ordering::SeqCst);
    assert!(prepare(&state, &id, "click").speech.is_none());
    assert_ne!(lock(&state.reactions).unwrap().runs[&id].id, first_run);
    assert_eq!(state.epoch.load(Ordering::SeqCst), epoch);
}
#[test]
fn speech_cooldown_starts_only_after_display_and_never_blocks_a_new_visual_run() {
    let (state, id) = configured();
    let first = prepare(&state, &id, "click");
    assert!(
        lock(&state.reactions).unwrap().histories[&(id.clone(), "click".into())]
            .last_played_at
            .is_none()
    );
    app::interrupt(&state, false).unwrap();
    lock(&state.runtime).unwrap().phase = RuntimePhase::Idle;
    let second = prepare(&state, &id, "click");
    assert!(second.speech.is_some());
    assert!(first.speech.unwrap().1 .1.load(Ordering::SeqCst));
    let message_id = display(&state, second);
    assert!(
        lock(&state.reactions).unwrap().histories[&(id.clone(), "click".into())]
            .last_played_at
            .is_some()
    );
    lock(&state.runtime).unwrap().phase = RuntimePhase::Idle;
    *lock(&state.playback).unwrap() = None;
    let prior = lock(&state.reactions).unwrap().runs[&id].id.clone();
    let epoch = state.epoch.load(Ordering::SeqCst);
    assert!(prepare(&state, &id, "click").speech.is_none());
    assert_ne!(prior, lock(&state.reactions).unwrap().runs[&id].id);
    assert_eq!(epoch, state.epoch.load(Ordering::SeqCst));
    let db = lock(&state.db).unwrap();
    assert_eq!(
        store::messages(&db, 10)
            .unwrap()
            .iter()
            .find(|message| message.id == message_id)
            .unwrap()
            .content,
        "  click\n그대로  "
    );
    assert_eq!(
        db.query_row(
            "SELECT source FROM message_context WHERE message_id=?",
            [&message_id],
            |row| row.get::<_, String>(0)
        )
        .unwrap(),
        "reaction"
    );
    assert_eq!(
        db.query_row("SELECT count(*) FROM memory_analysis_jobs", [], |row| row
            .get::<_, i64>(
            0
        ))
        .unwrap(),
        0
    );
}
#[test]
fn release_cancels_only_owned_grab_speech_including_before_its_balloon_is_ready() {
    let (state, id) = configured();
    let grab = prepare(&state, &id, "grab-start");
    let (line, (epoch, cancel), _) = grab.speech.unwrap();
    cancel_grab_speech(&state, &id).unwrap();
    assert!(cancel.load(Ordering::SeqCst));
    let revision = store::revision(&lock(&state.db).unwrap()).unwrap();
    assert!(!scene::present_line(
        &state, &line, "reaction", "late", 0, 1, revision, epoch, &cancel, false
    )
    .unwrap());
    assert!(prepare(&state, &id, "release").speech.is_some());
    app::interrupt(&state, false).unwrap();
    lock(&state.runtime).unwrap().phase = RuntimePhase::Playing;
    *lock(&state.playback).unwrap() = Some(playback("wordbook", &id));
    let epoch = state.epoch.load(Ordering::SeqCst);
    cancel_grab_speech(&state, &id).unwrap();
    assert_eq!(state.epoch.load(Ordering::SeqCst), epoch);
    assert_eq!(
        lock(&state.playback).unwrap().as_ref().unwrap().id,
        "existing"
    );
}
#[test]
fn old_or_recreated_window_acknowledgements_cannot_finish_the_current_run() {
    let (state, id) = configured();
    prepare(&state, &id, "click");
    let old = lock(&state.reactions).unwrap().runs[&id].id.clone();
    prepare(&state, &id, "click");
    let current = lock(&state.reactions).unwrap().runs[&id].id.clone();
    assert!(!acknowledge(&state, &id, 7, &old, "finished").unwrap());
    assert!(!acknowledge(&state, &id, 8, &current, "finished").unwrap());
    assert!(!acknowledge(&state, &id, 7, &current, "ready").unwrap());
    assert!(lock(&state.reactions).unwrap().runs[&id].ready);
    assert!(acknowledge(&state, &id, 7, &current, "finished").unwrap());
    assert!(!lock(&state.reactions).unwrap().runs.contains_key(&id));
}

#[test]
fn manual_pause_preserves_click_and_important_widget_reactions_but_hiding_still_cancels() {
    for click in [true, false] {
        let (state, id) = configured();
        crate::app::windows::apply_pause(&state, true, None).unwrap();
        let prepared = if click {
            prepare(&state, &id, "click")
        } else {
            let event = timer_event(&state, &id);
            prepare_reaction(
                &state,
                &id,
                "timer-finished",
                7,
                Some((&event, state.epoch.load(Ordering::SeqCst))),
                None,
            )
            .unwrap()
            .unwrap()
        };
        display(&state, prepared);
        assert!(lock(&state.reactions).unwrap().runs.contains_key(&id));
        lock(&state.runtime).unwrap().hidden = true;
        reconcile_state(&state, &[]).unwrap();
        assert!(!lock(&state.reactions).unwrap().runs.contains_key(&id));
        assert!(prepare_reaction(&state, &id, "click", 7, None, None)
            .unwrap()
            .is_none());
    }
}
#[test]
fn hidden_definition_and_roster_transitions_drop_runs_without_revival() {
    for transition in ["hide", "definition", "roster"] {
        let (state, id) = configured();
        prepare(&state, &id, "grab-start");
        match transition {
            "hide" => lock(&state.runtime).unwrap().hidden = true,
            "definition" => {
                let db = lock(&state.db).unwrap();
                let mut character = characters::get(&db, &id).unwrap();
                character.definition.name.push('!');
                characters::save(&db, &id, &character.definition).unwrap();
            }
            _ => {
                let db = lock(&state.db).unwrap();
                let mut ids = characters::active_ids(&db).unwrap();
                ids.reverse();
                characters::apply_roster(&db, ids).unwrap();
            }
        }
        assert!(reconcile_state(&state, &[]).unwrap().contains(&id));
        assert!(lock(&state.reactions).unwrap().runs.is_empty());
        lock(&state.runtime).unwrap().hidden = false;
        lock(&state.runtime).unwrap().paused = false;
        reconcile_state(&state, &[]).unwrap();
        assert!(lock(&state.reactions).unwrap().runs.is_empty());
    }
}
#[test]
fn widget_reactions_obey_owner_epoch_revision_expiry_and_same_cooldown_policy() {
    let (state, id) = configured();
    let mut event = timer_event(&state, &id);
    assert_eq!(
        widget_character(&lock(&state.db).unwrap(), &event).unwrap(),
        Some(id.clone())
    );
    assert!(
        prepare_reaction(&state, &id, "timer-finished", 7, Some((&event, 99)), None)
            .unwrap()
            .is_none()
    );
    event.revision += 1;
    assert!(
        prepare_reaction(&state, &id, "timer-finished", 7, Some((&event, 0)), None)
            .unwrap()
            .is_none()
    );
    event.revision -= 1;
    event.expires_at = 0;
    assert!(
        prepare_reaction(&state, &id, "timer-finished", 7, Some((&event, 0)), None)
            .unwrap()
            .is_none()
    );
    event.expires_at = i64::MAX;
    let accepted = prepare_reaction(&state, &id, "timer-finished", 7, Some((&event, 0)), None)
        .unwrap()
        .unwrap();
    assert_eq!(
        accepted.speech.as_ref().unwrap().0.text,
        "  timer-finished\n그대로  "
    );
    assert_eq!(
        lock(&state.widget_playback).unwrap().as_ref().unwrap().id,
        event.id
    );
    event.event.payload = serde_json::json!({"owner":"removed-character"});
    assert!(widget_character(&lock(&state.db).unwrap(), &event)
        .unwrap()
        .is_none());
}

#[test]
fn interaction_targets_resolve_uppercase_slots_and_ignore_absent_members() {
    let (state, _) = configured();
    let db = lock(&state.db).unwrap();
    let ids = characters::active_ids(&db).unwrap();
    for id in &ids {
        let mut character = characters::get(&db, id).unwrap();
        character.definition.reactions.push(ReactionRule {
            id: "touch".into(),
            event: "interaction.touch".into(),
            cooldown_ms: 0,
            variants: vec![ReactionVariant {
                id: "one".into(),
                text: Some("반가워!".into()),
                expression: None,
                motion: MotionOverride::Inherit,
            }],
        });
        characters::save(&db, id, &character.definition).unwrap();
    }
    let mut event = widgets::WidgetEvent {
        id: "interaction-event".into(),
        instance_id: "interaction".into(),
        widget_kind: "interaction".into(),
        revision: 1,
        created_at: 0,
        expires_at: i64::MAX,
        event: widgets::EventDraft {
            kind: "interaction.touch".into(),
            text: "A를 쓰다듬었어요.".into(),
            payload: serde_json::json!({"character":"A"}),
        },
    };
    for (slot, id) in [
        ("A", &ids[0]),
        ("B", &ids[1]),
        ("a", &ids[0]),
        ("b", &ids[1]),
    ] {
        event.event.payload["character"] = serde_json::json!(slot);
        assert_eq!(widget_character(&db, &event).unwrap(), Some(id.clone()));
    }
    characters::apply_roster(&db, vec![ids[1].clone(), ids[0].clone()]).unwrap();
    event.event.payload["character"] = serde_json::json!("A");
    assert_eq!(widget_character(&db, &event).unwrap(), Some(ids[1].clone()));
    event.event.payload["owner"] = serde_json::json!(ids[0]);
    assert_eq!(widget_character(&db, &event).unwrap(), Some(ids[0].clone()));
    characters::apply_roster(&db, vec![ids[1].clone()]).unwrap();
    assert_eq!(widget_character(&db, &event).unwrap(), None);
    event.event.payload.as_object_mut().unwrap().remove("owner");
    event.event.payload["character"] = serde_json::json!("B");
    assert_eq!(widget_character(&db, &event).unwrap(), None);
}
#[test]
fn completed_widget_scene_allows_click_speech_while_active_widget_remains_protected() {
    let (state, id) = configured();
    let event = timer_event(&state, &id);
    let (epoch, cancel) = app::interrupt(&state, true).unwrap();
    *lock(&state.widget_playback).unwrap() = Some(event);
    let revision = store::revision(&lock(&state.db).unwrap()).unwrap();
    let line = SceneLine {
        persona: id.clone(),
        expression: "평온".into(),
        text: "타이머가 끝났어.".into(),
        widget: None,
        motion: MotionOverride::Inherit,
    };
    assert!(scene::present_line(
        &state,
        &line,
        "widget",
        "widget-line",
        0,
        1,
        revision,
        epoch,
        &cancel,
        false,
    )
    .unwrap());
    scene::mark_line_displayed(lock(&state.playback).unwrap().as_mut().unwrap(), 123_456);
    assert!(prepare(&state, &id, "click").speech.is_none());
    assert!(!cancel.load(Ordering::SeqCst));

    assert!(scene::clear_line_if_current(&state, epoch, &cancel).unwrap());
    assert!(app::set_phase_if_current(&state, epoch, RuntimePhase::Idle, None, None).unwrap());
    assert!(lock(&state.widget_playback).unwrap().is_some());
    assert!(prepare(&state, &id, "click").speech.is_some());
    assert!(cancel.load(Ordering::SeqCst));
}
#[test]
fn native_preview_uses_same_selection_without_mutating_history_or_records() {
    let (state, id) = configured();
    let definition = characters::get(&lock(&state.db).unwrap(), &id)
        .unwrap()
        .definition;
    let preview =
        preview_character_reaction(definition.clone(), "grab-start".into(), true, Some(0)).unwrap();
    assert!(preview.speech_reason.is_some());
    assert!(!preview.selection.as_ref().unwrap().speech_allowed);
    let actual = prepare(&state, &id, "grab-start");
    assert_eq!(
        actual.speech.unwrap().0.text,
        preview.selection.unwrap().variant.text.unwrap()
    );
    assert!(store::messages(&lock(&state.db).unwrap(), 10)
        .unwrap()
        .is_empty());
}

#[test]
fn interruption_between_actual_display_and_publication_still_consumes_speech_cooldown() {
    let (state, id) = configured();
    let (line, (epoch, cancel), run_id) = prepare(&state, &id, "click").speech.unwrap();
    let revision = store::revision(&lock(&state.db).unwrap()).unwrap();
    assert!(scene::present_line(
        &state,
        &line,
        "reaction",
        &format!("scene:reaction:{run_id}:0"),
        0,
        1,
        revision,
        epoch,
        &cancel,
        false
    )
    .unwrap());
    scene::mark_line_displayed(lock(&state.playback).unwrap().as_mut().unwrap(), 123_456);
    app::interrupt(&state, false).unwrap();
    assert_eq!(
        lock(&state.reactions).unwrap().histories[&(id, "click".into())].last_played_at,
        Some(123_456)
    );
}
