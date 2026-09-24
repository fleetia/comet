use super::{bump_revision, err, revision, Result};
use crate::types::{Memory, Message, Relationship};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

pub(super) const MEMORY_FIELDS: &str = "m.id,m.content,m.source,m.updated,m.character_id,m.user_id,COALESCE((SELECT name FROM user_identities u WHERE u.id=m.user_id),''),m.kind,m.source_text,m.source_created_at,(SELECT ended_at FROM user_identities u WHERE u.id=m.user_id)";

pub(super) fn memory_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Memory> {
    Ok(Memory {
        id: row.get(0)?,
        content: row.get(1)?,
        source_message_id: row.get(2)?,
        updated_at: row.get(3)?,
        character_id: row.get(4)?,
        user_id: row.get(5)?,
        user_name: row.get(6)?,
        kind: row.get(7)?,
        source_text: row.get(8)?,
        source_created_at: row.get(9)?,
        retired_at: row.get(10)?,
        recall_weight: 1.0,
    })
}

pub fn memories(conn: &Connection) -> Result<Vec<Memory>> {
    let mut stmt=conn.prepare(&format!("SELECT {MEMORY_FIELDS} FROM memories m WHERE deleted=0 AND expired=0 ORDER BY updated DESC,id")).map_err(err)?;
    let rows = stmt.query_map([], memory_row).map_err(err)?;
    rows.map(|r| r.map_err(err)).collect()
}

fn block_source(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("INSERT OR IGNORE INTO memory_exclusions SELECT character_id,user_id,source FROM memories WHERE id=?1",[id]).map_err(err)?;
    Ok(())
}

pub fn edit_memory(conn: &Connection, id: &str, content: &str) -> Result<()> {
    if content.trim().is_empty() || content.chars().count() > 500 {
        return Err("기억은 1~500자로 입력해 주세요.".into());
    }
    let tx = conn.unchecked_transaction().map_err(err)?;
    block_source(&tx, id)?;
    tx.execute("UPDATE memories SET content=?2,locked=1,updated=?3 WHERE id=?1 AND deleted=0 AND expired=0",params![id,content.trim(),chrono::Utc::now().timestamp_millis()]).map_err(err)?;
    bump_revision(&tx)?;
    tx.commit().map_err(err)
}

pub fn delete_memory(conn: &Connection, id: &str) -> Result<()> {
    let tx = conn.unchecked_transaction().map_err(err)?;
    block_source(&tx, id)?;
    tx.execute("UPDATE memories SET deleted=1,locked=1 WHERE id=?1", [id])
        .map_err(err)?;
    bump_revision(&tx)?;
    tx.commit().map_err(err)
}

fn verify_owner(conn: &Connection, character_id: &str, id: &str) -> Result<()> {
    let exists:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM memories WHERE id=?1 AND character_id=?2 AND deleted=0 AND expired=0)",params![id,character_id],|r|r.get(0)).map_err(err)?;
    if !exists {
        return Err("선택한 캐릭터의 기억을 찾을 수 없어요.".into());
    }
    Ok(())
}
pub fn edit_memory_for(
    conn: &Connection,
    character_id: &str,
    id: &str,
    content: &str,
) -> Result<()> {
    verify_owner(conn, character_id, id)?;
    edit_memory(conn, id, content)
}
pub fn delete_memory_for(conn: &Connection, character_id: &str, id: &str) -> Result<()> {
    verify_owner(conn, character_id, id)?;
    delete_memory(conn, id)
}

pub fn relationships(conn: &Connection) -> Result<Vec<Relationship>> {
    let user = super::active_user_id(conn)?;
    crate::characters::active_ids(conn)?.iter().map(|id| {
        let sum:i32=conn.query_row("SELECT COALESCE(SUM(delta),0) FROM character_affinity WHERE character_id=?1 AND user_id=?2",params![id,user],|r|r.get(0)).map_err(err)?;
        Ok(Relationship{persona:id.clone(),score:(20+sum).clamp(0,100)})
    }).collect()
}

