use crate::types::{DownloadProgress, LocalModel, LocalModelStatus, Settings};
use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

struct ModelSpec {
    name: &'static str,
    description: &'static str,
    file: &'static str,
    size: u64,
    sha256: &'static str,
    url: &'static str,
}

const CATALOG: [LocalModel; 8] = [
    LocalModel::Qwen35_4B,
    LocalModel::Qwen35_9B,
    LocalModel::Qwen38_2B,
    LocalModel::Qwen38_4B,
    LocalModel::Qwen38_9B,
    LocalModel::Gemma4E4B,
    LocalModel::Gemma4_12B,
    LocalModel::Ministral3_8B,
];

fn spec(model: LocalModel) -> Option<ModelSpec> {
    Some(match model {
        LocalModel::Qwen35_4B => ModelSpec {
            name: "Qwen3.5-4B", description: "기본 · 가벼운 모델", file: "Qwen3.5-4B-Q4_K_M.gguf", size: 2_740_937_888,
            sha256: "00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4",
            url: "https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/e87f176479d0855a907a41277aca2f8ee7a09523/Qwen3.5-4B-Q4_K_M.gguf",
        },
        LocalModel::Qwen35_9B => ModelSpec {
            name: "Qwen3.5-9B", description: "메모리를 더 사용하는 모델", file: "Qwen3.5-9B-Q4_K_M.gguf", size: 5_680_522_464,
            sha256: "03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8",
            url: "https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/resolve/3885219b6810b007914f3a7950a8d1b469d598a5/Qwen3.5-9B-Q4_K_M.gguf",
        },
        LocalModel::Qwen38_2B => ModelSpec {
            name: "Qwen3.8-2B-Distill", description: "가장 가벼운 실험용", file: "Qwen3.8-2B-Q4_K_M.gguf", size: 1_312_164_224,
            sha256: "4aa0fb13c431514262f259d420ecc95a8714df58ac2a2384514e20b93983f0ff",
            url: "https://huggingface.co/empero-ai/Qwen3.8-2B-Distill-GGUF/resolve/f4f73582d0b149595450c719b9a7521a03894f9c/Qwen3.8-2B-Q4_K_M.gguf",
        },
        LocalModel::Qwen38_4B => ModelSpec {
            name: "Qwen3.8-4B-Distill", description: "상시 구동 후보", file: "Qwen3.8-4B-Q4_K_M.gguf", size: 2_783_446_304,
            sha256: "dec96e8cf2e11b613bb46513dec485377f9ca5a351e71712ee0e244f287c6790",
            url: "https://huggingface.co/empero-ai/Qwen3.8-4B-Distill-GGUF/resolve/391fc7d103e3942a408def3e4f51c2f85d464417/Qwen3.8-4B-Q4_K_M.gguf",
        },
        LocalModel::Qwen38_9B => ModelSpec {
            name: "Qwen3.8-9B-Distill", description: "Qwen 계열 품질 상한", file: "Qwen3.8-9B-Q4_K_M.gguf", size: 5_780_090_176,
            sha256: "df13d66021cef676f82be74053220fd75af6bf2a6a7fb77f5222ab9e50744a7a",
            url: "https://huggingface.co/empero-ai/Qwen3.8-9B-Distill-GGUF/resolve/760121cd70bb4c36b2b5ec58eb765e0df5987efe/Qwen3.8-9B-Q4_K_M.gguf",
        },
        LocalModel::Gemma4E4B => ModelSpec {
            name: "Gemma 4 E4B", description: "Qwen 외 4B급 비교용", file: "gemma-4-E4B-it-Q4_K_M.gguf", size: 4_977_171_584,
            sha256: "85a896a047553e842f25297ee5b031d64ff30147d9c4af17b1e4b394cd1fab87",
            url: "https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/bfc15c382204943c3a8fff0c750b94ae2364d7a3/gemma-4-E4B-it-Q4_K_M.gguf",
        },
        LocalModel::Gemma4_12B => ModelSpec {
            name: "Gemma 4 12B", description: "고품질 비교용 · 메모리 많이 사용", file: "gemma-4-12b-it-Q4_K_M.gguf", size: 7_121_861_440,
            sha256: "0a270ec9fe6b34f4a0d33992b6135117b484ebc4766ab76b51d4ae8c457e4c42",
            url: "https://huggingface.co/unsloth/gemma-4-12b-it-GGUF/resolve/fc034cfff751157913579611efad8462ac1be606/gemma-4-12b-it-Q4_K_M.gguf",
        },
        LocalModel::Ministral3_8B => ModelSpec {
            name: "Ministral 3 8B", description: "Mistral 계열 비교용", file: "Ministral-3-8B-Instruct-2512-Q4_K_M.gguf", size: 5_198_386_720,
            sha256: "5dbc3647eb563b9f8d3c70ec3d906cce84b86bb35c5e0b8a36e7df3937ab7174",
            url: "https://huggingface.co/unsloth/Ministral-3-8B-Instruct-2512-GGUF/resolve/3731507ec3e867db16d620f73e14d689125758f4/Ministral-3-8B-Instruct-2512-Q4_K_M.gguf",
        },
        LocalModel::Custom => return None,
    })
}

