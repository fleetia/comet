import type { Meta, StoryObj } from "@storybook/react-vite";
import { WeatherWidget } from "@comet/ui";

const meta = {
  title: "UI/widgets/WeatherWidget",
  component: WeatherWidget,
  tags: ["autodocs"],
  args: {
    temperature: "23°",
    condition: "구름 조금",
    location: "서울",
    tomorrow: "내일 비 · 16°C / 22°C",
  },
  argTypes: {
    temperature: {
      control: "text",
    },
    condition: {
      control: "text",
    },
    location: {
      control: "text",
    },
    tomorrow: { control: "text" },
    shape: { control: "object" },
    backgroundImage: { control: "text" },
    backgroundColor: { control: "color" },
    textColor: { control: "color" },
    contentStyle: { control: false },
    imagePosition: { control: "text" },
    fallbackPreset: { control: "text" },
    className: {
      control: false,
    },
    style: {
      control: false,
    },
  },
  parameters: {
    docs: {
      description: { component: "원본 구름 모양의 날씨 표시입니다. 날씨 API를 호출하지 않습니다." },
    },
  },
} satisfies Meta<typeof WeatherWidget>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { name: "자유 배치" };
export const EditedCloud: Story = {
  name: "모양 편집",
  args: {
    shape: {
      source: "preset",
      preset: "cloud",
      cloudCount: 6,
      roundness: 40,
      rotation: 12,
      flipX: true,
      flipY: false,
      fitContent: true,
      width: 230,
      height: 150,
      strokes: [],
    },
  },
};
export const DrawnOutline: Story = {
  name: "직접 그린 모양",
  args: {
    shape: {
      source: "drawing",
      preset: "default",
      cloudCount: 4,
      roundness: 70,
      rotation: 0,
      flipX: false,
      flipY: false,
      fitContent: true,
      width: 230,
      height: 150,
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
export const ResizedArtwork: Story = {
  name: "기본 모양 크기 변경",
  args: {
    shape: {
      source: "preset",
      preset: "default",
      cloudCount: 4,
      roundness: 70,
      rotation: 0,
      flipX: false,
      flipY: false,
      fitContent: true,
      width: 320,
      height: 180,
      strokes: [],
    },
  },
};
export const RecolouredDefault: Story = {
  name: "기본 모양 색 변경",
  args: {
    backgroundColor: "#2b4a7a",
    textColor: "#ffffff",
    fallbackPreset: "cloud",
    shape: {
      source: "preset",
      preset: "default",
      cloudCount: 4,
      roundness: 70,
      rotation: 0,
      flipX: false,
      flipY: false,
      fitContent: true,
      width: 230,
      height: 150,
      strokes: [],
    },
  },
};
