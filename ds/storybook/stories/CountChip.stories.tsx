import type { Meta, StoryObj } from "@storybook/react-vite";
import { CountChip } from "@comet/ui";
const meta = {
  title: "UI/Chips/CountChip",
  component: CountChip,
  tags: ["autodocs"],
  argTypes: {
    appearance: { control: "select", options: ["link", "choice"] },
    disabled: { control: "boolean" },
    children: { control: "text" },
    count: { control: "text" },
  },
  args: { children: "위젯 상태별", count: "5개" },
  parameters: {
    docs: {
      description: {
        component: "분류 문구와 개수를 조합합니다. appearance로 연결·선택 표현을 구분합니다.",
      },
    },
  },
} satisfies Meta<typeof CountChip>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = {};
export const Disabled: Story = { args: { disabled: true } };
export const Choice: Story = {
  args: { appearance: "choice", children: "쓰다듬었을 때", count: "3개" },
};
