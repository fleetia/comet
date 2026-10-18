import { createVar, style, styleVariants } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const accent = createVar();
export const fill = createVar();
export const extent = createVar();
export const base = style({
  boxSizing: "border-box",
  fontFamily: `${tokens["typography/sans/body/fontFamily"]}, sans-serif`,
  color: tokens["color/ink"],
  fontSize: 13,
  lineHeight: "18px",
});
export const card = style([
  base,
  {
    padding: "15px 18px",
    background: tokens["color/card-2"],
    border: `1px solid ${tokens["color/card-border"]}`,
    borderRadius: 20,
  },
]);
export const row = style({ display: "flex", alignItems: "center", gap: 12, minWidth: 0 });
export const stack = style({ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 });
export const grow = style({ flex: 1, minWidth: 0 });
export const title = style({ margin: 0, fontSize: 14, fontWeight: 600, lineHeight: "19px" });
export const secondary = style({ color: tokens["color/ink-2"], fontSize: 12, lineHeight: "16px" });
export const muted = style({ color: tokens["color/ink-3"], fontSize: 11.5, lineHeight: "15px" });
export const display = style({
  fontFamily: `${tokens["typography/display/title-sm/fontFamily"]}, sans-serif`,
  fontSize: 30,
  lineHeight: "42px",
  fontWeight: 400,
  fontVariantNumeric: "tabular-nums",
});
export const dot = style({
  width: 8,
  height: 8,
  flexShrink: 0,
  borderRadius: "50%",
  background: accent,
});
export const resetButton = style({
  appearance: "none",
  font: "inherit",
  color: "inherit",
  border: 0,
  padding: 0,
  background: "transparent",
  cursor: "pointer",
  selectors: {
    "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 2 },
    "&:disabled": { opacity: 0.45, cursor: "not-allowed" },
  },
});
export const link = style([resetButton, { color: tokens["color/selected-icon"], fontSize: 12 }]);
export const track = style({
  height: 6,
  overflow: "hidden",
  borderRadius: 4,
  background: tokens["color/track"],
});
export const progress = style({
  display: "block",
  height: "100%",
  width: extent,
  background: accent,
  borderRadius: "inherit",
});
export const summary = style([card, { width: 340, maxWidth: "100%" }]);
export const summaryHeader = style([row, { justifyContent: "space-between", marginBottom: 12 }]);
export const metricRow = style([row, { gap: 8, marginTop: 7 }]);
export const metricLabel = style({ width: 54, flexShrink: 0 });
export const metricValue = style([
  secondary,
  { minWidth: 78, textAlign: "right", fontVariantNumeric: "tabular-nums" },
]);
export const taskList = style({
  margin: 0,
  padding: 0,
  listStyle: "none",
  display: "grid",
  gap: 9,
});
export const taskLabel = style([row, { gap: 8 }]);

export const habitDay = style([
  resetButton,
  base,
  {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: 28,
    height: 28,
    padding: 0,
    borderRadius: 14,
    fontWeight: 600,
    fontSize: 12,
    lineHeight: "18px",
    color: accent,
  },
]);
export const habitStates = styleVariants({
  done: { background: accent, color: tokens["color/check-ink"] },
  missed: { background: tokens["color/chip"], color: tokens["color/ink-3"] },
  unrecorded: { border: `1.5px dashed ${tokens["color/ink-3"]}` },
  counting: { border: `1.5px solid ${accent}` },
  goalMet: { background: accent, color: tokens["color/check-ink"] },
});
export const habitRow = style([
  base,
  {
    display: "grid",
    gridTemplateColumns: "minmax(150px, 1fr) auto 96px",
    alignItems: "center",
    gap: 0,
    minHeight: 54,
    padding: "6px 16px",
    borderBottom: `1px solid ${tokens["color/divider"]}`,
  },
]);
export const habitSelected = style({ background: tokens["color/selected"] });
export const habitDays = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-around",
  gap: 16,
  padding: "0 8px",
});
export const habitToday = style({
  padding: 8,
  margin: -8,
  background: tokens["color/component/selected-icon-alpha-60"],
});
export const habitSummary = style({ textAlign: "right" });
export const habitTable = style([
  card,
  {
    padding: 0,
    width: "100%",
    maxWidth: "100%",
    overflowX: "auto",
    borderRadius: tokens["radius/radius-20"],
    background: tokens["color/card-2"],
  },
]);
export const habitTableInner = style({
  width: "max-content",
  minWidth: "max(740px, 100%)",
});
export const tableHeader = style([
  habitRow,
  { color: tokens["color/ink-3"], borderBottom: `1px solid ${tokens["color/divider"]}` },
]);
export const tableDay = style([stack, { width: 28, textAlign: "center", gap: 1 }]);
export const tableFooter = style([
  row,
  {
    justifyContent: "space-between",
    padding: "10px 18px",
    borderTop: `1px solid ${tokens["color/divider"]}`,
  },
]);

