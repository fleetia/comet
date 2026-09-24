use super::{lock, AppState};
use crate::{characters, store, types::Message};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::{collections::BTreeMap, sync::Arc};

const HISTORY: &str = "WITH history AS (
    SELECT m.id,m.data,'live' AS kind,u.user_id,json_extract(m.data,'$.createdAt') AS at
    FROM messages m LEFT JOIN message_users u ON u.message_id=m.id
    WHERE EXISTS(SELECT 1 FROM message_characters c WHERE c.message_id=m.id AND c.character_id=?1)
    UNION ALL
    SELECT a.id,a.data,'archive',a.user_id,json_extract(a.data,'$.createdAt')
    FROM character_archived_messages a
    WHERE EXISTS(SELECT 1 FROM json_each(a.data,'$.characters') WHERE json_extract(value,'$.sourceId')=?1)
)";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoryPage {
    items: Vec<Message>,
    user_names: BTreeMap<String, String>,
    character_names: BTreeMap<String, String>,
    total: usize,
    offset: usize,
    next_offset: Option<usize>,
}

fn history_page(
    db: &Connection,
    character_id: &str,
    offset: usize,
    limit: usize,
) -> Result<HistoryPage, String> {
    characters::get(db, character_id)?;
    let total: usize = db
        .query_row(
            &format!("{HISTORY} SELECT COUNT(*) FROM history"),
            [character_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    let offset = offset.min(total);
    let mut statement = db.prepare(&format!("{HISTORY} SELECT data,kind,user_id FROM history ORDER BY at DESC,id DESC LIMIT ?2 OFFSET ?3")).map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(
            params![character_id, limit.clamp(1, 50) as i64, offset as i64],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )
        .map_err(|error| error.to_string())?;
    let mut items = Vec::new();
    let mut user_names = BTreeMap::new();
    let mut character_names = BTreeMap::new();
    for row in rows {
        let (data, kind, user_id) = row.map_err(|error| error.to_string())?;
        let message: Message = if kind == "archive" {
            let archived: characters::archive::ArchiveMessage =
                serde_json::from_str(&data).map_err(|error| error.to_string())?;
            if let Some(identity) = archived
                .characters
                .iter()
                .find(|identity| identity.source_id == character_id)
            {
                character_names.insert(archived.id.clone(), identity.name.clone());
            }
            Message {
                id: archived.id,
                role: archived.role,
                persona: Some(character_id.to_string()),
                content: archived.content,
                expression: archived.expression,
                created_at: archived.created_at,
                status: archived.status,
            }
        } else {
            let message: Message =
                serde_json::from_str(&data).map_err(|error| error.to_string())?;
            let name: String = db.query_row("SELECT name FROM message_characters WHERE message_id=?1 AND character_id=?2 LIMIT 1", params![message.id, character_id], |row| row.get(0)).map_err(|error| error.to_string())?;
            character_names.insert(message.id.clone(), name);
            message
        };
        if let Some(user) = user_id
            .and_then(|id| store::user_identity(db, &id).transpose())
            .transpose()?
        {
            user_names.insert(message.id.clone(), user.name);
        }
        items.push(message);
    }
    let end = offset + items.len();
    items.reverse();
    Ok(HistoryPage {
        items,
        user_names,
        character_names,
        total,
        offset,
        next_offset: (end < total).then_some(end),
    })
}

#[tauri::command]
pub(crate) fn list_character_history(
    state: tauri::State<'_, Arc<AppState>>,
    character_id: String,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<HistoryPage, String> {
    history_page(
        &*lock(&state.db)?,
        &character_id,
        offset.unwrap_or(0),
        limit.unwrap_or(50),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn history_is_character_scoped_paginated_and_keeps_the_original_user_name() {
        let db = store::open(std::path::Path::new(":memory:")).unwrap();
        store::set_user_name(&db, "민수", 1).unwrap();
        for (id, persona, at) in [("one", "a", 2), ("other", "b", 3), ("two", "a", 4)] {
            store::insert_message(
                &db,
                &Message {
                    id: id.into(),
                    role: "user".into(),
                    persona: Some(persona.into()),
                    content: "기록 원문".into(),
                    expression: None,
                    created_at: at,
                    status: "complete".into(),
                },
            )
            .unwrap();
        }
        store::set_user_name(&db, "지연", 5).unwrap();
        let id = characters::active_character(&db, "a").unwrap().id;
        let first = history_page(&db, &id, 0, 1).unwrap();
        assert_eq!(first.total, 2);
        assert_eq!(first.items[0].id, "two");
        assert_eq!(first.user_names["two"], "민수");
        assert_eq!(
            first.character_names["two"],
            characters::active_character(&db, "a")
                .unwrap()
                .definition
                .name
        );
        let next = history_page(&db, &id, first.next_offset.unwrap(), 1).unwrap();
        assert_eq!(next.items[0].id, "one");
        assert!(next.next_offset.is_none());
    }
}
