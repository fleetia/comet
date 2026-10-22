import { style, styleVariants } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const scene = style({
  display: "block",
  position: "relative",
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
  borderRadius: 14,
  background: tokens["color/sky"],
  color: tokens["color/ink"],
  selectors: {
    '&[data-comet-theme="light"]': {
      background: `linear-gradient(171.125583deg, ${tokens["color/skin-sky-start"]} 8.616%, ${tokens["color/skin-sky-end"]} 108.62%)`,
    },
  },
});
export const sizes = styleVariants({
  tile: { height: 112, fontSize: 12 },
  large: { flex: "none", width: "100%", height: 200, fontSize: 15 },
});
export const balloon = style({
  position: "absolute",
  display: "flex",
  flexDirection: "column",
  gap: 2,
  left: 12,
  top: 12,
  padding: "0.6em 0.9em",
  borderRadius: 12,
  background: tokens["color/glass-panel"],
  border: `1px solid ${tokens["color/glass-border"]}`,
  whiteSpace: "nowrap",
});
export const name = style({ fontSize: "0.84em", color: tokens["color/byul-ink"] });
export const pill = style({
  position: "absolute",
  display: "flex",
  alignItems: "center",
  right: 12,
  bottom: 12,
  height: "2.5em",
  padding: "0 1em",
  borderRadius: 14,
  background: tokens["color/glass-widget"],
  border: `1px solid ${tokens["color/pill-border"]}`,
  whiteSpace: "nowrap",
});
