use crate::{
    app::lock,
    widgets::{backgrounds, storage},
    AppState,
};
use std::sync::Arc;
use tauri::Manager;

pub(crate) const SCHEME: &str = "widget";
pub(crate) use backgrounds::{put, read_file, remove, EXTENSIONS};

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
        .to_string();
    if id.is_empty() {
        return response(400, "text/plain", Vec::new());
    }
    let state = ctx.app_handle().state::<Arc<AppState>>();
    match lock(&state.db)
        .and_then(|db| storage::get(&db, &id).and_then(|_| backgrounds::get(&db, &id)))
    {
        Ok(Some(background)) => response(200, &background.mime, background.data),
        Ok(None) => response(404, "text/plain", Vec::new()),
        Err(_) => response(500, "text/plain", Vec::new()),
    }
}
