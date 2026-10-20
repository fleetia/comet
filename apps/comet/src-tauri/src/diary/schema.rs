use rusqlite::{Connection, OptionalExtension};

pub(crate) fn initialize(db: &Connection) -> Result<(), String> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS diary_state(id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);",
    )
    .map_err(|error| error.to_string())?;
    db.execute(
        "INSERT OR IGNORE INTO diary_state(id,data) VALUES(1,?1)",
        [serde_json::json!({ "revision": 0, "pages": [], "notes": [], "moves": [] }).to_string()],
    )
    .map_err(|error| error.to_string())?;
    super::runtime::initialize(db)?;
    migrate_travel_shares(db)
}

/// Explicit, once-only startup migration. Ordinary diary reads never rewrite saved history.
fn migrate_travel_shares(db: &Connection) -> Result<(), String> {
    let tx = db.unchecked_transaction().map_err(super::err)?;
    let migrated: Option<String> = tx
        .query_row(
            "SELECT value FROM diary_runtime WHERE key='travel-split-allocation-v1'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(super::err)?;
    if migrated.is_some() {
        return Ok(());
    }
    let mut state = super::read(&tx)?;
    if super::travel::reconcile_split_rounding(&mut state) {
        state.revision = state
            .revision
            .checked_add(1)
            .ok_or("다이어리 버전 범위를 벗어났습니다.")?;
        tx.execute(
            "UPDATE diary_state SET data=?1 WHERE id=1",
            [serde_json::to_string(&state).map_err(super::err)?],
        )
        .map_err(super::err)?;
    }
    tx.execute(
        "INSERT INTO diary_runtime(key,value) VALUES('travel-split-allocation-v1','1')",
        [],
    )
    .map_err(super::err)?;
    tx.commit().map_err(super::err)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn legacy(db: &Connection, revision: u64) {
        db.execute_batch("CREATE TABLE diary_state(id INTEGER PRIMARY KEY, data TEXT NOT NULL);")
            .unwrap();
        let state = json!({
            "revision": revision, "pages": [], "notes": [], "moves": [],
            "travelExpenses": [{
                "id": "e", "travelId": "trip", "title": "비용", "date": "2026-10-24",
                "amount": 101, "currency": "KRW", "rate": 10000, "category": "food",
                "paid": true, "payer": "me", "memo": "",
                "shares": [{"person": "me", "weight": 1}, {"person": "a", "weight": 1}],
                "ledgerEntryId": "entry"
            }],
            "ledgerEntries": [{
                "id": "entry", "date": "2026-10-24", "kind": "expense", "amount": 51,
                "category": "food", "title": "비용", "memo": "보존"
            }]
        });
        db.execute(
            "INSERT INTO diary_state(id,data) VALUES(1,?1)",
            [state.to_string()],
        )
        .unwrap();
    }

    #[test]
    fn startup_reconciles_once_and_read_does_not_rewrite_history() {
        let db = Connection::open_in_memory().unwrap();
        legacy(&db, 7);
        assert_eq!(
            super::super::read(&db).unwrap().ledger_entries[0].amount,
            51
        );
        initialize(&db).unwrap();
        let mut state = super::super::read(&db).unwrap();
        assert_eq!(state.ledger_entries[0].amount, 50);
        assert_eq!(state.revision, 8);
        state.ledger_entries[0].amount = 51;
        let manual = serde_json::to_string(&state).unwrap();
        db.execute("UPDATE diary_state SET data=?1 WHERE id=1", [&manual])
            .unwrap();
        initialize(&db).unwrap();
        assert_eq!(super::super::read(&db).unwrap(), state);
        let raw: String = db
            .query_row("SELECT data FROM diary_state WHERE id=1", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(raw, manual);
    }

    #[test]
    fn failed_migration_does_not_save_a_partial_amount_or_completion_marker() {
        let db = Connection::open_in_memory().unwrap();
        legacy(&db, u64::MAX);
        assert!(initialize(&db).is_err());
        assert_eq!(
            super::super::read(&db).unwrap().ledger_entries[0].amount,
            51
        );
        let markers: u64 = db
            .query_row(
                "SELECT count(*) FROM diary_runtime WHERE key='travel-split-allocation-v1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(markers, 0);
    }

    #[test]
    fn marker_failure_rolls_back_amount_revision_and_can_retry() {
        let db = Connection::open_in_memory().unwrap();
        legacy(&db, 7);
        super::super::runtime::initialize(&db).unwrap();
        db.execute_batch("CREATE TRIGGER fail_split_marker BEFORE INSERT ON diary_runtime WHEN NEW.key='travel-split-allocation-v1' BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;").unwrap();
        let before = super::super::read(&db).unwrap();
        assert!(initialize(&db).is_err());
        assert_eq!(super::super::read(&db).unwrap(), before);
        db.execute_batch("DROP TRIGGER fail_split_marker;").unwrap();
        initialize(&db).unwrap();
        let after = super::super::read(&db).unwrap();
        assert_eq!(after.ledger_entries[0].amount, 50);
        assert_eq!(after.revision, 8);
    }

    #[test]
    fn fresh_diary_needs_no_revision_change() {
        let db = Connection::open_in_memory().unwrap();
        initialize(&db).unwrap();
        assert_eq!(super::super::read(&db).unwrap().revision, 0);
        initialize(&db).unwrap();
        assert_eq!(super::super::read(&db).unwrap().revision, 0);
    }
}
