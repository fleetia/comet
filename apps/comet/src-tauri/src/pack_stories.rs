pub(crate) mod commands;
pub(crate) mod resume;

use crate::{
    characters::{CharacterDefinition, CharacterLine},
    types::SceneLine,
};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

type Result<T> = std::result::Result<T, String>;
mod authoring;
pub(crate) use authoring::{authoring_trial, AuthoringTrialRequest, AuthoringTrialTrace};

pub(crate) fn matches_keywords(words: &[String], input: &str) -> bool {
    let input = input.to_lowercase();
    words
        .iter()
        .any(|word| input.contains(&word.to_lowercase()))
}

fn flags_match(required: &[String], flags: &BTreeSet<String>) -> bool {
    required.iter().all(|flag| flags.contains(flag))
}

fn repeat_allowed(definition: &ScenarioDefinition, completed: bool, incomplete: bool) -> bool {
    (!completed || definition.allow_repeat) && (!incomplete || definition.allow_incomplete_repeat)
}
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PresenceRole {
    #[default]
    Resident,
    Npc,
}
impl PresenceRole {
    pub fn is_resident(&self) -> bool {
        *self == Self::Resident
    }
}
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NpcExitPolicy {
    SceneEnd,
    #[default]
    TopicChange,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct NpcDefinition {
    pub invite_keywords: Vec<String>,
    pub appearance_keywords: Vec<String>,
    pub required_flags: Vec<String>,
    pub entry_lines: Vec<CharacterLine>,
    pub exit_policy: NpcExitPolicy,
}
impl Default for NpcDefinition {
    fn default() -> Self {
        Self {
            invite_keywords: vec![],
            appearance_keywords: vec![],
            required_flags: vec![],
            entry_lines: vec![],
            exit_policy: NpcExitPolicy::TopicChange,
        }
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StoryFlag {
    pub id: String,
    #[serde(default)]
    pub public: bool,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConditionalKnowledge {
    pub id: String,
    pub keywords: Vec<String>,
    pub text: String,
    pub known_by: Vec<String>,
    #[serde(default)]
    pub required_flags: Vec<String>,
}
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct CompletionEffects {
    pub set_flags: Vec<String>,
    pub memory_template: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StrictLine {
    persona: String,
    expression: String,
    text: String,
    #[serde(default)]
    motion: crate::characters::reactions::MotionOverride,
}
fn strict_lines<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<Vec<SceneLine>, D::Error> {
    Ok(Vec::<StrictLine>::deserialize(deserializer)?
        .into_iter()
        .map(|line| SceneLine {
            persona: line.persona,
            expression: line.expression,
            text: line.text,
            widget: None,
            motion: line.motion,
        })
        .collect())
}
fn yes() -> bool {
    true
}
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ScenarioPurpose {
    #[default]
    Story,
    Tutorial,
}
impl ScenarioPurpose {
    fn is_story(&self) -> bool {
        *self == Self::Story
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Chapter {
    pub id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next: Option<String>,
    pub steps: Vec<StoryStep>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StoryOption {
    pub id: String,
    pub label: String,
    pub goto: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StoryTimeout {
    pub steps: Vec<StoryStep>,
    pub then: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum StoryWidget {
    Memo,
    FocusTimer,
    Todo,
    Calendar,
    Music,
    Ball,
    PaperPlane,
    Bubbles,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SettingsTab {
    Friends,
    Dialogue,
    Desktop,
    Widgets,
    Ai,
    General,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum SettingsHighlight {
    #[serde(rename = "ai.recommended")]
    AiRecommended,
    #[serde(rename = "general.guide")]
    GeneralGuide,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GuidePage {
    FirstMeeting,
    Talking,
    Friends,
    Packs,
    Widgets,
    Ai,
    Rhythm,
    DiaryMemory,
    Glossary,
    Troubleshooting,
    Privacy,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "do", deny_unknown_fields)]
pub enum StoryAction {
    #[serde(rename = "widget.open")]
    WidgetOpen { widget: StoryWidget },
    #[serde(rename = "focus.start")]
    FocusStart { minutes: u32 },
    #[serde(rename = "focus.stop")]
    FocusStop {},
    #[serde(rename = "settings.open")]
    SettingsOpen {
        tab: SettingsTab,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        highlight: Option<SettingsHighlight>,
    },
    #[serde(rename = "guide.open")]
    GuideOpen { page: GuidePage },
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum StoryWindow {
    Settings,
    Memo,
    FocusTimer,
    Todo,
    Calendar,
    Music,
    Ball,
    PaperPlane,
    Bubbles,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SavedWidget {
    Memo,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "event", deny_unknown_fields)]
pub enum StoryEvent {
    #[serde(rename = "body.clicked")]
    BodyClicked {},
    #[serde(rename = "body.moved")]
    BodyMoved {},
    #[serde(rename = "widget.saved")]
    WidgetSaved { widget: SavedWidget },
    #[serde(rename = "focus.started")]
    FocusStarted {},
    #[serde(rename = "focus.stopped")]
    FocusStopped {},
    #[serde(rename = "window.closed")]
    WindowClosed { window: StoryWindow },
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StoryEnter {
    Left,
    Right,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StoryInput {
    Name,
    Text,
}

type StoryMotion = crate::characters::reactions::MotionOverride;
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum StoryStep {
    Line {
        persona: String,
        expression: String,
        text: String,
        #[serde(default, skip_serializing_if = "StoryMotion::is_inherit")]
        motion: StoryMotion,
    },
    Move {
        persona: String,
        enter: StoryEnter,
    },
    Ask {
        id: String,
        persona: String,
        expression: String,
        prompt: String,
        input: StoryInput,
        #[serde(skip_serializing_if = "Option::is_none")]
        known: Option<String>,
        #[serde(default, skip_serializing_if = "StoryMotion::is_inherit")]
        motion: StoryMotion,
    },
    Choice {
        persona: String,
        expression: String,
        prompt: String,
        options: Vec<StoryOption>,
        #[serde(default, skip_serializing_if = "StoryMotion::is_inherit")]
        motion: StoryMotion,
    },
    Action {
        #[serde(flatten)]
        action: StoryAction,
    },
    Wait {
        #[serde(flatten)]
        event: StoryEvent,
        timeout_sec: u32,
        #[serde(skip_serializing_if = "Vec::is_empty")]
        cancel_on: Vec<StoryEvent>,
        on_timeout: StoryTimeout,
    },
}

// Action and event each have their own discriminator and strict field set.
impl<'de> Deserialize<'de> for StoryStep {
    fn deserialize<D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> std::result::Result<Self, D::Error> {
        use serde::de::Error;
        #[derive(Deserialize)]
        #[serde(
            tag = "kind",
            rename_all = "camelCase",
            rename_all_fields = "camelCase",
            deny_unknown_fields
        )]
        enum Basic {
            Line {
                persona: String,
                expression: String,
                text: String,
                #[serde(default)]
                motion: StoryMotion,
            },
            Move {
                persona: String,
                enter: StoryEnter,
            },
            Ask {
                id: String,
                persona: String,
                expression: String,
                prompt: String,
                input: StoryInput,
                #[serde(default)]
                known: Option<String>,
                #[serde(default)]
                motion: StoryMotion,
            },
            Choice {
                persona: String,
                expression: String,
                prompt: String,
                options: Vec<StoryOption>,
                #[serde(default)]
                motion: StoryMotion,
            },
        }
        let mut value = serde_json::Value::deserialize(deserializer)?;
        let object = value
            .as_object_mut()
            .ok_or_else(|| D::Error::custom("step must be an object"))?;
        match object.get("kind").and_then(|kind| kind.as_str()) {
            Some("action") => {
                object.remove("kind");
                serde_json::from_value(value)
                    .map(|action| Self::Action { action })
                    .map_err(D::Error::custom)
            }
            Some("wait") => {
                object.remove("kind");
                let timeout_sec = serde_json::from_value(
                    object
                        .remove("timeoutSec")
                        .ok_or_else(|| D::Error::missing_field("timeoutSec"))?,
                )
                .map_err(D::Error::custom)?;
                let on_timeout = serde_json::from_value(
                    object
                        .remove("onTimeout")
                        .ok_or_else(|| D::Error::missing_field("onTimeout"))?,
                )
                .map_err(D::Error::custom)?;
                let cancel_on = object
                    .remove("cancelOn")
                    .map(serde_json::from_value)
                    .transpose()
                    .map_err(D::Error::custom)?
                    .unwrap_or_default();
                let event = serde_json::from_value(value).map_err(D::Error::custom)?;
                Ok(Self::Wait {
                    event,
                    timeout_sec,
                    cancel_on,
                    on_timeout,
                })
            }
            _ => match serde_json::from_value::<Basic>(value).map_err(D::Error::custom)? {
                Basic::Line {
                    persona,
                    expression,
                    text,
                    motion,
                } => Ok(Self::Line {
                    persona,
                    expression,
                    text,
                    motion,
                }),
                Basic::Move { persona, enter } => Ok(Self::Move { persona, enter }),
                Basic::Ask {
                    id,
                    persona,
                    expression,
                    prompt,
                    input,
                    known,
                    motion,
                } => Ok(Self::Ask {
                    id,
                    persona,
                    expression,
                    prompt,
                    input,
                    known,
                    motion,
                }),
                Basic::Choice {
                    persona,
                    expression,
                    prompt,
                    options,
                    motion,
                } => Ok(Self::Choice {
                    persona,
                    expression,
                    prompt,
                    options,
                    motion,
                }),
            },
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScenarioDefinition {
    #[serde(default, skip_serializing_if = "ScenarioPurpose::is_story")]
    pub purpose: ScenarioPurpose,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chapters: Option<Vec<Chapter>>,
    pub id: String,
    pub title: String,
    pub center_id: String,
    pub participants: Vec<String>,
    #[serde(default)]
    pub keywords: Vec<String>,
    #[serde(default)]
    pub required_flags: Vec<String>,
    #[serde(default)]
    pub min_affinity: i32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reveal_affinity: Option<i32>,
    #[serde(
        default,
        deserialize_with = "strict_lines",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub defer: Vec<SceneLine>,
    #[serde(default, deserialize_with = "strict_lines")]
    pub intro: Vec<SceneLine>,
    #[serde(default, deserialize_with = "strict_lines")]
    pub accept: Vec<SceneLine>,
    #[serde(default, deserialize_with = "strict_lines")]
    pub decline: Vec<SceneLine>,
    #[serde(default, deserialize_with = "strict_lines")]
    pub ending: Vec<SceneLine>,
    #[serde(default)]
    pub accept_keywords: Vec<String>,
    #[serde(default)]
    pub decline_keywords: Vec<String>,
    #[serde(default)]
    pub proceed_keywords: Vec<String>,
    #[serde(default)]
    pub cancel_keywords: Vec<String>,
    #[serde(default)]
    pub accept_next_id: Option<String>,
    #[serde(default)]
    pub decline_next_id: Option<String>,
    #[serde(default = "yes")]
    pub allow_incomplete_repeat: bool,
    #[serde(default)]
    pub allow_repeat: bool,
    #[serde(default)]
    pub completion: CompletionEffects,
}
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct PackStoryDefinition {
    pub world_rules: String,
    pub story_flags: Vec<StoryFlag>,
    pub knowledge: Vec<ConditionalKnowledge>,
    pub scenarios: Vec<ScenarioDefinition>,
}
impl PackStoryDefinition {
    pub fn is_empty(&self) -> bool {
        self.world_rules.is_empty()
            && self.story_flags.is_empty()
            && self.knowledge.is_empty()
            && self.scenarios.is_empty()
    }
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackStoryDefinitionSnapshot {
    pub pack_id: String,
    pub definition: PackStoryDefinition,
    pub baseline: String,
    pub source_to_local: BTreeMap<String, String>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scope {
    pub user_id: String,
    pub pack_id: String,
    pub center_id: String,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Stage {
    Intro,
    Defer,
    Accept,
    Decline,
    Ending,
    Entry,
    Chapter,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunTicket {
    pub run_id: String,
    pub input_id: String,
    pub scope: Scope,
    pub scenario_id: Option<String>,
    pub stage: Stage,
    #[serde(default)]
    pub chapter_id: Option<String>,
    #[serde(default)]
    pub step: usize,
    pub phase_generation: u64,
    pub epoch: u64,
    pub participants: Vec<String>,
    pub pack_baseline: String,
    pub definition_baselines: BTreeMap<String, String>,
    pub last_playback_id: String,
    pub definition: Option<ScenarioDefinition>,
    pub ready: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    #[serde(default)]
    pub replaced_run_id: Option<String>,
    #[serde(skip)]
    pub retry: bool,
    pub input_id: String,
    pub run_id: String,
    pub source: String,
    pub lines: Vec<SceneLine>,
    pub required_guest_ids: Vec<String>,
    pub run: RunTicket,
}
#[derive(Debug, Clone)]
pub struct InputContext {
    pub input_id: String,
    pub user_id: String,
    pub targets: Vec<String>,
    pub epoch: u64,
}
#[derive(Debug, Clone)]
pub struct DisplayProof {
    pub playback_id: String,
    pub input_id: String,
    pub display_started_at: Option<i64>,
    pub ends_at: i64,
    pub now: i64,
    pub epoch: u64,
    pub participants: Vec<String>,
    pub pack_baseline: String,
}
#[derive(Debug, Clone, Default)]
pub struct Finish {
    #[cfg(test)]
    pub completed: bool,
    pub guest_ids: Vec<String>,
}
#[derive(Clone, Default)]
pub struct Runtime {
    pub run: Option<RunTicket>,
    pub pending_next: Option<(Scope, String)>,
    pub pending_cancellations: Vec<RunTicket>,
    pub resume_offered: bool,
    pub pending_resume: Option<(String, Scope, resume::ResumePoint)>,
    pub(crate) interaction: Option<SceneInteraction>,
}

#[derive(Clone)]
pub(crate) struct SceneInteraction {
    pub run_id: String,
    pub epoch: u64,
    pub generation: u64,
    pub request_id: String,
    pub persona: String,
    pub choices: Option<Vec<String>>,
    pub answer: Option<String>,
}

fn id(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= 128 && !value.chars().any(char::is_control)
}
fn keywords(values: &[String]) -> bool {
    let mut seen = BTreeSet::new();
    values.len() <= 20
        && values.iter().all(|value| {
            id(value) && value.chars().count() <= 80 && seen.insert(value.to_lowercase())
        })
}
pub fn validate_character(definition: &CharacterDefinition) -> Result<()> {
    let check = |lines: &[CharacterLine]| -> Result<()> {
        if lines.len() > 8 {
            return Err("일반 등록 대사는 8줄까지 작성해 주세요.".into());
        }
        for line in lines {
            if line.text.trim().is_empty()
                || line.text.chars().count() > 500
                || !definition.expressions.contains_key(&line.expression)
            {
                return Err("등록 대사의 화자·본문·표정을 확인해 주세요.".into());
            }
            crate::characters::reactions::validate_motion(&line.motion, definition, false)?;
        }
        Ok(())
    };
    if let Some(npc) = &definition.npc {
        if !keywords(&npc.invite_keywords) || !keywords(&npc.appearance_keywords) {
            return Err("찾아오는 친구의 등장 키워드를 확인해 주세요.".into());
        }
        check(&npc.entry_lines)?;
    }
    for relation in &definition.relationships {
        check(&relation.reply_lines)?;
    }
    Ok(())
}
fn story_text(text: &str, max: usize) -> bool {
    !text.trim().is_empty() && text.chars().count() <= max
}

fn validate_variables(text: &str, name_known: bool, answers: &BTreeSet<String>) -> Result<()> {
    if !name_known && text.contains("{userName}") {
        return Err("이름을 묻기 전에는 {userName}을 쓸 수 없어요.".into());
    }
    let mut rest = text;
    while let Some(start) = rest.find("{answer.") {
        rest = &rest[start + "{answer.".len()..];
        let end = rest.find('}').ok_or("입력 변수의 형식을 확인해 주세요.")?;
        if !answers.contains(&rest[..end]) {
            return Err("같은 장에서 앞서 물은 입력만 사용할 수 있어요.".into());
        }
        rest = &rest[end + 1..];
    }
    Ok(())
}

fn validate_action(action: &StoryAction) -> Result<()> {
    if let StoryAction::FocusStart { minutes } = action {
        if !(1..=60).contains(minutes) {
            return Err("집중 시간은 1~60분이어야 해요.".into());
        }
    }
    Ok(())
}

fn validate_chapters(
    scene: &ScenarioDefinition,
    sources: &BTreeMap<&str, &CharacterDefinition>,
) -> Result<()> {
    let chapters = scene.chapters.as_ref().ok_or("장면을 확인해 주세요.")?;
    if !(1..=99).contains(&chapters.len()) {
        return Err("장은 1~99개여야 해요.".into());
    }
    let mut chapter_ids = BTreeMap::new();
    for (index, chapter) in chapters.iter().enumerate() {
        if !id(&chapter.id)
            || chapter_ids.insert(chapter.id.as_str(), index).is_some()
            || !story_text(&chapter.title, 40)
            || !(1..=32).contains(&chapter.steps.len())
        {
            return Err("장 ID·제목·단계 수를 확인해 주세요.".into());
        }
    }
    let target = |value: &str, reserved: &[&str]| -> Result<()> {
        if !reserved.contains(&value) && !chapter_ids.contains_key(value) {
            return Err("이동할 장 ID를 확인해 주세요.".into());
        }
        Ok(())
    };
    let actor =
        |persona: &str, expression: Option<&str>, motion: Option<&StoryMotion>| -> Result<()> {
            let actor = sources.get(persona).ok_or("이야기에 없는 화자예요.")?;
            if !scene
                .participants
                .iter()
                .any(|participant| participant == persona)
                || expression.is_some_and(|value| !actor.expressions.contains_key(value))
            {
                return Err("이야기 대사의 참가자·표정을 확인해 주세요.".into());
            }
            if let Some(motion) = motion {
                crate::characters::reactions::validate_motion(motion, actor, false)?;
            }
            Ok(())
        };
    for chapter in chapters {
        if let Some(next) = &chapter.next {
            target(next, &["end"])?;
        }
        for step in &chapter.steps {
            match step {
                StoryStep::Line {
                    persona,
                    expression,
                    text,
                    motion,
                } => {
                    actor(persona, Some(expression), Some(motion))?;
                    if !story_text(text, 500) {
                        return Err("대사 본문은 1~500자여야 해요.".into());
                    }
                }
                StoryStep::Move { persona, .. } => actor(persona, None, None)?,
                StoryStep::Ask {
                    id: ask_id,
                    persona,
                    expression,
                    prompt,
                    input,
                    known,
                    motion,
                } => {
                    actor(persona, Some(expression), Some(motion))?;
                    if !id(ask_id)
                        || !story_text(prompt, 500)
                        || (*input == StoryInput::Name && known.is_none())
                        || known.as_ref().is_some_and(|text| !story_text(text, 500))
                    {
                        return Err("질문 ID·본문·이름 대사를 확인해 주세요.".into());
                    }
                }
                StoryStep::Choice {
                    persona,
                    expression,
                    prompt,
                    options,
                    motion,
                } => {
                    actor(persona, Some(expression), Some(motion))?;
                    if !story_text(prompt, 500) || !(2..=4).contains(&options.len()) {
                        return Err("선택지와 질문을 확인해 주세요.".into());
                    }
                    let mut option_ids = BTreeSet::new();
                    for option in options {
                        if !id(&option.id)
                            || !option_ids.insert(&option.id)
                            || !story_text(&option.label, 20)
                        {
                            return Err("선택지 ID·표시 문구를 확인해 주세요.".into());
                        }
                        target(&option.goto, &["next", "end"])?;
                    }
                }
                StoryStep::Action { action } => validate_action(action)?,
                StoryStep::Wait {
                    timeout_sec,
                    on_timeout,
                    ..
                } => {
                    if !(10..=900).contains(timeout_sec) || on_timeout.steps.len() > 4 {
                        return Err("대기 시간과 시간 초과 단계를 확인해 주세요.".into());
                    }
                    target(&on_timeout.then, &["next", "nextChapter", "end"])?;
                    for step in &on_timeout.steps {
                        match step {
                            StoryStep::Line {
                                persona,
                                expression,
                                text,
                                motion,
                            } => {
                                actor(persona, Some(expression), Some(motion))?;
                                if !story_text(text, 500) {
                                    return Err("대사 본문은 1~500자여야 해요.".into());
                                }
                            }
                            StoryStep::Action { action } => validate_action(action)?,
                            _ => {
                                return Err("시간 초과 단계에는 대사와 동작만 쓸 수 있어요.".into())
                            }
                        }
                    }
                }
            }
        }
    }
    // The only chapter transition without an interaction is the implicit/explicit next.
    for start in 0..chapters.len() {
        let mut visited = BTreeSet::new();
        let mut current = Some(start);
        while let Some(index) = current {
            if !visited.insert(index) {
                return Err("입력이나 대기 없는 장 순환은 사용할 수 없어요.".into());
            }
            let chapter = &chapters[index];
            if chapter.steps.iter().any(|step| {
                matches!(
                    step,
                    StoryStep::Ask { .. } | StoryStep::Choice { .. } | StoryStep::Wait { .. }
                )
            }) {
                break;
            }
            current = match chapter.next.as_deref() {
                Some("end") => None,
                Some(next) => chapter_ids.get(next).copied(),
                None => (index + 1 < chapters.len()).then_some(index + 1),
            };
        }
    }
    // Propagate name availability through all possible chapter transitions. Answers expire at chapter boundaries.
    let mut queue = vec![(0usize, false)];
    let mut visited = BTreeSet::new();
    loop {
        if queue.is_empty() {
            if let Some(index) =
                (0..chapters.len()).find(|index| !visited.iter().any(|(seen, _)| seen == index))
            {
                queue.push((index, false));
            } else {
                break;
            }
        }
        let (index, mut name_known) = queue.pop().unwrap();
        if !visited.insert((index, name_known)) {
            continue;
        }
        let chapter = &chapters[index];
        let mut answers = BTreeSet::new();
        let mut follows_next = true;
        for step in &chapter.steps {
            match step {
                StoryStep::Line { text, .. } => validate_variables(text, name_known, &answers)?,
                StoryStep::Ask {
                    id,
                    prompt,
                    input,
                    known,
                    ..
                } => {
                    validate_variables(prompt, name_known, &answers)?;
                    if let Some(known) = known {
                        validate_variables(
                            known,
                            *input == StoryInput::Name || name_known,
                            &answers,
                        )?;
                    }
                    match input {
                        StoryInput::Name => name_known = true,
                        StoryInput::Text => {
                            answers.insert(id.clone());
                        }
                    }
                }
                StoryStep::Choice {
                    prompt, options, ..
                } => {
                    validate_variables(prompt, name_known, &answers)?;
                    let mut has_next = false;
                    for option in options {
                        validate_variables(&option.label, name_known, &answers)?;
                        if option.goto == "next" {
                            has_next = true;
                        } else if option.goto != "end" && follows_next {
                            if let Some(next) = chapter_ids.get(option.goto.as_str()) {
                                queue.push((*next, name_known));
                            }
                        }
                    }
                    if !has_next {
                        follows_next = false;
                    }
                }
                StoryStep::Wait { on_timeout, .. } => {
                    for step in &on_timeout.steps {
                        if let StoryStep::Line { text, .. } = step {
                            validate_variables(text, name_known, &answers)?;
                        }
                    }
                    let next = if on_timeout.then == "nextChapter" {
                        match chapter.next.as_deref() {
                            Some("end") => None,
                            Some(value) => chapter_ids.get(value).copied(),
                            None => (index + 1 < chapters.len()).then_some(index + 1),
                        }
                    } else if matches!(on_timeout.then.as_str(), "next" | "end") {
                        None
                    } else {
                        chapter_ids.get(on_timeout.then.as_str()).copied()
                    };
                    if follows_next {
                        if let Some(next) = next {
                            queue.push((next, name_known));
                        }
                    }
                }
                _ => {}
            }
        }
        if follows_next {
            let next = match chapter.next.as_deref() {
                Some("end") => None,
                Some(value) => chapter_ids.get(value).copied(),
                None => (index + 1 < chapters.len()).then_some(index + 1),
            };
            if let Some(next) = next {
                queue.push((next, name_known));
            }
        }
    }
    Ok(())
}

pub fn validate_pack(
    definitions: &[CharacterDefinition],
    extras: &PackStoryDefinition,
) -> Result<()> {
    if extras
        .scenarios
        .iter()
        .any(|scene| scene.purpose == ScenarioPurpose::Tutorial && scene.chapters.is_none())
    {
        return Err("튜토리얼은 장면형 이야기로만 만들 수 있어요.".into());
    }
    if extras.world_rules.chars().count() > 2000
        || extras.knowledge.len() > 32
        || extras.knowledge.iter().any(|item| {
            item.text.chars().count() > 2000
                || item.keywords.len() > 20
                || item.known_by.iter().collect::<BTreeSet<_>>().len() != item.known_by.len()
        })
        || extras.scenarios.len() > 32
        || extras.story_flags.len() > 32
        || extras.scenarios.iter().any(|scene| {
            scene
                .completion
                .memory_template
                .as_ref()
                .is_some_and(|text| text.trim().is_empty() || text.chars().count() > 500)
        })
    {
        return Err("세계 규칙·지식 본문은 2,000자, 지식·이야기·flag는 32개, 기억 문구는 500자까지 작성해 주세요.".into());
    }
    let sources: BTreeMap<_, _> = definitions
        .iter()
        .map(|d| (d.source_id.as_str(), d))
        .collect();
    if definitions.is_empty()
        || definitions.len() > 8
        || sources.len() != definitions.len()
        || definitions
            .iter()
            .any(|definition| !id(&definition.source_id))
    {
        return Err("서로 다른 인물 ID 1~8명을 작성해 주세요.".into());
    }
    let mut flags = BTreeSet::new();
    for flag in &extras.story_flags {
        if !id(&flag.id) || !flags.insert(flag.id.as_str()) {
            return Err("이야기 flag ID가 중복되거나 올바르지 않아요.".into());
        }
    }
    let check_flags = |values: &[String]| -> Result<()> {
        let mut seen = BTreeSet::new();
        if values
            .iter()
            .any(|value| !flags.contains(value.as_str()) || !seen.insert(value))
        {
            return Err("팩에 선언하지 않았거나 중복된 flag예요.".into());
        }
        Ok(())
    };
    for definition in definitions {
        validate_character(definition)?;
        if let Some(npc) = &definition.npc {
            check_flags(&npc.required_flags)?;
        }
    }
    let mut items = BTreeSet::new();
    for item in &extras.knowledge {
        if !id(&item.id)
            || !items.insert(&item.id)
            || item.text.trim().is_empty()
            || item.keywords.is_empty()
            || !keywords(&item.keywords)
            || item.known_by.is_empty()
            || item
                .known_by
                .iter()
                .any(|source| !sources.contains_key(source.as_str()))
        {
            return Err("조건부 지식의 ID·키워드·본문·인물을 확인해 주세요.".into());
        }
        check_flags(&item.required_flags)?;
    }
    if extras
        .scenarios
        .iter()
        .filter(|scene| scene.purpose == ScenarioPurpose::Tutorial)
        .count()
        > 1
    {
        return Err("튜토리얼 이야기는 팩당 하나만 만들 수 있어요.".into());
    }
    let mut scenes = BTreeSet::new();
    for scene in &extras.scenarios {
        if !id(&scene.id)
            || !scenes.insert(&scene.id)
            || scene.title.trim().is_empty()
            || scene.title.chars().count() > 80
            || !sources.contains_key(scene.center_id.as_str())
            || sources
                .get(scene.center_id.as_str())
                .is_some_and(|actor| actor.presence_role != PresenceRole::Resident)
            || scene.participants.is_empty()
            || scene.participants.len() > 8
            || !scene.participants.contains(&scene.center_id)
            || scene.participants.iter().collect::<BTreeSet<_>>().len() != scene.participants.len()
            || scene
                .participants
                .iter()
                .any(|source| !sources.contains_key(source.as_str()))
            || !(0..=100).contains(&scene.min_affinity)
            || scene
                .reveal_affinity
                .is_some_and(|value| !(0..=scene.min_affinity).contains(&value))
        {
            return Err("이야기 ID·중심 인물·참가자를 확인해 주세요.".into());
        }
        let is_scene = scene.chapters.is_some();
        if is_scene
            && (scene.reveal_affinity.is_some()
                || !scene.defer.is_empty()
                || !scene.intro.is_empty()
                || !scene.accept.is_empty()
                || !scene.decline.is_empty()
                || !scene.ending.is_empty()
                || !scene.accept_keywords.is_empty()
                || !scene.decline_keywords.is_empty()
                || !scene.proceed_keywords.is_empty()
                || !scene.cancel_keywords.is_empty()
                || scene.accept_next_id.is_some()
                || scene.decline_next_id.is_some())
        {
            return Err("장면형에는 제안형 단계를 사용할 수 없어요.".into());
        }
        if is_scene {
            validate_chapters(scene, &sources)?;
        }
        for values in [
            &scene.keywords,
            &scene.accept_keywords,
            &scene.decline_keywords,
            &scene.proceed_keywords,
            &scene.cancel_keywords,
        ] {
            if !keywords(values) {
                return Err("이야기 입력 표현을 확인해 주세요.".into());
            }
        }
        if !is_scene {
            for (lines, min, max) in [
                (&scene.intro, 1, 32),
                (&scene.accept, 1, 32),
                (&scene.decline, 1, 32),
                (&scene.ending, 1, 32),
                (&scene.defer, 0, 8),
            ] {
                if !(min..=max).contains(&lines.len()) {
                    return Err("이야기 단계는 1~32줄, 유보 대사는 8줄까지 작성해 주세요.".into());
                }
                for line in lines {
                    let actor = sources
                        .get(line.persona.as_str())
                        .ok_or("이야기에 없는 화자예요.")?;
                    if !scene.participants.contains(&line.persona)
                        || !actor.expressions.contains_key(&line.expression)
                        || line.text.trim().is_empty()
                        || line.text.chars().count() > 500
                    {
                        return Err("이야기 대사의 참가자·표정·본문을 확인해 주세요.".into());
                    }
                    crate::characters::reactions::validate_motion(&line.motion, actor, false)?;
                }
            }
            let entry_count = scene
                .participants
                .iter()
                .filter_map(|source| sources.get(source.as_str()))
                .filter(|actor| actor.presence_role == PresenceRole::Npc)
                .filter_map(|actor| actor.npc.as_ref())
                .map(|npc| npc.entry_lines.len())
                .sum::<usize>();
            if scene.intro.len() + entry_count > 32 {
                return Err("입장 대사를 포함한 이야기 단계는 32줄까지 작성해 주세요.".into());
            }
        }
        check_flags(&scene.required_flags)?;
        check_flags(&scene.completion.set_flags)?;
        if scene
            .completion
            .memory_template
            .as_ref()
            .is_some_and(|template| {
                template
                    .replace("{scenarioTitle}", &scene.title)
                    .chars()
                    .count()
                    > 500
            })
            || (is_scene
                && serde_json::to_vec(scene).map_or(true, |bytes| bytes.len() > 128 * 1024))
            || [
                &scene.intro,
                &scene.accept,
                &scene.decline,
                &scene.ending,
                &scene.defer,
            ]
            .into_iter()
            .any(|lines| serde_json::to_vec(lines).map_or(true, |bytes| bytes.len() > 128 * 1024))
        {
            return Err("기억 문구는 펼친 뒤 500자, 단계 근거는 128 KiB 이하여야 해요.".into());
        }
    }
    for scene in &extras.scenarios {
        for next in [&scene.accept_next_id, &scene.decline_next_id]
            .into_iter()
            .flatten()
        {
            if !scenes.contains(next) {
                return Err("연결할 다음 이야기 ID를 확인해 주세요.".into());
            }
        }
    }
    Ok(())
}

pub(crate) fn initialize(db: &Connection) -> Result<()> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS pack_story_inputs(user_id TEXT NOT NULL,input_id TEXT NOT NULL,turn INTEGER NOT NULL,PRIMARY KEY(user_id,input_id)); CREATE TABLE IF NOT EXISTS pack_story_plans(input_id TEXT PRIMARY KEY,user_id TEXT NOT NULL,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS pack_story_progress(scope TEXT PRIMARY KEY,wait_turn INTEGER NOT NULL DEFAULT 0,flags TEXT NOT NULL DEFAULT '[]'); CREATE TABLE IF NOT EXISTS pack_story_outcomes(run_id TEXT NOT NULL,kind TEXT NOT NULL,scope TEXT NOT NULL,scenario_id TEXT NOT NULL,input_id TEXT NOT NULL,evidence TEXT NOT NULL,PRIMARY KEY(run_id,kind));").map_err(|e| e.to_string())?;
    resume::initialize(db)?;
    recover_interrupted(db)
}
fn transaction<T>(db: &Connection, f: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
    if !db.is_autocommit() {
        return f(db);
    }
    let tx = db.unchecked_transaction().map_err(|e| e.to_string())?;
    let result = f(&tx)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(result)
}
fn scope_key(scope: &Scope) -> Result<String> {
    serde_json::to_string(scope).map_err(|e| e.to_string())
}
pub fn count_input(db: &Connection, input_id: &str) -> Result<u64> {
    uuid::Uuid::parse_str(input_id).map_err(|_| "이야기 입력 ID를 확인해 주세요.".to_string())?;
    let user = crate::store::active_user_id(db)?;
    transaction(db, |tx| {
        let next: u64 = tx
            .query_row(
                "SELECT COALESCE(MAX(turn),0)+1 FROM pack_story_inputs WHERE user_id=?1",
                [&user],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT OR IGNORE INTO pack_story_inputs VALUES(?1,?2,?3)",
            params![user, input_id, next],
        )
        .map_err(|e| e.to_string())?;
        tx.query_row(
            "SELECT turn FROM pack_story_inputs WHERE user_id=?1 AND input_id=?2",
            params![user, input_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())
    })
}
pub fn load_plan(db: &Connection, input_id: &str) -> Result<Option<Plan>> {
    use rusqlite::OptionalExtension;
    let data: Option<String> = db
        .query_row(
            "SELECT data FROM pack_story_plans WHERE input_id=?1 AND user_id=?2",
            params![input_id, crate::store::active_user_id(db)?],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some(value) = data else {
        return Ok(None);
    };
    let mut plan: Plan = serde_json::from_str(&value).map_err(|e| e.to_string())?;
    if plan.run.stage == Stage::Chapter {
        if plan.source == "expired-chapter" {
            return Err("지난 장면형 이야기는 재시도할 수 없어요. 새로 시작해 주세요.".into());
        }
        let started: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM pack_story_outcomes WHERE run_id=?1 AND kind='accepted')", [&plan.run_id], |row| row.get(0)).map_err(|e| e.to_string())?;
        if started {
            return Err("지난 장면형 이야기는 재시도할 수 없어요. 새로 시작해 주세요.".into());
        }
    }
    plan.retry = true;
    Ok(Some(plan))
}
pub fn cancel(runtime: &mut Runtime) -> Vec<String> {
    runtime.pending_next = None;
    runtime.interaction = None;
    runtime
        .run
        .take()
        .map(|run| run.participants)
        .unwrap_or_default()
}

fn current_turn(db: &Connection, user: &str) -> Result<u64> {
    db.query_row(
        "SELECT COALESCE(MAX(turn),0) FROM pack_story_inputs WHERE user_id=?1",
        [user],
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}
fn progress(db: &Connection, scope: &Scope) -> Result<(u64, BTreeSet<String>)> {
    use rusqlite::OptionalExtension;
    let value: Option<(u64, String)> = db
        .query_row(
            "SELECT wait_turn,flags FROM pack_story_progress WHERE scope=?1",
            [scope_key(scope)?],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    value
        .map(|(turn, flags)| {
            serde_json::from_str(&flags)
                .map(|flags| (turn, flags))
                .map_err(|e| e.to_string())
        })
        .unwrap_or(Ok((0, BTreeSet::new())))
}
fn story_affinity(db: &Connection, center: &str) -> Result<i32> {
    Ok(crate::store::relationships(db)?
        .into_iter()
        .find(|relation| relation.persona == center)
        .map_or(20, |relation| relation.score))
}
pub fn current(db: &Connection, run: &RunTicket) -> Result<bool> {
    if crate::store::active_user_id(db)? != run.scope.user_id
        || crate::characters::pack_definition_baseline(db, &run.scope.pack_id)
            .ok()
            .as_deref()
            != Some(run.pack_baseline.as_str())
    {
        return Ok(false);
    }
    for (id, baseline) in &run.definition_baselines {
        if crate::characters::character_definition_baseline(db, id)
            .ok()
            .as_deref()
            != Some(baseline.as_str())
        {
            return Ok(false);
        }
    }
    let residents = crate::characters::active_ids(db)?;
    for id in run
        .participants
        .iter()
        .chain(std::iter::once(&run.scope.center_id))
    {
        if crate::characters::get(db, id)?.definition.presence_role == PresenceRole::Resident
            && !residents.contains(id)
        {
            return Ok(false);
        }
    }
    Ok(true)
}
fn lines_for(stage: Stage, definition: &ScenarioDefinition) -> &[SceneLine] {
    match stage {
        Stage::Intro => &definition.intro,
        Stage::Defer => &definition.defer,
        Stage::Accept => &definition.accept,
        Stage::Decline => &definition.decline,
        _ => &definition.ending,
    }
}
fn defer_lines(definition: &ScenarioDefinition) -> Vec<SceneLine> {
    if !definition.defer.is_empty() {
        return definition.defer.clone();
    }
    vec![SceneLine {
        persona: definition.center_id.clone(),
        expression: crate::characters::DEFAULT_EXPRESSION.into(),
        text: "그 얘기는… 조금 더 친해지면 들려줄게요.".into(),
        widget: None,
        motion: Default::default(),
    }]
}
fn exact(values: &[String], input: &str) -> bool {
    values
        .iter()
        .any(|value| value.trim().eq_ignore_ascii_case(input.trim()))
}
fn decision(run: &RunTicket, input: &str) -> Option<Stage> {
    let definition = run.definition.as_ref()?;
    if exact(&definition.cancel_keywords, input) {
        return None;
    }
    if !run.ready {
        return None;
    }
    match run.stage {
        Stage::Intro if exact(&definition.accept_keywords, input) => Some(Stage::Accept),
        Stage::Intro if exact(&definition.decline_keywords, input) => Some(Stage::Decline),
        Stage::Accept if exact(&definition.proceed_keywords, input) => Some(Stage::Ending),
        _ => None,
    }
}
fn make_plan(
    db: &Connection,
    context: &InputContext,
    scope: Scope,
    definition: Option<ScenarioDefinition>,
    phase: (Stage, u64),
    run_id: String,
    entry_id: Option<&str>,
) -> Result<Plan> {
    let (stage, generation) = phase;
    let snapshot = crate::characters::get_pack_story_definition(db, &scope.pack_id)?;
    let (participants, mut lines) = if let Some(definition) = &definition {
        let participants = definition
            .participants
            .iter()
            .map(|source| {
                snapshot
                    .source_to_local
                    .get(source)
                    .cloned()
                    .ok_or("이야기 참가자가 설치되어 있지 않아요.".to_string())
            })
            .collect::<Result<Vec<_>>>()?;
        let source_lines = if stage == Stage::Chapter {
            Vec::new()
        } else if stage == Stage::Defer {
            defer_lines(definition)
        } else {
            lines_for(stage, definition).to_vec()
        };
        let lines = source_lines
            .iter()
            .map(|line| {
                Ok(SceneLine {
                    persona: snapshot
                        .source_to_local
                        .get(&line.persona)
                        .cloned()
                        .ok_or("이야기 화자가 설치되어 있지 않아요.")?,
                    ..line.clone()
                })
            })
            .collect::<Result<Vec<_>>>()?;
        (participants, lines)
    } else {
        let id = entry_id.unwrap_or(&scope.center_id).to_string();
        let character = crate::characters::get(db, &id)?;
        let entry = character
            .definition
            .npc
            .as_ref()
            .map(|npc| npc.entry_lines.as_slice())
            .filter(|lines| !lines.is_empty())
            .unwrap_or(&character.definition.greeting);
        (
            vec![id.clone()],
            entry
                .iter()
                .map(|line| SceneLine {
                    persona: id.clone(),
                    expression: line.expression.clone(),
                    text: line.text.clone(),
                    widget: None,
                    motion: line.motion.clone(),
                })
                .collect(),
        )
    };
    let guests = participants
        .iter()
        .filter_map(|id| {
            crate::characters::get(db, id)
                .ok()
                .filter(|item| item.definition.presence_role == PresenceRole::Npc)
                .map(|_| id.clone())
        })
        .collect::<Vec<_>>();
    if stage == Stage::Intro {
        let mut entry = Vec::new();
        for id in &guests {
            let actor = crate::characters::get(db, id)?;
            if let Some(npc) = &actor.definition.npc {
                entry.extend(npc.entry_lines.iter().map(|line| SceneLine {
                    persona: id.clone(),
                    expression: line.expression.clone(),
                    text: line.text.clone(),
                    widget: None,
                    motion: line.motion.clone(),
                }));
            }
        }
        entry.append(&mut lines);
        lines = entry;
    }
    if lines.len() > 32 {
        return Err("입장 대사를 포함한 이야기 단계는 32줄까지 재생할 수 있어요.".into());
    }
    let mut baselines = BTreeMap::new();
    for id in participants.iter().chain(std::iter::once(&scope.center_id)) {
        baselines.insert(
            id.clone(),
            crate::characters::character_definition_baseline(db, id)?,
        );
    }
    let run = RunTicket {
        run_id: run_id.clone(),
        input_id: context.input_id.clone(),
        scope,
        scenario_id: definition.as_ref().map(|d| d.id.clone()),
        stage,
        chapter_id: None,
        step: 0,
        phase_generation: generation,
        epoch: context.epoch,
        participants,
        pack_baseline: snapshot.baseline,
        definition_baselines: baselines,
        last_playback_id: format!(
            "scene:{}:{}",
            context.input_id,
            lines.len().saturating_sub(1)
        ),
        definition,
        ready: false,
    };
    Ok(Plan {
        replaced_run_id: None,
        input_id: context.input_id.clone(),
        run_id,
        source: if stage == Stage::Entry {
            "npc"
        } else {
            "scenario"
        }
        .into(),
        lines,
        required_guest_ids: guests,
        run,
        retry: false,
    })
}

pub(crate) fn scene_plan(
    db: &Connection,
    context: &InputContext,
    scope: Scope,
    definition: ScenarioDefinition,
    chapter_id: Option<&str>,
) -> Result<Plan> {
    if crate::store::current_user(db)?.is_none()
        || context.user_id != crate::store::active_user_id(db)?
    {
        return Err("이야기를 시작하려면 이름을 먼저 등록해 주세요.".into());
    }
    let chapters = definition
        .chapters
        .as_ref()
        .ok_or("장면형 이야기가 아니에요.")?;
    let chapter = chapter_id
        .and_then(|id| chapters.iter().find(|chapter| chapter.id == id))
        .or_else(|| chapters.first())
        .ok_or("이야기의 첫 장을 찾을 수 없어요.")?;
    let chapter_id = chapter.id.clone();
    let source = if definition.purpose == ScenarioPurpose::Tutorial {
        "tutorial"
    } else {
        "scenario"
    };
    let mut plan = make_plan(
        db,
        context,
        scope,
        Some(definition),
        (Stage::Chapter, 1),
        uuid::Uuid::new_v4().to_string(),
        None,
    )?;
    plan.run.chapter_id = Some(chapter_id);
    plan.source = source.into();
    Ok(plan)
}
fn save_plan(db: &Connection, plan: &Plan) -> Result<()> {
    transaction(db, |tx| {
        tx.execute(
            "INSERT OR IGNORE INTO pack_story_plans VALUES(?1,?2,?3)",
            params![
                plan.input_id,
                plan.run.scope.user_id,
                serde_json::to_string(plan).map_err(|e| e.to_string())?
            ],
        )
        .map_err(|e| e.to_string())?;
        if matches!(plan.run.stage, Stage::Accept | Stage::Decline) {
            let kind = if plan.run.stage == Stage::Accept {
                "accepted"
            } else {
                "declined"
            };
            tx.execute(
                "INSERT OR IGNORE INTO pack_story_outcomes VALUES(?1,?2,?3,?4,?5,?6)",
                params![
                    plan.run_id,
                    kind,
                    scope_key(&plan.run.scope)?,
                    plan.run.scenario_id,
                    plan.input_id,
                    serde_json::to_string(&plan.lines).map_err(|e| e.to_string())?
                ],
            )
            .map_err(|e| e.to_string())?;
        }
        crate::store::save_reply_scene_with_source(tx, &plan.input_id, &plan.lines, &plan.source)
    })
}
pub fn select(
    db: &Connection,
    runtime: &Runtime,
    context: &InputContext,
    content: &str,
) -> Result<Option<Plan>> {
    if context.user_id != crate::store::active_user_id(db)? {
        return Err("이야기 사용자가 바뀌었어요.".into());
    }
    if let Some(plan) = load_plan(db, &context.input_id)? {
        return Ok(Some(plan));
    }
    let turn = count_input(db, &context.input_id)?;
    if let Some(run) = &runtime.run {
        if !current(db, run)?
            || !context
                .targets
                .iter()
                .any(|target| target == &run.scope.center_id || run.participants.contains(target))
        {
            return Ok(None);
        }
        if let Some(stage) = decision(run, content) {
            let plan = make_plan(
                db,
                context,
                run.scope.clone(),
                run.definition.clone(),
                (stage, run.phase_generation + 1),
                run.run_id.clone(),
                None,
            )?;
            save_plan(db, &plan)?;
            return Ok(Some(plan));
        }
        if run.stage != Stage::Entry || !run.ready {
            return Ok(None);
        }
    }
    for center in &context.targets {
        let actor = crate::characters::get(db, center)?;
        if actor.definition.presence_role != PresenceRole::Resident
            || !crate::characters::active_ids(db)?.contains(center)
        {
            continue;
        }
        let Some(pack_id) = actor.pack_id else {
            continue;
        };
        let snapshot = crate::characters::get_pack_story_definition(db, &pack_id)?;
        let scope = Scope {
            user_id: context.user_id.clone(),
            pack_id,
            center_id: center.clone(),
        };
        let (wait, flags) = progress(db, &scope)?;
        let mut candidates = snapshot.definition.scenarios.iter().collect::<Vec<_>>();
        if let Some((pending_scope, next)) = &runtime.pending_next {
            if *pending_scope == scope {
                if let Some(index) = candidates.iter().position(|scenario| scenario.id == *next) {
                    let preferred = candidates.remove(index);
                    candidates.insert(0, preferred);
                }
            }
        }
        for definition in candidates {
            if definition.chapters.is_some() {
                let flags_allowed = flags_match(&definition.required_flags, &flags)
                    && !definition
                        .participants
                        .iter()
                        .filter_map(|source| snapshot.source_to_local.get(source))
                        .filter_map(|id| crate::characters::get(db, id).ok())
                        .filter_map(|actor| actor.definition.npc)
                        .any(|npc| !flags_match(&npc.required_flags, &flags));
                if runtime.run.is_none()
                    && snapshot.source_to_local.get(&definition.center_id) == Some(center)
                    && !definition.keywords.is_empty()
                    && matches_keywords(&definition.keywords, content)
                    && crate::store::current_user(db)?.is_some()
                    && flags_allowed
                {
                    if definition.purpose.is_story()
                        && (turn < wait || story_affinity(db, center)? < definition.min_affinity)
                    {
                        continue;
                    }
                    let completed: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM pack_story_outcomes WHERE scope=?1 AND scenario_id=?2 AND kind='completed')", params![scope_key(&scope)?, definition.id], |row| row.get(0)).map_err(|error| error.to_string())?;
                    let incomplete: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM pack_story_outcomes o WHERE scope=?1 AND scenario_id=?2 AND kind IN ('accepted','cancelled') AND NOT EXISTS(SELECT 1 FROM pack_story_outcomes terminal WHERE terminal.run_id=o.run_id AND terminal.kind IN ('completed','declined')))", params![scope_key(&scope)?, definition.id], |row| row.get(0)).map_err(|error| error.to_string())?;
                    if !repeat_allowed(definition, completed, incomplete) {
                        continue;
                    }
                    let plan = scene_plan(db, context, scope.clone(), definition.clone(), None)?;
                    save_plan(db, &plan)?;
                    return Ok(Some(plan));
                }
                continue;
            }
            if turn < wait {
                continue;
            }
            if snapshot.source_to_local.get(&definition.center_id) != Some(center)
                || !definition.keywords.is_empty()
                    && !matches_keywords(&definition.keywords, content)
                || !flags_match(&definition.required_flags, &flags)
                || definition
                    .participants
                    .iter()
                    .filter_map(|source| snapshot.source_to_local.get(source))
                    .filter_map(|id| crate::characters::get(db, id).ok())
                    .filter_map(|actor| actor.definition.npc)
                    .any(|npc| !flags_match(&npc.required_flags, &flags))
            {
                continue;
            }
            let completed:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM pack_story_outcomes WHERE scope=?1 AND scenario_id=?2 AND kind='completed')",params![scope_key(&scope)?,definition.id],|r|r.get(0)).map_err(|e|e.to_string())?;
            let incomplete:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM pack_story_outcomes o WHERE scope=?1 AND scenario_id=?2 AND kind IN ('accepted','cancelled') AND NOT EXISTS(SELECT 1 FROM pack_story_outcomes terminal WHERE terminal.run_id=o.run_id AND terminal.kind IN ('completed','declined')))",params![scope_key(&scope)?,definition.id],|r|r.get(0)).map_err(|e|e.to_string())?;
            if !repeat_allowed(definition, completed, incomplete) {
                continue;
            }
            let score = story_affinity(db, center)?;
            let stage = if score >= definition.min_affinity {
                Stage::Intro
            } else if definition
                .reveal_affinity
                .is_some_and(|reveal| score >= reveal)
            {
                let today = chrono::Local::now().format("%Y-%m-%d").to_string();
                let already_deferred: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM pack_story_outcomes WHERE scope=?1 AND scenario_id=?2 AND kind='deferred' AND evidence=?3)", params![scope_key(&scope)?, definition.id, today], |row| row.get(0)).map_err(|e| e.to_string())?;
                if already_deferred {
                    continue;
                }
                Stage::Defer
            } else {
                continue;
            };
            let mut plan = make_plan(
                db,
                context,
                scope.clone(),
                Some(definition.clone()),
                (stage, 1),
                uuid::Uuid::new_v4().to_string(),
                None,
            )?;
            plan.replaced_run_id = runtime.run.as_ref().map(|run| run.run_id.clone());
            save_plan(db, &plan)?;
            return Ok(Some(plan));
        }
    }
    for actor in crate::characters::collection(db)?.installed {
        if actor.definition.presence_role != PresenceRole::Npc {
            continue;
        }
        let Some(npc) = &actor.definition.npc else {
            continue;
        };
        if runtime
            .run
            .as_ref()
            .is_some_and(|run| run.stage == Stage::Entry && run.participants.contains(&actor.id))
        {
            continue;
        }
        if !matches_keywords(&npc.invite_keywords, content)
            && !matches_keywords(&npc.appearance_keywords, content)
        {
            continue;
        }
        let Some(pack_id) = actor.pack_id else {
            continue;
        };
        let npc_only = crate::characters::npc_only_pack(db, &pack_id)?;
        let Some(center_id) = context.targets.iter().find(|id| {
            crate::characters::get(db, id).is_ok_and(|actor| {
                actor.definition.presence_role == PresenceRole::Resident
                    && (actor.pack_id.as_deref() == Some(pack_id.as_str()) || npc_only)
            }) && crate::characters::active_ids(db).is_ok_and(|ids| ids.contains(id))
        }) else {
            continue;
        };
        let scope = Scope {
            user_id: context.user_id.clone(),
            pack_id,
            center_id: center_id.clone(),
        };
        let (wait, flags) = progress(db, &scope)?;
        if turn < wait {
            continue;
        }
        if !flags_match(&npc.required_flags, &flags) {
            continue;
        }
        let mut plan = make_plan(
            db,
            context,
            scope,
            None,
            (Stage::Entry, 1),
            uuid::Uuid::new_v4().to_string(),
            Some(&actor.id),
        )?;
        plan.replaced_run_id = runtime.run.as_ref().map(|run| run.run_id.clone());
        save_plan(db, &plan)?;
        return Ok(Some(plan));
    }
    Ok(None)
}
pub fn bind_plan(runtime: &mut Runtime, plan: &Plan, new_epoch: u64) -> Result<RunTicket> {
    if plan.retry
        && runtime.run.as_ref().is_none_or(|run| {
            run.run_id != plan.run_id || run.phase_generation != plan.run.phase_generation
        })
    {
        return Err(
            "취소되거나 지나간 이야기 실행이에요. 새 입력으로 다시 이야기해 주세요.".into(),
        );
    }
    if !plan.retry && matches!(plan.run.stage, Stage::Intro | Stage::Defer | Stage::Entry) {
        runtime.pending_next = None;
    }
    let ready = plan.retry && runtime.run.as_ref().is_some_and(|run| run.ready);
    let mut ticket = plan.run.clone();
    ticket.epoch = new_epoch;
    ticket.ready = ready;
    runtime.run = Some(ticket.clone());
    Ok(ticket)
}
pub fn retain_run(
    runtime: &mut Runtime,
    existing: &RunTicket,
    new_epoch: u64,
) -> Result<RunTicket> {
    if !existing.ready
        || runtime.run.as_ref().is_none_or(|run| {
            run.run_id != existing.run_id
                || run.phase_generation != existing.phase_generation
                || run.epoch != existing.epoch
        })
    {
        return Err("취소되거나 표시를 끝내지 못한 이야기예요.".into());
    }
    let mut ticket = existing.clone();
    ticket.epoch = new_epoch;
    runtime.run = Some(ticket.clone());
    Ok(ticket)
}
fn apply_completion_effects(db: &Connection, ticket: &RunTicket, now: i64) -> Result<()> {
    let definition = ticket
        .definition
        .as_ref()
        .ok_or("이야기 정의를 찾을 수 없어요.")?;
    let (_, mut flags) = progress(db, &ticket.scope)?;
    flags.extend(definition.completion.set_flags.iter().cloned());
    db.execute("INSERT INTO pack_story_progress VALUES(?1,?2,?3) ON CONFLICT(scope) DO UPDATE SET wait_turn=excluded.wait_turn,flags=excluded.flags",params![scope_key(&ticket.scope)?,current_turn(db,&ticket.scope.user_id)?+3,serde_json::to_string(&flags).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
    if let Some(template) = &definition.completion.memory_template {
        let text = template.replace("{scenarioTitle}", &definition.title);
        crate::store::insert_moment(
            db,
            &ticket.scope.center_id,
            &ticket.scope.user_id,
            "story-complete",
            &text,
            now,
            ticket.scenario_id.as_deref(),
            serde_json::json!({"scenarioId":ticket.scenario_id}),
            None,
            None,
        )?;
    }
    Ok(())
}
pub fn display_finished(
    db: &Connection,
    runtime: &mut Runtime,
    ticket: &RunTicket,
    proof: &DisplayProof,
) -> Result<Finish> {
    if runtime.run.as_ref().is_none_or(|run| {
        run.run_id != ticket.run_id
            || run.phase_generation != ticket.phase_generation
            || run.epoch != ticket.epoch
    }) || proof.playback_id != ticket.last_playback_id
        || proof.input_id != ticket.input_id
        || proof.epoch != ticket.epoch
        || proof.participants != ticket.participants
        || proof.pack_baseline != ticket.pack_baseline
        || proof
            .display_started_at
            .is_none_or(|start| start <= 0 || proof.ends_at < start)
        || proof.now < proof.ends_at
        || !current(db, ticket)?
        || crate::widgets::storage::focus_active(db, proof.now)?
    {
        return Ok(Finish::default());
    }
    let start = proof.display_started_at.unwrap();
    let Some((line, source)) = crate::store::saved_reply_for_participants(
        db,
        &proof.playback_id,
        Some(&ticket.participants),
    )?
    else {
        return Ok(Finish::default());
    };
    let actor = crate::characters::get(db, &line.persona)?;
    if !matches!(source.as_str(), "scenario" | "npc" | "tutorial")
        || proof.ends_at
            < start.saturating_add(crate::playback::line_duration_millis(
                &line.text,
                actor.definition.balloon_style.text_speed,
            ))
    {
        return Ok(Finish::default());
    }
    let entry_ends = ticket.stage == Stage::Entry
        && ticket.participants.iter().any(|id| {
            crate::characters::get(db, id)
                .ok()
                .and_then(|actor| actor.definition.npc)
                .is_some_and(|npc| npc.exit_policy == NpcExitPolicy::SceneEnd)
        });
    transaction(db, |tx| {
        crate::store::mark_message_finished(
            tx,
            &proof.playback_id,
            start,
            proof.ends_at,
            proof.now,
        )?;
        if ticket.stage == Stage::Ending {
            let inserted = tx
                .execute(
                    "INSERT OR IGNORE INTO pack_story_outcomes VALUES(?1,'completed',?2,?3,?4,?5)",
                    params![
                        ticket.run_id,
                        scope_key(&ticket.scope)?,
                        ticket.scenario_id,
                        ticket.input_id,
                        serde_json::to_string(proof.playback_id.as_str())
                            .map_err(|e| e.to_string())?
                    ],
                )
                .map_err(|e| e.to_string())?;
            if inserted > 0 {
                apply_completion_effects(tx, ticket, proof.now)?;
            }
        } else if entry_ends {
            tx.execute(
                "INSERT OR IGNORE INTO pack_story_outcomes VALUES(?1,'entry-finished',?2,'',?3,?4)",
                params![
                    ticket.run_id,
                    scope_key(&ticket.scope)?,
                    ticket.input_id,
                    proof.playback_id
                ],
            )
            .map_err(|e| e.to_string())?;
        } else if ticket.stage == Stage::Defer {
            let date = chrono::DateTime::from_timestamp_millis(proof.now)
                .ok_or("이야기 표시 시각을 확인해 주세요.")?
                .with_timezone(&chrono::Local)
                .format("%Y-%m-%d")
                .to_string();
            let inserted = tx
                .execute(
                    "INSERT OR IGNORE INTO pack_story_outcomes VALUES(?1,'deferred',?2,?3,?4,?5)",
                    params![
                        ticket.run_id,
                        scope_key(&ticket.scope)?,
                        ticket.scenario_id,
                        ticket.input_id,
                        date
                    ],
                )
                .map_err(|e| e.to_string())?;
            if inserted > 0 {
                let (_, flags) = progress(tx, &ticket.scope)?;
                tx.execute("INSERT INTO pack_story_progress VALUES(?1,?2,?3) ON CONFLICT(scope) DO UPDATE SET wait_turn=excluded.wait_turn",params![scope_key(&ticket.scope)?,current_turn(tx,&ticket.scope.user_id)?+3,serde_json::to_string(&flags).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
            }
        } else if ticket.stage == Stage::Decline {
            let (_, flags) = progress(tx, &ticket.scope)?;
            tx.execute("INSERT INTO pack_story_progress VALUES(?1,?2,?3) ON CONFLICT(scope) DO UPDATE SET wait_turn=excluded.wait_turn",params![scope_key(&ticket.scope)?,current_turn(tx,&ticket.scope.user_id)?+3,serde_json::to_string(&flags).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
        }
        Ok(())
    })?;
    if entry_ends {
        runtime.run = None;
        return Ok(Finish {
            #[cfg(test)]
            completed: false,
            guest_ids: ticket.participants.clone(),
        });
    }
    if matches!(ticket.stage, Stage::Ending | Stage::Decline | Stage::Defer) {
        if ticket.stage != Stage::Defer {
            if let Some(definition) = &ticket.definition {
                runtime.pending_next = if ticket.stage == Stage::Ending {
                    definition.accept_next_id.clone()
                } else {
                    definition.decline_next_id.clone()
                }
                .map(|next| (ticket.scope.clone(), next));
            }
        }
        runtime.run = None;
        Ok(Finish {
            #[cfg(test)]
            completed: ticket.stage == Stage::Ending,
            guest_ids: ticket.participants.clone(),
        })
    } else {
        if let Some(run) = &mut runtime.run {
            run.ready = true;
        }
        Ok(Finish::default())
    }
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrialStep {
    pub stage: Stage,
    pub lines: Vec<SceneLine>,
    pub planned_effects: CompletionEffects,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrialTrace {
    pub steps: Vec<TrialStep>,
}
pub fn trial(
    definitions: &[CharacterDefinition],
    extras: &PackStoryDefinition,
    scenario_id: &str,
    flags: &[String],
    affinity: i32,
    inputs: &[String],
) -> Result<TrialTrace> {
    validate_pack(definitions, extras)?;
    if !(0..=100).contains(&affinity)
        || inputs.len() > 32
        || inputs.iter().any(|input| input.chars().count() > 500)
        || flags.iter().collect::<BTreeSet<_>>().len() != flags.len()
        || flags.iter().any(|flag| {
            !extras
                .story_flags
                .iter()
                .any(|declared| declared.id == *flag)
        })
    {
        return Err("시험의 flags·친밀도·입력 범위를 확인해 주세요.".into());
    }
    let definition = extras
        .scenarios
        .iter()
        .find(|scenario| scenario.id == scenario_id)
        .ok_or("시험할 이야기를 찾을 수 없어요.")?;
    if definition.chapters.is_some() {
        return Err("아직 시험할 수 없어요.".into());
    }
    if definition
        .required_flags
        .iter()
        .any(|flag| !flags.contains(flag))
    {
        return Ok(TrialTrace { steps: vec![] });
    }
    if affinity < definition.min_affinity {
        return Ok(TrialTrace {
            steps: if definition
                .reveal_affinity
                .is_some_and(|reveal| affinity >= reveal)
            {
                vec![TrialStep {
                    stage: Stage::Defer,
                    lines: defer_lines(definition),
                    planned_effects: CompletionEffects::default(),
                }]
            } else {
                vec![]
            },
        });
    }
    let mut run = RunTicket {
        run_id: "trial".into(),
        input_id: "trial".into(),
        scope: Scope {
            user_id: "trial".into(),
            pack_id: "trial".into(),
            center_id: definition.center_id.clone(),
        },
        scenario_id: Some(definition.id.clone()),
        stage: Stage::Intro,
        chapter_id: None,
        step: 0,
        phase_generation: 1,
        epoch: 0,
        participants: definition.participants.clone(),
        pack_baseline: "trial".into(),
        definition_baselines: BTreeMap::new(),
        last_playback_id: "trial".into(),
        definition: Some(definition.clone()),
        ready: true,
    };
    let mut steps = vec![TrialStep {
        stage: Stage::Intro,
        lines: definition.intro.clone(),
        planned_effects: CompletionEffects::default(),
    }];
    for input in inputs {
        if exact(&definition.cancel_keywords, input) {
            break;
        }
        let Some(stage) = decision(&run, input) else {
            continue;
        };
        run.stage = stage;
        run.phase_generation += 1;
        steps.push(TrialStep {
            stage,
            lines: lines_for(stage, definition).to_vec(),
            planned_effects: if stage == Stage::Ending {
                definition.completion.clone()
            } else {
                CompletionEffects::default()
            },
        });
        if matches!(stage, Stage::Ending | Stage::Decline) {
            break;
        }
    }
    Ok(TrialTrace { steps })
}

fn record_cancelled(db: &Connection, run: &RunTicket) -> Result<()> {
    if run.stage == Stage::Defer {
        return Ok(());
    }
    transaction(db, |tx| {
        let inserted = tx
            .execute(
                "INSERT OR IGNORE INTO pack_story_outcomes VALUES(?1,'cancelled',?2,?3,?4,'[]')",
                params![
                    run.run_id,
                    scope_key(&run.scope)?,
                    run.scenario_id.as_deref().unwrap_or(""),
                    run.input_id
                ],
            )
            .map_err(|e| e.to_string())?;
        if inserted > 0
            && (run.stage != Stage::Chapter
                || run
                    .definition
                    .as_ref()
                    .is_some_and(|definition| definition.purpose.is_story()))
        {
            let (_, flags) = progress(tx, &run.scope)?;
            tx.execute("INSERT INTO pack_story_progress VALUES(?1,?2,?3) ON CONFLICT(scope) DO UPDATE SET wait_turn=excluded.wait_turn",params![scope_key(&run.scope)?,current_turn(tx,&run.scope.user_id)?+3,serde_json::to_string(&flags).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
        }
        Ok(())
    })
}
pub fn cancel_with_progress(db: &Connection, runtime: &mut Runtime) -> Result<Vec<String>> {
    flush_cancellations(db, runtime)?;
    if let Some(run) = &runtime.run {
        record_cancelled(db, run)?;
        if !db.is_autocommit() {
            runtime.pending_cancellations.push(run.clone());
        }
    }
    Ok(cancel(runtime))
}
pub fn cancel_deferred(runtime: &mut Runtime) -> Vec<String> {
    if let Some(run) = &runtime.run {
        if !runtime
            .pending_cancellations
            .iter()
            .any(|pending| pending.run_id == run.run_id)
        {
            runtime.pending_cancellations.push(run.clone());
        }
    }
    cancel(runtime)
}
pub fn flush_cancellations(db: &Connection, runtime: &mut Runtime) -> Result<()> {
    let own_transaction = db.is_autocommit();
    transaction(db, |tx| {
        for run in &runtime.pending_cancellations {
            record_cancelled(tx, run)?;
        }
        Ok(())
    })?;
    if own_transaction {
        runtime.pending_cancellations.clear();
    }
    Ok(())
}
pub fn recover_interrupted(db: &Connection) -> Result<()> {
    let mut statement = db
        .prepare("SELECT data FROM pack_story_plans ORDER BY rowid DESC")
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    drop(statement);
    let mut seen = BTreeSet::new();
    for data in rows {
        let mut plan: Plan = serde_json::from_str(&data).map_err(|e| e.to_string())?;
        if plan.run.stage == Stage::Chapter {
            plan.source = "expired-chapter".into();
            db.execute(
                "UPDATE pack_story_plans SET data=?2 WHERE input_id=?1",
                params![
                    plan.input_id,
                    serde_json::to_string(&plan).map_err(|error| error.to_string())?
                ],
            )
            .map_err(|error| error.to_string())?;
        }
        if !seen.insert(plan.run_id.clone()) {
            continue;
        }
        let terminal:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM pack_story_outcomes WHERE run_id=?1 AND kind IN ('completed','declined','cancelled','entry-finished','deferred'))",[&plan.run_id],|row|row.get(0)).map_err(|e|e.to_string())?;
        let accepted: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM pack_story_outcomes WHERE run_id=?1 AND kind='accepted')", [&plan.run_id], |row| row.get(0)).map_err(|error| error.to_string())?;
        if !terminal && (plan.run.stage != Stage::Chapter || accepted) {
            record_cancelled(db, &plan.run)?;
        }
    }
    Ok(())
}

pub fn cancellation_requested(runtime: &Runtime, content: &str) -> bool {
    runtime.run.as_ref().is_some_and(|run| {
        if run.stage == Stage::Entry && run.definition.is_none() {
            ["그만", "다른 이야기", "화제 바꾸자"]
                .iter()
                .any(|value| value.eq_ignore_ascii_case(content.trim()))
        } else {
            run.definition
                .as_ref()
                .is_some_and(|definition| exact(&definition.cancel_keywords, content))
        }
    })
}

#[cfg(test)]
mod tests;

pub fn progress_flags(db: &Connection, scope: &Scope) -> Result<BTreeSet<String>> {
    if crate::store::active_user_id(db)? != scope.user_id {
        return Err("이야기 사용자가 바뀌었어요.".into());
    }
    progress(db, scope).map(|(_, flags)| flags)
}

pub fn consume_pending_branch(
    db: &Connection,
    runtime: &mut Runtime,
    context: &InputContext,
) -> Result<()> {
    if let Some((scope, _)) = &runtime.pending_next {
        let (wait, _) = progress(db, scope)?;
        if scope.user_id != context.user_id
            || context.targets.contains(&scope.center_id)
                && current_turn(db, &scope.user_id)? >= wait
        {
            runtime.pending_next = None;
        }
    }
    Ok(())
}
