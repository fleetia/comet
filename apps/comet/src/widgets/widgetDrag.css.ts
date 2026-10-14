import { style } from "@vanilla-extract/css";
import { semanticVars as v } from "@fleetia/lagrange/theme";

export const handle = style({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  minWidth: 24,
  minHeight: 28,
  color: v.color.content.secondary,
  cursor: "grab",
  userSelect: "none",
  selectors: {
    '&[aria-disabled="true"]': { cursor: "default", opacity: 0.4 },
    "&:active": { cursor: "grabbing" },
  },
});
