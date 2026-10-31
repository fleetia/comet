import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const settings = style({
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  gap: tokens["spacing/space-12"],
});
export const body = style({
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  overscrollBehavior: "contain",
  gap: tokens["spacing/space-12"],
});
globalStyle(`${body} > *`, { flexShrink: 0 });
export const previewSurface = style({
  display: "flex",
  flexDirection: "column",
  gap: tokens["spacing/space-12"],
  minWidth: 0,
  height: 232,
  padding: tokens["spacing/space-16"],
  borderRadius: tokens["radius/radius-9"],
});
export const preview = style({
  height: 152,
  minHeight: 152,
  display: "flex",
  padding: tokens["spacing/space-16"],
  backgroundRepeat: "no-repeat",
  backgroundSize: "cover",
  border: 0,
  borderRadius: tokens["radius/radius-9"],
  overflow: "hidden",
});
export const previewText = style({
  display: "grid",
  gap: tokens["spacing/space-8"],
  maxWidth: "100%",
  fontFamily: `${tokens["typography/display/title/fontFamily"]}, sans-serif`,
});
export const previewTitle = style({
  fontSize: tokens["typography/sans/body/fontSize"],
  lineHeight: "1.385",
  fontWeight: 600,
});
export const previewValue = style({
  fontSize: tokens["typography/display/page/fontSize"],
  lineHeight: "1.25",
  fontWeight: 700,
});
export const previewCaption = style({
  fontSize: tokens["typography/sans/caption/fontSize"],
  lineHeight: "1.462",
});
export const editHeading = style({
  borderTop: `1px solid ${tokens["color/line"]}`,
  paddingTop: tokens["spacing/space-12"],
  margin: 0,
});
export const colors = style({
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
  gap: tokens["spacing/space-12"],
});
globalStyle(`${colors} > div`, { minWidth: 0, margin: 0, gap: tokens["spacing/space-6"] });
export const colorField = style({
  height: 32,
  minHeight: 32,
  padding: `${tokens["spacing/space-6"]} ${tokens["spacing/space-8"]}`,
  background: tokens["color/glass-panel"],
  border: `1px solid ${tokens["color/line"]}`,
  borderRadius: tokens["radius/radius-9"],
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
  fontSize: tokens["typography/sans/body/fontSize"],
  lineHeight: "1.462",
});
export const positions = style({
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
  gap: tokens["spacing/space-16"],
  minHeight: 156,
  alignItems: "center",
});
export const placementField = style({
  display: "grid",
  gap: tokens["spacing/space-8"],
  fontSize: tokens["typography/sans/body/fontSize"],
  lineHeight: "1.385",
});
export const placementPicker = style({
  display: "grid",
  gridTemplateColumns: "repeat(3, 32px)",
  width: 112,
  gap: tokens["spacing/space-8"],
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
  border: `1px solid ${tokens["color/line"]}`,
  borderRadius: tokens["radius/radius-9"],
  background: tokens["color/glass-panel"],
  color: tokens["color/ink"],
  fontSize: tokens["typography/sans/body/fontSize"],
});
globalStyle(
  `${placementPicker} button[aria-checked="true"], ${placementPicker} button[aria-checked="true"]:hover:not(:disabled)`,
  {
    background: tokens["color/primary"],
    color: tokens["color/on-primary"],
    borderColor: tokens["color/selected-border"],
  },
);
globalStyle(`${placementPicker} button[aria-checked="true"]:focus-visible`, {
  outline: `2px solid ${tokens["color/on-primary"]}`,
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
  gap: tokens["spacing/space-12"],
  minHeight: 32,
});
export const status = style({
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: tokens["spacing/space-8"],
  minHeight: 20,
});
export const error = style({
  color: tokens["color/danger"],
  fontSize: tokens["typography/sans/caption/fontSize"],
  lineHeight: "1.462",
});
