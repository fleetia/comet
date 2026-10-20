use super::{Frame, Kind, SIZE};
use objc2::{
    class, msg_send,
    rc::Retained,
    runtime::{AnyClass, AnyObject, Bool, ClassBuilder, Sel},
    sel, MainThreadMarker,
};
use objc2_foundation::{NSPoint, NSRect, NSSize};
use std::{
    cell::RefCell,
    collections::BTreeMap,
    ffi::CString,
    sync::{Mutex, OnceLock},
};
use tauri::{AppHandle, Manager};

struct Panel {
    window: Retained<AnyObject>,
    view: Retained<AnyObject>,
    app: AppHandle,
    frame: Frame,
}
thread_local! { static PANELS: RefCell<BTreeMap<String, Panel>> = const { RefCell::new(BTreeMap::new()) }; }

#[derive(Default)]
pub(super) struct Updates {
    pending: Mutex<PendingUpdates>,
}

#[derive(Default)]
struct PendingUpdates {
    frames: BTreeMap<String, (f64, f64, Frame)>,
    scheduled: bool,
}

impl PendingUpdates {
    fn push(&mut self, id: String, x: f64, y: f64, frame: Frame) -> bool {
        self.frames.insert(id, (x, y, frame));
        !std::mem::replace(&mut self.scheduled, true)
    }

    fn take(&mut self) -> BTreeMap<String, (f64, f64, Frame)> {
        self.scheduled = false;
        std::mem::take(&mut self.frames)
    }
}

fn appearance_changed(previous: &Frame, current: &Frame) -> bool {
    previous.kind != current.kind
        || match current.kind {
            Kind::Ball | Kind::PaperPlane => previous.angle != current.angle,
            Kind::Bubbles => {
                previous.bubble_size != current.bubble_size
                    || previous.bubble_color != current.bubble_color
            }
            Kind::Pet => false,
        }
}

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

fn callbacks(view: &AnyObject, action: &str) -> bool {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let target = PANELS.with(|panels| {
            panels
                .borrow()
                .iter()
                .find(|(_, panel)| std::ptr::eq(&*panel.view, view))
                .map(|(id, panel)| (id.clone(), panel.app.clone(), panel.frame.kind))
        });
        let Some((id, app, kind)) = target else {
            return false;
        };
        let action = if action == "grab" && kind == Kind::Bubbles {
            "pop"
        } else {
            action
        };
        super::perform_action(&app, &id, action).is_ok()
    }))
    .unwrap_or(false)
}
unsafe extern "C-unwind" fn down(view: &AnyObject, _: Sel, _: *mut AnyObject) {
    callbacks(view, "grab");
}
unsafe extern "C-unwind" fn up(view: &AnyObject, _: Sel, _: *mut AnyObject) {
    callbacks(view, "release");
}
unsafe extern "C-unwind" fn right_down(view: &AnyObject, _: Sel, event: *mut AnyObject) {
    let pet = PANELS.with(|panels| {
        panels
            .borrow()
            .values()
            .any(|panel| std::ptr::eq(&*panel.view, view) && panel.frame.kind == Kind::Pet)
    });
    if !pet {
        callbacks(view, "dismiss");
        return;
    }
    // The pet keeps a care menu instead of disappearing on the first right click.
    let allocated: *mut AnyObject = msg_send![class!(NSMenu), alloc];
    let menu: *mut AnyObject = msg_send![allocated, init];
    let Some(menu) = Retained::from_raw(menu) else {
        return;
    };
    let empty: *mut AnyObject = msg_send![class!(NSString), string];
    for (title, action) in [
        (c"먹이 주기", Some(sel!(cometPetFeed:))),
        (c"쓰다듬기", Some(sel!(cometPetStroke:))),
        (c"", None),
        (c"집으로 보내기", Some(sel!(cometPetHome:))),
    ] {
        let Some(action) = action else {
            let separator: *mut AnyObject = msg_send![class!(NSMenuItem), separatorItem];
            let _: () = msg_send![&*menu, addItem: separator];
            continue;
        };
        let title: *mut AnyObject =
            msg_send![class!(NSString), stringWithUTF8String: title.as_ptr()];
        let allocated: *mut AnyObject = msg_send![class!(NSMenuItem), alloc];
        let item: *mut AnyObject =
            msg_send![allocated, initWithTitle: title, action: action, keyEquivalent: empty];
        let Some(item) = Retained::from_raw(item) else {
            continue;
        };
        let _: () = msg_send![&*item, setTarget: view];
        let _: () = msg_send![&*menu, addItem: &*item];
    }
    let _: () =
        msg_send![class!(NSMenu), popUpContextMenu: &*menu, withEvent: event, forView: view];
}
unsafe extern "C-unwind" fn pet_feed(view: &AnyObject, _: Sel, _: *mut AnyObject) {
    callbacks(view, "feed");
}
unsafe extern "C-unwind" fn pet_stroke(view: &AnyObject, _: Sel, _: *mut AnyObject) {
    callbacks(view, "stroke");
}
unsafe extern "C-unwind" fn pet_home(view: &AnyObject, _: Sel, _: *mut AnyObject) {
    callbacks(view, "dismiss");
}
unsafe extern "C-unwind" fn accessibility_press(view: &AnyObject, _: Sel) -> Bool {
    if callbacks(view, "pop") {
        Bool::YES
    } else {
        Bool::NO
    }
}
unsafe extern "C-unwind" fn dragged(_: &AnyObject, _: Sel, _: *mut AnyObject) {}

