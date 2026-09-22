use super::{interrupt, is_current, lock, publish, unavailable, AppState};
use crate::types::RuntimePhase;
use futures_util::FutureExt;
use std::{
    future::Future,
    panic::AssertUnwindSafe,
    sync::{atomic::AtomicBool, Arc},
    time::Duration,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Kind {
    Conversation,
    Scene,
    Background,
    ModelTest,
    Maintenance,
}

#[derive(Default)]
pub(crate) struct Registry {
    pub(crate) active: Option<(Kind, u64)>,
    handles: Vec<(Kind, tauri::async_runtime::JoinHandle<()>)>,
}

// Called while action is held, so reservation and cancellation are one transition.
pub(crate) fn reserve(
    state: &AppState,
    kind: Kind,
    automatic: bool,
) -> Result<(u64, Arc<AtomicBool>), String> {
    if unavailable(state) {
        return Err("앱을 정리하고 있어요.".into());
    }
    let token = interrupt(state, automatic)?;
    state.nlp.pause_indexing(true);
    lock(&state.tasks)?.active = Some((kind, token.0));
    let mut status = lock(&state.runtime)?;
    status.phase = RuntimePhase::Loading;
    status.persona = None;
    status.error = None;
    Ok(token)
}

pub(crate) fn model_test_running(state: &AppState) -> Result<bool, String> {
    let tasks = lock(&state.tasks)?;
    Ok(tasks
        .active
        .is_some_and(|(kind, _)| kind == Kind::ModelTest)
        || tasks
            .handles
            .iter()
            .any(|(kind, handle)| *kind == Kind::ModelTest && !handle.inner().is_finished()))
}

pub(crate) fn spawn(
    app: tauri::AppHandle,
    state: Arc<AppState>,
    kind: Kind,
    epoch: u64,
    future: impl Future<Output = ()> + Send + 'static,
) -> Result<(), String> {
    let _action = lock(&state.action)?;
    if unavailable(&state) || state.epoch.load(std::sync::atomic::Ordering::SeqCst) != epoch {
        return Ok(());
    }
    state.nlp.pause_indexing(true);
    lock(&state.tasks)?.active = Some((kind, epoch));
    // start_scene also receives tokens from widget/story callers; reserve their busy
    // state here, before the new future can be polled.
    {
        let mut runtime = lock(&state.runtime)?;
        if matches!(runtime.phase, RuntimePhase::Idle | RuntimePhase::Error) {
            runtime.phase = RuntimePhase::Loading;
        }
    }
    let owner = state.clone();
    let handle = tauri::async_runtime::spawn(async move {
        let panicked = AssertUnwindSafe(future).catch_unwind().await.is_err();
        let changed = complete(&owner, kind, epoch, panicked).unwrap_or(false);
        if changed {
            publish(&app, &owner);
        }
    });
    lock(&state.tasks)?.handles.push((kind, handle));
    Ok(())
}

fn complete(state: &AppState, kind: Kind, epoch: u64, panicked: bool) -> Result<bool, String> {
    let _action = lock(&state.action)?;
    if state.epoch.load(std::sync::atomic::Ordering::SeqCst) != epoch {
        return Ok(false);
    }
    let mut tasks = lock(&state.tasks)?;
    if tasks.active != Some((kind, epoch)) {
        return Ok(false);
    }
    tasks.active = None;
    if panicked {
        state.nlp.pause_indexing(false);
        let mut status = lock(&state.runtime)?;
        status.phase = RuntimePhase::Error;
        status.error = Some("작업이 중단됐어요. 다시 시도해 주세요.".into());
        *lock(&state.playback)? = None;
    }
    Ok(panicked)
}

// Only one maintenance operation may run. Native geometry and NLP do not own gate.
pub(crate) fn spawn_maintenance(
    state: &Arc<AppState>,
    future: impl Future<Output = ()> + Send + 'static,
) -> Result<(), String> {
    let _action = lock(&state.action)?;
    let mut tasks = lock(&state.tasks)?;
    if unavailable(state)
        || tasks
            .handles
            .iter()
            .any(|(kind, handle)| *kind == Kind::Maintenance && !handle.inner().is_finished())
    {
        return Ok(());
    }
    tasks.handles.push((
        Kind::Maintenance,
        tauri::async_runtime::spawn(async move {
            let _ = AssertUnwindSafe(future).catch_unwind().await;
        }),
    ));
    Ok(())
}

pub(crate) async fn reap(state: &AppState) {
    let finished = if let Ok(mut tasks) = lock(&state.tasks) {
        let mut finished = Vec::new();
        let mut index = 0;
        while index < tasks.handles.len() {
            if tasks.handles[index].1.inner().is_finished() {
                finished.push(tasks.handles.swap_remove(index).1);
            } else {
                index += 1;
            }
        }
        finished
    } else {
        Vec::new()
    };
    for handle in finished {
        let _ = handle.await;
    }
}

pub(crate) async fn shutdown(state: &AppState) {
    shutdown_at(state, tokio::time::Instant::now() + Duration::from_secs(5)).await;
}

async fn shutdown_at(state: &AppState, deadline: tokio::time::Instant) {
    let handles = lock(&state.tasks)
        .map(|mut tasks| std::mem::take(&mut tasks.handles))
        .unwrap_or_default();
    for (_, mut handle) in handles {
        if tokio::time::timeout_at(deadline, &mut handle)
            .await
            .is_err()
        {
            handle.abort();
            let _ = handle.await;
        }
    }
}

pub(crate) async fn acquire_gate(
    state: &AppState,
    epoch: u64,
    cancel: Arc<AtomicBool>,
) -> Option<tokio::sync::MutexGuard<'_, ()>> {
    tokio::select! {
        _ = crate::models::cancelled(cancel.clone()) => None,
        guard = state.gate.lock() => is_current(state, epoch, &cancel).then_some(guard),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn a_panicking_previous_job_cannot_clear_the_new_reservation() {
        let state = crate::app::tests::state();
        let old = {
            let _action = lock(&state.action).unwrap();
            reserve(&state, Kind::Background, true).unwrap()
        };
        let new = {
            let _action = lock(&state.action).unwrap();
            reserve(&state, Kind::Conversation, false).unwrap()
        };
        assert!(!complete(&state, Kind::Background, old.0, true).unwrap());
        assert_eq!(
            lock(&state.tasks).unwrap().active,
            Some((Kind::Conversation, new.0))
        );
        assert_eq!(lock(&state.runtime).unwrap().phase, RuntimePhase::Loading);
        assert!(complete(&state, Kind::Conversation, new.0, true).unwrap());
        assert!(lock(&state.tasks).unwrap().active.is_none());
        assert_eq!(lock(&state.runtime).unwrap().phase, RuntimePhase::Error);
    }

    #[tokio::test]
    async fn slow_native_maintenance_is_single_and_reaped_at_shutdown_deadline() {
        struct Dropped(Arc<AtomicUsize>);
        impl Drop for Dropped {
            fn drop(&mut self) {
                self.0.fetch_add(1, Ordering::SeqCst);
            }
        }
        let state = Arc::new(crate::app::tests::state());
        let dropped = Arc::new(AtomicUsize::new(0));
        let marker = Dropped(dropped.clone());
        let (started, ready) = tokio::sync::oneshot::channel();
        spawn_maintenance(&state, async move {
            let _marker = marker;
            let _ = started.send(());
            std::future::pending::<()>().await;
        })
        .unwrap();
        ready.await.unwrap();
        spawn_maintenance(&state, async {
            panic!("maintenance must not overlap");
        })
        .unwrap();
        assert_eq!(lock(&state.tasks).unwrap().handles.len(), 1);
        shutdown_at(
            &state,
            tokio::time::Instant::now() + Duration::from_millis(30),
        )
        .await;
        assert_eq!(dropped.load(Ordering::SeqCst), 1);
        assert!(lock(&state.tasks).unwrap().handles.is_empty());
    }
}
