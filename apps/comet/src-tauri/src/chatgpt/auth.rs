use super::*;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use jsonwebtoken::{decode, decode_header, jwk::JwkSet, Algorithm, DecodingKey, Validation};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};

const AUTHORIZE: &str = "https://auth.openai.com/api/accounts/authorize";
const TOKEN: &str = "https://auth.openai.com/api/accounts/oauth/token";
const SCOPE: &str = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const CALLBACK: &str = "/auth/callback";
const PROTOCOL_ERROR_PREFIX: &str = "chatgpt_protocol_error:";

fn protocol_error(error: impl std::fmt::Display) -> String {
    format!("{PROTOCOL_ERROR_PREFIX}{error}")
}

pub(super) fn protocol_error_detail(error: &str) -> Option<&str> {
    error.strip_prefix(PROTOCOL_ERROR_PREFIX)
}
pub(super) struct TokenError {
    pub message: String,
    pub terminal_refresh: bool,
}
#[derive(Deserialize)]
struct Discovery {
    issuer: String,
    jwks_uri: String,
    revocation_endpoint: Option<String>,
}
#[derive(Clone, Deserialize)]
struct Identity {
    sub: String,
    nonce: Option<String>,
    email: Option<String>,
    iat: i64,
}
struct Callback {
    code: String,
    client_id: String,
}

