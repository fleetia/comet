use super::{active_user_id, err, Result};
use crate::types::Message;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConversationSession {
    pub id: String,
    pub user_id: String,
    pub participants: Vec<String>,
    pub status: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub draft: String,
    pub continued_from: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationMessages {
    pub messages: Vec<Message>,
    pub next_before: Option<i64>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub character_names: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub user_names: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub message_sources: BTreeMap<String, String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationView {
    pub session: ConversationSession,
    pub messages: Vec<Message>,
    pub next_before: Option<i64>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub character_names: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub user_names: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub message_sources: BTreeMap<String, String>,
}

const SESSION_FIELDS: &str =
    "id,user_id,participants,status,title,created_at,updated_at,draft,continued_from";

pub(super) fn initialize_conversations(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS conversation_sessions(
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES user_identities(id),
            participants TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('active','paused','ended')),
            title TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            draft TEXT NOT NULL DEFAULT '',
            continued_from TEXT REFERENCES conversation_sessions(id)
        );
        CREATE INDEX IF NOT EXISTS conversation_sessions_user
            ON conversation_sessions(user_id,updated_at DESC);
        CREATE UNIQUE INDEX IF NOT EXISTS conversation_sessions_active
            ON conversation_sessions(user_id) WHERE status='active';
        CREATE TABLE IF NOT EXISTS conversation_messages(
            conversation_id TEXT NOT NULL REFERENCES conversation_sessions(id),
            message_id TEXT NOT NULL REFERENCES messages(id),
            PRIMARY KEY(conversation_id,message_id)
        );
        CREATE INDEX IF NOT EXISTS conversation_messages_message
            ON conversation_messages(message_id);
        CREATE TABLE IF NOT EXISTS conversation_message_disclosure(
            message_id TEXT NOT NULL REFERENCES messages(id),
            nadir_id TEXT NOT NULL,
            level INTEGER NOT NULL CHECK(level BETWEEN 0 AND 2),
            PRIMARY KEY(message_id,nadir_id)
        );
        UPDATE conversation_sessions SET status='paused' WHERE status='active';",
    )
    .map_err(err)
}

fn session_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ConversationSession> {
    let participants: String = row.get(2)?;
    Ok(ConversationSession {
        id: row.get(0)?,
        user_id: row.get(1)?,
        participants: serde_json::from_str(&participants).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                2,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?,
        status: row.get(3)?,
        title: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
        draft: row.get(7)?,
        continued_from: row.get(8)?,
    })
}

pub fn conversation(conn: &Connection, id: &str) -> Result<ConversationSession> {
    conn.query_row(
        &format!("SELECT {SESSION_FIELDS} FROM conversation_sessions WHERE id=?1 AND user_id=?2"),
        params![id, active_user_id(conn)?],
        session_row,
    )
    .optional()
    .map_err(err)?
    .ok_or_else(|| "이 사용자의 대화를 찾을 수 없어요.".into())
}

pub fn active_conversation(conn: &Connection) -> Result<Option<ConversationSession>> {
    conn.query_row(
        &format!("SELECT {SESSION_FIELDS} FROM conversation_sessions WHERE user_id=?1 AND status='active'"),
        [active_user_id(conn)?],
        session_row,
    )
    .optional()
    .map_err(err)
}

pub fn conversations(conn: &Connection, character_id: &str) -> Result<Vec<ConversationSession>> {
    let mut statement = conn
        .prepare(&format!(
            "SELECT {SESSION_FIELDS} FROM conversation_sessions
         WHERE user_id=?1 AND EXISTS(SELECT 1 FROM json_each(participants) WHERE value=?2)
         ORDER BY updated_at DESC,rowid DESC"
        ))
        .map_err(err)?;
    let result = statement
        .query_map(params![active_user_id(conn)?, character_id], session_row)
        .map_err(err)?
        .collect::<rusqlite::Result<_>>()
        .map_err(err);
    result
}

fn active_participants(conn: &Connection, participants: &[String]) -> Result<Vec<String>> {
    if participants.is_empty() {
        return Err("대화할 캐릭터를 골라 주세요.".into());
    }
    let mut result = Vec::new();
    for participant in participants {
        let id = crate::characters::active_character(conn, participant)?.id;
        if !result.contains(&id) {
            result.push(id);
        }
    }
    Ok(result)
}

pub fn create_conversation(
    conn: &Connection,
    participants: &[String],
    seed_message_id: Option<&str>,
    continued_from: Option<&str>,
    at: i64,
) -> Result<ConversationSession> {
    let tx = conn.unchecked_transaction().map_err(err)?;
    let participants = active_participants(&tx, participants)?;
    if let Some(parent) = continued_from {
        let parent = conversation(&tx, parent)?;
        if parent.status != "ended" || parent.participants != participants {
            return Err("마친 대화의 같은 캐릭터와 이어서 이야기해 주세요.".into());
        }
    }
    let id = uuid::Uuid::new_v4().to_string();
    pause_conversations(&tx)?;
    tx.execute(
        "INSERT INTO conversation_sessions(id,user_id,participants,status,title,created_at,updated_at,continued_from)
         VALUES(?1,?2,?3,'active','새 대화',?4,?4,?5)",
        params![id, active_user_id(&tx)?, serde_json::to_string(&participants).map_err(err)?, at, continued_from],
    ).map_err(err)?;
    if let Some(seed) = seed_message_id {
        let message = attachable_message(&tx, &conversation(&tx, &id)?, seed, true)?;
        if message.role != "assistant" || message.status != "complete" {
            return Err("완성된 캐릭터의 말에 답장할 수 있어요.".into());
        }
        attach_conversation_message(&tx, &id, seed)?;
    }
    let result = conversation(&tx, &id)?;
    tx.commit().map_err(err)?;
    Ok(result)
}

