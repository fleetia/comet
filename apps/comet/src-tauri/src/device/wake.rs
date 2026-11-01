#[cfg(any(target_os = "macos", target_os = "windows"))]
use crate::app::{lock, AppState};
#[cfg(any(target_os = "macos", target_os = "windows"))]
use std::sync::Arc;
use std::sync::Mutex;
use tauri::Manager;

#[cfg(target_os = "macos")]
static SCREEN_BLOCKS: std::sync::atomic::AtomicU8 = std::sync::atomic::AtomicU8::new(0);

pub(crate) fn screen_blocked() -> bool {
    #[cfg(target_os = "macos")]
    {
        SCREEN_BLOCKS.load(std::sync::atomic::Ordering::SeqCst) != 0
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

#[cfg(target_os = "macos")]
fn set_screen_blocked(app: &tauri::AppHandle, bit: u8, blocked: bool) {
    use std::sync::atomic::Ordering;
    if blocked {
        let previous = SCREEN_BLOCKS.fetch_or(bit, Ordering::SeqCst);
        if previous == 0 {
            let _ =
                std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| -> Result<(), String> {
                    let Some(state) = app.try_state::<Arc<AppState>>() else {
                        return Ok(());
                    };
                    {
                        let _action = lock(&state.action)?;
                        let widget = lock(&state.widget_playback)?.clone();
                        if let Some(event) = widget.as_ref() {
                            let db = lock(&state.db)?;
                            crate::widgets::commands::restore_unshown_temporal_reaction(
                                &state, &db, event, state.epoch.load(Ordering::SeqCst),
                            )?;
                        }
                        if widget.is_some() || state.automatic.load(Ordering::SeqCst) {
                            let (epoch, _) = crate::app::interrupt(&state, false)?;
                            state.widget_epoch.store(epoch, Ordering::SeqCst);
                            let mut runtime = lock(&state.runtime)?;
                            runtime.phase = crate::types::RuntimePhase::Idle;
                            runtime.persona = None;
                            runtime.error = None;
                            state.nlp.pause_indexing(false);
                        }
                    }
                    crate::publish(app, &state);
                    Ok(())
                }));
        }
    } else {
        let previous = SCREEN_BLOCKS.fetch_and(!bit, Ordering::SeqCst);
        if previous != 0 && previous & !bit == 0 {
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                if let Some(state) = app.try_state::<Arc<AppState>>() {
                    if let Ok(db) = lock(&state.db) {
                        if let Ok(settings) = crate::store::settings(&db) {
                            crate::app::schedule_idle(&state, settings.idle_minutes);
                        }
                    }
                    crate::publish(app, &state);
                }
            }));
        }
    }
}

#[cfg(any(test, target_os = "macos", target_os = "windows"))]
fn skip_wake_refresh(kind: &str, calendar_connection_in_progress: bool) -> bool {
    kind == "calendar" && calendar_connection_in_progress
}

