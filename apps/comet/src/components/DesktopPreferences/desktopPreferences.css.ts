import { style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const toys = style({
  minHeight: 160,
  display: "flex",
  flexDirection: "column",
  gap: tokens["spacing/space-12"],
});
export const toyChoices = style({
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
  alignItems: "center",
});
export const activityChoices = style({
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: tokens["spacing/space-12"],
  padding: tokens["spacing/space-12"],
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
  background: tokens["color/glass-panel"],
});
export const saveButton = style({ width: 112 });
export const cleanup = style({
  display: "flex",
  gap: tokens["spacing/space-12"],
  alignItems: "center",
  minHeight: tokens["size/control-36"],
});
