import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const card = style({
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "column",
  gap: 10,
  width: 290,
  maxWidth: "100%",
  padding: "14px 16px",
  borderRadius: tokens["radius/radius-22"],
  border: 0,
  background: tokens["color/glass-panel"],
  backdropFilter: tokens["backdrop/backdrop-panel"],
  boxShadow: `inset 0 0 0 1px ${tokens["color/glass-border"]}, inset 0 1px 0 ${tokens["color/surface-highlight"]}, 0 22px 48px ${tokens["color/surface-shadow"]}`,
});
export const header = style({ display: "flex", alignItems: "center", gap: 8, minWidth: 0 });
export const heading = style({
  flex: 1,
  margin: 0,
  fontFamily: tokens["typography/display/title/fontFamily"],
  fontSize: 13.5,
  fontWeight: 400,
  lineHeight: "18px",
  color: tokens["color/ink-2"],
  whiteSpace: "nowrap",
});
export const characterField = style({ width: 100, flex: "0 0 100px", minWidth: 0 });
globalStyle(`${characterField} > span, ${characterField} > span > span`, {
  width: "100%",
  minWidth: 0,
});
export const icon = style({ color: tokens["color/cat-record"] });
export const characterSelect = style({
  width: "100%",
  maxWidth: 100,
  minWidth: 0,
  height: 24,
  padding: "0 20px 0 8px",
  borderRadius: tokens["radius/radius-12"],
  fontSize: 12,
});
export const metrics = style({ display: "flex", alignItems: "center", gap: 14 });
export const portrait = style({
  display: "grid",
  placeItems: "center",
  width: 70,
  height: 70,
  flexShrink: 0,
  borderRadius: "50%",
  background: `radial-gradient(circle, ${tokens["color/icon-tile"]}, transparent 72%)`,
});
globalStyle(`${portrait} img`, { maxWidth: 56, maxHeight: 56, objectFit: "contain" });
export const counters = style({
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  flex: 1,
  gap: 10,
});
export const counter = style({ display: "flex", flexDirection: "column", gap: 1 });
export const caption = style({ color: tokens["color/ink-3"], fontSize: 11.5, lineHeight: "15px" });
export const value = style({
  color: tokens["color/ink"],
  fontFamily: tokens["typography/display/title/fontFamily"],
  fontSize: 20,
  lineHeight: "24px",
  fontWeight: 400,
});
export const actions = style({ display: "flex", gap: 6, width: "100%" });
globalStyle(`${actions} > button`, {
  flex: 1,
  minWidth: 0,
  height: 30,
  paddingInline: 5,
  gap: 6,
  fontSize: 12,
  lineHeight: "18px",
  whiteSpace: "nowrap",
});
globalStyle(`${actions} > button svg`, { width: 13, height: 13, flexShrink: 0 });
export const refill = style({
  alignSelf: "flex-start",
  height: 24,
  minHeight: 24,
  lineHeight: "18px",
});
export const games = style({ display: "grid", gap: 26, justifyItems: "center" });
export const game = style({ width: 290, maxWidth: "100%" });
export const balloon = style({ width: "100%", maxWidth: 290 });
export const companion = style({ display: "flex", padding: "20px 0 0 24px" });
globalStyle(`${companion} > span`, { width: 64, height: 64, borderRadius: 19, fontSize: 13 });
globalStyle(`${companion} > span > span`, {
  width: 64,
  height: 64,
  borderRadius: 19,
  fontSize: 13,
});
globalStyle(`${companion} img`, { maxWidth: 64, maxHeight: 64 });
export const playFace = style({ width: 64, height: 64, borderRadius: 19, fontSize: 13 });
export const play = style({
  display: "flex",
  flexDirection: "column",
  width: 290,
  maxWidth: "100%",
  gap: 0,
});
export const playHeader = style({
  display: "flex",
  alignItems: "center",
  alignSelf: "flex-start",
  gap: 6,
  marginBottom: 14,
  padding: "3px 10px",
  border: `1px solid ${tokens["color/chip-border"]}`,
  background: tokens["color/chip"],
  borderRadius: 14,
});
export const playTarget = style({ maxWidth: 112, minWidth: 0 });
globalStyle(`${playTarget} select`, {
  width: "auto",
  minWidth: 0,
  maxWidth: 112,
  height: 24,
  padding: "0 24px 0 0",
  border: 0,
  background: "transparent",
  fontSize: 12,
});
export const gameActions = style({ display: "flex", width: "100%", gap: 8 });
globalStyle(`${gameActions} > button`, { flex: 1, minWidth: 0, height: 30, whiteSpace: "nowrap" });
export const orbit = style({ position: "relative", width: 290, height: 212 });
export const orbitLine = style({
  position: "absolute",
  width: 172,
  height: 172,
  left: 59,
  top: 34,
  borderRadius: "50%",
  border: `1px dotted ${tokens["color/glass-border"]}`,
});
export const orbitCore = style({
  position: "absolute",
  left: 118,
  top: 110,
  display: "flex",
  flexDirection: "column",
  gap: 6,
  alignItems: "center",
  color: tokens["color/primary"],
  fontSize: 12,
});
export const orbitChoice = style({
  position: "absolute",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 6,
  width: 64,
  padding: 0,
  border: 0,
  background: "transparent",
  color: tokens["color/ink-2"],
  fontFamily: "inherit",
  fontSize: 11,
  cursor: "pointer",
  ":focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 4 },
});
export const native = style({
  position: "relative",
  display: "flex",
  justifyContent: "center",
  alignItems: "flex-end",
  width: "100%",
  minHeight: "100dvh",
  padding: "18px 20px 20px",
  background: "transparent",
  color: tokens["color/ink"],
  fontFamily: tokens["typography/sans/body/fontFamily"],
});
export const nativeBody = style({ border: 0, margin: 0, padding: 0, minWidth: 0 });
export const close = style({ position: "absolute", top: 0, right: 0, opacity: 0.45 });
export const error = style({
  position: "absolute",
  bottom: 2,
  left: 8,
  right: 8,
  margin: 0,
  fontSize: 11,
  color: tokens["color/danger"],
});
export const toys = style({ width: 290, maxWidth: "100%", display: "grid", gap: 10 });
export const toyScene = style({
  position: "relative",
  width: 290,
  height: 236,
});
export const trail = style({ position: "absolute", top: 0, left: 0, pointerEvents: "none" });
const toyLabel = style({
  position: "absolute",
  padding: "3px 10px",
  border: `1px solid ${tokens["color/chip-border"]}`,
  borderRadius: 12,
  background: tokens["color/chip"],
  color: tokens["color/ink-2"],
  fontSize: 12,
  lineHeight: "16px",
  whiteSpace: "nowrap",
});
export const planeLabel = style([toyLabel, { top: 2, left: 4 }]);
export const bubbleLabel = style([toyLabel, { top: 84, left: 120 }]);
export const ballLabel = style([toyLabel, { top: 194, left: 132 }]);
export const launchToy = style({
  position: "absolute",
  padding: 0,
  border: 0,
  background: "transparent",
  cursor: "grab",
  ":focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 4 },
});
export const smallBubble = style({
  position: "absolute",
  left: -22,
  top: 14,
  pointerEvents: "none",
});
export const tinyBubble = style({
  position: "absolute",
  left: 36,
  top: -18,
  pointerEvents: "none",
});
export const toyFooter = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  fontSize: 11,
  color: tokens["color/ink-2"],
});
export const dice = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 18,
  marginTop: 8,
  padding: "8px 0 2px",
});
export const die = style({
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 4,
});
export const dieValue = style({
  display: "grid",
  placeItems: "center",
  width: 34,
  height: 34,
  borderRadius: 8,
  background: tokens["color/ink"],
  color: tokens["color/check-ink"],
  fontSize: 22,
});
export const result = style({
  margin: "8px 0 0",
  whiteSpace: "pre-wrap",
  fontSize: 14,
  lineHeight: "20px",
});
export const fortuneDraw = style({ width: 24, height: 24, minHeight: 24, padding: 0 });
export const fortuneBalloon = style([
  balloon,
  {
    minHeight: 168,
    border: 0,
    boxShadow: `inset 0 0 0 1px ${tokens["color/glass-border"]}, inset 0 1px 0 ${tokens["color/surface-highlight"]}, 0 22px 48px ${tokens["color/surface-shadow"]}`,
  },
]);
export const fortuneCopy = style({ display: "grid", gap: 8 });
export const fortuneIntro = style({ margin: 0 });
export const fortune = style({
  display: "flex",
  gap: 8,
  minHeight: 60,
  padding: "10px 12px",
  boxShadow: `inset 0 0 0 1px ${tokens["color/card-border"]}`,
  borderRadius: tokens["radius/radius-14"],
  background: tokens["color/card"],
});
export const fortuneIcon = style({
  flexShrink: 0,
  color: tokens["color/cat-record"],
  marginTop: 1,
});
export const fortuneText = style({
  flex: 1,
  minWidth: 0,
  margin: 0,
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
});
export const fortuneNote = style({
  margin: 0,
  color: tokens["color/ink-3"],
  fontSize: 12,
  lineHeight: "16px",
});
export const note = style({
  margin: "8px 0 0",
  color: tokens["color/ink-3"],
  fontSize: 12,
  lineHeight: "16px",
});
