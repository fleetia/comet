use super::{encryption, parser, Diagnostic, Registry};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Component, Path, PathBuf},
    sync::Mutex,
};

static SAVE_GATE: Mutex<()> = Mutex::new(());

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorDocument {
    pub path: String,
    pub source: String,
    pub revision: String,
}

fn root(entry: &Path) -> Result<PathBuf, String> {
    fs::canonicalize(
        entry
            .parent()
            .filter(|path| !path.as_os_str().is_empty())
            .unwrap_or(Path::new(".")),
    )
    .map_err(|error| error.to_string())
}

fn resolve(entry: &Path, name: &str) -> Result<PathBuf, String> {
    let relative = Path::new(name);
    if relative
        .components()
        .any(|part| !matches!(part, Component::Normal(_)))
        || relative
            .extension()
            .is_none_or(|extension| extension != "talk")
    {
        return Err("대본 폴더 안의 상대 .talk 경로가 필요해요.".into());
    }
    let root = root(entry)?;
    let mut path = root.clone();
    for component in relative.components() {
        path.push(component);
        let metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
        if metadata.file_type().is_symlink() {
            return Err("편집기에서는 심볼릭 링크를 수정할 수 없어요.".into());
        }
    }
    let canonical = fs::canonicalize(path).map_err(|error| error.to_string())?;
    if !canonical.starts_with(root) || !canonical.is_file() {
        return Err("대본 폴더 안의 일반 파일이 필요해요.".into());
    }
    Ok(canonical)
}

pub fn list_files(entry: &Path) -> Result<Vec<String>, String> {
    fn visit(
        root: &Path,
        directory: &Path,
        depth: usize,
        files: &mut Vec<String>,
        count: &mut usize,
    ) -> Result<(), String> {
        if depth > 32 {
            return Err("대본 폴더가 너무 깊어요.".into());
        }
        for item in fs::read_dir(directory).map_err(|error| error.to_string())? {
            let item = item.map_err(|error| error.to_string())?;
            *count += 1;
            if *count > 512 {
                return Err("대본 폴더의 파일 수가 제한을 넘었어요.".into());
            }
            let kind = item.file_type().map_err(|error| error.to_string())?;
            let path = item.path();
            if kind.is_dir() {
                visit(root, &path, depth + 1, files, count)?;
            } else if kind.is_file()
                && path
                    .extension()
                    .is_some_and(|extension| extension == "talk")
            {
                files.push(
                    path.strip_prefix(root)
                        .map_err(|error| error.to_string())?
                        .to_string_lossy()
                        .replace('\\', "/"),
                );
            }
        }
        Ok(())
    }
    let root = root(entry)?;
    let mut files = Vec::new();
    visit(&root, &root, 0, &mut files, &mut 0)?;
    files.sort();
    Ok(files)
}

pub fn read_file(entry: &Path, name: &str) -> Result<EditorDocument, String> {
    let path = resolve(entry, name)?;
    let data = encryption::read_bytes(&path)?;
    Ok(EditorDocument {
        path: name.into(),
        source: encryption::decode(&data)?,
        revision: hex::encode(Sha256::digest(&data)),
    })
}

