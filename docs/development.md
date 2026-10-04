---
title: 개발과 검증
---

# 개발과 검증

저장소 루트에서 소스를 실행하고 변경 범위에 맞는 검사를 선택하는 절차다. 자동 검사, 격리된 데스크톱 실행, 외부 계정·모델 평가의 완료 기준을 구분한다. 설치 파일과 첫 개발 환경 준비는 루트 `README.md`가 안내한다.

## 개발 환경과 실행

`package.json`의 pnpm 버전과 `wiki/package.json`의 Node.js 요구 조건을 따른다. 앱과 위키는 각각 lockfile을 가지므로 위키 의존성은 `wiki/`에서 설치한다. `@fleetia/lagrange`는 저장소의 `vendor/` tarball을 참조한다.

새 checkout에서 데스크톱을 실행하려면 Node.js·Corepack·pnpm, Rust·Cargo와 운영체제의 Tauri 빌드 도구를 준비한다. macOS는 Xcode Command Line Tools를, Windows는 C++ 데스크톱 빌드 도구와 WebView2를 사용한다. 아래 명령은 저장소 루트 기준이다.

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm prepare:sidecar
corepack pnpm prepare:nlp
corepack pnpm desktop
```

`prepare:sidecar`는 고정된 llama.cpp 배포 파일의 hash를 확인하고 실행 파일과 라이브러리를 준비한다. `prepare:nlp`는 별도 `comet-nlp` 실행 파일과 필요한 런타임을 준비한다. 둘 다 `src-tauri/tauri.conf.json`의 bundle 입력이다. 생성 모델 다운로드는 기본 앱 실행의 조건이 아니다.

`corepack pnpm dev`는 브라우저 미리보기다. 저장·네이티브 창·트레이·추론 프로세스를 확인하려면 `corepack pnpm desktop`이나 패키징한 앱을 사용한다. `desktop`은 Tauri의 `beforeDevCommand`로 프런트엔드 개발 서버를 시작한다.

## 자동 검사

변경한 책임의 회귀 검사를 먼저 실행하고 필요한 공통 검사를 실행한다. 통과한 테스트가 실제로 다루는 범위를 보고하며, 실패를 출력 필터나 뒤따르는 명령의 성공으로 가리지 않는다.

| 대상 | 루트에서 실행할 명령 | 확인하는 범위 |
| --- | --- | --- |
| TypeScript·정적 검사 | `corepack pnpm check` | 타입과 oxlint |
| 화면·훅·순수 로직 | `corepack pnpm test` | Vitest 회귀 검사 |
| 프런트엔드 배포 산출물 | `corepack pnpm build` | 타입 검사와 Vite build |
| 앱 Rust | `corepack pnpm test:rust` | 저장·취소·재생 등 Rust 검사 |
| NLP 프로세스 | `cargo test --locked --manifest-path crates/comet-nlp/Cargo.toml` | NLP 프로토콜·실행 모듈 |
| Rust lint | `cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | 앱과 테스트 대상 lint |
| 대본 | `corepack pnpm talk check talk` | 동봉 대본 문법·참조 |
| 릴리스 스크립트 | `corepack pnpm test:release` | 버전·배포 스크립트 검사 |
| 런타임 준비 | `corepack pnpm test:native-runtime` | native runtime 준비 로직 |
| 패치 공백 | `git diff --check` | diff의 공백 오류 |

Rust 앱 검사에도 sidecar와 NLP bundle 입력이 필요할 수 있다. 누락되면 준비 명령의 결과를 확인하고 다시 검사한다. 병행 Cargo 작업이 같은 target 디렉터리를 쓰면 잠금을 기다리며 다른 검증 프로세스를 임의로 종료하지 않는다.

## 격리된 데스크톱 QA

구현 변경은 현재 소스의 데스크톱 빌드·실행과 바뀐 동작의 조작 확인까지 마친다. 사용자 설치본·데이터에 영향을 주지 않도록 별도 `productName`과 `identifier`를 가진 QA 설정을 쓴다. 원본 `src-tauri/tauri.conf.json`을 QA용으로 바꾸지 않는다.

예를 들어 `test-results/native-qa/tauri.conf.json`에 아래 override를 준비한다.

