import { style, styleVariants } from "@vanilla-extract/css";
import { tokens } from "@comet/token";
import { glass } from "../conversation/conversation.css";
import { stateTransition } from "../motion/motion.css";

export const row = style([
  glass,
  stateTransition,
  {
    appearance: "none",
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: 370,
    height: 56,
    padding: "0 16px",
    borderRadius: 18,
    textAlign: "left",
    fontSize: 13,
    lineHeight: "18px",
    cursor: "pointer",
    selectors: {
      "&:hover:not(:disabled)": { background: tokens["color/hover"] },
      "&:active:not(:disabled)": { transform: "scale(0.98)" },
      "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 3 },
      "&:disabled": { opacity: 0.4, cursor: "not-allowed" },
    },
  },
]);
export const layouts = styleVariants({
  row: {},
  stack: { height: 58 },
  compact: { width: 340, height: 52 },
  editor: {
    height: 58,
    borderColor: "transparent",
    background: "transparent",
    boxShadow: "none",
    backdropFilter: "none",
  },
  desktop: { height: 56 },
  flow: { width: 310, height: 56 },
});
export const surfaces = styleVariants({
  translucent: {},
  plain: {
    background: "transparent",
    borderColor: "transparent",
    boxShadow: "none",
    backdropFilter: "none",
  },
  glow: {
    background: `linear-gradient(135deg, ${tokens["palette/day/물빛"]}, ${tokens["palette/day/먼 산"]})`,
    color: tokens["palette/day/낮 잉크"],
    boxShadow: `inset 0 1px 0 ${tokens["color/window-highlight"]}`,
  },
});
export const active = style({ borderColor: tokens["color/selected-border"] });
export const rest = style({ color: tokens["color/byul-ink"] });
export const rowCopy = style({ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 });
export const rowTitle = style({
  fontSize: 12,
  fontWeight: 600,
  lineHeight: "16px",
  overflow: "hidden",
  whiteSpace: "nowrap",
  textOverflow: "ellipsis",
});
export const rowClockTitle = style({
  fontFamily: tokens["typography/display/clock/fontFamily"],
  fontSize: 20,
  fontWeight: 400,
  lineHeight: "24px",
});
export const small = style({ color: tokens["color/ink-3"], fontSize: 11, lineHeight: "14px" });
export const rowValue = style({
  fontFamily: tokens["typography/display/clock/fontFamily"],
  fontSize: 18,
  lineHeight: "24px",
  whiteSpace: "nowrap",
});
export const rowMeta = style({ textAlign: "right", fontSize: 11, lineHeight: "14px" });
export const liveDot = style({
  display: "inline-block",
  width: 6,
  height: 6,
  borderRadius: "50%",
  background: tokens["color/live"],
  boxShadow: `0 0 8px ${tokens["color/live"]}`,
  marginRight: 6,
});
export const panel = style([
  glass,
  {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    width: 310,
    padding: 16,
    borderRadius: 22,
    fontSize: 13,
    lineHeight: "18px",
  },
]);
export const panelHeader = style({
  display: "flex",
  alignItems: "center",
  gap: 8,
  color: tokens["color/ink-2"],
  minHeight: 26,
});
export const headerIcon = style({ color: tokens["color/primary"] });
export const panelTitle = style({
  flex: 1,
  fontSize: 13,
  fontWeight: 400,
  lineHeight: "18px",
  margin: 0,
});
export const minorButton = style([
  stateTransition,
  {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    appearance: "none",
    padding: "3px 10px",
    border: `1px solid ${tokens["color/chip-border"]}`,
    borderRadius: 14,
    background: tokens["color/chip"],
    color: tokens["color/ink-2"],
    fontFamily: "inherit",
    fontSize: 12,
    lineHeight: "18px",
    cursor: "pointer",
    selectors: {
      "&:hover:not(:disabled)": { background: tokens["color/hover"] },
      "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 2 },
      "&:disabled": { opacity: 0.45 },
    },
  },
]);
export const footer = style({
  borderTop: `1px solid ${tokens["color/divider"]}`,
  paddingTop: 10,
  color: tokens["color/ink-3"],
  fontSize: 11,
  lineHeight: "16px",
});
export const stack = style({ display: "flex", flexDirection: "column", gap: 8 });
export const actions = style({ display: "flex", gap: 8, alignItems: "center" });
export const stretch = style({ flex: 1 });
export const task = style({
  fontFamily: tokens["typography/display/title/fontFamily"],
  fontSize: 17,
  lineHeight: "22px",
  overflowWrap: "anywhere",
});
export const ring = style({
  position: "relative",
  width: 160,
  height: 160,
  alignSelf: "center",
  display: "grid",
  placeItems: "center",
});
export const ringSvg = style({ position: "absolute", inset: 0, transform: "rotate(-90deg)" });
export const ringCopy = style({
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 2,
  color: tokens["color/ink"],
});
export const timer = style({
  fontFamily: tokens["typography/display/clock/fontFamily"],
  fontSize: 36,
  lineHeight: "44px",
  fontVariantNumeric: "tabular-nums",
});
export const durations = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-around",
  gap: 4,
  borderRadius: 16,
  background: tokens["color/chip"],
  padding: 3,
});
export const duration = style({
  appearance: "none",
  border: 0,
  borderRadius: 12,
  padding: "3px 9px",
  fontFamily: "inherit",
  fontSize: 11,
  lineHeight: "16px",
  color: tokens["color/ink-2"],
  background: "transparent",
  cursor: "pointer",
  selectors: {
    '&[aria-pressed="true"]': {
      background: tokens["color/primary"],
      color: tokens["color/on-primary"],
      fontWeight: 600,
    },
    "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}` },
  },
});
export const completed = style({
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 6,
  textAlign: "center",
  padding: "8px 0",
});
export const completionIcon = style({
  display: "grid",
  placeItems: "center",
  width: 82,
  height: 82,
  borderRadius: "50%",
  border: `6px solid ${tokens["color/live"]}`,
  color: tokens["color/live"],
  marginBottom: 12,
});
export const restartIcon = style({
  borderColor: tokens["color/primary"],
  color: tokens["color/primary"],
});
export const note = style({
  width: "100%",
  background: tokens["color/input"],
  color: tokens["color/ink"],
  fontFamily: "inherit",
  fontSize: 12,
  lineHeight: "18px",
  border: `1px solid ${tokens["color/input-border"]}`,
  borderRadius: 8,
  padding: "5px 9px",
  selectors: { "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}` } },
});
export const cover = style({
  display: "grid",
  placeItems: "center",
  width: 64,
  height: 64,
  borderRadius: 14,
  background: tokens["color/icon-tile"],
  color: tokens["color/icon-tile-ink"],
  flexShrink: 0,
  overflow: "hidden",
});
export const song = style({ display: "flex", gap: 14, alignItems: "center" });
export const songTitle = style({ fontWeight: 600, fontSize: 16, lineHeight: "21px" });
export const progress = style({
  appearance: "none",
  width: "100%",
  height: 5,
  border: 0,
  borderRadius: 3,
  overflow: "hidden",
  background: tokens["color/chip"],
  accentColor: tokens["color/byul-ink"],
  selectors: {
    "&::-webkit-progress-bar": { background: tokens["color/chip"] },
    "&::-webkit-progress-value": { background: tokens["color/byul-ink"] },
    "&::-moz-progress-bar": { background: tokens["color/byul-ink"] },
  },
});
export const envelopeTask = style({
  padding: "7px 0",
  borderBottom: `1px solid ${tokens["color/divider"]}`,
});
export const summary = style([
  glass,
  {
    display: "inline-flex",
    gap: 8,
    alignItems: "center",
    minHeight: 52,
    padding: "5px 12px",
    borderRadius: 26,
    width: "max-content",
  },
]);
export const summaryItem = style({
  display: "inline-flex",
  gap: 7,
  alignItems: "center",
  appearance: "none",
  border: 0,
  borderRadius: 22,
  background: "transparent",
  color: "inherit",
  padding: "10px 8px",
  fontFamily: "inherit",
  fontSize: 12,
  lineHeight: "18px",
  whiteSpace: "nowrap",
  cursor: "pointer",
  selectors: {
    '&[aria-pressed="true"]': {
      background: tokens["color/selected"],
      color: tokens["color/selected-ink"],
    },
    "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}` },
  },
});
export const freeform = style({
  position: "relative",
  flexShrink: 0,
  fontFamily: tokens["typography/sans/body/fontFamily"],
  color: tokens["color/ink"],
});
export const asset = style({ position: "absolute", top: 0, left: 0, pointerEvents: "none" });
export const freeformContent = style({
  position: "absolute",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 2,
  fontSize: 12,
  lineHeight: "16px",
});
export const darkArtworkCopy = style({ color: tokens["palette/night/별 하양"] });
export const clockTime = style({
  fontFamily: tokens["typography/display/clock/fontFamily"],
  fontSize: 46,
  lineHeight: "52px",
});
export const clockBadge = style({
  marginTop: 4,
  padding: "3px 10px",
  borderRadius: 11,
  background: tokens["color/component/primary-alpha-160"],
  color: tokens["palette/night/연한 별빛"],
  fontWeight: 600,
});
export const counter = style({ color: tokens["palette/night/밤 잉크"] });
export const count = style({
  fontFamily: tokens["typography/display/clock/fontFamily"],
  fontSize: 30,
  lineHeight: "34px",
});
export const countCaption = style({ fontSize: 11.5, lineHeight: "15px", color: "#3b2c78" });
export const memoCopy = style({
  alignItems: "flex-start",
  justifyContent: "flex-start",
  padding: "18px 20px",
  color: "#3a3000",
  fontSize: 13,
  lineHeight: "20px",
  whiteSpace: "pre-wrap",
});
export const memoTitle = style({
  color: "#6b5300",
  fontSize: 12,
  lineHeight: "16px",
  fontWeight: 600,
  marginBottom: 6,
});
export const envelopeCopy = style({ color: "#2b2620" });
export const envelopeLabel = style({
  color: "#8a3b1e",
  fontSize: 11.5,
  lineHeight: "15px",
  fontWeight: 600,
});
export const weatherCopy = style({
  flexDirection: "row",
  padding: "52px 18px 10px",
  gap: 10,
  color: tokens["palette/day/낮 잉크"],
});
export const weatherTemperature = style({
  fontFamily: tokens["typography/display/clock/fontFamily"],
  fontSize: 32,
  lineHeight: "36px",
});
export const picker = style({
  display: "flex",
  flexDirection: "column",
  padding: 0,
  margin: 0,
  border: `1px solid ${tokens["color/chip-border"]}`,
  borderRadius: 14,
  overflow: "hidden",
});
export const pickerOption = style({
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "9px 12px",
  cursor: "pointer",
  selectors: { "&:has(input:checked)": { background: tokens["color/selected"] } },
});
export const nativeRadio = style({ accentColor: tokens["color/primary"], margin: 0 });
