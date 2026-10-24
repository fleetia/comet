use super::*;

#[test]
fn source_bound_states_keep_failed_execution_separate_from_unknown_cause_and_decisions() {
    let source = "QA 지수는 10월25일 데모를 진행할 예정이다.\n\nQA 민수는 10월21일 초안 저장을 완료했다.\n\nQA 지수의 10월22일 검증은 실패했다. 원인은 미정이다.\n\n색인 실행은 시작하지 않았다.\n\n민수는 로그 검토를 제안했다.\n\n팀은 원문을 보존하기로 결정했다.";
    let summary = parse(
        json!({"title":"QA 상태", "facts":[
            {"text":"QA 지수는 10월25일 데모를 진행할 예정이다.","sourceId":"u1","state":"planned"},
            {"text":"QA 민수는 10월21일 초안 저장을 완료했다.","sourceId":"u2","state":"completed"},
            {"text":"QA 지수의 10월22일 검증은 실패했다.","sourceId":"u3","state":"failed"},
            {"text":"검증 실패 원인은 미정이다.","sourceId":"u4","state":"undecided"},
            {"text":"색인 실행은 미실행이다.","sourceId":"u5","state":"not_started"},
            {"text":"민수는 로그 검토를 제안했다.","sourceId":"u6","state":"proposed"},
            {"text":"팀은 원문을 보존하기로 결정했다.","sourceId":"u7","state":"decided"}
        ]}),
        source,
    )
    .unwrap();
    assert!(summary
        .summary
        .contains("QA 지수의 10월22일 검증은 실패했다."));
    assert!(summary.summary.contains("색인 실행은 미실행이다."));
    assert_eq!(summary.decisions, ["팀은 원문을 보존하기로 결정했다."]);
    assert_eq!(summary.open_questions, ["검증 실패 원인은 미정이다."]);
    assert_eq!(summary.next_actions, ["민수는 로그 검토를 제안했다."]);
}

#[test]
fn unknown_or_compound_source_ids_and_legacy_response_shapes_cannot_be_saved() {
    let source = "점검은 실패했다.\n\n배포일은 미정이다.";
    for source_id in [
        json!("u999"),
        json!("u1,u2"),
        json!(["u1", "u2"]),
        json!(""),
    ] {
        assert!(parse(
            json!({"title":"점검", "facts":[{
            "text":"점검 상태 요약", "sourceId":source_id,"state":"failed"}]}),
            source
        )
        .is_err());
    }
    assert!(parse(
        json!({"title":"점검", "facts":[{
        "text":"", "sourceId":"u1","state":"failed"}]}),
        source
    )
    .is_err());
    assert!(parse(json!({"title":"점검", "facts":[]}), source).is_err());
    assert!(parse(
        json!({"title":"점검", "facts":[{
        "text":"점검은 실패했다.", "evidence":[{"sourceId":"u1","quote":"점검은 실패했다."}],
        "state":"failed"}]}),
        source
    )
    .is_err());
    assert!(parse(
        json!({"title":"점검","summary":"점검 실패는 확인되지 않았다.",
        "decisions":[],"openQuestions":[],"nextActions":[]}),
        source
    )
    .is_err());
}

#[test]
fn every_bounded_source_unit_needs_its_own_fact_reference() {
    let source = (1..=35)
        .map(|index| format!("자료 {index}의 상태는 미정이다."))
        .collect::<Vec<_>>()
        .join("\n\n");
    let units = source_units(&source);
    let mut facts: Vec<_> = units
        .iter()
        .map(|unit| json!({"sourceId":unit.id,"text":unit.text,"state":"undecided"}))
        .collect();
    let candidate = |facts: &[Value]| json!({"title":"상태 정리", "facts":facts});
    assert!(parse(candidate(&facts), &source).is_ok());
    facts.pop();
    assert!(parse(candidate(&facts), &source)
        .unwrap_err()
        .contains(&format!("u{}", units.len())));
    facts[0]["sourceId"] = json!("u999");
    assert!(parse(candidate(&facts), &source)
        .unwrap_err()
        .contains("알 수 없는 sourceId u999"));
}

