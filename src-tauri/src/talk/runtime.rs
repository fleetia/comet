use super::{defaults, Diagnostic, History, Program, Registry};
use rusqlite::Connection;
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant, SystemTime},
};

#[derive(Default)]
pub struct ActiveProgram {
    pub program: Option<Arc<Program>>,
    pub generation: u64,
    pub diagnostics: Vec<Diagnostic>,
}

impl ActiveProgram {
    pub fn apply(&mut self, result: Result<Program, Vec<Diagnostic>>) -> bool {
        match result {
            Ok(program) => {
                self.diagnostics.clear();
                if self
                    .program
                    .as_ref()
                    .is_some_and(|old| old.sources == program.sources)
                {
                    return false;
                }
                self.program = Some(Arc::new(program));
                self.generation += 1;
                true
            }
            Err(diagnostics) => {
                self.diagnostics = diagnostics;
                false
            }
        }
    }
}

pub fn initialize_files(app_data: &Path) -> Result<PathBuf, String> {
    let root = app_data.join("talk");
    let marker = app_data.join(".talk-initialized-v1");
    if marker.try_exists().map_err(|error| error.to_string())? {
        migrate_defaults(&root);
        migrate_encryption(&root);
        return Ok(root.join("index.talk"));
    }
    if !root.try_exists().map_err(|error| error.to_string())? {
        let staging = app_data.join(format!(".talk-install-{}", uuid::Uuid::new_v4()));
        let result = (|| {
            for (name, text) in defaults::FILES {
                let path = staging.join(name);
                fs::create_dir_all(path.parent().ok_or("대본 경로가 잘못됐어요.")?)
                    .map_err(|error| error.to_string())?;
                let mut file = OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&path)
                    .map_err(|error| error.to_string())?;
                let source = super::encryption::decode(text.as_bytes())?;
                let encrypted = super::encryption::encode(&source)?;
                file.write_all(&encrypted)
                    .map_err(|error| error.to_string())?;
                file.sync_all().map_err(|error| error.to_string())?;
            }
            fs::rename(&staging, &root).map_err(|error| error.to_string())
        })();
        if result.is_err() {
            let _ = fs::remove_dir_all(&staging);
            result?;
        }
    }
    match OpenOptions::new().write(true).create_new(true).open(marker) {
        Ok(mut file) => file.write_all(b"1\n").map_err(|error| error.to_string())?,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(error.to_string()),
    }
    migrate_defaults(&root);
    migrate_encryption(&root);
    Ok(root.join("index.talk"))
}

fn migrate_defaults(root: &Path) {
    if !root.exists() {
        return;
    }
    if let Err(error) = upgrade_defaults(root, defaults::FILES, super::legacy::FILE_HASHES) {
        eprintln!(".talk default migration: {error}");
    }
}

fn upgrade_defaults(
    root: &Path,
    files: &[(&str, &str)],
    legacy: &[(&str, &str)],
) -> Result<(), String> {
    use sha2::{Digest, Sha256};
    let app_data = root.parent().ok_or("대본 경로가 잘못됐어요.")?;
    let marker = app_data.join(".talk-nadir-v1");
    if marker.try_exists().map_err(|error| error.to_string())? {
        return Ok(());
    }
    let entry = root.join("index.talk");
    let names = super::editor::list_files(&entry)?;
    let mut originals = BTreeMap::new();
    let mut replacements = BTreeMap::new();
    let mut source_bytes = 0;
    for name in &names {
        let document = super::editor::read_file(&entry, name)?;
        source_bytes += document.source.len();
        if source_bytes > 4 * 1024 * 1024 {
            return Err("대본 전체는 4 MiB 이하여야 해요.".into());
        }
        let original = super::encryption::read_bytes(&root.join(name))?;
        if hex::encode(Sha256::digest(&original)) != document.revision {
            return Err("기본 대본을 읽는 동안 파일이 바뀌었어요.".into());
        }
        originals.insert(name.clone(), original);
        let is_legacy = legacy.iter().any(|(old_name, hash)| {
            *old_name == name && hex::encode(Sha256::digest(document.source.as_bytes())) == *hash
        });
        if is_legacy {
            if let Some((_, source)) = files.iter().find(|(new_name, _)| *new_name == name) {
                let source = super::encryption::decode(source.as_bytes())?;
                replacements.insert(name.clone(), super::encryption::encode(&source)?);
            }
        }
    }
    if !replacements.is_empty() {
        let staging = app_data.join(format!(".talk-upgrade-{}", uuid::Uuid::new_v4()));
        let staged = (|| {
            for (name, original) in &originals {
                let data = replacements.get(name).unwrap_or(original);
                let path = staging.join(name);
                fs::create_dir_all(path.parent().ok_or("대본 경로가 잘못됐어요.")?)
                    .map_err(|error| error.to_string())?;
                super::editor::atomic_write(
                    &path,
                    &super::encryption::encode(&super::encryption::decode(data)?)?,
                )?;
            }
            super::load(&staging.join("index.talk"), &super::context::registry())
                .map_err(|errors| serde_json::to_string(&errors).unwrap_or_default())?;
            Ok::<(), String>(())
        })();
        let _ = fs::remove_dir_all(&staging);
        staged?;
        for (name, original) in &originals {
            if super::encryption::read_bytes(&root.join(name))? != *original {
                return Err("기본 대본을 갱신하는 동안 파일이 바뀌었어요.".into());
            }
        }
        let mut applied: Vec<String> = Vec::new();
        for (name, data) in &replacements {
            let path = root.join(name);
            let result = super::editor::atomic_write(&path, data);
            if let Err(error) = result {
                for previous in applied.iter().rev() {
                    let path = root.join(previous);
                    match originals.get(previous) {
                        Some(data) => super::editor::atomic_write(&path, data)?,
                        None => fs::remove_file(path).map_err(|error| error.to_string())?,
                    }
                }
                return Err(error);
            }
            applied.push(name.clone());
        }
    }
    super::editor::atomic_write(&marker, b"1\n")
}

