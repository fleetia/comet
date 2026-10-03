use super::*;
use serde_json::json;

fn database() -> Connection {
    let db = Connection::open_in_memory().unwrap();
    initialize(&db).unwrap();
    db
}

fn act(db: &Connection, action: &str, input: Value) -> DiaryState {
    update(db, read(db).unwrap().revision, action, &input).unwrap()
}

#[test]
fn daily_pages_are_canonical_and_keep_their_entries_on_reopen() {
    let db = database();
    let state = act(
        &db,
        "page-create",
        json!({"title":"  오늘  ","date":"2026-10-03"}),
    );
    let page = state.pages[0].id.clone();
    let state = act(
        &db,
        "entry-add",
        json!({"pageId":page,"kind":"note","text":"  첫 줄\n둘째 줄  "}),
    );
    let reopened = act(
        &db,
        "page-create",
        json!({"title":"바뀌면 안 됨","date":"2026-10-03"}),
    );
    assert_eq!(state, reopened);
    assert_eq!(reopened.pages[0].entries[0].text, "  첫 줄\n둘째 줄  ");
    assert_eq!(reopened.pages[0].title, "  오늘  ");
    let state = act(&db, "page-update", json!({"id":page,"title":""}));
    assert_eq!(state.pages[0].title, "");
    assert_eq!(state.pages[0].entries, reopened.pages[0].entries);
    let state = act(&db, "page-create", json!({"title":"여행 준비","date":null}));
    assert_eq!(state.pages.len(), 2);
    assert_eq!(state.pages[1].date, None);
}

#[test]
fn stale_and_invalid_mutations_leave_the_whole_state_unchanged() {
    let db = database();
    let state = act(
        &db,
        "note-create",
        json!({"title":"메모","body":"  원문\n  ","pinned":true}),
    );
    let note = state.notes[0].id.clone();
    assert!(update(&db, 0, "note-delete", &json!({"id":note})).is_err());
    for (action, input) in [
        (
            "note-update",
            json!({"id":note,"body":"덮어쓰기","pinned":"true"}),
        ),
        ("page-create", json!({"title":"bad","date":"2026-02-30"})),
        ("page-create", json!({"title":"bad","date":"2026-1-01"})),
        ("page-create", json!({"title":"bad","date":"0000-01-01"})),
        ("page-create", json!({"title":"  ","date":null})),
        (
            "move-record",
            json!({"todoId":"a","fromDate":"2026-10-03","toDate":"2026-10-03","title":"same"}),
        ),
        ("note-update", json!({"id":note,"body":"x".repeat(20001)})),
        ("unknown", json!({})),
    ] {
        assert!(
            update(&db, state.revision, action, &input).is_err(),
            "{action}: {input}"
        );
        assert_eq!(read(&db).unwrap(), state);
    }
}

#[test]
fn editing_and_deleting_a_page_never_removes_notes_or_linked_sources() {
    let db = database();
    let state = act(
        &db,
        "page-create",
        json!({"title":"오늘","date":"2026-10-03"}),
    );
    let page = state.pages[0].id.clone();
    act(
        &db,
        "note-create",
        json!({"title":"계속 쓸 메모","body":"원문","envelopeId":"travel"}),
    );
    let state = act(
        &db,
        "entry-add",
        json!({"pageId":page,"kind":"todo","refId":"todo-1","text":"예약하기","time":"09:30"}),
    );
    let entry = state.pages[0].entries[0].id.clone();
    let state = act(
        &db,
        "entry-update",
        json!({"pageId":page,"id":entry,"text":"  예약하기\n확인  ","time":null}),
    );
    assert_eq!(state.pages[0].entries[0].time, None);
    assert_eq!(state.pages[0].entries[0].ref_id.as_deref(), Some("todo-1"));
    assert_eq!(state.pages[0].entries[0].text, "  예약하기\n확인  ");
    assert!(update(
        &db,
        state.revision,
        "entry-add",
        &json!({"pageId":page,"kind":"event","text":"회의","time":"25:00"})
    )
    .is_err());
    assert!(update(
        &db,
        state.revision,
        "entry-add",
        &json!({"pageId":page,"kind":"todo","text":"연결 없음"})
    )
    .is_err());
    let state = act(&db, "page-delete", json!({"id":page}));
    assert!(state.pages.is_empty());
    assert_eq!(state.notes[0].body, "원문");
    assert_eq!(state.notes[0].envelope_id.as_deref(), Some("travel"));
}

