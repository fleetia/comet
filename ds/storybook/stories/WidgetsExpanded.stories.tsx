import type { Meta, StoryObj } from "@storybook/react-vite";
import { WidgetExpanded } from "@comet/ui";

const meta = {
  title: "UI/Widgets/WidgetExpanded",
  component: WidgetExpanded,
  tags: ["autodocs"],
  args: {
    title: "집중 타이머",
    icon: "timer",
    children: "위젯 내용을 조합하는 표면",
    footer: "위젯의 보조 안내를 담습니다.",
  },
  argTypes: {
    title: {
      control: "text",
    },
    icon: {
      control: "select",
      options: ["timer", "music", "envelope", "clock", "cloud"],
    },
    collapseLabel: {
      control: "text",
    },
    children: {
      control: false,
    },
    footer: {
      control: false,
    },
    onCollapse: {
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
          "위젯 공통 제목·접기 버튼·내용·푸터 표면입니다. children으로 실제 위젯 표시 컴포넌트를 조합하며 접기 콜백과 열린 상태는 소비자가 담당합니다.",
      },
    },
  },
} satisfies Meta<typeof WidgetExpanded>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { name: "펼친 위젯 표면" };
