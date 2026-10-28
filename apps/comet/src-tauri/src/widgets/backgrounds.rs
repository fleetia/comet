use super::storage;
use crate::{app::lock, characters::sprites, AppState};
use rusqlite::{params, Connection, OptionalExtension};
use std::{path::Path, sync::Arc};
use tauri::Manager;

pub(crate) const SCHEME: &str = "widget";
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
    sprites::detect_mime(bytes)
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
    put_media(conn, widget_id, mime, bytes)
}

pub(crate) fn put_media(
    conn: &Connection,
    widget_id: &str,
    mime: &str,
    bytes: &[u8],
) -> Result<()> {
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

fn response(status: u16, mime: &str, body: Vec<u8>) -> tauri::http::Response<Vec<u8>> {
    tauri::http::Response::builder()
        .status(status)
        .header("Content-Type", mime)
        .header("Cache-Control", "public, max-age=31536000, immutable")
        .body(body)
        .unwrap_or_else(|_| tauri::http::Response::new(Vec::new()))
}

pub(crate) fn serve(
    ctx: tauri::UriSchemeContext<'_, tauri::Wry>,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let Ok(url) = tauri::Url::parse(&request.uri().to_string()) else {
        return response(400, "text/plain", Vec::new());
    };
    let id = url
        .path_segments()
        .and_then(|mut segments| segments.next())
        .unwrap_or("")
        .replace("%3A", ":")
        .replace("%3a", ":");
    if id.is_empty() {
        return response(400, "text/plain", Vec::new());
    }
    let state = ctx.app_handle().state::<Arc<AppState>>();
    match lock(&state.db).and_then(|db| {
        if let Some(image_id) = id.strip_prefix("image:") {
            let allowed = storage::instances(&db)?.iter().any(|instance| {
                instance.kind == "image"
                    && instance.data["images"]
                        .as_array()
                        .is_some_and(|images| images.iter().any(|image| image["id"] == image_id))
            });
            if !allowed {
                return Ok(None);
            }
        } else {
            storage::get(&db, &id)?;
        }
        get(&db, &id)
    }) {
        Ok(Some(background)) => media_response(&request, background),
        Ok(None) => response(404, "text/plain", Vec::new()),
        Err(_) => response(500, "text/plain", Vec::new()),
    }
}

fn media_response(
    request: &tauri::http::Request<Vec<u8>>,
    background: Background,
) -> tauri::http::Response<Vec<u8>> {
    let Some(range) = request
        .headers()
        .get("range")
        .and_then(|value| value.to_str().ok())
    else {
        return tauri::http::Response::builder()
            .status(200)
            .header("Content-Type", &background.mime)
            .header("Content-Length", background.data.len().to_string())
            .header("Accept-Ranges", "bytes")
            .header("Cache-Control", "public, max-age=31536000, immutable")
            .body(background.data)
            .unwrap_or_else(|_| tauri::http::Response::new(Vec::new()));
    };
    let len = background.data.len();
    let bounds = range
        .strip_prefix("bytes=")
        .and_then(|value| value.split_once('-'))
        .and_then(|(start, end)| {
            if len == 0 || end.contains(',') {
                return None;
            }
            if start.is_empty() {
                let suffix = end.parse::<usize>().ok()?;
                if suffix == 0 {
                    return None;
                }
                Some((len.saturating_sub(suffix), len - 1))
            } else {
                let start = start.parse::<usize>().ok()?;
                let end = if end.is_empty() {
                    len - 1
                } else {
                    end.parse::<usize>().ok()?.min(len - 1)
                };
                if start >= len || start > end {
                    return None;
                }
                Some((start, end))
            }
        });
    let builder = tauri::http::Response::builder()
        .header("Accept-Ranges", "bytes")
        .header("Content-Type", &background.mime)
        .header("Cache-Control", "public, max-age=31536000, immutable");
    match bounds {
        Some((start, end)) => builder
            .status(206)
            .header("Content-Range", format!("bytes {start}-{end}/{len}"))
            .header("Content-Length", (end - start + 1).to_string())
            .body(background.data[start..=end].to_vec()),
        None => builder
            .status(416)
            .header("Content-Range", format!("bytes */{len}"))
            .body(Vec::new()),
    }
    .unwrap_or_else(|_| tauri::http::Response::new(Vec::new()))
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
    fn video_ranges_return_requested_bytes_and_reject_unsatisfiable_ranges() {
        let background = Background { mime: "video/mp4".into(), data: b"0123456789".to_vec() };
        let request = |range: &str| tauri::http::Request::builder().header("range", range).body(Vec::new()).unwrap();
        let partial = media_response(&request("bytes=2-4"), background.clone());
        assert_eq!(partial.status(), 206);
        assert_eq!(partial.headers()["content-range"], "bytes 2-4/10");
        assert_eq!(partial.body(), b"234");
        let suffix = media_response(&request("bytes=-3"), background.clone());
        assert_eq!(suffix.body(), b"789");
        let invalid = media_response(&request("bytes=10-"), background);
        assert_eq!(invalid.status(), 416);
        assert_eq!(invalid.headers()["content-range"], "bytes */10");
    }

    #[test]
    fn rejects_unsupported_or_oversized_backgrounds() {
        assert!(validate(b"not an image").is_err());
        assert!(validate(&vec![0; MAX_BYTES + 1]).is_err());
    }
}
