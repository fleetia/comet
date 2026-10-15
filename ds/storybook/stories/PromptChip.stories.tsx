import type { Meta, StoryObj } from "@storybook/react-vite";
import { PromptChip } from "@comet/ui";
const meta = {
  title: "UI/Chips/PromptChip",
  component: PromptChip,
  tags: ["autodocs"],
  argTypes: {
    disabled: { control: "boolean" },
  },
  args: { children: "물 마신 잔 세기" },
  parameters: {
    docs: {
      description: {
        component: "문구를 전달하는 재사용 ActionChip 변형입니다. 입력·전송은 소비자가 연결합니다.",
      },
    },
  },
} satisfies Meta<typeof PromptChip>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = {};
export const Disabled: Story = { args: { disabled: true } };
