import { style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const amountField = style({
  display: "flex",
  alignItems: "center",
  gap: 4,
  width: 102,
  flexShrink: 0,
});
export const currency = style({ color: tokens["color/ink-3"], fontSize: 13, flexShrink: 0 });
