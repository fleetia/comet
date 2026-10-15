use super::{err, get, put, Result};
use crate::types::Message;
use rusqlite::{params, Connection};
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisStatus {
    pub pending: usize,
    pub deferred: usize,
    pub legacy_unverified: usize,
}

pub(super) fn initialize(conn: &Connection) -> Result<()> {
    let tx = conn.unchecked_transaction().map_err(err)?;
    tx.execute_batch("CREATE TABLE IF NOT EXISTS memory_analysis_jobs(
        message_id TEXT PRIMARY KEY REFERENCES messages(id),
        state TEXT NOT NULL CHECK(state IN ('pending','done','deferred','legacy_unverified')),
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL DEFAULT 0,
        reason TEXT
    ); CREATE INDEX IF NOT EXISTS memory_analysis_due ON memory_analysis_jobs(state,next_attempt_at);")
        .map_err(err)?;
    if get::<bool>(&tx, "memory_analysis_jobs_v1")? != Some(true) {
        let cursor: Option<String> = get(&tx, "last_analysis_id")?;
        tx.execute(
            "INSERT OR IGNORE INTO memory_analysis_jobs(message_id,state)
            SELECT id,CASE WHEN seq>COALESCE((SELECT seq FROM messages WHERE id=?1),0)
                THEN 'pending' ELSE 'legacy_unverified' END FROM messages WHERE role='user'",
            [cursor],
        )
        .map_err(err)?;
        put(&tx, "memory_analysis_jobs_v1", &true)?;
    }
    tx.commit().map_err(err)
}

pub fn analysis_status(conn: &Connection) -> Result<AnalysisStatus> {
    conn.query_row(
        "SELECT COALESCE(SUM(state='pending'),0),COALESCE(SUM(state='deferred'),0),
        COALESCE(SUM(state='legacy_unverified'),0) FROM memory_analysis_jobs",
        [],
        |row| {
            Ok(AnalysisStatus {
                pending: row.get(0)?,
                deferred: row.get(1)?,
                legacy_unverified: row.get(2)?,
            })
        },
    )
    .map_err(err)
}

pub fn pending_user_messages(conn: &Connection) -> Result<Vec<Message>> {
    let mut stmt = conn
        .prepare(
            "SELECT m.data FROM memory_analysis_jobs j JOIN messages m ON m.id=j.message_id
        WHERE j.state='pending' AND j.next_attempt_at<=?1 AND (SELECT user_id FROM message_users WHERE message_id=m.id)=(SELECT mu.user_id FROM memory_analysis_jobs first JOIN messages fm ON fm.id=first.message_id JOIN message_users mu ON mu.message_id=fm.id WHERE first.state='pending' AND first.next_attempt_at<=?1 ORDER BY fm.seq LIMIT 1) ORDER BY m.seq LIMIT 12",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map([chrono::Utc::now().timestamp_millis()], |row| {
            row.get::<_, String>(0)
        })
        .map_err(err)?;
    rows.map(|row| serde_json::from_str(&row.map_err(err)?).map_err(err))
        .collect()
}

// Tests exercise the legacy cursor; execution completes explicit submitted IDs instead.
#[cfg(test)]
pub fn set_last_analysis_id(conn: &Connection, id: &str) -> Result<()> {
    let tx = conn.unchecked_transaction().map_err(err)?;
    put(&tx, "last_analysis_id", &id)?;
    tx.execute("UPDATE memory_analysis_jobs SET state='done',reason=NULL WHERE state='pending'
        AND message_id IN (SELECT id FROM messages WHERE seq<=(SELECT seq FROM messages WHERE id=?1))", [id]).map_err(err)?;
    tx.commit().map_err(err)
}

pub fn defer_analysis(conn: &Connection, ids: &[String], reason: &str) -> Result<()> {
    let tx = conn.unchecked_transaction().map_err(err)?;
    for id in ids {
        tx.execute("UPDATE memory_analysis_jobs SET state='deferred',reason=?2 WHERE message_id=?1 AND state='pending'",
            params![id, reason]).map_err(err)?;
    }
    tx.commit().map_err(err)
}

pub fn analysis_failure(conn: &Connection, ids: &[String], now: i64) -> Result<()> {
    let tx = conn.unchecked_transaction().map_err(err)?;
    for id in ids {
        tx.execute(
            "UPDATE memory_analysis_jobs SET attempts=attempts+1,
            next_attempt_at=?2+CASE attempts WHEN 0 THEN 60000 WHEN 1 THEN 300000 ELSE 900000 END,
            state=CASE WHEN attempts>=3 THEN 'deferred' ELSE 'pending' END,
            reason=CASE WHEN attempts>=3 THEN 'retry_exhausted' ELSE 'analysis_failed' END
            WHERE message_id=?1 AND state='pending'",
            params![id, now],
        )
        .map_err(err)?;
    }
    tx.commit().map_err(err)
}

pub fn retry_deferred_analysis(conn: &Connection) -> Result<usize> {
    conn.execute("UPDATE memory_analysis_jobs SET state='pending',attempts=0,next_attempt_at=0,reason=NULL WHERE state='deferred' AND COALESCE(reason,'')!='former_user_expired'", [])
        .map_err(err)
}
