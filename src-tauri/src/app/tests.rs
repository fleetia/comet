use super::background::{begin_background, expire_idle_recall, reserve_api_idle};
use super::conversation::{
    ensure_retry_characters, generate_turn, remaining_retry, reply_id, route_message, turn_prompt,
};
use super::lifecycle::{flush_positions, prepare_exit};
use super::scene::{character_script, clear_line_if_current, next_scene, present_line};
use super::settings::{apply_settings, begin_download, SettingsScope};
use super::windows::{apply_pause, should_cancel_for_pause};
use super::*;
use crate::{character_commands, story_host};
use std::time::Duration;
pub(crate) fn state() -> AppState {
    AppState {
        db: Mutex::new(store::open(std::path::Path::new(":memory:")).unwrap()),
        inference: inference::Inference::new(PathBuf::new(), PathBuf::new(), PathBuf::new()),
        nlp: crate::nlp::NlpService::new(
            std::env::temp_dir().join(format!("comet-nlp-test-{}", uuid::Uuid::new_v4())),
            PathBuf::new(),
            PathBuf::new(),
        )
        .unwrap(),
        app_data: PathBuf::new(),
        runtime: Mutex::new(RuntimeStatus::default()),
        playback: Mutex::new(None),
        panel: Mutex::new(None),
        settings_section: Mutex::new(windows::SettingsSection::default()),
        settings_dirty: AtomicBool::new(false),
        settings_exit_confirmed: AtomicBool::new(false),
        tasks: Mutex::new(super::tasks::Registry::default()),
        cancellation: Mutex::new(None),
        download_cancel: Mutex::new(None),
        gate: tokio::sync::Mutex::new(()),
        epoch: AtomicU64::new(0),
        widget_epoch: AtomicU64::new(0),
        widget_playback: Mutex::new(None),
        talk: Mutex::new(talk::runtime::ActiveProgram::default()),
        talk_playback: Mutex::new(None),
        talk_turn: AtomicBool::new(true),
        story: Mutex::new(None),
        story_clock: Mutex::new(story::Clock::default()),
        story_catalog: Mutex::new(story::catalog().unwrap()),
        widget_jobs: Mutex::new(HashMap::new()),
        widget_clocks: Mutex::new(std::collections::BTreeMap::new()),
        last_input: AtomicI64::new(0),
        last_foreground: AtomicI64::new(0),
        last_scene: AtomicI64::new(0),
        next_idle: AtomicI64::new(0),
        last_preparation: AtomicI64::new(0),
        last_background_check: AtomicI64::new(0),
        idle_sequence: AtomicU64::new(0),
        action: Mutex::new(()),
        automatic: AtomicBool::new(false),
        stopping: AtomicBool::new(false),
        update_installing: AtomicBool::new(false),
        behavior: Mutex::new(behavior::Machine::default()),
        positions: Mutex::new(HashMap::new()),
    }
}
fn test_lines() -> Vec<SceneLine> {
    ["a", "b", "a", "b"]
        .into_iter()
        .enumerate()
        .map(|(index, persona)| SceneLine {
            persona: persona.into(),
            expression: "평온".into(),
            text: format!("재생 검증 대사 {index}"),
        })
        .collect()
}

fn use_neutral_characters(db: &Connection) {
    for slot in ["a", "b"] {
        let mut character = characters::active_character(db, slot).unwrap();
        character.definition.source_id = format!("test-{slot}");
        character.definition.name = format!("Test {slot}");
        character.definition.description = "테스트 캐릭터".into();
        character.definition.personality = "간단히 대답합니다.".into();
        character.definition.greeting = vec![characters::CharacterLine {
            expression: "평온".into(),
            text: format!("테스트 인사 {slot}"),
        }];
        db.execute(
            "UPDATE characters SET data=?1 WHERE id=?2",
            rusqlite::params![
                serde_json::to_string(&character.definition).unwrap(),
                character.id
            ],
        )
        .unwrap();
    }
}

#[test]
fn hourly_story_suppression_and_interruption_never_resurrect_a_request() {
    for cause in ["input", "pause", "settings", "hide"] {
        let state = state();
        {
            let db = lock(&state.db).unwrap();
            let imported = characters::import_pack(&db, &characters::nadir_pack()).unwrap();
            characters::apply_pair(&db, [imported[0].id.clone(), imported[1].id.clone()]).unwrap();
        }
        lock(&state.story_clock).unwrap().elapsed = Duration::from_secs(3600);
        lock(&state.runtime).unwrap().hidden = true;
        assert!(!story_host::advance(&state, Instant::now()).unwrap());
        lock(&state.runtime).unwrap().hidden = false;
        lock(&state.runtime).unwrap().paused = true;
        assert!(!story_host::advance(&state, Instant::now()).unwrap());
        lock(&state.runtime).unwrap().paused = false;
        assert!(story_host::advance(&state, Instant::now()).unwrap());
        let request = lock(&state.story).unwrap().clone().unwrap();
        assert_eq!(lock(&state.runtime).unwrap().phase, "story");
        match cause {
            "pause" => {
                apply_pause(&state, true).unwrap();
            }
            "settings" => {
                let mut settings = store::settings(&lock(&state.db).unwrap()).unwrap();
                settings.autonomous_enabled = false;
                apply_settings(&state, &settings, None, None).unwrap();
            }
            _ => {
                let _action = lock(&state.action).unwrap();
                interrupt(&state, false).unwrap();
            }
        }
        assert!(lock(&state.story).unwrap().is_none());
        assert!(!story_host::advance(&state, Instant::now()).unwrap());
        assert!(story::answer(
            &lock(&state.db).unwrap(),
            &request,
            "listen",
            state.epoch.load(Ordering::SeqCst)
        )
        .is_err());
        assert_eq!(
            store::relationships(&lock(&state.db).unwrap()).unwrap()[0].score,
            20
        );
    }
}

#[test]
fn talk_turns_leave_general_sequence_and_prepared_history_untouched() {
    let state = state();
    let program = talk::validate_source(
        std::path::Path::new("index.talk"),
        "format: 1\nscene: example\non: idle\ncooldown: 1h\n---\nA: 하나\nB: 둘\n===",
        &talk::context::registry(),
    )
    .unwrap();
    lock(&state.talk).unwrap().apply(Ok(program));
    assert_eq!(next_scene(&state).unwrap().1, "script");
    assert_eq!(next_scene(&state).unwrap().1, "talk");
    assert_eq!(state.idle_sequence.load(Ordering::SeqCst), 1);
    assert!(talk::runtime::history(&lock(&state.db).unwrap())
        .unwrap()
        .is_empty());
    assert_eq!(next_scene(&state).unwrap().1, "script");
    assert_eq!(state.idle_sequence.load(Ordering::SeqCst), 2);
    assert_eq!(next_scene(&state).unwrap().1, "talk");
    let revision = store::revision(&lock(&state.db).unwrap()).unwrap();
    let line = lock(&state.talk_playback)
        .unwrap()
        .as_ref()
        .unwrap()
        .selection
        .lines[0]
        .clone();
    assert!(present_line(
        &state,
        &line,
        "talk",
        "shown",
        0,
        2,
        revision,
        0,
        &AtomicBool::new(false),
        false,
    )
    .unwrap());
    assert_eq!(next_scene(&state).unwrap().1, "script");
    assert_eq!(next_scene(&state).unwrap().1, "script");
    assert_eq!(state.idle_sequence.load(Ordering::SeqCst), 4);
}

