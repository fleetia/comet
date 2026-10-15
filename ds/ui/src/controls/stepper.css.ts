import { style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";
import { pressable } from "../motion/motion.css";

export const row = style({ display: "inline-flex", alignItems: "center", gap: 8 });
export const group = style({
  boxSizing: "border-box",
  display: "inline-flex",
  alignItems: "center",
  height: 36,
  padding: "2px",
  background: tokens["color/card"],
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: 17,
});
export const button = style([
  pressable,
  {
    boxSizing: "border-box",
    appearance: "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 30,
    height: 30,
    padding: 0,
    border: "none",
    borderRadius: 15,
    background: "transparent",
    color: tokens["color/ink"],
    cursor: "pointer",
    selectors: {
      "&:hover:not(:disabled)": { background: tokens["color/chip"] },
      "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 1 },
      "&:disabled": { opacity: 0.45, cursor: "not-allowed" },
    },
  },
]);
export const input = style({
  boxSizing: "border-box",
  appearance: "textfield",
  width: 38,
  minWidth: 30,
  height: 24,
  padding: 0,
  margin: 0,
  border: "none",
  borderRadius: 4,
  background: "transparent",
  color: tokens["color/ink"],
  textAlign: "center",
  fontFamily: tokens["typography/display/stat/fontFamily"],
  fontSize: 15,
  lineHeight: "22px",
  selectors: {
    "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 1 },
    "&:disabled": { opacity: 0.45, cursor: "not-allowed" },
    '&[aria-invalid="true"]': { outline: `1px solid ${tokens["color/danger"]}` },
    "&::-webkit-inner-spin-button, &::-webkit-outer-spin-button": { appearance: "none", margin: 0 },
  },
});
export const unit = style({
  fontFamily: tokens["typography/sans/body/fontFamily"],
  fontSize: 13,
  lineHeight: "19.5px",
  color: tokens["color/ink-2"],
});
