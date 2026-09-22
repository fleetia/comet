use super::*;
use protocol::{Ready, Request, Response, EMBEDDING_DIMENSIONS, MAX_LINE_BYTES, PROTOCOL_VERSION};
use std::{process::Stdio, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout},
};

struct Worker {
    child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
    epoch: u64,
    kiwi: Option<String>,
    semantic: Option<String>,
    sequence: u64,
}
impl Worker {
    async fn stop(mut self) -> Result<(), String> {
        self.child
            .start_kill()
            .map_err(|_| "검색 실행기를 중지하지 못했어요.")?;
        tokio::time::timeout(Duration::from_secs(4), self.child.wait())
            .await
            .map_err(|_| "검색 실행기 종료 시간이 초과됐어요.")?
            .map_err(|_| "검색 실행기를 회수하지 못했어요.")?;
        Ok(())
    }
    async fn exchange(&mut self, operation: Operation, text: String) -> Result<Analysis, String> {
        self.sequence += 1;
        let request = Request {
            version: PROTOCOL_VERSION,
            id: self.sequence,
            operation,
            text,
        };
        let mut json = serde_json::to_vec(&request).map_err(|_| "nlp_protocol_error")?;
        json.push(b'\n');
        self.input
            .write_all(&json)
            .await
            .map_err(|_| "nlp_process_closed")?;
        self.input.flush().await.map_err(|_| "nlp_process_closed")?;
        let line = read_line(&mut self.output).await?;
        let response: Response = serde_json::from_slice(&line).map_err(|_| "nlp_protocol_error")?;
        if response.id != request.id || response.version != PROTOCOL_VERSION {
            return Err("nlp_protocol_error".into());
        }
        let mut result = response.result.ok_or("nlp_analysis_failed")?;
        if response.error.is_some() || !valid_result(&request.text, &result) {
            return Err("nlp_invalid_result".into());
        }
        result.kiwi_profile = result
            .kiwi_error
            .is_none()
            .then(|| self.kiwi.clone())
            .flatten();
        result.semantic_profile = result
            .semantic_error
            .is_none()
            .then(|| self.semantic.clone())
            .flatten();
        Ok(result)
    }
}
async fn terminate(shared: &Shared, worker: Worker) {
    if let Err(error) = worker.stop().await {
        *locked(&shared.stop_error) = Some(error);
    }
}

