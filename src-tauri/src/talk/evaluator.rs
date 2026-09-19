use super::{
    expr, Candidate, EvalContext, History, Program, Scene, Selection, Simulation, Statement,
    TextPart,
};
use crate::types::SceneLine;
use serde_json::Value;
use std::collections::BTreeMap;

pub fn simulate(program: &Program, context: &EvalContext, history: &History) -> Simulation {
    let mut candidates = Vec::new();
    let mut playable = Vec::new();
    for scene in &program.scenes {
        match eligible(scene, context, history, &context.values) {
            Ok(selection) => {
                candidates.push(Candidate {
                    key: scene.key.clone(),
                    scene_id: scene.id.clone(),
                    eligible: true,
                    reason: "eligible".into(),
                });
                playable.push((scene, selection));
            }
            Err(reason) => candidates.push(Candidate {
                key: scene.key.clone(),
                scene_id: scene.id.clone(),
                eligible: false,
                reason,
            }),
        }
    }
    let has_pair = playable.iter().any(|(scene, _)| scene.pair.is_some());
    playable.retain(|(scene, _)| !has_pair || scene.pair.is_some());
    playable.sort_by(|(left, _), (right, _)| {
        history
            .get(&left.key)
            .copied()
            .unwrap_or(i64::MIN)
            .cmp(&history.get(&right.key).copied().unwrap_or(i64::MIN))
            .then_with(|| rank(&left.key, context.seed).cmp(&rank(&right.key, context.seed)))
            .then_with(|| left.key.cmp(&right.key))
    });
    let selected = playable.into_iter().next().map(|(_, selection)| selection);
    for candidate in &mut candidates {
        if candidate.eligible {
            candidate.reason = if selected
                .as_ref()
                .is_some_and(|selection| selection.key == candidate.key)
            {
                "selected"
            } else {
                "eligible_not_selected"
            }
            .into();
        }
    }
    Simulation {
        candidates,
        selected,
    }
}
pub fn render_scene(program: &Program, key: &str, context: &EvalContext) -> Option<Selection> {
    let scene = program.scenes.iter().find(|scene| scene.key == key)?;
    eligible(scene, context, &History::new(), &context.values).ok()
}

pub fn render_scene_with_text_values(
    program: &Program,
    key: &str,
    context: &EvalContext,
    text_values: &BTreeMap<String, Value>,
) -> Option<Selection> {
    render_scene(program, key, context)?;
    let scene = program.scenes.iter().find(|scene| scene.key == key)?;
    eligible(scene, context, &History::new(), text_values).ok()
}

fn rank(key: &str, seed: u64) -> u64 {
    let mut value = 0xcbf29ce484222325u64 ^ seed;
    for byte in key.bytes() {
        value ^= u64::from(byte);
        value = value.wrapping_mul(0x100000001b3);
    }
    value ^= value >> 30;
    value = value.wrapping_mul(0xbf58476d1ce4e5b9);
    value ^= value >> 27;
    value.wrapping_mul(0x94d049bb133111eb) ^ (value >> 31)
}
fn eligible(
    scene: &Scene,
    context: &EvalContext,
    history: &History,
    text_values: &BTreeMap<String, Value>,
) -> Result<Selection, String> {
    if scene.trigger != context.trigger {
        return Err("trigger_mismatch".into());
    }
    if let Some(pair) = &scene.pair {
        if !pair.iter().all(|id| context.active.contains(id)) {
            return Err("pair_mismatch".into());
        }
    }
    if !scene.dependencies.is_subset(&context.available) {
        return Err("dependency_unavailable".into());
    }
    if let Some(last) = history.get(&scene.key) {
        if context.now_ms.saturating_sub(*last) < scene.cooldown_ms {
            return Err("cooldown".into());
        }
    }
    if let Some(condition) = &scene.condition {
        if !expr::boolean(
            expr::evaluate(condition, &context.values)
                .map_err(|error| format!("condition_error: {error}"))?,
        )
        .map_err(|error| format!("condition_error: {error}"))?
        {
            return Err("condition_false".into());
        }
    }
    let mut lines = Vec::new();
    render(&scene.body, scene, context, text_values, &mut lines)
        .map_err(|error| format!("render_error: {error}"))?;
    if lines.is_empty() || lines.len() > 8 {
        return Err("line_count: 장면은 1~8줄이어야 해요.".into());
    }
    Ok(Selection {
        key: scene.key.clone(),
        scene_id: scene.id.clone(),
        lines,
        dependencies: scene.dependencies.clone(),
        references: scene.references.clone(),
        cooldown_ms: scene.cooldown_ms,
    })
}
fn render(
    body: &[Statement],
    scene: &Scene,
    context: &EvalContext,
    text_values: &BTreeMap<String, Value>,
    lines: &mut Vec<SceneLine>,
) -> Result<(), String> {
    for statement in body {
        match statement {
            Statement::If {
                condition, yes, no, ..
            } => {
                let branch = if expr::boolean(expr::evaluate(condition, &context.values)?)? {
                    yes
                } else {
                    no
                };
                render(branch, scene, context, text_values, lines)?;
            }
            Statement::Line {
                speaker,
                expression,
                parts,
                ..
            } => {
                let mut text = String::new();
                for part in parts {
                    match part {
                        TextPart::Text(value) => text.push_str(value),
                        TextPart::Variable(name) => {
                            let value = text_values
                                .get(name)
                                .ok_or_else(|| format!("변수 값이 없어요: {name}"))?;
                            match value {
                                Value::String(value) => text.push_str(value),
                                Value::Number(_) | Value::Bool(_) => {
                                    text.push_str(&value.to_string())
                                }
                                _ => {
                                    return Err(format!(
                                        "null 또는 구조화된 값은 치환할 수 없어요: {name}"
                                    ))
                                }
                            }
                        }
                    }
                    if text.chars().count() > 500 {
                        return Err("대사는 치환 후 500자 이하여야 해요.".into());
                    }
                }
                if text.trim().is_empty() {
                    return Err("빈 대사는 재생할 수 없어요.".into());
                }
                let mapped = if let Some(pair) = &scene.pair {
                    context
                        .active
                        .iter()
                        .position(|id| {
                            pair.get(*speaker)
                                .is_some_and(|speaker_id| id == speaker_id)
                        })
                        .ok_or("활성 캐릭터가 바뀌었어요.")?
                } else {
                    *speaker
                };
                lines.push(SceneLine {
                    persona: crate::characters::SLOTS
                        .get(mapped)
                        .filter(|_| context.active.get(mapped).is_some())
                        .ok_or("활성 캐릭터가 없는 화자입니다.")?
                        .to_string(),
                    expression: expression.clone(),
                    text,
                });
                if lines.len() > 8 {
                    return Err("장면은 8줄 이하여야 해요.".into());
                }
            }
        }
    }
    Ok(())
}
