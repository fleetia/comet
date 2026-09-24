use super::{bump_revision, err, get, put, Result};
use crate::types::UserIdentity;
use rusqlite::{params, Connection, OptionalExtension};

pub const MEMORY_LIFETIME_MILLIS: i64 = 90 * 24 * 60 * 60 * 1000;

fn add_column(conn: &Connection, table: &str, column: &str, definition: &str) -> Result<()> {
    let exists: bool = conn
        .query_row(
            &format!("SELECT EXISTS(SELECT 1 FROM pragma_table_info('{table}') WHERE name=?1)"),
            [column],
            |row| row.get(0),
        )
        .map_err(err)?;
    if !exists {
        conn.execute_batch(&format!(
            "ALTER TABLE {table} ADD COLUMN {column} {definition}"
        ))
        .map_err(err)?;
    }
    Ok(())
}

pub(super) fn initialize(conn: &Connection) -> Result<()> {
    let tx = conn.unchecked_transaction().map_err(err)?;
    tx.execute_batch("CREATE TABLE IF NOT EXISTS user_identities(id TEXT PRIMARY KEY,name TEXT NOT NULL,started_at INTEGER NOT NULL,ended_at INTEGER);
        INSERT OR IGNORE INTO user_identities VALUES('legacy-user','',0,NULL);
        CREATE TABLE IF NOT EXISTS message_users(message_id TEXT PRIMARY KEY,user_id TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS message_presentations(message_id TEXT PRIMARY KEY,shown_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS memory_exclusions(character_id TEXT NOT NULL,user_id TEXT NOT NULL,source TEXT NOT NULL,PRIMARY KEY(character_id,user_id,source));
        CREATE TABLE IF NOT EXISTS recall_contexts(key TEXT PRIMARY KEY,user_id TEXT NOT NULL,valid_until INTEGER);
        CREATE TABLE IF NOT EXISTS recall_dependencies(key TEXT NOT NULL,memory_id TEXT NOT NULL,content_version INTEGER NOT NULL,PRIMARY KEY(key,memory_id));
        CREATE TABLE IF NOT EXISTS recall_sources(key TEXT NOT NULL,message_id TEXT NOT NULL,character_id TEXT NOT NULL,user_id TEXT NOT NULL,PRIMARY KEY(key,message_id,character_id));")
        .map_err(err)?;
    for (column, definition) in [
        ("character_id", "TEXT NOT NULL DEFAULT ''"),
        ("user_id", "TEXT NOT NULL DEFAULT 'legacy-user'"),
        ("kind", "TEXT NOT NULL DEFAULT 'user_fact'"),
        ("source_text", "TEXT NOT NULL DEFAULT ''"),
        ("source_created_at", "INTEGER NOT NULL DEFAULT 0"),
        ("expired", "INTEGER NOT NULL DEFAULT 0"),
        ("required_chapter", "INTEGER"),
    ] {
        add_column(&tx, "memories", column, definition)?;
    }
    add_column(
        &tx,
        "character_affinity",
        "user_id",
        "TEXT NOT NULL DEFAULT 'legacy-user'",
    )?;
    if get::<bool>(&tx, "memory_ownership_v1")? != Some(true) {
        tx.execute_batch(
            "DROP INDEX IF EXISTS memory_evidence;
            INSERT OR IGNORE INTO message_users SELECT id,'legacy-user' FROM messages;",
        )
        .map_err(err)?;
        let originals: Vec<(String, String)> = {
            let mut statement = tx.prepare("SELECT id,source FROM memories").map_err(err)?;
            let rows = statement
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
                .map_err(err)?;
            rows.collect::<rusqlite::Result<_>>().map_err(err)?
        };
        for (id, source) in originals {
            let targets = super::messages::message_targets(&tx, &source)?;
            let mut targets = targets
                .into_iter()
                .collect::<std::collections::BTreeSet<_>>();
            let first = targets.pop_first().unwrap_or_default();
            tx.execute("UPDATE memories SET character_id=?2,source_text=COALESCE((SELECT json_extract(data,'$.content') FROM messages WHERE id=source),content),source_created_at=COALESCE((SELECT json_extract(data,'$.createdAt') FROM messages WHERE id=source),updated) WHERE id=?1", params![id,first]).map_err(err)?;
            for target in targets {
                tx.execute("INSERT INTO memories(id,content,source,updated,deleted,locked,content_version,character_id,user_id,kind,source_text,source_created_at,expired,required_chapter)
                    SELECT ?2,content,source,updated,deleted,locked,content_version,?3,user_id,kind,source_text,source_created_at,expired,required_chapter FROM memories WHERE id=?1",
                    params![id,uuid::Uuid::new_v4().to_string(),target]).map_err(err)?;
            }
        }
        tx.execute_batch("INSERT OR IGNORE INTO memory_exclusions SELECT character_id,user_id,source FROM memories WHERE deleted=1 OR locked=1;")
            .map_err(err)?;
        put(&tx, "active_user_id", &"legacy-user")?;
        put(&tx, "memory_ownership_v1", &true)?;
    }
    tx.execute_batch("CREATE UNIQUE INDEX IF NOT EXISTS memory_evidence ON memories(source,content,character_id,user_id);
        CREATE INDEX IF NOT EXISTS memory_owner ON memories(character_id,user_id,deleted,expired);
        CREATE INDEX IF NOT EXISTS affinity_user ON character_affinity(character_id,user_id);")
        .map_err(err)?;
    tx.commit().map_err(err)
}

pub fn active_user_id(conn: &Connection) -> Result<String> {
    Ok(get(conn, "active_user_id")?.unwrap_or_else(|| "legacy-user".into()))
}

pub fn user_identity(conn: &Connection, id: &str) -> Result<Option<UserIdentity>> {
    conn.query_row(
        "SELECT id,name,started_at,ended_at FROM user_identities WHERE id=?1",
        [id],
        |r| {
            Ok(UserIdentity {
                id: r.get(0)?,
                name: r.get(1)?,
                started_at: r.get(2)?,
                ended_at: r.get(3)?,
            })
        },
    )
    .optional()
    .map_err(err)
}

pub fn current_user(conn: &Connection) -> Result<Option<UserIdentity>> {
    Ok(user_identity(conn, &active_user_id(conn)?)?.filter(|user| !user.name.is_empty()))
}

#[cfg(test)]
pub fn require_user(conn: &Connection) -> Result<UserIdentity> {
    current_user(conn)?.ok_or_else(|| "먼저 어떻게 불러드릴지 이름을 알려 주세요.".into())
}

pub fn set_user_name(conn: &Connection, name: &str, at: i64) -> Result<bool> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 40 || name.chars().any(char::is_control) {
        return Err("이름은 줄바꿈 없이 1~40자로 입력해 주세요.".into());
    }
    let tx = conn.unchecked_transaction().map_err(err)?;
    let at = effective_memory_time(&tx, at)?;
    if let Some(current) = current_user(&tx)? {
        if current.name == name {
            return Ok(false);
        }
        tx.execute(
            "UPDATE user_identities SET ended_at=?2 WHERE id=?1 AND ended_at IS NULL",
            params![current.id, at],
        )
        .map_err(err)?;
        let id = uuid::Uuid::new_v4().to_string();
        tx.execute(
            "INSERT INTO user_identities VALUES(?1,?2,?3,NULL)",
            params![id, name, at],
        )
        .map_err(err)?;
        put(&tx, "active_user_id", &id)?;
    } else {
        let id = active_user_id(&tx)?;
        tx.execute(
            "UPDATE user_identities SET name=?2,started_at=?3 WHERE id=?1",
            params![id, name, at],
        )
        .map_err(err)?;
    }
    put(&tx, "memory_clock", &at)?;
    bump_revision(&tx)?;
    tx.commit().map_err(err)?;
    Ok(true)
}

pub fn message_user_id(conn: &Connection, id: &str) -> Result<String> {
    Ok(conn
        .query_row(
            "SELECT user_id FROM message_users WHERE message_id=?1",
            [id],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?
        .unwrap_or_else(|| "legacy-user".into()))
}

pub fn effective_memory_time(conn: &Connection, at: i64) -> Result<i64> {
    Ok(at.max(get::<i64>(conn, "memory_clock")?.unwrap_or(0)))
}

pub fn expire_memories(conn: &Connection, at: i64) -> Result<bool> {
    let tx = conn.unchecked_transaction().map_err(err)?;
    let at = effective_memory_time(&tx, at)?;
    put(&tx, "memory_clock", &at)?;
    let expired = tx.execute("UPDATE memories SET expired=1 WHERE expired=0 AND user_id IN (SELECT id FROM user_identities WHERE ended_at IS NOT NULL AND ended_at<=?1)", [at.saturating_sub(MEMORY_LIFETIME_MILLIS)]).map_err(err)? > 0;
    let deferred=tx.execute("UPDATE memory_analysis_jobs SET state='deferred',reason='former_user_expired',next_attempt_at=0 WHERE state='pending' AND message_id IN (SELECT mu.message_id FROM message_users mu JOIN user_identities u ON u.id=mu.user_id WHERE u.ended_at IS NOT NULL AND u.ended_at<=?1)",[at.saturating_sub(MEMORY_LIFETIME_MILLIS)]).map_err(err)?>0;
    let changed = expired || deferred;
    if changed {
        bump_revision(&tx)?;
        tx.execute("UPDATE kv SET value=CAST(CAST(value AS INTEGER)+1 AS TEXT) WHERE key='memory_revision'", []).map_err(err)?;
    }
    tx.commit().map_err(err)?;
    Ok(changed)
}

pub fn message_user_names(
    conn: &Connection,
    limit: usize,
) -> Result<std::collections::BTreeMap<String, String>> {
    let mut statement=conn.prepare("SELECT m.id,u.name FROM messages m JOIN message_users mu ON mu.message_id=m.id JOIN user_identities u ON u.id=mu.user_id ORDER BY m.seq DESC LIMIT ?1").map_err(err)?;
    let rows = statement
        .query_map([limit.min(1000) as i64], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(err)?;
    rows.collect::<rusqlite::Result<_>>().map_err(err)
}
