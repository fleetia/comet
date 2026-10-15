import type { Meta, StoryObj } from "@storybook/react-vite";
import { CounterButton } from "@comet/ui";
const meta = {
  title: "UI/Actions/CounterButton",
  component: CounterButton,
  tags: ["autodocs"],
  argTypes: {
    size: { control: "select", options: ["regular", "compact"] },
    badgeSize: { control: "select", options: ["small", "medium"] },
    disabled: { control: "boolean" },
    backdrop: { control: "boolean" },
    label: { control: "text" },
    count: { control: "number" },
  },
  args: { label: "위젯", count: 6, icon: "together" },
  parameters: {
    docs: {
      description: {
        component:
          "아이콘과 배지의 표시를 결합한 native button입니다. 접근 가능한 이름에 개수를 포함하고 저장이나 위젯 실행은 하지 않습니다.",
      },
    },
  },
} satisfies Meta<typeof CounterButton>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = {};
export const Disabled: Story = { args: { disabled: true } };
export const Compact: Story = { args: { size: "compact" } };
export const MediumBadge: Story = { args: { badgeSize: "medium", backdrop: false } };
