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
                file.write_all(text.as_bytes())
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
    Ok(root.join("index.talk"))
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
    fn seed_preserves_edits_and_does_not_restore_deleted_files_or_directories() {
        let directory = tempfile::tempdir().unwrap();
        let entry = initialize_files(directory.path()).unwrap();
        assert!(entry.is_file());
        fs::write(&entry, "format: 1\n").unwrap();
        initialize_files(directory.path()).unwrap();
        assert_eq!(fs::read_to_string(&entry).unwrap(), "format: 1\n");
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
