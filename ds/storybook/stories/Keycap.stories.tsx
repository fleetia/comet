import type { Meta, StoryObj } from "@storybook/react-vite";
import { Keycap } from "@comet/ui";

const meta = {
  title: "UI/Display/Keycap",
  component: Keycap,
  tags: ["autodocs"],
  args: { children: "Enter" },
  argTypes: { children: { control: "text" } },
  parameters: {
    docs: {
      description: {
        component:
          "단축키 표시에 쓰는 native kbd 요소입니다. 실제 키 이벤트는 등록하지 않습니다. 기호가 모호하면 aria-label에 키 이름을 제공합니다.",
      },
    },
  },
} satisfies Meta<typeof Keycap>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = { name: "단일 키" };
export const Combination: Story = {
  name: "조합",
  render: () => (
    <p className="comet-catalog-row">
      <Keycap aria-label="Command">⌘</Keycap>
      <span>+</span>
      <Keycap>K</Keycap>
      <span>빠른 메뉴</span>
    </p>
  ),
};
