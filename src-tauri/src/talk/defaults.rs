pub const FILES: &[(&str, &str)] = &[
    ("index.talk", include_str!("../../../talk/index.talk")),
    (
        "pairs/default.talk",
        include_str!("../../../talk/pairs/default.talk"),
    ),
    (
        "situations/index.talk",
        include_str!("../../../talk/situations/index.talk"),
    ),
    (
        "widgets/ball.talk",
        include_str!("../../../talk/widgets/ball.talk"),
    ),
    (
        "widgets/bubbles.talk",
        include_str!("../../../talk/widgets/bubbles.talk"),
    ),
    (
        "widgets/calendar.talk",
        include_str!("../../../talk/widgets/calendar.talk"),
    ),
    (
        "widgets/clock.talk",
        include_str!("../../../talk/widgets/clock.talk"),
    ),
    (
        "widgets/collection.talk",
        include_str!("../../../talk/widgets/collection.talk"),
    ),
    (
        "widgets/completion-jar.talk",
        include_str!("../../../talk/widgets/completion-jar.talk"),
    ),
    (
        "widgets/device.talk",
        include_str!("../../../talk/widgets/device.talk"),
    ),
    (
        "widgets/fishing.talk",
        include_str!("../../../talk/widgets/fishing.talk"),
    ),
    (
        "widgets/focus-timer.talk",
        include_str!("../../../talk/widgets/focus-timer.talk"),
    ),
    (
        "widgets/fortune.talk",
        include_str!("../../../talk/widgets/fortune.talk"),
    ),
    (
        "widgets/guessing.talk",
        include_str!("../../../talk/widgets/guessing.talk"),
    ),
    (
        "widgets/index.talk",
        include_str!("../../../talk/widgets/index.talk"),
    ),
    (
        "widgets/interaction.talk",
        include_str!("../../../talk/widgets/interaction.talk"),
    ),
    (
        "widgets/journal.talk",
        include_str!("../../../talk/widgets/journal.talk"),
    ),
    (
        "widgets/memo.talk",
        include_str!("../../../talk/widgets/memo.talk"),
    ),
    (
        "widgets/music.talk",
        include_str!("../../../talk/widgets/music.talk"),
    ),
    (
        "widgets/paper-plane.talk",
        include_str!("../../../talk/widgets/paper-plane.talk"),
    ),
    (
        "widgets/pet.talk",
        include_str!("../../../talk/widgets/pet.talk"),
    ),
    (
        "widgets/plant.talk",
        include_str!("../../../talk/widgets/plant.talk"),
    ),
    (
        "widgets/preparation.talk",
        include_str!("../../../talk/widgets/preparation.talk"),
    ),
    (
        "widgets/small-match.talk",
        include_str!("../../../talk/widgets/small-match.talk"),
    ),
    (
        "widgets/todo.talk",
        include_str!("../../../talk/widgets/todo.talk"),
    ),
    (
        "widgets/weather.talk",
        include_str!("../../../talk/widgets/weather.talk"),
    ),
];

#[cfg(test)]
mod tests {
    use super::FILES;
    use crate::talk::{context, load, simulate, EvalContext, History, Program};
    use serde::Deserialize;
    use serde_json::{json, Value};
    use std::collections::{BTreeMap, BTreeSet};
    use std::path::Path;

    #[derive(Deserialize)]
    struct Coverage {
        cases: Vec<Case>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Case {
        id: String,
        values: BTreeMap<String, Value>,
        available: BTreeSet<String>,
        active: [String; 2],
        trigger: String,
        expected_scene: Option<String>,
        #[serde(default)]
        seed: u64,
    }

    fn program() -> Program {
        let entry = Path::new(env!("CARGO_MANIFEST_DIR")).join("../talk/index.talk");
        load(&entry, &context::registry()).expect("bundled scripts must pass the real parser")
    }

    fn fixtures() -> Vec<Case> {
        serde_json::from_str::<Coverage>(include_str!("../../../talk/fixtures/coverage.json"))
            .expect("valid coverage fixture")
            .cases
    }

