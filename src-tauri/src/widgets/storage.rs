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
CREATE TABLE IF NOT EXISTS widget_events(seq INTEGER PRIMARY KEY AUTOINCREMENT,
id TEXT UNIQUE NOT NULL,instance_id TEXT NOT NULL,data TEXT NOT NULL,pending INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS widget_journal(event_id TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS widget_preferences(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS desktop_toy_results(id TEXT PRIMARY KEY,widget_id TEXT NOT NULL,kind TEXT NOT NULL,created_at INTEGER NOT NULL,data TEXT NOT NULL);",
    )
    .map_err(err)?;
    retire_removed_widgets(db)?;
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
    if super::is_retired(&instance.kind)
        || !instance.installed
        || !instance.enabled
        || instance.revision != expected_revision
    {
        return Err(
            "다른 화면에서 위젯이 변경됐어요. 최신 상태를 확인하고 다시 시도해 주세요.".into(),
        );
    }
    instance.revision += 1;
    put(db, &instance)?;
    Ok(instance)
}

pub fn instances(db: &Connection) -> Result<Vec<WidgetInstance>> {
    let mut statement = db.prepare("SELECT id,kind,version,installed,enabled,revision,data,error FROM widget_instances ORDER BY rowid").map_err(err)?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, u32>(2)?,
                row.get::<_, bool>(3)?,
                row.get::<_, bool>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, Option<String>>(7)?,
            ))
        })
        .map_err(err)?;
    rows.map(|row| {
        let (id, kind, version, installed, enabled, revision, data, error) = row.map_err(err)?;
        Ok(WidgetInstance {
            id,
            kind,
            version,
            installed,
            enabled,
            revision,
            data: serde_json::from_str(&data).map_err(err)?,
            error,
        })
    })
    .collect()
}

pub fn get(db: &Connection, id: &str) -> Result<WidgetInstance> {
    instances(db)?
        .into_iter()
        .find(|instance| instance.id == id)
        .ok_or_else(|| "설치된 위젯을 찾지 못했어요.".into())
}

