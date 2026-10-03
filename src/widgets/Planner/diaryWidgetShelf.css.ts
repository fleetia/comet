import { style } from "@vanilla-extract/css";
import { semanticVars as v } from "@fleetia/lagrange/theme";

export const shelf = style({
  borderTop: `1px solid ${v.color.border.subtle}`,
  marginTop: 20,
  paddingTop: 12,
});
export const heading = style({
  fontWeight: 600,
  cursor: "pointer",
  fontSize: v.typography.size.label,
});
export const hint = style({
  color: v.color.content.secondary,
  fontSize: v.typography.size.caption,
  lineHeight: v.typography.lineHeight.body,
  margin: "8px 0",
});
export const group = style({ marginTop: 8 });
export const row = style({ display: "flex", gap: 2, alignItems: "center", minWidth: 0 });
export const name = style({
  flex: 1,
  minWidth: 0,
  padding: "6px 2px",
  border: 0,
  background: "transparent",
  color: v.color.content.primary,
  font: "inherit",
  textAlign: "left",
  cursor: "pointer",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  selectors: {
    "&:hover": { textDecoration: "underline" },
    "&:focus-visible": { outline: `2px solid ${v.color.interaction.focus}`, outlineOffset: 1 },
    "&:disabled": { opacity: 0.5, cursor: "default" },
  },
});
export const itemName = style([name, { fontSize: v.typography.size.caption }]);
export const items = style({ paddingLeft: 24 });
export const list = style({ maxHeight: 240, overflowY: "auto" });
