import { style, styleVariants } from "@vanilla-extract/css";
import { tokens } from "@comet/token";
import { pressable, stateTransition } from "../motion/motion.css";

export const button = style([
  stateTransition,
  {
    boxSizing: "border-box",
    appearance: "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    flexShrink: 0,
    border: "1px solid transparent",
    borderRadius: tokens["radius/radius-18"],
    fontFamily: tokens["typography/sans/button/fontFamily"],
    fontSize: 14,
    fontWeight: 600,
    lineHeight: "21px",
    textDecoration: "none",
    whiteSpace: "nowrap",
    cursor: "pointer",
    selectors: {
      "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 3 },
      "&:disabled": { opacity: 0.45, cursor: "not-allowed" },
    },
  },
]);

export const sizes = styleVariants({
  regular: { height: tokens["size/control-36"], padding: "0 17px" },
  small: { height: 30, padding: "0 12px", fontSize: 13, lineHeight: "18px", borderRadius: 15 },
});

export const variants = styleVariants({
  primary: [
    pressable,
    {
      padding: "0 17px",
      background: tokens["color/primary"],
      color: tokens["color/on-primary"],
      selectors: {
        "&:hover:not(:disabled)": { background: tokens["color/primary-hover"] },
        "&:active:not(:disabled)": { background: tokens["color/primary-pressed"] },
      },
    },
  ],
  ghost: [
    pressable,
    {
      background: tokens["color/card"],
      borderColor: tokens["color/card-border"],
      color: tokens["color/ink"],
      fontSize: 13.5,
      fontWeight: 400,
      lineHeight: "20px",
      selectors: {
        "&:hover:not(:disabled)": { background: tokens["color/chip"] },
        "&:active:not(:disabled)": { background: tokens["color/track"] },
      },
    },
  ],
  selected: [
    pressable,
    {
      height: 30,
      padding: "0 12px",
      borderRadius: 15,
      fontSize: 13,
      lineHeight: "18px",
      background: tokens["color/selected"],
      borderColor: tokens["color/selected-border"],
      color: tokens["color/selected-ink"],
      selectors: {
        "&:hover:not(:disabled)": { background: tokens["color/component/selected-icon-alpha-230"] },
        "&:active:not(:disabled)": {
          background: tokens["color/component/selected-icon-alpha-310"],
        },
      },
    },
  ],
  link: {
    height: 18,
    padding: 0,
    border: "none",
    borderRadius: 0,
    background: "transparent",
    color: tokens["color/selected-icon"],
    fontSize: 13,
    fontWeight: 600,
    lineHeight: "18px",
    selectors: { "&:hover:not(:disabled)": { textDecoration: "underline" } },
  },
  danger: {
    height: 18,
    padding: 0,
    border: "none",
    borderRadius: 0,
    background: "transparent",
    color: tokens["color/danger"],
    fontSize: 13,
    fontWeight: 400,
    lineHeight: "18px",
    selectors: { "&:hover:not(:disabled)": { textDecoration: "underline" } },
  },
});

export const smallVariants = styleVariants({
  primary: { height: 30, padding: "0 11px", fontSize: 13, lineHeight: "18px", borderRadius: 15 },
  ghost: { height: 30, padding: "0 12px", fontSize: 13, lineHeight: "18px", borderRadius: 15 },
  selected: {},
  link: {},
  danger: {},
});

export const icon = style({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
});
export const iconButton = style({ padding: 0 });
export const iconSizes = styleVariants({
  compact: { width: 34, height: 34, borderRadius: 17 },
  regular: { width: 44, height: 44, borderRadius: tokens["radius/radius-22"] },
});
export const compactGhost = style({ width: 30, height: 30, borderRadius: 15 });
export const compactSurface = style({ borderRadius: tokens["radius/radius-16"] });
export const iconVariants = styleVariants({
  surface: [
    pressable,
    {
      background: tokens["color/card"],
      borderColor: tokens["color/card-border"],
      color: tokens["color/ink-2"],
      selectors: { "&:hover:not(:disabled)": { background: tokens["color/hover"] } },
    },
  ],
  primary: [
    pressable,
    {
      background: tokens["color/primary"],
      borderColor: "transparent",
      color: tokens["color/on-primary"],
      selectors: {
        "&:hover:not(:disabled)": { background: tokens["color/primary-hover"] },
        "&:active:not(:disabled)": { background: tokens["color/primary-pressed"] },
      },
    },
  ],
  ghost: [
    pressable,
    {
      background: "transparent",
      borderColor: "transparent",
      color: tokens["color/ink-2"],
      selectors: { "&:hover:not(:disabled)": { background: tokens["color/card"] } },
    },
  ],
});
