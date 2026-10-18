import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const overview = style({
  display: "grid",
  gridTemplateColumns: "372px minmax(0,1fr)",
  gap: 28,
  padding: "24px 28px 28px",
  overflowY: "auto",
  alignItems: "start",
  "@media": {
    "(max-width: 1050px)": { gridTemplateColumns: "minmax(250px,32%) minmax(0,1fr)" },
    "(max-width: 740px)": { gridTemplateColumns: "1fr" },
  },
});
export const hero = style({
  border: `1px solid ${tokens["color/chip-border"]}`,
  borderRadius: 24,
  padding: "20px 22px 22px",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 14,
  minWidth: 0,
  background: `radial-gradient(ellipse at top, ${tokens["color/icon-tile"]}, transparent 70%), ${tokens["color/card-2"]}`,
});
export const back = style({ alignSelf: "flex-start", color: tokens["color/ink-2"] });
export const heroArtwork = style({
  display: "grid",
  placeItems: "center",
  width: 196,
  height: 196,
  maxWidth: "100%",
});
globalStyle(`${heroArtwork} > span`, { width: 196, height: 196 });
globalStyle(`${heroArtwork} img`, { width: 140, height: 140 });
export const heroTitle = style({
  margin: 0,
  fontFamily: tokens["typography/display/page/fontFamily"],
  fontSize: 32,
  lineHeight: "38px",
  fontWeight: 400,
  color: tokens["color/ink"],
});
export const description = style({
  margin: 0,
  fontSize: 13,
  lineHeight: "19px",
  color: tokens["color/ink-2"],
  overflowWrap: "anywhere",
  textAlign: "center",
});
export const caption = style({
  display: "block",
  margin: 0,
  fontSize: 12,
  lineHeight: "17px",
  color: tokens["color/ink-3"],
});
export const talk = style({ width: "100%", height: 40 });
export const together = style({
  width: "100%",
  display: "flex",
  alignItems: "center",
  gap: 14,
  padding: "12px 14px",
  boxSizing: "border-box",
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: 16,
  background: tokens["color/card"],
});
globalStyle(`${together} > span:first-child`, { flex: 1, minWidth: 0 });
globalStyle(`${together} strong`, { display: "block", fontSize: 14, marginBottom: 3 });
export const overviewBody = style({
  display: "flex",
  flexDirection: "column",
  gap: 24,
  minWidth: 0,
});
export const section = style({ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 });
export const sectionTitle = style({
  margin: 0,
  fontFamily: tokens["typography/display/label-display/fontFamily"],
  fontSize: 14,
  lineHeight: "18px",
  fontWeight: 400,
  color: tokens["color/ink-2"],
});
export const categoryGrid = style({
  display: "grid",
  gridTemplateColumns: "repeat(2,minmax(0,1fr))",
  gap: 12,
  "@media": { "(max-width: 900px)": { gridTemplateColumns: "1fr" } },
});
export const iconTile = style({
  width: 40,
  height: 40,
  borderRadius: 20,
  background: tokens["color/icon-tile"],
  color: tokens["color/byul-ink"],
  display: "grid",
  placeItems: "center",
  flexShrink: 0,
});
export const summary = style({ width: "100%", minHeight: 74 });
export const management = style({
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  alignItems: "center",
});
export const breadcrumbs = style({
  display: "flex",
  gap: 8,
  alignItems: "center",
  minHeight: 48,
  padding: "8px 28px",
  color: tokens["color/ink-3"],
  flexShrink: 0,
});
export const currentCrumb = style({ color: tokens["color/ink"], fontSize: 13.5, fontWeight: 600 });
export const profilePreview = style([
  hero,
  { alignItems: "stretch", padding: "18px 20px 20px", alignSelf: "start" },
]);
export const profileIdentity = style({
  display: "flex",
  flexDirection: "column",
  gap: 8,
  alignItems: "center",
});
export const profileArtwork = style({
  display: "grid",
  placeItems: "center",
  width: 156,
  height: 156,
});
globalStyle(`${profileArtwork} > span`, { width: 156, height: 156 });
globalStyle(`${profileArtwork} img`, { width: 112, height: 112 });
export const profileTitle = style({
  margin: 0,
  fontFamily: tokens["typography/display/page/fontFamily"],
  fontSize: 26,
  lineHeight: "32px",
  fontWeight: 400,
});
export const emptyPortrait = style({
  display: "grid",
  placeItems: "center",
  width: 156,
  height: 156,
  fontSize: 26,
});
export const greetingStage = style({
  padding: "14px 12px 18px",
  display: "grid",
  placeItems: "center",
  borderRadius: 18,
  border: `1px dashed ${tokens["color/card-border"]}`,
  background: tokens["color/input"],
});
export const greeting = style({ width: "100%", boxSizing: "border-box", maxWidth: 286 });
