# Comet 내장 ex-brain

`fleetia/ex-brain`의 `ai-session-kit` 0.2.0을 원본 그대로 포함한다. 원본 revision은 `ec28e0ccd1b60263321cdcf7fa20240129fa801f`이며 파일별 SHA-256은 `provenance.json`에 있다. `skills/`, `vault-template/`, `LICENSE`는 수정하지 않은 사본이다. 전용 testing/security skill은 원본에 없으므로 변경 검증에는 실제 `change-verification`을 사용한다.

원본은 GPLv3이며 원본 LICENSE의 13절은 AGPLv3 코드와의 결합을 허용한다. Comet은 AGPL-3.0-only이고 원본 부분의 LICENSE와 `humanize-ko/LICENSE`도 함께 보존한다.

## 일반 기록 정리 계약

Comet의 일반 Ex-brain 정리는 `src-tauri/src/organizer/`의 자료·작업 저장소, `organizer_runtime.rs`의 수집·모델 실행, `organizer_actions.rs`의 직접 요청 실행기가 담당한다. 아래 위젯 이력용 `exbrain.rs`와는 별도 경로다. 사용자 조작과 기본값의 유지보수 사양은 Fleet의 `20.company-docs/fleetia/comet/20.reference/extensions.md` 중 **Ex-brain 기록과 업무 정리**를 따른다. 원본 kit의 script·hook·명령을 실행하거나 사용자 전역 설정을 설치하는 기능은 아니다.

### 자료와 소유권

- Comet 자료와 사용자가 연결한 Vault만 대상으로 삼는다. Comet 사용 동의와 자동 정리는 기본 꺼짐이다. 대화와 같은 활성 AI 제공자를 사용하므로 ChatGPT·외부 API에서는 필요한 본문을 전송한다. 로컬 모델도 같은 자료·작업 계약을 따른다.
- 대화 원문은 현재 사용자의 완료된 사용자 입력만 수집한다. 다이어리·메모·할 일·일정은 앱의 공유 원본이다. 원본은 각 기능의 기존 저장소가 소유하고, 검색과 요약용 사본은 `user_id`, `workspace_id`, `project_id`, 종류, 원본 위치, 내용 해시를 가진 `SourceRef`로 식별한다. 이 참조는 사용자 작성자나 캐릭터 개인 기억을 새로 만들어내지 않는다.
- Vault 원본은 선택한 root 안의 UTF-8 `.md`·`.markdown` 파일이다. 파일당 최대 4 MiB이며 폴더 탐색은 100,000개 항목까지다. 포함·제외는 상대 경로 prefix이고 glob이나 외부 링크 탐색이 아니다. 원문은 읽기 전용이며 기존 `INDEX.md`도 변경하지 않는다.
- 숨김 경로와 `_kit`, `node_modules`, `target`, `dist`, `build`, `ai-shared`, `90.private`, `03.diary`, `05.investing`, `30.1on1`, `31.self`, `99.deprecated`, `archive`, `archives`, `archived`, `private`, `secrets`, `credentials` 경로 요소는 제외한다. `AGENTS.md`, `SKILL.md`, `CLAUDE.md`와 archived·deprecated·cancelled 상태의 frontmatter 문서도 수집하지 않는다. 사용자 exclude를 비워도 이 경계는 해제되지 않는다.
- symlink를 따라가지 않고 root 밖 경로와 특수 파일을 거부한다. Unix에서는 디렉터리 핸들과 `openat`·`O_NOFOLLOW`로 경로를 열고, Windows에서는 reparse point를 거부한다. 원문을 읽거나 작업을 가져오고 저장할 때 연결 범위와 실제 내용 해시를 다시 확인한다. 범위가 바뀌거나 파일이 수정되면 이전 캐시를 모델에 보내거나 새 결과로 확정하지 않는다.

### 실행과 결과

