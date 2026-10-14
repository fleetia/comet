import { style, styleVariants } from "@vanilla-extract/css";
import { tokens } from "@comet/token";
import { popIn, pressable, pulse, reducedMotionQuery, stateTransition } from "../motion/motion.css";

const inline = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  boxSizing: "border-box",
  fontFamily: `${tokens["typography/sans/body/fontFamily"]}, sans-serif`,
} as const;

export const action = style([
  pressable,
  {
    ...inline,
    gap: 6,
    minHeight: 32,
    padding: "5.25px 13px 5.25px 10px",
    fontSize: 13,
    lineHeight: "19.5px",
    fontWeight: 400,
    color: tokens["color/ink"],
    backgroundColor: tokens["color/chip"],
    border: `1px solid ${tokens["color/chip-border"]}`,
    borderRadius: tokens["radius/radius-16"],
    cursor: "pointer",
    selectors: {
      "&:hover:not(:disabled)": {
        backgroundImage: `linear-gradient(${tokens["color/hover"]}, ${tokens["color/hover"]})`,
      },
      "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 3 },
      "&:disabled": { opacity: 0.45, cursor: "not-allowed" },
    },
  },
]);

export const toggle = style({
  minHeight: 30,
  borderRadius: tokens["radius/radius-pill"],
  fontSize: 12,
  lineHeight: "18px",
  selectors: {
    '&[aria-pressed="true"]': {
      backgroundColor: tokens["color/selected"],
      color: tokens["color/selected-ink"],
      borderColor: tokens["color/selected-border"],
    },
  },
});

export const status = style([
  stateTransition,
  {
    ...inline,
    gap: 5,
    minHeight: 24,
    padding: "2px 10px",
    fontSize: 12,
    lineHeight: "18px",
    borderRadius: tokens["radius/radius-12"],
    border: "1px solid",
    whiteSpace: "nowrap",
  },
]);
export const statuses = styleVariants({
  saved: {
    background: tokens["color/document/live-chip-background"],
    borderColor: tokens["color/document/live-chip-border"],
    color: tokens["color/focus-ring"],
  },
  reverted: {
    background: tokens["color/chip"],
    borderColor: tokens["color/chip-border"],
    color: tokens["color/ink-2"],
  },
  readOnly: {
    background: tokens["color/chip"],
    borderColor: tokens["color/chip-border"],
    color: tokens["color/ink-2"],
  },
  overdue: {
    background: tokens["color/component/danger-alpha-100"],
    borderColor: tokens["color/danger-border"],
    color: tokens["color/danger"],
  },
  selected: {
    background: tokens["color/selected"],
    borderColor: tokens["color/selected-border"],
    color: tokens["color/selected-ink"],
  },
});
export const confirmation = style({
  animation: `${popIn} ${tokens["duration/duration-pop"]} ${tokens["easing/ease-bounce"]}`,
  "@media": { [reducedMotionQuery]: { animation: "none" } },
});
export const category = style({
  ...inline,
  gap: 7,
  minHeight: 28,
  padding: "3.25px 12px 3.25px 10px",
  fontSize: 13,
  lineHeight: "19.5px",
  color: tokens["color/ink-2"],
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: tokens["radius/radius-14"],
});
export const categoryDot = style({ width: 9, height: 9, borderRadius: 5, flexShrink: 0 });
export const categories = styleVariants({
  work: { background: tokens["color/cat-work"] },
  record: { background: tokens["color/cat-record"] },
  life: { background: tokens["color/cat-life"] },
  exercise: { background: tokens["color/cat-exercise"] },
  rest: { background: tokens["color/cat-rest"] },
  focus: { background: tokens["color/cat-focus"] },
});
export const context = style({
  ...inline,
  gap: 6,
  minHeight: 26,
  padding: "4px 10px",
  fontSize: tokens["typography/sans/caption/fontSize"],
  lineHeight: tokens["typography/sans/caption/lineHeight"],
  color: tokens["color/ink-2"],
  border: `1px solid ${tokens["color/chip-border"]}`,
  background: tokens["color/chip"],
  borderRadius: tokens["radius/radius-12"],
});
export const badge = style({
  ...inline,
  minWidth: 18,
  minHeight: 18,
  paddingInline: 5,
  fontSize: 11,
  fontWeight: 600,
  lineHeight: "18px",
  background: tokens["color/selected-icon"],
  color: tokens["color/on-primary"],
  borderRadius: tokens["radius/radius-9"],
});
export const keycap = style({
  ...inline,
  minHeight: 22,
  padding: "1px 5px 3px",
  fontSize: tokens["typography/sans/caption/fontSize"],
  fontWeight: 400,
  lineHeight: tokens["typography/sans/caption/lineHeight"],
  color: tokens["color/ink"],
  background: tokens["color/card-2"],
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: tokens["radius/radius-6"],
  boxShadow: `inset 0 -2px 0 ${tokens["color/component/surface-shadow-alpha-250"]}`,
});
export const live = style({
  ...inline,
  gap: 8,
  fontSize: 13,
  lineHeight: "19.5px",
  color: tokens["color/ink"],
});
export const liveDot = style({
  width: 8,
  height: 8,
  borderRadius: 4,
  background: tokens["color/live"],
  boxShadow: `0 0 12px ${tokens["color/component/live-alpha-500"]}`,
  flexShrink: 0,
});
export const livePulse = style({
  animation: `${pulse} ${tokens["duration/duration-pulse"]} ${tokens["easing/ease-pulse"]} infinite`,
  "@media": { [reducedMotionQuery]: { animation: "none" } },
});

export const waiting = style({ display: "inline-flex", alignItems: "center", gap: 4 });
export const waitingDot = style({
  width: 5,
  height: 5,
  borderRadius: "50%",
  background: tokens["color/ink-2"],
  animation: `${pulse} ${tokens["duration/duration-pulse"]} ${tokens["easing/ease-pulse"]} infinite`,
  "@media": { [reducedMotionQuery]: { animation: "none" } },
});