#[test]
fn talk_remaining_lines_stop_after_each_dependency_and_host_invalidation() {
    for cause in [
        "todo",
        "memo",
        "disable",
        "input",
        "pause",
        "manual-pause",
        "auto-off",
        "reload",
        "swap",
        "hide",
    ] {
        let state = state();
        let directory = tempfile::tempdir().unwrap();
        let program = talk::validate_source(std::path::Path::new("index.talk"),
                "format: 1\nscene: joint\non: idle\nwhen: todo.ready and memo.ready\n---\nA: 할 일 ${todo.openCount}개\nB: 메모 ${memo.count}개\n===", &talk::context::registry()).unwrap();
        lock(&state.talk).unwrap().apply(Ok(program));
        let (token, lines, revision) = {
            let _action = lock(&state.action).unwrap();
            let db = lock(&state.db).unwrap();
            widgets::storage::install(&db, directory.path(), &["todo".into(), "memo".into()])
                .unwrap();
            let token = interrupt(&state, cause != "manual-pause").unwrap();
            let lines = talk_host::prepare(&state, &db, None).unwrap().unwrap();
            assert!(talk::runtime::history(&db).unwrap().is_empty());
            (token, lines, store::revision(&db).unwrap())
        };
        assert!(present_line(
            &state, &lines[0], "talk", "first", 0, 2, revision, token.0, &token.1, false,
        )
        .unwrap());
        match cause {
            "todo" | "memo" | "disable" => {
                let db = lock(&state.db).unwrap();
                let instance = widgets::storage::instances(&db)
                    .unwrap()
                    .into_iter()
                    .find(|instance| {
                        instance.kind == if cause == "disable" { "memo" } else { cause }
                    })
                    .unwrap();
                if cause == "disable" {
                    widgets::storage::set_enabled(&db, &instance.id, false).unwrap();
                } else {
                    let mut changed = instance.data;
                    changed["items"] = serde_json::json!([{"id":"added","title":"추가","text":"메모","completedAt":null}]);
                    widgets::storage::commit_data(
                        &db,
                        &instance.id,
                        instance.revision,
                        changed,
                        vec![],
                        chrono::Utc::now().timestamp_millis(),
                    )
                    .unwrap();
                }
            }
            "pause" | "manual-pause" => {
                apply_pause(&state, true).unwrap();
            }
            "auto-off" => {
                let mut settings = store::settings(&lock(&state.db).unwrap()).unwrap();
                settings.autonomous_enabled = false;
                apply_settings(&state, &settings, None, None).unwrap();
            }
            "reload" => {
                lock(&state.talk).unwrap().apply(talk::validate_source(
                    std::path::Path::new("index.talk"),
                    "format: 1\n",
                    &talk::context::registry(),
                ));
            }
            "swap" => {
                character_commands::mutate(&state, |db| {
                    characters::apply_pair(db, ["builtin-b".into(), "builtin-a".into()])
                })
                .unwrap();
            }
            _ => {
                let _action = lock(&state.action).unwrap();
                interrupt(&state, false).unwrap();
            }
        }
        assert!(
            !present_line(
                &state, &lines[1], "talk", "second", 1, 2, revision, token.0, &token.1, false,
            )
            .unwrap(),
            "{cause}"
        );
        assert_eq!(
            store::messages(&lock(&state.db).unwrap(), 10)
                .unwrap()
                .len(),
            1,
            "{cause}"
        );
        assert_eq!(
            talk::runtime::history(&lock(&state.db).unwrap())
                .unwrap()
                .len(),
            1,
            "{cause}"
        );
    }
}

#[test]
fn talk_history_and_shown_message_commit_together_and_survive_reopen() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("history.sqlite");
    let message = Message {
        id: "first".into(),
        role: "assistant".into(),
        persona: Some("a".into()),
        content: "원문\n 그대로".into(),
        expression: Some("평온".into()),
        created_at: 1000,
        status: "complete".into(),
    };
    {
        let db = store::open(&path).unwrap();
        store::insert_message_with_talk(&db, &message, Some("scene-key")).unwrap();
        let duplicate = Message {
            created_at: 2000,
            ..message.clone()
        };
        store::insert_message_with_talk(&db, &duplicate, Some("scene-key")).unwrap();
        assert_eq!(talk::runtime::history(&db).unwrap()["scene-key"], 1000);
        db.execute_batch("CREATE TRIGGER fail_talk BEFORE INSERT ON talk_history BEGIN SELECT RAISE(ABORT,'test failure'); END;").unwrap();
        let failed = Message {
            id: "failed".into(),
            ..message.clone()
        };
        assert!(store::insert_message_with_talk(&db, &failed, Some("other")).is_err());
        assert_eq!(store::messages(&db, 10).unwrap().len(), 1);
    }
    let reopened = open_session(&path).unwrap();
    assert_eq!(
        talk::runtime::history(&reopened).unwrap()["scene-key"],
        1000
    );
    assert_eq!(
        store::messages(&reopened, 10).unwrap()[0].content,
        message.content
    );
}

#[test]
fn brief_idle_pause_discards_widget_queue_before_a_scheduler_tick() {
    let state = state();
    let directory = tempfile::tempdir().unwrap();
    {
        let db = lock(&state.db).unwrap();
        widgets::storage::install(&db, directory.path(), &["small-match".into()]).unwrap();
        let instance = widgets::storage::instances(&db).unwrap().remove(0);
        widgets::storage::commit_data(
            &db,
            &instance.id,
            instance.revision,
            instance.data,
            vec![widgets::EventDraft {
                kind: "small-match.result".into(),
                text: "주사위 결과".into(),
                payload: serde_json::json!({}),
            }],
            chrono::Utc::now().timestamp_millis(),
        )
        .unwrap();
    }
    assert!(!state.automatic.load(Ordering::SeqCst));
    assert!(apply_pause(&state, true).unwrap().is_none());
    {
        let db = lock(&state.db).unwrap();
        assert!(
            widgets::storage::take_reaction(&db, chrono::Utc::now().timestamp_millis())
                .unwrap()
                .is_none()
        );
        let instance = widgets::storage::instances(&db).unwrap().remove(0);
        widgets::storage::commit_data(
            &db,
            &instance.id,
            instance.revision,
            instance.data,
            vec![widgets::EventDraft {
                kind: "small-match.result".into(),
                text: "일시정지 중 발생한 결과".into(),
                payload: serde_json::json!({}),
            }],
            chrono::Utc::now().timestamp_millis(),
        )
        .unwrap();
    }
    assert!(apply_pause(&state, false).unwrap().is_none());
    assert!(widgets::storage::take_reaction(
        &lock(&state.db).unwrap(),
        chrono::Utc::now().timestamp_millis()
    )
    .unwrap()
    .is_none());
}

#[test]
fn widget_lines_stop_after_source_change_or_user_cancellation() {
    for cause in ["source-change", "disable", "input", "pause", "auto-off"] {
        let state = state();
        let directory = tempfile::tempdir().unwrap();
        let (instance, revision, event) = {
            let db = lock(&state.db).unwrap();
            widgets::storage::install(&db, directory.path(), &["small-match".into()]).unwrap();
            let instance = widgets::storage::instances(&db).unwrap().remove(0);
            widgets::storage::commit_data(
                &db,
                &instance.id,
                instance.revision,
                instance.data.clone(),
                vec![widgets::EventDraft {
                    kind: "small-match.result".into(),
                    text: "주사위 결과".into(),
                    payload: serde_json::json!({}),
                }],
                chrono::Utc::now().timestamp_millis(),
            )
            .unwrap();
            let event = widgets::storage::take_reaction(&db, chrono::Utc::now().timestamp_millis())
                .unwrap()
                .unwrap();
            (
                widgets::storage::get(&db, &instance.id).unwrap(),
                store::revision(&db).unwrap(),
                event,
            )
        };
        let (epoch, cancel) = {
            let _guard = lock(&state.action).unwrap();
            let token = interrupt(&state, true).unwrap();
            *lock(&state.widget_playback).unwrap() = Some(event);
            token
        };
        let line = SceneLine {
            persona: "a".into(),
            expression: "normal".into(),
            text: "이미 표시한 결과".into(),
        };
        assert!(present_line(
            &state,
            &line,
            "widget",
            "widget-first",
            0,
            2,
            revision,
            epoch,
            &cancel,
            false,
        )
        .unwrap());
        match cause {
            "source-change" => {
                let db = lock(&state.db).unwrap();
                let mut data = instance.data.clone();
                data["rounds"] = serde_json::json!(2);
                widgets::storage::commit_data(
                    &db,
                    &instance.id,
                    instance.revision,
                    data,
                    vec![],
                    chrono::Utc::now().timestamp_millis(),
                )
                .unwrap();
            }
            "disable" => {
                widgets::storage::set_enabled(&lock(&state.db).unwrap(), &instance.id, false)
                    .unwrap()
            }
            "pause" => {
                apply_pause(&state, true).unwrap();
            }
            "auto-off" => {
                let mut settings = store::settings(&lock(&state.db).unwrap()).unwrap();
                settings.autonomous_enabled = false;
                apply_settings(&state, &settings, None, None).unwrap();
            }
            _ => {
                let _guard = lock(&state.action).unwrap();
                interrupt(&state, false).unwrap();
            }
        }
        assert!(
            !present_line(
                &state,
                &line,
                "widget",
                "widget-stale",
                1,
                2,
                revision,
                epoch,
                &cancel,
                false,
            )
            .unwrap(),
            "{cause}"
        );
        let history = store::messages(&lock(&state.db).unwrap(), 10).unwrap();
        assert_eq!(history.len(), 1, "{cause}");
        assert_eq!(history[0].id, "widget-first");
    }
}

