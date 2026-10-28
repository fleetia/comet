use super::*;
use crate::pack_stories::{PackStoryDefinition, PackStoryDefinitionSnapshot};

pub(super) fn initialize(db: &Connection) -> Result<()> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS character_pack_definition_revisions(pack_id TEXT PRIMARY KEY,revision INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS character_definition_revisions(character_id TEXT PRIMARY KEY,revision INTEGER NOT NULL);
    INSERT OR IGNORE INTO character_pack_definition_revisions SELECT id,0 FROM character_packs;
    INSERT OR IGNORE INTO character_definition_revisions SELECT id,0 FROM characters;
    CREATE TRIGGER IF NOT EXISTS pack_definition_insert AFTER INSERT ON character_packs BEGIN INSERT INTO character_pack_definition_revisions VALUES(NEW.id,1) ON CONFLICT(pack_id) DO UPDATE SET revision=revision+1; END;
    CREATE TRIGGER IF NOT EXISTS pack_definition_update AFTER UPDATE OF data,members ON character_packs WHEN OLD.data IS NOT NEW.data OR OLD.members IS NOT NEW.members BEGIN INSERT INTO character_pack_definition_revisions VALUES(NEW.id,1) ON CONFLICT(pack_id) DO UPDATE SET revision=revision+1; END;
    CREATE TRIGGER IF NOT EXISTS pack_definition_delete AFTER DELETE ON character_packs BEGIN UPDATE character_pack_definition_revisions SET revision=revision+1 WHERE pack_id=OLD.id; END;
    CREATE TRIGGER IF NOT EXISTS character_definition_insert AFTER INSERT ON characters BEGIN INSERT INTO character_definition_revisions VALUES(NEW.id,1) ON CONFLICT(character_id) DO UPDATE SET revision=revision+1; INSERT INTO character_pack_definition_revisions SELECT NEW.pack_id,1 WHERE NEW.pack_id IS NOT NULL ON CONFLICT(pack_id) DO UPDATE SET revision=revision+1; END;
    CREATE TRIGGER IF NOT EXISTS character_definition_update AFTER UPDATE OF data,pack_id ON characters WHEN OLD.data IS NOT NEW.data OR OLD.pack_id IS NOT NEW.pack_id BEGIN INSERT INTO character_definition_revisions VALUES(NEW.id,1) ON CONFLICT(character_id) DO UPDATE SET revision=revision+1; INSERT INTO character_pack_definition_revisions SELECT OLD.pack_id,1 WHERE OLD.pack_id IS NOT NULL ON CONFLICT(pack_id) DO UPDATE SET revision=revision+1; INSERT INTO character_pack_definition_revisions SELECT NEW.pack_id,1 WHERE NEW.pack_id IS NOT NULL AND NEW.pack_id IS NOT OLD.pack_id ON CONFLICT(pack_id) DO UPDATE SET revision=revision+1; END;
    CREATE TRIGGER IF NOT EXISTS character_definition_delete AFTER DELETE ON characters BEGIN UPDATE character_definition_revisions SET revision=revision+1 WHERE character_id=OLD.id; INSERT INTO character_pack_definition_revisions SELECT OLD.pack_id,1 WHERE OLD.pack_id IS NOT NULL ON CONFLICT(pack_id) DO UPDATE SET revision=revision+1; END;
    CREATE TRIGGER IF NOT EXISTS dialogue_definition_insert AFTER INSERT ON character_dialogues BEGIN UPDATE character_pack_definition_revisions SET revision=revision+1 WHERE pack_id IN (SELECT DISTINCT c.pack_id FROM characters c JOIN json_each(NEW.members) m ON c.id=m.value); END;
    CREATE TRIGGER IF NOT EXISTS dialogue_definition_update AFTER UPDATE ON character_dialogues WHEN OLD.data IS NOT NEW.data OR OLD.members IS NOT NEW.members BEGIN UPDATE character_pack_definition_revisions SET revision=revision+1 WHERE pack_id IN (SELECT DISTINCT c.pack_id FROM characters c JOIN json_each(NEW.members) m ON c.id=m.value UNION SELECT DISTINCT c.pack_id FROM characters c JOIN json_each(OLD.members) m ON c.id=m.value); END;
    CREATE TRIGGER IF NOT EXISTS dialogue_definition_delete AFTER DELETE ON character_dialogues BEGIN UPDATE character_pack_definition_revisions SET revision=revision+1 WHERE pack_id IN (SELECT DISTINCT c.pack_id FROM characters c JOIN json_each(OLD.members) m ON c.id=m.value); END;").map_err(|e|e.to_string())?;
    crate::pack_stories::initialize(db)
}

