import type { HTMLAttributes, JSX } from "react";
import type { Theme } from "@comet/token";
import "@comet/token/styles.css";
import { root, skinTypeface } from "./theme.css";

export type ThemeRootProps = HTMLAttributes<HTMLDivElement> & {
  theme?: Theme;
  motion?: "system" | "reduced";
  /** `skin` uses the theme's skin typeface, for desktop balloons and widgets. */
  typeface?: "ui" | "skin";
};

export function ThemeRoot({
  theme = "dark",
  motion = "system",
  typeface = "ui",
  className,
  ...props
}: ThemeRootProps): JSX.Element {
  return (
    <div
      {...props}
      data-comet-theme={theme}
      data-comet-motion={motion}
      className={[root, typeface === "skin" && skinTypeface, className].filter(Boolean).join(" ")}
    />
  );
}
