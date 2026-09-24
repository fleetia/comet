use super::*;
use crate::{
    character_reactions::ReactionRule,
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
    widgets::storage::install(&db, directory.path(), &["focus-timer".into()]).unwrap();
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
fn hidden_paused_definition_and_roster_transitions_drop_runs_without_revival() {
    for transition in ["hide", "pause", "definition", "roster"] {
        let (state, id) = configured();
        prepare(&state, &id, "grab-start");
        match transition {
            "hide" => lock(&state.runtime).unwrap().hidden = true,
            "pause" => lock(&state.runtime).unwrap().paused = true,
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
