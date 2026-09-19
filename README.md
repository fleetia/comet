# comet

바탕화면에 머무는 A와 B가 먼저 인사하고, 짧게 수다를 떨고, 다시 조용해지는 나니카·우카가카형 데스크톱 앱입니다. 내장 대사와 사용자가 등록한 단어장이 기본 대화를 맡고, 선택적으로 로컬 LLM이나 외부 API를 연결합니다.

기본 캐릭터 나디르·별꼬리, 암호화 대본 에디터와 선택지 스토리, 선택 설치하는 공식 위젯 22개를 제공합니다. 모델이나 API 없이 내장 대사와 생활 도구를 사용할 수 있습니다. 외부 Widget SDK·임의 코드 실행·원격 배포는 후속 범위입니다.

이 README는 개발 환경 준비와 앱 사용을 안내합니다. 제품 계약·소스 구조·검증 기록은 다음 문서에서 확인합니다.

| 목적 | 시작점 |
| --- | --- |
| 제품 경험과 기능별 계약 | [사양 안내](docs/index.md) |
| 구현된 기능과 남은 검증 | [구현 상태](docs/status.md) |
| 코드 책임과 변경 시 보존할 경계 | [구조와 책임](docs/development/architecture.md) |
| 대본 작성과 검사 | [대본 작성](docs/product/talk.md), [CLI·변수](docs/development/talk-reference.md) |
| 위키 실행과 문서 수정 | [위키 운영](docs/development/wiki.md) |

프로젝트·실행 앱·JavaScript 및 Rust 패키지·실행 파일은 소문자 **comet**, Rust 라이브러리는 `comet_lib`입니다. 기존 데이터를 이어 쓰도록 `space.starlight.nanika-box`, `nanika.sqlite`, 자격 증명 서비스 이름과 암호화 파일 형식을 유지합니다. 아이콘 원본은 `src-tauri/icons/source.svg`입니다. 기존 0.2 사양과 각 변경의 검증 기록은 당시 결과로 보존합니다.

## 다운로드와 앱 업데이트

