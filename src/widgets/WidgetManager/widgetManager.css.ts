import { globalStyle, style } from "@vanilla-extract/css";
import { semanticVars as vars, vnextVars } from "@fleetia/lagrange/theme";
import * as common from "../../lagrange.css";
import * as appearance from "../WidgetAppearance/widgetAppearance.css";
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
export const page = style([
  embedded,
  { padding: vars.space.lg, height: "100dvh", boxSizing: "border-box" },
]);
export const header = style({ minHeight: 32 });
export const sectionHeader = style({
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: vars.space.lg,
});
export const catalogSummary = style({ display: "none" });
export const workspace = style({
  display: "grid",
  gridTemplateColumns: "320px minmax(0, 1fr)",
  minHeight: 0,
  flex: 1,
  gap: vars.space.lg,
  "@media": {
    "(max-width: 1439px)": { gridTemplateColumns: "240px minmax(0, 1fr)" },
    "(max-width: 1000px)": { gridTemplateColumns: "208px minmax(0, 1fr)" },
  },
});
export const catalog = style({
  minWidth: 0,
  minHeight: 0,
  padding: vars.space.lg,
  borderRadius: vnextVars.radius.parent,
  display: "flex",
  flexDirection: "column",
  gap: vars.space.sm,
  overflow: "hidden",
});
export const catalogTitle = style({
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  minHeight: 24,
  flexShrink: 0,
  fontSize: vars.typography.size.label,
  lineHeight: vars.typography.lineHeight.compact,
});
export const filters = style({
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: vars.space.sm,
  flexShrink: 0,
});
export const listHeading = style({ display: "none" });
export const list = style({
  minHeight: 0,
  flex: "0 1 auto",
  marginTop: 9,
  overflowY: "auto",
  overscrollBehavior: "contain",
});
export const row = style({
  minHeight: 32,
  height: 32,
  selectors: {
    '&[data-selected="true"]': {
      background: vars.color.selection.surface,
      color: vars.color.content.onAccent,
      borderRadius: vars.shape.radius.subtle,
    },
  },
  "@media": { "(max-width: 1000px)": { height: 56, minHeight: 56 } },
});
export const selectEntry = style({
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 48px 64px",
  alignItems: "center",
  gap: vars.space.sm,
  width: "100%",
  minHeight: 32,
  padding: `${vars.space.xs} ${vars.space.sm}`,
  border: 0,
  fontSize: vars.typography.size.label,
  lineHeight: vars.typography.lineHeight.body,
  color: "inherit",
  borderRadius: vars.shape.radius.subtle,
  "@media": {
    "(max-width: 1000px)": {
      minHeight: 56,
      gridTemplateColumns: "1fr 1fr",
      gap: vars.space.xxs,
      padding: `${vars.space.sm}`,
    },
  },
});
export const entryName = style({
  fontWeight: 600,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  "@media": { "(max-width: 1000px)": { gridColumn: "1 / -1" } },
});
export const entryInstallation = style({
  fontSize: vars.typography.size.caption,
  lineHeight: vars.typography.lineHeight.body,
  opacity: 0.68,
});
export const entryStatus = style({
  fontSize: vars.typography.size.caption,
  lineHeight: vars.typography.lineHeight.body,
  opacity: 0.68,
  whiteSpace: "nowrap",
});
globalStyle(
  `${row}[data-selected="true"] .${entryInstallation}, ${row}[data-selected="true"] .${entryStatus}`,
  { opacity: 1 },
);
export const catalogActions = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: vars.space.xs,
  flexShrink: 0,
  minHeight: 24,
});
export const detail = style({
  minWidth: 0,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  gap: vars.space.lg,
});
export const officialView = style({
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  gap: vars.space.lg,
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
  minHeight: 72,
  padding: `${vars.space.md} ${vars.space.lg}`,
  borderRadius: vnextVars.radius.parent,
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
export const headerState = style({
  display: "grid",
  gridTemplateColumns: "108px 92px minmax(0, 1fr)",
  alignItems: "center",
  gap: vars.space.lg,
  "@media": {
    "(max-width: 1439px)": { gridColumn: "1 / -1", gridRow: 2 },
    "(max-width: 1000px)": { gridTemplateColumns: "60px 60px minmax(0, 1fr)", gap: vars.space.md },
  },
});
export const headerActions = style({
  display: "flex",
  alignItems: "center",
  gap: vars.space.lg,
  "@media": { "(max-width: 1439px)": { gridColumn: 2, gridRow: 1, gap: vars.space.sm } },
});
globalStyle(`${headerActions} > button`, {
  minWidth: 144,
  "@media": { "(max-width: 1439px)": { minWidth: 112 } },
});
export const toyHeader = style({
  gridTemplateColumns: "minmax(0, 400px) minmax(0, 484px) auto",
  "@media": { "(max-width: 1439px)": { gridTemplateColumns: "minmax(0, 1fr) auto" } },
});
export const toyIdentity = style({
  padding: `${vars.space.xs} ${vars.space.md}`,
  borderRadius: vnextVars.radius.inset,
});
export const detailBody = style({
  minHeight: 0,
  flex: 1,
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  gap: vars.space.lg,
});
export const group = style({ display: "grid", gap: vars.space.md, alignContent: "start" });
export const related = style({
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) auto",
  alignItems: "center",
  gap: vars.space.sm,
  minHeight: 40,
  borderBottom: `${vars.border.width.hairline} solid ${vars.color.border.subtle}`,
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
export const settingsColumns = style({
  display: "grid",
  gridTemplateColumns: "minmax(0, 50fr) minmax(0, 33fr)",
  alignItems: "start",
  minWidth: 0,
  minHeight: 0,
  height: "100%",
  gap: vars.space.lg,
  "@media": {
    "(max-width: 1439px)": {
      display: "flex",
      flexDirection: "column",
      alignItems: "stretch",
      gap: 0,
      overflow: "hidden",
      background: vars.color.surface.raised,
      borderRadius: vnextVars.radius.parent,
    },
  },
});
export const settingsSingle = style({
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
  minHeight: 0,
  height: "100%",
  maxWidth: 800,
});
export const settingsBody = style({ display: "contents" });
globalStyle(`${settingsColumns} > .${settingsBody}`, {
  "@media": {
    "(max-width: 1439px)": {
      display: "flex",
      flexDirection: "column",
      flex: 1,
      minHeight: 0,
      padding: vars.space.lg,
      overflowY: "auto",
      overscrollBehavior: "contain",
      gap: vars.space.lg,
    },
  },
});
export const connectionColumn = style({
  minWidth: 0,
  minHeight: 0,
  maxHeight: "100%",
  display: "flex",
  flexDirection: "column",
  gap: vars.space.lg,
});
export const connectionPanel = style({
  minWidth: 0,
  minHeight: 0,
  maxHeight: "100%",
  overflowY: "auto",
  overscrollBehavior: "contain",
  display: "flex",
  flexDirection: "column",
  gap: vars.space.md,
  padding: vars.space.lg,
  borderRadius: vnextVars.radius.parent,
});
export const weatherConnection = style({ height: 404, flexShrink: 1 });
export const observationPanel = style({
  minWidth: 0,
  minHeight: 0,
  height: 220,
  flexShrink: 0,
  overflowY: "auto",
  overscrollBehavior: "contain",
  padding: vars.space.lg,
  borderRadius: vnextVars.radius.parent,
});
export const connectionFields = style({ minWidth: 0, padding: 0, margin: 0, border: 0 });
export const appearancePanel = style({
  minWidth: 0,
  minHeight: 0,
  height: 718,
  maxHeight: "100%",
  display: "flex",
  flexDirection: "column",
  gap: vars.space.md,
  overflow: "hidden",
  padding: vars.space.lg,
  borderRadius: vnextVars.radius.parent,
});
export const appearanceActions = style({ flexShrink: 0, minWidth: 0 });
export const compactActions = style({
  display: "none",
  minWidth: 0,
  flexShrink: 0,
  padding: `0 ${vars.space.lg} ${vars.space.lg}`,
  "@media": { "(max-width: 1439px)": { display: "block" } },
});
globalStyle(`${settingsColumns} .${connectionColumn}`, {
  "@media": { "(max-width: 1439px)": { display: "contents" } },
});
globalStyle(`${settingsColumns} .${connectionPanel}, ${settingsColumns} .${observationPanel}`, {
  "@media": {
    "(max-width: 1439px)": {
      height: "auto",
      maxHeight: "none",
      overflow: "visible",
      padding: 0,
      borderRadius: 0,
      flexShrink: 0,
    },
  },
});
globalStyle(`${settingsColumns} .${appearancePanel}`, {
  "@media": { "(max-width: 1439px)": { display: "contents" } },
});
globalStyle(`${settingsColumns} .${appearance.settings}`, {
  "@media": { "(max-width: 1439px)": { display: "contents" } },
});
globalStyle(`${settingsColumns} .${appearance.body}`, {
  "@media": { "(max-width: 1439px)": { overflow: "visible", flex: "none" } },
});
globalStyle(`${settingsColumns} .${appearanceActions}`, {
  "@media": { "(max-width: 1439px)": { display: "none" } },
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
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
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
  borderRadius: vnextVars.radius.parent,
});
export const toyPanel = style([genericPanel, { minHeight: 236 }]);
export const toyCounts = style({
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: vars.space.lg,
  alignItems: "center",
  minHeight: 72,
  fontSize: vars.typography.size.headingSm,
  lineHeight: vars.typography.lineHeight.compact,
});
export const toyDescription = style({
  display: "grid",
  gap: vars.space.lg,
  paddingTop: vars.space.lg,
  borderTop: `${vars.border.width.hairline} solid ${vars.color.border.subtle}`,
});
export const empty = style({ padding: `${vars.space.lg} 0` });
export const footer = style({
  flexShrink: 0,
  display: "grid",
  gap: vars.space.sm,
  paddingTop: vars.space.sm,
  borderTop: `${vars.border.width.hairline} solid ${vars.color.border.subtle}`,
});
globalStyle(`${footer} > div`, { flexWrap: "wrap" });
export const dialogBody = style({ display: "grid", gap: vars.space.lg });
export const runtimeMessages = style({
  flexShrink: 0,
  display: "grid",
  gap: vars.space.sm,
  padding: vars.space.lg,
  borderRadius: vnextVars.radius.parent,
});
export const runtimeError = style({ display: "flex", alignItems: "center", gap: vars.space.md });
export const more = style({ position: "relative", minWidth: 64 });
export const moreMenu = style({
  position: "absolute",
  top: "100%",
  right: 0,
  zIndex: 3,
  display: "grid",
  gap: vars.space.sm,
  padding: vars.space.md,
  width: 240,
  background: vars.color.surface.raised,
  border: `${vars.border.width.hairline} solid ${vars.color.border.subtle}`,
  borderRadius: vnextVars.radius.inset,
  boxShadow: "0 8px 24px #1010151A",
});
globalStyle(`${more} summary`, {
  listStyle: "none",
  cursor: "pointer",
  padding: `${vars.space.xs} ${vars.space.md}`,
  textAlign: "center",
  fontSize: 20,
  lineHeight: "24px",
  borderRadius: vars.shape.radius.subtle,
});
globalStyle(`${more} summary:focus-visible`, {
  outline: `2px solid ${vars.color.interaction.focus}`,
});
globalStyle(`${settings} h2`, {
  margin: 0,
  fontSize: vars.typography.size.headingSm,
  lineHeight: vars.typography.lineHeight.compact,
  fontWeight: 600,
  color: vars.color.content.primary,
});
globalStyle(`${settings} p`, {
  margin: 0,
  fontSize: vars.typography.size.caption,
  lineHeight: vars.typography.lineHeight.body,
});
globalStyle(`${settings} section`, { minWidth: 0 });
globalStyle(`${settings} .${common.field}`, { gap: vars.space.xs, marginBottom: 0 });
globalStyle(`${settings} .${tools.number}`, {
  fontSize: vars.typography.size.headingMd,
  lineHeight: vars.typography.lineHeight.tight,
  padding: 0,
  textAlign: "left",
  color: vars.color.content.primary,
});

export const experiments = style({
  flexShrink: 0,
  padding: vars.space.sm,
  borderBottom: `${vars.border.width.hairline} solid ${vars.color.border.subtle}`,
  maxHeight: "40%",
  overflowY: "auto",
});
globalStyle(`${experiments} > summary`, { cursor: "pointer" });
globalStyle(`${experiments}[open] > :not(summary)`, { marginTop: vars.space.sm });
