---
title: 대본 문법·변수·CLI
description: Nanika .talk format 1의 문법, 전체 공개 변수, 사건과 읽기 전용 검증 명령
---

# 대본 문법·변수·CLI

이 문서는 `.talk`를 작성하거나 AI가 만든 대본을 검사할 때 사용하는 참조다. 문법은 `src-tauri/src/talk/parser.rs`와 `expr.rs`, 변수는 `context::registry()`, 명령은 `src-tauri/examples/talk.rs`를 기준으로 한다. 선택·재로딩·기록의 제품 계약은 [상태에 반응하는 대본](../product/talk.md), 기본 대본의 검사 입력은 [대본 검증 범위](talk-coverage.md)에 있다.

## CLI 명령

저장소 루트에서 실행한다. Rust와 데스크톱 빌드 준비는 저장소 루트의 `README.md`를 따른다. 아래 명령은 CLI 실행 파일을 빌드하며 모델이나 API 호출은 하지 않는다.

```sh
cargo build --manifest-path src-tauri/Cargo.toml --example talk
src-tauri/target/debug/examples/talk check talk/index.talk
src-tauri/target/debug/examples/talk variables
```

| 명령 | 입력과 결과 |
| --- | --- |
| `talk read ENTRY RELATIVE_FILE` | 복호화된 `source`와 저장 충돌 검사용 `revision`을 JSON으로 출력 |
| `talk save ENTRY RELATIVE_FILE --source TEXT_FILE --revision REVISION` | 평문 원문 파일을 전체 검증한 뒤 암호화 저장. 로드한 revision이 현재와 다르면 거부 |
| `talk seal ENTRY` | 유효한 import bundle의 평문 파일을 암호화 |
| `talk check ENTRY` | 진입 파일과 재귀 import를 검사. 성공 시 `valid`, `sceneCount`, canonical `files` 출력 |
| `talk variables` | `variables` map과 `events` 목록 출력. 각 변수에 `name`, `kind`, `nullable`, `widget`, `description` 포함 |
| `talk simulate ENTRY --input JSON_OR_FILE` | 명시한 관측값과 이력으로 후보·탈락 이유·선택된 대사 계산 |
| `talk simulate ENTRY --db PATH` | 기존 앱 SQLite를 읽기 전용으로 열어 `idle` 시뮬레이션 |
| `talk simulate ENTRY --db PATH --event JSON_OR_FILE` | 입력한 사건을 현재 DB 상태와 함께 시뮬레이션 |
| `talk characters --db PATH` | 설치된 캐릭터의 로컬 `id`, 표시 `name`, 활성 `slot` 조회 |

`simulate`에는 `--input` 또는 `--db` 중 정확히 하나를 지정한다. `--seed N`, `--now MILLISECONDS`를 추가할 수 있다. 옵션은 값과 한 쌍으로 쓰며 중복·미등록 옵션은 오류다. 성공 결과는 표준 출력의 JSON, 오류는 표준 오류와 종료 코드 `1`이다. 후보가 없어서 `selected`가 `null`인 것은 정상적인 시뮬레이션 결과다.

### 고정 입력 시뮬레이션

`--input`은 `{`로 시작하는 JSON 문자열 또는 JSON 파일 경로를 받는다. 아래 예시는 가상 로컬 ID에 나디르·별꼬리 source identity를 지정해 `timer.focus`를 후보로 만든다. 기본 날씨 정보 없음 등 함께 열린 후보 중 최종 선택은 seed와 이력에 따른다.

```sh
src-tauri/target/debug/examples/talk simulate talk/index.talk --input '{"active":["demo-a","demo-b"],"available":["focus-timer"],"values":{"character.a.sourceId":"nadir","character.b.sourceId":"star-tail","timer.ready":true,"timer.status":"enabled","timer.state":"running","timer.mode":"focus"},"nowMs":100000,"seed":7}'
```

입력 필드:

| 필드 | 타입 | 기본값·규칙 |
| --- | --- | --- |
| `active` | string 2개 배열 | 필수. 현재 A/B 순서의 서로 다른 비어 있지 않은 로컬 ID |
| `available` | string 배열 | 기본 `[]`. 설치·활성·필수 의존성 검사를 통과한 실제 위젯 kind. `timer` 대신 `focus-timer` 사용 |
| `values` | 변수 이름 → 값 map | 기본 `{}`. 이름은 `timer.state` 같은 평탄한 key. 미등록 변수와 잘못된 타입은 오류 |
| `trigger` | string | 기본 `idle`. 아래 사건 목록의 값만 허용 |
| `history` | scene key → 정수 map | 기본 `{}`. 값은 마지막 표시 Unix 시각(밀리초). key는 이전 `selected.key` 그대로 사용 |
| `nowMs` | 정수 또는 null | 기본 `0`. `--now`가 있으면 명령 옵션 우선 |
| `seed` | 0 이상의 정수 또는 null | 기본 `0`. `--seed`가 있으면 명령 옵션 우선 |

생략한 nullable 변수는 `null`, 그 밖의 boolean은 `false`, number는 `0`, string은 `not-installed`로 채운다. `dialogue.variant`는 적용된 seed의 나머지 `seed % 5`로 초기화한다. 고정 입력의 `values`는 이 초기값을 덮어쓸 수 있으므로 특정 변주를 검사할 때만 직접 지정한다. `environment.hour`와 캐릭터 source identity는 고정 입력에서 명시해야 한다. `available`만 지정한다고 `ready`가 자동으로 `true`가 되지는 않는다. 사건 고정 입력은 `trigger`와 `values`의 `event.kind`·허용 payload 변수를 함께 지정한다. 입력 JSON 파일은 1 MiB 이하이며 알 수 없는 최상위 필드는 허용하지 않는다.

