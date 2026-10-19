use super::{lock, AppState};
use crate::store;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::Emitter;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ColorMode {
    #[default]
    System,
    Dark,
    Light,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Skin {
    #[default]
    Night,
    Paper,
    Play,
    Custom,
}

/// Core colors of the user's own skin as `#rrggbb`; the rest is derived on screen.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomSkin {
    pub background: String,
    pub balloon: String,
    pub widget: String,
    pub accent: String,
}

/// App-wide look shared by every window. Kept apart from `Settings` so saving it never
/// touches the AI connection or restarts inference.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Appearance {
    pub color_mode: ColorMode,
    pub skin: Skin,
    /// Kept while another skin is chosen so the user can switch back.
    pub custom_skin: Option<CustomSkin>,
    /// Desktop balloon and widget surface opacity in percent; 100 is opaque.
    pub balloon_opacity: u8,
    pub widget_opacity: u8,
    pub revision: u64,
}

impl Default for Appearance {
    fn default() -> Self {
        Self {
            color_mode: ColorMode::System,
            skin: Skin::Night,
            custom_skin: None,
            balloon_opacity: 100,
            widget_opacity: 100,
            revision: 0,
        }
    }
}

const MIN_OPACITY: u8 = 20;

fn hex_color(value: &str) -> bool {
    value.len() == 7 && value.starts_with('#') && value[1..].bytes().all(|b| b.is_ascii_hexdigit())
}

impl Appearance {
    fn validate(&self) -> Result<(), String> {
        if !(MIN_OPACITY..=100).contains(&self.balloon_opacity)
            || !(MIN_OPACITY..=100).contains(&self.widget_opacity)
        {
            return Err("투명도는 20~100% 사이로 정해 주세요.".into());
        }
        if let Some(skin) = &self.custom_skin {
            if ![&skin.background, &skin.balloon, &skin.widget, &skin.accent]
                .into_iter()
                .all(|value| hex_color(value))
            {
                return Err("내 스킨 색을 확인해 주세요.".into());
            }
        } else if self.skin == Skin::Custom {
            return Err("내 스킨 색을 먼저 골라 주세요.".into());
        }
        Ok(())
    }
}

fn store_appearance(state: &AppState, appearance: Appearance) -> Result<Appearance, String> {
    appearance.validate()?;
    let _action = lock(&state.action)?;
    let db = lock(&state.db)?;
    let saved = Appearance {
        revision: store::appearance(&db)?.revision + 1,
        ..appearance
    };
    store::save_appearance(&db, &saved)?;
    Ok(saved)
}

#[tauri::command]
pub(crate) fn get_appearance(state: tauri::State<'_, Arc<AppState>>) -> Result<Appearance, String> {
    store::appearance(&*lock(&state.db)?)
}

#[tauri::command]
pub(crate) fn save_appearance(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    appearance: Appearance,
) -> Result<Appearance, String> {
    let saved = store_appearance(&state, appearance)?;
    let _ = app.emit("appearance", &saved);
    Ok(saved)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn custom() -> CustomSkin {
        CustomSkin {
            background: "#1f3b33".into(),
            balloon: "#F3EFE2".into(),
            widget: "#d9eadf".into(),
            accent: "#2f7d5b".into(),
        }
    }

    #[test]
    fn missing_appearance_defaults_to_system_night_and_opaque_surfaces() {
        let state = crate::app::tests::state();
        let loaded = store::appearance(&lock(&state.db).unwrap()).unwrap();
        assert_eq!(loaded, Appearance::default());
        assert_eq!((loaded.balloon_opacity, loaded.widget_opacity), (100, 100));
    }

    #[test]
    fn saving_bumps_the_revision_and_keeps_the_custom_skin_behind_another_skin() {
        let state = crate::app::tests::state();
        let first = store_appearance(
            &state,
            Appearance {
                skin: Skin::Custom,
                custom_skin: Some(custom()),
                revision: 99,
                ..Appearance::default()
            },
        )
        .unwrap();
        assert_eq!(first.revision, 1);
        let second = store_appearance(
            &state,
            Appearance {
                skin: Skin::Paper,
                ..first.clone()
            },
        )
        .unwrap();
        assert_eq!(second.revision, 2);
        let loaded = store::appearance(&lock(&state.db).unwrap()).unwrap();
        assert_eq!(loaded.skin, Skin::Paper);
        assert_eq!(loaded.custom_skin, Some(custom()));
    }

    #[test]
    fn invalid_appearance_is_rejected_without_changing_the_saved_one() {
        let state = crate::app::tests::state();
        for invalid in [
            Appearance {
                balloon_opacity: 19,
                ..Appearance::default()
            },
            Appearance {
                widget_opacity: 101,
                ..Appearance::default()
            },
            Appearance {
                skin: Skin::Custom,
                ..Appearance::default()
            },
            Appearance {
                custom_skin: Some(CustomSkin {
                    accent: "red".into(),
                    ..custom()
                }),
                ..Appearance::default()
            },
        ] {
            assert!(store_appearance(&state, invalid).is_err());
        }
        assert_eq!(
            store::appearance(&lock(&state.db).unwrap()).unwrap(),
            Appearance::default()
        );
    }

    #[test]
    fn older_saved_values_fill_new_fields_with_defaults() {
        let parsed: Appearance = serde_json::from_str(r#"{"skin":"play","revision":3}"#).unwrap();
        assert_eq!(parsed.skin, Skin::Play);
        assert_eq!(parsed.color_mode, ColorMode::System);
        assert_eq!(parsed.widget_opacity, 100);
    }
}
