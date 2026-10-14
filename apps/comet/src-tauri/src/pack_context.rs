use crate::{
    app::AppState,
    character_guests, characters, pack_stories, store,
    types::{ChatMessage, Message},
};
use rusqlite::Connection;
use serde_json::json;
use std::collections::BTreeSet;

pub(crate) struct TurnContext {
    pub history_allowlist: Option<BTreeSet<String>>,
    pub allow_memories: bool,
    pub extra_messages: Vec<ChatMessage>,
    pub selected_knowledge_ids: Vec<String>,
}

#[cfg(test)]
mod model_quality;

fn permitted<'a>(
    definition: &'a pack_stories::PackStoryDefinition,
    query: &str,
    sources: &BTreeSet<String>,
    progress: &BTreeSet<String>,
) -> Vec<&'a pack_stories::ConditionalKnowledge> {
    let public = definition
        .story_flags
        .iter()
        .filter(|flag| flag.public)
        .map(|flag| &flag.id)
        .collect::<BTreeSet<_>>();
    let query = query.to_lowercase();
    definition
        .knowledge
        .iter()
        .filter(|item| {
            sources.iter().all(|source| item.known_by.contains(source))
                && item
                    .required_flags
                    .iter()
                    .all(|flag| progress.contains(flag) && public.contains(flag))
                && item
                    .keywords
                    .iter()
                    .any(|keyword| query.contains(&keyword.to_lowercase()))
        })
        .collect()
}

fn extras(
    definition: &pack_stories::PackStoryDefinition,
    query: &str,
    sources: &BTreeSet<String>,
    progress: &BTreeSet<String>,
    budget: usize,
) -> Result<(Vec<ChatMessage>, Vec<String>), String> {
    let eligible = permitted(definition, query, sources, progress);
    let mut messages = Vec::new();
    let mut ids = Vec::new();
    let mut used = 2;
    let mut add = |value: serde_json::Value| -> Result<bool, String> {
        let message = ChatMessage {
            role: "user".into(),
            content: value.to_string(),
        };
        let bytes = serde_json::to_vec(&message)
            .map_err(|error| error.to_string())?
            .len()
            + usize::from(!messages.is_empty());
        if bytes > budget.saturating_sub(used) {
            return Ok(false);
        }
        used += bytes;
        messages.push(message);
        Ok(true)
    };
    if !definition.world_rules.is_empty() {
        add(json!({"packWorldRules": definition.world_rules}))?;
    }
    for item in eligible {
        if add(json!({"permittedPackKnowledge":{"id":item.id,"text":item.text}}))? {
            ids.push(item.id.clone());
        }
    }
    Ok((messages, ids))
}

