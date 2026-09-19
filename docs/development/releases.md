---
title: 앱 릴리스와 업데이트
description: 두 운영체제의 서명된 업데이트 파일, GitHub Releases와 최초 배포 준비
---

# 앱 릴리스와 업데이트

Comet 앱을 macOS Apple Silicon과 Windows x64에 함께 배포하는 절차입니다. 앱은 시작할 때와 실행 중 24시간마다 새 버전을 확인하며, 사용자가 `설치하고 다시 시작`을 선택해야 내려받기와 설치를 진행합니다. 캐릭터팩은 [갤러리](../product/character-gallery.md)에서 수동으로 설치하며 앱 업데이트에 종속된 원격 갱신 기능은 제공하지 않습니다.

2026-09-19에 첫 signed updater 릴리스 [v0.5.0](https://github.com/fleetia/comet/releases/tag/v0.5.0)을 공개했습니다. macOS DMG·Windows EXE의 비로그인 접근과 공개 `latest.json`의 두 OS 다운로드 주소를 확인했습니다. 공식 GitHub 배포 채널을 통한 이전 버전에서 새 버전으로의 업데이트 설치와 Windows 실제 설치·실행은 아직 인수 전입니다. 별도 macOS QA 앱에서 전용 키·loopback 서버를 통한 0.4.0→0.4.1 설치와 오류 처리를 확인한 기록과 제한은 [구현 상태](../status.md)를 따릅니다. 키가 없는 별도 개발 빌드는 업데이트 확인 대신 설정되지 않았다는 상태를 표시합니다.

## 서명과 배포 대상

| 항목 | 계약 |
| --- | --- |
| macOS | macOS 14 이상 Apple Silicon. 수동 설치는 `.dmg`, updater 파일은 `.app.tar.gz`와 `.sig` |
| Windows | x64 NSIS `.exe`와 `.sig`. WebView2가 없으면 installer가 설치 |
| 확인 주소 | `https://github.com/fleetia/comet/releases/latest/download/latest.json` |
| 업데이트 신뢰 | 앱에 포함된 Tauri updater 공개키로 내려받은 파일의 서명을 검증 |
| macOS OS 서명 | 현재 ad-hoc 서명. Developer ID 서명과 notarization 미완료 |
| Windows OS 서명 | Authenticode 인증서 서명 미구성 |

Updater 서명은 Apple notarization이나 Windows Authenticode 서명을 대체하지 않습니다. macOS의 현재 `hardenedRuntime: false`는 ad-hoc sidecar 실행 구성입니다. Developer ID 배포로 변경할 때는 앱·sidecar·dylib 전체의 서명과 hardened runtime을 함께 검증합니다.

## 검증용 설치 파일 받기

[Verify desktop](https://github.com/fleetia/comet/actions/workflows/verify.yml)은 main push와 main 대상 pull request 때 실행합니다. PR에서는 프론트엔드와 두 OS의 Rust 테스트까지 실행하고, main push와 수동 실행에서 설치 파일도 만듭니다. 일반 branch push·tag push로 중복 실행하지 않으며, `docs/`·`wiki/`·`.changeset/`·루트 Markdown·LICENSE만 바뀌면 생략합니다. PR의 설치물을 미리 확인하려면 Actions 화면의 `Run workflow`에서 해당 branch를 고릅니다. 수동 실행은 변경 경로와 관계없이 전체 검증·패키징을 수행합니다. 성공한 main·수동 실행의 Artifacts에서 다음 파일을 받습니다. 다운로드에는 GitHub 로그인이 필요하며 검증용 artifact는 7일 보관합니다.

| Artifact | 포함 파일 |
| --- | --- |
| `comet-arm64-macOS` | Apple Silicon `.dmg`와 `.app` ZIP |
| `comet-x64-Windows` | Windows x64 NSIS `.exe` |

macOS는 `app,dmg`, Windows는 `nsis` bundle을 생성합니다. macOS 앱 서명과 `hdiutil verify`의 DMG 무결성 검사를 통과해야 artifact를 올립니다. 이 workflow는 Release를 공개하거나 updater manifest를 게시하지 않습니다.

### CI 실행과 캐시

프론트엔드 검사·테스트는 Ubuntu에서 한 번 실행하고, 성공해야 두 native job을 시작합니다. PR에서는 Ubuntu에서 production 프론트엔드 빌드도 검사합니다. Rust 테스트는 PR을 포함한 모든 실행에서 두 OS 각각 수행합니다. release 모드 컴파일·패키징 비용을 줄이기 위해 PR에서는 설치물 생성을 생략하며, 패키징 오류는 main 또는 수동 실행에서 확인합니다. Tauri의 `beforeBuildCommand`가 프론트엔드를 빌드하므로 native job에서 `pnpm build`를 별도로 반복하지 않습니다. Release는 Ubuntu prepare에서 공통 검사를 마친 뒤 두 OS를 빌드하며, 서명·설치물 검증을 모두 통과해야 공개합니다.

pnpm store 캐시는 lockfile 기준으로 유지합니다. `Swatinem/rust-cache`는 OS·아키텍처·toolchain·Cargo manifest/lock에 맞는 registry와 컴파일된 의존성을 복원하며, Verify와 Release가 같은 키를 사용합니다. Sidecar는 OS·아키텍처·`scripts/prepare-sidecar.mjs` 전체 hash가 같은 경우만 준비된 파일을 복원합니다. 캐시가 없으면 기존 SHA-256 검증·라이선스 동봉 절차로 다시 준비합니다. Rust·sidecar 캐시는 main 실행에서만 저장하여 PR별 대형 캐시가 쌓이지 않게 합니다. PR과 태그 Release는 main 캐시를 읽으며, 서명용 secret·설정 파일과 최종 설치물은 이 캐시에 저장하지 않습니다. Rust 의존성 캐시의 키와 정리 범위는 [공식 action](https://github.com/Swatinem/rust-cache)을 따릅니다.

`Version and release`의 PR 검사는 변경셋·버전·배포 스크립트·workflow 등 관련 경로가 바뀔 때 실행하고 오래된 PR 실행은 취소합니다. main에서는 모든 push를 처리해 버전 PR을 최신 상태로 유지하며, 진행 중인 배포는 취소하지 않습니다. 경로 필터로 생략되는 workflow를 필수 PR check로 등록하면 해당 check가 pending으로 남을 수 있으므로 보호 규칙을 추가할 때 실행 조건도 함께 조정합니다.

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

1. 사용자에게 전달할 변경과 함께 루트에서 `pnpm changeset`을 실행합니다. `comet`와 patch·minor·major 수준을 선택하고 한국어 업데이트 노트를 작성한 뒤 `.changeset/*.md`를 같은 PR에 포함합니다. 문서·내부 정리만 바꾸면 변경셋을 생략할 수 있습니다.
2. main에 병합하면 `Version and release` workflow가 `changeset-release/main` 브랜치의 버전 PR을 만들거나 갱신합니다. Changesets가 `package.json`과 `CHANGELOG.md`를 갱신하고 `pnpm version:release`가 Tauri JSON·Cargo manifest·Cargo.lock의 앱 버전을 함께 맞춥니다. 직접 네 파일의 버전을 편집하지 않습니다.
3. 버전 PR에서 버전·업데이트 노트·실기 인수 상태를 검토하고 병합합니다. main workflow는 해당 버전의 CHANGELOG 항목과 네 파일의 일치를 확인하고 `vX.Y.Z` 태그를 고정한 뒤 `Release desktop`을 직접 호출합니다. GitHub 기본 토큰이 만든 tag push가 다음 workflow를 실행하지 않는 제한을 이 직접 호출로 처리합니다. 새 토큰이나 npm publish 권한은 필요하지 않습니다.
4. `Release desktop`은 태그를 checkout하고 Ubuntu에서 프론트엔드 검사를 통과한 뒤 해당 CHANGELOG 항목을 담은 draft release를 만듭니다. macOS·Windows 각각 Rust 검사와 sidecar 준비, signed updater build를 수행합니다. 비공개 개인키는 release build 단계에만 전달합니다.
5. 두 build가 모두 성공해야 publish job이 실행됩니다. 수동 설치용 `.dmg`·`.exe`와 `latest.json`의 두 플랫폼, 버전, 해당 tag의 실제 artifact와 `.sig` 파일을 확인합니다. Release의 `tagName`과 저장소를 대조하고, draft의 `untagged-…` 주소는 해당 draft URL과 일치할 때만 허용합니다. Tauri Action의 API 자산 URL과 draft 임시 주소는 같은 release의 정식 태그 다운로드 URL로 정규화하고 CHANGELOG 본문을 `latest.json.notes`에도 반영한 뒤 manifest를 다시 올립니다. 실제 업로드된 설치 파일의 다운로드 링크와 OS별 설치 안내를 변경 노트 앞에 추가한 뒤 release를 공개하며, 같은 내용을 Actions 실행 요약에도 남깁니다. Windows `.exe`는 수동 설치와 updater가 함께 사용합니다. 실패하면 draft로 남깁니다. 이미 공개된 release를 덮어쓰지 않습니다.
6. 실제 이전 설치본에서 새 버전 확인·사용자 승인·설치·재시작을 두 OS에서 확인합니다. 대화, 캐릭터, 위젯, 기억과 API 설정 보존을 함께 확인합니다.

`.changeset/config.json`은 private 앱의 버전 관리를 켜고 npm 게시와 Changesets의 별도 태그 생성은 사용하지 않습니다. 정식 `X.Y.Z` 버전만 지원합니다. version PR 자동 생성에는 저장소의 `Actions → General → Allow GitHub Actions to create and approve pull requests` 설정이 필요하며, Comet에서는 활성화되어 있습니다. GitHub가 bot PR의 CI 승인을 요구하면 해당 실행을 승인합니다. Release workflow는 버전 PR의 CI와 별도로 최종 태그에서 두 OS 검사를 다시 수행합니다.

변경셋이 남아 있으면 버전 PR 갱신만 수행합니다. CHANGELOG가 아직 없는 초기 상태나 이미 공개한 버전에서는 새 Release를 만들지 않습니다. 동일 태그를 다른 커밋으로 옮기는 요청은 실패합니다. 실패한 draft는 같은 실행을 재시도하거나 `Release desktop → Run workflow`에 기존 태그를 입력해 재개합니다. 새 버전이 필요하면 새 변경셋을 작성합니다.

로컬 배포 보조 명령에는 Python 3.11 이상이 필요합니다. `pnpm release:check`로 버전 일치, `pnpm test:release`로 동기화·노트 추출·태그 보호·updater manifest를 검사합니다. `pnpm version:release`는 변경셋을 소비하므로 평소 개발 브랜치에서 미리 실행하지 않습니다.

최초 updater 탑재 버전은 기존 앱에 업데이트 기능이 없으므로 수동 설치합니다. 자동 업데이트가 동작하는지 확인하려면 최초 설치 버전보다 높은 두 번째 signed 버전이 필요합니다. 일반 CI artifact 업로드나 build 성공만으로 업데이트 설치 검증을 완료했다고 보지 않습니다.

## 오류와 복구

네트워크 오류, 아직 없는 release, 플랫폼 파일 누락과 서명 오류는 설치로 넘어가지 않습니다. 오류 상태에서 사용자가 다시 확인할 수 있으며 빠른 자동 재시도를 하지 않습니다. 확인과 설치는 하나씩만 실행하고, 사용자가 승인한 버전과 준비된 버전이 다르면 재확인을 요구합니다.

앱 작업 중단과 sidecar 정리는 다운로드와 서명 검증이 끝난 뒤 설치 전에 실행합니다. Windows updater는 installer를 실행하면서 현재 프로세스를 직접 종료하므로 종료 event만 기다려 cleanup하지 않습니다. macOS는 설치 후 Tauri restart 경로를 사용합니다. 일반 종료 경로가 restart exit code를 덮어쓰지 않아야 합니다.

서명 키를 바꾸거나 업데이트 주소를 바꾸는 작업은 기존 설치본의 신뢰·이전 경로를 함께 설계합니다. 버전 비교를 꺼서 강제로 downgrade하지 않습니다. 이미 공개한 release에 문제가 있으면 더 높은 수정 버전을 준비하고, 기존 사용자 데이터가 이전 schema로 되돌아간다고 가정하지 않습니다.

공식 동작의 기준은 [Changesets](https://changesets.dev/guide/beyond-npm), [Changesets Action](https://github.com/changesets/action), [Tauri Updater](https://v2.tauri.app/plugin/updater/)와 [Tauri Action](https://github.com/tauri-apps/tauri-action)입니다.
