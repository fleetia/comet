import type { Meta, StoryObj } from "@storybook/react-vite";
import { themes, tokenNames, type TokenPath } from "@comet/token";
import { deriveSkin, skinBase, type SkinPalette } from "@comet/token/skin";
import { ChoiceTile, SkinScene } from "@comet/ui";

const custom: SkinPalette = {
  background: "#1f3b33",
  balloon: "#f3efe2",
  widget: "#d9eadf",
  accent: "#2f7d5b",
};
const customBase = skinBase(custom);
const customStyle = Object.fromEntries(
  Object.entries(deriveSkin(themes[customBase], custom)).map(([path, value]) => [
    tokenNames[path as TokenPath],
    value,
  ]),
);

const meta = {
  title: "UI/choices/SkinScene",
  component: SkinScene,
  tags: ["autodocs"],
  args: { theme: "paper", size: "tile" },
  argTypes: {
    theme: { control: "radio", options: Object.keys(themes) },
    size: { control: "radio", options: ["tile", "large"] },
    style: { control: false },
  },
  parameters: {
    docs: {
      description: {
        component:
          "테마의 말풍선(glass-panel)·위젯(glass-widget)·배경(sky)·스킨 글꼴을 그대로 쓰는 작은 바탕화면 장면입니다. theme은 data-comet-theme으로 적용하고, 내 스킨처럼 파생한 토큰은 style의 CSS 변수로 덮어씁니다. ChoiceTile kind=theme의 graphic이나 지금 모습 미리보기에 사용하며 선택 상태와 저장은 소비자가 관리합니다.",
      },
    },
  },
  decorators: [
    (Story) => (
      <div style={{ display: "flex", width: 360 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SkinScene>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Paper: Story = { name: "따뜻한 종이" };
export const Play: Story = { name: "놀이", args: { theme: "play" } };
export const Large: Story = { name: "지금 모습", args: { theme: "dark", size: "large" } };
export const CustomSkin: Story = {
  name: "내 스킨 · 파생 토큰",
  args: { theme: customBase, style: customStyle },
};
export const ThemeChoices: Story = {
  name: "스킨 고르기",
  decorators: [
    (Story) => (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 360px)", gap: 12 }}>
        <Story />
      </div>
    ),
  ],
  render: () => (
    <>
      <ChoiceTile
        kind="theme"
        selected
        label="밤하늘"
        description="기본 · 다크는 밤하늘, 라이트는 새벽 유리"
        graphic={
          <span style={{ display: "flex", gap: 4, width: "100%" }}>
            <SkinScene theme="dark" />
            <SkinScene theme="light" />
          </span>
        }
      />
      <ChoiceTile
        kind="theme"
        label="따뜻한 종이"
        description="종이 질감과 차분한 글씨"
        graphic={<SkinScene theme="paper" />}
      />
      <ChoiceTile
        kind="theme"
        label="놀이"
        description="선명한 색과 굵은 테두리"
        graphic={<SkinScene theme="play" />}
      />
      <ChoiceTile
        kind="theme"
        label="내 스킨"
        description="배경·말풍선·위젯 색을 직접 골라요"
        graphic={<SkinScene theme={customBase} style={customStyle} />}
      />
    </>
  ),
};
