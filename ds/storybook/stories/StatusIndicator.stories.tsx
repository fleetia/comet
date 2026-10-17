import type { Meta, StoryObj } from "@storybook/react-vite";
import { StatusIndicator } from "@comet/ui";

const meta = {
  title: "UI/display/StatusIndicator",
  component: StatusIndicator,
  tags: ["autodocs"],
  args: { children: "연결됨", pulse: false },
  argTypes: { children: { control: "text" }, pulse: { control: "boolean" } },
  parameters: {
    docs: {
      description: {
        component:
          "작은 점과 텍스트로 상태를 표시합니다. 안정적인 상태에서는 점이 멈춰 있습니다. 연결 확인 등 진행 중인 상태에 pulse=true를 사용하면 1200ms ease-pulse로 밝아지고 어두워지며 움직임 줄이기에서는 멈춥니다. 기본 role=status로 동적인 문구 변경을 알립니다. 점 색상에만 의존하지 않고 상태를 텍스트로 적어주세요. 실제 연결 상태를 수집하지는 않습니다.",
      },
    },
  },
} satisfies Meta<typeof StatusIndicator>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = { name: "기본" };
export const CustomLabel: Story = {
  name: "문구 변경",
  args: { children: "변경사항이 저장되었어요" },
};
export const Pending: Story = {
  name: "연결 확인 중",
  args: { children: "연결 확인 중", pulse: true },
};