fn put(db: &Connection, instance: &WidgetInstance) -> Result<()> {
    db.execute(
        "INSERT INTO widget_instances VALUES(?1,?2,?3,?4,?5,?6,?7,?8)
ON CONFLICT(id) DO UPDATE SET version=excluded.version,installed=excluded.installed,
enabled=excluded.enabled,revision=excluded.revision,data=excluded.data,error=excluded.error",
        params![
            instance.id,
            instance.kind,
            instance.version,
            instance.installed,
            instance.enabled,
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
                super::project_with_background(instance, &all, background_updated_at)
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

pub fn finish_onboarding(db: &Connection) -> Result<()> {
    db.execute("INSERT INTO widget_preferences VALUES('onboarding','done') ON CONFLICT(key) DO UPDATE SET value='done'", []).map_err(err)?;
    Ok(())
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

pub fn install(db: &Connection, directory: &Path, kinds: &[String]) -> Result<()> {
    if kinds.is_empty() || kinds.len() > super::catalog()?.len() {
        return Err("설치할 위젯을 선택해 주세요.".into());
    }
    let before = instances(db)?;
    let mut selected = std::collections::BTreeSet::new();
    for kind in kinds {
        super::manifest(kind)?;
        if !selected.insert(kind.as_str()) {
            return Err("같은 위젯을 두 번 선택했어요.".into());
        }
    }
    for kind in kinds {
        for dependency in super::manifest(kind)?.required {
            if !selected.contains(dependency.as_str())
                && !before
                    .iter()
                    .any(|entry| entry.kind == dependency && entry.installed && entry.enabled)
            {
                return Err(format!(
                    "{}도 설치 항목에 선택하거나 먼저 켜 주세요.",
                    super::manifest(&dependency)?.name
                ));
            }
        }
    }
    for kind in kinds {
        package_path(directory, kind)?;
        if before
            .iter()
            .any(|entry| entry.kind == *kind && entry.version != 1)
        {
            return Err("남아 있는 위젯 데이터의 버전이 호환되지 않아요.".into());
        }
    }
    let staging = directory
        .join("widgets")
        .join(format!(".install-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&staging).map_err(err)?;
    let mut published: Vec<(std::path::PathBuf, Option<std::path::PathBuf>)> = Vec::new();
    let result = (|| {
        for kind in kinds {
            write_package(&staging.join(kind), kind)?;
        }
        let tx = db.unchecked_transaction().map_err(err)?;
        for kind in kinds {
            let path = package_path(directory, kind)?;
            let old = if path.try_exists().map_err(err)? {
                let backup = staging.join(format!("previous-{kind}"));
                std::fs::rename(&path, &backup).map_err(err)?;
                Some(backup)
            } else {
                None
            };
            published.push((path.clone(), old));
            std::fs::rename(staging.join(kind), &path).map_err(err)?;
            let mut instance = before
                .iter()
                .find(|entry| entry.kind == *kind)
                .cloned()
                .unwrap_or(WidgetInstance {
                    id: uuid::Uuid::new_v4().to_string(),
                    kind: kind.clone(),
                    version: 1,
                    installed: false,
                    enabled: false,
                    revision: 0,
                    data: super::initial(kind)?,
                    error: None,
                });
            if !instance.enabled {
                suspend(&mut instance, chrono::Utc::now().timestamp_millis(), true);
            }
            instance.installed = true;
            instance.enabled = true;
            instance.error = None;
            instance.revision += 1;
            put(&tx, &instance)?;
        }
        discard_pending(&tx)?;
        finish_onboarding(&tx)?;
        tx.commit().map_err(err)
    })();
    if result.is_err() {
        for (path, old) in published.into_iter().rev() {
            if path.exists() {
                std::fs::remove_dir_all(&path).map_err(err)?;
            }
            if let Some(old) = old {
                std::fs::rename(old, path).map_err(err)?;
            }
        }
    }
    std::fs::remove_dir_all(staging).map_err(err)?;
    result
}

fn suspend(instance: &mut WidgetInstance, now: i64, restarting: bool) {
    match instance.kind.as_str() {
        "focus-timer" if instance.data["status"] == "running" => {
            let remaining = instance.data["deadline"]
                .as_i64()
                .unwrap_or(now)
                .saturating_sub(now)
                .max(0);
            instance.data["remainingMs"] = json!(remaining);
            if restarting && remaining == 0 {
                instance.data["status"] = json!("finished");
            } else if !restarting {
                instance.data["status"] = json!("paused");
            }
            if !restarting || remaining == 0 {
                instance.data["deadline"] = Value::Null;
            }
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
}

pub fn set_enabled(db: &Connection, id: &str, enabled: bool) -> Result<()> {
    let tx = db.unchecked_transaction().map_err(err)?;
    let mut instance = get(&tx, id)?;
    super::manifest(&instance.kind)?;
    if !instance.installed {
        return Err("위젯을 먼저 설치해 주세요.".into());
    }
    if !enabled {
        suspend(&mut instance, chrono::Utc::now().timestamp_millis(), false);
    }
    if enabled && !instance.enabled && instance.kind == "plant" {
        instance.data["updatedAt"] = json!(chrono::Utc::now().timestamp_millis());
    }
    instance.enabled = enabled;
    instance.revision += 1;
    put(&tx, &instance)?;
    discard_pending(&tx)?;
    tx.commit().map_err(err)
}

pub fn remove(db: &Connection, directory: &Path, id: &str, delete_data: bool) -> Result<()> {
    let mut instance = get(db, id)?;
    let path = package_path(directory, &instance.kind)?;
    // Move to a non-executable staging name so a DB failure can restore the package.
    let staged = path.with_extension(format!("removed-{}", uuid::Uuid::new_v4()));
    let existed = path.try_exists().map_err(err)?;
    if existed {
        std::fs::rename(&path, &staged).map_err(err)?;
    }
    let result = (|| {
        let tx = db.unchecked_transaction().map_err(err)?;
        instance.installed = false;
        instance.enabled = false;
        instance.revision += 1;
        instance.error = None;
        suspend(&mut instance, chrono::Utc::now().timestamp_millis(), false);
        if delete_data {
            instance.data = super::initial(&instance.kind)?;
            super::backgrounds::remove(&tx, id)?;
            tx.execute("DELETE FROM widget_journal WHERE event_id IN (SELECT id FROM desktop_toy_results WHERE widget_id=?1)",[id]).map_err(err)?;
            tx.execute("DELETE FROM widget_events WHERE id IN (SELECT id FROM desktop_toy_results WHERE widget_id=?1)",[id]).map_err(err)?;
            tx.execute("DELETE FROM desktop_toy_results WHERE widget_id=?1", [id])
                .map_err(err)?;
        }
        if delete_data && instance.kind == "journal" {
            tx.execute("DELETE FROM widget_journal", []).map_err(err)?;
        }
        put(&tx, &instance)?;
        discard_pending(&tx)?;
        tx.commit().map_err(err)
    })();
    if result.is_err() {
        if existed {
            let _ = std::fs::rename(&staged, &path);
        }
        return result;
    }
    if existed {
        let metadata = staged.symlink_metadata().map_err(err)?;
        if metadata.file_type().is_symlink() {
            std::fs::remove_file(&staged).map_err(err)?;
        } else {
            std::fs::remove_dir_all(&staged).map_err(err)?;
        }
    }
    Ok(())
}

pub fn verify_packages(db: &Connection, directory: &Path) -> Result<()> {
    retire_removed_widgets(db)?;
    for mut instance in instances(db)?.into_iter().filter(|entry| entry.installed) {
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
            instance.enabled = false;
            instance.error = Some(
                "설치 파일을 확인하지 못했어요. 다시 설치해 주세요. 데이터는 보존했어요.".into(),
            );
            put(db, &instance)?;
        }
        let before = instance.data.clone();
        suspend(&mut instance, chrono::Utc::now().timestamp_millis(), true);
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
        .filter(|entry| entry.installed && entry.enabled && !super::is_retired(&entry.kind))
        .map(|entry| (entry.kind, entry.data))
        .collect())
}

pub fn execute(db: &Connection, request: &WidgetRequest, now: i64, entropy: u64) -> Result<()> {
    uuid::Uuid::parse_str(&request.request_id)
        .map_err(|_| "요청 식별자가 올바르지 않아요.".to_string())?;
    let fingerprint = hex::encode(Sha256::digest(serde_json::to_vec(request).map_err(err)?));
    let tx = db.unchecked_transaction().map_err(err)?;
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
    let instance = get(&tx, &request.instance_id)?;
    if !instance.installed || !instance.enabled {
        return Err("설치하고 켠 위젯만 사용할 수 있어요.".into());
    }
    if instance.revision != request.expected_revision {
        return Err(
            "다른 화면에서 위젯이 변경됐어요. 최신 상태를 확인하고 다시 시도해 주세요.".into(),
        );
    }
    if instance.kind == "interaction"
        && matches!(request.action.as_str(), "stroke" | "poke" | "snack")
    {
        let slot = request.input["character"]
            .as_str()
            .filter(|slot| matches!(*slot, "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H"))
            .ok_or("함께 지내는 캐릭터를 골라 주세요.")?;
        let character = crate::characters::active_character(&tx, &slot.to_ascii_lowercase())?;
        if request.input["owner"]
            .as_str()
            .is_some_and(|owner| owner != character.id)
        {
            return Err("함께 지내는 캐릭터가 바뀌었어요. 다시 골라 주세요.".into());
        }
    }
    let mut related = active_data(&tx)?;
    if instance.kind == "preparation"
        && matches!(request.action.as_str(), "create" | "update")
        && request.input["eventId"]
            .as_str()
            .is_some_and(|id| !id.is_empty())
    {
        let id = request.input["eventId"]
            .as_str()
            .ok_or("일정을 선택해 주세요.")?;
        let known = related
            .get("calendar")
            .and_then(|data| data["events"].as_array())
            .is_some_and(|events| {
                events
                    .iter()
                    .any(|event| event["id"] == id && event["cancelled"] != true)
            });
        if !known {
            return Err("현재 조회할 수 있는 일정을 선택해 주세요.".into());
        }
    }
    let effect = if instance.kind == "preparation" && request.action == "check-promote" {
        promote_preparation_check(&tx, &instance, request, &mut related, now, entropy)?
    } else {
        super::act(&instance, request, &related, now, entropy)?
    };
    apply_effect(&tx, instance, effect, now)?;
    tx.execute(
        "INSERT INTO widget_requests VALUES(?1,?2)",
        params![request.request_id, fingerprint],
    )
    .map_err(err)?;
    tx.commit().map_err(err)
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
        .find(|item| item.kind == "todo" && item.installed && item.enabled)
        .ok_or("할 일 위젯을 켜 주세요.")?;
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
        .find(|item| item.kind == "todo" && item.installed && item.enabled)
        .ok_or("할 일 위젯을 켜 주세요.")?;
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
    instance.error = None;
    put(db, &instance)?;
    let journal_enabled = active_data(db)?.contains_key("journal");
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
        if journal_enabled {
            db.execute(
                "INSERT OR IGNORE INTO widget_journal VALUES(?)",
                [&event.id],
            )
            .map_err(err)?;
        }
        if event.event.kind == "item-acquired" {
            collect_item(db, &event.event)?;
        }
    }
    db.execute("UPDATE widget_events SET pending=0 WHERE pending=1 AND (json_extract(data,'$.expiresAt')<=?1 OR NOT EXISTS(SELECT 1 FROM widget_instances i WHERE i.id=widget_events.instance_id AND i.installed=1 AND i.enabled=1 AND i.revision=json_extract(widget_events.data,'$.revision')))",[now]).map_err(err)?;
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
    if super::is_retired(&instance.kind)
        || !instance.installed
        || !instance.enabled
        || instance.revision != expected_revision
    {
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
    if super::is_retired(&instance.kind)
        || !instance.installed
        || !instance.enabled
        || instance.revision != revision
    {
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
    if active_data(&tx)?.contains_key("journal") {
        tx.execute("INSERT INTO widget_journal VALUES(?1)", [&event.id])
            .map_err(err)?;
    }
    tx.execute("UPDATE widget_events SET pending=0 WHERE pending=1 AND (json_extract(data,'$.expiresAt')<=?1 OR seq NOT IN (SELECT seq FROM widget_events WHERE pending=1 ORDER BY CASE WHEN json_extract(data,'$.kind') IN ('timer-finished','calendar-reminder','planner-reminder') THEN 0 ELSE 1 END,seq DESC LIMIT 8))",[now]).map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(true)
}

fn collect_item(db: &Connection, event: &EventDraft) -> Result<()> {
    let Some(mut collection) = instances(db)?
        .into_iter()
        .find(|entry| entry.kind == "collection" && entry.installed && entry.enabled)
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

pub fn advance(db: &Connection, now: i64) -> Result<bool> {
    let tx = db.unchecked_transaction().map_err(err)?;
    let mut changed = false;
    for instance in instances(&tx)?
        .into_iter()
        .filter(|entry| entry.installed && entry.enabled && !super::is_retired(&entry.kind))
    {
        match super::tick(&instance, now) {
            Ok(Some(effect)) => {
                apply_effect(&tx, instance, effect, now)?;
                changed = true;
            }
            Ok(None) => {}
            Err(error) => {
                let mut failed = instance;
                if failed.error.as_deref() != Some(&error) {
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

pub fn discard_pending(db: &Connection) -> Result<()> {
    db.execute("UPDATE widget_events SET pending=0 WHERE pending=1", [])
        .map_err(err)?;
    Ok(())
}

/// A paused or finished timer is not focus; `now` is in milliseconds like the timer deadline.
pub fn focus_active(db: &Connection, now: i64) -> Result<bool> {
    db.query_row(
        "SELECT EXISTS(SELECT 1 FROM widget_instances WHERE kind='focus-timer' AND installed=1 AND enabled=1 AND json_extract(data,'$.status')='running' AND json_extract(data,'$.mode')='focus' AND json_extract(data,'$.deadline')>?1)",
        [now],
        |row| row.get(0),
    )
    .map_err(err)
}

/// Focus keeps only time-critical reminders and the mood lines the user turned on.
pub(crate) fn discard_pending_during_focus(db: &Connection) -> Result<()> {
    db.execute("UPDATE widget_events SET pending=0 WHERE pending=1 AND json_extract(data,'$.kind') NOT IN ('timer-finished','calendar-reminder','planner-reminder','planner-mood')", [])
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
                instance.id == event.instance_id
                    && instance.installed
                    && instance.enabled
                    && instance.revision == event.revision
            })
            && super::manifest(&event.widget_kind).is_ok_and(|manifest| {
                manifest.required.iter().all(|kind| {
                    all.iter().any(|instance| {
                        instance.kind == *kind && instance.installed && instance.enabled
                    })
                })
            })
    });
    discard_pending(db)?;
    Ok(result.map(without_toy_statistics))
}

pub fn journal(db: &Connection, before: Option<i64>) -> Result<Vec<(i64, WidgetEvent)>> {
    let mut statement = db.prepare("SELECT e.seq,e.data FROM widget_events e JOIN widget_journal j ON j.event_id=e.id WHERE e.seq<? ORDER BY e.seq DESC LIMIT 100").map_err(err)?;
    let rows = statement
        .query_map([before.unwrap_or(i64::MAX)], |row| {
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
