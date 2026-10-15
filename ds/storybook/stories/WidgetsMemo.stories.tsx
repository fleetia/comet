import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoWidget } from "@comet/ui";

const meta = {
  title: "UI/Widgets/MemoWidget",
  component: MemoWidget,
  tags: ["autodocs"],
  args: { title: "작은 생각", children: "오늘 떠오른 문장을 적어 두기.\n다음에 이어서 생각해요." },
  argTypes: {
    title: {
      control: "text",
    },
    children: {
      control: "text",
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
        component: "원본 접힌 메모 모양을 사용하며 입력한 본문과 줄바꿈을 그대로 표시합니다.",
      },
    },
  },
} satisfies Meta<typeof MemoWidget>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { name: "자유 배치" };
