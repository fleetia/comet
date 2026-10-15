use super::*;
use rusqlite::{params, Connection, OptionalExtension};
use std::{
    collections::BTreeSet,
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
};

pub fn initialize(db: &Connection) -> Result<()> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS organizer_settings(user_id TEXT PRIMARY KEY,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS organizer_vaults(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS organizer_sources(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,workspace_id TEXT NOT NULL,project_id TEXT NOT NULL,kind TEXT NOT NULL,locator TEXT NOT NULL,title TEXT NOT NULL,hash TEXT NOT NULL,content TEXT NOT NULL,active INTEGER NOT NULL,automatic INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS organizer_jobs(id TEXT PRIMARY KEY,source_id TEXT NOT NULL,source_hash TEXT NOT NULL,chunk_index INTEGER NOT NULL,chunk_count INTEGER NOT NULL,content TEXT NOT NULL,state TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,reason TEXT,next_at INTEGER NOT NULL DEFAULT 0,priority INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,organizer_version INTEGER NOT NULL DEFAULT 1,model_calls INTEGER NOT NULL DEFAULT 0,UNIQUE(source_id,source_hash,chunk_index,organizer_version));
CREATE INDEX IF NOT EXISTS organizer_jobs_due ON organizer_jobs(state,next_at,priority);
CREATE TABLE IF NOT EXISTS organizer_records(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,source_id TEXT NOT NULL,source_hash TEXT NOT NULL,data TEXT NOT NULL,state TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS organizer_operations(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,job_id TEXT NOT NULL,fingerprint TEXT NOT NULL,state TEXT NOT NULL,record TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS organizer_operation_job ON organizer_operations(job_id);
CREATE TABLE IF NOT EXISTS organizer_usage(user_id TEXT NOT NULL,day TEXT NOT NULL,requests INTEGER NOT NULL,PRIMARY KEY(user_id,day));
CREATE TABLE IF NOT EXISTS organizer_scan_warnings(vault_id TEXT PRIMARY KEY,user_id TEXT NOT NULL,unreadable INTEGER NOT NULL);
CREATE VIRTUAL TABLE IF NOT EXISTS organizer_fts USING fts5(doc_id UNINDEXED,source_id UNINDEXED,record_id UNINDEXED,title,body,tokenize='unicode61');
UPDATE organizer_jobs SET state='pending' WHERE state='running';").map_err(err)?;
    let columns = db
        .prepare("PRAGMA table_info(organizer_jobs)")
        .map_err(err)?
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(err)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(err)?;
    if !columns.iter().any(|name| name == "organizer_version") {
        let tx = db.unchecked_transaction().map_err(err)?;
        tx.execute_batch("ALTER TABLE organizer_jobs RENAME TO organizer_jobs_legacy;
CREATE TABLE organizer_jobs(id TEXT PRIMARY KEY,source_id TEXT NOT NULL,source_hash TEXT NOT NULL,chunk_index INTEGER NOT NULL,chunk_count INTEGER NOT NULL,content TEXT NOT NULL,state TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,reason TEXT,next_at INTEGER NOT NULL DEFAULT 0,priority INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,organizer_version INTEGER NOT NULL DEFAULT 1,model_calls INTEGER NOT NULL DEFAULT 0,UNIQUE(source_id,source_hash,chunk_index,organizer_version));
INSERT INTO organizer_jobs(id,source_id,source_hash,chunk_index,chunk_count,content,state,attempts,reason,next_at,priority,created_at) SELECT id,source_id,source_hash,chunk_index,chunk_count,content,state,attempts,reason,next_at,priority,created_at FROM organizer_jobs_legacy;
DROP TABLE organizer_jobs_legacy;
CREATE INDEX organizer_jobs_due ON organizer_jobs(state,next_at,priority);").map_err(err)?;
        tx.commit().map_err(err)?;
    } else if !columns.iter().any(|name| name == "model_calls") {
        db.execute_batch(
            "ALTER TABLE organizer_jobs ADD COLUMN model_calls INTEGER NOT NULL DEFAULT 0;",
        )
        .map_err(err)?;
    }
    db.execute_batch("CREATE TABLE IF NOT EXISTS organizer_scope(slot INTEGER PRIMARY KEY CHECK(slot=1),revision INTEGER NOT NULL);
INSERT OR IGNORE INTO organizer_scope VALUES(1,0);
CREATE TRIGGER IF NOT EXISTS organizer_settings_scope_insert AFTER INSERT ON organizer_settings BEGIN UPDATE organizer_scope SET revision=revision+1 WHERE slot=1; END;
CREATE TRIGGER IF NOT EXISTS organizer_settings_scope_update AFTER UPDATE ON organizer_settings BEGIN UPDATE organizer_scope SET revision=revision+1 WHERE slot=1; END;
CREATE TRIGGER IF NOT EXISTS organizer_settings_scope_delete AFTER DELETE ON organizer_settings BEGIN UPDATE organizer_scope SET revision=revision+1 WHERE slot=1; END;
CREATE TRIGGER IF NOT EXISTS organizer_vault_scope_insert AFTER INSERT ON organizer_vaults BEGIN UPDATE organizer_scope SET revision=revision+1 WHERE slot=1; END;
CREATE TRIGGER IF NOT EXISTS organizer_vault_scope_update AFTER UPDATE ON organizer_vaults BEGIN UPDATE organizer_scope SET revision=revision+1 WHERE slot=1; END;
CREATE TRIGGER IF NOT EXISTS organizer_vault_scope_delete AFTER DELETE ON organizer_vaults BEGIN UPDATE organizer_scope SET revision=revision+1 WHERE slot=1; END;").map_err(err)?;
    if db
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='kv'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(err)?
        != 0
    {
        db.execute_batch("CREATE TRIGGER IF NOT EXISTS organizer_user_scope_insert AFTER INSERT ON kv WHEN NEW.key='active_user_id' BEGIN UPDATE organizer_scope SET revision=revision+1 WHERE slot=1; END;
CREATE TRIGGER IF NOT EXISTS organizer_user_scope_update AFTER UPDATE ON kv WHEN NEW.key='active_user_id' AND OLD.value!=NEW.value BEGIN UPDATE organizer_scope SET revision=revision+1 WHERE slot=1; END;
CREATE TRIGGER IF NOT EXISTS organizer_user_scope_delete AFTER DELETE ON kv WHEN OLD.key='active_user_id' BEGIN UPDATE organizer_scope SET revision=revision+1 WHERE slot=1; END;").map_err(err)?;
    }
    Ok(())
}

pub fn scope_revision(db: &Connection) -> Result<i64> {
    db.query_row(
        "SELECT revision FROM organizer_scope WHERE slot=1",
        [],
        |row| row.get(0),
    )
    .map_err(err)
}

pub fn get_settings(db: &Connection, user_id: &str) -> Result<OrganizerSettings> {
    owner(user_id)?;
    let value: Option<String> = db
        .query_row(
            "SELECT data FROM organizer_settings WHERE user_id=?1",
            [user_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(err)?;
    value
        .map(|value| serde_json::from_str(&value).map_err(err))
        .transpose()
        .map(|value| value.unwrap_or_default())
}

pub fn save_settings(db: &Connection, user_id: &str, settings: &OrganizerSettings) -> Result<()> {
    owner(user_id)?;
    if !(30..=86_400).contains(&settings.idle_seconds)
        || !(1..=10_000).contains(&settings.daily_request_limit)
    {
        return Err("정리 간격이나 하루 요청 한도가 올바르지 않아요.".into());
    }
    db.execute("INSERT INTO organizer_settings VALUES(?1,?2) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data", params![user_id, serde_json::to_string(settings).map_err(err)?]).map_err(err)?;
    if !settings.enabled {
        cancel_running(db, user_id)?;
    }
    Ok(())
}

pub fn list_vaults(db: &Connection, user_id: &str) -> Result<Vec<VaultConnection>> {
    owner(user_id)?;
    let mut query = db
        .prepare("SELECT data FROM organizer_vaults WHERE user_id=?1 ORDER BY rowid")
        .map_err(err)?;
    let values = query
        .query_map([user_id], |row| row.get::<_, String>(0))
        .map_err(err)?;
    values
        .map(|value| serde_json::from_str(&value.map_err(err)?).map_err(err))
        .collect()
}

fn vault_by_id(db: &Connection, user_id: &str, id: &str) -> Result<VaultConnection> {
    list_vaults(db, user_id)?
        .into_iter()
        .find(|vault| vault.id == id)
        .ok_or("연결한 Vault를 찾을 수 없어요.".into())
}

#[allow(clippy::too_many_arguments)]
pub fn connect_vault(
    db: &Connection,
    user_id: &str,
    root: &Path,
    include: &[String],
    exclude: &[String],
    output_dir: &str,
    automatic: bool,
) -> Result<VaultConnection> {
    owner(user_id)?;
    let root = vault::validate_root(root)?;
    let root = root
        .to_str()
        .ok_or("Vault 경로 인코딩을 읽을 수 없어요.")?
        .to_string();
    vault::relative(output_dir, false)?;
    if include.len() > 100 || exclude.len() > 100 {
        return Err("포함·제외 경로는 각각 100개까지 선택할 수 있어요.".into());
    }
    for path in include.iter().chain(exclude) {
        vault::relative(path, false)?;
    }
    let previous = list_vaults(db, user_id)?
        .into_iter()
        .find(|item| item.root == root);
    if previous
        .as_ref()
        .is_some_and(|item| item.output_dir != output_dir)
    {
        return Err(
            "기록이 연결된 출력 폴더는 변경할 수 없어요. 새 Vault 연결을 사용해 주세요.".into(),
        );
    }
    let connection = VaultConnection {
        id: previous
            .map(|item| item.id)
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
        user_id: user_id.into(),
        root,
        include: include.to_vec(),
        exclude: exclude.to_vec(),
        output_dir: output_dir.into(),
        enabled: true,
        automatic,
    };
    // Connecting is read-only on the selected Vault. The dedicated folder is created on first output.
    db.execute("INSERT INTO organizer_vaults VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET data=excluded.data", params![connection.id,user_id,serde_json::to_string(&connection).map_err(err)?]).map_err(err)?;
    let existing = sources_for_workspace(db, user_id, &connection.id)?;
    for source in existing {
        if !vault::allowed(&connection, Path::new(&source.source.locator))
            || (!connection.include.is_empty()
                && !connection
                    .include
                    .iter()
                    .any(|prefix| Path::new(&source.source.locator).starts_with(prefix)))
        {
            deactivate(db, user_id, &source.source.id)?;
        }
    }
    Ok(connection)
}

pub fn disconnect_vault(db: &Connection, user_id: &str, id: &str) -> Result<()> {
    let mut connection = vault_by_id(db, user_id, id)?;
    connection.enabled = false;
    let tx = db.unchecked_transaction().map_err(err)?;
    tx.execute(
        "UPDATE organizer_vaults SET data=?1 WHERE id=?2 AND user_id=?3",
        params![
            serde_json::to_string(&connection).map_err(err)?,
            id,
            user_id
        ],
    )
    .map_err(err)?;
    deactivate_sources(&tx, user_id, id, &[])?;
    tx.commit().map_err(err)
}

fn source_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SourceDocument> {
    Ok(SourceDocument {
        source: SourceRef {
            id: row.get(0)?,
            user_id: row.get(1)?,
            workspace_id: row.get(2)?,
            project_id: row.get(3)?,
            kind: row.get(4)?,
            locator: row.get(5)?,
            title: row.get(6)?,
            content_hash: row.get(7)?,
            active: row.get(9)?,
        },
        content: row.get(8)?,
    })
}

fn source(db: &Connection, user_id: &str, id: &str) -> Result<SourceDocument> {
    owner(user_id)?;
    db.query_row("SELECT id,user_id,workspace_id,project_id,kind,locator,title,hash,content,active FROM organizer_sources WHERE id=?1 AND user_id=?2", params![id,user_id],source_row).optional().map_err(err)?.ok_or("정리 원문을 찾을 수 없어요.".into())
}

fn sources_for_workspace(
    db: &Connection,
    user_id: &str,
    workspace: &str,
) -> Result<Vec<SourceDocument>> {
    let mut query=db.prepare("SELECT id,user_id,workspace_id,project_id,kind,locator,title,hash,content,active FROM organizer_sources WHERE user_id=?1 AND workspace_id=?2").map_err(err)?;
    let result = query
        .query_map(params![user_id, workspace], source_row)
        .map_err(err)?
        .collect::<std::result::Result<_, _>>()
        .map_err(err);
    result
}

fn enqueue(db: &Connection, source: &SourceDocument, priority: bool) -> Result<()> {
    let chars: Vec<char> = source.content.chars().collect();
    let count = chars.len().div_ceil(CHUNK_CHARS).max(1);
    let created_at = now();
    for index in 0..count {
        let content: String = chars
            [index * CHUNK_CHARS..((index + 1) * CHUNK_CHARS).min(chars.len())]
            .iter()
            .collect();
        let id = uuid::Uuid::new_v4().to_string();
        db.execute("INSERT OR IGNORE INTO organizer_jobs(id,source_id,source_hash,chunk_index,chunk_count,content,state,priority,created_at,organizer_version) VALUES(?1,?2,?3,?4,?5,?6,'pending',?7,?8,?9)", params![id,source.source.id,source.source.content_hash,index,count,content,priority,created_at,ORGANIZER_VERSION]).map_err(err)?;
    }
    db.execute("UPDATE organizer_jobs SET state='pending',next_at=0 WHERE source_id=?1 AND source_hash=?2 AND state IN ('cancelled','superseded')",params![source.source.id,source.source.content_hash]).map_err(err)?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn put_source(
    db: &Connection,
    user_id: &str,
    workspace_id: &str,
    project_id: &str,
    kind: &str,
    locator: &str,
    title: &str,
    content: &str,
    automatic: bool,
) -> Result<SourceRef> {
    owner(user_id)?;
    if content.len() as u64 > MAX_SOURCE_BYTES
        || title.chars().count() > 500
        || locator.len() > 4096
        || workspace_id.is_empty()
        || kind.is_empty()
    {
        return Err("정리 원문의 크기나 식별자가 올바르지 않아요.".into());
    }
    let id = hash(&serde_json::to_string(&(user_id, workspace_id, kind, locator)).map_err(err)?);
    let previous = source(db, user_id, &id).ok();
    let content_hash = hash(content);
    let changed = previous
        .as_ref()
        .is_none_or(|old| old.source.content_hash != content_hash || !old.source.active);
    let reference = SourceRef {
        id: id.clone(),
        user_id: user_id.into(),
        workspace_id: workspace_id.into(),
        project_id: project_id.into(),
        kind: kind.into(),
        locator: locator.into(),
        title: title.into(),
        content_hash: content_hash.clone(),
        active: true,
    };
    let tx = db.unchecked_transaction().map_err(err)?;
    tx.execute("INSERT INTO organizer_sources VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,1,?10) ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id,title=excluded.title,hash=excluded.hash,content=excluded.content,active=1,automatic=excluded.automatic",params![id,user_id,workspace_id,project_id,kind,locator,title,content_hash,content,automatic]).map_err(err)?;
    if changed {
        tx.execute("UPDATE organizer_jobs SET state='superseded' WHERE source_id=?1 AND source_hash!=?2 AND state!='done'",params![id,content_hash]).map_err(err)?;
        tx.execute(
            "DELETE FROM organizer_fts WHERE doc_id=?1 OR (source_id=?1 AND record_id!='')",
            [&id],
        )
        .map_err(err)?;
        tx.execute(
            "INSERT INTO organizer_fts VALUES(?1,?1,'',?2,?3)",
            params![id, title, content],
        )
        .map_err(err)?;
    }
    if automatic {
        enqueue(
            &tx,
            &SourceDocument {
                source: reference.clone(),
                content: content.into(),
            },
            previous.is_some() || kind != "vault",
        )?;
    }
    tx.commit().map_err(err)?;
    Ok(reference)
}

fn deactivate(db: &Connection, user_id: &str, id: &str) -> Result<()> {
    db.execute(
        "UPDATE organizer_sources SET active=0 WHERE id=?1 AND user_id=?2",
        params![id, user_id],
    )
    .map_err(err)?;
    db.execute("DELETE FROM organizer_fts WHERE source_id=?1 AND EXISTS(SELECT 1 FROM organizer_sources WHERE id=?1 AND user_id=?2)",params![id,user_id]).map_err(err)?;
    db.execute("UPDATE organizer_jobs SET state='cancelled' WHERE source_id=?1 AND state IN ('pending','running') AND EXISTS(SELECT 1 FROM organizer_sources WHERE id=?1 AND user_id=?2)",params![id,user_id]).map_err(err)?;
    Ok(())
}

pub fn deactivate_sources(
    db: &Connection,
    user_id: &str,
    workspace_id: &str,
    live_ids: &[String],
) -> Result<()> {
    owner(user_id)?;
    let live: BTreeSet<&str> = live_ids.iter().map(String::as_str).collect();
    for item in sources_for_workspace(db, user_id, workspace_id)? {
        if !live.contains(item.source.id.as_str()) {
            deactivate(db, user_id, &item.source.id)?;
        }
    }
    Ok(())
}

pub fn scan_vault(
    db: &Connection,
    user_id: &str,
    id: &str,
    cancel: &AtomicBool,
) -> Result<ScanReport> {
    let connection = vault_by_id(db, user_id, id)?;
    if !connection.enabled {
        return Err("연결이 해제된 Vault예요.".into());
    }
    let (documents, skipped, interrupted) = vault::collect(&connection, cancel)?;
    let mut report = ScanReport {
        skipped,
        cancelled: interrupted,
        ..Default::default()
    };
    let mut live = Vec::new();
    let mut unreadable = 0;
    for locator in documents {
        if cancel.load(Ordering::Acquire) {
            report.cancelled = true;
            break;
        }
        let content = match vault::read(Path::new(&connection.root), Path::new(&locator)) {
            Ok(content) if vault::archived(&content) => {
                report.skipped += 1;
                continue;
            }
            Ok(content) => content,
            Err(_) => {
                report.skipped += 1;
                unreadable += 1;
                continue;
            }
        };
        let source_id =
            hash(&serde_json::to_string(&(user_id, id, "vault", &locator)).map_err(err)?);
        let changed = source(db, user_id, &source_id).map_or(true, |previous| {
            previous.source.content_hash != hash(&content) || !previous.source.active
        });
        let title = content
            .lines()
            .find_map(|line| line.strip_prefix("# "))
            .unwrap_or(&locator)
            .chars()
            .take(500)
            .collect::<String>();
        let project = Path::new(&locator)
            .parent()
            .and_then(Path::to_str)
            .unwrap_or("");
        let item = put_source(
            db,
            user_id,
            id,
            project,
            "vault",
            &locator,
            &title,
            &content,
            connection.automatic,
        )?;
        live.push(item.id);
        report.scanned += 1;
        if changed {
            report.changed += 1;
        }
    }
    if !report.cancelled {
        deactivate_sources(db, user_id, id, &live)?;
        db.execute("INSERT INTO organizer_scan_warnings VALUES(?1,?2,?3) ON CONFLICT(vault_id) DO UPDATE SET unreadable=excluded.unreadable WHERE organizer_scan_warnings.user_id=excluded.user_id",params![id,user_id,unreadable]).map_err(err)?;
    }
    Ok(report)
}

fn validate_source(db: &Connection, user_id: &str, item: &SourceDocument) -> Result<()> {
    if !item.source.active {
        return Err("현재 연결 범위에서 제외된 원문이에요.".into());
    }
    if item.source.kind == "vault" {
        let connection = vault_by_id(db, user_id, &item.source.workspace_id)?;
        let path = vault::relative(&item.source.locator, false)?;
        if !connection.enabled
            || !vault::allowed(&connection, &path)
            || !vault::included(&connection, &path)
            || vault::managed_source(&connection, &path)
        {
            return Err("연결 범위에서 제외된 원문이에요.".into());
        }
        if hash(&vault::read(Path::new(&connection.root), &path)?) != item.source.content_hash {
            return Err("원문이 바뀌었어요. 다시 읽은 뒤 정리해 주세요.".into());
        }
    }
    Ok(())
}

pub fn read_sources(db: &Connection, user_id: &str, ids: &[String]) -> Result<Vec<SourceDocument>> {
    if ids.len() > 20 {
        return Err("한 번에 20개 원문까지 읽을 수 있어요.".into());
    }
    ids.iter()
        .map(|id| {
            let item = source(db, user_id, id)?;
            validate_source(db, user_id, &item)?;
            Ok(item)
        })
        .collect()
}

pub fn search(db: &Connection, user_id: &str, query: &str, limit: usize) -> Result<Vec<SearchHit>> {
    owner(user_id)?;
    let terms = query
        .split(|c: char| !c.is_alphanumeric())
        .filter(|term| !term.is_empty())
        .take(12)
        .map(|term| format!("\"{}\"*", term.replace('"', "")))
        .collect::<Vec<_>>();
    if terms.is_empty() {
        return Ok(vec![]);
    }
    let mut statement=db.prepare("SELECT f.source_id,f.record_id,f.title,snippet(organizer_fts,4,'','', ' … ',32) FROM organizer_fts f JOIN organizer_sources s ON s.id=f.source_id WHERE organizer_fts MATCH ?1 AND s.user_id=?2 AND s.active=1 ORDER BY bm25(organizer_fts) LIMIT ?3").map_err(err)?;
    let hits = statement
        .query_map(
            params![terms.join(" OR "), user_id, limit.clamp(1, 50)],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )
        .map_err(err)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(err)?;
    let mut result = Vec::new();
    for (id, record, title, excerpt) in hits {
        let item = source(db, user_id, &id)?;
        if validate_source(db, user_id, &item).is_ok() {
            result.push(SearchHit {
                source: item.source,
                record_id: (!record.is_empty()).then_some(record),
                title,
                excerpt,
            });
        }
    }
    Ok(result)
}

fn job(db: &Connection, user_id: &str, id: &str) -> Result<OrganizerJob> {
    let (source_id,source_hash,chunk_index,chunk_count,content,state,attempts)=db.query_row("SELECT j.source_id,j.source_hash,j.chunk_index,j.chunk_count,j.content,j.state,j.attempts FROM organizer_jobs j JOIN organizer_sources s ON s.id=j.source_id WHERE j.id=?1 AND s.user_id=?2",params![id,user_id],|row| Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?,row.get::<_,usize>(2)?,row.get::<_,usize>(3)?,row.get::<_,String>(4)?,row.get::<_,String>(5)?,row.get::<_,u32>(6)?))).map_err(err)?;
    Ok(OrganizerJob {
        id: id.into(),
        source: source(db, user_id, &source_id)?.source,
        source_hash,
        chunk_index,
        chunk_count,
        content,
        state,
        attempts,
    })
}

fn claim(
    db: &Connection,
    user_id: &str,
    at: i64,
    requested: Option<&str>,
    manual: bool,
) -> Result<Option<OrganizerJob>> {
    owner(user_id)?;
    let settings = get_settings(db, user_id)?;
    if requested.is_none() && !manual && !settings.enabled {
        return Ok(None);
    }
    let connections = list_vaults(db, user_id)?;
    let mut statement=db.prepare("SELECT j.id,s.id,s.kind,s.workspace_id,s.automatic FROM organizer_jobs j JOIN organizer_sources s ON s.id=j.source_id WHERE s.user_id=?1 AND s.active=1 AND j.source_hash=s.hash AND j.organizer_version=?4 AND j.state='pending' AND j.next_at<=?2 AND (?3 IS NULL OR s.id=?3) AND NOT EXISTS(SELECT 1 FROM organizer_operations o WHERE o.job_id=j.id AND o.state IN ('prepared','undoing','conflict')) ORDER BY j.priority DESC,j.created_at DESC,j.chunk_index").map_err(err)?;
    let candidates = statement
        .query_map(params![user_id, at, requested, ORGANIZER_VERSION], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, bool>(4)?,
            ))
        })
        .map_err(err)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(err)?;
    for (id, source_id, kind, workspace, automatic) in candidates {
        let available = if kind == "vault" {
            connections.iter().any(|vault| {
                vault.id == workspace
                    && vault.enabled
                    && (requested.is_some() || manual || vault.automatic)
            })
        } else {
            requested.is_some() || settings.comet_enabled
        };
        if !available || (requested.is_none() && !manual && !automatic) {
            continue;
        }
        let item = source(db, user_id, &source_id)?;
        if let Err(reason) = validate_source(db, user_id, &item) {
            db.execute("UPDATE organizer_jobs SET state='deferred',reason=?2 WHERE id=?1 AND state='pending'",params![id,reason]).map_err(err)?;
            continue;
        }
        let updated=db.execute("UPDATE organizer_jobs SET state='running',attempts=attempts+1 WHERE id=?1 AND state='pending' AND source_hash=?2 AND EXISTS(SELECT 1 FROM organizer_sources s WHERE s.id=organizer_jobs.source_id AND s.active=1 AND s.hash=?2)",params![id,item.source.content_hash]).map_err(err)?;
        if updated == 1 {
            return job(db, user_id, &id).map(Some);
        }
    }
    Ok(None)
}

pub fn claim_job(db: &Connection, user_id: &str, at: i64) -> Result<Option<OrganizerJob>> {
    claim(db, user_id, at, None, false)
}

pub fn claim_manual_job(db: &Connection, user_id: &str, at: i64) -> Result<Option<OrganizerJob>> {
    claim(db, user_id, at, None, true)
}

pub fn enqueue_manual_jobs(db: &Connection, user_id: &str) -> Result<usize> {
    owner(user_id)?;
    let settings = get_settings(db, user_id)?;
    let vaults = list_vaults(db, user_id)?;
    let mut query=db.prepare("SELECT id,user_id,workspace_id,project_id,kind,locator,title,hash,content,active FROM organizer_sources WHERE user_id=?1 AND active=1").map_err(err)?;
    let sources = query
        .query_map([user_id], source_row)
        .map_err(err)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(err)?;
    let mut count = 0;
    for item in sources {
        let permitted = if item.source.kind == "vault" {
            vaults
                .iter()
                .any(|vault| vault.id == item.source.workspace_id && vault.enabled)
        } else {
            settings.comet_enabled
        };
        if permitted {
            enqueue(db, &item, true)?;
            // Explicit Run now releases backoff, but never grants a new model-call budget.
            db.execute("UPDATE organizer_jobs SET next_at=0,reason=NULL WHERE source_id=?1 AND source_hash=?2 AND organizer_version=?3 AND state='pending'",params![item.source.id,item.source.content_hash,ORGANIZER_VERSION]).map_err(err)?;
            count += 1;
        }
    }
    Ok(count)
}

pub fn retry_deferred(db: &Connection, user_id: &str) -> Result<usize> {
    owner(user_id)?;
    let tx = db.unchecked_transaction().map_err(err)?;
    tx.execute("UPDATE organizer_operations SET state='prepared' WHERE user_id=?1 AND state='conflict' AND job_id IN(SELECT j.id FROM organizer_jobs j JOIN organizer_sources s ON s.id=j.source_id WHERE s.user_id=?1 AND s.active=1 AND j.source_hash=s.hash AND j.state='deferred')",[user_id]).map_err(err)?;
    let count = tx.execute("UPDATE organizer_jobs SET state='pending',attempts=0,model_calls=0,next_at=0,reason=NULL WHERE state='deferred' AND source_id IN(SELECT id FROM organizer_sources WHERE user_id=?1 AND active=1)",[user_id]).map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(count)
}

pub fn reserve_job_call(db: &Connection, user_id: &str, job_id: &str) -> Result<bool> {
    owner(user_id)?;
    let changed=db.execute("UPDATE organizer_jobs SET model_calls=model_calls+1 WHERE id=?1 AND state='running' AND model_calls<4 AND organizer_version=?3 AND EXISTS(SELECT 1 FROM organizer_sources s WHERE s.id=organizer_jobs.source_id AND s.user_id=?2 AND s.active=1 AND s.hash=organizer_jobs.source_hash)",params![job_id,user_id,ORGANIZER_VERSION]).map_err(err)?;
    Ok(changed == 1)
}

pub fn claim_source_job(
    db: &Connection,
    user_id: &str,
    source_id: &str,
    at: i64,
) -> Result<Option<OrganizerJob>> {
    let item = source(db, user_id, source_id)?;
    validate_source(db, user_id, &item)?;
    enqueue(db, &item, true)?;
    db.execute("UPDATE organizer_jobs SET state='pending',next_at=0,reason=NULL WHERE source_id=?1 AND source_hash=?2 AND organizer_version=?3 AND state IN ('pending','deferred','cancelled') AND NOT EXISTS(SELECT 1 FROM organizer_operations o WHERE o.job_id=organizer_jobs.id AND o.state='conflict')",params![source_id,item.source.content_hash,ORGANIZER_VERSION]).map_err(err)?;
    claim(db, user_id, at, Some(source_id), true)
}

pub fn defer_job(
    db: &Connection,
    user_id: &str,
    id: &str,
    reason: &str,
    retry_at: Option<i64>,
) -> Result<()> {
    let _ = job(db, user_id, id)?;
    db.execute(
        "UPDATE organizer_jobs SET state=?1,reason=?2,next_at=?3 WHERE id=?4 AND state='running'",
        params![
            if retry_at.is_some() {
                "pending"
            } else {
                "deferred"
            },
            reason.chars().take(500).collect::<String>(),
            retry_at.unwrap_or(0),
            id
        ],
    )
    .map_err(err)?;
    Ok(())
}

pub fn cancel_running(db: &Connection, user_id: &str) -> Result<()> {
    owner(user_id)?;
    db.execute("UPDATE organizer_jobs SET state='pending' WHERE state='running' AND source_id IN(SELECT id FROM organizer_sources WHERE user_id=?1)",[user_id]).map_err(err)?;
    Ok(())
}

fn prose(value: &str) -> String {
    value
        .lines()
        .map(|line| {
            format!(
                "> {}",
                line.replace('&', "&amp;")
                    .replace('<', "&lt;")
                    .replace('>', "&gt;")
                    .replace('[', "\\[")
                    .replace(']', "\\]")
                    .replace('`', "\\`")
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn title_text(value: &str) -> String {
    value
        .replace(['\n', '\r'], " ")
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('[', "\\[")
        .replace(']', "\\]")
        .replace('`', "\\`")
}

fn markdown(job: &OrganizerJob, input: &SummaryInput) -> Result<String> {
    if input.title.trim().is_empty()
        || input.title.chars().count() > 200
        || input.summary.trim().is_empty()
        || input.summary.chars().count() > 12_000
        || [&input.decisions, &input.open_questions, &input.next_actions]
            .iter()
            .any(|values| {
                values.len() > 30 || values.iter().any(|value| value.chars().count() > 2_000)
            })
    {
        return Err("정리 결과의 크기나 형식을 확인할 수 없어요.".into());
    }
    let mut output=format!("<!-- comet-organizer-record-v1 -->\n# {}\n\n원문: {}\n원문 ID: {}\n원문 해시: {}\n부분: {}/{}\n\n## 요약\n{}\n",title_text(&input.title),prose(&job.source.locator),job.source.id,job.source_hash,job.chunk_index+1,job.chunk_count,prose(&input.summary));
    for (heading, values) in [
        ("결정", &input.decisions),
        ("아직 정하지 않은 내용", &input.open_questions),
        ("후속 행동 기록", &input.next_actions),
    ] {
        if !values.is_empty() {
            output.push_str(&format!("\n## {heading}\n"));
            for value in values {
                output.push_str(&prose(value));
                output.push_str("\n\n");
            }
        }
    }
    output.push_str("\n자동 정리된 기록이며 할 일이나 일정의 상태를 변경하지 않습니다.\n");
    Ok(output)
}

fn complete_operation(
    db: &Connection,
    user_id: &str,
    operation_id: &str,
    record: &OrganizerRecord,
    job_id: &str,
) -> Result<()> {
    let tx = db.unchecked_transaction().map_err(err)?;
    let current = source(&tx, user_id, &record.source.id)?;
    if !current.source.active || current.source.content_hash != record.source.content_hash {
        return Err("원문이 바뀌어 정리 기록 적용을 멈췄어요.".into());
    }
    validate_source(&tx, user_id, &current)?;
    tx.execute("INSERT INTO organizer_records VALUES(?1,?2,?3,?4,?5,'saved',?6) ON CONFLICT(id) DO UPDATE SET data=excluded.data",params![record.id,user_id,record.source.id,record.source.content_hash,serde_json::to_string(record).map_err(err)?,record.created_at]).map_err(err)?;
    tx.execute("DELETE FROM organizer_fts WHERE doc_id=?1", [&record.id])
        .map_err(err)?;
    tx.execute(
        "INSERT INTO organizer_fts VALUES(?1,?2,?1,?3,?4)",
        params![record.id, record.source.id, record.title, record.markdown],
    )
    .map_err(err)?;
    tx.execute(
        "UPDATE organizer_operations SET state='done',record=?1 WHERE id=?2 AND user_id=?3",
        params![
            serde_json::to_string(record).map_err(err)?,
            operation_id,
            user_id
        ],
    )
    .map_err(err)?;
    tx.execute(
        "UPDATE organizer_jobs SET state='done',reason=NULL WHERE id=?1",
        [job_id],
    )
    .map_err(err)?;
    tx.commit().map_err(err)
}

pub fn save_summary(
    db: &Connection,
    user_id: &str,
    job_id: &str,
    input: &SummaryInput,
    operation_id: &str,
) -> Result<OrganizerRecord> {
    uuid::Uuid::parse_str(operation_id).map_err(err)?;
    let work = job(db, user_id, job_id)?;
    let fingerprint = hash(&serde_json::to_string(&(job_id, input)).map_err(err)?);
    let previous: Option<(String, String, String)> = db
        .query_row(
            "SELECT fingerprint,state,record FROM organizer_operations WHERE id=?1 AND user_id=?2",
            params![operation_id, user_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(err)?;
    if let Some((prior, state, record)) = &previous {
        if prior != &fingerprint {
            return Err("같은 정리 작업 ID에 다른 내용이 들어왔어요.".into());
        }
        if state == "done" {
            return serde_json::from_str(record).map_err(err);
        }
        if state == "undone" || state == "undoing" {
            return Err("되돌린 작업은 다시 적용하지 않아요.".into());
        }
        if state == "conflict" {
            return Err("정리 파일에 충돌이 있어 저장하지 않았어요. 기존 파일을 확인한 뒤 정리 설정에서 다시 시도해 주세요.".into());
        }
    }
    if work.state != "running" && previous.is_none() {
        return Err("정리 작업이 중단되었거나 이미 처리됐어요.".into());
    }
    let document = source(db, user_id, &work.source.id)?;
    if work.source_hash != document.source.content_hash {
        return Err("생성 중 원문이 바뀌었어요.".into());
    }
    validate_source(db, user_id, &document)?;
    let mut record = if let Some((_, _, json)) = previous {
        serde_json::from_str::<OrganizerRecord>(&json).map_err(err)?
    } else {
        let mut markdown = markdown(&work, input)?;
        if work.source.kind == "vault" {
            let connection = vault_by_id(db, user_id, &work.source.workspace_id)?;
            let prefix = "../".repeat(Path::new(&connection.output_dir).components().count());
            let encoded = work
                .source
                .locator
                .bytes()
                .map(|byte| {
                    if byte.is_ascii_alphanumeric() || b"-_.~/".contains(&byte) {
                        (byte as char).to_string()
                    } else {
                        format!("%{byte:02X}")
                    }
                })
                .collect::<String>();
            markdown.push_str(&format!("\n[원문 열기]({prefix}{encoded})\n"));
        }
        OrganizerRecord {
            id: operation_id.into(),
            operation_id: operation_id.into(),
            source: work.source.clone(),
            title: input.title.clone(),
            markdown,
            output_path: None,
            created_at: now(),
            state: "saved".into(),
        }
    };
    db.execute(
        "INSERT INTO organizer_operations VALUES(?1,?2,?3,?4,'prepared',?5) ON CONFLICT(id) DO UPDATE SET record=organizer_operations.record WHERE organizer_operations.user_id=excluded.user_id AND organizer_operations.fingerprint=excluded.fingerprint",
        params![
            operation_id,
            user_id,
            job_id,
            fingerprint,
            serde_json::to_string(&record).map_err(err)?
        ],
    )
    .map_err(err)?;
    let (receipt_owner, receipt_fingerprint): (String, String) = db
        .query_row(
            "SELECT user_id,fingerprint FROM organizer_operations WHERE id=?1",
            [operation_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(err)?;
    if receipt_owner != user_id || receipt_fingerprint != fingerprint {
        return Err("이미 다른 내용에 사용한 작업 식별자예요.".into());
    }
    if work.source.kind == "vault" {
        let connection = vault_by_id(db, user_id, &work.source.workspace_id)?;
        record.output_path = Some(vault::write_record(
            &connection,
            &record.id,
            &record.markdown,
        )?);
    }
    complete_operation(db, user_id, operation_id, &record, job_id)?;
    Ok(record)
}

pub fn has_incomplete_operations(db: &Connection, user_id: &str) -> Result<bool> {
    owner(user_id)?;
    db.query_row("SELECT EXISTS(SELECT 1 FROM organizer_operations WHERE user_id=?1 AND state IN ('prepared','undoing'))",[user_id],|row|row.get(0)).map_err(err)
}

pub fn recover_operations(db: &Connection, user_id: &str) -> Result<usize> {
    owner(user_id)?;
    let mut undo_query = db
        .prepare("SELECT id FROM organizer_operations WHERE user_id=?1 AND state='undoing'")
        .map_err(err)?;
    let undoing = undo_query
        .query_map([user_id], |row| row.get::<_, String>(0))
        .map_err(err)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(err)?;
    for id in undoing {
        let _ = undo_record(db, user_id, &id);
    }
    let mut query=db.prepare("SELECT id,job_id,record FROM organizer_operations WHERE user_id=?1 AND state='prepared'").map_err(err)?;
    let pending = query
        .query_map([user_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(err)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(err)?;
    let mut count = 0;
    for (id, job_id, json) in pending {
        let mut record: OrganizerRecord = serde_json::from_str(&json).map_err(err)?;
        let source = source(db, user_id, &record.source.id)?;
        if !source.source.active
            || source.source.content_hash != record.source.content_hash
            || validate_source(db, user_id, &source).is_err()
        {
            continue;
        }
        if source.source.kind == "vault" {
            let connection = vault_by_id(db, user_id, &source.source.workspace_id)?;
            match vault::write_record(&connection, &record.id, &record.markdown) {
                Ok(path) => record.output_path = Some(path),
                Err(error) => {
                    let tx = db.unchecked_transaction().map_err(err)?;
                    tx.execute("UPDATE organizer_operations SET state='conflict' WHERE id=?1 AND user_id=?2 AND state='prepared'",params![id,user_id]).map_err(err)?;
                    let reason = format!(
                        "정리 파일 복구를 멈췄어요: {error} 파일을 확인한 뒤 다시 시도해 주세요."
                    );
                    tx.execute("UPDATE organizer_jobs SET state='deferred',reason=?2,next_at=0 WHERE id=?1",params![job_id,reason.chars().take(500).collect::<String>()]).map_err(err)?;
                    tx.commit().map_err(err)?;
                    continue;
                }
            }
        }
        complete_operation(db, user_id, &id, &record, &job_id)?;
        count += 1;
    }
    Ok(count)
}

pub fn list_records(db: &Connection, user_id: &str, limit: usize) -> Result<Vec<OrganizerRecord>> {
    owner(user_id)?;
    let mut query=db.prepare("SELECT data,state FROM organizer_records WHERE user_id=?1 ORDER BY created_at DESC,id DESC LIMIT ?2").map_err(err)?;
    let values = query
        .query_map(params![user_id, limit.clamp(1, 500)], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(err)?;
    values
        .map(|value| {
            let (json, state) = value.map_err(err)?;
            let mut record: OrganizerRecord = serde_json::from_str(&json).map_err(err)?;
            record.state = state;
            Ok(record)
        })
        .collect()
}

pub fn undo_record(db: &Connection, user_id: &str, id: &str) -> Result<()> {
    owner(user_id)?;
    let (json, state): (String, String) = db
        .query_row(
            "SELECT data,state FROM organizer_records WHERE id=?1 AND user_id=?2",
            params![id, user_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(err)?;
    if state == "undone" {
        return Ok(());
    }
    let record: OrganizerRecord = serde_json::from_str(&json).map_err(err)?;
    db.execute(
        "UPDATE organizer_operations SET state='undoing' WHERE id=?1 AND user_id=?2",
        params![record.operation_id, user_id],
    )
    .map_err(err)?;
    if record.source.kind == "vault" {
        let connection = vault_by_id(db, user_id, &record.source.workspace_id)?;
        vault::undo_record(&connection, id, &hash(&record.markdown))?;
    }
    let tx = db.unchecked_transaction().map_err(err)?;
    tx.execute(
        "UPDATE organizer_records SET state='undone' WHERE id=?1 AND user_id=?2",
        params![id, user_id],
    )
    .map_err(err)?;
    tx.execute(
        "UPDATE organizer_operations SET state='undone' WHERE id=?1 AND user_id=?2",
        params![record.operation_id, user_id],
    )
    .map_err(err)?;
    tx.execute("DELETE FROM organizer_fts WHERE doc_id=?1", [id])
        .map_err(err)?;
    tx.commit().map_err(err)
}

fn day(value: &str) -> Result<()> {
    chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| "이용량 날짜가 올바르지 않아요.".to_string())?;
    Ok(())
}

pub fn reserve_request(db: &Connection, user_id: &str, date: &str, limit: u32) -> Result<bool> {
    owner(user_id)?;
    day(date)?;
    let tx = db.unchecked_transaction().map_err(err)?;
    tx.execute(
        "INSERT OR IGNORE INTO organizer_usage VALUES(?1,?2,0)",
        params![user_id, date],
    )
    .map_err(err)?;
    let changed=tx.execute("UPDATE organizer_usage SET requests=requests+1 WHERE user_id=?1 AND day=?2 AND requests<?3",params![user_id,date,limit]).map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(changed == 1)
}

pub fn status(db: &Connection, user_id: &str, date: &str) -> Result<OrganizerStatus> {
    owner(user_id)?;
    day(date)?;
    let mut status = OrganizerStatus::default();
    let mut query=db.prepare("SELECT j.state,COUNT(*) FROM organizer_jobs j JOIN organizer_sources s ON s.id=j.source_id WHERE s.user_id=?1 AND s.active=1 AND j.source_hash=s.hash GROUP BY j.state").map_err(err)?;
    for row in query
        .query_map([user_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, usize>(1)?))
        })
        .map_err(err)?
    {
        let (state, count) = row.map_err(err)?;
        match state.as_str() {
            "pending" => status.pending = count,
            "running" => status.running = count,
            "deferred" => status.deferred = count,
            "done" => status.completed = count,
            _ => {}
        }
    }
    status.records = db
        .query_row(
            "SELECT COUNT(*) FROM organizer_records WHERE user_id=?1 AND state='saved'",
            [user_id],
            |row| row.get(0),
        )
        .map_err(err)?;
    status.requests_today = db
        .query_row(
            "SELECT requests FROM organizer_usage WHERE user_id=?1 AND day=?2",
            params![user_id, date],
            |row| row.get(0),
        )
        .optional()
        .map_err(err)?
        .unwrap_or(0);
    status.latest_error=db.query_row("SELECT j.reason FROM organizer_jobs j JOIN organizer_sources s ON s.id=j.source_id WHERE s.user_id=?1 AND s.active=1 AND j.source_hash=s.hash AND j.state='deferred' AND j.reason IS NOT NULL ORDER BY j.created_at DESC LIMIT 1",[user_id],|row|row.get(0)).optional().map_err(err)?;
    if status.latest_error.is_none() {
        let delayed:Option<String>=db.query_row("SELECT j.reason FROM organizer_jobs j JOIN organizer_sources s ON s.id=j.source_id WHERE s.user_id=?1 AND s.active=1 AND j.source_hash=s.hash AND j.organizer_version=?3 AND j.state='pending' AND j.next_at>?2 AND j.reason IS NOT NULL ORDER BY j.next_at LIMIT 1",params![user_id,now(),ORGANIZER_VERSION],|row|row.get(0)).optional().map_err(err)?;
        status.latest_error=delayed.map(|reason|if reason=="취소됨" {
            "취소한 정리는 잠시 기다린 뒤 이어가요. 지금 정리를 누르면 바로 다시 시작해요.".into()
        } else {
            format!("{reason} 재시도 대기 중이에요. 지금 정리를 누르면 남은 호출 한도 안에서 다시 시작해요.")
        });
    }
    if status.latest_error.is_none() {
        let unreadable: usize=db.query_row("SELECT COALESCE(SUM(w.unreadable),0) FROM organizer_scan_warnings w JOIN organizer_vaults v ON v.id=w.vault_id AND v.user_id=w.user_id WHERE w.user_id=?1 AND json_extract(v.data,'$.enabled')=1",[user_id],|row|row.get(0)).map_err(err)?;
        if unreadable > 0 {
            status.latest_error=Some(format!("{unreadable}개 원문은 접근 권한이나 파일 형식·크기 문제로 읽지 못했어요. UTF-8 형식과 4 MiB 한도를 확인해 주세요. 읽은 자료는 계속 정리해요."));
        }
    }
    Ok(status)
}