pub fn model_path(app_data: &Path, model: LocalModel) -> Option<PathBuf> {
    Some(app_data.join("models").join(spec(model)?.file))
}

pub fn model_ready(app_data: &Path, model: LocalModel) -> bool {
    let (Some(spec), Some(path)) = (spec(model), model_path(app_data, model)) else {
        return false;
    };
    path.metadata()
        .map(|m| m.len() == spec.size)
        .unwrap_or(false)
        && std::fs::read_to_string(path.with_extension("verified"))
            .map(|s| s == verification_stamp(&path, spec.sha256).unwrap_or_default())
            .unwrap_or(false)
}

pub fn custom_model_path(settings: &Settings) -> Option<PathBuf> {
    let path = PathBuf::from(settings.local_model_path.trim());
    (path.is_absolute()
        && path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("gguf")))
    .then_some(path)
}

pub fn selected_path(app_data: &Path, settings: &Settings) -> Option<PathBuf> {
    if settings.local_model == LocalModel::Custom {
        custom_model_path(settings)
    } else {
        model_path(app_data, settings.local_model)
    }
}

pub fn selected_ready(app_data: &Path, settings: &Settings) -> bool {
    if settings.local_model == LocalModel::Custom {
        custom_model_path(settings).is_some_and(|path| path.is_file())
    } else {
        model_ready(app_data, settings.local_model)
    }
}

pub fn model_statuses(app_data: &Path) -> Vec<LocalModelStatus> {
    CATALOG
        .into_iter()
        .filter_map(|model| Some((model, spec(model)?, model_path(app_data, model)?)))
        .map(|(model, spec, path)| {
            let ready = model_ready(app_data, model);
            let downloaded_bytes = if ready {
                spec.size
            } else {
                path.with_extension("part")
                    .metadata()
                    .or_else(|_| path.metadata())
                    .map(|m| m.len().min(spec.size))
                    .unwrap_or(0)
            };
            LocalModelStatus {
                id: model,
                name: spec.name.into(),
                description: spec.description.into(),
                size: spec.size,
                ready,
                downloaded_bytes,
            }
        })
        .collect()
}

fn verification_stamp(path: &Path, hash: &str) -> Result<String, String> {
    let metadata = std::fs::metadata(path).map_err(|_| "모델 상태를 확인할 수 없습니다.")?;
    let modified = metadata
        .modified()
        .map_err(|_| "모델 수정 시간을 확인할 수 없습니다.")?
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "모델 수정 시간이 올바르지 않습니다.")?;
    Ok(format!("{hash}:{}:{}", metadata.len(), modified.as_nanos()))
}

pub async fn cancelled(cancel: Arc<AtomicBool>) {
    while !cancel.load(Ordering::Acquire) {
        tokio::time::sleep(Duration::from_millis(40)).await;
    }
}

fn resume_range(value: &str, offset: u64, total: u64) -> bool {
    let Some(range) = value.strip_prefix("bytes ") else {
        return false;
    };
    let Some((span, size)) = range.split_once('/') else {
        return false;
    };
    let Some((start, end)) = span.split_once('-') else {
        return false;
    };
    start.parse::<u64>().ok() == Some(offset)
        && end.parse::<u64>().ok() == total.checked_sub(1)
        && size.parse::<u64>().ok() == Some(total)
}

async fn verify(path: &Path, expected: &str, cancel: Arc<AtomicBool>) -> Result<(), String> {
    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|_| "모델 파일을 열 수 없습니다.")?;
    let mut digest = Sha256::new();
    let mut buffer = vec![0; 1024 * 1024];
    loop {
        if cancel.load(Ordering::Acquire) {
            return Err("취소됨".into());
        }
        let count = file
            .read(&mut buffer)
            .await
            .map_err(|_| "모델 파일을 읽을 수 없습니다.")?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    if hex::encode(digest.finalize()) != expected {
        return Err("모델 파일 검증에 실패했습니다. 다시 다운로드해 주세요.".into());
    }
    Ok(())
}