pub fn pause_conversations(conn: &Connection) -> Result<()> {
    conn.execute(
        "UPDATE conversation_sessions SET status='paused' WHERE user_id=?1 AND status='active'",
        [active_user_id(conn)?],
    )
    .map_err(err)?;
    Ok(())
}

pub fn set_conversation_status(
    conn: &Connection,
    id: &str,
    status: &str,
    at: i64,
) -> Result<ConversationSession> {
    if !matches!(status, "active" | "paused" | "ended") {
        return Err("알 수 없는 대화 상태예요.".into());
    }
    let tx = conn.unchecked_transaction().map_err(err)?;
    let session = conversation(&tx, id)?;
    if session.status == "ended" && status != "ended" {
        return Err("마친 대화는 이어서 새 대화를 시작해 주세요.".into());
    }
    if status == "active" {
        active_participants(&tx, &session.participants)?;
        pause_conversations(&tx)?;
    }
    tx.execute(
        "UPDATE conversation_sessions SET status=?2,updated_at=MAX(updated_at,?3) WHERE id=?1",
        params![id, status, at],
    )
    .map_err(err)?;
    let result = conversation(&tx, id)?;
    tx.commit().map_err(err)?;
    Ok(result)
}

pub fn save_conversation_draft(conn: &Connection, id: &str, draft: &str) -> Result<()> {
    let session = conversation(conn, id)?;
    if session.status == "ended" {
        return Err("마친 대화에는 초안을 쓸 수 없어요.".into());
    }
    if draft.chars().count() > 2_000 {
        return Err("메시지는 2,000자 안으로 적어 주세요.".into());
    }
    conn.execute(
        "UPDATE conversation_sessions SET draft=?2 WHERE id=?1",
        params![id, draft],
    )
    .map_err(err)?;
    Ok(())
}

pub fn set_conversation_participants(
    conn: &Connection,
    id: &str,
    participants: &[String],
) -> Result<()> {
    let tx = conn.unchecked_transaction().map_err(err)?;
    let session = conversation(&tx, id)?;
    let participants = active_participants(&tx, participants)?;
    let started: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM conversation_messages cm JOIN messages m ON m.id=cm.message_id
         WHERE cm.conversation_id=?1 AND m.role='user')",
        [id], |row| row.get(0),
    ).map_err(err)?;
    if session.status != "active" || started || session.continued_from.is_some() {
        return Err("대화를 시작한 뒤에는 대화 상대를 바꿀 수 없어요.".into());
    }
    let missing_speaker: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM conversation_messages cm
         JOIN message_characters mc ON mc.message_id=cm.message_id
         WHERE cm.conversation_id=?1 AND mc.character_id NOT IN (SELECT value FROM json_each(?2)))",
            params![id, serde_json::to_string(&participants).map_err(err)?],
            |row| row.get(0),
        )
        .map_err(err)?;
    if missing_speaker {
        return Err("답장하려는 말을 한 캐릭터를 대화에 포함해 주세요.".into());
    }
    tx.execute(
        "UPDATE conversation_sessions SET participants=?2 WHERE id=?1",
        params![id, serde_json::to_string(&participants).map_err(err)?],
    )
    .map_err(err)?;
    tx.commit().map_err(err)
}

fn attachable_message(
    conn: &Connection,
    session: &ConversationSession,
    message_id: &str,
    require_participant: bool,
) -> Result<Message> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT m.data FROM messages m
         JOIN message_users mu ON mu.message_id=m.id
         JOIN message_context mc ON mc.message_id=m.id
         WHERE m.id=?1 AND mu.user_id=?2 AND m.role IN ('user','assistant')
         AND mc.source NOT IN ('story','archive','imported')
         AND ((?4=0 AND m.role='assistant') OR EXISTS(
             SELECT 1 FROM message_characters i WHERE i.message_id=m.id
             AND i.character_id IN (SELECT value FROM json_each(?3))))",
            params![
                message_id,
                session.user_id,
                serde_json::to_string(&session.participants).map_err(err)?,
                require_participant
            ],
            |row| row.get(0),
        )
        .optional()
        .map_err(err)?;
    serde_json::from_str(&raw.ok_or("이 대화에 연결할 수 있는 메시지를 찾지 못했어요.")?)
        .map_err(err)
}

// The message insertion transaction owns this operation so history and its link commit together.
pub fn attach_conversation_message(conn: &Connection, id: &str, message_id: &str) -> Result<()> {
    let session = conversation(conn, id)?;
    if session.status != "active" {
        return Err("지금 이어 가는 대화에만 메시지를 남길 수 있어요.".into());
    }
    let message = attachable_message(conn, &session, message_id, false)?;
    let first_input = message.role == "user" && !conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM conversation_messages cm JOIN messages m ON m.id=cm.message_id
         WHERE cm.conversation_id=?1 AND m.role='user')",
        [id], |row| row.get::<_, bool>(0),
    ).map_err(err)?;
    let inserted = conn
        .execute(
            "INSERT OR IGNORE INTO conversation_messages(conversation_id,message_id) VALUES(?1,?2)",
            params![id, message_id],
        )
        .map_err(err)?;
    if inserted == 0 {
        return Ok(());
    }
    let title = if first_input {
        message
            .content
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .chars()
            .take(48)
            .collect::<String>()
    } else {
        session.title
    };
    conn.execute(
        "UPDATE conversation_sessions SET title=?2,updated_at=MAX(updated_at,?3),
         draft=CASE WHEN ?4 THEN '' ELSE draft END WHERE id=?1",
        params![id, title, message.created_at, message.role == "user"],
    )
    .map_err(err)?;
    Ok(())
}

pub fn conversation_for_message(
    conn: &Connection,
    message_id: &str,
) -> Result<Option<ConversationSession>> {
    let id: Option<String> = conn.query_row(
        "SELECT s.id FROM conversation_sessions s JOIN conversation_messages cm ON cm.conversation_id=s.id
         WHERE cm.message_id=?1 AND s.user_id=?2 ORDER BY s.updated_at DESC,s.rowid DESC LIMIT 1",
        params![message_id, active_user_id(conn)?], |row| row.get(0),
    ).optional().map_err(err)?;
    id.map(|id| conversation(conn, &id)).transpose()
}

