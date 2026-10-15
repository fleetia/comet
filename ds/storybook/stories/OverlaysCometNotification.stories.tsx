import type { Meta, StoryObj } from "@storybook/react-vite";
import { CometNotification } from "@comet/ui";

const meta = {
  title: "UI/Overlays/CometNotification",
  component: CometNotification,
  tags: ["autodocs"],
  args: {
    title: "메모에 저장했어요",
    description: "다음 이야기에서 꺼내 볼 수 있어요.",
    status: "saved",
    actions: [
      { id: "open", label: "메모 열기" },
      { id: "return", label: "대화로 돌아가기", primary: true },
    ],
  },
  argTypes: {
    title: {
      control: "text",
    },
    description: {
      control: "text",
    },
    status: {
      control: "select",
      options: ["save-failed", "stopped", "capacity-reached", "saved"],
    },
    hasTail: {
      control: "boolean",
    },
    actions: {
      control: "object",
    },
    onAction: {
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
          "앱 안의 짧은 결과 알림입니다. 저장 실패는 alert, 나머지는 status로 안내하며 행동은 onAction으로 전달합니다. 자동 재시도·저장·창 열기 동작을 실행하지 않습니다.",
      },
    },
  },
} satisfies Meta<typeof CometNotification>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Saved: Story = { name: "저장됨" };
export const SaveFailed: Story = {
  name: "저장 실패",
  args: {
    title: "저장을 확인하지 못해 답하지 않았어요",
    description: "할 일을 저장했다는 확인을 받지 못했어요. 보낸 내용은 남아 있어요.",
    status: "save-failed",
    actions: [
      { id: "edit", label: "입력 수정" },
      { id: "retry", label: "다시 요청", primary: true },
    ],
  },
};
export const Stopped: Story = {
  name: "멈춤",
  args: {
    title: "생성을 멈췄어요",
    description: "보낸 내용은 남아 있어요. 앱을 다시 켜도 여기서 이어서 요청해요.",
    status: "stopped",
    actions: [
      { id: "edit", label: "입력 수정" },
      { id: "continue", label: "다시 이어가기", primary: true },
    ],
  },
};
export const CapacityReached: Story = {
  name: "가득 참",
  args: {
    title: "자리가 없어 만들기가 들어오지 못했어요",
    description: "함께 지내는 친구와 찾아온 친구는 합쳐서 8명까지예요.",
    status: "capacity-reached",
    hasTail: false,
    actions: [{ id: "friends", label: "친구 구성 열기" }],
  },
};
