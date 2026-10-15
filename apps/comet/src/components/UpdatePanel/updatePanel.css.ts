import { style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";
import { semanticVars as vars } from "@fleetia/lagrange/theme";

export const panel = style({
  alignSelf: "start",
  width: "100%",
  maxWidth: 792,
  display: "flex",
  flexDirection: "column",
  gap: 14,
  padding: "18px 20px 20px",
  borderRadius: 24,
  background: `radial-gradient(ellipse at 50% 0, ${tokens["color/component/cat-rest-alpha-160"]}, transparent 70%), ${tokens["color/card-2"]}`,
  borderColor: tokens["color/chip-border"],
});
export const identity = style({
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 14,
  padding: "12px 0 4px",
});
export const appTile = style({
  width: 108,
  height: 108,
  display: "grid",
  placeItems: "center",
  borderRadius: 30,
  background: `linear-gradient(160deg, #fff7de, #eee8ff)`,
  boxShadow: `0 18px 40px ${tokens["color/window-shadow"]}`,
});
export const identityCopy = style({ display: "grid", gap: 2, textAlign: "center" });
export const appName = style({
  margin: 0,
  fontFamily: tokens["typography/display/page/fontFamily"],
  fontSize: 32,
  lineHeight: "38px",
  fontWeight: 400,
});
export const caption = style({
  fontSize: vars.typography.size.caption,
  lineHeight: vars.typography.lineHeight.body,
});
export const update = style({
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: 16,
  padding: 14,
  background: tokens["color/card"],
  display: "flex",
  flexDirection: "column",
  gap: vars.space.md,
});
export const about = style({
  fontSize: vars.typography.size.caption,
  lineHeight: vars.typography.lineHeight.body,
  paddingTop: vars.space.md,
  borderTop: `${vars.border.width.hairline} solid ${vars.color.surface.raised}`,
});
export const actions = style({ display: "flex", flexWrap: "wrap", gap: vars.space.md });
export const updateButton = style({ minWidth: 88 });

export const status = style({
  minHeight: vars.dimension.row,
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
});
