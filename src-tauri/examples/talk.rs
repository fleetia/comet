use comet_lib::talk::{self, context, EvalContext, History, Registry, ValueType};
use rusqlite::{Connection, OpenFlags};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    io::Read,
    path::Path,
};

const USAGE: &str = "talk check ENTRY\ntalk variables\ntalk simulate ENTRY (--input JSON_OR_FILE | --db PATH [--event JSON_OR_FILE]) [--seed N] [--now MILLISECONDS]\ntalk characters --db PATH\ntalk seal ENTRY\ntalk read ENTRY RELATIVE_FILE\ntalk save ENTRY RELATIVE_FILE --source TEXT_FILE --revision REVISION";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Input {
    #[serde(default)]
    values: BTreeMap<String, Value>,
    #[serde(default)]
    available: BTreeSet<String>,
    active: Vec<String>,
    #[serde(default = "idle")]
    trigger: String,
    #[serde(default)]
    history: History,
    now_ms: Option<i64>,
    seed: Option<u64>,
}
fn idle() -> String {
    "idle".into()
}

fn read_json<T: serde::de::DeserializeOwned>(argument: &str) -> Result<T, String> {
    let source = if argument.trim_start().starts_with('{') {
        argument.to_owned()
    } else {
        let file = std::fs::File::open(argument).map_err(|error| format!("{argument}: {error}"))?;
        let mut source = String::new();
        file.take(1_048_577)
            .read_to_string(&mut source)
            .map_err(|error| error.to_string())?;
        source
    };
    if source.len() > 1_048_576 {
        return Err("JSON input exceeds 1 MiB".into());
    }
    serde_json::from_str(&source).map_err(|error| error.to_string())
}
fn readonly(path: &str) -> Result<Connection, String> {
    Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| error.to_string())
}
fn options(arguments: &[String], allowed: &[&str]) -> Result<BTreeMap<String, String>, String> {
    if arguments.len() % 2 != 0 {
        return Err(USAGE.into());
    }
    let mut result = BTreeMap::new();
    for pair in arguments.chunks_exact(2) {
        if !allowed.contains(&pair[0].as_str())
            || result.insert(pair[0].clone(), pair[1].clone()).is_some()
        {
            return Err(format!("Unknown or repeated option: {}", pair[0]));
        }
    }
    Ok(result)
}
fn number<T: std::str::FromStr>(
    options: &BTreeMap<String, String>,
    key: &str,
) -> Result<Option<T>, String> {
    options
        .get(key)
        .map(|value| {
            value
                .parse::<T>()
                .map_err(|_| format!("Invalid {key}: {value}"))
        })
        .transpose()
}
fn fixture(
    input: Input,
    registry: &Registry,
    now: Option<i64>,
    seed: Option<u64>,
) -> Result<(EvalContext, History), String> {
    let mut values = registry
        .variables
        .iter()
        .map(|(name, variable)| {
            let value = if variable.nullable {
                Value::Null
            } else {
                match variable.kind {
                    ValueType::Boolean => json!(false),
                    ValueType::Number => json!(0),
                    ValueType::String => json!("not-installed"),
                }
            };
            (name.clone(), value)
        })
        .collect::<BTreeMap<_, _>>();
    values.insert(
        "dialogue.variant".into(),
        json!(seed.or(input.seed).unwrap_or(0) % 5),
    );
    for (name, value) in input.values {
        let variable = registry
            .variables
            .get(&name)
            .ok_or_else(|| format!("Unknown variable: {name}"))?;
        let valid = if value.is_null() {
            variable.nullable
        } else {
            match variable.kind {
                ValueType::Boolean => value.is_boolean(),
                ValueType::Number => value.is_number(),
                ValueType::String => value.is_string(),
            }
        };
        if !valid {
            return Err(format!(
                "Invalid type for {name}: expected {:?}{}",
                variable.kind,
                if variable.nullable { " or null" } else { "" }
            ));
        }
        values.insert(name, value);
    }
    let kinds = registry
        .variables
        .values()
        .filter_map(|variable| variable.widget.as_ref())
        .collect::<BTreeSet<_>>();
    if let Some(kind) = input.available.iter().find(|kind| !kinds.contains(kind)) {
        return Err(format!("Unknown widget: {kind}"));
    }
    if !registry.events.contains(&input.trigger) {
        return Err(format!("Unknown trigger: {}", input.trigger));
    }
    let distinct = input.active.iter().collect::<BTreeSet<_>>();
    if input.active.is_empty()
        || input.active.len() > 8
        || distinct.len() != input.active.len()
        || input.active.iter().any(|id| id.trim().is_empty())
    {
        return Err("active must contain 1 to 8 distinct nonempty character IDs".into());
    }
    Ok((
        EvalContext {
            values,
            active: input.active,
            available: input.available,
            now_ms: now.or(input.now_ms).unwrap_or(0),
            seed: seed.or(input.seed).unwrap_or(0),
            trigger: input.trigger,
        },
        input.history,
    ))
}
fn run(arguments: &[String]) -> Result<Value, String> {
    let registry = context::registry();
    match arguments.first().map(String::as_str) {
        Some("variables") if arguments.len() == 1 => {
            serde_json::to_value(registry).map_err(|error| error.to_string())
        }
        Some("check") if arguments.len() == 2 => {
            let program = talk::load(Path::new(&arguments[1]), &registry)
                .map_err(|errors| serde_json::to_string_pretty(&errors).unwrap_or_default())?;
            Ok(json!({"valid":true,"sceneCount":program.scenes.len(),"files":program.files}))
        }
        Some("seal") if arguments.len() == 2 => {
            let changed = talk::editor::seal_bundle(Path::new(&arguments[1]), &registry)?;
            Ok(json!({"encryptedFiles": changed}))
        }
        Some("read") if arguments.len() == 3 => serde_json::to_value(talk::editor::read_file(
            Path::new(&arguments[1]),
            &arguments[2],
        )?)
        .map_err(|error| error.to_string()),
        Some("save") if arguments.len() == 7 => {
            let options = options(&arguments[3..], &["--source", "--revision"])?;
            let file = std::fs::File::open(options.get("--source").ok_or(USAGE)?)
                .map_err(|error| error.to_string())?;
            let mut source = String::new();
            file.take(1_048_577)
                .read_to_string(&mut source)
                .map_err(|error| error.to_string())?;
            let document = talk::editor::save_file(
                Path::new(&arguments[1]),
                &arguments[2],
                &source,
                options.get("--revision").ok_or(USAGE)?,
                &registry,
            )
            .map_err(|errors| serde_json::to_string_pretty(&errors).unwrap_or_default())?;
            Ok(json!({"path":document.path, "revision":document.revision, "saved":true}))
        }
        Some("characters") => {
            let options = options(&arguments[1..], &["--db"])?;
            let db = readonly(options.get("--db").ok_or(USAGE)?)?;
            let mut statement = db.prepare("SELECT c.id,json_extract(c.data,'$.name'),r.position FROM characters c LEFT JOIN character_roster r ON r.character_id=c.id ORDER BY c.seq").map_err(|error| error.to_string())?;
            let rows = statement.query_map([], |row| Ok(json!({"id":row.get::<_,String>(0)?,"name":row.get::<_,String>(1)?,"position":row.get::<_,Option<i64>>(2)?}))).map_err(|error| error.to_string())?;
            let result = rows
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?;
            Ok(json!(result))
        }
        Some("simulate") if arguments.len() >= 4 => {
            let options = options(
                &arguments[2..],
                &["--input", "--db", "--event", "--now", "--seed"],
            )?;
            let now = number::<i64>(&options, "--now")?;
            let seed = number::<u64>(&options, "--seed")?;
            let (context, history) = match (options.get("--input"), options.get("--db")) {
                (Some(input), None) if !options.contains_key("--event") => {
                    fixture(read_json(input)?, &registry, now, seed)?
                }
                (None, Some(path)) => {
                    let db = readonly(path)?;
                    let event = options
                        .get("--event")
                        .map(|value| read_json::<context::WidgetEvent>(value))
                        .transpose()?;
                    if event
                        .as_ref()
                        .is_some_and(|event| !registry.events.contains(&event.event.kind))
                    {
                        return Err("Unknown event kind".into());
                    }
                    let context = context::build(
                        &db,
                        event.as_ref(),
                        now.unwrap_or_else(|| chrono::Utc::now().timestamp_millis()),
                        seed.unwrap_or(0),
                    )?;
                    let exists: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='talk_history')", [], |row| row.get(0)).map_err(|error| error.to_string())?;
                    let history = if exists {
                        talk::runtime::history(&db)?
                    } else {
                        History::new()
                    };
                    (context, history)
                }
                _ => {
                    return Err(
                        "Provide exactly one of --input or --db; --event requires --db".into(),
                    )
                }
            };
            let program = talk::load(Path::new(&arguments[1]), &registry)
                .map_err(|errors| serde_json::to_string_pretty(&errors).unwrap_or_default())?;
            serde_json::to_value(talk::simulate(&program, &context, &history))
                .map_err(|error| error.to_string())
        }
        _ => Err(USAGE.into()),
    }
}
fn main() {
    match run(&std::env::args().skip(1).collect::<Vec<_>>()) {
        Ok(value) => println!(
            "{}",
            serde_json::to_string_pretty(&value).unwrap_or_else(|_| "null".into())
        ),
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fixture_rejects_unknown_and_wrong_typed_values() {
        let registry = context::registry();
        for values in [
            json!({"weather.secret":true}),
            json!({"todo.openCount":"3"}),
            json!({"todo.ready":null}),
        ] {
            let input =
                serde_json::from_value(json!({"values":values,"active":["a","b"]})).unwrap();
            assert!(fixture(input, &registry, None, None).is_err());
        }
        let input =
            serde_json::from_value(json!({"active":["a","b"],"values":{"todo.openCount":null}}))
                .unwrap();
        let (context, _) = fixture(input, &registry, Some(100), Some(7)).unwrap();
        assert_eq!(context.values["todo.ready"], false);
        assert_eq!(context.values["todo.status"], "not-installed");
        assert_eq!(context.seed, 7);
        assert_eq!(context.now_ms, 100);
    }
    #[test]
    fn readonly_database_does_not_create_or_modify_files() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("test.sqlite");
        assert!(readonly(path.to_str().unwrap()).is_err());
        assert!(!path.exists());
        let db = Connection::open(&path).unwrap();
        db.execute_batch("CREATE TABLE existing(value INTEGER)")
            .unwrap();
        drop(db);
        let before = std::fs::read(&path).unwrap();
        let db = readonly(path.to_str().unwrap()).unwrap();
        assert!(db.execute("INSERT INTO existing VALUES(1)", []).is_err());
        drop(db);
        assert_eq!(std::fs::read(&path).unwrap(), before);
    }
}
