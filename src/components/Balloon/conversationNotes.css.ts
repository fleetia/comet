import { style } from "@vanilla-extract/css";
import { semanticVars as vars } from "@fleetia/lagrange/theme";

export const section = style({
  margin: "6px 14px",
  fontSize: vars.typography.size.caption,
  overflowWrap: "anywhere",
});
export const form = style({
  display: "grid",
  gap: vars.space.sm,
  padding: "8px 14px 14px",
  minWidth: 0,
});
export const actions = style({
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: vars.space.xs,
});
export const text = style({
  margin: "6px 0",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
});
export const choices = style({ display: "grid", gap: vars.space.xs, marginTop: vars.space.sm });
export const choice = style({ justifyContent: "flex-start", textAlign: "left", height: "auto" });
export const bodyInput = style({ minHeight: 110, width: "100%" });
