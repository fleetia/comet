import { globalStyle, style } from "@vanilla-extract/css";
import { semanticVars as vars, componentVars } from "@fleetia/lagrange/theme";
import * as common from "../lagrange.css";
export const host = style({
  maxWidth: 760,
  margin: "0 auto",
  overflowWrap: "anywhere",
});
export const focusHost = style([host, { maxWidth: "none" }]);
export const focusHeaderActions = style({ border: 0, padding: 0, margin: 0, minWidth: 0 });
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
export const musicContent = style({
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  "@media": { "(max-height: 440px)": { overflowY: "auto" } },
});
export const musicBody = style([
  body,
  { flex: 1, minHeight: 0, "@media": { "(max-height: 440px)": { flex: "none" } } },
]);
export const focusContent = style({
  display: "flex",
  flexDirection: "column",
  padding: 0,
  overflow: "hidden",
});
export const focusBody = style([body, { flex: 1, minHeight: 0 }]);
globalStyle(`${focusHost} ${focusContent}`, { padding: 0 });
export const row = style({
  display: "flex",
  gap: vars.space.sm,
  flexWrap: "wrap",
  alignItems: "center",
});
export const item = style({
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
  padding: vars.space.xs,
  transition: "left 500ms linear, top 500ms linear",
  selectors: {
    "&:focus-visible": { outline: `2px solid ${vars.color.interaction.focus}`, outlineOffset: 2 },
    '&[aria-pressed="true"]': {
      background: componentVars.navigation.selectedSurface,
      color: componentVars.navigation.selectedText,
    },
    '&[aria-pressed="true"]:focus-visible': {
      outlineColor: componentVars.navigation.selectedText,
      outlineOffset: -2,
    },
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

export const jarSummary = style({
  display: "grid",
  gap: vars.space.sm,
  padding: vars.space.lg,
  textAlign: "center",
  background: vars.color.surface.raised,
  borderRadius: vars.shape.radius.subtle,
});
export const jarCount = style([number, { padding: 0 }]);
export const marbles = style({
  display: "flex",
  flexWrap: "wrap",
  justifyContent: "center",
  alignItems: "center",
  gap: vars.space.sm,
  minHeight: vars.dimension.control,
});
export const marble = style({
  width: vars.space.lg,
  height: vars.space.lg,
  borderRadius: "50%",
  background: vars.color.content.accent,
});
export const completedList = style({ listStyle: "none", padding: 0, margin: 0 });

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
});
export const filterButton = style({
  padding: `${vars.space.xs} ${vars.space.sm}`,
  selectors: {
    '&[aria-pressed="true"]': {
      color: componentVars.navigation.selectedText,
      background: componentVars.navigation.selectedSurface,
    },
    '&[aria-pressed="true"]:hover:not(:disabled)': {
      color: componentVars.navigation.selectedText,
      background: componentVars.navigation.selectedSurface,
    },
    '&[aria-pressed="true"]:focus-visible': {
      outlineColor: componentVars.navigation.selectedText,
      outlineOffset: -3,
    },
  },
});
export const disclosure = style({
  paddingTop: vars.space.sm,
  borderTop: `${vars.border.width.hairline} solid ${vars.color.border.subtle}`,
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

export const regionSearch = style({
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 132px",
  gap: vars.space.md,
  alignItems: "end",
  "@media": { "(max-width: 1000px)": { gridTemplateColumns: "minmax(0, 1fr) 96px" } },
});

export const regionResult = style({
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 144px",
  alignItems: "center",
  gap: vars.space.md,
  minHeight: 40,
  "@media": { "(max-width: 1000px)": { gridTemplateColumns: "minmax(0, 1fr) 96px" } },
});

export const weatherHeading = style({ display: "grid", gap: vars.space.xs });
export const weatherStatus = style({
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: vars.space.lg,
  alignItems: "center",
  minHeight: 48,
  paddingTop: vars.space.md,
  borderTop: `${vars.border.width.hairline} solid ${vars.color.border.subtle}`,
  fontSize: vars.typography.size.label,
  lineHeight: vars.typography.lineHeight.body,
  "@media": { "(max-width: 1000px)": { gridTemplateColumns: "1fr", gap: vars.space.xs } },
});
export const weatherResults = style({
  display: "grid",
  gap: vars.space.xs,
  padding: vars.space.md,
  minHeight: 0,
  maxHeight: 224,
  overflowY: "auto",
  overscrollBehavior: "contain",
});
export const observation = style({ display: "grid", gap: vars.space.md, minWidth: 0 });
export const weatherReadings = style({
  display: "grid",
  gridTemplateColumns: "216fr 256fr 264fr",
  gap: vars.space.lg,
  alignItems: "center",
  minHeight: 72,
  fontSize: vars.typography.size.label,
  lineHeight: vars.typography.lineHeight.body,
  "@media": { "(max-width: 1000px)": { gridTemplateColumns: "1fr 1fr", gap: vars.space.md } },
});
export const weatherTemperature = style({
  fontSize: vars.typography.size.headingMd,
  fontWeight: 700,
  lineHeight: vars.typography.lineHeight.tight,
});
export const observationSource = style({
  paddingTop: vars.space.md,
  borderTop: `${vars.border.width.hairline} solid ${vars.color.border.subtle}`,
});
