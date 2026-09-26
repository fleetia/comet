use crate::{
    app::{interrupt, lock, publish, AppState},
    talk, widgets,
};
use rusqlite::Connection;
use std::{
    collections::BTreeMap,
    sync::{atomic::Ordering, Arc},
    time::{Duration, Instant},
};

pub(crate) struct PreparedTalk {
    pub selection: talk::Selection,
    generation: u64,
    active: Vec<String>,
    revisions: BTreeMap<String, i64>,
    program: Arc<talk::Program>,
    text_values: BTreeMap<String, serde_json::Value>,
    event: Option<widgets::WidgetEvent>,
    seed: u64,
}

pub(crate) fn prepare(
    state: &AppState,
    db: &Connection,
    event: Option<&widgets::WidgetEvent>,
) -> Result<Option<Vec<crate::types::SceneLine>>, String> {
    let (program, generation) = {
        let active = lock(&state.talk)?;
        (active.program.clone(), active.generation)
    };
    let Some(program) = program else {
        return Ok(None);
    };
    let context = talk::context::build(
        db,
        event,
        chrono::Utc::now().timestamp_millis(),
        uuid::Uuid::new_v4().as_u128() as u64,
    )?;
    let simulation =
        talk::simulate_with_validation(&program, &context, &talk::runtime::history(db)?, |lines| {
            validate_motions(db, lines)
        });
    for candidate in simulation
        .candidates
        .iter()
        .filter(|candidate| candidate.reason.starts_with("motion_error:"))
    {
        eprintln!("talk scene {}: {}", candidate.scene_id, candidate.reason);
    }
    let Some(selection) = simulation.selected else {
        return Ok(None);
    };
    let mut dependencies = selection.dependencies.clone();
    if selection
        .references
        .iter()
        .any(|name| name.starts_with("environment.weather"))
    {
        dependencies.insert("weather".into());
    }
    if let Some(event) = event {
        dependencies.insert(event.widget_kind.clone());
    }
    for kind in dependencies.clone() {
        dependencies.extend(widgets::manifest(&kind)?.required);
    }
    let revisions = widgets::storage::instances(db)?
        .into_iter()
        .filter(|instance| {
            dependencies.contains(&instance.kind) && instance.installed && instance.enabled
        })
        .map(|instance| (instance.id, instance.revision))
        .collect();
    let lines = selection.lines.clone();
    *lock(&state.talk_playback)? = Some(PreparedTalk {
        selection,
        generation,
        active: context.active,
        revisions,
        program,
        text_values: context.values,
        event: event.cloned(),
        seed: context.seed,
    });
    Ok(Some(lines))
}

fn validate_motions(db: &Connection, lines: &[crate::types::SceneLine]) -> Result<(), String> {
    if lines.iter().any(|line| !line.motion.is_inherit()) {
        crate::characters::resolve_lines(db, lines)?;
    }
    Ok(())
}

pub(crate) fn current(state: &AppState, db: &Connection) -> Result<bool, String> {
    let prepared = lock(&state.talk_playback)?;
    let Some(prepared) = prepared.as_ref() else {
        return Ok(false);
    };
    if prepared.generation != lock(&state.talk)?.generation {
        return Ok(false);
    }
    let now = chrono::Utc::now().timestamp_millis();
    if prepared
        .event
        .as_ref()
        .is_some_and(|event| event.expires_at <= now)
    {
        return Ok(false);
    }
    let instances = widgets::storage::instances(db)?;
    if !prepared.revisions.iter().all(|(id, revision)| {
        instances.iter().any(|instance| {
            instance.id == *id
                && instance.revision == *revision
                && instance.installed
                && instance.enabled
        })
    }) {
        return Ok(false);
    }
    let context = talk::context::build(db, prepared.event.as_ref(), now, prepared.seed)?;
    let rendered = talk::render_scene_with_text_values(
        &prepared.program,
        &prepared.selection.key,
        &context,
        &prepared.text_values,
    );
    Ok(context.active == prepared.active
        && rendered.is_some_and(|rendered| {
            validate_motions(db, &rendered.lines).is_ok()
                && rendered.lines.len() == prepared.selection.lines.len()
                && rendered.lines.iter().zip(&prepared.selection.lines).all(
                    |(current, original)| {
                        current.persona == original.persona
                            && current.expression == original.expression
                            && current.text == original.text
                            && current.motion == original.motion
                    },
                )
        }))
}

fn log_diagnostics(diagnostics: &[talk::Diagnostic]) {
    for error in diagnostics {
        eprintln!(
            ".talk {}:{}:{} [{}] {}",
            error.path, error.line, error.column, error.code, error.message
        );
    }
}

