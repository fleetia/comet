---
title: 대사 분기 검증표
description: 22종 위젯의 실제 상태·이벤트와 번들 대사를 연결하는 166개 입력 사례 및 DB 경로 검증 범위
---

# 대사 분기 검증표

번들 대사를 바꾸거나 위젯의 상태·이벤트 필드를 수정할 때 이 문서를 사용한다. 어떤 입력에서 어느 장면을 선택해야 하는지 확인하고, 해당 fixture와 실제 DB 경로 테스트를 함께 실행할 수 있다. 제품 동작은 [대사 스크립트](../product/talk.md), 문법과 공개 변수는 [대사 작성 참조](talk-reference.md), 실행 환경과 데스크톱 관측은 [검증 기록](../VALIDATION-TALK.md)을 따른다.

## 검증 대상과 원본

2026-09-16에 `talk/**/*.talk`와 `talk/fixtures/coverage.json`을 직접 읽어 아래 숫자와 모든 행의 연결을 대조했다.

| 대상 | 수 | 기준 |
| --- | ---: | --- |
| 위젯 종류 | 22 | `widgets/catalog.json` |
| 번들 `.talk` 파일 | 26 | 진입·목록 파일, 위젯 22개, 공통 상황·조합 파일 포함 |
| 고유 장면 | 130 | 모든 `scene:` 선언 |
| 입력 사례 | 166 | fixture의 고유 `cases[].id` |
| 선택·경계값 사례 | 159 | 아래 위젯·상황·조합별 표 |
| 억제·잘못된 입력 사례 | 7 | 마지막 표. 명시적 상태 안내를 선택하는 사례도 포함 |

130개 장면 모두에 최소 하나의 선택 사례가 있다. 166개 사례가 가능한 입력값의 모든 조합을 뜻하지는 않는다. 비어 있음과 값이 있음, 실행·일시정지·종료, 성공·실패·무승부, 최초 조회·오래된 정보·연결 실패처럼 **대사가 달라져야 하는 의미 있는 분기**를 대상으로 한다. 기온 0도·28도와 배터리 20% 등의 값은 이 번들 대사가 정한 분기 경계다.

원본은 다음 세 곳이다.

- `talk/fixtures/coverage.json`: 정확한 입력과 기대 장면. 아래 표의 `case ID`가 `cases[].id`이며 `JSON 행`은 이 파일의 해당 항목 시작 위치다.
- `talk/`: 실제 실행하는 대사와 `when:` 조건. 각 표 위에 대사 파일 경로를 적었다.
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

각 입력에는 `values`의 평탄한 공개 변수, 발생 계기인 `trigger`, 사용할 수 있는 위젯 종류 `available`, A/B 슬롯의 캐릭터 ID `active`, 기대 장면 `expectedScene`이 들어 있다. 일부 상황에는 같은 우선순위 후보 사이의 선택을 재현하는 `seed`도 있다. `expectedScene: null`은 장면을 선택하지 않아야 한다는 뜻이다.

fixture 테스트는 registry의 모든 변수를 `null`로 시작하되 `*.ready`는 `false`, `*.status`는 `not-installed`로 초기화한 뒤 `values`를 덮어쓴다. `now_ms`는 1,000,000이며 기록은 비어 있고, 생략한 `seed`는 0이다. 공통 대사 사례는 `fixture-a`·`fixture-b`를 활성 조합으로 사용해 기본 캐릭터 전용 대사의 우선순위와 분리한다.

다음 명령은 번들 대사와 DB 연계 테스트를 함께 실행한다.

```sh
cargo test --manifest-path src-tauri/Cargo.toml --lib talk::defaults
```

진입 파일은 `talk/index.talk`이며 위젯 목록과 상황을 `import`하고 기본 A/B 파일을 `for pair("builtin-a", "builtin-b")` 조건으로 불러온다. 원본 대사 파일을 편집하는 동안에는 테스트를 실행하지 않는다. 번들 원문은 컴파일 때 `include_str!`로 포함되므로 빌드 이후 원본을 바꾸면 원본 일치 검사가 실패할 수 있다.

