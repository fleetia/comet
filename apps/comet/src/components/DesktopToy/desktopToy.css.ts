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
  width: 26,
  height: 26,
  borderRadius: "50%",
  background: "radial-gradient(circle at 35% 30%, #ffd0c2 0%, #ff9f85 55%, #d9735a 100%)",
});
export const bubble = style({
  display: "block",
  width: 38,
  height: 38,
  borderRadius: "50%",
  border: "1.5px solid rgba(201,184,245,0.85)",
  background: "rgba(201,184,245,0.12)",
});
export const pet = style({
  fontSize: 34,
  lineHeight: 1,
  width: 38,
  height: 38,
  display: "grid",
  placeItems: "center",
});