결과의 `candidates`는 `key`, `sceneId`, `eligible`, `reason`을 제공한다. 주요 reason은 `trigger_mismatch`, `pair_mismatch`, `dependency_unavailable`, `cooldown`, `condition_false`, `condition_error: ...`, `render_error: ...`, `selected`, `eligible_not_selected`다. `selected`에는 완성된 `lines`, 의존 위젯 `dependencies`, 변수 `references`, `cooldownMs`가 포함된다.

### 앱 DB를 읽는 시뮬레이션

macOS 기본 설치 경로 예시다. 대본 경로와 DB 경로는 같은 앱 데이터 디렉터리를 가리키게 한다.

```sh
src-tauri/target/debug/examples/talk characters --db "$HOME/Library/Application Support/space.starlight.nanika-box/nanika.sqlite"
src-tauri/target/debug/examples/talk simulate "$HOME/Library/Application Support/space.starlight.nanika-box/talk/index.talk" --db "$HOME/Library/Application Support/space.starlight.nanika-box/nanika.sqlite" --seed 7
```

DB 모드의 기본 시각은 실행 시각이고 기본 seed는 `0`이다. 설치된 캐릭터와 위젯 상태, 저장된 `talk_history`를 읽는다. DB를 새로 만들거나 migration을 적용하지 않는다. `talk_history` 테이블이 없는 기존 DB에서는 빈 이력으로 계산한다.

`--event`는 기존 `WidgetEvent` 형식의 JSON 문자열 또는 파일을 받는다. 다음은 형식을 설명하는 가상 사건이다. 실제 DB의 인스턴스 ID와 revision은 이 예시 값과 다를 수 있다.

```json
{
  "id": "sample-event",
  "instanceId": "sample-timer-instance",
  "widgetKind": "focus-timer",
  "revision": 3,
  "createdAt": 100000,
  "expiresAt": 130000,
  "kind": "timer-finished",
  "text": "집중 시간이 끝났어요.",
  "payload": { "mode": "focus" }
}
```

`--event`는 `--db`와 함께만 사용한다. 시뮬레이터는 전달한 사건의 변수를 투영하여 대사를 계산하며 실제 사건을 발생·대기열 등록·소비하지 않는다. 앱 호스트의 사건 ID/revision/만료 검사와 표시 직전 취소까지 재현하는 명령은 아니다. 실제 재생 검증은 [검증 기록](../VALIDATION-TALK.md)에서 별도로 확인한다.

## 파일과 import

- UTF-8 텍스트를 사용한다. 진입 파일의 첫 비어 있지 않은 항목은 `format: 1`이다. 앞선 빈 줄과 `#` 주석은 허용한다. `format:1`도 같다.
- import된 파일에서는 `format: 1`을 생략할 수 있다. 주석만 있는 import 파일도 유효하다.
- `#`로 시작하는 독립 줄은 주석이다. header 뒤의 inline 주석은 지원하지 않는다. 대사 본문 안의 `#`는 대사 문자다.
- 경로 문자열은 JSON 문자열 표기를 사용한다. 각 경로는 import한 파일의 디렉터리를 기준으로 해석한다.

```text
import "./widgets/index.talk" for pair("source:nadir", "source:star-tail")
import "./situations/index.talk" for pair("source:nadir", "source:star-tail")
import "./pairs/default.talk" for pair("source:nadir", "source:star-tail")
```

`for pair`의 범위는 하위 import에도 상속된다. 상속한 조합을 다른 조합으로 덮어쓸 수 없다. 두 ID는 서로 달라야 하며 비어 있으면 안 된다. 일반 문자열은 로컬 ID로, `source:` 접두사를 붙인 문자열은 현재 `character.a.sourceId`·`character.b.sourceId`로 비교한다. 나디르·별꼬리 기본 번들은 위젯·상황 대본까지 위 예시의 source 조합으로 제한한다. 두 멤버가 서로 다른 실제 슬롯에 있어야 하며, 대본의 A/B는 조합에 선언한 순서에 따라 실제 슬롯으로 매핑된다. `for pair("builtin-a", "builtin-b")` 같은 기존 로컬 ID 지정도 지원한다.

로더는 canonical 경로로 진입 파일 디렉터리 안에 있는지 확인한다. 절대 import, 디렉터리 밖으로 나가는 경로와 symlink, 순환 import, 없는 파일은 오류다. 같은 canonical 파일과 정규화한 조합 범위는 한 번만 로드한다. 활성화되지 않은 조합 파일도 묶음 전체 검사에 포함된다.

## 장면 header

장면은 header, `---`, 본문, `===` 순서다. header 이름은 아래 네 개만 허용하고 같은 장면에서 중복하지 않는다.

| header | 필수 | 값 |
| --- | --- | --- |
| `scene` | 예 | 1~128자의 영문·숫자·`_`·`-`·`.` ID. 같은 범위에서 고유 |
| `on` | 예 | `idle` 또는 등록된 사건 이름 |
| `when` | 아니요 | boolean 조건식. 생략하면 추가 조건 없음 |
| `cooldown` | 아니요 | `0` 또는 0 이상 정수와 `ms`, `s`, `m`, `h`, `d`. 생략하면 `0` |

`cooldown: 30m`은 첫 줄을 실제로 표시한 후 30분 동안 같은 key를 제외한다. 현재 나디르·별꼬리 번들은 `idle` 장면에 `30m`, 실제 사건을 받는 장면에 `0s`를 사용한다. 새 사건은 직전 표시 이력 때문에 억제되지 않으며, 같은 사건의 중복 재생 방지는 호스트의 사건 ID·revision·소비 검사 책임이다. `cooldown: 0.5s`, 음수와 단위 없는 `30`은 허용하지 않는다. key는 파일 경로가 아니라 정규화한 pair와 `scene` ID를 직렬화한 값이다. 직접 조립하지 말고 CLI 결과를 사용한다.

