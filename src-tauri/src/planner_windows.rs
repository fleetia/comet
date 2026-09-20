use crate::app::windows::{open_settings_section, SettingsSection};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

#[derive(Default)]
pub(crate) struct Navigation {
    tab: Mutex<String>,
    settings_target: Mutex<Option<String>>,
}

pub(crate) fn open(app: &tauri::AppHandle, tab: &str) -> Result<(), String> {
    let tab = match tab {
        "plans" | "calendar" | "templates" => tab,
        _ => "today",
    };
    let navigation = app.state::<Navigation>();
    let mut latest = crate::lock(&navigation.tab)?;
    *latest = tab.to_string();
    if let Some(window) = app.get_webview_window("planner") {
        window.emit("planner-tab", tab).map_err(|e| e.to_string())?;
        window.show().map_err(|e| e.to_string())?;
        return window.set_focus().map_err(|e| e.to_string());
    }
    tauri::WebviewWindowBuilder::new(
        app,
        "planner",
        tauri::WebviewUrl::App(format!("index.html?view=planner&tab={tab}").into()),
    )
    .title("comet · 플래너")
    .inner_size(960.0, 640.0)
    .min_inner_size(720.0, 520.0)
    .decorations(false)
    .build()
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) fn get_planner_tab(state: tauri::State<'_, Navigation>) -> Result<String, String> {
    Ok(crate::lock(&state.tab)?.clone())
}

#[tauri::command]
pub(crate) fn open_planner_settings(
    app: tauri::AppHandle,
    kind: Option<String>,
) -> Result<(), String> {
    let kind = kind
        .filter(|value| {
            ["todo", "calendar", "focus-timer", "preparation"].contains(&value.as_str())
        })
        .unwrap_or_else(|| "calendar".into());
    *crate::lock(&app.state::<Navigation>().settings_target)? = Some(kind.clone());
    open_settings_section(app.clone(), SettingsSection::Widgets)?;
    app.emit_to("settings", "planner-settings-target", kind)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn get_planner_settings_target(
    state: tauri::State<'_, Navigation>,
) -> Result<Option<String>, String> {
    Ok(crate::lock(&state.settings_target)?.take())
}

#[tauri::command]
pub(crate) fn preview_planner_recurrence(
    state: tauri::State<'_, std::sync::Arc<crate::AppState>>,
    id: String,
    input: serde_json::Value,
) -> Result<Vec<String>, String> {
    let db = crate::lock(&state.db)?;
    let widget = crate::widgets::storage::get(&db, &id)?;
    if widget.kind != "todo" || !widget.installed || !widget.enabled {
        return Err("사용 중인 할 일 도구가 필요합니다.".into());
    }
    crate::widgets::planning::recurrence_preview(
        &widget.data,
        &input,
        chrono::Utc::now().timestamp_millis(),
    )
}
