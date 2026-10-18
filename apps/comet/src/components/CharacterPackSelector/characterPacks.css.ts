import { style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const selector = style({
  display: "flex",
  flexDirection: "column",
  gap: 16,
  minWidth: 0,
});
export const sources = style({ display: "flex", gap: 2, flexWrap: "wrap" });
export const pack = style({
  display: "flex",
  flexDirection: "column",
  gap: 12,
  padding: 16,
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: 18,
  background: tokens["color/card"],
});
export const packHeading = style({
  display: "flex",
  alignItems: "center",
  gap: 10,
  minHeight: 32,
});
export const packName = style({
  margin: 0,
  color: tokens["color/ink"],
  fontSize: 15,
  lineHeight: "20px",
  fontWeight: 600,
});
export const badge = style({
  padding: "3px 10px",
  borderRadius: 999,
  border: `1px solid ${tokens["color/chip-border"]}`,
  color: tokens["color/ink-2"],
  fontSize: 12,
  lineHeight: "16px",
});
export const packAction = style({ marginLeft: "auto" });
export const caption = style({
  margin: 0,
  fontSize: 12,
  lineHeight: "16px",
  color: tokens["color/ink-3"],
});
export const characters = style({
  display: "grid",
  gridTemplateColumns: "repeat(3,minmax(0,1fr))",
  gap: 10,
});
export const character = style({ width: "100%", minHeight: 116 });
export const footer = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
});
