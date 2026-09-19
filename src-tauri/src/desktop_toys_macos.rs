use super::{Frame, Kind, SIZE};
use objc2::{
    class, msg_send,
    rc::Retained,
    runtime::{AnyClass, AnyObject, Bool, ClassBuilder, Sel},
    sel, MainThreadMarker,
};
use objc2_foundation::{NSPoint, NSRect, NSSize};
use std::{cell::RefCell, collections::BTreeMap, ffi::CString, sync::OnceLock};
use tauri::{AppHandle, Manager};

struct Panel {
    window: Retained<AnyObject>,
    view: Retained<AnyObject>,
    app: AppHandle,
    frame: Frame,
}
thread_local! { static PANELS: RefCell<BTreeMap<String, Panel>> = const { RefCell::new(BTreeMap::new()) }; }

fn on_main(app: &AppHandle, action: impl FnOnce() + Send + 'static) -> Result<(), String> {
    if MainThreadMarker::new().is_some() {
        action();
        Ok(())
    } else {
        app.run_on_main_thread(action)
            .map_err(|error| error.to_string())
    }
}
unsafe extern "C-unwind" fn no(_: &AnyObject, _: Sel) -> Bool {
    Bool::NO
}
unsafe extern "C-unwind" fn yes(_: &AnyObject, _: Sel) -> Bool {
    Bool::YES
}
unsafe extern "C-unwind" fn first_mouse(_: &AnyObject, _: Sel, _: *mut AnyObject) -> Bool {
    Bool::YES
}

fn callbacks(view: &AnyObject, action: &str) {
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let target = PANELS.with(|panels| {
            panels
                .borrow()
                .iter()
                .find(|(_, panel)| std::ptr::eq(&*panel.view, view))
                .map(|(id, panel)| (id.clone(), panel.app.clone(), panel.frame.kind))
        });
        if let Some((id, app, kind)) = target {
            let action = if action == "grab" && kind == Kind::Bubbles {
                "pop"
            } else {
                action
            };
            let _ = super::perform_action(&app, &id, action);
        }
    }));
}
unsafe extern "C-unwind" fn down(view: &AnyObject, _: Sel, _: *mut AnyObject) {
    callbacks(view, "grab");
}
unsafe extern "C-unwind" fn up(view: &AnyObject, _: Sel, _: *mut AnyObject) {
    callbacks(view, "release");
}
unsafe extern "C-unwind" fn right_down(view: &AnyObject, _: Sel, _: *mut AnyObject) {
    callbacks(view, "dismiss");
}
unsafe extern "C-unwind" fn dragged(_: &AnyObject, _: Sel, _: *mut AnyObject) {}

