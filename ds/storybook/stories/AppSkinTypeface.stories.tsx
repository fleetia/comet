import { useState, type JSX } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import {
  Balloon,
  Button,
  InputCapsule,
  MemoWidget,
  ThemeRoot,
  WidgetStackSummary,
} from "@comet/ui";
import type { Theme } from "@comet/token";
import {
  balloonTextStyle,
  DEFAULT_BALLOON_STYLE,
} from "../../../apps/comet/src/components/balloonTypography";
import { FocusTimerView } from "../../../apps/comet/src/widgets/PlanningTools/FocusTimerView";
import * as conversation from "../../../apps/comet/src/components/Balloon/conversationSurface.css";
import * as focus from "../../../apps/comet/src/widgets/PlanningTools/FocusTimer.css";
import * as stack from "../../../apps/comet/src/widgets/WidgetDisplay/widgetStack.css";

function SkinTypefaceExample(): JSX.Element {
  const [theme, setTheme] = useState<Theme>("paper");
  return (
    <>
      <div className="comet-catalog-row">
        {(["paper", "play", "dark", "light"] as const).map((value) => (
          <Button key={value} onClick={() => setTheme(value)} aria-pressed={theme === value}>
            {value}
          </Button>
        ))}
      </div>
      <ThemeRoot theme={theme} typeface="skin" style={{ display: "grid", gap: 16 }}>
        <Balloon>
          <span>스킨을 따르는 대답</span>
        </Balloon>
        <Balloon>
          <span style={balloonTextStyle({ ...DEFAULT_BALLOON_STYLE, fontFamily: "Orbit" })}>
            친구가 고른 글꼴
          </span>
        </Balloon>
        <MemoWidget title="작은 메모">스킨을 따르는 메모</MemoWidget>
        <div className={stack.window} style={{ minHeight: 0 }}>
          <WidgetStackSummary items={[{ id: "memo", icon: "star", label: "스킨을 따르는 모음" }]} />
        </div>
        <div className={focus.root}>
          <FocusTimerView
            task="기존 집중 도구 글꼴"
            time="25:00"
            onRecords={() => {}}
            onSettings={() => {}}
          />
        </div>
        <div className={conversation.inputHost}>
          <InputCapsule label="기존 대화 입력 글꼴" />
        </div>
      </ThemeRoot>
      <ThemeRoot theme={theme} typeface="ui">
        <Balloon>설정 창의 미리보기</Balloon>
        <MemoWidget title="설정의 메모">설정 창의 위젯 미리보기</MemoWidget>
      </ThemeRoot>
    </>
  );
}

const meta = {
  title: "App/appearance/Skin typeface",
  component: SkinTypefaceExample,
  parameters: {
    docs: {
      description: {
        component:
          "바탕화면의 ThemeRoot(typeface=skin), 실제 DS 말풍선·메모·모음과 앱의 모음/집중 글꼴 경계를 사용합니다. 스킨을 바꿀 때 계산된 본문 글꼴과 명시적 친구 글꼴·설정/집중 도구의 UI 글꼴을 검사합니다. 네이티브 첫 프레임이나 글꼴 로딩 지연의 검사는 아닙니다.",
      },
    },
  },
} satisfies Meta<typeof SkinTypefaceExample>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Inheritance: Story = {
  name: "스킨 글꼴 상속과 UI 경계",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    try {
      for (const [theme, family] of [
        ["paper", "Gowun Dodum"],
        ["play", "Jua"],
        ["dark", "IBM Plex Sans KR"],
        ["light", "IBM Plex Sans KR"],
        ["paper", "Gowun Dodum"],
      ]) {
        await userEvent.click(canvas.getByRole("button", { name: theme }));
        await expect((await document.fonts.load(`14px "${family}"`)).length).toBeGreaterThan(0);
        await expect(document.fonts.check(`14px "${family}"`)).toBe(true);
        for (const text of ["스킨을 따르는 대답", "스킨을 따르는 메모", "스킨을 따르는 모음"]) {
          await expect(
            getComputedStyle(canvas.getByText(text)).fontFamily.split(",")[0].replaceAll('"', ""),
          ).toBe(family);
        }
        for (const text of [
          "설정 창의 미리보기",
          "설정 창의 위젯 미리보기",
          "무엇에 집중할까요?",
        ]) {
          await expect(
            getComputedStyle(canvas.getByText(text)).fontFamily.split(",")[0].replaceAll('"', ""),
          ).toBe("IBM Plex Sans KR");
        }
        await expect(
          getComputedStyle(canvas.getByText("친구가 고른 글꼴"))
            .fontFamily.split(",")[0]
            .replaceAll('"', ""),
        ).toBe("Orbit");
        await expect(
          getComputedStyle(canvas.getByRole("textbox", { name: "기존 대화 입력 글꼴" }))
            .fontFamily.split(",")[0]
            .replaceAll('"', ""),
        ).toBe("IBM Plex Sans KR");
      }
      canvasElement.dataset.typefaceCheck = "passed";
    } catch (error) {
      canvasElement.dataset.typefaceCheck = "failed";
      throw error;
    }
  },
};
