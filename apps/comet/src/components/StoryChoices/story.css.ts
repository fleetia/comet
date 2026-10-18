import { style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const host = style([
  {
    position: "relative",
    width: 340,
    maxWidth: "100vw",
    maxHeight: "min(520px, 100dvh)",
    overflowY: "auto",
    scrollbarWidth: "none",
  },
]);
export const story = style({
  position: "relative",
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: 14,
  width: 340,
});
export const promptBalloon = style({
  width: 340,
  minHeight: 80,
  padding: "15px 17px",
  flexShrink: 0,
});
export const promptTail = style({ left: 48, width: 15, height: 15, bottom: -8 });
export const prompt = style({
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  fontSize: 16,
  lineHeight: "1.5",
  margin: 0,
});
export const title = style({
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
});
export const choices = style({ position: "relative", width: 340 });
export const defer = style({
  position: "absolute",
  right: 0,
  top: 0,
  minHeight: 24,
  height: 24,
  padding: "2px 6px",
  fontSize: 12,
  opacity: 0,
  selectors: { [`${story}:hover &, ${story}:focus-within &, &:focus-visible`]: { opacity: 1 } },
});
export const close = style({
  position: "absolute",
  zIndex: 1,
  top: 4,
  right: 4,
  width: 24,
  minWidth: 24,
  height: 24,
  minHeight: 24,
  opacity: 0,
  selectors: { [`${story}:hover &, ${story}:focus-within &, &:focus-visible`]: { opacity: 1 } },
});
export const status = style({
  margin: 0,
  fontSize: 12,
  lineHeight: "18px",
  color: tokens["color/ink-2"],
});
export const error = style([status, { color: tokens["color/danger"], whiteSpace: "pre-wrap" }]);
