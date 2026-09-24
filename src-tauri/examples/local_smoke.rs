#[allow(dead_code, unused_imports)]
#[path = "../src/character_animation.rs"]
mod character_animation;
#[allow(dead_code, unused_imports)]
#[path = "../src/character_reactions.rs"]
mod character_reactions;
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
#[path = "../src/legacy_names.rs"]
mod legacy_names;
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
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
    time::Instant,
};

#[tokio::main]
async fn main() -> Result<(), String> {
    let app_data = PathBuf::from(
        std::env::args()
            .nth(1)
            .ok_or("Pass a directory for the model cache")?,
    );
    let last = Arc::new(AtomicU64::new(u64::MAX));
    models::download_model(
        &app_data,
        types::LocalModel::default(),
        Arc::new(AtomicBool::new(false)),
        move |progress| {
            let percent = progress.received * 100 / progress.total.max(1);
            if last.swap(percent, Ordering::Relaxed) != percent || progress.status != "downloading"
            {
                println!("download {}% {}", percent, progress.status);
            }
        },
    )
    .await?;
    let binaries = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries");
    let name = if cfg!(windows) {
        "llama-server-x86_64-pc-windows-msvc.exe"
    } else {
        "llama-server-aarch64-apple-darwin"
    };
    let runtime =
        inference::Inference::new(app_data, binaries.join(name), binaries.join("runtime"));
    let settings = types::Settings::default();
    let messages = vec![types::Message {
        id: "smoke-user".into(),
        role: "user".into(),
        persona: Some("a".into()),
        content: "안녕. 나는 민수야. 오늘 처음 만났어.".into(),
        expression: None,
        created_at: 0,
        status: "complete".into(),
    }];
    let prompt = domain::prompt_messages(
        "a",
        &characters::active_character(&store::open(std::path::Path::new(":memory:"))?, "a")?
            .definition,
        &messages,
        &[],
        &types::Relationship {
            persona: "a".into(),
            score: 20,
        },
        &[],
    );
    for pass in ["cold", "warm"] {
        let at = Instant::now();
        let result = inference::generate(
            &runtime,
            &settings,
            &prompt,
            domain::reply_schema(),
            256,
            Arc::new(AtomicBool::new(false)),
        )
        .await;
        match result {
            Ok(value) => println!(
                "{pass}: {:.2}s {}",
                at.elapsed().as_secs_f64(),
                serde_json::to_string(&domain::parse_reply(value)?).map_err(|e| e.to_string())?
            ),
            Err(error) => {
                inference::stop_local(&runtime).await;
                return Err(error);
            }
        }
    }
    let cancel = Arc::new(AtomicBool::new(false));
    let signal = cancel.clone();
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        signal.store(true, Ordering::SeqCst);
    });
    let at = Instant::now();
    let result = inference::generate(
        &runtime,
        &settings,
        &prompt,
        domain::reply_schema(),
        256,
        cancel,
    )
    .await;
    println!(
        "cancel: {:.2}s error={}",
        at.elapsed().as_secs_f64(),
        result.is_err()
    );
    inference::stop_local(&runtime).await;
    println!(
        "local_running_after_stop={}",
        inference::is_local_running(&runtime, &settings).await
    );
    Ok(())
}