## 대사·표정·문자 치환

```text
A[호기심]: 지금은 어떤 시간이야?
B[평온]: 시계는 ${clock.hour}시를 가리키고 있어.
A: 표정을 생략하면 평온이야.
```

화자는 대문자 `A` 또는 `B`다. 표정은 `평온`, `기쁨`, `호기심`, `생각중`, `걱정`, `장난` 중 하나다. `normal`은 일부 기존 위젯 내장 문구에서 사용하는 값이며 `.talk`의 표정 별칭이 아니다.

콜론 다음의 선택적인 공백 한 개를 구분자로 제거하고 나머지 본문은 유지한다. 텍스트의 `${변수}`는 string·number·boolean을 문자열로 바꾼다. `null`은 빈 문자열이나 숫자 `0`으로 바꾸지 않으며, 해당 장면을 재생 불가로 판단한다. 치환 위치에는 변수 이름만 넣을 수 있고 계산식이나 함수는 허용하지 않는다.

본문에서 지원하는 escape:

| 입력 | 결과 |
| --- | --- |
| `\\` | 역슬래시 한 개 |
| `\n` | 줄바꿈 |
| `\t` | 탭 |
| `\$` | `$`. `\${clock.hour}`는 치환하지 않고 원문 그대로 표시 |
| `\"`, `\#`, `\@`, `\:`, `\{`, `\}` | 뒤의 해당 문자 |

다른 escape와 줄 끝에 홀로 남은 역슬래시는 오류다. 조건식의 문자열 literal과 import 경로에는 본문 escape 대신 JSON 문자열 escape 규칙을 적용한다.

### 여러 줄 대사

```text
A[생각중]: """
  첫 줄의 두 칸과

마지막 줄 뒤의 공백을 보존한다.
"""
```

따옴표 구분 줄을 제외한 본문을 하나의 말풍선 대사로 만든다. 내부 빈 줄, 들여쓰기, 후행 공백을 제거하지 않는다. 따옴표 내부에서는 주석이나 `@if`를 제어문으로 해석하지 않으며 문자 치환과 escape는 적용한다. 이 대사는 물리적으로 여러 줄이어도 장면의 대사 수에서는 한 개다.

## 조건식과 본문 분기

literal은 JSON 큰따옴표 문자열, 숫자, `true`, `false`, `null`이다. 변수는 전체 이름으로 쓴다. 산술, 함수 호출, 대입, 반복, 배열 접근은 지원하지 않는다.

| 연산 | 의미 |
| --- | --- |
| `and`, `or` | boolean 결합. 앞 항목으로 결과가 정해지면 뒤 항목을 평가하지 않음 |
| `not` | boolean 부정 |
| `==`, `!=` | 같은 타입 값 또는 `null` 비교. string/number를 서로 변환하지 않음 |
| `<`, `<=`, `>`, `>=` | 숫자 비교. `null`은 숫자로 취급하지 않음 |
| `(`, `)` | 평가 묶음 |

비교는 `and`보다, `and`는 `or`보다 먼저 평가한다. `not`은 뒤의 비교식을 부정할 수 있다. 복잡한 식은 `not (timer.state == "running")`처럼 괄호로 의도를 드러낸다. `when`과 `@if`의 최종 타입은 boolean이어야 한다.

```text
@if weather.temperature != null and weather.temperature < 5
A[걱정]: 기온이 낮네. 겉옷을 챙기자.
@else
A[평온]: 오늘 기온을 한번 확인했어.
@endif
```

`@if`, `@else`, `@endif`는 독립 줄에 쓰고 중첩할 수 있다. `@else`는 생략 가능하다. 장면 전체 조건은 header의 `when`, 본문 분기는 `@if`로 표현한다. 선택된 분기의 결과가 대사 0개라면 그 장면은 재생하지 않는다.

미설치·비활성 의존성 검사에는 실행되지 않은 분기를 포함한 장면 전체의 변수 참조를 사용한다. 예를 들어 weather가 없는 환경에서는 `@else`에 weather를 사용하지 않는 문장이 있어도 weather를 참조한 장면 전체가 후보에서 제외된다.

## 로드·실행 제한과 오류 위치

| 대상 | 제한 |
| --- | --- |
| 물리 파일 하나 | 1 MiB 이하 |
| 묶음의 서로 다른 파일 원문 합계 | 4 MiB 이하 |
| 서로 다른 파일 수 | 128개 이하 |
| 파일과 조합 범위의 로드 조합 | 2048개 이하 |
| 장면 수 | 2048개 이하 |
| import·조건식·본문 분기 중첩 | 각각 32단계 이하 |
| 조건식 token | 256개 이하 |
| 실행 후 대사 수 | 장면당 1~8개 |
| 실행 후 대사 길이 | 대사마다 Unicode 문자 500개 이하, 공백만 있는 대사 금지 |

원문은 `Program.sources`에 파일별로 그대로 보관한다. `Scene`과 본문 `Statement`는 시작·끝 줄/열의 `Span`을 가지며 줄/열은 1부터 시작하고 끝 열은 마지막 문자의 다음 위치다. 주석과 공백은 보관된 원문에서 복원할 수 있다. `validate_source`는 저장하지 않은 한 파일을 검사하지만 import가 있으면 파일 묶음 `load`가 필요하다는 진단을 반환한다.

`Diagnostic`은 `path`, `line`, `column`, `code`, `message`를 제공한다. `check`는 로드·문법·변수 타입을 검사한다. 실제 관측값에 따라 생기는 `null` 치환, 빈 분기, 치환 후 글자 수는 `simulate`의 후보 reason에서 확인한다. 하나의 성공한 고정 입력이 모든 분기와 외부 연결을 검증하지는 않는다.

