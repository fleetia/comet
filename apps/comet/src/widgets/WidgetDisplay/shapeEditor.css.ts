import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";
export const editor = style({
  display: "flex",
  flexDirection: "column",
  gap: 12,
  minWidth: 0,
  border: 0,
  margin: 0,
  padding: 0,
  color: tokens["color/ink-2"],
  fontFamily: tokens["typography/sans/body/fontFamily"],
  fontSize: 12.5,
  lineHeight: "18px",
});
export const tabs = style({ boxSizing: "border-box", width: "100%", flexShrink: 0 });
globalStyle(`${tabs} > label`, { flex: "1 1 0", minWidth: 0, paddingInline: 8 });
export const presets = style({ display: "grid", gap: 12 });
export const group = style({
  display: "grid",
  gap: 5,
  fontSize: 12,
  lineHeight: "16px",
  color: tokens["color/ink-3"],
});
export const grid = style({
  display: "grid",
  gridTemplateColumns: "repeat(6, 38px)",
});
export const customShapes = style({ display: "flex", gap: 8 });
export const choice = style({
  boxSizing: "border-box",
  width: 38,
  height: 38,
  display: "grid",
  placeItems: "center",
  padding: 0,
  background: tokens["color/card"],
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: 11,
  color: tokens["color/ink-2"],
  cursor: "pointer",
  selectors: {
    '&[aria-pressed="true"]': {
      color: tokens["color/selected-icon"],
      border: `1.5px solid ${tokens["color/selected-border"]}`,
      background: tokens["color/component/selected-icon-alpha-140"],
    },
    "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 2 },
    "&:disabled": { cursor: "not-allowed", opacity: 0.45 },
  },
});
export const addShape = style({
  width: 38,
  height: 38,
  border: `1.5px solid ${tokens["color/ink-3"]}`,
  borderRadius: 11,
  color: tokens["color/ink-2"],
});
export const divider = style({
  height: 1,
  flexShrink: 0,
  background: tokens["color/divider"],
});
export const tuning = style({ display: "grid", gap: 6 });
export const tuningTitle = style({
  margin: 0,
  color: tokens["color/ink"],
  fontFamily: tokens["typography/display/title-sm/fontFamily"],
  fontSize: 13.5,
  fontWeight: 400,
  lineHeight: "18px",
});
export const row = style({
  display: "flex",
  alignItems: "center",
  gap: 10,
  minHeight: 32,
  minWidth: 0,
});
globalStyle(`${row} > span:first-child`, { width: 66, flexShrink: 0 });
export const range = style({
  display: "flex",
  alignItems: "center",
  gap: 10,
  flex: 1,
  minWidth: 0,
});
globalStyle(`${range} > span:first-child`, { flex: 1, minWidth: 0 });
globalStyle(`${range} input`, { width: "100%" });
export const rangeValue = style({
  width: 38,
  flexShrink: 0,
  textAlign: "right",
  color: tokens["color/ink"],
});
export const flips = style({ display: "flex", gap: 10 });
export const flip = style({
  width: 79,
  height: 30,
  gap: 7,
  padding: "0 16px",
  borderRadius: 14,
  fontSize: 13.5,
  lineHeight: "20px",
});
export const footer = style({
  display: "flex",
  alignItems: "center",
  gap: 8,
  height: 32,
  minWidth: 0,
});
globalStyle(`${footer} > span:first-child`, { flex: 1, minWidth: 0 });
globalStyle(`${footer} label`, { height: 32, fontSize: 12.5, lineHeight: "18px" });
export const pointLink = style({ fontSize: 12.5, lineHeight: "18px" });
export const canvas = style({
  boxSizing: "border-box",
  width: "100%",
  aspectRatio: "1.5",
  background: tokens["color/card"],
  border: `1px dashed ${tokens["color/chip-border"]}`,
  borderRadius: 12,
  touchAction: "none",
  cursor: "crosshair",
  color: tokens["color/document-glass-probe"],
});
export const drawing = style({ display: "grid", gap: 8, fontSize: 12 });
globalStyle(`${drawing} p`, { margin: 0 });
export const actions = style({ display: "flex", gap: 4, flexWrap: "wrap" });
export const size = style({ display: "flex", alignItems: "center", gap: 6 });
export const image = style({
  maxWidth: "100%",
  height: 100,
  objectFit: "contain",
  borderRadius: 10,
});
