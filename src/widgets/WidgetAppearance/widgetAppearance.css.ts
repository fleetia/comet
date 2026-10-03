import { globalStyle, style } from "@vanilla-extract/css";
import { semanticVars as vars, vnextVars } from "@fleetia/lagrange/theme";

export const settings = style({
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  gap: vars.space.md,
});
export const body = style({
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  overscrollBehavior: "contain",
  gap: vars.space.md,
});
globalStyle(`${body} > *`, { flexShrink: 0 });
export const previewSurface = style({
  display: "flex",
  flexDirection: "column",
  gap: vars.space.md,
  minWidth: 0,
  height: 232,
  padding: vars.space.lg,
  borderRadius: vnextVars.radius.inset,
});
export const preview = style({
  height: 152,
  minHeight: 152,
  display: "flex",
  padding: vars.space.lg,
  backgroundRepeat: "no-repeat",
  backgroundSize: "cover",
  border: 0,
  borderRadius: vnextVars.radius.inset,
  overflow: "hidden",
});
export const previewText = style({
  display: "grid",
  gap: vars.space.sm,
  maxWidth: "100%",
  fontFamily: vars.typography.family.display,
});
export const previewTitle = style({
  fontSize: vars.typography.size.label,
  lineHeight: vars.typography.lineHeight.compact,
  fontWeight: 600,
});
export const previewValue = style({
  fontSize: vars.typography.size.headingMd,
  lineHeight: vars.typography.lineHeight.tight,
  fontWeight: 700,
});
export const previewCaption = style({
  fontSize: vars.typography.size.caption,
  lineHeight: vars.typography.lineHeight.body,
});
export const editHeading = style({
  borderTop: `${vars.border.width.hairline} solid ${vars.color.border.subtle}`,
  paddingTop: vars.space.md,
  margin: 0,
});
export const colors = style({
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
  gap: vars.space.md,
});
globalStyle(`${colors} > div`, { minWidth: 0, margin: 0, gap: vars.space.xs });
export const colorField = style({
  height: 32,
  minHeight: 32,
  padding: `${vars.space.xs} ${vars.space.sm}`,
  background: vars.color.surface.raised,
  border: `${vars.border.width.hairline} solid ${vars.color.border.subtle}`,
  borderRadius: vnextVars.radius.control,
  minWidth: 0,
  gridTemplateColumns: "auto minmax(0, 1fr)",
});

globalStyle(`${colorField} input[type="text"]`, {
  minWidth: 0,
  width: "100%",
  minHeight: 0,
  height: 22,
  padding: 0,
  border: 0,
  borderRadius: 0,
  background: "transparent",
  fontSize: vars.typography.size.label,
  lineHeight: vars.typography.lineHeight.body,
});
export const positions = style({
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
  gap: vars.space.lg,
  minHeight: 156,
  alignItems: "center",
});
export const placementField = style({
  display: "grid",
  gap: vars.space.sm,
  fontSize: vars.typography.size.label,
  lineHeight: vars.typography.lineHeight.compact,
});
export const placementPicker = style({
  display: "grid",
  gridTemplateColumns: "repeat(3, 32px)",
  width: 112,
  gap: vars.space.sm,
  padding: 0,
  border: 0,
  background: "transparent",
});
globalStyle(`${placementPicker} button`, {
  width: 32,
  minWidth: 32,
  height: 32,
  minHeight: 32,
  padding: 0,
  border: `${vars.border.width.hairline} solid ${vars.color.border.subtle}`,
  borderRadius: vars.shape.radius.subtle,
  background: vars.color.surface.raised,
  color: vars.color.content.primary,
  fontSize: vars.typography.size.label,
});
globalStyle(
  `${placementPicker} button[aria-checked="true"], ${placementPicker} button[aria-checked="true"]:hover:not(:disabled)`,
  {
    background: vars.color.selection.surface,
    color: vars.color.content.onAccent,
    borderColor: vars.color.selection.indicator,
  },
);
globalStyle(`${placementPicker} button[aria-checked="true"]:focus-visible`, {
  outline: `2px solid ${vars.color.content.onAccent}`,
  outlineOffset: -3,
});
globalStyle(`${placementPicker} button::after`, {
  position: "static",
  display: "inline",
  background: "transparent",
  color: "inherit",
});
const arrows = ["↖", "↑", "↗", "←", "·", "→", "↙", "↓", "↘"];
const positionsOrder = [
  "top-left",
  "top-center",
  "top-right",
  "center-left",
  "center-center",
  "center-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
];
positionsOrder.forEach((position, index) => {
  globalStyle(`${placementPicker} button[data-placement="${position}"]::after`, {
    content: `"${arrows[index]}"`,
    background: "transparent",
  });
});
export const fileActions = style({
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: vars.space.md,
  minHeight: 32,
});
export const saveControls = style({
  display: "grid",
  gap: vars.space.md,
  flexShrink: 0,
  minWidth: 0,
});
globalStyle(`${saveControls}[hidden]`, { display: "none" });
export const saveBar = style({ gap: vars.space.md, paddingTop: 0, minHeight: 44 });
export const saveState = style({
  display: "grid",
  gap: vars.space.xxs,
  lineHeight: vars.typography.lineHeight.body,
});
globalStyle(`${saveBar} button`, { paddingInline: vars.space.sm, whiteSpace: "nowrap" });
globalStyle(`${saveBar} button:first-child`, { width: 88 });
globalStyle(`${saveBar} button:last-child`, { width: 112 });
export const error = style({
  color: vars.color.status.critical,
  fontSize: vars.typography.size.caption,
  lineHeight: vars.typography.lineHeight.body,
});
