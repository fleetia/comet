import type { Meta, StoryObj } from "@storybook/react-vite";
import { URLInput } from "@comet/ui";
const meta = {
  title: "UI/Inputs/URLInput",
  component: URLInput,
  tags: ["autodocs"],
  argTypes: {
    disabled: { control: "boolean" },
  },
  args: { label: "링크", defaultValue: "https://example.com" },
  parameters: {
    docs: {
      description: {
        component:
          "native URL 입력의 검증과 폼 동작을 보존하며 외부 링크를 자동으로 열지 않습니다.",
      },
    },
  },
} satisfies Meta<typeof URLInput>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = {};
export const Disabled: Story = { args: { disabled: true } };