pub async fn download_model(
    app_data: &Path,
    model: LocalModel,
    cancel: Arc<AtomicBool>,
    progress: impl Fn(DownloadProgress) + Send + Sync,
) -> Result<(), String> {
    let selected = spec(model).ok_or("직접 지정한 모델 파일은 내려받지 않아요.")?;
    let result = if cancel.load(Ordering::Acquire) {
        Err("취소됨".into())
    } else if model_ready(app_data, model) {
        progress(DownloadProgress {
            model,
            error: None,
            received: selected.size,
            total: selected.size,
            status: "ready".into(),
        });
        return Ok(());
    } else {
        download(
            app_data,
            model,
            selected.url,
            selected.size,
            selected.sha256,
            cancel.clone(),
            &progress,
        )
        .await
    };
    if result.is_err() {
        let received = tokio::fs::metadata(
            app_data
                .join("models")
                .join(selected.file)
                .with_extension("part"),
        )
        .await
        .map(|m| m.len().min(selected.size))
        .unwrap_or(0);
        progress(DownloadProgress {
            model,
            error: result.as_ref().err().cloned(),
            received,
            total: selected.size,
            status: if cancel.load(Ordering::Acquire) {
                "cancelled"
            } else {
                "error"
            }
            .into(),
        });
    }
    result
}

