import type { CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { ThemeRoot } from "@comet/ui";
import { Balloon } from "../../../apps/comet/src/components/Balloon/Balloon";
import {
  appearanceVars,
  DEFAULT_APPEARANCE,
  resolveTheme,
} from "../../../apps/comet/src/appearance";
import { PREVIEW_SNAPSHOT } from "../../../apps/comet/src/hooks/useSnapshot";
import type { Appearance } from "../../../apps/comet/src/types";

const error = "로컬 실행기가 종료되었습니다. 모델·GPU·메모리와 실행기 버전을 확인해 주세요.";
const desktopBackgrounds = {
  white: "#ffffff",
  dark: "#101018",
  patterned: "repeating-linear-gradient(45deg, #fff 0 20px, #182440 20px 40px)",
};
type Props = {
  skin: "dark" | "light" | "paper" | "play" | "custom";
  balloonOpacity: number;
  desktop: keyof typeof desktopBackgrounds;
  message: string;
};

function InputErrorPreview({ skin, balloonOpacity, desktop, message }: Props) {
  const appearance: Appearance = {
    ...DEFAULT_APPEARANCE,
    skin: skin === "dark" || skin === "light" ? "night" : skin,
    colorMode: skin === "dark" ? "dark" : "light",
    balloonOpacity,
    customSkin:
      skin === "custom"
        ? { background: "#888888", balloon: "#888888", widget: "#888888", accent: "#8266d4" }
        : null,
  };
  const theme = resolveTheme(appearance, false);
  return (
    <ThemeRoot
      theme={theme}
      motion="reduced"
      typeface="skin"
      style={
        {
          ...appearanceVars(appearance, theme, "balloon"),
          background: desktopBackgrounds[desktop],
          padding: 24,
          width: 392,
        } as CSSProperties
      }
    >
      <Balloon
        preview
        dispatch={async () => undefined}
        surface="input"
        snapshot={{
          ...PREVIEW_SNAPSHOT,
          panel: { persona: "builtin-a", mode: "input" },
          runtime: { ...PREVIEW_SNAPSHOT.runtime, error: message || null },
        }}
      />
    </ThemeRoot>
  );
}

const meta = {
  title: "UI/conversation/DesktopInputError",
  component: InputErrorPreview,
  tags: ["autodocs"],
  args: { skin: "dark", balloonOpacity: 100, desktop: "white", message: error },
  argTypes: {
    skin: { control: "select", options: ["dark", "light", "paper", "play", "custom"] },
    balloonOpacity: { control: { type: "range", min: 0, max: 100, step: 25 } },
    desktop: { control: "select", options: ["white", "dark", "patterned"] },
    message: { control: "text" },
  },
  parameters: {
    docs: {
      description: {
        component:
          "실제 앱 Balloon의 바탕화면 입력 오류 상태입니다. 로컬 실행기나 AI 요청 없이 고정 오류를 표시합니다. 오류는 말풍선 불투명도와 독립적인 color/glass-window 배경, color/ink 글자, color/danger-border 테두리를 사용합니다. 긴 문구는 344px 입력 영역에서 줄바꿈하며 520px를 넘으면 입력 영역 안에서 스크롤합니다. 브라우저 예제이며 네이티브 창의 크기 조절·클리핑 검증을 대신하지 않습니다.",
      },
    },
  },
} satisfies Meta<typeof InputErrorPreview>;
export default meta;
type Story = StoryObj<typeof meta>;

export const OnWhiteDesktop: Story = {
  name: "밤하늘 · 흰 바탕화면",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("alert")).toHaveTextContent(error);
    await expect(canvas.getByRole("textbox")).toBeEnabled();
  },
};
export const TransparentBalloon: Story = {
  name: "말풍선 0% · 오류 배경 유지",
  args: { balloonOpacity: 0, desktop: "patterned" },
};
export const LongError: Story = {
  name: "긴 오류 · 줄바꿈과 스크롤",
  args: { message: `${error} ${"긴오류".repeat(120)}` },
};
export const CustomSkin: Story = {
  name: "사용자 스킨 · 중간 밝기",
  args: { skin: "custom", balloonOpacity: 25 },
};
export const Recovered: Story = {
  name: "복구 후 · 오류 없음",
  args: { message: "" },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole("alert")).not.toBeInTheDocument();
  },
};
