use super::*;

fn members(count: usize) -> Vec<InstalledCharacter> {
    let db = crate::store::open(std::path::Path::new(":memory:")).unwrap();
    let template = crate::characters::active_members(&db).unwrap().remove(0);
    (0..count)
        .map(|index| {
            let mut member = template.clone();
            member.id = format!("character-{index}");
            member.definition.name = format!("친구 {index}");
            member.definition.personality = "배 주스를 좋아한다.".into();
            member.definition.description.clear();
            member.definition.instructions.clear();
            member.definition.relationships.clear();
            member
        })
        .collect()
}

fn message(id: &str, role: &str, persona: &str, text: &str) -> Message {
    Message {
        id: id.into(),
        role: role.into(),
        persona: Some(persona.into()),
        content: text.into(),
        expression: None,
        created_at: 1,
        status: "complete".into(),
    }
}

fn user_fact(keeper: &str) -> Memory {
    Memory {
        id: "tea-fact".into(),
        character_id: keeper.into(),
        user_id: "current-user".into(),
        user_name: "사용자".into(),
        kind: "user_fact".into(),
        content: "나는 지금 차를 좋아해.".into(),
        source_message_id: "fact-source".into(),
        source_text: "나는 지금 차를 좋아해.".into(),
        ..Memory::default()
    }
}

fn context(prompt: &[ChatMessage]) -> Value {
    assert_eq!(prompt[1].role, "user");
    serde_json::from_str(&prompt[1].content).unwrap()
}

#[test]
fn single_turn_keeps_fact_subject_settings_and_actual_speakers_separate() {
    let cast = members(1);
    let actor = &cast[0].id;
    let stated = message("user-statement", "user", actor, "나는 차를 좋아해.");
    let spoken = message("actual-coffee", "assistant", actor, "나는 커피를 좋아해.");
    let latest = message("latest", "user", actor, "내 취향과 실제 발언을 구별해 줘.");
    let fact = user_fact(actor);
    let prompt = roster_turn_prompt(
        &cast,
        &[vec![stated.clone(), spoken.clone(), latest.clone()]],
        std::slice::from_ref(&fact),
        &[],
        &latest,
        &cast,
        0,
    );
    let data = context(&prompt);
    assert_eq!(data["pastSpeechStatus"], "records_only");
    assert_eq!(prompt[2].role, "user");
    assert_eq!(prompt[2].content, latest.content);
    assert_eq!(data["characterSettings"][0]["persona"], *actor);
    assert_eq!(
        data["characterSettings"][0]["personality"],
        cast[0].definition.personality
    );
    assert_eq!(data["userFacts"].as_array().unwrap().len(), 1);
    assert_eq!(data["userFacts"][0]["subjectUserId"], "current-user");
    assert_eq!(data["userFacts"][0]["keeperCharacterId"], *actor);
    assert_eq!(data["userFacts"][0]["sourceMessageId"], "fact-source");
    assert_eq!(data["userFacts"][0]["text"], fact.content);
    assert_eq!(data["userFacts"][0]["usableAsCurrentUserFact"], true);
    assert!(data["memoryReferences"].as_array().unwrap().is_empty());

    let records = data["utteranceRecords"].as_array().unwrap();
    assert_eq!(records.len(), 2);
    assert_eq!(records[0]["id"], stated.id);
    assert_eq!(records[0]["speaker"], json!({"role":"user"}));
    assert_eq!(records[0]["text"], stated.content);
    assert_eq!(records[1]["id"], spoken.id);
    assert_eq!(
        records[1]["speaker"],
        json!({"role":"assistant","characterId":actor})
    );
    assert_eq!(records[1]["text"], spoken.content);
    assert!(records.iter().all(|record| record["partial"] == false));
    assert!(records.iter().all(|record| record["id"] != "fact-source"));
}

