import type { Meta, StoryObj } from "@storybook/react-vite";
import { TimerCometTrail } from "@comet/ui";

const meta = {
  title: "UI/Widgets/TimerCometTrail",
  component: TimerCometTrail,
  tags: ["autodocs"],
  args: { center: 80, radius: 72, angle: Math.PI * 1.2 },
  argTypes: {
    center: { control: { type: "number", min: 0 } },
    radius: { control: { type: "number", min: 0 } },
    angle: { control: { type: "range", min: 0, max: Math.PI * 2, step: 0.01 } },
  },
  decorators: [
    (Story, { args }) => (
      <svg
        width={args.center * 2}
        height={args.center * 2}
        viewBox={`0 0 ${args.center * 2} ${args.center * 2}`}
        aria-hidden
      >
        <circle
          cx={args.center}
          cy={args.center}
          r={args.radius}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.2}
          strokeWidth={6}
        />
        <Story />
      </svg>
    ),
  ],
  parameters: {
    docs: {
      description: {
        component:
          "집중 타이머 원판의 진행 끝에 붙는 혜성 꼬리 그림입니다. SVG 안에서 중심·반지름·각도(라디안)에 맞춰 회전하고 크기를 맞춥니다.",
      },
    },
  },
} satisfies Meta<typeof TimerCometTrail>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { name: "진행 중" };
export const LargeDial: Story = { name: "큰 원판", args: { center: 94, radius: 85, angle: 0 } };
