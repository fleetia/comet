import { style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const stage = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 0,
  minHeight: 120,
  padding: 16,
  overflow: "hidden",
  borderRadius: 9,
  outline: `1px dashed ${tokens["color/card-border"]}`,
  outlineOffset: -1,
  background: tokens["color/sky"],
});