#[test]
fn inactive_character_installs_preserve_playback_but_active_definition_edits_cancel_it() {
    let state = state();
    let (epoch, cancel) = {
        let _action = lock(&state.action).unwrap();
        interrupt(&state, false).unwrap()
    };
    let (revision, definition) = {
        let db = lock(&state.db).unwrap();
        (
            store::revision(&db).unwrap(),
            characters::active_character(&db, "a").unwrap().definition,
        )
    };
    let line = SceneLine {
        persona: "a".into(),
        expression: "평온".into(),
        text: "아직 하고 있는 이야기야.".into(),
    };
    assert!(present_line(
        &state,
        &line,
        "script",
        "continuing-line",
        0,
        1,
        revision,
        epoch,
        &cancel,
        false,
    )
    .unwrap());
    let before_playback = serde_json::to_value(lock(&state.playback).unwrap().clone()).unwrap();
    let pack = characters::parse_pack(include_str!(
        "../../../examples/character-packs/nadir-and-star-tail.comet-character.json"
    ))
    .unwrap();
    character_commands::mutate(&state, |db| characters::create(db, &definition)).unwrap();
    assert_eq!(state.epoch.load(Ordering::SeqCst), epoch);
    assert!(!cancel.load(Ordering::SeqCst));
    assert_eq!(
        store::revision(&lock(&state.db).unwrap()).unwrap(),
        revision
    );
    assert_eq!(
        serde_json::to_value(lock(&state.playback).unwrap().clone()).unwrap(),
        before_playback
    );
    character_commands::mutate(&state, |db| characters::import_pack(db, &pack)).unwrap();
    assert_eq!(state.epoch.load(Ordering::SeqCst), epoch);
    assert!(!cancel.load(Ordering::SeqCst));
    assert_eq!(
        store::revision(&lock(&state.db).unwrap()).unwrap(),
        revision
    );
    assert_eq!(
        serde_json::to_value(lock(&state.playback).unwrap().clone()).unwrap(),
        before_playback
    );
    let mut edited = definition;
    edited.instructions = "서두르지 않고 짧게 답한다.".into();
    edited.relationships = vec![characters::CharacterRelationship {
        target_id: "builtin-b".into(),
        description: "가끔 장난을 거는 오랜 친구".into(),
    }];
    character_commands::mutate(&state, |db| characters::save(db, "builtin-a", &edited)).unwrap();
    assert!(state.epoch.load(Ordering::SeqCst) > epoch);
    assert!(cancel.load(Ordering::SeqCst));
    assert!(store::revision(&lock(&state.db).unwrap()).unwrap() > revision);
    assert!(lock(&state.playback).unwrap().is_none());
    assert!(!present_line(
        &state,
        &line,
        "script",
        "stale-line",
        0,
        1,
        revision,
        epoch,
        &cancel,
        false,
    )
    .unwrap());
}

#[test]
fn inactive_relationship_target_rename_and_removal_cancel_stale_character_context() {
    let state = state();
    let target = {
        let db = lock(&state.db).unwrap();
        let target = characters::clone_character(&db, "builtin-b").unwrap();
        let mut definition = characters::active_character(&db, "a").unwrap().definition;
        definition.relationships = vec![characters::CharacterRelationship {
            target_id: target.id.clone(),
            description: "함께 자란 친구".into(),
        }];
        characters::save(&db, "builtin-a", &definition).unwrap();
        target
    };
    for remove_target in [false, true] {
        let (epoch, cancel) = interrupt(&state, false).unwrap();
        let revision = store::revision(&lock(&state.db).unwrap()).unwrap();
        let line = SceneLine {
            persona: "a".into(),
            expression: "평온".into(),
            text: "친구 이야기를 하고 있었어.".into(),
        };
        assert!(present_line(
            &state,
            &line,
            "llm",
            &format!("target-context-{remove_target}"),
            0,
            1,
            revision,
            epoch,
            &cancel,
            false,
        )
        .unwrap());
        if !remove_target {
            character_commands::mutate(&state, |db| {
                let mut definition = target.definition.clone();
                definition.instructions = "쉬는 동안 바꾼 지침".into();
                characters::save(db, &target.id, &definition)
            })
            .unwrap();
            assert!(!cancel.load(Ordering::SeqCst));
            assert_eq!(
                store::revision(&lock(&state.db).unwrap()).unwrap(),
                revision
            );
        }
        character_commands::mutate(&state, |db| {
            if remove_target {
                characters::remove(db, &target.id)
            } else {
                let mut definition = target.definition.clone();
                definition.name = "새 이름의 친구".into();
                characters::save(db, &target.id, &definition)
            }
        })
        .unwrap();
        assert!(cancel.load(Ordering::SeqCst));
        assert!(store::revision(&lock(&state.db).unwrap()).unwrap() > revision);
        assert!(lock(&state.playback).unwrap().is_none());
        assert!(!present_line(
            &state,
            &line,
            "llm",
            "stale-target-context",
            0,
            1,
            revision,
            epoch,
            &cancel,
            false,
        )
        .unwrap());
    }
}

#[test]
fn character_change_cancels_old_playback_and_retry_preserving_the_transcript() {
    let state = state();
    let old = {
        let _action = lock(&state.action).unwrap();
        interrupt(&state, false).unwrap()
    };
    let replacement = {
        let db = lock(&state.db).unwrap();
        store::insert_message(
            &db,
            &Message {
                id: "before-change".into(),
                role: "user".into(),
                persona: Some("a".into()),
                content: "내가 한 말은 그대로 남겨 줘.".into(),
                expression: None,
                created_at: 1,
                status: "complete".into(),
            },
        )
        .unwrap();
        characters::clone_character(&db, "builtin-a").unwrap()
    };
    let revision = store::revision(&lock(&state.db).unwrap()).unwrap();
    let line = SceneLine {
        persona: "a".into(),
        expression: "평온".into(),
        text: "이전 캐릭터의 대답".into(),
    };
    assert!(present_line(
        &state,
        &line,
        "llm",
        "old-reply",
        0,
        1,
        revision,
        old.0,
        &old.1,
        false,
    )
    .unwrap());
    let before =
        serde_json::to_value(store::messages(&lock(&state.db).unwrap(), 100).unwrap()).unwrap();
    character_commands::mutate(&state, |db| characters::assign(db, "a", &replacement.id)).unwrap();
    assert!(old.1.load(Ordering::SeqCst));
    assert!(lock(&state.playback).unwrap().is_none());
    assert!(!present_line(
        &state,
        &line,
        "llm",
        "late-reply",
        0,
        1,
        revision,
        old.0,
        &old.1,
        false,
    )
    .unwrap());
    {
        let db = lock(&state.db).unwrap();
        assert_eq!(
            serde_json::to_value(store::messages(&db, 100).unwrap()).unwrap(),
            before
        );
        assert!(ensure_retry_characters(&db, "before-change", "a").is_err());
        assert!(store::prepared_scenes(&db).unwrap().is_empty());
    }
    character_commands::mutate(&state, |db| characters::assign(db, "a", "builtin-a")).unwrap();
    ensure_retry_characters(&lock(&state.db).unwrap(), "before-change", "a").unwrap();
}

#[test]
fn pack_switch_cancels_stale_playback_and_restores_the_same_characters_and_personal_data() {
    let state = state();
    let (first_pack, second_pack) = {
        let db = lock(&state.db).unwrap();
        let imported = characters::import_pack(&db, &characters::nadir_pack()).unwrap();
        let first_pack = imported[0].pack_id.clone().unwrap();
        let cloned = characters::clone_character(&db, &imported[0].id).unwrap();
        let mut edited = imported[0].definition.clone();
        edited.name = "나의 친구".into();
        characters::save(&db, &imported[0].id, &edited).unwrap();
        db.execute(
            "INSERT INTO character_affinity VALUES('before-pack-switch',?1,'2026-09-20',7,'pack-switch')",
            [&imported[0].id],
        ).unwrap();
        db.execute(
            "INSERT INTO memories(id,content,source,updated) VALUES('saved-memory','나는 차를 좋아해','user-source',1)",
            [],
        ).unwrap();
        (first_pack, cloned.pack_id.unwrap())
    };
    character_commands::mutate(&state, |db| characters::apply_pack(db, &first_pack)).unwrap();
    let old = {
        let _action = lock(&state.action).unwrap();
        interrupt(&state, false).unwrap()
    };
    let revision = store::revision(&lock(&state.db).unwrap()).unwrap();
    let line = SceneLine {
        persona: "a".into(),
        expression: "평온".into(),
        text: "  팩을 바꾸기 전의 대사\n그대로  ".into(),
    };
    assert!(present_line(
        &state,
        &line,
        "script",
        "before-pack-switch",
        0,
        2,
        revision,
        old.0,
        &old.1,
        false,
    )
    .unwrap());
    let before = {
        let db = lock(&state.db).unwrap();
        serde_json::json!({
            "characters": characters::active_members(&db).unwrap(),
            "messages": store::messages(&db, 100).unwrap(),
            "identities": store::message_identities(&db, 100).unwrap(),
            "memories": store::memories(&db).unwrap(),
            "relationships": store::relationships(&db).unwrap(),
            "wordbook": wordbook::entries(&db).unwrap(),
        })
    };
    character_commands::mutate(&state, |db| characters::apply_pack(db, &first_pack)).unwrap();
    assert_eq!(state.epoch.load(Ordering::SeqCst), old.0);
    assert_eq!(
        store::revision(&lock(&state.db).unwrap()).unwrap(),
        revision
    );
    assert!(!old.1.load(Ordering::SeqCst));
    assert!(lock(&state.playback).unwrap().is_some());
    character_commands::mutate(&state, |db| characters::apply_pack(db, &second_pack)).unwrap();
    assert!(old.1.load(Ordering::SeqCst));
    assert!(lock(&state.playback).unwrap().is_none());
    assert!(!present_line(
        &state,
        &line,
        "script",
        "stale-pack-line",
        1,
        2,
        revision,
        old.0,
        &old.1,
        false,
    )
    .unwrap());
    character_commands::mutate(&state, |db| characters::apply_pack(db, &first_pack)).unwrap();
    let db = lock(&state.db).unwrap();
    assert_eq!(
        serde_json::json!({
            "characters": characters::active_members(&db).unwrap(),
            "messages": store::messages(&db, 100).unwrap(),
            "identities": store::message_identities(&db, 100).unwrap(),
            "memories": store::memories(&db).unwrap(),
            "relationships": store::relationships(&db).unwrap(),
            "wordbook": wordbook::entries(&db).unwrap(),
        }),
        before
    );
}

