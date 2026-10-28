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
    pub fn remove_pack(&mut self, id: &str, directory: &Path) {
        self.generation += 1;
        let Some(program) = self.program.as_mut() else {
            return;
        };
        let program = Arc::make_mut(program);
        program.packs.remove(id);
        program.scenes.retain(|scene| {
            scene.pack.as_deref() != Some(id) && !Path::new(&scene.span.path).starts_with(directory)
        });
        program.files.retain(|path| !path.starts_with(directory));
        program
            .sources
            .retain(|path, _| !path.starts_with(directory));
    }

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
    if let Err(error) = super::retired::migrate(&root) {
        crate::report_error!(
            "talk_migration_retired_widget",
            ".talk retired-widget migration: {error}"
        );
    }
    migrate_defaults(&root);
    migrate_packs(&root);
    if let Err(error) = upgrade_bundled_dialogue(&root) {
        crate::report_error!(
            "talk_migration_dialogue",
            ".talk dialogue migration: {error}"
        );
    }
    if let Err(error) = replace_byulkkori_dialogue(&root) {
        crate::report_error!(
            "talk_migration_byulkkori",
            ".talk byulkkori dialogue replacement: {error}"
        );
    }
    if let Err(error) = add_revived_widget_dialogue(&root) {
        crate::report_error!(
            "talk_migration_revived_widget",
            ".talk revived widget dialogue: {error}"
        );
    }
    if let Err(error) = add_touch_milestone_dialogue(&root) {
        crate::report_error!("talk_migration_touch_milestone", ".talk touch milestone dialogue: {error}");
    }
    if let Err(error) = upgrade_weather_dialogue(&root) {
        crate::report_error!("talk_migration_weather", ".talk weather dialogue: {error}");
    }
    if let Err(error) = add_recall_dialogue(&root) {
        crate::report_error!("talk_migration_recall", ".talk recall dialogue: {error}");
    }
    if let Err(error) = add_birthday_dialogue(&root) {
        crate::report_error!(
            "talk_migration_birthday",
            ".talk birthday dialogue: {error}"
        );
    }
    if let Err(error) = add_activity_dialogue(&root) {
        crate::report_error!("talk_migration_activity", ".talk activity dialogue: {error}");
    }
    migrate_encryption(&root);
    Ok(root)
}

fn add_activity_dialogue(root: &Path) -> Result<(), String> {
    let marker = app_data_of(root)?.join(".talk-byulkkori-activity-v1");
    if marker.try_exists().map_err(|error| error.to_string())? || !root.exists() {
        return Ok(());
    }
    let target = root
        .join(PACKS_DIRECTORY)
        .join(defaults::BYULKKORI)
        .join("situations/solo.talk");
    let current = match fs::read(&target) {
        Ok(bytes) => Some(bytes),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error.to_string()),
    };
    let previous = super::encryption::decode(include_bytes!(
        "../../content/previous-byulkkori-solo-activity.talk"
    ))?;
    if let Some(original) = current {
        if super::encryption::decode(&original)? == previous {
            let pack = defaults::pack(defaults::BYULKKORI).ok_or("기본 대본을 찾지 못했어요.")?;
            let replacement = pack
                .files
                .iter()
                .find(|(name, _)| *name == "situations/solo.talk")
                .map(|(_, source)| *source)
                .ok_or("기본 대본을 찾지 못했어요.")?;
            if fs::read(&target).map_err(|error| error.to_string())? != original {
                return Err("기본 대본을 갱신하는 동안 파일이 바뀌었어요.".into());
            }
            super::files::atomic_write(&target, replacement.as_bytes())?;
        }
    }
    super::files::atomic_write(&marker, b"1\n")
}

