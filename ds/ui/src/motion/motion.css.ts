import { globalStyle, keyframes, style, styleVariants } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const reducedMotionQuery = "(prefers-reduced-motion: reduce)";
export const stateTransitionValue = [
  "background-color",
  "border-color",
  "color",
  "box-shadow",
  "opacity",
]
  .map(
    (property) =>
      `${property} ${tokens["duration/duration-fast"]} ${tokens["easing/ease-standard"]}`,
  )
  .join(", ");

export const stateTransition = style({
  transition: stateTransitionValue,
  "@media": { [reducedMotionQuery]: { transition: "none" } },
});

export const pressable = style({
  transition: `${stateTransitionValue}, transform ${tokens["duration/duration-pop"]} ${tokens["easing/ease-spring"]}`,
  selectors: {
    "&:active:not(:disabled)": {
      transform: `scale(${tokens["scale/scale-pressed"]})`,
      transition: `${stateTransitionValue}, transform ${tokens["duration/duration-fast"]} ${tokens["easing/ease-out"]}`,
    },
    '[data-comet-motion="reduced"] &:active:not(:disabled)': { transform: "none" },
  },
  "@media": {
    [reducedMotionQuery]: {
      transition: "none",
      selectors: { "&:active:not(:disabled)": { transform: "none", transition: "none" } },
    },
  },
});

export const popIn = keyframes({
  from: { opacity: 0, transform: `scale(${tokens["scale/scale-pop-from"]})` },
  to: { opacity: 1, transform: "scale(1)" },
});
export const slideIn = keyframes({
  from: { opacity: 0, transform: "translateY(4px)" },
  to: { opacity: 1, transform: "translateY(0)" },
});
export const fadeIn = keyframes({ from: { opacity: 0 }, to: { opacity: 1 } });
export const exit = keyframes({
  from: {
    opacity: "var(--comet-motion-exit-opacity, 1)",
    transform: "var(--comet-motion-exit-transform, none)",
  },
  to: { opacity: 0, transform: "translateY(4px)" },
});
export const pulse = keyframes({
  "0%, 100%": { opacity: 0.45 },
  "50%": { opacity: 1 },
});

export const presence = style({
  animationFillMode: "backwards",
  selectors: {
    '&[data-state="exiting"]': {
      animationName: exit,
      animationDuration: tokens["duration/duration-fast"],
      animationTimingFunction: tokens["easing/ease-standard"],
      animationDelay: "0s",
      animationFillMode: "forwards",
      pointerEvents: "none",
    },
  },
  "@media": { [reducedMotionQuery]: { animation: "none !important" } },
});
export const presets = styleVariants({
  pop: {
    animationName: popIn,
    animationDuration: tokens["duration/duration-pop"],
    animationTimingFunction: tokens["easing/ease-bounce"],
  },
  slide: {
    animationName: slideIn,
    animationDuration: tokens["duration/duration-base"],
    animationTimingFunction: tokens["easing/ease-out"],
  },
  fade: {
    animationName: fadeIn,
    animationDuration: tokens["duration/duration-fast"],
    animationTimingFunction: tokens["easing/ease-standard"],
  },
});

globalStyle(
  '[data-comet-motion="reduced"], [data-comet-motion="reduced"] *, [data-comet-motion="reduced"] *::before, [data-comet-motion="reduced"] *::after',
  {
    animation: "none !important",
    transition: "none !important",
  },
);
