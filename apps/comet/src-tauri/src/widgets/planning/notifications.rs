use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};

static DELIVERY_SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn next_delivery() -> u64 {
    DELIVERY_SEQUENCE.fetch_add(1, Ordering::SeqCst) + 1
}
use tauri::Manager;

#[cfg(test)]
mod tests;

#[tauri::command]
pub(crate) fn get_planner_bubble_available(
    state: tauri::State<'_, Arc<crate::AppState>>,
    id: String,
) -> Result<bool, String> {
    let _action = crate::lock(&state.action)?;
    let db = crate::lock(&state.db)?;
    Ok(!state.launcher_open.load(Ordering::SeqCst)
        && !crate::lock(&state.runtime)?.hidden
        && crate::store::settings(&db)?.autonomous_enabled
        && crate::widgets::storage::reaction_enabled(&db, &id)?)
}

#[tauri::command]
pub(crate) async fn get_planner_notification_permission(
    app: tauri::AppHandle,
) -> Result<String, String> {
    let permission = native::permission(&app, false).await?;
    save_permission(&app, &permission);
    Ok(permission)
}

#[tauri::command]
pub(crate) async fn request_planner_notification_permission(
    app: tauri::AppHandle,
) -> Result<String, String> {
    // Only explicit user actions request permission, never an automatic event.
    let permission = native::permission(&app, true).await?;
    save_permission(&app, &permission);
    Ok(permission)
}

#[tauri::command]
pub(crate) async fn preview_planner_notification(app: tauri::AppHandle) -> Result<(), String> {
    let permission = native::permission(&app, false).await?;
    if permission != "granted" && permission != "system" {
        return Err("OS 알림 권한을 먼저 허용해 주세요.".into());
    }
    let sequence = next_delivery();
    let result = native::show(
        &app,
        "preview",
        0,
        "일정 10분 전이에요. 플래너에서 준비할 일을 확인해 볼까요?",
        false,
        false,
        "preview",
    );
    let result = wait_for_delivery(result).await;
    save_delivery_result(&app, sequence, result.as_ref().err().cloned());
    result
}

async fn wait_for_delivery(
    result: Result<tokio::sync::oneshot::Receiver<Result<(), String>>, String>,
) -> Result<(), String> {
    let receive = result?;
    tokio::time::timeout(std::time::Duration::from_secs(10), receive)
        .await
        .map_err(|_| "OS 알림 확인 시간이 지났어요.".to_string())?
        .map_err(|_| "OS 알림 확인이 중단됐어요.".to_string())?
}

async fn wait_for_travel_delivery(
    result: Result<tokio::sync::oneshot::Receiver<Result<(), String>>, String>,
    timeout: std::time::Duration,
    on_timeout: impl FnOnce(),
) -> Result<(), String> {
    let mut receive = result?;
    match tokio::time::timeout(timeout, &mut receive).await {
        Ok(result) => result.map_err(|_| "OS 알림 확인이 중단됐어요.".to_string())?,
        Err(_) => {
            on_timeout();
            receive
                .await
                .map_err(|_| "OS 알림 확인이 중단됐어요.".to_string())?
        }
    }
}

pub(crate) async fn permission(app: &tauri::AppHandle) -> Result<String, String> {
    let permission = native::permission(app, false).await?;
    save_permission(app, &permission);
    Ok(permission)
}

pub(crate) async fn show_plain(
    app: &tauri::AppHandle,
    text: &str,
    travel_id: &str,
    sound: bool,
) -> Result<(), String> {
    let sequence = next_delivery();
    // A unique identifier keeps macOS from replacing an earlier undismissed reminder.
    let id = format!("travel-{}", uuid::Uuid::new_v4());
    let key = encode_destination(Some(&("travel".into(), None, Some(travel_id.into()))));
    let result = wait_for_travel_delivery(
        native::show(app, &id, 0, text, sound, false, &key),
        std::time::Duration::from_secs(10),
        || save_delivery_result(app, sequence, Some("OS 알림 확인 시간이 지났어요.".into())),
    )
    .await;
    save_delivery_result(app, sequence, result.as_ref().err().cloned());
    result
}

