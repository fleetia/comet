import { globalStyle, style } from "@vanilla-extract/css";
import { semanticVars as v, componentVars, themeVars, vnextVars } from "@fleetia/lagrange/theme";

export const window = style({
  height: "100dvh",
  display: "flex",
  flexDirection: "column",
  background: v.color.surface.canvas,
  color: v.color.content.primary,
  fontSize: v.typography.size.body,
  overflowWrap: "anywhere",
  overflow: "hidden",
});
export const header = style({
  padding: `0 ${v.space.md}`,
  minHeight: v.dimension.control,
  flexShrink: 0,
  fontSize: v.typography.size.label,
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
  padding: `${v.space.sm} ${v.space.lg}`,
  gap: v.space.sm,
  flexShrink: 0,
});
export const tabList = style({ flexWrap: "wrap", gap: 0 });
export const tab = style({ minWidth: 84 });
export const panel = style({
  padding: `0 ${v.space.lg}`,
  flex: 1,
  minHeight: 0,
  overflow: "auto",
  display: "flex",
  flexDirection: "column",
  gap: v.space.sm,
});
export const embedded = style({
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  gap: v.space.sm,
});
export const embeddedTabs = style({ minWidth: 0 });
export const embeddedPanel = style({
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  gap: v.space.sm,
  selectors: { "&[hidden]": { display: "none" } },
});
export const embeddedContent = style({ minWidth: 0 });
export const toolbar = style({
  display: "flex",
  alignItems: "center",
  gap: v.space.sm,
  minHeight: 36,
  flexWrap: "wrap",
  flexShrink: 0,
});
export const spacer = style({ flex: 1 });
export const caption = style({
  fontSize: v.typography.size.caption,
  color: v.color.content.secondary,
  lineHeight: v.typography.lineHeight.body,
});
export const heading = style({
  fontSize: v.typography.size.label,
  lineHeight: v.typography.lineHeight.body,
  fontWeight: 600,
  color: v.color.content.accent,
});
export const split = style({
  display: "grid",
  gridTemplateColumns: "292px minmax(0,1fr)",
  gap: v.space.lg,
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
  gap: v.space.sm,
  overflow: "auto",
  paddingBottom: v.space.md,
});
export const actions = style({
  display: "flex",
  alignItems: "center",
  gap: v.space.sm,
  flexWrap: "wrap",
});
export const quick = style({
  display: "flex",
  alignItems: "center",
  gap: v.space.sm,
  marginBottom: 0,
});
globalStyle(`${quick} > button`, { flexShrink: 0 });
export const grow = style({ flex: 1, minWidth: 0 });
export const list = style({ display: "flex", flexDirection: "column", minWidth: 0 });
export const task = style({
  display: "flex",
  minHeight: 33,
  alignItems: "center",
  gap: v.space.sm,
  padding: `${v.space.xs} 0`,
  minWidth: 0,
  selectors: {
    '&[data-selected="true"]': {
      background: componentVars.navigation.selectedSurface,
      color: componentVars.navigation.selectedText,
      vars: {
        [themeVars.component.button.quietText]: componentVars.navigation.selectedText,
        [themeVars.component.button.focusIndicator]: componentVars.navigation.selectedText,
      },
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
  padding: `${v.space.xs} 0`,
  textAlign: "left",
  minWidth: 0,
  flex: 1,
  overflowWrap: "anywhere",
  selectors: {
    "&:focus-visible": { outline: `2px solid ${v.color.interaction.focus}`, outlineOffset: 2 },
  },
});
export const taskDetails = style({
  padding: v.space.sm,
  borderLeft: `2px solid ${v.color.border.subtle}`,
  marginTop: v.space.xs,
  minWidth: 0,
});
export const taskMemo = style({
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  margin: `${v.space.sm} 0`,
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
globalStyle(`${task}[data-selected="true"] .${taskCheck}`, {
  vars: {
    [themeVars.semantic.color.content.accent]: componentVars.navigation.selectedText,
    [themeVars.semantic.color.interaction.focus]: componentVars.navigation.selectedText,
    [themeVars.component.choice.text]: componentVars.navigation.selectedText,
    [themeVars.component.choice.checkIndicator]: componentVars.navigation.selectedText,
    [themeVars.component.choice.focusSurface]: componentVars.navigation.selectedSurface,
    [themeVars.component.choice.disabledText]: componentVars.navigation.selectedText,
  },
});
export const meta = style([
  caption,
  { maxWidth: 152, textAlign: "right", overflowWrap: "anywhere" },
]);
export const eventButton = style({
  width: "100%",
  textAlign: "left",
  padding: v.space.sm,
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: v.space.xxs,
  border: 0,
  background: "transparent",
  cursor: "pointer",
  font: "inherit",
  color: "inherit",
  selectors: {
    '&[aria-pressed="true"]': {
      background: componentVars.navigation.selectedSurface,
      color: componentVars.navigation.selectedText,
    },
    "&:focus-visible": { outline: `2px solid ${v.color.interaction.focus}`, outlineOffset: -2 },
    '&[aria-pressed="true"]:focus-visible': { outlineColor: componentVars.navigation.selectedText },
  },
});
export const section = style({
  borderTop: `${v.border.width.hairline} solid ${v.color.border.subtle}`,
  paddingTop: v.space.md,
  display: "flex",
  flexDirection: "column",
  gap: v.space.sm,
});
export const footer = style([
  caption,
  { padding: `${v.space.sm} ${v.space.lg}`, minHeight: v.dimension.control, flexShrink: 0 },
]);
export const status = style([caption, { padding: `${v.space.xs} ${v.space.lg}`, flexShrink: 0 }]);
export const error = style({
  padding: `${v.space.sm} ${v.space.md}`,
  color: v.color.status.critical,
  background: v.color.status.criticalSurface,
  fontSize: v.typography.size.label,
  overflowWrap: "anywhere",
});
export const empty = style({
  padding: `${v.space.lg} 0`,
  display: "flex",
  flexDirection: "column",
  gap: v.space.md,
  alignItems: "flex-start",
});
export const table = style({
  width: "100%",
  borderCollapse: "collapse",
  fontSize: v.typography.size.label,
});
export const tableScroll = style({ minWidth: 0, maxWidth: "100%", overflowX: "auto" });
globalStyle(`${table} th`, {
  textAlign: "left",
  fontWeight: 400,
  color: v.color.content.secondary,
  padding: `${v.space.sm} ${v.space.xs}`,
});
globalStyle(`${table} td`, {
  padding: `${v.space.sm} ${v.space.xs}`,
  verticalAlign: "middle",
});
export const listSelect = style({ width: 132 });
export const dialog = style({
  width: "min(640px, calc(100vw - 32px))",
  maxHeight: "calc(100dvh - 32px)",
  fontSize: v.typography.size.body,
  overflowWrap: "anywhere",
});
export const form = style({
  display: "flex",
  flexDirection: "column",
  gap: v.space.md,
  minWidth: 0,
});
export const fields = style({
  display: "grid",
  gridTemplateColumns: "repeat(2,minmax(0,1fr))",
  gap: `${v.space.md} ${v.space.lg}`,
  "@media": { "(max-width: 520px)": { gridTemplateColumns: "1fr" } },
});
export const field = style({
  display: "flex",
  flexDirection: "column",
  gap: v.space.xs,
  minWidth: 0,
  fontSize: v.typography.size.label,
});
export const short = style({ width: 80 });
export const preview = style([
  caption,
  { padding: `${v.space.sm} ${v.space.md}`, background: v.color.surface.muted },
]);
export const templateLayout = style({
  display: "grid",
  gridTemplateColumns: "180px minmax(0,1fr)",
  gap: v.space.lg,
  "@media": {
    "(max-width: 650px)": { gridTemplateColumns: "140px minmax(0,1fr)" },
    "(max-width: 520px)": { gridTemplateColumns: "minmax(0,1fr)" },
  },
});
export const category = style({
  display: "flex",
  flexDirection: "column",
  alignItems: "stretch",
  gap: v.space.sm,
});
export const categoryButton = style({
  textAlign: "left",
  justifyContent: "flex-start",
  selectors: {
    '&[aria-pressed="true"]': {
      background: componentVars.navigation.selectedSurface,
      color: componentVars.navigation.selectedText,
    },
    '&[aria-pressed="true"]:hover:not(:disabled)': {
      background: componentVars.navigation.selectedSurface,
      color: componentVars.navigation.selectedText,
    },
  },
});
const calendarFont = v.typography.family.ui;
const eventInk = `color-mix(in srgb, var(--calendar-color) 72%, ${v.color.content.primary})`;
const eventFill = `color-mix(in srgb, var(--calendar-color) 18%, ${v.color.surface.canvas})`;
const eventFocus = {
  '&[aria-pressed="true"]': { boxShadow: `inset 0 0 0 1.5px var(--calendar-color)` },
  "&:hover": { filter: "brightness(0.96)" },
  "&:focus-visible": { outline: `2px solid ${v.color.interaction.focus}`, outlineOffset: -2 },
};
export const calendarSources = style({
  display: "flex",
  flexDirection: "column",
  gap: v.space.sm,
  paddingTop: v.space.xs,
});
export const calendarTitle = style({
  fontSize: v.typography.size.headingMd,
  fontWeight: 600,
  letterSpacing: "-0.03em",
});
export const calendarNavigation = style({ display: "flex", alignItems: "center", gap: 0 });
export const viewSwitch = style({
  display: "flex",
  padding: v.space.xxs,
  borderRadius: vnextVars.radius.inset,
  background: v.color.surface.muted,
});
export const viewButton = style({
  border: 0,
  borderRadius: vnextVars.radius.control,
  padding: `${v.space.xs} ${v.space.lg}`,
  cursor: "pointer",
  fontFamily: calendarFont,
  fontSize: v.typography.size.caption,
  color: v.color.content.secondary,
  background: "transparent",
  selectors: {
    '&[aria-pressed="true"]': {
      background: componentVars.navigation.selectedSurface,
      color: componentVars.navigation.selectedText,
    },
    "&:focus-visible": { outline: `2px solid ${v.color.interaction.focus}` },
    '&[aria-pressed="true"]:focus-visible': {
      outlineColor: componentVars.navigation.selectedText,
      outlineOffset: -2,
    },
  },
});
export const calendarLayout = style({
  display: "grid",
  gridTemplateColumns: "minmax(0,1fr) 220px",
  gap: v.space.lg,
  minHeight: 0,
  flex: 1,
  "@media": {
    "(max-width: 820px)": { gridTemplateColumns: "minmax(0,1fr) 180px", gap: v.space.md },
    "(max-width: 650px)": { gridTemplateColumns: "1fr", overflow: "auto" },
  },
});
export const calendarMain = style({
  minWidth: 0,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  overflow: "auto",
  gap: v.space.sm,
  paddingBottom: v.space.sm,
});
export const calendarFootnote = style([
  caption,
  {
    display: "flex",
    gap: `${v.space.xxs} ${v.space.lg}`,
    flexWrap: "wrap",
    flexShrink: 0,
    fontFamily: calendarFont,
    fontSize: v.typography.size.caption,
    lineHeight: v.typography.lineHeight.compact,
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
  borderTop: `${v.border.width.hairline} solid ${v.color.border.subtle}`,
  borderLeft: `${v.border.width.hairline} solid ${v.color.border.subtle}`,
  selectors: {
    "&:last-child": { borderBottom: `${v.border.width.hairline} solid ${v.color.border.subtle}` },
  },
});
export const monthCell = style({
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  alignItems: "stretch",
  paddingBottom: v.space.xs,
  borderRight: `${v.border.width.hairline} solid ${v.color.border.subtle}`,
  color: v.color.content.primary,
  selectors: {
    '&[data-weekend="true"]': {
      background: `color-mix(in srgb, ${v.color.content.primary} 3%, transparent)`,
    },
    '&[data-selected="true"]': {
      background: `color-mix(in srgb, ${v.color.content.accent} 5%, transparent)`,
    },
    '&[data-outside="true"]': { color: v.color.content.secondary },
  },
});
export const monthDate = style({
  alignSelf: "flex-end",
  margin: `${v.space.xxs} ${v.space.xs}`,
  minWidth: 26,
  height: 26,
  padding: `0 ${v.space.xs}`,
  flexShrink: 0,
  border: 0,
  borderRadius: "50%",
  fontFamily: calendarFont,
  fontSize: v.typography.size.headingSm,
  lineHeight: "26px",
  color: "inherit",
  background: "transparent",
  cursor: "pointer",
  selectors: {
    '&[aria-pressed="true"]': { boxShadow: `inset 0 0 0 1px ${v.color.border.strong}` },
    '&[aria-current="date"]': {
      background: v.color.status.critical,
      color: v.color.surface.canvas,
      boxShadow: "none",
      fontWeight: 600,
    },
    "&:hover": {
      background: componentVars.navigation.hoverSurface,
      color: componentVars.navigation.hoverText,
    },
    "&:focus-visible": { outline: `2px solid ${v.color.interaction.focus}` },
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
  fontSize: v.typography.size.caption,
  lineHeight: "26px",
  textAlign: "right",
  color: v.color.content.secondary,
  flexShrink: 0,
});
globalStyle(`${dayHead} > span`, { paddingRight: v.space.md });
export const allDayEvent = style({
  zIndex: 1,
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  gap: v.space.xs,
  alignSelf: "center",
  height: 22,
  margin: "1px 2px",
  padding: "0 5px",
  border: 0,
  borderRadius: vnextVars.radius.control,
  fontFamily: calendarFont,
  fontSize: v.typography.size.caption,
  fontWeight: 500,
  lineHeight: v.typography.lineHeight.compact,
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
  gap: v.space.xs,
  minWidth: 0,
  minHeight: 23,
  margin: `0 ${v.space.xxs}`,
  padding: "2px 3px",
  border: 0,
  borderRadius: vnextVars.radius.control,
  background: "transparent",
  color: v.color.content.primary,
  textAlign: "left",
  fontFamily: calendarFont,
  fontSize: v.typography.size.caption,
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
  paddingLeft: v.space.xxs,
  color: v.color.content.secondary,
  whiteSpace: "nowrap",
  fontSize: v.typography.size.caption,
  fontVariantNumeric: "tabular-nums",
  flexShrink: 0,
});
export const agendaEvent = style([
  monthTimedEvent,
  { margin: 0, minHeight: 30, fontSize: v.typography.size.label },
]);
export const moreEvents = style({
  border: 0,
  background: "transparent",
  color: v.color.content.secondary,
  textAlign: "left",
  cursor: "pointer",
  fontFamily: calendarFont,
  fontSize: v.typography.size.caption,
  padding: "3px 9px",
  selectors: { "&:focus-visible": { outline: `2px solid ${v.color.interaction.focus}` } },
});
export const weekScroll = style({
  overflow: "auto",
  flex: 1,
  minHeight: 0,
  paddingBottom: v.space.sm,
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
  paddingBottom: v.space.sm,
});
export const weekDate = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexDirection: "column",
  gap: v.space.xxs,
  border: 0,
  borderRadius: vnextVars.radius.control,
  background: "transparent",
  color: v.color.content.primary,
  fontFamily: calendarFont,
  fontSize: v.typography.size.headingMd,
  padding: `${v.space.sm} 0`,
  cursor: "pointer",
  selectors: {
    '&[aria-current="date"]': { color: v.color.status.critical, fontWeight: 600 },
    '&[aria-pressed="true"]': {
      background: componentVars.navigation.selectedSurface,
      color: componentVars.navigation.selectedText,
    },
    "&:focus-visible": { outline: `2px solid ${v.color.interaction.focus}`, outlineOffset: -2 },
    '&[aria-pressed="true"]:focus-visible': { outlineColor: componentVars.navigation.selectedText },
  },
});
export const allDayLabel = style([caption, { paddingTop: v.space.xxs, fontFamily: calendarFont }]);
export const weekAllDay = style({
  gridColumn: "2 / -1",
  display: "grid",
  gridTemplateColumns: "repeat(7,minmax(0,1fr))",
  paddingBottom: v.space.md,
});
export const allDayCell = style({
  borderLeft: `${v.border.width.hairline} solid ${v.color.border.subtle}`,
});
export const timeColumn = style({
  position: "relative",
  fontSize: v.typography.size.caption,
  color: v.color.content.secondary,
});
export const weekColumn = style({
  position: "relative",
  borderLeft: `${v.border.width.hairline} solid ${v.color.border.subtle}`,
  backgroundImage: `repeating-linear-gradient(to bottom, ${v.color.border.subtle} 0px, ${v.color.border.subtle} 1px, transparent 1px, transparent 44px)`,
  selectors: {
    '&[data-weekend="true"]': {
      backgroundColor: `color-mix(in srgb, ${v.color.content.primary} 3%, transparent)`,
    },
  },
});
export const time = style({ position: "absolute", left: 0, top: 0, transform: "translateY(-50%)" });
export const calendarEvent = style({
  position: "absolute",
  display: "flex",
  flexDirection: "column",
  gap: v.space.xxs,
  padding: "3px 4px",
  textAlign: "left",
  border: 0,
  borderRadius: vnextVars.radius.control,
  color: eventInk,
  background: eventFill,
  fontFamily: calendarFont,
  fontSize: v.typography.size.caption,
  overflow: "hidden",
  minHeight: 20,
  cursor: "pointer",
  borderLeft: "3px solid var(--calendar-color)",
  selectors: eventFocus,
});
export const weekEventTime = style({
  fontSize: v.typography.size.caption,
  lineHeight: v.typography.lineHeight.compact,
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
  lineHeight: v.typography.lineHeight.compact,
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
