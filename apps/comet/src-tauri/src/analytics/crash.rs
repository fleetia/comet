use crate::{store, AppState};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tauri::Manager;

const MARKER_FILE: &str = "analytics-run-state";
const MAX_MARKER_BYTES: u64 = 256;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum TerminationKind {
    UncleanExit,
    RustPanicObserved,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum MarkerState {
    Running,
    RustPanicObserved,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Marker {
    state: MarkerState,
    app_version: String,
}

#[derive(Debug, PartialEq, Eq)]
struct PreviousRun {
    kind: TerminationKind,
    app_version: String,
}

struct RunState {
    consented: bool,
    closed: bool,
}

struct Runtime {
    marker: PathBuf,
    running_marker: Vec<u8>,
    panic_marker: Vec<u8>,
    state: Mutex<RunState>,
}

fn valid_version(version: &str) -> bool {
    if version.len() > 64 || !version.is_ascii() {
        return false;
    }
    let (release, build) = version.split_once('+').unwrap_or((version, ""));
    let has_prerelease = release.contains('-');
    let (release, prerelease) = release.split_once('-').unwrap_or((release, ""));
    let numbers: Vec<_> = release.split('.').collect();
    let valid_number = |number: &str| {
        !number.is_empty()
            && (number.len() == 1 || !number.starts_with('0'))
            && number.bytes().all(|byte| byte.is_ascii_digit())
            && number.parse::<u64>().is_ok()
    };
    let valid_identifiers = |identifiers: &str, numeric_leading_zero: bool| {
        identifiers.split('.').all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
                && (numeric_leading_zero
                    || !part.bytes().all(|byte| byte.is_ascii_digit())
                    || valid_number(part))
        })
    };
    numbers.len() == 3
        && numbers.iter().all(|number| valid_number(number))
        && (!has_prerelease || valid_identifiers(prerelease, false))
        && (!version.contains('+') || valid_identifiers(build, true))
}

fn marker_bytes(state: MarkerState, version: &str) -> Vec<u8> {
    if !valid_version(version) {
        return Vec::new();
    }
    serde_json::to_vec(&Marker {
        state,
        app_version: version.to_owned(),
    })
    .unwrap_or_default()
}