pub fn pack_definition_baseline(db: &Connection, pack_id: &str) -> Result<String> {
    db.query_row("SELECT r.revision FROM character_pack_definition_revisions r JOIN character_packs p ON p.id=r.pack_id WHERE p.id=?1",[pack_id],|row|row.get::<_,u64>(0)).map(|revision|revision.to_string()).map_err(|e|e.to_string())
}
pub fn character_definition_baseline(db: &Connection, id: &str) -> Result<String> {
    db.query_row("SELECT r.revision FROM character_definition_revisions r JOIN characters c ON c.id=r.character_id WHERE c.id=?1",[id],|row|row.get::<_,u64>(0)).map(|revision|revision.to_string()).map_err(|e|e.to_string())
}
pub fn npc_only_pack(db: &Connection, pack_id: &str) -> Result<bool> {
    let (_, members) = pack_record(db, pack_id)?;
    if members.is_empty() {
        return Ok(false);
    }
    for id in members {
        let data: Option<String> = db
            .query_row(
                "SELECT data FROM characters WHERE id=?1 AND pack_id=?2",
                params![id, pack_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        let Some(data) = data else {
            return Ok(false);
        };
        let definition: CharacterDefinition =
            serde_json::from_str(&data).map_err(|error| error.to_string())?;
        if definition.presence_role != crate::pack_stories::PresenceRole::Npc {
            return Ok(false);
        }
    }
    Ok(true)
}
pub fn get_pack_story_definition(
    db: &Connection,
    pack_id: &str,
) -> Result<PackStoryDefinitionSnapshot> {
    let (pack, members) = pack_record(db, pack_id)?;
    let source_to_local = pack
        .characters
        .iter()
        .zip(&members)
        .filter_map(|(definition, id)| {
            get(db, id)
                .ok()
                .map(|_| (definition.source_id.clone(), id.clone()))
        })
        .collect();
    Ok(PackStoryDefinitionSnapshot {
        pack_id: pack_id.into(),
        definition: pack.story_definition(),
        baseline: pack_definition_baseline(db, pack_id)?,
        source_to_local,
    })
}
pub fn save_pack_story_definition_expected(
    db: &Connection,
    pack_id: &str,
    definition: &PackStoryDefinition,
    expected_baseline: &str,
) -> Result<PackStoryDefinitionSnapshot> {
    with_transaction(db, |tx| {
        if pack_definition_baseline(tx, pack_id)? != expected_baseline {
            return Err("팩 정의가 바뀌었어요. 현재 내용을 다시 불러와 주세요.".into());
        }
        let (mut pack, members) = pack_record(tx, pack_id)?;
        let mut definitions = Vec::new();
        for id in &members {
            let exists: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM characters WHERE id=?1)",
                    [id],
                    |row| row.get(0),
                )
                .map_err(|error| error.to_string())?;
            if exists {
                definitions.push(get(tx, id)?.definition);
            }
        }
        crate::pack_stories::validate_pack(&definitions, definition)?;
        pack.set_story_definition(definition.clone());
        if !definition.is_empty() {
            let required_version = if definition
                .scenarios
                .iter()
                .any(|scene| scene.reveal_affinity.is_some() || !scene.defer.is_empty())
            {
                12
            } else {
                8
            };
            pack.format_version = pack.format_version.max(required_version);
        }
        tx.execute(
            "UPDATE character_packs SET data=?1 WHERE id=?2",
            params![
                serde_json::to_string(&pack).map_err(|e| e.to_string())?,
                pack_id
            ],
        )
        .map_err(|e| e.to_string())?;
        get_pack_story_definition(tx, pack_id)
    })
}
pub(super) fn validate_profile(
    db: &Connection,
    id: &str,
    definition: &CharacterDefinition,
) -> Result<()> {
    if active_ids(db)?.contains(&id.to_string())
        && definition.presence_role == crate::pack_stories::PresenceRole::Npc
    {
        return Err(
            "상주 목록에서 뺀 뒤 NPC 역할로 바꿔 주세요. 최소 한 명의 상주 인물이 필요해요.".into(),
        );
    }
    let old = get(db, id)?;
    if let Some(pack_id) = old.pack_id {
        let (pack, members) = pack_record(db, &pack_id)?;
        let definitions = members
            .iter()
            .zip(&pack.characters)
            .map(|(member, record)| {
                if member == id {
                    definition.clone()
                } else {
                    get(db, member)
                        .map(|item| item.definition)
                        .unwrap_or_else(|_| record.clone())
                }
            })
            .collect::<Vec<_>>();
        crate::pack_stories::validate_pack(&definitions, &pack.story_definition())?;
    }
    Ok(())
}

