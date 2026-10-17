import { useState, type JSX } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Slider } from "@comet/ui";

function ControlledSlider(): JSX.Element {
  const [value, setValue] = useState(40);
  return (
    <div className="comet-catalog-stack">
      <Slider
        label="투명도"
        min={0}
        max={100}
        step={5}
        value={value}
        onChange={(event) => setValue(Number(event.target.value))}
      />
      <output aria-live="polite">투명도 {value}%</output>
    </div>
  );
}

const meta = {
  title: "UI/controls/Slider",
  component: Slider,
  tags: ["autodocs"],
  args: {
    label: "크기",
    min: 0,
    max: 100,
    step: 1,
    defaultValue: 50,
    disabled: false,
    description: "방향키로 값을 조절할 수 있습니다.",
  },
  argTypes: {
    label: { control: "text" },
    description: { control: "text" },
    error: { control: "text" },
  },
  parameters: {
    docs: {
      description: {
        component:
          "native input type=range입니다. min·max·step을 전달하고 방향키나 Home·End로 조절합니다. defaultValue를 사용하거나 value와 onChange를 연결하세요. 현재 수치를 보여줄 필요가 있으면 소비자가 output을 함께 제공합니다.",
      },
    },
  },
} satisfies Meta<typeof Slider>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = { name: "기본" };
export const WithValue: Story = { name: "현재 값 표시", render: () => <ControlledSlider /> };
export const Stepped: Story = {
  name: "단계",
  args: { label: "배율", min: 1, max: 5, step: 1, defaultValue: 3 },
};
export const Disabled: Story = { name: "비활성", args: { disabled: true } };
