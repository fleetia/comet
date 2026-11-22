use std::collections::HashSet;

use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use rusqlite::Connection;

use super::{
    scheduler::{Occurrence, Scheduler},
    store::{self, Routine},
};

pub(crate) struct Driver {
    scheduler: Scheduler,
    routines: Vec<Routine>,
    observed_at: DateTime<Utc>,
}

pub(crate) struct Claimed {
    pub occurrence: Occurrence,
    pub routine: Routine,
    pub generation: i64,
}

fn timezone_from(
    environment: Option<&str>,
    system: impl FnOnce() -> Result<String, String>,
) -> Result<Tz, String> {
    if let Some(timezone) = environment.and_then(|value| value.parse::<Tz>().ok()) {
        return Ok(timezone);
    }
    system()?.parse::<Tz>().map_err(|error| error.to_string())
}

#[derive(Default)]
pub(crate) struct Timezone {
    last: Option<Tz>,
    reported: bool,
}

impl Timezone {
    pub fn get(&mut self) -> Result<Option<Tz>, String> {
        let environment = std::env::var("TZ").ok();
        let result = timezone_from(environment.as_deref(), || {
            iana_time_zone::get_timezone().map_err(|error| error.to_string())
        });
        self.resolve(result)
    }

    fn resolve(&mut self, result: Result<Tz, String>) -> Result<Option<Tz>, String> {
        match result {
            Ok(timezone) => {
                self.last = Some(timezone);
                Ok(self.last)
            }
            Err(_) if self.last.is_some() => Ok(self.last),
            Err(_) if self.reported => Ok(None),
            Err(error) => {
                self.reported = true;
                Err(error)
            }
        }
    }
}

impl Driver {
    pub fn new(db: &Connection, now: DateTime<Utc>, timezone: Tz) -> Result<Self, String> {
        store::interrupt_incomplete(db, now.timestamp_millis())?;
        let tx = db
            .unchecked_transaction()
            .map_err(|error| error.to_string())?;
        let routines = store::list(&tx)?;
        let previous = store::last_observation(&tx)?
            .and_then(DateTime::from_timestamp_millis)
            .filter(|previous| *previous <= now)
            .unwrap_or(now)
            .max(now - chrono::Duration::days(9));
        let mut scheduler =
            Scheduler::new(routines.clone(), store::revision(&tx)?, previous, timezone);
        let result = scheduler.tick(now, timezone, &HashSet::new());
        let mut latest = std::collections::HashMap::new();
        for occurrence in result.due.into_iter().chain(result.missed) {
            latest.insert(occurrence.routine_id.clone(), occurrence);
        }
        for missed in latest.into_values() {
            store::mark_missed(
                &tx,
                &missed.routine_id,
                missed.scheduled_date,
                now.timestamp_millis(),
                "예정 시각이 지났어요",
            )?;
        }
        store::observe_at(&tx, now.timestamp_millis())?;
        tx.commit().map_err(|error| error.to_string())?;
        Ok(Self {
            scheduler,
            routines,
            observed_at: now,
        })
    }

    #[cfg(test)]
    pub fn tick(
        &mut self,
        db: &Connection,
        now: DateTime<Utc>,
        timezone: Tz,
    ) -> Result<Vec<Claimed>, String> {
        self.tick_with_notification(db, now, timezone, |_| {})
    }

