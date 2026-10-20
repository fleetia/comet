import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { InputSurfaceActions } from "../../../apps/comet/src/components/Balloon/InputSurfaceActions";

const meta = {
  title: "App/conversation/InputSurfaceActions",
  component: InputSurfaceActions,
  tags: ["autodocs"],
  args: {
    resumeDisabled: false,
    togetherDisabled: false,
    historyDisabled: false,
    onResume: fn(),
    onTogether: fn(),
    onHistory: fn(),
  },
  render: (args) => (
    <div style={{ display: "grid", gap: 16 }}>
      {[
        ["밝은 바탕화면", "#ffffff", "#000000"],
        ["어두운 바탕화면", "#000000", "#ffffff"],
      ].map(([label, background, color]) => (
        <div key={label} style={{ background, padding: 24 }}>
          <p style={{ color, margin: "0 0 12px" }}>{label}</p>
          <InputSurfaceActions {...args} />
        </div>
      ))}
    </div>
  ),
  parameters: {
    docs: {
      description: {
        component:
          "별도 데스크톱 입력창의 실제 앱 액션입니다. 색상 모드를 바꾸고 각 버튼을 hover·press하여 밝고 어두운 바탕 위 대비를 비교합니다. 공통 Ghost 버튼은 바꾸지 않고 활성 액션에만 불투명한 바탕을 유지합니다.",
      },
    },
  },
} satisfies Meta<typeof InputSurfaceActions>;

export default meta;
type Story = StoryObj<typeof meta>;
export const Enabled: Story = { name: "모두 사용 가능" };
export const HistoryOnly: Story = {
  name: "지난 대화만 사용 가능",
  args: { resumeDisabled: true, togetherDisabled: true },
};
export const Disabled: Story = {
  name: "이동 중 · 모두 사용 불가",
  args: { resumeDisabled: true, togetherDisabled: true, historyDisabled: true },
};
