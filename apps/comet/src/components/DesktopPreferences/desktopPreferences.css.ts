import { style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";
import { semanticVars as vars } from "@fleetia/lagrange/theme";

export const toys = style({
  minHeight: 160,
  display: "flex",
  flexDirection: "column",
  gap: vars.space.md,
});
export const toyChoices = style({
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
  alignItems: "center",
});
export const toyPreview = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 14,
  minHeight: 120,
  borderRadius: 18,
  background: tokens["color/card"],
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