pub(crate) fn show_external(app: &tauri::AppHandle, text: &str, sound: bool) {
    let sequence = next_delivery();
    let id = format!("external-{}", uuid::Uuid::new_v4());
    let result = native::show(app, &id, 0, text, sound, false, "external");
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let result = wait_for_delivery(result).await;
        save_delivery_result(&app, sequence, result.err());
    });
}

fn save_permission(app: &tauri::AppHandle, permission: &str) {
    let Some(state) = app.try_state::<Arc<crate::AppState>>() else {
        return;
    };
    let result = crate::widgets::commands::change(&state, |db| {
        save_permission_in_db(db, permission, &DELIVERY_SEQUENCE)
    });
    if result == Ok(true) {
        crate::widgets::commands::publish_widgets(app, &state);
    }
}

fn save_permission_in_db(
    db: &rusqlite::Connection,
    permission: &str,
    sequence: &AtomicU64,
) -> Result<bool, String> {
    let calendar = crate::widgets::storage::instances(db)?
        .into_iter()
        .find(|instance| instance.kind == "calendar");
    if let Some(calendar) = calendar {
        let previous = calendar.data["alertState"]["permission"].as_str();
        if previous == Some(permission) {
            return Ok(false);
        }
        let recovered = matches!(permission, "granted" | "system")
            && previous.is_some_and(|value| matches!(value, "denied" | "prompt"));
        let mut data = calendar.data;
        data["alertState"]["permission"] = serde_json::json!(permission);
        if recovered {
            sequence.fetch_add(1, Ordering::SeqCst);
            data["alertState"]["lastDeliveryError"] = serde_json::Value::Null;
        }
        db.execute(
            "UPDATE widget_instances SET data=?1 WHERE id=?2",
            rusqlite::params![data.to_string(), calendar.id],
        )
        .map_err(|error| error.to_string())?;
    }
    Ok(true)
}

fn save_delivery_error(app: &tauri::AppHandle, error: Option<String>) {
    save_delivery_result(app, next_delivery(), error);
}

fn save_delivery_result(app: &tauri::AppHandle, sequence: u64, error: Option<String>) {
    let Some(state) = app.try_state::<Arc<crate::AppState>>() else {
        return;
    };
    let result = crate::widgets::commands::change(&state, |db| {
        save_delivery_result_in_db(db, &DELIVERY_SEQUENCE, sequence, error.as_deref())
    });
    if result != Ok(true) {
        return;
    }
    crate::widgets::commands::publish_widgets(app, &state);
}

fn save_delivery_result_in_db(
    db: &rusqlite::Connection,
    latest: &AtomicU64,
    sequence: u64,
    error: Option<&str>,
) -> Result<bool, String> {
    if latest.load(Ordering::SeqCst) != sequence {
        return Ok(false);
    }
    let value = serde_json::to_string(&error).map_err(|error| error.to_string())?;
    db.execute(
        "UPDATE widget_instances SET data=json_set(data,'$.alertState.lastDeliveryError',json(?1)) WHERE kind='calendar'",
        [&value],
    ).map_err(|error| error.to_string())?;
    Ok(true)
}

fn encode_destination(destination: Option<&(String, Option<String>, Option<String>)>) -> String {
    destination
        .and_then(|value| serde_json::to_vec(value).ok())
        .map(|bytes| bytes.iter().map(|byte| format!("{byte:02x}")).collect())
        .unwrap_or_default()
}

#[cfg(any(test, target_os = "macos"))]
fn decode_destination(value: &str) -> Option<(String, Option<String>, Option<String>)> {
    if !value.as_bytes().chunks_exact(2).remainder().is_empty() {
        return None;
    }
    let bytes = value
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            std::str::from_utf8(pair)
                .ok()
                .and_then(|part| u8::from_str_radix(part, 16).ok())
        })
        .collect::<Option<Vec<_>>>()?;
    serde_json::from_slice(&bytes).ok()
}

