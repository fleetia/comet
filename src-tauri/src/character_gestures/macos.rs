use super::{is_current, notify, Phase, Session};
use block2::RcBlock;
use objc2::{
    class, msg_send,
    rc::Retained,
    runtime::{AnyObject, ProtocolObject},
};
use objc2_foundation::{
    NSNotification, NSNotificationCenter, NSObjectProtocol, NSRunLoop, NSRunLoopCommonModes,
    NSString, NSTimer,
};
use std::{
    cell::RefCell,
    ptr::NonNull,
    time::{Duration, Instant},
};
use tauri::WebviewWindow;

// AppKit hands the drag to Window Server and returns immediately. Keep the native
// observers alive until a button release or cancellation, independent of that return.
struct Watch {
    window: WebviewWindow,
    session: Session,
    requested_at: Instant,
    started: bool,
    observer: Retained<ProtocolObject<dyn NSObjectProtocol>>,
    monitor: Retained<AnyObject>,
    timer: Retained<NSTimer>,
    _native: Retained<AnyObject>,
}
impl Drop for Watch {
    fn drop(&mut self) {
        unsafe {
            self.timer.invalidate();
            NSNotificationCenter::defaultCenter().removeObserver((*self.observer).as_ref());
            let _: () = msg_send![class!(NSEvent), removeMonitor:&*self.monitor];
        }
    }
}
thread_local! {
    static WATCH: RefCell<Option<Watch>> = const { RefCell::new(None) };
}

fn trace(session: &Session, message: &str) {
    if std::env::var_os("COMET_GESTURE_TRACE").is_some() {
        eprintln!(
            "gesture {} {} {} {message}",
            session.window_label, session.session_id, session.generation
        );
    }
}

fn matches(watch: &Watch, session: &Session) -> bool {
    watch.session.generation == session.generation && watch.session.session_id == session.session_id
}

fn finish(session: &Session, phase: Phase, reason: &str) {
    let watch = WATCH.with(|slot| {
        let mut slot = slot.borrow_mut();
        if slot.as_ref().is_some_and(|watch| matches(watch, session)) {
            slot.take()
        } else {
            None
        }
    });
    let Some(watch) = watch else {
        return;
    };
    trace(session, reason);
    let window = watch.window.clone();
    drop(watch);
    notify(&window, session, phase);
}

fn started(session: &Session) {
    let window = WATCH.with(|slot| {
        let mut slot = slot.borrow_mut();
        let watch = slot.as_mut().filter(|watch| matches(watch, session))?;
        if watch.started || !is_current(&watch.window, session) {
            return None;
        }
        watch.started = true;
        Some(watch.window.clone())
    });
    if let Some(window) = window {
        trace(session, "native-will-move");
        notify(&window, session, Phase::Started);
    }
}

fn poll(session: &Session) {
    let state = WATCH.with(|slot| {
        slot.borrow()
            .as_ref()
            .filter(|watch| matches(watch, session))
            .map(|watch| {
                (
                    watch.window.clone(),
                    watch.started,
                    watch.requested_at.elapsed(),
                )
            })
    });
    let Some((window, started, elapsed)) = state else {
        return;
    };
    if !is_current(&window, session) {
        finish(session, Phase::Cancelled, "invalidated");
        return;
    }
    let buttons: usize = unsafe { msg_send![class!(NSEvent), pressedMouseButtons] };
    if let Some((phase, reason)) = terminal_phase(started, buttons & 1 != 0, elapsed) {
        finish(session, phase, reason);
    }
}

fn terminal_phase(
    started: bool,
    pressed: bool,
    elapsed: Duration,
) -> Option<(Phase, &'static str)> {
    if !pressed {
        Some(if started {
            (Phase::Ended, "native-button-released")
        } else {
            (Phase::Cancelled, "released-before-native-start")
        })
    } else if !started && elapsed >= Duration::from_secs(3) {
        Some((Phase::Cancelled, "native-start-timeout"))
    } else {
        None
    }
}

