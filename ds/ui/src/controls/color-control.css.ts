import { style, styleVariants } from "@vanilla-extract/css";
import { tokens } from "@comet/token";
export const control = style({
  appearance: "none",
  boxSizing: "border-box",
  display: "inline-block",
  width: 236,
  maxWidth: "100%",
  height: 10,
  padding: 0,
  margin: 0,
  border: "none",
  borderRadius: 5,
  cursor: "pointer",
  selectors: {
    "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 4 },
    "&:disabled": { opacity: 0.45, cursor: "not-allowed" },
    "&::-webkit-slider-thumb": {
      appearance: "none",
      width: 14,
      height: 14,
      border: `2px solid ${tokens["color/document-star"]}`,
      borderRadius: 7,
      background: "hsl(var(--comet-color-control-hue) 100% 50%)",
      boxShadow: "0 2px 6px rgba(0,0,0,0.175)",
    },
    "&::-moz-range-thumb": {
      width: 10,
      height: 10,
      border: `2px solid ${tokens["color/document-star"]}`,
      borderRadius: 7,
      background: "hsl(var(--comet-color-control-hue) 100% 50%)",
      boxShadow: "0 2px 6px rgba(0,0,0,0.175)",
    },
  },
});
export const appearances = styleVariants({
  hue: {
    background:
      "linear-gradient(90deg,#f00 0%,#ff0 16.667%,#0f0 33.333%,#0ff 50%,#00f 66.667%,#f0f 83.333%,#f00 100%)",
  },
  lightness: {
    height: 74,
    borderRadius: 10,
    background: `linear-gradient(90deg,${tokens["color/document-star"]},hsl(var(--comet-color-control-hue) 100% 50%))`,
    selectors: {
      "&::-webkit-slider-thumb": { transform: "translateY(-26px)" },
      "&::-moz-range-thumb": { transform: "translateY(-26px)" },
    },
  },
});
