use super::*;
use chrono::{NaiveDate, NaiveDateTime, TimeZone};
use icalendar::parser::{Component, Property};
use rrule::{RRuleSet, Tz};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone)]
struct Moment {
    at: DateTime<Tz>,
    all_day: bool,
}
fn parameter(property: &Property<'_>, name: &str) -> Option<String> {
    property
        .params
        .iter()
        .find(|x| x.key.as_ref() == name)
        .and_then(|x| x.val.as_ref())
        .map(ToString::to_string)
}
fn moment(property: &Property<'_>) -> Result<Moment, CalendarError> {
    let value = property.val.as_ref();
    let all_day = parameter(property, "VALUE").as_deref() == Some("DATE");
    if all_day {
        if parameter(property, "TZID").is_some() {
            return Err(invalid("종일 일정에 TZID를 지정할 수 없습니다."));
        }
        let day =
            NaiveDate::parse_from_str(value, "%Y%m%d").map_err(|_| invalid("ICS 날짜 오류"))?;
        return Ok(Moment {
            at: Tz::UTC.from_utc_datetime(
                &day.and_hms_opt(0, 0, 0)
                    .ok_or_else(|| invalid("ICS 날짜 오류"))?,
            ),
            all_day: true,
        });
    }
    if parameter(property, "VALUE").is_some_and(|x| x != "DATE-TIME") {
        return Err(invalid("지원하지 않는 ICS 시각 값 형식입니다."));
    }
    let timezone = parameter(property, "TZID");
    if timezone.is_none() && !value.ends_with('Z') {
        return Err(invalid(
            "시간대 없는 floating ICS 시각은 지원하지 않습니다.",
        ));
    }
    if timezone.is_some() && value.ends_with('Z') {
        return Err(invalid("UTC 시각과 TZID를 함께 지정할 수 없습니다."));
    }
    let definition = if let Some(timezone) = timezone {
        format!("DTSTART;TZID={timezone}:{value}\nRRULE:FREQ=DAILY;COUNT=1")
    } else {
        format!("DTSTART:{value}\nRRULE:FREQ=DAILY;COUNT=1")
    };
    let parsed: RRuleSet = definition
        .parse()
        .map_err(|_| invalid("ICS 시각 또는 IANA 시간대를 읽을 수 없습니다."))?;
    let at = *parsed.get_dt_start();
    let naive = NaiveDateTime::parse_from_str(value.trim_end_matches('Z'), "%Y%m%dT%H%M%S")
        .map_err(|_| invalid("ICS 시각 형식 오류"))?;
    if at.timezone().from_local_datetime(&naive).single().is_none() {
        return Err(invalid(
            "일광 절약 시간 전환으로 모호하거나 존재하지 않는 ICS 시각입니다.",
        ));
    }
    Ok(Moment { at, all_day: false })
}
fn occurrence(moment: &Moment) -> String {
    if moment.all_day {
        moment.at.format("%Y-%m-%d").to_string()
    } else {
        moment.at.timestamp_millis().to_string()
    }
}
fn required<'a, 'b>(
    component: &'a Component<'b>,
    name: &str,
) -> Result<&'a Property<'b>, CalendarError> {
    component
        .properties
        .iter()
        .find(|x| x.name.as_ref() == name)
        .ok_or_else(|| invalid("ICS 일정의 필수 필드가 없습니다."))
}
fn validate(component: &Component<'_>) -> Result<(), CalendarError> {
    for key in [
        "UID",
        "DTSTART",
        "DTEND",
        "DURATION",
        "RECURRENCE-ID",
        "SUMMARY",
        "STATUS",
    ] {
        if component
            .properties
            .iter()
            .filter(|x| x.name.as_ref() == key)
            .count()
            > 1
        {
            return Err(invalid("ICS 단일 필드가 중복되었습니다."));
        }
    }
    if component.find_prop("EXRULE").is_some() {
        return Err(invalid(
            "ICS EXRULE은 지원하지 않습니다. EXDATE를 사용해 주세요.",
        ));
    }
    if component
        .find_prop("RECURRENCE-ID")
        .is_some_and(|p| parameter(p, "RANGE").is_some())
    {
        return Err(invalid("ICS RECURRENCE-ID RANGE 변경은 지원하지 않습니다."));
    }
    if component.find_prop("DURATION").is_some() {
        return Err(invalid(
            "ICS DURATION은 지원하지 않습니다. DTEND가 필요합니다.",
        ));
    }
    if component
        .properties
        .iter()
        .any(|p| p.val.as_ref().len() > 10000)
    {
        return Err(invalid("ICS 필드가 너무 깁니다."));
    }
    Ok(())
}
fn event(
    component: &Component<'_>,
    connection_id: &str,
    uid: &str,
    start: &Moment,
    identity: &Moment,
) -> Result<CalendarEvent, CalendarError> {
    let end = match component.find_prop("DTEND") {
        Some(p) => moment(p)?,
        None => Moment {
            at: if start.all_day {
                start
                    .at
                    .checked_add_signed(chrono::Duration::days(1))
                    .ok_or_else(|| invalid("종료 날짜 범위 오류"))?
            } else {
                start.at
            },
            all_day: start.all_day,
        },
    };
    if end.all_day != start.all_day || end.at < start.at || (start.all_day && end.at == start.at) {
        return Err(invalid("ICS 시작·종료 형식 또는 순서가 올바르지 않습니다."));
    }
    let occurrence_id = occurrence(identity);
    let cancelled = component
        .find_prop("STATUS")
        .is_some_and(|x| x.val.as_ref() == "CANCELLED");
    Ok(CalendarEvent {
        id: format!("{connection_id}:{}:{uid}:{occurrence_id}", uid.len()),
        connection_id: connection_id.into(),
        source_id: uid.into(),
        occurrence_id,
        title: component
            .find_prop("SUMMARY")
            .map(|x| x.val.to_string())
            .unwrap_or_else(|| "제목 없음".into()),
        start_at: if start.all_day {
            None
        } else {
            Some(start.at.timestamp_millis())
        },
        end_at: if start.all_day {
            None
        } else {
            Some(end.at.timestamp_millis())
        },
        start_date: if start.all_day {
            Some(start.at.format("%Y-%m-%d").to_string())
        } else {
            None
        },
        end_date: if start.all_day {
            Some(end.at.format("%Y-%m-%d").to_string())
        } else {
            None
        },
        time_zone: if start.all_day {
            None
        } else {
            Some(start.at.timezone().name().into())
        },
        all_day: start.all_day,
        cancelled,
        url: safe_url(component.find_prop("URL").map(|x| x.val.as_ref())),
        meeting_url: None,
    })
}
fn recurrent(
    component: &Component<'_>,
    start: &Moment,
    now: i64,
) -> Result<Vec<DateTime<Tz>>, CalendarError> {
    let mut set = RRuleSet::new(start.at).rdate(start.at);
    for property in &component.properties {
        match property.name.as_ref() {
            "RRULE" => {
                let value = property.val.as_ref();
                if !value.split(';').any(|part| {
                    ["FREQ=DAILY", "FREQ=WEEKLY", "FREQ=MONTHLY", "FREQ=YEARLY"].contains(&part)
                }) {
                    return Err(invalid(
                        "ICS 반복은 DAILY/WEEKLY/MONTHLY/YEARLY만 지원합니다.",
                    ));
                }
                if start.all_day
                    && value.split(';').any(|x| {
                        x.starts_with("BYHOUR=")
                            || x.starts_with("BYMINUTE=")
                            || x.starts_with("BYSECOND=")
                    })
                {
                    return Err(invalid("종일 일정에 시각 반복을 적용할 수 없습니다."));
                }
                let definition = value
                    .split(';')
                    .map(|part| {
                        let Some(until) = part.strip_prefix("UNTIL=") else {
                            return Ok(part.to_owned());
                        };
                        let date_only =
                            until.len() == 8 && until.bytes().all(|b| b.is_ascii_digit());
                        if start.all_day != date_only {
                            return Err(invalid("ICS 반복 종료 날짜의 형식이 원본과 다릅니다."));
                        }
                        if !start.all_day {
                            return Ok(part.to_owned());
                        }
                        let day = NaiveDate::parse_from_str(until, "%Y%m%d")
                            .map_err(|_| invalid("ICS 반복 종료 날짜 오류"))?;
                        // DATE values use UTC midnight internally; rrule otherwise parses UNTIL as local time.
                        Ok(format!("UNTIL={}T000000Z", day.format("%Y%m%d")))
                    })
                    .collect::<Result<Vec<_>, CalendarError>>()?
                    .join(";");
                let rule = definition
                    .parse::<rrule::RRule<rrule::Unvalidated>>()
                    .map_err(|_| invalid("지원하지 않거나 잘못된 ICS 반복 규칙입니다."))?
                    .validate(start.at)
                    .map_err(|_| invalid("ICS 반복 규칙 검증에 실패했습니다."))?;
                set = set.rrule(rule);
            }
            "RDATE" | "EXDATE" => {
                for value in property.val.as_ref().split(',') {
                    let mut single = property.clone();
                    single.val = value.to_owned().into();
                    let point = moment(&single)?;
                    if point.all_day != start.all_day {
                        return Err(invalid("ICS 반복 날짜의 형식이 원본과 다릅니다."));
                    }
                    if property.name.as_ref() == "RDATE" {
                        set = set.rdate(point.at);
                    } else {
                        set = set.exdate(point.at);
                    }
                }
            }
            _ => {}
        }
    }
    let lower = Tz::UTC
        .timestamp_millis_opt(now.saturating_sub(30 * DAY_MS))
        .single()
        .ok_or_else(|| invalid("조회 시각 오류"))?;
    let upper = Tz::UTC
        .timestamp_millis_opt(now.saturating_add(365 * DAY_MS))
        .single()
        .ok_or_else(|| invalid("조회 시각 오류"))?;
    let result = set.after(lower).before(upper).all((MAX_EVENTS + 1) as u16);
    if result.limited || result.dates.len() > MAX_EVENTS {
        return Err(invalid("ICS 반복 계산 또는 5000개 회차 한도를 넘었습니다."));
    }
    Ok(result.dates)
}
fn in_window(event: &CalendarEvent, now: i64) -> bool {
    let start = event.start_at.or_else(|| {
        event
            .start_date
            .as_ref()
            .and_then(|x| NaiveDate::parse_from_str(x, "%Y-%m-%d").ok())
            .and_then(|x| x.and_hms_opt(0, 0, 0))
            .map(|x| x.and_utc().timestamp_millis())
    });
    let end = event.end_at.or_else(|| {
        event
            .end_date
            .as_ref()
            .and_then(|x| NaiveDate::parse_from_str(x, "%Y-%m-%d").ok())
            .and_then(|x| x.and_hms_opt(0, 0, 0))
            .map(|x| x.and_utc().timestamp_millis())
    });
    start.is_some_and(|at| at < now.saturating_add(365 * DAY_MS))
        && end.is_some_and(|at| at >= now.saturating_sub(30 * DAY_MS))
}

