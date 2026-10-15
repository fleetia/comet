import { style, styleVariants } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const inline = style({
  height: "auto",
  minHeight: 20,
  padding: 0,
  border: "none",
  borderRadius: 0,
  background: "transparent",
  lineHeight: "normal",
});
export const appearances = styleVariants({
  subtle: {
    width: 106,
    height: 34,
    padding: "0 12px",
    borderRadius: 10,
    background: tokens["color/card"],
    border: `1px solid ${tokens["color/card-border"]}`,
    fontSize: 13.5,
  },
  "plain-compact": { width: 163, fontSize: 13 },
  "plain-fill": { width: 130, fontSize: 14 },
  filled: {
    width: 680,
    height: 34,
    padding: "0 12px",
    borderRadius: 10,
    background: tokens["color/input"],
    border: `1px solid ${tokens["color/input-border"]}`,
    fontSize: 13.5,
  },
  "compact-field": {
    width: 258,
    height: 30,
    padding: "0 10px",
    borderRadius: 9,
    background: tokens["color/input"],
    border: `1px solid ${tokens["color/component/input-border-alpha-160"]}`,
    fontSize: 13,
  },
});
export const amount = style({ width: 64, textAlign: "right", fontVariantNumeric: "tabular-nums" });
export const amountTypography = styleVariants({
  strong: { fontSize: 15, fontWeight: 600 },
  regular: { width: 72, fontSize: 14 },
  compact: { fontSize: 13 },
});
export const message = style({ width: 264, fontSize: 15 });
export const messageHug = style({ width: 264, fontSize: 14 });
export const number = style({
  width: 56,
  height: 30,
  padding: "0 8px",
  borderRadius: 9,
  textAlign: "center",
});
export const time = style({
  width: 92,
  height: 32,
  padding: "0 8px",
  borderRadius: 10,
  textAlign: "center",
});
export const title = style({
  width: 101,
  fontFamily: tokens["typography/display/clock/fontFamily"],
  fontSize: 24,
  lineHeight: "30px",
});
export const url = style({
  width: 402,
  height: 34,
  padding: "0 12px",
  borderRadius: 10,
  fontFamily: '"IBM Plex Mono", monospace',
  fontSize: 12.5,
});
export const editor = style({
  width: 798,
  height: 636,
  minHeight: 120,
  padding: 0,
  border: "none",
  background: "transparent",
  fontSize: 15,
  lineHeight: "26px",
  resize: "vertical",
});
export const shortcut = style({
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  minHeight: 36,
  padding: "0 6px",
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: 10,
  background: tokens["color/card"],
  color: tokens["color/ink"],
  fontFamily: tokens["typography/sans/body/fontFamily"],
  fontSize: 13,
  selectors: {
    "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 2 },
    "&:disabled": { opacity: 0.45, cursor: "not-allowed" },
  },
});
export const property = style({
  display: "inline-flex",
  alignItems: "center",
  gap: 10,
  height: 38,
  padding: "0 4px 0 10px",
  border: "none",
  background: "transparent",
  color: tokens["color/ink"],
  fontFamily: tokens["typography/sans/body/fontFamily"],
  fontSize: 13.5,
  cursor: "pointer",
  selectors: {
    '&[aria-pressed="true"]': { color: tokens["color/comet"], fontWeight: 600 },
    "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 2 },
    "&:disabled": { opacity: 0.45, cursor: "not-allowed" },
  },
});
export const propertyValue = style({ color: tokens["color/ink-3"], fontSize: 12, fontWeight: 400 });
