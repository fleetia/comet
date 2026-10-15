import { style, styleVariants } from "@vanilla-extract/css";
import { tokens } from "@comet/token";
export const chip = style({
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  lineHeight: "16px",
  fontSize: 12,
  padding: 0,
  height: 19,
  minHeight: 0,
  border: "none",
  background: "transparent",
  color: tokens["color/ink-2"],
});
export const kinds = styleVariants({
  list: {},
  repeat: { color: tokens["color/ink-3"], gap: 7 },
  envelope: {
    borderRadius: 10,
    padding: "0 9px",
    color: tokens["color/byul-ink"],
    background: tokens["color/icon-tile"],
    fontSize: 11.5,
    lineHeight: "15px",
  },
});
export const dot = style({
  width: 7,
  height: 7,
  borderRadius: 3,
  flexShrink: 0,
  background: tokens["color/danger"],
});
