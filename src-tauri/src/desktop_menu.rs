use crate::{lock, widgets, AppState};
use std::sync::Arc;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    Manager,
};

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
        }
    }
    if !quit_replaced || !close_replaced {
        return Err("macOS 종료·창 닫기 메뉴를 연결하지 못했어요.".into());
    }
    app.on_menu_event(|app, event| {
        if event.id.as_ref() == "comet-window-close" {
            if let Some(window) = app
                .webview_windows()
                .into_values()
                .find(|window| window.is_focused().unwrap_or(false))
            {
                if let Err(error) = window.close() {
                    eprintln!("App menu window close failed: {error}");
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
                eprintln!("App menu quit failed: {error}");
            }
        });
    });
    app.set_menu(menu).map_err(|error| error.to_string())?;
    Ok(())
}

fn menu(app: &tauri::AppHandle) -> Result<Menu<tauri::Wry>, String> {
    let state = app.state::<Arc<AppState>>();
    let instances = {
        let db = lock(&state.db)?;
        widgets::storage::instances(&db)?
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
    let submenu = Submenu::new(app, "위젯 바로 열기", true).map_err(|error| error.to_string())?;
    for instance in instances
        .iter()
        .filter(|instance| instance.installed && instance.enabled)
    {
        let manifest = widgets::manifest(&instance.kind)?;
        let item = MenuItem::with_id(
            app,
            format!("widget:{}", instance.id),
            manifest.name,
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
    for (id, text) in [("settings", "설정"), ("quit", "종료")] {
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
        if let (Some(tray), Ok(menu)) = (handle.tray_by_id("comet"), menu(&handle)) {
            let _ = tray.set_menu(Some(menu));
        }
    });
}

pub(crate) fn create(app: &tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    install_macos_menu(app)?;
    let menu = menu(app)?;
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
                let result = match id.as_str() {
                    "launcher" => crate::app::launcher::open_launcher(app.clone(), state).await,
                    "show" => {
                        crate::show_boxes(&app, &state);
                        Ok(())
                    }
                    "hide" => crate::hide_boxes(app.clone(), state).await,
                    "widgets" => crate::open_widgets(app.clone()).await,
                    "settings" => crate::open_settings(app.clone()).await,
                    "pause" => crate::set_paused(app.clone(), state, true, None),
                    "pause-hour" => crate::set_paused(app.clone(), state, true, Some(60)),
                    "resume" => crate::set_paused(app.clone(), state, false, None),
                    "quit" => crate::quit_app(app.clone(), state, None).await,
                    _ => {
                        if let Some(widget_id) = id.strip_prefix("widget:") {
                            crate::open_widget(app.clone(), state, widget_id.into()).await
                        } else {
                            Ok(())
                        }
                    }
                };
                if let Err(error) = result {
                    eprintln!("Menu action failed: {error}");
                }
            });
        })
        .build(app)
        .map_err(|error| error.to_string())?;
    Ok(())
}