#[cfg(any(test, target_os = "macos", target_os = "windows"))]
fn delayed_refresh_data(
    kind: &str,
    data: &serde_json::Value,
    at: i64,
) -> Option<serde_json::Value> {
    let mut next = data.clone();
    let due = serde_json::json!(at.saturating_add(30_000));
    match kind {
        "weather" if data["configured"] == true && data["status"] != "auth-error" => {
            next["nextRefreshAt"] = due;
            next["failureCount"] = serde_json::json!(0);
            if next["status"] == "syncing" {
                next["status"] = serde_json::json!("stale");
            }
        }
        "calendar" => {
            let mut changed = false;
            for connection in next["connections"].as_array_mut()? {
                if connection["status"] == "auth-error" {
                    continue;
                }
                connection["nextRefreshAt"] = due.clone();
                if connection["status"] == "syncing" {
                    connection["status"] = serde_json::json!("stale");
                }
                changed = true;
            }
            if !changed {
                return None;
            }
        }
        _ => return None,
    }
    Some(next)
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn receive_wake(app: &tauri::AppHandle) {
    // Native callbacks must never unwind through Objective-C or the window procedure.
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| -> Result<(), String> {
        let Some(state) = app.try_state::<Arc<AppState>>() else {
            return Ok(());
        };
        let at = chrono::Utc::now().timestamp_millis();
        let mut devices = Vec::new();
        {
            let _action = lock(&state.action)?;
            lock(&state.widget_clocks)?.clear();
            lock(&state.app_usage_tracker)?.clear();
            lock(&state.life)?.activity.clear();
            app.state::<crate::desktop::toys::Runtime>()
                .discard_pending_outcomes();
            if crate::unavailable(&state) {
                return Ok(());
            }
            let db = lock(&state.db)?;
            crate::app::schedule_idle(&state, crate::store::settings(&db)?.idle_minutes);
            let can_react = crate::widgets::connection_host::wake_event_allowed(&state, &db)?;
            for instance in crate::widgets::storage::instances(&db)? {
                let job = lock(&state.widget_jobs)?.get(&instance.id).cloned();
                let connecting = if instance.kind == "calendar" {
                    match job.as_ref() {
                        Some(token) => {
                            crate::widgets::connection_host::calendar_connection_in_progress(token)?
                        }
                        None => false,
                    }
                } else {
                    false
                };
                if skip_wake_refresh(&instance.kind, connecting) {
                    continue;
                }
                if let Some(data) = delayed_refresh_data(&instance.kind, &instance.data, at) {
                    if let Some(job) = lock(&state.widget_jobs)?.remove(&instance.id) {
                        job.store(true, std::sync::atomic::Ordering::SeqCst);
                    }
                    crate::widgets::storage::commit_data(
                        &db,
                        &instance.id,
                        instance.revision,
                        data,
                        vec![],
                        at,
                    )?;
                    continue;
                }
                if instance.kind != "device" || instance.data["configured"] != true {
                    continue;
                }
                if let Some(job) = lock(&state.widget_jobs)?.remove(&instance.id) {
                    job.store(true, std::sync::atomic::Ordering::SeqCst);
                }
                let mut data = instance.data.clone();
                data["lastWakeAt"] = serde_json::json!(at);
                data["pendingWakeAt"] = serde_json::json!(can_react.then_some(at));
                data["pendingWakeEpoch"] = serde_json::json!(
                    can_react.then(|| state.epoch.load(std::sync::atomic::Ordering::SeqCst))
                );
                data["pendingWakeSession"] = serde_json::json!(
                    can_react.then(crate::widgets::connection_host::wake_session)
                );
                data["nextRefreshAt"] = serde_json::json!(0);
                data["failureCount"] = serde_json::json!(0);
                data["status"] = serde_json::json!("stale");
                crate::widgets::storage::commit_data(
                    &db,
                    &instance.id,
                    instance.revision,
                    data,
                    vec![],
                    at,
                )?;
                devices.push(instance.id);
            }
        }
        for id in devices {
            crate::widgets::connection_host::refresh_device_after_wake(app, &state, id);
        }
        Ok(())
    }));
}

#[cfg(test)]
mod tests {
    use super::{delayed_refresh_data, skip_wake_refresh};
    use serde_json::json;

    #[test]
    fn wake_delays_configured_weather_and_non_auth_calendar_connections() {
        let weather = json!({"configured":true,"status":"syncing","nextRefreshAt":0,"failureCount":5,"observation":{"temperature":20}});
        let updated = delayed_refresh_data("weather", &weather, 100).unwrap();
        assert_eq!(updated["nextRefreshAt"], 30_100);
        assert_eq!(updated["status"], "stale");
        assert_eq!(updated["failureCount"], 0);
        assert_eq!(updated["observation"], weather["observation"]);
        assert!(delayed_refresh_data("weather", &json!({"configured":false}), 100).is_none());
        assert!(delayed_refresh_data("music", &weather, 100).is_none());
        let calendar = json!({"connections":[{"status":"offline","nextRefreshAt":i64::MAX},{"status":"auth-error","nextRefreshAt":i64::MAX}],"events":[{"id":"kept"}]});
        let updated = delayed_refresh_data("calendar", &calendar, 100).unwrap();
        assert_eq!(updated["connections"][0]["nextRefreshAt"], 30_100);
        assert_eq!(updated["connections"][1], calendar["connections"][1]);
        assert_eq!(updated["events"], calendar["events"]);
    }

