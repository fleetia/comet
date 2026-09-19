---
title: 문서와 위키 운영
description: 저장소 Markdown을 원본으로 사용하는 Docusaurus 위키의 설치·미리보기·빌드·수정 방법
---

# 문서와 위키 운영

comet의 사양은 저장소 `docs/`에서 관리한다. `wiki/`의 Docusaurus가 이 디렉터리를 직접 읽어 같은 내용을 웹으로 보여 준다. 이 페이지는 문서 작성자와 개발자가 로컬 위키를 실행하고 변경 결과를 검증할 때 사용한다.

## 구성

| 위치 | 역할 |
| --- | --- |
| `docs/index.md` | 위키 첫 화면과 사양 탐색 입구 |
| `docs/product/` | 바탕화면·캐릭터·대화·대본·토이·생활 도구 사양 |
| `docs/widgets/` | 외부 위젯 계약과 작성 안내 |
| `docs/development/` | 구조·개발 순서·문서 운영 |
| `docs/status.md` | 변경별 소스 구현과 검증 범위 |
| `docs/PRODUCT.md`, `docs/VALIDATION-*.md` | 기존 0.2 기준과 각 변경 시점의 검증 기록 |
| `wiki/docusaurus.config.ts`, `wiki/sidebars.ts` | 사이트 설정과 문서 목차 |
| `wiki/package.json`, `wiki/pnpm-lock.yaml` | 위키 전용 의존성과 고정 버전 |
| `wiki/build/` | 생성되는 정적 사이트. 직접 수정하지 않음 |

Docusaurus 3.10.2의 기본 문서 테마를 사용한다. 문서 사이트는 데스크톱 앱과 별개이며 위키의 Node.js·React 의존성을 앱 설치물에 넣지 않는다. 한국어·영어 로컬 검색은 `@easyops-cn/docusaurus-search-local` 0.55.3으로 빌드할 때 생성한다. 검색 서버나 계정은 필요하지 않으며, 전문 검색 엔진 수준의 한국어 의미 검색을 보장하지 않는다.

## 설치와 미리보기

전제: Node.js 24와 Corepack을 사용할 수 있어야 한다. 고정 패키지 관리자는 pnpm 10.32.1이다. 전역에 설치된 다른 pnpm 대신 아래처럼 `corepack pnpm`을 사용한다.

프로젝트 루트에서 실행한다.

```sh
cd /Users/tracycho/Dev/fleetia/comet
corepack pnpm docs:install
corepack pnpm docs:dev
```

브라우저에서 `http://127.0.0.1:3000`을 연다. 개발 서버는 문서 수정 결과를 반영한다. 같은 포트를 이미 사용 중이면 해당 서버를 먼저 확인한다. 문서 편집만 할 때는 Rust·모델·llama.cpp 실행기가 필요하지 않다.

## 빌드와 확인

```sh
corepack pnpm docs:check
corepack pnpm docs:build
corepack pnpm docs:serve
```

`docs:check`는 위키 TypeScript 설정을 검사한다. `docs:build`는 Markdown/MDX 처리, 사이드바와 내부 링크 검사를 거쳐 `wiki/build/`에 정적 사이트를 만든다. `docs:serve`는 그 결과를 `http://127.0.0.1:3000`에서 보여 준다. 검색 검증은 정적 빌드 뒤 이 서버에서 수행한다.

확인할 동작:

1. 첫 화면에서 제품·위젯·개발 문서로 이동할 수 있다.
2. 사이드바, 목차 앵커, 이전/다음 문서 링크가 연결된다.
3. 한국어 검색에서 `투두`, `단어장`, `위젯` 같은 용어가 해당 문서로 연결된다.
4. 좁은 화면에서 메뉴를 열고 본문과 표를 읽을 수 있다.
5. 구현 예정 기능이 현재 앱 사용법처럼 표시되지 않는다.

잘못된 문서 링크 오류를 무시하도록 설정하지 않는다. 파일 이동으로 빌드가 실패하면 `.md` 상대 링크와 `wiki/sidebars.ts`의 문서 ID를 함께 고친다. 개발 생성물 때문에 문제가 남으면 다음 명령으로 캐시를 비운 뒤 다시 빌드한다.

```sh
corepack pnpm --dir wiki clear
corepack pnpm docs:build
```

## 문서 추가와 변경

새 Markdown에는 `title`과 `description`을 지정하고, 첫 단락에서 대상·범위·구현 상태를 설명한다. 첫 화면인 `docs/index.md`만 `slug: /`를 사용한다. 문서 사이에는 파일 기준의 `.md` 상대 링크를 사용한다.

새 문서를 해당 주제 디렉터리에 두고 `wiki/sidebars.ts`와 필요한 탐색 링크를 갱신한다. 코드 파일은 프로젝트 기준 경로를 인라인 코드로 표시한다. 확인되지 않은 공개 저장소 URL을 만들거나 개인 컴퓨터의 절대 경로를 웹 링크로 넣지 않는다.

코드 책임이나 파일 경계를 옮기면 [구조와 책임](architecture.md)의 모듈 표와 상태 전달·취소 경계를 갱신한다. README에는 실행 방법과 탐색 링크를 유지하고 상세 구조를 복제하지 않는다. 문서 경로를 유지하는 수정에는 사이드바 변경이 필요하지 않다.

제품 방향이 바뀌면 해당 주제 문서와 [상태표](../status.md)를 수정한다. 과거 검증 기록에 새 버전 결과를 덮어쓰지 않는다. API 예시는 실제 배포된 계약이 확정되기 전까지 설계 예시로 표시한다.

## 정적 사이트 배포 경계

현재 설정은 로컬 미리보기용이다. 공개 호스팅과 배포 자동화는 구성하지 않았다. 호스팅할 때는 실제 도메인과 경로에 맞춰 Docusaurus의 `url`·`baseUrl`을 정한 뒤 다시 빌드하고, 직접 URL 진입과 검색 색인 경로를 확인한다. 인증 토큰과 비공개 캘린더 구독 주소를 문서 예시에 넣지 않는다.

## 참고 문서

- [Docusaurus 설치](https://docusaurus.io/docs/installation)
- [문서 플러그인 설정](https://docusaurus.io/docs/api/plugins/@docusaurus/plugin-content-docs)
- [문서 링크](https://docusaurus.io/docs/markdown-features/links)
- [정적 사이트 배포](https://docusaurus.io/docs/deployment)
- [로컬 검색 플러그인](https://github.com/easyops-cn/docusaurus-search-local)
