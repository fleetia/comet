//! Structured access to the action registry for other programs on this device.
//! The running app listens on 127.0.0.1 and writes the port and a per-launch token to the app
//! data folder; `comet mcp` reads that file and bridges an MCP client over stdio.
//! Unlike the conversation, callers pass structured input themselves, so the user's own words
//! are not checked. A token, an explicit confirmation for deletes and irreversible actions, and
//! the receipt in the organizer history take their place.

mod mcp;

use crate::{app, organizer::actions, store, widgets};
use rusqlite::Connection;
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Read, Write},
    net::{Ipv4Addr, TcpListener, TcpStream},
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

pub(crate) use mcp::cli;

/// Must match `identifier` in tauri.conf.json; the CLI has no Tauri context to ask.
const IDENTIFIER: &str = "space.starlight.comet";
const ENDPOINT_FILE: &str = "external-api.json";
const MAX_LINE: u64 = 64 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    token: String,
    method: String,
    #[serde(default)]
    client: String,
    #[serde(default)]
    params: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Lookup {
    kind: String,
    #[serde(default)]
    query: String,
    #[serde(default)]
    input: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Execute {
    request_id: String,
    kind: String,
    #[serde(default)]
    target_id: String,
    expected_revision: i64,
    input: Value,
    #[serde(default)]
    confirmed: bool,
}

pub(crate) fn start(app: &tauri::AppHandle, state: Arc<app::AppState>) -> Result<(), String> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let token = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    write_endpoint(&state.app_data, &json!({"port": port, "token": token}))?;
    let app = app.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let (app, state, token) = (app.clone(), state.clone(), token.clone());
            std::thread::spawn(move || {
                serve(stream, &token, |request| dispatch(&app, &state, request))
            });
        }
    });
    Ok(())
}

/// The token is only valid for this launch; removing the file tells clients the app is gone.
pub(crate) fn stop(app_data: &Path) {
    let _ = std::fs::remove_file(app_data.join(ENDPOINT_FILE));
}

fn write_endpoint(app_data: &Path, endpoint: &Value) -> Result<(), String> {
    let temporary = app_data.join(format!("{ENDPOINT_FILE}.tmp"));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    let mut file = options.open(&temporary).map_err(|e| e.to_string())?;
    file.write_all(endpoint.to_string().as_bytes())
        .map_err(|e| e.to_string())?;
    drop(file);
    std::fs::rename(&temporary, app_data.join(ENDPOINT_FILE)).map_err(|e| e.to_string())
}

fn serve(stream: TcpStream, token: &str, handle: impl FnOnce(Request) -> Result<Value, String>) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
    let mut line = String::new();
    let Ok(reader) = stream.try_clone() else {
        return;
    };
    // One JSON line per connection; anything else, such as a browser's HTTP request, is dropped.
    if BufReader::new(reader.take(MAX_LINE))
        .read_line(&mut line)
        .is_err()
    {
        return;
    }
    let Ok(request) = serde_json::from_str::<Request>(&line) else {
        return;
    };
    if !same(&request.token, token) {
        return;
    }
    let response = match handle(request) {
        Ok(result) => json!({"ok": true, "result": result}),
        Err(error) => json!({"ok": false, "error": error}),
    };
    let mut stream = stream;
    let _ = writeln!(stream, "{response}");
}

fn same(left: &str, right: &str) -> bool {
    left.len() == right.len()
        && left
            .bytes()
            .zip(right.bytes())
            .fold(0, |acc, (a, b)| acc | (a ^ b))
            == 0
}

fn dispatch(
    app: &tauri::AppHandle,
    state: &app::AppState,
    request: Request,
) -> Result<Value, String> {
    if crate::unavailable(state) {
        return Err("앱을 종료하고 있어요.".into());
    }
    let params = request.params;
    match request.method.as_str() {
        "catalog" => Ok(json!(catalog(&*app::lock(&state.db)?)?)),
        "context" => {
            let lookup: Lookup = serde_json::from_value(params).map_err(|e| e.to_string())?;
            let db = app::lock(&state.db)?;
            spec(&db, &lookup.kind)?;
            actions::entities_for(&db, &lookup.kind, &lookup.query)
        }
        "query" => {
            let lookup: Lookup = serde_json::from_value(params).map_err(|e| e.to_string())?;
            let db = app::lock(&state.db)?;
            if spec(&db, &lookup.kind)?["effect"] != "read" {
                return Err("조회 기능이 아니에요. comet_execute를 사용해 주세요.".into());
            }
            let input = if lookup.input.is_null() {
                json!({})
            } else {
                lookup.input
            };
            actions::query_registry(&db, &lookup.kind, &input)
        }
        "execute" => {
            let execute: Execute = serde_json::from_value(params).map_err(|e| e.to_string())?;
            let receipt = widgets::commands::change(state, |db| {
                let present =
                    app::presence::present_ids(state, &crate::characters::active_ids(db)?)?;
                run(db, &present, &request.client, &execute)
            })?;
            crate::organizer::runtime::publish_changes(app, state);
            crate::external_notice::announce(app, state, &request.client, &announcement(&receipt));
            serde_json::to_value(receipt).map_err(|e| e.to_string())
        }
        _ => Err("알 수 없는 요청이에요.".into()),
    }
}