#[test]
fn character_change_rolls_back_if_prepared_scene_invalidation_fails() {
    let state = state();
    let id = characters::clone_character(&lock(&state.db).unwrap(), "builtin-a")
        .unwrap()
        .id;
    let before_epoch = state.epoch.load(Ordering::SeqCst);
    lock(&state.db).unwrap().execute_batch("CREATE TRIGGER fail_revision BEFORE UPDATE ON kv WHEN OLD.key='revision' BEGIN SELECT RAISE(ABORT,'storage failure'); END;").unwrap();
    assert!(character_commands::mutate(&state, |db| characters::assign(db, "a", &id)).is_err());
    assert_eq!(
        characters::active_character(&lock(&state.db).unwrap(), "a")
            .unwrap()
            .id,
        "builtin-a"
    );
    assert_eq!(state.epoch.load(Ordering::SeqCst), before_epoch);
}

#[test]
fn authored_idle_wordbook_overrides_the_character_pair_fallback() {
    let state = state();
    let db = lock(&state.db).unwrap();
    let lines = vec![SceneLine {
        persona: "b".into(),
        expression: "장난".into(),
        text: "내가 등록한 자동 수다.".into(),
    }];
    characters::save_dialogue(
        &db,
        &["builtin-a".into(), "builtin-b".into()],
        &characters::CharacterDialogue {
            pair_scenes: vec![],
            wordbook: vec![WordbookEntry {
                id: uuid::Uuid::new_v4().to_string(),
                title: "기본 캐릭터 수다".into(),
                keywords: vec!["자동 수다".into()],
                lines: lines.clone(),
                enabled: true,
                use_for_idle: true,
            }],
        },
    )
    .unwrap();
    assert_eq!(
        serde_json::to_value(character_script(&db, 1).unwrap()).unwrap(),
        serde_json::to_value(lines).unwrap()
    );
}

#[test]
fn missing_model_uses_imported_character_greetings_and_authored_pair_scenes() {
    let state = state();
    let db = lock(&state.db).unwrap();
    let characters = characters::import_pack(&db, &characters::nadir_pack()).unwrap();
    characters::apply_pair(&db, [characters[0].id.clone(), characters[1].id.clone()]).unwrap();
    let greeting = character_script(&db, 0).unwrap();
    assert_eq!(greeting.len(), 2);
    for (line, character) in greeting.iter().zip(&characters) {
        assert!(character
            .definition
            .greeting
            .iter()
            .any(|authored| authored.text == line.text));
    }
    let dialogue =
        characters::dialogue(&db, &[characters[0].id.clone(), characters[1].id.clone()]).unwrap();
    assert!(dialogue.pair_scenes.len() >= 5);
    for sequence in 1..=5 {
        let scene = character_script(&db, sequence).unwrap();
        assert!(dialogue
            .pair_scenes
            .iter()
            .any(|authored| serde_json::to_value(authored).unwrap()
                == serde_json::to_value(&scene).unwrap()));
    }
}

#[test]
fn shared_character_pack_uses_authored_keyword_order_after_personal_entries() {
    let state = state();
    let mut pack = characters::parse_pack(include_str!(
        "../../../examples/character-packs/nadir-and-star-tail.comet-character.json"
    ))
    .unwrap();
    pack.wordbook.push(WordbookEntry {
        id: uuid::Uuid::new_v4().to_string(),
        title: "테스트 별사탕".into(),
        keywords: vec!["별사탕".into()],
        lines: vec![SceneLine {
            persona: "a".into(),
            expression: "평온".into(),
            text: "  등록한 별사탕 대사\n그대로  ".into(),
        }],
        enabled: true,
        use_for_idle: false,
    });
    let imported =
        character_commands::mutate(&state, |db| characters::import_pack(db, &pack)).unwrap();
    character_commands::mutate(&state, |db| {
        characters::apply_pair(db, [imported[0].id.clone(), imported[1].id.clone()])
    })
    .unwrap();
    let db = lock(&state.db).unwrap();
    let lines = route_message(&state, &db, "별사탕").unwrap().unwrap();
    assert_eq!(
        serde_json::to_value(lines).unwrap(),
        serde_json::to_value(characters::resolve_lines(&db, &pack.wordbook[0].lines).unwrap())
            .unwrap()
    );
    let greeting = character_script(&db, 0).unwrap();
    assert!(pack.characters[0]
        .greeting
        .iter()
        .any(|line| line.text == greeting[0].text));
    let local = WordbookEntry {
        id: uuid::Uuid::new_v4().to_string(),
        title: "개인 대사".into(),
        keywords: vec!["별".into()],
        lines: vec![SceneLine {
            persona: "b".into(),
            expression: "장난".into(),
            text: "  내가 적은 말부터.\n\n  ".into(),
        }],
        enabled: true,
        use_for_idle: false,
    };
    wordbook::save(&db, &local).unwrap();
    assert_eq!(
        route_message(&state, &db, "별사탕").unwrap().unwrap()[0].text,
        local.lines[0].text
    );
    let automatic = character_script(&db, 1).unwrap();
    assert!(pack
        .pair_scenes
        .iter()
        .any(|scene| serde_json::to_value(scene).unwrap()
            == serde_json::to_value(&automatic).unwrap()));
}

#[test]
fn keyword_route_works_without_a_model_and_preserves_authored_lines() {
    let mut state = state();
    let directory = tempfile::tempdir().unwrap();
    state.app_data = directory.path().to_path_buf();
    let db = lock(&state.db).unwrap();
    let entry = WordbookEntry {
        id: uuid::Uuid::new_v4().to_string(),
        title: "고정 대사".into(),
        keywords: vec!["수박".into()],
        lines: vec![
            SceneLine {
                persona: "b".into(),
                expression: "장난".into(),
                text: "  그대로\n\n말할게.  ".into(),
            },
            SceneLine {
                persona: "b".into(),
                expression: "평온".into(),
                text: "순서도 그대로.".into(),
            },
        ],
        enabled: true,
        use_for_idle: false,
    };
    wordbook::save(&db, &entry).unwrap();
    let lines = route_message(&state, &db, "오늘 수박 먹었어")
        .unwrap()
        .unwrap();
    assert_eq!(
        serde_json::to_value(lines).unwrap(),
        serde_json::to_value(characters::resolve_lines(&db, &entry.lines).unwrap()).unwrap()
    );
    assert!(route_message(&state, &db, "새로운 주제로 이야기해 줘").is_err());
    store::save_settings(
        &db,
        &Settings {
            mode: "api".into(),
            api_model: String::new(),
            ..Settings::default()
        },
    )
    .unwrap();
    assert!(route_message(&state, &db, "수박").unwrap().is_some());
    assert!(route_message(&state, &db, "다른 말").is_err());
}

#[test]
fn fresh_single_character_wordbook_routes_without_models() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("fresh.sqlite");
    // Seed the production roster before the legacy A/B test fixture opens it.
    let db = rusqlite::Connection::open(&path).unwrap();
    characters::initialize(&db).unwrap();
    drop(db);
    let mut state = state();
    state.db = Mutex::new(store::open(&path).unwrap());
    state.app_data = directory.path().to_path_buf();
    let db = lock(&state.db).unwrap();
    let id = characters::active_ids(&db).unwrap().remove(0);
    let greeting = route_message(&state, &db, "안녕").unwrap().unwrap();
    assert_eq!(greeting.len(), 1);
    assert_eq!(greeting[0].persona, id);
    assert_eq!(greeting[0].text, "안녕! 잠깐 이야기할까?");
    assert!(route_message(&state, &db, "쉬자").unwrap().is_some());
}

