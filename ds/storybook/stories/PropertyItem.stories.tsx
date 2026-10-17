import type { Meta, StoryObj } from "@storybook/react-vite";
import { PropertyItem } from "@comet/ui";
const meta = {
  title: "UI/controls/PropertyItem",
  component: PropertyItem,
  tags: ["autodocs"],
  argTypes: {
    disabled: { control: "boolean" },
    selected: { control: "boolean" },
    label: { control: "text" },
    valueLabel: { control: "text" },
    icon: { control: false },
  },
  args: { label: "스티커", valueLabel: "별", selected: false },
  parameters: {
    docs: {
      description: {
        component:
          "속성 선택용 native button입니다. label·valueLabel·icon은 내용, selected는 선택 상태이며 편집 로직을 포함하지 않습니다.",
      },
    },
  },
} satisfies Meta<typeof PropertyItem>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = {};
export const Disabled: Story = { args: { disabled: true } };
export const Selected: Story = { args: { selected: true } };