fn upgrade_weather_dialogue(root: &Path) -> Result<(), String> {
    let marker = app_data_of(root)?.join(".talk-byulkkori-weather-v1");
    if marker.try_exists().map_err(|error| error.to_string())? || !root.exists() {
        return Ok(());
    }
    let name = "situations/weather.talk";
    let path = root
        .join(PACKS_DIRECTORY)
        .join(defaults::BYULKKORI)
        .join(name);
    match fs::read(&path) {
        Ok(bytes) => {
            let source = super::encryption::decode(&bytes)?;
            if hex::encode(Sha256::digest(source.as_bytes()))
                == "5daac9d1b9bcada63486755104054ae2489aa3beab952cc781d0d01e7f14fa3e"
            {
                let pack =
                    defaults::pack(defaults::BYULKKORI).ok_or("기본 대본을 찾지 못했어요.")?;
                let bundled = pack
                    .files
                    .iter()
                    .find(|(file, _)| *file == name)
                    .map(|(_, source)| *source)
                    .ok_or("기본 대본을 찾지 못했어요.")?;
                super::files::atomic_write(&path, bundled.as_bytes())?;
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }
    super::files::atomic_write(&marker, b"1\n")
}

const REVIVED_WIDGET_FILES: [&str; 6] = [
    "widgets/completion-jar.talk",
    "widgets/device.talk",
    "widgets/guessing.talk",
    "widgets/fishing.talk",
    "widgets/plant.talk",
    "widgets/pet.talk",
];

fn add_birthday_dialogue(root: &Path) -> Result<(), String> {
    let marker = app_data_of(root)?.join(".talk-byulkkori-birthday-v1");
    if marker.try_exists().map_err(|error| error.to_string())? || !root.exists() {
        return Ok(());
    }
    let pack = defaults::pack(defaults::BYULKKORI).ok_or("기본 대본을 찾지 못했어요.")?;
    let target = root.join(PACKS_DIRECTORY).join(pack.id);
    let entry = target.join("index.talk");
    let bundled = |name: &str| {
        pack.files
            .iter()
            .find(|(path, _)| *path == name)
            .map(|(_, source)| *source)
            .ok_or("기본 대본을 찾지 못했어요.")
    };
    let new_index = super::encryption::decode(bundled("index.talk")?.as_bytes())?;
    let previous = new_index.replace("import \"./situations/birthday.talk\"\n", "");
    let current = match fs::read(&entry) {
        Ok(bytes) => Some(super::encryption::decode(&bytes)?),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error.to_string()),
    };
    if current.as_deref() == Some(previous.as_str()) {
        let path = target.join("situations/birthday.talk");
        let missing = match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.file_type().is_file() => {
                let existing = fs::read(&path).ok().and_then(|bytes| super::encryption::decode(&bytes).ok());
                let expected = super::encryption::decode(bundled("situations/birthday.talk")?.as_bytes())?;
                if existing.as_deref() != Some(expected.as_str()) {
                    return super::files::atomic_write(&marker, b"1\n");
                }
                false
            }
            Ok(_) => return super::files::atomic_write(&marker, b"1\n"),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => true,
            Err(error) => return Err(error.to_string()),
        };
        if missing {
            super::files::atomic_write(&path, bundled("situations/birthday.talk")?.as_bytes())?;
        }
        if let Err(error) = super::files::atomic_write(&entry, bundled("index.talk")?.as_bytes()) {
            if missing { let _ = fs::remove_file(&path); }
            return Err(error);
        }
    }
    super::files::atomic_write(&marker, b"1\n")
}

/// One-time addition of the revived widget scripts to an installed Byulkkori pack. Only an
/// entry that still matches the previous factory index is updated, so user imports survive.
fn add_revived_widget_dialogue(root: &Path) -> Result<(), String> {
    let marker = app_data_of(root)?.join(".talk-byulkkori-revived-widgets-v1");
    if marker.try_exists().map_err(|error| error.to_string())? || !root.exists() {
        return Ok(());
    }
    let pack = defaults::pack(defaults::BYULKKORI).ok_or("기본 대본을 찾지 못했어요.")?;
    let target = root.join(PACKS_DIRECTORY).join(pack.id);
    let entry = target.join("index.talk");
    let previous = super::encryption::decode(
        include_str!("../../content/previous-byulkkori-index-v4.talk").as_bytes(),
    )?;
    let current = match fs::read(&entry) {
        Ok(bytes) => Some(super::encryption::decode(&bytes)?),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error.to_string()),
    };
    if current.as_deref() == Some(previous.as_str()) {
        let bundled = |name: &str| {
            pack.files
                .iter()
                .find(|(path, _)| *path == name)
                .map(|(_, source)| *source)
                .ok_or("기본 대본을 찾지 못했어요.")
        };
        for name in REVIVED_WIDGET_FILES {
            let path = target.join(name);
            if !path.try_exists().map_err(|error| error.to_string())? {
                super::files::atomic_write(&path, bundled(name)?.as_bytes())?;
            }
        }
        // The entry goes last: until it imports them, the added files stay inert.
        super::files::atomic_write(
            &entry,
            include_str!("../../content/previous-byulkkori-index-v5.talk").as_bytes(),
        )?;
    }
    super::files::atomic_write(&marker, b"1\n")
}

