use std::sync::Mutex;
use tauri::Manager;

static OPERATION: Mutex<()> = Mutex::new(());

fn require_settings(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "settings" {
        return Err("자동 시작은 설정창에서만 변경할 수 있어요.".into());
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn get_autostart_enabled(window: tauri::WebviewWindow) -> Result<bool, String> {
    require_settings(&window)?;
    let _operation = super::lock(&OPERATION)?;
    platform::is_enabled(&window.app_handle().config().identifier)
}

#[tauri::command]
pub(crate) fn set_autostart_enabled(
    window: tauri::WebviewWindow,
    enabled: bool,
) -> Result<bool, String> {
    require_settings(&window)?;
    let _operation = super::lock(&OPERATION)?;
    let identifier = &window.app_handle().config().identifier;
    platform::set_enabled(identifier, enabled)?;
    let actual = platform::is_enabled(identifier)?;
    if actual != enabled {
        return Err(
            "자동 시작 변경이 운영체제에 반영되지 않았어요. 시스템 설정을 확인해 주세요.".into(),
        );
    }
    Ok(actual)
}

#[cfg(target_os = "macos")]
mod platform {
    use objc2_foundation::NSBundle;
    use objc2_service_management::{SMAppService, SMAppServiceStatus};

    const APPROVAL_REQUIRED: &str =
        "macOS 시스템 설정 > 일반 > 로그인 항목 및 확장 프로그램에서 comet의 자동 시작을 허용해 주세요.";

    fn require_bundle(identifier: &str) -> Result<(), String> {
        let bundle = NSBundle::mainBundle();
        let bundle_path = bundle.bundlePath().to_string();
        let matches_identifier = bundle
            .bundleIdentifier()
            .is_some_and(|value| value.to_string() == identifier);
        if !matches_identifier
            || std::path::Path::new(&bundle_path).extension() != Some(std::ffi::OsStr::new("app"))
        {
            return Err("자동 시작은 설치된 comet 앱에서 설정할 수 있어요.".into());
        }
        Ok(())
    }

    fn enabled_from_status(status: SMAppServiceStatus) -> Result<bool, String> {
        match status {
            SMAppServiceStatus::Enabled => Ok(true),
            // A valid main app may have no ServiceManagement entry before its first registration.
            SMAppServiceStatus::NotRegistered | SMAppServiceStatus::NotFound => Ok(false),
            SMAppServiceStatus::RequiresApproval => Err(APPROVAL_REQUIRED.into()),
            _ => Err(
                "로그인 항목을 확인하지 못했어요. 설치된 comet 앱에서 다시 시도해 주세요.".into(),
            ),
        }
    }

    pub(super) fn is_enabled(identifier: &str) -> Result<bool, String> {
        require_bundle(identifier)?;
        let service = unsafe { SMAppService::mainAppService() };
        enabled_from_status(unsafe { service.status() })
    }

    pub(super) fn set_enabled(identifier: &str, enabled: bool) -> Result<(), String> {
        require_bundle(identifier)?;
        let service = unsafe { SMAppService::mainAppService() };
        let status = unsafe { service.status() };
        if enabled {
            if status == SMAppServiceStatus::Enabled {
                return Ok(());
            }
            if status == SMAppServiceStatus::RequiresApproval {
                return Err(APPROVAL_REQUIRED.into());
            }
            unsafe { service.registerAndReturnError() }
                .map_err(|error| format!("자동 시작을 등록하지 못했어요: {error}"))?;
        } else if !matches!(
            status,
            SMAppServiceStatus::NotRegistered | SMAppServiceStatus::NotFound
        ) {
            unsafe { service.unregisterAndReturnError() }
                .map_err(|error| format!("자동 시작을 해제하지 못했어요: {error}"))?;
        }
        Ok(())
    }

    #[cfg(test)]
    mod tests {
        use super::{enabled_from_status, SMAppServiceStatus};

        #[test]
        fn a_fresh_main_app_can_offer_registration_before_the_service_exists() {
            assert_eq!(enabled_from_status(SMAppServiceStatus::NotFound), Ok(false));
            assert_eq!(
                enabled_from_status(SMAppServiceStatus::NotRegistered),
                Ok(false)
            );
            assert_eq!(enabled_from_status(SMAppServiceStatus::Enabled), Ok(true));
        }

        #[test]
        fn approval_required_and_unknown_states_are_not_reported_as_disabled() {
            assert!(enabled_from_status(SMAppServiceStatus::RequiresApproval).is_err());
            assert!(enabled_from_status(SMAppServiceStatus(99)).is_err());
        }
    }
}

#[cfg(any(target_os = "windows", test))]
fn windows_command(executable: &str) -> Result<String, String> {
    let command = format!("\"{executable}\"");
    if executable.contains(['"', '\r', '\n']) || command.encode_utf16().count() > 260 {
        return Err(
            "현재 앱 경로를 시작프로그램에 등록할 수 없어요. 더 짧은 설치 경로를 사용해 주세요."
                .into(),
        );
    }
    Ok(command)
}

#[cfg(any(target_os = "windows", test))]
fn windows_startup_allowed(bytes: &[u8]) -> Result<bool, String> {
    if bytes.len() != 12 || bytes[1..4] != [0, 0, 0] {
        return Err("Windows 시작프로그램의 허용 상태를 확인하지 못했어요.".into());
    }
    match bytes[0] {
        2 | 6 => Ok(true),
        3 | 7 => Ok(false),
        _ => Err("Windows 시작프로그램의 허용 상태를 확인하지 못했어요.".into()),
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use std::io;
    use winreg::{enums::*, RegKey, RegValue};

    const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
    const APPROVED: &str =
        r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";

    fn registration_error(error: io::Error) -> String {
        format!("Windows 시작프로그램 설정을 읽거나 변경하지 못했어요: {error}")
    }

    fn optional<T>(result: io::Result<T>) -> Result<Option<T>, String> {
        match result {
            Ok(value) => Ok(Some(value)),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(registration_error(error)),
        }
    }

    pub(super) fn is_enabled(identifier: &str) -> Result<bool, String> {
        let user = RegKey::predef(HKEY_CURRENT_USER);
        let Some(run) = optional(user.open_subkey(RUN))? else {
            return Ok(false);
        };
        let Some(command) = optional(run.get_value::<String, _>(identifier))? else {
            return Ok(false);
        };
        if command != current_command()? {
            return Ok(false);
        }
        let Some(approved) = optional(user.open_subkey(APPROVED))? else {
            return Ok(true);
        };
        let Some(value) = optional(approved.get_raw_value(identifier))? else {
            return Ok(true);
        };
        if value.vtype != REG_BINARY {
            return Err("Windows 시작프로그램의 허용 상태를 확인하지 못했어요.".into());
        }
        super::windows_startup_allowed(&value.bytes)
    }

    fn current_command() -> Result<String, String> {
        let executable = std::env::current_exe().map_err(registration_error)?;
        let path = executable.to_str().ok_or("앱 경로를 읽지 못했어요.")?;
        super::windows_command(path)
    }

    pub(super) fn set_enabled(identifier: &str, enabled: bool) -> Result<(), String> {
        let user = RegKey::predef(HKEY_CURRENT_USER);
        if enabled {
            let command = current_command()?;
            let (run, _) = user.create_subkey(RUN).map_err(registration_error)?;
            run.set_value(identifier, &command)
                .map_err(registration_error)?;
            let (approved, _) = user.create_subkey(APPROVED).map_err(registration_error)?;
            approved
                .set_raw_value(
                    identifier,
                    &RegValue {
                        vtype: REG_BINARY,
                        bytes: vec![2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                    },
                )
                .map_err(registration_error)?;
        } else {
            for path in [RUN, APPROVED] {
                if let Some(key) = optional(user.open_subkey_with_flags(path, KEY_SET_VALUE))? {
                    optional(key.delete_value(identifier))?;
                }
            }
        }
        Ok(())
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod platform {
    pub(super) fn is_enabled(_identifier: &str) -> Result<bool, String> {
        Err("자동 시작은 macOS와 Windows에서 지원해요.".into())
    }

    pub(super) fn set_enabled(identifier: &str, _enabled: bool) -> Result<(), String> {
        is_enabled(identifier).map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::{windows_command, windows_startup_allowed};

    #[test]
    fn windows_startup_quotes_the_entire_unicode_executable_path() {
        assert_eq!(
            windows_command(r"C:\Users\사용자\Program Files\comet\comet.exe").unwrap(),
            r#""C:\Users\사용자\Program Files\comet\comet.exe""#,
        );
    }

    #[test]
    fn windows_startup_rejects_unrepresentable_run_commands() {
        assert!(windows_command("C:\\bad\"path\\comet.exe").is_err());
        assert!(windows_command(&"a".repeat(259)).is_err());
        assert!(windows_command(&"a".repeat(258)).is_ok());
        assert!(windows_command(&"\u{1f680}".repeat(130)).is_err());
    }

    #[test]
    fn windows_startup_respects_enabled_and_task_manager_disabled_states() {
        for (status, expected) in [(2, true), (6, true), (3, false), (7, false)] {
            let mut value = [0; 12];
            value[0] = status;
            assert_eq!(windows_startup_allowed(&value).unwrap(), expected);
        }
    }

    #[test]
    fn windows_startup_rejects_unknown_or_malformed_approval_states() {
        assert!(windows_startup_allowed(&[]).is_err());
        assert!(windows_startup_allowed(&[0; 12]).is_err());
        let mut value = [0; 12];
        value[0] = 2;
        value[1] = 1;
        assert!(windows_startup_allowed(&value).is_err());
    }
}
