#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
    if let Some(code) = comet_lib::external_notice_cli(&std::env::args().collect::<Vec<_>>()) {
        std::process::exit(code);
    }
    comet_lib::run();
}
