import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const window = style({
  height: "100dvh",
  display: "flex",
  flexDirection: "column",
  background: tokens["color/sky"],
  color: tokens["color/ink"],
  fontSize: tokens["typography/sans/body/fontSize"],
  overflowWrap: "anywhere",
  overflow: "hidden",
});
export const header = style({
  padding: `0 ${tokens["spacing/space-12"]}`,
  minHeight: tokens["size/control-36"],
  flexShrink: 0,
  fontSize: tokens["typography/sans/body/fontSize"],
});
export const tabs = style({
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minHeight: 0,
  gap: 0,
});
export const nav = style({
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  justifyContent: "space-between",
  padding: `${tokens["spacing/space-8"]} ${tokens["spacing/space-16"]}`,
  gap: tokens["spacing/space-8"],
  flexShrink: 0,
});
export const tabList = style({ flexWrap: "wrap", gap: 0 });
export const tab = style({ minWidth: 84 });
export const panel = style({
  padding: `0 ${tokens["spacing/space-16"]}`,
  flex: 1,
  minHeight: 0,
  overflow: "auto",
  display: "flex",
  flexDirection: "column",
  gap: tokens["spacing/space-8"],
});
export const embedded = style({
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  gap: tokens["spacing/space-8"],
});
export const embeddedTabs = style({ minWidth: 0 });
export const embeddedPanel = style({
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  gap: tokens["spacing/space-8"],
  selectors: { "&[hidden]": { display: "none" } },
});
export const embeddedContent = style({ minWidth: 0 });
export const diaryTasks = style({ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 });
export const diaryQuickAdd = style({
  display: "flex",
  alignItems: "center",
  gap: 10,
  minHeight: 46,
  boxSizing: "border-box",
  padding: "0 8px 0 14px",
  border: `1px solid ${tokens["color/input-border"]}`,
  borderRadius: tokens["radius/radius-16"],
  background: tokens["color/input"],
  color: tokens["color/ink-3"],
  minWidth: 0,
  "@media": { "(max-width: 800px)": { flexWrap: "wrap", padding: "10px 12px" } },
});
export const diaryInput = style({ flex: 1, minWidth: 160 });
globalStyle(`${diaryInput} > span, ${diaryInput} input`, { width: "100%" });
globalStyle(`${diaryQuickAdd} > span`, { flex: "0 0 auto", maxWidth: 140 });
export const diaryDate = style({
  position: "relative",
  display: "inline-flex",
  flexShrink: 0,
  minWidth: 66,
  height: 30,
  boxSizing: "border-box",
  borderRadius: 10,
  outline: `1px solid ${tokens["color/input-border"]}`,
  outlineOffset: -1,
  background: tokens["color/card"],
  color: tokens["color/ink-2"],
  fontSize: 13,
  lineHeight: "19.5px",
  selectors: { "&:focus-within": { outline: `2px solid ${tokens["color/focus-ring"]}` } },
});
globalStyle(`${diaryDate} > span:first-child`, {
  display: "flex",
  gap: 8,
  alignItems: "center",
  justifyContent: "center",
  padding: "0 10px",
  height: "100%",
  pointerEvents: "none",
});
globalStyle(`${diaryDate} input`, {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  minWidth: 0,
  padding: 0,
  opacity: 0,
  cursor: "pointer",
});
globalStyle(`${diaryDate} input::-webkit-calendar-picker-indicator`, {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  cursor: "pointer",
});
export const diaryList = style({ width: 86, flexShrink: 0 });
export const diaryListDot = style({
  width: 7,
  height: 7,
  borderRadius: 3,
  background: tokens["color/event-google"],
});
globalStyle(`${diaryList} select`, { paddingLeft: 27, paddingRight: 24 });
globalStyle(`${diaryList} > span > span`, { width: "100%" });
export const diaryTemplate = style({
  flexShrink: 0,
  whiteSpace: "nowrap",
  fontSize: 13,
  lineHeight: "18px",
  gap: 4,
});
export const headerActions = style({ display: "flex", alignItems: "center", gap: 8 });
export const diaryTaskGroup = style({
  display: "flex",
  flexDirection: "column",
  gap: 4,
  minWidth: 0,
});
export const diaryGroupHeading = style({
  display: "flex",
  alignItems: "baseline",
  gap: 10,
  padding: "0 4px 2px",
  flexWrap: "wrap",
});
export const diaryGroupTitle = style({
  margin: 0,
  color: tokens["color/ink"],
  fontSize: 14,
  lineHeight: "19px",
  fontWeight: 600,
});
export const diaryGroupMeta = style({
  color: tokens["color/ink-3"],
  fontSize: 12.5,
  lineHeight: "17px",
  margin: 0,
});
export const diaryTaskCard = style({
  minWidth: 0,
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: tokens["radius/radius-16"],
  background: tokens["color/card"],
  overflow: "hidden",
});
export const diaryTaskTitle = style({
  appearance: "none",
  border: 0,
  padding: 0,
  background: "transparent",
  color: "inherit",
  font: "inherit",
  textAlign: "left",
  cursor: "pointer",
  overflowWrap: "anywhere",
  selectors: {
    "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 2 },
  },
});
export const diaryTaskDetails = style({ padding: "0 12px 8px 44px", minWidth: 0 });
export const diaryTaskFooter = style({
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "0 4px",
  flexWrap: "wrap",
});
export const diaryInboxHint = style([
  diaryGroupMeta,
  { marginLeft: "auto", fontSize: 12, lineHeight: "17px" },
]);
export const diaryDragHint = style([
  diaryTaskTitle,
  diaryGroupMeta,
  { fontSize: 12, lineHeight: "17px" },
]);
export const toolbar = style({
  display: "flex",
  alignItems: "center",
  gap: tokens["spacing/space-8"],
  minHeight: 36,
  flexWrap: "wrap",
  flexShrink: 0,
});
export const spacer = style({ flex: 1 });
export const caption = style({
  fontSize: tokens["typography/sans/caption/fontSize"],
  color: tokens["color/ink-2"],
  lineHeight: "1.462",
});
export const heading = style({
  fontSize: tokens["typography/sans/body/fontSize"],
  lineHeight: "1.462",
  fontWeight: 600,
  color: tokens["color/primary"],
});
export const split = style({
  display: "grid",
  gridTemplateColumns: "292px minmax(0,1fr)",
  gap: tokens["spacing/space-16"],
  minHeight: 0,
  flex: 1,
  "@media": {
    "(max-width: 780px)": { gridTemplateColumns: "230px minmax(0,1fr)" },
    "(max-width: 600px)": { gridTemplateColumns: "1fr", overflow: "auto" },
  },
});
export const column = style({
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  gap: tokens["spacing/space-8"],
  overflow: "auto",
  paddingBottom: tokens["spacing/space-12"],
});
export const actions = style({
  display: "flex",
  alignItems: "center",
  gap: tokens["spacing/space-8"],
  flexWrap: "wrap",
});
export const quick = style({
  display: "flex",
  alignItems: "center",
  gap: tokens["spacing/space-8"],
  marginBottom: 0,
});
globalStyle(`${quick} > button`, { flexShrink: 0 });
export const grow = style({ flex: 1, minWidth: 0 });
export const list = style({ display: "flex", flexDirection: "column", minWidth: 0 });
export const task = style({
  display: "flex",
  minHeight: 33,
  alignItems: "center",
  gap: tokens["spacing/space-8"],
  padding: `${tokens["spacing/space-6"]} 0`,
  minWidth: 0,
  selectors: {
    '&[data-selected="true"]': {
      background: tokens["color/selected"],
      color: tokens["color/selected-ink"],
    },
  },
});
export const taskCheck = style({ flexShrink: 0 });
export const taskSummary = style({ minWidth: 0, flex: 1 });
export const taskTitle = style({
  border: 0,
  background: "transparent",
  color: "inherit",
  font: "inherit",
  cursor: "pointer",
  padding: `${tokens["spacing/space-6"]} 0`,
  textAlign: "left",
  minWidth: 0,
  flex: 1,
  overflowWrap: "anywhere",
  selectors: {
    "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 2 },
  },
});
export const taskDetails = style({
  padding: tokens["spacing/space-8"],
  borderLeft: `2px solid ${tokens["color/line"]}`,
  marginTop: tokens["spacing/space-6"],
  minWidth: 0,
});
export const taskMemo = style({
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  margin: `${tokens["spacing/space-8"]} 0`,
});
export const memoPreview = style([
  caption,
  {
    display: "block",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: "100%",
  },
]);
globalStyle(`${taskCheck} label`, { overflowWrap: "anywhere" });
export const meta = style([
  caption,
  { maxWidth: 152, textAlign: "right", overflowWrap: "anywhere" },
]);
export const eventButton = style({
  width: "100%",
  textAlign: "left",
  padding: tokens["spacing/space-8"],
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: tokens["spacing/space-4"],
  border: 0,
  background: "transparent",
  cursor: "pointer",
  font: "inherit",
  color: "inherit",
  selectors: {
    '&[aria-pressed="true"]': {
      background: tokens["color/selected"],
      color: tokens["color/selected-ink"],
    },
    "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: -2 },
    '&[aria-pressed="true"]:focus-visible': { outlineColor: tokens["color/selected-ink"] },
  },
});
export const section = style({
  borderTop: `1px solid ${tokens["color/line"]}`,
  paddingTop: tokens["spacing/space-12"],
  display: "flex",
  flexDirection: "column",
  gap: tokens["spacing/space-8"],
});
export const footer = style([
  caption,
  { padding: `${tokens["spacing/space-8"]} ${tokens["spacing/space-16"]}`, minHeight: tokens["size/control-36"], flexShrink: 0 },
]);
export const status = style([caption, { padding: `${tokens["spacing/space-6"]} ${tokens["spacing/space-16"]}`, flexShrink: 0 }]);
export const error = style({
  padding: `${tokens["spacing/space-8"]} ${tokens["spacing/space-12"]}`,
  color: tokens["color/danger"],
  background: tokens["color/component/danger-alpha-100"],
  fontSize: tokens["typography/sans/body/fontSize"],
  overflowWrap: "anywhere",
});
export const empty = style({
  padding: `${tokens["spacing/space-16"]} 0`,
  display: "flex",
  flexDirection: "column",
  gap: tokens["spacing/space-12"],
  alignItems: "flex-start",
});
export const table = style({
  width: "100%",
  borderCollapse: "collapse",
  fontSize: tokens["typography/sans/body/fontSize"],
});
export const tableScroll = style({ minWidth: 0, maxWidth: "100%", overflowX: "auto" });
globalStyle(`${table} th`, {
  textAlign: "left",
  fontWeight: 400,
  color: tokens["color/ink-2"],
  padding: `${tokens["spacing/space-8"]} ${tokens["spacing/space-6"]}`,
});
globalStyle(`${table} td`, {
  padding: `${tokens["spacing/space-8"]} ${tokens["spacing/space-6"]}`,
  verticalAlign: "middle",
});
export const listSelect = style({ width: 132 });
export const dialog = style({
  fontSize: tokens["typography/sans/body/fontSize"],
  overflowWrap: "anywhere",
});
export const form = style({
  display: "flex",
  flexDirection: "column",
  gap: tokens["spacing/space-12"],
  minWidth: 0,
});
export const fields = style({
  display: "grid",
  gridTemplateColumns: "repeat(2,minmax(0,1fr))",
  gap: `${tokens["spacing/space-12"]} ${tokens["spacing/space-16"]}`,
  "@media": { "(max-width: 520px)": { gridTemplateColumns: "1fr" } },
});
export const field = style({
  display: "flex",
  flexDirection: "column",
  gap: tokens["spacing/space-6"],
  minWidth: 0,
  fontSize: tokens["typography/sans/body/fontSize"],
});
export const short = style({ width: 80 });
export const preview = style([
  caption,
  { padding: `${tokens["spacing/space-8"]} ${tokens["spacing/space-12"]}`, background: tokens["color/card-2"] },
]);
export const templateLayout = style({
  display: "grid",
  gridTemplateColumns: "180px minmax(0,1fr)",
  gap: tokens["spacing/space-16"],
  "@media": {
    "(max-width: 650px)": { gridTemplateColumns: "140px minmax(0,1fr)" },
    "(max-width: 520px)": { gridTemplateColumns: "minmax(0,1fr)" },
  },
});
export const category = style({
  display: "flex",
  flexDirection: "column",
  alignItems: "stretch",
  gap: tokens["spacing/space-8"],
});
export const categoryButton = style({
  textAlign: "left",
  justifyContent: "flex-start",
  selectors: {
    '&[aria-pressed="true"]': {
      background: tokens["color/selected"],
      color: tokens["color/selected-ink"],
    },
    '&[aria-pressed="true"]:hover:not(:disabled)': {
      background: tokens["color/selected"],
      color: tokens["color/selected-ink"],
    },
  },
});
const calendarFont = `${tokens["typography/sans/body/fontFamily"]}, sans-serif`;
const eventInk = `color-mix(in srgb, var(--calendar-color) 72%, ${tokens["color/ink"]})`;
const eventFill = `color-mix(in srgb, var(--calendar-color) 18%, ${tokens["color/sky"]})`;
const eventFocus = {
  '&[aria-pressed="true"]': { boxShadow: `inset 0 0 0 1.5px var(--calendar-color)` },
  "&:hover": { filter: "brightness(0.96)" },
  "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: -2 },
};
export const calendarSources = style({
  display: "flex",
  flexDirection: "column",
  gap: tokens["spacing/space-8"],
  paddingTop: tokens["spacing/space-6"],
});
export const calendarTitle = style({
  fontSize: tokens["typography/display/page/fontSize"],
  fontWeight: 600,
  letterSpacing: "-0.03em",
});
export const calendarNavigation = style({ display: "flex", alignItems: "center", gap: 0 });
export const viewSwitch = style({
  display: "flex",
  padding: tokens["spacing/space-4"],
  borderRadius: tokens["radius/radius-12"],
  background: tokens["color/card-2"],
});
export const viewButton = style({
  border: 0,
  borderRadius: tokens["radius/radius-9"],
  padding: `${tokens["spacing/space-6"]} ${tokens["spacing/space-16"]}`,
  cursor: "pointer",
  fontFamily: calendarFont,
  fontSize: tokens["typography/sans/caption/fontSize"],
  color: tokens["color/ink-2"],
  background: "transparent",
  selectors: {
    '&[aria-pressed="true"]': {
      background: tokens["color/selected"],
      color: tokens["color/selected-ink"],
    },
    "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}` },
    '&[aria-pressed="true"]:focus-visible': {
      outlineColor: tokens["color/selected-ink"],
      outlineOffset: -2,
    },
  },
});
export const calendarLayout = style({
  display: "grid",
  gridTemplateColumns: "minmax(0,1fr) 220px",
  gap: tokens["spacing/space-16"],
  minHeight: 0,
  flex: 1,
  "@media": {
    "(max-width: 820px)": { gridTemplateColumns: "minmax(0,1fr) 180px", gap: tokens["spacing/space-12"] },
    "(max-width: 650px)": { gridTemplateColumns: "1fr", overflow: "auto" },
  },
});
export const calendarMain = style({
  minWidth: 0,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  overflow: "auto",
  gap: tokens["spacing/space-8"],
  paddingBottom: tokens["spacing/space-8"],
});
export const calendarFootnote = style([
  caption,
  {
    display: "flex",
    gap: `${tokens["spacing/space-4"]} ${tokens["spacing/space-16"]}`,
    flexWrap: "wrap",
    flexShrink: 0,
    fontFamily: calendarFont,
    fontSize: tokens["typography/sans/caption/fontSize"],
    lineHeight: "1.385",
  },
]);
export const month = style({
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minWidth: 420,
  fontFamily: calendarFont,
});
export const monthWeek = style({
  display: "grid",
  gridTemplateColumns: "repeat(7,minmax(0,1fr))",
  flex: "1 0 auto",
  minHeight: 64,
  borderTop: `1px solid ${tokens["color/line"]}`,
  borderLeft: `1px solid ${tokens["color/line"]}`,
  selectors: {
    "&:last-child": { borderBottom: `1px solid ${tokens["color/line"]}` },
  },
});
export const monthCell = style({
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  alignItems: "stretch",
  paddingBottom: tokens["spacing/space-6"],
  borderRight: `1px solid ${tokens["color/line"]}`,
  color: tokens["color/ink"],
  selectors: {
    '&[data-weekend="true"]': {
      background: `color-mix(in srgb, ${tokens["color/ink"]} 3%, transparent)`,
    },
    '&[data-selected="true"]': {
      background: `color-mix(in srgb, ${tokens["color/primary"]} 5%, transparent)`,
    },
    '&[data-outside="true"]': { color: tokens["color/ink-2"] },
  },
});
export const monthDate = style({
  alignSelf: "flex-end",
  margin: `${tokens["spacing/space-4"]} ${tokens["spacing/space-6"]}`,
  minWidth: 26,
  height: 26,
  padding: `0 ${tokens["spacing/space-6"]}`,
  flexShrink: 0,
  border: 0,
  borderRadius: "50%",
  fontFamily: calendarFont,
  fontSize: tokens["typography/display/title-sm/fontSize"],
  lineHeight: "26px",
  color: "inherit",
  background: "transparent",
  cursor: "pointer",
  selectors: {
    '&[aria-pressed="true"]': { boxShadow: `inset 0 0 0 1px ${tokens["color/input-border"]}` },
    '&[aria-current="date"]': {
      background: tokens["color/danger"],
      color: tokens["color/sky"],
      boxShadow: "none",
      fontWeight: 600,
    },
    "&:hover": {
      background: tokens["color/hover"],
      color: tokens["color/ink"],
    },
    "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}` },
  },
});
export const ellipsis = style({
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  minWidth: 0,
  maxWidth: "100%",
});
export const dayHead = style({
  display: "grid",
  gridTemplateColumns: "repeat(7,minmax(0,1fr))",
  fontSize: tokens["typography/sans/caption/fontSize"],
  lineHeight: "26px",
  textAlign: "right",
  color: tokens["color/ink-2"],
  flexShrink: 0,
});
globalStyle(`${dayHead} > span`, { paddingRight: tokens["spacing/space-12"] });
export const allDayEvent = style({
  zIndex: 1,
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  gap: tokens["spacing/space-6"],
  alignSelf: "center",
  height: 22,
  margin: "1px 2px",
  padding: "0 5px",
  border: 0,
  borderRadius: tokens["radius/radius-9"],
  fontFamily: calendarFont,
  fontSize: tokens["typography/sans/caption/fontSize"],
  fontWeight: 500,
  lineHeight: "1.385",
  textAlign: "left",
  color: eventInk,
  background: eventFill,
  cursor: "pointer",
  overflow: "hidden",
  selectors: {
    ...eventFocus,
    '&[data-continues-before="true"]': {
      borderTopLeftRadius: 0,
      borderBottomLeftRadius: 0,
      marginLeft: 0,
    },
    '&[data-continues-after="true"]': {
      borderTopRightRadius: 0,
      borderBottomRightRadius: 0,
      marginRight: 0,
    },
  },
});
globalStyle(`${allDayEvent} svg`, { flexShrink: 0 });
export const monthTimedList = style({ display: "flex", flexDirection: "column", minWidth: 0 });
export const monthTimedEvent = style({
  display: "flex",
  alignItems: "center",
  gap: tokens["spacing/space-6"],
  minWidth: 0,
  minHeight: 23,
  margin: `0 ${tokens["spacing/space-4"]}`,
  padding: "2px 3px",
  border: 0,
  borderRadius: tokens["radius/radius-9"],
  background: "transparent",
  color: tokens["color/ink"],
  textAlign: "left",
  fontFamily: calendarFont,
  fontSize: tokens["typography/sans/caption/fontSize"],
  cursor: "pointer",
  selectors: eventFocus,
});
export const eventStripe = style({
  width: 3,
  height: 14,
  borderRadius: 2,
  flexShrink: 0,
  background: "var(--calendar-color)",
});
export const eventTime = style({
  marginLeft: "auto",
  paddingLeft: tokens["spacing/space-4"],
  color: tokens["color/ink-2"],
  whiteSpace: "nowrap",
  fontSize: tokens["typography/sans/caption/fontSize"],
  fontVariantNumeric: "tabular-nums",
  flexShrink: 0,
});
export const agendaEvent = style([
  monthTimedEvent,
  { margin: 0, minHeight: 30, fontSize: tokens["typography/sans/body/fontSize"] },
]);
export const moreEvents = style({
  border: 0,
  background: "transparent",
  color: tokens["color/ink-2"],
  textAlign: "left",
  cursor: "pointer",
  fontFamily: calendarFont,
  fontSize: tokens["typography/sans/caption/fontSize"],
  padding: "3px 9px",
  selectors: { "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}` } },
});
export const weekScroll = style({
  overflow: "auto",
  flex: 1,
  minHeight: 0,
  paddingBottom: tokens["spacing/space-8"],
});
export const week = style({
  display: "grid",
  gridTemplateColumns: "32px repeat(7,minmax(0,1fr))",
  minWidth: 420,
  fontFamily: calendarFont,
});
export const weekDayHead = style({
  display: "grid",
  gridTemplateColumns: "repeat(7,minmax(0,1fr))",
  gridColumn: "2 / -1",
  paddingBottom: tokens["spacing/space-8"],
});
export const weekDate = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexDirection: "column",
  gap: tokens["spacing/space-4"],
  border: 0,
  borderRadius: tokens["radius/radius-9"],
  background: "transparent",
  color: tokens["color/ink"],
  fontFamily: calendarFont,
  fontSize: tokens["typography/display/page/fontSize"],
  padding: `${tokens["spacing/space-8"]} 0`,
  cursor: "pointer",
  selectors: {
    '&[aria-current="date"]': { color: tokens["color/danger"], fontWeight: 600 },
    '&[aria-pressed="true"]': {
      background: tokens["color/selected"],
      color: tokens["color/selected-ink"],
    },
    "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: -2 },
    '&[aria-pressed="true"]:focus-visible': { outlineColor: tokens["color/selected-ink"] },
  },
});
export const allDayLabel = style([caption, { paddingTop: tokens["spacing/space-4"], fontFamily: calendarFont }]);
export const weekAllDay = style({
  gridColumn: "2 / -1",
  display: "grid",
  gridTemplateColumns: "repeat(7,minmax(0,1fr))",
  paddingBottom: tokens["spacing/space-12"],
});
export const allDayCell = style({
  borderLeft: `1px solid ${tokens["color/line"]}`,
});
export const timeColumn = style({
  position: "relative",
  fontSize: tokens["typography/sans/caption/fontSize"],
  color: tokens["color/ink-2"],
});
export const weekColumn = style({
  position: "relative",
  borderLeft: `1px solid ${tokens["color/line"]}`,
  backgroundImage: `repeating-linear-gradient(to bottom, ${tokens["color/line"]} 0px, ${tokens["color/line"]} 1px, transparent 1px, transparent 44px)`,
  selectors: {
    '&[data-weekend="true"]': {
      backgroundColor: `color-mix(in srgb, ${tokens["color/ink"]} 3%, transparent)`,
    },
  },
});
export const time = style({ position: "absolute", left: 0, top: 0, transform: "translateY(-50%)" });
export const calendarEvent = style({
  position: "absolute",
  display: "flex",
  flexDirection: "column",
  gap: tokens["spacing/space-4"],
  padding: "3px 4px",
  textAlign: "left",
  border: 0,
  borderRadius: tokens["radius/radius-9"],
  color: eventInk,
  background: eventFill,
  fontFamily: calendarFont,
  fontSize: tokens["typography/sans/caption/fontSize"],
  overflow: "hidden",
  minHeight: 20,
  cursor: "pointer",
  borderLeft: "3px solid var(--calendar-color)",
  selectors: eventFocus,
});
export const weekEventTime = style({
  fontSize: tokens["typography/sans/caption/fontSize"],
  lineHeight: "1.385",
});
export const visuallyHidden = style({
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  overflow: "hidden",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
});

