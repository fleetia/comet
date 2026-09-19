#[path = "characters/dialogue.rs"]
mod dialogue;
#[path = "characters/validation.rs"]
mod validation;

use dialogue::remap;
pub use dialogue::{dialogue, greeting, idle_scene, keyword_scene, save_dialogue};
pub use validation::parse_pack;
use validation::{validate_definition, validate_pack};

use crate::types::{SceneLine, WordbookEntry};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};

type Result<T> = std::result::Result<T, String>;
pub const MAX_PACK_BYTES: usize = 1_048_576;
const EXPRESSIONS: [&str; 6] = ["평온", "기쁨", "호기심", "생각중", "걱정", "장난"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CharacterLine {
    pub expression: String,
    pub text: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CharacterDefinition {
    pub source_id: String,
    pub version: u32,
    pub name: String,
    pub description: String,
    pub personality: String,
    pub expressions: BTreeMap<String, String>,
    pub greeting: Vec<CharacterLine>,
    pub idle_lines: Vec<CharacterLine>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InstalledCharacter {
    pub id: String,
    pub pack_id: Option<String>,
    pub definition: CharacterDefinition,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CharacterCollection {
    pub installed: Vec<InstalledCharacter>,
    pub active: [String; 2],
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CharacterPack {
    pub format_version: u32,
    pub name: String,
    pub author: String,
    pub license: String,
    pub characters: Vec<CharacterDefinition>,
    #[serde(default)]
    pub pair_scenes: Vec<Vec<SceneLine>>,
    #[serde(default)]
    pub wordbook: Vec<WordbookEntry>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CharacterDialogue {
    pub pair_scenes: Vec<Vec<SceneLine>>,
    pub wordbook: Vec<WordbookEntry>,
}

fn with_transaction<T>(
    conn: &Connection,
    operation: impl FnOnce(&Connection) -> Result<T>,
) -> Result<T> {
    if !conn.is_autocommit() {
        return operation(conn);
    }
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let value = operation(&tx)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(value)
}
fn slot_index(slot: &str) -> Result<usize> {
    match slot {
        "a" => Ok(0),
        "b" => Ok(1),
        _ => Err("캐릭터 자리는 a 또는 b여야 합니다.".into()),
    }
}
pub(crate) fn factory_pack() -> CharacterPack {
    serde_json::from_str(include_str!(
        "../../examples/character-packs/nadir-and-star-tail.comet-character.json"
    ))
    .expect("bundled character pack is valid")
}

fn builtin(slot: &str) -> CharacterDefinition {
    factory_pack().characters.remove(usize::from(slot != "a"))
}

fn migrate_factory_definition(conn: &Connection, slot: &str) -> Result<()> {
    use sha2::{Digest, Sha256};
    let id = format!("builtin-{slot}");
    let current = get(conn, &id)?;
    let encoded = serde_json::to_vec(&current.definition).map_err(|error| error.to_string())?;
    let expected = if slot == "a" {
        "bdd4ee7e8fb049267609de0bd1b5dc5ff0a1e8817312c6bcce8d527ee0053b1f"
    } else {
        "d540c8261278ce79284d9ab28c6d0ff5aae061bc1ea6c1c1da23ffcbfdc580bd"
    };
    if hex::encode(Sha256::digest(encoded)) == expected {
        conn.execute(
            "UPDATE characters SET data=?1 WHERE id=?2",
            params![
                serde_json::to_string(&builtin(slot)).map_err(|error| error.to_string())?,
                id
            ],
        )
        .map_err(|error| error.to_string())?;
    }
    Ok(())
}
fn migrate_factory_expressions(conn: &Connection) -> Result<()> {
    let factory = factory_pack();
    for mut character in collection(conn)?.installed {
        let previous = match character.definition.source_id.as_str() {
            "nadir" => [
                "안경을 고쳐 쓰는 나디르",
                "조금 웃는 나디르",
                "한쪽 눈썹을 올린 나디르",
                "음절을 짚는 나디르",
                "말끝을 고르는 나디르",
                "작게 웃음을 참는 나디르",
            ],
            "star-tail" => [
                "꼬리를 살랑이는 별꼬리",
                "폴짝 웃는 별꼬리",
                "고개를 갸웃한 별꼬리",
                "꼬리를 동그랗게 만 별꼬리",
                "살짝 처진 별꼬리",
                "한쪽 눈을 찡긋한 별꼬리",
            ],
            _ => continue,
        };
        let previous = EXPRESSIONS
            .iter()
            .zip(previous)
            .map(|(key, value)| (key.to_string(), value.to_string()))
            .collect::<BTreeMap<_, _>>();
        if character.definition.expressions != previous {
            continue;
        }
        let Some(replacement) = factory
            .characters
            .iter()
            .find(|definition| definition.source_id == character.definition.source_id)
        else {
            continue;
        };
        character.definition.expressions = replacement.expressions.clone();
        conn.execute(
            "UPDATE characters SET data=?1 WHERE id=?2",
            params![
                serde_json::to_string(&character.definition).map_err(|error| error.to_string())?,
                character.id
            ],
        )
        .map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn initialize(conn: &Connection) -> Result<()> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute_batch("CREATE TABLE IF NOT EXISTS characters(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,pack_id TEXT,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS character_slots(slot TEXT PRIMARY KEY CHECK(slot IN ('a','b')),character_id TEXT NOT NULL UNIQUE); CREATE TABLE IF NOT EXISTS character_packs(id TEXT PRIMARY KEY,data TEXT NOT NULL,members TEXT NOT NULL); CREATE TABLE IF NOT EXISTS character_dialogues(members TEXT PRIMARY KEY,data TEXT NOT NULL);").map_err(|e| e.to_string())?;
    for slot in ["a", "b"] {
        tx.execute(
            "INSERT OR IGNORE INTO characters(id,pack_id,data) VALUES(?1,NULL,?2)",
            params![
                format!("builtin-{slot}"),
                serde_json::to_string(&builtin(slot)).map_err(|e| e.to_string())?
            ],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT OR IGNORE INTO character_slots(slot,character_id) VALUES(?1,?2)",
            params![slot, format!("builtin-{slot}")],
        )
        .map_err(|e| e.to_string())?;
    }
    for slot in ["a", "b"] {
        migrate_factory_definition(&tx, slot)?;
    }
    migrate_factory_expressions(&tx)?;
    tx.commit().map_err(|e| e.to_string())
}
fn get(conn: &Connection, id: &str) -> Result<InstalledCharacter> {
    let row: Option<(Option<String>, String)> = conn
        .query_row(
            "SELECT pack_id,data FROM characters WHERE id=?",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let (pack_id, data) = row.ok_or("설치된 캐릭터를 찾을 수 없습니다.")?;
    Ok(InstalledCharacter {
        id: id.into(),
        pack_id,
        definition: serde_json::from_str(&data).map_err(|e| e.to_string())?,
    })
}
fn active_ids(conn: &Connection) -> Result<[String; 2]> {
    let a = conn
        .query_row(
            "SELECT character_id FROM character_slots WHERE slot='a'",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let b = conn
        .query_row(
            "SELECT character_id FROM character_slots WHERE slot='b'",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok([a, b])
}
pub fn collection(conn: &Connection) -> Result<CharacterCollection> {
    let mut statement = conn
        .prepare("SELECT id FROM characters ORDER BY seq")
        .map_err(|e| e.to_string())?;
    let ids = statement
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(CharacterCollection {
        installed: ids.iter().map(|id| get(conn, id)).collect::<Result<_>>()?,
        active: active_ids(conn)?,
    })
}
pub fn active_character(conn: &Connection, slot: &str) -> Result<InstalledCharacter> {
    get(conn, &active_ids(conn)?[slot_index(slot)?])
}
fn write_pair(conn: &Connection, ids: &[String; 2]) -> Result<()> {
    conn.execute("DELETE FROM character_slots", [])
        .map_err(|e| e.to_string())?;
    for (slot, id) in ["a", "b"].iter().zip(ids) {
        conn.execute(
            "INSERT INTO character_slots(slot,character_id) VALUES(?1,?2)",
            params![slot, id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}
pub fn apply_pair(conn: &Connection, ids: [String; 2]) -> Result<()> {
    if ids[0] == ids[1] {
        return Err("같은 로컬 캐릭터를 두 자리에 적용할 수 없습니다.".into());
    }
    with_transaction(conn, |tx| {
        for id in &ids {
            get(tx, id)?;
        }
        write_pair(tx, &ids)?;
        Ok(())
    })
}
pub fn assign(conn: &Connection, slot: &str, id: &str) -> Result<()> {
    let mut ids = active_ids(conn)?;
    ids[slot_index(slot)?] = id.into();
    apply_pair(conn, ids)
}
pub fn save(conn: &Connection, id: &str, definition: &CharacterDefinition) -> Result<()> {
    validate_definition(definition)?;
    let old = get(conn, id)?;
    let mut edited = definition.clone();
    edited.source_id = old.definition.source_id;
    edited.version = old
        .definition
        .version
        .checked_add(1)
        .ok_or("캐릭터 버전 한도를 초과했습니다.")?;
    conn.execute(
        "UPDATE characters SET data=?1 WHERE id=?2",
        params![
            serde_json::to_string(&edited).map_err(|e| e.to_string())?,
            id
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
pub fn create(conn: &Connection, definition: &CharacterDefinition) -> Result<InstalledCharacter> {
    validate_definition(definition)?;
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO characters(id,pack_id,data) VALUES(?1,NULL,?2)",
        params![
            id,
            serde_json::to_string(definition).map_err(|e| e.to_string())?
        ],
    )
    .map_err(|e| e.to_string())?;
    get(conn, &id)
}
pub fn clone_character(conn: &Connection, id: &str) -> Result<InstalledCharacter> {
    with_transaction(conn, |tx| {
        let original = get(tx, id)?;
        let mut pack = export_pack(tx, &[id.to_string()], &[])?;
        pack.characters[0] = original.definition;
        import_pack(tx, &pack)?
            .into_iter()
            .next()
            .ok_or_else(|| "캐릭터를 복제하지 못했습니다.".into())
    })
}
pub fn remove(conn: &Connection, id: &str) -> Result<()> {
    if ["builtin-a", "builtin-b"].contains(&id) {
        return Err("기본 캐릭터는 제거할 수 없습니다.".into());
    }
    with_transaction(conn, |tx| {
        let character = get(tx, id)?;
        let mut ids = active_ids(tx)?;
        for index in 0..2 {
            if ids[index] == id {
                let preferred = ["builtin-a", "builtin-b"][index];
                ids[index] = if ids[1 - index] == preferred {
                    ["builtin-b", "builtin-a"][index]
                } else {
                    preferred
                }
                .into();
            }
        }
        write_pair(tx, &ids)?;
        tx.execute("DELETE FROM characters WHERE id=?", [id])
            .map_err(|e| e.to_string())?;
        if let Some(pack_id) = character.pack_id {
            tx.execute("DELETE FROM character_packs WHERE id=?1 AND NOT EXISTS(SELECT 1 FROM characters WHERE pack_id=?1)", [pack_id]).map_err(|e| e.to_string())?;
        }
        Ok(())
    })
}
pub fn import_pack(conn: &Connection, pack: &CharacterPack) -> Result<Vec<InstalledCharacter>> {
    validate_pack(pack)?;
    with_transaction(conn, |tx| {
        let pack_id = uuid::Uuid::new_v4().to_string();
        let ids: Vec<String> = pack
            .characters
            .iter()
            .map(|_| uuid::Uuid::new_v4().to_string())
            .collect();
        tx.execute(
            "INSERT INTO character_packs(id,data,members) VALUES(?1,?2,?3)",
            params![
                pack_id,
                serde_json::to_string(pack).map_err(|e| e.to_string())?,
                serde_json::to_string(&ids).map_err(|e| e.to_string())?
            ],
        )
        .map_err(|e| e.to_string())?;
        for (id, definition) in ids.iter().zip(&pack.characters) {
            tx.execute(
                "INSERT INTO characters(id,pack_id,data) VALUES(?1,?2,?3)",
                params![
                    id,
                    pack_id,
                    serde_json::to_string(definition).map_err(|e| e.to_string())?
                ],
            )
            .map_err(|e| e.to_string())?;
        }
        let installed = ids.iter().map(|id| get(tx, id)).collect::<Result<_>>()?;
        Ok(installed)
    })
}
fn pack_record(conn: &Connection, id: &str) -> Result<(CharacterPack, Vec<String>)> {
    let (data, members): (String, String) = conn
        .query_row(
            "SELECT data,members FROM character_packs WHERE id=?",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    Ok((
        serde_json::from_str(&data).map_err(|e| e.to_string())?,
        serde_json::from_str(&members).map_err(|e| e.to_string())?,
    ))
}
pub fn export_pack(
    conn: &Connection,
    ids: &[String],
    selected_wordbook: &[WordbookEntry],
) -> Result<CharacterPack> {
    if !(1..=2).contains(&ids.len()) || ids.len() == 2 && ids[0] == ids[1] {
        return Err("서로 다른 캐릭터 1~2명을 선택해 주세요.".into());
    }
    let installed = ids
        .iter()
        .map(|id| get(conn, id))
        .collect::<Result<Vec<_>>>()?;
    let mut pack = CharacterPack {
        format_version: 1,
        name: installed
            .iter()
            .map(|c| c.definition.name.as_str())
            .collect::<Vec<_>>()
            .join(" · ")
            .chars()
            .take(80)
            .collect(),
        author: String::new(),
        license: String::new(),
        characters: installed.iter().map(|c| c.definition.clone()).collect(),
        pair_scenes: Vec::new(),
        wordbook: Vec::new(),
    };
    let mut canonical_sources = HashSet::new();
    for (index, definition) in pack.characters.iter_mut().enumerate() {
        if matches!(definition.source_id.as_str(), "nadir" | "star-tail") {
            if !canonical_sources.insert(definition.source_id.clone()) {
                return Err("같은 원본의 나디르·별꼬리는 각각 내보내 주세요. 이야기 식별자를 함께 보존할 수 없어요.".into());
            }
        } else {
            definition.source_id = format!("character-{}", index + 1);
        }
    }
    let mut seen = HashSet::new();
    for character in &installed {
        if let Some(pack_id) = &character.pack_id {
            if seen.insert(pack_id.clone()) {
                let (source, _) = pack_record(conn, pack_id)?;
                if seen.len() == 1 {
                    pack.author = source.author.clone();
                    pack.license = source.license.clone();
                } else {
                    pack.author.push_str(&format!("\n{}", source.author));
                    pack.license.push_str(&format!("\n{}", source.license));
                }
            }
        }
    }
    let content = dialogue(conn, ids)?;
    pack.pair_scenes = content.pair_scenes;
    pack.wordbook = content.wordbook;
    for entry in &mut pack.wordbook {
        entry.id = uuid::Uuid::new_v4().to_string();
    }
    let active = active_ids(conn)?;
    for entry in selected_wordbook {
        let mut entry = entry.clone();
        entry.lines = remap(&entry.lines, &active, ids)
            .ok_or("선택한 개인 대사의 화자가 내보낼 캐릭터에 없습니다.")?;
        entry.id = uuid::Uuid::new_v4().to_string();
        pack.wordbook.push(entry);
    }
    validate_pack(&pack)?;
    Ok(pack)
}

#[cfg(test)]
#[path = "characters/tests.rs"]
mod tests;
