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
}
