---
title: 캐릭터팩 갤러리
description: 직접 내려받아 설치하는 공식 캐릭터팩과 콘텐츠별 이용 조건
---

# 캐릭터팩 갤러리

캐릭터팩은 JSON 파일을 직접 내려받은 뒤 Comet의 `캐릭터 관리 → 공유 파일 가져오기`에서 미리보고 설치합니다. 앱 업데이트와 캐릭터팩 설치는 별개이며, 이 갤러리는 자동 설치·자동 갱신 마켓이 아닙니다. 파일 규격과 가져오기 경계는 [캐릭터 교체와 공유](characters.md)를 따릅니다.

## 준비된 캐릭터

| 캐릭터 | 내용 | 호환 앱 | 파일 | 이용 조건 |
| --- | --- | --- | --- | --- |
| 나디르와 별꼬리 | 텍스트 표정과 기본 대화를 제공하는 캐릭터팩 | 0.3.0 이상 · v1 | [JSON 보기·내려받기](https://github.com/fleetia/comet/blob/main/examples/character-packs/nadir-and-star-tail.comet-character.json) | 패키지에 별도 표기 없음 |
| 별꼬리 | 표정 이미지가 포함된 공식 캐릭터 | 0.4.0 이상 · v2 | [JSON 보기·내려받기](https://github.com/fleetia/comet/blob/main/examples/character-packs/byulkkori.comet-character.json) | 공식 Comet 채널에서만 배포. 수정·파생 제작·downstream 재배포 금지 |

GitHub 파일 화면의 **Download raw file**로 JSON 파일을 저장합니다. 별꼬리의 구체적인 범위는 [콘텐츠 이용 조건](https://github.com/fleetia/comet/blob/main/examples/character-packs/byulkkori.LICENSE.txt)을 확인하세요. 소스 코드가 공개되어 있어도 캐릭터 콘텐츠에 같은 이용 조건이 적용되지는 않습니다.

작성자와 원본 출처는 각 패키지에 기재된 값을 따릅니다. 별꼬리 이미지팩의 작성자와 원본 출처 URL은 아직 기입하지 않았습니다. 임의의 이름이나 링크를 만들지 않으며, 확인 후 카탈로그의 `author`와 `sourceUrl`을 채웁니다. 빈 출처는 공개 도메인 표시가 아닙니다.

## 카탈로그 유지

목록의 원본은 저장소 루트의 `character-packs/catalog.json`입니다. 각 항목은 식별자, 표시 이름, 설명, 작성자, 출처 URL, 실제 JSON 파일 경로와 라이선스를 가집니다. 아직 없는 파일을 내려받기 링크로 등록하지 않습니다. 파일 내용, 라이선스 또는 설치 방법이 바뀌면 카탈로그와 이 페이지를 함께 갱신합니다.

이 카탈로그에는 사용자 대화·기억·친밀도·API 키를 담지 않습니다. 공식 채널에서 새 파일을 배포해도 사용자가 설치한 캐릭터를 원격으로 덮어쓰지 않습니다.
