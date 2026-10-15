import { style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const packList = style({
  display: "flex",
  flexDirection: "column",
  gap: 16,
  marginBlock: 14,
});
export const pack = style({
  padding: "14px 16px",
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: 18,
  background: tokens["color/card"],
});
export const packHeading = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  marginBottom: 12,
});
export const packName = style({
  appearance: "none",
  background: "transparent",
  color: tokens["color/ink"],
  border: 0,
  padding: 0,
  font: "inherit",
  fontSize: 15,
  fontWeight: 600,
  textAlign: "left",
  cursor: "pointer",
  selectors: {
    '&[aria-checked="true"]': { color: tokens["color/selected-ink"] },
    "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 4 },
  },
});
export const caption = style({ fontSize: 12, lineHeight: "16px", color: tokens["color/ink-3"] });
export const characters = style({
  display: "grid",
  gridTemplateColumns: "repeat(3,minmax(0,1fr))",
  gap: 10,
});
export const character = style({ width: "100%", minHeight: 116 });
