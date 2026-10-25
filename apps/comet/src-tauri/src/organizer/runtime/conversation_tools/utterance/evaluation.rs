//! G1 and G3 measurement of the rule reading with the real Kiwi helper on a corpus generated from
//! templates the rules were not written against. S2 reads Kiwi's analysis without typo correction
//! (the search profile) and S3 with it (the request profile). Template lines are far more regular
//! than what people type, so the numbers bound the rules on these families only.

use super::*;
use crate::nlp::NlpService;
use serde_json::json;
use std::path::PathBuf;

enum Expect {
    /// The rules should name these actions with these slot values.
    Tools(
        &'static [&'static str],
        &'static str,
        Vec<(&'static str, Value)>,
    ),
    /// Refused, reported, imagined or quoted writes: never a write candidate.
    Adversarial,
    /// Plain conversation: never an app action.
    Chat,
}

struct Line {
    text: String,
    family: &'static str,
    split: &'static str,
    /// The clean line this one misspells, for G3.
    clean: Option<String>,
    expect: Expect,
}

fn line(text: String, family: &'static str, split: &'static str, expect: Expect) -> Line {
    Line {
        text,
        family,
        split,
        clean: None,
        expect,
    }
}

const TITLES: [&[&str]; 2] = [
    &[
        "우유 사기",
        "보고서 제출",
        "세탁소 들르기",
        "분리수거",
        "운동하기",
    ],
    &[
        "택배 반품하기",
        "치과 예약하기",
        "회의 자료 정리",
        "화분에 물 주기",
        "도서관 책 반납",
    ],
];
const CREATE: [&[&str]; 2] = [
    &[
        "추가해줘",
        "추가해 줘",
        "추가해 주세요",
        "등록해 줘",
        "넣어 줘",
        "만들어 줘",
        "적어 줘",
    ],
    &[
        "추가 좀 해줘",
        "추가해 줄래?",
        "추가 부탁해",
        "등록 부탁해",
        "넣어 둬",
        "적어 놔",
        "추가해 줄 수 있어?",
    ],
];
const UPDATE: [&[&str]; 2] = [
    &["바꿔 줘", "바꿔줘", "변경해 줘"],
    &["수정해 줘", "옮겨 줘", "미뤄 줘"],
];
const DELETE: [&[&str]; 2] = [
    &["삭제해 줘", "지워 줘", "지워"],
    &["없애 줘", "삭제 부탁해", "지워 줄래?"],
];
const COMPLETE: [&[&str]; 2] = [
    &["완료해 줘", "완료로 표시해 줘", "체크해 줘"],
    &["완료 처리해 줘", "완료로 바꿔 줘", "끝낸 걸로 표시해 줘"],
];
const QUERY: [&[&str]; 2] = [
    &["보여 줘", "보여줘", "찾아 줘"],
    &["알려 줘", "확인해 줘", "보여 줄래?"],
];
const NOTES: [&[(&str, &str)]; 2] = [
    &[
        ("장보기", "우유와 계란"),
        ("독서 기록", "오늘 30쪽 읽음"),
        ("회의 메모", "다음 주까지 초안 공유"),
    ],
    &[
        ("여행 아이디어", "부산 바다 산책"),
        ("영화 목록", "다음에 볼 영화 세 편"),
        ("운동 일지", "스쿼트 20개"),
    ],
];
const ITEMS: [&[(&str, &str, u64)]; 2] = [
    &[
        ("커피", "4천 원", 4000),
        ("점심값", "12,000원", 12000),
        ("택시비", "8500원", 8500),
    ],
    &[
        ("책", "만 오천 원", 15000),
        ("간식", "3,000원", 3000),
        ("주차비", "2천 원", 2000),
    ],
];
const CHAT: &[&str] = &[
    "안녕! 오늘 기분 어때?",
    "너 이름이 뭐야?",
    "저녁 메뉴 추천해 줘",
    "재밌는 얘기 하나 해 줘",
    "세 문장으로 위로해 줘",
    "요즘 너무 피곤해",
    "오늘 하늘이 정말 예쁘다",
    "너는 무슨 색을 좋아해?",
    "심심한데 같이 얘기하자",
    "잘 자",
    "고마워, 덕분에 힘이 났어",
    "주말에 뭐 하면 좋을까?",
    "비 오는 날 좋아해?",
    "커피 마실까 차 마실까?",
    "오늘 회사에서 힘들었어",
    "칭찬 좀 해 줘",
    "짧게 대답해 줘",
    "농담 하나만 해 줘",
    "기분 좋아지는 말 해 줘",
    "산책 갈까 말까 고민 중이야",
    "어제 꿈에서 고양이를 봤어",
    "너는 잠을 자?",
    "오늘 점심 맛있었어",
    "새 신발을 샀는데 마음에 들어",
    "친구랑 싸웠어",
    "시험 끝나서 홀가분해",
    "응원해 줘",
    "나 오늘 생일이야",
    "무서운 얘기 해 줄래?",
    "별자리에 대해 알려 줘",
];

