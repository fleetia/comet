import { style } from "@vanilla-extract/css";
import { semanticVars as vars } from "@fleetia/lagrange/theme";

export const header = style({
  display: "flex",
  alignItems: "flex-start",
  gap: vars.space.md,
  width: "100%",
});
export const title = style({
  flex: 1,
  alignSelf: "stretch",
  minWidth: 0,
  userSelect: "none",
});
export const grabTarget = style({
  cursor: "grab",
  ":active": { cursor: "grabbing" },
});
export const actions = style({
  display: "flex",
  alignItems: "center",
  flexShrink: 0,
  gap: vars.space.sm,
});
export const close = style({ fontSize: 24, lineHeight: 1 });
