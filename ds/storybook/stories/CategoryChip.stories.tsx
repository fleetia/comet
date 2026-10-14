import type { Meta, StoryObj } from "@storybook/react-vite";
import { CategoryChip } from "@comet/ui";

const meta = {
  title: "UI/Chips/CategoryChip",
  component: CategoryChip,
  tags: ["autodocs"],
  args: { category: "work" },
  argTypes: {
    category: {
      control: "select",
      options: ["work", "record", "life", "exercise", "rest", "focus"],
    },
    children: { control: "text" },
  },
  parameters: {
    docs: {
      description: {
        component:
          "Figma의 일·기록·생활·운동·쉼·집중 분류 색상입니다. 색상과 보이는 문구를 함께 전달하며 children으로 문구를 바꿀 수 있습니다. 클릭 동작은 없는 표시용 칩입니다.",
      },
    },
  },
} satisfies Meta<typeof CategoryChip>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = { name: "기본" };
export const Categories: Story = {
  name: "모든 분류",
  render: () => (
    <div className="comet-catalog-row">
      {(["work", "record", "life", "exercise", "rest", "focus"] as const).map((category) => (
        <CategoryChip key={category} category={category} />
      ))}
    </div>
  ),
};
