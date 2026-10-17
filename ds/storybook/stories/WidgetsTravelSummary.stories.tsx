import type { Meta, StoryObj } from "@storybook/react-vite";
import { TravelSummary } from "@comet/ui";

const meta = {
  title: "UI/widgets/TravelSummary",
  component: TravelSummary,
  tags: ["autodocs"],
  args: {
    title: "제주 가족 여행",
    description: "준비 2/9 · 취소 마감 오늘",
    countdown: "D-3",
    phase: "before",
  },
  argTypes: {
    title: {
      control: "text",
    },
    description: {
      control: "text",
    },
    countdown: {
      control: "text",
    },
    phase: {
      control: "select",
      options: ["before", "traveling", "after"],
    },
    disabled: {
      control: "boolean",
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
          "여행 전·여행 중·여행 후 단계에 따라 아이콘이 달라지는 요약 버튼입니다. 일정과 남은 날짜는 소비자가 계산합니다.",
      },
    },
  },
} satisfies Meta<typeof TravelSummary>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Before: Story = { name: "여행 전" };
export const Traveling: Story = { name: "여행 중", args: { phase: "traveling" } };
export const After: Story = { name: "다녀온 뒤", args: { phase: "after" } };