## 자동 검증이 보장하는 범위

정규화한 fixture만 검사하지 않는다. 번들 검증 4개와 DB 경로 검증 7개는 서로 다른 경계를 확인한다.

| 검증 | 확인하는 내용 |
| --- | --- |
| 모든 fixture | 실제 registry로 파일을 해석하고 전체 import 그래프에서 기대 장면을 선택. 모든 고유 장면에 양성 사례가 있는지도 검사 |
| 번들 원본 일치 | `FILES`에 포함한 파일 집합·내용과 parser가 읽은 import 그래프가 일치 |
| 조합과 재사용 대기 | 기본 A/B 대사 우선순위, 슬롯을 뒤집었을 때 캐릭터 신원에 따른 화자 매핑, cooldown 중 공통 후보 선택과 만료 후 복귀 |
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
| 준비 봉투 | 일정을 연결한 빈 봉투 → 미체크 항목 → 체크 완료의 실제 action 결과. 빈 체크리스트를 완료라고 말하지 않고, 별도 발생하지 않은 이벤트도 만들지 않음 |

준비 봉투 테스트에서는 외부 일정 입력을 DB에 넣은 뒤 봉투 action을 수행한다. 외부 캘린더 인증·통신 자체를 검증하는 테스트는 아니다. 타이머 DB 테스트의 종료 입력과 별도로 macOS에서 실제 1분 타이머도 관측했다. 아래 표만으로 모든 UI·운영체제·외부 공급자의 동작을 보장하지 않는다.

## macOS 관측과 별도 경계

이번 macOS 검증에서는 22종 초기 상태의 첫 대사를 native 접근성 정보로 확인하고 전체 대화 기록을 대조했다. 실제 주사위, B에게 간식 주기, 1분 타이머, 기기 정보와 날씨 흐름도 확인했다. 앱 실행·관측 방법과 개별 결과는 [검증 기록](../VALIDATION-TALK.md)에 남긴다.

외부 계정 인증이 필요한 연동과 Windows 실행은 미검증이다. `.talk`는 저장된 규칙을 재생하는 경로이므로 이 검증 숫자를 LLM의 의미 품질 평가로 해석하지 않는다.

## 위젯·상황별 선택 사례

`상태 분기`에는 fixture의 `state` 식별값을 그대로 적었다. 정확한 `when:` 조건은 각 대사 파일을 확인한다. 같은 장면을 선택하는 행이라도 mode·성장 단계·경계값·교감 대상이 다르면 별도 사례다.

### 할 일

대사 파일: `talk/widgets/todo.talk`

| case ID | 상태 분기 | trigger | 기대 장면 | JSON 행 |
| --- | --- | --- | --- | ---: |
| `todo.empty` | `empty` | `idle` | `todo.empty` | 6 |
| `todo.open` | `open` | `idle` | `todo.open` | 26 |
| `todo.overdue` | `overdue` | `idle` | `todo.overdue` | 46 |
| `todo.cleared` | `cleared` | `idle` | `todo.cleared` | 65 |
| `todo.completed` | `completed` | `todo-completed` | `todo.completed` | 85 |
| `todo.undone` | `undone` | `todo-undone` | `todo.undone` | 104 |

### 캘린더

대사 파일: `talk/widgets/calendar.talk`

| case ID | 상태 분기 | trigger | 기대 장면 | JSON 행 |
| --- | --- | --- | --- | ---: |
| `calendar.empty` | `empty` | `idle` | `calendar.empty` | 123 |
| `calendar.timed` | `timed` | `idle` | `calendar.timed` | 142 |
| `calendar.all-day` | `all-day` | `idle` | `calendar.all-day` | 163 |
| `calendar.reminder` | `reminder` | `calendar-reminder` | `calendar.reminder` | 184 |
| `calendar.no-next` | `no-next` | `idle` | `calendar.no-next` | 1636 |
| `calendar.unconfigured` | `unconfigured` | `idle` | `calendar.unconfigured` | 1656 |
| `calendar.stale` | `stale` | `idle` | `calendar.stale` | 1674 |
| `calendar.unavailable` | `connection failed` | `idle` | `calendar.unavailable` | 2795 |
| `calendar.syncing` | `syncing` | `idle` | `calendar.syncing` | 2813 |
| `calendar.unavailable.auth-error` | `connection failed / auth-error` | `idle` | `calendar.unavailable` | 3023 |
| `calendar.unavailable.partial-permission-error` | `connection failed / partial-permission-error` | `idle` | `calendar.unavailable` | 3041 |

