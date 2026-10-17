import type { Meta, StoryObj } from "@storybook/react-vite";
import { ReferenceMemo } from "@comet/ui";

const meta = {
  title: "UI/conversation/ReferenceMemo",
  component: ReferenceMemo,
  tags: ["autodocs"],
  args: { title: "책 모임 아이디어" },
  argTypes: {
    title: {
      control: "text",
    },
    onOpen: {
      control: false,
    },
    onReplace: {
      control: false,
    },
    onRemove: {
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
          "입력에 참고할 메모를 표시합니다. 원문 열기·교체·연결 해제는 각각의 콜백으로 전달하며 메모 내용을 읽거나 수정하지 않습니다.",
      },
    },
  },
} satisfies Meta<typeof ReferenceMemo>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { name: "참고 중" };
export const LongTitle: Story = {
  name: "긴 메모 제목",
  args: { title: "책 모임에서 함께 이야기하고 싶은 아이디어를 모아 두기" },
};
