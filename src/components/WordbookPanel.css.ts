import { style } from "@vanilla-extract/css";
import { semanticVars as vars } from "@fleetia/lagrange/theme";
export const layout = style({
  display: "grid",
  gridTemplateColumns: "160px minmax(0, 1fr)",
  alignItems: "start",
  gap: vars.space.lg,
  marginTop: vars.space.lg,
  "@media": { "(max-width: 650px)": { gridTemplateColumns: "1fr" } },
});
export const entries = style({
  display: "flex",
  flexDirection: "column",
  gap: vars.space.xxs,
  maxHeight: 340,
  overflowY: "auto",
  "@media": { "(max-width: 650px)": { maxHeight: 160 } },
});
export const entry = style({
  width: "100%",
  justifyContent: "flex-start",
  textAlign: "left",
  minHeight: vars.dimension.row,
  padding: `${vars.space.xs} ${vars.space.sm}`,
  border: 0,
  borderBottom: `1px dotted ${vars.color.border.subtle}`,
  borderInlineStart: "2px solid transparent",
  overflowWrap: "anywhere",
  whiteSpace: "normal",
  selectors: {
    '&[aria-pressed="true"]': {
      color: vars.color.content.accent,
      background: vars.color.selection.surface,
      borderInlineStartColor: vars.color.selection.indicator,
    },
  },
});
export const editor = style({ border: 0, margin: 0, padding: 0, minWidth: 0 });
export const legend = style({
  fontSize: vars.typography.size.caption,
  color: vars.color.content.secondary,
  marginBottom: vars.space.sm,
  padding: 0,
});
export const line = style({
  marginTop: vars.space.md,
  paddingTop: vars.space.sm,
  paddingBottom: vars.space.sm,
  borderTop: `1px dotted ${vars.color.border.subtle}`,
});
export const actions = style({
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: vars.space.sm,
});
export const saveBar = style({
  display: "grid",
  gap: vars.space.sm,
  marginTop: vars.space.lg,
});
export const confirmation = style({
  padding: vars.space.md,
  display: "grid",
  gap: vars.space.sm,
  color: vars.color.content.primary,
  background: vars.color.surface.muted,
  fontSize: vars.typography.size.label,
});