### 집중 타이머

대사 파일: `talk/widgets/focus-timer.talk`

| case ID | 상태 분기 | trigger | 기대 장면 | JSON 행 |
| --- | --- | --- | --- | ---: |
| `timer.idle` | `idle` | `idle` | `timer.idle` | 203 |
| `timer.focus` | `focus` | `idle` | `timer.focus` | 222 |
| `timer.rest` | `rest` | `idle` | `timer.rest` | 242 |
| `timer.paused` | `paused` | `idle` | `timer.paused` | 262 |
| `timer.finished-focus` | `finished-focus` | `timer-finished` | `timer.finished-focus` | 281 |
| `timer.finished-rest` | `finished-rest` | `timer-finished` | `timer.finished-rest` | 301 |
| `timer.finished` | `finished` | `idle` | `timer.finished` | 1728 |
| `timer.idle.focus` | `idle / focus` | `idle` | `timer.idle` | 2027 |
| `timer.idle.rest` | `idle / rest` | `idle` | `timer.idle` | 2047 |
| `timer.paused.focus` | `paused / focus` | `idle` | `timer.paused` | 2067 |
| `timer.paused.rest` | `paused / rest` | `idle` | `timer.paused` | 2087 |
| `timer.finished.focus` | `finished / focus` | `idle` | `timer.finished` | 2287 |
| `timer.finished.rest` | `finished / rest` | `idle` | `timer.finished` | 2307 |

### 준비 봉투

대사 파일: `talk/widgets/preparation.talk`

| case ID | 상태 분기 | trigger | 기대 장면 | JSON 행 |
| --- | --- | --- | --- | ---: |
| `preparation.empty` | `empty` | `idle` | `preparation.empty` | 321 |
| `preparation.unchecked` | `unchecked` | `idle` | `preparation.unchecked` | 340 |
| `preparation.checked` | `checked` | `idle` | `preparation.checked` | 360 |
| `preparation.no-checks` | `no-checks` | `idle` | `preparation.no-checks` | 1747 |

### 완료 구슬병

대사 파일: `talk/widgets/completion-jar.talk`

| case ID | 상태 분기 | trigger | 기대 장면 | JSON 행 |
| --- | --- | --- | --- | ---: |
| `jar.empty` | `empty` | `idle` | `jar.empty` | 381 |
| `jar.filled` | `filled` | `idle` | `jar.filled` | 400 |

### 시계·기념일

대사 파일: `talk/widgets/clock.talk`

| case ID | 상태 분기 | trigger | 기대 장면 | JSON 행 |
| --- | --- | --- | --- | ---: |
| `clock.no-anniversary` | `no-anniversary` | `idle` | `clock.no-anniversary` | 419 |
| `clock.today` | `today` | `idle` | `clock.today` | 438 |
| `clock.upcoming` | `upcoming` | `idle` | `clock.upcoming` | 458 |
| `clock.past` | `past` | `idle` | `clock.past` | 1767 |

### 메모

대사 파일: `talk/widgets/memo.talk`

| case ID | 상태 분기 | trigger | 기대 장면 | JSON 행 |
| --- | --- | --- | --- | ---: |
| `memo.empty` | `empty` | `idle` | `memo.empty` | 478 |
| `memo.written` | `written` | `idle` | `memo.written` | 497 |

### 날씨

대사 파일: `talk/widgets/weather.talk`