fn migrate_encryption(root: &Path) {
    let entry = root.join("index.talk");
    if !root.exists() {
        return;
    }
    if let Err(error) = super::editor::seal_bundle(&entry, &super::context::registry()) {
        eprintln!(".talk encryption migration: {error}");
    }
}

type FileStamp = (u64, Option<SystemTime>, Option<PathBuf>);
type Fingerprint = BTreeMap<PathBuf, FileStamp>;

fn scan(
    root: &Path,
    directory: &Path,
    stamps: &mut Fingerprint,
    visited: &mut BTreeSet<PathBuf>,
    depth: usize,
) -> Result<(), String> {
    if depth > 32 || stamps.len() > 512 || visited.len() > 512 {
        return Err("대본 폴더의 파일 수나 깊이가 제한을 넘었어요.".into());
    }
    if !visited.insert(directory.to_path_buf()) {
        return Ok(());
    }
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.to_string()),
    };
    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
        let target = fs::canonicalize(&path).ok();
        let effective = target
            .as_ref()
            .filter(|target| target.starts_with(root))
            .and_then(|target| fs::metadata(target).ok());
        if effective.as_ref().is_some_and(|value| value.is_dir()) {
            stamps.insert(
                path,
                (metadata.len(), metadata.modified().ok(), target.clone()),
            );
            scan(root, target.as_ref().unwrap(), stamps, visited, depth + 1)?;
        } else if path
            .extension()
            .is_some_and(|extension| extension == "talk")
        {
            let value = effective.as_ref().unwrap_or(&metadata);
            stamps.insert(path, (value.len(), value.modified().ok(), target));
        }
        if stamps.len() > 512 {
            return Err("대본 폴더의 파일 수가 제한을 넘었어요.".into());
        }
    }
    Ok(())
}

pub struct Monitor {
    entry: PathBuf,
    observed: Option<Fingerprint>,
    settled_at: Instant,
    attempted: Option<Fingerprint>,
    scan_error: Option<String>,
}

impl Monitor {
    pub fn new(entry: PathBuf) -> Self {
        Self {
            entry,
            observed: None,
            settled_at: Instant::now(),
            attempted: None,
            scan_error: None,
        }
    }

    pub fn poll(
        &mut self,
        registry: &Registry,
        at: Instant,
    ) -> Option<Result<Program, Vec<Diagnostic>>> {
        let directory = self.entry.parent()?;
        let root = fs::canonicalize(directory).unwrap_or_else(|_| directory.to_path_buf());
        let mut fingerprint = Fingerprint::new();
        if let Err(message) = scan(&root, &root, &mut fingerprint, &mut BTreeSet::new(), 0) {
            if self.scan_error.as_ref() == Some(&message) {
                return None;
            }
            self.scan_error = Some(message.clone());
            return Some(Err(vec![Diagnostic {
                path: self.entry.display().to_string(),
                line: 1,
                column: 1,
                code: "WATCH_ERROR".into(),
                message,
            }]));
        }
        if self.scan_error.take().is_some() {
            self.attempted = None;
        }
        if self.observed.as_ref() != Some(&fingerprint) {
            self.observed = Some(fingerprint.clone());
            self.settled_at = at;
            return None;
        }
        if at.saturating_duration_since(self.settled_at) < Duration::from_millis(350)
            || self.attempted.as_ref() == Some(&fingerprint)
        {
            return None;
        }
        let result = super::load(&self.entry, registry);
        let mut after = Fingerprint::new();
        if scan(&root, &root, &mut after, &mut BTreeSet::new(), 0).is_err() || after != fingerprint
        {
            self.observed = None;
            return None;
        }
        self.attempted = Some(fingerprint);
        Some(result)
    }
}

