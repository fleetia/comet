use crate::{
    story::Scene,
    talk::{
        editor::{atomic_write, EditorDocument},
        encryption,
    },
};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

pub const PATH: &str = "story/nadir.story.enc";
const MARKER: &str = ".nadir-story-initialized";
static SAVE_GATE: Mutex<()> = Mutex::new(());

fn directory(app_data: &Path) -> Result<PathBuf, String> {
    let root = fs::canonicalize(app_data).map_err(|e| e.to_string())?;
    let directory = root.join("story");
    let metadata = fs::symlink_metadata(&directory).map_err(|e| e.to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("이야기 폴더는 일반 폴더여야 해요.".into());
    }
    Ok(directory)
}

fn resolve(app_data: &Path) -> Result<PathBuf, String> {
    let path = directory(app_data)?.join("nadir.story.enc");
    let metadata = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("이야기 파일은 심볼릭 링크가 아닌 일반 파일이어야 해요.".into());
    }
    Ok(path)
}

pub fn initialize(app_data: &Path) -> Result<(), String> {
    let _gate = SAVE_GATE
        .lock()
        .map_err(|_| "이야기 저장 잠금을 열 수 없어요.")?;
    let root = fs::canonicalize(app_data).map_err(|e| e.to_string())?;
    if fs::symlink_metadata(root.join(MARKER)).is_ok() {
        return Ok(());
    }
    let story_directory = root.join("story");
    if fs::symlink_metadata(&story_directory).is_err() {
        fs::create_dir(&story_directory).map_err(|e| e.to_string())?;
    }
    let path = directory(app_data)?.join("nadir.story.enc");
    if fs::symlink_metadata(&path).is_err() {
        atomic_write(&path, include_bytes!("../story/nadir.story.enc"))?;
    }
    atomic_write(&root.join(MARKER), b"1")
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_'))
}
fn bounded(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && value.chars().count() <= max
}

pub fn validate(source: &str) -> Result<Vec<Scene>, String> {
    if source.len() > encryption::SOURCE_LIMIT {
        return Err("이야기 파일은 1 MiB 이하여야 해요.".into());
    }
    let scenes: Vec<Scene> =
        serde_json::from_str(source).map_err(|e| format!("이야기 JSON: {e}"))?;
    if !(15..=256).contains(&scenes.len()) {
        return Err("이야기는 15~256개가 필요해요.".into());
    }
    let mut ids = HashSet::new();
    let mut chapters = [0; 3];
    for scene in &scenes {
        if !valid_id(&scene.id)
            || !ids.insert(&scene.id)
            || scene.chapter > 2
            || !bounded(&scene.title, 80)
            || !bounded(&scene.prompt, 500)
            || !(2..=4).contains(&scene.choices.len())
        {
            return Err(format!(
                "장면 {}의 ID·단계·제목·본문·선택지 수를 확인해 주세요.",
                scene.id
            ));
        }
        chapters[usize::from(scene.chapter)] += 1;
        let mut choices = HashSet::new();
        for choice in &scene.choices {
            if !valid_id(&choice.id)
                || !choices.insert(&choice.id)
                || !bounded(&choice.label, 160)
                || !bounded(&choice.response, 500)
                || !(-5..=5).contains(&choice.delta)
            {
                return Err(format!(
                    "장면 {}의 선택지 {}를 확인해 주세요.",
                    scene.id, choice.id
                ));
            }
        }
    }
    if chapters.iter().any(|count| *count < 5) {
        return Err("각 공개 단계에 장면이 5개 이상 필요해요.".into());
    }
    Ok(scenes)
}

pub fn read(app_data: &Path) -> Result<EditorDocument, String> {
    let data = encryption::read_bytes(&resolve(app_data)?)?;
    if !encryption::is_encrypted(&data) {
        return Err("암호화된 이야기 파일이 필요해요.".into());
    }
    let source = encryption::decode(&data)?;
    Ok(EditorDocument {
        path: PATH.into(),
        source,
        revision: hex::encode(Sha256::digest(&data)),
    })
}

pub fn load(app_data: &Path) -> Result<Vec<Scene>, String> {
    validate(&read(app_data)?.source)
}