공식 설치 파일은 [GitHub Releases](https://github.com/fleetia/comet/releases)에서 제공합니다. 2026-09-19 기준 첫 signed updater 릴리스는 준비 중입니다. 검증용 설치 파일은 [Verify desktop Actions](https://github.com/fleetia/comet/actions/workflows/verify.yml)의 성공한 실행에서 **Artifacts**를 내려받아 사용합니다. macOS Apple Silicon용 `.dmg`는 `comet-arm64-macOS`, Windows x64용 `.exe`는 `comet-x64-Windows`에 포함됩니다. Actions 산출물 다운로드에는 GitHub 로그인이 필요합니다. 직접 빌드하려면 아래 소스 실행 절차를 이용하세요.

Release 본문에는 운영체제별 설치 파일 다운로드 링크와 설치 안내, Changesets로 작성한 업데이트 노트를 함께 제공합니다. 변경 시 `pnpm changeset`으로 기록하면 버전 갱신 PR이 자동으로 열리고, 이를 병합하면 두 OS 설치 파일을 빌드·검증한 뒤 공개합니다. 작성 방법과 실패 재시도는 [릴리스 안내](docs/development/releases.md#버전-배포)를 따릅니다.

업데이트용 공개키가 포함된 앱은 시작할 때와 하루에 한 번 새 버전을 확인합니다. 설정의 `앱 업데이트`에서 직접 확인할 수도 있으며, `설치하고 다시 시작`을 선택한 경우에만 내려받고 서명을 검증한 뒤 설치합니다. 최초 updater 탑재 버전은 수동 설치해야 합니다. OS 코드 서명과 실제 업데이트 검증 상태는 [릴리스 안내](docs/development/releases.md)를 확인하세요.

캐릭터팩은 [갤러리](docs/product/character-gallery.md)에서 내려받아 수동으로 설치합니다. 앱 업데이트가 설치한 캐릭터팩을 자동으로 교체하지 않습니다.

| 미리보기 | 패키지·다운로드 | 제작자 | 호환 앱 | 이용 조건 |
| --- | --- | --- | --- | --- |
| `(・_・)` · `(^‿^)` | [나디르와 별꼬리 JSON](examples/character-packs/nadir-and-star-tail.comet-character.json) | Comet | 0.3.0 이상 · v1 | 패키지에 별도 표기 없음 |
| ![별꼬리](character-packs/byulkkori-preview.svg) | [별꼬리 JSON](examples/character-packs/byulkkori.comet-character.json) | 미입력 | 0.4.0 이상 · v2 | [공식 배포 전용 콘텐츠](examples/character-packs/byulkkori.LICENSE.txt) |

GitHub 파일 화면에서 **Download raw file**로 저장한 뒤 `캐릭터 관리 → 공유 파일 가져오기`에서 설치합니다. 함께 지낼 캐릭터는 설치 후 별도로 선택합니다. 패키지 등록 제안은 JSON, 미리보기, 제작자·출처, 이용 조건과 호환 버전을 포함해 issue 또는 pull request로 보냅니다. 공식 갤러리 반영은 배포 권한과 파일 검증을 확인한 뒤 진행합니다.

## 사양 문서와 Docusaurus 위키

`docs/`가 문서 원본이며 `wiki/`가 같은 파일을 직접 읽습니다. 위키 의존성은 별도 패키지로 관리하고 데스크톱 앱 설치물에 포함하지 않습니다. 프로젝트 루트에서 실행합니다.

```sh
corepack pnpm docs:install
corepack pnpm docs:dev
```

[로컬 위키](http://127.0.0.1:3000)에서 제품 경험·생활 도구·Widget SDK 계약·개발 순서를 읽을 수 있습니다. 한국어 검색을 확인하려면 `corepack pnpm docs:build` 뒤 `corepack pnpm docs:serve`를 실행합니다. 타입 검사는 `corepack pnpm docs:check`입니다. 문서 추가·검증·배포 경계는 [위키 운영](docs/development/wiki.md)을 따릅니다.

## 시작하기

지원 빌드 대상은 **macOS 14 이상 Apple Silicon**과 **Windows x64**입니다. Node.js 24, pnpm 10.32.1, Rust stable이 필요합니다. macOS에는 Xcode Command Line Tools, Windows에는 Visual Studio의 C++ 데스크톱 빌드 도구와 WebView2가 필요합니다. Windows 설치 패키지는 WebView2가 없으면 bootstrapper로 설치합니다.

`@fleetia/lagrange`는 GitHub npm registry에서 받습니다. 소스가 공개되어 있어도 이 registry는 패키지 설치에 인증을 요구합니다. `read:packages` 권한의 GitHub personal access token (classic)으로 아래 로그인 명령을 실행한 뒤 설치하세요. 패키지가 비공개라면 해당 패키지의 읽기 권한도 필요합니다. 토큰은 저장소 파일에 넣지 않습니다.

```sh
npm login --scope=@fleetia --auth-type=legacy --registry=https://npm.pkg.github.com
```

프로젝트 루트에서 실행합니다.

```sh
pnpm install --frozen-lockfile
pnpm prepare:sidecar
pnpm desktop
```

`prepare:sidecar`는 고정한 llama.cpp 릴리스를 내려받아 SHA-256을 확인하고 실행 파일과 의존 라이브러리를 `src-tauri/binaries/`에 배치합니다. 로컬 대화 모델은 앱을 연 뒤 설정에서 별도로 내려받습니다. 일반적인 개발 실행에서는 sidecar 준비를 다시 할 필요가 없습니다.

`cargo`가 없다는 오류가 나면 Rust 설치와 `cargo --version`을 먼저 확인하세요. macOS에서 Rust가 설치되어 있지만 현재 셸의 PATH에 없다면 다음 명령으로 해당 셸에 적용할 수 있습니다.

```sh
source "$HOME/.cargo/env"
```

macOS 빌드에서 SDK나 linker 오류가 나면 `xcode-select -p`와 `xcrun --show-sdk-path`를 확인하세요. 선택된 Xcode가 현재 macOS와 맞지 않지만 Command Line Tools가 정상 설치되어 있다면, 전역 설정을 바꾸지 않고 해당 실행에만 적용할 수 있습니다.

```sh
DEVELOPER_DIR=/Library/Developer/CommandLineTools pnpm desktop
```

Command Line Tools 자체가 없다면 `xcode-select --install`로 설치한 뒤 실행하세요. 기존 Xcode를 사용하는 환경에서는 유효한 Xcode 경로를 유지하면 됩니다.

## 바탕화면에서 함께 지내기

기본 화면은 그림 없이 얼굴 이모티콘으로 표시되는 A/B 두 명과 잠깐 나타나는 공용 말풍선입니다. 성격과 기본 대화는 동봉 콘텐츠 패키지에서 가져오며, 그림은 선택 패키지로 추가합니다. 함께 지낼 캐릭터는 1~8명까지 선택합니다. 장면이 끝나면 말풍선은 닫히고 본체만 남습니다. 본체를 끌어 이동하고, 클릭·우클릭 메뉴 또는 더블클릭 입력으로 말을 걸 수 있습니다. 대화 기록·친밀도·설정은 보조 화면에서 확인합니다.

사용자가 먼저 입력하지 않아도 실행 약 5초 후 내장 인사를 시작하고, 기본 2분 간격에 ±20% 변동을 둔 잡담을 이어 가는 것이 제품 기준입니다. 모델이나 API가 없어도 내장 대사가 동작합니다. `autonomousEnabled`는 자동 생성과 재생 전체를 제어하며 기본값은 켜짐입니다. 일시정지·숨김·상위 자동 설정 끄기는 자동 재생도 멈춥니다. 사용자 입력은 진행 중인 자동 장면보다 우선합니다.

메뉴 막대·알림 영역에서 캐릭터와 설치한 위젯을 각각 부를 수 있습니다. 캐릭터 숨김은 재시작 후에도 유지하며 위젯은 계속 사용할 수 있습니다. 공·종이비행기·비눗방울·펫은 위젯 패널 밖에서 화면과 다른 창의 보이는 경계에 반응합니다. 자동 장난은 기본으로 꺼져 있으며, 켜면 허용한 장난감 중 설치·활성화한 것을 10~20분 간격으로 하나씩 꺼냅니다.

### 암호화 대본과 선택지 스토리

캐릭터 관리의 **대본 에디터**에서 앱 데이터 폴더의 `talk/index.talk`부터 이어지는 대본을 편집하면, 공식 위젯의 실제 상태와 사건을 이용해 A/B의 수다를 만들 수 있습니다. `import`로 파일을 나누고 조건·표정·변수 보간을 지정합니다. 모델이나 API는 필요하지 않습니다. 첫 인사 뒤에는 위젯 상태 대본과 기존 일반 수다 차례를 번갈아 사용하며, 상태 대본 후보가 없으면 일반 수다로 이어집니다. 위젯 사건은 기존 사건 대기열을 사용합니다.

기본 캐릭터는 나디르·별꼬리이며 업타임 1시간마다 선택지 스토리로 먼저 말을 겁니다. 초기에는 표면만 공개하고 친밀도 40/70과 앞 단계 진행에 따라 개인 이야기를 엽니다. 행동별 대사 변주는 최소 5개입니다. 시간과 날씨 정보 없음 대사는 위젯 없이도 나오며 실제 날씨는 설정한 지역의 유효한 관측값이 있어야 사용합니다.

최초 실행에 기본 대본을 한 번 설치합니다. 수정한 파일을 다시 읽고, 오류가 나면 마지막 정상 대본을 유지합니다. 삭제한 파일은 재시작해도 복원하지 않습니다. 문법·파일 위치·재로딩 규칙은 [대본 작성](docs/product/talk.md), 명령과 변수는 [CLI·변수 참고](docs/development/talk-reference.md)를 따릅니다.

저장소 루트에서 Rust 환경을 준비한 뒤 실행합니다.

```sh
pnpm talk check talk/index.talk
pnpm talk variables
```

[대본 범위](docs/development/talk-coverage.md)와 [이전 대본 검증 기록](docs/VALIDATION-TALK.md)은 자동 테스트, 실제 macOS 실행, 미검증 외부 환경을 구분합니다. 암호화 대본 에디터는 원문·파일 선택·오류 위치·검사 후 저장을 제공합니다. SSP/Yarn 파일 호환은 제공하지 않습니다.

### 단어장

설정의 단어장에서 제목, 쉼표·줄바꿈으로 구분한 키워드, A/B의 대사와 표정을 등록합니다. 항목마다 활성화와 `자동 잡담에도 사용` 여부를 선택합니다. 자동 잡담 허용은 기본으로 꺼져 있습니다.

입력에 활성 키워드가 포함되면 등록 대사를 그대로 재생합니다. 긴 키워드를 우선하고, 길이가 같으면 먼저 등록한 항목을 사용합니다. 이 매칭은 모델 준비 확인보다 먼저 수행하므로 **등록 대사에는 모델·API 키가 필요하지 않습니다.** LLM은 등록 대사의 문구나 화자 순서를 바꾸지 않습니다. 초기 예제 두 개는 한 번만 등록되며, 삭제한 예제가 재시작 후 되살아나지 않아야 합니다.

`pnpm dev`의 브라우저 화면은 미리보기입니다. 실제 저장·창 조작·추론은 데스크톱 앱에서 확인합니다. 화면 크기, 자동 동작 스위치의 세부 의미와 수락 조건은 [제품 사양](docs/PRODUCT.md)을 따릅니다.

## 캐릭터 바꾸기와 공유

본체 메뉴의 `캐릭터 관리`에서 캐릭터를 만들고 이름·성격·표정·인사·수다를 편집합니다. 설치한 캐릭터 중 1~8명을 활성화하고 순서를 정할 수 있습니다. 캐릭터에 속한 장면과 키워드 대사는 순서를 바꿔도 해당 캐릭터를 따르며, 개인 단어장의 A/B는 현재 첫째·둘째 자리를 뜻합니다.

표정은 캐릭터마다 추가·삭제할 수 있고 기본 표정 `평온`만 고정입니다. 저장한 캐릭터의 표정마다 SVG·PNG·GIF·WebP·JPEG 이미지(2 MiB 이하)를 붙이면 본체가 상자 없이 그 이미지로 떠 있고, 이미지가 없는 표정이나 캐릭터에 없는 표정은 `평온` 이미지로 표시합니다. `이미지 크기(px)`로 32~512px 사이를 정하면 본체 창도 그 크기에 맞춰집니다. `텍스트 표정을 따로 움직이는 창으로 표시`를 켜면 같은 표정의 텍스트 표정이 별도 창으로 떠서 본체와 독립적으로 끌어 옮길 수 있습니다. 이미지로 표시되는 동안 말풍선은 화자 이름을 생략합니다. `말풍선 이미지 선택`으로 캐릭터별 말풍선 스킨을 붙이면 말풍선이 커질 때 이미지 정중앙 1px만 늘려 모양을 유지합니다. 홀수 크기 이미지가 잘 맞습니다.

`공유 파일 가져오기`에서 JSON을 선택하고 미리본 뒤 가져옵니다. 설치 후 원하는 자리에 적용하며, 재가져오기는 기존 캐릭터 업데이트가 아닌 새 로컬 복사본입니다. 예제는 [나디르·별꼬리 캐릭터팩](examples/character-packs/nadir-and-star-tail.comet-character.json)과 9가지 표정 이미지가 든 [별꼬리 캐릭터팩](examples/character-packs/byulkkori.comet-character.json)입니다.

내보내기는 저장된 선택 캐릭터 또는 함께 지내는 1~8명을 v2 UTF-8 `*.comet-character.json` 파일(최대 32 MiB)로 만듭니다. 표정 이미지는 base64로 함께 들어갑니다. 개인 단어장은 기본 제외되며 선택한 항목만 추가합니다. 실제 대화·기억·친밀도·API 키는 포함하지 않습니다. 새 캐릭터의 친밀도는 20이고, 이전 캐릭터로 돌아오면 관계를 복원합니다. 이름을 바꿔도 과거 기록의 화자 이름은 보존합니다.

ZIP 캐릭터팩·원격 마켓·캐릭터팩 자동 업데이트·SSP 호환은 제공하지 않습니다. `.talk`의 위젯 사건 대본은 별도 파일이며 캐릭터팩 JSON에 포함하거나 가져오기로 설치하지 않습니다. 실제 규격과 제한은 [캐릭터 교체와 공유](docs/product/characters.md)를 참고하세요. 공식 위젯 22개와 설치 관리는 별도로 구현했습니다. 공개 Widget SDK·Rust workspace는 도입하지 않았습니다.

## 공식 위젯 사용하기

본체 메뉴의 `위젯 관리`에서 원하는 도구만 선택하고 설치합니다. 처음에 모두 건너뛴 뒤 나중에 추가해도 됩니다. `꺼내기`로 개별 화면을 열고, 끄기·제거는 관리 화면에서 수행합니다. 제거 시 사용자 데이터 보존이 기본이며, 데이터 삭제는 별도 선택입니다.

22개 목록은 [공식 카탈로그](docs/widgets/catalog.md)를 따릅니다. 할 일·반복·루틴·장보기, 집중 타이머·준비 봉투·시계·메모와 작은 놀이를 모델 없이 사용합니다. 캘린더는 ICS/webcal 구독 또는 사용자가 설정한 Google Desktop OAuth 클라이언트의 읽기 권한으로 연결합니다. 날씨는 직접 고른 지역을 조회하고, 음악은 macOS Music·Spotify의 현재 곡 정보만 읽습니다. Google 실제 계정 인증과 Windows 실행은 아직 검증하지 않았습니다.

설치는 동봉 manifest 등록입니다. 기능은 공용 호스트에 컴파일되어 있으며 표시하는 설치 바이트 수는 manifest 크기입니다. 제거가 앱 실행 파일을 줄이거나 외부 코드를 제거하는 것은 아닙니다. 일정 알림은 기본 꺼짐입니다. 읽기 연결·갱신 간격·지원하지 않는 ICS 형식·반복 정책은 [할 일과 캘린더](docs/product/planning.md)를 확인하세요.

## 대화 방식

### 로컬 모델

설정에서 `이 기기에서` → `로컬 모델`을 선택하고 `모델 내려받기`를 누른 뒤 `설정 저장`을 누릅니다. 기본값은 **Qwen3.5-4B**이며 기존 설정도 4B로 유지됩니다. 다운로드는 중단·이어받기를 지원하며, 전체 크기와 SHA-256 검증 후에만 모델을 준비 완료로 표시합니다.

목록의 모델은 모두 **Q4_K_M GGUF** 형식입니다.

| 모델 | 다운로드 용량 | 선택 기준 |
| --- | --- | --- |
| Qwen3.5-4B (기본) | 2.74 GB | 메모리와 응답 속도를 우선할 때 |
| Qwen3.5-9B | 5.68 GB | 더 많은 메모리와 응답 시간을 감수하고 대화 품질을 비교할 때 |
| Qwen3.8-2B-Distill | 1.31 GB | 가장 가벼운 실험용. 2B가 어디까지 되는지 확인할 때 |
| Qwen3.8-4B-Distill | 2.78 GB | 상시 구동 후보 |
| Qwen3.8-9B-Distill | 5.78 GB | 같은 계열의 품질 상한 |
| Gemma 4 E4B | 4.98 GB | Qwen이 아닌 4B급 비교용 |
| Gemma 4 12B | 7.12 GB | 고품질 비교용. 메모리를 가장 많이 사용 |
| Ministral 3 8B | 5.20 GB | Mistral 계열 비교용 |

`직접 지정한 GGUF 파일`을 선택하면 이 기기에 있는 임의의 GGUF 파일을 절대 경로로 연결할 수 있습니다. 이 파일은 내려받기·해시 검증 대상이 아니며, 실행 가능 여부는 고정한 llama.cpp 릴리스의 아키텍처 지원에 따릅니다. `테스트하기`는 저장하지 않은 선택도 포함해 선택한 모델을 불러와 짧은 인사에 답하게 하고 걸린 시간과 답을 보여 줍니다. 테스트한 모델이 저장된 모델과 다르면 테스트 후 프로세스를 종료합니다.

다운로드·이어받기·검증 상태는 모델별로 보관합니다. 모델 선택은 `설정 저장`을 누르면 적용되고, 진행 중인 생성과 이전 모델로 준비한 대사를 취소한 뒤 다음 대화부터 선택한 모델을 실행합니다. 대화 기록·기억·친밀도는 유지됩니다. 여러 모델을 내려받아도 한 번에 하나만 실행합니다.

모델 리비전·URL·크기·해시는 [models.rs](src-tauri/src/models.rs)가 기준입니다. 변경 가능한 최신 URL을 사용하지 않습니다. 모델은 설치 패키지에 포함되지 않습니다.

추론은 앱이 관리하는 `llama-server`에서 수행합니다. loopback 주소와 임시 인증 토큰을 사용하고, context 4096·동시 실행 1개·thinking 비활성화로 설정합니다. macOS는 Metal, Windows 기본 빌드는 CPU를 사용합니다. 마지막 직접 대화 응답 뒤 약 120초가 지나면 로컬 프로세스를 종료하며 다음 대화에서 다시 준비합니다. 생성 취소도 해당 프로세스를 종료하므로 다음 요청은 모델을 다시 불러옵니다. 자동 대사 준비는 이 유지 시간을 연장하지 않습니다. 실제 메모리 사용량과 응답 속도는 기기에 따라 다릅니다.

자동 LLM 장면은 최대 3개만 준비하며 준비 시도 간격은 `max(60초, 설정한 잡담 간격)`입니다. 각 백그라운드 추론은 최대 45초이며, 자동 잡담이 켜져 있으면 다음 재생 예정 시각까지 남은 시간으로 더 줄입니다(최소 1초). 시간 초과 시 작업을 중단하고 로컬 프로세스를 종료해 내장 잡담이 오래 기다리지 않게 합니다.

Unix에서는 로컬 장면을 준비할 때만 1분 load average를 논리 CPU 수로 나눈 값이 `0.65` 미만인지 확인합니다. **실제 CPU 사용률 65% 기준은 아닙니다.** 측정값이 없거나 유효하지 않으면 준비를 미룹니다. 상시 부하 감시 작업은 없으며 Windows에는 현재 이 추가 검사를 적용하지 않습니다. 구현은 [resources.rs](src-tauri/src/resources.rs), 세부 동작은 [제품 사양](docs/PRODUCT.md#선택적인-llm과-자원-사용)을 참고하세요.

Windows에서 Vulkan sidecar를 직접 준비하려면 `pnpm prepare:sidecar -- --vulkan`을 실행할 수 있습니다. 기본 `build:desktop`은 CPU sidecar를 다시 준비하므로, 선택한 Vulkan sidecar로 패키징하려면 이후 `pnpm tauri build`를 사용하세요. Vulkan 드라이버 호환성은 별도 확인이 필요합니다.

### 외부 API

설정에서 `외부 API로`를 선택하고 OpenAI 호환 API의 base URL, 모델 이름, API 키를 입력합니다. 연결 테스트를 거쳐 설정을 저장하세요. 제공자에 따라 `max_tokens` 또는 `max_completion_tokens`를 선택할 수 있습니다.

키는 macOS Keychain 또는 Windows Credential Manager에 **정규화한 endpoint별로** 저장합니다. SQLite와 브라우저 저장소에는 넣지 않으며, 저장 성공 후 입력란을 비웁니다. 다른 endpoint로 바꾸면 기존 endpoint의 키를 자동 재사용하지 않습니다. 외부 주소는 HTTPS가 필요하며, localhost는 HTTP를 허용합니다.

API 모드에서는 대화와 필요한 기억이 선택한 제공자에게 전송됩니다. 연결 테스트, 응답 생성, 대화 후 기억 분석은 API 요청을 발생시킬 수 있습니다. **API를 사용하는 자동 대사 생성(`apiIdleEnabled`)은 기본으로 꺼져 있습니다.** 내장 대사와 허용된 단어장의 자동 재생까지 끄는 설정은 아닙니다. 켜면 사용자 입력 없이 추가 요청과 비용이 발생할 수 있습니다. API 자동 대사 생성은 시간당 최대 2회로 제한하며, 이 한도는 앱을 다시 시작해도 유지합니다. LLM 준비 장면은 최대 3개로 제한하고 무효화된 결과는 재생하지 않습니다. 자동 동작 전체를 끄려면 `autonomousEnabled` 또는 실행 중 일시정지를 사용합니다.

## 데이터와 구조

영구 데이터 경로는 Rust의 `app.path().app_data_dir()`가 결정합니다. 앱 식별자는 `space.starlight.nanika-box`입니다.

| 운영체제 | 기본 데이터 위치 |
| --- | --- |
| macOS | `~/Library/Application Support/space.starlight.nanika-box/` |
| Windows | `%APPDATA%/space.starlight.nanika-box/` |

`nanika.sqlite`에는 대화, 기억, 관계 점수, 단어장, 설정, 창 위치와 위젯 상태·명령 중복 방지 기록·선택한 사건 일지를 저장하고 `models/`에는 모델과 다운로드 임시 파일을 둡니다. 백업할 때는 앱을 종료한 뒤 데이터 폴더를 복사하세요. API 키는 별도의 운영체제 자격 증명 저장소에 있으므로 데이터 폴더 백업에 포함되지 않습니다.

Rust 상태가 원본이며 프론트엔드는 이벤트를 받아 표시합니다. 사용자 입력이나 설정 변경으로 취소된 생성 결과는 적용하지 않습니다. 기억을 수정하면 기존 기억에 기반한 준비 대사를 무효화합니다.

화면·명령·재생·저장·대본의 상세 파일 배치와 `action`·`gate`·epoch·revision 경계는 [구조와 책임](docs/development/architecture.md)에서 관리합니다. 코드 책임을 옮기면 구조 문서의 모듈 표를 함께 갱신합니다.

## 검증과 패키징

```sh
pnpm check
pnpm test
pnpm build
pnpm prepare:sidecar
pnpm test:rust
pnpm build:desktop
```

`pnpm build`는 프론트엔드만 빌드합니다. `pnpm build:desktop`은 sidecar를 준비하고 Tauri 설치물을 `src-tauri/target/release/bundle/`에 생성합니다. macOS 설정은 로컬 실행용 ad-hoc 서명이며 notarization된 배포본은 아닙니다. 이 구성은 Team ID가 없는 sidecar와 dylib를 함께 실행하기 위해 hardened runtime을 끕니다. 외부 배포용으로 전환할 때는 모든 실행 파일과 dylib를 같은 Developer ID로 서명하고 hardened runtime·notarization을 다시 검증해야 합니다.

[verify.yml](.github/workflows/verify.yml)은 main push·main 대상 pull request와 Actions의 **Run workflow**에서 실행합니다. 문서·변경셋만 바뀌면 자동 native 검증을 생략합니다. UI 검사·테스트는 Ubuntu에서 한 번 실행하고, macOS arm64·Windows x64에서 각각 Rust 테스트와 네이티브 패키징을 수행합니다. macOS는 `app,dmg`, Windows는 `nsis` bundle을 만들며 `.dmg`·`.exe`와 기존 macOS 앱 ZIP을 7일 보관하는 artifact로 올립니다. Rust 의존성·sidecar 캐시를 Release와 공유하고 macOS 앱 서명·DMG 무결성 검사는 유지합니다. 실행 조건과 캐시 범위는 [릴리스 문서](docs/development/releases.md#ci-실행과-캐시)를 따릅니다. `macos-14`가 arm64이고 `windows-latest`가 x64라는 [GitHub 공식 runner 표](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job)를 기준으로 하며, 실행 시 Node의 실제 아키텍처도 검사합니다.

### 검증 범위

2026-09-19 구조 리팩토링은 Rust·프런트엔드 회귀 테스트, 예제를 포함한 strict Clippy, Node.js 24의 위키 검사를 통과했습니다. 격리된 macOS QA 앱에서 모델 없는 설정 저장·자동 잡담, 정확한 단어장 재생·중단, 말풍선 종료와 재시작 데이터 보존을 확인했습니다. release 앱·DMG 생성과 앱 서명·DMG 무결성 검사도 통과했습니다. 기존 사용자 앱 교체와 Windows 실행은 포함하지 않습니다. 구체적인 명령·결과와 미검증 범위는 [현재 상태표](docs/status.md#2026-09-19-구조-리팩토링)를 따릅니다.

0.3.0은 캐릭터 편집·교체·JSON 공유의 자동 테스트, macOS 네이티브 조작, 기존 데이터 보존과 패키지 검증을 통과했습니다. 구체적인 흐름과 한계는 [0.3.0 검증 기록](docs/VALIDATION-0.3.0.md)에 있습니다. 아래 0.2.0 결과는 이전 버전의 기록입니다.

0.1의 두 대화 패널을 대상으로 얻은 테스트 개수·스크린샷·응답 시간·메모리 수치는 0.2 화면의 검증 결과로 사용하지 않습니다. 새 빌드는 [제품 사양의 인수 기준](docs/PRODUCT.md#인수-기준)에 따라 모델 없는 첫 실행, 자동 잡담과 침묵, 정확한 단어장 재생, 취소·재시작·종료, 기존 데이터 보존을 별도로 확인해야 합니다.

2026-09-15의 0.2.0 준비 코드 검증에서는 Rust 라이브러리 테스트 43개와 프론트엔드 테스트 16개가 통과했습니다. Rust 전체 target 테스트도 통과했으나 예제에 공유 모듈 테스트가 중복 포함되므로 별도 테스트 개수로 더하지 않습니다. `cargo clippy --lib --bins -- -D warnings`는 통과했습니다. `--all-targets` Clippy에는 기존 예제의 미사용 코드·clone 관련 경고가 남아 있습니다. 최종 0.2.0 macOS 패키지 빌드와 서명·DMG 검증도 통과했습니다. 실제 앱에서 모델 없는 자동 인사·정기 잡담, 정확한 키워드 대사, 단어장 저장·재시작·삭제, 4B 대화, 종료 시 서버 정리와 기존 메시지 보존을 확인했습니다. 관찰 근거와 미검증 범위는 [0.2.0 검증 기록](docs/VALIDATION-0.2.0.md)에 정리했습니다. Windows·다중 모니터와 장시간 자원 사용 검증은 완료하지 않았습니다.

구조 테스트 통과와 모델의 의미 품질은 구분합니다. 모델이 올바른 JSON을 반환해도 사용자의 정정이나 캐릭터 역할을 잘못 이해할 수 있습니다. 로컬 성능은 대상 기기에서 실제 모델·문맥·재생 상태를 명시하고 측정하세요. CI 구성이나 다른 운영체제의 결과만으로 해당 플랫폼의 네이티브 사용성을 검증했다고 판단하지 않습니다.

실제 모델 동작은 다음 예제로 재검증할 수 있습니다. `local_smoke`는 지정한 폴더에 모델이 없으면 다운로드하며, `behavior_smoke`는 검증된 모델이 있어야 실행됩니다.

```sh
cargo run --manifest-path src-tauri/Cargo.toml --example local_smoke -- /absolute/path/to/model-cache
cargo run --manifest-path src-tauri/Cargo.toml --example behavior_smoke -- /absolute/path/to/model-cache
```

### 현재 한계

4B와 9B 모두 한국어 표현과 사실·정정 이해에는 오류가 남을 수 있습니다. JSON 구조 검증은 대사의 사실성을 보장하지 않습니다. 기억 분석은 짧고 완결된 사용자 발화만 후보로 삼으며, 긴 발화는 중간에서 잘라 의미를 바꾸는 대신 자동 기억에서 제외합니다. 원문 일치와 수정 이력을 코드로 검증하지만 후보 선택 자체는 모델에 의존하므로 중요한 사실은 기억 목록에서 확인해야 합니다.

친밀도는 20에서 시작합니다. 일반 대화는 직접적인 감사·모욕의 좁은 허용 목록만 ±1로 반영하고, 같은 종류의 반복 표현은 하루에 한 번만 인정합니다. 일일 절대 변동 상한은 3이며 정정·반대·부재는 점수를 낮추지 않습니다. 선택지 스토리는 일반 대화 상한과 별도로 동봉 선택의 +5/-3을 반영합니다. 미루기·닫기에는 감점이 없습니다. 모델이 점수를 직접 결정하거나 도구 기능을 잠그지 않습니다. 세부 공개 단계는 [대화 사양](docs/product/conversation.md#나디르-선택지-스토리)을 따릅니다.

## 코드와 캐릭터 콘텐츠 라이선스

Comet의 프로그램 소스 코드는 [GNU AGPL-3.0-only](LICENSE)로 제공합니다. `package.json`과 `src-tauri/Cargo.toml`에도 같은 식별자를 둡니다. 외부 의존성과 동봉 파일은 각자의 라이선스를 유지합니다.

**별꼬리 콘텐츠는 AGPL 적용 대상이 아닙니다.** 공식 Comet 배포에서 받아 개인적으로 사용할 수 있으며, 콘텐츠 수정·파생 제작과 downstream 재배포는 허용하지 않습니다. 이미지를 포함한 정확한 범위는 [별꼬리 이용 조건](examples/character-packs/byulkkori.LICENSE.txt)을 따릅니다. 소스를 수정해 재배포할 때는 이 콘텐츠를 제외해야 합니다. 작성자와 원본 URL은 [카탈로그](character-packs/catalog.json)에 빈 필드로 두었으며, 확인 전 임의의 출처를 표기하지 않습니다.

## 모델과 sidecar 라이선스

Qwen3.5-4B와 9B GGUF 모델은 Apache-2.0 라이선스를 따릅니다. 변환 모델은 Unsloth의 [4B](https://huggingface.co/unsloth/Qwen3.5-4B-GGUF)·[9B](https://huggingface.co/unsloth/Qwen3.5-9B-GGUF), 원본 정보와 라이선스는 Qwen의 [4B](https://huggingface.co/Qwen/Qwen3.5-4B)·[9B](https://huggingface.co/Qwen/Qwen3.5-9B) 저장소에서 확인할 수 있습니다.

비교용으로 추가한 모델의 GGUF 저장소는 Qwen3.8 Distill [2B](https://huggingface.co/empero-ai/Qwen3.8-2B-Distill-GGUF)·[4B](https://huggingface.co/empero-ai/Qwen3.8-4B-Distill-GGUF)·[9B](https://huggingface.co/empero-ai/Qwen3.8-9B-Distill-GGUF), Gemma 4 [E4B](https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF)·[12B](https://huggingface.co/unsloth/gemma-4-12b-it-GGUF), [Ministral 3 8B](https://huggingface.co/unsloth/Ministral-3-8B-Instruct-2512-GGUF)입니다. 각 저장소는 2026-09-17 기준 Apache-2.0으로 표기되어 있으며, 재배포 전에는 원본 모델 저장소의 라이선스를 다시 확인해야 합니다. 직접 지정한 GGUF 파일의 라이선스는 사용자가 확인합니다.

함께 사용하는 llama.cpp는 [MIT 라이선스](https://github.com/ggml-org/llama.cpp/blob/master/LICENSE)이며, sidecar 릴리스는 준비 스크립트에 고정되어 있습니다. 실행 파일이나 모델을 재배포할 때는 해당 릴리스의 라이선스와 고지를 함께 유지해야 합니다. 모델 revision 또는 sidecar release를 변경하면 해시, 의존 라이브러리, 라이선스 고지와 양쪽 운영체제 검증을 함께 갱신하세요.
