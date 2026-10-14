import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge } from "@comet/ui";

const meta = {
  title: "UI/Display/Badge",
  component: Badge,
  tags: ["autodocs"],
  args: { children: "3", "aria-label": "읽지 않은 알림 3개" },
  argTypes: { children: { control: "text" } },
  parameters: {
    docs: {
      description: {
        component:
          "개수나 짧은 표식을 보여주는 배지입니다. 숫자의 의미가 주변 문맥으로 분명하지 않으면 aria-label을 지정하세요. 배지 자체에는 알림이나 클릭 동작이 없습니다.",
      },
    },
  },
} satisfies Meta<typeof Badge>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = { name: "개수" };
export const LongCount: Story = {
  name: "많은 개수",
  args: { children: "99+", "aria-label": "읽지 않은 알림 99개 이상" },
};
