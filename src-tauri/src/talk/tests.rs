use super::*;
use serde_json::json;
use std::fs;
use tempfile::tempdir;

fn registry() -> Registry {
    Registry {
        variables: [
            Variable {
                name: "weather.ready".into(),
                kind: ValueType::Boolean,
                nullable: false,
                widget: Some("weather".into()),
                description: String::new(),
            },
            Variable {
                name: "weather.temperature".into(),
                kind: ValueType::Number,
                nullable: true,
                widget: Some("weather".into()),
                description: String::new(),
            },
            Variable {
                name: "todo.title".into(),
                kind: ValueType::String,
                nullable: true,
                widget: Some("todo".into()),
                description: String::new(),
            },
        ]
        .into_iter()
        .map(|variable| (variable.name.clone(), variable))
        .collect(),
        events: BTreeSet::from(["timer-finished".into()]),
    }
}
fn context() -> EvalContext {
    EvalContext {
        values: BTreeMap::from([
            ("weather.ready".into(), json!(true)),
            ("weather.temperature".into(), json!(3)),
            ("todo.title".into(), json!("산책")),
        ]),
        active: vec!["first".into(), "second".into()],
        available: BTreeSet::from(["weather".into(), "todo".into()]),
        now_ms: 100_000,
        seed: 1,
        trigger: "idle".into(),
    }
}
fn parse(source: &str) -> Program {
    validate_source(Path::new("main.talk"), source, &registry()).unwrap()
}

#[test]
fn nested_conditions_interpolation_and_multiline_preserve_authored_text() {
    let source = "# comment retained\nformat: 1\nscene: cold\non: idle\nwhen: weather.ready and (weather.temperature != null and weather.temperature < 5)\n---\n@if todo.title != null\nA[걱정]: \"\"\"\n  ${todo.title} 가기 전에\n\n 겉옷 챙겨.  \n\"\"\"\n@if not weather.temperature >= 5\nB[장난]: \\${literal} \\\\ 끝\n@else\nB: 사용하지 않는 대사\n@endif\n@else\nA: 제목 없음\n@endif\n===\n";
    let program = parse(source);
    let selected = simulate(&program, &context(), &History::new())
        .selected
        .unwrap();
    assert_eq!(selected.lines.len(), 2);
    assert_eq!(selected.lines[0].text, "  산책 가기 전에\n\n 겉옷 챙겨.  ");
    assert_eq!(selected.lines[1].text, "${literal} \\ 끝");
    assert_eq!(
        selected.dependencies,
        BTreeSet::from(["todo".into(), "weather".into()])
    );
    assert!(selected.references.contains("todo.title"));
    assert_eq!(program.sources[Path::new("main.talk")], source);
}

#[test]
fn nullable_values_are_not_numbers_or_printable_text_and_missing_widgets_skip() {
    let program = parse("format: 1\nscene: cold\non: idle\nwhen: weather.temperature < 5\n---\nA: 추워.\n===\nscene: title\non: idle\n---\nA: ${todo.title}\n===");
    let mut state = context();
    state
        .values
        .insert("weather.temperature".into(), Value::Null);
    state.values.insert("todo.title".into(), Value::Null);
    let result = simulate(&program, &state, &History::new());
    assert!(result.selected.is_none());
    assert!(result.candidates[0].reason.starts_with("condition_error"));
    assert!(result.candidates[1].reason.starts_with("render_error"));
    state.available.remove("weather");
    assert_eq!(
        simulate(&program, &state, &History::new()).candidates[0].reason,
        "dependency_unavailable"
    );
}

#[test]
fn validation_reports_unknown_fields_variables_events_and_bad_types() {
    for (source, code, line) in [
        (
            "format: 1\nscene: bad\non: missing\n---\nA: 안녕\n===",
            "UNKNOWN_EVENT",
            3,
        ),
        (
            "format: 1\nscene: bad\non: idle\nwhen: weather.typo\n---\nA: 안녕\n===",
            "EXPRESSION_TYPE",
            4,
        ),
        (
            "format: 1\nscene: bad\non: idle\nwhen: todo.title > 1\n---\nA: 안녕\n===",
            "EXPRESSION_TYPE",
            4,
        ),
        (
            "format: 1\nscene: bad\non: idle\npriority: 2\n---\nA: 안녕\n===",
            "UNKNOWN_HEADER",
            4,
        ),
        (
            "format: 1\nscene: bad\non: idle\n---\nC: 안녕\n===",
            "SPEAKER",
            5,
        ),
        (
            "format: 1\nscene: bad\non: idle\n---\nA: ${todo.typo}\n===",
            "UNKNOWN_VARIABLE",
            5,
        ),
    ] {
        let error = validate_source(Path::new("bad.talk"), source, &registry()).unwrap_err();
        assert_eq!(error[0].code, code);
        assert_eq!(error[0].line, line);
        assert_eq!(error[0].path, "bad.talk");
    }
}

