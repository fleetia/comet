import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { CharacterArtwork, ContentChoice, type ContentChoiceProps, Keycap } from "@comet/ui";
import {
  RecordSampleCharacter,
  RecordSampleIcon,
  RecordSampleLocation,
  RecordSampleTile,
} from "./RecordsAssets";

function ChoiceExample(args: ContentChoiceProps) {
  let leading = args.leading;
  if (leading === undefined) {
    switch (args.variant) {
      case "memory":
        leading = (
          <RecordSampleTile size={34}>
            <RecordSampleIcon name={args.selected ? "memory-selected" : "memory-default"} />
          </RecordSampleTile>
        );
        break;
      case "scene":
        leading = <RecordSampleIcon name={args.selected ? "scene-selected" : "scene-default"} />;
        break;
      case "location":
        leading = <RecordSampleLocation selected={args.selected} />;
        break;
      case "reference":
        leading = (
          <RecordSampleIcon name={args.selected ? "reference-selected" : "reference-default"} />
        );
        break;
      case "conversation":
        leading = <RecordSampleCharacter />;
        break;
      case "launcher":
        leading = <RecordSampleCharacter launcher />;
        break;
      case "story":
        break;
      default:
        leading = <CharacterArtwork size="compact" />;
    }
  }
  return <ContentChoice {...args} leading={leading} />;
}

const meta = {
  title: "UI/records/ContentChoice",
  component: ContentChoice,
  tags: ["autodocs"],
  args: {
    title: "나디르",
    description: "함께 지내는 친구 · 오랜 친구",
    variant: "character",
    selected: false,
  },
  render: ChoiceExample,
  argTypes: {
    variant: {
      control: "select",
      options: [
        "character",
        "memory",
        "scene",
        "story",
        "location",
        "reference",
        "conversation",
        "launcher",
      ],
    },
    selected: { control: "boolean" },
    disabled: { control: "boolean" },

    leading: { control: false },
    trailing: { control: false },
    onClick: { control: false, action: "선택" },
  },
  parameters: {
    docs: {
      description: {
        component:
          "캐릭터·기억·장면·이야기·위치·참고 메모·대화·런처 결과의 선택 행입니다. variant는 구조를 구분하고 문구·이미지는 props로 전달합니다. selected와 onClick으로 소비자의 선택 상태를 연결합니다. 각 선택 항목은 native button이며 Enter/Space와 disabled를 지원합니다.",
      },
    },
  },
} satisfies Meta<typeof ContentChoice>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Character: Story = {};
export const CharacterSelected: Story = { args: { selected: true } };
export const Memory: Story = {
  args: {
    variant: "memory",
    title: "내 기억으로 나눠 주기",
    description: "고른 친구가 나와의 이야기로 떠올려요",
  },
};
export const MemorySelected: Story = { args: { ...Memory.args, selected: true } };
export const Scene: Story = {
  args: { variant: "scene", title: "비 오는 날", description: "날씨가 비일 때 · 3줄" },
};
export const SceneSelected: Story = { args: { ...Scene.args, selected: true } };
export const StoryChoice: Story = {
  args: { variant: "story", title: "세계와 공통 규칙", description: "2개" },
};
export const StorySelected: Story = { args: { ...StoryChoice.args, selected: true } };
export const Location: Story = {
  args: { variant: "location", title: "서울 강남구", description: "서울특별시 · 대한민국" },
};
export const LocationSelected: Story = { args: { ...Location.args, selected: true } };
export const Reference: Story = {
  args: {
    variant: "reference",
    title: "집중 노트 · 기획서 초안",
    description: "계속 쓸 메모 · 오늘",
  },
};
export const ReferenceSelected: Story = { args: { ...Reference.args, selected: true } };
export const Conversation: Story = {
  args: {
    variant: "conversation",
    title: "별꼬리",
    timestamp: "오후 3:12",
    description: "창밖 하늘이 꽤 맑네. 잠깐 쉬었다 할래?",
  },
};
export const ConversationSelected: Story = { args: { ...Conversation.args, selected: true } };
export const ConversationPreview: Story = {
  args: {
    variant: "conversation",
    title: "나디르",
    timestamp: "오후 8:40",
    description: "강가를 따라서 걸어 볼까요?",
    leading: <CharacterArtwork size="conversation" />,
  },
};
export const Launcher: Story = {
  args: {
    variant: "launcher",
    title: "별꼬리에게 말 걸기",
    description: "바탕화면에 있어요",
    trailing: <Keycap>⏎</Keycap>,
  },
};
export const LauncherSelected: Story = { args: { ...Launcher.args, selected: true } };
export const Selection: Story = {
  parameters: { controls: { disable: true } },
  render: (args) => {
    const [selected, setSelected] = useState(false);
    return <ChoiceExample {...args} selected={selected} onClick={() => setSelected(!selected)} />;
  },
};
export const Disabled: Story = { args: { disabled: true } };
