import { style, globalStyle } from "@vanilla-extract/css";
import { semanticVars as vars } from "@fleetia/lagrange/theme";

export const body = style({
  display: "grid",
  gap: vars.space.md,
  minWidth: 0,
  padding: vars.space.lg,
});
export const list = style({ display: "grid", gap: vars.space.md, marginTop: vars.space.lg });
export const item = style({
  borderTop: `1px solid ${vars.color.border.subtle}`,
  paddingTop: vars.space.md,
  display: "grid",
  gap: vars.space.sm,
});
export const actions = style({
  display: "flex",
  gap: vars.space.sm,
  flexWrap: "wrap",
  alignItems: "center",
});
export const row = style({
  display: "grid",
  gridTemplateColumns: "1fr 110px 1fr",
  gap: vars.space.sm,
});
export const field = style({ display: "grid", gap: vars.space.xs, minWidth: 0 });
export const number = style({ fontSize: "2.5rem", fontVariantNumeric: "tabular-nums" });
export const source = style({
  width: "100%",
  minHeight: 160,
  fontFamily: "monospace",
  resize: "vertical",
  boxSizing: "border-box",
});
export const status = style({
  fontSize: vars.typography.size.caption,
  color: vars.color.content.secondary,
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
