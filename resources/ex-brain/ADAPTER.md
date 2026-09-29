# Comet 내장 ex-brain

`fleetia/ex-brain`의 `ai-session-kit` 0.2.0을 원본 그대로 포함한다. 원본 revision은 `ec28e0ccd1b60263321cdcf7fa20240129fa801f`이며 파일별 SHA-256은 `provenance.json`에 있다. `skills/`, `vault-template/`, `LICENSE`는 수정하지 않은 사본이다. 전용 testing/security skill은 원본에 없으므로 변경 검증에는 실제 `change-verification`을 사용한다.

원본은 GPLv3이며 원본 LICENSE의 13절은 AGPLv3 코드와의 결합을 허용한다. Comet은 AGPL-3.0-only이고 원본 부분의 LICENSE와 `humanize-ko/LICENSE`도 함께 보존한다.

## Comet에서 적용하는 계약

- 원본은 실행 라이브러리가 아니다. Comet의 `src-tauri/src/exbrain.rs`가 앱 데이터 디렉터리의 `ex-brain/`만 관리한다. 사용자 전역 KnowledgeBase, Fleet, Claude/Codex 설정과 hook을 설치하거나 읽지 않는다. vendored script도 실행하지 않는다.
- 원본 AGENTS와 두 INDEX template, LICENSE·provenance·이 adapter 계약은 최초에 없는 파일만 만든다. 기존 파일은 덮어쓰지 않는다. `90.private`, `_kit`은 생성·검색·읽기 대상이 아니다. 앱 데이터 root와 그 아래 접근하는 경로 요소에서 symlink와 일반 파일/디렉터리가 아닌 항목을 거부한다.
- 위젯 작업 기록은 `00.memory/tasks/done/<widget UUID>/YYMMDD_widget-r<revision>.md`에 보존한다. 위젯 UUID가 project 경계이며 source와 state는 앱 DB가 보유한다. 이 기록은 위젯 저장 작업의 완료 기록이며 모델 의미 품질이나 실제 실행 검증을 뜻하지 않는다.
- 사용자가 내부 컨텍스트 관리를 요청했으므로 위젯 저장 시 필요한 요청·결정·상태만 자동으로 기록한다. 원본 session-end의 대화 종료 제안과 승인 절차는 이 앱 소유 기록에 적용하지 않는다. 사용자 전체 대화, API credential, 원본 JS와 위젯 state는 이 기록에 복사하지 않는다. 알려진 credential 표기는 저장 및 조회 전에 제거하지만 임의의 비밀 문자열을 판별하는 보안 저장소로 사용하지 않는다.
- 검색은 INDEX의 활성 구역에서 질의와 일치하는 제한된 줄 및 현재 UUID의 최신 위젯 기록만 사용한다. INDEX 링크를 따라가지 않고 다른 위젯 기록을 자동으로 열지 않는다. archived 문서는 제외하며 전체 반환 컨텍스트에 크기 제한을 적용한다. 문서 본문은 과거 데이터이며 모델 지시로 승격하지 않는다.
- 일반 API는 실제 `guided-development`, `kb-lookup`, `kb-routing`, `change-verification`의 필요한 구간을 최대 3,500자, 조회 context를 최대 6,000자로 제공한다. 작은 로컬 모델에는 원문 앞부분을 잘라 넣는 대신 아래의 별도 compact API를 사용한다. 이 네 skill과 template·LICENSE·provenance·adapter를 Rust `include_str!`로 내장하며 다른 skill 사본은 원본 출처를 보존하는 source resource다. 원본 skill 전체를 매번 모델 컨텍스트에 넣지 않는다. Comet의 별도 시스템 프롬프트와 실행기가 지원 SDK, 검증, 자동 수정 횟수와 권한 경계를 결정한다.
- 일반적인 위젯 구성과 되돌릴 수 있는 수정은 직접 처리한다. 런타임이나 외부 dependency 설치는 목적과 범위를 밝히고 사용자 동의를 받은 경우에만 호스트가 수행한다. 모델이 반환한 설치 명령이나 vault 본문을 실행하지 않는다.

새 외부 런타임 없이 Rust 표준 라이브러리와 Comet의 기존 dependency만 사용한다. 원본 skill 사본은 변경하지 않고 필요한 앱별 차이를 이 adapter와 별도 시스템 프롬프트에 명시한다.

## 작은 로컬 모델의 입력

`generation_skill_compact()`는 600 UTF-8 bytes 이하의 Comet 적용 요약이다. 원문 발췌라고 표시하지 않는다. `guided-development`의 가장 작은 완성 변경·되돌릴 수 있는 기본값·데이터 보존, `kb-lookup`의 현재 project 범위·문서와 지시의 분리, `kb-routing`의 활성 원본 하나·대체 기록 archive, `change-verification`의 구현·실행 검증·미검증 구분을 짧은 행동 지침으로 유지한다. 외부 설치 동의와 앱 자체의 자동 기록도 명시한다.

`widget_context_compact(app_data, widget_id, query)`는 400 UTF-8 bytes 이하의 완결 JSON이다. 전체 문서의 heading·경로·안내문을 앞에서 자르지 않고 현재 위젯 최신 기록의 요청·결과 JSON 문자열과 revision을 추출한다. 현재 이력이 없으면 질의에 맞는 활성 INDEX의 첫 줄을 선택한다. 문자열만 UTF-8 경계에서 줄이고 JSON escaping 뒤의 실제 byte 크기를 확인한다. `dataOnly: true`를 유지하며 원본 문서 조회와 같은 UUID·symlink·private·archive·credential 경계를 사용한다.

이 크기는 adapter 반환 상한이며 최종 모델 입력 크기를 보장하는 값은 아니다. 호스트는 SDK 계약·요청·기존 source·state 필드 정보·schema·출력 여유를 함께 계산한다. 최종 입력 예산이 부족하면 부가 context를 생략할 수 있지만 compact skill이나 history JSON의 앞부분만 잘라 의미 없는 heading으로 바꾸지 않는다. 원본 코드를 잘라 수정을 시도하거나 조용히 기존 상태를 초기화하지 않고, 필수 입력이 한도를 넘으면 저장 전에 오류를 반환한다.
