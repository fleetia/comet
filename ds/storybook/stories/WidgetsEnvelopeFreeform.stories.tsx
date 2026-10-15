import type { Meta, StoryObj } from "@storybook/react-vite";
import { EnvelopeFreeform } from "@comet/ui";

const meta = {
  title: "UI/Widgets/EnvelopeFreeform",
  component: EnvelopeFreeform,
  tags: ["autodocs"],
  args: { title: "가족 여행", date: "10월 24일 (토)", completed: 2, total: 9 },
  argTypes: {
    title: {
      control: "text",
    },
    date: {
      control: "text",
    },
    completed: {
      control: {
        type: "number",
        min: 0,
      },
    },
    total: {
      control: {
        type: "number",
        min: 0,
      },
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
  parameters: { docs: { description: { component: "원본 우표 모양의 준비 봉투 표시입니다." } } },
} satisfies Meta<typeof EnvelopeFreeform>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { name: "자유 배치" };
