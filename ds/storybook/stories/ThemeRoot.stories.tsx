import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button, ContextChip, Surface, ThemeRoot } from "@comet/ui";

const sample = (
  <Surface variant="sheet" style={{ padding: 24 }}>
    <h2>하던 일을 기억해요</h2>
    <p>같은 컴포넌트를 Figma 색상 모드마다 봅니다.</p>
    <div className="comet-catalog-row">
      <ContextChip icon="star">오늘의 기록</ContextChip>
      <Button>계속하기</Button>
    </div>
  </Surface>
);

const meta = {
  title: "Foundations/ThemeRoot",
  component: ThemeRoot,
  tags: ["autodocs"],
  args: { theme: "dark", motion: "system", children: sample },
  argTypes: {
    theme: { control: "radio", options: ["dark", "light", "paper", "play"] },
    motion: { control: "radio", options: ["system", "reduced"] },
    typeface: { control: "radio", options: ["ui", "skin"] },
    children: { control: false },
  },
  parameters: {
    docs: {
      description: {
        component:
          "data-comet-theme와 기본 UI 타이포그래피를 적용하는 컨테이너입니다. 필요한 토큰 CSS도 함께 불러옵니다. motion=system은 운영체제 움직임 설정을 따르고 motion=reduced는 이 영역의 animation·transition을 끕니다. 중첩하면 특정 영역에 다른 색상 모드를 적용할 수 있고 앱의 저장된 설정을 자동 변경하지 않습니다. paper(따뜻한 종이)와 play(놀이)는 한 모습뿐인 스킨입니다. typeface=skin은 스킨 글꼴(text/skin-font-family)을 써서 바탕화면 말풍선·위젯에 사용합니다. UI 없이 토큰만 사용할 때는 @comet/token/styles.css를 직접 import하세요.",
      },
    },
  },
} satisfies Meta<typeof ThemeRoot>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Dark: Story = { name: "밤하늘" };
export const Light: Story = { name: "낮", args: { theme: "light" } };
export const Paper: Story = { name: "따뜻한 종이", args: { theme: "paper", typeface: "skin" } };
export const Play: Story = { name: "놀이", args: { theme: "play", typeface: "skin" } };
export const SideBySide: Story = {
  name: "모드 비교",
  render: () => (
    <div className="comet-catalog-modes">
      <ThemeRoot theme="dark">{sample}</ThemeRoot>
      <ThemeRoot theme="light">{sample}</ThemeRoot>
      <ThemeRoot theme="paper" typeface="skin">
        {sample}
      </ThemeRoot>
      <ThemeRoot theme="play" typeface="skin">
        {sample}
      </ThemeRoot>
    </div>
  ),
};