    fn input(case: &Case) -> EvalContext {
        let mut values = context::registry()
            .variables
            .keys()
            .map(|name| {
                let value = if name.ends_with(".ready") {
                    json!(false)
                } else if name.ends_with(".status") {
                    json!("not-installed")
                } else {
                    Value::Null
                };
                (name.clone(), value)
            })
            .collect::<BTreeMap<_, _>>();
        values.extend(case.values.clone());
        EvalContext {
            values,
            available: case.available.clone(),
            active: case.active.clone(),
            trigger: case.trigger.clone(),
            now_ms: 1_000_000,
            seed: case.seed,
        }
    }

    #[test]
    fn every_shipped_branch_selects_its_expected_scene() {
        let program = program();
        let cases = fixtures();
        let covered = cases
            .iter()
            .filter_map(|case| case.expected_scene.as_ref())
            .collect::<BTreeSet<_>>();
        for scene in &program.scenes {
            assert!(covered.contains(&scene.id), "uncovered scene: {}", scene.id);
        }
        let mut failures = Vec::new();
        for case in cases {
            let simulation = simulate(&program, &input(&case), &History::new());
            let actual = simulation
                .selected
                .as_ref()
                .map(|scene| scene.scene_id.as_str());
            if actual != case.expected_scene.as_deref() {
                failures.push(format!(
                    "{}: expected {:?}, got {:?}; candidates {:?}",
                    case.id,
                    case.expected_scene,
                    actual,
                    simulation
                        .candidates
                        .iter()
                        .filter(|candidate| candidate.eligible
                            || Some(&candidate.scene_id) == case.expected_scene.as_ref())
                        .collect::<Vec<_>>()
                ));
            }
        }
        assert!(failures.is_empty(), "{}", failures.join("\n"));
    }

    #[test]
    fn embedded_assets_match_the_parsed_import_graph() {
        let program = program();
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../talk")
            .canonicalize()
            .unwrap();
        let embedded = FILES
            .iter()
            .map(|(path, _)| root.join(path))
            .collect::<BTreeSet<_>>();
        assert_eq!(embedded, program.files);
        for (path, source) in FILES {
            assert_eq!(
                program.sources.get(&root.join(path)).map(String::as_str),
                Some(*source),
                "{path}"
            );
        }
    }

    #[test]
    fn pair_dialogue_maps_to_character_identity_and_falls_back_on_cooldown() {
        let program = program();
        let cases = fixtures();
        let case = cases
            .iter()
            .find(|case| case.id == "pair.quiet-focus")
            .unwrap();
        let mut context = input(case);
        let chosen = simulate(&program, &context, &History::new())
            .selected
            .unwrap();
        assert_eq!(chosen.scene_id, "pair.quiet-focus");
        assert_eq!(chosen.lines[0].persona, "a");
        context.active.swap(0, 1);
        let reversed = simulate(&program, &context, &History::new())
            .selected
            .unwrap();
        assert_eq!(reversed.scene_id, chosen.scene_id);
        assert_eq!(reversed.lines[0].persona, "b");
        assert_eq!(reversed.lines[0].text, chosen.lines[0].text);
        let history = History::from([(chosen.key.clone(), context.now_ms)]);
        let fallback = simulate(&program, &context, &history).selected.unwrap();
        assert_ne!(fallback.scene_id, chosen.scene_id);
        assert!(!fallback.scene_id.starts_with("pair."));
        context.now_ms += chosen.cooldown_ms;
        assert_eq!(
            simulate(&program, &context, &history)
                .selected
                .unwrap()
                .scene_id,
            chosen.scene_id
        );
    }

