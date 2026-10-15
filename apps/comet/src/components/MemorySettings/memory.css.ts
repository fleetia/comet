import { style } from "@vanilla-extract/css";
import { semanticVars as vars } from "@fleetia/lagrange/theme";
export const workspace = style({
  display: "flex",
  flexDirection: "column",
  height: "100%",
  flex: 1,
  minWidth: 0,
  minHeight: 0,
});
export const listEditor = style({
  display: "grid",
  gridTemplateColumns: "minmax(0,520fr) minmax(0,904fr)",
  gap: vars.space.lg,
  flex: 1,
  minHeight: 0,
  "@media": { "(max-width: 1280px)": { gridTemplateColumns: "192px minmax(0,1fr)" } },
});
export const listRow = style({
  display: "grid",
  gap: vars.space.xxs,
  minHeight: 56,
  textAlign: "left",
  whiteSpace: "normal",
});
export const metadata = style({
  fontSize: vars.typography.size.caption,
  lineHeight: vars.typography.lineHeight.body,
  color: vars.color.content.secondary,
  selectors: {
    [`${listRow}[aria-pressed="true"] &`]: { color: vars.color.content.onAccent },
  },
});
export const editor = style({
  border: 0,
  margin: 0,
  padding: 0,
  display: "grid",
  gap: vars.space.md,
  minWidth: 0,
});
export const heading = style({
  fontSize: vars.typography.size.headingSm,
  lineHeight: vars.typography.lineHeight.compact,
  fontWeight: 600,
  margin: 0,
});
export const editorHeading = style({
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: vars.space.lg,
  minHeight: vars.dimension.control,
});
export const memoryText = style({ minHeight: 192 });
export const evidence = style({
  borderTop: `${vars.border.width.hairline} solid ${vars.color.border.subtle}`,
  paddingTop: vars.space.md,
});
export const original = style({ whiteSpace: "pre-wrap", overflowWrap: "anywhere" });
