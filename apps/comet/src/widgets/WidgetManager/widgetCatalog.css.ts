import { style } from "@vanilla-extract/css";
import { semanticVars as vars, vnextVars } from "@fleetia/lagrange/theme";

export const catalog = style({
  minWidth: 0,
  minHeight: 0,
  padding: vars.space.md,
  borderRadius: vnextVars.radius.parent,
  display: "flex",
  flexDirection: "column",
  gap: vars.space.sm,
  overflow: "hidden",
});
export const title = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  flexShrink: 0,
  minHeight: 24,
});
export const list = style({
  minHeight: 0,
  flex: 1,
  overflowY: "auto",
  overscrollBehavior: "contain",
});
export const group = style({ marginBottom: vars.space.md });
export const groupToggle = style({
  display: "grid",
  gridTemplateColumns: "16px minmax(0, 1fr) auto",
  alignItems: "center",
  gap: vars.space.xs,
  width: "100%",
  minHeight: 40,
  padding: `${vars.space.xs} ${vars.space.sm}`,
  border: 0,
  background: "transparent",
  color: vars.color.content.primary,
  textAlign: "left",
  font: "inherit",
  fontWeight: 600,
  borderRadius: vars.shape.radius.subtle,
  cursor: "pointer",
  selectors: {
    "&:focus-visible": { outline: `2px solid ${vars.color.interaction.focus}`, outlineOffset: -2 },
  },
});
export const count = style({
  fontSize: vars.typography.size.caption,
  color: vars.color.content.secondary,
  fontWeight: 400,
});
export const entry = style({
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: vars.space.xs,
  width: "100%",
  minHeight: 36,
  padding: `${vars.space.xs} ${vars.space.sm}`,
  border: 0,
  fontSize: vars.typography.size.label,
  lineHeight: vars.typography.lineHeight.body,
  borderRadius: vars.shape.radius.subtle,
});
export const entryName = style({
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});
export const status = style({
  fontSize: vars.typography.size.caption,
  opacity: 0.7,
  whiteSpace: "nowrap",
  selectors: { '&[data-attention="true"]': { fontWeight: 700, opacity: 1 } },
});
export const empty = style({ padding: `${vars.space.lg} 0` });
