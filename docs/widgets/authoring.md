---
title: AI 위젯 작성과 외부 SDK
description: 가져올 수 있는 JSON 정의와 JavaScript 계약, 크기 제한 및 미구현 패키지 SDK
---

# AI 위젯 작성과 외부 SDK

이 문서는 다른 AI로 위젯을 만들거나 생성 코드를 고칠 때 사용하는 현재 입력 형식과 미래 패키지 SDK를 구분한다. 앱 사용 흐름은 [AI 제작과 상태별 대사](ai-creation.md), 저장·권한은 [공통 계약](contract.md)을 따른다. 소스 구현과 실제 플랫폼·모델 품질 검증은 [상태표](../status.md)에서 확인한다.

## 현재 AI 위젯 정의

`다른 AI가 만든 위젯 가져오기`는 다음 네 필드만 받는다. `id`·현재 `state`·`revision`·실행 상태는 Comet이 관리하므로 정의에 넣지 않는다.

| 필드 | 의미와 제한 |
| --- | --- |
| `name` | 비어 있지 않은 이름, 최대 80자 |
| `description` | 용도 설명, 최대 500자 |
| `source` | `render`와 `reduce`를 정의하는 JavaScript, 최대 48KiB |
| `initialState` | 새 인스턴스의 초기 JSON 객체, 최대 64KiB |

정의 전체는 직렬화한 UTF-8 기준 96KiB 이하여야 한다. 상태는 깊이 16·JSON 노드 4,096개 이내이며 안전한 JavaScript 숫자 범위를 벗어나거나 `__proto__`, `prototype`, `constructor` 키를 포함하면 거절한다.

실행 입력은 JavaScript source 48KiB, state JSON 64KiB, action JSON 4KiB를 각각 검사한 뒤 시각을 포함한 전체 JSON을 128KiB로 제한한다. 결과의 state와 view를 합친 JSON은 64KiB 이하여야 한다. 모든 크기는 UTF-8 bytes 기준이며 JSON escaping이 포함되므로 각 필드의 최대 크기를 동시에 사용할 수 있다고 가정하지 않는다.

다음은 형식을 설명하는 단수 세기 예제다. 특정 모델의 생성 품질이나 플랫폼 검증 결과를 뜻하지 않는다.

```json
{
  "name": "뜨개질 단수",
  "description": "뜬 단수를 세고 한 단 되돌린다.",
  "initialState": { "count": 0 },
  "source": "function render(s) { return [{type:'number',label:'지금까지 뜬 단수',value:s.count},{type:'button',label:'한 단 추가',action:'add'},{type:'button',label:'되돌리기',action:'undo'}]; } function reduce(s,a) { if(a.type==='add') return {...s,count:s.count+1}; if(a.type==='undo') return {...s,count:Math.max(0,s.count-1)}; return s; }"
}
```

공유 정의 메뉴는 현재 사용 상태를 내보내지 않는다. 다만 작성자가 `source`나 `initialState`에 직접 넣은 문자열은 정의의 일부이므로 credential·개인 기록을 넣지 않는다.

## 함수와 화면 노드

`render(state, now)`는 평평한 화면 노드 배열을 반환한다. `reduce(state, action, now)`는 일부 필드만이 아니라 다음 상태의 전체 JSON 객체를 반환한다. 둘 다 동기 함수이며 `now`는 Unix milliseconds다. 수정할 때는 사용자가 저장한 state의 기존 키와 값을 보존한다. 호스트는 수정 정의의 `initialState`로 기존 state를 덮어쓰지 않는다.

| `type` | 표현 | 사용하는 필드 |
| --- | --- | --- |
| `text` | 일반 텍스트 | `label`, `value` |
| `number` | 숫자 표시 | `label`, 숫자 `value` |
| `button` | 동작 버튼 | 비어 있지 않은 `label`, `action` |
| `input` | 텍스트 입력 | 비어 있지 않은 `label`, `action`, `value` |
| `progress` | 진행률 | `label`, 숫자 `value`, 선택적인 `min`·`max` |

