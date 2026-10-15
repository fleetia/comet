import type { Meta, StoryObj } from "@storybook/react-vite";
import { OsNotification } from "@comet/ui";

const meta = {
  title: "UI/Overlays/OsNotification",
  component: OsNotification,
  tags: ["autodocs"],
  args: {
    title: "책 모임 · 10분 뒤",
    description: "오후 2:00 – 3:00 · 동네 서점 2층",
    time: "지금",
    kind: "event",
    actions: [
      { id: "snooze", label: "10분 뒤 다시" },
      { id: "open", label: "봉투 열기" },
    ],
  },
  argTypes: {
    title: {
      control: "text",
    },
    description: {
      control: "text",
    },
    time: {
      control: "text",
    },
    kind: {
      control: "select",
      options: ["event", "task", "quiet-hours"],
    },
    actions: {
      control: "object",
    },
    onAction: {
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
          "운영체제 알림 모양의 표시 컴포넌트입니다. 실제 OS 알림을 등록하지 않습니다. 표시 문자열과 버튼 선택만 전달합니다.",
      },
    },
  },
} satisfies Meta<typeof OsNotification>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Event: Story = { name: "일정" };
export const Task: Story = {
  name: "할 일",
  args: {
    title: "영수증 정리하기",
    description: "오늘 오후 6:00까지 · 할 일",
    time: "5분 전",
    kind: "task",
    actions: [
      { id: "complete", label: "완료" },
      { id: "snooze", label: "10분 뒤 다시" },
    ],
  },
};
export const QuietHours: Story = {
  name: "조용한 시간",
  args: {
    title: "내일 오전 9:00 · 팀 회의",
    description: "종일 알림 · 조용한 시간이라 OS 알림으로만 왔어요",
    kind: "quiet-hours",
    actions: [],
  },
};
