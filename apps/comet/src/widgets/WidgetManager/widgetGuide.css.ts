import { style } from "@vanilla-extract/css";
import { semanticVars as vars } from "@fleetia/lagrange/theme";

export const guide = style({
  display: "flex",
  flexDirection: "column",
  gap: vars.space.lg,
  minWidth: 0,
  minHeight: 0,
  maxWidth: 720,
  maxHeight: "100%",
  padding: vars.space.lg,
  overflowY: "auto",
  overscrollBehavior: "contain",
});

export const introduction = style({
  display: "grid",
  gap: vars.space.sm,
  lineHeight: vars.typography.lineHeight.body,
});

export const runtime = style({
  margin: 0,
  color: vars.color.content.secondary,
});

export const related = style({
  paddingTop: vars.space.lg,
  borderTop: `${vars.border.width.hairline} solid ${vars.color.border.subtle}`,
});
