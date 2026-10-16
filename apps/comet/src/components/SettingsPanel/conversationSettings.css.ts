import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";
export const generation = style({ display: "flex", alignItems: "center", gap: 8 });
export const quietControls = style({
  display: "flex",
  flexWrap: "wrap",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 14,
  border: 0,
  margin: 0,
  padding: "10px 16px",
  minWidth: 0,
  borderTop: `1px solid ${tokens["color/divider"]}`,
});
export const timeControls = style({ display: "flex", alignItems: "center", gap: 8, minWidth: 0 });
export const weekdays = style({ display: "flex", alignItems: "center", gap: 5 });
export const weekday = style({
  width: 30,
  height: 30,
  padding: 0,
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: "50%",
  background: "transparent",
  color: tokens["color/ink-3"],
  cursor: "pointer",
  font: "inherit",
  fontSize: 12,
  selectors: {
    '&[aria-pressed="true"]': {
      background: tokens["color/component/primary-alpha-160"],
      color: tokens["color/comet"],
      borderColor: tokens["color/primary"],
    },
    "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 2 },
  },
});

// Native time fields need room for locale-specific segments and the picker icon.
globalStyle(`${timeControls} input`, { width: "auto" });
