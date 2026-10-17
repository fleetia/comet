import { style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";
export const container = style({
  display: "flex",
  flexWrap: "wrap",
  alignItems: "end",
  gap: tokens["spacing/space-8"],
  marginTop: tokens["spacing/space-6"],
});
export const number = style({ width: 88 });
export const hint = style({
  color: tokens["color/ink-2"],
  fontSize: tokens["typography/sans/caption/fontSize"],
  alignSelf: "center",
});
export const error = style({
  width: "100%",
  color: tokens["color/ink-2"],
  fontSize: tokens["typography/sans/caption/fontSize"],
  margin: 0,
});
