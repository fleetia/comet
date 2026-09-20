# comet

comet은 바탕화면에 작은 A/B 본체와 잠깐 나타나는 말풍선을 두는 데스크톱 앱입니다. 내장 대사와 단어장만으로 먼저 인사하고 짧게 수다를 떨며, 로컬 LLM이나 외부 API는 필요할 때만 연결합니다.

새 설치의 기본 캐릭터는 별꼬리 한 명이며 친구를 8명까지 늘릴 수 있습니다. 나디르와 텍스트 별꼬리는 사용자가 따로 가져와 함께 지내기를 선택하는 추가팩입니다. 캐릭터를 바꾸고 공유할 수 있으며, 설치·제거 가능한 대화팩의 암호화 `.talk` 대본이 시간·날씨·위젯 상태에 맞는 대화를 보탭니다. 기본 대화팩은 함께 지내는 친구 중 무작위 화자를 고릅니다. 모델이나 API가 없어도 기본 대화와 생활 도구는 동작합니다.

이 문서는 설치·실행·개발 명령과 문서 탐색을 위한 입구입니다. 제품 계약, 코드 구조, 변경별 검증 결과는 `docs/`를 원본으로 삼습니다.

## 먼저 읽을 문서

| 알고 싶은 것 | 문서 |
| --- | --- |
| 제품의 방향과 문서 읽는 순서 | [사양 안내](docs/index.md) |
| 현재 구현과 검증·미검증 범위 | [구현 상태](docs/status.md) |
| 모듈 책임과 취소·저장 경계 | [구조와 책임](docs/development/architecture.md) |
| 기능별 계약 | [제품 문서](docs/product/) · [위젯 문서](docs/widgets/) |
| `.talk` 작성과 CLI | [대본 작성](docs/product/talk.md) · [CLI·변수](docs/development/talk-reference.md) |
| 릴리스·업데이트·CI | [릴리스 안내](docs/development/releases.md) |
| 문서와 로컬 위키 운영 | [위키 운영](docs/development/wiki.md) |

## 다운로드

