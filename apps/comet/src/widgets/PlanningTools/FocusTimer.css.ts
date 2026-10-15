import { globalStyle, style } from "@vanilla-extract/css";
import { semanticVars as v, vnextVars } from "@fleetia/lagrange/theme";

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
export const timer = style({ width: "100%", maxWidth: 310, minWidth: 0 });
export const inlineField = style({
  display: "grid",
  gridTemplateColumns: "auto minmax(0, 1fr)",
  alignItems: "center",
  gap: v.space.sm,
});
export const optionalSetup = style({
  selectors: { '[data-expanded="false"] &': { display: "none" } },
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
export const timerStatus = style({
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  overflow: "hidden",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
});
export const row = style({
  display: "flex",
  alignItems: "center",
  gap: v.space.sm,
  flexWrap: "wrap",
});
export const context = style({
  minWidth: 0,
  minHeight: 0,
  overflowY: "auto",
  background: "transparent",
  selectors: { '[data-expanded="false"] &': { visibility: "hidden", pointerEvents: "none" } },
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
