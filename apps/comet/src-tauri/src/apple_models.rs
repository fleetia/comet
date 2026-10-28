use crate::types::ChatMessage;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

const MAX_INPUT_BYTES: usize = 12_000;
const MAX_OUTPUT_TOKENS: u32 = 768;
const CONTEXT_ERROR: &str = "Apple 온디바이스 AI의 짧은 문맥 범위를 넘었어요. 입력을 줄이거나 다른 AI를 직접 선택해 주세요.";
pub(crate) const WIDGET_UNSUPPORTED: &str =
    "Apple 온디바이스 AI는 위젯 코드 제작·수정을 지원하지 않아요. 다른 AI를 직접 선택해 주세요.";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppleModelStatus {
    pub available: bool,
    pub reason: String,
    pub message: String,
    pub locale: String,
}

impl Default for AppleModelStatus {
    fn default() -> Self {
        status_for("unknown")
    }
}

impl AppleModelStatus {
    pub(crate) fn require(&self) -> Result<(), String> {
        if self.available {
            Ok(())
        } else {
            Err(self.message.clone())
        }
    }
}

fn status_for(reason: &str) -> AppleModelStatus {
    let message = match reason {
        "available" => "이 Mac의 Apple 온디바이스 AI가 한국어 대화를 사용할 준비가 됐어요.",
        "unsupportedPlatform" => "Apple 온디바이스 AI는 macOS에서만 사용할 수 있어요.",
        "unsupportedOs" => "Apple 온디바이스 AI는 macOS 26 이상에서 사용할 수 있어요.",
        "bridgeUnavailable" => "이 앱 빌드에는 Apple Foundation Models 연결이 포함되지 않았어요. 지원하는 앱 빌드가 필요해요.",
        "deviceNotEligible" => "이 기기는 Apple Intelligence 지원 대상이 아니에요.",
        "appleIntelligenceNotEnabled" => "시스템 설정에서 이 Mac의 Apple Intelligence 사용 조건과 활성화 상태를 확인해 주세요.",
        "modelNotReady" => "Apple이 관리하는 모델이 아직 준비되지 않았어요. 준비가 끝난 뒤 다시 확인해 주세요.",
        "unsupportedLanguage" => "현재 Apple 모델은 Comet의 한국어 대화를 지원하지 않아요. 다른 AI를 직접 선택해 주세요.",
        _ => "Apple 온디바이스 AI의 준비 상태를 확인하지 못했어요. 다시 확인하거나 다른 AI를 직접 선택해 주세요.",
    };
    AppleModelStatus {
        available: reason == "available",
        reason: reason.into(),
        message: message.into(),
        locale: "ko-KR".into(),
    }
}

#[tauri::command]
pub(crate) fn apple_model_status() -> AppleModelStatus {
    status()
}

pub(crate) fn status() -> AppleModelStatus {
    #[cfg(target_os = "macos")]
    {
        status_for(&native::status())
    }
    #[cfg(not(target_os = "macos"))]
    {
        status_for("unsupportedPlatform")
    }
}

// Bound the IPC payload before asking the native model to count instructions,
// turns, schema and the reserved output. Never silently trim selected context.
fn request(messages: &[ChatMessage], schema: &Value, output_tokens: u32) -> Result<String, String> {
    if output_tokens == 0 || output_tokens > MAX_OUTPUT_TOKENS {
        return Err(CONTEXT_ERROR.into());
    }
    if messages.is_empty()
        || messages
            .iter()
            .any(|message| !matches!(message.role.as_str(), "system" | "user" | "assistant"))
    {
        return Err("Apple 모델에 전달할 대화 형식이 올바르지 않아요.".into());
    }
    validate_schema(schema, 0)?;
    let schema = serde_json::to_string(schema).map_err(|error| error.to_string())?;
    let turns = serde_json::to_string(messages).map_err(|error| error.to_string())?;
    if turns.len() + schema.len() > MAX_INPUT_BYTES {
        return Err(CONTEXT_ERROR.into());
    }
    Ok(json!({"messages":messages,"schema":schema,"outputTokens":output_tokens}).to_string())
}

