import type { Meta, StoryObj } from "@storybook/react-vite";
import { OrganizationCard } from "@comet/ui";
const meta = {
  title: "UI/records/OrganizationCard",
  component: OrganizationCard,
  tags: ["autodocs"],
  args: {
    title: "회의 내용을 메모로 정리",
    timestamp: "오후 1:12 · 직접 부탁",
    description: "별꼬리 · 회의/4개",
    status: "saved",
    statusLabel: "저장됨",
    selected: true,
  },
  argTypes: {
    status: { control: "select", options: ["saved", "reverted", "conflict", "confirmation"] },
    layout: { control: "radio", options: ["record", "activity"] },
    selected: { control: "boolean" },
    disabled: { control: "boolean" },
    onClick: { control: false, action: "선택" },
  },
  parameters: {
    docs: {
      description: {
        component:
          "Record/Organization·Card/Activity Log·List/Organizer Record Choice를 상태와 크기별로 제공합니다. 저장·되돌림·충돌·확인 필요 상태는 표시만 하며 실제 변경이나 복구는 소비자의 onClick에서 처리합니다.",
      },
    },
  },
} satisfies Meta<typeof OrganizationCard>;
export default meta;
type Story = StoryObj<typeof meta>;
export const SavedSelected: Story = {};
export const Reverted: Story = {
  args: {
    title: "우유와 달걀 추가",
    timestamp: "오전 11:05 · 직접 부탁",
    description: "나디르 · 장보기 목록",
    status: "reverted",
    statusLabel: "되돌림",
    selected: false,
  },
};
export const Conflict: Story = {
  args: {
    title: "기획서 결정 사항 정리",
    timestamp: "오후 9:30 · 자동 정리",
    description: "업무 노트/프로젝트-기획.md",
    status: "conflict",
    statusLabel: "수정 충돌",
    selected: false,
  },
};
export const NeedsConfirmation: Story = {
  args: {
    title: "금요일 저녁 모임 시간 바꾸기",
    timestamp: "오후 6:02 · 직접 부탁",
    description: "별꼬리 · 일정",
    status: "confirmation",
    statusLabel: "확인 필요",
    selected: false,
  },
};
export const ActivityReverted: Story = {
  args: { layout: "activity", status: "reverted", statusLabel: "되돌림", selected: false },
};
export const ActivityConflict: Story = {
  args: { layout: "activity", status: "conflict", statusLabel: "되돌림", selected: false },
};
export const OrganizerRecordChoice: Story = {
  args: {
    layout: "activity",
    title: "회의록 요약과 다음 행동",
    timestamp: "오후 1:40 · 자동 정리",
    description: "업무 노트 · 회의 · 10월 12일.md",
    selected: false,
  },
};
export const OrganizerRecordSelected: Story = {
  args: { layout: "activity", title: "회의록 요약과 다음 행동", selected: true },
};
