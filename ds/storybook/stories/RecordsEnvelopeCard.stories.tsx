import type { Meta, StoryObj } from "@storybook/react-vite";
import { EnvelopeCard } from "@comet/ui";
const meta = {
  title: "UI/Records/EnvelopeCard",
  component: EnvelopeCard,
  tags: ["autodocs"],
  args: {
    title: "책 모임",
    description: "오늘 오후 2:00 · 일정에 연결됨",
    completed: 3,
    total: 5,
    selected: true,
  },
  argTypes: {
    layout: { control: "radio", options: ["card", "preview"] },
    selected: { control: "boolean" },
    archived: { control: "boolean" },
    disabled: { control: "boolean" },
    completed: { control: { type: "number", min: 0 } },
    total: { control: { type: "number", min: 0 } },
    onClick: { control: false, action: "선택" },
  },
  parameters: {
    docs: {
      description: {
        component:
          "Envelope/Card와 Card/Envelope Preview입니다. 진행률은 native progress로 제공하고 완료 수와 전체 수는 소비자가 전달합니다. archived는 보관 상태의 잉크·진행률을 표시하며 선택 동작이나 데이터 이동을 직접 수행하지 않습니다.",
      },
    },
  },
} satisfies Meta<typeof EnvelopeCard>;
export default meta;
type Story = StoryObj<typeof meta>;
export const SelectedEventLinked: Story = {};
export const Scheduled: Story = {
  args: {
    title: "가족 여행",
    description: "10월 24일 (토) – 25일 (일)",
    completed: 2,
    total: 9,
    selected: false,
  },
};
export const Undated: Story = {
  args: {
    title: "이사 준비",
    description: "날짜 없이 준비 중",
    completed: 0,
    total: 5,
    selected: false,
  },
};
export const Archived: Story = {
  args: {
    title: "사촌 결혼식",
    description: "10월 10일 · 준비를 마치고 보관함",
    completed: 6,
    total: 6,
    selected: false,
    archived: true,
  },
};
export const SelectedPreview: Story = { args: { layout: "preview" } };
export const EmptyPreview: Story = { args: { layout: "preview", selected: false, completed: 0 } };
export const InProgressPreview: Story = {
  args: { layout: "preview", selected: false, completed: 1 },
};
export const ArchivedPreview: Story = {
  args: { layout: "preview", selected: false, archived: true, completed: 5 },
};
