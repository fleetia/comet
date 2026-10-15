import { style, styleVariants } from "@vanilla-extract/css";
import { tokens } from "@comet/token";
const focus = {
  "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 3 },
  "&:disabled": { opacity: 0.45, cursor: "not-allowed" },
};
export const provider = style({
  height: 32,
  width: 107.333,
  padding: 0,
  borderRadius: 16,
  border: "none",
  background: "transparent",
  color: tokens["color/ink-2"],
  fontSize: 13,
});
export const counter = style({
  position: "relative",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  border: `1px solid ${tokens["color/pill-border"]}`,
  background: tokens["color/glass-pill"],
  backdropFilter: "blur(8px)",
  boxShadow: "0 8px 10px rgba(0,0,0,0.26)",
  color: tokens["color/ink"],
  padding: 0,
  cursor: "pointer",
  selectors: focus,
});
export const counterSizes = styleVariants({
  regular: { width: 44, height: 44, borderRadius: 22 },
  compact: { width: 28, height: 28, borderRadius: 14 },
});
export const noBackdrop = style({
  background: "transparent",
  borderColor: "transparent",
  boxShadow: "none",
  backdropFilter: "none",
});
export const countBadge = style({
  position: "absolute",
  right: -7,
  top: -7,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  boxSizing: "border-box",
  minWidth: 16,
  height: 16,
  padding: "0 4px",
  borderRadius: 8,
  background: tokens["color/cat-record"],
  color: tokens["color/check-ink"],
  fontFamily: tokens["typography/sans/body/fontFamily"],
  fontSize: 10,
  fontWeight: 600,
});
export const mediumBadge = style({ minWidth: 20, height: 20, borderRadius: 10, fontSize: 11 });
export const calendarChip = style({
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  height: 30,
  padding: "0 11px 0 9px",
  border: `1px solid ${tokens["color/chip-border"]}`,
  borderRadius: 14,
  background: tokens["color/chip"],
  color: tokens["color/ink"],
  fontFamily: tokens["typography/sans/body/fontFamily"],
  fontSize: 12.5,
  cursor: "pointer",
  selectors: focus,
});
export const muted = style({
  borderStyle: "dashed",
  background: "transparent",
  color: tokens["color/ink-3"],
});
export const calendarDot = style({
  width: 8,
  height: 8,
  borderRadius: 4,
  background: tokens["color/event-google"],
  selectors: {
    [`${muted} &`]: {
      boxSizing: "border-box",
      border: `1.5px solid ${tokens["color/ink-3"]}`,
      background: "transparent",
    },
  },
});
export const categoryButton = style({
  display: "inline-flex",
  border: "none",
  borderRadius: 15,
  background: "transparent",
  padding: 0,
  cursor: "pointer",
  selectors: focus,
});
export const categoryChoice = style({ background: "transparent", fontWeight: 400 });
export const categorySizes = styleVariants({
  regular: { height: 32, padding: "0 12px 0 10px", borderRadius: 15, fontSize: 13 },
  compact: { height: 26, padding: "0 9px 0 7px", borderRadius: 12, fontSize: 12 },
  medium: { height: 30, padding: "0 12px 0 10px", borderRadius: 14, fontSize: 12.5 },
});
export const categorySelected = style({
  borderColor: tokens["color/cat-work"],
  background: tokens["color/component/cat-work-alpha-200"],
  color: tokens["color/ink"],
  fontWeight: 600,
});
export const prompt = style({
  height: 30,
  minHeight: 30,
  padding: "0 12px",
  borderRadius: 15,
  fontSize: 13,
});
export const countChip = style({
  height: 30,
  minHeight: 30,
  padding: "0 12px",
  borderRadius: 15,
  gap: 6,
  fontSize: 13,
});
export const countSelected = style({
  background: tokens["color/component/selected-icon-alpha-140"],
  color: tokens["color/comet"],
  borderColor: tokens["color/selected-border"],
  fontWeight: 600,
});
export const countLabel = style({ fontSize: 12, color: "inherit" });
