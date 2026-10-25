//! Rule-based reading of a chat request before any model call.
//!
//! Kiwi supplies morphemes with original byte spans. A rule decides only when its cues agree and
//! otherwise leaves the request to the LLM selector. A decision here is never an authorization:
//! every operation still passes the planner guards, revisions and receipts.

use crate::nlp::protocol::{Analysis, Token};
use chrono::{Datelike, Duration, NaiveDate};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::ops::Range;

pub(super) const RULE_VERSION: u32 = 1;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum Route {
    /// No app request: answer as ordinary conversation.
    Chat,
    /// The intents name the app actions.
    Tools,
    /// Leave the decision to the LLM selector.
    Ambiguous,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(super) struct Slots {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// The user labeled, quoted or pasted the title instead of naming it in passing.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub exact_title: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    /// The single calendar date (YYYY-MM-DD) the sentence names.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date: Option<String>,
    /// The date is a deadline (마감·기한·까지·due).
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub due: bool,
    /// A lookup period the sentence names (이번 달, 지난주), both ends included.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub through: Option<String>,
    /// The sentence names a clock time.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub time: bool,
    /// That clock time as HH:MM on a 24-hour clock, when the hour is unambiguous.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub clock: Option<String>,
    /// The sentence asks for a repetition (매일·매주·반복).
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub repeat: bool,
    /// The sentence mentions any date, deadline or time word at all.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub temporal: bool,
    /// A won amount.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub amount: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ledger_kind: Option<String>,
    /// Title of the existing item the request points at.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Intent {
    pub kind: String,
    pub mode: String,
    /// Exact substring of the request that carries the instruction.
    pub evidence: String,
    #[serde(default)]
    pub slots: Slots,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Judgment {
    pub rule_version: u32,
    pub route: Route,
    #[serde(default)]
    pub intents: Vec<Intent>,
    #[serde(default)]
    pub reasons: Vec<String>,
    /// The request has a request form that is not reported, refused or a permission question.
    #[serde(default)]
    pub explicit: bool,
    /// A decisive morpheme was read through Kiwi typo correction.
    #[serde(default)]
    pub corrected: bool,
}

impl Judgment {
    fn new(route: Route) -> Self {
        Self {
            rule_version: RULE_VERSION,
            route,
            intents: vec![],
            reasons: vec![],
            explicit: false,
            corrected: false,
        }
    }

    fn reason(&mut self, reason: &str) {
        if !self.reasons.iter().any(|known| known == reason) {
            self.reasons.push(reason.to_owned());
        }
    }

    pub(super) fn intent(&self, kind: &str) -> Option<&Intent> {
        self.intents.iter().find(|intent| intent.kind == kind)
    }
}

/// The text Kiwi should analyze for `request`. The colon that ends the instruction becomes a
/// period of the same byte length: Kiwi then closes the request sentence (`추가해:` otherwise
/// reads as one proper noun) and every span still points into the request.
pub(super) fn analysis_text(request: &str) -> std::borrow::Cow<'_, str> {
    let Some(end) = crate::organizer::actions::instruction_ranges(request)
        .last()
        .map(|range| range.end)
    else {
        return request.into();
    };
    match request[end..].chars().next() {
        Some(':') => format!("{}.{}", &request[..end], &request[end + 1..]).into(),
        Some('：') => format!("{}。{}", &request[..end], &request[end + '：'.len_utf8()..]).into(),
        _ => request.into(),
    }
}

/// Reads `request` with Kiwi's analysis of [`analysis_text`] against the current catalog.
pub(super) fn judge(
    request: &str,
    analysis: Option<&Analysis>,
    anchor: NaiveDate,
    available: &[Value],
) -> Judgment {
    let ids: Vec<&str> = available
        .iter()
        .filter_map(|spec| spec["id"].as_str())
        .collect();
    if !request.chars().any(is_hangul) {
        return english(request, &ids);
    }
    let Some(analysis) = analysis.filter(|analysis| analysis.kiwi_error.is_none()) else {
        let mut judgment = Judgment::new(Route::Ambiguous);
        judgment.reason("kiwi_unavailable");
        return judgment;
    };
    let instruction = crate::organizer::actions::instruction_ranges(request);
    let morphs: Vec<Morph> = analysis
        .tokens
        .iter()
        .enumerate()
        .filter(|(_, token)| {
            instruction
                .iter()
                .any(|range| range.start <= token.start && token.end <= range.end)
        })
        .map(|(index, token)| {
            let corrected = analysis.typo_corrected.contains(&(index as u32));
            let surface = request.get(token.start..token.end).unwrap_or_default();
            // Typo correction can turn a correct day word into another noun (모레 → 모래).
            if corrected && (TIME_WORDS.contains(&surface) || WEEKDAYS.contains(&surface)) {
                return Morph {
                    form: surface,
                    tag: "NNG",
                    start: token.start,
                    end: token.end,
                    corrected: false,
                };
            }
            Morph::new(token, corrected)
        })
        .collect();
    let generated: Vec<&str> = available
        .iter()
        .filter(|spec| {
            spec["id"]
                .as_str()
                .is_some_and(|id| id.starts_with("generated:"))
        })
        .filter_map(|spec| spec["title"].as_str())
        .filter(|title| !title.trim().is_empty())
        .collect();
    let mut reader = Reader {
        request,
        anchor,
        ids: &ids,
        body: colon_body(request, &instruction),
        quotes: quoted(request, &instruction),
        judgment: Judgment::new(Route::Ambiguous),
        unclear: false,
        blocked: false,
    };
    for sentence in sentences(request, &morphs) {
        reader.sentence(sentence);
    }
    let app = morphs.iter().any(app_word)
        || morphs.windows(3).any(|triple| task_word(triple))
        || generated.iter().any(|title| request.contains(title));
    let mut judgment = reader.judgment;
    judgment.route = if reader.unclear || judgment.intents.len() > 4 {
        Route::Ambiguous
    } else if !judgment.intents.is_empty() {
        Route::Tools
    } else if reader.blocked || !app {
        Route::Chat
    } else {
        Route::Ambiguous
    };
    if judgment.route != Route::Tools {
        judgment.intents.clear();
    }
    if judgment.route == Route::Chat && !reader.blocked {
        judgment.reason("no_app_request");
    }
    judgment
}

// ---------------------------------------------------------------------------------------------
// Morphemes and lexicon

#[derive(Clone, Copy, Debug)]
struct Morph<'a> {
    form: &'a str,
    tag: &'a str,
    start: usize,
    end: usize,
    corrected: bool,
}

impl<'a> Morph<'a> {
    fn new(token: &'a Token, corrected: bool) -> Self {
        Self {
            form: token.form.as_str(),
            // Kiwi marks irregular conjugation as VV-I/VV-R; the base tag is enough here.
            tag: token.tag.split('-').next().unwrap_or_default(),
            start: token.start,
            end: token.end,
            corrected,
        }
    }

    fn is(&self, form: &str, tag: &str) -> bool {
        self.form == form && self.tag == tag
    }

    fn one_of(&self, forms: &[&str], tag: &str) -> bool {
        self.tag == tag && forms.contains(&self.form)
    }

    fn punctuation(&self) -> bool {
        matches!(
            self.tag,
            "SF" | "SP" | "SS" | "SSO" | "SSC" | "SE" | "SO" | "SW" | "SB"
        )
    }

