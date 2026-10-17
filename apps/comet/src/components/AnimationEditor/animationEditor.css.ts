import { style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const editor = style({ display: "grid", gap: tokens["spacing/space-8"], minWidth: 0 });
export const controls = style({
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: tokens["spacing/space-8"],
});
export const number = style({ width: 84 });
export const clipFields = style({
  display: "grid",
  gridTemplateColumns: "minmax(0,1fr) 100px",
  gap: tokens["spacing/space-8"],
});
export const preview = style({
  display: "grid",
  placeItems: "center",
  minHeight: 220,
  padding: tokens["spacing/space-8"],
});
export const frames = style({
  display: "flex",
  flexWrap: "wrap",
  gap: tokens["spacing/space-6"],
  maxHeight: 190,
  overflowY: "auto",
});
export const frame = style({
  display: "grid",
  gap: tokens["spacing/space-6"],
  padding: tokens["spacing/space-6"],
  border: `1px solid ${tokens["color/line"]}`,
  selectors: {
    '&[data-selected="true"]': {
      borderColor: tokens["color/selected-border"],
    },
  },
});
export const fallback = style({ display: "grid", placeItems: "center" });
export const frameActions = style({ display: "flex", gap: tokens["spacing/space-4"] });
export const binding = style({
  display: "grid",
  gridTemplateColumns: "minmax(80px, 1fr) minmax(110px, 2fr)",
  gap: tokens["spacing/space-8"],
  alignItems: "center",
  padding: `${tokens["spacing/space-8"]} 0`,
});
export const playback = style({
  gridColumn: "1 / -1",
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: tokens["spacing/space-8"],
});
export const sheet = style({
  display: "flex",
  flexWrap: "wrap",
  alignItems: "end",
  gap: tokens["spacing/space-8"],
});
export const expression = style({ marginTop: tokens["spacing/space-8"] });
