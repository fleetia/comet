use crate::app::windows::{open_settings_section, SettingsSection};
use serde::Serialize;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

#[derive(Default)]
pub(crate) struct Navigation {
    tab: Mutex<String>,
    settings_target: Mutex<Option<String>>,
    note_target: Mutex<Option<String>>,
    view_target: Mutex<Option<PlannerViewTarget>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlannerViewTarget {
    entity: String,
    target_id: String,
}

#[tauri::command]
pub(crate) fn get_planner_view_target(
    state: tauri::State<'_, Navigation>,
) -> Result<Option<PlannerViewTarget>, String> {
    Ok(crate::lock(&state.view_target)?.take())
}

pub(crate) fn open_note(app: &tauri::AppHandle, id: &str) -> Result<(), String> {
    *crate::lock(&app.state::<Navigation>().note_target)? = Some(id.into());
    open(app, "today")?;
    app.emit_to("planner", "planner-note", id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn get_planner_note_target(
    state: tauri::State<'_, Navigation>,
) -> Result<Option<String>, String> {
    Ok(crate::lock(&state.note_target)?.take())
}

fn supported_tab(tab: &str) -> bool {
    matches!(
        tab,
        "today"
            | "todos"
            | "plans"
            | "calendar"
            | "templates"
            | "organizer"
            | "habits"
            | "ledger"
            | "envelopes"
            | "time"
    )
}

pub(crate) fn open(app: &tauri::AppHandle, tab: &str) -> Result<(), String> {
    *crate::lock(&app.state::<Navigation>().view_target)? = None;
    open_view(app, tab, None)
}

fn open_view(
    app: &tauri::AppHandle,
    tab: &str,
    target: Option<&PlannerViewTarget>,
) -> Result<(), String> {
    let tab = if supported_tab(tab) { tab } else { "today" };
    let navigation = app.state::<Navigation>();
    *crate::lock(&navigation.tab)? = tab.to_string();
    if let Some(window) = app.get_webview_window("planner") {
        if let Some(target) = target {
            window
                .emit("planner-view-target", target)
                .map_err(|e| e.to_string())?;
        } else {
            window.emit("planner-tab", tab).map_err(|e| e.to_string())?;
        }
        window.unminimize().map_err(|e| e.to_string())?;
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        crate::widgets::runtime::refresh(app);
        return Ok(());
    }
    tauri::WebviewWindowBuilder::new(
        app,
        "planner",
        tauri::WebviewUrl::App(format!("index.html?view=planner&tab={tab}").into()),
    )
    .title("comet · 내 다이어리")
    .inner_size(1328.0, 820.0)
    .min_inner_size(720.0, 520.0)
    .decorations(false)
    .transparent(true)
    .disable_drag_drop_handler()
    .build()
    .map_err(|e| e.to_string())?;
    crate::widgets::runtime::refresh(app);
    Ok(())
}

#[tauri::command]
pub(crate) fn open_planner_view(
    app: tauri::AppHandle,
    tab: String,
    entity: Option<String>,
    target_id: Option<String>,
) -> Result<(), String> {
    if !supported_tab(&tab) {
        return Err("다이어리에서 지원되는 화면을 선택해 주세요.".into());
    }
    let target = {
        let state = app.state::<std::sync::Arc<crate::AppState>>();
        let db = crate::lock(&state.db)?;
        validate_view_target(&db, &tab, entity.as_deref(), target_id.as_deref())?
    };
    *crate::lock(&app.state::<Navigation>().view_target)? = target.clone();
    open_view(&app, &tab, target.as_ref())
}

fn validate_view_target(
    db: &rusqlite::Connection,
    tab: &str,
    entity: Option<&str>,
    target_id: Option<&str>,
) -> Result<Option<PlannerViewTarget>, String> {
    let (entity, id) = match (entity, target_id) {
        (None, None) => return Ok(None),
        (Some(entity), Some(id)) if !id.trim().is_empty() && id.len() <= 4096 => (entity, id),
        _ => return Err("열 기록의 종류와 ID를 함께 지정해 주세요.".into()),
    };
    let exists = match (entity, tab) {
        ("page", "today") => {
            let diary = serde_json::to_value(crate::diary::read(db)?).map_err(|e| e.to_string())?;
            diary["pages"]
                .as_array()
                .is_some_and(|pages| pages.iter().any(|page| page["id"] == id))
        }
        ("event", "calendar") => crate::widgets::storage::instances(db)?
            .iter()
            .any(|widget| {
                widget.kind == "calendar"
                    && widget.installed
                    && widget.enabled
                    && widget.data["events"].as_array().is_some_and(|events| {
                        events.iter().any(|event| {
                            event["id"] == id
                                && event["cancelled"] != true
                                && (event["connectionId"] == "local"
                                    || widget.data["connections"].as_array().is_some_and(
                                        |connections| {
                                            connections.iter().any(|connection| {
                                                connection["id"] == event["connectionId"]
                                            })
                                        },
                                    ))
                        })
                    })
            }),
        _ => return Err("이 기록을 열 수 있는 다이어리 화면을 선택해 주세요.".into()),
    };
    if !exists {
        return Err(
            "해당 기록을 현재 찾을 수 없어요. 원본이 삭제되었거나 연결이 끊겼는지 확인해 주세요."
                .into(),
        );
    }
    Ok(Some(PlannerViewTarget {
        entity: entity.into(),
        target_id: id.into(),
    }))
}

pub(crate) fn calendar_selected(app: &tauri::AppHandle) -> Result<bool, String> {
    let navigation = app.state::<Navigation>();
    let selected = crate::lock(&navigation.tab)?.as_str() == "calendar";
    Ok(selected)
}

#[tauri::command]
pub(crate) fn set_planner_tab(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    tab: String,
) -> Result<(), String> {
    if window.label() != "planner" || !supported_tab(&tab) {
        return Err("플래너에서 지원되는 화면을 선택해 주세요.".into());
    }
    *crate::lock(&app.state::<Navigation>().tab)? = tab;
    crate::app::publish(&app, &app.state::<std::sync::Arc<crate::AppState>>());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_view_target;
    use serde_json::json;

    #[test]
    fn planner_view_target_validates_entity_and_resolves_only_live_sources_without_writes() {
        let db = rusqlite::Connection::open_in_memory().unwrap();
        crate::diary::initialize(&db).unwrap();
        crate::widgets::storage::initialize(&db).unwrap();
        let state = crate::diary::update_in_transaction(
            &db,
            0,
            "page-create",
            &json!({"title":"관련 기록","date":null}),
        )
        .unwrap();
        let original = serde_json::to_value(&state).unwrap();
        let page_id = original["pages"][0]["id"].as_str().unwrap();
        assert_eq!(
            validate_view_target(&db, "today", Some("page"), Some(page_id))
                .unwrap()
                .unwrap()
                .target_id,
            page_id
        );
        db.execute(
            "INSERT INTO widget_instances(id,kind,version,installed,enabled,revision,data) VALUES('calendar','calendar',1,1,1,1,?1)",
            [json!({"connections":[],"events":[{"id":"event","connectionId":"local"},{"id":"cancelled","connectionId":"local","cancelled":true},{"id":"removed-source","connectionId":"missing"}]}).to_string()],
        ).unwrap();
        assert_eq!(
            validate_view_target(&db, "calendar", Some("event"), Some("event"))
                .unwrap()
                .unwrap()
                .target_id,
            "event"
        );
        for (tab, entity, id) in [
            ("calendar", Some("page"), Some(page_id)),
            ("today", Some("page"), Some("missing")),
            ("calendar", Some("event"), Some("cancelled")),
            ("calendar", Some("event"), Some("removed-source")),
            ("calendar", Some("event"), None),
            ("today", None, Some(page_id)),
            ("today", Some("unknown"), Some(page_id)),
        ] {
            assert!(validate_view_target(&db, tab, entity, id).is_err());
        }
        db.execute(
            "UPDATE widget_instances SET enabled=0 WHERE id='calendar'",
            [],
        )
        .unwrap();
        assert!(validate_view_target(&db, "calendar", Some("event"), Some("event")).is_err());
        assert!(validate_view_target(&db, "today", None, None)
            .unwrap()
            .is_none());
        assert_eq!(
            serde_json::to_value(crate::diary::read(&db).unwrap()).unwrap(),
            original
        );
    }

    #[test]
    fn diary_navigation_accepts_habits_and_ledger_without_expanding_to_unknown_tabs() {
        for tab in [
            "today",
            "todos",
            "plans",
            "calendar",
            "templates",
            "organizer",
            "habits",
            "ledger",
            "envelopes",
            "time",
        ] {
            assert!(super::supported_tab(tab));
        }
        assert!(!super::supported_tab("unknown"));
    }

    #[test]
    fn planner_settings_reject_kinds_outside_the_diary() {
        for kind in ["todo", "calendar", "weather", "music", "clock", "focus-timer", "preparation"] {
            assert!(super::planner_settings_kind(kind));
        }
        for kind in ["memo", "interaction", "fishing", "unknown"] {
            assert!(!super::planner_settings_kind(kind));
        }
    }
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
    let kind = kind.unwrap_or_else(|| "calendar".into());
    if !planner_settings_kind(&kind) {
        return Err("설정을 열 수 없는 위젯이에요.".into());
    }
    open_widget_settings(app, &kind)
}

fn planner_settings_kind(kind: &str) -> bool {
    [
        "todo",
        "calendar",
        "weather",
        "music",
        "clock",
        "focus-timer",
        "preparation",
    ]
    .contains(&kind)
}

pub(crate) fn validate_widget_settings_kind(kind: &str) -> Result<(), String> {
    if crate::widgets::is_retired(kind) {
        return Err("더 이상 지원하지 않는 위젯이에요.".into());
    }
    crate::widgets::manifest(kind).map(|_| ())
}

pub(crate) fn open_widget_settings(app: tauri::AppHandle, kind: &str) -> Result<(), String> {
    validate_widget_settings_kind(kind)?;
    *crate::lock(&app.state::<Navigation>().settings_target)? = Some(kind.into());
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
