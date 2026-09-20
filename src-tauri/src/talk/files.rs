use super::{encryption, Registry};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Component, Path, PathBuf},
    sync::Mutex,
};

static FILE_GATE: Mutex<()> = Mutex::new(());

pub(crate) struct SourceFile {
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
            return Err("대본 파일은 심볼릭 링크를 사용할 수 없어요.".into());
        }
    }
    let canonical = fs::canonicalize(path).map_err(|error| error.to_string())?;
    if !canonical.starts_with(root) || !canonical.is_file() {
        return Err("대본 폴더 안의 일반 파일이 필요해요.".into());
    }
    Ok(canonical)
}

pub(crate) fn list_files(entry: &Path) -> Result<Vec<String>, String> {
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

pub(crate) fn read(entry: &Path, name: &str) -> Result<SourceFile, String> {
    let path = resolve(entry, name)?;
    let data = encryption::read_bytes(&path)?;
    Ok(SourceFile {
        source: encryption::decode(&data)?,
        revision: hex::encode(Sha256::digest(&data)),
    })
}

pub(crate) fn atomic_write(path: &Path, data: &[u8]) -> Result<(), String> {
    let temporary = path.with_file_name(format!(".comet-save-{}", uuid::Uuid::new_v4()));
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

/// Encrypts every plaintext `.talk` under the root (user entry and installed packs) after the
/// whole bundle passes the parser.
pub(crate) fn seal_bundle(root: &Path, registry: &Registry) -> Result<usize, String> {
    let _gate = FILE_GATE
        .lock()
        .map_err(|_| "대본 파일 잠금을 열 수 없어요.")?;
    super::load_bundle(root, registry)
        .map_err(|errors| serde_json::to_string(&errors).unwrap_or_default())?;
    let entry = root.join("index.talk");
    let files = list_files(&entry)?;
    let mut changed = 0;
    for name in files {
        let path = resolve(&entry, &name)?;
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
    fn reads_sources_and_rejects_paths_outside_the_talk_root() {
        let directory = tempfile::tempdir().unwrap();
        let entry = directory.path().join("index.talk");
        fs::write(&entry, "format: 1\nimport \"./part.talk\"\n").unwrap();
        fs::write(directory.path().join("part.talk"), "# initial\n").unwrap();

        assert_eq!(read(&entry, "part.talk").unwrap().source, "# initial\n");
        assert_eq!(list_files(&entry).unwrap(), vec!["index.talk", "part.talk"]);
        for path in [
            "../index.talk",
            "/tmp/index.talk",
            "index.json",
            "./index.talk",
        ] {
            assert!(read(&entry, path).is_err());
        }
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&entry, directory.path().join("link.talk")).unwrap();
            assert!(read(&entry, "link.talk").is_err());
            assert_eq!(list_files(&entry).unwrap(), vec!["index.talk", "part.talk"]);
        }
    }
}
