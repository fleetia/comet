import { globalStyle, style } from "@vanilla-extract/css";
import { semanticVars as v, componentVars, vnextVars } from "@fleetia/lagrange/theme";
import { tokens } from "@comet/token";

export const root = style({
  width: "100%",
  height: "100%",
  minHeight: 0,
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  color: v.color.content.primary,
});
export const settingsFields = style({ border: 0, padding: 0, margin: 0, minWidth: 0 });
export const toolbar = style({
  display: "flex",
  justifyContent: "flex-end",
  alignItems: "center",
  gap: v.space.xs,
});
export const layout = style({
  display: "grid",
  gridTemplateColumns: "310px minmax(0, 1fr)",
  alignItems: "start",
  gap: 22,
  padding: 20,
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  selectors: { '&[data-expanded="false"]': { gridTemplateColumns: "minmax(0, 310px) 0" } },
  "@media": { "(max-width: 680px)": { gridTemplateColumns: "minmax(0, 1fr)", padding: 12 } },
});
export const timer = style({
  width: "100%",
  maxWidth: 310,
  minWidth: 0,
  padding: 16,
  border: `1px solid ${tokens["color/glass-border-soft"]}`,
  borderRadius: tokens["radius/radius-22"],
  background: tokens["color/glass-widget"],
  backdropFilter: tokens["backdrop/backdrop-panel"],
  boxShadow: `inset 0 1px 0 ${tokens["color/window-highlight"]}, 0 14px 34px ${tokens["color/surface-shadow"]}`,
});
export const focusSetup = style({
  display: "flex",
  flexDirection: "column",
  gap: v.space.sm,
  marginTop: 0,
  minWidth: 0,
});
export const focusField = style({ gap: v.space.sm });
export const inlineField = style({
  display: "grid",
  gridTemplateColumns: "auto minmax(0, 1fr)",
  alignItems: "center",
  gap: v.space.sm,
});
export const optionalSetup = style({
  selectors: { '[data-expanded="false"] &': { display: "none" } },
});
export const timerTop = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: v.space.sm,
});
export const eyebrow = style({
  fontFamily: v.typography.family.data,
  letterSpacing: ".08em",
  color: v.color.content.secondary,
  fontSize: 10,
});
export const modes = style({
  display: "flex",
  gap: v.space.xxs,
  padding: v.space.xxs,
  background: v.color.surface.muted,
  borderRadius: vnextVars.radius.control,
});
export const mode = style({
  selectors: {
    '&[aria-pressed="true"]': {
      background: v.color.surface.raised,
      color: v.color.content.primary,
    },
  },
});
export const title = style({
  fontFamily: v.typography.family.display,
  fontSize: v.typography.size.headingSm,
  lineHeight: v.typography.lineHeight.compact,
  minWidth: 0,
});
export const quiet = style({
  color: v.color.content.secondary,
  fontSize: v.typography.size.caption,
  lineHeight: v.typography.lineHeight.body,
});
export const related = style({
  display: "flex",
  gap: v.space.xs,
  alignItems: "center",
  minHeight: 24,
  color: v.color.content.secondary,
  fontSize: v.typography.size.caption,
  overflowWrap: "anywhere",
});
export const clock = style({
  position: "relative",
  width: "min(100%, 160px)",
  flexShrink: 0,
  aspectRatio: "1",
  margin: "0 auto",
  display: "grid",
  placeItems: "center",
  borderRadius: "50%",
  background: "transparent",
  transition: "width 280ms cubic-bezier(0.22, 1, 0.36, 1), margin 280ms ease",
  selectors: {
    '[data-expanded="false"] &': {
      width: "min(100%, 160px)",
      margin: "0 auto",
    },
  },
  "@media": { "(prefers-reduced-motion: reduce)": { transition: "none" } },
});
export const timerReadouts = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexWrap: "wrap",
  gap: v.space.md,
  margin: `${v.space.md} 0 ${v.space.lg}`,
  minWidth: 0,
});
export const appUsage = style({
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  flex: "1 1 140px",
  minWidth: 0,
  maxWidth: "100%",
  gap: v.space.xs,
  padding: v.space.md,
  borderRadius: vnextVars.radius.control,
  background: v.color.surface.muted,
});
export const appUsageName = style({
  fontSize: v.typography.size.caption,
  lineHeight: v.typography.lineHeight.body,
  overflowWrap: "anywhere",
});
export const appUsageTime = style({
  fontFamily: v.typography.family.data,
  fontVariantNumeric: "tabular-nums",
  fontSize: 28,
  lineHeight: 1.2,
});
export const dial = style({
  position: "absolute",
  width: "100%",
  height: "100%",
  inset: 0,
  overflow: "visible",
});
export const dialTrack = style({ fill: "none", stroke: tokens["color/track"], strokeWidth: 11 });
export const dialArc = style({
  fill: "none",
  stroke: tokens["color/cat-focus"],
  strokeWidth: 11,
  strokeLinecap: "round",
  transform: "rotate(-90deg)",
  transformOrigin: "125px 125px",
});
export const ticks = style({ stroke: v.color.content.secondary, opacity: 0.65, strokeWidth: 1 });
export const clockCenter = style({
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: v.space.sm,
  position: "relative",
});
export const time = style({
  fontFamily: tokens["typography/display/timer/fontFamily"],
  fontVariantNumeric: "tabular-nums",
  fontSize: tokens["typography/display/timer/fontSize"],
  lineHeight: 1.2,
  letterSpacing: "-.055em",
  selectors: { '[data-presentation="digits"] &': { fontSize: "clamp(56px, 10vw, 78px)" } },
});
export const progress = style({
  height: 3,
  background: v.color.border.subtle,
  borderRadius: 2,
  overflow: "hidden",
  position: "absolute",
  left: "8%",
  right: "8%",
  bottom: 25,
});
export const progressFill = style({ height: "100%", background: v.color.content.accent });
export const presets = style({
  display: "flex",
  justifyContent: "center",
  gap: v.space.xs,
  flexWrap: "wrap",
});
export const preset = style({
  minHeight: 32,
  padding: `${v.space.xs} ${v.space.md}`,
  selectors: {
    '&[aria-pressed="true"]': {
      background: componentVars.navigation.selectedSurface,
      color: componentVars.navigation.selectedText,
    },
  },
});
export const timerStatus = style({
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  overflow: "hidden",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
});
export const timerHelp = style([quiet, { textAlign: "center", paddingTop: v.space.lg }]);
export const controls = style({ display: "flex", flexDirection: "column", gap: v.space.md });
export const row = style({
  display: "flex",
  alignItems: "center",
  gap: v.space.sm,
  flexWrap: "wrap",
});
export const mainAction = style({ width: "100%", minHeight: 36 });
export const context = style({
  minWidth: 0,
  minHeight: 0,
  overflowY: "auto",
  background: "transparent",
  selectors: { '[data-expanded="false"] &': { visibility: "hidden", pointerEvents: "none" } },
});
export const tabs = style({ minWidth: 0 });
export const tabList = style({
  minHeight: 60,
  alignItems: "center",
  gap: v.space.sm,
  padding: `${v.space.sm} ${v.space.xl}`,
  selectors: {
    [`${root} ${context} &`]: { borderBottom: `1px solid ${v.color.border.subtle}` },
  },
});
export const tabPanel = style({ padding: 0, minWidth: 0 });
export const pane = style({
  display: "flex",
  flexDirection: "column",
  gap: v.space.md,
  minWidth: 0,
});
export const heading = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: v.space.sm,
});
export const headingText = style({
  fontFamily: v.typography.family.display,
  fontSize: v.typography.size.headingSm,
  margin: 0,
});
export const week = style({
  display: "grid",
  gridTemplateColumns: "repeat(7, minmax(0,1fr))",
  gap: v.space.xxs,
});
export const day = style({
  width: "100%",
  display: "flex",
  flexDirection: "column",
  gap: v.space.xxs,
  padding: v.space.xs,
  fontVariantNumeric: "tabular-nums",
  selectors: {
    '&[aria-pressed="true"]': {
      background: v.color.selection.surface,
      boxShadow: `inset 0 -2px ${v.color.selection.indicator}`,
    },
  },
});
export const item = style({
  display: "flex",
  alignItems: "center",
  gap: v.space.sm,
  borderBottom: `1px solid ${v.color.border.subtle}`,
  padding: `${v.space.md} 0`,
  minWidth: 0,
});
export const grow = style({ flex: 1, minWidth: 0 });
export const itemButton = style({
  textAlign: "left",
  padding: 0,
  justifyContent: "flex-start",
  flex: 1,
  minWidth: 0,
});
export const activityList = style({
  display: "flex",
  flexDirection: "column",
  gap: 0,
  minWidth: 0,
});
export const recordButton = style([
  itemButton,
  { width: "100%", flex: "none", whiteSpace: "normal" },
]);
export const recordRow = style([item, { width: "100%" }]);
export const statsSummary = style({
  display: "flex",
  alignItems: "baseline",
  gap: v.space.md,
  margin: `${v.space.sm} 0 ${v.space.md}`,
});
export const chartCaption = style({ textAlign: "center", paddingBottom: v.space.md });
export const recordHeading = style([
  heading,
  { borderTop: `1px solid ${v.color.border.subtle}`, paddingTop: v.space.lg },
]);
export const memoSection = style([pane, { gap: v.space.sm, paddingBottom: v.space.sm }]);
export const noteSection = style([
  pane,
  { borderTop: `1px solid ${v.color.border.subtle}`, paddingTop: v.space.xl },
]);
export const itemTitle = style({
  display: "block",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});
