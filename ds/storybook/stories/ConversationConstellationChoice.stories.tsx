import type { Meta, StoryObj } from "@storybook/react-vite";
import { ConstellationChoice } from "@comet/ui";

const meta = {
  title: "UI/conversation/ConstellationChoice",
  component: ConstellationChoice,
  tags: ["autodocs"],
  args: { children: "강가를 따라서", selected: false, fading: false },
  argTypes: {
    selected: {
      control: "boolean",
    },
    fading: {
      control: "boolean",
    },
    disabled: {
      control: "boolean",
    },
    children: {
      control: "text",
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
          "별자리 선택 버튼입니다. selected는 aria-pressed로 전달하고 fading 상태는 선택이 끝난 다른 항목을 비활성화합니다.",
      },
    },
  },
} satisfies Meta<typeof ConstellationChoice>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { name: "선택 가능" };
export const Selected: Story = { name: "선택됨", args: { selected: true } };
export const Fading: Story = { name: "선택되지 않은 항목", args: { fading: true } };
