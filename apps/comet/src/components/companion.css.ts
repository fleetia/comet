import { globalStyle, style, styleVariants } from "@vanilla-extract/css";
import { semanticVars as vars } from "@fleetia/lagrange/theme";
import { tokens } from "@comet/token";

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
  border: `1px solid ${tokens["color/glass-border"]}`,
  borderRadius: tokens["radius/radius-18"],
  background: tokens["color/glass-panel"],
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
  fontSize: vars.typography.size.caption,
  fontWeight: 600,
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
  minHeight: 0,
  padding: vars.space.xs,
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
  position: "relative",
  boxSizing: "border-box",
  width: "max-content",
  minWidth: 48,
  maxWidth: 320,
  height: "auto",
  minHeight: 32,
  maxHeight: 520,
  color: tokens["color/ink"],
  background: tokens["color/glass-panel"],
  border: `1px solid ${tokens["color/glass-border"]}`,
  borderRadius: tokens["radius/radius-22"],
  backdropFilter: "blur(12px)",
  boxShadow: `inset 0 1px 0 ${tokens["color/surface-highlight"]}`,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
});
export const balloonPanel = style({ width: 320, minHeight: 110 });
export const balloonOrbit = style({
  width: "max-content",
  maxWidth: 640,
  maxHeight: 600,
  minHeight: 340,
  background: "transparent",
  border: 0,
  borderRadius: 0,
  boxShadow: "none",
  backdropFilter: "none",
  overflow: "hidden",
});
export const orbitTree = style({ position: "relative", flexShrink: 0 });
export const orbitAnchor = style({
  display: "block",
  width: 52,
  height: 52,
  pointerEvents: "none",
});
export const readableOrbit = style({});
const orbitTextShadow =
  "-1px -1px 0 #0a0f26, 0 -1px 0 #0a0f26, 1px -1px 0 #0a0f26, -1px 0 0 #0a0f26, 1px 0 0 #0a0f26, -1px 1px 0 #0a0f26, 0 1px 0 #0a0f26, 1px 1px 0 #0a0f26, 0 1px 3px rgba(0,0,0,0.8)";
