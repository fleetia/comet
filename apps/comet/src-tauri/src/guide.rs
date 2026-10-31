use crate::pack_stories::GuidePage;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::Manager;

const OPEN_ERROR: &str = "안내서를 열지 못했어요. 기본 브라우저에서 아래 경로를 열어 주세요.";

#[derive(Debug, Serialize)]
pub(crate) struct GuideOpenError {
    message: &'static str,
    path: String,
}

fn page_id(page: &GuidePage) -> &'static str {
    match page {
        GuidePage::FirstMeeting => "first-meeting",
        GuidePage::Talking => "talking",
        GuidePage::Friends => "friends",
        GuidePage::Packs => "packs",
        GuidePage::Widgets => "widgets",
        GuidePage::Ai => "ai",
        GuidePage::Rhythm => "rhythm",
        GuidePage::DiaryMemory => "diary-memory",
        GuidePage::Glossary => "glossary",
        GuidePage::Troubleshooting => "troubleshooting",
        GuidePage::Privacy => "privacy",
    }
}

fn page_path(resource_dir: &Path, page: &GuidePage) -> PathBuf {
    resource_dir
        .join("guide")
        .join(format!("{}.html", page_id(page)))
}

fn open_path(path: &Path, open: impl FnOnce(&str) -> Result<(), ()>) -> Result<(), GuideOpenError> {
    let error = || GuideOpenError {
        message: OPEN_ERROR,
        path: path.to_string_lossy().into_owned(),
    };
    if !path.is_file() {
        return Err(error());
    }
    let url = reqwest::Url::from_file_path(path).map_err(|_| error())?;
    open(url.as_str()).map_err(|_| error())
}

fn open_browser(url: &str) -> Result<(), ()> {
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("/usr/bin/open");
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = std::process::Command::new("rundll32.exe");
        command.arg("url.dll,FileProtocolHandler");
        command
    };
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let mut command = std::process::Command::new("xdg-open");
    let mut child = command
        .arg(url)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|_| ())?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

#[tauri::command]
pub(crate) fn open_guide(app: tauri::AppHandle, page: GuidePage) -> Result<(), GuideOpenError> {
    let resource_dir = app.path().resource_dir().map_err(|_| GuideOpenError {
        message: OPEN_ERROR,
        path: page_path(Path::new(""), &page)
            .to_string_lossy()
            .into_owned(),
    })?;
    open_path(&page_path(&resource_dir, &page), open_browser)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_returns_structured_error() {
        let dir = tempfile::tempdir().unwrap();
        let path = page_path(dir.path(), &GuidePage::Talking);
        let error = open_path(&path, |_| panic!("missing file must not open")).unwrap_err();
        assert_eq!(
            serde_json::to_value(error).unwrap(),
            serde_json::json!({
                "message": OPEN_ERROR,
                "path": path.to_string_lossy(),
            })
        );
    }

    #[test]
    fn file_url_handles_spaces_and_korean() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("안내서 이름.html");
        std::fs::write(&path, "").unwrap();
        open_path(&path, |url| {
            assert!(url.contains("%20"));
            assert!(url.contains("%EC%95%88"));
            assert_eq!(
                reqwest::Url::parse(url).unwrap().to_file_path().unwrap(),
                path
            );
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn every_page_has_matching_serde_id_and_document() {
        let pages = [
            GuidePage::FirstMeeting,
            GuidePage::Talking,
            GuidePage::Friends,
            GuidePage::Packs,
            GuidePage::Widgets,
            GuidePage::Ai,
            GuidePage::Rhythm,
            GuidePage::DiaryMemory,
            GuidePage::Glossary,
            GuidePage::Troubleshooting,
            GuidePage::Privacy,
        ];
        let docs = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../guide/docs");
        for page in pages {
            let id = page_id(&page);
            assert_eq!(
                page_path(Path::new("resources"), &page),
                Path::new("resources")
                    .join("guide")
                    .join(format!("{id}.html"))
            );
            assert_eq!(serde_json::to_value(&page).unwrap(), id);
            assert_eq!(
                serde_json::from_value::<GuidePage>(serde_json::json!(id)).unwrap(),
                page
            );
            assert!(
                docs.join(format!("{id}.md")).is_file(),
                "missing document: {id}"
            );
        }
        assert!(serde_json::from_value::<GuidePage>(serde_json::json!("../privacy")).is_err());
    }
}
