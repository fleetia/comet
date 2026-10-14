import type { HTMLAttributes, JSX } from "react";
import type { Theme } from "@comet/token";
import "@comet/token/styles.css";
import { root } from "./theme.css";

export type ThemeRootProps = HTMLAttributes<HTMLDivElement> & {
  theme?: Theme;
  motion?: "system" | "reduced";
};

export function ThemeRoot({
  theme = "dark",
  motion = "system",
  className,
  ...props
}: ThemeRootProps): JSX.Element {
  return (
    <div
      {...props}
      data-comet-theme={theme}
      data-comet-motion={motion}
      className={[root, className].filter(Boolean).join(" ")}
    />
  );
}
