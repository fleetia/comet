import { globalStyle, style, styleVariants } from "@vanilla-extract/css";
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
    gap: 12,
    width: 370,
    height: 56,
    padding: "0 16px",
    borderRadius: 20,
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
  stack: { height: 58, boxShadow: `inset 0 1px 0 ${tokens["color/surface-highlight"]}` },
  compact: { width: 340, height: 52 },
  editor: {
    height: 58,
    boxShadow: `inset 0 1px 0 ${tokens["color/surface-highlight"]}`,
    cursor: "grab",
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
  fontSize: 14,
  fontWeight: 600,
  lineHeight: "19px",
  overflow: "hidden",
  whiteSpace: "nowrap",
  textOverflow: "ellipsis",
});
export const rowClockTitle = style({
  fontFamily: tokens["typography/display/clock/fontFamily"],
  fontSize: 24,
  fontWeight: 400,
  lineHeight: "28px",
});
export const rowPeriod = style({
  marginLeft: 2,
  fontFamily: tokens["typography/sans/body/fontFamily"],
  fontSize: 12,
  lineHeight: "16px",
  color: tokens["color/ink-2"],
});
globalStyle(`${layouts.editor} ${rowTitle}`, { fontSize: 14, lineHeight: "19px" });
globalStyle(`${layouts.editor} ${rowClockTitle}`, { fontSize: 22, lineHeight: "26px" });
export const small = style({ color: tokens["color/ink-2"], fontSize: 11.5, lineHeight: "15px" });
// Row layouts have fixed heights; long summaries must not cover adjacent controls.
export const rowDescription = style([
  small,
  { overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" },
]);
export const rowValue = style({
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontFamily: tokens["typography/display/clock/fontFamily"],
  fontSize: 18,
  lineHeight: "22px",
  whiteSpace: "nowrap",
});
export const rowTextValue = style({
  fontFamily: tokens["typography/sans/body/fontFamily"],
  fontSize: 14,
  lineHeight: "19px",
  fontWeight: 600,
});
export const rowMeta = style({
  textAlign: "right",
  fontSize: 11,
  lineHeight: "14px",
  color: tokens["color/ink-2"],
});
globalStyle(`${rowMeta} strong`, {
  color: tokens["color/ink"],
  fontSize: 13.5,
  lineHeight: "18px",
  fontWeight: 600,
});
export const liveDot = style({
  display: "inline-block",
  width: 6,
  height: 6,
  borderRadius: "50%",
  background: tokens["color/live"],
  boxShadow: `0 0 8px ${tokens["color/live"]}`,
  marginRight: 6,
});
export const rowLiveDot = style([liveDot, { flexShrink: 0, width: 8, height: 8, marginRight: 0 }]);
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
export const digits = style({ display: "grid", placeItems: "center", padding: "12px 0" });
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
export const musicCard = style({
  width: 370,
  minHeight: 310,
  padding: "16px 18px",
  border: 0,
  borderRadius: 26,
  boxShadow: `inset 0 0 0 1px ${tokens["color/glass-border"]}, inset 0 1px 0 ${tokens["color/surface-highlight"]}, 0 22px 48px ${tokens["color/surface-shadow"]}`,
});
globalStyle(`${musicCard} > header`, { minHeight: 30 });
globalStyle(`${musicCard} > header h3`, {
  fontFamily: tokens["typography/display/label-display/fontFamily"],
  fontSize: 14,
  lineHeight: "19px",
});
globalStyle(`${musicCard} > header button`, { height: 30, lineHeight: "16px", fontSize: 12 });
export const musicSong = style({ minHeight: 64 });
export const musicCopy = style({
  display: "flex",
  flexDirection: "column",
  gap: 2,
  minWidth: 0,
  flex: 1,
});
export const musicTitle = style({
  fontFamily: tokens["typography/display/title-lg/fontFamily"],
  fontSize: 20,
  lineHeight: "25px",
  fontWeight: 400,
  overflowWrap: "anywhere",
});
export const musicArtist = style({
  fontSize: 13,
  lineHeight: "18px",
  color: tokens["color/ink-2"],
});
export const musicAlbum = style({ fontSize: 12, lineHeight: "16px", color: tokens["color/ink-3"] });
export const musicProgress = style({ display: "flex", flexDirection: "column", gap: 4 });
globalStyle(`${musicProgress} > progress`, { height: 4, borderRadius: 2 });
export const musicTimes = style({
  display: "flex",
  justifyContent: "space-between",
  gap: 8,
  fontSize: 11.5,
  lineHeight: "15px",
  color: tokens["color/ink-3"],
});
export const musicSource = style({
  textAlign: "center",
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});
export const musicActions = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
});
export const musicDiscuss = style({
  width: 145,
  height: 36,
  minHeight: 36,
  padding: "0 16px",
  gap: 7,
  fontSize: 13.5,
  lineHeight: "18px",
  border: 0,
  borderRadius: 17,
  background: tokens["color/card"],
  boxShadow: `inset 0 0 0 1px ${tokens["color/card-border"]}`,
});
export const musicLink = style({
  appearance: "none",
  border: 0,
  padding: 0,
  background: "transparent",
  color: tokens["color/cat-record"],
  fontFamily: "inherit",
  fontSize: 12.5,
  lineHeight: "17px",
  cursor: "pointer",
  whiteSpace: "nowrap",
  selectors: {
    "&:disabled": { cursor: "default", opacity: 0.45 },
    "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 3 },
  },
});
export const musicFooter = style({
  display: "flex",
  flexDirection: "column",
  gap: 12,
  paddingTop: 12,
  boxShadow: `inset 0 1px 0 ${tokens["color/divider"]}`,
});
export const musicShare = style({ display: "flex", alignItems: "center", gap: 12 });
export const musicShareCopy = style({
  display: "flex",
  flexDirection: "column",
  gap: 2,
  flex: 1,
  minWidth: 0,
  fontSize: 13,
  lineHeight: "18px",
});
globalStyle(`${musicShareCopy} > span`, {
  fontSize: 11.5,
  lineHeight: "16px",
  color: tokens["color/ink-3"],
});
export const musicDisclaimer = style({
  display: "flex",
  flexWrap: "wrap",
  alignItems: "baseline",
  fontSize: 12,
  lineHeight: "17px",
  color: tokens["color/ink-3"],
});
globalStyle(`${musicDisclaimer} > button`, { fontSize: 12 });
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
    boxSizing: "border-box",
    gap: 4,
    alignItems: "center",
    height: 52,
    padding: "8px",
    borderRadius: 25,
    width: "max-content",
    boxShadow: `inset 0 1px 0 ${tokens["color/surface-highlight"]}`,
  },
]);
export const summaryItem = style({
  display: "inline-flex",
  gap: 7,
  alignItems: "center",
  appearance: "none",
  border: 0,
  height: 36,
  borderRadius: 18,
  background: "transparent",
  color: "inherit",
  padding: "0 12px",
  fontFamily: "inherit",
  fontSize: 13,
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
export const customFreeformCopy = style({});
globalStyle(`${customFreeformCopy} *`, { color: "inherit !important" });
export const customFreeformPlacement = style({});
globalStyle(`${customFreeformPlacement} > div`, {
  alignItems: "inherit",
  justifyContent: "inherit",
});
export const darkArtworkCopy = style({ color: tokens["palette/night/별 하양"] });
export const artworkMuted = style({ color: tokens["palette/night/안개"] });
export const artworkFaint = style({ color: tokens["palette/night/먼 안개"] });
export const artworkAccent = style({ color: tokens["palette/night/민트"] });
export const musicFreeformCopy = style({ padding: "0 30px" });
export const musicFreeformSong = style({ width: "100%" });
export const musicFreeformCover = style({
  background: `color-mix(in srgb, ${tokens["palette/night/라벤더"]} 14%, transparent)`,
  color: tokens["palette/night/연라벤더"],
});
export const compactFreeform = style({
  position: "relative",
  padding: 0,
  border: 0,
  background: "transparent",
  color: tokens["color/ink-2"],
  font: "inherit",
  fontSize: tokens["typography/sans/caption/fontSize"],
  cursor: "pointer",
});
export const compactFreeformCopy = style({
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: tokens["spacing/space-8"],
});
export const clockTime = style({
  fontFamily: tokens["typography/display/clock/fontFamily"],
  fontSize: 46,
  lineHeight: "52px",
  whiteSpace: "nowrap",
});
export const clockTimeLong = style({ fontSize: 32, lineHeight: "38px" });
export const clockPeriod = style({
  fontSize: 12,
  lineHeight: "16px",
  color: tokens["palette/night/안개"],
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
export const counterDesktopCount = style({ fontSize: 28 });
export const countCaption = style({
  fontSize: tokens["typography/sans/meta/fontSize"],
  lineHeight: tokens["typography/sans/meta/lineHeight"],
  color: tokens["palette/widget/카운터 보조"],
});
export const memoCopy = style({
  alignItems: "flex-start",
  justifyContent: "flex-start",
  padding: "18px 20px",
  color: tokens["palette/widget/메모 잉크"],
  fontSize: 13,
  lineHeight: "20px",
  whiteSpace: "pre-wrap",
});
export const memoTitle = style({
  color: tokens["palette/widget/메모 제목"],
  fontSize: tokens["typography/sans/caption/fontSize"],
  lineHeight: tokens["typography/sans/caption/lineHeight"],
  fontWeight: 600,
  marginBottom: 6,
});
export const envelopeCopy = style({ color: tokens["palette/widget/봉투 잉크"] });
export const envelopeLabel = style({
  color: tokens["palette/widget/봉투 라벨"],
  fontSize: tokens["typography/sans/meta/fontSize"],
  lineHeight: tokens["typography/sans/meta/lineHeight"],
  fontWeight: 600,
});
export const envelopeTitle = style({ fontSize: 16, lineHeight: "21px" });
export const envelopeDate = style({
  color: tokens["palette/widget/봉투 날짜"],
  fontSize: tokens["typography/sans/meta/fontSize"],
  lineHeight: tokens["typography/sans/meta/lineHeight"],
});
export const envelopeCount = style({
  fontFamily: tokens["typography/display/clock/fontFamily"],
  fontSize: 22,
  lineHeight: "26px",
  paddingTop: tokens["spacing/space-6"],
});
export const weatherCopy = style({
  flexDirection: "row",
  padding: "52px 18px 10px",
  gap: 10,
  color: tokens["palette/day/낮 잉크"],
});
export const weatherCondition = style({ display: "flex", flexDirection: "column" });
export const weatherLocation = style({
  fontSize: tokens["typography/sans/meta/fontSize"],
  color: tokens["palette/day/낮 보조"],
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
