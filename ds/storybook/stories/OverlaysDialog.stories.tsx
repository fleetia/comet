import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button, Dialog, TextInput, type DialogProps } from "@comet/ui";

function DialogDemo(props: Omit<DialogProps, "isOpen" | "onOpenChange">) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        다시 열기
      </Button>
      <Dialog {...props} isOpen={open} onOpenChange={setOpen} />
    </>
  );
}

const meta = {
  title: "UI/overlays/Dialog",
  component: Dialog,
  tags: ["autodocs"],
  render: (args) => <DialogDemo {...args} />,
  args: {
    title: "할 일 편집",
    isOpen: true,
    onOpenChange: () => undefined,
    children: <TextInput aria-label="제목" defaultValue="영수증 정리하기" />,
    footer: (
      <>
        <Button variant="ghost">취소</Button>
        <Button>완료</Button>
      </>
    ),
  },
  argTypes: {
    variant: { control: "inline-radio", options: ["sheet", "confirm"] },
    size: { control: "inline-radio", options: ["small", "medium", "large"] },
    title: { control: "text" },
    closeLabel: { control: "text" },
    isOpen: { control: false },
    onOpenChange: { control: false },
    children: { control: false },
    footer: { control: false },
    initialFocusRef: { control: false },
    className: { control: false },
    style: { control: false },
  },
  parameters: {
    layout: "centered",
    docs: {
      story: { inline: false, height: "360px" },
      description: {
        component:
          "네이티브 dialog를 모달로 열고 제목으로 이름을 붙입니다. Escape·바깥 클릭·닫기 버튼은 onOpenChange(false)를 호출하고, 닫히면 연 요소로 포커스를 돌려줍니다. sheet는 편집 패널, confirm은 닫기 버튼 없이 짧은 질문과 같은 너비의 작업을 둡니다. 저장·삭제 같은 실제 처리는 소비자가 담당합니다.",
      },
    },
  },
} satisfies Meta<typeof Dialog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Sheet: Story = { name: "시트" };
export const LargeSheet: Story = { name: "넓은 시트", args: { size: "large" } };
export const Confirm: Story = {
  name: "확인",
  args: {
    variant: "confirm",
    title: "작성 중인 내용이 있어요",
    children: "저장하지 않고 닫으면 지금 쓴 내용이 사라져요.",
    footer: (
      <>
        <Button variant="ghost">계속 편집</Button>
        <Button>버리고 닫기</Button>
      </>
    ),
  },
};
export const DestructiveConfirm: Story = {
  name: "삭제 확인",
  args: {
    variant: "confirm",
    title: "메모를 삭제할까요?",
    children: "삭제한 메모는 되돌릴 수 없어요.",
    footer: (
      <>
        <Button variant="ghost">취소</Button>
        <Button variant="danger">삭제</Button>
      </>
    ),
  },
};
