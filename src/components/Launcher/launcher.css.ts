import { globalStyle, style } from "@vanilla-extract/css";
import { semanticVars as vars } from "@fleetia/lagrange/theme";

export const window = style({
  height: "auto",
  minHeight: 250,
  maxHeight: 500,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  background: vars.color.surface.canvas,
  color: vars.color.content.primary,
});
export const header = style({
  height: 32,
  flexShrink: 0,
  padding: "0 12px",
  borderBottom: `1px solid ${vars.color.border.subtle}`,
});
export const search = style({
  display: "flex",
  alignItems: "center",
  gap: 12,
  margin: "12px 16px 8px",
  padding: "4px 0 10px",
  borderBottom: `2px solid ${vars.color.selection.indicator}`,
  flexShrink: 0,
});
export const searchIcon = style({
  fontSize: 24,
  color: vars.color.content.secondary,
  lineHeight: 1,
});
export const input = style({
  width: "100%",
  minWidth: 0,
  border: 0,
  background: "transparent",
  color: vars.color.content.primary,
  fontSize: 19,
  padding: "6px 0",
  outline: "none",
  selectors: { "&:focus-visible": { outline: "none" } },
});
export const hint = style({
  padding: "0 16px 8px",
  margin: 0,
  flexShrink: 0,
  fontSize: vars.typography.size.caption,
  color: vars.color.content.secondary,
});
export const results = style({
  listStyle: "none",
  margin: 0,
  padding: "0 8px 8px",
  flex: "0 1 auto",
  maxHeight: 282,
  minHeight: 48,
  overflowY: "auto",
});
export const result = style({
  display: "flex",
  alignItems: "center",
  gap: 12,
  minHeight: 47,
  padding: "7px 12px",
  cursor: "pointer",
  borderRadius: 4,
  selectors: {
    '&[aria-selected="true"]': {
      background: vars.color.selection.surface,
      color: vars.color.content.accent,
    },
    '&[aria-disabled="true"]': { cursor: "default" },
  },
});
export const glyph = style({
  width: 25,
  textAlign: "center",
  fontSize: 18,
  flexShrink: 0,
  opacity: 0.75,
});
export const resultText = style({
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minWidth: 0,
  gap: 3,
});
export const title = style({
  fontSize: vars.typography.size.body,
  overflow: "hidden",
  whiteSpace: "nowrap",
  textOverflow: "ellipsis",
});
export const detail = style({
  fontSize: vars.typography.size.caption,
  color: vars.color.content.secondary,
  overflow: "hidden",
  whiteSpace: "nowrap",
  textOverflow: "ellipsis",
});
export const preview = style({
  flexShrink: 0,
  borderTop: `1px solid ${vars.color.border.subtle}`,
  padding: "11px 20px",
  background: vars.color.surface.muted,
  display: "flex",
  flexDirection: "column",
  gap: 6,
});
export const previewLabel = style({
  fontSize: vars.typography.size.caption,
  color: vars.color.content.secondary,
});
export const previewText = style({
  margin: 0,
  fontSize: vars.typography.size.body,
  lineHeight: 1.5,
  overflowWrap: "anywhere",
  whiteSpace: "pre-wrap",
  maxHeight: 60,
  overflowY: "auto",
});
export const footer = style({
  display: "flex",
  justifyContent: "space-between",
  gap: 8,
  alignItems: "center",
  padding: "7px 16px",
  flexShrink: 0,
  fontSize: vars.typography.size.caption,
  color: vars.color.content.secondary,
  borderTop: `1px solid ${vars.color.border.subtle}`,
});
export const keys = style({ display: "flex", gap: 12 });
globalStyle(`${keys} kbd`, { font: "inherit", color: vars.color.content.primary });
export const error = style({
  margin: "0 16px 8px",
  padding: 8,
  maxHeight: 100,
  overflowY: "auto",
  flexShrink: 0,
  fontSize: vars.typography.size.caption,
  background: vars.color.status.criticalSurface,
  color: vars.color.status.critical,
});
export const errorActions = style({ display: "flex", gap: 8, marginTop: 8 });
