use super::{conversation, conversation::scene_story, lock, phase, publish, tasks, AppState};
use crate::{
    characters, pack_stories, store,
    types::{RuntimePhase, SceneLine},
};
use std::sync::{atomic::Ordering, Arc};

pub(crate) fn clear_failed_start(
    state: &AppState,
    db: &rusqlite::Connection,
    run_id: &str,
    epoch: u64,
    error: &str,
) {
    if state.epoch.load(Ordering::SeqCst) != epoch {
        return;
    }
    if let Ok(mut runtime) = lock(&state.pack_stories) {
        if runtime.run.as_ref().is_some_and(|run| run.run_id == run_id) {
            if pack_stories::cancel_with_progress(db, &mut runtime).is_err() {
                pack_stories::cancel_deferred(&mut runtime);
            }
            runtime.interaction = None;
        }
    }
    let _ = super::scene_events::clear_run(state, db, run_id);
    let _ = characters::guests::leave_run_locked(state, run_id);
    if let Ok(mut tasks) = lock(&state.tasks) {
        if tasks
            .active
            .is_some_and(|(_, active_epoch)| active_epoch == epoch)
        {
            tasks.active = None;
            tasks.conversation = None;
            tasks.participants = None;
            tasks.pack_replay = None;
        }
    }
    if let Ok(active) = lock(&state.cancellation) {
        if let Some(cancel) = active.as_ref() {
            cancel.store(true, Ordering::SeqCst);
        }
    }
    state.nlp.pause_indexing(false);
    if let Ok(mut status) = lock(&state.runtime) {
        status.phase = RuntimePhase::Error;
        status.persona = None;
        status.error = Some(error.into());
    }
}

pub(crate) fn choose(
    app: tauri::AppHandle,
    state: Arc<AppState>,
    request_id: &str,
    choice_id: &str,
) -> Result<(), String> {
    if !matches!(choice_id, "resume" | "decline") {
        return Err("선택지를 확인해 주세요.".into());
    }
    let result = (|| -> Result<_, String> {
        let _action = lock(&state.action)?;
        let request = lock(&state.story)?
            .as_ref()
            .filter(|request| {
                request.id == request_id
                    && request.display_started_at.is_some()
                    && request.epoch == state.epoch.load(Ordering::SeqCst)
            })
            .cloned()
            .ok_or("이미 지나간 이야기예요.")?;
        let (pending_id, scope, point) = lock(&state.pack_stories)?
            .pending_resume
            .clone()
            .filter(|(id, _, _)| id == request_id)
            .ok_or("이미 지나간 이야기예요.")?;
        if pending_id != request.id
            || request.persona != scope.center_id
            || lock(&state.pack_stories)?.run.is_some()
        {
            return Err("이미 지나간 이야기예요.".into());
        }
        let db = lock(&state.db)?;
        crate::story::host::ensure_request_available(&state, &db)?;
        if request.user_id != scope.user_id
            || !pack_stories::resume::load_for_scope(&db, &scope)?.contains(&point)
        {
            return Err("이미 지나간 이야기예요.".into());
        }
        let resolved = pack_stories::resume::resolve(&db, &scope, &point)?
            .ok_or("이어갈 이야기를 찾을 수 없어요.")?;
        if choice_id == "decline" {
            let line = if resolved.definition.purpose == pack_stories::ScenarioPurpose::Tutorial {
                Some(decline_line(&db, &scope.center_id)?)
            } else {
                None
            };
            if !pack_stories::resume::decline(&db, &scope, &point)? {
                return Err("이미 지나간 이야기예요.".into());
            }
            let (epoch, cancel) = super::interrupt_with_db(&state, false, &db)?;
            let playback = if let Some(line) = line {
                let prefix = uuid::Uuid::new_v4().to_string();
                lock(&state.tasks)?.pack_replay = Some(prefix.clone());
                Some((cancel, line, prefix))
            } else {
                None
            };
            lock(&state.pack_stories)?.pending_resume = None;
            state.last_input.store(super::now(), Ordering::SeqCst);
            super::schedule_idle(&state, store::settings(&db)?.idle_minutes);
            Ok((epoch, None, playback))
        } else {
            let context = pack_stories::InputContext {
                input_id: uuid::Uuid::new_v4().to_string(),
                user_id: scope.user_id.clone(),
                targets: vec![scope.center_id.clone()],
                epoch: request.epoch,
            };
            let plan = pack_stories::scene_plan(
                &db,
                &context,
                scope,
                resolved.definition,
                Some(&resolved.chapter_id),
            )?;
            let (epoch, cancel) = tasks::reserve(&state, tasks::Kind::Scene, false)?;
            let prepared = (|| {
                let admitted = conversation::bind_pack_plan_locked(&state, &db, &plan, epoch)?;
                let run = lock(&state.pack_stories)?
                    .run
                    .clone()
                    .ok_or("이야기 실행을 시작하지 못했어요.")?;
                pack_stories::resume::record_accepted(&db, &run)?;
                super::scene_events::mark_resumed_locked(&state, &run)?;
                Ok::<_, String>((run, admitted))
            })();
            let (run, admitted) = match prepared {
                Ok(prepared) => prepared,
                Err(error) => {
                    clear_failed_start(&state, &db, &plan.run_id, epoch, &error);
                    return Err(error);
                }
            };
            lock(&state.pack_stories)?.pending_resume = None;
            state.last_input.store(super::now(), Ordering::SeqCst);
            Ok((
                epoch,
                Some((run, cancel, admitted, resolved.chapter_title)),
                None,
            ))
        }
    })();
    let prepared = match result {
        Ok(prepared) => prepared,
        Err(error) => {
            publish(&app, &state);
            return Err(error);
        }
    };
    if let Some((run, cancel, admitted, chapter_title)) = prepared.1 {
        if !admitted.is_empty() {
            if let Err(error) = characters::guests::create_admitted(&app, &state, &admitted) {
                {
                    let _action = lock(&state.action)?;
                    let db = lock(&state.db)?;
                    clear_failed_start(&state, &db, &run.run_id, run.epoch, &error);
                }
                publish(&app, &state);
                return Err(error);
            }
        }
        scene_story::start_resume(app, state, run, cancel, chapter_title);
    } else if let Some((cancel, line, prefix)) = prepared.2 {
        let epoch = prepared.0;
        phase(&app, &state, epoch, RuntimePhase::Playing, None, None);
        let owner = state.clone();
        let owner_app = app.clone();
        tasks::spawn(owner_app, owner, tasks::Kind::Scene, epoch, async move {
            let Some(_gate) = tasks::acquire_gate(&state, epoch, cancel.clone()).await else {
                return;
            };
            let result = super::scene::run_scene(
                &app,
                &state,
                &[line],
                "tutorial",
                &prefix,
                false,
                epoch,
                cancel.clone(),
            )
            .await;
            if super::is_current(&state, epoch, &cancel) {
                phase(&app, &state, epoch, RuntimePhase::Idle, None, result.err());
            }
        })?;
    } else {
        phase(&app, &state, prepared.0, RuntimePhase::Idle, None, None);
        publish(&app, &state);
    }
    Ok(())
}