초기 색인은 허용한 전체 원문을 처리하며 파일별로 진행을 저장한다. 이후 내용 해시가 바뀐 자료만 새로 큐에 넣는다. 취소된 탐색은 아직 보지 못한 자료를 삭제로 간주하지 않는다. 허용된 Markdown의 접근·UTF-8·파일 크기 오류는 Vault별 건수로 보관해 상태에 표시하되 정상 자료의 처리를 막지 않는다. 경로나 본문은 경고에 포함하지 않고 기본 제외·archive는 실패 건수에 넣지 않는다. 다음 완료된 탐색에서 정상적으로 읽으면 경고를 지운다. 자동 작업은 기본 300초 유휴와 하루 20회 호출 예산, 앱의 자동 대화·숨김·일시정지·조용한 시간·집중 경계를 따른다. 새 입력과 변경된 원문을 초기 backlog보다 먼저 처리하고 한 번에 하나의 모델 작업을 실행한다. 앱 외부 daemon은 없다.

긴 원문은 Unicode 문자 6,000개씩 나누고 원문 ID·내용 해시·조각 번호·`ORGANIZER_VERSION`으로 완료 작업을 중복 제거한다. 모델의 실제 호출을 작업당 최대 4회까지 DB에 기록한다. 취소·재시작은 호출 횟수를 초기화하지 않으며, 명시적인 보류 작업 재시도만 새 호출 예산을 준다. 실패 사유는 작업 상태에 남아 UI에서 조회할 수 있다.

자동 실행 결과는 제목·요약·결정·미정·다음 행동 제안이다. 제안에 체크박스나 실행 권한을 부여하지 않는다. 할 일·메모·로컬 일정 변경은 직접 요청 경로의 허용된 typed action과 현재 revision 검사를 거치며, 자동 경로에는 해당 도구를 제공하지 않는다. 입력별 `organizer_turns`와 `organizer_action_receipts`, 요약별 `organizer_operations`가 앱이 완료한 변경의 기준이다. 모델이 완료했다고 말한 내용은 영수증을 대신하지 않는다.

Comet 정리본은 DB에, Vault 정리본은 사용자가 지정한 전용 하위 폴더에 저장한다. 비어 있거나 같은 연결이 소유한 폴더만 사용할 수 있다. `.comet-organizer-owner`로 소유권을 확인하고 UUID별 Markdown 파일을 새로 만들며 해당 폴더의 관리 표시가 있는 `INDEX.md`에만 링크를 추가한다. 기존 생성 파일의 내용이 다르면 덮어쓰지 않는다. 원문 참조·해시와 조각 번호를 결과에 남긴다. 현재 출력 폴더뿐 아니라 다른 연결이 만든 Comet 소유 폴더도 원문 수집에서 제외해 자기 결과를 다시 정리하는 순환을 막는다. SQLite FTS 검색은 원문과 해당 사용자가 저장한 정리본을 함께 찾는다.

요약 작업은 준비 영수증을 먼저 저장하고 파일을 완성한 뒤 DB 결과·색인·완료 상태를 함께 확정한다. 중간에 종료되면 같은 영수증으로 복구하며 같은 입력의 결과를 다시 만들지 않는다. `app::open_session`은 공용 DB mutex를 만들기 전에 현재 사용자의 미완료 영수증을 확인하고 앱 원본을 갱신한 뒤 복구한다. 자동 설정이 꺼져 있어도 이미 승인된 저장은 복구하며 새 모델 요청은 하지 않는다. 다른 사용자 소유 작업은 복구하지 않는다. 되돌리기는 해당 결과의 저장 당시 해시 또는 대상 항목의 후속 상태를 비교한다. 사용자가 고친 파일·대상은 보존하고 충돌을 알린다. 다른 변경과 원문을 통째로 이전 상태로 되감지 않는다. 연결 해제는 검색·새 작업의 권한을 없애며 기존 원문·출력 파일·작업 영수증은 지우지 않는다.

자료 범위, `SourceRef`, 큐의 중복 기준, output 소유권 또는 직접 요청의 action 권한을 바꿀 때 이 절과 확장 사양을 함께 갱신한다.

## 위젯 작업 이력 계약

- 원본은 실행 라이브러리가 아니다. 위젯 이력용 `src-tauri/src/exbrain.rs`는 앱 데이터 디렉터리의 `ex-brain/`만 관리한다. 위젯 이력을 위해 사용자 전역 KnowledgeBase, Fleet, Claude/Codex 설정과 hook을 설치하거나 읽지 않는다. 사용자가 선택한 외부 Vault는 위의 일반 기록 정리 계약으로만 접근하며 vendored script는 실행하지 않는다.
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
