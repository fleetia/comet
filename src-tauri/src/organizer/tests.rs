use super::*;
use rusqlite::Connection;
use std::{fs, sync::atomic::AtomicBool};

fn database() -> Connection {
    let db = Connection::open_in_memory().unwrap();
    initialize(&db).unwrap();
    db
}

fn enabled(db: &Connection) {
    save_settings(
        db,
        "user",
        &OrganizerSettings {
            enabled: true,
            comet_enabled: true,
            ..Default::default()
        },
    )
    .unwrap();
}

fn input() -> SummaryInput {
    SummaryInput {
        title: "회의 정리".into(),
        summary: "색인에만 있는 결론입니다.".into(),
        decisions: vec!["원문을 보존한다".into()],
        open_questions: vec!["승인 여부는 미정".into()],
        next_actions: vec!["- [ ] 내일 확인 @due(2026-10-12)".into()],
    }
}

fn source(db: &Connection, content: &str, automatic: bool) -> SourceRef {
    put_source(
        db,
        "user",
        "comet",
        "project",
        "note",
        "note-1",
        "회의 원문",
        content,
        automatic,
    )
    .unwrap()
}

#[test]
fn explicit_sources_work_without_automatic_consent_and_receipts_are_owned() {
    let db = database();
    let source = source(&db, "사용자 원문", false);
    assert!(claim_job(&db, "user", now()).unwrap().is_none());
    let job = claim_source_job(&db, "user", &source.id, now())
        .unwrap()
        .unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    assert!(save_summary(&db, "other", &job.id, &input(), &id).is_err());
    let record = save_summary(&db, "user", &job.id, &input(), &id).unwrap();
    let replay = save_summary(&db, "user", &job.id, &input(), &id).unwrap();
    assert_eq!(record.id, replay.id);
    assert_eq!(list_records(&db, "user", 50).unwrap().len(), 1);
    assert!(search(&db, "other", "결론", 10).unwrap().is_empty());
    assert!(read_sources(&db, "other", &[source.id]).is_err());
    let mut different = input();
    different.summary = "다른 요청".into();
    assert!(save_summary(&db, "user", &job.id, &different, &id).is_err());
    undo_record(&db, "user", &record.id).unwrap();
    assert!(save_summary(&db, "user", &job.id, &input(), &id).is_err());
    assert!(search(&db, "user", "결론", 10).unwrap().is_empty());
}

#[test]
fn long_unicode_sources_resume_chunks_without_duplicate_generation() {
    let db = database();
    enabled(&db);
    let original = "한글🙂".repeat(5_000);
    let source = source(&db, &original, true);
    let first = claim_job(&db, "user", now()).unwrap().unwrap();
    assert_eq!(first.chunk_count, 3);
    assert_eq!(first.content.chars().count(), CHUNK_CHARS);
    initialize(&db).unwrap();
    let retried = claim_job(&db, "user", now()).unwrap().unwrap();
    assert_eq!(first.id, retried.id);
    save_summary(
        &db,
        "user",
        &retried.id,
        &input(),
        &uuid::Uuid::new_v4().to_string(),
    )
    .unwrap();
    let next = claim_job(&db, "user", now()).unwrap().unwrap();
    assert_eq!(next.chunk_index, 1);
    let changed = put_source(
        &db,
        "user",
        "comet",
        "project",
        "note",
        "note-1",
        "회의 원문",
        "정정한 내용",
        true,
    )
    .unwrap();
    assert_eq!(source.id, changed.id);
    assert!(save_summary(
        &db,
        "user",
        &next.id,
        &input(),
        &uuid::Uuid::new_v4().to_string()
    )
    .is_err());
    let latest = claim_job(&db, "user", now()).unwrap().unwrap();
    assert_eq!(latest.content, "정정한 내용");
}

