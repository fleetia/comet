import { globalStyle, style, styleVariants } from "@vanilla-extract/css";
import { tokens } from "@comet/token";
import { stateTransition } from "../motion/motion.css";

export const glass = style({
  position: "relative",
  boxSizing: "border-box",
  color: tokens["color/ink"],
  fontFamily: tokens["typography/sans/body/fontFamily"],
  background: tokens["color/glass-panel"],
  border: `1px solid ${tokens["color/glass-border"]}`,
  backdropFilter: "blur(12px)",
  boxShadow: `inset 0 1px 0 ${tokens["color/surface-highlight"]}`,
});
globalStyle(`${glass} *, ${glass} *::before, ${glass} *::after`, { boxSizing: "border-box" });
export const balloon = style([
  glass,
  {
    width: 230,
    minHeight: 78,
    padding: "16px 18px",
    borderRadius: tokens["radius/radius-22"],
  },
]);
export const balloonContent = style({ width: 290 });
export const balloonTyping = style({ width: 240, minHeight: 81 });
export const speaker = style({
  display: "block",
  fontSize: 12,
  lineHeight: "16px",
  fontWeight: 600,
  marginBottom: 8,
});
export const speakers = styleVariants({
  byulkkori: { color: tokens["color/byul-ink"] },
  nadir: { color: tokens["color/nadir-ink"] },
  "moon-rabbit": { color: tokens["color/moon-ink"] },
});
export const speech = style({
  fontSize: 14,
  lineHeight: "20px",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
});
export const speechTrigger = style({
  display: "block",
  width: "100%",
  padding: 0,
  border: 0,
  background: "transparent",
  color: "inherit",
  fontFamily: "inherit",
  textAlign: "left",
  cursor: "pointer",
  selectors: {
    "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 3 },
    "&:disabled": { cursor: "default" },
  },
});
export const typingSpeech = style({ fontSize: 16, lineHeight: "23px" });
export const caret = style({
  display: "inline-block",
  width: 1.4,
  height: 19,
  marginLeft: 1.4,
  verticalAlign: -4,
  background: tokens["color/ink"],
});
export const tail = style({
  position: "absolute",
  width: 16,
  height: 16,
  bottom: -9,
  transform: "rotate(45deg)",
  background: tokens["color/glass-panel"],
  backdropFilter: "blur(12px)",
  borderRight: `1px solid ${tokens["color/glass-border"]}`,
  borderBottom: `1px solid ${tokens["color/glass-border"]}`,
});
export const tails = styleVariants({
  left: { left: 30 },
  center: { left: "calc(50% - 8px)" },
  right: { right: 22 },
});
export const actions = style({ display: "flex", gap: 8, marginTop: 10 });
export const result = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  marginTop: 8,
  minHeight: 46,
  padding: "11px 13px",
  borderRadius: 14,
  background: tokens["color/card"],
  border: `1px solid ${tokens["color/card-border"]}`,
  color: tokens["color/ink-2"],
  fontSize: 12,
  lineHeight: "18px",
});
export const capsule = style([
  glass,
  {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: 290,
    minHeight: 50,
    padding: "7px 8px 7px 18px",
    borderRadius: 25,
    borderColor: tokens["color/capsule-border"],
  },
]);
export const capsuleForms = styleVariants({
  single: {},
  multiline: { minHeight: 62, borderRadius: 22 },
  large: {
    width: 340,
    minHeight: 54,
    paddingLeft: 20,
    borderRadius: 27,
    background: tokens["color/glass-capsule"],
  },
});
export const input = style({
  flex: 1,
  width: 0,
  minWidth: 0,
  resize: "none",
  padding: 0,
  margin: 0,
  border: 0,
  outline: "none",
  background: "transparent",
  color: tokens["color/ink"],
  fontFamily: "inherit",
  fontSize: 14,
  lineHeight: "20px",
  selectors: { "&::placeholder": { color: tokens["color/ink-3"] } },
});
export const inputLarge = style({
  fontSize: tokens["typography/display/title-sm/fontSize"],
  lineHeight: "normal",
});
export const send = style([
  stateTransition,
  {
    appearance: "none",
    border: 0,
    width: 34,
    height: 34,
    flexShrink: 0,
    display: "grid",
    placeItems: "center",
    borderRadius: "50%",
    background: tokens["color/primary"],
    color: tokens["color/on-primary"],
    cursor: "pointer",
    selectors: {
      "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 3 },
      "&:disabled": { cursor: "default" },
    },
  },
]);
export const sendLarge = style({
  width: 38,
  height: 38,
  background: tokens["color/cat-record"],
});
export const sendCompact = style({ width: 32, height: 32 });
export const choice = style([
  stateTransition,
  {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    boxSizing: "border-box",
    minHeight: 38,
    padding: "7.5px 15px 7.5px 11px",
    appearance: "none",
    color: tokens["color/ink"],
    fontFamily: tokens["typography/sans/body/fontFamily"],
    fontSize: 14,
    lineHeight: "21px",
    border: `1px solid ${tokens["color/star-border"]}`,
    borderRadius: 18,
    background: tokens["color/glass-pill"],
    backdropFilter: "blur(8px)",
    boxShadow: `0 8px 20px ${tokens["color/component/surface-shadow-alpha-240"]}`,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    maxWidth: "100%",
    textAlign: "left",
    cursor: "pointer",
    selectors: {
      "&:hover:not(:disabled)": { background: tokens["color/selected"] },
      "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 3 },
    },
  },
]);
export const choiceSelected = style({
  borderColor: tokens["color/selected-border"],
  background: tokens["color/selected"],
  color: tokens["color/selected-ink"],
});
export const fading = style({ opacity: 0.3, cursor: "default" });
export const choiceIcon = style({
  width: 15,
  height: 15,
  flexShrink: 0,
  display: "flex",
  alignItems: "flex-start",
  backgroundColor: tokens["color/spark"],
  maskSize: "11.25px 11.25px",
  maskPosition: "left top",
  maskRepeat: "no-repeat",
});
export const choiceLabel = style({ minWidth: 0 });
export const choices = style({
  position: "relative",
  width: 340,
  display: "flex",
  flexDirection: "column",
  gap: 20,
  paddingTop: 30,
  paddingBottom: 10,
  boxSizing: "border-box",
});
export const choiceLine = style({ position: "absolute", top: 0, left: 0, pointerEvents: "none" });
export const standardChoiceLine = style([
  choiceLine,
  {
    width: 340,
    height: 196,
    // The SVG mask already supplies 0.45 alpha; the theme token owns the final opacity.
    backgroundColor: `rgb(from ${tokens["color/star-line"]} r g b / calc(alpha / 0.45))`,
    maskSize: "100% 100%",
    maskRepeat: "no-repeat",
  },
]);
export const dynamicLine = style({
  fill: "none",
  stroke: tokens["color/star-line"],
  strokeWidth: 1,
  strokeDasharray: "2 6",
});
export const choiceRow = style({
  position: "relative",
  display: "flex",
  alignItems: "flex-start",
  selectors: {
    "&:nth-of-type(even)": { paddingLeft: 152 },
    '&[data-position="2"]': { paddingLeft: 36, marginTop: 2 },
  },
});
