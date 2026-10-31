use super::super::{is_current, lock, phase, publish, scene, scene_events, AppState};
use crate::{
    characters, models,
    pack_stories::{self, RunTicket, SceneInteraction, StoryInput, StorySavedLine, StoryStep},
    store, story,
    types::{PanelState, RuntimePhase, SceneLine},
};
use std::{
    collections::BTreeMap,
    sync::{atomic::AtomicBool, Arc},
    time::Duration,
};

pub(super) fn matches_run(active: &RunTicket, expected: &RunTicket) -> bool {
    active.run_id == expected.run_id
        && active.epoch == expected.epoch
        && active.phase_generation == expected.phase_generation
}

pub(super) fn transition(run: &mut RunTicket, target: &str) -> Result<bool, String> {
    let chapters = run
        .definition
        .as_ref()
        .and_then(|d| d.chapters.as_ref())
        .ok_or("이야기의 장을 찾을 수 없어요.")?;
    let current = chapters
        .iter()
        .position(|c| Some(&c.id) == run.chapter_id.as_ref())
        .ok_or("이야기의 장이 바뀌었어요.")?;
    let next = match target {
        "next" => {
            run.step += 1;
            return Ok(true);
        }
        "nextChapter" => chapters[current]
            .next
            .as_deref()
            .unwrap_or_else(|| chapters.get(current + 1).map_or("end", |c| c.id.as_str())),
        other => other,
    };
    if next == "end" {
        return Ok(false);
    }
    if !chapters.iter().any(|chapter| chapter.id == next) {
        return Err("이동할 장을 찾을 수 없어요.".into());
    }
    run.chapter_id = Some(next.into());
    run.step = 0;
    Ok(true)
}

pub(super) fn render(text: &str, name: &str, answers: &BTreeMap<String, String>) -> String {
    let mut output = text.replace("{userName}", name);
    for (id, answer) in answers {
        output = output.replace(&format!("{{answer.{id}}}"), answer);
    }
    output
}

pub(super) fn render_record(
    text: &str,
    name: &str,
    answers: &BTreeMap<String, String>,
) -> Option<String> {
    let mut output = text.replace("{userName}", name);
    let mut redacted = false;
    for id in answers.keys() {
        let placeholder = format!("{{answer.{id}}}");
        if output.contains(&placeholder) {
            output = output.replace(&placeholder, "…");
            redacted = true;
        }
    }
    redacted.then_some(output)
}

pub(super) fn saved_name_line(
    saved: Option<StorySavedLine>,
    needs_name: bool,
    persona: String,
    name: &str,
    answers: &BTreeMap<String, String>,
) -> Option<(SceneLine, Option<String>)> {
    let saved = saved.filter(|_| needs_name)?;
    let recorded_text = render_record(&saved.text, name, answers);
    Some((
        SceneLine {
            persona,
            expression: saved.expression,
            text: render(&saved.text, name, answers),
            widget: None,
            motion: saved.motion,
        },
        recorded_text,
    ))
}

fn local_persona(
    db: &rusqlite::Connection,
    run: &RunTicket,
    source: &str,
) -> Result<String, String> {
    characters::get_pack_story_definition(db, &run.scope.pack_id)?
        .source_to_local
        .get(source)
        .cloned()
        .ok_or("이야기 화자를 찾을 수 없어요.".into())
}

fn advance(
    state: &AppState,
    expected: &RunTicket,
    target: &str,
) -> Result<Option<RunTicket>, String> {
    let _action = lock(&state.action)?;
    let db = lock(&state.db)?;
    if !scene_events::current(state, expected)?
        || !scene_events::available_locked(state, &db, expected)?
    {
        return Ok(None);
    }
    let mut runtime = lock(&state.pack_stories)?;
    let Some(run) = runtime
        .run
        .as_mut()
        .filter(|run| matches_run(run, expected))
    else {
        return Ok(None);
    };
    if !pack_stories::current(&db, run)? {
        return Ok(None);
    }
    let mut next = run.clone();
    let continuing = transition(&mut next, target)?;
    next.phase_generation += 1;
    if !continuing {
        pack_stories::resume::finish(
            &db,
            &next,
            "completed",
            chrono::Utc::now().timestamp_millis(),
        )?;
    }
    if runtime
        .interaction
        .as_ref()
        .is_some_and(|item| item.choices.is_none())
    {
        *lock(&state.playback)? = None;
    }
    if !continuing {
        runtime.interaction = None;
        runtime.run = None;
        drop(runtime);
        scene_events::clear_run(state, &db, &next.run_id)?;
        characters::guests::leave_run_locked(state, &next.run_id)?;
        return Ok(None);
    }
    runtime.interaction = None;
    runtime.run = Some(next.clone());
    Ok(Some(next))
}

