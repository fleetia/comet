---
title: Spotify 로컬 확장 연결
description: 설치본의 Comet 확장을 Spicetify에 연결하고 해제하는 방법과 지원 범위
---

# Comet의 선택적 Spicetify 연결

`comet.js`는 사용자가 설치한 Spotify 데스크톱과 Comet 음악 위젯을 연결하는 Spicetify 확장이다. 플레이리스트 목록·무작위 선곡·대기열·현재 곡 좋아요가 필요할 때 설치한다. 기본 macOS 앱 연결과 Windows 미디어 세션 연결은 이 확장 없이 사용한다. 음악 화면과 제공자별 계약은 [음악 사양](../product/music.md)을 따른다.

## 설치와 연결

1. Spotify 데스크톱 및 [Spicetify 공식 설치 절차](https://spicetify.app/docs/getting-started)를 완료한다. Comet이 Spotify 설치 파일을 자동으로 수정하거나 Spicetify를 설치하지 않는다.
2. Comet 음악 설정의 **Comet 확장 파일 저장**으로 `comet.js`를 저장한다. `spicetify config-dir`로 설정 폴더를 확인하고 그 안의 `Extensions` 폴더에 복사한다. 개발자는 이 디렉터리의 동일한 파일을 사용할 수 있다.
3. 터미널에서 `spicetify config extensions comet.js`를 실행한 뒤 `spicetify apply`를 실행한다. Spotify가 다시 시작되면 프로필 메뉴에 **Comet 음악 연결**이 표시된다.
4. Comet 음악 설정에서 **Spotify · Spicetify**를 선택하고 저장한다. **연결 코드 만들기**를 누른다.
5. Spotify의 **Comet 음악 연결**에 Comet이 보여 준 32자리 코드를 붙여 넣고 **연결**을 누른다. 코드는 3분 안에 한 번 연결할 수 있다. 두 앱에서 연결 상태를 확인하고 Comet의 새로고침을 누른다.

코드와 연결 상태는 파일·localStorage·계정에 저장되지 않는다. 앱 종료·확장 새로고침·연결 해제 뒤에는 새 코드를 만들어 다시 연결한다. 이미 연결한 상태에서 새 코드를 만들면 이전 연결과 진행 중인 요청이 취소된다. 같은 컴퓨터에서 음악 위젯 하나만 확장 연결을 소유한다.

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

Spicetify의 `Platform`은 Spotify 내부 API를 감싼다. Spotify·Spicetify 업데이트에 따라 기능이 달라지거나 확장을 다시 적용해야 할 수 있다. 이 구현은 아래 공식 Spicetify 문서와 제공 예제에 근거했으며 실제 설치 버전·계정에서 모든 동작을 검증했다는 뜻은 아니다. 데스크톱 실측 여부는 [상태표](../status.md)에 남긴다.

## 연결 경계

Rust 서버는 `src-tauri/src/music_bridge.rs`가 소유한다. **연결 코드 만들기** 요청 전에는 서버를 시작하지 않는다. 128비트 무작위 코드를 첫 메시지로 확인하고, WebSocket Host·Origin·경로를 함께 검사한다. 이 코드는 Spotify 로그인·OAuth 토큰과 관계없다. 확장은 Spotify 자격 증명이나 세션 토큰을 읽어 Comet으로 보내지 않는다.

프로토콜은 고정된 음악 요청만 전달하며 원격 코드·URL·셸 명령을 실행하지 않는다. 프레임과 응답은 128KiB, 진행 중인 요청은 8개로 제한한다. 전송하는 곡 정보와 목록은 명시한 필드만 추려 다시 검증한다. 표제·설명은 일반 텍스트이고 이미지 URL은 Spotify 이미지 호스트만 허용한다.

요청은 연결 세대·위젯 소유자·만료 시각에 묶인다. Comet에서 요청을 취소하면 확장에 취소 메시지를 보내며 확장은 모든 비동기 조회 이후, 변경 명령 직전에 유효성을 확인한다. 연결이 끊기면 대기 중인 명령을 재전송하지 않는다. 이미 Spotify에 전달된 변경을 취소하거나 되돌릴 수는 없다. 프로세스가 이미 손상됐거나 같은 사용자 권한으로 연결 코드를 훔칠 수 있는 악성 프로그램까지 격리하는 보안 경계는 아니다.

## 제거

Comet 음악 제공자를 다른 연결로 바꾸거나 음악 위젯을 끄면 로컬 연결이 무효화된다. Spotify에서도 **Comet 음악 연결 → 연결 해제**를 사용할 수 있다. 확장을 제거하려면 `spicetify config extensions comet.js-`와 `spicetify apply`를 실행한 뒤 복사했던 `Extensions/comet.js`를 삭제한다. 다른 확장과 Spotify 계정·음악 보관함은 삭제하지 않는다.

## 실계정 확인 순서

2026-09-21에는 사용자 요청으로 Spotify 실계정 검증을 보류했다. 집에서 설치·로그인을 마친 뒤 다음을 확인한다.

1. 위 설치 절차로 확장을 연결하고 실제 곡 정보가 표시되는지 확인한다.
2. 위젯의 재생·일시정지·이전/다음·탐색·음량·셔플·반복을 조작한다.
3. 여러 페이지가 있는 플레이리스트에서 곡 선택과 랜덤 곡 재생, 대기열 조회·추가와 현재 곡 좋아요를 확인한다.
4. 두 탭의 곡 요약과 재생 제어가 동일한 위치에 유지되는지 확인한다.
5. 요청 중 연결을 해제하고 새 코드로 다시 연결한 뒤 이전 요청이 재실행되지 않는지 확인한다.

## 개발 검증

저장소 루트에서 기존 Vitest로 `./node_modules/.bin/vitest run --config integrations/spicetify/vitest.config.mjs`를 실행한다. Node VM 안의 모의 Spotify Player·WebSocket으로 페이지 전체 무작위 선택, 중간 취소, 이전 연결의 늦은 응답, 만료와 입력 검증을 확인한다. Rust는 `cargo test --manifest-path src-tauri/Cargo.toml --lib music_bridge::tests`로 실제 loopback WebSocket 인증·요청·취소·소유자 격리를 확인하며 소켓 바인딩이 허용된 환경이 필요하다. 이 테스트들은 Spotify 실제 재생 검증을 대신하지 않는다.

참고: [Player API](https://spicetify.app/docs/development/api-wrapper/methods/player), [Platform 안정성](https://spicetify.app/docs/development/api-wrapper/methods/platform), [Queue](https://spicetify.app/docs/development/api-wrapper/properties/queue), [addToQueue](https://spicetify.app/docs/development/api-wrapper/functions/add-to-queue), [공식 WebNowPlaying 예제](https://github.com/spicetify/cli/blob/main/Extensions/webnowplaying.js), [공식 Shuffle+ 예제](https://github.com/spicetify/cli/blob/main/Extensions/shuffle%2B.js).