pub(crate) fn for_turn(
    state: &AppState,
    db: &Connection,
    targets: &[String],
    input_id: &str,
    extra_budget_bytes: usize,
) -> Result<TurnContext, String> {
    if targets.is_empty()
        || targets.len() > characters::MAX_ROSTER
        || targets.iter().collect::<BTreeSet<_>>().len() != targets.len()
        || store::message_user_id(db, input_id)? != store::active_user_id(db)?
    {
        return Err("현재 대화의 참가자와 입력을 확인해 주세요.".into());
    }
    let input: String = db
        .query_row("SELECT data FROM messages WHERE id=?1", [input_id], |row| {
            row.get(0)
        })
        .map_err(|error| error.to_string())?;
    let input: Message = serde_json::from_str(&input).map_err(|error| error.to_string())?;
    if input.role != "user" {
        return Err("현재 사용자 입력을 확인해 주세요.".into());
    }
    let history_allowlist = character_guests::heard_context(state, db, targets)?;
    if history_allowlist
        .as_ref()
        .is_some_and(|heard| !heard.contains(input_id))
    {
        return Err("NPC가 아직 이 입력을 듣지 못했어요.".into());
    }
    let mut context = TurnContext {
        allow_memories: history_allowlist.is_none(),
        history_allowlist,
        extra_messages: vec![],
        selected_knowledge_ids: vec![],
    };
    let actors = targets
        .iter()
        .map(|id| character_guests::actor(state, db, id))
        .collect::<Result<Vec<_>, _>>()?;
    let Some(pack_id) = actors[0].pack_id.as_ref() else {
        return Ok(context);
    };
    // A single model request is shared by its cast: only facts known by the whole
    // cast are admitted. Mixing packs does not grant access to another pack's lore.
    if actors
        .iter()
        .any(|actor| actor.pack_id.as_ref() != Some(pack_id))
    {
        return Ok(context);
    }
    let mut guest_center: Option<String> = None;
    for target in targets {
        if let Some(scope) = character_guests::speaker_scope(state, db, target)? {
            if scope.pack_id != *pack_id
                || guest_center
                    .as_ref()
                    .is_some_and(|center| *center != scope.center_id)
            {
                return Err("서로 다른 NPC 장면의 정보를 합칠 수 없어요.".into());
            }
            guest_center = Some(scope.center_id);
        }
    }
    let snapshot = characters::get_pack_story_definition(db, pack_id)?;
    let scope = pack_stories::Scope {
        user_id: store::active_user_id(db)?,
        pack_id: pack_id.clone(),
        center_id: guest_center.unwrap_or_else(|| targets[0].clone()),
    };
    let flags = pack_stories::progress_flags(db, &scope)?;
    let sources = actors
        .iter()
        .map(|actor| actor.definition.source_id.clone())
        .collect();
    (context.extra_messages, context.selected_knowledge_ids) = extras(
        &snapshot.definition,
        &input.content,
        &sources,
        &flags,
        extra_budget_bytes,
    )?;
    Ok(context)
}