pub(crate) fn atomic_write(path: &Path, data: &[u8]) -> Result<(), String> {
    let temporary = path.with_file_name(format!(".talk-save-{}", uuid::Uuid::new_v4()));
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
        file.write_all(data).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        drop(file);
        fs::rename(&temporary, path).map_err(|error| error.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

pub fn save_file(
    entry: &Path,
    name: &str,
    source: &str,
    expected_revision: &str,
    registry: &Registry,
) -> Result<EditorDocument, Vec<Diagnostic>> {
    let error = |code: &str, message: String| {
        vec![Diagnostic {
            path: name.into(),
            line: 1,
            column: 1,
            code: code.into(),
            message,
        }]
    };
    let _gate = SAVE_GATE
        .lock()
        .map_err(|_| error("SAVE_LOCK", "대본 저장 잠금을 열 수 없어요.".into()))?;
    let path = resolve(entry, name).map_err(|message| error("EDITOR_PATH", message))?;
    let before = read_file(entry, name).map_err(|message| error("EDITOR_READ", message))?;
    if before.revision != expected_revision {
        return Err(error(
            "EDIT_CONFLICT",
            "다른 곳에서 파일을 수정했어요. 다시 열어 비교해 주세요.".into(),
        ));
    }
    let program = parser::load_with_source(entry, registry, Some((&path, source)))?;
    if !program.files.contains(&path) {
        // Unreferenced files still need their own syntax and import validation.
        parser::load_with_source(&path, registry, Some((&path, source)))?;
    }
    let encrypted = encryption::encode(source).map_err(|message| error("ENCRYPT", message))?;
    let current = read_file(entry, name).map_err(|message| error("EDITOR_READ", message))?;
    if current.revision != before.revision || resolve(entry, name).ok().as_ref() != Some(&path) {
        return Err(error(
            "EDIT_CONFLICT",
            "검사하는 동안 파일이 바뀌었어요. 다시 열어 주세요.".into(),
        ));
    }
    atomic_write(&path, &encrypted).map_err(|message| error("EDITOR_WRITE", message))?;
    Ok(EditorDocument {
        path: name.into(),
        source: source.into(),
        revision: hex::encode(Sha256::digest(&encrypted)),
    })
}

pub fn seal_bundle(entry: &Path, registry: &Registry) -> Result<usize, String> {
    let _gate = SAVE_GATE
        .lock()
        .map_err(|_| "대본 저장 잠금을 열 수 없어요.")?;
    super::load(entry, registry)
        .map_err(|errors| serde_json::to_string(&errors).unwrap_or_default())?;
    let files = list_files(entry)?;
    let mut changed = 0;
    for name in files {
        let path = resolve(entry, &name)?;
        let data = encryption::read_bytes(&path)?;
        if encryption::is_encrypted(&data) {
            encryption::decode(&data)?;
            continue;
        }
        let source = encryption::decode(&data)?;
        let encrypted = encryption::encode(&source)?;
        if encryption::read_bytes(&path)? != data {
            return Err("암호화하는 동안 파일이 바뀌었어요.".into());
        }
        atomic_write(&path, &encrypted)?;
        changed += 1;
    }
    Ok(changed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn editor_validates_full_import_bundle_and_preserves_invalid_or_conflicting_edits() {
        let directory = tempfile::tempdir().unwrap();
        let entry = directory.path().join("index.talk");
        fs::write(&entry, "format: 1\nimport \"./part.talk\"\n").unwrap();
        let part = directory.path().join("part.talk");
        fs::write(&part, "# initial\n").unwrap();
        let document = read_file(&entry, "part.talk").unwrap();
        let invalid = save_file(
            &entry,
            "part.talk",
            "scene: broken\n",
            &document.revision,
            &Registry::default(),
        );
        assert!(invalid.is_err());
        assert_eq!(fs::read_to_string(&part).unwrap(), "# initial\n");
        let saved = save_file(
            &entry,
            "part.talk",
            "# preserved\n\n",
            &document.revision,
            &Registry::default(),
        )
        .unwrap();
        assert!(encryption::is_encrypted(&fs::read(&part).unwrap()));
        assert_eq!(
            read_file(&entry, "part.talk").unwrap().source,
            "# preserved\n\n"
        );
        assert!(super::super::load(&entry, &Registry::default()).is_ok());
        assert!(save_file(
            &entry,
            "part.talk",
            "# stale",
            &document.revision,
            &Registry::default()
        )
        .is_err());
        assert_eq!(
            read_file(&entry, "part.talk").unwrap().revision,
            saved.revision
        );
        let original = fs::read(&entry).unwrap();
        let entry_document = read_file(&entry, "index.talk").unwrap();
        assert!(save_file(
            &entry,
            "index.talk",
            "format: 1\nimport \"../escape.talk\"",
            &entry_document.revision,
            &Registry::default()
        )
        .is_err());
        assert_eq!(fs::read(&entry).unwrap(), original);
    }

    #[test]
    fn paths_cannot_escape_editor_root() {
        let directory = tempfile::tempdir().unwrap();
        let entry = directory.path().join("index.talk");
        fs::write(&entry, "format: 1\n").unwrap();
        for path in [
            "../index.talk",
            "/tmp/index.talk",
            "index.json",
            "./index.talk",
        ] {
            assert!(read_file(&entry, path).is_err());
        }
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&entry, directory.path().join("link.talk")).unwrap();
            assert!(read_file(&entry, "link.talk").is_err());
            assert_eq!(list_files(&entry).unwrap(), vec!["index.talk"]);
        }
    }
}
