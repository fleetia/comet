import type { Meta, StoryObj } from "@storybook/react-vite";
import { ColorSwatch } from "@comet/ui";
const meta = {
  title: "UI/choices/ColorSwatch",
  component: ColorSwatch,
  tags: ["autodocs"],
  argTypes: {
    size: { control: "select", options: [20, 22, 26] },
    edge: { control: "select", options: ["flat", "inset"] },
    disabled: { control: "boolean" },
    selected: { control: "boolean" },
    color: { control: "color" },
    label: { control: "text" },
  },
  args: { label: "민트", color: "#77d9ca", size: 26, selected: false },
  parameters: {
    docs: {
      description: {
        component:
          "이름이 있는 native 색상 선택 버튼입니다. 색상값·선택·저장은 소비자가 관리하고 size·edge로 표시 변형을 제공합니다.",
      },
    },
  },
} satisfies Meta<typeof ColorSwatch>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = {};
export const Selected: Story = { args: { selected: true } };
export const Disabled: Story = { args: { disabled: true } };
export const Sizes: Story = {
  render: () => (
    <div className="comet-catalog-row">
      {([20, 22, 26] as const).map((size) => (
        <ColorSwatch key={size} label={`민트 ${size}`} color="#77d9ca" size={size} edge="inset" />
      ))}
    </div>
  ),
};