#[link(name = "AppKit", kind = "framework")]
unsafe extern "C" {
    fn NSRectFillUsingOperation(rect: NSRect, operation: usize);
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
type Rgba = (f64, f64, f64, f64);
type BubblePalette = (Rgba, Rgba);

fn bubble_palette(index: u8) -> BubblePalette {
    match index % 6 {
        0 => ((0.70, 0.87, 0.96, 0.48), (0.40, 0.66, 0.78, 0.9)),
        1 => ((0.82, 0.74, 0.97, 0.48), (0.55, 0.40, 0.76, 0.9)),
        2 => ((0.98, 0.70, 0.82, 0.48), (0.86, 0.36, 0.58, 0.9)),
        3 => ((1.00, 0.88, 0.55, 0.48), (0.84, 0.60, 0.18, 0.9)),
        4 => ((0.56, 0.90, 0.78, 0.48), (0.24, 0.62, 0.48, 0.9)),
        _ => ((1.00, 0.70, 0.55, 0.48), (0.82, 0.40, 0.24, 0.9)),
    }
}
fn rect(x: f64, y: f64, width: f64, height: f64) -> NSRect {
    NSRect::new(NSPoint::new(x, y), NSSize::new(width, height))
}
/// Draws Figma's 46×46 small pet centered in the toy view.
unsafe fn draw_pet() {
    let at = |x: f64, y: f64| NSPoint::new(x + 5.0, y + 5.0);
    let fur = (1.0, 0.824, 0.478, 1.0);
    color(fur.0, fur.1, fur.2, fur.3);
    for ear in [
        [(12.0, 18.0), (10.0, 7.0), (19.0, 14.0)],
        [(34.0, 18.0), (36.0, 7.0), (27.0, 14.0)],
    ] {
        let path: *mut AnyObject = msg_send![class!(NSBezierPath), bezierPath];
        let _: () = msg_send![path, moveToPoint: at(ear[0].0, ear[0].1)];
        for (x, y) in &ear[1..] {
            let _: () = msg_send![path, lineToPoint: at(*x, *y)];
        }
        let _: () = msg_send![path, closePath];
        let _: () = msg_send![path, fill];
    }
    oval(rect(12.0, 20.0, 32.0, 26.0), fur);
    oval(rect(19.0, 31.0, 18.0, 12.0), (1.0, 0.914, 0.722, 1.0));
    let ink = (0.102, 0.078, 0.2, 1.0);
    oval(rect(20.0, 28.0, 4.0, 4.0), ink);
    oval(rect(32.0, 28.0, 4.0, 4.0), ink);
    let mouth: *mut AnyObject = msg_send![class!(NSBezierPath), bezierPath];
    let _: () = msg_send![mouth, moveToPoint: at(21.0, 29.0)];
    let _: () = msg_send![mouth, curveToPoint: at(25.0, 29.0), controlPoint1: at(22.33, 30.33), controlPoint2: at(23.67, 30.33)];
    color(ink.0, ink.1, ink.2, ink.3);
    let _: () = msg_send![mouth, setLineWidth: 1.4_f64];
    let _: () = msg_send![mouth, setLineCapStyle: 1_usize];
    let _: () = msg_send![mouth, stroke];
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
                    let diameter = frame.bubble_size.clamp(18.0, 50.0);
                    let inset = (SIZE - diameter) / 2.0;
                    let bubble_rect = rect(inset, inset, diameter, diameter);
                    let (fill, stroke) = bubble_palette(frame.bubble_color);
                    oval(bubble_rect, fill);
                    let path: *mut AnyObject =
                        msg_send![class!(NSBezierPath),bezierPathWithOvalInRect:bubble_rect];
                    color(stroke.0, stroke.1, stroke.2, stroke.3);
                    let _: () = msg_send![path,setLineWidth:1.5_f64];
                    let _: () = msg_send![path, stroke];
                    let highlight = (diameter * 0.18).max(4.0);
                    oval(
                        rect(
                            inset + diameter * 0.2,
                            inset + diameter * 0.16,
                            highlight,
                            highlight,
                        ),
                        (1.0, 1.0, 1.0, 0.95),
                    );
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
                Kind::Pet => draw_pet(),
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
        class.add_method(
            sel!(cometPetFeed:),
            pet_feed as unsafe extern "C-unwind" fn(_, _, _),
        );
        class.add_method(
            sel!(cometPetStroke:),
            pet_stroke as unsafe extern "C-unwind" fn(_, _, _),
        );
        class.add_method(
            sel!(cometPetHome:),
            pet_home as unsafe extern "C-unwind" fn(_, _, _),
        );
        class.add_method(
            sel!(accessibilityPerformPress),
            accessibility_press as unsafe extern "C-unwind" fn(_, _) -> _,
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
    let help = CString::new(if frame.kind == Kind::Pet {
        "끌면 따라오고, 우클릭으로 먹이 주기·쓰다듬기·집으로 보내기."
    } else {
        "끌어서 던지기, 우클릭으로 정리. 비눗방울은 눌러 터뜨리기."
    })
    .expect("constant help");
    let help: *mut AnyObject = msg_send![class!(NSString),stringWithUTF8String:help.as_ptr()];
    let _: () = msg_send![&*view,setAccessibilityHelp:help];
    let id = frame.id.clone();
    PANELS.with(|panels| {
        panels.borrow_mut().insert(
            id.clone(),
            Panel {
                window: panel.clone(),
                view,
                app: app.clone(),
                frame,
            },
        )
    });
    // Clearing during creation invalidates this actor before the panel becomes visible.
    let world = crate::lock(&runtime.world)?;
    if !world.actors.contains_key(&id) {
        drop(world);
        PANELS.with(|panels| {
            panels.borrow_mut().remove(&id);
        });
        let _: () = msg_send![&*panel, close];
        return Ok(());
    }
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
        super::creation_result(&app_copy, &id, result);
    })
    .map_err(|error| error.to_string())
}

