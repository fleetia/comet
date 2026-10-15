use super::{defaults, encryption, files, legacy, parser::PACKS_DIRECTORY};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, fs, path::Path};

const MARKER: &str = ".talk-retired-widgets-v1";

struct Factory<'a> {
    import: &'a str,
    import_hash: &'a str,
    removed: &'a [(&'a str, &'a str)],
    updated: &'a [(&'a str, &'a str)],
}

const BYULKKORI: Factory<'static> = Factory {
    updated: &[],
    import: "index.talk",
    import_hash: "eae6195c95eb9d7b6773c8a5de558a8222a170d9e3d4aeb0968a3f22736470f9",
    removed: &[
        (
            "widgets/completion-jar.talk",
            "36f2327aa0c0ca4e86bb4535c9c54dbfe01fe3db1169dc6b8d71ab5b0c4cca41",
        ),
        (
            "widgets/device.talk",
            "2824aaca10c29d629356875845921b2e8c2d669fa6ad068adc95d22f6c778d46",
        ),
        (
            "widgets/guessing.talk",
            "780845390a530bd9a3ec2045dfb622f2ca9571736532208c1f632dea29bca0ce",
        ),
        (
            "widgets/fishing.talk",
            "53f991dfec24e7348d59dc4f9dac8152c4e46c15532e959ee34354ef3007abed",
        ),
        (
            "widgets/plant.talk",
            "bf5471a8fa08e372ec2727f19389f92e1f433470297d65f9fa4c56cb3264254c",
        ),
        (
            "widgets/pet.talk",
            "0d80a559011b37b10f15d0176a14b1f907fb109fa5fa026676dd7fac6515b7bf",
        ),
    ],
};

const NADIR: Factory<'static> = Factory {
    updated: &[
        (
            "pairs/default.talk",
            "e4ec231757f0f7768ac27391408b3b9d08dfc743bae08bd884b3ad3f89bc291b",
        ),
        (
            "situations/index.talk",
            "1313878122116b60a29b83a4a319df0b397f5507c5e63475666bc553a93f5abc",
        ),
        // Expanded factory dialogue shipped by the design-cleanup QA builds.
        (
            "situations/index.talk",
            "62d26cb1b32a0a7c2166eacacf6b38cb45507c26ce04c57e851788ae91b3ab47",
        ),
    ],
    import: "widgets/index.talk",
    import_hash: "3147a241457f6d4db249f5d5887cf7936ccefbd61e781f083926600c5a1ae8a9",
    removed: &[
        (
            "widgets/completion-jar.talk",
            "c040fc9bbd02fa46fd040ce1296afcab6066ccb708116db25b8f5e44ca49f47e",
        ),
        (
            "widgets/device.talk",
            "aa35a7991df731173638afccab59774daaab8587ca3771485b4c50d269d6294f",
        ),
        (
            "widgets/guessing.talk",
            "e2aee51a66d7d80103986a10f103eb60894d4e51b480dd48bc93d99ad2f55ca0",
        ),
        (
            "widgets/fishing.talk",
            "f91c65a0d5ca830041b65e0db20de86b1720ff038c87902323957a8307bd67ca",
        ),
        (
            "widgets/plant.talk",
            "88184ca07c23c3409ac27a5e2a63fbbed9b4f7a8801f1437e7a0957baad9d539",
        ),
        (
            "widgets/pet.talk",
            "860dd65d43e02969cfc029cb4bc0d125b041228940c158f89a49753b89ddab9f",
        ),
    ],
};

fn hash(source: &str) -> String {
    hex::encode(Sha256::digest(source.as_bytes()))
}

fn directory(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|metadata| metadata.is_dir())
}

/// Runs before older factory upgrades so their retired imports cannot survive the upgrade.
/// A changed import or retired file keeps the entire authored bundle intact.
pub(super) fn migrate(root: &Path) -> Result<(), String> {
    let app_data = root.parent().ok_or("대본 경로가 잘못됐어요.")?;
    let marker = app_data.join(MARKER);
    if marker.exists() || !directory(root) {
        return Ok(());
    }
    for (id, factory) in [
        (defaults::BYULKKORI, &BYULKKORI),
        (defaults::NADIR_AND_STAR_TAIL, &NADIR),
    ] {
        let pack = defaults::pack(id).ok_or("기본 대화팩을 찾지 못했어요.")?;
        let replacement = pack
            .files
            .iter()
            .find(|(name, _)| *name == factory.import)
            .ok_or("기본 대본을 찾지 못했어요.")?
            .1;
        let replacement = encryption::decode(replacement.as_bytes())?;
        if id == defaults::NADIR_AND_STAR_TAIL {
            retire_bundle(root, app_data, factory, &replacement, pack.files)?;
        }
        let packs = root.join(PACKS_DIRECTORY);
        let path = packs.join(id);
        if directory(&packs) && directory(&path) {
            retire_bundle(&path, app_data, factory, &replacement, pack.files)?;
        }
    }
    files::atomic_write(&marker, b"1\n")
}

