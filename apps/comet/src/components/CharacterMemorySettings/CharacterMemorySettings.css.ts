import { style } from "@vanilla-extract/css";
import { semanticVars as vars } from "@fleetia/lagrange/theme";
export const workspace = style({
  display: "flex",
  flexDirection: "column",
  height: "100%",
  minWidth: 0,
  minHeight: 0,
});
export const identity = style({
  display: "grid",
  gap: 6,
  marginBottom: vars.space.md,
  minHeight: 96,
  alignContent: "center",
});
export const actions = style({
  display: "grid",
  gridTemplateColumns: "minmax(0,880fr) minmax(0,544fr)",
  gap: vars.space.lg,
  flex: 1,
  minHeight: 0,
});
export const commandRow = style({
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: vars.space.lg,
  minHeight: 64,
  "@media": {
    "(max-width: 1280px)": { flexDirection: "column", alignItems: "start", gap: vars.space.sm },
  },
});
export const boundary = style({
  borderTop: `${vars.border.width.hairline} solid ${vars.color.border.subtle}`,
  marginTop: vars.space.lg,
  paddingTop: vars.space.lg,
});
export const detailRow = style({
  display: "grid",
  gridTemplateColumns: "140px minmax(0,1fr)",
  gap: vars.space.lg,
  alignItems: "center",
  minHeight: 40,
  marginBlock: vars.space.md,
  "@media": { "(max-width: 1280px)": { gridTemplateColumns: "72px minmax(0,1fr)" } },
});