pub(super) fn visible_ids(app: &AppHandle) -> Result<std::collections::BTreeSet<String>, String> {
    let (send, receive) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let ids = PANELS.with(|panels| {
            panels
                .borrow()
                .iter()
                .filter_map(|(id, panel)| unsafe {
                    let visible: Bool = msg_send![&*panel.window, isVisible];
                    let minimized: Bool = msg_send![&*panel.window, isMiniaturized];
                    (visible.as_bool() && !minimized.as_bool()).then(|| id.clone())
                })
                .collect()
        });
        let _ = send.send(ids);
    })
    .map_err(|error| error.to_string())?;
    receive
        .recv_timeout(std::time::Duration::from_secs(2))
        .map_err(|error| error.to_string())
}

pub(super) fn update(app: &AppHandle, id: String, x: f64, y: f64, frame: Frame) {
    let runtime = app.state::<super::Runtime>();
    let schedule = runtime
        .native_updates
        .pending
        .lock()
        .map(|mut pending| pending.push(id, x, y, frame))
        .unwrap_or(false);
    if !schedule {
        return;
    }
    let app_copy = app.clone();
    if app
        .run_on_main_thread(move || apply_updates(&app_copy))
        .is_err()
    {
        if let Ok(mut pending) = runtime.native_updates.pending.lock() {
            *pending = PendingUpdates::default();
        }
    }
}

