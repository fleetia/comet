import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";
export const root = style({ display: "grid", gap: 16, minWidth: 0 });
export const row = style({
  display: "grid",
  gridTemplateColumns: "minmax(0,1fr) auto",
  gap: 8,
  padding: 14,
  borderBottom: `1px solid ${tokens["color/divider"]}`,
});
export const form = style({
  display: "grid",
  gap: 14,
  padding: 16,
  borderRadius: 18,
  background: tokens["color/card"],
  border: `1px solid ${tokens["color/card-border"]}`,
});

globalStyle(`${root} label`, { color: tokens["color/ink-2"], fontWeight: 400 });

export const heading = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
});
globalStyle(`${root} h2`, {
  fontSize: 14,
  lineHeight: "20px",
  fontFamily: tokens["typography/sans/body/fontFamily"],
  fontWeight: 500,
});
