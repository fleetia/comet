use crate::{
    app::{self, lock, AppState},
    characters::{self, InstalledCharacter},
    pack_stories::PresenceRole,
    types::{SceneLine, WindowPosition},
};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{atomic::Ordering, Arc},
};
use tauri::{AppHandle, Manager};

type Result<T> = std::result::Result<T, String>;

#[derive(Clone)]
struct Guest {
    id: String,
    center_id: String,
    run_id: String,
    request_id: String,
    pack_id: String,
    pack_baseline: String,
    center_baseline: String,
    definition_baseline: String,
    residents: Vec<String>,
    generation: u64,
    position: Option<WindowPosition>,
    heard: Vec<String>,
    user_id: String,
    admitted_after_seq: i64,
    admitted_at: i64,
}

#[derive(Default)]
pub(crate) struct Runtime {
    entries: BTreeMap<String, Guest>,
    generation: u64,
    windows: BTreeMap<String, WindowAuthority>,
}

#[derive(Clone)]
struct WindowAuthority {
    id: String,
    identity: usize,
    guest_generation: Option<u64>,
}

#[derive(Clone, Debug)]
pub(crate) struct Admission {
    pub run_id: String,
    pub request_id: String,
    pub epoch: u64,
    pub center_id: String,
    pub guest_ids: Vec<String>,
    pub pack_id: String,
    pub pack_baseline: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct ActorTicket {
    pub id: String,
    pub(crate) definition_baseline: String,
    pub(crate) guest_generation: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct ParticipantTicket {
    pub epoch: u64,
    pub ids: Vec<String>,
    residents: Vec<String>,
    actors: Vec<ActorTicket>,
}

fn guest_current(state: &AppState, db: &Connection, guest: &Guest) -> Result<bool> {
    guest_current_visible(state, db, guest, lock(&state.runtime)?.hidden)
}

fn guest_current_visible(
    state: &AppState,
    db: &Connection,
    guest: &Guest,
    hidden: bool,
) -> Result<bool> {
    if app::unavailable(state)
        || hidden
        || crate::widgets::storage::focus_active(db, chrono::Utc::now().timestamp_millis())?
        || characters::active_ids(db)? != guest.residents
        || crate::store::active_user_id(db)? != guest.user_id
        || !guest.residents.contains(&guest.center_id)
        || characters::character_definition_baseline(db, &guest.center_id)? != guest.center_baseline
        || characters::character_definition_baseline(db, &guest.id)? != guest.definition_baseline
        || characters::pack_definition_baseline(db, &guest.pack_id)? != guest.pack_baseline
    {
        return Ok(false);
    }
    Ok(characters::get(db, &guest.id)?.definition.presence_role == PresenceRole::Npc)
}

// Native UI callbacks already own nonblocking runtime/guest guards.
pub(crate) fn display_ids_locked(
    state: &AppState,
    db: &Connection,
    guests: &Runtime,
    hidden: bool,
) -> Result<Vec<String>> {
    let mut ids = characters::active_ids(db)?;
    ids.extend(
        guests
            .entries
            .values()
            .filter(|guest| guest_current_visible(state, db, guest, hidden).unwrap_or(false))
            .map(|guest| guest.id.clone()),
    );
    Ok(ids)
}

pub(crate) fn guest_ids(state: &AppState, db: &Connection) -> Result<Vec<String>> {
    let guests = lock(&state.guests)?
        .entries
        .values()
        .cloned()
        .collect::<Vec<_>>();
    Ok(guests
        .into_iter()
        .filter(|guest| guest_current(state, db, guest).unwrap_or(false))
        .map(|guest| guest.id)
        .collect())
}

pub(crate) fn display_ids(state: &AppState, db: &Connection) -> Result<Vec<String>> {
    let mut ids = characters::active_ids(db)?;
    ids.extend(guest_ids(state, db)?);
    Ok(ids)
}

pub(crate) fn participant_ids(state: &AppState, db: &Connection) -> Result<Vec<String>> {
    let mut ids = app::presence::present_ids(state, &characters::active_ids(db)?)?;
    ids.extend(guest_ids(state, db)?);
    Ok(ids)
}

pub(crate) fn members(state: &AppState, db: &Connection) -> Result<Vec<InstalledCharacter>> {
    display_ids(state, db)?
        .iter()
        .map(|id| characters::get(db, id))
        .collect()
}

pub(crate) fn actor(
    state: &AppState,
    db: &Connection,
    persona: &str,
) -> Result<InstalledCharacter> {
    if let Ok(resident) = characters::active_character(db, persona) {
        return Ok(resident);
    }
    let guest = lock(&state.guests)?
        .entries
        .get(persona)
        .cloned()
        .ok_or("이 인물은 지금 참가하지 않고 있어요.")?;
    if !guest_current(state, db, &guest)? {
        return Err("이전 NPC 참가가 끝났어요. 다시 초대해 주세요.".into());
    }
    characters::get(db, persona)
}

pub(crate) fn is_present(state: &AppState, db: &Connection, id: &str) -> Result<bool> {
    if characters::active_ids(db)?
        .iter()
        .any(|resident| resident == id)
    {
        return app::presence::is_present(state, id);
    }
    Ok(actor(state, db, id).is_ok())
}

pub(crate) fn actor_ticket(state: &AppState, db: &Connection, id: &str) -> Result<ActorTicket> {
    let actor = actor(state, db, id)?;
    Ok(ActorTicket {
        definition_baseline: characters::character_definition_baseline(db, &actor.id)?,
        guest_generation: lock(&state.guests)?
            .entries
            .get(&actor.id)
            .map(|entry| entry.generation),
        id: actor.id,
    })
}

pub(crate) fn validate_actor(
    state: &AppState,
    db: &Connection,
    ticket: &ActorTicket,
) -> Result<()> {
    let current = actor_ticket(state, db, &ticket.id)?;
    if current.definition_baseline != ticket.definition_baseline
        || current.guest_generation != ticket.guest_generation
    {
        return Err("참가 인물의 정의나 출현이 바뀌었어요.".into());
    }
    Ok(())
}

pub(crate) fn capture(
    state: &AppState,
    db: &Connection,
    ids: &[String],
    epoch: u64,
) -> Result<ParticipantTicket> {
    if state.epoch.load(Ordering::SeqCst) != epoch
        || app::unavailable(state)
        || lock(&state.runtime)?.hidden
    {
        return Err("이전 장면 요청이에요.".into());
    }
    let distinct = ids.iter().collect::<BTreeSet<_>>();
    if ids.is_empty() || ids.len() > characters::MAX_ROSTER || distinct.len() != ids.len() {
        return Err("장면에는 서로 다른 현재 참가자 1~8명이 필요해요.".into());
    }
    let present = participant_ids(state, db)?;
    if ids.iter().any(|id| !present.contains(id)) {
        return Err("등록 대사의 화자가 지금 참가하지 않고 있어요.".into());
    }
    Ok(ParticipantTicket {
        epoch,
        ids: ids.to_vec(),
        residents: characters::active_ids(db)?,
        actors: ids
            .iter()
            .map(|id| actor_ticket(state, db, id))
            .collect::<Result<_>>()?,
    })
}

pub(crate) fn validate(
    state: &AppState,
    db: &Connection,
    ticket: &ParticipantTicket,
) -> Result<()> {
    if state.epoch.load(Ordering::SeqCst) != ticket.epoch
        || app::unavailable(state)
        || lock(&state.runtime)?.hidden
        || characters::active_ids(db)? != ticket.residents
        || ticket.ids.is_empty()
        || ticket.ids.len() > characters::MAX_ROSTER
        || ticket.ids.iter().collect::<BTreeSet<_>>().len() != ticket.ids.len()
        || ticket
            .actors
            .iter()
            .map(|actor| &actor.id)
            .collect::<Vec<_>>()
            != ticket.ids.iter().collect::<Vec<_>>()
    {
        return Err("이전 참가자 구성이에요.".into());
    }
    for actor in &ticket.actors {
        validate_actor(state, db, actor)?;
        if !is_present(state, db, &actor.id)? {
            return Err("장면의 참가자가 자리를 떠났어요.".into());
        }
    }
    Ok(())
}

pub(crate) fn resolve_actor(
    state: &AppState,
    db: &Connection,
    ticket: &ParticipantTicket,
    persona: &str,
) -> Result<InstalledCharacter> {
    validate(state, db, ticket)?;
    let actor = actor(state, db, persona)?;
    if !ticket.ids.contains(&actor.id) {
        return Err("장면에 선언되지 않은 화자예요.".into());
    }
    Ok(actor)
}

pub(crate) fn resolve_lines(
    state: &AppState,
    db: &Connection,
    ticket: &ParticipantTicket,
    lines: &[SceneLine],
) -> Result<Vec<SceneLine>> {
    lines
        .iter()
        .map(|line| {
            let actor = resolve_actor(state, db, ticket, &line.persona)?;
            if line.text.trim().is_empty()
                || line.text.chars().count() > 500
                || !actor.definition.expressions.contains_key(&line.expression)
            {
                return Err("등록 대사의 표정이나 본문을 확인해 주세요.".into());
            }
            crate::characters::reactions::validate_motion(&line.motion, &actor.definition, false)?;
            Ok(SceneLine {
                persona: actor.id,
                ..line.clone()
            })
        })
        .collect()
}

// The caller holds action and DB. No native operations occur inside this boundary.
pub(crate) fn admit_locked(
    state: &AppState,
    db: &Connection,
    request: &Admission,
) -> Result<Vec<String>> {
    uuid::Uuid::parse_str(&request.request_id).map_err(|_| "입장 요청 식별자를 확인해 주세요.")?;
    if request.run_id.is_empty()
        || state.epoch.load(Ordering::SeqCst) != request.epoch
        || app::unavailable(state)
        || lock(&state.runtime)?.hidden
        || crate::widgets::storage::focus_active(db, chrono::Utc::now().timestamp_millis())?
    {
        return Err("지금은 이전 NPC 입장을 받아들일 수 없어요.".into());
    }
    let residents = characters::active_ids(db)?;
    let center = characters::get(db, &request.center_id)?;
    if !residents.contains(&request.center_id)
        || center.definition.presence_role != PresenceRole::Resident
        || (center.pack_id.as_deref() != Some(request.pack_id.as_str())
            && !characters::npc_only_pack(db, &request.pack_id)?)
        || characters::pack_definition_baseline(db, &request.pack_id)? != request.pack_baseline
    {
        return Err("중심 인물이나 팩이 바뀌었어요.".into());
    }
    let ids = request.guest_ids.iter().collect::<BTreeSet<_>>();
    if ids.len() != request.guest_ids.len() {
        return Err("같은 NPC를 한 입장에 중복할 수 없어요.".into());
    }
    let center_baseline = characters::character_definition_baseline(db, &request.center_id)?;
    let user_id = crate::store::active_user_id(db)?;
    let admitted_after_seq = db
        .query_row("SELECT COALESCE(MAX(seq),0) FROM messages", [], |row| {
            row.get::<_, i64>(0)
        })
        .map_err(|error| error.to_string())?;
    let mut prepared = Vec::new();
    for id in &request.guest_ids {
        let actor = characters::get(db, id)?;
        if residents.contains(id)
            || actor.definition.presence_role != PresenceRole::Npc
            || actor.pack_id.as_deref() != Some(request.pack_id.as_str())
        {
            return Err("이 팩에서 입장할 NPC를 확인해 주세요.".into());
        }
        prepared.push((
            id.clone(),
            characters::character_definition_baseline(db, id)?,
        ));
    }
    reconcile_locked(state, db)?;
    let mut runtime = lock(&state.guests)?;
    let new_count = prepared
        .iter()
        .filter(|(id, _)| !runtime.entries.contains_key(id))
        .count();
    if residents.len() + runtime.entries.len() + new_count > characters::MAX_ROSTER {
        return Err("함께 표시할 수 있는 인물은 8명까지예요. 상주 인물의 자리는 유지해요.".into());
    }
    if prepared.iter().any(|(id, _)| {
        runtime.entries.get(id).is_some_and(|entry| {
            entry.run_id != request.run_id || entry.center_id != request.center_id
        })
    }) {
        return Err("이 NPC는 다른 현재 장면에 참가하고 있어요.".into());
    }
    let mut admitted = Vec::new();
    for (id, definition_baseline) in prepared {
        if runtime.entries.contains_key(&id) {
            continue;
        }
        runtime.generation = runtime.generation.wrapping_add(1);
        let generation = runtime.generation;
        runtime.entries.insert(
            id.clone(),
            Guest {
                id: id.clone(),
                center_id: request.center_id.clone(),
                run_id: request.run_id.clone(),
                request_id: request.request_id.clone(),
                pack_id: request.pack_id.clone(),
                pack_baseline: request.pack_baseline.clone(),
                center_baseline: center_baseline.clone(),
                definition_baseline,
                residents: residents.clone(),
                generation,
                position: None,
                heard: Vec::new(),
                user_id: user_id.clone(),
                admitted_after_seq,
                admitted_at: chrono::Utc::now().timestamp_millis(),
            },
        );
        admitted.push(id);
    }
    Ok(admitted)
}

pub(crate) fn generation(state: &AppState, id: &str) -> Result<Option<u64>> {
    Ok(lock(&state.guests)?
        .entries
        .get(id)
        .map(|entry| entry.generation))
}

pub(crate) fn record_window(
    state: &AppState,
    label: &str,
    id: &str,
    identity: usize,
    guest_generation: Option<u64>,
) -> Result<()> {
    lock(&state.guests)?.windows.insert(
        label.into(),
        WindowAuthority {
            id: id.into(),
            identity,
            guest_generation,
        },
    );
    Ok(())
}

pub(crate) fn window_authority(
    state: &AppState,
    label: &str,
    identity: usize,
) -> Result<Option<Option<u64>>> {
    Ok(lock(&state.guests)?
        .windows
        .get(label)
        .filter(|entry| {
            entry.identity == identity
                && label
                    .strip_prefix("body-")
                    .or_else(|| label.strip_prefix("face-"))
                    == Some(entry.id.as_str())
        })
        .map(|entry| entry.guest_generation))
}

pub(crate) fn window_current_locked(guests: &Runtime, label: &str, identity: usize) -> bool {
    let Some(authority) = guests
        .windows
        .get(label)
        .filter(|window| window.identity == identity)
    else {
        return false;
    };
    match authority.guest_generation {
        Some(generation) => guests
            .entries
            .get(&authority.id)
            .is_some_and(|guest| guest.generation == generation),
        None => !guests.entries.contains_key(&authority.id),
    }
}

pub(crate) fn window_current(state: &AppState, label: &str, identity: usize) -> Result<bool> {
    Ok(window_current_locked(
        &*lock(&state.guests)?,
        label,
        identity,
    ))
}

pub(crate) fn forget_missing_window(state: &AppState, label: &str) -> Result<()> {
    lock(&state.guests)?.windows.remove(label);
    Ok(())
}

pub(crate) fn forget_window(state: &AppState, label: &str, identity: usize) -> Result<bool> {
    let mut runtime = lock(&state.guests)?;
    if runtime
        .windows
        .get(label)
        .is_some_and(|entry| entry.identity == identity)
    {
        runtime.windows.remove(label);
        Ok(true)
    } else {
        Ok(false)
    }
}

pub(crate) fn transient_position(state: &AppState, id: &str) -> Result<Option<WindowPosition>> {
    Ok(lock(&state.guests)?
        .entries
        .get(id)
        .and_then(|entry| entry.position.clone()))
}

pub(crate) fn set_position_locked(
    state: &AppState,
    id: &str,
    generation: u64,
    position: WindowPosition,
) -> Result<bool> {
    if !position.x.is_finite() || !position.y.is_finite() {
        return Ok(false);
    }
    let mut runtime = lock(&state.guests)?;
    let Some(entry) = runtime
        .entries
        .get_mut(id)
        .filter(|entry| entry.generation == generation)
    else {
        return Ok(false);
    };
    entry.position = Some(position);
    Ok(true)
}

pub(crate) fn center_id(state: &AppState, id: &str) -> Result<Option<String>> {
    Ok(lock(&state.guests)?
        .entries
        .get(id)
        .map(|entry| entry.center_id.clone()))
}

pub(crate) fn interact_locked(
    state: &AppState,
    db: &Connection,
    id: &str,
    action: &str,
    request_id: &str,
    now: i64,
) -> Result<crate::widgets::storage::BodyInteraction> {
    let actor = actor(state, db, id)?;
    let slot = display_ids(state, db)?
        .iter()
        .position(|id| id == &actor.id)
        .ok_or("이 인물은 현재 화면에서 교감할 수 없어요.")?;
    crate::widgets::storage::body_interaction_with_actor(db, &actor, slot, action, request_id, now)
}

pub(crate) fn leave_locked(state: &AppState, id: &str) -> Result<Option<String>> {
    Ok(lock(&state.guests)?
        .entries
        .remove(id)
        .map(|entry| entry.run_id))
}

pub(crate) fn leave_run_locked(state: &AppState, run_id: &str) -> Result<Vec<String>> {
    let mut runtime = lock(&state.guests)?;
    let ids = runtime
        .entries
        .values()
        .filter(|entry| entry.run_id == run_id)
        .map(|entry| entry.id.clone())
        .collect::<Vec<_>>();
    for id in &ids {
        runtime.entries.remove(id);
    }
    Ok(ids)
}

pub(crate) fn reconcile_locked(state: &AppState, db: &Connection) -> Result<Vec<String>> {
    let guests = lock(&state.guests)?
        .entries
        .values()
        .cloned()
        .collect::<Vec<_>>();
    let stale = guests
        .iter()
        .filter(|guest| !guest_current(state, db, guest).unwrap_or(false))
        .map(|guest| guest.id.clone())
        .collect::<Vec<_>>();
    let mut runtime = lock(&state.guests)?;
    for id in &stale {
        runtime.entries.remove(id);
    }
    Ok(stale)
}

pub(crate) fn reconcile(state: &AppState) -> Result<()> {
    let _action = lock(&state.action)?;
    let db = lock(&state.db)?;
    reconcile_locked(state, &db)?;
    Ok(())
}

pub(crate) fn hear_locked(
    state: &AppState,
    db: &Connection,
    ticket: &ParticipantTicket,
    message_id: &str,
) -> Result<()> {
    validate(state, db, ticket)?;
    let (role, seq): (String, i64) = db.query_row("SELECT m.role,m.seq FROM messages m JOIN message_users u ON u.message_id=m.id WHERE m.id=?1 AND u.user_id=?2",
        rusqlite::params![message_id, crate::store::active_user_id(db)?], |row| Ok((row.get(0)?,row.get(1)?))).map_err(|_| "실제로 전달된 현재 사용자의 말만 NPC가 들을 수 있어요.".to_string())?;
    if role != "user" {
        let at = db
            .query_row(
                "SELECT shown_at FROM message_presentations WHERE message_id=?1",
                [message_id],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|_| "아직 화면에 표시되지 않은 대사예요.".to_string())?;
        return hear_displayed_locked(state, db, ticket, message_id, at);
    }
    let mut runtime = lock(&state.guests)?;
    for id in &ticket.ids {
        if let Some(guest) = runtime.entries.get_mut(id) {
            if (guest.request_id == message_id || seq > guest.admitted_after_seq)
                && !guest.heard.iter().any(|heard| heard == message_id)
            {
                guest.heard.push(message_id.into());
            }
        }
    }
    Ok(())
}

pub(crate) fn hear_displayed_locked(
    state: &AppState,
    db: &Connection,
    ticket: &ParticipantTicket,
    message_id: &str,
    display_started_at: i64,
) -> Result<()> {
    validate(state, db, ticket)?;
    if !crate::store::message_displayed(db, message_id)?
        || !lock(&state.playback)?.as_ref().is_some_and(|line| {
            line.id == message_id && line.display_started_at == Some(display_started_at)
        })
    {
        return Err("현재 사용자의 유효한 표시 대사가 아니에요.".into());
    }
    let mut runtime = lock(&state.guests)?;
    for id in &ticket.ids {
        if let Some(guest) = runtime.entries.get_mut(id) {
            if display_started_at >= guest.admitted_at
                && !guest.heard.iter().any(|heard| heard == message_id)
            {
                guest.heard.push(message_id.into());
            }
        }
    }
    Ok(())
}

pub(crate) fn heard_message_ids(
    state: &AppState,
    db: &Connection,
    id: &str,
) -> Result<Vec<String>> {
    actor(state, db, id)?;
    Ok(lock(&state.guests)?
        .entries
        .get(id)
        .map(|guest| guest.heard.clone())
        .unwrap_or_default())
}

pub(crate) fn heard_context(
    state: &AppState,
    db: &Connection,
    targets: &[String],
) -> Result<Option<BTreeSet<String>>> {
    let mut allowed: Option<BTreeSet<String>> = None;
    for target in targets {
        let actor = actor(state, db, target)?;
        if generation(state, &actor.id)?.is_some() {
            let heard = heard_message_ids(state, db, &actor.id)?
                .into_iter()
                .collect::<BTreeSet<_>>();
            allowed = Some(match allowed {
                None => heard,
                Some(previous) => previous.intersection(&heard).cloned().collect(),
            });
        }
    }
    Ok(allowed)
}

#[derive(Clone, Debug)]
pub(crate) struct GuestScope {
    pub center_id: String,
    pub pack_id: String,
}

pub(crate) fn speaker_scope(
    state: &AppState,
    db: &Connection,
    id: &str,
) -> Result<Option<GuestScope>> {
    actor(state, db, id)?;
    Ok(lock(&state.guests)?
        .entries
        .get(id)
        .map(|entry| GuestScope {
            center_id: entry.center_id.clone(),
            pack_id: entry.pack_id.clone(),
        }))
}

pub(crate) fn create_admitted(
    app: &AppHandle,
    state: &Arc<AppState>,
    admitted_ids: &[String],
) -> Result<()> {
    let entries = {
        let _action = lock(&state.action)?;
        let db = lock(&state.db)?;
        admitted_ids
            .iter()
            .map(|id| {
                actor(state, &db, id)?;
                lock(&state.guests)?
                    .entries
                    .get(id)
                    .cloned()
                    .ok_or_else(|| "입장 요청이 바뀌었어요.".into())
            })
            .collect::<Result<Vec<_>>>()?
    };
    let created = crate::desktop::create_boxes(app, state).and_then(|_| {
        let mut windows = Vec::new();
        for entry in &entries {
            let label = format!("body-{}", entry.id);
            let window = app
                .get_webview_window(&label)
                .ok_or("NPC 창을 만들지 못했어요. 같은 입력을 다시 시도해 주세요.")?;
            windows.push((
                label,
                crate::characters::reaction_host::window_identity(&window),
            ));
        }
        let _action = lock(&state.action)?;
        let db = lock(&state.db)?;
        for (entry, (label, identity)) in entries.iter().zip(windows) {
            if !guest_current(state, &db, entry)?
                || generation(state, &entry.id)? != Some(entry.generation)
                || window_authority(state, &label, identity)? != Some(Some(entry.generation))
            {
                return Err("NPC 창을 준비하는 동안 참가자가 바뀌었어요.".into());
            }
        }
        Ok(())
    });
    if created.is_err() {
        let _action = lock(&state.action)?;
        let mut runtime = lock(&state.guests)?;
        for entry in &entries {
            if runtime
                .entries
                .get(&entry.id)
                .is_some_and(|current| current.generation == entry.generation)
            {
                runtime.entries.remove(&entry.id);
            }
        }
        drop(runtime);
        drop(_action);
        app::publish(app, state);
    }
    created
}

pub(crate) fn close(
    app: &AppHandle,
    state: &Arc<AppState>,
    id: &str,
    expected_generation: u64,
) -> Result<()> {
    {
        let _action = lock(&state.action)?;
        if generation(state, id)? != Some(expected_generation) {
            return Ok(());
        }
        if let Some(run_id) = leave_locked(state, id)? {
            let owned = lock(&state.pack_stories)?
                .run
                .as_ref()
                .is_some_and(|run| run.run_id == run_id);
            app::conversation::cancel_pack_run_locked(state, &run_id)?;
            if owned {
                app::interrupt(state, false)?;
                let mut status = lock(&state.runtime)?;
                status.phase = crate::types::RuntimePhase::Idle;
                status.persona = None;
                status.error = None;
            }
        }
    }
    crate::characters::gestures::cancel_window(app, &format!("body-{id}"));
    app::publish(app, state);
    Ok(())
}

#[tauri::command]
pub(crate) async fn leave_character_guest(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<()> {
    let id = window
        .label()
        .strip_prefix("body-")
        .ok_or("현재 NPC 본체에서 퇴장해 주세요.")?;
    let generation = window_authority(
        &state,
        window.label(),
        crate::characters::reaction_host::window_identity(&window),
    )?
    .flatten()
    .ok_or("현재 NPC 창만 닫을 수 있어요.")?;
    close(window.app_handle(), state.inner(), id, generation)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{pack_stories::NpcDefinition, store, types::Message};

    fn fixture(guests: usize) -> (AppState, Admission) {
        let state = app::tests::state();
        let mut pack = characters::factory_pack();
        pack.format_version = 8;
        let mut npc = pack.characters[1].clone();
        npc.presence_role = PresenceRole::Npc;
        npc.npc = Some(NpcDefinition {
            invite_keywords: vec!["초대".into()],
            entry_lines: npc.greeting.clone(),
            ..Default::default()
        });
        pack.characters[1] = npc.clone();
        for index in 1..guests {
            let mut next = npc.clone();
            next.source_id = format!("guest-{index}");
            pack.characters.push(next);
        }
        let db = lock(&state.db).unwrap();
        let installed = characters::import_pack(&db, &pack).unwrap();
        characters::apply_roster(&db, vec![installed[0].id.clone()]).unwrap();
        let pack_id = installed[0].pack_id.clone().unwrap();
        let request = Admission {
            run_id: uuid::Uuid::new_v4().to_string(),
            request_id: uuid::Uuid::new_v4().to_string(),
            epoch: 0,
            center_id: installed[0].id.clone(),
            guest_ids: installed[1..]
                .iter()
                .map(|actor| actor.id.clone())
                .collect(),
            pack_baseline: characters::pack_definition_baseline(&db, &pack_id).unwrap(),
            pack_id,
        };
        drop(db);
        (state, request)
    }

    fn admit(state: &AppState, request: &Admission) -> Vec<String> {
        let _action = lock(&state.action).unwrap();
        let db = lock(&state.db).unwrap();
        admit_locked(state, &db, request).unwrap()
    }

    #[test]
    fn installed_npc_cannot_speak_until_admitted_and_duplicate_entry_does_not_change_roster() {
        let (state, request) = fixture(1);
        let id = &request.guest_ids[0];
        {
            let db = lock(&state.db).unwrap();
            assert!(actor(&state, &db, id).is_err());
            assert!(capture(&state, &db, std::slice::from_ref(id), 0).is_err());
        }
        assert_eq!(admit(&state, &request), request.guest_ids);
        assert!(admit(&state, &request).is_empty());
        let db = lock(&state.db).unwrap();
        assert_eq!(
            characters::active_ids(&db).unwrap(),
            vec![request.center_id.clone()]
        );
        let ticket = capture(&state, &db, &[request.center_id.clone(), id.clone()], 0).unwrap();
        let line = SceneLine {
            persona: id.clone(),
            text: "  그대로\n남겨요.  ".into(),
            expression: "평온".into(),
            motion: Default::default(),
        };
        assert_eq!(
            resolve_lines(&state, &db, &ticket, std::slice::from_ref(&line)).unwrap(),
            vec![line]
        );
        assert!(resolve_actor(&state, &db, &ticket, "not-declared").is_err());
        assert!(resolve_lines(
            &state,
            &db,
            &ticket,
            &[SceneLine {
                persona: id.clone(),
                text: " ".into(),
                expression: "평온".into(),
                motion: Default::default()
            }]
        )
        .is_err());
    }

    #[test]
    fn guest_positions_are_transient_and_stale_drop_generation_cannot_save_or_replace_them() {
        let (state, request) = fixture(1);
        let id = &request.guest_ids[0];
        store::set_window_position(
            &lock(&state.db).unwrap(),
            "b",
            &WindowPosition { x: 20.0, y: 40.0 },
        )
        .unwrap();
        admit(&state, &request);
        let generation = generation(&state, id).unwrap().unwrap();
        let _action = lock(&state.action).unwrap();
        assert!(set_position_locked(
            &state,
            id,
            generation,
            WindowPosition {
                x: 1000.0,
                y: 500.0
            }
        )
        .unwrap());
        assert!(!set_position_locked(
            &state,
            id,
            generation + 1,
            WindowPosition { x: 0.0, y: 0.0 }
        )
        .unwrap());
        let position = transient_position(&state, id).unwrap().unwrap();
        assert_eq!((position.x, position.y), (1000.0, 500.0));
        let db = lock(&state.db).unwrap();
        assert!(store::window_position(&db, &format!("body-{id}"))
            .unwrap()
            .is_none());
        let legacy = store::window_position(&db, "b").unwrap().unwrap();
        assert_eq!((legacy.x, legacy.y), (20.0, 40.0));
        drop(db);
        assert_eq!(
            leave_locked(&state, id).unwrap(),
            Some(request.run_id.clone())
        );
        assert!(
            !set_position_locked(&state, id, generation, WindowPosition { x: 9.0, y: 9.0 })
                .unwrap()
        );
        assert!(!lock(&state.runtime).unwrap().hidden);
        assert_eq!(
            characters::active_ids(&lock(&state.db).unwrap()).unwrap(),
            vec![request.center_id]
        );
    }

    #[test]
    fn late_native_events_cannot_turn_an_exited_guest_window_into_resident_placement() {
        let (state, request) = fixture(1);
        admit(&state, &request);
        let id = &request.guest_ids[0];
        let label = format!("face-{id}");
        let guest_generation = generation(&state, id).unwrap().unwrap();
        record_window(&state, &label, id, 1, Some(guest_generation)).unwrap();
        assert!(window_current_locked(
            &lock(&state.guests).unwrap(),
            &label,
            1
        ));
        leave_locked(&state, id).unwrap();
        assert!(!window_current_locked(
            &lock(&state.guests).unwrap(),
            &label,
            1
        ));
        admit(&state, &request);
        assert!(generation(&state, id).unwrap().unwrap() > guest_generation);
        assert!(!window_current(&state, &label, 1).unwrap());
        leave_locked(&state, id).unwrap();
        assert_eq!(
            window_authority(&state, &label, 1).unwrap(),
            Some(Some(guest_generation))
        );
        record_window(&state, &label, id, 2, None).unwrap();
        assert_eq!(window_authority(&state, &label, 1).unwrap(), None);
        assert!(!forget_window(&state, &label, 1).unwrap());
        assert_eq!(window_authority(&state, &label, 2).unwrap(), Some(None));
        assert!(store::window_position(&lock(&state.db).unwrap(), &label)
            .unwrap()
            .is_none());
    }

    #[test]
    fn eight_resident_slots_reject_npc_admission_without_evicting_anyone() {
        let (state, request) = fixture(1);
        let db = lock(&state.db).unwrap();
        let mut residents = vec![request.center_id.clone()];
        for _ in 1..8 {
            let mut definition = characters::factory_pack().characters[0].clone();
            definition.relationships.clear();
            residents.push(characters::create(&db, &definition).unwrap().id);
        }
        characters::apply_roster(&db, residents.clone()).unwrap();
        assert!(admit_locked(&state, &db, &request).is_err());
        assert_eq!(characters::active_ids(&db).unwrap(), residents);
        assert!(guest_ids(&state, &db).unwrap().is_empty());
    }

    #[test]
    fn npc_only_pack_can_enter_with_a_selected_foreign_center_and_pins_its_own_baseline() {
        let state = app::tests::state();
        let _action = lock(&state.action).unwrap();
        let db = lock(&state.db).unwrap();
        let residents = characters::active_ids(&db).unwrap();
        let center_id = residents[0].clone();
        let mut pack = characters::factory_pack();
        pack.format_version = 8;
        let mut npc = pack.characters.remove(1);
        npc.presence_role = PresenceRole::Npc;
        npc.relationships.clear();
        npc.npc = Some(NpcDefinition {
            invite_keywords: vec!["혼자 초대".into()],
            entry_lines: npc.greeting.clone(),
            ..Default::default()
        });
        pack.characters = vec![npc];
        pack.pair_scenes.clear();
        pack.wordbook.clear();
        let installed = characters::import_pack(&db, &pack).unwrap();
        let pack_id = installed[0].pack_id.clone().unwrap();
        assert!(characters::npc_only_pack(&db, &pack_id).unwrap());
        let request = Admission {
            run_id: uuid::Uuid::new_v4().to_string(),
            request_id: uuid::Uuid::new_v4().to_string(),
            epoch: 0,
            center_id: center_id.clone(),
            guest_ids: vec![installed[0].id.clone()],
            pack_baseline: characters::pack_definition_baseline(&db, &pack_id).unwrap(),
            pack_id: pack_id.clone(),
        };
        assert_eq!(
            admit_locked(&state, &db, &request).unwrap(),
            request.guest_ids
        );
        assert!(admit_locked(&state, &db, &request).unwrap().is_empty());
        let ticket = capture(
            &state,
            &db,
            &[center_id.clone(), installed[0].id.clone()],
            0,
        )
        .unwrap();
        assert!(validate(&state, &db, &ticket).is_ok());
        assert_eq!(characters::active_ids(&db).unwrap(), residents);
        assert_eq!(
            speaker_scope(&state, &db, &installed[0].id)
                .unwrap()
                .unwrap()
                .pack_id,
            pack_id
        );
        let original = characters::get(&db, &center_id).unwrap().definition;
        let mut changed = original.clone();
        changed.description.push_str(" 바뀜");
        characters::save(&db, &center_id, &changed).unwrap();
        characters::save(&db, &center_id, &original).unwrap();
        assert_eq!(
            characters::pack_definition_baseline(&db, &pack_id).unwrap(),
            request.pack_baseline
        );
        assert!(validate(&state, &db, &ticket).is_err());
        assert!(actor(&state, &db, &installed[0].id).is_err());
        assert_eq!(reconcile_locked(&state, &db).unwrap(), request.guest_ids);
    }

    #[test]
    fn mixed_or_missing_member_pack_cannot_use_a_foreign_center_for_admission() {
        let (state, mut request) = fixture(1);
        let _action = lock(&state.action).unwrap();
        let db = lock(&state.db).unwrap();
        let pack_center = request.center_id.clone();
        let foreign = characters::create(&db, &characters::factory_pack().characters[0]).unwrap();
        characters::apply_roster(&db, vec![foreign.id.clone()]).unwrap();
        request.center_id = foreign.id.clone();
        assert!(!characters::npc_only_pack(&db, &request.pack_id).unwrap());
        assert!(admit_locked(&state, &db, &request).is_err());
        characters::remove(&db, &pack_center).unwrap();
        request.pack_baseline =
            characters::pack_definition_baseline(&db, &request.pack_id).unwrap();
        assert!(!characters::npc_only_pack(&db, &request.pack_id).unwrap());
        assert!(admit_locked(&state, &db, &request).is_err());
        assert!(guest_ids(&state, &db).unwrap().is_empty());
        assert_eq!(characters::active_ids(&db).unwrap(), vec![foreign.id]);
    }

    #[test]
    fn late_admission_and_old_playback_epoch_fail_but_same_context_can_reticket_a_present_guest() {
        let (state, request) = fixture(1);
        state.epoch.store(1, Ordering::SeqCst);
        assert!(admit_locked(&state, &lock(&state.db).unwrap(), &request).is_err());
        state.epoch.store(0, Ordering::SeqCst);
        admit(&state, &request);
        let db = lock(&state.db).unwrap();
        let ticket = capture(&state, &db, &request.guest_ids, 0).unwrap();
        state.epoch.store(1, Ordering::SeqCst);
        assert!(validate(&state, &db, &ticket).is_err());
        assert!(actor(&state, &db, &request.guest_ids[0]).is_ok());
        assert!(capture(&state, &db, &request.guest_ids, 1).is_ok());
    }

    #[test]
    fn profile_aba_invalidates_guest_and_old_participant_ticket() {
        let (state, request) = fixture(1);
        admit(&state, &request);
        let db = lock(&state.db).unwrap();
        let ticket = capture(&state, &db, &request.guest_ids, 0).unwrap();
        let id = &request.guest_ids[0];
        let original = characters::get(&db, id).unwrap().definition;
        let mut changed = original.clone();
        changed.description.push_str(" 변경");
        characters::save(&db, id, &changed).unwrap();
        characters::save(&db, id, &original).unwrap();
        assert!(validate(&state, &db, &ticket).is_err());
        assert!(actor(&state, &db, id).is_err());
        assert!(admit_locked(&state, &db, &request).is_err());
    }

    #[test]
    fn hide_or_focus_removes_only_guests_and_does_not_modify_resident_positions() {
        for focus in [false, true] {
            let (state, request) = fixture(1);
            admit(&state, &request);
            let db = lock(&state.db).unwrap();
            let label = format!("body-{}", request.center_id);
            store::set_window_position(&db, &label, &WindowPosition { x: 10.0, y: 20.0 }).unwrap();
            let ticket = capture(&state, &db, &request.guest_ids, 0).unwrap();
            if focus {
                db.execute("UPDATE widget_instances SET data=?1 WHERE kind='focus-timer'", [serde_json::json!({"status":"running","mode":"focus","deadline":chrono::Utc::now().timestamp_millis()+60000}).to_string()]).unwrap();
            } else {
                lock(&state.runtime).unwrap().hidden = true;
            }
            assert!(validate(&state, &db, &ticket).is_err());
            assert_eq!(reconcile_locked(&state, &db).unwrap(), request.guest_ids);
            assert!(generation(&state, &request.guest_ids[0]).unwrap().is_none());
            assert_eq!(
                characters::active_ids(&db).unwrap(),
                vec![request.center_id]
            );
            let position = store::window_position(&db, &label).unwrap().unwrap();
            assert_eq!((position.x, position.y), (10.0, 20.0));
        }
    }

    #[test]
    fn heard_context_requires_actual_current_input_or_live_native_display_and_intersects_guests() {
        let (state, request) = fixture(2);
        let now = chrono::Utc::now().timestamp_millis();
        let db = lock(&state.db).unwrap();
        let input = |id: &str, at: i64| Message {
            id: id.into(),
            role: "user".into(),
            persona: None,
            content: "안녕".into(),
            expression: None,
            created_at: at,
            status: "complete".into(),
        };
        store::insert_user_input(&db, &input("old-input", now - 60000), false).unwrap();
        store::insert_user_input(&db, &input("future-old-input", now + 60000), false).unwrap();
        store::insert_message(
            &db,
            &Message {
                id: "cached-reply".into(),
                role: "assistant".into(),
                persona: Some(request.center_id.clone()),
                content: "다시 표시한 원문".into(),
                expression: Some("평온".into()),
                created_at: now - 60000,
                status: "complete".into(),
            },
        )
        .unwrap();
        store::mark_message_displayed(&db, "cached-reply", now - 60000).unwrap();
        store::insert_user_input(&db, &input(&request.request_id, now), false).unwrap();
        admit_locked(&state, &db, &request).unwrap();
        let both = capture(&state, &db, &request.guest_ids, 0).unwrap();
        assert_eq!(
            heard_context(&state, &db, &request.guest_ids).unwrap(),
            Some(BTreeSet::new())
        );
        hear_locked(&state, &db, &both, "old-input").unwrap();
        hear_locked(&state, &db, &both, "future-old-input").unwrap();
        assert_eq!(
            heard_context(&state, &db, &request.guest_ids).unwrap(),
            Some(BTreeSet::new())
        );
        hear_locked(&state, &db, &both, &request.request_id).unwrap();
        store::insert_user_input(&db, &input("guest-a-only", now - 60000), false).unwrap();
        let first = capture(&state, &db, &request.guest_ids[..1], 0).unwrap();
        hear_locked(&state, &db, &first, "guest-a-only").unwrap();
        assert!(heard_message_ids(&state, &db, &request.guest_ids[0])
            .unwrap()
            .contains(&"guest-a-only".to_string()));
        assert_eq!(
            heard_context(&state, &db, &request.guest_ids).unwrap(),
            Some(BTreeSet::from([request.request_id.clone()]))
        );
        let reply = Message {
            id: "reply".into(),
            role: "assistant".into(),
            persona: Some(request.center_id.clone()),
            content: "반가워".into(),
            expression: Some("평온".into()),
            created_at: now + 1000,
            status: "complete".into(),
        };
        store::insert_message(&db, &reply).unwrap();
        assert!(hear_locked(&state, &db, &both, "reply").is_err());
        store::mark_message_displayed(&db, "reply", now + 1000).unwrap();
        assert!(hear_displayed_locked(&state, &db, &both, "reply", now + 1000).is_err());
        *lock(&state.playback).unwrap() = Some(crate::types::Playback {
            id: "reply".into(),
            persona: request.center_id.clone(),
            expression: "평온".into(),
            text: "반가워".into(),
            motion: Default::default(),
            source: "scenario".into(),
            text_speed: 1,
            display_started_at: Some(now + 1000),
            ends_at: now + 2000,
            line_index: 0,
            line_count: 1,
        });
        hear_displayed_locked(&state, &db, &both, "reply", now + 1000).unwrap();
        assert!(heard_context(&state, &db, &request.guest_ids)
            .unwrap()
            .unwrap()
            .contains("reply"));
        let mut replay = lock(&state.playback).unwrap().clone().unwrap();
        replay.id = "cached-reply".into();
        replay.text = "다시 표시한 원문".into();
        replay.display_started_at = Some(now - 60000);
        *lock(&state.playback).unwrap() = Some(replay.clone());
        hear_displayed_locked(&state, &db, &both, "cached-reply", now - 60000).unwrap();
        assert!(!heard_context(&state, &db, &request.guest_ids)
            .unwrap()
            .unwrap()
            .contains("cached-reply"));
        let replay_at = chrono::Utc::now().timestamp_millis();
        replay.display_started_at = Some(replay_at);
        replay.ends_at = replay_at + 1000;
        *lock(&state.playback).unwrap() = Some(replay);
        hear_displayed_locked(&state, &db, &both, "cached-reply", replay_at).unwrap();
        assert!(heard_context(&state, &db, &request.guest_ids)
            .unwrap()
            .unwrap()
            .contains("cached-reply"));
    }

    #[test]
    fn guest_direct_gestures_reuse_shared_receipt_and_snack_cooldown_engine() {
        let (state, request) = fixture(1);
        admit(&state, &request);
        let db = lock(&state.db).unwrap();
        let id = &request.guest_ids[0];
        let gesture = uuid::Uuid::new_v4().to_string();
        assert!(interact_locked(&state, &db, id, "poke", &gesture, 10000)
            .unwrap()
            .event.is_some());
        assert!(interact_locked(&state, &db, id, "poke", &gesture, 11000)
            .unwrap()
            .event.is_none());
        assert!(interact_locked(
            &state,
            &db,
            &request.center_id,
            "stroke",
            &uuid::Uuid::new_v4().to_string(),
            11000
        )
        .unwrap()
        .event.is_none());
        assert_eq!(
            characters::active_ids(&db).unwrap(),
            vec![request.center_id]
        );
    }
}