#[test]
fn multiple_listeners_keep_distinct_authorized_utterance_lists() {
    let cast = members(2);
    let latest = message("latest", "user", &cast[0].id, "각자 들은 말만 구별해 줘.");
    let first_user = message("first-user", "user", &cast[0].id, "차를 좋아해.");
    let first_reply = message(
        "first-coffee",
        "assistant",
        &cast[0].id,
        "나는 커피를 좋아해.",
    );
    let second_reply = message(
        "second-cocoa",
        "assistant",
        &cast[1].id,
        "나는 코코아를 좋아해.",
    );
    let prompt = roster_turn_prompt(
        &cast,
        &[
            vec![first_user.clone(), first_reply.clone(), latest.clone()],
            vec![second_reply.clone(), latest.clone()],
        ],
        &[user_fact(&cast[0].id)],
        &[],
        &latest,
        &cast,
        0,
    );
    let data = context(&prompt);
    assert_eq!(data["latestUser"], latest.content);
    assert_eq!(data["characterSettings"].as_array().unwrap().len(), 2);
    let listeners = data["utteranceRecords"].as_array().unwrap();
    assert_eq!(listeners.len(), 2);
    assert_eq!(listeners[0]["listenerId"], cast[0].id);
    assert_eq!(listeners[1]["listenerId"], cast[1].id);
    let first = listeners[0]["messages"].as_array().unwrap();
    let second = listeners[1]["messages"].as_array().unwrap();
    assert_eq!(first.len(), 2);
    assert_eq!(second.len(), 1);
    assert_eq!(first[0]["id"], first_user.id);
    assert_eq!(first[0]["speaker"], json!({"role":"user"}));
    assert_eq!(first[1]["id"], first_reply.id);
    assert_eq!(
        first[1]["speaker"],
        json!({"role":"assistant","characterId":cast[0].id})
    );
    assert_eq!(second[0]["id"], second_reply.id);
    assert_eq!(
        second[0]["speaker"],
        json!({"role":"assistant","characterId":cast[1].id})
    );
    assert!(first.iter().all(|record| record["id"] != second_reply.id));
    assert!(second.iter().all(|record| record["id"] != first_reply.id));
    assert_eq!(data["userFacts"][0]["subjectUserId"], "current-user");
    assert_eq!(data["userFacts"][0]["keeperCharacterId"], cast[0].id);
}

#[test]
fn quoted_sources_and_references_do_not_create_character_utterances_or_current_facts() {
    let cast = members(1);
    let actor = &cast[0].id;
    let latest = message(
        "user-report",
        "user",
        actor,
        "친구가 ‘나는 커피를 좋아해’라고 했다는 인용이야.",
    );
    let memories = [
        Memory {
            id: "note".into(),
            kind: "note".into(),
            content: "친구가 ‘나는 커피를 좋아해’라고 했다는 메모.".into(),
            source_text: "나는 커피를 좋아해.".into(),
            ..user_fact(actor)
        },
        Memory {
            id: "experience".into(),
            kind: "experience".into(),
            content: "함께 음료 취향을 이야기했다.".into(),
            source_text: "나는 커피를 좋아해.".into(),
            ..user_fact(actor)
        },
        Memory {
            id: "former-fact".into(),
            user_id: "former-user".into(),
            retired_at: Some(1),
            ..user_fact(actor)
        },
    ];
    let prompt = roster_turn_prompt(
        &cast,
        &[vec![latest.clone()]],
        &memories,
        &[],
        &latest,
        &cast,
        0,
    );
    let data = context(&prompt);
    assert_eq!(prompt.last().unwrap().content, latest.content);
    assert!(data["utteranceRecords"].as_array().unwrap().is_empty());
    assert_eq!(data["pastSpeechStatus"], "unknown");
    assert_eq!(data["userFacts"].as_array().unwrap().len(), 1);
    assert_eq!(data["userFacts"][0]["id"], "former-fact");
    assert_eq!(data["userFacts"][0]["subjectUserId"], "former-user");
    assert_eq!(data["userFacts"][0]["personContext"], "other_person");
    assert_eq!(data["userFacts"][0]["usableAsCurrentUserFact"], false);
    let references = data["memoryReferences"].as_array().unwrap();
    assert_eq!(references.len(), 2);
    assert_eq!(references[0]["kind"], "note");
    assert_eq!(references[1]["kind"], "experience");
    assert!(references
        .iter()
        .all(|memory| memory["usableAsCurrentUserFact"] == false));
    assert!(references
        .iter()
        .all(|memory| memory["sourceText"] == "나는 커피를 좋아해."));

    let scene = context(&roster_scene_prompt(&cast, &memories, &[], false, &cast));
    assert!(scene["utteranceRecords"].as_array().unwrap().is_empty());
}