#[test]
fn reopening_database_preserves_writing_and_partial_note_edits() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("diary.sqlite");
    let db = Connection::open(&path).unwrap();
    initialize(&db).unwrap();
    let state = act(
        &db,
        "note-create",
        json!({"title":"  여행  ","body":"\n준비물  ","envelopeId":"travel","pinned":true}),
    );
    let note = state.notes[0].id.clone();
    let state = act(
        &db,
        "note-update",
        json!({"id":note,"pinned":false,"envelopeId":null}),
    );
    drop(db);
    let db = Connection::open(path).unwrap();
    initialize(&db).unwrap();
    assert_eq!(read(&db).unwrap(), state);
    assert_eq!(state.notes[0].body, "\n준비물  ");
    assert_eq!(state.notes[0].title, "  여행  ");
    assert!(state.notes[0].envelope_id.is_none());
}

#[test]
fn current_revision_cannot_overwrite_a_stale_entry_or_note_draft() {
    let db = database();
    let state = act(&db, "page-create", json!({"title":"","date":"2026-10-03"}));
    let page = state.pages[0].id.clone();
    let state = act(
        &db,
        "entry-add",
        json!({"pageId":page,"kind":"event","text":"원래 기록","time":"10:00","refId":"event-id"}),
    );
    let entry = state.pages[0].entries[0].id.clone();
    let state = act(
        &db,
        "entry-update",
        json!({"pageId":page,"id":entry,"text":"다른 창에서 변경","expectedText":"원래 기록"}),
    );
    for guard in [
        json!({"expectedText":"원래 기록"}),
        json!({"expectedTime":"09:00"}),
        json!({"expectedRefId":null}),
    ] {
        let mut input = json!({"pageId":page,"id":entry,"text":"덮어쓰면 안 됨"});
        input
            .as_object_mut()
            .unwrap()
            .extend(guard.as_object().unwrap().clone());
        assert!(update(&db, state.revision, "entry-update", &input).is_err());
        assert_eq!(read(&db).unwrap(), state);
    }
    let state = act(
        &db,
        "entry-update",
        json!({"pageId":page,"id":entry,"text":"새 기록","time":"","expectedText":"다른 창에서 변경","expectedTime":"10:00","expectedRefId":"event-id"}),
    );
    assert_eq!(state.pages[0].entries[0].time, None);
    let state = act(&db, "note-create", json!({"title":"원제목","body":"본문"}));
    let note = state.notes[0].id.clone();
    let state = act(
        &db,
        "note-update",
        json!({"id":note,"title":"수정제목","body":"수정본문","expectedTitle":"원제목","expectedBody":"본문"}),
    );
    assert!(update(
        &db,
        state.revision,
        "note-update",
        &json!({"id":note,"body":"옛 초안","expectedBody":"본문"})
    )
    .is_err());
    assert!(update(
        &db,
        state.revision,
        "note-update",
        &json!({"id":note,"title":"옛 제목","expectedTitle":"원제목"})
    )
    .is_err());
    assert_eq!(read(&db).unwrap(), state);
}

#[test]
fn moving_a_todo_updates_planning_and_history_in_one_transaction() {
    use crate::widgets::{storage, WidgetRequest};
    let db = database();
    storage::initialize(&db).unwrap();
    let directory = tempfile::tempdir().unwrap();
    storage::install(&db, directory.path(), &["todo".into()]).unwrap();
    let todo = storage::instances(&db).unwrap().remove(0);
    storage::execute(
        &db,
        &WidgetRequest {
            request_id: new_id(),
            instance_id: todo.id.clone(),
            expected_revision: todo.revision,
            action: "add".into(),
            input: json!({"title":"예약하기","plannedDate":"2026-10-03","dueDate":"2026-10-10"}),
        },
        1,
        1,
    )
    .unwrap();
    let todo = storage::get(&db, &todo.id).unwrap();
    let todo_id = todo.data["items"][0]["id"].clone();
    let state = act(
        &db,
        "move-record",
        json!({"todoId":todo_id,"fromDate":"2026-10-03","toDate":"2026-10-04","title":"예약하기"}),
    );
    let moved = storage::get(&db, &todo.id).unwrap();
    assert_eq!(state.moves.len(), 1);
    assert_eq!(state.moves[0].from_date, "2026-10-03");
    assert_eq!(moved.data["items"][0]["plannedDate"], "2026-10-04");
    assert_eq!(moved.data["items"][0]["dueDate"], "2026-10-10");
    assert_eq!(moved.revision, todo.revision + 1);
    assert!(update(
        &db,
        state.revision,
        "move-record",
        &json!({"todoId":todo_id,"fromDate":"2026-10-03","toDate":"2026-10-05","title":"예약하기"})
    )
    .is_err());
    assert_eq!(read(&db).unwrap(), state);
    assert_eq!(storage::get(&db, &todo.id).unwrap().data, moved.data);
    db.execute_batch("CREATE TRIGGER fail_diary_update BEFORE UPDATE ON diary_state BEGIN SELECT RAISE(ABORT, 'test failure'); END;").unwrap();
    assert!(update(
        &db,
        state.revision,
        "move-record",
        &json!({"todoId":todo_id,"fromDate":"2026-10-04","toDate":"2026-10-05","title":"예약하기"})
    )
    .is_err());
    assert_eq!(read(&db).unwrap(), state);
    assert_eq!(storage::get(&db, &todo.id).unwrap().data, moved.data);
    assert_eq!(
        storage::get(&db, &todo.id).unwrap().revision,
        moved.revision
    );
}

