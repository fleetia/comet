use crate::{lock, widgets, AppState};
use std::sync::Arc;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    Listener, Manager,
};
use tauri_plugin_dialog::DialogExt;

#[cfg(any(target_os = "macos", test))]
fn protected_window(label: &str) -> bool {
    crate::desktop::is_body(label)
        || crate::desktop::is_face(label)
        || label == "widget-stack"
        || label.starts_with("widget-display-")
}

#[cfg(any(target_os = "macos", test))]
pub(crate) fn panel_window(label: &str) -> bool {
    matches!(
        label,
        "settings"
            | "planner"
            | "travel"
            | "conversation-history"
            | "story-editor"
            | "widget-workshop"
    ) || (label.starts_with("widget-")
        && label != "widget-editor"
        && !protected_window(label)
        && !label.contains("-image-")
        && !label.contains("-note-"))
        || label.starts_with("generated-widget-")
}

fn can_restore_stack(layout: &serde_json::Value) -> bool {
    layout["mode"] == "stack"
        && layout["stackHidden"] == true
        && layout["order"]
            .as_array()
            .is_some_and(|order| !order.is_empty())
}

fn desktop_state_stack_visibility(layout: Option<&serde_json::Value>) -> bool {
    layout.is_some_and(can_restore_stack)
}

fn tray_widget_failure(result: Result<(), widgets::commands::WidgetOpenError>) -> Option<String> {
    match result {
        Err(widgets::commands::WidgetOpenError::Failed(error)) => Some(error),
        Ok(()) | Err(widgets::commands::WidgetOpenError::Cancelled) => None,
    }
}

#[cfg(any(target_os = "macos", test))]
fn opens_settings_from_app_menu(id: &str) -> bool {
    id == "comet-app-settings"
}

fn widget_label(kind: &str, name: &str, available: bool) -> String {
    if !available {
        format!("{name} 설정 열기")
    } else if kind == "image" {
        "이미지 띄우기".into()
    } else if kind == "memo" {
        "새 메모 꺼내기".into()
    } else {
        name.into()
    }
}

#[cfg(target_os = "macos")]
fn install_macos_menu(app: &tauri::AppHandle) -> Result<(), String> {
    use tauri::menu::PredefinedMenuItem;

    let menu = Menu::default(app).map_err(|error| error.to_string())?;
    let quit_label = PredefinedMenuItem::quit(app, None)
        .and_then(|item| item.text())
        .map_err(|error| error.to_string())?;
    let quit = MenuItem::with_id(app, "comet-app-quit", &quit_label, true, Some("Cmd+Q"))
        .map_err(|error| error.to_string())?;
    let close_label = PredefinedMenuItem::close_window(app, None)
        .and_then(|item| item.text())
        .map_err(|error| error.to_string())?;
    let close = MenuItem::with_id(app, "comet-window-close", &close_label, true, Some("Cmd+W"))
        .map_err(|error| error.to_string())?;
    let minimize_label = PredefinedMenuItem::minimize(app, None)
        .and_then(|item| item.text())
        .map_err(|error| error.to_string())?;
    let minimize = MenuItem::with_id(
        app,
        "comet-window-minimize",
        &minimize_label,
        false,
        Some("Cmd+M"),
    )
    .map_err(|error| error.to_string())?;
    let settings = MenuItem::with_id(app, "comet-app-settings", "설정…", true, Some("Cmd+,"))
        .map_err(|error| error.to_string())?;
    let mut minimize_replaced = false;
    let mut quit_replaced = false;
    let mut close_replaced = false;
    for item in menu.items().map_err(|error| error.to_string())? {
        let Some(submenu) = item.as_submenu() else {
            continue;
        };
        for (index, child) in submenu
            .items()
            .map_err(|error| error.to_string())?
            .iter()
            .enumerate()
        {
            let Some(predefined) = child.as_predefined_menuitem() else {
                continue;
            };
            // Native terminate: skips ExitRequested; performClose: cannot close a
            // borderless window. Match the predefined labels to keep localization.
            let label = predefined.text().map_err(|error| error.to_string())?;
            let replacement = if label == quit_label {
                quit_replaced = true;
                &quit
            } else if label == minimize_label {
                minimize_replaced = true;
                &minimize
            } else if label == close_label {
                close_replaced = true;
                &close
            } else {
                continue;
            };
            submenu
                .remove(predefined)
                .map_err(|error| error.to_string())?;
            submenu
                .insert(replacement, index)
                .map_err(|error| error.to_string())?;
            if label == quit_label {
                submenu
                    .insert(&settings, index)
                    .map_err(|error| error.to_string())?;
            }
        }
    }
    if !quit_replaced || !close_replaced || !minimize_replaced {
        return Err("macOS 종료·창 닫기 메뉴를 연결하지 못했어요.".into());
    }
    app.on_menu_event(|app, event| {
        if opens_settings_from_app_menu(event.id.as_ref()) {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = crate::open_settings(app).await {
                    crate::report_error!("menu_settings", "App menu settings failed: {error}");
                }
            });
            return;
        }
        if event.id.as_ref() == "comet-window-minimize" {
            if let Some(window) = app
                .webview_windows()
                .into_values()
                .find(|window| window.is_focused().unwrap_or(false) && panel_window(window.label()))
            {
                if let Err(error) = window.minimize() {
                    crate::report_error!(
                        "menu_window_minimize",
                        "App menu window minimize failed: {error}"
                    );
                }
            }
            return;
        }
        if event.id.as_ref() == "comet-window-close" {
            if let Some(window) = app.webview_windows().into_values().find(|window| {
                window.is_focused().unwrap_or(false) && !protected_window(window.label())
            }) {
                if let Err(error) = window.close() {
                    crate::report_error!(
                        "menu_window_close",
                        "App menu window close failed: {error}"
                    );
                }
            }
            return;
        }
        if event.id.as_ref() != "comet-app-quit" {
            return;
        }
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let state = app.state::<Arc<AppState>>();
            if let Err(error) = crate::quit_app(app.clone(), state, None).await {
                crate::report_error!("menu_quit", "App menu quit failed: {error}");
            }
        });
    });
    app.set_menu(menu).map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(target_os = "macos")]
