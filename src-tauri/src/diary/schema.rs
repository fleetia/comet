use rusqlite::Connection;

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
    Ok(())
}
