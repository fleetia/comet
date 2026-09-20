/// A talk pack shipped inside the app. Files are encrypted `.talk` envelopes embedded at build
/// time; `default_installed` packs are copied into app data once on first initialization.
pub struct Pack {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub default_installed: bool,
    pub files: &'static [(&'static str, &'static str)],
}

/// The user's own entry file for a fresh install: `format: 1` plus comments, no scenes.
pub const USER_ENTRY: &str = include_str!("../../../talk/index.talk");

macro_rules! byulkkori {
    ($($name:literal),* $(,)?) => {
        &[$(($name, include_str!(concat!("../../../talk/packs/byulkkori/", $name)))),*]
    };
}
macro_rules! nadir {
    ($($name:literal),* $(,)?) => {
        &[$(($name, include_str!(concat!("../../../talk/packs/nadir-and-star-tail/", $name)))),*]
    };
}

pub const BYULKKORI: &str = "byulkkori";
pub const NADIR_AND_STAR_TAIL: &str = "nadir-and-star-tail";

pub const PACKS: &[Pack] = &[
    Pack {
        id: BYULKKORI,
        name: "별꼬리 기본 대화",
        description: "시간·날씨·위젯 상태에 반응하는 밝고 짧은 기본 대화. 함께 지내는 친구 1~8명 중 무작위 화자가 말해요.",
        default_installed: true,
        files: byulkkori![
            "index.talk",
            "situations/duo.talk",
            "situations/group.talk",
            "situations/solo.talk",
            "situations/time.talk",
            "situations/weather.talk",
            "widgets/ball.talk",
            "widgets/bubbles.talk",
            "widgets/calendar.talk",
            "widgets/clock.talk",
            "widgets/collection.talk",
            "widgets/completion-jar.talk",
            "widgets/device.talk",
            "widgets/fishing.talk",
            "widgets/focus-timer.talk",
            "widgets/fortune.talk",
            "widgets/guessing.talk",
            "widgets/interaction.talk",
            "widgets/journal.talk",
            "widgets/memo.talk",
            "widgets/music.talk",
            "widgets/paper-plane.talk",
            "widgets/pet.talk",
            "widgets/plant.talk",
            "widgets/preparation.talk",
            "widgets/small-match.talk",
            "widgets/todo.talk",
            "widgets/weather.talk",
        ],
    },
    Pack {
        id: NADIR_AND_STAR_TAIL,
        name: "나디르와 별꼬리",
        description: "나디르·별꼬리 추가팩 전용 대화. 두 캐릭터가 함께 지낼 때만 재생돼요.",
        default_installed: false,
        files: nadir![
            "index.talk",
            "pairs/default.talk",
            "situations/index.talk",
            "widgets/ball.talk",
            "widgets/bubbles.talk",
            "widgets/calendar.talk",
            "widgets/clock.talk",
            "widgets/collection.talk",
            "widgets/completion-jar.talk",
            "widgets/device.talk",
            "widgets/fishing.talk",
            "widgets/focus-timer.talk",
            "widgets/fortune.talk",
            "widgets/guessing.talk",
            "widgets/index.talk",
            "widgets/interaction.talk",
            "widgets/journal.talk",
            "widgets/memo.talk",
            "widgets/music.talk",
            "widgets/paper-plane.talk",
            "widgets/pet.talk",
            "widgets/plant.talk",
            "widgets/preparation.talk",
            "widgets/small-match.talk",
            "widgets/todo.talk",
            "widgets/weather.talk",
        ],
    },
];

pub fn pack(id: &str) -> Option<&'static Pack> {
    PACKS.iter().find(|pack| pack.id == id)
}

