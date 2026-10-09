use super::{observation, Application, Sample};
use sha2::{Digest, Sha256};
use std::{collections::BTreeSet, mem::size_of, ptr};
use windows_sys::Win32::{
    Foundation::{CloseHandle, HANDLE, HWND, LPARAM},
    System::{
        RemoteDesktop::{
            WTSActive, WTSFreeMemory, WTSQuerySessionInformationW, WTSSessionInfoEx, WTSINFOEXW,
            WTS_SESSIONSTATE_LOCK, WTS_SESSIONSTATE_UNLOCK,
        },
        SystemInformation::GetTickCount,
        Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION},
    },
    UI::{
        Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO},
        WindowsAndMessaging::{
            EnumWindows, GetForegroundWindow, GetShellWindow, GetWindowThreadProcessId,
            IsWindowVisible,
        },
    },
};

struct Process(HANDLE);
impl Drop for Process {
    fn drop(&mut self) {
        // This handle was opened by this module with query-only access.
        unsafe { CloseHandle(self.0) };
    }
}

struct SessionBuffer(*mut u16);
impl Drop for SessionBuffer {
    fn drop(&mut self) {
        unsafe { WTSFreeMemory(self.0.cast()) };
    }
}

fn unlocked() -> Option<bool> {
    let mut buffer = ptr::null_mut();
    let mut length = 0;
    // Query only this process's session, including remote sessions. Unlike a
    // foreground HWND, WTS distinguishes a disconnected/locked user session.
    let result = unsafe {
        WTSQuerySessionInformationW(
            ptr::null_mut(),
            u32::MAX,
            WTSSessionInfoEx,
            &mut buffer,
            &mut length,
        )
    };
    if result == 0 || buffer.is_null() {
        return None;
    }
    let buffer = SessionBuffer(buffer);
    if (length as usize) < size_of::<WTSINFOEXW>() {
        return None;
    }
    // The OS supplies a WTSINFOEXW allocation. Read only session state flags;
    // never copy, persist, or log its other fields (user/domain names, etc.).
    let info = unsafe { &*buffer.0.cast::<WTSINFOEXW>() };
    if info.Level != 1 {
        return None;
    }
    let session = unsafe { &info.Data.WTSInfoExLevel1 };
    if session.SessionState != WTSActive {
        return None;
    }
    // Windows 7 reversed these flags; it is below Tauri's Windows 10 minimum.
    match session.SessionFlags as u32 {
        WTS_SESSIONSTATE_LOCK => Some(false),
        WTS_SESSIONSTATE_UNLOCK => Some(true),
        _ => None,
    }
}

fn idle_seconds() -> Option<f64> {
    let mut input = LASTINPUTINFO {
        cbSize: size_of::<LASTINPUTINFO>() as u32,
        dwTime: 0,
    };
    if unsafe { GetLastInputInfo(&mut input) } == 0 {
        return None;
    }
    // Both counters are wrapping DWORD milliseconds in the current session.
    // A backwards/inconsistent native timestamp becomes a large idle duration,
    // which safely excludes the sample rather than fabricating active time.
    Some(unsafe { GetTickCount() }.wrapping_sub(input.dwTime) as f64 / 1000.0)
}

fn application(pid: u32) -> Option<Application> {
    if pid == 0 {
        return None;
    }
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if handle.is_null() {
        return None;
    }
    let handle = Process(handle);
    let mut path = vec![0u16; 32_768];
    let mut length = path.len() as u32;
    if unsafe { QueryFullProcessImageNameW(handle.0, 0, path.as_mut_ptr(), &mut length) } == 0
        || length == 0
        || length as usize >= path.len()
    {
        return None;
    }
    let path = String::from_utf16(&path[..length as usize]).ok()?;
    executable_identity(&path)
}

fn executable_identity(path: &str) -> Option<Application> {
    let normalized = path.replace('/', "\\").to_lowercase();
    let file = path.rsplit(['\\', '/']).next()?.trim();
    let name = file
        .get(..file.len().saturating_sub(4))
        .filter(|_| file.to_ascii_lowercase().ends_with(".exe"))
        .unwrap_or(file);
    // The UWP frame host can represent several unrelated applications. Without
    // a per-application identity, omit it rather than combine their usage.
    if name.is_empty() || normalized.is_empty() || name.eq_ignore_ascii_case("ApplicationFrameHost") {
        return None;
    }
    // A stable executable identity without retaining user-specific path text.
    Some(Application {
        id: format!("windows:{:x}", Sha256::digest(normalized.as_bytes())),
        name: name.into(),
    })
}

pub(super) fn applications() -> Result<Vec<Application>, String> {
    struct Enumeration {
        pids: BTreeSet<u32>,
        visited: usize,
        overflow: bool,
    }
    unsafe extern "system" fn collect(window: HWND, data: LPARAM) -> i32 {
        let state = unsafe { &mut *(data as *mut Enumeration) };
        state.visited += 1;
        if state.visited > 4096 {
            state.overflow = true;
            return 0;
        }
        if unsafe { IsWindowVisible(window) } != 0 && window != unsafe { GetShellWindow() } {
            let mut pid = 0;
            unsafe { GetWindowThreadProcessId(window, &mut pid) };
            if pid != 0 {
                state.pids.insert(pid);
            }
        }
        1
    }
    let mut state = Enumeration {
        pids: BTreeSet::new(),
        visited: 0,
        overflow: false,
    };
    // The callback is synchronous; state stays live for the entire enumeration.
    let result = unsafe { EnumWindows(Some(collect), (&mut state as *mut Enumeration) as LPARAM) };
    if result == 0 || state.overflow {
        return Err("실행 중인 프로그램 목록을 확인하지 못했어요. 잠시 후 새로고침해 주세요.".into());
    }
    Ok(state.pids.into_iter().filter_map(application).collect())
}

pub(super) fn sample() -> Sample {
    let unlocked = unlocked();
    if unlocked != Some(true) {
        return observation(None, None, unlocked);
    }
    let idle = idle_seconds();
    if idle.is_none_or(|seconds| seconds >= 60.0) {
        return observation(None, idle, unlocked);
    }
    let window = unsafe { GetForegroundWindow() };
    if window.is_null() || window == unsafe { GetShellWindow() } {
        return Sample::inactive("unavailable");
    }
    let mut pid = 0;
    unsafe { GetWindowThreadProcessId(window, &mut pid) };
    let app_id = application(pid).map(|app| app.id);
    // Reject a focus/lock transition that happened during process lookup.
    if unsafe { GetForegroundWindow() } != window {
        return Sample::inactive("unavailable");
    }
    observation(app_id, idle, self::unlocked())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_identity_is_stable_but_does_not_expose_paths() {
        let app = executable_identity("C:\\Users\\Private Name\\Editor.EXE").unwrap();
        let same = executable_identity("c:/users/private name/editor.exe").unwrap();
        let other = executable_identity("C:\\Other\\Editor.exe").unwrap();
        assert_eq!(app.id, same.id);
        assert_ne!(app.id, other.id);
        assert_eq!(app.name, "Editor");
        assert!(!app.id.contains("Private"));
        assert_eq!(app.id.len(), "windows:".len() + 64);
        assert!(executable_identity("").is_none());
        assert!(executable_identity("C:\\Windows\\System32\\ApplicationFrameHost.exe").is_none());
    }
}
