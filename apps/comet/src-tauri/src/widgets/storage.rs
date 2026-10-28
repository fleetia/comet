use super::{EventDraft, WidgetEffect, WidgetEvent, WidgetInstance, WidgetRequest, WidgetSnapshot};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, path::Path};

type Result<T> = std::result::Result<T, String>;
fn err(error: impl std::fmt::Display) -> String {
    error.to_string()
}

pub fn initialize(db: &Connection) -> Result<()> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS widget_instances(
id TEXT PRIMARY KEY,kind TEXT UNIQUE NOT NULL,version INTEGER NOT NULL,
installed INTEGER NOT NULL,enabled INTEGER NOT NULL,revision INTEGER NOT NULL,
data TEXT NOT NULL,error TEXT);
CREATE TABLE IF NOT EXISTS widget_requests(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS widget_request_results(request_id TEXT PRIMARY KEY,created_id TEXT);
CREATE TABLE IF NOT EXISTS widget_events(seq INTEGER PRIMARY KEY AUTOINCREMENT,
id TEXT UNIQUE NOT NULL,instance_id TEXT NOT NULL,data TEXT NOT NULL,pending INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS widget_journal(event_id TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS widget_preferences(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS desktop_toy_results(id TEXT PRIMARY KEY,widget_id TEXT NOT NULL,kind TEXT NOT NULL,created_at INTEGER NOT NULL,data TEXT NOT NULL);",
    )
    .map_err(err)?;
    retire_removed_widgets(db)?;
    let tx = db.unchecked_transaction().map_err(err)?;
    for manifest in super::catalog()? {
        let existing = tx
            .query_row(
                "SELECT id,installed,enabled FROM widget_instances WHERE kind=?1",
                [&manifest.id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, bool>(1)?,
                        row.get::<_, bool>(2)?,
                    ))
                },
            )
            .optional()
            .map_err(err)?;
        if let Some((id, installed, enabled)) = existing {
            if !installed {
                tx.execute(
                    "INSERT OR IGNORE INTO widget_preferences(key,value) VALUES(?1,'1')",
                    [format!("package-init:{id}")],
                )
                .map_err(err)?;
            }
            if !installed || !enabled {
                tx.execute(
                    "INSERT OR REPLACE INTO widget_preferences(key,value) VALUES(?1,'1')",
                    [format!("widget-migrated:{id}")],
                )
                .map_err(err)?;
            }
            if !enabled {
                tx.execute(
                    "INSERT OR IGNORE INTO widget_preferences(key,value) VALUES(?1,'0')",
                    [format!("reaction:{id}")],
                )
                .map_err(err)?;
            }
            if manifest.id == "plant" && !enabled {
                tx.execute(
                    "UPDATE widget_instances SET data=json_set(data,'$.updatedAt',?1) WHERE id=?2",
                    params![chrono::Utc::now().timestamp_millis(), id],
                )
                .map_err(err)?;
            }
            tx.execute(
                "UPDATE widget_instances SET installed=1,enabled=1 WHERE id=?1",
                [id],
            )
            .map_err(err)?;
        } else {
            let id = uuid::Uuid::new_v4().to_string();
            tx.execute(
                "INSERT INTO widget_instances VALUES(?1,?2,?3,1,1,0,?4,NULL)",
                params![
                    id,
                    manifest.id,
                    manifest.version,
                    serde_json::to_string(&super::initial(&manifest.id)?).map_err(err)?
                ],
            )
            .map_err(err)?;
            tx.execute(
                "INSERT INTO widget_preferences(key,value) VALUES(?1,'1')",
                [format!("package-init:{id}")],
            )
            .map_err(err)?;
            tx.execute(
                "INSERT INTO widget_preferences(key,value) VALUES(?1,'1')",
                [format!("widget-migrated:{id}")],
            )
            .map_err(err)?;
        }
    }
    tx.commit().map_err(err)?;
    super::backgrounds::initialize(db)
}

fn retire_removed_widgets(db: &Connection) -> Result<()> {
    let tx = db.unchecked_transaction().map_err(err)?;
    for kind in super::RETIRED_KINDS {
        tx.execute(
            "UPDATE widget_instances SET installed=0,enabled=0,revision=revision+1,error=NULL WHERE kind=?1 AND (installed=1 OR enabled=1)",
            [kind],
        ).map_err(err)?;
        tx.execute(
            "UPDATE widget_events SET pending=0 WHERE instance_id IN (SELECT id FROM widget_instances WHERE kind=?1)",
            [kind],
        ).map_err(err)?;
    }
    tx.commit().map_err(err)
}

pub fn bump_revision(db: &Connection, id: &str, expected_revision: i64) -> Result<WidgetInstance> {
    let mut instance = get(db, id)?;
    if super::is_retired(&instance.kind) || instance.revision != expected_revision {
        return Err(
            "다른 화면에서 위젯이 변경됐어요. 최신 상태를 확인하고 다시 시도해 주세요.".into(),
        );
    }
    instance.revision += 1;
    put(db, &instance)?;
    Ok(instance)
}

