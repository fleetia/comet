import { useState, type JSX } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Tabs } from "@comet/ui";

const items = [
  { value: "today", label: "오늘", content: <p>오늘의 기록이 표시되는 영역입니다.</p> },
  { value: "week", label: "이번 주", content: <p>이번 주의 기록이 표시되는 영역입니다.</p> },
  { value: "all", label: "전체", content: <p>전체 기록이 표시되는 영역입니다.</p> },
];

function ControlledTabs(): JSX.Element {
  const [value, setValue] = useState("today");
  return (
    <div className="comet-catalog-stack">
      <Tabs label="기록 범위" items={items} value={value} onValueChange={setValue} />
      <output aria-live="polite">선택된 값: {value}</output>
    </div>
  );
}

const meta = {
  title: "UI/Navigation/Tabs",
  component: Tabs,
  tags: ["autodocs"],
  args: { label: "기록 범위", items, defaultValue: "today" },
  argTypes: {
    items: { control: false },
    label: { control: "text" },
    onValueChange: { control: false },
  },
  parameters: {
    docs: {
      description: {
        component:
          "탭과 연결된 패널을 함께 제공합니다. 각 item에는 고유 value, label, content를 지정합니다. Tab으로 선택된 탭에 진입하고 좌우 방향키·Home·End로 활성 탭을 바꿉니다. 비활성 탭은 건너뜁니다. 제어 모드에는 value·onValueChange를 함께 전달하세요.",
      },
    },
  },
} satisfies Meta<typeof Tabs>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = { name: "기본 · 방향키 이동" };
export const WithDisabled: Story = {
  name: "비활성 탭",
  args: { items: items.map((item) => ({ ...item, disabled: item.value === "week" })) },
};
export const Controlled: Story = { name: "값 연결", render: () => <ControlledTabs /> };
