import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const colorField = style({
  display: "grid",
  boxSizing: "border-box",
  width: "100%",
  minWidth: 0,
  height: tokens["spacing/space-32"],
  gridTemplateColumns: "auto minmax(0, 1fr)",
  alignItems: "center",
  gap: tokens["spacing/space-6"],
  paddingInline: tokens["spacing/space-4"],
  color: tokens["color/ink"],
  backgroundColor: "transparent",
  borderInlineStart: "2px solid transparent",
  transition: "background-color 100ms ease, border-color 100ms ease",
  selectors: {
    "&:focus-within": { backgroundColor: tokens["color/input"] },
    '&[data-invalid="true"]': {
      backgroundColor: tokens["color/component/danger-alpha-100"],
      borderInlineStartColor: tokens["color/danger"],
    },
    '&[data-disabled="true"]': {
      color: tokens["color/ink-3"],
      backgroundColor: tokens["color/card-2"],
      cursor: "not-allowed",
      opacity: 0.68,
    },
  },
});

export const swatch = style({
  boxSizing: "border-box",
  width: "1.35rem",
  height: "1.35rem",
  margin: 0,
  padding: 0,
  overflow: "hidden",
  backgroundColor: "transparent",
  border: `1px solid ${tokens["color/input-border"]}`,
  borderRadius: 0,
  cursor: "pointer",
  selectors: {
    "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: "1px" },
    "&:disabled": { cursor: "not-allowed" },
  },
});
globalStyle(`${swatch}::-webkit-color-swatch-wrapper`, { padding: 0 });
globalStyle(`${swatch}::-webkit-color-swatch`, { border: 0, borderRadius: 0 });
globalStyle(`${swatch}::-moz-color-swatch`, { border: 0, borderRadius: 0 });

export const colorInput = style({
  boxSizing: "border-box",
  width: "100%",
  minWidth: 0,
  height: "100%",
  margin: 0,
  padding: 0,
  color: "inherit",
  backgroundColor: "transparent",
  border: 0,
  borderRadius: 0,
  outline: 0,
  fontFamily: '"IBM Plex Mono", monospace',
  fontSize: tokens["typography/sans/body/fontSize"],
  fontVariantNumeric: "tabular-nums",
  lineHeight: "1.385",
  selectors: {
    "&::placeholder": { color: tokens["color/component/placeholder"], opacity: 0.72 },
    "&:disabled": { cursor: "not-allowed" },
  },
});

export const placementPicker = style({
  display: "inline-grid",
  minWidth: 0,
  gridTemplateColumns: "repeat(3, 2rem)",
  gap: tokens["spacing/space-4"],
  padding: tokens["spacing/space-6"],
  backgroundColor: tokens["color/glass-panel"],
  borderBlock: `1px solid ${tokens["color/divider"]}`,
});

export const placementOption = style({
  position: "relative",
  boxSizing: "border-box",
  width: "2rem",
  height: "2rem",
  padding: 0,
  color: tokens["color/ink-2"],
  backgroundColor: "transparent",
  border: `1px solid ${tokens["color/divider"]}`,
  borderRadius: 0,
  cursor: "pointer",
  selectors: {
    "&::after": {
      position: "absolute",
      inset: "0.6875rem",
      backgroundColor: "transparent",
      content: "",
    },
    "&:hover:not(:disabled)": {
      color: tokens["color/ink"],
      backgroundColor: tokens["color/hover"],
      borderColor: tokens["color/selected-border"],
    },
    '&[data-checked="true"]': {
      color: tokens["color/selected-ink"],
      backgroundColor: tokens["color/selected"],
      borderColor: tokens["color/selected-border"],
    },
    '&[data-checked="true"]::after': { backgroundColor: tokens["color/selected-border"] },
    "&:focus-visible": {
      backgroundColor: tokens["color/hover"],
      borderColor: tokens["color/focus-ring"],
      outline: `1px solid ${tokens["color/focus-ring"]}`,
      outlineOffset: "-1px",
    },
    "&:disabled": {
      color: tokens["color/ink-3"],
      backgroundColor: tokens["color/card-2"],
      cursor: "not-allowed",
      opacity: 0.62,
    },
  },
});
