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
    let Some(selection) = talk::simulate(&program, &context, &talk::runtime::history(db)?).selected
    else {
        return Ok(None);
    };
    // Bundled scripts assume two speakers; until cast declarations land, a lone character skips
    // scenes that give the second seat a line.
    if context.active.len() < 2 && selection.lines.iter().any(|line| line.persona != "a") {
        return Ok(None);
    }
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
            rendered.lines.len() == prepared.selection.lines.len()
                && rendered.lines.iter().zip(&prepared.selection.lines).all(
                    |(current, original)| {
                        current.persona == original.persona
                            && current.expression == original.expression
                            && current.text == original.text
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
        Ok(entry) => {
            active.apply(talk::load(&entry, &talk::context::registry()));
            log_diagnostics(&active.diagnostics);
        }
        Err(error) => eprintln!(".talk 초기화 실패: {error}"),
    }
    active
}

pub(crate) fn watch(app: tauri::AppHandle, state: Arc<AppState>) {
    tauri::async_runtime::spawn_blocking(move || {
        let mut monitor = talk::runtime::Monitor::new(state.app_data.join("talk/index.talk"));
        let registry = talk::context::registry();
        while !state.stopping.load(Ordering::SeqCst) {
            if let Some(result) = monitor.poll(&registry, Instant::now()) {
                if let Err(errors) = &result {
                    log_diagnostics(errors);
                }
                let updated = (|| -> Result<bool, String> {
                    let _action = lock(&state.action)?;
                    let changed = lock(&state.talk)?.apply(result);
                    let playing = lock(&state.talk_playback)?.is_some();
                    if changed && playing {
                        let automatic = state.automatic.load(Ordering::SeqCst);
                        let token = interrupt(&state, automatic)?;
                        state.widget_epoch.store(token.0, Ordering::SeqCst);
                        let mut runtime = lock(&state.runtime)?;
                        runtime.phase = "idle".into();
                        runtime.persona = None;
                    }
                    Ok(changed && playing)
                })();
                match updated {
                    Ok(true) => publish(&app, &state),
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
    use std::path::Path;

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
        let branches = (0..5)
            .map(|variant| {
                format!("@if dialogue.variant == {variant}\nA: 변형 {variant}\n@endif\n")
            })
            .collect::<String>();
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
}