    #[test]
    fn wake_skips_active_calendar_connections_but_not_refreshes() {
        assert!(skip_wake_refresh("calendar", true));
        assert!(!skip_wake_refresh("calendar", false));
        assert!(!skip_wake_refresh("weather", true));
    }
}

struct WakeRegistration(Mutex<Option<native::Observer>>);

pub fn install(app: &tauri::AppHandle) -> Result<(), String> {
    if app.try_state::<WakeRegistration>().is_some() {
        return Ok(());
    }
    let observer = native::install(app)?;
    if !app.manage(WakeRegistration(Mutex::new(Some(observer)))) {
        return Err("절전 복귀 관찰자가 이미 등록되어 있어요.".into());
    }
    Ok(())
}

pub fn shutdown(app: &tauri::AppHandle) {
    if let Some(registration) = app.try_state::<WakeRegistration>() {
        if let Ok(mut observer) = registration.0.lock() {
            observer.take();
        }
    }
}

#[cfg(target_os = "macos")]
mod native {
    use super::{receive_wake, set_screen_blocked};
    use block2::RcBlock;
    use objc2::{class, msg_send, rc::Retained, runtime::ProtocolObject};
    use objc2_app_kit::{
        NSWorkspace, NSWorkspaceDidWakeNotification, NSWorkspaceScreensDidSleepNotification,
        NSWorkspaceScreensDidWakeNotification,
    };
    use objc2_foundation::{NSNotification, NSNotificationCenter, NSObjectProtocol, NSString};
    use std::ptr::NonNull;

    type NotificationObserver = (
        Retained<NSNotificationCenter>,
        Retained<ProtocolObject<dyn NSObjectProtocol>>,
    );

    pub struct Observer {
        tokens: Vec<NotificationObserver>,
    }

    // The token is opaque and only passed back to the thread-safe notification center.
    // Registration is retained behind a Mutex, and removal also works during app teardown.
    unsafe impl Send for Observer {}

    impl Drop for Observer {
        fn drop(&mut self) {
            // This is the exact observer token returned by this center at registration.
            for (center, token) in &self.tokens {
                let token: &objc2::runtime::AnyObject = (**token).as_ref();
                unsafe {
                    center.removeObserver(token);
                }
            }
        }
    }

    pub fn install(app: &tauri::AppHandle) -> Result<Observer, String> {
        let center = NSWorkspace::sharedWorkspace().notificationCenter();
        let wake_app = app.clone();
        let callback = RcBlock::new(move |_: NonNull<NSNotification>| receive_wake(&wake_app));
        // The callback captures a Send+Sync AppHandle; no notification pointer escapes it.
        let token = unsafe {
            center.addObserverForName_object_queue_usingBlock(
                Some(NSWorkspaceDidWakeNotification),
                None,
                None,
                &callback,
            )
        };
        let mut tokens = vec![(center.clone(), token)];
        for (name, blocked) in unsafe {
            [
                (NSWorkspaceScreensDidSleepNotification, true),
                (NSWorkspaceScreensDidWakeNotification, false),
            ]
        } {
            let app = app.clone();
            let callback = RcBlock::new(move |_: NonNull<NSNotification>| {
                set_screen_blocked(&app, 1, blocked)
            });
            let token = unsafe {
                center.addObserverForName_object_queue_usingBlock(Some(name), None, None, &callback)
            };
            tokens.push((center.clone(), token));
        }
        let distributed: *mut NSNotificationCenter =
            unsafe { msg_send![class!(NSDistributedNotificationCenter), defaultCenter] };
        let distributed =
            unsafe { Retained::retain(distributed) }.ok_or("잠금 알림을 관찰하지 못했어요.")?;
        for (name, blocked) in [
            ("com.apple.screenIsLocked", true),
            ("com.apple.screenIsUnlocked", false),
        ] {
            let name = NSString::from_str(name);
            let app = app.clone();
            let callback = RcBlock::new(move |_: NonNull<NSNotification>| {
                set_screen_blocked(&app, 2, blocked)
            });
            let token = unsafe {
                distributed.addObserverForName_object_queue_usingBlock(
                    Some(&name),
                    None,
                    None,
                    &callback,
                )
            };
            tokens.push((distributed.clone(), token));
        }
        Ok(Observer { tokens })
    }
}

