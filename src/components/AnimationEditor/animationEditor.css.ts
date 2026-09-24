import { style } from "@vanilla-extract/css";
import { semanticVars as vars } from "@fleetia/lagrange/theme";

export const editor = style({ display: "grid", gap: vars.space.sm, minWidth: 0 });
export const controls = style({
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: vars.space.sm,
});
export const number = style({ width: 84 });
export const clipFields = style({
  display: "grid",
  gridTemplateColumns: "minmax(0,1fr) 100px",
  gap: vars.space.sm,
});
export const preview = style({
  display: "grid",
  placeItems: "center",
  minHeight: 132,
  padding: vars.space.sm,
  border: `1px dotted ${vars.color.border.subtle}`,
  background: vars.color.surface.canvas,
});
export const frames = style({
  display: "flex",
  flexWrap: "wrap",
  gap: vars.space.xs,
  maxHeight: 190,
  overflowY: "auto",
});
export const frame = style({
  display: "grid",
  gap: vars.space.xs,
  padding: vars.space.xs,
  border: `1px solid ${vars.color.border.subtle}`,
  selectors: {
    '&[data-selected="true"]': {
      borderColor: vars.color.selection.indicator,
      background: vars.color.selection.surface,
    },
  },
});
export const fallback = style({ display: "grid", placeItems: "center" });
export const frameActions = style({ display: "flex", gap: 2 });
export const binding = style({
  display: "grid",
  gridTemplateColumns: "minmax(80px, 1fr) minmax(110px, 2fr)",
  gap: vars.space.sm,
  alignItems: "center",
  padding: `${vars.space.sm} 0`,
  borderBottom: `1px dotted ${vars.color.border.subtle}`,
});
export const playback = style({
  gridColumn: "1 / -1",
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: vars.space.sm,
});
export const sheet = style({
  display: "flex",
  flexWrap: "wrap",
  alignItems: "end",
  gap: vars.space.sm,
});
export const expression = style({ marginTop: vars.space.sm });
