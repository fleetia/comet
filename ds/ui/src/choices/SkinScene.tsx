import type { CSSProperties, JSX } from "react";
import type { Theme } from "@comet/token";
import "@comet/token/styles.css";
import { skinTypeface } from "../theme/theme.css";
import * as styles from "./skinScene.css";

export type SkinSceneProps = {
  /** Generated theme to render; a custom skin passes its base theme with token overrides. */
  theme: Theme;
  /** CSS custom property overrides, such as a user skin's derived tokens. */
  style?: CSSProperties;
  size?: "tile" | "large";
  name?: string;
  line?: string;
  meta?: string;
};

/** A small desktop scene (balloon and widget pill) drawn with the theme's own tokens. */
export function SkinScene({
  theme,
  style,
  size = "tile",
  name = "별꼬리",
  line = "오늘 하늘 맑다!",
  meta = "3:24 · 23°",
}: SkinSceneProps): JSX.Element {
  return (
    <span
      aria-hidden
      data-comet-theme={theme}
      className={[styles.scene, styles.sizes[size], skinTypeface].join(" ")}
      style={style}
    >
      <span className={styles.balloon}>
        <span className={styles.name}>{name}</span>
        <span>{line}</span>
      </span>
      <span className={styles.pill}>{meta}</span>
    </span>
  );
}
