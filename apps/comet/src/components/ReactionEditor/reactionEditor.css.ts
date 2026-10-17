import { style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";
export const rule = style({
  marginTop: tokens["spacing/space-12"],
  borderTop: `1px solid ${tokens["color/line"]}`,
  paddingTop: tokens["spacing/space-8"],
});
export const controls = style({
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: tokens["spacing/space-8"],
});
export const variant = style({
  borderInlineStart: `2px solid ${tokens["color/line"]}`,
  paddingLeft: tokens["spacing/space-8"],
  margin: `${tokens["spacing/space-8"]} 0`,
  display: "grid",
  gap: tokens["spacing/space-6"],
});
export const advanced = style({ marginTop: tokens["spacing/space-8"] });
export const cooldown = style({ width: 90 });
export const preview = style({
  display: "flex",
  flexWrap: "wrap",
  gap: tokens["spacing/space-12"],
  alignItems: "center",
  minHeight: 100,
  padding: `${tokens["spacing/space-8"]} 0`,
});
export const sprite = style({ display: "grid", placeItems: "center", flexShrink: 0 });
export const image = style({ width: "100%", height: "100%", objectFit: "contain" });
export const speech = style({
  whiteSpace: "pre-wrap",
  margin: 0,
  overflowWrap: "anywhere",
  flex: 1,
  minWidth: 120,
});