fn page(
    conn: &Connection,
    character_id: &str,
    offset: usize,
    limit: usize,
) -> Result<super::MemoryPage> {
    let at = chrono::Utc::now().timestamp_millis();
    super::expire_memories(conn, at)?;
    let total: usize = conn
        .query_row(
            "SELECT COUNT(*) FROM memories WHERE character_id=?1 AND deleted=0 AND expired=0",
            [character_id],
            |r| r.get(0),
        )
        .map_err(err)?;
    let offset = offset.min(total);
    let limit = limit.clamp(1, 50);
    let mut stmt=conn.prepare(&format!("SELECT {MEMORY_FIELDS} FROM memories m WHERE character_id=?1 AND deleted=0 AND expired=0 ORDER BY updated DESC,id LIMIT ?2 OFFSET ?3")).map_err(err)?;
    let mut items = stmt
        .query_map(
            params![character_id, limit as i64, offset as i64],
            memory_row,
        )
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    let at = super::effective_memory_time(conn, at)?;
    for memory in &mut items {
        memory.recall_weight = recall_weight(memory.retired_at, at);
    }
    let end = offset + items.len();
    Ok(super::MemoryPage {
        items,
        total,
        offset,
        next_offset: (end < total).then_some(end),
        revision: super::memory_revision(conn)?,
    })
}
pub fn scoped_memory_page(
    conn: &Connection,
    character_id: &str,
    offset: usize,
    limit: usize,
) -> Result<super::MemoryPage> {
    page(conn, character_id, offset, limit)
}
pub fn legacy_memory_page(
    conn: &Connection,
    offset: usize,
    limit: usize,
) -> Result<super::MemoryPage> {
    page(conn, "", offset, limit)
}
pub fn legacy_memory_count(conn: &Connection) -> Result<usize> {
    conn.query_row(
        "SELECT COUNT(*) FROM memories WHERE character_id='' AND deleted=0 AND expired=0",
        [],
        |r| r.get(0),
    )
    .map_err(err)
}

pub fn forget_character_memories(conn: &Connection, character_id: &str) -> Result<usize> {
    let tx = conn.unchecked_transaction().map_err(err)?;
    tx.execute("INSERT OR IGNORE INTO memory_exclusions SELECT character_id,user_id,source FROM memories WHERE character_id=?1",[character_id]).map_err(err)?;
    tx.execute("INSERT OR IGNORE INTO memory_exclusions SELECT ?1,u.user_id,i.message_id FROM message_characters i JOIN message_users u ON u.message_id=i.message_id JOIN messages m ON m.id=i.message_id WHERE i.character_id=?1 AND m.role='user'",[character_id]).map_err(err)?;
    let changed = tx
        .execute(
            "UPDATE memories SET deleted=1,locked=1 WHERE character_id=?1 AND deleted=0",
            [character_id],
        )
        .map_err(err)?;
    bump_revision(&tx)?;
    tx.commit().map_err(err)?;
    Ok(changed)
}

pub fn assign_legacy_memories(
    conn: &Connection,
    ids: &[String],
    character_ids: &[String],
) -> Result<()> {
    if character_ids.is_empty() {
        return Err("기억을 받을 캐릭터를 선택해 주세요.".into());
    }
    let tx = conn.unchecked_transaction().map_err(err)?;
    for character in character_ids {
        if !crate::characters::collection(&tx)?
            .installed
            .iter()
            .any(|item| &item.id == character)
        {
            return Err("캐릭터를 찾을 수 없어요.".into());
        }
    }
    for id in ids {
        let eligible:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM memories WHERE id=?1 AND character_id='' AND deleted=0)",[id],|r|r.get(0)).map_err(err)?;
        if !eligible {
            return Err("배분할 기존 기억을 찾을 수 없어요.".into());
        }
        for character in character_ids
            .iter()
            .collect::<std::collections::BTreeSet<_>>()
        {
            tx.execute("INSERT OR IGNORE INTO memories(id,content,source,updated,deleted,locked,content_version,character_id,user_id,kind,source_text,source_created_at,expired,required_chapter) SELECT ?2,content,source,updated,deleted,locked,content_version,?3,user_id,kind,source_text,source_created_at,expired,required_chapter FROM memories WHERE id=?1",params![id,uuid::Uuid::new_v4().to_string(),character]).map_err(err)?;
        }
        tx.execute("UPDATE memories SET deleted=1,locked=1 WHERE id=?1", [id])
            .map_err(err)?;
    }
    bump_revision(&tx)?;
    tx.commit().map_err(err)
}

pub fn recall_weight(retired_at: Option<i64>, at: i64) -> f64 {
    retired_at
        .map(|retired| {
            (1.0 - (at.saturating_sub(retired).max(0) as f64
                / super::MEMORY_LIFETIME_MILLIS as f64))
                .clamp(0.0, 1.0)
        })
        .unwrap_or(1.0)
}

