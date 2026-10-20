use super::validation::{validate_scene, validate_wordbook};
use super::{
    active_character, active_ids, byulkkori_pack, factory_pack, get, nadir_pack, pack_record,
    slot_index, CharacterDefinition, CharacterDialogue, CharacterPack, Result, MAX_PACK_BYTES,
    MAX_ROSTER, SLOTS,
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
                persona: SLOTS[index].into(),
                expression: line.expression.clone(),
                text: line.text.clone(),
                motion: line.motion.clone(),
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
        .chain(nadir_pack().characters)
        .chain(byulkkori_pack().characters)
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
            motion: line.motion,
        })
        .collect())
}
fn canonical_members(ids: &[String]) -> Result<(Vec<String>, String)> {
    if !(1..=MAX_ROSTER).contains(&ids.len())
        || ids.iter().collect::<HashSet<_>>().len() != ids.len()
    {
        return Err("서로 다른 캐릭터 1~8명을 선택해 주세요.".into());
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
    if ids.len() > 1 {
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
    if ids.len() == 2 && factory_members.iter().all(|id| ids.contains(id)) && overridden.is_empty()
    {
        let a = get(conn, "builtin-a")?.definition;
        let b = get(conn, "builtin-b")?.definition;
        // Keep authored scenes for existing installations of the former default pack.
        for pack in [factory_pack(), nadir_pack()] {
            if a != pack.characters[0] || b != pack.characters[1] {
                continue;
            }
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
        if ids.len() > 1 {
            scope_wordbook_ids(&mut mapped, &members)?;
        }
        result.pair_scenes.extend(mapped.pair_scenes);
        result.wordbook.extend(mapped.wordbook);
    }
    Ok(result)
}
pub fn save_dialogue(conn: &Connection, ids: &[String], content: &CharacterDialogue) -> Result<()> {
    let (members, key) = canonical_members(ids)?;
    let definitions = ids
        .iter()
        .map(|id| get(conn, id).map(|character| character.definition))
        .collect::<Result<Vec<_>>>()?;
    if content.pair_scenes.len() > 64 || content.wordbook.len() > 100 {
        return Err("장면은 최대 64개, 단어장은 최대 100개까지 저장할 수 있습니다.".into());
    }
    for scene in &content.pair_scenes {
        validate_scene(scene, &definitions)?;
    }
    let mut seen = HashSet::new();
    for entry in &content.wordbook {
        validate_wordbook(entry, &definitions)?;
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

pub(super) fn validate_replaced_motions(
    conn: &Connection,
    id: &str,
    definition: &CharacterDefinition,
) -> Result<()> {
    let mut statement = conn
        .prepare("SELECT members FROM character_dialogues")
        .map_err(|error| error.to_string())?;
    let mut scopes = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?
        .map(|row| {
            serde_json::from_str::<Vec<String>>(&row.map_err(|error| error.to_string())?)
                .map_err(|error| error.to_string())
        })
        .collect::<Result<Vec<_>>>()?;
    if let Some(pack_id) = get(conn, id)?.pack_id {
        scopes.push(pack_record(conn, &pack_id)?.1);
    }
    let installed: HashSet<_> = super::collection(conn)?
        .installed
        .into_iter()
        .map(|character| character.id)
        .collect();
    for members in scopes {
        if !members.iter().any(|member| member == id)
            || members.iter().any(|member| !installed.contains(member))
        {
            continue;
        }
        let content = dialogue(conn, &members)?;
        for line in content
            .pair_scenes
            .iter()
            .flatten()
            .chain(content.wordbook.iter().flat_map(|entry| &entry.lines))
        {
            if members
                .get(slot_index(&line.persona)?)
                .is_some_and(|member| member == id)
            {
                crate::characters::reactions::validate_motion(&line.motion, definition, false)
                    .map_err(|_| "대사 묶음에서 사용 중인 모션이에요. 해당 대사의 모션을 바꾼 뒤 삭제해 주세요.".to_string())?;
            }
        }
    }
    let has_wordbook: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='wordbook')",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if has_wordbook {
        let active = active_ids(conn)?;
        for entry in crate::wordbook::entries(conn)? {
            for line in entry.lines {
                if active
                    .get(slot_index(&line.persona)?)
                    .is_some_and(|member| member == id)
                {
                    crate::characters::reactions::validate_motion(&line.motion, definition, false)
                        .map_err(|_| "개인 단어장에서 사용 중인 모션이에요. 해당 대사의 모션을 바꾼 뒤 삭제해 주세요.".to_string())?;
                }
            }
        }
    }
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
    for (slot, id) in SLOTS.iter().zip(&ids) {
        let definition = get(conn, id)?.definition;
        let line = &definition.idle_lines[index % definition.idle_lines.len()];
        lines.push(SceneLine {
            persona: (*slot).into(),
            expression: line.expression.clone(),
            text: line.text.clone(),
            motion: line.motion.clone(),
        });
    }
    Ok(lines)
}
#[cfg(test)]
pub fn keyword_scene(
    conn: &Connection,
    input: &str,
    targets: &[String],
) -> Result<Option<Vec<SceneLine>>> {
    let ids = active_ids(conn)?;
    let entries: Vec<_> = dialogue(conn, &ids)?
        .wordbook
        .into_iter()
        .filter(|entry| {
            targets.len() != 1
                || super::resolve_lines(conn, &entry.lines).map_or(true, |lines| {
                    lines.iter().all(|line| targets.contains(&line.persona))
                })
        })
        .collect();
    Ok(crate::wordbook::match_entry(&entries, input).map(|entry| entry.lines.clone()))
}

pub fn registered_keyword_scene(
    conn: &Connection,
    input: &str,
    targets: &[String],
) -> Result<Option<Vec<SceneLine>>> {
    let ids = active_ids(conn)?;
    let base = dialogue(conn, &ids)?.wordbook;
    let mut entries = base
        .into_iter()
        .enumerate()
        .map(|(index, entry)| (0_i64, index, entry))
        .collect::<Vec<_>>();
    let mut packs = Vec::new();
    let mut seen = HashSet::new();
    for id in targets.iter().chain(&ids) {
        let Ok(actor) = get(conn, id) else {
            continue;
        };
        let Some(pack_id) = actor.pack_id else {
            continue;
        };
        if !seen.insert(pack_id.clone()) {
            continue;
        }
        let (pack, members) = pack_record(conn, &pack_id)?;
        let seq: i64 = conn
            .query_row(
                "SELECT rowid FROM character_packs WHERE id=?1",
                [&pack_id],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        packs.push((seq, pack, members));
    }
    packs.sort_by_key(|(seq, _, _)| *seq);
    for (seq, pack, members) in packs {
        if members.iter().all(|member| ids.contains(member)) {
            let mut original = CharacterDialogue {
                wordbook: pack.wordbook,
                pair_scenes: Vec::new(),
            };
            if ids.len() > 1 {
                scope_wordbook_ids(&mut original, &members)?;
            }
            for (order, _, entry) in &mut entries {
                if original
                    .wordbook
                    .iter()
                    .any(|candidate| candidate.id == entry.id)
                {
                    *order = seq;
                }
            }
            continue;
        }
        let mut scoped = dialogue(conn, &members)?;
        if ids.len() > 1 {
            scope_wordbook_ids(&mut scoped, &members)?;
        }
        for (index, mut entry) in scoped.wordbook.into_iter().enumerate() {
            let mut lines = Vec::new();
            for line in entry.lines {
                let id = members
                    .get(slot_index(&line.persona)?)
                    .ok_or("등록 대사의 팩 화자를 확인해 주세요.")?;
                lines.push(SceneLine {
                    persona: id.clone(),
                    ..line
                });
            }
            entry.lines = lines;
            entries.push((seq, index, entry));
        }
    }
    entries.sort_by_key(|(seq, index, _)| (*seq, *index));
    let entries = entries
        .into_iter()
        .map(|(_, _, entry)| entry)
        .filter(|entry| {
            targets.len() != 1
                || entry
                    .lines
                    .iter()
                    .map(|line| active_character(conn, &line.persona).map(|actor| actor.id))
                    .collect::<Result<Vec<_>>>()
                    .map_or(true, |ids| ids.iter().all(|id| targets.contains(id)))
        })
        .collect::<Vec<_>>();
    Ok(crate::wordbook::match_entry(&entries, input).map(|entry| entry.lines.clone()))
}

pub(crate) fn registered_directed_reply(
    actor_id: &str,
    relationship: &super::CharacterRelationship,
    target_name: &str,
    input: &str,
) -> Option<Vec<SceneLine>> {
    if relationship.reply_lines.is_empty()
        || target_name.is_empty()
        || !crate::pack_stories::matches_keywords(&[target_name.to_string()], input)
    {
        return None;
    }
    Some(
        relationship
            .reply_lines
            .iter()
            .map(|line| SceneLine {
                persona: actor_id.to_string(),
                expression: line.expression.clone(),
                text: line.text.clone(),
                motion: line.motion.clone(),
            })
            .collect(),
    )
}

pub fn registered_relation_scene(
    conn: &Connection,
    input: &str,
    targets: &[String],
) -> Result<Option<Vec<SceneLine>>> {
    let installed = super::collection(conn)?.installed;
    for id in targets {
        let actor = get(conn, id)?;
        for relationship in &actor.definition.relationships {
            let Some(mentioned) = installed
                .iter()
                .find(|member| member.id == relationship.target_id)
            else {
                continue;
            };
            // An exact invite brings a visiting friend in; only a plain mention gets the reaction.
            if mentioned.definition.npc.as_ref().is_some_and(|npc| {
                crate::pack_stories::matches_keywords(&npc.invite_keywords, input)
            }) {
                continue;
            }
            if let Some(lines) = registered_directed_reply(
                &actor.id,
                relationship,
                &mentioned.definition.name,
                input,
            ) {
                return Ok(Some(lines));
            }
        }
    }
    let mentioned = installed
        .iter()
        .filter(|actor| {
            targets.contains(&actor.id)
                && !actor.definition.name.is_empty()
                && input
                    .to_lowercase()
                    .contains(&actor.definition.name.to_lowercase())
        })
        .map(|actor| actor.definition.name.to_lowercase())
        .collect::<HashSet<_>>()
        .len();
    if mentioned > 1 {
        let active = active_ids(conn)?;
        let content = dialogue(conn, &active)?;
        for scene in content.pair_scenes {
            if let Ok(resolved) = super::resolve_lines(conn, &scene) {
                if resolved.iter().all(|line| targets.contains(&line.persona)) {
                    return Ok(Some(resolved));
                }
            }
        }
        let mut seen = HashSet::new();
        let mut packs = Vec::new();
        for id in targets {
            let Some(pack_id) = get(conn, id)?.pack_id else {
                continue;
            };
            if !seen.insert(pack_id.clone()) {
                continue;
            }
            let (_, members) = pack_record(conn, &pack_id)?;
            if members.iter().all(|member| active.contains(member)) {
                continue;
            }
            let seq: i64 = conn
                .query_row(
                    "SELECT rowid FROM character_packs WHERE id=?1",
                    [&pack_id],
                    |row| row.get(0),
                )
                .map_err(|error| error.to_string())?;
            packs.push((seq, members));
        }
        packs.sort_by_key(|(seq, _)| *seq);
        for (_, members) in packs {
            for scene in dialogue(conn, &members)?.pair_scenes {
                let mapped = scene
                    .into_iter()
                    .map(|line| {
                        let persona = members
                            .get(slot_index(&line.persona)?)
                            .ok_or("등록 관계 대사의 화자를 확인해 주세요.")?
                            .clone();
                        Ok(SceneLine { persona, ..line })
                    })
                    .collect::<Result<Vec<_>>>()?;
                if mapped.iter().all(|line| targets.contains(&line.persona)) {
                    return Ok(Some(mapped));
                }
            }
        }
    }
    Ok(None)
}
