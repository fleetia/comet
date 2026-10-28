use crate::{app, store, widgets};
use serde_json::{json, Value};
use std::{
    collections::VecDeque,
    sync::{atomic::Ordering, Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::Manager;

#[derive(Default)]
pub(crate) struct Runtime(Mutex<VecDeque<Instant>>);

struct Notice {
    title: Option<String>,
    text: String,
    result: Option<String>,
    urgent: bool,
    os: bool,
}

pub(crate) fn cli(args: &[String]) -> Option<i32> {
    if args.get(1).map(String::as_str) != Some("notify") {
        return None;
    }
    if args.len() == 3 && matches!(args[2].as_str(), "--help" | "-h") {
        println!("comet notify <text> [--title <title>] [--result ok|failed|canceled] [--urgent] [--os] [--dry-run]\n접수는 말풍선 표시를 뜻하지 않습니다.");
        return Some(0);
    }
    let parsed = (|| -> Result<(Notice, bool), String> {
        let text = args
            .get(2)
            .filter(|value| !value.starts_with("--"))
            .ok_or("알림 내용이 필요해요.")?;
        let text = clean(text, 200);
        if text.is_empty() {
            return Err("알림 내용이 필요해요.".into());
        }
        let mut title = None;
        let mut result = None;
        let mut urgent = false;
        let mut os = false;
        let mut dry_run = false;
        let mut seen = std::collections::HashSet::new();
        let mut index = 3;
        while index < args.len() {
            let option = args[index].as_str();
            if !seen.insert(option) {
                return Err("같은 옵션을 두 번 지정했어요.".into());
            }
            match option {
                "--title" | "--result" => {
                    index += 1;
                    let value = args
                        .get(index)
                        .filter(|value| !value.starts_with("--"))
                        .ok_or("옵션 값이 필요해요.")?;
                    if option == "--title" {
                        let value = clean(value, 40);
                        title = (!value.is_empty()).then_some(value);
                    } else if matches!(value.as_str(), "ok" | "failed" | "canceled") {
                        result = Some(value.clone());
                    } else {
                        return Err("알림 결과가 올바르지 않아요.".into());
                    }
                }
                "--urgent" => urgent = true,
                "--os" => os = true,
                "--dry-run" => dry_run = true,
                _ => return Err("알 수 없는 알림 옵션이에요.".into()),
            }
            index += 1;
        }
        Ok((
            Notice {
                title,
                text,
                result,
                urgent,
                os,
            },
            dry_run,
        ))
    })();
    match parsed {
        Ok((notice, true)) => {
            println!(
                "{}",
                json!({"title": notice.title, "text": notice.text, "result": notice.result, "urgent": notice.urgent, "os": notice.os, "source": "cli"})
            );
            Some(0)
        }
        Ok(_) => {
            eprintln!("CLI 전달은 아직 사용할 수 없어요. --dry-run으로 입력을 확인할 수 있어요.");
            Some(1)
        }
        Err(error) => {
            eprintln!("{error}");
            Some(1)
        }
    }
}

fn clean(value: &str, limit: usize) -> String {
    let text: String = value.chars().filter(|ch| !ch.is_control()).collect();
    let mut chars = text.chars();
    let mut result: String = chars.by_ref().take(limit).collect();
    if chars.next().is_some() {
        result.push('…');
    }
    result
}

fn parse_url(url: &tauri::Url) -> Result<Notice, String> {
    if url.scheme() != "comet"
        || url.host_str() != Some("notify")
        || url.path() != "" && url.path() != "/"
        || url.fragment().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
    {
        return Err("지원하지 않는 바깥 알림 주소예요.".into());
    }
    let mut values = std::collections::HashMap::new();
    for (key, value) in url.query_pairs() {
        if !matches!(key.as_ref(), "text" | "title" | "result" | "urgent" | "os")
            || values
                .insert(key.into_owned(), value.into_owned())
                .is_some()
        {
            return Err("바깥 알림 인수가 올바르지 않아요.".into());
        }
    }
    let text = clean(
        values.get("text").map(String::as_str).unwrap_or_default(),
        200,
    );
    if text.is_empty() {
        return Err("알림 내용을 입력해 주세요.".into());
    }
    let title = values
        .get("title")
        .map(|value| clean(value, 40))
        .filter(|value| !value.is_empty());
    let result = values.remove("result");
    if result
        .as_deref()
        .is_some_and(|value| !matches!(value, "ok" | "failed" | "canceled"))
    {
        return Err("알림 결과가 올바르지 않아요.".into());
    }
    let flag = |key| match values.get(key).map(String::as_str) {
        None | Some("0") => Ok(false),
        Some("1") => Ok(true),
        _ => Err("알림 옵션이 올바르지 않아요.".to_string()),
    };
    Ok(Notice {
        title,
        text,
        result,
        urgent: flag("urgent")?,
        os: flag("os")?,
    })
}

pub(crate) fn configure(data: &Value, input: &Value) -> Result<widgets::WidgetEffect, String> {
    let mut data = data.clone();
    for (key, value) in input
        .as_object()
        .ok_or("바깥 알림 설정이 올바르지 않아요.")?
    {
        match key.as_str() {
            "enabled" | "osNotifications" if value.is_boolean() => data[key] = value.clone(),
            "prefix" => {
                let prefix = value.as_str().ok_or("접두 문구가 올바르지 않아요.")?;
                if prefix.chars().count() > 200 || prefix.chars().any(char::is_control) {
                    return Err("접두 문구는 줄바꿈 없이 200자까지 입력해 주세요.".into());
                }
                data[key] = value.clone();
            }
            _ => return Err("바깥 알림 설정이 올바르지 않아요.".into()),
        }
    }
    Ok(widgets::WidgetEffect {
        data,
        events: vec![],
    })
}

pub(crate) fn receive_url(app: &tauri::AppHandle, url: &tauri::Url) {
    let Ok(notice) = parse_url(url) else {
        return;
    };
    let Some(state) = app.try_state::<Arc<app::AppState>>() else {
        return;
    };
    let runtime = app.state::<Runtime>();
    let _ = receive(app, &state, &runtime, notice);
}

fn receive(
    app: &tauri::AppHandle,
    state: &app::AppState,
    runtime: &Runtime,
    notice: Notice,
) -> Result<(), String> {
    let (os, text) = widgets::commands::change(state, |db| {
        let instance = widgets::storage::instances(db)?
            .into_iter()
            .find(|item| item.kind == "external-notice" && item.installed && item.enabled)
            .ok_or("바깥 알림을 사용할 수 없어요.")?;
        if instance.data["enabled"] == false {
            return Err("바깥 알림 받기가 꺼져 있어요.".into());
        }
        let mut recent = app::lock(&runtime.0)?;
        let at = Instant::now();
        while recent
            .front()
            .is_some_and(|time| at.duration_since(*time) >= Duration::from_secs(60))
        {
            recent.pop_front();
        }
        if recent.len() >= 6 {
            return Err("바깥 알림이 너무 자주 도착했어요.".into());
        }
        let now = chrono::Utc::now().timestamp_millis();
        let prefix = instance.data["prefix"].as_str().unwrap_or("바깥에서 소식:");
        let text = [
            Some(prefix),
            notice.title.as_deref(),
            Some(notice.text.as_str()),
        ]
        .into_iter()
        .flatten()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
        let draft = widgets::EventDraft {
            kind: "external-notice".into(),
            text: text.clone(),
            payload: json!({"title": notice.title, "text": notice.text, "result": notice.result, "urgent": notice.urgent, "source": "url", "receivedAt": now}),
        };
        widgets::storage::record_external_notice(db, &instance, draft, now)?;
        recent.push_back(at);
        let status = app::lock(&state.runtime)?;
        if status.hidden
            || status.paused
            || state.launcher_open.load(Ordering::SeqCst)
            || state.widget_editing.load(Ordering::SeqCst)
            || !store::settings(db)?.autonomous_enabled
            || widgets::storage::focus_active(db, now)?
        {
            widgets::storage::discard_pending_external_notice(db)?;
        } else if app::quiet_hours::active(&store::settings(db)?) && !notice.urgent {
            widgets::storage::discard_pending_during_quiet(db)?;
        }
        Ok((
            notice.os || notice.urgent || instance.data["osNotifications"] == true,
            text,
        ))
    })?;
    if os {
        widgets::planning::notifications::show_external(app, &text);
    }
    widgets::commands::publish_widgets(app, state);
    Ok(())
}