fn add_touch_milestone_dialogue(root: &Path) -> Result<(), String> {
    let marker = app_data_of(root)?.join(".talk-byulkkori-touch-milestone-v1");
    if marker.try_exists().map_err(|error| error.to_string())? || !root.exists() {
        return Ok(());
    }
    let pack = defaults::pack(defaults::BYULKKORI).ok_or("기본 대본을 찾지 못했어요.")?;
    let target = root.join(PACKS_DIRECTORY).join(pack.id);
    let entry = target.join("index.talk");
    let previous = super::encryption::decode(
        include_str!("../../content/previous-byulkkori-index-v5.talk").as_bytes(),
    )?;
    let current = match fs::read(&entry) {
        Ok(bytes) => Some(super::encryption::decode(&bytes)?),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error.to_string()),
    };
    let scene = target.join("widgets/interaction-milestone.talk");
    if current.as_deref() == Some(previous.as_str()) {
        let program = super::load_pack(&entry, &super::context::registry(), pack.id)
            .map_err(|errors| serde_json::to_string(&errors).unwrap_or_default())?;
        if program.scenes.iter().any(|scene| {
            [1, 10, 100, 500, 1000]
                .iter()
                .any(|count| scene.id == format!("interaction.milestone-{count}"))
        }) {
            return super::files::atomic_write(&marker, b"1\n");
        }
        let bundled = |name: &str| {
            pack.files
                .iter()
                .find(|(path, _)| *path == name)
                .map(|(_, source)| *source)
                .ok_or("기본 대본을 찾지 못했어요.")
        };
        let source = bundled("widgets/interaction-milestone.talk")?;
        let ready = match fs::read(&scene) {
            Ok(bytes) => {
                super::encryption::decode(&bytes)?
                    == super::encryption::decode(source.as_bytes())?
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                super::files::atomic_write(&scene, source.as_bytes())?;
                true
            }
            Err(error) => return Err(error.to_string()),
        };
        if ready {
            super::files::atomic_write(
                &entry,
                include_str!("../../content/previous-byulkkori-index-v6.talk").as_bytes(),
            )?;
        }
    }
    super::files::atomic_write(&marker, b"1\n")
}

/// Add recall scenes only when the installed index is the known previous factory index.
fn add_recall_dialogue(root: &Path) -> Result<(), String> {
    let marker = app_data_of(root)?.join(".talk-byulkkori-recall-v1");
    if marker.try_exists().map_err(|error| error.to_string())? || !root.exists() {
        return Ok(());
    }
    let pack = defaults::pack(defaults::BYULKKORI).ok_or("기본 대본을 찾지 못했어요.")?;
    let target = root.join(PACKS_DIRECTORY).join(pack.id);
    let entry = target.join("index.talk");
    let previous = super::encryption::decode(
        include_str!("../../content/previous-byulkkori-index-v6.talk").as_bytes(),
    )?;
    let current = match fs::read(&entry) {
        Ok(bytes) => Some(super::encryption::decode(&bytes)?),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error.to_string()),
    };
    if current.as_deref() == Some(previous.as_str()) {
        let bundled = |name: &str| {
            pack.files
                .iter()
                .find(|(path, _)| *path == name)
                .map(|(_, source)| *source)
                .ok_or("기본 대본을 찾지 못했어요.")
        };
        let scene = target.join("situations/recall.talk");
        let bundled_scene = bundled("situations/recall.talk")?;
        let missing = match fs::symlink_metadata(&scene) {
            Ok(metadata) if metadata.file_type().is_file() => {
                let current = fs::read(&scene)
                    .ok()
                    .and_then(|bytes| super::encryption::decode(&bytes).ok());
                let expected = super::encryption::decode(bundled_scene.as_bytes())?;
                if current.as_deref() != Some(expected.as_str()) {
                    return super::files::atomic_write(&marker, b"1\n");
                }
                false
            }
            Ok(_) => return super::files::atomic_write(&marker, b"1\n"),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => true,
            Err(error) => return Err(error.to_string()),
        };
        if missing {
            super::files::atomic_write(&scene, bundled_scene.as_bytes())?;
        }
        let full_index = super::encryption::decode(bundled("index.talk")?.as_bytes())?;
        let recall_index = full_index.replace("import \"./situations/birthday.talk\"\n", "");
        if let Err(error) = super::files::atomic_write(&entry, &super::encryption::encode(&recall_index)?) {
            if missing {
                let _ = fs::remove_file(&scene);
            }
            return Err(error);
        }
    }
    super::files::atomic_write(&marker, b"1\n")
}

/// One-time overwrite of the installed Byulkkori pack with the rewritten bundled dialogue,
/// including user edits inside that pack. A pack the user already removed is never restored.
fn replace_byulkkori_dialogue(root: &Path) -> Result<(), String> {
    let marker = app_data_of(root)?.join(".talk-byulkkori-dialogue-v4");
    if marker.try_exists().map_err(|error| error.to_string())? || !root.exists() {
        return Ok(());
    }
    let pack = defaults::pack(defaults::BYULKKORI).ok_or("기본 대본을 찾지 못했어요.")?;
    let target = root.join(PACKS_DIRECTORY).join(pack.id);
    if target.exists() {
        let app_data = app_data_of(root)?;
        let staging = app_data.join(format!(".talk-pack-{}", uuid::Uuid::new_v4()));
        let backup = app_data.join(format!(".talk-pack-old-{}", uuid::Uuid::new_v4()));
        let staged = write_encrypted_tree(&staging, pack.files).and_then(|_| {
            super::load_pack(
                &staging.join("index.talk"),
                &super::context::registry(),
                pack.id,
            )
            .map(|_| ())
            .map_err(|errors| serde_json::to_string(&errors).unwrap_or_default())
        });
        if let Err(error) = staged {
            let _ = fs::remove_dir_all(&staging);
            return Err(error);
        }
        fs::rename(&target, &backup).map_err(|error| error.to_string())?;
        if let Err(error) = fs::rename(&staging, &target) {
            let _ = fs::rename(&backup, &target);
            let _ = fs::remove_dir_all(&staging);
            return Err(error.to_string());
        }
        let _ = fs::remove_dir_all(&backup);
    }
    super::files::atomic_write(&marker, b"1\n")
}

