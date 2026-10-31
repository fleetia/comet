import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";
export const root = style({ display: "grid", gap: 10, minWidth: 0 });
export const heading = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  minHeight: 32,
});
export const settings = style({ display: "grid", gap: 14 });
globalStyle(`${heading} h2, ${settings} h2`, {
  margin: 0,
  fontFamily: tokens["typography/display/label-display/fontFamily"],
  color: tokens["color/ink-2"],
  fontWeight: 400,
  fontSize: 14,
  lineHeight: "18px",
});
export const list = style({
  outline: `1px solid ${tokens["color/card-border"]}`,
  outlineOffset: -1,
  borderRadius: 18,
  background: tokens["color/card"],
  overflow: "hidden",
  selectors: { "&:empty": { display: "none" } },
});
export const item = style({
  selectors: { "& + &": { borderTop: `1px solid ${tokens["color/divider"]}` } },
});
export const row = style({
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "10px 14px",
  minHeight: 60,
  boxSizing: "border-box",
  minWidth: 0,
});
export const icon = style({
  width: 34,
  height: 34,
  borderRadius: 17,
  flexShrink: 0,
  display: "grid",
  placeItems: "center",
  background: tokens["color/icon-tile"],
  color: tokens["color/icon-tile-ink"],
});
export const identity = style({ flex: 1, minWidth: 0 });
export const nameRow = style({ display: "flex", alignItems: "center", gap: 8 });
globalStyle(`${nameRow} h3`, {
  margin: 0,
  fontSize: 14,
  lineHeight: "19px",
  fontWeight: 600,
  overflowWrap: "anywhere",
});
export const date = style({
  margin: "2px 0 0",
  fontSize: 12,
  lineHeight: "16px",
  color: tokens["color/ink-3"],
});
export const countdown = style({
  color: tokens["color/comet"],
  fontFamily: tokens["typography/display/clock/fontFamily"],
  fontSize: 16,
  whiteSpace: "nowrap",
});
export const badge = style({
  padding: "2px 10px",
  borderRadius: 12,
  background: tokens["color/selected"],
  border: `1px solid ${tokens["color/selected-border"]}`,
  fontSize: 12,
  lineHeight: "18px",
  color: tokens["color/comet"],
  whiteSpace: "nowrap",
  maxWidth: "100%",
  overflow: "hidden",
  textOverflow: "ellipsis",
});
export const form = style({
  containerType: "inline-size",
  display: "flex",
  flexDirection: "column",
  gap: 10,
  padding: "14px 16px",
  borderRadius: 16,
  background: `linear-gradient(${tokens["color/card-2"]}, ${tokens["color/card-2"]}), ${tokens["color/document-accent-soft-10"]}`,
  outline: `1px solid ${tokens["color/card-border"]}`,
  outlineOffset: -1,
  border: 0,
  boxShadow: `0 4px 12px -2px ${tokens["color/component/surface-shadow-alpha-400"]}, 0 0 0 4px ${tokens["color/document-accent-soft-10"]}`,
  margin: "0 10px 10px",
  minWidth: 0,
  minHeight: 217,
  boxSizing: "border-box",
});
export const editorTop = style({
  display: "grid",
  alignItems: "center",
  gap: 10,
  gridTemplateColumns: "52px 180px 68px 71px 63px 67px",
  minWidth: 0,
  color: tokens["color/ink-2"],
  fontSize: 13,
  "@media": {
    "(max-width: 1100px)": {
      gridTemplateColumns: "52px minmax(0,1fr) 71px 63px 67px",
    },
  },
});
export const titleField = style({ minWidth: 0 });
export const dateLabel = style({
  paddingLeft: 16,
  "@media": { "(max-width: 1100px)": { display: "none" } },
});
export const countRow = style({
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 10,
  minWidth: 0,
  color: tokens["color/ink-2"],
  fontSize: 13,
});
globalStyle(`${countRow} > span:first-child`, { width: 52, flexShrink: 0 });
globalStyle(`${countRow} > [role="radiogroup"]`, { flexShrink: 0 });
export const exampleLabel = style({
  marginLeft: "auto",
  color: tokens["color/ink-3"],
  fontSize: 12,
  whiteSpace: "nowrap",
});
export const options = style({
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 20,
  borderTop: `1px solid ${tokens["color/divider"]}`,
});
globalStyle(`${options} > div`, { padding: "10px 0", minHeight: 56, border: 0 });
export const actions = style({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 });
globalStyle(`${actions} > button`, {
  flexShrink: 0,
  whiteSpace: "nowrap",
  height: 34,
  minHeight: 34,
  padding: "0 12px",
  borderRadius: 16,
  fontSize: 13.5,
});
export const deleteAction = style({});
export const cancelAction = style({});
export const saveAction = style({});
globalStyle(`${actions} > ${deleteAction}`, {
  width: 101,
  border: `1px solid ${tokens["color/danger-border"]}`,
  background: "transparent",
  gap: 7,
});
globalStyle(`${actions} > ${cancelAction}`, { width: 57 });
globalStyle(`${actions} > ${saveAction}`, {
  width: 65,
  height: 32,
  minHeight: 32,
  padding: "0 12px",
  fontSize: 14,
});
export const spacer = style({ flex: 1 });
export const caption = style({
  margin: 0,
  color: tokens["color/ink-3"],
  fontSize: 12,
  lineHeight: "17px",
});
export const time = style({
  fontFamily: tokens["typography/display/clock/fontFamily"],
  fontSize: 46,
  lineHeight: "50px",
});

globalStyle(`${settings} > ${list} > div`, { minHeight: 48, padding: "7px 14px" });
globalStyle(`${editorTop} select`, {
  minWidth: 0,
  width: "100%",
  padding: "0 22px 0 10px",
  height: 34,
});
globalStyle(`${editorTop} input`, { height: 34, minHeight: 34 });
globalStyle(`${settings} > ${list} > div:first-child`, { borderTop: 0 });
globalStyle(`${nameRow} ${badge}`, {
  padding: "0 8px",
  border: 0,
  outline: `1px solid ${tokens["color/selected-border"]}`,
  outlineOffset: -1,
  fontSize: 11.5,
  lineHeight: "20px",
});
globalStyle(`${item} + ${item}`, {
  borderTop: 0,
  boxShadow: `inset 0 1px ${tokens["color/divider"]}`,
});

// The editor also lives in narrow standalone widget windows and settings columns.
globalStyle(`${form} ${editorTop}`, {
  "@container": {
    "(max-width: 480px)": {
      gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    },
  },
});
globalStyle(`${form} ${editorTop} > label`, {
  "@container": { "(max-width: 480px)": { gridColumn: "1 / -1" } },
});
globalStyle(`${form} ${titleField}`, {
  "@container": { "(max-width: 480px)": { gridColumn: "1 / -1" } },
});
globalStyle(`${form} ${dateLabel}`, {
  "@container": { "(max-width: 480px)": { display: "none" } },
});
globalStyle(`${form} ${options}`, {
  "@container": { "(max-width: 480px)": { gridTemplateColumns: "minmax(0, 1fr)", gap: 0 } },
});
