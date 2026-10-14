import { style, styleVariants } from "@vanilla-extract/css";
import { tokens } from "@comet/token";
import { stateTransition } from "../motion/motion.css";

export const surface = style({
  boxSizing: "border-box",
  position: "relative",
  color: tokens["color/ink"],
  fontFamily: tokens["typography/sans/body/fontFamily"],
  fontSize: 13,
  lineHeight: "18px",
  border: `1px solid ${tokens["color/glass-border"]}`,
  borderRadius: tokens["radius/radius-22"],
  background: tokens["color/glass-panel"],
  backdropFilter: "blur(12px)",
  boxShadow: `inset 0 1px 0 ${tokens["color/window-highlight"]}, 0 22px 48px ${tokens["color/surface-shadow"]}, 0 0 0 ${tokens["color/surface-halo"]}`,
});

export const variants = styleVariants({
  window: {
    overflow: "clip",
    borderColor: tokens["color/glass-border-soft"],
    background: tokens["color/glass-window"],
    backdropFilter: "blur(15px)",
    boxShadow: `inset 0 1px 0 ${tokens["color/window-highlight"]}, 0 30px 80px ${tokens["color/window-shadow"]}`,
  },
  sheet: {},
  popover: { borderRadius: tokens["radius/radius-18"] },
});

export const menuItem = style([
  stateTransition,
  {
    boxSizing: "border-box",
    appearance: "none",
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 7,
    width: "100%",
    height: 28,
    margin: 0,
    padding: "0 10px",
    border: "none",
    borderRadius: 7,
    background: "transparent",
    color: tokens["color/ink"],
    fontFamily: tokens["typography/sans/body/fontFamily"],
    fontSize: 13,
    fontWeight: 400,
    lineHeight: "18px",
    textAlign: "left",
    cursor: "pointer",
    selectors: {
      "&:hover:not(:disabled), &:focus-visible": {
        background: tokens["color/primary"],
        color: tokens["color/on-primary"],
        fontWeight: 600,
      },
      "&:active:not(:disabled)": {
        background: tokens["color/primary-pressed"],
        color: tokens["color/on-primary"],
        fontWeight: 600,
      },
      "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 2 },
      "&:disabled": { opacity: 0.45, cursor: "not-allowed" },
    },
  },
]);
export const destructive = style({ color: tokens["color/danger"] });