pub(crate) fn initialize(app_data: &std::path::Path) -> talk::runtime::ActiveProgram {
    let mut active = talk::runtime::ActiveProgram::default();
    match talk::runtime::initialize_files(app_data) {
        Ok(root) => {
            active.apply(talk::load_bundle(&root, &talk::context::registry()));
            log_diagnostics(&active.diagnostics);
        }
        Err(error) => eprintln!(".talk 초기화 실패: {error}"),
    }
    active
}

pub(crate) fn remove_pack(state: &AppState, id: &str) -> Result<bool, String> {
    let _action = lock(&state.action)?;
    if crate::unavailable(state) {
        return Err("앱을 종료하고 있어요.".into());
    }
    let directory = talk::runtime::remove_pack(&talk::runtime::root(&state.app_data), id)?;
    let (previous_generation, generation, program) = {
        let mut active = lock(&state.talk)?;
        let previous_generation = active.generation;
        active.remove_pack(id, &directory);
        (
            previous_generation,
            active.generation,
            active.program.clone(),
        )
    };
    let Some(program) = program else {
        return Ok(false);
    };
    let stop = {
        let mut playback = lock(&state.talk_playback)?;
        if let Some(prepared) = playback.as_mut() {
            if !program
                .scenes
                .iter()
                .any(|scene| scene.key == prepared.selection.key)
            {
                true
            } else {
                if prepared.generation == previous_generation {
                    prepared.generation = generation;
                    prepared.program = program;
                }
                false
            }
        } else {
            false
        }
    };
    if stop {
        stop_playback(state)?;
    }
    Ok(stop)
}

fn stop_playback(state: &AppState) -> Result<(), String> {
    let automatic = state.automatic.load(Ordering::SeqCst);
    let token = interrupt(state, automatic)?;
    state.widget_epoch.store(token.0, Ordering::SeqCst);
    let mut runtime = lock(&state.runtime)?;
    runtime.phase = crate::types::RuntimePhase::Idle;
    runtime.persona = None;
    Ok(())
}

fn apply_reload(
    state: &AppState,
    generation: u64,
    result: Result<talk::Program, Vec<talk::Diagnostic>>,
) -> Result<Option<bool>, String> {
    let _action = lock(&state.action)?;
    let changed = {
        let mut active = lock(&state.talk)?;
        // An explicit removal can finish while the watcher reads the previous file tree.
        if active.generation != generation {
            return Ok(None);
        }
        active.apply(result)
    };
    let playing = lock(&state.talk_playback)?.is_some();
    if changed && playing {
        stop_playback(state)?;
    }
    Ok(Some(changed && playing))
}

