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
  selectors: { "&[hidden]": { display: "none" } },
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
  panel: {
    minWidth: 0,
    minHeight: 0,
    boxShadow: `inset 0 1px 0 ${tokens["color/window-highlight"]}`,
  },
  accent: {
    minWidth: 0,
    minHeight: 0,
    borderColor: tokens["color/selected-border"],
    borderRadius: tokens["radius/radius-14"],
    background: tokens["color/card-2"],
    boxShadow: `inset 0 1px 0 ${tokens["color/window-highlight"]}`,
  },
  popover: { borderRadius: tokens["radius/radius-18"] },
  card: {
    borderColor: tokens["color/card-border"],
    borderRadius: tokens["radius/radius-16"],
    background: tokens["color/card"],
    backdropFilter: "none",
    boxShadow: "none",
  },
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
