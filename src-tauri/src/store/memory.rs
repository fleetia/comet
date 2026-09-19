use super::{bump_revision, err, get, put, revision, Result};
use crate::types::{Memory, Message, Relationship};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

pub fn memories(conn: &Connection) -> Result<Vec<Memory>> {
    let mut stmt=conn.prepare("SELECT id,content,source,updated FROM memories WHERE deleted=0 ORDER BY updated DESC,id").map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Memory {
                id: r.get(0)?,
                content: r.get(1)?,
                source_message_id: r.get(2)?,
                updated_at: r.get(3)?,
            })
        })
        .map_err(err)?;
    rows.map(|r| r.map_err(err)).collect()
}
pub fn edit_memory(conn: &Connection, id: &str, content: &str) -> Result<()> {
    if content.trim().is_empty() || content.chars().count() > 500 {
        return Err("기억은 1~500자로 입력해 주세요.".into());
    }
    let tx = conn.unchecked_transaction().map_err(err)?;
    tx.execute(
        "UPDATE memories SET content=?2,locked=1,updated=?3 WHERE id=?1 AND deleted=0",
        params![id, content.trim(), chrono::Utc::now().timestamp_millis()],
    )
    .map_err(err)?;
    bump_revision(&tx)?;
    tx.commit().map_err(err)
}
pub fn delete_memory(conn: &Connection, id: &str) -> Result<()> {
    let tx = conn.unchecked_transaction().map_err(err)?;
    tx.execute("UPDATE memories SET deleted=1,locked=1 WHERE id=?", [id])
        .map_err(err)?;
    bump_revision(&tx)?;
    tx.commit().map_err(err)
}
pub fn relationships(conn: &Connection) -> Result<Vec<Relationship>> {
    ["a", "b"]
        .iter()
        .map(|p| {
            let character = crate::characters::active_character(conn, p)?;
            let sum: i32 = conn
                .query_row(
                    "SELECT COALESCE(SUM(delta),0) FROM character_affinity WHERE character_id=?",
                    [&character.id],
                    |r| r.get(0),
                )
                .map_err(err)?;
            Ok(Relationship {
                persona: (*p).into(),
                score: (20 + sum).clamp(0, 100),
            })
        })
        .collect()
}
fn last_analysis_id(conn: &Connection) -> Result<Option<String>> {
    get(conn, "last_analysis_id")
}
pub fn set_last_analysis_id(conn: &Connection, id: &str) -> Result<()> {
    put(conn, "last_analysis_id", &id)
}
pub fn pending_user_messages(conn: &Connection) -> Result<Vec<Message>> {
    let last = last_analysis_id(conn)?.unwrap_or_default();
    let mut stmt=conn.prepare("SELECT data FROM messages WHERE role='user' AND seq>COALESCE((SELECT seq FROM messages WHERE id=?),0) ORDER BY seq LIMIT 12").map_err(err)?;
    let rows = stmt
        .query_map([last], |r| r.get::<_, String>(0))
        .map_err(err)?;
    rows.map(|r| serde_json::from_str(&r.map_err(err)?).map_err(err))
        .collect()
}
fn field<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or("")
}
fn evidence(conn: &Connection, item: &Value) -> Result<Option<Message>> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT data FROM messages WHERE id=? AND role='user'",
            [field(item, "sourceMessageId")],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    let Some(raw) = raw else { return Ok(None) };
    let message: Message = serde_json::from_str(&raw).map_err(err)?;
    let quote = field(item, "evidence").trim();
    if message.status != "complete" || quote.chars().count() < 2 || !message.content.contains(quote)
    {
        return Ok(None);
    }
    Ok(Some(message))
}

