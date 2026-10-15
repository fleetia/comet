import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const layout = style({
  display: "grid",
  gridTemplateColumns: "372px minmax(0,1fr)",
  gap: 28,
  padding: "0 28px 28px",
  height: "100%",
  minHeight: 0,
  boxSizing: "border-box",
  "@media": {
    "(max-width: 1050px)": { gridTemplateColumns: "minmax(250px,32%) minmax(0,1fr)" },
    "(max-width: 740px)": { gridTemplateColumns: "1fr", height: "auto" },
  },
});
export const aside = style({ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 });
export const previewCard = style({
  display: "flex",
  flexDirection: "column",
  gap: 14,
  alignItems: "center",
  padding: "18px 20px 20px",
  border: `1px solid ${tokens["color/chip-border"]}`,
  borderRadius: 24,
  background: `radial-gradient(ellipse at top, ${tokens["color/icon-tile"]}, transparent 70%), ${tokens["color/card-2"]}`,
});
export const previewHeading = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 14,
  width: "100%",
});
export const sectionTitle = style({
  margin: 0,
  fontFamily: tokens["typography/display/label-display/fontFamily"],
  fontSize: 14,
  lineHeight: "18px",
  fontWeight: 400,
  color: tokens["color/ink-2"],
});
export const caption = style({
  margin: 0,
  fontSize: 12,
  lineHeight: "17px",
  color: tokens["color/ink-3"],
});
export const previewStage = style({
  minHeight: 220,
  display: "grid",
  placeItems: "center",
  width: "100%",
});
export const previewImage = style({
  width: 140,
  height: 140,
  objectFit: "contain",
  imageRendering: "pixelated",
});
export const previewDescription = style({
  margin: 0,
  fontSize: 13,
  lineHeight: "19px",
  textAlign: "center",
  color: tokens["color/ink"],
});
export const summary = style({ width: "100%" });
export const inspector = style({
  minWidth: 0,
  minHeight: 0,
  background: "transparent",
  border: 0,
  boxShadow: "none",
  backdropFilter: "none",
  overflow: "visible",
});
export const expressionGrid = style({
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit,minmax(68px,1fr))",
  gap: 8,
  marginBottom: 20,
});
export const expressionTile = style({ width: "100%", minHeight: 88 });
export const expressionThumbnail = style({
  width: 44,
  height: 44,
  objectFit: "contain",
  imageRendering: "pixelated",
});
export const motionGrid = style({
  display: "grid",
  gridTemplateColumns: "repeat(4,minmax(0,1fr))",
  gap: 8,
  marginBottom: 20,
  "@media": { "(max-width: 1120px)": { gridTemplateColumns: "repeat(2,minmax(0,1fr))" } },
});
export const motionTile = style({ width: "100%", minHeight: 62 });
export const expressionInspector = style({
  padding: "12px 16px",
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: 18,
  background: tokens["color/card"],
});
export const contentHeading = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  minHeight: 36,
});
export const interaction = style({ padding: "0 28px 28px" });
globalStyle(`${inspector} > [data-character-scroll="body"]`, { padding: 0 });
globalStyle(`${inspector} > [data-character-footer="fixed"]`, { padding: "14px 0 0" });
