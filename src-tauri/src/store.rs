#[path = "store/memory.rs"]
mod memory;
#[path = "store/messages.rs"]
mod messages;

pub use memory::{
    analyze_apply, delete_memory, edit_memory, memories, pending_user_messages, relationships,
    set_last_analysis_id,
};
#[cfg(test)]
pub use messages::insert_message_with_talk;
pub use messages::{
    context_messages, context_messages_for, expire_generated_recall, insert_message,
    insert_message_with_source, message_identities, message_targets, messages, resume_conversation,
    MessageIdentity,
};
use messages::{initialize_identities, initialize_message_context};

use crate::types::*;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{de::DeserializeOwned, Serialize};
use std::path::Path;

type Result<T> = std::result::Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

pub fn open(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path).map_err(err)?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,role TEXT NOT NULL,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS memories(id TEXT PRIMARY KEY,content TEXT NOT NULL,source TEXT NOT NULL,updated INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,locked INTEGER NOT NULL DEFAULT 0);
CREATE UNIQUE INDEX IF NOT EXISTS memory_evidence ON memories(source,content);
CREATE TABLE IF NOT EXISTS scenes(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS affinity(source TEXT NOT NULL,persona TEXT NOT NULL,day TEXT NOT NULL,delta INTEGER NOT NULL,fingerprint TEXT NOT NULL,PRIMARY KEY(source,persona));
CREATE TABLE IF NOT EXISTS talk_history(scene_key TEXT PRIMARY KEY,shown_at INTEGER NOT NULL);
INSERT OR IGNORE INTO kv VALUES('revision','0');").map_err(err)?;
    crate::wordbook::initialize(&conn)?;
    crate::characters::initialize(&conn)?;
    initialize_identities(&conn)?;
    initialize_message_context(&conn)?;
    crate::widgets::storage::initialize(&conn)?;
    Ok(conn)
}

fn get<T: DeserializeOwned>(conn: &Connection, key: &str) -> Result<Option<T>> {
    let raw: Option<String> = conn
        .query_row("SELECT value FROM kv WHERE key=?", [key], |r| r.get(0))
        .optional()
        .map_err(err)?;
    raw.map(|v| serde_json::from_str(&v).map_err(err))
        .transpose()
}
fn put<T: Serialize>(conn: &Connection, key: &str, value: &T) -> Result<()> {
    conn.execute(
        "INSERT INTO kv VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        params![key, serde_json::to_string(value).map_err(err)?],
    )
    .map_err(err)?;
    Ok(())
}
pub fn settings(conn: &Connection) -> Result<Settings> {
    Ok(get(conn, "settings")?.unwrap_or_default())
}
pub fn save_settings(conn: &Connection, value: &Settings) -> Result<()> {
    put(conn, "settings", value)
}
pub fn revision(conn: &Connection) -> Result<i64> {
    Ok(get(conn, "revision")?.unwrap_or(0))
}
pub fn bump_revision(conn: &Connection) -> Result<i64> {
    conn.execute(
        "UPDATE kv SET value=CAST(CAST(value AS INTEGER)+1 AS TEXT) WHERE key='revision'",
        [],
    )
    .map_err(err)?;
    conn.execute("DELETE FROM scenes", []).map_err(err)?;
    revision(conn)
}
pub fn prepared_scenes(conn: &Connection) -> Result<Vec<PreparedScene>> {
    let mut stmt = conn
        .prepare("SELECT data FROM scenes WHERE revision=? ORDER BY rowid LIMIT 3")
        .map_err(err)?;
    let rows = stmt
        .query_map([revision(conn)?], |r| r.get::<_, String>(0))
        .map_err(err)?;
    rows.map(|r| serde_json::from_str(&r.map_err(err)?).map_err(err))
        .collect()
}
pub fn add_scene(conn: &Connection, scene: &PreparedScene) -> Result<()> {
    if scene.revision != revision(conn)? {
        return Err("대화가 바뀌어 미리 만든 대사를 버렸습니다.".into());
    }
    conn.execute(
        "INSERT OR REPLACE INTO scenes VALUES(?1,?2,?3)",
        params![
            scene.id,
            scene.revision,
            serde_json::to_string(scene).map_err(err)?
        ],
    )
    .map_err(err)?;
    Ok(())
}
pub fn delete_scene(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM scenes WHERE id=?", [id])
        .map_err(err)?;
    Ok(())
}
pub fn window_position(conn: &Connection, label: &str) -> Result<Option<WindowPosition>> {
    get(conn, &format!("window:{label}"))
}
pub fn set_window_position(conn: &Connection, label: &str, pos: &WindowPosition) -> Result<()> {
    put(conn, &format!("window:{label}"), pos)
}

#[cfg(test)]
#[path = "store/tests.rs"]
mod tests;
