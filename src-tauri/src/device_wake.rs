use crate::{
    lock,
    widget_commands::publish_widgets,
    widgets::{storage, EventDraft},
    AppState,
};
use rusqlite::Connection;
use serde_json::json;
use std::sync::{atomic::Ordering, Arc, Mutex};
use tauri::Manager;

fn record_wake(db: &Connection, stopping: bool, now: i64) -> Result<bool, String> {
    if stopping {
        return Ok(false);
    }
    let Some(instance) = storage::instances(db)?.into_iter().find(|entry| {
        entry.kind == "device"
            && entry.installed
            && entry.enabled
            && entry.data["configured"] == true
    }) else {
        return Ok(false);
    };
    if instance.data["lastWakeAt"].as_i64() == Some(now) {
        return Ok(false);
    }
    let mut data = instance.data;
    data["lastWakeAt"] = json!(now);
    storage::commit_data(
        db,
        &instance.id,
        instance.revision,
        data,
        vec![EventDraft {
            kind: "device-woke".into(),
            text: "기기가 절전에서 돌아왔어요.".into(),
            payload: json!({"observedAt":now}),
        }],
        now,
    )?;
    Ok(true)
}

fn receive_wake(app: &tauri::AppHandle) {
    // Native callbacks must never unwind through Objective-C or the window procedure.
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| -> Result<(), String> {
        let Some(state) = app.try_state::<Arc<AppState>>() else {
            return Ok(());
        };
        let _action = lock(&state.action)?;
        let changed = {
            let db = lock(&state.db)?;
            record_wake(
                &db,
                state.stopping.load(Ordering::SeqCst),
                chrono::Utc::now().timestamp_millis(),
            )?
        };
        if changed {
            publish_widgets(app, &state);
        }
        Ok(())
    }));
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
    use super::receive_wake;
    use block2::RcBlock;
    use objc2::{rc::Retained, runtime::ProtocolObject};
    use objc2_app_kit::{NSWorkspace, NSWorkspaceDidWakeNotification};
    use objc2_foundation::{NSNotification, NSNotificationCenter, NSObjectProtocol};
    use std::ptr::NonNull;

    pub struct Observer {
        center: Retained<NSNotificationCenter>,
        token: Retained<ProtocolObject<dyn NSObjectProtocol>>,
    }

    // The token is opaque and only passed back to the thread-safe notification center.
    // Registration is retained behind a Mutex, and removal also works during app teardown.
    unsafe impl Send for Observer {}

    impl Drop for Observer {
        fn drop(&mut self) {
            // This is the exact observer token returned by this center at registration.
            let token: &objc2::runtime::AnyObject = (*self.token).as_ref();
            unsafe {
                self.center.removeObserver(token);
            }
        }
    }

    pub fn install(app: &tauri::AppHandle) -> Result<Observer, String> {
        let app = app.clone();
        let center = NSWorkspace::sharedWorkspace().notificationCenter();
        let callback = RcBlock::new(move |_: NonNull<NSNotification>| receive_wake(&app));
        // The callback captures a Send+Sync AppHandle; no notification pointer escapes it.
        let token = unsafe {
            center.addObserverForName_object_queue_usingBlock(
                Some(NSWorkspaceDidWakeNotification),
                None,
                None,
                &callback,
            )
        };
        Ok(Observer { center, token })
    }
}

#[cfg(target_os = "windows")]
mod native {
    use super::receive_wake;
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };
    use tauri::Manager;
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
        let window = app
            .get_webview_window("a")
            .ok_or("캐릭터 창을 찾지 못했어요.")?;
        let hwnd = window.hwnd().map_err(|error| error.to_string())?.0 as HWND;
        let message_name: Vec<u16> = "Comet.DeviceWakeObserver.Release.v1\0"
            .encode_utf16()
            .collect();
        // install runs after create_boxes on the Tauri setup thread, which owns this HWND.
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::widgets::connections;

    #[test]
    fn wake_is_only_recorded_for_an_explicitly_enabled_device_connection() {
        let db = Connection::open_in_memory().unwrap();
        storage::initialize(&db).unwrap();
        let directory = tempfile::tempdir().unwrap();
        assert!(!record_wake(&db, false, 100).unwrap());
        storage::install(&db, directory.path(), &["device".into(), "journal".into()]).unwrap();
        assert!(!record_wake(&db, false, 200).unwrap());
        let instance = storage::instances(&db)
            .unwrap()
            .into_iter()
            .find(|entry| entry.kind == "device")
            .unwrap();
        let data = connections::configure("device", &instance.data, &json!({})).unwrap();
        storage::commit_data(&db, &instance.id, instance.revision, data, vec![], 250).unwrap();
        assert!(!record_wake(&db, true, 300).unwrap());
        assert!(record_wake(&db, false, 300).unwrap());
        assert!(!record_wake(&db, false, 300).unwrap());
        assert_eq!(storage::journal(&db, None).unwrap().len(), 1);
        assert_eq!(
            storage::get(&db, &instance.id).unwrap().data["lastWakeAt"],
            300
        );
        storage::set_enabled(&db, &instance.id, false).unwrap();
        assert!(!record_wake(&db, false, 400).unwrap());
        storage::set_enabled(&db, &instance.id, true).unwrap();
        assert_eq!(storage::journal(&db, None).unwrap().len(), 1);
        assert!(storage::take_reaction(&db, 401).unwrap().is_none());
        assert!(record_wake(&db, false, 500).unwrap());
        let event = storage::take_reaction(&db, 501).unwrap().unwrap();
        assert_eq!(event.event.kind, "device-woke");
        assert_eq!(event.event.payload["observedAt"], 500);
        storage::remove(&db, directory.path(), &instance.id, false).unwrap();
        assert!(!record_wake(&db, false, 600).unwrap());
    }
}
