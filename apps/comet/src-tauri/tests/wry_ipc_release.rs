#![cfg(target_os = "linux")]

use gtk::prelude::*;
use std::{
    cell::{Cell, RefCell},
    rc::Rc,
    thread,
    time::{Duration, Instant},
};
use wry::{WebContext, WebViewBuilder, WebViewBuilderExtUnix, WebViewExtUnix};

struct FinalizationProbe(Rc<Cell<bool>>);

impl Drop for FinalizationProbe {
    fn drop(&mut self) {
        self.0.set(true);
    }
}

fn pump_until(timeout: Duration, condition: impl Fn() -> bool) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if condition() {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        // Bound each batch so continuously queued GTK events cannot hide a timeout.
        for _ in 0..64 {
            if !gtk::events_pending() {
                break;
            }
            gtk::main_iteration_do(false);
        }
        thread::sleep(Duration::from_millis(5));
    }
}

#[test]
#[ignore = "requires a Linux GTK/WebKit display; run separately under xvfb-run"]
fn linux_wry_ipc_webview_finalizes_after_repeated_close() {
    gtk::init().expect("GTK requires an X11 test display");
    let data = tempfile::tempdir().expect("create isolated WebKit test data");
    // Tauri keeps the Linux WebContext alive across windows. Dropping it per cycle
    // would test a different lifecycle and could conceal per-view retention.
    let mut context = WebContext::new(Some(data.path().to_path_buf()));

    for cycle in 0..5 {
        let window = gtk::Window::new(gtk::WindowType::Toplevel);
        window.set_default_size(160, 100);
        let received = Rc::new(RefCell::new(None));
        let callback_received = Rc::clone(&received);
        let marker = format!("cycle-{cycle}");
        let webview = WebViewBuilder::new_with_web_context(&mut context)
            .with_html(format!(
                "<!doctype html><script>window.ipc.postMessage('{marker}')</script>"
            ))
            .with_ipc_handler(move |request| {
                *callback_received.borrow_mut() =
                    Some((request.body().clone(), request.uri().to_string()));
            })
            .build_gtk(&window)
            .expect("build GTK webview");
        let native = webview.webview();
        let weak = native.downgrade();
        let finalized = Rc::new(Cell::new(false));
        // SAFETY: this test owns the typed value under a unique, private key and
        // never retrieves, replaces, or steals it. GObject finalize clears qdata;
        // dispose only clears reserved signal/weak-reference keys. A weak reference
        // alone is insufficient because GTK destruction clears it before finalize.
        unsafe {
            native.set_data(
                "comet-test-wry-ipc-finalization-probe",
                FinalizationProbe(Rc::clone(&finalized)),
            );
        }
        window.show_all();
        assert!(
            pump_until(Duration::from_secs(15), || received.borrow().is_some()),
            "cycle {cycle}: live JavaScript IPC did not reach the Rust handler"
        );
        {
            let received = received.borrow();
            let (body, uri) = received.as_ref().unwrap();
            assert_eq!(body, &marker, "cycle {cycle}: IPC payload changed");
            assert!(!uri.is_empty(), "cycle {cycle}: IPC URI was lost");
        }

        // SAFETY: all GTK operations stay on this test thread; no code uses the
        // window after destruction. Wry and our native clone are dropped below.
        unsafe { window.destroy() };
        drop(webview);
        drop(window);

        // Positive retention control: a deliberately held native reference must
        // prevent the finalization probe from firing, even after widget disposal.
        assert!(
            !pump_until(Duration::from_millis(50), || finalized.get()),
            "cycle {cycle}: probe fired during dispose rather than finalization"
        );
        drop(native);
        assert!(
            pump_until(Duration::from_secs(5), || finalized.get()),
            "cycle {cycle}: closed WebView retained; check IPC handler ownership"
        );
        assert!(
            weak.upgrade().is_none(),
            "cycle {cycle}: finalized WebView still has a live weak reference"
        );
    }
}
