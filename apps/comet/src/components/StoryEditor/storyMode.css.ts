import { style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const card = style({
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: 8,
  padding: 20,
  border: `2px solid ${tokens["color/primary"]}`,
  borderRadius: 12,
  background: tokens["color/card"],
});
export const diagram = style({ width: 120, height: 56, marginBottom: 4 });
export const title = style({ color: tokens["color/ink"], fontSize: 15 });
export const description = style({ margin: 0, color: tokens["color/ink-3"], lineHeight: "20px" });
export const primaryButton = style({ alignSelf: "stretch", marginTop: 8 });
export const alternative = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "18px 0 0",
});
export const alternativeText = style({
  display: "flex",
  minWidth: 0,
  flexDirection: "column",
  gap: 4,
  color: tokens["color/ink"],
});
export const alternativeDescription = style({ color: tokens["color/ink-3"] });
