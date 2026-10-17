import type { Meta, StoryObj } from "@storybook/react-vite";
import { FocusTimerWidget, Checkbox } from "@comet/ui";

const meta = {
  title: "UI/widgets/FocusTimerWidget",
  component: FocusTimerWidget,
  tags: ["autodocs"],
  args: {
    phase: "ready",
    view: "expanded",
    task: "기획서 초안 다듬기",
    time: "25:00",
    duration: 25,
    progress: 0,
    timeDescription: "오후 3:18 → 3:43",
  },
  argTypes: {
    phase: {
      control: "select",
      options: ["ready", "running", "complete", "rest", "rest-complete"],
    },
    view: {
      control: "select",
      options: ["expanded", "collapsed"],
    },
    presentation: { control: "select", options: ["dial", "digits"] },
    startDisabled: { control: "boolean" },
    setup: { control: false },
    customDuration: { control: false },
    afterControls: { control: false },
    title: {
      control: "text",
    },
    task: {
      control: "text",
    },
    time: {
      control: "text",
    },
    timeDescription: {
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
    duration: {
      control: {
        type: "number",
        min: 1,
      },
    },
    durations: {
      control: false,
    },
    paused: {
      control: "boolean",
    },
    note: {
      control: "text",
    },
    completion: {
      control: false,
    },
    summary: {
      control: false,
    },
    footer: {
      control: false,
    },
    onDurationChange: {
      control: false,
    },
    onTaskChange: {
      control: false,
    },
    onStart: {
      control: false,
    },
    onPause: {
      control: false,
    },
    onStop: {
      control: false,
    },
    onSkipRest: {
      control: false,
    },
    onContinue: {
      control: false,
    },
    onCollapse: {
      control: false,
    },
    onExpand: {
      control: false,
    },
    onNoteChange: {
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
          "집중 전·집중 중·완료·휴식·휴식 완료의 표시와 콜백을 제공합니다. phase·time·progress는 소비자가 계산해서 전달합니다. 스스로 시간을 재거나 집중 상태를 바꾸지 않습니다. 완료 할 일과 요약은 슬롯으로 조합합니다.",
      },
    },
  },
} satisfies Meta<typeof FocusTimerWidget>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Ready: Story = { name: "집중 전" };
export const Running: Story = {
  name: "집중 중",
  args: { phase: "running", time: "18:42", progress: 0.77, timeDescription: "오후 3:43에 끝나요" },
};
export const Paused: Story = {
  name: "일시정지",
  args: { phase: "running", paused: true, time: "18:42", progress: 0.77 },
};
export const Complete: Story = {
  name: "집중 끝",
  args: {
    phase: "complete",
    timeDescription: "오후 3:18 → 3:43 · 25분 집중",
    completion: <Checkbox label="기획서 마무리 완료로 표시" />,
    summary: "휴식 5분 시작 · 오후 3:48까지 · 4:58",
  },
};
export const Rest: Story = {
  name: "휴식 중",
  args: { phase: "rest", time: "4:06", progress: 0.82, timeDescription: "오후 3:48에 끝나요" },
};
export const RestComplete: Story = {
  name: "휴식 끝",
  args: { phase: "rest-complete", summary: "오늘 집중 2번 · 1시간 25분" },
};
export const Collapsed: Story = { name: "접힌 표시", args: { view: "collapsed" } };
export const Digits: Story = { name: "숫자판", args: { presentation: "digits" } };
export const LongerBreak: Story = {
  name: "다른 휴식 길이",
  args: { phase: "rest-complete", timeDescription: "쉬는 시간 10분이 끝났어요" },
};
