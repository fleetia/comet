import { style } from "@vanilla-extract/css";
import { semanticVars as vars } from "@fleetia/lagrange/theme";
import { tokens } from "@comet/token";

export const header = style({
  display: "flex",
  flexDirection: "column",
  alignSelf: "start",
  gap: vars.space.md,
  padding: "18px 20px",
  alignItems: "stretch",
  flexShrink: 0,
  borderRadius: tokens["radius/radius-22"],
  border: `1px solid ${tokens["color/card-border"]}`,
  background: `radial-gradient(ellipse at 50% 0%, ${tokens["color/icon-tile"]}, transparent 75%), ${tokens["color/card"]}`,
});
export const state = style({
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: vars.space.md,

  selectors: { "&:empty": { display: "none" } },
});
export const actions = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-start",
  flexWrap: "wrap",
  gap: vars.space.sm,
});

export const titleRow = style({ display: "flex", alignItems: "center", gap: 10 });
export const icon = style({
  display: "grid",
  placeItems: "center",
  width: 36,
  height: 36,
  borderRadius: 18,
  background: tokens["color/icon-tile"],
  color: tokens["color/icon-tile-ink"],
});
export const title = style({
  margin: 0,
  fontSize: 22,
  lineHeight: "28px",
  fontFamily: tokens["typography/display/title/fontFamily"],
  fontWeight: 400,
  color: tokens["color/ink"],
});
