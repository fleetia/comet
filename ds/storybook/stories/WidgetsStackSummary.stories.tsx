import type { Meta, StoryObj } from "@storybook/react-vite";
import { WidgetStackSummary } from "@comet/ui";

const meta = {
  title: "UI/Widgets/WidgetStackSummary",
  component: WidgetStackSummary,
  tags: ["autodocs"],
  args: {
    items: [
      { id: "clock", icon: "clock", label: "3:24" },
      { id: "weather", icon: "cloud", label: "23° 구름 조금" },
      { id: "focus", icon: "timer", label: "집중 18:42", active: true, live: true },
      { id: "music", icon: "music", label: "밤의 산책" },
      { id: "envelope", icon: "envelope", label: "가족 여행 2/9" },
    ],
    surface: "translucent",
  },
  argTypes: {
    surface: {
      control: "select",
      options: ["plain", "translucent", "glow"],
    },
    items: {
      control: "object",
    },
    onSelect: {
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
          "위젯들을 하나의 요약 막대로 표시합니다. 각 항목의 버튼이 선택 id를 전달하고 활성·실행 중 표시를 구분합니다.",
      },
    },
  },
} satisfies Meta<typeof WidgetStackSummary>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Translucent: Story = { name: "반투명" };
export const Glow: Story = { name: "빛 표면", args: { surface: "glow" } };