    fn predicate(&self) -> bool {
        matches!(self.tag, "VV" | "VA" | "VX" | "VCP" | "VCN" | "XSV" | "XSA")
    }

    fn nominal(&self) -> bool {
        matches!(
            self.tag,
            "NNG" | "NNP" | "NNB" | "NR" | "SL" | "SN" | "SH" | "XSN" | "XPN"
        )
    }

    /// Dates, weekdays, parts of the day and their units never belong to an item title.
    fn temporal(&self) -> bool {
        // 주 is also the auxiliary of 해 주세요.
        TIME_WORDS.contains(&self.form) && matches!(self.tag, "NNG" | "NNB" | "NNP" | "MAG")
            || WEEKDAYS.contains(&self.form)
            || self.one_of(&["년", "월", "일", "시", "분", "초", "주"], "NNB")
            || self.tag == "W_SERIAL"
    }
}

fn is_hangul(c: char) -> bool {
    ('가'..='힣').contains(&c) || ('ᄀ'..='ᇿ').contains(&c) || ('ㄱ'..='ㅣ').contains(&c)
}

fn text<'a>(request: &'a str, morphs: &[Morph]) -> &'a str {
    match (morphs.first(), morphs.last()) {
        (Some(first), Some(last)) if first.start <= last.end => {
            request[first.start..last.end].trim()
        }
        _ => "",
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Domain {
    Task,
    Note,
    Memo,
    Event,
    Ledger,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Op {
    Create,
    Update,
    Delete,
    Complete,
    Query,
}

const OPERATIONS: &[(&str, Op)] = &[
    ("추가", Op::Create),
    ("등록", Op::Create),
    ("넣", Op::Create),
    ("만들", Op::Create),
    ("적", Op::Create),
    ("기록", Op::Create),
    ("저장", Op::Create),
    ("메모", Op::Create),
    ("잡", Op::Create),
    ("생성", Op::Create),
    ("작성", Op::Create),
    ("남기", Op::Create),
    ("수정", Op::Update),
    ("바꾸", Op::Update),
    ("변경", Op::Update),
    ("옮기", Op::Update),
    ("고치", Op::Update),
    ("미루", Op::Update),
    ("삭제", Op::Delete),
    ("지우", Op::Delete),
    ("없애", Op::Delete),
    ("제거", Op::Delete),
    ("완료", Op::Complete),
    ("끝내", Op::Complete),
    ("체크", Op::Complete),
    ("보이", Op::Query),
    ("알리", Op::Query),
    ("찾", Op::Query),
    ("조회", Op::Query),
    ("확인", Op::Query),
    ("읽", Op::Query),
];

/// Words that point at some app feature. They keep a request away from plain conversation even
/// when no rule can name the action.
const APP_WORDS: &[&str] = &[
    "할일",
    "투두",
    "메모",
    "다이어리",
    "노트",
    "일기",
    "페이지",
    "일정",
    "약속",
    "캘린더",
    "스케줄",
    "지출",
    "수입",
    "가계부",
    "습관",
    "타이머",
    "집중",
    "포모도로",
    "휴식",
    "기념일",
    "디데이",
    "준비",
    "봉투",
    "체크리스트",
    "여행",
    "예약",
    "숙소",
    "항공",
    "정산",
    "공",
    "종이비행기",
    "비눗방울",
    "주사위",
    "동전",
    "운세",
    "날씨",
    "음악",
    "노래",
    "교감",
    "위젯",
    "자료",
    "기록",
    "정리",
    "요약",
    "검색",
    "저장",
    "기억",
    "프로젝트",
    "업무",
    "목록",
    "알림",
];

const PERSONS: &[&str] = &[
    "친구",
    "엄마",
    "아빠",
    "어머니",
    "아버지",
    "동생",
    "형",
    "오빠",
    "누나",
    "언니",
    "동료",
    "팀장",
    "선배",
    "후배",
    "남편",
    "아내",
    "와이프",
    "남친",
    "여친",
    "남자친구",
    "여자친구",
    "아들",
    "딸",
    "사장",
    "부장",
    "과장",
    "선생님",
    "할머니",
    "할아버지",
    "삼촌",
    "이모",
    "고모",
];

const SPEND: &[&str] = &["사", "쓰", "내", "결제", "지출", "구매", "구입", "지불"];
const EARN: &[&str] = &["받", "벌", "입금"];
const TIME_WORDS: &[&str] = &[
    "오늘",
    "내일",
    "모레",
    "어제",
    "그제",
    "그저께",
    "이번",
    "다음",
    "다다음",
    "지난",
    "주",
    "아침",
    "점심",
    "저녁",
    "오전",
    "오후",
    "밤",
    "새벽",
    "주말",
    "저번",
    "달",
    "이달",
    "이번달",
    "다음달",
    "지난달",
    "저번달",
    "이번주",
    "다음주",
    "지난주",
    "저번주",
];
const WEEKDAYS: &[&str] = &[
    "월요일",
    "화요일",
    "수요일",
    "목요일",
    "금요일",
    "토요일",
    "일요일",
];
const CONNECTIVES: &[&str] = &[
    "고",
    "지만",
    "는데",
    "ᆫ데",
    "은데",
    "니까",
    "으니까",
    "어서",
    "아서",
    "서",
    "면",
    "으면",
    "다면",
    "라면",
    "ᆫ다면",
    "는다면",
    "거든",
];
const CONDITIONALS: &[&str] = &["면", "으면", "다면", "라면", "ᆫ다면", "는다면", "거든"];
const SOFTENERS: &[&str] = &["좀", "좀만", "한번", "빨리", "꼭", "바로", "얼른", "다시"];
const REMINDER: &[&str] = &["잊", "까먹", "리마인드", "리마인더"];
const FEATURE_WORDS: &[&str] = &[
    "할일",
    "투두",
    "메모",
    "다이어리",
    "노트",
    "일정",
    "약속",
    "캘린더",
    "스케줄",
    "지출",
    "수입",
    "가계부",
    "바탕화면",
    "화면",
    "데스크톱",
    "데스크탑",
];
const REPEAT_WORDS: &[&str] = &[
    "매일", "매주", "매달", "매월", "매년", "반복", "마다", "격주",
];

fn operation(lemma: &str) -> Option<Op> {
    OPERATIONS
        .iter()
        .find(|(word, _)| *word == lemma)
        .map(|(_, op)| *op)
}

fn app_word(morph: &Morph) -> bool {
    APP_WORDS.contains(&morph.form) || operation(morph.form).is_some()
}

/// 할 일 / 할일: 하/VV ᆯ/ETM 일/NNG (Kiwi also reads 하 as VX in 새 할 일, 해야 할 일).
fn task_word(morphs: &[Morph]) -> bool {
    morphs.len() >= 3
        && morphs[0].form == "하"
        && matches!(morphs[0].tag, "VV" | "VX" | "XSV")
        && morphs[1].is("ᆯ", "ETM")
        && morphs[2].form == "일"
        && matches!(morphs[2].tag, "NNG" | "NNB")
}

fn action(domain: Domain, op: Op) -> Option<&'static str> {
    Some(match (domain, op) {
        (Domain::Task, Op::Create) => "task_add",
        (Domain::Task, Op::Update) => "task_update",
        (Domain::Task, Op::Delete) => "task_delete",
        (Domain::Task, Op::Complete) => "task_complete",
        (Domain::Task, Op::Query) => "task_query",
        (Domain::Note, Op::Create) => "note_create",
        (Domain::Note, Op::Update) => "note_update",
        (Domain::Note, Op::Delete) => "note_delete",
        (Domain::Note, Op::Query) => "note_query",
        (Domain::Memo, Op::Create) => "memo_create",
        (Domain::Memo, Op::Update) => "memo_update",
        (Domain::Memo, Op::Delete) => "memo_delete",
        (Domain::Memo, Op::Query) => "memo_query",
        (Domain::Event, Op::Create) => "event_add",
        (Domain::Event, Op::Update) => "event_update",
        (Domain::Event, Op::Delete) => "event_delete",
        (Domain::Event, Op::Query) => "event_query",
        (Domain::Ledger, Op::Create) => "ledger_create",
        (Domain::Ledger, Op::Update) => "ledger_update",
        (Domain::Ledger, Op::Delete) => "ledger_delete",
        (Domain::Ledger, Op::Query) => "ledger_query",
        _ => return None,
    })
}

// ---------------------------------------------------------------------------------------------
// Sentences and clauses

/// Splits at sentence punctuation and line breaks.
fn sentences<'m, 'a>(request: &str, morphs: &'m [Morph<'a>]) -> Vec<&'m [Morph<'a>]> {
    let mut parts = vec![];
    let mut start = 0;
    for index in 0..morphs.len() {
        // Morphemes of one syllable share its span, so only a real gap can hold a line break.
        let line_break = morphs.get(index + 1).is_some_and(|next| {
            next.start > morphs[index].end && request[morphs[index].end..next.start].contains('\n')
        });
        if morphs[index].tag == "SF" || line_break || index + 1 == morphs.len() {
            parts.push(&morphs[start..=index]);
            start = index + 1;
        }
    }
    parts
}