    #[test]
    fn interpolation_preserves_widget_titles_as_plain_text() {
        let program = program();
        let cases = fixtures();
        let case = cases
            .iter()
            .find(|case| case.id == "music.playing")
            .unwrap();
        let mut context = input(case);
        let title = "<script> A: \"${todo.openCount}\" & 바람";
        context.values.insert("music.title".into(), json!(title));
        let chosen = simulate(&program, &context, &History::new())
            .selected
            .unwrap();
        assert_eq!(chosen.scene_id, "music.playing");
        assert!(chosen.lines[0].text.contains(title));
        context
            .values
            .insert("music.title".into(), json!("가".repeat(501)));
        assert!(simulate(&program, &context, &History::new())
            .selected
            .is_none());
    }
}

#[cfg(test)]
mod pipeline_tests {
    use crate::talk::{context, load, simulate, EvalContext, History, Program, Selection};
    use crate::widgets::{self, storage, WidgetInstance, WidgetRequest};
    use rusqlite::Connection;
    use serde_json::{json, Value};
    use std::path::Path;

    fn database(kinds: &[&str]) -> (Connection, tempfile::TempDir) {
        let directory = tempfile::tempdir().unwrap();
        let db = crate::store::open(Path::new(":memory:")).unwrap();
        storage::install(
            &db,
            directory.path(),
            &kinds.iter().map(|kind| (*kind).into()).collect::<Vec<_>>(),
        )
        .unwrap();
        (db, directory)
    }

    fn program() -> Program {
        load(
            &Path::new(env!("CARGO_MANIFEST_DIR")).join("../talk/index.talk"),
            &context::registry(),
        )
        .unwrap()
    }

    fn instance(db: &Connection, kind: &str) -> WidgetInstance {
        storage::instances(db)
            .unwrap()
            .into_iter()
            .find(|instance| instance.kind == kind)
            .unwrap()
    }

    fn act(db: &Connection, kind: &str, action: &str, input: Value, now: i64, entropy: u64) {
        let current = instance(db, kind);
        storage::execute(
            db,
            &WidgetRequest {
                request_id: uuid::Uuid::new_v4().to_string(),
                instance_id: current.id,
                expected_revision: current.revision,
                action: action.into(),
                input,
            },
            now,
            entropy,
        )
        .unwrap();
    }

    fn reaction(
        db: &Connection,
        program: &Program,
        now: i64,
        expected: &str,
    ) -> (EvalContext, Selection) {
        let event = storage::take_reaction(db, now)
            .unwrap()
            .expect("actual widget event");
        let context = context::build(db, Some(&event), now, 0).unwrap();
        assert!(storage::take_reaction(db, now + 1).unwrap().is_none());
        let selected = simulate(program, &context, &History::new())
            .selected
            .expect("event scene");
        assert_eq!(
            selected.scene_id, expected,
            "payload: {:?}",
            event.event.payload
        );
        (context, selected)
    }

    fn idle_scene(db: &Connection, program: &Program, expected: &str, now: i64) -> Selection {
        let context = context::build(db, None, now, 0).unwrap();
        let history = program
            .scenes
            .iter()
            .filter(|scene| scene.id != expected)
            .map(|scene| (scene.key.clone(), now))
            .collect();
        let selected = simulate(program, &context, &history)
            .selected
            .expect("state scene");
        assert_eq!(selected.scene_id, expected);
        selected
    }

    #[test]
    fn all_twenty_two_installed_widget_initial_states_reach_a_shipped_scene() {
        let catalog = widgets::catalog().unwrap();
        let kinds = catalog
            .iter()
            .map(|manifest| manifest.id.as_str())
            .collect::<Vec<_>>();
        let (db, _directory) = database(&kinds);
        let program = program();
        let expected = [
            "todo.empty",
            "calendar.unconfigured",
            "timer.idle",
            "preparation.empty",
            "jar.empty",
            "clock.no-anniversary",
            "memo.empty",
            "weather.unconfigured",
            "music.permission-needed",
            "device.permission-needed",
            "interaction.snacks",
            "ball.still",
            "plane.ready",
            "bubbles.empty",
            "match.new",
            "guessing.idle",
            "fishing.idle",
            "fortune.fresh",
            "plant.dry",
            "pet.resting",
            "collection.empty",
            "journal.empty",
        ];
        assert_eq!(expected.len(), catalog.len());
        let context = context::build(&db, None, 1_000, 0).unwrap();
        assert_eq!(context.available.len(), 22);
        for scene in expected {
            idle_scene(&db, &program, scene, 1_000);
        }
    }