export const caption = style({
  display: "block",
  color: v.color.content.secondary,
  fontSize: v.typography.size.caption,
  marginTop: v.space.xxs,
});
export const timeline = style({
  position: "relative",
  marginLeft: 36,
  borderTop: `1px solid ${v.color.border.subtle}`,
});
export const hour = style({
  position: "absolute",
  left: 0,
  right: 0,
  height: 1,
  background: v.color.border.subtle,
});
export const hourLabel = style({
  position: "absolute",
  right: "calc(100% + 8px)",
  top: -8,
  width: 36,
  whiteSpace: "nowrap",
  textAlign: "right",
  color: v.color.content.secondary,
  fontSize: 10,
  fontFamily: v.typography.family.data,
});
export const timeBlock = style({
  position: "absolute",
  border: 0,
  borderLeft: `2px solid ${v.color.border.strong}`,
  background: v.color.surface.muted,
  borderRadius: vnextVars.radius.control,
  overflow: "hidden",
  textAlign: "left",
  fontSize: 11,
  padding: "4px 6px",
  color: v.color.content.primary,
  cursor: "pointer",
  selectors: {
    "&:focus-visible": { outline: `2px solid ${v.color.interaction.focus}`, outlineOffset: 2 },
  },
});
export const actualBlock = style([
  timeBlock,
  {
    background: v.color.selection.surface,
    borderLeftColor: v.color.content.accent,
    color: v.color.content.accent,
  },
]);
export const form = style({
  display: "flex",
  flexDirection: "column",
  gap: v.space.md,
  padding: v.space.md,
  background: v.color.surface.muted,
  borderRadius: vnextVars.radius.inset,
});
export const fields = style({
  display: "grid",
  gridTemplateColumns: "repeat(2,minmax(0,1fr))",
  gap: v.space.sm,
});
export const textArea = style({
  width: "100%",
  minHeight: 155,
  resize: "vertical",
  selectors: { [`${root} ${context} &`]: { padding: v.space.md } },
});
export const chart = style({
  display: "flex",
  height: 190,
  alignItems: "stretch",
  gap: v.space.sm,
  selectors: { '&[data-dense="true"]': { gap: 3 } },
});
export const bar = style({
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  flex: 1,
  minWidth: 0,
  padding: 0,
  border: 0,
  background: "transparent",
  color: v.color.content.secondary,
  cursor: "pointer",
  selectors: {
    "&:focus-visible": { outline: `2px solid ${v.color.interaction.focus}`, outlineOffset: 2 },
    '&[aria-pressed="true"]': { color: v.color.content.primary },
  },
});
export const barTrack = style({
  position: "relative",
  background: v.color.surface.muted,
  borderRadius: 22,
  width: "100%",
  maxWidth: 42,
  height: 155,
  overflow: "hidden",
});
export const barFill = style({
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 0,
  background: v.color.content.accent,
  borderRadius: "inherit",
});
export const barLabel = style({
  fontSize: 10,
  fontFamily: v.typography.family.data,
  marginTop: v.space.sm,
});
export const total = style({
  fontFamily: v.typography.family.data,
  fontSize: 30,
  fontVariantNumeric: "tabular-nums",
});
export const detailTime = style([total, { margin: `${v.space.lg} 0 ${v.space.xs}` }]);
export const prose = style({
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  lineHeight: v.typography.lineHeight.body,
  fontSize: v.typography.size.body,
});
export const empty = style([quiet, { padding: `${v.space.lg} 0` }]);
export const error = style({ color: v.color.status.critical, fontSize: v.typography.size.caption });
export const notice = style({
  background: v.color.selection.surface,
  borderRadius: vnextVars.radius.inset,
  padding: v.space.md,
  fontSize: v.typography.size.caption,
});
export const meta = style({
  display: "grid",
  gridTemplateColumns: "60px minmax(0,1fr)",
  gap: v.space.sm,
  margin: `${v.space.md} 0`,
});
globalStyle(`${meta} dt`, { color: v.color.content.secondary });
globalStyle(`${meta} dd`, { margin: 0, overflowWrap: "anywhere" });
globalStyle(`${root} input, ${root} select, ${root} textarea`, { minWidth: 0 });
globalStyle(`${timer} p, ${timer} h1`, { margin: 0 });

export const recordsPanel = style({ width: "100%", maxWidth: "none", boxSizing: "border-box" });

export const appUsageDetails = style({ fontSize: 11, color: tokens["color/ink-3"], marginTop: 8 });
