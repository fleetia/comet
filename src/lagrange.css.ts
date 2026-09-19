import { globalStyle, style } from "@vanilla-extract/css";
import { semanticVars as vars } from "@fleetia/lagrange/theme";

export const eyebrow = style({
  fontSize: vars.typography.size.caption,
  letterSpacing: "0.15em",
  fontWeight: 600,
  color: vars.color.content.secondary,
});
export const quiet = style({
  color: vars.color.content.secondary,
  fontSize: vars.typography.size.caption,
  lineHeight: vars.typography.lineHeight.body,
});
export const inline = style({
  display: "flex",
  alignItems: "center",
  gap: vars.space.sm,
  whiteSpace: "nowrap",
});
globalStyle(`${inline} select`, { width: "auto" });
export const row = style({
  display: "flex",
  flexWrap: "wrap",
  gap: vars.space.md,
  alignItems: "center",
  margin: `${vars.space.md} 0`,
});
export const field = style({
  display: "flex",
  flexDirection: "column",
  gap: vars.space.sm,
  fontSize: vars.typography.size.label,
  marginBottom: vars.space.lg,
  minWidth: 0,
});
export const error = style({
  fontSize: vars.typography.size.label,
  color: vars.color.status.critical,
  background: vars.color.status.criticalSurface,
  padding: `${vars.space.sm} ${vars.space.md}`,
  marginTop: vars.space.sm,
  lineHeight: vars.typography.lineHeight.body,
  overflowWrap: "anywhere",
});
export const success = style({
  fontSize: vars.typography.size.label,
  color: vars.color.status.positive,
  padding: `${vars.space.sm} 0`,
});
export const settings = style({
  maxWidth: 680,
  padding: `${vars.space.xxl} ${vars.space.xl} 40px`,
  margin: "0 auto",
  minHeight: "100dvh",
});
export const previewSettings = style({
  borderTop: `${vars.border.width.hairline} solid ${vars.color.border.strong}`,
  minHeight: 0,
});
export const settingsTitle = style({
  fontFamily: vars.typography.family.display,
  fontSize: vars.typography.size.headingMd,
  fontWeight: 600,
  letterSpacing: "-0.025em",
  marginBottom: vars.space.sm,
});
export const section = style({
  border: 0,
  margin: `${vars.space.xxl} 0 0`,
  padding: `${vars.space.xl} 0 0`,
  borderTop: `${vars.border.width.hairline} solid ${vars.color.border.subtle}`,
});
export const sectionTitle = style({
  fontSize: vars.typography.size.headingSm,
  fontWeight: 600,
  marginBottom: vars.space.lg,
});
export const tabs = style({
  display: "flex",
  gap: vars.space.sm,
  margin: `${vars.space.xl} 0 ${vars.space.lg}`,
});
export const choice = style({
  display: "block",
  flex: 1,
  minWidth: 0,
  padding: `${vars.space.md} ${vars.space.lg}`,
  textAlign: "left",
  whiteSpace: "normal",
  selectors: {
    '&[aria-pressed="true"]': {
      borderColor: vars.color.selection.indicator,
      background: vars.color.selection.surface,
      color: vars.color.content.accent,
    },
    '&[aria-pressed="true"]:hover:not(:disabled)': {
      background: vars.color.selection.surface,
    },
  },
});
export const memory = style({
  padding: `${vars.space.md} 0`,
  borderBottom: `${vars.border.width.hairline} dotted ${vars.color.border.subtle}`,
});
export const progress = style({
  width: "100%",
  accentColor: vars.color.status.positive,
  height: 7,
});
export const emptyHint = style({
  marginTop: vars.space.md,
  fontSize: vars.typography.size.label,
  color: vars.color.content.secondary,
  lineHeight: vars.typography.lineHeight.body,
});
export const loadingHeader = style({
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  padding: vars.space.sm,
  zIndex: 1,
  background: vars.color.surface.canvas,
});
export const loading = style({
  display: "grid",
  placeContent: "center",
  minHeight: "100dvh",
  gap: vars.space.lg,
  padding: vars.space.xl,
});
