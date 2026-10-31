use crate::pack_stories::GuidePage;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{Emitter, Manager};

const OPEN_ERROR: &str = "안내서를 열지 못했어요. 기본 브라우저에서 아래 경로를 열어 주세요.";

#[derive(Debug, Clone, Serialize)]
pub(crate) struct GuideOpenError {
    message: &'static str,
    path: String,
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct GuideOpenRequest {
    id: u64,
    error: GuideOpenError,
}

#[derive(Default)]
pub(crate) struct GuideOpenPending {
    sequence: u64,
    request: Option<GuideOpenRequest>,
}

impl GuideOpenPending {
    fn take(&mut self, expected_id: Option<u64>) -> Option<GuideOpenRequest> {
        if expected_id.is_some_and(|id| {
            self.request
                .as_ref()
                .is_some_and(|request| request.id != id)
        }) {
            return None;
        }
        self.request.take()
    }
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
    open_path(&page_path(&resource_dir, &page), open_browser)?;
    let state = app.state::<Arc<crate::app::AppState>>();
    if let Ok(mut pending) = crate::lock(&state.guide_open_error) {
        pending.sequence += 1;
        pending.request = None;
        let id = pending.sequence;
        drop(pending);
        if let Some(window) = app.get_webview_window("settings") {
            let _ = window.emit("guide-open-succeeded", id);
        }
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn take_guide_open_error(
    state: tauri::State<'_, Arc<crate::app::AppState>>,
    expected_id: Option<u64>,
) -> Result<Option<GuideOpenRequest>, String> {
    Ok(crate::lock(&state.guide_open_error)?.take(expected_id))
}

pub(crate) fn open_from_navigation(app: tauri::AppHandle) -> Result<(), String> {
    match open_guide(app.clone(), GuidePage::FirstMeeting) {
        Ok(()) => Ok(()),
        Err(error) => {
            let state = app.state::<Arc<crate::app::AppState>>();
            {
                let mut pending = crate::lock(&state.guide_open_error)?;
                pending.sequence += 1;
                let request = GuideOpenRequest {
                    id: pending.sequence,
                    error,
                };
                pending.request = Some(request);
            }
            crate::app::windows::open_settings_section(
                app.clone(),
                crate::app::windows::SettingsSection::General,
            )?;
            let (sequence, request) = {
                let pending = crate::lock(&state.guide_open_error)?;
                (pending.sequence, pending.request.clone())
            };
            match request {
                Some(request) => app.emit_to("settings", "guide-open-failed", request),
                None => app.emit_to("settings", "guide-open-succeeded", sequence),
            }
            .map_err(|error| error.to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pending_error_is_consumed_once_and_old_acknowledgements_do_not_clear_new_errors() {
        let mut pending = GuideOpenPending {
            sequence: 2,
            request: Some(GuideOpenRequest {
                id: 2,
                error: GuideOpenError {
                    message: OPEN_ERROR,
                    path: "guide.html".into(),
                },
            }),
        };
        assert!(pending.take(Some(1)).is_none());
        assert_eq!(pending.take(Some(2)).unwrap().error.path, "guide.html");
        assert!(pending.take(None).is_none());
    }

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
