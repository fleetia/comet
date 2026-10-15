import type { Meta, StoryObj } from "@storybook/react-vite";
import { AmountInput } from "@comet/ui";
const meta = {
  title: "UI/Inputs/AmountInput",
  component: AmountInput,
  tags: ["autodocs"],
  argTypes: {
    typography: { control: "select", options: ["strong", "regular", "compact"] },
    disabled: { control: "boolean" },
  },
  args: { label: "지출 금액", defaultValue: "4,500" },
  parameters: {
    docs: {
      description: {
        component:
          "금액 문자열을 자동 변환하지 않습니다. 통화·구분자·검증과 저장은 소비자가 관리하며 입력 커서와 원문을 보존합니다.",
      },
    },
  },
} satisfies Meta<typeof AmountInput>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = {};
export const Disabled: Story = { args: { disabled: true } };
export const Regular: Story = { args: { typography: "regular" } };
export const Compact: Story = { args: { typography: "compact" } };