export const habitMonth = style([
  card,
  { width: "100%", padding: 12, gap: 8, borderRadius: tokens["radius/radius-18"] },
]);
export const habitMonthLabel = style({ fontSize: 12, fontWeight: 600, lineHeight: "16px" });
export const habitMonthGrid = style({
  display: "grid",
  gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
  rowGap: 4,
  justifyItems: "center",
});
export const habitMonthWeekday = style([muted, { fontSize: 10, lineHeight: "14px" }]);
export const habitMonthDay = style([
  habitDay,
  {
    fontSize: 11,
    fontWeight: 400,
    color: tokens["color/ink-3"],
    selectors: {
      '&[data-state="done"], &[data-state="goalMet"]': { color: tokens["color/check-ink"] },
      '&[aria-current="date"]': {
        outline: `1px dashed ${tokens["color/cat-record"]}`,
        outlineOffset: -1,
      },
      '&[aria-pressed="true"]': { boxShadow: `0 0 0 1px ${tokens["color/selected-icon"]}` },
    },
  },
]);

export const dayNumber = style([
  base,
  {
    color: "inherit",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "auto",
    height: 24,
    borderRadius: "50%",
    fontSize: 13,
    whiteSpace: "nowrap",
    fontFamily: `${tokens["typography/display/title-sm/fontFamily"]}, sans-serif`,
  },
]);
export const todayNumber = style({
  width: 24,
  color: tokens["color/check-ink"],
  background: tokens["color/cat-record"],
});
export const dayHeader = style([
  base,
  {
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 34,
    borderRadius: 12,
    fontSize: 12,
  },
]);
export const todayHeader = style({ background: tokens["color/component/selected-icon-alpha-140"] });
export const holiday = style({ color: tokens["color/danger"] });
export const otherMonth = style({ color: tokens["color/ink-3"], opacity: 0.6 });
export const timedEvent = style([
  resetButton,
  base,
  {
    display: "flex",
    alignItems: "center",
    gap: 5,
    width: "100%",
    textAlign: "left",
    minHeight: 22,
    padding: "2px 5px",
    border: "1px solid transparent",
    borderRadius: 7,
    fontSize: 11.5,
    lineHeight: "15px",
  },
]);
export const timedSelected = style({
  background: tokens["color/component/selected-icon-alpha-140"],
  borderColor: tokens["color/selected-border"],
});
export const eventDot = style([dot, { width: 6, height: 6 }]);
export const ellipsis = style({
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});
export const dayCell = style([base, { minWidth: 0, minHeight: 111, padding: 6 }]);
export const cellHeader = style([
  row,
  { gap: 4, justifyContent: "space-between", marginBottom: 2 },
]);
export const dateButton = style([resetButton, { textAlign: "left", paddingLeft: 4 }]);
export const overflowLink = style([resetButton, muted, { padding: "1px 5px" }]);
export const timeBlock = style([
  resetButton,
  base,
  {
    width: "100%",
    minHeight: 24,
    borderRadius: 6,
    padding: "4px 5px",
    textAlign: "left",
    display: "flex",
    alignItems: "center",
    gap: 3,
    background: accent,
    color: tokens["color/component/calendar-block-ink"],
    fontSize: 11,
    fontWeight: 600,
    lineHeight: "14px",
    overflow: "hidden",
  },
]);
export const timeStates = styleVariants({
  past: { opacity: 0.92 },
  planned: {
    background: fill,
    color: tokens["color/ink"],
    border: `1px dashed ${accent}`,
    minHeight: 50,
  },
  cometEvent: { background: tokens["color/component/calendar-block-life"] },
  activeFocus: { background: tokens["color/component/calendar-block-focus"], opacity: 0.7 },
  selectedRange: {
    minHeight: 54,
    background: tokens["color/selected"],
    border: `2px dashed ${tokens["color/selected-icon"]}`,
    borderRadius: 8,
  },
});
export const periodProgress = style([
  base,
  {
    display: "inline-flex",
    alignItems: "center",
    minHeight: 22,
    fontSize: 11.5,
    color: tokens["color/cat-record"],
    border: `1px solid ${tokens["color/chip-border"]}`,
    borderRadius: 11,
    padding: "0 8px",
    background: tokens["color/chip"],
  },
]);
export const month = style([
  card,
  { padding: 0, width: 1178, maxWidth: "100%", overflowX: "auto" },
]);
export const monthGrid = style({
  display: "grid",
  gridTemplateColumns: "repeat(7, minmax(110px, 1fr))",
  minWidth: 770,
});
export const monthWeekday = style([
  muted,
  { padding: "6px 9px", borderBottom: `1px solid ${tokens["color/divider"]}` },
]);
export const monthCell = style({
  borderRight: `1px solid ${tokens["color/divider"]}`,
  borderBottom: `1px solid ${tokens["color/divider"]}`,
});
export const week = style([base, { width: 1148, maxWidth: "100%", overflowX: "auto" }]);
export const weekInner = style({ minWidth: 840 });
export const weekHeader = style({
  display: "grid",
  gridTemplateColumns: "24px repeat(7, minmax(0, 1fr))",
  gap: 6,
  marginBottom: 8,
});
export const weekBody = style({
  position: "relative",
  display: "grid",
  gridTemplateColumns: "24px repeat(7, minmax(0, 1fr))",
  gridTemplateRows: "repeat(24, 25px)",
  gap: 1,
  selectors: { '&[data-editable="true"]': { touchAction: "none", userSelect: "none" } },
});
export const hourLabel = style([
  muted,
  { textAlign: "right", paddingRight: 4, fontSize: 10, alignSelf: "start" },
]);
export const hourSlots = style({
  display: "grid",
  gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
  gap: 2,
  padding: "1px 3px",
});
export const hourSlot = style([
  resetButton,
  {
    borderRadius: 4,
    background: tokens["color/card"],
    minWidth: 0,
    selectors: {
      "&:hover": { background: tokens["color/hover"] },
      '&[aria-pressed="true"]': {
        background: tokens["color/selected"],
        outline: `1px solid ${tokens["color/selected-icon"]}`,
      },
      "&:focus-visible": {
        position: "relative",
        zIndex: 2,
        outline: `2px solid ${tokens["color/focus-ring"]}`,
        outlineOffset: 1,
      },
    },
  },
]);
export const weekEvent = style({
  boxSizing: "border-box",
  justifySelf: "start",
  minWidth: 0,
  padding: "1px 3px",
  zIndex: 1,
  pointerEvents: "none",
});
export const weekEventBlock = style({ height: "100%", minHeight: 0, pointerEvents: "auto" });
export const ring = style([
  card,
  {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 10,
    width: 632,
    maxWidth: "100%",
    padding: "16px 20px",
    borderRadius: tokens["radius/radius-22"],
  },
]);
export const ringFill = style({ width: "100%" });
export const ringToolbar = style([row, { width: "100%", gap: 8, flexWrap: "wrap", fontSize: 12 }]);
export const ringHint = style([muted, { marginLeft: "auto" }]);
export const ringCanvas = style({
  position: "relative",
  width: "100%",
  maxWidth: 792,
  marginBlock: "auto",
});
export const ringSvg = style({
  display: "block",
  width: "100%",
  maxWidth: 792,
  height: "auto",
  flexShrink: 0,
  aspectRatio: "792 / 642",
  overflow: "visible",
  selectors: {
    '&[data-editable="true"]': { touchAction: "none", cursor: "crosshair" },
    "&:focus-visible": {
      outline: `2px solid ${tokens["color/focus-ring"]}`,
      outlineOffset: 4,
      borderRadius: "50%",
    },
  },
});
export const ringSelection = style({
  fill: `color-mix(in srgb, ${tokens["color/comet"]} 20%, transparent)`,
  stroke: tokens["color/comet"],
  strokeWidth: 2,
  strokeDasharray: "4 3",
});
export const ringOverlay = style({
  position: "absolute",
  inset: 0,
  display: "grid",
  placeItems: "center",
  pointerEvents: "none",
});
export const ringInstructions = style({
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  overflow: "hidden",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
});
export const ringSegment = style({
  fill: fill,
  stroke: tokens["color/card-2"],
  strokeWidth: 0.8,
  selectors: {
    '&[role="button"]': { cursor: "pointer" },
    '&[data-kind="event"]': { fill: "transparent", stroke: fill, strokeWidth: 1.2 },
    '&[data-kind="planned"]': { fill: "transparent", stroke: fill, strokeDasharray: "3 2" },
    "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}` },
  },
});
export const ringCenter = style({
  fill: tokens["color/ink"],
  fontSize: 34,
  fontFamily: `${tokens["typography/display/title-sm/fontFamily"]}, sans-serif`,
});
export const ringCenterLabel = style({ fill: tokens["color/ink-2"], fontSize: 12.5 });
export const ringCaption = style({ fill: tokens["color/ink-3"], fontSize: 11.5 });
export const ringLabel = style({
  fill: tokens["color/ink-3"],
  fontSize: 12,
  fontFamily: `${tokens["typography/display/title-sm/fontFamily"]}, sans-serif`,
});
export const ringAnnotation = style({ pointerEvents: "none" });
export const ringConnector = style({ stroke: tokens["color/card-border"], strokeWidth: 1 });
export const ringSegmentLabel = style({ fill: tokens["color/ink"], fontSize: 12.5 });
export const ringSegmentDetail = style({ fill: tokens["color/ink-3"], fontSize: 11 });
export const ringNow = style({ pointerEvents: "none" });
export const ringNowHalo = style({ fill: tokens["color/comet"], opacity: 0.2 });
export const ringNowDot = style({
  fill: tokens["color/comet"],
  stroke: tokens["color/document/backdrop-panel/sky"],
  strokeWidth: 2,
});
export const ringNowLabel = style({ fill: tokens["color/comet"], fontSize: 12.5 });
export const ringLegend = style([
  row,
  secondary,
  { width: "100%", justifyContent: "center", flexWrap: "wrap", gap: 18 },
]);
export const ringLegendItem = style([row, { gap: 6 }]);
export const ringLegendMark = style({
  boxSizing: "border-box",
  width: 14,
  height: 8,
  borderRadius: 2,
  background: tokens["color/cat-work"],
  selectors: {
    '&[data-kind="event"]': {
      background: "transparent",
      border: `1.2px solid ${tokens["color/event-google"]}`,
    },
    '&[data-kind="focus"]': {
      background: tokens["color/cat-exercise"],
      height: 2.4,
      borderRadius: 0,
    },
    '&[data-kind="planned"]': {
      background: "transparent",
      border: `1.2px dashed ${tokens["color/ink-3"]}`,
    },
  },
});

