import type { Meta, StoryObj } from "@storybook/react-vite";
import { FocusTimerFreeform } from "@comet/ui";

const meta = {
  title: "UI/Widgets/FocusTimerFreeform",
  component: FocusTimerFreeform,
  tags: ["autodocs"],
  args: { time: "18:42", task: "기획서 초안", label: "집중 중" },
  argTypes: {
    time: {
      control: "text",
    },
    task: {
      control: "text",
    },
    label: {
      control: "text",
    },
    className: {
      control: false,
    },
    style: {
      control: false,
    },
  },
  parameters: {
    docs: {
      description: {
        component: "원본 육각형 모양의 집중 시간 표시입니다. 타이머를 실행하지 않습니다.",
      },
    },
  },
} satisfies Meta<typeof FocusTimerFreeform>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { name: "자유 배치" };
