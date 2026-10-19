import type { CSSProperties } from "react";
import { themes } from "@comet/token";
import type { BalloonStyle, InstalledCharacter } from "../types";
import { BALLOON_SPRITE } from "./characterIdentity";

export const DEFAULT_BALLOON_STYLE: BalloonStyle = {
  fontSize: themes.dark["typography/sans/speech/fontSize"],
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

/** Clears the friend's own text look so the balloon follows the skin; keeps the text speed. */
export function themedBalloonStyle(style: BalloonStyle | undefined): BalloonStyle {
  return { ...DEFAULT_BALLOON_STYLE, textSpeed: style?.textSpeed ?? 0 };
}

/** A friend follows the skin until it changes text size, font, color or the balloon image. */
export function followsTheme(character: Pick<InstalledCharacter, "definition" | "sprites">): boolean {
  const style = character.definition.balloonStyle;
  return (
    !character.sprites[BALLOON_SPRITE] &&
    (!style ||
      (style.fontSize === DEFAULT_BALLOON_STYLE.fontSize &&
        !style.fontFamily.trim() &&
        style.textColor === null))
  );
}
