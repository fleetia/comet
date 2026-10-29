use super::storage;
use crate::{app::lock, characters::sprites, AppState};
use rusqlite::{params, Connection, OptionalExtension};
use std::{io::Read, path::Path, sync::Arc};
use tauri::Manager;

pub(crate) const SCHEME: &str = "widget";
pub(crate) const EXTENSIONS: [&str; 6] = ["svg", "png", "gif", "webp", "jpg", "jpeg"];
const MAX_BYTES: usize = 2 * 1024 * 1024;
const MEDIA_CHUNK_BYTES: usize = 1024 * 1024;

type Result<T> = std::result::Result<T, String>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct BackgroundInfo {
    pub mime: String,
    pub updated_at: i64,
}

#[cfg(test)]
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
widget_id TEXT PRIMARY KEY,mime TEXT NOT NULL,data BLOB NOT NULL,updated INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS widget_image_media(
widget_id TEXT PRIMARY KEY,mime TEXT NOT NULL,size INTEGER NOT NULL,updated INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS widget_image_chunks(
widget_id TEXT NOT NULL,chunk_index INTEGER NOT NULL,data BLOB NOT NULL,
PRIMARY KEY(widget_id,chunk_index));",
    )
    .map_err(error)
}

pub(crate) fn info(conn: &Connection, widget_id: &str) -> Result<Option<BackgroundInfo>> {
    let image = conn.query_row(
        "SELECT mime,updated FROM widget_image_media WHERE widget_id=?",
        [widget_id],
        |row| Ok(BackgroundInfo { mime: row.get(0)?, updated_at: row.get(1)? }),
    ).optional().map_err(error)?;
    if image.is_some() { return Ok(image); }
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

#[cfg(test)]
pub(crate) fn get(conn: &Connection, widget_id: &str) -> Result<Option<Background>> {
    if let Some((mime, len, chunked)) = media_info(conn, widget_id)? {
        if chunked {
            let data = read_media_range(conn, widget_id, 0, len, true)?;
            return Ok(Some(Background { mime, data }));
        }
    }
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
    conn.execute("DELETE FROM widget_image_chunks WHERE widget_id=?", [widget_id]).map_err(error)?;
    conn.execute("DELETE FROM widget_image_media WHERE widget_id=?", [widget_id]).map_err(error)?;
    conn.execute(
        "INSERT INTO widget_backgrounds(widget_id,mime,data,updated) VALUES(?1,?2,?3,?4)
ON CONFLICT(widget_id) DO UPDATE SET mime=excluded.mime,data=excluded.data,updated=excluded.updated",
        params![widget_id, mime, bytes, updated],
    )
    .map_err(error)?;
    Ok(())
}

// The caller supplies the surrounding transaction so the list entry and all chunks commit together.
pub(crate) fn put_media_file(conn: &Connection, widget_id: &str, mime: &str, path: &Path) -> Result<()> {
    let mut file = std::fs::File::open(path).map_err(error)?;
    let len = file.metadata().map_err(error)?.len();
    let len = i64::try_from(len).map_err(error)?;
    if len == 0 { return Err("파일이 비어 있어요.".into()); }
    let now = chrono::Utc::now().timestamp_millis();
    let updated = info(conn, widget_id)?.map(|item| now.max(item.updated_at.saturating_add(1))).unwrap_or(now);
    conn.execute("DELETE FROM widget_backgrounds WHERE widget_id=?", [widget_id]).map_err(error)?;
    conn.execute("DELETE FROM widget_image_chunks WHERE widget_id=?", [widget_id]).map_err(error)?;
    conn.execute("INSERT INTO widget_image_media(widget_id,mime,size,updated) VALUES(?1,?2,?3,?4) ON CONFLICT(widget_id) DO UPDATE SET mime=excluded.mime,size=excluded.size,updated=excluded.updated", params![widget_id,mime,len,updated]).map_err(error)?;
    let mut buffer = vec![0u8; MEDIA_CHUNK_BYTES];
    let mut total = 0i64;
    let mut index = 0i64;
    loop {
        let mut filled = 0;
        while filled < buffer.len() {
            let count = file.read(&mut buffer[filled..]).map_err(error)?;
            if count == 0 { break; }
            filled += count;
        }
        if filled == 0 { break; }
        total = total.checked_add(filled as i64).ok_or("파일이 너무 커요.")?;
        if total > len { return Err("파일이 저장 중 변경됐어요.".into()); }
        conn.execute("INSERT INTO widget_image_chunks(widget_id,chunk_index,data) VALUES(?1,?2,?3)", params![widget_id,index,&buffer[..filled]]).map_err(error)?;
        index += 1;
    }
    if total != len { return Err("파일이 저장 중 변경됐어요.".into()); }
    Ok(())
}

pub(crate) fn remove(conn: &Connection, widget_id: &str) -> Result<bool> {
    conn.execute("DELETE FROM widget_image_chunks WHERE widget_id=?", [widget_id]).map_err(error)?;
    let chunked = conn.execute("DELETE FROM widget_image_media WHERE widget_id=?", [widget_id]).map_err(error)?;
    Ok(conn
        .execute(
            "DELETE FROM widget_backgrounds WHERE widget_id=?",
            [widget_id],
        )
        .map_err(error)?
        > 0 || chunked > 0)
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

fn media_info(conn: &Connection, id: &str) -> Result<Option<(String, usize, bool)>> {
    let image: Option<(String, i64)> = conn.query_row(
        "SELECT mime,size FROM widget_image_media WHERE widget_id=?", [id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).optional().map_err(error)?;
    let (item, chunked) = if image.is_some() {
        (image, true)
    } else {
        (conn.query_row("SELECT mime,length(data) FROM widget_backgrounds WHERE widget_id=?", [id],
            |row| Ok((row.get(0)?, row.get(1)?))).optional().map_err(error)?, false)
    };
    item.map(|(mime, len)| usize::try_from(len).map(|len| (mime, len, chunked)).map_err(error)).transpose()
}

// `end` is exclusive; only the rows overlapping this request are loaded.
fn read_media_range(conn: &Connection, id: &str, start: usize, end: usize, chunked: bool) -> Result<Vec<u8>> {
    if start > end { return Err("이미지 범위가 올바르지 않아요.".into()); }
    if start == end { return Ok(Vec::new()); }
    if !chunked {
        let count = i64::try_from(end - start).map_err(error)?;
        let start = i64::try_from(start).map_err(error)?.checked_add(1).ok_or("이미지 범위가 너무 커요.")?;
        return conn.query_row("SELECT substr(data,?2,?3) FROM widget_backgrounds WHERE widget_id=?1", params![id,start,count], |row| row.get(0)).map_err(error);
    }
    let first = start / MEDIA_CHUNK_BYTES;
    let last = (end - 1) / MEDIA_CHUNK_BYTES;
    let mut statement = conn.prepare("SELECT chunk_index,data FROM widget_image_chunks WHERE widget_id=?1 AND chunk_index BETWEEN ?2 AND ?3 ORDER BY chunk_index").map_err(error)?;
    let mut rows = statement.query(params![id,i64::try_from(first).map_err(error)?,i64::try_from(last).map_err(error)?]).map_err(error)?;
    let mut output = Vec::new();
    let mut expected = first;
    while let Some(row) = rows.next().map_err(error)? {
        let index = usize::try_from(row.get::<_, i64>(0).map_err(error)?).map_err(error)?;
        if index != expected { return Err("이미지 데이터가 손상됐어요.".into()); }
        let chunk: Vec<u8> = row.get(1).map_err(error)?;
        let from = if index == first { start % MEDIA_CHUNK_BYTES } else { 0 };
        let to = if index == last { (end - 1) % MEDIA_CHUNK_BYTES + 1 } else { MEDIA_CHUNK_BYTES };
        if from > to || to > chunk.len() { return Err("이미지 데이터가 손상됐어요.".into()); }
        output.extend_from_slice(&chunk[from..to]);
        expected += 1;
    }
    if expected != last + 1 || output.len() != end - start { return Err("이미지 데이터가 손상됐어요.".into()); }
    Ok(output)
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
        media_response(&db, &request, &id)
    }) {
        Ok(Some(response)) => response,
        Ok(None) => response(404, "text/plain", Vec::new()),
        Err(_) => response(500, "text/plain", Vec::new()),
    }
}

fn media_response(
    conn: &Connection,
    request: &tauri::http::Request<Vec<u8>>,
    id: &str,
) -> Result<Option<tauri::http::Response<Vec<u8>>>> {
    let Some((mime, len, chunked)) = media_info(conn, id)? else { return Ok(None); };
    let Some(range) = request
        .headers()
        .get("range")
        .and_then(|value| value.to_str().ok())
    else {
        let body = read_media_range(conn, id, 0, len, chunked)?;
        return Ok(Some(tauri::http::Response::builder()
            .status(200)
            .header("Content-Type", &mime)
            .header("Content-Length", len.to_string())
            .header("Accept-Ranges", "bytes")
            .header("Cache-Control", "public, max-age=31536000, immutable")
            .body(body)
            .unwrap_or_else(|_| tauri::http::Response::new(Vec::new()))));
    };
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
                Some((len.saturating_sub(suffix.min(MEDIA_CHUNK_BYTES)), len - 1))
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
        .header("Content-Type", &mime)
        .header("Cache-Control", "public, max-age=31536000, immutable");
    let response = match bounds {
        Some((start, end)) => {
            let end = end.min(start.saturating_add(MEDIA_CHUNK_BYTES - 1));
            let data = read_media_range(conn, id, start, end + 1, chunked)?;
            builder
            .status(206)
            .header("Content-Range", format!("bytes {start}-{end}/{len}"))
            .header("Content-Length", (end - start + 1).to_string())
            .body(data)
        },
        None => builder
            .status(416)
            .header("Content-Range", format!("bytes */{len}"))
            .body(Vec::new()),
    }
    .unwrap_or_else(|_| tauri::http::Response::new(Vec::new()));
    Ok(Some(response))
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
        let db = database();
        put_media(&db, "legacy", "video/mp4", b"0123456789").unwrap();
        let request = |range: &str| tauri::http::Request::builder().header("range", range).body(Vec::new()).unwrap();
        let partial = media_response(&db, &request("bytes=2-4"), "legacy").unwrap().unwrap();
        assert_eq!(partial.status(), 206);
        assert_eq!(partial.headers()["content-range"], "bytes 2-4/10");
        assert_eq!(partial.body().as_slice(), b"234");
        let suffix = media_response(&db, &request("bytes=-3"), "legacy").unwrap().unwrap();
        assert_eq!(suffix.body().as_slice(), b"789");
        let invalid = media_response(&db, &request("bytes=10-"), "legacy").unwrap().unwrap();
        assert_eq!(invalid.status(), 416);
        assert_eq!(invalid.headers()["content-range"], "bytes */10");
    }

    #[test]
    fn chunked_media_reads_cross_chunk_ranges_and_removes_all_data() {
        let db = database();
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("media");
        let mut bytes = vec![1u8; MEDIA_CHUNK_BYTES];
        bytes.extend([2, 3, 4, 5]);
        std::fs::write(&path, &bytes).unwrap();
        let tx = db.unchecked_transaction().unwrap();
        put_media_file(&tx, "image:one", "video/mp4", &path).unwrap();
        tx.commit().unwrap();
        let request = |range: &str| tauri::http::Request::builder().header("range", range).body(Vec::new()).unwrap();
        let start = MEDIA_CHUNK_BYTES - 2;
        let partial = media_response(&db, &request(&format!("bytes={start}-{}", start + 4)), "image:one").unwrap().unwrap();
        assert_eq!(partial.body().as_slice(), &[1, 1, 2, 3, 4]);
        assert_eq!(partial.headers()["content-range"].to_str().unwrap(), format!("bytes {start}-{}/{len}", start + 4, len = bytes.len()));
        let capped = media_response(&db, &request("bytes=0-"), "image:one").unwrap().unwrap();
        assert_eq!(capped.body().len(), MEDIA_CHUNK_BYTES);
        let suffix = media_response(&db, &request("bytes=-3"), "image:one").unwrap().unwrap();
        assert_eq!(suffix.body().as_slice(), &[3, 4, 5]);
        assert!(remove(&db, "image:one").unwrap());
        assert!(media_info(&db, "image:one").unwrap().is_none());
        assert_eq!(db.query_row("SELECT COUNT(*) FROM widget_image_chunks", [], |row| row.get::<_, i64>(0)).unwrap(), 0);
    }

    #[test]
    fn failed_media_write_rolls_back_the_prior_blob() {
        let db = database();
        put_media(&db, "image:one", "image/png", b"old").unwrap();
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("new");
        std::fs::write(&path, vec![7; MEDIA_CHUNK_BYTES + 1]).unwrap();
        db.execute_batch("CREATE TRIGGER fail_second_chunk BEFORE INSERT ON widget_image_chunks WHEN NEW.chunk_index=1 BEGIN SELECT RAISE(ABORT,'injected failure'); END;").unwrap();
        let tx = db.unchecked_transaction().unwrap();
        assert!(put_media_file(&tx, "image:one", "image/png", &path).is_err());
        drop(tx);
        assert_eq!(get(&db, "image:one").unwrap().unwrap().data.as_slice(), b"old");
    }

    #[test]
    fn rejects_unsupported_or_oversized_backgrounds() {
        assert!(validate(b"not an image").is_err());
        assert!(validate(&vec![0; MAX_BYTES + 1]).is_err());
    }
}