#[test]
fn one_unit_can_produce_multiple_separately_typed_facts() {
    let source = "점검은 실패했으며 원인은 미정이다.";
    let summary = parse(
        json!({"title":"점검", "facts":[
            {"text":"점검은 실패했다.","sourceId":"u1","state":"failed"},
            {"text":"점검 실패 원인은 미정이다.","sourceId":"u1","state":"undecided"}
        ]}),
        source,
    )
    .unwrap();
    assert_eq!(
        summary.summary,
        "점검은 실패했다.\n점검 실패 원인은 미정이다."
    );
    assert_eq!(summary.open_questions, ["점검 실패 원인은 미정이다."]);
    assert!(summary.decisions.is_empty());
}

#[test]
fn missing_registration_sentence_is_rejected_without_disabling_paraphrases() {
    let source = "담당자는 로그 검토를 제안했다. 검토를 실행하지 않았고, 할 일이나 일정에 등록하지도 않았다.";
    let proposal = json!({"text":"담당자의 제안은 로그 검토다.","sourceId":"u1","state":"proposed"});
    assert!(parse(
        json!({"title":"로그 검토", "facts":[proposal.clone()]}),
        source
    )
    .unwrap_err()
    .contains("u2"));
    let summary = parse(
        json!({"title":"로그 검토", "facts":[proposal,
            {"text":"검토는 미실행·미등록 상태다.","sourceId":"u2","state":"not_started"}
        ]}),
        source,
    )
    .unwrap();
    assert_eq!(summary.next_actions, ["담당자의 제안은 로그 검토다."]);
    assert_eq!(
        summary.summary,
        "담당자의 제안은 로그 검토다.\n검토는 미실행·미등록 상태다."
    );
}

#[test]
fn sentence_units_keep_quoted_punctuation_urls_versions_and_code() {
    let prose = "버전 1.2.3과 https://example.test/a.b를 확인했다. “완료. 실패; 미정?”은 인용이다.";
    let units = source_units(prose);
    assert_eq!(units.len(), 2);
    assert_eq!(units[0].text, "버전 1.2.3과 https://example.test/a.b를 확인했다.");
    assert_eq!(units[1].text, " “완료. 실패; 미정?”은 인용이다.");

    let source = "# 코드\n\n`a.b; c?`는 코드다. 뒤 문장도 유지한다.\n\n    내부 값 1.2.3. 내용.\n\n~~~txt\n첫 줄. 확인;\n\n둘째 줄. 유지;\n\n셋째 줄.\n~~~";
    let units = source_units(source);
    assert!(units.iter().any(|unit| unit.text == "둘째 줄. 유지;" && unit.protected));
    assert!(units.iter().any(|unit| unit.text == "    내부 값 1.2.3. 내용."));
    assert!(units.iter().any(|unit| unit.text == "`a.b; c?`는 코드다. 뒤 문장도 유지한다."));
    assert!(units.iter().all(|unit| unit.text == source[unit.span.clone()]));
}

#[test]
fn dotted_dates_metadata_and_korean_quote_suffixes_keep_their_boundaries() {
    let source = "공개일: 2026. 10. 20.\n\n검증일은 2026. 10. 21.이다. 원인은 미정이다.";
    let units = source_units(source);
    assert_eq!(units.len(), 3);
    assert_eq!(units[0].text, "공개일: 2026. 10. 20.");
    assert_eq!(units[1].text, "검증일은 2026. 10. 21.이다.");
    assert_eq!(units[2].text, " 원인은 미정이다.");

    let units = source_units("'배포까지 끝났다'는 예시다. 실제 검증은 실패했다.");
    assert_eq!(units.len(), 2);
    assert_eq!(units[0].text, "'배포까지 끝났다'는 예시다.");
    assert_eq!(units[1].text, " 실제 검증은 실패했다.");
    assert_eq!(source_units("Don't change version 1.2.3. Keep the source.").len(), 2);
}

#[test]
fn long_cases_give_unregistered_work_a_separate_required_id() {
    let cases: Vec<(String, String)> =
        serde_json::from_str(include_str!("long_cases.json")).unwrap();
    for (name, source) in cases {
        let units = source_units(&source);
        let registration = units
            .iter()
            .find(|unit| unit.text.contains("할 일이나 일정으로 등록하지도 않았다"))
            .unwrap();
        assert_eq!(
            registration.text.trim(),
            "로그 검토를 실행하지 않았고, 할 일이나 일정으로 등록하지도 않았다.",
            "{name}"
        );
        let facts: Vec<_> = units
            .iter()
            .filter(|unit| unit.id != registration.id)
            .map(|unit| json!({"sourceId":unit.id,"text":"문장 요지","state":"fact"}))
            .collect();
        let error = parse(json!({"title":name,"facts":facts}), &source).unwrap_err();
        assert!(error.contains(&registration.id));
    }
}