## 상태와 사건의 공통 의미

각 위젯의 `ready`와 `status`는 항상 값이 있다. 나머지 위젯 변수와 `event.*`는 모두 nullable이다. 자료 없음·비활성·오래됨은 일반적으로 `null`이며, 실제 절전 복귀처럼 독립적으로 관측하는 값은 변수 설명을 따른다.

`status`에는 `not-installed`, `install-error`, `disabled`, `setup`, `error`, `enabled` 같은 설치 상태와 `ready`, `permission-needed`, `syncing`, `stale` 등 연결 상태가 들어갈 수 있다. 외부 조회의 오류·인증 상태는 연결이 제공하는 상태를 유지하므로 모든 위젯에 공통된 고정 enum이라고 가정하지 않는다.

날씨는 성공 시각과 관측 시각 모두 2시간 이내, 음악은 30초 이내, 기기는 2분 이내 기준을 사용한다. 캘린더는 각 연결의 최근 성공이 30분 이내여야 준비된 상태다. 시간과 날짜는 해당 데이터의 의미를 보존하며 시계와 날짜 기준 집계는 기기 현지 시간대를 사용한다.

## 공개 변수 전체 목록

아래 표는 `talk variables`의 122개 변수와 일치한다. `owner`는 `available` 및 재생 무효화에 쓰는 실제 위젯 kind이며 대본의 prefix와 다를 수 있다. `environment.*`, `character.*`, `dialogue.*`, `event.*`의 owner는 없고, 실제 사건 발행 위젯의 유효성은 호스트가 별도로 검사한다. 변수나 투영 규칙을 바꾸면 이 표와 고정 입력 검증도 함께 갱신한다.

### environment · 위젯 설치와 독립적인 환경

이 변수들은 위젯 설치 의존성을 만들지 않는다. `environment.hour`는 기기 현지 시각이다. `environment.weather*`는 활성 날씨 연결의 유효한 관측만 투영하며 연결이 없거나 오래됐으면 `weatherReady=false`와 nullable 관측값으로 나타낸다. `weather.*`를 직접 참조하는 장면과 달리, 기본 대본은 날씨 위젯이 없어도 정보 없음 분기를 재생할 수 있다. 관측값을 자동으로 얻기 위해 날씨 연결을 새로 설치하는 기능은 아니다.

| 변수 | 타입 | null 허용 | owner | 의미 |
| --- | --- | --- | --- | --- |
| `environment.hour` | `number` | 예 | 없음 | 현재 기기 현지 시각의 시(0~23). 시계 위젯 설치와 무관하며 표현할 수 없는 시각만 null. |
| `environment.weatherCode` | `number` | 예 | 없음 | 날씨 연결의 최신 WMO weatherCode 숫자. 미설치·비활성·자료 없음·오래됨에는 null(별도 명시된 독립 관측값 제외). |
| `environment.weatherName` | `string` | 예 | 없음 | 날씨 연결의 관측 대상 지역 이름. 미설치·비활성·자료 없음·오래됨에는 null(별도 명시된 독립 관측값 제외). |
| `environment.weatherReady` | `boolean` | 아니요 | 없음 | 설치된 날씨 연결에 2시간 이내의 유효한 관측이 있는지 여부. 미설치·비활성·실패·오래됨에는 false |
| `environment.weatherStatus` | `string` | 아니요 | 없음 | 날씨 연결 상태. not-installed·disabled·offline·stale을 관측 성공과 구분 |
| `environment.weatherTemperature` | `number` | 예 | 없음 | 날씨 연결의 최신 관측 기온(섭씨). 미설치·비활성·자료 없음·오래됨에는 null(별도 명시된 독립 관측값 제외). |

### character · 활성 캐릭터 신원과 친밀도

자리의 `a`·`b`와 특정 인물 `nadir`를 구분한다. 슬롯을 바꿔도 나디르의 조건을 유지하려면 `character.nadir.affinity`를 사용한다. 실제 호스트는 활성 캐릭터와 저장된 관계에서 값을 읽으며 고정 입력 CLI에서는 `values`로 제공한다.

| 변수 | 타입 | null 허용 | owner | 의미 |
| --- | --- | --- | --- | --- |
| `character.a.affinity` | `number` | 예 | 없음 | 해당 캐릭터의 현재 친밀도 점수. 해당 캐릭터가 없으면 null. |
| `character.a.sourceId` | `string` | 예 | 없음 | 현재 자리에 설치된 캐릭터의 원본 sourceId. 표시 이름·로컬 ID와 구분. 해당 캐릭터가 없으면 null. |
| `character.b.affinity` | `number` | 예 | 없음 | 해당 캐릭터의 현재 친밀도 점수. 해당 캐릭터가 없으면 null. |
| `character.b.sourceId` | `string` | 예 | 없음 | 현재 자리에 설치된 캐릭터의 원본 sourceId. 표시 이름·로컬 ID와 구분. 해당 캐릭터가 없으면 null. |
| `character.nadir.affinity` | `number` | 예 | 없음 | 해당 캐릭터의 현재 친밀도 점수. 해당 캐릭터가 없으면 null. |
| `character.nadir.present` | `boolean` | 아니요 | 없음 | 현재 A/B 중 sourceId가 nadir인 캐릭터가 있는지 여부 |

### dialogue · 장면 변주

`dialogue.variant`는 호스트의 seed에서 계산하며 표시 직전 재검사에도 준비 당시 값을 유지한다. 기본 번들은 0~4를 본문 `@if`로 나눠 사용한다.

| 변수 | 타입 | null 허용 | owner | 의미 |
| --- | --- | --- | --- | --- |
| `dialogue.variant` | `number` | 아니요 | 없음 | 한 대본 재생 동안 고정되는 0~4 변형 번호 |

