import type { Meta, StoryObj } from "@storybook/react-vite";
import { OrbitExpandedMenu } from "@comet/ui";
import byulkkori from "../../ui/src/conversation/assets/orbit-byulkkori.svg";
const meta = {
  title: "UI/Conversation/OrbitExpandedMenu",
  component: OrbitExpandedMenu,
  tags: ["autodocs"],
  args: {
    parent: "나디르",
    title: "교감",
    size: "full",
    selectedId: "pet",
    items: [
      { id: "pet", label: "쓰다듬기", icon: "pet" },
      { id: "poke", label: "콕 찌르기", icon: "poke" },
      { id: "snack", label: "간식 나누기", icon: "cookie", badge: 6 },
      { id: "drink", label: "음료 건네기", icon: "drink" },
      { id: "gift", label: "선물 건네기", icon: "gift" },
      { id: "move", label: "움직이기", icon: "move" },
      { id: "sleep", label: "재우기", icon: "moon" },
    ],
    secondaryItems: [
      { id: "chat", label: "말 걸기", icon: "chat" },
      { id: "hide", label: "숨기기", icon: "hide" },
      { id: "gear", label: "설정", icon: "gear" },
      { id: "undo", label: "돌아가기", icon: "undo" },
      { id: "sun", label: "날씨", icon: "sun" },
      { id: "look", label: "살펴보기", icon: "look" },
      { id: "home", label: "집", icon: "home" },
    ],
  },
  argTypes: {
    size: {
      control: "select",
      options: ["full", "compact"],
    },
    content: {
      control: "select",
      options: ["interact", "play"],
    },
    parent: {
      control: "text",
    },
    title: {
      control: "text",
    },
    selectedId: {
      control: "text",
    },
    hubIcon: {
      control: "select",
      options: ["heart", "ball2"],
    },
    items: {
      control: false,
    },
    secondaryItems: {
      control: false,
    },
    character: {
      control: false,
    },
    footer: {
      control: false,
    },
    onAction: {
      control: false,
    },
    onBack: {
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
          "각각 최대 7개의 고정 슬롯에 배치하는 버튼·연결선·중심 노드의 조합입니다. 큰 교감·작은 교감·작은 놀이 배치를 제공하며 onAction과 onBack으로 선택과 Esc를 전달합니다. 캐릭터는 character 슬롯으로 넣습니다.",
      },
    },
  },
} satisfies Meta<typeof OrbitExpandedMenu>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Full: Story = { name: "큰 교감" };
export const Compact: Story = {
  name: "작은 교감",
  args: {
    size: "compact",
    parent: "별꼬리",
    character: <img src={byulkkori} alt="별꼬리" />,
    footer: "남은 간식 5조각",
  },
};
export const Play: Story = {
  name: "작은 놀이",
  args: {
    size: "compact",
    selectedId: "dice",
    content: "play",
    title: "같이 놀기",
    hubIcon: "ball2",
    items: [
      { id: "dice", label: "주사위 굴리기", icon: "dice" },
      { id: "coin", label: "동전 던지기", icon: "coin" },
      { id: "scissors", label: "가위바위보", icon: "scissors" },
      { id: "number", label: "숫자 맞히기", icon: "hash" },
      { id: "toys", label: "장난감 꺼내기", icon: "toybox" },
      { id: "cup", label: "컵 찾기", icon: "cupdown" },
      { id: "fortune", label: "장난 운세", icon: "bubble" },
    ],
  },
};
