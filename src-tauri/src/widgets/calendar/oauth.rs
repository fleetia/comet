use super::*;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use sha2::{Digest, Sha256};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};

const SCOPE: &str = "https://www.googleapis.com/auth/calendar.events.readonly";
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GoogleConnectInput {
    pub name: String,
    pub client_id: String,
    pub client_secret: Option<String>,
    pub calendar_ids: Vec<String>,
}
pub struct GooglePending {
    pub authorization_url: String,
    listener: TcpListener,
    state: String,
    verifier: String,
    redirect_uri: String,
    input: GoogleConnectInput,
    expires: tokio::time::Instant,
}
pub async fn begin_google(input: GoogleConnectInput) -> Result<GooglePending, CalendarError> {
    validate_name(&input.name)?;
    if !input.client_id.ends_with(".apps.googleusercontent.com")
        || input.client_id.len() > 300
        || input.client_id.chars().any(char::is_whitespace)
    {
        return Err(invalid("Google Desktop OAuth client ID를 입력하세요."));
    }
    if input.client_secret.as_ref().is_some_and(|x| x.len() > 1000) {
        return Err(invalid("OAuth client secret이 너무 깁니다."));
    }
    if input.calendar_ids.is_empty()
        || input.calendar_ids.len() > 20
        || input
            .calendar_ids
            .iter()
            .any(|x| x.trim().is_empty() || x.len() > 1000)
    {
        return Err(invalid(
            "조회할 calendar ID를 1~20개 선택하세요. 기본 캘린더 ID는 primary입니다.",
        ));
    }
    let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .map_err(|_| error("offline", "로그인 응답을 받을 로컬 포트를 열 수 없습니다."))?;
    let port = listener
        .local_addr()
        .map_err(|_| error("offline", "로컬 포트 오류"))?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}");
    let state = uuid::Uuid::new_v4().simple().to_string();
    let verifier = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let mut url = reqwest::Url::parse("https://accounts.google.com/o/oauth2/v2/auth")
        .map_err(|_| invalid("인증 주소 오류"))?;
    url.query_pairs_mut().extend_pairs([
        ("client_id", input.client_id.as_str()),
        ("redirect_uri", redirect_uri.as_str()),
        ("response_type", "code"),
        ("scope", SCOPE),
        ("state", state.as_str()),
        ("code_challenge", challenge.as_str()),
        ("code_challenge_method", "S256"),
        ("access_type", "offline"),
        ("prompt", "consent"),
    ]);
    Ok(GooglePending {
        authorization_url: url.into(),
        listener,
        state,
        verifier,
        redirect_uri,
        input,
        expires: tokio::time::Instant::now() + Duration::from_secs(180),
    })
}
fn callback_code(request: &str, expected_state: &str) -> Result<String, CalendarError> {
    let first = request
        .lines()
        .next()
        .ok_or_else(|| invalid("인증 응답 오류"))?;
    let mut parts = first.split_whitespace();
    if parts.next() != Some("GET") {
        return Err(invalid("인증 응답 방식 오류"));
    }
    let path = parts.next().ok_or_else(|| invalid("인증 응답 경로 오류"))?;
    let url = reqwest::Url::parse(&format!("http://127.0.0.1{path}"))
        .map_err(|_| invalid("인증 응답 주소 오류"))?;
    if url.path() != "/" {
        return Err(invalid("인증 응답 경로 오류"));
    }
    let query: Vec<_> = url.query_pairs().collect();
    let states: Vec<_> = query.iter().filter(|(k, _)| k == "state").collect();
    if states.len() != 1 || states[0].1 != expected_state {
        return Err(error("auth-error", "로그인 요청 상태가 일치하지 않습니다."));
    }
    if query.iter().any(|(k, _)| k == "error") {
        return Err(error(
            "auth-error",
            "Google 로그인이 취소되었거나 거절되었습니다.",
        ));
    }
    let codes: Vec<_> = query.iter().filter(|(k, _)| k == "code").collect();
    if codes.len() != 1 || codes[0].1.is_empty() || codes[0].1.len() > 4096 {
        return Err(invalid("인증 코드 오류"));
    }
    Ok(codes[0].1.to_string())
}
pub async fn finish_google(pending: GooglePending) -> Result<Connected, CalendarError> {
    let accepted = tokio::time::timeout_at(pending.expires, pending.listener.accept())
        .await
        .map_err(|_| {
            error(
                "auth-error",
                "로그인 대기 시간이 끝났습니다. 다시 연결해 주세요.",
            )
        })?
        .map_err(|_| error("offline", "로그인 응답 연결 오류"))?;
    let (mut socket, address) = accepted;
    if !address.ip().is_loopback() {
        return Err(error("auth-error", "로컬 인증 응답이 아닙니다."));
    }
    let read = async {
        let mut bytes = Vec::new();
        let mut chunk = [0u8; 1024];
        loop {
            let count = socket
                .read(&mut chunk)
                .await
                .map_err(|_| invalid("인증 응답 읽기 오류"))?;
            if count == 0 {
                return Err(invalid("인증 응답이 종료되었습니다."));
            }
            bytes.extend_from_slice(&chunk[..count]);
            if bytes.len() > 16384 {
                return Err(invalid("인증 응답이 너무 큽니다."));
            }
            if bytes.windows(4).any(|x| x == b"\r\n\r\n") {
                break;
            }
        }
        String::from_utf8(bytes).map_err(|_| invalid("인증 응답 문자 오류"))
    };
    let request = tokio::time::timeout(Duration::from_secs(5), read)
        .await
        .map_err(|_| invalid("인증 응답 읽기 시간이 끝났습니다."))??;
    let code = callback_code(&request, &pending.state);
    let message = if code.is_ok() {
        "Google login received. You may return to comet."
    } else {
        "Google login failed. Please return to comet and retry."
    };
    let response=format!("HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nContent-Security-Policy: default-src 'none'\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{message}",message.len());
    let _ = tokio::time::timeout(
        Duration::from_secs(2),
        socket.write_all(response.as_bytes()),
    )
    .await;
    let code = code?;
    let mut form = vec![
        ("client_id", pending.input.client_id.as_str()),
        ("code", code.as_str()),
        ("code_verifier", pending.verifier.as_str()),
        ("grant_type", "authorization_code"),
        ("redirect_uri", pending.redirect_uri.as_str()),
    ];
    if let Some(secret) = &pending.input.client_secret {
        form.push(("client_secret", secret));
    }
    let result = json_response(
        client()?
            .post("https://oauth2.googleapis.com/token")
            .form(&form)
            .send()
            .await
            .map_err(|_| error("offline", "Google 인증 서버에 연결하지 못했습니다."))?,
    )
    .await?;
    let connection = connection(pending.input.name, "google");
    let mut credential = Credential {
        connection_id: connection.id.clone(),
        provider: "google".into(),
        url: None,
        client_id: Some(pending.input.client_id),
        client_secret: pending.input.client_secret,
        access_token: None,
        refresh_token: None,
        expires_at: None,
        calendar_ids: pending.input.calendar_ids,
    };
    apply_tokens(&mut credential, &result, Utc::now().timestamp_millis())?;
    if credential.refresh_token.is_none() {
        return Err(error(
            "auth-error",
            "오프라인 조회 권한을 받지 못했습니다. 다시 동의해 주세요.",
        ));
    }
    Ok(Connected {
        connection,
        credential,
    })
}
fn apply_tokens(
    credential: &mut Credential,
    result: &Value,
    now: i64,
) -> Result<(), CalendarError> {
    if let Some(scopes) = result["scope"].as_str() {
        if !scopes.split_whitespace().any(|scope| scope == SCOPE) {
            return Err(error("auth-error", "캘린더 읽기 권한이 필요합니다."));
        }
    }
    let token = string(result, "access_token")
        .map_err(|_| error("auth-error", "Google 인증 응답에 access token이 없습니다."))?;
    if result["token_type"]
        .as_str()
        .is_some_and(|x| !x.eq_ignore_ascii_case("bearer"))
    {
        return Err(error("auth-error", "지원하지 않는 인증 token 형식입니다."));
    }
    let expires = result["expires_in"]
        .as_i64()
        .filter(|n| *n > 0 && *n <= 86400)
        .ok_or_else(|| error("auth-error", "Google 인증 만료 시각 오류"))?;
    credential.access_token = Some(token);
    credential.expires_at = Some(now.saturating_add(expires * 1000));
    if let Some(token) = result["refresh_token"].as_str() {
        credential.refresh_token = Some(token.into());
    }
    Ok(())
}
pub(super) async fn refresh_token(
    credential: &mut Credential,
    now: i64,
) -> Result<(), CalendarError> {
    if credential
        .expires_at
        .is_some_and(|at| at > now.saturating_add(60000))
    {
        return Ok(());
    }
    let refresh = credential
        .refresh_token
        .as_deref()
        .ok_or_else(|| error("auth-error", "Google 연결을 다시 인증해 주세요."))?;
    let client_id = credential
        .client_id
        .as_deref()
        .ok_or_else(|| error("auth-error", "Google client ID가 없습니다."))?;
    let mut form = vec![
        ("client_id", client_id),
        ("refresh_token", refresh),
        ("grant_type", "refresh_token"),
    ];
    if let Some(secret) = credential.client_secret.as_deref() {
        form.push(("client_secret", secret));
    }
    let response = client()?
        .post("https://oauth2.googleapis.com/token")
        .form(&form)
        .send()
        .await
        .map_err(|_| error("offline", "Google 인증 갱신에 연결하지 못했습니다."))?;
    if response.status() == reqwest::StatusCode::BAD_REQUEST {
        return Err(error("auth-error", "Google 연결을 다시 인증해 주세요."));
    }
    let result = json_response(response).await?;
    apply_tokens(credential, &result, now)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn callback_requires_matching_unique_state_and_code() {
        assert_eq!(
            callback_code("GET /?state=nonce&code=secret HTTP/1.1\r\n\r\n", "nonce").unwrap(),
            "secret"
        );
        for query in [
            "state=wrong&code=x",
            "state=nonce&state=nonce&code=x",
            "state=nonce&error=denied",
            "state=nonce&code=x&code=y",
        ] {
            assert!(callback_code(&format!("GET /?{query} HTTP/1.1\r\n\r\n"), "nonce").is_err());
        }
    }
    #[tokio::test]
    async fn pkce_begin_uses_readonly_scope_loopback_and_unique_state() {
        let input = || GoogleConnectInput {
            name: "개인".into(),
            client_id: "test.apps.googleusercontent.com".into(),
            client_secret: None,
            calendar_ids: vec!["primary".into()],
        };
        let first = begin_google(input()).await.unwrap();
        let second = begin_google(input()).await.unwrap();
        assert_ne!(first.state, second.state);
        let url = reqwest::Url::parse(&first.authorization_url).unwrap();
        let fields: std::collections::BTreeMap<_, _> = url.query_pairs().collect();
        assert_eq!(fields["scope"], SCOPE);
        assert_eq!(fields["code_challenge_method"], "S256");
        assert!(fields["redirect_uri"].starts_with("http://127.0.0.1:"));
        assert!(!first.authorization_url.contains(&first.verifier));
    }
}
