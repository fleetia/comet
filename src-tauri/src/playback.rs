pub fn reading_millis(text: &str) -> i64 {
    (2_000 + text.chars().count() as i64 * 65).clamp(2_800, 16_000)
}

pub fn line_duration_millis(text: &str, text_speed: u32) -> i64 {
    let reveal_millis = if text_speed == 0 {
        0
    } else {
        // Scalar counts keep the lifetime conservative when the UI reveals whole graphemes.
        (text.chars().count() as u64 * 1_000).div_ceil(u64::from(text_speed)) as i64
    };
    reveal_millis + reading_millis(text)
}

pub fn next_idle_at(now: i64, minutes: u32, entropy: u64) -> i64 {
    let seconds = i64::from(minutes.clamp(1, 60)) * 60;
    now + seconds * (80 + (entropy % 41) as i64) / 100
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
    fn text_reveal_finishes_before_the_full_reading_interval() {
        let text = "가😀";
        assert_eq!(line_duration_millis(text, 0), reading_millis(text));
        assert_eq!(line_duration_millis(text, 3), reading_millis(text) + 667);
        assert_eq!(line_duration_millis(text, 100), reading_millis(text) + 20);
        assert_eq!(line_duration_millis("가", 1), reading_millis("가") + 2_000);
        assert_eq!(line_duration_millis(&"가".repeat(500), 1), 516_000);
    }

    #[test]
    fn idle_talk_has_a_readable_end_and_bounded_variable_spacing() {
        assert!(reading_millis("짧은 말") < reading_millis(&"긴 이야기 ".repeat(20)));
        assert_eq!(reading_millis(&"가".repeat(2_000)), 16_000);
        let times: Vec<_> = (0..100).map(|seed| next_idle_at(100, 2, seed)).collect();
        assert!(times.iter().all(|time| (196..=244).contains(time)));
        assert_ne!(times[0], times[1]);
    }

    #[test]
    fn idle_source_preserves_wordbook_and_generated_rotation() {
        assert_eq!(idle_source(0, false, false), "script");
        assert_eq!(idle_source(0, false, true), "llm");
        assert_eq!(idle_source(1, true, true), "wordbook");
        assert_eq!(idle_source(2, true, true), "llm");
    }
}