fn chapter_step(run: &RunTicket) -> Result<(StoryStep, String), String> {
    let chapters = run
        .definition
        .as_ref()
        .and_then(|d| d.chapters.as_ref())
        .ok_or("이야기의 장을 찾을 수 없어요.")?;
    let chapter = chapters
        .iter()
        .find(|c| Some(&c.id) == run.chapter_id.as_ref())
        .ok_or("이야기의 장이 바뀌었어요.")?;
    Ok((
        chapter
            .steps
            .get(run.step)
            .cloned()
            .ok_or("이야기 단계를 찾을 수 없어요.")?,
        chapter.title.clone(),
    ))
}

pub(super) fn next_target(run: &RunTicket) -> Result<String, String> {
    let chapters = run
        .definition
        .as_ref()
        .and_then(|d| d.chapters.as_ref())
        .ok_or("이야기의 장을 찾을 수 없어요.")?;
    let index = chapters
        .iter()
        .position(|c| Some(&c.id) == run.chapter_id.as_ref())
        .ok_or("이야기의 장이 바뀌었어요.")?;
    if run.step + 1 < chapters[index].steps.len() {
        return Ok("next".into());
    }
    Ok(chapters[index].next.clone().unwrap_or_else(|| {
        chapters
            .get(index + 1)
            .map_or("end".into(), |c| c.id.clone())
    }))
}

pub(super) fn checkpoint_before_step(
    state: &AppState,
    run: &RunTicket,
    cancel: &AtomicBool,
    step: &StoryStep,
    chapter_saved: &mut bool,
) -> Result<bool, String> {
    if *chapter_saved
        || matches!(
            step,
            StoryStep::Line { .. } | StoryStep::Choice { .. } | StoryStep::Ask { .. }
        )
    {
        return Ok(true);
    }
    let _action = lock(&state.action)?;
    let db = lock(&state.db)?;
    if !is_current(state, run.epoch, cancel)
        || !scene_events::available_locked(state, &db, run)?
        || !lock(&state.pack_stories)?
            .run
            .as_ref()
            .is_some_and(|active| matches_run(active, run))
        || !pack_stories::current(&db, run)?
    {
        return Ok(false);
    }
    if store::current_user(&db)?.is_some() {
        pack_stories::resume::save_chapter(
            &db,
            run,
            run.chapter_id.as_deref().ok_or("이야기의 장이 없어요.")?,
            chrono::Utc::now().timestamp_millis(),
        )?;
    }
    *chapter_saved = true;
    Ok(true)
}

