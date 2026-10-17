import type { Meta, StoryObj } from "@storybook/react-vite";
import { OrbitBreadcrumb } from "@comet/ui";

const meta = {
  title: "UI/conversation/OrbitBreadcrumb",
  component: OrbitBreadcrumb,
  tags: ["autodocs"],
  args: { parent: "나디르", current: "교감" },
  argTypes: {
    parent: {
      control: "text",
    },
    current: {
      control: "text",
    },
    hint: {
      control: "text",
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
          "현재 궤도 위치와 돌아가기 키 안내를 표시합니다. 실제 내비게이션이나 Esc 처리는 부모가 연결합니다.",
      },
    },
  },
} satisfies Meta<typeof OrbitBreadcrumb>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { name: "현재 위치" };
