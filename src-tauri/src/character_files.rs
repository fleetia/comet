use crate::characters::{self, CharacterPack, MAX_PACK_BYTES};
use std::{
    fs::{File, OpenOptions},
    io::{Read, Write},
    path::Path,
};
use tauri_plugin_dialog::DialogExt;

pub fn read_pack(path: &Path) -> Result<CharacterPack, String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    let metadata = file.metadata().map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_PACK_BYTES as u64 {
        return Err("32 MiB 이하의 캐릭터팩 파일을 선택해 주세요.".into());
    }
    let mut json = String::new();
    file.take(MAX_PACK_BYTES as u64 + 1)
        .read_to_string(&mut json)
        .map_err(|_| "UTF-8 캐릭터팩 파일을 읽지 못했어요.".to_string())?;
    characters::parse_pack(&json)
}

pub fn write_pack(path: &Path, json: &str) -> Result<(), String> {
    characters::parse_pack(json)?;
    let parent = path.parent().ok_or("저장 폴더를 확인해 주세요.")?;
    let temporary = parent.join(format!(".comet-pack-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&temporary)
            .map_err(|error| error.to_string())?;
        file.write_all(json.as_bytes())
            .map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        drop(file);
        std::fs::rename(&temporary, path).map_err(|error| error.to_string())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(temporary);
    }
    result
}

pub async fn choose(app: tauri::AppHandle) -> Result<Option<CharacterPack>, String> {
    let (send, receive) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("캐릭터팩 가져오기")
        .add_filter("comet 캐릭터팩", &["json"])
        .pick_file(move |path| {
            let _ = send.send(path);
        });
    let Some(path) = receive.await.map_err(|_| "파일 선택이 중단됐어요.")? else {
        return Ok(None);
    };
    let path = path.into_path().map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || read_pack(&path).map(Some))
        .await
        .map_err(|error| error.to_string())?
}

pub async fn save(app: tauri::AppHandle, json: String) -> Result<Option<String>, String> {
    let (send, receive) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("캐릭터팩 공유 파일 저장")
        .set_file_name("characters.comet-character.json")
        .add_filter("comet 캐릭터팩", &["json"])
        .save_file(move |path| {
            let _ = send.send(path);
        });
    let Some(path) = receive.await.map_err(|_| "파일 저장이 중단됐어요.")? else {
        return Ok(None);
    };
    let path = path.into_path().map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        write_pack(&path, &json)?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_example_packs_pass_validation() {
        let examples = Path::new(env!("CARGO_MANIFEST_DIR")).join("../examples/character-packs");
        let pair = read_pack(&examples.join("nadir-and-star-tail.comet-character.json")).unwrap();
        assert_eq!(pair.characters.len(), 2);
        assert!(pair.sprites.is_empty());
        let byul = read_pack(&examples.join("byulkkori.comet-character.json")).unwrap();
        assert_eq!(byul.characters[0].name, "별꼬리");
        assert!(byul.characters[0].face_icon);
        assert_eq!(byul.characters[0].expressions.len(), 9);
        assert_eq!(byul.sprites.len(), 9);
        assert!(byul.sprites.iter().all(|s| s.mime == "image/svg+xml"));
    }

    #[test]
    fn file_roundtrip_is_validated_and_failed_save_preserves_destination() {
        let dir = tempfile::tempdir().unwrap();
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        characters::initialize(&conn).unwrap();
        let pack = characters::export_pack(&conn, &["builtin-a".into()], &[]).unwrap();
        let json = characters::pack_json(&pack).unwrap();
        let path = dir.path().join("shared.comet-character.json");
        write_pack(&path, &json).unwrap();
        assert_eq!(
            read_pack(&path).unwrap().characters[0].name,
            pack.characters[0].name
        );
        assert!(write_pack(&path, "{\"privateData\":true}").is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), json);
        let oversized = dir.path().join("oversized.json");
        File::create(&oversized)
            .unwrap()
            .set_len(MAX_PACK_BYTES as u64 + 1)
            .unwrap();
        assert!(read_pack(&oversized).is_err());
        assert!(read_pack(dir.path()).is_err());
        let destination_directory = dir.path().join("folder");
        std::fs::create_dir(&destination_directory).unwrap();
        assert!(write_pack(&destination_directory, &json).is_err());
        assert!(!std::fs::read_dir(dir.path()).unwrap().any(|p| p
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".comet-pack-")));
    }
}
