import type { Meta, StoryObj } from "@storybook/react-vite";
import { RadioRow } from "@comet/ui";
const meta = {
  title: "UI/controls/RadioRow",
  component: RadioRow,
  tags: ["autodocs"],
  argTypes: {
    layout: { control: "select", options: ["compact", "app-usage", "date", "option"] },
    disabled: { control: "boolean" },
    leading: { control: false },
    defaultChecked: { control: "boolean" },
  },
  args: { label: "Microsoft Word", layout: "app-usage", name: "program", value: "word" },
  parameters: {
    docs: {
      description: {
        component:
          "native Radio를 조합합니다. 같은 name의 상호 배제와 키보드 동작을 유지하고 측정이나 프로그램 접근은 하지 않습니다.",
      },
    },
  },
} satisfies Meta<typeof RadioRow>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = {};
export const Disabled: Story = { args: { disabled: true } };
export const Date: Story = {
  args: { layout: "date", label: "내일 · 10월 16일 (금)", defaultChecked: true },
};
export const None: Story = { args: { layout: "option", label: "측정하지 않음" } };
