import type { Meta, StoryObj } from "@storybook/react-vite";
import { TimeInput } from "@comet/ui";
const meta = {
  title: "UI/Inputs/TimeInput",
  component: TimeInput,
  tags: ["autodocs"],
  argTypes: {
    disabled: { control: "boolean" },
  },
  args: { label: "시각", defaultValue: "22:00" },
  parameters: {
    docs: {
      description: {
        component:
          "native time 입력입니다. 값은 HH:mm 형식이며 표시와 키보드는 브라우저·운영체제 규칙을 따릅니다.",
      },
    },
  },
} satisfies Meta<typeof TimeInput>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = {};
export const Disabled: Story = { args: { disabled: true } };
