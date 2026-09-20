import { style } from "@vanilla-extract/css";
import { semanticVars as vars } from "@fleetia/lagrange/theme";

export const frame = style({
  position: "relative",
  display: "flex",
  width: "100%",
  height: "100dvh",
  minHeight: 0,
  padding: vars.space.lg,
  backgroundRepeat: "no-repeat",
  backgroundSize: "cover",
  border: "1px solid rgba(255, 255, 255, 0.25)",
  borderRadius: 18,
  overflow: "hidden",
  boxShadow: "0 14px 36px rgba(0, 0, 0, 0.2)",
  textShadow: "0 1px 10px rgba(0, 0, 0, 0.32)",
  userSelect: "none",
});
export const close = style({
  position: "absolute",
  top: vars.space.xs,
  right: vars.space.xs,
  zIndex: 2,
  color: "inherit",
  fontSize: 22,
  lineHeight: 1,
  opacity: 0.8,
});
export const content = style({
  display: "grid",
  gap: vars.space.sm,
  maxWidth: "88%",
  padding: `${vars.space.sm} ${vars.space.md}`,
  background: "rgba(0, 0, 0, 0.24)",
  borderRadius: vars.shape.radius.subtle,
  fontFamily: vars.typography.family.display,
  lineHeight: vars.typography.lineHeight.compact,
});
export const list = style({
  display: "grid",
  gap: vars.space.xs,
});
export const item = style({
  display: "grid",
  gap: vars.space.xxs,
});
export const metric = style({
  fontFamily: vars.typography.family.data,
  fontSize: "clamp(26px, 9vw, 40px)",
  fontVariantNumeric: "tabular-nums",
  lineHeight: vars.typography.lineHeight.tight,
});
export const stale = style({
  fontFamily: vars.typography.family.ui,
  fontSize: vars.typography.size.caption,
  opacity: 0.82,
});
export const error = style({
  position: "absolute",
  right: vars.space.md,
  bottom: vars.space.sm,
  left: vars.space.md,
  fontFamily: vars.typography.family.ui,
  fontSize: vars.typography.size.caption,
});
export const loading = style({
  display: "grid",
  placeItems: "center",
  width: "100%",
  height: "100dvh",
  padding: vars.space.lg,
  background: "transparent",
  color: vars.color.content.secondary,
});
