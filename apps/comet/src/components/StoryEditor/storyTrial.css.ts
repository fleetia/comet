import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const panel = style({
  display: "flex",
  flexDirection: "column",
  gap: 12,
});
globalStyle(`.${panel} > p, .${panel} > h3`, { margin: 0 });
export const startActions = style({ display: "flex", gap: 8 });
export const conversation = style({
  display: "flex",
  flexDirection: "column",
  gap: 8,
  margin: "16px 0",
});
export const message = style({
  alignSelf: "flex-start",
  maxWidth: "85%",
  margin: 0,
  padding: "10px 12px",
  borderRadius: "12px 12px 12px 3px",
  background: tokens["color/card"],
  border: `1px solid ${tokens["color/card-border"]}`,
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
});
export const reply = style({
  alignSelf: "flex-end",
  borderRadius: "12px 12px 3px 12px",
  background: tokens["color/hover"],
});