#[test]
fn recorded_paragraph_response_does_not_satisfy_new_sentence_ids() {
    let cases: Vec<(String, String)> =
        serde_json::from_str(include_str!("long_cases.json")).unwrap();
    let source = &cases.iter().find(|(name, _)| name == "jupiter").unwrap().1;
    let recorded = json!({"title":"QA 목성 장문 상태 기록", "facts":[
        {"sourceId":"u1","state":"fact","text":"자료는 완전 합성 QA 문서이며 인물과 작업은 실제 사용자 정보가 아님."},
        {"sourceId":"u2","state":"fact","text":"원문 작성자는 QA 민수다."},
        {"sourceId":"u3","state":"fact","text":"자료 공개일은 2026-10-20이다."},
        {"sourceId":"u4","state":"fact","text":"마지막 검증일은 2026-10-23이다."},
        {"sourceId":"u5","state":"planned","text":"QA 민수는 2026-10-28에 목성 자료 색인을 검토할 예정이다."},
        {"sourceId":"u6","state":"completed","text":"QA 유진은 2026-10-22에 목성 초안 저장을 완료했다."},
        {"sourceId":"u7","state":"failed","text":"QA 민수가 2026-10-23에 실행한 목성 검증 스크립트는 실패했다."},
        {"sourceId":"u8","state":"undecided","text":"목성 배포일은 미정이다."},
        {"sourceId":"u9","state":"proposed","text":"QA 유진은 목성 실패 로그를 함께 검토하자고 제안했다."},
        {"sourceId":"u10","state":"quoted","text":"QA 서윤이 예시로 쓴 “배포까지 끝났다”는 문장이 목성 작업의 실제 진행 상태를 설명하지 않으며 예시 문장을 실제 배포 완료 보고로 해석해서는 안 된다."},
        {"sourceId":"u11","state":"decided","text":"팀은 목성 원문을 그대로 보존하기로 결정했다."},
        {"sourceId":"u12","state":"fact","text":"목성 초안 저장 완료와 실제 검증 실패는 별개의 결과이며, 배포일과 실패 원인은 미정이고 예정된 검토와 제안된 로그 검토는 아직 실행하지 않았다."}
    ]});
    assert!(parse(recorded, source).unwrap_err().contains("누락된 원문"));
}

#[test]
fn prompt_units_keep_sentence_bytes_and_individual_metadata_lines() {
    let source = "# 자료 제목\r\n\r\n작성자: QA\r\n공개일: 2026-10-20\r\n\r\n## 진행\r\n\r\n  첫 줄.\r\n  둘째 줄. \r\n";
    let units = source_units(source);
    assert_eq!(
        units
            .iter()
            .map(|unit| (unit.id.as_str(), unit.text.as_str()))
            .collect::<Vec<_>>(),
        [
            ("u1", "작성자: QA"),
            ("u2", "공개일: 2026-10-20"),
            ("u3", "  첫 줄."),
            ("u4", "\r\n  둘째 줄. ")
        ]
    );
    assert_eq!(units[2].headings, ["자료 제목", "진행"]);
    assert!(units.iter().all(|unit| source.contains(&unit.text)));
    assert_eq!(
        serde_json::to_value(source_units(source)).unwrap(),
        serde_json::to_value(units).unwrap()
    );
}

#[test]
fn sibling_headings_do_not_become_ancestors_when_levels_are_skipped() {
    let source = "# QA\n### 금성\n금성 완료.\n### 수성\n수성 미실행.\n## 목성\n목성 예정.";
    let units = source_units(source);
    assert_eq!(units.len(), 3);
    assert_eq!(units[0].headings, ["QA", "금성"]);
    assert_eq!(units[1].headings, ["QA", "수성"]);
    assert_eq!(units[2].headings, ["QA", "목성"]);
    assert_eq!(
        units
            .iter()
            .map(|unit| unit.text.as_str())
            .collect::<Vec<_>>(),
        ["금성 완료.", "수성 미실행.", "목성 예정."]
    );
    assert!(units.iter().all(|unit| source.contains(&unit.text)));
}

