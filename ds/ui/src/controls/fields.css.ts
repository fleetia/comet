import { style, styleVariants } from "@vanilla-extract/css";
import { tokens } from "@comet/token";
import { stateTransition } from "../motion/motion.css";

export const field = style({
  display: "inline-flex",
  flexDirection: "column",
  gap: 4,
  minWidth: 0,
  maxWidth: "100%",
  verticalAlign: "top",
});
export const label = style({
  fontFamily: tokens["typography/sans/body/fontFamily"],
  fontSize: 13,
  lineHeight: "19.5px",
  color: tokens["color/ink"],
});
export const description = style({
  fontFamily: tokens["typography/sans/caption/fontFamily"],
  fontSize: 12,
  lineHeight: "18px",
  color: tokens["color/ink-2"],
});
export const error = style([description, { color: tokens["color/danger"], fontSize: 12.5 }]);
export const input = style([
  stateTransition,
  {
    boxSizing: "border-box",
    appearance: "none",
    height: 32,
    width: 200,
    maxWidth: "100%",
    minWidth: 0,
    margin: 0,
    padding: "0 11px",
    border: `1px solid ${tokens["color/input-border"]}`,
    borderRadius: tokens["radius/radius-9"],
    background: tokens["color/input"],
    color: tokens["color/ink"],
    fontFamily: tokens["typography/sans/body/fontFamily"],
    fontSize: 13,
    fontWeight: 400,
    lineHeight: "19.5px",
    selectors: {
      "&::placeholder": { color: tokens["color/component/placeholder"], opacity: 1 },
      "&:hover:not(:disabled)": { borderColor: tokens["color/ink-3"] },
      "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 2 },
      '&[aria-invalid="true"]': { borderColor: tokens["color/danger"] },
      "&:disabled": { opacity: 0.45, cursor: "not-allowed" },
    },
  },
]);
export const textareaLayouts = styleVariants({
  compact: {
    width: 220,
    height: 54,
    padding: "7px 11px",
    borderRadius: tokens["radius/radius-10"],
    lineHeight: "19px",
    resize: "vertical",
  },
  fixed: {
    width: 712,
    height: 92,
    padding: "8px 12px",
    borderRadius: tokens["radius/radius-12"],
    fontSize: 13.5,
    resize: "none",
  },
  flexible: {
    width: 316,
    minHeight: 78,
    height: 78,
    padding: "8px 12px",
    borderRadius: tokens["radius/radius-12"],
    fontSize: 13.5,
    resize: "vertical",
  },
  "code-compact": {
    width: 332,
    height: 58,
    padding: "8px 12px",
    borderRadius: tokens["radius/radius-12"],
    fontFamily: '"IBM Plex Mono", monospace',
    fontSize: 12,
    resize: "vertical",
  },
  plain: {
    width: 264,
    height: 40,
    padding: 0,
    border: "none",
    borderRadius: 0,
    background: "transparent",
    fontSize: 14,
    resize: "vertical",
  },
  "code-padded": {
    width: 284,
    height: 168,
    padding: 12,
    borderRadius: tokens["radius/radius-14"],
    fontFamily: '"IBM Plex Mono", monospace',
    fontSize: 12,
    resize: "vertical",
  },
});
export const selectContainer = style({
  position: "relative",
  display: "inline-flex",
  minWidth: 0,
  maxWidth: "100%",
});
export const select = style({
  height: 30,
  width: "auto",
  minWidth: 95,
  paddingLeft: 13,
  paddingRight: 32,
  borderRadius: tokens["radius/radius-10"],
  background: tokens["color/card"],
  borderColor: tokens["color/card-border"],
  cursor: "pointer",
  textOverflow: "ellipsis",
});
export const multipleSelect = style({ height: "auto", minHeight: 90, padding: "6px 11px" });
export const selectWithLeading = style({ paddingLeft: 32 });
export const selectLeading = style({
  position: "absolute",
  left: 12,
  top: "50%",
  transform: "translateY(-50%)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 14,
  height: 14,
  pointerEvents: "none",
  zIndex: 1,
});
export const selectIcon = style({
  position: "absolute",
  right: 11,
  top: "50%",
  transform: "translateY(-50%)",
  color: tokens["color/ink-2"],
  pointerEvents: "none",
});
export const searchContainer = style([
  stateTransition,
  {
    boxSizing: "border-box",
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    color: tokens["color/ink-3"],
    maxWidth: "100%",
    selectors: {
      "&:focus-within": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 2 },
      '&[data-invalid="true"]': { borderColor: tokens["color/danger"] },
      '&[data-disabled="true"]': { opacity: 0.45 },
    },
  },
]);
export const searchAppearances = styleVariants({
  outlined: {
    width: 200,
    height: 34,
    padding: "0 14px",
    border: `1px solid ${tokens["color/chip-border"]}`,
    borderRadius: 17,
    background: tokens["color/chip"],
  },
  plain: { width: 144, height: 20, color: tokens["color/ink"] },
  large: { width: 200, height: 30, color: tokens["color/ink"] },
  medium: { width: 173, height: 20, color: tokens["color/ink"] },
});
export const searchInput = style({
  boxSizing: "border-box",
  appearance: "none",
  background: "transparent",
  color: tokens["color/ink"],
  border: "none",
  borderRadius: "inherit",
  margin: 0,
  padding: 0,
  height: "100%",
  width: "100%",
  minWidth: 0,
  outline: "none",
  fontFamily: tokens["typography/sans/body/fontFamily"],
  fontSize: 13,
  lineHeight: "19.5px",
  selectors: {
    "&::placeholder": { color: tokens["color/ink-3"], opacity: 1 },
    "&:disabled": { cursor: "not-allowed" },
  },
});
export const searchInputSizes = styleVariants({
  outlined: {},
  plain: {},
  large: { fontSize: 20, lineHeight: "30px" },
  medium: { fontSize: 13.5, lineHeight: "20px" },
});

// `fill`: the control spans its parent. Without visible messages the wrapper steps out of layout.
export const fillField = style({ width: "100%" });
export const contentsField = style({ display: "contents" });
export const fillInput = style({ width: "100%" });
export const fillTextarea = style({ width: "100%", height: "auto" });
export const fillSelectContainer = style({ width: "100%", flex: "1 1 auto" });
export const fillSelect = style({ width: "100%", minWidth: 0 });