globalStyle(`${calendarEvent} > span`, {
  flexShrink: 0,
  lineHeight: "1.385",
});

globalStyle(`${window} button, ${dialog} button`, {
  maxWidth: "100%",
  whiteSpace: "normal",
  overflowWrap: "anywhere",
});
globalStyle(`${window} input, ${window} select, ${dialog} input, ${dialog} select`, {
  minWidth: 0,
  maxWidth: "100%",
});

globalStyle(
  `${task}[data-selected="true"] .${caption}, ${task}[data-selected="true"] .${meta}, ${eventButton}[aria-pressed="true"] .${caption}, ${weekDate}[aria-pressed="true"] .${caption}`,
  { color: "inherit" },
);
export const wrapStats = style({
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))",
  gap: tokens["spacing/space-8"],
  margin: 0,
});
export const wrapStat = style({
  display: "grid",
  gap: tokens["spacing/space-4"],
  padding: tokens["spacing/space-12"],
  border: `1px solid ${tokens["color/line"]}`,
  borderRadius: tokens["radius/radius-9"],
  background: tokens["color/card"],
});
globalStyle(`${wrapStat} dt`, {
  fontSize: tokens["typography/sans/caption/fontSize"],
  color: tokens["color/ink-2"],
});
globalStyle(`${wrapStat} dd`, {
  margin: 0,
  fontSize: tokens["typography/sans/body/fontSize"],
  fontWeight: 600,
  color: tokens["color/ink"],
});
export const wrapHeading = style({
  fontSize: tokens["typography/sans/caption/fontSize"],
  color: tokens["color/ink"],
});
export const wrapItem = style({
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: tokens["spacing/space-8"],
});
export const carryover = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: tokens["spacing/space-8"],
  padding: `${tokens["spacing/space-8"]} ${tokens["spacing/space-12"]}`,
  border: `1px solid ${tokens["color/primary"]}`,
  borderRadius: tokens["radius/radius-9"],
  color: tokens["color/primary"],
  fontSize: tokens["typography/sans/caption/fontSize"],
});