pub fn history(db: &Connection) -> Result<History, String> {
    let mut statement = db
        .prepare("SELECT scene_key,shown_at FROM talk_history")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(|error| error.to_string())?;
    rows.map(|row| row.map_err(|error| error.to_string()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn factory_upgrade_replaces_only_exact_legacy_text_and_never_restores_deleted_files() {
        use sha2::{Digest, Sha256};
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("talk");
        fs::create_dir(&root).unwrap();
        let entry = "format: 1\nimport \"./part.talk\"\nimport \"./custom.talk\"\n";
        fs::write(root.join("index.talk"), entry).unwrap();
        fs::write(root.join("part.talk"), "# factory\n").unwrap();
        fs::write(root.join("custom.talk"), "# user edit\n").unwrap();
        let old_hash = hex::encode(Sha256::digest(b"# factory\n"));
        let entry_hash = hex::encode(Sha256::digest(entry.as_bytes()));
        let legacy = [
            ("index.talk", entry_hash.as_str()),
            ("part.talk", old_hash.as_str()),
            ("custom.talk", old_hash.as_str()),
            ("deleted.talk", old_hash.as_str()),
        ];
        let defaults = [
            ("index.talk", entry),
            ("part.talk", "# new factory\n"),
            ("custom.talk", "# replacement\n"),
            ("deleted.talk", "# replacement\n"),
        ];
        upgrade_defaults(&root, &defaults, &legacy).unwrap();
        assert_eq!(
            super::super::editor::read_file(&root.join("index.talk"), "part.talk")
                .unwrap()
                .source,
            "# new factory\n"
        );
        assert_eq!(
            fs::read_to_string(root.join("custom.talk")).unwrap(),
            "# user edit\n"
        );
        assert!(!root.join("deleted.talk").exists());
        fs::write(root.join("part.talk"), "# factory\n").unwrap();
        upgrade_defaults(&root, &defaults, &legacy).unwrap();
        assert_eq!(
            fs::read_to_string(root.join("part.talk")).unwrap(),
            "# factory\n"
        );
    }

    #[test]
    fn invalid_factory_upgrade_leaves_every_original_untouched() {
        use sha2::{Digest, Sha256};
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("talk");
        fs::create_dir(&root).unwrap();
        let source = "format: 1\n";
        fs::write(root.join("index.talk"), source).unwrap();
        let hash = hex::encode(Sha256::digest(source.as_bytes()));
        assert!(upgrade_defaults(
            &root,
            &[("index.talk", "format: 1\nimport \"missing.talk\"\n")],
            &[("index.talk", &hash)]
        )
        .is_err());
        assert_eq!(fs::read_to_string(root.join("index.talk")).unwrap(), source);
        assert!(!directory.path().join(".talk-nadir-v1").exists());
    }

    #[test]
    fn damaged_encrypted_reload_keeps_last_good_program() {
        let directory = tempfile::tempdir().unwrap();
        let entry = directory.path().join("index.talk");
        let source = "format: 1\n";
        let mut data = super::super::encryption::encode(source).unwrap();
        fs::write(&entry, &data).unwrap();
        let mut active = ActiveProgram::default();
        assert!(active.apply(super::super::load(&entry, &Registry::default())));
        let last = data.len() - 5;
        data[last] = if data[last] == b'A' { b'B' } else { b'A' };
        fs::write(&entry, data).unwrap();
        assert!(!active.apply(super::super::load(&entry, &Registry::default())));
        assert_eq!(active.generation, 1);
        assert_eq!(active.diagnostics[0].code, "DECRYPT");
        assert!(active.program.is_some());
    }

    #[test]
    fn seed_preserves_edits_and_does_not_restore_deleted_files_or_directories() {
        let directory = tempfile::tempdir().unwrap();
        let entry = initialize_files(directory.path()).unwrap();
        assert!(entry.is_file());
        fs::write(&entry, "format: 1\n").unwrap();
        initialize_files(directory.path()).unwrap();
        assert_eq!(
            super::super::encryption::decode(&fs::read(&entry).unwrap()).unwrap(),
            "format: 1\n"
        );
        fs::remove_dir_all(entry.parent().unwrap()).unwrap();
        initialize_files(directory.path()).unwrap();
        assert!(!entry.exists());
    }

    #[test]
    fn reload_is_settled_and_failed_import_keeps_previous_program_until_repaired() {
        let directory = tempfile::tempdir().unwrap();
        let entry = directory.path().join("index.talk");
        fs::write(&entry, "format: 1\n").unwrap();
        let registry = Registry::default();
        let mut active = ActiveProgram::default();
        let mut monitor = Monitor::new(entry.clone());
        let at = Instant::now();
        assert!(monitor.poll(&registry, at).is_none());
        assert!(active.apply(
            monitor
                .poll(&registry, at + Duration::from_secs(1))
                .unwrap()
        ));
        fs::write(&entry, "format: 1\nimport \"./missing.talk\"\n").unwrap();
        assert!(monitor
            .poll(&registry, at + Duration::from_secs(2))
            .is_none());
        assert!(!active.apply(
            monitor
                .poll(&registry, at + Duration::from_secs(3))
                .unwrap()
        ));
        assert_eq!(active.generation, 1);
        assert!(!active.diagnostics.is_empty());
        fs::write(directory.path().join("missing.talk"), "# repaired\n").unwrap();
        assert!(monitor
            .poll(&registry, at + Duration::from_secs(4))
            .is_none());
        assert!(active.apply(
            monitor
                .poll(&registry, at + Duration::from_secs(5))
                .unwrap()
        ));
        assert!(active.diagnostics.is_empty());
        assert_eq!(active.generation, 2);
    }
}