#[link(name = "AppKit", kind = "framework")]
unsafe extern "C" {
    fn NSRectFillUsingOperation(rect: NSRect, operation: usize);
    static NSFontAttributeName: *const AnyObject;
}
unsafe fn color(red: f64, green: f64, blue: f64, alpha: f64) {
    let value: *mut AnyObject =
        msg_send![class!(NSColor), colorWithSRGBRed:red, green:green, blue:blue, alpha:alpha];
    let _: () = msg_send![value, set];
}
unsafe fn oval(rect: NSRect, fill: (f64, f64, f64, f64)) {
    color(fill.0, fill.1, fill.2, fill.3);
    let path: *mut AnyObject = msg_send![class!(NSBezierPath),bezierPathWithOvalInRect:rect];
    let _: () = msg_send![path, fill];
}
fn rect(x: f64, y: f64, width: f64, height: f64) -> NSRect {
    NSRect::new(NSPoint::new(x, y), NSSize::new(width, height))
}
unsafe extern "C-unwind" fn draw(view: &AnyObject, _: Sel, _: NSRect) {
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let frame = PANELS.with(|panels| {
            panels
                .borrow()
                .values()
                .find(|panel| std::ptr::eq(&*panel.view, view))
                .map(|panel| panel.frame.clone())
        });
        unsafe {
            let clear: *mut AnyObject = msg_send![class!(NSColor), clearColor];
            let _: () = msg_send![clear, set];
            NSRectFillUsingOperation(rect(0.0, 0.0, SIZE, SIZE), 1);
            let Some(frame) = frame else {
                return;
            };
            match frame.kind {
                Kind::Ball => {
                    oval(rect(9.0, 9.0, 38.0, 38.0), (0.91, 0.64, 0.32, 1.0));
                    let angle = frame.angle.to_radians();
                    oval(
                        rect(
                            23.0 + 10.0 * angle.cos(),
                            23.0 + 10.0 * angle.sin(),
                            8.0,
                            8.0,
                        ),
                        (0.98, 0.86, 0.59, 1.0),
                    );
                }
                Kind::Bubbles => {
                    oval(rect(9.0, 9.0, 38.0, 38.0), (0.70, 0.87, 0.96, 0.48));
                    let path: *mut AnyObject = msg_send![class!(NSBezierPath),bezierPathWithOvalInRect:rect(9.0,9.0,38.0,38.0)];
                    color(0.40, 0.66, 0.78, 0.9);
                    let _: () = msg_send![path,setLineWidth:1.5_f64];
                    let _: () = msg_send![path, stroke];
                    oval(rect(16.0, 15.0, 7.0, 7.0), (1.0, 1.0, 1.0, 0.95));
                }
                Kind::PaperPlane => {
                    let angle = frame.angle.to_radians();
                    let point = |x: f64, y: f64| {
                        NSPoint::new(
                            28.0 + x * angle.cos() - y * angle.sin(),
                            28.0 + x * angle.sin() + y * angle.cos(),
                        )
                    };
                    let path: *mut AnyObject = msg_send![class!(NSBezierPath), bezierPath];
                    let _: () = msg_send![path,moveToPoint:point(-19.0,-16.0)];
                    for (x, y) in [(21.0, 0.0), (-19.0, 16.0), (-11.0, 0.0)] {
                        let _: () = msg_send![path,lineToPoint:point(x,y)];
                    }
                    let _: () = msg_send![path, closePath];
                    color(1.0, 0.98, 0.94, 1.0);
                    let _: () = msg_send![path, fill];
                    color(0.29, 0.39, 0.45, 1.0);
                    let _: () = msg_send![path,setLineWidth:1.5_f64];
                    let _: () = msg_send![path, stroke];
                }
                Kind::Pet => {
                    let text = CString::new("🐌").expect("constant glyph");
                    let text: *mut AnyObject =
                        msg_send![class!(NSString),stringWithUTF8String:text.as_ptr()];
                    let font: *mut AnyObject = msg_send![class!(NSFont),systemFontOfSize:34.0_f64];
                    let attributes: *mut AnyObject = msg_send![class!(NSDictionary),dictionaryWithObject:font, forKey:NSFontAttributeName];
                    let _: () = msg_send![text,drawAtPoint:NSPoint::new(9.0,7.0), withAttributes:attributes];
                }
            }
        }
    }));
}
fn panel_class() -> &'static AnyClass {
    static CLASS: OnceLock<&'static AnyClass> = OnceLock::new();
    CLASS.get_or_init(|| unsafe {
        let name = CString::new("CometToyNonactivatingPanel").expect("constant class");
        let mut class = ClassBuilder::new(&name, class!(NSPanel)).expect("unique class");
        class.add_method(
            sel!(canBecomeKeyWindow),
            no as unsafe extern "C-unwind" fn(_, _) -> _,
        );
        class.add_method(
            sel!(canBecomeMainWindow),
            no as unsafe extern "C-unwind" fn(_, _) -> _,
        );
        class.register()
    })
}
fn view_class() -> &'static AnyClass {
    static CLASS: OnceLock<&'static AnyClass> = OnceLock::new();
    CLASS.get_or_init(|| unsafe {
        let name = CString::new("CometToyPaintView").expect("constant class");
        let mut class = ClassBuilder::new(&name, class!(NSView)).expect("unique class");
        class.add_method(sel!(isOpaque), no as unsafe extern "C-unwind" fn(_, _) -> _);
        class.add_method(
            sel!(isFlipped),
            yes as unsafe extern "C-unwind" fn(_, _) -> _,
        );
        class.add_method(
            sel!(acceptsFirstMouse:),
            first_mouse as unsafe extern "C-unwind" fn(_, _, _) -> _,
        );
        class.add_method(
            sel!(drawRect:),
            draw as unsafe extern "C-unwind" fn(_, _, _),
        );
        class.add_method(
            sel!(mouseDown:),
            down as unsafe extern "C-unwind" fn(_, _, _),
        );
        class.add_method(sel!(mouseUp:), up as unsafe extern "C-unwind" fn(_, _, _));
        class.add_method(
            sel!(mouseDragged:),
            dragged as unsafe extern "C-unwind" fn(_, _, _),
        );
        class.add_method(
            sel!(rightMouseDown:),
            right_down as unsafe extern "C-unwind" fn(_, _, _),
        );
        class.register()
    })
}
unsafe fn screen_height() -> f64 {
    let screens: *mut AnyObject = msg_send![class!(NSScreen), screens];
    let count: usize = msg_send![screens, count];
    if count == 0 {
        return 0.0;
    }
    let primary: *mut AnyObject = msg_send![screens,objectAtIndex:0_usize];
    let bounds: NSRect = msg_send![primary, frame];
    bounds.size.height
}
unsafe fn create_panel(app: AppHandle, frame: Frame, x: f64, y: f64) -> Result<(), String> {
    let runtime = app.state::<super::Runtime>();
    if !crate::lock(&runtime.world)?.actors.contains_key(&frame.id) {
        return Err("이미 정리한 장난감이에요.".into());
    }
    let allocated: *mut AnyObject = msg_send![panel_class(), alloc];
    let panel: *mut AnyObject = msg_send![allocated,initWithContentRect:rect(x,screen_height()-y-SIZE,SIZE,SIZE), styleMask:128_usize, backing:2_usize, defer:Bool::NO];
    let panel = Retained::from_raw(panel).ok_or("장난감 창을 만들지 못했어요.")?;
    let allocated: *mut AnyObject = msg_send![view_class(), alloc];
    let view: *mut AnyObject = msg_send![allocated,initWithFrame:rect(0.0,0.0,SIZE,SIZE)];
    let view = Retained::from_raw(view).ok_or("장난감 화면을 만들지 못했어요.")?;
    let clear: *mut AnyObject = msg_send![class!(NSColor), clearColor];
    let _: () = msg_send![&*panel,setOpaque:Bool::NO];
    let _: () = msg_send![&*panel,setBackgroundColor:clear];
    let _: () = msg_send![&*panel,setHasShadow:Bool::NO];
    let _: () = msg_send![&*panel,setReleasedWhenClosed:Bool::NO];
    let _: () = msg_send![&*panel,setHidesOnDeactivate:Bool::NO];
    let _: () = msg_send![&*panel,setFloatingPanel:Bool::YES];
    let _: () = msg_send![&*panel,setBecomesKeyOnlyIfNeeded:Bool::YES];
    let _: () = msg_send![&*panel,setLevel:3_isize];
    let _: () = msg_send![&*panel,setContentView:&*view];
    let name = match frame.kind {
        Kind::Ball => "Comet 공",
        Kind::PaperPlane => "Comet 종이비행기",
        Kind::Bubbles => "Comet 비눗방울",
        Kind::Pet => "Comet 작은 펫",
    };
    let name = CString::new(name).expect("constant title");
    let title: *mut AnyObject = msg_send![class!(NSString),stringWithUTF8String:name.as_ptr()];
    let _: () = msg_send![&*panel,setTitle:title];
    let _: () = msg_send![&*view,setAccessibilityElement:Bool::YES];
    let _: () = msg_send![&*view,setAccessibilityLabel:title];
    let role: *mut AnyObject =
        msg_send![class!(NSString),stringWithUTF8String:c"AXButton".as_ptr()];
    let _: () = msg_send![&*view,setAccessibilityRole:role];
    let help = CString::new("끌어서 던지기, 우클릭으로 정리. 비눗방울은 눌러 터뜨리기.")
        .expect("constant help");
    let help: *mut AnyObject = msg_send![class!(NSString),stringWithUTF8String:help.as_ptr()];
    let _: () = msg_send![&*view,setAccessibilityHelp:help];
    let id = frame.id.clone();
    PANELS.with(|panels| {
        panels.borrow_mut().insert(
            id,
            Panel {
                window: panel.clone(),
                view,
                app,
                frame,
            },
        )
    });
    // Leave ignoresMouseEvents untouched: Cocoa uses drawn alpha as the shape.
    let _: () = msg_send![&*panel,orderFront:std::ptr::null::<AnyObject>()];
    Ok(())
}
pub(super) fn create(app: &AppHandle, frame: Frame, x: f64, y: f64) -> Result<(), String> {
    let app_copy = app.clone();
    // Always enqueue: open may be called while the widget action/DB gates are held.
    app.run_on_main_thread(move || {
        let id = frame.id.clone();
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| unsafe {
            create_panel(app_copy.clone(), frame, x, y)
        }))
        .unwrap_or_else(|_| Err("장난감 창을 준비하지 못했어요.".into()));
        if let Err(error) = result {
            super::remove_actor(&app_copy, &id);
            eprintln!("desktop toy panel creation failed: {error}");
        }
    })
    .map_err(|error| error.to_string())
}

pub(super) fn update(app: &AppHandle, id: String, x: f64, y: f64, frame: Frame) {
    let _ = on_main(app, move || {
        let target = PANELS.with(|panels| {
            let mut panels = panels.borrow_mut();
            panels.get_mut(&id).map(|panel| {
                panel.frame = frame;
                (panel.window.clone(), panel.view.clone())
            })
        });
        if let Some((panel, view)) = target {
            unsafe {
                let _: () =
                    msg_send![&*panel,setFrameTopLeftPoint:NSPoint::new(x,screen_height()-y)];
                let _: () = msg_send![&*view,setNeedsDisplay:Bool::YES];
            }
        }
    });
}
pub(super) fn close(app: &AppHandle, id: String) {
    let _ = on_main(app, move || {
        let panel = PANELS.with(|panels| panels.borrow_mut().remove(&id));
        if let Some(panel) = panel {
            unsafe {
                let _: () = msg_send![&*panel.window,orderOut:std::ptr::null::<AnyObject>()];
                let _: () = msg_send![&*panel.window, close];
            }
        }
    });
}
