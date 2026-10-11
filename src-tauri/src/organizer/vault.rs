use super::{err, hash, Result, VaultConnection, MAX_SOURCE_BYTES};
use std::{
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
};

const OWNER_FILE: &str = ".comet-organizer-owner";
const INDEX_HEADER: &str = "<!-- comet-organizer-index-v1 -->\n# Comet 정리 기록\n\n이 폴더의 요약은 원문을 대신하지 않습니다.\n\n";

enum EntryKind {
    File,
    Directory,
    Other,
}

pub(super) fn relative(value: &str, allow_empty: bool) -> Result<PathBuf> {
    if value.is_empty() && allow_empty {
        return Ok(PathBuf::new());
    }
    if value.is_empty() || value.contains(['\\', '\0', '\n', '\r']) || value.contains(':') {
        return Err("Vault 안의 상대 경로를 선택해 주세요.".into());
    }
    let path = Path::new(value);
    if path
        .components()
        .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err("Vault 밖으로 나가는 경로는 사용할 수 없어요.".into());
    }
    Ok(path.to_path_buf())
}

pub(super) fn validate_root(path: &Path) -> Result<PathBuf> {
    let metadata = fs::symlink_metadata(path).map_err(err)?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("연결 파일이 아닌 Vault 폴더를 선택해 주세요.".into());
    }
    fs::canonicalize(path).map_err(err)
}

fn blocked_segment(value: &str) -> bool {
    let lower = value.to_lowercase();
    lower.starts_with('.')
        || lower == "_kit"
        || lower == "node_modules"
        || lower == "target"
        || lower == "dist"
        || lower == "build"
        || lower == "ai-shared"
        || lower == "90.private"
        || lower == "03.diary"
        || lower == "05.investing"
        || lower == "30.1on1"
        || lower == "31.self"
        || lower == "99.deprecated"
        || lower == "archive"
        || lower == "archives"
        || lower == "archived"
        || lower == "private"
        || lower == "secrets"
        || lower == "credentials"
}

pub(super) fn allowed(connection: &VaultConnection, relative_path: &Path) -> bool {
    if relative_path.components().any(|part| match part {
        Component::Normal(name) => blocked_segment(&name.to_string_lossy()),
        _ => true,
    }) {
        return false;
    }
    if relative_path.starts_with(&connection.output_dir) {
        return false;
    }
    if connection
        .exclude
        .iter()
        .any(|path| relative_path.starts_with(path))
    {
        return false;
    }
    true
}

pub(super) fn included(connection: &VaultConnection, path: &Path) -> bool {
    connection.include.is_empty()
        || connection
            .include
            .iter()
            .any(|prefix| path.starts_with(prefix))
}

fn traversable(connection: &VaultConnection, path: &Path) -> bool {
    connection.include.is_empty()
        || connection
            .include
            .iter()
            .any(|prefix| path.starts_with(prefix) || Path::new(prefix).starts_with(path))
}

fn managed_directory(root: &Path, directory: &Path) -> bool {
    read(root, &directory.join(OWNER_FILE))
        .is_ok_and(|marker| marker.starts_with("comet-organizer-v1:"))
}

pub(super) fn managed_source(connection: &VaultConnection, path: &Path) -> bool {
    path.parent()
        .into_iter()
        .flat_map(Path::ancestors)
        .any(|directory| managed_directory(Path::new(&connection.root), directory))
}

pub(super) fn collect(
    connection: &VaultConnection,
    cancel: &AtomicBool,
) -> Result<(Vec<String>, usize, bool)> {
    let root = validate_root(Path::new(&connection.root))?;
    if root != Path::new(&connection.root) {
        return Err("Vault 위치가 바뀌었어요. 다시 연결해 주세요.".into());
    }
    let mut dirs = vec![PathBuf::new()];
    let mut documents = Vec::new();
    let mut skipped = 0;
    let mut visited = 0;
    while let Some(directory) = dirs.pop() {
        if cancel.load(Ordering::Acquire) {
            return Ok((documents, skipped, true));
        }
        if managed_directory(&root, &directory) {
            skipped += 1;
            continue;
        }
        let entries = native::entries(&root, &directory)?;
        for (name, kind) in entries {
            if cancel.load(Ordering::Acquire) {
                return Ok((documents, skipped, true));
            }
            visited += 1;
            if visited > 100_000 {
                return Err("Vault 항목이 너무 많아요. 포함할 폴더를 나눠 선택해 주세요.".into());
            }
            let path = directory.join(name);
            if matches!(kind, EntryKind::Other) || !allowed(connection, &path) {
                skipped += 1;
                continue;
            }
            if matches!(kind, EntryKind::Directory) {
                if traversable(connection, &path) {
                    dirs.push(path);
                }
                continue;
            }
            if !included(connection, &path) {
                continue;
            }
            let extension = path
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if !matches!(extension.as_str(), "md" | "markdown") {
                continue;
            }
            let name = path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if matches!(name.as_str(), "agents.md" | "skill.md" | "claude.md") {
                skipped += 1;
                continue;
            }
            let Some(locator) = path.to_str() else {
                skipped += 1;
                continue;
            };
            documents.push(locator.replace('\\', "/"));
        }
    }
    documents.sort();
    Ok((documents, skipped, false))
}