fn decline_line(db: &rusqlite::Connection, center_id: &str) -> Result<SceneLine, String> {
    let actor = characters::get(db, center_id)?;
    let expression = if actor.definition.expressions.contains_key("평온") {
        "평온".into()
    } else {
        actor
            .definition
            .expressions
            .keys()
            .next()
            .cloned()
            .ok_or("친구의 표정을 찾을 수 없어요.")?
    };
    Ok(SceneLine {
        persona: center_id.into(),
        expression,
        text: "알겠어. 설정 → 일반 → 안내서에서 언제든 다시 볼 수 있어.".into(),
        widget: None,
        motion: Default::default(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicBool;

    #[test]
    fn decline_line_can_be_presented_and_recorded_without_an_active_run() {
        let state = super::super::tests::state();
        let line = {
            let db = lock(&state.db).unwrap();
            store::set_user_name(&db, "친구", 1000).unwrap();
            let center = characters::active_ids(&db).unwrap().remove(0);
            decline_line(&db, &center).unwrap()
        };
        lock(&state.tasks).unwrap().pack_replay = Some("decline".into());
        let revision = store::revision(&lock(&state.db).unwrap()).unwrap();
        assert!(super::super::scene::present_line(
            &state,
            &line,
            "tutorial",
            "scene:decline:0",
            0,
            1,
            revision,
            0,
            &AtomicBool::new(false),
            false,
        )
        .unwrap());
        let db = lock(&state.db).unwrap();
        let (source, text): (String, String) = db.query_row(
            "SELECT c.source,json_extract(m.data,'$.content') FROM message_context c JOIN messages m ON m.id=c.message_id WHERE m.id='scene:decline:0'",
            [], |row| Ok((row.get(0)?, row.get(1)?)),
        ).unwrap();
        assert_eq!(source, "tutorial");
        assert_eq!(
            text,
            "알겠어. 설정 → 일반 → 안내서에서 언제든 다시 볼 수 있어."
        );
    }
}
