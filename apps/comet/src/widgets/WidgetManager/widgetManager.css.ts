import { globalStyle, style } from "@vanilla-extract/css";
import { semanticVars as vars } from "@fleetia/lagrange/theme";
import { tokens } from "@comet/token";
import * as common from "../../lagrange.css";
import * as tools from "../tools.css";

export const embedded = style({
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
  minHeight: 0,
  height: "100%",
  gap: vars.space.md,
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
  gap: vars.space.lg,
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
  gap: vars.space.sm,
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
  gap: vars.space.lg,
  minHeight: 80,
  padding: "16px 20px",
  borderRadius: tokens["radius/radius-16"],
  background: tokens["color/card"],
  border: `1px solid ${tokens["color/card-border"]}`,
  "@media": {
    "(max-width: 1439px)": {
      gridTemplateColumns: "minmax(0, 1fr) auto",
      gap: vars.space.sm,
      minHeight: 88,
    },
  },
});
globalStyle(`${generatedView} .${detailHeader}`, {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "start",
});
export const identity = style({ display: "grid", gap: vars.space.xs, minWidth: 0 });
export const detailBody = style({
  minHeight: 0,
  minWidth: 0,
  overflow: "visible",
  display: "flex",
  flexDirection: "column",
  gap: 20,
});
export const group = style({ display: "grid", gap: vars.space.md, alignContent: "start" });
export const related = style({
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) auto",
  alignItems: "center",
  gap: vars.space.sm,
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
  gap: vars.space.md,
  minHeight: 32,
});
globalStyle(`${displayControls} > button`, { minWidth: 140 });
export const metadata = style({
  margin: 0,
  marginTop: "auto",
  paddingTop: vars.space.md,
  borderTop: `${vars.border.width.hairline} solid ${vars.color.border.subtle}`,
  fontSize: vars.typography.size.caption,
  lineHeight: vars.typography.lineHeight.body,
  color: vars.color.content.secondary,
});
globalStyle(`dl.${metadata}`, {
  display: "grid",
  gridTemplateColumns: "auto minmax(0, 1fr)",
  gap: vars.space.sm,
  marginTop: 0,
});
globalStyle(`${metadata} dd`, { margin: 0, overflowWrap: "anywhere" });
export const remove = style({
  flexShrink: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: vars.space.md,
  borderTop: `${vars.border.width.hairline} dotted ${vars.color.border.subtle}`,
  paddingTop: vars.space.sm,
});
export const genericPanel = style({
  display: "flex",
  flexDirection: "column",
  gap: vars.space.md,
  minWidth: 0,
  minHeight: 0,
  maxWidth: 800,
  maxHeight: "100%",
  overflowY: "auto",
  overscrollBehavior: "contain",
  padding: vars.space.lg,
  borderRadius: tokens["radius/radius-16"],
  background: tokens["color/card"],
  border: `1px solid ${tokens["color/card-border"]}`,
});
export const footer = style({
  flexShrink: 0,
  display: "grid",
  gap: vars.space.sm,
  paddingTop: vars.space.sm,
  borderTop: `${vars.border.width.hairline} solid ${vars.color.border.subtle}`,
});
export const dialogBody = style({ display: "grid", gap: vars.space.lg });
export const runtimeMessages = style({
  flexShrink: 0,
  display: "grid",
  gap: vars.space.sm,
  padding: vars.space.lg,
  borderRadius: tokens["radius/radius-14"],
  background: tokens["color/component/cat-rest-alpha-80"],
});
export const runtimeError = style({ display: "flex", alignItems: "center", gap: vars.space.md });
globalStyle(`${settings} section`, { minWidth: 0 });
globalStyle(`${settings} .${common.field}`, { gap: vars.space.xs, marginBottom: 0 });
globalStyle(`${settings} .${tools.number}`, {
  fontSize: vars.typography.size.headingMd,
  lineHeight: vars.typography.lineHeight.tight,
  padding: 0,
  textAlign: "left",
  color: vars.color.content.primary,
});

export const experiments = style({ display: "grid", gap: vars.space.sm });
export const experimentsToggle = style({
  display: "flex",
  alignItems: "center",
  gap: vars.space.xs,
  width: "100%",
  minHeight: 32,
  padding: `${vars.space.xs} ${vars.space.sm}`,
  border: 0,
  background: "transparent",
  color: vars.color.content.secondary,
  textAlign: "left",
  font: "inherit",
  fontSize: vars.typography.size.label,
  borderRadius: vars.shape.radius.subtle,
  cursor: "pointer",
  selectors: {
    "&:focus-visible": { outline: `2px solid ${vars.color.interaction.focus}`, outlineOffset: -2 },
  },
});
export const experimentsBody = style({
  display: "grid",
  gap: vars.space.sm,
  maxHeight: 240,
  overflowY: "auto",
  overscrollBehavior: "contain",
  padding: `0 ${vars.space.sm}`,
  selectors: { "&[hidden]": { display: "none" } },
});

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
