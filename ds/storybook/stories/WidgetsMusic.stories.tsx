import type { Meta, StoryObj } from "@storybook/react-vite";
import { MusicWidget } from "@comet/ui";

const meta = {
  title: "UI/Widgets/MusicWidget",
  component: MusicWidget,
  tags: ["autodocs"],
  args: {
    title: "밤의 산책",
    artist: "별빛정원",
    elapsed: "2:06",
    duration: "4:12",
    progress: 0.5,
    shareEnabled: true,
  },
  argTypes: {
    title: {
      control: "text",
    },
    artist: {
      control: "text",
    },
    elapsed: {
      control: "text",
    },
    duration: {
      control: "text",
    },
    progress: {
      control: {
        type: "range",
        min: 0,
        max: 1,
        step: 0.01,
      },
    },
    shareEnabled: {
      control: "boolean",
    },
    artwork: {
      control: false,
    },
    onCollapse: {
      control: false,
    },
    onDiscuss: {
      control: false,
    },
    onOpenPlayer: {
      control: false,
    },
    onShareChange: {
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
          "음악 제목·아티스트·재생 위치와 앱 열기·대화 콜백을 조합합니다. 음악 정보 읽기나 재생 제어는 소비자가 담당합니다. 공유 스위치는 controlled prop입니다.",
      },
    },
  },
} satisfies Meta<typeof MusicWidget>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { name: "음악 정보" };
export const SharingOff: Story = { name: "대화 연결 꺼짐", args: { shareEnabled: false } };