pub(super) fn eligible_memory(conn: &Connection, memory: &Memory, at: i64) -> Result<bool> {
    if recall_weight(memory.retired_at, at) <= 0.0 {
        return Ok(false);
    }
    let chapter: Option<i64> = conn
        .query_row(
            "SELECT required_chapter FROM memories WHERE id=?1",
            [&memory.id],
            |r| r.get(0),
        )
        .map_err(err)?;
    if let Some(chapter) = chapter {
        let user = super::active_user_id(conn)?;
        let score:i32=conn.query_row("SELECT 20+COALESCE(SUM(delta),0) FROM character_affinity WHERE character_id=?1 AND user_id=?2",params![memory.character_id,user],|r|r.get(0)).map_err(err)?;
        if i64::from(crate::story::disclosure_level(
            conn,
            &memory.character_id,
            score.clamp(0, 100),
        )?) < chapter
        {
            return Ok(false);
        }
    }
    Ok(true)
}

pub fn recall_memories(
    conn: &Connection,
    character_ids: &[String],
    at: i64,
    limit: usize,
) -> Result<Vec<Memory>> {
    super::expire_memories(conn, at)?;
    let at = super::effective_memory_time(conn, at)?;
    let mut candidates = Vec::new();
    for (rank, mut memory) in memories(conn)?.into_iter().enumerate() {
        if !character_ids.contains(&memory.character_id) || !eligible_memory(conn, &memory, at)? {
            continue;
        }
        memory.recall_weight = recall_weight(memory.retired_at, at);
        candidates.push((memory.recall_weight / (61 + rank) as f64, memory));
    }
    candidates.sort_by(|left, right| {
        right
            .0
            .total_cmp(&left.0)
            .then_with(|| left.1.id.cmp(&right.1.id))
    });
    let mut selected = Vec::new();
    let mut counts = std::collections::BTreeMap::<String, usize>::new();
    for (_, memory) in candidates {
        if selected.len() >= limit.min(8) {
            break;
        }
        let count = counts.entry(memory.user_id.clone()).or_default();
        if *count >= (8.0 * memory.recall_weight).ceil() as usize {
            continue;
        }
        *count += 1;
        selected.push(memory);
    }
    Ok(selected)
}

#[allow(clippy::too_many_arguments)]
pub fn insert_experience(
    conn: &Connection,
    character_id: &str,
    user_id: &str,
    source: &str,
    content: &str,
    source_text: &str,
    created_at: i64,
    required_chapter: Option<u8>,
) -> Result<()> {
    let blocked:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM memory_exclusions WHERE character_id=?1 AND user_id=?2 AND source=?3)",params![character_id,user_id,source],|r|r.get(0)).map_err(err)?;
    if blocked {
        return Ok(());
    }
    conn.execute("INSERT OR IGNORE INTO memories(id,content,source,updated,character_id,user_id,kind,source_text,source_created_at,required_chapter) VALUES(?1,?2,?3,?4,?5,?6,'experience',?7,?4,?8)",params![uuid::Uuid::new_v4().to_string(),content,source,created_at,character_id,user_id,source_text,required_chapter]).map_err(err)?;
    Ok(())
}

pub fn record_recall(conn: &Connection, key: &str, memories: &[Memory], at: i64) -> Result<()> {
    let until = memories
        .iter()
        .filter_map(|m| {
            m.retired_at
                .map(|at| at.saturating_add(super::MEMORY_LIFETIME_MILLIS))
        })
        .min();
    let tx = conn.unchecked_transaction().map_err(err)?;
    tx.execute(
        "INSERT OR REPLACE INTO recall_contexts VALUES(?1,?2,?3)",
        params![key, super::active_user_id(&tx)?, until],
    )
    .map_err(err)?;
    tx.execute("DELETE FROM recall_dependencies WHERE key=?1", [key])
        .map_err(err)?;
    tx.execute("DELETE FROM recall_sources WHERE key=?1", [key])
        .map_err(err)?;
    for memory in memories {
        tx.execute("INSERT OR IGNORE INTO recall_dependencies SELECT ?1,id,content_version FROM memories WHERE id=?2 AND deleted=0 AND expired=0",params![key,memory.id]).map_err(err)?;
    }
    let effective = super::effective_memory_time(&tx, at)?;
    super::put(&tx, "memory_clock", &effective)?;
    tx.commit().map_err(err)
}

