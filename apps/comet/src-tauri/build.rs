fn main() {
    println!(
        "cargo:rustc-env=COMET_TARGET_TRIPLE={}",
        std::env::var("TARGET").expect("Cargo must set the target triple")
    );
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        build_apple_models();
    }
    let mut attributes = tauri_build::Attributes::new();
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        // Test binaries need the Common Controls v6 manifest too, or they exit with
        // STATUS_ENTRYPOINT_NOT_FOUND; tauri-build only embeds it in the app binary.
        attributes = attributes
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
        embed_windows_manifest();
    }
    tauri_build::try_build(attributes).expect("failed to run tauri build script")
}

fn embed_windows_manifest() {
    let manifest =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("windows-app-manifest.xml");
    println!("cargo:rerun-if-changed={}", manifest.display());
    println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
    println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
}

fn build_apple_models() {
    use std::{path::PathBuf, process::Command};
    println!("cargo:rerun-if-changed=native/AppleModels.swift");
    println!("cargo:rerun-if-env-changed=DEVELOPER_DIR");
    let out = PathBuf::from(std::env::var_os("OUT_DIR").expect("Cargo must set OUT_DIR"));
    let arch = match std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() {
        Ok("aarch64") => "arm64",
        Ok("x86_64") => "x86_64",
        _ => panic!("Unsupported macOS architecture"),
    };
    let sdk = Command::new("xcrun")
        .args(["--sdk", "macosx", "--show-sdk-path"])
        .output()
        .expect("Xcode command line tools are required");
    assert!(sdk.status.success(), "Unable to locate the macOS SDK");
    let sdk = String::from_utf8(sdk.stdout).expect("SDK path must be UTF-8");
    let version = Command::new("xcrun")
        .args(["--sdk", "macosx", "--show-sdk-version"])
        .output()
        .expect("Unable to read the macOS SDK version");
    let version = String::from_utf8_lossy(&version.stdout);
    let mut components = version
        .trim()
        .split('.')
        .filter_map(|part| part.parse::<u32>().ok());
    let sdk_version = (
        components.next().unwrap_or(0),
        components.next().unwrap_or(0),
    );
    let token_count = sdk_version >= (26, 4);
    let mut command = Command::new("xcrun");
    if token_count {
        command.args(["swiftc", "-D", "COMET_APPLE_TOKEN_COUNT"]);
    } else {
        command.arg("swiftc");
    }
    let status = command
        .args([
            "-parse-as-library",
            "-emit-library",
            "-static",
            "-swift-version",
            "5",
            "-module-name",
            "CometAppleModels",
            "-Xfrontend",
            "-disable-autolink-framework",
            "-Xfrontend",
            "FoundationModels",
            "-target",
            &format!("{arch}-apple-macosx14.0"),
            "-sdk",
            sdk.trim(),
            "native/AppleModels.swift",
            "-o",
        ])
        .arg(out.join("libCometAppleModels.a"))
        .status()
        .expect("Unable to run swiftc");
    assert!(
        status.success(),
        "Apple Models native bridge compilation failed"
    );
    println!("cargo:rustc-link-search=native={}", out.display());
    println!(
        "cargo:rustc-link-search=native={}/usr/lib/swift",
        sdk.trim()
    );
    println!("cargo:rustc-link-search=native=/usr/lib/swift");
    println!("cargo:rustc-link-lib=static=CometAppleModels");
    if sdk_version >= (26, 0) {
        // Keep the app launchable on its macOS 14 baseline without this framework.
        println!("cargo:rustc-link-arg=-Wl,-weak_framework,FoundationModels");
    }
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
}