async fn download(
    app_data: &Path,
    model: LocalModel,
    url: &str,
    total: u64,
    hash: &str,
    cancel: Arc<AtomicBool>,
    progress: impl Fn(DownloadProgress) + Send + Sync,
) -> Result<(), String> {
    let path = model_path(app_data, model).ok_or("직접 지정한 모델 파일은 내려받지 않아요.")?;
    tokio::fs::create_dir_all(app_data.join("models"))
        .await
        .map_err(|_| "모델 폴더를 만들 수 없습니다.")?;
    let partial = path.with_extension("part");
    let mut received = tokio::fs::metadata(&partial)
        .await
        .map(|m| m.len())
        .unwrap_or(0);
    if received > total {
        tokio::fs::remove_file(&partial)
            .await
            .map_err(|_| "잘못된 임시 모델 파일을 지울 수 없습니다.")?;
        received = 0;
    }
    if received < total {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(20))
            .read_timeout(Duration::from_secs(60))
            .build()
            .map_err(|_| "다운로드 클라이언트 초기화 실패")?;
        let mut request = client.get(url).header("Accept-Encoding", "identity");
        if received > 0 {
            request = request.header(reqwest::header::RANGE, format!("bytes={received}-"));
        }
        let response = tokio::select! {
            _ = cancelled(cancel.clone()) => return Err("취소됨".into()),
            result = request.send() => result.map_err(|_| "모델 서버에 연결할 수 없습니다. 네트워크를 확인해 주세요.")?,
        };
        if response.status() == reqwest::StatusCode::PARTIAL_CONTENT {
            let range = response
                .headers()
                .get(reqwest::header::CONTENT_RANGE)
                .and_then(|h| h.to_str().ok())
                .unwrap_or("");
            if !resume_range(range, received, total) {
                return Err("서버의 이어받기 범위가 일치하지 않습니다.".into());
            }
        } else if response.status() == reqwest::StatusCode::OK {
            received = 0;
        } else {
            return Err(format!(
                "모델 다운로드 실패 (HTTP {}).",
                response.status().as_u16()
            ));
        }
        if response
            .content_length()
            .is_some_and(|len| len != total - received)
        {
            return Err("모델 다운로드 크기가 예상과 다릅니다.".into());
        }
        let mut file = tokio::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .append(received > 0)
            .truncate(received == 0)
            .open(&partial)
            .await
            .map_err(|_| "임시 모델 파일을 만들 수 없습니다.")?;
        progress(DownloadProgress {
            model,
            error: None,
            received,
            total,
            status: "downloading".into(),
        });
        let mut last_progress = std::time::Instant::now();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = tokio::select! { _ = cancelled(cancel.clone()) => return Err("취소됨".into()), item = stream.next() => item }
        {
            let chunk = chunk
                .map_err(|_| "모델 다운로드가 중단되었습니다. 이어받기를 다시 시도해 주세요.")?;
            if received + chunk.len() as u64 > total {
                return Err("모델 응답이 예상 크기를 초과했습니다.".into());
            }
            file.write_all(&chunk)
                .await
                .map_err(|_| "모델 저장 실패. 디스크 공간을 확인해 주세요.")?;
            received += chunk.len() as u64;
            if last_progress.elapsed() >= Duration::from_millis(250) {
                progress(DownloadProgress {
                    model,
                    error: None,
                    received,
                    total,
                    status: "downloading".into(),
                });
                last_progress = std::time::Instant::now();
            }
        }
        file.sync_all()
            .await
            .map_err(|_| "모델 저장을 완료할 수 없습니다.")?;
    }
    if received != total {
        return Err("모델 다운로드가 완료되지 않았습니다. 다시 이어받아 주세요.".into());
    }
    progress(DownloadProgress {
        model,
        error: None,
        received,
        total,
        status: "verifying".into(),
    });
    if let Err(error) = verify(&partial, hash, cancel.clone()).await {
        if !cancel.load(Ordering::Acquire) {
            let _ = tokio::fs::remove_file(&partial).await;
        }
        return Err(error);
    }
    tokio::fs::rename(&partial, &path)
        .await
        .map_err(|_| "검증한 모델 파일을 적용할 수 없습니다.")?;
    tokio::fs::write(
        path.with_extension("verified"),
        verification_stamp(&path, hash)?,
    )
    .await
    .map_err(|_| "모델 검증 상태를 저장할 수 없습니다.")?;
    progress(DownloadProgress {
        model,
        error: None,
        received,
        total,
        status: "ready".into(),
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn selected_models_have_isolated_files_and_progress() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::create_dir(directory.path().join("models")).unwrap();
        let four = model_path(directory.path(), LocalModel::Qwen35_4B).unwrap();
        let nine = model_path(directory.path(), LocalModel::Qwen35_9B).unwrap();
        assert_ne!(four, nine);
        std::fs::write(four.with_extension("part"), b"partial-four").unwrap();
        std::fs::write(nine.with_extension("part"), b"nine").unwrap();
        let statuses = model_statuses(directory.path());
        assert_eq!(statuses[0].downloaded_bytes, 12);
        assert_eq!(statuses[1].downloaded_bytes, 4);
        assert!(statuses.iter().all(|status| !status.ready));
        let events = std::sync::Mutex::new(Vec::new());
        let _ = download_model(
            directory.path(),
            LocalModel::Qwen35_9B,
            Arc::new(AtomicBool::new(true)),
            |event| events.lock().unwrap().push(event),
        )
        .await;
        let events = events.into_inner().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].model, LocalModel::Qwen35_9B);
        assert_eq!(events[0].error.as_deref(), Some("취소됨"));
        assert_eq!(events[0].received, 4);
        assert_eq!(events[0].total, 5_680_522_464);
        assert_eq!(
            std::fs::read(four.with_extension("part")).unwrap(),
            b"partial-four"
        );
        let file = std::fs::File::create(&four).unwrap();
        file.set_len(spec(LocalModel::Qwen35_4B).unwrap().size)
            .unwrap();
        std::fs::write(
            four.with_extension("verified"),
            verification_stamp(&four, spec(LocalModel::Qwen35_4B).unwrap().sha256).unwrap(),
        )
        .unwrap();
        assert!(model_ready(directory.path(), LocalModel::Qwen35_4B));
        assert!(!model_ready(directory.path(), LocalModel::Qwen35_9B));
    }
    #[test]
    fn catalog_lists_every_pinned_model_once_and_excludes_custom() {
        let directory = tempfile::tempdir().unwrap();
        let statuses = model_statuses(directory.path());
        assert_eq!(statuses.len(), CATALOG.len());
        assert!(statuses
            .iter()
            .all(|status| status.id != LocalModel::Custom));
        let mut files: Vec<_> = CATALOG
            .iter()
            .map(|model| spec(*model).unwrap().file)
            .collect();
        files.sort_unstable();
        files.dedup();
        assert_eq!(files.len(), CATALOG.len());
        for model in CATALOG {
            let spec = spec(model).unwrap();
            assert_eq!(spec.sha256.len(), 64);
            assert!(spec.url.contains("/resolve/") && spec.url.ends_with(spec.file));
        }
        assert!(spec(LocalModel::Custom).is_none());
        assert!(model_path(directory.path(), LocalModel::Custom).is_none());
        assert!(!model_ready(directory.path(), LocalModel::Custom));
    }
    #[tokio::test]
    async fn custom_model_uses_an_existing_absolute_gguf_file_only() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("mine.gguf");
        let settings = Settings {
            local_model: LocalModel::Custom,
            local_model_path: format!(" {} ", file.display()),
            ..Settings::default()
        };
        assert_eq!(
            selected_path(directory.path(), &settings),
            Some(file.clone())
        );
        assert!(!selected_ready(directory.path(), &settings));
        std::fs::write(&file, b"gguf").unwrap();
        assert!(selected_ready(directory.path(), &settings));
        for path in [
            "",
            "relative.gguf",
            &directory.path().join("model.bin").display().to_string(),
        ] {
            let settings = Settings {
                local_model_path: path.into(),
                ..settings.clone()
            };
            assert!(selected_path(directory.path(), &settings).is_none());
            assert!(!selected_ready(directory.path(), &settings));
        }
        let catalog = Settings::default();
        assert_eq!(
            selected_path(directory.path(), &catalog),
            model_path(directory.path(), LocalModel::Qwen35_4B)
        );
        assert!(download_model(
            directory.path(),
            LocalModel::Custom,
            Arc::new(AtomicBool::new(false)),
            |_| {},
        )
        .await
        .unwrap_err()
        .contains("내려받지"));
    }
    #[test]
    fn rejects_incorrect_resume_ranges() {
        assert!(resume_range("bytes 10-99/100", 10, 100));
        for value in [
            "bytes 0-99/100",
            "bytes 10-90/100",
            "bytes 10-99/*",
            "bytes 10-99/101",
        ] {
            assert!(!resume_range(value, 10, 100));
        }
    }
    #[tokio::test]
    async fn rejects_corruption_and_honors_cancel() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("model");
        tokio::fs::write(&file, b"corrupt").await.unwrap();
        assert!(verify(
            &file,
            spec(LocalModel::Qwen35_4B).unwrap().sha256,
            Arc::new(AtomicBool::new(false))
        )
        .await
        .is_err());
        assert_eq!(
            verify(
                &file,
                spec(LocalModel::Qwen35_4B).unwrap().sha256,
                Arc::new(AtomicBool::new(true))
            )
            .await
            .unwrap_err(),
            "취소됨"
        );
        assert!(!model_ready(directory.path(), LocalModel::Qwen35_4B));
    }
    #[tokio::test]
    async fn resumes_verified_download_and_rejects_mismatched_range() {
        use tokio::net::TcpListener;
        for valid_range in [true, false] {
            let directory = tempfile::tempdir().unwrap();
            tokio::fs::create_dir(directory.path().join("models"))
                .await
                .unwrap();
            let path = model_path(directory.path(), LocalModel::Qwen35_4B).unwrap();
            tokio::fs::write(path.with_extension("part"), b"abc")
                .await
                .unwrap();
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let server = tokio::spawn(async move {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut request = vec![0; 4096];
                let n = socket.read(&mut request).await.unwrap();
                assert!(String::from_utf8_lossy(&request[..n])
                    .to_lowercase()
                    .contains("range: bytes=3-"));
                let start = if valid_range { 3 } else { 0 };
                socket.write_all(format!("HTTP/1.1 206 Partial Content\r\nContent-Length: 3\r\nContent-Range: bytes {start}-5/6\r\nConnection: close\r\n\r\ndef").as_bytes()).await.unwrap();
            });
            let hash = hex::encode(Sha256::digest(b"abcdef"));
            let result = download(
                directory.path(),
                LocalModel::Qwen35_4B,
                &format!("http://{address}"),
                6,
                &hash,
                Arc::new(AtomicBool::new(false)),
                |_| {},
            )
            .await;
            server.await.unwrap();
            assert_eq!(result.is_ok(), valid_range);
            if valid_range {
                assert_eq!(tokio::fs::read(&path).await.unwrap(), b"abcdef");
                assert!(!path.with_extension("part").exists());
                assert!(path.with_extension("verified").exists());
            } else {
                assert!(!path.exists());
            }
        }
    }

    #[tokio::test]
    async fn reports_terminal_state_before_any_download_bytes() {
        let directory = tempfile::tempdir().unwrap();
        let events = std::sync::Mutex::new(Vec::new());
        let result = download_model(
            directory.path(),
            LocalModel::Qwen35_4B,
            Arc::new(AtomicBool::new(true)),
            |p| events.lock().unwrap().push(p.status),
        )
        .await;
        assert!(result.is_err());
        assert_eq!(*events.lock().unwrap(), vec!["cancelled"]);
        let blocked = directory.path().join("not-a-directory");
        tokio::fs::write(&blocked, b"file").await.unwrap();
        let result = download_model(
            &blocked,
            LocalModel::Qwen35_4B,
            Arc::new(AtomicBool::new(false)),
            |p| events.lock().unwrap().push(p.status),
        )
        .await;
        assert!(result.is_err());
        assert_eq!(*events.lock().unwrap(), vec!["cancelled", "error"]);
    }
}
