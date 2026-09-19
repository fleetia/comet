---
title: 대사 분기 검증표
description: 22종 위젯의 실제 상태·이벤트와 번들 대사를 연결하는 180개 입력 사례 및 DB 경로 검증 범위
---

# 대사 분기 검증표

번들 대사를 바꾸거나 위젯의 상태·이벤트 필드를 수정할 때 이 문서를 사용한다. 어떤 입력에서 어느 장면을 선택해야 하는지 확인하고, 해당 fixture와 실제 DB 경로 테스트를 함께 실행할 수 있다. 제품 동작은 [대사 스크립트](../product/talk.md), 문법과 공개 변수는 [대사 작성 참조](talk-reference.md), 실행 환경과 데스크톱 관측은 [검증 기록](../VALIDATION-TALK.md)을 따른다.

## 검증 대상과 원본

2026-09-19 나디르·별꼬리 번들의 parser 결과, `talk/fixtures/coverage.json`과 `src-tauri/src/talk/defaults.rs`를 기준으로 숫자와 표의 연결을 대조했다. 저장소의 `.talk` 26개는 암호화 envelope이며 loader가 복호화한 대본을 실제 parser로 검증한다.

| 대상 | 수 | 기준 |
| --- | ---: | --- |
| 위젯 종류 | 22 | `widgets/catalog.json` |
| 번들 `.talk` 파일 | 26 | 진입·목록 파일, 위젯 22개, 공통 상황·조합 파일 포함 |
| 고유 장면 | 144 | 복호화 후 모든 `scene:` 선언 |
| 입력 사례 | 180 | fixture의 고유 `cases[].id` |
| 선택·경계값 사례 | 173 | 아래 위젯·상황·조합별 표 |
| 억제·잘못된 입력 사례 | 7 | 마지막 표. 명시적 상태 안내를 선택하는 사례도 포함 |

144개 장면 모두에 최소 하나의 선택 사례가 있다. 기존 위젯·상황 130개에 위젯 설치와 독립적인 시간대 4개와 기본 날씨 10개를 더했다. 각 조건은 `dialogue.variant` 0~4에 따라 서로 다른 대사 5개를 제공한다. 교감의 나디르 반응은 친밀도 40 미만·이상에 각각 5개이며 별꼬리 대상도 5개다. 테스트는 친밀도 20·50·80 각각에서 다섯 변주의 렌더링 결과가 서로 다른지 검사한다.

실제 사건을 받는 `on != idle` 장면은 `cooldown: 0s`를 사용한다. 같은 사용자 동작이 새 사건으로 전달되면 이전 대사의 표시 이력이 다음 반응을 막지 않는다. `idle` 장면은 기존 `30m` 간격을 유지한다. 같은 사건 ID의 중복 소비·만료·취소는 호스트 경계가 처리하며 대본 cooldown으로 대신하지 않는다.

180개 사례가 가능한 입력값의 모든 조합을 뜻하지는 않는다. 비어 있음과 값이 있음, 실행·일시정지·종료, 성공·실패·무승부, 최초 조회·오래된 정보·연결 실패처럼 **대사가 달라져야 하는 의미 있는 분기**를 대상으로 한다. 기온 0도·28도와 배터리 20% 등의 값은 이 번들 대사가 정한 분기 경계다.

원본은 다음 세 곳이다.

- `talk/fixtures/coverage.json`: 정확한 입력과 기대 장면. 아래 표의 `case ID`가 `cases[].id`이며 `JSON 행`은 이 파일의 해당 객체를 여는 `{` 위치다.
- `talk/`: 실제 실행하는 암호화 대본과 복호화 후 `when:` 조건. 각 표 위에 대사 파일 경로를 적었다. 읽기·편집 경로는 [대사 작성 참조](talk-reference.md)를 따른다.
- `src-tauri/src/talk/defaults.rs`: 원본을 실제 parser와 evaluator에 넣는 테스트, 실제 위젯 저장·이벤트 경로를 검증하는 테스트.

대사 파일 경로·case ID·JSON 행을 함께 사용하면 문서에 입력 JSON을 복제하지 않고 정확한 원본을 찾을 수 있다. 행 번호는 파일이 바뀌면 달라질 수 있으므로 `case ID`를 우선한다.

## 입력을 읽고 다시 검증하기

프로젝트 루트에서 다음 명령으로 표의 한 행에 해당하는 입력 전체를 출력한다. `id`만 원하는 `case ID`로 바꾼다.

```sh
python3 - <<'PYCASE'
import json
from pathlib import Path

id = "timer.finished-rest"
cases = json.loads(Path("talk/fixtures/coverage.json").read_text())["cases"]
print(json.dumps(next(case for case in cases if case["id"] == id), ensure_ascii=False, indent=2))
PYCASE
```