공개된 설치 파일은 [GitHub Releases](https://github.com/fleetia/comet/releases/latest)에서 받습니다.

- macOS 14 이상 Apple Silicon: `.dmg`
- Windows x64: `.exe`
- 개발 중 검증 파일: [Verify desktop Actions](https://github.com/fleetia/comet/actions/workflows/verify.yml)의 성공한 실행에서 artifact를 받습니다. 다운로드에는 GitHub 로그인이 필요합니다.

업데이트 기능이 포함되지 않은 최초 설치본은 수동으로 설치해야 합니다. 이후 업데이트는 앱에 포함된 서명을 확인한 뒤 사용자가 설치를 승인한 경우에만 진행합니다. 서명, updater, 실패 복구와 실제 인수 범위는 [릴리스 안내](docs/development/releases.md)를 따릅니다.

아래 추가팩은 기본 A/B에 포함되지 않으며 앱 업데이트와 별도로 수동 설치합니다.

| 팩 | 파일 |
| --- | --- |
| 나디르·별꼬리 | [nadir-and-star-tail.comet-character.json](examples/character-packs/nadir-and-star-tail.comet-character.json) |
| 별꼬리 | [byulkkori.comet-character.json](examples/character-packs/byulkkori.comet-character.json) · [이용 조건](examples/character-packs/byulkkori.LICENSE.txt) |

GitHub 파일 화면에서 **Download raw file**로 저장한 뒤 앱의 `캐릭터 관리 → 공유 파일 가져오기`에서 선택합니다. 가져온 캐릭터의 **함께 지내기**를 선택해야 바탕화면에 나타납니다. 캐릭터팩의 형식과 로컬 정체성은 [캐릭터 교체와 공유](docs/product/characters.md), 준비된 팩 목록은 [캐릭터팩 갤러리](docs/product/character-gallery.md)를 확인하세요.

## 개발 환경

지원 빌드 대상은 macOS 14 이상 Apple Silicon과 Windows x64입니다.

- Node.js 24, Corepack, pnpm 11.27.0
- Rust stable과 `cargo`
- macOS: Xcode Command Line Tools
- Windows: Visual Studio C++ 데스크톱 빌드 도구와 WebView2
- `@fleetia/lagrange` 설치 권한이 있는 GitHub Packages `read:packages` 토큰

`@fleetia/lagrange`는 GitHub npm registry에서 받습니다. 토큰은 저장소 파일에 넣지 마세요.

```sh
npm login --scope=@fleetia --auth-type=legacy --registry=https://npm.pkg.github.com
corepack pnpm install --frozen-lockfile
corepack pnpm prepare:sidecar
corepack pnpm desktop
```

`prepare:sidecar`는 고정한 llama.cpp 릴리스를 내려받아 SHA-256을 확인하고 `src-tauri/binaries/`에 실행 파일과 런타임 라이브러리를 준비합니다. 첫 실행에 모델을 내려받을 필요는 없습니다. 앱에서 로컬 모델을 선택할 때만 모델 파일을 별도로 준비합니다.

화면 서체는 기기에 설치된 을유1945를 사용하고 없으면 시스템 serif로 표시합니다. 폰트 다운로드는 실행 조건이 아니며 앱에 폰트 파일을 동봉하지 않습니다. 이용 조건과 디자인 차이는 [통합 설정창의 디자인 시스템](docs/product/settings.md#디자인-시스템)을 확인하세요.

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

- **기본 대화**: 모델·API 없이 내장 인사와 자동 수다가 동작합니다. 설정·대화 기록·기억·친밀도는 보조 화면에서 관리합니다.
- **단어장**: 활성 키워드를 모델 준비보다 먼저 찾습니다. 가장 긴 키워드, 동률이면 먼저 등록한 항목을 선택하고 등록한 본문·공백·줄바꿈·화자 순서를 그대로 재생합니다.
- **대본**: 앱은 암호화된 `.talk` 대본을 읽고 재생합니다. 원문 작성·검사·저장은 앱과 분리된 talk editor의 책임이며, Comet 안에 대본 편집 화면은 두지 않습니다.
- **위젯**: 공식 위젯 22개는 사용자가 선택해 설치·추가·중지·제거합니다. 기능 코드는 앱에 포함되고 manifest를 등록하는 방식입니다.
- **LLM**: 로컬 모델과 OpenAI 호환 외부 API는 선택 기능입니다. 모델·API 설정을 바꿔도 기존 대화·기억·친밀도·단어장을 초기화하지 않습니다.

외부 Widget SDK, 임의 HTML/CSS/JavaScript·native/WASM 실행, 원격 위젯 패키지 배포와 캐릭터팩 마켓은 현재 제공하지 않습니다. 각 기능의 조건과 후속 범위는 [사양 안내](docs/index.md)에서 확인하세요.

## 기능별 문서

| 영역 | 문서 |
| --- | --- |
| 바탕화면 본체·말풍선·자동 수다 | [바탕화면 상주 경험](docs/product/desktop.md) · [대화와 기억](docs/product/conversation.md) |
| 캐릭터 편집·1~8명 조합·공유 | [캐릭터 교체와 공유](docs/product/characters.md) |
| 생활 도구·메모·할 일·캘린더 | [할 일과 캘린더](docs/product/planning.md) · [장난감과 작은 도구](docs/product/toys.md) |
| 공식 위젯 설치·수명·카탈로그 | [카탈로그](docs/widgets/catalog.md) · [설치](docs/widgets/installation.md) · [수명주기](docs/widgets/lifecycle.md) |
| 대본 작성·상태·검사 | [대본 작성](docs/product/talk.md) · [대본 범위](docs/development/talk-coverage.md) |
| 다음 구현과 인수 기준 | [개발 순서](docs/development/roadmap.md) · [구현 상태](docs/status.md) |

## 데이터와 호환성

제품 이름·실행 파일·새 데이터 위치는 `comet`으로 통일합니다. 기존 설치에서 사용하던 데이터와 자격 증명은 첫 실행 때 새 위치로 자동 승계합니다.

| 항목 | 값 |
| --- | --- |
| 앱 식별자 | `space.starlight.comet` |
| SQLite 파일 | `comet.sqlite` |
| macOS 데이터 폴더 | `~/Library/Application Support/space.starlight.comet/` |
| Windows 데이터 폴더 | `%APPDATA%/space.starlight.comet/` |
| 로컬 모델 폴더 | 각 데이터 폴더의 `models/` |

대화·기억·관계·단어장·설정·위젯 상태는 SQLite에 저장합니다. API 키는 SQLite나 브라우저 저장소가 아니라 macOS Keychain 또는 Windows Credential Manager에 저장합니다. 백업하려면 앱을 종료한 뒤 데이터 폴더를 복사하세요.

화면은 Rust 상태를 표시하고, 취소된 생성 결과와 오래된 준비 작업은 저장하거나 재생하지 않습니다. 모듈 책임과 `action`·`gate`·epoch·revision 경계는 [구조와 책임](docs/development/architecture.md)이 기준입니다.

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

변경별 실제 실행 범위와 미완료 항목은 [구현 상태](docs/status.md)에 기록합니다. 사용자에게 전달할 변경은 `corepack pnpm changeset`으로 기록하고, 버전 갱신·CI·릴리스 재시도는 [릴리스 안내](docs/development/releases.md)를 따릅니다.

## 라이선스

프로그램 소스는 [GNU AGPL-3.0-only](LICENSE)입니다. 별꼬리 캐릭터와 이미지는 별도 이용 조건을 따르므로 [라이선스 파일](examples/character-packs/byulkkori.LICENSE.txt)을 함께 확인하세요.

llama.cpp sidecar의 고지는 [`llama.cpp-LICENSE.txt`](src-tauri/binaries/runtime/llama.cpp-LICENSE.txt)에 있습니다. 내려받은 GGUF 모델과 외부 의존성은 각 upstream 라이선스를 따르며, 직접 지정한 모델 파일은 사용자가 배포 조건을 확인해야 합니다.
