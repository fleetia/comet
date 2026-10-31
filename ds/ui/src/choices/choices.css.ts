import { globalStyle, style, styleVariants } from "@vanilla-extract/css";
import { tokens } from "@comet/token";
export const choice = style({
  boxSizing: "border-box",
  display: "inline-flex",
  flexDirection: "column",
  justifyContent: "center",
  alignItems: "center",
  gap: 6,
  position: "relative",
  flexShrink: 0,
  maxWidth: "100%",
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: 14,
  background: tokens["color/card"],
  color: tokens["color/ink"],
  fontFamily: tokens["typography/sans/body/fontFamily"],
  fontSize: 13,
  cursor: "pointer",
  selectors: {
    '&[aria-pressed="true"]': {
      borderColor: tokens["color/selected-border"],
      borderWidth: 1.5,
      background: tokens["color/component/selected-icon-alpha-140"],
    },
    "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 3 },
    "&:disabled": { opacity: 0.45, cursor: "not-allowed" },
  },
});
export const kinds = styleVariants({
  character: {
    width: 230.667,
    padding: "12px 8px",
    borderRadius: 16,
    selectors: { '&[aria-pressed="false"]:not(:disabled)': { opacity: 0.5 } },
  },
  element: { width: 34, height: 34, padding: 0, borderRadius: 11 },
  widget: { width: 38, height: 38, padding: 0, borderRadius: 11 },
  "animation-frame": {
    width: 70,
    height: 84,
    padding: "6px 0 4px",
    borderRadius: 12,
    gap: 2,
    fontSize: 11.5,
  },
  expression: { width: 75.556, padding: "8px 4px", gap: 4, fontSize: 12 },
  "expression-text": { width: 117.333, padding: "26px 4px 10px", gap: 6, fontSize: 12.5 },
  "body-part": {
    flexDirection: "row",
    height: 32,
    padding: "0 11px 0 9px",
    gap: 5,
    borderRadius: 15,
    background: tokens["color/chip"],
    borderColor: tokens["color/chip-border"],
    color: tokens["color/ink-2"],
    fontSize: 12.5,
  },
  "desktop-layout": {
    width: 161,
    alignItems: "stretch",
    padding: "8px 8px 12px",
    borderRadius: 18,
    textAlign: "left",
  },
  anchor: {
    width: 24,
    height: 15,
    padding: 0,
    borderRadius: 5,
    borderStyle: "dashed",
    borderColor: tokens["color/ink-3"],
    background: "transparent",
    selectors: {
      '&[aria-pressed="true"]': {
        borderColor: "transparent",
        borderStyle: "solid",
        background: tokens["color/cat-record"],
      },
    },
  },
  cup: {
    padding: "4px 6px",
    gap: 4,
    border: "none",
    borderRadius: 12,
    background: "transparent",
    fontSize: 12,
  },
  "widget-preview": {
    width: 114.4,
    padding: "10px 8px 8px",
    gap: 8,
    border: "none",
    borderRadius: 14,
    background: "transparent",
    fontSize: 12.5,
  },
  theme: {
    width: 366,
    alignItems: "stretch",
    gap: 10,
    padding: "10px 10px 12px",
    borderRadius: 18,
    textAlign: "left",
    boxShadow: `0 1px 2px ${tokens["color/card-shadow"]}`,
    selectors: {
      '&[aria-pressed="true"]': {
        borderColor: tokens["color/selected-icon"],
        borderWidth: 2,
        padding: "9px 9px 11px",
        boxShadow: `0 2px 8px ${tokens["color/card-shadow"]}`,
      },
    },
  },
  "theme-add": {
    width: 366,
    minHeight: 172,
    gap: 4,
    padding: 16,
    borderRadius: 18,
    borderWidth: 1.5,
    borderStyle: "dashed",
    background: "transparent",
    textAlign: "center",
  },
});
export const themeAddGraphic = style({
  width: 40,
  height: 40,
  marginBottom: 8,
  borderRadius: 20,
  border: `1px solid ${tokens["color/card-border"]}`,
  background: tokens["color/card"],
  color: tokens["color/ink-2"],
});
export const graphic = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
});
export const label = style({ fontWeight: 600, fontSize: "inherit", lineHeight: "normal" });
export const description = style({
  color: tokens["color/ink-3"],
  fontWeight: 400,
  fontSize: 12,
  lineHeight: "16px",
});
export const badge = style({
  position: "absolute",
  top: 4.5,
  left: 4.5,
  display: "inline-flex",
  alignItems: "center",
  height: 16,
  padding: "0 5px",
  background: tokens["color/cat-record"],
  color: tokens["color/check-ink"],
  borderRadius: 8,
  fontSize: 10,
  fontWeight: 600,
});
export const themeGraphic = style({
  height: 112,
  width: "100%",
  borderRadius: 14,
  overflow: "hidden",
});
export const swatch = style({
  display: "inline-flex",
  position: "relative",
  padding: 0,
  flexShrink: 0,
  border: "none",
  borderRadius: "50%",
  cursor: "pointer",
  selectors: {
    '&[aria-pressed="true"]': {
      outline: `2px solid ${tokens["color/selected-border"]}`,
      outlineOffset: 2,
    },
    "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 3 },
    "&:disabled": { opacity: 0.45, cursor: "not-allowed" },
  },
});
export const inset = style({ boxShadow: `inset 0 0 0 1px ${tokens["color/card-border"]}` });
export const segment = style({
  boxSizing: "border-box",
  whiteSpace: "nowrap",
  display: "inline-flex",
  justifyContent: "center",
  alignItems: "center",
  flexShrink: 0,
  border: "1px solid transparent",
  background: "transparent",
  color: tokens["color/ink-2"],
  fontFamily: tokens["typography/sans/body/fontFamily"],
  cursor: "pointer",
  selectors: {
    '&[aria-pressed="true"]': {
      background: tokens["color/cat-record"],
      color: tokens["color/check-ink"],
      fontWeight: 600,
    },
    "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 2 },
    "&:disabled": { opacity: 0.45, cursor: "not-allowed" },
  },
});
export const segmentKinds = styleVariants({
  compact: { height: 26, padding: "0 14px", borderRadius: 13, fontSize: 12 },
  hug: { height: 30, padding: "0 14px", borderRadius: 15, fontSize: 13 },
  fill: { width: 162, height: 32, borderRadius: 16, fontSize: 13 },
  list: {
    width: 140,
    height: 34,
    padding: "0 12px",
    borderRadius: 10,
    fontSize: 13,
    selectors: {
      '&[aria-pressed="true"]': {
        background: tokens["color/component/selected-icon-alpha-140"],
        borderColor: tokens["color/selected-border"],
        color: tokens["color/comet"],
      },
    },
  },
  weekday: {
    width: 31,
    height: 30,
    padding: 0,
    borderRadius: 9,
    borderColor: tokens["color/card-border"],
    fontSize: 12.5,
  },
  "weekday-compact": {
    width: 32,
    height: 32,
    padding: 0,
    borderRadius: 15,
    borderColor: tokens["color/card-border"],
    fontSize: 12.5,
    selectors: {
      '&[aria-pressed="true"]': {
        background: tokens["color/component/selected-icon-alpha-140"],
        borderColor: tokens["color/selected-border"],
        color: tokens["color/comet"],
      },
    },
  },
  period: {
    height: 28,
    padding: "0 14px",
    borderRadius: 14,
    fontSize: 12.5,
    background: tokens["color/component/nav-badge"],
    color: tokens["color/component/calendar-block-ink"],
    boxShadow: "0 2px 4px rgba(32,44,96,0.08)",
  },
});

export const hidden = style({
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
  border: 0,
});

export const footer = style({
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "0 4px",
  width: "100%",
  boxSizing: "border-box",
});
export const footerText = style({
  display: "flex",
  flexDirection: "column",
  gap: 2,
  flex: 1,
  minWidth: 0,
  fontSize: 14.5,
  lineHeight: "19px",
});
export const footerBadge = style({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 22,
  height: 22,
  flexShrink: 0,
  borderRadius: 11,
  background: tokens["color/cat-record"],
  color: tokens["color/check-ink"],
});

globalStyle(`${kinds["expression-text"]} ${graphic}`, {
  fontSize: 15,
  lineHeight: "20px",
  whiteSpace: "nowrap",
});
globalStyle(
  `${kinds["expression-text"]} ${label}, ${kinds["body-part"]} ${label}, ${kinds.cup} ${label}, ${kinds["widget-preview"]} ${label}`,
  { fontWeight: 400 },
);
globalStyle(`${kinds.cup} ${label}`, { color: tokens["color/ink-2"], lineHeight: "16px" });