export const ledgerTile = style({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 32,
  height: 32,
  flexShrink: 0,
  borderRadius: 10,
  background: fill,
  color: accent,
});
export const ledgerRow = style([
  base,
  row,
  { width: 518, maxWidth: "100%", minHeight: 45, padding: "5px 14px" },
]);
export const ledgerAmount = style({
  marginLeft: "auto",
  textAlign: "right",
  whiteSpace: "nowrap",
  fontVariantNumeric: "tabular-nums",
  fontSize: 13.5,
});
export const ledgerDay = style([
  base,
  row,
  { justifyContent: "space-between", color: tokens["color/ink-3"], fontSize: 12 },
]);
export const quickAdd = style([
  base,
  {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    padding: 8,
    maxWidth: "100%",
    width: 520,
    border: `1px solid ${tokens["color/input-border"]}`,
    borderRadius: 16,
    background: tokens["color/input"],
  },
]);
export const quickAmount = style({ width: 102, flexShrink: 0 });
export const quickCategory = style({ width: 84, flexShrink: 0 });
export const quickMemo = style({ flex: "1 1 140px", minWidth: 100 });
export const forecast = style([card, { width: 320, maxWidth: "100%" }]);
export const forecastLegend = style([row, muted, { gap: 12, marginTop: 8, fontSize: 10 }]);
export const forecastBars = style({
  position: "relative",
  display: "flex",
  alignItems: "end",
  gap: 10,
  height: 126,
  marginTop: 8,
});
export const forecastMonth = style([
  stack,
  {
    flex: "1 1 0",
    alignItems: "center",
    gap: 3,
    height: "100%",
    paddingTop: 21,
    boxSizing: "border-box",
    justifyContent: "end",
    fontSize: 10,
    borderRadius: 3,
    ":focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 2 },
  },
]);
export const forecastTrack = style({
  display: "flex",
  flexDirection: "column-reverse",
  width: "100%",
  height: extent,
  overflow: "hidden",
  borderRadius: "3px 3px 2px 2px",
  background: tokens["color/component/ledger-housing-alpha-450"],
});
export const forecastExtra = style({ height: extent, background: tokens["color/ledger-occasion"] });
export const budgetValue = style([display, { margin: "8px 0" }]);
export const budgetFooter = style([
  row,
  secondary,
  { justifyContent: "space-between", marginTop: 7, fontSize: 11.5 },
]);
export const categoryBar = style({
  display: "flex",
  overflow: "hidden",
  height: 8,
  borderRadius: 4,
  margin: "8px 0",
});
export const categorySegment = style({ width: extent, background: accent });
export const categoryRow = style([row, { gap: 7, marginTop: 7, fontSize: 12 }]);
export const recurringRow = style([ledgerRow, { width: "100%", minHeight: 46, paddingInline: 14 }]);
export const recurringDate = style([stack, secondary, { width: 132, gap: 2 }]);
export const recurring = style([base, { width: 600, maxWidth: "100%" }]);
export const recurringHeader = style([
  row,
  { padding: "0 4px 6px", justifyContent: "space-between" },
]);