pub(super) fn http() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| "ChatGPT 연결을 준비하지 못했어요.".into())
}
pub(super) async fn read_json(response: reqwest::Response) -> Result<Value> {
    read_json_limited(response, 512 * 1024).await
}
pub(super) async fn read_json_limited(
    response: reqwest::Response,
    max_bytes: usize,
) -> Result<Value> {
    use futures_util::StreamExt;
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| "ChatGPT 응답 수신이 중단됐어요.")?;
        if bytes.len() + chunk.len() > max_bytes {
            return Err("ChatGPT 응답 크기가 한도를 넘었어요.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| "ChatGPT 응답 형식을 확인할 수 없어요.".into())
}
fn trusted_auth_url(raw: &str) -> bool {
    reqwest::Url::parse(raw).is_ok_and(|url| {
        url.scheme() == "https"
            && url.host_str() == Some("auth.openai.com")
            && url.port_or_known_default() == Some(443)
            && url.username().is_empty()
            && url.password().is_none()
            && url.query().is_none()
            && url.fragment().is_none()
    })
}
async fn discovery() -> Result<Discovery> {
    let response = http()?
        .get(format!("{ISSUER}/.well-known/openid-configuration"))
        .send()
        .await
        .map_err(|_| "ChatGPT 인증 정보를 가져오지 못했어요.")?;
    if !response.status().is_success() {
        return Err("ChatGPT 인증 정보를 확인하지 못했어요.".into());
    }
    let config: Discovery = serde_json::from_value(read_json(response).await?)
        .map_err(|_| "ChatGPT 인증 정보 형식 오류")?;
    if config.issuer != ISSUER
        || !trusted_auth_url(&config.jwks_uri)
        || config
            .revocation_endpoint
            .as_ref()
            .is_some_and(|u| !trusted_auth_url(u))
    {
        return Err("ChatGPT 인증 서버 주소를 확인할 수 없어요.".into());
    }
    Ok(config)
}
fn random() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}
pub(super) fn valid_client_id(id: &str) -> bool {
    id.starts_with("oaiapp_")
        && id.len() <= 256
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
}
fn callback(request: &str, state: &str, existing: Option<&str>) -> Result<Callback> {
    let mut parts = request
        .lines()
        .next()
        .ok_or("로그인 응답이 비어 있어요.")?
        .split_whitespace();
    if parts.next() != Some("GET") {
        return Err("로그인 응답 방식이 올바르지 않아요.".into());
    }
    let path = parts.next().ok_or("로그인 응답 경로가 없어요.")?;
    if !path.starts_with('/') || path.starts_with("//") {
        return Err("로그인 응답 경로가 올바르지 않아요.".into());
    }
    let url = reqwest::Url::parse(&format!("http://127.0.0.1{path}"))
        .map_err(|_| "로그인 응답 주소 오류")?;
    if url.path() != CALLBACK || url.fragment().is_some() {
        return Err("로그인 응답 경로가 일치하지 않아요.".into());
    }
    let query: Vec<_> = url.query_pairs().collect();
    let get = |key: &str| -> Result<Option<String>> {
        let values: Vec<_> = query.iter().filter(|(k, _)| k == key).collect();
        if values.len() > 1 {
            return Err("중복된 로그인 응답을 거절했어요.".into());
        }
        Ok(values.first().map(|(_, v)| v.to_string()))
    };
    if get("state")?.as_deref() != Some(state) {
        return Err("로그인 요청 상태가 일치하지 않아요.".into());
    }
    if get("error")?.is_some() {
        return Err("ChatGPT 로그인이 취소되었거나 권한이 허용되지 않았어요.".into());
    }
    let code = get("code")?
        .filter(|c| !c.is_empty() && c.len() <= 8192)
        .ok_or("로그인 코드가 올바르지 않아요.")?;
    let issued = get("client_id")?;
    let client_id = match (existing, issued) {
        (Some(id), Some(other)) if id != other => {
            return Err("선택한 계정과 로그인 등록 정보가 달라요.".into())
        }
        (Some(id), _) => id.to_owned(),
        (None, Some(id)) => id,
        _ => return Err("ChatGPT가 발급한 앱 식별자가 없어요. 다시 연결해 주세요.".into()),
    };
    if !valid_client_id(&client_id) {
        return Err("ChatGPT 앱 식별자가 올바르지 않아요.".into());
    }
    Ok(Callback { code, client_id })
}
async fn receive(listener: TcpListener, state: &str, existing: Option<&str>) -> Result<Callback> {
    let (mut socket, address) = listener
        .accept()
        .await
        .map_err(|_| "로그인 응답 연결 실패")?;
    if !address.ip().is_loopback() {
        return Err("로컬 로그인 응답이 아니에요.".into());
    }
    let request = tokio::time::timeout(Duration::from_secs(5), async {
        let mut bytes = Vec::new();
        loop {
            let mut buffer = [0; 1024];
            let count = socket
                .read(&mut buffer)
                .await
                .map_err(|_| "로그인 응답 읽기 실패")?;
            if count == 0 || bytes.len() + count > 16384 {
                return Err("로그인 응답 크기가 올바르지 않아요.");
            }
            bytes.extend_from_slice(&buffer[..count]);
            if bytes.windows(4).any(|part| part == b"\r\n\r\n") {
                break;
            }
        }
        String::from_utf8(bytes).map_err(|_| "로그인 응답 문자 오류")
    })
    .await
    .map_err(|_| "로그인 응답 대기 시간이 끝났어요.")??;
    let result = callback(&request, state, existing);
    let message = if result.is_ok() {
        "Login received. Return to Comet to finish connecting."
    } else {
        "Login could not be verified. Return to Comet and try again."
    };
    let response = format!("HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nContent-Security-Policy: default-src 'none'\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{message}", message.len());
    let _ = tokio::time::timeout(
        Duration::from_secs(2),
        socket.write_all(response.as_bytes()),
    )
    .await;
    result
}
pub(super) fn open_browser(url: &str) -> Result<()> {
    let url = reqwest::Url::parse(url).map_err(|_| "ChatGPT 링크가 올바르지 않아요.")?;
    if url.scheme() != "https" || !matches!(url.host_str(), Some("auth.openai.com" | "chatgpt.com"))
    {
        return Err("공식 ChatGPT 링크만 열 수 있어요.".into());
    }
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("/usr/bin/open");
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut c = std::process::Command::new("rundll32.exe");
        c.arg("url.dll,FileProtocolHandler");
        c
    };
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let mut command = std::process::Command::new("xdg-open");
    let mut child = command
        .arg(url.as_str())
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|_| "기본 브라우저를 열지 못했어요.")?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}
fn authorization_url(
    saved: &Saved,
    account: Option<&Account>,
    redirect: &str,
    state: &str,
    nonce: &str,
    verifier: &str,
    consent: bool,
) -> Result<String> {
    let mut url = reqwest::Url::parse(AUTHORIZE).map_err(|_| "인증 주소 오류")?;
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    url.query_pairs_mut().extend_pairs([
        (
            "client_id",
            account.map_or("dynamic_agent_client", |a| a.client_id.as_str()),
        ),
        ("ext_agent_host_id", saved.host_id.as_str()),
        ("response_type", "code"),
        ("redirect_uri", redirect),
        ("scope", SCOPE),
        ("resource", RESOURCE),
        ("state", state),
        ("nonce", nonce),
        ("code_challenge_method", "S256"),
        ("code_challenge", challenge.as_str()),
    ]);
    if let Some(account) = account {
        if let Some(email) = account.email.as_deref() {
            url.query_pairs_mut().append_pair("login_hint", email);
        }
        if let Some(hint) = account.tokens.as_ref().and_then(|t| t.id_token.as_deref()) {
            url.query_pairs_mut().append_pair("id_token_hint", hint);
        }
    } else {
        url.query_pairs_mut()
            .append_pair("agent_name_hint", "Comet");
    }
    if consent {
        url.query_pairs_mut().append_pair("prompt", "consent");
    }
    Ok(url.into())
}
pub(super) fn check_attempt(service: &Service, attempt: u64, cancel: &AtomicBool) -> Result<()> {
    if cancel.load(Ordering::Acquire)
        || service.0.login_generation.load(Ordering::SeqCst) != attempt
    {
        Err("연결을 취소했어요.".into())
    } else {
        Ok(())
    }
}
pub(super) async fn login(
    service: &Service,
    saved: Saved,
    account_id: Option<&str>,
    consent: bool,
    attempt: u64,
    cancel: Arc<AtomicBool>,
) -> Result<()> {
    let operation = async {
        // The stable host registration is created only after an explicit login request.
        service.persist().await?;
        check_attempt(service, attempt, &cancel)?;
        let account = saved
            .accounts
            .iter()
            .find(|a| Some(a.id.as_str()) == account_id);
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .map_err(|_| protocol_error("로그인 응답을 받을 로컬 포트를 열지 못했어요."))?;
        let redirect = format!(
            "http://127.0.0.1:{}{CALLBACK}",
            listener
                .local_addr()
                .map_err(|_| protocol_error("로그인 포트 확인 실패"))?
                .port()
        );
        let state = random();
        let nonce = random();
        let verifier = random();
        let url = authorization_url(
            &saved, account, &redirect, &state, &nonce, &verifier, consent,
        )?;
        check_attempt(service, attempt, &cancel)?;
        open_browser(&url)?;
        let received = receive(listener, &state, account.map(|a| a.client_id.as_str()))
            .await
            .map_err(protocol_error)?;
        let id = account
            .map(|a| a.id.clone())
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        {
            // Retain issued registration even if the single-use code expires later.
            let mut inner = lock(&service.0.state)?;
            check_attempt(service, attempt, &cancel)?;
            if account.is_none() {
                if inner
                    .saved
                    .accounts
                    .iter()
                    .any(|a| a.client_id == received.client_id)
                {
                    return Err(
                        "이미 저장된 ChatGPT 등록이에요. 해당 계정을 선택해 다시 연결해 주세요."
                            .into(),
                    );
                }
                let mut next = inner.saved.clone();
                next.accounts.push(Account {
                    id: id.clone(),
                    client_id: received.client_id.clone(),
                    subject: None,
                    email: None,
                    tokens: None,
                });
                inner.saved = next;
            }
        }
        service.persist().await?;
        check_attempt(service, attempt, &cancel)?;
        let result = token_request(&[
            ("grant_type", "authorization_code"),
            ("client_id", &received.client_id),
            ("code", &received.code),
            ("code_verifier", &verifier),
            ("redirect_uri", &redirect),
            ("resource", RESOURCE),
        ])
        .await
        .map_err(|e| e.message)?;
        let id_token = result["id_token"]
            .as_str()
            .ok_or_else(|| protocol_error("ChatGPT ID token이 없어요."))?;
        let identity = verify_identity(id_token, &received.client_id, Some(&nonce))
            .await
            .map_err(protocol_error)?;
        if account
            .and_then(|a| a.subject.as_ref())
            .is_some_and(|sub| sub != &identity.sub)
        {
            return Err(protocol_error(
                "선택한 ChatGPT 계정과 로그인한 계정이 달라요.",
            ));
        }
        let tokens = parse_tokens(&result, None).map_err(protocol_error)?;
        service
            .commit_login(
                attempt,
                cancel.clone(),
                Account {
                    id,
                    client_id: received.client_id,
                    subject: Some(identity.sub),
                    email: identity.email,
                    tokens: Some(tokens),
                },
            )
            .await?;
        Ok(())
    };
    tokio::select! {
        _ = crate::models::cancelled(cancel.clone()) => Err("연결을 취소했어요.".into()),
        value = tokio::time::timeout(Duration::from_secs(600), operation) => match value {
            Ok(result) => result,
            Err(_) => {
                cancel.store(true, Ordering::SeqCst);
                Err("연결 대기 시간이 끝났어요.".into())
            }
        },
    }
}
fn verify_with_keys(
    token: &str,
    client_id: &str,
    nonce: Option<&str>,
    keys: &JwkSet,
) -> Result<Identity> {
    let header = decode_header(token).map_err(|_| "ChatGPT ID token 형식 오류")?;
    if !matches!(header.alg, Algorithm::RS256 | Algorithm::ES256) {
        return Err("지원하지 않는 ChatGPT ID token 서명이에요.".into());
    }
    let kid = header
        .kid
        .as_deref()
        .ok_or("ChatGPT ID token 키 식별자가 없어요.")?;
    let jwk = keys
        .find(kid)
        .ok_or("ChatGPT ID token 서명 키를 찾지 못했어요.")?;
    let key = DecodingKey::from_jwk(jwk).map_err(|_| "ChatGPT 서명 키 형식 오류")?;
    let mut validation = Validation::new(header.alg);
    validation.set_issuer(&[ISSUER]);
    validation.set_audience(&[client_id]);
    validation.set_required_spec_claims(&["sub", "exp", "iat", "iss", "aud"]);
    validation.validate_nbf = true;
    validation.leeway = 5;
    let identity = decode::<Identity>(token, &key, &validation)
        .map_err(|_| "ChatGPT 계정 서명·발급자·만료를 검증하지 못했어요.")?
        .claims;
    if identity.sub.is_empty()
        || identity.sub.len() > 512
        || identity.iat > chrono::Utc::now().timestamp() + 5
        || nonce.is_some_and(|n| identity.nonce.as_deref() != Some(n))
    {
        return Err("ChatGPT 계정 또는 로그인 nonce가 일치하지 않아요.".into());
    }
    Ok(identity)
}
async fn verify_identity(token: &str, client_id: &str, nonce: Option<&str>) -> Result<Identity> {
    let config = discovery().await?;
    let response = http()?
        .get(&config.jwks_uri)
        .send()
        .await
        .map_err(|_| "ChatGPT 서명 키를 가져오지 못했어요.")?;
    if !response.status().is_success() {
        return Err("ChatGPT 서명 키를 확인하지 못했어요.".into());
    }
    let keys: JwkSet = serde_json::from_value(read_json(response).await?)
        .map_err(|_| "ChatGPT 서명 키 형식 오류")?;
    verify_with_keys(token, client_id, nonce, &keys)
}
fn parse_tokens(value: &Value, previous: Option<&Tokens>) -> Result<Tokens> {
    let access_token = value["access_token"]
        .as_str()
        .filter(|v| !v.is_empty() && v.len() <= 32768 && !v.contains(['\r', '\n']))
        .ok_or("ChatGPT access token 형식 오류")?
        .to_owned();
    if !value["token_type"]
        .as_str()
        .is_some_and(|v| v.eq_ignore_ascii_case("bearer"))
    {
        return Err("ChatGPT token 형식이 Bearer가 아니에요.".into());
    }
    let expires = value["expires_in"]
        .as_i64()
        .filter(|n| *n > 0 && *n <= 86400)
        .ok_or("ChatGPT token 만료 정보 오류")?;
    let scopes = match value["scope"].as_str() {
        Some(s) => s.split_whitespace().map(str::to_string).collect(),
        None => previous.map(|t| t.scopes.clone()).unwrap_or_default(),
    };
    let optional = |key: &str| -> Result<Option<String>> {
        value
            .get(key)
            .map(|v| {
                v.as_str()
                    .filter(|s| !s.is_empty() && s.len() <= 32768)
                    .map(str::to_owned)
                    .ok_or_else(|| "ChatGPT token 형식 오류".into())
            })
            .transpose()
    };
    let refresh_token =
        optional("refresh_token")?.or_else(|| previous.and_then(|t| t.refresh_token.clone()));
    let id_token = optional("id_token")?.or_else(|| previous.and_then(|t| t.id_token.clone()));
    Ok(Tokens {
        access_token,
        refresh_token,
        id_token,
        expires_at: chrono::Utc::now().timestamp().saturating_add(expires),
        scopes,
    })
}
async fn token_request(form: &[(&str, &str)]) -> std::result::Result<Value, TokenError> {
    let generic = |message: String| TokenError {
        message,
        terminal_refresh: false,
    };
    let response = http()
        .map_err(generic)?
        .post(TOKEN)
        .form(form)
        .send()
        .await
        .map_err(|_| generic("ChatGPT 인증 서버에 연결하지 못했어요.".into()))?;
    let status = response.status();
    let body = read_json(response).await.map_err(generic)?;
    if !status.is_success() {
        let code = body["error"]
            .as_str()
            .or_else(|| body.pointer("/error/code").and_then(Value::as_str))
            .unwrap_or("");
        let terminal = matches!(
            code,
            "invalid_grant"
                | "invalid_refresh_token"
                | "token_expired"
                | "refresh_token_expired"
                | "refresh_token_invalidated"
                | "refresh_token_reused"
        );
        return Err(TokenError {
            terminal_refresh: terminal,
            message: if terminal {
                "ChatGPT를 다시 연결해 주세요.".into()
            } else if code == "invalid_client" {
                "ChatGPT 앱 등록 정보를 확인할 수 없어요.".into()
            } else {
                format!("ChatGPT 인증 요청에 실패했어요 (HTTP {}).", status.as_u16())
            },
        });
    }
    Ok(body)
}
pub(super) async fn refresh(account: &Account) -> std::result::Result<Tokens, TokenError> {
    let previous = account.tokens.as_ref().ok_or(TokenError {
        message: "ChatGPT를 다시 연결해 주세요.".into(),
        terminal_refresh: true,
    })?;
    let refresh = previous.refresh_token.as_deref().ok_or(TokenError {
        message: "ChatGPT를 다시 연결해 주세요.".into(),
        terminal_refresh: true,
    })?;
    let value = token_request(&[
        ("grant_type", "refresh_token"),
        ("client_id", &account.client_id),
        ("refresh_token", refresh),
        ("resource", RESOURCE),
    ])
    .await?;
    if let Some(token) = value["id_token"].as_str() {
        let identity = verify_identity(token, &account.client_id, None)
            .await
            .map_err(|message| TokenError {
                message,
                terminal_refresh: false,
            })?;
        if account.subject.as_deref() != Some(identity.sub.as_str()) {
            return Err(TokenError {
                message: "갱신된 ChatGPT 계정이 기존 계정과 달라요.".into(),
                terminal_refresh: true,
            });
        }
    }
    parse_tokens(&value, Some(previous)).map_err(|message| TokenError {
        message,
        terminal_refresh: false,
    })
}
pub(super) async fn revoke(account: &Account) -> bool {
    let Some(refresh) = account
        .tokens
        .as_ref()
        .and_then(|t| t.refresh_token.as_deref())
    else {
        return account.tokens.is_none();
    };
    let operation = async {
        let endpoint = discovery()
            .await?
            .revocation_endpoint
            .ok_or("ChatGPT 연결 해제 주소가 없어요.")?;
        for attempt in 0..2 {
            let result = http()?
                .post(&endpoint)
                .form(&[
                    ("token", refresh),
                    ("token_type_hint", "refresh_token"),
                    ("client_id", account.client_id.as_str()),
                ])
                .send()
                .await;
            if result
                .as_ref()
                .is_ok_and(|r| r.status() == reqwest::StatusCode::OK)
            {
                return Ok::<bool, String>(true);
            }
            if result.as_ref().is_ok_and(|r| !r.status().is_server_error()) {
                return Ok(false);
            }
            if attempt == 0 {
                tokio::time::sleep(Duration::from_millis(500)).await;
            }
        }
        Ok(false)
    };
    tokio::time::timeout(Duration::from_secs(20), operation)
        .await
        .ok()
        .and_then(std::result::Result::ok)
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn oidc_signature_issuer_audience_expiry_and_nonce_are_all_required() {
        use ring::signature::{EcdsaKeyPair, KeyPair, ECDSA_P256_SHA256_FIXED_SIGNING};
        let random = ring::rand::SystemRandom::new();
        let der = EcdsaKeyPair::generate_pkcs8(&ECDSA_P256_SHA256_FIXED_SIGNING, &random).unwrap();
        let pair =
            EcdsaKeyPair::from_pkcs8(&ECDSA_P256_SHA256_FIXED_SIGNING, der.as_ref(), &random)
                .unwrap();
        let public = pair.public_key().as_ref();
        let keys: JwkSet = serde_json::from_value(serde_json::json!({"keys":[{"kty":"EC","crv":"P-256","kid":"test-key","alg":"ES256","use":"sig","x":URL_SAFE_NO_PAD.encode(&public[1..33]),"y":URL_SAFE_NO_PAD.encode(&public[33..65])}]})).unwrap();
        let now = chrono::Utc::now().timestamp();
        let claims = serde_json::json!({"sub":"subject","iss":ISSUER,"aud":"oaiapp_test","iat":now,"exp":now+3600,"nonce":"one-time"});
        let mut header = jsonwebtoken::Header::new(Algorithm::ES256);
        header.kid = Some("test-key".into());
        let encode = |value: &Value| {
            jsonwebtoken::encode(
                &header,
                value,
                &jsonwebtoken::EncodingKey::from_ec_der(der.as_ref()),
            )
            .unwrap()
        };
        assert_eq!(
            verify_with_keys(&encode(&claims), "oaiapp_test", Some("one-time"), &keys)
                .unwrap()
                .sub,
            "subject"
        );
        for (key, value) in [
            ("iss", serde_json::json!("https://evil.test")),
            ("aud", serde_json::json!("oaiapp_other")),
            ("exp", serde_json::json!(now - 30)),
            ("nonce", serde_json::json!("wrong")),
            ("sub", serde_json::json!("")),
            ("iat", serde_json::json!(now + 300)),
        ] {
            let mut invalid = claims.clone();
            invalid[key] = value;
            assert!(
                verify_with_keys(&encode(&invalid), "oaiapp_test", Some("one-time"), &keys)
                    .is_err(),
                "{key}"
            );
        }
        let signed = encode(&claims);
        let mut parts = signed.split('.').map(str::to_string).collect::<Vec<_>>();
        parts[2] = URL_SAFE_NO_PAD.encode([0_u8; 64]);
        assert!(
            verify_with_keys(&parts.join("."), "oaiapp_test", Some("one-time"), &keys).is_err()
        );
    }
    #[test]
    fn dynamic_registration_requires_issued_id_and_reauthorization_never_swaps_clients() {
        let good =
            "GET /auth/callback?state=nonce&code=secret&client_id=oaiapp_test HTTP/1.1\r\n\r\n";
        assert_eq!(
            callback(good, "nonce", None).unwrap().client_id,
            "oaiapp_test"
        );
        assert!(callback(good, "nonce", Some("oaiapp_other")).is_err());
        for query in [
            "state=nonce&code=x",
            "state=wrong&code=x&client_id=oaiapp_test",
            "state=nonce&state=nonce&code=x",
            "state=nonce&error=access_denied&code=x",
            "state=nonce&code=x&code=y",
            "state=nonce&code=x&client_id=dynamic_agent_client",
        ] {
            assert!(callback(
                &format!("GET /auth/callback?{query} HTTP/1.1\r\n\r\n"),
                "nonce",
                None
            )
            .is_err());
        }
        assert_eq!(
            callback(
                "GET /auth/callback?state=nonce&code=x HTTP/1.1\r\n\r\n",
                "nonce",
                Some("oaiapp_test")
            )
            .unwrap()
            .client_id,
            "oaiapp_test"
        );
    }
    #[test]
    fn new_and_returning_authorization_preserve_registration_and_host() {
        let saved = Saved::default();
        let url = reqwest::Url::parse(
            &authorization_url(
                &saved,
                None,
                "http://127.0.0.1:4321/auth/callback",
                "state",
                "nonce",
                "verifier",
                false,
            )
            .unwrap(),
        )
        .unwrap();
        let query: std::collections::HashMap<_, _> = url.query_pairs().collect();
        assert_eq!(query["client_id"], "dynamic_agent_client");
        assert_eq!(query["ext_agent_host_id"], saved.host_id);
        assert_eq!(query["agent_name_hint"], "Comet");
        assert_eq!(query["code_challenge_method"], "S256");
        assert!(!query.contains_key("prompt"));
        let account = Account {
            id: "one".into(),
            client_id: "oaiapp_test".into(),
            subject: Some("subject".into()),
            email: None,
            tokens: None,
        };
        let url = reqwest::Url::parse(
            &authorization_url(
                &saved,
                Some(&account),
                "http://127.0.0.1:9876/auth/callback",
                "state2",
                "nonce2",
                "verifier2",
                true,
            )
            .unwrap(),
        )
        .unwrap();
        let query: std::collections::HashMap<_, _> = url.query_pairs().collect();
        assert_eq!(query["client_id"], "oaiapp_test");
        assert!(!query.contains_key("agent_name_hint"));
        assert!(!query.contains_key("id_token_hint"));
        assert_eq!(query["prompt"], "consent");
    }
    #[test]
    fn identity_only_signin_stays_connected_without_direct_permission() {
        let tokens = parse_tokens(&serde_json::json!({"access_token":"access","token_type":"Bearer","expires_in":3600,"scope":"openid email"}), None).unwrap();
        assert!(!tokens.scopes.iter().any(|s| s == SHARING_SCOPE));
        assert!(parse_tokens(&serde_json::json!({"access_token":"access\nsecret","token_type":"Bearer","expires_in":3600}), None).is_err());
        for url in [
            "https://auth.openai.com.evil.test/keys",
            "http://auth.openai.com/keys",
            "https://user:pass@auth.openai.com/keys",
            "https://auth.openai.com/keys?secret=x",
        ] {
            assert!(!trusted_auth_url(url));
        }
    }
    #[test]
    fn unverified_hmac_identity_is_rejected() {
        let token = jsonwebtoken::encode(&jsonwebtoken::Header::new(Algorithm::HS256), &serde_json::json!({"sub":"x","iss":ISSUER,"aud":"oaiapp_test","iat":chrono::Utc::now().timestamp(),"exp":chrono::Utc::now().timestamp()+3600,"nonce":"nonce"}), &jsonwebtoken::EncodingKey::from_secret(b"test")).unwrap();
        assert!(verify_with_keys(
            &token,
            "oaiapp_test",
            Some("nonce"),
            &JwkSet { keys: vec![] }
        )
        .is_err());
    }
}
