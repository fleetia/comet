//! `comet mcp`: a stdio MCP server that forwards tool calls to the running app.

use serde_json::{json, Value};
use std::io::{BufRead, Write};

const PROTOCOL_VERSIONS: &[&str] = &["2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS: &str = "Comet is the user's desktop companion app. It stores their diary, ledger, habits, todos, calendar, memos and trips. \
Call comet_catalog first to see the actions available now and each inputSchema. \
For a change, call comet_context with the kind to get its revision and the existing items, then comet_execute with that revision. \
Use only IDs from the context. Dates are YYYY-MM-DD in the user's local date. \
Write only values the user actually gave, such as booking numbers and links; if a required value is missing or a target is ambiguous, ask the user instead of guessing. \
Actions with confirmRequired delete data or cannot be undone: ask the user first and pass confirmed=true only after they agree. \
Use a new requestId for each distinct change and reuse it only to retry the same change.";

pub(crate) fn cli(args: &[String]) -> Option<i32> {
    if args.get(1).map(String::as_str) != Some("mcp") {
        return None;
    }
    if args.len() > 2 {
        eprintln!(
            "comet mcp\nMCP 클라이언트가 stdio로 실행하는 명령이에요. Comet 앱이 켜져 있어야 해요."
        );
        return Some(if matches!(args[2].as_str(), "--help" | "-h") {
            0
        } else {
            1
        });
    }
    let Some(endpoint) = super::endpoint_path() else {
        eprintln!("Comet 데이터 폴더를 찾지 못했어요.");
        return Some(1);
    };
    let mut client = String::new();
    let mut stdout = std::io::stdout().lock();
    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else {
            break;
        };
        let Ok(message) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let response = respond(&message, &mut client, &mut |client, method, params| {
            super::call(&endpoint, client, method, params)
        });
        if let Some(response) = response {
            if writeln!(stdout, "{response}")
                .and_then(|_| stdout.flush())
                .is_err()
            {
                break;
            }
        }
    }
    Some(0)
}

type Call<'a> = dyn FnMut(&str, &str, Value) -> Result<Value, String> + 'a;

/// Answers one JSON-RPC message; notifications get no reply.
fn respond(message: &Value, client: &mut String, call: &mut Call) -> Option<Value> {
    let id = message.get("id")?.clone();
    let params = &message["params"];
    let result = match message["method"].as_str().unwrap_or_default() {
        "initialize" => {
            *client = params["clientInfo"]["name"]
                .as_str()
                .unwrap_or_default()
                .into();
            let requested = params["protocolVersion"].as_str().unwrap_or_default();
            let version = PROTOCOL_VERSIONS
                .iter()
                .find(|version| **version == requested)
                .unwrap_or(&PROTOCOL_VERSIONS[0]);
            json!({
                "protocolVersion": version,
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "comet", "version": env!("CARGO_PKG_VERSION")},
                "instructions": INSTRUCTIONS,
            })
        }
        "ping" => json!({}),
        "tools/list" => json!({"tools": tools()}),
        "tools/call" => {
            let method = match params["name"].as_str().unwrap_or_default() {
                "comet_catalog" => "catalog",
                "comet_context" => "context",
                "comet_query" => "query",
                "comet_execute" => "execute",
                _ => {
                    return Some(json!({"jsonrpc": "2.0", "id": id,
                        "error": {"code": -32602, "message": "Unknown tool"}}))
                }
            };
            let arguments = params
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));
            match call(client, method, arguments) {
                Ok(value) => json!({"content": [{"type": "text", "text": value.to_string()}]}),
                Err(error) => {
                    json!({"content": [{"type": "text", "text": error}], "isError": true})
                }
            }
        }
        _ => {
            return Some(json!({"jsonrpc": "2.0", "id": id,
                "error": {"code": -32601, "message": "Method not found"}}))
        }
    };
    Some(json!({"jsonrpc": "2.0", "id": id, "result": result}))
}

