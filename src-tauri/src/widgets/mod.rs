pub(crate) mod appearance;
pub(crate) mod backgrounds;
pub(crate) mod calendar;
pub(crate) mod connections;
pub(crate) mod music_native;
pub(crate) mod planning;
pub(crate) mod reminders;
pub(crate) mod storage;
#[cfg(test)]
mod storage_tests;
pub(crate) mod toys;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WidgetManifest {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: String,
    pub version: u32,
    pub required: Vec<String>,
    pub connection: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetInstance {
    pub id: String,
    pub kind: String,
    pub version: u32,
    pub installed: bool,
    pub enabled: bool,
    pub revision: i64,
    pub data: Value,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetView {
    #[serde(flatten)]
    pub instance: WidgetInstance,
    pub status: String,
    pub missing: Vec<String>,
    pub package_bytes: usize,
    pub background_updated_at: Option<i64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetSnapshot {
    pub catalog: Vec<WidgetManifest>,
    pub widgets: Vec<WidgetView>,
    pub onboarding_done: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WidgetRequest {
    pub request_id: String,
    pub instance_id: String,
    pub expected_revision: i64,
    pub action: String,
    pub input: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventDraft {
    pub kind: String,
    pub text: String,
    pub payload: Value,
}

#[derive(Clone, Debug)]
pub struct WidgetEffect {
    pub data: Value,
    pub events: Vec<EventDraft>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetEvent {
    pub id: String,
    pub instance_id: String,
    pub widget_kind: String,
    pub revision: i64,
    pub created_at: i64,
    pub expires_at: i64,
    #[serde(flatten)]
    pub event: EventDraft,
}

pub fn catalog() -> Result<Vec<WidgetManifest>, String> {
    let entries: Vec<WidgetManifest> =
        serde_json::from_str(include_str!("../../../widgets/catalog.json"))
            .map_err(|error| error.to_string())?;
    let mut ids = std::collections::BTreeSet::new();
    for entry in &entries {
        if entry.version != 1 || !ids.insert(&entry.id) {
            return Err("위젯 카탈로그의 버전 또는 식별자가 잘못됐어요.".into());
        }
    }
    if entries
        .iter()
        .any(|entry| entry.required.iter().any(|id| !ids.contains(id)))
    {
        return Err("위젯 카탈로그의 의존성을 찾지 못했어요.".into());
    }
    Ok(entries)
}

pub fn manifest(kind: &str) -> Result<WidgetManifest, String> {
    catalog()?
        .into_iter()
        .find(|entry| entry.id == kind)
        .ok_or_else(|| "카탈로그에 없는 위젯이에요.".into())
}

pub fn initial(kind: &str) -> Result<Value, String> {
    manifest(kind)?;
    Ok(match kind {
        "todo" | "focus-timer" | "preparation" | "clock" | "memo" => planning::initial(kind),
        "completion-jar" => json!({"completed": []}),
        "journal" => json!({}),
        "calendar" => {
            json!({"connections": [], "events": [], "lastSuccessAt": null,"reminders":reminders::initial()})
        }
        "weather" | "music" | "device" => connections::initial(kind),
        _ => toys::initial(kind),
    })
}

pub fn configure_appearance(instance: &WidgetInstance, input: &Value) -> Result<Value, String> {
    appearance::configure(&instance.kind, &instance.data, input)
}

pub fn act(
    instance: &WidgetInstance,
    request: &WidgetRequest,
    related: &BTreeMap<String, Value>,
    now: i64,
    entropy: u64,
) -> Result<WidgetEffect, String> {
    if request.action.len() > 64
        || !request.input.is_object()
        || serde_json::to_vec(&request.input)
            .map_err(|error| error.to_string())?
            .len()
            > 64 * 1024
    {
        return Err("위젯 입력 형식이나 크기가 올바르지 않아요.".into());
    }
    match instance.kind.as_str() {
        "todo" | "focus-timer" | "preparation" | "clock" | "memo" => planning::act(
            &instance.kind,
            &instance.data,
            &request.action,
            &request.input,
            related,
            now,
            entropy,
        ),
        "completion-jar" | "journal" => Err("이 위젯은 실제 사건을 모아 보여 줘요.".into()),
        "calendar"
            if matches!(
                request.action.as_str(),
                "configure-alerts"
                    | "mute-alerts"
                    | "unmute-alerts"
                    | "snooze-alert"
                    | "preview-alert"
            ) =>
        {
            reminders::act(&instance.data, &request.action, &request.input, now)
        }
        "calendar" | "weather" | "music" | "device" => {
            Err("연결 설정 화면에서 이 기능을 사용해 주세요.".into())
        }
        _ => toys::act(
            &instance.kind,
            &instance.data,
            &request.action,
            &request.input,
            now,
            entropy,
        ),
    }
}

pub fn tick(instance: &WidgetInstance, now: i64) -> Result<Option<WidgetEffect>, String> {
    match instance.kind.as_str() {
        "todo" | "focus-timer" | "preparation" | "clock" | "memo" => {
            planning::tick(&instance.kind, &instance.data, now)
        }
        "completion-jar" | "journal" | "calendar" | "weather" | "music" | "device" => Ok(None),
        _ => toys::tick(&instance.kind, &instance.data, now),
    }
}

#[cfg(test)]
pub fn project(instance: WidgetInstance, all: &[WidgetInstance]) -> Result<WidgetView, String> {
    project_with_background(instance, all, None)
}

pub fn project_with_background(
    mut instance: WidgetInstance,
    all: &[WidgetInstance],
    background_updated_at: Option<i64>,
) -> Result<WidgetView, String> {
    let metadata = manifest(&instance.kind)?;
    let missing = metadata
        .required
        .iter()
        .filter(|kind| {
            !all.iter()
                .any(|other| other.kind == **kind && other.installed && other.enabled)
        })
        .cloned()
        .collect::<Vec<_>>();
    let connection_needed = match instance.kind.as_str() {
        "calendar" => instance.data["connections"]
            .as_array()
            .is_none_or(Vec::is_empty),
        "weather" | "music" | "device" => instance.data["configured"] != true,
        _ => false,
    };
    if instance.installed
        && instance.enabled
        && missing.is_empty()
        && !connection_needed
        && instance.error.is_none()
    {
        instance.error = connection_projection_error(&instance.kind, &instance.data);
    }
    let status = if !instance.installed {
        if instance.error.is_some() {
            "install-error"
        } else {
            "not-installed"
        }
    } else if !instance.enabled {
        "disabled"
    } else if !missing.is_empty() || connection_needed {
        "setup"
    } else if instance.error.is_some() {
        "error"
    } else {
        "enabled"
    };
    if instance.kind == "guessing" && instance.data["playing"] == true {
        if let Some(data) = instance.data.as_object_mut() {
            data.remove("answer");
        }
    }
    Ok(WidgetView {
        instance,
        status: status.into(),
        missing,
        package_bytes: serde_json::to_vec(&metadata)
            .map_err(|error| error.to_string())?
            .len(),
        background_updated_at,
    })
}

fn connection_projection_error(kind: &str, data: &Value) -> Option<String> {
    fn failure(data: &Value) -> Option<String> {
        let status = data["status"].as_str()?;
        if !matches!(
            status,
            "offline" | "auth-error" | "error" | "permission-needed" | "stale" | "syncing"
        ) {
            return None;
        }
        if let Some(message) = data["error"]
            .as_str()
            .filter(|text| !text.trim().is_empty())
        {
            return Some(message.to_owned());
        }
        match status {
            "syncing" => None,
            "auth-error" | "permission-needed" => Some("연결 권한을 확인해 주세요.".into()),
            "stale" => Some("최신 정보를 아직 확인하지 못했어요.".into()),
            _ => Some("연결 정보를 불러오지 못했어요.".into()),
        }
    }
    match kind {
        "weather" | "music" | "device" => failure(data),
        "calendar" => {
            let messages = data["connections"]
                .as_array()?
                .iter()
                .filter_map(|connection| {
                    failure(connection).map(|message| {
                        let name = connection["name"].as_str().unwrap_or("캘린더");
                        format!("{name}: {message}")
                    })
                })
                .collect::<Vec<_>>();
            (!messages.is_empty()).then(|| messages.join(" · "))
        }
        _ => None,
    }
}

#[cfg(test)]
mod projection_tests {
    use super::*;

    fn instance(kind: &str, data: Value) -> WidgetInstance {
        serde_json::from_value(json!({
            "id":kind,"kind":kind,"version":1,"installed":true,"enabled":true,
            "revision":7,"data":data,"error":null
        }))
        .unwrap()
    }

    #[test]
    fn connection_failures_reach_manager_without_changing_stored_data() {
        for kind in ["weather", "music", "device"] {
            let source = instance(
                kind,
                json!({"configured":true,"status":"offline",
                "error":"기기 정보를 읽지 못했어요.","observation":{"title":"마지막 관측"},"lastSuccessAt":100}),
            );
            let view = serde_json::to_value(project(source.clone(), &[]).unwrap()).unwrap();
            assert_eq!(view["status"], "error");
            assert_eq!(view["error"], source.data["error"]);
            assert_eq!(view["data"], source.data);
            assert_eq!(source.error, None);
            assert_eq!(view["revision"], 7);
            for (installed, enabled, configured, expected) in [
                (false, true, true, "not-installed"),
                (true, false, true, "disabled"),
                (true, true, false, "setup"),
            ] {
                let mut inactive = source.clone();
                inactive.installed = installed;
                inactive.enabled = enabled;
                inactive.data["configured"] = json!(configured);
                let view = project(inactive, &[]).unwrap();
                assert_eq!(view.status, expected);
                assert_eq!(view.instance.error, None);
            }
        }
    }

    #[test]
    fn calendar_partial_failure_and_retry_keep_error_until_success() {
        let mut source = instance(
            "calendar",
            json!({"connections":[
            {"id":"a","name":"개인","status":"ready","error":null},
            {"id":"b","name":"업무","status":"auth-error","error":"다시 연결해 주세요."}
        ],"events":[{"id":"kept"}]}),
        );
        for status in ["auth-error", "syncing"] {
            source.data["connections"][1]["status"] = json!(status);
            let view = project(source.clone(), &[]).unwrap();
            assert_eq!(view.status, "error");
            assert_eq!(
                view.instance.error.as_deref(),
                Some("업무: 다시 연결해 주세요.")
            );
            assert_eq!(view.instance.data, source.data);
        }
        source.data["connections"][1]["error"] = Value::Null;
        assert_eq!(project(source.clone(), &[]).unwrap().status, "enabled");
        source.data["connections"][1]["status"] = json!("ready");
        assert_eq!(project(source.clone(), &[]).unwrap().instance.error, None);
        source.data["connections"] = json!([]);
        assert_eq!(project(source, &[]).unwrap().status, "setup");
    }
}
