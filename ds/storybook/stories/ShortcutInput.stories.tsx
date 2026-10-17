import type { Meta, StoryObj } from "@storybook/react-vite";
import { ShortcutInput } from "@comet/ui";
const meta = {
  title: "UI/controls/ShortcutInput",
  component: ShortcutInput,
  tags: ["autodocs"],
  argTypes: {
    disabled: { control: "boolean" },
    label: { control: "text" },
    placeholder: { control: "text" },
    defaultValue: { control: "object" },
    value: { control: false },
  },
  args: { label: "열기 단축키", defaultValue: ["Meta", "Shift", "Space"] },
  parameters: {
    docs: {
      description: {
        component:
          "포커스된 버튼에서 키 조합을 입력합니다. onShortcutChange는 키 배열을 전달하며 전역 단축키를 등록하지 않습니다. Tab·Escape와 IME 조합은 가로채지 않습니다.",
      },
    },
  },
} satisfies Meta<typeof ShortcutInput>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = {};
export const Disabled: Story = { args: { disabled: true } };
