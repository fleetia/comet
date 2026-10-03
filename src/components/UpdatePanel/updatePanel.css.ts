import { style } from "@vanilla-extract/css";
import { semanticVars as vars } from "@fleetia/lagrange/theme";

export const panel = style({
  alignSelf: "start",
  width: "100%",
  maxWidth: 792,
  display: "flex",
  flexDirection: "column",
  gap: vars.space.md,
});
export const identity = style({
  display: "flex",
  alignItems: "center",
  gap: vars.space.md,
  minHeight: 48,
});
export const identityCopy = style({ display: "grid", gap: vars.space.xs });
export const appName = style({
  fontSize: vars.typography.size.headingSm,
  lineHeight: vars.typography.lineHeight.compact,
});
export const caption = style({
  fontSize: vars.typography.size.caption,
  lineHeight: vars.typography.lineHeight.body,
});
export const update = style({
  borderTop: `${vars.border.width.hairline} solid ${vars.color.surface.raised}`,
  paddingTop: vars.space.md,
  display: "flex",
  flexDirection: "column",
  gap: vars.space.md,
});
export const about = style({
  fontSize: vars.typography.size.caption,
  lineHeight: vars.typography.lineHeight.body,
  paddingTop: vars.space.md,
  borderTop: `${vars.border.width.hairline} solid ${vars.color.surface.raised}`,
});
export const actions = style({ display: "flex", flexWrap: "wrap", gap: vars.space.md });
export const updateButton = style({ width: 144 });

export const status = style({
  minHeight: vars.dimension.row,
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
});
