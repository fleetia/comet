import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const split = style({
  selectors: { "&[hidden]": { display: "none" } },
  display: "grid",
  gridTemplateColumns: "372px minmax(0, 1fr)",
  gap: 28,
  alignItems: "start",
  minWidth: 0,
  minHeight: 0,
  // The negative margin keeps the layout while leaving room for focus rings at the scroll edges.
  height: "calc(100% + 12px)",
  margin: -6,
  padding: "6px 8px 6px 6px",
  overflowY: "auto",
  "@media": {
    "(max-width: 1150px)": { gridTemplateColumns: "300px minmax(0, 1fr)", gap: 24 },
    "(max-width: 850px)": { gridTemplateColumns: "minmax(0, 1fr)" },
  },
});
export const inspector = style({
  display: "flex",
  flexDirection: "column",
  gap: 14,
  minWidth: 0,
  padding: "18px 20px 20px",
  border: `1px solid ${tokens["color/chip-border"]}`,
  borderRadius: 9,
  background: `radial-gradient(ellipse at 50% 0, ${tokens["color/preview-glow"]}, ${tokens["color/preview-glow-transparent"]} 70%), ${tokens["color/preview-panel"]}`,
  boxShadow: `0 1px 2px ${tokens["color/card-shadow"]}`,
  selectors: {
    '[data-comet-theme="light"] &': {
      background: `radial-gradient(ellipse at 50% 0, ${tokens["color/inspector-glow"]}, transparent 70%), ${tokens["color/card-2"]}`,
    },
  },
});
export const inspectorTitle = style({
  display: "flex",
  alignItems: "center",
  gap: 10,
  margin: 0,
  fontFamily: tokens["typography/display/title/fontFamily"],
  fontSize: 22,
  lineHeight: "28px",
  fontWeight: 400,
});
export const icon = style({
  display: "inline-grid",
  placeItems: "center",
  width: 36,
  height: 36,
  borderRadius: 18,
  background: tokens["color/icon-tile"],
  color: tokens["color/icon-tile-ink"],
  flexShrink: 0,
});
export const right = style({
  display: "flex",
  flexDirection: "column",
  gap: 20,
  minWidth: 0,
  minHeight: 0,
  // The grid scroller drops its own end padding from the scroll range.
  paddingBottom: 6,
});
export const section = style({
  selectors: { "&[hidden]": { display: "none" } },
  display: "flex",
  flexDirection: "column",
  gap: 8,
  minWidth: 0,
});
export const sectionTitle = style({
  margin: 0,
  fontFamily: tokens["typography/display/label-display/fontFamily"],
  fontSize: 14,
  fontWeight: 400,
  lineHeight: "18px",
  color: tokens["color/ink-2"],
});
export const group = style({
  minWidth: 0,
  overflow: "hidden",
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: tokens["radius/radius-9"],
  background: tokens["color/card"],
  boxShadow: `0 1px 2px ${tokens["color/card-shadow"]}`,
});
export const row = style({
  minHeight: 56,
  padding: "11px 16px",
  gap: 14,
  selectors: { "& + &": { borderTop: `1px solid ${tokens["color/divider"]}` } },
});
export const groupMessage = style({
  margin: 0,
  padding: "18px 16px",
  overflowWrap: "anywhere",
});
export const caption = style({
  margin: 0,
  fontSize: 12,
  lineHeight: "17px",
  color: tokens["color/ink-3"],
  overflowWrap: "anywhere",
});
export const copy = style({
  margin: 0,
  fontSize: 14,
  lineHeight: "20px",
  color: tokens["color/ink"],
});
export const summaryGrid = style({
  display: "grid",
  gridTemplateColumns: "repeat(2,minmax(0,1fr))",
  gap: 12,
  "@media": { "(max-width: 1050px)": { gridTemplateColumns: "minmax(0,1fr)" } },
});
export const summary = style({
  width: "100%",
  minHeight: 74,
  padding: "12px 16px",
  background: tokens["color/card"],
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: 9,
  boxShadow: `0 1px 2px ${tokens["color/card-shadow"]}`,
});
export const avatar = style({
  display: "inline-grid",
  placeItems: "center",
  width: 40,
  height: 40,
  borderRadius: 20,
  background: tokens["color/component/nav-badge"],
  color: tokens["color/ink"],
  fontSize: 15,
  flexShrink: 0,
});
export const controls = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
});
export const fullButton = style({ width: "100%", justifyContent: "center", minHeight: 40 });
export const note = style({
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "12px 14px",
  minWidth: 0,
  borderRadius: 9,
  background: tokens["color/card"],
  border: `1px solid ${tokens["color/card-border"]}`,
  boxShadow: `0 1px 2px ${tokens["color/card-shadow"]}`,
});
export const noteCopy = style({ display: "grid", gap: 2, minWidth: 0 });
export const statusDot = style({
  width: 10,
  height: 10,
  borderRadius: 5,
  background: tokens["color/live"],
  flexShrink: 0,
});
export const preview = style({
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 16,
  padding: "4px 0",
  minHeight: 204,
});
export const previewSprite = style({
  display: "block",
  width: 104,
  height: 104,
  objectFit: "contain",
  imageRendering: "pixelated",
});
export const balloon = style({
  width: "100%",
  boxSizing: "border-box",
  padding: "16px 18px",
  borderRadius: 9,
  border: `1px solid ${tokens["color/glass-border"]}`,
  background: tokens["color/glass-panel"],
});
export const speaker = style({
  margin: "0 0 8px",
  color: tokens["color/byul-ink"],
  fontSize: 12,
  lineHeight: "16px",
  fontWeight: 600,
});
export const form = style({
  padding: 0,
  border: 0,
  margin: 0,
  minWidth: 0,
  display: "grid",
  gap: 20,
});
export const save = style({ paddingTop: 4 });
export const nested = style({ minWidth: 0 });
export const guideFailure = style({ padding: "0 16px 11px", minWidth: 0 });
export const guideError = style({ margin: 0 });
export const guideFailureMessage = style({
  margin: 0,
  fontSize: 12,
  lineHeight: "17px",
  color: tokens["color/danger"],
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
});
globalStyle(`${nested} > ${guideError}`, { padding: "0 16px 11px" });
export const guidePathRow = style({ display: "flex", alignItems: "center", gap: 12, minWidth: 0 });
export const guidePath = style({
  flex: 1,
  minWidth: 0,
  direction: "rtl",
  textAlign: "left",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  fontSize: 12,
  color: tokens["color/ink-3"],
});
globalStyle(`${group} > .${nested} + .${nested}`, {
  borderTop: `1px solid ${tokens["color/divider"]}`,
});
export const groupLink = style({
  width: "100%",
  minHeight: 56,
  padding: "11px 16px",
  border: "none",
  borderRadius: 0,
  background: "transparent",
  selectors: { "& + &": { borderTop: `1px solid ${tokens["color/divider"]}` } },
});
globalStyle(`${groupLink} + ${row}`, { borderTop: `1px solid ${tokens["color/divider"]}` });
// The group clips its children, so a full-width link draws its focus ring inside.
globalStyle(`${group} ${groupLink}:focus-visible`, { outlineOffset: -2 });
