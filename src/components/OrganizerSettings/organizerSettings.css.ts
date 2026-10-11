import { style } from "@vanilla-extract/css";
import { semanticVars as v } from "@fleetia/lagrange/theme";

export const panel = style({
  display: "flex",
  flexDirection: "column",
  gap: v.space.lg,
  minWidth: 0,
});
export const section = style({
  display: "flex",
  flexDirection: "column",
  gap: v.space.md,
  minWidth: 0,
});
export const heading = style({ fontSize: v.typography.size.headingSm, fontWeight: 600 });
export const caption = style({
  color: v.color.content.secondary,
  fontSize: v.typography.size.caption,
  lineHeight: v.typography.lineHeight.body,
  overflowWrap: "anywhere",
});
export const actions = style({
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: v.space.sm,
});
export const grid = style({
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: v.space.md,
  "@media": { "(max-width: 1000px)": { gridTemplateColumns: "minmax(0, 1fr)" } },
});
export const field = style({ minWidth: 0 });
export const fieldset = style({ border: 0, margin: 0, padding: 0, minWidth: 0 });
export const textarea = style({
  width: "100%",
  boxSizing: "border-box",
  resize: "vertical",
  color: v.color.content.primary,
  background: v.color.surface.canvas,
  border: `1px solid ${v.color.border.subtle}`,
  borderRadius: 6,
  padding: v.space.sm,
  font: "inherit",
});
export const path = style({ display: "flex", gap: v.space.sm, alignItems: "center" });
export const item = style({
  display: "flex",
  flexDirection: "column",
  gap: v.space.sm,
  paddingBlock: v.space.md,
  borderTop: `1px solid ${v.color.border.subtle}`,
  overflowWrap: "anywhere",
});
export const text = style({
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  lineHeight: v.typography.lineHeight.body,
  fontSize: v.typography.size.body,
});
export const save = style({
  position: "sticky",
  bottom: 0,
  background: v.color.surface.raised,
  paddingBlock: v.space.sm,
  display: "flex",
  flexWrap: "wrap",
  gap: v.space.sm,
  alignItems: "center",
  borderTop: `1px solid ${v.color.border.subtle}`,
});
