use super::Result;
use crate::{store, types::Message};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct ExportOptions {
    pub include_sprites: bool,
    pub include_memories: bool,
    pub include_affinity: bool,
    pub include_messages: bool,
}

impl Default for ExportOptions {
    fn default() -> Self {
        Self {
            include_sprites: true,
            include_memories: false,
            include_affinity: false,
            include_messages: false,
        }
    }
}

impl ExportOptions {
    pub fn includes_archive(&self) -> bool {
        self.include_memories || self.include_affinity || self.include_messages
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ArchivePerson {
    pub id: String,
    pub name: String,
    pub started_at: i64,
    pub ended_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ArchiveMemory {
    pub id: String,
    pub character_source_id: String,
    pub person_id: String,
    pub kind: String,
    pub content: String,
    pub source_id: String,
    pub source_text: String,
    pub source_created_at: i64,
    pub updated_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub required_chapter: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ArchiveAffinity {
    pub character_source_id: String,
    pub person_id: String,
    pub score: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ArchiveSpeaker {
    pub source_id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ArchiveMessage {
    pub id: String,
    pub person_id: String,
    pub role: String,
    pub content: String,
    pub expression: Option<String>,
    pub created_at: i64,
    pub status: String,
    pub source_kind: String,
    pub characters: Vec<ArchiveSpeaker>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CharacterArchive {
    pub exported_at: i64,
    pub people: Vec<ArchivePerson>,
    pub memories: Vec<ArchiveMemory>,
    pub affinity: Vec<ArchiveAffinity>,
    pub messages: Vec<ArchiveMessage>,
}

pub fn initialize(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS character_archived_messages(
        id TEXT PRIMARY KEY,user_id TEXT NOT NULL,data TEXT NOT NULL
    );",
    )
    .map_err(|error| error.to_string())
}

fn bounded(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && value.chars().count() <= max
}

pub fn validate(archive: &CharacterArchive, characters: &HashSet<&String>) -> Result<()> {
    if archive.exported_at < 0 {
        return Err("기록 내보내기 시간이 올바르지 않습니다.".into());
    }
    let mut people = BTreeMap::new();
    for person in &archive.people {
        if !bounded(&person.id, 128)
            || !bounded(&person.name, 40)
            || person.name.chars().any(char::is_control)
            || person.started_at < 0
            || person.ended_at < person.started_at
            || person.ended_at > archive.exported_at
            || people.insert(&person.id, person).is_some()
        {
            return Err("기록의 사용자 이름·참조·시간이 올바르지 않습니다.".into());
        }
    }
    let owns = |character: &String, person: &String| {
        characters.contains(character) && people.contains_key(person)
    };
    let mut used_people = HashSet::new();
    let mut memory_ids = HashSet::new();
    let mut evidence = BTreeMap::new();
    for memory in &archive.memories {
        if !owns(&memory.character_source_id, &memory.person_id)
            || !bounded(&memory.id, 128)
            || !memory_ids.insert(&memory.id)
            || !matches!(memory.kind.as_str(), "user_fact" | "experience")
            || !bounded(&memory.content, 500)
            || !bounded(&memory.source_id, 128)
            || !bounded(&memory.source_text, 12000)
            || memory.source_created_at < 0
            || memory.updated_at < memory.source_created_at
            || memory.updated_at > archive.exported_at
            || memory
                .required_chapter
                .is_some_and(|chapter| !(0..=100).contains(&chapter))
        {
            return Err("기억의 소유자·근거·시간이 올바르지 않습니다.".into());
        }
        let source = (
            &memory.person_id,
            &memory.source_text,
            memory.source_created_at,
        );
        if evidence
            .insert(&memory.source_id, source)
            .is_some_and(|old| old != source)
        {
            return Err("같은 원문의 사용자 또는 내용이 다릅니다.".into());
        }
        used_people.insert(&memory.person_id);
    }
    let mut relations = HashSet::new();
    for affinity in &archive.affinity {
        if !owns(&affinity.character_source_id, &affinity.person_id)
            || !(0..=100).contains(&affinity.score)
            || !relations.insert((&affinity.character_source_id, &affinity.person_id))
        {
            return Err("친밀도 기록의 소유자 또는 값이 올바르지 않습니다.".into());
        }
        used_people.insert(&affinity.person_id);
    }
    let mut message_ids = HashSet::new();
    for message in &archive.messages {
        let mut speakers = HashSet::new();
        if !bounded(&message.id, 128)
            || !message_ids.insert(&message.id)
            || !people.contains_key(&message.person_id)
            || !matches!(message.role.as_str(), "user" | "assistant")
            || !bounded(&message.content, 8000)
            || message.created_at < 0
            || message.created_at > archive.exported_at
            || !bounded(&message.status, 40)
            || !bounded(&message.source_kind, 40)
            || message
                .expression
                .as_ref()
                .is_some_and(|value| !bounded(value, 20))
            || message.characters.is_empty()
            || (message.role == "assistant" && message.characters.len() != 1)
            || message.characters.iter().any(|speaker| {
                !characters.contains(&speaker.source_id)
                    || !bounded(&speaker.name, 40)
                    || !speakers.insert(&speaker.source_id)
            })
        {
            return Err("대화 기록의 화자·본문·시간이 올바르지 않습니다.".into());
        }
        used_people.insert(&message.person_id);
    }
    if used_people.len() != people.len() {
        return Err("개인 기록에서 사용하지 않는 사용자 참조가 있습니다.".into());
    }
    Ok(())
}

fn mapped(map: &BTreeMap<String, String>, id: &str) -> Result<String> {
    map.get(id)
        .cloned()
        .ok_or_else(|| "기록의 참조를 찾을 수 없습니다.".into())
}

pub fn export(
    conn: &Connection,
    characters: &BTreeMap<String, String>,
    options: &ExportOptions,
    at: i64,
) -> Result<CharacterArchive> {
    let at = store::effective_memory_time(conn, at)?;
    let mut archive = CharacterArchive {
        exported_at: at,
        people: Vec::new(),
        memories: Vec::new(),
        affinity: Vec::new(),
        messages: Vec::new(),
    };
    let selected =
        serde_json::to_string(&characters.keys().collect::<Vec<_>>()).map_err(|e| e.to_string())?;
    if options.include_memories {
        let mut statement = conn.prepare("SELECT m.id,m.character_id,m.user_id,m.kind,m.content,m.source,m.source_text,m.source_created_at,m.updated,m.required_chapter
            FROM memories m JOIN user_identities u ON u.id=m.user_id
            WHERE m.character_id IN (SELECT value FROM json_each(?1)) AND m.deleted=0 AND m.expired=0
            AND (u.ended_at IS NULL OR ?2 < u.ended_at+?3) ORDER BY m.updated,m.id").map_err(|e| e.to_string())?;
        let rows = statement
            .query_map(
                params![selected, at, store::MEMORY_LIFETIME_MILLIS],
                |row| {
                    Ok(ArchiveMemory {
                        id: row.get(0)?,
                        character_source_id: row.get(1)?,
                        person_id: row.get(2)?,
                        kind: row.get(3)?,
                        content: row.get(4)?,
                        source_id: row.get(5)?,
                        source_text: row.get(6)?,
                        source_created_at: row.get(7)?,
                        updated_at: row.get(8)?,
                        required_chapter: row.get(9)?,
                    })
                },
            )
            .map_err(|e| e.to_string())?;
        for row in rows {
            let mut memory = row.map_err(|e| e.to_string())?;
            memory.character_source_id = mapped(characters, &memory.character_source_id)?;
            archive.memories.push(memory);
        }
    }
    if options.include_affinity {
        let mut statement = conn.prepare("SELECT character_id,user_id,20+SUM(delta) FROM character_affinity
            WHERE character_id IN (SELECT value FROM json_each(?1)) GROUP BY character_id,user_id ORDER BY character_id,user_id").map_err(|e| e.to_string())?;
        let rows = statement
            .query_map([&selected], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i32>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (character, person, score) = row.map_err(|e| e.to_string())?;
            archive.affinity.push(ArchiveAffinity {
                character_source_id: mapped(characters, &character)?,
                person_id: person,
                score: score.clamp(0, 100),
            });
        }
        if let Some(person) = store::current_user(conn)? {
            for source in characters.values() {
                if !archive.affinity.iter().any(|entry| {
                    entry.character_source_id == *source && entry.person_id == person.id
                }) {
                    archive.affinity.push(ArchiveAffinity {
                        character_source_id: source.clone(),
                        person_id: person.id.clone(),
                        score: 20,
                    });
                }
            }
        }
    }
    if options.include_messages {
        let mut statement = conn.prepare("SELECT m.data,u.user_id,COALESCE(c.source,'unknown') FROM messages m
            JOIN message_users u ON u.message_id=m.id LEFT JOIN message_context c ON c.message_id=m.id
            WHERE EXISTS(SELECT 1 FROM message_characters i WHERE i.message_id=m.id AND i.character_id IN (SELECT value FROM json_each(?1))) ORDER BY m.seq").map_err(|e| e.to_string())?;
        let rows = statement
            .query_map([&selected], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (data, person_id, source_kind) = row.map_err(|e| e.to_string())?;
            let message: Message = serde_json::from_str(&data).map_err(|e| e.to_string())?;
            let mut identities = conn.prepare("SELECT character_id,name FROM message_characters WHERE message_id=?1 AND character_id IN (SELECT value FROM json_each(?2)) ORDER BY persona").map_err(|e| e.to_string())?;
            let owners = identities
                .query_map(params![message.id, selected], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|e| e.to_string())?;
            let speakers = owners
                .map(|row| {
                    let (id, name) = row.map_err(|e| e.to_string())?;
                    Ok(ArchiveSpeaker {
                        source_id: mapped(characters, &id)?,
                        name,
                    })
                })
                .collect::<Result<Vec<_>>>()?;
            archive.messages.push(ArchiveMessage {
                id: message.id,
                person_id,
                role: message.role,
                content: message.content,
                expression: message.expression,
                created_at: message.created_at,
                status: message.status,
                source_kind,
                characters: speakers,
            });
        }
        let mut statement = conn
            .prepare("SELECT data FROM character_archived_messages
                WHERE EXISTS(SELECT 1 FROM json_each(data,'$.characters') WHERE json_extract(value,'$.sourceId') IN (SELECT value FROM json_each(?1))) ORDER BY rowid")
            .map_err(|e| e.to_string())?;
        let rows = statement
            .query_map([&selected], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        for row in rows {
            let mut message: ArchiveMessage =
                serde_json::from_str(&row.map_err(|e| e.to_string())?)
                    .map_err(|e| e.to_string())?;
            message
                .characters
                .retain(|speaker| characters.contains_key(&speaker.source_id));
            if message.characters.is_empty() {
                continue;
            }
            for speaker in &mut message.characters {
                speaker.source_id = mapped(characters, &speaker.source_id)?;
            }
            archive.messages.push(message);
        }
        archive.messages.sort_by_key(|message| message.created_at);
    }
    let used = archive
        .memories
        .iter()
        .map(|m| &m.person_id)
        .chain(archive.affinity.iter().map(|a| &a.person_id))
        .chain(archive.messages.iter().map(|m| &m.person_id))
        .cloned()
        .collect::<std::collections::BTreeSet<_>>();
    let mut people = BTreeMap::new();
    for id in used {
        let person: (String, i64, Option<i64>) = conn
            .query_row(
                "SELECT name,started_at,ended_at FROM user_identities WHERE id=?1",
                [&id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .map_err(|e| e.to_string())?;
        let reference = format!("person-{}", people.len() + 1);
        archive.people.push(ArchivePerson {
            id: reference.clone(),
            name: person.0,
            started_at: person.1,
            ended_at: person.2.unwrap_or(at),
        });
        people.insert(id, reference);
    }
    let mut sources = BTreeMap::new();
    for (index, memory) in archive.memories.iter_mut().enumerate() {
        memory.id = format!("memory-{}", index + 1);
        memory.person_id = mapped(&people, &memory.person_id)?;
        let next = format!("source-{}", sources.len() + 1);
        memory.source_id = sources
            .entry(memory.source_id.clone())
            .or_insert(next)
            .clone();
    }
    for affinity in &mut archive.affinity {
        affinity.person_id = mapped(&people, &affinity.person_id)?;
    }
    for (index, message) in archive.messages.iter_mut().enumerate() {
        message.id = format!("message-{}", index + 1);
        message.person_id = mapped(&people, &message.person_id)?;
    }
    Ok(archive)
}

pub fn import(
    conn: &Connection,
    archive: &CharacterArchive,
    characters: &BTreeMap<String, String>,
) -> Result<()> {
    let mut people = BTreeMap::new();
    for person in &archive.people {
        let id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO user_identities(id,name,started_at,ended_at) VALUES(?1,?2,?3,?4)",
            params![id, person.name, person.started_at, person.ended_at],
        )
        .map_err(|e| e.to_string())?;
        people.insert(person.id.clone(), id);
    }
    let at = store::effective_memory_time(conn, chrono::Utc::now().timestamp_millis())?;
    let retired: BTreeMap<_, _> = archive
        .people
        .iter()
        .map(|person| (person.id.as_str(), person.ended_at))
        .collect();
    let mut sources = BTreeMap::new();
    for memory in &archive.memories {
        let source = sources
            .entry(memory.source_id.clone())
            .or_insert_with(|| uuid::Uuid::new_v4().to_string());
        let ended_at = retired
            .get(memory.person_id.as_str())
            .ok_or("기억의 사용자를 찾을 수 없습니다.")?;
        let expired = at >= ended_at.saturating_add(store::MEMORY_LIFETIME_MILLIS);
        conn.execute("INSERT INTO memories(id,content,source,updated,deleted,locked,character_id,user_id,kind,source_text,source_created_at,expired,required_chapter)
            VALUES(?1,?2,?3,?4,0,0,?5,?6,?7,?8,?9,?10,?11)",params![uuid::Uuid::new_v4().to_string(),memory.content,source.as_str(),memory.updated_at,mapped(characters,&memory.character_source_id)?,mapped(&people,&memory.person_id)?,memory.kind,memory.source_text,memory.source_created_at,expired,memory.required_chapter]).map_err(|e| e.to_string())?;
    }
    for affinity in &archive.affinity {
        conn.execute("INSERT INTO character_affinity(source,character_id,day,delta,fingerprint,user_id) VALUES(?1,?2,?3,?4,'archive',?5)",params![format!("archive:{}",uuid::Uuid::new_v4()),mapped(characters,&affinity.character_source_id)?,archive.exported_at.to_string(),affinity.score-20,mapped(&people,&affinity.person_id)?]).map_err(|e| e.to_string())?;
    }
    for original in &archive.messages {
        let mut message = original.clone();
        message.id = uuid::Uuid::new_v4().to_string();
        message.person_id = mapped(&people, &message.person_id)?;
        for speaker in &mut message.characters {
            speaker.source_id = mapped(characters, &speaker.source_id)?;
        }
        conn.execute(
            "INSERT INTO character_archived_messages(id,user_id,data) VALUES(?1,?2,?3)",
            params![
                message.id,
                message.person_id,
                serde_json::to_string(&message).map_err(|e| e.to_string())?
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}