pub fn conversation_messages(
    conn: &Connection,
    id: &str,
    before: Option<i64>,
) -> Result<ConversationMessages> {
    let session = conversation(conn, id)?;
    let mut statement = conn.prepare(
        "SELECT m.seq,m.data FROM conversation_messages cm JOIN messages m ON m.id=cm.message_id
         JOIN message_users mu ON mu.message_id=m.id
         WHERE cm.conversation_id=?1 AND mu.user_id=?2 AND (?3 IS NULL OR m.seq<?3)
         AND (NOT EXISTS(SELECT 1 FROM message_playback p WHERE p.message_id=m.id)
             OR EXISTS(SELECT 1 FROM message_presentations p WHERE p.message_id=m.id))
         ORDER BY m.seq DESC LIMIT 101"
    ).map_err(err)?;
    let rows = statement
        .query_map(params![id, session.user_id, before], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(err)?;
    let mut rows = rows.collect::<rusqlite::Result<Vec<_>>>().map_err(err)?;
    let has_more = rows.len() > 100;
    rows.truncate(100);
    let next_before = if has_more {
        rows.last().map(|(seq, _)| *seq)
    } else {
        None
    };
    rows.reverse();
    let messages: Vec<Message> = rows
        .into_iter()
        .map(|(_, raw)| serde_json::from_str(&raw).map_err(err))
        .collect::<Result<_>>()?;
    let mut names = conn.prepare(
        "SELECT (SELECT name FROM message_characters WHERE message_id=?1 ORDER BY persona LIMIT 1),
         (SELECT u.name FROM message_users mu JOIN user_identities u ON u.id=mu.user_id WHERE mu.message_id=?1),
         (SELECT source FROM message_context WHERE message_id=?1)"
    ).map_err(err)?;
    let mut character_names = BTreeMap::new();
    let mut user_names = BTreeMap::new();
    let mut message_sources = BTreeMap::new();
    for message in &messages {
        let (character, user, source): (Option<String>, Option<String>, Option<String>) = names
            .query_row([&message.id], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })
            .map_err(err)?;
        if message.role == "assistant" {
            message_sources.insert(
                message.id.clone(),
                source.unwrap_or_else(|| "unknown".into()),
            );
        }
        if let Some(name) = character {
            character_names.insert(message.id.clone(), name);
        }
        if let Some(name) = user {
            user_names.insert(message.id.clone(), name);
        }
    }
    Ok(ConversationMessages {
        messages,
        next_before,
        character_names,
        user_names,
        message_sources,
    })
}

