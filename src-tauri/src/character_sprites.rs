use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

type Result<T> = std::result::Result<T, String>;
pub const MAX_SPRITE_BYTES: usize = 2 * 1024 * 1024;
pub const SPRITE_EXTENSIONS: [&str; 6] = ["svg", "png", "gif", "webp", "jpg", "jpeg"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SpriteInfo {
    pub mime: String,
    pub updated_at: i64,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sprite {
    pub mime: String,
    pub data: Vec<u8>,
}

pub fn detect_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some("image/png");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some("image/gif");
    }
    if bytes.starts_with(b"\xFF\xD8\xFF") {
        return Some("image/jpeg");
    }
    if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    let limit = bytes.len().min(4096);
    let head = match std::str::from_utf8(&bytes[..limit]) {
        Ok(text) => text,
        Err(error) if error.error_len().is_none() => {
            std::str::from_utf8(&bytes[..error.valid_up_to()]).unwrap_or("")
        }
        Err(_) => return None,
    };
    let trimmed = head.trim_start_matches('\u{feff}').trim_start();
    if trimmed.starts_with('<') && trimmed.to_ascii_lowercase().contains("<svg") {
        return Some("image/svg+xml");
    }
    None
}

pub fn validate(bytes: &[u8]) -> Result<&'static str> {
    if bytes.is_empty() || bytes.len() > MAX_SPRITE_BYTES {
        return Err("표정 이미지는 1 바이트 이상 2 MiB 이하여야 합니다.".into());
    }
    detect_mime(bytes).ok_or_else(|| "SVG·PNG·GIF·WebP·JPEG 이미지만 사용할 수 있습니다.".into())
}

pub fn initialize(conn: &Connection) -> Result<()> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS character_sprites(character_id TEXT NOT NULL,expression TEXT NOT NULL,mime TEXT NOT NULL,data BLOB NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(character_id,expression));").map_err(|e| e.to_string())
}

pub fn list(conn: &Connection, character_id: &str) -> Result<BTreeMap<String, SpriteInfo>> {
    let mut statement = conn
        .prepare("SELECT expression,mime,updated FROM character_sprites WHERE character_id=?")
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([character_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                SpriteInfo {
                    mime: r.get(1)?,
                    updated_at: r.get(2)?,
                },
            ))
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string())
}

pub fn get(conn: &Connection, character_id: &str, expression: &str) -> Result<Option<Sprite>> {
    conn.query_row(
        "SELECT mime,data FROM character_sprites WHERE character_id=?1 AND expression=?2",
        params![character_id, expression],
        |r| {
            Ok(Sprite {
                mime: r.get(0)?,
                data: r.get(1)?,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn all(conn: &Connection, character_id: &str) -> Result<BTreeMap<String, Sprite>> {
    let mut statement = conn
        .prepare("SELECT expression,mime,data FROM character_sprites WHERE character_id=?")
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([character_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                Sprite {
                    mime: r.get(1)?,
                    data: r.get(2)?,
                },
            ))
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string())
}

pub fn put(conn: &Connection, character_id: &str, expression: &str, bytes: &[u8]) -> Result<()> {
    let mime = validate(bytes)?;
    conn.execute(
        "INSERT INTO character_sprites(character_id,expression,mime,data,updated) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(character_id,expression) DO UPDATE SET mime=excluded.mime,data=excluded.data,updated=excluded.updated",
        params![character_id, expression, mime, bytes, chrono::Utc::now().timestamp_millis()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn remove(conn: &Connection, character_id: &str, expression: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM character_sprites WHERE character_id=?1 AND expression=?2",
        params![character_id, expression],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn remove_all(conn: &Connection, character_id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM character_sprites WHERE character_id=?",
        [character_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn retain(conn: &Connection, character_id: &str, expressions: &BTreeSet<String>) -> Result<()> {
    for expression in list(conn, character_id)?.keys() {
        if !expressions.contains(expression) {
            remove(conn, character_id, expression)?;
        }
    }
    Ok(())
}

pub fn read_file(path: &std::path::Path) -> Result<Vec<u8>> {
    use std::io::Read;
    let file = std::fs::File::open(path).map_err(|error| error.to_string())?;
    let metadata = file.metadata().map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_SPRITE_BYTES as u64 {
        return Err("2 MiB 이하의 이미지 파일을 선택해 주세요.".into());
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(MAX_SPRITE_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    validate(&bytes)?;
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_supported_formats_by_content_not_extension() {
        assert_eq!(detect_mime(b"\x89PNG\r\n\x1a\n0000"), Some("image/png"));
        assert_eq!(detect_mime(b"GIF89a000"), Some("image/gif"));
        assert_eq!(detect_mime(b"\xFF\xD8\xFF\xE0"), Some("image/jpeg"));
        assert_eq!(detect_mime(b"RIFF0000WEBPVP8 "), Some("image/webp"));
        assert_eq!(
            detect_mime(
                "\u{feff}\n<?xml version=\"1.0\"?>\n<svg xmlns=\"http://www.w3.org/2000/svg\"/>"
                    .as_bytes()
            ),
            Some("image/svg+xml")
        );
        assert_eq!(detect_mime(b"<html><svg/></html>"), Some("image/svg+xml"));
        assert_eq!(detect_mime(b"plain text"), None);
        assert_eq!(detect_mime(b"{\"json\":true}"), None);
        assert!(validate(&[]).is_err());
        assert!(validate(&vec![b'a'; MAX_SPRITE_BYTES + 1]).is_err());
    }

    #[test]
    fn stores_replaces_lists_and_prunes_per_character() {
        let conn = Connection::open_in_memory().unwrap();
        initialize(&conn).unwrap();
        put(&conn, "c1", "기쁨", b"GIF89a-first").unwrap();
        put(&conn, "c1", "평온", b"<svg/>").unwrap();
        put(&conn, "c2", "기쁨", b"\x89PNG\r\n\x1a\n").unwrap();
        assert!(put(&conn, "c1", "슬픔", b"not an image").is_err());
        let listed = list(&conn, "c1").unwrap();
        assert_eq!(listed.len(), 2);
        assert_eq!(listed["기쁨"].mime, "image/gif");
        assert_eq!(listed["평온"].mime, "image/svg+xml");
        put(&conn, "c1", "기쁨", b"\x89PNG\r\n\x1a\nsecond").unwrap();
        let sprite = get(&conn, "c1", "기쁨").unwrap().unwrap();
        assert_eq!(sprite.mime, "image/png");
        assert_eq!(sprite.data, b"\x89PNG\r\n\x1a\nsecond");
        retain(&conn, "c1", &BTreeSet::from(["평온".to_string()])).unwrap();
        assert!(get(&conn, "c1", "기쁨").unwrap().is_none());
        assert!(get(&conn, "c1", "평온").unwrap().is_some());
        assert_eq!(list(&conn, "c2").unwrap().len(), 1);
        remove_all(&conn, "c1").unwrap();
        assert!(list(&conn, "c1").unwrap().is_empty());
        assert_eq!(all(&conn, "c2").unwrap()["기쁨"].mime, "image/png");
    }
}
