import { useId, useState, type CSSProperties, type JSX } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { Balloon, Button, type BalloonProps } from "@comet/ui";
import { ArrowRightIcon } from "@comet/icon";

const UPDATE_SPEECH_STYLE = {
  fontSize: 19,
  lineHeight: 1.65,
  wordBreak: "keep-all",
} satisfies CSSProperties;

const meta = {
  title: "UI/conversation/Balloon",
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
    tailClassName: { control: false },
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
    speechTrigger: {
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
          "캐릭터 이름·본문·꼬리 위치를 조합하는 작은 말풍선입니다. actions와 result는 소비자가 구성하고 typing 상태의 대기 표시는 접근 가능한 status를 제공합니다. speechTrigger를 전달하면 본문을 키보드로 누를 수 있는 버튼으로 표시하며 펼침 상태와 이동 동작은 소비자가 관리합니다. 원문의 공백과 줄바꿈을 보존합니다.",
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

export const UpdateNoticeCollapsed: Story = {
  name: "업데이트 알림 · 접힘",
  args: {
    children: "새로운 업데이트가 있어요!",
    speechTrigger: { "aria-expanded": false, style: UPDATE_SPEECH_STYLE },
  },
};

export const UpdateNoticeExpanded: Story = {
  name: "업데이트 알림 · 펼침",
  args: {
    content: "actions",
    children: "새로운 업데이트가 있어요!",
    speechTrigger: {
      "aria-expanded": true,
      "aria-controls": "update-notice-example-action",
      style: UPDATE_SPEECH_STYLE,
    },
    actions: (
      <Button
        id="update-notice-example-action"
        variant="link"
        trailingIcon={<ArrowRightIcon size={14} />}
        style={{ marginLeft: "auto" }}
      >
        이동하기
      </Button>
    ),
  },
};

function UpdateNoticeExample(args: BalloonProps): JSX.Element {
  const actionId = useId();
  const [isExpanded, setIsExpanded] = useState(false);
  const [hasNavigated, setHasNavigated] = useState(false);
  return (
    <>
      <Balloon
        {...args}
        content={isExpanded ? "actions" : "text"}
        speechTrigger={{
          "aria-expanded": isExpanded,
          "aria-controls": isExpanded ? actionId : undefined,
          style: UPDATE_SPEECH_STYLE,
          onClick: () => setIsExpanded(true),
        }}
        actions={
          isExpanded && (
            <Button
              id={actionId}
              variant="link"
              trailingIcon={<ArrowRightIcon size={14} />}
              style={{ marginLeft: "auto" }}
              onClick={() => setHasNavigated(true)}
            >
              이동하기
            </Button>
          )
        }
      />
      {hasNavigated && <p role="status">업데이트 화면으로 이동해요.</p>}
    </>
  );
}

export const UpdateNoticeInteractive: Story = {
  name: "업데이트 알림 · 버튼 펼치기",
  args: { children: "새로운 업데이트가 있어요!" },
  render: (args) => <UpdateNoticeExample {...args} />,
  parameters: {
    docs: {
      description: {
        story:
          "말풍선 본문을 클릭하거나 Enter·Space로 누르면 우하단에 Button/Link 컴포넌트의 이동하기 → 텍스트 액션이 나타납니다. 이동하기는 소비자가 업데이트 화면에 연결하며, 이 예제에서는 이동 안내를 표시합니다.",
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup({ document: canvasElement.ownerDocument });
    const trigger = canvas.getByRole("button", { name: "새로운 업데이트가 있어요!" });
    await expect(canvas.queryByRole("button", { name: "이동하기" })).toBeNull();
    await user.tab();
    await expect(trigger).toHaveFocus();
    await user.keyboard("{Enter}");
    const action = canvas.getByRole("button", { name: "이동하기" });
    await expect(action).toBeVisible();
    await user.tab();
    await expect(action).toHaveFocus();
    await user.click(action);
    await expect(canvas.getByRole("status")).toHaveTextContent("업데이트 화면으로 이동해요.");
  },
};