```json
{
  "productName": "Comet Native QA",
  "identifier": "space.starlight.comet.native-qa"
}
```

macOS에서 sidecar·NLP 준비 후 다음과 같이 QA 앱을 만든다.

```sh
DEVELOPER_DIR=/Library/Developer/CommandLineTools \
PATH="$HOME/.cargo/bin:$PATH" \
corepack pnpm tauri build --debug --bundles app \
  --config test-results/native-qa/tauri.conf.json

codesign --verify --deep --strict \
  'src-tauri/target/debug/bundle/macos/Comet Native QA.app'
/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' \
  'src-tauri/target/debug/bundle/macos/Comet Native QA.app/Contents/Info.plist'
```

실행 전에 앱 식별자·실행 파일·경로가 새 QA 산출물과 일치하는지 확인한다. 같은 QA 앱의 이전 프로세스를 종료한 뒤 새 빌드를 실행하고, 실제 창 크기에서 클릭·키보드·스크롤·저장·재시작을 확인한다. 트레이 종료와 창 닫기, 앱 메뉴 종료를 같은 경로라고 가정하지 않는다. OS 권한 승인이 필요하면 사용자에게 맡긴다.

저장이나 migration을 바꿨으면 합성 데이터 또는 복사한 데이터로 검증한다. 실행 중인 SQLite 파일만 따로 복사하지 않고 SQLite 백업 API로 일관된 복사본을 만든다. 원본 데이터는 읽기만 하고, 검증 전후의 해당 행·원문·식별자와 `PRAGMA integrity_check`를 확인한다. 행 수가 같다는 사실을 전체 내용이 동일하다는 증거로 확대하지 않는다.

실제 빌드·식별자·환경·조작·결과·남은 범위는 작업 기록에 남긴다. 저장소의 `test-results/`는 로컬 증거를 위한 ignored 경로다. `docs/status.md`에 테스트 개수·과거 QA 기록을 누적하지 않는다. 실행이 막히면 이유와 남은 조작을 기록하고 네이티브 검증 완료로 처리하지 않는다.

새 빌드의 정상 실행을 확인한 다음 오래된 Comet 앱·설치 파일만 정리한다. 사용자 데이터·설정·설치팩·모델과 빌드 캐시는 삭제하지 않는다. 사용자 설치본 교체는 별도로 승인된 배포 작업에서 다룬다.

## 릴리스와 검증의 경계

`corepack pnpm build:desktop`은 두 sidecar를 준비하고 Tauri 패키지를 만든다. 사용자에게 전달할 변경은 `corepack pnpm changeset`으로 기록하고, `corepack pnpm version:release`와 `corepack pnpm release:check`로 버전 일치를 확인한다. 자동화의 실제 조건·서명 입력·산출물은 `.github/workflows/changesets.yml`, `release.yml`, `verify.yml`과 `scripts/release.py`를 기준으로 삼는다.

QA 앱의 실행이나 패키지 build 성공만으로 공식 updater의 설치·자동 재시작, Apple notarization, Windows Authenticode, 외부 계정 인증, 실제 모델의 의미 품질을 확인했다고 하지 않는다. 해당 검증은 배포 경로와 대상 환경에서 수행한다.

## 문서와 위키

문서 원본은 `docs/`다. Docusaurus 설정과 검색 설정은 둘 다 `../docs`를 읽으며 사양 사본을 만들지 않는다. `wiki/sidebars.ts`에는 이 다섯 문서만 등록한다.

```sh
corepack pnpm docs:install
corepack pnpm docs:check
corepack pnpm docs:build
corepack pnpm docs:dev
```

위키는 `http://127.0.0.1:3000`에서 열린다. `docs:check`는 위키 설정의 TypeScript를 검사하고, `docs:build`는 Markdown·MDX, sidebar와 링크를 포함한 정적 빌드를 확인한다. 둘을 함께 통과해야 문서 검증을 마친다. 깨진 링크·앵커를 오류로 처리하는 설정을 약화하지 않는다.

이 문서는 `package.json`의 script, sidecar 준비 방식, QA 격리 경계, CI 또는 wiki 설정이 바뀔 때 갱신한다. 다른 기기·외부 계정·실제 모델에서 별도 확인해야 하는 항목은 [미검증 범위](status.md)에 둔다.
