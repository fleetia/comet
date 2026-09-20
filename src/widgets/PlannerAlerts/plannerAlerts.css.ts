import { style } from "@vanilla-extract/css";
import { semanticVars as vars } from "@fleetia/lagrange/theme";
export const columns = style({
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: vars.space.md,
  "@media": { "(max-width: 760px)": { gridTemplateColumns: "1fr" } },
});
export const group = style({
  display: "grid",
  alignContent: "start",
  gap: vars.space.xs,
  minWidth: 0,
});
export const permission = style({
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: vars.space.sm,
  borderTop: `1px solid ${vars.color.border.subtle}`,
  paddingTop: vars.space.sm,
});
export const heading = style({
  fontSize: vars.typography.size.label,
  color: vars.color.content.accent,
  marginTop: vars.space.sm,
});
export const notice = style({
  display: "grid",
  gap: vars.space.xs,
  padding: vars.space.sm,
  background: vars.color.selection.surface,
  borderBottom: `1px solid ${vars.color.border.subtle}`,
});
