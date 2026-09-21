import { style } from "@vanilla-extract/css";
import { semanticVars as vars } from "@fleetia/lagrange/theme";

export const header = style({
  display: "flex",
  alignItems: "flex-start",
  gap: vars.space.md,
  width: "100%",
});
export const title = style({
  flex: 1,
  alignSelf: "stretch",
  minWidth: 0,
  userSelect: "none",
});
export const brand = style({
  display: "flex",
  alignItems: "center",
  gap: vars.space.sm,
  minWidth: 0,
  height: "100%",
  whiteSpace: "nowrap",
});
export const icon = style({ display: "block", flexShrink: 0 });
export const brandName = style({
  flexShrink: 0,
  color: vars.color.content.accent,
  fontFamily: vars.typography.family.display,
  fontSize: vars.typography.size.body,
  fontWeight: 600,
  lineHeight: vars.typography.lineHeight.compact,
});
export const windowName = style({
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  color: vars.color.content.secondary,
  fontSize: vars.typography.size.caption,
  lineHeight: vars.typography.lineHeight.compact,
});
export const grabTarget = style({
  cursor: "grab",
  ":active": { cursor: "grabbing" },
});
export const actions = style({
  display: "flex",
  alignItems: "center",
  flexShrink: 0,
  gap: vars.space.sm,
});
export const close = style({ fontSize: 24, lineHeight: 1 });
