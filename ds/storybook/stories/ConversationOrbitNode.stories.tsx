import type { Meta, StoryObj } from "@storybook/react-vite";
import { OrbitNode } from "@comet/ui";

const meta = {
  title: "UI/Conversation/OrbitNode",
  component: OrbitNode,
  tags: ["autodocs"],
  args: { icon: "gift", label: "선물 건네기", state: "default", disabled: false },
  argTypes: {
    state: {
      control: "select",
      options: ["default", "hub", "focus", "visited", "retreated", "has-children"],
    },
    icon: {
      control: "select",
      options: ["gift", "heart", "box", "pet"],
    },
    label: {
      control: "text",
    },
    badge: {
      control: {
        type: "number",
        min: 0,
      },
    },
    disabled: {
      control: "boolean",
    },
    iconSize: {
      control: {
        type: "number",
        min: 1,
      },
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
          "궤도 메뉴의 native 버튼입니다. 상태에 따른 크기·링·배지를 제공하고 hover·pressed·키보드 포커스를 표시합니다. label은 아이콘 버튼의 접근 가능한 이름입니다.",
      },
    },
  },
} satisfies Meta<typeof OrbitNode>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { name: "기본" };
export const Hub: Story = { name: "중심", args: { state: "hub" } };
export const Focus: Story = { name: "포커스", args: { state: "focus" } };
export const Visited: Story = { name: "방문함", args: { state: "visited" } };
export const Badge: Story = { name: "배지", args: { badge: 6 } };
export const Disabled: Story = { name: "사용 불가", args: { disabled: true } };
export const Retreated: Story = { name: "물러난 노드", args: { state: "retreated" } };
export const HasChildren: Story = {
  name: "하위 항목 있음",
  args: { state: "has-children", icon: "box" },
};
