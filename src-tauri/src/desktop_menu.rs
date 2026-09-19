use crate::{behavior, lock, widgets, AppState};
use std::sync::Arc;
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, Submenu},
    Manager,
};

fn menu(app: &tauri::AppHandle) -> Result<Menu<tauri::Wry>, String> {
    let state = app.state::<Arc<AppState>>();
    let (preferences, instances) = {
        let db = lock(&state.db)?;
        (
            behavior::preferences(&db)?,
            widgets::storage::instances(&db)?,
        )
    };
    let menu = Menu::new(app).map_err(|error| error.to_string())?;
    for (id, text) in [
        ("show", "캐릭터 표시"),
        ("hide", "캐릭터 숨기기"),
        ("characters", "캐릭터 관리"),
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
    let pranks = CheckMenuItem::with_id(
        app,
        "pranks",
        "장난 모드",
        true,
        preferences.pranks_enabled,
        None::<&str>,
    )
    .map_err(|error| error.to_string())?;
    menu.append(&pranks).map_err(|error| error.to_string())?;
    for (id, text) in [
        ("clear-toys", "장난감 모두 정리"),
        ("pause", "자동 행동 정지 / 재개"),
        ("updates", "업데이트 확인…"),
        ("settings", "설정"),
        ("quit", "완전 종료"),
    ] {
        let label = if id == "updates" {
            crate::updater::menu_label(app)
        } else {
            text.to_string()
        };
        let item = MenuItem::with_id(app, id, label, true, None::<&str>)
            .map_err(|error| error.to_string())?;
        menu.append(&item).map_err(|error| error.to_string())?;
    }
    Ok(menu)
}

pub(crate) fn refresh(app: &tauri::AppHandle) {
    if let (Some(tray), Ok(menu)) = (app.tray_by_id("comet"), menu(app)) {
        let _ = tray.set_menu(Some(menu));
    }
}

pub(crate) fn create(app: &tauri::AppHandle) -> Result<(), String> {
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
                    "show" => {
                        crate::show_boxes(&app, &state);
                        Ok(())
                    }
                    "hide" => crate::hide_boxes(app.clone(), state).await,
                    "characters" => crate::open_characters(app.clone()),
                    "widgets" => crate::open_widgets(app.clone()),
                    "clear-toys" => {
                        behavior::clear_desktop_toys(app.clone());
                        Ok(())
                    }
                    "settings" => crate::open_settings(app.clone()),
                    "updates" => {
                        let opened = crate::open_settings_at(app.clone(), true);
                        if opened.is_ok() {
                            let _ = crate::updater::check_app_update(app.clone()).await;
                        }
                        opened
                    }
                    "pause" => {
                        let paused = lock(&state.runtime)
                            .map(|runtime| !runtime.paused)
                            .unwrap_or(true);
                        crate::set_paused(app.clone(), state, paused)
                    }
                    "pranks" => {
                        let config = lock(&state.db).and_then(|db| behavior::preferences(&db));
                        match config {
                            Ok(mut config) => {
                                config.pranks_enabled = !config.pranks_enabled;
                                behavior::set_desktop_preferences(app.clone(), state, config).await
                            }
                            Err(error) => Err(error),
                        }
                    }
                    "quit" => crate::quit_app(app.clone(), state).await,
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
