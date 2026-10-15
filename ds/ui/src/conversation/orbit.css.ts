import { style, styleVariants } from "@vanilla-extract/css";
import { tokens } from "@comet/token";
import { stateTransition } from "../motion/motion.css";

export const node = style([
  stateTransition,
  {
    position: "relative",
    display: "inline-grid",
    placeItems: "center",
    flexShrink: 0,
    width: 40,
    height: 40,
    borderRadius: "50%",
    appearance: "none",
    border: `1px solid ${tokens["color/pill-border"]}`,
    background: tokens["color/glass-pill"],
    backdropFilter: "blur(8px)",
    color: tokens["color/ink"],
    cursor: "pointer",
    selectors: {
      "&:hover:not(:disabled)": { borderColor: tokens["color/primary"], transform: "scale(1.06)" },
      "&:active:not(:disabled)": { background: tokens["color/hover"], transform: "scale(0.96)" },
      "&:focus-visible": { outline: `2px solid ${tokens["color/primary"]}`, outlineOffset: 3 },
      "&:disabled": { opacity: 0.4, cursor: "not-allowed" },
    },
  },
]);
export const states = styleVariants({
  default: {},
  hub: {
    width: 48,
    height: 48,
    background: tokens["color/primary"],
    color: tokens["color/on-primary"],
    borderColor: tokens["color/primary"],
    boxShadow: `0 0 26px ${tokens["color/star-line"]}`,
  },
  focus: { outline: `2px solid ${tokens["color/primary"]}`, outlineOffset: 3 },
  visited: { width: 44, height: 44, border: `2px solid ${tokens["color/primary"]}` },
  retreated: { width: 24, height: 24, opacity: 0.55 },
  "has-children": {
    "::before": {
      content: '""',
      position: "absolute",
      inset: -8,
      border: `1px dotted ${tokens["color/connector"]}`,
      borderRadius: "50%",
    },
    "::after": {
      content: '""',
      position: "absolute",
      top: -3,
      right: -3,
      width: 7,
      height: 7,
      borderRadius: "50%",
      background: tokens["color/primary"],
    },
  },
});
export const badge = style({
  position: "absolute",
  top: -7,
  right: -5,
  minWidth: 16,
  height: 16,
  padding: "0 4px",
  display: "grid",
  placeItems: "center",
  background: tokens["color/primary"],
  color: tokens["color/on-primary"],
  borderRadius: 8,
  fontFamily: tokens["typography/sans/body/fontFamily"],
  fontSize: 11,
  lineHeight: "16px",
  fontWeight: 600,
});
export const breadcrumb = style({
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  border: `1px solid ${tokens["color/chip-border"]}`,
  borderRadius: 14,
  background: tokens["color/chip"],
  padding: "4px 10px",
  color: tokens["color/ink-2"],
  fontSize: 12,
  lineHeight: "18px",
});
export const current = style({ color: tokens["color/selected-ink"], fontWeight: 600 });
export const hint = style({ fontSize: 11, color: tokens["color/ink-3"] });
export const menu = style({
  position: "relative",
  width: 440,
  height: 470,
  fontFamily: tokens["typography/sans/body/fontFamily"],
});
export const compact = style({ width: 310, height: 340 });
export const play = style({ height: 330 });
export const lines = style({ position: "absolute", top: 0, left: 0, pointerEvents: "none" });
export const crumbPosition = style({ position: "absolute", top: 0, left: 4 });
export const item = style({ position: "absolute", display: "grid", placeItems: "center" });
export const itemLabel = style({
  position: "absolute",
  fontSize: 12,
  lineHeight: "18px",
  whiteSpace: "nowrap",
  color: tokens["color/ink"],
});
export const labelPositions = styleVariants({
  left: { right: "calc(100% + 6px)" },
  right: { left: "calc(100% + 6px)" },
  top: { bottom: "calc(100% + 6px)" },
});
export const hubLabel = style({
  position: "absolute",
  top: "calc(100% + 5px)",
  color: tokens["color/selected-ink"],
  fontSize: 13,
  lineHeight: "18px",
  fontWeight: 600,
  whiteSpace: "nowrap",
});
export const character = style({ position: "absolute", display: "grid", placeItems: "center" });
export const characterFallback = style({
  boxSizing: "border-box",
  width: 60,
  height: 60,
  display: "grid",
  placeItems: "center",
  whiteSpace: "pre",
  border: `1px solid ${tokens["color/nadir-ink"]}`,
  borderRadius: 18,
  background: "radial-gradient(ellipse at 50% 30%, rgba(38,51,111,0.6), rgba(20,28,68,0.38))",
  color: tokens["palette/night/별 하양"],
  boxShadow: `0 0 30px ${tokens["color/component/live-alpha-160"]}`,
  fontSize: 10.29,
  lineHeight: "17px",
  letterSpacing: "0.24px",
  fontFamily: tokens["typography/sans/body/fontFamily"],
});
export const footer = style({
  position: "absolute",
  bottom: 0,
  left: "50%",
  transform: "translateX(-50%)",
  whiteSpace: "nowrap",
  fontSize: 11,
  lineHeight: "16px",
  color: tokens["color/ink-2"],
});
