import type { Meta, StoryObj } from "@storybook/react-vite";
import { ContextMenu } from "@comet/ui";

const meta = {
  title: "UI/overlays/ContextMenu",
  component: ContextMenu,
  tags: ["autodocs"],
  args: {
    actions: [
      { id: "memo", label: "메모에 남기기" },
      { id: "continue", label: "다음에 이어갈 내용으로" },
      { id: "quote", label: "대사로 등록" },
    ],
  },
  argTypes: {
    actions: {
      control: "object",
    },
    label: {
      control: "text",
    },
    onAction: {
      control: false,
    },
    onDismiss: {
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
          "메뉴 항목의 선택 콜백과 키보드 이동을 제공합니다. 위아래 방향키·Home·End로 이동하고 Escape로 onDismiss를 호출합니다. 실제 대상의 변경과 위치·포커스 복원은 소비자가 담당합니다.",
      },
    },
  },
} satisfies Meta<typeof ContextMenu>;
export default meta;
type Story = StoryObj<typeof meta>;
export const SelectedSpeech: Story = { name: "선택한 대사" };
export const Pet: Story = {
  name: "캐릭터",
  args: {
    actions: [
      { id: "feed", label: "먹이 주기" },
      { id: "pet", label: "쓰다듬기" },
      { id: "home", label: "집으로 보내기", separatorBefore: true },
    ],
  },
};
export const WidgetElement: Story = {
  name: "위젯 요소",
  args: {
    style: { width: 132 },
    actions: [
      { id: "sticker", label: "스티커" },
      { id: "anniversary", label: "기념일" },
      { id: "time", label: "시간" },
      { id: "date", label: "날짜" },
      { id: "background", label: "배경" },
    ],
  },
};
export const Disabled: Story = {
  name: "사용할 수 없는 항목",
  args: {
    actions: [
      { id: "open", label: "원문 열기", disabled: true },
      { id: "remove", label: "연결 해제", destructive: true },
    ],
  },
};
