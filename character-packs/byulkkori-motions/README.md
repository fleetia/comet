# 별꼬리 교감 모션

별꼬리의 기존 64×64 SVG 도형을 유지하면서 교감과 집기 자세를 프레임으로 작성했다. `atlas.svg`가 벡터 원본이고 `atlas.png`는 앱에 연결하는 투명 PNG다. `animation.json`은 각 행의 8프레임을 참조한다. 같은 자산과 정의는 `examples/character-packs/byulkkori.comet-character.json`에도 포함된다.

| 행 | 클립 | 동작 |
| --- | --- | --- |
| 1 | `idle` | 꼬리 인사와 눈 깜빡임 |
| 2–3 | `poke-head`, `poke-body` | 머리·몸 찌르기 |
| 4–5 | `stroke-head`, `stroke-body` | 머리·몸 쓰다듬기 |
| 6–8 | `cheek-start`, `cheek-hold`, `cheek-end` | 볼 당기기·유지·놓기 |
| 9–12 | `pickup-start`, `hang-moving`, `hang-still`, `landing` | 집기·이동 중 매달림·정지 중 매달림·착지 |
| 13 | `snack` | 과자 받아 먹기 |

각 클립은 64×64 크기의 8프레임을 초당 8프레임으로 재생한다. 유지 자세의 반복과 동작 종료는 실행 호스트가 제어한다. 유지 클립 한 바퀴를 교감 종료나 이야기 완료로 해석하지 않는다.

생활 동작은 `life-atlas.svg`·`life-atlas.png`·`life-animation.json`에 수면·깨우기·집중·휴식·음악·음료·선물·하품·기지개 9개로 작성했다. 주변 이동은 `wander-atlas.svg`·`wander-atlas.png`·`wander-animation.json`에 걷기·빠른 걸음·기기·가장자리 타기·짧은 낙하·빼꼼 6개로 작성했다. 각 행은 같은 크기의 8프레임이며 세 자산의 전체 28개 클립은 팩의 32개 제한 안에 있다.

## 다시 렌더링하기

`scripts/build-byulkkori-motions.mjs`가 프레임 도형과 팩 연결을 소유한다. SVG를 PNG로 렌더링하는 `sharp`는 자산 제작에만 필요하며 앱 실행 의존성이 아니다. 저장소에 새 의존성을 설치하지 않고 Codex의 번들 모듈 경로를 `COMET_SHARP_MODULE`로 지정할 수 있다.

```sh
COMET_SHARP_MODULE=/absolute/path/to/sharp \
  node scripts/build-byulkkori-motions.mjs --install
```

`--install`은 공식 예제 팩의 애니메이션·부위·교감·생활·이동 모션 정의를 갱신한다. 기존 13개 클립의 PNG 해시를 확인하여 원래 교감 자산을 유지한다. 이 스크립트는 설치된 사용자 팩이나 DB를 변경하지 않는다. 앱의 일회성 자산 갱신은 변경하지 않은 공식 정의·표정 이미지·기존 모션 자산에만 적용하며 로컬 캐릭터 ID를 유지한다.

별꼬리 도안과 이 모션의 이용 조건은 `examples/character-packs/byulkkori.LICENSE.txt`를 따른다.
