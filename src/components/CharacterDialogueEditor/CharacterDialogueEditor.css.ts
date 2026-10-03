import { globalStyle, style } from "@vanilla-extract/css";
import { semanticVars as vars } from "@fleetia/lagrange/theme";
export const editor = style({
  display: "flex",
  flexDirection: "column",
  gap: vars.space.md,
  minWidth: 0,
  minHeight: 0,
  height: "100%",
});
export const sceneLayout = style({
  display: "grid",
  gridTemplateColumns: "320px minmax(0,1fr)",
  gap: vars.space.lg,
  minWidth: 0,
  flex: 1,
  minHeight: 0,
  height: "100%",
  "@media": { "(max-width: 1280px)": { gridTemplateColumns: "192px minmax(0,1fr)" } },
});
export const sceneList = style({ minHeight: 0 });
export const sceneRow = style({
  display: "grid",
  gap: vars.space.xs,
  minHeight: 56,
  textAlign: "left",
  overflowWrap: "anywhere",
});
export const sceneHeading = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: vars.space.lg,
});
export const preview = style({
  display: "grid",
  gap: vars.space.sm,
  minHeight: 160,
  marginBlock: vars.space.lg,
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
});
export const line = style({
  display: "grid",
  gap: vars.space.sm,
  paddingBlock: vars.space.md,
  borderTop: `${vars.border.width.hairline} solid ${vars.color.border.subtle}`,
});
export const structureActions = style({
  display: "flex",
  flexWrap: "wrap",
  gap: vars.space.sm,
  marginTop: vars.space.md,
});

export const ownerPanel = style({
  flex: 1,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
});
globalStyle(`${ownerPanel}[hidden]`, { display: "none" });
