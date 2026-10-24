//! The example tools exercise production modules without copying their dependency tree.

pub mod characters {
    pub use crate::characters::{active_character, collection};
}

pub mod domain {
    pub use crate::domain::{
        analysis_batch_for_conversations, analysis_schema, generated_expressions, parse_lines_for,
        parse_reply, prompt_messages, reply_schema, require_complete_input, roster_scene_prompt,
        scene_schema_for, validate_generated_expressions,
    };
}

pub mod inference {
    pub use crate::inference::{generate, is_local_running, stop_local, Inference};
}

pub mod models {
    pub use crate::models::{download_model, model_ready};
}

pub mod sidecar {
    pub fn development_executable(name: &str) -> std::path::PathBuf {
        crate::sidecar::development_executable(name)
    }
}

pub mod store {
    pub use crate::store::{
        add_scene, analyze_apply_batch, context_messages_for, insert_message, memories, open,
        prepared_scenes, relationships, revision,
    };
}

pub mod types {
    pub use crate::types::{
        ChatMessage, LocalModel, Message, PreparedScene, Relationship, Settings,
    };
}