async fn show_line(
    app: &tauri::AppHandle,
    state: &AppState,
    run: &RunTicket,
    cancel: Arc<AtomicBool>,
    (line, recorded_text): (SceneLine, Option<String>),
    source: &str,
    (save_chapter, keep_playback): (bool, bool),
) -> Result<bool, String> {
    let revision = store::revision(&*lock(&state.db)?)?;
    let id = format!(
        "scene-story:{}:{}:{}",
        run.run_id,
        run.phase_generation,
        uuid::Uuid::new_v4()
    );
    if !scene::present_line_with_record(
        state,
        &line,
        source,
        &id,
        0,
        1,
        revision,
        run.epoch,
        &cancel,
        false,
        recorded_text.as_deref(),
    )? {
        return Ok(false);
    }
    publish(app, state);
    let Some(displayed) = scene::wait_for_displayed_line(state, run.epoch, cancel.clone()).await?
    else {
        return Ok(false);
    };
    if save_chapter && store::current_user(&*lock(&state.db)?)?.is_some() {
        let _action = lock(&state.action)?;
        let db = lock(&state.db)?;
        if !is_current(state, run.epoch, &cancel)
            || !scene_events::available_locked(state, &db, run)?
            || !lock(&state.pack_stories)?
                .run
                .as_ref()
                .is_some_and(|active| matches_run(active, run))
        {
            return Ok(false);
        }
        pack_stories::resume::save_chapter(
            &db,
            run,
            run.chapter_id.as_deref().ok_or("이야기의 장이 없어요.")?,
            displayed.display_started_at.unwrap_or_default(),
        )?;
    }
    let Some(_) = scene::wait_for_completed_line(state, run.epoch, cancel.clone()).await? else {
        return Ok(false);
    };
    if !finish_line(state, run, &cancel, keep_playback)? {
        return Ok(false);
    }
    if !keep_playback {
        publish(app, state);
    }
    Ok(true)
}

pub(super) fn finish_line(
    state: &AppState,
    run: &RunTicket,
    cancel: &AtomicBool,
    keep_playback: bool,
) -> Result<bool, String> {
    let _action = lock(&state.action)?;
    let db = lock(&state.db)?;
    if !is_current(state, run.epoch, cancel)
        || !scene_events::current(state, run)?
        || !scene_events::available_locked(state, &db, run)?
        || !pack_stories::current(&db, run)?
    {
        return Ok(false);
    }
    if !keep_playback {
        *lock(&state.playback)? = None;
    }
    Ok(true)
}