    #[test]
    fn actual_focus_and_rest_completion_payloads_select_distinct_dialogue() {
        let (db, _directory) = database(&["focus-timer"]);
        let program = program();
        act(
            &db,
            "focus-timer",
            "start",
            json!({"durationMs":1000}),
            1_000,
            0,
        );
        idle_scene(&db, &program, "timer.focus", 1_001);
        act(&db, "focus-timer", "pause", json!({}), 2_000, 0);
        let (context, _) = reaction(&db, &program, 2_000, "timer.finished-focus");
        assert_eq!(context.values["event.mode"], "focus");
        assert_eq!(context.values["timer.state"], "finished");
        act(
            &db,
            "focus-timer",
            "rest",
            json!({"durationMs":1000}),
            3_000,
            0,
        );
        idle_scene(&db, &program, "timer.rest", 3_001);
        act(&db, "focus-timer", "pause", json!({}), 4_000, 0);
        let (context, _) = reaction(&db, &program, 4_000, "timer.finished-rest");
        assert_eq!(context.values["event.mode"], "rest");
        assert_eq!(context.values["timer.remainingMs"], 0);
    }

    #[test]
    fn actual_match_modes_cover_wins_losses_draws_and_coin_results() {
        let (db, _directory) = database(&["small-match"]);
        let program = program();
        for (index, (action, input, entropy, outcome)) in [
            ("dice", json!({}), 3, "winner-a"),
            ("dice", json!({}), 1, "winner-b"),
            ("dice", json!({}), 0, "draw"),
            ("coin", json!({"choice":"heads"}), 0, "correct"),
            ("coin", json!({"choice":"heads"}), 1, "miss"),
            ("rps", json!({"choice":"rock"}), 2, "winner-user"),
            ("rps", json!({"choice":"rock"}), 1, "winner-character"),
            ("rps", json!({"choice":"rock"}), 0, "draw"),
        ]
        .into_iter()
        .enumerate()
        {
            let now = 1_000 + index as i64;
            act(&db, "small-match", action, input, now, entropy);
            let (context, _) = reaction(&db, &program, now, &format!("match.{outcome}"));
            assert_eq!(context.values["event.mode"], action);
            assert_eq!(context.values["event.outcome"], outcome);
            assert_eq!(context.values["match.game"], action);
        }
    }

    #[test]
    fn actual_guessing_results_keep_hidden_answers_out_of_context() {
        let (db, _directory) = database(&["guessing"]);
        let program = program();
        act(&db, "guessing", "start", json!({"mode":"cups"}), 1_000, 0);
        idle_scene(&db, &program, "guessing.cups", 1_000);
        act(&db, "guessing", "guess", json!({"value":2}), 1_001, 0);
        reaction(&db, &program, 1_001, "guessing.empty");
        act(&db, "guessing", "guess", json!({"value":1}), 1_002, 0);
        reaction(&db, &program, 1_002, "guessing.correct");
        idle_scene(&db, &program, "guessing.between-rounds", 1_002);
        act(
            &db,
            "guessing",
            "start",
            json!({"mode":"number"}),
            2_000,
            49,
        );
        idle_scene(&db, &program, "guessing.number", 2_000);
        for (value, now, outcome) in [
            (25, 2_001, "higher"),
            (75, 2_002, "lower"),
            (50, 2_003, "correct"),
        ] {
            act(&db, "guessing", "guess", json!({"value":value}), now, 0);
            let (context, _) = reaction(&db, &program, now, &format!("guessing.{outcome}"));
            assert_eq!(context.values["event.mode"], "number");
            assert!(!context.values.contains_key("guessing.answer"));
        }
        act(
            &db,
            "guessing",
            "start",
            json!({"mode":"number"}),
            3_000,
            49,
        );
        for index in 1..=100 {
            act(
                &db,
                "guessing",
                "guess",
                json!({"value":1}),
                3_000 + index,
                0,
            );
        }
        let (context, _) = reaction(&db, &program, 3_100, "guessing.exhausted");
        assert_eq!(context.values["guessing.attempts"], 100);
        assert_eq!(context.values["guessing.playing"], false);
    }

