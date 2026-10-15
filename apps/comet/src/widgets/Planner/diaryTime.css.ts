import { style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const editor = style({ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 });
export const toolbar = style({
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 8,
  width: "100%",
  color: tokens["color/ink-3"],
  fontSize: 12,
});
export const hint = style({ marginLeft: "auto", fontSize: 11.5 });
export const popup = style({
  pointerEvents: "auto",
  width: 250,
  maxWidth: "calc(100% - 24px)",
  padding: "12px 14px",
  display: "flex",
  flexDirection: "column",
  gap: 8,
  maxHeight: "100%",
  overflowY: "auto",
});
export const heading = style({
  margin: 0,
  color: tokens["color/ink"],
  fontFamily: tokens["typography/display/title-sm/fontFamily"],
  fontSize: 14,
  lineHeight: "19px",
  fontWeight: 400,
});
export const meta = style({
  color: tokens["color/ink-3"],
  fontSize: 11.5,
  lineHeight: "15px",
  margin: 0,
});
export const choices = style({ display: "flex", flexWrap: "wrap", gap: 5 });
export const actions = style({ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" });
export const timeFields = style({
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 6,
  marginTop: 6,
});
export const error = style({ color: tokens["color/danger"], fontSize: 12, margin: 0 });
export const input = style({ minHeight: 28, height: 28, paddingBlock: 3 });
export const records = style({ color: tokens["color/ink-2"], fontSize: 12, paddingInline: 12 });
export const list = style({
  display: "flex",
  flexDirection: "column",
  alignItems: "start",
  gap: 4,
  paddingBlock: 8,
});