배열은 최대 128개다. 노드에는 공통 필드 `type`, `label`, `value`, `action`, `min`, `max`만 허용한다. `label`은 256자, `action`은 80자, 문자열 `value`는 8,192자 이하로 제한한다. 버튼은 `{type: node.action}`, 입력란은 여기에 문자열 `value`를 더한 동작을 보낸다. HTML·CSS·DOM을 반환하는 방식은 지원하지 않는다.

창이 열린 동안 약 1초마다 `{type: 'tick'}`을 전달한다. 창을 닫으면 실행도 멈추므로 타이머는 감소 횟수 대신 state에 종료 timestamp를 저장하고 `now`와 비교한다. 닫힌 위젯이 백그라운드에서 작업하거나 정각에 알림을 보낸다고 가정하면 안 된다.

매 호출은 새 Worker에서 수행한다. 전역 변수로 다음 호출의 상태를 유지할 수 없으며 Promise·비동기 함수·추가 Worker·네트워크·파일·native API·package import는 계약에 포함하지 않는다. 실행 시간 제한과 완전한 자원 격리의 차이는 [실행 경계](ai-creation.md#실행과-설치-경계)를 참고한다.

`draft`, `ready`, `error`는 저장된 코드의 실행 상태다. `ready`는 해당 실행이 형식과 실행 검사를 통과했다는 뜻이며 사용자가 원하는 계산·상태 전이를 정확히 구현했다는 의미 품질 보증은 아니다. 실제 입력·되돌리기·재실행·상태 보존은 별도로 확인한다.

현재 계약의 원본은 `src-tauri/src/generated_widgets.rs`, `src-tauri/src/generated_widget_commands.rs`, `src/widgets/GeneratedWidgets/sandbox.ts`다. 함수·노드·제한을 변경하면 이 문서와 모델에 전달하는 `CODE_CONTRACT`를 함께 수정한다.

## 모델 입력과 큰 위젯 수정

로컬 모델은 크기가 확인된 **9B 초과** 모델만 코드 생성·수정·자동 복구에 사용한다. 카탈로그의 명목 크기 또는 직접 지정한 GGUF의 `general.size_label`을 확인하며 9B 이하·모호한 크기·메타데이터 없음은 차단한다. API 모델은 ID에 명시된 9B 이하 표기를 차단하고 미공개 크기는 허용하되 크기 검증 완료로 취급하지 않는다. 판정의 원본은 `src-tauri/src/models/widget_policy.rs`이며 사용 경로별 상세는 [제작할 수 있는 모델](ai-creation.md#제작할-수-있는-모델)을 따른다. JSON 가져오기와 이미 저장된 위젯의 실행·상태별 대사는 이 모델 제한과 무관하다.

실행기가 허용하는 위젯 크기와 AI가 한 번에 수정할 수 있는 입력 크기는 다르다. 호스트는 system 지침, 직렬화한 사용자 입력과 출력 정의 schema의 UTF-8 bytes를 합산한다. 로컬 모델은 합계 3,000 bytes, OpenAI 호환 API는 합계 64KiB 이내로 제한하고 출력 여유를 별도로 계산한다.

로컬 코드 요청은 일반 대화의 추론 설정과 관계없이 추론을 켜고 16,384 token context에서 추론 4,096 token과 최종 응답 4,096 token을 위한 여유를 둔다. 추론 결과는 최종 정의 파싱에 사용하지 않는다. 지원 모델·출력 상한·취소 경계는 [로컬 추론 모드](ai-creation.md#로컬-추론-모드)를 따른다.

수정 입력의 `previous`에는 기존 `source` 전체와 현재 state의 필드 이름·타입을 담은 `stateFields`만 전달한다. 실제 저장된 state 값은 보내지 않는다. `stateFields`는 최상위 24개 필드까지이며 각 이름은 UTF-8 64 bytes 이내로 제한한다. 코드 자체에 작성된 문자열과 상수는 source의 일부로 전달된다.

로컬 모델은 네 가지 ex-brain skill의 행동 원칙을 요약한 compact 지침과 현재 위젯의 최신 요청·결과를 사용한다. 지침 상한은 600 UTF-8 bytes이며 이 소스의 요약은 479 bytes다. context는 400 bytes 이하의 완결 JSON으로 전달한다. API 모드의 원문 발췌·context 범위는 [내부 컨텍스트](ai-creation.md#내부-컨텍스트와-skill)를 따른다.

호스트는 큰 수정 요청을 맞추려고 기존 source, compact 지침 또는 context JSON의 앞부분만 잘라 보내지 않는다. 최종 입력이 한도를 넘으면 생성 전에 오류를 반환하고 원래 코드와 state를 보존한다. 요청 범위를 줄이거나 더 큰 수정을 API 모드로 진행할 수 있으며 API 한도를 넘는 요청도 저장 없이 거절한다. 따라서 JSON 가져오기와 실행에 성공한 위젯이라고 해서 로컬 모델이 그 코드 전체를 수정할 수 있다는 뜻은 아니다.

## 실패 재현과 수정 확인

생성 실패는 최소 source·합성 state·기대 진단·고정 수정으로 남긴다. `corepack pnpm test:widgets`는 실행 화면과 작업실의 회귀를, `corepack pnpm test:widgets:host`는 실제 SQLite·호스트 함수·모델 크기 제한을 검사한다. `corepack pnpm test:widgets:browser`가 출력한 로컬 URL을 브라우저로 열면 현재 `sandbox.ts`와 앱 CSP를 사용한 Worker 검사가 실행되고 JSON 보고서가 저장된다. 실행 절차와 fixture 출처는 저장소의 `scripts/widget-harness/README.md`를 따른다.

진단 반환, 입력·취소 순서, 고정 수정 후 기존 값 보존을 각각 확인한다. 고정 수정은 모델 응답이 아니며 이 검사만으로 모델 생성 품질이나 native WebView 검증을 완료한 것으로 기록하지 않는다. 새 실패에는 사용자 DB·인증정보·원문 대화를 복사하지 않고 재현에 필요한 최소 사례만 추가한다.

## 범용 외부 SDK는 후속

공식 16개 위젯은 [동봉 manifest와 공용 처리기](installation.md)로 실행한다. 외부 개발 폴더·ZIP 설치, 독립 schema 파일, 정적 자산·HTML 화면, 선언적 HTTP 연결과 패키지별 권한은 공개 SDK로 제공하지 않는다. AI 위젯 정의에 임의 필드를 더해 요청할 수 없다.

> 아래 파일 배치와 manifest JSON은 **미구현 외부 패키지 SDK의 논의용 예시**다. 현재 가져오기 정의와 다르며 그대로 설치·실행할 수 없다.

## 패키지 설계 예시

ZIP 안에 manifest, 데이터 schema, 필요한 정적 자산을 함께 두는 구성을 검토한다. 선택적 화면이 없으면 기본 보기를 사용한다.

```text
example-timer/
  manifest.json
  schemas/
    state.json
    events.json
    actions.json
  assets/
    icon.svg
  view/                 # 선택적 상세 화면
    index.html
    main.js
```

다음 예시는 선언할 의미를 보여 줄 뿐 실제 capability 이름이나 runtime 진입점을 정의하지 않는다.

```json
{
  "id": "example.timer",
  "version": "0.1.0",
  "sdkVersion": "draft",
  "name": "작은 타이머",
  "permissions": ["own-state", "timer-events"],
  "schemas": {
    "state": "schemas/state.json",
    "events": "schemas/events.json",
    "actions": "schemas/actions.json"
  },
  "view": {
    "kind": "host",
    "title": "작은 타이머"
  }
}
```

패키지 `id`는 [계약의 `widgetId`](contract.md#식별자와-버전)에 대응하는 예시다. `instanceId`와 `connectionId`는 설치·연결 시 호스트가 관리하며 배포물에 실제 사용자 계정이나 인증정보를 넣지 않는다. schema 파일에도 데이터 구조 버전의 의미를 명시해야 한다.

HTTP JSON과 선언적인 필드 매핑은 외부 SDK의 후속 결정이다. 현재 AI JavaScript 실행 계약이 위 예시의 실행 파일·백그라운드 스크립트·네트워크 권한까지 제공하는 것은 아니다.

## 기능 하나를 설계하는 순서

1. 표시할 상태와 원본 소유자를 정한다. 예를 들어 타이머의 남은 시간과 완료 여부를 구분한다.
2. 상태 조회와 사건을 분리한다. 완료 사건은 안정적인 ID를 갖고 최초 로드·재조회 때마다 반복 발행하지 않는다.
3. 사용자 동작을 선언한다. 시작·중지 같은 명령의 입력, 실행 주체, 결과 불명 시 복구 방법을 정의한다.
4. 기본 보기에서 짧은 상태와 버튼만으로 사용할 수 있는지 확인한다. 커스텀 화면은 실제 부족한 조작이 있을 때 검토한다.
5. 사건에 단어장 대사를 연결하거나 허용된 상태를 LLM에 제공할 범위를 정한다. 등록 원문을 바꾸지 않고, 사용자 입력보다 먼저 말하지 않는다.

범용 SDK에서는 먼저 작은 예제를 공통 계약으로 구현하고 개발 폴더 읽기·ZIP 설치·모의 이벤트 경로를 별도로 검증해야 한다. 이 단계들의 실행 명령은 구현된 뒤 문서화한다.

## 배포와 호환성 인수 기준

다음은 향후 구현이 통과해야 할 기준이며 통과 완료 기록이 아니다.

| 시험 | 기대 결과 |
| --- | --- |
| manifest·schema 검사 | 잘못된 입력, 지원하지 않는 SDK 범위와 알 수 없는 필수 기능을 활성화 전에 거절 |
| ZIP 경계 | 상위 경로 탈출·절대 경로·위험한 링크·과도한 압축 해제 크기를 거절하고 패키지 밖에 쓰지 않음 |
| 복수 설치·계정 | 같은 항목 ID여도 상태·사건·권한이 다른 인스턴스와 섞이지 않음 |
| 최초 동기화·재연결 | 과거 사건 폭주와 이미 처리한 사건의 재발화 없음 |
| 명령 재전송 | 동일 요청의 중복 변경 없음; 결과 불명은 확인 없이 재실행하지 않음 |
| 오래된 생성 결과 | 입력·revision·권한·연결 변경 뒤 준비 대사가 나타나지 않음 |
| 단어장 연결 | 등록 본문·공백·개행·화자 순서가 그대로 유지됨 |
| 오프라인·인증 실패 | 정상 빈 상태와 구분되고 실패를 성공 대사로 표현하지 않음 |
| 권한 경계 | 다른 인스턴스·공통 DB·인증정보·Comet 공통 명령에 대한 직접 접근 거절 |
| 비활성화·제거 | 작업·화면·대기 사건 정리, 사용자 작성 데이터 보존 정책 준수 |
| 업데이트·마이그레이션 | 데이터 손실 없이 적용하거나 이전 동작을 유지하며 중단; 권한 확대는 다시 판단 |
| 자원 사용 | 닫힌 화면과 비활성 위젯의 상주 실행이 없고 기본 캐릭터 대화를 막지 않음 |

서명·배포자 신뢰 체계, 마켓플레이스, 원격 자동 설치, native/WASM 범용 runtime은 별도 결정 대상이다. ZIP 설치 설계만으로 배포물의 안전성이나 완전한 샌드박스가 확보됐다고 표현하지 않는다.

공개 SDK를 제공할 때 이 문서의 예시를 실제 schema·지원 버전·설치 방법·검증 명령에 맞춰 갱신한다. 그 전까지 예시를 안정된 API로 문서 밖에 복제하지 않는다.