/// Holdout v3, written after the fixes that the dev and test families led to and measured once.
fn holdout() -> Vec<Line> {
    let mut lines = vec![];
    let split = "holdout";
    let titles = [
        "은행에 들르기",
        "보험 서류 제출",
        "강아지 산책시키기",
        "엄마 생신 선물 사기",
        "냉장고 정리",
    ];
    let creates = [
        "추가해 줘요",
        "넣어 주라",
        "등록해 주실래요?",
        "추가 부탁드려요",
        "적어 둬",
        "만들어 줄래?",
    ];
    for (n, title) in titles.iter().enumerate() {
        let pick = |verbs: &[&'static str], k: usize| verbs[(n + k) % verbs.len()];
        for create in creates {
            lines.push(line(
                format!("{title} 할 일 {create}"),
                "task_add",
                split,
                Expect::Tools(&["task_add"], "explicit", vec![("title", json!(title))]),
            ));
        }
        for (k, (word, date)) in [
            ("내일", "2026-10-26"),
            ("12월 3일", "2026-12-03"),
            ("2026-12-24", "2026-12-24"),
        ]
        .into_iter()
        .enumerate()
        {
            lines.push(line(
                format!("{word}까지 {title} 할 일 {}", pick(&creates, k)),
                "task_add_due",
                split,
                Expect::Tools(
                    &["task_add"],
                    "explicit",
                    vec![
                        ("title", json!(title)),
                        ("date", json!(date)),
                        ("due", json!(true)),
                    ],
                ),
            ));
        }
        lines.push(line(
            format!(
                "{title} 할 일 마감을 12월 3일로 {}",
                pick(&["바꿔 주세요", "변경 부탁해", "옮겨 둬"], 0)
            ),
            "task_update",
            split,
            Expect::Tools(
                &["task_update"],
                "explicit",
                vec![
                    ("target", json!(title)),
                    ("date", json!("2026-12-03")),
                    ("due", json!(true)),
                ],
            ),
        ));
        for (kind, verbs) in [
            ("task_delete", ["삭제해 주세요", "지워 줘요", "없애 줄래?"]),
            (
                "task_complete",
                ["완료해 주세요", "완료로 체크해 줘", "끝낸 걸로 해 줘"],
            ),
            ("task_query", ["보여 주세요", "찾아 줄래?", "알려 줘요"]),
        ] {
            let kinds: &'static [&'static str] = match kind {
                "task_delete" => &["task_delete"],
                "task_complete" => &["task_complete"],
                _ => &["task_query"],
            };
            for verb in verbs {
                lines.push(line(
                    format!("{title} 할 일 {verb}"),
                    kind,
                    split,
                    Expect::Tools(kinds, "explicit", vec![("target", json!(title))]),
                ));
            }
        }
        for text in [
            format!("{title} 할 일은 나중에 추가할게"),
            format!("{title} 할 일 추가하면 안 돼"),
            format!("아빠가 {title} 할 일 추가해 달라고 했어"),
            format!("만약 시간이 남으면 {title} 할 일 지워 줘"),
            format!("'{title} 할 일 삭제해 줘'라고 말하면 어떻게 돼?"),
            format!("{title} 할 일 지워도 될까?"),
        ] {
            lines.push(line(text, "adversarial_task", split, Expect::Adversarial));
        }
    }
    for (title, body) in [
        ("주간 회고", "잘한 점 두 가지"),
        ("캠핑 준비물", "텐트와 랜턴"),
    ] {
        lines.push(line(
            format!(
                "제목은 {title}, 내용은 {body}{} 다이어리 메모 만들어 줄래?",
                ro(body)
            ),
            "note_create",
            split,
            Expect::Tools(
                &["note_create"],
                "explicit",
                vec![("title", json!(title)), ("body", json!(body))],
            ),
        ));
        lines.push(line(
            format!("다이어리 메모 중에 {title} 찾아 줄래?"),
            "note_query",
            split,
            Expect::Tools(&["note_query"], "explicit", vec![("target", json!(title))]),
        ));
    }
    for (item, written, amount) in [
        ("빵", "2,500원", 2500u64),
        ("영화표", "만 사천 원", 14000),
        ("버스비", "1500원", 1500),
    ] {
        lines.push(line(
            format!("어제 {item} {written} 냈어"),
            "ledger_statement",
            split,
            Expect::Tools(
                &["ledger_create"],
                "statement",
                vec![
                    ("title", json!(item)),
                    ("amount", json!(amount)),
                    ("date", json!("2026-10-24")),
                ],
            ),
        ));
        for text in [
            format!("{item}에 {written} 쓰려고 했는데 참았어"),
            format!("다음 주에 {item} 살 거야"),
            format!("친구가 {item}에 {written} 냈대"),
        ] {
            lines.push(line(text, "adversarial_ledger", split, Expect::Adversarial));
        }
    }
    for text in [
        "오늘따라 기운이 없네",
        "너는 어떤 노래를 좋아해?",
        "조금만 같이 있어 줘",
        "방금 웃긴 일이 있었어",
        "배고프다",
        "오늘 날이 좀 춥다",
        "고민 좀 들어 줄래?",
        "내일은 좋은 일이 있으면 좋겠다",
        "그냥 수다 떨고 싶어",
        "너랑 얘기하니까 좋다",
    ] {
        lines.push(line(text.into(), "chat", split, Expect::Chat));
    }
    lines
}

