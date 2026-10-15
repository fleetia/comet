import type { Meta, StoryObj } from "@storybook/react-vite";
import { iconNames } from "@comet/icon";
import { ActionChip } from "@comet/ui";

const meta = {
  title: "UI/Chips/ActionChip",
  component: ActionChip,
  tags: ["autodocs"],
  args: { children: "기록 보기", icon: "page", disabled: false },
  argTypes: {
    children: { control: "text" },
    icon: { control: "select", options: [undefined, ...iconNames] },
  },
  parameters: {
    docs: {
      description: {
        component:
          "가벼운 동작을 실행하는 작은 native 버튼입니다. 아이콘은 보이는 텍스트를 보조합니다. 선택 상태가 필요한 동작에는 ToggleChip을 사용하세요.",
      },
    },
  },
} satisfies Meta<typeof ActionChip>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = { name: "기본" };
export const TextOnly: Story = { name: "텍스트만", args: { icon: undefined } };
export const Disabled: Story = { name: "비활성", args: { disabled: true } };