/// Registry actions available now, without ones that need the native desktop window.
fn catalog(db: &Connection) -> Result<Vec<Value>, String> {
    Ok(actions::catalog(db)?
        .into_iter()
        .filter(|spec| spec["effect"] == "read" || spec["receipt"] == true)
        .map(|mut spec| {
            spec["confirmRequired"] = json!(confirm_required(&spec));
            spec
        })
        .collect())
}

fn spec(db: &Connection, kind: &str) -> Result<Value, String> {
    catalog(db)?
        .into_iter()
        .find(|spec| spec["id"] == kind)
        .ok_or_else(|| "현재 사용할 수 없는 기능이에요. comet_catalog로 확인해 주세요.".into())
}

fn confirm_required(spec: &Value) -> bool {
    spec["effect"] != "read"
        && (spec["id"]
            .as_str()
            .is_some_and(|id| id.ends_with("_delete"))
            || spec["undoSupported"] != true)
}

fn run(
    db: &Connection,
    present: &[String],
    client: &str,
    request: &Execute,
) -> Result<actions::Receipt, String> {
    if request.request_id.trim().is_empty()
        || request.request_id.chars().count() > 100
        || request.request_id.chars().any(char::is_control)
    {
        return Err("requestId를 100자 안에서 정해 주세요.".into());
    }
    let spec = spec(db, &request.kind)?;
    if spec["effect"] == "read" {
        return Err("조회는 comet_query를 사용해 주세요.".into());
    }
    if confirm_required(&spec) && !request.confirmed {
        return Err("지우거나 되돌릴 수 없는 작업이에요. 사용자에게 확인받은 뒤 confirmed=true로 다시 요청해 주세요.".into());
    }
    let user = store::active_user_id(db)?;
    // The client name stays in the receipt's input ID so the history keeps where it came from.
    let client: String = client
        .chars()
        .filter(|ch| !ch.is_control())
        .take(40)
        .collect();
    actions::execute_registry_with_presence(
        db,
        &user,
        &format!("external:{client}:{}", request.request_id),
        0,
        None,
        &actions::Action {
            kind: request.kind.clone(),
            target_id: request.target_id.clone(),
            expected_revision: request.expected_revision,
            input: request.input.clone(),
        },
        present,
    )
}

fn announcement(receipt: &actions::Receipt) -> String {
    let done = match receipt.kind.rsplit('_').next() {
        Some("add" | "create") => "추가했어요",
        Some("update") => "고쳤어요",
        Some("delete") => "지웠어요",
        _ => "처리했어요",
    };
    format!("'{}' {done}.", receipt.title)
}

fn endpoint_path() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    let base = std::env::var_os("HOME")
        .map(|home| PathBuf::from(home).join("Library/Application Support"));
    #[cfg(windows)]
    let base = std::env::var_os("APPDATA").map(PathBuf::from);
    #[cfg(all(unix, not(target_os = "macos")))]
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share")));
    Some(base?.join(IDENTIFIER).join(ENDPOINT_FILE))
}