#[cfg(test)]
mod tests {
    use super::{Pack, BYULKKORI, NADIR_AND_STAR_TAIL, PACKS};
    use crate::talk::{context, load_pack, simulate, EvalContext, History, Program, Selection};
    use serde::Deserialize;
    use serde_json::{json, Value};
    use std::collections::{BTreeMap, BTreeSet};
    use std::path::{Path, PathBuf};

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
        active: Vec<String>,
        trigger: String,
        expected_scene: Option<String>,
        #[serde(default)]
        seed: u64,
    }

    fn repo_pack(id: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../talk/packs")
            .join(id)
    }

    fn program(id: &str) -> Program {
        load_pack(&repo_pack(id).join("index.talk"), &context::registry(), id)
            .expect("bundled scripts must pass the real parser")
    }

    fn fixtures(id: &str) -> Vec<Case> {
        let path =
            Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("../talk/fixtures/{id}.json"));
        serde_json::from_str::<Coverage>(&std::fs::read_to_string(path).unwrap())
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
        values.insert("character.count".into(), json!(case.active.len()));
        values.insert("dialogue.variant".into(), json!(case.seed % 5));
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

    fn scene_ids(program: &Program) -> BTreeSet<&str> {
        program
            .scenes
            .iter()
            .map(|scene| scene.id.as_str())
            .collect()
    }

    fn check_coverage(id: &str, guards: &[(&str, &str, &str)]) {
        let program = program(id);
        let cases = fixtures(id);
        let covered = cases
            .iter()
            .filter_map(|case| case.expected_scene.as_ref())
            .collect::<BTreeSet<_>>();
        for scene in &program.scenes {
            assert!(
                covered.contains(&scene.id),
                "{id}: uncovered scene {}",
                scene.id
            );
        }
        let ids = scene_ids(&program);
        for scene in &covered {
            assert!(
                ids.contains(scene.as_str()),
                "{id}: fixture for unknown scene {scene}"
            );
        }
        let mut failures = Vec::new();
        for case in cases {
            let context = input(&case);
            let history = if case.expected_scene.is_some() {
                program
                    .scenes
                    .iter()
                    .filter(|scene| Some(&scene.id) != case.expected_scene.as_ref())
                    .map(|scene| (scene.key.clone(), context.now_ms))
                    .collect()
            } else {
                History::new()
            };
            let simulation = simulate(&program, &context, &history);
            if case.expected_scene.is_none() && case.id != "negative.incomplete-context" {
                assert!(
                    simulation
                        .candidates
                        .iter()
                        .all(|candidate| candidate.reason != "cooldown"
                            && candidate.reason != "pair_mismatch"),
                    "{} did not exercise state guards",
                    case.id
                );
            }
            let actual = simulation
                .selected
                .as_ref()
                .map(|scene| scene.scene_id.as_str());
            if let Some((_, scene_id, reason)) =
                guards.iter().find(|(case_id, _, _)| *case_id == case.id)
            {
                assert!(
                    simulation
                        .candidates
                        .iter()
                        .any(|candidate| candidate.scene_id == *scene_id
                            && !candidate.eligible
                            && candidate.reason == *reason),
                    "{} did not enforce {reason}",
                    case.id
                );
                // A guarded negative case only proves the guarded scene stays out; packs with
                // unconditional chatter may still select something else.
                if case.expected_scene.is_none() {
                    assert_ne!(actual, Some(*scene_id), "{}", case.id);
                    continue;
                }
            }
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
    fn every_shipped_nadir_branch_selects_its_expected_scene() {
        check_coverage(
            NADIR_AND_STAR_TAIL,
            &[
                (
                    "negative.disabled-todo",
                    "todo.open",
                    "dependency_unavailable",
                ),
                (
                    "negative.null-weather",
                    "weather.freezing",
                    "condition_false",
                ),
                (
                    "negative.event-mismatch",
                    "guessing.correct",
                    "trigger_mismatch",
                ),
                (
                    "negative.unknown-result",
                    "match.winner-a",
                    "condition_false",
                ),
                (
                    "negative.incomplete-context",
                    "time.morning",
                    "pair_mismatch",
                ),
            ],
        );
    }

    #[test]
    fn every_shipped_byulkkori_branch_selects_its_expected_scene() {
        check_coverage(
            BYULKKORI,
            &[
                (
                    "negative.disabled-todo",
                    "todo.empty",
                    "dependency_unavailable",
                ),
                ("negative.null-weather", "weather.cold", "condition_false"),
                (
                    "negative.event-mismatch",
                    "guessing.attempt",
                    "trigger_mismatch",
                ),
                ("negative.unknown-result", "match.dice", "condition_false"),
            ],
        );
    }

    fn embedded_matches(pack: &Pack) {
        let program = program(pack.id);
        let root = repo_pack(pack.id).canonicalize().unwrap();
        let embedded = pack
            .files
            .iter()
            .map(|(path, _)| root.join(path))
            .collect::<BTreeSet<_>>();
        assert_eq!(embedded, program.files, "{}", pack.id);
        for (path, source) in pack.files {
            assert_eq!(
                program.sources.get(&root.join(path)).map(String::as_str),
                Some(
                    crate::talk::encryption::decode(source.as_bytes())
                        .unwrap()
                        .as_str()
                ),
                "{}/{path}",
                pack.id
            );
        }
        assert_eq!(program.packs, BTreeSet::from([pack.id.to_owned()]));
        assert!(program
            .scenes
            .iter()
            .all(|scene| scene.pack.as_deref() == Some(pack.id) && scene.key.contains(pack.id)));
    }

    #[test]
    fn embedded_assets_match_the_parsed_import_graph_of_every_pack() {
        assert_eq!(
            PACKS.iter().filter(|pack| pack.default_installed).count(),
            1
        );
        assert!(PACKS
            .iter()
            .all(|pack| crate::talk::parser::valid_pack_id(pack.id)));
        assert!(crate::talk::encryption::is_encrypted(
            super::USER_ENTRY.as_bytes()
        ));
        assert!(
            crate::talk::encryption::decode(super::USER_ENTRY.as_bytes())
                .unwrap()
                .starts_with("format: 1\n")
        );
        for pack in PACKS {
            embedded_matches(pack);
        }
    }

    #[test]
    fn pair_dialogue_follows_source_identity_after_swap_and_respects_cooldown() {
        let program = program(NADIR_AND_STAR_TAIL);
        let case = fixtures(NADIR_AND_STAR_TAIL)
            .into_iter()
            .find(|case| case.id == "pair.quiet-focus")
            .unwrap();
        let mut context = input(&case);
        let scene = program
            .scenes
            .iter()
            .find(|scene| scene.id == case.id)
            .unwrap();
        let chosen = crate::talk::render_scene(&program, &scene.key, &context).unwrap();
        assert_eq!(chosen.lines[0].persona, "a");
        context.active.swap(0, 1);
        context
            .values
            .insert("character.a.sourceId".into(), json!("star-tail"));
        context
            .values
            .insert("character.b.sourceId".into(), json!("nadir"));
        let reversed = crate::talk::render_scene(&program, &scene.key, &context).unwrap();
        assert_eq!(reversed.lines[0].persona, "b");
        assert_eq!(reversed.lines[0].text, chosen.lines[0].text);
        let history = History::from([(chosen.key.clone(), context.now_ms)]);
        let simulation = simulate(&program, &context, &history);
        assert!(simulation
            .candidates
            .iter()
            .any(|candidate| candidate.key == chosen.key && candidate.reason == "cooldown"));
    }

    fn assert_five_variants(id: &str, affinities: &[i64]) {
        let program = program(id);
        for case in fixtures(id)
            .into_iter()
            .filter(|case| case.expected_scene.is_some())
        {
            let mut context = input(&case);
            let scene = program
                .scenes
                .iter()
                .find(|scene| Some(&scene.id) == case.expected_scene.as_ref())
                .unwrap();
            for affinity in affinities {
                context
                    .values
                    .insert("character.nadir.affinity".into(), json!(affinity));
                let mut variants = BTreeSet::new();
                for variant in 0..5 {
                    context.seed = variant;
                    context
                        .values
                        .insert("dialogue.variant".into(), json!(variant));
                    let selected = crate::talk::render_scene(&program, &scene.key, &context)
                        .unwrap_or_else(|| panic!("{} variant {variant}", case.id));
                    let texts = selected
                        .lines
                        .iter()
                        .map(|line| (line.expression.as_str(), line.text.as_str()))
                        .collect::<Vec<_>>();
                    variants.insert(serde_json::to_string(&texts).unwrap());
                }
                assert_eq!(variants.len(), 5, "{id} {} affinity {affinity}", case.id);
            }
        }
    }

    #[test]
    fn every_condition_and_touch_affinity_branch_has_five_distinct_variations() {
        assert_five_variants(NADIR_AND_STAR_TAIL, &[20, 50, 80]);
        assert_five_variants(BYULKKORI, &[20]);
    }

    fn assert_cooldowns_and_touch_repeats(id: &str) {
        let program = program(id);
        for scene in &program.scenes {
            assert_eq!(
                scene.cooldown_ms,
                if scene.trigger == "idle" {
                    30 * 60 * 1000
                } else {
                    0
                },
                "{id} {}",
                scene.id
            );
        }
        for case in fixtures(id)
            .into_iter()
            .filter(|case| case.trigger == "interaction.touch")
        {
            let mut context = input(&case);
            let scene = program
                .scenes
                .iter()
                .find(|scene| Some(&scene.id) == case.expected_scene.as_ref())
                .unwrap();
            let mut history = History::from([(scene.key.clone(), context.now_ms)]);
            let mut variants = BTreeSet::new();
            for seed in 0..5 {
                context.now_ms += 1;
                context.seed = seed;
                context
                    .values
                    .insert("dialogue.variant".into(), json!(seed));
                let selected = simulate(&program, &context, &history)
                    .selected
                    .unwrap_or_else(|| panic!("{} repeat {seed} was suppressed", case.id));
                assert_eq!(selected.scene_id, scene.id);
                variants.insert(serde_json::to_string(&selected.lines).unwrap());
                history.insert(selected.key, context.now_ms);
            }
            assert_eq!(variants.len(), 5, "{id} {}", case.id);
        }
    }

    #[test]
    fn repeated_touch_events_keep_five_variants_despite_recent_playback() {
        assert_cooldowns_and_touch_repeats(NADIR_AND_STAR_TAIL);
        assert_cooldowns_and_touch_repeats(BYULKKORI);
    }

    #[test]
    fn interpolation_preserves_widget_titles_as_plain_text() {
        for id in [NADIR_AND_STAR_TAIL, BYULKKORI] {
            let program = program(id);
            let cases = fixtures(id);
            let case = cases
                .iter()
                .find(|case| case.id == "music.playing")
                .unwrap();
            let mut context = input(case);
            let title = "<script> A: \"${todo.openCount}\" & 바람";
            context.values.insert("music.title".into(), json!(title));
            let history = program
                .scenes
                .iter()
                .filter(|scene| scene.id != "music.playing")
                .map(|scene| (scene.key.clone(), context.now_ms))
                .collect::<History>();
            let chosen = simulate(&program, &context, &history).selected.unwrap();
            assert_eq!(chosen.scene_id, "music.playing", "{id}");
            assert!(chosen.lines[0].text.contains(title));
            context
                .values
                .insert("music.title".into(), json!("가".repeat(501)));
            assert!(simulate(&program, &context, &history)
                .selected
                .is_none_or(|selection| selection.scene_id != "music.playing"));
        }
    }

    fn byulkkori_context(count: usize, seed: u64, hour: i64) -> EvalContext {
        let case = Case {
            id: String::new(),
            values: BTreeMap::from([("environment.hour".into(), json!(hour))]),
            available: BTreeSet::new(),
            active: (0..count).map(|index| format!("friend-{index}")).collect(),
            trigger: "idle".into(),
            expected_scene: None,
            seed,
        };
        input(&case)
    }

    fn eligible_selections(program: &Program, context: &EvalContext) -> Vec<Selection> {
        program
            .scenes
            .iter()
            .filter_map(|scene| crate::talk::render_scene(program, &scene.key, context))
            .collect()
    }

    #[test]
    fn default_pack_speaks_alone_with_one_friend_and_picks_random_subsets_up_to_eight() {
        let program = program(BYULKKORI);
        assert!(program.scenes.iter().all(|scene| scene.pair.is_none()));
        let solo = eligible_selections(&program, &byulkkori_context(1, 3, 9));
        assert!(!solo.is_empty());
        assert!(solo
            .iter()
            .all(|selection| selection.lines.iter().all(|line| line.persona == "a")));
        assert!(!program.scenes.iter().any(
            |scene| scene.id == "duo.tail-race" && solo.iter().any(|s| s.scene_id == scene.id)
        ));

        let mut speaker_sets = BTreeSet::new();
        let mut max_speakers = 0;
        for seed in 0..40 {
            let context = byulkkori_context(8, seed, 9);
            for selection in eligible_selections(&program, &context) {
                let personas = selection
                    .lines
                    .iter()
                    .map(|line| line.persona.as_str())
                    .collect::<BTreeSet<_>>();
                max_speakers = max_speakers.max(personas.len());
                assert!(personas.len() <= 4, "{}", selection.scene_id);
                if selection.scene_id == "duo.tail-race" {
                    speaker_sets
                        .insert(personas.into_iter().map(str::to_owned).collect::<Vec<_>>());
                }
            }
        }
        assert!(
            max_speakers >= 4,
            "group scenes must open with eight friends"
        );
        assert!(max_speakers < 8, "nobody needs all eight to speak at once");
        assert!(speaker_sets.len() >= 5, "random speakers: {speaker_sets:?}");
        assert!(speaker_sets
            .iter()
            .any(|set| set.iter().all(|persona| persona != "a")));
    }

    #[test]
    fn random_speaker_order_is_stable_for_the_same_seed_and_revalidation() {
        let program = program(BYULKKORI);
        let context = byulkkori_context(5, 11, 15);
        let scene = program
            .scenes
            .iter()
            .find(|scene| scene.id == "trio.circle")
            .unwrap();
        let first = crate::talk::render_scene(&program, &scene.key, &context).unwrap();
        let again = crate::talk::render_scene_with_text_values(
            &program,
            &scene.key,
            &context,
            &context.values,
        )
        .unwrap();
        assert_eq!(
            serde_json::to_string(&first.lines).unwrap(),
            serde_json::to_string(&again.lines).unwrap()
        );
        let mut other = context.clone();
        other.seed = 12;
        let shuffled = (0..30).any(|seed| {
            other.seed = seed;
            crate::talk::render_scene(&program, &scene.key, &other)
                .unwrap()
                .lines
                .iter()
                .zip(&first.lines)
                .any(|(left, right)| left.persona != right.persona)
        });
        assert!(shuffled);
    }
}

#[cfg(test)]
mod pipeline_tests {
    use super::{BYULKKORI, NADIR_AND_STAR_TAIL};
    use crate::talk::{context, load_pack, simulate, EvalContext, History, Program, Selection};
    use crate::widgets::{self, storage, WidgetInstance, WidgetRequest};
    use rusqlite::Connection;
    use serde_json::{json, Value};
    use std::path::Path;

    fn nadir_database(kinds: &[&str]) -> (Connection, tempfile::TempDir) {
        let directory = tempfile::tempdir().unwrap();
        let db = crate::store::open(Path::new(":memory:")).unwrap();
        let imported =
            crate::characters::import_pack(&db, &crate::characters::nadir_pack()).unwrap();
        crate::characters::apply_pair(&db, [imported[0].id.clone(), imported[1].id.clone()])
            .unwrap();
        storage::install(
            &db,
            directory.path(),
            &kinds.iter().map(|kind| (*kind).into()).collect::<Vec<_>>(),
        )
        .unwrap();
        (db, directory)
    }

    fn program(id: &str) -> Program {
        load_pack(
            &Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../talk/packs")
                .join(id)
                .join("index.talk"),
            &context::registry(),
            id,
        )
        .unwrap()
    }

    #[test]
    fn bundled_addon_dialogue_requires_its_installed_active_pair() {
        let db = crate::store::open(Path::new(":memory:")).unwrap();
        let program = program(NADIR_AND_STAR_TAIL);
        let selected = || {
            let context = context::build(&db, None, 1_000, 0).unwrap();
            simulate(&program, &context, &History::new()).selected
        };
        assert!(selected().is_none());

        let imported =
            crate::characters::import_pack(&db, &crate::characters::nadir_pack()).unwrap();
        assert!(selected().is_none());

        crate::characters::apply_pair(&db, [imported[0].id.clone(), imported[1].id.clone()])
            .unwrap();
        assert!(selected().is_some());

        crate::characters::apply_pair(&db, ["builtin-a".into(), imported[1].id.clone()]).unwrap();
        assert!(selected().is_none());
    }

    #[test]
    fn default_pack_plays_for_the_factory_roster_without_any_widget() {
        let db = crate::store::open(Path::new(":memory:")).unwrap();
        let program = program(BYULKKORI);
        let context = context::build(&db, None, 1_000, 0).unwrap();
        assert_eq!(
            context.values["character.count"],
            json!(context.active.len())
        );
        let selected = simulate(&program, &context, &History::new())
            .selected
            .expect("time or generic chatter must be available without widgets");
        assert!(selected.lines.iter().all(
            |line| context.active.len() > crate::characters::slot_index(&line.persona).unwrap()
        ));
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

    const INITIAL_STATES: [&str; 22] = [
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

    #[test]
    fn all_twenty_two_installed_widget_initial_states_reach_a_shipped_scene() {
        let catalog = widgets::catalog().unwrap();
        let kinds = catalog
            .iter()
            .map(|manifest| manifest.id.as_str())
            .collect::<Vec<_>>();
        assert_eq!(INITIAL_STATES.len(), catalog.len());
        let (db, _directory) = nadir_database(&kinds);
        let program = program(NADIR_AND_STAR_TAIL);
        let context = context::build(&db, None, 1_000, 0).unwrap();
        assert_eq!(context.available.len(), 22);
        for scene in INITIAL_STATES {
            idle_scene(&db, &program, scene, 1_000);
        }
    }

    #[test]
    fn default_pack_reaches_every_widget_initial_state_with_the_factory_roster() {
        let catalog = widgets::catalog().unwrap();
        let kinds = catalog
            .iter()
            .map(|manifest| manifest.id.as_str())
            .collect::<Vec<_>>();
        let directory = tempfile::tempdir().unwrap();
        let db = crate::store::open(Path::new(":memory:")).unwrap();
        storage::install(
            &db,
            directory.path(),
            &kinds.iter().map(|kind| (*kind).into()).collect::<Vec<_>>(),
        )
        .unwrap();
        let program = program(BYULKKORI);
        for scene in INITIAL_STATES {
            idle_scene(&db, &program, scene, 1_000);
        }
    }

    #[test]
    fn actual_focus_and_rest_completion_payloads_select_distinct_dialogue() {
        let (db, _directory) = nadir_database(&["focus-timer"]);
        let program = program(NADIR_AND_STAR_TAIL);
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
        let (db, _directory) = nadir_database(&["small-match"]);
        let program = program(NADIR_AND_STAR_TAIL);
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
    fn default_pack_match_results_branch_on_the_actual_outcome() {
        let directory = tempfile::tempdir().unwrap();
        let db = crate::store::open(Path::new(":memory:")).unwrap();
        storage::install(&db, directory.path(), &["small-match".into()]).unwrap();
        let program = program(BYULKKORI);
        let mut texts = std::collections::BTreeSet::new();
        for (index, (action, input, entropy, scene)) in [
            ("dice", json!({}), 3, "match.dice"),
            ("dice", json!({}), 0, "match.dice"),
            ("coin", json!({"choice":"heads"}), 1, "match.coin"),
            ("rps", json!({"choice":"rock"}), 2, "match.rps"),
        ]
        .into_iter()
        .enumerate()
        {
            let now = 1_000 + index as i64;
            act(&db, "small-match", action, input, now, entropy);
            let (_, selected) = reaction(&db, &program, now, scene);
            texts.insert(selected.lines[0].text.clone());
        }
        assert_eq!(texts.len(), 4);
    }

    #[test]
    fn actual_guessing_results_keep_hidden_answers_out_of_context() {
        let (db, _directory) = nadir_database(&["guessing"]);
        let program = program(NADIR_AND_STAR_TAIL);
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
        let (db, _directory) = nadir_database(&["fishing"]);
        let program = program(NADIR_AND_STAR_TAIL);
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
        let (db, _directory) = nadir_database(&["interaction"]);
        let program = program(NADIR_AND_STAR_TAIL);
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
    fn default_pack_touch_reactions_follow_the_touched_slot() {
        let directory = tempfile::tempdir().unwrap();
        let db = crate::store::open(Path::new(":memory:")).unwrap();
        storage::install(&db, directory.path(), &["interaction".into()]).unwrap();
        let program = program(BYULKKORI);
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
                let (_, selected) = reaction(&db, &program, now, &format!("interaction.{action}"));
                assert_eq!(selected.lines.len(), 1);
                assert_eq!(selected.lines[0].persona, character.to_lowercase());
                now += 6_000;
            }
        }
    }

    #[test]
    fn touch_voice_follows_nadir_after_slot_swap() {
        let (db, _directory) = nadir_database(&["interaction"]);
        let mut pair = crate::characters::active_ids(&db).unwrap();
        pair.reverse();
        crate::characters::apply_roster(&db, pair).unwrap();
        let program = program(NADIR_AND_STAR_TAIL);
        act(
            &db,
            "interaction",
            "poke",
            json!({"character":"B"}),
            1_000,
            0,
        );
        let (_, selected) = reaction(&db, &program, 1_000, "interaction.poke");
        assert_eq!(selected.lines[0].persona, "b");
        assert!(selected.lines[0].text.contains("부르면"));
        act(
            &db,
            "interaction",
            "poke",
            json!({"character":"A"}),
            7_000,
            0,
        );
        let (_, selected) = reaction(&db, &program, 7_000, "interaction.poke");
        assert_eq!(selected.lines[0].persona, "a");
        assert!(selected.lines[0].text.contains("눈으로 콕"));
    }

    #[test]
    fn actual_preparation_actions_distinguish_empty_envelope_from_checked_contents() {
        let (db, _directory) = nadir_database(&["calendar", "preparation"]);
        let program = program(NADIR_AND_STAR_TAIL);
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