pub(crate) fn watch(app: tauri::AppHandle, state: Arc<AppState>) {
    tauri::async_runtime::spawn_blocking(move || {
        let mut monitor = talk::runtime::Monitor::new(talk::runtime::root(&state.app_data));
        let registry = talk::context::registry();
        while !state.stopping.load(Ordering::SeqCst) {
            let generation = match lock(&state.talk) {
                Ok(active) => active.generation,
                Err(error) => {
                    eprintln!(".talk 재로딩 실패: {error}");
                    break;
                }
            };
            if let Some(result) = monitor.poll(&registry, Instant::now()) {
                if let Err(errors) = &result {
                    log_diagnostics(errors);
                }
                let updated = apply_reload(&state, generation, result);
                match updated {
                    Ok(Some(true)) => publish(&app, &state),
                    Ok(None) => {
                        monitor = talk::runtime::Monitor::new(talk::runtime::root(&state.app_data));
                    }
                    Err(error) => eprintln!(".talk 재로딩 실패: {error}"),
                    _ => {}
                }
            }
            std::thread::sleep(Duration::from_millis(250));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::{fs, path::Path};

    const FIRST_PACK: &str =
        "format: 1\nscene: first\non: idle\n---\nA: 첫 대사\nB: 다음 대사\n===\n";

    fn state_with_packs() -> (tempfile::TempDir, AppState) {
        let directory = tempfile::tempdir().unwrap();
        let mut state = crate::app::tests::state();
        state.app_data = directory.path().to_path_buf();
        let root = talk::runtime::root(&state.app_data);
        for (id, source) in [
            ("first", FIRST_PACK),
            ("other", "format: 1\nscene: other\non: idle\nwhen: character.count > 2\n---\nA: 다른 팩\n===\n"),
        ] {
            let folder = root.join("packs").join(id);
            fs::create_dir_all(&folder).unwrap();
            fs::write(folder.join("index.talk"), source).unwrap();
        }
        fs::write(root.join("index.talk"), "format: 1\n").unwrap();
        lock(&state.talk)
            .unwrap()
            .apply(talk::load_bundle(&root, &talk::context::registry()));
        (directory, state)
    }

    #[test]
    fn removed_pack_stops_prepared_and_displayed_lines_despite_an_unrelated_reload_error() {
        for displayed in [false, true] {
            let (_directory, state) = state_with_packs();
            let token = interrupt(&state, true).unwrap();
            let (lines, revision) = {
                let db = lock(&state.db).unwrap();
                (
                    prepare(&state, &db, None).unwrap().unwrap(),
                    crate::store::revision(&db).unwrap(),
                )
            };
            if displayed {
                assert!(crate::app::scene::present_line(
                    &state,
                    &lines[0],
                    "talk",
                    "before-removal",
                    0,
                    2,
                    revision,
                    token.0,
                    &token.1,
                    false,
                )
                .unwrap());
            }
            let root = talk::runtime::root(&state.app_data);
            fs::write(root.join("index.talk"), "format: 9\n").unwrap();
            let invalid = talk::load_bundle(&root, &talk::context::registry());
            assert!(invalid.is_err());
            assert!(!lock(&state.talk).unwrap().apply(invalid));

            assert!(remove_pack(&state, "first").unwrap());
            assert!(token.1.load(Ordering::SeqCst));
            assert!(lock(&state.playback).unwrap().is_none());
            assert!(lock(&state.talk_playback).unwrap().is_none());
            assert!(!crate::app::scene::present_line(
                &state,
                &lines[1],
                "talk",
                "after-removal",
                1,
                2,
                revision,
                token.0,
                &token.1,
                false,
            )
            .unwrap());
            {
                let mut active = lock(&state.talk).unwrap();
                assert!(!active.apply(talk::load_bundle(&root, &talk::context::registry())));
                assert!(!active.diagnostics.is_empty());
                let program = active.program.as_ref().unwrap();
                assert_eq!(
                    program.packs,
                    std::collections::BTreeSet::from(["other".into()])
                );
                assert!(program
                    .scenes
                    .iter()
                    .all(|scene| scene.pack.as_deref() == Some("other")));
            }
            let db = lock(&state.db).unwrap();
            assert!(prepare(&state, &db, None).unwrap().is_none());
            assert_eq!(
                crate::store::messages(&db, 10).unwrap().len(),
                usize::from(displayed)
            );
            assert_eq!(
                fs::read_to_string(root.join("index.talk")).unwrap(),
                "format: 9\n"
            );
        }
    }

    #[test]
    fn removed_pack_also_revokes_scenes_imported_through_the_user_entry() {
        for has_pack_entry in [true, false] {
            let (_directory, state) = state_with_packs();
            let root = talk::runtime::root(&state.app_data);
            let folder = root.join("packs/first");
            let removed_directory = fs::canonicalize(&folder).unwrap();
            let name = if has_pack_entry {
                "index.talk"
            } else {
                "part.talk"
            };
            fs::write(
                folder.join("index.talk"),
                FIRST_PACK.replace("on: idle", "on: idle\ncooldown: 1h"),
            )
            .unwrap();
            if !has_pack_entry {
                fs::rename(folder.join("index.talk"), folder.join(name)).unwrap();
            }
            let source = format!("format: 1\nimport \"./packs/first/{name}\"\n");
            fs::write(root.join("index.talk"), &source).unwrap();
            let program = talk::load_bundle(&root, &talk::context::registry()).unwrap();
            let imported = program
                .scenes
                .iter()
                .find(|scene| scene.pack.is_none())
                .unwrap()
                .key
                .clone();
            {
                let db = lock(&state.db).unwrap();
                for scene in program
                    .scenes
                    .iter()
                    .filter(|scene| scene.pack.as_deref() == Some("first"))
                {
                    db.execute(
                        "INSERT INTO talk_history(scene_key,shown_at) VALUES(?1,?2)",
                        rusqlite::params![scene.key, chrono::Utc::now().timestamp_millis()],
                    )
                    .unwrap();
                }
            }
            lock(&state.talk).unwrap().apply(Ok(program));
            let token = interrupt(&state, true).unwrap();
            assert!(prepare(&state, &lock(&state.db).unwrap(), None)
                .unwrap()
                .is_some());
            assert_eq!(
                lock(&state.talk_playback)
                    .unwrap()
                    .as_ref()
                    .unwrap()
                    .selection
                    .key,
                imported
            );

            assert!(remove_pack(&state, "first").unwrap());
            assert!(token.1.load(Ordering::SeqCst));
            let failed_reload = talk::load_bundle(&root, &talk::context::registry());
            assert!(failed_reload.is_err());
            {
                let mut active = lock(&state.talk).unwrap();
                assert!(!active.apply(failed_reload));
                let program = active.program.as_ref().unwrap();
                assert!(!program
                    .scenes
                    .iter()
                    .any(|scene| Path::new(&scene.span.path).starts_with(&removed_directory)));
                assert_eq!(program.scenes.len(), 1);
                assert_eq!(program.scenes[0].pack.as_deref(), Some("other"));
            }
            assert!(prepare(&state, &lock(&state.db).unwrap(), None)
                .unwrap()
                .is_none());
            assert_eq!(fs::read_to_string(root.join("index.talk")).unwrap(), source);
        }
    }

    #[test]
    fn removed_other_pack_preserves_last_good_playback_and_a_failed_removal_changes_nothing() {
        let (_directory, state) = state_with_packs();
        let token = interrupt(&state, true).unwrap();
        let (lines, revision) = {
            let db = lock(&state.db).unwrap();
            (
                prepare(&state, &db, None).unwrap().unwrap(),
                crate::store::revision(&db).unwrap(),
            )
        };
        let root = talk::runtime::root(&state.app_data);
        fs::write(root.join("index.talk"), "format: 9\n").unwrap();
        assert!(!lock(&state.talk)
            .unwrap()
            .apply(talk::load_bundle(&root, &talk::context::registry())));

        assert!(!remove_pack(&state, "other").unwrap());
        assert!(!token.1.load(Ordering::SeqCst));
        assert_eq!(state.epoch.load(Ordering::SeqCst), token.0);
        assert!(current(&state, &lock(&state.db).unwrap()).unwrap());
        let generation = lock(&state.talk).unwrap().generation;
        assert!(remove_pack(&state, "other").is_err());
        assert_eq!(lock(&state.talk).unwrap().generation, generation);
        assert!(crate::app::scene::present_line(
            &state,
            &lines[1],
            "talk",
            "unrelated-continues",
            1,
            2,
            revision,
            token.0,
            &token.1,
            false,
        )
        .unwrap());
        assert!(!lock(&state.talk).unwrap().diagnostics.is_empty());
    }

    #[test]
    fn removed_pack_cannot_be_restored_by_an_older_reload_but_can_be_reinstalled() {
        for active_missing in [false, true] {
            let (_directory, state) = state_with_packs();
            if active_missing {
                *lock(&state.talk).unwrap() = talk::runtime::ActiveProgram::default();
            }
            let root = talk::runtime::root(&state.app_data);
            let old_generation = lock(&state.talk).unwrap().generation;
            let stale = talk::load_bundle(&root, &talk::context::registry()).unwrap();
            assert!(!remove_pack(&state, "first").unwrap());
            assert!(apply_reload(&state, old_generation, Ok(stale))
                .unwrap()
                .is_none());
            assert!(!lock(&state.talk)
                .unwrap()
                .program
                .as_ref()
                .is_some_and(|program| program.packs.contains("first")));

            let folder = root.join("packs/first");
            fs::create_dir(&folder).unwrap();
            fs::write(folder.join("index.talk"), FIRST_PACK).unwrap();
            let generation = lock(&state.talk).unwrap().generation;
            assert_eq!(
                apply_reload(
                    &state,
                    generation,
                    talk::load_bundle(&root, &talk::context::registry())
                )
                .unwrap(),
                Some(false)
            );
            assert!(lock(&state.talk)
                .unwrap()
                .program
                .as_ref()
                .unwrap()
                .packs
                .contains("first"));
            assert!(prepare(&state, &lock(&state.db).unwrap(), None)
                .unwrap()
                .is_some());
        }
    }

    #[test]
    fn core_weather_revision_change_cancels_even_when_condition_and_text_still_match() {
        let state = crate::app::tests::state();
        let db = lock(&state.db).unwrap();
        let now = chrono::Utc::now().timestamp_millis();
        let data = json!({"status":"ready","lastSuccessAt":now,"observation":{"temperature":1,"weatherCode":3,"name":"서울","observedAt":now}});
        db.execute("INSERT INTO widget_instances(id,kind,version,installed,enabled,revision,data,error) VALUES('weather','weather',1,1,1,0,?1,NULL)", [data.to_string()]).unwrap();
        let program = talk::validate_source(Path::new("core.talk"), "format: 1\nscene: weather\non: idle\nwhen: environment.weatherReady and environment.weatherTemperature != null and environment.weatherTemperature < 5\n---\nA: 기온이 낮네.\nB: 겉옷을 챙겨.\n===", &talk::context::registry()).unwrap();
        lock(&state.talk).unwrap().apply(Ok(program));
        assert!(prepare(&state, &db, None).unwrap().is_some());
        assert!(current(&state, &db).unwrap());
        db.execute("UPDATE widget_instances SET revision=revision+1,data=json_set(data,'$.observation.temperature',2) WHERE id='weather'", []).unwrap();
        assert!(!current(&state, &db).unwrap());
    }

    #[test]
    fn unknown_weather_fallback_can_play_with_a_disabled_or_missing_connection() {
        let state = crate::app::tests::state();
        let db = lock(&state.db).unwrap();
        let program = talk::validate_source(Path::new("core.talk"), "format: 1\nscene: unknown\non: idle\nwhen: not environment.weatherReady\n---\nA: 지금 날씨는 몰라.\n===", &talk::context::registry()).unwrap();
        lock(&state.talk).unwrap().apply(Ok(program));
        assert!(prepare(&state, &db, None).unwrap().is_some());
        assert!(current(&state, &db).unwrap());
        db.execute("INSERT INTO widget_instances(id,kind,version,installed,enabled,revision,data,error) VALUES('weather','weather',1,1,0,0,'{}',NULL)", []).unwrap();
        assert!(prepare(&state, &db, None).unwrap().is_some());
        assert!(current(&state, &db).unwrap());
    }

    #[test]
    fn revalidation_uses_the_prepared_variant_for_every_line() {
        let state = crate::app::tests::state();
        let db = lock(&state.db).unwrap();
        use std::fmt::Write as _;
        let mut branches = String::new();
        for variant in 0..5 {
            write!(
                branches,
                "@if dialogue.variant == {variant}\nA: 변형 {variant}\n@endif\n"
            )
            .unwrap();
        }
        let program = talk::validate_source(
            Path::new("variant.talk"),
            &format!("format: 1\nscene: variant\non: idle\n---\n{branches}===\n"),
            &talk::context::registry(),
        )
        .unwrap();
        lock(&state.talk).unwrap().apply(Ok(program));
        assert!(prepare(&state, &db, None).unwrap().is_some());
        assert!(current(&state, &db).unwrap());
        for seed in 0..5 {
            {
                let mut playing = lock(&state.talk_playback).unwrap();
                let prepared = playing.as_mut().unwrap();
                let context =
                    talk::context::build(&db, None, chrono::Utc::now().timestamp_millis(), seed)
                        .unwrap();
                prepared.selection =
                    talk::render_scene(&prepared.program, &prepared.selection.key, &context)
                        .unwrap();
                prepared.seed = seed;
                prepared.text_values = context.values;
            }
            assert!(current(&state, &db).unwrap(), "variant {seed}");
        }
    }

    #[test]
    fn invalid_motion_candidate_does_not_block_an_unrelated_playable_scene() {
        let state = crate::app::tests::state();
        let db = lock(&state.db).unwrap();
        let program = talk::validate_source(
            Path::new("motion.talk"),
            "format: 1\nscene: invalid\non: idle\n---\nA{motion=missing}: 없는 모션\n===\nscene: valid\non: idle\n---\nB{motion=none}: 계속할 수 있는 대사\n===\n",
            &talk::context::registry(),
        ).unwrap();
        let context = talk::context::build(&db, None, 1000, 0).unwrap();
        let simulated =
            talk::simulate_with_validation(&program, &context, &talk::History::new(), |lines| {
                validate_motions(&db, lines)
            });
        assert!(simulated.candidates[0].reason.starts_with("motion_error:"));
        assert_eq!(simulated.selected.unwrap().scene_id, "valid");
        lock(&state.talk).unwrap().apply(Ok(program));
        let lines = prepare(&state, &db, None).unwrap().unwrap();
        assert_eq!(lines[0].persona, "b");
        assert_eq!(
            lines[0].motion,
            crate::character_reactions::MotionOverride::Static
        );
        assert!(current(&state, &db).unwrap());
        lock(&state.talk_playback)
            .unwrap()
            .as_mut()
            .unwrap()
            .selection
            .lines[0]
            .motion = crate::character_reactions::MotionOverride::Inherit;
        assert!(!current(&state, &db).unwrap());
    }
}