### todo · 할 일

| 변수 | 타입 | null 허용 | owner | 의미 |
| --- | --- | --- | --- | --- |
| `todo.completedCount` | `number` | 예 | `todo` | 완료한 할 일 수 |
| `todo.openCount` | `number` | 예 | `todo` | 완료하지 않은 할 일 수 |
| `todo.overdueCount` | `number` | 예 | `todo` | 미완료이며 지정 시각 또는 날짜를 지난 할 일 수. 날짜 비교는 기기 현지 날짜 기준 |
| `todo.ready` | `boolean` | 아니요 | `todo` | 설치·활성·의존성과 데이터 최신성 검사를 통과했는지 여부 |
| `todo.status` | `string` | 아니요 | `todo` | 설치 상태 또는 연결 상태. unavailable·실패·stale은 성공한 빈 값과 구분 |

### calendar · 캘린더

| 변수 | 타입 | null 허용 | owner | 의미 |
| --- | --- | --- | --- | --- |
| `calendar.eventCount` | `number` | 예 | `calendar` | 모든 연결이 최근 30분 안에 성공했을 때의 취소되지 않은 일정 수 |
| `calendar.nextAllDay` | `boolean` | 예 | `calendar` | 다음 일정이 종일 일정인지 여부 |
| `calendar.nextTitle` | `string` | 예 | `calendar` | 현재 이후 가장 먼저 시작하는 일정 제목. 종일 일정은 날짜 기준 |
| `calendar.ready` | `boolean` | 아니요 | `calendar` | 설치·활성·의존성과 데이터 최신성 검사를 통과했는지 여부 |
| `calendar.status` | `string` | 아니요 | `calendar` | 설치 상태 또는 연결 상태. unavailable·실패·stale은 성공한 빈 값과 구분 |

### timer · 집중 타이머

| 변수 | 타입 | null 허용 | owner | 의미 |
| --- | --- | --- | --- | --- |
| `timer.mode` | `string` | 예 | `focus-timer` | 타이머 모드: focus 또는 rest |
| `timer.ready` | `boolean` | 아니요 | `focus-timer` | 설치·활성·의존성과 데이터 최신성 검사를 통과했는지 여부 |
| `timer.remainingMs` | `number` | 예 | `focus-timer` | 타이머 남은 시간(밀리초). 실행 중에는 deadline에서 현재 시각을 뺀 값 |
| `timer.state` | `string` | 예 | `focus-timer` | 타이머 상태: idle, running, paused, finished |
| `timer.status` | `string` | 아니요 | `focus-timer` | 설치 상태 또는 연결 상태. unavailable·실패·stale은 성공한 빈 값과 구분 |

### preparation · 준비 봉투

| 변수 | 타입 | null 허용 | owner | 의미 |
| --- | --- | --- | --- | --- |
| `preparation.checkCount` | `number` | 예 | `preparation` | 모든 준비 봉투에 등록된 체크 항목 수 |
| `preparation.count` | `number` | 예 | `preparation` | 저장된 준비 봉투 수 |
| `preparation.ready` | `boolean` | 아니요 | `preparation` | 설치·활성·의존성과 데이터 최신성 검사를 통과했는지 여부 |
| `preparation.status` | `string` | 아니요 | `preparation` | 설치 상태 또는 연결 상태. unavailable·실패·stale은 성공한 빈 값과 구분 |
| `preparation.uncheckedCount` | `number` | 예 | `preparation` | 모든 준비 봉투에서 아직 체크하지 않은 항목 수 |

### jar · 완료 구슬병

| 변수 | 타입 | null 허용 | owner | 의미 |
| --- | --- | --- | --- | --- |
| `jar.count` | `number` | 예 | `completion-jar` | 원본 할 일에서 완료 상태로 남아 있는 항목 수 |
| `jar.ready` | `boolean` | 아니요 | `completion-jar` | 설치·활성·의존성과 데이터 최신성 검사를 통과했는지 여부 |
| `jar.status` | `string` | 아니요 | `completion-jar` | 설치 상태 또는 연결 상태. unavailable·실패·stale은 성공한 빈 값과 구분 |

### clock · 시계·기념일

| 변수 | 타입 | null 허용 | owner | 의미 |
| --- | --- | --- | --- | --- |
| `clock.anniversaryCount` | `number` | 예 | `clock` | 등록된 기념일 수 |
| `clock.daysUntil` | `number` | 예 | `clock` | 오늘과 날짜 차이가 가장 작은 기념일까지 남은 일수. 과거 음수, 오늘 0, 미래 양수 |
| `clock.hour` | `number` | 예 | `clock` | 현재 기기 현지 시각의 시(0~23) |
| `clock.ready` | `boolean` | 아니요 | `clock` | 설치·활성·의존성과 데이터 최신성 검사를 통과했는지 여부 |
| `clock.status` | `string` | 아니요 | `clock` | 설치 상태 또는 연결 상태. unavailable·실패·stale은 성공한 빈 값과 구분 |
| `clock.title` | `string` | 예 | `clock` | 오늘과 날짜 차이가 가장 작은 기념일의 제목 |

### memo · 메모

| 변수 | 타입 | null 허용 | owner | 의미 |
| --- | --- | --- | --- | --- |
| `memo.count` | `number` | 예 | `memo` | 저장된 메모 수. 메모 본문은 제공하지 않음 |
| `memo.ready` | `boolean` | 아니요 | `memo` | 설치·활성·의존성과 데이터 최신성 검사를 통과했는지 여부 |
| `memo.status` | `string` | 아니요 | `memo` | 설치 상태 또는 연결 상태. unavailable·실패·stale은 성공한 빈 값과 구분 |

### weather · 날씨

