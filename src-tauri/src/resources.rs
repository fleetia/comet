#[cfg(any(unix, test))]
fn load_allows_background(load: f64, cpus: usize) -> bool {
    load.is_finite() && load >= 0.0 && cpus > 0 && load / (cpus as f64) < 0.65
}

/// A conservative load-average heuristic, not a CPU utilization measurement.
/// Call only when background preparation is due; this starts no polling task.
#[cfg(unix)]
pub fn background_allowed() -> bool {
    unsafe extern "C" {
        fn getloadavg(loads: *mut std::ffi::c_double, count: std::ffi::c_int) -> std::ffi::c_int;
    }
    let Ok(cpus) = std::thread::available_parallelism() else {
        return false;
    };
    let mut load = 0.0;
    // SAFETY: getloadavg writes at most one double into this live stack variable
    // because count is one. It retains no pointer; success must report one sample.
    let count = unsafe { getloadavg(&mut load, 1) };
    count == 1 && load_allows_background(load, cpus.get())
}

// These platforms rely on the caller's bounded preparation schedule, not a CPU check.
#[cfg(not(unix))]
pub fn background_allowed() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::load_allows_background;

    #[test]
    fn normalizes_load_and_excludes_threshold_or_higher() {
        assert!(load_allows_background(0.0, 1));
        assert!(load_allows_background(5.0, 8));
        assert!(!load_allows_background(5.2, 8));
        assert!(!load_allows_background(5.0, 4));
        assert!(!load_allows_background(10.0, 8));
    }

    #[test]
    fn rejects_unknown_or_invalid_inputs() {
        for load in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, -0.1] {
            assert!(!load_allows_background(load, 8));
        }
        assert!(!load_allows_background(0.0, 0));
    }
}