| case ID | 상태 분기 | trigger | 기대 장면 | JSON 행 |
| --- | --- | --- | --- | ---: |
| `weather.freezing` | `freezing` | `idle` | `weather.freezing` | 516 |
| `weather.mild` | `mild` | `idle` | `weather.mild` | 535 |
| `weather.hot` | `hot` | `idle` | `weather.hot` | 555 |
| `weather.unconfigured` | `unconfigured` | `idle` | `weather.unconfigured` | 1692 |
| `weather.stale` | `stale` | `idle` | `weather.stale` | 1710 |
| `weather.fog` | `fog` | `idle` | `weather.fog` | 1927 |
| `weather.rain` | `rain` | `idle` | `weather.rain` | 1947 |
| `weather.snow` | `snow` | `idle` | `weather.snow` | 1967 |
| `weather.showers` | `showers` | `idle` | `weather.showers` | 1987 |
| `weather.storm` | `storm` | `idle` | `weather.storm` | 2007 |
| `weather.offline` | `weather.offline` | `idle` | `weather.offline` | 2327 |
| `weather.unsupported` | `weather.unsupported` | `idle` | `weather.unsupported` | 2345 |
| `weather.error` | `weather.error` | `idle` | `weather.error` | 2363 |
| `weather.syncing` | `syncing` | `idle` | `weather.syncing` | 2831 |
| `weather.unclassified` | `unclassified` | `idle` | `weather.unclassified` | 2904 |
| `weather.freezing.zero` | `freezing / zero` | `idle` | `weather.freezing` | 2923 |
| `weather.hot.threshold` | `hot / threshold` | `idle` | `weather.hot` | 2942 |

### 음악 정보

대사 파일: `talk/widgets/music.talk`

| case ID | 상태 분기 | trigger | 기대 장면 | JSON 행 |
| --- | --- | --- | --- | ---: |
| `music.stopped` | `stopped` | `idle` | `music.stopped` | 575 |
| `music.paused` | `paused` | `idle` | `music.paused` | 594 |
| `music.playing` | `playing` | `idle` | `music.playing` | 614 |
| `music.offline` | `music.offline` | `idle` | `music.offline` | 2381 |
| `music.unsupported` | `music.unsupported` | `idle` | `music.unsupported` | 2399 |
| `music.error` | `music.error` | `idle` | `music.error` | 2417 |
| `music.stale` | `music.stale` | `idle` | `music.stale` | 2435 |
| `music.permission-needed` | `music.permission-needed` | `idle` | `music.permission-needed` | 2453 |
| `music.syncing` | `syncing` | `idle` | `music.syncing` | 2849 |

### 기기 소식

대사 파일: `talk/widgets/device.talk`

| case ID | 상태 분기 | trigger | 기대 장면 | JSON 행 |
| --- | --- | --- | --- | ---: |
| `device.no-battery` | `no-battery` | `idle` | `device.no-battery` | 634 |
| `device.low` | `low` | `idle` | `device.low` | 653 |
| `device.charging` | `charging` | `idle` | `device.charging` | 674 |
| `device.enough` | `enough` | `idle` | `device.enough` | 694 |
| `device.charged` | `charged` | `idle` | `device.charged` | 1787 |
| `device.unknown` | `unknown` | `idle` | `device.unknown` | 1807 |
| `device.offline` | `device.offline` | `idle` | `device.offline` | 2471 |
| `device.unsupported` | `device.unsupported` | `idle` | `device.unsupported` | 2489 |
| `device.error` | `device.error` | `idle` | `device.error` | 2507 |
| `device.stale` | `device.stale` | `idle` | `device.stale` | 2525 |
| `device.permission-needed` | `device.permission-needed` | `idle` | `device.permission-needed` | 2543 |
| `device.woke` | `device.woke` | `device-woke` | `device.woke` | 2561 |
| `device.syncing` | `syncing` | `idle` | `device.syncing` | 2867 |
| `device.not-charging` | `not-charging` | `idle` | `device.not-charging` | 2885 |
| `device.low.threshold` | `low / threshold` | `idle` | `device.low` | 2962 |

### 캐릭터 교감

대사 파일: `talk/widgets/interaction.talk`

