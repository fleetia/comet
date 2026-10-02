//! Small, read-only runtime projection. Never persist or replay these conditions as events.
use crate::{
    app::{lock, AppState},
    widgets::WidgetInstance,
};
use serde::{Deserialize, Serialize};
use tauri::Manager;

const MUSIC_FRESH_MS: i64 = 30_000;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct States {
    pub music_playing: bool,
    pub calendar_open: bool,
}

pub(crate) struct Runtime {
    // A previous process or disabled connection's observation cannot activate a new run.
    music_after: i64,
    pub states: States,
}
impl Default for Runtime {
    fn default() -> Self {
        Self {
            music_after: chrono::Utc::now().timestamp_millis(),
            states: States::default(),
        }
    }
}

impl Runtime {
    fn update(
        &mut self,
        widgets: &[WidgetInstance],
        calendar_visible: bool,
        blocked: bool,
        now: i64,
    ) -> bool {
        let usable =
            |widget: &&WidgetInstance| widget.installed && widget.enabled && widget.error.is_none();
        let music = widgets.iter().find(|widget| widget.kind == "music");
        let connected_music = music.filter(usable).filter(|widget| {
            widget.data["configured"] == true
                && matches!(widget.data["status"].as_str(), Some("ready" | "syncing"))
        });
        if blocked || connected_music.is_none() {
            self.music_after = self.music_after.max(now);
        }
        let music_playing = !blocked
            && connected_music.is_some_and(|widget| {
                let observation = &widget.data["observation"];
                observation["running"] == true
                    && observation["playing"] == true
                    && observation["playbackState"] == "playing"
                    && observation["observedAt"].as_i64().is_some_and(|observed| {
                        observed > self.music_after
                            && observed <= now
                            && now.saturating_sub(observed) <= MUSIC_FRESH_MS
                    })
            });
        let calendar_open = !blocked
            && calendar_visible
            && widgets
                .iter()
                .any(|widget| widget.kind == "calendar" && widget.installed && widget.enabled);
        let next = States {
            music_playing,
            calendar_open,
        };
        let changed = next != self.states;
        self.states = next;
        changed
    }
}

/// Called on widget changes and by the existing maintenance clock, including while busy.
/// Only boolean transitions publish; no frame, track metadata or private calendar data is sent.
pub(crate) fn refresh(app: &tauri::AppHandle, state: &AppState) -> Result<bool, String> {
    // Missing or unreadable sources fail closed instead of extending an old condition.
    let widgets = lock(&state.db)
        .and_then(|db| crate::widgets::storage::instances(&db))
        .unwrap_or_default();
    let blocked = lock(&state.runtime)
        .map(|runtime| runtime.hidden || runtime.paused || crate::app::unavailable(state))
        .unwrap_or(true);
    let calendar_visible = crate::planner_windows::calendar_selected(app).unwrap_or(false)
        && app.get_webview_window("planner").is_some_and(|window| {
            window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(true)
        });
    Ok(lock(&state.animation_states)?.update(
        &widgets,
        calendar_visible,
        blocked,
        chrono::Utc::now().timestamp_millis(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn music() -> WidgetInstance {
        WidgetInstance {
            id: "music".into(),
            kind: "music".into(),
            version: 1,
            installed: true,
            enabled: true,
            revision: 1,
            error: None,
            data: json!({"configured":true,"status":"ready","observation":{
                "running":true,"playing":true,"playbackState":"playing","observedAt":101}}),
        }
    }
    fn runtime() -> Runtime {
        Runtime {
            music_after: 100,
            states: States::default(),
        }
    }
    #[test]
    fn only_fresh_actual_playback_in_this_session_activates_music() {
        let mut runtime = runtime();
        let mut widget = music();
        assert!(runtime.update(&[widget.clone()], false, false, 102));
        assert!(runtime.states.music_playing);
        assert!(!runtime.update(&[widget.clone()], false, false, 103));
        for observation in [
            json!({"running":true,"playing":false,"playbackState":"paused","observedAt":104}),
            json!({"running":false,"playing":true,"playbackState":"playing","observedAt":104}),
            json!({"running":true,"playing":true,"playbackState":"playing","observedAt":100}),
            json!({"running":true,"playing":true,"playbackState":"playing","observedAt":106}),
            json!({"running":true,"playing":true,"playbackState":"playing"}),
        ] {
            widget.data["observation"] = observation;
            runtime.update(&[widget.clone()], false, false, 105);
            assert!(!runtime.states.music_playing);
        }
        runtime.update(&[music()], false, false, 30_102);
        assert!(!runtime.states.music_playing);
    }
    #[test]
    fn refreshing_does_not_restart_or_invalidate_a_fresh_observation() {
        let mut runtime = runtime();
        let mut widget = music();
        runtime.update(&[widget.clone()], false, false, 102);
        widget.data["status"] = json!("syncing");
        assert!(!runtime.update(&[widget.clone()], false, false, 103));
        assert!(runtime.states.music_playing);
        widget.data["status"] = json!("ready");
        // Observation timestamp is the request start, not completion time.
        widget.data["observation"]["observedAt"] = json!(103);
        assert!(!runtime.update(&[widget], false, false, 110));
        assert!(runtime.states.music_playing);
    }

    #[test]
    fn disabled_removed_disconnected_hidden_and_restart_require_new_observation() {
        for reason in 0..5 {
            let mut runtime = runtime();
            let mut widget = music();
            runtime.update(&[widget.clone()], false, false, 102);
            match reason {
                0 => widget.enabled = false,
                1 => widget.installed = false,
                2 => widget.data["status"] = json!("offline"),
                3 => widget.error = Some("disconnected".into()),
                _ => {}
            }
            runtime.update(&[widget], false, reason == 4, 103);
            assert!(!runtime.states.music_playing);
            let mut fresh = music();
            runtime.update(&[fresh.clone()], false, false, 104);
            assert!(!runtime.states.music_playing);
            fresh.data["observation"]["observedAt"] = json!(105);
            runtime.update(&[fresh], false, false, 106);
            assert!(runtime.states.music_playing);
        }
        let mut restarted = Runtime {
            music_after: 102,
            states: States::default(),
        };
        restarted.update(&[music()], false, false, 103);
        assert!(!restarted.states.music_playing);
    }
    #[test]
    fn calendar_needs_enabled_install_and_actual_visible_calendar_destination() {
        let mut runtime = runtime();
        let mut calendar = music();
        calendar.kind = "calendar".into();
        for visible in [false, true, false] {
            runtime.update(&[calendar.clone()], visible, false, 110);
            assert_eq!(runtime.states.calendar_open, visible);
        }
        runtime.update(&[calendar.clone()], true, true, 111);
        assert!(!runtime.states.calendar_open);
        calendar.enabled = false;
        runtime.update(&[calendar.clone()], true, false, 112);
        assert!(!runtime.states.calendar_open);
        calendar.enabled = true;
        calendar.installed = false;
        runtime.update(&[calendar], true, false, 113);
        assert!(!runtime.states.calendar_open);
        runtime.update(&[], true, false, 114);
        assert!(!runtime.states.calendar_open);
    }
}
