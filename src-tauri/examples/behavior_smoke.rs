#[allow(dead_code, unused_imports)]
#[path = "../src/character_sprites.rs"]
mod character_sprites;
#[allow(dead_code, unused_imports)]
#[path = "../src/characters.rs"]
mod characters;
#[allow(dead_code)]
#[path = "../src/domain.rs"]
mod domain;
#[allow(dead_code)]
#[path = "../src/inference.rs"]
mod inference;
#[allow(dead_code)]
#[path = "../src/models.rs"]
mod models;
#[allow(dead_code, unused_imports)]
#[path = "../src/store.rs"]
mod store;
#[allow(dead_code)]
#[path = "../src/story.rs"]
mod story;
#[allow(dead_code, unused_imports)]
#[path = "../src/talk/mod.rs"]
mod talk;
#[allow(dead_code)]
#[path = "../src/types.rs"]
mod types;
#[allow(dead_code, unused_imports)]
#[path = "../src/widgets/mod.rs"]
mod widgets;
#[allow(dead_code)]
#[path = "../src/wordbook.rs"]
mod wordbook;

use serde_json::Value;
use std::{
    path::{Path, PathBuf},
    sync::{atomic::AtomicBool, Arc},
    time::Instant,
};

fn user(id: &str, content: &str, persona: &str) -> types::Message {
    types::Message {
        id: id.into(),
        role: "user".into(),
        persona: Some(persona.into()),
        content: content.into(),
        expression: None,
        created_at: chrono::Utc::now().timestamp_millis(),
        status: "complete".into(),
    }
}

async fn generate(
    runtime: &inference::Inference,
    label: &str,
    prompt: &[types::ChatMessage],
    schema: Value,
) -> Result<Value, String> {
    let started = Instant::now();
    let result = inference::generate(
        runtime,
        &types::Settings::default(),
        prompt,
        schema,
        768,
        Arc::new(AtomicBool::new(false)),
    )
    .await;
    match &result {
        Ok(value) => println!("{label} {:.2}s {value}", started.elapsed().as_secs_f64()),
        Err(error) => println!(
            "{label} {:.2}s ERROR {error}",
            started.elapsed().as_secs_f64()
        ),
    }
    result
}

fn check(issues: &mut Vec<String>, label: &str, passed: bool) {
    println!("CHECK {label}: {}", if passed { "PASS" } else { "FAIL" });
    if !passed {
        issues.push(label.into());
    }
}

