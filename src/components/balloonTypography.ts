import type { CSSProperties } from "react";
import type { BalloonStyle } from "../types";

export const DEFAULT_BALLOON_STYLE: BalloonStyle = {
  fontSize: 19,
  fontFamily: "",
  textColor: null,
  textSpeed: 0,
};

export function balloonTextStyle(style = DEFAULT_BALLOON_STYLE): CSSProperties {
  const family = style.fontFamily.trim();
  return {
    fontSize: style.fontSize,
    color: style.textColor ?? undefined,
    fontFamily: family
      ? `"${family.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}", system-ui, sans-serif`
      : undefined,
  };
}