/// Splits a sentence at clause-final connective endings: 저장하지 말고 | 보여줘.
fn clauses<'m, 'a>(sentence: &'m [Morph<'a>]) -> Vec<Range<usize>> {
    let mut parts = vec![];
    let mut start = 0;
    for index in 1..sentence.len() {
        let joint = sentence[index].tag == "EC"
            && CONNECTIVES.contains(&sentence[index].form)
            && (sentence[index - 1].predicate() || sentence[index - 1].tag == "EP")
            && sentence[index + 1..]
                .iter()
                .any(|morph| !morph.punctuation());
        if joint {
            parts.push(start..index + 1);
            start = index + 1;
        }
    }
    if start < sentence.len() {
        parts.push(start..sentence.len());
    }
    parts
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Mood {
    Request,
    Question,
    Statement,
}

/// What the clause-final predicate says. Indices are relative to the clause.
#[derive(Debug)]
struct Predicate {
    mood: Mood,
    /// Lemma of the action: the noun before 하다 or the verb stem.
    lemma: String,
    /// First morph of the predicate phrase (action noun or verb).
    first: usize,
    /// Last non-punctuation morph.
    last: usize,
    prohibited: bool,
    negative: bool,
    reported: bool,
    permission: bool,
    past: bool,
    future: bool,
    possible: bool,
    corrected: bool,
}

fn predicate(clause: &[Morph]) -> Option<Predicate> {
    let last = clause.iter().rposition(|morph| !morph.punctuation())?;
    let question = clause[last..].iter().any(|morph| morph.is("?", "SF"));
    let mut index = last;
    let mut auxiliaries = vec![];
    let mut endings = vec![];
    let (mut past, mut future, mut possible) = (false, false, false);
    // Walk back over endings and auxiliaries to the main predicate.
    loop {
        let morph = clause[index];
        let next = match morph.tag {
            "EF" | "EC" | "EP" => {
                endings.push(morph.form);
                past |= morph.tag == "EP" && matches!(morph.form, "었" | "았" | "였");
                future |= morph.tag == "EP" && morph.form == "겠";
                index.checked_sub(1)
            }
            "VX" => {
                auxiliaries.push(morph.form);
                index.checked_sub(1)
            }
            // 주실래요: the polite particle after the ending.
            "JX" if morph.form == "요" && index == last => index.checked_sub(1),
            // -ㄹ 수(도) 있다: a request after 주다, otherwise a possibility.
            "VA" if morph.form == "있" => {
                let bound = if index >= 1 && clause[index - 1].is("도", "JX") {
                    index.checked_sub(2)
                } else {
                    index.checked_sub(1)
                };
                match bound {
                    Some(bound)
                        if bound >= 2
                            && clause[bound].is("수", "NNB")
                            && clause[bound - 1].tag == "ETM" =>
                    {
                        if clause[bound - 2].one_of(&["주", "드리"], "VX") {
                            auxiliaries.push("줄 수 있");
                        } else {
                            possible = true;
                        }
                        Some(bound - 2)
                    }
                    _ => None,
                }
            }
            // -ㄹ 거(것)다: a plan or prediction.
            "VCP"
                if index >= 3
                    && clause[index - 1].one_of(&["거", "것"], "NNB")
                    && clause[index - 2].tag == "ETM" =>
            {
                future = true;
                Some(index - 3)
            }
            // The main predicate itself.
            _ => None,
        };
        match next {
            Some(next) => index = next,
            None => break,
        }
    }
    let main = clause[index];
    if !main.predicate() {
        return None;
    }
    let mut first = index;
    let mut lemma = main.form.to_owned();
    let mut please = false;
    if main.form == "하" && matches!(main.tag, "XSV" | "VV") {
        let mut back = index;
        while back > 0 && clause[back - 1].one_of(SOFTENERS, "MAG") {
            back -= 1;
        }
        if back > 0 && clause[back - 1].is("부탁", "NNG") {
            please = true;
            back -= 1;
        }
        if back > 0 && clause[back - 1].tag == "NNG" {
            back -= 1;
            // 완료 처리해 줘: the light noun leaves the action to the noun before it.
            if clause[back].one_of(&["처리", "진행"], "NNG")
                && back > 0
                && clause[back - 1].tag == "NNG"
            {
                back -= 1;
            }
            lemma = clause[back].form.to_owned();
            first = back;
        }
    } else if main.is("먹", "VV")
        && index >= 2
        && clause[index - 1].tag == "EC"
        && clause[index - 2].is("사", "VV")
    {
        // 사 먹다: buying is the action.
        lemma = "사".into();
        first = index - 2;
    }
    let reported = clause.iter().any(|morph| {
        morph.one_of(&["라고", "다고", "자고", "냐고"], "EC")
            || morph.is("달", "VX")
            || morph.one_of(
                &[
                    "대", "래", "ᆫ대", "는대", "재", "냬", "단다", "란다", "대요", "래요",
                ],
                "EF",
            )
    });
    let permission =
        index > 0 && main.is("되", "VV") && clause[index - 1].one_of(&["어도", "아도"], "EC");
    let prohibited = clause
        .windows(2)
        .any(|pair| pair[0].is("지", "EC") && pair[1].is("말", "VX"));
    let negative = clause
        .windows(2)
        .any(|pair| pair[0].is("지", "EC") && pair[1].is("않", "VX"))
        || first > 0 && clause[first - 1].one_of(&["안", "못"], "MAG");
    future |= endings
        .iter()
        .any(|form| matches!(*form, "려고" | "으려고"));
    let final_ending = endings.first().copied().unwrap_or_default();
    let imperative = matches!(
        final_ending,
        "어" | "아"
            | "여"
            | "라"
            | "어라"
            | "아라"
            | "거라"
            | "렴"
            | "으렴"
            | "어요"
            | "아요"
            | "여요"
    );
    let request = !past
        && (auxiliaries
            .iter()
            .any(|aux| matches!(*aux, "주" | "드리" | "줄 수 있"))
            || auxiliaries.iter().any(|aux| matches!(*aux, "두" | "놓")) && imperative
            || matches!(
                final_ending,
                "세요" | "으세요" | "십시오" | "으십시오" | "시오" | "자" | "ᆸ시다" | "읍시다"
            )
            || please
            || auxiliaries.is_empty() && imperative && !question && operation(&lemma).is_some());
    let question = question
        || matches!(
            final_ending,
            "니" | "냐" | "나" | "까" | "ᆯ까" | "을까" | "나요" | "ᆸ니까" | "습니까"
        );
    Some(Predicate {
        mood: if prohibited || request {
            Mood::Request
        } else if question {
            Mood::Question
        } else {
            Mood::Statement
        },
        lemma,
        first,
        last,
        prohibited,
        negative,
        reported,
        permission,
        past,
        future,
        possible,
        corrected: clause[first..=last].iter().any(|morph| morph.corrected),
    })
}

// ---------------------------------------------------------------------------------------------
// Domains and slots

struct DomainWord {
    domain: Domain,
    /// Morph range of the word, e.g. 하/VV ᆯ/ETM 일/NNG for 할 일.
    range: Range<usize>,
    /// Index of a locative particle after the word: 할 일에, 메모로, 메모 중에.
    locative: Option<usize>,
    corrected: bool,
}

fn desktop(sentence: &[Morph]) -> bool {
    sentence
        .windows(2)
        .any(|pair| pair[0].is("바탕", "NNG") && pair[1].is("화면", "NNG"))
        || sentence
            .iter()
            .any(|morph| morph.one_of(&["바탕화면", "데스크톱", "데스크탑"], "NNG"))
}

fn domain_words(sentence: &[Morph]) -> Vec<DomainWord> {
    let desktop = desktop(sentence);
    let mut words = vec![];
    let mut index = 0;
    while index < sentence.len() {
        let (domain, length) = if task_word(&sentence[index..]) {
            (Some(Domain::Task), 3)
        } else if sentence[index].tag == "NNG" {
            let domain = match sentence[index].form {
                "할일" | "투두" => Some(Domain::Task),
                "메모" if desktop => Some(Domain::Memo),
                "메모" | "다이어리" | "노트" => Some(Domain::Note),
                "일정" | "약속" | "캘린더" | "스케줄" => Some(Domain::Event),
                "지출" | "수입" | "가계부" => Some(Domain::Ledger),
                _ => None,
            };
            (domain, 1)
        } else {
            (None, 1)
        };
        if let Some(domain) = domain {
            let range = index..index + length;
            let mut after = range.end;
            if sentence
                .get(after)
                .is_some_and(|morph| morph.is("중", "NNB"))
            {
                after += 1;
            }
            let locative = sentence
                .get(after)
                .is_some_and(|morph| {
                    morph.one_of(&["에", "로", "으로", "에다", "에다가", "에서"], "JKB")
                })
                .then_some(after);
            words.push(DomainWord {
                domain,
                corrected: sentence[range.clone()].iter().any(|morph| morph.corrected),
                range,
                locative,
            });
        }
        index += length;
    }
    words
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Label {
    Title,
    Body,
    Due,
}

/// `제목이 X이고`, `본문은 정확히 Y인`, `마감을 11월 7일로`.
fn labels(sentence: &[Morph]) -> Vec<(Label, Range<usize>)> {
    let mut found = vec![];
    let mut index = 0;
    while index + 2 < sentence.len() {
        let label = match sentence[index].form {
            "제목" | "이름" => Some(Label::Title),
            "본문" | "내용" => Some(Label::Body),
            "마감" | "마감일" | "기한" | "데드라인" => Some(Label::Due),
            _ => None,
        }
        .filter(|_| sentence[index].tag == "NNG");
        let particle = sentence[index + 1].tag;
        let Some(label) = label.filter(|label| {
            matches!(particle, "JKS" | "JX") || *label == Label::Due && particle == "JKO"
        }) else {
            index += 1;
            continue;
        };
        let mut start = index + 2;
        if sentence[start].one_of(&["정확히", "그대로", "딱"], "MAG") {
            start += 1;
        }
        let mut stop = start;
        while stop < sentence.len() {
            let morph = sentence[stop];
            // Kiwi can read the copula glued to a Latin value as a noun: `line.인`.
            let glued = stop > start
                && morph.start == sentence[stop - 1].end
                && morph.tag == "NNG"
                && matches!(morph.form, "인" | "이고" | "이며");
            if glued
                || matches!(morph.tag, "VCP" | "JKS" | "JKO" | "EC" | "EF" | "SF")
                // A body can hold 까지 or 볼 영화; a title stops there.
                || matches!(morph.tag, "JX" | "ETM") && label != Label::Body
                || morph.one_of(&["로", "으로"], "JKB")
                || morph.is(",", "SP")
            {
                break;
            }
            stop += 1;
        }
        if stop > start {
            found.push((label, start..stop));
        }
        index = stop.max(index + 1);
    }
    found
}

fn dates(sentence: &[Morph], anchor: NaiveDate) -> Vec<(NaiveDate, Range<usize>)> {
    let mut found = vec![];
    let mut index = 0;
    while index < sentence.len() {
        let morph = sentence[index];
        let relative = match morph.form {
            "오늘" => Some(0),
            "내일" => Some(1),
            "모레" => Some(2),
            "어제" => Some(-1),
            "그제" | "그저께" => Some(-2),
            _ => None,
        }
        .filter(|_| matches!(morph.tag, "NNG" | "MAG"));
        let (date, length) = if let Some(days) = relative {
            (Some(anchor + Duration::days(days)), 1)
        } else if morph.tag == "W_SERIAL" {
            (
                NaiveDate::parse_from_str(morph.form, "%Y-%m-%d")
                    .ok()
                    .filter(|date| date.format("%Y-%m-%d").to_string() == morph.form),
                1,
            )
        } else if index + 3 < sentence.len()
            && morph.tag == "SN"
            && sentence[index + 1].is("월", "NNB")
            && sentence[index + 2].tag == "SN"
            && sentence[index + 3].is("일", "NNB")
        {
            let date = morph
                .form
                .parse()
                .ok()
                .zip(sentence[index + 2].form.parse().ok())
                .and_then(|(month, day)| NaiveDate::from_ymd_opt(anchor.year(), month, day));
            (date, 4)
        } else if index + 2 < sentence.len()
            && morph.one_of(&["이번", "다음"], "NNG")
            && sentence[index + 1].is("주", "NNG")
        {
            let date = WEEKDAYS
                .iter()
                .position(|day| sentence[index + 2].is(day, "NNG"))
                .map(|weekday| {
                    let monday =
                        anchor - Duration::days(anchor.weekday().num_days_from_monday() as i64);
                    let week = if morph.form == "다음" { 7 } else { 0 };
                    monday + Duration::days(week + weekday as i64)
                });
            (date, 3)
        } else {
            (None, 1)
        };
        if let Some(date) = date {
            found.push((date, index..index + length));
            index += length;
        } else {
            index += 1;
        }
    }
    found
}

/// The month or week a lookup names: 이번 달, 지난달, 이번 주, 저번 주. A week day after 주 names a
/// date instead (다음 주 금요일).
fn period(sentence: &[Morph], anchor: NaiveDate) -> Option<(NaiveDate, NaiveDate)> {
    for (index, morph) in sentence.iter().enumerate() {
        if morph.tag != "NNG" {
            continue;
        }
        let (shift, unit, after) = match morph.form {
            "이달" | "이번달" => (0, "달", index + 1),
            "다음달" => (1, "달", index + 1),
            "지난달" | "저번달" => (-1, "달", index + 1),
            "이번주" => (0, "주", index + 1),
            "다음주" => (1, "주", index + 1),
            "지난주" | "저번주" => (-1, "주", index + 1),
            "이번" | "다음" | "지난" | "저번" => {
                let Some(unit) = sentence
                    .get(index + 1)
                    .filter(|next| next.one_of(&["달", "주"], "NNG"))
                else {
                    continue;
                };
                let shift = match morph.form {
                    "이번" => 0,
                    "다음" => 1,
                    _ => -1,
                };
                (shift, unit.form, index + 2)
            }
            _ => continue,
        };
        if unit == "주" {
            if sentence
                .get(after)
                .is_some_and(|next| WEEKDAYS.contains(&next.form))
            {
                continue;
            }
            let monday = anchor - Duration::days(anchor.weekday().num_days_from_monday() as i64)
                + Duration::days(7 * shift);
            // On a Sunday 이번 주 is the week ending today or the one starting tomorrow; a lookup
            // covers both.
            let days = if shift == 0 && anchor.weekday() == chrono::Weekday::Sun {
                13
            } else {
                6
            };
            return Some((monday, monday + Duration::days(days)));
        }
        let month = anchor.year() * 12 + anchor.month0() as i32 + shift as i32;
        let first =
            NaiveDate::from_ymd_opt(month.div_euclid(12), month.rem_euclid(12) as u32 + 1, 1)?;
        let next = month + 1;
        let next = NaiveDate::from_ymd_opt(next.div_euclid(12), next.rem_euclid(12) as u32 + 1, 1)?;
        return Some((first, next - Duration::days(1)));
    }
    None
}

fn names_time(request: &str, sentence: &[Morph]) -> bool {
    sentence
        .windows(2)
        .any(|pair| pair[0].tag == "SN" && pair[1].is("시", "NNB"))
        || text(request, sentence).as_bytes().windows(4).any(|window| {
            window[0].is_ascii_digit()
                && window[1] == b':'
                && window[2].is_ascii_digit()
                && window[3].is_ascii_digit()
        })
}

/// HH:MM for `오후 3시`, `15시 30분`, `저녁 7시 반` or `15:00`. An hour from 1 to 12 without 오전·오후
/// or a part of the day could be either half of the day, so it gives no clock.
fn clock(request: &str, sentence: &[Morph]) -> Option<String> {
    let written = text(request, sentence);
    for (colon, _) in written.match_indices(':') {
        let start = written[..colon]
            .char_indices()
            .rev()
            .find(|(_, c)| !c.is_ascii_digit())
            .map_or(0, |(index, c)| index + c.len_utf8());
        let hour = &written[start..colon];
        let minute = written[colon + 1..]
            .get(..2)
            .filter(|minute| minute.bytes().all(|byte| byte.is_ascii_digit()));
        let longer = written[colon + 1..]
            .chars()
            .nth(2)
            .is_some_and(|c| c.is_ascii_digit());
        if let (1..=2, Ok(hour @ 0..=23), Some(Ok(minute @ 0..=59)), false) = (
            hour.len(),
            hour.parse::<u32>(),
            minute.map(str::parse::<u32>),
            longer,
        ) {
            return Some(format!("{hour:02}:{minute:02}"));
        }
    }
    let index = sentence
        .windows(2)
        .position(|pair| pair[0].tag == "SN" && pair[1].is("시", "NNB"))?;
    let hour: u32 = sentence[index].form.parse().ok()?;
    let minute = match sentence.get(index + 2) {
        Some(next) if next.tag == "SN" && sentence.get(index + 3)?.is("분", "NNB") => {
            next.form.parse().ok()?
        }
        Some(next) if next.form == "반" => 30,
        _ => 0,
    };
    let afternoon = sentence[..index]
        .iter()
        .rev()
        .take(2)
        .find_map(|morph| match morph.form {
            "오전" | "아침" | "새벽" => Some(false),
            "오후" | "저녁" | "밤" => Some(true),
            _ => None,
        });
    let hour = match (afternoon, hour) {
        (Some(true), 1..=11) => hour + 12,
        (Some(false), 12) => 0,
        (Some(_), 0..=12) | (None, 13..=23) => hour,
        _ => return None,
    };
    (minute < 60).then(|| format!("{hour:02}:{minute:02}"))
}

/// Whether `sentence[index]` can name a place inside a title: a noun that is not a time word, a
/// feature's own name or the rest of a time (7시 반에).
fn place(sentence: &[Morph], index: usize) -> bool {
    let morph = &sentence[index];
    morph.nominal()
        && !morph.temporal()
        && !(morph.tag == "NNG" && FEATURE_WORDS.contains(&morph.form))
        && !index.checked_sub(1).is_some_and(|before| {
            let unit = &sentence[before];
            unit.tag == "SN" || unit.one_of(&["년", "월", "일", "시", "분", "초", "주"], "NNB")
        })
}

/// A numeral written with digits, Korean numerals or both: 12000, 4천, 300만, 만오천, 1만5천.
fn korean_number(word: &str) -> Option<u64> {
    let (mut total, mut section, mut number) = (0u64, 0u64, 0u64);
    let mut chars = word.chars().peekable();
    while let Some(c) = chars.next() {
        if let Some(digit) = c.to_digit(10) {
            number = digit as u64;
            while let Some(next) = chars.peek().and_then(|c| c.to_digit(10)) {
                number = number.checked_mul(10)?.checked_add(next as u64)?;
                chars.next();
            }
            continue;
        }
        if let Some(digit) = "영일이삼사오육칠팔구".chars().position(|d| d == c) {
            number = digit as u64;
            continue;
        }
        let unit = match c {
            '십' => 10,
            '백' => 100,
            '천' => 1_000,
            '만' => 10_000,
            '억' => 100_000_000,
            _ => return None,
        };
        if unit >= 10_000 {
            total = total.checked_add((section + number).max(1).checked_mul(unit)?)?;
            section = 0;
        } else {
            section = section.checked_add(number.max(1).checked_mul(unit)?)?;
        }
        number = 0;
    }
    Some(total + section + number)
}

/// A won amount and its morph range: `4천 원`, `만 이천 원`, `12,000원`, `300만 원`.
fn amount(sentence: &[Morph]) -> Option<(u64, Range<usize>)> {
    let won = (1..sentence.len()).find(|&index| {
        sentence[index].form == "원"
            && matches!(sentence[index].tag, "NNB" | "NNG")
            && matches!(sentence[index - 1].tag, "SN" | "NR")
    })?;
    let mut start = won;
    while start > 0 && matches!(sentence[start - 1].tag, "SN" | "NR") {
        start -= 1;
    }
    let written: String = sentence[start..won]
        .iter()
        .map(|morph| morph.form.replace(',', ""))
        .collect();
    let total = korean_number(&written)?;
    (total > 0).then_some((total, start..won + 1))
}

/// The nominal phrase a request names, read leftward from `before`: `[보고서 작성] 할 일`.
fn phrase_before(sentence: &[Morph], before: usize, head: Option<Domain>) -> Option<Range<usize>> {
    let mut start = before;
    while start > 0 {
        let morph = sentence[start - 1];
        if morph.is("기", "ETN")
            && start >= 2
            && matches!(sentence[start - 2].tag, "VV" | "VA" | "XSV")
        {
            start -= 2;
            continue;
        }
        // 화분에 물 주기: a place inside the title stays in it.
        if morph.is("에", "JKB") && start >= 2 && start < before && place(sentence, start - 2) {
            start -= 1;
            continue;
        }
        // 엄마한테 전화하기: the person an action is for stays in the title.
        if morph.one_of(&["한테", "에게", "께"], "JKB")
            && start >= 2
            && sentence[start - 2].nominal()
        {
            start -= 1;
            continue;
        }
        // 다이어리 메모: a qualifier of the same feature is not part of the title.
        let qualifier = head == Some(Domain::Note) && morph.one_of(&["다이어리", "노트"], "NNG");
        // 점심값: a time word written into a compound stays in it.
        let compound = start < before && morph.end == sentence[start].start;
        if !(morph.nominal() || matches!(morph.tag, "SO" | "SW"))
            || morph.temporal() && !compound
            || qualifier
        {
            break;
        }
        start -= 1;
    }
    (start < before).then_some(start..before)
}

/// The nominal phrase between a locative particle and the predicate: `할 일에 [우유 사기] 넣어 둬`.
fn phrase_after(sentence: &[Morph], after: usize, predicate: usize) -> Option<Range<usize>> {
    let mut start = after;
    let mut end = after;
    while end < predicate {
        let morph = sentence[end];
        let nominalized = matches!(morph.tag, "VV" | "VA" | "XSV")
            && sentence
                .get(end + 1)
                .is_some_and(|next| next.is("기", "ETN"));
        let inner_place = morph.is("에", "JKB")
            && end > start
            && place(sentence, end - 1)
            && end + 1 < predicate
            && sentence[end + 1].nominal();
        let compound = sentence
            .get(end + 1)
            .is_some_and(|next| morph.end == next.start && next.nominal());
        if morph.temporal() && !compound
            || morph.tag == "SN" && sentence.get(end + 1).is_some_and(Morph::temporal)
        {
            start = end + 1;
        } else if !(morph.nominal()
            || matches!(morph.tag, "SO" | "SW")
            || morph.is("기", "ETN")
            || nominalized
            || inner_place)
        {
            break;
        }
        end += 1;
    }
    (end > start).then_some(start..end)
}

fn colon_body(request: &str, instruction: &[Range<usize>]) -> Option<String> {
    let end = instruction.last()?.end;
    let rest = request[end..].trim_start();
    let body = rest
        .strip_prefix(':')
        .or_else(|| rest.strip_prefix('：'))?
        .trim();
    (!body.is_empty()).then(|| body.to_owned())
}

fn quoted(request: &str, instruction: &[Range<usize>]) -> Vec<String> {
    instruction
        .windows(2)
        .filter_map(|pair| {
            let mut chars = request[pair[0].end..pair[1].start].chars();
            chars.next()?;
            chars.next_back()?;
            let inner = chars.as_str().trim();
            (!inner.is_empty()).then(|| inner.to_owned())
        })
        .collect()
}

// ---------------------------------------------------------------------------------------------
// Korean rules

struct Reader<'a> {
    request: &'a str,
    anchor: NaiveDate,
    ids: &'a [&'a str],
    body: Option<String>,
    quotes: Vec<String>,
    judgment: Judgment,
    /// Some cue names an app action that no rule could settle.
    unclear: bool,
    /// The request refuses, reports or imagines a write.
    blocked: bool,
}