export const chartBarItem = style([
  base,
  {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    alignItems: "center",
    justifyContent: "end",
    width: 55,
    minWidth: 44,
    height: 176,
    padding: "6px 3px",
    borderRadius: 12,
  },
]);
export const chartCurrent = style({ background: tokens["color/component/cat-record-alpha-80"] });
export const chartBar = style({
  width: 30,
  height: extent,
  borderRadius: "8px 8px 3px 3px",
  background: tokens["color/cat-focus"],
  opacity: 0.42,
  selectors: { '[data-current="true"] &': { opacity: 1 } },
});
export const chartEmpty = style({ width: 30, height: 2, background: tokens["color/track"] });
export const tripRow = style([
  base,
  row,
  {
    width: 800,
    maxWidth: "100%",
    padding: 16,
    border: `1px solid ${tokens["color/card-border"]}`,
    borderRadius: 12,
    background: tokens["color/card"],
  },
]);
export const tripValue = style({ width: 160, textAlign: "right" });
export const tripButton = style({
  textAlign: "left",
  cursor: "pointer",
  font: "inherit",
  selectors: {
    "&:hover:not(:disabled)": { borderColor: tokens["color/selected-border"] },
    "&:focus-visible": {
      outline: `2px solid ${tokens["color/focus-ring"]}`,
      outlineOffset: 2,
    },
    "&:disabled": { cursor: "default", opacity: 0.6 },
  },
});
export const focusUsage = style([
  card,
  {
    width: 290,
    maxWidth: "100%",
    padding: "10px 12px",
    borderRadius: 14,
    background: tokens["color/card"],
  },
]);
export const focusUsageHeader = style([row, { justifyContent: "space-between", marginBottom: 7 }]);
export const focusUsageChoose = style([
  resetButton,
  secondary,
  {
    border: `1px solid ${tokens["color/card-border"]}`,
    borderRadius: 12,
    padding: "3px 10px",
    fontSize: 11,
  },
]);
export const focusUsageValue = style([row, { gap: 7, marginTop: 4 }]);
export const programRow = style([
  base,
  row,
  {
    minHeight: 34,
    padding: "0 10px",
    gap: 10,
    cursor: "pointer",
    borderBottom: `1px solid ${tokens["color/divider"]}`,
    selectors: {
      "&:has(input:checked)": { background: tokens["color/selected"] },
      "&:has(input:disabled)": { opacity: 0.45, cursor: "not-allowed" },
    },
  },
]);
export const programIcon = style({
  width: 22,
  height: 22,
  borderRadius: 6,
  background: tokens["color/icon-tile"],
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
});
export const programPicker = style([
  base,
  {
    width: 302,
    maxWidth: "100%",
    margin: 0,
    padding: 0,
    border: `1px solid ${tokens["color/card-border"]}`,
    borderRadius: 12,
    background: tokens["color/card"],
    overflow: "hidden",
  },
]);
export const focusRecord = style([
  base,
  row,
  {
    width: "100%",
    padding: "9px 14px",
    minHeight: 56,
    borderBottom: `1px solid ${tokens["color/divider"]}`,
  },
]);
export const focusRecordTime = style([secondary, { width: 128, flexShrink: 0, fontSize: 12.5 }]);
export const focusRecordDuration = style({
  fontFamily: `${tokens["typography/display/title-sm/fontFamily"]}, sans-serif`,
  fontSize: 15,
  whiteSpace: "nowrap",
});
export const focusPanel = style([
  card,
  {
    width: 556,
    maxWidth: "100%",
    padding: 20,
    borderRadius: 24,
    background: `radial-gradient(ellipse at 0% 120%, ${tokens["color/document/backdrop-panel/sky-glow-violet"]}, transparent 62%), radial-gradient(ellipse at 100% -20%, ${tokens["color/document/backdrop-panel/sky-glow-blue"]}, transparent 60%), ${tokens["color/document/backdrop-panel/sky"]}`,
    borderColor: tokens["color/glass-border"],
    boxShadow: `0 22px 48px ${tokens["color/surface-shadow"]}`,
    backdropFilter: "blur(12px)",
  },
]);
export const focusPanelHeader = style([row, { justifyContent: "space-between", marginBottom: 16 }]);
export const focusPanelTools = style([row, { gap: 8 }]);
export const focusPeriod = style([row, { justifyContent: "space-between", marginTop: 14 }]);
export const focusChart = style({
  display: "flex",
  justifyContent: "space-between",
  gap: 8,
  margin: "16px 0",
});
export const focusRecordList = style({
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: 16,
  background: tokens["color/card"],
  overflow: "hidden",
  marginTop: 8,
});
export const notes = style({ width: "100%", marginTop: 12, minHeight: 72, height: 72 });

