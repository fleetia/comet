import type { Meta, StoryObj } from "@storybook/react-vite";
import { ClockWidget } from "@comet/ui";

const meta = {
  title: "UI/widgets/ClockWidget",
  component: ClockWidget,
  tags: ["autodocs"],
  args: { time: "3:24", date: "10월 12일 월", badge: "D+42" },
  argTypes: {
    period: { control: "text" },
    time: {
      control: "text",
    },
    date: {
      control: "text",
    },
    badge: {
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
        component:
          "원형 시계 표시입니다. 시간·날짜·기념일을 문자열로 전달하며 자체 시계를 실행하지 않습니다.",
      },
    },
  },
} satisfies Meta<typeof ClockWidget>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { name: "자유 배치" };
export const TwelveHour: Story = { name: "오전·오후 표시", args: { period: "오후" } };