각 입력에는 `values`의 평탄한 공개 변수, 발생 계기인 `trigger`, 사용할 수 있는 위젯 종류 `available`, 바탕화면 목록 순서의 캐릭터 ID `active`(앞 두 명이 A/B), 기대 장면 `expectedScene`이 들어 있다. 일부 상황에는 같은 우선순위 후보 사이의 선택을 재현하는 `seed`도 있다. `expectedScene: null`은 장면을 선택하지 않아야 한다는 뜻이다.

fixture 테스트는 registry의 모든 변수를 `null`로 시작하되 `*.ready`는 `false`, `*.status`는 `not-installed`로 초기화한 뒤 `values`를 덮어쓴다. `now_ms`는 1,000,000이며 생략한 `seed`는 0이다. 양성 사례는 다른 장면의 표시 이력을 채워 목표 장면의 도달 가능성을 확인한다. 이력은 `idle` 후보를 cooldown으로 억제하고 cooldown이 0인 사건 후보 사이에서는 최근 표시 순위에 영향을 준다. 선택 없음 사례는 빈 이력으로 평가하며, 불완전 context 사례를 제외하면 source identity를 제공해 조합 불일치가 상태 검사를 가리지 않게 한다. 전체 후보가 동시에 열린 상황의 우선순위를 증명하는 표는 아니다.

선택 없음 fixture는 해당 위젯의 잘못된 입력을 격리하므로 기본 시간·날씨 변수는 생략한다. 전체 호스트 context에서 같은 순간 기본 대사가 나오는지와 위젯 대사가 억제되는지는 별개다.

로컬 캐릭터 ID가 `fixture-a`·`fixture-b`여도 `character.a.sourceId: nadir`·`character.b.sourceId: star-tail`이 있으면 나디르·별꼬리 조합으로 평가한다. `active` 이름만으로 성격이나 화자를 추정하지 않는다. 실제 호스트가 채우는 `environment.hour`, `environment.weatherReady` 등도 fixture에서는 필요한 경우 명시한다.

다음 명령은 번들 대사와 DB 연계 테스트를 함께 실행한다.

```sh
cargo test --manifest-path src-tauri/Cargo.toml --lib talk::defaults
```

진입 파일은 `talk/index.talk`이며 위젯 목록·상황·둘의 대본을 모두 `for pair("source:nadir", "source:star-tail")`로 불러온다. 가져온 팩과 화면 슬롯 교환에서도 source identity로 화자를 매핑하고, 다른 캐릭터 조합에는 나디르의 대사를 적용하지 않는다. 원본 대사 파일을 편집하는 동안에는 테스트를 실행하지 않는다. 번들 envelope는 컴파일 때 `include_str!`로 포함되므로 빌드 이후 파일을 바꾸면 복호화 원문 일치 검사가 실패할 수 있다.

## 자동 검증이 보장하는 범위

정규화한 fixture만 검사하지 않는다. 번들 검증 6개와 DB 경로 검증 8개는 서로 다른 경계를 확인한다.

| 검증 | 확인하는 내용 |
| --- | --- |
| 모든 fixture | 실제 registry로 파일을 해석하고 목표 장면의 도달 가능성을 검사. 모든 고유 장면에 양성 사례가 있는지도 대조 |
| 번들 원본 일치 | `FILES`의 파일 집합과 복호화 원문이 parser의 import 그래프·원문과 일치 |
| 조합과 재사용 대기 | 슬롯과 source identity를 뒤집어도 동일 인물의 대사가 따라가며, 표시 이력이 있는 `idle` 조합 장면은 cooldown으로 제외 |
| 조건별 변주 | 양성 fixture마다 친밀도 20·50·80, 변주 번호 0~4를 적용해 다섯 렌더링 결과가 서로 다름 |
| 반복 교감 사건 | A/B 각각의 쓰다듬기·콕 찌르기·간식에 직전 표시 이력을 누적해도 5개 seed 모두 반응하며 서로 다른 변주를 선택. 모든 사건 장면은 cooldown 0, `idle` 장면은 30분인지 함께 검사 |
| 문자열 치환 | 위젯 제목을 문법으로 다시 해석하지 않고 일반 문자열로 보존. 치환 후 길이 제한 초과는 재생하지 않음 |

DB 경로 테스트는 임시 저장소에 실제 위젯을 설치하고 `storage::execute` → `storage::take_reaction` → `context::build` → `simulate`를 연결한다. 이벤트를 소비한 뒤 같은 큐에서 다시 나오지 않는지도 확인한다.

