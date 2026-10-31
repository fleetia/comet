import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const window = style({
  boxSizing: "border-box",
  height: "100dvh",
  padding: 6,
  background: "transparent",
  color: tokens["color/ink"],
  fontFamily: tokens["typography/sans/body/fontFamily"],
  fontSize: 13,
  lineHeight: "18px",
});
export const panel = style({
  display: "flex",
  flexDirection: "column",
  height: "100%",
  minHeight: 0,
  overflow: "hidden",
  borderRadius: 9,
  background: tokens["color/glass-window"],
  boxShadow: `inset 0 0 0 1px ${tokens["color/glass-border"]}, 0 4px 12px -2px ${tokens["color/surface-shadow"]}`,
  backdropFilter: tokens["backdrop/backdrop-panel"],
});
export const header = style({
  display: "flex",
  alignItems: "center",
  gap: 8,
  minHeight: 48,
  padding: "6px 10px 6px 18px",
  borderBottom: `1px solid ${tokens["color/divider"]}`,
  cursor: "grab",
});
globalStyle(`${header} h1`, {
  flex: 1,
  margin: 0,
  fontFamily: tokens["typography/display/title/fontFamily"],
  fontSize: 15,
  fontWeight: 400,
  lineHeight: "20px",
});
export const body = style({
  display: "grid",
  alignContent: "start",
  gap: 14,
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  overscrollBehavior: "contain",
  padding: "14px 16px",
});
export const section = style({ display: "grid", gap: 10, minWidth: 0 });
globalStyle(`${section} h2`, { margin: 0, fontSize: 13, fontWeight: 600 });
export const selection = style({ display: "flex", alignItems: "center", gap: 8 });
globalStyle(`${selection} strong`, { flex: 1, fontSize: 14, fontWeight: 600 });
export const hint = style({ margin: 0, color: tokens["color/ink-3"], fontSize: 12 });
export const options = style({ display: "grid", gap: 10 });
export const setting = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
});
export const anchors = style({
  display: "grid",
  gridTemplateColumns: "24px 24px",
  justifyContent: "space-between",
  alignContent: "space-between",
  width: 84,
  height: 54,
  padding: 5,
  border: `1px solid ${tokens["color/input-border"]}`,
  background: tokens["color/input"],
  borderRadius: 10,
});
globalStyle(`${anchors} button`, {
  width: 24,
  height: 15,
  border: `1px dashed ${tokens["color/ink-3"]}`,
  borderRadius: 5,
  padding: 0,
  background: "transparent",
  cursor: "pointer",
});
globalStyle(`${anchors} button[aria-pressed=true]`, {
  borderColor: "transparent",
  background: tokens["color/primary"],
});
export const more = style({
  borderTop: `1px solid ${tokens["color/divider"]}`,
  paddingTop: 8,
});
globalStyle(`${more} > summary`, {
  cursor: "pointer",
  marginBottom: 8,
  color: tokens["color/ink-2"],
  fontSize: 12.5,
});
export const addList = style({
  display: "grid",
  gap: 4,
  margin: 0,
  padding: 0,
  listStyle: "none",
});
globalStyle(`${addList} li`, {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  minHeight: 34,
});
globalStyle(`${addList} li > span`, { display: "flex", alignItems: "center", gap: 8 });
export const quiet = style({
  display: "flex",
  alignItems: "center",
  gap: 6,
  margin: 0,
  color: tokens["color/ink-3"],
  fontSize: 12,
});
export const error = style({ margin: 0, color: tokens["color/danger"], fontSize: 12 });
export const footer = style({
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
  padding: "10px 16px 14px",
  borderTop: `1px solid ${tokens["color/divider"]}`,
});
export const colors = style({
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 10,
});
globalStyle(`${colors} > div`, { minWidth: 0, margin: 0 });
export const widthField = style({
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
});
