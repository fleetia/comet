import { style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

const trackBackground = `linear-gradient(to right, ${tokens["color/focus-ring"]} 0%, ${tokens["color/focus-ring"]} var(--comet-slider-progress), ${tokens["color/track"]} var(--comet-slider-progress), ${tokens["color/track"]} 100%)`;
const thumb = {
  boxSizing: "border-box",
  width: 22,
  height: 22,
  border: `3px solid ${tokens["color/focus-ring"]}`,
  borderRadius: 11,
  background: tokens["color/knob"],
  boxShadow: `0 2px 8px ${tokens["color/component/surface-shadow-alpha-350"]}`,
  transition: `transform ${tokens["duration/duration-pop"]} ${tokens["easing/ease-spring"]}, border-color ${tokens["duration/duration-fast"]} ${tokens["easing/ease-standard"]}`,
} as const;
const pressedThumb = {
  transform: `scale(${tokens["scale/scale-pressed"]})`,
  transition: `transform ${tokens["duration/duration-fast"]} ${tokens["easing/ease-out"]}`,
} as const;
const stillThumb = { transform: "none", transition: "none" } as const;

export const slider = style({
  boxSizing: "border-box",
  appearance: "none",
  width: 220,
  height: 24,
  maxWidth: "100%",
  padding: 0,
  margin: 0,
  border: "none",
  borderRadius: 3,
  background: "transparent",
  cursor: "pointer",
  selectors: {
    "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 3 },
    "&:disabled": { opacity: 0.45, cursor: "not-allowed" },
    "&::-webkit-slider-runnable-track": { height: 6, borderRadius: 3, background: trackBackground },
    "&::-webkit-slider-thumb": { ...thumb, appearance: "none", marginTop: -8 },
    "&::-moz-range-track": { height: 6, borderRadius: 3, background: trackBackground },
    "&::-moz-range-thumb": thumb,
    "&:active:not(:disabled)::-webkit-slider-thumb": pressedThumb,
    "&:active:not(:disabled)::-moz-range-thumb": pressedThumb,
    '[data-comet-motion="reduced"] &::-webkit-slider-thumb, [data-comet-motion="reduced"] &:active:not(:disabled)::-webkit-slider-thumb':
      stillThumb,
    '[data-comet-motion="reduced"] &::-moz-range-thumb, [data-comet-motion="reduced"] &:active:not(:disabled)::-moz-range-thumb':
      stillThumb,
  },
  "@media": {
    "(hover: hover) and (pointer: fine)": {
      selectors: {
        "&:hover:not(:disabled):not(:active)::-webkit-slider-thumb": {
          borderColor: tokens["color/primary-hover"],
        },
        "&:hover:not(:disabled):not(:active)::-moz-range-thumb": {
          borderColor: tokens["color/primary-hover"],
        },
      },
    },
    "(prefers-reduced-motion: reduce)": {
      selectors: {
        "&::-webkit-slider-thumb, &:active:not(:disabled)::-webkit-slider-thumb": stillThumb,
        "&::-moz-range-thumb, &:active:not(:disabled)::-moz-range-thumb": stillThumb,
      },
    },
  },
});
