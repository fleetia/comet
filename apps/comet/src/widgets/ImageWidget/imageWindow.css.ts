import { style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const frame = style({
  position: "relative",
  width: "100%",
  height: "100dvh",
  overflow: "hidden",
  background: "transparent",
  userSelect: "none",
});

export const media = style({
  display: "block",
  width: "100%",
  height: "100%",
  objectFit: "contain",
});

export const control = style({
  position: "absolute",
  zIndex: 1,
  opacity: 0,
  transition: "opacity 120ms",
  background: tokens["color/glass-panel"],
  selectors: {
    [`${frame}:hover &`]: { opacity: 1 },
    [`${frame}:focus-within &`]: { opacity: 1 },
  },
});

export const close = style({
  top: 0,
  right: 0,
  width: 24,
  height: 24,
  minWidth: 24,
});

export const resize = style({
  right: 0,
  bottom: 0,
  width: 20,
  height: 20,
  padding: 0,
  border: `2px solid ${tokens["color/primary"]}`,
  borderRadius: 10,
  cursor: "nwse-resize",
  touchAction: "none",
  ":focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}` },
});

export const error = style({
  position: "absolute",
  right: 0,
  bottom: 0,
  left: 0,
  maxHeight: "60%",
  overflow: "auto",
  margin: 0,
  padding: tokens["spacing/space-8"],
  background: tokens["color/component/danger-alpha-100"],
  color: tokens["color/danger"],
  fontSize: tokens["typography/sans/caption/fontSize"],
});