#[test]
fn heading_only_sources_have_a_valid_unit_without_losing_original_bytes() {
    for source in [
        "# 배포 완료",
        " \r\n# 배포 완료\r\n\r\n## 오류 원인 미정\r\n",
    ] {
        let units = source_units(source);
        assert_eq!(units.len(), 1);
        assert_eq!(units[0].id, "u1");
        assert!(units[0].headings.is_empty());
        assert_eq!(units[0].text, source);
        assert_eq!(units[0].span, 0..source.len());
        assert!(parse(
            json!({"title":"상태", "facts":[{
                "text":"배포는 완료되었다.","sourceId":"u1","state":"completed"
            }]}),
            source,
        )
        .is_ok());
    }
}

#[test]
fn bodyless_sibling_and_final_headings_keep_the_whole_original_source() {
    for source in [
        "# QA\n## 배포 완료\n\n## 오류 원인\n원인은 미정이다.\n",
        "# QA\n### 담당자 미정\n\n## 진행\n초안을 저장했다.\n",
        "# QA\n## 진행\n초안을 저장했다.\n\n## 마지막 검증 실패\n",
    ] {
        let units = source_units(source);
        assert_eq!(units.len(), 1);
        assert_eq!(units[0].id, "u1");
        assert!(units[0].headings.is_empty());
        assert_eq!(units[0].text, source);
        assert_eq!(units[0].span, 0..source.len());
        assert!(
            json!(&units).to_string().len()
                <= json!(source).to_string().len() + SOURCE_UNIT_METADATA_BYTES
        );
    }
}

#[test]
fn normal_state_fixtures_keep_sentence_and_metadata_bytes() {
    for (name, source) in CASES {
        let expected: Vec<_> = source
            .lines()
            .filter(|line| !line.is_empty() && !line.starts_with('#'))
            .collect();
        let units = source_units(source);
        assert_eq!(expected.len(), 9, "{name}");
        assert!(units.len() > expected.len() && units.len() <= MAX_SOURCE_UNITS, "{name}");
        assert_eq!(
            units.iter().map(|unit| unit.text.as_str()).collect::<String>(),
            expected.join(""),
            "{name}"
        );
        for (index, unit) in units.iter().enumerate() {
            assert_eq!(unit.id, format!("u{}", index + 1), "{name}");
            assert_eq!(unit.text, source[unit.span.clone()], "{name}");
        }
    }
}

#[test]
fn dense_chunk_bounds_evidence_overhead_without_omitting_any_source_bytes() {
    let prefix = " \r\n# QA\r\n\r\n";
    let suffix = "마지막😀\r\n";
    let middle_chars = records::CHUNK_CHARS - prefix.chars().count() - suffix.chars().count();
    let source = format!(
        "{prefix}{}{suffix}",
        "a\n\n".repeat(middle_chars / 3) + &"a".repeat(middle_chars % 3)
    );
    assert_eq!(source.chars().count(), records::CHUNK_CHARS);
    let units = source_units(&source);
    assert!(!units.is_empty() && units.len() <= MAX_SOURCE_UNITS);
    assert_eq!(units[0].span.start, 0);
    assert_eq!(units.last().unwrap().span.end, source.len());
    assert!(units
        .windows(2)
        .all(|pair| pair[0].span.end == pair[1].span.start));
    assert!(units
        .iter()
        .all(|unit| unit.text == source[unit.span.clone()]));
    assert_eq!(
        units
            .iter()
            .map(|unit| unit.text.as_str())
            .collect::<String>(),
        source
    );
    assert!(
        json!(&units).to_string().len()
            <= json!(&source).to_string().len() + SOURCE_UNIT_METADATA_BYTES
    );
    let facts: Vec<_> = units
        .iter()
        .map(|unit| json!({"sourceId":unit.id,"text":"a","state":"fact"}))
        .collect();
    let candidate = json!({"title":"합성 자료", "facts":facts});
    assert!(candidate.to_string().len() < 2_048);
    assert!(parse(candidate, &source).is_ok());
}

