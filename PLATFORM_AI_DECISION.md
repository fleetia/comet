# 플랫폼별 AI 우선순위 결정

- 결정일: 2026-10-19
- 상태: 제품 방향 결정. 구현·배포는 후속 작업
- 범위: Apple 환경은 OS 제공 온디바이스 AI 우선, Windows는 ChatGPT 로그인 우선
- 현재 적용 대상: Comet 데스크톱의 macOS·Windows. 다른 Apple 플랫폼으로의 앱 확장은 이 결정에 포함하지 않는다.

이 문서는 “코드를 수정하지 않고 내용을 정리해 PR로 남긴다”는 요청에 따른 단일 결정 기록이다. 기존 Fleet 단일 원본 규칙에 대한 이 한 건의 예외를 PR에서 검토하며, 일반 문서 정책을 바꾸거나 Fleet 동기화 완료를 뜻하지 않는다.

## 1. 결정한 방향

1. Apple에서는 Apple Foundation Models의 OS 제공 온디바이스 모델을 AI 설정의 첫 번째·추천 경로로 둔다. 현재 Comet에서는 macOS를 대상으로 하며, 실제 사용 가능 여부를 확인한 뒤 제안한다.
2. Windows에서는 기존 “ChatGPT로 로그인” 경로를 첫 번째·추천 선택지로 둔다.
3. 이미 사용자가 고른 AI·모델·계정은 유지한다. 플랫폼 추천 순서가 저장된 선택을 덮어쓰거나 새 제공자를 자동 실행하는 이유가 되어서는 안 된다.
4. 기존 GGUF 로컬 모델, ChatGPT, Claude, Gemini, GLM, 사용자 지정 API 선택지를 유지한다.
5. AI 설정을 건너뛰어도 내장 인사·단어장·대화팩을 사용할 수 있는 기본 경험을 유지한다. AI는 필수 가입·다운로드 단계가 아니다.

Apple의 “온디바이스”는 Apple이 OS를 통해 제공하는 `SystemLanguageModel` 경로를 뜻한다. Comet이 모델 파일을 별도로 내려받는 기존 GGUF 경로는 독립적인 로컬 선택지로 남긴다. Apple 경로의 추론은 기기 안에서 처리하며, 이 결정은 Private Cloud Compute나 다른 원격 모델의 자동 사용을 포함하지 않는다.

Windows 우선순위는 제품 선택이다. Windows의 온디바이스 AI가 불가능하다는 판단이나 특정 Windows AI 로드맵을 전제로 하지 않는다.

## 2. 현재 코드와의 차이