fn connected(db: &Connection) -> (tempfile::TempDir, VaultConnection) {
    let temp = tempfile::tempdir().unwrap();
    fs::create_dir(temp.path().join("projects")).unwrap();
    fs::write(
        temp.path().join("projects/work.md"),
        "# 원본 회의\n\n승인 대기 중.\n- [ ] 원래 할 일\n",
    )
    .unwrap();
    let vault = connect_vault(db, "user", temp.path(), &[], &[], "Comet", true).unwrap();
    (temp, vault)
}

#[test]
fn vault_scans_exclude_private_operational_archive_and_generated_documents() {
    let db = database();
    enabled(&db);
    let (temp, vault) = connected(&db);
    let original = fs::read(temp.path().join("projects/work.md")).unwrap();
    fs::write(temp.path().join("INDEX.md"), "사용자 목차").unwrap();
    for directory in [
        "03.diary",
        "90.private",
        "99.deprecated",
        ".git",
        "ai-shared",
        "node_modules",
    ] {
        fs::create_dir(temp.path().join(directory)).unwrap();
        fs::write(
            temp.path().join(directory).join("hidden.md"),
            "private boundary",
        )
        .unwrap();
    }
    fs::write(
        temp.path().join("archived.md"),
        "---\nstatus: archived\n---\n과거 문서",
    )
    .unwrap();
    fs::write(temp.path().join("AGENTS.md"), "instructions").unwrap();
    let scan = scan_vault(&db, "user", &vault.id, &AtomicBool::new(false)).unwrap();
    assert_eq!(scan.scanned, 2);
    let target = search(&db, "user", "승인", 10).unwrap().remove(0);
    let job = claim_source_job(&db, "user", &target.source.id, now())
        .unwrap()
        .unwrap();
    let record = save_summary(
        &db,
        "user",
        &job.id,
        &input(),
        &uuid::Uuid::new_v4().to_string(),
    )
    .unwrap();
    assert_eq!(
        fs::read(temp.path().join("projects/work.md")).unwrap(),
        original
    );
    assert_eq!(
        fs::read_to_string(temp.path().join("INDEX.md")).unwrap(),
        "사용자 목차"
    );
    let output = fs::read_to_string(record.output_path.as_ref().unwrap()).unwrap();
    assert!(!output.lines().any(|line| line.starts_with("- [ ]")));
    assert!(output.contains("\\[ \\]"));
    assert!(!search(&db, "user", "결론", 10).unwrap().is_empty());
    let again = scan_vault(&db, "user", &vault.id, &AtomicBool::new(false)).unwrap();
    assert_eq!(again.scanned, 2);
    assert_eq!(again.changed, 0);
    assert!(search(&db, "user", "private", 10).unwrap().is_empty());
}

#[test]
fn file_changes_during_generation_and_changed_outputs_are_not_overwritten() {
    let db = database();
    enabled(&db);
    let (temp, vault) = connected(&db);
    scan_vault(&db, "user", &vault.id, &AtomicBool::new(false)).unwrap();
    let job = claim_job(&db, "user", now()).unwrap().unwrap();
    fs::write(temp.path().join("projects/work.md"), "새 원문").unwrap();
    assert!(save_summary(
        &db,
        "user",
        &job.id,
        &input(),
        &uuid::Uuid::new_v4().to_string()
    )
    .is_err());
    assert!(!temp.path().join("Comet").exists());
    scan_vault(&db, "user", &vault.id, &AtomicBool::new(false)).unwrap();
    let job = claim_job(&db, "user", now()).unwrap().unwrap();
    let record = save_summary(
        &db,
        "user",
        &job.id,
        &input(),
        &uuid::Uuid::new_v4().to_string(),
    )
    .unwrap();
    fs::write(record.output_path.as_ref().unwrap(), "사용자가 고친 내용").unwrap();
    assert!(undo_record(&db, "user", &record.id).is_err());
    assert_eq!(
        fs::read_to_string(record.output_path.unwrap()).unwrap(),
        "사용자가 고친 내용"
    );
    assert_eq!(list_records(&db, "user", 10).unwrap()[0].state, "saved");
}