#[cfg(any(test, target_os = "macos"))]
fn is_external_notification(identifier: &str) -> bool {
    identifier.starts_with("planner:external-")
}

pub(crate) fn install(app: &tauri::AppHandle) -> Result<(), String> {
    native::install(app)
}

pub(crate) fn deliver(
    app: &tauri::AppHandle,
    delivery: crate::widgets::reminders::Delivery,
    observed_at: i64,
    epoch: u64,
) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let permitted = permission(&app)
            .await
            .as_deref()
            .is_ok_and(|value| matches!(value, "granted" | "system"));
        let start_delivery = || {
            let sequence = next_delivery();
            let result = if permitted {
                show_delivery(&app, &delivery, observed_at)
            } else {
                Err("OS 알림 권한을 먼저 허용해 주세요.".into())
            };
            (sequence, result)
        };
        let (sequence, result) = if let Some(event) = delivery.fallback.as_ref() {
            let Some(state) = app.try_state::<Arc<crate::AppState>>() else {
                return;
            };
            let current = crate::widgets::commands::change(&state, |db| {
                let event_current = delivery.grouped || delivery_event_current(db, event)?;
                if !delivery_current(epoch, state.epoch.load(Ordering::SeqCst), event_current) {
                    return Ok(None);
                }
                Ok(Some(start_delivery()))
            });
            let Ok(Some(current)) = current else {
                return;
            };
            current
        } else {
            start_delivery()
        };
        let result = wait_for_delivery(result).await;
        if let Some(state) = app.try_state::<Arc<crate::AppState>>() {
            restore_failed_delivery(&state, &delivery, epoch, &result);
        }
        save_delivery_result(&app, sequence, result.err());
    });
}

fn delivery_current(epoch: u64, current_epoch: u64, event_current: bool) -> bool {
    epoch == current_epoch && event_current
}

fn restore_failed_delivery(
    state: &crate::AppState,
    delivery: &crate::widgets::reminders::Delivery,
    epoch: u64,
    result: &Result<(), String>,
) {
    if result.is_ok() {
        return;
    }
    let _ = crate::widgets::commands::change(state, |db| {
        for event in delivery.fallback.iter().chain(&delivery.additional_fallbacks) {
            let _ = restore_fallback(state, db, event, epoch);
        }
        Ok(())
    });
}

pub(crate) fn deliver_automatic_widget(
    app: &tauri::AppHandle,
    db: &rusqlite::Connection,
    event: &crate::widgets::WidgetEvent,
) -> Result<(), String> {
    if !automatic_delivery_current(db, event)? {
        return Ok(());
    }
    let receive = native::show(
        app,
        &event.instance_id,
        event.created_at,
        &event.event.text,
        false,
        true,
        &event.id,
    )?;
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Ok(Err(error)) = receive.await {
            save_delivery_error(&app, Some(error));
        }
    });
    Ok(())
}

fn automatic_delivery_current(
    db: &rusqlite::Connection,
    event: &crate::widgets::WidgetEvent,
) -> Result<bool, String> {
    let current = crate::widgets::storage::get(db, &event.instance_id)?;
    Ok(current.kind == "device"
        && current.data["config"]["criticalNotification"] == true
        && delivery_event_current(db, event)?)
}

fn show_delivery(
    app: &tauri::AppHandle,
    delivery: &crate::widgets::reminders::Delivery,
    observed_at: i64,
) -> Result<tokio::sync::oneshot::Receiver<Result<(), String>>, String> {
    native::show(
        app,
        &delivery.instance_id,
        observed_at,
        &delivery.text,
        delivery.sound_enabled,
        delivery.widget,
        &format!(
            "{}~{}",
            delivery.notification_key,
            encode_destination(delivery.destination.as_ref())
        ),
    )
}