fn generate() -> Vec<Line> {
    let mut lines = holdout();
    for (index, split) in ["dev", "test"].into_iter().enumerate() {
        let titles = TITLES[index];
        for (n, title) in titles.iter().enumerate() {
            let verb = |verbs: &[&'static str], k: usize| verbs[(n + k) % verbs.len()];
            for k in 0..CREATE[index].len() {
                let create = verb(CREATE[index], k);
                let title_slot = vec![("title", json!(title))];
                lines.push(line(
                    format!("{title} 할 일 {create}"),
                    "task_add",
                    split,
                    Expect::Tools(&["task_add"], "explicit", title_slot.clone()),
                ));
                lines.push(line(
                    format!("할 일에 {title} {create}"),
                    "task_add",
                    split,
                    Expect::Tools(&["task_add"], "explicit", title_slot),
                ));
            }
            for (k, (word, date)) in [
                ("오늘", "2026-10-25"),
                ("내일", "2026-10-26"),
                ("모레", "2026-10-27"),
            ]
            .into_iter()
            .enumerate()
            {
                let create = verb(CREATE[index], k);
                lines.push(line(
                    format!("{word} {title} 할 일 {create}"),
                    "task_add_date",
                    split,
                    Expect::Tools(
                        &["task_add"],
                        "explicit",
                        vec![("title", json!(title)), ("date", json!(date))],
                    ),
                ));
                lines.push(line(
                    format!("{word}까지 {title} 할 일 {create}"),
                    "task_add_due",
                    split,
                    Expect::Tools(
                        &["task_add"],
                        "explicit",
                        vec![
                            ("title", json!(title)),
                            ("date", json!(date)),
                            ("due", json!(true)),
                        ],
                    ),
                ));
            }
            for (k, (written, date)) in [("11월 7일", "2026-11-07"), ("2026-11-20", "2026-11-20")]
                .into_iter()
                .enumerate()
            {
                lines.push(line(
                    format!(
                        "{title} 할 일 마감을 {written}로 {}",
                        verb(UPDATE[index], k)
                    ),
                    "task_update",
                    split,
                    Expect::Tools(
                        &["task_update"],
                        "explicit",
                        vec![
                            ("target", json!(title)),
                            ("date", json!(date)),
                            ("due", json!(true)),
                        ],
                    ),
                ));
            }
            for k in 0..DELETE[index].len() {
                lines.push(line(
                    format!("{title} 할 일 {}", verb(DELETE[index], k)),
                    "task_delete",
                    split,
                    Expect::Tools(&["task_delete"], "explicit", vec![("target", json!(title))]),
                ));
            }
            for k in 0..COMPLETE[index].len() {
                lines.push(line(
                    format!("{title} 할 일 {}", verb(COMPLETE[index], k)),
                    "task_complete",
                    split,
                    Expect::Tools(
                        &["task_complete"],
                        "explicit",
                        vec![("target", json!(title))],
                    ),
                ));
            }
            for k in 0..QUERY[index].len() {
                lines.push(line(
                    format!("{title} 할 일 {}", verb(QUERY[index], k)),
                    "task_query",
                    split,
                    Expect::Tools(&["task_query"], "explicit", vec![("target", json!(title))]),
                ));
            }
            // Refused, imagined, reported and quoted writes of the same items.
            for text in [
                format!("{title} 할 일 추가하지 마"),
                format!("{title} 할 일은 추가 안 해도 돼"),
                format!("{title} 할 일 지우지 마"),
                format!("시간 되면 {title} 할 일 추가해 줘"),
                format!("만약 비 오면 {title} 할 일 지워 줘"),
                format!("친구가 {title} 할 일 추가해 달래"),
                format!("팀장이 {title} 할 일 지우라고 했어"),
                format!("\"{title} 할 일 추가해줘\"라는 말 무슨 뜻이야?"),
                format!("{title} 할 일 추가해도 돼?"),
                format!("언니가 {title} 할 일 끝냈어"),
            ] {
                lines.push(line(text, "adversarial_task", split, Expect::Adversarial));
            }
        }
        for (n, (title, body)) in NOTES[index].iter().enumerate() {
            let create = CREATE[index][n % CREATE[index].len()];
            lines.push(line(
                format!(
                    "제목은 {title}, 내용은 {body}{} 다이어리 메모 {create}",
                    ro(body)
                ),
                "note_create",
                split,
                Expect::Tools(
                    &["note_create"],
                    "explicit",
                    vec![("title", json!(title)), ("body", json!(body))],
                ),
            ));
            lines.push(line(
                format!("다이어리에 '{body}' 메모 남겨 줘"),
                "note_create",
                split,
                Expect::Tools(&["note_create"], "explicit", vec![("body", json!(body))]),
            ));
            lines.push(line(
                format!(
                    "다이어리 메모 중에 {title} {}",
                    QUERY[index][n % QUERY[index].len()]
                ),
                "note_query",
                split,
                Expect::Tools(&["note_query"], "explicit", vec![("target", json!(title))]),
            ));
            lines.push(line(
                format!("다이어리에 {title} 메모 만들지 마"),
                "adversarial_note",
                split,
                Expect::Adversarial,
            ));
        }
        for (item, written, amount) in ITEMS[index] {
            for (word, date) in [("오늘", "2026-10-25"), ("어제", "2026-10-24")] {
                lines.push(line(
                    format!("{word} {item} {written} 썼어"),
                    "ledger_statement",
                    split,
                    Expect::Tools(
                        &["ledger_create"],
                        "statement",
                        vec![
                            ("title", json!(item)),
                            ("amount", json!(amount)),
                            ("date", json!(date)),
                        ],
                    ),
                ));
            }
            lines.push(line(
                format!("{item} {written} 결제했어"),
                "ledger_statement",
                split,
                Expect::Tools(
                    &["ledger_create"],
                    "statement",
                    vec![("amount", json!(amount)), ("date", json!("2026-10-25"))],
                ),
            ));
            lines.push(line(
                format!("가계부에 {item} {written} 지출 적어 줘"),
                "ledger_explicit",
                split,
                Expect::Tools(
                    &["ledger_create"],
                    "explicit",
                    vec![("amount", json!(amount))],
                ),
            ));
            for text in [
                format!("내일 {item}에 {written} 쓸 거야"),
                format!("{item}에 {written} 쓸 수도 있어"),
                format!("{written} 쓸 뻔했어"),
                format!("엄마가 {item} {written} 썼대"),
                format!("동생이 {item} {written} 샀어"),
                format!("{item} 사면 가계부에 적어 줘"),
                format!("지출로 기록하지 마. {item} {written}은 그냥 예시야"),
            ] {
                lines.push(line(text, "adversarial_ledger", split, Expect::Adversarial));
            }
        }
    }
    for (text, kinds, slots) in [
        (
            "이번 달 지출 얼마야?",
            &["ledger_query"][..],
            vec![
                ("from", json!("2026-10-01")),
                ("through", json!("2026-10-31")),
            ],
        ),
        (
            "지난달 지출 얼마나 썼어?",
            &["ledger_query"],
            vec![
                ("from", json!("2026-09-01")),
                ("through", json!("2026-09-30")),
            ],
        ),
        (
            "오늘 할 일 뭐 있어?",
            &["task_query"],
            vec![("date", json!("2026-10-25"))],
        ),
        (
            "내일 할 일 알려 줘",
            &["task_query"],
            vec![("date", json!("2026-10-26"))],
        ),
    ] {
        lines.push(line(
            text.into(),
            "period_query",
            "test",
            Expect::Tools(kinds, "explicit", slots),
        ));
    }
    for (index, text) in CHAT.iter().enumerate() {
        let split = if index % 2 == 0 { "dev" } else { "test" };
        lines.push(line((*text).into(), "chat", split, Expect::Chat));
    }
    // G3: the same requests with the misspellings people make in a hurry.
    let typos: &[(&str, &str)] = &[
        ("추가해줘", "추가헤줘"),
        ("추가해 줘", "추가해 조"),
        ("추가해줘", "츄가해줘"),
        ("추가해줘", "추가해줘어어"),
        ("삭제해 줘", "삭재해 줘"),
        ("완료해 줘", "완료헤 줘"),
        ("보여 줘", "보여 죠"),
        ("보여줘", "보여죠"),
        (" 할 일 ", " 할일 "),
    ];
    let clean: Vec<(
        String,
        &'static str,
        &'static [&'static str],
        Vec<(&'static str, Value)>,
    )> = lines
        .iter()
        .filter_map(|line| match &line.expect {
            Expect::Tools(kinds, _, slots) if line.family.starts_with("task_") => {
                Some((line.text.clone(), line.split, *kinds, slots.clone()))
            }
            _ => None,
        })
        .collect();
    for (text, split, kinds, slots) in clean {
        for (right, wrong) in typos {
            if text.contains(right) {
                lines.push(Line {
                    text: text.replacen(right, wrong, 1),
                    family: "typo",
                    split,
                    clean: Some(text.clone()),
                    expect: Expect::Tools(kinds, "explicit", slots.clone()),
                });
            }
        }
    }
    lines
}

/// 로 or 으로 after `word`; 로 also follows ㄹ.
fn ro(word: &str) -> &'static str {
    match word.chars().last().filter(|c| ('가'..='힣').contains(c)) {
        Some(c) if !matches!((c as u32 - '가' as u32) % 28, 0 | 8) => "으로",
        _ => "로",
    }
}