#[test]
fn escaped_partial_histories_keep_ids_speakers_prefixes_and_the_roster_budget() {
    let cast = members(2);
    let text = "\0\\\"😀 긴 발언\n".repeat(200);
    let latest = message(
        "latest",
        "user",
        &cast[0].id,
        "마지막 질문을 그대로 남겨 줘.",
    );
    let first = message("long-first", "assistant", &cast[0].id, &text);
    let second = message("long-second", "assistant", &cast[1].id, &text);
    let reserved = 1200;
    let prompt = roster_turn_prompt(
        &cast,
        &[
            vec![first.clone(), latest.clone()],
            vec![second.clone(), latest.clone()],
        ],
        &[],
        &[],
        &latest,
        &cast,
        reserved,
    );
    assert!(
        prompt
            .iter()
            .map(|message| message.content.len() + 40)
            .sum::<usize>()
            + reserved
            <= PAIR_PROMPT_BYTES
    );
    let data = context(&prompt);
    assert_eq!(data["latestUser"], latest.content);
    for (index, original) in [first, second].iter().enumerate() {
        let records = data["utteranceRecords"][index]["messages"]
            .as_array()
            .unwrap();
        assert_eq!(records.len(), 1);
        let record = &records[0];
        assert_eq!(record["id"], original.id);
        assert_eq!(
            record["speaker"],
            json!({"role":"assistant","characterId":original.persona})
        );
        assert_eq!(record["partial"], true);
        let included = record["text"].as_str().unwrap();
        assert!(!included.is_empty());
        assert!(original.content.starts_with(included));
        assert!(included.len() < original.content.len());
    }
}

#[test]
fn single_past_speech_status_counts_only_included_own_assistant_text() {
    let cast = members(2);
    let own = &cast[0].id;
    let latest = message("latest", "user", own, "친구가 ‘좋아해’라고 한 인용이야.");
    for earlier in [
        message("user-quote", "user", own, "친구가 ‘좋아해’라고 말했어."),
        message("other-speaker", "assistant", &cast[1].id, "좋아해."),
        Message {
            status: "failed".into(),
            ..message("failed", "assistant", own, "좋아해.")
        },
    ] {
        let prompt = roster_turn_prompt(
            &cast[..1],
            &[vec![earlier, latest.clone()]],
            &[],
            &[],
            &latest,
            &cast,
            0,
        );
        assert_eq!(context(&prompt)["pastSpeechStatus"], "unknown");
    }

    let spoken = message("own-long-record", "assistant", own, &"긴 발언 ".repeat(200));
    let prompt = roster_turn_prompt(
        &cast[..1],
        &[vec![spoken.clone(), latest.clone()]],
        &[],
        &[],
        &latest,
        &cast,
        0,
    );
    let data = context(&prompt);
    assert_eq!(data["pastSpeechStatus"], "records_only");
    assert_eq!(data["utteranceRecords"][0]["partial"], true);
    let included = data["utteranceRecords"][0]["text"].as_str().unwrap();
    assert!(!included.is_empty() && spoken.content.starts_with(included));

    let huge = message("huge", "user", own, &"긴 질문 ".repeat(2000));
    let prompt = roster_turn_prompt(
        &cast[..1],
        &[vec![spoken, huge.clone()]],
        &[],
        &[],
        &huge,
        &cast,
        0,
    );
    let data = context(&prompt);
    assert!(data["utteranceRecords"].as_array().unwrap().is_empty());
    assert_eq!(data["pastSpeechStatus"], "unknown");
    assert!(huge.content.starts_with(&prompt[2].content));
    assert!(
        prompt
            .iter()
            .map(|message| message.content.len() + 40)
            .sum::<usize>()
            <= PAIR_PROMPT_BYTES
    );
}