#[test]
fn unavailable_wordbook_winner_is_reported_before_shorter_or_later_matches() {
    let state = state();
    let db = lock(&state.db).unwrap();
    characters::apply_roster(&db, vec!["builtin-a".into()]).unwrap();
    let short = WordbookEntry {
        id: uuid::Uuid::new_v4().to_string(),
        title: "짧은 항목".into(),
        keywords: vec!["테스트".into()],
        lines: vec![SceneLine {
            persona: "a".into(),
            expression: "평온".into(),
            text: "  짧은 대사\n그대로  ".into(),
        }],
        enabled: true,
        use_for_idle: false,
    };
    wordbook::save(&db, &short).unwrap();
    let mut first = short.clone();
    first.id = uuid::Uuid::new_v4().to_string();
    first.title = "먼저 등록한 긴 항목".into();
    first.keywords = vec!["테스트키워드".into()];
    first.lines[0].persona = "b".into();
    first.lines[0].text = "  없는 화자의 대사\n보존  ".into();
    wordbook::save(&db, &first).unwrap();
    let mut later = first.clone();
    later.id = uuid::Uuid::new_v4().to_string();
    later.title = "나중에 등록한 긴 항목".into();
    later.lines[0].persona = "a".into();
    wordbook::save(&db, &later).unwrap();
    let before = serde_json::to_value(wordbook::entries(&db).unwrap()).unwrap();
    let error = route_message(&state, &db, "테스트키워드").unwrap_err();
    assert!(error.contains("먼저 등록한 긴 항목"));
    assert!(error.contains("화자"));
    assert_eq!(
        serde_json::to_value(wordbook::entries(&db).unwrap()).unwrap(),
        before
    );
    first.enabled = false;
    wordbook::save(&db, &first).unwrap();
    assert_eq!(
        route_message(&state, &db, "테스트키워드").unwrap().unwrap()[0].text,
        later.lines[0].text
    );
    later.enabled = false;
    wordbook::save(&db, &later).unwrap();
    assert_eq!(
        route_message(&state, &db, "테스트키워드").unwrap().unwrap()[0].text,
        short.lines[0].text
    );
}

#[test]
fn playback_cancellation_rejects_old_lines_and_old_timers_without_erasing_history() {
    let state = state();
    let revision = store::revision(&lock(&state.db).unwrap()).unwrap();
    let old = interrupt(&state, true).unwrap();
    let lines = test_lines();
    assert!(present_line(
        &state, &lines[0], "script", "old-line", 0, 4, revision, old.0, &old.1, false,
    )
    .unwrap());
    let current = interrupt(&state, false).unwrap();
    assert!(lock(&state.playback).unwrap().is_none());
    assert!(!present_line(
        &state,
        &lines[1],
        "script",
        "stale-line",
        1,
        4,
        revision,
        old.0,
        &old.1,
        false,
    )
    .unwrap());
    assert!(present_line(
        &state, &lines[1], "wordbook", "new-line", 0, 1, revision, current.0, &current.1, false,
    )
    .unwrap());
    assert!(!clear_line_if_current(&state, old.0, &old.1).unwrap());
    assert_eq!(
        lock(&state.playback).unwrap().as_ref().unwrap().id,
        "new-line"
    );
    assert!(clear_line_if_current(&state, current.0, &current.1).unwrap());
    assert!(lock(&state.playback).unwrap().is_none());
    let db = lock(&state.db).unwrap();
    let history = store::messages(&db, 100).unwrap();
    assert_eq!(history.len(), 2);
    assert!(history.iter().all(|message| message.id != "stale-line"));
    store::bump_revision(&db).unwrap();
    drop(db);
    assert!(!present_line(
        &state,
        &lines[2],
        "llm",
        "stale-revision",
        0,
        1,
        revision,
        current.0,
        &current.1,
        false,
    )
    .unwrap());
}

#[test]
fn idle_recall_expires_while_hidden_and_paused_but_not_during_playback() {
    let state = state();
    let token = interrupt(&state, true).unwrap();
    let revision = store::revision(&lock(&state.db).unwrap()).unwrap();
    let lines = test_lines();
    for (index, source) in ["llm", "script"].into_iter().enumerate() {
        assert!(present_line(
            &state, &lines[0], source, source, index, 2, revision, token.0, &token.1, false,
        )
        .unwrap());
    }
    let at = chrono::Utc::now().timestamp_millis() + 31 * 60 * 1000;
    assert!(!expire_idle_recall(&state, at).unwrap());
    {
        let mut runtime = lock(&state.runtime).unwrap();
        runtime.phase = crate::types::RuntimePhase::Idle;
        runtime.hidden = true;
        runtime.paused = true;
    }
    assert!(expire_idle_recall(&state, at).unwrap());
    assert!(!expire_idle_recall(&state, at).unwrap());
    let db = lock(&state.db).unwrap();
    let recalled = store::context_messages_for(&db, 24, &lines[0].persona).unwrap();
    assert_eq!(recalled.len(), 1);
    assert_eq!(recalled[0].id, "script");
    assert_eq!(store::messages(&db, 24).unwrap().len(), 2);
}

#[test]
fn automatic_chatter_recovers_from_errors_and_obeys_interaction_boundaries() {
    let state = state();
    use_neutral_characters(&lock(&state.db).unwrap());
    state.last_input.store(now(), Ordering::SeqCst);
    state.next_idle.store(now() - 1, Ordering::SeqCst);
    assert!(begin_background(&state).unwrap().is_some());
    let (lines, source) = next_scene(&state).unwrap();
    assert_eq!(source, "script");
    assert_eq!(lines[0].text, "테스트 인사 a");
    lock(&state.runtime).unwrap().phase = crate::types::RuntimePhase::Error;
    assert!(begin_background(&state).unwrap().is_some());
    lock(&state.runtime).unwrap().paused = true;
    assert!(begin_background(&state).unwrap().is_none());
    lock(&state.runtime).unwrap().paused = false;
    lock(&state.runtime).unwrap().hidden = true;
    assert!(begin_background(&state).unwrap().is_none());
    lock(&state.runtime).unwrap().hidden = false;
    *lock(&state.panel).unwrap() = Some(PanelState {
        persona: "a".into(),
        mode: "input".into(),
    });
    assert!(begin_background(&state).unwrap().is_none());
    *lock(&state.panel).unwrap() = None;
    store::save_settings(
        &lock(&state.db).unwrap(),
        &Settings {
            autonomous_enabled: false,
            ..Settings::default()
        },
    )
    .unwrap();
    assert!(begin_background(&state).unwrap().is_none());
    assert_eq!(next_scene(&state).unwrap().1, "script");
}

#[test]
fn restart_discards_prepared_scenes_but_keeps_saved_conversations_and_wordbook() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("session.sqlite");
    let db = open_session(&path).unwrap();
    store::add_scene(
        &db,
        &PreparedScene {
            id: "old-scene".into(),
            revision: 0,
            lines: test_lines(),
        },
    )
    .unwrap();
    store::insert_message_with_source(
        &db,
        &Message {
            id: "history".into(),
            role: "assistant".into(),
            persona: Some("a".into()),
            content: "어제의 이야기".into(),
            expression: Some("평온".into()),
            created_at: 1,
            status: "complete".into(),
        },
        "llm",
        None,
        false,
    )
    .unwrap();
    let entries = wordbook::entries(&db).unwrap();
    wordbook::delete(&db, &entries[0].id).unwrap();
    drop(db);
    let reopened = open_session(&path).unwrap();
    assert!(store::prepared_scenes(&reopened).unwrap().is_empty());
    assert!(store::context_messages_for(&reopened, 24, "a")
        .unwrap()
        .is_empty());
    assert_eq!(
        store::messages(&reopened, 10).unwrap()[0].content,
        "어제의 이야기"
    );
    assert_eq!(
        wordbook::entries(&reopened).unwrap().len(),
        entries.len() - 1
    );
}
#[test]
fn model_change_preserves_history_and_invalidates_previous_work() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("settings.sqlite");
    let mut state = state();
    state.db = Mutex::new(store::open(&path).unwrap());
    let old = {
        let _action = lock(&state.action).unwrap();
        interrupt(&state, true).unwrap()
    };
    {
        let db = lock(&state.db).unwrap();
        let mut legacy = serde_json::to_value(Settings::default()).unwrap();
        legacy.as_object_mut().unwrap().remove("localModel");
        db.execute(
            "INSERT INTO kv VALUES('settings', ?1)",
            [legacy.to_string()],
        )
        .unwrap();
        assert_eq!(
            store::settings(&db).unwrap().local_model,
            LocalModel::Qwen35_4B
        );
        store::insert_message(
            &db,
            &Message {
                id: "existing-message".into(),
                role: "user".into(),
                persona: Some("a".into()),
                content: "안녕".into(),
                expression: None,
                created_at: 1,
                status: "complete".into(),
            },
        )
        .unwrap();
        store::add_scene(
            &db,
            &PreparedScene {
                id: "previous-model-scene".into(),
                revision: store::revision(&db).unwrap(),
                lines: vec![SceneLine {
                    persona: "a".into(),
                    expression: "평온".into(),
                    text: "안녕".into(),
                }],
            },
        )
        .unwrap();
    }
    let selected = Settings {
        local_model: LocalModel::Qwen35_9B,
        ..Settings::default()
    };
    let current = apply_settings(&state, &selected, Some(SettingsScope::Model), None).unwrap();
    assert!(old.1.load(Ordering::SeqCst));
    assert!(!set_phase_if_current(&state, old.0, RuntimePhase::Idle, None, None).unwrap());
    assert!(is_current(&state, current.0, &current.1));
    assert!(begin_background(&state).unwrap().is_none());
    drop(state);
    let reopened = store::open(&path).unwrap();
    assert_eq!(
        store::settings(&reopened).unwrap().local_model,
        LocalModel::Qwen35_9B
    );
    assert_eq!(store::messages(&reopened, 10).unwrap()[0].content, "안녕");
    assert!(store::prepared_scenes(&reopened).unwrap().is_empty());
}

