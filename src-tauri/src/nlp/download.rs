use super::*;
use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use std::{fs, io::Write, path::Path};
use tokio::io::AsyncWriteExt;

pub(super) fn atomic_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let stage = path.with_extension(format!("tmp-{}", uuid::Uuid::new_v4()));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&stage)
        .map_err(|_| "파일을 준비하지 못했어요.")?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| "파일을 저장하지 못했어요.")?;
    drop(file);
    if fs::rename(&stage, path).is_err() {
        let _ = fs::remove_file(&stage);
        return Err("새 파일을 활성화하지 못했어요.".into());
    }
    Ok(())
}
pub(super) async fn install(service: &NlpService, kind: ModelKind) -> Result<(), String> {
    let shared = &service.shared;
    if shared.closed.load(Ordering::Acquire) || shared.suspended.load(Ordering::Acquire) {
        return Err("앱을 종료하거나 업데이트하고 있어요.".into());
    }
    let manifest = models::manifest(kind);
    if manifest.files.is_empty() || manifest.files.iter().any(|file| file.url.is_none()) {
        return Err("이 모델의 검증된 다운로드 파일이 아직 배포되지 않았어요.".into());
    }
    let _gate = shared.model_gates[kind as usize]
        .try_lock()
        .map_err(|_| "이 모델의 다운로드나 제거가 진행 중이에요.")?;
    let cancel = Arc::new(AtomicBool::new(false));
    locked(&shared.downloads).insert(kind, cancel.clone());
    {
        let mut status = locked(&shared.status);
        let model = model_mut(&mut status, kind);
        model.state = "downloading".into();
        model.downloaded_bytes = 0;
        model.error = None;
    }
    let stage = shared
        .root
        .join(format!(".{}-{}", kind.name(), uuid::Uuid::new_v4()));
    let result = async {
        tokio::fs::create_dir_all(&stage).await.map_err(|_| "다운로드 폴더를 만들지 못했어요.")?;
        let client = reqwest::Client::builder().connect_timeout(std::time::Duration::from_secs(15))
            .timeout(std::time::Duration::from_secs(1800)).build().map_err(|_| "다운로드를 준비하지 못했어요.")?;
        for descriptor in &manifest.files {
            if cancel.load(Ordering::Acquire) { return Err("다운로드를 취소했어요.".to_owned()); }
            if Path::new(&descriptor.name).components().count() != 1 || descriptor.sha256.len() != 64 { return Err("모델 배포 정보가 올바르지 않아요.".into()); }
            let url = descriptor.url.as_ref().ok_or("모델이 아직 배포되지 않았어요.")?;
            if !url.starts_with("https://") { return Err("안전한 다운로드 주소가 아니에요.".into()); }
            let response = tokio::select! {
                response = client.get(url).send() => response.map_err(|_| "모델 다운로드에 연결하지 못했어요.")?,
                _ = cancelled(&cancel) => return Err("다운로드를 취소했어요.".into()),
            }.error_for_status().map_err(|_| "모델 다운로드 서버가 응답하지 않았어요.")?;
            if response.content_length().is_some_and(|size| size != descriptor.size) { return Err("모델 파일 크기가 배포 정보와 달라요.".into()); }
            let mut file = tokio::fs::OpenOptions::new().write(true).create_new(true).open(stage.join(&descriptor.name)).await
                .map_err(|_| "모델 파일을 만들지 못했어요.")?;
            let mut hash = Sha256::new(); let mut downloaded = 0u64;
            let mut stream = response.bytes_stream();
            loop {
                // Poll cancellation while a server stalls without returning any bytes.
                let next = tokio::select! {
                    data = stream.next() => data,
                    _ = tokio::time::sleep(std::time::Duration::from_millis(100)) => {
                        if cancel.load(Ordering::Acquire) { return Err("다운로드를 취소했어요.".into()); }
                        continue;
                    }
                };
                let Some(chunk) = next else { break; };
                let chunk = chunk.map_err(|_| "모델 다운로드가 중단됐어요.")?;
                downloaded += chunk.len() as u64;
                if downloaded > descriptor.size { return Err("모델 파일 크기가 배포 정보와 달라요.".into()); }
                if cancel.load(Ordering::Acquire) { return Err("다운로드를 취소했어요.".into()); }
                hash.update(&chunk); file.write_all(&chunk).await.map_err(|_| "모델 파일을 저장하지 못했어요.")?;
                model_mut(&mut locked(&shared.status),kind).downloaded_bytes += chunk.len() as u64;
            }
            file.sync_all().await.map_err(|_| "모델 파일을 저장하지 못했어요.")?;
            if downloaded != descriptor.size || hex::encode(hash.finalize()) != descriptor.sha256 { return Err("모델 무결성 검사가 실패했어요.".into()); }
        }
        if kind == ModelKind::Kiwi {
            let path = stage.clone(); let cancelled = cancel.clone();
            tokio::task::spawn_blocking(move || unpack_kiwi(&path,&cancelled)).await.map_err(|_| "모델 압축 해제가 실패했어요.")??;
        }
        model_mut(&mut locked(&shared.status),kind).state = "installing".into();
        service.stop_worker().await?;
        if cancel.load(Ordering::Acquire) || shared.closed.load(Ordering::Acquire) || shared.suspended.load(Ordering::Acquire) { return Err("다운로드를 취소했어요.".into()); }
        let profile = models::fingerprint(&manifest);
        tokio::fs::write(stage.join("verified-artifacts"),models::artifact_fingerprint(&manifest).as_bytes()).await.map_err(|_| "검증 결과를 저장하지 못했어요.")?;
        let destination = shared.root.join(kind.name());
        let backup = shared.root.join(format!(".{}-previous",kind.name()));
        let _ = tokio::fs::remove_dir_all(&backup).await;
        let existed = tokio::fs::try_exists(&destination).await.map_err(|_| "모델 경로를 확인하지 못했어요.")?;
        if existed { tokio::fs::rename(&destination,&backup).await.map_err(|_| "기존 모델을 보존하지 못했어요.")?; }
        if cancel.load(Ordering::Acquire) || shared.closed.load(Ordering::Acquire) || shared.suspended.load(Ordering::Acquire) {
            if existed { let _ = tokio::fs::rename(&backup,&destination).await; }
            return Err("다운로드를 취소했어요.".into());
        }
        if tokio::fs::rename(&stage,&destination).await.is_err() {
            if existed { let _ = tokio::fs::rename(&backup,&destination).await; }
            return Err("검증한 모델을 활성화하지 못했어요.".into());
        }
        let _ = tokio::fs::remove_dir_all(backup).await;
        let mut status = locked(&shared.status); let model = model_mut(&mut status,kind);
        model.installed = true; model.state = "idle".into(); model.error = None;
        model.profile = Some(profile);
        Ok(())
    }.await;
    locked(&shared.downloads).remove(&kind);
    if let Err(error) = &result {
        let _ = tokio::fs::remove_dir_all(&stage).await;
        let mut status = locked(&shared.status);
        let model = model_mut(&mut status, kind);
        model.state = if cancel.load(Ordering::Acquire) {
            if model.installed {
                "idle"
            } else {
                "not_installed"
            }
        } else {
            "error"
        }
        .into();
        model.error = (!cancel.load(Ordering::Acquire)).then(|| error.clone());
    } else {
        service.interrupt();
        service.warmup();
    }
    result
}
fn unpack_kiwi(stage: &Path, cancel: &AtomicBool) -> Result<(), String> {
    let file =
        fs::File::open(stage.join("kiwi.tgz")).map_err(|_| "모델 압축 파일을 열지 못했어요.")?;
    let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(file));
    let mut total = 0u64;
    for entry in archive
        .entries()
        .map_err(|_| "모델 압축 파일을 읽지 못했어요.")?
    {
        if cancel.load(Ordering::Acquire) {
            return Err("다운로드를 취소했어요.".into());
        }
        let mut entry = entry.map_err(|_| "모델 압축 파일이 손상됐어요.")?;
        let kind = entry.header().entry_type();
        if !kind.is_file() && !kind.is_dir() {
            return Err("모델 압축 파일에 허용하지 않는 항목이 있어요.".into());
        }
        total = total
            .checked_add(entry.size())
            .ok_or("모델 크기가 너무 커요.")?;
        if total > 1024 * 1024 * 1024 {
            return Err("모델 크기가 너무 커요.".into());
        }
        if !entry
            .unpack_in(stage)
            .map_err(|_| "모델 압축 해제가 실패했어요.")?
        {
            return Err("모델 파일 경로가 올바르지 않아요.".into());
        }
    }
    if !stage.join("models/cong/base/cong.mdl").is_file() {
        return Err("Kiwi CoNg 모델 파일이 없어요.".into());
    }
    fs::remove_file(stage.join("kiwi.tgz"))
        .map_err(|_| "임시 다운로드 파일을 정리하지 못했어요.")?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn atomic_settings_replace_keeps_exact_bytes() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("settings.json");
        atomic_file(&path, b"old").unwrap();
        atomic_file(&path, b"new\n").unwrap();
        assert_eq!(fs::read(path).unwrap(), b"new\n");
    }
    #[test]
    fn rejects_archive_symlinks_without_writing_target() {
        let temp = tempfile::tempdir().unwrap();
        let file = fs::File::create(temp.path().join("kiwi.tgz")).unwrap();
        let gz = flate2::write::GzEncoder::new(file, flate2::Compression::default());
        let mut archive = tar::Builder::new(gz);
        let mut header = tar::Header::new_gnu();
        header.set_entry_type(tar::EntryType::Symlink);
        header.set_size(0);
        header.set_mode(0o777);
        archive
            .append_link(&mut header, "bad", "../outside")
            .unwrap();
        archive.into_inner().unwrap().finish().unwrap();
        assert!(unpack_kiwi(temp.path(), &AtomicBool::new(false)).is_err());
        assert!(!temp.path().join("bad").exists());
    }
}

