import type { Meta, StoryObj } from "@storybook/react-vite";
import { ShapeBackground, type WidgetShape } from "@comet/ui";

const base: WidgetShape = {
  source: "preset",
  preset: "01",
  cloudCount: 4,
  roundness: 70,
  rotation: 0,
  flipX: false,
  flipY: false,
  fitContent: true,
  width: 200,
  height: 120,
  strokes: [],
};

const meta = {
  title: "UI/Widgets/ShapeBackground",
  component: ShapeBackground,
  tags: ["autodocs"],
  args: { shape: base, color: "#2b4a7a" },
  argTypes: {
    shape: { control: "object" },
    color: { control: "color" },
    image: { control: "text" },
    position: { control: "text" },
    style: { control: false },
  },
  decorators: [
    (Story, { args }) => (
      <div style={{ position: "relative", width: args.shape.width, height: args.shape.height }}>
        <Story />
      </div>
    ),
  ],
  parameters: {
    docs: {
      description: {
        component:
          "위젯 모양을 부모 상자에 맞춰 채우는 SVG 배경입니다. 프리셋·구름 조절값·직접 그린 점을 같은 24×24 좌표로 그리고 회전과 뒤집기를 적용합니다. 이미지가 있으면 모양으로 잘라 position에 맞춰 채웁니다.",
      },
    },
  },
} satisfies Meta<typeof ShapeBackground>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Preset: Story = { name: "프리셋" };
export const Cloud: Story = {
  name: "구름 조절",
  args: { shape: { ...base, preset: "cloud", cloudCount: 6, roundness: 40, rotation: 8 } },
};
export const Drawing: Story = {
  name: "직접 그린 모양",
  args: {
    shape: {
      ...base,
      source: "drawing",
      strokes: [
        [
          { x: 2, y: 5 },
          { x: 9, y: 1 },
          { x: 22, y: 4 },
          { x: 23, y: 18 },
          { x: 12, y: 23 },
          { x: 1, y: 19 },
        ],
      ],
    },
  },
};