pub fn copy_recall(conn: &Connection, from: &str, to: &str) -> Result<()> {
    let tx = conn.unchecked_transaction().map_err(err)?;
    tx.execute("DELETE FROM recall_dependencies WHERE key=?1", [to])
        .map_err(err)?;
    tx.execute("DELETE FROM recall_sources WHERE key=?1", [to])
        .map_err(err)?;
    tx.execute("DELETE FROM recall_contexts WHERE key=?1", [to])
        .map_err(err)?;
    tx.execute("INSERT INTO recall_contexts SELECT ?2,user_id,valid_until FROM recall_contexts WHERE key=?1",params![from,to]).map_err(err)?;
    tx.execute("INSERT INTO recall_dependencies SELECT ?2,memory_id,content_version FROM recall_dependencies WHERE key=?1",params![from,to]).map_err(err)?;
    tx.execute("INSERT INTO recall_sources SELECT ?2,message_id,character_id,user_id FROM recall_sources WHERE key=?1",params![from,to]).map_err(err)?;
    tx.commit().map_err(err)
}

pub fn recall_valid(conn: &Connection, key: &str, at: i64) -> Result<bool> {
    let at = super::effective_memory_time(conn, at)?;
    let context: Option<(String, Option<i64>)> = conn
        .query_row(
            "SELECT user_id,valid_until FROM recall_contexts WHERE key=?1",
            [key],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(err)?;
    let Some((user, until)) = context else {
        return Ok(true);
    };
    if user != super::active_user_id(conn)? || until.is_some_and(|until| at >= until) {
        return Ok(false);
    }
    let invalid:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM recall_dependencies d LEFT JOIN memories m ON m.id=d.memory_id WHERE d.key=?1 AND (m.id IS NULL OR m.deleted=1 OR m.expired=1 OR m.content_version!=d.content_version))",[key],|r|r.get(0)).map_err(err)?;
    if invalid {
        return Ok(false);
    }
    let excluded:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM recall_sources s JOIN memory_exclusions e ON e.source=s.message_id AND e.character_id=s.character_id AND e.user_id=s.user_id WHERE s.key=?1)",[key],|r|r.get(0)).map_err(err)?;
    if excluded {
        return Ok(false);
    }
    let mut statement=conn.prepare(&format!("SELECT {MEMORY_FIELDS} FROM memories m JOIN recall_dependencies d ON d.memory_id=m.id WHERE d.key=?1")).map_err(err)?;
    let active = crate::characters::active_ids(conn)?;
    for memory in statement.query_map([key], memory_row).map_err(err)? {
        let memory = memory.map_err(err)?;
        if !active.contains(&memory.character_id) || !eligible_memory(conn, &memory, at)? {
            return Ok(false);
        }
    }
    Ok(true)
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

#[cfg(test)]
pub fn analyze_apply(conn: &Connection, value: &Value) -> Result<()> {
    let ids = ["memories", "events"]
        .iter()
        .flat_map(|key| {
            value
                .get(key)
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
        })
        .map(|item| field(item, "sourceMessageId").to_string())
        .collect::<Vec<_>>();
    apply(conn, value, &ids, false)
}

pub fn analyze_apply_batch(
    conn: &Connection,
    value: &Value,
    submitted_ids: &[String],
) -> Result<()> {
    apply(conn, value, submitted_ids, true)
}

