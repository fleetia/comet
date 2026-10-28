mod analysis;
mod conversations;
mod memory;
pub(crate) use memory::direct_affinity;
mod messages;
mod quiet_hours;
mod search;
mod users;

#[cfg(test)]
pub use analysis::set_last_analysis_id;
pub use analysis::{
    analysis_failure, analysis_status, defer_analysis, pending_user_messages,
    retry_deferred_analysis, AnalysisStatus,
};
pub use conversations::{
    active_conversation, attach_conversation_message, cancel_conversation_reply,
    clear_conversation_cancellation, conversation, conversation_context, conversation_for_message,
    conversation_history, conversation_message_allowed, conversation_messages,
    conversation_recovery, conversation_view, create_conversation_with_source, pause_conversations,
    pause_conversations_for_focus, record_conversation_disclosure, record_conversation_event,
    save_conversation_draft, set_conversation_participants, set_conversation_status,
    ConversationMessages, ConversationSession, ConversationView, RecoveryReason,
};
#[cfg(test)]
pub use conversations::{conversation_reply_pending, conversations, create_conversation};
#[cfg(test)]
pub use memory::analyze_apply;
#[allow(unused_imports)] // Developer smoke examples still inspect the complete memory list.
pub use memory::memories;
pub use memory::{
    analysis_memories, analyze_apply_batch, assign_legacy_memories, completed_conversation_sources,
    copy_recall, delete_memory_for, edit_memory_for, forget_character_memories, idle_memories,
    inherit_recall, insert_experience, insert_moment, legacy_memory_count, legacy_memory_page, recall_valid,
    record_recall, relationships, scoped_memory_page,
};
#[cfg(test)]
pub use memory::{delete_memory, edit_memory};
#[allow(unused_imports)] // Developer smoke examples still insert synthetic history directly.
pub use messages::insert_message;
#[cfg(test)]
pub use messages::mark_message_displayed;
pub use messages::{
    automatic_message_displayed_at, context_messages, context_messages_for,
    expire_generated_recall, has_turn_replies, input_ai_only, insert_message_with_playback,
    insert_user_input, mark_message_displayed_with_provenance, mark_message_finished,
    message_displayed, message_finished, message_identities, message_targets, messages,
    reply_scene_source, resume_conversation, save_reply_scene, save_reply_scene_with_source,
    saved_reply, saved_reply_for_participants, saved_reply_scene,
    saved_reply_scene_for_participants, select_input_ai_route, select_single_bundle_targets,
    single_bundle_selected, single_bundle_targets, MessageIdentity,
};
use messages::{initialize_identities, initialize_message_context};
pub(crate) use messages::{insert_message_with_actor, save_generated_bundle};
#[cfg(test)]
pub use messages::{insert_message_with_source, insert_message_with_talk};
pub use search::{
    clear_search_index, memory_count, memory_revision, next_memory_for_index, pending_index_count,
    recall_for_turn, save_kiwi_index, save_vector_index, search_memories_for, set_search_profile,
    IndexMemory, MemoryEmbedding, MemoryPage, MemorySearchHit,
};
#[cfg(test)]
pub use search::{current_user_facts_for, memory_page, revalidate_search_hits, search_memories};
#[cfg(test)]
pub use users::require_user;
pub use users::{
    active_user_id, current_user, current_user_birthday, effective_memory_time, expire_memories,
    message_user_id, message_user_names, register_user_name, register_user_profile, set_user_birthday,
    set_user_name, user_identity, MEMORY_LIFETIME_MILLIS,
};

use crate::types::*;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{de::DeserializeOwned, Serialize};
use std::path::Path;

type Result<T> = std::result::Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

pub fn open(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path).map_err(err)?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,role TEXT NOT NULL,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS memories(id TEXT PRIMARY KEY,content TEXT NOT NULL,source TEXT NOT NULL,updated INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,locked INTEGER NOT NULL DEFAULT 0);
CREATE UNIQUE INDEX IF NOT EXISTS memory_evidence ON memories(source,content);
CREATE TABLE IF NOT EXISTS scenes(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS affinity(source TEXT NOT NULL,persona TEXT NOT NULL,day TEXT NOT NULL,delta INTEGER NOT NULL,fingerprint TEXT NOT NULL,PRIMARY KEY(source,persona));
CREATE TABLE IF NOT EXISTS talk_history(scene_key TEXT PRIMARY KEY,shown_at INTEGER NOT NULL);
INSERT OR IGNORE INTO kv VALUES('revision','0');").map_err(err)?;
    conn.execute_batch("CREATE TEMP TABLE moment_events(
        user_id TEXT NOT NULL, source TEXT NOT NULL, event TEXT NOT NULL,
        summary TEXT NOT NULL, created_at INTEGER NOT NULL, widget_kind TEXT, widget_id TEXT,
        PRIMARY KEY(user_id, source)
    );
    CREATE TEMP TABLE moment_event_keepers(
        user_id TEXT NOT NULL, source TEXT NOT NULL, character_id TEXT NOT NULL, memory_id TEXT NOT NULL,
        PRIMARY KEY(user_id, source, character_id),
        FOREIGN KEY(user_id, source) REFERENCES moment_events(user_id, source) ON DELETE CASCADE
    );").map_err(err)?;
    // Regression tests were written against the A/B factory roster; production seeds the
    // Byulkkori default. Both paths share the same one-time `character_seed` guard.
    #[cfg(not(test))]
    crate::characters::initialize(&conn)?;
    #[cfg(test)]
    crate::characters::initialize_for_tests(&conn)?;
    crate::wordbook::initialize(&conn)?;
    initialize_identities(&conn)?;
    initialize_message_context(&conn)?;
    search::initialize(&conn)?;
    analysis::initialize(&conn)?;
    users::initialize(&conn)?;
    conversations::initialize_conversations(&conn)?;
    crate::widgets::storage::initialize(&conn)?;
    quiet_hours::migrate(&conn)?;
    crate::diary::initialize(&conn)?;
    crate::widgets::generated::initialize(&conn)?;
    crate::pack_stories::initialize(&conn)?;
    crate::organizer::initialize(&conn)?;
    crate::organizer::actions::initialize(&conn)?;
    Ok(conn)
}

