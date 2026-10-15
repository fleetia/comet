import { style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const layout = style({
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 300px",
  gap: 18,
  alignItems: "start",
  minWidth: 0,
  "@media": { "(max-width: 1000px)": { gridTemplateColumns: "minmax(0, 1fr)" } },
});
export const main = style({ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 });
export const group = style({
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: tokens["radius/radius-18"],
  background: tokens["color/card-2"],
  overflow: "hidden",
});
export const month = style({
  margin: 0,
  padding: "6px 6px 2px",
  fontSize: 13,
  lineHeight: "18px",
  fontWeight: 600,
  color: tokens["color/ink"],
});
export const info = style({
  display: "flex",
  flexDirection: "column",
  gap: 12,
  padding: 18,
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: tokens["radius/radius-20"],
  background: tokens["color/card-2"],
});
export const caption = style({
  margin: 0,
  fontSize: 12.5,
  lineHeight: "18px",
  color: tokens["color/ink-2"],
  whiteSpace: "pre-wrap",
});
export const label = style({
  margin: 0,
  fontSize: 12,
  lineHeight: "16px",
  color: tokens["color/ink-3"],
});
export const metrics = style({ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 });
export const metric = style({
  display: "flex",
  flexDirection: "column",
  gap: 2,
  padding: "10px 12px",
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: 14,
  background: tokens["color/card"],
});
export const value = style({
  fontFamily: tokens["typography/display/title-sm/fontFamily"],
  color: tokens["color/ink"],
  fontSize: 18,
  lineHeight: "22px",
});
export const row = style({ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" });
export const form = style({ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 });
export const editor = style({ padding: 18, marginBlock: 6 });
export const date = style({
  width: 134,
  height: 32,
  minHeight: 32,
  fontSize: 12,
  paddingInline: 6,
});
export const title = style({ whiteSpace: "pre-wrap", overflowWrap: "anywhere" });
export const error = style({ fontSize: 12.5, color: tokens["color/danger"], margin: 0 });
export const source = style({ display: "flex", flexWrap: "wrap", gap: 6 });