| DB 경로 테스트 | 실제 데이터에서 확인하는 분기 |
| --- | --- |
| 22종 초기 상태 | catalog의 22종을 모두 설치하고 각각의 초기 상태 대사에 도달. 다른 후보를 cooldown 기록으로 억제해 각 장면의 도달 가능성을 확인 |
| 집중·휴식 타이머 | 실제 타이머를 시작하고 종료 시점에 `pause`하여 생성한 `timer-finished`의 `mode`가 focus/rest 대사를 구분 |
| 작은 승부 | 실제 주사위 A/B 승리·무승부, 동전 성공·실패, 가위바위보 사용자/캐릭터 승리·무승부의 payload와 대사 연결 |
| 맞히기 | 컵의 빈 선택·정답, 숫자의 higher/lower·정답, 실제 100회 오답 뒤 exhausted. 숨긴 정답 변수가 context에 노출되지 않음 |
| 낚시 | 실제 낚시에서 파란 물고기·금빛 물고기·양말·동그란 돌 이름 치환과 실패. 선택 기능인 수집함 없이도 낚시 대사 선택 |
| 캐릭터 교감 | A/B 각각의 쓰다듬기·콕 찌르기·간식 payload를 사용해 실제 대상 캐릭터가 첫 화자로 반응 |
| 교감 슬롯 교환 | 별꼬리 A·나디르 B로 교환한 뒤 콕 찌르기 사건의 첫 화자와 인물별 반응을 함께 확인 |
| 준비 봉투 | 일정을 연결한 빈 봉투 → 미체크 항목 → 체크 완료의 실제 action 결과. 빈 체크리스트를 완료라고 말하지 않고, 별도 발생하지 않은 이벤트도 만들지 않음 |

준비 봉투 테스트에서는 외부 일정 입력을 DB에 넣은 뒤 봉투 action을 수행한다. 외부 캘린더 인증·통신 자체를 검증하는 테스트는 아니다. 이전 대본의 macOS 1분 타이머 관측은 아래에 과거 검증으로 구분한다. 아래 표만으로 모든 UI·운영체제·외부 공급자의 동작을 보장하지 않는다.

## 이전 macOS 관측과 현재 검증 경계

2026-09-16의 이전 A/B 대본 검증에서는 22종 초기 상태의 첫 대사를 native 접근성 정보로 확인하고 전체 대화 기록을 대조했다. 실제 주사위, B에게 간식 주기, 1분 타이머, 기기 정보와 날씨 흐름도 확인했다. 당시 앱 실행·관측 방법과 개별 결과는 [검증 기록](../VALIDATION-TALK.md)에 남아 있다. 이 기록은 2026-09-19 나디르·별꼬리 대사, 새 변주, 시간·날씨 기본 대본의 native 표시를 검증한 결과가 아니다. 이번 표의 parser·evaluator·DB 테스트 통과와 실제 데스크톱 표시 검증은 별도로 판단한다.

외부 계정 인증이 필요한 연동과 Windows 실행은 미검증이다. `.talk`는 저장된 규칙을 재생하는 경로이므로 이 검증 숫자를 LLM의 의미 품질 평가로 해석하지 않는다.

## 위젯·상황별 선택 사례

`상태 분기`에는 fixture의 `state` 식별값을 그대로 적었다. 정확한 `when:` 조건은 각 대사 파일을 확인한다. 같은 장면을 선택하는 행이라도 mode·성장 단계·경계값·교감 대상이 다르면 별도 사례다.

### 할 일

대사 파일: `talk/widgets/todo.talk`

| case ID | 상태 분기 | trigger | 기대 장면 | JSON 행 |
| --- | --- | --- | --- | ---: |
| `todo.empty` | `empty` | `idle` | `todo.empty` | 5 |
| `todo.open` | `open` | `idle` | `todo.open` | 29 |
| `todo.overdue` | `overdue` | `idle` | `todo.overdue` | 53 |
| `todo.cleared` | `cleared` | `idle` | `todo.cleared` | 76 |
| `todo.completed` | `completed` | `todo-completed` | `todo.completed` | 100 |
| `todo.undone` | `undone` | `todo-undone` | `todo.undone` | 123 |

### 캘린더

대사 파일: `talk/widgets/calendar.talk`

| case ID | 상태 분기 | trigger | 기대 장면 | JSON 행 |
| --- | --- | --- | --- | ---: |
| `calendar.empty` | `empty` | `idle` | `calendar.empty` | 146 |
| `calendar.timed` | `timed` | `idle` | `calendar.timed` | 169 |
| `calendar.all-day` | `all-day` | `idle` | `calendar.all-day` | 194 |
| `calendar.reminder` | `reminder` | `calendar-reminder` | `calendar.reminder` | 219 |
| `calendar.no-next` | `no-next` | `idle` | `calendar.no-next` | 1971 |
| `calendar.unconfigured` | `unconfigured` | `idle` | `calendar.unconfigured` | 1995 |
| `calendar.stale` | `stale` | `idle` | `calendar.stale` | 2017 |
| `calendar.unavailable` | `connection failed` | `idle` | `calendar.unavailable` | 3366 |
| `calendar.syncing` | `syncing` | `idle` | `calendar.syncing` | 3388 |
| `calendar.unavailable.auth-error` | `connection failed / auth-error` | `idle` | `calendar.unavailable` | 3642 |
| `calendar.unavailable.partial-permission-error` | `connection failed / partial-permission-error` | `idle` | `calendar.unavailable` | 3664 |

