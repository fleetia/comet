import type { Meta, StoryObj } from "@storybook/react-vite";
import { WidgetCreationProgress } from "@comet/ui";

const meta = {
  title: "UI/widgets/WidgetCreationProgress",
  component: WidgetCreationProgress,
  tags: ["autodocs"],
  args: {
    request: "뜨개질 단수 세고, 목표까지 얼마나 남았는지 보여 줘",
    steps: [
      { id: "request", label: "요청 읽기", state: "complete" },
      { id: "layout", label: "화면 구성 정하기", state: "complete" },
      { id: "action", label: "동작 만들기", state: "active" },
      { id: "inspect", label: "안전하게 실행되는지 검사", state: "pending" },
    ],
  },
  argTypes: {
    title: {
      control: "text",
    },
    request: {
      control: "text",
    },
    steps: {
      control: "object",
    },
    onCancel: {
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
          "Figma AI 위젯 만들기에서 분리한 진행 표시입니다. 단계와 상태를 받아 표시하며 생성·설치·가져오기 흐름이나 코드를 실행하지 않습니다.",
      },
    },
  },
} satisfies Meta<typeof WidgetCreationProgress>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { name: "만드는 중" };