#[test]
fn imported_pair_scenes_win_only_when_playable_and_roles_follow_character_ids() {
    let directory = tempdir().unwrap();
    fs::create_dir(directory.path().join("pair")).unwrap();
    let entry = directory.path().join("main.talk");
    fs::write(&entry, "format: 1\nimport \"pair/pair.talk\" for pair(\"first\", \"second\")\nimport \"pair/pair.talk\" for pair(\"first\", \"second\")\nscene: greeting\non: idle\n---\nA: 공통\n===").unwrap();
    fs::write(directory.path().join("pair/pair.talk"), "format: 1\nimport \"child.talk\"\nscene: greeting\non: idle\ncooldown: 1m\n---\nA: 첫 캐릭터\nB: 둘째 캐릭터\n===").unwrap();
    fs::write(
        directory.path().join("pair/child.talk"),
        "format: 1\nscene: timer\non: timer-finished\n---\nB: 시간 끝\n===",
    )
    .unwrap();
    let program = load(&entry, &registry()).unwrap();
    assert_eq!(program.files.len(), 3);
    assert_eq!(program.scenes.len(), 3);
    let mut state = context();
    state.active.swap(0, 1);
    let selection = simulate(&program, &state, &History::new())
        .selected
        .unwrap();
    assert_eq!(selection.lines[0].persona, "b");
    assert_eq!(selection.lines[1].persona, "a");
    assert_eq!(selection.lines[0].text, "첫 캐릭터");
    let history = History::from([(selection.key.clone(), state.now_ms)]);
    let fallback = simulate(&program, &state, &history).selected.unwrap();
    assert_eq!(fallback.lines[0].text, "공통");
    state.trigger = "timer-finished".into();
    assert_eq!(
        simulate(&program, &state, &History::new())
            .selected
            .unwrap()
            .lines[0]
            .persona,
        "a"
    );
}

#[test]
fn loader_rejects_scope_duplicates_cycles_missing_and_outside_paths() {
    let directory = tempdir().unwrap();
    let root = directory.path().join("scripts");
    fs::create_dir(&root).unwrap();
    let entry = root.join("main.talk");
    for (source, expected) in [
        ("format: 1\nimport \"missing.talk\"", "IMPORT_IO"),
        ("format: 1\nimport \"main.talk\"", "IMPORT_CYCLE"),
        (
            "format: 1\nscene: a\non: idle\n---\nA: 하나\n===\nscene: a\non: idle\n---\nA: 둘\n===",
            "DUPLICATE_SCENE",
        ),
        (
            "format: 1\nimport \"../outside.talk\"",
            "IMPORT_OUTSIDE_ROOT",
        ),
    ] {
        fs::write(directory.path().join("outside.talk"), "format: 1").unwrap();
        fs::write(&entry, source).unwrap();
        assert_eq!(load(&entry, &registry()).unwrap_err()[0].code, expected);
    }
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(
            directory.path().join("outside.talk"),
            root.join("link.talk"),
        )
        .unwrap();
        fs::write(&entry, "format: 1\nimport \"link.talk\"").unwrap();
        assert_eq!(
            load(&entry, &registry()).unwrap_err()[0].code,
            "IMPORT_OUTSIDE_ROOT"
        );
    }
}

#[test]
fn selection_uses_last_shown_history_without_mutating_it_and_checks_render_limits() {
    let program = parse(
        "format: 1\nscene: a\non: idle\n---\nA: 하나\n===\nscene: b\non: idle\n---\nB: 둘\n===",
    );
    let state = context();
    let first = simulate(&program, &state, &History::new())
        .selected
        .unwrap();
    let history = History::from([(first.key.clone(), state.now_ms)]);
    let second = simulate(&program, &state, &history).selected.unwrap();
    assert_ne!(first.key, second.key);
    assert_eq!(history.len(), 1);
    assert_eq!(
        simulate(&program, &state, &history).selected.unwrap().key,
        second.key
    );
    let long = parse("format: 1\nscene: a\non: idle\n---\nA: ${todo.title}\n===");
    let mut state = context();
    state
        .values
        .insert("todo.title".into(), json!("가".repeat(501)));
    assert!(simulate(&long, &state, &History::new()).selected.is_none());
    state
        .values
        .insert("todo.title".into(), json!("가".repeat(500)));
    assert!(simulate(&long, &state, &History::new()).selected.is_some());
    let nine = parse(&format!(
        "format: 1\nscene: a\non: idle\n---\n{}===",
        "A: 줄\n".repeat(9)
    ));
    assert!(simulate(&nine, &state, &History::new()).selected.is_none());
}

