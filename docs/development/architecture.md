---
title: 구조와 책임
description: 현재 Tauri 앱의 코드 소유권과 생활 도구·외부 위젯 확장의 책임 경계
---

# 구조와 책임

기존 대화·캐릭터 기능과 공식 위젯 22개의 구조, 후속 외부 SDK의 책임 경계를 설명한다. 파일 경로는 프로젝트 루트를 기준으로 한다. 공식 도구 호스트는 구현했으며 외부 SDK와 Cargo workspace는 후속 설계다. 검증 범위는 [상태표](../status.md)를 따른다.

## 현재 코드의 책임

| 위치 | 책임 |
| --- | --- |
| `src/App.tsx`, `src/components/<Component>/<Component>.tsx` | 창별 화면 선택, 본체·말풍선·입력과 보조 화면. 화면 컴포넌트는 컴포넌트별 디렉터리에 둔다. |
| `src/components/SettingsPanel/SettingsPanel.tsx`, `ModelSettings/ModelSettings.tsx` | 8개 직접 탐색, 자동 대화·AI 연결의 독립 저장, 미저장 편집 집계와 종료 확인, 모델/API 설정 |
| `src/components/UserSettings/`, `MemorySettings/`, `CharacterMemorySettings/`, `CharacterHistory/` | 최초 이름 등록·사용자 변경, 캐릭터별 기억 편집·잊기·개별 내보내기, 원문 페이지 조회. 검색 모델 설정은 AI 연결 안에서 독립 저장한다. |
| `src/components/SettingsPanel/useSettingsNavigation.ts` | 통합 탭 선택·방문한 패널 유지, 앱 실행 중 마지막 영역 기록, 네이티브 목적지 이벤트와 최초 조회의 경합 처리 |
| `src/hooks/useSettingsDraft.ts` | `automatic`·`model` scope별 설정·API 키 초안, 변경 여부와 snapshot 동기화, 명령 잠금·저장·취소 |
| `src/components/CharacterManager/CharacterManager.tsx`, `src/components/AnimationEditor/` | 캐릭터별 정의·애니메이션 자산 초안과 공통 저장·취소, 늦은 파일 선택 무효화. 편집기는 프레임·속도·상황 연결과 미리보기를 담당한다. |
| `src/hooks/useAnimationFrames.ts`, `useAnimationPlayer.ts`, `useCharacterAnimation.ts`, `src/components/AnimationFrameView/` | 프레임 준비·고정 크기 렌더, 경과 시간 기반 재생, 본체의 상황 우선순위·중단. 편집기와 본체가 프레임 준비·재생 로직을 공유한다. |
| `src/widgets/WidgetManager/WidgetManager.tsx`, `src/widgets/WidgetTool/WidgetTool.tsx` | 통합 설정 안의 설치·활성·표시·연결 관리와 별도 실행 창의 실제 위젯 작업을 분리 |
| `src/widgets/Planner/`, `src/widgets/PlannerAlerts/` | 플래너의 오늘·기간 계획·주간/월간 캘린더·템플릿·회차 편집과 생활 알림 설정. 화면은 위젯 snapshot을 읽고 호스트 명령으로 저장한다. |
| `src/hooks/useBalloonSizing.ts`, `src/components/Balloon/Balloon.tsx` | hook은 데스크톱의 ResizeObserver·requestAnimationFrame·네이티브 크기 변경을 관리하고, Balloon은 메뉴·입력·기록·스토리·대사를 표시한다. |
| `src/main.tsx`, `src/lagrange.css.ts`, `src/desktop.css.ts` | 모든 화면에 적용하는 공통 테마·reset·글꼴 역할, 공용 폼 스타일과 보조 화면 레이아웃. 위젯 컴포넌트는 `src/widgets/<Tool>/<Tool>.tsx`, 위젯별 배치는 `src/widgets/WidgetManager/widgetManager.css.ts`와 `src/widgets/tools.css.ts`가 담당한다. |
| `src/hooks/useSnapshot.ts`, `src/types.ts` | Rust 상태 수신·이벤트 구독과 화면용 타입 |
| `src/widgets/WidgetFrame/` | 개별 도구와 낱장 메모의 공통 창 높이·제목과 ×의 한 줄 고정 헤더·본문 스크롤·선택적인 하단 고정 조작 배치. 드래그와 닫기는 `WindowHeader`에 위임한다. 하단 조작 내용과 저장·명령 잠금은 각 도구가 소유하며, 폼 저장·타이머·조회 결과에 붙는 조작은 본문에 둔다. |
| `src-tauri/src/lib.rs` | 도메인 모듈 선언과 공개 `talk`·`run` 진입점 |
| `src-tauri/src/app/mod.rs` | 공유 `AppState`, snapshot 발행과 `interrupt`·phase·최신 작업 판정 |
| `src-tauri/src/app/lifecycle.rs` | Tauri 초기화·명령 등록·트레이·종료와 창 위치 저장 |
| `src-tauri/src/app/conversation.rs` | 직접 입력·재시도·프롬프트 구성과 생성 |
| `src-tauri/src/app/scene.rs` | 등록 대사·생성 대사의 표시와 다음 장면 선택 |
| `src-tauri/src/app/background.rs` | 자동 동작 루프·기억 분석·LLM 장면 준비와 API 예산 |
| `src-tauri/src/app/settings.rs` | 최신 저장값에 scope별 필드를 병합하는 설정 저장, 모델·단어장·기억 관련 앱 명령 |
| `src-tauri/src/app/users.rs`, `app/history.rs`, `memory_commands.rs` | 사용자 변경의 취소·저장 경계, 캐릭터별 실시간·보관용 원문 페이지 조회, 기억 편집·잊기·분석 재시도 명령 |
| `src-tauri/src/app/windows.rs` | 단일 설정창·마지막 목적지·미저장 상태, 종료 확인, 패널·말풍선·본체 표시/숨김·일시정지 명령 |
| `src-tauri/src/planner_windows.rs` | 단일 `planner` 실행 창과 탭 목적지, 통합 설정의 해당 위젯으로 이동 |
| `src-tauri/src/widgets/planning.rs`, `widgets/planning/recurrence.rs` | 내장 할 일·기간 계획·반복·횟수·선택 이월의 입력 검증과 상태 전이, 날짜·시간대 계산, 기존 JSON 호환 |
| `src-tauri/src/widgets/storage.rs` | 위젯 JSON의 SQLite 저장, 요청 중복·revision·transaction, 사건 유효기간과 실제 완료·횟수 기록의 구슬병 동기화 |
| `src-tauri/src/widget_connections.rs`, `widgets/calendar.rs`, `widgets/calendar/` | Google OAuth·ICS·macOS EventKit 읽기 연결, 자격 증명·선택 캘린더·조회 범위와 비동기 갱신 결과의 최신성 검사 |
| `src-tauri/src/widgets/reminders.rs`, `planner_notifications.rs` | 기한·무드 안내 시점과 다시 알림 대상 검증, 캐릭터 사건과 OS 전달 분리, OS 권한·표시·macOS 알림 버튼 |
| `src-tauri/src/desktop.rs`, `playback.rs` | 네이티브 창 배치와 재생 관련 규칙 |
| `src-tauri/src/desktop_geometry.rs`, `desktop_menu.rs`, `character_sprites.rs` | 다중 캐릭터 창 배치, 트레이 메뉴, 표정 이미지 저장과 내부 이미지 주소 |
| `src-tauri/src/behavior.rs`, `desktop_toys.rs`, `desktop_toys_macos.rs` | 자동 장난 상태·취소와 데스크톱 물체의 실행·창 경계 관측 |
| `src/hooks/useCharacterCollision.ts`, `src-tauri/src/character_collision.rs`, `character_collision_host.rs` | 본체 이미지·애니메이션 프레임의 alpha 판독과 외곽 캐시 선택, 외곽 선분의 인접 조회, 네이티브 위치·숨김·보고 세대에 따른 충돌 캐시 수명 |
| `src-tauri/src/updater.rs` | 업데이트 확인·서명 검증·설치, 설치 전 작업 중단과 앱 소유 프로세스 정리 |
| `src-tauri/src/store.rs`, `store/` | `store.rs`는 DB 초기화·설정·창 위치·revision·준비 장면과 기존 함수 진입점을 유지한다. `messages.rs`는 원문·당시 정체성·생성 대사 회상과 삽입 transaction, `memory.rs`는 기억 편집·분석 적용·회상 의존성과 캐릭터 × 사용자 관계, `users.rs`는 사용자 정체성과 기억 시계, `search.rs`는 소유권·수명을 적용한 검색을 담당한다. |
| `src-tauri/src/characters.rs`, `characters/` | `characters.rs`는 타입·설치·활성 자리·기본 정의 이전·팩 입출력과 기존 함수 진입점을 유지한다. `validation.rs`는 정의·대사·팩 JSON 검증, `dialogue.rs`는 소유 대사·자리 변환·인사·수다·키워드 선택, `archive.rs`는 선택한 개인 자료의 v4 내보내기·가져오기와 재식별을 담당한다. |
| `src-tauri/src/character_commands.rs`, `character_files.rs` | 캐릭터 변경의 직렬화·트랜잭션·취소, 네이티브 파일 선택과 검증 후 저장 |
| `src-tauri/src/character_animation.rs`, `character_animation/import.rs` | 애니메이션 정의·이미지 검증과 자산 저장·조회, APNG 프레임 합성 및 정지 PNG 시퀀스 변환. 디코딩은 DB·action 잠금 밖에서 수행한다. |
| `src-tauri/src/talk/` | `.talk` 파서·조건 평가·공개 상태 projection·재로딩·재언급 간격. 앱과 CLI가 같은 평가기 사용 |
| `src-tauri/src/talk_host.rs` | 실제 사건·상태 대본을 기존 재생기로 연결하고 프로그램·캐릭터·원본 revision을 재검사 |
| `src-tauri/src/story.rs`, `story_host.rs` | 선택지 스토리의 공개 단계·선택 보상·업타임, 암호화 파일 초기화·읽기와 앱 재생 연결 |
| `talk/`, `src-tauri/examples/talk.rs` | 기본 대본·fixture와 검사·변수 조회·읽기 전용 DB 시뮬레이션 CLI |
| `src-tauri/src/wordbook.rs` | 단어장 저장·초기 예제·정확한 키워드 매칭 |
| `src-tauri/src/domain.rs` | 모델 출력과 기억 분석 결과의 검증 |
| `src-tauri/src/inference.rs` | 앱 소유 추론 프로세스·외부 API·자격 증명 |
| `src-tauri/src/models.rs`, `resources.rs` | 고정 모델 다운로드와 로컬 준비 시점의 부하 판단 |
| `scripts/prepare-sidecar.mjs` | 운영체제별 llama.cpp 실행기 준비 |
| `.changeset/`, `scripts/release.py`, `scripts/finalize_release.py` | 변경 노트와 앱 버전 동기화, 배포 파일·updater manifest 검증 |

