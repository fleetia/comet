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
  background: vars.color.surface.raised,
  border: `${vars.border.width.hairline} solid ${vars.color.border.strong}`,
  borderRadius: vars.shape.radius.subtle,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
});
export const balloonPanel = style({ width: 320, minHeight: 110 });
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
});
export const balloonClose = style({ position: "absolute", top: 2, right: 2, zIndex: 1 });
export const balloonPreview = style({
  maxWidth: "min(320px, 100%)",
});
export const balloonHeader = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "7px 12px",
  fontSize: vars.typography.size.caption,
  color: vars.color.content.secondary,
  flexShrink: 0,
  borderBottom: `${vars.border.width.hairline} dotted ${vars.color.border.subtle}`,
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
  padding: `${vars.space.sm} ${vars.space.xxl} ${vars.space.sm} ${vars.space.md}`,
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
  { padding: "10px 14px", maxHeight: 150, flex: "1 1 auto", minHeight: 38 },
]);
export const conversationDetails = style({
  margin: "0 14px",
  maxHeight: 160,
  minHeight: 26,
  flexShrink: 1,
  overflowY: "auto",
  fontSize: vars.typography.size.caption,
  borderBottom: `${vars.border.width.hairline} dotted ${vars.color.border.subtle}`,
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
  padding: `${vars.space.md} 0`,
  background: "transparent",
  border: 0,
  borderBottom: `${vars.border.width.hairline} dotted ${vars.color.border.subtle}`,
  textAlign: "left",
  color: vars.color.content.primary,
  fontSize: vars.typography.size.label,
  overflowWrap: "anywhere",
  cursor: "pointer",
  ":focus-visible": { outline: `2px solid ${vars.color.interaction.focus}`, outlineOffset: -2 },
});
export const speechReveal = style({ position: "absolute", inset: 0 });
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
  fontSize: vars.typography.size.caption,
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
  flex: "0 0 auto",
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
