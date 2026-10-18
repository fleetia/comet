import { useState, type JSX } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { ActionReceipt, type ActionReceiptProps } from "@comet/ui";

const meta = {
  title: "UI/conversation/ActionReceipt",
  component: ActionReceipt,
  tags: ["autodocs"],
  args: { title: "컵라면 · 3,000원", onOpen: fn(), onUndo: fn() },
  decorators: [
    (Story) => (
      <div style={{ width: 290, maxWidth: "100%" }}>
        <Story />
      </div>
    ),
  ],
  parameters: {
    docs: {
      description: {
        component:
          "위젯 실행 결과의 제목과 열기·되돌리기를 표시합니다. undoSupported를 생략한 기존 결과는 되돌릴 수 있으며, 지원하지 않는 결과는 이유를 설명합니다. 데이터 저장과 되돌리기는 소비자가 처리합니다.",
      },
    },
  },
} satisfies Meta<typeof ActionReceipt>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Saved: Story = { name: "완료" };
export const Pending: Story = { name: "처리 중", args: { pending: true } };
export const Undone: Story = { name: "되돌림", args: { undone: true } };
export const UndoUnavailable: Story = {
  name: "되돌리기 불가",
  args: {
    title: "집중 시작",
    undoSupported: false,
    undoReason: "실행 중인 집중은 위젯에서 멈출 수 있어요.",
  },
};
export const LongTitle: Story = {
  name: "긴 결과와 설명",
  args: {
    title: "팀 회의 뒤 편의점에서 산 컵라면과 음료 · 3,000원",
    undoSupported: false,
    undoReason:
      "이후에 다른 화면에서 수정한 기록은 여기서 되돌릴 수 없어요. 열기에서 기록을 확인해 주세요.",
  },
};

function InteractiveReceipt(args: ActionReceiptProps): JSX.Element {
  const [undone, setUndone] = useState(false);
  return (
    <ActionReceipt
      {...args}
      undone={undone}
      onUndo={() => {
        args.onUndo();
        setUndone(true);
      }}
    />
  );
}

export const KeyboardActions: Story = {
  name: "키보드로 열고 되돌리기",
  render: (args) => <InteractiveReceipt {...args} />,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup({ document: canvasElement.ownerDocument });
    await user.tab();
    await expect(canvas.getByRole("button", { name: "열기" })).toHaveFocus();
    await user.keyboard("{Enter}");
    await expect(args.onOpen).toHaveBeenCalledOnce();
    await user.tab();
    await expect(canvas.getByRole("button", { name: "되돌리기" })).toHaveFocus();
    await user.keyboard(" ");
    await expect(args.onUndo).toHaveBeenCalledOnce();
    await expect(canvas.getByRole("status")).toHaveTextContent("되돌림");
    await expect(canvas.getByRole("button", { name: "되돌리기" })).toBeDisabled();
  },
};
