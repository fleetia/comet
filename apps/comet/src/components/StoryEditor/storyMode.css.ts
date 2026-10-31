import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const choices = style({ display: "flex", gap: 12 });
export const choice = style({
  display: "flex",
  flex: 1,
  flexDirection: "column",
  gap: 8,
  padding: 16,
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: 10,
  background: tokens["color/card"],
  color: tokens["color/ink"],
  textAlign: "left",
  cursor: "pointer",
  font: "inherit",
});
globalStyle(`.${choice}[aria-pressed="true"]`, { borderColor: tokens["color/primary"] });
globalStyle(`.${choice} span`, { color: tokens["color/ink-3"], fontSize: 12 });