### 집중 타이머

대사 파일: `talk/widgets/focus-timer.talk`

| case ID | 상태 분기 | trigger | 기대 장면 | JSON 행 |
| --- | --- | --- | --- | ---: |
| `timer.idle` | `idle` | `idle` | `timer.idle` | 242 |
| `timer.focus` | `focus` | `idle` | `timer.focus` | 265 |
| `timer.rest` | `rest` | `idle` | `timer.rest` | 289 |
| `timer.paused` | `paused` | `idle` | `timer.paused` | 313 |
| `timer.finished-focus` | `finished-focus` | `timer-finished` | `timer.finished-focus` | 336 |
| `timer.finished-rest` | `finished-rest` | `timer-finished` | `timer.finished-rest` | 360 |
| `timer.finished` | `finished` | `idle` | `timer.finished` | 2083 |
| `timer.idle.focus` | `idle / focus` | `idle` | `timer.idle` | 2442 |
| `timer.idle.rest` | `idle / rest` | `idle` | `timer.idle` | 2466 |
| `timer.paused.focus` | `paused / focus` | `idle` | `timer.paused` | 2490 |
| `timer.paused.rest` | `paused / rest` | `idle` | `timer.paused` | 2514 |
| `timer.finished.focus` | `finished / focus` | `idle` | `timer.finished` | 2754 |
| `timer.finished.rest` | `finished / rest` | `idle` | `timer.finished` | 2778 |

### 준비 봉투

대사 파일: `talk/widgets/preparation.talk`

| case ID | 상태 분기 | trigger | 기대 장면 | JSON 행 |
| --- | --- | --- | --- | ---: |
| `preparation.empty` | `empty` | `idle` | `preparation.empty` | 384 |
| `preparation.unchecked` | `unchecked` | `idle` | `preparation.unchecked` | 407 |
| `preparation.checked` | `checked` | `idle` | `preparation.checked` | 431 |
| `preparation.no-checks` | `no-checks` | `idle` | `preparation.no-checks` | 2106 |

### 완료 구슬병

대사 파일: `talk/widgets/completion-jar.talk`

| case ID | 상태 분기 | trigger | 기대 장면 | JSON 행 |
| --- | --- | --- | --- | ---: |
| `jar.empty` | `empty` | `idle` | `jar.empty` | 456 |
| `jar.filled` | `filled` | `idle` | `jar.filled` | 479 |

### 시계·기념일

대사 파일: `talk/widgets/clock.talk`

| case ID | 상태 분기 | trigger | 기대 장면 | JSON 행 |
| --- | --- | --- | --- | ---: |
| `clock.no-anniversary` | `no-anniversary` | `idle` | `clock.no-anniversary` | 502 |
| `clock.today` | `today` | `idle` | `clock.today` | 525 |
| `clock.upcoming` | `upcoming` | `idle` | `clock.upcoming` | 549 |
| `clock.past` | `past` | `idle` | `clock.past` | 2130 |

### 메모

대사 파일: `talk/widgets/memo.talk`

| case ID | 상태 분기 | trigger | 기대 장면 | JSON 행 |
| --- | --- | --- | --- | ---: |
| `memo.empty` | `empty` | `idle` | `memo.empty` | 573 |
| `memo.written` | `written` | `idle` | `memo.written` | 596 |

### 날씨

대사 파일: `talk/widgets/weather.talk`

