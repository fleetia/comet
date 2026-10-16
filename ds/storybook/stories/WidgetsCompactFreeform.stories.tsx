import type { Meta, StoryObj } from "@storybook/react-vite";
import { CompactFreeform } from "@comet/ui";

const meta = {
  title: "UI/Widgets/CompactFreeform",
  component: CompactFreeform,
  tags: ["autodocs"],
  args: { icon: "check", label: "2 / 5", "aria-label": "할 일 2 / 5" },
  argTypes: {
    icon: { control: "text" },
    label: { control: "text" },
    shape: { control: "object" },
    backgroundImage: { control: "text" },
    backgroundColor: { control: "color" },
    textColor: { control: "color" },
    imagePosition: { control: "text" },
    fallbackPreset: { control: "text" },
    contentStyle: { control: false },
    onClick: { control: false, action: "열기" },
    className: { control: false },
    style: { control: false },
  },
  parameters: {
    docs: {
      description: {
        component:
          "전용 그림이 없는 위젯을 아이콘과 한 줄 값으로 보여 주는 작은 자유 배치 버튼입니다. 모양이 없으면 fallbackPreset(기본 캡슐) 모양을 그리고, 누르면 onClick으로 알립니다.",
      },
    },
  },
} satisfies Meta<typeof CompactFreeform>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { name: "캡슐" };
export const CustomShape: Story = {
  name: "모양과 색 변경",
  args: {
    icon: "calendar",
    label: "오후 3:00",
    "aria-label": "캘린더 오후 3:00",
    backgroundColor: "#3b2c78",
    textColor: "#ffffff",
    shape: {
      source: "preset",
      preset: "21",
      cloudCount: 4,
      roundness: 70,
      rotation: 0,
      flipX: false,
      flipY: false,
      fitContent: true,
      width: 140,
      height: 48,
      strokes: [],
    },
  },
};
