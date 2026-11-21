use std::collections::HashSet;

use chrono::{DateTime, Datelike, Duration, LocalResult, NaiveDate, NaiveTime, TimeZone, Utc};
use chrono_tz::Tz;

use super::store::{Repeat, Routine};

const CONTINUOUS_MILLIS: i64 = 120_000;

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Occurrence {
    pub routine_id: String,
    pub scheduled_date: NaiveDate,
    pub scheduled_at: DateTime<Utc>,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct TickResult {
    pub due: Vec<Occurrence>,
    pub missed: Vec<Occurrence>,
}

struct ScheduledRoutine {
    routine: Routine,
    next: Option<Occurrence>,
}

pub struct Scheduler {
    revision: i64,
    timezone: Tz,
    previous: DateTime<Utc>,
    routines: Vec<ScheduledRoutine>,
}

fn local_time(timezone: Tz, date: NaiveDate, time: NaiveTime) -> Option<DateTime<Utc>> {
    let mut local = date.and_time(time);
    // A timezone can skip an entire local date, so search beyond the usual DST hour.
    for _ in 0..=172_800 {
        match timezone.from_local_datetime(&local) {
            LocalResult::Single(at) => return Some(at.with_timezone(&Utc)),
            LocalResult::Ambiguous(first, second) => {
                return Some(first.min(second).with_timezone(&Utc));
            }
            LocalResult::None => local = local.checked_add_signed(Duration::seconds(1))?,
        }
    }
    None
}

fn next_occurrence(
    routine: &Routine,
    after: DateTime<Utc>,
    after_date: Option<NaiveDate>,
    timezone: Tz,
) -> Option<Occurrence> {
    if !routine.enabled {
        return None;
    }
    let time = NaiveTime::parse_from_str(&routine.time, "%H:%M").ok()?;
    let created_at = DateTime::from_timestamp_millis(routine.created_at)?;
    let after = after.max(created_at);
    let mut date = after.with_timezone(&timezone).date_naive();
    // The preceding local date can resolve after `after` when a timezone skips a date.
    date = date.pred_opt().unwrap_or(date);
    for _ in 0..=8 {
        let repeats = match &routine.repeat {
            Repeat::Daily => true,
            Repeat::Weekdays(days) => days.contains(&date.weekday().number_from_monday()),
        };
        if repeats {
            if let Some(at) = local_time(timezone, date, time) {
                if at > after || (at == after && after_date.is_some_and(|previous| date > previous))
                {
                    return Some(Occurrence {
                        routine_id: routine.id.clone(),
                        scheduled_date: date,
                        scheduled_at: at,
                    });
                }
            }
        }
        date = date.succ_opt()?;
    }
    None
}

impl Scheduler {
    pub fn new(
        routines: Vec<Routine>,
        revision: i64,
        previous: DateTime<Utc>,
        timezone: Tz,
    ) -> Self {
        let routines = routines
            .into_iter()
            .map(|routine| {
                let next = next_occurrence(&routine, previous, None, timezone);
                ScheduledRoutine { routine, next }
            })
            .collect();
        Self {
            revision,
            timezone,
            previous,
            routines,
        }
    }

    pub fn revision(&self) -> i64 {
        self.revision
    }

    pub fn replace_if_changed(
        &mut self,
        routines: Vec<Routine>,
        revision: i64,
        now: DateTime<Utc>,
        timezone: Tz,
    ) {
        if self.revision == revision {
            return;
        }
        let mut old = std::mem::take(&mut self.routines);
        self.routines = routines
            .into_iter()
            .map(|routine| {
                if let Some(index) = old.iter().position(|item| item.routine == routine) {
                    return old.swap_remove(index);
                }
                let next = next_occurrence(&routine, now, None, timezone);
                ScheduledRoutine { routine, next }
            })
            .collect();
        self.revision = revision;
    }

    // `receipts` is the caller's in-memory set, updated when a receipt is stored.
    pub fn tick(
        &mut self,
        now: DateTime<Utc>,
        timezone: Tz,
        receipts: &HashSet<(String, NaiveDate)>,
    ) -> TickResult {
        if timezone != self.timezone || now < self.previous {
            self.timezone = timezone;
            self.previous = now;
            for scheduled in &mut self.routines {
                scheduled.next = next_occurrence(&scheduled.routine, now, None, timezone);
            }
            return TickResult::default();
        }

        let continuous =
            now.signed_duration_since(self.previous) <= Duration::milliseconds(CONTINUOUS_MILLIS);
        let mut result = TickResult::default();
        for scheduled in &mut self.routines {
            while let Some(occurrence) = scheduled.next.take() {
                if occurrence.scheduled_at > now {
                    scheduled.next = Some(occurrence);
                    break;
                }
                let next = next_occurrence(
                    &scheduled.routine,
                    occurrence.scheduled_at,
                    Some(occurrence.scheduled_date),
                    timezone,
                );
                if !receipts.contains(&(occurrence.routine_id.clone(), occurrence.scheduled_date)) {
                    if continuous {
                        result.due.push(occurrence);
                    } else {
                        result.missed.push(occurrence);
                    }
                }
                scheduled.next = next;
            }
        }
        self.previous = now;
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use chrono_tz::{America::New_York, Asia::Seoul, Pacific::Apia, UTC};

    fn instant(value: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(value)
            .unwrap()
            .with_timezone(&Utc)
    }

    fn routine(time: &str, repeat: Repeat) -> Routine {
        Routine {
            id: "one".into(),
            name: "루틴".into(),
            time: time.into(),
            repeat,
            sources: vec![],
            enabled: true,
            created_at: instant("2020-01-01T00:00:00Z").timestamp_millis(),
        }
    }

    #[test]
    fn interrupted_ticks_return_missed_and_continuous_ticks_return_due() {
        let definitions = vec![routine("09:00", Repeat::Daily)];
        let mut scheduler =
            Scheduler::new(definitions.clone(), 1, instant("2026-11-21T08:59:00Z"), UTC);
        let tick = scheduler.tick(instant("2026-11-21T09:00:00Z"), UTC, &HashSet::new());
        assert_eq!(tick.due.len(), 1);
        assert!(tick.missed.is_empty());

        let mut scheduler = Scheduler::new(definitions, 1, instant("2026-11-21T08:58:00Z"), UTC);
        let tick = scheduler.tick(instant("2026-11-21T09:00:01Z"), UTC, &HashSet::new());
        assert!(tick.due.is_empty());
        assert_eq!(tick.missed.len(), 1);
        assert_eq!(tick.missed[0].scheduled_date.to_string(), "2026-11-21");
    }

    #[test]
    fn crossed_midnight_keeps_the_scheduled_local_date() {
        let mut scheduler = Scheduler::new(
            vec![routine("23:59", Repeat::Daily)],
            1,
            instant("2026-11-21T14:58:30Z"),
            Seoul,
        );
        let tick = scheduler.tick(instant("2026-11-21T15:00:00Z"), Seoul, &HashSet::new());
        assert_eq!(tick.due[0].scheduled_date.to_string(), "2026-11-21");
    }

    #[test]
    fn weekdays_follow_local_calendar() {
        let definition = routine("09:00", Repeat::Weekdays(vec![1, 3]));
        let mut scheduler =
            Scheduler::new(vec![definition], 1, instant("2026-11-22T00:00:00Z"), Seoul);
        let tick = scheduler.tick(instant("2026-11-25T00:00:01Z"), Seoul, &HashSet::new());
        let dates: Vec<_> = tick
            .missed
            .iter()
            .map(|item| item.scheduled_date.to_string())
            .collect();
        assert_eq!(dates, ["2026-11-23", "2026-11-25"]);
    }

    #[test]
    fn nonexistent_time_moves_to_first_valid_instant() {
        let definition = routine("02:30", Repeat::Daily);
        let mut scheduler = Scheduler::new(
            vec![definition],
            1,
            instant("2026-03-08T06:59:00Z"),
            New_York,
        );
        let tick = scheduler.tick(instant("2026-03-08T07:00:00Z"), New_York, &HashSet::new());
        assert_eq!(tick.due[0].scheduled_at, instant("2026-03-08T07:00:00Z"));
        assert_eq!(tick.due[0].scheduled_date.to_string(), "2026-03-08");
    }

    #[test]
    fn ambiguous_time_uses_the_first_instant_only() {
        let definition = routine("01:30", Repeat::Daily);
        let mut scheduler = Scheduler::new(
            vec![definition],
            1,
            instant("2026-11-01T05:29:00Z"),
            New_York,
        );
        let tick = scheduler.tick(instant("2026-11-01T05:30:00Z"), New_York, &HashSet::new());
        assert_eq!(tick.due[0].scheduled_at, instant("2026-11-01T05:30:00Z"));
        assert!(scheduler
            .tick(instant("2026-11-01T06:30:00Z"), New_York, &HashSet::new())
            .missed
            .is_empty());
    }

    #[test]
    fn timezone_change_recalculates_and_existing_local_date_is_not_repeated() {
        let definition = routine("09:00", Repeat::Daily);
        let mut scheduler =
            Scheduler::new(vec![definition], 1, instant("2026-11-20T23:59:00Z"), Seoul);
        let first = scheduler.tick(instant("2026-11-21T00:00:00Z"), Seoul, &HashSet::new());
        assert_eq!(first.due.len(), 1);
        let receipts = HashSet::from([("one".to_string(), first.due[0].scheduled_date)]);
        assert_eq!(
            scheduler.tick(instant("2026-11-21T00:01:00Z"), UTC, &receipts),
            TickResult::default()
        );
        let tick = scheduler.tick(instant("2026-11-21T09:00:00Z"), UTC, &receipts);
        assert!(tick.due.is_empty() && tick.missed.is_empty());
    }

    #[test]
    fn changed_revision_discards_old_schedule_and_recalculates() {
        let mut scheduler = Scheduler::new(
            vec![routine("09:00", Repeat::Daily)],
            1,
            instant("2026-11-21T08:59:00Z"),
            UTC,
        );
        scheduler.replace_if_changed(
            vec![routine("09:01", Repeat::Daily)],
            2,
            instant("2026-11-21T09:00:00Z"),
            UTC,
        );
        assert_eq!(scheduler.revision(), 2);
        let tick = scheduler.tick(instant("2026-11-21T09:01:00Z"), UTC, &HashSet::new());
        assert_eq!(tick.due.len(), 1);
        assert_eq!(
            tick.due[0].scheduled_at,
            UTC.with_ymd_and_hms(2026, 11, 21, 9, 1, 0).unwrap()
        );
    }

    #[test]
    fn changing_another_routine_keeps_the_crossed_occurrence() {
        let unchanged = routine("09:00", Repeat::Daily);
        let mut changed = routine("10:00", Repeat::Daily);
        changed.id = "two".into();
        let mut scheduler = Scheduler::new(
            vec![unchanged.clone(), changed.clone()],
            1,
            instant("2026-11-21T08:59:00Z"),
            UTC,
        );
        changed.time = "11:00".into();
        scheduler.replace_if_changed(
            vec![unchanged, changed],
            2,
            instant("2026-11-21T09:00:01Z"),
            UTC,
        );
        let tick = scheduler.tick(instant("2026-11-21T09:00:01Z"), UTC, &HashSet::new());
        assert_eq!(tick.due.len(), 1);
        assert_eq!(tick.due[0].routine_id, "one");
    }

    #[test]
    fn never_reports_occurrences_before_creation() {
        let mut definition = routine("09:00", Repeat::Daily);
        definition.created_at = instant("2026-11-21T09:01:00Z").timestamp_millis();
        let mut scheduler =
            Scheduler::new(vec![definition], 1, instant("2026-11-20T08:00:00Z"), UTC);
        let tick = scheduler.tick(instant("2026-11-21T10:00:00Z"), UTC, &HashSet::new());
        assert!(tick.missed.is_empty());
    }

    #[test]
    fn timezone_change_discards_uncertain_crossings_and_recalculates() {
        let mut scheduler = Scheduler::new(
            vec![routine("09:00", Repeat::Daily)],
            1,
            instant("2026-11-20T23:59:30Z"),
            UTC,
        );
        let tick = scheduler.tick(instant("2026-11-21T00:00:00Z"), Seoul, &HashSet::new());
        assert_eq!(tick, TickResult::default());
        let tick = scheduler.tick(instant("2026-11-22T00:00:00Z"), Seoul, &HashSet::new());
        assert_eq!(tick.missed.len(), 1);
        assert_eq!(tick.missed[0].scheduled_date.to_string(), "2026-11-22");
    }

    #[test]
    fn skipped_date_and_next_date_can_resolve_to_the_same_instant() {
        let mut definition = routine("00:00", Repeat::Daily);
        definition.created_at = instant("2010-01-01T00:00:00Z").timestamp_millis();
        let mut scheduler =
            Scheduler::new(vec![definition], 1, instant("2011-12-30T09:59:00Z"), Apia);
        let tick = scheduler.tick(instant("2011-12-30T10:00:00Z"), Apia, &HashSet::new());
        let dates: Vec<_> = tick
            .due
            .iter()
            .map(|item| item.scheduled_date.to_string())
            .collect();
        assert_eq!(dates, ["2011-12-30", "2011-12-31"]);
    }
}