globalStyle(`${readableOrbit} [data-orbit-label]`, { textShadow: orbitTextShadow });
// Keep input sections in normal block flow inside one bounded viewport. As flex
// siblings, an expanded log and failure notice squeezed the reply down to its labels.
export const inputContents = style({
  display: "block",
  flex: "1 1 auto",
  minHeight: 0,
  overflowY: "auto",
});
export const balloonSkinned = style({
  imageRendering: "pixelated",
  background: "transparent",
  borderColor: "transparent",
  borderRadius: 0,
  boxShadow: "none",
  backdropFilter: "none",
});
export const balloonClose = style({ position: "absolute", top: 6, right: 6, zIndex: 1 });
export const balloonPreview = style({
  maxWidth: "min(320px, 100%)",
  selectors: { [`&${balloonOrbit}`]: { maxWidth: "min(640px, 100%)" } },
});
export const balloonHeader = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "12px 16px 4px",
  fontSize: vars.typography.size.caption,
  color: tokens["color/ink-2"],
  fontWeight: 600,
  flexShrink: 0,
});
globalStyle(`${balloonHeader} > span`, {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});
globalStyle(`${balloonHeader} > button`, { flexShrink: 0 });
export const speech = style({
  maxHeight: 400,
  padding: "10px 36px 16px 18px",
  fontSize: 19,
  lineHeight: 1.65,
  letterSpacing: "-0.025em",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  overflowY: "auto",
  flex: 1,
  minHeight: 0,
});
export const speechText = style({ display: "block", position: "relative" });
export const replySpeech = style({
  display: "block",
  width: "100%",
  padding: 0,
  border: 0,
  background: "transparent",
  color: "inherit",
  font: "inherit",
  letterSpacing: "inherit",
  lineHeight: "inherit",
  whiteSpace: "pre-wrap",
  textAlign: "left",
  cursor: "pointer",
  ":focus-visible": { outline: `2px solid ${vars.color.interaction.focus}`, outlineOffset: 2 },
});
export const conversationSpeech = style([
  speech,
  { padding: "12px 18px", maxHeight: 150, flex: "1 1 auto", minHeight: 38 },
]);
export const conversationDetails = style({
  margin: "0 14px",
  maxHeight: 160,
  minHeight: 26,
  flexShrink: 1,
  overflowY: "auto",
  fontSize: vars.typography.size.caption,
});
export const conversationSummary = style({
  padding: "6px 0",
  cursor: "pointer",
  color: vars.color.content.secondary,
});
export const conversationLog = style({
  overflowY: "auto",
  minHeight: 0,
  maxHeight: 360,
  flex: "1 1 auto",
  padding: "0 14px 8px",
});
globalStyle(`${conversationDetails} ${conversationLog}`, {
  padding: `0 0 ${vars.space.sm}`,
  overflow: "visible",
  maxHeight: "none",
});
export const historyToolbar = style({
  display: "flex",
  justifyContent: "space-between",
  padding: "6px 12px",
  gap: vars.space.xs,
  flexShrink: 0,
});
export const conversationTitle = style({
  margin: "4px 14px",
  fontSize: vars.typography.size.label,
  overflowWrap: "anywhere",
});
export const conversationMeta = style({
  margin: "3px 0",
  fontSize: vars.typography.size.caption,
  color: vars.color.content.secondary,
});
export const conversationDraft = style({
  fontSize: vars.typography.size.caption,
  lineHeight: vars.typography.lineHeight.body,
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
});
export const conversationDraftBadge = style({
  padding: `0 ${vars.space.xxs}`,
  borderRadius: vars.shape.radius.subtle,
  background: vars.color.surface.canvas,
  color: vars.color.content.accent,
  fontWeight: 600,
});
export const responseOrigin = style({
  display: "block",
  fontSize: vars.typography.size.caption,
  fontWeight: 400,
  lineHeight: vars.typography.lineHeight.body,
  color: vars.color.content.secondary,
  marginBottom: vars.space.xxs,
});
export const playbackOrigin = style([responseOrigin, { margin: "0 14px 8px" }]);
export const failedInput = style({
  margin: "4px 0",
  maxHeight: 70,
  overflowY: "auto",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  fontSize: vars.typography.size.caption,
});
export const conversationItem = style({
  width: "100%",
  display: "flex",
  flexDirection: "column",
  gap: vars.space.xs,
  padding: vars.space.md,
  marginBottom: vars.space.sm,
  borderRadius: tokens["radius/radius-12"],
  background: tokens["color/card"],
  border: `1px solid ${tokens["color/card-border"]}`,
  textAlign: "left",
  color: vars.color.content.primary,
  fontSize: vars.typography.size.label,
  overflowWrap: "anywhere",
  cursor: "pointer",
  ":focus-visible": { outline: `2px solid ${vars.color.interaction.focus}`, outlineOffset: -2 },
});
export const speechReveal = style({ position: "absolute", inset: 0 });
export const footer = style({
  padding: "6px 14px 10px",
  fontSize: vars.typography.size.caption,
  color: vars.color.content.secondary,
  display: "flex",
  justifyContent: "space-between",
  flexShrink: 0,
});
export const menu = style({
  padding: `${vars.space.sm} ${vars.space.sm} ${vars.space.md}`,
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
export const pauseSummary = style({
  cursor: "pointer",
  padding: `${vars.space.sm} ${vars.space.md}`,
  minHeight: vars.dimension.control,
});
export const form = style({
  maxHeight: 290,
  padding: "14px 16px 16px",
  display: "flex",
  flexDirection: "column",
  gap: 10,
  flex: "0 0 auto",
  minHeight: 0,
  overflowY: "auto",
});
export const recipient = style({ width: "auto", maxWidth: 120 });
export const inputCapsule = style({
  display: "flex",
  alignItems: "flex-end",
  gap: 10,
  padding: "8px 8px 8px 18px",
  borderRadius: 24,
  border: `1px solid ${tokens["color/capsule-border"]}`,
  background: tokens["color/glass-capsule"],
  boxShadow: `0 12px 28px ${tokens["color/surface-shadow"]}`,
});
export const input = style({
  flex: 1,
  width: "100%",
  minHeight: 40,
  height: 40,
  maxHeight: 110,
  padding: "6px 0",
  border: 0,
  background: "transparent",
  fontSize: 14,
  lineHeight: "20px",
});
export const capsuleSend = style({
  width: 34,
  height: 34,
  minHeight: 34,
  minWidth: 34,
  padding: 0,
  borderRadius: "50%",
  flexShrink: 0,
});
export const speakerName = style({
  display: "block",
  padding: "16px 36px 0 18px",
  color: tokens["color/byul-ink"],
  fontSize: 12,
  fontWeight: 600,
});
export const row = style({
  display: "flex",
  gap: 9,
  justifyContent: "space-between",
  alignItems: "center",
});
export const recipientRow = style([row, { flexWrap: "wrap", gap: 4 }]);
export const history = style({
  maxHeight: 360,
  padding: "8px 15px 16px",
  overflowY: "auto",
  flex: 1,
  minHeight: 0,
});
export const historyMessage = style({
  margin: `${vars.space.md} 0`,
  fontSize: vars.typography.size.label,
  lineHeight: 1.65,
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  padding: vars.space.md,
  borderRadius: tokens["radius/radius-12"],
  background: tokens["color/card"],
  border: `1px solid ${tokens["color/card-border"]}`,
});
export const historyName = style({
  display: "block",
  fontSize: vars.typography.size.caption,
  fontWeight: 600,
  color: vars.color.content.secondary,
  marginBottom: vars.space.xxs,
});
export const notice = style({ padding: `0 ${vars.space.md} ${vars.space.sm}`, flexShrink: 0 });
export const error = style({
  padding: "8px 10px",
  background: vars.color.status.criticalSurface,
  color: vars.color.status.critical,
  fontSize: vars.typography.size.caption,
  lineHeight: vars.typography.lineHeight.body,
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
  color: tokens["color/ink"],
});
export const previewTitle = style({
  fontSize: vars.typography.size.headingSm,
  fontWeight: 600,
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
  padding: `${vars.space.xl} 0 ${vars.space.xxl}`,
  marginBottom: 20,
  border: `1px solid ${tokens["color/glass-border"]}`,
  borderRadius: tokens["radius/radius-22"],
  background: tokens["color/document/backdrop-panel/sky"],
});
export const stageBalloon = style({
  width: "max-content",
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
  gap: vars.space.sm,
  marginBottom: vars.space.md,
});
export const resting = style({
  height: 260,
  display: "flex",
  alignItems: "center",
  color: vars.color.content.secondary,
  fontSize: vars.typography.size.label,
});

export const orbitPauseStatus = style({
  position: "absolute",
  top: 306,
  left: 0,
  width: 296,
  margin: "4px 12px 12px",
  textShadow: orbitTextShadow,
  color: "var(--comet-color-ink-2)",
  fontSize: 12,
  textAlign: "center",
});
export const orbitError = style({
  position: "absolute",
  top: 284,
  left: 8,
  width: 288,
  margin: 0,
  color: tokens["color/ink"],
  fontSize: 12,
  textShadow: orbitTextShadow,
});
