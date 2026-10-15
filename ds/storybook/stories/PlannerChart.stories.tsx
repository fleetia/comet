import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChartBarItem } from "@comet/ui";
const meta = {
  title: "UI/Planner/Chart Bar Item",
  component: ChartBarItem,
  tags: ["autodocs"],
  argTypes: {
    label: { control: "text" },
    valueLabel: { control: "text" },
    value: { control: "number" },
    max: { control: "number" },
    current: { control: "boolean" },
    empty: { control: "boolean" },
  },
  args: { label: "월", valueLabel: "1시간 50분", value: 110, max: 180 },
  parameters: {
    docs: {
      description: {
        component:
          "값과 레이블은 props이며 막대 높이는 value/max 비율입니다. current/empty만 표시 상태로 구분합니다. Dark/Light 대비는 Storybook 테마에서 확인합니다. 0 이하·유효하지 않은 범위는 0 높이로 제한합니다.",
      },
    },
  },
} satisfies Meta<typeof ChartBarItem>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { name: "기본" };
export const Current: Story = { name: "현재", args: { current: true } };
export const Empty: Story = { name: "빈 값", args: { value: 0, valueLabel: "–", empty: true } };
export const CurrentDark: Story = {
  name: "현재 · Dark",
  args: { current: true },
  globals: { theme: "dark" },
};
export const EmptyDark: Story = {
  name: "빈 값 · Dark",
  args: { value: 0, valueLabel: "–", empty: true },
  globals: { theme: "dark" },
};