2026-09-19 모듈 분리는 제품 동작·Tauri 명령 이름·저장 schema를 바꾸지 않는다. 앱 실행 조정은 `app/`, 저장과 캐릭터 내부 책임은 각각 `store/`·`characters/`로 나눈다. 기존 `store.rs`·`characters.rs` 경로와 함수 진입점을 유지하여 smoke 예제와 대본 CLI도 같은 도메인 구현을 사용한다. 기존 회귀 테스트는 `app/tests.rs`·`store/tests.rs`·`characters/tests.rs`에서 해당 내부 경계를 확인한다.

Rust가 저장 상태를 관리하고 프론트엔드가 상태와 재생 이벤트를 표시한다. 공식 도구의 상태·일정 캐시·사건은 `src-tauri/src/widgets/storage.rs`의 SQLite 저장을 사용하고, 화면은 `src/widgets/`, 명령·연결 작업은 `widget_commands.rs`·`widget_connections.rs`가 담당한다. 공개 외부 위젯 실행기는 제공하지 않는다.

앱 식별자 이전은 `app/lifecycle.rs::migrate_app_data`가 DB를 열기 전에 수행한다. SQLite 본체와 WAL/SHM는 같은 출처의 한 묶음으로 취급한다. 현재 위치에 DB가 있으면 이전 위치의 DB·보조 파일을 병합하지 않고, 옛 이름을 바꾸는 경우에만 그 본체의 보조 파일을 함께 이동한다. 본체 없는 보조 파일이나 이전 대상의 충돌을 발견하면 임의로 조합하지 않고 중단한다. 모델 등 DB 외 파일의 기존 병합은 유지한다.

