use super::*;

pub(super) fn configure_compatible_payload(
    payload: &mut Value,
    settings: &Settings,
    messages: &[ChatMessage],
    schema: &Value,
    budget: GenerationBudget,
) {
    match settings.api_provider {
        ApiProvider::Gemini => {
            payload
                .as_object_mut()
                .unwrap()
                .remove("max_completion_tokens");
            payload["max_tokens"] = json!(budget.output_tokens + 4096);
            payload["reasoning_effort"] = json!("low");
        }
        ApiProvider::Glm => {
            payload
                .as_object_mut()
                .unwrap()
                .remove("max_completion_tokens");
            payload["max_tokens"] = json!(budget.output_tokens + 4096);
            payload["response_format"] = json!({"type":"json_object"});
            // GLM's JSON mode does not accept a json_schema response format.
            let mut messages = messages.to_vec();
            messages.insert(0, ChatMessage {
                role: "system".into(),
                content: format!("Return one JSON object that follows this JSON Schema. Do not include Markdown or explanations. Schema: {schema}"),
            });
            payload["messages"] = json!(messages);
        }
        _ => {}
    }
}

pub(super) fn validate_compatible_response(body: &Value) -> Result<(), String> {
    if body.get("choices").and_then(Value::as_array).map(Vec::len) != Some(1) {
        return Err("API 응답에 올바른 대화 결과가 없습니다.".into());
    }
    match body
        .pointer("/choices/0/finish_reason")
        .and_then(Value::as_str)
    {
        Some("stop") => {}
        Some("length") => {
            return Err("모델 응답이 토큰 한도에 도달했습니다. 요청을 더 작게 나눠 주세요.".into())
        }
        _ => return Err("API 응답이 정상적으로 끝나지 않았습니다.".into()),
    }
    let message = &body["choices"][0]["message"];
    if message.get("refusal").is_some_and(|value| !value.is_null())
        || message
            .get("tool_calls")
            .is_some_and(|value| value.as_array().is_none_or(|calls| !calls.is_empty()))
    {
        return Err("모델이 요청한 JSON 응답을 반환하지 않았습니다.".into());
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn claude_completion(
    http: &reqwest::Client,
    url: &str,
    key: Option<&str>,
    settings: &Settings,
    messages: &[ChatMessage],
    schema: Value,
    budget: GenerationBudget,
    cancel: Arc<AtomicBool>,
    telemetry: Option<&RequestTelemetry>,
) -> Result<Value, String> {
    let mut system: Vec<String> = messages
        .iter()
        .filter(|message| message.role == "system")
        .map(|message| message.content.clone())
        .collect();
    system.push("Return your complete answer by calling comet_response exactly once with the JSON object required by its input_schema. This tool only returns structured data; it performs no external action.".into());
    let mut turns: Vec<ChatMessage> = messages
        .iter()
        .filter(|message| message.role != "system")
        .cloned()
        .collect();
    if turns
        .iter()
        .any(|message| !matches!(message.role.as_str(), "user" | "assistant"))
    {
        return Err("지원하지 않는 대화 역할입니다.".into());
    }
    if turns.first().is_none_or(|message| message.role != "user") {
        turns.insert(
            0,
            ChatMessage {
                role: "user".into(),
                content: "Continue the conversation using the supplied context.".into(),
            },
        );
    }
    if turns
        .last()
        .is_some_and(|message| message.role == "assistant")
    {
        turns.push(ChatMessage {
            role: "user".into(),
            content: "Continue with the requested structured response.".into(),
        });
    }
    let mut payload = json!({
        "model":settings.api_model,
        "max_tokens":budget.output_tokens.max(1024),
        "stream":false,
        "system":system.join("\n\n"),
        "messages":turns,
        "tools":[{"name":"comet_response","description":"Return the requested Comet response as structured data, preserving the specified characters, dialogue, and required fields.","input_schema":schema}],
        "tool_choice":{"type":"auto"}
    });
    attach_to_last_user(&mut payload["messages"], "claude");
    let request = http
        .post(format!("{url}/messages"))
        .header("anthropic-version", "2023-06-01")
        .header("x-api-key", key.unwrap_or_default())
        .timeout(budget.timeout)
        .json(&payload);
    if let Some(telemetry) = telemetry {
        telemetry.dispatched();
    }
    let response = request.send().await.map_err(|error| {
        if error.is_timeout() {
            "API 응답 시간이 초과되었습니다."
        } else {
            "API에 연결할 수 없습니다. 주소·네트워크를 확인해 주세요."
        }
    })?;
    if !response.status().is_success() {
        return Err(match response.status().as_u16() {
            401 | 403 => "API 인증에 실패했습니다. 이 서비스에 저장한 키를 확인해 주세요.".into(),
            429 => "API 요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.".into(),
            status => format!("API 요청 실패 (HTTP {status})."),
        });
    }
    let body = response_body(response).await?;
    if cancel.load(Ordering::Acquire) {
        return Err("취소됨".into());
    }
    parse_claude_response(&body)
}

fn parse_claude_response(body: &Value) -> Result<Value, String> {
    let stop = body.get("stop_reason").and_then(Value::as_str);
    if stop == Some("max_tokens") {
        return Err("모델 응답이 토큰 한도에 도달했습니다. 요청을 더 작게 나눠 주세요.".into());
    }
    if !matches!(stop, Some("end_turn" | "tool_use")) {
        return Err("Claude 응답이 정상적으로 끝나지 않았습니다.".into());
    }
    let blocks = body
        .get("content")
        .and_then(Value::as_array)
        .ok_or("Claude 응답에 대화 내용이 없습니다.")?;
    let mut result = None;
    let mut text = String::new();
    for block in blocks {
        match block.get("type").and_then(Value::as_str) {
            Some("tool_use")
                if block.get("name").and_then(Value::as_str) == Some("comet_response")
                    && result.is_none() =>
            {
                result = Some(
                    block
                        .get("input")
                        .filter(|input| input.is_object())
                        .ok_or("Claude의 JSON 응답 형식이 올바르지 않습니다.")?
                        .clone(),
                );
            }
            Some("text") => text.push_str(
                block
                    .get("text")
                    .and_then(Value::as_str)
                    .ok_or("Claude 응답 형식이 올바르지 않습니다.")?,
            ),
            Some("thinking" | "redacted_thinking") => {}
            _ => return Err("Claude가 요청한 JSON 응답을 반환하지 않았습니다.".into()),
        }
    }
    match (stop, result) {
        (Some("tool_use"), Some(value)) => Ok(value),
        (Some("end_turn"), None) => {
            let value = parse_generated_json(text.trim())?;
            if !value.is_object() {
                return Err("Claude가 요청한 JSON 객체로 답하지 않았습니다.".into());
            }
            Ok(value)
        }
        _ => Err("Claude가 요청한 JSON 응답을 반환하지 않았습니다.".into()),
    }
}
