#[derive(Clone, Copy, Debug, Default)]
pub struct SpeakConditions {
    pub hidden: bool,
    pub paused: bool,
    pub focused: bool,
    pub quiet_hours: bool,
    pub screen_locked: bool,
    pub fullscreen: bool,
    pub no_speaker: bool,
    pub sleeping: bool,
    pub bubble_disabled: bool,
    pub story_or_tutorial: bool,
    pub panel_or_input_open: bool,
    pub quick_launch_open: bool,
    pub recent_input: bool,
    pub widget_editing: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Decision {
    Speak,
    Wait,
    Report(&'static str),
}

pub fn decide(conditions: &SpeakConditions, scheduled_at: i64, now: i64) -> Decision {
    let blocked = [
        (conditions.hidden, "숨김 상태"),
        (conditions.paused, "쉬는 중"),
        (conditions.focused, "집중 중"),
        (conditions.quiet_hours, "조용한 시간"),
        (conditions.screen_locked, "화면 잠금"),
        (conditions.fullscreen, "전체 화면"),
        (conditions.no_speaker, "말할 친구가 없음"),
        (conditions.sleeping, "친구가 자는 중"),
        (conditions.bubble_disabled, "루틴 말풍선 꺼짐"),
    ];
    if let Some((_, reason)) = blocked.into_iter().find(|(active, _)| *active) {
        return Decision::Report(reason);
    }
    if now.saturating_sub(scheduled_at) >= 10 * 60 * 1000 {
        return Decision::Report("말할 수 있는 시간이 지남");
    }
    if conditions.story_or_tutorial
        || conditions.panel_or_input_open
        || conditions.quick_launch_open
        || conditions.recent_input
        || conditions.widget_editing
    {
        return Decision::Wait;
    }
    Decision::Speak
}

pub fn choose_occurrence(occurrences: &[(i64, i64)]) -> Option<usize> {
    occurrences
        .iter()
        .enumerate()
        .max_by(
            |(a_index, (a_time, a_created)), (b_index, (b_time, b_created))| {
                a_time
                    .cmp(b_time)
                    .then_with(|| b_created.cmp(a_created))
                    .then_with(|| b_index.cmp(a_index))
            },
        )
        .map(|(index, _)| index)
}

pub fn retry_decision(
    interrupted_by_input: bool,
    retried: bool,
    ready_since: Option<i64>,
    scheduled_at: i64,
    now: i64,
) -> Decision {
    if !interrupted_by_input || retried || now.saturating_sub(scheduled_at) > 30 * 60 * 1000 {
        return Decision::Report("다시 전할 수 있는 시간이 지남");
    }
    match ready_since {
        Some(since) if now.saturating_sub(since) >= 5 * 60 * 1000 => Decision::Speak,
        _ => Decision::Wait,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_blocks_send_immediately_to_reports() {
        let conditions = [
            SpeakConditions {
                hidden: true,
                ..Default::default()
            },
            SpeakConditions {
                paused: true,
                ..Default::default()
            },
            SpeakConditions {
                focused: true,
                ..Default::default()
            },
            SpeakConditions {
                quiet_hours: true,
                ..Default::default()
            },
            SpeakConditions {
                screen_locked: true,
                ..Default::default()
            },
            SpeakConditions {
                fullscreen: true,
                ..Default::default()
            },
            SpeakConditions {
                no_speaker: true,
                ..Default::default()
            },
            SpeakConditions {
                sleeping: true,
                ..Default::default()
            },
            SpeakConditions {
                bubble_disabled: true,
                ..Default::default()
            },
        ];
        for condition in conditions {
            assert!(matches!(decide(&condition, 0, 0), Decision::Report(_)));
        }
        assert!(matches!(
            decide(&SpeakConditions::default(), 1_000, 601_000),
            Decision::Report(_)
        ));
        assert_eq!(decide(&SpeakConditions::default(), 0, 0), Decision::Speak);
    }

    #[test]
    fn temporary_blocks_wait_only_until_ten_minutes() {
        let conditions = [
            SpeakConditions {
                story_or_tutorial: true,
                ..Default::default()
            },
            SpeakConditions {
                panel_or_input_open: true,
                ..Default::default()
            },
            SpeakConditions {
                quick_launch_open: true,
                ..Default::default()
            },
            SpeakConditions {
                recent_input: true,
                ..Default::default()
            },
            SpeakConditions {
                widget_editing: true,
                ..Default::default()
            },
        ];
        for condition in conditions {
            assert_eq!(decide(&condition, 1_000, 600_999), Decision::Wait);
            assert!(matches!(
                decide(&condition, 1_000, 601_000),
                Decision::Report(_)
            ));
        }
    }

    #[test]
    fn latest_scheduled_and_then_first_created_is_selected() {
        assert_eq!(choose_occurrence(&[]), None);
        assert_eq!(
            choose_occurrence(&[(1, 1), (2, 20), (2, 10), (2, 10)]),
            Some(2)
        );
    }

    #[test]
    fn retry_is_for_input_only_once_after_five_ready_minutes_within_thirty_minutes() {
        let five = 5 * 60 * 1000;
        let thirty = 30 * 60 * 1000;
        assert_eq!(retry_decision(true, false, None, 0, five), Decision::Wait);
        assert_eq!(
            retry_decision(true, false, Some(1), 0, five),
            Decision::Wait
        );
        assert_eq!(
            retry_decision(true, false, Some(1), 0, five + 1),
            Decision::Speak
        );
        assert_eq!(
            retry_decision(true, false, Some(0), 0, thirty),
            Decision::Speak
        );
        assert!(matches!(
            retry_decision(true, false, Some(0), 0, thirty + 1),
            Decision::Report(_)
        ));
        assert!(matches!(
            retry_decision(false, false, Some(0), 0, five),
            Decision::Report(_)
        ));
        assert!(matches!(
            retry_decision(true, true, Some(0), 0, five),
            Decision::Report(_)
        ));
    }
}
