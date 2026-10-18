# @comet/storybook

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