| 변수 | 타입 | null 허용 | owner | 의미 |
| --- | --- | --- | --- | --- |
| `weather.code` | `number` | 예 | `weather` | 날씨 제공자의 WMO weatherCode 숫자 |
| `weather.name` | `string` | 예 | `weather` | 관측 대상 지역 이름 |
| `weather.ready` | `boolean` | 아니요 | `weather` | 설치·활성·의존성과 데이터 최신성 검사를 통과했는지 여부 |
| `weather.status` | `string` | 아니요 | `weather` | 설치 상태 또는 연결 상태. unavailable·실패·stale은 성공한 빈 값과 구분 |
| `weather.temperature` | `number` | 예 | `weather` | 최근 관측 기온(섭씨). 관측·조회 성공 시각 모두 2시간 이내일 때만 제공 |

### music · 음악

| 변수 | 타입 | null 허용 | owner | 의미 |
| --- | --- | --- | --- | --- |
| `music.artist` | `string` | 예 | `music` | 현재 재생 중인 곡의 아티스트. 비재생 시 null |
| `music.playing` | `boolean` | 예 | `music` | 현재 음악을 재생 중인지 여부. 중지·일시정지는 false |
| `music.ready` | `boolean` | 아니요 | `music` | 설치·활성·의존성과 데이터 최신성 검사를 통과했는지 여부 |
| `music.running` | `boolean` | 예 | `music` | 음악 제공 앱이 실행 중인지 여부 |
| `music.status` | `string` | 아니요 | `music` | 설치 상태 또는 연결 상태. unavailable·실패·stale은 성공한 빈 값과 구분 |
| `music.title` | `string` | 예 | `music` | 현재 재생 중인 곡 제목. 비재생 시 null |

### device · 기기

| 변수 | 타입 | null 허용 | owner | 의미 |
| --- | --- | --- | --- | --- |
| `device.hasBattery` | `boolean` | 예 | `device` | 기기에 배터리가 있는지 여부. 배터리 없는 데스크톱은 false |
| `device.percent` | `number` | 예 | `device` | 장착 배터리 중 가장 낮은 잔량(0~100%). 배터리가 없으면 null |
| `device.powerState` | `string` | 예 | `device` | 가장 낮은 잔량 배터리의 충전 상태: charging, discharging, charged, not-charging, unknown 등 |
| `device.ready` | `boolean` | 아니요 | `device` | 설치·활성·의존성과 데이터 최신성 검사를 통과했는지 여부 |
| `device.status` | `string` | 아니요 | `device` | 설치 상태 또는 연결 상태. unavailable·실패·stale은 성공한 빈 값과 구분 |
| `device.woke` | `boolean` | 예 | `device` | 최근 60초 안에 실제 절전 복귀가 관측됐는지 여부. 배터리 조회 실패와 독립 |

### interaction · 캐릭터 교감

| 변수 | 타입 | null 허용 | owner | 의미 |
| --- | --- | --- | --- | --- |
| `interaction.ready` | `boolean` | 아니요 | `interaction` | 설치·활성·의존성과 데이터 최신성 검사를 통과했는지 여부 |
| `interaction.snacks` | `number` | 예 | `interaction` | 남은 간식 조각 수(0~6) |
| `interaction.status` | `string` | 아니요 | `interaction` | 설치 상태 또는 연결 상태. unavailable·실패·stale은 성공한 빈 값과 구분 |
| `interaction.touches` | `number` | 예 | `interaction` | 누적 교감 횟수 |

### ball · 공

| 변수 | 타입 | null 허용 | owner | 의미 |
| --- | --- | --- | --- | --- |
| `ball.bounces` | `number` | 예 | `ball` | 이번 공 던지기에서 벽에 튕긴 횟수 |
| `ball.moving` | `boolean` | 예 | `ball` | 공이 현재 이동 중인지 여부 |
| `ball.ready` | `boolean` | 아니요 | `ball` | 설치·활성·의존성과 데이터 최신성 검사를 통과했는지 여부 |
| `ball.status` | `string` | 아니요 | `ball` | 설치 상태 또는 연결 상태. unavailable·실패·stale은 성공한 빈 값과 구분 |

### plane · 종이비행기

| 변수 | 타입 | null 허용 | owner | 의미 |
| --- | --- | --- | --- | --- |
| `plane.best` | `number` | 예 | `paper-plane` | 종이비행기 최고 비행 거리(위젯 좌표 단위) |
| `plane.distance` | `number` | 예 | `paper-plane` | 이번 종이비행기의 이동 거리(위젯 좌표 단위) |
| `plane.flying` | `boolean` | 예 | `paper-plane` | 종이비행기가 현재 비행 중인지 여부 |
| `plane.ready` | `boolean` | 아니요 | `paper-plane` | 설치·활성·의존성과 데이터 최신성 검사를 통과했는지 여부 |
| `plane.status` | `string` | 아니요 | `paper-plane` | 설치 상태 또는 연결 상태. unavailable·실패·stale은 성공한 빈 값과 구분 |

### bubbles · 비눗방울

| 변수 | 타입 | null 허용 | owner | 의미 |
| --- | --- | --- | --- | --- |
| `bubbles.count` | `number` | 예 | `bubbles` | 현재 화면에 남은 비눗방울 수 |
| `bubbles.ready` | `boolean` | 아니요 | `bubbles` | 설치·활성·의존성과 데이터 최신성 검사를 통과했는지 여부 |
| `bubbles.status` | `string` | 아니요 | `bubbles` | 설치 상태 또는 연결 상태. unavailable·실패·stale은 성공한 빈 값과 구분 |
| `bubbles.streak` | `number` | 예 | `bubbles` | 초기화 이후 연속으로 터뜨린 비눗방울 수 |

### match · 작은 승부

