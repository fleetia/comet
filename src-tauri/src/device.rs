use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

/// Hardware facts for model recommendations. Read once per process, because snapshots that
/// carry them are rebuilt every 250 ms during a download.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    /// Physical memory in bytes; `None` when the OS did not report it.
    pub total_memory: Option<u64>,
    /// macOS builds run llama.cpp on Metal; other release builds use the CPU.
    pub apple_silicon: bool,
}

pub fn info() -> DeviceInfo {
    static INFO: OnceLock<DeviceInfo> = OnceLock::new();
    *INFO.get_or_init(|| DeviceInfo {
        total_memory: total_memory(),
        apple_silicon: cfg!(all(target_os = "macos", target_arch = "aarch64")),
    })
}

#[cfg(target_os = "macos")]
fn total_memory() -> Option<u64> {
    unsafe extern "C" {
        fn sysctlbyname(
            name: *const std::ffi::c_char,
            oldp: *mut std::ffi::c_void,
            oldlenp: *mut usize,
            newp: *mut std::ffi::c_void,
            newlen: usize,
        ) -> std::ffi::c_int;
    }
    let mut value: u64 = 0;
    let mut size = std::mem::size_of::<u64>();
    // SAFETY: hw.memsize is a 64-bit integer. The buffer and length describe the live
    // `value`, and a null new value only reads.
    let status = unsafe {
        sysctlbyname(
            c"hw.memsize".as_ptr(),
            (&mut value as *mut u64).cast(),
            &mut size,
            std::ptr::null_mut(),
            0,
        )
    };
    (status == 0 && size == std::mem::size_of::<u64>() && value > 0).then_some(value)
}

#[cfg(target_os = "windows")]
fn total_memory() -> Option<u64> {
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    let mut status = MEMORYSTATUSEX {
        dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
        ..Default::default()
    };
    // SAFETY: dwLength is set as the API requires and the struct outlives the call.
    let ok = unsafe { GlobalMemoryStatusEx(&mut status) };
    (ok != 0 && status.ullTotalPhys > 0).then_some(status.ullTotalPhys)
}

#[cfg(target_os = "linux")]
fn total_memory() -> Option<u64> {
    memory_from_meminfo(&std::fs::read_to_string("/proc/meminfo").ok()?)
}

#[cfg(any(target_os = "linux", test))]
fn memory_from_meminfo(contents: &str) -> Option<u64> {
    let mut fields = contents
        .lines()
        .find_map(|line| line.strip_prefix("MemTotal:"))?
        .split_whitespace();
    let kibibytes: u64 = fields.next()?.parse().ok()?;
    if fields.next()? != "kB" || fields.next().is_some() || kibibytes == 0 {
        return None;
    }
    kibibytes.checked_mul(1024)
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn total_memory() -> Option<u64> {
    None
}

#[cfg(test)]
mod tests {
    #[test]
    fn reports_the_memory_of_supported_desktops() {
        let info = super::info();
        if cfg!(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux"
        )) {
            assert!(info.total_memory.is_some_and(|bytes| bytes >= 1 << 30));
        }
        assert_eq!(info, super::info());
    }

    #[test]
    fn linux_meminfo_uses_total_memory_and_converts_kibibytes() {
        assert_eq!(
            super::memory_from_meminfo(
                "MemFree: 10 kB\nMemTotal:       16384000 kB\nMemAvailable: 123 kB\n"
            ),
            Some(16_384_000 * 1024)
        );
    }

    #[test]
    fn linux_meminfo_rejects_missing_invalid_or_overflowed_totals() {
        for invalid in [
            "",
            "MemFree: 10 kB",
            "MemTotal: 0 kB",
            "MemTotal: -1 kB",
            "MemTotal: 10 MB",
            "MemTotal: 10",
            "MemTotal: 10 kB extra",
            "MemTotal: 18446744073709551615 kB",
        ] {
            assert_eq!(super::memory_from_meminfo(invalid), None, "{invalid}");
        }
    }
}
