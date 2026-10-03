import { style } from "@vanilla-extract/css";
import { semanticVars as v } from "@fleetia/lagrange/theme";

export const context = style({ borderTop: `1px solid ${v.color.border.subtle}`, paddingTop: 12 });
export const summary = style({
  cursor: "pointer",
  fontSize: v.typography.size.label,
  fontWeight: 600,
  selectors: {
    "&:focus-visible": { outline: `2px solid ${v.color.interaction.focus}`, outlineOffset: 3 },
  },
});
export const body = style({ display: "grid", gap: 16, paddingTop: 12, minWidth: 0 });
export const connections = style({
  display: "grid",
  gap: 12,
  padding: 0,
  margin: 0,
  listStyle: "none",
});
export const heading = style({ fontSize: v.typography.size.label, fontWeight: 500, margin: 0 });
export const caption = style({
  color: v.color.content.secondary,
  fontSize: v.typography.size.caption,
  lineHeight: v.typography.lineHeight.body,
  margin: "4px 0 0",
  overflowWrap: "anywhere",
});