// Period plan board: four columns from 820px, one column under period tabs below that.
const NARROW = "(max-width: 819.98px)";
export const planTabs = style({
  display: "none",
  gap: 4,
  padding: 3,
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: tokens["radius/radius-12"],
  "@media": { [NARROW]: { display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))" } },
});
export const planTab = style({
  minHeight: 32,
  border: 0,
  borderRadius: tokens["radius/radius-9"],
  background: "transparent",
  color: tokens["color/ink-3"],
  font: "inherit",
  fontSize: 13,
  cursor: "pointer",
  selectors: {
    '&[aria-pressed="true"]': {
      background: tokens["color/selected"],
      color: tokens["color/selected-ink"],
      fontWeight: 600,
    },
  },
});
export const planBoard = style({
  display: "grid",
  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
  alignItems: "start",
  gap: tokens["spacing/space-12"],
  minWidth: 0,
  "@media": { [NARROW]: { gridTemplateColumns: "minmax(0, 1fr)" } },
});
export const planColumn = style({
  display: "flex",
  flexDirection: "column",
  gap: tokens["spacing/space-8"],
  minWidth: 0,
  padding: tokens["spacing/space-12"],
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: tokens["radius/radius-16"],
  background: tokens["color/card"],
  "@media": { [NARROW]: { selectors: { '&[data-current="false"]': { display: "none" } } } },
});
export const planColumnHeader = style({
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  justifyContent: "space-between",
  gap: tokens["spacing/space-8"],
  minHeight: 28,
});
export const planColumnTitle = style({
  margin: 0,
  fontSize: 15,
  fontWeight: 500,
  whiteSpace: "nowrap",
});
export const planColumnRange = style({
  display: "flex",
  alignItems: "center",
  gap: 2,
  fontSize: 12,
  color: tokens["color/ink-3"],
  whiteSpace: "nowrap",
});
export const planCard = style({
  display: "flex",
  flexDirection: "column",
  gap: tokens["spacing/space-8"],
  padding: `${tokens["spacing/space-8"]} ${tokens["spacing/space-12"]}`,
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: tokens["radius/radius-9"],
  background: tokens["color/card-2"],
  selectors: { '&[data-selected="true"]': { borderColor: tokens["color/primary"] } },
});
export const planCardRow = style({
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: tokens["spacing/space-8"],
  minWidth: 0,
});
export const planCardTitle = style({
  // Chips drop below the title before it gets narrower than this.
  flex: "1 1 6em",
  minWidth: 0,
  padding: 0,
  border: 0,
  background: "transparent",
  color: "inherit",
  font: "inherit",
  fontSize: 14,
  textAlign: "left",
  cursor: "pointer",
  wordBreak: "keep-all",
  overflowWrap: "anywhere",
  selectors: {
    '&[data-done="true"]': { textDecoration: "line-through", color: tokens["color/ink-3"] },
  },
});
export const planCardChips = style({
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 6,
  minWidth: 0,
  "@media": {
    "(max-width: 1080px)": { flexBasis: "100%", paddingLeft: 28 },
  },
  selectors: { "&:empty": { display: "none" } },
});
export const planChip = style({
  padding: "1px 8px",
  border: `1px solid ${tokens["color/input-border"]}`,
  borderRadius: tokens["radius/radius-12"],
  fontSize: 12,
  color: tokens["color/ink-2"],
  whiteSpace: "nowrap",
});
export const planRepeat = style({
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  fontSize: 12,
  color: tokens["color/list-gray"],
  whiteSpace: "nowrap",
});
export const planCardActions = style({ display: "flex", gap: 6, paddingLeft: 28 });
export const planAdd = style({ display: "flex", alignItems: "center", gap: 6 });
export const planAddButton = style({
  display: "flex",
  alignItems: "center",
  gap: 6,
  minHeight: 36,
  padding: `0 ${tokens["spacing/space-12"]}`,
  border: `1px dashed ${tokens["color/input-border"]}`,
  borderRadius: tokens["radius/radius-9"],
  background: "transparent",
  color: tokens["color/ink-2"],
  font: "inherit",
  fontSize: 13,
  textAlign: "left",
  cursor: "pointer",
});
export const planHint = style({ margin: 0, fontSize: 12, color: tokens["color/ink-3"] });
export const planHintWide = style({ "@media": { [NARROW]: { display: "none" } } });
export const planHintNarrow = style({
  display: "none",
  "@media": { [NARROW]: { display: "inline" } },
});
