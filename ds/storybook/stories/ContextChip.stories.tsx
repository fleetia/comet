import type { Meta, StoryObj } from "@storybook/react-vite";
import { iconNames } from "@comet/icon";
import { ContextChip } from "@comet/ui";

const meta = {
  title: "UI/Chips/ContextChip",
  component: ContextChip,
  tags: ["autodocs"],
  args: { children: "오늘", icon: "calendar" },
  argTypes: {
    children: { control: "text" },
    icon: { control: "select", options: [undefined, ...iconNames] },
  },
  parameters: {
    docs: {
      description: {
        component:
          "날짜·연결·문맥 정보를 나타내는 표시용 칩입니다. 텍스트와 선택적인 아이콘을 조합하며 버튼이나 필터 의미를 갖지 않습니다.",
      },
    },
  },
} satisfies Meta<typeof ContextChip>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = { name: "기본" };
export const TextOnly: Story = {
  name: "텍스트만",
  args: { icon: undefined, children: "선택한 기록" },
};