pub(super) fn archived(content: &str) -> bool {
    let normalized = content.trim_start_matches('\u{feff}');
    if !normalized.starts_with("---\n") && !normalized.starts_with("---\r\n") {
        return false;
    }
    normalized
        .lines()
        .skip(1)
        .take_while(|line| line.trim() != "---")
        .any(|line| {
            line.split_once(':').is_some_and(|(key, value)| {
                key.trim() == "status"
                    && matches!(
                        value.trim().trim_matches(['\'', '"']),
                        "archived" | "deprecated" | "cancelled"
                    )
            })
        })
}

#[cfg(unix)]
mod native {
    use super::*;
    use std::{
        ffi::CString,
        os::fd::{AsRawFd, FromRawFd},
    };
    fn name(value: &std::ffi::OsStr) -> Result<CString> {
        use std::os::unix::ffi::OsStrExt;
        CString::new(value.as_bytes()).map_err(err)
    }
    struct Stream(*mut libc::DIR);
    impl Drop for Stream {
        fn drop(&mut self) {
            unsafe {
                libc::closedir(self.0);
            }
        }
    }
    pub(super) fn entries(
        root: &Path,
        path: &Path,
    ) -> Result<Vec<(std::ffi::OsString, EntryKind)>> {
        use std::os::unix::ffi::OsStringExt;
        let parent = directory(root, path, false)?;
        let copied = unsafe { libc::dup(parent.as_raw_fd()) };
        if copied < 0 {
            return Err(err(std::io::Error::last_os_error()));
        }
        let pointer = unsafe { libc::fdopendir(copied) };
        if pointer.is_null() {
            unsafe {
                libc::close(copied);
            }
            return Err(err(std::io::Error::last_os_error()));
        }
        let stream = Stream(pointer);
        let mut result = Vec::new();
        loop {
            #[cfg(target_os = "macos")]
            unsafe {
                *libc::__error() = 0;
            }
            #[cfg(target_os = "linux")]
            unsafe {
                *libc::__errno_location() = 0;
            }
            let entry = unsafe { libc::readdir(stream.0) };
            if entry.is_null() {
                let error = std::io::Error::last_os_error();
                if error.raw_os_error() != Some(0) {
                    return Err(err(error));
                }
                break;
            }
            let value = unsafe { std::ffi::CStr::from_ptr((*entry).d_name.as_ptr()) };
            if matches!(value.to_bytes(), b"." | b"..") {
                continue;
            }
            let mut metadata = std::mem::MaybeUninit::<libc::stat>::uninit();
            if unsafe {
                libc::fstatat(
                    parent.as_raw_fd(),
                    value.as_ptr(),
                    metadata.as_mut_ptr(),
                    libc::AT_SYMLINK_NOFOLLOW,
                )
            } < 0
            {
                if std::io::Error::last_os_error().kind() == std::io::ErrorKind::NotFound {
                    continue;
                }
                return Err(err(std::io::Error::last_os_error()));
            }
            let metadata = unsafe { metadata.assume_init() };
            let kind = match metadata.st_mode & libc::S_IFMT {
                libc::S_IFREG => EntryKind::File,
                libc::S_IFDIR => EntryKind::Directory,
                _ => EntryKind::Other,
            };
            result.push((
                std::ffi::OsString::from_vec(value.to_bytes().to_vec()),
                kind,
            ));
            if result.len() > 100_000 {
                return Err("한 폴더의 항목이 너무 많아요.".into());
            }
        }
        Ok(result)
    }
    pub(super) fn directory(root: &Path, path: &Path, create: bool) -> Result<fs::File> {
        let root_name = CString::new("/").map_err(err)?;
        let fd = unsafe {
            libc::open(
                root_name.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            return Err(err(std::io::Error::last_os_error()));
        }
        let mut directory = unsafe { fs::File::from_raw_fd(fd) };
        for component in root.join(path).components() {
            let Component::Normal(part) = component else {
                if matches!(component, Component::RootDir) {
                    continue;
                }
                return Err("잘못된 Vault 경로예요.".into());
            };
            let part = name(part)?;
            let flags = libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC;
            let mut fd = unsafe { libc::openat(directory.as_raw_fd(), part.as_ptr(), flags) };
            if fd < 0
                && create
                && std::io::Error::last_os_error().kind() == std::io::ErrorKind::NotFound
            {
                let created = unsafe { libc::mkdirat(directory.as_raw_fd(), part.as_ptr(), 0o700) };
                if created < 0
                    && std::io::Error::last_os_error().kind() != std::io::ErrorKind::AlreadyExists
                {
                    return Err(err(std::io::Error::last_os_error()));
                }
                fd = unsafe { libc::openat(directory.as_raw_fd(), part.as_ptr(), flags) };
            }
            if fd < 0 {
                return Err("Vault 경로가 사라졌거나 연결 파일로 바뀌었어요.".into());
            }
            directory = unsafe { fs::File::from_raw_fd(fd) };
        }
        Ok(directory)
    }
    pub(super) fn open(
        root: &Path,
        path: &Path,
        write_new: bool,
        append: bool,
    ) -> Result<fs::File> {
        let parent = directory(root, path.parent().unwrap_or(Path::new("")), false)?;
        let filename = name(path.file_name().ok_or("파일 이름이 없어요.")?)?;
        let flags = libc::O_NOFOLLOW
            | libc::O_CLOEXEC
            | if write_new {
                libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL
            } else if append {
                libc::O_WRONLY | libc::O_APPEND
            } else {
                libc::O_RDONLY
            };
        let fd = unsafe { libc::openat(parent.as_raw_fd(), filename.as_ptr(), flags, 0o600) };
        if fd < 0 {
            return Err(err(std::io::Error::last_os_error()));
        }
        let file = unsafe { fs::File::from_raw_fd(fd) };
        if !file.metadata().map_err(err)?.is_file() {
            return Err("일반 Markdown 파일만 사용할 수 있어요.".into());
        }
        Ok(file)
    }
    pub(super) fn publish(root: &Path, temporary: &Path, target: &Path) -> Result<()> {
        let parent = directory(root, target.parent().unwrap_or(Path::new("")), false)?;
        let temporary = name(temporary.file_name().ok_or("임시 파일 이름이 없어요.")?)?;
        let target = name(target.file_name().ok_or("파일 이름이 없어요.")?)?;
        let result = unsafe {
            libc::linkat(
                parent.as_raw_fd(),
                temporary.as_ptr(),
                parent.as_raw_fd(),
                target.as_ptr(),
                0,
            )
        };
        if result < 0 {
            return Err(err(std::io::Error::last_os_error()));
        }
        if unsafe { libc::unlinkat(parent.as_raw_fd(), temporary.as_ptr(), 0) } < 0 {
            return Err(err(std::io::Error::last_os_error()));
        }
        parent.sync_all().map_err(err)
    }
    pub(super) fn discard(root: &Path, path: &Path) {
        if let (Ok(parent), Some(filename)) = (
            directory(root, path.parent().unwrap_or(Path::new("")), false),
            path.file_name(),
        ) {
            if let Ok(filename) = name(filename) {
                unsafe {
                    libc::unlinkat(parent.as_raw_fd(), filename.as_ptr(), 0);
                }
            }
        }
    }
    pub(super) fn remove(root: &Path, path: &Path, expected_hash: &str) -> Result<()> {
        let parent = directory(root, path.parent().unwrap_or(Path::new("")), false)?;
        let filename = name(path.file_name().ok_or("파일 이름이 없어요.")?)?;
        let quarantine = name(std::ffi::OsStr::new(&format!(
            ".undo-{}",
            uuid::Uuid::new_v4()
        )))?;
        if unsafe {
            libc::renameat(
                parent.as_raw_fd(),
                filename.as_ptr(),
                parent.as_raw_fd(),
                quarantine.as_ptr(),
            )
        } < 0
        {
            return Err(err(std::io::Error::last_os_error()));
        }
        let moved_path = path
            .parent()
            .unwrap_or(Path::new(""))
            .join(quarantine.to_string_lossy().as_ref());
        let same = super::read(root, &moved_path).is_ok_and(|text| hash(&text) == expected_hash);
        if !same {
            // Never replace a concurrent editor's new file while restoring a changed preimage.
            let restored = unsafe {
                libc::linkat(
                    parent.as_raw_fd(),
                    quarantine.as_ptr(),
                    parent.as_raw_fd(),
                    filename.as_ptr(),
                    0,
                )
            };
            if restored == 0 {
                unsafe {
                    libc::unlinkat(parent.as_raw_fd(), quarantine.as_ptr(), 0);
                }
            }
            return Err(
                "생성 후 수정된 파일은 되돌리지 않았어요. 보존된 파일을 확인해 주세요.".into(),
            );
        }
        if unsafe { libc::unlinkat(parent.as_raw_fd(), quarantine.as_ptr(), 0) } < 0 {
            return Err(err(std::io::Error::last_os_error()));
        }
        parent.sync_all().map_err(err)
    }
}

#[cfg(not(unix))]
mod native {
    use super::*;
    pub(super) fn entries(
        root: &Path,
        path: &Path,
    ) -> Result<Vec<(std::ffi::OsString, EntryKind)>> {
        use std::os::windows::fs::MetadataExt;
        let _guard = directory(root, path, false)?;
        fs::read_dir(root.join(path))
            .map_err(err)?
            .map(|entry| {
                let entry = entry.map_err(err)?;
                let metadata = fs::symlink_metadata(entry.path()).map_err(err)?;
                let kind = if metadata.file_attributes() & 0x400 != 0 {
                    EntryKind::Other
                } else if metadata.is_file() {
                    EntryKind::File
                } else if metadata.is_dir() {
                    EntryKind::Directory
                } else {
                    EntryKind::Other
                };
                Ok((entry.file_name(), kind))
            })
            .collect()
    }
    pub(super) fn directory(root: &Path, path: &Path, create: bool) -> Result<fs::File> {
        let mut current = root.to_path_buf();
        for part in path.components() {
            let Component::Normal(part) = part else {
                return Err("잘못된 경로예요.".into());
            };
            current.push(part);
            if create && !current.exists() {
                fs::create_dir(&current).map_err(err)?;
            }
            let metadata = fs::symlink_metadata(&current).map_err(err)?;
            use std::os::windows::fs::MetadataExt;
            if !metadata.is_dir() || metadata.file_attributes() & 0x400 != 0 {
                return Err("연결 폴더는 사용할 수 없어요.".into());
            }
        }
        use std::os::windows::fs::OpenOptionsExt;
        fs::OpenOptions::new()
            .read(true)
            .custom_flags(0x02000000 | 0x00200000)
            .open(current)
            .map_err(err)
    }
    pub(super) fn open(
        root: &Path,
        path: &Path,
        write_new: bool,
        append: bool,
    ) -> Result<fs::File> {
        let _directory = directory(root, path.parent().unwrap_or(Path::new("")), false)?;
        use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
        let file = fs::OpenOptions::new()
            .read(!write_new && !append)
            .write(write_new)
            .append(append)
            .create_new(write_new)
            .custom_flags(0x00200000)
            .open(root.join(path))
            .map_err(err)?;
        let metadata = file.metadata().map_err(err)?;
        if !metadata.is_file() || metadata.file_attributes() & 0x400 != 0 {
            return Err("일반 파일만 사용할 수 있어요.".into());
        }
        Ok(file)
    }
    pub(super) fn publish(root: &Path, temporary: &Path, target: &Path) -> Result<()> {
        let _guard = directory(root, target.parent().unwrap_or(Path::new("")), false)?;
        fs::hard_link(root.join(temporary), root.join(target)).map_err(err)?;
        fs::remove_file(root.join(temporary)).map_err(err)
    }
    pub(super) fn discard(root: &Path, path: &Path) {
        if directory(root, path.parent().unwrap_or(Path::new("")), false).is_ok() {
            let _ = fs::remove_file(root.join(path));
        }
    }
    pub(super) fn remove(root: &Path, path: &Path, expected_hash: &str) -> Result<()> {
        let _directory = directory(root, path.parent().unwrap_or(Path::new("")), false)?;
        if hash(&super::read(root, path)?) != expected_hash {
            return Err("생성 후 수정된 파일은 되돌릴 수 없어요.".into());
        }
        fs::remove_file(root.join(path)).map_err(err)
    }
}

pub(super) fn read(root: &Path, path: &Path) -> Result<String> {
    relative(
        &path
            .to_str()
            .ok_or("경로 인코딩이 올바르지 않아요.")?
            .replace(std::path::MAIN_SEPARATOR, "/"),
        false,
    )?;
    let file = native::open(root, path, false, false)?;
    if file.metadata().map_err(err)?.len() > MAX_SOURCE_BYTES {
        return Err("문서가 한 파일의 정리 한도를 넘어요.".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_SOURCE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(err)?;
    if bytes.len() as u64 > MAX_SOURCE_BYTES {
        return Err("문서가 한 파일의 정리 한도를 넘어요.".into());
    }
    String::from_utf8(bytes).map_err(|_| "UTF-8 Markdown 파일만 정리할 수 있어요.".into())
}

fn create(root: &Path, path: &Path, content: &str) -> Result<()> {
    let temporary = path
        .parent()
        .unwrap_or(Path::new(""))
        .join(format!(".write-{}", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = native::open(root, &temporary, true, false)?;
        file.write_all(content.as_bytes()).map_err(err)?;
        file.sync_all().map_err(err)?;
        native::publish(root, &temporary, path)
    })();
    if result.is_err() {
        native::discard(root, &temporary);
    }
    result
}

fn output_root(connection: &VaultConnection) -> Result<PathBuf> {
    let root = validate_root(Path::new(&connection.root))?;
    if root != Path::new(&connection.root) {
        return Err("Vault 경로가 바뀌었어요.".into());
    }
    let output = relative(&connection.output_dir, false)?;
    if output.components().any(|part| match part {
        Component::Normal(value) => blocked_segment(&value.to_string_lossy()),
        _ => true,
    }) {
        return Err("제외된 폴더에는 정리 결과를 저장할 수 없어요.".into());
    }
    let absolute = root.join(&output);
    if absolute.exists() {
        let _guard = native::directory(&root, &output, false)?;
        let marker = output.join(OWNER_FILE);
        match read(&root, &marker) {
            Ok(value) if value == format!("comet-organizer-v1:{}", connection.id) => {}
            Ok(_) => return Err("다른 연결이 사용하는 정리 폴더예요.".into()),
            Err(_) => {
                if !native::entries(&root, &output)?.is_empty() {
                    return Err("빈 전용 폴더를 선택해 주세요. 기존 문서는 변경하지 않아요.".into());
                }
                create(
                    &root,
                    &marker,
                    &format!("comet-organizer-v1:{}", connection.id),
                )?;
            }
        }
    } else {
        let _guard = native::directory(&root, &output, true)?;
        create(
            &root,
            &output.join(OWNER_FILE),
            &format!("comet-organizer-v1:{}", connection.id),
        )?;
    }
    let index = output.join("INDEX.md");
    if !absolute.join("INDEX.md").exists() {
        create(&root, &index, INDEX_HEADER)?;
    }
    if !read(&root, &index)?.starts_with(INDEX_HEADER) {
        return Err("정리 폴더의 목차가 변경되어 자동 저장을 멈췄어요.".into());
    }
    Ok(root)
}

pub(super) fn write_record(
    connection: &VaultConnection,
    id: &str,
    markdown: &str,
) -> Result<String> {
    uuid::Uuid::parse_str(id).map_err(err)?;
    let root = output_root(connection)?;
    let path = Path::new(&connection.output_dir).join(format!("{id}.md"));
    if root.join(&path).symlink_metadata().is_ok() {
        if read(&root, &path)? != markdown {
            return Err("같은 작업의 파일이 변경되어 기존 내용을 보존했어요.".into());
        }
    } else {
        create(&root, &path, markdown)?;
    }
    let index = Path::new(&connection.output_dir).join("INDEX.md");
    let line = format!("- [정리 기록 {id}]({id}.md)\n");
    if !read(&root, &index)?
        .lines()
        .any(|existing| existing == line.trim_end())
    {
        let mut file = native::open(&root, &index, false, true)?;
        file.write_all(line.as_bytes()).map_err(err)?;
        file.sync_all().map_err(err)?;
    }
    Ok(root.join(path).to_string_lossy().into_owned())
}

pub(super) fn undo_record(
    connection: &VaultConnection,
    id: &str,
    expected_hash: &str,
) -> Result<()> {
    uuid::Uuid::parse_str(id).map_err(err)?;
    let output = Path::new(&connection.root).join(&connection.output_dir);
    if matches!(output.symlink_metadata(),Err(error) if error.kind()==std::io::ErrorKind::NotFound)
    {
        return Ok(());
    }
    let root = output_root(connection)?;
    let path = Path::new(&connection.output_dir).join(format!("{id}.md"));
    if root.join(&path).symlink_metadata().is_ok() {
        if hash(&read(&root, &path)?) != expected_hash {
            return Err("생성 후 수정된 기록은 자동으로 되돌리지 않아요.".into());
        }
        native::remove(&root, &path, expected_hash)?;
    }
    let mut index = native::open(
        &root,
        &Path::new(&connection.output_dir).join("INDEX.md"),
        false,
        true,
    )?;
    index
        .write_all(format!("- 되돌림: {id}\n").as_bytes())
        .map_err(err)?;
    index.sync_all().map_err(err)
}