#[test]
fn committed_file_recovers_after_database_failure_and_undo_does_not_resurrect_it() {
    let db = database();
    enabled(&db);
    let (temp, vault) = connected(&db);
    scan_vault(&db, "user", &vault.id, &AtomicBool::new(false)).unwrap();
    let job = claim_job(&db, "user", now()).unwrap().unwrap();
    let operation = uuid::Uuid::new_v4().to_string();
    db.execute_batch("CREATE TRIGGER fail_record BEFORE INSERT ON organizer_records BEGIN SELECT RAISE(ABORT,'fixture failure'); END;").unwrap();
    assert!(save_summary(&db, "user", &job.id, &input(), &operation).is_err());
    let path = temp.path().join("Comet").join(format!("{operation}.md"));
    assert!(path.is_file());
    db.execute_batch("DROP TRIGGER fail_record;").unwrap();
    initialize(&db).unwrap();
    assert_eq!(recover_operations(&db, "user").unwrap(), 1);
    assert_eq!(recover_operations(&db, "user").unwrap(), 0);
    assert_eq!(list_records(&db, "user", 10).unwrap().len(), 1);
    undo_record(&db, "user", &operation).unwrap();
    assert!(!path.exists());
    assert_eq!(recover_operations(&db, "user").unwrap(), 0);
    assert!(claim_job(&db, "user", now()).unwrap().is_none());
}