async fn cancelled(cancel: &AtomicBool) {
    while !cancel.load(Ordering::Acquire) {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
}

pub(super) async fn recover_legacy(shared: &Arc<Shared>, kind: ModelKind) {
    let _gate = shared.model_gates[kind as usize].lock().await;
    let manifest = models::manifest(kind);
    let artifact = models::artifact_fingerprint(&manifest);
    let directory = shared.root.join(kind.name());
    if std::fs::read_to_string(directory.join("verified-artifacts"))
        .ok()
        .as_deref()
        == Some(&artifact)
    {
        return;
    }
    let worker = shared.clone();
    let target = directory.clone();
    let descriptor = manifest.clone();
    let verified = tokio::task::spawn_blocking(move || {
        verify_installed(&target, &descriptor, &worker.closed, &worker.suspended)
    })
    .await
    .unwrap_or(false);
    if shared.closed.load(Ordering::Acquire) || shared.suspended.load(Ordering::Acquire) {
        return;
    }
    let mut installed = false;
    if verified {
        installed = tokio::fs::write(directory.join("verified-artifacts"), artifact)
            .await
            .is_ok();
    }
    let mut status = locked(&shared.status);
    let model = model_mut(&mut status, kind);
    model.installed = installed;
    model.profile = installed.then(|| models::fingerprint(&manifest));
    model.state = if installed { "idle" } else { "error" }.into();
    model.error = (!installed)
        .then(|| "기존 검색 모델 파일을 확인하지 못했어요. 다시 다운로드할 수 있어요.".into());
}
fn verify_installed(
    directory: &Path,
    manifest: &models::ModelManifest,
    closed: &AtomicBool,
    suspended: &AtomicBool,
) -> bool {
    use std::io::Read;
    let files = if manifest.installed_files.is_empty() {
        &manifest.files
    } else {
        &manifest.installed_files
    };
    if files.is_empty() {
        return false;
    }
    let mut buffer = vec![0u8; 64 * 1024];
    for descriptor in files {
        if closed.load(Ordering::Acquire) || suspended.load(Ordering::Acquire) {
            return false;
        }
        let path = directory.join(&descriptor.name);
        let Ok(metadata) = fs::symlink_metadata(&path) else {
            return false;
        };
        if !metadata.is_file() || metadata.len() != descriptor.size {
            return false;
        }
        let Ok(mut file) = fs::File::open(path) else {
            return false;
        };
        let mut hash = Sha256::new();
        loop {
            if closed.load(Ordering::Acquire) || suspended.load(Ordering::Acquire) {
                return false;
            }
            let Ok(count) = file.read(&mut buffer) else {
                return false;
            };
            if count == 0 {
                break;
            }
            hash.update(&buffer[..count]);
        }
        if hex::encode(hash.finalize()) != descriptor.sha256 {
            return false;
        }
    }
    true
}

#[cfg(test)]
mod receipt_tests {
    use super::*;
    #[test]
    fn legacy_models_are_verified_by_file_bytes_without_search_policy_dependency() {
        let directory = tempfile::tempdir().unwrap();
        let content = b"verified model payload";
        fs::write(directory.path().join("model.onnx"), content).unwrap();
        let mut manifest = models::manifest(ModelKind::Semantic);
        manifest.files = vec![models::ModelFile {
            name: "model.onnx".into(),
            url: None,
            size: content.len() as u64,
            sha256: hex::encode(Sha256::digest(content)),
        }];
        manifest.profile = "new search policy".into();
        manifest.threshold = Some(0.95);
        assert!(verify_installed(
            directory.path(),
            &manifest,
            &AtomicBool::new(false),
            &AtomicBool::new(false)
        ));
        fs::write(
            directory.path().join("model.onnx"),
            b"corruptd model payload",
        )
        .unwrap();
        assert!(!verify_installed(
            directory.path(),
            &manifest,
            &AtomicBool::new(false),
            &AtomicBool::new(false)
        ));
        assert!(!verify_installed(
            directory.path(),
            &manifest,
            &AtomicBool::new(true),
            &AtomicBool::new(false)
        ));
    }
}
