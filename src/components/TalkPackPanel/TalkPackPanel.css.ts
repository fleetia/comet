import { style } from "@vanilla-extract/css";
import { semanticVars as vars, vnextVars } from "@fleetia/lagrange/theme";
export const workspace = style({
  display: "grid",
  gridTemplateColumns: "368px minmax(0,800px)",
  maxWidth: 1184,
  gap: vars.space.lg,
  minHeight: 0,
  height: "100%",
  alignItems: "start",
  "@media": { "(max-width: 1280px)": { gridTemplateColumns: "224px minmax(0,1fr)" } },
});
export const catalogue = style({
  display: "grid",
  gap: vars.space.sm,
  alignContent: "start",
  minHeight: 232,
  maxHeight: "100%",
  overflowY: "auto",
});
export const catalogueHeading = style({ minHeight: 28 });
export const list = style({
  display: "grid",
  gap: vars.space.sm,
  listStyle: "none",
  padding: 0,
  margin: 0,
});
export const item = style({
  display: "grid",
  width: "100%",
  textAlign: "left",
  gap: vars.space.xs,
  minHeight: 56,
});
export const caption = style({
  fontSize: vars.typography.size.caption,
  lineHeight: vars.typography.lineHeight.body,
  color: vars.color.content.secondary,
  selectors: {
    [`${item}[aria-pressed="true"] &`]: { color: vars.color.content.onAccent },
  },
});
export const detail = style({
  display: "grid",
  gap: vars.space.lg,
  alignContent: "start",
  minHeight: 464,
  minWidth: 0,
  maxHeight: "100%",
  overflowY: "auto",
  "@media": { "(max-height: 700px)": { minHeight: 0 } },
});
export const header = style({
  display: "flex",
  alignItems: "center",
  minHeight: vars.dimension.control,
  justifyContent: "space-between",
  gap: vars.space.lg,
});
export const status = style({
  background: vars.color.surface.muted,
  padding: `${vars.space.xs} ${vars.space.md}`,
  borderRadius: vnextVars.radius.inset,
  minWidth: 164,
  fontSize: vars.typography.size.caption,
});
export const context = style({
  display: "grid",
  gap: vars.space.sm,
  minHeight: 128,
  alignContent: "start",
});
export const actions = style({
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: vars.space.lg,
});
export const actionButton = style({ minWidth: 120 });
export const manuscript = style({
  borderTop: `${vars.border.width.hairline} solid ${vars.color.border.subtle}`,
  paddingTop: vars.space.lg,
  display: "grid",
  gap: vars.space.lg,
});