#[test]
fn edited_prepared_output_has_durable_conflict_and_recovers_only_after_explicit_retry() {
    let storage = tempfile::tempdir().unwrap();
    let database_path = storage.path().join("organizer.sqlite");
    let db = Connection::open(&database_path).unwrap();
    initialize(&db).unwrap();
    enabled(&db);
    let (temp, vault) = connected(&db);
    scan_vault(&db, "user", &vault.id, &AtomicBool::new(false)).unwrap();
    let job = claim_job(&db, "user", now()).unwrap().unwrap();
    let operation = uuid::Uuid::new_v4().to_string();
    db.execute_batch("CREATE TRIGGER fail_record BEFORE INSERT ON organizer_records BEGIN SELECT RAISE(ABORT,'fixture failure'); END;").unwrap();
    assert!(save_summary(&db, "user", &job.id, &input(), &operation).is_err());
    db.execute_batch("DROP TRIGGER fail_record;").unwrap();
    let path = temp.path().join("Comet").join(format!("{operation}.md"));
    let original = fs::read_to_string(&path).unwrap();
    let index_path = temp.path().join("Comet/INDEX.md");
    let index = fs::read(&index_path).unwrap();
    fs::write(&path, "사용자가 복구 전에 고친 내용").unwrap();
    initialize(&db).unwrap();
    assert_eq!(recover_operations(&db, "user").unwrap(), 0);
    assert!(!has_incomplete_operations(&db, "user").unwrap());
    drop(db);

    let db = Connection::open(&database_path).unwrap();
    initialize(&db).unwrap();
    let progress = status(&db, "user", "2026-10-11").unwrap();
    assert_eq!(progress.pending, 0);
    assert_eq!(progress.deferred, 1);
    assert!(progress.latest_error.unwrap().contains("파일이 변경되어"));
    let operation_state: String = db
        .query_row(
            "SELECT state FROM organizer_operations WHERE id=?1",
            [&operation],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(operation_state, "conflict");
    assert!(claim_source_job(&db, "user", &job.source.id, now())
        .unwrap()
        .is_none());
    assert!(status(&db, "user", "2026-10-11")
        .unwrap()
        .latest_error
        .is_some());
    assert!(save_summary(&db, "user", &job.id, &input(), &operation)
        .unwrap_err()
        .contains("충돌"));
    assert_eq!(retry_deferred(&db, "other").unwrap(), 0);
    assert_eq!(retry_deferred(&db, "user").unwrap(), 1);
    assert!(has_incomplete_operations(&db, "user").unwrap());
    assert!(claim_job(&db, "user", now()).unwrap().is_none());
    assert_eq!(recover_operations(&db, "user").unwrap(), 0);
    assert_eq!(
        fs::read_to_string(&path).unwrap(),
        "사용자가 복구 전에 고친 내용"
    );
    assert_eq!(fs::read(&index_path).unwrap(), index);
    assert!(list_records(&db, "user", 10).unwrap().is_empty());

    fs::write(&path, &original).unwrap();
    assert_eq!(recover_operations(&db, "user").unwrap(), 0);
    assert_eq!(retry_deferred(&db, "user").unwrap(), 1);
    assert_eq!(recover_operations(&db, "user").unwrap(), 1);
    assert_eq!(fs::read_to_string(&path).unwrap(), original);
    assert_eq!(list_records(&db, "user", 10).unwrap()[0].id, operation);
    assert!(status(&db, "user", "2026-10-11")
        .unwrap()
        .latest_error
        .is_none());
    assert!(claim_job(&db, "user", now()).unwrap().is_none());
}

#[test]
fn disconnect_and_removed_sources_revoke_search_and_pending_jobs() {
    let db = database();
    enabled(&db);
    let (temp, vault) = connected(&db);
    scan_vault(&db, "user", &vault.id, &AtomicBool::new(false)).unwrap();
    let source = search(&db, "user", "승인", 10).unwrap().remove(0).source;
    let cancelled = scan_vault(&db, "user", &vault.id, &AtomicBool::new(true)).unwrap();
    assert!(cancelled.cancelled);
    assert!(!read_sources(&db, "user", std::slice::from_ref(&source.id))
        .unwrap()
        .is_empty());
    fs::remove_file(temp.path().join("projects/work.md")).unwrap();
    scan_vault(&db, "user", &vault.id, &AtomicBool::new(false)).unwrap();
    assert!(read_sources(&db, "user", &[source.id]).is_err());
    assert!(claim_job(&db, "user", now()).unwrap().is_none());
    fs::write(temp.path().join("projects/new.md"), "새로운 원문").unwrap();
    scan_vault(&db, "user", &vault.id, &AtomicBool::new(false)).unwrap();
    disconnect_vault(&db, "user", &vault.id).unwrap();
    assert!(search(&db, "user", "새로운", 10).unwrap().is_empty());
    assert!(claim_job(&db, "user", now()).unwrap().is_none());
}

#[test]
fn existing_output_folder_documents_and_parent_traversal_are_preserved() {
    let db = database();
    enabled(&db);
    let (temp, vault) = connected(&db);
    for invalid in [
        "../outside",
        "/absolute",
        "Comet/../original",
        "Comet\\file",
    ] {
        assert!(connect_vault(&db, "other", temp.path(), &[], &[], invalid, true).is_err());
    }
    fs::create_dir(temp.path().join("Comet")).unwrap();
    fs::write(temp.path().join("Comet/existing.md"), "사용자 원본").unwrap();
    scan_vault(&db, "user", &vault.id, &AtomicBool::new(false)).unwrap();
    let job = claim_job(&db, "user", now()).unwrap().unwrap();
    assert!(save_summary(
        &db,
        "user",
        &job.id,
        &input(),
        &uuid::Uuid::new_v4().to_string()
    )
    .is_err());
    assert_eq!(
        fs::read_to_string(temp.path().join("Comet/existing.md")).unwrap(),
        "사용자 원본"
    );
    assert!(!temp.path().join("Comet/INDEX.md").exists());
}

#[cfg(unix)]
#[test]
fn symlink_sources_and_output_parents_never_escape_the_selected_vault() {
    use std::os::unix::fs::symlink;
    let db = database();
    enabled(&db);
    let (temp, vault) = connected(&db);
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("secret.md"), "밖의 비밀").unwrap();
    symlink(
        outside.path().join("secret.md"),
        temp.path().join("link.md"),
    )
    .unwrap();
    symlink(outside.path(), temp.path().join("linked")).unwrap();
    scan_vault(&db, "user", &vault.id, &AtomicBool::new(false)).unwrap();
    assert!(search(&db, "user", "비밀", 10).unwrap().is_empty());
    symlink(outside.path(), temp.path().join("Comet")).unwrap();
    let job = claim_job(&db, "user", now()).unwrap().unwrap();
    assert!(save_summary(
        &db,
        "user",
        &job.id,
        &input(),
        &uuid::Uuid::new_v4().to_string()
    )
    .is_err());
    assert_eq!(fs::read_dir(outside.path()).unwrap().count(), 1);
}

