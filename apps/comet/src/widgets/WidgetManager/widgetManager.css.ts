import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";
import * as common from "../../common.css";
import * as tools from "../tools.css";

export const embedded = style({
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
  minHeight: 0,
  height: "100%",
  gap: tokens["spacing/space-12"],
  overflow: "hidden",
  overflowWrap: "anywhere",
});
export const workspace = style({
  display: "grid",
  gridTemplateColumns: "272px minmax(0, 1fr)",
  minHeight: 0,
  flex: 1,
  gap: 24,
  "@media": {
    "(max-width: 1439px)": { gridTemplateColumns: "220px minmax(0, 1fr)", gap: 20 },
    "(max-width: 1000px)": { gridTemplateColumns: "192px minmax(0, 1fr)", gap: 16 },
  },
});
export const detail = style({
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  gap: tokens["spacing/space-16"],
});
export const officialView = style({
  display: "grid",
  gridTemplateColumns: "372px minmax(0, 1fr)",
  alignItems: "start",
  overflowY: "auto",
  overscrollBehavior: "contain",
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  gap: 28,
  selectors: { "&[hidden]": { display: "none" } },
});
export const generatedView = style({
  minHeight: 0,
  overflowY: "auto",
  overscrollBehavior: "contain",
  selectors: { "&[hidden]": { display: "none" } },
});
export const detailContent = style({
  display: "flex",
  flexDirection: "column",
  gap: tokens["spacing/space-8"],
});
export const editRequest = style({
  width: "100%",
  minHeight: 80,
  boxSizing: "border-box",
  font: "inherit",
  resize: "vertical",
});
export const detailHeader = style({
  flexShrink: 0,
  display: "grid",
  gridTemplateColumns: "minmax(0, 500px) minmax(0, 484px) auto",
  alignItems: "center",
  justifyContent: "start",
  gap: tokens["spacing/space-16"],
  minHeight: 80,
  padding: "16px 20px",
  borderRadius: tokens["radius/radius-16"],
  background: tokens["color/card"],
  border: `1px solid ${tokens["color/card-border"]}`,
  "@media": {
    "(max-width: 1439px)": {
      gridTemplateColumns: "minmax(0, 1fr) auto",
      gap: tokens["spacing/space-8"],
      minHeight: 88,
    },
  },
});
globalStyle(`${generatedView} .${detailHeader}`, {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "start",
});
export const identity = style({ display: "grid", gap: tokens["spacing/space-6"], minWidth: 0 });
export const detailBody = style({
  minHeight: 0,
  minWidth: 0,
  overflow: "visible",
  display: "flex",
  flexDirection: "column",
  gap: 20,
});
export const group = style({ display: "grid", gap: tokens["spacing/space-12"], alignContent: "start" });
export const related = style({
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) auto",
  alignItems: "center",
  gap: tokens["spacing/space-8"],
  minHeight: 40,
});
export const settingsView = style({
  minWidth: 0,
  minHeight: 0,
  flex: 1,
  display: "flex",
  flexDirection: "column",
});
globalStyle(`${settingsView}[hidden]`, { display: "none" });
export const settings = style({
  border: 0,
  padding: 0,
  margin: 0,
  minWidth: 0,
  minHeight: 0,
  flex: 1,
  display: "flex",
  flexDirection: "column",
});
export const displayControls = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: tokens["spacing/space-12"],
  minHeight: 32,
});
globalStyle(`${displayControls} > button`, { minWidth: 140 });
export const metadata = style({
  margin: 0,
  marginTop: "auto",
  paddingTop: tokens["spacing/space-12"],
  borderTop: `1px solid ${tokens["color/line"]}`,
  fontSize: tokens["typography/sans/caption/fontSize"],
  lineHeight: "1.462",
  color: tokens["color/ink-2"],
});
globalStyle(`dl.${metadata}`, {
  display: "grid",
  gridTemplateColumns: "auto minmax(0, 1fr)",
  gap: tokens["spacing/space-8"],
  marginTop: 0,
});
globalStyle(`${metadata} dd`, { margin: 0, overflowWrap: "anywhere" });
export const remove = style({
  flexShrink: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: tokens["spacing/space-12"],
  borderTop: `1px dotted ${tokens["color/line"]}`,
  paddingTop: tokens["spacing/space-8"],
});
export const genericPanel = style({
  display: "flex",
  flexDirection: "column",
  gap: tokens["spacing/space-12"],
  minWidth: 0,
  minHeight: 0,
  maxWidth: 800,
  maxHeight: "100%",
  overflowY: "auto",
  overscrollBehavior: "contain",
  padding: tokens["spacing/space-16"],
  borderRadius: tokens["radius/radius-16"],
  background: tokens["color/card"],
  border: `1px solid ${tokens["color/card-border"]}`,
});
export const footer = style({
  flexShrink: 0,
  display: "grid",
  gap: tokens["spacing/space-8"],
  paddingTop: tokens["spacing/space-8"],
  borderTop: `1px solid ${tokens["color/line"]}`,
});
export const dialogBody = style({ display: "grid", gap: tokens["spacing/space-16"] });
export const runtimeMessages = style({
  flexShrink: 0,
  display: "grid",
  gap: tokens["spacing/space-8"],
  padding: tokens["spacing/space-16"],
  borderRadius: tokens["radius/radius-14"],
  background: tokens["color/component/cat-rest-alpha-80"],
});
export const runtimeError = style({ display: "flex", alignItems: "center", gap: tokens["spacing/space-12"] });
globalStyle(`${settings} section`, { minWidth: 0 });
globalStyle(`${settings} .${common.field}`, { gap: tokens["spacing/space-6"], marginBottom: 0 });
globalStyle(`${settings} .${tools.number}`, {
  fontSize: tokens["typography/display/page/fontSize"],
  lineHeight: "1.25",
  padding: 0,
  textAlign: "left",
  color: tokens["color/ink"],
});

export const experiments = style({ display: "grid", gap: tokens["spacing/space-8"] });
export const directoryWorkspace = style({
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  gap: 16,
});
export const directory = style({
  height: "100%",
  minHeight: 0,
  minWidth: 0,
  selectors: { "&[hidden]": { display: "none" } },
});
export const breadcrumb = style({ display: "flex", alignItems: "center", gap: 8, height: 32, flexShrink: 0, color: tokens["color/ink-2"], fontSize: 13.5 });
globalStyle(`${breadcrumb} strong`, { color: tokens["color/ink"], fontWeight: 600 });
export const backButton = style({ width: 32, height: 32, minHeight: 32, padding: 0, borderRadius: 15, background: tokens["color/card"], border: `1px solid ${tokens["color/card-border"]}`, flexShrink: 0 });
globalStyle(`${detail}[hidden]`, { display: "none" });

export const directorySectionTitle = style({
  margin: 0,
  fontFamily: tokens["typography/display/label-display/fontFamily"],
  fontSize: 14,
  lineHeight: "18px",
  fontWeight: 400,
  color: tokens["color/ink-2"],
});
export const experimentRows = style({
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: 18,
  background: tokens["color/card"],
  overflow: "hidden",
});
export const experimentIcon = style({
  width: 32,
  height: 32,
  display: "grid",
  placeItems: "center",
  borderRadius: 16,
  color: tokens["color/icon-tile-ink"],
  background: tokens["color/icon-tile"],
});
globalStyle(`${experimentRows} > button`, {
  width: "100%",
  minHeight: 70,
  border: 0,
  background: "transparent",
  borderRadius: 0,
});
globalStyle(`${experimentRows} > div`, {
  borderTop: `1px solid ${tokens["color/divider"]}`,
  minHeight: 70,
});