| case ID | 상태 분기 | trigger | 기대 장면 | JSON 행 |
| --- | --- | --- | --- | ---: |
| `interaction.snacks` | `snacks` | `idle` | `interaction.snacks` | 715 |
| `interaction.empty` | `empty` | `idle` | `interaction.empty` | 734 |
| `interaction.stroke` | `stroke` | `interaction.touch` | `interaction.stroke` | 1847 |
| `interaction.poke` | `poke` | `interaction.touch` | `interaction.poke` | 1867 |
| `interaction.snack` | `snack` | `interaction.touch` | `interaction.snack` | 1887 |
| `interaction.stroke.target-b` | `stroke / target B` | `interaction.touch` | `interaction.stroke` | 3163 |
| `interaction.poke.target-b` | `poke / target B` | `interaction.touch` | `interaction.poke` | 3183 |
| `interaction.snack.target-b` | `snack / target B` | `interaction.touch` | `interaction.snack` | 3203 |

### 공

대사 파일: `talk/widgets/ball.talk`

| case ID | 상태 분기 | trigger | 기대 장면 | JSON 행 |
| --- | --- | --- | --- | ---: |
| `ball.still` | `still` | `idle` | `ball.still` | 753 |
| `ball.moving` | `moving` | `idle` | `ball.moving` | 772 |
| `ball.stopped` | `stopped` | `ball.stopped` | `ball.stopped` | 791 |

### 종이비행기

대사 파일: `talk/widgets/paper-plane.talk`

| case ID | 상태 분기 | trigger | 기대 장면 | JSON 행 |
| --- | --- | --- | --- | ---: |
| `plane.ready` | `ready` | `idle` | `plane.ready` | 810 |
| `plane.flying` | `flying` | `idle` | `plane.flying` | 829 |
| `plane.landed` | `landed` | `paper-plane.landed` | `plane.landed` | 848 |

### 비눗방울

대사 파일: `talk/widgets/bubbles.talk`

| case ID | 상태 분기 | trigger | 기대 장면 | JSON 행 |
| --- | --- | --- | --- | ---: |
| `bubbles.empty` | `empty` | `idle` | `bubbles.empty` | 868 |
| `bubbles.floating` | `floating` | `idle` | `bubbles.floating` | 887 |
| `bubbles.streak` | `streak` | `bubbles.streak` | `bubbles.streak` | 1907 |

### 작은 승부

대사 파일: `talk/widgets/small-match.talk`

| case ID | 상태 분기 | trigger | 기대 장면 | JSON 행 |
| --- | --- | --- | --- | ---: |
| `match.new` | `new` | `idle` | `match.new` | 906 |
| `match.played` | `played` | `idle` | `match.played` | 925 |
| `match.winner-a` | `winner-a` | `small-match.result` | `match.winner-a` | 944 |
| `match.winner-b` | `winner-b` | `small-match.result` | `match.winner-b` | 963 |
| `match.draw` | `draw` | `small-match.result` | `match.draw` | 982 |
| `match.winner-user` | `winner-user` | `small-match.result` | `match.winner-user` | 1001 |
| `match.winner-character` | `winner-character` | `small-match.result` | `match.winner-character` | 1020 |
| `match.correct` | `correct` | `small-match.result` | `match.correct` | 1039 |
| `match.miss` | `miss` | `small-match.result` | `match.miss` | 1058 |
| `match.played.dice` | `played / dice` | `idle` | `match.played` | 2107 |
| `match.played.coin` | `played / coin` | `idle` | `match.played` | 2127 |
| `match.played.rps` | `played / rps` | `idle` | `match.played` | 2147 |
| `match.new.initial` | `new / initial` | `idle` | `match.new` | 3080 |

### 맞히기 놀이

대사 파일: `talk/widgets/guessing.talk`

