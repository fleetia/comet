import { globalStyle, style } from "@vanilla-extract/css";
import { semanticVars as vars } from "@fleetia/lagrange/theme";

export const list = style({ listStyle: "none", padding: 0, margin: 0 });
export const listItem = style({
  display: "flex",
  alignItems: "center",
  gap: vars.space.xs,
  minWidth: 0,
  minHeight: 40,
  borderBottom: `1px solid ${vars.color.border.subtle}`,
});
export const preview = style({
  flex: 1,
  minWidth: 0,
  border: 0,
  background: "transparent",
  padding: `${vars.space.sm} 0`,
  textAlign: "left",
  font: "inherit",
  color: vars.color.content.primary,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  cursor: "pointer",
  ":focus-visible": { outline: `2px solid ${vars.color.interaction.focus}`, outlineOffset: 2 },
});
globalStyle(`${list} button${preview}`, { whiteSpace: "nowrap" });
export const dialogActions = style({
  display: "flex",
  gap: vars.space.sm,
  marginTop: vars.space.md,
});
export const editor = style({
  display: "block",
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  width: "100%",
  resize: "none",
  border: 0,
  borderRadius: 0,
  padding: vars.space.md,
  color: "inherit",
  background: "transparent",
  fontFamily: vars.typography.family.ui,
  lineHeight: 1.55,
  overflowY: "auto",
  overflowWrap: "anywhere",
  ":focus": { outline: "none" },
  ":focus-visible": { boxShadow: `inset 0 0 0 1px ${vars.color.interaction.focus}` },
  "::placeholder": { color: vars.color.content.secondary },
});
export const footer = style({
  display: "grid",
  gap: vars.space.xs,
  width: "100%",
  color: vars.color.content.secondary,
  fontSize: vars.typography.size.caption,
});
export const footerRow = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: vars.space.sm,
});
export const fontControls = style({
  display: "flex",
  alignItems: "center",
  gap: vars.space.xs,
});
export const failure = style({
  display: "grid",
  gap: vars.space.xs,
  padding: vars.space.md,
  overflowWrap: "anywhere",
  maxHeight: "40dvh",
  overflowY: "auto",
});
