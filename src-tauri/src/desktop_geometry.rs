use serde::Serialize;

#[derive(Clone, Copy, Debug, Serialize, PartialEq)]
pub(crate) struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Rect {
    pub fn contains(self, x: f64, y: f64) -> bool {
        x >= self.x && x <= self.x + self.width && y >= self.y && y <= self.y + self.height
    }
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct Edge {
    pub horizontal: bool,
    pub axis: f64,
    pub from: f64,
    pub to: f64,
}

#[derive(Clone, Debug, Default)]
pub(crate) struct Geometry {
    pub monitors: Vec<Rect>,
    pub edges: Vec<Edge>,
    pub characters: Vec<crate::character_collision::Collider>,
    pub external_windows_available: bool,
    pub fullscreen: bool,
}

fn edges(rect: Rect) -> [Edge; 4] {
    [
        Edge {
            horizontal: true,
            axis: rect.y,
            from: rect.x,
            to: rect.x + rect.width,
        },
        Edge {
            horizontal: true,
            axis: rect.y + rect.height,
            from: rect.x,
            to: rect.x + rect.width,
        },
        Edge {
            horizontal: false,
            axis: rect.x,
            from: rect.y,
            to: rect.y + rect.height,
        },
        Edge {
            horizontal: false,
            axis: rect.x + rect.width,
            from: rect.y,
            to: rect.y + rect.height,
        },
    ]
}

fn subtract(edge: Edge, cover: Rect) -> Vec<Edge> {
    let (axis_from, axis_to, from, to) = if edge.horizontal {
        (
            cover.y,
            cover.y + cover.height,
            cover.x,
            cover.x + cover.width,
        )
    } else {
        (
            cover.x,
            cover.x + cover.width,
            cover.y,
            cover.y + cover.height,
        )
    };
    if edge.axis < axis_from || edge.axis > axis_to || to <= edge.from || from >= edge.to {
        return vec![edge];
    }
    let mut result = Vec::with_capacity(2);
    if from > edge.from {
        result.push(Edge {
            to: from.min(edge.to),
            ..edge
        });
    }
    if to < edge.to {
        result.push(Edge {
            from: to.max(edge.from),
            ..edge
        });
    }
    result
}

pub(crate) fn visible_edges(front_to_back: &[Rect]) -> Vec<Edge> {
    front_to_back
        .iter()
        .enumerate()
        .flat_map(|(index, rect)| {
            front_to_back[..index]
                .iter()
                .fold(edges(*rect).to_vec(), |parts, cover| {
                    parts
                        .into_iter()
                        .flat_map(|part| subtract(part, *cover))
                        .collect()
                })
        })
        .collect()
}

pub(crate) fn monitor_edges(monitors: &[Rect]) -> Vec<Edge> {
    let monitors = monitors
        .iter()
        .fold(Vec::<Rect>::new(), |mut unique, area| {
            if !unique.contains(area) {
                unique.push(*area);
            }
            unique
        });
    monitors
        .iter()
        .enumerate()
        .flat_map(|(index, rect)| {
            monitors
                .iter()
                .enumerate()
                .filter(|(other, _)| *other != index)
                .fold(edges(*rect).to_vec(), |parts, (_, cover)| {
                    parts
                        .into_iter()
                        .flat_map(|part| subtract(part, *cover))
                        .collect()
                })
        })
        .collect()
}

pub(crate) fn capture() -> Result<Geometry, String> {
    let (monitors, windows) = platform::capture()?;
    let mut edge_list = monitor_edges(&monitors);
    edge_list.extend(visible_edges(&windows));
    let fullscreen = monitors.iter().any(|area| {
        windows
            .iter()
            .find(|w| {
                w.x < area.x + area.width
                    && w.x + w.width > area.x
                    && w.y < area.y + area.height
                    && w.y + w.height > area.y
            })
            .is_some_and(|w| {
                w.x <= area.x
                    && w.y <= area.y
                    && w.x + w.width >= area.x + area.width
                    && w.y + w.height >= area.y + area.height
            })
    });
    Ok(Geometry {
        monitors,
        edges: edge_list,
        characters: Vec::new(),
        external_windows_available: true,
        fullscreen,
    })
}

pub(crate) fn cursor_position() -> Option<(f64, f64)> {
    platform::cursor_position()
}

// macOS coordinates remain Quartz points; Windows coordinates remain physical pixels.
// Conversion to a Tauri window position is intentionally kept in the actor adapter.
#[cfg(target_os = "macos")]
mod platform {
    use super::Rect;
    use std::ffi::{c_char, c_void, CString};
    type Cf = *const c_void;
    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct Point {
        x: f64,
        y: f64,
    }
    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct Size {
        width: f64,
        height: f64,
    }
    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct CgRect {
        origin: Point,
        size: Size,
    }
    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGWindowListCopyWindowInfo(option: u32, relative: u32) -> Cf;
        fn CGRectMakeWithDictionaryRepresentation(dictionary: Cf, rect: *mut CgRect) -> bool;
        fn CGGetActiveDisplayList(max: u32, displays: *mut u32, count: *mut u32) -> i32;
        fn CGDisplayBounds(display: u32) -> CgRect;
        fn CGEventCreate(source: Cf) -> Cf;
        fn CGEventGetLocation(event: Cf) -> Point;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFArrayGetCount(array: Cf) -> isize;
        fn CFArrayGetValueAtIndex(array: Cf, index: isize) -> Cf;
        fn CFDictionaryGetValue(dictionary: Cf, key: Cf) -> Cf;
        fn CFStringCreateWithCString(allocator: Cf, text: *const c_char, encoding: u32) -> Cf;
        fn CFNumberGetValue(number: Cf, kind: i32, value: *mut c_void) -> bool;
        fn CFRelease(value: Cf);
    }
    unsafe fn value(dictionary: Cf, name: &str) -> Cf {
        let text = CString::new(name).expect("constant CoreGraphics key");
        let key = CFStringCreateWithCString(std::ptr::null(), text.as_ptr(), 0x08000100);
        if key.is_null() {
            return std::ptr::null();
        }
        let result = CFDictionaryGetValue(dictionary, key);
        CFRelease(key);
        result
    }
    unsafe fn number(dictionary: Cf, name: &str) -> Option<f64> {
        let object = value(dictionary, name);
        if object.is_null() {
            return None;
        }
        let mut result = 0.0_f64;
        CFNumberGetValue(object, 13, &mut result as *mut f64 as *mut c_void).then_some(result)
    }
    fn rect(value: CgRect) -> Rect {
        Rect {
            x: value.origin.x,
            y: value.origin.y,
            width: value.size.width,
            height: value.size.height,
        }
    }
    pub(super) fn cursor_position() -> Option<(f64, f64)> {
        unsafe {
            let event = CGEventCreate(std::ptr::null());
            if event.is_null() {
                return None;
            }
            let point = CGEventGetLocation(event);
            CFRelease(event);
            Some((point.x, point.y))
        }
    }
    pub(super) fn capture() -> Result<(Vec<Rect>, Vec<Rect>), String> {
        // Copy APIs retain their result. Every successful copy is released below; no
        // foreign pointer is retained after this synchronous geometry snapshot.
        unsafe {
            let mut displays = [0_u32; 32];
            let mut count = 0;
            if CGGetActiveDisplayList(32, displays.as_mut_ptr(), &mut count) != 0 {
                return Err("화면 위치를 읽지 못했어요.".into());
            }
            let monitors = displays[..count as usize]
                .iter()
                .map(|id| rect(CGDisplayBounds(*id)))
                .collect();
            let list = CGWindowListCopyWindowInfo(1 | 16, 0);
            if list.is_null() {
                return Err("다른 앱 창 위치를 읽지 못했어요.".into());
            }
            let mut windows = vec![];
            for index in 0..CFArrayGetCount(list) {
                let item = CFArrayGetValueAtIndex(list, index);
                if number(item, "kCGWindowOwnerPID") == Some(std::process::id() as f64)
                    || !number(item, "kCGWindowLayer")
                        .is_some_and(|layer| [0.0, 3.0, 8.0].contains(&layer))
                    || number(item, "kCGWindowAlpha").is_some_and(|alpha| alpha <= 0.0)
                {
                    continue;
                }
                let bounds = value(item, "kCGWindowBounds");
                let mut result = CgRect::default();
                if !bounds.is_null() && CGRectMakeWithDictionaryRepresentation(bounds, &mut result)
                {
                    let r = rect(result);
                    if r.width > 1.0 && r.height > 1.0 {
                        windows.push(r);
                    }
                }
            }
            CFRelease(list);
            Ok((monitors, windows))
        }
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use super::Rect;
    use std::{collections::HashSet, ffi::c_void};
    use windows_sys::{
        core::BOOL,
        Win32::{
            Foundation::{HWND, LPARAM, POINT, RECT},
            UI::WindowsAndMessaging::{
                GetClassNameW, GetCursorPos, GetShellWindow, GetTopWindow, GetWindow,
                GetWindowThreadProcessId, IsIconic, IsWindowVisible, GW_HWNDNEXT,
            },
        },
    };
    #[link(name = "dwmapi")]
    unsafe extern "system" {
        fn DwmGetWindowAttribute(
            window: HWND,
            attribute: u32,
            value: *mut c_void,
            size: u32,
        ) -> i32;
    }
    #[link(name = "user32")]
    unsafe extern "system" {
        fn EnumDisplayMonitors(
            hdc: *mut c_void,
            clip: *const RECT,
            callback: Option<
                unsafe extern "system" fn(*mut c_void, *mut c_void, *mut RECT, LPARAM) -> BOOL,
            >,
            data: LPARAM,
        ) -> BOOL;
    }
    fn rect(r: RECT) -> Rect {
        Rect {
            x: r.left as f64,
            y: r.top as f64,
            width: (r.right - r.left) as f64,
            height: (r.bottom - r.top) as f64,
        }
    }
    pub(super) fn cursor_position() -> Option<(f64, f64)> {
        unsafe {
            let mut point: POINT = std::mem::zeroed();
            (GetCursorPos(&mut point) != 0).then_some((point.x as f64, point.y as f64))
        }
    }
    unsafe extern "system" fn monitor(
        _: *mut c_void,
        _: *mut c_void,
        bounds: *mut RECT,
        data: LPARAM,
    ) -> BOOL {
        if !bounds.is_null() {
            (*(data as *mut Vec<Rect>)).push(rect(*bounds));
        }
        1
    }
    pub(super) fn capture() -> Result<(Vec<Rect>, Vec<Rect>), String> {
        unsafe {
            let mut monitors = Vec::<Rect>::new();
            if EnumDisplayMonitors(
                std::ptr::null_mut(),
                std::ptr::null(),
                Some(monitor),
                &mut monitors as *mut _ as LPARAM,
            ) == 0
            {
                return Err("화면 위치를 읽지 못했어요.".into());
            }
            let mut windows = vec![];
            let mut seen = HashSet::new();
            let mut window = GetTopWindow(std::ptr::null_mut());
            // The list can change during capture. A bounded visited set prevents a
            // recycled HWND or concurrent z-order change from looping indefinitely.
            while !window.is_null() && seen.len() < 4096 && seen.insert(window as usize) {
                let mut class_name = [0_u16; 128];
                let class_len = GetClassNameW(window, class_name.as_mut_ptr(), 128).max(0) as usize;
                let class_name = String::from_utf16_lossy(&class_name[..class_len]);
                let shell = window == GetShellWindow()
                    || matches!(
                        class_name.as_str(),
                        "WorkerW"
                            | "Progman"
                            | "Shell_TrayWnd"
                            | "Shell_SecondaryTrayWnd"
                            | "tooltips_class32"
                    );
                let mut pid = 0;
                GetWindowThreadProcessId(window, &mut pid);
                let mut cloaked = 0_u32;
                let cloak_ok =
                    DwmGetWindowAttribute(window, 14, &mut cloaked as *mut _ as *mut c_void, 4)
                        == 0;
                if !shell
                    && pid != std::process::id()
                    && IsWindowVisible(window) != 0
                    && IsIconic(window) == 0
                    && cloak_ok
                    && cloaked == 0
                {
                    let mut bounds: RECT = std::mem::zeroed();
                    if DwmGetWindowAttribute(
                        window,
                        9,
                        &mut bounds as *mut _ as *mut c_void,
                        std::mem::size_of::<RECT>() as u32,
                    ) == 0
                        && bounds.right > bounds.left
                        && bounds.bottom > bounds.top
                    {
                        windows.push(rect(bounds));
                    }
                }
                window = GetWindow(window, GW_HWNDNEXT);
            }
            Ok((monitors, windows))
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod platform {
    use super::Rect;
    pub(super) fn capture() -> Result<(Vec<Rect>, Vec<Rect>), String> {
        Err("이 운영체제에서는 바탕화면 창 충돌을 지원하지 않아요.".into())
    }
    pub(super) fn cursor_position() -> Option<(f64, f64)> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn foreground_windows_clip_hidden_edges_but_keep_both_exposed_sides() {
        let result = visible_edges(&[
            Rect {
                x: 40.0,
                y: 20.0,
                width: 60.0,
                height: 80.0,
            },
            Rect {
                x: 0.0,
                y: 0.0,
                width: 80.0,
                height: 80.0,
            },
        ]);
        assert!(result
            .iter()
            .any(|e| e.horizontal && e.axis == 80.0 && e.from == 0.0 && e.to == 40.0));
        assert!(!result
            .iter()
            .any(|e| e.horizontal && e.axis == 80.0 && e.to == 80.0));
        assert!(result
            .iter()
            .any(|e| !e.horizontal && e.axis == 80.0 && e.to == 20.0));
    }
    #[test]
    fn mirrored_displays_keep_the_screen_boundary() {
        let area = Rect {
            x: 0.0,
            y: 0.0,
            width: 1920.0,
            height: 1080.0,
        };
        assert_eq!(monitor_edges(&[area, area]).len(), 4);
    }
    #[test]
    fn monitor_seams_are_open_but_gaps_and_negative_origins_are_bounded() {
        let result = monitor_edges(&[
            Rect {
                x: -200.0,
                y: 0.0,
                width: 200.0,
                height: 200.0,
            },
            Rect {
                x: 0.0,
                y: 50.0,
                width: 200.0,
                height: 200.0,
            },
        ]);
        assert!(!result
            .iter()
            .any(|e| !e.horizontal && e.axis == 0.0 && e.from < 200.0 && e.to > 50.0));
        assert!(result
            .iter()
            .any(|e| !e.horizontal && e.axis == 0.0 && e.from == 0.0 && e.to == 50.0));
    }
}
