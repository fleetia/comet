import { globalStyle, style } from "@vanilla-extract/css";
import { semanticVars as v } from "@fleetia/lagrange/theme";

export const window = style({
  height: "100dvh",
  display: "flex",
  flexDirection: "column",
  background: v.color.surface.canvas,
  color: v.color.content.primary,
  fontSize: v.typography.size.body,
  overflow: "hidden",
});
export const header = style({
  padding: "0 12px",
  minHeight: 32,
  flexShrink: 0,
  borderBottom: `1px solid ${v.color.border.strong}`,
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
  alignItems: "center",
  justifyContent: "space-between",
  padding: "7px 16px",
  gap: 8,
  flexShrink: 0,
});
export const tabList = style({ flexWrap: "wrap", gap: 0 });
export const tab = style({ minWidth: 84 });
export const panel = style({
  padding: "0 16px",
  flex: 1,
  minHeight: 0,
  overflow: "auto",
  display: "flex",
  flexDirection: "column",
  gap: 8,
});
export const toolbar = style({
  display: "flex",
  alignItems: "center",
  gap: 8,
  minHeight: 36,
  flexWrap: "wrap",
  flexShrink: 0,
});
export const spacer = style({ flex: 1 });
export const caption = style({
  fontSize: v.typography.size.caption,
  color: v.color.content.secondary,
  lineHeight: "18px",
});
export const heading = style({
  fontSize: v.typography.size.label,
  lineHeight: "20px",
  fontWeight: 600,
  color: v.color.content.accent,
});
export const split = style({
  display: "grid",
  gridTemplateColumns: "292px minmax(0,1fr)",
  gap: 16,
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
  gap: 8,
  overflow: "auto",
  paddingBottom: 12,
});
export const actions = style({ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" });
export const quick = style({ display: "flex", alignItems: "center", gap: 8, marginBottom: 0 });
export const grow = style({ flex: 1, minWidth: 0 });
export const list = style({ display: "flex", flexDirection: "column", minWidth: 0 });
export const task = style({
  display: "flex",
  minHeight: 33,
  alignItems: "center",
  gap: 8,
  borderBottom: `1px solid ${v.color.border.subtle}`,
  padding: "4px 0",
  minWidth: 0,
  selectors: { '&[data-selected="true"]': { background: v.color.selection.surface } },
});
export const taskCheck = style({ flex: 1, minWidth: 0 });
globalStyle(`${taskCheck} label`, { overflowWrap: "anywhere" });
export const meta = style([
  caption,
  { maxWidth: 152, textAlign: "right", overflowWrap: "anywhere" },
]);
export const eventButton = style({
  width: "100%",
  textAlign: "left",
  padding: "7px 8px",
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: 2,
  border: 0,
  background: "transparent",
  cursor: "pointer",
  font: "inherit",
  color: "inherit",
  selectors: {
    '&[aria-pressed="true"]': { background: v.color.selection.surface },
    "&:focus-visible": { outline: `2px solid ${v.color.interaction.focus}`, outlineOffset: -2 },
  },
});
export const section = style({
  borderTop: `1px solid ${v.color.border.subtle}`,
  paddingTop: 10,
  display: "flex",
  flexDirection: "column",
  gap: 8,
});
export const footer = style([caption, { padding: "7px 16px 9px", minHeight: 32, flexShrink: 0 }]);
export const status = style([caption, { padding: "4px 16px", flexShrink: 0 }]);
export const error = style({
  padding: "8px 12px",
  color: v.color.status.critical,
  background: v.color.status.criticalSurface,
  fontSize: v.typography.size.label,
  overflowWrap: "anywhere",
});
export const empty = style({
  padding: "16px 0",
  display: "flex",
  flexDirection: "column",
  gap: 10,
  alignItems: "flex-start",
});
export const table = style({
  width: "100%",
  borderCollapse: "collapse",
  fontSize: v.typography.size.label,
});
globalStyle(`${table} th`, {
  textAlign: "left",
  fontWeight: 400,
  color: v.color.content.secondary,
  padding: "8px 4px",
});
globalStyle(`${table} td`, {
  padding: "8px 4px",
  borderBottom: `1px solid ${v.color.border.subtle}`,
  verticalAlign: "middle",
});
export const listSelect = style({ width: 132 });
export const dialog = style({
  width: "min(640px, calc(100vw - 32px))",
  maxHeight: "calc(100dvh - 32px)",
  fontSize: v.typography.size.body,
});
export const form = style({ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 });
export const fields = style({
  display: "grid",
  gridTemplateColumns: "repeat(2,minmax(0,1fr))",
  gap: "10px 16px",
  "@media": { "(max-width: 520px)": { gridTemplateColumns: "1fr" } },
});
export const field = style({
  display: "flex",
  flexDirection: "column",
  gap: 4,
  minWidth: 0,
  fontSize: v.typography.size.label,
});
export const short = style({ width: 80 });
export const preview = style([caption, { padding: "8px 10px", background: v.color.surface.muted }]);
export const templateLayout = style({
  display: "grid",
  gridTemplateColumns: "180px minmax(0,1fr)",
  gap: 16,
  "@media": { "(max-width: 650px)": { gridTemplateColumns: "140px minmax(0,1fr)" } },
});
export const category = style({
  display: "flex",
  flexDirection: "column",
  alignItems: "stretch",
  gap: 8,
});
export const categoryButton = style({
  textAlign: "left",
  justifyContent: "flex-start",
  selectors: {
    '&[aria-pressed="true"]': {
      background: v.color.selection.surface,
      color: v.color.content.accent,
    },
  },
});
const calendarFont = '-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif';
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
  gap: 8,
  paddingTop: 5,
});
export const calendarTitle = style({ fontSize: 22, fontWeight: 600, letterSpacing: "-0.03em" });
export const calendarNavigation = style({ display: "flex", alignItems: "center", gap: 0 });
export const viewSwitch = style({
  display: "flex",
  padding: 2,
  borderRadius: 7,
  background: `color-mix(in srgb, ${v.color.content.primary} 6%, transparent)`,
});
export const viewButton = style({
  border: 0,
  borderRadius: 5,
  padding: "4px 16px",
  cursor: "pointer",
  fontFamily: calendarFont,
  fontSize: 12,
  color: v.color.content.secondary,
  background: "transparent",
  selectors: {
    '&[aria-pressed="true"]': {
      background: v.color.surface.canvas,
      color: v.color.content.primary,
      boxShadow: "0 1px 3px #00000015",
    },
    "&:focus-visible": { outline: `2px solid ${v.color.interaction.focus}` },
  },
});
export const calendarLayout = style({
  display: "grid",
  gridTemplateColumns: "minmax(0,1fr) 220px",
  gap: 18,
  minHeight: 0,
  flex: 1,
  "@media": {
    "(max-width: 820px)": { gridTemplateColumns: "minmax(0,1fr) 180px", gap: 12 },
    "(max-width: 650px)": { gridTemplateColumns: "1fr", overflow: "auto" },
  },
});
export const calendarMain = style({
  minWidth: 0,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  overflow: "auto",
  gap: 8,
  paddingBottom: 8,
});
export const calendarFootnote = style([
  caption,
  {
    display: "flex",
    gap: "2px 14px",
    flexWrap: "wrap",
    flexShrink: 0,
    fontFamily: calendarFont,
    fontSize: 11,
    lineHeight: "16px",
    opacity: 0.8,
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
  borderTop: `1px solid ${v.color.border.subtle}`,
  borderLeft: `1px solid ${v.color.border.subtle}`,
  selectors: { "&:last-child": { borderBottom: `1px solid ${v.color.border.subtle}` } },
});
export const monthCell = style({
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  alignItems: "stretch",
  paddingBottom: 4,
  borderRight: `1px solid ${v.color.border.subtle}`,
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
  margin: "2px 4px",
  minWidth: 26,
  height: 26,
  padding: "0 4px",
  flexShrink: 0,
  border: 0,
  borderRadius: "50%",
  fontFamily: calendarFont,
  fontSize: 16,
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
    "&:hover": { background: v.color.selection.surface, color: v.color.content.primary },
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
  fontSize: 11,
  lineHeight: "26px",
  textAlign: "right",
  color: v.color.content.secondary,
  flexShrink: 0,
});
globalStyle(`${dayHead} > span`, { paddingRight: 10 });
export const allDayEvent = style({
  zIndex: 1,
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  gap: 4,
  alignSelf: "center",
  height: 22,
  margin: "1px 2px",
  padding: "0 5px",
  border: 0,
  borderRadius: 6,
  fontFamily: calendarFont,
  fontSize: 12,
  fontWeight: 500,
  lineHeight: "20px",
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
  gap: 4,
  minWidth: 0,
  minHeight: 23,
  margin: "0 2px",
  padding: "2px 3px",
  border: 0,
  borderRadius: 4,
  background: "transparent",
  color: v.color.content.primary,
  textAlign: "left",
  fontFamily: calendarFont,
  fontSize: 12,
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
  paddingLeft: 2,
  color: v.color.content.secondary,
  whiteSpace: "nowrap",
  fontSize: 10,
  fontVariantNumeric: "tabular-nums",
  flexShrink: 0,
});
export const agendaEvent = style([monthTimedEvent, { margin: 0, minHeight: 30, fontSize: 13 }]);
export const moreEvents = style({
  border: 0,
  background: "transparent",
  color: v.color.content.secondary,
  textAlign: "left",
  cursor: "pointer",
  fontFamily: calendarFont,
  fontSize: 10,
  padding: "3px 9px",
  selectors: { "&:focus-visible": { outline: `2px solid ${v.color.interaction.focus}` } },
});
export const weekScroll = style({ overflow: "auto", flex: 1, minHeight: 0, paddingBottom: 8 });
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
  paddingBottom: 8,
});
export const weekDate = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexDirection: "column",
  gap: 2,
  border: 0,
  borderRadius: 7,
  background: "transparent",
  color: v.color.content.primary,
  fontFamily: calendarFont,
  fontSize: 22,
  padding: "6px 0",
  cursor: "pointer",
  selectors: {
    '&[aria-pressed="true"]': { background: v.color.selection.surface },
    '&[aria-current="date"]': { color: v.color.status.critical, fontWeight: 600 },
    "&:focus-visible": { outline: `2px solid ${v.color.interaction.focus}`, outlineOffset: -2 },
  },
});
export const allDayLabel = style([
  caption,
  { paddingTop: 3, fontFamily: calendarFont, fontSize: 10 },
]);
export const weekAllDay = style({
  gridColumn: "2 / -1",
  display: "grid",
  gridTemplateColumns: "repeat(7,minmax(0,1fr))",
  paddingBottom: 10,
});
export const allDayCell = style({ borderLeft: `1px solid ${v.color.border.subtle}` });
export const timeColumn = style({
  position: "relative",
  fontSize: 10,
  color: v.color.content.secondary,
});
export const weekColumn = style({
  position: "relative",
  borderLeft: `1px solid ${v.color.border.subtle}`,
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
  gap: 2,
  padding: "3px 4px",
  textAlign: "left",
  border: 0,
  borderRadius: 4,
  color: eventInk,
  background: eventFill,
  fontFamily: calendarFont,
  fontSize: 12,
  overflow: "hidden",
  minHeight: 20,
  cursor: "pointer",
  borderLeft: "3px solid var(--calendar-color)",
  selectors: eventFocus,
});
export const weekEventTime = style({ fontSize: 10, lineHeight: "13px", opacity: 0.85 });
export const visuallyHidden = style({
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  overflow: "hidden",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
});

globalStyle(`${calendarEvent} > span`, { flexShrink: 0, lineHeight: "14px" });
