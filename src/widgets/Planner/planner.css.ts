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
export const calendarLayout = style({
  display: "grid",
  gridTemplateColumns: "minmax(0,1fr) 256px",
  gap: 16,
  minHeight: 0,
  flex: 1,
  "@media": { "(max-width: 780px)": { gridTemplateColumns: "minmax(0,1fr) 200px" } },
});
export const month = style({
  display: "grid",
  gridTemplateColumns: "repeat(7,minmax(0,1fr))",
  borderTop: `1px solid ${v.color.border.subtle}`,
  borderLeft: `1px solid ${v.color.border.subtle}`,
});
export const monthCell = style({
  minHeight: 80,
  padding: 4,
  border: 0,
  borderBottom: `1px solid ${v.color.border.subtle}`,
  borderRight: `1px solid ${v.color.border.subtle}`,
  textAlign: "left",
  font: "inherit",
  fontSize: v.typography.size.caption,
  color: "inherit",
  background: "transparent",
  display: "flex",
  flexDirection: "column",
  gap: 3,
  cursor: "pointer",
  minWidth: 0,
  selectors: {
    '&[aria-pressed="true"]': { background: v.color.selection.surface },
    '&[data-outside="true"]': { color: v.color.content.secondary },
    "&:focus-visible": { outline: `2px solid ${v.color.interaction.focus}`, outlineOffset: -2 },
  },
});
export const ellipsis = style({
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  maxWidth: "100%",
});
export const dayHead = style({
  display: "grid",
  gridTemplateColumns: "repeat(7,minmax(0,1fr))",
  fontSize: v.typography.size.caption,
  marginBottom: 6,
});
export const week = style({
  display: "grid",
  gridTemplateColumns: "36px repeat(7,minmax(0,1fr))",
  minWidth: 400,
});
export const timeColumn = style({
  position: "relative",
  height: 528,
  fontSize: v.typography.size.caption,
  color: v.color.content.secondary,
});
export const weekColumn = style({
  position: "relative",
  height: 528,
  borderLeft: `1px solid ${v.color.border.subtle}`,
  backgroundImage: `repeating-linear-gradient(to bottom, ${v.color.border.subtle} 0px, ${v.color.border.subtle} 1px, transparent 1px, transparent 44px)`,
});
export const time = style({ position: "absolute", left: 0, top: 0, transform: "translateY(-50%)" });
export const calendarEvent = style({
  position: "absolute",
  padding: "2px 3px",
  textAlign: "left",
  border: 0,
  color: v.color.content.primary,
  background: v.color.selection.surface,
  font: "inherit",
  fontSize: v.typography.size.caption,
  overflow: "hidden",
  minHeight: 18,
  cursor: "pointer",
  borderLeft: `2px solid ${v.color.content.accent}`,
  selectors: {
    '&[data-provider="apple"]': { background: v.color.status.positiveSurface },
    '&[aria-pressed="true"]': {
      outline: `1px solid ${v.color.selection.indicator}`,
      outlineOffset: -1,
    },
  },
});
export const allDay = style({
  minHeight: 24,
  fontSize: v.typography.size.caption,
  minWidth: 0,
  padding: 2,
  borderLeft: `1px solid ${v.color.border.subtle}`,
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
