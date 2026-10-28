pub(crate) mod animation;
pub(crate) mod animation_states;
pub mod archive;
mod bundled_motions;
pub(crate) mod collision;
pub(crate) mod collision_host;
pub(crate) mod commands;
pub(crate) mod files;
pub(crate) mod gestures;
pub(crate) mod guests;
pub(crate) mod life;
pub(crate) mod reaction_host;
pub(crate) mod reactions;
pub(crate) mod sprites;
mod story_definitions;
pub use story_definitions::{
    character_definition_baseline, get_pack_story_definition, npc_only_pack,
    pack_definition_baseline, save_pack_story_definition_expected,
};
mod dialogue;
mod validation;
pub use archive::ExportOptions;

use animation::{Animation, AssetInfo, PackAnimationAsset, PreparedAsset};
#[cfg(test)]
pub use dialogue::keyword_scene;
pub(crate) use dialogue::registered_directed_reply;
use dialogue::remap;
pub use dialogue::{
    dialogue, greeting, idle_scene, registered_keyword_scene, registered_relation_scene,
    save_dialogue,
};
use reactions::{MotionOverride, ReactionRule};
use sprites::SpriteInfo;
use validation::decode_sprite;
pub(crate) use validation::sprite_slot_allowed;
pub(crate) use validation::validate_definition;
#[cfg(test)]
use validation::validate_pack;
pub use validation::{pack_json, parse_pack};

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
pub const BALLOON_FONT_SIZE_RANGE: std::ops::RangeInclusive<u32> = 12..=40;
pub const MAX_ROSTER: usize = 8;
pub const SLOTS: [&str; 8] = ["a", "b", "c", "d", "e", "f", "g", "h"];
fn default_sprite_size() -> u32 {
    DEFAULT_SPRITE_SIZE
}
fn default_departure_lines() -> Vec<CharacterLine> {
    vec![CharacterLine {
        expression: DEFAULT_EXPRESSION.into(),
        text: "잠깐 다녀올게.".into(),
        motion: MotionOverride::default(),
    }]
}
fn default_return_lines() -> Vec<CharacterLine> {
    vec![CharacterLine {
        expression: DEFAULT_EXPRESSION.into(),
        text: "다녀왔어.".into(),
        motion: MotionOverride::default(),
    }]
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CharacterLine {
    pub expression: String,
    pub text: String,
    #[serde(default, skip_serializing_if = "MotionOverride::is_inherit")]
    pub motion: MotionOverride,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CharacterRelationship {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub reply_lines: Vec<CharacterLine>,
    pub target_id: String,
    pub description: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct BalloonStyle {
    pub font_size: u32,
    pub font_family: String,
    pub text_color: Option<String>,
    pub text_speed: u32,
}
impl Default for BalloonStyle {
    fn default() -> Self {
        Self {
            font_size: 16,
            font_family: String::new(),
            text_color: None,
            text_speed: 0,
        }
    }
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterDefinition {
    #[serde(
        default,
        skip_serializing_if = "crate::pack_stories::PresenceRole::is_resident"
    )]
    pub presence_role: crate::pack_stories::PresenceRole,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub npc: Option<crate::pack_stories::NpcDefinition>,
    pub source_id: String,
    // Accept the retired field in installed data and older packs without retaining it.
    #[serde(
        default,
        rename = "version",
        skip_serializing,
        deserialize_with = "discard_legacy_version"
    )]
    legacy_version: (),
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub birthday: Option<String>,
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
    #[serde(default)]
    pub balloon_style: BalloonStyle,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub animation: Option<Animation>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub reactions: Vec<ReactionRule>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub body_regions: Vec<reactions::BodyRegion>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub gesture_motions: Vec<reactions::GestureMotion>,
    pub greeting: Vec<CharacterLine>,
    pub idle_lines: Vec<CharacterLine>,
    #[serde(default = "default_departure_lines")]
    pub departure_lines: Vec<CharacterLine>,
    #[serde(default = "default_return_lines")]
    pub return_lines: Vec<CharacterLine>,
    /// Fields another build stored that this one does not know. A stored character still loads
    /// and keeps them when saved; pack files and new definitions may not carry any.
    #[serde(flatten)]
    pub unknown: serde_json::Map<String, serde_json::Value>,
}
pub(crate) fn birthday_parts(value: &str) -> Option<(u32, u32)> {
    let bytes = value.as_bytes();
    if bytes.len() != 5
        || bytes[2] != b'-'
        || ![bytes[0], bytes[1], bytes[3], bytes[4]]
            .iter()
            .all(u8::is_ascii_digit)
    {
        return None;
    }
    let month = u32::from(bytes[0] - b'0') * 10 + u32::from(bytes[1] - b'0');
    let day = u32::from(bytes[3] - b'0') * 10 + u32::from(bytes[4] - b'0');
    ((1..=12).contains(&month) && (1..=31).contains(&day)).then_some((month, day))
}

