#[path = "characters/dialogue.rs"]
mod dialogue;
#[path = "characters/validation.rs"]
mod validation;

use crate::character_sprites::{self as sprites, SpriteInfo};
use dialogue::remap;
pub use dialogue::{dialogue, greeting, idle_scene, keyword_scene, save_dialogue};
use validation::decode_sprite;
pub(crate) use validation::sprite_slot_allowed;
pub use validation::{pack_json, parse_pack};
use validation::{validate_definition, validate_pack};

use crate::domain::EXPRESSIONS;
use crate::types::{SceneLine, WordbookEntry};
use base64::Engine;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashSet};

type Result<T> = std::result::Result<T, String>;
pub const MAX_PACK_BYTES: usize = 32 * 1_048_576;
pub const DEFAULT_EXPRESSION: &str = "평온";
pub const DEFAULT_SPRITE_SIZE: u32 = 64;
// Reserved sprite key for the balloon skin; expression names may not start with '$'.
pub const BALLOON_SPRITE: &str = "$balloon";
pub const SPRITE_SIZE_RANGE: std::ops::RangeInclusive<u32> = 32..=512;
pub const MAX_ROSTER: usize = 8;
pub const SLOTS: [&str; 8] = ["a", "b", "c", "d", "e", "f", "g", "h"];
fn default_sprite_size() -> u32 {
    DEFAULT_SPRITE_SIZE
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CharacterLine {
    pub expression: String,
    pub text: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CharacterRelationship {
    pub target_id: String,
    pub description: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CharacterDefinition {
    pub source_id: String,
    pub version: u32,
    pub name: String,
    pub description: String,
    pub personality: String,
    #[serde(default)]
    pub instructions: String,
    #[serde(default)]
    pub relationships: Vec<CharacterRelationship>,
    pub expressions: BTreeMap<String, String>,
    #[serde(default)]
    pub face_icon: bool,
    #[serde(default = "default_sprite_size")]
    pub sprite_size: u32,
    pub greeting: Vec<CharacterLine>,
    pub idle_lines: Vec<CharacterLine>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InstalledCharacter {
    pub id: String,
    pub pack_id: Option<String>,
    pub definition: CharacterDefinition,
    #[serde(default)]
    pub sprites: BTreeMap<String, SpriteInfo>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackSprite {
    pub source_id: String,
    pub expression: String,
    pub mime: String,
    pub data: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CharacterCollection {
    pub installed: Vec<InstalledCharacter>,
    pub active: Vec<String>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InstalledCharacterPack {
    pub id: String,
    pub name: String,
    pub character_ids: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CharacterPack {
    pub format_version: u32,
    pub name: String,
    pub author: String,
    #[serde(default)]
    pub source_url: String,
    pub license: String,
    pub characters: Vec<CharacterDefinition>,
    #[serde(default)]
    pub pair_scenes: Vec<Vec<SceneLine>>,
    #[serde(default)]
    pub wordbook: Vec<WordbookEntry>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sprites: Vec<PackSprite>,
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
pub fn slot_index(slot: &str) -> Result<usize> {
    SLOTS
        .iter()
        .position(|candidate| *candidate == slot)
        .ok_or_else(|| "캐릭터 자리는 a~h여야 합니다.".into())
}
pub(crate) fn default_pack() -> CharacterPack {
    parse_pack(include_str!("../content/default.comet-character.json"))
        .expect("bundled character package must be valid")
}
pub(crate) fn factory_pack() -> CharacterPack {
    default_pack()
}

#[cfg(test)]
fn builtin(slot: &str) -> CharacterDefinition {
    factory_pack().characters.remove(usize::from(slot != "a"))
}

pub(crate) fn nadir_pack() -> CharacterPack {
    parse_pack(include_str!(
        "../../examples/character-packs/nadir-and-star-tail.comet-character.json"
    ))
    .expect("bundled add-on character package must be valid")
}

/// The official Byulkkori image pack. A fresh install starts with this single character; it is
/// an ordinary imported pack afterwards, so it can be removed like any other.
pub(crate) fn byulkkori_pack() -> CharacterPack {
    parse_pack(include_str!(
        "../../examples/character-packs/byulkkori.comet-character.json"
    ))
    .expect("bundled default character package must be valid")
}

fn seed_byulkkori(conn: &Connection) -> Result<Vec<String>> {
    // New installs start with Byulkkori alone; the text-only A/B definitions stay available
    // for older databases that already hold them.
    Ok(import_pack(conn, &byulkkori_pack())?
        .into_iter()
        .map(|character| character.id)
        .collect())
}

/// Test-only seed: the pre-0.6 factory roster (A/B) that the regression suite addresses as
/// `builtin-a`/`builtin-b`. Production never calls this.
#[cfg(test)]
pub(crate) fn initialize_for_tests(conn: &Connection) -> Result<()> {
    initialize_with(conn, |tx| {
        ["a", "b"]
            .iter()
            .map(|slot| restore_builtin(tx, slot))
            .collect()
    })
}

fn migrate_factory_expressions(conn: &Connection) -> Result<()> {
    let factory = nadir_pack();
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
    initialize_with(conn, seed_byulkkori)
}

fn initialize_with(
    conn: &Connection,
    seed: impl FnOnce(&Connection) -> Result<Vec<String>>,
) -> Result<()> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute_batch("CREATE TABLE IF NOT EXISTS characters(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,pack_id TEXT,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS character_seed(version INTEGER PRIMARY KEY); CREATE TABLE IF NOT EXISTS character_roster(position INTEGER PRIMARY KEY,character_id TEXT NOT NULL UNIQUE); CREATE TABLE IF NOT EXISTS character_packs(id TEXT PRIMARY KEY,data TEXT NOT NULL,members TEXT NOT NULL); CREATE TABLE IF NOT EXISTS character_dialogues(members TEXT PRIMARY KEY,data TEXT NOT NULL);").map_err(|e| e.to_string())?;
    sprites::initialize(&tx)?;
    migrate_slots(&tx)?;
    let initialized: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM character_seed WHERE version=1)",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !initialized {
        let installed: i64 = tx
            .query_row("SELECT COUNT(*) FROM characters", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if installed == 0 {
            let ids = seed(&tx)?;
            write_roster(&tx, &ids)?;
        }
        tx.execute("INSERT INTO character_seed VALUES(1)", [])
            .map_err(|e| e.to_string())?;
    }
    migrate_factory_expressions(&tx)?;
    tx.commit().map_err(|e| e.to_string())
}
#[cfg(test)]
fn restore_builtin(conn: &Connection, slot: &str) -> Result<String> {
    let id = format!("builtin-{slot}");
    conn.execute(
        "INSERT OR IGNORE INTO characters(id,pack_id,data) VALUES(?1,NULL,?2)",
        params![
            id,
            serde_json::to_string(&builtin(slot)).map_err(|e| e.to_string())?
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(id)
}
// One-time move from the fixed a/b slot table to the ordered roster; the slot table is not read afterwards.
fn migrate_slots(conn: &Connection) -> Result<()> {
    if !active_ids(conn)?.is_empty() {
        return Ok(());
    }
    let has_slots: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='character_slots')",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let mut ids = Vec::new();
    if has_slots {
        let mut statement = conn
            .prepare("SELECT s.character_id FROM character_slots s JOIN characters c ON c.id=s.character_id ORDER BY s.slot")
            .map_err(|e| e.to_string())?;
        ids = statement
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        conn.execute_batch("DROP TABLE character_slots")
            .map_err(|e| e.to_string())?;
    }
    write_roster(conn, &ids)
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
        sprites: sprites::list(conn, id)?,
    })
}
pub fn set_sprite(conn: &Connection, id: &str, expression: &str, bytes: &[u8]) -> Result<()> {
    if !sprite_slot_allowed(&get(conn, id)?.definition, expression) {
        return Err("먼저 캐릭터에 그 표정을 추가하고 저장해 주세요.".into());
    }
    sprites::put(conn, id, expression, bytes)
}
pub fn remove_sprite(conn: &Connection, id: &str, expression: &str) -> Result<()> {
    get(conn, id)?;
    sprites::remove(conn, id, expression)
}
pub fn sprite(conn: &Connection, id: &str, expression: &str) -> Result<Option<sprites::Sprite>> {
    sprites::get(conn, id, expression)
}
pub fn active_ids(conn: &Connection) -> Result<Vec<String>> {
    let mut statement = conn
        .prepare("SELECT character_id FROM character_roster ORDER BY position")
        .map_err(|e| e.to_string())?;
    let ids = statement
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(ids)
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
pub fn active_members(conn: &Connection) -> Result<Vec<InstalledCharacter>> {
    active_ids(conn)?.iter().map(|id| get(conn, id)).collect()
}
pub fn installed_packs(conn: &Connection) -> Result<Vec<InstalledCharacterPack>> {
    let mut statement = conn
        .prepare("SELECT id FROM character_packs ORDER BY rowid")
        .map_err(|e| e.to_string())?;
    let ids = statement
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(ids
        .iter()
        .map(|id| installed_pack(conn, id))
        .collect::<Result<Vec<_>>>()?
        .into_iter()
        .filter(|pack| !pack.character_ids.is_empty())
        .collect())
}
fn installed_pack(conn: &Connection, id: &str) -> Result<InstalledCharacterPack> {
    let (pack, members) = pack_record(conn, id)?;
    let mut statement = conn
        .prepare("SELECT id FROM characters WHERE pack_id=?")
        .map_err(|e| e.to_string())?;
    let installed = statement
        .query_map([id], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<HashSet<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(InstalledCharacterPack {
        id: id.into(),
        name: pack.name,
        character_ids: members
            .into_iter()
            .filter(|member| installed.contains(member))
            .collect(),
    })
}
pub fn apply_pack(conn: &Connection, pack_id: &str) -> Result<()> {
    with_transaction(conn, |tx| {
        let pack = installed_pack(tx, pack_id)?;
        if pack.character_ids.is_empty() {
            return Err("이 팩에는 함께 지낼 캐릭터가 남아 있지 않습니다.".into());
        }
        apply_roster(tx, pack.character_ids)
    })
}
pub fn active_character(conn: &Connection, slot: &str) -> Result<InstalledCharacter> {
    let ids = active_ids(conn)?;
    if ids.iter().any(|id| id == slot) {
        return get(conn, slot);
    }
    let id = ids
        .get(slot_index(slot)?)
        .ok_or("그 자리에는 지금 캐릭터가 없습니다.")?;
    get(conn, id)
}
fn write_roster(conn: &Connection, ids: &[String]) -> Result<()> {
    conn.execute("DELETE FROM character_roster", [])
        .map_err(|e| e.to_string())?;
    for (position, id) in ids.iter().enumerate() {
        conn.execute(
            "INSERT INTO character_roster(position,character_id) VALUES(?1,?2)",
            params![position as i64, id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}
pub fn apply_roster(conn: &Connection, ids: Vec<String>) -> Result<()> {
    let distinct: HashSet<&String> = ids.iter().collect();
    if !(1..=MAX_ROSTER).contains(&ids.len()) || distinct.len() != ids.len() {
        return Err(format!("서로 다른 캐릭터 1~{MAX_ROSTER}명을 골라 주세요."));
    }
    with_transaction(conn, |tx| {
        for id in &ids {
            get(tx, id)?;
        }
        write_roster(tx, &ids)
    })
}
#[cfg(test)]
pub fn apply_pair(conn: &Connection, ids: [String; 2]) -> Result<()> {
    if ids[0] == ids[1] {
        return Err("같은 로컬 캐릭터를 두 자리에 적용할 수 없습니다.".into());
    }
    apply_roster(conn, ids.to_vec())
}
#[cfg(test)]
pub fn assign(conn: &Connection, slot: &str, id: &str) -> Result<()> {
    let mut ids = active_ids(conn)?;
    match ids.get_mut(slot_index(slot)?) {
        Some(current) => *current = id.into(),
        None => ids.push(id.into()),
    }
    apply_roster(conn, ids)
}
pub fn save(conn: &Connection, id: &str, definition: &CharacterDefinition) -> Result<()> {
    validate_definition(definition)?;
    let old = get(conn, id)?;
    validate_local_relationships(conn, id, definition, &old.definition.relationships)?;
    let mut edited = definition.clone();
    edited.source_id = old.definition.source_id;
    edited.version = old
        .definition
        .version
        .checked_add(1)
        .ok_or("캐릭터 버전 한도를 초과했습니다.")?;
    with_transaction(conn, |tx| {
        tx.execute(
            "UPDATE characters SET data=?1 WHERE id=?2",
            params![
                serde_json::to_string(&edited).map_err(|e| e.to_string())?,
                id
            ],
        )
        .map_err(|e| e.to_string())?;
        let mut kept: BTreeSet<String> = edited.expressions.keys().cloned().collect();
        kept.insert(BALLOON_SPRITE.into());
        sprites::retain(tx, id, &kept)
    })
}
pub fn create(conn: &Connection, definition: &CharacterDefinition) -> Result<InstalledCharacter> {
    validate_definition(definition)?;
    let id = uuid::Uuid::new_v4().to_string();
    validate_local_relationships(conn, &id, definition, &[])?;
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
fn validate_local_relationships(
    conn: &Connection,
    id: &str,
    definition: &CharacterDefinition,
    previous: &[CharacterRelationship],
) -> Result<()> {
    for relationship in &definition.relationships {
        if relationship.target_id == id {
            return Err("자기 자신과의 관계는 설정할 수 없습니다.".into());
        }
        let exists: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM characters WHERE id=?)",
                [&relationship.target_id],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        // Removing another character must not prevent editing or removing an existing relation.
        if !exists
            && !previous
                .iter()
                .any(|item| item.target_id == relationship.target_id)
        {
            return Err("관계를 설정할 캐릭터를 찾을 수 없습니다.".into());
        }
    }
    Ok(())
}
pub fn clone_character(conn: &Connection, id: &str) -> Result<InstalledCharacter> {
    with_transaction(conn, |tx| {
        let mut original = get(tx, id)?;
        let relationships = std::mem::take(&mut original.definition.relationships);
        let mut pack = export_pack(tx, &[id.to_string()], &[])?;
        for sprite in &mut pack.sprites {
            sprite.source_id = original.definition.source_id.clone();
        }
        pack.characters[0] = original.definition;
        let mut cloned = import_pack(tx, &pack)?
            .into_iter()
            .next()
            .ok_or("캐릭터를 복제하지 못했습니다.")?;
        // A local duplicate keeps outgoing links even though single-character exports omit them.
        cloned.definition.relationships = relationships;
        tx.execute(
            "UPDATE characters SET data=?1 WHERE id=?2",
            params![
                serde_json::to_string(&cloned.definition).map_err(|error| error.to_string())?,
                cloned.id
            ],
        )
        .map_err(|error| error.to_string())?;
        Ok(cloned)
    })
}
pub fn remove(conn: &Connection, id: &str) -> Result<()> {
    with_transaction(conn, |tx| {
        let character = get(tx, id)?;
        let mut ids = active_ids(tx)?;
        if ids.len() == 1 && ids[0] == id {
            return Err("먼저 다른 친구와 함께 지낸 뒤 마지막 캐릭터를 제거해 주세요.".into());
        }
        let mut changed = false;
        if let Some(index) = ids.iter().position(|active| active == id) {
            ids.remove(index);
            changed = true;
        }
        tx.execute("DELETE FROM characters WHERE id=?", [id])
            .map_err(|e| e.to_string())?;
        sprites::remove_all(tx, id)?;
        if changed {
            write_roster(tx, &ids)?;
        }
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
        // Sprites live in their own table; the stored pack record keeps only text content.
        let record = CharacterPack {
            sprites: Vec::new(),
            ..pack.clone()
        };
        tx.execute(
            "INSERT INTO character_packs(id,data,members) VALUES(?1,?2,?3)",
            params![
                pack_id,
                serde_json::to_string(&record).map_err(|e| e.to_string())?,
                serde_json::to_string(&ids).map_err(|e| e.to_string())?
            ],
        )
        .map_err(|e| e.to_string())?;
        for (id, definition) in ids.iter().zip(&pack.characters) {
            let mut local_definition = definition.clone();
            for relationship in &mut local_definition.relationships {
                let index = pack
                    .characters
                    .iter()
                    .position(|target| target.source_id == relationship.target_id)
                    .ok_or("팩에 없는 캐릭터와의 관계입니다.")?;
                relationship.target_id = ids[index].clone();
            }
            tx.execute(
                "INSERT INTO characters(id,pack_id,data) VALUES(?1,?2,?3)",
                params![
                    id,
                    pack_id,
                    serde_json::to_string(&local_definition).map_err(|e| e.to_string())?
                ],
            )
            .map_err(|e| e.to_string())?;
            for sprite in pack
                .sprites
                .iter()
                .filter(|sprite| sprite.source_id == definition.source_id)
            {
                sprites::put(tx, id, &sprite.expression, &decode_sprite(sprite)?)?;
            }
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
    if !(1..=MAX_ROSTER).contains(&ids.len())
        || ids.iter().collect::<HashSet<_>>().len() != ids.len()
    {
        return Err("서로 다른 캐릭터 1~8명을 선택해 주세요.".into());
    }
    let installed = ids
        .iter()
        .map(|id| get(conn, id))
        .collect::<Result<Vec<_>>>()?;
    let mut pack = CharacterPack {
        format_version: 2,
        name: installed
            .iter()
            .map(|c| c.definition.name.as_str())
            .collect::<Vec<_>>()
            .join(" · ")
            .chars()
            .take(80)
            .collect(),
        author: String::new(),
        source_url: String::new(),
        license: String::new(),
        characters: installed.iter().map(|c| c.definition.clone()).collect(),
        pair_scenes: Vec::new(),
        wordbook: Vec::new(),
        sprites: Vec::new(),
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
    let sources: Vec<_> = pack
        .characters
        .iter()
        .map(|definition| definition.source_id.clone())
        .collect();
    for definition in &mut pack.characters {
        definition.relationships = definition
            .relationships
            .iter()
            .filter_map(|relationship| {
                ids.iter()
                    .position(|id| id == &relationship.target_id)
                    .map(|index| CharacterRelationship {
                        target_id: sources[index].clone(),
                        description: relationship.description.clone(),
                    })
            })
            .collect();
    }
    for (definition, character) in pack.characters.iter().zip(&installed) {
        for (expression, sprite) in sprites::all(conn, &character.id)? {
            pack.sprites.push(PackSprite {
                source_id: definition.source_id.clone(),
                expression,
                mime: sprite.mime,
                data: base64::engine::general_purpose::STANDARD.encode(sprite.data),
            });
        }
    }
    let mut seen = HashSet::new();
    for character in &installed {
        if let Some(pack_id) = &character.pack_id {
            if seen.insert(pack_id.clone()) {
                let (source, _) = pack_record(conn, pack_id)?;
                if seen.len() == 1 {
                    pack.author = source.author.clone();
                    pack.source_url = source.source_url.clone();
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

pub fn resolve_lines(conn: &Connection, lines: &[SceneLine]) -> Result<Vec<SceneLine>> {
    lines
        .iter()
        .map(|line| {
            Ok(SceneLine {
                persona: active_character(conn, &line.persona)?.id,
                expression: line.expression.clone(),
                text: line.text.clone(),
            })
        })
        .collect()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackAttribution {
    pub author: String,
    pub source_url: String,
}
pub fn pack_attribution(conn: &Connection, pack_id: &str) -> Result<PackAttribution> {
    let (pack, _) = pack_record(conn, pack_id)?;
    Ok(PackAttribution {
        author: pack.author,
        source_url: pack.source_url,
    })
}
pub fn save_pack_attribution(
    conn: &Connection,
    pack_id: &str,
    value: &PackAttribution,
) -> Result<()> {
    let (mut pack, _) = pack_record(conn, pack_id)?;
    pack.author = value.author.clone();
    pack.source_url = value.source_url.clone();
    validate_pack(&pack)?;
    let data = serde_json::to_string(&pack).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE character_packs SET data=?1 WHERE id=?2",
        params![data, pack_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
