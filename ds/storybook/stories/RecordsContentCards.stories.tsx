import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  AddCard,
  AnimationCard,
  CharacterArtwork,
  CharacterCard,
  SettingsLinkCard,
} from "@comet/ui";
import { RecordSampleIcon } from "./RecordsAssets";
const meta = {
  title: "UI/records/ContentCards",
  component: CharacterCard,
  tags: ["autodocs"],
  args: {
    title: "나디르",
    description: "나디르와 별꼬리 팩 · 자리 비움",
    artwork: <CharacterArtwork />,
  },
  argTypes: { artwork: { control: false } },
  parameters: {
    docs: {
      description: {
        component:
          "캐릭터 소개·친구 추가·스킨 추가·설정 링크·애니메이션 카드의 재사용 단위입니다. 캐릭터·미리보기 이미지는 artwork/icon으로 전달하며 실제 팩 설치·설정 전환·미디어 재생을 소유하지 않습니다. 예제의 SVG는 Figma의 해당 자산을 원래 크기로 사용합니다.",
      },
    },
  },
} satisfies Meta<typeof CharacterCard>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Character: Story = {};
export const AddCharacter: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <AddCard
      title="친구 추가"
      description="캐릭터 파일이나 팩에서 데려와요"
      icon={<RecordSampleIcon name="add-character" />}
    />
  ),
};
export const Customize: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <AddCard
      variant="customize"
      title="내 스킨"
      description="배경·말풍선·주인 색을 직접 골라요"
      icon={<RecordSampleIcon name="customize" />}
    />
  ),
};
export const SettingsLink: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <SettingsLinkCard
      href="#settings"
      title="부위와 교감 동작"
      description="부위 4개 · 교감 동작 21개"
      detail="볼·머리·몸을 나누고 만질 때 할 동작을 정해요"
      icon={<RecordSampleIcon name="settings" />}
    />
  ),
};
export const Animation: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <AnimationCard
      title="꼬리 인사와 눈 깜빡임"
      description="8장 · 초당 8"
      artwork={<RecordSampleIcon name="animation" />}
    />
  ),
};
