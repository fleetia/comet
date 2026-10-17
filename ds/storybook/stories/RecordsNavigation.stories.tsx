import type { Meta, StoryObj } from "@storybook/react-vite";
import { iconNames } from "@comet/icon";
import { ProfileLink, SidebarItem } from "@comet/ui";
const meta = {
  title: "UI/records/SidebarItem",
  component: SidebarItem,
  tags: ["autodocs"],
  args: { icon: "todo", children: "할 일", badge: 4, href: "#tasks", current: false },
  argTypes: {
    icon: { control: "select", options: iconNames },
    current: { control: "boolean" },
    badge: { control: "number" },
  },
  parameters: {
    docs: {
      description: {
        component:
          "Navigation/Sidebar Item과 Navigation/Profile Link입니다. native anchor의 href·키보드 동작을 유지하며 current는 aria-current=page와 선택 스타일을 설정합니다. 배지 0도 표시하고 undefined/null은 숨깁니다. 실제 라우팅과 프로필 내용은 소비자가 전달합니다.",
      },
    },
  },
} satisfies Meta<typeof SidebarItem>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const Current: Story = { args: { current: true } };
export const WithoutBadge: Story = { args: { badge: undefined } };
export const ZeroBadge: Story = { args: { badge: 0 } };
export const Profile: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <ProfileLink href="#profile" avatar="여">
      여행자
    </ProfileLink>
  ),
};