기준 커밋: [`4e75013`](https://github.com/fleetia/comet/commit/4e7501315ccedddc3fe38b3488bc496618c4b716).

- [`aiProviders.ts`](https://github.com/fleetia/comet/blob/4e7501315ccedddc3fe38b3488bc496618c4b716/apps/comet/src/aiProviders.ts)는 플랫폼 구분 없이 로컬 → ChatGPT → Claude → Gemini → GLM → 사용자 지정 API 순서다.
- [`ModelSettings.tsx`](https://github.com/fleetia/comet/blob/4e7501315ccedddc3fe38b3488bc496618c4b716/apps/comet/src/components/ModelSettings/ModelSettings.tsx)의 “이 기기의 모델”은 다운로드한 GGUF 또는 직접 지정한 GGUF 파일을 다룬다. Apple OS 모델을 선택하는 화면은 여기에 없다.
- 기존 ChatGPT 경로는 API 키 입력과 분리된 Sign in with ChatGPT 연동이다. [인증 코드](https://github.com/fleetia/comet/blob/4e7501315ccedddc3fe38b3488bc496618c4b716/apps/comet/src-tauri/src/chatgpt/auth.rs)는 시스템 브라우저, loopback callback, PKCE/OIDC 검증과 계정별 등록을 사용한다.
- [ChatGPT 서비스](https://github.com/fleetia/comet/blob/4e7501315ccedddc3fe38b3488bc496618c4b716/apps/comet/src-tauri/src/chatgpt.rs)는 로그인 상태와 `chatgpt.tokens.use.direct` 권한을 구분한다. [추론 코드](https://github.com/fleetia/comet/blob/4e7501315ccedddc3fe38b3488bc496618c4b716/apps/comet/src-tauri/src/chatgpt/responses.rs)는 허용된 모델 목록과 Responses API를 사용하며 사용량·자격·지원 기능 오류를 처리한다.

위 내용은 코드 확인 결과다. 이번 문서 PR에서 로그인 성공, Windows 실행, Apple 모델 연동 또는 모델 품질을 실기 검증한 것은 아니다.

## 3. 제안하는 설정 UX

아래 순서는 후속 구현안이다. 실제 화면·문구·기본값은 구현 PR에서 검증한다.

| 환경 | 첫 번째 추천 | 함께 제공할 선택 |
| --- | --- | --- |
| Apple / 현재 macOS | Apple 온디바이스 AI, 준비 상태와 조건 표시 | ChatGPT, GGUF 로컬 모델, 기존 외부 API |
| Windows | ChatGPT로 로그인, 연결·권한·사용 가능 상태 표시 | GGUF 로컬 모델, 기존 외부 API |
| 그 외 플랫폼 | 이번 결정으로 변경하지 않음 | 기존 선택 유지 |

- 최초 설정에서 추천 항목을 먼저 보여준다. 저장된 선택이 있으면 해당 선택을 그대로 표시하고, 추천은 보조 안내로만 제시한다.
- Apple OS 모델과 GGUF를 같은 “로컬” 상태 하나로 합치지 않는다. 제공자·준비 방식·지원 기능을 알아볼 수 있게 구분한다.
- 사용할 수 없는 추천 항목에는 이유와 다음 행동을 표시한다. 계속 로딩 중인 것처럼 보이게 하거나 사용할 수 있다고 표시하지 않는다.
- 다른 AI 선택과 “AI 없이 계속”에 항상 접근할 수 있게 한다.
- 로그인·연결 확인·설정 저장·실제 추론을 구분한다. 로그인 성공만으로 제공자를 전환하거나 대화 내용을 전송하지 않는다.

## 4. Apple 사용 가능 조건

하드웨어·OS 이름만으로 준비 완료를 판단하지 않는다. Foundation Models를 호출할 수 있는 OS 버전인지 먼저 확인하고, `SystemLanguageModel.default.availability`와 사용할 언어를 런타임에서 확인한다.

- 최소 API 기준은 macOS 26.0이다. 하드웨어는 M1 이상 Mac 등 Apple의 최신 Apple Intelligence 지원 기기 목록을 기준으로 확인한다. 지원 하드웨어라도 OS·지역·언어·모델 자산 상태가 조건에 맞아야 한다.
- 설치된 OS에서 요구하는 Apple Intelligence 사용 가능/활성화 조건과 모델 자산 다운로드 완료를 확인한다. OS별 설정 동작이 달라질 수 있으므로 모든 버전에 같은 “설정에서 켜세요” 문구를 고정하지 않는다.
- 한국어를 포함한 지원 언어는 설치된 모델과 OS에 따라 확인한다. `supportedLanguages` 또는 `supportsLocale(_:)`를 사용하고, 앱 UI 언어만으로 모델 지원을 추정하지 않는다. 한국어 대화 품질은 별도 평가 대상이다.

| 확인 결과 | 제안하는 동작 |
| --- | --- |
| `available` + 요청 언어 지원 | Apple 경로 선택·사용 허용 |
| API 미지원 OS 또는 `deviceNotEligible` | 미지원 이유 표시, 다른 AI 또는 AI 없이 계속 제공 |
| `appleIntelligenceNotEnabled` | 해당 OS에 맞는 설정 안내, 사용자가 돌아오면 상태 재확인 |
| `modelNotReady` | 모델 준비 중/미완료 안내, 준비 후 재확인. 이 값만으로 다운로드 진행률·완료 시각을 추정하지 않음 |
| 요청 언어 미지원 | 언어 제한 안내, 사용자가 다른 지원 경로를 직접 선택 |
| 알 수 없는 상태·생성 오류 | 원인을 알 수 있는 범위에서 표시하고 재시도/다른 선택 제공 |

OS 모델 자산의 준비는 Apple이 관리한다. Comet의 GGUF 다운로드 버튼·파일 경로·진행률을 Apple 모델 준비 상태에 재사용하지 않는다. 모델이 나중에 준비되더라도 이미 선택한 다른 AI를 자동으로 바꾸지 않는다.

근거: [OS별 모델 버전](https://developer.apple.com/documentation/foundationmodels/updating-prompts-for-new-model-versions), [SystemLanguageModel](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel), [사용 불가 사유](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel/availability-swift.enum/unavailablereason), [언어·locale 확인](https://developer.apple.com/documentation/foundationmodels/supporting-languages-and-locales-with-foundation-models), [Apple Intelligence 요구 사항](https://support.apple.com/en-us/121115). 세부 API와 OS별 동작은 구현 시점에 다시 확인한다.

## 5. Windows ChatGPT 경로의 조건

기존 [ChatGPT 설정 화면](https://github.com/fleetia/comet/blob/4e7501315ccedddc3fe38b3488bc496618c4b716/apps/comet/src/components/ChatGptSettings/ChatGptSettings.tsx)의 동의·계정·모델·사용량 경계를 유지하면서 노출 우선순위를 높인다.

- 사용자가 외부 전송 안내를 확인하고 로그인한다. 전송 대상은 ChatGPT이며, 요청에 포함되는 대화·관련 기억·선택 자료의 범위를 설명한다.
- 로그인됨, 플랜 사용 권한 있음, 선택 모델 사용 가능, 현재 요청 가능을 별도 상태로 취급한다. 로그인만 완료되고 플랜 사용 권한이 없는 상태도 처리한다.
- 실제 사용은 계정·워크스페이스의 자격, 승인된 권한, 사용량, 서버가 반환하는 모델·기능에 따른다. 특정 플랜·모델·무제한 사용을 고정 약속하지 않는다.
- 기존 ChatGPT 대화·기억을 자동으로 가져오지 않는다.
- 사용량 소진·권한 거부·로그인 취소·네트워크 오류 때 이유를 알려 주고 재연결, 사용량 확인, 다른 AI 선택, AI 없이 계속을 제공한다.

이 연동은 사용자가 별도로 허용한 ChatGPT 플랜 사용 경로다. 일반 ChatGPT 로그인이나 구독이 임의의 API 키 호출에 크레딧을 주는 것으로 설명하지 않는다. 사용자 지정 OpenAI API 키 경로의 과금은 별개다.

근거: [Sign in with ChatGPT 플랜 사용 개요](https://developers.openai.com/siwc/token-sharing-open-source), [등록·로그인과 권한 확인](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [ChatGPT·API 별도 과금](https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform).

## 6. 기능 범위와 대체 경로

Apple 모델의 첫 도입은 짧은 캐릭터 대화, 요약·추출 등 검증 가능한 텍스트 작업부터 평가한다. 추천 우선순위는 모든 Comet 기능의 지원 또는 클라우드 모델과의 품질 동등성을 보장하지 않는다.

- 위젯 코드 생성, 복잡한 추론, 첨부파일·이미지 처리, 긴 문맥은 기능별 지원·품질 확인 전까지 Apple 경로의 지원 기능으로 표시하지 않는다.
- 지원 가능한 context budget 안에서 지시문·대화 기록·관련 기억·도구 스키마/결과·출력을 함께 계산한다. 무제한 대화 기록을 그대로 넣지 않는다. 구체적인 한도는 OS·모델에서 확인하고 초과 오류를 처리한다. [Apple의 문맥 관리 안내](https://developer.apple.com/documentation/technotes/tn3193-managing-the-on-device-foundation-model-s-context-window)를 따른다.
- 모델이 지원하지 않는 요청은 이유를 설명한다. 입력을 조용히 누락하거나 품질이 검증되지 않은 경로로 대신 실행하지 않는다.
- 사용자는 준비된 GGUF, ChatGPT, 다른 API 또는 AI 없이 계속 중에서 직접 고를 수 있다. 외부 제공자를 선택할 때는 그 제공자와 전송 범위를 안내한다.
- 온디바이스 실패·지연·부족한 품질을 이유로 대화·기억·첨부를 자동으로 클라우드에 전송하지 않는다. 이미 로그인된 계정이나 저장된 API 키가 있어도 같다.
- ChatGPT 한도 초과를 유료 API 키 호출로 자동 전환하지 않는다. 대체 경로는 사용자의 명시적 선택으로만 바꾼다.
- 어떤 전환에서도 대화 기록·기억·친밀도·기존 제공자 설정을 초기화하지 않는다.

Apple은 온디바이스 모델에 적합한 작업과 제한을 따로 안내한다. 실제 지원 기능과 품질 기준은 [적절한 모델 작업 선택 안내](https://developer.apple.com/documentation/foundationmodels/generating-content-and-performing-tasks-with-foundation-models) 및 후속 평가를 기준으로 확정한다.

## 7. 후속 구현 체크리스트

이 목록은 앞으로 할 일이며 이번 PR에 구현을 포함하지 않는다.

- [ ] Apple OS 모델과 GGUF를 구분할 제공자 상태·설정·마이그레이션 설계
- [ ] macOS 네이티브 Foundation Models 연결과 OS/API 가용성 검사
- [ ] 미지원 기기/OS·비활성화·모델 미준비·지원 언어·알 수 없는 상태 처리
- [ ] Apple/Windows 추천 순서와 최초 설정 UX 반영, 기존 명시적 선택 보존
- [ ] ChatGPT의 연결·권한·모델·사용량 상태, 취소·재로그인·재시작 흐름 검증
- [ ] 외부 전송 안내와 명시적 제공자 선택 경계 검증, 자동 클라우드 전환 없음 확인
- [ ] 한국어 캐릭터 대화·구조화 응답·취소·문맥 초과·장시간 사용의 기능별 평가
- [ ] 위젯 생성·첨부·긴 문맥의 기능별 capability 정의와 미지원 안내
- [ ] AI 미설정·오프라인 상태에서 기본 인사·단어장·대화팩 회귀 확인
- [ ] 실제 화면을 바꾸는 후속 작업에서 앱·디자인시스템·Storybook·Figma 정합성 검증
- [ ] Fleet 원본 위치와 반영 범위 확인 후 관련 원본 문서에 결정 반영

이번 변경은 결정 기록 한 파일에 한정한다. 앱 코드·설정 기본값·의존성·빌드·UI·Figma는 변경하지 않는다.
