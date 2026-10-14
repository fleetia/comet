import { style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

import { slideIn, stateTransition } from "../motion/motion.css";

export const tabs = style({ display: "flex", flexDirection: "column", gap: 12 });
export const tabList = style({ display: "flex", alignItems: "center", flexWrap: "wrap" });
export const tab = style([
  stateTransition,
  {
    boxSizing: "border-box",
    appearance: "none",
    display: "inline-flex",
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
      '&:hover:not(:disabled):not([aria-selected="true"])': {
        background: tokens["color/component/selected-icon-alpha-80"],
      },
      "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 2 },
      "&:disabled": { opacity: 0.45, cursor: "not-allowed" },
    },
  },
]);

export const tabPanel = style({
  selectors: {
    "&:not([hidden])": {
      animation: `${slideIn} ${tokens["duration/duration-base"]} ${tokens["easing/ease-out"]}`,
    },
  },
  "@media": {
    "(prefers-reduced-motion: reduce)": {
      selectors: {
        "&:not([hidden])": { animation: "none" },
      },
    },
  },
});

export const segmentedControl = style({
  display: "inline-flex",
  alignItems: "center",
  flexWrap: "wrap",
});
export const segment = style([
  stateTransition,
  {
    boxSizing: "border-box",
    position: "relative",
    display: "inline-flex",
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
