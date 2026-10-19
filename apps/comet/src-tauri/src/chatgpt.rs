//! Public Sign in with ChatGPT credentials never cross the Tauri boundary.
mod auth;
#[cfg(any(target_os = "windows", test))]
mod credentials;
mod responses;

use crate::{
    app::{self, AppState},
    types::{ChatMessage, Settings},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    path::Path,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::Emitter;

const ISSUER: &str = "https://auth.openai.com";
const RESOURCE: &str = "https://api.openai.com/v1";
const USAGE_URL: &str = "https://chatgpt.com/settings/usage";
const SHARING_SCOPE: &str = "chatgpt.tokens.use.direct";
type Result<T> = std::result::Result<T, String>;

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Tokens {
    access_token: String,
    refresh_token: Option<String>,
    id_token: Option<String>,
    expires_at: i64,
    scopes: Vec<String>,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Account {
    id: String,
    client_id: String,
    subject: Option<String>,
    email: Option<String>,
    tokens: Option<Tokens>,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Saved {
    host_id: String,
    active: Option<String>,
    accounts: Vec<Account>,
}
impl Default for Saved {
    fn default() -> Self {
        Self {
            host_id: format!("urn:uuid:{}", uuid::Uuid::new_v4()),
            active: None,
            accounts: vec![],
        }
    }
}
#[derive(Default)]
struct State {
    saved: Saved,
    loaded: bool,
    notice: Option<String>,
    pending: Option<(u64, Arc<AtomicBool>)>,
    signing_out: Option<String>,
    usage_blocked: bool,
    credential_cleanup_pending: bool,
}
struct Inner {
    namespace: Mutex<String>,
    state: Mutex<State>,
    credential_io: Mutex<()>,
    loading: tokio::sync::Mutex<()>,
    generation: AtomicU64,
    login_generation: AtomicU64,
    refresh: tokio::sync::Mutex<()>,
}
#[derive(Clone)]
pub(crate) struct Service(Arc<Inner>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AccountView {
    id: String,
    label: String,
    email: Option<String>,
    connected: bool,
    sharing: bool,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Status {
    accounts: Vec<AccountView>,
    active_account_id: Option<String>,
    login_pending: bool,
    usage_url: &'static str,
    notice: Option<String>,
    request_blocked: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Model {
    slug: String,
    display_name: String,
}
fn lock<T>(mutex: &Mutex<T>) -> Result<std::sync::MutexGuard<'_, T>> {
    mutex
        .lock()
        .map_err(|_| "ChatGPT 연결 상태를 읽지 못했어요.".into())
}
impl Service {
    pub(crate) fn new(app_data: &Path) -> Self {
        let hash = hex::encode(Sha256::digest(
            app_data.as_os_str().to_string_lossy().as_bytes(),
        ));
        Self(Arc::new(Inner {
            namespace: Mutex::new(format!("space.starlight.comet.{hash}.chatgpt")),
            state: Mutex::new(State::default()),
            credential_io: Mutex::new(()),
            loading: tokio::sync::Mutex::new(()),
            generation: AtomicU64::new(0),
            login_generation: AtomicU64::new(0),
            refresh: tokio::sync::Mutex::new(()),
        }))
    }
    pub(crate) fn configure(&self, identifier: &str) -> Result<()> {
        if identifier.is_empty()
            || identifier.len() > 200
            || !identifier
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b".-_".contains(&b))
        {
            return Err("앱 식별자를 확인할 수 없어요.".into());
        }
        let state = lock(&self.0.state)?;
        if state.loaded {
            return Err("이미 읽은 ChatGPT 저장소는 바꿀 수 없어요.".into());
        }
        *lock(&self.0.namespace)? = format!("{identifier}.chatgpt");
        self.0.generation.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    fn entry(&self) -> Result<keyring::Entry> {
        keyring::Entry::new(&lock(&self.0.namespace)?, "accounts-v1")
            .map_err(|_| "ChatGPT 자격 증명 저장소를 열지 못했어요.".into())
    }
    #[cfg(target_os = "windows")]
    fn entry_for(&self, key: &str) -> Result<keyring::Entry> {
        keyring::Entry::new(&lock(&self.0.namespace)?, key)
            .map_err(|_| "ChatGPT 자격 증명 저장소를 열지 못했어요.".into())
    }
    fn read_saved(&self) -> Result<Option<String>> {
        #[cfg(target_os = "windows")]
        return credentials::load(self);
        #[cfg(not(target_os = "windows"))]
        match self.entry()?.get_password() {
            Ok(raw) => Ok(Some(raw)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err("시스템 저장소에서 ChatGPT 연결을 읽지 못했어요.".into()),
        }
    }
    pub(crate) async fn initialize(&self) -> Result<()> {
        let _loading = self.0.loading.lock().await;
        if lock(&self.0.state)?.loaded {
            return Ok(());
        }
        let service = self.clone();
        let result = tokio::task::spawn_blocking(move || service.load())
            .await
            .map_err(|_| "ChatGPT 저장소 읽기가 중단됐어요.".to_string())?;
        if let Err(error) = &result {
            lock(&self.0.state)?.notice = Some(error.clone());
        }
        result
    }
    fn load(&self) -> Result<()> {
        let _io = lock(&self.0.credential_io)?;
        let (generation, empty) = {
            let state = lock(&self.0.state)?;
            if state.loaded {
                return Ok(());
            }
            (
                self.0.generation.load(Ordering::SeqCst),
                state.saved.clone(),
            )
        };
        let saved = match self.read_saved()? {
            Some(raw) => {
                if raw.len() > 1024 * 1024 {
                    return Err("ChatGPT 저장소 크기를 확인해 주세요.".into());
                }
                serde_json::from_str::<Saved>(&raw)
                    .map_err(|_| "ChatGPT 저장소를 읽지 못했어요. 기존 정보는 보존했어요.")?
            }
            None => empty,
        };
        if saved.accounts.len() > 32
            || saved.host_id.is_empty()
            || saved
                .accounts
                .iter()
                .any(|a| !auth::valid_client_id(&a.client_id))
        {
            return Err("ChatGPT 저장소 형식을 확인해 주세요.".into());
        }
        self.finish_load(generation, saved)
    }
    fn finish_load(&self, generation: u64, saved: Saved) -> Result<()> {
        let mut state = lock(&self.0.state)?;
        if state.loaded || self.0.generation.load(Ordering::SeqCst) != generation {
            return Err("ChatGPT 저장소가 변경되어 읽기를 중단했어요.".into());
        }
        state.saved = saved;
        state.loaded = true;
        Ok(())
    }
    /// Drops every saved account and its stored credentials; used by the full app reset.
    pub(crate) async fn forget_all(&self) -> Result<()> {
        self.initialize().await?;
        self.cancel_login()?;
        let _refresh = self.0.refresh.lock().await;
        let accounts = {
            let mut inner = lock(&self.0.state)?;
            let accounts = inner.saved.accounts.clone();
            inner.saved = Saved::default();
            inner.usage_blocked = false;
            inner.notice = None;
            self.0.generation.fetch_add(1, Ordering::SeqCst);
            accounts
        };
        for account in accounts.iter().filter(|account| account.tokens.is_some()) {
            // Revocation is best effort; a stalled network must not block the reset.
            let _ = tokio::time::timeout(Duration::from_secs(5), auth::revoke(account)).await;
        }
        self.persist().await
    }
    async fn persist(&self) -> Result<()> {
        let service = self.clone();
        // OS credential prompts may wait indefinitely. They never own UI state or an async worker.
        tokio::task::spawn_blocking(move || service.persist_current())
            .await
            .map_err(|_| "ChatGPT 저장소 쓰기가 중단됐어요.".to_string())?
    }
    fn persist_current(&self) -> Result<()> {
        let _io = lock(&self.0.credential_io)?;
        // Take the newest snapshot after the IO queue, so an older queued write cannot restore tokens.
        let saved = lock(&self.0.state)?.saved.clone();
        self.write_saved(&saved)
    }
    fn write_saved(&self, saved: &Saved) -> Result<()> {
        let raw = serde_json::to_string(&saved).map_err(|_| "ChatGPT 저장 정보 오류")?;
        if raw.len() > 1024 * 1024 {
            return Err("ChatGPT 저장소 크기를 확인해 주세요.".into());
        }
        #[cfg(target_os = "windows")]
        {
            let cleaned = credentials::save(self, &raw)?;
            lock(&self.0.state)?.credential_cleanup_pending = !cleaned;
            Ok(())
        }
        #[cfg(not(target_os = "windows"))]
        {
            self.entry()?
                .set_password(&raw)
                .map_err(|_| "ChatGPT 연결을 시스템 자격 증명 저장소에 저장하지 못했어요.".into())
        }
    }
    async fn commit_login(
        &self,
        attempt: u64,
        cancel: Arc<AtomicBool>,
        account: Account,
    ) -> Result<()> {
        let service = self.clone();
        // Keep rollback and unused-token revocation alive if the waiting caller is cancelled.
        tokio::spawn(async move {
            let cleanup_account = account.clone();
            let result = tokio::task::spawn_blocking(move || {
                service.commit_login_with(attempt, &cancel, account, |saved| {
                    service.write_saved(saved)
                })
            })
            .await
            .map_err(|_| "ChatGPT 로그인 저장이 중단됐어요.".to_string())?;
            if result.is_err() {
                let _ = auth::revoke(&cleanup_account).await;
            }
            result
        })
        .await
        .map_err(|_| "ChatGPT 로그인 저장이 중단됐어요.".to_string())?
    }
    fn commit_login_with(
        &self,
        attempt: u64,
        cancel: &AtomicBool,
        account: Account,
        mut write: impl FnMut(&Saved) -> Result<()>,
    ) -> Result<()> {
        let _io = lock(&self.0.credential_io)?;
        let (prior, generation) = {
            let state = lock(&self.0.state)?;
            auth::check_attempt(self, attempt, cancel)?;
            if !state.pending.as_ref().is_some_and(|(id, _)| *id == attempt) {
                return Err("ChatGPT 로그인 요청이 종료됐어요.".into());
            }
            (
                state.saved.clone(),
                self.0.generation.load(Ordering::SeqCst),
            )
        };
        let mut next = prior.clone();
        let target = next
            .accounts
            .iter_mut()
            .find(|a| a.id == account.id && a.client_id == account.client_id)
            .ok_or("ChatGPT 등록이 변경됐어요.")?;
        next.active = Some(account.id.clone());
        *target = account;
        write(&next)?;
        let committed = {
            let mut state = lock(&self.0.state)?;
            if auth::check_attempt(self, attempt, cancel).is_ok()
                && state.pending.as_ref().is_some_and(|(id, _)| *id == attempt)
                && self.0.generation.load(Ordering::SeqCst) == generation
                && state.saved == prior
            {
                state.saved = next;
                state.pending = None;
                state.usage_blocked = false;
                state.notice = None;
                self.0.generation.fetch_add(1, Ordering::SeqCst);
                true
            } else {
                false
            }
        };
        if !committed {
            // Cancellation/account changes may happen while Keychain is awaiting permission.
            // Restore the latest state before any later queued write; never activate stale tokens.
            let latest = lock(&self.0.state)?.saved.clone();
            if let Err(error) = write(&latest) {
                lock(&self.0.state)?.notice = Some(error.clone());
                return Err(error);
            }
            return Err("ChatGPT 로그인이 취소되었거나 계정이 변경됐어요.".into());
        }
        Ok(())
    }
    pub(crate) fn status(&self) -> Result<Status> {
        let state = lock(&self.0.state)?;
        let notice = if state.credential_cleanup_pending {
            let cleanup = "ChatGPT 연결 정보는 저장했지만 이전 자격 증명 정리가 남았어요. 다음 연결 때 다시 정리합니다.";
            Some(match &state.notice {
                Some(notice) => format!("{notice}\n{cleanup}"),
                None => cleanup.into(),
            })
        } else {
            state.notice.clone()
        };
        Ok(Status {
            accounts: state
                .saved
                .accounts
                .iter()
                .map(|a| AccountView {
                    id: a.id.clone(),
                    label: format!(
                        "{} · {}",
                        a.email.as_deref().unwrap_or("ChatGPT 계정"),
                        a.id.chars().take(8).collect::<String>()
                    ),
                    email: a.email.clone(),
                    connected: a.tokens.is_some() && state.signing_out.as_ref() != Some(&a.id),
                    sharing: a
                        .tokens
                        .as_ref()
                        .is_some_and(|t| t.scopes.iter().any(|s| s == SHARING_SCOPE)),
                })
                .collect(),
            active_account_id: state.saved.active.clone(),
            login_pending: state.pending.is_some(),
            usage_url: USAGE_URL,
            notice,
            request_blocked: state.usage_blocked,
        })
    }
    pub(crate) fn ready(&self) -> bool {
        self.0.state.try_lock().is_ok_and(|state| {
            state.loaded
                && !state.usage_blocked
                && state.saved.accounts.iter().any(|a| {
                    Some(&a.id) == state.saved.active.as_ref()
                        && state.signing_out.as_ref() != Some(&a.id)
                        && a.tokens
                            .as_ref()
                            .is_some_and(|t| t.scopes.iter().any(|s| s == SHARING_SCOPE))
                })
        })
    }
    fn cancel_login(&self) -> Result<()> {
        let mut state = lock(&self.0.state)?;
        if let Some((_, cancel)) = state.pending.take() {
            cancel.store(true, Ordering::SeqCst);
        }
        self.0.login_generation.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
    fn begin_login(&self) -> Result<(u64, Arc<AtomicBool>)> {
        let mut state = lock(&self.0.state)?;
        if state.pending.is_some() {
            return Err("진행 중인 ChatGPT 로그인을 마치거나 취소해 주세요.".into());
        }
        if state.signing_out.is_some() {
            return Err("로그아웃을 마친 뒤 다시 연결해 주세요.".into());
        }
        let attempt = self.0.login_generation.fetch_add(1, Ordering::SeqCst) + 1;
        let cancel = Arc::new(AtomicBool::new(false));
        state.pending = Some((attempt, cancel.clone()));
        state.notice = None;
        Ok((attempt, cancel))
    }
    async fn initialize_login(&self, attempt: u64, cancel: Arc<AtomicBool>) -> Result<()> {
        tokio::select! {
            biased;
            _ = crate::models::cancelled(cancel.clone()) => return Err("ChatGPT 로그인을 취소했어요.".into()),
            result = self.initialize() => result?,
        }
        auth::check_attempt(self, attempt, &cancel)
    }
    async fn select(&self, id: &str) -> Result<()> {
        {
            let mut state = lock(&self.0.state)?;
            if state.signing_out.is_some() {
                return Err("로그아웃을 마친 뒤 계정을 선택해 주세요.".into());
            }
            if !state
                .saved
                .accounts
                .iter()
                .any(|a| a.id == id && a.subject.is_some() && a.tokens.is_some())
            {
                return Err("이 계정에 다시 로그인해 주세요.".into());
            }
            let mut saved = state.saved.clone();
            saved.active = Some(id.into());
            self.0.generation.fetch_add(1, Ordering::SeqCst);
            state.saved = saved;
            state.usage_blocked = false;
            state.notice = None;
        }
        self.persist().await
    }
    fn current(&self, generation: u64, cancel: &AtomicBool) -> Result<()> {
        if cancel.load(Ordering::Acquire) || self.0.generation.load(Ordering::SeqCst) != generation
        {
            Err("ChatGPT 요청이 취소됐어요.".into())
        } else {
            Ok(())
        }
    }
    async fn access(&self, cancel: Arc<AtomicBool>) -> Result<(String, u64)> {
        self.initialize().await?;
        if cancel.load(Ordering::Acquire) {
            return Err("취소됨".into());
        }
        let generation = self.0.generation.load(Ordering::SeqCst);
        let service = self.clone();
        // Token rotation must finish and persist even when its inference caller stops.
        let task = tokio::spawn(async move { service.access_serialized(generation).await });
        tokio::select! {
            _ = crate::models::cancelled(cancel) => Err("취소됨".into()),
            result = task => result.map_err(|_| "ChatGPT 인증 갱신이 중단됐어요.".to_string())?,
        }
    }
    async fn access_serialized(&self, generation: u64) -> Result<(String, u64)> {
        let _guard = self.0.refresh.lock().await;
        self.current(generation, &AtomicBool::new(false))?;
        let account = {
            let state = lock(&self.0.state)?;
            if state.usage_blocked {
                return Err(
                    "ChatGPT 사용량을 확인한 뒤 계정을 다시 선택해 요청을 재개해 주세요.".into(),
                );
            }
            let account = state
                .saved
                .accounts
                .iter()
                .find(|a| {
                    Some(&a.id) == state.saved.active.as_ref()
                        && state.signing_out.as_ref() != Some(&a.id)
                })
                .cloned()
                .ok_or("ChatGPT 계정에 로그인해 주세요.")?;
            let tokens = account
                .tokens
                .as_ref()
                .ok_or("ChatGPT 계정에 다시 로그인해 주세요.")?;
            if !tokens.scopes.iter().any(|scope| scope == SHARING_SCOPE) {
                return Err("ChatGPT 플랜 사용 권한을 허용해 주세요.".into());
            }
            if tokens.expires_at > chrono::Utc::now().timestamp() + 60 {
                return Ok((tokens.access_token.clone(), generation));
            }
            account
        };
        let refreshed = auth::refresh(&account).await;
        let (result, changed) = {
            let mut state = lock(&self.0.state)?;
            let mut saved = state.saved.clone();
            let target = saved
                .accounts
                .iter_mut()
                .find(|a| a.id == account.id)
                .ok_or("ChatGPT 계정이 변경됐어요.")?;
            if target.client_id != account.client_id
                || target.subject != account.subject
                || target
                    .tokens
                    .as_ref()
                    .and_then(|t| t.refresh_token.as_ref())
                    != account
                        .tokens
                        .as_ref()
                        .and_then(|t| t.refresh_token.as_ref())
            {
                return Err("ChatGPT 인증 세션이 변경됐어요.".into());
            }
            match refreshed {
                Ok(tokens) => {
                    let access = tokens.access_token.clone();
                    let permitted = tokens.scopes.iter().any(|s| s == SHARING_SCOPE);
                    target.tokens = Some(tokens);
                    state.saved = saved;
                    (Ok((access, permitted)), true)
                }
                Err(error) => {
                    if error.terminal_refresh {
                        target.tokens = None;
                        state.saved = saved;
                    }
                    if self.0.generation.load(Ordering::SeqCst) == generation {
                        state.notice = Some(error.message.clone());
                    }
                    (Err(error.message), error.terminal_refresh)
                }
            }
        };
        if changed {
            self.persist().await?;
        }
        let (access, permitted) = result?;
        self.current(generation, &AtomicBool::new(false))?;
        if !permitted {
            return Err("ChatGPT 플랜 사용 권한을 다시 허용해 주세요.".into());
        }
        Ok((access, generation))
    }

    fn failure(&self, error: &responses::Failure, generation: u64) {
        if let Ok(mut state) = lock(&self.0.state) {
            if self.0.generation.load(Ordering::SeqCst) != generation {
                return;
            }
            state.notice = Some(error.message.clone());
            if error.usage_limit {
                state.usage_blocked = true;
            }
        }
    }
}

pub(crate) async fn generate(
    service: &Service,
    settings: &Settings,
    messages: &[ChatMessage],
    schema: Value,
    timeout: Duration,
    cancel: Arc<AtomicBool>,
    telemetry: Option<&crate::inference::RequestTelemetry>,
) -> Result<Value> {
    let (token, generation) = service.access(cancel.clone()).await?;
    service.current(generation, &cancel)?;
    let operation = responses::generate(
        &token,
        &settings.chatgpt_model,
        messages,
        schema,
        timeout,
        telemetry,
    );
    let result = tokio::select! { _ = crate::models::cancelled(cancel.clone()) => return Err("취소됨".into()), value = operation => value };
    service.current(generation, &cancel)?;
    match result {
        Ok(value) => Ok(value),
        Err(error) => {
            service.failure(&error, generation);
            Err(error.message)
        }
    }
}
fn publish(app: &tauri::AppHandle, state: &AppState) {
    if let Ok(status) = state.inference.chatgpt.status() {
        let _ = app.emit("chatgpt-state", status);
    }
    app::publish(app, state);
}
fn interrupt_requests(state: &AppState) -> Result<()> {
    let _action = app::lock(&state.action)?;
    if crate::store::settings(&*app::lock(&state.db)?)?.mode == "chatgpt" {
        app::interrupt(state, false)?;
        let mut runtime = app::lock(&state.runtime)?;
        runtime.phase = crate::types::RuntimePhase::Idle;
        runtime.persona = None;
        runtime.error = None;
    }
    Ok(())
}
#[tauri::command]
pub(crate) async fn get_chatgpt_status(state: tauri::State<'_, Arc<AppState>>) -> Result<Status> {
    // Polling UI state must never start or wait for an OS credential prompt.
    state.inference.chatgpt.status()
}
#[tauri::command]
pub(crate) async fn login_chatgpt(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    account_id: Option<String>,
    consent: Option<bool>,
) -> Result<Status> {
    let service = &state.inference.chatgpt;
    let (attempt, cancel) = service.begin_login()?;
    publish(&app, &state);
    let result = async {
        service.initialize_login(attempt, cancel.clone()).await?;
        let saved = {
            let inner = lock(&service.0.state)?;
            auth::check_attempt(service, attempt, &cancel)?;
            if account_id.is_none() && inner.saved.accounts.len() >= 32 {
                return Err("저장된 ChatGPT 계정 수가 한도에 도달했어요.".into());
            }
            if account_id
                .as_ref()
                .is_some_and(|id| !inner.saved.accounts.iter().any(|a| &a.id == id))
            {
                return Err("저장된 ChatGPT 계정을 찾지 못했어요.".into());
            }
            inner.saved.clone()
        };
        interrupt_requests(&state)?;
        auth::login(
            service,
            saved,
            account_id.as_deref(),
            consent.unwrap_or(false),
            attempt,
            cancel.clone(),
        )
        .await
    }
    .await;
    if result.is_err() {
        cancel.store(true, Ordering::SeqCst);
    }
    {
        let mut inner = lock(&service.0.state)?;
        if inner.pending.as_ref().is_some_and(|(id, _)| *id == attempt) {
            inner.pending = None;
        }
        if let Err(error) = &result {
            if service.0.login_generation.load(Ordering::SeqCst) == attempt {
                inner.notice = Some(error.clone());
            }
        }
    }
    publish(&app, &state);
    result?;
    service.status()
}
#[tauri::command]
pub(crate) fn cancel_chatgpt_login(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Status> {
    state.inference.chatgpt.cancel_login()?;
    publish(&app, &state);
    state.inference.chatgpt.status()
}
#[tauri::command]
pub(crate) async fn select_chatgpt_account(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    account_id: String,
) -> Result<Status> {
    state.inference.chatgpt.initialize().await?;
    state.inference.chatgpt.cancel_login()?;
    interrupt_requests(&state)?;
    state.inference.chatgpt.select(&account_id).await?;
    publish(&app, &state);
    state.inference.chatgpt.status()
}
#[tauri::command]
pub(crate) async fn logout_chatgpt(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    account_id: String,
) -> Result<Status> {
    let service = &state.inference.chatgpt;
    service.initialize().await?;
    service.cancel_login()?;
    interrupt_requests(&state)?;
    {
        let mut inner = lock(&service.0.state)?;
        if inner.signing_out.is_some() {
            return Err("로그아웃 중이에요.".into());
        }
        if !inner.saved.accounts.iter().any(|a| a.id == account_id) {
            return Err("ChatGPT 계정을 찾지 못했어요.".into());
        }
        inner.signing_out = Some(account_id.clone());
        service.0.generation.fetch_add(1, Ordering::SeqCst);
    }
    publish(&app, &state);
    let _refresh = service.0.refresh.lock().await;
    let account = lock(&service.0.state)?
        .saved
        .accounts
        .iter()
        .find(|a| a.id == account_id)
        .cloned()
        .ok_or("ChatGPT 계정을 찾지 못했어요.")?;
    let revoked = auth::revoke(&account).await;
    {
        let mut inner = lock(&service.0.state)?;
        let mut saved = inner.saved.clone();
        if let Some(target) = saved.accounts.iter_mut().find(|a| a.id == account_id) {
            target.tokens = None;
        }
        if saved.active.as_ref() == Some(&account_id) {
            saved.active = None;
            inner.usage_blocked = false;
        }
        // Clear memory before the OS prompt; do not resume requests while persistence waits.
        inner.saved = saved;
        inner.signing_out = None;
        inner.notice = Some(if revoked { "ChatGPT에서 로그아웃했어요." } else { "이 기기에서 로그아웃했지만 서버 연결 해제는 확인하지 못했어요. ChatGPT 사용량 설정에서 앱 연결을 해제할 수 있어요." }.into());
    }
    let persisted = service.persist().await;
    publish(&app, &state);
    persisted?;
    service.status()
}
#[tauri::command]
pub(crate) async fn list_chatgpt_models(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Vec<Model>> {
    let service = &state.inference.chatgpt;
    let cancel = Arc::new(AtomicBool::new(false));
    let (token, generation) = service.access(cancel.clone()).await?;
    let result = responses::models(&token).await;
    service.current(generation, &cancel)?;
    result.map_err(|error| {
        service.failure(&error, generation);
        error.message
    })
}
#[tauri::command]
pub(crate) fn open_chatgpt_usage() -> Result<()> {
    auth::open_browser(USAGE_URL)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn connected() -> Service {
        let service = Service::new(Path::new("/synthetic-chatgpt-test"));
        {
            let mut state = lock(&service.0.state).unwrap();
            state.loaded = true;
            state.saved.active = Some("test-account".into());
            state.saved.accounts.push(Account {
                id: "test-account".into(),
                client_id: "oaiapp_test".into(),
                subject: Some("subject".into()),
                email: Some("test@example.invalid".into()),
                tokens: Some(Tokens {
                    access_token: "never-expose-access".into(),
                    refresh_token: Some("never-expose-refresh".into()),
                    id_token: Some("never-expose-id".into()),
                    expires_at: chrono::Utc::now().timestamp() + 3600,
                    scopes: vec![SHARING_SCOPE.into()],
                }),
            });
        }
        service
    }
    #[test]
    fn readiness_never_waits_for_a_held_state_mutex() {
        let service = connected();
        let guard = lock(&service.0.state).unwrap();
        let worker = service.clone();
        let (send, receive) = std::sync::mpsc::channel();
        let handle = std::thread::spawn(move || send.send(worker.ready()).unwrap());
        let observed = receive.recv_timeout(Duration::from_secs(1));
        drop(guard);
        handle.join().unwrap();
        assert!(!observed.unwrap());
        assert!(service.ready());
    }
    #[test]
    fn pending_credential_cleanup_preserves_other_connection_notices() {
        let service = connected();
        {
            let mut state = lock(&service.0.state).unwrap();
            state.credential_cleanup_pending = true;
            state.notice = Some("서버 연결 해제는 확인하지 못했어요.".into());
        }
        let notice = service.status().unwrap().notice.unwrap();
        assert!(notice.contains("서버 연결 해제는 확인하지 못했어요."));
        assert!(notice.contains("이전 자격 증명 정리가 남았어요."));
        lock(&service.0.state).unwrap().notice = None;
        assert!(service
            .status()
            .unwrap()
            .notice
            .unwrap()
            .contains("이전 자격 증명 정리가 남았어요."));
    }
    #[test]
    fn credential_io_does_not_own_status_and_stale_restore_cannot_replace_a_session() {
        let service = connected();
        let _io = lock(&service.0.credential_io).unwrap();
        assert!(service.ready());
        assert!(service.status().unwrap().accounts[0].connected);

        let empty = Service::new(Path::new("/synthetic-chatgpt-restore"));
        let before = lock(&empty.0.state).unwrap().saved.host_id.clone();
        empty.0.generation.fetch_add(1, Ordering::SeqCst);
        assert!(empty.finish_load(0, Saved::default()).is_err());
        assert_eq!(lock(&empty.0.state).unwrap().saved.host_id, before);
        assert!(!lock(&empty.0.state).unwrap().loaded);
        assert!(service.finish_load(0, Saved::default()).is_err());
        assert!(service.status().unwrap().accounts[0].connected);
    }
    #[test]
    fn verified_login_is_unusable_until_credential_storage_accepts_it() {
        let service = connected();
        let account = {
            let mut state = lock(&service.0.state).unwrap();
            let account = state.saved.accounts[0].clone();
            state.saved.accounts[0].tokens = None;
            state.saved.active = None;
            account
        };
        let (attempt, cancel) = service.begin_login().unwrap();
        assert!(service
            .commit_login_with(attempt, &cancel, account.clone(), |_| {
                assert!(!service.ready());
                assert!(!service.status().unwrap().accounts[0].connected);
                Err("Keychain denied".into())
            })
            .is_err());
        assert!(!service.ready());
        assert!(lock(&service.0.state).unwrap().saved.accounts[0]
            .tokens
            .is_none());

        service.cancel_login().unwrap();
        let (attempt, cancel) = service.begin_login().unwrap();
        service
            .commit_login_with(attempt, &cancel, account, |_| {
                assert!(!service.ready());
                Ok(())
            })
            .unwrap();
        assert!(service.ready());
        assert!(!service.status().unwrap().login_pending);
    }
    #[test]
    fn cancelled_keychain_write_restores_the_newest_account_state() {
        let service = connected();
        let account = {
            let mut state = lock(&service.0.state).unwrap();
            let account = state.saved.accounts[0].clone();
            state.saved.accounts[0].tokens = None;
            state.saved.active = None;
            account
        };
        let mut newer = account.clone();
        newer.id = "newer-account".into();
        newer.client_id = "oaiapp_newer".into();
        let (attempt, cancel) = service.begin_login().unwrap();
        let mut writes = Vec::new();
        assert!(service
            .commit_login_with(attempt, &cancel, account, |saved| {
                writes.push(saved.clone());
                if writes.len() == 1 {
                    service.cancel_login().unwrap();
                    let mut state = lock(&service.0.state).unwrap();
                    state.saved.accounts.push(newer.clone());
                    state.saved.active = Some(newer.id.clone());
                    service.0.generation.fetch_add(1, Ordering::SeqCst);
                }
                Ok(())
            })
            .is_err());
        assert_eq!(writes.len(), 2);
        assert_eq!(writes[1].active.as_deref(), Some("newer-account"));
        assert!(writes[1].accounts[0].tokens.is_none());
        assert!(lock(&service.0.state).unwrap().saved == writes[1]);
        assert_eq!(
            service.status().unwrap().active_account_id.as_deref(),
            Some("newer-account")
        );
    }
    #[tokio::test]
    async fn cancelling_while_restore_waits_never_starts_a_late_login() {
        let service = Service::new(Path::new("/synthetic-chatgpt-blocked-restore"));
        let blocked = service.0.loading.lock().await;
        let (attempt, cancel) = service.begin_login().unwrap();
        let worker = service.clone();
        let pending = tokio::spawn(async move { worker.initialize_login(attempt, cancel).await });
        tokio::task::yield_now().await;
        assert!(service.status().unwrap().login_pending);
        service.cancel_login().unwrap();
        let result = tokio::time::timeout(Duration::from_secs(1), pending)
            .await
            .unwrap()
            .unwrap();
        assert!(result.is_err());
        assert!(!service.status().unwrap().login_pending);
        assert!(!lock(&service.0.state).unwrap().loaded);
        drop(blocked);
    }
    #[test]
    fn public_status_has_no_credentials_and_uses_only_granted_permission() {
        let service = connected();
        assert!(service.ready());
        let value = serde_json::to_string(&service.status().unwrap()).unwrap();
        assert!(!value.contains("never-expose"));
        assert!(!value.contains("oaiapp_test"));
        assert!(value.contains("test@example.invalid"));
        lock(&service.0.state).unwrap().saved.accounts[0]
            .tokens
            .as_mut()
            .unwrap()
            .scopes
            .clear();
        assert!(!service.ready());
        assert!(service.status().unwrap().accounts[0].connected);
        assert!(!service.status().unwrap().accounts[0].sharing);
    }
    #[test]
    fn cancelled_login_and_old_account_failures_cannot_change_current_session() {
        let service = connected();
        let cancel = Arc::new(AtomicBool::new(false));
        lock(&service.0.state).unwrap().pending = Some((1, cancel.clone()));
        service.cancel_login().unwrap();
        assert!(cancel.load(Ordering::SeqCst));
        assert!(!service.status().unwrap().login_pending);
        service.0.generation.store(2, Ordering::SeqCst);
        service.failure(
            &responses::Failure {
                message: "old limit".into(),
                usage_limit: true,
            },
            1,
        );
        assert!(service.ready());
        service.failure(
            &responses::Failure {
                message: "current limit".into(),
                usage_limit: true,
            },
            2,
        );
        assert!(!service.ready());
        assert!(service.status().unwrap().request_blocked);
    }
    #[test]
    fn legacy_settings_gain_disconnected_chatgpt_defaults_without_changing_provider() {
        let mut value = serde_json::to_value(Settings::default()).unwrap();
        let object = value.as_object_mut().unwrap();
        object.remove("chatgptModel");
        object.remove("chatgptIdleEnabled");
        let settings: Settings = serde_json::from_value(value).unwrap();
        assert_eq!(settings.mode, "local");
        assert!(settings.chatgpt_model.is_empty());
        assert!(!settings.chatgpt_idle_enabled);
    }
}
