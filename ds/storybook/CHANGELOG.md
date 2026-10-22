# @comet/storybook

## 0.1.8

### Patch Changes

- 4a7337f: 낮 모드에서 설정·다이어리에 남던 밤 배경을 제거하고, 새벽 스킨 미리보기와 집중 타이머·대화 장식의 색상을 Figma와 테마 토큰에 맞췄습니다.
- Updated dependencies [2e3ba09]
- Updated dependencies [4a7337f]
- Updated dependencies [189de29]
  - @comet/token@0.3.0
  - @comet/ui@0.7.1

## 0.1.7

### Patch Changes

- da32096: 설정 › 일반 › 테마를 추가했습니다. 화면 모드는 시스템을 따르는 것이 기본이고 다크·라이트를 고를 수 있습니다. 밤하늘 말고도 따뜻한 종이·놀이 스킨과 배경·말풍선·위젯·강조 색을 직접 고르는 내 스킨을 바탕화면·말풍선·위젯·설정 창에 함께 입힙니다. 한 모습뿐인 스킨은 화면 모드를 잠급니다. 바탕화면 말풍선과 위젯의 투명도는 따로 정하며 기본은 불투명입니다. 친구 말풍선은 바꾼 글자·이미지만 그 친구에게 남고, 전체 테마 따르기로 다시 스킨을 따르게 할 수 있습니다. 디자인 토큰에 paper·play 모드와 스킨 글꼴 토큰, 스킨 파생 함수(@comet/token/skin)를 더했고, UI에는 SkinScene과 ChoiceTile의 theme-add 종류, ThemeRoot의 스킨 글꼴 옵션을 추가했습니다.
- Updated dependencies [da32096]
  - @comet/token@0.2.0
  - @comet/ui@0.7.0

## 0.1.6

### Patch Changes

- e6c19f3: 여행 창을 추가했습니다. 다이어리 목차·여행 위젯·빠른 실행에서 열고, 한눈에·일정·예약·비용·사람·지도·사진 칸에서 여행을 챙깁니다. 예약 확인서는 설정한 AI가 읽어 저장 전 초안을 만들고, 결제한 비용은 내 몫만 가계부에 기록합니다. 그린 지도는 네트워크 없이 그리며, 켜면 OpenStreetMap 타일과 주소 검색을 씁니다. 사진은 원본을 옮기지 않고 경로와 찍은 시각·위치만 기록합니다. 무료 취소 마감은 조용한 시간에도 OS 알림으로 한 번 알려 줍니다. 디자인시스템의 여행 정보 행은 누르면 편집을 여는 버튼으로도 쓸 수 있습니다.
- Updated dependencies [e6c19f3]
  - @comet/ui@0.6.0

## 0.1.5

### Patch Changes

- 32b7413: 메모 참고 대화 제거에 맞춰 쓰지 않는 ReferenceMemo 컴포넌트와 스토리, Figma 매핑을 정리합니다.
- 47c8da6: 모아두기 위젯의 접힌 말풍선과 호버 조작을 추가하고, 너비와 위젯별 꾸미기를 편집할 수 있게 했습니다.
- Updated dependencies [82b8ddd]
- Updated dependencies [32b7413]
- Updated dependencies [47c8da6]
  - @comet/token@0.1.1
  - @comet/ui@0.5.0

## 0.1.4

### Patch Changes

- 4615064: 앱 전용 컨트롤 어댑터를 없애고 디자인시스템 컨트롤을 직접 사용합니다. 디자인시스템에 FormField, 입력 컨트롤의 부모 폭 채우기(fill), Surface의 panel·accent 표면을 추가했습니다. 닫기 버튼은 Figma 아이콘 버튼 모양으로 맞추고, 안쪽 묶음 영역은 카드 표면으로 통일했습니다.
- Updated dependencies [4615064]
  - @comet/ui@0.4.0

## 0.1.3

### Patch Changes

- 6dee429: 대화 화면의 Figma 별자리 선택지, 기억 배지와 실제 대화 이벤트를 연결하고 기본 글꼴과 반투명 표면을 맞췄습니다.
- c819f02: 캐릭터 답장 캡슐과 독립된 지난 대화 창을 복구하고 창 전환 시 초안을 보존합니다.
- Updated dependencies [6dee429]
- Updated dependencies [c1ffc57]
- Updated dependencies [c819f02]
  - @comet/ui@0.3.0

## 0.1.2

### Patch Changes

- cd055fc: 기존 ChatGPT 로그인과 로컬 모델을 유지하면서 Claude·Gemini·GLM API를 선택할 수 있게 합니다. 제공자별 모델 설정과 보안 저장소의 API 키를 분리하고, AI 연결 화면과 디자인시스템 예제를 추가합니다.
- c3d5d7a: 새 업데이트가 있으면 캐릭터가 말풍선으로 알려 주고, 말풍선을 누르면 우하단에 나타나는 이동하기 → 텍스트 액션으로 업데이트 설정을 열 수 있습니다.
- 6a24100: Storybook 사이드바를 Figma 02. component 보드와 같은 ds/ui 폴더(controls · display · choices · navigation · records · conversation · overlays · surface · motion · planner · widgets) 기준으로 묶고, 선택된 텍스트 표정 타일 스토리를 추가했습니다.
- bb39677: ChatGPT 설정의 긴 계정명을 카드 안에서 줄바꿈하고 계정 선택 상자를 내부 너비에 맞춥니다. 공통 Select의 긴 선택값을 말줄임 처리하고 좁은 영역의 Storybook 예제를 추가합니다.
- Updated dependencies [6a24100]
- Updated dependencies [6a24100]
- Updated dependencies [0ad94ac]
- Updated dependencies [c3d5d7a]
- Updated dependencies [bb39677]
  - @comet/ui@0.2.0

## 0.1.1

### Patch Changes

- Updated dependencies [0bee3ba]
  - @comet/ui@0.1.1

## 0.1.0

### Minor Changes

- f45a785: 기존 앱을 apps/comet으로 분리하고 Figma 기반 아이콘·Light/Dark 토큰·공통 UI와 Storybook을 내부 모노레포 패키지로 제공한다.

### Patch Changes

- Updated dependencies [f45a785]
- Updated dependencies [4089f21]
- Updated dependencies
- Updated dependencies [f9bb66a]
  - @comet/icon@0.1.0
  - @comet/token@0.1.0
  - @comet/ui@0.1.0
