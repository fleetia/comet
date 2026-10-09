//! Conservative sampled foreground dwell time. Never infer time across unobserved gaps.
use crate::app_usage::Sample;
use serde_json::{json, Value};
use std::{collections::BTreeMap, time::Instant};

#[derive(Default)]
pub(crate) struct Tracker {
    observations: BTreeMap<String, Observation>,
}
struct Observation {
    session: String,
    target: String,
    running_since: i64,
    wall: i64,
    monotonic: Instant,
    eligible: bool,
}

impl Tracker {
    pub(crate) fn clear(&mut self) {
        self.observations.clear();
    }

    pub(crate) fn retain(&mut self, ids: &[String]) {
        self.observations.retain(|id, _| ids.contains(id));
    }

    pub(crate) fn observe(
        &mut self,
        id: &str,
        data: &Value,
        sample: &Sample,
        wall: i64,
        monotonic: Instant,
    ) -> Option<Value> {
        let active = &data["activeSession"];
        let usage = &active["appUsage"];
        let session = active["id"].as_str()?;
        let target = usage["target"]["id"].as_str()?;
        let running_since = active["runningSince"].as_i64()?;
        let deadline = data["deadline"].as_i64()?;
        let eligible = sample.eligible && sample.app_id.as_deref() == Some(target);
        let current = Observation {
            session: session.into(), target: target.into(), running_since, wall, monotonic, eligible,
        };
        let elapsed = self.observations.insert(id.into(), current).map_or(0, |previous| {
            if previous.session == session && previous.target == target
                && previous.running_since == running_since {
                // Preserve a high-water mark across clock rollback: never credit the same range twice.
                if let Some(current) = self.observations.get_mut(id) { current.wall = previous.wall.max(wall); }
            }
            if previous.session != session || previous.target != target
                || previous.running_since != running_since || !previous.eligible || !eligible {
                return 0;
            }
            let delta = wall.saturating_sub(previous.wall);
            let monotonic_delta = monotonic.saturating_duration_since(previous.monotonic).as_millis();
            // Delayed/suspended ticks, clock rollback and clock jumps never earn catch-up time.
            if !(1..=2000).contains(&delta) || monotonic_delta == 0 || monotonic_delta > 2000 {
                return 0;
            }
            let covered = deadline.min(wall).saturating_sub(previous.wall.max(running_since)).max(0);
            covered.min(delta).min(monotonic_delta as i64)
        });
        let status = if eligible { "tracking" } else if sample.eligible { "other-app" } else { &sample.status };
        let previous_elapsed = usage["elapsedMs"].as_i64().unwrap_or(0).max(0);
        let duration = active["durationMs"].as_i64().unwrap_or(0).max(0);
        let focus_elapsed = active["elapsedMs"].as_i64().unwrap_or(0).max(0)
            .saturating_add(wall.min(deadline).saturating_sub(running_since).max(0));
        let total = previous_elapsed.saturating_add(elapsed).min(duration).min(focus_elapsed);
        if total == previous_elapsed && usage["status"].as_str() == Some(status) {
            return None;
        }
        let mut updated = data.clone();
        updated["activeSession"]["appUsage"]["elapsedMs"] = json!(total);
        updated["activeSession"]["appUsage"]["status"] = json!(status);
        Some(updated)
    }
}

