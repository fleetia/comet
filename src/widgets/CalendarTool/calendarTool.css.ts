import { globalStyle, style } from "@vanilla-extract/css";
import { semanticVars as vars } from "@fleetia/lagrange/theme";

export const alerts = style({
  minWidth: 0,
  paddingTop: vars.space.md,
  borderTop: `${vars.border.width.hairline} solid ${vars.color.border.subtle}`,
});
export const alertsSummary = style({
  cursor: "pointer",
  paddingBlock: vars.space.sm,
  color: vars.color.content.primary,
  fontSize: vars.typography.size.label,
  lineHeight: vars.typography.lineHeight.body,
  fontWeight: 600,
});
globalStyle(`${alerts}[open] > summary`, { marginBottom: vars.space.md });
