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

pub(crate) fn interaction_target(
    db: &Connection,
    event: &super::WidgetEvent,
) -> Result<Option<(String, String)>, String> {
    if event.widget_kind != "interaction" || event.event.kind != "interaction.touch" {
        return Ok(None);
    }
    let Some(action @ ("stroke" | "snack")) = event.event.payload["action"].as_str() else {
        return Ok(None);
    };
    let members = characters::active_members(db)?;
    let target = if let Some(owner) = event.event.payload["owner"].as_str() {
        members.iter().find(|member| member.id == owner)
    } else {
        event.event.payload["character"]
            .as_str()
            .and_then(|slot| characters::slot_index(&slot.to_ascii_lowercase()).ok())
            .and_then(|index| members.get(index))
    };
    Ok(target.map(|member| (member.id.clone(), action.into())))
}
