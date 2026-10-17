import type { Meta, StoryObj } from "@storybook/react-vite";
import { WidgetCollapsedBar } from "@comet/ui";

const meta = {
  title: "UI/widgets/WidgetCollapsedBar",
  component: WidgetCollapsedBar,
  tags: ["autodocs"],
  args: {
    items: [
      { id: "clock", icon: "clock", label: "3:24" },
      { id: "weather", icon: "cloud", label: "23° 구름 조금" },
      { id: "focus", icon: "timer", label: "집중 18:42", active: true, live: true },
      { id: "music", icon: "music", label: "밤의 산책" },
      { id: "envelope", icon: "envelope", label: "가족 여행 2/9" },
    ],
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
          "여러 위젯의 접힌 표시를 한 줄로 조합하는 막대입니다. WidgetStackSummary와 같은 선택 계약을 사용합니다.",
      },
    },
  },
} satisfies Meta<typeof WidgetCollapsedBar>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { name: "접힌 위젯 막대" };
