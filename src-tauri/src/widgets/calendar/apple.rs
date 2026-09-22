use super::*;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppleCalendar {
    pub id: String,
    pub name: String,
    pub source_name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppleCalendars {
    pub supported: bool,
    pub authorization: String,
    pub calendars: Vec<AppleCalendar>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppleConnectInput {
    pub name: String,
    pub calendar_ids: Vec<String>,
}

pub fn connect(input: AppleConnectInput) -> Result<Connected, CalendarError> {
    validate_name(&input.name)?;
    validate_calendar_ids(&input.calendar_ids)?;
    if !cfg!(target_os = "macos") {
        return Err(error(
            "unsupported",
            "Apple 캘린더 직접 연결은 macOS에서 사용할 수 있습니다.",
        ));
    }
    let mut connection = connection(input.name, "apple");
    connection.selected_calendar_ids = input.calendar_ids.clone();
    let credential = Credential {
        connection_id: connection.id.clone(),
        provider: "apple".into(),
        url: None,
        client_id: None,
        client_secret: None,
        access_token: None,
        refresh_token: None,
        expires_at: None,
        calendar_ids: input.calendar_ids,
    };
    Ok(Connected {
        connection,
        credential,
    })
}

pub async fn list(request_access: bool) -> Result<AppleCalendars, CalendarError> {
    native_work(if request_access { 185 } else { 20 }, move || {
        native::list(request_access)
    })
    .await
}

pub async fn refresh(
    connection: &Connection,
    calendar_ids: Vec<String>,
    now: i64,
) -> Result<Refreshed, CalendarError> {
    validate_calendar_ids(&calendar_ids)?;
    let id = connection.id.clone();
    native_work(20, move || native::events(&id, &calendar_ids, now)).await
}

async fn native_work<T: Send + 'static>(
    seconds: u64,
    work: impl FnOnce() -> Result<T, CalendarError> + Send + 'static,
) -> Result<T, CalendarError> {
    static WORKERS: OnceLock<Arc<tokio::sync::Semaphore>> = OnceLock::new();
    let workers = WORKERS
        .get_or_init(|| Arc::new(tokio::sync::Semaphore::new(2)))
        .clone();
    tokio::time::timeout(Duration::from_secs(seconds), async move {
        let permit = workers
            .acquire_owned()
            .await
            .map_err(|_| invalid("Apple 캘린더 조회를 시작하지 못했습니다."))?;
        let (sender, receiver) = tokio::sync::oneshot::channel();
        // EventKit objects remain on this thread. Only owned Rust values cross the channel.
        std::thread::Builder::new()
            .name("calendar-eventkit".into())
            .spawn(move || {
                let _permit = permit;
                let _ = sender.send(work());
            })
            .map_err(|_| invalid("Apple 캘린더 조회를 시작하지 못했습니다."))?;
        receiver
            .await
            .map_err(|_| invalid("Apple 캘린더 조회가 중단되었습니다."))?
    })
    .await
    .map_err(|_| {
        error(
            "offline",
            "Apple 캘린더 응답을 기다리는 시간이 지났습니다. 권한을 확인하고 다시 조회해 주세요.",
        )
    })?
}

#[cfg(target_os = "macos")]
mod native {
    use super::*;
    use block2::RcBlock;
    use objc2::{rc::autoreleasepool, runtime::Bool};
    use objc2_event_kit::{EKAuthorizationStatus, EKEntityType, EKEventStatus, EKEventStore};
    use objc2_foundation::{NSArray, NSDate, NSError, NSTimeZone};

    fn authorization() -> EKAuthorizationStatus {
        // This class query never prompts for access or reads calendar data.
        unsafe { EKEventStore::authorizationStatusForEntityType(EKEntityType::Event) }
    }

    fn status_name(status: EKAuthorizationStatus) -> &'static str {
        match status {
            EKAuthorizationStatus::NotDetermined => "not-determined",
            EKAuthorizationStatus::FullAccess => "full-access",
            EKAuthorizationStatus::Denied => "denied",
            EKAuthorizationStatus::Restricted => "restricted",
            EKAuthorizationStatus::WriteOnly => "write-only",
            _ => "denied",
        }
    }

    pub fn list(request_access: bool) -> Result<AppleCalendars, CalendarError> {
        autoreleasepool(|_| {
            let status = authorization();
            if request_access
                && matches!(
                    status,
                    EKAuthorizationStatus::NotDetermined | EKAuthorizationStatus::WriteOnly
                )
            {
                let store = unsafe { EKEventStore::new() };
                let (sender, receiver) = std::sync::mpsc::sync_channel(1);
                let completion = RcBlock::new(move |granted: Bool, _: *mut NSError| {
                    let _ = sender.send(granted.as_bool());
                });
                // EventKit retains the completion block until its arbitrary-queue callback.
                unsafe {
                    store.requestFullAccessToEventsWithCompletion(RcBlock::as_ptr(&completion));
                }
                receiver
                    .recv_timeout(Duration::from_secs(180))
                    .map_err(|_| {
                        error(
                            "permission-needed",
                            "macOS 캘린더 권한 요청이 완료되지 않았습니다.",
                        )
                    })?;
            }
            let status = authorization();
            let mut calendars = vec![];
            if status == EKAuthorizationStatus::FullAccess {
                // Create after permission completion, so no pre-permission empty store is reused.
                let store = unsafe { EKEventStore::new() };
                let items = unsafe { store.calendarsForEntityType(EKEntityType::Event) };
                for calendar in items.iter() {
                    calendars.push(AppleCalendar {
                        id: unsafe { calendar.calendarIdentifier() }.to_string(),
                        name: unsafe { calendar.title() }.to_string(),
                        source_name: unsafe {
                            calendar.source().map(|source| source.title().to_string())
                        }
                        .unwrap_or_else(|| "이 Mac".into()),
                    });
                }
                calendars.sort_by(|a, b| (&a.source_name, &a.name).cmp(&(&b.source_name, &b.name)));
            }
            Ok(AppleCalendars {
                supported: true,
                authorization: status_name(status).into(),
                calendars,
            })
        })
    }

    fn millis(date: &NSDate) -> Result<i64, CalendarError> {
        let value = date.timeIntervalSince1970() * 1000.0;
        if !value.is_finite() || value < i64::MIN as f64 || value > i64::MAX as f64 {
            return Err(invalid("Apple 일정 시각이 올바르지 않습니다."));
        }
        Ok(value.round() as i64)
    }

    fn local_date(date: &NSDate, zone: &NSTimeZone) -> Result<chrono::NaiveDate, CalendarError> {
        let offset = i64::try_from(zone.secondsFromGMTForDate(date))
            .map_err(|_| invalid("Apple 일정 시간대 오류"))?;
        let local =
            DateTime::<Utc>::from_timestamp_millis(millis(date)?.saturating_add(offset * 1000))
                .ok_or_else(|| invalid("Apple 종일 일정 날짜 오류"))?;
        Ok(local.date_naive())
    }

    fn all_day_dates(
        start: &NSDate,
        end: &NSDate,
        zone: &NSTimeZone,
    ) -> Result<(String, String), CalendarError> {
        if millis(end)? < millis(start)? {
            return Err(invalid("Apple 종일 일정 종료 날짜 오류"));
        }
        let start_date = local_date(start, zone)?;
        // EventKit ends all-day events at 23:59:59 on their last included day.
        let end_date = local_date(end, zone)?
            .succ_opt()
            .ok_or_else(|| invalid("Apple 종일 일정 종료 날짜 오류"))?;
        if end_date <= start_date {
            return Err(invalid("Apple 종일 일정 종료 날짜 오류"));
        }
        Ok((start_date.to_string(), end_date.to_string()))
    }

    pub fn events(
        connection_id: &str,
        ids: &[String],
        now: i64,
    ) -> Result<Refreshed, CalendarError> {
        autoreleasepool(|_| {
            if authorization() != EKAuthorizationStatus::FullAccess {
                return Err(error("auth-error", "Apple 캘린더 읽기 권한이 필요합니다. 연결 설정에서 macOS 권한을 확인해 주세요."));
            }
            let store = unsafe { EKEventStore::new() };
            let available = unsafe { store.calendarsForEntityType(EKEntityType::Event) };
            let selected: Vec<_> = available
                .iter()
                .filter(|calendar| {
                    ids.contains(&unsafe { calendar.calendarIdentifier() }.to_string())
                })
                .collect();
            if selected.len() != ids.len() {
                return Err(error("auth-error", "선택했던 Apple 캘린더 일부를 찾을 수 없습니다. 캘린더 선택을 다시 확인해 주세요."));
            }
            let calendar_names = selected
                .iter()
                .map(|calendar| unsafe {
                    (
                        calendar.calendarIdentifier().to_string(),
                        calendar.title().to_string().chars().take(1000).collect(),
                    )
                })
                .collect();
            let calendars = NSArray::from_retained_slice(&selected);
            let start = NSDate::dateWithTimeIntervalSince1970(
                now.saturating_sub(30 * DAY_MS) as f64 / 1000.0,
            );
            let end = NSDate::dateWithTimeIntervalSince1970(
                now.saturating_add(365 * DAY_MS) as f64 / 1000.0,
            );
            let predicate = unsafe {
                store.predicateForEventsWithStartDate_endDate_calendars(
                    &start,
                    &end,
                    Some(&calendars),
                )
            };
            let occurrences = unsafe { store.eventsMatchingPredicate(&predicate) };
            if occurrences.len() > MAX_EVENTS {
                return Err(invalid(
                    "조회 일정이 5000개를 넘었습니다. 연결할 캘린더를 줄여 주세요.",
                ));
            }
            let zone = NSTimeZone::defaultTimeZone();
            let mut result = vec![];
            for event in occurrences.iter() {
                let source_id = unsafe {
                    event
                        .calendar()
                        .map(|calendar| calendar.calendarIdentifier().to_string())
                }
                .ok_or_else(|| invalid("Apple 일정의 캘린더를 확인하지 못했습니다."))?;
                let identifier = unsafe { event.eventIdentifier() }
                    .ok_or_else(|| invalid("Apple 일정 식별 정보가 없습니다."))?
                    .to_string();
                let start = unsafe { event.startDate() };
                let end = unsafe { event.endDate() };
                let occurrence = unsafe { event.occurrenceDate() }.unwrap_or_else(|| start.clone());
                let occurrence_id = millis(&occurrence)?.to_string();
                let all_day = unsafe { event.isAllDay() };
                let mut item = CalendarEvent {
                    id: format!("{connection_id}:{source_id}:{identifier}:{occurrence_id}"),
                    connection_id: connection_id.into(),
                    source_id,
                    occurrence_id,
                    title: unsafe { event.title() }
                        .to_string()
                        .chars()
                        .take(1000)
                        .collect(),
                    start_at: None,
                    end_at: None,
                    start_date: None,
                    end_date: None,
                    time_zone: unsafe { event.timeZone().map(|zone| zone.name().to_string()) },
                    all_day,
                    cancelled: unsafe { event.status() } == EKEventStatus::Canceled,
                    url: safe_url(
                        unsafe { event.URL() }
                            .and_then(|url| url.absoluteString())
                            .map(|url| url.to_string())
                            .as_deref(),
                    ),
                    meeting_url: None,
                };
                if all_day {
                    let (start_date, end_date) = all_day_dates(&start, &end, &zone)?;
                    item.start_date = Some(start_date);
                    item.end_date = Some(end_date);
                } else {
                    item.start_at = Some(millis(&start)?);
                    item.end_at = Some(millis(&end)?);
                    if item.end_at < item.start_at {
                        return Err(invalid("Apple 일정 종료 시각 오류"));
                    }
                }
                result.push(item);
            }
            Ok(Refreshed {
                events: result,
                calendar_names,
                credential: None,
            })
        })
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use objc2_event_kit::EKEvent;
        use objc2_foundation::NSString;

        #[test]
        fn all_day_eventkit_end_becomes_an_exclusive_date() {
            autoreleasepool(|_| {
                let store = unsafe { EKEventStore::new() };
                let event = unsafe { EKEvent::eventWithEventStore(&store) };
                let date = NSDate::dateWithTimeIntervalSince1970(1_790_029_800.0);
                unsafe {
                    event.setStartDate(Some(&date));
                    event.setEndDate(Some(&date));
                    event.setAllDay(true);
                }
                let zone = NSTimeZone::defaultTimeZone();
                let start = unsafe { event.startDate() };
                let end = unsafe { event.endDate() };
                let date = local_date(&start, &zone).unwrap();
                assert_eq!(local_date(&end, &zone).unwrap(), date);
                assert_eq!(
                    all_day_dates(&start, &end, &zone).unwrap(),
                    (date.to_string(), date.succ_opt().unwrap().to_string())
                );
            });
        }

        #[test]
        fn all_day_dates_preserve_last_day_and_dst_boundaries() {
            autoreleasepool(|_| {
                let zone =
                    NSTimeZone::timeZoneWithName(&NSString::from_str("America/New_York")).unwrap();
                let date = |value: &str| {
                    NSDate::dateWithTimeIntervalSince1970(
                        DateTime::parse_from_rfc3339(value).unwrap().timestamp() as f64,
                    )
                };
                for (start, end, expected_start, expected_end) in [
                    (
                        "2026-03-08T05:00:00Z",
                        "2026-03-09T03:59:59Z",
                        "2026-03-08",
                        "2026-03-09",
                    ),
                    (
                        "2026-03-07T05:00:00Z",
                        "2026-03-09T03:59:59Z",
                        "2026-03-07",
                        "2026-03-09",
                    ),
                    (
                        "2026-11-01T04:00:00Z",
                        "2026-11-02T04:59:59Z",
                        "2026-11-01",
                        "2026-11-02",
                    ),
                ] {
                    let start = date(start);
                    let end = date(end);
                    assert_eq!(
                        all_day_dates(&start, &end, &zone).unwrap(),
                        (expected_start.to_string(), expected_end.to_string())
                    );
                    assert!(all_day_dates(&end, &start, &zone).is_err());
                }
            });
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod native {
    use super::*;
    pub fn list(_: bool) -> Result<AppleCalendars, CalendarError> {
        Ok(AppleCalendars {
            supported: false,
            authorization: "unsupported".into(),
            calendars: vec![],
        })
    }
    pub fn events(_: &str, _: &[String], _: i64) -> Result<Refreshed, CalendarError> {
        Err(error(
            "unsupported",
            "Apple 캘린더 직접 연결은 macOS에서 사용할 수 있습니다.",
        ))
    }
}
