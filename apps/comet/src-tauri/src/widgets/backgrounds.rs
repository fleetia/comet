use crate::character_sprites;
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;

pub(crate) const EXTENSIONS: [&str; 6] = ["svg", "png", "gif", "webp", "jpg", "jpeg"];
const MAX_BYTES: usize = 2 * 1024 * 1024;

type Result<T> = std::result::Result<T, String>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct BackgroundInfo {
    pub mime: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Background {
    pub mime: String,
    pub data: Vec<u8>,
}

fn error(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn validate(bytes: &[u8]) -> Result<&'static str> {
    if bytes.is_empty() || bytes.len() > MAX_BYTES {
        return Err("배경 이미지는 1바이트 이상 2MiB 이하여야 해요.".into());
    }
    character_sprites::detect_mime(bytes)
        .ok_or_else(|| "SVG·PNG·GIF·WebP·JPEG 이미지만 사용할 수 있어요.".into())
}

pub(crate) fn initialize(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS widget_backgrounds(
widget_id TEXT PRIMARY KEY,mime TEXT NOT NULL,data BLOB NOT NULL,updated INTEGER NOT NULL);",
    )
    .map_err(error)
}

pub(crate) fn info(conn: &Connection, widget_id: &str) -> Result<Option<BackgroundInfo>> {
    conn.query_row(
        "SELECT mime,updated FROM widget_backgrounds WHERE widget_id=?",
        [widget_id],
        |row| {
            Ok(BackgroundInfo {
                mime: row.get(0)?,
                updated_at: row.get(1)?,
            })
        },
    )
    .optional()
    .map_err(error)
}

pub(crate) fn get(conn: &Connection, widget_id: &str) -> Result<Option<Background>> {
    conn.query_row(
        "SELECT mime,data FROM widget_backgrounds WHERE widget_id=?",
        [widget_id],
        |row| {
            Ok(Background {
                mime: row.get(0)?,
                data: row.get(1)?,
            })
        },
    )
    .optional()
    .map_err(error)
}

pub(crate) fn put(conn: &Connection, widget_id: &str, bytes: &[u8]) -> Result<()> {
    let mime = validate(bytes)?;
    let now = chrono::Utc::now().timestamp_millis();
    let updated = info(conn, widget_id)?
        .map(|background| now.max(background.updated_at.saturating_add(1)))
        .unwrap_or(now);
    conn.execute(
        "INSERT INTO widget_backgrounds(widget_id,mime,data,updated) VALUES(?1,?2,?3,?4)
ON CONFLICT(widget_id) DO UPDATE SET mime=excluded.mime,data=excluded.data,updated=excluded.updated",
        params![widget_id, mime, bytes, updated],
    )
    .map_err(error)?;
    Ok(())
}

pub(crate) fn remove(conn: &Connection, widget_id: &str) -> Result<bool> {
    Ok(conn
        .execute(
            "DELETE FROM widget_backgrounds WHERE widget_id=?",
            [widget_id],
        )
        .map_err(error)?
        > 0)
}

pub(crate) fn read_file(path: &Path) -> Result<Vec<u8>> {
    let bytes = std::fs::read(path).map_err(error)?;
    validate(&bytes)?;
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database() -> Connection {
        let db = Connection::open_in_memory().unwrap();
        initialize(&db).unwrap();
        db
    }

    #[test]
    fn stores_and_removes_valid_backgrounds() {
        let db = database();
        let png = b"\x89PNG\r\n\x1a\n";
        put(&db, "widget", png).unwrap();
        assert_eq!(get(&db, "widget").unwrap().unwrap().mime, "image/png");
        let first_updated = info(&db, "widget").unwrap().unwrap().updated_at;
        assert!(first_updated > 0);
        put(&db, "widget", png).unwrap();
        assert!(info(&db, "widget").unwrap().unwrap().updated_at > first_updated);
        assert!(remove(&db, "widget").unwrap());
        assert!(get(&db, "widget").unwrap().is_none());
    }

    #[test]
    fn rejects_unsupported_or_oversized_backgrounds() {
        assert!(validate(b"not an image").is_err());
        assert!(validate(&vec![0; MAX_BYTES + 1]).is_err());
    }
}
