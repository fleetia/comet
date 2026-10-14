import { useState, type JSX } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { SegmentedControl } from "@comet/ui";

const options = [
  { value: "day", label: "일" },
  { value: "week", label: "주" },
  { value: "month", label: "월" },
];

const unequalOptions = [
  { value: "day", label: "오늘" },
  { value: "week", label: "이번 주의 기록" },
  { value: "month", label: "이번 달" },
];

function ControlledSegments(): JSX.Element {
  const [value, setValue] = useState("week");
  return (
    <div className="comet-catalog-stack">
      <SegmentedControl
        label="보기 단위"
        options={options}
        value={value}
        onValueChange={setValue}
      />
      <output aria-live="polite">선택된 값: {value}</output>
    </div>
  );
}

const meta = {
  title: "UI/Navigation/SegmentedControl",
  component: SegmentedControl,
  tags: ["autodocs"],
  args: { label: "보기 단위", options, defaultValue: "week", disabled: false },
  argTypes: {
    options: { control: false },
    label: { control: "text" },
    onValueChange: { control: false },
  },
  parameters: {
    docs: {
      description: {
        component:
          "관련된 선택지 중 하나를 고르는 native radio 그룹입니다. 선택 배경은 280ms ease-out으로 가로 이동하며 새 선택지의 너비에 맞춰집니다. 값과 포커스는 즉시 바뀝니다. label로 그룹 이름을 제공하고 options의 value는 고유해야 합니다. Tab으로 그룹에 진입한 뒤 방향키로 이동합니다. 전체 disabled와 개별 option.disabled를 지원합니다. 패널 전환이 목적이면 Tabs를 사용하세요.",
      },
    },
  },
} satisfies Meta<typeof SegmentedControl>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = { name: "기본 · 방향키 이동" };
export const WithDisabledOption: Story = {
  name: "비활성 선택지",
  args: { options: options.map((option) => ({ ...option, disabled: option.value === "month" })) },
};
export const Disabled: Story = { name: "전체 비활성", args: { disabled: true } };
export const Controlled: Story = { name: "값 연결", render: () => <ControlledSegments /> };
export const UnequalLabels: Story = {
  name: "가로 이동 · 다른 너비",
  args: { options: unequalOptions },
};
export const Narrow: Story = {
  name: "좁은 영역 · 한 줄 이동",
  args: { options: unequalOptions },
  render: (args) => (
    <div style={{ width: 220, maxWidth: "100%" }}>
      <SegmentedControl {...args} />
    </div>
  ),
};
export const Rtl: Story = {
  name: "오른쪽부터 배치",
  args: { options: unequalOptions },
  render: (args) => (
    <div dir="rtl">
      <SegmentedControl {...args} />
    </div>
  ),
};
export const ReducedMotion: Story = {
  name: "움직임 줄이기 · 즉시 선택",
  args: { options: unequalOptions },
  render: (args) => (
    <div data-comet-motion="reduced">
      <SegmentedControl {...args} />
    </div>
  ),
};
