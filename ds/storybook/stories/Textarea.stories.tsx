import type { Meta, StoryObj } from "@storybook/react-vite";
import { Textarea } from "@comet/ui";

const meta = {
  title: "UI/controls/Textarea",
  component: Textarea,
  tags: ["autodocs"],
  args: {
    label: "메모",
    placeholder: "기억할 내용을 적어주세요",
    rows: 4,
    description: "줄바꿈을 포함한 텍스트를 입력합니다.",
    disabled: false,
    layout: "compact",
  },
  argTypes: {
    layout: {
      control: "select",
      options: ["compact", "fixed", "flexible", "code-compact", "plain", "code-padded"],
    },
    label: { control: "text" },
    description: { control: "text" },
    error: { control: "text" },
    fill: { control: "boolean", description: "부모 폭 채우기" },
  },
  parameters: {
    docs: {
      description: {
        component:
          "native textarea입니다. Enter로 줄바꿈하며 rows, maxLength, readOnly 등 표준 속성을 전달할 수 있습니다. label·설명·오류 연결은 TextInput과 같습니다. fill은 부모 폭을 채우고 높이는 rows와 레이아웃의 최소 높이를 따릅니다.",
      },
    },
  },
} satisfies Meta<typeof Textarea>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = { name: "기본" };
export const Filled: Story = {
  name: "여러 줄",
  args: { defaultValue: "별이 보이는 저녁.\n하던 일을 잠시 적어둡니다." },
};
export const Layouts: Story = {
  name: "Figma 레이아웃",
  render: (args) => (
    <div className="comet-catalog-stack">
      {(["compact", "fixed", "flexible", "code-compact", "plain", "code-padded"] as const).map(
        (layout) => (
          <Textarea {...args} key={layout} layout={layout} label={layout} />
        ),
      )}
    </div>
  ),
};
export const Invalid: Story = { name: "오류", args: { error: "메모를 입력해 주세요." } };
export const Disabled: Story = { name: "비활성", args: { disabled: true } };
export const Fill: Story = {
  name: "부모 폭 채우기",
  args: { fill: true, layout: "flexible", rows: 3, description: undefined },
  decorators: [(Story) => <div style={{ width: 420 }}>{Story()}</div>],
};