pub(super) fn export_extras(
    db: &Connection,
    installed: &[InstalledCharacter],
    sources: &[String],
    out: &mut CharacterPack,
    include_shared_definitions: bool,
) -> Result<()> {
    let selected: BTreeMap<_, _> = installed
        .iter()
        .zip(sources)
        .map(|(item, source)| (item.id.as_str(), source.clone()))
        .collect();
    let mut seen = BTreeSet::new();
    for actor in installed {
        let Some(pack_id) = actor.pack_id.as_ref() else {
            continue;
        };
        if !seen.insert(pack_id) {
            continue;
        }
        let (original, members) = pack_record(db, pack_id)?;
        let mut extras = original.story_definition();
        if !include_shared_definitions {
            let required = actor
                .definition
                .npc
                .as_ref()
                .map(|npc| npc.required_flags.as_slice())
                .unwrap_or_default();
            out.story_flags.extend(
                extras
                    .story_flags
                    .into_iter()
                    .filter(|flag| required.contains(&flag.id)),
            );
            continue;
        }
        if extras.is_empty() {
            continue;
        }
        let mapping: BTreeMap<_, _> = original
            .characters
            .iter()
            .zip(&members)
            .filter_map(|(definition, local)| {
                selected
                    .get(local.as_str())
                    .map(|source| (definition.source_id.clone(), source.clone()))
            })
            .collect();
        let remap = |source: &mut String| -> Result<()> {
            *source = mapping
                .get(source)
                .cloned()
                .ok_or("이야기·지식의 참가자를 함께 선택해 내보내 주세요.")?;
            Ok(())
        };
        for item in &mut extras.knowledge {
            for source in &mut item.known_by {
                remap(source)?;
            }
        }
        for scenario in &mut extras.scenarios {
            remap(&mut scenario.center_id)?;
            for source in &mut scenario.participants {
                remap(source)?;
            }
            for line in scenario
                .intro
                .iter_mut()
                .chain(&mut scenario.accept)
                .chain(&mut scenario.decline)
                .chain(&mut scenario.defer)
                .chain(&mut scenario.ending)
            {
                remap(&mut line.persona)?;
            }
        }
        // Single-pack exports retain authored IDs. Cross-pack collisions are explicit errors.
        if extras.story_flags.iter().any(|flag| {
            out.story_flags
                .iter()
                .any(|existing| existing.id == flag.id && existing != flag)
        }) || extras
            .knowledge
            .iter()
            .any(|item| out.knowledge.iter().any(|existing| existing.id == item.id))
            || extras
                .scenarios
                .iter()
                .any(|item| out.scenarios.iter().any(|existing| existing.id == item.id))
        {
            return Err("작성 정보 ID가 겹치는 팩은 각각 내보내 주세요.".into());
        }
        if !extras.world_rules.is_empty() {
            if !out.world_rules.is_empty() {
                out.world_rules.push('\n');
            }
            out.world_rules.push_str(&extras.world_rules);
        }
        for flag in extras.story_flags {
            if !out.story_flags.contains(&flag) {
                out.story_flags.push(flag);
            }
        }
        out.knowledge.extend(extras.knowledge);
        out.scenarios.extend(extras.scenarios);
    }
    Ok(())
}
