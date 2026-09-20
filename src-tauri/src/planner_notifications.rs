use tauri::Emitter;

#[tauri::command]
pub(crate) async fn get_planner_notification_permission(
    app: tauri::AppHandle,
) -> Result<String, String> {
    native::permission(&app, false).await
}

#[tauri::command]
pub(crate) async fn request_planner_notification_permission(
    app: tauri::AppHandle,
) -> Result<String, String> {
    // This is only invoked by the explicit permission button, never by a timer.
    native::permission(&app, true).await
}

#[tauri::command]
pub(crate) async fn preview_planner_notification(app: tauri::AppHandle) -> Result<(), String> {
    let permission = native::permission(&app, false).await?;
    if permission != "granted" && permission != "system" {
        return Err("OS 알림 권한을 먼저 허용해 주세요.".into());
    }
    native::show(
        &app,
        "preview",
        0,
        "일정 10분 전이에요. 플래너에서 준비할 일을 확인해 볼까요?",
    )
}

pub(crate) fn install(app: &tauri::AppHandle) -> Result<(), String> {
    native::install(app)
}

pub(crate) fn deliver(app: &tauri::AppHandle, instance_id: &str, observed_at: i64, text: &str) {
    if let Err(error) = native::show(app, instance_id, observed_at, text) {
        let _ = app.emit("planner-notification-error", error);
    }
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
        UNNotificationResponse, UNNotificationSettings, UNUserNotificationCenter,
        UNUserNotificationCenterDelegate,
    };
    use std::{
        ptr::NonNull,
        sync::{Arc, Mutex},
        time::Duration,
    };
    use tauri::{Emitter, Manager};

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
                _: &UNNotification,
                completion: &block2::DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
            ) {
                completion.call((UNNotificationPresentationOptions::Banner
                    | UNNotificationPresentationOptions::List,));
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
            &NSString::from_str("플래너 열기"),
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
        center.setNotificationCategories(&NSSet::from_retained_slice(&[category]));
        center.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
        app.manage(Registration {
            _delegate: delegate,
        });
        Ok(())
    }

    fn handle_response(app: &tauri::AppHandle, action: &str, identifier: &str) {
        if action == "planner-snooze" {
            let Some((instance_id, observed_at)) = identifier
                .strip_prefix("planner:")
                .and_then(|value| value.rsplit_once(':'))
            else {
                return;
            };
            let Ok(observed_at) = observed_at.parse::<i64>() else {
                return;
            };
            let Some(state) = app.try_state::<Arc<crate::AppState>>() else {
                return;
            };
            let result = crate::widget_commands::change(&state, |db| {
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
                let _ = app.emit("planner-notification-error", error);
            }
            let _ = crate::widget_commands::cancel_widget_scene(app, &state);
            crate::widget_commands::publish_widgets(app, &state);
        } else if action == "planner-open"
            || action == "com.apple.UNNotificationDefaultActionIdentifier"
        {
            let app_handle = app.clone();
            let _ = app.run_on_main_thread(move || {
                let _ = crate::planner_windows::open(&app_handle, "today");
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
                            "OS 알림 권한을 요청하지 못했어요. 시스템 설정에서 확인해 주세요."
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
        app: &tauri::AppHandle,
        instance_id: &str,
        observed_at: i64,
        text: &str,
    ) -> Result<(), String> {
        if !bundled_app() {
            return Err("OS 알림은 빌드된 Comet 앱에서 사용할 수 있어요.".into());
        }
        let content = UNMutableNotificationContent::new();
        content.setTitle(&NSString::from_str("Comet · 생활 알림"));
        content.setBody(&NSString::from_str(text));
        content.setThreadIdentifier(&NSString::from_str("comet-planner"));
        if observed_at > 0 {
            content.setCategoryIdentifier(&NSString::from_str("comet-planner"));
        }
        let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
            &NSString::from_str(&format!("planner:{instance_id}:{observed_at}")),
            &content,
            None,
        );
        let app = app.clone();
        let callback = RcBlock::new(move |error: *mut NSError| {
            if !error.is_null() {
                let _ = app.emit(
                    "planner-notification-error",
                    "OS 알림을 표시하지 못했어요. 시스템 알림 설정을 확인해 주세요.",
                );
            }
        });
        // A nil trigger means immediate delivery; no future OS queue survives restart.
        UNUserNotificationCenter::currentNotificationCenter()
            .addNotificationRequest_withCompletionHandler(&request, Some(&callback));
        Ok(())
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
    pub fn show(app: &tauri::AppHandle, _: &str, _: i64, text: &str) -> Result<(), String> {
        app.notification()
            .builder()
            .title("Comet · 생활 알림")
            .body(text)
            .show()
            .map_err(|_| "OS 알림을 표시하지 못했어요. 시스템 알림 설정을 확인해 주세요.".into())
    }
}