async fn read_line(output: &mut BufReader<ChildStdout>) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    output
        .take((MAX_LINE_BYTES + 1) as u64)
        .read_until(b'\n', &mut bytes)
        .await
        .map_err(|_| "nlp_process_closed")?;
    if bytes.len() > MAX_LINE_BYTES || bytes.last() != Some(&b'\n') {
        return Err("nlp_protocol_error".into());
    }
    Ok(bytes)
}
fn valid_result(text: &str, result: &Analysis) -> bool {
    let span = |a: usize, b: usize| {
        a <= b && b <= text.len() && text.is_char_boundary(a) && text.is_char_boundary(b)
    };
    result.tokens.len() <= 65536
        && result.tokens.iter().all(|t| span(t.start, t.end))
        && result.embeddings.len() <= 512
        && result.embeddings.iter().all(|e| {
            span(e.start, e.end)
                && e.vector.len() == EMBEDDING_DIMENSIONS
                && e.vector.iter().all(|v| v.is_finite())
                && (e.vector.iter().map(|v| v * v).sum::<f32>() - 1.0).abs() < 0.02
        })
}
async fn spawn(shared: &Arc<Shared>) -> Result<Option<Worker>, String> {
    let status = locked(&shared.status).clone();
    if !status.kiwi.installed && !status.semantic.installed
        || !status.kiwi.enabled && !status.semantic.enabled
    {
        return Ok(None);
    }
    let kiwi = (status.kiwi.enabled
        && !matches!(status.kiwi.state.as_str(), "removing" | "installing"))
    .then(|| status.kiwi.profile.clone())
    .flatten();
    let semantic = (status.semantic.enabled
        && !matches!(status.semantic.state.as_str(), "removing" | "installing"))
    .then(|| status.semantic.profile.clone())
    .flatten();
    if kiwi.is_none() && semantic.is_none() {
        return Ok(None);
    }
    let mut command = tokio::process::Command::new(&shared.executable);
    command
        .arg("--runtime")
        .arg(&shared.runtime)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    if kiwi.is_some() {
        command
            .arg("--kiwi")
            .arg(shared.root.join("kiwi/models/cong/base"));
    }
    if semantic.is_some() {
        command.arg("--semantic").arg(shared.root.join("semantic"));
    }
    #[cfg(windows)]
    {
        command.creation_flags(0x08000000);
        let inherited = std::env::var_os("PATH").unwrap_or_default();
        let path = std::env::join_paths(
            std::iter::once(shared.runtime.clone()).chain(std::env::split_paths(&inherited)),
        )
        .map_err(|_| "nlp_runtime_path_invalid")?;
        command.env("PATH", path);
    }
    let mut child = command.spawn().map_err(|_| "nlp_executable_unavailable")?;
    let input = child.stdin.take().ok_or("nlp_process_pipe_failed")?;
    let output = child.stdout.take().ok_or("nlp_process_pipe_failed")?;
    let mut worker = Worker {
        child,
        input,
        output: BufReader::new(output),
        epoch: shared.epoch.load(Ordering::Acquire),
        kiwi,
        semantic,
        sequence: 0,
    };
    {
        let mut state = locked(&shared.status);
        state.running = true;
        for kind in [ModelKind::Kiwi, ModelKind::Semantic] {
            let model = model_mut(&mut state, kind);
            if model.enabled && model.installed {
                model.state = "initializing".into();
                model.error = None;
            }
        }
    }
    let ready = tokio::select! {
        biased;
        _ = shared.interrupt.notified() => Err("nlp_cancelled".to_owned()),
        ready = tokio::time::timeout(Duration::from_secs(30), read_line(&mut worker.output)) => {
            ready.map_err(|_| "nlp_initialization_timeout".to_owned()).and_then(|r| r)
        }
    };
    let parsed = ready.and_then(|bytes| {
        serde_json::from_slice::<Ready>(&bytes).map_err(|_| "nlp_protocol_error".into())
    });
    let ready = match parsed {
        Ok(ready) if ready.version == PROTOCOL_VERSION && ready.ready => ready,
        Ok(_) => {
            terminate(shared, worker).await;
            return Err("nlp_initialization_failed".into());
        }
        Err(error) => {
            terminate(shared, worker).await;
            return Err(error);
        }
    };
    if worker.epoch != shared.epoch.load(Ordering::Acquire) {
        terminate(shared, worker).await;
        return Ok(None);
    }
    if !ready.kiwi {
        worker.kiwi = None;
    }
    if !ready.semantic {
        worker.semantic = None;
    }
    {
        let mut status = locked(&shared.status);
        for (kind, loaded) in [
            (ModelKind::Kiwi, ready.kiwi),
            (ModelKind::Semantic, ready.semantic),
        ] {
            let model = model_mut(&mut status, kind);
            if model.enabled && model.installed {
                model.state = if loaded { "ready" } else { "error" }.into();
                model.error = (!loaded)
                    .then(|| "검색 모델을 준비하지 못했어요. 기본 검색을 사용하고 있어요.".into());
            }
        }
        status.active_methods = vec!["lexical".into()];
        if ready.kiwi {
            status.active_methods.push("kiwi".into());
        }
        if ready.semantic && models::manifest(ModelKind::Semantic).threshold.is_some() {
            status.active_methods.push("semantic".into());
        }
    }
    Ok(Some(worker))
}
fn stopped(shared: &Shared, error: Option<&str>) {
    let mut status = locked(&shared.status);
    status.running = false;
    status.busy = false;
    status.active_methods = vec!["lexical".into()];
    for kind in [ModelKind::Kiwi, ModelKind::Semantic] {
        let model = model_mut(&mut status, kind);
        if model.installed
            && !matches!(
                model.state.as_str(),
                "downloading" | "removing" | "installing"
            )
        {
            model.state = if error.is_some() { "error" } else { "idle" }.into();
            model.error = error.map(|_| "검색 실행기가 중단되어 기본 검색을 사용하고 있어요. 60초 후 다시 준비할 수 있어요.".into());
        }
    }
    shared.work.store(0, Ordering::Release);
}
pub(super) async fn run(
    shared: Arc<Shared>,
    mut foreground: mpsc::Receiver<Command>,
    mut background: mpsc::Receiver<Command>,
    legacy: Vec<ModelKind>,
) {
    for kind in legacy {
        super::download::recover_legacy(&shared, kind).await;
    }
    let mut worker: Option<Worker> = None;
    let mut failed_at: Option<Instant> = None;
    loop {
        let command = tokio::select! { biased;
            _ = shared.interrupt.notified() => {
                if let Some(worker) = worker.take() { terminate(&shared, worker).await; }
                stopped(&shared, None); continue;
            }
            command = foreground.recv() => command,
            command = background.recv() => command,
        };
        let Some(command) = command else {
            break;
        };
        if let Command::Shutdown(reply) = command {
            if let Some(worker) = worker.take() {
                terminate(&shared, worker).await;
            }
            stopped(&shared, None);
            let _ = reply.send(());
            return;
        }
        if let Command::Stop(reply) = command {
            let result = if let Some(worker) = worker.take() {
                worker.stop().await
            } else {
                locked(&shared.stop_error).take().map_or(Ok(()), Err)
            };
            stopped(&shared, None);
            let _ = reply.send(result);
            continue;
        }
        if shared.closed.load(Ordering::Acquire) || shared.suspended.load(Ordering::Acquire) {
            continue;
        }
        if worker
            .as_ref()
            .is_some_and(|w| w.epoch != shared.epoch.load(Ordering::Acquire))
        {
            if let Some(worker) = worker.take() {
                terminate(&shared, worker).await;
            }
            stopped(&shared, None);
        }
        if matches!(command, Command::Warmup) {
            for kind in [ModelKind::Kiwi, ModelKind::Semantic] {
                let recovering = {
                    let mut status = locked(&shared.status);
                    let model = model_mut(&mut status, kind);
                    !model.installed && model.state == "initializing"
                };
                if recovering {
                    super::download::recover_legacy(&shared, kind).await;
                }
            }
        }
        if matches!(command, Command::Maintain) {
            let exited = worker
                .as_mut()
                .is_some_and(|worker| worker.child.try_wait().ok().flatten().is_some());
            if exited {
                worker.take();
                failed_at = Some(Instant::now());
                stopped(&shared, Some("nlp_process_exited"));
                continue;
            }
            if locked(&shared.last_used).elapsed() >= Duration::from_secs(120) {
                if let Some(worker) = worker.take() {
                    terminate(&shared, worker).await;
                }
                stopped(&shared, None);
            }
            continue;
        }
        if let Command::Work {
            epoch, ref reply, ..
        } = command
        {
            if epoch != shared.epoch.load(Ordering::Acquire) || reply.is_closed() {
                continue;
            }
        }
        *locked(&shared.last_used) = Instant::now();
        if worker.is_none() {
            // A cold request never waits for model loading. Its caller receives lexical fallback now.
            if let Command::Work { reply, .. } = command {
                let _ = reply.send(None);
            }
            if failed_at.is_some_and(|time| time.elapsed() < Duration::from_secs(60)) {
                continue;
            }
            match spawn(&shared).await {
                Ok(loaded) => {
                    *locked(&shared.last_used) = Instant::now();
                    worker = loaded;
                    failed_at = None;
                }
                Err(error) => {
                    if error != "nlp_cancelled" {
                        failed_at = Some(Instant::now());
                        stopped(&shared, Some(&error));
                    } else {
                        stopped(&shared, None);
                    }
                }
            }
            continue;
        }
        let Command::Work {
            operation,
            text,
            epoch,
            reply,
        } = command
        else {
            continue;
        };
        if operation == Operation::Index && shared.indexing_paused.load(Ordering::Acquire) {
            let _ = reply.send(None);
            continue;
        }
        shared.work.store(
            if operation == Operation::Index { 2 } else { 1 },
            Ordering::Release,
        );
        locked(&shared.status).busy = true;
        let result = tokio::select! { biased;
            _ = shared.interrupt.notified() => Err("nlp_cancelled".to_owned()),
            output = tokio::time::timeout(Duration::from_secs(2), worker.as_mut().unwrap().exchange(operation, text)) =>
                output.map_err(|_| "nlp_timeout".to_owned()).and_then(|r| r),
        };
        *locked(&shared.last_used) = Instant::now();
        shared.work.store(0, Ordering::Release);
        locked(&shared.status).busy = false;
        match result {
            Ok(analysis) if epoch == shared.epoch.load(Ordering::Acquire) => {
                let _ = reply.send(Some(analysis));
            }
            Ok(_) => {
                let _ = reply.send(None);
            }
            Err(error) => {
                if let Some(worker) = worker.take() {
                    terminate(&shared, worker).await;
                }
                if error != "nlp_cancelled" {
                    failed_at = Some(Instant::now());
                    stopped(&shared, Some(&error));
                } else {
                    stopped(&shared, None);
                }
                let _ = reply.send(None);
            }
        }
    }
    if let Some(worker) = worker.take() {
        terminate(&shared, worker).await;
    }
    stopped(&shared, None);
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_bad_byte_spans_and_non_finite_vectors() {
        let mut result = Analysis::default();
        result.tokens.push(protocol::Token {
            form: "😀".into(),
            tag: "W_EMOJI".into(),
            start: 1,
            end: 4,
        });
        assert!(!valid_result("😀", &result));
        result.tokens[0].start = 0;
        assert!(valid_result("😀", &result));
        result.embeddings.push(protocol::Embedding {
            start: 0,
            end: 4,
            vector: vec![f32::NAN; 384],
        });
        assert!(!valid_result("😀", &result));
    }
}
