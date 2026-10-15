import type { Meta, StoryObj } from "@storybook/react-vite";
import { BellIcon } from "@comet/icon";
import { Button } from "@comet/ui";

const meta = {
  title: "UI/Actions/Button",
  component: Button,
  tags: ["autodocs"],
  args: { children: "저장", variant: "primary", size: "regular", disabled: false },
  argTypes: {
    variant: {
      control: "select",
      options: ["primary", "ghost", "selected", "link", "danger"],
      table: { defaultValue: { summary: "primary" } },
    },
    size: {
      control: "radio",
      options: ["regular", "small"],
      table: { defaultValue: { summary: "regular" } },
    },
    children: { control: "text" },
    leadingIcon: { control: false },
    trailingIcon: { control: false },
  },
  parameters: {
    docs: {
      description: {
        component:
          'Figma Button의 다섯 표현과 두 크기입니다. native button을 사용하며 기본 type은 button입니다. Enter·Space로 실행하고 disabled일 때는 포커스와 클릭이 차단됩니다. 폼 제출에는 type="submit"을 명시하세요.',
      },
    },
  },
} satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = { name: "기본" };
export const Variants: Story = {
  name: "표현",
  render: (args) => (
    <div className="comet-catalog-row">
      {(["primary", "ghost", "selected", "link", "danger"] as const).map((variant) => (
        <Button {...args} key={variant} variant={variant}>
          {variant}
        </Button>
      ))}
    </div>
  ),
};
export const Small: Story = { name: "작은 크기", args: { size: "small" } };
export const WithIcon: Story = {
  name: "아이콘과 함께",
  args: { leadingIcon: <BellIcon />, children: "알림 확인" },
};
export const Disabled: Story = { name: "비활성", args: { disabled: true } };