| case ID | 상태 분기 | trigger | 기대 장면 | JSON 행 |
| --- | --- | --- | --- | ---: |
| `weather.freezing` | `freezing` | `idle` | `weather.freezing` | 619 |
| `weather.mild` | `mild` | `idle` | `weather.mild` | 642 |
| `weather.hot` | `hot` | `idle` | `weather.hot` | 666 |
| `weather.unconfigured` | `unconfigured` | `idle` | `weather.unconfigured` | 2039 |
| `weather.stale` | `stale` | `idle` | `weather.stale` | 2061 |
| `weather.fog` | `fog` | `idle` | `weather.fog` | 2322 |
| `weather.rain` | `rain` | `idle` | `weather.rain` | 2346 |
| `weather.snow` | `snow` | `idle` | `weather.snow` | 2370 |
| `weather.showers` | `showers` | `idle` | `weather.showers` | 2394 |
| `weather.storm` | `storm` | `idle` | `weather.storm` | 2418 |
| `weather.offline` | `weather.offline` | `idle` | `weather.offline` | 2802 |
| `weather.unsupported` | `weather.unsupported` | `idle` | `weather.unsupported` | 2824 |
| `weather.error` | `weather.error` | `idle` | `weather.error` | 2846 |
| `weather.syncing` | `syncing` | `idle` | `weather.syncing` | 3410 |
| `weather.unclassified` | `unclassified` | `idle` | `weather.unclassified` | 3499 |
| `weather.freezing.zero` | `freezing / zero` | `idle` | `weather.freezing` | 3522 |
| `weather.hot.threshold` | `hot / threshold` | `idle` | `weather.hot` | 3545 |

### 음악 정보

대사 파일: `talk/widgets/music.talk`

| case ID | 상태 분기 | trigger | 기대 장면 | JSON 행 |
| --- | --- | --- | --- | ---: |
| `music.stopped` | `stopped` | `idle` | `music.stopped` | 690 |
| `music.paused` | `paused` | `idle` | `music.paused` | 713 |
| `music.playing` | `playing` | `idle` | `music.playing` | 737 |
| `music.offline` | `music.offline` | `idle` | `music.offline` | 2868 |
| `music.unsupported` | `music.unsupported` | `idle` | `music.unsupported` | 2890 |
| `music.error` | `music.error` | `idle` | `music.error` | 2912 |
| `music.stale` | `music.stale` | `idle` | `music.stale` | 2934 |
| `music.permission-needed` | `music.permission-needed` | `idle` | `music.permission-needed` | 2956 |
| `music.syncing` | `syncing` | `idle` | `music.syncing` | 3432 |

### 기기 소식

대사 파일: `talk/widgets/device.talk`

| case ID | 상태 분기 | trigger | 기대 장면 | JSON 행 |
| --- | --- | --- | --- | ---: |
| `device.no-battery` | `no-battery` | `idle` | `device.no-battery` | 761 |
| `device.low` | `low` | `idle` | `device.low` | 784 |
| `device.charging` | `charging` | `idle` | `device.charging` | 809 |
| `device.enough` | `enough` | `idle` | `device.enough` | 833 |
| `device.charged` | `charged` | `idle` | `device.charged` | 2154 |
| `device.unknown` | `unknown` | `idle` | `device.unknown` | 2178 |
| `device.offline` | `device.offline` | `idle` | `device.offline` | 2978 |
| `device.unsupported` | `device.unsupported` | `idle` | `device.unsupported` | 3000 |
| `device.error` | `device.error` | `idle` | `device.error` | 3022 |
| `device.stale` | `device.stale` | `idle` | `device.stale` | 3044 |
| `device.permission-needed` | `device.permission-needed` | `idle` | `device.permission-needed` | 3066 |
| `device.woke` | `device.woke` | `device-woke` | `device.woke` | 3088 |
| `device.syncing` | `syncing` | `idle` | `device.syncing` | 3454 |
| `device.not-charging` | `not-charging` | `idle` | `device.not-charging` | 3476 |
| `device.low.threshold` | `low / threshold` | `idle` | `device.low` | 3569 |

### 캐릭터 교감

대사 파일: `talk/widgets/interaction.talk`

| case ID | 상태 분기 | trigger | 기대 장면 | JSON 행 |
| --- | --- | --- | --- | ---: |
| `interaction.snacks` | `snacks` | `idle` | `interaction.snacks` | 858 |
| `interaction.empty` | `empty` | `idle` | `interaction.empty` | 881 |
| `interaction.stroke` | `stroke` | `interaction.touch` | `interaction.stroke` | 2226 |
| `interaction.poke` | `poke` | `interaction.touch` | `interaction.poke` | 2250 |
| `interaction.snack` | `snack` | `interaction.touch` | `interaction.snack` | 2274 |
| `interaction.stroke.target-b` | `stroke / target B` | `interaction.touch` | `interaction.stroke` | 3810 |
| `interaction.poke.target-b` | `poke / target B` | `interaction.touch` | `interaction.poke` | 3834 |
| `interaction.snack.target-b` | `snack / target B` | `interaction.touch` | `interaction.snack` | 3858 |

### 공

대사 파일: `talk/widgets/ball.talk`

| case ID | 상태 분기 | trigger | 기대 장면 | JSON 행 |
| --- | --- | --- | --- | ---: |
| `ball.still` | `still` | `idle` | `ball.still` | 904 |
| `ball.moving` | `moving` | `idle` | `ball.moving` | 927 |
| `ball.stopped` | `stopped` | `ball.stopped` | `ball.stopped` | 950 |