fn apply(
    conn: &Connection,
    value: &Value,
    submitted_ids: &[String],
    complete_jobs: bool,
) -> Result<()> {
    let tx = conn.unchecked_transaction().map_err(err)?;
    if value.get("revision").and_then(Value::as_i64) != Some(revision(&tx)?) {
        return Err("대화나 기억이 바뀌어 분석 결과를 버렸습니다.".into());
    }
    let facts = value
        .get("memories")
        .and_then(Value::as_array)
        .ok_or("기억 분석 응답 형식이 올바르지 않습니다.")?;
    let events = value
        .get("events")
        .and_then(Value::as_array)
        .ok_or("기억 분석 응답 형식이 올바르지 않습니다.")?;
    if facts.iter().chain(events).any(|item| {
        !submitted_ids
            .iter()
            .any(|id| id == field(item, "sourceMessageId"))
    }) {
        return Err("분석에 전달하지 않은 원문이 포함되어 결과를 버렸습니다.".into());
    }
    if complete_jobs {
        for id in submitted_ids {
            let pending: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM memory_analysis_jobs WHERE message_id=?1 AND state='pending')", [id], |row| row.get(0)).map_err(err)?;
            if !pending {
                return Err("분석 작업이 바뀌어 결과를 버렸습니다.".into());
            }
        }
    }
    let mut changed = false;
    if let Some(items) = value.get("memories").and_then(Value::as_array) {
        for item in items.iter().take(8) {
            if !matches!(field(item, "kind"), "user_fact" | "experience")
                || item.get("certain").and_then(Value::as_bool) != Some(true)
            {
                continue;
            }
            let Some(source) = evidence(&tx, item)? else {
                continue;
            };
            if field(item, "kind") == "experience"
                && !completed_conversation_sources(&tx, std::slice::from_ref(&source))?
                    .contains(&source.id)
            {
                continue;
            }
            // Retain the user's exact wording; the model's paraphrase is not trusted as a fact.
            let content = field(item, "evidence").trim();
            if content.chars().count() > 500 {
                continue;
            }
            let user_id = super::message_user_id(&tx, &source.id)?;
            let at = super::effective_memory_time(&tx, chrono::Utc::now().timestamp_millis())?;
            if super::user_identity(&tx, &user_id)?
                .is_some_and(|user| recall_weight(user.ended_at, at) <= 0.0)
            {
                continue;
            }
            for character_id in super::message_targets(&tx, &source.id)? {
                if field(item, "kind") == "experience" {
                    let replied:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM messages reply JOIN message_presentations shown ON shown.message_id=reply.id JOIN message_context c ON c.message_id=reply.id JOIN message_characters i ON i.message_id=reply.id JOIN message_users u ON u.message_id=reply.id WHERE reply.role='assistant' AND json_extract(reply.data,'$.status')='complete' AND c.source IN ('llm','wordbook') AND u.user_id=?2 AND i.character_id=?3 AND (substr(reply.id,1,length(?1)+7)='reply:'||?1||':' OR substr(reply.id,1,length(?1)+7)='scene:'||?1||':'))",params![source.id,user_id,character_id],|r|r.get(0)).map_err(err)?;
                    if !replied {
                        continue;
                    }
                }
                let blocked:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM memory_exclusions WHERE character_id=?1 AND user_id=?2 AND source=?3)",params![character_id,user_id,source.id],|r|r.get(0)).map_err(err)?;
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
                    let eligible:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM memories m JOIN messages old ON old.id=m.source JOIN messages new ON new.id=?2 WHERE m.id=?1 AND m.character_id=?3 AND m.user_id=?4 AND m.deleted=0 AND m.locked=0 AND m.expired=0 AND old.seq<new.seq)",params![old,source.id,character_id,user_id],|r|r.get(0)).map_err(err)?;
                    if !eligible {
                        continue;
                    }
                    block_source(&tx, old)?;
                    changed |= tx
                        .execute("UPDATE memories SET deleted=1 WHERE id=?1", [old])
                        .map_err(err)?
                        > 0;
                }
                changed|=tx.execute("INSERT OR IGNORE INTO memories(id,content,source,updated,character_id,user_id,kind,source_text,source_created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",params![uuid::Uuid::new_v4().to_string(),content,source.id,chrono::Utc::now().timestamp_millis(),character_id,user_id,field(item,"kind"),source.content,source.created_at]).map_err(err)?>0;
            }
        }
    }
    if complete_jobs {
        for id in submitted_ids {
            tx.execute("UPDATE memory_analysis_jobs SET state='done',reason=NULL,next_attempt_at=0 WHERE message_id=?1 AND state='pending'", [id]).map_err(err)?;
        }
    }
    if changed {
        bump_revision(&tx)?;
    }
    tx.commit().map_err(err)
}