#[test]
fn scoped_settings_saves_preserve_other_sections_newer_values() {
    let state = state();
    let original = Settings::default();
    let model = Settings {
        mode: "api".into(),
        base_url: "https://example.com/v1".into(),
        api_model: "selected-model".into(),
        local_model: LocalModel::Qwen35_9B,
        local_model_path: "/models/kept.gguf".into(),
        api_token_parameter: "max_tokens".into(),
        ..original.clone()
    };
    apply_settings(&state, &model, Some(SettingsScope::Model), None).unwrap();
    let automatic = Settings {
        autonomous_enabled: false,
        local_idle_enabled: false,
        api_idle_enabled: true,
        idle_minutes: 17,
        // Unrelated invalid draft values must neither block this save nor be persisted.
        mode: "unfinished-mode".into(),
        base_url: "unfinished-url".into(),
        ..original
    };
    apply_settings(
        &state,
        &automatic,
        Some(SettingsScope::Automatic),
        Some("unrelated-draft-key-must-not-reach-keyring"),
    )
    .unwrap();
    let expected = Settings {
        autonomous_enabled: false,
        local_idle_enabled: false,
        api_idle_enabled: true,
        idle_minutes: 17,
        ..model.clone()
    };
    assert_eq!(
        serde_json::to_value(store::settings(&lock(&state.db).unwrap()).unwrap()).unwrap(),
        serde_json::to_value(&expected).unwrap()
    );
    let next_model = Settings {
        api_model: "new-selected-model".into(),
        // The model draft predates the automatic save and its interval is incomplete.
        idle_minutes: 0,
        ..model
    };
    apply_settings(&state, &next_model, Some(SettingsScope::Model), None).unwrap();
    assert_eq!(
        serde_json::to_value(store::settings(&lock(&state.db).unwrap()).unwrap()).unwrap(),
        serde_json::to_value(Settings {
            api_model: "new-selected-model".into(),
            ..expected
        })
        .unwrap()
    );
    assert_eq!(store::revision(&lock(&state.db).unwrap()).unwrap(), 3);
}

#[test]
fn scoped_settings_failures_preserve_saved_values_and_running_work() {
    let state = state();
    let previous = {
        let _action = lock(&state.action).unwrap();
        interrupt(&state, false).unwrap()
    };
    let original = store::settings(&lock(&state.db).unwrap()).unwrap();
    let invalid_automatic = Settings {
        idle_minutes: 0,
        ..original.clone()
    };
    assert!(apply_settings(
        &state,
        &invalid_automatic,
        Some(SettingsScope::Automatic),
        None
    )
    .is_err());
    let invalid_model = Settings {
        mode: "api".into(),
        base_url: "http://example.com/v1".into(),
        api_model: "model".into(),
        ..original.clone()
    };
    assert!(apply_settings(&state, &invalid_model, Some(SettingsScope::Model), None).is_err());
    lock(&state.db).unwrap().execute_batch("CREATE TRIGGER fail_revision BEFORE UPDATE ON kv WHEN OLD.key='revision' BEGIN SELECT RAISE(ABORT,'storage failure'); END;").unwrap();
    let changed = Settings {
        autonomous_enabled: false,
        ..original.clone()
    };
    assert!(apply_settings(&state, &changed, Some(SettingsScope::Automatic), None).is_err());
    assert!(is_current(&state, previous.0, &previous.1));
    assert_eq!(store::revision(&lock(&state.db).unwrap()).unwrap(), 0);
    assert_eq!(
        serde_json::to_value(store::settings(&lock(&state.db).unwrap()).unwrap()).unwrap(),
        serde_json::to_value(original).unwrap()
    );
}

#[test]
fn unsaved_settings_require_exit_confirmation_and_block_update_installation() {
    let state = state();
    assert!(!windows::settings_exit_needs_confirmation(&state));
    assert!(lifecycle::ensure_settings_saved_for_update(&state).is_ok());
    state.settings_dirty.store(true, Ordering::SeqCst);
    assert!(windows::settings_exit_needs_confirmation(&state));
    assert!(lifecycle::ensure_settings_saved_for_update(&state).is_err());
    state.settings_exit_confirmed.store(true, Ordering::SeqCst);
    assert!(!windows::settings_exit_needs_confirmation(&state));
    // Approving exit does not authorize an update to discard an unsaved draft.
    assert!(lifecycle::ensure_settings_saved_for_update(&state).is_err());
    state.settings_dirty.store(false, Ordering::SeqCst);
    assert!(lifecycle::ensure_settings_saved_for_update(&state).is_ok());
}

#[test]
fn settings_navigation_defaults_to_characters_and_maps_update_links_to_general() {
    assert_eq!(
        windows::SettingsSection::default(),
        windows::SettingsSection::Characters
    );
    for section in [
        "characters",
        "widgets",
        "automatic",
        "wordbook",
        "talk",
        "memory",
        "model",
        "general",
    ] {
        let value = serde_json::Value::String(section.into());
        let parsed: windows::SettingsSection = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(parsed).unwrap(), value);
    }
    assert_eq!(
        serde_json::from_str::<windows::SettingsSection>("\"updates\"").unwrap(),
        windows::SettingsSection::General
    );
}

