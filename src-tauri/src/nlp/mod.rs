mod download;
mod models;
mod process;
pub mod protocol;

use protocol::{Analysis, Operation};
use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering},
        Arc, Mutex,
    },
    time::Instant,
};
use tokio::sync::{mpsc, oneshot, Notify};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum ModelKind {
    Kiwi,
    Semantic,
}
impl ModelKind {
    fn name(self) -> &'static str {
        match self {
            Self::Kiwi => "kiwi",
            Self::Semantic => "semantic",
        }
    }
}
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SearchSettings {
    pub kiwi_enabled: bool,
    pub semantic_enabled: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    pub installed: bool,
    pub enabled: bool,
    pub state: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub error: Option<String>,
    pub profile: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NlpStatus {
    pub settings: SearchSettings,
    pub kiwi: ModelStatus,
    pub semantic: ModelStatus,
    pub running: bool,
    pub busy: bool,
    pub active_methods: Vec<String>,
}
struct Shared {
    root: PathBuf,
    executable: PathBuf,
    runtime: PathBuf,
    status: Mutex<NlpStatus>,
    downloads: Mutex<std::collections::HashMap<ModelKind, Arc<AtomicBool>>>,
    epoch: AtomicU64,
    work: AtomicU8,
    closed: AtomicBool,
    suspended: AtomicBool,
    indexing_paused: AtomicBool,
    interrupt: Notify,
    model_gates: [tokio::sync::Mutex<()>; 2],
    config_gate: tokio::sync::Mutex<()>,
    last_used: Mutex<Instant>,
    stop_error: Mutex<Option<String>>,
}
#[derive(Clone)]
pub struct NlpService {
    shared: Arc<Shared>,
    foreground: mpsc::Sender<Command>,
    background: mpsc::Sender<Command>,
    handle: Arc<Mutex<Option<tauri::async_runtime::JoinHandle<()>>>>,
}
enum Command {
    Warmup,
    Work {
        operation: Operation,
        text: String,
        epoch: u64,
        reply: oneshot::Sender<Option<Analysis>>,
    },
    Maintain,
    Stop(oneshot::Sender<Result<(), String>>),
    Shutdown(oneshot::Sender<()>),
}
fn locked<T>(value: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    value.lock().unwrap_or_else(|e| e.into_inner())
}
impl NlpService {
    pub fn new(
        data_dir: PathBuf,
        executable: PathBuf,
        runtime_dir: PathBuf,
    ) -> Result<Self, String> {
        let root = data_dir.join("nlp");
        std::fs::create_dir_all(&root).map_err(|_| "검색 모델 폴더를 만들지 못했어요.")?;
        // Recover a verified previous directory if the app exited between the two rename steps.
        for kind in [ModelKind::Kiwi, ModelKind::Semantic] {
            let destination = root.join(kind.name());
            let previous = root.join(format!(".{}-previous", kind.name()));
            if !destination.exists()
                && (previous.join("verified-artifacts").is_file()
                    || previous.join("verified-profile").is_file())
            {
                std::fs::rename(&previous, &destination)
                    .map_err(|_| "이전 검색 모델을 복구하지 못했어요.")?;
            }
        }
        let settings: SearchSettings = std::fs::read(root.join("memory-search.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        let mut legacy = Vec::new();
        let mut model_status = |kind: ModelKind, enabled: bool| {
            let manifest = models::manifest(kind);
            let profile = models::fingerprint(&manifest);
            let artifact = models::artifact_fingerprint(&manifest);
            let installed =
                std::fs::read_to_string(root.join(kind.name()).join("verified-artifacts"))
                    .ok()
                    .as_deref()
                    == Some(&artifact);
            let verify_legacy =
                !installed && root.join(kind.name()).join("verified-profile").is_file();
            if verify_legacy {
                legacy.push(kind);
            }
            ModelStatus {
                installed,
                enabled,
                state: if installed {
                    "idle"
                } else if verify_legacy {
                    "initializing"
                } else {
                    "not_installed"
                }
                .into(),
                downloaded_bytes: 0,
                total_bytes: manifest.files.iter().map(|f| f.size).sum(),
                error: None,
                profile: installed.then_some(profile),
            }
        };
        let status = NlpStatus {
            kiwi: model_status(ModelKind::Kiwi, settings.kiwi_enabled),
            semantic: model_status(ModelKind::Semantic, settings.semantic_enabled),
            settings,
            running: false,
            busy: false,
            active_methods: vec!["lexical".into()],
        };
        let shared = Arc::new(Shared {
            root,
            executable,
            runtime: runtime_dir,
            status: Mutex::new(status),
            downloads: Mutex::new(Default::default()),
            epoch: AtomicU64::new(0),
            work: AtomicU8::new(0),
            closed: AtomicBool::new(false),
            suspended: AtomicBool::new(false),
            indexing_paused: AtomicBool::new(false),
            interrupt: Notify::new(),
            model_gates: [tokio::sync::Mutex::new(()), tokio::sync::Mutex::new(())],
            config_gate: tokio::sync::Mutex::new(()),
            last_used: Mutex::new(Instant::now()),
            stop_error: Mutex::new(None),
        });
        let (foreground, fg) = mpsc::channel(16);
        let (background, bg) = mpsc::channel(1);
        let actor = shared.clone();
        let handle = tauri::async_runtime::spawn(process::run(actor, fg, bg, legacy));
        Ok(Self {
            shared,
            foreground,
            background,
            handle: Arc::new(Mutex::new(Some(handle))),
        })
    }
    pub fn status(&self) -> NlpStatus {
        let mut status = locked(&self.shared.status).clone();
        let semantic = models::manifest(ModelKind::Semantic);
        if !status.semantic.installed
            && status.semantic.state != "initializing"
            && semantic.files.iter().any(|file| file.url.is_none())
        {
            status.semantic.state = "unavailable".into();
            status.semantic.error = Some("의미 검색 모델의 검증과 배포를 준비하고 있어요.".into());
        } else if status.semantic.installed
            && semantic.threshold.is_none()
            && !matches!(
                status.semantic.state.as_str(),
                "downloading" | "installing" | "removing" | "error"
            )
        {
            status.semantic.state = "uncalibrated".into();
            status.semantic.error =
                Some("검색 품질 검증이 끝나기 전까지 기본 검색을 사용해요.".into());
        }
        status
    }
    pub fn semantic_threshold(&self) -> Option<f32> {
        models::manifest(ModelKind::Semantic).threshold
    }
    pub fn warmup(&self) {
        if !self.shared.closed.load(Ordering::Acquire)
            && !self.shared.suspended.load(Ordering::Acquire)
        {
            let _ = self.foreground.try_send(Command::Warmup);
        }
    }
    pub fn maintain(&self) {
        let _ = self.foreground.try_send(Command::Maintain);
    }
    pub fn pause_indexing(&self, paused: bool) {
        self.shared.indexing_paused.store(paused, Ordering::Release);
        if paused {
            self.cancel_background();
        }
    }
    pub fn cancel_background(&self) {
        if self.shared.work.load(Ordering::Acquire) == 2 {
            self.interrupt();
        }
    }
    fn interrupt(&self) {
        self.shared.epoch.fetch_add(1, Ordering::AcqRel);
        self.shared.interrupt.notify_one();
    }
    pub async fn configure(&self, settings: SearchSettings) -> Result<(), String> {
        if self.shared.closed.load(Ordering::Acquire) {
            return Err("앱을 종료하고 있어요.".into());
        }
        let _config = self.shared.config_gate.lock().await;
        if self.shared.closed.load(Ordering::Acquire)
            || self.shared.suspended.load(Ordering::Acquire)
        {
            return Err("앱을 종료하거나 업데이트하고 있어요.".into());
        }
        let data = serde_json::to_vec(&settings).map_err(|e| e.to_string())?;
        let root = self.shared.root.clone();
        tokio::task::spawn_blocking(move || {
            download::atomic_file(&root.join("memory-search.json"), &data)
        })
        .await
        .map_err(|_| "검색 설정을 저장하지 못했어요.")??;
        {
            let mut status = locked(&self.shared.status);
            status.settings = settings.clone();
            for (kind, enabled) in [
                (ModelKind::Kiwi, settings.kiwi_enabled),
                (ModelKind::Semantic, settings.semantic_enabled),
            ] {
                let model = model_mut(&mut status, kind);
                model.enabled = enabled;
                model.profile = model
                    .installed
                    .then(|| models::fingerprint(&models::manifest(kind)));
            }
        }
        self.interrupt();
        self.warmup();
        Ok(())
    }
    pub async fn query(&self, text: &str) -> Option<Analysis> {
        self.work(text, Operation::Query).await
    }
    pub async fn index(&self, text: &str) -> Option<Analysis> {
        self.work(text, Operation::Index).await
    }
    async fn work(&self, text: &str, operation: Operation) -> Option<Analysis> {
        if self.shared.closed.load(Ordering::Acquire)
            || self.shared.suspended.load(Ordering::Acquire)
            || text.len() > protocol::MAX_TEXT_BYTES
        {
            return None;
        }
        if self.status().kiwi.state == "initializing"
            || self.status().semantic.state == "initializing"
        {
            return None;
        }
        let (reply, receive) = oneshot::channel();
        let command = Command::Work {
            operation,
            text: text.into(),
            epoch: self.shared.epoch.load(Ordering::Acquire),
            reply,
        };
        let sender = if operation == Operation::Index {
            &self.background
        } else {
            &self.foreground
        };
        sender.try_send(command).ok()?;
        tokio::time::timeout(std::time::Duration::from_secs(2), receive)
            .await
            .ok()?
            .ok()
            .flatten()
    }
    pub fn cancel_download(&self, kind: ModelKind) {
        if let Some(cancel) = locked(&self.shared.downloads).get(&kind) {
            cancel.store(true, Ordering::Release);
        }
    }
    pub async fn download(&self, kind: ModelKind) -> Result<(), String> {
        download::install(self, kind).await
    }
    pub async fn remove(&self, kind: ModelKind) -> Result<(), String> {
        self.cancel_download(kind);
        let _gate = self.shared.model_gates[kind as usize].lock().await;
        let previous = {
            let mut status = locked(&self.shared.status);
            let model = model_mut(&mut status, kind);
            let previous = model.clone();
            model.state = "removing".into();
            previous
        };
        if let Err(error) = self.stop_worker().await {
            restore_after_remove(&mut locked(&self.shared.status), kind, &previous);
            return Err(error);
        }
        let path = self.shared.root.join(kind.name());
        match tokio::fs::remove_dir_all(path).await {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => {
                restore_after_remove(&mut locked(&self.shared.status), kind, &previous);
                return Err("검색 모델 파일을 제거하지 못했어요.".into());
            }
        }
        let mut status = locked(&self.shared.status);
        let model = model_mut(&mut status, kind);
        model.installed = false;
        model.profile = None;
        model.state = "not_installed".into();
        model.error = None;
        Ok(())
    }
    async fn stop_worker(&self) -> Result<(), String> {
        self.interrupt();
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
        let (reply, wait) = oneshot::channel();
        tokio::time::timeout_at(deadline, self.foreground.send(Command::Stop(reply)))
            .await
            .map_err(|_| "검색 실행기 정리 시간이 초과됐어요.")?
            .map_err(|_| "검색 실행기가 종료됐어요.")?;
        tokio::time::timeout_at(deadline, wait)
            .await
            .map_err(|_| "검색 실행기 정리 시간이 초과됐어요.")?
            .map_err(|_| "검색 실행기가 종료됐어요.")?
    }
    pub async fn suspend(&self) -> Result<(), String> {
        self.shared.suspended.store(true, Ordering::Release);
        for cancel in locked(&self.shared.downloads).values() {
            cancel.store(true, Ordering::Release);
        }
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
        tokio::time::timeout_at(deadline, async {
            let (stopped, _, _, _) = tokio::join!(
                self.stop_worker(),
                self.shared.model_gates[0].lock(),
                self.shared.model_gates[1].lock(),
                self.shared.config_gate.lock()
            );
            stopped
        })
        .await
        .map_err(|_| "검색 작업 정리 시간이 초과됐어요.")?
    }
    pub fn resume(&self) {
        self.shared.suspended.store(false, Ordering::Release);
        self.warmup();
    }
    pub async fn shutdown(&self) {
        if self.shared.closed.swap(true, Ordering::AcqRel) {
            return;
        }
        for cancel in locked(&self.shared.downloads).values() {
            cancel.store(true, Ordering::Release);
        }
        self.interrupt();
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
        let (reply, wait) = oneshot::channel();
        let _ =
            tokio::time::timeout_at(deadline, self.foreground.send(Command::Shutdown(reply))).await;
        let _ = tokio::time::timeout_at(deadline, wait).await;
        let _ = tokio::time::timeout_at(deadline, async {
            let _guards = tokio::join!(
                self.shared.model_gates[0].lock(),
                self.shared.model_gates[1].lock(),
                self.shared.config_gate.lock()
            );
        })
        .await;
        let handle = { locked(&self.handle).take() };
        if let Some(mut handle) = handle {
            if tokio::time::timeout_at(deadline, &mut handle)
                .await
                .is_err()
            {
                // Child has kill_on_drop; Tokio's process reaper owns the final wait if OS exit stalls.
                handle.abort();
                let _ = handle.await;
            }
        }
    }
}
fn model_mut(status: &mut NlpStatus, kind: ModelKind) -> &mut ModelStatus {
    match kind {
        ModelKind::Kiwi => &mut status.kiwi,
        ModelKind::Semantic => &mut status.semantic,
    }
}

fn restore_after_remove(status: &mut NlpStatus, kind: ModelKind, previous: &ModelStatus) {
    let model = model_mut(status, kind);
    // A concurrent settings write owns `enabled`; rollback only fields owned by removal.
    model.state = previous.state.clone();
    model.error = previous.error.clone();
}

#[cfg(test)]
mod tests;