| 변수 | 타입 | null 허용 | owner | 의미 |
| --- | --- | --- | --- | --- |
| `match.game` | `string` | 예 | `small-match` | 최근 작은 승부 종류: 빈 문자열, dice, coin, rps |
| `match.ready` | `boolean` | 아니요 | `small-match` | 설치·활성·의존성과 데이터 최신성 검사를 통과했는지 여부 |
| `match.result` | `string` | 예 | `small-match` | 최근 작은 승부의 기존 한국어 결과 문자열. 사건 판정은 event.outcome 사용 |
| `match.rounds` | `number` | 예 | `small-match` | 작은 승부 누적 판 수 |
| `match.status` | `string` | 아니요 | `small-match` | 설치 상태 또는 연결 상태. unavailable·실패·stale은 성공한 빈 값과 구분 |

### guessing · 맞히기 놀이

| 변수 | 타입 | null 허용 | owner | 의미 |
| --- | --- | --- | --- | --- |
| `guessing.attempts` | `number` | 예 | `guessing` | 현재 또는 직전 맞히기 놀이의 시도 횟수 |
| `guessing.hint` | `string` | 예 | `guessing` | 사용자에게 이미 공개한 맞히기 힌트 |
| `guessing.mode` | `string` | 예 | `guessing` | 맞히기 놀이 종류: cups 또는 number |
| `guessing.playing` | `boolean` | 예 | `guessing` | 맞히기 놀이가 아직 진행 중인지 여부. 정답은 제공하지 않음 |
| `guessing.ready` | `boolean` | 아니요 | `guessing` | 설치·활성·의존성과 데이터 최신성 검사를 통과했는지 여부 |
| `guessing.status` | `string` | 아니요 | `guessing` | 설치 상태 또는 연결 상태. unavailable·실패·stale은 성공한 빈 값과 구분 |

### fishing · 낚시

| 변수 | 타입 | null 허용 | owner | 의미 |
| --- | --- | --- | --- | --- |
| `fishing.catches` | `number` | 예 | `fishing` | 누적 낚시 성공 횟수 |
| `fishing.lastCatch` | `string` | 예 | `fishing` | 마지막으로 낚은 물건 이름. 아직 성공하지 않았으면 null |
| `fishing.phase` | `string` | 예 | `fishing` | 낚시 상태: idle, waiting, bite |
| `fishing.ready` | `boolean` | 아니요 | `fishing` | 설치·활성·의존성과 데이터 최신성 검사를 통과했는지 여부 |
| `fishing.status` | `string` | 아니요 | `fishing` | 설치 상태 또는 연결 상태. unavailable·실패·stale은 성공한 빈 값과 구분 |

### fortune · 장난 운세

| 변수 | 타입 | null 허용 | owner | 의미 |
| --- | --- | --- | --- | --- |
| `fortune.draws` | `number` | 예 | `fortune` | 가상의 장난 운세를 뽑은 횟수 |
| `fortune.ready` | `boolean` | 아니요 | `fortune` | 설치·활성·의존성과 데이터 최신성 검사를 통과했는지 여부 |
| `fortune.status` | `string` | 아니요 | `fortune` | 설치 상태 또는 연결 상태. unavailable·실패·stale은 성공한 빈 값과 구분 |
| `fortune.text` | `string` | 예 | `fortune` | 현재 가상 장난 운세의 원문. 실제 예측이 아님 |

### plant · 화분

| 변수 | 타입 | null 허용 | owner | 의미 |
| --- | --- | --- | --- | --- |
| `plant.ready` | `boolean` | 아니요 | `plant` | 설치·활성·의존성과 데이터 최신성 검사를 통과했는지 여부 |
| `plant.stage` | `number` | 예 | `plant` | 화분 성장 단계: 0 씨앗, 1 새싹, 2 잎, 3 꽃 |
| `plant.status` | `string` | 아니요 | `plant` | 설치 상태 또는 연결 상태. unavailable·실패·stale은 성공한 빈 값과 구분 |
| `plant.water` | `number` | 예 | `plant` | 화분에 남은 물(0~3) |

### pet · 작은 펫

| 변수 | 타입 | null 허용 | owner | 의미 |
| --- | --- | --- | --- | --- |
| `pet.arrivals` | `number` | 예 | `pet` | 펫이 먹이에 도착한 누적 횟수 |
| `pet.moving` | `boolean` | 예 | `pet` | 펫이 놓인 먹이를 향해 이동 중인지 여부 |
| `pet.ready` | `boolean` | 아니요 | `pet` | 설치·활성·의존성과 데이터 최신성 검사를 통과했는지 여부 |
| `pet.status` | `string` | 아니요 | `pet` | 설치 상태 또는 연결 상태. unavailable·실패·stale은 성공한 빈 값과 구분 |

### collection · 수집함

| 변수 | 타입 | null 허용 | owner | 의미 |
| --- | --- | --- | --- | --- |
| `collection.count` | `number` | 예 | `collection` | 수집함에 있는 서로 다른 물건 종류 수. 총 수량이 아님 |
| `collection.decorationCount` | `number` | 예 | `collection` | 현재 꺼내 배치한 소품 수 |
| `collection.ready` | `boolean` | 아니요 | `collection` | 설치·활성·의존성과 데이터 최신성 검사를 통과했는지 여부 |
| `collection.status` | `string` | 아니요 | `collection` | 설치 상태 또는 연결 상태. unavailable·실패·stale은 성공한 빈 값과 구분 |

### journal · 사건 일지