#[test]
fn download_reserves_selected_model_before_work_begins() {
    let mut state = state();
    let directory = tempfile::tempdir().unwrap();
    state.app_data = directory.path().to_path_buf();
    let cancel = begin_download(&state, LocalModel::Qwen35_9B).unwrap();
    assert_eq!(
        store::settings(&lock(&state.db).unwrap())
            .unwrap()
            .local_model,
        LocalModel::Qwen35_4B
    );
    assert!(begin_download(&state, LocalModel::Qwen35_4B).is_err());
    let progress = lock(&state.runtime).unwrap().download.clone().unwrap();
    assert_eq!(progress.model, LocalModel::Qwen35_9B);
    assert_eq!(progress.status, "downloading");
    assert_eq!(progress.total, 5_680_522_464);
    prepare_exit(&state).unwrap();
    assert!(cancel.load(Ordering::SeqCst));
    *lock(&state.download_cancel).unwrap() = None;
    assert!(begin_download(&state, LocalModel::Qwen35_4B).is_err());
}
#[test]
fn new_submission_cancels_old_work_and_rejects_its_status_updates() {
    let state = state();
    let old = {
        let _action = lock(&state.action).unwrap();
        interrupt(&state, true).unwrap()
    };
    set_phase_if_current(&state, old.0, RuntimePhase::Analyzing, None, None).unwrap();
    let current = {
        let _action = lock(&state.action).unwrap();
        interrupt(&state, false).unwrap()
    };
    set_phase_if_current(
        &state,
        current.0,
        RuntimePhase::Generating,
        Some("a".into()),
        None,
    )
    .unwrap();
    assert!(old.1.load(Ordering::SeqCst));
    assert!(!is_current(&state, old.0, &old.1));
    assert!(!set_phase_if_current(
        &state,
        old.0,
        RuntimePhase::Error,
        None,
        Some("stale failure".into())
    )
    .unwrap());
    assert_eq!(lock(&state.runtime).unwrap().phase, "generating");
    assert!(!should_cancel_for_pause(
        true,
        state.automatic.load(Ordering::SeqCst)
    ));
    assert!(should_cancel_for_pause(true, true));
    assert!(is_current(&state, current.0, &current.1));
}
#[tokio::test]
async fn pair_generation_uses_one_request_and_partial_retry_only_generates_the_missing_reply() {
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let calls = Arc::new(AtomicU64::new(0));
    let observed = calls.clone();
    let server = tokio::spawn(async move {
        let replies = [
            serde_json::json!({"lines":[
                {"persona":"a","expression":"기쁨","text":"차를 마시며 쉬어 보자."},
                {"persona":"b","expression":"장난","text":"그 차는 내가 고를게."}
            ]}),
            serde_json::json!({"persona":"b","expression":"평온","text":"따뜻한 차로 준비할게."}),
            serde_json::json!({"lines":[
                {"persona":"a","expression":"기쁨","text":"검증 전에는 표시하지 마."}
            ]}),
        ];
        for (index, reply) in replies.into_iter().enumerate() {
            let (mut socket, _) = tokio::time::timeout(Duration::from_secs(5), listener.accept())
                .await
                .unwrap()
                .unwrap();
            let mut request = Vec::new();
            let body = loop {
                let mut chunk = [0; 4096];
                let read = socket.read(&mut chunk).await.unwrap();
                assert!(read > 0);
                request.extend_from_slice(&chunk[..read]);
                if let Some(end) = request.windows(4).position(|bytes| bytes == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&request[..end]);
                    let length: usize = headers
                        .lines()
                        .find_map(|line| {
                            let (name, value) = line.split_once(':')?;
                            name.eq_ignore_ascii_case("content-length")
                                .then(|| value.trim().parse().unwrap())
                        })
                        .unwrap();
                    if request.len() >= end + 4 + length {
                        break serde_json::from_slice::<serde_json::Value>(
                            &request[end + 4..end + 4 + length],
                        )
                        .unwrap();
                    }
                }
            };
            observed.fetch_add(1, Ordering::SeqCst);
            let schema = &body["response_format"]["json_schema"]["schema"];
            if index == 1 {
                assert!(schema["properties"].get("lines").is_none());
                assert!(body["messages"].as_array().unwrap().iter().any(|message| {
                    message["content"]
                        .as_str()
                        .unwrap()
                        .contains("차를 마시며 쉬어 보자.")
                }));
            } else {
                assert_eq!(schema["properties"]["lines"]["minItems"], 2);
                assert_eq!(schema["properties"]["lines"]["maxItems"], 2);
            }
            let body = serde_json::json!({"choices":[{"message":{"content":reply.to_string()}}]})
                .to_string();
            socket.write_all(format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                ).as_bytes()).await.unwrap();
        }
    });
    let state = state();
    use_neutral_characters(&lock(&state.db).unwrap());
    let user = Message {
        id: "pair-user".into(),
        role: "user".into(),
        persona: Some("both".into()),
        content: "오늘은 차를 마시고 싶어. 둘이 골라 줘.".into(),
        expression: None,
        created_at: 1,
        status: "complete".into(),
    };
    {
        let db = lock(&state.db).unwrap();
        store::save_settings(
            &db,
            &Settings {
                mode: "api".into(),
                base_url: format!("http://{address}/v1"),
                api_model: "test".into(),
                api_token_parameter: "max_tokens".into(),
                ..Settings::default()
            },
        )
        .unwrap();
        store::insert_message(&db, &user).unwrap();
    }
    let targets = vec!["a".into(), "b".into()];
    let original = interrupt(&state, false).unwrap();
    let (lines, revision) = generate_turn(&state, &targets, &user.id, original.1.clone())
        .await
        .unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(lines.len(), 2);
    assert_eq!(
        store::messages(&lock(&state.db).unwrap(), 100)
            .unwrap()
            .len(),
        1
    );
    assert!(present_line(
        &state,
        &lines[0],
        "llm",
        &reply_id(&user.id, "a"),
        0,
        2,
        revision,
        original.0,
        &original.1,
        true,
    )
    .unwrap());
    let retry = interrupt(&state, false).unwrap();
    assert!(!present_line(
        &state,
        &lines[1],
        "llm",
        &reply_id(&user.id, "b"),
        1,
        2,
        revision,
        original.0,
        &original.1,
        true,
    )
    .unwrap());
    let missing = remaining_retry("both", "both", &["a".into()]).unwrap();
    let (retried, revision) = generate_turn(&state, &missing, &user.id, retry.1.clone())
        .await
        .unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    assert_eq!(retried.len(), 1);
    assert_eq!(retried[0].persona, "b");
    assert!(present_line(
        &state,
        &retried[0],
        "llm",
        &reply_id(&user.id, "b"),
        0,
        1,
        revision,
        retry.0,
        &retry.1,
        true,
    )
    .unwrap());
    let history = store::messages(&lock(&state.db).unwrap(), 100).unwrap();
    assert_eq!(history.len(), 3);
    assert_eq!(history[1].content, lines[0].text);
    assert_eq!(history[2].content, retried[0].text);
    let invalid_user = Message {
        id: "invalid-pair".into(),
        ..user
    };
    store::insert_message(&lock(&state.db).unwrap(), &invalid_user).unwrap();
    assert!(
        generate_turn(&state, &targets, &invalid_user.id, retry.1.clone())
            .await
            .is_err()
    );
    assert_eq!(calls.load(Ordering::SeqCst), 3);
    assert_eq!(
        store::messages(&lock(&state.db).unwrap(), 100)
            .unwrap()
            .len(),
        4
    );
    server.await.unwrap();
}

#[test]
fn retry_only_requests_missing_original_recipients() {
    assert_eq!(
        remaining_retry("both", "both", &["a".into()]).unwrap(),
        vec!["b"]
    );
    assert!(remaining_retry("a", "both", &[]).is_err());
    assert!(remaining_retry("both", "a", &["a".into()])
        .unwrap()
        .is_empty());
    assert!(remaining_retry("both", "both", &["a".into(), "b".into()])
        .unwrap()
        .is_empty());
    assert_ne!(reply_id("first", "a"), reply_id("second", "a"));
}
#[test]
fn api_idle_budget_survives_reopen_and_expires_after_an_hour() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("state.sqlite");
    let db = store::open(&path).unwrap();
    assert!(reserve_api_idle(&db, 100).unwrap());
    assert!(reserve_api_idle(&db, 101).unwrap());
    drop(db);
    let db = store::open(&path).unwrap();
    assert!(!reserve_api_idle(&db, 102).unwrap());
    assert!(!reserve_api_idle(&db, 99).unwrap());
    assert!(reserve_api_idle(&db, 3700).unwrap());
    assert!(!reserve_api_idle(&db, 3700).unwrap());
}
#[test]
fn exit_preparation_cancels_owned_work_and_flushes_before_shutdown() {
    let state = state();
    let token = {
        let _action = lock(&state.action).unwrap();
        interrupt(&state, false).unwrap()
    };
    let download = Arc::new(AtomicBool::new(false));
    *lock(&state.download_cancel).unwrap() = Some(download.clone());
    lock(&state.positions).unwrap().insert(
        "b".into(),
        (WindowPosition { x: 320.0, y: 440.0 }, Instant::now()),
    );
    prepare_exit(&state).unwrap();
    assert!(state.stopping.load(Ordering::SeqCst));
    assert!(lock(&state.runtime).unwrap().hidden);
    assert!(token.1.load(Ordering::SeqCst));
    assert!(download.load(Ordering::SeqCst));
    assert!(begin_background(&state).unwrap().is_none());
    assert_eq!(
        store::window_position(&lock(&state.db).unwrap(), "b")
            .unwrap()
            .unwrap()
            .y,
        440.0
    );
    prepare_exit(&state).unwrap();
    assert!(lock(&state.action).is_ok());
    assert!(lock(&state.positions).unwrap().is_empty());
}
#[test]
fn quit_flushes_positions_inside_the_debounce_window() {
    let state = state();
    lock(&state.positions).unwrap().insert(
        "a".into(),
        (WindowPosition { x: 120.0, y: 240.0 }, Instant::now()),
    );
    flush_positions(&state, false).unwrap();
    assert!(store::window_position(&lock(&state.db).unwrap(), "a")
        .unwrap()
        .is_none());
    flush_positions(&state, true).unwrap();
    assert_eq!(
        store::window_position(&lock(&state.db).unwrap(), "a")
            .unwrap()
            .unwrap()
            .x,
        120.0
    );
    assert!(lock(&state.positions).unwrap().is_empty());
}
#[test]
fn pair_prompt_rejects_questions_removed_from_active_contexts() {
    for reason in ["swapped", "edited", "deleted"] {
        let db = store::open(std::path::Path::new(":memory:")).unwrap();
        let user = Message {
            id: "pair-question".into(),
            role: "user".into(),
            persona: Some("both".into()),
            content: "나는 산책을 좋아해".into(),
            expression: None,
            created_at: 1_800_000_000_000,
            status: "complete".into(),
        };
        store::insert_message(&db, &user).unwrap();
        let targets = vec!["a".into(), "b".into()];
        assert!(turn_prompt(&db, &targets, &user.id).is_ok());
        if reason == "swapped" {
            let new_character = characters::clone_character(&db, "builtin-a").unwrap();
            characters::assign(&db, "a", &new_character.id).unwrap();
            assert!(store::context_messages_for(&db, 24, "a")
                .unwrap()
                .is_empty());
            assert_eq!(store::context_messages_for(&db, 24, "b").unwrap().len(), 1);
        } else {
            store::analyze_apply(
                &db,
                &serde_json::json!({
                    "revision": store::revision(&db).unwrap(),
                    "memories": [{"kind":"user_fact", "certain":true,
                        "sourceMessageId":user.id, "evidence":user.content, "supersedesId":""}],
                    "events":[]
                }),
            )
            .unwrap();
            let memory = store::memories(&db).unwrap().remove(0);
            if reason == "edited" {
                store::edit_memory(&db, &memory.id, "나는 독서를 좋아해").unwrap();
            } else {
                store::delete_memory(&db, &memory.id).unwrap();
            }
        }
        assert!(turn_prompt(&db, &targets, &user.id).is_err(), "{reason}");
        assert_eq!(store::messages(&db, 24).unwrap()[0].content, user.content);
    }
}