fn previous_run(marker: &Path) -> Option<PreviousRun> {
    let metadata = fs::symlink_metadata(marker).ok()?;
    if !metadata.is_file() || metadata.len() > MAX_MARKER_BYTES {
        return None;
    }
    let mut bytes = Vec::new();
    File::open(marker)
        .ok()?
        .take(MAX_MARKER_BYTES + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() as u64 > MAX_MARKER_BYTES {
        return None;
    }
    let marker: Marker = serde_json::from_slice(&bytes).ok()?;
    if !valid_version(&marker.app_version) {
        return None;
    }
    Some(PreviousRun {
        kind: match marker.state {
            MarkerState::Running => TerminationKind::UncleanExit,
            MarkerState::RustPanicObserved => TerminationKind::RustPanicObserved,
        },
        app_version: marker.app_version,
    })
}

impl Runtime {
    fn start(directory: &Path, consented: bool, version: &str) -> (Self, Option<PreviousRun>) {
        let runtime = Self {
            marker: directory.join(MARKER_FILE),
            running_marker: marker_bytes(MarkerState::Running, version),
            panic_marker: marker_bytes(MarkerState::RustPanicObserved, version),
            state: Mutex::new(RunState {
                consented,
                closed: false,
            }),
        };
        let previous = consented.then(|| previous_run(&runtime.marker)).flatten();
        let consumed = runtime.remove_marker();
        if consented {
            runtime.write_marker(&runtime.running_marker);
        }
        (runtime, previous.filter(|_| consumed))
    }

    fn temporary_marker(&self) -> PathBuf {
        self.marker.with_extension("tmp")
    }

    fn write_marker(&self, bytes: &[u8]) {
        if bytes.is_empty() {
            return;
        }
        let temporary = self.temporary_marker();
        let result = (|| -> std::io::Result<()> {
            let _ = fs::remove_file(&temporary);
            let mut options = OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options.open(&temporary)?;
            file.write_all(bytes)?;
            file.sync_data()?;
            drop(file);
            fs::rename(&temporary, &self.marker)
        })();
        if result.is_err() {
            let _ = fs::remove_file(temporary);
        }
    }

    fn remove_marker(&self) -> bool {
        let removed = fs::remove_file(&self.marker)
            .map(|_| true)
            .unwrap_or_else(|error| error.kind() == std::io::ErrorKind::NotFound);
        let _ = fs::remove_file(self.temporary_marker());
        removed
    }

    fn sync_consent(&self, consent: impl FnOnce() -> bool) {
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        let enabled = consent();
        if !enabled || state.closed {
            state.consented = false;
            self.remove_marker();
            return;
        }
        if !state.consented {
            state.consented = true;
            self.write_marker(&self.running_marker);
        }
    }

    fn observe_panic(&self) {
        // A panic may interrupt consent/exit handling: never wait on an app or marker lock.
        let Ok(state) = self.state.try_lock() else {
            return;
        };
        if state.consented && !state.closed {
            self.write_marker(&self.panic_marker);
        }
    }

    fn clean_exit(&self) {
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        state.closed = true;
        state.consented = false;
        self.remove_marker();
    }
}

pub(crate) fn install(app: &tauri::AppHandle, state: &AppState) {
    if app.try_state::<Arc<Runtime>>().is_some() {
        return;
    }
    let consented = crate::lock(&state.db)
        .ok()
        .and_then(|db| store::settings(&db).ok())
        .is_some_and(|settings| settings.analytics_consent);
    let (runtime, previous) = Runtime::start(
        &state.app_data,
        consented,
        &app.package_info().version.to_string(),
    );
    let runtime = Arc::new(runtime);
    app.manage(runtime.clone());
    let previous_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        runtime.observe_panic();
        previous_hook(info);
    }));
    if let Some(previous) = previous {
        crate::analytics::report_abnormal_exit(app, previous.kind, &previous.app_version);
    }
}

pub(crate) fn sync_consent(app: &tauri::AppHandle, state: &AppState) {
    if let Some(runtime) = app.try_state::<Arc<Runtime>>() {
        runtime.sync_consent(|| {
            crate::lock(&state.db)
                .ok()
                .and_then(|db| store::settings(&db).ok())
                .is_some_and(|settings| settings.analytics_consent)
        });
    }
}

