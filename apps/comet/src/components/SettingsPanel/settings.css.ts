import { globalStyle, style } from "@vanilla-extract/css";
import { semanticVars as vars } from "@fleetia/lagrange/theme";
import { tokens } from "@comet/token";
import * as common from "../../lagrange.css";
import * as windowHeader from "../WindowHeader/windowHeader.css";
export const window = style({
  height: "100dvh",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  color: vars.color.content.primary,
  background: tokens["color/glass-window"],
  backdropFilter: tokens["backdrop/backdrop-window"],
  border: `1px solid ${tokens["color/glass-border"]}`,
  borderRadius: tokens["radius/radius-22"],
  boxSizing: "border-box",
  fontSize: vars.typography.size.body,
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
globalStyle(`${header} .${windowHeader.brand}`, { gap: vars.space.md });
globalStyle(`${header} .${windowHeader.icon}`, { width: 24, height: 24 });
globalStyle(`${header} .${windowHeader.brandName}`, {
  fontSize: 15,
  fontWeight: 400,
  lineHeight: vars.typography.lineHeight.compact,
});
globalStyle(`${header} .${windowHeader.windowName}`, {
  fontSize: vars.typography.size.label,
  lineHeight: vars.typography.lineHeight.body,
});
globalStyle(`${header} .${windowHeader.close}`, {
  width: 30,
  minHeight: 30,
  fontSize: vars.typography.size.label,
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
export const navigation = style({ alignItems: "stretch", gap: vars.space.xs, borderInlineEnd: 0 });
globalStyle(`${sidebar} .${navigation}`, { gap: vars.space.xs });
export const groupLabel = style({
  fontSize: vars.typography.size.caption,
  lineHeight: vars.typography.lineHeight.body,
  color: vars.color.content.secondary,
  fontWeight: 500,
  margin: "24px 0 8px",
  padding: "0 12px",
  selectors: { [`${navigation} > :first-child &`]: { marginTop: 0 } },
});
export const navigationItem = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-start",
  gap: 12,
  width: "100%",
  minHeight: 44,
  padding: "10px 12px",
  borderRadius: tokens["radius/radius-12"],
  border: "1px solid transparent",
  textAlign: "left",
  background: "transparent",
  color: tokens["color/ink-2"],
  fontWeight: 500,
  selectors: {
    '&[aria-selected="true"]': {
      background: tokens["color/selected"],
      borderColor: tokens["color/selected-border"],
      color: tokens["color/selected-ink"],
      fontWeight: 600,
    },
    '&:hover:not([aria-selected="true"])': { background: tokens["color/hover"] },
  },
});
export const navigationLabel = style({ flex: 1, minWidth: 0 });
export const sidebarNote = style({
  marginTop: "auto",
  padding: "24px 12px 4px",
  fontSize: 11,
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
  gap: vars.space.lg,
  flexShrink: 0,
  minHeight: 64,
  marginBottom: 20,
  justifyContent: "space-between",
});
export const pageIdentity = style({ display: "grid", gap: 6, minWidth: 0 });
export const pageDescription = style({
  margin: 0,
  color: tokens["color/ink-2"],
  fontSize: 13,
  lineHeight: 1.5,
});
globalStyle(`${pageHeading} h1`, {
  margin: 0,
  fontFamily: tokens["typography/display/page/fontFamily"],
  fontSize: 26,
  lineHeight: "34px",
  fontWeight: 400,
});
export const scrollArea = style({
  display: "flex",
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  overflow: "hidden",
  border: 0,
  padding: 0,
  margin: 0,
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
export const characterPanel = style({ overflow: "hidden" });
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
  gap: vars.space.xl,
  marginTop: vars.space.lg,
  "@media": { "(max-width: 800px)": { gridTemplateColumns: "1fr" } },
});
export const simplePage = style({ maxWidth: 792 });
export const dialogueLayout = style({
  display: "flex",
  flexDirection: "column",
  gap: vars.space.xl,
  height: "100%",
  maxWidth: 1184,
  overflowY: "auto",
  scrollbarGutter: "stable",
});
export const wordbookSection = style({
  height: "min(640px, calc(100% - 72px))",
  minHeight: 400,
  flexShrink: 0,
});
export const talkSection = style({
  display: "grid",
  gap: vars.space.md,
  flexShrink: 0,
  paddingBottom: vars.space.md,
});
export const userIdentity = style({
  display: "flex",
  alignItems: "center",
  gap: vars.space.lg,
  maxWidth: 320,
  minHeight: 28,
  marginBottom: `calc(${vars.space.lg} + ${vars.space.xs})`,
});
export const talkContext = style({ marginBottom: vars.space.lg, maxWidth: 768 });
globalStyle(`${userIdentity} strong`, {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});
globalStyle(`${talkContext} p`, { overflowWrap: "anywhere" });
export const generalLayout = style({
  display: "grid",
  gridTemplateColumns: "minmax(0, 792px) 368px",
  gap: vars.space.xl,
  maxWidth: 1184,
  height: "100%",
  minHeight: 0,
  overflowY: "auto",
  alignItems: "start",
  "@media": {
    "(max-width: 1400px)": {
      gridTemplateColumns: "minmax(0, 1fr) 224px",
    },
    "(max-width: 1120px)": {
      gridTemplateColumns: "minmax(0, 1fr)",
      alignContent: "start",
      overflowY: "auto",
    },
  },
});
export const generalMain = style({
  minWidth: 0,
  height: "min(716px, 100%)",
  display: "flex",
  flexDirection: "column",
  gap: vars.space.md,
  overflow: "hidden",
});
export const panelBody = style({
  minHeight: 0,
  overflowY: "auto",
  flex: 1,
  display: "flex",
  flexDirection: "column",
  gap: vars.space.md,
});
export const sectionBody = style({ display: "grid", gap: vars.space.md });
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
  gap: vars.space.md,
  maxWidth: 720,
  minHeight: vars.dimension.row,
});
globalStyle(`${statusRow} > :first-child`, { width: 188, flexShrink: 0 });
export const rowLabel = style({
  fontSize: vars.typography.size.label,
  fontWeight: 600,
  lineHeight: vars.typography.lineHeight.compact,
});
export const rowControl = style({ flexShrink: 0, width: 144, minWidth: 144 });
export const settingsSection = style({
  display: "grid",
  gap: vars.space.md,
  borderTop: `${vars.border.width.hairline} solid ${vars.color.border.subtle}`,
  paddingTop: 20,
  marginTop: 4,
});
export const inlineHighlight = style({
  minHeight: 64,
  padding: "16px 24px",
  borderRadius: "16px 16px 0 0",
  background: tokens["color/component/selected-icon-alpha-80"],
  color: tokens["color/ink"],
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: vars.space.lg,
});
globalStyle(`${inlineHighlight} h2`, { color: "inherit" });
export const automaticField = style({
  display: "flex",
  width: 172,
  gap: vars.space.sm,
  alignItems: "center",
  flexWrap: "wrap",
});
export const automaticPanel = style({
  width: "100%",
  maxWidth: 792,
  height: "100%",
  display: "flex",
  flexDirection: "column",
  gap: 20,
  overflow: "hidden",
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: tokens["radius/radius-18"],
  background: tokens["color/card"],
});
export const automaticContent = style({
  display: "grid",
  gap: 16,
  minWidth: 0,
  paddingInline: 24,
});
globalStyle(`${automaticPanel} > .${saveBar}`, { marginInline: 24 });
export const pausedRow = style([settingsRow, { minHeight: 48 }]);
export const sectionTitle = style({
  margin: 0,
  fontSize: vars.typography.size.label,
  lineHeight: vars.typography.lineHeight.compact,
  fontWeight: 600,
});
export const headingRow = style({
  minHeight: vars.dimension.row,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
});
export const footerStatus = style({
  display: "grid",
  gap: vars.space.xxs,
  minHeight: 44,
  alignContent: "center",
});
export const footerBar = style({ paddingTop: 0, minHeight: 44, gap: vars.space.md });
export const cancelButton = style({ width: 88 });
export const saveButton = style({ minWidth: 108 });
export const listEditor = style({
  display: "grid",
  gridTemplateColumns: "200px minmax(0, 1fr)",
  gap: vars.space.lg,
  marginTop: vars.space.md,
});
export const list = style({
  display: "flex",
  flexDirection: "column",
  gap: vars.space.xs,
  borderRight: `${vars.border.width.hairline} solid ${vars.color.border.subtle}`,
  paddingRight: vars.space.md,
});
export const listRow = style({
  textAlign: "left",
  justifyContent: "flex-start",
  whiteSpace: "normal",
  overflowWrap: "anywhere",
  selectors: {
    '&[aria-pressed="true"]': {
      background: vars.color.selection.surface,
      color: vars.color.content.onAccent,
      borderLeft: `2px solid ${vars.color.selection.indicator}`,
    },
    '&[aria-pressed="true"]:hover:not(:disabled)': {
      background: vars.color.selection.surface,
      color: vars.color.content.onAccent,
    },
  },
});
export const packList = style({ listStyle: "none", padding: 0, margin: `${vars.space.md} 0` });
export const packRow = style({
  display: "grid",
  gridTemplateColumns: "1fr auto",
  alignItems: "center",
  gap: vars.space.lg,
  padding: `${vars.space.md} 0`,
});
globalStyle(`${panel} .${common.row}`, { margin: `${vars.space.sm} 0`, gap: vars.space.sm });
globalStyle(`${panel} .${common.field}`, { marginBottom: vars.space.md, gap: vars.space.xxs });
globalStyle(`${panel} .${common.section}`, {
  marginTop: `calc(${vars.space.lg} + ${vars.space.xs})`,
  paddingTop: vars.space.md,
});
globalStyle(`${panel} .${common.sectionTitle}`, {
  fontSize: vars.typography.size.headingSm,
  marginBottom: vars.space.lg,
});
globalStyle(`${panel} .${common.choice}`, {
  padding: `calc(${vars.space.xs} + ${vars.space.xxs}) ${vars.space.md}`,
});
export const editor = style({ border: 0, padding: 0, margin: 0, minWidth: 0 });

export const pageDirty = style({
  color: vars.color.content.secondary,
  fontSize: vars.typography.size.caption,
});

export const footerActions = style({ display: "flex", alignItems: "center", gap: vars.space.md });

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
