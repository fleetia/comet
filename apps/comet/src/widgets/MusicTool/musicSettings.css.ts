import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const workspace = style({
  display: "grid",
  gridTemplateColumns: "372px minmax(0,1fr)",
  gap: 28,
  minWidth: 0,
  alignItems: "start",
  "@media": { "(max-width: 900px)": { gridTemplateColumns: "1fr" } },
});
export const withSideContainer = style({ minWidth: 0 });
export const side = style({
  display: "flex",
  flexDirection: "column",
  gap: 14,
  margin: 0,
  border: 0,
  padding: 0,
  minWidth: 0,
});
export const previewStage = style({
  display: "grid",
  placeItems: "center",
  minWidth: 0,
  padding: 14,
  border: `1px dashed ${tokens["color/card-border"]}`,
  borderRadius: 18,
  background: tokens["color/input"],
});
export const preview = style({
  width: "100%",
  maxWidth: 320,
  boxSizing: "border-box",
  padding: "14px 16px",
});
export const song = style({ display: "flex", alignItems: "center", gap: 14 });
export const artwork = style({
  display: "grid",
  placeItems: "center",
  width: 60,
  height: 60,
  flexShrink: 0,
  borderRadius: 14,
  background: tokens["color/icon-tile"],
  color: tokens["color/byul-ink"],
  overflow: "hidden",
});
globalStyle(`${artwork} img`, { width: 60, height: 60, objectFit: "cover" });
export const songText = style({
  display: "flex",
  flexDirection: "column",
  gap: 3,
  minWidth: 0,
  fontSize: 12,
  lineHeight: "17px",
  color: tokens["color/ink-2"],
});
globalStyle(`${songText} strong`, {
  fontFamily: tokens["typography/display/title/fontFamily"],
  fontSize: 18,
  lineHeight: "24px",
  fontWeight: 400,
  color: tokens["color/ink"],
});
export const progress = style({
  display: "block",
  width: "100%",
  height: 4,
  border: 0,
  borderRadius: 2,
  overflow: "hidden",
  accentColor: tokens["color/byul-ink"],
  marginTop: 12,
});
globalStyle(`${progress}::-webkit-progress-bar`, { background: tokens["color/track"] });
globalStyle(`${progress}::-webkit-progress-value`, { background: tokens["color/byul-ink"] });
export const trackTime = style({
  display: "flex",
  justifyContent: "space-between",
  gap: 8,
  marginTop: 6,
  fontSize: 11,
  lineHeight: "16px",
  color: tokens["color/ink-3"],
});
export const caption = style({
  display: "block",
  margin: 0,
  fontSize: 12,
  lineHeight: "17px",
  color: tokens["color/ink-3"],
});
export const options = style({
  overflow: "hidden",
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: 16,
  background: tokens["color/card"],
});
export const optionRow = style({
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 14,
  minHeight: 44,
  boxSizing: "border-box",
  padding: "9px 14px",
  borderBottom: `1px solid ${tokens["color/divider"]}`,
  fontSize: 13,
  lineHeight: "18px",
  selectors: { "&:last-child": { borderBottom: 0 } },
});
globalStyle(`${optionRow} > span:first-child`, { flex: 1, minWidth: 0 });
export const settings = style({
  display: "flex",
  flexDirection: "column",
  gap: 26,
  minWidth: 0,
  border: 0,
  margin: 0,
  padding: 0,
});
export const form = style({ display: "flex", flexDirection: "column", gap: 14 });
export const section = style({ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 });
export const sectionTitle = style({
  margin: 0,
  fontFamily: tokens["typography/display/label-display/fontFamily"],
  fontSize: 14,
  lineHeight: "18px",
  fontWeight: 400,
  color: tokens["color/ink-2"],
});
export const rows = style({
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: 18,
  overflow: "hidden",
  background: tokens["color/card"],
});
export const providerField = style({ padding: "12px 16px" });
export const settingRow = style([optionRow, { minHeight: 56, padding: "10px 16px" }]);
export const settingActions = style({
  display: "flex",
  justifyContent: "flex-end",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 8,
});
export const sectionHeading = style({
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 14,
});
export const status = style({
  margin: 0,
  fontSize: 12,
  lineHeight: "17px",
  color: tokens["color/ink-2"],
  textAlign: "right",
});
export const pairingCode = style({
  display: "flex",
  flexDirection: "column",
  gap: 8,
  padding: "12px 16px",
  border: `1px solid ${tokens["color/selected-border"]}`,
  borderRadius: 16,
  background: tokens["color/selected"],
});
globalStyle(`${pairingCode} code`, {
  fontSize: 22,
  letterSpacing: ".08em",
  color: tokens["color/selected-ink"],
});
export const more = style({ fontSize: 12, lineHeight: "18px", color: tokens["color/ink-2"] });
globalStyle(`${more} summary`, { cursor: "pointer" });
