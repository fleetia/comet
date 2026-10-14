import type { Meta, StoryObj } from "@storybook/react-vite";
import { Switch } from "@comet/ui";

const meta = {
  title: "UI/Inputs/Switch",
  component: Switch,
  tags: ["autodocs"],
  args: { label: "바탕화면 표시", description: "캐릭터를 바탕화면에 표시합니다.", disabled: false },
  argTypes: {
    label: { control: "text" },
    description: { control: "text" },
    error: { control: "text" },
  },
  parameters: {
    docs: {
      description: {
        component:
          "native checkbox를 switch 의미로 제공합니다. 즉시 켜거나 끄는 설정에 사용하고 Space로 토글합니다. 실제 설정 저장은 소비자의 onChange에서 처리하세요. 선택 상태는 defaultChecked 또는 checked로 전달합니다.",
      },
    },
  },
} satisfies Meta<typeof Switch>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = { name: "꺼짐" };
export const On: Story = { name: "켜짐", args: { defaultChecked: true } };
export const DisabledOff: Story = { name: "비활성 · 꺼짐", args: { disabled: true } };
export const DisabledOn: Story = {
  name: "비활성 · 켜짐",
  args: { disabled: true, defaultChecked: true },
};
