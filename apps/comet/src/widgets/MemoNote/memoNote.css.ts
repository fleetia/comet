import { style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const stage = style({
  position: "relative",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "100dvh",
  gap: 12,
  padding: "12px 16px 64px",
  background: "transparent",
});
export const sheet = style({ position: "relative", flexShrink: 0 });
export const putAway = style({
  position: "absolute",
  top: -4,
  right: -4,
  width: 24,
  height: 24,
  minWidth: 24,
  // Detached controls need their own opaque surface over arbitrary desktop content.
  background: tokens["color/sky"],
  selectors: {
    "&:hover:not(:disabled)": { background: tokens["color/sky"] },
    "&:active:not(:disabled)": { background: tokens["color/sky"] },
    "&:focus-visible": { outlineOffset: -3 },
  },
});
export const controls = style({
  position: "absolute",
  bottom: 4,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexWrap: "wrap",
  gap: 4,
  boxSizing: "border-box",
  maxWidth: "calc(100% - 16px)",
  padding: "4px 8px",
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: tokens["radius/radius-18"],
  background: tokens["color/sky"],
  fontSize: 11,
  color: tokens["color/ink-2"],
  opacity: 0,
  transition: "opacity 120ms",
  selectors: { [`${stage}:hover &`]: { opacity: 1 }, [`${stage}:focus-within &`]: { opacity: 1 } },
});
export const status = style({ width: "100%", textAlign: "center", lineHeight: "14px" });
export const editor = style({
  display: "block",
  boxSizing: "border-box",
  width: 155,
  height: 80,
  minHeight: 0,
  margin: 0,
  padding: 0,
  border: 0,
  borderRadius: 0,
  background: "transparent",
  color: "inherit",
  fontFamily: "inherit",
  lineHeight: 1.25,
  resize: "none",
  overflowY: "auto",
  overflowWrap: "anywhere",
  ":focus": { outline: "none" },
  ":focus-visible": { outline: "1px solid #6b5300", outlineOffset: 3 },
  "::placeholder": { color: "#6b5300" },
});