pub fn instances(db: &Connection) -> Result<Vec<WidgetInstance>> {
    let mut statement = db
        .prepare("SELECT id,kind,version,revision,data,error FROM widget_instances ORDER BY rowid")
        .map_err(err)?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, u32>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, Option<String>>(5)?,
            ))
        })
        .map_err(err)?;
    rows.map(|row| {
        let (id, kind, version, revision, data, error) = row.map_err(err)?;
        Ok(WidgetInstance {
            id,
            kind,
            version,
            revision,
            data: serde_json::from_str(&data).map_err(err)?,
            error,
        })
    })
    .collect::<Result<Vec<_>>>()
    .map(|instances| {
        instances
            .into_iter()
            .filter(|instance| !super::is_retired(&instance.kind))
            .collect()
    })
}

pub fn get(db: &Connection, id: &str) -> Result<WidgetInstance> {
    instances(db)?
        .into_iter()
        .find(|instance| instance.id == id)
        .ok_or_else(|| "위젯을 찾지 못했어요.".into())
}

fn put(db: &Connection, instance: &WidgetInstance) -> Result<()> {
    db.execute(
        "INSERT INTO widget_instances VALUES(?1,?2,?3,1,1,?4,?5,?6)
ON CONFLICT(id) DO UPDATE SET version=excluded.version,installed=excluded.installed,
enabled=excluded.enabled,revision=excluded.revision,data=excluded.data,error=excluded.error",
        params![
            instance.id,
            instance.kind,
            instance.version,
            instance.revision,
            serde_json::to_string(&instance.data).map_err(err)?,
            instance.error
        ],
    )
    .map_err(err)?;
    Ok(())
}

pub fn snapshot(db: &Connection) -> Result<WidgetSnapshot> {
    let all = instances(db)?;
    Ok(WidgetSnapshot {
        catalog: super::catalog()?,
        widgets: all
            .iter()
            .filter(|instance| !super::is_retired(&instance.kind))
            .cloned()
            .map(|instance| {
                let background_updated_at = super::backgrounds::info(db, &instance.id)?
                    .map(|background| background.updated_at);
                let reaction = reaction_enabled(db, &instance.id)?;
                let mut view =
                    super::project_with_background(instance, &all, background_updated_at)?;
                view.reaction = reaction;
                Ok(view)
            })
            .collect::<Result<_>>()?,
        onboarding_done: db
            .query_row(
                "SELECT value FROM widget_preferences WHERE key='onboarding'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(err)?
            .as_deref()
            == Some("done"),
    })
}

fn package_path(directory: &Path, kind: &str) -> Result<std::path::PathBuf> {
    super::manifest(kind)?;
    let root = directory.join("widgets");
    if let Ok(metadata) = root.symlink_metadata() {
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err("위젯 설치 공간에 연결 파일을 사용할 수 없어요.".into());
        }
    }
    let path = root.join(kind);
    if let Ok(metadata) = path.symlink_metadata() {
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err("위젯 설치 폴더에 연결 파일이나 일반 파일을 사용할 수 없어요.".into());
        }
    }
    Ok(path)
}