#[test]
fn imported_comment_only_files_and_optional_format_keep_editor_source_ranges() {
    let directory = tempdir().unwrap();
    let entry = directory.path().join("main.talk");
    fs::write(
        &entry,
        "format:1\nimport \"empty.talk\"\nimport \"scene.talk\"",
    )
    .unwrap();
    fs::write(directory.path().join("empty.talk"), "# repaired\n").unwrap();
    fs::write(
        directory.path().join("scene.talk"),
        "# description\nscene: greeting\non: idle\n---\nA: \"\"\"\n 한글 \n\"\"\"\n===\n",
    )
    .unwrap();
    let program = load(&entry, &registry()).unwrap();
    assert_eq!(program.scenes.len(), 1);
    let scene = &program.scenes[0];
    assert_eq!(
        (scene.span.line, scene.span.end_line, scene.span.end_column),
        (2, 8, 4)
    );
    let Statement::Line { span, .. } = &scene.body[0] else {
        panic!("line required")
    };
    assert_eq!((span.line, span.end_line, span.end_column), (5, 7, 4));
    assert_eq!(
        simulate(&program, &context(), &History::new())
            .selected
            .unwrap()
            .lines[0]
            .text,
        " 한글 "
    );
    let key = scene.key.clone();
    fs::rename(
        directory.path().join("scene.talk"),
        directory.path().join("renamed.talk"),
    )
    .unwrap();
    fs::write(&entry, "format:1\nimport \"renamed.talk\"").unwrap();
    assert_eq!(load(&entry, &registry()).unwrap().scenes[0].key, key);
}

#[test]
fn active_scene_revalidation_ignores_cooldown_but_rechecks_conditions_and_rendered_text() {
    let program = parse("format: 1\nscene: cold\non: idle\nwhen: weather.temperature < 5\ncooldown: 1h\n---\nA: ${todo.title} 갈 때 겉옷 챙겨.\n===");
    let mut state = context();
    let selected = simulate(&program, &state, &History::new())
        .selected
        .unwrap();
    let history = History::from([(selected.key.clone(), state.now_ms)]);
    assert!(simulate(&program, &state, &history).selected.is_none());
    state.values.insert("weather.temperature".into(), json!(4));
    assert_eq!(
        render_scene(&program, &selected.key, &state).unwrap().lines[0].text,
        selected.lines[0].text
    );
    state.values.insert("todo.title".into(), json!("장보기"));
    assert_ne!(
        render_scene(&program, &selected.key, &state).unwrap().lines[0].text,
        selected.lines[0].text
    );
    state.values.insert("weather.temperature".into(), json!(5));
    assert!(render_scene(&program, &selected.key, &state).is_none());
}

