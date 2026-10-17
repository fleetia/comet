import type { Meta, StoryObj } from "@storybook/react-vite";
import { CategoryChoice } from "@comet/ui";
const meta = {
  title: "UI/controls/CategoryChoice",
  component: CategoryChoice,
  tags: ["autodocs"],
  argTypes: {
    category: {
      control: "select",
      options: ["work", "record", "life", "exercise", "rest", "focus"],
    },
    size: { control: "select", options: ["regular", "compact", "medium"] },
    selected: { control: "boolean" },
    disabled: { control: "boolean" },
    children: { control: "text" },
  },
  args: { category: "life", children: "생활", selected: false },
  parameters: {
    docs: {
      description: {
        component:
          "CategoryChip을 재사용한 선택 버튼입니다. 분류 내용은 props로 전달하고 size·selected로 구조·상태를 구분합니다.",
      },
    },
  },
} satisfies Meta<typeof CategoryChoice>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = {};
export const Disabled: Story = { args: { disabled: true } };
export const Selected: Story = { args: { selected: true } };
export const Compact: Story = { args: { size: "compact", selected: true } };
export const Medium: Story = { args: { size: "medium", selected: true } };
