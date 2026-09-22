use super::{bump_revision, err, revision, Result};
use crate::types::{Memory, Message, Relationship};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

#[allow(dead_code)] // Retained for tests and developer smoke examples; app UI uses memory_page.
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
    crate::characters::active_ids(conn)?
        .iter()
        .map(|id| {
            let sum: i32 = conn
                .query_row(
                    "SELECT COALESCE(SUM(delta),0) FROM character_affinity WHERE character_id=?",
                    [id],
                    |r| r.get(0),
                )
                .map_err(err)?;
            Ok(Relationship {
                persona: id.clone(),
                score: (20 + sum).clamp(0, 100),
            })
        })
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
    for character_id in super::messages::message_targets(conn, &source.id)? {
        let spent:i32 = conn.query_row("SELECT COALESCE(SUM(ABS(delta)),0) FROM character_affinity WHERE character_id=?1 AND day=?2 AND source NOT LIKE 'story:%'",params![character_id,day],|row|row.get(0)).map_err(err)?;
        let repeated:bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM character_affinity WHERE character_id=?1 AND day=?2 AND fingerprint=?3 AND source NOT LIKE 'story:%')",params![character_id,day,kind],|row|row.get(0)).map_err(err)?;
        if spent < 3 && !repeated {
            conn.execute(
                "INSERT OR IGNORE INTO character_affinity VALUES(?1,?2,?3,?4,?5)",
                params![source.id, character_id, day, delta, kind],
            )
            .map_err(err)?;
        }
    }
    Ok(())
}