#[cfg(unix)]
#[test]
fn watcher_detects_symlink_retarget_with_identical_file_size_and_modification_time() {
    use std::{
        os::unix::fs::symlink,
        time::{Duration, Instant, SystemTime},
    };
    let directory = tempdir().unwrap();
    let entry = directory.path().join("index.talk");
    let first = directory.path().join("first.talk");
    let second = directory.path().join("second.talk");
    let link = directory.path().join("active.talk");
    fs::write(&entry, "format: 1\nimport \"active.talk\"\n").unwrap();
    fs::write(&first, "scene: greeting\non: idle\n---\nA: first!\n===\n").unwrap();
    fs::write(&second, "scene: greeting\non: idle\n---\nA: second\n===\n").unwrap();
    let modified = SystemTime::UNIX_EPOCH + Duration::from_secs(1_700_000_000);
    for path in [&first, &second] {
        fs::File::options()
            .write(true)
            .open(path)
            .unwrap()
            .set_times(fs::FileTimes::new().set_modified(modified))
            .unwrap();
    }
    assert_eq!(
        fs::metadata(&first).unwrap().len(),
        fs::metadata(&second).unwrap().len()
    );
    assert_eq!(
        fs::metadata(&first).unwrap().modified().unwrap(),
        fs::metadata(&second).unwrap().modified().unwrap()
    );
    symlink(&first, &link).unwrap();
    let mut monitor = runtime::Monitor::new(entry);
    let at = Instant::now();
    assert!(monitor.poll(&registry(), at).is_none());
    let before = monitor
        .poll(&registry(), at + Duration::from_secs(1))
        .unwrap()
        .unwrap();
    assert_eq!(
        simulate(&before, &context(), &History::new())
            .selected
            .unwrap()
            .lines[0]
            .text,
        "first!"
    );
    fs::remove_file(&link).unwrap();
    symlink(&second, &link).unwrap();
    assert!(monitor
        .poll(&registry(), at + Duration::from_secs(2))
        .is_none());
    let after = monitor
        .poll(&registry(), at + Duration::from_secs(3))
        .unwrap()
        .unwrap();
    assert_eq!(
        simulate(&after, &context(), &History::new())
            .selected
            .unwrap()
            .lines[0]
            .text,
        "second"
    );
}

#[test]
fn failed_reload_keeps_last_good_but_explicit_empty_entry_disables_script_candidates() {
    let mut active = runtime::ActiveProgram::default();
    assert!(active.apply(Ok(parse(
        "format: 1\nscene: hello\non: idle\n---\nA: 안녕\n===\n"
    ))));
    let generation = active.generation;
    let invalid = validate_source(
        Path::new("main.talk"),
        "format: 1\nscene: unfinished\n",
        &registry(),
    );
    assert!(!active.apply(invalid));
    assert_eq!(active.generation, generation);
    assert!(!active.diagnostics.is_empty());
    assert!(simulate(
        active.program.as_ref().unwrap(),
        &context(),
        &History::new()
    )
    .selected
    .is_some());
    assert!(active.apply(Ok(parse("# intentionally disabled\nformat: 1\n"))));
    assert!(active.diagnostics.is_empty());
    assert!(simulate(
        active.program.as_ref().unwrap(),
        &context(),
        &History::new()
    )
    .selected
    .is_none());
}

#[test]
fn text_snapshot_survives_elapsed_time_while_live_conditions_and_nullability_are_rechecked() {
    let registry = Registry {
        variables: BTreeMap::from([(
            "timer.remainingMs".into(),
            Variable {
                name: "timer.remainingMs".into(),
                kind: ValueType::Number,
                nullable: true,
                widget: Some("focus-timer".into()),
                description: String::new(),
            },
        )]),
        events: BTreeSet::new(),
    };
    let program = validate_source(Path::new("timer.talk"), "format: 1\nscene: running\non: idle\nwhen: timer.remainingMs != null and timer.remainingMs > 0\n---\n@if timer.remainingMs > 1000\nA: 남은 시간 ${timer.remainingMs}ms\n@else\nA: 곧 끝나.\n@endif\n===\nscene: snapshot_only\non: idle\n---\nA: ${timer.remainingMs}\n===", &registry).unwrap();
    let mut state = EvalContext {
        values: BTreeMap::from([("timer.remainingMs".into(), json!(60_000))]),
        available: BTreeSet::from(["focus-timer".into()]),
        ..context()
    };
    let key = &program.scenes[0].key;
    let original = render_scene(&program, key, &state).unwrap();
    let text_values = state.values.clone();
    state
        .values
        .insert("timer.remainingMs".into(), json!(59_999));
    assert_ne!(
        render_scene(&program, key, &state).unwrap().lines[0].text,
        original.lines[0].text
    );
    assert_eq!(
        render_scene_with_text_values(&program, key, &state, &text_values)
            .unwrap()
            .lines[0]
            .text,
        original.lines[0].text
    );
    state.values.insert("timer.remainingMs".into(), json!(999));
    assert_eq!(
        render_scene_with_text_values(&program, key, &state, &text_values)
            .unwrap()
            .lines[0]
            .text,
        "곧 끝나."
    );
    state.values.insert("timer.remainingMs".into(), json!(0));
    assert!(render_scene_with_text_values(&program, key, &state, &text_values).is_none());
    state.values.insert("timer.remainingMs".into(), Value::Null);
    assert!(
        render_scene_with_text_values(&program, &program.scenes[1].key, &state, &text_values)
            .is_none()
    );
}