pub(crate) fn clean_exit(app: &tauri::AppHandle) {
    if let Some(runtime) = app.try_state::<Arc<Runtime>>() {
        runtime.clean_exit();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const VERSION: &str = "0.13.2";

    #[test]
    fn only_a_consented_previous_marker_is_reported_once() {
        let directory = tempfile::tempdir().unwrap();
        let (first, previous) = Runtime::start(directory.path(), false, VERSION);
        assert_eq!(previous, None);
        first.observe_panic();
        assert!(!first.marker.exists());
        first.sync_consent(|| true);
        assert_eq!(fs::read(&first.marker).unwrap(), first.running_marker);

        let (second, previous) = Runtime::start(directory.path(), true, "0.14.0");
        assert_eq!(
            previous,
            Some(PreviousRun {
                kind: TerminationKind::UncleanExit,
                app_version: VERSION.to_owned(),
            })
        );
        second.clean_exit();
        let (_, previous) = Runtime::start(directory.path(), true, VERSION);
        assert_eq!(previous, None);
    }

    #[test]
    fn a_panic_is_an_observation_and_clean_exit_discards_it() {
        let directory = tempfile::tempdir().unwrap();
        let (runtime, _) = Runtime::start(directory.path(), true, VERSION);
        runtime.observe_panic();
        assert_eq!(fs::read(&runtime.marker).unwrap(), runtime.panic_marker);
        let (next, previous) = Runtime::start(directory.path(), true, VERSION);
        assert_eq!(
            previous,
            Some(PreviousRun {
                kind: TerminationKind::RustPanicObserved,
                app_version: VERSION.to_owned(),
            })
        );
        next.observe_panic();
        next.clean_exit();
        next.observe_panic();
        next.sync_consent(|| true);
        assert!(!next.marker.exists());
    }

    #[test]
    fn withdrawal_and_a_nonconsented_restart_purge_previous_observations() {
        let directory = tempfile::tempdir().unwrap();
        let (runtime, _) = Runtime::start(directory.path(), true, VERSION);
        runtime.observe_panic();
        runtime.sync_consent(|| false);
        runtime.observe_panic();
        assert!(!runtime.marker.exists());
        runtime.sync_consent(|| true);
        runtime.observe_panic();
        let (next, previous) = Runtime::start(directory.path(), false, VERSION);
        assert_eq!(previous, None);
        assert!(!next.marker.exists());
        next.sync_consent(|| true);
        assert_eq!(fs::read(&next.marker).unwrap(), next.running_marker);
    }

    #[test]
    fn malformed_or_oversized_markers_never_export_their_contents() {
        let directory = tempfile::tempdir().unwrap();
        let marker = directory.path().join(MARKER_FILE);
        for bytes in [
            b"private panic path text".as_slice(),
            &[b'x'; MAX_MARKER_BYTES as usize + 1],
            br#"{"state":"running","app_version":"/private/path"}"#,
            br#"{"state":"running","app_version":"0.13.2","raw":"private text"}"#,
        ] {
            fs::write(&marker, bytes).unwrap();
            let (runtime, previous) = Runtime::start(directory.path(), true, VERSION);
            assert_eq!(previous, None);
            assert_eq!(fs::read(&marker).unwrap(), runtime.running_marker);
            runtime.clean_exit();
        }
        assert_eq!(
            serde_json::to_value(TerminationKind::RustPanicObserved).unwrap(),
            "rust_panic_observed"
        );
        assert_eq!(
            serde_json::to_value(TerminationKind::UncleanExit).unwrap(),
            "unclean_exit"
        );
    }

    #[test]
    fn unavailable_marker_storage_and_contended_panic_recording_are_best_effort() {
        let file = tempfile::NamedTempFile::new().unwrap();
        let (unavailable, previous) = Runtime::start(file.path(), true, VERSION);
        assert_eq!(previous, None);
        unavailable.observe_panic();
        unavailable.sync_consent(|| false);
        unavailable.clean_exit();

        let directory = tempfile::tempdir().unwrap();
        let (runtime, _) = Runtime::start(directory.path(), true, VERSION);
        let guard = runtime.state.lock().unwrap();
        runtime.observe_panic();
        assert_eq!(fs::read(&runtime.marker).unwrap(), runtime.running_marker);
        drop(guard);
        runtime.clean_exit();
    }

    #[test]
    fn versions_are_bounded_semver_and_markers_have_only_fixed_state_and_version() {
        for version in ["0.13.2", "1.2.3-alpha.1+build-id.01"] {
            assert!(valid_version(version));
            let bytes = marker_bytes(MarkerState::Running, version);
            assert!(bytes.len() <= MAX_MARKER_BYTES as usize);
            assert_eq!(
                serde_json::from_slice::<serde_json::Value>(&bytes).unwrap(),
                serde_json::json!({ "state": "running", "app_version": version })
            );
        }
        for version in [
            "",
            "1.2",
            "01.2.3",
            "1.2.3-01",
            "1.2.3-",
            "1.2.3+",
            "1.2.3+bad/name",
            "1.2.3\n",
            "1.2.3-사용자",
        ] {
            assert!(!valid_version(version), "{version:?}");
            assert!(marker_bytes(MarkerState::Running, version).is_empty());
        }
        assert!(!valid_version(&format!("1.2.3+{}", "x".repeat(65))));
    }
}
