use super::{Phase, Session};
use std::{cell::Cell, rc::Rc};
use tauri::WebviewWindow;
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, WPARAM},
    System::Threading::GetCurrentThreadId,
    UI::{
        Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
        WindowsAndMessaging::{
            CallNextHookEx, GetCursorPos, GetSystemMetrics, GetWindowThreadProcessId, PostMessageW,
            SendMessageW, SetWindowsHookExW, UnhookWindowsHookEx, HTCAPTION, MSG, PM_REMOVE,
            SC_MOVE, SM_SWAPBUTTON, WH_GETMESSAGE, WM_CANCELMODE, WM_CAPTURECHANGED,
            WM_ENTERSIZEMOVE, WM_EXITSIZEMOVE, WM_KEYDOWN, WM_LBUTTONUP, WM_NCDESTROY,
            WM_NCLBUTTONUP, WM_SHOWWINDOW, WM_SYSCOMMAND, WM_SYSKEYDOWN,
        },
    },
};

const SUBCLASS_ID: usize = 0x434F4D47;
const VK_LBUTTON: i32 = 0x01;
const VK_RBUTTON: i32 = 0x02;
const VK_ESCAPE: usize = 0x1B;

// These user32 functions otherwise require an additional windows-sys input feature.
#[link(name = "user32")]
extern "system" {
    fn GetDoubleClickTime() -> u32;
    fn GetAsyncKeyState(key: i32) -> i16;
    fn ReleaseCapture() -> i32;
}

struct Context {
    window: WebviewWindow,
    session: Session,
    started: Cell<bool>,
    finished: Cell<bool>,
    cancelled: Cell<bool>,
    released: Cell<bool>,
    subclass_installed: Cell<bool>,
}

thread_local! {
    static ACTIVE: Cell<*const Context> = const { Cell::new(std::ptr::null()) };
}

fn finish(context: &Context, phase: Phase) {
    if !context.finished.replace(true) {
        super::notify(&context.window, &context.session, phase);
    }
}

unsafe fn primary_button_down() -> bool {
    let key = if GetSystemMetrics(SM_SWAPBUTTON) == 0 {
        VK_LBUTTON
    } else {
        VK_RBUTTON
    };
    GetAsyncKeyState(key) < 0
}

unsafe extern "system" fn messages(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code == 0 && wparam == PM_REMOVE as usize && lparam != 0 {
        ACTIVE.with(|active| {
            let Some(context) = active.get().as_ref() else {
                return;
            };
            if !context.started.get() || context.finished.get() {
                return;
            }
            let message = &*(lparam as *const MSG);
            match message.message {
                WM_KEYDOWN | WM_SYSKEYDOWN if message.wParam == VK_ESCAPE => {
                    context.cancelled.set(true);
                }
                WM_LBUTTONUP | WM_NCLBUTTONUP => context.released.set(true),
                _ => {}
            }
        });
    }
    CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
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
    match message {
        WM_ENTERSIZEMOVE if !context.started.get() && !context.finished.get() => {
            if super::is_current(&context.window, &context.session) {
                context.started.set(true);
                super::notify(&context.window, &context.session, Phase::Started);
            } else {
                finish(context, Phase::Cancelled);
                PostMessageW(hwnd, WM_CANCELMODE, 0, 0);
            }
        }
        WM_EXITSIZEMOVE => {
            let released = context.released.get() || !primary_button_down();
            let phase = if context.started.get() && !context.cancelled.get() && released {
                Phase::Ended
            } else {
                Phase::Cancelled
            };
            finish(context, phase);
        }
        WM_CAPTURECHANGED if context.started.get() && lparam != hwnd as isize => {
            // Normal button release also relinquishes capture. Losing it to another
            // window, or losing it while the button is still held, is cancellation.
            if lparam != 0 || (!context.released.get() && primary_button_down()) {
                finish(context, Phase::Cancelled);
            }
        }
        WM_CANCELMODE => finish(context, Phase::Cancelled),
        WM_SHOWWINDOW if wparam == 0 => finish(context, Phase::Cancelled),
        WM_NCDESTROY => {
            finish(context, Phase::Cancelled);
            if context.subclass_installed.replace(false) {
                RemoveWindowSubclass(hwnd, Some(window_proc), SUBCLASS_ID);
                drop(Rc::from_raw(pointer as *const Context));
            }
        }
        _ => {}
    }
    DefSubclassProc(hwnd, message, wparam, lparam)
}

unsafe fn begin_on_window_thread(window: WebviewWindow, session: Session) {
    let hwnd = session.native_handle as HWND;
    if !super::is_current(&window, &session)
        || GetWindowThreadProcessId(hwnd, std::ptr::null_mut()) != GetCurrentThreadId()
        || !primary_button_down()
        || ACTIVE.with(|active| !active.get().is_null())
    {
        super::notify(&window, &session, Phase::Cancelled);
        return;
    }
    let mut cursor = std::mem::zeroed();
    if GetCursorPos(&mut cursor) == 0 {
        super::notify(&window, &session, Phase::Cancelled);
        return;
    }
    // Release WebView capture before installing our observer, so this preparatory
    // capture change cannot be mistaken for cancellation of the native move loop.
    ReleaseCapture();
    if !super::is_current(&window, &session) {
        super::notify(&window, &session, Phase::Cancelled);
        return;
    }
    let context = Rc::new(Context {
        window,
        session,
        started: Cell::new(false),
        finished: Cell::new(false),
        cancelled: Cell::new(false),
        released: Cell::new(false),
        subclass_installed: Cell::new(false),
    });
    let pointer = Rc::into_raw(Rc::clone(&context));
    if SetWindowSubclass(hwnd, Some(window_proc), SUBCLASS_ID, pointer as usize) == 0 {
        drop(Rc::from_raw(pointer));
        finish(&context, Phase::Cancelled);
        return;
    }
    context.subclass_installed.set(true);
    ACTIVE.with(|active| active.set(pointer));
    // The native sizing loop consumes Escape/button-up without necessarily
    // dispatching them to the window procedure. Observe only this UI thread.
    let hook = SetWindowsHookExW(
        WH_GETMESSAGE,
        Some(messages),
        std::ptr::null_mut(),
        GetCurrentThreadId(),
    );
    if !hook.is_null() {
        let position = ((cursor.y as u16 as u32) << 16) | cursor.x as u16 as u32;
        // This call owns the modal loop; Context stays alive through all nested
        // callbacks. Only WM_EXITSIZEMOVE can report a successful release.
        SendMessageW(
            hwnd,
            WM_SYSCOMMAND,
            (SC_MOVE | HTCAPTION) as usize,
            position as isize,
        );
        UnhookWindowsHookEx(hook);
    }
    ACTIVE.with(|active| active.set(std::ptr::null()));
    if context.subclass_installed.get()
        && RemoveWindowSubclass(hwnd, Some(window_proc), SUBCLASS_ID) != 0
    {
        context.subclass_installed.set(false);
        drop(Rc::from_raw(pointer));
    }
    finish(&context, Phase::Cancelled);
}

pub(super) fn double_click_ms() -> u64 {
    unsafe { u64::from(GetDoubleClickTime()) }
}

pub(super) fn begin(window: &WebviewWindow, session: Session) -> Result<(), String> {
    let target = window.clone();
    window
        .run_on_main_thread(move || unsafe { begin_on_window_thread(target, session) })
        .map_err(|error| error.to_string())
}
