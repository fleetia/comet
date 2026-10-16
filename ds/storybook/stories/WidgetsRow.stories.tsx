import type { Meta, StoryObj } from "@storybook/react-vite";
import { WidgetRow } from "@comet/ui";

const meta = {
  title: "UI/Widgets/WidgetRow",
  component: WidgetRow,
  tags: ["autodocs"],
  args: {
    kind: "focus",
    title: "집중 중",
    description: "기획서 초안 다듬기",
    value: "18:42",
    phase: "running",
    layout: "row",
    surface: "translucent",
  },
  argTypes: {
    kind: {
      control: "select",
      options: ["focus", "clock", "weather", "music", "envelope"],
    },
    icon: {
      control: "select",
      options: [undefined, "clock", "cloud", "timer", "music", "envelope", "hash", "memo"],
    },
    title: {
      control: "text",
    },
    period: { control: "text" },
    description: {
      control: "text",
    },
    value: {
      control: "text",
    },
    meta: {
      control: false,
    },
    phase: {
      control: "select",
      options: ["ready", "running", "complete", "rest", "rest-complete"],
    },
    layout: {
      control: "select",
      options: ["row", "editor", "stack", "compact", "desktop", "flow"],
    },
    surface: {
      control: "select",
      options: ["plain", "translucent", "glow"],
    },
    disabled: {
      control: "boolean",
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
          "위젯의 공통 한 줄 버튼입니다. 시간·음악·날씨·준비 봉투·집중 상태는 전달된 표시값으로 렌더링합니다. editor·stack·compact·desktop·flow 배치와 plain·translucent·glow 표면을 제공합니다. 타이머나 외부 연결을 실행하지 않습니다.",
      },
    },
  },
} satisfies Meta<typeof WidgetRow>;
export default meta;
type Story = StoryObj<typeof meta>;
export const FocusRunning: Story = { name: "집중 중" };
export const Clock: Story = {
  name: "시계",
  args: {
    kind: "clock",
    title: "3:24",
    period: "오후",
    description: undefined,
    value: undefined,
    meta: (
      <>
        D+42
        <br />
        함께 지내기 시작한 날
      </>
    ),
  },
};
export const Weather: Story = {
  name: "날씨",
  args: {
    kind: "weather",
    title: "23°",
    description: undefined,
    value: undefined,
    meta: (
      <>
        서울 · 구름 조금
        <br />
        10분 전에 확인
      </>
    ),
  },
};
export const Music: Story = {
  name: "음악",
  args: {
    kind: "music",
    title: "밤의 산책",
    description: "별빛정원 · Apple Music에서 재생 중",
    value: undefined,
    meta: "2:06 / 4:12",
  },
};
export const Envelope: Story = {
  name: "준비 봉투",
  args: {
    kind: "envelope",
    title: "가족 여행",
    description: "10월 24일 (토) · 준비 봉투",
    value: "2/9",
  },
};
export const Ready: Story = {
  name: "집중 전",
  args: { title: "집중 타이머", phase: "ready", value: "25:00" },
};
export const Complete: Story = {
  name: "집중 끝",
  args: {
    title: "집중 끝",
    phase: "complete",
    description: "할 일 완료를 골라 주세요",
    value: "4:58",
  },
};
export const Rest: Story = {
  name: "휴식 중",
  args: { title: "휴식 중", phase: "rest", description: "오후 3:48에 끝나요", value: "4:06" },
};
export const RestComplete: Story = {
  name: "휴식 끝",
  args: {
    title: "휴식 끝",
    phase: "rest-complete",
    description: "다시 시작할까요?",
    value: "25:00",
  },
};
export const Stack: Story = { name: "스택", args: { layout: "stack" } };
export const Compact: Story = { name: "작게", args: { layout: "compact" } };
export const Editor: Story = { name: "편집기", args: { layout: "editor", surface: "plain" } };
export const Desktop: Story = { name: "데스크톱", args: { layout: "desktop" } };
export const Flow: Story = { name: "짧은 행", args: { layout: "flow" } };
export const Glow: Story = { name: "빛 표면", args: { surface: "glow" } };
export const Disabled: Story = { name: "비활성", args: { disabled: true } };

export const ClockLongAnniversary: Story = {
  name: "좁은 시계 · 긴 기념일",
  args: {
    ...Clock.args,
    title: "12:59:59",
    period: "오후",
    layout: "stack",
    style: { width: 330 },
    meta: (
      <>
        <strong>D-day</strong>
        <br />
        qa anniversary long title 0123456789
      </>
    ),
  },
};
export const ClockLongAnniversaryEditor: Story = {
  name: "좁은 시계 편집 · 긴 기념일",
  args: { ...ClockLongAnniversary.args, layout: "editor" },
};
