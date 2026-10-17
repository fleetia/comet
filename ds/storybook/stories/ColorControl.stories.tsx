import type { Meta, StoryObj } from "@storybook/react-vite";
import { ColorControl } from "@comet/ui";
const meta = {
  title: "UI/controls/ColorControl",
  component: ColorControl,
  tags: ["autodocs"],
  argTypes: {
    appearance: { control: "select", options: ["hue", "lightness"] },
    disabled: { control: "boolean" },
    hue: { control: "number" },
    min: { control: "number" },
    max: { control: "number" },
    step: { control: "number" },
  },
  args: { label: "색상각", defaultValue: 168 },
  parameters: {
    docs: {
      description: {
        component:
          "native range로 색상각과 명도 입력을 제공합니다. 색상값과 저장은 소비자가 관리하며 onChange·min·max·step·폼 동작을 유지합니다.",
      },
    },
  },
} satisfies Meta<typeof ColorControl>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = {};
export const Disabled: Story = { args: { disabled: true } };
export const Lightness: Story = {
  args: { label: "명도", appearance: "lightness", defaultValue: 45, hue: 168 },
};