#[cfg(target_os = "windows")]
mod native {
    use super::receive_wake;
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };
    use windows_sys::Win32::{
        Foundation::{HWND, LPARAM, LRESULT, WPARAM},
        System::Threading::GetCurrentThreadId,
        UI::{
            Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
            WindowsAndMessaging::{
                GetWindowThreadProcessId, PostMessageW, RegisterWindowMessageW,
                PBT_APMRESUMEAUTOMATIC, WM_NCDESTROY, WM_POWERBROADCAST,
            },
        },
    };

    const SUBCLASS_ID: usize = 0x434F4D57;

    struct Context {
        app: tauri::AppHandle,
        active: Arc<AtomicBool>,
        release_message: u32,
    }

    pub struct Observer {
        hwnd: usize,
        context: usize,
        active: Arc<AtomicBool>,
        release_message: u32,
    }

    unsafe fn release(hwnd: HWND, pointer: usize) {
        // The context remains allocated while the subclass is installed; active guards both
        // shutdown and WM_NCDESTROY so they cannot release the same registration twice.
        let context = &*(pointer as *const Context);
        if context.active.swap(false, Ordering::SeqCst) {
            RemoveWindowSubclass(hwnd, Some(window_proc), SUBCLASS_ID);
            drop(Box::from_raw(pointer as *mut Context));
        }
    }

    unsafe extern "system" fn window_proc(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _id: usize,
        pointer: usize,
    ) -> LRESULT {
        let context = &*(pointer as *const Context);
        if message == WM_NCDESTROY {
            release(hwnd, pointer);
        } else if message == context.release_message && wparam == SUBCLASS_ID {
            release(hwnd, pointer);
            return 0;
        } else if message == WM_POWERBROADCAST && wparam == PBT_APMRESUMEAUTOMATIC as usize {
            receive_wake(&context.app);
        }
        DefSubclassProc(hwnd, message, wparam, lparam)
    }

    impl Drop for Observer {
        fn drop(&mut self) {
            if !self.active.load(Ordering::SeqCst) {
                return;
            }
            // Subclass mutation belongs to the window thread. Off-thread teardown posts a
            // private registered message, while WM_NCDESTROY remains the final cleanup path.
            unsafe {
                let hwnd = self.hwnd as HWND;
                if GetWindowThreadProcessId(hwnd, std::ptr::null_mut()) == GetCurrentThreadId() {
                    release(hwnd, self.context);
                } else {
                    PostMessageW(hwnd, self.release_message, SUBCLASS_ID, 0);
                }
            }
        }
    }

    pub fn install(app: &tauri::AppHandle) -> Result<Observer, String> {
        let window = crate::desktop::get_balloon(app)?;
        let hwnd = window.hwnd().map_err(|error| error.to_string())?.0 as HWND;
        let message_name: Vec<u16> = "Comet.DeviceWakeObserver.Release.v1\0"
            .encode_utf16()
            .collect();
        // The persistent balloon is created on the Tauri setup thread, which owns this HWND.
        unsafe {
            if GetWindowThreadProcessId(hwnd, std::ptr::null_mut()) != GetCurrentThreadId() {
                return Err("절전 복귀 관찰자는 창의 실행 스레드에서 설치해야 해요.".into());
            }
            let release_message = RegisterWindowMessageW(message_name.as_ptr());
            if release_message == 0 {
                return Err("절전 복귀 관찰자 메시지를 등록하지 못했어요.".into());
            }
            let active = Arc::new(AtomicBool::new(true));
            let pointer = Box::into_raw(Box::new(Context {
                app: app.clone(),
                active: active.clone(),
                release_message,
            })) as usize;
            if SetWindowSubclass(hwnd, Some(window_proc), SUBCLASS_ID, pointer) == 0 {
                drop(Box::from_raw(pointer as *mut Context));
                return Err("절전 복귀 관찰자를 설치하지 못했어요.".into());
            }
            Ok(Observer {
                hwnd: hwnd as usize,
                context: pointer,
                active,
                release_message,
            })
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod native {
    pub struct Observer;
    pub fn install(_: &tauri::AppHandle) -> Result<Observer, String> {
        Err("이 운영체제에서는 절전 복귀 관찰을 지원하지 않아요.".into())
    }
}
