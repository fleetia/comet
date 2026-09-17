use crate::{interrupt, lock, publish, talk, widgets, AppState};
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
    if let Some(event) = event {
        dependencies.insert(event.widget_kind.clone());
    }
    for kind in dependencies.clone() {
        dependencies.extend(widgets::manifest(&kind)?.required);
    }
    let revisions = widgets::storage::instances(db)?
        .into_iter()
        .filter(|instance| dependencies.contains(&instance.kind))
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
    let context = talk::context::build(db, prepared.event.as_ref(), now, 0)?;
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