fn retire_bundle(
    root: &Path,
    app_data: &Path,
    factory: &Factory<'_>,
    replacement: &str,
    bundled: &[(&str, &str)],
) -> Result<(), String> {
    let entry = root.join("index.talk");
    if !root
        .join(factory.import)
        .try_exists()
        .map_err(|error| error.to_string())?
    {
        return Ok(());
    }
    let document = files::read(&entry, factory.import)?;
    let digest = hash(&document.source);
    if digest != factory.import_hash && digest != hash(replacement) {
        return Ok(());
    }
    for (name, _) in factory.removed {
        match fs::symlink_metadata(root.join(name)) {
            Ok(metadata) if !metadata.is_file() => {
                return Err("기본 대본은 일반 파일이어야 해요.".into())
            }
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
                return Err(error.to_string())
            }
            _ => {}
        }
    }
    let names = files::list_files(&entry)?
        .into_iter()
        .filter(|name| !name.starts_with(&format!("{PACKS_DIRECTORY}/")))
        .collect::<Vec<_>>();
    let mut originals = BTreeMap::new();
    let mut removed = Vec::new();
    let mut replacements = BTreeMap::new();
    let mut bytes = 0;
    for name in &names {
        let current = files::read(&entry, name)?;
        if name == factory.import && current.revision != document.revision {
            return Err("기본 대본을 읽는 동안 파일이 바뀌었어요.".into());
        }
        let document = current;
        bytes += document.source.len();
        if bytes > 4 * 1024 * 1024 {
            return Err("대본 전체는 4 MiB 이하여야 해요.".into());
        }
        if let Some((_, expected)) = factory.removed.iter().find(|(path, _)| *path == name) {
            let digest = hash(&document.source);
            let legacy_match = legacy::FILE_HASHES
                .iter()
                .any(|(path, expected)| *path == name && *expected == digest);
            if digest != *expected && !legacy_match {
                return Ok(());
            }
            removed.push(name.clone());
        }
        if factory.updated.iter().any(|(path, _)| *path == name) {
            let source = bundled
                .iter()
                .find(|(path, _)| *path == name)
                .ok_or("기본 대본을 찾지 못했어요.")?
                .1;
            let source = encryption::decode(source.as_bytes())?;
            if document.source != source {
                let digest = hash(&document.source);
                let factory_match = factory
                    .updated
                    .iter()
                    .chain(legacy::FILE_HASHES.iter())
                    .any(|(path, expected)| *path == name && *expected == digest);
                if !factory_match {
                    return Ok(());
                }
                replacements.insert(name.clone(), encryption::encode(&source)?);
            }
        }
        let original = encryption::read_bytes(&root.join(name))?;
        if hex::encode(Sha256::digest(&original)) != document.revision {
            return Err("기본 대본을 읽는 동안 파일이 바뀌었어요.".into());
        }
        originals.insert(name.clone(), original);
    }
    if removed.is_empty() && replacements.is_empty() && document.source == replacement {
        return Ok(());
    }
    // Validate the user's remaining imports as a whole before changing any original file.
    let staging = app_data.join(format!(".talk-retire-{}", uuid::Uuid::new_v4()));
    if document.source != replacement {
        replacements.insert(factory.import.into(), encryption::encode(replacement)?);
    }
    let staged = (|| {
        for (name, original) in &originals {
            if removed.contains(name) {
                continue;
            }
            let path = staging.join(name);
            fs::create_dir_all(path.parent().ok_or("대본 경로가 잘못됐어요.")?)
                .map_err(|error| error.to_string())?;
            files::atomic_write(&path, replacements.get(name).unwrap_or(original))?;
        }
        Ok::<bool, String>(
            super::load(&staging.join("index.talk"), &super::context::registry()).is_ok(),
        )
    })();
    let _ = fs::remove_dir_all(&staging);
    if !staged? {
        return Ok(());
    }
    for (name, original) in &originals {
        if encryption::read_bytes(&root.join(name))? != *original {
            return Err("기본 대본을 정리하는 동안 파일이 바뀌었어요.".into());
        }
    }
    let mut applied: Vec<String> = Vec::new();
    let changes = replacements
        .iter()
        .map(|(name, data)| (name, Some(data)))
        .chain(removed.iter().map(|name| (name, None)));
    for (name, data) in changes {
        let result = match data {
            Some(data) => files::atomic_write(&root.join(name), data),
            None => fs::remove_file(root.join(name)).map_err(|error| error.to_string()),
        };
        if let Err(error) = result {
            for previous in applied.iter().rev() {
                files::atomic_write(&root.join(previous), &originals[previous])?;
            }
            return Err(error);
        }
        applied.push(name.clone());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const ENTRY: &str = "format: 1\nimport \"./retired.talk\"\nimport \"./kept.talk\"\n";
    const CLEAN: &str = "format: 1\nimport \"./kept.talk\"\n";
    const STOCK: &str = "# original factory script\n";
    const CUSTOM: &str = "# user's unrelated script\n";

    fn fixture() -> (tempfile::TempDir, std::path::PathBuf) {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("talk");
        fs::create_dir(&root).unwrap();
        for (name, source) in [
            ("index.talk", ENTRY),
            ("retired.talk", STOCK),
            ("kept.talk", CUSTOM),
        ] {
            fs::write(root.join(name), encryption::encode(source).unwrap()).unwrap();
        }
        (directory, root)
    }

    fn apply(root: &Path, app_data: &Path, replacement: &str) -> Result<(), String> {
        let import_hash = hash(ENTRY);
        let removed_hash = hash(STOCK);
        let factory = Factory {
            import: "index.talk",
            import_hash: &import_hash,
            updated: &[],
            removed: &[("retired.talk", &removed_hash)],
        };
        retire_bundle(root, app_data, &factory, replacement, &[])
    }

    fn bytes(root: &Path) -> BTreeMap<String, Vec<u8>> {
        files::list_files(&root.join("index.talk"))
            .unwrap()
            .into_iter()
            .map(|name| {
                let value = fs::read(root.join(&name)).unwrap();
                (name, value)
            })
            .collect()
    }

    #[test]
    fn exact_stock_is_removed_and_unrelated_edits_keep_their_original_envelope() {
        let (directory, root) = fixture();
        let kept = fs::read(root.join("kept.talk")).unwrap();
        apply(&root, directory.path(), CLEAN).unwrap();
        assert!(!root.join("retired.talk").exists());
        assert_eq!(
            encryption::decode(&fs::read(root.join("index.talk")).unwrap()).unwrap(),
            CLEAN
        );
        assert_eq!(fs::read(root.join("kept.talk")).unwrap(), kept);
        let loaded =
            super::super::load(&root.join("index.talk"), &super::super::context::registry())
                .unwrap();
        assert_eq!(loaded.files.len(), 2);
        let once = bytes(&root);
        apply(&root, directory.path(), CLEAN).unwrap();
        assert_eq!(bytes(&root), once);
    }

    #[test]
    fn edited_import_or_retired_source_keeps_the_whole_bundle_untouched() {
        for name in ["index.talk", "retired.talk"] {
            let (directory, root) = fixture();
            let source = files::read(&root.join("index.talk"), name).unwrap().source;
            fs::write(root.join(name), format!("{source}# authored change\n")).unwrap();
            let before = bytes(&root);
            apply(&root, directory.path(), CLEAN).unwrap();
            assert_eq!(bytes(&root), before, "{name}");
        }
    }

    #[test]
    fn stock_scenes_are_updated_together_but_authored_scenes_preserve_the_bundle() {
        let expanded = "# expanded factory scene\n";
        let authored = "# user edited scene\n";
        for source in [CUSTOM, expanded, authored] {
            let (directory, root) = fixture();
            let import_hash = hash(ENTRY);
            let removed_hash = hash(STOCK);
            let scene_hash = hash(CUSTOM);
            let expanded_hash = hash(expanded);
            let factory = Factory {
                import: "index.talk",
                import_hash: &import_hash,
                removed: &[("retired.talk", &removed_hash)],
                updated: &[("kept.talk", &scene_hash), ("kept.talk", &expanded_hash)],
            };
            fs::write(root.join("kept.talk"), source).unwrap();
            let before = bytes(&root);
            retire_bundle(
                &root,
                directory.path(),
                &factory,
                CLEAN,
                &[("kept.talk", "# remaining stock scenes\n")],
            )
            .unwrap();
            if source == authored {
                assert_eq!(bytes(&root), before);
            } else {
                assert!(!root.join("retired.talk").exists());
                assert_eq!(
                    files::read(&root.join("index.talk"), "kept.talk")
                        .unwrap()
                        .source,
                    "# remaining stock scenes\n"
                );
                assert_eq!(
                    files::read(&root.join("index.talk"), "index.talk")
                        .unwrap()
                        .source,
                    CLEAN
                );
            }
        }
    }

    #[test]
    fn missing_files_stay_deleted_and_an_interrupted_import_update_can_finish() {
        for missing in [false, true] {
            let (directory, root) = fixture();
            if missing {
                fs::remove_file(root.join("retired.talk")).unwrap();
            } else {
                fs::write(root.join("index.talk"), CLEAN).unwrap();
            }
            apply(&root, directory.path(), CLEAN).unwrap();
            assert!(!root.join("retired.talk").exists());
            assert_eq!(
                files::read(&root.join("index.talk"), "index.talk")
                    .unwrap()
                    .source,
                CLEAN
            );
        }
    }

    #[test]
    fn a_remaining_user_import_prevents_retirement_without_any_writes() {
        let (directory, root) = fixture();
        fs::write(root.join("kept.talk"), "import \"./retired.talk\"\n").unwrap();
        let before = bytes(&root);
        assert!(
            super::super::load(&root.join("index.talk"), &super::super::context::registry())
                .is_ok()
        );
        apply(&root, directory.path(), CLEAN).unwrap();
        assert_eq!(bytes(&root), before);
        assert!(
            super::super::load(&root.join("index.talk"), &super::super::context::registry())
                .is_ok()
        );
    }

    #[cfg(unix)]
    #[test]
    fn retired_symlinks_never_modify_the_link_target_or_import() {
        let (directory, root) = fixture();
        let outside = directory.path().join("authored.talk");
        fs::write(&outside, STOCK).unwrap();
        fs::remove_file(root.join("retired.talk")).unwrap();
        std::os::unix::fs::symlink(&outside, root.join("retired.talk")).unwrap();
        let entry = fs::read(root.join("index.talk")).unwrap();
        assert!(apply(&root, directory.path(), CLEAN).is_err());
        assert_eq!(fs::read(root.join("index.talk")).unwrap(), entry);
        assert_eq!(fs::read_to_string(outside).unwrap(), STOCK);
    }

    #[test]
    fn marker_prevents_later_user_restoration_from_being_deleted() {
        let directory = tempfile::tempdir().unwrap();
        let root = super::super::runtime::initialize_files(directory.path()).unwrap();
        assert!(directory.path().join(MARKER).exists());
        let authored = root.join("packs/byulkkori/widgets/pet.talk");
        fs::write(&authored, "# restored by the user\n").unwrap();
        migrate(&root).unwrap();
        assert_eq!(
            fs::read_to_string(authored).unwrap(),
            "# restored by the user\n"
        );
    }
    #[test]
    fn older_factory_upgrade_cannot_disconnect_a_user_edited_retired_script() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("talk");
        for (name, source) in defaults::pack(defaults::NADIR_AND_STAR_TAIL).unwrap().files {
            let path = root.join(name);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, source).unwrap();
        }
        let old_import = r#"format: 1

