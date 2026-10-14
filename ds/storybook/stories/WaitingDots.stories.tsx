import type { Meta, StoryObj } from "@storybook/react-vite";
import { WaitingDots } from "@comet/ui";

const meta = {
  title: "UI/Display/WaitingDots",
  component: WaitingDots,
  tags: ["autodocs"],
  args: { label: "응답을 기다리고 있어요" },
  argTypes: { label: { control: "text" } },
  parameters: {
    docs: {
      description: {
        component:
          "세 기다림 점을 1200ms ease-pulse로 표시합니다. 각 점은 160ms씩 늦게 시작합니다. role=status와 label이 대기 상태를 알리고 시각적인 점은 장식으로 처리합니다. 움직임 줄이기에서는 세 점이 모두 멈춘 채 보입니다. 실제 처리 상태와 표시 여부는 소비자가 소유합니다.",
      },
    },
  },
} satisfies Meta<typeof WaitingDots>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = { name: "기다림" };
export const ReducedMotion: Story = {
  name: "움직임 줄이기",
  render: (args) => (
    <div data-comet-motion="reduced">
      <WaitingDots {...args} />
    </div>
  ),
};
