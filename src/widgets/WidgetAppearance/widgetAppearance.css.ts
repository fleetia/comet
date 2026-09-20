import { style } from "@vanilla-extract/css";
import { semanticVars as vars } from "@fleetia/lagrange/theme";

export const settings = style({
  display: "grid",
  gap: vars.space.md,
  padding: `${vars.space.sm} 0 ${vars.space.md}`,
});
export const description = style({
  color: vars.color.content.secondary,
  fontSize: vars.typography.size.caption,
  lineHeight: vars.typography.lineHeight.body,
});
export const preview = style({
  minHeight: 132,
  display: "flex",
  padding: vars.space.lg,
  backgroundRepeat: "no-repeat",
  backgroundSize: "cover",
  border: `${vars.border.width.hairline} solid ${vars.color.border.subtle}`,
  borderRadius: vars.shape.radius.subtle,
  overflow: "hidden",
});
export const previewText = style({
  display: "grid",
  gap: vars.space.xs,
  maxWidth: "86%",
  padding: `${vars.space.sm} ${vars.space.md}`,
  background: "rgba(0, 0, 0, 0.24)",
  borderRadius: vars.shape.radius.subtle,
  fontFamily: vars.typography.family.display,
  fontSize: vars.typography.size.headingSm,
  lineHeight: vars.typography.lineHeight.compact,
  textShadow: "0 1px 8px rgba(0, 0, 0, 0.28)",
});
export const colors = style({
  display: "flex",
  flexWrap: "wrap",
  gap: vars.space.sm,
});
export const positions = style({
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
  gap: vars.space.md,
});
export const fileActions = style({
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: vars.space.sm,
});
export const error = style({
  color: vars.color.status.critical,
  fontSize: vars.typography.size.label,
  lineHeight: vars.typography.lineHeight.body,
});
export const saved = style({
  color: vars.color.status.positive,
  fontSize: vars.typography.size.label,
});
