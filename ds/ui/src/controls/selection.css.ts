import { style, styleVariants } from "@vanilla-extract/css";
import { tokens } from "@comet/token";
import { popIn, stateTransition } from "../motion/motion.css";

export const row = style({
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  fontFamily: tokens["typography/sans/body/fontFamily"],
  fontSize: 13,
  lineHeight: "19.5px",
  color: tokens["color/ink"],
  cursor: "pointer",
  selectors: { '&[data-disabled="true"]': { opacity: 0.45, cursor: "not-allowed" } },
});
export const control = style({ position: "relative", flexShrink: 0, display: "inline-flex" });
export const input = style({
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  margin: 0,
  opacity: 0,
  zIndex: 1,
  cursor: "inherit",
});
export const indicator = style([
  stateTransition,
  {
    boxSizing: "border-box",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: `1.5px solid ${tokens["color/ink-3"]}`,
    background: "transparent",
    color: "transparent",
    pointerEvents: "none",
    selectors: {
      [`${input}:checked + &, ${input}:indeterminate + &`]: {
        background: tokens["color/focus-ring"],
        borderColor: tokens["color/focus-ring"],
        color: tokens["color/check-ink"],
      },
      [`${input}:focus-visible + &`]: {
        outline: `2px solid ${tokens["color/focus-ring"]}`,
        outlineOffset: 3,
      },
      [`${input}[aria-invalid="true"] + &`]: { borderColor: tokens["color/danger"] },
    },
  },
]);
export const checkIcon = style({
  display: "none",
  selectors: {
    [`${input}:checked:not(:indeterminate) + ${indicator} &`]: {
      display: "block",
      animation: `${popIn} ${tokens["duration/duration-pop"]} ${tokens["easing/ease-bounce"]}`,
    },
  },
  "@media": {
    "(prefers-reduced-motion: reduce)": {
      selectors: {
        [`${input}:checked:not(:indeterminate) + ${indicator} &`]: { animation: "none" },
      },
    },
  },
});
export const mixedIcon = style({
  display: "none",
  selectors: {
    [`${input}:indeterminate + ${indicator} &`]: {
      display: "block",
      animation: `${popIn} ${tokens["duration/duration-pop"]} ${tokens["easing/ease-bounce"]}`,
    },
  },
  "@media": {
    "(prefers-reduced-motion: reduce)": {
      selectors: {
        [`${input}:indeterminate + ${indicator} &`]: { animation: "none" },
      },
    },
  },
});
export const shapes = styleVariants({
  square: { width: 18, height: 18, borderRadius: tokens["radius/radius-6"] },
  round: { width: 20, height: 20, borderRadius: tokens["radius/radius-10"] },
});
export const radioRow = style({
  minHeight: 26,
  fontSize: tokens["typography/display/label-display/fontSize"],
  lineHeight: "18px",
});
export const radioIndicator = style({
  boxSizing: "border-box",
  width: 16,
  height: 16,
  borderRadius: 8,
  border: `1.5px solid ${tokens["color/ink-3"]}`,
  pointerEvents: "none",
  transition: `border-color ${tokens["duration/duration-fast"]} ${tokens["easing/ease-standard"]}, border-width ${tokens["duration/duration-fast"]} ${tokens["easing/ease-standard"]}`,
  selectors: {
    [`${input}:checked + &`]: { borderWidth: 5, borderColor: tokens["color/cat-record"] },
    [`${input}:focus-visible + &`]: {
      outline: `2px solid ${tokens["color/focus-ring"]}`,
      outlineOffset: 3,
    },
    [`${input}[aria-invalid="true"] + &`]: { borderColor: tokens["color/danger"] },
  },
  "@media": { "(prefers-reduced-motion: reduce)": { transition: "none" } },
});
export const switchTrack = style([
  stateTransition,
  {
    boxSizing: "border-box",
    width: 46,
    height: 28,
    padding: 3,
    borderRadius: tokens["radius/radius-14"],
    background: tokens["color/track"],
    pointerEvents: "none",
    selectors: {
      [`${input}:checked + &`]: { background: tokens["color/switch-on"] },
      [`${input}:focus-visible + &`]: {
        outline: `2px solid ${tokens["color/focus-ring"]}`,
        outlineOffset: 3,
      },
      [`${input}[aria-invalid="true"] + &`]: {
        outline: `1px solid ${tokens["color/danger"]}`,
        outlineOffset: 1,
      },
    },
  },
]);
export const switchKnob = style({
  display: "block",
  width: 22,
  height: 22,
  borderRadius: 11,
  background: tokens["color/knob"],
  boxShadow: `0 1px 3px ${tokens["color/component/surface-shadow-alpha-300"]}`,
  transition: `transform ${tokens["duration/duration-base"]} ${tokens["easing/ease-out"]}`,
  selectors: { [`${input}:checked + ${switchTrack} &`]: { transform: "translateX(18px)" } },
  "@media": { "(prefers-reduced-motion: reduce)": { transition: "none" } },
});
