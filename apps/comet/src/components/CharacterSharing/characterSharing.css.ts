import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const importLayout = style({
  display: "grid",
  gridTemplateColumns: "minmax(250px,372px) minmax(0,1fr)",
  gap: 28,
  minHeight: 0,
  padding: "16px 12px 26px",
  "@media": { "(max-width: 780px)": { gridTemplateColumns: "1fr" } },
});
export const previewCard = style({
  display: "flex",
  flexDirection: "column",
  gap: 14,
  padding: "18px 20px 20px",
  alignSelf: "start",
  border: `1px solid ${tokens["color/chip-border"]}`,
  borderRadius: 24,
  background: `radial-gradient(ellipse at top, ${tokens["color/icon-tile"]}, transparent 70%), ${tokens["color/card-2"]}`,
});
export const title = style({
  display: "flex",
  alignItems: "center",
  gap: 10,
  fontFamily: tokens["typography/display/title/fontFamily"],
  fontSize: 22,
  lineHeight: "28px",
  fontWeight: 400,
  margin: 0,
});
export const caption = style({
  display: "block",
  margin: 0,
  fontSize: 12,
  lineHeight: "17px",
  color: tokens["color/ink-3"],
});
export const character = style({
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 14,
  padding: "24px 14px",
  border: `1px dashed ${tokens["color/card-border"]}`,
  borderRadius: 18,
  background: tokens["color/input"],
});
export const portrait = style({
  width: 112,
  height: 112,
  objectFit: "contain",
  imageRendering: "pixelated",
});
export const characterName = style({
  margin: 0,
  fontFamily: tokens["typography/display/page/fontFamily"],
  fontSize: 26,
  lineHeight: "32px",
  fontWeight: 400,
});
export const description = style({
  margin: 0,
  fontSize: 13,
  lineHeight: "19px",
  textAlign: "center",
  color: tokens["color/ink-2"],
});
export const importBody = style({ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 });
export const section = style({ display: "flex", flexDirection: "column", gap: 8 });
export const sectionTitle = style({
  margin: 0,
  fontFamily: tokens["typography/display/label-display/fontFamily"],
  fontSize: 14,
  lineHeight: "18px",
  fontWeight: 400,
  color: tokens["color/ink-2"],
});
export const contents = style({
  overflow: "hidden",
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: 18,
  background: tokens["color/card"],
});
export const contentRow = style({
  display: "flex",
  alignItems: "center",
  gap: 12,
  minHeight: 54,
  padding: "9px 14px",
  borderBottom: `1px solid ${tokens["color/divider"]}`,
  boxSizing: "border-box",
  fontSize: 13,
  selectors: { "&:last-child": { borderBottom: 0 }, "&[data-absent]": { opacity: 0.55 } },
});
export const includeChoice = style({ marginLeft: "auto", flexShrink: 0 });
export const icon = style({
  width: 30,
  height: 30,
  borderRadius: 15,
  display: "grid",
  placeItems: "center",
  flexShrink: 0,
  background: tokens["color/icon-tile"],
  color: tokens["color/byul-ink"],
});
export const instructions = style({
  border: `1px solid ${tokens["color/input-border"]}`,
  background: tokens["color/input"],
  borderRadius: 12,
  padding: "10px 12px",
  fontSize: 13,
  lineHeight: "19px",
  whiteSpace: "pre-wrap",
});
globalStyle(`${instructions} p`, { margin: 0 });
export const details = style({ fontSize: 12, color: tokens["color/ink-2"], cursor: "pointer" });
export const actions = style({
  display: "flex",
  justifyContent: "flex-end",
  alignItems: "center",
  gap: 8,
});
export const error = style({ margin: 0, color: tokens["color/danger"], fontSize: 13 });
