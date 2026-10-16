import { style } from "@vanilla-extract/css";
import { semanticVars as vars } from "@fleetia/lagrange/theme";
import { tokens } from "@comet/token";

/** Uniform logical margin around the shape; the window's outer top-left is the saved position. */
export const DISPLAY_MARGIN = 12;

export const frame = style({
  position: "relative",
  display: "grid",
  placeItems: "center",
  boxSizing: "border-box",
  width: "100%",
  height: "100dvh",
  minHeight: 0,
  padding: DISPLAY_MARGIN,
  background: "transparent",
  color: tokens["color/ink"],
  overflow: "hidden",
  userSelect: "none",
});
export const content = style({
  display: "grid",
  placeItems: "center",
  width: "100%",
  height: "100%",
  minWidth: 0,
  minHeight: 0,
});
export const outline = style({
  position: "absolute",
  inset: DISPLAY_MARGIN / 2,
  border: `1.5px dashed ${tokens["color/glass-border"]}`,
  borderRadius: 18,
  pointerEvents: "none",
});
export const selectedOutline = style({
  border: `2px solid ${tokens["color/primary"]}`,
});
export const remove = style({
  position: "absolute",
  top: 0,
  left: 0,
  zIndex: 2,
  width: 24,
  height: 24,
  minWidth: 24,
  borderRadius: 12,
  background: tokens["color/glass-panel"],
  boxShadow: `0 0 0 1px ${tokens["color/glass-border"]}`,
});
export const resize = style({
  position: "absolute",
  right: 0,
  bottom: 0,
  zIndex: 2,
  width: 20,
  height: 20,
  padding: 0,
  border: `2px solid ${tokens["color/primary"]}`,
  borderRadius: 10,
  background: tokens["color/glass-panel"],
  cursor: "nwse-resize",
  touchAction: "none",
  ":focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}` },
});
export const sizeBadge = style({
  position: "absolute",
  right: DISPLAY_MARGIN + 4,
  bottom: DISPLAY_MARGIN + 4,
  padding: "2px 8px",
  borderRadius: 10,
  background: tokens["color/primary"],
  color: tokens["color/on-primary"],
  fontSize: 11,
  lineHeight: "16px",
  pointerEvents: "none",
});
export const error = style({
  position: "absolute",
  right: DISPLAY_MARGIN,
  bottom: DISPLAY_MARGIN,
  left: DISPLAY_MARGIN,
  maxHeight: "40%",
  overflowY: "auto",
  overflowWrap: "anywhere",
  padding: vars.space.sm,
  background: vars.color.status.criticalSurface,
  color: vars.color.status.critical,
  borderRadius: vars.shape.radius.subtle,
  fontFamily: vars.typography.family.ui,
  fontSize: vars.typography.size.caption,
});
export const unavailable = style({
  display: "grid",
  justifyItems: "center",
  gap: vars.space.xs,
  padding: vars.space.sm,
  borderRadius: vars.shape.radius.subtle,
  background: tokens["color/glass-panel"],
  color: tokens["color/ink-2"],
  fontSize: vars.typography.size.caption,
});

export const cover = style({ width: 44, height: 44, objectFit: "cover", borderRadius: 12 });
export const expanded = style({ width: "100%", minWidth: 0 });
export const weatherStack = style({
  width: "100%",
  overflow: "hidden",
  background: tokens["color/glass-panel"],
  border: `1px solid ${tokens["color/glass-border"]}`,
  borderRadius: 20,
});
export const weatherControls = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  height: 50,
  padding: "10px 14px 12px 16px",
  borderTop: `1px solid ${tokens["color/divider"]}`,
});
export const weatherPinLabel = style({ flex: 1, fontSize: 13 });
export const weatherDivider = style({ width: 1, height: 20, background: tokens["color/divider"] });
