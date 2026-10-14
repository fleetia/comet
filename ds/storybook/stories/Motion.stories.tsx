import { useId, useState, type JSX } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { themes, tokens } from "@comet/token";
import {
  ActionChip,
  Button,
  Checkbox,
  MenuItem,
  Motion,
  Slider,
  StatusIndicator,
  Surface,
  Switch,
  Tabs,
  ToggleChip,
  WaitingDots,
} from "@comet/ui";

const curves = [
  { path: "easing/ease-bounce", use: "말풍선·알림·작은 표시가 통통 나타날 때" },
  { path: "easing/ease-spring", use: "누른 버튼이 원래 크기로 돌아올 때" },
  { path: "easing/ease-out", use: "창·시트·팝오버가 펼쳐지고 미끄러질 때" },
  { path: "easing/ease-standard", use: "색상이 바뀌거나 짧게 사라질 때" },
  { path: "easing/ease-pulse", use: "기다림 점이 천천히 밝아지고 어두워질 때" },
  { path: "easing/ease-linear", use: "일정한 속도로 이동하는 시각 요소" },
] as const;

const durations = [
  { path: "duration/duration-fast", use: "색상·호버·누름 반응, 짧은 퇴장" },
  { path: "duration/duration-base", use: "창·시트·팝오버의 진입, 펼치기" },
  { path: "duration/duration-pop", use: "친구 쪽 요소의 등장, 누름에서 복귀" },
  { path: "duration/duration-stagger", use: "여러 요소가 차례로 나올 때의 간격" },
  { path: "duration/duration-pulse", use: "기다림 점의 한 주기 · 점마다 160ms 지연" },
  { path: "duration/duration-move", use: "일정한 속도로 이동하는 요소" },
] as const;

const scales = [
  { path: "scale/scale-pop-from", use: "친구 쪽 요소가 등장할 때의 시작 크기" },
  { path: "scale/scale-pressed", use: "누르고 있는 버튼·칩의 크기" },
  { path: "scale/scale-pressed-row", use: "넓은 위젯 행을 누를 때의 크기" },
  { path: "scale/scale-hover-node", use: "별·궤도 노드에 올렸을 때의 크기" },
] as const;

function curvePath(easing: string): string {
  if (easing === "linear") {
    return "M 20 130 L 200 65";
  }
  const presets: Record<string, readonly number[]> = {
    ease: [0.25, 0.1, 0.25, 1],
    "ease-in-out": [0.42, 0, 0.58, 1],
  };
  const values = presets[easing] ?? easing.match(/[\d.]+/g)?.map(Number);
  if (!values || values.length !== 4) {
    return "M 20 130 L 200 65";
  }
  const [x1 = 0, y1 = 0, x2 = 1, y2 = 1] = values;
  return `M 20 130 C ${20 + x1 * 180} ${130 - y1 * 65}, ${20 + x2 * 180} ${130 - y2 * 65}, 200 65`;
}