fn upgrade_bundled_dialogue(root: &Path) -> Result<(), String> {
    let marker = app_data_of(root)?.join(".talk-dialogue-v3");
    if marker.try_exists().map_err(|error| error.to_string())? || !root.exists() {
        return Ok(());
    }
    let previous = [
        (
            "packs/byulkkori/situations/solo.talk",
            &[
                include_str!("../../content/previous-byulkkori-solo.talk"),
                include_str!("../../content/previous-byulkkori-solo-v2.talk"),
                include_str!("../../content/previous-byulkkori-solo-local.talk"),
            ],
            defaults::BYULKKORI,
            "situations/solo.talk",
        ),
        (
            "packs/nadir-and-star-tail/situations/index.talk",
            &[
                include_str!("../../content/previous-nadir-situations.talk"),
                include_str!("../../content/previous-nadir-situations-v2.talk"),
                include_str!("../../content/previous-nadir-situations-local.talk"),
            ],
            defaults::NADIR_AND_STAR_TAIL,
            "situations/index.talk",
        ),
        (
            "situations/index.talk",
            &[
                include_str!("../../content/previous-nadir-situations.talk"),
                include_str!("../../content/previous-nadir-situations-v2.talk"),
                include_str!("../../content/previous-nadir-situations-local.talk"),
            ],
            defaults::NADIR_AND_STAR_TAIL,
            "situations/index.talk",
        ),
    ];
    let entry = root.join("index.talk");
    let mut originals = BTreeMap::new();
    let mut replacements = BTreeMap::new();
    let mut bytes = 0;
    for name in super::files::list_files(&entry)? {
        let document = super::files::read(&entry, &name)?;
        bytes += document.source.len();
        if bytes > 4 * 1024 * 1024 {
            return Err("대본 전체는 4 MiB 이하여야 해요.".into());
        }
        let original = super::encryption::read_bytes(&root.join(&name))?;
        if hex::encode(Sha256::digest(&original)) != document.revision {
            return Err("기본 대본을 읽는 동안 파일이 바뀌었어요.".into());
        }
        if let Some((_, old, pack, path)) = previous.iter().find(|(path, _, _, _)| *path == name) {
            if old
                .iter()
                .map(|source| super::encryption::decode(source.as_bytes()))
                .collect::<Result<Vec<_>, _>>()?
                .contains(&document.source)
            {
                let new = defaults::migration_pack(pack)
                    .and_then(|pack| pack.files.iter().find(|(name, _)| name == path))
                    .ok_or("기본 대본을 찾지 못했어요.")?
                    .1;
                replacements.insert(
                    name.clone(),
                    super::encryption::encode(&super::encryption::decode(new.as_bytes())?)?,
                );
            }
        }
        originals.insert(name, original);
    }
    if !replacements.is_empty() {
        let staging = app_data_of(root)?.join(format!(".talk-dialogue-{}", uuid::Uuid::new_v4()));
        let staged = (|| {
            for (name, original) in &originals {
                let path = staging.join(name);
                fs::create_dir_all(path.parent().ok_or("대본 경로가 잘못됐어요.")?)
                    .map_err(|error| error.to_string())?;
                super::files::atomic_write(&path, replacements.get(name).unwrap_or(original))?;
            }
            super::load_bundle(&staging, &super::context::registry())
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
        let mut applied: Vec<&String> = Vec::new();
        for (name, data) in &replacements {
            if let Err(error) = super::files::atomic_write(&root.join(name), data) {
                for previous in applied.iter().rev() {
                    super::files::atomic_write(&root.join(previous), &originals[*previous])?;
                }
                return Err(error);
            }
            applied.push(name);
        }
    }
    super::files::atomic_write(&marker, b"1\n")
}

fn migrate_defaults(root: &Path) {
    if !root.exists() {
        return;
    }
    let Some(nadir) = defaults::migration_pack(defaults::NADIR_AND_STAR_TAIL) else {
        return;
    };
    // The retirement migration owns these sources so authored retired scenes stay reachable.
    let files = nadir
        .files
        .iter()
        .copied()
        .filter(|(name, _)| {
            !matches!(
                *name,
                "widgets/index.talk" | "pairs/default.talk" | "situations/index.talk"
            )
        })
        .collect::<Vec<_>>();
    if let Err(error) = upgrade_defaults(root, &files, super::legacy::FILE_HASHES) {
        crate::report_error!("talk_migration_default", ".talk default migration: {error}");
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
        crate::report_error!("talk_migration_pack", ".talk pack migration: {error}");
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
    if let Some(nadir) = defaults::migration_pack(defaults::NADIR_AND_STAR_TAIL) {
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
                name: defaults::migration_pack(&id)
                    .map_or_else(|| id.clone(), |pack| pack.name.into()),
                id: id.clone(),
                description: defaults::migration_pack(&id)
                    .map(|_| {
                        "이전에 설치한 대화팩이에요. 제거하면 앱에서 다시 설치할 수 없어요.".into()
                    })
                    .unwrap_or_default(),
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
pub fn remove_pack(root: &Path, id: &str) -> Result<PathBuf, String> {
    if !super::parser::valid_pack_id(id) {
        return Err("대화팩 ID가 잘못됐어요.".into());
    }
    let target = root.join(PACKS_DIRECTORY).join(id);
    let metadata = fs::symlink_metadata(&target).map_err(|_| "설치되지 않은 대화팩이에요.")?;
    if !metadata.is_dir() {
        return Err("대화팩 폴더가 아니에요.".into());
    }
    let canonical = fs::canonicalize(&target).map_err(|error| error.to_string())?;
    fs::remove_dir_all(&target).map_err(|error| error.to_string())?;
    Ok(canonical)
}

fn migrate_encryption(root: &Path) {
    if !root.exists() {
        return;
    }
    if let Err(error) = super::files::seal_bundle(root, &super::context::registry()) {
        crate::report_error!(
            "talk_migration_encryption",
            ".talk encryption migration: {error}"
        );
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
        assert_eq!(statuses.len(), 1);
        assert!(statuses[0].installed && statuses[0].default_installed);
        assert_eq!(statuses[0].id, defaults::BYULKKORI);
        assert!(install_bundled_pack(&root, defaults::NADIR_AND_STAR_TAIL).is_err());

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

        install_bundled_pack(&root, "byulkkori").unwrap();
        assert!(install_bundled_pack(&root, "byulkkori").is_err());
        assert!(install_bundled_pack(&root, "unknown").is_err());
        assert!(remove_pack(&root, "../talk").is_err());
        let program = load_bundle(&root, &context::registry()).unwrap();
        assert_eq!(program.packs, BTreeSet::from(["byulkkori".to_owned()]));
        assert!(program
            .scenes
            .iter()
            .all(|scene| scene.pack.as_deref() == Some("byulkkori")));

        fs::remove_dir_all(&root).unwrap();
        initialize_files(directory.path()).unwrap();
        assert!(!root.exists());
    }

    fn nadir_files() -> &'static [(&'static str, &'static str)] {
        defaults::migration_pack(defaults::NADIR_AND_STAR_TAIL)
            .unwrap()
            .files
    }

    #[test]
    fn retired_pair_stays_visible_only_while_installed_and_cannot_be_reinstalled() {
        let directory = tempfile::tempdir().unwrap();
        let root = initialize_files(directory.path()).unwrap();
        // Simulate a copy installed by an earlier app version.
        install_pack(
            &root,
            defaults::migration_pack(defaults::NADIR_AND_STAR_TAIL).unwrap(),
        )
        .unwrap();
        let entry = root.join("packs/nadir-and-star-tail/index.talk");
        let authored = format!("{}\n# 내가 고친 대본\n", decoded(&entry));
        fs::write(&entry, crate::talk::encryption::encode(&authored).unwrap()).unwrap();
        let original = fs::read(&entry).unwrap();
        initialize_files(directory.path()).unwrap();
        assert_eq!(fs::read(&entry).unwrap(), original);
        assert!(load_bundle(&root, &context::registry())
            .unwrap()
            .packs
            .contains(defaults::NADIR_AND_STAR_TAIL));
        let statuses = pack_statuses(&root).unwrap();
        let legacy = statuses
            .iter()
            .find(|pack| pack.id == defaults::NADIR_AND_STAR_TAIL)
            .unwrap();
        assert_eq!(legacy.name, "나디르와 별꼬리");
        assert!(legacy.installed);
        assert!(!legacy.bundled && !legacy.default_installed);
        assert!(install_bundled_pack(&root, defaults::NADIR_AND_STAR_TAIL).is_err());
        remove_pack(&root, defaults::NADIR_AND_STAR_TAIL).unwrap();
        initialize_files(directory.path()).unwrap();
        assert_eq!(pack_statuses(&root).unwrap().len(), 1);
        assert!(!entry.exists());
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

#[cfg(test)]
mod dialogue_upgrade_tests {
    use super::*;

    const OLD_SOLO: &str = include_str!("../../content/previous-byulkkori-solo.talk");
    const OLD_PAIR: &str = include_str!("../../content/previous-nadir-situations.talk");

    fn reset_upgrade(app_data: &Path) {
        fs::remove_file(app_data.join(".talk-dialogue-v3")).unwrap();
    }

    fn source(path: &Path) -> String {
        super::super::encryption::decode(&fs::read(path).unwrap()).unwrap()
    }

    #[test]
    fn stock_sources_upgrade_without_changing_authored_files_or_history_keys() {
        let directory = tempfile::tempdir().unwrap();
        let root = initialize_files(directory.path()).unwrap();
        install_pack(
            &root,
            defaults::migration_pack(defaults::NADIR_AND_STAR_TAIL).unwrap(),
        )
        .unwrap();
        let solo = root.join("packs/byulkkori/situations/solo.talk");
        let pair = root.join("packs/nadir-and-star-tail/situations/index.talk");
        fs::write(&solo, OLD_SOLO).unwrap();
        fs::write(&pair, OLD_PAIR).unwrap();
        let authored = root.join("packs/byulkkori/widgets/todo.talk");
        let authored_source = format!("{}\n#  사용자 원문\n  \n", source(&authored));
        let authored_bytes = super::super::encryption::encode(&authored_source).unwrap();
        fs::write(&authored, &authored_bytes).unwrap();
        let before = super::super::load_bundle(&root, &super::super::context::registry()).unwrap();
        reset_upgrade(directory.path());
        initialize_files(directory.path()).unwrap();
        let after = super::super::load_bundle(&root, &super::super::context::registry()).unwrap();
        // The two inputs contribute 20 solo scenes and 8 pair scenes in total.
        assert_eq!(after.scenes.len(), before.scenes.len() + 28);
        let added: std::collections::BTreeSet<_> = after
            .scenes
            .iter()
            .filter(|scene| !before.scenes.iter().any(|old| old.key == scene.key))
            .map(|scene| scene.id.as_str())
            .collect();
        assert_eq!(
            added,
            [
                "solo.corner",
                "solo.little-mistake",
                "solo.make-believe",
                "solo.quiet-company",
                "solo.tiny-game",
                "solo.tail-balance",
                "solo.bookmark",
                "solo.tiny-dance",
                "solo.pretend-snack",
                "solo.cloud-shapes",
                "solo.little-voice",
                "solo.tail-curl",
                "solo.slow-step",
                "solo.imaginary-rain",
                "solo.round-and-star",
                "solo.staying-near",
                "solo.new-friend",
                "solo.close-friend",
                "activity.long-session",
                "activity.idle-return",
                "situation.unfinished-syllable",
                "situation.small-game",
                "situation.shared-quiet",
                "situation.margin-note",
                "situation.tea-pause",
                "situation.glove-check",
                "situation.page-corner",
                "situation.comfortable-silence",
            ]
            .into_iter()
            .collect()
        );
        for scene in &before.scenes {
            assert!(after.scenes.iter().any(|current| current.key == scene.key));
        }
        assert_eq!(fs::read(&authored).unwrap(), authored_bytes);
        assert_eq!(source(&authored), authored_source);
        let first = (fs::read(&solo).unwrap(), fs::read(&pair).unwrap());
        initialize_files(directory.path()).unwrap();
        assert_eq!((fs::read(&solo).unwrap(), fs::read(&pair).unwrap()), first);
        fs::write(&solo, OLD_SOLO).unwrap();
        initialize_files(directory.path()).unwrap();
        assert_eq!(fs::read(&solo).unwrap(), OLD_SOLO.as_bytes());
        // Revived widget scripts ship with the default pack only.
        assert!(root.join("packs/byulkkori/widgets/pet.talk").exists());
        assert!(!root
            .join("packs/nadir-and-star-tail/widgets/plant.talk")
            .exists());
    }

    #[test]
    fn published_and_local_expansions_both_receive_the_combined_scripts() {
        for (old_solo, old_pair) in [
            (
                include_str!("../../content/previous-byulkkori-solo-v2.talk"),
                include_str!("../../content/previous-nadir-situations-v2.talk"),
            ),
            (
                include_str!("../../content/previous-byulkkori-solo-local.talk"),
                include_str!("../../content/previous-nadir-situations-local.talk"),
            ),
        ] {
            let directory = tempfile::tempdir().unwrap();
            let root = initialize_files(directory.path()).unwrap();
            install_pack(
                &root,
                defaults::migration_pack(defaults::NADIR_AND_STAR_TAIL).unwrap(),
            )
            .unwrap();
            let solo = root.join("packs/byulkkori/situations/solo.talk");
            let pair = root.join("packs/nadir-and-star-tail/situations/index.talk");
            let expected = (source(&solo), source(&pair));
            fs::write(&solo, old_solo).unwrap();
            fs::write(&pair, old_pair).unwrap();
            fs::write(directory.path().join(".talk-dialogue-v2"), b"1\n").unwrap();
            reset_upgrade(directory.path());
            initialize_files(directory.path()).unwrap();
            assert_eq!((source(&solo), source(&pair)), expected);
            super::super::load_bundle(&root, &super::super::context::registry()).unwrap();
        }
    }

    #[test]
    fn edited_sources_and_deleted_packs_are_never_replaced_or_resurrected() {
        let directory = tempfile::tempdir().unwrap();
        let root = initialize_files(directory.path()).unwrap();
        install_pack(
            &root,
            defaults::migration_pack(defaults::NADIR_AND_STAR_TAIL).unwrap(),
        )
        .unwrap();
        let solo = root.join("packs/byulkkori/situations/solo.talk");
        let authored_source = format!(
            "{}\n# 내가 고친 대사  \n",
            super::super::encryption::decode(OLD_SOLO.as_bytes()).unwrap()
        );
        let authored_bytes = super::super::encryption::encode(&authored_source).unwrap();
        fs::write(&solo, &authored_bytes).unwrap();
        remove_pack(&root, defaults::NADIR_AND_STAR_TAIL).unwrap();
        reset_upgrade(directory.path());
        initialize_files(directory.path()).unwrap();
        assert_eq!(fs::read(&solo).unwrap(), authored_bytes);
        assert_eq!(source(&solo), authored_source);
        assert!(!root.join("packs/nadir-and-star-tail").exists());
        fs::remove_file(&solo).unwrap();
        initialize_files(directory.path()).unwrap();
        assert!(!solo.exists());
        assert!(!root.join("packs/nadir-and-star-tail").exists());
    }

    #[test]
    fn conflicting_user_import_leaves_the_entire_upgrade_unapplied() {
        let directory = tempfile::tempdir().unwrap();
        let root = initialize_files(directory.path()).unwrap();
        let solo = root.join("packs/byulkkori/situations/solo.talk");
        fs::write(&solo, OLD_SOLO).unwrap();
        let entry = root.join("packs/byulkkori/index.talk");
        let authored = format!("{}\nimport \"./custom.talk\"\n", source(&entry));
        let authored_bytes = super::super::encryption::encode(&authored).unwrap();
        fs::write(&entry, &authored_bytes).unwrap();
        let custom = root.join("packs/byulkkori/custom.talk");
        fs::write(
            &custom,
            super::super::encryption::encode(
                "format: 1\nscene: solo.bookmark\non: idle\n---\nA: 私の原文\n===\n",
            )
            .unwrap(),
        )
        .unwrap();
        super::super::load_bundle(&root, &super::super::context::registry()).unwrap();
        reset_upgrade(directory.path());
        assert!(upgrade_bundled_dialogue(&root).is_err());
        assert_eq!(fs::read(&solo).unwrap(), OLD_SOLO.as_bytes());
        assert_eq!(fs::read(&entry).unwrap(), authored_bytes);
        assert!(!directory.path().join(".talk-dialogue-v3").exists());
        super::super::load_bundle(&root, &super::super::context::registry()).unwrap();
    }
}

#[cfg(test)]
mod byulkkori_replacement_tests {
    use super::*;

    fn source(path: &Path) -> String {
        super::super::encryption::decode(&fs::read(path).unwrap()).unwrap()
    }

    #[test]
    fn installed_pack_is_overwritten_once_and_a_removed_pack_stays_removed() {
        let directory = tempfile::tempdir().unwrap();
        let root = initialize_files(directory.path()).unwrap();
        let todo = root.join("packs/byulkkori/widgets/todo.talk");
        let stock = fs::read(&todo).unwrap();
        fs::write(
            &todo,
            super::super::encryption::encode("format: 1\n# 사용자 수정\n").unwrap(),
        )
        .unwrap();
        fs::write(
            root.join("packs/byulkkori/widgets/journal.talk"),
            b"format: 1\n",
        )
        .unwrap();
        fs::remove_file(directory.path().join(".talk-byulkkori-dialogue-v4")).unwrap();
        initialize_files(directory.path()).unwrap();
        assert_eq!(
            super::super::encryption::decode(&fs::read(&todo).unwrap()).unwrap(),
            super::super::encryption::decode(&stock).unwrap()
        );
        assert!(!root.join("packs/byulkkori/widgets/journal.talk").exists());
        fs::write(&todo, "format: 1\n# later edit\n".as_bytes()).unwrap();
        initialize_files(directory.path()).unwrap();
        assert_eq!(source(&todo), "format: 1\n# later edit\n");

        remove_pack(&root, "byulkkori").unwrap();
        fs::remove_file(directory.path().join(".talk-byulkkori-dialogue-v4")).unwrap();
        initialize_files(directory.path()).unwrap();
        assert!(!root.join("packs/byulkkori").exists());
    }

    #[test]
    fn recall_upgrade_preserves_milestones_and_user_edits() {
        let directory = tempfile::tempdir().unwrap();
        let root = initialize_files(directory.path()).unwrap();
        let pack = root.join("packs/byulkkori");
        let entry = pack.join("index.talk");
        let shipped = source(&entry);
        let previous = include_str!("../../content/previous-byulkkori-index-v6.talk");
        fs::write(&entry, previous).unwrap();
        fs::remove_file(pack.join("situations/recall.talk")).unwrap();
        fs::remove_file(directory.path().join(".talk-byulkkori-recall-v1")).unwrap();
        fs::remove_file(directory.path().join(".talk-byulkkori-birthday-v1")).unwrap();
        initialize_files(directory.path()).unwrap();
        assert_eq!(source(&entry), shipped);
        let program =
            super::super::load_pack(&entry, &super::super::context::registry(), "byulkkori")
                .unwrap();
        assert!(program
            .scenes
            .iter()
            .any(|scene| scene.id == "interaction.milestone-1"));
        assert!(program.scenes.iter().any(|scene| scene.trigger == "diary.recall"));
        assert!(program.scenes.iter().any(|scene| scene.trigger == "user.birthday"));
        assert!(program.scenes.iter().any(|scene| scene.trigger == "character.birthday"));

        let authored = "format: 1\n# 사용자 수정\n";
        fs::write(&entry, super::super::encryption::encode(authored).unwrap()).unwrap();
        fs::remove_file(directory.path().join(".talk-byulkkori-recall-v1")).unwrap();
        initialize_files(directory.path()).unwrap();
        assert_eq!(source(&entry), authored);
    }

    #[test]
    fn recall_then_birthday_upgrade_preserves_each_intermediate_and_authored_script() {
        let directory = tempfile::tempdir().unwrap();
        let root = initialize_files(directory.path()).unwrap();
        let pack = root.join("packs/byulkkori");
        let entry = pack.join("index.talk");
        let recall = pack.join("situations/recall.talk");
        let birthday = pack.join("situations/birthday.talk");
        let recall_marker = directory.path().join(".talk-byulkkori-recall-v1");
        let birthday_marker = directory.path().join(".talk-byulkkori-birthday-v1");
        let final_index = source(&entry);
        let recall_index = final_index.replace("import \"./situations/birthday.talk\"\n", "");
        let v6 = include_str!("../../content/previous-byulkkori-index-v6.talk");
        fs::write(&entry, v6).unwrap();
        fs::remove_file(&recall).unwrap();
        fs::remove_file(&birthday).unwrap();
        fs::remove_file(&recall_marker).unwrap();
        fs::remove_file(&birthday_marker).unwrap();
        add_recall_dialogue(&root).unwrap();
        assert_eq!(source(&entry), recall_index);
        assert!(recall.exists());
        assert!(!birthday.exists());
        add_birthday_dialogue(&root).unwrap();
        assert_eq!(source(&entry), final_index);
        assert!(birthday.exists());

        let authored = "format: 1\n# 사용자가 수정한 대사\n";
        fs::write(&entry, v6).unwrap();
        fs::write(&recall, authored).unwrap();
        fs::remove_file(&recall_marker).unwrap();
        add_recall_dialogue(&root).unwrap();
        assert_eq!(source(&entry), super::super::encryption::decode(v6.as_bytes()).unwrap());
        assert_eq!(source(&recall), authored);

        fs::write(&entry, super::super::encryption::encode(&recall_index).unwrap()).unwrap();
        fs::write(&birthday, authored).unwrap();
        fs::remove_file(&birthday_marker).unwrap();
        add_birthday_dialogue(&root).unwrap();
        assert_eq!(source(&entry), recall_index);
        assert_eq!(source(&birthday), authored);
    }

    #[test]
    fn revived_widget_scripts_join_only_a_factory_entry_once() {
        let directory = tempfile::tempdir().unwrap();
        let root = initialize_files(directory.path()).unwrap();
        let pack = root.join("packs/byulkkori");
        let entry = pack.join("index.talk");
        let shipped = source(&entry);
        let previous = include_str!("../../content/previous-byulkkori-index-v4.talk");
        let reset = |entry_bytes: &[u8]| {
            fs::write(&entry, entry_bytes).unwrap();
            for name in REVIVED_WIDGET_FILES {
                let _ = fs::remove_file(pack.join(name));
            }
            fs::remove_file(directory.path().join(".talk-byulkkori-revived-widgets-v1")).unwrap();
            fs::remove_file(directory.path().join(".talk-byulkkori-touch-milestone-v1")).unwrap();
            fs::remove_file(directory.path().join(".talk-byulkkori-recall-v1")).unwrap();
            initialize_files(directory.path()).unwrap();
        };

        reset(previous.as_bytes());
        assert_eq!(
            source(&entry),
            shipped.replace("import \"./situations/birthday.talk\"\n", "")
        );
        // The birthday upgrade has its own marker and must run independently.
        fs::remove_file(directory.path().join(".talk-byulkkori-birthday-v1")).unwrap();
        initialize_files(directory.path()).unwrap();
        assert_eq!(source(&entry), shipped);
        assert!(REVIVED_WIDGET_FILES
            .iter()
            .all(|name| pack.join(name).exists()));
        super::super::load_pack(&entry, &super::super::context::registry(), "byulkkori").unwrap();

        let edited = super::super::encryption::encode("format: 1\n# 사용자 수정\n").unwrap();
        reset(&edited);
        assert_eq!(source(&entry), "format: 1\n# 사용자 수정\n");
        assert!(!pack.join("widgets/pet.talk").exists());
    }
}
