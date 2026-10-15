import type { Meta, StoryObj } from "@storybook/react-vite";
import { iconNames } from "@comet/icon";
import { IconButton } from "@comet/ui";

const meta = {
  title: "UI/Actions/IconButton",
  component: IconButton,
  tags: ["autodocs"],
  args: {
    icon: "bell",
    "aria-label": "알림",
    variant: "ghost",
    size: "regular",
    selected: false,
    disabled: false,
  },
  argTypes: {
    icon: { control: "select", options: iconNames },
    variant: { control: "radio", options: ["primary", "ghost", "surface"] },
    size: { control: "radio", options: ["compact", "regular"] },
    "aria-label": {
      control: "text",
      description: "보이는 텍스트를 대신하는 필수 접근 가능한 이름",
    },
  },
  parameters: {
    docs: {
      description: {
        component:
          "아이콘만 보이는 native 버튼입니다. aria-label 또는 aria-labelledby 중 하나를 반드시 제공합니다. 아이콘 SVG는 장식용으로 유지됩니다. selected=true는 선택 표현과 aria-pressed=true를 적용합니다. 꺼짐도 표현하는 토글에서는 aria-pressed=false도 명시하세요.",
      },
    },
  },
} satisfies Meta<typeof IconButton>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = { name: "기본" };
export const Selected: Story = { name: "선택", args: { selected: true, "aria-pressed": true } };
export const Primary: Story = { name: "강조", args: { variant: "primary" } };
export const Compact: Story = { name: "작은 크기", args: { size: "compact" } };
export const Surface: Story = {
  name: "화면 탐색",
  args: { variant: "surface", size: "compact", icon: "chevleft", "aria-label": "이전 날짜" },
};
export const Disabled: Story = { name: "비활성", args: { disabled: true } };