// Recovery is derived from immutable input IDs and presentation receipts. Do not
// persist a runtime error string, infer success from raw message status, or reroute.
pub fn conversation_reply_pending(conn: &Connection, id: &str) -> Result<bool> {
    let session = conversation(conn, id)?;
    if session.status == "ended" {
        return Ok(false);
    }
    let latest: Option<String> = conn
        .query_row(
            "SELECT m.id FROM conversation_messages cm JOIN messages m ON m.id=cm.message_id
         JOIN message_users mu ON mu.message_id=m.id
         WHERE cm.conversation_id=?1 AND mu.user_id=?2 AND m.role='user'
         ORDER BY m.seq DESC LIMIT 1",
            params![id, session.user_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(err)?;
    let Some(input) = latest else {
        return Ok(false);
    };
    let scene_length: Option<usize> = conn
        .query_row(
            "SELECT json_array_length(lines) FROM direct_reply_scenes WHERE message_id=?1",
            [&input],
            |row| row.get(0),
        )
        .optional()
        .map_err(err)?;
    if let Some(length) = scene_length {
        // A completed scene remains complete even after its recall revision changes.
        for index in 0..length {
            if !super::message_displayed(conn, &format!("scene:{input}:{index}"))? {
                return Ok(true);
            }
        }
        return Ok(false);
    }
    if super::has_turn_replies(conn, &input, "scene")? {
        // Legacy scenes have no saved line count; never guess missing lines or
        // present a completed historical wordbook reply as a failed model turn.
        return Ok(false);
    }
    for target in super::message_targets(conn, &input)? {
        if !super::message_displayed(conn, &format!("reply:{input}:{target}"))? {
            return Ok(true);
        }
    }
    Ok(false)
}

pub fn conversation_view(conn: &Connection, id: &str) -> Result<ConversationView> {
    let session = conversation(conn, id)?;
    let page = conversation_messages(conn, id, None)?;
    Ok(ConversationView {
        session,
        messages: page.messages,
        next_before: page.next_before,
        character_names: page.character_names,
        user_names: page.user_names,
        message_sources: page.message_sources,
    })
}

fn current_disclosure_levels(conn: &Connection) -> Result<BTreeMap<String, u8>> {
    let user = active_user_id(conn)?;
    let mut levels = BTreeMap::new();
    for character in crate::characters::active_members(conn)? {
        if character.definition.source_id != "nadir" {
            continue;
        }
        let score: i32 = conn.query_row(
            "SELECT 20+COALESCE(SUM(delta),0) FROM character_affinity WHERE character_id=?1 AND user_id=?2",
            params![character.id,user], |row| row.get(0),
        ).map_err(err)?;
        levels.insert(
            character.id.clone(),
            crate::story::disclosure_level(conn, &character.id, score.clamp(0, 100))?,
        );
    }
    Ok(levels)
}

pub fn record_conversation_disclosure(conn: &Connection, message_id: &str) -> Result<()> {
    for (nadir, level) in current_disclosure_levels(conn)? {
        conn.execute(
            "INSERT OR IGNORE INTO conversation_message_disclosure(message_id,nadir_id,level)
             SELECT id,?2,?3 FROM messages WHERE id=?1 AND role='assistant'",
            params![message_id, nadir, level],
        )
        .map_err(err)?;
    }
    Ok(())
}

pub fn conversation_message_allowed(
    conn: &Connection,
    message: &Message,
    persona: &str,
) -> Result<bool> {
    if message.status != "complete" || !matches!(message.role.as_str(), "user" | "assistant") {
        return Ok(false);
    }
    let target = crate::characters::active_character(conn, persona)?;
    let eligible: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM messages m
         JOIN message_users mu ON mu.message_id=m.id
         JOIN message_context mc ON mc.message_id=m.id
         WHERE m.id=?1 AND mu.user_id=?2 AND json_extract(m.data,'$.status')='complete'
         AND mc.source NOT IN ('story','archive','imported')
         AND NOT EXISTS(SELECT 1 FROM memory_exclusions e
             WHERE e.source=m.id AND e.character_id=?3 AND e.user_id=?2))",
            params![message.id, active_user_id(conn)?, target.id],
            |row| row.get(0),
        )
        .map_err(err)?;
    if !eligible || !super::recall_valid(conn, &message.id, chrono::Utc::now().timestamp_millis())?
    {
        return Ok(false);
    }
    if message.role != "assistant"
        || !matches!(target.definition.source_id.as_str(), "nadir" | "star-tail")
    {
        return Ok(true);
    }
    let disclosure = current_disclosure_levels(conn)?;
    let mut statement = conn
        .prepare("SELECT nadir_id,level FROM conversation_message_disclosure WHERE message_id=?1")
        .map_err(err)?;
    let recorded: BTreeMap<String, u8> = statement
        .query_map([&message.id], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(err)?
        .collect::<rusqlite::Result<_>>()
        .map_err(err)?;
    let missing_or_higher = disclosure
        .iter()
        .any(|(nadir, current)| *current < recorded.get(nadir).copied().unwrap_or(2));
    let retired_higher = recorded
        .iter()
        .any(|(nadir, level)| *level > disclosure.get(nadir).copied().unwrap_or(0));
    Ok(!missing_or_higher && !retired_higher)
}

pub fn conversation_context(conn: &Connection, id: &str, persona: &str) -> Result<Vec<Message>> {
    let session = conversation(conn, id)?;
    let character = crate::characters::active_character(conn, persona)?.id;
    if !session.participants.contains(&character) {
        return Err("이 대화에 참여하지 않은 캐릭터예요.".into());
    }
    let mut statement = conn.prepare(
        "SELECT DISTINCT m.seq,m.data FROM conversation_messages cm JOIN messages m ON m.id=cm.message_id
         JOIN conversation_sessions s ON s.id=cm.conversation_id
         JOIN message_users mu ON mu.message_id=m.id
         JOIN message_context mc ON mc.message_id=m.id
         WHERE (cm.conversation_id=?1 OR cm.conversation_id=?2)
         AND s.user_id=?3 AND mu.user_id=?3 AND json_extract(m.data,'$.status')='complete'
         AND mc.source NOT IN ('story','archive','imported')
         AND EXISTS(SELECT 1 FROM message_characters i WHERE i.message_id=m.id AND i.character_id=?4)
         AND NOT EXISTS(SELECT 1 FROM memory_exclusions e WHERE e.source=m.id AND e.character_id=?4 AND e.user_id=?3)
         ORDER BY m.seq DESC LIMIT 24"
    ).map_err(err)?;
    let candidates = statement
        .query_map(
            params![id, session.continued_from, session.user_id, character],
            |row| row.get::<_, String>(1),
        )
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    let mut messages = Vec::new();
    for raw in candidates.into_iter().rev() {
        let mut message: Message = serde_json::from_str(&raw).map_err(err)?;
        // Explicitly reopening a session may quote expired generated dialogue, but never
        // revives deleted/edited memories or changes the message's automatic recall state.
        if !conversation_message_allowed(conn, &message, persona)? {
            continue;
        }
        if matches!(message.persona.as_deref(), Some("a" | "b")) {
            message.persona = Some(character.clone());
        }
        messages.push(message);
    }
    Ok(messages)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store;
    use serde_json::json;
    use std::path::Path;

    fn message(id: &str, role: &str, persona: &str, content: &str) -> Message {
        Message {
            id: id.into(),
            role: role.into(),
            persona: Some(persona.into()),
            content: content.into(),
            expression: Some("happy".into()),
            created_at: chrono::Utc::now().timestamp_millis(),
            status: "complete".into(),
        }
    }

    fn start(conn: &Connection) -> ConversationSession {
        create_conversation(conn, &["builtin-a".into()], None, None, 1).unwrap()
    }

    fn append(conn: &Connection, session: &ConversationSession, message: &Message) {
        store::insert_message_with_source(conn, message, "llm", None, false).unwrap();
        attach_conversation_message(conn, &session.id, &message.id).unwrap();
    }

    fn ids(messages: &[Message]) -> Vec<&str> {
        messages.iter().map(|message| message.id.as_str()).collect()
    }

    #[test]
    fn conversation_origins_use_recorded_sources_and_preserve_missing_metadata() {
        let db = store::open(Path::new(":memory:")).unwrap();
        let session = start(&db);
        for (id, source) in [
            ("registered", "wordbook"),
            ("generated", "llm"),
            ("legacy", "unknown"),
        ] {
            let reply = message(id, "assistant", "a", "  원문 그대로\n\n  ");
            store::insert_message_with_source(&db, &reply, source, None, false).unwrap();
            attach_conversation_message(&db, &session.id, id).unwrap();
        }
        // A legacy row can be missing provenance. Reading it must not guess AI or a script.
        db.execute("DELETE FROM message_context WHERE message_id='legacy'", [])
            .unwrap();
        let input = message("input", "user", "a", "내가 적은 말");
        append(&db, &session, &input);
        let raw_before = serde_json::to_value(store::messages(&db, 10).unwrap()).unwrap();
        let view = conversation_view(&db, &session.id).unwrap();
        assert_eq!(view.message_sources["registered"], "wordbook");
        assert_eq!(view.message_sources["generated"], "llm");
        assert_eq!(view.message_sources["legacy"], "unknown");
        assert!(!view.message_sources.contains_key("input"));
        assert!(view.messages[..3]
            .iter()
            .all(|message| message.content == "  원문 그대로\n\n  "));
        assert_eq!(
            serde_json::to_value(store::messages(&db, 10).unwrap()).unwrap(),
            raw_before
        );
        let json = serde_json::to_value(&view).unwrap();
        assert_eq!(json["messageSources"]["legacy"], "unknown");
        let page = conversation_messages(&db, &session.id, None).unwrap();
        assert_eq!(page.message_sources, view.message_sources);
    }

    #[test]
    fn retry_display_unshown_raw_is_not_a_finished_conversation_reply() {
        let db = store::open(Path::new(":memory:")).unwrap();
        let session = start(&db);
        let input = message("input", "user", "a", "보여 줘");
        append(&db, &session, &input);
        let reply = message(
            "reply:input:builtin-a",
            "assistant",
            "builtin-a",
            "  아직 미표시  ",
        );
        let line = crate::types::SceneLine {
            persona: "builtin-a".into(),
            text: reply.content.clone(),
            expression: reply.expression.clone().unwrap(),
            motion: Default::default(),
        };
        store::insert_message_with_playback(&db, &reply, "llm", None, true, Some(&line)).unwrap();
        assert_eq!(
            ids(&conversation_view(&db, &session.id).unwrap().messages),
            ["input"]
        );
        assert_eq!(store::messages(&db, 10).unwrap().len(), 2);
        store::mark_message_displayed(&db, &reply.id, reply.created_at).unwrap();
        assert_eq!(
            ids(&conversation_view(&db, &session.id).unwrap().messages),
            ["input", reply.id.as_str()]
        );
    }

    #[test]
    fn sessions_pause_on_restart_and_keep_drafts_originals_and_affinity() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("conversations.sqlite");
        let db = store::open(&path).unwrap();
        let original = message("seed", "assistant", "a", "  반가워!\n 오늘 어때?  ");
        store::insert_message(&db, &original).unwrap();
        let first = create_conversation(&db, &["a".into()], Some("seed"), None, 1).unwrap();
        assert_eq!(first.participants, ["builtin-a"]);
        let input = message("first", "user", "a", "  잘 지냈어?\n 나는 좋아  ");
        append(&db, &first, &input);
        save_conversation_draft(&db, &first.id, "다음 이야기\n아직 쓰는 중").unwrap();
        let history = serde_json::to_value(store::messages(&db, 100).unwrap()).unwrap();
        let affinity = serde_json::to_value(store::relationships(&db).unwrap()).unwrap();
        drop(db);

        let db = store::open(&path).unwrap();
        assert!(active_conversation(&db).unwrap().is_none());
        let restored = conversation_view(&db, &first.id).unwrap();
        assert_eq!(restored.session.status, "paused");
        assert_eq!(restored.session.title, "잘 지냈어? 나는 좋아");
        assert_eq!(restored.session.draft, "다음 이야기\n아직 쓰는 중");
        assert_eq!(restored.messages[0].content, original.content);
        assert_eq!(restored.messages[1].content, input.content);
        assert_eq!(
            serde_json::to_value(store::messages(&db, 100).unwrap()).unwrap(),
            history
        );
        assert_eq!(
            serde_json::to_value(store::relationships(&db).unwrap()).unwrap(),
            affinity
        );
        set_conversation_status(&db, &first.id, "active", 3).unwrap();
        let second = start(&db);
        assert_eq!(conversation(&db, &first.id).unwrap().status, "paused");
        assert_eq!(active_conversation(&db).unwrap().unwrap().id, second.id);
        assert_eq!(
            conversation_for_message(&db, "seed").unwrap().unwrap().id,
            first.id
        );
    }

    #[test]
    fn user_ownership_and_invalid_seed_fail_without_pausing_current_session() {
        let db = store::open(Path::new(":memory:")).unwrap();
        store::set_user_name(&db, "민수", 1).unwrap();
        let first = start(&db);
        append(
            &db,
            &first,
            &message("old", "assistant", "a", "첫 사용자의 대화"),
        );
        assert!(!store::set_user_name(&db, "민수", 2).unwrap());
        assert!(store::set_user_name(&db, "", 2).is_err());
        assert_eq!(conversation(&db, &first.id).unwrap().status, "active");
        store::set_user_name(&db, "지연", 2).unwrap();
        let old_status: String = db
            .query_row(
                "SELECT status FROM conversation_sessions WHERE id=?1",
                [&first.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(old_status, "paused");
        assert!(active_conversation(&db).unwrap().is_none());
        assert!(conversation(&db, &first.id).is_err());
        assert!(conversation_messages(&db, &first.id, None).is_err());
        assert!(set_conversation_status(&db, &first.id, "active", 3).is_err());
        assert!(save_conversation_draft(&db, &first.id, "다른 사용자").is_err());
        assert!(conversation_for_message(&db, "old").unwrap().is_none());
        assert!(conversations(&db, "builtin-a").unwrap().is_empty());
        let current = start(&db);
        assert!(create_conversation(&db, &["a".into()], Some("old"), None, 3).is_err());
        assert!(attach_conversation_message(&db, &current.id, "old").is_err());
        assert_eq!(active_conversation(&db).unwrap().unwrap().id, current.id);
        store::insert_message(&db, &message("other", "assistant", "b", "다른 친구")).unwrap();
        assert!(create_conversation(&db, &["a".into()], Some("other"), None, 4).is_err());
        assert!(create_conversation(&db, &["missing".into()], None, None, 4).is_err());
        assert_eq!(active_conversation(&db).unwrap().unwrap().id, current.id);
    }

    #[test]
    fn pagination_uses_message_sequence_without_duplicates_or_losing_original_text() {
        let db = store::open(Path::new(":memory:")).unwrap();
        store::set_user_name(&db, "민수", 1).unwrap();
        let mut character = crate::characters::active_character(&db, "a").unwrap();
        let original_name = character.definition.name.clone();
        let session = start(&db);
        for index in 0..205 {
            let mut original = message(&index.to_string(), "assistant", "a", "  원문\n 그대로  ");
            original.created_at = 300 - index;
            append(&db, &session, &original);
        }
        character.definition.name = "바뀐 이름".into();
        crate::characters::save(&db, &character.id, &character.definition).unwrap();
        let newest = conversation_messages(&db, &session.id, None).unwrap();
        assert_eq!(newest.messages.len(), 100);
        assert_eq!(newest.messages.first().unwrap().id, "105");
        assert_eq!(newest.messages.last().unwrap().id, "204");
        let middle = conversation_messages(&db, &session.id, newest.next_before).unwrap();
        assert_eq!(middle.messages.first().unwrap().id, "5");
        assert_eq!(middle.messages.last().unwrap().id, "104");
        let oldest = conversation_messages(&db, &session.id, middle.next_before).unwrap();
        assert_eq!(ids(&oldest.messages), ["0", "1", "2", "3", "4"]);
        assert!(oldest.next_before.is_none());
        assert_eq!(oldest.character_names["0"], original_name);
        assert_eq!(oldest.user_names["0"], "민수");
        let view = conversation_view(&db, &session.id).unwrap();
        assert_eq!(view.character_names["204"], original_name);
        assert_eq!(view.user_names["204"], "민수");
        assert!(newest
            .messages
            .iter()
            .chain(&middle.messages)
            .chain(&oldest.messages)
            .all(|message| message.content == "  원문\n 그대로  "));
        let context = conversation_context(&db, &session.id, "a").unwrap();
        assert_eq!(context.len(), 24);
        assert_eq!(context.first().unwrap().id, "181");
    }

    #[test]
    fn ended_continuation_reads_only_its_immediate_parent_and_does_not_reopen_it() {
        let db = store::open(Path::new(":memory:")).unwrap();
        let first = start(&db);
        append(
            &db,
            &first,
            &message("grandparent", "assistant", "a", "처음 이야기"),
        );
        set_conversation_status(&db, &first.id, "ended", 2).unwrap();
        assert!(set_conversation_status(&db, &first.id, "active", 3).is_err());
        assert!(save_conversation_draft(&db, &first.id, "끝난 대화").is_err());
        assert!(attach_conversation_message(&db, &first.id, "grandparent").is_err());
        let second = create_conversation(&db, &["a".into()], None, Some(&first.id), 3).unwrap();
        assert!(set_conversation_participants(&db, &second.id, &["a".into(), "b".into()]).is_err());
        append(
            &db,
            &second,
            &message("parent", "assistant", "a", "이어진 이야기"),
        );
        assert_eq!(
            ids(&conversation_context(&db, &second.id, "a").unwrap()),
            ["grandparent", "parent"]
        );
        assert!(create_conversation(&db, &["a".into()], None, Some(&second.id), 4).is_err());
        set_conversation_status(&db, &second.id, "ended", 4).unwrap();
        assert!(create_conversation(&db, &["b".into()], None, Some(&second.id), 5).is_err());
        let third = create_conversation(&db, &["a".into()], None, Some(&second.id), 5).unwrap();
        append(
            &db,
            &third,
            &message("current", "assistant", "a", "지금 이야기"),
        );
        assert_eq!(
            ids(&conversation_context(&db, &third.id, "a").unwrap()),
            ["parent", "current"]
        );
        assert_eq!(conversation(&db, &first.id).unwrap().status, "ended");
    }

    #[test]
    fn explicit_context_can_quote_expired_dialogue_but_never_revives_excluded_memory() {
        let db = store::open(Path::new(":memory:")).unwrap();
        let session = start(&db);
        let source = message("fact", "user", "a", "나는 홍차를 좋아해");
        append(&db, &session, &source);
        store::analyze_apply_batch(
            &db,
            &json!({
                "revision":store::revision(&db).unwrap(),
                "memories":[{"kind":"user_fact","certain":true,"sourceMessageId":"fact",
                    "evidence":source.content,"supersedesId":""}],"events":[]
            }),
            &["fact".into()],
        )
        .unwrap();
        let memory = store::scoped_memory_page(&db, "builtin-a", 0, 50)
            .unwrap()
            .items
            .remove(0);
        append(
            &db,
            &session,
            &message("derived", "assistant", "a", "홍차가 좋구나"),
        );
        store::record_recall(
            &db,
            "derived",
            std::slice::from_ref(&memory),
            source.created_at,
        )
        .unwrap();
        append(
            &db,
            &session,
            &message("expired", "assistant", "a", "오래된 잡담"),
        );
        let expiry = source.created_at + super::super::messages::GENERATED_RECALL_MILLIS + 100;
        store::expire_generated_recall(&db, expiry).unwrap();
        assert!(!ids(&store::context_messages_for(&db, 100, "a").unwrap()).contains(&"expired"));
        assert!(ids(&conversation_context(&db, &session.id, "a").unwrap()).contains(&"expired"));
        store::delete_memory_for(&db, "builtin-a", &memory.id).unwrap();
        assert_eq!(
            ids(&conversation_context(&db, &session.id, "a").unwrap()),
            ["expired"]
        );
        let forgotten: i64 = db
            .query_row(
                "SELECT forgotten FROM message_context WHERE message_id='expired'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(forgotten, 1);
        assert_eq!(
            conversation_view(&db, &session.id).unwrap().messages.len(),
            3
        );
        assert!(store::scoped_memory_page(&db, "builtin-a", 0, 50)
            .unwrap()
            .items
            .is_empty());
    }

    #[test]
    fn story_archival_invalid_recall_and_other_character_are_never_context() {
        let db = store::open(Path::new(":memory:")).unwrap();
        let session = start(&db);
        for source in ["story", "archive", "imported"] {
            let original = message(source, "assistant", "a", "프롬프트에 넣지 않는 기록");
            store::insert_message_with_source(&db, &original, source, None, false).unwrap();
            assert!(attach_conversation_message(&db, &session.id, source).is_err());
            assert!(!conversation_message_allowed(&db, &original, "a").unwrap());
            assert!(create_conversation(&db, &["a".into()], Some(source), None, 1).is_err());
            db.execute(
                "INSERT INTO conversation_messages VALUES(?1,?2)",
                params![session.id, source],
            )
            .unwrap();
        }
        append(
            &db,
            &session,
            &message("other", "assistant", "b", "다른 캐릭터 대사"),
        );
        append(
            &db,
            &session,
            &message("invalid", "assistant", "a", "기억 유효기간 초과"),
        );
        db.execute(
            "INSERT INTO recall_contexts VALUES('invalid',?1,0)",
            [active_user_id(&db).unwrap()],
        )
        .unwrap();
        db.execute(
            "INSERT INTO character_archived_messages VALUES('archived',?1,'{}')",
            [active_user_id(&db).unwrap()],
        )
        .unwrap();
        let mut pending = message("pending", "assistant", "a", "아직 완성되지 않은 답변");
        pending.status = "pending".into();
        append(&db, &session, &pending);
        assert!(conversation_context(&db, &session.id, "a")
            .unwrap()
            .is_empty());
        assert!(conversation_context(&db, &session.id, "b").is_err());
        assert_eq!(
            conversation_messages(&db, &session.id, None)
                .unwrap()
                .messages
                .len(),
            6
        );
    }

    #[test]
    fn participants_can_change_only_before_first_user_turn_and_keep_seed_speaker() {
        let db = store::open(Path::new(":memory:")).unwrap();
        store::insert_message(&db, &message("seed", "assistant", "a", "안녕")).unwrap();
        let session = create_conversation(&db, &["a".into()], Some("seed"), None, 1).unwrap();
        assert!(set_conversation_participants(&db, &session.id, &["b".into()]).is_err());
        set_conversation_participants(&db, &session.id, &["a".into(), "b".into()]).unwrap();
        save_conversation_draft(&db, &session.id, &"가".repeat(2_000)).unwrap();
        assert!(save_conversation_draft(&db, &session.id, &"가".repeat(2_001)).is_err());
        append(
            &db,
            &session,
            &message("reply", "user", "both", "둘 다 안녕"),
        );
        assert!(set_conversation_participants(&db, &session.id, &["a".into()]).is_err());
        assert_eq!(conversation(&db, &session.id).unwrap().draft, "");
        assert_eq!(conversations(&db, "builtin-b").unwrap().len(), 1);
    }

    #[test]
    fn all_target_is_scoped_to_the_conversations_fixed_participants() {
        let db = store::open(Path::new(":memory:")).unwrap();
        let session = start(&db);
        store::insert_message(&db, &message("all", "user", "all", "모두 안녕")).unwrap();
        assert_eq!(store::message_targets(&db, "all").unwrap(), ["builtin-a"]);
        assert_eq!(
            ids(&conversation_context(&db, &session.id, "a").unwrap()),
            ["all"]
        );
        assert!(store::context_messages_for(&db, 100, "b")
            .unwrap()
            .is_empty());
        assert!(
            set_conversation_participants(&db, &session.id, &["a".into(), "b".into()]).is_err()
        );
    }

    #[test]
    fn disclosure_drop_keeps_current_stage_dialogue_but_excludes_higher_stage_and_legacy() {
        let db = store::open(Path::new(":memory:")).unwrap();
        let imported =
            crate::characters::import_pack(&db, &crate::characters::nadir_pack()).unwrap();
        let nadir = imported[0].id.clone();
        let star_tail = imported[1].id.clone();
        crate::characters::apply_roster(&db, vec![nadir.clone(), star_tail.clone()]).unwrap();
        let session =
            create_conversation(&db, &[nadir.clone(), star_tail.clone()], None, None, 1).unwrap();
        for (id, persona) in [
            ("ordinary-nadir", "a"),
            ("ordinary-star-tail", "b"),
            ("legacy", "a"),
        ] {
            append(
                &db,
                &session,
                &message(id, "assistant", persona, "오늘 하루 어땠어?"),
            );
        }
        db.execute(
            "DELETE FROM conversation_message_disclosure WHERE message_id='legacy'",
            [],
        )
        .unwrap();
        assert_eq!(
            ids(&conversation_context(&db, &session.id, &nadir).unwrap()),
            ["ordinary-nadir"]
        );
        assert_eq!(
            ids(&conversation_context(&db, &session.id, &star_tail).unwrap()),
            ["ordinary-star-tail"]
        );
        for _ in 0..2 {
            for seed in 0..5 {
                let request = crate::story::prepare(&db, "a", 7, seed).unwrap().unwrap();
                crate::story::answer(&db, &request, "listen", 7).unwrap();
            }
        }
        assert_eq!(current_disclosure_levels(&db).unwrap()[&nadir], 2);
        let sibling_reply = message(
            "reply:turn:nadir",
            "assistant",
            "a",
            "높은 공개 단계의 개인사",
        );
        append(&db, &session, &sibling_reply);
        assert!(conversation_message_allowed(&db, &sibling_reply, &star_tail).unwrap());
        append(
            &db,
            &session,
            &message(
                "high-star-tail",
                "assistant",
                "b",
                "높은 공개 단계의 이야기",
            ),
        );
        assert!(ids(&conversation_context(&db, &session.id, &nadir).unwrap()).contains(&"legacy"));
        db.execute(
            "INSERT INTO character_affinity(source,character_id,day,delta,fingerprint,user_id) VALUES('drop',?1,'today',-40,'test',?2)",
            params![nadir,active_user_id(&db).unwrap()],
        ).unwrap();
        assert_eq!(current_disclosure_levels(&db).unwrap()[&nadir], 0);
        record_conversation_disclosure(&db, &sibling_reply.id).unwrap();
        assert!(!conversation_message_allowed(&db, &sibling_reply, &star_tail).unwrap());
        let ordinary_sibling = message("ordinary-nadir", "assistant", "a", "오늘 하루 어땠어?");
        assert!(conversation_message_allowed(&db, &ordinary_sibling, &star_tail).unwrap());
        assert_eq!(
            ids(&conversation_context(&db, &session.id, &nadir).unwrap()),
            ["ordinary-nadir"]
        );
        assert_eq!(
            ids(&conversation_context(&db, &session.id, &star_tail).unwrap()),
            ["ordinary-star-tail"]
        );
        assert_eq!(
            conversation_view(&db, &session.id).unwrap().messages.len(),
            5
        );
        crate::characters::apply_roster(&db, vec![star_tail.clone()]).unwrap();
        assert_eq!(
            ids(&conversation_context(&db, &session.id, &star_tail).unwrap()),
            ["ordinary-star-tail"]
        );
    }

    #[test]
    fn pending_reply_tracks_each_original_model_recipient_and_display_receipt() {
        let db = store::open(Path::new(":memory:")).unwrap();
        let session = create_conversation(
            &db,
            &["builtin-a".into(), "builtin-b".into()],
            None,
            None,
            1,
        )
        .unwrap();
        append(
            &db,
            &session,
            &message("input", "user", "all", "  합성 질문\n보존  "),
        );
        for target in ["builtin-a", "builtin-b"] {
            assert!(conversation_reply_pending(&db, &session.id).unwrap());
            let id = format!("reply:input:{target}");
            append(
                &db,
                &session,
                &message(&id, "assistant", target, "합성 응답"),
            );
            assert!(
                conversation_reply_pending(&db, &session.id).unwrap(),
                "raw complete is not displayed"
            );
            store::mark_message_displayed(&db, &id, 2).unwrap();
        }
        assert!(!conversation_reply_pending(&db, &session.id).unwrap());
        store::bump_revision(&db).unwrap();
        assert!(
            !conversation_reply_pending(&db, &session.id).unwrap(),
            "completion does not expire with recall"
        );
    }

    #[test]
    fn pending_reply_counts_saved_scene_lines_without_rerouting_or_guessing_legacy_scenes() {
        let db = store::open(Path::new(":memory:")).unwrap();
        let session = start(&db);
        append(
            &db,
            &session,
            &message("input", "user", "a", "합성 단어장 질문"),
        );
        let lines: Vec<_> = ["  첫 줄\n  ", "둘째 줄"]
            .into_iter()
            .map(|text| crate::types::SceneLine {
                persona: "builtin-a".into(),
                text: text.into(),
                expression: "평온".into(),
                motion: Default::default(),
            })
            .collect();
        store::save_reply_scene(&db, "input", &lines).unwrap();
        for (index, line) in lines.iter().enumerate() {
            assert!(conversation_reply_pending(&db, &session.id).unwrap());
            let id = format!("scene:input:{index}");
            append(&db, &session, &message(&id, "assistant", "a", &line.text));
            assert!(conversation_reply_pending(&db, &session.id).unwrap());
            store::mark_message_displayed(&db, &id, 2).unwrap();
            if index == 0 {
                store::bump_revision(&db).unwrap();
                assert!(conversation_reply_pending(&db, &session.id).unwrap());
                assert!(
                    store::saved_reply_scene(&db, "input").is_err(),
                    "recovery must not bypass stale provenance"
                );
            }
        }
        assert!(!conversation_reply_pending(&db, &session.id).unwrap());
        store::bump_revision(&db).unwrap();
        assert!(!conversation_reply_pending(&db, &session.id).unwrap());
        db.execute(
            "DELETE FROM direct_reply_scenes WHERE message_id='input'",
            [],
        )
        .unwrap();
        assert!(
            !conversation_reply_pending(&db, &session.id).unwrap(),
            "legacy scene length is unknown"
        );
    }

    #[test]
    fn pending_reply_uses_latest_input_in_selected_session_and_checks_owner_and_ending() {
        let db = store::open(Path::new(":memory:")).unwrap();
        store::set_user_name(&db, "합성 사용자", 1).unwrap();
        let first = start(&db);
        assert!(!conversation_reply_pending(&db, &first.id).unwrap());
        append(
            &db,
            &first,
            &message("earlier-failed", "user", "a", "이전 질문"),
        );
        assert!(conversation_reply_pending(&db, &first.id).unwrap());
        append(
            &db,
            &first,
            &message("latest-complete", "user", "a", "새 질문"),
        );
        append(
            &db,
            &first,
            &message(
                "reply:latest-complete:builtin-a",
                "assistant",
                "a",
                "완료 답변",
            ),
        );
        store::mark_message_displayed(&db, "reply:latest-complete:builtin-a", 2).unwrap();
        assert!(!conversation_reply_pending(&db, &first.id).unwrap());
        let second = start(&db);
        append(
            &db,
            &second,
            &message("other-failed", "user", "a", "다른 대화"),
        );
        assert!(!conversation_reply_pending(&db, &first.id).unwrap());
        assert!(conversation_reply_pending(&db, &second.id).unwrap());
        set_conversation_status(&db, &second.id, "ended", 3).unwrap();
        assert!(!conversation_reply_pending(&db, &second.id).unwrap());
        store::set_user_name(&db, "다른 합성 사용자", 4).unwrap();
        assert!(conversation_reply_pending(&db, &first.id).is_err());
    }
}
