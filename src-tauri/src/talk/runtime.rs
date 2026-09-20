use super::{defaults, parser::PACKS_DIRECTORY, Diagnostic, History, Program, Registry};
use rusqlite::Connection;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant, SystemTime},
};

const INITIALIZED_MARKER: &str = ".talk-initialized-v1";
const PACKS_MARKER: &str = ".talk-packs-v1";

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

/// The `.talk` folder inside app data. The user's `index.talk` and `packs/<id>/` live here.
pub fn root(app_data: &Path) -> PathBuf {
    app_data.join("talk")
}

fn app_data_of(root: &Path) -> Result<&Path, String> {
    root.parent()
        .ok_or_else(|| "대본 경로가 잘못됐어요.".into())
}

fn write_marker(path: &Path) -> Result<(), String> {
    match OpenOptions::new().write(true).create_new(true).open(path) {
        Ok(mut file) => file.write_all(b"1\n").map_err(|error| error.to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

fn write_encrypted_tree(directory: &Path, files: &[(&str, &str)]) -> Result<(), String> {
    for (name, text) in files {
        let path = directory.join(name);
        fs::create_dir_all(path.parent().ok_or("대본 경로가 잘못됐어요.")?)
            .map_err(|error| error.to_string())?;
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|error| error.to_string())?;
        let source = super::encryption::decode(text.as_bytes())?;
        file.write_all(&super::encryption::encode(&source)?)
            .map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// Creates the user's empty entry once, then applies the one-time migrations. Deleted files and
/// folders are never restored. Returns the `.talk` root.
pub fn initialize_files(app_data: &Path) -> Result<PathBuf, String> {
    let root = root(app_data);
    let marker = app_data.join(INITIALIZED_MARKER);
    let initialized = marker.try_exists().map_err(|error| error.to_string())?;
    if !initialized && !root.try_exists().map_err(|error| error.to_string())? {
        let staging = app_data.join(format!(".talk-install-{}", uuid::Uuid::new_v4()));
        let result = write_encrypted_tree(&staging, &[("index.talk", defaults::USER_ENTRY)])
            .and_then(|_| fs::rename(&staging, &root).map_err(|error| error.to_string()));
        if result.is_err() {
            let _ = fs::remove_dir_all(&staging);
            result?;
        }
    }
    if !initialized {
        write_marker(&marker)?;
    }
    migrate_defaults(&root);
    migrate_packs(&root);
    migrate_encryption(&root);
    Ok(root)
}

fn migrate_defaults(root: &Path) {
    if !root.exists() {
        return;
    }
    let Some(nadir) = defaults::pack(defaults::NADIR_AND_STAR_TAIL) else {
        return;
    };
    if let Err(error) = upgrade_defaults(root, nadir.files, super::legacy::FILE_HASHES) {
        eprintln!(".talk default migration: {error}");
    }
}

fn upgrade_defaults(
    root: &Path,
    files: &[(&str, &str)],
    legacy: &[(&str, &str)],
) -> Result<(), String> {
    let app_data = app_data_of(root)?;
    let marker = app_data.join(".talk-nadir-v1");
    if marker.try_exists().map_err(|error| error.to_string())? {
        return Ok(());
    }
    let entry = root.join("index.talk");
    let names = super::files::list_files(&entry)?
        .into_iter()
        .filter(|name| !name.starts_with(&format!("{PACKS_DIRECTORY}/")))
        .collect::<Vec<_>>();
    let mut originals = BTreeMap::new();
    let mut replacements = BTreeMap::new();
    let mut source_bytes = 0;
    for name in &names {
        let document = super::files::read(&entry, name)?;
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
                super::files::atomic_write(
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
            let result = super::files::atomic_write(&path, data);
            if let Err(error) = result {
                for previous in applied.iter().rev() {
                    let path = root.join(previous);
                    match originals.get(previous) {
                        Some(data) => super::files::atomic_write(&path, data)?,
                        None => fs::remove_file(path).map_err(|error| error.to_string())?,
                    }
                }
                return Err(error);
            }
            applied.push(name.clone());
        }
    }
    super::files::atomic_write(&marker, b"1\n")
}

fn migrate_packs(root: &Path) {
    if !root.exists() {
        return;
    }
    if let Err(error) = install_default_packs(root) {
        eprintln!(".talk pack migration: {error}");
    }
}

fn source_hash(text: &str) -> Result<String, String> {
    Ok(hex::encode(Sha256::digest(
        super::encryption::decode(text.as_bytes())?.as_bytes(),
    )))
}

/// One-time step: a root bundle that is byte-for-byte the 0.5.0 factory Nadir bundle moves into
/// `packs/nadir-and-star-tail/`; edited bundles stay where they are. Then every
/// `default_installed` pack that is absent is installed and the marker is written so a later
/// removal is never undone by a restart.
fn install_default_packs(root: &Path) -> Result<(), String> {
    let app_data = app_data_of(root)?;
    let marker = app_data.join(PACKS_MARKER);
    if marker.try_exists().map_err(|error| error.to_string())? {
        return Ok(());
    }
    if let Some(nadir) = defaults::pack(defaults::NADIR_AND_STAR_TAIL) {
        relocate_factory_bundle(root, nadir)?;
    }
    for pack in defaults::PACKS.iter().filter(|pack| pack.default_installed) {
        if !root.join(PACKS_DIRECTORY).join(pack.id).exists() {
            install_pack(root, pack)?;
        }
    }
    super::files::atomic_write(&marker, b"1\n")
}

fn relocate_factory_bundle(root: &Path, pack: &defaults::Pack) -> Result<(), String> {
    let entry = root.join("index.talk");
    let names = super::files::list_files(&entry)?
        .into_iter()
        .filter(|name| !name.starts_with(&format!("{PACKS_DIRECTORY}/")))
        .collect::<Vec<_>>();
    if names.is_empty() || !names.iter().any(|name| name == "index.talk") {
        return Ok(());
    }
    let factory = pack
        .files
        .iter()
        .map(|(name, text)| Ok((*name, source_hash(text)?)))
        .collect::<Result<BTreeMap<_, _>, String>>()?;
    let mut stored = BTreeMap::new();
    for name in &names {
        let document = super::files::read(&entry, name)?;
        let hash = hex::encode(Sha256::digest(document.source.as_bytes()));
        if factory.get(name.as_str()) != Some(&hash) {
            return Ok(());
        }
        stored.insert(
            name.clone(),
            super::encryption::read_bytes(&root.join(name))?,
        );
    }
    let target = root.join(PACKS_DIRECTORY).join(pack.id);
    if target.exists() {
        return Ok(());
    }
    let app_data = app_data_of(root)?;
    let staging = app_data.join(format!(".talk-pack-{}", uuid::Uuid::new_v4()));
    let staged = (|| {
        for (name, data) in &stored {
            let path = staging.join(name);
            fs::create_dir_all(path.parent().ok_or("대본 경로가 잘못됐어요.")?)
                .map_err(|error| error.to_string())?;
            super::files::atomic_write(&path, data)?;
        }
        super::load_pack(
            &staging.join("index.talk"),
            &super::context::registry(),
            pack.id,
        )
        .map_err(|errors| serde_json::to_string(&errors).unwrap_or_default())?;
        for (name, data) in &stored {
            if super::encryption::read_bytes(&root.join(name))? != *data {
                return Err("기본 대본을 옮기는 동안 파일이 바뀌었어요.".into());
            }
        }
        fs::create_dir_all(target.parent().ok_or("대본 경로가 잘못됐어요.")?)
            .map_err(|error| error.to_string())?;
        fs::rename(&staging, &target).map_err(|error| error.to_string())
    })();
    if staged.is_err() {
        let _ = fs::remove_dir_all(&staging);
        staged?;
    }
    for name in stored.keys() {
        fs::remove_file(root.join(name)).map_err(|error| error.to_string())?;
    }
    for directory in ["widgets", "situations", "pairs"] {
        let _ = fs::remove_dir(root.join(directory));
    }
    let source = super::encryption::decode(defaults::USER_ENTRY.as_bytes())?;
    super::files::atomic_write(&entry, &super::encryption::encode(&source)?)
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PackStatus {
    pub id: String,
    pub name: String,
    pub description: String,
    pub installed: bool,
    pub bundled: bool,
    pub default_installed: bool,
}

/// Bundled packs first, then packs found on disk that the app did not ship.
pub fn pack_statuses(root: &Path) -> Result<Vec<PackStatus>, String> {
    let installed = super::parser::installed_packs(root)?
        .into_iter()
        .collect::<BTreeSet<_>>();
    let mut statuses = defaults::PACKS
        .iter()
        .map(|pack| PackStatus {
            id: pack.id.into(),
            name: pack.name.into(),
            description: pack.description.into(),
            installed: installed.contains(pack.id),
            bundled: true,
            default_installed: pack.default_installed,
        })
        .collect::<Vec<_>>();
    for id in installed {
        if defaults::pack(&id).is_none() {
            statuses.push(PackStatus {
                name: id.clone(),
                id,
                description: String::new(),
                installed: true,
                bundled: false,
                default_installed: false,
            });
        }
    }
    Ok(statuses)
}

/// Copies a bundled pack into `<root>/packs/<id>/` through a staging folder that is validated
/// with the real parser before it is renamed into place.
pub fn install_pack(root: &Path, pack: &defaults::Pack) -> Result<(), String> {
    if !super::parser::valid_pack_id(pack.id) {
        return Err("대화팩 ID가 잘못됐어요.".into());
    }
    let target = root.join(PACKS_DIRECTORY).join(pack.id);
    if target.exists() {
        return Err("이미 설치된 대화팩이에요.".into());
    }
    fs::create_dir_all(root.join(PACKS_DIRECTORY)).map_err(|error| error.to_string())?;
    let staging = app_data_of(root)?.join(format!(".talk-pack-{}", uuid::Uuid::new_v4()));
    let result = write_encrypted_tree(&staging, pack.files)
        .and_then(|_| {
            super::load_pack(
                &staging.join("index.talk"),
                &super::context::registry(),
                pack.id,
            )
            .map_err(|errors| serde_json::to_string(&errors).unwrap_or_default())
        })
        .and_then(|_| fs::rename(&staging, &target).map_err(|error| error.to_string()));
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

pub fn install_bundled_pack(root: &Path, id: &str) -> Result<(), String> {
    let pack = defaults::pack(id).ok_or("앱에 동봉되지 않은 대화팩이에요.")?;
    if !root.exists() {
        fs::create_dir_all(root).map_err(|error| error.to_string())?;
    }
    install_pack(root, pack)
}

/// Deletes `<root>/packs/<id>/`. The removal is final: restarts do not reinstall it.
pub fn remove_pack(root: &Path, id: &str) -> Result<(), String> {
    if !super::parser::valid_pack_id(id) {
        return Err("대화팩 ID가 잘못됐어요.".into());
    }
    let target = root.join(PACKS_DIRECTORY).join(id);
    let metadata = fs::symlink_metadata(&target).map_err(|_| "설치되지 않은 대화팩이에요.")?;
    if !metadata.is_dir() {
        return Err("대화팩 폴더가 아니에요.".into());
    }
    fs::remove_dir_all(&target).map_err(|error| error.to_string())
}

fn migrate_encryption(root: &Path) {
    if !root.exists() {
        return;
    }
    if let Err(error) = super::files::seal_bundle(root, &super::context::registry()) {
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

/// Polls the `.talk` root (user entry and installed packs) and reloads the bundle once the
/// files have been unchanged for 350ms.
pub struct Monitor {
    root: PathBuf,
    observed: Option<Fingerprint>,
    settled_at: Instant,
    attempted: Option<Fingerprint>,
    scan_error: Option<String>,
}

impl Monitor {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
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
        let root = fs::canonicalize(&self.root).unwrap_or_else(|_| self.root.clone());
        let mut fingerprint = Fingerprint::new();
        if let Err(message) = scan(&root, &root, &mut fingerprint, &mut BTreeSet::new(), 0) {
            if self.scan_error.as_ref() == Some(&message) {
                return None;
            }
            self.scan_error = Some(message.clone());
            return Some(Err(vec![Diagnostic {
                path: self.root.display().to_string(),
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
        let result = super::load_bundle(&self.root, registry);
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
    use crate::talk::{context, load_bundle};

    fn decoded(path: &Path) -> String {
        crate::talk::encryption::decode(&fs::read(path).unwrap()).unwrap()
    }

    #[test]
    fn factory_upgrade_replaces_only_exact_legacy_text_and_never_restores_deleted_files() {
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
            super::super::files::read(&root.join("index.talk"), "part.talk")
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
    fn fresh_install_seeds_only_the_default_pack_and_keeps_user_edits_and_deletions() {
        let directory = tempfile::tempdir().unwrap();
        let root = initialize_files(directory.path()).unwrap();
        let entry = root.join("index.talk");
        assert!(decoded(&entry).starts_with("format: 1\n"));
        assert!(root.join("packs/byulkkori/index.talk").is_file());
        assert!(!root.join("packs/nadir-and-star-tail").exists());
        let program = load_bundle(&root, &context::registry()).unwrap();
        assert_eq!(program.packs, BTreeSet::from(["byulkkori".to_owned()]));
        assert!(program.scenes.iter().all(|scene| scene.pack.is_some()));
        let statuses = pack_statuses(&root).unwrap();
        assert_eq!(statuses.len(), 2);
        assert!(statuses[0].installed && statuses[0].default_installed);
        assert!(!statuses[1].installed && statuses[1].bundled);

        fs::write(&entry, "format: 1\n").unwrap();
        initialize_files(directory.path()).unwrap();
        assert_eq!(decoded(&entry), "format: 1\n");

        remove_pack(&root, "byulkkori").unwrap();
        assert!(remove_pack(&root, "byulkkori").is_err());
        initialize_files(directory.path()).unwrap();
        assert!(!root.join("packs/byulkkori").exists());
        assert!(load_bundle(&root, &context::registry())
            .unwrap()
            .scenes
            .is_empty());

        install_bundled_pack(&root, "nadir-and-star-tail").unwrap();
        assert!(install_bundled_pack(&root, "nadir-and-star-tail").is_err());
        assert!(install_bundled_pack(&root, "unknown").is_err());
        assert!(remove_pack(&root, "../talk").is_err());
        let program = load_bundle(&root, &context::registry()).unwrap();
        assert_eq!(
            program.packs,
            BTreeSet::from(["nadir-and-star-tail".to_owned()])
        );
        assert!(program
            .scenes
            .iter()
            .all(|scene| scene.pair.is_some() && scene.key.contains("nadir-and-star-tail")));

        fs::remove_dir_all(&root).unwrap();
        initialize_files(directory.path()).unwrap();
        assert!(!root.exists());
    }

    fn nadir_files() -> &'static [(&'static str, &'static str)] {
        defaults::pack(defaults::NADIR_AND_STAR_TAIL).unwrap().files
    }

    #[test]
    fn factory_nadir_root_bundle_moves_into_its_pack_and_history_keys_switch_scope() {
        let directory = tempfile::tempdir().unwrap();
        let root = root(directory.path());
        write_encrypted_tree(&root, nadir_files()).unwrap();
        write_marker(&directory.path().join(INITIALIZED_MARKER)).unwrap();
        write_marker(&directory.path().join(".talk-nadir-v1")).unwrap();
        let before = super::super::load(&root.join("index.talk"), &context::registry()).unwrap();
        assert!(before.scenes.iter().all(|scene| scene.pack.is_none()));

        initialize_files(directory.path()).unwrap();
        assert!(decoded(&root.join("index.talk")).starts_with("format: 1\n"));
        assert!(!root.join("widgets").exists());
        assert!(!root.join("situations").exists());
        for (name, _) in nadir_files() {
            assert!(
                root.join("packs/nadir-and-star-tail").join(name).is_file(),
                "{name}"
            );
        }
        let program = load_bundle(&root, &context::registry()).unwrap();
        assert_eq!(
            program.packs,
            BTreeSet::from(["byulkkori".to_owned(), "nadir-and-star-tail".to_owned()])
        );
        assert_eq!(
            program
                .scenes
                .iter()
                .filter(|scene| scene.pack.as_deref() == Some("nadir-and-star-tail"))
                .count(),
            before.scenes.len()
        );
        // Running the migration again is a no-op.
        initialize_files(directory.path()).unwrap();
        assert_eq!(
            load_bundle(&root, &context::registry())
                .unwrap()
                .scenes
                .len(),
            program.scenes.len()
        );
    }

    #[test]
    fn edited_root_bundle_stays_in_place_and_only_gains_the_default_pack() {
        let directory = tempfile::tempdir().unwrap();
        let root = root(directory.path());
        write_encrypted_tree(&root, nadir_files()).unwrap();
        write_marker(&directory.path().join(INITIALIZED_MARKER)).unwrap();
        write_marker(&directory.path().join(".talk-nadir-v1")).unwrap();
        let edited = root.join("widgets/todo.talk");
        let original = decoded(&edited);
        fs::write(&edited, format!("{original}\n# 내가 고친 대본\n")).unwrap();

        initialize_files(directory.path()).unwrap();
        assert!(root.join("widgets/todo.talk").is_file());
        assert!(decoded(&root.join("index.talk")).contains("source:nadir"));
        assert!(!root.join("packs/nadir-and-star-tail").exists());
        assert!(root.join("packs/byulkkori/index.talk").is_file());
        let program = load_bundle(&root, &context::registry()).unwrap();
        assert!(program.scenes.iter().any(|scene| scene.pack.is_none()));
        assert!(program
            .scenes
            .iter()
            .any(|scene| scene.pack.as_deref() == Some("byulkkori")));
        assert!(decoded(&edited).contains("내가 고친 대본"));
    }

    #[test]
    fn seed_preserves_edits_and_does_not_restore_deleted_files_or_directories() {
        let directory = tempfile::tempdir().unwrap();
        let root = initialize_files(directory.path()).unwrap();
        let entry = root.join("index.talk");
        assert!(entry.is_file());
        fs::write(&entry, "format: 1\n").unwrap();
        initialize_files(directory.path()).unwrap();
        assert_eq!(decoded(&entry), "format: 1\n");
        fs::remove_dir_all(&root).unwrap();
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
        let mut monitor = Monitor::new(directory.path().to_path_buf());
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

    #[test]
    fn installing_or_removing_a_pack_is_picked_up_by_the_watcher() {
        let directory = tempfile::tempdir().unwrap();
        let root = initialize_files(directory.path()).unwrap();
        let registry = context::registry();
        let mut active = ActiveProgram::default();
        let mut monitor = Monitor::new(root.clone());
        let at = Instant::now();
        assert!(monitor.poll(&registry, at).is_none());
        assert!(active.apply(
            monitor
                .poll(&registry, at + Duration::from_secs(1))
                .unwrap()
        ));
        let seeded = active.program.as_ref().unwrap().scenes.len();
        remove_pack(&root, "byulkkori").unwrap();
        assert!(monitor
            .poll(&registry, at + Duration::from_secs(2))
            .is_none());
        assert!(active.apply(
            monitor
                .poll(&registry, at + Duration::from_secs(3))
                .unwrap()
        ));
        assert!(active.program.as_ref().unwrap().scenes.is_empty());
        install_bundled_pack(&root, "byulkkori").unwrap();
        assert!(monitor
            .poll(&registry, at + Duration::from_secs(4))
            .is_none());
        assert!(active.apply(
            monitor
                .poll(&registry, at + Duration::from_secs(5))
                .unwrap()
        ));
        assert_eq!(active.program.as_ref().unwrap().scenes.len(), seeded);
        assert_eq!(active.generation, 3);
    }
}
