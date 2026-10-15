import { useState } from "react";
import { useArgs } from "storybook/preview-api";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { RecordQuickAdd, TextInput, type RecordQuickAddProps } from "@comet/ui";
const meta = {
  title: "UI/Records/QuickAdd",
  component: RecordQuickAdd,
  tags: ["autodocs"],
  args: {
    value: "",
    kind: "memo",
    kinds: [
      { value: "memo", label: "— 메모" },
      { value: "task", label: "• 할 일" },
      { value: "event", label: "○ 일정" },
    ],
    onValueChange: () => {},
    onKindChange: () => {},
    onAdd: () => {},
  },
  argTypes: {
    value: { control: "text" },
    kind: { control: "select", options: ["memo", "task", "event"] },
    kinds: { control: "object" },
    disabled: { control: "boolean" },
    onValueChange: { control: false },
    onKindChange: { control: false },
    onAdd: { control: false, action: "기록 추가" },
  },
  render: (args) => {
    const [, updateArgs] = useArgs<RecordQuickAddProps>();
    return (
      <RecordQuickAdd
        {...args}
        onValueChange={(value) => {
          updateArgs({ value });
          args.onValueChange(value);
        }}
        onKindChange={(kind) => {
          updateArgs({ kind });
          args.onKindChange(kind);
        }}
      />
    );
  },
  parameters: {
    docs: {
      description: {
        component:
          "기록 종류는 native select, 내용은 native input입니다. 값·종류는 소비자가 관리합니다. Enter로 제출하면 공백만 있는 입력을 제외하고 원문 value와 kind를 onAdd에 전달하며 저장·초기화는 소비자가 결정합니다.",
      },
    },
  },
} satisfies Meta<typeof RecordQuickAdd>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const Editable: Story = {
  parameters: { controls: { disable: true } },
  render: (args) => {
    const [value, setValue] = useState("");
    const [kind, setKind] = useState("memo");
    const [last, setLast] = useState("");
    return (
      <div>
        <RecordQuickAdd
          {...args}
          value={value}
          kind={kind}
          onValueChange={setValue}
          onKindChange={setKind}
          onAdd={(content, selectedKind) => {
            setLast(`${selectedKind}: ${content}`);
            setValue("");
          }}
        />
        <p aria-live="polite">{last}</p>
      </div>
    );
  },
};
export const Disabled: Story = { args: { value: "초안을 보존합니다.", disabled: true } };
export const CollectionPage: Story = {
  args: {
    layout: "page",
    kind: "memo",
    label: "페이지에 기록할 내용",
    placeholder: "제목이나 한 줄 감상 · Enter로 기록",
  },
  parameters: { controls: { disable: true } },
  render: (args) => {
    const [value, setValue] = useState("");
    const [date, setDate] = useState("2026-10-15");
    const [last, setLast] = useState("");
    return (
      <div style={{ width: "min(680px, 100%)" }}>
        <RecordQuickAdd
          {...args}
          value={value}
          onValueChange={setValue}
          trailing={
            <TextInput
              type="date"
              aria-label="기록 날짜"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          }
          onAdd={(content) => {
            setLast(`${date || "날짜 없음"}: ${content}`);
            setValue("");
          }}
        />
        <p aria-live="polite">{last}</p>
      </div>
    );
  },
};
