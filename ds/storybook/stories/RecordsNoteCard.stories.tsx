import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { NoteCard } from "@comet/ui";

const meta = {
  title: "UI/records/NoteCard",
  component: NoteCard,
  tags: ["autodocs"],
  args: {
    title: "작은 생각",
    timestamp: "오후 3:20",
    description: "오늘 떠오른 문장을 적어 두기.",
    tag: "바탕화면에 있어요",
    kind: "desktop",
    selected: true,
  },
  argTypes: {
    kind: { control: "radio", options: ["desktop", "envelope", "focus"] },
    layout: { control: "radio", options: ["card", "preview", "plain"] },
    selected: { control: "boolean" },
    disabled: { control: "boolean" },
    onClick: { control: false, action: "선택" },
  },
  parameters: {
    docs: {
      description: {
        component:
          "Note/Card와 Card/Note Preview의 내용·연결 태그·선택 상태입니다. selected는 소비자가 관리합니다. kind는 태그의 의미와 아이콘을 바꾸며 layout은 원본 카드·미리보기·태그 없는 미리보기를 구분합니다. 버튼 안에 추가 인터랙티브 요소를 넣지 않습니다.",
      },
    },
  },
} satisfies Meta<typeof NoteCard>;
export default meta;
type Story = StoryObj<typeof meta>;
export const DesktopSelected: Story = {};
export const EnvelopeLinked: Story = {
  args: {
    selected: false,
    kind: "envelope",
    title: "책 모임 아이디어",
    timestamp: "어제",
    description: "좋았던 문장 하나씩 골라오기.",
    tag: "책 모임",
  },
};
export const FocusLinked: Story = {
  args: {
    selected: false,
    kind: "focus",
    title: "집중 노트 · 기획서 초안",
    timestamp: "오전 11:30",
    description: "목차는 셋으로 줄이기.",
    tag: "집중 기록에서",
  },
};
export const PreviewSelected: Story = { args: { layout: "preview" } };
export const PreviewEnvelope: Story = {
  args: { layout: "preview", selected: false, kind: "envelope", tag: "책 모임" },
};
export const PreviewFocus: Story = {
  args: { layout: "preview", selected: false, kind: "focus", tag: "집중 기록에서" },
};
export const PlainPreview: Story = { args: { layout: "plain", selected: false } };
export const Disabled: Story = { args: { disabled: true } };
export const Selection: Story = {
  parameters: { controls: { disable: true } },
  render: (args) => {
    const [selected, setSelected] = useState(false);
    return <NoteCard {...args} selected={selected} onClick={() => setSelected(!selected)} />;
  },
};
