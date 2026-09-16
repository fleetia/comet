---
title: 구조와 책임
description: 현재 Tauri 앱의 코드 소유권과 생활 도구·외부 위젯 확장의 책임 경계
---

# 구조와 책임

기존 대화·캐릭터 기능과 공식 위젯 22개의 구조, 후속 외부 SDK의 책임 경계를 설명한다. 파일 경로는 프로젝트 루트를 기준으로 한다. 공식 도구 호스트는 구현했으며 외부 SDK와 Cargo workspace는 후속 설계다. 검증 범위는 [상태표](../status.md)를 따른다.

## 현재 코드의 책임

| 위치 | 책임 |
| --- | --- |
| `src/App.tsx`, `src/components/` | 본체·말풍선·입력과 보조 화면 |
| `src/main.tsx`, `src/lagrange.css.ts`, `src/desktop.css.ts` | 모든 화면에 적용하는 공통 테마·reset·글꼴 역할, 공용 폼 스타일과 보조 화면 레이아웃. 위젯별 배치는 `src/widgets/widgets.css.ts`와 `src/widgets/tools.css.ts`가 담당한다. |
| `src/hooks/useSnapshot.ts`, `src/types.ts` | Rust 상태 수신·이벤트 구독과 화면용 타입 |
| `src-tauri/src/lib.rs` | Tauri 명령, 앱 상태, 작업 직렬화·취소, 자동 장면 준비 |
| `src-tauri/src/desktop.rs`, `playback.rs` | 네이티브 창 배치와 재생 관련 규칙 |
| `src-tauri/src/store.rs` | SQLite 대화·기억·설정, 당시 캐릭터 정체성과 로컬 ID별 관계 저장 |
| `src-tauri/src/characters.rs` | 로컬 캐릭터·조합 대사·공유 JSON 검증과 데이터 변환 |
| `src-tauri/src/character_commands.rs`, `character_files.rs` | 캐릭터 변경의 직렬화·트랜잭션·취소, 네이티브 파일 선택과 검증 후 저장 |
| `src-tauri/src/talk/` | `.talk` 파서·조건 평가·공개 상태 projection·재로딩·재언급 간격. 앱과 CLI가 같은 평가기 사용 |
| `src-tauri/src/talk_host.rs` | 실제 사건·상태 대본을 기존 재생기로 연결하고 프로그램·캐릭터·원본 revision을 재검사 |
| `talk/`, `src-tauri/examples/talk.rs` | 기본 대본·fixture와 검사·변수 조회·읽기 전용 DB 시뮬레이션 CLI |
| `src-tauri/src/wordbook.rs` | 단어장 저장·초기 예제·정확한 키워드 매칭 |
| `src-tauri/src/domain.rs` | 모델 출력과 기억 분석 결과의 검증 |
| `src-tauri/src/inference.rs` | 앱 소유 추론 프로세스·외부 API·자격 증명 |
| `src-tauri/src/models.rs`, `resources.rs` | 고정 모델 다운로드와 로컬 준비 시점의 부하 판단 |
| `scripts/prepare-sidecar.mjs` | 운영체제별 llama.cpp 실행기 준비 |

Rust가 저장 상태를 관리하고 프론트엔드가 상태와 재생 이벤트를 표시한다. 공식 도구의 상태·일정 캐시·사건은 `src-tauri/src/widgets/storage.rs`의 SQLite 저장을 사용하고, 화면은 `src/widgets/`, 명령·연결 작업은 `widget_commands.rs`·`widget_connections.rs`가 담당한다. 공개 외부 위젯 실행기는 제공하지 않는다.

캐릭터 데이터 이전은 원문 메시지 JSON과 기존 친밀도 표를 보존하며 별도 정체성·친밀도 표를 사용한다. 캐릭터 변경은 기존 작업 취소와 준비 대사 무효화를 동반한다. 공유 파일은 정의·대사만 구성하며 개인 단어장은 명시적으로 선택한 항목만 포함한다. 상세 규격은 [캐릭터 교체와 공유](../product/characters.md)를 따른다. 실제 흐름과 데이터 보존 검증은 [0.3.0 검증 기록](../VALIDATION-0.3.0.md)을 따른다.

`.talk`는 위젯 상태를 [공개 변수](talk-reference.md)로 정규화한 뒤 대본을 평가하고 `SceneLine` 배열을 기존 재생 경로에 전달한다. 자동 `.talk` 차례와 기존 일반 수다 차례를 번갈아 사용하며, 실제 사건은 기존 사건 대기열을 통과한다. 파서·평가기·CLI는 위젯 쓰기 명령이나 외부 코드를 실행하지 않는다. 대본 편집 UI와 외부 Widget SDK는 이 경로에 포함되지 않는다.

## 확장 후 책임 경계

| 경계 | 맡을 일 | 넘기지 않을 책임 |
| --- | --- | --- |
| 캐릭터 관리 | 정의·버전·로컬 관계와 자리의 분리, 교체·팩 내보내기·가져오기 | 개인 대화·기억을 공유물로 복사하거나 과거 화자를 새 캐릭터로 변경 |
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