fn bubble_fallback(event: &crate::widgets::WidgetEvent) -> crate::widgets::WidgetEvent {
    let mut event = event.clone();
    event.event.payload["bubbleEnabled"] = serde_json::json!(true);
    event.event.payload["osFallback"] = serde_json::json!(true);
    event
}

fn delivery_event_current(
    db: &rusqlite::Connection,
    event: &crate::widgets::WidgetEvent,
) -> Result<bool, String> {
    let current = crate::widgets::storage::get(db, &event.instance_id)?;
    Ok(event.expires_at > chrono::Utc::now().timestamp_millis()
        && !crate::widgets::is_retired(&current.kind)
        && current.revision == event.revision
        && crate::widgets::reminders::event_current(db, &bubble_fallback(event))?)
}

fn restore_fallback(
    state: &crate::AppState,
    db: &rusqlite::Connection,
    event: &crate::widgets::WidgetEvent,
    epoch: u64,
) -> Result<bool, String> {
    if state.epoch.load(Ordering::SeqCst) != epoch
        || state.launcher_open.load(Ordering::SeqCst)
        || crate::lock(&state.runtime)?.hidden
        || !crate::store::settings(db)?.autonomous_enabled
    {
        return Ok(false);
    }
    let event = bubble_fallback(event);
    if !crate::widgets::commands::event_current(db, &event)? {
        return Ok(false);
    }
    db.execute(
        "UPDATE widget_events SET data=?1,pending=1 WHERE id=?2 AND json_extract(data,'$.revision')=?3 AND json_extract(data,'$.payload.bubbleEnabled')=0",
        rusqlite::params![serde_json::to_string(&event).map_err(|error| error.to_string())?, event.id, event.revision],
    ).map(|changed| changed == 1).map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
mod native {
    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::{Bool, ProtocolObject};
    use objc2::{define_class, msg_send, AnyThread, DefinedClass};
    use objc2_foundation::{NSArray, NSError, NSObject, NSObjectProtocol, NSSet, NSString};
    use objc2_user_notifications::{
        UNAuthorizationOptions, UNAuthorizationStatus, UNMutableNotificationContent,
        UNNotification, UNNotificationAction, UNNotificationActionOptions, UNNotificationCategory,
        UNNotificationCategoryOptions, UNNotificationPresentationOptions, UNNotificationRequest,
        UNNotificationResponse, UNNotificationSettings, UNNotificationSound,
        UNUserNotificationCenter, UNUserNotificationCenterDelegate,
    };
    use std::{
        ptr::NonNull,
        sync::{Arc, Mutex},
        time::Duration,
    };
    use tauri::Manager;

    define_class!(
        #[unsafe(super = NSObject)]
        #[thread_kind = AnyThread]
        #[ivars = tauri::AppHandle]
        struct PlannerNotificationDelegate;
        unsafe impl NSObjectProtocol for PlannerNotificationDelegate {}
        unsafe impl UNUserNotificationCenterDelegate for PlannerNotificationDelegate {
            #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
            fn will_present(
                &self,
                _: &UNUserNotificationCenter,
                notification: &UNNotification,
                completion: &block2::DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
            ) {
                let mut options = UNNotificationPresentationOptions::Banner
                    | UNNotificationPresentationOptions::List;
                if notification.request().content().sound().is_some() {
                    options |= UNNotificationPresentationOptions::Sound;
                }
                completion.call((options,));
            }
            #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
            fn received(
                &self,
                _: &UNUserNotificationCenter,
                response: &UNNotificationResponse,
                completion: &block2::DynBlock<dyn Fn()>,
            ) {
                let app = self.ivars().clone();
                let action = response.actionIdentifier().to_string();
                let identifier = response.notification().request().identifier().to_string();
                // Native callback pointers stay within this method; only owned text escapes.
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    handle_response(&app, &action, &identifier);
                }));
                completion.call(());
            }
        }
    );
    // The delegate contains only an immutable, Send + Sync AppHandle. Apple may
    // invoke notification callbacks on a background queue.
    unsafe impl Send for PlannerNotificationDelegate {}
    unsafe impl Sync for PlannerNotificationDelegate {}
    struct Registration {
        _delegate: Retained<PlannerNotificationDelegate>,
    }

    fn bundled_app() -> bool {
        std::env::current_exe().ok().is_some_and(|path| {
            path.ancestors()
                .any(|part| part.extension().is_some_and(|extension| extension == "app"))
        })
    }

    pub fn install(app: &tauri::AppHandle) -> Result<(), String> {
        // UNUserNotificationCenter raises an Objective-C exception for a bare dev
        // executable. Its permission and delivery APIs require the built .app.
        if !bundled_app() {
            return Ok(());
        }
        if app.try_state::<Registration>().is_some() {
            return Ok(());
        }
        let allocated = PlannerNotificationDelegate::alloc().set_ivars(app.clone());
        let delegate: Retained<PlannerNotificationDelegate> =
            unsafe { msg_send![super(allocated), init] };
        let center = UNUserNotificationCenter::currentNotificationCenter();
        let open = UNNotificationAction::actionWithIdentifier_title_options(
            &NSString::from_str("planner-open"),
            &NSString::from_str("다이어리 열기"),
            UNNotificationActionOptions::Foreground,
        );
        let snooze = UNNotificationAction::actionWithIdentifier_title_options(
            &NSString::from_str("planner-snooze"),
            &NSString::from_str("10분 뒤 다시 알림"),
            UNNotificationActionOptions::empty(),
        );
        let category =
            UNNotificationCategory::categoryWithIdentifier_actions_intentIdentifiers_options(
                &NSString::from_str("comet-planner"),
                &NSArray::from_retained_slice(&[open, snooze]),
                &NSArray::<NSString>::new(),
                UNNotificationCategoryOptions::empty(),
            );
        let widget_open = UNNotificationAction::actionWithIdentifier_title_options(
            &NSString::from_str("widget-open"),
            &NSString::from_str("열기"),
            UNNotificationActionOptions::Foreground,
        );
        let widget_category =
            UNNotificationCategory::categoryWithIdentifier_actions_intentIdentifiers_options(
                &NSString::from_str("comet-widget"),
                &NSArray::from_retained_slice(&[widget_open]),
                &NSArray::<NSString>::new(),
                UNNotificationCategoryOptions::empty(),
            );
        center.setNotificationCategories(&NSSet::from_retained_slice(&[category, widget_category]));
        center.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
        app.manage(Registration {
            _delegate: delegate,
        });
        Ok(())
    }

    fn handle_response(app: &tauri::AppHandle, action: &str, identifier: &str) {
        if super::is_external_notification(identifier) {
            return;
        }
        let open_action = matches!(
            action,
            "planner-open" | "widget-open" | "com.apple.UNNotificationDefaultActionIdentifier"
        );
        if open_action {
            let key = identifier.rsplit(':').next().unwrap_or_default();
            let encoded = key.split_once('~').map_or(key, |(_, value)| value);
            if let Some((tab, entity, id)) = super::decode_destination(encoded) {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let result = if tab == "travel" {
                        crate::widgets::planning::windows::open_playback_travel(&app, id)
                    } else if let Some(state) = app.try_state::<Arc<crate::AppState>>() {
                        crate::widgets::commands::change(&state, |db| {
                            crate::widgets::planning::windows::open_playback_target(
                                &app,
                                db,
                                &tab,
                                entity.as_deref(),
                                id.as_deref(),
                            )
                        })
                    } else {
                        return;
                    };
                    if let Err(error) = result {
                        super::save_delivery_error(&app, Some(error));
                    }
                });
                return;
            }
        }
        if identifier.starts_with("widget:") {
            if action != "widget-open"
                && action != "com.apple.UNNotificationDefaultActionIdentifier"
            {
                return;
            }
            let Some(id) = identifier
                .strip_prefix("widget:")
                .and_then(|value| value.split(':').next())
            else {
                return;
            };
            if uuid::Uuid::parse_str(id).is_err() {
                return;
            }
            let id = id.to_owned();
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let Some(state) = app.try_state::<Arc<crate::AppState>>() else {
                    return;
                };
                if let Err(error) =
                    crate::widgets::commands::open_widget(app.clone(), state, id).await
                {
                    super::save_delivery_error(&app, Some(error));
                }
            });
            return;
        }
        if action == "planner-snooze" {
            let Some((instance_id, observed_at)) =
                identifier.strip_prefix("planner:").and_then(|value| {
                    let (instance_id, rest) = value.split_once(':')?;
                    let observed_at = rest.split(':').next()?;
                    Some((instance_id, observed_at))
                })
            else {
                return;
            };
            let Ok(observed_at) = observed_at.parse::<i64>() else {
                return;
            };
            let Some(state) = app.try_state::<Arc<crate::AppState>>() else {
                return;
            };
            let result = crate::widgets::commands::change(&state, |db| {
                let instance = crate::widgets::storage::get(db, instance_id)?;
                if instance.kind != "calendar"
                    || instance.data["alertState"]["lastNotification"]["observedAt"].as_i64()
                        != Some(observed_at)
                {
                    return Err("이 알림 이후 일정이 바뀌었어요. 플래너에서 확인해 주세요.".into());
                }
                let now = chrono::Utc::now().timestamp_millis();
                let effect = crate::widgets::reminders::act(
                    &instance.data,
                    "snooze-alert",
                    &serde_json::json!({}),
                    now,
                )?;
                crate::widgets::storage::commit_data(
                    db,
                    instance_id,
                    instance.revision,
                    effect.data,
                    effect.events,
                    now,
                )
            });
            if let Err(error) = result {
                super::save_delivery_error(app, Some(error));
            }
            let _ = crate::widgets::commands::cancel_widget_scene(app, &state);
            crate::widgets::commands::publish_widgets(app, &state);
        } else if action == "planner-open"
            || action == "com.apple.UNNotificationDefaultActionIdentifier"
        {
            let app_handle = app.clone();
            let _ = app.run_on_main_thread(move || {
                let _ = crate::widgets::planning::windows::open(&app_handle, "today");
            });
        }
    }

    pub async fn permission(_: &tauri::AppHandle, request: bool) -> Result<String, String> {
        if !bundled_app() {
            return Err("OS 알림은 빌드된 Comet 앱에서 사용할 수 있어요.".into());
        }
        let (send, receive) = tokio::sync::oneshot::channel();
        // Completion handlers own only the sender; native references do not cross await.
        {
            let send = Mutex::new(Some(send));
            let center = UNUserNotificationCenter::currentNotificationCenter();
            if request {
                let callback = RcBlock::new(move |granted: Bool, error: *mut NSError| {
                    let value = if error.is_null() {
                        Ok(if granted.as_bool() {
                            "granted"
                        } else {
                            "denied"
                        }
                        .to_string())
                    } else {
                        Err(
                            "알림 권한을 요청하지 못했어요. 시스템 설정 → 알림에서 켜요."
                                .into(),
                        )
                    };
                    if let Ok(mut sender) = send.lock() {
                        if let Some(sender) = sender.take() {
                            let _ = sender.send(value);
                        }
                    }
                });
                center.requestAuthorizationWithOptions_completionHandler(
                    UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound,
                    &callback,
                );
            } else {
                let callback = RcBlock::new(move |settings: NonNull<UNNotificationSettings>| {
                    // The framework guarantees the settings object for the callback duration.
                    let status = unsafe { settings.as_ref() }.authorizationStatus();
                    let state = if status == UNAuthorizationStatus::Authorized
                        || status == UNAuthorizationStatus::Provisional
                    {
                        "granted"
                    } else if status == UNAuthorizationStatus::Denied {
                        "denied"
                    } else {
                        "prompt"
                    };
                    if let Ok(mut sender) = send.lock() {
                        if let Some(sender) = sender.take() {
                            let _ = sender.send(Ok(state.to_string()));
                        }
                    }
                });
                center.getNotificationSettingsWithCompletionHandler(&callback);
            }
        }
        tokio::time::timeout(Duration::from_secs(if request { 180 } else { 10 }), receive)
            .await
            .map_err(|_| "OS 알림 권한 확인 시간이 지났어요. 다시 확인해 주세요.".to_string())?
            .map_err(|_| "OS 알림 권한 확인이 중단됐어요.".to_string())?
    }

    pub fn show(
        _app: &tauri::AppHandle,
        instance_id: &str,
        observed_at: i64,
        text: &str,
        sound_enabled: bool,
        widget: bool,
        notification_key: &str,
    ) -> Result<tokio::sync::oneshot::Receiver<Result<(), String>>, String> {
        if !bundled_app() {
            return Err("OS 알림은 빌드된 Comet 앱에서 사용할 수 있어요.".into());
        }
        let content = UNMutableNotificationContent::new();
        content.setTitle(&NSString::from_str("Comet · 생활 알림"));
        content.setBody(&NSString::from_str(text));
        if sound_enabled {
            content.setSound(Some(&UNNotificationSound::defaultSound()));
        }
        content.setThreadIdentifier(&NSString::from_str("comet-planner"));
        if observed_at > 0 {
            content.setCategoryIdentifier(&NSString::from_str(if widget {
                "comet-widget"
            } else {
                "comet-planner"
            }));
        }
        let identifier = if widget {
            format!("widget:{instance_id}:{observed_at}:{notification_key}")
        } else {
            format!("planner:{instance_id}:{observed_at}:{notification_key}")
        };
        let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
            &NSString::from_str(&identifier),
            &content,
            None,
        );
        let (send, receive) = tokio::sync::oneshot::channel();
        let send = Mutex::new(Some(send));
        let callback = RcBlock::new(move |error: *mut NSError| {
            let result = if error.is_null() {
                Ok(())
            } else {
                Err("OS 알림을 표시하지 못했어요. 시스템 알림 설정을 확인해 주세요.".into())
            };
            if let Ok(mut sender) = send.lock() {
                if let Some(sender) = sender.take() {
                    let _ = sender.send(result);
                }
            }
        });
        // A nil trigger means immediate delivery; no future OS queue survives restart.
        UNUserNotificationCenter::currentNotificationCenter()
            .addNotificationRequest_withCompletionHandler(&request, Some(&callback));
        Ok(receive)
    }
}

#[cfg(not(target_os = "macos"))]
mod native {
    use tauri_plugin_notification::NotificationExt;
    pub fn install(_: &tauri::AppHandle) -> Result<(), String> {
        Ok(())
    }
    pub async fn permission(_: &tauri::AppHandle, _: bool) -> Result<String, String> {
        // Desktop plugin APIs cannot report the operating system's actual setting.
        Ok("system".into())
    }
    pub fn show(
        app: &tauri::AppHandle,
        _: &str,
        _: i64,
        text: &str,
        sound_enabled: bool,
        _: bool,
        _: &str,
    ) -> Result<tokio::sync::oneshot::Receiver<Result<(), String>>, String> {
        let mut notification = app
            .notification()
            .builder()
            .title("Comet · 생활 알림")
            .body(text);
        if sound_enabled {
            notification = notification.sound(if cfg!(windows) {
                "Default"
            } else {
                "message-new-instant"
            });
        }
        let (send, receive) = tokio::sync::oneshot::channel();
        let result = notification
            .show()
            .map_err(|_| "OS 알림을 표시하지 못했어요. 시스템 알림 설정을 확인해 주세요.".into());
        let _ = send.send(result);
        Ok(receive)
    }
}