#[test]
fn daily_budget_is_durable_and_owner_scoped() {
    let db = database();
    assert!(reserve_request(&db, "user", "2026-10-11", 1).unwrap());
    initialize(&db).unwrap();
    assert!(!reserve_request(&db, "user", "2026-10-11", 1).unwrap());
    assert!(reserve_request(&db, "other", "2026-10-11", 1).unwrap());
    assert_eq!(status(&db, "user", "2026-10-11").unwrap().requests_today, 1);
}

#[test]
fn model_call_budget_survives_restart_and_only_explicit_retry_resets_it() {
    let db = database();
    enabled(&db);
    source(&db, "정리할 내용", true);
    let job = claim_job(&db, "user", now()).unwrap().unwrap();
    assert!(!reserve_job_call(&db, "other", &job.id).unwrap());
    for _ in 0..2 {
        assert!(reserve_job_call(&db, "user", &job.id).unwrap());
    }
    cancel_running(&db, "user").unwrap();
    initialize(&db).unwrap();
    let resumed = claim_job(&db, "user", now()).unwrap().unwrap();
    assert_eq!(resumed.id, job.id);
    for _ in 0..2 {
        assert!(reserve_job_call(&db, "user", &job.id).unwrap());
    }
    assert!(!reserve_job_call(&db, "user", &job.id).unwrap());
    defer_job(&db, "user", &job.id, "형식 재시도 소진", None).unwrap();
    assert_eq!(retry_deferred(&db, "user").unwrap(), 1);
    let retried = claim_job(&db, "user", now()).unwrap().unwrap();
    assert_eq!(retried.id, job.id);
    assert!(reserve_job_call(&db, "user", &job.id).unwrap());
}

#[test]
fn manual_run_only_enqueues_opted_sources_and_preserves_completed_hashes() {
    let db = database();
    let comet = source(&db, "Comet 원문", false);
    let (temp, vault) = connected(&db);
    connect_vault(&db, "user", temp.path(), &[], &[], "Comet", false).unwrap();
    scan_vault(&db, "user", &vault.id, &AtomicBool::new(false)).unwrap();
    assert!(claim_manual_job(&db, "user", now()).unwrap().is_none());
    assert_eq!(enqueue_manual_jobs(&db, "user").unwrap(), 1);
    assert!(claim_job(&db, "user", now()).unwrap().is_none());
    let job = claim_manual_job(&db, "user", now()).unwrap().unwrap();
    assert_eq!(job.source.kind, "vault");
    save_summary(
        &db,
        "user",
        &job.id,
        &input(),
        &uuid::Uuid::new_v4().to_string(),
    )
    .unwrap();
    enqueue_manual_jobs(&db, "user").unwrap();
    assert!(claim_manual_job(&db, "user", now()).unwrap().is_none());
    enabled(&db);
    enqueue_manual_jobs(&db, "user").unwrap();
    assert_eq!(
        claim_manual_job(&db, "user", now())
            .unwrap()
            .unwrap()
            .source
            .id,
        comet.id
    );
}

