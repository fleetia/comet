use super::{err, get, put, Result};
use crate::types::{QuietHours, Settings};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

pub(super) fn migrate(db: &Connection) -> Result<()> {
    let legacy: Option<(String, String, bool)> = db
        .query_row(
            "SELECT id,data,installed=1 AND enabled=1 FROM widget_instances WHERE kind='calendar'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(err)?;
    let Some((id, raw, active)) = legacy else {
        return Ok(());
    };
    let mut data: Value = serde_json::from_str(&raw).map_err(err)?;
    let legacy_schedule = data["reminders"].as_object().is_some_and(|settings| {
        settings.contains_key("quietStart") || settings.contains_key("quietEnd")
    });
    let legacy_mute = data["alertState"]
        .as_object()
        .is_some_and(|state| state.contains_key("mutedUntil"));
    if !legacy_schedule && !legacy_mute {
        return Ok(());
    }
    let tx = db.unchecked_transaction().map_err(err)?;
    // Defaults would conceal the distinction between an absent schedule and an explicit OFF.
    let saved = get::<Value>(&tx, "settings")?;
    let saved_has_schedule = saved
        .as_ref()
        .is_some_and(|value| value.get("quietHours").is_some());
    let mut settings = saved.unwrap_or(serde_json::to_value(Settings::default()).map_err(err)?);
    if legacy_schedule && !saved_has_schedule {
        let reminders = &data["reminders"];
        let start = reminders["quietStart"].as_str().unwrap_or("22:00");
        let end = reminders["quietEnd"].as_str().unwrap_or("08:00");
        let character_enabled = reminders["characterEnabled"] != false;
        let reminders_enabled =
            reminders["enabled"] == true && (character_enabled || reminders["osEnabled"] == true);
        let moods_enabled = character_enabled
            && ["moodDayStart", "moodFocusStart", "moodBreak", "moodDayEnd"]
                .iter()
                .any(|key| reminders[*key] == true);
        let mut schedule = QuietHours {
            enabled: true,
            start: start.into(),
            end: end.into(),
            ..QuietHours::default()
        };
        if start == end
            && chrono::NaiveTime::parse_from_str(start, "%H:%M")
                .is_ok_and(|time| time.format("%H:%M").to_string() == start)
        {
            schedule.enabled = false;
        } else if schedule.validate().is_ok() {
            schedule.enabled = active && (reminders_enabled || moods_enabled);
        } else {
            // Invalid legacy values must not enable a broken schedule or prevent startup.
            schedule = QuietHours::default();
        }
        settings["quietHours"] = serde_json::to_value(schedule).map_err(err)?;
        put(&tx, "settings", &settings)?;
    }
    if let Some(reminders) = data["reminders"].as_object_mut() {
        reminders.remove("quietStart");
        reminders.remove("quietEnd");
    }
    if let Some(state) = data["alertState"].as_object_mut() {
        state.remove("mutedUntil");
    }
    tx.execute(
        "UPDATE widget_instances SET data=?1 WHERE id=?2",
        params![serde_json::to_string(&data).map_err(err)?, id],
    )
    .map_err(err)?;
    tx.commit().map_err(err)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{store, widgets::storage};
    use serde_json::json;

    #[test]
    fn reopening_migrates_legacy_silence_once_and_preserves_calendar_and_reminder_data() {
        for (global, enabled, legacy_end, channels) in [
            (None, true, "07:00", true),
            (None, false, "07:00", true),
            (None, true, "07:00", false),
            (None, true, "23:00", true),
            (None, true, "24:00", true),
            (Some(false), true, "07:00", true),
            (Some(true), true, "07:00", true),
        ] {
            let directory = tempfile::tempdir().unwrap();
            let path = directory.path().join("session.sqlite");
            let db = store::open(&path).unwrap();
            storage::install(&db, directory.path(), &["calendar".into(), "todo".into()]).unwrap();
            let calendar = storage::instances(&db)
                .unwrap()
                .into_iter()
                .find(|item| item.kind == "calendar")
                .unwrap();
            let mut data = calendar.data.clone();
            data["events"] = json!([{"id":"old","title":"  원문\n일정  "}]);
            data["connections"] = json!([{"id":"google","status":"offline"}]);
            data["reminders"]["enabled"] = json!(enabled);
            data["reminders"]["characterEnabled"] = json!(channels);
            data["reminders"]["osEnabled"] = json!(channels);
            data["reminders"]["quietStart"] = json!("23:00");
            data["reminders"]["quietEnd"] = json!(legacy_end);
            data["alertState"] = json!({"mutedUntil":i64::MAX,"snoozeAt":123,"lastNotification":{"text":"원문 알림","targets":[{"id":"old"}]}});
            storage::commit_data(
                &db,
                &calendar.id,
                calendar.revision,
                data.clone(),
                vec![],
                1,
            )
            .unwrap();
            let mut saved = serde_json::to_value(Settings::default()).unwrap();
            let expected = global.map(|enabled| QuietHours {
                enabled,
                start: "09:00".into(),
                end: "11:00".into(),
                weekdays: vec![2],
            });
            if let Some(schedule) = &expected {
                saved["quietHours"] = serde_json::to_value(schedule).unwrap();
            } else {
                saved.as_object_mut().unwrap().remove("quietHours");
            }
            put(&db, "settings", &saved).unwrap();
            let before = storage::instances(&db).unwrap();
            drop(db);
            let db = store::open(&path).unwrap();
            let migrated = store::settings(&db).unwrap().quiet_hours;
            match expected {
                Some(expected) => assert_eq!(migrated, expected),
                None if legacy_end == "24:00" => assert_eq!(migrated, QuietHours::default()),
                None => assert_eq!(
                    migrated,
                    QuietHours {
                        enabled: enabled && channels && legacy_end != "23:00",
                        start: "23:00".into(),
                        end: legacy_end.into(),
                        ..QuietHours::default()
                    }
                ),
            }
            data["reminders"]
                .as_object_mut()
                .unwrap()
                .remove("quietStart");
            data["reminders"]
                .as_object_mut()
                .unwrap()
                .remove("quietEnd");
            data["alertState"]
                .as_object_mut()
                .unwrap()
                .remove("mutedUntil");
            let after = storage::instances(&db).unwrap();
            assert_eq!(storage::get(&db, &calendar.id).unwrap().data, data);
            assert_eq!(
                before.iter().map(|item| item.revision).collect::<Vec<_>>(),
                after.iter().map(|item| item.revision).collect::<Vec<_>>()
            );
            assert_eq!(
                before.iter().find(|item| item.kind == "todo").unwrap().data,
                after.iter().find(|item| item.kind == "todo").unwrap().data
            );
            let mut changed = store::settings(&db).unwrap();
            changed.quiet_hours = QuietHours::default();
            store::save_settings(&db, &changed).unwrap();
            drop(db);
            let reopened = store::open(&path).unwrap();
            assert_eq!(
                store::settings(&reopened).unwrap().quiet_hours,
                QuietHours::default()
            );
            assert_eq!(storage::get(&reopened, &calendar.id).unwrap().data, data);
        }
    }

    #[test]
    fn fresh_profiles_stay_unrestricted_and_legacy_moods_import_without_global_settings() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("session.sqlite");
        let db = store::open(&path).unwrap();
        assert_eq!(
            store::settings(&db).unwrap().quiet_hours,
            QuietHours::default()
        );
        storage::install(&db, directory.path(), &["calendar".into()]).unwrap();
        let mut calendar = storage::instances(&db).unwrap().remove(0);
        calendar.data["reminders"]["moodDayStart"] = json!(true);
        calendar.data["reminders"]["quietStart"] = json!("21:00");
        calendar.data["reminders"]["quietEnd"] = json!("06:00");
        storage::commit_data(
            &db,
            &calendar.id,
            calendar.revision,
            calendar.data,
            vec![],
            1,
        )
        .unwrap();
        assert!(get::<Value>(&db, "settings").unwrap().is_none());
        drop(db);
        let reopened = store::open(&path).unwrap();
        assert_eq!(
            store::settings(&reopened).unwrap().quiet_hours,
            QuietHours {
                enabled: true,
                start: "21:00".into(),
                end: "06:00".into(),
                ..QuietHours::default()
            }
        );
    }
}
