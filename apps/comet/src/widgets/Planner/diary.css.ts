import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";
import settingsNight from "../../assets/figma/settings-night.svg";

export const window = style({
  height: "100dvh",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  color: tokens["color/ink"],
  background: tokens["color/glass-window"],
  backgroundImage: `url("${settingsNight}")`,
  backgroundSize: "cover",
  backgroundPosition: "center top",
  backgroundRepeat: "no-repeat",
  backdropFilter: tokens["backdrop/backdrop-window"],
  border: `1px solid ${tokens["color/glass-border"]}`,
  borderRadius: tokens["radius/radius-22"],
  boxSizing: "border-box",
  fontSize: tokens["typography/sans/body/fontSize"],
});
globalStyle(`${window} dialog::backdrop`, {
  borderRadius: tokens["radius/radius-22"],
});
export const header = style({
  flexShrink: 0,
  background: "transparent",
  borderBottom: `1px solid ${tokens["color/divider"]}`,
  padding: "0 18px",
  minHeight: 48,
});
export const layout = style({
  display: "grid",
  gridTemplateColumns: "96px minmax(0, 1fr)",
  flex: 1,
  minHeight: 0,
  overflow: "hidden",
  selectors: {
    '&[data-collection="true"]': {
      gridTemplateColumns: "96px 306px minmax(0, 1fr)",
      gridTemplateRows: "58px minmax(0,1fr)",
    },
  },
  "@media": {
    "(max-width: 820px)": {
      gridTemplateColumns: "80px minmax(0, 1fr)",
      selectors: {
        '&[data-collection="true"]': { gridTemplateColumns: "80px 236px minmax(0, 1fr)" },
      },
    },
  },
});
export const surface = style({
  minWidth: 0,
  minHeight: 0,
  background: tokens["color/card"],
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: tokens["radius/radius-18"],
});
export const notes = style({
  minWidth: 0,
  minHeight: 0,
  overflowY: "auto",
  padding: "22px 26px 24px",
  background: "transparent",
});
export const notesOpen = style({
  "@media": {
    "(max-width: 1080px)": {
      display: "block",
      position: "absolute",
      zIndex: 4,
      top: 60,
      left: 12,
      bottom: 12,
      width: 268,
      padding: 12,
      borderRadius: tokens["radius/radius-18"],
      background: tokens["color/glass-panel"],
      backdropFilter: tokens["backdrop/backdrop-panel"],
      border: `1px solid ${tokens["color/glass-border"]}`,
      boxShadow: `0 8px 32px ${tokens["color/surface-shadow"]}`,
    },
  },
});
export const index = style([
  surface,
  {
    margin: "16px 0 24px 26px",
    alignSelf: "start",
    maxHeight: "calc(100% - 40px)",
    gridColumn: 2,
    gridRow: 2,
    padding: "16px 12px 12px",
    overflowY: "auto",
    background: tokens["color/card-2"],
  },
]);
export const page = style({
  minWidth: 0,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  padding: "22px 26px 24px",
  gap: 16,
  background: "transparent",
  backdropFilter: "none",
  boxShadow: "none",
  border: 0,
  borderRadius: 0,
  selectors: { [`${layout}[data-collection="true"] &`]: { display: "contents" } },
  "@media": { "(max-width: 820px)": { padding: "16px" } },
});
export const body = style({
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  overflow: "auto",
  display: "flex",
  flexDirection: "column",
  gap: 16,
  selectors: {
    [`${layout}[data-collection="true"] &`]: {
      gridColumn: 3,
      gridRow: 2,
      margin: "16px 26px 24px 18px",
    },
  },
});
export const dropActive = style({
  outline: `2px solid ${tokens["color/ink"]}`,
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
    "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 1 },
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
export const pageHeading = style([toolbar, { flex: 1, minWidth: 0, flexWrap: "nowrap" }]);
export const pageSelect = style({ width: 200, maxWidth: "30vw", minWidth: 0 });
globalStyle(`${pageSelect} > span, ${pageSelect} select`, { width: "100%", minWidth: 0 });
export const spread = style({ flex: 1 });
export const title = style({
  fontFamily: tokens["typography/display/page/fontFamily"],
  fontSize: 26,
  lineHeight: "32px",
  fontWeight: 400,
  margin: 0,
});
globalStyle(`${pageHeading} > h1`, {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});
export const caption = style({
  color: tokens["color/ink-2"],
  fontSize: tokens["typography/sans/caption/fontSize"],
  lineHeight: "1.462",
});
export const section = style({
  marginTop: 20,
  paddingTop: 12,
  borderTop: `1px solid ${tokens["color/line"]}`,
  display: "flex",
  flexDirection: "column",
});
export const sectionTitle = style({
  fontWeight: 600,
  marginBottom: 8,
  fontSize: tokens["typography/sans/body/fontSize"],
});
export const navItem = style({
  width: "100%",
  border: 0,
  borderRadius: tokens["radius/radius-10"],
  minHeight: 56,
  padding: "10px",
  background: "transparent",
  color: tokens["color/ink"],
  font: "inherit",
  lineHeight: "1.4",
  textAlign: "left",
  cursor: "pointer",
  overflowWrap: "anywhere",
  selectors: {
    '&[aria-current="page"]': {
      background: tokens["color/selected"],
      color: tokens["color/selected-ink"],
      boxShadow: `inset 0 0 0 1px ${tokens["color/selected-border"]}`,
      borderRadius: tokens["radius/radius-10"],
    },
    "&:hover:not([aria-current=page])": { background: tokens["color/hover"] },
    "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: -2 },
  },
});
globalStyle(`${navItem}[aria-current="page"] ${caption}`, { color: "inherit", opacity: 0.8 });
export const toolContent = style({
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  gap: 20,
  selectors: { "&[hidden]": { display: "none" } },
});
export const viewSwitch = style({
  display: "flex",
  gap: 3,
  padding: 3,
  alignItems: "center",
  background: tokens["color/card"],
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: tokens["radius/radius-pill"],
});
export const viewButton = style([
  navItem,
  {
    width: "auto",
    minWidth: 64,
    minHeight: 32,
    padding: "7px 16px",
    border: 0,
    borderRadius: tokens["radius/radius-pill"],
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
export const miniTitle = style({ fontSize: tokens["typography/display/title-sm/fontSize"], fontWeight: 500 });
export const miniActions = style({ display: "flex", gap: 0 });
export const miniGrid = style({
  display: "grid",
  gridTemplateColumns: "repeat(7,minmax(0,1fr))",
  rowGap: 8,
  textAlign: "center",
  fontSize: tokens["typography/sans/caption/fontSize"],
});
export const miniWeekday = style([caption, { padding: "4px 0" }]);
export const miniDay = style({
  position: "relative",
  border: 0,
  borderRadius: tokens["radius/radius-9"],
  width: 28,
  height: 28,
  margin: "0 auto",
  background: "transparent",
  color: "inherit",
  font: "inherit",
  cursor: "pointer",
  selectors: {
    '&[aria-current="date"]': {
      background: tokens["color/component/primary-alpha-80"],
      color: tokens["color/ink"],
    },
    '&[aria-pressed="true"]:not([aria-current="date"])': {
      color: tokens["color/selected-ink"],
      background: tokens["color/selected"],
    },
    '&[data-outside="true"]:not([aria-pressed="true"])': { color: tokens["color/ink-2"] },
    '&:hover:not([aria-pressed="true"]):not([aria-current="date"])': {
      background: tokens["color/card-2"],
    },
    "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 1 },
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
  color: tokens["color/danger"],
  padding: "8px 16px",
  flexShrink: 0,
  fontSize: tokens["typography/sans/body/fontSize"],
});
export const status = style([caption, { padding: "4px 16px", flexShrink: 0 }]);
export const agendaEventButton = style({
  height: "auto",
  minHeight: tokens["size/control-36"],
  paddingBlock: tokens["spacing/space-8"],
  justifyContent: "flex-start",
  whiteSpace: "normal",
  textAlign: "left",
  overflowWrap: "anywhere",
});
export const form = style({ display: "flex", flexDirection: "column", gap: 12 });
export const weekday = style({
  display: "grid",
  gridTemplateColumns: "repeat(7,minmax(0,1fr))",
  textAlign: "center",
  color: tokens["color/ink-2"],
  paddingBottom: 12,
  flexShrink: 0,
  fontSize: tokens["typography/sans/caption/fontSize"],
});
export const calendar = style({
  minWidth: 520,
  minHeight: 620,
  display: "flex",
  flexDirection: "column",
  flex: "1 0 auto",
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: tokens["radius/radius-22"],
  overflow: "hidden",
  background: tokens["color/card-2"],
});
export const monthWeek = style({
  display: "grid",
  gridTemplateColumns: "repeat(7,minmax(0,1fr))",
  flex: "1 0 auto",
  minHeight: 100,
  borderTop: `1px solid ${tokens["color/line"]}`,
  borderLeft: `1px solid ${tokens["color/line"]}`,
  selectors: { "&:last-child": { borderBottom: `1px solid ${tokens["color/line"]}` } },
});
export const cell = style({
  minWidth: 0,
  position: "relative",
  zIndex: 0,
  alignSelf: "stretch",
  border: 0,
  borderRight: `1px solid ${tokens["color/line"]}`,
  borderRadius: 0,
  padding: 0,
  background: "transparent",
  color: "inherit",
  font: "inherit",
  textAlign: "left",
  cursor: "pointer",
  selectors: {
    '&[data-outside="true"]': {
      background: tokens["color/card-2"],
      color: tokens["color/ink-2"],
    },
    "&:hover": { background: tokens["color/card-2"] },
    "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: -2 },
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
  borderRadius: tokens["radius/radius-9"],
  fontSize: tokens["typography/sans/caption/fontSize"],
  selectors: {
    '&[data-today="true"]': {
      background: tokens["color/component/primary-alpha-80"],
      color: tokens["color/ink"],
    },
    '&[data-selected="true"]:not([data-today="true"])': {
      boxShadow: `inset 0 0 0 1px ${tokens["color/input-border"]}`,
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
  fontSize: tokens["typography/sans/caption/fontSize"],
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
    "&:hover": { background: tokens["color/card-2"] },
    "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: -1 },
  },
});
export const recordCount = style([calendarRow, { color: tokens["color/ink-2"] }]);
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
  borderRadius: tokens["radius/radius-9"],
  background: tokens["color/component/cat-rest-alpha-80"],
  margin: "1px 6px",
  height: 26,
  alignSelf: "center",
});
export const allDayTitle = style([
  calendarRow,
  { flex: 1, padding: "3px 8px", borderRadius: tokens["radius/radius-9"] },
]);
export const today = style({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  background: tokens["color/component/primary-alpha-80"],
  color: tokens["color/ink"],
  borderRadius: 12,
  padding: "4px 14px",
  fontSize: tokens["typography/sans/caption/fontSize"],
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
    fontSize: tokens["typography/display/title-sm/fontSize"],
    fontWeight: 500,
    borderRadius: 0,
    padding: "0 0 16px",
    minHeight: 44,
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
  borderRadius: tokens["radius/radius-12"],
  padding: 12,
  background: tokens["color/card-2"],
  color: tokens["color/ink"],
  textAlign: "left",
  font: "inherit",
  cursor: "pointer",
  selectors: {
    "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 2 },
  },
});
export const legend = style([
  caption,
  { display: "flex", flexWrap: "wrap", gap: 14, flexShrink: 0, paddingTop: 0 },
]);
globalStyle(`${window} button`, { maxWidth: "100%" });
globalStyle(`${window} input, ${window} select`, { minWidth: 0 });

export const rail = style({
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 4,
  height: "100%",
  overflowY: "auto",
  padding: "18px 10px",
  background: tokens["color/rail"],
  borderRight: `1px solid ${tokens["color/card-border"]}`,
  selectors: { [`${layout}[data-collection="true"] &`]: { gridRow: "1 / -1", gridColumn: 1 } },
});
export const railHeader = style({ height: 10, minHeight: 10, width: "100%", marginBottom: 14 });
globalStyle(`${railHeader} > div`, {
  minHeight: 10,
  height: 10,
  justifyContent: "center",
  gap: 0,
});
globalStyle(`${railHeader} [aria-label="창 제어"]`, { gap: 6 });
globalStyle(`${railHeader} [aria-label="창 제어"] > button`, {
  width: 10,
  minWidth: 10,
  height: 10,
});
globalStyle(`${railHeader} > div > div:empty`, { display: "none" });
export const railDivider = style({ height: 12, flexShrink: 0 });
export const pageNavigation = style({
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 16,
  minHeight: 36,
  flexShrink: 0,
  selectors: {
    "&[hidden]": { display: "none" },
    [`${layout}[data-collection="true"] &`]: {
      gridColumn: "2 / -1",
      gridRow: 1,
      margin: "22px 26px 0",
    },
  },
});
export const todayLayout = style({
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 340px",
  gap: 18,
  minHeight: 0,
  flex: 1,
  "@media": {
    "(max-width: 1100px)": { gridTemplateColumns: "minmax(0, 1fr) 280px" },
    "(max-width: 850px)": { gridTemplateColumns: "minmax(0, 1fr)" },
  },
});
export const todayRing = style({
  alignSelf: "start",
});
export const todaySummary = style({
  display: "flex",
  flexDirection: "column",
  gap: 12,
  minWidth: 0,
});
export const todayJournal = style({
  minWidth: 0,
  padding: 16,
  borderRadius: tokens["radius/radius-18"],
  background: tokens["color/card-2"],
  border: `1px solid ${tokens["color/card-border"]}`,
});
export const summaryCard = style({
  padding: 16,
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: tokens["radius/radius-18"],
  background: tokens["color/card-2"],
});
export const summaryTitle = style({ fontSize: 13, fontWeight: 600, marginBottom: 12 });
export const summaryEvent = style({
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "8px 0",
  border: 0,
  background: "transparent",
  color: tokens["color/ink"],
  cursor: "pointer",
  font: "inherit",
  textAlign: "left",
  width: "100%",
});

export const weekWorkspace = style({
  display: "flex",
  flexDirection: "column",
  gap: 24,
  minWidth: 0,
});