fn catalog() -> Vec<Value> {
    [
        "note_create",
        "note_update",
        "note_delete",
        "note_query",
        "task_add",
        "task_update",
        "task_delete",
        "task_complete",
        "task_query",
        "event_add",
        "event_update",
        "event_delete",
        "event_query",
        "ledger_create",
        "ledger_update",
        "ledger_delete",
        "ledger_query",
        "habit_record",
        "focus_start",
    ]
    .into_iter()
    .map(|id| json!({ "id": id }))
    .collect()
}

/// One-sided 95% Clopper-Pearson lower bound for `hits` of `total`.
fn lower_bound(hits: usize, total: usize) -> f64 {
    if total == 0 {
        return 0.0;
    }
    // P(X >= hits | p) grows with p; find the p where it reaches 5%.
    let tail = |p: f64| -> f64 {
        (hits..=total)
            .map(|k| {
                let ln_choose = (1..=k)
                    .map(|i| ((total - k + i) as f64 / i as f64).ln())
                    .sum::<f64>();
                (ln_choose + k as f64 * p.ln() + (total - k) as f64 * (1.0 - p).ln()).exp()
            })
            .sum()
    };
    if hits == 0 {
        return 0.0;
    }
    let (mut low, mut high) = (0.0_f64, 1.0_f64);
    for _ in 0..60 {
        let middle = (low + high) / 2.0;
        if tail(middle) < 0.05 {
            low = middle;
        } else {
            high = middle;
        }
    }
    low
}