    #[test]
    fn actual_fishing_catch_names_work_without_optional_collection() {
        let (db, _directory) = database(&["fishing"]);
        let program = program();
        for (index, name) in ["파란 물고기", "금빛 물고기", "양말", "동그란 돌"]
            .into_iter()
            .enumerate()
        {
            let now = 1_000 + index as i64 * 10_000;
            act(&db, "fishing", "cast", json!({}), now, 0);
            idle_scene(&db, &program, "fishing.waiting", now);
            act(&db, "fishing", "reel", json!({}), now + 2_000, index as u64);
            let (context, selected) = reaction(&db, &program, now + 2_000, "fishing.caught");
            assert_eq!(context.values["event.itemName"], name);
            assert_eq!(context.values["event.widget"], "fishing");
            assert_eq!(context.values["fishing.lastCatch"], name);
            assert!(selected.lines[0].text.contains(name));
            assert!(!context.available.contains("collection"));
        }
        act(&db, "fishing", "cast", json!({}), 50_000, 0);
        act(&db, "fishing", "reel", json!({}), 50_001, 0);
        reaction(&db, &program, 50_001, "fishing.missed");
    }

    #[test]
    fn actual_touch_target_speaks_even_when_the_target_is_b() {
        let (db, _directory) = database(&["interaction"]);
        let program = program();
        let mut now = 1_000;
        for character in ["A", "B"] {
            for action in ["stroke", "poke", "snack"] {
                act(
                    &db,
                    "interaction",
                    action,
                    json!({"character":character}),
                    now,
                    0,
                );
                let (context, selected) =
                    reaction(&db, &program, now, &format!("interaction.{action}"));
                assert_eq!(context.values["event.character"], character);
                assert_eq!(selected.lines[0].persona, character.to_lowercase());
                now += 6_000;
            }
        }
    }

    #[test]
    fn actual_preparation_actions_distinguish_empty_envelope_from_checked_contents() {
        let (db, _directory) = database(&["calendar", "preparation"]);
        let program = program();
        let current = instance(&db, "calendar");
        let mut data = current.data.clone();
        data["events"] = json!([{"id":"actual-event","title":"도서관","cancelled":false}]);
        storage::commit_data(&db, &current.id, current.revision, data, vec![], 1_000).unwrap();
        act(
            &db,
            "preparation",
            "create",
            json!({"eventId":"actual-event","eventLabel":"도서관"}),
            1_001,
            0,
        );
        idle_scene(&db, &program, "preparation.no-checks", 1_001);
        let envelope = instance(&db, "preparation").data["envelopes"][0]["id"].clone();
        act(
            &db,
            "preparation",
            "check-add",
            json!({"id":envelope,"text":"반납할 책"}),
            1_002,
            0,
        );
        idle_scene(&db, &program, "preparation.unchecked", 1_002);
        let check = instance(&db, "preparation").data["envelopes"][0]["checks"][0]["id"].clone();
        act(
            &db,
            "preparation",
            "check-toggle",
            json!({"id":envelope,"checkId":check}),
            1_003,
            0,
        );
        idle_scene(&db, &program, "preparation.checked", 1_003);
        let context = context::build(&db, None, 1_003, 0).unwrap();
        assert_eq!(context.values["preparation.checkCount"], 1);
        assert_eq!(context.values["preparation.uncheckedCount"], 0);
        assert!(storage::take_reaction(&db, 1_003).unwrap().is_none());
    }
}
