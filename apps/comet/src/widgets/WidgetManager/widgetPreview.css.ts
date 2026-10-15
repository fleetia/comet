import { style, globalStyle } from "@vanilla-extract/css";
import { tokens } from "@comet/token";
export const preview = style({
  display: "grid",
  gap: 16,
  minWidth: 0,
  padding: 18,
  borderRadius: 20,
  border: `1px solid ${tokens["color/card-border"]}`,
  background: tokens["color/input"],
});
export const clockLine = style({
  display: "flex",
  alignItems: "baseline",
  gap: 10,
  flexWrap: "wrap",
});
export const number = style({
  fontFamily: tokens["typography/display/clock/fontFamily"],
  fontSize: 36,
  lineHeight: 1.2,
  color: tokens["color/ink"],
  fontVariantNumeric: "tabular-nums",
});
export const anniversary = style({
  display: "flex",
  alignItems: "center",
  gap: 8,
  paddingTop: 12,
  borderTop: `1px solid ${tokens["color/divider"]}`,
  fontSize: 12,
});
globalStyle(`${anniversary} strong`, { marginLeft: "auto", color: tokens["color/comet"] });
export const caption = style({
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 12,
  color: tokens["color/ink-3"],
});
globalStyle(`${caption} span:last-child`, { marginLeft: "auto" });
export const weatherLine = style({ display: "flex", alignItems: "center", gap: 12 });
globalStyle(`${weatherLine} > svg`, { marginLeft: "auto" });
export const stale = style({ margin: 0, fontSize: 12, color: tokens["color/ink-3"] });
