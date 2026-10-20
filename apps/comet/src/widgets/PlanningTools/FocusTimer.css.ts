import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const root = style({
  width: "100%",
  height: "100%",
  minHeight: 0,
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  overflowY: "auto",
  overflowX: "hidden",
  color: tokens["color/ink"],
  fontFamily: tokens["typography/sans/body/fontFamily"],
  fontSize: 13,
  lineHeight: "18px",
});
export const settingsFields = style({ border: 0, padding: 0, margin: 0, minWidth: 0 });
export const settingsRoot = style({
  display: "flex",
  flexDirection: "column",
  gap: 16,
  minWidth: 0,
});
export const settingsSection = style({
  display: "flex",
  flexDirection: "column",
  gap: 8,
  minWidth: 0,
});
export const settingsHeading = style({
  margin: 0,
  fontFamily: tokens["typography/display/label-display/fontFamily"],
  fontSize: 14,
  fontWeight: 400,
  lineHeight: "18px",
  color: tokens["color/ink-2"],
});
export const settingsGroup = style({
  overflow: "hidden",
  minWidth: 0,
  background: tokens["color/card"],
  border: 0,
  outline: `1px solid ${tokens["color/card-border"]}`,
  outlineOffset: -1,
  borderRadius: tokens["radius/radius-18"],
});
export const settingRow = style({
  minHeight: 0,
  padding: "9px 16px",
  borderTop: 0,
  boxShadow: `inset 0 1px 0 ${tokens["color/divider"]}`,
  selectors: { "&:first-child": { boxShadow: "none" } },
});
export const settingsCaption = style({
  fontSize: 12,
  lineHeight: "17px",
  color: tokens["color/ink-3"],
});
export const notificationDetails = style({
  display: "inline",
  color: tokens["color/cat-record"],
});
globalStyle(`${notificationDetails} > summary`, { display: "inline", cursor: "pointer" });
globalStyle(`${notificationDetails}[open] > div`, { marginTop: 8, color: tokens["color/ink-2"] });
export const sessionOptions = style({ fontSize: 12.5, color: tokens["color/ink-2"] });
globalStyle(`${sessionOptions} > summary`, { cursor: "pointer", color: tokens["color/cat-record"] });
globalStyle(`${sessionOptions}[open] > div`, { display: "grid", gap: 8, marginTop: 8 });
export const toolbar = style({
  display: "flex",
  justifyContent: "flex-end",
  alignItems: "center",
  gap: tokens["spacing/space-6"],
});
export const layout = style({
  display: "grid",
  gridTemplateColumns: "556px 370px",
  alignItems: "start",
  justifyContent: "end",
  gap: 20,
  width: "100%",
  minHeight: 0,
  selectors: {
    '&[data-expanded="false"]': { gridTemplateColumns: "310px", justifyContent: "end" },
    '&[data-collapsed="true"]': { gridTemplateColumns: "310px" },
  },
  "@media": {
    "(max-width: 760px)": { gridTemplateColumns: "minmax(0, 556px)", justifyContent: "center" },
  },
});
export const timer = style({
  display: "flex",
  flexDirection: "column",
  gap: 10,
  minWidth: 0,
  gridColumn: 2,
  gridRow: 1,
  selectors: {
    '[data-expanded="false"] &': { gridColumn: 1 },
    '[data-collapsed="true"] &': { gridColumn: 1 },
  },
  "@media": { "(max-width: 760px)": { gridColumn: 1, gridRow: 1 } },
});
export const companionRows = style({
  display: "flex",
  flexDirection: "column",
  gap: 10,
  minWidth: 0,
  border: 0,
  padding: 0,
  margin: 0,
});
globalStyle(`${companionRows} > button[aria-expanded]`, {
  boxSizing: "border-box",
  height: 56,
  minHeight: 56,
  flexShrink: 0,
});
export const inlineField = style({
  display: "grid",
  gridTemplateColumns: "auto minmax(0, 1fr)",
  alignItems: "center",
  gap: tokens["spacing/space-8"],
});
export const quiet = style({
  margin: 0,
  color: tokens["color/ink-3"],
  fontSize: 12,
  lineHeight: "16px",
});
export const related = style({
  display: "flex",
  gap: tokens["spacing/space-6"],
  alignItems: "center",
  minHeight: 24,
  color: tokens["color/ink-2"],
  fontSize: tokens["typography/sans/caption/fontSize"],
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
  gap: tokens["spacing/space-8"],
  flexWrap: "wrap",
});
export const context = style({
  gridColumn: 1,
  gridRow: 1,
  minWidth: 0,
  minHeight: 0,
  background: "transparent",
  selectors: {
    '[data-expanded="false"] &': { display: "none" },
    '[data-collapsed="true"] &': { display: "none" },
  },
  "@media": { "(max-width: 760px)": { gridRow: 2 } },
});
export const tabPanel = style({ padding: 0, minWidth: 0 });
export const pane = style({
  display: "flex",
  flexDirection: "column",
  gap: tokens["spacing/space-12"],
  minWidth: 0,
});
export const heading = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: tokens["spacing/space-8"],
});
export const headingText = style({
  fontFamily: `${tokens["typography/display/title/fontFamily"]}, sans-serif`,
  fontSize: tokens["typography/display/title-sm/fontSize"],
  margin: 0,
});
export const week = style({
  display: "grid",
  gridTemplateColumns: "repeat(7, minmax(0,1fr))",
  gap: tokens["spacing/space-4"],
});
export const day = style({
  width: "100%",
  display: "flex",
  flexDirection: "column",
  gap: tokens["spacing/space-4"],
  padding: tokens["spacing/space-6"],
  fontVariantNumeric: "tabular-nums",
  selectors: {
    '&[aria-pressed="true"]': {
      background: tokens["color/primary"],
      boxShadow: `inset 0 -2px ${tokens["color/selected-border"]}`,
    },
  },
});
export const item = style({
  display: "flex",
  alignItems: "center",
  gap: tokens["spacing/space-8"],
  borderBottom: `1px solid ${tokens["color/line"]}`,
  padding: `${tokens["spacing/space-12"]} 0`,
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
export const memoSection = style([pane, { gap: 8 }]);
export const noteSection = style([pane, { gap: 8 }]);
export const noteActions = style([row, { minHeight: 32 }]);
export const noteActionButton = style({ height: 32, minHeight: 32, borderRadius: 16 });
export const noteHeading = style({
  margin: 0,
  fontSize: 13.5,
  lineHeight: "18px",
  fontWeight: 600,
});
export const noteIcon = style({
  display: "grid",
  placeItems: "center",
  width: 32,
  height: 32,
  flexShrink: 0,
  borderRadius: tokens["radius/radius-10"],
  background: tokens["color/icon-tile"],
});
export const focusMemoInput = style({
  width: "100%",
  marginTop: 0,
  height: 72,
  minHeight: 72,
  padding: "6px 9px",
  fontSize: 13,
  lineHeight: "19px",
  resize: "vertical",
});
export const currentFocus = style({
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "10px 14px",
  minWidth: 0,
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: tokens["radius/radius-14"],
  background: tokens["color/card"],
  color: tokens["color/ink-2"],
  fontSize: 13,
  lineHeight: "18px",
});
export const currentFocusDot = style({
  width: 8,
  height: 8,
  flexShrink: 0,
  borderRadius: 4,
  background: tokens["color/document-glass-probe"],
});
export const currentFocusTime = style({
  fontFamily: tokens["typography/display/title-sm/fontFamily"],
  fontSize: 15,
  color: tokens["color/ink"],
});
export const itemTitle = style({
  display: "block",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});
export const caption = style({
  display: "block",
  color: tokens["color/ink-2"],
  fontSize: tokens["typography/sans/caption/fontSize"],
  marginTop: tokens["spacing/space-4"],
});
export const timeline = style({
  position: "relative",
  marginLeft: 36,
  borderTop: `1px solid ${tokens["color/line"]}`,
});
export const hour = style({
  position: "absolute",
  left: 0,
  right: 0,
  height: 1,
  background: tokens["color/line"],
});
export const hourLabel = style({
  position: "absolute",
  right: "calc(100% + 8px)",
  top: -8,
  width: 36,
  whiteSpace: "nowrap",
  textAlign: "right",
  color: tokens["color/ink-2"],
  fontSize: 10,
  fontFamily: '"IBM Plex Mono", monospace',
});
export const timeBlock = style({
  position: "absolute",
  border: 0,
  borderLeft: `2px solid ${tokens["color/input-border"]}`,
  background: tokens["color/card-2"],
  borderRadius: tokens["radius/radius-9"],
  overflow: "hidden",
  textAlign: "left",
  fontSize: 11,
  padding: "4px 6px",
  color: tokens["color/ink"],
  cursor: "pointer",
  selectors: {
    "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 2 },
  },
});
export const actualBlock = style([
  timeBlock,
  {
    background: tokens["color/primary"],
    borderLeftColor: tokens["color/primary"],
    color: tokens["color/primary"],
  },
]);
export const form = style({
  display: "flex",
  flexDirection: "column",
  gap: tokens["spacing/space-12"],
  padding: tokens["spacing/space-12"],
  background: tokens["color/card-2"],
  borderRadius: tokens["radius/radius-12"],
});
export const fields = style({
  display: "grid",
  gridTemplateColumns: "repeat(2,minmax(0,1fr))",
  gap: tokens["spacing/space-8"],
});
export const textArea = style({
  width: "100%",
  minHeight: 155,
  resize: "vertical",
  selectors: { [`${root} ${context} &`]: { padding: tokens["spacing/space-12"] } },
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
  color: tokens["color/ink-2"],
  cursor: "pointer",
  selectors: {
    "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 2 },
    '&[aria-pressed="true"]': { color: tokens["color/ink"] },
  },
});
export const total = style({
  fontFamily: '"IBM Plex Mono", monospace',
  fontSize: 30,
  fontVariantNumeric: "tabular-nums",
});
export const detailTime = style([total, { margin: `${tokens["spacing/space-16"]} 0 ${tokens["spacing/space-6"]}` }]);
export const prose = style({
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  lineHeight: "1.462",
  fontSize: tokens["typography/sans/body/fontSize"],
});
export const empty = style([quiet, { padding: `${tokens["spacing/space-16"]} 0` }]);
export const error = style({ color: tokens["color/danger"], fontSize: tokens["typography/sans/caption/fontSize"] });
export const notice = style({
  background: tokens["color/primary"],
  borderRadius: tokens["radius/radius-12"],
  padding: tokens["spacing/space-12"],
  fontSize: tokens["typography/sans/caption/fontSize"],
});
export const meta = style({
  display: "grid",
  gridTemplateColumns: "60px minmax(0,1fr)",
  gap: tokens["spacing/space-8"],
  margin: `${tokens["spacing/space-12"]} 0`,
});
globalStyle(`${meta} dt`, { color: tokens["color/ink-2"] });
globalStyle(`${meta} dd`, { margin: 0, overflowWrap: "anywhere" });
globalStyle(`${root} input, ${root} select, ${root} textarea`, { minWidth: 0 });
globalStyle(`${timer} p, ${timer} h1`, { margin: 0 });

export const recordsPanel = style({
  position: "relative",
  width: "100%",
  maxWidth: 556,
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "column",
  gap: 16,
  padding: "18px 20px 20px",
  border: 0,
  outline: `1px solid ${tokens["color/glass-border"]}`,
  outlineOffset: -1,
  borderRadius: 24,
  color: tokens["color/ink"],
  background: tokens["color/glass-panel"],
  boxShadow: `0 22px 48px ${tokens["color/surface-shadow"]}, inset 0 1px rgba(255,255,255,.1)`,
  backdropFilter: "blur(12px)",
});
export const panelTail = style({
  position: "absolute",
  right: -8,
  top: 408,
  width: 14,
  height: 14,
  pointerEvents: "none",
});
export const panelHeader = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  minHeight: 36,
});
export const panelTools = style({ display: "flex", alignItems: "center", gap: 8, minWidth: 0 });
export const timerCard = style({
  display: "flex",
  flexDirection: "column",
  alignItems: "stretch",
  gap: 12,
  width: 310,
  maxWidth: "100%",
  minWidth: 0,
  boxSizing: "border-box",
  padding: "16px 18px",
  position: "relative",
  border: 0,
  outline: `1px solid ${tokens["color/glass-border"]}`,
  outlineOffset: -1,
  borderRadius: 26,
  background: tokens["color/glass-panel"],
  backdropFilter: "blur(12px)",
  boxShadow: `0 22px 48px ${tokens["color/surface-shadow"]}, inset 0 1px rgba(255,255,255,.1)`,
  selectors: { '&[data-wide="true"]': { width: 370, padding: "18px 20px" } },
});
export const compactTimer = style({
  width: 310,
  height: 56,
  minHeight: 56,
  padding: "0 16px",
  gap: 12,
  borderRadius: 20,
});
export const cardHeader = style({
  display: "flex",
  alignItems: "center",
  gap: 8,
  minHeight: 30,
  width: "100%",
});
export const headerTimerIcon = style({ flexShrink: 0, color: tokens["color/cat-record"] });
export const cardTitle = style({
  margin: 0,
  flex: 1,
  minWidth: 0,
  fontFamily: tokens["typography/display/title/fontFamily"],
  fontWeight: 400,
  fontSize: 14,
  lineHeight: "19px",
  color: tokens["color/ink-2"],
});
export const collapseButton = style({
  height: 30,
  minHeight: 30,
  padding: "0 10px",
  gap: 4,
  borderRadius: 14,
  fontSize: 12,
  lineHeight: "16px",
  color: tokens["color/ink-2"],
  background: tokens["color/chip"],
  border: `1px solid ${tokens["color/chip-border"]}`,
});
export const timerSetup = style({
  display: "flex",
  flexDirection: "column",
  gap: 6,
  width: "100%",
});
export const timerLabel = style({ fontSize: 12, lineHeight: "16px", color: tokens["color/ink-3"] });
export const restLabel = style([timerLabel, { color: tokens["color/cat-rest"], fontWeight: 600 }]);
export const taskCopy = style({ display: "flex", flexDirection: "column", gap: 2 });
export const taskTitle = style({
  fontFamily: tokens["typography/display/title/fontFamily"],
  fontSize: 19,
  lineHeight: "24px",
  overflowWrap: "anywhere",
});
export const dial = style({
  position: "relative",
  alignSelf: "center",
  width: 168,
  height: 168,
  flexShrink: 0,
  selectors: {
    '&[data-size="wide"]': { width: 188, height: 188 },
    '&[data-size="preview"]': { width: 196, height: 196 },
    '&[data-presentation="digits"]': { height: 90 },
  },
});
export const dialSvg = style({ position: "absolute", inset: 0, overflow: "visible" });
export const dialTrack = style({ stroke: tokens["color/track"] });
export const dialArc = style({
  stroke: tokens["color/cat-exercise"],
  selectors: { '[data-rest="true"] &': { stroke: tokens["color/cat-rest"] } },
});
export const dialGlow = style({ fill: tokens["color/comet"], opacity: 0.2 });
export const dialPoint = style({ fill: tokens["color/comet"] });
export const dialCopy = style({
  position: "absolute",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  gap: 2,
  alignItems: "center",
  justifyContent: "center",
});
export const dialTime = style({
  fontFamily: tokens["typography/display/timer/fontFamily"],
  fontSize: 38,
  lineHeight: "42px",
  whiteSpace: "nowrap",
  fontVariantNumeric: "tabular-nums",
  selectors: {
    '[data-size="wide"] &': { fontSize: 44, lineHeight: "48px" },
    '[data-size="preview"] &': { fontSize: 42, lineHeight: "46px" },
  },
});
export const dialDescription = style({
  fontSize: 12.5,
  lineHeight: "17px",
  color: tokens["color/ink-2"],
});
export const durationChoices = style({ alignSelf: "center" });
export const primaryAction = style({
  minHeight: 38,
  height: 38,
  borderRadius: 19,
  padding: "0 24px",
  fontSize: 14,
  lineHeight: "21px",
});
export const stopAction = style({
  minHeight: 40,
  height: 40,
  padding: "0 16px",
  borderRadius: 19,
  fontSize: 13.5,
  lineHeight: "20px",
});
export const linkAction = style({
  flex: 1,
  minWidth: 0,
  minHeight: 34,
  height: 34,
  borderRadius: 17,
  padding: "0 12px",
  fontSize: 13,
  lineHeight: "18px",
  justifyContent: "space-between",
});
export const timerActions = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  width: "100%",
});
export const setupCaption = style([quiet, { textAlign: "center" }]);
export const completeSymbol = style({
  width: 88,
  height: 88,
  alignSelf: "center",
  display: "grid",
  placeItems: "center",
  boxSizing: "border-box",
  border: `7px solid ${tokens["color/focus-ring"]}`,
  borderRadius: "50%",
  color: tokens["color/focus-ring"],
  boxShadow: `0 0 26px ${tokens["color/component/focus-ring-alpha-500"]}`,
  selectors: {
    '&[data-rest-complete="true"]': {
      borderColor: tokens["color/cat-record"],
      color: tokens["color/cat-record"],
    },
  },
});
export const completionCopy = style({
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  textAlign: "center",
  gap: 3,
});
export const completionTitle = style({
  fontFamily: tokens["typography/display/title/fontFamily"],
  fontSize: 18,
  lineHeight: "23px",
});
export const todoCompletion = style({
  padding: "10px 12px",
  borderRadius: 14,
  border: `1px solid ${tokens["color/card-border"]}`,
  background: tokens["color/card"],
  fontSize: 13,
  lineHeight: "18px",
});
export const restSummary = style({
  width: "100%",
  padding: "9px 12px",
  gap: 10,
  minHeight: 37,
  borderRadius: 14,
  fontSize: 12.5,
  lineHeight: "17px",
  background: tokens["color/component/cat-rest-alpha-100"],
  border: `1px solid ${tokens["color/component/cat-rest-alpha-333"]}`,
});
export const todaySummary = style({
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "12px 14px",
  borderRadius: 14,
  border: `1px solid ${tokens["color/card-border"]}`,
  background: tokens["color/card"],
  fontSize: 12.5,
  lineHeight: "17px",
  color: tokens["color/ink-2"],
});
export const todaySummaryValue = style({
  fontFamily: tokens["typography/display/title/fontFamily"],
  fontSize: 16,
  lineHeight: "21px",
  color: tokens["color/ink"],
});
export const timerFooter = style({
  display: "flex",
  flexDirection: "column",
  gap: 10,
  paddingTop: 12,
  boxShadow: `inset 0 1px ${tokens["color/divider"]}`,
});
export const timerFooterText = style({
  display: "flex",
  alignItems: "flex-start",
  gap: 8,
  margin: 0,
  fontSize: 12.5,
  lineHeight: "17px",
  color: tokens["color/ink-2"],
});
export const footerButton = style({
  flex: 1,
  minWidth: 0,
  minHeight: 32,
  height: 32,
  borderRadius: 16,
  padding: "0 12px",
  fontSize: 13,
  lineHeight: "18px",
});
export const linkedChip = style({
  display: "flex",
  alignItems: "center",
  alignSelf: "flex-start",
  gap: 6,
  maxWidth: "100%",
  minHeight: 26,
  padding: "0 3px 0 10px",
  boxSizing: "border-box",
  background: tokens["color/component/selected-icon-alpha-140"],
  border: `1px solid ${tokens["color/selected-border"]}`,
  borderRadius: 13,
  fontSize: 12,
  lineHeight: "16px",
  color: tokens["color/comet"],
});
export const settingsPreview = style({
  display: "flex",
  flexDirection: "column",
  alignItems: "stretch",
  gap: 14,
  width: "100%",
  boxSizing: "border-box",
  padding: "18px 20px 20px",
  border: 0,
  outline: `1px solid ${tokens["color/chip-border"]}`,
  outlineOffset: -1,
  borderRadius: 24,
  background: `radial-gradient(ellipse at 50% 0%, ${tokens["color/preview-glow"]}, ${tokens["color/preview-glow-transparent"]} 70%), ${tokens["color/preview-panel"]}`,
});
export const previewHeader = style({
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
});
export const previewIcon = style({
  display: "grid",
  placeItems: "center",
  width: 36,
  height: 36,
  flexShrink: 0,
  borderRadius: 18,
  background: tokens["color/icon-tile"],
});
export const previewTitle = style({
  margin: 0,
  flex: 1,
  fontFamily: tokens["typography/display/title/fontFamily"],
  fontWeight: 400,
  fontSize: 22,
  lineHeight: "28px",
});
export const previewShape = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  fontSize: 13.5,
  lineHeight: "20px",
});
export const previewCaption = style({
  margin: 0,
  fontSize: 12.5,
  lineHeight: "18px",
  color: tokens["color/ink-2"],
});
export const periodSummary = style({ display: "flex", flexDirection: "column", gap: 4 });
export const periodLabel = style({
  color: tokens["color/ink-2"],
  fontSize: 12,
  lineHeight: "16px",
});
export const periodSummaryRow = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
});
export const periodTotal = style({
  display: "flex",
  alignItems: "baseline",
  gap: 10,
  flexWrap: "wrap",
});
export const periodTotalValue = style({
  fontFamily: tokens["typography/display/title/fontFamily"],
  fontSize: 30,
  lineHeight: "38px",
});
export const periodCount = style({
  fontSize: 12.5,
  lineHeight: "17px",
  color: tokens["color/ink-2"],
});
export const recordsChart = style({
  display: "flex",
  alignItems: "stretch",
  justifyContent: "space-between",
  gap: 8,
  height: 176,
  selectors: { '&[data-dense="true"]': { gap: 2 } },
});
export const recordsChartBar = style({
  flex: "1 1 0",
  minWidth: 0,
  width: "auto",
  maxWidth: 70,
  height: 176,
});
export const recordsHelp = style({
  margin: 0,
  color: tokens["color/ink-3"],
  fontSize: 12.5,
  lineHeight: "17px",
});
export const timelineLink = style({
  display: "inline",
  border: 0,
  padding: 0,
  background: "transparent",
  font: "inherit",
  color: tokens["color/cat-record"],
  cursor: "pointer",
  selectors: {
    "&:disabled": { opacity: 0.6, cursor: "default" },
    "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}` },
  },
});
export const recordsSection = style({ display: "flex", flexDirection: "column", gap: 8 });
export const recordsList = style({
  overflow: "hidden",
  border: 0,
  outline: `1px solid ${tokens["color/card-border"]}`,
  outlineOffset: -1,
  borderRadius: 16,
  background: tokens["color/card"],
});
export const focusRecordRow = style({
  cursor: "pointer",
  fontSize: 13,
  lineHeight: "18px",
  selectors: {
    "&:last-child": { borderBottom: 0 },
    "&:focus-visible": { outline: `2px solid ${tokens["color/cat-record"]}`, outlineOffset: -2 },
  },
});
export const recordDuration = style({
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-end",
  fontSize: 15,
  lineHeight: "20px",
});
export const recordUsage = style({
  fontFamily: tokens["typography/sans/body/fontFamily"],
  fontSize: 11.5,
  lineHeight: "15px",
  color: tokens["color/focus-ring"],
});
export const recordScope = style({
  display: "block",
  fontSize: 11.5,
  lineHeight: "15px",
  color: tokens["color/ink-3"],
});
globalStyle(`${memoSection} > span`, { width: "100%", minWidth: 0 });
globalStyle(`${timerSetup} > span`, { width: "100%", minWidth: 0 });
globalStyle(`${timerSetup} > span > input`, { width: "100%" });
export const usageHost = style({ minWidth: 0, width: "100%" });
export const usageCard = style({
  display: "flex",
  flexDirection: "column",
  gap: 2,
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 12px",
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: 14,
  background: tokens["color/card"],
});
export const usageHeading = style({
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  minHeight: 15,
  fontSize: 11.5,
  lineHeight: "15px",
  color: tokens["color/ink-3"],
});
export const usageChoose = style({
  height: 26,
  minHeight: 26,
  borderRadius: 13,
  padding: "0 10px",
  fontSize: 12,
  lineHeight: "16px",
});
export const usageHelpButton = style({
  display: "grid",
  placeItems: "center",
  padding: 0,
  border: 0,
  background: "transparent",
  color: tokens["color/ink-3"],
  cursor: "pointer",
});
export const usageStatus = style({
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 13,
  lineHeight: "18px",
});
export const usageDot = style({
  flexShrink: 0,
  width: 7,
  height: 7,
  borderRadius: "50%",
  background: tokens["color/ink-3"],
  selectors: {
    '&[data-active="true"]': {
      background: tokens["color/focus-ring"],
      boxShadow: `0 0 10px ${tokens["color/component/focus-ring-alpha-500"]}`,
    },
  },
});
export const usageDescription = style({
  margin: 0,
  fontSize: 12,
  lineHeight: "17px",
  color: tokens["color/ink-2"],
});
export const usagePicker = style({
  display: "flex",
  flexDirection: "column",
  gap: 10,
  width: "100%",
  minWidth: 0,
});
export const usagePickerBody = style({
  display: "flex",
  flexDirection: "column",
  gap: 10,
  minWidth: 0,
});
export const programChoices = style({ width: "100%" });
export const usageRules = style({ fontSize: 12, lineHeight: "17px", color: tokens["color/ink-3"] });
globalStyle(`${usageRules} > summary`, { cursor: "pointer" });
export const usageRulesBody = style({ display: "grid", gap: 3, marginTop: 10 });
globalStyle(`${usageRulesBody} p`, { margin: "0 0 7px" });
export const countedLabel = style({ color: tokens["color/focus-ring"], fontSize: 12.5 });
export const excludedLabel = style({ color: tokens["color/comet"], fontSize: 12.5 });
export const privateLabel = style({ color: tokens["color/cat-life"], fontSize: 12.5 });
export const controlFields = style({
  display: "contents",
  padding: 0,
  margin: 0,
  border: 0,
  minWidth: 0,
});
globalStyle(`${layout}[data-embedded="true"][data-expanded="false"]`, {
  gridTemplateColumns: "minmax(0, 370px)",
});
export const compactTimerHost = style({
  position: "relative",
  width: 310,
  maxWidth: "100%",
  height: 56,
  gridColumn: 1,
});
export const compactClose = style({ position: "absolute", right: 6, top: 12 });
globalStyle(`${compactTimerHost}[data-closable="true"] > button:first-child`, { paddingRight: 42 });
globalStyle(`${compactTimer} > span:nth-child(2) > span:first-child`, {
  fontSize: 14,
  lineHeight: "19px",
});
globalStyle(`${compactTimer} > span:nth-child(2) > span:last-child`, {
  fontSize: 11.5,
  lineHeight: "15px",
});
globalStyle(`${timerCard} > span`, { width: "100%", minWidth: 0 });
globalStyle(`${timerCard} > span > input`, { width: "100%" });
globalStyle(`${timerCard} > ${controlFields} > span`, { width: "100%", minWidth: 0 });
globalStyle(`${timerCard} > ${controlFields} > span > input`, { width: "100%" });
