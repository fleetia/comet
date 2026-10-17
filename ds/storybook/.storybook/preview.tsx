import type { Preview } from "@storybook/react-vite";
import { useEffect } from "storybook/preview-api";
import { themes, tokens } from "@comet/token";
import { ThemedDocsContainer } from "./ThemedDocsContainer";
import "@comet/token/styles.css";
import "./fonts.css";
import "../stories/catalog.css";

const preview: Preview = {
  globalTypes: {
    theme: {
      description: "Figma 색상 모드",
      toolbar: {
        title: "색상 모드",
        icon: "circlehollow",
        items: [
          { value: "dark", title: "밤하늘 · Dark" },
          { value: "light", title: "낮 · Light" },
        ],
        dynamicTitle: true,
      },
    },
    motion: {
      description: "움직임 표시",
      toolbar: {
        title: "움직임",
        icon: "play",
        items: [
          { value: "system", title: "운영체제 설정 따르기" },
          { value: "reduced", title: "움직임 줄이기" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: "light", motion: "system", backgrounds: { value: "theme" } },
  parameters: {
    docs: { container: ThemedDocsContainer },
    backgrounds: {
      options: {
        light: { name: "light", value: themes.light["color/document/backdrop-panel/sky"] },
        dark: { name: "dark", value: themes.dark["color/document/backdrop-panel/sky"] },
        theme: { name: "색상 모드 따르기", value: tokens["color/document/backdrop-panel/sky"] },
      },
    },
    options: {
      storySort: {
        order: [
          "시작하기",
          "Foundations",
          "Icon",
          "UI",
          [
            "controls",
            "display",
            "choices",
            "navigation",
            "records",
            "conversation",
            "overlays",
            "surface",
            "motion",
            "planner",
            "widgets",
          ],
        ],
      },
    },
  },
  decorators: [
    (Story, context) => {
      const theme = context.globals.theme === "dark" ? "dark" : "light";
      useEffect(() => {
        document.documentElement.dataset.cometTheme = theme;
      }, [theme]);

      return (
        <div
          className="comet-catalog"
          data-comet-theme={theme}
          data-comet-motion={context.globals.motion === "reduced" ? "reduced" : undefined}
          style={{ color: tokens["color/ink"], colorScheme: theme }}
        >
          <Story />
        </div>
      );
    },
  ],
};

export default preview;
