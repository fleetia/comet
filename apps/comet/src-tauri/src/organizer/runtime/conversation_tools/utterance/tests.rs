use super::*;
use serde_json::json;
use std::collections::HashMap;

/// One corpus line. `kiwi_tokens.json` holds Kiwi's analysis of the same text, recorded with
/// `scripts/capture-utterance-fixtures.py`, so these tests run without the model.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Case {
    text: String,
    family: String,
    route: Route,
    #[serde(default)]
    kinds: Vec<String>,
    #[serde(default)]
    mode: Option<String>,
    #[serde(default)]
    slots: Option<Value>,
    /// The desktop memo widget is installed.
    #[serde(default)]
    memo: bool,
    #[serde(default)]
    corrected: bool,
    /// Why the expectation is the safer LLM path rather than the ideal reading.
    #[serde(default)]
    #[allow(dead_code)]
    note: Option<String>,
}

fn anchor() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 10, 25).unwrap()
}

fn calibration() -> Vec<Case> {
    serde_json::from_str(include_str!("corpus.json")).unwrap()
}

/// Written before the rules were tuned against them and kept apart from the calibration lines.
fn holdout() -> Vec<Case> {
    serde_json::from_str(include_str!("holdout.json")).unwrap()
}

fn analyses() -> HashMap<String, Analysis> {
    let recorded: serde_json::Map<String, Value> =
        serde_json::from_str(include_str!("kiwi_tokens.json")).unwrap();
    recorded
        .into_iter()
        .map(|(text, value)| {
            // The recorder must analyze exactly what the app sends to Kiwi.
            assert_eq!(value["analyzed"], analysis_text(&text).as_ref(), "{text}");
            let analysis = Analysis {
                tokens: serde_json::from_value(value["tokens"].clone()).unwrap(),
                typo_corrected: serde_json::from_value(value["typo_corrected"].clone()).unwrap(),
                ..Analysis::default()
            };
            (text, analysis)
        })
        .collect()
}

fn catalog(memo: bool, without: &[&str]) -> Vec<Value> {
    let mut ids = vec![
        "note_create",
        "note_update",
        "note_delete",
        "note_query",
        "task_add",
        "task_update",
        "task_delete",
        "task_complete",
        "task_query",
        "event_add",
        "event_update",
        "event_delete",
        "event_query",
        "ledger_create",
        "ledger_update",
        "ledger_delete",
        "ledger_query",
        "habit_record",
        "focus_start",
    ];
    if memo {
        ids.extend(["memo_create", "memo_update", "memo_delete", "memo_query"]);
    }
    ids.into_iter()
        .filter(|id| !without.contains(id))
        .map(|id| json!({"id": id}))
        .collect()
}

#[test]
fn calibration_readings_match_their_expected_route_actions_and_values() {
    assert_readings(&calibration());
}

#[test]
fn holdout_readings_match_their_expected_route_actions_and_values() {
    assert_readings(&holdout());
}

fn assert_readings(cases: &[Case]) {
    let analyses = analyses();
    let mut differences = vec![];
    for case in cases {
        let analysis = analyses
            .get(&case.text)
            .unwrap_or_else(|| panic!("record Kiwi tokens for {:?}", case.text));
        let judgment = judge(
            &case.text,
            Some(analysis),
            anchor(),
            &catalog(case.memo, &[]),
        );
        let kinds: Vec<&str> = judgment
            .intents
            .iter()
            .map(|intent| intent.kind.as_str())
            .collect();
        let mut found = vec![];
        if judgment.route != case.route {
            found.push(format!("route {:?} {:?}", judgment.route, judgment.reasons));
        }
        if kinds != case.kinds {
            found.push(format!("kinds {kinds:?}"));
        }
        if let Some(mode) = &case.mode {
            if judgment.intents.iter().any(|intent| &intent.mode != mode) {
                found.push("mode".into());
            }
        }
        if judgment.corrected != case.corrected {
            found.push(format!("corrected {}", judgment.corrected));
        }
        if let (Some(expected), Some(intent)) = (&case.slots, judgment.intents.first()) {
            let actual = serde_json::to_value(&intent.slots).unwrap();
            for (key, value) in expected.as_object().unwrap() {
                if actual.get(key) != Some(value) {
                    found.push(format!("{key}={}", actual.get(key).unwrap_or(&Value::Null)));
                }
            }
        }
        for intent in &judgment.intents {
            assert!(
                case.text.contains(&intent.evidence),
                "{:?}",
                intent.evidence
            );
        }
        if !found.is_empty() {
            differences.push(format!(
                "{} [{}]: {}",
                case.text,
                case.family,
                found.join(", ")
            ));
        }
    }
    assert!(
        differences.is_empty(),
        "{} of {} readings differ:\n{}",
        differences.len(),
        cases.len(),
        differences.join("\n")
    );
}

#[test]
fn korean_waits_for_the_llm_path_without_kiwi_or_the_named_feature() {
    let analyses = analyses();
    let request = "할 일에 우유 사기 넣어 둬.";
    let judgment = judge(request, None, anchor(), &catalog(false, &[]));
    assert_eq!(judgment.route, Route::Ambiguous);
    assert_eq!(judgment.reasons, ["kiwi_unavailable"]);
    let without_todo = judge(
        request,
        analyses.get(request),
        anchor(),
        &catalog(false, &["task_add"]),
    );
    assert_eq!(without_todo.route, Route::Ambiguous);
    assert!(without_todo.intents.is_empty());
    assert_eq!(without_todo.reasons, ["kind_unavailable"]);
    // English uses string rules, so it reads the same with or without Kiwi.
    let english = judge(
        "Add a task titled QA-T1.",
        None,
        anchor(),
        &catalog(false, &[]),
    );
    assert_eq!(english.route, Route::Tools);
    assert_eq!(english.intents[0].slots.title.as_deref(), Some("QA-T1"));
    // Unicode lowering of İ grows it by a byte; values must still be cut from the request itself.
    let turkish = judge(
        "Add İzmir task titled Ölçü",
        None,
        anchor(),
        &catalog(false, &[]),
    );
    assert_eq!(turkish.intents[0].slots.title.as_deref(), Some("Ölçü"));
}