    pub fn tick_with_notification(
        &mut self,
        db: &Connection,
        now: DateTime<Utc>,
        timezone: Tz,
        before_change: impl FnOnce(&Connection),
    ) -> Result<Vec<Claimed>, String> {
        let tx = db
            .unchecked_transaction()
            .map_err(|error| error.to_string())?;
        let mut scheduler = self.scheduler.clone();
        let revision = store::revision(&tx)?;
        let routines = if revision != scheduler.revision() {
            let routines = store::list(&tx)?;
            scheduler.replace_if_changed(routines.clone(), revision, now, timezone);
            routines
        } else {
            self.routines.clone()
        };
        let result = scheduler.tick(now, timezone, &HashSet::new());
        if !result.missed.is_empty() || !result.due.is_empty() {
            before_change(&tx);
        }
        let mut latest = std::collections::HashMap::new();
        for missed in result.missed {
            latest.insert(missed.routine_id.clone(), missed);
        }
        for missed in latest.into_values() {
            store::mark_missed(
                &tx,
                &missed.routine_id,
                missed.scheduled_date,
                now.timestamp_millis(),
                "예정 시각이 지났어요",
            )?;
        }
        let mut claimed = Vec::new();
        for occurrence in result.due {
            let Some(routine) = routines
                .iter()
                .find(|routine| routine.id == occurrence.routine_id)
            else {
                continue;
            };
            if store::claim(
                &tx,
                &occurrence.routine_id,
                occurrence.scheduled_date,
                now.timestamp_millis(),
            )? {
                claimed.push(Claimed {
                    occurrence,
                    routine: routine.clone(),
                    generation: store::generation(&tx, &routine.id)?,
                });
            }
        }
        let checkpoint = now < self.observed_at
            || now.signed_duration_since(self.observed_at) >= chrono::Duration::minutes(1);
        if checkpoint {
            store::observe_at(&tx, now.timestamp_millis())?;
        }
        tx.commit().map_err(|error| error.to_string())?;
        if checkpoint {
            self.observed_at = now;
        }
        self.scheduler = scheduler;
        self.routines = routines;
        Ok(claimed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::routines::store::{Repeat, Routine};
    use chrono::TimeZone;

    #[test]
    fn restart_records_only_the_latest_offline_occurrence_without_running_it() {
        let db = Connection::open_in_memory().unwrap();
        store::initialize(&db).unwrap();
        let routine = Routine {
            id: "one".into(),
            name: "아침".into(),
            time: "09:00".into(),
            repeat: Repeat::Daily,
            sources: vec![],
            enabled: true,
            created_at: 0,
        };
        store::save(&db, &routine).unwrap();
        let at = |day| {
            chrono_tz::UTC
                .with_ymd_and_hms(2026, 11, day, 10, 0, 0)
                .unwrap()
                .with_timezone(&Utc)
        };
        store::observe_at(&db, at(1).timestamp_millis()).unwrap();
        let mut driver = Driver::new(&db, at(21), chrono_tz::UTC).unwrap();
        assert!(driver.tick(&db, at(21), chrono_tz::UTC).unwrap().is_empty());
        let receipt = store::latest_receipt(&db, "one").unwrap().unwrap();
        assert_eq!(receipt.state, store::ReceiptState::Missed);
        assert_eq!(receipt.scheduled_date.to_string(), "2026-11-21");
        assert_eq!(
            db.query_row("SELECT count(*) FROM routine_receipts", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert!(store::reports(&db, "user").unwrap().is_empty());
    }

    #[test]
    fn even_a_short_shutdown_marks_crossed_occurrence_missed() {
        let db = Connection::open_in_memory().unwrap();
        store::initialize(&db).unwrap();
        store::save(
            &db,
            &Routine {
                id: "one".into(),
                name: "아침".into(),
                time: "09:00".into(),
                repeat: Repeat::Daily,
                sources: vec![],
                enabled: true,
                created_at: 0,
            },
        )
        .unwrap();
        let previous = chrono_tz::UTC
            .with_ymd_and_hms(2026, 11, 21, 8, 59, 59)
            .unwrap()
            .with_timezone(&Utc);
        store::observe_at(&db, previous.timestamp_millis()).unwrap();
        let now = previous + chrono::Duration::seconds(2);
        let mut driver = Driver::new(&db, now, chrono_tz::UTC).unwrap();
        assert!(driver.tick(&db, now, chrono_tz::UTC).unwrap().is_empty());
        assert_eq!(
            store::latest_receipt(&db, "one").unwrap().unwrap().state,
            store::ReceiptState::Missed
        );
    }

    #[test]
    fn future_observation_is_ignored_on_restart() {
        let db = Connection::open_in_memory().unwrap();
        store::initialize(&db).unwrap();
        store::save(
            &db,
            &Routine {
                id: "one".into(),
                name: "아침".into(),
                time: "09:00".into(),
                repeat: Repeat::Daily,
                sources: vec![],
                enabled: true,
                created_at: 0,
            },
        )
        .unwrap();
        let now = chrono_tz::UTC
            .with_ymd_and_hms(2026, 11, 21, 10, 0, 0)
            .unwrap()
            .with_timezone(&Utc);
        store::observe_at(&db, (now + chrono::Duration::days(1)).timestamp_millis()).unwrap();
        Driver::new(&db, now, chrono_tz::UTC).unwrap();
        assert!(store::latest_receipt(&db, "one").unwrap().is_none());
        assert_eq!(
            store::last_observation(&db).unwrap(),
            Some(now.timestamp_millis())
        );
    }

    #[test]
    fn timezone_prefers_valid_environment_and_falls_back_to_system() {
        assert_eq!(
            timezone_from(Some("Asia/Seoul"), || Err("unused".into())).unwrap(),
            chrono_tz::Asia::Seoul
        );
        assert_eq!(
            timezone_from(Some("invalid"), || Ok("America/New_York".into())).unwrap(),
            chrono_tz::America::New_York
        );
        assert_eq!(
            timezone_from(None, || Ok("UTC".into())).unwrap(),
            chrono_tz::UTC
        );
    }

    #[test]
    fn timezone_reports_initial_failure_once_and_preserves_last_success() {
        let mut timezone = Timezone::default();
        assert!(timezone.resolve(Err("unavailable".into())).is_err());
        assert_eq!(timezone.resolve(Err("unavailable".into())).unwrap(), None);
        assert_eq!(
            timezone.resolve(Ok(chrono_tz::Asia::Seoul)).unwrap(),
            Some(chrono_tz::Asia::Seoul)
        );
        assert_eq!(
            timezone.resolve(Err("unavailable".into())).unwrap(),
            Some(chrono_tz::Asia::Seoul)
        );
        assert_eq!(
            timezone.resolve(Ok(chrono_tz::UTC)).unwrap(),
            Some(chrono_tz::UTC)
        );
    }

    #[test]
    fn ticks_claim_once_and_record_a_suspended_occurrence_as_missed() {
        let db = Connection::open_in_memory().unwrap();
        store::initialize(&db).unwrap();
        store::save(
            &db,
            &Routine {
                id: "one".into(),
                name: "아침".into(),
                time: "09:00".into(),
                repeat: Repeat::Daily,
                sources: vec![],
                enabled: true,
                created_at: 0,
            },
        )
        .unwrap();
        let at = |day, hour, minute, second| {
            chrono_tz::UTC
                .with_ymd_and_hms(2026, 11, day, hour, minute, second)
                .unwrap()
                .with_timezone(&Utc)
        };
        let mut driver = Driver::new(&db, at(21, 8, 59, 59), chrono_tz::UTC).unwrap();
        assert_eq!(
            driver
                .tick(&db, at(21, 9, 0, 0), chrono_tz::UTC)
                .unwrap()
                .len(),
            1
        );
        assert!(driver
            .tick(&db, at(21, 9, 0, 1), chrono_tz::UTC)
            .unwrap()
            .is_empty());
        assert!(driver
            .tick(&db, at(22, 9, 1, 0), chrono_tz::UTC)
            .unwrap()
            .is_empty());
        assert_eq!(
            store::latest_receipt(&db, "one").unwrap().unwrap().state,
            store::ReceiptState::Missed
        );
    }
}