pub(crate) fn enabled(data: &Value) -> bool {
    data["status"] == "running" && data["mode"] == "focus"
        && data["activeSession"]["appUsage"]["target"]["id"].as_str().is_some()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;
    fn data() -> Value {
        json!({"status":"running","mode":"focus","deadline":10000,
            "activeSession":{"id":"session","runningSince":1000,"durationMs":9000,
            "appUsage":{"target":{"id":"editor","name":"Editor"},"elapsedMs":0,"status":"waiting"}}})
    }
    fn sample(eligible: bool) -> Sample {
        Sample { app_id: Some("editor".into()), eligible, status: "idle".into() }
    }
    fn step(tracker: &mut Tracker, data: &mut Value, sample: &Sample, wall: i64, instant: Instant) {
        if let Some(updated) = tracker.observe("timer", data, sample, wall, instant) { *data = updated; }
    }
    #[test]
    fn only_consecutive_matching_foreground_samples_count() {
        let mut tracker = Tracker::default(); let mut data = data(); let start = Instant::now();
        step(&mut tracker, &mut data, &sample(true), 1000, start);
        step(&mut tracker, &mut data, &sample(true), 1500, start + Duration::from_millis(500));
        assert_eq!(data["activeSession"]["appUsage"]["elapsedMs"], 500);
        step(&mut tracker, &mut data, &sample(false), 2000, start + Duration::from_millis(1000));
        step(&mut tracker, &mut data, &sample(true), 2500, start + Duration::from_millis(1500));
        assert_eq!(data["activeSession"]["appUsage"]["elapsedMs"], 500);
        let other = Sample { app_id: Some("other".into()), eligible: true, status: "tracking".into() };
        step(&mut tracker, &mut data, &other, 3000, start + Duration::from_millis(2000));
        assert_eq!(data["activeSession"]["appUsage"]["status"], "other-app");
        assert_eq!(data["activeSession"]["appUsage"]["elapsedMs"], 500);
    }
    #[test]
    fn gaps_clock_changes_and_restarts_do_not_inflate_usage() {
        for (wall, millis) in [(60000, 59000), (900,500), (60000,500), (1500,59000)] {
            let mut tracker = Tracker::default(); let mut data = data(); let start = Instant::now();
            step(&mut tracker, &mut data, &sample(true), 1000, start);
            step(&mut tracker, &mut data, &sample(true), wall, start + Duration::from_millis(millis));
            assert_eq!(data["activeSession"]["appUsage"]["elapsedMs"], 0);
        }
        let mut tracker = Tracker::default(); let mut data = data(); let start = Instant::now();
        step(&mut tracker, &mut data, &sample(true), 1000, start);
        tracker.clear();
        step(&mut tracker, &mut data, &sample(true), 1500, start + Duration::from_millis(500));
        assert_eq!(data["activeSession"]["appUsage"]["elapsedMs"], 0);
    }
    #[test]
    fn resume_new_session_and_expiration_are_bounded() {
        let mut tracker = Tracker::default(); let mut data = data(); let start = Instant::now();
        step(&mut tracker, &mut data, &sample(true), 1000, start);
        data["activeSession"]["runningSince"] = json!(1200);
        step(&mut tracker, &mut data, &sample(true), 1500, start + Duration::from_millis(500));
        assert_eq!(data["activeSession"]["appUsage"]["elapsedMs"], 0);
        data["deadline"] = json!(1750);
        step(&mut tracker, &mut data, &sample(true), 2000, start + Duration::from_millis(1000));
        assert_eq!(data["activeSession"]["appUsage"]["elapsedMs"], 250);
        data["activeSession"]["id"] = json!("next");
        step(&mut tracker, &mut data, &sample(true), 2500, start + Duration::from_millis(1500));
        assert_eq!(data["activeSession"]["appUsage"]["elapsedMs"], 250);
        data["status"] = json!("paused"); assert!(!enabled(&data));
        data["status"] = json!("running"); data["mode"] = json!("rest"); assert!(!enabled(&data));
    }

    #[test]
    fn clock_rollback_does_not_credit_previously_observed_wall_ranges_again() {
        let mut tracker = Tracker::default();
        let mut data = data();
        let start = Instant::now();
        for index in 0..=10 {
            let millis = index * 500;
            step(&mut tracker, &mut data, &sample(true), 1000 + millis,
                start + Duration::from_millis(millis as u64));
        }
        assert_eq!(data["activeSession"]["appUsage"]["elapsedMs"], 5000);

        // Revisit already observed timestamps after a wall-clock rollback. The
        // active focus duration shrinks, and usage must respect that lower bound.
        step(&mut tracker, &mut data, &sample(true), 2000,
            start + Duration::from_millis(5500));
        assert_eq!(data["activeSession"]["appUsage"]["elapsedMs"], 1000);
        for index in 1..=8 {
            step(&mut tracker, &mut data, &sample(true), 2000 + index * 500,
                start + Duration::from_millis((5500 + index * 500) as u64));
            assert_eq!(data["activeSession"]["appUsage"]["elapsedMs"], 1000);
        }

        // Time is eligible again only beyond the previous high-water mark.
        step(&mut tracker, &mut data, &sample(true), 6500,
            start + Duration::from_millis(10000));
        assert_eq!(data["activeSession"]["appUsage"]["elapsedMs"], 1500);
    }
}
