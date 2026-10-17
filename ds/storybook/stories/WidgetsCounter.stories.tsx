import type { Meta, StoryObj } from "@storybook/react-vite";
import { CounterWidget } from "@comet/ui";

const meta = {
  title: "UI/widgets/CounterWidget",
  component: CounterWidget,
  tags: ["autodocs"],
  args: { value: 84, target: 120, unit: "단", layout: "desktop" },
  argTypes: {
    value: {
      control: {
        type: "number",
      },
    },
    target: {
      control: {
        type: "number",
        min: 0,
      },
    },
    unit: {
      control: "text",
    },
    layout: {
      control: "select",
      options: ["editor", "desktop"],
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
        component: "원본 꽃 모양의 숫자 표시입니다. editor·desktop의 원본 크기를 유지합니다.",
      },
    },
  },
} satisfies Meta<typeof CounterWidget>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { name: "자유 배치" };
export const Editor: Story = { name: "편집기", args: { layout: "editor" } };