pub fn parse_ics(
    text: &str,
    connection_id: &str,
    now: i64,
) -> Result<Vec<CalendarEvent>, CalendarError> {
    if text.len() > MAX_BYTES {
        return Err(invalid("ICS 파일이 4 MiB 한도를 넘었습니다."));
    }
    let unfolded = icalendar::parser::unfold(text);
    let roots = icalendar::parser::read_calendar_simple(&unfolded)
        .map_err(|_| invalid("ICS 문서 형식이 올바르지 않습니다."))?;
    if roots.len() != 1 || roots[0].name.as_ref() != "VCALENDAR" {
        return Err(invalid("하나의 VCALENDAR 문서가 필요합니다."));
    }
    let calendar = &roots[0];
    let mut groups: BTreeMap<String, Vec<&Component<'_>>> = BTreeMap::new();
    let mut total = 0;
    for component in &calendar.components {
        if component.name.as_ref() == "VTIMEZONE" {
            let timezone = required(component, "TZID")?.val.to_string();
            let probe =
                format!("DTSTART;TZID={timezone}:20260115T120000\nRRULE:FREQ=DAILY;COUNT=1");
            if probe.parse::<RRuleSet>().is_err() {
                return Err(invalid(
                    "사용자 정의 VTIMEZONE은 지원하지 않습니다. IANA TZID가 필요합니다.",
                ));
            }
            continue;
        }
        if component.name.as_ref() != "VEVENT" {
            continue;
        }
        validate(component)?;
        total += 1;
        if total > MAX_EVENTS {
            return Err(invalid("ICS 원본 일정이 5000개를 넘었습니다."));
        }
        let uid = required(component, "UID")?.val.to_string();
        if uid.is_empty() || uid.len() > 1000 {
            return Err(invalid("ICS UID가 올바르지 않습니다."));
        }
        groups.entry(uid).or_default().push(component);
    }
    let mut result = vec![];
    for (uid, components) in groups {
        let masters: Vec<_> = components
            .iter()
            .filter(|c| c.find_prop("RECURRENCE-ID").is_none())
            .collect();
        if masters.len() > 1 {
            return Err(invalid("동일한 UID의 ICS 원본 일정이 중복되었습니다."));
        }
        let mut occurrences: BTreeMap<String, CalendarEvent> = BTreeMap::new();
        if let Some(master) = masters.first() {
            let start = moment(required(master, "DTSTART")?)?;
            let template = event(master, connection_id, &uid, &start, &start)?;
            let dates = if master
                .properties
                .iter()
                .any(|x| ["RRULE", "RDATE", "EXDATE"].contains(&x.name.as_ref()))
            {
                recurrent(master, &start, now)?
            } else {
                vec![start.at]
            };
            let duration = if start.all_day {
                NaiveDate::parse_from_str(
                    template
                        .end_date
                        .as_deref()
                        .ok_or_else(|| invalid("종료 날짜 오류"))?,
                    "%Y-%m-%d",
                )
                .map_err(|_| invalid("종료 날짜 오류"))?
                .signed_duration_since(start.at.date_naive())
                .num_milliseconds()
            } else {
                template.end_at.ok_or_else(|| invalid("종료 시각 오류"))?
                    - start.at.timestamp_millis()
            };
            for at in dates {
                let moment = Moment {
                    at,
                    all_day: start.all_day,
                };
                let mut item = template.clone();
                item.occurrence_id = occurrence(&moment);
                item.id = format!("{connection_id}:{}:{uid}:{}", uid.len(), item.occurrence_id);
                if start.all_day {
                    item.start_date = Some(at.format("%Y-%m-%d").to_string());
                    item.end_date = Some(
                        at.checked_add_signed(chrono::Duration::milliseconds(duration))
                            .ok_or_else(|| invalid("종료 날짜 범위 오류"))?
                            .format("%Y-%m-%d")
                            .to_string(),
                    );
                } else {
                    item.start_at = Some(at.timestamp_millis());
                    item.end_at = Some(
                        at.timestamp_millis()
                            .checked_add(duration)
                            .ok_or_else(|| invalid("종료 시각 범위 오류"))?,
                    );
                }
                occurrences.insert(item.occurrence_id.clone(), item);
            }
        }
        let mut seen = BTreeSet::new();
        for component in components
            .iter()
            .filter(|c| c.find_prop("RECURRENCE-ID").is_some())
        {
            if component.find_prop("RRULE").is_some() || component.find_prop("RDATE").is_some() {
                return Err(invalid("개별 예외 회차의 반복 규칙은 지원하지 않습니다."));
            }
            let identity = moment(required(component, "RECURRENCE-ID")?)?;
            let key = occurrence(&identity);
            if !seen.insert(key.clone()) {
                return Err(invalid("ICS 예외 회차가 중복되었습니다."));
            }
            let cancelled = component
                .find_prop("STATUS")
                .is_some_and(|x| x.val.as_ref() == "CANCELLED");
            if cancelled {
                if let Some(existing) = occurrences.get_mut(&key) {
                    existing.cancelled = true;
                } else {
                    let mut item = event(component, connection_id, &uid, &identity, &identity)?;
                    item.cancelled = true;
                    occurrences.insert(key, item);
                }
                continue;
            }
            let start = moment(required(component, "DTSTART")?)?;
            if start.all_day != identity.all_day {
                return Err(invalid("예외 회차의 날짜 형식이 원본과 다릅니다."));
            }
            let item = event(component, connection_id, &uid, &start, &identity)?;
            occurrences.insert(key, item);
        }
        result.extend(
            occurrences
                .into_values()
                .filter(|item| in_window(item, now)),
        );
        if result.len() > MAX_EVENTS {
            return Err(invalid("조회 일정이 5000개를 넘었습니다."));
        }
    }
    result.sort_by(|a, b| {
        a.start_at
            .cmp(&b.start_at)
            .then(a.start_date.cmp(&b.start_date))
            .then(a.id.cmp(&b.id))
    });
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn now() -> i64 {
        DateTime::parse_from_rfc3339("2026-09-15T00:00:00Z")
            .unwrap()
            .timestamp_millis()
    }
    fn cal(events: &str) -> String {
        format!("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Comet//test//EN\r\n{events}END:VCALENDAR\r\n")
    }
    #[test]
    fn recurrence_exclusions_moved_and_cancelled_exceptions_keep_identity() {
        let source=cal("BEGIN:VEVENT\r\nUID:team\r\nDTSTART;TZID=Asia/Seoul:20260915T090000\r\nDTEND;TZID=Asia/Seoul:20260915T100000\r\nRRULE:FREQ=DAILY;COUNT=4\r\nEXDATE;TZID=Asia/Seoul:20260916T090000\r\nSUMMARY:회의\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:team\r\nRECURRENCE-ID;TZID=Asia/Seoul:20260917T090000\r\nDTSTART;TZID=Asia/Seoul:20260917T110000\r\nDTEND;TZID=Asia/Seoul:20260917T120000\r\nSUMMARY:옮긴 회의\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:team\r\nRECURRENCE-ID;TZID=Asia/Seoul:20260918T090000\r\nSTATUS:CANCELLED\r\nEND:VEVENT\r\n");
        let events = parse_ics(&source, "connection", now()).unwrap();
        assert_eq!(events.len(), 3);
        let moved = events.iter().find(|x| x.title == "옮긴 회의").unwrap();
        assert_eq!(
            moved.start_at.unwrap() - moved.occurrence_id.parse::<i64>().unwrap(),
            7200000
        );
        assert!(events.iter().any(|x| x.cancelled));
        assert!(events
            .iter()
            .all(|x| x.time_zone.as_deref() == Some("Asia/Seoul")));
    }
    #[test]
    fn all_day_and_folded_title_preserve_dates() {
        let events=parse_ics(&cal("BEGIN:VEVENT\r\nUID:trip\r\nDTSTART;VALUE=DATE:20260915\r\nDTEND;VALUE=DATE:20260917\r\nSUMMARY:가족과\r\n  여행\r\nRRULE:FREQ=WEEKLY;COUNT=2\r\nEND:VEVENT\r\n"),"c",now()).unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].start_date.as_deref(), Some("2026-09-15"));
        assert_eq!(events[0].end_date.as_deref(), Some("2026-09-17"));
        assert!(events[0].start_at.is_none());
        assert_eq!(events[0].title, "가족과 여행");
    }
    #[test]
    fn all_day_until_includes_last_date_and_preserves_exclusions() {
        let source = cal(concat!(
            "BEGIN:VEVENT\r\nUID:all-day-until\r\n",
            "DTSTART;VALUE=DATE:20260915\r\nDTEND;VALUE=DATE:20260917\r\n",
            "RRULE:FREQ=DAILY;UNTIL=20260918\r\n",
            "EXDATE;VALUE=DATE:20260916\r\nEND:VEVENT\r\n",
        ));
        let events = parse_ics(&source, "c", now()).unwrap();
        assert_eq!(
            events
                .iter()
                .map(|event| event.start_date.as_deref())
                .collect::<Vec<_>>(),
            [Some("2026-09-15"), Some("2026-09-17"), Some("2026-09-18")]
        );
        assert_eq!(events[2].end_date.as_deref(), Some("2026-09-20"));
        assert!(events
            .iter()
            .all(|event| event.all_day && event.start_at.is_none()));
    }
    #[test]
    fn monthly_all_day_until_and_timed_utc_until_preserve_boundaries() {
        let source = cal(concat!(
            "BEGIN:VEVENT\r\nUID:monthly\r\n",
            "DTSTART;VALUE=DATE:20260526\r\nDTEND;VALUE=DATE:20260527\r\n",
            "RRULE:FREQ=MONTHLY;UNTIL=20260926\r\nEND:VEVENT\r\n",
            "BEGIN:VEVENT\r\nUID:timed\r\n",
            "DTSTART;TZID=Asia/Seoul:20260915T090000\r\n",
            "DTEND;TZID=Asia/Seoul:20260915T100000\r\n",
            "RRULE:FREQ=DAILY;UNTIL=20260916T000000Z\r\nEND:VEVENT\r\n",
        ));
        let events = parse_ics(&source, "c", now()).unwrap();
        let dates: Vec<_> = events
            .iter()
            .filter_map(|event| event.start_date.as_deref())
            .collect();
        assert_eq!(dates, ["2026-08-26", "2026-09-26"]);
        let timed: Vec<_> = events.iter().filter_map(|event| event.start_at).collect();
        assert_eq!(timed, [now(), now() + DAY_MS]);
    }
    #[test]
    fn recurrence_until_rejects_mismatched_or_invalid_dates() {
        for fields in [
            "DTSTART;VALUE=DATE:20260915\r\nRRULE:FREQ=DAILY;UNTIL=20260918T000000Z\r\n",
            "DTSTART:20260915T090000Z\r\nRRULE:FREQ=DAILY;UNTIL=20260918\r\n",
            "DTSTART;VALUE=DATE:20260915\r\nRRULE:FREQ=DAILY;UNTIL=20260931\r\n",
            "DTSTART;VALUE=DATE:20260915\r\nRRULE:FREQ=DAILY;UNTIL=20260914\r\n",
        ] {
            let source = cal(&format!(
                "BEGIN:VEVENT\r\nUID:invalid-until\r\n{fields}END:VEVENT\r\n"
            ));
            assert!(parse_ics(&source, "c", now()).is_err());
        }
    }
    #[test]
    fn dst_recurrence_keeps_local_wall_clock() {
        let stamp = DateTime::parse_from_rfc3339("2026-03-01T00:00:00Z")
            .unwrap()
            .timestamp_millis();
        let events=parse_ics(&cal("BEGIN:VEVENT\r\nUID:dst\r\nDTSTART;TZID=America/New_York:20260307T090000\r\nDTEND;TZID=America/New_York:20260307T100000\r\nRRULE:FREQ=DAILY;COUNT=3\r\nEND:VEVENT\r\n"),"c",stamp).unwrap();
        assert_eq!(events.len(), 3);
        assert_eq!(
            events[1].start_at.unwrap() - events[0].start_at.unwrap(),
            23 * 3600000
        );
    }
    #[test]
    fn unsupported_floating_range_duration_and_bad_rule_fail_explicitly() {
        for fields in [
            "DTSTART:20260915T090000\r\n",
            "DTSTART:20260915T090000Z\r\nDURATION:PT1H\r\n",
            "DTSTART:20260915T090000Z\r\nRRULE:FREQ=SECONDLY\r\n",
            "DTSTART:20260915T090000Z\r\nRECURRENCE-ID;RANGE=THISANDFUTURE:20260915T090000Z\r\n",
        ] {
            let source = cal(&format!("BEGIN:VEVENT\r\nUID:a\r\n{fields}END:VEVENT\r\n"));
            assert!(parse_ics(&source, "c", now()).is_err());
        }
    }
}