#[test]
fn explicit_run_releases_cancel_backoff_without_resetting_call_or_daily_budgets() {
    let db = database();
    enabled(&db);
    let source = source(&db, "취소 재개 검증", true);
    let job = claim_job(&db, "user", now()).unwrap().unwrap();
    assert!(reserve_job_call(&db, "user", &job.id).unwrap());
    assert!(reserve_request(&db, "user", "2026-10-11", 1).unwrap());
    defer_job(&db, "user", &job.id, "취소됨", Some(now() + 300_000)).unwrap();
    assert!(claim_manual_job(&db, "user", now()).unwrap().is_none());
    assert!(status(&db, "user", "2026-10-11")
        .unwrap()
        .latest_error
        .unwrap()
        .contains("지금 정리"));
    assert!(status(&db, "other", "2026-10-11")
        .unwrap()
        .latest_error
        .is_none());

    enqueue_manual_jobs(&db, "user").unwrap();
    assert!(status(&db, "user", "2026-10-11")
        .unwrap()
        .latest_error
        .is_none());
    let resumed = claim_manual_job(&db, "user", now()).unwrap().unwrap();
    assert_eq!(resumed.id, job.id);
    for _ in 0..3 {
        assert!(reserve_job_call(&db, "user", &job.id).unwrap());
    }
    assert!(!reserve_job_call(&db, "user", &job.id).unwrap());
    assert!(!reserve_request(&db, "user", "2026-10-11", 1).unwrap());

    defer_job(&db, "user", &job.id, "취소됨", Some(now() + 300_000)).unwrap();
    let explicit = claim_source_job(&db, "user", &source.id, now())
        .unwrap()
        .unwrap();
    assert_eq!(explicit.id, job.id);
    assert!(!reserve_job_call(&db, "user", &job.id).unwrap());
}

#[test]
fn cached_vault_content_cannot_be_claimed_or_searched_after_edit_or_scope_revocation() {
    let db = database();
    enabled(&db);
    let (temp, vault) = connected(&db);
    scan_vault(&db, "user", &vault.id, &AtomicBool::new(false)).unwrap();
    fs::write(temp.path().join("projects/work.md"), "바뀐 원문").unwrap();
    assert!(claim_job(&db, "user", now()).unwrap().is_none());
    assert!(search(&db, "user", "승인", 10).unwrap().is_empty());
    scan_vault(&db, "user", &vault.id, &AtomicBool::new(false)).unwrap();
    connect_vault(
        &db,
        "user",
        temp.path(),
        &["unrelated".into()],
        &[],
        "Comet",
        true,
    )
    .unwrap();
    // Simulate a scan that began before the connection's scope was narrowed.
    let stale = put_source(
        &db,
        "user",
        &vault.id,
        "projects",
        "vault",
        "projects/work.md",
        "원문",
        "바뀐 원문",
        true,
    )
    .unwrap();
    assert!(read_sources(&db, "user", &[stale.id]).is_err());
    assert!(search(&db, "user", "바뀐", 10).unwrap().is_empty());
    assert!(claim_job(&db, "user", now()).unwrap().is_none());
}

#[test]
fn operation_identifier_cannot_be_reused_by_another_user() {
    let db = database();
    let own = source(&db, "원문", false);
    let job = claim_source_job(&db, "user", &own.id, now())
        .unwrap()
        .unwrap();
    let operation = uuid::Uuid::new_v4().to_string();
    save_summary(&db, "user", &job.id, &input(), &operation).unwrap();
    let other = put_source(
        &db,
        "other",
        "comet",
        "project",
        "note",
        "note-1",
        "다른 원문",
        "다른 사용자",
        false,
    )
    .unwrap();
    let other_job = claim_source_job(&db, "other", &other.id, now())
        .unwrap()
        .unwrap();
    assert!(save_summary(&db, "other", &other_job.id, &input(), &operation).is_err());
    assert!(list_records(&db, "other", 10).unwrap().is_empty());
    assert_eq!(list_records(&db, "user", 10).unwrap().len(), 1);
}

