import type { Meta, StoryObj } from "@storybook/react-vite";
import { tokens } from "@comet/token";
import {
  ConstellationChoice,
  CounterButton,
  MusicWidget,
  OsNotification,
  Surface,
} from "@comet/ui";
import music from "./WidgetsMusic.stories";

const meta = {
  title: "UI/surface/Shadows",
  parameters: { layout: "padded" },
  render: () => (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "360px 360px",
        gap: 40,
        padding: 24,
        background: tokens["color/sky"],
      }}
    >
      {(["window", "sheet", "popover"] as const).map((variant) => (
        <div key={variant}>
          <p>{variant}</p>
          <Surface variant={variant} data-shadow-sample={variant} style={{ padding: 20 }}>
            오늘의 작은 기록
          </Surface>
        </div>
      ))}
      <div>
        <p>음악 카드</p>
        <MusicWidget {...music.args} data-shadow-sample="music" />
      </div>
      <div>
        <p>알림</p>
        <OsNotification
          data-shadow-sample="notification"
          title="책 모임 · 10분 뒤"
          description="동네 서점 2층"
        />
      </div>
      <div>
        <p>선택지와 버튼</p>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <ConstellationChoice data-shadow-sample="choice">강가를 따라서</ConstellationChoice>
          <CounterButton data-shadow-sample="counter" label="위젯" count={6} icon="together" />
        </div>
      </div>
    </div>
  ),
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Gallery: Story = { name: "전체 표면 · 테마별 그림자" };
