import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";
import settingsNight from "../../assets/figma/settings-night.svg";
import * as common from "../../common.css";
import * as windowHeader from "../WindowHeader/windowHeader.css";
export const window = style({
  height: "100dvh",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  color: tokens["color/ink"],
  background: tokens["color/glass-window"],
  backgroundSize: "cover",
  backgroundPosition: "center top",
  backgroundRepeat: "no-repeat",
  border: `1px solid ${tokens["color/glass-border"]}`,
  borderRadius: tokens["radius/radius-9"],
  boxSizing: "border-box",
  fontSize: tokens["typography/sans/body/fontSize"],
  selectors: {
    '[data-comet-theme="dark"] &': { backgroundImage: `url("${settingsNight}")` },
  },
});
globalStyle(`${window} dialog::backdrop`, {
  borderRadius: tokens["radius/radius-9"],
});
export const preview = style({
  height: 720,
  maxHeight: "100dvh",
  border: `1px solid ${tokens["color/glass-border"]}`,
});
export const header = style({
  display: "flex",
  alignItems: "center",
  flexShrink: 0,
  height: 48,
  padding: "0 18px",
  background: "transparent",
  borderBottom: `1px solid ${tokens["color/divider"]}`,
});
globalStyle(`${header} > div`, { alignItems: "center" });
globalStyle(`${header} .${windowHeader.brand}`, { gap: tokens["spacing/space-12"] });
globalStyle(`${header} .${windowHeader.icon}`, { width: 24, height: 24 });
globalStyle(`${header} .${windowHeader.brandName}`, {
  fontSize: 15,
  fontWeight: 400,
  lineHeight: "1.385",
});
globalStyle(`${header} .${windowHeader.windowName}`, {
  fontSize: tokens["typography/sans/body/fontSize"],
  lineHeight: "1.462",
});
export const layout = style({
  display: "grid",
  gridTemplateColumns: "204px minmax(0, 1fr)",
  flex: 1,
  minHeight: 0,
  "@media": { "(max-width: 1000px)": { gridTemplateColumns: "180px minmax(0, 1fr)" } },
});
export const sidebar = style({
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  overflowY: "auto",
  padding: "24px 12px 12px",
  background: tokens["color/rail"],
  borderRight: `1px solid ${tokens["color/divider"]}`,
});
export const navigation = style({ alignItems: "stretch", gap: tokens["spacing/space-6"], borderInlineEnd: 0 });
globalStyle(`${sidebar} .${navigation}`, { gap: tokens["spacing/space-6"] });
export const groupLabel = style({
  fontSize: tokens["typography/sans/caption/fontSize"],
  lineHeight: "1.462",
  color: tokens["color/ink-2"],
  fontWeight: 500,
  margin: "24px 0 8px",
  padding: "0 12px",
  selectors: { [`${navigation} > :first-child &`]: { marginTop: 0 } },
});
export const workspace = style({
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
  minHeight: 0,
  padding: "24px 28px",
  "@media": { "(max-width: 1100px)": { padding: 20 } },
});
export const pageHeading = style({
  display: "flex",
  alignItems: "center",
  gap: tokens["spacing/space-16"],
  flexShrink: 0,
  minHeight: 64,
  marginBottom: 20,
  justifyContent: "space-between",
});
globalStyle(`${pageHeading} h1`, {
  margin: 0,
  fontFamily: tokens["typography/display/page/fontFamily"],
  fontSize: 26,
  lineHeight: "34px",
  fontWeight: 400,
});
export const panel = style({
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  height: "100%",
  overflow: "hidden",
  padding: 0,
});
globalStyle(`${panel}[hidden]`, { display: "none" });
export const saveBar = style({
  flexShrink: 0,
  minHeight: 60,
  paddingBlock: 12,
  background: "transparent",
  borderTop: `1px solid ${tokens["color/divider"]}`,
});
export const columns = style({
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: tokens["spacing/space-26"],
  marginTop: tokens["spacing/space-16"],
  "@media": { "(max-width: 800px)": { gridTemplateColumns: "1fr" } },
});
export const userIdentity = style({
  display: "flex",
  alignItems: "center",
  gap: tokens["spacing/space-16"],
  maxWidth: 320,
  minHeight: 28,
  marginBottom: `calc(${tokens["spacing/space-16"]} + ${tokens["spacing/space-6"]})`,
});
export const talkContext = style({ marginBottom: tokens["spacing/space-16"], maxWidth: 768 });
globalStyle(`${userIdentity} strong`, {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});
globalStyle(`${talkContext} p`, { overflowWrap: "anywhere" });
export const sectionBody = style({ display: "grid", gap: tokens["spacing/space-12"] });
export const settingsRow = style({
  width: "100%",
  maxWidth: 720,
  minHeight: 64,
  paddingBlock: 0,
  border: 0,
});
export const statusRow = style({
  display: "flex",
  alignItems: "center",
  gap: tokens["spacing/space-12"],
  maxWidth: 720,
  minHeight: tokens["spacing/space-32"],
});
globalStyle(`${statusRow} > :first-child`, { width: 188, flexShrink: 0 });
export const rowControl = style({ flexShrink: 0, width: 144, minWidth: 144 });
export const settingsSection = style({
  display: "grid",
  gap: tokens["spacing/space-12"],
  borderTop: `1px solid ${tokens["color/line"]}`,
  paddingTop: 20,
  marginTop: 4,
});
export const inlineHighlight = style({
  minHeight: 64,
  padding: "16px 24px",
  borderRadius: "9px 9px 0 0",
  background: tokens["color/component/selected-icon-alpha-80"],
  color: tokens["color/ink"],
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: tokens["spacing/space-16"],
});
globalStyle(`${inlineHighlight} h2`, { color: "inherit" });
export const automaticPanel = style({
  width: "100%",
  maxWidth: 792,
  height: "100%",
  display: "flex",
  flexDirection: "column",
  gap: 20,
  overflow: "hidden",
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: tokens["radius/radius-9"],
  background: tokens["color/card"],
});
globalStyle(`${automaticPanel} > .${saveBar}`, { marginInline: 24 });
export const sectionTitle = style({
  margin: 0,
  fontSize: tokens["typography/sans/body/fontSize"],
  lineHeight: "1.385",
  fontWeight: 600,
});
export const footerStatus = style({
  display: "grid",
  gap: tokens["spacing/space-4"],
  minHeight: 44,
  alignContent: "center",
});
export const footerBar = style({ paddingTop: 0, minHeight: 44, gap: tokens["spacing/space-12"] });
export const cancelButton = style({ width: 88 });
export const saveButton = style({ minWidth: 108 });
export const listEditor = style({
  display: "grid",
  gridTemplateColumns: "200px minmax(0, 1fr)",
  gap: tokens["spacing/space-16"],
  marginTop: tokens["spacing/space-12"],
});
export const list = style({
  display: "flex",
  flexDirection: "column",
  gap: tokens["spacing/space-6"],
  borderRight: `1px solid ${tokens["color/line"]}`,
  paddingRight: tokens["spacing/space-12"],
});
export const listRow = style({
  textAlign: "left",
  justifyContent: "flex-start",
  whiteSpace: "normal",
  overflowWrap: "anywhere",
  selectors: {
    '&[aria-pressed="true"]': {
      background: tokens["color/primary"],
      color: tokens["color/on-primary"],
      borderLeft: `2px solid ${tokens["color/selected-border"]}`,
    },
    '&[aria-pressed="true"]:hover:not(:disabled)': {
      background: tokens["color/primary"],
      color: tokens["color/on-primary"],
    },
  },
});
export const packList = style({ listStyle: "none", padding: 0, margin: `${tokens["spacing/space-12"]} 0` });
globalStyle(`${panel} .${common.row}`, { margin: `${tokens["spacing/space-8"]} 0`, gap: tokens["spacing/space-8"] });
globalStyle(`${panel} .${common.field}`, { marginBottom: tokens["spacing/space-12"], gap: tokens["spacing/space-4"] });
globalStyle(`${panel} .${common.section}`, {
  marginTop: `calc(${tokens["spacing/space-16"]} + ${tokens["spacing/space-6"]})`,
  paddingTop: tokens["spacing/space-12"],
});
globalStyle(`${panel} .${common.sectionTitle}`, {
  fontSize: tokens["typography/display/title-sm/fontSize"],
  marginBottom: tokens["spacing/space-16"],
});
globalStyle(`${panel} .${common.choice}`, {
  padding: `calc(${tokens["spacing/space-6"]} + ${tokens["spacing/space-4"]}) ${tokens["spacing/space-12"]}`,
});
export const editor = style({ border: 0, padding: 0, margin: 0, minWidth: 0 });

