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
    .map_err(err)
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
            .cloned()
            .map(|instance| super::project(instance, &all))
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
    if kinds.is_empty() || kinds.len() > 22 {
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
        synchronize_jar(&tx)?;
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
    synchronize_jar(&tx)?;
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
        synchronize_jar(&tx)?;
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
    for mut instance in instances(db)?.into_iter().filter(|entry| entry.installed) {
        let valid = (|| -> Result<bool> {
            let path = package_path(directory, &instance.kind)?;
            let expected = serde_json::to_vec(&super::manifest(&instance.kind)?).map_err(err)?;
            let manifest = path.join("manifest.json");
            Ok(manifest.symlink_metadata().is_ok_and(|metadata| {
                metadata.is_file()
                    && !metadata.file_type().is_symlink()
                    && metadata.len() == expected.len() as u64
            }) && std::fs::read(manifest).is_ok_and(|bytes| bytes == expected))
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
        .filter(|entry| entry.installed && entry.enabled)
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
    let related = active_data(&tx)?;
    if instance.kind == "preparation" && request.action == "create" {
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
    let effect = super::act(&instance, request, &related, now, entropy)?;
    apply_effect(&tx, instance, effect, now)?;
    tx.execute(
        "INSERT INTO widget_requests VALUES(?1,?2)",
        params![request.request_id, fingerprint],
    )
    .map_err(err)?;
    tx.commit().map_err(err)
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
    if instance.kind == "todo" {
        synchronize_jar(db)?;
    }
    db.execute("UPDATE widget_events SET pending=0 WHERE pending=1 AND (json_extract(data,'$.expiresAt')<=?1 OR NOT EXISTS(SELECT 1 FROM widget_instances i WHERE i.id=widget_events.instance_id AND i.installed=1 AND i.enabled=1 AND i.revision=json_extract(widget_events.data,'$.revision')))",[now]).map_err(err)?;
    db.execute("UPDATE widget_events SET pending=0 WHERE pending=1 AND seq NOT IN (SELECT seq FROM widget_events WHERE pending=1 ORDER BY CASE WHEN json_extract(data,'$.kind') IN ('timer-finished','calendar-reminder') THEN 0 ELSE 1 END,seq DESC LIMIT 8)",[]).map_err(err)?;
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
    if !instance.installed || !instance.enabled || instance.revision != expected_revision {
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
    if !instance.installed || !instance.enabled || instance.revision != revision {
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
    tx.execute("UPDATE widget_events SET pending=0 WHERE pending=1 AND (json_extract(data,'$.expiresAt')<=?1 OR seq NOT IN (SELECT seq FROM widget_events WHERE pending=1 ORDER BY CASE WHEN json_extract(data,'$.kind') IN ('timer-finished','calendar-reminder') THEN 0 ELSE 1 END,seq DESC LIMIT 8))",[now]).map_err(err)?;
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

fn synchronize_jar(db: &Connection) -> Result<()> {
    let all = instances(db)?;
    let Some(mut jar) = all
        .iter()
        .find(|entry| entry.kind == "completion-jar")
        .cloned()
    else {
        return Ok(());
    };
    // The todo owner remains authoritative even while its presentation is disabled.
    let completed = all.iter().find(|entry| entry.kind == "todo")
        .and_then(|entry| entry.data["items"].as_array())
        .map(|items| items.iter().filter(|item| item["completedAt"].is_number())
            .map(|item| json!({"id":item["id"],"title":item["title"],"completedAt":item["completedAt"]})).collect::<Vec<_>>())
        .unwrap_or_default();
    let data = json!({"completed":completed});
    if jar.data != data {
        jar.data = data;
        jar.revision += 1;
        put(db, &jar)?;
    }
    Ok(())
}

pub fn advance(db: &Connection, now: i64) -> Result<bool> {
    let tx = db.unchecked_transaction().map_err(err)?;
    let mut changed = false;
    for instance in instances(&tx)?
        .into_iter()
        .filter(|entry| entry.installed && entry.enabled)
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

pub fn discard_pending(db: &Connection) -> Result<()> {
    db.execute("UPDATE widget_events SET pending=0 WHERE pending=1", [])
        .map_err(err)?;
    Ok(())
}

pub fn take_reaction(db: &Connection, now: i64) -> Result<Option<WidgetEvent>> {
    let mut statement = db.prepare("SELECT data FROM widget_events WHERE pending=1 ORDER BY CASE WHEN json_extract(data,'$.kind') IN ('timer-finished','calendar-reminder') THEN 0 ELSE 1 END,seq DESC LIMIT 8").map_err(err)?;
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
    Ok(result)
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
        Ok((sequence, serde_json::from_str(&data).map_err(err)?))
    })
    .collect()
}
