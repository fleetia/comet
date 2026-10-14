import type { Meta, StoryObj } from "@storybook/react-vite";
import { iconNames } from "@comet/icon";
import { ToggleChip } from "@comet/ui";

const meta = {
  title: "UI/Chips/ToggleChip",
  component: ToggleChip,
  tags: ["autodocs"],
  args: { children: "즐겨찾기", icon: "star", defaultPressed: false, disabled: false },
  argTypes: {
    children: { control: "text" },
    icon: { control: "select", options: [undefined, ...iconNames] },
    onPressedChange: { control: false },
  },
  parameters: {
    docs: {
      description: {
        component:
          "켜짐·꺼짐을 선택하는 토글 버튼입니다. aria-pressed가 현재 상태를 전달합니다. defaultPressed는 초기값이고 제어 모드에서는 pressed와 onPressedChange를 함께 사용합니다. 클릭·Enter·Space로 전환합니다.",
      },
    },
  },
} satisfies Meta<typeof ToggleChip>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = { name: "꺼짐 · 눌러서 전환" };
export const On: Story = { name: "켜짐", args: { defaultPressed: true } };
export const Disabled: Story = { name: "비활성", args: { disabled: true } };
