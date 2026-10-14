import { style } from "@vanilla-extract/css";
import { semanticVars as vars } from "@fleetia/lagrange/theme";

export const toys = style({
  minHeight: 160,
  display: "flex",
  flexDirection: "column",
  gap: vars.space.md,
});
export const toyChoices = style({
  display: "grid",
  gridTemplateColumns: "144fr 196fr 196fr 144fr",
  gap: vars.space.lg,
  minHeight: vars.dimension.row,
  "@media": {
    "(max-width: 1400px)": {
      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
      gap: `${vars.space.sm} ${vars.space.lg}`,
    },
  },
});
export const saveBar = style({
  flexShrink: 0,
  minHeight: 44,
  background: vars.color.surface.raised,
});
export const saveButton = style({ width: 112 });
export const cleanup = style({
  display: "flex",
  gap: vars.space.md,
  alignItems: "center",
  minHeight: vars.dimension.control,
});
export const cleanupButton = style({ width: 168 });
