use super::*;
use std::time::Duration;

#[cfg(unix)]
fn fake_service(script: &str) -> (tempfile::TempDir, NlpService) {
    use std::os::unix::fs::PermissionsExt;
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("nlp");
    std::fs::create_dir_all(root.join("kiwi")).unwrap();
    std::fs::write(
        root.join("kiwi/verified-artifacts"),
        models::artifact_fingerprint(&models::manifest(ModelKind::Kiwi)),
    )
    .unwrap();
    std::fs::write(
        root.join("memory-search.json"),
        br#"{"kiwiEnabled":true,"semanticEnabled":false}"#,
    )
    .unwrap();
    let executable = directory.path().join("fake-helper");
    std::fs::write(&executable, format!("#!/bin/sh\n{script}\n")).unwrap();
    std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();
    let service = NlpService::new(
        directory.path().to_path_buf(),
        executable,
        directory.path().join("runtime"),
    )
    .unwrap();
    (directory, service)
}
#[cfg(unix)]
#[tokio::test]
async fn cold_search_returns_fallback_and_shutdown_interrupts_initialization() {
    // This owned process blocks reading stdin before ready; it creates no grandchildren.
    let (_directory, service) = fake_service("read pending; exit 0");
    let started = Instant::now();
    assert!(service.query("기억 검색").await.is_none());
    assert!(started.elapsed() < Duration::from_secs(1));
    for _ in 0..50 {
        if service.status().running {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert!(service.status().running);
    let started = Instant::now();
    service.shutdown().await;
    assert!(started.elapsed() < Duration::from_secs(5));
    assert!(!service.status().running);
}
#[cfg(unix)]
#[tokio::test]
async fn warm_timeout_kills_helper_and_cooldown_prevents_restart() {
    let script = r#"echo '{"version":1,"ready":true,"kiwi":true,"semantic":false,"errors":[]}'
read request
exec /bin/sleep 30"#;
    let (_directory, service) = fake_service(script);
    service.warmup();
    for _ in 0..100 {
        if service.status().kiwi.state == "ready" {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert_eq!(service.status().kiwi.state, "ready");
    let started = Instant::now();
    assert!(service.query("검색이 지연되는 경우").await.is_none());
    assert!(started.elapsed() < Duration::from_millis(2500));
    for _ in 0..100 {
        if !service.status().running {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert!(!service.status().running);
    service.warmup();
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(!service.status().running);
    assert_eq!(service.status().kiwi.state, "error");
    service.shutdown().await;
}
#[cfg(unix)]
#[tokio::test]
async fn previous_model_is_recovered_before_settings_and_profiles_are_loaded() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("nlp");
    std::fs::create_dir_all(root.join(".kiwi-previous")).unwrap();
    std::fs::write(
        root.join(".kiwi-previous/verified-artifacts"),
        models::artifact_fingerprint(&models::manifest(ModelKind::Kiwi)),
    )
    .unwrap();
    let service = NlpService::new(
        directory.path().to_path_buf(),
        PathBuf::from("/does-not-exist"),
        PathBuf::from("/does-not-exist"),
    )
    .unwrap();
    assert!(service.status().kiwi.installed);
    assert!(service.status().kiwi.profile.is_some());
    assert!(!service.status().kiwi.enabled);
    assert!(!root.join(".kiwi-previous").exists());
    service.shutdown().await;
}

#[test]
#[ignore = "Requires public fixture vectors from scripts/evaluate-nlp.py --export-vectors; does not access user data"]
fn evaluate_combined_search_from_native_fixture_vectors() {
    use crate::store;
    let path = std::env::var("COMET_NLP_EVAL_INPUT").expect("COMET_NLP_EVAL_INPUT is required");
    let data: serde_json::Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    let threshold = data["threshold"].as_f64().unwrap() as f32;
    let directory = tempfile::tempdir().unwrap();
    let db = store::open(&directory.path().join("evaluation.sqlite")).unwrap();
    let kiwi_profile = "public-fixture-kiwi";
    let semantic_profile = "public-fixture-e5";
    store::set_search_profile(&db, "kiwi", Some(kiwi_profile)).unwrap();
    store::set_search_profile(&db, "semantic", Some(semantic_profile)).unwrap();
    for memory in data["memories"].as_array().unwrap() {
        let id = memory["id"].as_str().unwrap();
        let content = memory["content"].as_str().unwrap();
        db.execute(
            "INSERT INTO memories(id,content,source,updated) VALUES(?1,?2,?1,0)",
            rusqlite::params![id, content],
        )
        .unwrap();
        let analysis: Analysis = serde_json::from_value(memory["analysis"].clone()).unwrap();
        let tokens = crate::memory_commands::search_terms(&analysis.tokens);
        assert!(store::save_kiwi_index(&db, id, 1, kiwi_profile, &tokens.join(" ")).unwrap());
        let vectors = analysis
            .embeddings
            .into_iter()
            .map(|embedding| store::MemoryEmbedding {
                window_start: embedding.start,
                window_end: embedding.end,
                vector: embedding.vector,
            })
            .collect::<Vec<_>>();
        assert!(store::save_vector_index(&db, id, 1, semantic_profile, &vectors).unwrap());
    }
    let mut reports = Vec::new();
    for mode in ["lexical", "kiwi", "combined"] {
        for split in ["calibration", "evaluation"] {
            let (mut recall, mut positives, mut negatives, mut false_positives) = (0.0, 0, 0, 0);
            for query in data["queries"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|q| q["split"] == split)
            {
                let analysis: Analysis = serde_json::from_value(query["analysis"].clone()).unwrap();
                let terms = if mode == "lexical" {
                    Vec::new()
                } else {
                    crate::memory_commands::search_terms(&analysis.tokens)
                };
                let semantic = if mode == "combined" {
                    Some((
                        semantic_profile,
                        analysis.embeddings[0].vector.as_slice(),
                        threshold,
                    ))
                } else {
                    None
                };
                let hits =
                    store::search_memories(&db, query["text"].as_str().unwrap(), &terms, semantic)
                        .unwrap();
                let relevant = query["relevant"].as_array().unwrap();
                if relevant.is_empty() {
                    negatives += 1;
                    if !hits.is_empty() {
                        false_positives += 1;
                    }
                } else {
                    positives += 1;
                    let found = hits
                        .iter()
                        .take(5)
                        .filter(|hit| relevant.iter().any(|id| id == &hit.memory.id))
                        .count();
                    recall += found as f64 / relevant.len() as f64;
                }
            }
            reports.push(serde_json::json!({"mode":mode,"split":split,"recallAt5":recall/positives as f64,
                "unrelatedFalsePositiveRate":false_positives as f64/negatives as f64,"relatedQueries":positives,"unrelatedQueries":negatives,"falsePositives":false_positives}));
        }
    }
    let report = serde_json::json!({"schema":1,"threshold":threshold,"source":"Actual Rust store::search_memories, native Kiwi and E5 vectors from public fixture","reports":reports});
    let json = serde_json::to_string_pretty(&report).unwrap();
    println!("{json}");
    if let Ok(path) = std::env::var("COMET_NLP_EVAL_RESULT") {
        std::fs::write(path, format!("{json}\n")).unwrap();
    }
}

#[test]
fn changing_search_policy_preserves_installation_and_invalidates_only_cache() {
    let original = models::manifest(ModelKind::Semantic);
    let mut changed = original.clone();
    changed.profile.push_str("-updated-pooling");
    changed.threshold = Some(0.91);
    assert_eq!(
        models::artifact_fingerprint(&original),
        models::artifact_fingerprint(&changed)
    );
    assert_ne!(
        models::fingerprint(&original),
        models::fingerprint(&changed)
    );
    changed.files[0].sha256 = "different-model".into();
    assert_ne!(
        models::artifact_fingerprint(&original),
        models::artifact_fingerprint(&changed)
    );
}
