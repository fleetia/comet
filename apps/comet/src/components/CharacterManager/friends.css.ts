import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const library = style({
  display: "flex",
  flexDirection: "column",
  gap: 26,
  minWidth: 0,
  minHeight: 0,
  overflowY: "auto",
  padding: "24px 28px 28px",
});
export const libraryHeader = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 18,
  flexWrap: "wrap",
});
export const headingLine = style({ display: "flex", alignItems: "baseline", gap: 14 });
export const pageTitle = style({
  margin: 0,
  fontFamily: tokens["typography/display/page/fontFamily"],
  fontSize: 26,
  lineHeight: "32px",
  fontWeight: 400,
  color: tokens["color/ink"],
});
export const caption = style({
  display: "block",
  margin: 0,
  fontSize: 12,
  lineHeight: "17px",
  color: tokens["color/ink-3"],
});
export const headerActions = style({ display: "flex", gap: 14, alignItems: "center" });
export const librarySection = style({
  display: "flex",
  flexDirection: "column",
  gap: 10,
  minWidth: 0,
});
export const sectionHeading = style({
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: 12,
});
export const sectionTitle = style({
  margin: 0,
  fontFamily: tokens["typography/display/label-display/fontFamily"],
  fontSize: 14,
  lineHeight: "18px",
  fontWeight: 400,
  color: tokens["color/ink-2"],
});
export const cards = style({
  display: "grid",
  gridTemplateColumns: "repeat(3,minmax(0,1fr))",
  gap: 16,
  "@media": {
    "(max-width: 1020px)": { gridTemplateColumns: "repeat(2,minmax(0,1fr))" },
    "(max-width: 640px)": { gridTemplateColumns: "1fr" },
  },
});
export const friendCard = style({
  display: "flex",
  flexDirection: "column",
  gap: 12,
  minWidth: 0,
  padding: "16px 18px",
  border: `1px solid ${tokens["color/chip-border"]}`,
  borderRadius: 22,
  background: `radial-gradient(ellipse at top, ${tokens["color/icon-tile"]}, transparent 70%), ${tokens["color/card-2"]}`,
});
export const cardIdentity = style({
  width: "100%",
  cursor: "pointer",
  minWidth: 0,
  selectors: {
    "&:focus-visible": {
      outline: `2px solid ${tokens["color/focus-ring"]}`,
      outlineOffset: 4,
      borderRadius: 16,
    },
  },
});
export const artwork = style({
  width: 124,
  height: 124,
  display: "grid",
  placeItems: "center",
  flexShrink: 0,
  borderRadius: "50%",
  background: `radial-gradient(circle, ${tokens["color/icon-tile"]}, transparent 72%)`,
});
export const portrait = style({
  width: 92,
  height: 92,
  objectFit: "contain",
  imageRendering: "pixelated",
});
export const compactArtwork = style({
  width: 44,
  height: 44,
  display: "grid",
  placeItems: "center",
  flexShrink: 0,
});
export const compactPortrait = style({
  width: 44,
  height: 44,
  objectFit: "contain",
  imageRendering: "pixelated",
});
export const cardActions = style({ display: "flex", alignItems: "center", gap: 8 });
export const reorder = style({
  display: "flex",
  alignItems: "center",
  gap: 2,
  marginRight: "auto",
  color: tokens["color/ink-3"],
});
export const orderButton = style({
  background: "transparent",
  border: 0,
  color: "inherit",
  width: 20,
  height: 26,
  cursor: "pointer",
  selectors: {
    "&:disabled": { opacity: 0.35 },
    "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}` },
  },
});
export const addCard = style({ width: "100%", minHeight: 202, alignSelf: "start" });
export const secondaryColumns = style({
  display: "grid",
  gridTemplateColumns: "repeat(2,minmax(0,1fr))",
  gap: 24,
  paddingTop: 6,
  "@media": { "(max-width: 820px)": { gridTemplateColumns: "1fr" } },
});
export const summary = style({ width: "100%", minHeight: 72 });
export const restingRow = style({
  display: "flex",
  alignItems: "center",
  gap: 14,
  padding: "12px 16px",
  minHeight: 72,
  boxSizing: "border-box",
  background: tokens["color/card"],
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: 18,
});
export const restingIdentity = style({
  display: "flex",
  alignItems: "center",
  gap: 14,
  flex: 1,
  minWidth: 0,
  background: "transparent",
  border: 0,
  color: tokens["color/ink"],
  textAlign: "left",
  font: "inherit",
  cursor: "pointer",
  padding: 0,
});
export const fileRow = style([restingRow]);
export const iconTile = style({
  width: 40,
  height: 40,
  flexShrink: 0,
  borderRadius: 20,
  display: "grid",
  placeItems: "center",
  background: tokens["color/icon-tile"],
  color: tokens["color/byul-ink"],
});
export const fileText = style({
  display: "flex",
  flexDirection: "column",
  gap: 3,
  minWidth: 0,
  flex: 1,
});
export const detail = style({
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minWidth: 0,
  minHeight: 0,
});
export const adding = style({
  padding: "16px 28px 28px",
  display: "grid",
  gridTemplateColumns: "minmax(240px,372px) minmax(0,1fr)",
  gap: 28,
  overflowY: "auto",
  "@media": { "(max-width: 820px)": { gridTemplateColumns: "1fr" } },
});
export const addIntro = style({
  display: "flex",
  flexDirection: "column",
  gap: 18,
  padding: 20,
  border: `1px solid ${tokens["color/chip-border"]}`,
  borderRadius: 24,
  background: tokens["color/card-2"],
  alignSelf: "start",
});
export const sourceButtons = style({ display: "flex", flexDirection: "column", gap: 12 });
globalStyle(`${detail}[hidden], ${library}[hidden]`, { display: "none" });
