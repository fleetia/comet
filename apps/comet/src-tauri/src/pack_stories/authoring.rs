use super::*;
use crate::characters;

const MAX_SAFE_TURN: u64 = 9_007_199_254_740_991 - 35;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AuthoringActor {
    pub id: String,
    pub pack_id: Option<String>,
    pub definition: CharacterDefinition,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum AuthoringSubject {
    Npc {
        #[serde(rename = "actorId")]
        actor_id: String,
    },
    Relation {
        #[serde(rename = "actorId")]
        actor_id: String,
        #[serde(rename = "targetId")]
        target_id: String,
    },
    Scenario {
        #[serde(rename = "scenarioId")]
        scenario_id: String,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AuthoringContext {
    pub center_id: String,
    pub present_ids: Vec<String>,
    pub flags: Vec<String>,
    pub affinity: i32,
    pub turn: u64,
    pub wait_turn: u64,
    pub completed_scenario_ids: Vec<String>,
    pub incomplete_scenario_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AuthoringTrialRequest {
    pub actors: Vec<AuthoringActor>,
    pub definition: PackStoryDefinition,
    pub subject: AuthoringSubject,
    pub context: AuthoringContext,
    pub inputs: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AuthoringState {
    stage: Option<Stage>,
    ready: bool,
    present_ids: Vec<String>,
    flags: Vec<String>,
    turn: u64,
    wait_turn: u64,
    pending_next_scenario_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Condition {
    id: String,
    label: String,
    matched: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AuthoringTrialStep {
    input: Option<String>,
    source: &'static str,
    stage: Option<Stage>,
    conditions: Vec<Condition>,
    blocked_reasons: Vec<String>,
    before_state: AuthoringState,
    after_state: AuthoringState,
    lines: Vec<SceneLine>,
    line_durations_ms: Vec<i64>,
    planned_effects: CompletionEffects,
    model_required: bool,
    model_not_run_reason: Option<String>,
    presentation_assumed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AuthoringTrialTrace {
    blocked_reasons: Vec<String>,
    steps: Vec<AuthoringTrialStep>,
}

fn distinct(values: &[String]) -> bool {
    values.iter().all(|value| id(value))
        && values.iter().collect::<BTreeSet<_>>().len() == values.len()
}

fn actor<'a>(request: &'a AuthoringTrialRequest, local_id: &str) -> Result<&'a AuthoringActor> {
    request
        .actors
        .iter()
        .find(|actor| actor.id == local_id)
        .ok_or_else(|| "시험할 인물의 설치 ID를 확인해 주세요.".into())
}

fn subject_pack(request: &AuthoringTrialRequest) -> Result<Option<&str>> {
    let local_id = match &request.subject {
        AuthoringSubject::Npc { actor_id } | AuthoringSubject::Relation { actor_id, .. } => {
            actor_id
        }
        AuthoringSubject::Scenario { .. } => &request.context.center_id,
    };
    Ok(actor(request, local_id)?.pack_id.as_deref())
}

fn source_actor<'a>(
    request: &'a AuthoringTrialRequest,
    source_id: &str,
) -> Result<&'a AuthoringActor> {
    let pack_id = subject_pack(request)?;
    request
        .actors
        .iter()
        .find(|item| item.pack_id.as_deref() == pack_id && item.definition.source_id == source_id)
        .ok_or_else(|| "이 팩에 없는 이야기 화자예요.".into())
}

fn validate(request: &AuthoringTrialRequest) -> Result<()> {
    let context = &request.context;
    if request.actors.is_empty()
        || request.actors.len() > characters::MAX_ROSTER + 2
        || !distinct(
            &request
                .actors
                .iter()
                .map(|actor| actor.id.clone())
                .collect::<Vec<_>>(),
        )
        || request
            .actors
            .iter()
            .any(|actor| actor.pack_id.as_ref().is_some_and(|pack| !id(pack)))
        || context.present_ids.len() > characters::MAX_ROSTER
        || !distinct(&context.present_ids)
        || !(0..=100).contains(&context.affinity)
        || context.turn > MAX_SAFE_TURN
        || context.wait_turn > MAX_SAFE_TURN
        || request.inputs.len() > 32
        || request
            .inputs
            .iter()
            .any(|input| input.chars().count() > 500)
    {
        return Err("시험할 인물·참가 자리·입력·진행 범위를 확인해 주세요.".into());
    }
    for item in &request.actors {
        characters::validate_definition(&item.definition)?;
    }
    let center = actor(request, &context.center_id)?;
    if center.definition.presence_role != PresenceRole::Resident {
        return Err("시험의 중심에는 상주 인물을 선택해 주세요.".into());
    }
    let pack_id = subject_pack(request)?;
    let definitions = request
        .actors
        .iter()
        .filter(|item| item.pack_id.as_deref() == pack_id)
        .map(|item| item.definition.clone())
        .collect::<Vec<_>>();
    validate_pack(&definitions, &request.definition)?;
    if !distinct(&context.flags)
        || context.flags.iter().any(|flag| {
            !request
                .definition
                .story_flags
                .iter()
                .any(|item| item.id == *flag)
        })
        || [
            &context.completed_scenario_ids,
            &context.incomplete_scenario_ids,
        ]
        .iter()
        .any(|ids| {
            !distinct(ids)
                || ids.iter().any(|scenario| {
                    !request
                        .definition
                        .scenarios
                        .iter()
                        .any(|item| item.id == *scenario)
                })
        })
    {
        return Err("팩에 선언한 조건과 이야기 진행만 시험할 수 있어요.".into());
    }
    match &request.subject {
        AuthoringSubject::Npc { actor_id } => {
            let guest = actor(request, actor_id)?;
            if guest.definition.presence_role != PresenceRole::Npc || guest.definition.npc.is_none()
            {
                return Err("등장 설정이 있는 NPC를 선택해 주세요.".into());
            }
        }
        AuthoringSubject::Relation {
            actor_id,
            target_id,
        } => {
            if actor_id == target_id {
                return Err("관계의 상대는 다른 인물이어야 해요.".into());
            }
            actor(request, target_id)?;
            if !actor(request, actor_id)?
                .definition
                .relationships
                .iter()
                .any(|item| item.target_id == *target_id)
            {
                return Err("시험할 방향의 관계를 찾을 수 없어요.".into());
            }
        }
        AuthoringSubject::Scenario { scenario_id } => {
            if !request
                .definition
                .scenarios
                .iter()
                .any(|item| item.id == *scenario_id)
            {
                return Err("시험할 이야기를 찾을 수 없어요.".into());
            }
        }
    }
    Ok(())
}

fn step(input: Option<&str>, state: &AuthoringState) -> AuthoringTrialStep {
    AuthoringTrialStep {
        input: input.map(str::to_string),
        source: "none",
        stage: None,
        conditions: vec![],
        blocked_reasons: vec![],
        before_state: state.clone(),
        after_state: state.clone(),
        lines: vec![],
        line_durations_ms: vec![],
        planned_effects: CompletionEffects::default(),
        model_required: false,
        model_not_run_reason: None,
        presentation_assumed: false,
    }
}

fn condition(step: &mut AuthoringTrialStep, id: &str, label: &str, matched: bool) {
    step.conditions.push(Condition {
        id: id.into(),
        label: label.into(),
        matched,
    });
    if !matched {
        step.blocked_reasons.push(format!("{label}: 미충족"));
    }
}

fn allow_model(step: &mut AuthoringTrialStep) {
    step.model_required = true;
    step.model_not_run_reason = Some(
        "등록 응답이 없어 생성 응답이 필요할 수 있어요. 작성 시험에서는 모델을 실행하지 않아요."
            .into(),
    );
}

fn emit(
    request: &AuthoringTrialRequest,
    step: &mut AuthoringTrialStep,
    stage: Stage,
    lines: Vec<SceneLine>,
) -> Result<()> {
    step.line_durations_ms = lines
        .iter()
        .map(|line| {
            let actor = actor(request, &line.persona)?;
            Ok(crate::playback::line_duration_millis(
                &line.text,
                actor.definition.balloon_style.text_speed,
            ))
        })
        .collect::<Result<_>>()?;
    step.lines = lines;
    step.stage = Some(stage);
    step.source = "registered";
    step.presentation_assumed = true;
    Ok(())
}

fn mapped_lines(request: &AuthoringTrialRequest, lines: &[SceneLine]) -> Result<Vec<SceneLine>> {
    lines
        .iter()
        .map(|line| {
            Ok(SceneLine {
                persona: source_actor(request, &line.persona)?.id.clone(),
                ..line.clone()
            })
        })
        .collect()
}

fn entry_lines(actor: &AuthoringActor) -> Vec<SceneLine> {
    actor
        .definition
        .npc
        .as_ref()
        .map(|npc| npc.entry_lines.as_slice())
        .filter(|lines| !lines.is_empty())
        .unwrap_or(&actor.definition.greeting)
        .iter()
        .map(|line| SceneLine {
            persona: actor.id.clone(),
            expression: line.expression.clone(),
            text: line.text.clone(),
            widget: None,
            motion: line.motion.clone(),
        })
        .collect()
}

fn npc_step(
    request: &AuthoringTrialRequest,
    actor_id: &str,
    input: &str,
    state: &mut AuthoringState,
    output: &mut AuthoringTrialStep,
) -> Result<()> {
    let guest = actor(request, actor_id)?;
    let npc = guest
        .definition
        .npc
        .as_ref()
        .ok_or("NPC 등장 설정이 없어요.")?;
    if state.stage == Some(Stage::Entry) {
        if ["그만", "다른 이야기", "화제 바꾸자"]
            .iter()
            .any(|word| word.eq_ignore_ascii_case(input.trim()))
        {
            state.present_ids.retain(|id| id != actor_id);
            state.stage = None;
            state.ready = false;
            state.wait_turn = state.turn + 3;
            condition(output, "topicChange", "등록한 화제 종료 표현", true);
        } else {
            allow_model(output);
        }
        return Ok(());
    }
    let center = actor(request, &request.context.center_id)?;
    let pack_id = guest.pack_id.as_deref();
    let npc_only = request
        .actors
        .iter()
        .filter(|item| item.pack_id.as_deref() == pack_id)
        .all(|item| item.definition.presence_role == PresenceRole::Npc);
    condition(
        output,
        "center",
        "참가 중인 같은 팩의 상주 중심 또는 NPC 전용 팩",
        state.present_ids.contains(&center.id)
            && pack_id.is_some()
            && (center.pack_id.as_deref() == pack_id || npc_only),
    );
    condition(
        output,
        "keyword",
        "초대·등장 키워드",
        matches_keywords(&npc.invite_keywords, input)
            || matches_keywords(&npc.appearance_keywords, input),
    );
    condition(
        output,
        "flags",
        "NPC의 필요한 조건",
        flags_match(&npc.required_flags, &state.flags.iter().cloned().collect()),
    );
    condition(
        output,
        "wait",
        "재제안 대기 입력 수",
        state.turn >= state.wait_turn,
    );
    condition(
        output,
        "notPresent",
        "이번 시험에 아직 참가하지 않은 NPC",
        !state.present_ids.contains(&guest.id),
    );
    condition(
        output,
        "capacity",
        "상주 자리를 유지한 최대 8명",
        state.present_ids.len() < characters::MAX_ROSTER,
    );
    if !output.blocked_reasons.is_empty() {
        if !matches_keywords(&npc.invite_keywords, input)
            && !matches_keywords(&npc.appearance_keywords, input)
        {
            allow_model(output);
        }
        return Ok(());
    }
    state.present_ids.push(guest.id.clone());
    state.stage = Some(Stage::Entry);
    state.ready = true;
    emit(request, output, Stage::Entry, entry_lines(guest))?;
    if npc.exit_policy == NpcExitPolicy::SceneEnd {
        state.present_ids.retain(|id| id != actor_id);
        state.stage = None;
        state.ready = false;
    }
    Ok(())
}

fn relation_step(
    request: &AuthoringTrialRequest,
    actor_id: &str,
    target_id: &str,
    input: &str,
    state: &AuthoringState,
    output: &mut AuthoringTrialStep,
) -> Result<()> {
    let speaker = actor(request, actor_id)?;
    let target = actor(request, target_id)?;
    let relation = speaker
        .definition
        .relationships
        .iter()
        .find(|item| item.target_id == target_id)
        .ok_or("관계 설정이 없어요.")?;
    condition(
        output,
        "speakerPresent",
        "등록 응답의 화자가 현재 참가함",
        state.present_ids.iter().any(|id| id == actor_id),
    );
    condition(
        output,
        "direction",
        "선택한 화자에서 상대를 향한 관계",
        true,
    );
    condition(
        output,
        "targetName",
        "상대 이름 언급",
        matches_keywords(std::slice::from_ref(&target.definition.name), input),
    );
    condition(
        output,
        "registeredLines",
        "이 방향의 등록 응답",
        !relation.reply_lines.is_empty(),
    );
    if !state.present_ids.iter().any(|id| id == actor_id) {
        return Ok(());
    }
    if let Some(lines) =
        characters::registered_directed_reply(actor_id, relation, &target.definition.name, input)
    {
        // Relation replies have no story phase or state transition.
        emit(request, output, Stage::Entry, lines)?;
        output.stage = None;
    } else {
        allow_model(output);
    }
    Ok(())
}

fn scenario_conditions(
    request: &AuthoringTrialRequest,
    scene: &ScenarioDefinition,
    input: &str,
    state: &AuthoringState,
    outcomes: (&BTreeSet<String>, &BTreeSet<String>),
    deferred: &BTreeSet<String>,
    output: &mut AuthoringTrialStep,
) -> Result<bool> {
    let center = actor(request, &request.context.center_id)?;
    let participants = scene
        .participants
        .iter()
        .map(|source| source_actor(request, source))
        .collect::<Result<Vec<_>>>()?;
    let flags = state.flags.iter().cloned().collect();
    condition(
        output,
        "center",
        "이야기의 참가 중인 상주 중심",
        scene.center_id == center.definition.source_id && state.present_ids.contains(&center.id),
    );
    condition(
        output,
        "keyword",
        "이야기 제안 키워드",
        scene.keywords.is_empty() || matches_keywords(&scene.keywords, input),
    );
    condition(
        output,
        "flags",
        "이야기의 선행 조건",
        flags_match(&scene.required_flags, &flags),
    );
    condition(
        output,
        "npcFlags",
        "참가 NPC의 등장 조건",
        participants
            .iter()
            .filter_map(|item| item.definition.npc.as_ref())
            .all(|npc| flags_match(&npc.required_flags, &flags)),
    );
    condition(
        output,
        "affinity",
        "이야기의 노출 친밀도",
        request.context.affinity >= scene.reveal_affinity.unwrap_or(scene.min_affinity),
    );
    if request.context.affinity < scene.min_affinity && scene.reveal_affinity.is_some() {
        condition(
            output,
            "deferredToday",
            "오늘 아직 유보하지 않은 이야기",
            !deferred.contains(&scene.id),
        );
    }
    condition(
        output,
        "repeat",
        "완료·미완료 반복 허용",
        repeat_allowed(
            scene,
            outcomes.0.contains(&scene.id),
            outcomes.1.contains(&scene.id),
        ),
    );
    condition(
        output,
        "wait",
        "재제안 대기 입력 수",
        state.turn >= state.wait_turn,
    );
    condition(
        output,
        "residentParticipants",
        "상주 참가자가 모두 현재 참가함",
        participants
            .iter()
            .filter(|item| item.definition.presence_role == PresenceRole::Resident)
            .all(|item| state.present_ids.contains(&item.id)),
    );
    let new_guests = participants
        .iter()
        .filter(|item| {
            item.definition.presence_role == PresenceRole::Npc
                && !state.present_ids.contains(&item.id)
        })
        .count();
    condition(
        output,
        "capacity",
        "상주 자리를 유지한 최대 8명",
        state.present_ids.len() + new_guests <= characters::MAX_ROSTER,
    );
    Ok(output.blocked_reasons.is_empty())
}

fn trial_ticket(scene: &ScenarioDefinition, stage: Stage) -> RunTicket {
    RunTicket {
        run_id: "authoring-trial".into(),
        input_id: "authoring-trial".into(),
        scope: Scope {
            user_id: "authoring-trial".into(),
            pack_id: "authoring-trial".into(),
            center_id: scene.center_id.clone(),
        },
        scenario_id: Some(scene.id.clone()),
        stage,
        phase_generation: 1,
        epoch: 0,
        participants: scene.participants.clone(),
        pack_baseline: String::new(),
        definition_baselines: BTreeMap::new(),
        last_playback_id: String::new(),
        definition: Some(scene.clone()),
        ready: true,
    }
}

fn leave_scene_guests(
    request: &AuthoringTrialRequest,
    scene: &ScenarioDefinition,
    state: &mut AuthoringState,
) -> Result<()> {
    let guest_ids = scene
        .participants
        .iter()
        .map(|source| source_actor(request, source))
        .collect::<Result<Vec<_>>>()?
        .iter()
        .filter(|actor| actor.definition.presence_role == PresenceRole::Npc)
        .map(|actor| actor.id.clone())
        .collect::<BTreeSet<_>>();
    state.present_ids.retain(|id| !guest_ids.contains(id));
    state.stage = None;
    state.ready = false;
    state.wait_turn = state.turn + 3;
    Ok(())
}

pub(crate) fn authoring_trial(request: AuthoringTrialRequest) -> Result<AuthoringTrialTrace> {
    validate(&request)?;
    let mut state = AuthoringState {
        stage: None,
        ready: false,
        present_ids: request.context.present_ids.clone(),
        flags: request.context.flags.clone(),
        turn: request.context.turn,
        wait_turn: request.context.wait_turn,
        pending_next_scenario_id: None,
    };
    let mut completed = request
        .context
        .completed_scenario_ids
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>();
    let mut incomplete = request
        .context
        .incomplete_scenario_ids
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>();
    let mut running_scene_id: Option<String> = None;
    let mut deferred = BTreeSet::new();
    let mut trace = AuthoringTrialTrace {
        blocked_reasons: vec![],
        steps: vec![],
    };
    if request.inputs.is_empty() {
        trace.steps.push(step(None, &state));
    }
    for input in &request.inputs {
        let mut output = step(Some(input), &state);
        if input.trim().is_empty() {
            output
                .blocked_reasons
                .push("시험 입력이 비어 있어요.".into());
        } else {
            state.turn += 1;
            match &request.subject {
                AuthoringSubject::Npc { actor_id } => {
                    npc_step(&request, actor_id, input, &mut state, &mut output)?
                }
                AuthoringSubject::Relation {
                    actor_id,
                    target_id,
                } => relation_step(&request, actor_id, target_id, input, &state, &mut output)?,
                AuthoringSubject::Scenario { scenario_id } => {
                    let scene_id = running_scene_id
                        .as_deref()
                        .or(state.pending_next_scenario_id.as_deref())
                        .unwrap_or(scenario_id);
                    let mut scene = request
                        .definition
                        .scenarios
                        .iter()
                        .find(|item| item.id == scene_id)
                        .ok_or("연결된 이야기를 찾을 수 없어요.")?;
                    let stage = if let Some(stage) = state.stage {
                        if exact(&scene.cancel_keywords, input) {
                            incomplete.insert(scene.id.clone());
                            leave_scene_guests(&request, scene, &mut state)?;
                            running_scene_id = None;
                            state.pending_next_scenario_id = None;
                            condition(&mut output, "cancel", "등록한 중단 표현", true);
                            None
                        } else {
                            let next = decision(&trial_ticket(scene, stage), input);
                            condition(
                                &mut output,
                                "transition",
                                "현재 단계의 정확한 진행 표현",
                                next.is_some(),
                            );
                            if next.is_none() {
                                allow_model(&mut output);
                            }
                            next
                        }
                    } else {
                        let mut eligible = scenario_conditions(
                            &request,
                            scene,
                            input,
                            &state,
                            (&completed, &incomplete),
                            &deferred,
                            &mut output,
                        )?;
                        if !eligible && scene.id != *scenario_id {
                            // A reserved next story is preferred, but cannot bypass its gates.
                            // The selected story still gets the ordinary fallback check.
                            for condition in &mut output.conditions {
                                condition.id = format!("next:{}", condition.id);
                            }
                            scene = request
                                .definition
                                .scenarios
                                .iter()
                                .find(|item| item.id == *scenario_id)
                                .ok_or("시험할 이야기를 찾을 수 없어요.")?;
                            let mut fallback = step(Some(input), &state);
                            eligible = scenario_conditions(
                                &request,
                                scene,
                                input,
                                &state,
                                (&completed, &incomplete),
                                &deferred,
                                &mut fallback,
                            )?;
                            output.conditions.extend(fallback.conditions);
                            output.blocked_reasons = fallback.blocked_reasons;
                        }
                        if state.turn >= state.wait_turn {
                            state.pending_next_scenario_id = None;
                        }
                        if eligible {
                            if request.context.affinity < scene.min_affinity {
                                deferred.insert(scene.id.clone());
                                Some(Stage::Defer)
                            } else {
                                running_scene_id = Some(scene.id.clone());
                                Some(Stage::Intro)
                            }
                        } else {
                            if scene.keywords.is_empty()
                                || !matches_keywords(&scene.keywords, input)
                            {
                                allow_model(&mut output);
                            }
                            None
                        }
                    };
                    if let Some(stage) = stage {
                        let mut lines = if stage == Stage::Defer {
                            mapped_lines(&request, &defer_lines(scene))?
                        } else {
                            mapped_lines(&request, lines_for(stage, scene))?
                        };
                        if matches!(stage, Stage::Intro | Stage::Defer) {
                            let mut entries = vec![];
                            for source in &scene.participants {
                                let actor = source_actor(&request, source)?;
                                if actor.definition.presence_role != PresenceRole::Npc {
                                    continue;
                                }
                                if !state.present_ids.contains(&actor.id) {
                                    state.present_ids.push(actor.id.clone());
                                }
                                if stage == Stage::Intro {
                                    if let Some(npc) = &actor.definition.npc {
                                        entries.extend(npc.entry_lines.iter().map(|line| SceneLine {
                                            persona: actor.id.clone(),
                                            expression: line.expression.clone(),
                                            text: line.text.clone(),
                                            widget: None,
                                            motion: line.motion.clone(),
                                        }));
                                    }
                                }
                            }
                            entries.append(&mut lines);
                            lines = entries;
                        }
                        state.stage = Some(stage);
                        state.ready = true;
                        emit(&request, &mut output, stage, lines)?;
                        if matches!(stage, Stage::Ending | Stage::Decline | Stage::Defer) {
                            leave_scene_guests(&request, scene, &mut state)?;
                            running_scene_id = None;
                            state.pending_next_scenario_id = if stage == Stage::Ending {
                                scene.accept_next_id.clone()
                            } else if stage == Stage::Decline {
                                scene.decline_next_id.clone()
                            } else {
                                None
                            };
                            if stage == Stage::Ending {
                                completed.insert(scene.id.clone());
                                output.planned_effects = scene.completion.clone();
                                for flag in &scene.completion.set_flags {
                                    if !state.flags.contains(flag) {
                                        state.flags.push(flag.clone());
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        output.after_state = state.clone();
        for reason in &output.blocked_reasons {
            if !trace.blocked_reasons.contains(reason) {
                trace.blocked_reasons.push(reason.clone());
            }
        }
        trace.steps.push(output);
    }
    Ok(trace)
}

#[cfg(test)]
mod tests;