fn discard_legacy_version<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<(), D::Error> {
    u32::deserialize(deserializer).map(|_| ())
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InstalledCharacter {
    pub id: String,
    pub pack_id: Option<String>,
    pub definition: CharacterDefinition,
    #[serde(default)]
    pub sprites: BTreeMap<String, SpriteInfo>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub animation_assets: BTreeMap<String, AssetInfo>,
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
    pub author: String,
    pub source_url: String,
    pub license: String,
    /// Same content as a pack compiled into the app, whether seeded or imported from its file.
    pub official: bool,
    /// Unix seconds; `None` for packs installed before the time was recorded.
    pub installed_at: Option<i64>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CharacterPack {
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub world_rules: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub story_flags: Vec<crate::pack_stories::StoryFlag>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub knowledge: Vec<crate::pack_stories::ConditionalKnowledge>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub scenarios: Vec<crate::pack_stories::ScenarioDefinition>,
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
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub animation_assets: Vec<PackAnimationAsset>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub archive: Option<archive::CharacterArchive>,
}

impl CharacterPack {
    pub fn story_definition(&self) -> crate::pack_stories::PackStoryDefinition {
        crate::pack_stories::PackStoryDefinition {
            world_rules: self.world_rules.clone(),
            story_flags: self.story_flags.clone(),
            knowledge: self.knowledge.clone(),
            scenarios: self.scenarios.clone(),
        }
    }
    pub fn set_story_definition(&mut self, value: crate::pack_stories::PackStoryDefinition) {
        self.world_rules = value.world_rules;
        self.story_flags = value.story_flags;
        self.knowledge = value.knowledge;
        self.scenarios = value.scenarios;
    }
}
pub struct PreparedCharacterPack {
    pack: CharacterPack,
    animation_assets: BTreeMap<String, Vec<PreparedAsset>>,
}

pub fn prepare_pack(pack: CharacterPack) -> Result<PreparedCharacterPack> {
    validation::validate_pack_metadata(&pack)?;
    let mut animation_assets = BTreeMap::new();
    for definition in &pack.characters {
        let assets = pack
            .animation_assets
            .iter()
            .filter(|asset| asset.source_id == definition.source_id)
            .map(PackAnimationAsset::asset)
            .collect();
        animation_assets.insert(
            definition.source_id.clone(),
            animation::prepare_assets(assets)?,
        );
    }
    Ok(PreparedCharacterPack {
        pack,
        animation_assets,
    })
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
    let mut definition = factory_pack().characters.remove(usize::from(slot != "a"));
    definition.departure_lines = default_departure_lines();
    definition.return_lines = default_return_lines();
    definition
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

fn factory_expression_replacement(
    definition: &CharacterDefinition,
    factory: &CharacterPack,
) -> Option<BTreeMap<String, String>> {
    let previous = match definition.source_id.as_str() {
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
        _ => return None,
    };
    let previous = EXPRESSIONS
        .iter()
        .zip(previous)
        .map(|(key, value)| (key.to_string(), value.to_string()))
        .collect::<BTreeMap<_, _>>();
    if definition.expressions != previous {
        return None;
    }
    let replacement = factory
        .characters
        .iter()
        .find(|candidate| candidate.source_id == definition.source_id)?;
    Some(replacement.expressions.clone())
}

fn normalized_factory_pack(mut pack: CharacterPack, factory: &CharacterPack) -> CharacterPack {
    for definition in &mut pack.characters {
        if let Some(expressions) = factory_expression_replacement(definition, factory) {
            definition.expressions = expressions;
        }
    }
    pack
}

fn migrate_factory_expressions(conn: &Connection) -> Result<()> {
    let factory = nadir_pack();
    for mut character in collection(conn)?.installed {
        let Some(expressions) = factory_expression_replacement(&character.definition, &factory)
        else {
            continue;
        };
        character.definition.expressions = expressions;
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

fn previous_dialogue_packs() -> Vec<CharacterPack> {
    // v0 snapshots are the published pre-presence packs from f5e6615 and 2302220.
    // v1 preserves the original v6 dialogue; v2 freezes both inputs to the combined expansion.
    [
        include_str!("../content/previous-character-packs-v1.json"),
        include_str!("../content/previous-character-packs-v0.json"),
        include_str!("../content/previous-character-packs-v2.json"),
    ]
    .into_iter()
    .flat_map(|json| {
        serde_json::from_str::<Vec<serde_json::Value>>(json)
            .expect("previous bundled character packages must be valid")
    })
    .map(|pack| parse_pack(&pack.to_string()).expect("previous character package must be valid"))
    .collect()
}

fn with_factory_dialogue(
    mut definition: CharacterDefinition,
    factory: &CharacterDefinition,
) -> CharacterDefinition {
    definition.greeting = factory.greeting.clone();
    definition.idle_lines = factory.idle_lines.clone();
    definition.departure_lines = factory.departure_lines.clone();
    definition.return_lines = factory.return_lines.clone();
    definition
}

fn migrate_factory_dialogue(conn: &Connection) -> Result<()> {
    if conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM character_seed WHERE version=5)",
            [],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|error| error.to_string())?
    {
        return Ok(());
    }
    let latest = [byulkkori_pack(), nadir_pack()];
    let previous = previous_dialogue_packs()
        .into_iter()
        .map(|old| normalized_factory_pack(old, &latest[1]))
        .collect::<Vec<_>>();
    let candidates = previous
        .iter()
        .filter_map(|old| {
            latest
                .iter()
                .find(|new| {
                    old.characters
                        .iter()
                        .map(|definition| &definition.source_id)
                        .eq(new
                            .characters
                            .iter()
                            .map(|definition| &definition.source_id))
                })
                .map(|new| (old, new))
        })
        .collect::<Vec<_>>();
    // A saved pack and its live members must all still be the shipped original.
    // Local dialogue overrides live separately and are never rewritten here.
    for installed in installed_packs(conn)? {
        let (mut pack, members) = pack_record(conn, &installed.id)?;
        let normalized = normalized_factory_pack(pack.clone(), &latest[1]);
        for (old, new) in &candidates {
            let expected = CharacterPack {
                sprites: Vec::new(),
                animation_assets: Vec::new(),
                archive: None,
                ..(*old).clone()
            };
            if serde_json::to_value(&normalized).map_err(|error| error.to_string())?
                != serde_json::to_value(&expected).map_err(|error| error.to_string())?
                || members.len() != old.characters.len()
                || members.iter().zip(&old.characters).any(|(id, definition)| {
                    !get(conn, id).is_ok_and(|character| character.definition == *definition)
                })
            {
                continue;
            }
            pack.format_version = pack.format_version.max(6);
            pack.characters = pack
                .characters
                .into_iter()
                .zip(&new.characters)
                .map(|(definition, factory)| with_factory_dialogue(definition, factory))
                .collect();
            pack.pair_scenes = new.pair_scenes.clone();
            conn.execute(
                "UPDATE character_packs SET data=?1 WHERE id=?2",
                params![
                    serde_json::to_string(&pack).map_err(|error| error.to_string())?,
                    installed.id
                ],
            )
            .map_err(|error| error.to_string())?;
        }
    }
    for character in collection(conn)?.installed {
        for (old, new) in &candidates {
            let Some(index) = old
                .characters
                .iter()
                .position(|definition| *definition == character.definition)
            else {
                continue;
            };
            conn.execute(
                "UPDATE characters SET data=?1 WHERE id=?2",
                params![
                    serde_json::to_string(&with_factory_dialogue(
                        character.definition.clone(),
                        &new.characters[index],
                    ))
                    .map_err(|error| error.to_string())?,
                    character.id
                ],
            )
            .map_err(|error| error.to_string())?;
        }
    }
    conn.execute("INSERT INTO character_seed VALUES(5)", [])
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn migrate_official_birthdays(conn: &Connection) -> Result<()> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY,value TEXT NOT NULL);")
        .map_err(|error| error.to_string())?;
    let done: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM kv WHERE key='character:official-birthdays:v1')",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if done {
        return Ok(());
    }
    let factories = [byulkkori_pack(), nadir_pack()];
    for installed in installed_packs(conn)? {
        let (mut pack, members) = pack_record(conn, &installed.id)?;
        let Some(factory) = factories.iter().find(|factory| {
            let mut expected = (**factory).clone();
            expected.sprites.clear();
            expected.animation_assets.clear();
            expected.archive = None;
            for character in &mut expected.characters {
                character.birthday = None;
            }
            serde_json::to_value(&pack).ok() == serde_json::to_value(&expected).ok()
                && members.len() == expected.characters.len()
                && members
                    .iter()
                    .zip(&expected.characters)
                    .all(|(id, definition)| {
                        let mut local = definition.clone();
                        for relation in &mut local.relationships {
                            let Some(index) = expected
                                .characters
                                .iter()
                                .position(|character| character.source_id == relation.target_id)
                            else {
                                return false;
                            };
                            relation.target_id = members[index].clone();
                        }
                        get(conn, id).is_ok_and(|character| character.definition == local)
                    })
        }) else {
            continue;
        };
        for ((definition, source), id) in pack
            .characters
            .iter_mut()
            .zip(&factory.characters)
            .zip(&members)
        {
            let Some(birthday) = &source.birthday else {
                continue;
            };
            let mut character = get(conn, id)?;
            if definition.birthday.is_none()
                && character.definition.birthday.is_none()
                && character.definition.source_id == definition.source_id
            {
                definition.birthday = Some(birthday.clone());
                character.definition.birthday = Some(birthday.clone());
                conn.execute(
                    "UPDATE characters SET data=?1 WHERE id=?2",
                    params![
                        serde_json::to_string(&character.definition)
                            .map_err(|error| error.to_string())?,
                        id
                    ],
                )
                .map_err(|error| error.to_string())?;
            }
        }
        conn.execute(
            "UPDATE character_packs SET data=?1 WHERE id=?2",
            params![
                serde_json::to_string(&pack).map_err(|error| error.to_string())?,
                installed.id
            ],
        )
        .map_err(|error| error.to_string())?;
    }
    conn.execute(
        "INSERT INTO kv(key,value) VALUES('character:official-birthdays:v1','1')",
        [],
    )
    .map_err(|error| error.to_string())?;
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
    migrate_pack_install_time(&tx)?;
    story_definitions::initialize(&tx)?;
    sprites::initialize(&tx)?;
    animation::initialize(&tx)?;
    archive::initialize(&tx)?;
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
    bundled_motions::migrate(&tx)?;
    migrate_factory_dialogue(&tx)?;
    migrate_official_birthdays(&tx)?;
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
fn migrate_pack_install_time(conn: &Connection) -> Result<()> {
    let present: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info('character_packs') WHERE name='installed_at')",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !present {
        conn.execute_batch("ALTER TABLE character_packs ADD COLUMN installed_at INTEGER")
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
fn is_official_pack(pack: &CharacterPack) -> bool {
    static OFFICIAL: std::sync::OnceLock<Vec<(String, Vec<String>)>> = std::sync::OnceLock::new();
    let identity = |pack: &CharacterPack| {
        (
            pack.name.clone(),
            pack.characters
                .iter()
                .map(|definition| definition.source_id.clone())
                .collect::<Vec<_>>(),
        )
    };
    OFFICIAL
        .get_or_init(|| {
            [byulkkori_pack(), nadir_pack()]
                .iter()
                .map(identity)
                .collect()
        })
        .contains(&identity(pack))
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
pub(crate) fn get(conn: &Connection, id: &str) -> Result<InstalledCharacter> {
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
        animation_assets: animation::list(conn, id)?,
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
    let installed_at = conn
        .query_row(
            "SELECT installed_at FROM character_packs WHERE id=?",
            [id],
            |r| r.get::<_, Option<i64>>(0),
        )
        .map_err(|e| e.to_string())?;
    let official = is_official_pack(&pack);
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
        author: pack.author,
        source_url: pack.source_url,
        license: pack.license,
        official,
        installed_at,
    })
}
pub fn apply_pack(conn: &Connection, pack_id: &str) -> Result<()> {
    with_transaction(conn, |tx| {
        let pack = installed_pack(tx, pack_id)?;
        if pack.character_ids.is_empty() {
            return Err("이 팩에는 함께 지낼 캐릭터가 남아 있지 않습니다.".into());
        }
        let residents = pack
            .character_ids
            .into_iter()
            .filter(|id| {
                get(tx, id).is_ok_and(|member| {
                    member.definition.presence_role == crate::pack_stories::PresenceRole::Resident
                })
            })
            .collect();
        apply_roster(tx, residents)
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
            if get(tx, id)?.definition.presence_role != crate::pack_stories::PresenceRole::Resident
            {
                return Err("상주 목록에는 상주 역할의 인물만 골라 주세요.".into());
            }
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
#[cfg(test)]
pub fn save(conn: &Connection, id: &str, definition: &CharacterDefinition) -> Result<()> {
    save_with_assets(conn, id, definition, &[])
}
pub fn save_with_assets(
    conn: &Connection,
    id: &str,
    definition: &CharacterDefinition,
    assets: &[PreparedAsset],
) -> Result<()> {
    // Fields another build stored stay with the character: an edit neither drops nor adds them.
    let mut known = definition.clone();
    known.unknown.clear();
    validate_definition(&known)?;
    let old = get(conn, id)?;
    story_definitions::validate_profile(conn, id, definition)?;
    validate_local_relationships(conn, id, definition, &old.definition.relationships)?;
    let mut edited = known;
    edited.source_id = old.definition.source_id;
    edited.unknown = old.definition.unknown;
    if old.definition.animation.as_ref().is_some_and(|previous| {
        previous.clips.iter().any(|clip| {
            !edited
                .animation
                .as_ref()
                .is_some_and(|current| current.clips.iter().any(|kept| kept.id == clip.id))
        })
    }) {
        dialogue::validate_replaced_motions(conn, id, &edited)?;
    }
    with_transaction(conn, |tx| {
        save_animation_assets(tx, id, &edited, assets)?;
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
#[cfg(test)]
pub fn create(conn: &Connection, definition: &CharacterDefinition) -> Result<InstalledCharacter> {
    create_with_assets(conn, definition, &[])
}
pub fn create_with_assets(
    conn: &Connection,
    definition: &CharacterDefinition,
    assets: &[PreparedAsset],
) -> Result<InstalledCharacter> {
    validate_definition(definition)?;
    let id = uuid::Uuid::new_v4().to_string();
    validate_local_relationships(conn, &id, definition, &[])?;
    with_transaction(conn, |tx| {
        tx.execute(
            "INSERT INTO characters(id,pack_id,data) VALUES(?1,NULL,?2)",
            params![
                id,
                serde_json::to_string(definition).map_err(|e| e.to_string())?
            ],
        )
        .map_err(|e| e.to_string())?;
        save_animation_assets(tx, &id, definition, assets)?;
        get(tx, &id)
    })
}

fn save_animation_assets(
    conn: &Connection,
    id: &str,
    definition: &CharacterDefinition,
    assets: &[PreparedAsset],
) -> Result<()> {
    let keep = animation::referenced_assets(definition.animation.as_ref());
    let mut known = animation::list(conn, id)?;
    let mut additions = BTreeSet::new();
    for asset in assets {
        if !keep.contains(asset.asset_id.as_str()) || !additions.insert(asset.asset_id.as_str()) {
            return Err("애니메이션에서 사용하지 않거나 중복된 이미지가 있어요.".into());
        }
        known.insert(asset.asset_id.clone(), asset.info.clone());
    }
    animation::validate_references(definition.animation.as_ref(), &known)?;
    for asset in assets {
        animation::put(conn, id, asset)?;
    }
    animation::retain(conn, id, definition.animation.as_ref())
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
        let mut pack =
            export_pack_contents(tx, &[id.to_string()], &[], &ExportOptions::default(), false)?;
        for sprite in &mut pack.sprites {
            sprite.source_id = original.definition.source_id.clone();
        }
        for asset in &mut pack.animation_assets {
            asset.source_id = original.definition.source_id.clone();
        }
        let assets = animation::all(tx, id)?;
        let animation_assets = BTreeMap::from([(original.definition.source_id.clone(), assets)]);
        pack.characters[0] = original.definition;
        // Installed assets have already been decoded and validated at their import boundary.
        validation::validate_pack_metadata(&pack)?;
        let prepared = PreparedCharacterPack {
            pack,
            animation_assets,
        };
        let mut cloned = import_prepared_pack(tx, &prepared)?
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
        animation::retain(tx, id, None)?;
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
    import_prepared_pack(conn, &prepare_pack(pack.clone())?)
}
pub fn import_prepared_pack(
    conn: &Connection,
    prepared: &PreparedCharacterPack,
) -> Result<Vec<InstalledCharacter>> {
    let pack = &prepared.pack;
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
            animation_assets: Vec::new(),
            archive: None,
            ..pack.clone()
        };
        tx.execute(
            "INSERT INTO character_packs(id,data,members,installed_at) VALUES(?1,?2,?3,?4)",
            params![
                pack_id,
                serde_json::to_string(&record).map_err(|e| e.to_string())?,
                serde_json::to_string(&ids).map_err(|e| e.to_string())?,
                chrono::Utc::now().timestamp()
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
            let assets = prepared
                .animation_assets
                .get(&definition.source_id)
                .map(Vec::as_slice)
                .unwrap_or_default();
            save_animation_assets(tx, id, &local_definition, assets)?;
        }
        if let Some(archive) = &pack.archive {
            let mapping = pack
                .characters
                .iter()
                .zip(&ids)
                .map(|(definition, id)| (definition.source_id.clone(), id.clone()))
                .collect();
            archive::import(tx, archive, &mapping)?;
        }
        let installed = ids.iter().map(|id| get(tx, id)).collect::<Result<_>>()?;
        Ok(installed)
    })
}
pub(crate) fn pack_record(conn: &Connection, id: &str) -> Result<(CharacterPack, Vec<String>)> {
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
#[cfg(test)]
pub fn export_pack(
    conn: &Connection,
    ids: &[String],
    selected_wordbook: &[WordbookEntry],
) -> Result<CharacterPack> {
    export_pack_with_options(conn, ids, selected_wordbook, &ExportOptions::default())
}

pub fn export_pack_with_options(
    conn: &Connection,
    ids: &[String],
    selected_wordbook: &[WordbookEntry],
    options: &ExportOptions,
) -> Result<CharacterPack> {
    export_pack_contents(conn, ids, selected_wordbook, options, true)
}

fn export_pack_contents(
    conn: &Connection,
    ids: &[String],
    selected_wordbook: &[WordbookEntry],
    options: &ExportOptions,
    include_shared_definitions: bool,
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
        world_rules: String::new(),
        story_flags: Vec::new(),
        knowledge: Vec::new(),
        scenarios: Vec::new(),
        author: String::new(),
        source_url: String::new(),
        license: String::new(),
        characters: installed.iter().map(|c| c.definition.clone()).collect(),
        pair_scenes: Vec::new(),
        wordbook: Vec::new(),
        sprites: Vec::new(),
        animation_assets: Vec::new(),
        archive: None,
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
                        reply_lines: relationship.reply_lines.clone(),
                    })
            })
            .collect();
    }
    for (definition, character) in pack.characters.iter().zip(&installed) {
        if !options.include_sprites {
            continue;
        }
        for (expression, sprite) in sprites::all(conn, &character.id)? {
            pack.sprites.push(PackSprite {
                source_id: definition.source_id.clone(),
                expression,
                mime: sprite.mime,
                data: base64::engine::general_purpose::STANDARD.encode(sprite.data),
            });
        }
        for asset in animation::all(conn, &character.id)? {
            let payload = asset.payload();
            pack.animation_assets.push(PackAnimationAsset {
                source_id: definition.source_id.clone(),
                asset_id: payload.asset_id,
                mime: payload.mime,
                width: payload.width,
                height: payload.height,
                data: payload.data,
            });
        }
    }
    if options.includes_archive() {
        let mapping = ids.iter().cloned().zip(sources.iter().cloned()).collect();
        pack.archive = Some(archive::export(
            conn,
            &mapping,
            options,
            chrono::Utc::now().timestamp_millis(),
        )?);
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
    story_definitions::export_extras(
        conn,
        &installed,
        &sources,
        &mut pack,
        include_shared_definitions,
    )?;
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
    if !options.include_sprites {
        for definition in &mut pack.characters {
            definition.animation = None;
            for gesture in &mut definition.gesture_motions {
                for motion in [
                    &mut gesture.start,
                    &mut gesture.hold,
                    &mut gesture.moving_hold,
                    &mut gesture.end,
                ]
                .into_iter()
                .flatten()
                {
                    *motion = motion.without_images();
                }
            }
            for line in definition
                .greeting
                .iter_mut()
                .chain(&mut definition.idle_lines)
                .chain(&mut definition.departure_lines)
                .chain(&mut definition.return_lines)
                .chain(
                    definition
                        .npc
                        .iter_mut()
                        .flat_map(|npc| &mut npc.entry_lines),
                )
                .chain(
                    definition
                        .relationships
                        .iter_mut()
                        .flat_map(|relation| &mut relation.reply_lines),
                )
            {
                line.motion = line.motion.without_images();
            }
            for rule in &mut definition.reactions {
                for variant in &mut rule.variants {
                    variant.motion = variant.motion.without_images();
                }
                rule.variants.retain(|variant| variant.has_effect());
            }
            definition
                .reactions
                .retain(|rule| !rule.variants.is_empty());
        }
        for line in pack
            .pair_scenes
            .iter_mut()
            .flatten()
            .chain(pack.wordbook.iter_mut().flat_map(|entry| &mut entry.lines))
        {
            line.motion = line.motion.without_images();
        }
    }
    if !options.include_sprites {
        for scenario in &mut pack.scenarios {
            for line in scenario
                .intro
                .iter_mut()
                .chain(&mut scenario.accept)
                .chain(&mut scenario.decline)
                .chain(&mut scenario.defer)
                .chain(&mut scenario.ending)
            {
                line.motion = line.motion.without_images();
            }
        }
    }
    pack.format_version = if validation::has_gestures(&pack) {
        7
    } else if validation::has_state_bindings(&pack)
        || validation::has_authored_presence_lines(&pack)
    {
        6
    } else if validation::has_reactions_or_motion(&pack) {
        5
    } else if pack.archive.is_some() {
        4
    } else if pack
        .characters
        .iter()
        .any(|definition| definition.animation.is_some())
    {
        3
    } else {
        2
    };
    if !pack.story_definition().is_empty()
        || pack.characters.iter().any(|d| {
            d.presence_role != crate::pack_stories::PresenceRole::Resident
                || d.npc.is_some()
                || d.relationships.iter().any(|r| !r.reply_lines.is_empty())
        })
    {
        pack.format_version = 8;
    }
    if pack
        .scenarios
        .iter()
        .any(|scene| scene.reveal_affinity.is_some() || !scene.defer.is_empty())
    {
        pack.format_version = 12;
    }
    validation::validate_pack_metadata(&pack)?;
    Ok(pack)
}

#[cfg(test)]
mod animation_tests;
#[cfg(test)]
mod archive_tests;
#[cfg(test)]
mod reaction_tests;
#[cfg(test)]
mod tests;

pub fn resolve_lines(conn: &Connection, lines: &[SceneLine]) -> Result<Vec<SceneLine>> {
    lines
        .iter()
        .map(|line| {
            let owner = active_character(conn, &line.persona)?;
            reactions::validate_motion(&line.motion, &owner.definition, false)?;
            Ok(SceneLine {
                persona: owner.id,
                expression: line.expression.clone(),
                text: line.text.clone(),
                motion: line.motion.clone(),
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
    validation::validate_attribution(&value.author, &value.source_url)?;
    let data = serde_json::to_string(&pack).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE character_packs SET data=?1 WHERE id=?2",
        params![data, pack_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
