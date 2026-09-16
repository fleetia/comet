import { globalStyle, style } from "@vanilla-extract/css";
import { semanticVars as vars } from "@fleetia/lagrange/theme";
import * as common from "../lagrange.css";
export const host = style({
  padding: `${vars.space.lg} ${vars.space.lg} ${vars.space.xl}`,
  background: vars.color.surface.canvas,
  minHeight: "100dvh",
  maxWidth: 760,
  margin: "0 auto",
  overflowWrap: "anywhere",
});
export const header = style({
  display: "grid",
  gap: vars.space.sm,
  paddingBottom: vars.space.md,
  borderBottom: `1px solid ${vars.color.border.strong}`,
  marginBottom: vars.space.lg,
});
export const eyebrow = style({
  color: vars.color.content.secondary,
  fontSize: vars.typography.size.caption,
  letterSpacing: "0.08em",
});
export const title = style({
  color: vars.color.content.accent,
  fontFamily: vars.typography.family.display,
  fontSize: vars.typography.size.headingMd,
  lineHeight: vars.typography.lineHeight.tight,
});
export const status = style({
  color: vars.color.content.secondary,
  fontSize: vars.typography.size.label,
  lineHeight: vars.typography.lineHeight.body,
});
export const empty = style({ display: "grid", gap: vars.space.md, padding: `${vars.space.lg} 0` });
export const previewNote = style({
  color: vars.color.content.secondary,
  fontSize: vars.typography.size.caption,
  lineHeight: vars.typography.lineHeight.body,
  marginBottom: vars.space.md,
});
export const body = style({
  display: "flex",
  flexDirection: "column",
  gap: vars.space.md,
  border: 0,
  padding: 0,
  margin: 0,
  minWidth: 0,
});
export const row = style({
  display: "flex",
  gap: vars.space.sm,
  flexWrap: "wrap",
  alignItems: "center",
});
export const item = style({
  borderBottom: `${vars.border.width.hairline} dotted ${vars.color.border.subtle}`,
  padding: `${vars.space.sm} 0`,
  display: "flex",
  flexDirection: "column",
  gap: vars.space.xs,
  overflowWrap: "anywhere",
});
export const number = style({
  textAlign: "center",
  fontSize: "clamp(32px, 10vw, 44px)",
  fontFamily: vars.typography.family.data,
  fontVariantNumeric: "tabular-nums",
  lineHeight: vars.typography.lineHeight.tight,
  padding: `${vars.space.lg} 0 ${vars.space.xs}`,
  color: vars.color.content.accent,
});
export const area = style({
  position: "relative",
  height: "clamp(140px, 40dvh, 230px)",
  background: vars.color.surface.muted,
  border: `${vars.border.width.hairline} solid ${vars.color.border.strong}`,
  borderRadius: vars.shape.radius.subtle,
  overflow: "hidden",
  touchAction: "none",
});
export const token = style({
  position: "absolute",
  transform: "translate(-50%,-50%)",
  fontSize: 28,
  lineHeight: 1,
  background: "transparent",
  border: 0,
  padding: 4,
  transition: "left 500ms linear, top 500ms linear",
  selectors: {
    "&:focus-visible": { outline: `2px solid ${vars.color.interaction.focus}`, outlineOffset: 2 },
    '&[aria-pressed="true"]': { background: vars.color.selection.surface },
  },
  "@media": { "(prefers-reduced-motion: reduce)": { transition: "none" } },
});
export const bubble = style([
  token,
  {
    width: 34,
    height: 34,
    borderRadius: "50%",
    border: `${vars.border.width.hairline} solid ${vars.color.content.accent}`,
    background: vars.color.surface.raised,
    padding: 0,
  },
]);
export const prose = style({
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  lineHeight: vars.typography.lineHeight.body,
});

export const data = style({
  fontFamily: vars.typography.family.data,
  fontVariantNumeric: "tabular-nums slashed-zero",
});
export const section = style({ display: "grid", gap: vars.space.md });
export const sectionTitle = style({
  fontFamily: vars.typography.family.display,
  color: vars.color.content.accent,
  fontSize: vars.typography.size.headingSm,
  lineHeight: vars.typography.lineHeight.compact,
});
export const composer = style({
  display: "grid",
  gap: vars.space.sm,
  padding: 0,
});
export const actions = style({
  display: "flex",
  gap: vars.space.sm,
  alignItems: "flex-end",
  flexWrap: "wrap",
});
export const filters = style({
  display: "flex",
  gap: vars.space.xs,
  flexWrap: "wrap",
  borderBottom: `1px solid ${vars.color.border.subtle}`,
});
export const filterButton = style({
  padding: `${vars.space.xs} ${vars.space.sm}`,
  selectors: {
    '&[aria-pressed="true"]': {
      color: vars.color.content.accent,
      background: vars.color.selection.surface,
      boxShadow: `inset 0 -2px ${vars.color.selection.indicator}`,
    },
  },
});
export const disclosure = style({
  paddingTop: vars.space.sm,
  borderTop: `1px solid ${vars.color.border.subtle}`,
});
export const optionSummary = style({
  display: "block",
  marginTop: vars.space.xs,
  color: vars.color.content.accent,
  fontSize: vars.typography.size.caption,
});
globalStyle(`${host} h2`, {
  fontFamily: vars.typography.family.display,
  fontSize: vars.typography.size.headingSm,
  color: vars.color.content.accent,
  lineHeight: vars.typography.lineHeight.compact,
});
globalStyle(`${host} summary`, {
  padding: `${vars.space.sm} 0`,
  fontSize: vars.typography.size.label,
  color: vars.color.content.secondary,
});
globalStyle(`${host} button`, { maxWidth: "100%", whiteSpace: "normal", overflowWrap: "anywhere" });
globalStyle(`${body} > button`, { alignSelf: "flex-start" });
globalStyle(`${host} input, ${host} select, ${host} textarea`, { minWidth: 0 });
globalStyle(`${actions} > ${common.field}`, { flex: "1 1 140px", marginBottom: 0 });