### 종이비행기

대사 파일: `talk/widgets/paper-plane.talk`

| case ID | 상태 분기 | trigger | 기대 장면 | JSON 행 |
| --- | --- | --- | --- | ---: |
| `plane.ready` | `ready` | `idle` | `plane.ready` | 973 |
| `plane.flying` | `flying` | `idle` | `plane.flying` | 996 |
| `plane.landed` | `landed` | `paper-plane.landed` | `plane.landed` | 1019 |

### 비눗방울

대사 파일: `talk/widgets/bubbles.talk`

| case ID | 상태 분기 | trigger | 기대 장면 | JSON 행 |
| --- | --- | --- | --- | ---: |
| `bubbles.empty` | `empty` | `idle` | `bubbles.empty` | 1043 |
| `bubbles.floating` | `floating` | `idle` | `bubbles.floating` | 1066 |
| `bubbles.streak` | `streak` | `bubbles.streak` | `bubbles.streak` | 2298 |

### 작은 승부

대사 파일: `talk/widgets/small-match.talk`

| case ID | 상태 분기 | trigger | 기대 장면 | JSON 행 |
| --- | --- | --- | --- | ---: |
| `match.new` | `new` | `idle` | `match.new` | 1089 |
| `match.played` | `played` | `idle` | `match.played` | 1112 |
| `match.winner-a` | `winner-a` | `small-match.result` | `match.winner-a` | 1135 |
| `match.winner-b` | `winner-b` | `small-match.result` | `match.winner-b` | 1158 |
| `match.draw` | `draw` | `small-match.result` | `match.draw` | 1181 |
| `match.winner-user` | `winner-user` | `small-match.result` | `match.winner-user` | 1204 |
| `match.winner-character` | `winner-character` | `small-match.result` | `match.winner-character` | 1227 |
| `match.correct` | `correct` | `small-match.result` | `match.correct` | 1250 |
| `match.miss` | `miss` | `small-match.result` | `match.miss` | 1273 |
| `match.played.dice` | `played / dice` | `idle` | `match.played` | 2538 |
| `match.played.coin` | `played / coin` | `idle` | `match.played` | 2562 |
| `match.played.rps` | `played / rps` | `idle` | `match.played` | 2586 |
| `match.new.initial` | `new / initial` | `idle` | `match.new` | 3711 |

### 맞히기 놀이

대사 파일: `talk/widgets/guessing.talk`

| case ID | 상태 분기 | trigger | 기대 장면 | JSON 행 |
| --- | --- | --- | --- | ---: |
| `guessing.idle` | `idle` | `idle` | `guessing.idle` | 1296 |
| `guessing.cups` | `cups` | `idle` | `guessing.cups` | 1320 |
| `guessing.number` | `number` | `idle` | `guessing.number` | 1344 |
| `guessing.correct` | `correct` | `guessing.attempt` | `guessing.correct` | 1368 |
| `guessing.exhausted` | `exhausted` | `guessing.attempt` | `guessing.exhausted` | 1391 |
| `guessing.empty` | `empty` | `guessing.attempt` | `guessing.empty` | 1414 |
| `guessing.higher` | `higher` | `guessing.attempt` | `guessing.higher` | 1437 |
| `guessing.lower` | `lower` | `guessing.attempt` | `guessing.lower` | 1460 |
| `guessing.between-rounds` | `between-rounds` | `idle` | `guessing.between-rounds` | 2202 |
| `guessing.idle.initial-cups` | `idle / initial-cups` | `idle` | `guessing.idle` | 3686 |

### 낚시

대사 파일: `talk/widgets/fishing.talk`

| case ID | 상태 분기 | trigger | 기대 장면 | JSON 행 |
| --- | --- | --- | --- | ---: |
| `fishing.idle` | `idle` | `idle` | `fishing.idle` | 1483 |
| `fishing.waiting` | `waiting` | `idle` | `fishing.waiting` | 1506 |
| `fishing.bite` | `bite` | `idle` | `fishing.bite` | 1529 |
| `fishing.bite-event` | `bite-event` | `fishing.bite` | `fishing.bite-event` | 1552 |
| `fishing.missed` | `missed` | `fishing.missed` | `fishing.missed` | 1575 |
| `fishing.caught.fish` | `successful catch / fish` | `item-acquired` | `fishing.caught` | 3735 |
| `fishing.caught.sock` | `successful catch / sock` | `item-acquired` | `fishing.caught` | 3760 |
| `fishing.caught.stone` | `successful catch / stone` | `item-acquired` | `fishing.caught` | 3785 |

### 장난 운세

대사 파일: `talk/widgets/fortune.talk`

