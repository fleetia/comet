import { globalStyle, style } from "@vanilla-extract/css";
import { semanticVars as vars } from "@fleetia/lagrange/theme";
import { tokens } from "@comet/token";

export const window = style({
  height: "auto",
  minHeight: 250,
  maxHeight: 500,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  background: tokens["color/glass-panel"],
  border: `1px solid ${tokens["color/glass-border"]}`,
  borderRadius: 24,
  backdropFilter: tokens["backdrop/backdrop-window"],
  boxSizing: "border-box",
  color: vars.color.content.primary,
});
export const header = style({
  height: 0,
});
export const search = style({
  display: "flex",
  alignItems: "center",
  gap: 14,
  minHeight: 66,
  margin: 0,
  padding: "0 18px 0 20px",
  borderBottom: `1px solid ${tokens["color/divider"]}`,
  flexShrink: 0,
});
export const searchIcon = style({
  display: "flex",
  alignItems: "center",
  color: tokens["color/selected-icon"],
  lineHeight: 1,
});
export const input = style({
  width: "100%",
  minWidth: 0,
  border: 0,
  background: "transparent",
  color: vars.color.content.primary,
  fontSize: 20,
  fontFamily: tokens["typography/sans/body/fontFamily"],
  padding: "6px 0",
  outline: "none",
  selectors: {
    "&:focus-visible": { outline: "none" },
    "&::placeholder": { color: tokens["color/ink-3"] },
  },
});
export const hint = style({
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  clipPath: "inset(50%)",
});
export const results = style({
  listStyle: "none",
  margin: 0,
  padding: "8px 10px 10px",
  flex: "0 1 auto",
  maxHeight: 380,
  minHeight: 48,
  overflowY: "auto",
});
export const result = style({
  display: "flex",
  alignItems: "center",
  gap: 12,
  minHeight: 54,
  padding: "9px 12px",
  cursor: "pointer",
  borderRadius: tokens["radius/radius-12"],
  border: "1px solid transparent",
  selectors: {
    '&[aria-selected="true"]': {
      background: tokens["color/selected"],
      color: tokens["color/selected-ink"],
      borderColor: tokens["color/selected-border"],
    },
    '&[aria-disabled="true"]': { cursor: "default" },
  },
});
export const glyph = style({
  width: 36,
  height: 36,
  display: "grid",
  placeItems: "center",
  borderRadius: tokens["radius/radius-10"],
  background: tokens["color/icon-tile"],
  color: tokens["color/icon-tile-ink"],
  flexShrink: 0,
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
  fontWeight: 600,
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
globalStyle(`${result}[aria-selected="true"] ${detail}`, {
  color: tokens["color/selected-ink"],
  opacity: 0.8,
});
export const preview = style({
  flexShrink: 0,
  borderTop: `1px solid ${vars.color.border.subtle}`,
  padding: "11px 20px",
  background: tokens["color/component/selected-icon-alpha-80"],
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
  minHeight: 42,
  padding: "8px 18px",
  flexShrink: 0,
  fontSize: vars.typography.size.caption,
  color: vars.color.content.secondary,
  borderTop: `1px solid ${vars.color.border.subtle}`,
});
export const keys = style({ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" });
globalStyle(`${keys} > span`, { display: "inline-flex", alignItems: "center", gap: 5 });
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
  borderRadius: tokens["radius/radius-10"],
});
export const errorActions = style({ display: "flex", gap: 8, marginTop: 8 });

export const pickFriend = style({
  flexShrink: 0,
  display: "inline-flex",
  gap: 6,
  border: `1px solid ${tokens["color/chip-border"]}`,
  background: tokens["color/chip"],
  borderRadius: 13,
  height: 26,
  minHeight: 26,
  padding: "0 10px 0 6px",
  fontSize: 12,
  color: tokens["color/ink-2"],
  "@media": { "(max-width: 420px)": { fontSize: 0, padding: "0 4px", gap: 0 } },
});

export const groupLabel = style({
  padding: "8px 12px 4px",
  fontSize: 12,
  color: tokens["color/ink-3"],
});
