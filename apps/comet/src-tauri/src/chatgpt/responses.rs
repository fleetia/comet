use super::*;
use futures_util::StreamExt;
use serde_json::json;

const MODEL_CATALOG_LIMIT: usize = 4 * 1024 * 1024;

pub(super) struct Failure {
    pub message: String,
    pub usage_limit: bool,
}
impl From<String> for Failure {
    fn from(message: String) -> Self {
        Self {
            message,
            usage_limit: false,
        }
    }
}
impl From<&str> for Failure {
    fn from(message: &str) -> Self {
        message.to_string().into()
    }
}
fn diagnostic(value: Option<&str>) -> String {
    value
        .filter(|s| {
            s.len() <= 160
                && s.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"._:-/".contains(&b))
        })
        .unwrap_or("unknown")
        .to_owned()
}
fn failure(status: Option<u16>, body: &Value, request_id: Option<&str>) -> Failure {
    let error = body
        .get("error")
        .or_else(|| body.pointer("/response/error"))
        .unwrap_or(body);
    let code = error["code"].as_str().unwrap_or("");
    let message = match code {
        "subscription_sharing_usage_limit_exceeded" => "ChatGPT 앱 사용 한도에 도달했어요. ChatGPT 사용량 설정을 확인해 주세요.",
        "subscription_sharing_user_not_eligible" => "현재 ChatGPT 계정이나 워크스페이스에서는 플랜을 사용할 수 없어요.",
        "subscription_sharing_usage_unavailable" | "subscription_sharing_user_unavailable" => "ChatGPT 사용 가능 상태를 확인하지 못했어요. 연결은 유지되며 잠시 뒤 다시 요청할 수 있어요.",
        "subscription_sharing_unsupported_capability" => "선택한 ChatGPT 모델이 이 요청 형식을 지원하지 않아요.",
        "subscription_sharing_route_not_supported" | "chatpass_v2_scope_not_authorized" | "chatpass_v2_invalid_authorization_context" => "ChatGPT 연결 권한 또는 지원 경로를 확인해 주세요.",
        _ => match status { Some(401) => "ChatGPT 계정과 플랜 사용 권한을 확인해 주세요.", Some(403) => "ChatGPT 계정·지역·정책에서 이 요청을 허용하지 않아요.", Some(429) => "ChatGPT 요청 한도에 도달했어요. 사용량 설정을 확인해 주세요.", Some(503) => "ChatGPT 연결을 일시적으로 사용할 수 없어요. 연결 정보는 유지했어요.", _ => "ChatGPT 요청을 완료하지 못했어요." }
    };
    let shape = if body.get("error").is_some() {
        "error"
    } else if body.get("detail").is_some() {
        "detail"
    } else if body.get("response").is_some() {
        "response"
    } else {
        "other"
    };
    Failure {
        message: format!(
            "{message} (HTTP {}; code={}; param={}; request={}; shape={shape})",
            status
                .map(|s| s.to_string())
                .unwrap_or_else(|| "stream".into()),
            diagnostic(Some(code)),
            diagnostic(error["param"].as_str()),
            diagnostic(request_id)
        ),
        usage_limit: code == "subscription_sharing_usage_limit_exceeded",
    }
}
fn request_id(response: &reqwest::Response) -> Option<String> {
    response
        .headers()
        .get("x-request-id")
        .or_else(|| response.headers().get("openai-request-id"))
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned)
}
fn media_type(value: Option<&str>) -> String {
    diagnostic(value.and_then(|value| value.split(';').next().map(str::trim))).to_ascii_lowercase()
}
fn non_stream_failure(
    status: u16,
    content_type: &str,
    id: Option<&str>,
    body: Option<&Value>,
) -> Failure {
    let empty = Value::Null;
    let value = body.unwrap_or(&empty);
    let mut error = failure(Some(status), value, id);
    let response = value.get("response").unwrap_or(value);
    error.message = format!(
        "ChatGPT 응답이 이벤트 스트림이 아니에요. {} (content-type={}; json={}; response-type={}; response-status={})",
        error.message,
        content_type,
        if body.is_some() { "valid" } else { "unavailable" },
        diagnostic(response["type"].as_str().or_else(|| response["object"].as_str())),
        diagnostic(response["status"].as_str()),
    );
    error
}
pub(super) async fn models(token: &str) -> std::result::Result<Vec<Model>, Failure> {
    let response = auth::http()?
        .get(format!("{RESOURCE}/models"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| Failure::from("ChatGPT 모델 목록을 가져오지 못했어요."))?;
    let status = response.status();
    let id = request_id(&response);
    let body = auth::read_json_limited(response, MODEL_CATALOG_LIMIT).await?;
    if !status.is_success() {
        return Err(failure(Some(status.as_u16()), &body, id.as_deref()));
    }
    parse_models(body)
}
fn parse_models(body: Value) -> std::result::Result<Vec<Model>, Failure> {
    let entries = body["models"]
        .as_array()
        .ok_or("ChatGPT 모델 목록 형식이 올바르지 않아요.")?;
    let mut models = Vec::new();
    for item in entries.iter().filter(|item| item["visibility"] == "list") {
        let slug = item["slug"]
            .as_str()
            .filter(|s| !s.trim().is_empty() && s.len() <= 200)
            .ok_or("ChatGPT 모델 식별자가 올바르지 않아요.")?;
        let name = item["display_name"]
            .as_str()
            .filter(|s| !s.trim().is_empty() && s.len() <= 300)
            .ok_or("ChatGPT 모델 이름이 올바르지 않아요.")?;
        models.push(Model {
            slug: slug.into(),
            display_name: name.into(),
        });
    }
    Ok(models)
}
fn payload(model: &str, messages: &[ChatMessage], schema: Value) -> Result<Value> {
    if model.trim().is_empty() || model.len() > 200 {
        return Err("ChatGPT 모델을 선택해 주세요.".into());
    }
    let mut input = Vec::new();
    for message in messages {
        let role = match message.role.as_str() {
            "system" | "developer" => "developer",
            "user" => "user",
            "assistant" => "assistant",
            _ => return Err("지원하지 않는 대화 역할이에요.".into()),
        };
        input.push(json!({"role":role,"content":message.content}));
    }
    // SIWC HTTP explicitly rejects max_output_tokens and temperature.
    Ok(
        json!({"model":model,"input":input,"store":false,"stream":true,"text":{"format":{"type":"json_schema","name":"response","strict":true,"schema":schema}}}),
    )
}
#[derive(Default)]
struct Events {
    pending: Vec<u8>,
    output: String,
    completed: bool,
    bytes: usize,
    event_count: usize,
    delta_count: usize,
    completed_count: usize,
}
impl Events {
    fn push(&mut self, chunk: &[u8]) -> std::result::Result<(), Failure> {
        self.bytes += chunk.len();
        if self.bytes > 2 * 1024 * 1024 {
            return Err("ChatGPT 응답 크기가 한도를 넘었어요.".into());
        }
        self.pending.extend_from_slice(chunk);
        loop {
            let delimiter = self
                .pending
                .windows(2)
                .position(|w| w == b"\n\n")
                .map(|p| (p, 2));
            let crlf = self
                .pending
                .windows(4)
                .position(|w| w == b"\r\n\r\n")
                .map(|p| (p, 4));
            let boundary = match (delimiter, crlf) {
                (Some(a), Some(b)) => Some(if a.0 < b.0 { a } else { b }),
                (a, None) | (None, a) => a,
            };
            let Some((end, size)) = boundary else {
                break;
            };
            let frame = self.pending.drain(..end + size).collect::<Vec<_>>();
            let text = std::str::from_utf8(&frame)
                .map_err(|_| Failure::from("ChatGPT 스트림 문자 형식 오류"))?;
            let data = text
                .lines()
                .filter_map(|line| {
                    line.strip_prefix("data:")
                        .map(|s| s.strip_prefix(' ').unwrap_or(s))
                })
                .collect::<Vec<_>>()
                .join("\n");
            if data.is_empty() || data == "[DONE]" {
                continue;
            }
            let value: Value = serde_json::from_str(&data)
                .map_err(|_| Failure::from("ChatGPT 스트림 JSON 형식 오류"))?;
            self.event(value)?;
        }
        if self.pending.len() > 512 * 1024 {
            return Err("ChatGPT 스트림 이벤트가 너무 커요.".into());
        }
        Ok(())
    }
    fn event(&mut self, value: Value) -> std::result::Result<(), Failure> {
        self.event_count += 1;
        match value["type"].as_str() {
            Some("response.output_text.delta") => {
                self.delta_count += 1;
                if self.completed {
                    return Err("완료 뒤에 ChatGPT 출력이 도착했어요.".into());
                }
                let delta = value["delta"].as_str().ok_or("ChatGPT 출력 형식 오류")?;
                if self.output.len() + delta.len() > 256 * 1024 {
                    return Err("ChatGPT 출력 크기가 한도를 넘었어요.".into());
                }
                self.output.push_str(delta);
            }
            Some("response.completed") => {
                self.completed_count += 1;
                if self.completed
                    || value.pointer("/response/status").and_then(Value::as_str)
                        != Some("completed")
                {
                    return Err("ChatGPT 완료 상태를 확인하지 못했어요.".into());
                }
                self.completed = true;
            }
            Some("response.failed" | "error") => return Err(failure(None, &value, None)),
            Some("response.incomplete") => {
                return Err("ChatGPT 응답이 끝까지 생성되지 않았어요. 요청을 나눠 주세요.".into())
            }
            Some("response.refusal.delta" | "response.refusal.done") => {
                return Err("ChatGPT가 이 요청에 응답하지 않았어요.".into())
            }
            _ => {}
        }
        Ok(())
    }
    fn finish(&self) -> std::result::Result<Value, Failure> {
        if !self.completed || self.pending.iter().any(|b| !b.is_ascii_whitespace()) {
            return Err("ChatGPT 응답이 완료되기 전에 연결이 끊겼어요.".into());
        }
        serde_json::from_str(self.output.trim())
            .map_err(|_| "ChatGPT가 요청한 JSON 형식으로 답하지 않았어요.".into())
    }
}
pub(super) async fn generate(
    token: &str,
    model: &str,
    messages: &[ChatMessage],
    schema: Value,
    timeout: Duration,
    telemetry: Option<&crate::inference::RequestTelemetry>,
) -> std::result::Result<Value, Failure> {
    let body = payload(model, messages, schema)?;
    let request = auth::http()?
        .post(format!("{RESOURCE}/responses"))
        .bearer_auth(token)
        .header("Accept", "text/event-stream")
        .timeout(timeout)
        .json(&body);
    if let Some(telemetry) = telemetry {
        telemetry.dispatched();
    }
    let response = request.send().await.map_err(|error| {
        Failure::from(if error.is_timeout() {
            "ChatGPT 응답 시간이 초과됐어요."
        } else {
            "ChatGPT에 연결하지 못했어요."
        })
    })?;
    consume_response(response).await
}
fn stream_failure(
    mut error: Failure,
    events: &Events,
    status: u16,
    content_type: &str,
    id: Option<&str>,
) -> Failure {
    error.message.push_str(&format!(
        " (HTTP {status}; content-type={content_type}; request={}; bytes={}; events={}; deltas={}; completed={})",
        diagnostic(id), events.bytes, events.event_count, events.delta_count, events.completed_count
    ));
    error
}
async fn consume_response(response: reqwest::Response) -> std::result::Result<Value, Failure> {
    let status = response.status();
    let id = request_id(&response);
    if !status.is_success() {
        let body = auth::read_json(response).await.unwrap_or(Value::Null);
        return Err(failure(Some(status.as_u16()), &body, id.as_deref()));
    }
    let missing_content_type = !response.headers().contains_key("content-type");
    let content_type = media_type(
        response
            .headers()
            .get("content-type")
            .and_then(|h| h.to_str().ok()),
    );
    if content_type != "text/event-stream" && !missing_content_type {
        // An HTTP success can still contain a structured failure. Never treat a
        // non-streaming JSON response as completed SIWC inference.
        let body = auth::read_json(response).await.ok();
        return Err(non_stream_failure(
            status.as_u16(),
            &content_type,
            id.as_deref(),
            body.as_ref(),
        ));
    }
    let mut events = Events::default();
    let mut json_body: Option<Vec<u8>> = None;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| {
            stream_failure(
                "ChatGPT 응답 수신이 중단됐어요.".into(),
                &events,
                status.as_u16(),
                &content_type,
                id.as_deref(),
            )
        })?;
        if missing_content_type
            && json_body.is_none()
            && events.event_count == 0
            && events.pending.iter().all(u8::is_ascii_whitespace)
            && chunk
                .iter()
                .find(|byte| !byte.is_ascii_whitespace())
                .is_some_and(|byte| matches!(byte, b'{' | b'['))
        {
            json_body = Some(std::mem::take(&mut events.pending));
        }
        if let Some(body) = &mut json_body {
            events.bytes += chunk.len();
            if body.len() + chunk.len() > 512 * 1024 {
                return Err(stream_failure(
                    "ChatGPT 응답 크기가 한도를 넘었어요.".into(),
                    &events,
                    status.as_u16(),
                    &content_type,
                    id.as_deref(),
                ));
            }
            body.extend_from_slice(&chunk);
            continue;
        }
        events.push(&chunk).map_err(|error| {
            stream_failure(
                error,
                &events,
                status.as_u16(),
                &content_type,
                id.as_deref(),
            )
        })?;
    }
    if let Some(body) = json_body {
        let body = serde_json::from_slice::<Value>(&body).ok();
        return Err(non_stream_failure(
            status.as_u16(),
            &content_type,
            id.as_deref(),
            body.as_ref(),
        ));
    }
    events.finish().map_err(|error| {
        stream_failure(
            error,
            &events,
            status.as_u16(),
            &content_type,
            id.as_deref(),
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    async fn response(body: String, content_type: Option<&str>) -> reqwest::Response {
        use tokio::{
            io::{AsyncReadExt, AsyncWriteExt},
            net::TcpListener,
        };
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let content_type = content_type
            .map(|value| format!("Content-Type: {value}\r\n"))
            .unwrap_or_default();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            while !request.windows(4).any(|part| part == b"\r\n\r\n") {
                let mut chunk = [0; 1024];
                let read = stream.read(&mut chunk).await.unwrap();
                assert!(read > 0 && request.len() + read <= 8192);
                request.extend_from_slice(&chunk[..read]);
            }
            let header = format!(
                "HTTP/1.1 200 OK\r\n{content_type}Content-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            if stream.write_all(header.as_bytes()).await.is_ok() {
                let _ = stream.write_all(body.as_bytes()).await;
            }
        });
        reqwest::Client::new()
            .get(format!("http://{address}/fixture"))
            .send()
            .await
            .unwrap()
    }
    #[tokio::test]
    async fn missing_content_type_still_requires_valid_sse_and_terminal_completion() {
        let wire = format!(
            "data: {}\n\ndata: {}\n\n",
            json!({"type":"response.output_text.delta","delta":"{\"ok\":true}"}),
            json!({"type":"response.completed","response":{"status":"completed"}})
        );
        let value = consume_response(response(wire.clone(), None).await)
            .await
            .unwrap_or_else(|error| panic!("{}", error.message));
        assert_eq!(value, json!({"ok":true}));
        // An explicit non-stream MIME is rejected even if its body resembles SSE.
        assert!(
            consume_response(response(wire.clone(), Some("text/html")).await)
                .await
                .is_err()
        );
        let incomplete = wire
            .split("data:")
            .take(2)
            .collect::<Vec<_>>()
            .join("data:");
        let error = consume_response(response(incomplete, None).await)
            .await
            .err()
            .unwrap();
        assert!(error.message.contains("completed=0"));
        assert!(error.message.contains("deltas=1"));
        for body in [
            String::new(),
            "<html>private body</html>".into(),
            json!({"object":"response","status":"completed","output_text":"private body"})
                .to_string(),
        ] {
            let error = consume_response(response(body, None).await)
                .await
                .err()
                .unwrap();
            assert!(!error.message.contains("private body"));
        }
        let error = consume_response(response(
            json!({"error":{"code":"subscription_sharing_usage_limit_exceeded","message":"private body"}}).to_string(),
            None,
        ).await).await.err().unwrap();
        assert!(error.usage_limit);
        assert!(!error.message.contains("private body"));
    }
    #[test]
    fn non_stream_responses_report_only_safe_metadata_and_never_succeed() {
        assert_eq!(
            media_type(Some("Text/Event-Stream; charset=utf-8")),
            "text/event-stream"
        );
        assert_eq!(media_type(Some("text/html; secret=token")), "text/html");
        assert_eq!(media_type(Some("unsafe header value")), "unknown");
        let completed =
            json!({"object":"response","status":"completed","output_text":"private model output"});
        let rejected = non_stream_failure(
            200,
            "application/json",
            Some("request-123"),
            Some(&completed),
        );
        assert!(rejected.message.contains("HTTP 200"));
        assert!(rejected.message.contains("content-type=application/json"));
        assert!(rejected.message.contains("request=request-123"));
        assert!(rejected.message.contains("response-status=completed"));
        assert!(!rejected.message.contains("private model output"));
        assert!(!rejected.usage_limit);
        let limited = non_stream_failure(
            200,
            "application/json",
            None,
            Some(
                &json!({"error":{"code":"subscription_sharing_usage_limit_exceeded","message":"private server message"}}),
            ),
        );
        assert!(limited.usage_limit);
        assert!(!limited.message.contains("private server message"));
        let invalid = non_stream_failure(200, "text/html", None, None);
        assert!(invalid.message.contains("json=unavailable"));
        assert!(invalid.message.contains("content-type=text/html"));
    }
    #[test]
    fn responses_payload_uses_only_siwc_supported_transport_and_developer_role() {
        let value = payload(
            "server-model",
            &[
                ChatMessage {
                    role: "system".into(),
                    content: "JSON only".into(),
                },
                ChatMessage {
                    role: "user".into(),
                    content: "hello".into(),
                },
            ],
            json!({"type":"object"}),
        )
        .unwrap();
        assert_eq!(value["store"], false);
        assert_eq!(value["stream"], true);
        assert_eq!(value["input"][0]["role"], "developer");
        assert_eq!(value["text"]["format"]["type"], "json_schema");
        for field in [
            "temperature",
            "max_output_tokens",
            "previous_response_id",
            "background",
            "tools",
        ] {
            assert!(value.get(field).is_none());
        }
    }
    #[test]
    fn fragmented_utf8_sse_needs_terminal_success_and_handles_late_limit_failure() {
        let wire = format!(
            "data: {}\r\n\r\ndata: {}\r\n\r\n",
            json!({"type":"response.output_text.delta","delta":"{\"text\":\"안녕\"}"}),
            json!({"type":"response.completed","response":{"status":"completed"}})
        );
        let mut events = Events::default();
        for byte in wire.as_bytes() {
            events
                .push(&[*byte])
                .unwrap_or_else(|e| panic!("{}", e.message));
        }
        assert_eq!(
            events.finish().unwrap_or_else(|e| panic!("{}", e.message)),
            json!({"text":"안녕"})
        );
        let mut incomplete = Events::default();
        incomplete
            .push(
                format!(
                    "data: {}\n\n",
                    json!({"type":"response.output_text.delta","delta":"{}"})
                )
                .as_bytes(),
            )
            .unwrap_or_else(|e| panic!("{}", e.message));
        assert!(incomplete.finish().is_err());
        let mut failed = Events::default();
        let error=failed.push(format!("data: {}\n\n",json!({"type":"response.failed","response":{"error":{"code":"subscription_sharing_usage_limit_exceeded","message":"secret user payload"}}})).as_bytes()).err().unwrap();
        assert!(error.usage_limit);
        assert!(!error.message.contains("secret user payload"));
    }
    #[test]
    fn model_catalog_keeps_server_order_and_visibility() {
        let result=parse_models(json!({"models":[{"slug":"b","display_name":"Second","visibility":"list"},{"slug":"hidden","display_name":"Hidden","visibility":"hidden"},{"slug":"a","display_name":"First","visibility":"list"}]})).unwrap_or_else(|e|panic!("{}",e.message));
        assert_eq!(
            result.iter().map(|m| m.slug.as_str()).collect::<Vec<_>>(),
            vec!["b", "a"]
        );
    }
    #[tokio::test]
    async fn model_catalog_accepts_large_metadata_but_keeps_a_separate_bound() {
        let body = json!({"models":[{"slug":"visible","display_name":"Visible","visibility":"list","metadata":"x".repeat(600 * 1024)}]}).to_string();
        assert!(
            auth::read_json(response(body.clone(), Some("application/json")).await)
                .await
                .is_err()
        );
        let value = auth::read_json_limited(
            response(body, Some("application/json")).await,
            MODEL_CATALOG_LIMIT,
        )
        .await
        .unwrap();
        let models = parse_models(value).unwrap_or_else(|e| panic!("{}", e.message));
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].slug, "visible");
        let oversized = json!({"metadata":"x".repeat(MODEL_CATALOG_LIMIT)}).to_string();
        assert!(auth::read_json_limited(
            response(oversized, Some("application/json")).await,
            MODEL_CATALOG_LIMIT
        )
        .await
        .is_err());
    }
    #[test]
    fn incomplete_and_oversized_streams_never_return_partial_json() {
        let mut events = Events::default();
        assert!(events.push(&vec![b'x'; 2 * 1024 * 1024 + 1]).is_err());
        let mut events = Events::default();
        assert!(events.event(json!({"type":"response.incomplete"})).is_err());
        let error = failure(
            Some(403),
            &json!({"detail":"private context","error":{"code":"subscription_sharing_user_not_eligible"}}),
            Some("request-123"),
        );
        assert!(error.message.contains("request-123"));
        assert!(!error.message.contains("private context"));
    }
}
