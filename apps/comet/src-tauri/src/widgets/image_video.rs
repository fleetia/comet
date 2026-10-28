use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

// Read only MP4 container headers; media data can be much larger than the metadata.
fn boxes(file: &mut File, start: u64, end: u64) -> Result<Vec<([u8; 4], u64, u64)>, String> {
    let mut result = Vec::new();
    let mut offset = start;
    while end.saturating_sub(offset) >= 8 {
        if result.len() >= 100_000 {
            return Err("동영상 정보가 너무 복잡해요.".into());
        }
        file.seek(SeekFrom::Start(offset))
            .map_err(|e| e.to_string())?;
        let mut header = [0u8; 8];
        file.read_exact(&mut header).map_err(|e| e.to_string())?;
        let short = u32::from_be_bytes(header[..4].try_into().unwrap()) as u64;
        let (size, header_size) = if short == 1 {
            let mut extended = [0u8; 8];
            file.read_exact(&mut extended).map_err(|e| e.to_string())?;
            (u64::from_be_bytes(extended), 16)
        } else if short == 0 {
            (end - offset, 8)
        } else {
            (short, 8)
        };
        if size < header_size || size > end - offset {
            return Err("동영상 정보를 읽을 수 없어요.".into());
        }
        result.push((
            header[4..8].try_into().unwrap(),
            offset + header_size,
            offset + size,
        ));
        offset += size;
    }
    Ok(result)
}

pub(crate) fn dimensions(path: &Path) -> Result<(u32, u32), String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let len = file.metadata().map_err(|e| e.to_string())?.len();
    let moov = boxes(&mut file, 0, len)?
        .into_iter()
        .find(|b| &b.0 == b"moov")
        .ok_or("동영상 정보를 찾을 수 없어요.")?;
    for (_, start, end) in boxes(&mut file, moov.1, moov.2)?
        .into_iter()
        .filter(|b| &b.0 == b"trak")
    {
        let children = boxes(&mut file, start, end)?;
        let Some(mdia) = children.iter().find(|b| &b.0 == b"mdia") else {
            continue;
        };
        let Some(hdlr) = boxes(&mut file, mdia.1, mdia.2)?
            .into_iter()
            .find(|b| &b.0 == b"hdlr")
        else {
            continue;
        };
        if hdlr.2.saturating_sub(hdlr.1) < 12 {
            continue;
        }
        file.seek(SeekFrom::Start(hdlr.1 + 8))
            .map_err(|e| e.to_string())?;
        let mut kind = [0u8; 4];
        file.read_exact(&mut kind).map_err(|e| e.to_string())?;
        if &kind != b"vide" {
            continue;
        }
        let Some(tkhd) = children.iter().find(|b| &b.0 == b"tkhd") else {
            continue;
        };
        file.seek(SeekFrom::Start(tkhd.1))
            .map_err(|e| e.to_string())?;
        let mut version = [0u8; 1];
        file.read_exact(&mut version).map_err(|e| e.to_string())?;
        let matrix_offset = match version[0] {
            0 => 40,
            1 => 52,
            _ => continue,
        };
        if tkhd.2.saturating_sub(tkhd.1) < matrix_offset + 44 {
            continue;
        }
        file.seek(SeekFrom::Start(tkhd.1 + matrix_offset))
            .map_err(|e| e.to_string())?;
        let mut metadata = [0u8; 44];
        file.read_exact(&mut metadata).map_err(|e| e.to_string())?;
        let width = u32::from_be_bytes(metadata[36..40].try_into().unwrap()) >> 16;
        let height = u32::from_be_bytes(metadata[40..44].try_into().unwrap()) >> 16;
        if width == 0 || height == 0 {
            continue;
        }
        let a = i32::from_be_bytes(metadata[0..4].try_into().unwrap());
        let d = i32::from_be_bytes(metadata[16..20].try_into().unwrap());
        return Ok(if a == 0 && d == 0 {
            (height, width)
        } else {
            (width, height)
        });
    }
    Err("동영상 크기를 읽을 수 없어요.".into())
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
pub(crate) fn transcode(path: &Path) -> Result<Vec<u8>, String> {
    let dir = std::env::temp_dir().join(format!("comet-image-video-{}", uuid::Uuid::new_v4()));
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        std::fs::DirBuilder::new()
            .mode(0o700)
            .create(&dir)
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(unix))]
    std::fs::create_dir(&dir).map_err(|e| e.to_string())?;
    let output = dir.join("output.mp4");
    let result = transcode_to(path, &output).and_then(|()| {
        if output.metadata().map_err(|e| e.to_string())?.len()
            >= path.metadata().map_err(|e| e.to_string())?.len()
        {
            return Err("압축한 동영상이 원본보다 작지 않아요.".into());
        }
        std::fs::read(&output).map_err(|e| e.to_string())
    });
    let _ = std::fs::remove_dir_all(&dir);
    result
}

