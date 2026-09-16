import { globalStyle, keyframes, style, styleVariants } from "@vanilla-extract/css";
import { semanticVars as vars } from "@fleetia/lagrange/theme";

export const bodyFrame = style({ position: "relative", width: "100%", height: "100dvh" });
export const bodyClose = style({
  position: "absolute",
  top: 3,
  right: 3,
  fontSize: 20,
  lineHeight: 1,
});
export const body = style({
  width: "100%",
  height: "100%",
  minHeight: 60,
  padding: "24px 8px 10px",
  border: `${vars.border.width.hairline} solid ${vars.color.border.strong}`,
  borderRadius: vars.shape.radius.subtle,
  background: vars.color.surface.raised,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 9,
  userSelect: "none",
  cursor: "grab",
  touchAction: "none",
  color: vars.color.content.primary,
  ":focus-visible": {
    outline: `${vars.border.width.hairline} solid ${vars.color.interaction.focus}`,
    outlineOffset: -4,
  },
  selectors: { "&:active": { cursor: "grabbing" } },
});
export const bodyPreview = style({ width: 112, height: 88 });
export const tone = styleVariants({
  a: { borderTop: `3px solid ${vars.color.content.accent}` },
  b: { borderTop: `3px solid ${vars.color.status.positive}` },
});
export const bodyName = style({
  fontSize: 11,
  fontWeight: 650,
  maxWidth: "100%",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  letterSpacing: "0.01em",
  color: vars.color.content.secondary,
});
export const face = style({
  fontSize: 17,
  letterSpacing: "-0.045em",
  fontWeight: 500,
  maxWidth: "100%",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});
export const sprite = style({
  flexShrink: 0,
  objectFit: "contain",
  imageRendering: "pixelated",
  pointerEvents: "none",
  userSelect: "none",
});
export const spriteBody = style({
  padding: 4,
  gap: 0,
  border: 0,
  borderRadius: 0,
  background: "transparent",
});
export const faceFrame = style({
  width: "100%",
  height: "100dvh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
});
export const faceTag = style({
  border: 0,
  background: "transparent",
  padding: "2px 6px",
  fontSize: 16,
  fontWeight: 500,
  letterSpacing: "-0.045em",
  whiteSpace: "nowrap",
  color: vars.color.content.primary,
  userSelect: "none",
  cursor: "grab",
  touchAction: "none",
  selectors: { "&:active": { cursor: "grabbing" } },
});
export const transparentDocument = style({});
globalStyle(
  `${transparentDocument}, ${transparentDocument} body, ${transparentDocument} #root, ${transparentDocument} #root > *`,
  { background: "transparent" },
);
export const balloon = style({
  width: "100%",
  height: "auto",
  minHeight: 110,
  maxHeight: 520,
  background: vars.color.surface.raised,
  border: `${vars.border.width.hairline} solid ${vars.color.border.strong}`,
  borderRadius: vars.shape.radius.subtle,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
});
export const balloonSkinned = style({ imageRendering: "pixelated" });
export const balloonPreview = style({
  width: 320,
  maxWidth: "100%",
});
export const balloonHeader = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "7px 12px",
  fontSize: 11,
  color: vars.color.content.secondary,
  flexShrink: 0,
  borderBottom: `${vars.border.width.hairline} dotted ${vars.color.border.subtle}`,
});
export const speech = style({
  maxHeight: 400,
  padding: "18px 20px",
  fontSize: 19,
  lineHeight: 1.65,
  letterSpacing: "-0.025em",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  overflowY: "auto",
  flex: 1,
  minHeight: 0,
});
const waitingPulse = keyframes({
  "0%, 80%, 100%": { opacity: 0.3 },
  "40%": { opacity: 1 },
});
export const waitingDots = style({
  display: "inline-flex",
  justifyContent: "space-between",
  width: "1.2em",
});
export const waitingDot = style({
  width: "0.3em",
  textAlign: "center",
  opacity: 0.3,
  animation: `${waitingPulse} 1.2s ease-in-out infinite`,
  selectors: {
    "&:nth-child(2)": { animationDelay: "0.16s" },
    "&:nth-child(3)": { animationDelay: "0.32s" },
  },
  "@media": {
    "(prefers-reduced-motion: reduce)": { animation: "none", opacity: 1 },
  },
});
export const waitingLabel = style({
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
});
export const footer = style({
  padding: "6px 14px 10px",
  fontSize: 10,
  color: vars.color.content.secondary,
  display: "flex",
  justifyContent: "space-between",
  flexShrink: 0,
});
export const menu = style({
  padding: `${vars.space.xs} ${vars.space.sm}`,
  display: "flex",
  flexDirection: "column",
  gap: vars.space.xs,
  flex: 1,
  overflowY: "auto",
});
export const menuGroup = style({ display: "flex", flexDirection: "column" });
export const menuItem = style({
  width: "100%",
  justifyContent: "flex-start",
  textAlign: "left",
  flexShrink: 0,
  minHeight: vars.dimension.control,
});
export const form = style({
  maxHeight: 290,
  padding: "12px 14px",
  display: "flex",
  flexDirection: "column",
  gap: 10,
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
});
export const recipient = style({ width: "auto", maxWidth: 120 });
export const input = style({ minHeight: 68 });
export const row = style({
  display: "flex",
  gap: 9,
  justifyContent: "space-between",
  alignItems: "center",
});
export const history = style({
  maxHeight: 360,
  padding: "8px 15px 16px",
  overflowY: "auto",
  flex: 1,
  minHeight: 0,
});
export const historyMessage = style({
  margin: "12px 0",
  fontSize: 12,
  lineHeight: 1.65,
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
});
export const historyName = style({
  display: "block",
  fontSize: 10,
  fontWeight: 600,
  color: vars.color.content.secondary,
  marginBottom: 2,
});
export const notice = style({ padding: "0 12px 8px", flexShrink: 0 });
export const error = style({
  padding: "8px 10px",
  background: vars.color.status.criticalSurface,
  color: vars.color.status.critical,
  fontSize: 11,
  lineHeight: 1.6,
  borderRadius: vars.shape.radius.subtle,
  maxHeight: 65,
  overflowY: "auto",
  overflowWrap: "anywhere",
});
export const preview = style({
  maxWidth: 840,
  margin: "0 auto",
  padding: "46px 24px 32px",
  minHeight: "100dvh",
});
export const previewTitle = style({
  fontSize: 15,
  fontWeight: 550,
  marginBottom: 7,
  letterSpacing: "0.02em",
});
export const stage = style({
  position: "relative",
  minHeight: 430,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "flex-end",
  padding: "24px 0 32px",
  borderBottom: `${vars.border.width.hairline} solid ${vars.color.border.subtle}`,
  marginBottom: 20,
});
export const stageBalloon = style({
  width: 320,
  maxWidth: "100%",
  marginBottom: 18,
  transition: "transform 180ms ease",
  "@media": { "(prefers-reduced-motion: reduce)": { transition: "none" } },
});
export const actors = style({ display: "flex", gap: 32 });
export const demoControls = style({
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 8,
  marginBottom: 12,
});
export const resting = style({
  height: 260,
  display: "flex",
  alignItems: "center",
  color: vars.color.content.secondary,
  fontSize: 12,
});
