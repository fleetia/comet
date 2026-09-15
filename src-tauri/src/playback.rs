use crate::types::SceneLine;

pub fn reading_millis(text: &str) -> i64 {
    (2_000 + text.chars().count() as i64 * 65).clamp(2_800, 16_000)
}

pub fn next_idle_at(now: i64, minutes: u32, entropy: u64) -> i64 {
    let seconds = i64::from(minutes.clamp(1, 60)) * 60;
    now + seconds * (80 + (entropy % 41) as i64) / 100
}

pub fn builtin_scene(sequence: u64) -> Vec<SceneLine> {
    let scenes: &[&[(&str, &str, &str)]] = &[
        &[
            ("a", "기쁨", "왔네. 오늘도 여기서 같이 지내자."),
            (
                "b",
                "평온",
                "계속 대답해 주지는 않아도 돼. 우리끼리도 잘 놀거든.",
            ),
            ("a", "호기심", "그럼 오늘의 첫 번째 할 일은?"),
            ("b", "장난", "바탕화면 한쪽을 아주 성실하게 지키기."),
        ],
        &[
            (
                "a",
                "생각중",
                "아무것도 안 하는 것도 계획에 넣을 수 있을까?",
            ),
            ("b", "평온", "넣었어. 방금 시작했고."),
            ("a", "기쁨", "일 처리가 빠르네."),
        ],
        &[
            ("b", "호기심", "너는 심심할 때 무슨 생각 해?"),
            ("a", "생각중", "심심하지 않을 방법을 생각하지."),
            ("b", "장난", "그 생각만 해도 꽤 바쁘겠다."),
        ],
        &[
            ("a", "호기심", "우리한테 휴가가 생기면 어디로 갈까?"),
            ("b", "평온", "바탕화면 반대쪽."),
            ("a", "장난", "짐은 가볍게 챙겨도 되겠네."),
        ],
        &[
            ("a", "기쁨", "나 방금 멋진 말을 생각했어."),
            ("b", "호기심", "뭔데?"),
            ("a", "생각중", "말하려니까 잊어버렸어."),
            ("b", "장난", "그럼 아직 가능성은 무한하네."),
        ],
        &[
            ("b", "생각중", "작은 상자로 살아가는 기분은 어때?"),
            ("a", "기쁨", "정리가 잘 돼. 모서리가 있으니까."),
            ("b", "장난", "성격까지 네모나지면 곤란한데."),
        ],
        &[
            ("a", "호기심", "오늘은 조용히 있어 볼까?"),
            ("b", "평온", "좋아."),
            (
                "a",
                "생각중",
                "근데 조용히 뭘 할지는 이야기해야 하지 않을까?",
            ),
        ],
        &[
            ("a", "기쁨", "여기 우리 자리라고 작은 이름표라도 붙일까?"),
            ("b", "평온", "이미 이름이 붙어 있어."),
            ("a", "장난", "준비가 철저한 집이네."),
        ],
    ];
    scenes[sequence as usize % scenes.len()]
        .iter()
        .map(|(persona, expression, text)| SceneLine {
            persona: (*persona).into(),
            expression: (*expression).into(),
            text: (*text).into(),
        })
        .collect()
}

pub fn idle_source(sequence: u64, has_wordbook: bool, has_generated: bool) -> &'static str {
    if has_wordbook && (sequence % 2 == 1 || !has_generated) {
        "wordbook"
    } else if has_generated {
        "llm"
    } else {
        "script"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn idle_talk_has_a_readable_end_and_bounded_variable_spacing() {
        assert!(reading_millis("짧은 말") < reading_millis(&"긴 이야기 ".repeat(20)));
        assert_eq!(reading_millis(&"가".repeat(2_000)), 16_000);
        let times: Vec<_> = (0..100).map(|seed| next_idle_at(100, 2, seed)).collect();
        assert!(times.iter().all(|time| (196..=244).contains(time)));
        assert_ne!(times[0], times[1]);
    }

    #[test]
    fn cold_start_and_missing_model_still_have_alternating_conversations() {
        for index in 0..8 {
            let lines = builtin_scene(index);
            assert!((2..=4).contains(&lines.len()));
            assert!(lines
                .windows(2)
                .all(|pair| pair[0].persona != pair[1].persona));
            assert!(lines
                .iter()
                .all(|line| crate::domain::allowed_expression(&line.expression)));
        }
        assert_eq!(idle_source(0, false, false), "script");
        assert_eq!(idle_source(0, false, true), "llm");
        assert_eq!(idle_source(1, true, true), "wordbook");
        assert_eq!(idle_source(2, true, true), "llm");
    }
}
