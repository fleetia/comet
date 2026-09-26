use super::{EventDraft, WidgetEffect};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Interaction {
    snacks: u8,
    touches: u32,
    last_reaction_at: Option<i64>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Motion {
    x: f64,
    y: f64,
    vx: f64,
    vy: f64,
    moving: bool,
    flying: bool,
    last_at: i64,
    bounces: u32,
    distance: f64,
    best: f64,
    start_x: f64,
    start_y: f64,
}
#[derive(Serialize, Deserialize)]
struct Bubble {
    id: u32,
    x: f64,
    y: f64,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Bubbles {
    bubbles: Vec<Bubble>,
    next_id: u32,
    streak: u32,
    best: u32,
}
#[derive(Serialize, Deserialize)]
struct Match {
    game: String,
    a: String,
    b: String,
    result: String,
    rounds: u32,
}
#[derive(Serialize, Deserialize)]
struct Guessing {
    mode: String,
    answer: u8,
    playing: bool,
    attempts: u8,
    hint: String,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fishing {
    phase: String,
    bite_at: i64,
    expires_at: i64,
    last_catch: Option<String>,
    catches: u32,
}
#[derive(Serialize, Deserialize)]
struct Fortune {
    text: String,
    draws: u32,
    fictional: bool,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Plant {
    stage: u8,
    water: u8,
    updated_at: i64,
}
#[derive(Serialize, Deserialize)]
struct Point {
    x: f64,
    y: f64,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Pet {
    x: f64,
    y: f64,
    food: Option<Point>,
    arrivals: u32,
    last_at: i64,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Item {
    item_id: String,
    name: String,
    quantity: u32,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Decoration {
    id: u32,
    item_id: String,
    x: f64,
    y: f64,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Collection {
    items: Vec<Item>,
    decorations: Vec<Decoration>,
    next_id: u32,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Empty {}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CharacterInput {
    character: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Launch {
    x: f64,
    y: f64,
    vx: f64,
    vy: f64,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Choice {
    choice: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Mode {
    mode: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Guess {
    value: u8,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Id {
    id: u32,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Position {
    x: f64,
    y: f64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Decorate {
    item_id: String,
    x: f64,
    y: f64,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Move {
    id: u32,
    x: f64,
    y: f64,
}

fn decode<T: DeserializeOwned>(value: &Value) -> Result<T, String> {
    serde_json::from_value(value.clone())
        .map_err(|error| format!("위젯 데이터가 올바르지 않습니다: {error}"))
}
fn effect<T: Serialize>(data: T, events: Vec<EventDraft>) -> Result<WidgetEffect, String> {
    Ok(WidgetEffect {
        data: serde_json::to_value(data).map_err(|error| error.to_string())?,
        events,
    })
}
fn event(kind: &str, text: impl Into<String>) -> EventDraft {
    EventDraft {
        kind: kind.into(),
        text: text.into(),
        payload: json!({}),
    }
}
fn position(x: f64, y: f64) -> Result<(), String> {
    if x.is_finite() && y.is_finite() && (0.0..=100.0).contains(&x) && (0.0..=100.0).contains(&y) {
        Ok(())
    } else {
        Err("위치는 0부터 100 사이여야 합니다.".into())
    }
}
fn empty(input: &Value) -> Result<(), String> {
    decode::<Empty>(input).map(|_| ())
}

fn choice_label(choice: &str) -> &str {
    match choice {
        "heads" => "앞면",
        "tails" => "뒷면",
        "rock" => "바위",
        "paper" => "보",
        "scissors" => "가위",
        _ => choice,
    }
}

pub fn initial(kind: &str) -> Value {
    match kind {
        "interaction" => json!({"snacks":6,"touches":0,"lastReactionAt":null}),
        "ball" | "paper-plane" => {
            json!({"x":50.0,"y":50.0,"vx":0.0,"vy":0.0,"moving":false,"flying":false,"lastAt":0,"bounces":0,"distance":0.0,"best":0.0,"startX":50.0,"startY":50.0})
        }
        "bubbles" => json!({"bubbles":[],"nextId":1,"streak":0,"best":0}),
        "small-match" => json!({"game":"","a":"","b":"","result":"","rounds":0}),
        "guessing" => {
            json!({"mode":"cups","answer":0,"playing":false,"attempts":0,"hint":"놀이를 시작해 주세요."})
        }
        "fishing" => json!({"phase":"idle","biteAt":0,"expiresAt":0,"lastCatch":null,"catches":0}),
        "fortune" => json!({"text":"가상 장난 운세입니다.","draws":0,"fictional":true}),
        "plant" => json!({"stage":0,"water":0,"updatedAt":0}),
        "pet" => json!({"x":10.0,"y":50.0,"food":null,"arrivals":0,"lastAt":0}),
        "collection" => json!({"items":[],"decorations":[],"nextId":1}),
        _ => Value::Null,
    }
}

pub fn act(
    kind: &str,
    data: &Value,
    action: &str,
    input: &Value,
    now: i64,
    entropy: u64,
) -> Result<WidgetEffect, String> {
    match kind {
        "interaction" => {
            let mut state: Interaction = decode(data)?;
            if action == "refill" {
                empty(input)?;
                state.snacks = 6;
                return effect(state, vec![]);
            }
            let args: CharacterInput = decode(input)?;
            if !["A", "B"].contains(&args.character.as_str()) {
                return Err("A 또는 B를 선택해 주세요.".into());
            }
            let text = match action {
                "stroke" => format!("{}를 쓰다듬었어요.", args.character),
                "poke" => format!("{}를 콕 찔렀어요.", args.character),
                "snack" => {
                    if state.snacks == 0 {
                        return Err("간식 봉지가 비었어요.".into());
                    }
                    state.snacks -= 1;
                    format!(
                        "{}에게 한 조각. {}조각 남았어요.",
                        args.character, state.snacks
                    )
                }
                _ => return Err("알 수 없는 교감 동작입니다.".into()),
            };
            state.touches = state.touches.saturating_add(1);
            let events = if state
                .last_reaction_at
                .is_none_or(|last| now.saturating_sub(last) >= 5000)
            {
                state.last_reaction_at = Some(now);
                vec![EventDraft {
                    kind: "interaction.touch".into(),
                    text,
                    payload: json!({"action":action,"character":args.character}),
                }]
            } else {
                vec![]
            };
            effect(state, events)
        }
        "ball" | "paper-plane" => {
            let mut state: Motion = decode(data)?;
            if action == "stop" && kind == "ball" {
                empty(input)?;
                state.moving = false;
                state.vx = 0.0;
                state.vy = 0.0;
                return effect(state, vec![]);
            }
            if action != if kind == "ball" { "throw" } else { "launch" } {
                return Err("알 수 없는 발사 동작입니다.".into());
            }
            let args: Launch = decode(input)?;
            position(args.x, args.y)?;
            if !args.vx.is_finite()
                || !args.vy.is_finite()
                || args.vx.abs() > 100.0
                || args.vy.abs() > 100.0
                || args.vx.hypot(args.vy) < 1.0
            {
                return Err("발사 속도를 1 이상, 축별 100 이하로 지정해 주세요.".into());
            }
            state.x = args.x;
            state.y = args.y;
            state.start_x = args.x;
            state.start_y = args.y;
            state.vx = args.vx;
            state.vy = args.vy;
            state.last_at = now;
            state.moving = kind == "ball";
            state.flying = kind == "paper-plane";
            state.distance = 0.0;
            state.bounces = 0;
            effect(state, vec![])
        }
        "bubbles" => {
            let mut state: Bubbles = decode(data)?;
            let events = match action {
                "make" => {
                    empty(input)?;
                    if state.bubbles.len() >= 30 {
                        return Err("방울은 한 번에 30개까지 만들 수 있어요.".into());
                    }
                    let id = state.next_id;
                    state.next_id = id.checked_add(1).ok_or("방울 번호가 가득 찼어요.")?;
                    state.bubbles.push(Bubble {
                        id,
                        x: (entropy % 91 + 5) as f64,
                        y: (entropy.rotate_left(21) % 81 + 10) as f64,
                    });
                    vec![]
                }
                "pop" => {
                    let args: Id = decode(input)?;
                    let index = state
                        .bubbles
                        .iter()
                        .position(|bubble| bubble.id == args.id)
                        .ok_or("이미 사라진 방울이에요.")?;
                    state.bubbles.remove(index);
                    state.streak = state.streak.saturating_add(1);
                    state.best = state.best.max(state.streak);
                    if state.streak % 10 == 0 {
                        vec![event(
                            "bubbles.streak",
                            format!("연속 {}개를 터뜨렸어요.", state.streak),
                        )]
                    } else {
                        vec![]
                    }
                }
                "reset" => {
                    empty(input)?;
                    state.bubbles.clear();
                    state.streak = 0;
                    vec![]
                }
                _ => return Err("알 수 없는 방울 동작입니다.".into()),
            };
            effect(state, events)
        }
        "small-match" => {
            let mut state: Match = decode(data)?;
            match action {
                "dice" => {
                    empty(input)?;
                    let a = entropy % 6 + 1;
                    let b = entropy.rotate_left(32) % 6 + 1;
                    state.a = a.to_string();
                    state.b = b.to_string();
                    state.result = match a.cmp(&b) {
                        std::cmp::Ordering::Greater => "A 승리",
                        std::cmp::Ordering::Less => "B 승리",
                        std::cmp::Ordering::Equal => "무승부",
                    }
                    .into();
                }
                "coin" => {
                    let args: Choice = decode(input)?;
                    if !["heads", "tails"].contains(&args.choice.as_str()) {
                        return Err("앞면 또는 뒷면을 선택해 주세요.".into());
                    }
                    state.a = args.choice;
                    state.b = if entropy % 2 == 0 { "heads" } else { "tails" }.into();
                    state.result = if state.a == state.b {
                        "맞혔어요"
                    } else {
                        "다음 기회에"
                    }
                    .into();
                }
                "rps" => {
                    let args: Choice = decode(input)?;
                    let choices = ["rock", "paper", "scissors"];
                    let player = choices
                        .iter()
                        .position(|choice| *choice == args.choice)
                        .ok_or("가위, 바위, 보 중 선택해 주세요.")?;
                    let opponent = (entropy % 3) as usize;
                    state.a = args.choice;
                    state.b = choices[opponent].into();
                    state.result = if player == opponent {
                        "무승부"
                    } else if (player + 2) % 3 == opponent {
                        "사용자 승리"
                    } else {
                        "캐릭터 승리"
                    }
                    .into();
                }
                _ => return Err("알 수 없는 승부입니다.".into()),
            }
            state.game = action.into();
            state.rounds = state.rounds.saturating_add(1);
            let text = match action {
                "dice" => format!("주사위: A {}, B {} — {}", state.a, state.b, state.result),
                "coin" => format!(
                    "동전: 선택 {}, 결과 {} — {}",
                    choice_label(&state.a),
                    choice_label(&state.b),
                    state.result
                ),
                _ => format!(
                    "가위바위보: 사용자 {}, 캐릭터 {} — {}",
                    choice_label(&state.a),
                    choice_label(&state.b),
                    state.result
                ),
            };
            let outcome = match state.result.as_str() {
                "A 승리" => "winner-a",
                "B 승리" => "winner-b",
                "무승부" => "draw",
                "맞혔어요" => "correct",
                "다음 기회에" => "miss",
                "사용자 승리" => "winner-user",
                _ => "winner-character",
            };
            let draft = EventDraft {
                kind: "small-match.result".into(),
                text,
                payload: json!({"mode":state.game,"outcome":outcome}),
            };
            effect(state, vec![draft])
        }
        "guessing" => {
            let mut state: Guessing = decode(data)?;
            match action {
                "start" => {
                    let args: Mode = decode(input)?;
                    let range = match args.mode.as_str() {
                        "cups" => 3,
                        "number" => 100,
                        _ => return Err("컵 찾기 또는 숫자 맞히기를 선택해 주세요.".into()),
                    };
                    state.mode = args.mode;
                    state.answer = (entropy % range + 1) as u8;
                    state.playing = true;
                    state.attempts = 0;
                    state.hint = if range == 3 {
                        "세 컵 중 하나를 골라 주세요."
                    } else {
                        "1부터 100 사이의 숫자예요."
                    }
                    .into();
                    effect(state, vec![])
                }
                "guess" => {
                    let args: Guess = decode(input)?;
                    if !state.playing {
                        return Err("먼저 새 놀이를 시작해 주세요.".into());
                    }
                    if args.value == 0 || args.value > if state.mode == "cups" { 3 } else { 100 } {
                        return Err("놀이 범위 안의 값을 골라 주세요.".into());
                    }
                    state.attempts = state.attempts.saturating_add(1);
                    if args.value == state.answer {
                        state.playing = false;
                        state.hint = format!("정답! {}번 만에 맞혔어요.", state.attempts);
                    } else if state.attempts >= 100 {
                        state.playing = false;
                        state.hint = format!("이번 정답은 {}였어요.", state.answer);
                    } else {
                        state.hint = if state.mode == "cups" {
                            "그 컵은 비어 있어요."
                        } else if args.value < state.answer {
                            "더 큰 숫자예요."
                        } else {
                            "더 작은 숫자예요."
                        }
                        .into();
                    }
                    let text = state.hint.clone();
                    let outcome = if args.value == state.answer {
                        "correct"
                    } else if !state.playing {
                        "exhausted"
                    } else if state.mode == "cups" {
                        "empty"
                    } else if args.value < state.answer {
                        "higher"
                    } else {
                        "lower"
                    };
                    let draft = EventDraft {
                        kind: "guessing.attempt".into(),
                        text,
                        payload: json!({"mode":state.mode,"outcome":outcome}),
                    };
                    effect(state, vec![draft])
                }
                _ => Err("알 수 없는 맞히기 동작입니다.".into()),
            }
        }
        "fishing" => {
            let mut state: Fishing = decode(data)?;
            empty(input)?;
            match action {
                "cast" => {
                    if state.phase != "idle" {
                        return Err("먼저 낚싯줄을 거둬 주세요.".into());
                    }
                    state.phase = "waiting".into();
                    state.bite_at = now.saturating_add(2000 + (entropy % 4000) as i64);
                    state.expires_at = state.bite_at.saturating_add(5000);
                    effect(state, vec![])
                }
                "reel" => {
                    if state.phase == "idle" {
                        return Err("먼저 낚싯줄을 던져 주세요.".into());
                    }
                    state.phase = "idle".into();
                    if now < state.bite_at || now > state.expires_at {
                        return effect(
                            state,
                            vec![event("fishing.missed", "이번에는 빈 낚싯줄을 거뒀어요.")],
                        );
                    }
                    let catches = [
                        ("fish-blue", "파란 물고기"),
                        ("fish-gold", "금빛 물고기"),
                        ("sock", "양말"),
                        ("stone", "동그란 돌"),
                    ];
                    let (id, name) = catches[(entropy % catches.len() as u64) as usize];
                    state.last_catch = Some(name.into());
                    state.catches = state.catches.saturating_add(1);
                    effect(
                        state,
                        vec![EventDraft {
                            kind: "item-acquired".into(),
                            text: format!("{name} 획득!"),
                            payload: json!({"itemId":id,"name":name,"quantity":1}),
                        }],
                    )
                }
                _ => Err("알 수 없는 낚시 동작입니다.".into()),
            }
        }
        "fortune" => {
            let mut state: Fortune = decode(data)?;
            empty(input)?;
            if action != "draw" {
                return Err("운세 뽑기를 선택해 주세요.".into());
            }
            let texts = [
                "가상 장난 운세: 오늘의 행운은 상상 속 간식!",
                "가상 장난 운세: 종이비행기가 마음속에서 멀리 날아갑니다.",
                "가상 장난 운세: 왕관을 쓴 양말이 당신을 응원합니다.",
                "가상 장난 운세: 느긋한 달팽이가 오늘의 주인공!",
            ];
            state.text = texts[(entropy % texts.len() as u64) as usize].into();
            state.draws = state.draws.saturating_add(1);
            state.fictional = true;
            let text = state.text.clone();
            effect(state, vec![event("fortune.draw", text)])
        }
        "plant" => {
            empty(input)?;
            if action != "water" {
                return Err("화분의 물 주기를 선택해 주세요.".into());
            }
            let mut state: Plant = decode(data)?;
            if state.water == 0 {
                state.updated_at = now;
            }
            state.water = state.water.saturating_add(1).min(3);
            effect(state, vec![])
        }
        "pet" => {
            if action != "feed" {
                return Err("먹이 놓기를 선택해 주세요.".into());
            }
            let args: Position = decode(input)?;
            position(args.x, args.y)?;
            let mut state: Pet = decode(data)?;
            state.food = Some(Point {
                x: args.x,
                y: args.y,
            });
            state.last_at = now;
            effect(state, vec![])
        }
        "collection" => {
            let mut state: Collection = decode(data)?;
            match action {
                "decorate" => {
                    let args: Decorate = decode(input)?;
                    position(args.x, args.y)?;
                    let owned = state
                        .items
                        .iter()
                        .find(|item| item.item_id == args.item_id)
                        .ok_or("획득하지 않은 소품이에요.")?;
                    if state.decorations.len() >= 100
                        || state
                            .decorations
                            .iter()
                            .filter(|item| item.item_id == args.item_id)
                            .count()
                            >= owned.quantity as usize
                    {
                        return Err("꺼낼 수 있는 소품이 없어요.".into());
                    }
                    let id = state.next_id;
                    state.next_id = id.checked_add(1).ok_or("소품 번호가 가득 찼어요.")?;
                    state.decorations.push(Decoration {
                        id,
                        item_id: args.item_id,
                        x: args.x,
                        y: args.y,
                    });
                }
                "move" => {
                    let args: Move = decode(input)?;
                    position(args.x, args.y)?;
                    let decoration = state
                        .decorations
                        .iter_mut()
                        .find(|item| item.id == args.id)
                        .ok_or("꺼내 놓은 소품이 없어요.")?;
                    decoration.x = args.x;
                    decoration.y = args.y;
                }
                "clear" => {
                    empty(input)?;
                    state.decorations.clear();
                }
                _ => return Err("알 수 없는 소품 동작입니다.".into()),
            };
            effect(state, vec![])
        }
        _ => Err("알 수 없는 장난감입니다.".into()),
    }
}

pub fn tick(kind: &str, data: &Value, now: i64) -> Result<Option<WidgetEffect>, String> {
    match kind {
        "ball" | "paper-plane" => {
            let mut state: Motion = decode(data)?;
            if (!state.moving && !state.flying) || now <= state.last_at {
                return Ok(None);
            }
            let elapsed = (now.saturating_sub(state.last_at) as f64 / 1000.0).min(30.0);
            let steps = (elapsed / 0.05).ceil() as usize;
            let dt = elapsed / steps.max(1) as f64;
            let mut events = vec![];
            for _ in 0..steps {
                let old_x = state.x;
                let old_y = state.y;
                state.x += state.vx * dt;
                state.y += state.vy * dt;
                if kind == "paper-plane" {
                    state.vy += 12.0 * dt;
                    state.x = state.x.clamp(0.0, 100.0);
                    state.y = state.y.clamp(0.0, 100.0);
                    state.distance += (state.x - old_x).hypot(state.y - old_y);
                    if state.x <= 0.0 || state.x >= 100.0 || state.y <= 0.0 || state.y >= 100.0 {
                        state.flying = false;
                        state.best = state.best.max(state.distance);
                        events.push(event(
                            "paper-plane.landed",
                            format!(
                                "{:.1}만큼 날아 착지했어요. 최고 기록 {:.1}.",
                                state.distance, state.best
                            ),
                        ));
                        break;
                    }
                } else {
                    if state.x < 0.0 || state.x > 100.0 {
                        state.x = state.x.clamp(0.0, 100.0);
                        state.vx *= -0.7;
                        state.bounces = state.bounces.saturating_add(1);
                    }
                    if state.y < 0.0 || state.y > 100.0 {
                        state.y = state.y.clamp(0.0, 100.0);
                        state.vy *= -0.7;
                        state.bounces = state.bounces.saturating_add(1);
                    }
                    let friction = (-1.2 * dt).exp();
                    state.vx *= friction;
                    state.vy *= friction;
                    if state.vx.hypot(state.vy) < 0.5 {
                        state.moving = false;
                        state.vx = 0.0;
                        state.vy = 0.0;
                        events.push(event(
                            "ball.stopped",
                            format!("공이 ({:.0}, {:.0})에 멈췄어요.", state.x, state.y),
                        ));
                        break;
                    }
                }
            }
            state.last_at = now;
            effect(state, events).map(Some)
        }
        "fishing" => {
            let mut state: Fishing = decode(data)?;
            if state.phase == "idle" || now < state.bite_at {
                return Ok(None);
            }
            if now > state.expires_at {
                state.phase = "idle".into();
                return effect(
                    state,
                    vec![event(
                        "fishing.missed",
                        "입질이 지나갔어요. 다시 던질 수 있어요.",
                    )],
                )
                .map(Some);
            }
            if state.phase == "waiting" {
                state.phase = "bite".into();
                return effect(
                    state,
                    vec![event(
                        "fishing.bite",
                        "입질이에요! 지금 낚싯줄을 거둬 보세요.",
                    )],
                )
                .map(Some);
            }
            Ok(None)
        }
        "plant" => {
            let mut state: Plant = decode(data)?;
            if state.stage >= 3 || state.water == 0 || now.saturating_sub(state.updated_at) < 60_000
            {
                return Ok(None);
            }
            let growth = ((now.saturating_sub(state.updated_at) / 60_000) as u64)
                .min(state.water as u64)
                .min((3 - state.stage) as u64) as u8;
            state.stage += growth;
            state.water -= growth;
            state.updated_at = state.updated_at.saturating_add(growth as i64 * 60_000);
            let text = [
                "씨앗",
                "새싹이 올라왔어요.",
                "잎이 자랐어요.",
                "꽃이 피었어요!",
            ][state.stage as usize];
            effect(state, vec![event("plant.growth", text)]).map(Some)
        }
        "pet" => {
            let mut state: Pet = decode(data)?;
            let Some(food) = &state.food else {
                return Ok(None);
            };
            if now <= state.last_at {
                return Ok(None);
            }
            let distance = (food.x - state.x).hypot(food.y - state.y);
            let travel = now.saturating_sub(state.last_at) as f64 / 1000.0 * 3.0;
            let events = if travel >= distance {
                state.x = food.x;
                state.y = food.y;
                state.food = None;
                state.arrivals = state.arrivals.saturating_add(1);
                vec![event("pet.arrived", "펫이 먹이에 도착했어요.")]
            } else {
                state.x += (food.x - state.x) / distance * travel;
                state.y += (food.y - state.y) / distance * travel;
                vec![]
            };
            state.last_at = now;
            effect(state, events).map(Some)
        }
        _ => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn match_reactions_use_korean_labels_without_changing_game_identifiers() {
        for (action, input, a, b, expected) in [
            ("dice", json!({}), "1", "1", "주사위: A 1, B 1 — 무승부"),
            (
                "coin",
                json!({"choice":"tails"}),
                "tails",
                "heads",
                "동전: 선택 뒷면, 결과 앞면 — 다음 기회에",
            ),
            (
                "rps",
                json!({"choice":"paper"}),
                "paper",
                "rock",
                "가위바위보: 사용자 보, 캐릭터 바위 — 사용자 승리",
            ),
        ] {
            let result = act(
                "small-match",
                &initial("small-match"),
                action,
                &input,
                100,
                0,
            )
            .unwrap();
            assert_eq!(result.data["game"], action);
            assert_eq!(result.data["a"], a);
            assert_eq!(result.data["b"], b);
            assert_eq!(result.events[0].kind, "small-match.result");
            assert_eq!(result.events[0].text, expected);
        }
    }

    #[test]
    fn snacks_run_out_without_touch_spam() {
        let mut data = initial("interaction");
        let mut reactions = 0;
        for _ in 0..6 {
            let result = act(
                "interaction",
                &data,
                "snack",
                &json!({"character":"B"}),
                100,
                0,
            )
            .unwrap();
            reactions += result.events.len();
            data = result.data;
        }
        assert_eq!(data["snacks"], 0);
        assert_eq!(reactions, 1);
        assert!(act(
            "interaction",
            &data,
            "snack",
            &json!({"character":"A"}),
            100,
            0
        )
        .is_err());
    }
    #[test]
    fn hidden_answer_stays_fixed_and_repeated_win_is_rejected() {
        let start = act(
            "guessing",
            &initial("guessing"),
            "start",
            &json!({"mode":"number"}),
            0,
            49,
        )
        .unwrap();
        let wrong = act(
            "guessing",
            &start.data,
            "guess",
            &json!({"value":20}),
            1,
            80,
        )
        .unwrap();
        assert_eq!(wrong.data["answer"], 50);
        assert_eq!(wrong.data["hint"], "더 큰 숫자예요.");
        let won = act("guessing", &wrong.data, "guess", &json!({"value":50}), 2, 0).unwrap();
        assert_eq!(won.data["attempts"], 2);
        assert_eq!(won.data["playing"], false);
        assert!(act("guessing", &won.data, "guess", &json!({"value":50}), 3, 0).is_err());
    }
    #[test]
    fn fishing_awards_only_during_bite_and_only_once() {
        let cast = act("fishing", &initial("fishing"), "cast", &json!({}), 100, 0).unwrap();
        let early = act("fishing", &cast.data, "reel", &json!({}), 101, 0).unwrap();
        assert!(!early.events.iter().any(|e| e.kind == "item-acquired"));
        let bite = tick("fishing", &cast.data, 2100).unwrap().unwrap();
        let caught = act("fishing", &bite.data, "reel", &json!({}), 2200, 2).unwrap();
        assert_eq!(caught.events[0].payload["itemId"], "sock");
        assert!(act("fishing", &caught.data, "reel", &json!({}), 2201, 2).is_err());
        assert!(tick("fishing", &caught.data, 3000).unwrap().is_none());
    }
    #[test]
    fn plant_and_pet_survive_absence_and_emit_arrival_once() {
        let plant = act("plant", &initial("plant"), "water", &json!({}), 100, 0).unwrap();
        let grown = tick("plant", &plant.data, 900_000).unwrap().unwrap();
        assert_eq!(grown.data["stage"], 1);
        assert!(tick("plant", &grown.data, 999_000).unwrap().is_none());
        let pet = act(
            "pet",
            &initial("pet"),
            "feed",
            &json!({"x":90,"y":50}),
            100,
            0,
        )
        .unwrap();
        let moving = tick("pet", &pet.data, 1100).unwrap().unwrap();
        assert_eq!(moving.data["x"], 13.0);
        assert!(moving.events.is_empty());
        let arrived = tick("pet", &moving.data, 900_000).unwrap().unwrap();
        assert_eq!(arrived.data["arrivals"], 1);
        assert!(tick("pet", &arrived.data, 999_000).unwrap().is_none());
    }
    #[test]
    fn motion_lands_or_stops_without_replaying_results() {
        for (kind, action, flag) in [
            ("ball", "throw", "moving"),
            ("paper-plane", "launch", "flying"),
        ] {
            let launched = act(
                kind,
                &initial(kind),
                action,
                &json!({"x":90,"y":50,"vx":90,"vy":0}),
                100,
                0,
            )
            .unwrap();
            let ended = tick(kind, &launched.data, 30_100).unwrap().unwrap();
            assert_eq!(ended.data[flag], false);
            assert_eq!(ended.events.len(), 1);
            assert!(tick(kind, &ended.data, 40_000).unwrap().is_none());
        }
    }
    #[test]
    fn collection_cannot_mint_items_or_duplicate_decorations() {
        let input = json!({"itemId":"sock","x":20,"y":30});
        assert!(act(
            "collection",
            &initial("collection"),
            "decorate",
            &input,
            0,
            0
        )
        .is_err());
        let mut data = initial("collection");
        data["items"] = json!([{"itemId":"sock","name":"양말","quantity":1}]);
        let placed = act("collection", &data, "decorate", &input, 0, 0).unwrap();
        assert!(act("collection", &placed.data, "decorate", &input, 0, 0).is_err());
        let cleared = act("collection", &placed.data, "clear", &json!({}), 0, 0).unwrap();
        assert_eq!(cleared.data["items"], data["items"]);
        assert!(cleared.data["decorations"].as_array().unwrap().is_empty());
    }
    #[test]
    fn games_validate_choices_and_bubbles_reject_duplicate_pops() {
        assert!(act(
            "small-match",
            &initial("small-match"),
            "rps",
            &json!({"choice":"fire"}),
            0,
            0
        )
        .is_err());
        let won = act(
            "small-match",
            &initial("small-match"),
            "rps",
            &json!({"choice":"paper"}),
            0,
            0,
        )
        .unwrap();
        assert_eq!(won.data["result"], "사용자 승리");
        let made = act("bubbles", &initial("bubbles"), "make", &json!({}), 0, 10).unwrap();
        let popped = act("bubbles", &made.data, "pop", &json!({"id":1}), 0, 0).unwrap();
        assert_eq!(popped.data["streak"], 1);
        assert!(act("bubbles", &popped.data, "pop", &json!({"id":1}), 0, 0).is_err());
    }
    #[test]
    fn talk_payload_identifies_actions_and_results_without_hidden_answers() {
        let touched = act(
            "interaction",
            &initial("interaction"),
            "snack",
            &json!({"character":"B"}),
            1,
            0,
        )
        .unwrap();
        assert_eq!(
            touched.events[0].payload,
            json!({"action":"snack","character":"B"})
        );
        assert_eq!(touched.events[0].text, "B에게 한 조각. 5조각 남았어요.");
        let started = act(
            "guessing",
            &initial("guessing"),
            "start",
            &json!({"mode":"number"}),
            0,
            41,
        )
        .unwrap();
        for (guess, outcome) in [(20, "higher"), (50, "lower"), (42, "correct")] {
            let result = act(
                "guessing",
                &started.data,
                "guess",
                &json!({"value":guess}),
                1,
                0,
            )
            .unwrap();
            assert_eq!(
                result.events[0].payload,
                json!({"mode":"number","outcome":outcome})
            );
            assert!(result.events[0].payload.get("answer").is_none());
        }
        let match_result = act(
            "small-match",
            &initial("small-match"),
            "rps",
            &json!({"choice":"paper"}),
            0,
            0,
        )
        .unwrap();
        assert_eq!(
            match_result.events[0].payload,
            json!({"mode":"rps","outcome":"winner-user"})
        );
    }
}
