---
title: 앱 릴리스와 업데이트
description: 두 운영체제의 서명된 업데이트 파일, GitHub Releases와 최초 배포 준비
---

# 앱 릴리스와 업데이트

Comet 앱을 macOS Apple Silicon과 Windows x64에 함께 배포하는 절차입니다. 앱은 시작할 때와 실행 중 24시간마다 새 버전을 확인하며, 사용자가 `설치하고 다시 시작`을 선택해야 내려받기와 설치를 진행합니다. 캐릭터팩은 [갤러리](../product/character-gallery.md)에서 수동으로 설치하며 앱 업데이트에 종속된 원격 갱신 기능은 제공하지 않습니다.

2026-09-19 기준 업데이트 key pair와 GitHub Actions의 signing secret·공개키 variable은 등록했습니다. 별도 macOS QA 앱에서 전용 키·loopback 서버를 통한 0.4.0→0.4.1 설치와 오류 처리를 확인했으며 세부 증거와 제한은 [구현 상태](../status.md)를 따릅니다. 최초 공개 릴리스, 공식 GitHub 배포 채널과 Windows 실제 설치는 아직 인수 전입니다. 키 등록만으로 업데이트가 운영 중이라고 표시하지 않습니다. 키가 없는 별도 개발 빌드는 업데이트 확인 대신 설정되지 않았다는 상태를 표시합니다.

## 서명과 배포 대상

| 항목 | 계약 |
| --- | --- |
| macOS | macOS 14 이상 Apple Silicon. updater 파일은 `.app.tar.gz`와 `.sig` |
| Windows | x64 NSIS `.exe`와 `.sig`. WebView2가 없으면 installer가 설치 |
| 확인 주소 | `https://github.com/fleetia/comet/releases/latest/download/latest.json` |
| 업데이트 신뢰 | 앱에 포함된 Tauri updater 공개키로 내려받은 파일의 서명을 검증 |
| macOS OS 서명 | 현재 ad-hoc 서명. Developer ID 서명과 notarization 미완료 |
| Windows OS 서명 | Authenticode 인증서 서명 미구성 |

Updater 서명은 Apple notarization이나 Windows Authenticode 서명을 대체하지 않습니다. macOS의 현재 `hardenedRuntime: false`는 ad-hoc sidecar 실행 구성입니다. Developer ID 배포로 변경할 때는 앱·sidecar·dylib 전체의 서명과 hardened runtime을 함께 검증합니다.

## 최초 설정

저장소 루트에서 Tauri CLI로 업데이트 전용 key pair를 만들고 개인키는 저장소 밖에 보관합니다. 개인키·암호는 로그에 출력하거나 저장소에 커밋하지 않습니다. 개인키를 잃으면 그 키를 신뢰하는 기존 설치본에 같은 경로로 새 업데이트를 제공할 수 없습니다.

GitHub 저장소에는 다음 값을 등록합니다.

| 위치 | 이름 | 값 |
| --- | --- | --- |
| Actions variable | `TAURI_UPDATER_PUBLIC_KEY` | Tauri signer로 만든 공개키 파일의 내용 |
| Actions secret | `TAURI_SIGNING_PRIVATE_KEY` | 개인키 파일의 내용 |
| Actions secret | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 개인키 암호. 암호 없는 키라면 비워 둠 |

공개키는 `src-tauri/tauri.conf.json`의 `plugins.updater.pubkey`에도 같은 값으로 저장할 수 있습니다. release workflow는 variable의 공개키와 `createUpdaterArtifacts: true`를 build config로 주입합니다. 기본 config는 서명 없는 개발·검증 빌드를 위해 updater artifact 생성을 끕니다. 공개키만 있는 일반 빌드는 업데이트 확인이 가능하지만 signed release artifact를 생성하지는 않습니다.

공개 릴리스 파일은 로그인 없이 읽을 수 있어야 합니다. GitHub 저장소를 공개하기 전에 Git history, 예제, workflow 로그·artifact와 각 콘텐츠 이용 조건을 검토합니다. `@fleetia/lagrange`를 포함한 build dependency 접근 권한도 소스 공개와 별도로 확인합니다. GitHub Packages의 `@fleetia/lagrange` 설정에서 `Manage Actions access`에 `comet` 저장소의 Read 권한을 허용해야 CI의 `GITHUB_TOKEN`으로 설치할 수 있습니다. 패키지를 public으로 바꿔도 npm registry는 설치 인증을 요구합니다. 로컬 개발자는 `read:packages`가 있는 personal access token (classic)으로 로그인합니다.

## 버전 배포

1. `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`의 버전을 일치시킵니다. `Cargo.lock`도 갱신합니다.
2. 같은 버전의 `vX.Y.Z` tag를 게시하거나 `Release desktop` workflow에 이미 존재하는 tag를 입력합니다. workflow는 tag와 세 파일의 버전이 다르면 중단합니다.
3. `.github/workflows/release.yml`이 draft release를 만들고 macOS·Windows 각각 frontend/Rust 검사와 sidecar 준비, signed updater build를 수행합니다. 비공개 개인키는 release build 단계에만 전달합니다.
4. 두 build가 모두 성공해야 publish job이 실행됩니다. `latest.json`의 두 플랫폼, 버전, 해당 tag의 실제 artifact와 `.sig` 파일을 확인한 뒤 release를 공개합니다. 실패하면 draft로 남깁니다. 이미 공개된 release를 덮어쓰지 않습니다.
5. 실제 이전 설치본에서 새 버전 확인·사용자 승인·설치·재시작을 두 OS에서 확인합니다. 대화, 캐릭터, 위젯, 기억과 API 설정 보존을 함께 확인합니다.

최초 updater 탑재 버전은 기존 앱에 업데이트 기능이 없으므로 수동 설치합니다. 자동 업데이트가 동작하는지 확인하려면 최초 설치 버전보다 높은 두 번째 signed 버전이 필요합니다. 일반 CI artifact 업로드나 build 성공만으로 업데이트 설치 검증을 완료했다고 보지 않습니다.

## 오류와 복구

네트워크 오류, 아직 없는 release, 플랫폼 파일 누락과 서명 오류는 설치로 넘어가지 않습니다. 오류 상태에서 사용자가 다시 확인할 수 있으며 빠른 자동 재시도를 하지 않습니다. 확인과 설치는 하나씩만 실행하고, 사용자가 승인한 버전과 준비된 버전이 다르면 재확인을 요구합니다.

앱 작업 중단과 sidecar 정리는 다운로드와 서명 검증이 끝난 뒤 설치 전에 실행합니다. Windows updater는 installer를 실행하면서 현재 프로세스를 직접 종료하므로 종료 event만 기다려 cleanup하지 않습니다. macOS는 설치 후 Tauri restart 경로를 사용합니다. 일반 종료 경로가 restart exit code를 덮어쓰지 않아야 합니다.

서명 키를 바꾸거나 업데이트 주소를 바꾸는 작업은 기존 설치본의 신뢰·이전 경로를 함께 설계합니다. 버전 비교를 꺼서 강제로 downgrade하지 않습니다. 이미 공개한 release에 문제가 있으면 더 높은 수정 버전을 준비하고, 기존 사용자 데이터가 이전 schema로 되돌아간다고 가정하지 않습니다.

공식 동작의 기준은 [Tauri Updater](https://v2.tauri.app/plugin/updater/)와 [Tauri Action](https://github.com/tauri-apps/tauri-action)입니다.