fn apply_updates(app: &AppHandle) {
    let runtime = app.state::<super::Runtime>();
    let frames = match runtime.native_updates.pending.lock() {
        Ok(mut pending) => pending.take(),
        Err(_) => return,
    };
    if frames.is_empty() {
        return;
    }
    let height = unsafe { screen_height() };
    for (id, (x, y, frame)) in frames {
        let target = PANELS.with(|panels| {
            let mut panels = panels.borrow_mut();
            panels.get_mut(&id).map(|panel| {
                let redraw = appearance_changed(&panel.frame, &frame);
                panel.frame = frame;
                (panel.window.clone(), panel.view.clone(), redraw)
            })
        });
        if let Some((panel, view, redraw)) = target {
            // AppKit may invoke drawRect or mouse callbacks while moving a panel.
            // Neither the pending queue nor PANELS may stay borrowed here.
            unsafe {
                let _: () = msg_send![&*panel,setFrameTopLeftPoint:NSPoint::new(x,height-y)];
                if redraw {
                    let _: () = msg_send![&*view,setNeedsDisplay:Bool::YES];
                }
            }
        }
    }
}
pub(super) fn close(app: &AppHandle, id: String) {
    let runtime = app.state::<super::Runtime>();
    if let Ok(mut pending) = runtime.native_updates.pending.lock() {
        pending.frames.remove(&id);
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(id: &str, kind: Kind) -> Frame {
        Frame {
            id: id.into(),
            kind,
            angle: 0.0,
            dragging: false,
            moving: true,
            external_windows_available: true,
            bubble_size: 38.0,
            bubble_color: 0,
        }
    }

    #[test]
    fn pending_frames_replace_stale_positions_and_preserve_other_actors() {
        let mut pending = PendingUpdates::default();
        let ball = frame("ball", Kind::Ball);
        let bubble = frame("bubble", Kind::Bubbles);
        assert!(pending.push(ball.id.clone(), 1.0, 2.0, ball.clone()));
        assert!(!pending.push(bubble.id.clone(), 3.0, 4.0, bubble.clone()));
        let latest_ball = Frame {
            angle: 45.0,
            ..ball
        };
        assert!(!pending.push(latest_ball.id.clone(), 5.0, 6.0, latest_ball.clone()));

        let frames = pending.take();
        assert_eq!(frames.len(), 2);
        assert_eq!(frames["ball"], (5.0, 6.0, latest_ball));
        assert_eq!(frames["bubble"], (3.0, 4.0, bubble));
    }

    #[test]
    fn updates_arriving_after_drain_schedule_one_new_callback() {
        let mut pending = PendingUpdates::default();
        let ball = frame("ball", Kind::Ball);
        assert!(pending.push(ball.id.clone(), 1.0, 2.0, ball.clone()));
        let drawing = pending.take();
        assert!(pending.push(ball.id.clone(), 3.0, 4.0, ball.clone()));
        assert!(!pending.push(ball.id.clone(), 5.0, 6.0, ball.clone()));

        assert_eq!(drawing["ball"], (1.0, 2.0, ball.clone()));
        assert_eq!(pending.take()["ball"], (5.0, 6.0, ball));
        assert!(pending.take().is_empty());
    }

    #[test]
    fn redraw_depends_on_visible_shape_not_movement_status() {
        for kind in [Kind::Ball, Kind::PaperPlane, Kind::Bubbles, Kind::Pet] {
            let previous = frame("toy", kind);
            let mut current = Frame {
                dragging: true,
                moving: false,
                external_windows_available: false,
                ..previous.clone()
            };
            assert!(!appearance_changed(&previous, &current));
            current.angle = 90.0;
            assert_eq!(
                appearance_changed(&previous, &current),
                matches!(kind, Kind::Ball | Kind::PaperPlane)
            );
        }
        let bubble = frame("bubble", Kind::Bubbles);
        assert!(appearance_changed(
            &bubble,
            &Frame {
                bubble_color: 1,
                ..bubble.clone()
            }
        ));
        assert!(appearance_changed(
            &bubble,
            &Frame {
                bubble_size: 28.0,
                ..bubble.clone()
            }
        ));
    }
}
