import { style, globalStyle } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const body = style({
  display: "grid",
  gap: tokens["spacing/space-12"],
  minWidth: 0,
  padding: tokens["spacing/space-16"],
});
export const list = style({ display: "grid", gap: tokens["spacing/space-12"], marginTop: tokens["spacing/space-16"] });
export const item = style({
  borderTop: `1px solid ${tokens["color/line"]}`,
  paddingTop: tokens["spacing/space-12"],
  display: "grid",
  gap: tokens["spacing/space-8"],
});
export const actions = style({
  display: "flex",
  gap: tokens["spacing/space-8"],
  flexWrap: "wrap",
  alignItems: "center",
});
export const row = style({
  display: "grid",
  gridTemplateColumns: "1fr 110px 1fr",
  gap: tokens["spacing/space-8"],
});
export const field = style({ display: "grid", gap: tokens["spacing/space-6"], minWidth: 0 });
export const number = style({ fontSize: "2.5rem", fontVariantNumeric: "tabular-nums" });
export const source = style({
  width: "100%",
  minHeight: 160,
  fontFamily: "monospace",
  resize: "vertical",
  boxSizing: "border-box",
});
export const status = style({
  fontSize: tokens["typography/sans/caption/fontSize"],
  color: tokens["color/ink-2"],
});
globalStyle(`${body} textarea`, {
  font: "inherit",
  minHeight: 80,
  width: "100%",
  boxSizing: "border-box",
});
globalStyle(`${body} progress`, { width: "100%" });
globalStyle(`${body} pre`, {
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  maxHeight: 180,
  overflowY: "auto",
  fontSize: 12,
});
