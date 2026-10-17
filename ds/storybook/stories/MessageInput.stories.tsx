import type { Meta, StoryObj } from "@storybook/react-vite";
import { MessageInput } from "@comet/ui";
const meta = {
  title: "UI/controls/MessageInput",
  component: MessageInput,
  tags: ["autodocs"],
  argTypes: {
    layout: { control: "select", options: ["fill", "hug"] },
    disabled: { control: "boolean" },
  },
  args: { label: "메시지", defaultValue: "좋아, 십 분만 쉬자." },
  parameters: {
    docs: {
      description: {
        component:
          "메시지 표시 폭과 글자 크기를 가지는 native input입니다. 전송이나 대화 상태는 연결하지 않습니다.",
      },
    },
  },
} satisfies Meta<typeof MessageInput>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = {};
export const Disabled: Story = { args: { disabled: true } };
export const Hug: Story = { args: { layout: "hug" } };
