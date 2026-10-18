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
            lines TEXT NOT NULL,
            source TEXT NOT NULL DEFAULT 'wordbook'
        );
        CREATE TABLE IF NOT EXISTS ai_only_inputs(
            message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS single_bundle_inputs(
            message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
            targets TEXT NOT NULL DEFAULT '[]'
        );
        CREATE TABLE IF NOT EXISTS message_finishes(
            message_id TEXT PRIMARY KEY REFERENCES messages(id),
            display_started_at INTEGER NOT NULL,
            ends_at INTEGER NOT NULL,
            finished_at INTEGER NOT NULL
        );",
    )
    .map_err(err)?;
    let has_scene_source: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info('direct_reply_scenes') WHERE name='source')",
            [],
            |row| row.get(0),
        )
        .map_err(err)?;
    if !has_scene_source {
        tx.execute_batch(
            "ALTER TABLE direct_reply_scenes ADD COLUMN source TEXT NOT NULL DEFAULT 'wordbook'",
        )
        .map_err(err)?;
    }
    let has_bundle_targets:bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM pragma_table_info('single_bundle_inputs') WHERE name='targets')",[],|row|row.get(0)).map_err(err)?;
    if !has_bundle_targets {
        tx.execute_batch(
            "ALTER TABLE single_bundle_inputs ADD COLUMN targets TEXT NOT NULL DEFAULT '[]'",
        )
        .map_err(err)?;
    }
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
    insert_message_record(
        conn,
        message,
        source,
        scene_key,
        direct_reply,
        line,
        false,
        None,
    )
}

// The scene owner has already validated the current participant ticket under action.
pub(crate) fn insert_message_with_actor(
    conn: &Connection,
    message: &Message,
    source: &str,
    direct_reply: bool,
    line: &SceneLine,
    actor: &crate::characters::InstalledCharacter,
) -> Result<()> {
    if message.role != "assistant"
        || message.persona.as_deref() != Some(actor.id.as_str())
        || line.persona != actor.id
        || crate::characters::get(conn, &actor.id)?.definition != actor.definition
    {
        return Err("현재 대사의 화자 정의가 바뀌었어요.".into());
    }
    insert_message_record(
        conn,
        message,
        source,
        None,
        direct_reply,
        Some(line),
        false,
        Some(actor),
    )
}

pub fn insert_user_input(conn: &Connection, message: &Message, ai_only: bool) -> Result<()> {
    if message.role != "user" {
        return Err("AI 입력 선택은 사용자 메시지에만 저장할 수 있어요.".into());
    }
    if ai_only {
        insert_message_record(conn, message, "user", None, false, None, true, None)
    } else {
        insert_message(conn, message)
    }
}

// Older explicit AI selections and new AI fallbacks share their retry route.
pub fn input_ai_only(conn: &Connection, message_id: &str) -> Result<bool> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM ai_only_inputs WHERE message_id=?1)",
        [message_id],
        |row| row.get(0),
    )
    .map_err(err)
}

pub fn select_single_bundle_targets(
    conn: &Connection,
    message_id: &str,
    targets: &[String],
) -> Result<()> {
    if targets.is_empty()
        || targets.len() > 8
        || targets
            .iter()
            .collect::<std::collections::BTreeSet<_>>()
            .len()
            != targets.len()
    {
        return Err("응답 계획의 참가자를 확인해 주세요.".into());
    }
    conn.execute("INSERT OR IGNORE INTO single_bundle_inputs SELECT m.id,?3 FROM messages m JOIN message_users u ON u.message_id=m.id WHERE m.id=?1 AND m.role='user' AND u.user_id=?2", params![message_id, super::active_user_id(conn)?, serde_json::to_string(targets).map_err(err)?]).map_err(err)?;
    Ok(())
}

pub fn single_bundle_targets(conn: &Connection, message_id: &str) -> Result<Option<Vec<String>>> {
    let value: Option<String> = conn
        .query_row(
            "SELECT targets FROM single_bundle_inputs WHERE message_id=?1",
            [message_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(err)?;
    value
        .map(|value| {
            let targets: Vec<String> = serde_json::from_str(&value).map_err(err)?;
            if targets.is_empty() {
                super::message_targets(conn, message_id)
            } else {
                Ok(targets)
            }
        })
        .transpose()
}

pub fn single_bundle_selected(conn: &Connection, message_id: &str) -> Result<bool> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM single_bundle_inputs WHERE message_id=?1)",
        [message_id],
        |row| row.get(0),
    )
    .map_err(err)
}

