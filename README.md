# comet

comet은 바탕화면에 작은 캐릭터 본체와 잠깐 나타나는 말풍선을 두는 데스크톱 앱입니다. 내장 대사와 단어장만으로 먼저 인사하고 짧게 수다를 떨며, 로컬 LLM이나 외부 API는 필요할 때만 연결합니다.

새 설치의 기본 캐릭터는 별꼬리 한 명이며 친구를 8명까지 늘릴 수 있습니다. 나디르와 텍스트 별꼬리는 사용자가 따로 가져와 함께 지내기를 선택하는 추가팩입니다. 캐릭터를 바꾸고 공유할 수 있으며, 설치·제거 가능한 대화팩의 암호화 `.talk` 대본이 시간·날씨·위젯 상태에 맞는 대화를 보탭니다. 기본 대화팩은 함께 지내는 친구 중 무작위 화자를 고릅니다. 모델이나 API가 없어도 기본 대화와 생활 도구는 동작합니다.

이 문서는 설치·실행·개발 명령과 문서 탐색을 위한 입구입니다. 제품 동작·확장·개발 계약과 현재 미검증 범위는 `docs/`를 원본으로 삼습니다.

## 먼저 읽을 문서

| 알고 싶은 것 | 문서 |
| --- | --- |
| 제품의 방향과 문서 읽는 순서 | [문서 안내](docs/index.md) |
| 본체·말풍선·설정·조용한 시간·데이터 보존 | [제품 동작](docs/behavior.md) |
| 캐릭터·대화팩·위젯·다이어리·메모 | [확장 기능](docs/extensions.md) |
| 개발·빌드·네이티브 QA·릴리스·위키 | [개발과 검증](docs/development.md) |
| 다른 기기·계정·모델에서 남은 확인 | [미검증 범위](docs/status.md) |

## 다운로드