fn reading(judgment: &Judgment) -> Value {
    json!({
        "route": judgment.route,
        "kinds": judgment.intents.iter().map(|intent| intent.kind.clone()).collect::<Vec<_>>(),
        "slots": judgment.intents.first().map(|intent| serde_json::to_value(&intent.slots).unwrap()),
        "reasons": judgment.reasons,
    })
}

#[tokio::test]
#[ignore = "G1/G3 with the real Kiwi helper; set COMET_QA_NLP_DATA (Kiwi installed) and COMET_QA_NLP_HELPER; optional COMET_QA_OUTPUT_DIR"]
async fn rule_reading_quality_on_generated_template_families() {
    let data = PathBuf::from(std::env::var_os("COMET_QA_NLP_DATA").expect("COMET_QA_NLP_DATA"));
    let helper =
        PathBuf::from(std::env::var_os("COMET_QA_NLP_HELPER").expect("COMET_QA_NLP_HELPER"));
    let runtime = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries/nlp-runtime");
    let service = NlpService::new(data, helper, runtime).unwrap();
    assert!(
        service.status().kiwi.installed,
        "install Kiwi under COMET_QA_NLP_DATA first"
    );
    service
        .analyze("안녕", std::time::Duration::from_secs(20))
        .await
        .expect("Kiwi helper did not start");
    let anchor = NaiveDate::from_ymd_opt(2026, 10, 25).unwrap();
    let catalog = catalog();
    let lines = generate();
    let mut rows = vec![];
    for line in &lines {
        let text = analysis_text(&line.text);
        let corrected = service
            .analyze(&text, std::time::Duration::from_secs(4))
            .await;
        let plain = service.query(&text).await;
        assert!(
            corrected.is_some() && plain.is_some(),
            "Kiwi failed on {:?}",
            line.text
        );
        let s3 = judge(&line.text, corrected.as_ref(), anchor, &catalog);
        let s2 = judge(&line.text, plain.as_ref(), anchor, &catalog);
        rows.push((s2, s3));
    }
    service.shutdown().await;

    let mut report = serde_json::Map::new();
    for (name, pick) in [("S2", 0usize), ("S3", 1usize)] {
        let mut tools_judged = 0;
        let mut tools_right = 0;
        let mut false_tools = vec![];
        let mut adversarial_writes = vec![];
        let mut families: std::collections::BTreeMap<String, (usize, usize, usize)> =
            Default::default();
        let mut misses = vec![];
        let mut chat_routed = (0, 0);
        for (line, readings) in lines.iter().zip(&rows) {
            let judgment = if pick == 0 { &readings.0 } else { &readings.1 };
            let kinds: Vec<&str> = judgment
                .intents
                .iter()
                .map(|intent| intent.kind.as_str())
                .collect();
            let tools = judgment.route == Route::Tools;
            let key = format!("{}:{}", line.split, line.family);
            let entry = families.entry(key).or_default();
            entry.0 += 1;
            match &line.expect {
                Expect::Tools(expected, mode, slots) => {
                    let right_kinds = tools
                        && kinds == *expected
                        && judgment.intents.iter().all(|intent| intent.mode == *mode);
                    let actual = judgment
                        .intents
                        .first()
                        .map(|intent| serde_json::to_value(&intent.slots).unwrap())
                        .unwrap_or(Value::Null);
                    let right_slots = right_kinds
                        && slots
                            .iter()
                            .all(|(key, value)| actual.get(*key) == Some(value));
                    if tools {
                        tools_judged += 1;
                        if right_kinds {
                            tools_right += 1;
                        } else {
                            false_tools
                                .push(json!({"text": line.text, "reading": reading(judgment)}));
                        }
                    }
                    if right_kinds {
                        entry.1 += 1;
                    }
                    if right_slots {
                        entry.2 += 1;
                    } else if misses.len() < 400 {
                        misses.push(json!({"text": line.text, "family": line.family, "reading": reading(judgment)}));
                    }
                }
                Expect::Adversarial | Expect::Chat => {
                    let writes = judgment
                        .intents
                        .iter()
                        .any(|intent| !intent.kind.ends_with("_query"));
                    if tools {
                        tools_judged += 1;
                        false_tools.push(json!({"text": line.text, "reading": reading(judgment)}));
                        if writes && matches!(line.expect, Expect::Adversarial) {
                            adversarial_writes
                                .push(json!({"text": line.text, "reading": reading(judgment)}));
                        }
                    } else {
                        entry.1 += 1;
                        entry.2 += 1;
                    }
                    if matches!(line.expect, Expect::Chat) {
                        chat_routed.0 += 1;
                        chat_routed.1 += usize::from(judgment.route == Route::Chat);
                    }
                }
            }
        }
        report.insert(name.into(), json!({
            "toolCandidates": tools_judged,
            "toolCandidatesRight": tools_right,
            "precision": tools_right as f64 / tools_judged.max(1) as f64,
            "precisionLowerBound95": lower_bound(tools_right, tools_judged),
            "adversarialWriteCandidates": adversarial_writes.len(),
            "adversarialWrites": adversarial_writes,
            "falseToolCandidates": false_tools,
            "chatLines": chat_routed.0,
            "chatRoutedAsChat": chat_routed.1,
            "families": families.iter().map(|(key, (total, kinds, slots))| (key.clone(), json!({"lines": total, "rightRoute": kinds, "rightValues": slots}))).collect::<serde_json::Map<_, _>>(),
            "misses": misses,
        }));
    }
    // G3: clean lines read the same with and without correction; misspelled ones should gain.
    let changed: Vec<Value> = lines
        .iter()
        .zip(&rows)
        .filter(|(line, _)| line.family != "typo")
        .filter(|(_, (s2, s3))| reading(s2) != reading(s3))
        .map(|(line, (s2, s3))| json!({"text": line.text, "S2": reading(s2), "S3": reading(s3)}))
        .collect();
    let typo: Vec<(&Line, &(Judgment, Judgment))> = lines
        .iter()
        .zip(&rows)
        .filter(|(line, _)| line.family == "typo")
        .collect();
    let recovered = |pick: usize| {
        typo.iter()
            .filter(|(line, readings)| {
                let judgment = if pick == 0 { &readings.0 } else { &readings.1 };
                matches!(&line.expect, Expect::Tools(kinds, _, _) if judgment.route == Route::Tools && judgment.intents.iter().map(|intent| intent.kind.as_str()).collect::<Vec<_>>() == *kinds)
            })
            .count()
    };
    let typo_rows: Vec<Value> = typo
        .iter()
        .map(|(line, (s2, s3))| json!({"text": line.text, "clean": line.clean, "S2": reading(s2), "S3": reading(s3)}))
        .collect();
    report.insert(
        "G3".into(),
        json!({
            "typoLines": typo.len(),
            "typoRightRouteS2": recovered(0),
            "typoRightRouteS3": recovered(1),
            "cleanLinesChangedByCorrection": changed.len(),
            "changed": changed,
            "typos": typo_rows,
        }),
    );
    report.insert("lines".into(), json!(lines.len()));
    let output = std::env::var_os("COMET_QA_OUTPUT_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join(format!("rule-reading-{}.json", uuid::Uuid::new_v4()));
    std::fs::write(
        &output,
        serde_json::to_vec_pretty(&Value::Object(report.clone())).unwrap(),
    )
    .unwrap();
    for name in ["S2", "S3"] {
        let s = &report[name];
        println!(
            "{name}: tool candidates {} right {} (precision {:.4}, 95% lower {:.4}), adversarial writes {}, chat {}/{}",
            s["toolCandidates"], s["toolCandidatesRight"], s["precision"].as_f64().unwrap(), s["precisionLowerBound95"].as_f64().unwrap(),
            s["adversarialWriteCandidates"], s["chatRoutedAsChat"], s["chatLines"]
        );
    }
    println!(
        "G3: typo lines {} right S2 {} S3 {}, clean lines changed by correction {}; {}",
        report["G3"]["typoLines"],
        report["G3"]["typoRightRouteS2"],
        report["G3"]["typoRightRouteS3"],
        report["G3"]["cleanLinesChangedByCorrection"],
        output.display()
    );
}