#[cfg(target_os = "macos")]
fn transcode_to(path: &Path, output: &Path) -> Result<(), String> {
    use block2::RcBlock;
    use objc2::rc::autoreleasepool;
    use objc2_av_foundation::{
        AVAsset, AVAssetExportPreset1280x720, AVAssetExportSession, AVAssetExportSessionStatus,
        AVFileTypeMPEG4,
    };
    use objc2_foundation::{NSString, NSURL};

    autoreleasepool(|_| unsafe {
        let source = NSURL::fileURLWithPath(&NSString::from_str(
            path.to_str().ok_or("동영상 경로를 읽을 수 없어요.")?,
        ));
        let destination = NSURL::fileURLWithPath(&NSString::from_str(
            output.to_str().ok_or("임시 경로를 읽을 수 없어요.")?,
        ));
        let asset = AVAsset::assetWithURL(&source);
        let session = AVAssetExportSession::exportSessionWithAsset_presetName(
            &asset,
            AVAssetExportPreset1280x720,
        )
        .ok_or("동영상 인코더를 열 수 없어요.")?;
        session.setOutputURL(Some(&destination));
        session.setOutputFileType(AVFileTypeMPEG4);
        session.setShouldOptimizeForNetworkUse(true);
        let (sender, receiver) = std::sync::mpsc::channel();
        let callback = RcBlock::new(move || {
            let _ = sender.send(());
        });
        session.exportAsynchronouslyWithCompletionHandler(&callback);
        receiver.recv().map_err(|e| e.to_string())?;
        if session.status() != AVAssetExportSessionStatus::Completed {
            return Err("동영상 압축에 실패했어요.".into());
        }
        Ok(())
    })
}

#[cfg(target_os = "windows")]
fn transcode_to(path: &Path, output: &Path) -> Result<(), String> {
    use windows::core::HSTRING;
    use windows::Media::MediaProperties::{MediaEncodingProfile, VideoEncodingQuality};
    use windows::Media::Transcoding::MediaTranscoder;
    use windows::Storage::{CreationCollisionOption, StorageFile, StorageFolder};

    let run = || -> windows::core::Result<()> {
        let source = StorageFile::GetFileFromPathAsync(&HSTRING::from(path.as_os_str()))?.get()?;
        let folder = StorageFolder::GetFolderFromPathAsync(&HSTRING::from(
            output.parent().unwrap().as_os_str(),
        ))?
        .get()?;
        let destination = folder
            .CreateFileAsync(
                &HSTRING::from("output.mp4"),
                CreationCollisionOption::FailIfExists,
            )?
            .get()?;
        let profile = MediaEncodingProfile::CreateMp4(VideoEncodingQuality::HD720p)?;
        let (width, height) = dimensions(path).map_err(|_| windows::core::Error::from_win32())?;
        let scale = (1280.0 / width.max(height) as f64).min(1.0);
        let video = profile.Video()?;
        video.SetWidth(((width as f64 * scale / 2.0).round() as u32 * 2).max(2))?;
        video.SetHeight(((height as f64 * scale / 2.0).round() as u32 * 2).max(2))?;
        let prepared = MediaTranscoder::new()?
            .PrepareFileTranscodeAsync(&source, &destination, &profile)?
            .get()?;
        if !prepared.CanTranscode()? {
            return Err(windows::core::Error::from_win32());
        }
        prepared.TranscodeAsync()?.get()?;
        Ok(())
    };
    run().map_err(|e| e.to_string())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub(crate) fn transcode(_path: &Path) -> Result<Vec<u8>, String> {
    Err("이 운영체제는 동영상 압축을 지원하지 않아요.".into())
}
