import type { Preview } from "@storybook/react-vite";
import "@comet/token/styles.css";
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
  initialGlobals: { theme: "light", motion: "system" },
  parameters: {
    options: {
      storySort: { order: ["시작하기", "Foundations", "Icon", "UI"] },
    },
  },
  decorators: [
    (Story, context) => (
      <div
        className="comet-catalog"
        data-comet-theme={context.globals.theme === "light" ? "light" : "dark"}
        data-comet-motion={context.globals.motion === "reduced" ? "reduced" : undefined}
      >
        <Story />
      </div>
    ),
  ],
};

export default preview;
