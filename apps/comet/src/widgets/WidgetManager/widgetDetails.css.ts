import { style } from "@vanilla-extract/css";
import { semanticVars as vars, vnextVars } from "@fleetia/lagrange/theme";

export const header = style({
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: vars.space.md,
  padding: vars.space.lg,
  alignItems: "center",
  flexShrink: 0,
  borderRadius: vnextVars.radius.parent,
});
export const state = style({
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: vars.space.md,
  gridRow: 2,
  gridColumn: "1 / -1",
  selectors: { "&:empty": { display: "none" } },
  "@media": { "(max-width: 1000px)": { gridColumn: "1" } },
});
export const actions = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  flexWrap: "wrap",
  gap: vars.space.sm,
  "@media": {
    "(max-width: 1000px)": { gridRow: 2, gridColumn: "2" },
  },
});