pub fn select_input_ai_route(conn: &Connection, message_id: &str) -> Result<()> {
    let changed = conn
        .execute(
            "INSERT OR IGNORE INTO ai_only_inputs(message_id)
             SELECT m.id FROM messages m JOIN message_users u ON u.message_id=m.id
             WHERE m.id=?1 AND m.role='user' AND u.user_id=?2",
            params![message_id, super::active_user_id(conn)?],
        )
        .map_err(err)?;
    if changed == 0
        && (super::message_user_id(conn, message_id)? != super::active_user_id(conn)?
            || !input_ai_only(conn, message_id)?)
    {
        return Err("대화의 근거가 변경되었어요. 새 메시지로 말해 주세요.".into());
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn insert_message_record(
    conn: &Connection,
    message: &Message,
    source: &str,
    scene_key: Option<&str>,
    direct_reply: bool,
    line: Option<&SceneLine>,
    ai_only: bool,
    actor: Option<&crate::characters::InstalledCharacter>,
) -> Result<()> {
    if !conn.is_autocommit() {
        return insert_message_record_locked(
            conn,
            message,
            source,
            scene_key,
            direct_reply,
            line,
            ai_only,
            actor,
        );
    }
    let tx = conn.unchecked_transaction().map_err(err)?;
    insert_message_record_locked(
        &tx,
        message,
        source,
        scene_key,
        direct_reply,
        line,
        ai_only,
        actor,
    )?;
    tx.commit().map_err(err)
}

#[allow(clippy::too_many_arguments)]
fn insert_message_record_locked(
    tx: &Connection,
    message: &Message,
    source: &str,
    scene_key: Option<&str>,
    direct_reply: bool,
    line: Option<&SceneLine>,
    ai_only: bool,
    actor: Option<&crate::characters::InstalledCharacter>,
) -> Result<()> {
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
                        super::revision(tx)?,
                        serde_json::to_string(line).map_err(err)?
                    ],
                )
                .map_err(err)?;
            }
        }
        tx.execute(
            "INSERT INTO message_users VALUES(?1,?2)",
            params![message.id, super::active_user_id(tx)?],
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
            match super::active_conversation(tx)? {
                Some(session) => session.participants,
                None => crate::characters::active_ids(tx)?,
            }
        } else {
            message_slots(message)
                .into_iter()
                .map(str::to_string)
                .collect()
        };
        let mut target_ids = Vec::new();
        for slot in targets {
            let character = match actor {
                Some(actor) if actor.id == slot => actor.clone(),
                Some(_) => return Err("대사의 화자를 확인해 주세요.".into()),
                None => crate::characters::active_character(tx, &slot)?,
            };
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
            super::memory::apply_direct_affinity(tx, message)?;
            forget_expired_messages(tx, message.created_at)?;
            extend_generated_recall(tx, message.created_at)?;
            bump_revision(tx)?;
        } else if direct_reply {
            extend_generated_recall(tx, message.created_at)?;
        }
        if let Some(key) = scene_key {
            tx.execute(
                "INSERT INTO talk_history(scene_key,shown_at) VALUES(?1,?2) ON CONFLICT(scene_key) DO UPDATE SET shown_at=excluded.shown_at",
                params![key, message.created_at],
            ).map_err(err)?;
        }
        if message.role == "assistant" {
            super::record_conversation_disclosure(tx, &message.id)?;
        }
        if message.role == "user" || direct_reply {
            if let Some(session) = super::active_conversation(tx)? {
                if direct_reply
                    && (matches!(source, "story" | "scenario" | "npc")
                        || (actor.is_some() && matches!(source, "wordbook" | "llm")))
                {
                    super::conversations::attach_registered_reply(tx, &session.id, &message.id)?;
                } else {
                    super::attach_conversation_message(tx, &session.id, &message.id)?;
                }
            }
        }
    }
    Ok(())
}

