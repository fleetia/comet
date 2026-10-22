mod analytics;
mod app;
mod app_usage;
mod apple_models;
mod behavior;
mod characters;
mod chatgpt;
mod conversation_notes;
mod desktop;
mod device;
mod diary;
mod domain;
mod exbrain;
mod inference;
mod legacy_names;
mod memory_commands;
mod models;
mod nlp;
mod organizer;
mod pack_stories;
mod playback;
mod resources;
mod sidecar;
#[doc(hidden)]
pub mod smoke;
mod store;
mod story;
pub mod talk;
mod types;
mod updater;
mod widgets;
mod wordbook;

pub use app::lifecycle::run;

pub(crate) use app::lifecycle::{prepare_update_install, restore_update_install};
#[cfg(test)]
pub(crate) use app::tests as lifecycle_tests;
pub(crate) use app::windows::{hide_boxes, open_settings, quit_app, set_paused, show_boxes};
pub(crate) use app::{interrupt, lock, now, publish, snapshot, unavailable, AppState};
pub(crate) use widgets::commands::{open_widget, open_widgets};