pub fn save(
    app_data: &Path,
    source: &str,
    expected_revision: &str,
) -> Result<EditorDocument, String> {
    let _gate = SAVE_GATE
        .lock()
        .map_err(|_| "이야기 저장 잠금을 열 수 없어요.")?;
    let path = resolve(app_data)?;
    let before = read(app_data)?;
    if before.revision != expected_revision {
        return Err("다른 곳에서 파일을 수정했어요. 다시 열어 비교해 주세요.".into());
    }
    validate(source)?;
    let data = encryption::encode(source)?;
    if read(app_data)?.revision != before.revision || resolve(app_data)? != path {
        return Err("검사하는 동안 파일이 바뀌었어요. 다시 열어 주세요.".into());
    }
    atomic_write(&path, &data)?;
    Ok(EditorDocument {
        path: PATH.into(),
        source: source.into(),
        revision: hex::encode(Sha256::digest(data)),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn editing_is_encrypted_validated_conflict_checked_and_used_by_runtime() {
        let directory = tempfile::tempdir().unwrap();
        initialize(directory.path()).unwrap();
        let original = read(directory.path()).unwrap();
        let mut value: serde_json::Value = serde_json::from_str(&original.source).unwrap();
        for scene in value.as_array_mut().unwrap() {
            if scene["chapter"] == 0 {
                scene["prompt"] = "수정한 영창을 들어줄래요?".into();
            }
        }
        let source = serde_json::to_string(&value).unwrap();
        let saved = save(directory.path(), &source, &original.revision).unwrap();
        assert_ne!(saved.revision, original.revision);
        assert!(encryption::is_encrypted(
            &fs::read(directory.path().join(PATH)).unwrap()
        ));
        assert!(save(directory.path(), &original.source, &original.revision).is_err());
        assert!(save(directory.path(), "[]", &saved.revision).is_err());
        assert_eq!(read(directory.path()).unwrap().source, source);
        let db = crate::store::open(std::path::Path::new(":memory:")).unwrap();
        let mut definition = crate::characters::active_character(&db, "a")
            .unwrap()
            .definition;
        definition.source_id = "nadir".into();
        db.execute(
            "UPDATE characters SET data=? WHERE id='builtin-a'",
            [serde_json::to_string(&definition).unwrap()],
        )
        .unwrap();
        let catalog = load(directory.path()).unwrap();
        let request = crate::story::prepare_from_catalog(&db, "a", 1, 0, &catalog)
            .unwrap()
            .unwrap();
        assert_eq!(request.prompt, "수정한 영창을 들어줄래요?");
    }

    #[test]
    fn invalid_json_fields_and_corrupted_ciphertext_are_rejected_without_reinstalling_deleted_files(
    ) {
        let directory = tempfile::tempdir().unwrap();
        initialize(directory.path()).unwrap();
        let original = read(directory.path()).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&original.source).unwrap();
        for field in ["id", "chapter", "prompt", "choices", "unknown"] {
            let mut invalid = parsed.clone();
            match field {
                "id" => invalid[0]["id"] = invalid[1]["id"].clone(),
                "chapter" => invalid[0]["chapter"] = 3.into(),
                "prompt" => invalid[0]["prompt"] = "x".repeat(501).into(),
                "choices" => invalid[0]["choices"][0]["delta"] = 6.into(),
                _ => invalid[0]["unknown"] = true.into(),
            }
            assert!(validate(&invalid.to_string()).is_err(), "{field}");
        }
        let path = directory.path().join(PATH);
        let mut damaged = fs::read(&path).unwrap();
        let last = damaged.len() - 1;
        damaged[last] = if damaged[last] == b'A' { b'B' } else { b'A' };
        fs::write(&path, damaged).unwrap();
        assert!(load(directory.path()).is_err());
        assert!(save(directory.path(), &original.source, &original.revision).is_err());
        fs::remove_file(&path).unwrap();
        initialize(directory.path()).unwrap();
        assert!(!path.exists());
        assert!(load(directory.path()).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn editor_rejects_symlink_files_and_directories() {
        use std::os::unix::fs::symlink;
        let directory = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        initialize(directory.path()).unwrap();
        let path = directory.path().join(PATH);
        fs::remove_file(&path).unwrap();
        let other = outside.path().join("target");
        fs::write(&other, include_bytes!("../story/nadir.story.enc")).unwrap();
        symlink(&other, &path).unwrap();
        assert!(read(directory.path()).is_err());
        fs::remove_file(&path).unwrap();
        fs::remove_dir(directory.path().join("story")).unwrap();
        symlink(outside.path(), directory.path().join("story")).unwrap();
        assert!(read(directory.path()).is_err());
    }
}