| case ID | 상태 분기 | trigger | 기대 장면 | JSON 행 |
| --- | --- | --- | --- | ---: |
| `guessing.idle` | `idle` | `idle` | `guessing.idle` | 1077 |
| `guessing.cups` | `cups` | `idle` | `guessing.cups` | 1097 |
| `guessing.number` | `number` | `idle` | `guessing.number` | 1117 |
| `guessing.correct` | `correct` | `guessing.attempt` | `guessing.correct` | 1137 |
| `guessing.exhausted` | `exhausted` | `guessing.attempt` | `guessing.exhausted` | 1156 |
| `guessing.empty` | `empty` | `guessing.attempt` | `guessing.empty` | 1175 |
| `guessing.higher` | `higher` | `guessing.attempt` | `guessing.higher` | 1194 |
| `guessing.lower` | `lower` | `guessing.attempt` | `guessing.lower` | 1213 |
| `guessing.between-rounds` | `between-rounds` | `idle` | `guessing.between-rounds` | 1827 |
| `guessing.idle.initial-cups` | `idle / initial-cups` | `idle` | `guessing.idle` | 3059 |

### 낚시

대사 파일: `talk/widgets/fishing.talk`

| case ID | 상태 분기 | trigger | 기대 장면 | JSON 행 |
| --- | --- | --- | --- | ---: |
| `fishing.idle` | `idle` | `idle` | `fishing.idle` | 1232 |
| `fishing.waiting` | `waiting` | `idle` | `fishing.waiting` | 1251 |
| `fishing.bite` | `bite` | `idle` | `fishing.bite` | 1270 |
| `fishing.bite-event` | `bite-event` | `fishing.bite` | `fishing.bite-event` | 1289 |
| `fishing.missed` | `missed` | `fishing.missed` | `fishing.missed` | 1308 |
| `fishing.caught.fish` | `successful catch / fish` | `item-acquired` | `fishing.caught` | 3100 |
| `fishing.caught.sock` | `successful catch / sock` | `item-acquired` | `fishing.caught` | 3121 |
| `fishing.caught.stone` | `successful catch / stone` | `item-acquired` | `fishing.caught` | 3142 |

### 장난 운세

대사 파일: `talk/widgets/fortune.talk`

| case ID | 상태 분기 | trigger | 기대 장면 | JSON 행 |
| --- | --- | --- | --- | ---: |
| `fortune.fresh` | `fresh` | `idle` | `fortune.fresh` | 1327 |
| `fortune.drawn` | `drawn` | `idle` | `fortune.drawn` | 1346 |
| `fortune.draw` | `draw` | `fortune.draw` | `fortune.draw` | 1365 |

### 화분

대사 파일: `talk/widgets/plant.talk`

| case ID | 상태 분기 | trigger | 기대 장면 | JSON 행 |
| --- | --- | --- | --- | ---: |
| `plant.dry` | `dry` | `idle` | `plant.dry` | 1385 |
| `plant.watered` | `watered` | `idle` | `plant.watered` | 1405 |
| `plant.grown` | `grown` | `idle` | `plant.grown` | 1425 |
| `plant.growth` | `growth` | `plant.growth` | `plant.growth` | 1444 |
| `plant.dry.stage-0` | `dry / stage 0` | `idle` | `plant.dry` | 2167 |
| `plant.dry.stage-1` | `dry / stage 1` | `idle` | `plant.dry` | 2187 |
| `plant.dry.stage-2` | `dry / stage 2` | `idle` | `plant.dry` | 2207 |
| `plant.watered.stage-0` | `watered / stage 0` | `idle` | `plant.watered` | 2227 |
| `plant.watered.stage-1` | `watered / stage 1` | `idle` | `plant.watered` | 2247 |
| `plant.watered.stage-2` | `watered / stage 2` | `idle` | `plant.watered` | 2267 |
| `plant.grown.watered` | `grown / watered` | `idle` | `plant.grown` | 2983 |
| `plant.grown.dry` | `grown / dry` | `idle` | `plant.grown` | 3003 |

### 작은 펫

대사 파일: `talk/widgets/pet.talk`

| case ID | 상태 분기 | trigger | 기대 장면 | JSON 행 |
| --- | --- | --- | --- | ---: |
| `pet.resting` | `resting` | `idle` | `pet.resting` | 1463 |
| `pet.moving` | `moving` | `idle` | `pet.moving` | 1482 |
| `pet.arrived` | `arrived` | `pet.arrived` | `pet.arrived` | 1501 |

### 수집함·소품

대사 파일: `talk/widgets/collection.talk`

