import type { Meta, StoryObj } from "@storybook/react-vite";
import { Balloon, Button } from "@comet/ui";

const meta = {
  title: "UI/Conversation/Balloon",
  component: Balloon,
  tags: ["autodocs"],
  args: { children: "헤헤, 간지러워.", speaker: "byulkkori", tail: "left", content: "text" },
  argTypes: {
    speaker: {
      control: "select",
      options: ["byulkkori", "nadir", "moon-rabbit"],
    },
    speakerName: {
      control: "text",
    },
    tail: {
      control: "select",
      options: ["left", "center", "right", "none"],
    },
    content: {
      control: "select",
      options: ["text", "actions", "result", "typing"],
    },
    children: {
      control: "text",
    },
    actions: {
      control: false,
    },
    result: {
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
          "캐릭터 이름·본문·꼬리 위치를 조합하는 작은 말풍선입니다. actions와 result는 소비자가 구성하고 typing 상태의 대기 표시는 접근 가능한 status를 제공합니다. 원문의 공백과 줄바꿈을 보존합니다.",
      },
    },
  },
} satisfies Meta<typeof Balloon>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Byulkkori: Story = { name: "별꼬리" };
export const Nadir: Story = {
  name: "나디르",
  args: { speaker: "nadir", children: "주사위 한 판이에요." },
};
export const MoonRabbit: Story = {
  name: "달토끼",
  args: { speaker: "moon-rabbit", children: "안녕! 잠깐 놀러 왔어." },
};
export const Actions: Story = {
  name: "선택 행동",
  args: {
    speaker: "nadir",
    content: "actions",
    children: "제가 이겼네요. 한 판 더 할래요?",
    actions: (
      <>
        <Button size="small" variant="ghost">
          그만
        </Button>
        <Button size="small">한 판 더</Button>
      </>
    ),
  },
};
export const Result: Story = {
  name: "결과",
  args: {
    content: "result",
    children: "정리해 뒀어!",
    result: (
      <>
        <span>이 요청의 정리 결과</span>
        <span>✓ 저장됨</span>
      </>
    ),
  },
};
export const Typing: Story = {
  name: "입력 중",
  args: { speaker: "nadir", content: "typing", tail: "center", children: "같은 음절인데" },
};
export const CenterTail: Story = {
  name: "가운데 꼬리",
  args: { tail: "center", children: "여기 있어." },
};
export const RightTail: Story = {
  name: "오른쪽 꼬리",
  args: { tail: "right", children: "저쪽이야." },
};
export const OriginalText: Story = {
  name: "공백과 줄바꿈",
  args: { children: "오늘  떠오른 말\n다음 줄도 그대로" },
};