#[test]
fn widget_links_validate_sources_deduplicate_by_item_and_never_change_the_original() {
    use crate::widgets::{storage, WidgetRequest};
    let db = database();
    storage::initialize(&db).unwrap();
    let directory = tempfile::tempdir().unwrap();
    storage::install(&db, directory.path(), &["memo".into(), "clock".into()]).unwrap();
    let widgets = storage::instances(&db).unwrap();
    let memo_id = &widgets
        .iter()
        .find(|widget| widget.kind == "memo")
        .unwrap()
        .id;
    let clock_id = &widgets
        .iter()
        .find(|widget| widget.kind == "clock")
        .unwrap()
        .id;
    for (index, title) in ["여행 메모", "모임 메모"].iter().enumerate() {
        let memo = storage::get(&db, memo_id).unwrap();
        storage::execute(
            &db,
            &WidgetRequest {
                request_id: new_id(),
                instance_id: memo.id,
                expected_revision: memo.revision,
                action: "add".into(),
                input: json!({"title":title,"body":"  원문\n둘째 줄  "}),
            },
            index as i64 + 1,
            index as u64 + 1,
        )
        .unwrap();
    }
    let original = storage::get(&db, memo_id).unwrap();
    let state = act(&db, "page-create", json!({"title":"","date":"2026-10-03"}));
    let page = state.pages[0].id.clone();
    for input in [
        json!({"pageId":page,"kind":"widget","refId":clock_id,"text":"시계"}),
        json!({"pageId":page,"kind":"widget","refId":memo_id,"itemId":original.data["notes"][0]["id"],"text":"여행 메모"}),
        json!({"pageId":page,"kind":"widget","refId":memo_id,"itemId":original.data["notes"][1]["id"],"text":"모임 메모"}),
    ] {
        let linked = act(&db, "entry-add", input.clone());
        assert_eq!(act(&db, "entry-add", input), linked);
    }
    let linked = read(&db).unwrap();
    assert_eq!(linked.pages[0].entries.len(), 3);
    for input in [
        json!({"pageId":page,"kind":"widget","refId":new_id(),"text":"없는 위젯"}),
        json!({"pageId":page,"kind":"widget","refId":memo_id,"itemId":"missing-note","text":"없는 메모"}),
        json!({"pageId":page,"kind":"widget","refId":clock_id,"itemId":original.data["notes"][0]["id"],"text":"잘못된 메모 소유자"}),
        json!({"pageId":page,"kind":"note","refId":memo_id,"itemId":original.data["notes"][0]["id"],"text":"잘못된 기록 종류"}),
    ] {
        assert!(update(&db, linked.revision, "entry-add", &input).is_err());
        assert_eq!(read(&db).unwrap(), linked);
    }
    act(
        &db,
        "entry-delete",
        json!({"pageId":page,"id":linked.pages[0].entries[1].id}),
    );
    act(&db, "page-delete", json!({"id":page}));
    let after = storage::get(&db, memo_id).unwrap();
    assert_eq!(after.data, original.data);
    assert_eq!(after.revision, original.revision);
    assert!(after.installed);

    storage::remove(&db, directory.path(), clock_id, false).unwrap();
    let state = act(&db, "page-create", json!({"title":"","date":"2026-10-04"}));
    assert!(update(
        &db,
        state.revision,
        "entry-add",
        &json!({"pageId":state.pages[0].id,"kind":"widget","refId":clock_id,"text":"제거한 시계"}),
    )
    .is_err());
    assert_eq!(read(&db).unwrap(), state);
}

#[test]
fn old_diary_entries_without_item_ids_remain_readable() {
    let db = database();
    let old = json!({
        "revision":7,
        "pages":[{"id":"page-1","title":"","date":"2026-10-03","entries":[
            {"id":"note-1","kind":"note","text":"  원문\n  "},
            {"id":"todo-1","kind":"todo","text":"예약","refId":"original-todo"},
            {"id":"event-1","kind":"event","text":"약속","time":"09:30"},
            {"id":"envelope-1","kind":"envelope","text":"준비","refId":"original-envelope"}
        ]}],
        "notes":[],"moves":[]
    });
    db.execute(
        "UPDATE diary_state SET data=?1 WHERE id=1",
        [old.to_string()],
    )
    .unwrap();
    let state = read(&db).unwrap();
    assert_eq!(state.revision, 7);
    assert!(state.pages[0]
        .entries
        .iter()
        .all(|entry| entry.item_id.is_none()));
    assert_eq!(serde_json::to_value(state).unwrap(), old);
}
