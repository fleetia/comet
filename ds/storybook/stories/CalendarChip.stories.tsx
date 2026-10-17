import type { Meta, StoryObj } from "@storybook/react-vite";
import { CalendarChip } from "@comet/ui";
const meta = {
  title: "UI/controls/CalendarChip",
  component: CalendarChip,
  tags: ["autodocs"],
  argTypes: {
    disabled: { control: "boolean" },
    muted: { control: "boolean" },
  },
  args: { children: "개인", muted: false },
  parameters: {
    docs: {
      description: {
        component: "달력 범례의 켜짐·음소거 표시 컴포넌트입니다. muted 값은 소비자가 관리합니다.",
      },
    },
  },
} satisfies Meta<typeof CalendarChip>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = {};
export const Disabled: Story = { args: { disabled: true } };
export const Muted: Story = { args: { muted: true } };
