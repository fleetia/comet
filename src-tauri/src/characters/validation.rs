use super::{slot_index, CharacterDefinition, CharacterPack, Result, EXPRESSIONS, MAX_PACK_BYTES};
use crate::types::{SceneLine, WordbookEntry};
use std::collections::HashSet;

fn bounded(value: &str, max: usize, required: bool) -> bool {
    (!required || !value.trim().is_empty()) && value.chars().count() <= max
}
fn validate_line(expression: &str, text: &str) -> Result<()> {
    if !EXPRESSIONS.contains(&expression) || !bounded(text, 500, true) {
        return Err("표정 또는 대사가 올바르지 않습니다. 대사는 1~500자여야 합니다.".into());
    }
    Ok(())
}
pub(super) fn validate_definition(definition: &CharacterDefinition) -> Result<()> {
    if !bounded(&definition.source_id, 128, true)
        || definition.version == 0
        || !bounded(&definition.name, 40, true)
        || !bounded(&definition.description, 500, false)
        || !bounded(&definition.personality, 500, false)
        || definition.expressions.len() != 6
        || EXPRESSIONS.iter().any(|key| {
            !definition
                .expressions
                .get(*key)
                .is_some_and(|v| bounded(v, 40, true))
        })
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
    if serde_json::to_vec(pack).map_err(|e| e.to_string())?.len() > MAX_PACK_BYTES {
        return Err("캐릭터팩은 1 MiB 이하여야 합니다.".into());
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
        return Err("캐릭터팩은 1 MiB 이하여야 합니다.".into());
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
