use std::{
    path::{Path, PathBuf},
    process::Command,
};

/// Tauri's development sidecars use the Rust build target, not the host OS.
pub(crate) fn development_executable(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(format!(
            "{name}-{}{}",
            env!("COMET_TARGET_TRIPLE"),
            std::env::consts::EXE_SUFFIX,
        ))
}

/// Restrict loader changes to the owned child process. PATH is a DLL search path
/// on Windows, but Linux's ELF loader needs LD_LIBRARY_PATH instead.
pub(crate) fn configure_runtime(command: &mut Command, runtime: &Path) -> Result<(), String> {
    let variable = if cfg!(target_os = "macos") {
        "DYLD_LIBRARY_PATH"
    } else if cfg!(target_os = "windows") {
        "PATH"
    } else if cfg!(target_os = "linux") {
        "LD_LIBRARY_PATH"
    } else {
        return Err("이 운영체제에서는 로컬 실행기를 지원하지 않아요.".into());
    };
    let inherited = std::env::var_os(variable);
    let paths = std::iter::once(runtime.to_path_buf()).chain(
        inherited
            .iter()
            .flat_map(std::env::split_paths)
            .filter(|path| !path.as_os_str().is_empty()),
    );
    command.env(
        variable,
        std::env::join_paths(paths).map_err(|_| "실행기 경로 설정 실패")?,
    );
    Ok(())
}

/// GGML discovers backend modules in the executable directory and child cwd;
/// the loader path alone only resolves their shared-library dependencies.
pub(crate) fn configure_llama_runtime(command: &mut Command, runtime: &Path) -> Result<(), String> {
    configure_runtime(command, runtime)?;
    #[cfg(any(target_os = "linux", target_os = "windows"))]
    command.current_dir(runtime);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn development_sidecars_match_the_compiled_target() {
        for name in ["llama-server", "comet-nlp"] {
            assert_eq!(
                development_executable(name).file_name().unwrap(),
                format!(
                    "{name}-{}{}",
                    env!("COMET_TARGET_TRIPLE"),
                    std::env::consts::EXE_SUFFIX
                )
                .as_str()
            );
            #[cfg(target_os = "linux")]
            assert!(development_executable(name)
                .to_string_lossy()
                .contains("-linux-"));
        }
    }

    #[test]
    fn runtime_path_is_set_only_on_the_child_with_bundled_libraries_first() {
        let runtime = Path::new("/comet/runtime");
        let mut command = Command::new("unused");
        configure_runtime(&mut command, runtime).unwrap();
        let variable = if cfg!(target_os = "macos") {
            "DYLD_LIBRARY_PATH"
        } else if cfg!(target_os = "windows") {
            "PATH"
        } else {
            "LD_LIBRARY_PATH"
        };
        let value = command
            .get_envs()
            .find(|(key, _)| *key == variable)
            .unwrap()
            .1
            .unwrap();
        assert_eq!(std::env::split_paths(value).next().unwrap(), runtime);
        #[cfg(target_os = "linux")]
        assert!(command.get_envs().all(|(key, _)| key != "PATH"));
    }

    #[test]
    fn llama_runtime_sets_only_the_owned_child_backend_directory() {
        let parent_directory = std::env::current_dir().unwrap();
        let runtime = parent_directory.join("bundled-runtime");
        let inherited_directory = parent_directory.join("unrelated-launch-directory");
        let mut command = Command::new("unused");
        command.current_dir(&inherited_directory);
        configure_llama_runtime(&mut command, &runtime).unwrap();

        #[cfg(any(target_os = "linux", target_os = "windows"))]
        assert_eq!(command.get_current_dir(), Some(runtime.as_path()));
        #[cfg(target_os = "macos")]
        assert_eq!(
            command.get_current_dir(),
            Some(inherited_directory.as_path())
        );
        assert_eq!(std::env::current_dir().unwrap(), parent_directory);
        assert!(command
            .get_envs()
            .all(|(key, _)| key != "GGML_BACKEND_PATH"));

        let mut loader_only = Command::new("unused");
        configure_runtime(&mut loader_only, &runtime).unwrap();
        assert_eq!(
            command.get_envs().collect::<Vec<_>>(),
            loader_only.get_envs().collect::<Vec<_>>()
        );
    }

    #[test]
    fn generic_runtime_preserves_other_sidecars_working_directory() {
        let parent_directory = std::env::current_dir().unwrap();
        let runtime = parent_directory.join("bundled-runtime");
        let mut command = Command::new("unused");
        configure_runtime(&mut command, &runtime).unwrap();
        assert_eq!(command.get_current_dir(), None);

        let existing_directory = parent_directory.join("other-sidecar-directory");
        command.current_dir(&existing_directory);
        configure_runtime(&mut command, &runtime).unwrap();
        assert_eq!(
            command.get_current_dir(),
            Some(existing_directory.as_path())
        );
        assert_eq!(std::env::current_dir().unwrap(), parent_directory);
    }
}