| case ID | 상태 분기 | trigger | 기대 장면 | JSON 행 |
| --- | --- | --- | --- | ---: |
| `fortune.fresh` | `fresh` | `idle` | `fortune.fresh` | 1598 |
| `fortune.drawn` | `drawn` | `idle` | `fortune.drawn` | 1621 |
| `fortune.draw` | `draw` | `fortune.draw` | `fortune.draw` | 1644 |

### 화분

대사 파일: `talk/widgets/plant.talk`

| case ID | 상태 분기 | trigger | 기대 장면 | JSON 행 |
| --- | --- | --- | --- | ---: |
| `plant.dry` | `dry` | `idle` | `plant.dry` | 1668 |
| `plant.watered` | `watered` | `idle` | `plant.watered` | 1692 |
| `plant.grown` | `grown` | `idle` | `plant.grown` | 1716 |
| `plant.growth` | `growth` | `plant.growth` | `plant.growth` | 1739 |
| `plant.dry.stage-0` | `dry / stage 0` | `idle` | `plant.dry` | 2610 |
| `plant.dry.stage-1` | `dry / stage 1` | `idle` | `plant.dry` | 2634 |
| `plant.dry.stage-2` | `dry / stage 2` | `idle` | `plant.dry` | 2658 |
| `plant.watered.stage-0` | `watered / stage 0` | `idle` | `plant.watered` | 2682 |
| `plant.watered.stage-1` | `watered / stage 1` | `idle` | `plant.watered` | 2706 |
| `plant.watered.stage-2` | `watered / stage 2` | `idle` | `plant.watered` | 2730 |
| `plant.grown.watered` | `grown / watered` | `idle` | `plant.grown` | 3594 |
| `plant.grown.dry` | `grown / dry` | `idle` | `plant.grown` | 3618 |

### 작은 펫

대사 파일: `talk/widgets/pet.talk`

| case ID | 상태 분기 | trigger | 기대 장면 | JSON 행 |
| --- | --- | --- | --- | ---: |
| `pet.resting` | `resting` | `idle` | `pet.resting` | 1762 |
| `pet.moving` | `moving` | `idle` | `pet.moving` | 1785 |
| `pet.arrived` | `arrived` | `pet.arrived` | `pet.arrived` | 1808 |

### 수집함·소품

대사 파일: `talk/widgets/collection.talk`

| case ID | 상태 분기 | trigger | 기대 장면 | JSON 행 |
| --- | --- | --- | --- | ---: |
| `collection.empty` | `empty` | `idle` | `collection.empty` | 1831 |
| `collection.stored` | `stored` | `idle` | `collection.stored` | 1854 |
| `collection.decorated` | `decorated` | `idle` | `collection.decorated` | 1878 |
| `collection.acquired` | `acquired` | `item-acquired` | `collection.acquired` | 1901 |

### 함께한 사건 일지

대사 파일: `talk/widgets/journal.talk`

| case ID | 상태 분기 | trigger | 기대 장면 | JSON 행 |
| --- | --- | --- | --- | ---: |
| `journal.empty` | `empty` | `idle` | `journal.empty` | 1925 |
| `journal.recorded` | `recorded` | `idle` | `journal.recorded` | 1948 |

### 위젯을 함께 사용하는 상황

대사 파일: `talk/situations/index.talk`

| case ID | 상태 분기 | trigger | 기대 장면 | JSON 행 |
| --- | --- | --- | --- | ---: |
| `situation.quiet-focus` | `situation.quiet-focus` | `idle` | `situation.quiet-focus` | 3112 |
| `situation.little-shelf` | `situation.little-shelf` | `idle` | `situation.little-shelf` | 3139 |

### 나디르·별꼬리 조합

대사 파일: `talk/pairs/default.talk`

| case ID | 상태 분기 | trigger | 기대 장면 | JSON 행 |
| --- | --- | --- | --- | ---: |
| `pair.quiet-focus` | `pair.quiet-focus` | `idle` | `pair.quiet-focus` | 3165 |
| `pair.little-shelf` | `pair.little-shelf` | `idle` | `pair.little-shelf` | 3191 |

### 위젯 없이 동작하는 시간·날씨

대사 파일: `talk/situations/index.talk`

이 14개 fixture는 모두 `available: []`이며 나디르·별꼬리 source identity와 core 환경값만 사용한다. 시간대는 로컬 시각으로 아침 06~11시, 낮 12~17시, 저녁 18~21시, 밤 22~05시다. 날씨 정보가 없으면 `base-weather.unknown`이 현재 날씨를 모른다고 말한다. 위젯을 설치하지 않았다고 전체 대화가 사라지는 계약이 아니다. 아래 입력에 관측값을 직접 넣은 날씨 사례는 실제 외부 날씨 연결의 성공을 증명하지 않는다.

