//! Ephemeral opt-in foreground observation; never persisted or sent to a model.
use super::DetailedSample;
use std::{
    collections::BTreeMap,
    time::{Duration, Instant},
};

const POLL_INTERVAL: Duration = Duration::from_secs(5);
const MAX_GAP: Duration = Duration::from_secs(10);

pub(crate) struct Current {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) category: String,
    pub(crate) since: Instant,
    next_long_session: Instant,
}

#[derive(Default)]
pub(crate) struct Runtime {
    pub(crate) current: Option<Current>,
    pub(crate) idle_since: Option<Instant>,
    pub(crate) last_switch_at: Option<Instant>,
    last_sample: Option<Instant>,
    last_idle_return: Option<Instant>,
    ready: bool,
    events: Vec<&'static str>,
}

impl Runtime {
    pub(crate) fn clear(&mut self) {
        *self = Self::default();
    }

    pub(crate) fn due(&self, now: Instant) -> bool {
        self.last_sample
            .is_none_or(|last| now.saturating_duration_since(last) >= POLL_INTERVAL)
    }

    pub(crate) fn ready(&self) -> bool {
        self.ready
            && self
                .last_sample
                .is_some_and(|last| last.elapsed() <= MAX_GAP)
    }

    pub(crate) fn minutes(&self) -> Option<i64> {
        self.current
            .as_ref()
            .map(|current| current.since.elapsed().as_secs().saturating_div(60) as i64)
    }

    pub(crate) fn idle_minutes(&self) -> Option<i64> {
        self.idle_since
            .map(|since| since.elapsed().as_secs().saturating_div(60) as i64)
    }

    pub(crate) fn take_events(&mut self) -> Vec<&'static str> {
        std::mem::take(&mut self.events)
    }

    pub(crate) fn has_events(&self) -> bool {
        !self.events.is_empty()
    }

    pub(crate) fn observe(&mut self, sample: DetailedSample, excluded: &[String], now: Instant) {
        if self
            .last_sample
            .is_some_and(|last| now.saturating_duration_since(last) > MAX_GAP)
        {
            self.current = None;
            self.idle_since = None;
            self.events.clear();
        }
        self.last_sample = Some(now);
        if sample.sample.status == "idle"
            && sample
                .application
                .as_ref()
                .is_some_and(|app| !excluded.contains(&app.id))
        {
            self.ready = true;
            self.current = None;
            if let Some(seconds) = sample
                .idle_seconds
                .filter(|value| value.is_finite() && *value >= 0.0)
            {
                self.idle_since = now.checked_sub(Duration::from_secs_f64(seconds));
            }
            return;
        }
        let Some(app) = sample
            .application
            .filter(|app| sample.sample.eligible && !excluded.contains(&app.id))
        else {
            self.ready = false;
            self.current = None;
            self.idle_since = None;
            self.events.clear();
            return;
        };
        self.ready = true;
        if let Some(since) = self.idle_since.take() {
            if now.saturating_duration_since(since) >= Duration::from_secs(600)
                && self.last_idle_return.is_none_or(|last| {
                    now.saturating_duration_since(last) >= Duration::from_secs(1800)
                })
            {
                self.last_idle_return = Some(now);
                self.queue("activity.idle-return");
            }
        }
        if self
            .current
            .as_ref()
            .is_none_or(|current| current.id != app.id)
        {
            self.last_switch_at = Some(now);
            self.current = Some(Current {
                id: app.id,
                category: category(&app.name),
                name: app.name,
                since: now,
                next_long_session: now + Duration::from_secs(3600),
            });
        }
        if let Some(current) = self.current.as_mut() {
            if now >= current.next_long_session {
                current.next_long_session = now + Duration::from_secs(5400);
                self.queue("activity.long-session");
            }
        }
    }

    fn queue(&mut self, event: &'static str) {
        if !self.events.contains(&event) {
            self.events.push(event);
        }
    }
}

fn category(name: &str) -> String {
    let table: BTreeMap<String, Vec<String>> =
        serde_json::from_str(include_str!("categories.json")).unwrap_or_default();
    let name = name.to_lowercase();
    table
        .into_iter()
        .find_map(|(category, names)| names.iter().any(|entry| entry == &name).then_some(category))
        .unwrap_or_else(|| "other".into())
}