fn get<T: DeserializeOwned>(conn: &Connection, key: &str) -> Result<Option<T>> {
    let raw: Option<String> = conn
        .query_row("SELECT value FROM kv WHERE key=?", [key], |r| r.get(0))
        .optional()
        .map_err(err)?;
    raw.map(|v| serde_json::from_str(&v).map_err(err))
        .transpose()
}
fn put<T: Serialize>(conn: &Connection, key: &str, value: &T) -> Result<()> {
    conn.execute(
        "INSERT INTO kv VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        params![key, serde_json::to_string(value).map_err(err)?],
    )
    .map_err(err)?;
    Ok(())
}
pub fn settings(conn: &Connection) -> Result<Settings> {
    let mut settings: Settings = get(conn, "settings")?.unwrap_or_default();
    settings.remember_api_profile();
    // Consent is collected before install for test log collection; the app cannot withdraw it.
    settings.analytics_consent = true;
    Ok(settings)
}
pub fn save_settings(conn: &Connection, value: &Settings) -> Result<()> {
    let mut value = value.clone();
    value.remember_api_profile();
    put(conn, "settings", &value)
}
pub fn appearance(conn: &Connection) -> Result<crate::app::appearance::Appearance> {
    Ok(get(conn, "appearance")?.unwrap_or_default())
}
pub fn save_appearance(
    conn: &Connection,
    value: &crate::app::appearance::Appearance,
) -> Result<()> {
    put(conn, "appearance", value)
}
pub fn revision(conn: &Connection) -> Result<i64> {
    Ok(get(conn, "revision")?.unwrap_or(0))
}
pub fn bump_revision(conn: &Connection) -> Result<i64> {
    conn.execute(
        "UPDATE kv SET value=CAST(CAST(value AS INTEGER)+1 AS TEXT) WHERE key='revision'",
        [],
    )
    .map_err(err)?;
    conn.execute("DELETE FROM scenes", []).map_err(err)?;
    revision(conn)
}
pub fn prepared_scenes(conn: &Connection) -> Result<Vec<PreparedScene>> {
    let mut stmt = conn
        .prepare("SELECT data FROM scenes WHERE revision=? ORDER BY rowid LIMIT 3")
        .map_err(err)?;
    let rows = stmt
        .query_map([revision(conn)?], |r| r.get::<_, String>(0))
        .map_err(err)?;
    rows.map(|r| serde_json::from_str(&r.map_err(err)?).map_err(err))
        .collect()
}
pub fn add_scene(conn: &Connection, scene: &PreparedScene) -> Result<()> {
    if scene.revision != revision(conn)? {
        return Err("대화가 바뀌어 미리 만든 대사를 버렸습니다.".into());
    }
    conn.execute(
        "INSERT OR REPLACE INTO scenes VALUES(?1,?2,?3)",
        params![
            scene.id,
            scene.revision,
            serde_json::to_string(scene).map_err(err)?
        ],
    )
    .map_err(err)?;
    Ok(())
}
pub fn delete_scene(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM scenes WHERE id=?", [id])
        .map_err(err)?;
    Ok(())
}
pub fn window_position(conn: &Connection, label: &str) -> Result<Option<WindowPosition>> {
    get(conn, &format!("window:{label}"))
}
pub(crate) fn migrate_body_position(
    conn: &Connection,
    label: &str,
    legacy: Option<&str>,
) -> Result<Option<WindowPosition>> {
    if let Some(position) = window_position(conn, label)? {
        return Ok(Some(position));
    }
    let position = legacy
        .map(|legacy| window_position(conn, legacy))
        .transpose()?
        .flatten();
    if let Some(position) = &position {
        set_window_position(conn, label, position)?;
    }
    Ok(position)
}

pub fn set_window_position(conn: &Connection, label: &str, pos: &WindowPosition) -> Result<()> {
    put(conn, &format!("window:{label}"), pos)
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod identity_tests;
