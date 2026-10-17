import { style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const handle = style({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  minWidth: 24,
  minHeight: 28,
  color: tokens["color/ink-2"],
  cursor: "grab",
  userSelect: "none",
  selectors: {
    '&[aria-disabled="true"]': { cursor: "default", opacity: 0.4 },
    "&:active": { cursor: "grabbing" },
  },
});
