use chrono::{NaiveDate, NaiveTime};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;

type Result<T> = std::result::Result<T, String>;
fn err(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Repeat {
    Daily,
    Weekdays(Vec<u32>),
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum BuiltinSource {
    Schedule,
    Tasks,
    Weather,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum Source {
    Builtin(BuiltinSource),
    External {
        server_id: String,
        tool_name: String,
        input: Value,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Routine {
    pub id: String,
    pub name: String,
    pub time: String,
    pub repeat: Repeat,
    pub sources: Vec<Source>,
    pub enabled: bool,
    pub created_at: i64,
}

pub fn initialize(db: &Connection) -> Result<()> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS routines(id TEXT PRIMARY KEY, name TEXT NOT NULL, time TEXT NOT NULL, repeat TEXT NOT NULL, sources TEXT NOT NULL, enabled INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS routine_revision(slot INTEGER PRIMARY KEY CHECK(slot=1), revision INTEGER NOT NULL);
INSERT OR IGNORE INTO routine_revision VALUES(1,0);
CREATE TABLE IF NOT EXISTS routine_generations(routine_id TEXT PRIMARY KEY, generation INTEGER NOT NULL);
INSERT OR IGNORE INTO routine_generations SELECT id,0 FROM routines;
CREATE TRIGGER IF NOT EXISTS routine_insert_revision AFTER INSERT ON routines BEGIN UPDATE routine_revision SET revision=revision+1 WHERE slot=1; END;
CREATE TRIGGER IF NOT EXISTS routine_update_revision AFTER UPDATE ON routines WHEN OLD.name IS NOT NEW.name OR OLD.time IS NOT NEW.time OR OLD.repeat IS NOT NEW.repeat OR OLD.sources IS NOT NEW.sources OR OLD.enabled IS NOT NEW.enabled OR OLD.created_at IS NOT NEW.created_at BEGIN UPDATE routine_revision SET revision=revision+1 WHERE slot=1; END;
CREATE TRIGGER IF NOT EXISTS routine_delete_revision AFTER DELETE ON routines BEGIN UPDATE routine_revision SET revision=revision+1 WHERE slot=1; END;
CREATE TRIGGER IF NOT EXISTS routine_insert_generation AFTER INSERT ON routines BEGIN INSERT INTO routine_generations VALUES(NEW.id,1) ON CONFLICT(routine_id) DO UPDATE SET generation=generation+1; END;
CREATE TRIGGER IF NOT EXISTS routine_update_generation AFTER UPDATE ON routines WHEN OLD.name IS NOT NEW.name OR OLD.time IS NOT NEW.time OR OLD.repeat IS NOT NEW.repeat OR OLD.sources IS NOT NEW.sources OR OLD.enabled IS NOT NEW.enabled OR OLD.created_at IS NOT NEW.created_at BEGIN UPDATE routine_generations SET generation=generation+1 WHERE routine_id=NEW.id; END;
CREATE TRIGGER IF NOT EXISTS routine_delete_generation AFTER DELETE ON routines BEGIN UPDATE routine_generations SET generation=generation+1 WHERE routine_id=OLD.id; END;
CREATE TABLE IF NOT EXISTS routine_receipts(routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE, scheduled_date TEXT NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL, reason TEXT, claimed_at INTEGER, updated_at INTEGER NOT NULL, PRIMARY KEY(routine_id,scheduled_date));
CREATE TABLE IF NOT EXISTS routine_reports(id TEXT PRIMARY KEY, user_id TEXT NOT NULL, routine_id TEXT NOT NULL, scheduled_date TEXT NOT NULL, body TEXT NOT NULL, bubble TEXT NOT NULL, delivery TEXT NOT NULL, reason TEXT, is_read INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS routine_reports_user_created ON routine_reports(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS routine_observation(slot INTEGER PRIMARY KEY CHECK(slot=1), observed_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS routine_options(slot INTEGER PRIMARY KEY CHECK(slot=1), bubble_enabled INTEGER NOT NULL);
INSERT OR IGNORE INTO routine_options VALUES(1,1);").map_err(err)?;
    let tx = db.unchecked_transaction().map_err(err)?;
    let has_index: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='index' AND name='routine_reports_occurrence')", [], |row| row.get(0)).map_err(err)?;
    if !has_index {
        tx.execute_batch("CREATE TABLE IF NOT EXISTS routine_report_duplicates AS SELECT * FROM routine_reports WHERE 0;
INSERT INTO routine_report_duplicates(id,user_id,routine_id,scheduled_date,body,bubble,delivery,reason,is_read,created_at) SELECT id,user_id,routine_id,scheduled_date,body,bubble,delivery,reason,is_read,created_at FROM routine_reports WHERE rowid NOT IN (SELECT MIN(rowid) FROM routine_reports GROUP BY user_id,routine_id,scheduled_date);
DELETE FROM routine_reports WHERE rowid NOT IN (SELECT MIN(rowid) FROM routine_reports GROUP BY user_id,routine_id,scheduled_date);
CREATE UNIQUE INDEX routine_reports_occurrence ON routine_reports(user_id,routine_id,scheduled_date);").map_err(err)?;
    }
    let has_routine_name: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info('routine_reports') WHERE name='routine_name')",
            [],
            |row| row.get(0),
        )
        .map_err(err)?;
    if !has_routine_name {
        tx.execute(
            "ALTER TABLE routine_reports ADD COLUMN routine_name TEXT NOT NULL DEFAULT ''",
            [],
        )
        .map_err(err)?;
    }
    tx.commit().map_err(err)
}

pub fn bubble_enabled(db: &Connection) -> Result<bool> {
    db.query_row(
        "SELECT bubble_enabled FROM routine_options WHERE slot=1",
        [],
        |row| row.get(0),
    )
    .map_err(err)
}

#[allow(dead_code)]
pub fn set_bubble_enabled(db: &Connection, enabled: bool) -> Result<()> {
    db.execute(
        "UPDATE routine_options SET bubble_enabled=?1 WHERE slot=1",
        [enabled],
    )
    .map_err(err)?;
    Ok(())
}

pub fn revision(db: &Connection) -> Result<i64> {
    db.query_row(
        "SELECT revision FROM routine_revision WHERE slot=1",
        [],
        |r| r.get(0),
    )
    .map_err(err)
}

pub fn generation(db: &Connection, id: &str) -> Result<i64> {
    db.query_row(
        "SELECT generation FROM routine_generations WHERE routine_id=?1",
        [id],
        |row| row.get(0),
    )
    .map_err(err)
}

#[allow(dead_code)]
fn validate(routine: &Routine) -> Result<()> {
    let t = routine.time.as_bytes();
    if t.len() != 5
        || t[2] != b':'
        || !t
            .iter()
            .enumerate()
            .all(|(i, c)| i == 2 || c.is_ascii_digit())
        || NaiveTime::parse_from_str(&routine.time, "%H:%M").is_err()
    {
        return Err("시각을 HH:MM 형식으로 입력해 주세요.".into());
    }
    if let Repeat::Weekdays(days) = &routine.repeat {
        if days.is_empty() || days.iter().any(|day| !(1..=7).contains(day)) || {
            let mut unique = days.clone();
            unique.sort_unstable();
            unique.dedup();
            unique.len() != days.len()
        } {
            return Err("요일을 올바르게 선택해 주세요.".into());
        }
    }
    if routine.sources.len() > 5
        || routine
            .sources
            .iter()
            .filter(|s| matches!(s, Source::External { .. }))
            .count()
            > 3
    {
        return Err("재료는 5개까지, 바깥 재료는 3개까지 선택해 주세요.".into());
    }
    if routine.id.trim().is_empty() || routine.name.trim().is_empty() {
        return Err("루틴 이름을 입력해 주세요.".into());
    }
    Ok(())
}

#[allow(dead_code)]
pub fn save(db: &Connection, routine: &Routine) -> Result<()> {
    validate(routine)?;
    let tx = db.unchecked_transaction().map_err(err)?;
    let exists: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM routines WHERE id=?1)",
            [&routine.id],
            |r| r.get(0),
        )
        .map_err(err)?;
    let count: i64 = tx
        .query_row("SELECT count(*) FROM routines", [], |r| r.get(0))
        .map_err(err)?;
    if !exists && count >= 20 {
        return Err("루틴은 20개까지 만들 수 있어요.".into());
    }
    tx.execute("INSERT INTO routines(id,name,time,repeat,sources,enabled,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(id) DO UPDATE SET name=excluded.name,time=excluded.time,repeat=excluded.repeat,sources=excluded.sources,enabled=excluded.enabled", params![routine.id, routine.name, routine.time, serde_json::to_string(&routine.repeat).map_err(err)?, serde_json::to_string(&routine.sources).map_err(err)?, routine.enabled, routine.created_at]).map_err(err)?;
    tx.commit().map_err(err)
}

pub fn list(db: &Connection) -> Result<Vec<Routine>> {
    let mut q = db.prepare("SELECT id,name,time,repeat,sources,enabled,created_at FROM routines ORDER BY created_at,id").map_err(err)?;
    let rows = q
        .query_map([], |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get(5)?,
                r.get(6)?,
            ))
        })
        .map_err(err)?;
    rows.map(|row| {
        let (id, name, time, repeat, sources, enabled, created_at) = row.map_err(err)?;
        Ok(Routine {
            id,
            name,
            time,
            repeat: serde_json::from_str(&repeat).map_err(err)?,
            sources: serde_json::from_str(&sources).map_err(err)?,
            enabled,
            created_at,
        })
    })
    .collect()
}

#[allow(dead_code)]
pub fn delete(db: &Connection, id: &str) -> Result<()> {
    let tx = db.unchecked_transaction().map_err(err)?;
    tx.execute("UPDATE routine_reports SET delivery='reported',reason=CASE WHEN reason IS NULL OR reason='' THEN '루틴이 삭제되어 보고함으로 보냈어요.' ELSE reason || ' ' || '루틴이 삭제되어 보고함으로 보냈어요.' END WHERE routine_id=?1 AND delivery='summarized' AND EXISTS (SELECT 1 FROM routine_receipts WHERE routine_receipts.routine_id=routine_reports.routine_id AND routine_receipts.scheduled_date=routine_reports.scheduled_date AND routine_receipts.state='summarized')", [id]).map_err(err)?;
    tx.execute("DELETE FROM routine_receipts WHERE routine_id=?1", [id])
        .map_err(err)?;
    tx.execute("DELETE FROM routines WHERE id=?1", [id])
        .map_err(err)?;
    tx.commit().map_err(err)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReceiptState {
    Claimed,
    Read,
    Summarized,
    Delivered,
    Reported,
    Missed,
    Interrupted,
    Failed,
}
impl ReceiptState {
    fn as_str(self) -> &'static str {
        match self {
            Self::Claimed => "claimed",
            Self::Read => "read",
            Self::Summarized => "summarized",
            Self::Delivered => "delivered",
            Self::Reported => "reported",
            Self::Missed => "missed",
            Self::Interrupted => "interrupted",
            Self::Failed => "failed",
        }
    }
    fn allows(self, next: Self) -> bool {
        matches!(
            (self, next),
            (Self::Claimed, Self::Read | Self::Interrupted | Self::Failed)
                | (
                    Self::Read,
                    Self::Summarized | Self::Reported | Self::Interrupted | Self::Failed
                )
                | (
                    Self::Summarized,
                    Self::Delivered | Self::Reported | Self::Interrupted | Self::Failed
                )
                | (Self::Delivered, Self::Reported)
        )
    }

    fn parse(value: &str) -> Result<Self> {
        match value {
            "claimed" => Ok(Self::Claimed),
            "read" => Ok(Self::Read),
            "summarized" => Ok(Self::Summarized),
            "delivered" => Ok(Self::Delivered),
            "reported" => Ok(Self::Reported),
            "missed" => Ok(Self::Missed),
            "interrupted" => Ok(Self::Interrupted),
            "failed" => Ok(Self::Failed),
            _ => Err("루틴 회차의 상태를 읽을 수 없어요.".into()),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Receipt {
    pub routine_id: String,
    pub scheduled_date: NaiveDate,
    pub state: ReceiptState,
    pub attempts: i64,
    pub reason: Option<String>,
    pub updated_at: i64,
}

pub fn latest_receipt(db: &Connection, id: &str) -> Result<Option<Receipt>> {
    let row: Option<(String, String, i64, Option<String>, i64)> = db
        .query_row(
            "SELECT scheduled_date,state,attempts,reason,updated_at FROM routine_receipts WHERE routine_id=?1 ORDER BY scheduled_date DESC LIMIT 1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .optional()
        .map_err(err)?;
    row.map(|(day, state, attempts, reason, updated_at)| {
        Ok(Receipt {
            routine_id: id.to_owned(),
            scheduled_date: NaiveDate::parse_from_str(&day, "%Y-%m-%d").map_err(err)?,
            state: ReceiptState::parse(&state)?,
            attempts,
            reason,
            updated_at,
        })
    })
    .transpose()
}

pub fn claim(db: &Connection, id: &str, day: NaiveDate, now: i64) -> Result<bool> {
    db.execute("INSERT OR IGNORE INTO routine_receipts(routine_id,scheduled_date,state,attempts,claimed_at,updated_at) VALUES(?1,?2,'claimed',1,?3,?3)", params![id,day.to_string(),now]).map(|n| n == 1).map_err(err)
}
pub fn mark_missed(
    db: &Connection,
    id: &str,
    day: NaiveDate,
    now: i64,
    reason: &str,
) -> Result<bool> {
    db.execute("INSERT OR IGNORE INTO routine_receipts(routine_id,scheduled_date,state,attempts,reason,updated_at) VALUES(?1,?2,'missed',0,?3,?4)", params![id,day.to_string(),reason,now]).map(|n| n == 1).map_err(err)
}
#[allow(dead_code)]
pub fn receipt_exists(db: &Connection, id: &str, day: NaiveDate) -> Result<bool> {
    db.query_row(
        "SELECT EXISTS(SELECT 1 FROM routine_receipts WHERE routine_id=?1 AND scheduled_date=?2)",
        params![id, day.to_string()],
        |r| r.get(0),
    )
    .map_err(err)
}
pub fn transition(
    db: &Connection,
    id: &str,
    day: NaiveDate,
    from: ReceiptState,
    to: ReceiptState,
    now: i64,
    reason: Option<&str>,
) -> Result<()> {
    if !from.allows(to) {
        return Err("루틴 회차의 상태를 변경할 수 없어요.".into());
    }
    let changed = db.execute("UPDATE routine_receipts SET state=?1,reason=?2,updated_at=?3 WHERE routine_id=?4 AND scheduled_date=?5 AND state=?6", params![to.as_str(), reason, now, id, day.to_string(), from.as_str()]).map_err(err)?;
    if changed != 1 {
        return Err("루틴 회차의 상태를 변경할 수 없어요.".into());
    }
    Ok(())
}
pub fn interrupt_incomplete(db: &Connection, now: i64) -> Result<usize> {
    let tx = db.unchecked_transaction().map_err(err)?;
    tx.execute("UPDATE routine_reports SET delivery='reported',reason=CASE WHEN reason IS NULL OR reason='' THEN '앱이 종료되어 보고함으로 보냈어요.' ELSE reason || ' ' || '앱이 종료되어 보고함으로 보냈어요.' END WHERE delivery='summarized' AND EXISTS (SELECT 1 FROM routine_receipts WHERE routine_receipts.routine_id=routine_reports.routine_id AND routine_receipts.scheduled_date=routine_reports.scheduled_date AND routine_receipts.state='summarized')", []).map_err(err)?;
    let interrupted = tx.execute("UPDATE routine_receipts SET state='interrupted',reason='앱이 종료되어 중단됐어요.',updated_at=?1 WHERE state IN ('claimed','read')", [now]).map_err(err)?;
    let reported = tx.execute("UPDATE routine_receipts SET state='reported',reason=CASE WHEN reason IS NULL OR reason='' THEN '앱이 종료되어 보고함으로 보냈어요.' ELSE reason || ' ' || '앱이 종료되어 보고함으로 보냈어요.' END,updated_at=?1 WHERE state='summarized'", [now]).map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(interrupted + reported)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Report {
    pub id: String,
    pub user_id: String,
    pub routine_id: String,
    pub routine_name: String,
    pub scheduled_date: NaiveDate,
    pub body: String,
    pub bubble: String,
    pub delivery: String,
    pub reason: Option<String>,
    pub is_read: bool,
    pub created_at: i64,
}
fn truncate_body(body: &str) -> &str {
    let mut end = body.len().min(16 * 1024);
    while !body.is_char_boundary(end) {
        end -= 1;
    }
    &body[..end]
}
pub fn save_report(db: &Connection, report: &Report) -> Result<()> {
    if report.user_id.trim().is_empty() {
        return Err("사용자를 확인해 주세요.".into());
    }
    db.execute("INSERT INTO routine_reports(id,user_id,routine_id,routine_name,scheduled_date,body,bubble,delivery,reason,is_read,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)", params![report.id,report.user_id,report.routine_id,report.routine_name,report.scheduled_date.to_string(),truncate_body(&report.body),report.bubble,report.delivery,report.reason,report.is_read,report.created_at]).map_err(err)?;
    Ok(())
}

pub fn save_report_and_summarize(db: &Connection, report: &Report, now: i64) -> Result<()> {
    let tx = db.unchecked_transaction().map_err(err)?;
    save_report(&tx, report)?;
    transition(
        &tx,
        &report.routine_id,
        report.scheduled_date,
        ReceiptState::Read,
        ReceiptState::Summarized,
        now,
        report.reason.as_deref(),
    )?;
    prune_reports_inner(&tx, &report.user_id, now)?;
    tx.commit().map_err(err)
}

pub fn finish_report(
    db: &Connection,
    user_id: &str,
    routine_id: &str,
    day: NaiveDate,
    state: ReceiptState,
    now: i64,
    reason: Option<&str>,
) -> Result<()> {
    finish_report_inner(db, user_id, routine_id, day, state, now, reason, false)
}

pub(crate) fn finish_failed_playback(
    db: &Connection,
    user_id: &str,
    routine_id: &str,
    day: NaiveDate,
    now: i64,
) -> Result<()> {
    finish_report_inner(
        db,
        user_id,
        routine_id,
        day,
        ReceiptState::Reported,
        now,
        Some("말풍선을 전하지 못했어요."),
        true,
    )
}

#[allow(clippy::too_many_arguments)]
fn finish_report_inner(
    db: &Connection,
    user_id: &str,
    routine_id: &str,
    day: NaiveDate,
    state: ReceiptState,
    now: i64,
    reason: Option<&str>,
    allow_delivered: bool,
) -> Result<()> {
    if !matches!(state, ReceiptState::Delivered | ReceiptState::Reported) {
        return Err("루틴 보고의 상태를 변경할 수 없어요.".into());
    }
    let tx = db.unchecked_transaction().map_err(err)?;
    let existing_reason: Option<String> = tx.query_row(
        "SELECT reason FROM routine_reports WHERE user_id=?1 AND routine_id=?2 AND scheduled_date=?3",
        params![user_id,routine_id,day.to_string()], |row| row.get(0),
    ).map_err(err)?;
    let combined_reason = match (existing_reason.as_deref(), reason) {
        (Some(existing), Some(next)) if !existing.is_empty() && existing != next => {
            Some(format!("{existing} {next}"))
        }
        (Some(existing), _) if !existing.is_empty() => Some(existing.to_owned()),
        (_, Some(next)) => Some(next.to_owned()),
        _ => None,
    };
    let changed = tx.execute("UPDATE routine_reports SET delivery=?1,reason=?2 WHERE user_id=?3 AND routine_id=?4 AND scheduled_date=?5", params![state.as_str(),combined_reason,user_id,routine_id,day.to_string()]).map_err(err)?;
    if changed != 1 {
        return Err("루틴 보고를 찾을 수 없어요.".into());
    }
    let delivered = allow_delivered
        && tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM routine_receipts WHERE routine_id=?1 AND scheduled_date=?2 AND state='delivered')",
                params![routine_id, day.to_string()],
                |row| row.get::<_, bool>(0),
            )
            .map_err(err)?;
    let from = if delivered {
        ReceiptState::Delivered
    } else {
        ReceiptState::Summarized
    };
    transition(
        &tx,
        routine_id,
        day,
        from,
        state,
        now,
        combined_reason.as_deref(),
    )?;
    tx.commit().map_err(err)
}

pub(crate) fn mark_displayed(
    db: &Connection,
    routine_id: &str,
    user_id: &str,
    day: NaiveDate,
    now: i64,
) -> Result<()> {
    let tx = db.unchecked_transaction().map_err(err)?;
    let (state, reason): (String, Option<String>) = tx
        .query_row(
            "SELECT state,reason FROM routine_receipts WHERE routine_id=?1 AND scheduled_date=?2",
            params![routine_id, day.to_string()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(err)?;
    if state == "summarized" {
        let changed = tx.execute("UPDATE routine_reports SET delivery='delivered' WHERE user_id=?1 AND routine_id=?2 AND scheduled_date=?3", params![user_id,routine_id,day.to_string()]).map_err(err)?;
        if changed != 1 {
            return Err("루틴 보고를 찾을 수 없어요.".into());
        }
        transition(
            &tx,
            routine_id,
            day,
            ReceiptState::Summarized,
            ReceiptState::Delivered,
            now,
            reason.as_deref(),
        )?;
    } else if state != "delivered" {
        return Err("루틴 회차를 전할 수 없어요.".into());
    } else {
        let exists: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM routine_reports WHERE user_id=?1 AND routine_id=?2 AND scheduled_date=?3 AND delivery='delivered')", params![user_id,routine_id,day.to_string()], |row| row.get(0)).map_err(err)?;
        if !exists {
            return Err("루틴 보고를 찾을 수 없어요.".into());
        }
    }
    let local_day = chrono::DateTime::from_timestamp_millis(now)
        .ok_or("표시 시각을 확인할 수 없어요.")?
        .with_timezone(&chrono::Local)
        .date_naive()
        .to_string();
    tx.execute("INSERT INTO widget_preferences(key,value) VALUES('routine:spoken-day',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [local_day]).map_err(err)?;
    tx.commit().map_err(err)
}

pub(crate) fn spoken_on(db: &Connection, day: NaiveDate) -> Result<bool> {
    db.query_row(
        "SELECT EXISTS(SELECT 1 FROM widget_preferences WHERE key='routine:spoken-day' AND value=?1)",
        [day.to_string()],
        |row| row.get(0),
    ).map_err(err)
}
#[allow(dead_code)]
pub fn reports(db: &Connection, user_id: &str) -> Result<Vec<Report>> {
    let mut q = db.prepare("SELECT id,user_id,routine_id,scheduled_date,body,bubble,delivery,reason,is_read,created_at,routine_name FROM routine_reports WHERE user_id=?1 ORDER BY created_at DESC, rowid DESC").map_err(err)?;
    let rows = q
        .query_map([user_id], |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get::<_, String>(3)?,
                r.get(4)?,
                r.get(5)?,
                r.get(6)?,
                r.get(7)?,
                r.get(8)?,
                r.get(9)?,
                r.get(10)?,
            ))
        })
        .map_err(err)?;
    rows.map(|r| {
        let (
            id,
            user_id,
            routine_id,
            day,
            body,
            bubble,
            delivery,
            reason,
            is_read,
            created_at,
            routine_name,
        ) = r.map_err(err)?;
        Ok(Report {
            id,
            user_id,
            routine_id,
            routine_name,
            scheduled_date: NaiveDate::parse_from_str(&day, "%Y-%m-%d").map_err(err)?,
            body,
            bubble,
            delivery,
            reason,
            is_read,
            created_at,
        })
    })
    .collect()
}
pub fn last_observation(db: &Connection) -> Result<Option<i64>> {
    db.query_row(
        "SELECT observed_at FROM routine_observation WHERE slot=1",
        [],
        |row| row.get(0),
    )
    .optional()
    .map_err(err)
}

pub fn observe_at(db: &Connection, now: i64) -> Result<()> {
    db.execute("INSERT INTO routine_observation(slot,observed_at) VALUES(1,?1) ON CONFLICT(slot) DO UPDATE SET observed_at=excluded.observed_at", [now]).map_err(err)?;
    Ok(())
}

fn prune_reports_inner(db: &Connection, user_id: &str, now: i64) -> Result<()> {
    let open = "NOT EXISTS (SELECT 1 FROM routine_receipts WHERE routine_receipts.routine_id=routine_reports.routine_id AND routine_receipts.scheduled_date=routine_reports.scheduled_date AND routine_receipts.state='summarized')";
    db.execute(
        &format!("DELETE FROM routine_reports WHERE user_id=?1 AND created_at <= ?2 AND {open}"),
        params![user_id, now.saturating_sub(90_i64 * 24 * 60 * 60 * 1000)],
    )
    .map_err(err)?;
    db.execute(&format!("DELETE FROM routine_reports WHERE user_id=?1 AND rowid NOT IN (SELECT rowid FROM routine_reports WHERE user_id=?1 ORDER BY created_at DESC,rowid DESC LIMIT 300) AND {open}"), [user_id]).map_err(err)?;
    Ok(())
}

pub fn prune_reports(db: &Connection, user_id: &str, now: i64) -> Result<()> {
    let tx = db.unchecked_transaction().map_err(err)?;
    prune_reports_inner(&tx, user_id, now)?;
    tx.commit().map_err(err)
}

pub fn prune_all_reports(db: &Connection, now: i64) -> Result<()> {
    let users = {
        let mut query = db
            .prepare("SELECT DISTINCT user_id FROM routine_reports")
            .map_err(err)?;
        let rows = query
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(err)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?
    };
    for user in users {
        prune_reports(db, &user, now)?;
    }
    Ok(())
}

#[allow(dead_code)]
pub fn mark_report_read(db: &Connection, user_id: &str, id: &str) -> Result<bool> {
    db.execute(
        "UPDATE routine_reports SET is_read=1 WHERE user_id=?1 AND id=?2",
        params![user_id, id],
    )
    .map(|n| n == 1)
    .map_err(err)
}

pub fn delete_report(db: &Connection, user_id: &str, id: &str) -> Result<bool> {
    let tx = db.unchecked_transaction().map_err(err)?;
    let is_open: Option<bool> = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM routine_receipts WHERE routine_receipts.routine_id=routine_reports.routine_id AND routine_receipts.scheduled_date=routine_reports.scheduled_date AND routine_receipts.state='summarized') FROM routine_reports WHERE user_id=?1 AND id=?2",
        params![user_id, id], |row| row.get(0),
    ).optional().map_err(err)?;
    if is_open == Some(true) {
        return Err("아직 진행 중인 루틴의 보고는 삭제할 수 없어요.".into());
    }
    let deleted = tx
        .execute(
            "DELETE FROM routine_reports WHERE user_id=?1 AND id=?2",
            params![user_id, id],
        )
        .map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(deleted == 1)
}

pub fn clear_reports(db: &Connection, user_id: &str) -> Result<usize> {
    db.execute("DELETE FROM routine_reports WHERE user_id=?1 AND NOT EXISTS (SELECT 1 FROM routine_receipts WHERE routine_receipts.routine_id=routine_reports.routine_id AND routine_receipts.scheduled_date=routine_reports.scheduled_date AND routine_receipts.state='summarized')", [user_id]).map_err(err)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Connection {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        initialize(&db).unwrap();
        db
    }
    fn routine(id: &str) -> Routine {
        Routine {
            id: id.into(),
            name: "아침".into(),
            time: "08:30".into(),
            repeat: Repeat::Daily,
            sources: vec![Source::Builtin(BuiltinSource::Schedule)],
            enabled: true,
            created_at: 0,
        }
    }
    fn day() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 11, 21).unwrap()
    }
    fn report(id: &str, user: &str, created_at: i64) -> Report {
        Report {
            id: id.into(),
            user_id: user.into(),
            routine_id: id.into(),
            routine_name: "아침".into(),
            scheduled_date: day(),
            body: "본문".into(),
            bubble: "안녕".into(),
            delivery: "reported".into(),
            reason: None,
            is_read: false,
            created_at,
        }
    }
    #[test]
    fn receipts_claim_once_and_require_valid_transition() {
        let db = db();
        save(&db, &routine("r")).unwrap();
        assert!(claim(&db, "r", day(), 1).unwrap());
        assert!(!claim(&db, "r", day(), 2).unwrap());
        assert!(transition(
            &db,
            "r",
            day(),
            ReceiptState::Claimed,
            ReceiptState::Delivered,
            3,
            None
        )
        .is_err());
        transition(
            &db,
            "r",
            day(),
            ReceiptState::Claimed,
            ReceiptState::Read,
            3,
            None,
        )
        .unwrap();
        assert!(transition(
            &db,
            "r",
            day(),
            ReceiptState::Claimed,
            ReceiptState::Read,
            4,
            None
        )
        .is_err());
        transition(
            &db,
            "r",
            day(),
            ReceiptState::Read,
            ReceiptState::Summarized,
            4,
            None,
        )
        .unwrap();
        transition(
            &db,
            "r",
            day(),
            ReceiptState::Summarized,
            ReceiptState::Reported,
            5,
            Some("조용한 시간"),
        )
        .unwrap();
        assert!(receipt_exists(&db, "r", day()).unwrap());
        let another = day().succ_opt().unwrap();
        claim(&db, "r", another, 6).unwrap();
        transition(
            &db,
            "r",
            another,
            ReceiptState::Claimed,
            ReceiptState::Read,
            7,
            None,
        )
        .unwrap();
        transition(
            &db,
            "r",
            another,
            ReceiptState::Read,
            ReceiptState::Summarized,
            8,
            None,
        )
        .unwrap();
        transition(
            &db,
            "r",
            another,
            ReceiptState::Summarized,
            ReceiptState::Interrupted,
            9,
            None,
        )
        .unwrap();
        assert!(!claim(&db, "r", another, 10).unwrap());
    }
    #[test]
    fn interrupted_work_is_not_claimed_again() {
        let db = db();
        save(&db, &routine("r")).unwrap();
        claim(&db, "r", day(), 1).unwrap();
        let tomorrow = day().succ_opt().unwrap();
        claim(&db, "r", tomorrow, 2).unwrap();
        transition(
            &db,
            "r",
            tomorrow,
            ReceiptState::Claimed,
            ReceiptState::Read,
            3,
            None,
        )
        .unwrap();
        assert_eq!(interrupt_incomplete(&db, 4).unwrap(), 2);
        assert!(!claim(&db, "r", day(), 5).unwrap());
        let count: i64 = db
            .query_row(
                "SELECT count(*) FROM routine_receipts WHERE state='interrupted'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 2);
    }
    #[test]
    fn limits_and_revision() {
        let db = db();
        let mut r = routine("r");
        for time in ["8:30", "24:00", "12:60", "aa:bb"] {
            r.time = time.into();
            assert!(save(&db, &r).is_err());
        }
        r.time = "08:30".into();
        r.repeat = Repeat::Weekdays(vec![0]);
        assert!(save(&db, &r).is_err());
        r.repeat = Repeat::Weekdays(vec![1, 1]);
        assert!(save(&db, &r).is_err());
        r.repeat = Repeat::Daily;
        r.sources = vec![Source::Builtin(BuiltinSource::Schedule); 6];
        assert!(save(&db, &r).is_err());
        r.sources = vec![
            Source::External {
                server_id: "s".into(),
                tool_name: "t".into(),
                input: Value::Null
            };
            4
        ];
        assert!(save(&db, &r).is_err());
        r.sources = vec![Source::Builtin(BuiltinSource::Weather)];
        save(&db, &r).unwrap();
        assert_eq!(revision(&db).unwrap(), 1);
        save(&db, &r).unwrap();
        assert_eq!(revision(&db).unwrap(), 1);
        r.enabled = false;
        save(&db, &r).unwrap();
        assert_eq!(revision(&db).unwrap(), 2);
        for i in 1..20 {
            save(&db, &routine(&format!("r{i}"))).unwrap();
        }
        assert!(save(&db, &routine("over")).is_err());
        delete(&db, "r").unwrap();
        assert_eq!(revision(&db).unwrap(), 22);
    }

    #[test]
    fn generations_track_only_the_changed_routine_even_after_recreation() {
        let db = db();
        let mut first = routine("first");
        save(&db, &first).unwrap();
        save(&db, &routine("second")).unwrap();
        let initial = generation(&db, "first").unwrap();
        save(&db, &first).unwrap();
        assert_eq!(generation(&db, "first").unwrap(), initial);
        let mut second = routine("second");
        second.enabled = false;
        save(&db, &second).unwrap();
        assert_eq!(generation(&db, "first").unwrap(), initial);
        first.enabled = false;
        save(&db, &first).unwrap();
        first.enabled = true;
        save(&db, &first).unwrap();
        let changed = generation(&db, "first").unwrap();
        assert!(changed > initial);
        delete(&db, "first").unwrap();
        save(&db, &first).unwrap();
        assert!(generation(&db, "first").unwrap() > changed);
    }

    #[test]
    fn existing_routines_receive_a_generation_on_upgrade() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE routines(id TEXT PRIMARY KEY, name TEXT NOT NULL, time TEXT NOT NULL, repeat TEXT NOT NULL, sources TEXT NOT NULL, enabled INTEGER NOT NULL, created_at INTEGER NOT NULL);").unwrap();
        let old = routine("old");
        db.execute(
            "INSERT INTO routines VALUES(?1,?2,?3,?4,?5,?6,?7)",
            params![
                old.id,
                old.name,
                old.time,
                serde_json::to_string(&old.repeat).unwrap(),
                serde_json::to_string(&old.sources).unwrap(),
                old.enabled,
                old.created_at
            ],
        )
        .unwrap();
        initialize(&db).unwrap();
        assert_eq!(generation(&db, "old").unwrap(), 0);
        save(&db, &old).unwrap();
        assert_eq!(generation(&db, "old").unwrap(), 0);
        delete(&db, "old").unwrap();
        save(&db, &old).unwrap();
        assert!(generation(&db, "old").unwrap() > 0);
    }
    #[test]
    fn reports_are_user_scoped_truncated_and_pruned() {
        let db = db();
        let now = 100_i64 * 24 * 60 * 60 * 1000;
        let mut large = report("large", "a", now);
        large.body = format!("{}가", "x".repeat(16 * 1024 - 1));
        save_report(&db, &large).unwrap();
        assert_eq!(
            reports(&db, "a").unwrap()[0].body,
            "x".repeat(16 * 1024 - 1)
        );
        save_report(&db, &report("other", "b", 0)).unwrap();
        assert!(!mark_report_read(&db, "b", "large").unwrap());
        assert!(mark_report_read(&db, "a", "large").unwrap());
        assert!(reports(&db, "a").unwrap()[0].is_read);
        save_report(&db, &report("old", "a", now - 91 * 24 * 60 * 60 * 1000)).unwrap();
        for i in 0..300 {
            save_report(&db, &report(&format!("{i}"), "a", now + i)).unwrap();
        }
        prune_reports(&db, "a", now).unwrap();
        let a = reports(&db, "a").unwrap();
        assert_eq!(a.len(), 300);
        assert!(!a.iter().any(|r| r.id == "old" || r.id == "large"));
        assert_eq!(reports(&db, "b").unwrap().len(), 1);
    }
    #[test]
    fn report_age_limit_applies_independently_for_each_user() {
        let db = db();
        let day_ms = 24_i64 * 60 * 60 * 1000;
        let now = 100 * day_ms;
        save_report(&db, &report("older", "a", now - 90 * day_ms - 1)).unwrap();
        save_report(&db, &report("boundary", "a", now - 90 * day_ms)).unwrap();
        save_report(&db, &report("recent", "a", now - 90 * day_ms + 1)).unwrap();
        save_report(&db, &report("other", "b", now - 91 * day_ms)).unwrap();
        prune_reports(&db, "a", now).unwrap();
        let ids: Vec<_> = reports(&db, "a")
            .unwrap()
            .into_iter()
            .map(|r| r.id)
            .collect();
        assert_eq!(ids, vec!["recent"]);
        assert_eq!(reports(&db, "b").unwrap().len(), 1);
    }

    #[test]
    fn deletion_removes_receipts_but_keeps_reports() {
        let db = db();
        save(&db, &routine("r")).unwrap();
        claim(&db, "r", day(), 0).unwrap();
        save_report(&db, &report("report", "a", 0)).unwrap();
        delete(&db, "r").unwrap();
        assert!(!receipt_exists(&db, "r", day()).unwrap());
        assert_eq!(reports(&db, "a").unwrap().len(), 1);
    }

    #[test]
    fn pruning_preserves_open_report_and_deletion_closes_it() {
        let db = db();
        let now = 100 * 24 * 60 * 60 * 1000_i64;
        let day = NaiveDate::from_ymd_opt(2026, 1, 1).unwrap();
        let mut routine = routine("one");
        routine.created_at = 0;
        save(&db, &routine).unwrap();
        claim(&db, "one", day, 1).unwrap();
        transition(
            &db,
            "one",
            day,
            ReceiptState::Claimed,
            ReceiptState::Read,
            2,
            None,
        )
        .unwrap();
        let mut open = report("open", "a", 0);
        open.routine_id = "one".into();
        open.scheduled_date = day;
        open.delivery = "summarized".into();
        save_report_and_summarize(&db, &open, 3).unwrap();
        for index in 0..301 {
            save_report(&db, &report(&format!("closed-{index}"), "a", now + index)).unwrap();
        }
        prune_reports(&db, "a", now).unwrap();
        assert!(reports(&db, "a")
            .unwrap()
            .iter()
            .any(|item| item.id == "open"));
        delete(&db, "one").unwrap();
        let retained = reports(&db, "a").unwrap();
        let closed = retained.iter().find(|item| item.id == "open").unwrap();
        assert_eq!(closed.delivery, "reported");
        assert!(closed
            .reason
            .as_deref()
            .unwrap()
            .contains("루틴이 삭제되어"));
        assert!(latest_receipt(&db, "one").unwrap().is_none());
        prune_reports(&db, "a", now).unwrap();
        assert!(!reports(&db, "a")
            .unwrap()
            .iter()
            .any(|item| item.id == "open"));
    }

    #[test]
    fn report_occurrences_are_unique_and_existing_duplicates_are_preserved() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE routine_reports(id TEXT PRIMARY KEY, user_id TEXT NOT NULL, routine_id TEXT NOT NULL, scheduled_date TEXT NOT NULL, body TEXT NOT NULL, bubble TEXT NOT NULL, delivery TEXT NOT NULL, reason TEXT, is_read INTEGER NOT NULL, created_at INTEGER NOT NULL);").unwrap();
        db.execute("INSERT INTO routine_reports VALUES('first','a','first','2026-11-21','본문','안녕','reported',NULL,0,1)", []).unwrap();
        let mut duplicate = report("second", "a", 2);
        duplicate.routine_id = "first".into();
        db.execute("INSERT INTO routine_reports VALUES('second','a','first','2026-11-21','본문','안녕','reported',NULL,0,2)", []).unwrap();
        initialize(&db).unwrap();
        initialize(&db).unwrap();
        assert_eq!(reports(&db, "a").unwrap().len(), 1);
        assert_eq!(reports(&db, "a").unwrap()[0].routine_name, "");
        let archived: i64 = db
            .query_row("SELECT count(*) FROM routine_report_duplicates", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(archived, 1);
        assert!(save_report(&db, &duplicate).is_err());
        duplicate.user_id = "b".into();
        save_report(&db, &duplicate).unwrap();
    }

    #[test]
    fn report_and_receipt_are_atomic_and_recovered_on_restart() {
        let db = db();
        save(&db, &routine("r")).unwrap();
        claim(&db, "r", day(), 1).unwrap();
        let mut report = report("r", "a", 2);
        report.delivery = "summarized".into();
        assert!(save_report_and_summarize(&db, &report, 2).is_err());
        assert!(reports(&db, "a").unwrap().is_empty());
        transition(
            &db,
            "r",
            day(),
            ReceiptState::Claimed,
            ReceiptState::Read,
            3,
            None,
        )
        .unwrap();
        save_report_and_summarize(&db, &report, 4).unwrap();
        assert_eq!(
            latest_receipt(&db, "r").unwrap().unwrap().state,
            ReceiptState::Summarized
        );
        assert_eq!(interrupt_incomplete(&db, 5).unwrap(), 1);
        assert_eq!(
            latest_receipt(&db, "r").unwrap().unwrap().state,
            ReceiptState::Reported
        );
        assert_eq!(reports(&db, "a").unwrap()[0].delivery, "reported");
    }

    #[test]
    fn bubble_option_is_enabled_by_default_without_changing_revision() {
        let db = db();
        assert!(bubble_enabled(&db).unwrap());
        set_bubble_enabled(&db, false).unwrap();
        assert!(!bubble_enabled(&db).unwrap());
        assert_eq!(revision(&db).unwrap(), 0);
        initialize(&db).unwrap();
        assert!(!bubble_enabled(&db).unwrap());
    }

    #[test]
    fn only_displayed_reports_record_the_actual_local_day() {
        let db = db();
        crate::widgets::storage::initialize(&db).unwrap();
        let displayed = chrono::Local::now();
        let displayed_day = displayed.date_naive();
        let scheduled_day = displayed_day.pred_opt().unwrap();
        save(&db, &routine("r")).unwrap();
        claim(&db, "r", scheduled_day, 1).unwrap();
        transition(
            &db,
            "r",
            scheduled_day,
            ReceiptState::Claimed,
            ReceiptState::Read,
            2,
            None,
        )
        .unwrap();
        let mut report = report("r", "a", 3);
        report.scheduled_date = scheduled_day;
        report.delivery = "summarized".into();
        report.reason = Some("바깥 재료는 아직 읽을 수 없어요.".into());
        save_report_and_summarize(&db, &report, 3).unwrap();
        assert!(!spoken_on(&db, displayed_day).unwrap());
        mark_displayed(&db, "r", "a", scheduled_day, displayed.timestamp_millis()).unwrap();
        mark_displayed(&db, "r", "a", scheduled_day, displayed.timestamp_millis()).unwrap();
        assert!(mark_displayed(
            &db,
            "r",
            "another",
            scheduled_day,
            displayed.timestamp_millis()
        )
        .is_err());
        assert!(spoken_on(&db, displayed_day).unwrap());
        assert!(!spoken_on(&db, scheduled_day).unwrap());
        assert!(!spoken_on(&db, displayed_day.succ_opt().unwrap()).unwrap());
        assert_eq!(
            latest_receipt(&db, "r").unwrap().unwrap().state,
            ReceiptState::Delivered
        );
        assert_eq!(reports(&db, "a").unwrap()[0].delivery, "delivered");
        assert_eq!(
            latest_receipt(&db, "r").unwrap().unwrap().reason,
            report.reason
        );
        assert_eq!(reports(&db, "a").unwrap()[0].reason, report.reason);
    }
}