pub fn analyze_apply(conn: &Connection, value: &Value) -> Result<()> {
    let tx = conn.unchecked_transaction().map_err(err)?;
    if value.get("revision").and_then(Value::as_i64) != Some(revision(&tx)?) {
        return Err("대화나 기억이 바뀌어 분석 결과를 버렸습니다.".into());
    }
    let mut changed = false;
    if let Some(items) = value.get("memories").and_then(Value::as_array) {
        for item in items.iter().take(8) {
            if field(item, "kind") != "user_fact"
                || item.get("certain").and_then(Value::as_bool) != Some(true)
            {
                continue;
            }
            let Some(source) = evidence(&tx, item)? else {
                continue;
            };
            // Retain the user's exact wording; the model's paraphrase is not trusted as a fact.
            let content = field(item, "evidence").trim();
            if content.chars().count() > 500 {
                continue;
            }
            let blocked:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM memories WHERE source=? AND (deleted=1 OR locked=1))",[&source.id],|r|r.get(0)).map_err(err)?;
            if blocked {
                continue;
            }
            let old = field(item, "supersedesId");
            if !old.is_empty() {
                if !["정정", "아니", "이제", "바뀌", "말고"]
                    .iter()
                    .any(|cue| source.content.contains(cue))
                {
                    continue;
                }
                let eligible:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM memories m JOIN messages old ON old.id=m.source JOIN messages new ON new.id=?2 WHERE m.id=?1 AND m.deleted=0 AND m.locked=0 AND old.seq<new.seq)",params![old,source.id],|r|r.get(0)).map_err(err)?;
                if !eligible {
                    continue;
                }
                changed |= tx
                    .execute("UPDATE memories SET deleted=1 WHERE id=?", [old])
                    .map_err(err)?
                    > 0;
            }
            let id = uuid::Uuid::new_v4().to_string();
            changed |= tx
                .execute(
                    "INSERT OR IGNORE INTO memories(id,content,source,updated) VALUES(?1,?2,?3,?4)",
                    params![
                        id,
                        content,
                        source.id,
                        chrono::Utc::now().timestamp_millis()
                    ],
                )
                .map_err(err)?
                > 0;
        }
    }
    if let Some(items) = value.get("events").and_then(Value::as_array) {
        for item in items.iter().take(24) {
            let persona = field(item, "persona");
            if !["a", "b"].contains(&persona)
                || item.get("certain").and_then(Value::as_bool) != Some(true)
            {
                continue;
            }
            let Some(source) = evidence(&tx, item)? else {
                continue;
            };
            if source.persona.as_deref() != Some(persona)
                && source.persona.as_deref() != Some("both")
            {
                continue;
            }
            let character_id: Option<String> = tx.query_row(
                "SELECT character_id FROM message_characters WHERE message_id=?1 AND persona=?2",
                params![source.id,persona], |r|r.get(0)).optional().map_err(err)?;
            let Some(character_id) = character_id else {
                continue;
            };
            let quote = field(item, "evidence").trim();
            // Conservative complete-utterance allowlist: ambiguous free speech never changes score.
            let normalized = source.content.trim().trim_end_matches(['!', '.', '~', ' ']);
            let delta = match (field(item, "kind"), normalized) {
                ("thanks", "고마워" | "고마워요" | "감사합니다") => 1,
                ("insult", "꺼져" | "멍청이") => -1,
                _ => continue,
            };
            if quote != source.content.trim() {
                continue;
            }
            let day = chrono::DateTime::from_timestamp_millis(source.created_at)
                .ok_or("잘못된 메시지 시간")?
                .date_naive()
                .to_string();
            let spent: i32 = tx
                .query_row(
                    "SELECT COALESCE(SUM(ABS(delta)),0) FROM character_affinity WHERE character_id=?1 AND day=?2 AND source NOT LIKE 'story:%'",
                    params![character_id, day],
                    |r| r.get(0),
                )
                .map_err(err)?;
            let fingerprint = field(item, "kind");
            let repeated:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM character_affinity WHERE character_id=?1 AND day=?2 AND fingerprint=?3 AND source NOT LIKE 'story:%')",params![character_id,day,fingerprint],|r|r.get(0)).map_err(err)?;
            if spent >= 3 || repeated {
                continue;
            }
            changed |= tx
                .execute(
                    "INSERT OR IGNORE INTO character_affinity VALUES(?1,?2,?3,?4,?5)",
                    params![source.id, character_id, day, delta, fingerprint],
                )
                .map_err(err)?
                > 0;
        }
    }
    if changed {
        bump_revision(&tx)?;
    }
    tx.commit().map_err(err)
}
