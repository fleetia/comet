import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";
import * as windowHeader from "../WindowHeader/windowHeader.css";

export const window = style({
  display: "flex",
  flexDirection: "column",
  width: "100%",
  height: "100dvh",
  background: tokens["color/glass-window"],
  color: tokens["color/ink"],
});
export const header = style({
  flexShrink: 0,
  height: 60,
  padding: "0 20px",
  boxSizing: "border-box",
  borderBottom: `1px solid ${tokens["color/card-border"]}`,
});
globalStyle(`.${header} .${windowHeader.title}`, {
  display: "flex",
  alignItems: "center",
  flex: "0 0 auto",
});
globalStyle(`.${header} .${windowHeader.actions}`, {
  flex: 1,
  minWidth: 0,
});
export const windowTitle = style({
  color: tokens["color/ink"],
  fontSize: 13,
  whiteSpace: "nowrap",
});
export const selectors = style({ display: "flex", alignItems: "center", gap: 8, width: "100%" });
globalStyle(`.${selectors} select`, { maxWidth: 200 });
export const saveActions = style({
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginLeft: "auto",
  flexShrink: 0,
  whiteSpace: "nowrap",
});
export const workspace = style({ position: "relative", flex: 1, minHeight: 0, display: "flex" });
export const panelOpen = style({});
globalStyle(`.${panelOpen} > div:last-child`, { right: 416 });
export const canvas = style({ position: "relative", zIndex: 0, flex: 1, minHeight: 0 });
export const state = style({
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 12,
  height: "100%",
  color: tokens["color/ink-3"],
});
export const toolbar = style({
  position: "absolute",
  zIndex: 5,
  top: 16,
  left: 16,
  display: "flex",
  gap: 6,
  borderRadius: 10,
  padding: 4,
  background: tokens["color/card"],
  border: `1px solid ${tokens["color/card-border"]}`,
});
export const zoom = style({
  position: "absolute",
  zIndex: 5,
  right: 16,
  bottom: 16,
  display: "flex",
  alignItems: "center",
  gap: 4,
  borderRadius: 10,
  padding: 4,
  background: tokens["color/card"],
  border: `1px solid ${tokens["color/card-border"]}`,
});
export const zoomValue = style({ minWidth: 42, textAlign: "center", fontSize: 11 });
export const card = style({
  boxSizing: "border-box",
  width: 224,
  borderRadius: 12,
  padding: 12,
  background: tokens["color/card"],
  border: `1px solid ${tokens["color/card-border"]}`,
  color: tokens["color/ink"],
});
export const cardTitle = style({
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 13,
  fontWeight: 700,
});
export const titleText = style({
  flex: 1,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});
export const start = style({ color: tokens["color/primary"], fontSize: 10 });
export const wait = style({ color: tokens["color/ink-3"], fontSize: 10 });
export const line = style({
  display: "flex",
  alignItems: "center",
  gap: 6,
  marginTop: 8,
  fontSize: 12,
  minWidth: 0,
});
export const lineText = style({
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});
export const exits = style({ marginTop: 8, display: "flex", flexDirection: "column", gap: 7 });
export const exit = style({
  position: "relative",
  color: tokens["color/ink-3"],
  fontSize: 11,
  paddingRight: 12,
  whiteSpace: "nowrap",
  overflow: "visible",
});
export const exitText = style({ display: "block", overflow: "hidden", textOverflow: "ellipsis" });
export const handle = style({});
export const choiceHandle = style({});
globalStyle(`.${canvas} .${handle}`, {
  width: 10,
  height: 10,
  right: -17,
  borderRadius: "50%",
  backgroundColor: tokens["color/ink-3"],
  border: 0,
});
globalStyle(`.${canvas} .${choiceHandle}`, {
  backgroundColor: tokens["color/primary"],
});
export const target = style({ opacity: 0, pointerEvents: "none" });
export const end = style({
  boxSizing: "border-box",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 72,
  height: 40,
  borderRadius: 20,
  background: tokens["color/hover"],
  color: tokens["color/ink-3"],
  fontSize: 12,
});
export const storyButton = style({
  display: "block",
  width: "100%",
  border: 0,
  background: "transparent",
  color: "inherit",
  textAlign: "left",
  cursor: "pointer",
  font: "inherit",
});
globalStyle(`.${canvas} .react-flow__minimap`, {
  right: 16,
  bottom: 58,
  margin: 0,
  boxSizing: "border-box",
  borderRadius: 8,
  overflow: "hidden",
  background: tokens["color/card"],
  border: `1px solid ${tokens["color/card-border"]}`,
});

globalStyle(`.${canvas}.${panelOpen} .react-flow__minimap`, { right: 416 });
globalStyle(`.${canvas} .react-flow__attribution`, { background: "transparent" });
globalStyle(`.${canvas} .react-flow__attribution a`, { color: tokens["color/ink-3"] });

export const problemCard = style({ borderColor: tokens["color/danger"] });
export const missingExit = style({ color: tokens["color/danger"] });
export const limitNotice = style({
  alignSelf: "center",
  color: tokens["color/ink-3"],
  fontSize: 11,
});
export const missingHandle = style({});
globalStyle(`.${canvas} .${missingHandle}`, {
  backgroundColor: tokens["color/card"],
  border: `1px solid ${tokens["color/danger"]}`,
});
export const dropHint = style({
  position: "absolute",
  zIndex: 5,
  pointerEvents: "none",
  width: 180,
  padding: 16,
  border: `1px dashed ${tokens["color/primary"]}`,
  borderRadius: 12,
  color: tokens["color/ink-3"],
  background: tokens["color/card"],
  fontSize: 12,
});
export const problemsPanel = style({
  position: "absolute",
  zIndex: 6,
  right: 0,
  top: 0,
  bottom: 0,
  width: "min(400px, 100%)",
  boxSizing: "border-box",
  overflowY: "auto",
  padding: 20,
  background: tokens["color/glass-window"],
  borderLeft: `1px solid ${tokens["color/card-border"]}`,
});
export const problemsHeader = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
});
export const problemsList = style({ listStyle: "none", margin: 0, padding: 0 });
globalStyle(`.${problemsList} button`, {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  width: "100%",
  padding: 12,
  border: 0,
  borderBottom: `1px solid ${tokens["color/card-border"]}`,
  color: tokens["color/ink"],
  background: "transparent",
  textAlign: "left",
  cursor: "pointer",
});
