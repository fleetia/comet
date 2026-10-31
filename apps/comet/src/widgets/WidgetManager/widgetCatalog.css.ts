import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";
export const catalog = style({
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
  minHeight: 0,
  height: "100%",
  gap: 24,
  overflow: "hidden",
});
export const title = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 20,
  minWidth: 0,
  flexShrink: 0,
});
export const headingCopy = style({ display: "flex", alignItems: "baseline", gap: 14 });
globalStyle(`${headingCopy} h1`, {
  margin: 0,
  fontFamily: tokens["typography/display/page/fontFamily"],
  fontSize: 26,
  lineHeight: "32px",
  fontWeight: 400,
});
globalStyle(`${headingCopy} p`, { margin: 0, color: tokens["color/ink-2"], fontSize: 12 });
export const list = style({
  display: "grid",
  gridTemplateColumns: "repeat(3,minmax(0,1fr))",
  gap: 20,
  minHeight: 0,
  flex: 1,
  overflowY: "auto",
  alignItems: "start",
  "@media": { "(max-width: 1050px)": { gap: 16 } },
});
export const column = style({ display: "grid", alignContent: "start", minWidth: 0, gap: 20 });
export const group = style({ display: "grid", gap: 8, minWidth: 0 });
export const groupHeading = style({
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontFamily: tokens["typography/display/label-display/fontFamily"],
  fontSize: 14,
  lineHeight: "18px",
  color: tokens["color/ink-2"],
  fontWeight: 400,
  margin: 0,
});
export const rows = style({
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: 9,
  background: tokens["color/card"],
  overflow: "hidden",
});
export const entry = style({
  display: "flex",
  alignItems: "center",
  gap: 10,
  minWidth: 0,
  minHeight: 54,
  padding: "9px 12px",
  selectors: { "& + &": { borderTop: `1px solid ${tokens["color/divider"]}` } },
});
export const entryButton = style({
  display: "flex",
  alignItems: "center",
  minWidth: 0,
  flex: 1,
  gap: 10,
  color: tokens["color/ink"],
  background: "transparent",
  padding: 0,
  border: 0,
  font: "inherit",
  textAlign: "left",
  cursor: "pointer",
  selectors: {
    "&:focus-visible": {
      outline: `2px solid ${tokens["color/focus-ring"]}`,
      outlineOffset: 3,
      borderRadius: 8,
    },
  },
});
export const iconTile = style({
  display: "grid",
  placeItems: "center",
  width: 32,
  height: 32,
  flexShrink: 0,
  borderRadius: 16,
  color: tokens["color/icon-tile-ink"],
  background: tokens["color/icon-tile"],
});
export const entryCopy = style({ display: "grid", gap: 2, minWidth: 0, flex: 1 });
export const entryName = style({
  fontSize: 14,
  fontWeight: 600,
  lineHeight: "19px",
  overflowWrap: "anywhere",
});
export const description = style({
  fontSize: 12,
  lineHeight: "16px",
  color: tokens["color/ink-3"],
  overflowWrap: "anywhere",
});
export const empty = style({ margin: 0, color: tokens["color/ink-2"], fontSize: 13 });

export const toolbar = style({ display: "flex", alignItems: "center", gap: 14 });