#[test]
fn legacy_jobs_migrate_to_versioned_keys_without_losing_work() {
    let db = Connection::open_in_memory().unwrap();
    db.execute_batch("CREATE TABLE organizer_jobs(id TEXT PRIMARY KEY,source_id TEXT NOT NULL,source_hash TEXT NOT NULL,chunk_index INTEGER NOT NULL,chunk_count INTEGER NOT NULL,content TEXT NOT NULL,state TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,reason TEXT,next_at INTEGER NOT NULL DEFAULT 0,priority INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,UNIQUE(source_id,source_hash,chunk_index));
INSERT INTO organizer_jobs(id,source_id,source_hash,chunk_index,chunk_count,content,state,created_at) VALUES('fixture','source','hash',0,1,'original','running',1);").unwrap();
    initialize(&db).unwrap();
    let (state, version, calls) = db
        .query_row(
            "SELECT state,organizer_version,model_calls FROM organizer_jobs WHERE id='fixture'",
            [],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, u32>(1)?,
                    row.get::<_, u32>(2)?,
                ))
            },
        )
        .unwrap();
    assert_eq!(
        (state, version, calls),
        ("pending".into(), ORGANIZER_VERSION, 0)
    );
    db.execute("INSERT INTO organizer_jobs(id,source_id,source_hash,chunk_index,chunk_count,content,state,created_at,organizer_version) VALUES('fixture-v2','source','hash',0,1,'original','pending',1,?1)",[ORGANIZER_VERSION+1]).unwrap();
    initialize(&db).unwrap();
    assert_eq!(
        db.query_row("SELECT count(*) FROM organizer_jobs", [], |row| row
            .get::<_, u32>(0))
            .unwrap(),
        2
    );
}

#[test]
fn generated_outputs_are_excluded_when_another_connection_chooses_a_different_folder() {
    let db = database();
    enabled(&db);
    let (temp, vault) = connected(&db);
    scan_vault(&db, "user", &vault.id, &AtomicBool::new(false)).unwrap();
    let job = claim_job(&db, "user", now()).unwrap().unwrap();
    save_summary(
        &db,
        "user",
        &job.id,
        &input(),
        &uuid::Uuid::new_v4().to_string(),
    )
    .unwrap();
    let other = connect_vault(&db, "other", temp.path(), &[], &[], "OtherComet", true).unwrap();
    let scan = scan_vault(&db, "other", &other.id, &AtomicBool::new(false)).unwrap();
    assert_eq!(scan.scanned, 1);
    assert!(search(&db, "other", "결론", 10).unwrap().is_empty());
    let nested = connect_vault(
        &db,
        "other",
        &temp.path().join("Comet"),
        &[],
        &[],
        "NestedComet",
        true,
    )
    .unwrap();
    assert_eq!(
        scan_vault(&db, "other", &nested.id, &AtomicBool::new(false))
            .unwrap()
            .scanned,
        0
    );
}

