use super::validation::{validate_scene, validate_wordbook};
use super::{
    active_character, active_ids, builtin, factory_pack, get, pack_record, slot_index,
    CharacterDialogue, CharacterPack, Result, MAX_PACK_BYTES,
};
use crate::types::SceneLine;
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashSet;

pub(super) fn remap(
    lines: &[SceneLine],
    members: &[String],
    targets: &[String],
) -> Option<Vec<SceneLine>> {
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
    let definition = active_character(conn, slot)?.definition;
    let factory = factory_pack()
        .characters
        .into_iter()
        .find(|item| item.source_id == definition.source_id);
    let mut lines = definition.greeting;
    if factory.is_some_and(|item| item.greeting == lines) {
        let index = (uuid::Uuid::new_v4().as_u128() % lines.len() as u128) as usize;
        lines = vec![lines.remove(index)];
    }
    Ok(lines
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
    let factory_members = vec!["builtin-a".to_string(), "builtin-b".to_string()];
    if ids.len() == 2
        && factory_members.iter().all(|id| ids.contains(id))
        && overridden.is_empty()
        && get(conn, "builtin-a")?.definition == builtin("a")
        && get(conn, "builtin-b")?.definition == builtin("b")
    {
        let pack = factory_pack();
        let mapped = mapped_dialogue(
            CharacterDialogue {
                pair_scenes: pack.pair_scenes,
                wordbook: pack.wordbook,
            },
            &factory_members,
            ids,
        )?;
        result.pair_scenes.extend(mapped.pair_scenes);
        result.wordbook.extend(mapped.wordbook);
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
