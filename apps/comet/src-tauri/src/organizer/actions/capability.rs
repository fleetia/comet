use serde::{Deserialize, Serialize, Serializer};
use serde_json::{json, Value};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Effect {
    Read,
    Write,
    Control,
}

#[derive(Clone, Debug)]
pub(crate) enum Source {
    Registry {
        owner: &'static str,
        receipt: bool,
        requires_target: bool,
    },
    Generated {
        title: String,
        widget_id: String,
        revision: i64,
    },
}

/// An action the conversation or an external caller can use. The model sees [`Capability::to_json`],
/// which the catalog golden files pin.
#[derive(Clone, Debug)]
pub(crate) struct Capability {
    pub id: String,
    pub description: String,
    pub effect: Effect,
    pub automatic: bool,
    pub undo_supported: bool,
    pub input_schema: Value,
    pub source: Source,
}

impl Capability {
    pub(crate) fn is_read(&self) -> bool {
        self.effect == Effect::Read
    }

    /// AI widget actions always name their widget.
    pub(crate) fn requires_target(&self) -> bool {
        match self.source {
            Source::Registry {
                requires_target, ..
            } => requires_target,
            Source::Generated { .. } => true,
        }
    }

    /// Whether running the action leaves a receipt in the organizer history.
    pub(crate) fn receipt(&self) -> bool {
        match self.source {
            Source::Registry { receipt, .. } => receipt,
            Source::Generated { .. } => true,
        }
    }

    pub(crate) fn title(&self) -> Option<&str> {
        match &self.source {
            Source::Registry { .. } => None,
            Source::Generated { title, .. } => Some(title),
        }
    }

    pub(crate) fn to_json(&self) -> Value {
        let mut value = json!({
            "id": self.id,
            "description": self.description,
            "effect": self.effect,
            "automatic": self.automatic,
            "undoSupported": self.undo_supported,
            "inputSchema": self.input_schema,
        });
        match &self.source {
            Source::Registry {
                owner,
                receipt,
                requires_target,
            } => {
                value["owner"] = json!(owner);
                value["receipt"] = json!(receipt);
                value["requiresTarget"] = json!(requires_target);
            }
            Source::Generated {
                title,
                widget_id,
                revision,
            } => {
                value["title"] = json!(title);
                value["widgetId"] = json!(widget_id);
                value["revision"] = json!(revision);
            }
        }
        value
    }

    /// The compact view the model chooses actions from.
    pub(crate) fn selection_json(&self) -> Value {
        json!({"id": self.id, "title": self.title(), "description": self.description,
            "effect": self.effect, "automatic": self.automatic})
    }
}

impl Serialize for Capability {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.to_json().serialize(serializer)
    }
}

#[cfg(test)]
impl Capability {
    /// A registry write action known only by its ID, for tests that read IDs alone.
    pub(crate) fn stub(id: &str) -> Self {
        Capability {
            id: id.into(),
            description: String::new(),
            effect: Effect::Write,
            automatic: false,
            undo_supported: true,
            input_schema: json!({}),
            source: Source::Registry {
                owner: "diary",
                receipt: true,
                requires_target: false,
            },
        }
    }
}

pub(crate) fn find<'a>(catalog: &'a [Capability], id: &str) -> Option<&'a Capability> {
    catalog.iter().find(|capability| capability.id == id)
}
