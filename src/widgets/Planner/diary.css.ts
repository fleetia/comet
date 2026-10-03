import { globalStyle, style } from "@vanilla-extract/css";
import { semanticVars as v, componentVars, vnextVars } from "@fleetia/lagrange/theme";

export const window = style({
  height: "100dvh",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  color: v.color.content.primary,
  background: v.color.surface.canvas,
  fontSize: v.typography.size.body,
});
export const header = style({
  flexShrink: 0,
  background: v.color.surface.raised,
  padding: "0 16px",
  minHeight: 40,
});
export const layout = style({
  display: "grid",
  gridTemplateColumns: "244px 244px minmax(0, 1fr)",
  gap: 16,
  padding: 16,
  flex: 1,
  minHeight: 0,
  "@media": {
    "(max-width: 1400px)": {
      gridTemplateColumns: "184px 220px minmax(0,1fr)",
      gap: 12,
      padding: 12,
    },
    "(max-width: 1080px)": { gridTemplateColumns: "220px minmax(0,1fr)" },
    "(max-width: 780px)": { gridTemplateColumns: "180px minmax(0,1fr)", gap: 8, padding: 8 },
  },
});
export const surface = style({
  minWidth: 0,
  minHeight: 0,
  background: v.color.surface.raised,
  borderRadius: vnextVars.radius.parent,
});
export const notes = style({
  minWidth: 0,
  minHeight: 0,
  overflowY: "auto",
  background: "transparent",
  "@media": { "(max-width: 1080px)": { display: "none" } },
});
export const notesOpen = style({
  "@media": {
    "(max-width: 1080px)": {
      display: "block",
      position: "absolute",
      zIndex: 4,
      top: 56,
      left: 12,
      bottom: 12,
      width: 268,
      padding: 12,
      borderRadius: vnextVars.radius.parent,
      background: v.color.surface.raised,
      border: `1px solid ${v.color.border.subtle}`,
      boxShadow: "0 8px 32px #10101520",
    },
  },
});
export const notesToggle = style({
  display: "none",
  "@media": { "(max-width: 1080px)": { display: "inline-flex" } },
});
export const index = style([surface, { padding: 12, overflowY: "auto" }]);
export const page = style([
  surface,
  {
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    padding: 24,
    gap: 20,
    "@media": { "(max-width: 1120px)": { padding: 16 } },
  },
]);
export const body = style({
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  overflow: "auto",
  display: "flex",
  flexDirection: "column",
  gap: 16,
});
export const dropActive = style({
  outline: `2px solid ${v.color.content.primary}`,
  outlineOffset: -2,
});
export const dateButton = style({
  background: "transparent",
  border: 0,
  padding: 0,
  color: "inherit",
  font: "inherit",
  cursor: "pointer",
  selectors: {
    "&:focus-visible": { outline: `2px solid ${v.color.interaction.focus}`, outlineOffset: 1 },
  },
});
export const tools = style({ flex: 1, minHeight: 0, overflow: "hidden" });
export const toolbar = style({
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 8,
  flexShrink: 0,
});
export const spread = style({ flex: 1 });
export const title = style({
  fontSize: v.typography.size.headingMd,
  lineHeight: v.typography.lineHeight.tight,
  fontWeight: 600,
  margin: 0,
});
export const indexTitle = style({
  fontSize: v.typography.size.headingSm,
  lineHeight: v.typography.lineHeight.compact,
  fontWeight: 600,
  margin: "0 0 18px",
});
export const caption = style({
  color: v.color.content.secondary,
  fontSize: v.typography.size.caption,
  lineHeight: v.typography.lineHeight.body,
});
export const section = style({
  marginTop: 20,
  paddingTop: 12,
  borderTop: `1px solid ${v.color.border.subtle}`,
  display: "flex",
  flexDirection: "column",
});
export const sectionTitle = style({
  fontWeight: 600,
  marginBottom: 8,
  fontSize: v.typography.size.label,
});
export const navItem = style({
  width: "100%",
  border: 0,
  borderBottom: `1px solid ${v.color.border.subtle}`,
  borderRadius: 0,
  minHeight: 56,
  padding: "9px 8px",
  background: "transparent",
  color: v.color.content.primary,
  font: "inherit",
  lineHeight: "1.4",
  textAlign: "left",
  cursor: "pointer",
  overflowWrap: "anywhere",
  selectors: {
    '&[aria-current="page"]': {
      background: componentVars.navigation.selectedSurface,
      color: componentVars.navigation.selectedText,
      borderRadius: vnextVars.radius.control,
      borderBottomColor: "transparent",
    },
    "&:hover:not([aria-current=page])": { background: v.color.surface.muted },
    "&:focus-visible": { outline: `2px solid ${v.color.interaction.focus}`, outlineOffset: -2 },
  },
});
globalStyle(`${navItem}[aria-current="page"] ${caption}`, { color: "inherit", opacity: 0.8 });
export const toolMenu = style({
  display: "flex",
  flexDirection: "column",
  gap: 2,
  marginTop: 16,
  paddingTop: 12,
  borderTop: `1px solid ${v.color.border.subtle}`,
});
export const toolMenuItem = style([navItem, { minHeight: 36, borderBottom: 0, padding: "8px" }]);
export const toolContent = style({
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  gap: 20,
  selectors: { "&[hidden]": { display: "none" } },
});
export const viewSwitch = style({ display: "flex", gap: 0, alignItems: "center" });
export const viewButton = style([
  navItem,
  {
    width: "auto",
    minWidth: 64,
    minHeight: 32,
    padding: "7px 16px",
    border: 0,
    borderRadius: vnextVars.radius.control,
    textAlign: "center",
  },
]);
export const miniHead = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 4,
  marginBottom: 10,
});
export const miniTitle = style({ fontSize: v.typography.size.headingSm, fontWeight: 500 });
export const miniActions = style({ display: "flex", gap: 0 });
export const miniGrid = style({
  display: "grid",
  gridTemplateColumns: "repeat(7,minmax(0,1fr))",
  rowGap: 8,
  textAlign: "center",
  fontSize: v.typography.size.caption,
});
export const miniWeekday = style([caption, { padding: "4px 0" }]);
export const miniDay = style({
  position: "relative",
  border: 0,
  borderRadius: vnextVars.radius.control,
  width: 28,
  height: 28,
  margin: "0 auto",
  background: "transparent",
  color: "inherit",
  font: "inherit",
  cursor: "pointer",
  selectors: {
    '&[aria-current="date"]': {
      background: vnextVars.surface.accent,
      color: v.color.content.primary,
    },
    '&[aria-pressed="true"]:not([aria-current="date"])': {
      color: componentVars.navigation.selectedText,
      background: componentVars.navigation.selectedSurface,
    },
    '&[data-outside="true"]:not([aria-pressed="true"])': { color: v.color.content.secondary },
    '&:hover:not([aria-pressed="true"]):not([aria-current="date"])': {
      background: v.color.surface.muted,
    },
    "&:focus-visible": { outline: `2px solid ${v.color.interaction.focus}`, outlineOffset: 1 },
  },
});
export const recordDot = style({
  display: "block",
  position: "absolute",
  bottom: 2,
  left: "calc(50% - 1px)",
  width: 2,
  height: 2,
  borderRadius: "50%",
  background: "currentColor",
});
export const error = style({
  color: v.color.status.critical,
  padding: "8px 16px",
  flexShrink: 0,
  fontSize: v.typography.size.label,
});
export const status = style([caption, { padding: "4px 16px", flexShrink: 0 }]);
export const form = style({ display: "flex", flexDirection: "column", gap: 12 });
export const weekday = style({
  display: "grid",
  gridTemplateColumns: "repeat(7,minmax(0,1fr))",
  textAlign: "center",
  color: v.color.content.secondary,
  paddingBottom: 12,
  flexShrink: 0,
  fontSize: v.typography.size.caption,
});
export const calendar = style({
  minWidth: 520,
  minHeight: 536,
  display: "flex",
  flexDirection: "column",
  flex: "1 0 auto",
});
export const monthWeek = style({
  display: "grid",
  gridTemplateColumns: "repeat(7,minmax(0,1fr))",
  flex: "1 0 auto",
  minHeight: 100,
  borderTop: `1px solid ${v.color.border.subtle}`,
  borderLeft: `1px solid ${v.color.border.subtle}`,
  selectors: { "&:last-child": { borderBottom: `1px solid ${v.color.border.subtle}` } },
});
export const cell = style({
  minWidth: 0,
  position: "relative",
  zIndex: 0,
  alignSelf: "stretch",
  border: 0,
  borderRight: `1px solid ${v.color.border.subtle}`,
  borderRadius: 0,
  padding: 0,
  background: "transparent",
  color: "inherit",
  font: "inherit",
  textAlign: "left",
  cursor: "pointer",
  selectors: {
    '&[data-outside="true"]': {
      background: v.color.surface.muted,
      color: v.color.content.secondary,
    },
    "&:hover": { background: v.color.surface.muted },
    "&:focus-visible": { outline: `2px solid ${v.color.interaction.focus}`, outlineOffset: -2 },
  },
});
export const date = style({
  position: "absolute",
  top: 7,
  left: 8,
  display: "grid",
  placeItems: "center",
  minWidth: 26,
  height: 25,
  borderRadius: vnextVars.radius.control,
  fontSize: v.typography.size.caption,
  selectors: {
    '&[data-today="true"]': {
      background: vnextVars.surface.accent,
      color: v.color.content.primary,
    },
    '&[data-selected="true"]:not([data-today="true"])': {
      boxShadow: `inset 0 0 0 1px ${v.color.border.strong}`,
    },
  },
});
export const cellRows = style({
  minWidth: 0,
  zIndex: 1,
  padding: "3px 5px 8px",
  display: "flex",
  flexDirection: "column",
  gap: 1,
  pointerEvents: "none",
});
export const calendarRow = style({
  border: 0,
  background: "transparent",
  color: "inherit",
  font: "inherit",
  fontSize: v.typography.size.caption,
  textAlign: "left",
  padding: "3px 3px",
  lineHeight: 1.5,
  minWidth: 0,
  width: "100%",
  cursor: "pointer",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  borderRadius: 4,
  pointerEvents: "auto",
  selectors: {
    "&:hover": { background: v.color.surface.muted },
    "&:focus-visible": { outline: `2px solid ${v.color.interaction.focus}`, outlineOffset: -1 },
  },
});
export const recordCount = style([calendarRow, { color: v.color.content.secondary }]);
export const eventRow = style({
  display: "flex",
  alignItems: "center",
  minWidth: 0,
  borderLeft: "2px solid transparent",
});
export const envelopeLink = style([
  calendarRow,
  { width: 23, minWidth: 23, flexShrink: 0, textAlign: "center" },
]);
export const allDay = style({
  zIndex: 2,
  display: "flex",
  alignItems: "center",
  minWidth: 0,
  borderRadius: vnextVars.radius.control,
  background: v.color.surface.muted,
  margin: "1px 6px",
  height: 26,
  alignSelf: "center",
});
export const allDayTitle = style([
  calendarRow,
  { flex: 1, padding: "3px 8px", borderRadius: vnextVars.radius.control },
]);
export const today = style({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  background: vnextVars.surface.accent,
  color: v.color.content.primary,
  borderRadius: 12,
  padding: "4px 14px",
  fontSize: v.typography.size.caption,
  fontWeight: 400,
  lineHeight: "16px",
});
export const week = style({
  display: "grid",
  gridTemplateColumns: "repeat(2,minmax(0,1fr))",
  gridTemplateRows: "repeat(4,minmax(150px,1fr))",
  gap: "0 24px",
  flex: "1 0 auto",
  minHeight: 620,
  "@media": {
    "(max-width: 580px)": { gridTemplateColumns: "minmax(0,1fr)", gridTemplateRows: "none" },
  },
});
export const weekDay = style({ minWidth: 0, minHeight: 150, padding: "0 0 16px" });
export const weekTitle = style([
  calendarRow,
  {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: v.typography.size.headingSm,
    fontWeight: 500,
    borderRadius: 0,
    padding: "0 0 16px",
    minHeight: 44,
    borderBottom: `1px solid ${v.color.border.subtle}`,
  },
]);
export const weekContent = style({ paddingTop: 8 });
export const excerpt = style([
  caption,
  {
    whiteSpace: "pre-wrap",
    margin: 0,
    display: "-webkit-box",
    WebkitLineClamp: 3,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
]);
export const weekNote = style([
  calendarRow,
  excerpt,
  { marginTop: 8, textOverflow: "clip", padding: "3px 0" },
]);
export const weekReflection = style({
  alignSelf: "start",
  display: "flex",
  flexDirection: "column",
  gap: 12,
  minWidth: 0,
  minHeight: 140,
  width: "100%",
  border: 0,
  borderRadius: vnextVars.radius.inset,
  padding: 12,
  background: v.color.surface.muted,
  color: v.color.content.primary,
  textAlign: "left",
  font: "inherit",
  cursor: "pointer",
  selectors: {
    "&:focus-visible": { outline: `2px solid ${v.color.interaction.focus}`, outlineOffset: 2 },
  },
});
export const legend = style([
  caption,
  { display: "flex", flexWrap: "wrap", gap: 14, flexShrink: 0, paddingTop: 0 },
]);
globalStyle(`${window} button`, { maxWidth: "100%" });
globalStyle(`${window} input, ${window} select`, { minWidth: 0 });
