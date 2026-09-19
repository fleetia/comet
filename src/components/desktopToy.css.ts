import { style } from "@vanilla-extract/css";

export const frame = style({
  width: 56,
  height: 56,
  display: "grid",
  placeItems: "center",
  overflow: "hidden",
});
export const actor = style({
  width: 56,
  height: 56,
  padding: 0,
  border: 0,
  outline: 0,
  background: "transparent",
  display: "grid",
  placeItems: "center",
  cursor: "grab",
  userSelect: "none",
  touchAction: "none",
  selectors: { "&:active": { cursor: "grabbing" } },
});
export const ball = style({
  display: "block",
  width: 38,
  height: 38,
  borderRadius: "50%",
  border: "1.5px solid #704e30",
  background:
    "conic-gradient(from 20deg, #e8a451 0deg 100deg, #f7d995 100deg 230deg, #e8a451 230deg)",
  boxShadow: "inset -4px -4px 8px #704e3038, inset 3px 3px 5px #ffffff66",
});
export const bubble = style({
  display: "block",
  width: 38,
  height: 38,
  borderRadius: "50%",
  border: "1.5px solid #85bccd",
  background:
    "radial-gradient(circle at 28% 25%, #ffffffcc 0 8%, #e5f7ff25 15% 65%, #ddaeef66 90%)",
  boxShadow: "inset -2px -2px 4px #b9e7f0bb",
});
export const pet = style({
  fontSize: 34,
  lineHeight: 1,
  width: 38,
  height: 38,
  display: "grid",
  placeItems: "center",
});