fn validate_schema(schema: &Value, depth: usize) -> Result<(), String> {
    let unsupported = || {
        "Apple 모델에서 지원하지 않는 응답 형식이에요. 다른 AI를 직접 선택해 주세요.".to_string()
    };
    let object = schema.as_object().ok_or_else(unsupported)?;
    if depth > 8
        || object.keys().any(|key| {
            !matches!(
                key.as_str(),
                "type"
                    | "description"
                    | "properties"
                    | "required"
                    | "additionalProperties"
                    | "items"
                    | "minItems"
                    | "maxItems"
                    | "enum"
                    | "minLength"
                    | "maxLength"
                    | "minimum"
                    | "maximum"
            )
        })
    {
        return Err(unsupported());
    }
    match schema["type"].as_str() {
        Some("object") => {
            let properties = schema["properties"].as_object().ok_or_else(unsupported)?;
            if schema["additionalProperties"] != false {
                return Err(unsupported());
            }
            for child in properties.values() {
                validate_schema(child, depth + 1)?;
            }
        }
        Some("array") => validate_schema(&schema["items"], depth + 1)?,
        Some("string" | "boolean" | "integer" | "number") => {}
        _ => return Err(unsupported()),
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn discard_invalid_widget_tags(value: &mut Value, schema: &Value) {
    if let Some(object) = value.as_object_mut() {
        if let Some(widget_schema) = schema["properties"].get("widget") {
            if object.get("widget").is_some_and(|widget| {
                !widget_schema["enum"].as_array().is_some_and(|choices| choices.contains(widget))
            }) {
                object.remove("widget");
            }
        }
        for (key, child) in object {
            discard_invalid_widget_tags(child, &schema["properties"][key]);
        }
    } else if let Some(items) = value.as_array_mut() {
        for item in items {
            discard_invalid_widget_tags(item, &schema["items"]);
        }
    }
}

#[cfg(any(target_os = "macos", test))]
fn validate_response(value: &Value, schema: &Value) -> bool {
    if let Some(choices) = schema["enum"].as_array() {
        if !choices.contains(value) {
            return false;
        }
    }
    let within = |count: f64, min: &Value, max: &Value| {
        min.as_f64().is_none_or(|minimum| count >= minimum)
            && max.as_f64().is_none_or(|maximum| count <= maximum)
    };
    match schema["type"].as_str() {
        Some("object") => value.as_object().is_some_and(|object| {
            let Some(properties) = schema["properties"].as_object() else {
                return false;
            };
            schema["required"].as_array().is_none_or(|required| {
                required
                    .iter()
                    .all(|key| key.as_str().is_some_and(|key| object.contains_key(key)))
            }) && object.iter().all(|(key, child)| {
                properties
                    .get(key)
                    .is_some_and(|schema| validate_response(child, schema))
            })
        }),
        Some("array") => value.as_array().is_some_and(|items| {
            within(items.len() as f64, &schema["minItems"], &schema["maxItems"])
                && items
                    .iter()
                    .all(|item| validate_response(item, &schema["items"]))
        }),
        Some("string") => value.as_str().is_some_and(|text| {
            within(
                text.chars().count() as f64,
                &schema["minLength"],
                &schema["maxLength"],
            )
        }),
        Some("boolean") => value.is_boolean(),
        Some("integer") => {
            (value.is_i64() || value.is_u64())
                && within(
                    value.as_f64().unwrap_or_default(),
                    &schema["minimum"],
                    &schema["maximum"],
                )
        }
        Some("number") => value
            .as_f64()
            .is_some_and(|number| within(number, &schema["minimum"], &schema["maximum"])),
        _ => false,
    }
}

pub(crate) async fn generate(
    messages: &[ChatMessage],
    schema: Value,
    output_tokens: u32,
    timeout: Duration,
    cancel: Arc<AtomicBool>,
    telemetry: &crate::inference::RequestTelemetry,
) -> Result<Value, String> {
    if cancel.load(Ordering::Acquire) {
        return Err("취소됨".into());
    }
    let output_tokens = output_tokens.min(MAX_OUTPUT_TOKENS);
    let input = request(messages, &schema, output_tokens)?;
    status().require()?;
    #[cfg(target_os = "macos")]
    {
        telemetry.dispatched();
        let mut response = native::generate(&input, timeout, cancel.clone()).await?;
        discard_invalid_widget_tags(&mut response, &schema);
        if cancel.load(Ordering::Acquire) {
            return Err("취소됨".into());
        }
        if !validate_response(&response, &schema) {
            return Err("Apple 모델 응답이 요청한 구조나 범위를 벗어났어요.".into());
        }
        Ok(response)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (input, timeout, telemetry);
        Err(status().message)
    }
}

#[cfg(target_os = "macos")]
mod native {
    use super::*;
    use std::ffi::{c_char, CStr, CString};

    unsafe extern "C" {
        fn comet_apple_status() -> *mut c_char;
        fn comet_apple_start(id: *const c_char, input: *const c_char);
        fn comet_apple_poll(id: *const c_char) -> *mut c_char;
        fn comet_apple_cancel(id: *const c_char);
    }

    unsafe fn take_string(pointer: *mut c_char) -> Option<String> {
        if pointer.is_null() {
            return None;
        }
        // Swift returns strdup allocations; consume each exactly once with free.
        let value = unsafe { CStr::from_ptr(pointer) }
            .to_string_lossy()
            .into_owned();
        unsafe { libc::free(pointer.cast()) };
        Some(value)
    }

    pub(super) fn status() -> String {
        unsafe { take_string(comet_apple_status()) }.unwrap_or_else(|| "unknown".into())
    }

    struct Request(CString);
    impl Drop for Request {
        fn drop(&mut self) {
            // Also cancels the native Task when the caller drops a timed-out future.
            unsafe { comet_apple_cancel(self.0.as_ptr()) };
        }
    }

    pub(super) async fn generate(
        input: &str,
        timeout: Duration,
        cancel: Arc<AtomicBool>,
    ) -> Result<Value, String> {
        let id =
            CString::new(uuid::Uuid::new_v4().to_string()).map_err(|error| error.to_string())?;
        let input = CString::new(input).map_err(|error| error.to_string())?;
        let request = Request(id);
        unsafe { comet_apple_start(request.0.as_ptr(), input.as_ptr()) };
        let receive = async {
            loop {
                if let Some(response) = unsafe { take_string(comet_apple_poll(request.0.as_ptr())) }
                {
                    let response: Value =
                        serde_json::from_str(&response).map_err(|error| error.to_string())?;
                    if let Some(error) = response["error"].as_str() {
                        return Err(error.into());
                    }
                    let json = response["result"]
                        .as_str()
                        .ok_or("Apple 모델 응답을 읽지 못했어요.")?;
                    return serde_json::from_str(json).map_err(|error| error.to_string());
                }
                tokio::time::sleep(Duration::from_millis(30)).await;
            }
        };
        tokio::select! {
            _ = crate::models::cancelled(cancel) => Err("취소됨".into()),
            result = tokio::time::timeout(timeout, receive) =>
                result.unwrap_or_else(|_| Err("Apple 온디바이스 AI 응답 시간이 초과됐어요.".into())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::require_complete_input;

    #[test]
    fn real_short_character_prompts_and_memory_extraction_fit_payload_cap() {
        let baseline_budget = |prompt: &[ChatMessage], schema: &Value, output: usize| {
            let instructions = prompt
                .iter()
                .filter(|message| message.role == "system")
                .map(|message| message.content.as_str())
                .collect::<Vec<_>>()
                .join("\n");
            let turns = prompt
                .iter()
                .filter(|message| message.role != "system")
                .collect::<Vec<_>>();
            instructions.len()
                + serde_json::to_string(&turns).unwrap().len()
                + schema.to_string().len()
                + output
                + 512
        };
        let state = crate::lifecycle_tests::state();
        let db = crate::lock(&state.db).unwrap();
        crate::store::register_user_name(&db, "테스트 친구", 1, false).unwrap();
        let message = crate::types::Message {
            id: "apple-short-request".into(),
            role: "user".into(),
            persona: Some("both".into()),
            content: "나는 산책을 좋아해. 너희는 어때?".into(),
            expression: None,
            created_at: 1_800_000_000_000,
            status: "complete".into(),
        };
        crate::store::insert_message(&db, &message).unwrap();
        for targets in [vec!["a".into()], vec!["a".into(), "b".into()]] {
            let schema = if targets.len() == 1 {
                crate::domain::reply_schema_for(&targets, &crate::domain::EXPRESSIONS)
            } else {
                crate::domain::scene_schema_for(
                    &targets,
                    targets.len(),
                    targets.len(),
                    &crate::domain::EXPRESSIONS,
                )
            };
            let prompt = crate::app::conversation::turn_prompt(&db, &targets, &message.id).unwrap();
            require_complete_input(&prompt, &message.content).unwrap();
            request(&prompt, &schema, 512).unwrap();
            let total = baseline_budget(&prompt, &schema, 512);
            assert!(
                total <= 4096,
                "{} characters require {total}",
                targets.len()
            );
            eprintln!(
                "Apple baseline byte budget, {} character(s): {total}/4096",
                targets.len()
            );
        }
        let targets = crate::characters::active_ids(&db).unwrap();
        let prompt = crate::app::conversation::turn_prompt_for_state(
            &state,
            &db,
            &targets,
            &message.id,
            &[],
        )
        .unwrap();
        require_complete_input(&prompt, &message.content).unwrap();
        let schema = crate::domain::scene_schema_for(
            &targets,
            targets.len(),
            targets.len(),
            &crate::domain::EXPRESSIONS,
        );
        let total = baseline_budget(&prompt, &schema, 512);
        assert!(total <= 4096, "short roster prompt requires {total}");
        eprintln!("Apple baseline byte budget, roster: {total}/4096");
        request(&prompt, &schema, 512).unwrap();
        let mixed = crate::types::Message {
            id: "apple-mixed-request".into(),
            content: "오늘은 파란 종이로 작은 배를 만들었어. 같이 산책 가자는 말로 짧게 답해 줘."
                .into(),
            ..message
        };
        let analysis = crate::domain::analysis_batch(std::slice::from_ref(&mixed), &[], 1);
        assert_eq!(analysis.submitted_ids, [mixed.id.as_str()]);
        let payload: Value = serde_json::from_str(&analysis.messages[1].content).unwrap();
        assert_eq!(payload["userMessages"][0]["text"], mixed.content);
        let schema = crate::domain::analysis_schema();
        request(&analysis.messages, &schema, MAX_OUTPUT_TOKENS).unwrap();
        let total = baseline_budget(&analysis.messages, &schema, MAX_OUTPUT_TOKENS as usize);
        assert!(total <= 4096, "memory extraction requires {total}");
        eprintln!("Apple baseline byte budget, memory extraction: {total}/4096");
    }

    #[test]
    fn only_available_is_ready_and_unavailability_keeps_its_reason() {
        for reason in [
            "available",
            "unsupportedPlatform",
            "unsupportedOs",
            "bridgeUnavailable",
            "deviceNotEligible",
            "appleIntelligenceNotEnabled",
            "modelNotReady",
            "unsupportedLanguage",
            "unknown",
        ] {
            let status = status_for(reason);
            assert_eq!(status.available, reason == "available");
            assert_eq!(status.require().is_ok(), reason == "available");
            assert_eq!(status.reason, reason);
            assert_eq!(status.locale, "ko-KR");
        }
    }

    #[test]
    fn bounded_request_preserves_turns_and_rejects_oversized_input_and_output() {
        let messages = vec![ChatMessage {
            role: "user".into(),
            content: "안녕\n그대로".into(),
        }];
        let schema = json!({"type":"object","properties":{"text":{"type":"string"}},"required":["text"],"additionalProperties":false});
        let input: Value =
            serde_json::from_str(&request(&messages, &schema, 128).unwrap()).unwrap();
        assert_eq!(input["messages"][0]["content"], messages[0].content);
        assert!(request(&messages, &schema, 769).is_err());
        let long = vec![ChatMessage {
            role: "user".into(),
            content: "가".repeat(5000),
        }];
        assert!(request(&long, &schema, 128).unwrap_err().contains("문맥"));
        assert!(request(&messages, &json!({"type":"object","$ref":"external"}), 128).is_err());
    }

    #[test]
    fn structured_output_checks_members_enums_lengths_and_array_bounds() {
        let schema =
            crate::domain::scene_schema_for(&["a".into()], 1, 1, &crate::domain::EXPRESSIONS);
        assert!(validate_response(
            &json!({"lines":[{"persona":"a","expression":"평온","text":"안녕"}]}),
            &schema
        ));
        for invalid in [
            json!({"lines":[]}),
            json!({"lines":[{"persona":"b","expression":"평온","text":"안녕"}]}),
            json!({"lines":[{"persona":"a","expression":"평온"}]}),
            json!({"lines":[{"persona":"a","expression":"평온","text":"안녕","extra":true}]}),
        ] {
            assert!(!validate_response(&invalid, &schema));
        }
    }
}