#[test]
fn repeated_large_heading_context_is_bounded_and_remains_in_original_source() {
    for title in ["큰".repeat(1_500), "\"\\\0".repeat(300)] {
        let source = format!(
            "# {title}\n\n{}",
            (0..120)
                .map(|index| format!("항목 {index}."))
                .collect::<Vec<_>>()
                .join("\n\n")
        );
        assert!(source.chars().count() <= records::CHUNK_CHARS);
        let units = source_units(&source);
        assert!(units.len() <= MAX_SOURCE_UNITS);
        assert_eq!(
            units.iter().map(|unit| unit.text.as_str()).collect::<String>(),
            source
        );
        assert!(
            json!(&units).to_string().len()
                <= json!(&source).to_string().len() + SOURCE_UNIT_METADATA_BYTES
        );
    }
}

#[test]
fn coalesced_units_keep_only_their_shared_heading_context() {
    let source = format!(
        "# QA\n{}",
        (0..60)
            .map(|index| format!("### 대상 {index}\n상태 {index}."))
            .collect::<Vec<_>>()
            .join("\n\n")
    );
    let units = source_units(&source);
    assert!(units.len() <= MAX_SOURCE_UNITS);
    assert!(units.iter().all(|unit| unit.headings == ["QA"]));
    assert_eq!(
        units
            .iter()
            .map(|unit| unit.text.as_str())
            .collect::<String>(),
        source
    );
}

#[test]
fn fenced_code_requires_a_matching_sufficiently_long_whitespace_only_closing_fence() {
    for code in [
        "```md\n~~~\n# literal tilde\n```tail\n# literal suffix\n``` \t",
        "````md\n```\n# literal short fence\n````",
        "~~~md\n```\n# literal backtick\n~~~tail\n# literal suffix\n~~~~  ",
        "   ```md\n    ```\n# literal indented close\n  ```",
    ] {
        let source = format!("# QA\n\n{code}\n## Outside\n본문.");
        let units = source_units(&source);
        assert_eq!(units.len(), 2, "{code}");
        assert_eq!(units[0].text, code);
        assert_eq!(units[0].headings, ["QA"]);
        assert_eq!(units[1].headings, ["QA", "Outside"]);
        assert_eq!(units[1].text, "본문.");
        assert!(units.iter().all(|unit| source.contains(&unit.text)));
    }
}

#[test]
fn four_column_indented_code_is_not_a_heading_metadata_or_fence() {
    for code in [
        "    # literal heading\n    ```\n    code: 42",
        "\t# literal heading\n\t```\n\tcode: 42",
        " \t# literal heading\n \t~~~\n \tcode: 42",
    ] {
        let source = format!("# QA\n\n{code}\n## Outside\n본문.");
        let units = source_units(&source);
        assert_eq!(units.len(), 2, "{code}");
        assert_eq!(units[0].text, code);
        assert_eq!(units[0].headings, ["QA"]);
        assert_eq!(units[1].headings, ["QA", "Outside"]);
        assert_eq!(units[1].text, "본문.");
        assert!(units.iter().all(|unit| source.contains(&unit.text)));
    }
}

const CASES: [(&str, &str); 2] = [
    (
        "venus",
        r#"# QA 금성 상태 기록

합성 QA 자료다. 아래 인물과 업무는 실제 사용자 자료가 아니다.

원문 작성자: QA 지수
자료 공개일: 2026-10-20
마지막 검증일: 2026-10-22

## 예정

QA 지수는 2026-10-25에 금성 데모를 진행할 예정이다. 데모는 아직 실행하지 않았다.

## 완료

QA 민수는 2026-10-21에 금성 초안 저장을 완료했다. 이 완료는 초안 저장에만 해당한다.

## 미정

금성 배포일은 미정이다. 배포를 완료했다는 근거는 없다.

## 실행 실패

QA 지수가 2026-10-22에 실행한 금성 검증 스크립트는 실패했다. 성공하거나 통과했다는 증거는 없다.

## 제안

QA 민수는 실패 로그를 검토하자고 제안했다. 로그 검토를 실행하지 않았고, 할 일이나 일정으로 등록하지도 않았다.
"#,
    ),
    (
        "mercury",
        r#"# QA 수성 상태 기록

합성 QA 자료다. 아래 인물과 업무는 실제 사용자 자료가 아니다.

원문 작성자: QA 해준
자료 공개일: 2026-10-19
마지막 검증일: 2026-10-23

## 예정

QA 해준은 2026-10-26에 수성 색인을 검토할 예정이다. 검토와 색인 실행은 아직 시작하지 않았다.

## 완료 없음

수성에서 완료한 작업은 없다. 금성 초안 저장은 다른 자료의 작업이며 수성의 완료가 아니다.

## 미정과 미실행

수성 오류 원인과 배포일은 미정이다. 색인 실행을 시도하지 않았으므로 실행 실패로 판정한 것도 아니다.

## 인용

QA 서윤이 예시로 쓴 “배포까지 끝났다”는 문장은 이 수성 작업의 실제 진행 상태를 설명하지 않는다.

## 제안

QA 해준은 작은 샘플부터 확인해 보자고 제안했다. 확인은 아직 하지 않았고, 할 일이나 일정에도 등록하지 않았다.
"#,
    ),
];

