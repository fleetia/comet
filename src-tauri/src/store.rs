use crate::types::*;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
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
    crate::widgets::storage::initialize(&conn)?;
    Ok(conn)
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

fn initialize_identities(conn: &Connection) -> Result<()> {
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
    let ids = crate::characters::active_ids(conn)?;
    let a = ids.first().cloned().ok_or("바탕화면에 캐릭터가 없습니다.")?;
    let b = ids.get(1).cloned();
    let mut stmt = conn.prepare("SELECT data FROM (
        SELECT seq,data FROM messages AS message
        WHERE EXISTS (SELECT 1 FROM message_characters i WHERE i.message_id=message.id AND i.character_id IN (?2,?3) AND (?4 IS NULL OR i.character_id=?4))
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
            bump_revision(&tx)?;
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
        .zip(["a", "b"])
        .map(|(id, persona)| {
            let sum: i32 = conn
                .query_row(
                    "SELECT COALESCE(SUM(delta),0) FROM character_affinity WHERE character_id=?",
                    [id],
                    |r| r.get(0),
                )
                .map_err(err)?;
            Ok(Relationship {
                persona: persona.into(),
                score: (20 + sum).clamp(0, 100),
            })
        })
        .collect()
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
pub fn last_analysis_id(conn: &Connection) -> Result<Option<String>> {
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
                    "SELECT COALESCE(SUM(ABS(delta)),0) FROM character_affinity WHERE character_id=?1 AND day=?2",
                    params![character_id, day],
                    |r| r.get(0),
                )
                .map_err(err)?;
            let fingerprint = field(item, "kind");
            let repeated:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM character_affinity WHERE character_id=?1 AND day=?2 AND fingerprint=?3)",params![character_id,day,fingerprint],|r|r.get(0)).map_err(err)?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn message(id: &str, role: &str, text: &str) -> Message {
        Message {
            id: id.into(),
            role: role.into(),
            persona: Some("a".into()),
            content: text.into(),
            expression: None,
            created_at: 1_800_000_000_000,
            status: "complete".into(),
        }
    }
    fn fact(id: &str, text: &str) -> Value {
        json!({"kind":"user_fact","certain":true,"sourceMessageId":id,"evidence":text,"supersedesId":""})
    }
    fn apply(conn: &Connection, facts: Vec<Value>, events: Vec<Value>) {
        analyze_apply(
            conn,
            &json!({"revision":revision(conn).unwrap(),"memories":facts,"events":events}),
        )
        .unwrap();
    }
    #[test]
    fn single_member_roster_reads_context_and_relationships_for_the_first_seat() {
        let conn = open(Path::new(":memory:")).unwrap();
        crate::characters::apply_roster(&conn, vec!["builtin-b".into()]).unwrap();
        insert_message(&conn, &message("hello", "user", "안녕")).unwrap();
        insert_message(&conn, &message("reply", "assistant", "반가워")).unwrap();
        assert_eq!(relationships(&conn).unwrap().len(), 1);
        assert_eq!(relationships(&conn).unwrap()[0].persona, "a");
        let context = context_messages_for(&conn, 10, "a").unwrap();
        assert_eq!(context.len(), 2);
        assert!(context.iter().all(|m| m.persona.as_deref() == Some("a")));
        assert!(context_messages_for(&conn, 10, "b").is_err());
        let mut to_b = message("to-b", "user", "거기?");
        to_b.persona = Some("b".into());
        assert!(insert_message(&conn, &to_b).is_err());
        assert_eq!(messages(&conn, 10).unwrap().len(), 2);
    }
    #[test]
    fn swaps_restore_relationships_and_late_analysis_uses_original_target() {
        let conn = open(Path::new(":memory:")).unwrap();
        let mut thanks = message("thanks", "user", "고마워");
        thanks.persona = Some("both".into());
        insert_message(&conn, &thanks).unwrap();
        insert_message(&conn, &message("old-reply", "assistant", "반가워")).unwrap();
        insert_message(&conn, &message("fact", "user", "나는 차를 좋아해")).unwrap();
        apply(&conn, vec![fact("fact", "나는 차를 좋아해")], vec![]);
        let created = crate::characters::clone_character(&conn, "builtin-a").unwrap();
        crate::characters::assign(&conn, "a", &created.id).unwrap();
        apply(
            &conn,
            vec![],
            vec![
                json!({"sourceMessageId":"thanks","evidence":"고마워","kind":"thanks","certain":true,"persona":"a"}),
                json!({"sourceMessageId":"thanks","evidence":"고마워","kind":"thanks","certain":true,"persona":"b"}),
            ],
        );
        assert_eq!(relationships(&conn).unwrap()[0].score, 20);
        assert_eq!(relationships(&conn).unwrap()[1].score, 21);
        assert!(context_messages_for(&conn, 100, "a").unwrap().is_empty());
        assert_eq!(
            context_messages_for(&conn, 100, "b").unwrap()[0].id,
            "thanks"
        );
        assert_eq!(memories(&conn).unwrap()[0].content, "나는 차를 좋아해");
        assert_eq!(messages(&conn, 100).unwrap().len(), 3);
        crate::characters::assign(&conn, "a", "builtin-a").unwrap();
        assert_eq!(relationships(&conn).unwrap()[0].score, 21);
        assert_eq!(context_messages_for(&conn, 100, "a").unwrap().len(), 3);
        apply(
            &conn,
            vec![],
            vec![
                json!({"sourceMessageId":"thanks","evidence":"고마워","kind":"thanks","certain":true,"persona":"a"}),
            ],
        );
        assert_eq!(relationships(&conn).unwrap()[0].score, 21);
    }
    #[test]
    fn historical_identity_survives_rename_reinsert_and_slot_move() {
        let conn = open(Path::new(":memory:")).unwrap();
        let original = message("reply", "assistant", "안녕!");
        insert_message(&conn, &original).unwrap();
        let old = message_identities(&conn, 1).unwrap();
        let mut renamed = crate::characters::active_character(&conn, "a")
            .unwrap()
            .definition;
        renamed.name = "새 이름".into();
        crate::characters::save(&conn, "builtin-a", &renamed).unwrap();
        insert_message(&conn, &original).unwrap();
        assert_eq!(message_identities(&conn, 1).unwrap(), old);
        assert_eq!(old[0].name, "A");
        insert_message(&conn, &message("new-reply", "assistant", "다시 안녕!")).unwrap();
        let latest = message_identities(&conn, 1).unwrap();
        assert_eq!(latest[0].name, "새 이름");
        assert!(latest[0].version > old[0].version);
        crate::characters::apply_pair(&conn, ["builtin-b".into(), "builtin-a".into()]).unwrap();
        let context = context_messages_for(&conn, 10, "b").unwrap();
        assert_eq!(context.len(), 2);
        assert!(context.iter().all(|m| m.persona.as_deref() == Some("b")));
        assert_eq!(
            messages(&conn, 10).unwrap()[0].persona.as_deref(),
            Some("a")
        );
        assert_eq!(message_identities(&conn, 10).unwrap()[0], old[0]);
    }
    #[test]
    fn legacy_migration_preserves_raw_history_and_affinity_once() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("legacy.sqlite");
        let legacy = Connection::open(&path).unwrap();
        legacy.execute_batch("CREATE TABLE messages(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,role TEXT NOT NULL,data TEXT NOT NULL);
CREATE TABLE affinity(source TEXT NOT NULL,persona TEXT NOT NULL,day TEXT NOT NULL,delta INTEGER NOT NULL,fingerprint TEXT NOT NULL,PRIMARY KEY(source,persona));").unwrap();
        let mut user = message("original", "user", "고마워");
        user.persona = Some("both".into());
        let raw = serde_json::to_string_pretty(&user).unwrap();
        legacy
            .execute(
                "INSERT INTO messages(id,role,data) VALUES('original','user',?)",
                [&raw],
            )
            .unwrap();
        legacy
            .execute(
                "INSERT INTO affinity VALUES('original','a','2026-09-15',1,'thanks')",
                [],
            )
            .unwrap();
        drop(legacy);
        for _ in 0..2 {
            let conn = open(&path).unwrap();
            let restored: String = conn
                .query_row("SELECT data FROM messages WHERE id='original'", [], |r| {
                    r.get(0)
                })
                .unwrap();
            assert_eq!(restored, raw);
            assert_eq!(
                message_identities(&conn, 1)
                    .unwrap()
                    .iter()
                    .map(|i| i.character_id.as_str())
                    .collect::<Vec<_>>(),
                vec!["builtin-a", "builtin-b"]
            );
            assert_eq!(relationships(&conn).unwrap()[0].score, 21);
            assert_eq!(relationships(&conn).unwrap()[1].score, 20);
            let count: i64 = conn
                .query_row("SELECT COUNT(*) FROM affinity", [], |r| r.get(0))
                .unwrap();
            assert_eq!(count, 1);
            let copied: i64 = conn
                .query_row("SELECT COUNT(*) FROM character_affinity", [], |r| r.get(0))
                .unwrap();
            assert_eq!(copied, 1);
        }
    }
    #[test]
    fn grounds_only_in_user_sources_and_preserves_manual_choices() {
        let conn = open(Path::new(":memory:")).unwrap();
        insert_message(&conn, &message("u", "user", "나는 커피를 좋아해")).unwrap();
        insert_message(&conn, &message("a", "assistant", "사용자는 서울에 산다")).unwrap();
        apply(
            &conn,
            vec![
                fact("a", "사용자는 서울에 산다"),
                fact("u", "서울에 산다"),
                fact("u", "나는 커피를 좋아해"),
            ],
            vec![],
        );
        let stored = memories(&conn).unwrap();
        assert_eq!(stored.len(), 1);
        let stale = json!({"revision":revision(&conn).unwrap(),"memories":[fact("u","나는 커피를 좋아해")],"events":[]});
        edit_memory(&conn, &stored[0].id, "나는 차를 좋아해").unwrap();
        assert!(analyze_apply(&conn, &stale).is_err());
        apply(&conn, vec![fact("u", "나는 커피를 좋아해")], vec![]);
        assert_eq!(memories(&conn).unwrap()[0].content, "나는 차를 좋아해");
        delete_memory(&conn, &stored[0].id).unwrap();
        apply(&conn, vec![fact("u", "나는 커피를 좋아해")], vec![]);
        assert!(memories(&conn).unwrap().is_empty());
    }
    #[test]
    fn correction_replaces_and_old_source_cannot_resurrect() {
        let conn = open(Path::new(":memory:")).unwrap();
        insert_message(&conn, &message("u1", "user", "나는 커피를 좋아해")).unwrap();
        apply(&conn, vec![fact("u1", "나는 커피를 좋아해")], vec![]);
        let old = memories(&conn).unwrap()[0].id.clone();
        insert_message(&conn, &message("u2", "user", "정정할게 나는 차를 좋아해")).unwrap();
        let mut correction = fact("u2", "나는 차를 좋아해");
        correction["supersedesId"] = json!(old);
        apply(&conn, vec![correction], vec![]);
        apply(&conn, vec![fact("u1", "나는 커피를 좋아해")], vec![]);
        assert_eq!(memories(&conn).unwrap().len(), 1);
        assert_eq!(memories(&conn).unwrap()[0].content, "나는 차를 좋아해");
    }
    #[test]
    fn prompt_context_excludes_retired_sources_without_changing_the_transcript() {
        let conn = open(Path::new(":memory:")).unwrap();
        for (id, role, text) in [
            ("old", "user", "나는 커피를 좋아해"),
            ("reply", "assistant", "취향을 알려줘서 고마워"),
            ("corrected", "user", "정정할게 나는 차를 좋아해"),
            ("edited", "user", "나는 서울에 살아"),
            ("deleted", "user", "내 이름은 민수야"),
        ] {
            insert_message(&conn, &message(id, role, text)).unwrap();
        }
        apply(
            &conn,
            vec![
                fact("old", "나는 커피를 좋아해"),
                fact("edited", "나는 서울에 살아"),
                fact("deleted", "내 이름은 민수야"),
            ],
            vec![],
        );
        assert_eq!(context_messages(&conn, 100).unwrap().len(), 5);
        let stored = memories(&conn).unwrap();
        let id_for = |source: &str| {
            stored
                .iter()
                .find(|memory| memory.source_message_id == source)
                .unwrap()
                .id
                .clone()
        };
        let mut correction = fact("corrected", "나는 차를 좋아해");
        correction["supersedesId"] = json!(id_for("old"));
        apply(&conn, vec![correction], vec![]);
        edit_memory(&conn, &id_for("edited"), "나는 부산에 살아").unwrap();
        delete_memory(&conn, &id_for("deleted")).unwrap();
        let context = context_messages(&conn, 100).unwrap();
        assert_eq!(
            context
                .iter()
                .map(|message| message.id.as_str())
                .collect::<Vec<_>>(),
            vec!["reply", "corrected"]
        );
        assert_eq!(context_messages(&conn, 1).unwrap()[0].id, "corrected");
        let transcript = messages(&conn, 100).unwrap();
        assert_eq!(
            transcript
                .iter()
                .map(|message| message.id.as_str())
                .collect::<Vec<_>>(),
            vec!["old", "reply", "corrected", "edited", "deleted"]
        );
        assert_eq!(transcript[0].content, "나는 커피를 좋아해");
        assert_eq!(transcript[3].content, "나는 서울에 살아");
        assert_eq!(transcript[4].content, "내 이름은 민수야");
    }
    #[test]
    fn affinity_replay_farming_and_ambiguous_corrections_do_not_change_scores() {
        let conn = open(Path::new(":memory:")).unwrap();
        for (id, text) in [
            ("1", "고마워"),
            ("2", "고마워"),
            ("3", "고마워, 그런데 그건 틀렸어"),
        ] {
            insert_message(&conn, &message(id, "user", text)).unwrap();
            let event = json!({"sourceMessageId":id,"evidence":text,"kind":"thanks","certain":true,"persona":"a"});
            let mut wrong_target = event.clone();
            wrong_target["persona"] = json!("b");
            apply(&conn, vec![], vec![event.clone(), event, wrong_target]);
        }
        assert_eq!(relationships(&conn).unwrap()[0].score, 21);
        assert_eq!(relationships(&conn).unwrap()[1].score, 20);
    }
    #[test]
    fn daily_cap_counts_absolute_changes() {
        let conn = open(Path::new(":memory:")).unwrap();
        let date = chrono::DateTime::from_timestamp_millis(1_800_000_000_000)
            .unwrap()
            .date_naive()
            .to_string();
        for (source, delta) in [("old1", 1), ("old2", -1), ("old3", 1)] {
            conn.execute(
                "INSERT INTO character_affinity VALUES(?1,'builtin-a',?2,?3,?1)",
                params![source, date, delta],
            )
            .unwrap();
        }
        insert_message(&conn, &message("u", "user", "고마워")).unwrap();
        apply(
            &conn,
            vec![],
            vec![
                json!({"sourceMessageId":"u","evidence":"고마워","kind":"thanks","certain":true,"persona":"a"}),
            ],
        );
        assert_eq!(relationships(&conn).unwrap()[0].score, 21);
    }
    #[test]
    fn user_input_invalidates_prepared_scene_and_pending_tracking_is_bounded() {
        let conn = open(Path::new(":memory:")).unwrap();
        let scene = PreparedScene {
            id: "s".into(),
            revision: 0,
            lines: vec![],
        };
        add_scene(&conn, &scene).unwrap();
        insert_message(&conn, &message("u", "user", "안녕")).unwrap();
        assert!(prepared_scenes(&conn).unwrap().is_empty());
        assert!(add_scene(&conn, &scene).is_err());
        set_last_analysis_id(&conn, "u").unwrap();
        insert_message(&conn, &message("u2", "user", "다시 안녕")).unwrap();
        assert_eq!(pending_user_messages(&conn).unwrap()[0].id, "u2");
    }
}