/// Sends one request to the running app and returns its result.
fn call(endpoint: &Path, client: &str, method: &str, params: Value) -> Result<Value, String> {
    let unavailable =
        || "Comet 앱이 실행 중이 아니에요. 앱을 켠 뒤 다시 시도해 주세요.".to_string();
    let endpoint: Value = std::fs::read_to_string(endpoint)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .ok_or_else(unavailable)?;
    let port = endpoint["port"]
        .as_u64()
        .and_then(|port| u16::try_from(port).ok())
        .ok_or_else(unavailable)?;
    let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).map_err(|_| unavailable())?;
    stream
        .set_read_timeout(Some(Duration::from_secs(30)))
        .map_err(|e| e.to_string())?;
    let request =
        json!({"token": endpoint["token"], "method": method, "client": client, "params": params});
    writeln!(stream, "{request}").map_err(|e| e.to_string())?;
    let mut line = String::new();
    BufReader::new(stream.take(16 * 1024 * 1024))
        .read_line(&mut line)
        .map_err(|e| e.to_string())?;
    // The app closes the connection without a reply when the token is stale.
    let response: Value = serde_json::from_str(&line).map_err(|_| unavailable())?;
    if response["ok"] == true {
        Ok(response["result"].clone())
    } else {
        Err(response["error"]
            .as_str()
            .unwrap_or("요청을 처리하지 못했어요.")
            .into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database() -> Connection {
        store::open(std::path::Path::new(":memory:")).unwrap()
    }

    fn execute(
        db: &Connection,
        id: &str,
        kind: &str,
        target: &str,
        input: Value,
        confirmed: bool,
    ) -> Result<actions::Receipt, String> {
        let revision = actions::entities_for(db, kind, "").unwrap()["revision"]
            .as_i64()
            .unwrap();
        run(
            db,
            &[],
            "claude-code",
            &Execute {
                request_id: id.into(),
                kind: kind.into(),
                target_id: target.into(),
                expected_revision: revision,
                input,
                confirmed,
            },
        )
    }

    #[test]
    fn identifier_matches_the_app_config() {
        let config: Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(config["identifier"], IDENTIFIER);
    }

    #[test]
    fn a_trip_is_created_once_per_request_and_deleting_it_needs_confirmation() {
        let db = database();
        let input = json!({"title":"오사카","startDate":"2026-10-31","endDate":"2026-11-02",
                           "timeZone":"Asia/Tokyo","currency":"JPY","budget":800_000});
        let request = Execute {
            request_id: "trip-1".into(),
            kind: "travel_create".into(),
            target_id: String::new(),
            expected_revision: actions::entities_for(&db, "travel_create", "").unwrap()["revision"]
                .as_i64()
                .unwrap(),
            input: input.clone(),
            confirmed: false,
        };
        let created = run(&db, &[], "claude-code", &request).unwrap();
        assert_eq!(created.input_id, "external:claude-code:trip-1");
        assert_eq!(announcement(&created), "'오사카' 추가했어요.");
        // A retried request returns the same receipt; reusing its ID for other content is refused.
        assert_eq!(
            run(&db, &[], "claude-code", &request).unwrap().id,
            created.id
        );
        let mut other = input;
        other["title"] = json!("교토");
        assert!(execute(&db, "trip-1", "travel_create", "", other, false).is_err());
        assert!(execute(
            &db,
            "delete-1",
            "travel_delete",
            &created.target_id,
            json!({}),
            false
        )
        .unwrap_err()
        .contains("confirmed=true"));
        let deleted = execute(
            &db,
            "delete-1",
            "travel_delete",
            &created.target_id,
            json!({}),
            true,
        )
        .unwrap();
        let travels = || {
            serde_json::to_value(crate::diary::read(&db).unwrap()).unwrap()["travels"]
                .as_array()
                .unwrap()
                .len()
        };
        assert_eq!(travels(), 0);
        // The organizer history can undo an external change like any other receipt.
        actions::undo(&db, &store::active_user_id(&db).unwrap(), &deleted.id).unwrap();
        assert_eq!(travels(), 1);
    }

    #[test]
    fn only_available_registry_actions_are_offered() {
        let db = database();
        let ids: Vec<_> = catalog(&db)
            .unwrap()
            .into_iter()
            .map(|spec| spec["id"].clone())
            .collect();
        assert!(ids.contains(&json!("travel_create")));
        assert!(!ids
            .iter()
            .any(|id| id.as_str().is_some_and(|id| id.ends_with("_open"))));
        for (kind, message) in [
            ("ball_open", "사용할 수 없는"),
            ("travel_query", "comet_query"),
            ("nope", "사용할 수 없는"),
        ] {
            assert!(
                execute_unchecked(&db, kind).unwrap_err().contains(message),
                "{kind}"
            );
        }
        assert!(run(
            &db,
            &[],
            "",
            &Execute {
                request_id: " ".into(),
                kind: "travel_create".into(),
                target_id: String::new(),
                expected_revision: 0,
                input: json!({}),
                confirmed: false,
            }
        )
        .unwrap_err()
        .contains("requestId"));
    }

    fn execute_unchecked(db: &Connection, kind: &str) -> Result<actions::Receipt, String> {
        run(
            db,
            &[],
            "",
            &Execute {
                request_id: "id".into(),
                kind: kind.into(),
                target_id: String::new(),
                expected_revision: 0,
                input: json!({}),
                confirmed: true,
            },
        )
    }

    #[test]
    fn requests_round_trip_only_with_the_launch_token() {
        let folder = tempfile::tempdir().unwrap();
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        write_endpoint(folder.path(), &json!({"port": port, "token": "secret"})).unwrap();
        let server = std::thread::spawn(move || {
            for stream in listener.incoming().take(3) {
                serve(stream.unwrap(), "secret", |request| {
                    Ok(
                        json!({"method": request.method, "client": request.client, "params": request.params}),
                    )
                });
            }
        });
        let endpoint = folder.path().join(ENDPOINT_FILE);
        assert_eq!(
            call(&endpoint, "claude-code", "catalog", json!({"a": 1})).unwrap(),
            json!({"method": "catalog", "client": "claude-code", "params": {"a": 1}})
        );
        let mut browser = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).unwrap();
        writeln!(browser, "POST / HTTP/1.1\r").unwrap();
        let mut reply = String::new();
        browser.read_to_string(&mut reply).unwrap();
        assert!(reply.is_empty());
        write_endpoint(folder.path(), &json!({"port": port, "token": "stale"})).unwrap();
        assert!(call(&endpoint, "", "catalog", json!({}))
            .unwrap_err()
            .contains("실행 중이 아니에요"));
        server.join().unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&endpoint).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        stop(folder.path());
        assert!(call(&endpoint, "", "catalog", json!({}))
            .unwrap_err()
            .contains("실행 중이 아니에요"));
    }

    #[test]
    fn tokens_are_compared_whole() {
        assert!(same("abc", "abc"));
        assert!(!same("abc", "abd"));
        assert!(!same("abc", "abcd"));
    }
}
