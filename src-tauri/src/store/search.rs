use super::memory::{eligible_memory, memory_row, recall_weight, MEMORY_FIELDS};
use super::{err, get, put, Result};
use crate::types::Memory;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

const VECTOR_DIMENSIONS: usize = 384;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryPage {
    pub items: Vec<Memory>,
    pub total: usize,
    pub offset: usize,
    pub next_offset: Option<usize>,
    pub revision: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemorySearchHit {
    pub memory: Memory,
    pub content_version: i64,
    pub methods: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexMemory {
    pub id: String,
    pub content: String,
    pub content_version: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryEmbedding {
    pub window_start: usize,
    pub window_end: usize,
    pub vector: Vec<f32>,
}

pub(super) fn initialize(conn: &Connection) -> Result<()> {
    let tx = conn.unchecked_transaction().map_err(err)?;
    let has_version = tx
        .prepare("PRAGMA table_info(memories)")
        .map_err(err)?
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?
        .iter()
        .any(|column| column == "content_version");
    if !has_version {
        tx.execute_batch(
            "ALTER TABLE memories ADD COLUMN content_version INTEGER NOT NULL DEFAULT 1;",
        )
        .map_err(err)?;
    }
    tx.execute_batch("INSERT OR IGNORE INTO kv VALUES('memory_revision','0');
        CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(memory_id UNINDEXED,raw,kiwi,tokenize='unicode61');
        CREATE TABLE IF NOT EXISTS memory_tokens(memory_id TEXT PRIMARY KEY REFERENCES memories(id),content_version INTEGER NOT NULL,profile TEXT NOT NULL,tokens TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS memory_vectors(memory_id TEXT NOT NULL REFERENCES memories(id),content_version INTEGER NOT NULL,profile TEXT NOT NULL,window_start INTEGER NOT NULL,window_end INTEGER NOT NULL,vector BLOB NOT NULL,PRIMARY KEY(memory_id,profile,window_start));
        CREATE INDEX IF NOT EXISTS memory_vectors_profile ON memory_vectors(profile);
        CREATE TRIGGER IF NOT EXISTS memory_search_insert AFTER INSERT ON memories BEGIN
            INSERT INTO memory_fts(memory_id,raw,kiwi) SELECT new.id,new.content,'' WHERE new.deleted=0;
            UPDATE kv SET value=CAST(CAST(value AS INTEGER)+1 AS TEXT) WHERE key='memory_revision';
        END;
        CREATE TRIGGER IF NOT EXISTS memory_search_update AFTER UPDATE OF content,deleted ON memories
        WHEN old.content!=new.content OR old.deleted!=new.deleted BEGIN
            UPDATE memories SET content_version=old.content_version+1 WHERE id=new.id;
            DELETE FROM memory_fts WHERE memory_id=new.id;
            INSERT INTO memory_fts(memory_id,raw,kiwi) SELECT new.id,new.content,'' WHERE new.deleted=0;
            DELETE FROM memory_tokens WHERE memory_id=new.id;
            DELETE FROM memory_vectors WHERE memory_id=new.id;
            UPDATE kv SET value=CAST(CAST(value AS INTEGER)+1 AS TEXT) WHERE key='memory_revision';
        END;
        CREATE TRIGGER IF NOT EXISTS memory_search_delete AFTER DELETE ON memories BEGIN
            DELETE FROM memory_fts WHERE memory_id=old.id;
            DELETE FROM memory_tokens WHERE memory_id=old.id;
            DELETE FROM memory_vectors WHERE memory_id=old.id;
            UPDATE kv SET value=CAST(CAST(value AS INTEGER)+1 AS TEXT) WHERE key='memory_revision';
        END;")
        .map_err(err)?;
    if get::<bool>(&tx, "memory_search_v1")? != Some(true) {
        tx.execute_batch("DELETE FROM memory_fts; INSERT INTO memory_fts(memory_id,raw,kiwi) SELECT id,content,'' FROM memories WHERE deleted=0;")
            .map_err(err)?;
        put(&tx, "memory_search_v1", &true)?;
    }
    tx.commit().map_err(err)
}

pub fn memory_count(conn: &Connection) -> Result<usize> {
    conn.query_row(
        "SELECT COUNT(*) FROM memories WHERE deleted=0 AND expired=0",
        [],
        |row| row.get(0),
    )
    .map_err(err)
}

pub fn memory_revision(conn: &Connection) -> Result<i64> {
    Ok(get(conn, "memory_revision")?.unwrap_or(0))
}

#[cfg(test)]
pub fn memory_page(conn: &Connection, offset: usize, limit: usize) -> Result<MemoryPage> {
    let limit = limit.clamp(1, 50);
    let total = memory_count(conn)?;
    let offset = offset.min(total);
    let mut statement = conn.prepare(&format!("SELECT {MEMORY_FIELDS} FROM memories m WHERE deleted=0 AND expired=0 ORDER BY updated DESC,id LIMIT ?1 OFFSET ?2")).map_err(err)?;
    let items = statement
        .query_map(params![limit as i64, offset as i64], memory_row)
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    let end = offset + items.len();
    Ok(MemoryPage {
        items,
        total,
        offset,
        next_offset: (end < total).then_some(end),
        revision: memory_revision(conn)?,
    })
}

fn profile_key(kind: &str) -> Result<String> {
    match kind {
        "kiwi" | "semantic" => Ok(format!("memory_search_profile:{kind}")),
        _ => Err("알 수 없는 검색 모델입니다.".into()),
    }
}

pub fn set_search_profile(conn: &Connection, kind: &str, profile: Option<&str>) -> Result<()> {
    let key = profile_key(kind)?;
    let tx = conn.unchecked_transaction().map_err(err)?;
    let previous: Option<String> = get(&tx, &key)?;
    if previous.as_deref() != profile {
        if kind == "kiwi" {
            tx.execute_batch("DELETE FROM memory_tokens; UPDATE memory_fts SET kiwi='';")
                .map_err(err)?;
        } else {
            tx.execute("DELETE FROM memory_vectors", []).map_err(err)?;
        }
        if let Some(profile) = profile {
            put(&tx, &key, &profile)?;
        } else {
            tx.execute("DELETE FROM kv WHERE key=?1", [&key])
                .map_err(err)?;
        }
    }
    tx.commit().map_err(err)
}

fn profile_matches(conn: &Connection, kind: &str, profile: &str) -> Result<bool> {
    Ok(get::<String>(conn, &profile_key(kind)?)?.as_deref() == Some(profile))
}

pub fn clear_search_index(conn: &Connection, kind: &str) -> Result<()> {
    set_search_profile(conn, kind, None)
}

pub fn pending_index_count(conn: &Connection, kind: &str, profile: &str) -> Result<usize> {
    if !profile_matches(conn, kind, profile)? {
        return memory_count(conn);
    }
    let table = if kind == "kiwi" {
        "memory_tokens"
    } else {
        "memory_vectors"
    };
    conn.query_row(&format!("SELECT COUNT(*) FROM memories m WHERE deleted=0 AND expired=0 AND NOT EXISTS
        (SELECT 1 FROM {table} i WHERE i.memory_id=m.id AND i.content_version=m.content_version AND i.profile=?1)"),
        [profile], |row|row.get(0)).map_err(err)
}

pub fn next_memory_for_index(
    conn: &Connection,
    kind: &str,
    profile: &str,
) -> Result<Option<IndexMemory>> {
    if !profile_matches(conn, kind, profile)? {
        return Ok(None);
    }
    let table = if kind == "kiwi" {
        "memory_tokens"
    } else {
        "memory_vectors"
    };
    conn.query_row(&format!("SELECT id,content,content_version FROM memories m WHERE deleted=0 AND expired=0 AND NOT EXISTS
        (SELECT 1 FROM {table} i WHERE i.memory_id=m.id AND i.content_version=m.content_version AND i.profile=?1)
        ORDER BY updated DESC,id LIMIT 1"), [profile], |row| Ok(IndexMemory {id:row.get(0)?,content:row.get(1)?,content_version:row.get(2)?}))
        .optional().map_err(err)
}

fn index_matches(
    conn: &Connection,
    id: &str,
    version: i64,
    kind: &str,
    profile: &str,
) -> Result<bool> {
    Ok(profile_matches(conn, kind, profile)? && conn.query_row("SELECT EXISTS(SELECT 1 FROM memories WHERE id=?1 AND content_version=?2 AND deleted=0 AND expired=0)", params![id,version], |row| row.get::<_,bool>(0)).map_err(err)?)
}

pub fn save_kiwi_index(
    conn: &Connection,
    id: &str,
    version: i64,
    profile: &str,
    tokens: &str,
) -> Result<bool> {
    let tx = conn.unchecked_transaction().map_err(err)?;
    if !index_matches(&tx, id, version, "kiwi", profile)? {
        return Ok(false);
    }
    tx.execute(
        "INSERT OR REPLACE INTO memory_tokens VALUES(?1,?2,?3,?4)",
        params![id, version, profile, tokens],
    )
    .map_err(err)?;
    tx.execute(
        "UPDATE memory_fts SET kiwi=?2 WHERE memory_id=?1",
        params![id, tokens],
    )
    .map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(true)
}

pub fn save_vector_index(
    conn: &Connection,
    id: &str,
    version: i64,
    profile: &str,
    windows: &[MemoryEmbedding],
) -> Result<bool> {
    if windows.is_empty()
        || windows.iter().any(|window| {
            window.window_end < window.window_start
                || window.vector.len() != VECTOR_DIMENSIONS
                || window.vector.iter().any(|value| !value.is_finite())
        })
    {
        return Err("의미 검색 벡터 형식이 올바르지 않습니다.".into());
    }
    let tx = conn.unchecked_transaction().map_err(err)?;
    if !index_matches(&tx, id, version, "semantic", profile)? {
        return Ok(false);
    }
    let content: String = tx
        .query_row("SELECT content FROM memories WHERE id=?1", [id], |row| {
            row.get(0)
        })
        .map_err(err)?;
    if windows.iter().any(|window| {
        !content.is_char_boundary(window.window_start)
            || !content.is_char_boundary(window.window_end)
    }) {
        return Err("의미 검색 구간이 원문 UTF-8 범위와 일치하지 않습니다.".into());
    }
    tx.execute("DELETE FROM memory_vectors WHERE memory_id=?1", [id])
        .map_err(err)?;
    for window in windows {
        let bytes: Vec<u8> = window
            .vector
            .iter()
            .flat_map(|value| value.to_le_bytes())
            .collect();
        tx.execute(
            "INSERT INTO memory_vectors VALUES(?1,?2,?3,?4,?5,?6)",
            params![
                id,
                version,
                profile,
                window.window_start as i64,
                window.window_end as i64,
                bytes
            ],
        )
        .map_err(err)?;
    }
    tx.commit().map_err(err)?;
    Ok(true)
}

// These are grammatical/request words, not topics inferred from stored memories.
// Keeping them out of candidate generation avoids matching every user fact on "내가".
fn is_query_function_word(term: &str) -> bool {
    matches!(
        term,
        "나" | "나는"
            | "내"
            | "내가"
            | "나를"
            | "내게"
            | "내겐"
            | "나에게"
            | "나한테"
            | "나의"
            | "난"
            | "날"
            | "저"
            | "저는"
            | "제"
            | "제가"
            | "저를"
            | "저에게"
            | "너"
            | "너는"
            | "네"
            | "네가"
            | "너의"
            | "넌"
            | "우리"
            | "우리는"
            | "우리가"
            | "저희"
            | "이"
            | "그"
            | "저것"
            | "이것"
            | "그것"
            | "뭐"
            | "뭘"
            | "뭐야"
            | "뭐지"
            | "뭐였지"
            | "뭐였어"
            | "뭐였더라"
            | "무엇"
            | "무엇을"
            | "무슨"
            | "어디"
            | "어디야"
            | "어디지"
            | "어디였지"
            | "언제"
            | "언제야"
            | "언제지"
            | "누구"
            | "누가"
            | "누구야"
            | "왜"
            | "어떻게"
            | "어떤"
            | "어느"
            | "얼마"
            | "얼마야"
            | "몇"
            | "좀"
            | "혹시"
            | "정말"
            | "바로"
            | "다시"
            | "때"
            | "거"
            | "건"
            | "걸"
            | "것"
            | "것을"
            | "것이"
            | "수"
            | "은"
            | "는"
            | "가"
            | "을"
            | "를"
            | "에"
            | "의"
            | "도"
            | "요"
            | "야"
            | "지"
            | "다"
            | "하"
            | "해"
            | "해줘"
            | "하는"
            | "한"
            | "할"
            | "할까"
            | "해야"
            | "했어"
            | "했었지"
            | "있"
            | "있어"
            | "있는"
            | "있는지"
            | "있나"
            | "있니"
            | "있지"
            | "이야"
            | "이고"
            | "인지"
            | "인가"
            | "이었어"
            | "였지"
            | "였어"
            | "일까"
            | "맞지"
            | "줘"
            | "주세요"
            | "줄래"
            | "알"
            | "알리"
            | "알려"
            | "알고"
            | "알려줘"
            | "알려주세요"
            | "알려줄래"
            | "알려줬었나"
            | "기억"
            | "기억해"
            | "기억하니"
            | "기억하나요"
            | "기억해줘"
            | "기억나"
            | "말하"
            | "말해"
            | "말해줘"
            | "말해줄래"
            | "i"
            | "me"
            | "my"
            | "mine"
            | "you"
            | "your"
            | "we"
            | "our"
            | "the"
            | "a"
            | "an"
            | "is"
            | "am"
            | "are"
            | "was"
            | "were"
            | "what"
            | "which"
            | "when"
            | "where"
            | "why"
            | "how"
            | "do"
            | "does"
            | "did"
            | "please"
            | "tell"
            | "remember"
            | "know"
            | "about"
    )
}

fn search_words(text: &str) -> impl Iterator<Item = String> + '_ {
    text.split(|character: char| !character.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(str::to_lowercase)
}

fn query_terms(words: impl Iterator<Item = String>) -> Vec<String> {
    words
        .filter(|term| !is_query_function_word(term))
        .take(32)
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn candidates_with_term_coverage(
    conn: &Connection,
    terms: &[String],
    candidates: &[String],
    raw_only: bool,
) -> Result<BTreeSet<String>> {
    if terms.is_empty() || candidates.is_empty() {
        return Ok(BTreeSet::new());
    }
    // Use FTS itself for term coverage so unicode61 case/accent normalization
    // and token boundaries are identical to candidate generation.
    let ids = serde_json::to_string(candidates).map_err(err)?;
    let mut counts: BTreeMap<String, usize> = BTreeMap::new();
    let mut statement = conn.prepare("SELECT memory_id FROM memory_fts WHERE memory_fts MATCH ?1 AND memory_id IN (SELECT value FROM json_each(?2))").map_err(err)?;
    for term in terms {
        let expression = format!("{}\"{term}\"*", if raw_only { "raw : " } else { "" });
        let matching = statement
            .query_map(params![expression, ids], |row| row.get::<_, String>(0))
            .map_err(err)?;
        for id in matching {
            *counts.entry(id.map_err(err)?).or_default() += 1;
        }
    }
    // A lone keyword remains useful. For a question with multiple content terms,
    // one shared topic is insufficient evidence for the requested detail.
    let required = if terms.len() == 1 {
        1
    } else {
        (terms.len() * 2).div_ceil(3).max(2)
    };
    Ok(counts
        .into_iter()
        .filter_map(|(id, count)| (count >= required).then_some(id))
        .collect())
}

pub fn revalidate_search_hits(conn: &Connection, hits: &[MemorySearchHit]) -> Result<Vec<Memory>> {
    let at = super::effective_memory_time(conn, chrono::Utc::now().timestamp_millis())?;
    let mut memories = Vec::new();
    let mut counts = BTreeMap::<String, usize>::new();
    for hit in hits.iter().take(8) {
        let memory=conn.query_row(&format!("SELECT {MEMORY_FIELDS} FROM memories m WHERE id=?1 AND content_version=?2 AND deleted=0 AND expired=0"),params![hit.memory.id,hit.content_version],memory_row).optional().map_err(err)?;
        if let Some(mut memory) = memory {
            if !eligible_memory(conn, &memory, at)? {
                continue;
            }
            memory.recall_weight = recall_weight(memory.retired_at, at);
            let count = counts.entry(memory.user_id.clone()).or_default();
            if *count >= (8.0 * memory.recall_weight).ceil() as usize {
                continue;
            }
            *count += 1;
            memories.push(memory);
        }
    }
    Ok(memories)
}

pub fn search_memories_for(
    conn: &Connection,
    query: &str,
    kiwi: &[String],
    semantic: Option<(&str, &[f32], f32)>,
    character_ids: &[String],
    at: i64,
) -> Result<Vec<MemorySearchHit>> {
    super::expire_memories(conn, at)?;
    search_scoped(
        conn,
        query,
        kiwi,
        semantic,
        Some(character_ids),
        super::effective_memory_time(conn, at)?,
    )
}

#[cfg(test)]
pub fn search_memories(
    conn: &Connection,
    query: &str,
    kiwi: &[String],
    semantic: Option<(&str, &[f32], f32)>,
) -> Result<Vec<MemorySearchHit>> {
    search_scoped(
        conn,
        query,
        kiwi,
        semantic,
        None,
        super::effective_memory_time(conn, chrono::Utc::now().timestamp_millis())?,
    )
}

fn search_scoped(
    conn: &Connection,
    query: &str,
    kiwi: &[String],
    semantic: Option<(&str, &[f32], f32)>,
    scope: Option<&[String]>,
    at: i64,
) -> Result<Vec<MemorySearchHit>> {
    let scope = serde_json::to_string(&scope).map_err(err)?;
    let mut ranks: BTreeMap<String, (f64, BTreeSet<String>)> = BTreeMap::new();
    let raw_terms = query_terms(search_words(query));
    let kiwi_terms = query_terms(kiwi.iter().flat_map(|term| search_words(term)));
    let expression = |terms: &[String]| {
        terms
            .iter()
            .map(|term| format!("\"{term}\"*"))
            .collect::<Vec<_>>()
            .join(" OR ")
    };
    let mut clauses = Vec::new();
    if !raw_terms.is_empty() {
        clauses.push(format!("raw : ({})", expression(&raw_terms)));
    }
    if !kiwi_terms.is_empty() {
        clauses.push(format!("({})", expression(&kiwi_terms)));
    }
    if !clauses.is_empty() {
        let mut statement = conn.prepare("SELECT memory_id FROM memory_fts JOIN memories m ON m.id=memory_id WHERE memory_fts MATCH ?1 AND m.deleted=0 AND m.expired=0 AND (?2='null' OR m.character_id IN (SELECT value FROM json_each(?2))) ORDER BY bm25(memory_fts),m.id LIMIT 20").map_err(err)?;
        let lexical = statement
            .query_map(params![clauses.join(" OR "), scope], |row| {
                row.get::<_, String>(0)
            })
            .map_err(err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(err)?;
        // Surface words and lemmas represent separate evidence paths: a word
        // and its lemma must not inflate the count for one shared concept.
        let raw_matches = candidates_with_term_coverage(conn, &raw_terms, &lexical, true)?;
        let kiwi_matches = candidates_with_term_coverage(conn, &kiwi_terms, &lexical, false)?;
        let qualified = lexical.into_iter().filter_map(|id| {
            let kiwi_match = kiwi_matches.contains(&id);
            (raw_matches.contains(&id) || kiwi_match).then_some((id, kiwi_match))
        });
        for (rank, (id, kiwi_match)) in qualified.enumerate() {
            let entry = ranks.entry(id).or_default();
            entry.0 += 1.0 / (61 + rank) as f64;
            entry.1.insert("lexical".into());
            if kiwi_match {
                entry.1.insert("kiwi".into());
            }
        }
    }
    if let Some((profile, vector, threshold)) = semantic {
        if vector.len() == VECTOR_DIMENSIONS
            && vector.iter().all(|value| value.is_finite())
            && threshold.is_finite()
            && profile_matches(conn, "semantic", profile)?
        {
            let mut statement = conn.prepare("SELECT i.memory_id,i.vector FROM memory_vectors i JOIN memories m ON m.id=i.memory_id WHERE m.deleted=0 AND m.expired=0 AND m.content_version=i.content_version AND i.profile=?1 AND (?2='null' OR m.character_id IN (SELECT value FROM json_each(?2)))").map_err(err)?;
            let rows = statement
                .query_map(params![profile, scope], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?))
                })
                .map_err(err)?;
            let mut best: BTreeMap<String, f32> = BTreeMap::new();
            for row in rows {
                let (id, bytes) = row.map_err(err)?;
                if bytes.len() != VECTOR_DIMENSIONS * 4 {
                    continue;
                }
                let score: f32 = bytes
                    .chunks_exact(4)
                    .zip(vector)
                    .map(|(bytes, query)| {
                        f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) * query
                    })
                    .sum();
                if score.is_finite() && score >= threshold {
                    best.entry(id)
                        .and_modify(|previous| *previous = previous.max(score))
                        .or_insert(score);
                }
            }
            let mut candidates: Vec<_> = best.into_iter().collect();
            candidates.sort_by(|left, right| {
                right
                    .1
                    .total_cmp(&left.1)
                    .then_with(|| left.0.cmp(&right.0))
            });
            for (rank, (id, _)) in candidates.into_iter().take(20).enumerate() {
                let entry = ranks.entry(id).or_default();
                entry.0 += 1.0 / (61 + rank) as f64;
                entry.1.insert("semantic".into());
            }
        }
    }
    let mut candidates = Vec::new();
    for (id, (rank, methods)) in ranks {
        let hit=conn.query_row(&format!("SELECT {MEMORY_FIELDS},m.content_version FROM memories m WHERE id=?1 AND deleted=0 AND expired=0"),[id],|row|Ok(MemorySearchHit{memory:memory_row(row)?,content_version:row.get(11)?,methods:methods.into_iter().collect()})).optional().map_err(err)?;
        if let Some(mut hit) = hit {
            if !eligible_memory(conn, &hit.memory, at)? {
                continue;
            }
            hit.memory.recall_weight = recall_weight(hit.memory.retired_at, at);
            candidates.push((rank * hit.memory.recall_weight, hit));
        }
    }
    candidates.sort_by(|left, right| {
        right
            .0
            .total_cmp(&left.0)
            .then_with(|| left.1.memory.id.cmp(&right.1.memory.id))
    });
    let mut result = Vec::new();
    let mut counts = BTreeMap::<String, usize>::new();
    for (_, hit) in candidates {
        let count = counts.entry(hit.memory.user_id.clone()).or_default();
        if *count >= (8.0 * hit.memory.recall_weight).ceil() as usize {
            continue;
        }
        *count += 1;
        result.push(hit);
        if result.len() == 8 {
            break;
        }
    }
    Ok(result)
}
