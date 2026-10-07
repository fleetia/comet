use super::{bump_revision, err, get, put, Result};
use crate::types::{Message, SceneLine};
use rusqlite::{params, Connection, OptionalExtension};
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
            WHERE forgotten=0 AND expires_at IS NOT NULL;
        CREATE TABLE IF NOT EXISTS message_playback(
            message_id TEXT PRIMARY KEY REFERENCES messages(id),
            revision INTEGER NOT NULL,
            line TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS direct_reply_scenes(
            message_id TEXT PRIMARY KEY REFERENCES messages(id),
            revision INTEGER NOT NULL,
            lines TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ai_only_inputs(
            message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE
        );",
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
}

pub(super) fn initialize_identities(conn: &Connection) -> Result<()> {
    let tx = conn.unchecked_transaction().map_err(err)?;
    tx.execute_batch("CREATE TABLE IF NOT EXISTS message_characters(message_id TEXT NOT NULL,persona TEXT NOT NULL,character_id TEXT NOT NULL,name TEXT NOT NULL,PRIMARY KEY(message_id,persona));
CREATE TABLE IF NOT EXISTS character_affinity(source TEXT NOT NULL,character_id TEXT NOT NULL,day TEXT NOT NULL,delta INTEGER NOT NULL,fingerprint TEXT NOT NULL,PRIMARY KEY(source,character_id));
CREATE TABLE IF NOT EXISTS message_targets(message_id TEXT PRIMARY KEY,ids TEXT NOT NULL);").map_err(err)?;
    let has_version: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info('message_characters') WHERE name='version')",
            [],
            |row| row.get(0),
        )
        .map_err(err)?;
    if has_version {
        tx.execute_batch("ALTER TABLE message_characters DROP COLUMN version")
            .map_err(err)?;
    }
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
                    "INSERT OR IGNORE INTO message_characters(message_id,persona,character_id,name) VALUES(?1,?2,?3,?4)",
                    params![
                        message.id,
                        slot,
                        format!("builtin-{slot}"),
                        slot.to_uppercase()
                    ],
                )
                .map_err(err)?;
            }
        }
        tx.execute("INSERT OR IGNORE INTO character_affinity(source,character_id,day,delta,fingerprint) SELECT source,'builtin-'||persona,day,delta,fingerprint FROM affinity WHERE persona IN ('a','b')", []).map_err(err)?;
        put(&tx, "character_identity_v1", &true)?;
    }
    tx.commit().map_err(err)
}
fn message_slots(message: &Message) -> Vec<&str> {
    match message.persona.as_deref() {
        Some("a") => vec!["a"],
        Some("b") => vec!["b"],
        Some("both") if message.role == "user" => vec!["a", "b"],
        Some(id) if id != "all" => vec![id],
        _ => vec![],
    }
}
pub fn message_identities(conn: &Connection, limit: usize) -> Result<Vec<MessageIdentity>> {
    let mut stmt = conn.prepare("SELECT i.message_id,i.persona,i.character_id,i.name FROM message_characters i JOIN messages m ON m.id=i.message_id WHERE m.seq IN (SELECT seq FROM messages ORDER BY seq DESC LIMIT ?) ORDER BY m.seq,i.persona").map_err(err)?;
    let rows = stmt
        .query_map([limit.min(1000) as i64], |r| {
            Ok(MessageIdentity {
                message_id: r.get(0)?,
                persona: r.get(1)?,
                character_id: r.get(2)?,
                name: r.get(3)?,
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
    let ids = crate::characters::active_ids(conn)?;
    let roster_json = serde_json::to_string(&ids).map_err(err)?;
    let user_id = super::active_user_id(conn)?;
    let mut stmt = conn.prepare("SELECT data FROM (
        SELECT seq,data FROM messages AS message
        WHERE EXISTS (SELECT 1 FROM message_characters i WHERE i.message_id=message.id AND i.character_id IN (SELECT value FROM json_each(?2)) AND (?3 IS NULL OR i.character_id=?3)
            AND NOT EXISTS(SELECT 1 FROM memory_exclusions e WHERE e.source=message.id AND e.character_id=i.character_id AND e.user_id=?4))
        AND EXISTS(SELECT 1 FROM message_users mu WHERE mu.message_id=message.id AND mu.user_id=?4)
        AND NOT EXISTS (SELECT 1 FROM message_context c WHERE c.message_id=message.id AND (c.forgotten=1 OR c.source='story'))
        ORDER BY seq DESC LIMIT ?1) ORDER BY seq").map_err(err)?;
    let rows = stmt
        .query_map(
            params![limit.min(1000) as i64, roster_json, character, user_id],
            |row| row.get::<_, String>(0),
        )
        .map_err(err)?;
    let mut identity = conn
        .prepare("SELECT character_id FROM message_characters WHERE message_id=? AND persona=?")
        .map_err(err)?;
    let candidates = rows
        .map(|row| {
            let mut message: Message = serde_json::from_str(&row.map_err(err)?).map_err(err)?;
            if let Some(slot @ ("a" | "b")) = message.persona.as_deref() {
                let id: String = identity
                    .query_row(params![message.id, slot], |r| r.get(0))
                    .map_err(err)?;
                message.persona = Some(if character.is_some_and(|value| value == id) {
                    id
                } else {
                    ids.iter()
                        .position(|value| value == &id)
                        .map(|index| crate::characters::SLOTS[index].to_string())
                        .unwrap_or(id)
                });
            }
            Ok(message)
        })
        .collect::<Result<Vec<_>>>()?;
    candidates
        .into_iter()
        .filter_map(|message| {
            match super::recall_valid(conn, &message.id, chrono::Utc::now().timestamp_millis()) {
                Ok(true) => Some(Ok(message)),
                Ok(false) => None,
                Err(error) => Some(Err(error)),
            }
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
    insert_message_with_playback(conn, message, source, scene_key, direct_reply, None)
}

pub fn insert_message_with_playback(
    conn: &Connection,
    message: &Message,
    source: &str,
    scene_key: Option<&str>,
    direct_reply: bool,
    line: Option<&SceneLine>,
) -> Result<()> {
    insert_message_record(conn, message, source, scene_key, direct_reply, line, false)
}

pub fn insert_user_input(conn: &Connection, message: &Message, ai_only: bool) -> Result<()> {
    if message.role != "user" {
        return Err("AI 입력 선택은 사용자 메시지에만 저장할 수 있어요.".into());
    }
    if ai_only {
        insert_message_record(conn, message, "user", None, false, None, true)
    } else {
        insert_message(conn, message)
    }
}

/// Absent metadata belongs to the existing keyword-first route, including older inputs.
pub fn input_ai_only(conn: &Connection, message_id: &str) -> Result<bool> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM ai_only_inputs WHERE message_id=?1)",
        [message_id],
        |row| row.get(0),
    )
    .map_err(err)
}

fn insert_message_record(
    conn: &Connection,
    message: &Message,
    source: &str,
    scene_key: Option<&str>,
    direct_reply: bool,
    line: Option<&SceneLine>,
    ai_only: bool,
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
        if ai_only {
            tx.execute(
                "INSERT INTO ai_only_inputs(message_id) VALUES(?1)",
                [&message.id],
            )
            .map_err(err)?;
        }
        if direct_reply {
            if let Some(line) = line {
                tx.execute(
                    "INSERT INTO message_playback(message_id,revision,line) VALUES(?1,?2,?3)",
                    params![
                        message.id,
                        super::revision(&tx)?,
                        serde_json::to_string(line).map_err(err)?
                    ],
                )
                .map_err(err)?;
            }
        }
        tx.execute(
            "INSERT INTO message_users VALUES(?1,?2)",
            params![message.id, super::active_user_id(&tx)?],
        )
        .map_err(err)?;
        let source = if message.role == "user" {
            "user"
        } else {
            source
        };
        let expires_at = (message.role == "assistant"
            && matches!(source, "llm" | "question" | "unknown"))
        .then(|| message.created_at.saturating_add(GENERATED_RECALL_MILLIS));
        tx.execute(
            "INSERT INTO message_context(message_id,source,expires_at) VALUES(?1,?2,?3)",
            params![message.id, source, expires_at],
        )
        .map_err(err)?;
        let targets = if message.role == "user" && message.persona.as_deref() == Some("all") {
            match super::active_conversation(&tx)? {
                Some(session) => session.participants,
                None => crate::characters::active_ids(&tx)?,
            }
        } else {
            message_slots(message)
                .into_iter()
                .map(str::to_string)
                .collect()
        };
        let mut target_ids = Vec::new();
        for slot in targets {
            let character = crate::characters::active_character(&tx, &slot)?;
            target_ids.push(character.id.clone());
            tx.execute(
                "INSERT INTO message_characters(message_id,persona,character_id,name) VALUES(?1,?2,?3,?4)",
                params![
                    message.id,
                    slot,
                    character.id,
                    character.definition.name
                ],
            )
            .map_err(err)?;
        }
        if message.role == "user" {
            tx.execute(
                "INSERT INTO message_targets VALUES(?1,?2)",
                params![message.id, serde_json::to_string(&target_ids).map_err(err)?],
            )
            .map_err(err)?;
        }
        if message.role == "user" {
            tx.execute(
                "INSERT INTO memory_analysis_jobs(message_id,state) VALUES(?1,'pending')",
                [&message.id],
            )
            .map_err(err)?;
            super::memory::apply_direct_affinity(&tx, message)?;
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
        if message.role == "assistant" {
            super::record_conversation_disclosure(&tx, &message.id)?;
        }
        if message.role == "user" || direct_reply {
            if let Some(session) = super::active_conversation(&tx)? {
                super::attach_conversation_message(&tx, &session.id, &message.id)?;
            }
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
         WHERE forgotten=0 AND expires_at IS NOT NULL AND message_id IN (SELECT message_id FROM message_users WHERE user_id=?2)",
        params![at.saturating_add(GENERATED_RECALL_MILLIS),super::active_user_id(conn)?],
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

pub fn message_targets(conn: &Connection, message_id: &str) -> Result<Vec<String>> {
    let saved: Option<String> = conn
        .query_row(
            "SELECT ids FROM message_targets WHERE message_id=?",
            [message_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(err)?;
    if let Some(saved) = saved {
        return serde_json::from_str(&saved).map_err(err);
    }
    let mut statement = conn
        .prepare("SELECT character_id FROM message_characters WHERE message_id=? ORDER BY persona")
        .map_err(err)?;
    let result = statement
        .query_map([message_id], |row| row.get(0))
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<String>>>()
        .map_err(err)?;
    Ok(result)
}

pub fn mark_message_displayed(conn: &Connection, id: &str, at: i64) -> Result<()> {
    conn.execute("INSERT OR IGNORE INTO message_presentations SELECT id,?2 FROM messages WHERE id=?1 AND role='assistant'",params![id,at]).map_err(err)?;
    Ok(())
}

pub fn message_displayed(conn: &Connection, id: &str) -> Result<bool> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM message_presentations p
         JOIN message_users u ON u.message_id=p.message_id
         WHERE p.message_id=?1 AND u.user_id=?2)",
        params![id, super::active_user_id(conn)?],
        |row| row.get(0),
    )
    .map_err(err)
}

const RETRY_STALE: &str =
    "저장된 답변의 근거가 바뀌었어요. 원문은 기록에 남아 있으니 새 메시지로 말해 주세요.";
const RETRY_LEGACY: &str = "이전 버전 답변의 재생 정보를 확인할 수 없어요. 원문은 기록에 남아 있으니 새 메시지로 말해 주세요.";

// Never manufacture playback metadata for a legacy raw message or overwrite its text.
// The caller also owns the action/epoch gate; this check protects persisted provenance.
pub fn saved_reply(conn: &Connection, id: &str) -> Result<Option<(SceneLine, String)>> {
    let saved: Option<(String, String, Option<i64>, Option<String>)> = conn
        .query_row(
            "SELECT m.data,c.source,p.revision,p.line FROM messages m
         JOIN message_context c ON c.message_id=m.id
         LEFT JOIN message_playback p ON p.message_id=m.id
         WHERE m.id=?1 AND m.role='assistant'",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .map_err(err)?;
    let Some((raw, source, revision, line)) = saved else {
        return Ok(None);
    };
    if super::message_user_id(conn, id)? != super::active_user_id(conn)? {
        return Err(RETRY_STALE.into());
    }
    let (Some(revision), Some(line)) = (revision, line) else {
        return Err(RETRY_LEGACY.into());
    };
    let message: Message = serde_json::from_str(&raw).map_err(err)?;
    let line: SceneLine = serde_json::from_str(&line).map_err(err)?;
    if revision != super::revision(conn)?
        || !super::conversation_message_allowed(conn, &message, &line.persona)?
        || message.content != line.text
        || message.expression.as_deref() != Some(line.expression.as_str())
        || message.persona.as_deref() != Some(line.persona.as_str())
    {
        return Err(RETRY_STALE.into());
    }
    Ok(Some((line, source)))
}

pub fn saved_reply_scene(conn: &Connection, message_id: &str) -> Result<Option<Vec<SceneLine>>> {
    let saved: Option<(i64, String)> = conn
        .query_row(
            "SELECT revision,lines FROM direct_reply_scenes WHERE message_id=?1",
            [message_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(err)?;
    let Some((revision, lines)) = saved else {
        return Ok(None);
    };
    if revision != super::revision(conn)?
        || super::message_user_id(conn, message_id)? != super::active_user_id(conn)?
    {
        return Err(RETRY_STALE.into());
    }
    let lines: Vec<SceneLine> = serde_json::from_str(&lines).map_err(err)?;
    let raw: String = conn
        .query_row(
            "SELECT data FROM messages WHERE id=?1 AND role='user'",
            [message_id],
            |row| row.get(0),
        )
        .map_err(err)?;
    let input: Message = serde_json::from_str(&raw).map_err(err)?;
    for line in &lines {
        if !super::conversation_message_allowed(conn, &input, &line.persona)? {
            return Err(RETRY_STALE.into());
        }
    }
    Ok(Some(lines))
}

pub fn save_reply_scene(conn: &Connection, message_id: &str, lines: &[SceneLine]) -> Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO direct_reply_scenes(message_id,revision,lines) VALUES(?1,?2,?3)",
        params![
            message_id,
            super::revision(conn)?,
            serde_json::to_string(lines).map_err(err)?
        ],
    )
    .map_err(err)?;
    Ok(())
}

pub fn has_turn_replies(conn: &Connection, message_id: &str, prefix: &str) -> Result<bool> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM messages WHERE role='assistant'
         AND substr(id,1,length(?1))=?1)",
        [format!("{prefix}:{message_id}:")],
        |row| row.get(0),
    )
    .map_err(err)
}

#[cfg(test)]
mod retry_display_tests {
    use super::*;
    use crate::store;

    fn setup(conn: &Connection) -> (Message, SceneLine, Message) {
        let at = chrono::Utc::now().timestamp_millis();
        store::set_user_name(conn, "첫 사용자", at).unwrap();
        let input = Message {
            id: "input".into(),
            role: "user".into(),
            persona: Some("all".into()),
            content: "고마워".into(),
            expression: None,
            created_at: at,
            status: "complete".into(),
        };
        insert_message(conn, &input).unwrap();
        let line = SceneLine {
            persona: "builtin-a".into(),
            text: "  저장된 답변\n공백 보존  ".into(),
            expression: "평온".into(),
            motion: crate::character_reactions::MotionOverride::Static,
        };
        let reply = Message {
            id: "reply:input:builtin-a".into(),
            role: "assistant".into(),
            persona: Some(line.persona.clone()),
            content: line.text.clone(),
            expression: Some(line.expression.clone()),
            created_at: at,
            status: "complete".into(),
        };
        store::record_recall(conn, &reply.id, &[], at).unwrap();
        store::inherit_recall(conn, &reply.id, std::slice::from_ref(&input.id)).unwrap();
        insert_message_with_playback(conn, &reply, "llm", None, true, Some(&line)).unwrap();
        (input, line, reply)
    }

    #[test]
    fn retry_display_metadata_and_scene_are_immutable_and_survive_reopen() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("retry.sqlite");
        let db = store::open(&path).unwrap();
        let (input, line, reply) = setup(&db);
        let lines = vec![
            line.clone(),
            SceneLine {
                persona: "builtin-b".into(),
                ..line.clone()
            },
        ];
        save_reply_scene(&db, &input.id, &lines).unwrap();
        let changed = SceneLine {
            text: "바꾼 본문".into(),
            motion: Default::default(),
            ..line.clone()
        };
        insert_message_with_playback(
            &db,
            &Message {
                content: changed.text.clone(),
                ..reply.clone()
            },
            "wordbook",
            None,
            true,
            Some(&changed),
        )
        .unwrap();
        save_reply_scene(&db, &input.id, &[changed]).unwrap();
        let raw = serde_json::to_value(messages(&db, 10).unwrap()).unwrap();
        let affinity = serde_json::to_value(store::relationships(&db).unwrap()).unwrap();
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM character_affinity", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            2
        );
        drop(db);
        let db = store::open(&path).unwrap();
        let (saved, source) = saved_reply(&db, &reply.id).unwrap().unwrap();
        assert_eq!(source, "llm");
        assert_eq!(saved.text, line.text);
        assert_eq!(saved.motion, line.motion);
        assert_eq!(
            serde_json::to_value(saved_reply_scene(&db, &input.id).unwrap().unwrap()).unwrap(),
            serde_json::to_value(lines).unwrap()
        );
        assert_eq!(
            serde_json::to_value(messages(&db, 10).unwrap()).unwrap(),
            raw
        );
        assert!(!message_displayed(&db, &reply.id).unwrap());
        mark_message_displayed(&db, &reply.id, 1).unwrap();
        mark_message_displayed(&db, &reply.id, 2).unwrap();
        assert!(message_displayed(&db, &reply.id).unwrap());
        assert_eq!(
            serde_json::to_value(store::relationships(&db).unwrap()).unwrap(),
            affinity
        );
        assert_eq!(
            db.query_row(
                "SELECT shown_at FROM message_presentations WHERE message_id=?1",
                [&reply.id],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
            1
        );
    }

    #[test]
    fn retry_display_rejects_legacy_raw_without_inventing_metadata() {
        let db = store::open(std::path::Path::new(":memory:")).unwrap();
        let (_, _, reply) = setup(&db);
        let legacy = Message {
            id: "legacy".into(),
            ..reply
        };
        insert_message_with_source(&db, &legacy, "llm", None, true).unwrap();
        assert!(saved_reply(&db, &legacy.id)
            .unwrap_err()
            .contains("이전 버전"));
        assert_eq!(
            messages(&db, 10).unwrap().last().unwrap().content,
            legacy.content
        );
        assert!(!message_displayed(&db, &legacy.id).unwrap());
    }

    #[test]
    fn retry_display_never_revives_changed_owners_characters_or_recall_sources() {
        for scenario in [
            "revision",
            "character",
            "removed",
            "user",
            "excluded",
            "dependency",
        ] {
            let state = crate::app::tests::state();
            let (input, reply, raw) = {
                let db = state.db.lock().unwrap();
                let (input, line, reply) = setup(&db);
                save_reply_scene(&db, &input.id, &[line]).unwrap();
                let raw = serde_json::to_value(messages(&db, 10).unwrap()).unwrap();
                (input, reply, raw)
            };
            if matches!(scenario, "character" | "removed") {
                // Production character edits own revision/cancellation in this boundary;
                // the low-level storage helpers deliberately do not invalidate on their own.
                crate::character_commands::mutate(&state, |db| {
                    if scenario == "character" {
                        let mut character = crate::characters::active_character(db, "builtin-a")?;
                        character.definition.description = "변경된 설정".into();
                        crate::characters::save(db, &character.id, &character.definition)
                    } else {
                        crate::characters::apply_roster(db, vec!["builtin-b".into()])
                    }
                })
                .unwrap();
            } else {
                let db = state.db.lock().unwrap();
                match scenario {
                    "revision" => {
                        store::bump_revision(&db).unwrap();
                    }
                    "user" => {
                        store::set_user_name(&db, "다른 사용자", input.created_at + 1).unwrap();
                    }
                    "excluded" => {
                        db.execute(
                            "INSERT INTO memory_exclusions VALUES('builtin-a',?1,?2)",
                            params![store::active_user_id(&db).unwrap(), input.id],
                        )
                        .unwrap();
                    }
                    _ => {
                        // A missing dependency invalidates replay even if revision is unchanged.
                        db.execute(
                            "INSERT INTO recall_dependencies VALUES(?1,'deleted-memory',0)",
                            [&reply.id],
                        )
                        .unwrap();
                    }
                }
            }
            let db = state.db.lock().unwrap();
            assert!(saved_reply(&db, &reply.id).is_err(), "{scenario}");
            if scenario != "dependency" {
                assert!(saved_reply_scene(&db, &input.id).is_err(), "{scenario}");
            }
            assert_eq!(
                serde_json::to_value(messages(&db, 10).unwrap()).unwrap(),
                raw
            );
        }
    }
}