impl Reader<'_> {
    fn sentence(&mut self, sentence: &[Morph]) {
        let labels = labels(sentence);
        let words: Vec<DomainWord> = domain_words(sentence)
            .into_iter()
            .filter(|word| {
                !labels
                    .iter()
                    .any(|(_, range)| range.contains(&word.range.start))
            })
            .collect();
        let dates = dates(sentence, self.anchor);
        let money = amount(sentence);
        let ranges = clauses(sentence);
        let conditional = sentence.iter().any(|morph| {
            morph.tag == "EC" && CONDITIONALS.contains(&morph.form)
                || morph.one_of(&["만약", "혹시", "만일"], "MAG")
        });
        for range in ranges {
            let clause = &sentence[range.clone()];
            let app = clause.iter().any(app_word) || clause.windows(3).any(task_word);
            let Some(read) = predicate(clause) else {
                self.unclear |= words.iter().any(|word| range.contains(&word.range.start));
                continue;
            };
            let first = range.start + read.first;
            let clause_words: Vec<&DomainWord> = words
                .iter()
                .filter(|word| range.contains(&word.range.start))
                .collect();
            // 완료로 표시해 줘 / 완료로 바꿔 줘: the state names the action, whatever the verb.
            let marks_done = clause
                .windows(2)
                .any(|pair| pair[0].is("완료", "NNG") && pair[1].one_of(&["로", "으로"], "JKB"))
                || clause.windows(4).any(|words| {
                    words[0].one_of(&["끝내", "끝나"], "VV")
                        && words[1].is("ᆫ", "ETM")
                        && matches!(words[2].form, "걸" | "것")
                        && words[3].is("로", "JKB")
                });
            // 오늘 할 일 뭐 있어?: a question about a feature asks to look it up.
            let op = marks_done
                .then_some(Op::Complete)
                .or_else(|| operation(&read.lemma))
                .or_else(|| {
                    (read.mood == Mood::Question
                        && !clause_words.is_empty()
                        && clause.iter().any(|morph| {
                            morph.is("있", "VA")
                                || morph.one_of(&["뭐", "무엇", "어디"], "NP")
                                || morph.is("몇", "MM")
                                || morph.is("얼마", "NNG")
                                || morph.is("얼마나", "MAG")
                        }))
                    .then_some(Op::Query)
                });
            let other_actor = clause.windows(2).any(|pair| {
                (pair[0].tag == "NNG" && PERSONS.contains(&pair[0].form)
                    || pair[0].one_of(&["그", "그녀", "걔", "쟤", "얘", "그분"], "NP")
                    || pair[0].tag == "NNP")
                    && pair[1].one_of(&["가", "이", "께서"], "JKS")
            });
            if read.reported || other_actor {
                self.judgment.reason(if read.reported {
                    "reported_speech"
                } else {
                    "other_actor"
                });
                self.blocked |= app;
                continue;
            }
            if read.permission {
                // 추가 안 해도 돼: permission not to act refuses the write.
                if clause
                    .iter()
                    .any(|morph| morph.one_of(&["안", "못"], "MAG"))
                {
                    self.judgment.reason("negated_write");
                    self.blocked = true;
                } else {
                    self.judgment.reason("permission_question");
                    self.unclear = true;
                }
                continue;
            }
            // 잊지 않게 해 줘, 잊지 마: a reminder that names no feature is left to the selector.
            if read.mood != Mood::Statement
                && clause.iter().any(|morph| REMINDER.contains(&morph.form))
            {
                self.judgment.reason("reminder_request");
                self.unclear = true;
                continue;
            }
            if read.mood == Mood::Request && !read.prohibited {
                self.judgment.explicit = true;
            }
            let writes = op.is_some_and(|op| op != Op::Query);
            if read.prohibited || read.negative && writes {
                self.judgment.reason("negated_write");
                self.blocked = true;
                continue;
            }
            let spends =
                SPEND.contains(&read.lemma.as_str()) || EARN.contains(&read.lemma.as_str());
            if read.mood == Mood::Statement
                && money.is_some()
                && (spends || read.possible || read.future)
            {
                let completed = read.past || clause[read.last].is("음", "EF");
                if spends
                    && completed
                    && !(read.negative || read.possible || read.future || conditional)
                {
                    self.statement(sentence, &read.lemma, &dates, read.corrected);
                } else {
                    self.judgment.reason("unrealized_record");
                    self.blocked = true;
                }
                continue;
            }
            if conditional && writes {
                self.judgment.reason("conditional_request");
                self.blocked = true;
                continue;
            }
            let Some(op) = op else {
                self.unclear |= app && read.mood != Mood::Statement || !clause_words.is_empty();
                continue;
            };
            if read.mood == Mood::Statement {
                // Reports of finished work (보고서 끝냈어) need the model to find the item.
                self.unclear = true;
                continue;
            }
            self.request(
                sentence,
                &read,
                first,
                op,
                &clause_words,
                &labels,
                &dates,
                &money,
            );
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn request(
        &mut self,
        sentence: &[Morph],
        read: &Predicate,
        first: usize,
        op: Op,
        words: &[&DomainWord],
        labels: &[(Label, Range<usize>)],
        dates: &[(NaiveDate, Range<usize>)],
        money: &Option<(u64, Range<usize>)>,
    ) {
        let locatives: Vec<&&DomainWord> = words
            .iter()
            .filter(|word| word.locative.is_some())
            .collect();
        let head = match locatives.as_slice() {
            [one] => Some(**one),
            [] => words.last().copied(),
            _ => None,
        };
        let domain = match head {
            Some(word) => word.domain,
            // 메모해 줘: the action noun names the note itself.
            None if read.lemma == "메모" && words.is_empty() => {
                if desktop(sentence) {
                    Domain::Memo
                } else {
                    Domain::Note
                }
            }
            None => {
                self.unclear = true;
                return;
            }
        };
        let phrase = head
            .and_then(|word| match word.locative {
                // 전화하기 할 일로 넣어 둬: before 로 the item can come first.
                Some(particle) => phrase_after(sentence, particle + 1, first).or_else(|| {
                    sentence[particle]
                        .one_of(&["로", "으로"], "JKB")
                        .then(|| phrase_before(sentence, word.range.start, Some(word.domain)))
                        .flatten()
                }),
                None => phrase_before(sentence, word.range.start, Some(word.domain)),
            })
            // 다이어리에 '…' 메모 남겨 줘: the feature's own name is not a title.
            .filter(|range| {
                range
                    .clone()
                    .any(|index| !words.iter().any(|word| word.range.contains(&index)))
            });
        // A locative names the destination; other features then only describe the content
        // (메모를 할 일로 추가해줘). Without one, another feature must sit inside the title.
        let conflict = head.is_some_and(|word| word.locative.is_none())
            && words.iter().any(|word| {
                word.domain != domain
                    && !phrase
                        .as_ref()
                        .is_some_and(|phrase| phrase.contains(&word.range.start))
            });
        if conflict {
            self.judgment.reason("several_destinations");
            self.unclear = true;
            return;
        }
        let Some(kind) = action(domain, op) else {
            self.unclear = true;
            return;
        };
        // 메모 alone can mean the diary or the desktop memo once both exist; a lookup reads both.
        let kinds = if domain == Domain::Note
            && !sentence.iter().any(|morph| morph.is("다이어리", "NNG"))
            && self.ids.iter().any(|id| id.starts_with("memo_"))
        {
            if op != Op::Query {
                self.judgment.reason("memo_destination");
                self.unclear = true;
                return;
            }
            vec![kind, "memo_query"]
        } else {
            vec![kind]
        };
        if kinds.iter().any(|kind| !self.ids.contains(kind)) {
            self.judgment.reason("kind_unavailable");
            self.unclear = true;
            return;
        }
        let mut slots = Slots::default();
        for (label, range) in labels {
            let value = text(self.request, &sentence[range.clone()]).to_owned();
            match label {
                Label::Title => {
                    slots.title = Some(value);
                    slots.exact_title = true;
                }
                Label::Body => slots.body = Some(value),
                Label::Due => slots.due = true,
            }
        }
        let note = matches!(domain, Domain::Note | Domain::Memo);
        let ledger = domain == Domain::Ledger;
        let named = match (ledger, money) {
            // 점심값 12,000원 지출: the title stops before the amount.
            (true, Some((_, range))) => phrase_before(sentence, range.start, None),
            _ => phrase,
        }
        .map(|range| text(self.request, &sentence[range]).to_owned());
        if op == Op::Create {
            if let Some(body) = &self.body {
                if note && slots.body.is_none() {
                    slots.body = Some(body.clone());
                } else if !note && slots.title.is_none() {
                    slots.title = Some(body.clone());
                    slots.exact_title = true;
                }
            }
            if let [quote] = self.quotes.as_slice() {
                if note && slots.body.is_none() {
                    slots.body = Some(quote.clone());
                } else if !note && slots.title.is_none() {
                    slots.title = Some(quote.clone());
                    slots.exact_title = true;
                }
            }
            if slots.title.is_none() {
                slots.title = named;
            }
            // A note given only its body takes the body's first line as its title.
            if note && slots.title.is_none() {
                slots.title = slots.body.as_deref().and_then(|body| {
                    let line: String = body.lines().next()?.trim().chars().take(30).collect();
                    let line = line.trim_end().to_owned();
                    (!line.is_empty()).then_some(line)
                });
            }
        } else {
            slots.target = named;
        }
        let mut distinct: Vec<NaiveDate> = vec![];
        for (date, range) in dates {
            // 이번 주 금요일까지 on a Sunday has passed in a Monday-start week; a new or moved item
            // means the coming one.
            let date = if matches!(op, Op::Create | Op::Update)
                && sentence[range.start].form == "이번"
                && *date < self.anchor
            {
                *date + Duration::days(7)
            } else {
                *date
            };
            if !distinct.contains(&date) {
                distinct.push(date);
            }
        }
        match distinct.as_slice() {
            [date] => slots.date = Some(date.format("%Y-%m-%d").to_string()),
            [] => {}
            _ => self.judgment.reason("several_dates"),
        }
        if let Some((from, through)) = period(sentence, self.anchor) {
            slots.from = Some(from.format("%Y-%m-%d").to_string());
            slots.through = Some(through.format("%Y-%m-%d").to_string());
        }
        slots.due |= sentence
            .iter()
            .any(|morph| morph.one_of(&["마감", "마감일", "기한", "데드라인"], "NNG"))
            || dates.iter().any(|(_, range)| {
                sentence
                    .get(range.end)
                    .is_some_and(|morph| morph.form == "까지" && matches!(morph.tag, "JX" | "JKB"))
            });
        slots.time = names_time(self.request, sentence);
        slots.clock = clock(self.request, sentence);
        slots.repeat = REPEAT_WORDS
            .iter()
            .any(|word| text(self.request, sentence).contains(word));
        slots.temporal = slots.due
            || !dates.is_empty()
            || sentence.iter().enumerate().any(|(index, morph)| {
                // The 일 of 할 일 is not a day.
                morph.temporal() && !(index > 0 && sentence[index - 1].is("ᆯ", "ETM"))
            })
            || sentence.iter().any(|morph| morph.form == "까지");
        if ledger {
            slots.amount = money.as_ref().map(|(value, _)| *value);
            slots.ledger_kind = sentence.iter().find_map(|morph| match morph.form {
                "지출" => Some("expense".to_owned()),
                "수입" => Some("income".to_owned()),
                _ => None,
            });
        }
        let corrected = read.corrected || head.is_some_and(|word| word.corrected);
        if corrected {
            self.judgment.corrected = true;
            self.judgment.reason("typo_corrected");
        }
        let evidence = self.request
            [sentence[first].start..sentence[first + read.last - read.first].end]
            .trim()
            .to_owned();
        for kind in kinds {
            self.judgment.intents.push(Intent {
                kind: kind.into(),
                mode: "explicit".into(),
                evidence: evidence.clone(),
                slots: slots.clone(),
            });
        }
    }

    fn statement(
        &mut self,
        sentence: &[Morph],
        lemma: &str,
        dates: &[(NaiveDate, Range<usize>)],
        corrected: bool,
    ) {
        let Some((value, range)) = amount(sentence) else {
            return;
        };
        if !self.ids.contains(&"ledger_create") {
            self.judgment.reason("kind_unavailable");
            self.unclear = true;
            return;
        }
        // The item is named before the amount (커피 4천 원), right after it (3000원 컵라면), with
        // 로 before it (택시비로 12,000원) or as what was bought (김밥 사 먹고 4500원).
        let title = phrase_before(sentence, range.start, None)
            .or_else(|| {
                let end = range.end
                    + sentence[range.end..]
                        .iter()
                        .take_while(|morph| matches!(morph.tag, "NNG" | "NNP"))
                        .count();
                (end > range.end).then_some(range.end..end)
            })
            .or_else(|| {
                let particle = range.start.checked_sub(1)?;
                sentence[particle]
                    .one_of(&["로", "으로"], "JKB")
                    .then(|| phrase_before(sentence, particle, None))
                    .flatten()
            })
            .or_else(|| {
                let bought = sentence
                    .iter()
                    .position(|morph| morph.tag == "VV" && SPEND.contains(&morph.form))?;
                phrase_before(sentence, bought, None)
            })
            .map(|range| text(self.request, &sentence[range]).to_owned());
        // 커피 4천 원 썼어: a spending told without a day happened on the day it is told.
        let date = match dates {
            [(date, _)] => Some(date.format("%Y-%m-%d").to_string()),
            [] => Some(self.anchor.format("%Y-%m-%d").to_string()),
            _ => None,
        };
        if corrected {
            self.judgment.corrected = true;
            self.judgment.reason("typo_corrected");
        }
        self.judgment.intents.push(Intent {
            kind: "ledger_create".into(),
            mode: "statement".into(),
            evidence: text(self.request, sentence)
                .trim_end_matches(['.', '!', '?'])
                .trim()
                .to_owned(),
            slots: Slots {
                title,
                date,
                amount: Some(value),
                ledger_kind: Some(
                    if EARN.contains(&lemma) {
                        "income"
                    } else {
                        "expense"
                    }
                    .into(),
                ),
                ..Slots::default()
            },
        });
    }
}

// ---------------------------------------------------------------------------------------------
// English

/// A narrow string reading for English requests; Kiwi does not analyze English.
fn english(request: &str, ids: &[&str]) -> Judgment {
    // ASCII lowering keeps byte offsets, so positions found in `lower` slice `request`.
    let lower = request.to_ascii_lowercase();
    let instruction = crate::organizer::actions::instruction_text(&lower);
    let mut judgment = Judgment::new(Route::Ambiguous);
    let negated = ["do not", "don't", "never ", "without record", "without sav"]
        .iter()
        .any(|word| instruction.contains(word));
    let unrealized = ["might ", "maybe ", "if i ", "will ", "going to "]
        .iter()
        .any(|word| instruction.contains(word));
    let trimmed = ["please ", "can you ", "could you ", "would you "]
        .iter()
        .fold(instruction.trim_start(), |text, prefix| {
            text.strip_prefix(prefix).unwrap_or(text)
        });
    let verb = [
        "create", "add", "make", "save", "show", "read", "change", "update", "delete", "remove",
    ]
    .into_iter()
    .find(|verb| trimmed.starts_with(&format!("{verb} ")));
    let Some(verb) = verb else {
        if negated {
            judgment.reason("negated_write");
            judgment.route = Route::Chat;
        } else if !crate::organizer::actions::requested(request) {
            judgment.reason("no_app_request");
            judgment.route = Route::Chat;
        }
        return judgment;
    };
    judgment.explicit = true;
    if negated || unrealized {
        judgment.reason("negated_write");
        return judgment;
    }
    let domain = if instruction.contains("task") || instruction.contains("todo") {
        Domain::Task
    } else if instruction.contains("note") {
        Domain::Note
    } else {
        return judgment;
    };
    let op = match verb {
        "create" | "add" | "make" | "save" => Op::Create,
        "show" | "read" => Op::Query,
        "change" | "update" => Op::Update,
        _ => Op::Delete,
    };
    let Some(kind) = action(domain, op).filter(|kind| ids.contains(kind)) else {
        judgment.reason("kind_unavailable");
        return judgment;
    };
    // Values keep the request's own case.
    let after = |marker: &str| {
        lower.find(marker).map(|at| {
            let rest = &request[at + marker.len()..];
            let lowered = rest.to_ascii_lowercase();
            let end = [",", " with ", " due ", " to ", " and ", ":"]
                .iter()
                .filter_map(|stop| lowered.find(stop))
                .min()
                .unwrap_or(rest.len());
            rest[..end].trim().trim_end_matches('.').trim().to_owned()
        })
    };
    let named = after(" titled ")
        .or_else(|| after(" task "))
        .or_else(|| after(" note "))
        .filter(|name| !name.is_empty());
    let mut slots = Slots::default();
    if op == Op::Create {
        slots.exact_title = named.is_some();
        slots.title = named;
        slots.body = colon_body(
            request,
            &crate::organizer::actions::instruction_ranges(request),
        );
    } else {
        slots.target = named;
    }
    slots.date = lower.split_whitespace().find_map(|word| {
        let word = word.trim_matches(|c: char| !c.is_ascii_digit() && c != '-');
        NaiveDate::parse_from_str(word, "%Y-%m-%d")
            .ok()
            .filter(|date| date.format("%Y-%m-%d").to_string() == word)
            .map(|date| date.format("%Y-%m-%d").to_string())
    });
    slots.due = slots.date.is_some() && lower.contains("due");
    judgment.route = Route::Tools;
    judgment.intents.push(Intent {
        kind: kind.into(),
        mode: "explicit".into(),
        evidence: request
            .split([',', ':', '.'])
            .next()
            .unwrap_or(request)
            .trim()
            .to_owned(),
        slots,
    });
    judgment
}

#[cfg(test)]
mod evaluation;
#[cfg(test)]
mod tests;
