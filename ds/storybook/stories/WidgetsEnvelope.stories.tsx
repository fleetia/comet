import type { Meta, StoryObj } from "@storybook/react-vite";
import { EnvelopeWidget } from "@comet/ui";

const meta = {
  title: "UI/Widgets/EnvelopeWidget",
  component: EnvelopeWidget,
  tags: ["autodocs"],
  args: {
    title: "가족 여행",
    date: "10월 24일 (토) – 25일 (일) · 12일 남음",
    tasks: [
      { id: "car", title: "차표 예매하기", completed: true },
      { id: "stay", title: "숙소 예약 확인", completed: true },
      { id: "snack", title: "아이 간식 사기", description: "오늘" },
      { id: "umbrella", title: "우산 챙기기" },
      { id: "camera", title: "카메라 충전하기" },
    ],
  },
  argTypes: {
    title: {
      control: "text",
    },
    date: {
      control: "text",
    },
    tasks: {
      control: "object",
    },
    onTaskChange: {
      control: false,
    },
    onCollapse: {
      control: false,
    },
    onFocus: {
      control: false,
    },
    onOpen: {
      control: false,
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
          "준비 봉투의 제목·일정·준비 현황과 할 일을 표시합니다. 체크 변경은 onTaskChange로 전달하며 원본 할 일이나 일정 데이터를 저장하지 않습니다.",
      },
    },
  },
} satisfies Meta<typeof EnvelopeWidget>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { name: "준비 중" };
export const Empty: Story = { name: "빈 봉투", args: { tasks: [] } };