fn take_answer(state: &AppState, run: &RunTicket) -> Result<Option<String>, String> {
    let _action = lock(&state.action)?;
    let db = lock(&state.db)?;
    if !scene_events::available_locked(state, &db, run)? {
        return Ok(None);
    }
    let mut runtime = lock(&state.pack_stories)?;
    if !runtime
        .run
        .as_ref()
        .is_some_and(|active| matches_run(active, run))
    {
        return Ok(None);
    }
    Ok(runtime
        .interaction
        .as_mut()
        .and_then(|interaction| interaction.answer.take()))
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum WaitOutcome {
    Matched,
    Cancelled,
    TimedOut,
    Interrupted,
}

pub(super) async fn wait_for_event(
    state: &AppState,
    run: &RunTicket,
    cancel: Arc<AtomicBool>,
    deadline: tokio::time::Instant,
) -> Result<WaitOutcome, String> {
    loop {
        if !is_current(state, run.epoch, &cancel) || !scene_events::available(state, run)? {
            return Ok(WaitOutcome::Interrupted);
        }
        if let Some(result) = scene_events::take_event(state, run)? {
            return Ok(match result {
                scene_events::WaitResult::Matched => WaitOutcome::Matched,
                scene_events::WaitResult::Cancelled => WaitOutcome::Cancelled,
            });
        }
        if tokio::time::Instant::now() >= deadline {
            return Ok(WaitOutcome::TimedOut);
        }
        tokio::select! {
            _ = models::cancelled(cancel.clone()) => return Ok(WaitOutcome::Interrupted),
            _ = tokio::time::sleep(Duration::from_millis(50)) => {}
        }
    }
}

pub(super) async fn follow_wait<F, Fut>(
    outcome: WaitOutcome,
    timeout: pack_stories::StoryTimeout,
    mut execute_step: F,
) -> Result<Option<String>, String>
where
    F: FnMut(StoryStep) -> Fut,
    Fut: std::future::Future<Output = Result<bool, String>>,
{
    match outcome {
        WaitOutcome::Matched => Ok(Some("next".into())),
        WaitOutcome::Interrupted => Ok(None),
        WaitOutcome::Cancelled | WaitOutcome::TimedOut => {
            for step in timeout.steps {
                if !execute_step(step).await? {
                    return Ok(None);
                }
            }
            Ok(Some(timeout.then))
        }
    }
}

pub(crate) fn record_displayed_choice(
    state: &AppState,
    db: &rusqlite::Connection,
    request: &story::Request,
) -> Result<(), String> {
    let Some(at) = request.display_started_at else {
        return Ok(());
    };
    let mut runtime = lock(&state.pack_stories)?;
    let Some(run) = runtime.run.clone() else {
        return Ok(());
    };
    if !run
        .definition
        .as_ref()
        .is_some_and(|definition| definition.purpose == pack_stories::ScenarioPurpose::Tutorial)
        || request.epoch != run.epoch
        || state.epoch.load(std::sync::atomic::Ordering::SeqCst) != run.epoch
        || !runtime.interaction.as_ref().is_some_and(|item| {
            item.run_id == run.run_id
                && item.generation == run.phase_generation
                && item.epoch == run.epoch
                && item.request_id == request.id
                && item.persona == request.persona
                && request.user_id == run.scope.user_id
                && item.choices.is_some()
                && item.answer.is_none()
        })
        || !pack_stories::current(db, &run)?
        || !scene_events::available_locked(state, db, &run)?
    {
        return Ok(());
    }
    let Some(text) = runtime.choice_recorded_text.clone() else {
        return Ok(());
    };
    let line = SceneLine {
        persona: request.persona.clone(),
        expression: request.expression.clone().unwrap_or_default(),
        text: text.clone(),
        widget: None,
        motion: request.motion.clone().unwrap_or_default(),
    };
    let message = crate::types::Message {
        id: request.id.clone(),
        role: "assistant".into(),
        persona: Some(request.persona.clone()),
        content: text,
        expression: request.expression.clone(),
        created_at: at,
        status: "complete".into(),
    };
    if store::current_user(db)?.is_none() {
        if !runtime
            .unnamed_lines
            .iter()
            .any(|item| item.message.id == message.id)
        {
            let actor = characters::guests::actor(state, db, &request.persona)?;
            runtime.unnamed_lines.push(store::BufferedStoryLine {
                message,
                line,
                actor,
            });
        }
    } else {
        let actor = characters::guests::actor(state, db, &request.persona)?;
        store::insert_message_with_actor(db, &message, "tutorial", false, &line, &actor)?;
        store::mark_message_displayed_with_provenance(
            db,
            &message.id,
            at,
            Some(state.automatic.load(std::sync::atomic::Ordering::SeqCst)),
        )?;
    }
    Ok(())
}

pub(crate) fn answer_choice(
    state: &AppState,
    request_id: &str,
    choice_id: &str,
) -> Result<bool, String> {
    let _action = lock(&state.action)?;
    let db = lock(&state.db)?;
    let mut runtime = lock(&state.pack_stories)?;
    let Some(run) = runtime.run.clone() else {
        return Ok(false);
    };
    if state.epoch.load(std::sync::atomic::Ordering::SeqCst) != run.epoch
        || !scene_events::available_locked(state, &db, &run)?
        || !pack_stories::current(&db, &run)?
    {
        return Ok(false);
    }
    let displayed = lock(&state.story)?
        .as_ref()
        .filter(|request| request.id == request_id)
        .and_then(|request| request.display_started_at);
    let Some(displayed) = displayed else {
        return Ok(false);
    };
    let Some(interaction) = runtime.interaction.as_mut().filter(|item| {
        item.run_id == run.run_id
            && item.epoch == run.epoch
            && item.generation == run.phase_generation
            && item.request_id == request_id
            && item.answer.is_none()
    }) else {
        return Ok(false);
    };
    if !interaction
        .choices
        .as_ref()
        .is_some_and(|ids| ids.iter().any(|id| id == choice_id))
    {
        return Err("선택지를 확인해 주세요.".into());
    }
    if store::current_user(&db)?.is_some() {
        pack_stories::resume::save_chapter(
            &db,
            &run,
            run.chapter_id.as_deref().ok_or("이야기의 장이 없어요.")?,
            displayed,
        )?;
    }
    interaction.answer = Some(choice_id.into());
    *lock(&state.story)? = None;
    Ok(true)
}

pub(crate) fn answer_text(
    state: &AppState,
    target: &str,
    content: &str,
    message_id: &str,
    request_id: &str,
) -> Result<bool, String> {
    let _action = lock(&state.action)?;
    let db = lock(&state.db)?;
    let mut runtime = lock(&state.pack_stories)?;
    let Some(run) = runtime.run.clone() else {
        return Ok(false);
    };
    if state.epoch.load(std::sync::atomic::Ordering::SeqCst) != run.epoch
        || !scene_events::available_locked(state, &db, &run)?
        || !pack_stories::current(&db, &run)?
    {
        return Ok(false);
    }
    let actor = characters::guests::actor(state, &db, target).ok();
    let actual_target = actor.as_ref().map(|actor| actor.id.as_str());
    let Some(interaction) = runtime.interaction.as_mut().filter(|item| {
        item.run_id == run.run_id
            && item.epoch == run.epoch
            && item.generation == run.phase_generation
            && item.request_id == request_id
            && actual_target == Some(item.persona.as_str())
            && item.choices.is_none()
            && item.answer.is_none()
    }) else {
        return Ok(false);
    };
    if content
        .chars()
        .any(|c| matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}'))
    {
        return Err("답변은 한 줄로 입력해 주세요.".into());
    }
    let content = content.trim();
    if content.is_empty() || content.chars().count() > 200 {
        return Err("답변은 1~200자로 입력해 주세요.".into());
    }
    let exists: bool = db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM messages WHERE id=?1)",
            [message_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if exists {
        return Err("이미 처리된 입력이에요.".into());
    }
    if !lock(&state.panel)?
        .as_ref()
        .is_some_and(|panel| panel.mode == "input" && panel.persona == interaction.persona)
    {
        return Ok(false);
    }
    interaction.answer = Some(content.into());
    *lock(&state.panel)? = None;
    *lock(&state.playback)? = None;
    Ok(true)
}

async fn execute(
    app: &tauri::AppHandle,
    state: &Arc<AppState>,
    mut run: RunTicket,
    cancel: Arc<AtomicBool>,
    resumed: Option<String>,
) -> Result<(), String> {
    let mut name =
        store::current_user(&*lock(&state.db)?)?.map_or_else(String::new, |user| user.name);
    let mut answers = BTreeMap::new();
    let mut chapter_saved = false;
    if let Some(title) = resumed {
        let expression = {
            let db = lock(&state.db)?;
            let actor = characters::get(&db, &run.scope.center_id)?;
            if actor.definition.expressions.contains_key("기쁨") {
                "기쁨".into()
            } else {
                actor
                    .definition
                    .expressions
                    .keys()
                    .next()
                    .cloned()
                    .ok_or("친구의 표정을 찾을 수 없어요.")?
            }
        };
        let line = SceneLine {
            persona: run.scope.center_id.clone(),
            expression,
            text: format!("좋아, {title}부터 할게."),
            widget: None,
            motion: Default::default(),
        };
        if !show_line(
            app,
            state,
            &run,
            cancel.clone(),
            (line, None),
            "tutorial",
            (false, false),
        )
        .await?
        {
            return Ok(());
        }
    }
    loop {
        if !is_current(state, run.epoch, &cancel) || !scene_events::available(state, &run)? {
            return Ok(());
        }
        let (step, title) = chapter_step(&run)?;
        if !checkpoint_before_step(state, &run, &cancel, &step, &mut chapter_saved)? {
            return Ok(());
        }
        let source = if run
            .definition
            .as_ref()
            .is_some_and(|d| d.purpose == pack_stories::ScenarioPurpose::Tutorial)
        {
            "tutorial"
        } else {
            "scenario"
        };
        let mut target = next_target(&run)?;
        match step {
            StoryStep::Line {
                persona,
                expression,
                text,
                motion,
            } => {
                let persona = local_persona(&*lock(&state.db)?, &run, &persona)?;
                let line = SceneLine {
                    persona,
                    expression,
                    text: render(&text, &name, &answers),
                    widget: None,
                    motion,
                };
                if !show_line(
                    app,
                    state,
                    &run,
                    cancel.clone(),
                    (line, render_record(&text, &name, &answers)),
                    source,
                    (!chapter_saved, false),
                )
                .await?
                {
                    return Ok(());
                }
                chapter_saved = true;
            }
            StoryStep::Move { persona, enter } => {
                let persona = local_persona(&*lock(&state.db)?, &run, &persona)?;
                if !characters::life::wandering::scene_entry(
                    app,
                    state,
                    &run,
                    &persona,
                    &enter,
                    cancel.clone(),
                )
                .await?
                {
                    return Ok(());
                }
            }
            StoryStep::Ask {
                id,
                persona,
                expression,
                prompt,
                input,
                known,
                saved,
                motion,
            } => {
                let persona = local_persona(&*lock(&state.db)?, &run, &persona)?;
                let needs_name = input == StoryInput::Name && name.is_empty();
                let text = if input == StoryInput::Name && !needs_name {
                    known.ok_or("이름 대사를 찾을 수 없어요.")?
                } else {
                    prompt
                };
                let line = SceneLine {
                    persona: persona.clone(),
                    expression,
                    text: render(&text, &name, &answers),
                    widget: None,
                    motion,
                };
                if !show_line(
                    app,
                    state,
                    &run,
                    cancel.clone(),
                    (line, render_record(&text, &name, &answers)),
                    source,
                    (!chapter_saved, input == StoryInput::Text || needs_name),
                )
                .await?
                {
                    return Ok(());
                }
                chapter_saved = true;
                if input == StoryInput::Text || needs_name {
                    {
                        let _action = lock(&state.action)?;
                        let db = lock(&state.db)?;
                        if !is_current(state, run.epoch, &cancel)
                            || !scene_events::available_locked(state, &db, &run)?
                            || !pack_stories::current(&db, &run)?
                        {
                            return Ok(());
                        }
                        let mut runtime = lock(&state.pack_stories)?;
                        if !runtime
                            .run
                            .as_ref()
                            .is_some_and(|active| matches_run(active, &run))
                        {
                            return Ok(());
                        }
                        runtime.interaction = Some(SceneInteraction {
                            run_id: run.run_id.clone(),
                            epoch: run.epoch,
                            generation: run.phase_generation,
                            request_id: uuid::Uuid::new_v4().to_string(),
                            persona: persona.clone(),
                            choices: None,
                            answer: None,
                        });
                        *lock(&state.panel)? = Some(PanelState {
                            persona: persona.clone(),
                            mode: if needs_name { "name" } else { "input" }.into(),
                        });
                        lock(&state.runtime)?.phase = RuntimePhase::Waiting;
                    }
                    publish(app, state);
                    loop {
                        if !is_current(state, run.epoch, &cancel)
                            || !scene_events::available(state, &run)?
                        {
                            return Ok(());
                        }
                        if let Some(answer) = take_answer(state, &run)? {
                            if needs_name {
                                name = answer.clone();
                            }
                            answers.insert(id, answer);
                            break;
                        }
                        tokio::select! { _ = models::cancelled(cancel.clone()) => return Ok(()), _ = tokio::time::sleep(Duration::from_millis(50)) => {} }
                    }
                    if let Some(line) = saved_name_line(saved, needs_name, persona, &name, &answers)
                    {
                        if !show_line(
                            app,
                            state,
                            &run,
                            cancel.clone(),
                            line,
                            source,
                            (false, false),
                        )
                        .await?
                        {
                            return Ok(());
                        }
                    }
                }
            }
            StoryStep::Choice {
                persona,
                expression,
                prompt,
                options,
                motion,
            } => {
                let persona = local_persona(&*lock(&state.db)?, &run, &persona)?;
                let request_id = format!("scene-choice:{}:{}", run.run_id, run.phase_generation);
                let choices = options
                    .iter()
                    .map(|option| story::Choice {
                        id: option.id.clone(),
                        label: render(&option.label, &name, &answers),
                    })
                    .collect();
                {
                    let _action = lock(&state.action)?;
                    let db = lock(&state.db)?;
                    if !scene_events::available_locked(state, &db, &run)? {
                        return Ok(());
                    }
                    let mut runtime = lock(&state.pack_stories)?;
                    if !runtime
                        .run
                        .as_ref()
                        .is_some_and(|active| matches_run(active, &run))
                    {
                        return Ok(());
                    }
                    runtime.choice_recorded_text = Some(
                        render_record(&prompt, &name, &answers)
                            .unwrap_or_else(|| render(&prompt, &name, &answers)),
                    );
                    runtime.interaction = Some(SceneInteraction {
                        run_id: run.run_id.clone(),
                        epoch: run.epoch,
                        generation: run.phase_generation,
                        request_id: request_id.clone(),
                        persona: persona.clone(),
                        choices: Some(options.iter().map(|o| o.id.clone()).collect()),
                        answer: None,
                    });
                    *lock(&state.story)? = Some(story::Request {
                        id: request_id,
                        display_started_at: None,
                        persona: persona.clone(),
                        expression: Some(expression),
                        motion: Some(motion),
                        title,
                        prompt: render(&prompt, &name, &answers),
                        choices,
                        character_id: persona,
                        user_id: run.scope.user_id.clone(),
                        scene: story::Scene {
                            id: String::new(),
                            chapter: 0,
                            title: String::new(),
                            prompt: String::new(),
                            choices: vec![],
                        },
                        epoch: run.epoch,
                    });
                    lock(&state.runtime)?.phase = RuntimePhase::Story;
                }
                publish(app, state);
                loop {
                    if !is_current(state, run.epoch, &cancel)
                        || !scene_events::available(state, &run)?
                    {
                        return Ok(());
                    }
                    if !chapter_saved {
                        let _action = lock(&state.action)?;
                        let displayed = lock(&state.story)?
                            .as_ref()
                            .and_then(|request| request.display_started_at);
                        if let Some(at) = displayed {
                            let db = lock(&state.db)?;
                            if !scene_events::available_locked(state, &db, &run)? {
                                return Ok(());
                            }
                            if store::current_user(&db)?.is_some()
                                && lock(&state.pack_stories)?
                                    .run
                                    .as_ref()
                                    .is_some_and(|active| matches_run(active, &run))
                            {
                                pack_stories::resume::save_chapter(
                                    &db,
                                    &run,
                                    run.chapter_id.as_deref().ok_or("이야기의 장이 없어요.")?,
                                    at,
                                )?;
                                chapter_saved = true;
                            }
                        }
                    }
                    if let Some(answer) = take_answer(state, &run)? {
                        target = options
                            .iter()
                            .find(|o| o.id == answer)
                            .ok_or("선택지를 찾을 수 없어요.")?
                            .goto
                            .clone();
                        break;
                    }
                    tokio::select! { _ = models::cancelled(cancel.clone()) => return Ok(()), _ = tokio::time::sleep(Duration::from_millis(50)) => {} }
                }
            }
            StoryStep::Action { action } => {
                if !scene_events::execute_action(app, state, &run, &cancel, &action).await? {
                    return Ok(());
                }
            }
            StoryStep::Wait {
                event,
                timeout_sec,
                cancel_on,
                on_timeout,
            } => {
                if !scene_events::begin_wait(state, &run, &event, &cancel_on)? {
                    return Ok(());
                }
                let deadline =
                    tokio::time::Instant::now() + Duration::from_secs(u64::from(timeout_sec));
                let outcome = wait_for_event(state, &run, cancel.clone(), deadline).await?;
                let saved = AtomicBool::new(chapter_saved);
                let next = follow_wait(outcome, on_timeout, |timeout_step| {
                    let run = &run;
                    let cancel = &cancel;
                    let name = &name;
                    let answers = &answers;
                    let saved = &saved;
                    async move {
                        match timeout_step {
                            StoryStep::Line {
                                persona,
                                expression,
                                text,
                                motion,
                            } => {
                                let persona = local_persona(&*lock(&state.db)?, run, &persona)?;
                                if !show_line(
                                    app,
                                    state,
                                    run,
                                    cancel.clone(),
                                    (
                                        SceneLine {
                                            persona,
                                            expression,
                                            text: render(&text, name, answers),
                                            widget: None,
                                            motion,
                                        },
                                        render_record(&text, name, answers),
                                    ),
                                    source,
                                    (!saved.load(std::sync::atomic::Ordering::Relaxed), false),
                                )
                                .await?
                                {
                                    return Ok(false);
                                }
                                saved.store(true, std::sync::atomic::Ordering::Relaxed);
                            }
                            StoryStep::Action { action } => {
                                if !scene_events::execute_action(app, state, run, cancel, &action)
                                    .await?
                                {
                                    return Ok(false);
                                }
                            }
                            _ => return Err("시간 초과 단계를 확인해 주세요.".into()),
                        }
                        Ok(true)
                    }
                })
                .await?;
                let Some(next) = next else {
                    return Ok(());
                };
                chapter_saved = saved.load(std::sync::atomic::Ordering::Relaxed);
                target = next;
            }
        }
        if target == "next" {
            target = next_target(&run)?;
        }
        let previous_chapter = run.chapter_id.clone();
        let Some(next) = advance(state, &run, &target)? else {
            return Ok(());
        };
        run = next;
        if run.chapter_id != previous_chapter {
            answers.clear();
            chapter_saved = false;
        }
    }
}

pub(super) fn cleanup(state: &AppState, run: &RunTicket) -> bool {
    let mut blocked = false;
    if let Ok(_action) = lock(&state.action) {
        if let Ok(db) = lock(&state.db) {
            blocked = matches!(scene_events::available_locked(state, &db, run), Ok(false));
            if let Ok(mut runtime) = lock(&state.pack_stories) {
                if runtime
                    .run
                    .as_ref()
                    .is_some_and(|active| active.run_id == run.run_id && active.epoch == run.epoch)
                {
                    if pack_stories::cancel_with_progress(&db, &mut runtime).is_err() {
                        pack_stories::cancel_deferred(&mut runtime);
                    }
                    runtime.interaction = None;
                    if let Ok(mut playback) = lock(&state.playback) {
                        if playback.as_ref().is_some_and(|line| {
                            line.id.starts_with(&format!("scene-story:{}:", run.run_id))
                        }) {
                            *playback = None;
                        }
                    }
                    let _ = characters::guests::leave_run_locked(state, &run.run_id);
                }
            }
            let _ = scene_events::clear_run(state, &db, &run.run_id);
        }
    }
    blocked
}

pub(crate) async fn run_automatic(
    app: &tauri::AppHandle,
    state: &Arc<AppState>,
    run: RunTicket,
    cancel: Arc<AtomicBool>,
) -> Result<(), String> {
    let result = execute(app, state, run.clone(), cancel, None).await;
    cleanup(state, &run);
    result
}

fn spawn(
    app: tauri::AppHandle,
    state: Arc<AppState>,
    run: RunTicket,
    cancel: Arc<AtomicBool>,
    resumed: Option<String>,
) {
    let epoch = run.epoch;
    let owner = state.clone();
    let owner_app = app.clone();
    let _ = super::super::tasks::spawn(
        owner_app,
        owner,
        super::super::tasks::Kind::Scene,
        epoch,
        async move {
            let gate = super::super::tasks::acquire_gate(&state, epoch, cancel.clone()).await;
            let result = if gate.is_some() {
                execute(&app, &state, run.clone(), cancel.clone(), resumed).await
            } else {
                Ok(())
            };
            let blocked = cleanup(&state, &run);
            drop(gate);
            crate::widgets::commands::publish_widgets(&app, &state);
            if is_current(&state, epoch, &cancel) {
                phase(
                    &app,
                    &state,
                    epoch,
                    if result.is_err() && !blocked {
                        RuntimePhase::Error
                    } else {
                        RuntimePhase::Idle
                    },
                    None,
                    if blocked { None } else { result.err() },
                );
            }
        },
    );
}

pub(crate) fn start(
    app: tauri::AppHandle,
    state: Arc<AppState>,
    run: RunTicket,
    cancel: Arc<AtomicBool>,
) {
    spawn(app, state, run, cancel, None);
}
pub(crate) fn start_resume(
    app: tauri::AppHandle,
    state: Arc<AppState>,
    run: RunTicket,
    cancel: Arc<AtomicBool>,
    chapter_title: String,
) {
    spawn(app, state, run, cancel, Some(chapter_title));
}
