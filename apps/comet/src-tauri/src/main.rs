#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
    let args: Vec<_> = std::env::args().collect();
    if let Some(code) = comet_lib::external_notice_cli(&args).or_else(|| comet_lib::mcp_cli(&args))
    {
        std::process::exit(code);
    }
    comet_lib::run();
}
