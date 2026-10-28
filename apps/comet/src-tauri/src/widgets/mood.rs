use crate::{
    app::{lock, AppState},
    characters,
};
use rusqlite::Connection;
use tauri::AppHandle;

pub(crate) fn latest_event(db: &Connection) -> Result<i64, String> {
    db.query_row(
        "SELECT COALESCE(MAX(seq), 0) FROM widget_events",
        [],
        |row| row.get(0),
    )
    .map_err(|error| error.to_string())
}

pub(crate) fn advance(app: &AppHandle, state: &AppState, cursor: &mut i64) -> Result<(), String> {
    let _action = lock(&state.action)?;
    let db = lock(&state.db)?;
    let mut statement = db
        .prepare("SELECT seq, data FROM widget_events WHERE seq > ?1 ORDER BY seq")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([*cursor], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| error.to_string())?;
    for row in rows {
        let (seq, data) = row.map_err(|error| error.to_string())?;
        let Ok(event) = serde_json::from_str::<super::WidgetEvent>(&data) else {
            *cursor = seq;
            continue;
        };
        let source = match (event.widget_kind.as_str(), event.event.kind.as_str()) {
            ("todo", "todo-completed") => Some("todo"),
            ("focus-timer", "timer-finished") if event.event.payload["mode"] == "focus" => {
                Some("focus")
            }
            ("small-match", "small-match.result") => Some("play"),
            ("guessing", "guessing.attempt")
                if matches!(
                    event.event.payload["outcome"].as_str(),
                    Some("correct" | "exhausted")
                ) =>
            {
                Some("play")
            }
            ("fishing", "fishing.missed" | "item-acquired") => Some("play"),
            _ => None,
        };
        if let Some(source) = source {
            let members = characters::active_members(&db)?;
            let targets: Vec<String> = if source != "play" {
                members.into_iter().map(|member| member.id).collect()
            } else if event.widget_kind == "small-match" {
                if let Some(owner) = event.event.payload["owner"].as_str() {
                    members
                        .into_iter()
                        .filter(|member| member.id == owner)
                        .map(|member| member.id)
                        .collect()
                } else {
                    characters::reaction_host::widget_character(&db, &event)?
                        .or_else(|| members.first().map(|member| member.id.clone()))
                        .into_iter()
                        .collect()
                }
            } else {
                members
                    .into_iter()
                    .take(1)
                    .map(|member| member.id)
                    .collect()
            };
            for id in targets {
                characters::life::change_mood(app, state, &id, source, 1)?;
            }
        }
        *cursor = seq;
    }
    Ok(())
}

// Called under the action lock before the transaction. The caller applies the mood
// only after successful execution, and an existing receipt must never apply it again.
pub(crate) fn pending_interaction_target(
    db: &Connection,
    request: &super::WidgetRequest,
) -> Result<Option<(String, String)>, String> {
    if !matches!(request.action.as_str(), "stroke" | "snack")
        || super::storage::get(db, &request.instance_id)?.kind != "interaction"
    {
        return Ok(None);
    }
    let already_applied: bool = db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM widget_requests WHERE id=?1)",
            [&request.request_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if already_applied {
        return Ok(None);
    }
    let slot = request.input["character"]
        .as_str()
        .ok_or("캐릭터를 골라 주세요.")?;
    let character = characters::active_character(db, &slot.to_ascii_lowercase())?;
    Ok(Some((character.id, request.action.clone())))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::widgets::{storage, WidgetRequest};
    use serde_json::json;

    #[test]
    fn interaction_target_is_recorded_once_and_rejected_actions_do_not_commit() {
        let db = crate::store::open(std::path::Path::new(":memory:")).unwrap();
        let actor = characters::active_character(&db, "a").unwrap();
        let interaction = storage::instances(&db)
            .unwrap()
            .into_iter()
            .find(|widget| widget.kind == "interaction")
            .unwrap();
        let id = interaction.id;
        let request = WidgetRequest {
            request_id: uuid::Uuid::new_v4().to_string(),
            instance_id: id.clone(),
            expected_revision: interaction.revision,
            action: "stroke".into(),
            input: json!({"character":"A","owner":actor.id.clone()}),
        };
        assert_eq!(pending_interaction_target(&db, &request).unwrap(), Some((actor.id.clone(), "stroke".into())));
        storage::execute(&db, &request, 1_000, 0).unwrap();
        assert!(pending_interaction_target(&db, &request).unwrap().is_none());
        let bad = WidgetRequest {
            request_id: uuid::Uuid::new_v4().to_string(),
            expected_revision: interaction.revision + 1,
            action: "snack".into(),
            ..request
        };
        db.execute("UPDATE widget_instances SET data=json_set(data,'$.snacks',0) WHERE id=?1", [&id]).unwrap();
        assert!(storage::execute(&db, &bad, 2_000, 0).is_err());
        assert!(pending_interaction_target(&db, &bad).unwrap().is_some());
    }
}