export const headerNumber = style({ fontSize: 15, width: 26, height: 26 });
export const headerTodayLabel = style([secondary, { color: tokens["color/comet"] }]);
export const completedTask = style({
  textDecoration: "line-through",
  color: tokens["color/ink-3"],
});
export const otherMonthCell = style({ background: tokens["color/component/knob-alpha-16"] });
export const spendingSummary = style([row, { padding: "15px 18px", gap: 12 }]);
export const spendingAmount = style([
  display,
  { fontSize: 21, lineHeight: "26px", whiteSpace: "nowrap" },
]);
export const habitSummaryGrid = style({
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 110px), 1fr))",
  gap: "10px 8px",
  fontSize: 12,
});
export const habitSummaryItem = style([row, { minWidth: 0, alignItems: "start", gap: 6 }]);
export const habitSummaryLabel = style({
  minWidth: 0,
  overflowWrap: "anywhere",
  lineHeight: "18px",
});
export const ringTrack = style({ fill: tokens["color/track"] });
export const ringDivider = style({
  stroke: tokens["color/document/backdrop-panel/sky"],
  strokeWidth: 1,
  pointerEvents: "none",
});
export const ringCategory = style([
  resetButton,
  row,
  {
    gap: 6,
    border: `1px solid ${tokens["color/card-border"]}`,
    borderRadius: 15,
    minHeight: 32,
    padding: "5px 11px",
    fontSize: 13,
    selectors: {
      '&[aria-pressed="true"]': {
        background: `color-mix(in srgb, ${accent} 20%, transparent)`,
        borderColor: accent,
      },
    },
  },
]);
export const chartCurrentLabel = style([
  secondary,
  { fontWeight: 600, color: tokens["color/comet"] },
]);
export const chartValue = style({ whiteSpace: "nowrap", fontSize: 11.5 });
export const chartCurrentValue = style({ color: tokens["color/ink"], fontWeight: 600 });
export const tripTitle = style({ fontSize: 14, fontWeight: 600 });
export const forecastMonthLabel = style({ whiteSpace: "nowrap" });
export const forecastValues = style({
  position: "absolute",
  inset: "0 0 auto",
  display: "flex",
  justifyContent: "space-between",
  minHeight: 18,
  fontSize: 9,
  pointerEvents: "none",
});
export const forecastValue = style({
  maxWidth: "45%",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
});
export const forecastActiveValue = style({
  width: "100%",
  textAlign: "center",
  overflowWrap: "anywhere",
});
export const budgetTitle = style([muted, { margin: 0, fontWeight: 400 }]);
export const budgetDetail = style([muted, { margin: "10px 0 0" }]);
export const categoryPercent = style([muted, { width: 36, textAlign: "right" }]);
export const recurringList = style({
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: 20,
  background: tokens["color/card"],
  overflow: "hidden",
});
export const usageDot = style({
  width: 8,
  height: 8,
  borderRadius: "50%",
  background: tokens["color/focus-ring"],
  boxShadow: `0 0 12px ${tokens["color/component/focus-ring-alpha-500"]}`,
});
export const usageIdle = style({ background: tokens["color/ink-3"], boxShadow: "none" });
export const visuallyHidden = style({
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
});

export const forecastRecurringLabel = style({
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  "::before": {
    content: '""',
    width: 9,
    height: 9,
    borderRadius: 2,
    background: tokens["color/component/ledger-housing-alpha-450"],
  },
});
export const forecastOccasionalLabel = style({
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  "::before": {
    content: '""',
    width: 9,
    height: 9,
    borderRadius: 2,
    background: tokens["color/ledger-occasion"],
  },
});
