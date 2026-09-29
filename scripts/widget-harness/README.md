# Widget execution harness

위젯 실행기를 바꾸거나 생성 오류를 고칠 때 같은 실패를 재현하는 절차다. 실제 코드인 `sandbox.ts`를 실제 브라우저에서 실행하고, 진단 메시지가 수정을 위한 정보로 전달되는지와 기존 상태 보존을 확인한다. 모델 추론·Tauri IPC·native WebView 검증은 별도다.

## 자동 회귀 테스트

저장소 루트에서 의존성이 준비된 상태로 실행한다. 패키지나 브라우저를 자동 설치하지 않는다.

```sh
corepack pnpm test:widgets
```

`src/widgets/GeneratedWidgets/*.test.*`가 대상이다. 실제 `GeneratedWidgetTool`의 tick 실행 중 연속 입력, 실행 중 변경 알림과 최신 상태 조회, 취소·종료, IPC 오류의 AI 재생성 금지, 작업실의 revision 갱신을 검증한다. IPC와 실행기는 이 단계에서 mock하므로 실제 Worker나 DB 통과를 뜻하지 않는다.

Rust 도구가 PATH에 준비된 환경에서는 호스트 회귀도 실행한다.

```sh
corepack pnpm test:widgets:host
```

이 단계는 임시 SQLite에서 저장·재시작·조건 반응·취소·수정 중 상태 보존을 검사하고 모델 크기 제한과 내부 ex-brain 조회 경계를 확인한다. 실제 모델 호출이나 외부 서비스가 필요하지 않다. 프런트엔드 mock과 달리 저장·호스트 함수의 실제 구현을 실행한다.

추론 회귀는 임시 localhost HTTP 서버에서 일반 요청의 추론 ON/OFF, 위젯 요청의 강제 ON과 별도 출력 예산, 외부 API 매개변수 보존을 확인한다. 추론 문자열을 최종 JSON으로 사용하지 않는지, 출력 잘림을 거절하는지와 context 변경 때 앱이 소유한 실행기만 교체하는지도 검사한다. 이는 요청 계약 검사이며 실제 모델이 올바른 위젯을 만든다는 증거는 아니다.

## 실제 브라우저 실행

```sh
corepack pnpm test:widgets:browser
```

명령이 출력한 `http://127.0.0.1:<port>/<run-id>/`를 CUA 또는 사람이 브라우저로 연다. 이 명령은 브라우저를 실행하거나 제어하지 않는다. 페이지가 자동으로 검사하고 보고서를 같은 origin의 form POST로 돌려준다. 완료 후 서버는 종료한다. 브라우저가 연결되지 않으면 5분 뒤 실패로 끝난다.

브라우저 테스트는 `tauri.conf.json`의 CSP와 현재 `sandbox.ts`를 읽는다. CSP hash·worker-src·iframe sandbox·실제 Worker 실행까지 검사하며 fetch 권한을 추가하지 않는다. 주요 시나리오는 다음과 같다.

| 사례 | 성공 기준 |
| --- | --- |
| `source.js`를 코드로 반환 | 구체적인 JavaScript 진단이 300자 이내로 반환됨 |
| 필수 함수 누락 | `render`·`reduce` 계약을 가리키는 진단이 반환됨 |
| 배열 상태·안전 범위 밖 숫자 | 저장 IPC 전에 실행 결과가 거부됨 |
| 각 실패 뒤 고정 수정 코드 실행 | 기존 count·goal·note가 유지되고 다음 동작도 정상 적용됨 |
| Worker 권한·prototype·Function 생성자 | 차단한 기능과 문자열 코드 생성이 우회되지 않음 |
| 무한 루프·취소 | 호출 종료와 iframe 정리가 완료됨 |

`fixtures.json`이 실패 사례와 고정 수정의 원본이다. `source.js`는 격리한 물 위젯 native QA에서 관찰한 실제 source 값이고, 함수 누락·잘못된 상태는 같은 실패 종류를 최소화한 합성 사례다. 고정 수정은 모델 응답이 아니다. 사용자 기록·API 설정·토큰·현재 앱 DB를 fixture로 복사하지 않는다.

보고서는 git에서 제외된 `test-results/widget-harness/<time>.json`에 저장한다. 전체 결과, 브라우저 user-agent, 실행기·fixture SHA-256, 적용한 CSP가 포함된다. 종료 코드 0과 모든 사례의 `pass`를 함께 확인한다. 실제 브라우저 결과를 다른 브라우저 엔진이나 모델의 생성 성공률로 확대하지 않는다.

## Native QA와 모델 생성 검증

브라우저 통과 후에는 별도 identifier의 QA 앱으로 현재 소스를 빌드하고 서명·identifier를 확인한다. 사용자 설치본이나 사용자 DB를 교체하지 않는다. 구현 상태는 [AI 위젯 사양](../../docs/widgets/ai-creation.md)과 [상태표](../../docs/status.md)에 기록한다.

1. QA 작업실에 `native-counter.json`을 가져온다. 이 합성 위젯의 버튼·입력으로 count·note를 바꾸고 앱을 재시작한 뒤 값 보존을 확인한다.
2. tick 중 입력을 연달아 확정하고 마지막 값과 동작 순서를 확인한다. 실행 중 끄기·닫기·코드 변경 뒤 이전 입력이 다시 적용되지 않아야 한다.
3. 허용된 모델 또는 API로 단순한 위젯을 제작한다. 실패 시 실제 진단, 수정 횟수, 수정 후 상태를 QA 기록에 남긴다. 모델의 설명만으로 성공을 판정하지 않는다.
4. 코드 수정 후 initialState로 기존 값을 초기화하지 않는지, 오류·취소 중 새 정의나 상태가 뒤늦게 저장되지 않는지 확인한다.
5. 소형 로컬 모델의 코드 생성 차단은 호스트 테스트와 실제 QA 메뉴에서 확인한다. 이 브라우저 실행기는 모델 크기나 생성 정책을 대신 검증하지 않는다.

새 실패를 추가할 때는 최소 코드·합성 상태·기대 진단·고정 수정과 사례 출처를 함께 남긴다. 진단 문구, 실행 계약, CSP가 바뀌면 fixture와 검증을 다시 실행한다.
