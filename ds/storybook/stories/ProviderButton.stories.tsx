import type { Meta, StoryObj } from "@storybook/react-vite";
import { ProviderButton } from "@comet/ui";
const meta = {
  title: "UI/Actions/ProviderButton",
  component: ProviderButton,
  tags: ["autodocs"],
  argTypes: {
    disabled: { control: "boolean" },
  },
  args: { children: "ChatGPT" },
  parameters: {
    docs: {
      description: {
        component:
          "제공자 선택에 쓰는 표시 버튼입니다. 인증·로그인·외부 연결 동작은 소비자가 onClick으로 연결합니다.",
      },
    },
  },
} satisfies Meta<typeof ProviderButton>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = {};
export const Disabled: Story = { args: { disabled: true } };
