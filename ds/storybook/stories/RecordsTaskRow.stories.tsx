import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { TaskRow } from "@comet/ui";
const meta = {
  title: "UI/records/TaskRow",
  component: TaskRow,
  tags: ["autodocs"],
  args: {
    title: "근로장려금 신청 확인하기",
    completionLabel: "근로장려금 신청 확인하기 완료",
    completed: false,
    due: "오늘 오후 7:00까지",
    list: "할 일",
  },
  argTypes: {
    layout: { control: "radio", options: ["task", "diary", "envelope"] },
    tone: {
      control: "select",
      options: ["blue", "coral", "green", "violet", "pink", "yellow", "gray"],
    },
    completed: { control: "boolean" },
    overdue: { control: "boolean" },
    selected: { control: "boolean" },
    disabled: { control: "boolean" },
    divider: { control: "boolean" },
    onCompletedChange: { control: false, action: "완료 상태 변경" },
  },
  parameters: {
    docs: {
      description: {
        component:
          "List/Task Row·List/Diary Task Row·Envelope/Checklist Row의 완료 체크와 내용을 제공합니다. completed는 소비자가 관리하고 체크 변경은 onCompletedChange로 전달합니다. description·envelope·due·list·repeat의 유무로 관련 표시 상태를 조합합니다. diary는 반복이 없어도 메타데이터 열 너비를 유지하며 목록 첫 행은 divider=false로 표시합니다. 행 선택·드래그·일정 변경은 소비자 책임입니다.",
      },
    },
  },
} satisfies Meta<typeof TaskRow>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const Description: Story = {
  args: {
    title: "대출 서류 챙기기",
    description: "신분증, 등본, 소득증빙",
    due: "내일",
    tone: "coral",
    list: "생활",
  },
};
export const Overdue: Story = {
  args: {
    title: "책 모임 질문 두 개 적기",
    due: "오늘 오후 1:30까지 · 지남",
    overdue: true,
    envelope: "책 모임",
  },
};
export const Repeating: Story = {
  args: { title: "네이처 둘러보기", due: "매일 · 지금 2:00 남음", repeat: "매일 아침" },
};
export const Selected: Story = {
  args: { title: "영수증 정리하기", selected: true, due: "오후 4:00 – 4:30", repeat: "매주 월" },
};
export const Done: Story = {
  args: { title: "20분 산책하기", completed: true, due: "오후 12:40 완료", repeat: "매일" },
};
export const Undated: Story = {
  args: { title: "공기청정기 필터 확인하기", due: "날짜 없음", repeat: "완료하고 3개월" },
};
export const Diary: Story = {
  args: {
    layout: "diary",
    divider: false,
    description: "준비할 내용을 적어 두기",
    envelope: "준비 봉투",
    repeat: "반복",
  },
};
export const DiaryOverdue: Story = { args: { layout: "diary", overdue: true, due: "날짜 · 지남" } };
export const DiarySelected: Story = { args: { layout: "diary", selected: true } };
export const DiaryDone: Story = { args: { layout: "diary", completed: true } };
export const Disabled: Story = { args: { disabled: true } };
export const Completion: Story = {
  parameters: { controls: { disable: true } },
  render: (args) => {
    const [completed, setCompleted] = useState(false);
    return <TaskRow {...args} completed={completed} onCompletedChange={setCompleted} />;
  },
};