fn write_package(path: &Path, kind: &str) -> Result<()> {
    std::fs::create_dir_all(path).map_err(err)?;
    if path
        .symlink_metadata()
        .map_err(err)?
        .file_type()
        .is_symlink()
    {
        return Err("위젯 설치 폴더에 연결 파일을 사용할 수 없어요.".into());
    }
    let content = serde_json::to_vec(&super::manifest(kind)?).map_err(err)?;
    let temporary = path.join(format!("{}.tmp", uuid::Uuid::new_v4()));
    use std::io::Write;
    let result = (|| {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(err)?;
        file.write_all(&content).map_err(err)?;
        file.sync_all().map_err(err)?;
        std::fs::rename(&temporary, path.join("manifest.json")).map_err(err)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result
}

fn suspend(instance: &mut WidgetInstance, now: i64, restarting: bool) -> Result<()> {
    match instance.kind.as_str() {
        "focus-timer" if instance.data["status"] == "running" => {
            instance.data = super::planning::suspend_timer(&instance.data, now, restarting)?;
        }
        "ball" | "paper-plane" => {
            instance.data["moving"] = json!(false);
            instance.data["flying"] = json!(false);
            instance.data["lastAt"] = json!(now);
        }
        "fishing" => {
            instance.data["phase"] = json!("idle");
        }
        "pet" => {
            instance.data["food"] = Value::Null;
            instance.data["lastAt"] = json!(now);
        }
        "plant" => {
            instance.data["updatedAt"] = json!(now);
        }
        _ => {}
    }
    Ok(())
}

pub fn verify_packages(db: &Connection, directory: &Path) -> Result<()> {
    retire_removed_widgets(db)?;
    for mut instance in instances(db)?
        .into_iter()
        .filter(|entry| !super::is_retired(&entry.kind))
    {
        let pending_key = format!("package-init:{}", instance.id);
        let pending = db
            .query_row(
                "SELECT 1 FROM widget_preferences WHERE key=?1",
                [&pending_key],
                |_| Ok(()),
            )
            .optional()
            .map_err(err)?
            .is_some();
        if pending {
            let prepared = (|| -> Result<()> {
                let path = package_path(directory, &instance.kind)?;
                if !path.join("manifest.json").try_exists().map_err(err)? {
                    write_package(&path, &instance.kind)?;
                }
                Ok(())
            })();
            if prepared.is_ok() {
                db.execute(
                    "DELETE FROM widget_preferences WHERE key=?1",
                    [&pending_key],
                )
                .map_err(err)?;
            }
        }
        let valid = (|| -> Result<bool> {
            let path = package_path(directory, &instance.kind)?;
            let mut definition = super::manifest(&instance.kind)?;
            let expected = serde_json::to_vec(&definition).map_err(err)?;
            let previous = if instance.kind == "paper-plane" {
                definition.description = "드래그로 날리고 비행 기록을 남겨요".into();
                Some(serde_json::to_vec(&definition).map_err(err)?)
            } else if instance.kind == "preparation" {
                definition.description = "일정별 체크리스트와 자료 링크".into();
                definition.required = vec!["calendar".into()];
                Some(serde_json::to_vec(&definition).map_err(err)?)
            } else {
                None
            };
            let manifest = path.join("manifest.json");
            if !manifest.symlink_metadata().is_ok_and(|metadata| {
                metadata.is_file()
                    && !metadata.file_type().is_symlink()
                    && (metadata.len() == expected.len() as u64
                        || previous
                            .as_ref()
                            .is_some_and(|bytes| metadata.len() == bytes.len() as u64))
            }) {
                return Ok(false);
            }
            let installed = std::fs::read(manifest).map_err(err)?;
            if installed == expected {
                return Ok(true);
            }
            if previous.as_ref() == Some(&installed) {
                write_package(&path, &instance.kind)?;
                return Ok(true);
            }
            Ok(false)
        })()
        .unwrap_or(false);
        if !valid {
            instance.error = Some("위젯 파일을 확인하지 못했어요. 데이터는 보존했어요.".into());
            put(db, &instance)?;
        } else if super::is_package_error(instance.error.as_deref()) {
            instance.error = None;
            put(db, &instance)?;
        }
        let before = instance.data.clone();
        let migrated = db
            .execute(
                "DELETE FROM widget_preferences WHERE key=?1",
                [format!("widget-migrated:{}", instance.id)],
            )
            .map_err(err)?
            > 0;
        if !migrated {
            suspend(&mut instance, chrono::Utc::now().timestamp_millis(), true)?;
        }
        if instance.data != before {
            instance.revision += 1;
            put(db, &instance)?;
        }
    }
    discard_pending(db)
}

fn active_data(db: &Connection) -> Result<BTreeMap<String, Value>> {
    Ok(instances(db)?
        .into_iter()
        .filter(|entry| !super::is_retired(&entry.kind))
        .map(|entry| (entry.kind, entry.data))
        .collect())
}

// Body and widget gestures own the same inventory and reaction cooldown.
#[cfg(test)]
pub(crate) fn body_interaction(
    db: &Connection,
    character_id: &str,
    action: &str,
    request_id: &str,
    now: i64,
) -> Result<Option<WidgetEvent>> {
    let slot = crate::characters::active_ids(db)?
        .iter()
        .position(|id| id == character_id)
        .ok_or("활성 캐릭터가 아니에요.")?;
    body_interaction_at(db, character_id, slot, action, request_id, now)
}

// A runtime actor ticket is validated by the caller under action before this
// transaction. This path preserves the shared receipt/inventory/cooldown engine.
pub(crate) fn body_interaction_with_actor(
    db: &Connection,
    actor: &crate::characters::InstalledCharacter,
    slot: usize,
    action: &str,
    request_id: &str,
    now: i64,
) -> Result<Option<WidgetEvent>> {
    if slot >= crate::characters::MAX_ROSTER
        || crate::characters::get(db, &actor.id)?.definition != actor.definition
    {
        return Err("교감 인물이나 정의가 바뀌었어요.".into());
    }
    body_interaction_at(db, &actor.id, slot, action, request_id, now)
}

fn body_interaction_at(
    db: &Connection,
    character_id: &str,
    slot: usize,
    action: &str,
    request_id: &str,
    now: i64,
) -> Result<Option<WidgetEvent>> {
    uuid::Uuid::parse_str(request_id)
        .map_err(|_| "교감 요청 식별자가 올바르지 않아요.".to_string())?;
    if !matches!(
        action,
        "poke" | "stroke" | "cheek-grab" | "snack" | "drink" | "gift"
    ) {
        return Err("알 수 없는 교감 동작이에요.".into());
    }
    let tx = db.unchecked_transaction().map_err(err)?;
    let fingerprint = format!("body:{character_id}:{action}");
    let previous: Option<String> = tx
        .query_row(
            "SELECT fingerprint FROM widget_requests WHERE id=?",
            [request_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(err)?;
    if let Some(previous) = previous {
        if previous != fingerprint {
            return Err("이미 사용한 교감 요청의 내용이 달라졌어요.".into());
        }
        return Ok(None);
    }
    let mut instance = instances(&tx)?
        .into_iter()
        .find(|instance| instance.kind == "interaction")
        .unwrap_or(WidgetInstance {
            id: uuid::Uuid::new_v4().to_string(),
            kind: "interaction".into(),
            version: 1,
            revision: 0,
            data: super::toys::initial("interaction"),
            error: None,
        });
    let input = json!({"character":((b'A' + slot as u8) as char).to_string(),"owner":character_id});
    let effect = super::toys::act("interaction", &instance.data, action, &input, now, 0)?;
    let draft = effect.events.into_iter().next().map(|mut event| {
        event.payload["source"] = json!("body");
        event
    });
    instance.data = effect.data;
    instance.revision += 1;
    put(&tx, &instance)?;
    tx.execute(
        "INSERT INTO widget_requests VALUES(?1,?2)",
        params![request_id, fingerprint],
    )
    .map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(draft.map(|event| WidgetEvent {
        id: request_id.into(),
        instance_id: instance.id,
        widget_kind: "interaction".into(),
        revision: instance.revision,
        created_at: now,
        expires_at: now + 30_000,
        event,
    }))
}

pub fn execute(db: &Connection, request: &WidgetRequest, now: i64, entropy: u64) -> Result<()> {
    let tx = db.unchecked_transaction().map_err(err)?;
    execute_in_transaction(&tx, request, now, entropy)?;
    tx.commit().map_err(err)
}

// The caller owns the transaction, including its durable operation receipt.
pub(crate) fn execute_in_transaction(
    tx: &Connection,
    request: &WidgetRequest,
    now: i64,
    entropy: u64,
) -> Result<()> {
    uuid::Uuid::parse_str(&request.request_id)
        .map_err(|_| "요청 식별자가 올바르지 않아요.".to_string())?;
    let fingerprint = hex::encode(Sha256::digest(serde_json::to_vec(request).map_err(err)?));
    let previous: Option<String> = tx
        .query_row(
            "SELECT fingerprint FROM widget_requests WHERE id=?",
            [&request.request_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(err)?;
    if let Some(previous) = previous {
        return if previous == fingerprint {
            Ok(())
        } else {
            Err("이미 사용한 요청 식별자의 내용이 달라졌어요.".into())
        };
    }
    let instance = get(tx, &request.instance_id)?;
    if instance.revision != request.expected_revision {
        return Err(
            "다른 화면에서 위젯이 변경됐어요. 최신 상태를 확인하고 다시 시도해 주세요.".into(),
        );
    }
    if (instance.kind == "interaction"
        && matches!(request.action.as_str(), "stroke" | "poke" | "snack"))
        || (matches!(instance.kind.as_str(), "small-match" | "fortune")
            && (request.input.get("character").is_some() || request.input.get("owner").is_some()))
    {
        let slot = request.input["character"]
            .as_str()
            .filter(|slot| matches!(*slot, "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H"))
            .ok_or("함께 지내는 캐릭터를 골라 주세요.")?;
        let character = crate::characters::active_character(tx, &slot.to_ascii_lowercase())?;
        if request.input["owner"]
            .as_str()
            .is_some_and(|owner| owner != character.id)
        {
            return Err("함께 지내는 캐릭터가 바뀌었어요. 다시 골라 주세요.".into());
        }
    }
    let mut related = active_data(tx)?;
    if instance.kind == "preparation"
        && matches!(request.action.as_str(), "create" | "update")
        && request.input["eventId"]
            .as_str()
            .is_some_and(|id| !id.is_empty())
    {
        let id = request.input["eventId"]
            .as_str()
            .ok_or("일정을 선택해 주세요.")?;
        let known = related.get("calendar").is_some_and(|data| {
            data["events"].as_array().is_some_and(|events| {
                events.iter().any(|event| {
                    event["id"] == id
                        && event["cancelled"] != true
                        && event["connectionId"].as_str().is_some_and(|connection_id| {
                            !connection_id.trim().is_empty()
                                && (connection_id == "local"
                                    || data["connections"].as_array().is_some_and(|connections| {
                                        connections.iter().any(|connection| {
                                            connection["id"].as_str() == Some(connection_id)
                                        })
                                    }))
                        })
                })
            })
        });
        if !known {
            return Err("현재 조회할 수 있는 일정을 선택해 주세요.".into());
        }
    }
    let effect = if instance.kind == "preparation" && request.action == "check-promote" {
        promote_preparation_check(tx, &instance, request, &mut related, now, entropy)?
    } else if instance.kind == "preparation"
        && request.action == "create"
        && request.input.get("tasks").is_some()
    {
        create_preparation_with_tasks(tx, &instance, request, &mut related, now, entropy)?
    } else {
        super::act(&instance, request, &related, now, entropy)?
    };
    apply_effect(tx, instance, effect, now)?;
    tx.execute(
        "INSERT INTO widget_requests VALUES(?1,?2)",
        params![request.request_id, fingerprint],
    )
    .map_err(err)?;
    Ok(())
}

fn create_preparation_with_tasks(
    db: &Connection,
    preparation: &WidgetInstance,
    request: &WidgetRequest,
    related: &mut BTreeMap<String, Value>,
    now: i64,
    entropy: u64,
) -> Result<WidgetEffect> {
    let tasks = request.input["tasks"]
        .as_array()
        .ok_or("준비할 일 형식이 올바르지 않습니다.")?;
    if tasks.is_empty() {
        return super::act(preparation, request, related, now, entropy);
    }
    let todo = instances(db)?
        .into_iter()
        .find(|item| item.kind == "todo")
        .ok_or("할 일 위젯을 찾지 못했어요.")?;
    let todo_effect = super::planning::act(
        "todo",
        &todo.data,
        "batch-add",
        &json!({"items":tasks}),
        related,
        now,
        entropy,
    )?;
    let before_ids: std::collections::BTreeSet<&str> = todo.data["items"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| item["id"].as_str())
        .collect();
    let created_ids: Vec<&str> = todo_effect.data["items"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| item["id"].as_str())
        .filter(|id| !before_ids.contains(id))
        .collect();
    let mut input = request.input.clone();
    input["todoIds"] = json!(created_ids);
    related.insert("todo".into(), todo_effect.data.clone());
    let effect = super::planning::act(
        "preparation",
        &preparation.data,
        "create",
        &input,
        related,
        now,
        entropy,
    )?;
    apply_effect(db, todo, todo_effect, now)?;
    Ok(effect)
}

fn promote_preparation_check(
    db: &Connection,
    preparation: &WidgetInstance,
    request: &WidgetRequest,
    related: &mut BTreeMap<String, Value>,
    now: i64,
    entropy: u64,
) -> Result<WidgetEffect> {
    let check = preparation.data["envelopes"]
        .as_array()
        .and_then(|envelopes| {
            envelopes
                .iter()
                .find(|envelope| envelope["id"] == request.input["id"])
        })
        .and_then(|envelope| envelope["checks"].as_array())
        .and_then(|checks| {
            checks
                .iter()
                .find(|check| check["id"] == request.input["checkId"])
        })
        .ok_or("준비 항목을 찾을 수 없습니다.")?;
    if check["done"] == true {
        return Err("완료한 준비 항목은 먼저 완료를 취소해 주세요.".into());
    }
    let selected = request.input["plannedDate"]
        .as_str()
        .ok_or("계획할 날짜를 선택해 주세요.")?;
    let todo = instances(db)?
        .into_iter()
        .find(|item| item.kind == "todo")
        .ok_or("할 일 위젯을 찾지 못했어요.")?;
    let todo_effect = super::planning::act(
        "todo",
        &todo.data,
        "add",
        &json!({"title":check["text"],"plannedDate":selected}),
        related,
        now,
        entropy,
    )?;
    let todo_id = todo_effect.data["items"]
        .as_array()
        .and_then(|items| items.last())
        .and_then(|item| item["id"].as_str())
        .ok_or("할 일을 만들지 못했습니다.")?;
    let mut input = request.input.clone();
    input["todoId"] = json!(todo_id);
    related.insert("todo".into(), todo_effect.data.clone());
    let effect = super::planning::act(
        "preparation",
        &preparation.data,
        "check-promote",
        &input,
        related,
        now,
        entropy,
    )?;
    apply_effect(db, todo, todo_effect, now)?;
    Ok(effect)
}

/// The diary transaction owns both the move history and the live planning change.
pub(crate) fn move_diary_todo(
    db: &Connection,
    todo_id: &str,
    from_date: &str,
    to_date: &str,
    title: &str,
) -> Result<()> {
    let todo = instances(db)?
        .into_iter()
        .find(|item| item.kind == "todo")
        .ok_or("할 일 위젯을 찾지 못했어요.")?;
    let item = todo.data["items"]
        .as_array()
        .and_then(|items| items.iter().find(|item| item["id"] == todo_id))
        .ok_or("옮길 할 일을 찾을 수 없습니다.")?;
    let planned = if item.get("plannedDate").is_some() {
        item["plannedDate"].as_str().map(str::to_owned)
    } else {
        item["dueDate"].as_str().map(str::to_owned).or_else(|| {
            item["dueAt"]
                .as_i64()
                .and_then(chrono::DateTime::from_timestamp_millis)
                .map(|at| {
                    at.with_timezone(&chrono::Local)
                        .format("%Y-%m-%d")
                        .to_string()
                })
        })
    };
    if planned.as_deref() != Some(from_date)
        || item["title"] != title
        || item["completedAt"].is_number()
    {
        return Err("할 일이 바뀌었거나 이미 완료됐어요. 최신 내용을 다시 확인해 주세요.".into());
    }
    let now = chrono::Utc::now().timestamp_millis();
    let effect = super::planning::act(
        "todo",
        &todo.data,
        "plan",
        &json!({"ids":[todo_id],"date":to_date}),
        &BTreeMap::new(),
        now,
        0,
    )?;
    apply_effect(db, todo, effect, now)
}

fn apply_effect(
    db: &Connection,
    mut instance: WidgetInstance,
    effect: WidgetEffect,
    now: i64,
) -> Result<()> {
    let changed = instance.data != effect.data;
    if !changed && effect.events.is_empty() {
        return Ok(());
    }
    instance.data = effect.data;
    instance.revision += 1;
    if !super::is_package_error(instance.error.as_deref()) {
        instance.error = None;
    }
    put(db, &instance)?;
    for draft in effect.events {
        if draft.text.chars().count() > 2000 || draft.kind.len() > 80 {
            return Err("위젯 사건의 크기가 제한을 넘었어요.".into());
        }
        let event = WidgetEvent {
            id: uuid::Uuid::new_v4().to_string(),
            instance_id: instance.id.clone(),
            widget_kind: instance.kind.clone(),
            revision: instance.revision,
            created_at: now,
            expires_at: now.saturating_add(30_000),
            event: draft,
        };
        db.execute(
            "INSERT INTO widget_events(id,instance_id,data,pending) VALUES(?1,?2,?3,1)",
            params![
                event.id,
                event.instance_id,
                serde_json::to_string(&event).map_err(err)?
            ],
        )
        .map_err(err)?;
        db.execute(
            "INSERT OR IGNORE INTO widget_journal VALUES(?)",
            [&event.id],
        )
        .map_err(err)?;
        if event.event.kind == "item-acquired" {
            collect_item(db, &event.event)?;
        }
    }
    if instance.kind == "todo" {
        synchronize_jar(db)?;
    }
    db.execute("UPDATE widget_events SET pending=0 WHERE pending=1 AND (json_extract(data,'$.expiresAt')<=?1 OR NOT EXISTS(SELECT 1 FROM widget_instances i WHERE i.id=widget_events.instance_id AND i.revision=json_extract(widget_events.data,'$.revision')))",[now]).map_err(err)?;
    db.execute("UPDATE widget_events SET pending=0 WHERE pending=1 AND seq NOT IN (SELECT seq FROM widget_events WHERE pending=1 ORDER BY CASE WHEN json_extract(data,'$.kind') IN ('timer-finished','calendar-reminder','planner-reminder') THEN 0 ELSE 1 END,seq DESC LIMIT 8)",[]).map_err(err)?;
    Ok(())
}

pub fn commit_data(
    db: &Connection,
    id: &str,
    expected_revision: i64,
    data: Value,
    events: Vec<EventDraft>,
    now: i64,
) -> Result<()> {
    let tx = db.unchecked_transaction().map_err(err)?;
    let instance = get(&tx, id)?;
    if super::is_retired(&instance.kind) || instance.revision != expected_revision {
        return Err("이미 변경되거나 중지된 위젯의 결과는 적용하지 않았어요.".into());
    }
    apply_effect(&tx, instance, WidgetEffect { data, events }, now)?;
    tx.commit().map_err(err)
}

pub(crate) fn record_desktop_result(
    db: &Connection,
    id: &str,
    revision: i64,
    draft: EventDraft,
    now: i64,
    pending: bool,
) -> Result<bool> {
    let tx = db.unchecked_transaction().map_err(err)?;
    let instance = get(&tx, id)?;
    if super::is_retired(&instance.kind) || instance.revision != revision {
        return Ok(false);
    }
    let event = WidgetEvent {
        id: uuid::Uuid::new_v4().to_string(),
        instance_id: id.into(),
        widget_kind: instance.kind.clone(),
        revision,
        created_at: now,
        expires_at: now + 30_000,
        event: draft,
    };
    let data = serde_json::to_string(&event).map_err(err)?;
    tx.execute(
        "INSERT INTO desktop_toy_results VALUES(?1,?2,?3,?4,?5)",
        params![event.id, id, instance.kind, now, data],
    )
    .map_err(err)?;
    tx.execute(
        "INSERT INTO widget_events(id,instance_id,data,pending) VALUES(?1,?2,?3,?4)",
        params![event.id, id, data, pending],
    )
    .map_err(err)?;
    tx.execute("INSERT INTO widget_journal VALUES(?1)", [&event.id])
        .map_err(err)?;
    tx.execute("UPDATE widget_events SET pending=0 WHERE pending=1 AND (json_extract(data,'$.expiresAt')<=?1 OR seq NOT IN (SELECT seq FROM widget_events WHERE pending=1 ORDER BY CASE WHEN json_extract(data,'$.kind') IN ('timer-finished','calendar-reminder','planner-reminder') THEN 0 ELSE 1 END,seq DESC LIMIT 8))",[now]).map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(true)
}

fn collect_item(db: &Connection, event: &EventDraft) -> Result<()> {
    let Some(mut collection) = instances(db)?
        .into_iter()
        .find(|entry| entry.kind == "collection")
    else {
        return Ok(());
    };
    let item_id = event.payload["itemId"]
        .as_str()
        .ok_or("획득품 식별자를 찾지 못했어요.")?;
    let name = event.payload["name"]
        .as_str()
        .ok_or("획득품 이름을 찾지 못했어요.")?;
    let quantity = event.payload["quantity"]
        .as_u64()
        .filter(|value| *value == 1)
        .ok_or("획득 수량이 올바르지 않아요.")?;
    let items = collection.data["items"]
        .as_array_mut()
        .ok_or("수집함 데이터를 읽지 못했어요.")?;
    if let Some(item) = items.iter_mut().find(|item| item["itemId"] == item_id) {
        item["quantity"] = json!(item["quantity"]
            .as_u64()
            .unwrap_or(0)
            .saturating_add(quantity));
    } else {
        items.push(json!({"itemId":item_id,"name":name,"quantity":quantity}));
    }
    collection.revision += 1;
    put(db, &collection)
}

/// The jar mirrors the todo owner: every direct completion, including each
/// frequency record, is one marble.
fn synchronize_jar(db: &Connection) -> Result<()> {
    let all = instances(db)?;
    let Some(mut jar) = all
        .iter()
        .find(|entry| entry.kind == "completion-jar")
        .cloned()
    else {
        return Ok(());
    };
    let mut completed = all
        .iter()
        .find(|entry| entry.kind == "todo")
        .and_then(|entry| entry.data["items"].as_array())
        .into_iter()
        .flatten()
        .flat_map(|item| {
            let mut marbles = vec![];
            if item["completedAt"].is_number() {
                marbles.push(json!({"id":item["id"],"title":item["title"],"completedAt":item["completedAt"]}));
            }
            for record in item["frequencyRecords"].as_array().into_iter().flatten() {
                marbles.push(json!({"id":record["id"],"title":item["title"],"completedAt":record["createdAt"]}));
            }
            marbles
        })
        .collect::<Vec<_>>();
    completed.sort_by_key(|marble| std::cmp::Reverse(marble["completedAt"].as_i64().unwrap_or(0)));
    let data = json!({"completed":completed});
    if jar.data != data {
        jar.data = data;
        jar.revision += 1;
        put(db, &jar)?;
    }
    Ok(())
}

#[cfg(test)]
pub fn advance(db: &Connection, now: i64) -> Result<bool> {
    advance_with_continuity(db, now, true)
}

pub fn advance_with_continuity(db: &Connection, now: i64, continuous: bool) -> Result<bool> {
    let tx = db.unchecked_transaction().map_err(err)?;
    let mut changed = false;
    for instance in instances(&tx)?
        .into_iter()
        .filter(|entry| !super::is_retired(&entry.kind))
    {
        let effect = if instance.kind == "focus-timer" && !continuous {
            super::planning::suspend_timer(&instance.data, now, true).map(|data| {
                (data != instance.data).then_some(WidgetEffect {
                    data,
                    events: vec![],
                })
            })
        } else {
            super::tick(&instance, now)
        };
        match effect {
            Ok(Some(effect)) => {
                apply_effect(&tx, instance, effect, now)?;
                changed = true;
            }
            Ok(None) => {}
            Err(error) => {
                let mut failed = instance;
                if !super::is_package_error(failed.error.as_deref())
                    && failed.error.as_deref() != Some(&error)
                {
                    failed.error = Some(error);
                    put(&tx, &failed)?;
                    changed = true;
                }
            }
        }
    }
    tx.execute("DELETE FROM widget_events WHERE json_extract(data,'$.createdAt')<? AND NOT EXISTS(SELECT 1 FROM widget_journal WHERE event_id=widget_events.id)",[now.saturating_sub(300_000)]).map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(changed)
}

pub(crate) fn discard_automatic_desktop_pending(db: &Connection) -> Result<()> {
    db.execute("UPDATE widget_events SET pending=0 WHERE pending=1 AND id IN (SELECT id FROM desktop_toy_results) AND json_extract(data,'$.payload.automatic')=1", [])
        .map_err(err)?;
    Ok(())
}

pub(crate) fn reaction_enabled(db: &Connection, id: &str) -> Result<bool> {
    let value: Option<String> = db
        .query_row(
            "SELECT value FROM widget_preferences WHERE key=?1",
            [format!("reaction:{id}")],
            |row| row.get(0),
        )
        .optional()
        .map_err(err)?;
    Ok(value.as_deref() != Some("0"))
}

pub(crate) fn set_reaction(db: &Connection, id: &str, enabled: bool) -> Result<()> {
    let tx = db.unchecked_transaction().map_err(err)?;
    if reaction_enabled(&tx, id)? == enabled {
        return tx.commit().map_err(err);
    }
    tx.execute(
        "UPDATE widget_events SET pending=0 WHERE pending=1 AND instance_id=?1",
        [id],
    )
    .map_err(err)?;
    tx.execute("DELETE FROM widget_state_pending WHERE widget_id=?1", [id])
        .map_err(err)?;
    if enabled {
        tx.execute(
            "DELETE FROM widget_preferences WHERE key=?1",
            [format!("reaction:{id}")],
        )
        .map_err(err)?;
    } else {
        tx.execute("INSERT INTO widget_preferences(key,value) VALUES(?1,'0') ON CONFLICT(key) DO UPDATE SET value='0'", [format!("reaction:{id}")]).map_err(err)?;
    }
    tx.commit().map_err(err)
}

pub fn discard_pending(db: &Connection) -> Result<()> {
    db.execute("UPDATE widget_events SET pending=0 WHERE pending=1", [])
        .map_err(err)?;
    Ok(())
}

/// A paused or finished timer is not focus; `now` is in milliseconds like the timer deadline.
pub fn focus_active(db: &Connection, now: i64) -> Result<bool> {
    db.query_row(
        "SELECT EXISTS(SELECT 1 FROM widget_instances WHERE kind='focus-timer' AND json_extract(data,'$.status')='running' AND json_extract(data,'$.mode')='focus' AND json_extract(data,'$.deadline')>?1)",
        [now],
        |row| row.get(0),
    )
    .map_err(err)
}

/// Focus drops balloon reactions; OS notifications are delivered independently.
pub(crate) fn discard_pending_during_focus(db: &Connection) -> Result<()> {
    discard_pending(db)
}

/// Silence preserves important reminders and an explicitly requested greeting preview.
pub(crate) fn discard_pending_during_quiet(db: &Connection) -> Result<()> {
    db.execute("UPDATE widget_events SET pending=0 WHERE pending=1 AND json_extract(data,'$.kind') NOT IN ('timer-finished','calendar-reminder','planner-reminder') AND NOT (json_extract(data,'$.kind')='planner-mood' AND COALESCE(json_extract(data,'$.payload.preview'),0)=1)", [])
        .map_err(err)?;
    Ok(())
}

fn without_toy_statistics(mut event: WidgetEvent) -> WidgetEvent {
    let text = match event.event.kind.as_str() {
        "ball.stopped" | "desktop.ball.stopped" => Some("공이 멈췄어요."),
        "paper-plane.landed" | "desktop.paper-plane.landed" => Some("종이비행기가 착지했어요."),
        "bubbles.streak" => Some("비눗방울을 터뜨렸어요."),
        "desktop.bubbles.popped" | "pet.arrived" | "desktop.pet.rested" => None,
        _ => return event,
    };
    if let Some(text) = text {
        event.event.text = text.into();
    }
    if let Some(payload) = event.event.payload.as_object_mut() {
        for field in [
            "bounces",
            "distance",
            "distanceUnit",
            "best",
            "streak",
            "arrivals",
        ] {
            payload.remove(field);
        }
    }
    event
}

pub fn take_reaction(db: &Connection, now: i64) -> Result<Option<WidgetEvent>> {
    db.execute(
        "UPDATE widget_events SET pending=0 WHERE pending=1 AND json_extract(data,'$.payload.bubbleEnabled')=0",
        [],
    ).map_err(err)?;
    db.execute("UPDATE widget_events SET pending=0 WHERE pending=1 AND EXISTS(SELECT 1 FROM widget_preferences WHERE key='reaction:' || widget_events.instance_id AND value='0')", []).map_err(err)?;
    let mut statement = db.prepare("SELECT data FROM widget_events WHERE pending=1 ORDER BY CASE WHEN json_extract(data,'$.kind') IN ('timer-finished','calendar-reminder','planner-reminder') THEN 0 ELSE 1 END,seq DESC LIMIT 8").map_err(err)?;
    let events = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(err)?
        .map(|row| serde_json::from_str::<WidgetEvent>(&row.map_err(err)?).map_err(err))
        .collect::<Result<Vec<_>>>()?;
    drop(statement);
    let all = instances(db)?;
    let result = events.into_iter().find(|event| {
        event.expires_at > now
            && all.iter().any(|instance| {
                instance.id == event.instance_id && instance.revision == event.revision
            })
            && super::manifest(&event.widget_kind).is_ok()
    });
    discard_pending(db)?;
    Ok(result.map(without_toy_statistics))
}

pub fn journal(
    db: &Connection,
    before: Option<i64>,
    start_at: i64,
    end_at: i64,
) -> Result<Vec<(i64, WidgetEvent)>> {
    if start_at >= end_at {
        return Err("기록을 조회할 날짜 범위가 올바르지 않아요.".into());
    }
    let mut statement = db.prepare("SELECT e.seq,e.data FROM widget_events e JOIN widget_journal j ON j.event_id=e.id WHERE e.seq<?1 AND json_extract(e.data,'$.createdAt')>=?2 AND json_extract(e.data,'$.createdAt')<?3 ORDER BY e.seq DESC LIMIT 100").map_err(err)?;
    let rows = statement
        .query_map([before.unwrap_or(i64::MAX), start_at, end_at], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(err)?;
    rows.map(|row| {
        let (sequence, data) = row.map_err(err)?;
        Ok((
            sequence,
            without_toy_statistics(serde_json::from_str(&data).map_err(err)?),
        ))
    })
    .collect()
}

/// Internal telemetry only; caller holds the app action lock and has read the latest row.
/// Do not invalidate in-flight user commands or event revisions for every sample.
pub(crate) fn save_usage_observation(
    db: &Connection,
    id: &str,
    revision: i64,
    data: &Value,
) -> Result<()> {
    let changed = db.execute(
        "UPDATE widget_instances SET data=?1 WHERE id=?2 AND revision=?3 AND kind='focus-timer' AND installed=1 AND enabled=1",
        params![serde_json::to_string(data).map_err(err)?, id, revision],
    ).map_err(err)?;
    if changed != 1 {
        return Err("사용 시간 관측 대상이 변경됐어요.".into());
    }
    Ok(())
}