pub(crate) fn save_generated_bundle(
    conn: &Connection,
    input_id: &str,
    lines: &[SceneLine],
    actors: &[crate::characters::InstalledCharacter],
    at: i64,
) -> Result<()> {
    if lines.is_empty()
        || lines.len() > 8
        || lines.len() != actors.len()
        || lines
            .iter()
            .zip(actors)
            .any(|(line, actor)| line.persona != actor.id)
        || single_bundle_targets(conn, input_id)?.as_ref()
            != Some(
                &actors
                    .iter()
                    .map(|actor| actor.id.clone())
                    .collect::<Vec<_>>(),
            )
    {
        return Err("생성 답변의 허용 화자와 순서를 확인해 주세요.".into());
    }
    let tx = conn.unchecked_transaction().map_err(err)?;
    for (line, actor) in lines.iter().zip(actors) {
        insert_message_with_actor(
            &tx,
            &Message {
                id: format!("reply:{input_id}:{}", line.persona),
                role: "assistant".into(),
                persona: Some(line.persona.clone()),
                content: line.text.clone(),
                expression: Some(line.expression.clone()),
                created_at: at,
                status: "complete".into(),
            },
            "llm",
            true,
            line,
            actor,
        )?;
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

#[cfg(test)]
pub fn mark_message_displayed(conn: &Connection, id: &str, at: i64) -> Result<()> {
    mark_message_displayed_with_provenance(conn, id, at, None)
}

pub fn mark_message_displayed_with_provenance(
    conn: &Connection,
    id: &str,
    at: i64,
    automatic: Option<bool>,
) -> Result<()> {
    conn.execute("INSERT OR IGNORE INTO message_presentations(message_id,shown_at,automatic) SELECT m.id,?2,?3 FROM messages m JOIN message_users u ON u.message_id=m.id WHERE m.id=?1 AND m.role='assistant' AND u.user_id=?4",params![id,at,automatic,super::active_user_id(conn)?]).map_err(err)?;
    Ok(())
}

pub fn automatic_message_displayed_at(conn: &Connection, id: &str) -> Result<Option<i64>> {
    conn.query_row("SELECT p.shown_at FROM message_presentations p JOIN message_users u ON u.message_id=p.message_id WHERE p.message_id=?1 AND p.automatic=1 AND u.user_id=?2",params![id,super::active_user_id(conn)?],|row|row.get(0)).optional().map_err(err)
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

pub fn message_finished(conn: &Connection, id: &str) -> Result<bool> {
    conn.query_row("SELECT EXISTS(SELECT 1 FROM message_finishes f JOIN message_users u ON u.message_id=f.message_id WHERE f.message_id=?1 AND u.user_id=?2)", params![id, super::active_user_id(conn)?], |row| row.get(0)).map_err(err)
}

// Does not start a transaction: the ending owner commits evidence and effects together.
pub fn mark_message_finished(
    conn: &Connection,
    id: &str,
    started_at: i64,
    ends_at: i64,
    now: i64,
) -> Result<()> {
    if started_at <= 0 || ends_at < started_at || now < ends_at {
        return Err("대사의 표시가 아직 끝나지 않았어요.".into());
    }
    let changed = conn.execute("INSERT OR IGNORE INTO message_finishes SELECT m.id,?2,?3,?4 FROM messages m JOIN message_users u ON u.message_id=m.id JOIN message_context c ON c.message_id=m.id JOIN message_presentations p ON p.message_id=m.id WHERE m.id=?1 AND m.role='assistant' AND u.user_id=?5 AND c.source IN ('scenario','npc') AND p.shown_at<=?2", params![id, started_at, ends_at, now, super::active_user_id(conn)?]).map_err(err)?;
    if changed == 0 && !message_finished(conn, id)? {
        return Err("현재 화면에 표시한 대사를 확인할 수 없어요.".into());
    }
    Ok(())
}

const RETRY_STALE: &str =
    "저장된 답변의 근거가 바뀌었어요. 원문은 기록에 남아 있으니 새 메시지로 말해 주세요.";
const RETRY_LEGACY: &str = "이전 버전 답변의 재생 정보를 확인할 수 없어요. 원문은 기록에 남아 있으니 새 메시지로 말해 주세요.";

// Never manufacture playback metadata for a legacy raw message or overwrite its text.
// The caller also owns the action/epoch gate; this check protects persisted provenance.
pub fn saved_reply(conn: &Connection, id: &str) -> Result<Option<(SceneLine, String)>> {
    saved_reply_for_participants(conn, id, None)
}

pub fn saved_reply_for_participants(
    conn: &Connection,
    id: &str,
    participants: Option<&[String]>,
) -> Result<Option<(SceneLine, String)>> {
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
    let allowed = match participants {
        Some(ids) => {
            ids.contains(&line.persona) && crate::characters::get(conn, &line.persona).is_ok()
        }
        None => super::conversation_message_allowed(conn, &message, &line.persona)?,
    };
    if (!matches!(source.as_str(), "scenario" | "npc") && revision != super::revision(conn)?)
        || !allowed
        || message.content != line.text
        || message.expression.as_deref() != Some(line.expression.as_str())
        || message.persona.as_deref() != Some(line.persona.as_str())
    {
        return Err(RETRY_STALE.into());
    }
    Ok(Some((line, source)))
}

pub fn saved_reply_scene(conn: &Connection, message_id: &str) -> Result<Option<Vec<SceneLine>>> {
    saved_reply_scene_for_participants(conn, message_id, None)
}

pub fn saved_reply_scene_for_participants(
    conn: &Connection,
    message_id: &str,
    participants: Option<&[String]>,
) -> Result<Option<Vec<SceneLine>>> {
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
        let allowed = match participants {
            Some(ids) => {
                ids.contains(&line.persona) && crate::characters::get(conn, &line.persona).is_ok()
            }
            None => super::conversation_message_allowed(conn, &input, &line.persona)?,
        };
        if !allowed {
            return Err(RETRY_STALE.into());
        }
    }
    Ok(Some(lines))
}

pub fn save_reply_scene(conn: &Connection, message_id: &str, lines: &[SceneLine]) -> Result<()> {
    save_reply_scene_with_source(conn, message_id, lines, "wordbook")
}

pub fn save_reply_scene_with_source(
    conn: &Connection,
    message_id: &str,
    lines: &[SceneLine],
    source: &str,
) -> Result<()> {
    if !matches!(source, "wordbook" | "story" | "scenario" | "npc") {
        return Err("등록 답변의 종류를 확인해 주세요.".into());
    }
    conn.execute(
        "INSERT OR IGNORE INTO direct_reply_scenes(message_id,revision,lines,source) VALUES(?1,?2,?3,?4)",
        params![
            message_id,
            super::revision(conn)?,
            serde_json::to_string(lines).map_err(err)?,
            source,
        ],
    )
    .map_err(err)?;
    Ok(())
}

pub fn reply_scene_source(conn: &Connection, message_id: &str) -> Result<&'static str> {
    let source: String = conn
        .query_row(
            "SELECT source FROM direct_reply_scenes WHERE message_id=?1",
            [message_id],
            |row| row.get(0),
        )
        .map_err(err)?;
    match source.as_str() {
        "wordbook" => Ok("wordbook"),
        "story" => Ok("story"),
        "scenario" => Ok("scenario"),
        "npc" => Ok("npc"),
        _ => Err("저장된 답변의 종류를 확인할 수 없어요. 새 메시지로 말해 주세요.".into()),
    }
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
mod scene_source_migration_tests {
    use super::*;

    #[test]
    fn old_registered_reply_metadata_gains_a_source_without_changing_the_saved_text() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("old-scene.sqlite");
        let db = crate::store::open(&path).unwrap();
        insert_user_input(
            &db,
            &Message {
                id: "old-input".into(),
                role: "user".into(),
                persona: Some("a".into()),
                content: "원래 질문".into(),
                expression: None,
                created_at: 1,
                status: "complete".into(),
            },
            true,
        )
        .unwrap();
        let lines = vec![SceneLine {
            persona: "builtin-a".into(),
            text: "  이전 답변\n\n 그대로  ".into(),
            expression: "평온".into(),
            motion: Default::default(),
        }];
        save_reply_scene(&db, "old-input", &lines).unwrap();
        let raw = serde_json::to_value(messages(&db, 10).unwrap()).unwrap();
        db.execute_batch("ALTER TABLE direct_reply_scenes DROP COLUMN source")
            .unwrap();
        drop(db);
        let db = crate::store::open(&path).unwrap();
        assert_eq!(reply_scene_source(&db, "old-input").unwrap(), "wordbook");
        assert_eq!(
            serde_json::to_value(saved_reply_scene(&db, "old-input").unwrap().unwrap()).unwrap(),
            serde_json::to_value(lines).unwrap()
        );
        assert!(input_ai_only(&db, "old-input").unwrap());
        assert_eq!(
            serde_json::to_value(messages(&db, 10).unwrap()).unwrap(),
            raw
        );
        assert_eq!(
            db.query_row("PRAGMA integrity_check", [], |row| row.get::<_, String>(0))
                .unwrap(),
            "ok"
        );
    }
}