pub(crate) fn update_minimize(app: &tauri::AppHandle, label: &str, focused: bool) {
    let enabled = if focused {
        panel_window(label)
    } else {
        app.webview_windows().into_values().any(|window| {
            window.label() != label
                && window.is_focused().unwrap_or(false)
                && panel_window(window.label())
        })
    };
    let Some(menu) = app.menu() else {
        return;
    };
    for item in menu.items().unwrap_or_default() {
        let Some(submenu) = item.as_submenu() else {
            continue;
        };
        let Some(item) = submenu.get("comet-window-minimize") else {
            continue;
        };
        if let Some(item) = item.as_menuitem() {
            let _ = item.set_enabled(enabled);
        }
    }
}

fn menu(
    app: &tauri::AppHandle,
    show_stack_recovery: bool,
) -> Result<Menu<tauri::Wry>, String> {
    let state = app.state::<Arc<AppState>>();
    let snapshot = {
        let db = lock(&state.db)?;
        widgets::storage::snapshot(&db)?
    };
    let runtime = lock(&state.runtime)?.clone();
    let menu = Menu::new(app).map_err(|error| error.to_string())?;
    for (id, text) in [
        ("launcher", "빠른 실행…"),
        if runtime.hidden {
            ("show", "캐릭터 표시")
        } else {
            ("hide", "캐릭터 숨기기")
        },
    ] {
        let item = MenuItem::with_id(app, id, text, true, None::<&str>)
            .map_err(|error| error.to_string())?;
        menu.append(&item).map_err(|error| error.to_string())?;
    }
    if show_stack_recovery {
        let item = MenuItem::with_id(
            app,
            "restore-stack",
            "모아두기 다시 표시",
            true,
            None::<&str>,
        )
        .map_err(|error| error.to_string())?;
        menu.append(&item).map_err(|error| error.to_string())?;
    }
    let submenu = Submenu::new(app, "위젯 바로 열기", true).map_err(|error| error.to_string())?;
    for manifest in snapshot
        .catalog
        .iter()
        .filter(|entry| !widgets::is_retired(&entry.id) && entry.id != "external-notice")
    {
        let instance = snapshot
            .widgets
            .iter()
            .find(|widget| widget.instance.kind == manifest.id);
        let available = instance.is_some_and(|widget| widget.status != "setup");
        let id = match instance {
            Some(widget) if available => format!("widget:{}:{}", manifest.id, widget.instance.id),
            _ => format!("widget-settings:{}", manifest.id),
        };
        let item = MenuItem::with_id(
            app,
            id,
            widget_label(&manifest.id, &manifest.name, available),
            true,
            None::<&str>,
        )
        .map_err(|error| error.to_string())?;
        submenu.append(&item).map_err(|error| error.to_string())?;
    }
    let manage = MenuItem::with_id(app, "widgets", "위젯 관리…", true, None::<&str>)
        .map_err(|error| error.to_string())?;
    submenu.append(&manage).map_err(|error| error.to_string())?;
    menu.append(&submenu).map_err(|error| error.to_string())?;
    if runtime.paused {
        let resume = MenuItem::with_id(app, "resume", "다시 시작", true, None::<&str>)
            .map_err(|error| error.to_string())?;
        menu.append(&resume).map_err(|error| error.to_string())?;
    } else {
        let pause = Submenu::new(app, "자동 잡담 쉬기", true).map_err(|error| error.to_string())?;
        for (id, text) in [("pause-hour", "1시간"), ("pause", "다시 시작할 때까지")] {
            let item = MenuItem::with_id(app, id, text, true, None::<&str>)
                .map_err(|error| error.to_string())?;
            pause.append(&item).map_err(|error| error.to_string())?;
        }
        menu.append(&pause).map_err(|error| error.to_string())?;
    }
    let separator = PredefinedMenuItem::separator(app).map_err(|error| error.to_string())?;
    menu.append(&separator).map_err(|error| error.to_string())?;
    for (id, text) in [("guide", "안내서"), ("settings", "설정"), ("quit", "종료")] {
        let item = MenuItem::with_id(app, id, text, true, None::<&str>)
            .map_err(|error| error.to_string())?;
        menu.append(&item).map_err(|error| error.to_string())?;
    }
    Ok(menu)
}

