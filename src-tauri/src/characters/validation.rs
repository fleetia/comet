use super::{
    slot_index, CharacterDefinition, CharacterPack, PackSprite, Result, BALLOON_SPRITE,
    DEFAULT_EXPRESSION, MAX_PACK_BYTES, MAX_ROSTER, SLOTS, SPRITE_SIZE_RANGE,
};
use crate::character_sprites as sprites;
use crate::types::{SceneLine, WordbookEntry};
use base64::Engine;
use std::collections::HashSet;

fn bounded(value: &str, max: usize, required: bool) -> bool {
    (!required || !value.trim().is_empty()) && value.chars().count() <= max
}
fn validate_line(expression: &str, text: &str) -> Result<()> {
    if !valid_expression_key(expression) || !bounded(text, 500, true) {
        return Err(
            "표정 또는 대사가 올바르지 않습니다. 표정은 1~20자, 대사는 1~500자여야 합니다.".into(),
        );
    }
    Ok(())
}
pub(super) fn validate_definition(definition: &CharacterDefinition) -> Result<()> {
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
pub(super) fn validate_scene(lines: &[SceneLine], members: usize) -> Result<()> {
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
pub(super) fn validate_wordbook(entry: &WordbookEntry, members: usize) -> Result<()> {
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
pub(super) fn validate_pack(pack: &CharacterPack) -> Result<()> {
    if ![1, 2].contains(&pack.format_version)
        || !(1..=if pack.format_version == 1 {
            2
        } else {
            MAX_ROSTER
        })
            .contains(&pack.characters.len())
        || !bounded(&pack.name, 80, true)
        || !bounded(&pack.author, 120, false)
        || !bounded(&pack.source_url, 2048, false)
        || (!pack.source_url.is_empty() && !pack.source_url.starts_with("https://"))
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
    let mut value: serde_json::Value =
        serde_json::from_str(json).map_err(|_| "캐릭터팩 JSON을 읽을 수 없습니다.")?;
    if value["formatVersion"] == 2 {
        convert_pack_speakers(&mut value, false)?;
    }
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

fn valid_expression_key(key: &str) -> bool {
    bounded(key, 20, true) && key.trim() == key && !key.starts_with('$')
}

pub(super) fn decode_sprite(sprite: &PackSprite) -> Result<Vec<u8>> {
    if sprite.data.len() > sprites::MAX_SPRITE_BYTES * 4 / 3 + 4 {
        return Err("표정 이미지는 2 MiB 이하여야 합니다.".into());
    }
    base64::engine::general_purpose::STANDARD
        .decode(sprite.data.as_bytes())
        .map_err(|_| "표정 이미지 데이터를 읽을 수 없습니다.".into())
}

fn convert_pack_speakers(value: &mut serde_json::Value, exporting: bool) -> Result<()> {
    let sources: Vec<String> = value["characters"]
        .as_array()
        .ok_or("캐릭터 목록이 없습니다.")?
        .iter()
        .map(|definition| {
            definition["sourceId"]
                .as_str()
                .map(str::to_owned)
                .ok_or_else(|| "캐릭터 sourceId가 없습니다.".to_string())
        })
        .collect::<Result<_>>()?;
    if sources.len() > MAX_ROSTER {
        return Err("캐릭터는 최대 8명입니다.".into());
    }
    let transform = |line: &mut serde_json::Value| -> Result<()> {
        let fields = line
            .as_object_mut()
            .ok_or("대사 형식이 올바르지 않습니다.")?;
        let (from, to) = if exporting {
            ("persona", "speaker")
        } else {
            ("speaker", "persona")
        };
        if fields.len() != 3
            || !fields.contains_key("expression")
            || !fields.contains_key("text")
            || !fields.contains_key(from)
        {
            return Err("대사의 필드가 올바르지 않습니다.".into());
        }
        let speaker = fields.remove(from).ok_or("대사의 화자가 없습니다.")?;
        let speaker = speaker.as_str().ok_or("대사의 화자가 올바르지 않습니다.")?;
        let mapped = if exporting {
            sources
                .get(slot_index(speaker)?)
                .ok_or("팩에 없는 캐릭터입니다.")?
                .clone()
        } else {
            let index = sources
                .iter()
                .position(|source| source == speaker)
                .ok_or("팩에 없는 캐릭터입니다.")?;
            SLOTS[index].into()
        };
        fields.insert(to.into(), serde_json::Value::String(mapped));
        Ok(())
    };
    if let Some(scenes) = value.get_mut("pairScenes").and_then(|v| v.as_array_mut()) {
        for scene in scenes {
            for line in scene
                .as_array_mut()
                .ok_or("장면 형식이 올바르지 않습니다.")?
            {
                transform(line)?;
            }
        }
    }
    if let Some(entries) = value.get_mut("wordbook").and_then(|v| v.as_array_mut()) {
        for entry in entries {
            if let Some(lines) = entry.get_mut("lines").and_then(|v| v.as_array_mut()) {
                for line in lines {
                    transform(line)?;
                }
            }
        }
    }
    Ok(())
}

pub fn pack_json(pack: &CharacterPack) -> Result<String> {
    validate_pack(pack)?;
    let mut value = serde_json::to_value(pack).map_err(|e| e.to_string())?;
    if pack.format_version == 2 {
        convert_pack_speakers(&mut value, true)?;
    }
    let json = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
    if json.len() > MAX_PACK_BYTES {
        return Err("캐릭터팩은 32 MiB 이하여야 합니다.".into());
    }
    Ok(json)
}

pub(crate) fn sprite_slot_allowed(definition: &CharacterDefinition, key: &str) -> bool {
    key == BALLOON_SPRITE || definition.expressions.contains_key(key)
}
