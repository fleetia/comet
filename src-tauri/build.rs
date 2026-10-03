fn main() {
    println!(
        "cargo:rustc-env=COMET_TARGET_TRIPLE={}",
        std::env::var("TARGET").expect("Cargo must set the target triple")
    );
    tauri_build::build()
}
