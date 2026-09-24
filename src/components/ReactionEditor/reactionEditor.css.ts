import { style } from "@vanilla-extract/css";
import { semanticVars as vars } from "@fleetia/lagrange/theme";
export const rule = style({
  marginTop: vars.space.md,
  borderTop: `1px solid ${vars.color.border.subtle}`,
  paddingTop: vars.space.sm,
});
export const controls = style({
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: vars.space.sm,
});
export const variant = style({
  borderInlineStart: `2px solid ${vars.color.border.subtle}`,
  paddingLeft: vars.space.sm,
  margin: `${vars.space.sm} 0`,
  display: "grid",
  gap: vars.space.xs,
});
export const advanced = style({ marginTop: vars.space.sm });
export const cooldown = style({ width: 90 });
export const preview = style({
  display: "flex",
  flexWrap: "wrap",
  gap: vars.space.md,
  alignItems: "center",
  minHeight: 100,
  padding: `${vars.space.sm} 0`,
});
export const sprite = style({ display: "grid", placeItems: "center", flexShrink: 0 });
export const image = style({ width: "100%", height: "100%", objectFit: "contain" });
export const speech = style({
  whiteSpace: "pre-wrap",
  margin: 0,
  overflowWrap: "anywhere",
  flex: 1,
  minWidth: 120,
});