| 변수 | 타입 | null 허용 | owner | 의미 |
| --- | --- | --- | --- | --- |
| `journal.count` | `number` | 예 | `journal` | 켜 둔 사건 일지에 실제로 보관한 사건 수 |
| `journal.ready` | `boolean` | 아니요 | `journal` | 설치·활성·의존성과 데이터 최신성 검사를 통과했는지 여부 |
| `journal.recentKind` | `string` | 예 | `journal` | 보관된 사건 일지 중 가장 최근 사건의 kind. 일지가 비었으면 null |
| `journal.status` | `string` | 아니요 | `journal` | 설치 상태 또는 연결 상태. unavailable·실패·stale은 성공한 빈 값과 구분 |

### event · 현재 전달된 사건

| 변수 | 타입 | null 허용 | owner | 의미 |
| --- | --- | --- | --- | --- |
| `event.action` | `string` | 예 | 없음 | 교감 사건의 실제 사용자 동작: stroke, poke, snack |
| `event.character` | `string` | 예 | 없음 | 교감 사건의 대상 자리: A 또는 B |
| `event.itemName` | `string` | 예 | 없음 | 실제 item-acquired 사건에서 획득한 물건 이름 |
| `event.kind` | `string` | 예 | 없음 | 현재 전달된 실제 사건의 kind. idle 평가에는 null |
| `event.mode` | `string` | 예 | 없음 | 사건의 timer 모드, 승부 종류 또는 맞히기 종류 |
| `event.outcome` | `string` | 예 | 없음 | 작은 승부 또는 맞히기 결과의 기계 식별자. 공개된 결과만 제공 |
| `event.widget` | `string` | 예 | 없음 | 현재 사건을 발행한 위젯 kind |

## on 사건 목록

`idle` 1개와 실제 위젯 사건 17개를 지원한다. 상태를 검사하는 장면은 `idle`, 실제 발생에 한 번 반응하는 장면은 해당 사건 이름을 사용한다. 사건이 없는 평가에서 `event.*`는 `null`이다.

| on 값 | 발행 위젯 | 의미 |
| --- | --- | --- |
| `idle` | 호스트 | 자동 또는 명시적 수다 기회 |
| `todo-completed` | `todo` | 할 일을 완료함 |
| `todo-undone` | `todo` | 할 일의 완료를 취소함 |
| `timer-finished` | `focus-timer` | 집중 또는 휴식 타이머가 끝남 |
| `calendar-reminder` | `calendar` | 호스트가 실제 일정 알림을 선택함 |
| `device-woke` | `device` | 운영체제의 실제 절전 복귀가 관측됨 |
| `interaction.touch` | `interaction` | 쓰다듬기·찌르기·간식 주기 |
| `ball.stopped` | `ball` | 공의 이동이 멈춤 |
| `paper-plane.landed` | `paper-plane` | 종이비행기가 착지함 |
| `bubbles.streak` | `bubbles` | 연속 비눗방울 터뜨리기 사건 |
| `small-match.result` | `small-match` | 주사위·동전·가위바위보 결과 |
| `guessing.attempt` | `guessing` | 맞히기 시도의 공개 결과 |
| `fishing.bite` | `fishing` | 입질이 옴 |
| `fishing.missed` | `fishing` | 입질을 놓치거나 빈 줄을 거둠 |
| `item-acquired` | `fishing` | 실제 물건을 낚아 획득함 |
| `fortune.draw` | `fortune` | 장난 운세를 뽑음 |
| `plant.growth` | `plant` | 화분이 다음 성장 단계로 진행함 |
| `pet.arrived` | `pet` | 펫이 놓인 먹이에 도착함 |

### 사건 payload 허용 목록

`event.kind`는 사건 최상위 `kind`, `event.widget`은 최상위 `widgetKind`에서 온다. 아래 다섯 항목만 payload에서 문자열로 읽는다. 필드가 없거나 문자열이 아니면 `null`이다. 이름이 같아도 payload 전체를 자동으로 공개하지 않는다.

| 공개 변수 | payload key | 실제 발행 값 |
| --- | --- | --- |
| `event.action` | `action` | 교감의 `stroke`, `poke`, `snack` |
| `event.character` | `character` | 교감 대상 자리 `A`, `B` |
| `event.mode` | `mode` | 타이머 `focus`, `rest`; 작은 승부 `dice`, `coin`, `rps`; 맞히기 `cups`, `number` |
| `event.outcome` | `outcome` | 아래의 공개 결과 식별자 |
| `event.itemName` | `name` | 실제 획득 물건 이름 |

`small-match.result`의 `outcome`은 `winner-a`, `winner-b`, `draw`, `correct`, `miss`, `winner-user`, `winner-character`다. `guessing.attempt`는 `correct`, `exhausted`, `empty`, `higher`, `lower`다. 표시용 한국어 결과 문자열을 다시 해석하는 대신 이 값을 조건에 사용한다. 아직 공개되지 않은 정답은 변수로 제공하지 않는다.

## AI 작성·검증 순서

1. `talk variables`와 수정할 기존 `.talk`를 제공하여 실제 변수·사건 이름을 사용하게 한다.
2. 각 장면의 `scene`, `on`, nullable guard, 기대 상태를 정한다. 사용자 사실이나 외부 상태를 대사에서 임의로 추정하지 않는다.
3. `talk check ENTRY`로 묶음 전체를 검사한다. 오류의 파일·줄·열·코드를 원문에 대조하여 고친다.
4. `talk simulate`에 정상·빈 상태·오래된 상태·nullable 값·cooldown·다른 캐릭터 조합 입력을 넣어 예상 장면과 대사를 확인한다.
5. 실제 데스크톱에서는 기존 재생 경계의 취소·재로딩·첫 표시 기록을 별도로 확인한다. 미리보기 성공을 실제 표시 검증으로 기록하지 않는다.

새 변수·사건·문법을 도입할 때는 구현, 이 참조, [대본 검증 범위](talk-coverage.md)를 함께 바꾼다. `check`나 `simulate`는 대본을 수정하거나 앱 데이터를 저장하는 명령이 아니다.
