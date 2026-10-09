//! On-demand foreground-application snapshots for the opt-in focus timer.
//!
//! This module never starts a watcher, reads a window title/document/URL, or
//! persists an observation. The caller must only sample an active, opted-in
//! timer and discard observations when its session/selection has changed.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[cfg(target_os = "windows")]
#[path = "app_usage/windows.rs"]
mod native;
#[cfg(not(target_os = "windows"))]
#[path = "app_usage/unsupported.rs"]
mod native;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub(crate) struct Application {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Sample {
    pub app_id: Option<String>,
    pub eligible: bool,
    pub status: String,
}

impl Sample {
    fn inactive(status: &str) -> Self {
        Self {
            app_id: None,
            eligible: false,
            status: status.into(),
        }
    }
}

/// Enumerate running GUI applications only when the user opens/refreshes the
/// selection control. Errors do not masquerade as a successful empty list.
pub(crate) fn applications() -> Result<Vec<Application>, String> {
    native::applications().map(normalize_applications)
}

/// The caller owns polling, opt-in, timing, session epochs, and persistence.
/// An ineligible sample intentionally contains no foreground identity.
pub(crate) fn sample() -> Sample {
    native::sample()
}

fn normalize_applications(applications: Vec<Application>) -> Vec<Application> {
    let mut by_id = BTreeMap::new();
    for mut app in applications {
        if app.id.is_empty() || app.id.len() > 512 || app.id.chars().any(char::is_control) {
            continue;
        }
        app.name = app
            .name
            .chars()
            .filter(|ch| !ch.is_control())
            .take(128)
            .collect::<String>()
            .trim()
            .to_owned();
        if !app.name.is_empty() {
            by_id.entry(app.id.clone()).or_insert(app);
        }
    }
    let mut applications: Vec<_> = by_id.into_values().collect();
    applications.sort_by_cached_key(|app| (app.name.to_lowercase(), app.id.clone()));
    applications
}

#[cfg(any(target_os = "windows", test))]
fn observation(app_id: Option<String>, idle_seconds: Option<f64>, unlocked: Option<bool>) -> Sample {
    match unlocked {
        Some(false) => return Sample::inactive("locked"),
        None => return Sample::inactive("unavailable"),
        Some(true) => {}
    }
    let Some(idle) = idle_seconds.filter(|idle| idle.is_finite() && *idle >= 0.0) else {
        return Sample::inactive("unavailable");
    };
    if idle >= 60.0 {
        return Sample::inactive("idle");
    }
    match app_id.filter(|id| !id.is_empty()) {
        Some(app_id) => Sample {
            app_id: Some(app_id),
            eligible: true,
            status: "tracking".into(),
        },
        None => Sample::inactive("unavailable"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn observations_require_known_unlocked_session_idle_and_identity() {
        let id = Some("app:test".into());
        assert!(observation(id.clone(), Some(59.999), Some(true)).eligible);
        assert_eq!(observation(id.clone(), Some(60.0), Some(true)), Sample::inactive("idle"));
        assert_eq!(observation(id.clone(), Some(0.0), Some(false)), Sample::inactive("locked"));
        for idle in [None, Some(f64::NAN), Some(f64::INFINITY), Some(-1.0)] {
            assert_eq!(observation(id.clone(), idle, Some(true)), Sample::inactive("unavailable"));
        }
        assert_eq!(observation(id, Some(0.0), None), Sample::inactive("unavailable"));
        assert_eq!(observation(None, Some(0.0), Some(true)), Sample::inactive("unavailable"));
    }

    #[test]
    fn application_list_has_stable_ids_clean_names_and_no_duplicate_processes() {
        let applications = normalize_applications(vec![
            Application { id: "b".into(), name: " Beta\n".into() },
            Application { id: "a".into(), name: "alpha".into() },
            Application { id: "b".into(), name: "second process".into() },
            Application { id: "".into(), name: "unknown".into() },
            Application { id: "bad\0id".into(), name: "unknown".into() },
            Application { id: "blank".into(), name: " \t".into() },
        ]);
        assert_eq!(applications, vec![
            Application { id: "a".into(), name: "alpha".into() },
            Application { id: "b".into(), name: "Beta".into() },
        ]);
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn unsupported_platform_never_counts_or_returns_a_fake_empty_list() {
        assert_eq!(sample(), Sample::inactive("unsupported"));
        assert!(applications().is_err());
    }
}