#[test]
fn session_open_recovers_only_current_users_explicit_summary_with_automatic_off() {
    let directory = tempfile::tempdir().unwrap();
    let database_path = directory.path().join("comet.sqlite");
    let vault_path = directory.path().join("vault");
    fs::create_dir(&vault_path).unwrap();
    fs::write(
        vault_path.join("meeting.md"),
        "# 복구 원문\n저장할 합성 내용",
    )
    .unwrap();
    let db = crate::app::open_session(&database_path).unwrap();
    let user = crate::store::active_user_id(&db).unwrap();
    assert!(!get_settings(&db, &user).unwrap().enabled);
    let vault = connect_vault(&db, &user, &vault_path, &[], &[], "Comet", false).unwrap();
    scan_vault(&db, &user, &vault.id, &AtomicBool::new(false)).unwrap();
    let own = search(&db, &user, "복구", 1).unwrap().remove(0).source;
    let job = claim_source_job(&db, &user, &own.id, now())
        .unwrap()
        .unwrap();
    let other = put_source(
        &db,
        "other",
        "comet",
        "",
        "note",
        "fixture",
        "다른 사용자",
        "복구하면 안 되는 기록",
        false,
    )
    .unwrap();
    let other_job = claim_source_job(&db, "other", &other.id, now())
        .unwrap()
        .unwrap();
    db.execute_batch("CREATE TRIGGER fail_record BEFORE INSERT ON organizer_records BEGIN SELECT RAISE(ABORT,'fixture failure'); END;").unwrap();
    let operation = uuid::Uuid::new_v4().to_string();
    assert!(save_summary(&db, &user, &job.id, &input(), &operation).is_err());
    assert!(save_summary(
        &db,
        "other",
        &other_job.id,
        &input(),
        &uuid::Uuid::new_v4().to_string()
    )
    .is_err());
    db.execute_batch("DROP TRIGGER fail_record;").unwrap();
    assert!(has_incomplete_operations(&db, &user).unwrap());
    drop(db);

    let reopened = crate::app::open_session(&database_path).unwrap();
    assert!(!get_settings(&reopened, &user).unwrap().enabled);
    assert!(!has_incomplete_operations(&reopened, &user).unwrap());
    assert!(has_incomplete_operations(&reopened, "other").unwrap());
    assert_eq!(list_records(&reopened, &user, 10).unwrap()[0].id, operation);
    assert!(list_records(&reopened, "other", 10).unwrap().is_empty());
    assert_eq!(
        fs::read_to_string(vault_path.join("meeting.md")).unwrap(),
        "# 복구 원문\n저장할 합성 내용"
    );
    assert_eq!(
        status(&reopened, &user, "2026-10-11")
            .unwrap()
            .requests_today,
        0
    );
}

#[test]
fn partial_scan_warns_only_for_unreadable_allowed_documents_and_keeps_valid_work() {
    let db = database();
    enabled(&db);
    let (temp, vault) = connected(&db);
    fs::create_dir(temp.path().join("03.diary")).unwrap();
    fs::write(temp.path().join("03.diary/private.md"), [0xff]).unwrap();
    fs::write(
        temp.path().join("archived.md"),
        "---\nstatus: archived\n---\n의도적으로 제외",
    )
    .unwrap();
    fs::write(temp.path().join("invalid.md"), [0xff]).unwrap();
    let large = fs::File::create(temp.path().join("large.md")).unwrap();
    large.set_len(MAX_SOURCE_BYTES + 1).unwrap();
    let report = scan_vault(&db, "user", &vault.id, &AtomicBool::new(false)).unwrap();
    assert_eq!(report.scanned, 1);
    let warning = status(&db, "user", "2026-10-11")
        .unwrap()
        .latest_error
        .unwrap();
    assert!(warning.starts_with("2개 원문"));
    assert!(!warning.contains("private") && !warning.contains("invalid.md"));
    assert!(warning.contains("읽은 자료는 계속 정리"));
    assert!(claim_job(&db, "user", now()).unwrap().is_some());
    assert!(status(&db, "other", "2026-10-11")
        .unwrap()
        .latest_error
        .is_none());
    fs::remove_file(temp.path().join("invalid.md")).unwrap();
    fs::remove_file(temp.path().join("large.md")).unwrap();
    scan_vault(&db, "user", &vault.id, &AtomicBool::new(true)).unwrap();
    assert!(status(&db, "user", "2026-10-11")
        .unwrap()
        .latest_error
        .is_some());
    scan_vault(&db, "user", &vault.id, &AtomicBool::new(false)).unwrap();
    assert!(status(&db, "user", "2026-10-11")
        .unwrap()
        .latest_error
        .is_none());
}