캐릭터 데이터 이전은 원문 메시지 JSON과 기존 친밀도 표를 보존하며 별도 정체성·친밀도 표를 사용한다. 캐릭터 변경은 기존 작업 취소와 준비 대사 무효화를 동반한다. 공유 파일은 캐릭터 정의·소유 대사와 선택한 이미지·동작으로 구성하며 개인 단어장은 명시적으로 선택한 항목만 포함한다. 기억·친밀도·대화 기록도 각각 선택한 경우에만 v4 archive에 포함하고 가져온 사람을 현재 사용자와 병합하지 않는다. 상세 규격은 [캐릭터 교체와 공유](../product/characters.md)를 따른다. 당시 흐름과 데이터 보존 검증은 [0.3.0 검증 기록](../VALIDATION-0.3.0.md)에 남기며 최신 검증 범위는 [상태표](../status.md)에서 구분한다.

애니메이션 파일 선택은 저장하지 않고 검증된 프레임 자산을 초안으로 돌려준다. 캐릭터 저장 시 정의와 참조 자산 추가·미참조 자산 정리를 한 transaction에 묶고, snapshot에는 메타데이터만 보내며 이미지 바이트는 `sprite://`로 조회한다. 재생과 프레임별 충돌 캐시 선택은 전체 snapshot 발행·DB 저장 없이 진행한다. v3·v4의 애니메이션 공유 형식과 APNG의 균일 fps 변환 계약은 [상황별 스프라이트 재생](../product/characters.md#상황별-스프라이트-재생)을 따른다.

`.talk`는 위젯 상태를 [공개 변수](talk-reference.md)로 정규화한 뒤 대본을 평가하고 `SceneLine` 배열을 기존 재생 경로에 전달한다. 자동 `.talk` 차례와 기존 일반 수다 차례를 번갈아 사용하며, 실제 사건은 기존 사건 대기열을 통과한다. 파서·평가기·CLI는 위젯 쓰기 명령이나 외부 코드를 실행하지 않는다. `talk/files.rs`는 앱 런타임의 안전한 파일 읽기·재로딩과 초기화 중 암호화 전환을 담당하고, `story.rs`는 선택지 story catalog를 읽고 검증한다. 원문 작성·편집·암호화 저장은 앱 밖의 별도 talk editor가 맡는다. 파일 변경 시 runtime generation과 last-good 경계를 지키며, 검사 실패 시 기존 파일을 유지한다. 외부 Widget SDK는 제공하지 않는다.

NLP 보조 실행기·FTS·벡터 캐시·발화별 분석 작업의 책임과 배포 경계는 [NLP 실행과 모델 배포](nlp.md)에서 관리한다. 기억 전체 목록은 앱 상태 이벤트에서 제외하고 개수·revision만 전달하며 화면이 전용 명령으로 50개씩 읽는다.

## 상태 전달과 취소 경계

화면의 명령은 Rust에서 저장·검증한 뒤 `app-state` 또는 `widgets-state` 이벤트로 반영한다. 화면 구독은 이벤트 수신을 먼저 연결하고 최초 snapshot을 조회한다. 조회 중 이벤트를 받았다면 늦게 도착한 최초 응답으로 새 상태를 덮어쓰지 않으며, 화면을 떠난 뒤에는 구독과 결과 적용을 정리한다. 브라우저 미리보기 데이터는 실제 SQLite 저장이나 네이티브 명령 실행을 대신하지 않는다.

통합 설정의 `save_settings`는 `scope: automatic`에서 `autonomousEnabled`·`localIdleEnabled`·`apiIdleEnabled`·`idleMinutes`를, `scope: model`에서 `mode`·`localModel`·`localModelPath`·`baseUrl`·`apiModel`·`apiTokenParameter`를 저장한다. `action`과 DB transaction 안에서 최신 설정을 읽고 해당 필드만 합치므로 다른 영역의 오래된 snapshot이 최신 저장을 덮어쓰지 않는다. 검증과 API 키 적용도 해당 scope에 한정하며 revision 갱신 후 기존 `interrupt`·`gate` 경계를 따른다. scope 생략은 기존 전체 저장 호출의 호환 경로이고 새 설정 UI는 명시적인 scope를 전달한다.

`get_settings_section`·`set_settings_section`은 앱 실행 중 마지막 영역을 공유한다. 네이티브 바로가기는 같은 `settings` 창에 `open-settings-section` 이벤트를 보내며 초기 목적지는 `characters`, 업데이트 목적지는 `general`이다. `set_settings_dirty`는 저장 데이터와 별개인 미저장 편집 신호다. `quit_app`과 네이티브 `ExitRequested`는 이 신호가 있으면 설정창을 보여 주고 `confirm-settings-exit`로 확인을 요청한다. 명시적인 `force: true`만 미저장 내용을 버리고 종료한다. 업데이트는 다운로드 전과 실제 설치 직전에 미저장 상태를 검사한다. UI 탐색·종료·저장 계약의 원본은 [통합 설정창](../product/settings.md)이다.

대화와 자동 작업은 서로 다른 경계를 함께 사용한다. 모듈을 나눠도 아래 역할과 확인 순서는 유지한다.

| 경계 | 보호하는 대상 |
| --- | --- |
| `action` | 취소 token 교체, epoch 증가와 짧은 상태 변경을 직렬화한다. 잠금 순서는 `action` 다음 DB·cancellation·runtime이며 표준 mutex guard를 `await` 너머로 유지하지 않는다. |
| `gate` | 비동기 대화 생성·재생 작업을 직렬화한다. 대기 후에도 epoch와 취소 token을 확인한다. |
| epoch와 취소 token | 사용자 입력·숨김·일시정지·설정 변경 이후 이전 작업이 다시 표시되는 것을 막는다. |
| 저장 revision | 생성 시 읽었던 기억·캐릭터·설정 문맥이 바뀌었으면 이전 결과의 저장과 재생을 거부한다. |
| 위젯·대본 최신성 | 위젯 사건과 대본은 공통 epoch 검사에 더해 원본 사건·프로그램·캐릭터와 관련 revision을 확인한다. |
| 대본 파일 최신성 | 읽은 대본의 revision·generation이 바뀌면 오래된 재생 결과를 무효화하고 last-good 파일을 유지한다. 원문 저장 충돌은 별도 talk editor의 책임이다. |

`present_line`은 최신성 검사를 통과한 뒤 기록과 재생 상태를 함께 갱신한다. 대본 파서가 성공하거나 모델이 응답했다는 사실만으로 말풍선을 표시하지 않는다. 자동 생성과 자동 재생의 조건은 함께 검토하며, 앱 종료와 취소는 앱이 소유한 추론 프로세스만 정리한다.

## 플래너의 실행·저장·알림 경계 {#planner-boundaries}

`view=planner`는 기존 `todo`·`calendar`·`preparation`·`focus-timer` 위젯의 상태를 함께 표시하는 실행 화면이다. 새 플래너 저장소나 외부 일정 쓰기 계층을 만들지 않는다. `open_widget`의 할 일·캘린더 진입은 `planner_windows::open`으로 같은 창을 재사용하고, 연결·알림 설정은 `open_planner_settings`가 기존 `settings` 창의 위젯 영역으로 전달한다. 로컬 할 일 작업은 캘린더 인증·네트워크·LLM에 의존하지 않는다.

변경은 기존 `execute_widget` → `widget_commands::change` → `widgets::storage::execute`를 통과한다. `requestId`의 UUID와 요청 fingerprint로 재전송을 구분하고 `expectedRevision`이 현재 위젯 revision과 같을 때만 transaction을 적용한다. `batch-add`의 새 목록·선택 항목은 함께 성공하거나 함께 취소된다. `plan`은 선택한 항목의 `plannedDate`를 바꾸고 기한을 건드리지 않으며, 기존 `rollover`는 기한 변경의 호환 명령으로 남는다. 공개 입력 의미와 제한의 원본은 [할 일과 캘린더](../product/planning.md)다.

할 일은 `widget_instances.data`의 기존 JSON을 확장한다. `planPeriod`·`planAnchor`·`plannedDate`와 `repeatRule`·`frequencyRecords`를 읽되 이전 데이터의 기한·완료·생성 연결을 보존한다. `plannedDate`가 없던 항목만 기존 기한의 지역 날짜를 승계하고 명시적인 `null`은 그대로 둔다. `planning/recurrence.rs`는 새 규칙의 지역 시각과 월 날짜 앵커를 계산하며, 기존 `repeat` 문자열의 UTC·월말 계산은 별도로 보존한다. DST가 모호하거나 존재하지 않는 시각은 오류로 반환한다.

회차 편집의 `continuation`은 이번 회차에만 적용한 변경이 다음 회차 템플릿을 덮어쓰지 않게 한다. 완료 시 생성한 자식과 `generation.snapshot`을 저장하고, 완료 취소는 정규화한 스냅샷과 여전히 같은 자식만 제거한다. 수정·완료한 자식은 보존하고 재완료로 복제하지 않는다. 주간 횟수는 항목 전체의 `completedAt` 대신 개별 기록을 추가·제거한다. 구슬병은 일반 완료와 횟수 기록을 소유한 할 일 데이터에서 다시 계산하므로 사건 재생 여부가 보상을 결정하지 않는다.

`widget_connections.rs`는 연결 작업의 token·위젯 revision을 완료 시 다시 검사한 뒤 키와 캐시를 저장한다. Google·ICS 자격 증명은 OS 저장소를 사용하고 EventKit 객체는 전용 작업 스레드 안에 둔다. Apple은 명시적인 권한 요청과 선택한 캘린더 조회만 수행하며 `FullAccess`가 필요한 OS 권한 범위와 앱의 읽기 전용 동작을 구분한다. 연결 데이터의 확장 필드는 갱신 때 보존하여 알림 설정과 다시 알림 상태를 잃지 않는다.

`reminders::advance`는 호스트 시계와 저장 상태를 사용해 기한·무드 안내를 결정한다. 첫 확인·2분 초과 공백은 따라잡지 않고 조용한 시간과 알림 쉬기를 적용한다. 외부 일정은 연결 캐시의 최신성을 확인하고 로컬 할 일은 현재 완료·기한 상태를 확인한다. 캐릭터 발화는 위젯 사건 대기열과 기존 숨김·일시정지·자동 대화·직접 입력 우선 경계를 통과하며, 재생 전 `reminders::event_current`로 대상과 타이머 revision을 다시 검사한다. OS 알림은 별도의 명시적 선택 채널로 전달하여 말풍선 숨김과 분리한다. OS에 미래 예약을 쌓지 않고 즉시 표시만 요청한다.

macOS 알림 버튼은 알림에 담긴 위젯 ID와 `observedAt`을 마지막 저장 알림과 비교한 뒤 다시 알림을 저장한다. 따라서 오래된 알림이 새 대상의 예약을 덮어쓰지 않는다. 권한 요청은 사용자 버튼에서만 실행하고 OS 전달 실패는 `planner-notification-error`로 표시한다. 네이티브 `.app`의 실제 권한·배너·버튼, Apple·Google 실계정 조회와 Windows 동작은 Rust 로직 테스트나 브라우저 미리보기로 검증됐다고 간주하지 않는다.

## 확장 후 책임 경계

| 경계 | 맡을 일 | 넘기지 않을 책임 |
| --- | --- | --- |
| 캐릭터 관리 | 정의·로컬 관계와 자리의 분리, 교체·팩 내보내기·가져오기, 명시적으로 선택한 개인 자료 보관 | 선택하지 않은 개인 자료 공유, 가져온 사람과 현재 사용자 병합, 과거 화자 소급 변경 |
| Comet 데이터 서비스 | 내장 투두, 사용자 작성 준비물, 연결 정보의 저장·검증 | 위젯에 SQLite 직접 접근권 전달 |
| 캘린더 연결 | 외부 일정 조회·캐시·변경 확인, 시간대와 반복 회차 해석 | 조회 실패를 빈 일정으로 바꾸기 |
| 도구 호스트 | 위젯 식별·권한·예약·요청·결과·수명 관리 | 외부 위젯이 앱 명령 전체를 호출하도록 허용 |
| 위젯 | 자기 상태·사건·허용 동작·선택적인 화면 제공 | 다른 위젯의 저장소나 자격 증명 직접 접근 |
| 대화 조정 | 단어장 원문 매칭·`.talk` 조건 선택·발화 순서·최신성 확인·준비 장면 취소 | 대사가 실제 데이터 변경을 대신함 |
| LLM | 제공된 근거 안에서 선택적인 새 대사 생성 | 상태의 원본, 실행 성공 판정, 호감도 점수 결정 |
| 화면 | 사용자 입력·버튼과 필요한 정보 표시 | 화면이 닫혀도 모든 위젯을 상주 실행 |

도구 사이의 연결은 Comet의 공개 계약을 통한다. 내부 파일 배치와 함수 이름을 지금부터 일반화할 필요는 없으며, 책임이 실제로 분리되는 지점에 맞춰 구현한다.

## 대표 흐름: 집중 종료와 할 일 완료

1. 사용자가 내장 투두 하나를 선택하고 집중 타이머를 시작한다.
2. 예약 시각이 되면 호스트가 타이머 종료 사건을 기록한다. 투두는 아직 미완료다.
3. 중복·취소·유효기간을 검사한 뒤 등록 대사와 완료/계속/휴식 동작을 보여 준다.
4. 사용자가 완료를 선택하면 호스트가 투두 서비스에 완료 명령을 전달한다.
5. 저장이 성공한 뒤 완료 사건이 발생한다. 구슬병 같은 다른 토이는 그 사건에 반응한다.
6. 저장이 실패하거나 결과를 확인하지 못했으면 완료됐다고 말하지 않는다. 재시도는 같은 명령의 식별자를 유지한다.

타이머·투두·구슬병은 서로의 내부 코드를 호출하지 않아도 연결된다. 관련 식별자와 요청 의미는 [연결 계약](../widgets/contract.md), 취소·재연결 처리는 [수명 규칙](../widgets/lifecycle.md)을 따른다.

## 경량 실행

내장 대사 재생, 투두 저장, 시간 계산과 예약은 LLM 없이 동작해야 한다. 초마다 모델을 호출하거나 위젯마다 숨겨진 WebView를 계속 실행하는 방식은 기본 구조로 사용하지 않는다.

닫힌 커스텀 화면을 해제해도 필요한 예약과 저장 상태는 호스트가 유지한다. 실패한 갱신에는 간격을 늘리는 재시도를 적용하고, 비활성 위젯의 작업은 중단한다. 구체적인 자원 한도는 기본 상주, 도구 사용, 동기화, 추론 상태를 나누어 측정한 뒤 정한다.

Docusaurus는 문서를 빌드하는 별도 개발 도구다. `wiki/package.json`과 자체 lockfile을 사용하며, 앱의 Vite 프론트엔드나 Tauri 설치물에 위키 의존성을 포함하지 않는다.

## Rust workspace 검토

**현재는 `src-tauri/Cargo.toml`의 단일 crate이며 Cargo workspace로 전환하지 않았다.** 앱·공식 위젯·문서·향후 SDK를 같은 프로젝트에서 관리하고, 독립 패키지 사이에 실제 코드 공유가 생기면 Cargo workspace를 쓰는 구성을 권장한다. 지금 위젯마다 crate를 만들 필요는 없다.

권장 배치는 다음과 같다. 새 경로는 설계 예시이며 현재 모두 존재한다는 뜻은 아니다.

```text
comet/
  Cargo.toml                 # workspace 도입 시 추가
  src-tauri/                 # 기존 Tauri 앱과 Rust 호스트
  src/                       # 기존 React 화면
  crates/widget-contract/    # 앱과 검증 도구가 계약을 공유할 때 분리
  widgets/                   # 공식 배포 패키지와 SDK 예제
  docs/
  wiki/
```

Cargo workspace는 여러 Rust 패키지의 명령·의존성 관리를 묶으며 루트의 `Cargo.lock`과 기본 `target/`을 공유한다. release profile도 루트 manifest에서 관리한다. 이는 개발·빌드 구조이며 사용자 설치 단위와 다르다. [Cargo 공식 문서](https://doc.rust-lang.org/cargo/reference/workspaces.html)를 기준으로 한다.

| 단위 | 역할 |
| --- | --- |
| Rust crate | 앱과 도구의 코드를 나누고 빌드한다. 위젯마다 필수로 만들지 않는다. |
| Cargo feature | 빌드 시 포함할 코드를 선택한다. 사용자 설치·제거 설정으로 사용하지 않는다. |
| 위젯 패키지 | 사용자가 앱 재빌드 없이 추가·중지·제거하는 배포 단위다. |

첫 공식 위젯의 Rust 동작은 현재 앱의 모듈로 시작한다. 공통 계약을 외부 검증 도구나 SDK가 실제로 재사용할 때 `widget-contract`를 분리한다. 외부 패키지의 실행 범위는 [작성 안내](../widgets/authoring.md), 설치 파일과 내장 처리기의 차이는 [선택 설치](../widgets/installation.md)를 따른다. workspace 자체가 앱의 상주 메모리나 설치 용량을 줄여 주는 것은 아니다.

전환할 때는 `src-tauri` 위치를 유지하고 다음 영향을 확인한다.

- `Cargo.lock`과 `[profile.release]`를 루트에서 관리하며 기존 최적화 옵션을 보존한다.
- 기본 산출물 경로 변경에 맞춰 `.gitignore`와 `README.md`의 `src-tauri/target/` 안내를 점검한다.
- `package.json`의 `--manifest-path src-tauri/Cargo.toml` 명령과 실제 Tauri 빌드·번들 결과를 확인한다.
- `scripts/prepare-sidecar.mjs`, 앱과 smoke 예제의 `CARGO_MANIFEST_DIR/binaries`, Tauri resource 경로를 보존한다.
- 기존 저장 데이터와 모델 프로세스 소유권·종료 동작을 유지한다.

## 변경할 때 확인할 것

저장 구조를 바꾸면 기존 대화·기억·단어장·친밀도·설정 보존을 확인한다. 새 외부 입력 경계에는 데이터 검증과 권한 검사를 넣는다. 재생이나 자동 작업을 바꾸면 사용자 입력·숨김·일시정지·연결 해제 뒤 오래된 결과가 돌아오지 않는지 확인한다.

현재 실행·앱 패키징 명령은 저장소 루트 `README.md`, 문서 빌드 명령은 [위키 운영](wiki.md)에서 관리한다.

## 캐릭터 기억과 사용자 경계

`store/users.rs`는 사용자별 이름·관계 시작·종료 시각, 최초 데이터 이전과 되돌아가지 않는 기억 시계를 소유한다. 이름이 실제로 바뀔 때마다 새 ID를 만들며 같은 이름의 과거 사람을 재사용하지 않는다. `store/memory.rs`는 캐릭터 × 사용자 기억·근거·재추출 차단과 생성 대사의 의존성을, `store/search.rs`는 검색·90일 가중치·사람별 상한을 처리한다. `story.rs`의 진행과 답변도 같은 사용자 ID로 나뉜다.

`app/users.rs`의 이름 변경은 action과 DB transaction을 지나 epoch를 바꾸고 열린 스토리·재생·생성을 취소한다. `app/conversation.rs`와 `memory_commands.rs`는 원문 당시 사용자를 재검사하며 `app/background.rs`의 지연 분석은 원문 당시 소유권으로 저장한다. 직접 답변과 준비 장면의 `recall_contexts`·`recall_dependencies`·`recall_sources`는 기억 삭제·만료·소유자 전환과 최근 답변을 통한 재유입을 함께 차단한다. 보수적인 의존성 검사로 공동 발화를 참고한 파생 답변이 무효화될 수 있지만 다른 캐릭터의 독립 기억은 남는다.

`characters/archive.rs`는 v4 개인 자료를 저장 transaction 안에서 재식별하고 팩 메타데이터에서 분리한다. `character_archived_messages`는 원문 보관 전용이며 분석 큐에 연결하지 않는다. `app/history.rs`는 실시간·가져온 원문을 캐릭터 범위로 함께 페이지 조회하며 당시 사용자 이름을 보여 준다. 공유 규칙은 [캐릭터팩](../product/characters.md#개인-데이터를-포함한-공유), 화면·망각 규칙은 [캐릭터 기억](../product/memory-search.md)이 기준이다.