#[test]
fn partial_retry_references_only_current_characters_completed_same_turn_reply() {
    for scenario in ["complete", "incomplete", "other-turn", "swapped", "expired"] {
        let db = store::open(std::path::Path::new(":memory:")).unwrap();
        use_neutral_characters(&db);
        let user = Message {
            id: "partial-question".into(),
            role: "user".into(),
            persona: Some("both".into()),
            content: "둘 다 한마디씩 해 줘".into(),
            expression: None,
            created_at: 1_800_000_000_000,
            status: "complete".into(),
        };
        store::insert_message(&db, &user).unwrap();
        let reply = Message {
            id: reply_id(
                if scenario == "other-turn" {
                    "earlier-question"
                } else {
                    &user.id
                },
                "a",
            ),
            role: "assistant".into(),
            persona: Some("a".into()),
            content: "SAME_TURN_A_REFERENCE".into(),
            expression: Some("평온".into()),
            created_at: user.created_at + 1,
            status: if scenario == "incomplete" {
                "pending"
            } else {
                "complete"
            }
            .into(),
        };
        store::insert_message_with_source(&db, &reply, "llm", None, true).unwrap();
        if scenario == "expired" {
            store::resume_conversation(&db, reply.created_at + 31 * 60 * 1000).unwrap();
        }
        if scenario == "swapped" {
            let new_character = characters::clone_character(&db, "builtin-a").unwrap();
            characters::assign(&db, "a", &new_character.id).unwrap();
        }
        let prompt = turn_prompt(&db, &["b".into()], &user.id).unwrap();
        assert_eq!(
            prompt
                .iter()
                .any(|message| message.content.contains("SAME_TURN_A_REFERENCE")),
            scenario == "complete",
            "{scenario}"
        );
        assert_eq!(store::messages(&db, 24).unwrap().len(), 2);
    }
}

#[test]
fn single_member_roster_keeps_snapshot_and_scripts_working() {
    let state = state();
    character_commands::mutate(&state, |db| {
        characters::apply_roster(db, vec!["builtin-b".into()])
    })
    .unwrap();
    let data = snapshot(&state).unwrap();
    assert_eq!(data.characters.active, ["builtin-b"]);
    assert_eq!(data.relationships.len(), 1);
    let (lines, source) = next_scene(&state).unwrap();
    assert_eq!(source, "script");
    assert!(!lines.is_empty());
    assert!(lines.iter().all(|line| line.persona == "a"));
}

#[test]
fn background_reserves_busy_state_before_any_task_is_spawned() {
    let state = state();
    state.next_idle.store(now() - 1, Ordering::SeqCst);
    let first = begin_background(&state).unwrap().unwrap();
    assert_eq!(lock(&state.runtime).unwrap().phase, RuntimePhase::Loading);
    assert_eq!(
        lock(&state.tasks).unwrap().active,
        Some((tasks::Kind::Background, first.0))
    );
    assert!(begin_background(&state).unwrap().is_none());
    let current = {
        let _action = lock(&state.action).unwrap();
        tasks::reserve(&state, tasks::Kind::Conversation, false).unwrap()
    };
    assert!(first.1.load(Ordering::SeqCst));
    assert!(!set_phase_if_current(
        &state,
        first.0,
        RuntimePhase::Error,
        None,
        Some("old".into())
    )
    .unwrap());
    assert_eq!(
        lock(&state.tasks).unwrap().active,
        Some((tasks::Kind::Conversation, current.0))
    );
    assert_eq!(lock(&state.runtime).unwrap().phase, RuntimePhase::Loading);
}

#[test]
fn model_test_is_single_and_uses_input_settings_hide_and_exit_cancellation() {
    for cause in ["input", "settings", "hide", "exit"] {
        let state = state();
        let tested = super::settings::begin_model_test(&state).unwrap();
        assert!(super::settings::begin_model_test(&state).is_err());
        match cause {
            "input" => {
                let _action = lock(&state.action).unwrap();
                tasks::reserve(&state, tasks::Kind::Conversation, false).unwrap();
            }
            "settings" => {
                apply_settings(
                    &state,
                    &Settings::default(),
                    Some(SettingsScope::Automatic),
                    None,
                )
                .unwrap();
            }
            "hide" => {
                let _action = lock(&state.action).unwrap();
                lock(&state.runtime).unwrap().hidden = true;
                interrupt(&state, false).unwrap();
            }
            "exit" => prepare_exit(&state).unwrap(),
            _ => unreachable!(),
        }
        assert!(
            tested.1.load(Ordering::SeqCst),
            "{cause} must cancel model tests"
        );
        assert!(!set_phase_if_current(&state, tested.0, RuntimePhase::Idle, None, None).unwrap());
    }
}

#[tokio::test]
async fn cancelled_work_leaves_gate_queue_without_waiting_for_another_generation() {
    let state = state();
    let old = {
        let _action = lock(&state.action).unwrap();
        tasks::reserve(&state, tasks::Kind::ModelTest, false).unwrap()
    };
    let _busy = state.gate.lock().await;
    {
        let _action = lock(&state.action).unwrap();
        tasks::reserve(&state, tasks::Kind::Conversation, false).unwrap();
    }
    let acquired = tokio::time::timeout(
        Duration::from_millis(200),
        tasks::acquire_gate(&state, old.0, old.1),
    )
    .await
    .expect("cancelled test must leave the queue while gate is held");
    assert!(acquired.is_none());
}

#[test]
fn unprepared_model_keeps_new_original_and_rule_based_affinity() {
    let state = state();
    let db = lock(&state.db).unwrap();
    let persona = characters::active_character(&db, "a").unwrap().id;
    let before = store::relationships(&db)
        .unwrap()
        .into_iter()
        .find(|relation| relation.persona == persona)
        .unwrap()
        .score;
    assert!(super::conversation::record_input_and_route(
        &state,
        &db,
        "고마워",
        "a",
        "new-without-llm"
    )
    .is_err());
    let original = store::messages(&db, 20)
        .unwrap()
        .into_iter()
        .find(|message| message.id == "new-without-llm")
        .unwrap();
    assert_eq!(original.content, "고마워");
    assert!(store::pending_user_messages(&db)
        .unwrap()
        .iter()
        .any(|message| message.id == original.id));
    let after = store::relationships(&db)
        .unwrap()
        .into_iter()
        .find(|relation| relation.persona == persona)
        .unwrap()
        .score;
    assert_eq!(after, before + 1);
}

#[test]
fn independent_search_settings_cancel_only_an_active_model_test() {
    let state = state();
    let tested = super::settings::begin_model_test(&state).unwrap();
    assert!(cancel_model_test(&state).unwrap().is_some());
    assert!(tested.1.load(Ordering::SeqCst));
    let direct = {
        let _action = lock(&state.action).unwrap();
        tasks::reserve(&state, tasks::Kind::Conversation, false).unwrap()
    };
    assert!(cancel_model_test(&state).unwrap().is_none());
    assert!(!direct.1.load(Ordering::SeqCst));
}

#[test]
fn api_and_local_model_tests_share_duplicate_and_preemption_boundaries() {
    let state = state();
    *lock(&state.download_cancel).unwrap() = Some(Arc::new(AtomicBool::new(false)));
    assert!(super::settings::begin_model_test(&state).is_err());
    let api = super::settings::begin_test(&state, false).unwrap();
    assert!(super::settings::begin_test(&state, false).is_err());
    *lock(&state.download_cancel).unwrap() = None;
    assert!(super::settings::begin_model_test(&state).is_err());
    assert!(cancel_model_test(&state).unwrap().is_some());
    assert!(api.1.load(Ordering::SeqCst));
    assert!(super::settings::begin_model_test(&state).is_ok());
}

#[tokio::test]
async fn a_late_test_result_cannot_commit_over_a_new_conversation() {
    let state = state();
    let tested = super::settings::begin_test(&state, false).unwrap();
    let newer = {
        let _action = lock(&state.action).unwrap();
        tasks::reserve(&state, tasks::Kind::Conversation, false).unwrap()
    };
    let (send, receive) = tokio::sync::oneshot::channel();
    assert!(
        !super::settings::finish_test(&state, tested.0, &tested.1, Ok("old success"), send)
            .unwrap()
    );
    assert!(receive.await.unwrap().is_err());
    assert_eq!(
        lock(&state.tasks).unwrap().active,
        Some((tasks::Kind::Conversation, newer.0))
    );
    assert_eq!(lock(&state.runtime).unwrap().phase, RuntimePhase::Loading);
}