공개된 설치 파일은 [GitHub Releases](https://github.com/fleetia/comet/releases/latest)에서 받습니다.

- macOS 14 이상 Apple Silicon: `.dmg`
- Windows x64: `.exe`
- 개발 중 검증 파일: [Verify desktop Actions](https://github.com/fleetia/comet/actions/workflows/verify.yml)의 성공한 실행에서 artifact를 받습니다. 다운로드에는 GitHub 로그인이 필요합니다.

업데이트 기능이 포함되지 않은 최초 설치본은 수동으로 설치해야 합니다. 이후 업데이트는 앱에 포함된 서명을 확인한 뒤 사용자가 설치를 승인한 경우에만 진행합니다. 서명, updater, 실패 복구와 실제 인수 범위는 [릴리스 안내](docs/development.md)를 따릅니다.

아래 추가팩은 기본 설치에 포함되지 않으며 앱 업데이트와 별도로 수동 설치합니다.

| 팩 | 파일 |
| --- | --- |
| 나디르·별꼬리 | [nadir-and-star-tail.comet-character.json](examples/character-packs/nadir-and-star-tail.comet-character.json) |
| 별꼬리 | [byulkkori.comet-character.json](examples/character-packs/byulkkori.comet-character.json) · [이용 조건](examples/character-packs/byulkkori.LICENSE.txt) |

GitHub 파일 화면에서 **Download raw file**로 저장한 뒤 앱의 `설정 → 캐릭터 → 가져오기`에서 선택합니다. **내용 확인 후 설치**한 다음 **가져온 친구와 함께 지내기**를 선택하면 바탕화면에 나타납니다. 캐릭터팩의 형식과 로컬 정체성은 [확장 기능](docs/extensions.md)을 확인하세요.

## 개발 환경

지원 빌드 대상은 macOS 14 이상 Apple Silicon과 Windows x64입니다.

- Node.js 24, Corepack, pnpm 11.27.0
- Rust stable과 `cargo`
- macOS: Xcode Command Line Tools
- Windows: Visual Studio C++ 데스크톱 빌드 도구와 WebView2

`@fleetia/lagrange`는 `package.json`이 지정한 저장소의 `vendor/` tarball에서 설치합니다.

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm prepare:sidecar
corepack pnpm prepare:nlp
corepack pnpm desktop
```

`prepare:sidecar`는 고정한 llama.cpp 릴리스를 내려받아 SHA-256을 확인하고 `src-tauri/binaries/`에 실행 파일과 런타임 라이브러리를 준비합니다. `prepare:nlp`는 별도 `comet-nlp` 실행 파일과 런타임을 준비합니다. 첫 실행에 모델을 내려받을 필요는 없습니다. 앱에서 로컬 모델을 선택할 때만 모델 파일을 별도로 준비합니다.

화면 서체는 기기에 설치된 을유1945를 사용하고 없으면 시스템 serif로 표시합니다. 폰트 다운로드는 실행 조건이 아니며 앱에 폰트 파일을 동봉하지 않습니다.

## 자주 쓰는 명령

| 목적 | 명령 |
| --- | --- |
| 브라우저 미리보기 | `corepack pnpm dev` |
| Tauri 데스크톱 실행 | `corepack pnpm desktop` |
| TypeScript·oxlint 검사 | `corepack pnpm check` |
| 프런트엔드 테스트 | `corepack pnpm test` |
| 프런트엔드 production build | `corepack pnpm build` |
| Rust 테스트 | `corepack pnpm test:rust` |
| sidecar 준비와 데스크톱 패키징 | `corepack pnpm build:desktop` |
| `.talk` 문법 검사 | `corepack pnpm talk check talk` |
| 동봉 대화팩 목록 | `corepack pnpm talk packs talk` |
| 공개 대본 변수 확인 | `corepack pnpm talk variables` |
| 위키 의존성 설치 | `corepack pnpm docs:install` |
| 위키 개발 서버 | `corepack pnpm docs:dev` |
| 위키 타입 검사 | `corepack pnpm docs:check` |
| 위키 정적 빌드 | `corepack pnpm docs:build` |

`pnpm dev`는 저장·창 조작·추론을 포함하지 않는 브라우저 미리보기입니다. 네이티브 동작은 `corepack pnpm desktop` 또는 패키징한 앱에서 확인합니다.

위키 개발 서버는 `http://127.0.0.1:3000`에서 엽니다. `docs/`가 원본이고 `wiki/`는 그 파일을 직접 읽으므로 문서 사본을 만들지 않습니다.

## 제품 범위

comet의 중심 경험은 큰 채팅 패널이나 상시 대시보드가 아니라, 바탕화면에 머무는 본체와 필요할 때만 나타나는 대화입니다.

- **기본 대화**: 새 프로필은 모델·API 없이 인사와 이름 질문으로 시작하고, 이름 등록 뒤 내장 자동 수다를 이어 갑니다. 설정·대화 기록·기억·친밀도는 보조 화면에서 관리합니다.
- **단어장**: 활성 키워드를 모델 준비보다 먼저 찾습니다. 가장 긴 키워드, 동률이면 먼저 등록한 항목을 선택하고 등록한 본문·공백·줄바꿈·화자 순서를 그대로 재생합니다.
- **대본**: 앱은 암호화된 `.talk` 대본을 읽고 재생합니다. `.talk` 원문 작성·검사·저장은 앱과 분리된 talk editor의 책임입니다. 새 상태별 대사 메뉴는 위젯 조건에 연결된 대사·표정·동작을 편집합니다.
- **공식 위젯**: 14개 도구를 선택해 설치·추가·중지·제거합니다. 기능 코드는 앱에 포함되고 manifest를 등록합니다. 수집함·소품과 사건 일지를 포함한 퇴역 위젯은 공식 실행 경로에서 제외하고 과거 데이터를 보존합니다. 사건 기록은 다이어리 하루 페이지에서, 메모 목록·검색은 계속 쓸 메모에서 확인합니다.
- **AI 위젯**: 선택한 로컬 모델이나 OpenAI 호환 API가 필요한 도구를 만들고 고칩니다. 다른 AI가 만든 JSON도 가져올 수 있습니다. 한 번 만든 위젯은 AI 없이 실행하며, 제작 진입과 자동 제작 토글은 설정 위젯 영역의 기본 접힘인 실험 기능에 있습니다. 자동 제작은 상위 자동 생성 설정도 따릅니다. [제작·실행·내부 컨텍스트 계약](docs/extensions.md)을 확인하세요.
- **LLM**: 로컬 모델과 OpenAI 호환 외부 API는 선택 기능입니다. 모델·API 설정을 바꿔도 기존 대화·기억·친밀도·단어장을 초기화하지 않습니다.

AI 위젯은 앱에 포함된 실행환경에서 제한된 JavaScript 함수와 자체 JSON 상태를 사용합니다. 임의 HTML/CSS·native/WASM·외부 package 실행, 범용 외부 Widget SDK, 원격 위젯 배포와 캐릭터팩 마켓은 제공하지 않습니다. 외부 runtime 설치가 필요한 기능을 추가할 때는 구체적인 패키지·출처·크기·권한을 보여 주고 사용자 동의를 받아야 합니다. 실제 기기·계정·모델에서 남은 확인은 [미검증 범위](docs/status.md)에 정리합니다.

## 데이터와 호환성

제품 이름·실행 파일·새 데이터 위치는 `comet`으로 통일합니다. 기존 설치에서 사용하던 데이터와 자격 증명은 첫 실행 때 새 위치로 자동 승계합니다.

| 항목 | 값 |
| --- | --- |
| 앱 식별자 | `space.starlight.comet` |
| SQLite 파일 | `comet.sqlite` |
| macOS 데이터 폴더 | `~/Library/Application Support/space.starlight.comet/` |
| Windows 데이터 폴더 | `%APPDATA%/space.starlight.comet/` |
| 로컬 모델 폴더 | 각 데이터 폴더의 `models/` |

대화·기억·관계·단어장·설정·위젯 정의·상태·상태 대사 규칙은 SQLite에 저장합니다. AI 제작의 제한된 작업 기록은 앱 데이터의 `ex-brain/`에 보관하며 전역 Fleet나 KnowledgeBase를 복사하지 않습니다. API 키는 SQLite나 브라우저 저장소가 아니라 macOS Keychain 또는 Windows Credential Manager에 저장합니다. 백업하려면 앱을 종료한 뒤 데이터 폴더를 복사하세요.

화면은 Rust 상태를 표시하고, 취소된 생성 결과와 오래된 준비 작업은 저장하거나 재생하지 않습니다. 모듈 책임과 `action`·`gate`·epoch·revision 경계는 [제품 동작](docs/behavior.md)이 기준입니다.

## 검증과 릴리스

소스 변경을 확인할 때는 저장소 루트에서 필요한 범위의 명령을 실행합니다.

```sh
corepack pnpm check
corepack pnpm test
corepack pnpm build
corepack pnpm test:rust
corepack pnpm docs:check
corepack pnpm docs:build
git diff --check
```

`corepack pnpm build:desktop`은 sidecar를 준비하고 `src-tauri/target/release/bundle/`에 설치물을 만듭니다. 현재 macOS 로컬 빌드는 ad-hoc 서명이고 notarization된 배포본이 아닙니다. 실제 macOS 조작, Windows 실행, 외부 계정 인증, 모델의 의미 품질은 자동 검사 통과만으로 확인된 것으로 보지 않습니다.

변경별 실제 실행 결과는 작업 기록에 남기고, 다른 기기·계정·모델에서 남은 확인은 [미검증 범위](docs/status.md)에만 정리합니다. 사용자에게 전달할 변경은 `corepack pnpm changeset`으로 기록하고, 버전 갱신·CI·릴리스 재시도는 [릴리스 안내](docs/development.md)를 따릅니다.

## 라이선스

프로그램 소스는 [GNU AGPL-3.0-only](LICENSE)입니다. 별꼬리 캐릭터와 이미지는 별도 이용 조건을 따르므로 [라이선스 파일](examples/character-packs/byulkkori.LICENSE.txt)을 함께 확인하세요.

llama.cpp sidecar의 고지는 [`llama.cpp-LICENSE.txt`](src-tauri/binaries/runtime/llama.cpp-LICENSE.txt)에 있습니다. 내려받은 GGUF 모델과 외부 의존성은 각 upstream 라이선스를 따르며, 직접 지정한 모델 파일은 사용자가 배포 조건을 확인해야 합니다.

내장 `fleetia/ex-brain`의 원본과 Comet 적용 차이는 [adapter 계약](resources/ex-brain/ADAPTER.md), 원본 revision·파일 hash는 [provenance](resources/ex-brain/provenance.json), GPLv3 고지는 [원본 LICENSE](resources/ex-brain/LICENSE)에 보존합니다.

## 선택 기억 검색

기본 기억 검색은 모델 없이 동작합니다. Kiwi 한국어 분석은 기억 설정에서 선택 설치하며 생성 LLM 설정과 독립적입니다. E5 의미 검색은 실행 경로를 구현했지만 품질 기준 미달과 배포 파일 미게시로 아직 다운로드·사용할 수 없습니다. [제품 동작](docs/behavior.md), [개발과 검증](docs/development.md), [미검증 범위](docs/status.md)를 함께 확인하세요.
