use crate::character_sprites::{self as sprites, SpriteInfo};
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
fn default_sprite_size() -> u32 {
    DEFAULT_SPRITE_SIZE
}
const BASE_EXPRESSIONS: [&str; 6] = ["평온", "기쁨", "호기심", "생각중", "걱정", "장난"];

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
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sprites: Vec<PackSprite>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CharacterDialogue {
    pub pair_scenes: Vec<Vec<SceneLine>>,
    pub wordbook: Vec<WordbookEntry>,
}

fn bounded(value: &str, max: usize, required: bool) -> bool {
    (!required || !value.trim().is_empty()) && value.chars().count() <= max
}
fn valid_expression_key(key: &str) -> bool {
    bounded(key, 20, true) && key.trim() == key && !key.starts_with('$')
}
pub(crate) fn sprite_slot_allowed(definition: &CharacterDefinition, key: &str) -> bool {
    key == BALLOON_SPRITE || definition.expressions.contains_key(key)
}
fn validate_line(expression: &str, text: &str) -> Result<()> {
    if !valid_expression_key(expression) || !bounded(text, 500, true) {
        return Err("표정 또는 대사가 올바르지 않습니다. 표정은 1~20자, 대사는 1~500자여야 합니다.".into());
    }
    Ok(())
}
fn validate_definition(definition: &CharacterDefinition) -> Result<()> {
    if !bounded(&definition.source_id, 128, true)
        || definition.version == 0
        || !bounded(&definition.name, 40, true)
        || !bounded(&definition.description, 500, false)
        || !bounded(&definition.personality, 500, false)
        || !(1..=24).contains(&definition.expressions.len())
        || !definition.expressions.contains_key(DEFAULT_EXPRESSION)
        || !SPRITE_SIZE_RANGE.contains(&definition.sprite_size)
        || definition
            .expressions
            .iter()
            .any(|(key, value)| !valid_expression_key(key) || !bounded(value, 40, true))
        || !(1..=8).contains(&definition.greeting.len())
        || !(1..=32).contains(&definition.idle_lines.len())
    {
        return Err("캐릭터 이름·정의·표정·대사 개수를 확인해 주세요.".into());
    }
    for line in definition.greeting.iter().chain(&definition.idle_lines) {
        validate_line(&line.expression, &line.text)?;
    }
    Ok(())
}
fn validate_scene(lines: &[SceneLine], members: usize) -> Result<()> {
    if !(1..=8).contains(&lines.len()) {
        return Err("장면은 1~8줄이어야 합니다.".into());
    }
    for line in lines {
        let index = slot_index(&line.persona)?;
        if index >= members {
            return Err("팩에 없는 캐릭터의 대사입니다.".into());
        }
        validate_line(&line.expression, &line.text)?;
    }
    Ok(())
}
fn validate_wordbook(entry: &WordbookEntry, members: usize) -> Result<()> {
    let mut seen = HashSet::new();
    if uuid::Uuid::parse_str(&entry.id).is_err()
        || !bounded(&entry.title, 80, true)
        || !(1..=20).contains(&entry.keywords.len())
        || entry
            .keywords
            .iter()
            .any(|k| !bounded(k, 80, true) || !seen.insert(k.to_lowercase()))
    {
        return Err("팩 단어장의 ID·제목·키워드가 올바르지 않습니다.".into());
    }
    validate_scene(&entry.lines, members)
}
fn validate_pack(pack: &CharacterPack) -> Result<()> {
    if pack.format_version != 1
        || !(1..=2).contains(&pack.characters.len())
        || !bounded(&pack.name, 80, true)
        || !bounded(&pack.author, 120, false)
        || !bounded(&pack.license, 2000, false)
        || pack.pair_scenes.len() > 64
        || pack.wordbook.len() > 100
    {
        return Err("지원하지 않는 팩 버전 또는 잘못된 팩 구성입니다.".into());
    }
    let mut sources = HashSet::new();
    for definition in &pack.characters {
        validate_definition(definition)?;
        if !sources.insert(&definition.source_id) {
            return Err("팩 내부 캐릭터 sourceId가 중복됩니다.".into());
        }
    }
    for scene in &pack.pair_scenes {
        validate_scene(scene, pack.characters.len())?;
    }
    let mut ids = HashSet::new();
    for entry in &pack.wordbook {
        validate_wordbook(entry, pack.characters.len())?;
        if !ids.insert(&entry.id) {
            return Err("팩 단어장 ID가 중복됩니다.".into());
        }
    }
    let mut seen_sprites = HashSet::new();
    for sprite in &pack.sprites {
        let owner = pack
            .characters
            .iter()
            .find(|definition| definition.source_id == sprite.source_id)
            .ok_or("팩에 없는 캐릭터의 표정 이미지입니다.")?;
        if !sprite_slot_allowed(owner, &sprite.expression) {
            return Err("캐릭터에 없는 표정의 이미지입니다.".into());
        }
        if !seen_sprites.insert((&sprite.source_id, &sprite.expression)) {
            return Err("같은 표정의 이미지가 중복됩니다.".into());
        }
        let bytes = decode_sprite(sprite)?;
        if sprites::validate(&bytes)? != sprite.mime {
            return Err("표정 이미지의 형식과 내용이 다릅니다.".into());
        }
    }
    if serde_json::to_vec(pack).map_err(|e| e.to_string())?.len() > MAX_PACK_BYTES {
        return Err("캐릭터팩은 32 MiB 이하여야 합니다.".into());
    }
    Ok(())
}
fn decode_sprite(sprite: &PackSprite) -> Result<Vec<u8>> {
    if sprite.data.len() > sprites::MAX_SPRITE_BYTES * 4 / 3 + 4 {
        return Err("표정 이미지는 2 MiB 이하여야 합니다.".into());
    }
    base64::engine::general_purpose::STANDARD
        .decode(sprite.data.as_bytes())
        .map_err(|_| "표정 이미지 데이터를 읽을 수 없습니다.".into())
}
fn strict_scene(value: &serde_json::Value) -> Result<()> {
    let fields = value.as_object().ok_or("대사 형식이 올바르지 않습니다.")?;
    if fields.len() != 3
        || !fields
            .keys()
            .all(|k| ["persona", "expression", "text"].contains(&k.as_str()))
    {
        return Err("대사에 알 수 없는 필드가 있습니다.".into());
    }
    Ok(())
}
pub fn parse_pack(json: &str) -> Result<CharacterPack> {
    if json.len() > MAX_PACK_BYTES {
        return Err("캐릭터팩은 32 MiB 이하여야 합니다.".into());
    }
    let value: serde_json::Value =
        serde_json::from_str(json).map_err(|_| "캐릭터팩 JSON을 읽을 수 없습니다.")?;
    if let Some(scenes) = value.get("pairScenes").and_then(|v| v.as_array()) {
        for scene in scenes {
            for line in scene.as_array().ok_or("장면 형식이 올바르지 않습니다.")? {
                strict_scene(line)?;
            }
        }
    }
    if let Some(entries) = value.get("wordbook").and_then(|v| v.as_array()) {
        for entry in entries {
            let fields = entry
                .as_object()
                .ok_or("단어장 형식이 올바르지 않습니다.")?;
            if !fields.keys().all(|k| {
                ["id", "title", "keywords", "lines", "enabled", "useForIdle"].contains(&k.as_str())
            }) {
                return Err("단어장에 알 수 없는 필드가 있습니다.".into());
            }
            if let Some(lines) = entry.get("lines").and_then(|v| v.as_array()) {
                for line in lines {
                    strict_scene(line)?;
                }
            }
        }
    }
    let pack: CharacterPack =
        serde_json::from_value(value).map_err(|_| "캐릭터팩 필드 형식이 올바르지 않습니다.")?;
    validate_pack(&pack)?;
    Ok(pack)
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
fn builtin(slot: &str) -> CharacterDefinition {
    let a = slot == "a";
    CharacterDefinition {
        source_id: format!("builtin-{slot}"),
        version: 1,
        name: if a { "A" } else { "B" }.into(),
        description: "Comet 기본 캐릭터".into(),
        personality: if a {
            "호기심이 많고 다정하며 먼저 말을 건넨다."
        } else {
            "차분하고 간결하며 가끔 부드러운 농담을 한다."
        }
        .into(),
        expressions: BASE_EXPRESSIONS
            .iter()
            .zip(["(・_・)", "(^‿^)", "(・o・)", "(－_－)", "(・・;)", "(¬‿¬)"])
            .map(|(k, v)| (k.to_string(), v.into()))
            .collect(),
        face_icon: false,
        sprite_size: DEFAULT_SPRITE_SIZE,
        greeting: vec![CharacterLine {
            expression: "기쁨".into(),
            text: if a {
                "왔네. 오늘도 여기서 같이 지내자."
            } else {
                "계속 대답해 주지는 않아도 돼. 우리끼리도 잘 놀거든."
            }
            .into(),
        }],
        idle_lines: vec![CharacterLine {
            expression: "평온".into(),
            text: if a {
                "잠깐 쉬어 가도 좋겠다."
            } else {
                "여기서 조용히 같이 있을게."
            }
            .into(),
        }],
    }
}
pub fn initialize(conn: &Connection) -> Result<()> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute_batch("CREATE TABLE IF NOT EXISTS characters(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,pack_id TEXT,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS character_roster(position INTEGER PRIMARY KEY,character_id TEXT NOT NULL UNIQUE); CREATE TABLE IF NOT EXISTS character_packs(id TEXT PRIMARY KEY,data TEXT NOT NULL,members TEXT NOT NULL); CREATE TABLE IF NOT EXISTS character_dialogues(members TEXT PRIMARY KEY,data TEXT NOT NULL);").map_err(|e| e.to_string())?;
    sprites::initialize(&tx)?;
    for slot in ["a", "b"] {
        tx.execute(
            "INSERT OR IGNORE INTO characters(id,pack_id,data) VALUES(?1,NULL,?2)",
            params![
                format!("builtin-{slot}"),
                serde_json::to_string(&builtin(slot)).map_err(|e| e.to_string())?
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    migrate_slots(&tx)?;
    tx.commit().map_err(|e| e.to_string())
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
    if ids.is_empty() {
        ids = vec!["builtin-a".into(), "builtin-b".into()];
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
fn active_ids(conn: &Connection) -> Result<Vec<String>> {
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
pub fn active_character(conn: &Connection, slot: &str) -> Result<InstalledCharacter> {
    let ids = active_ids(conn)?;
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
pub fn apply_pair(conn: &Connection, ids: [String; 2]) -> Result<()> {
    if ids[0] == ids[1] {
        return Err("같은 로컬 캐릭터를 두 자리에 적용할 수 없습니다.".into());
    }
    apply_roster(conn, ids.to_vec())
}
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
        for sprite in &mut pack.sprites {
            sprite.source_id = original.definition.source_id.clone();
        }
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
        if let Some(index) = ids.iter().position(|active| active == id) {
            let preferred = if index == 1 {
                ["builtin-b", "builtin-a"]
            } else {
                ["builtin-a", "builtin-b"]
            };
            match preferred.iter().find(|candidate| !ids.iter().any(|active| active == *candidate)) {
                Some(candidate) => ids[index] = (*candidate).into(),
                None => {
                    ids.remove(index);
                }
            }
            write_roster(tx, &ids)?;
        }
        tx.execute("DELETE FROM characters WHERE id=?", [id])
            .map_err(|e| e.to_string())?;
        sprites::remove_all(tx, id)?;
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
            tx.execute(
                "INSERT INTO characters(id,pack_id,data) VALUES(?1,?2,?3)",
                params![
                    id,
                    pack_id,
                    serde_json::to_string(definition).map_err(|e| e.to_string())?
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
fn remap(lines: &[SceneLine], members: &[String], targets: &[String]) -> Option<Vec<SceneLine>> {
    lines
        .iter()
        .map(|line| {
            let source = members.get(slot_index(&line.persona).ok()?)?;
            let index = targets.iter().position(|id| id == source)?;
            Some(SceneLine {
                persona: ["a", "b"][index].into(),
                expression: line.expression.clone(),
                text: line.text.clone(),
            })
        })
        .collect()
}
fn packs_for(conn: &Connection, active: &[String]) -> Result<Vec<(CharacterPack, Vec<String>)>> {
    let mut seen = HashSet::new();
    let mut packs = Vec::new();
    for id in active {
        if let Some(pack_id) = get(conn, id)?.pack_id {
            if seen.insert(pack_id.clone()) {
                let record = pack_record(conn, &pack_id)?;
                if record.1.iter().all(|id| active.contains(id)) {
                    packs.push(record);
                }
            }
        }
    }
    let mut ordered = Vec::new();
    for record in packs {
        let first = &record.1[0];
        let seq: i64 = conn.query_row("SELECT p.rowid FROM character_packs p JOIN characters c ON c.pack_id=p.id WHERE c.id=?", [first], |r| r.get(0)).map_err(|e| e.to_string())?;
        ordered.push((seq, record));
    }
    ordered.sort_by_key(|(seq, _)| *seq);
    Ok(ordered.into_iter().map(|(_, record)| record).collect())
}
pub fn greeting(conn: &Connection, slot: &str) -> Result<Vec<SceneLine>> {
    Ok(active_character(conn, slot)?
        .definition
        .greeting
        .into_iter()
        .map(|line| SceneLine {
            persona: slot.into(),
            expression: line.expression,
            text: line.text,
        })
        .collect())
}
fn canonical_members(ids: &[String]) -> Result<(Vec<String>, String)> {
    if !(1..=2).contains(&ids.len()) || ids.len() == 2 && ids[0] == ids[1] {
        return Err("서로 다른 캐릭터 1~2명을 선택해 주세요.".into());
    }
    let mut canonical = ids.to_vec();
    canonical.sort();
    let key = serde_json::to_string(&canonical).map_err(|e| e.to_string())?;
    Ok((canonical, key))
}
fn mapped_dialogue(
    source: CharacterDialogue,
    members: &[String],
    targets: &[String],
) -> Result<CharacterDialogue> {
    let mut mapped = CharacterDialogue::default();
    for scene in source.pair_scenes {
        mapped
            .pair_scenes
            .push(remap(&scene, members, targets).ok_or("대사의 캐릭터가 선택 범위에 없습니다.")?);
    }
    for mut entry in source.wordbook {
        entry.lines = remap(&entry.lines, members, targets)
            .ok_or("단어장의 캐릭터가 선택 범위에 없습니다.")?;
        mapped.wordbook.push(entry);
    }
    Ok(mapped)
}
fn local_dialogue(conn: &Connection, ids: &[String]) -> Result<Option<CharacterDialogue>> {
    let (members, key) = canonical_members(ids)?;
    let data: Option<String> = conn
        .query_row(
            "SELECT data FROM character_dialogues WHERE members=?",
            [key],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    data.map(|data| {
        let source = serde_json::from_str(&data).map_err(|e| e.to_string())?;
        mapped_dialogue(source, &members, ids)
    })
    .transpose()
}
fn scope_wordbook_ids(content: &mut CharacterDialogue, members: &[String]) -> Result<()> {
    use sha2::{Digest, Sha256};
    let (_, scope) = canonical_members(members)?;
    for entry in &mut content.wordbook {
        let mut hash = Sha256::new();
        hash.update(scope.as_bytes());
        hash.update([0]);
        hash.update(entry.id.as_bytes());
        let digest = hash.finalize();
        let mut bytes = [0_u8; 16];
        bytes.copy_from_slice(&digest[..16]);
        // UUID v8 carries our deterministic local scope identifier.
        bytes[6] = (bytes[6] & 0x0f) | 0x80;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        entry.id = uuid::Uuid::from_bytes(bytes).to_string();
    }
    Ok(())
}
pub fn dialogue(conn: &Connection, ids: &[String]) -> Result<CharacterDialogue> {
    canonical_members(ids)?;
    for id in ids {
        get(conn, id)?;
    }
    if let Some(local) = local_dialogue(conn, ids)? {
        return Ok(local);
    }
    let mut result = CharacterDialogue::default();
    let mut overridden = HashSet::new();
    if ids.len() == 2 {
        for id in ids {
            if let Some(single) = local_dialogue(conn, std::slice::from_ref(id))? {
                let mut mapped = mapped_dialogue(single, std::slice::from_ref(id), ids)?;
                scope_wordbook_ids(&mut mapped, std::slice::from_ref(id))?;
                result.pair_scenes.extend(mapped.pair_scenes);
                result.wordbook.extend(mapped.wordbook);
                overridden.insert(id.clone());
            }
        }
    }
    for (pack, members) in packs_for(conn, ids)? {
        if members.len() == 1 && overridden.contains(&members[0]) {
            continue;
        }
        let mut mapped = mapped_dialogue(
            CharacterDialogue {
                pair_scenes: pack.pair_scenes,
                wordbook: pack.wordbook,
            },
            &members,
            ids,
        )?;
        if ids.len() == 2 {
            scope_wordbook_ids(&mut mapped, &members)?;
        }
        result.pair_scenes.extend(mapped.pair_scenes);
        result.wordbook.extend(mapped.wordbook);
    }
    Ok(result)
}
pub fn save_dialogue(conn: &Connection, ids: &[String], content: &CharacterDialogue) -> Result<()> {
    let (members, key) = canonical_members(ids)?;
    for id in ids {
        get(conn, id)?;
    }
    if content.pair_scenes.len() > 64 || content.wordbook.len() > 100 {
        return Err("장면은 최대 64개, 단어장은 최대 100개까지 저장할 수 있습니다.".into());
    }
    for scene in &content.pair_scenes {
        validate_scene(scene, ids.len())?;
    }
    let mut seen = HashSet::new();
    for entry in &content.wordbook {
        validate_wordbook(entry, ids.len())?;
        if !seen.insert(&entry.id) {
            return Err("단어장 ID가 중복됩니다.".into());
        }
    }
    let canonical = mapped_dialogue(content.clone(), ids, &members)?;
    let data = serde_json::to_string(&canonical).map_err(|e| e.to_string())?;
    if data.len() > MAX_PACK_BYTES {
        return Err("캐릭터 대사 묶음은 1 MiB 이하여야 합니다.".into());
    }
    conn.execute("INSERT INTO character_dialogues(members,data) VALUES(?1,?2) ON CONFLICT(members) DO UPDATE SET data=excluded.data",params![key,data]).map_err(|e|e.to_string())?;
    Ok(())
}
pub fn idle_scene(conn: &Connection, index: usize) -> Result<Vec<SceneLine>> {
    let ids = active_ids(conn)?;
    let content = dialogue(conn, &ids)?;
    let mut scenes = content.pair_scenes;
    scenes.extend(
        content
            .wordbook
            .into_iter()
            .filter(|e| e.enabled && e.use_for_idle)
            .map(|e| e.lines),
    );
    if !scenes.is_empty() {
        return Ok(scenes[index % scenes.len()].clone());
    }
    let mut lines = Vec::new();
    for (slot, id) in ["a", "b"].iter().zip(&ids) {
        let definition = get(conn, id)?.definition;
        let line = &definition.idle_lines[index % definition.idle_lines.len()];
        lines.push(SceneLine {
            persona: (*slot).into(),
            expression: line.expression.clone(),
            text: line.text.clone(),
        });
    }
    Ok(lines)
}
pub fn keyword_scene(conn: &Connection, input: &str) -> Result<Option<Vec<SceneLine>>> {
    let ids = active_ids(conn)?;
    let entries = dialogue(conn, &ids)?.wordbook;
    Ok(crate::wordbook::match_entry(&entries, input).map(|entry| entry.lines.clone()))
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
        sprites: Vec::new(),
    };
    // Source identity is package-local; copies may legitimately share the original source ID.
    for (index, definition) in pack.characters.iter_mut().enumerate() {
        definition.source_id = format!("character-{}", index + 1);
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
mod tests {
    use super::*;
    fn database() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        initialize(&conn).unwrap();
        conn
    }
    fn pack() -> CharacterPack {
        CharacterPack {
            format_version: 1,
            name: "두 친구".into(),
            author: "제작자".into(),
            license: "수정·공유 가능".into(),
            characters: vec![builtin("a"), builtin("b")],
            pair_scenes: vec![vec![
                SceneLine {
                    persona: "a".into(),
                    expression: "평온".into(),
                    text: "  원문\n그대로  ".into(),
                },
                SceneLine {
                    persona: "b".into(),
                    expression: "장난".into(),
                    text: "응.".into(),
                },
            ]],
            wordbook: vec![WordbookEntry {
                id: uuid::Uuid::new_v4().to_string(),
                title: "인사".into(),
                keywords: vec!["HELLO".into()],
                lines: vec![SceneLine {
                    persona: "b".into(),
                    expression: "기쁨".into(),
                    text: "  안녕\n반가워  ".into(),
                }],
                enabled: true,
                use_for_idle: false,
            }],
            sprites: Vec::new(),
        }
    }
    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n-body";
    #[test]
    fn expressions_are_dynamic_but_keep_the_default_key() {
        let conn = database();
        let mut definition = builtin("a");
        definition
            .expressions
            .insert("슬픔".into(), "(；_；)".into());
        definition.expressions.remove("장난");
        definition.greeting[0].expression = "화남".into();
        let created = create(&conn, &definition).unwrap();
        assert_eq!(created.definition.expressions.len(), 6);
        assert_eq!(created.definition.greeting[0].expression, "화남");
        let mut invalid = definition.clone();
        invalid.expressions.remove(DEFAULT_EXPRESSION);
        assert!(create(&conn, &invalid).is_err());
        invalid = definition.clone();
        invalid.expressions.insert(" 공백 ".into(), "x".into());
        assert!(create(&conn, &invalid).is_err());
        invalid = definition.clone();
        for index in 0..30 {
            invalid.expressions.insert(format!("표정{index}"), "x".into());
        }
        assert!(create(&conn, &invalid).is_err());
        invalid = definition.clone();
        invalid.sprite_size = 16;
        assert!(create(&conn, &invalid).is_err());
        invalid = definition.clone();
        invalid.expressions.insert("$balloon".into(), "x".into());
        assert!(create(&conn, &invalid).is_err());
        let legacy: CharacterDefinition = serde_json::from_str(
            &serde_json::to_string(&builtin("b"))
                .unwrap()
                .replace(",\"spriteSize\":64", "")
                .replace(",\"faceIcon\":false", ""),
        )
        .unwrap();
        assert_eq!(legacy.sprite_size, DEFAULT_SPRITE_SIZE);
        assert!(!legacy.face_icon);
    }
    #[test]
    fn sprites_follow_save_clone_export_import_and_removal() {
        let conn = database();
        let created = clone_character(&conn, "builtin-a").unwrap();
        assert!(set_sprite(&conn, &created.id, "슬픔", PNG).is_err());
        set_sprite(&conn, &created.id, "기쁨", PNG).unwrap();
        set_sprite(&conn, &created.id, "장난", b"<svg xmlns='http://www.w3.org/2000/svg'/>").unwrap();
        assert!(set_sprite(&conn, &created.id, "평온", b"nope").is_err());
        let listed = get(&conn, &created.id).unwrap().sprites;
        assert_eq!(listed["기쁨"].mime, "image/png");
        assert_eq!(listed["장난"].mime, "image/svg+xml");
        set_sprite(&conn, &created.id, BALLOON_SPRITE, b"GIF89a-skin").unwrap();
        let mut edited = created.definition.clone();
        edited.expressions.remove("장난");
        save(&conn, &created.id, &edited).unwrap();
        let after = get(&conn, &created.id).unwrap().sprites;
        assert_eq!(after.keys().collect::<Vec<_>>(), [BALLOON_SPRITE, "기쁨"]);
        let copy = clone_character(&conn, &created.id).unwrap();
        assert_eq!(copy.sprites["기쁨"].mime, "image/png");
        assert_eq!(copy.sprites[BALLOON_SPRITE].mime, "image/gif");
        assert_eq!(copy.definition.source_id, created.definition.source_id);
        remove_sprite(&conn, &created.id, BALLOON_SPRITE).unwrap();
        let exported = export_pack(&conn, &[created.id.clone()], &[]).unwrap();
        assert_eq!(exported.sprites.len(), 1);
        assert_eq!(exported.sprites[0].source_id, "character-1");
        let json = serde_json::to_string(&exported).unwrap();
        let imported = import_pack(&conn, &parse_pack(&json).unwrap()).unwrap();
        assert_eq!(
            sprite(&conn, &imported[0].id, "기쁨").unwrap().unwrap().data,
            PNG
        );
        let stored = pack_record(&conn, imported[0].pack_id.as_ref().unwrap())
            .unwrap()
            .0;
        assert!(stored.sprites.is_empty());
        remove_sprite(&conn, &created.id, "기쁨").unwrap();
        assert!(get(&conn, &created.id).unwrap().sprites.is_empty());
        remove(&conn, &imported[0].id).unwrap();
        assert!(sprite(&conn, &imported[0].id, "기쁨").unwrap().is_none());
        let mut tampered = exported.clone();
        tampered.sprites[0].mime = "image/gif".into();
        assert!(validate_pack(&tampered).is_err());
        tampered = exported.clone();
        tampered.sprites[0].expression = "없는표정".into();
        assert!(validate_pack(&tampered).is_err());
        tampered = exported;
        tampered.sprites.push(tampered.sprites[0].clone());
        assert!(validate_pack(&tampered).is_err());
    }
    #[test]
    fn mutations_participate_in_outer_transaction_rollback() {
        let conn = database();
        {
            let tx = conn.unchecked_transaction().unwrap();
            let imported = import_pack(&tx, &pack()).unwrap();
            apply_pair(&tx, [imported[0].id.clone(), imported[1].id.clone()]).unwrap();
            remove(&tx, &imported[0].id).unwrap();
            assert_eq!(collection(&tx).unwrap().installed.len(), 3);
        }
        assert_eq!(collection(&conn).unwrap().installed.len(), 2);
        assert_eq!(active_ids(&conn).unwrap(), ["builtin-a", "builtin-b"]);
    }
    #[test]
    fn import_is_atomic_separate_and_does_not_activate() {
        let conn = database();
        let source = pack();
        let first = import_pack(&conn, &source).unwrap();
        let second = import_pack(&conn, &source).unwrap();
        assert_ne!(first[0].id, second[0].id);
        assert_ne!(first[0].id, "builtin-a");
        assert_eq!(active_ids(&conn).unwrap(), ["builtin-a", "builtin-b"]);
        let mut invalid = source;
        invalid.characters[1].name.clear();
        assert!(import_pack(&conn, &invalid).is_err());
        assert_eq!(collection(&conn).unwrap().installed.len(), 6);
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM character_packs", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            2
        );
    }
    #[test]
    fn database_failure_rolls_back_entire_import() {
        let conn = database();
        conn.execute_batch("CREATE TRIGGER reject_second BEFORE INSERT ON characters WHEN json_extract(NEW.data,'$.name')='B' BEGIN SELECT RAISE(ABORT,'test failure'); END;").unwrap();
        assert!(import_pack(&conn, &pack()).is_err());
        assert_eq!(collection(&conn).unwrap().installed.len(), 2);
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM character_packs", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
    #[test]
    fn swapped_pair_maps_exact_text_and_replacement_disables_pack_content() {
        let conn = database();
        let imported = import_pack(&conn, &pack()).unwrap();
        apply_pair(&conn, [imported[1].id.clone(), imported[0].id.clone()]).unwrap();
        let idle = idle_scene(&conn, 0).unwrap();
        assert_eq!(idle[0].persona, "b");
        assert_eq!(idle[0].text, "  원문\n그대로  ");
        let matched = keyword_scene(&conn, "hello!").unwrap().unwrap();
        assert_eq!(matched[0].persona, "a");
        assert_eq!(matched[0].text, "  안녕\n반가워  ");
        assign(&conn, "a", "builtin-a").unwrap();
        assert!(keyword_scene(&conn, "hello").unwrap().is_none());
        assert!(!idle_scene(&conn, 0)
            .unwrap()
            .iter()
            .any(|l| l.text.contains("원문")));
    }
    #[test]
    fn edit_preserves_identity_and_increments_host_version() {
        let conn = database();
        let created = clone_character(&conn, "builtin-a").unwrap();
        assign(&conn, "a", &created.id).unwrap();
        let mut edited = created.definition.clone();
        edited.name = "새 이름".into();
        edited.version = 900;
        edited.source_id = "steal".into();
        save(&conn, &created.id, &edited).unwrap();
        let current = active_character(&conn, "a").unwrap();
        assert_eq!(current.id, created.id);
        assert_eq!(current.definition.version, 2);
        assert_eq!(current.definition.source_id, "builtin-a");
        let copy = clone_character(&conn, &created.id).unwrap();
        assert_ne!(copy.id, created.id);
        assert!(assign(&conn, "b", &created.id).is_err());
        assert_eq!(active_character(&conn, "b").unwrap().id, "builtin-b");
    }
    #[test]
    fn reopen_removal_and_fallback_preserve_unrelated_data() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.db");
        let id;
        {
            let conn = Connection::open(&path).unwrap();
            initialize(&conn).unwrap();
            conn.execute_batch(
                "CREATE TABLE history(text TEXT); INSERT INTO history VALUES('old');",
            )
            .unwrap();
            id = clone_character(&conn, "builtin-b").unwrap().id;
            assign(&conn, "b", &id).unwrap();
        }
        let conn = Connection::open(&path).unwrap();
        initialize(&conn).unwrap();
        assert_eq!(active_character(&conn, "b").unwrap().id, id);
        remove(&conn, &id).unwrap();
        assert_eq!(active_ids(&conn).unwrap(), ["builtin-a", "builtin-b"]);
        initialize(&conn).unwrap();
        assert_eq!(collection(&conn).unwrap().installed.len(), 2);
        assert_eq!(
            conn.query_row("SELECT text FROM history", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "old"
        );
        assert!(remove(&conn, "builtin-a").is_err());
    }
    #[test]
    fn legacy_slot_table_migrates_once_into_the_roster() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE characters(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,pack_id TEXT,data TEXT NOT NULL); CREATE TABLE character_slots(slot TEXT PRIMARY KEY,character_id TEXT NOT NULL UNIQUE); INSERT INTO character_slots VALUES('a','builtin-b'),('b','builtin-a');").unwrap();
        for slot in ["a", "b"] {
            conn.execute(
                "INSERT INTO characters(id,pack_id,data) VALUES(?1,NULL,?2)",
                params![
                    format!("builtin-{slot}"),
                    serde_json::to_string(&builtin(slot)).unwrap()
                ],
            )
            .unwrap();
        }
        initialize(&conn).unwrap();
        assert_eq!(active_ids(&conn).unwrap(), ["builtin-b", "builtin-a"]);
        let has_slots: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='character_slots')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(!has_slots);
        apply_roster(&conn, vec!["builtin-a".into()]).unwrap();
        initialize(&conn).unwrap();
        assert_eq!(active_ids(&conn).unwrap(), ["builtin-a"]);
    }
    #[test]
    fn single_member_roster_leaves_slot_b_empty_and_appends_on_assign() {
        let conn = database();
        apply_roster(&conn, vec!["builtin-b".into()]).unwrap();
        assert_eq!(collection(&conn).unwrap().active, ["builtin-b"]);
        assert_eq!(active_character(&conn, "a").unwrap().id, "builtin-b");
        assert!(active_character(&conn, "b").is_err());
        assert_eq!(idle_scene(&conn, 0).unwrap().len(), 1);
        assign(&conn, "b", "builtin-a").unwrap();
        assert_eq!(active_ids(&conn).unwrap(), ["builtin-b", "builtin-a"]);
        assert!(apply_roster(&conn, Vec::new()).is_err());
        assert!(apply_roster(&conn, vec!["builtin-a".into(), "builtin-a".into()]).is_err());
        let many: Vec<String> = (0..=MAX_ROSTER)
            .map(|_| clone_character(&conn, "builtin-a").unwrap().id)
            .collect();
        assert!(apply_roster(&conn, many.clone()).is_err());
        apply_roster(&conn, many[..MAX_ROSTER].to_vec()).unwrap();
        assert_eq!(active_ids(&conn).unwrap().len(), MAX_ROSTER);
    }
    #[test]
    fn fallback_avoids_builtin_already_in_other_slot() {
        let conn = database();
        let created = clone_character(&conn, "builtin-a").unwrap();
        apply_pair(&conn, [created.id.clone(), "builtin-a".into()]).unwrap();
        remove(&conn, &created.id).unwrap();
        assert_eq!(active_ids(&conn).unwrap(), ["builtin-b", "builtin-a"]);
        assert!(apply_pair(&conn, ["builtin-a".into(), "missing".into()]).is_err());
        assert_eq!(active_ids(&conn).unwrap(), ["builtin-b", "builtin-a"]);
    }
    #[test]
    fn export_single_b_remaps_selected_personal_lines_and_excludes_private_data() {
        let conn = database();
        conn.execute_batch(
            "CREATE TABLE secrets(value TEXT); INSERT INTO secrets VALUES('never-export');",
        )
        .unwrap();
        let entry = pack().wordbook.remove(0);
        let exported =
            export_pack(&conn, &["builtin-b".into()], std::slice::from_ref(&entry)).unwrap();
        assert_eq!(exported.wordbook[0].lines[0].persona, "a");
        assert_eq!(exported.wordbook[0].lines[0].text, entry.lines[0].text);
        assert!(export_pack(&conn, &["builtin-a".into()], &[entry]).is_err());
        let text = serde_json::to_string(&exported).unwrap();
        assert!(!text.contains("never-export"));
        let imported = import_pack(&conn, &parse_pack(&text).unwrap()).unwrap();
        assert_eq!(imported[0].definition.name, "B");
        assert!(export_pack(&conn, &["builtin-b".into()], &[])
            .unwrap()
            .wordbook
            .is_empty());
    }
    #[test]
    fn malformed_unknown_nested_fields_and_oversize_are_rejected() {
        assert!(parse_pack("invalid").is_err());
        assert!(parse_pack(&" ".repeat(MAX_PACK_BYTES + 1)).is_err());
        for path in ["root", "definition", "line", "wordbook"] {
            let mut value = serde_json::to_value(pack()).unwrap();
            match path {
                "root" => value["secret"] = serde_json::json!(true),
                "definition" => value["characters"][0]["secret"] = serde_json::json!(true),
                "line" => value["pairScenes"][0][0]["secret"] = serde_json::json!(true),
                _ => value["wordbook"][0]["secret"] = serde_json::json!(true),
            }
            assert!(parse_pack(&value.to_string()).is_err(), "{path}");
        }
        let mut invalid = pack();
        invalid.format_version = 2;
        assert!(validate_pack(&invalid).is_err());
        invalid = pack();
        invalid.characters.truncate(1);
        assert!(validate_pack(&invalid).is_err());
    }
    #[test]
    fn pair_dialogue_override_survives_swap_export_and_empty_deletion() {
        let conn = database();
        let imported = import_pack(&conn, &pack()).unwrap();
        let ids = [imported[0].id.clone(), imported[1].id.clone()];
        apply_pair(&conn, ids.clone()).unwrap();
        let mut edited = dialogue(&conn, &ids).unwrap();
        edited.wordbook[0].lines[0].text = "  편집한 원문\n ".into();
        save_dialogue(&conn, &ids, &edited).unwrap();
        apply_pair(&conn, [ids[1].clone(), ids[0].clone()]).unwrap();
        let found = keyword_scene(&conn, "hello").unwrap().unwrap();
        assert_eq!(found[0].persona, "a");
        assert_eq!(found[0].text, "  편집한 원문\n ");
        let exported = export_pack(&conn, &[ids[1].clone(), ids[0].clone()], &[]).unwrap();
        assert_eq!(exported.wordbook[0].lines[0].persona, "a");
        assert_eq!(exported.wordbook[0].lines[0].text, found[0].text);
        save_dialogue(&conn, &ids, &CharacterDialogue::default()).unwrap();
        assert!(keyword_scene(&conn, "hello").unwrap().is_none());
        assert!(export_pack(&conn, &ids, &[]).unwrap().wordbook.is_empty());
        let original = pack_record(&conn, imported[0].pack_id.as_ref().unwrap())
            .unwrap()
            .0;
        assert_eq!(original.wordbook[0].lines[0].text, "  안녕\n반가워  ");
    }
    #[test]
    fn single_override_follows_character_in_mixed_pair_without_pair_leak() {
        let conn = database();
        let first = clone_character(&conn, "builtin-a").unwrap();
        let second = clone_character(&conn, "builtin-b").unwrap();
        let mut single = CharacterDialogue {
            pair_scenes: Vec::new(),
            wordbook: pack().wordbook,
        };
        single.wordbook[0].lines[0].persona = "a".into();
        save_dialogue(&conn, std::slice::from_ref(&first.id), &single).unwrap();
        let copy = clone_character(&conn, &first.id).unwrap();
        assert_ne!(copy.id, first.id);
        assert_eq!(
            dialogue(&conn, std::slice::from_ref(&copy.id))
                .unwrap()
                .wordbook[0]
                .lines[0]
                .text,
            single.wordbook[0].lines[0].text
        );
        apply_pair(&conn, ["builtin-b".into(), first.id.clone()]).unwrap();
        assert_eq!(
            keyword_scene(&conn, "hello").unwrap().unwrap()[0].persona,
            "b"
        );
        let ids = [first.id.clone(), second.id.clone()];
        let mut pair = single.clone();
        pair.wordbook[0].lines[0].text = "pair only".into();
        save_dialogue(&conn, &ids, &pair).unwrap();
        assert_ne!(
            keyword_scene(&conn, "hello").unwrap().unwrap()[0].text,
            "pair only"
        );
        apply_pair(&conn, ids.clone()).unwrap();
        assert_eq!(
            keyword_scene(&conn, "hello").unwrap().unwrap()[0].text,
            "pair only"
        );
        save_dialogue(&conn, &ids, &CharacterDialogue::default()).unwrap();
        assert!(keyword_scene(&conn, "hello").unwrap().is_none());
        assert_eq!(
            dialogue(&conn, std::slice::from_ref(&first.id))
                .unwrap()
                .wordbook
                .len(),
            1
        );
    }
    #[test]
    fn invalid_dialogue_does_not_replace_saved_content_and_reopens() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("dialogue.db");
        let ids = ["builtin-a".to_string()];
        {
            let conn = Connection::open(&path).unwrap();
            initialize(&conn).unwrap();
            let mut content = CharacterDialogue {
                pair_scenes: Vec::new(),
                wordbook: pack().wordbook,
            };
            content.wordbook[0].lines[0].persona = "a".into();
            save_dialogue(&conn, &ids, &content).unwrap();
            content.wordbook[0].lines[0].persona = "b".into();
            assert!(save_dialogue(&conn, &ids, &content).is_err());
        }
        let conn = Connection::open(&path).unwrap();
        initialize(&conn).unwrap();
        assert_eq!(
            dialogue(&conn, &ids).unwrap().wordbook[0].lines[0].persona,
            "a"
        );
    }
    #[test]
    fn cloning_imported_character_preserves_attribution_after_original_removal() {
        let conn = database();
        let mut source = pack();
        source.characters.truncate(1);
        source.pair_scenes.clear();
        source.wordbook[0].lines[0].persona = "a".into();
        let original = import_pack(&conn, &source).unwrap().remove(0);
        let cloned = clone_character(&conn, &original.id).unwrap();
        remove(&conn, &original.id).unwrap();
        let exported = export_pack(&conn, std::slice::from_ref(&cloned.id), &[]).unwrap();
        assert_eq!(exported.author, source.author);
        assert_eq!(exported.license, source.license);
        assert_eq!(exported.characters[0].name, source.characters[0].name);
        assert_eq!(
            exported.wordbook[0].lines[0].text,
            source.wordbook[0].lines[0].text
        );
    }
    #[test]
    fn combined_duplicate_source_wordbook_ids_remain_stable_and_editable() {
        let conn = database();
        let mut source = pack();
        source.characters.truncate(1);
        source.pair_scenes.clear();
        source.wordbook[0].lines[0].persona = "a".into();
        let first = import_pack(&conn, &source).unwrap().remove(0);
        let second = import_pack(&conn, &source).unwrap().remove(0);
        let ids = [first.id.clone(), second.id.clone()];
        let combined = dialogue(&conn, &ids).unwrap();
        assert_eq!(combined.wordbook.len(), 2);
        assert_ne!(combined.wordbook[0].id, combined.wordbook[1].id);
        assert_eq!(
            dialogue(&conn, &ids).unwrap().wordbook[0].id,
            combined.wordbook[0].id
        );
        save_dialogue(&conn, &ids, &combined).unwrap();
        let swapped = dialogue(&conn, &[second.id.clone(), first.id.clone()]).unwrap();
        assert_eq!(swapped.wordbook[0].id, combined.wordbook[0].id);
        assert_eq!(swapped.wordbook[0].lines[0].persona, "b");
        // Separately authored local overrides can also reuse the same source UUID.
        let content = CharacterDialogue {
            pair_scenes: Vec::new(),
            wordbook: source.wordbook,
        };
        save_dialogue(&conn, std::slice::from_ref(&first.id), &content).unwrap();
        let third = clone_character(&conn, "builtin-a").unwrap();
        save_dialogue(&conn, std::slice::from_ref(&third.id), &content).unwrap();
        let mixed = [first.id, third.id];
        let composed = dialogue(&conn, &mixed).unwrap();
        assert_ne!(composed.wordbook[0].id, composed.wordbook[1].id);
        save_dialogue(&conn, &mixed, &composed).unwrap();
    }
    #[test]
    fn keyword_ties_follow_install_order_not_slot_order() {
        let conn = database();
        let mut source = pack();
        source.characters.truncate(1);
        source.pair_scenes.clear();
        source.wordbook[0].lines[0].persona = "a".into();
        let first = import_pack(&conn, &source).unwrap();
        source.wordbook[0].lines[0].text = "second".into();
        let second = import_pack(&conn, &source).unwrap();
        apply_pair(&conn, [second[0].id.clone(), first[0].id.clone()]).unwrap();
        assert_eq!(
            keyword_scene(&conn, "hello").unwrap().unwrap()[0].text,
            "  안녕\n반가워  "
        );
    }
}
