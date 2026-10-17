import type { Meta, StoryObj } from "@storybook/react-vite";
import { AppUsagePicker } from "@comet/ui";

const meta = {
  title: "UI/widgets/AppUsagePicker",
  component: AppUsagePicker,
  tags: ["autodocs"],
  args: {
    value: "word",
    options: [
      { id: "none", name: "측정하지 않음" },
      { id: "code", name: "Visual Studio Code" },
      { id: "figma", name: "Figma" },
      { id: "word", name: "Microsoft Word" },
      { id: "memo", name: "메모장" },
    ],
  },
  argTypes: {
    value: {
      control: "text",
    },
    options: {
      control: "object",
    },
    description: {
      control: "text",
    },
    onValueChange: {
      control: false,
    },
    onSave: {
      control: false,
    },
    onRefresh: {
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
          "측정할 프로그램을 고르는 native radio 목록입니다. 실제 프로그램 검색이나 사용 시간 측정을 포함하지 않고 선택값·새로고침·저장 콜백을 전달합니다.",
      },
    },
  },
} satisfies Meta<typeof AppUsagePicker>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { name: "프로그램 목록" };
export const NoSelection: Story = { name: "측정하지 않음", args: { value: "none" } };
