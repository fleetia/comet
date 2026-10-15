import { style } from "@vanilla-extract/css";
import { semanticVars as vars } from "@fleetia/lagrange/theme";
import { tokens } from "@comet/token";

export const guide = style({
  display: "flex",
  flexDirection: "column",
  gap: 24,
  minWidth: 0,
  minHeight: 0,
  maxWidth: 720,
  maxHeight: "100%",
  padding: 24,
  borderRadius: tokens["radius/radius-18"],
  background: tokens["color/card"],
  border: `1px solid ${tokens["color/card-border"]}`,
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
