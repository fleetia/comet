use super::*;

fn run(data: &Value, action: &str, input: Value, now: i64) -> WidgetEffect {
    act("todo", data, action, &input, &BTreeMap::new(), now, 17).unwrap()
}

#[test]
fn todo_reorder_preserves_item_contents_and_unrelated_relative_order() {
    let added = run(
        &initial("todo"),
        "batch-add",
        json!({"items":[
            {"title":"먼저","plannedDate":"2026-10-16","memo":"원문\n  보존"},
            {"title":"다른 날짜","plannedDate":"2026-10-17"},
            {"title":"완료한 일","plannedDate":"2026-10-16"},
            {"title":"나중","plannedDate":"2026-10-16"}
        ]}),
        1,
    );
    let source = run(
        &added.data,
        "complete",
        json!({"id":added.data["items"][2]["id"]}),
        2,
    )
    .data;
    let original = source["items"].as_array().unwrap();
    let moved = run(
        &source,
        "reorder",
        json!({"id":original[3]["id"],"beforeId":original[0]["id"]}),
        3,
    );
    assert_eq!(
        moved.data["items"],
        json!([original[3], original[0], original[1], original[2]])
    );
    assert_eq!(moved.data["lists"], source["lists"]);
    let tail = run(
        &source,
        "reorder",
        json!({"id":original[0]["id"],"beforeId":null}),
        3,
    );
    assert_eq!(
        tail.data["items"],
        json!([original[1], original[2], original[3], original[0]])
    );
    assert_eq!(
        run(
            &source,
            "reorder",
            json!({"id":original[0]["id"],"beforeId":original[0]["id"]}),
            3
        )
        .data,
        source
    );
}

#[test]
fn todo_reorder_validates_both_ids_and_group_before_mutating() {
    let added = run(
        &initial("todo"),
        "batch-add",
        json!({"items":[
            {"title":"오늘","plannedDate":"2026-10-16"},
            {"title":"내일","plannedDate":"2026-10-17"},
            {"title":"완료","plannedDate":"2026-10-16"}
        ]}),
        1,
    );
    let source = run(
        &added.data,
        "complete",
        json!({"id":added.data["items"][2]["id"]}),
        2,
    )
    .data;
    let before = source.clone();
    let key = &source["items"][0]["id"];
    for input in [
        json!({"id":"missing","beforeId":key}),
        json!({"id":key,"beforeId":"missing"}),
        json!({"id":key}),
        json!({"id":key,"beforeId":8}),
        json!({"id":key,"beforeId":source["items"][1]["id"]}),
        json!({"id":key,"beforeId":source["items"][2]["id"]}),
    ] {
        assert!(act("todo", &source, "reorder", &input, &BTreeMap::new(), 3, 17).is_err());
        assert_eq!(source, before);
    }
}
