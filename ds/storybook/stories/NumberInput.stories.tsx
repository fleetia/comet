import type { Meta, StoryObj } from "@storybook/react-vite";
import { NumberInput } from "@comet/ui";
const meta = {
  title: "UI/Inputs/NumberInput",
  component: NumberInput,
  tags: ["autodocs"],
  argTypes: {
    disabled: { control: "boolean" },
  },
  args: { label: "개수", defaultValue: 3, min: 0, max: 99 },
  parameters: {
    docs: {
      description: { component: "브라우저의 number 입력과 min·max·step·폼 동작을 유지합니다." },
    },
  },
} satisfies Meta<typeof NumberInput>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = {};
export const Disabled: Story = { args: { disabled: true } };