import "./todo.talk"
import "./calendar.talk"
import "./focus-timer.talk"
import "./preparation.talk"
import "./completion-jar.talk"
import "./clock.talk"
import "./memo.talk"
import "./weather.talk"
import "./music.talk"
import "./device.talk"
import "./interaction.talk"
import "./ball.talk"
import "./paper-plane.talk"
import "./bubbles.talk"
import "./small-match.talk"
import "./guessing.talk"
import "./fishing.talk"
import "./fortune.talk"
import "./plant.talk"
import "./pet.talk"
import "./collection.talk"
import "./journal.talk"
"#;
        assert_eq!(hash(old_import), NADIR.import_hash);
        fs::write(root.join(NADIR.import), old_import).unwrap();
        for (name, _) in NADIR.removed {
            fs::write(root.join(name), "# user edited retired script\n").unwrap();
        }
        super::super::runtime::initialize_files(directory.path()).unwrap();
        assert_eq!(
            files::read(&root.join("index.talk"), NADIR.import)
                .unwrap()
                .source,
            old_import
        );
        for (name, _) in NADIR.removed {
            assert_eq!(
                files::read(&root.join("index.talk"), name).unwrap().source,
                "# user edited retired script\n"
            );
        }
        assert!(super::super::load_bundle(&root, &super::super::context::registry()).is_ok());
    }
}