export const pageDirty = style({
  color: tokens["color/ink-2"],
  fontSize: tokens["typography/sans/caption/fontSize"],
});

export const footerActions = style({ display: "flex", alignItems: "center", gap: tokens["spacing/space-12"] });

export const settingsHeader = style({
  height: 64,
  padding: "0 22px",
  flexShrink: 0,
  borderBottom: `1px solid ${tokens["color/card-border"]}`,
});
globalStyle(`${settingsHeader} .${windowHeader.header}`, { gap: 18 });
export const topTabs = style({
  gap: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  height: "100%",
  minWidth: 0,
});
globalStyle(`${topTabs} [role="tablist"]`, { gap: 4, margin: 0, padding: 4 });
globalStyle(`${topTabs} [role="tabpanel"]`, { display: "none" });
export const profileLink = style({ flexShrink: 0, gap: 8, fontSize: 13 });
export const profileAvatar = style({
  display: "grid",
  placeItems: "center",
  width: 26,
  height: 26,
  borderRadius: "50%",
  background: tokens["color/component/nav-badge"],
  color: tokens["color/ink"],
});
export const settingsWorkspace = style({
  minWidth: 0,
  minHeight: 0,
  flex: 1,
  padding: "22px 28px 26px",
  margin: 0,
  border: 0,
  display: "flex",
  overflow: "hidden",
  "@media": { "(max-width: 1050px)": { padding: "20px 24px 24px" } },
});
export const settingsPage = style({
  flex: 1,
  height: "100%",
  minWidth: 0,
  minHeight: 0,
  overflow: "hidden",
  selectors: { "&[hidden]": { display: "none" } },
});
export const subpage = style({
  display: "flex",
  flexDirection: "column",
  gap: 18,
  height: "100%",
  minWidth: 0,
  minHeight: 0,
});
export const breadcrumb = style({
  display: "flex",
  alignItems: "center",
  gap: 12,
  fontSize: 13,
  color: tokens["color/ink-2"],
  flexShrink: 0,
});

export const dialogueSubview = style({
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  overflowY: "auto",
  selectors: { "&[hidden]": { display: "none" } },
});

globalStyle(`${settingsWorkspace}[data-section="widgets"]`, { paddingTop: 16 });
