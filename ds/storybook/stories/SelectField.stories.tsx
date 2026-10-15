import type { Meta, StoryObj } from "@storybook/react-vite";
import { Icon } from "@comet/icon";
import { SelectField } from "@comet/ui";
const meta = {
  title: "UI/Inputs/SelectField",
  component: SelectField,
  tags: ["autodocs"],
  argTypes: {
    layout: { control: "select", options: ["inline", "compact", "fill", "spaced"] },
    controlSize: { control: "select", options: [30, 32, 34, 36] },
    disabled: { control: "boolean" },
    leading: { control: false },
    children: { control: false },
  },
  args: {
    label: "분류",
    defaultValue: "life",
    children: [
      <option key="life" value="life">
        생활
      </option>,
      <option key="work" value="work">
        일
      </option>,
    ],
  },
  parameters: {
    docs: {
      description: {
        component:
          "native Select를 재사용합니다. 옵션은 children, 장식은 leading으로 전달합니다. 옵션 내용 자산을 별도 공개 컴포넌트로 늘리지 않습니다.",
      },
    },
  },
} satisfies Meta<typeof SelectField>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = {};
export const Disabled: Story = { args: { disabled: true } };
export const Fill: Story = { args: { layout: "fill", controlSize: 34 } };
export const Compact: Story = { args: { layout: "compact", controlSize: 34 } };

export const WithLeading: Story = { args: { leading: <Icon name="envelope" size={14} /> } };
