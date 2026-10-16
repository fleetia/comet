import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

import { reducedMotionQuery, stateTransition } from "../motion/motion.css";

export const tabs = style({ display: "flex", flexDirection: "column", gap: 12 });
export const tabList = style({
  position: "relative",
  isolation: "isolate",
  display: "flex",
  alignItems: "center",
  flexWrap: "nowrap",
  minWidth: 0,
  overflowX: "auto",
  padding: 4,
  margin: -4,
  scrollbarWidth: "none",
  selectors: { "&::-webkit-scrollbar": { display: "none" } },
});
export const indicator = style({
  position: "absolute",
  left: 0,
  top: 0,
  zIndex: 0,
  pointerEvents: "none",
  borderRadius: "999px",
  transition: `transform ${tokens["duration/duration-base"]} ${tokens["easing/ease-out"]}, width ${tokens["duration/duration-base"]} ${tokens["easing/ease-out"]}`,
  selectors: { "&[data-disabled]": { opacity: 0.45 } },
  "@media": { [reducedMotionQuery]: { transition: "none" } },
});
export const tabIndicator = style({
  background: tokens["color/component/selected-icon-alpha-140"],
});
export const segmentIndicator = style({ background: tokens["color/primary"] });
export const tab = style([
  stateTransition,
  {
    boxSizing: "border-box",
    position: "relative",
    zIndex: 1,
    appearance: "none",
    display: "inline-flex",
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    height: 34,
    padding: "0 15px",
    margin: 0,
    border: "none",
    borderRadius: 17,
    background: "transparent",
    color: tokens["color/ink-2"],
    fontFamily: tokens["typography/sans/body/fontFamily"],
    fontSize: 13.5,
    fontWeight: 400,
    lineHeight: "normal",
    whiteSpace: "nowrap",
    cursor: "pointer",
    selectors: {
      '&[aria-selected="true"]': {
        background: tokens["color/component/selected-icon-alpha-140"],
        color: tokens["color/comet"],
        fontWeight: 600,
      },
      [`${tabList}[data-indicator-ready] &[aria-selected="true"]`]: { background: "transparent" },
      '&:hover:not(:disabled):not([aria-selected="true"])': {
        background: tokens["color/component/selected-icon-alpha-80"],
      },
      "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 2 },
      "&:disabled": { opacity: 0.45, cursor: "not-allowed" },
    },
  },
]);

export const segmentedControl = style({
  position: "relative",
  isolation: "isolate",
  display: "inline-flex",
  alignItems: "center",
  flexWrap: "nowrap",
  maxWidth: "100%",
  overflowX: "auto",
  padding: 4,
  margin: -4,
  scrollbarWidth: "none",
  selectors: { "&::-webkit-scrollbar": { display: "none" } },
});
export const segment = style([
  stateTransition,
  {
    boxSizing: "border-box",
    position: "relative",
    zIndex: 1,
    display: "inline-flex",
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    height: 26,
    padding: "3.75px 14px",
    borderRadius: 13,
    color: tokens["color/ink-2"],
    fontFamily: tokens["typography/sans/body/fontFamily"],
    fontSize: 12.5,
    fontWeight: 400,
    lineHeight: "18.5px",
    whiteSpace: "nowrap",
    cursor: "pointer",
    selectors: {
      "&:has(input:checked)": {
        background: tokens["color/primary"],
        color: tokens["color/on-primary"],
        fontWeight: 600,
      },
      [`${segmentedControl}[data-indicator-ready] &:has(input:checked)`]: {
        background: "transparent",
      },
      "&:has(input:focus-visible)": {
        outline: `2px solid ${tokens["color/focus-ring"]}`,
        outlineOffset: 2,
      },
      "&:has(input:disabled)": { opacity: 0.45, cursor: "not-allowed" },
    },
  },
]);
export const segmentInput = style({
  position: "absolute",
  width: 1,
  height: 1,
  margin: 0,
  padding: 0,
  overflow: "hidden",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
});

export const contained = style({
  margin: 0,
  padding: 3,
  gap: 2,
  minHeight: 34,
  outline: `1px solid ${tokens["color/card-border"]}`,
  outlineOffset: -1,
  borderRadius: 16,
  background: tokens["color/card"],
});

export const displayModeSegment = style({
  width: 90,
  height: 30,
  borderRadius: 15,
  fontSize: 13,
  lineHeight: "18px",
});

globalStyle(`${contained} > ${segment}:not(${displayModeSegment})`, {
  height: 28,
  borderRadius: 14,
});