// Called only for a newly inserted input, after immutable target identities are saved.
pub(super) fn apply_direct_affinity(conn: &Connection, source: &Message) -> Result<()> {
    if source.role != "user" || source.status != "complete" {
        return Ok(());
    }
    let normalized = source.content.trim().trim_end_matches(['!', '.', '~', ' ']);
    let (kind, delta) = match normalized {
        "고마워" | "고마워요" | "감사합니다" => ("thanks", 1),
        "꺼져" | "멍청이" => ("insult", -1),
        _ => return Ok(()),
    };
    let day = chrono::DateTime::from_timestamp_millis(source.created_at)
        .ok_or("잘못된 메시지 시간")?
        .date_naive()
        .to_string();
    let user_id = super::message_user_id(conn, &source.id)?;
    for character_id in super::messages::message_targets(conn, &source.id)? {
        let spent:i32 = conn.query_row("SELECT COALESCE(SUM(ABS(delta)),0) FROM character_affinity WHERE character_id=?1 AND day=?2 AND user_id=?3 AND source NOT LIKE 'story:%'",params![character_id,day,user_id],|row|row.get(0)).map_err(err)?;
        let repeated:bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM character_affinity WHERE character_id=?1 AND day=?2 AND fingerprint=?3 AND user_id=?4 AND source NOT LIKE 'story:%')",params![character_id,day,kind,user_id],|row|row.get(0)).map_err(err)?;
        if spent < 3 && !repeated {
            conn.execute(
                "INSERT OR IGNORE INTO character_affinity(source,character_id,day,delta,fingerprint,user_id) VALUES(?1,?2,?3,?4,?5,?6)",
                params![source.id, character_id, day, delta, kind,user_id],
            )
            .map_err(err)?;
        }
    }
    Ok(())
}

pub fn idle_memories(conn: &Connection, at: i64) -> Result<Vec<Memory>> {
    recall_memories(conn, &crate::characters::active_ids(conn)?, at, 8)
}

pub fn completed_conversation_sources(
    conn: &Connection,
    messages: &[Message],
) -> Result<Vec<String>> {
    let mut complete = Vec::new();
    for message in messages {
        let exists:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM messages m JOIN message_presentations shown ON shown.message_id=m.id JOIN message_context c ON c.message_id=m.id JOIN message_users mu ON mu.message_id=m.id WHERE m.role='assistant' AND json_extract(m.data,'$.status')='complete' AND c.source IN ('llm','wordbook') AND mu.user_id=?2 AND (substr(m.id,1,length(?1)+7)='reply:'||?1||':' OR substr(m.id,1,length(?1)+7)='scene:'||?1||':'))",params![message.id,super::message_user_id(conn,&message.id)?],|r|r.get(0)).map_err(err)?;
        if exists {
            complete.push(message.id.clone());
        }
    }
    Ok(complete)
}

pub fn analysis_memories(conn: &Connection, pending: &[Message]) -> Result<Vec<Memory>> {
    let mut scopes = std::collections::BTreeSet::new();
    for message in pending {
        let user = super::message_user_id(conn, &message.id)?;
        for character in super::message_targets(conn, &message.id)? {
            scopes.insert((character, user.clone()));
        }
    }
    Ok(memories(conn)?
        .into_iter()
        .filter(|memory| scopes.contains(&(memory.character_id.clone(), memory.user_id.clone())))
        .collect())
}

pub fn inherit_recall(conn: &Connection, key: &str, history_ids: &[String]) -> Result<()> {
    let tx = conn.unchecked_transaction().map_err(err)?;
    let active = serde_json::to_string(&crate::characters::active_ids(&tx)?).map_err(err)?;
    for source in history_ids {
        tx.execute("INSERT OR IGNORE INTO recall_dependencies SELECT ?2,memory_id,content_version FROM recall_dependencies WHERE key=?1",params![source,key]).map_err(err)?;
        tx.execute("INSERT OR IGNORE INTO recall_sources SELECT ?2,message_id,character_id,user_id FROM recall_sources WHERE key=?1",params![source,key]).map_err(err)?;
        tx.execute("INSERT OR IGNORE INTO recall_sources SELECT ?2,m.id,i.character_id,mu.user_id FROM messages m JOIN message_users mu ON mu.message_id=m.id JOIN message_characters i ON i.message_id=m.id WHERE m.id=?1 AND m.role='user' AND i.character_id IN (SELECT value FROM json_each(?3)) AND NOT EXISTS(SELECT 1 FROM memory_exclusions e WHERE e.source=m.id AND e.character_id=i.character_id AND e.user_id=mu.user_id)",params![source,key,active]).map_err(err)?;
        tx.execute("UPDATE recall_contexts SET valid_until=(SELECT MIN(deadline) FROM (SELECT valid_until AS deadline FROM recall_contexts WHERE key IN (?1,?2))) WHERE key=?2",params![source,key]).map_err(err)?;
    }
    tx.commit().map_err(err)
}
