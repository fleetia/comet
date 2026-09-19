use super::{bump_revision, err, get, put, Result};
use crate::types::Message;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

pub(super) const GENERATED_RECALL_MILLIS: i64 = 30 * 60 * 1000;

pub(super) fn initialize_message_context(conn: &Connection) -> Result<()> {
    let tx = conn.unchecked_transaction().map_err(err)?;
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS message_context(
            message_id TEXT PRIMARY KEY REFERENCES messages(id),
            source TEXT NOT NULL,
            expires_at INTEGER,
            forgotten INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS message_context_expiry ON message_context(expires_at)
            WHERE forgotten=0 AND expires_at IS NOT NULL;",
    )
    .map_err(err)?;
    if get::<bool>(&tx, "message_context_v1")? != Some(true) {
        tx.execute(
            "INSERT OR IGNORE INTO message_context(message_id,source,expires_at)
             SELECT id,CASE WHEN role='user' THEN 'user' ELSE 'unknown' END,
                    CASE WHEN role='assistant' THEN json_extract(data,'$.createdAt')+?1 END
             FROM messages",
            [GENERATED_RECALL_MILLIS],
        )
        .map_err(err)?;
        put(&tx, "message_context_v1", &true)?;
    }
    tx.commit().map_err(err)
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MessageIdentity {
    pub message_id: String,
    pub persona: String,
    pub character_id: String,
    pub name: String,
    pub version: u32,
}

pub(super) fn initialize_identities(conn: &Connection) -> Result<()> {
    let tx = conn.unchecked_transaction().map_err(err)?;
    tx.execute_batch("CREATE TABLE IF NOT EXISTS message_characters(message_id TEXT NOT NULL,persona TEXT NOT NULL,character_id TEXT NOT NULL,name TEXT NOT NULL,version INTEGER NOT NULL,PRIMARY KEY(message_id,persona));
CREATE TABLE IF NOT EXISTS character_affinity(source TEXT NOT NULL,character_id TEXT NOT NULL,day TEXT NOT NULL,delta INTEGER NOT NULL,fingerprint TEXT NOT NULL,PRIMARY KEY(source,character_id));").map_err(err)?;
    if get::<bool>(&tx, "character_identity_v1")? != Some(true) {
        let originals: Vec<Message> = {
            let mut stmt = tx
                .prepare("SELECT data FROM messages ORDER BY seq")
                .map_err(err)?;
            let rows = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(err)?;
            rows.map(|r| serde_json::from_str(&r.map_err(err)?).map_err(err))
                .collect::<Result<_>>()?
        };
        for message in originals {
            for slot in message_slots(&message) {
                tx.execute(
                    "INSERT OR IGNORE INTO message_characters VALUES(?1,?2,?3,?4,?5)",
                    params![
                        message.id,
                        slot,
                        format!("builtin-{slot}"),
                        slot.to_uppercase(),
                        1_u32
                    ],
                )
                .map_err(err)?;
            }
        }
        tx.execute("INSERT OR IGNORE INTO character_affinity SELECT source,'builtin-'||persona,day,delta,fingerprint FROM affinity WHERE persona IN ('a','b')", []).map_err(err)?;
        put(&tx, "character_identity_v1", &true)?;
    }
    tx.commit().map_err(err)
}
fn message_slots(message: &Message) -> Vec<&'static str> {
    match message.persona.as_deref() {
        Some("a") => vec!["a"],
        Some("b") => vec!["b"],
        Some("both") if message.role == "user" => vec!["a", "b"],
        _ => vec![],
    }
}
pub fn message_identities(conn: &Connection, limit: usize) -> Result<Vec<MessageIdentity>> {
    let mut stmt = conn.prepare("SELECT i.message_id,i.persona,i.character_id,i.name,i.version FROM message_characters i JOIN messages m ON m.id=i.message_id WHERE m.seq IN (SELECT seq FROM messages ORDER BY seq DESC LIMIT ?) ORDER BY m.seq,i.persona").map_err(err)?;
    let rows = stmt
        .query_map([limit.min(1000) as i64], |r| {
            Ok(MessageIdentity {
                message_id: r.get(0)?,
                persona: r.get(1)?,
                character_id: r.get(2)?,
                name: r.get(3)?,
                version: r.get(4)?,
            })
        })
        .map_err(err)?;
    rows.map(|r| r.map_err(err)).collect()
}
pub fn messages(conn: &Connection, limit: usize) -> Result<Vec<Message>> {
    let mut stmt=conn.prepare("SELECT data FROM (SELECT seq,data FROM messages ORDER BY seq DESC LIMIT ?) ORDER BY seq").map_err(err)?;
    let rows = stmt
        .query_map([limit.min(1000) as i64], |r| r.get::<_, String>(0))
        .map_err(err)?;
    rows.map(|r| serde_json::from_str(&r.map_err(err)?).map_err(err))
        .collect()
}
#[cfg(test)]
pub fn context_messages(conn: &Connection, limit: usize) -> Result<Vec<Message>> {
    context_for_character(conn, limit, None)
}
pub fn context_messages_for(
    conn: &Connection,
    limit: usize,
    persona: &str,
) -> Result<Vec<Message>> {
    let character = crate::characters::active_character(conn, persona)?.id;
    context_for_character(conn, limit, Some(&character))
}
fn context_for_character(
    conn: &Connection,
    limit: usize,
    character: Option<&str>,
) -> Result<Vec<Message>> {
    let a = crate::characters::active_character(conn, "a")?.id;
    let b = crate::characters::active_character(conn, "b")?.id;
    let mut stmt = conn.prepare("SELECT data FROM (
        SELECT seq,data FROM messages AS message
        WHERE EXISTS (SELECT 1 FROM message_characters i WHERE i.message_id=message.id AND i.character_id IN (?2,?3) AND (?4 IS NULL OR i.character_id=?4))
        AND NOT EXISTS (SELECT 1 FROM message_context c WHERE c.message_id=message.id AND (c.forgotten=1 OR c.source='story'))
        AND (message.role!='user' OR NOT EXISTS (
            SELECT 1 FROM memories AS memory WHERE memory.source=message.id AND (memory.deleted=1 OR memory.locked=1)
        )) ORDER BY seq DESC LIMIT ?1) ORDER BY seq").map_err(err)?;
    let rows = stmt
        .query_map(params![limit.min(1000) as i64, a, b, character], |row| {
            row.get::<_, String>(0)
        })
        .map_err(err)?;
    let mut identity = conn
        .prepare("SELECT character_id FROM message_characters WHERE message_id=? AND persona=?")
        .map_err(err)?;
    rows.map(|row| {
        let mut message: Message = serde_json::from_str(&row.map_err(err)?).map_err(err)?;
        if let Some(slot @ ("a" | "b")) = message.persona.as_deref() {
            let id: String = identity
                .query_row(params![message.id, slot], |r| r.get(0))
                .map_err(err)?;
            message.persona = Some(if id == a { "a" } else { "b" }.into());
        }
        Ok(message)
    })
    .collect()
}
pub fn insert_message(conn: &Connection, message: &Message) -> Result<()> {
    insert_message_with_talk(conn, message, None)
}
pub fn insert_message_with_talk(
    conn: &Connection,
    message: &Message,
    scene_key: Option<&str>,
) -> Result<()> {
    let source = if scene_key.is_some() {
        "talk"
    } else {
        "unknown"
    };
    insert_message_with_source(conn, message, source, scene_key, false)
}

pub fn insert_message_with_source(
    conn: &Connection,
    message: &Message,
    source: &str,
    scene_key: Option<&str>,
    direct_reply: bool,
) -> Result<()> {
    let tx = conn.unchecked_transaction().map_err(err)?;
    let changed = tx
        .execute(
            "INSERT OR IGNORE INTO messages(id,role,data) VALUES(?1,?2,?3)",
            params![
                message.id,
                message.role,
                serde_json::to_string(message).map_err(err)?
            ],
        )
        .map_err(err)?;
    if changed > 0 {
        let source = if message.role == "user" {
            "user"
        } else {
            source
        };
        let expires_at = (message.role == "assistant" && matches!(source, "llm" | "unknown"))
            .then(|| message.created_at.saturating_add(GENERATED_RECALL_MILLIS));
        tx.execute(
            "INSERT INTO message_context(message_id,source,expires_at) VALUES(?1,?2,?3)",
            params![message.id, source, expires_at],
        )
        .map_err(err)?;
        for slot in message_slots(message) {
            let character = crate::characters::active_character(&tx, slot)?;
            tx.execute(
                "INSERT INTO message_characters VALUES(?1,?2,?3,?4,?5)",
                params![
                    message.id,
                    slot,
                    character.id,
                    character.definition.name,
                    character.definition.version
                ],
            )
            .map_err(err)?;
        }
        if message.role == "user" {
            forget_expired_messages(&tx, message.created_at)?;
            extend_generated_recall(&tx, message.created_at)?;
            bump_revision(&tx)?;
        } else if direct_reply {
            extend_generated_recall(&tx, message.created_at)?;
        }
        if let Some(key) = scene_key {
            tx.execute(
                "INSERT INTO talk_history(scene_key,shown_at) VALUES(?1,?2) ON CONFLICT(scene_key) DO UPDATE SET shown_at=excluded.shown_at",
                params![key, message.created_at],
            ).map_err(err)?;
        }
    }
    tx.commit().map_err(err)
}

fn forget_expired_messages(conn: &Connection, at: i64) -> Result<bool> {
    conn.execute(
        "UPDATE message_context SET forgotten=1 WHERE forgotten=0 AND expires_at<=?1",
        [at],
    )
    .map(|changed| changed > 0)
    .map_err(err)
}

fn extend_generated_recall(conn: &Connection, at: i64) -> Result<()> {
    conn.execute(
        "UPDATE message_context SET expires_at=MAX(expires_at,?1)
         WHERE forgotten=0 AND expires_at IS NOT NULL",
        [at.saturating_add(GENERATED_RECALL_MILLIS)],
    )
    .map_err(err)?;
    Ok(())
}

pub fn expire_generated_recall(conn: &Connection, at: i64) -> Result<bool> {
    let tx = conn.unchecked_transaction().map_err(err)?;
    let changed = forget_expired_messages(&tx, at)?;
    if changed {
        bump_revision(&tx)?;
    }
    tx.commit().map_err(err)?;
    Ok(changed)
}

pub fn resume_conversation(conn: &Connection, at: i64) -> Result<()> {
    let tx = conn.unchecked_transaction().map_err(err)?;
    if forget_expired_messages(&tx, at)? {
        bump_revision(&tx)?;
    }
    extend_generated_recall(&tx, at)?;
    tx.commit().map_err(err)
}
