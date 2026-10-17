import type { Meta, StoryObj } from "@storybook/react-vite";
import { ColorPicker } from "@comet/ui";
import { useEffect, useState } from "react";
function PickerDemo(args: React.ComponentProps<typeof ColorPicker>): React.JSX.Element {
  const [value, setValue] = useState(args.value);
  useEffect(() => {
    setValue(args.value);
  }, [args.value]);
  return <ColorPicker {...args} value={value} onValueChange={setValue} />;
}
const meta = {
  title: "UI/overlays/ColorPicker",
  component: ColorPicker,
  tags: ["autodocs"],
  args: { value: "#77D9CA" },
  argTypes: {
    value: {
      control: "color",
    },
    colors: {
      control: false,
    },
    label: {
      control: "text",
    },
    onValueChange: {
      control: false,
    },
    className: {
      control: false,
    },
    style: {
      control: false,
    },
  },
  parameters: {
    docs: {
      description: {
        component:
          "팔레트·색조·채도와 밝기·HEX 입력을 제공합니다. 채도와 밝기 영역은 방향키로 조절하고 Shift로 크게 이동합니다. value와 onValueChange를 연결하며 다른 색상 버튼은 native 색상 선택기를 엽니다. 팝오버 열기·배치·바깥 클릭 처리는 소비자가 담당합니다.",
      },
    },
  },
} satisfies Meta<typeof ColorPicker>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { name: "민트" };
export const Primary: Story = { name: "별빛", args: { value: "#FFCC33" } };
export const Interactive: Story = { name: "색상 연결", render: (args) => <PickerDemo {...args} /> };
