import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Icon } from "@comet/icon";
import { Button, ChecklistAdd, EnvelopeHeader, TaskRow } from "@comet/ui";
import { RecordsStack } from "./RecordsAssets";
const meta = {
  title: "UI/Records/EnvelopeHeader",
  component: EnvelopeHeader,
  tags: ["autodocs"],
  args: {
    title: "책 모임",
    description: "오늘 오후 2:00 – 3:00 · comet 일정",
    completed: 3,
    total: 5,
    eventHref: "#event",
    actions: (
      <>
        <Button variant="ghost" leadingIcon={<Icon name="timer" size={15} />}>
          25분 집중 시작
        </Button>
        <Button variant="ghost">준비를 마치고 보관</Button>
      </>
    ),
  },
  argTypes: {
    completed: { control: { type: "number", min: 0 } },
    total: { control: { type: "number", min: 0 } },
    onChangeDate: { control: false, action: "날짜 바꾸기" },
    onOpenEvent: { control: false, action: "연결한 일정 열기" },
    disabled: { control: "boolean" },
    actions: { control: false },
  },
  parameters: {
    docs: {
      description: {
        component:
          "Envelope/Header의 제목·일정·진행률과 소비자가 조합한 동작 버튼입니다. 체크리스트 행은 TaskRow의 envelope layout으로 제공합니다. 날짜 편집·집중 시작·보관·추가 입력은 콜백 또는 슬롯으로 연결합니다.",
      },
    },
  },
} satisfies Meta<typeof EnvelopeHeader>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Header: Story = {};
export const ChecklistStates: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <RecordsStack>
      <TaskRow
        layout="envelope"
        title="책 모임 질문 두 개 적기"
        completed={false}
        completionLabel="책 모임 질문 두 개 적기 완료"
        due="오후 1:30까지 · 지남"
        overdue
      />
      <TaskRow
        layout="envelope"
        title="반납할 책 가방에 넣기"
        completed={false}
        completionLabel="반납할 책 가방에 넣기 완료"
        due="오늘"
      />
      <TaskRow layout="envelope" title="빌린 책" completed completionLabel="빌린 책 완료" />
      <RecordQuickChecklist />
    </RecordsStack>
  ),
};

function RecordQuickChecklist() {
  const [value, setValue] = useState("");
  return <ChecklistAdd value={value} onValueChange={setValue} onAdd={() => setValue("")} />;
}
