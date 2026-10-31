import { style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";
import { glass, tail } from "../conversation/conversation.css";

export const picker = style([
  glass,
  {
    width: 266,
    padding: "11px 14px 13px",
    borderRadius: 9,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
]);
export const pickerTail = style([
  tail,
  { top: -8, bottom: "auto", left: 44, transform: "rotate(225deg)" },
]);
export const swatches = style({
  display: "flex",
  alignItems: "center",
  gap: 8,
  paddingBottom: 8,
  borderBottom: `1px solid ${tokens["color/divider"]}`,
});
export const swatch = style({
  appearance: "none",
  width: 22,
  height: 22,
  padding: 0,
  border: 0,
  borderRadius: "50%",
  cursor: "pointer",
  flexShrink: 0,
  selectors: {
    "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 3 },
    '&[aria-pressed="true"]': { boxShadow: `0 0 0 2px ${tokens["color/ink"]}` },
  },
});
export const nativeColor = style({
  position: "absolute",
  inset: 0,
  width: 22,
  height: 22,
  padding: 0,
  border: 0,
  borderRadius: "50%",
  overflow: "hidden",
  background: "transparent",
  cursor: "pointer",
  opacity: 0,
  selectors: {
    "&::-webkit-color-swatch-wrapper": { padding: 0 },
    "&::-webkit-color-swatch": { border: 0, borderRadius: "50%" },
  },
});
export const moreColor = style({
  position: "relative",
  width: 22,
  height: 22,
  display: "grid",
  placeItems: "center",
  borderRadius: "50%",
  border: `1px solid ${tokens["color/selected-border"]}`,
  background: tokens["color/selected"],
  color: tokens["color/selected-icon"],
  flexShrink: 0,
  selectors: {
    "&:focus-within": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 3 },
  },
});
export const spectrum = style({
  position: "relative",
  height: 74,
  borderRadius: 10,
  touchAction: "none",
  backgroundImage:
    "linear-gradient(to top, black, transparent),linear-gradient(to right, white, transparent)",
  cursor: "crosshair",
  selectors: {
    "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 3 },
  },
});
export const spectrumCursor = style({
  position: "absolute",
  width: 14,
  height: 14,
  border: "2px solid white",
  boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
  borderRadius: "50%",
  transform: "translate(-50%,-50%)",
  pointerEvents: "none",
});
export const hue = style({
  appearance: "none",
  width: "100%",
  height: 10,
  margin: 0,
  borderRadius: 5,
  background: "linear-gradient(to right,red,#ff0,lime,cyan,blue,#f0f,red)",
  cursor: "pointer",
  selectors: {
    "&::-webkit-slider-thumb": {
      appearance: "none",
      width: 14,
      height: 14,
      border: "2px solid white",
      borderRadius: "50%",
      background: "transparent",
    },
    "&::-moz-range-thumb": {
      width: 10,
      height: 10,
      border: "2px solid white",
      borderRadius: "50%",
      background: "transparent",
    },
    "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 3 },
  },
});
export const hexRow = style({ display: "flex", alignItems: "center", gap: 8 });
export const hex = style({
  width: 0,
  flex: 1,
  minWidth: 0,
  background: tokens["color/input"],
  color: tokens["color/ink"],
  border: `1px solid ${tokens["color/input-border"]}`,
  borderRadius: 9,
  height: 28,
  padding: "0 10px",
  fontFamily: "inherit",
  fontSize: 13,
  selectors: {
    "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 2 },
  },
});
export const contextMenu = style([
  glass,
  { display: "flex", flexDirection: "column", gap: 0, width: 184, padding: 5, borderRadius: 9 },
]);
export const separator = style({
  height: 1,
  background: tokens["color/divider"],
  margin: "6px 10px",
});
export const notification = style([
  glass,
  {
    width: 290,
    borderRadius: 9,
    padding: 16,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    fontSize: 13,
    lineHeight: "18px",
  },
]);
export const notificationHeader = style({
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontWeight: 600,
  fontSize: 12,
  lineHeight: "16px",
});
export const notificationBody = style({
  fontSize: 12,
  lineHeight: "17px",
  color: tokens["color/ink-2"],
});
export const notificationActions = style({ display: "flex", gap: 8 });
export const notificationAction = style({ flex: 1, minWidth: 0 });
export const os = style({
  boxSizing: "border-box",
  width: 300,
  borderRadius: 9,
  padding: 12,
  background: tokens["color/component/os-notification-surface"],
  color: tokens["color/component/os-notification-ink"],
  boxShadow: `0 4px 12px -2px ${tokens["color/surface-shadow"]}`,
  border: `1px solid ${tokens["color/chip-border"]}`,
  fontFamily: tokens["typography/sans/body/fontFamily"],
  fontSize: 12,
  lineHeight: "16px",
  display: "flex",
  flexDirection: "column",
  gap: 8,
});
export const osMain = style({ display: "flex", alignItems: "flex-start", gap: 10 });
export const osIcon = style({
  width: 28,
  height: 28,
  borderRadius: 8,
  background: "white",
  display: "grid",
  placeItems: "center",
  flexShrink: 0,
});
export const osCopy = style({
  display: "flex",
  flexDirection: "column",
  gap: 4,
  flex: 1,
  minWidth: 0,
});
export const osTitle = style({ fontSize: 13, lineHeight: "18px", fontWeight: 600 });
export const osMeta = style({
  color: tokens["color/component/os-notification-meta"],
  fontSize: 11,
  lineHeight: "15px",
  whiteSpace: "nowrap",
});
export const osDescription = style({ color: tokens["color/component/os-notification-secondary"] });
export const osButton = style({
  appearance: "none",
  border: 0,
  borderRadius: 7,
  padding: "5px 8px",
  background: tokens["color/hover"],
  color: "inherit",
  fontFamily: "inherit",
  fontSize: 12,
  lineHeight: "16px",
  flex: 1,
  cursor: "pointer",
  selectors: {
    "&:hover": { background: tokens["color/chip"] },
    "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 2 },
  },
});
