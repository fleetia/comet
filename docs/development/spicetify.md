---
title: Spotify 로컬 확장 연결
description: 설치본의 Comet 확장을 Spicetify에 연결하고 해제하는 방법과 지원 범위
---

# Comet의 선택적 Spicetify 연결

`comet.js`는 사용자가 설치한 Spotify 데스크톱과 Comet 음악 위젯을 연결하는 Spicetify 확장이다. 플레이리스트 목록·무작위 선곡·대기열·현재 곡 좋아요가 필요할 때 설치한다. 기본 macOS 앱 연결과 Windows 미디어 세션 연결은 이 확장 없이 사용한다. 음악 화면과 제공자별 계약은 [음악 사양](../product/music.md)을 따른다.

## 설치와 연결

1. Spotify 데스크톱 및 [Spicetify 공식 설치 절차](https://spicetify.app/docs/getting-started)를 완료한다. Comet이 Spotify 설치 파일을 자동으로 수정하거나 Spicetify를 설치하지 않는다.
2. Comet 음악 설정의 **Comet 확장 파일 저장**으로 `comet.js`를 저장한다. `spicetify config-dir`로 설정 폴더를 열고 그 안의 `Extensions` 폴더에 복사한다. 터미널에서 경로만 확인하려면 `spicetify -c`가 출력하는 설정 파일의 상위 폴더를 사용한다. 개발자는 저장소의 `integrations/spicetify/comet.js`를 사용할 수 있다.
3. 터미널에서 `spicetify config extensions comet.js`를 실행한다. 처음 적용할 때는 `spicetify backup apply`, 이미 원본 백업이 있으면 `spicetify apply`를 실행한다. Spotify가 다시 시작되고 내부 화면 모듈이 준비되면 프로필 메뉴에 **Comet 음악 연결**이 표시된다.
4. Comet 음악 설정에서 **Spotify + Spicetify**를 선택하고 **연결 설정 저장**을 누른다. **연결 코드 만들기**를 누른다.
5. Spotify의 **Comet 음악 연결**에 Comet이 보여 준 32자리 코드를 붙여 넣고 **연결**을 누른다. 코드는 3분 안에 한 번 연결할 수 있다. 최초 연결을 마치면 다음 실행부터 자동으로 다시 연결한다. 두 앱에서 연결 상태를 확인한다. 곡 정보는 정기 조회 때 갱신되며 **다시 조회**로 바로 확인할 수도 있다.

음악 앱을 **Spotify** 또는 **Spotify + Spicetify**로 저장하면 음악 위젯을 열 때 꺼진 Spotify를 실행한다. 이미 실행 중인 Spotify는 다시 열지 않는다. 앱 실행만 요청하며 음악을 자동 재생하지 않는다. 자동 선택 모드와 정기 조회는 Spotify를 실행하지 않는다.

Spicetify는 최초 페어링 뒤 Spotify·Comet 종료와 확장 새로고침에도 연결을 기억한다. Comet 시작 시에는 저장된 연결의 로컬 listener만 복구하며, Spotify 실행은 음악 위젯을 열 때 요청한다. Spotify가 켜져 있으면 확장이 최대 30초 간격으로 연결을 다시 시도한다. 연결 중이던 명령은 버리고 현재 정보를 새로 조회한다. 같은 컴퓨터에서 음악 위젯 하나만 확장 연결을 소유한다.

32자리 최초 코드는 메모리에만 둔다. 최초 인증 후 별도의 재연결용 인증 정보를 Comet은 OS 자격 증명 저장소에, 확장은 Spotify의 localStorage에 저장한다. DB에는 비밀이 아닌 연결 ID만 남긴다. **연결 해제**, 제공자 변경, 위젯 끄기·제거는 저장한 연결 권한을 폐기한다. 창만 닫거나 앱을 종료하는 동작은 페어링을 지우지 않는다. 새 연결 코드를 만들면 기존 연결과 진행 중인 요청을 폐기하고 새 페어링으로 교체한다.

이전 수동 재연결 버전에서 업그레이드할 때는 최신 Comet과 `comet.js`를 함께 적용한 뒤 한 번 새 코드로 연결한다. 오래된 확장은 새 인증 방식과 호환되지 않는다.

연결이 안 되면 두 앱이 같은 컴퓨터에서 실행 중인지, 18743 포트를 다른 프로그램이 사용 중인지, 코드가 만료됐는지 확인한다. 서버는 `127.0.0.1`에만 바인딩하며 Spotify 데스크톱의 `https://xpui.app.spotify.com` Origin만 허용한다. Spotify가 다른 Origin을 사용하는 버전으로 바뀌면 확인 후 코드를 갱신해야 한다. 임의 Origin을 허용하도록 우회하지 않는다.

## 지원 동작과 한계

| 동작 | 확장이 하는 일 |
| --- | --- |
| 현재 정보 | 제목·가수·앨범·앨범아트·위치·길이·볼륨·셔플·반복·좋아요 등 Spotify Player가 제공하는 값만 전송한다. Spotify 가사는 조회하지 않는다. |
| 재생 제어 | 재생·일시정지·이전·다음·탐색·볼륨·셔플·반복과 특정 트랙·에피소드 URI 재생을 요청한다. |
| 플레이리스트 | Rootlist 트리에서 폴더 안의 목록까지 찾고 100개씩 반환한다. 곡 목록은 100개씩 조회한다. |
| 무작위 재생 | 선택한 플레이리스트의 모든 페이지를 읽은 뒤 재생 가능한 항목 중 하나를 균등하게 뽑아 재생한다. 같은 곡이 여러 번 들어 있으면 각 등록 항목을 따로 센다. 전체를 읽지 못하면 부분 목록에서 임의로 재생하지 않는다. |
| 대기열 | Spotify가 제공한 다음 곡 중 최대 100개를 표시하고 지정한 트랙·에피소드를 대기열 끝에 추가한다. Spotify 내부 대기열 전체의 삭제·재정렬은 지원하지 않는다. |
| 좋아요 | 화면에서 요청한 URI가 여전히 현재 곡일 때만 좋아요를 변경한다. 곡이 바뀌었으면 취소한다. |

한 플레이리스트는 최대 10,000개 등록 항목, Rootlist는 폴더를 포함해 최대 10,000개 노드, 요청은 20초로 제한한다. 큰 목록·느린 응답·지원하지 않는 API는 오류로 표시한다. 로컬 파일 URI는 전달하지 않는다. Spotify 자체 재생 제한·콘텐츠 이용 가능 여부·네트워크 연결은 그대로 적용된다.

재생 제어는 Spotify Player의 상태에 변경이 반영된 뒤 완료한다. 내부 API 호출이 반환돼도 상태가 아직 바뀌지 않았으면 기존 요청 시간 안에서 기다린다. 대기 중 취소·만료·연결 해제를 확인하며, 반영을 확인하지 못한 명령을 성공으로 표시하지 않는다.

Spicetify의 `Platform`은 Spotify 내부 API를 감싼다. Spotify·Spicetify 업데이트에 따라 기능이 달라지거나 확장을 다시 적용해야 할 수 있다. 이 구현은 아래 공식 Spicetify 문서와 제공 예제에 근거했으며 실제 설치 버전·계정에서 모든 동작을 검증했다는 뜻은 아니다. 데스크톱 실측 여부는 [상태표](../status.md)에 남긴다.

## 연결 경계

Rust 서버는 `src-tauri/src/music_bridge.rs`가 소유한다. 최초에는 **연결 코드 만들기**로 시작하고, 이후에는 설치·활성 상태인 Spicetify 위젯에 저장된 연결 ID가 있을 때만 복구한다. WebSocket Host·Origin·경로를 함께 검사한다. 최초 코드와 재연결 secret은 Spotify 로그인·OAuth 토큰과 관계없다. 확장은 Spotify 자격 증명이나 세션 토큰을 읽어 Comet으로 보내지 않는다.

프로토콜 v2는 매 연결마다 양쪽 난수와 역할·연결 ID·인증 모드를 묶은 HMAC-SHA256 증명을 교환한다. 최초 코드나 재연결 secret을 재접속 메시지로 보내지 않으며 확장도 서버 증명을 확인한 뒤에만 명령을 수락한다. 최초 인증에서 발급하는 256비트 재연결 secret은 저장 성공 후 사용한다. Comet의 keyring 항목은 위젯 ID와 페어링 ID에 묶이며, 해제 시 DB의 복구 권한부터 제거하므로 늦은 저장·삭제가 새 페어링을 바꾸지 않는다. OS 저장소 접근 실패는 연결 오류로 표시한다.

프로토콜은 고정된 음악 요청만 전달하며 원격 코드·URL·셸 명령을 실행하지 않는다. 프레임과 응답은 128KiB, 진행 중인 요청은 8개로 제한한다. 전송하는 곡 정보와 목록은 명시한 필드만 추려 다시 검증한다. 표제·설명은 일반 텍스트이고 이미지 URL은 Spotify 이미지 호스트만 허용한다.

요청은 연결 세대·위젯 소유자·만료 시각에 묶인다. Comet에서 요청을 취소하면 확장에 취소 메시지를 보내며 확장은 모든 비동기 조회 이후, 변경 명령 직전에 유효성을 확인한다. 연결이 끊기면 대기 중인 명령을 재전송하지 않는다. 이미 Spotify에 전달된 변경을 취소하거나 되돌릴 수는 없다. Spotify renderer의 다른 확장이나 같은 사용자 권한의 프로그램으로부터 localStorage를 격리하는 보안 경계는 아니다.

## 제거

Comet 음악 제공자를 다른 연결로 바꾸거나 음악 위젯을 끄면 저장된 연결 권한이 폐기된다. Spotify에서도 **Comet 음악 연결 → 연결 해제**를 사용할 수 있다. Comet이 꺼져 있으면 확장은 해제 대기를 저장하고 다음 인증에서는 해제만 요청한다. 해제 완료 응답이 유실되면 해제 대기 표시가 남을 수 있으며, 새 코드로 명시적으로 페어링하면 새 연결로 교체할 수 있다. 확장을 제거하려면 먼저 연결을 해제한 뒤 `spicetify config extensions comet.js-`와 `spicetify apply`를 실행하고 복사했던 `Extensions/comet.js`를 삭제한다. 다른 확장과 Spotify 계정·음악 보관함은 삭제하지 않는다.

## 실계정 확인 순서

Spotify 설치·로그인을 마친 뒤 아래 순서로 확인한다. 2026-09-21에 보류했던 검증은 2026-09-22 사용자 요청으로 재개했다. 버전별 실제 결과와 남은 항목은 [상태표](../status.md)에 기록한다.

1. 위 설치 절차로 확장을 연결하고 실제 곡 정보가 표시되는지 확인한다.
2. 위젯의 재생·일시정지·이전/다음·탐색·음량·셔플·반복을 조작한다. Comet의 버튼·상태와 Spotify의 실제 상태를 대조한다. 명령 직후 수동 새로고침 없이 반영되는지도 확인한다. 탐색은 중간 위치와 곡 끝을 포함한다.
3. 100곡을 넘는 플레이리스트에서 **곡 더 보기**로 다음 페이지를 확인한 뒤 곡 선택과 **랜덤 한 곡 재생**을 실행한다. 곡의 **큐에 추가**를 누르고 두 앱의 대기열에 같은 곡이 나타나는지 확인한다. 현재 곡의 좋아요를 바꾸고 확인한 뒤 기존 상태로 복원한다.
4. 두 탭의 곡 요약과 재생 제어가 동일한 위치에 유지되는지 확인한다.
5. Spotify만 종료한 뒤 음악 위젯을 다시 열어 자동 실행·자동 재연결을 확인한다. Comet만 종료했다가 다시 켠 경우에도 코드를 다시 입력하지 않고 연결되는지 확인한다. 두 앱이 일시정지였으면 재연결 뒤에도 일시정지인지 확인한다.
6. 요청 중 연결을 끊었다가 자동 재연결해 이전 요청이 재실행되지 않는지 확인한다. **연결 해제** 뒤에는 두 앱을 다시 열어도 페어링이 복구되지 않고 새 코드가 필요한지 확인한다.

Spotify의 메뉴가 나타나지 않으면 최신 `comet.js`를 다시 복사해 적용한다. Spicetify 2.45.1에서는 메뉴 API가 먼저 노출되고 React 모듈은 나중에 준비된다. 이전 확장이 `Cannot read properties of undefined (reading 'jsx')`로 중단된 경우 연결 코드나 포트 변경으로 해결되지 않는다. 수정된 확장은 메뉴에 필요한 모듈을 기다린다.

## 개발 검증

저장소 루트에서 기존 Vitest로 `./node_modules/.bin/vitest run --config integrations/spicetify/vitest.config.mjs`를 실행한다. Node VM 안의 모의 Spotify Player·WebSocket으로 페이지 전체 무작위 선택, 중간 취소, 이전 연결의 늦은 응답, 상호 인증·저장 실패·재연결·오프라인 해제를 확인한다. Rust는 `cargo test --manifest-path src-tauri/Cargo.toml --lib music_bridge::tests`로 실제 loopback WebSocket 인증·재연결·요청·취소·소유자 격리를 확인하며 소켓 바인딩이 허용된 환경이 필요하다. Rust 테스트의 자격 증명 저장은 메모리 대역으로 실제 사용자 keyring을 수정하지 않는다. macOS 실행 분기는 `node --test src-tauri/src/widgets/music_native/macos.test.mjs`로 검사한다. 이 테스트들은 Spotify 실제 실행과 OS 저장소 검증을 대신하지 않는다.

참고: [Player API](https://spicetify.app/docs/development/api-wrapper/methods/player), [Platform 안정성](https://spicetify.app/docs/development/api-wrapper/methods/platform), [Queue](https://spicetify.app/docs/development/api-wrapper/properties/queue), [addToQueue](https://spicetify.app/docs/development/api-wrapper/functions/add-to-queue), [공식 WebNowPlaying 예제](https://github.com/spicetify/cli/blob/main/Extensions/webnowplaying.js), [공식 Shuffle+ 예제](https://github.com/spicetify/cli/blob/main/Extensions/shuffle%2B.js).