pub(crate) fn refresh(app: &tauri::AppHandle) {
    static REFRESH: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let _refresh = REFRESH.lock().await;
        let layout = widgets::desktop::get_widget_desktop(handle.state::<Arc<AppState>>())
            .await
            .ok()
            .and_then(|value| serde_json::to_value(value).ok());
        let show_stack_recovery = desktop_state_stack_visibility(layout.as_ref());
        if let (Some(tray), Ok(menu)) = (
            handle.tray_by_id("comet"),
            menu(&handle, show_stack_recovery),
        ) {
            let _ = tray.set_menu(Some(menu));
        }
    });
}

pub(crate) fn create(app: &tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    install_macos_menu(app)?;
    let menu = menu(app, false)?;
    tauri::tray::TrayIconBuilder::with_id("comet")
        .icon(tauri::include_image!("icons/tray.png"))
        .icon_as_template(true)
        .tooltip("Comet")
        .menu(&menu)
        .on_menu_event(|app, event| {
            let id = event.id.as_ref().to_string();
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let state = app.state::<Arc<AppState>>();
                let result: Result<(), String> = async {
                    match id.as_str() {
                        "launcher" => crate::app::launcher::open_launcher(app.clone(), state).await,
                        "show" => {
                            crate::show_boxes(&app, &state);
                            Ok(())
                        }
                        "hide" => crate::hide_boxes(app.clone(), state).await,
                        "widgets" => crate::open_widgets(app.clone()).await,
                        "restore-stack" => {
                            let layout =
                                widgets::desktop::get_widget_desktop(app.state::<Arc<AppState>>())
                                    .await?;
                            let value =
                                serde_json::to_value(layout).map_err(|error| error.to_string())?;
                            if can_restore_stack(&value) {
                                widgets::desktop::open_widget_stack(
                                    app.clone(),
                                    app.state::<Arc<AppState>>(),
                                )
                                .await
                            } else {
                                Ok(())
                            }
                        }
                        "guide" => crate::guide::open_from_navigation(app.clone()),
                        "settings" => crate::open_settings(app.clone()).await,
                        "pause" => crate::set_paused(app.clone(), state, true, None),
                        "pause-hour" => crate::set_paused(app.clone(), state, true, Some(60)),
                        "resume" => crate::set_paused(app.clone(), state, false, None),
                        "quit" => crate::quit_app(app.clone(), state, None).await,
                        _ => {
                            if let Some(kind) = id.strip_prefix("widget-settings:") {
                                widgets::planning::windows::open_widget_settings(app.clone(), kind)
                            } else if let Some((kind, widget_id)) = id
                                .strip_prefix("widget:")
                                .and_then(|value| value.split_once(':'))
                            {
                                if let Some(error) = tray_widget_failure(
                                    widgets::commands::open_widget_with_result(
                                        app.clone(),
                                        state,
                                        widget_id.into(),
                                    )
                                    .await,
                                ) {
                                    if let Err(settings_error) =
                                        widgets::planning::windows::open_widget_settings(
                                            app.clone(),
                                            kind,
                                        )
                                    {
                                        crate::report_error!(
                                            "menu_widget_settings",
                                            "Widget settings failed: {settings_error}"
                                        );
                                    }
                                    app.dialog()
                                        .message(error)
                                        .title("위젯을 열지 못했어요")
                                        .show(|_| {});
                                }
                                Ok(())
                            } else {
                                Ok(())
                            }
                        }
                    }
                }
                .await;
                if let Err(error) = result {
                    crate::report_error!("menu_action", "Menu action failed: {error}");
                }
            });
        })
        .build(app)
        .map_err(|error| error.to_string())?;
    let handle = app.clone();
    app.listen("widget-desktop-state", move |_| refresh(&handle));
    refresh(app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resident_windows_are_excluded_from_close() {
        for label in [
            "body-resident",
            "body-guest",
            "face-resident",
            "widget-stack",
            "widget-display-clock",
        ] {
            assert!(protected_window(label), "{label}");
        }
        for label in ["settings", "balloon", "conversation-input", "widget-123"] {
            assert!(!protected_window(label), "{label}");
        }
    }

    #[test]
    fn panel_windows_exclude_desktop_items() {
        for label in ["settings", "planner", "widget-123", "generated-widget-123"] {
            assert!(panel_window(label), "{label}");
        }
        for label in [
            "body-resident",
            "face-resident",
            "widget-stack",
            "widget-display-clock",
            "widget-editor",
            "widget-123-image-456",
            "widget-123-note-456",
            "balloon",
            "conversation-input",
        ] {
            assert!(!panel_window(label), "{label}");
        }
    }

    #[test]
    fn tray_desktop_state_drives_stack_visibility() {
        assert!(desktop_state_stack_visibility(Some(
            &serde_json::json!({"mode":"stack","stackHidden":true,"order":["clock"]})
        )));
        assert!(!desktop_state_stack_visibility(Some(
            &serde_json::json!({"mode":"stack","stackHidden":false,"order":["clock"]})
        )));
        assert!(!desktop_state_stack_visibility(Some(
            &serde_json::json!({"mode":"freeform","stackHidden":true,"order":["clock"]})
        )));
        assert!(!desktop_state_stack_visibility(Some(
            &serde_json::json!({"mode":"stack","stackHidden":true,"order":[]})
        )));
        assert!(!desktop_state_stack_visibility(None));
    }

    #[test]
    fn tray_widget_open_only_reports_failures() {
        use widgets::commands::WidgetOpenError;
        assert_eq!(tray_widget_failure(Ok(())), None);
        assert_eq!(tray_widget_failure(Err(WidgetOpenError::Cancelled)), None);
        assert_eq!(
            tray_widget_failure(Err(WidgetOpenError::Failed("실패".into()))),
            Some("실패".into())
        );
    }

    #[test]
    fn app_menu_settings_action_matches_its_menu_id() {
        assert!(opens_settings_from_app_menu("comet-app-settings"));
        assert!(!opens_settings_from_app_menu("settings"));
        assert!(!opens_settings_from_app_menu("comet-window-close"));
    }

    #[test]
    fn tray_labels_reflect_setup_and_memo_creation() {
        assert_eq!(widget_label("memo", "메모", true), "새 메모 꺼내기");
        assert_eq!(widget_label("memo", "메모", false), "메모 설정 열기");
        assert_eq!(widget_label("image", "이미지", true), "이미지 띄우기");
        assert_eq!(widget_label("weather", "날씨", false), "날씨 설정 열기");
    }
}