fn tools() -> Value {
    let kind = json!({"type": "string", "description": "Action id from comet_catalog"});
    json!([
        {
            "name": "comet_catalog",
            "description": "List the Comet actions available now with their effect, inputSchema, requiresTarget and confirmRequired.",
            "inputSchema": {"type": "object", "properties": {}, "additionalProperties": false},
            "annotations": {"readOnlyHint": true},
        },
        {
            "name": "comet_context",
            "description": "Get the current revision and existing items for an action before changing them. query narrows the items by words in their titles.",
            "inputSchema": {"type": "object", "properties": {"kind": kind, "query": {"type": "string"}},
                "required": ["kind"], "additionalProperties": false},
            "annotations": {"readOnlyHint": true},
        },
        {
            "name": "comet_query",
            "description": "Run a read action (effect=read) such as ledger_query or travel_query. Totals and conversions in the result are computed by Comet; report them as given.",
            "inputSchema": {"type": "object", "properties": {"kind": kind, "input": {"type": "object"}},
                "required": ["kind"], "additionalProperties": false},
            "annotations": {"readOnlyHint": true},
        },
        {
            "name": "comet_execute",
            "description": "Run a write or control action. Comet saves it, shows it in the organizer history where the user can undo it, and the character may mention it.",
            "inputSchema": {"type": "object", "properties": {
                    "requestId": {"type": "string", "description": "New for each change; reuse only to retry the same change"},
                    "kind": kind,
                    "targetId": {"type": "string", "description": "Existing item ID from comet_context; empty when requiresTarget is false"},
                    "expectedRevision": {"type": "integer", "description": "revision from comet_context"},
                    "input": {"type": "object", "description": "Matches the action's inputSchema"},
                    "confirmed": {"type": "boolean", "description": "true only after the user agreed to a confirmRequired action"}},
                "required": ["requestId", "kind", "expectedRevision", "input"], "additionalProperties": false},
            "annotations": {"destructiveHint": true},
        },
    ])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn handshake_tools_and_calls_follow_json_rpc() {
        let mut client = String::new();
        let mut calls = Vec::new();
        let mut call = |client: &str, method: &str, params: Value| {
            calls.push((client.to_owned(), method.to_owned(), params));
            if method == "execute" {
                Err("원본이 바뀌었어요.".to_string())
            } else {
                Ok(json!([{"id": "travel_create"}]))
            }
        };
        let init = respond(
            &json!({"jsonrpc":"2.0","id":1,"method":"initialize",
                    "params":{"protocolVersion":"2025-03-26","clientInfo":{"name":"claude-code"}}}),
            &mut client,
            &mut call,
        )
        .unwrap();
        assert_eq!(init["result"]["protocolVersion"], "2025-03-26");
        assert_eq!(client, "claude-code");
        assert!(respond(
            &json!({"jsonrpc":"2.0","method":"notifications/initialized"}),
            &mut client,
            &mut call
        )
        .is_none());
        let list = respond(
            &json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}),
            &mut client,
            &mut call,
        )
        .unwrap();
        assert_eq!(list["result"]["tools"].as_array().unwrap().len(), 4);
        let catalog = respond(
            &json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"comet_catalog"}}),
            &mut client,
            &mut call,
        )
        .unwrap();
        assert_eq!(
            catalog["result"]["content"][0]["text"],
            r#"[{"id":"travel_create"}]"#
        );
        let failed = respond(
            &json!({"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"comet_execute","arguments":{"kind":"travel_create"}}}),
            &mut client,
            &mut call,
        )
        .unwrap();
        assert_eq!(failed["result"]["isError"], true);
        assert_eq!(failed["result"]["content"][0]["text"], "원본이 바뀌었어요.");
        let unknown = respond(
            &json!({"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"rm"}}),
            &mut client,
            &mut call,
        )
        .unwrap();
        assert_eq!(unknown["error"]["code"], -32602);
        let old = respond(
            &json!({"jsonrpc":"2.0","id":6,"method":"initialize","params":{"protocolVersion":"1999-01-01"}}),
            &mut client,
            &mut call,
        )
        .unwrap();
        assert_eq!(old["result"]["protocolVersion"], PROTOCOL_VERSIONS[0]);
        assert_eq!(
            calls
                .iter()
                .map(|(client, method, _)| (client.as_str(), method.as_str()))
                .collect::<Vec<_>>(),
            [("claude-code", "catalog"), ("claude-code", "execute")]
        );
        assert_eq!(calls[0].2, json!({}));
    }
}