async fn run(runtime: &inference::Inference) -> Result<(), String> {
    let conn = store::open(Path::new(":memory:"))?;
    let mut issues = Vec::new();
    for (id, text, target) in [
        ("fact", "나는 커피를 좋아해.", "a"),
        ("thanks", "고마워", "a"),
        ("correction", "정정할게. 나는 커피 말고 차를 좋아해.", "a"),
    ] {
        let message = user(id, text, target);
        store::insert_message(&conn, &message)?;
        let old = store::memories(&conn)?;
        let result = generate(
            runtime,
            id,
            &domain::analysis_prompt(
                std::slice::from_ref(&message),
                &old,
                store::revision(&conn)?,
            ),
            domain::analysis_schema(),
        )
        .await?;
        let grounded = ["memories", "events"].iter().all(|key| {
            result[*key].as_array().is_some_and(|items| {
                items.iter().all(|item| {
                    item["sourceMessageId"].as_str() == Some(id)
                        && item["evidence"]
                            .as_str()
                            .is_some_and(|quote| quote.chars().count() >= 2 && text.contains(quote))
                })
            })
        });
        check(
            &mut issues,
            &format!("{id} exact source evidence"),
            grounded,
        );
        store::analyze_apply(&conn, &result)?;
        let memories = store::memories(&conn)?;
        check(
            &mut issues,
            &format!("{id} no unrelated stored memories"),
            memories
                .iter()
                .all(|memory| ["fact", "correction"].contains(&memory.source_message_id.as_str())),
        );
        let relationships = store::relationships(&conn)?;
        println!(
            "stored memories={} relationships={}",
            serde_json::to_string(&memories).unwrap(),
            serde_json::to_string(&relationships).unwrap()
        );
        match id {
            "fact" => check(
                &mut issues,
                "fact retained",
                memories
                    .iter()
                    .any(|m| m.source_message_id == id && m.content.contains("커피")),
            ),
            "thanks" => check(
                &mut issues,
                "targeted thanks increases only A",
                relationships
                    .iter()
                    .all(|r| r.score == if r.persona == "a" { 21 } else { 20 }),
            ),
            _ => {
                check(
                    &mut issues,
                    "correction supersedes original",
                    memories.len() == 1
                        && memories[0].source_message_id == id
                        && memories[0].content.contains("차"),
                );
                check(
                    &mut issues,
                    "correction does not penalize affinity",
                    relationships.iter().all(|r| r.score >= 20),
                );
            }
        }
    }
    store::insert_message(
        &conn,
        &user(
            "both",
            "내가 좋아하는 음료를 기억해? 둘 다 한마디씩 해 줘.",
            "both",
        ),
    )?;
    for persona in ["a", "b"] {
        let relationship = store::relationships(&conn)?
            .into_iter()
            .find(|r| r.persona == persona)
            .unwrap();
        let prompt = domain::prompt_messages(
            persona,
            &characters::active_character(&conn, persona)?.definition,
            &store::context_messages_for(&conn, 20, persona)?,
            &store::memories(&conn)?,
            &relationship,
        );
        let reply = match generate(
            runtime,
            &format!("reply-{persona}"),
            &prompt,
            domain::reply_schema(),
        )
        .await
        .and_then(domain::parse_reply)
        {
            Ok(reply) => reply,
            Err(error) => {
                issues.push(format!("reply-{persona}: {error}"));
                continue;
            }
        };
        check(
            &mut issues,
            &format!("reply-{persona} identity"),
            reply.persona == persona,
        );
        check(
            &mut issues,
            &format!("reply-{persona} corrected preference"),
            reply.text.contains("차")
                && !["둘 다", "둘다", "모두", "두 가지", "커피도 좋아"]
                    .iter()
                    .any(|phrase| reply.text.contains(phrase)),
        );
        store::insert_message(
            &conn,
            &types::Message {
                id: format!("reply-{persona}"),
                role: "assistant".into(),
                persona: Some(reply.persona),
                content: reply.text,
                expression: Some(reply.expression),
                created_at: chrono::Utc::now().timestamp_millis(),
                status: "complete".into(),
            },
        )?;
    }
    let revision = store::revision(&conn)?;
    let members = [
        characters::active_character(&conn, "a")?,
        characters::active_character(&conn, "b")?,
    ];
    let targets = members
        .iter()
        .map(|member| member.id.clone())
        .collect::<Vec<_>>();
    let value = generate(
        runtime,
        "idle-scene",
        &domain::roster_scene_prompt(
            &members,
            &store::memories(&conn)?,
            &store::relationships(&conn)?,
            false,
        ),
        domain::scene_schema_for(&targets, 2, 4),
    )
    .await?;
    let lines = domain::parse_lines_for(value, &targets, 2, 4, false)?;
    store::add_scene(
        &conn,
        &types::PreparedScene {
            id: "smoke-scene".into(),
            revision,
            lines,
        },
    )?;
    check(
        &mut issues,
        "idle scene persisted",
        store::prepared_scenes(&conn)?.len() == 1,
    );
    store::insert_message(&conn, &user("interrupt", "잠깐, 내 얘기부터 들어 줘.", "a"))?;
    check(
        &mut issues,
        "new user input invalidates idle scene",
        store::prepared_scenes(&conn)?.is_empty(),
    );
    if issues.is_empty() {
        Ok(())
    } else {
        Err(format!("Behavior checks failed: {}", issues.join(", ")))
    }
}

#[tokio::main]
async fn main() -> Result<(), String> {
    let app_data = PathBuf::from(
        std::env::args()
            .nth(1)
            .ok_or("Pass the existing verified model cache directory")?,
    );
    if !models::model_ready(&app_data, types::LocalModel::default()) {
        return Err("Verified model is absent; this smoke does not download models".into());
    }
    let binaries = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries");
    let name = if cfg!(windows) {
        "llama-server-x86_64-pc-windows-msvc.exe"
    } else {
        "llama-server-aarch64-apple-darwin"
    };
    let runtime =
        inference::Inference::new(app_data, binaries.join(name), binaries.join("runtime"));
    let result = run(&runtime).await;
    inference::stop_local(&runtime).await;
    println!(
        "local_running_after_stop={}",
        inference::is_local_running(&runtime, &types::Settings::default()).await
    );
    result
}
