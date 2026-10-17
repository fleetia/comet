import type { Meta, StoryObj } from "@storybook/react-vite";
import { AppUsageSummary } from "@comet/ui";
const meta = {
  title: "UI/widgets/AppUsageSummary",
  component: AppUsageSummary,
  tags: ["autodocs"],
  args: { style: { width: 278 } },
  argTypes: {
    program: {
      control: "text",
    },
    onChoose: {
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
          "집중 설정에서 선택한 프로그램을 요약하는 표시입니다. 고르기 콜백만 전달하며 프로그램 목록이나 사용 시간을 읽지 않습니다.",
      },
    },
  },
} satisfies Meta<typeof AppUsageSummary>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Unselected: Story = { name: "선택 전" };
export const Selected: Story = { name: "선택됨", args: { program: "Microsoft Word" } };