#[cfg(test)]
mod tests {
    use super::*;
    use pack_stories::{ConditionalKnowledge, PackStoryDefinition, StoryFlag};
    fn knowledge(id: &str, flags: &[&str], owners: &[&str], text: &str) -> ConditionalKnowledge {
        ConditionalKnowledge {
            id: id.into(),
            keywords: vec!["별".into()],
            text: text.into(),
            known_by: owners.iter().map(|value| (*value).into()).collect(),
            required_flags: flags.iter().map(|value| (*value).into()).collect(),
        }
    }
    #[test]
    fn authorization_precedes_budget_and_shared_cast_requires_every_speaker() {
        let definition = PackStoryDefinition {
            world_rules: String::new(),
            story_flags: vec![
                StoryFlag {
                    id: "public".into(),
                    public: true,
                },
                StoryFlag {
                    id: "secret".into(),
                    public: false,
                },
            ],
            knowledge: vec![
                knowledge("huge-private", &[], &["a"], &"비공개".repeat(200)),
                knowledge("private-flag", &["secret"], &["a", "b"], "감춰진 조건"),
                knowledge("locked", &["public"], &["a", "b"], "아직 모르는 사실"),
                knowledge("shared", &[], &["a", "b"], "둘이 아는 별 이야기"),
            ],
            scenarios: vec![],
        };
        let cast = BTreeSet::from(["a".into(), "b".into()]);
        let flags = BTreeSet::from(["secret".into()]);
        let (messages, ids) = extras(&definition, "별 얘기", &cast, &flags, 512).unwrap();
        assert_eq!(ids, ["shared"]);
        assert_eq!(messages.len(), 1);
        let text = serde_json::to_string(&messages).unwrap();
        assert!(!text.contains("비공개"));
        assert!(!text.contains("감춰진"));
        assert!(!text.contains("아직 모르는"));
        let flags = BTreeSet::from(["public".into(), "secret".into()]);
        assert_eq!(
            permitted(&definition, "별", &cast, &flags)
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            ["locked", "shared"]
        );
        assert!(permitted(&definition, "다른 화제", &cast, &flags).is_empty());
    }
    #[test]
    fn whole_entries_keep_authored_text_and_json_escaped_bytes_fit_the_budget() {
        let definition = PackStoryDefinition {
            knowledge: vec![
                knowledge("first", &[], &["a"], "  별\\\"\n원문  "),
                knowledge("second", &[], &["a"], "다음"),
            ],
            ..Default::default()
        };
        let cast = BTreeSet::from(["a".into()]);
        let flags = BTreeSet::new();
        let (messages, ids) = extras(&definition, "별", &cast, &flags, 4096).unwrap();
        assert_eq!(ids, ["first", "second"]);
        let first: serde_json::Value = serde_json::from_str(&messages[0].content).unwrap();
        assert_eq!(
            first["permittedPackKnowledge"]["text"],
            definition.knowledge[0].text
        );
        let bytes = serde_json::to_vec(&messages[0]).unwrap().len() + 2;
        let (limited, ids) = extras(&definition, "별", &cast, &flags, bytes).unwrap();
        assert_eq!(limited.len(), 1);
        assert_eq!(ids, ["first"]);
        assert!(serde_json::to_vec(&limited).unwrap().len() <= bytes);
        assert!(extras(&definition, "별", &cast, &flags, 0)
            .unwrap()
            .0
            .is_empty());
    }
    #[test]
    fn guest_context_requires_actual_hearing_excludes_memory_and_expires_with_definition() {
        use crate::app::lock;
        let state = crate::app::tests::state();
        let db = lock(&state.db).unwrap();
        store::set_user_name(&db, "합성 사용자", chrono::Utc::now().timestamp_millis()).unwrap();
        let mut pack = characters::factory_pack();
        pack.format_version = 8;
        pack.pair_scenes.clear();
        pack.wordbook.clear();
        pack.characters[1].presence_role = pack_stories::PresenceRole::Npc;
        let sources = pack
            .characters
            .iter()
            .map(|actor| actor.source_id.clone())
            .collect::<Vec<_>>();
        pack.knowledge = vec![knowledge(
            "shared",
            &[],
            &[&sources[0], &sources[1]],
            "둘이 아는 별의 이름",
        )];
        let installed = characters::import_pack(&db, &pack).unwrap();
        let center = installed[0].id.clone();
        let guest = installed[1].id.clone();
        characters::apply_roster(&db, vec![center.clone()]).unwrap();
        let input = Message {
            id: uuid::Uuid::new_v4().to_string(),
            role: "user".into(),
            persona: Some(center.clone()),
            content: "별 얘기".into(),
            expression: None,
            created_at: chrono::Utc::now().timestamp_millis(),
            status: "complete".into(),
        };
        store::insert_user_input(&db, &input, false).unwrap();
        let pack_id = installed[0].pack_id.clone().unwrap();
        character_guests::admit_locked(
            &state,
            &db,
            &character_guests::Admission {
                run_id: "synthetic-run".into(),
                request_id: input.id.clone(),
                epoch: 0,
                center_id: center.clone(),
                guest_ids: vec![guest.clone()],
                pack_baseline: characters::pack_definition_baseline(&db, &pack_id).unwrap(),
                pack_id,
            },
        )
        .unwrap();
        let cast = [center.clone(), guest.clone()];
        assert!(for_turn(&state, &db, &cast, &input.id, 1000).is_err());
        let ticket = character_guests::capture(&state, &db, &cast, 0).unwrap();
        character_guests::hear_locked(&state, &db, &ticket, &input.id).unwrap();
        let context = for_turn(&state, &db, &cast, &input.id, 1000).unwrap();
        assert!(!context.allow_memories);
        assert_eq!(
            context.history_allowlist.unwrap(),
            BTreeSet::from([input.id.clone()])
        );
        assert_eq!(context.selected_knowledge_ids, ["shared"]);
        assert!(
            for_turn(&state, &db, &[center], &input.id, 1000)
                .unwrap()
                .allow_memories
        );
        let mut changed = characters::get(&db, &guest).unwrap().definition;
        changed.name.push('!');
        characters::save(&db, &guest, &changed).unwrap();
        assert!(for_turn(&state, &db, &cast, &input.id, 1000).is_err());
    }
}
