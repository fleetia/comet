import { globalStyle, style } from "@vanilla-extract/css";
import { semanticVars as vars } from "@fleetia/lagrange/theme";
import * as common from "../../lagrange.css";
export const window = style({
  height: "100dvh",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  color: vars.color.content.primary,
  background: vars.color.surface.canvas,
  fontSize: vars.typography.size.body,
});
export const preview = style({
  height: 720,
  maxHeight: "100dvh",
  borderTop: `${vars.border.width.hairline} solid ${vars.color.border.subtle}`,
});
export const header = style({
  display: "flex",
  alignItems: "center",
  flexShrink: 0,
  height: 32,
  padding: "0 12px",
  borderBottom: `${vars.border.width.hairline} solid ${vars.color.border.subtle}`,
});
export const layout = style({
  display: "grid",
  gridTemplateColumns: "136px minmax(0, 1fr)",
  flex: 1,
  minHeight: 0,
});
export const sidebar = style({
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  overflowY: "auto",
  padding: "8px",
  background: vars.color.surface.muted,
  borderRight: `${vars.border.width.hairline} solid ${vars.color.border.subtle}`,
});
export const navigation = style({ alignItems: "stretch", gap: 0, borderInlineEnd: 0 });
export const groupLabel = style({
  fontSize: vars.typography.size.caption,
  lineHeight: vars.typography.lineHeight.compact,
  color: vars.color.content.secondary,
  padding: "12px 8px 4px",
  selectors: { [`${navigation} > :first-child &`]: { paddingTop: 4 } },
});
export const navigationItem = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: vars.space.sm,
  width: "100%",
  minHeight: 32,
  padding: "6px 8px",
  textAlign: "left",
});
export const sidebarNote = style({ marginTop: "auto", padding: "12px 8px 4px" });
export const workspace = style({
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
  minHeight: 0,
});
export const pageHeading = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  flexShrink: 0,
  height: 48,
  margin: "0 16px 12px",
  borderBottom: `3px double ${vars.color.border.strong}`,
});
globalStyle(`${pageHeading} h1`, {
  margin: 0,
  fontSize: vars.typography.size.headingSm,
  fontWeight: 600,
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
  overflowY: "auto",
  scrollbarGutter: "stable",
  padding: "0 16px 12px",
});
globalStyle(`${panel}[hidden]`, { display: "none" });
export const saveBar = style({
  flexShrink: 0,
  borderTop: `${vars.border.width.hairline} solid ${vars.color.border.subtle}`,
  padding: "8px 16px",
  background: vars.color.surface.canvas,
});
export const columns = style({
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 24,
  marginTop: 16,
  "@media": { "(max-width: 800px)": { gridTemplateColumns: "1fr" } },
});
export const listEditor = style({
  display: "grid",
  gridTemplateColumns: "200px minmax(0, 1fr)",
  gap: 16,
  marginTop: 12,
});
export const list = style({
  display: "flex",
  flexDirection: "column",
  gap: 4,
  borderRight: `1px solid ${vars.color.border.subtle}`,
  paddingRight: 12,
});
export const listRow = style({
  textAlign: "left",
  justifyContent: "flex-start",
  whiteSpace: "normal",
  overflowWrap: "anywhere",
  selectors: {
    '&[aria-pressed="true"]': {
      background: vars.color.selection.surface,
      borderLeft: `2px solid ${vars.color.selection.indicator}`,
    },
  },
});
export const packList = style({ listStyle: "none", padding: 0, margin: "12px 0" });
export const packRow = style({
  display: "grid",
  gridTemplateColumns: "1fr auto",
  alignItems: "center",
  gap: 16,
  borderBottom: `1px solid ${vars.color.border.subtle}`,
  padding: "12px 0",
});
globalStyle(`${panel} .${common.row}`, { margin: "8px 0", gap: 8 });
globalStyle(`${panel} .${common.field}`, { marginBottom: 12, gap: 2 });
globalStyle(`${panel} .${common.section}`, { marginTop: 20, paddingTop: 12 });
globalStyle(`${panel} .${common.sectionTitle}`, {
  fontSize: vars.typography.size.label,
  marginBottom: 8,
});
globalStyle(`${panel} .${common.choice}`, { padding: "6px 12px" });
export const editor = style({ border: 0, padding: 0, margin: 0, minWidth: 0 });
