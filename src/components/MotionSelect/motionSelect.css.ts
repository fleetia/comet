import { style } from "@vanilla-extract/css";
import { semanticVars as vars } from "@fleetia/lagrange/theme";
export const container = style({
  display: "flex",
  flexWrap: "wrap",
  alignItems: "end",
  gap: vars.space.sm,
  marginTop: vars.space.xs,
});
export const number = style({ width: 88 });
export const hint = style({
  color: vars.color.content.secondary,
  fontSize: vars.typography.size.caption,
  alignSelf: "center",
});
export const error = style({
  width: "100%",
  color: vars.color.content.secondary,
  fontSize: vars.typography.size.caption,
  margin: 0,
});