새 기본 환경 fixture에는 `state` 필드가 없으므로 아래 표의 `상태 분기`는 `scene`의 마지막 식별자를 사용한다.

| case ID | 상태 분기 | trigger | 기대 장면 | JSON 행 |
| --- | --- | --- | --- | ---: |
| `time.morning` | `morning` | `idle` | `time.morning` | 3882 |
| `time.afternoon` | `afternoon` | `idle` | `time.afternoon` | 3899 |
| `time.evening` | `evening` | `idle` | `time.evening` | 3916 |
| `time.night` | `night` | `idle` | `time.night` | 3933 |
| `base-weather.unknown` | `unknown` | `idle` | `base-weather.unknown` | 3950 |
| `base-weather.freezing` | `freezing` | `idle` | `base-weather.freezing` | 3967 |
| `base-weather.mild` | `mild` | `idle` | `base-weather.mild` | 3985 |
| `base-weather.hot` | `hot` | `idle` | `base-weather.hot` | 4004 |
| `base-weather.fog` | `fog` | `idle` | `base-weather.fog` | 4023 |
| `base-weather.rain` | `rain` | `idle` | `base-weather.rain` | 4042 |
| `base-weather.snow` | `snow` | `idle` | `base-weather.snow` | 4061 |
| `base-weather.showers` | `showers` | `idle` | `base-weather.showers` | 4080 |
| `base-weather.storm` | `storm` | `idle` | `base-weather.storm` | 4099 |
| `base-weather.unclassified` | `unclassified` | `idle` | `base-weather.unclassified` | 4118 |

## 억제·잘못된 입력 사례

위젯의 오래된 값과 빈 값을 실제 관측값으로 해석하지 않는 입력 사례다. 선택 없음 사례에서는 목표 후보의 `dependency_unavailable`, `condition_false`, `trigger_mismatch`도 확인해 cooldown이나 다른 캐릭터 조합 때문에 우연히 통과하지 않게 한다. 불완전 context만 source identity가 없으므로 `pair_mismatch`가 기대 결과다. `음악 정보가 오래됨`, `봉투에 체크 항목이 없음`처럼 상태를 정확히 알려 주는 장면은 선택할 수 있다.

| case ID | 상태 분기 | trigger | 대사 파일 | 기대 장면 | JSON 행 |
| --- | --- | --- | --- | --- | ---: |
| `negative.incomplete-context` | `missing source identity and core environment` | `idle` | `talk/index.talk` | 선택 없음 | 3216 |
| `negative.disabled-todo` | `disabled with old values` | `idle` | `talk/widgets/todo.talk` | 선택 없음 | 3229 |
| `negative.null-weather` | `ready with absent temperature and code` | `idle` | `talk/widgets/weather.talk` | 선택 없음 | 3250 |
| `negative.stale-values` | `stale observation cannot produce playback claim` | `idle` | `talk/widgets/music.talk` | `music.stale` | 3274 |
| `negative.event-mismatch` | `wrong event cannot play result` | `idle` | `talk/widgets/guessing.talk` | 선택 없음 | 3298 |
| `negative.unknown-result` | `absent structured result` | `small-match.result` | `talk/widgets/small-match.talk` | 선택 없음 | 3320 |
| `negative.empty-preparation` | `empty envelope is not a completed checklist` | `idle` | `talk/widgets/preparation.talk` | `preparation.no-checks` | 3342 |

`negative.incomplete-context`는 `values: {}`인 불완전 context이며 나디르·별꼬리 source identity와 core 환경값도 없다. 이 사례의 선택 없음은 실제 앱에서 위젯 없이 대화가 안 나온다는 뜻이 아니다. 실제 기본 대본의 위젯 독립성은 위의 시간·날씨 14개 양성 사례로 구분해 확인한다.

## 변경 후 갱신 기준

장면 추가·삭제, `when:` 조건, registry의 변수·이벤트, 위젯 payload, fixture 입력을 바꾸면 이 표를 함께 갱신한다. 먼저 실제 parser/evaluator 및 DB 경로 테스트를 통과시키고, `cases[].id` 중복 여부와 모든 장면의 양성 사례를 대조한 뒤 파일·장면·사례 수와 JSON 행을 다시 계산한다. 이름이나 숫자만 맞추기 위해 기대 장면을 바꾸지 않는다.

새 위젯은 초기 상태뿐 아니라 값이 없을 때, 실행 중일 때, 결과가 나온 뒤, 정보가 오래되거나 실패했을 때 중 해당하는 분기를 추가한다. 사건을 새로 읽는 대사는 가짜 payload만 만들지 말고 실제 저장 action 또는 tick에서 발생한 사건과 `context::build`를 연결하는 사례로 확인한다.
