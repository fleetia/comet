import { globalStyle, style } from "@vanilla-extract/css";
import { semanticVars as vars } from "@fleetia/lagrange/theme";

export const workspace = style({ height: "100%", minHeight: 0, minWidth: 0 });
export const layout = style({
  display: "grid",
  gridTemplateColumns: "320px minmax(0,1fr)",
  gap: vars.space.lg,
  height: "100%",
  minHeight: 0,
  "@media": {
    "(max-width: 1280px)": { gridTemplateColumns: "224px minmax(0,1fr)" },
    "(max-width: 1000px)": { gridTemplateColumns: "192px minmax(0,1fr)" },
  },
});
export const entries = style({ minHeight: 0, minWidth: 0, overflow: "hidden", display: "flex" });
export const listBody = style({
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  padding: vars.space.lg,
  scrollbarGutter: "stable",
});
export const sectionTitle = style({
  fontSize: vars.typography.size.headingSm,
  lineHeight: vars.typography.lineHeight.compact,
  fontWeight: 600,
  margin: `0 0 ${vars.space.md}`,
});
export const entry = style({
  width: "100%",
  display: "grid",
  gap: vars.space.xs,
  textAlign: "left",
  minHeight: 64,
  overflowWrap: "anywhere",
  whiteSpace: "normal",
});
export const entryKeywords = style({
  fontSize: vars.typography.size.caption,
  lineHeight: vars.typography.lineHeight.body,
  color: vars.color.content.secondary,
  selectors: {
    [`${entry}[aria-pressed="true"] &`]: { color: vars.color.content.onAccent },
  },
});
export const heading = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: vars.space.lg,
  minHeight: 28,
  marginBottom: vars.space.md,
});
export const form = style({ minWidth: 0, minHeight: 0, overflow: "hidden", display: "flex" });
export const editorForm = style({ display: "flex", flex: 1, minWidth: 0, minHeight: 0 });
export const editor = style({
  display: "flex",
  flexDirection: "column",
  flex: 1,
  border: 0,
  margin: 0,
  padding: 0,
  minWidth: 0,
  minHeight: 0,
});
export const editorBody = style({
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  padding: vars.space.lg,
  scrollbarGutter: "stable",
});
export const fields = style({
  display: "grid",
  gridTemplateColumns: "minmax(0, 0.6fr) minmax(0,1fr)",
  gap: vars.space.lg,
});
export const keywordsInput = style({
  height: vars.dimension.control,
  minHeight: vars.dimension.control,
  resize: "vertical",
});
export const legend = style({
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
});
export const lineHeading = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  paddingTop: vars.space.md,
  borderTop: `${vars.border.width.hairline} solid ${vars.color.border.subtle}`,
});
export const line = style({
  padding: `${vars.space.md} 0 ${vars.space.xl}`,
});
export const lineControls = style({
  display: "flex",
  alignItems: "center",
  gap: vars.space.sm,
  flexWrap: "wrap",
  marginBottom: vars.space.sm,
});
globalStyle(`${lineControls} select`, { width: "100%" });
globalStyle(`${lineControls} > label`, { width: 160 });
export const lineNumber = style({ width: 32, flexShrink: 0 });
export const lineLimit = style({
  marginRight: "auto",
  color: vars.color.content.secondary,
  fontSize: vars.typography.size.caption,
});
export const motion = style({ minWidth: 160 });
globalStyle(`${motion} > div`, { alignItems: "center", margin: 0, padding: 0 });
globalStyle(`${motion} > div > div:first-child > div:first-child`, {
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  clipPath: "inset(50%)",
});
globalStyle(`${listBody} > button:last-child`, { width: "100%", marginTop: vars.space.sm });
export const lineText = style({ minHeight: 70, height: 70 });
export const actions = style({
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: vars.space.sm,
});
export const saveStatus = style({
  marginRight: "auto",
  fontSize: vars.typography.size.caption,
  color: vars.color.content.secondary,
});
export const saveBar = style({
  flexShrink: 0,
  padding: `${vars.space.md} ${vars.space.lg}`,
  borderTop: `${vars.border.width.hairline} solid ${vars.color.border.subtle}`,
  background: vars.color.surface.raised,
});
export const confirmation = style({
  padding: vars.space.md,
  display: "grid",
  gap: vars.space.sm,
  color: vars.color.content.primary,
  background: vars.color.surface.muted,
  fontSize: vars.typography.size.body,
});
export const preview = style({
  minHeight: 128,
  marginBottom: vars.space.lg,
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
});

export const groupField = style({ maxWidth: 240 });
export const previewDetails = style({ marginBottom: vars.space.md });
globalStyle(`${previewDetails} > summary`, {
  cursor: "pointer",
  fontWeight: 600,
  padding: `${vars.space.sm} 0`,
});
export const previewLines = style({ margin: 0, paddingLeft: vars.space.lg });
export const previewText = style({ display: "block", whiteSpace: "pre-wrap" });
export const matchTest = style({
  marginBottom: vars.space.lg,
  padding: vars.space.md,
  background: vars.color.surface.muted,
});
export const testControls = style({
  display: "flex",
  alignItems: "end",
  gap: vars.space.sm,
  flexWrap: "wrap",
});
globalStyle(`${testControls} > div`, { flex: "1 1 240px" });
export const warning = style({
  padding: vars.space.md,
  borderLeft: `${vars.border.width.hairline} solid ${vars.color.border.subtle}`,
  background: vars.color.surface.muted,
  fontSize: vars.typography.size.body,
});