#[tokio::test]
#[ignore = "Actual summary GGUF samples; COMET_QA_MODEL required; optional COMET_QA_SUMMARY_FIXTURE/COMET_QA_FOLLOWUP_QUESTION/COMET_QA_REPEAT/COMET_QA_OUTPUT_DIR/COMET_QA_BINARIES; synthetic inputs, no downloads"]
async fn actual_model_summary_faithfulness_samples() {
    use crate::{
        inference,
        types::{LocalModel, Settings},
    };
    use std::{
        path::{Path, PathBuf},
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        },
        time::{Duration, Instant},
    };

    let model = std::fs::canonicalize(std::env::var("COMET_QA_MODEL").expect("COMET_QA_MODEL"))
        .expect("Use an existing GGUF file");
    let repeat: usize = std::env::var("COMET_QA_REPEAT")
        .map_or(Ok(2), |value| value.parse())
        .expect("COMET_QA_REPEAT must be a positive integer");
    assert!(repeat > 0, "At least one sample per source is required");
    let directory = tempfile::tempdir().unwrap();
    let binaries = std::env::var_os("COMET_QA_BINARIES")
        .map(PathBuf::from)
        .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries"));
    let mut state = crate::app::tests::state();
    state.app_data = directory.path().into();
    state.inference = inference::Inference::new(
        directory.path().into(),
        binaries.join(
            crate::sidecar::development_executable("llama-server")
                .file_name()
                .unwrap(),
        ),
        binaries.join("runtime"),
    );
    let settings = Settings {
        local_model: LocalModel::Custom,
        local_model_path: model.to_string_lossy().into_owned(),
        ..Settings::default()
    };
    let cases: Vec<(String, String)> = match std::env::var_os("COMET_QA_SUMMARY_FIXTURE") {
        Some(path) => serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap(),
        None => CASES
            .iter()
            .map(|(name, content)| ((*name).into(), (*content).into()))
            .collect(),
    };
    assert!(
        !cases.is_empty(),
        "At least one synthetic source is required"
    );
    let mut samples = Vec::new();
    for (name, content) in cases {
        let job = records::OrganizerJob {
            id: format!("summary-{name}"),
            source: records::SourceRef {
                id: name.clone(),
                user_id: "synthetic-user".into(),
                workspace_id: "synthetic-workspace".into(),
                project_id: "synthetic-project".into(),
                kind: "vault".into(),
                locator: format!("qa-status-{name}.md"),
                title: format!("QA {name} 상태 기록"),
                content_hash: records::hash(&content),
                active: true,
            },
            source_hash: records::hash(&content),
            chunk_index: 0,
            chunk_count: 1,
            content: content.clone(),
            state: "pending".into(),
            attempts: 0,
        };
        for index in 0..repeat {
            let mut correction = String::new();
            let mut attempts = Vec::new();
            let mut accepted = false;
            for _ in 0..4 {
                let messages = prompt(&job, &correction);
                let started = Instant::now();
                let cancel = Arc::new(AtomicBool::new(false));
                let completed = tokio::time::timeout(
                    Duration::from_secs(240),
                    inference::generate_organizer(
                        &state.inference,
                        &settings,
                        &messages,
                        schema(),
                        super::super::SUMMARY_OUTPUT_TOKENS,
                        cancel.clone(),
                    ),
                )
                .await;
                let value = match completed {
                    Ok(result) => result,
                    Err(_) => {
                        cancel.store(true, Ordering::SeqCst);
                        inference::stop_local(&state.inference).await;
                        Err("summary sample timeout".into())
                    }
                };
                let inference_failed = value.is_err();
                let parsed = value.clone().and_then(|value| parse(value, &content));
                accepted = parsed.is_ok();
                attempts.push(json!({"elapsedSeconds":started.elapsed().as_secs_f64(),
                    "rawResult":value,"parsed":parsed,"prompt":messages}));
                if accepted || inference_failed {
                    break;
                }
                correction = parsed.unwrap_err();
            }
            samples.push(json!({"case":name,"index":index,"source":content,
                "accepted":accepted,"attempts":attempts,
                "semanticReview":"Required: failed vs unknown cause, unexecuted vs decision, actor/date/project, publication vs verification date, quotation/proposal; sourceId validity and coverage do not prove entailment"}));
        }
    }
    let followup_question = std::env::var("COMET_QA_FOLLOWUP_QUESTION").ok();
    let followup = if let Some(question) = followup_question
        .as_ref()
        .filter(|_| samples.iter().all(|sample| sample["accepted"] == true))
    {
        let summaries: Vec<_> = samples
            .iter()
            .filter_map(|sample| sample["attempts"].as_array()?.last())
            .map(|attempt| attempt["parsed"]["Ok"].clone())
            .collect();
        let targets = {
            let db = crate::app::lock(&state.db).unwrap();
            crate::store::save_settings(&db, &settings).unwrap();
            crate::store::set_user_name(&db, "QA 정리 확인", crate::app::now()).unwrap();
            let targets = crate::characters::active_ids(&db).unwrap();
            crate::store::insert_message(
                &db,
                &crate::types::Message {
                    id: "summary-followup".into(),
                    role: "user".into(),
                    persona: Some(targets[0].clone()),
                    content: format!(
                        "다음 정리 결과만 근거로 질문에 한국어로 답해 줘.\n{}\n\n질문: {question}",
                        serde_json::to_string(&summaries).unwrap()
                    ),
                    expression: None,
                    created_at: crate::app::now(),
                    status: "complete".into(),
                },
            )
            .unwrap();
            vec![targets[0].clone()]
        };
        let cancel = Arc::new(AtomicBool::new(false));
        let result = tokio::time::timeout(
            Duration::from_secs(240),
            crate::app::conversation::generate_turn(
                &state,
                &targets,
                "summary-followup",
                cancel.clone(),
            ),
        )
        .await;
        let result = match result {
            Ok(result) => result,
            Err(_) => {
                cancel.store(true, Ordering::SeqCst);
                Err("summary follow-up timeout".into())
            }
        };
        Some(
            json!({"question":question,"summaries":summaries,"result":result,
            "scope":"Production character generation with generated summaries supplied in the user message; no native save/open or automatic record retrieval"}),
        )
    } else {
        None
    };
    inference::stop_local(&state.inference).await;
    let running = inference::is_local_running(&state.inference, &settings).await;
    let output_directory = std::env::var_os("COMET_QA_OUTPUT_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    std::fs::create_dir_all(&output_directory).unwrap();
    let output = output_directory.join(format!(
        "summary-faithfulness-{}.json",
        uuid::Uuid::new_v4()
    ));
    std::fs::write(&output, serde_json::to_vec_pretty(&json!({"model":model,
        "syntheticOnly":true,"samplePath":"production prompt/schema/parser and organizer inference; no native UI or persisted profile mutation",
        "repeat":repeat,"ownedRuntimeStopped":!running,"samples":samples,"followup":followup})).unwrap()).unwrap();
    println!("Summary faithfulness samples: {}", output.display());
    assert!(!running, "The harness-owned local runtime did not stop");
    assert!(
        followup_question.is_none()
            || followup
                .as_ref()
                .is_some_and(|sample| sample["result"].get("Ok").is_some()),
        "The generated summary follow-up did not complete"
    );
    assert!(
        samples.iter().all(|sample| sample["accepted"] == true),
        "Some samples did not yield a structurally grounded summary; review {}",
        output.display()
    );
}