pub(super) fn double_click_ms() -> u64 {
    let seconds: f64 = unsafe { msg_send![class!(NSEvent), doubleClickInterval] };
    (seconds * 1000.0).ceil() as u64
}

pub(super) fn begin(window: &WebviewWindow, session: Session) -> Result<(), String> {
    let window = window.clone();
    let dispatch = window.clone();
    trace(&session, "requested");
    dispatch
        .run_on_main_thread(move || {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                drag(&window, &session);
            }));
            if result.is_err() {
                finish(&session, Phase::Cancelled, "native-panic");
                notify(&window, &session, Phase::Cancelled);
            }
        })
        .map_err(|error| error.to_string())
}

fn drag(window: &WebviewWindow, session: &Session) {
    if !is_current(window, session) {
        trace(session, "invalid-before-start");
        return;
    }
    unsafe {
        let buttons: usize = msg_send![class!(NSEvent), pressedMouseButtons];
        if buttons & 1 == 0 {
            trace(session, "released-before-request");
            notify(window, session, Phase::Cancelled);
            return;
        }
        let Some(native) = Retained::retain(session.native_handle as *mut AnyObject) else {
            notify(window, session, Phase::Cancelled);
            return;
        };
        let token = session.clone();
        let move_callback = RcBlock::new(move |_: NonNull<NSNotification>| started(&token));
        let observer = NSNotificationCenter::defaultCenter()
            .addObserverForName_object_queue_usingBlock(
                Some(&NSString::from_str("NSWindowWillMoveNotification")),
                Some(&native),
                None,
                &move_callback,
            );
        let token = session.clone();
        let event_callback = RcBlock::new(move |event: NonNull<AnyObject>| -> *mut AnyObject {
            let kind: usize = msg_send![event.as_ptr(), type];
            if kind == 10 {
                let code: u16 = msg_send![event.as_ptr(), keyCode];
                if code == 53 {
                    finish(&token, Phase::Cancelled, "native-escape");
                }
            }
            event.as_ptr()
        });
        let monitor: Option<Retained<AnyObject>> = msg_send![class!(NSEvent),
            addLocalMonitorForEventsMatchingMask:1usize << 10, handler:&*event_callback];
        let Some(monitor) = monitor else {
            NSNotificationCenter::defaultCenter().removeObserver((*observer).as_ref());
            notify(window, session, Phase::Cancelled);
            return;
        };
        let token = session.clone();
        let timer_callback = RcBlock::new(move |_: NonNull<NSTimer>| poll(&token));
        let timer = NSTimer::timerWithTimeInterval_repeats_block(0.016, true, &timer_callback);
        NSRunLoop::mainRunLoop().addTimer_forMode(&timer, NSRunLoopCommonModes);
        WATCH.with(|slot| {
            slot.replace(Some(Watch {
                window: window.clone(),
                session: session.clone(),
                requested_at: Instant::now(),
                started: false,
                observer,
                monitor,
                timer,
                _native: native,
            }))
        });
        // Preserve Tauri/Tao's existing event handling and system drag behavior.
        if let Err(error) = window.start_dragging() {
            trace(session, &format!("native-request-failed: {error}"));
            finish(session, Phase::Cancelled, "native-request-failed");
        } else {
            trace(session, "native-request-dispatched");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_start_and_actual_release_are_required_for_a_normal_end() {
        assert_eq!(terminal_phase(false, true, Duration::from_secs(1)), None);
        assert_eq!(terminal_phase(true, true, Duration::from_secs(600)), None);
        assert_eq!(
            terminal_phase(true, false, Duration::from_secs(1))
                .unwrap()
                .0,
            Phase::Ended
        );
        assert_eq!(
            terminal_phase(false, false, Duration::from_secs(1))
                .unwrap()
                .0,
            Phase::Cancelled
        );
        assert_eq!(
            terminal_phase(false, true, Duration::from_secs(3))
                .unwrap()
                .0,
            Phase::Cancelled
        );
    }
}