function MotionFoundation(): JSX.Element {
  const [replayKey, setReplayKey] = useState(0);
  return (
    <section className="comet-catalog-motion-foundation" aria-label="움직임 정의">
      <h1>움직임</h1>
      <p>
        친구 쪽 요소는 통통 나타나고, 창·시트·패널은 차분하게 미끄러집니다. 사라질 때는 짧게
        흐려집니다. 곡선·길이·크기는 @comet/token의 값을 함께 사용합니다.
      </p>
      <h2>곡선</h2>
      <p>가로는 시간, 세로는 진행입니다. 점선은 목표이고 점선 위는 목표를 넘은 만큼입니다.</p>
      <Button size="small" onClick={() => setReplayKey((key) => key + 1)}>
        곡선 다시 재생
      </Button>
      <p>아래 점은 모두 duration-pop으로 이동하므로 같은 길이에서 곡선을 비교할 수 있습니다.</p>
      <div className="comet-catalog-motion-curves">
        {curves.map(({ path, use }) => (
          <figure className="comet-catalog-motion-curve" key={path}>
            <svg viewBox="0 0 220 150" aria-hidden="true">
              <path d="M 20 25 V 130 H 200" className="comet-catalog-motion-axis" />
              <path d="M 20 65 H 200" className="comet-catalog-motion-goal" />
              <path d={curvePath(themes.dark[path])} className="comet-catalog-motion-line" />
              <circle cx="200" cy="65" r="3" className="comet-catalog-motion-end" />
            </svg>
            <figcaption>
              <strong>{path.split("/")[1]}</strong>
              <code>{themes.dark[path]}</code>
              <p>{use}</p>
            </figcaption>
            <div className="comet-catalog-motion-track" aria-hidden="true">
              <span
                key={replayKey}
                className="comet-catalog-motion-runner"
                style={{ animationTimingFunction: tokens[path] }}
              />
            </div>
          </figure>
        ))}
      </div>
      <h2>길이</h2>
      <table className="comet-catalog-table">
        <caption>시간 토큰과 쓰임</caption>
        <thead>
          <tr>
            <th scope="col">토큰</th>
            <th scope="col">길이</th>
            <th scope="col">쓰임</th>
          </tr>
        </thead>
        <tbody>
          {durations.map(({ path, use }) => (
            <tr key={path}>
              <th scope="row">
                <code>{path.split("/")[1]}</code>
              </th>
              <td>
                {Math.round(themes.dark[path] * 1000)}ms
                <span
                  className="comet-catalog-motion-duration"
                  style={{
                    width: `${(themes.dark[path] / themes.dark["duration/duration-pulse"]) * 180}px`,
                  }}
                  aria-hidden="true"
                />
              </td>
              <td>{use}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>크기</h2>
      <table className="comet-catalog-table">
        <caption>움직이는 동안 잠깐 바뀌는 배율</caption>
        <thead>
          <tr>
            <th scope="col">토큰</th>
            <th scope="col">배율</th>
            <th scope="col">쓰임</th>
          </tr>
        </thead>
        <tbody>
          {scales.map(({ path, use }) => (
            <tr key={path}>
              <th scope="row">
                <code>{path.split("/")[1]}</code>
              </th>
              <td>{themes.dark[path]}</td>
              <td>{use}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>선택 기준</h2>
      <ul>
        <li>
          Motion의 pop: 말풍선·알림·작은 확인 표시. 0.6에서 420ms ease-bounce로 나타나며 약 1.04까지
          넘었다 돌아옵니다.
        </li>
        <li>
          Motion의 slide와 Surface: 창·시트·팝오버. 280ms ease-out으로 4px 이동하며 나타납니다.
        </li>
        <li>
          Motion의 fade: 위치를 유지하며 나타나는 짧은 상태 변화. 180ms ease-standard를 사용합니다.
        </li>
        <li>모든 퇴장: 180ms ease-standard로 흐려지며 들어온 쪽으로 4px 이동합니다.</li>
        <li>여러 항목: staggerIndex 순서대로 40ms씩 늦게 나타납니다.</li>
        <li>
          버튼·칩·Stepper: 누르는 동안 0.96, 손을 떼면 420ms ease-spring으로 약 1.02까지 튕겨
          돌아옵니다.
        </li>
        <li>기다림: WaitingDots의 세 점을 1200ms ease-pulse로 표시합니다.</li>
      </ul>
      <p>
        일반 목록 행과 메뉴 행은 크기를 바꾸지 않습니다. 0.98 누름은 넓은 위젯 행에, 1.06 호버는
        별·궤도 노드에 사용할 정의입니다. 이 두 값에 대응하는 공개 UI 컴포넌트는 아직 없습니다. 자동
        움직임은 상태를 알릴 때에만 사용합니다.
      </p>
      <h2>일정한 이동</h2>
      <p>
        500ms duration-move와 ease-linear를 조합합니다. 곡선 다시 재생 버튼으로 함께 재생합니다.
      </p>
      <div className="comet-catalog-motion-track" aria-hidden="true">
        <span
          key={replayKey}
          className="comet-catalog-motion-runner"
          style={{
            animationDuration: tokens["duration/duration-move"],
            animationTimingFunction: tokens["easing/ease-linear"],
          }}
        />
      </div>
      <p>
        운영체제의 움직임 줄이기와 data-comet-motion="reduced"에서는 transition과 animation이
        꺼집니다. 등장·퇴장은 즉시 바뀌고 기다림 점은 세 개 모두 멈춘 채 보입니다.
      </p>
    </section>
  );
}

function PresenceExamples({ reduced = false }: { reduced?: boolean }): JSX.Element {
  const surfaceId = useId();
  const [replayKey, setReplayKey] = useState(0);
  const [isOpen, setIsOpen] = useState(true);
  return (
    <section className="comet-catalog-stack" data-comet-motion={reduced ? "reduced" : undefined}>
      <h2>{reduced ? "움직임 줄이기" : "등장·퇴장과 차례로 나타나기"}</h2>
      <div className="comet-catalog-row">
        <Button size="small" onClick={() => setReplayKey((key) => key + 1)}>
          다시 나타나기
        </Button>
        <Button
          size="small"
          variant="ghost"
          aria-controls={surfaceId}
          aria-expanded={isOpen}
          onClick={() => setIsOpen((open) => !open)}
        >
          {isOpen ? "표면 닫기" : "표면 열기"}
        </Button>
      </div>
      <div className="comet-catalog-motion-presets">
        {(["pop", "slide", "fade"] as const).map((preset) => (
          <div key={preset}>
            <h3>{preset}</h3>
            <Motion key={`${preset}-${replayKey}`} preset={preset} open={isOpen}>
              <div className="comet-catalog-motion-sample">하던 일을 이어가요</div>
            </Motion>
          </div>
        ))}
      </div>
      <div className="comet-catalog-motion-presence">
        <Surface id={surfaceId} variant="sheet" open={isOpen} style={{ padding: 20 }}>
          <h3>차분하게 펼쳐지는 표면</h3>
          <p>닫기를 누르면 퇴장 후 숨겨집니다. 다시 열면 진입을 재생합니다.</p>
        </Surface>
      </div>
      <div>
        <h3>40ms 간격으로 차례로</h3>
        <div className="comet-catalog-row">
          {["기록", "단어장", "친구", "설정"].map((label, index) => (
            <Motion key={`${replayKey}-${label}`} preset="pop" staggerIndex={index}>
              <ActionChip>{label}</ActionChip>
            </Motion>
          ))}
        </div>
      </div>
      <div className="comet-catalog-row">
        <WaitingDots />
        <StatusIndicator>연결됨</StatusIndicator>
        <StatusIndicator pulse>연결 확인 중</StatusIndicator>
      </div>
      <p>
        {reduced
          ? "이 영역은 움직임 줄이기를 항상 적용합니다. 조작 결과는 바로 표시되고 세 기다림 점은 계속 보입니다."
          : "버튼으로 다시 재생하거나 열고 닫아 보세요. 상단 움직임 메뉴에서 카탈로그 전체의 움직임을 줄일 수 있습니다."}
      </p>
    </section>
  );
}

function ControlExamples(): JSX.Element {
  const [isEnabled, setIsEnabled] = useState(true);
  const [isChecked, setIsChecked] = useState(false);
  const [value, setValue] = useState(60);
  const [clickCount, setClickCount] = useState(0);
  return (
    <section className="comet-catalog-stack" aria-label="컴포넌트 움직임 조작">
      <h2>누르고, 선택하고, 옮기기</h2>
      <p>Tab·Space·방향키로도 조작해 보세요. 포커스 표시와 입력 값은 지연되지 않습니다.</p>
      <div className="comet-catalog-row">
        <Button onClick={() => setClickCount((count) => count + 1)}>눌러보기</Button>
        <ToggleChip>선택하기</ToggleChip>
        <Button disabled>비활성</Button>
      </div>
      <output>버튼을 {clickCount}번 눌렀어요.</output>
      <Switch
        label="자동 잡담"
        checked={isEnabled}
        onChange={(event) => setIsEnabled(event.currentTarget.checked)}
      />
      <Checkbox
        label="오늘 할 일"
        checked={isChecked}
        onChange={(event) => setIsChecked(event.currentTarget.checked)}
      />
      <Slider
        label="말풍선 투명도"
        value={value}
        onChange={(event) => setValue(event.currentTarget.valueAsNumber)}
      />
      <Tabs
        label="기록 종류"
        items={[
          { value: "today", label: "오늘", content: <p>오늘의 기록을 이어가요.</p> },
          { value: "all", label: "전체", content: <p>저장한 기록을 살펴봐요.</p> },
        ]}
      />
      <MenuItem icon="star">메뉴 행은 색상으로 반응해요</MenuItem>
    </section>
  );
}

const meta = {
  title: "Foundations/Motion",
  component: MotionFoundation,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          '움직임 참고 이미지의 곡선·시간·배율을 공통 토큰과 UI 동작으로 연결합니다. 친구 쪽 요소에는 pop, 표면에는 slide, 짧은 상태 변화에는 fade를 선택합니다. Motion·Surface의 open을 false로 바꿔 퇴장을 재생하고 완료 전까지 DOM에 유지하세요. Motion의 onExitComplete로 소비자가 제거 시점을 받을 수 있습니다. 시스템 움직임 줄이기가 항상 우선하며 ThemeRoot motion="reduced"로 특정 영역도 줄일 수 있습니다.',
      },
    },
  },
} satisfies Meta<typeof MotionFoundation>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Foundation: Story = { name: "곡선 · 길이 · 크기" };
export const Presence: Story = {
  name: "등장 · 퇴장 · 차례로",
  render: () => <PresenceExamples />,
  parameters: {
    docs: {
      source: {
        code: 'import { Motion, Surface, WaitingDots } from "@comet/ui";\n\n<Motion preset="pop" open={isOpen} staggerIndex={0}>알림</Motion>\n<Surface variant="sheet" open={isOpen}>내용</Surface>\n<WaitingDots label="응답을 기다리고 있어요" />',
      },
    },
  },
};
export const Controls: Story = {
  name: "컴포넌트 조작",
  render: () => <ControlExamples />,
};
export const ReducedMotion: Story = {
  name: "움직임 줄이기",
  render: () => <PresenceExamples reduced />,
  parameters: {
    docs: {
      source: {
        code: '<ThemeRoot theme="light" motion="reduced">\n  <WaitingDots />\n  <Motion preset="pop">즉시 표시</Motion>\n</ThemeRoot>',
      },
    },
  },
};