| case ID | 상태 분기 | trigger | 기대 장면 | JSON 행 |
| --- | --- | --- | --- | ---: |
| `collection.empty` | `empty` | `idle` | `collection.empty` | 1520 |
| `collection.stored` | `stored` | `idle` | `collection.stored` | 1539 |
| `collection.decorated` | `decorated` | `idle` | `collection.decorated` | 1559 |
| `collection.acquired` | `acquired` | `item-acquired` | `collection.acquired` | 1578 |

### 함께한 사건 일지

대사 파일: `talk/widgets/journal.talk`

| case ID | 상태 분기 | trigger | 기대 장면 | JSON 행 |
| --- | --- | --- | --- | ---: |
| `journal.empty` | `empty` | `idle` | `journal.empty` | 1598 |
| `journal.recorded` | `recorded` | `idle` | `journal.recorded` | 1617 |

### 위젯을 함께 사용하는 상황

대사 파일: `talk/situations/index.talk`

| case ID | 상태 분기 | trigger | 기대 장면 | JSON 행 |
| --- | --- | --- | --- | ---: |
| `situation.quiet-focus` | `situation.quiet-focus` | `idle` | `situation.quiet-focus` | 2581 |
| `situation.little-shelf` | `situation.little-shelf` | `idle` | `situation.little-shelf` | 2604 |

### 기본 A/B 조합

대사 파일: `talk/pairs/default.talk`

| case ID | 상태 분기 | trigger | 기대 장면 | JSON 행 |
| --- | --- | --- | --- | ---: |
| `pair.quiet-focus` | `pair.quiet-focus` | `idle` | `pair.quiet-focus` | 2626 |
| `pair.little-shelf` | `pair.little-shelf` | `idle` | `pair.little-shelf` | 2648 |

## 억제·잘못된 입력 사례

오래된 값과 빈 값을 실제 관측값으로 해석하지 않는지 검사한다. `음악 정보가 오래됨`, `봉투에 체크 항목이 없음`처럼 상태를 정확히 알려 주는 장면은 선택할 수 있다.

| case ID | 상태 분기 | trigger | 대사 파일 | 기대 장면 | JSON 행 |
| --- | --- | --- | --- | --- | ---: |
| `negative.no-widgets` | `not installed` | `idle` | `talk/index.talk` | 선택 없음 | 2669 |
| `negative.disabled-todo` | `disabled with old values` | `idle` | `talk/widgets/todo.talk` | 선택 없음 | 2682 |
| `negative.null-weather` | `ready with absent temperature and code` | `idle` | `talk/widgets/weather.talk` | 선택 없음 | 2699 |
| `negative.stale-values` | `stale observation cannot produce playback claim` | `idle` | `talk/widgets/music.talk` | `music.stale` | 2719 |
| `negative.event-mismatch` | `wrong event cannot play result` | `idle` | `talk/widgets/guessing.talk` | 선택 없음 | 2739 |
| `negative.unknown-result` | `absent structured result` | `small-match.result` | `talk/widgets/small-match.talk` | 선택 없음 | 2757 |
| `negative.empty-preparation` | `empty envelope is not a completed checklist` | `idle` | `talk/widgets/preparation.talk` | `preparation.no-checks` | 2775 |

## 변경 후 갱신 기준

장면 추가·삭제, `when:` 조건, registry의 변수·이벤트, 위젯 payload, fixture 입력을 바꾸면 이 표를 함께 갱신한다. 먼저 실제 parser/evaluator 및 DB 경로 테스트를 통과시키고, `cases[].id` 중복 여부와 모든 장면의 양성 사례를 대조한 뒤 파일·장면·사례 수와 JSON 행을 다시 계산한다. 이름이나 숫자만 맞추기 위해 기대 장면을 바꾸지 않는다.

새 위젯은 초기 상태뿐 아니라 값이 없을 때, 실행 중일 때, 결과가 나온 뒤, 정보가 오래되거나 실패했을 때 중 해당하는 분기를 추가한다. 사건을 새로 읽는 대사는 가짜 payload만 만들지 말고 실제 저장 action 또는 tick에서 발생한 사건과 `context::build`를 연결하는 사례로 확인한다.
